'use strict';

/**
 * Ports of the api_*_lib.py resources: solar power, phase min/max, weather
 * history, financial, dynamic tariff, water (v2 + digital), statistics,
 * catalog, datetime, wifi and p1 port telegram.
 */

const fs = require('node:fs');
const path = require('node:path');
const { SQL, help, runSeries, query, clauses, jsonMode } = require('../lib/series');
const { pyInt } = require('../lib/params');
const { dumps, int } = require('../lib/pyjson');
const { items } = require('../lib/params');
const { apiError, santizeHtml, HttpError, API_PARAMETER_ERROR } = require('../lib/errors');
const { fmtLocal, unix } = require('../lib/time');

const TS = ['TIMESTAMP_lOCAL', 'TIMESTAMP_UTC'];
const CATALOG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'catalog.json'), 'utf8')).data;
const PERIODS = ['minute', 'hour', 'day', 'month', 'year'];
const GENERIC_500 = () => new HttpError('500 Internal Server Error', { title: '500 Internal Server Error' });

function register(router) {
  // --- powerProductionSolar (SolarEdge) ---------------------------------------
  const solarKeys = [...TS, 'TIMEPERIOD_ID', 'POWER_SOURCE_ID', 'PRODUCTION_KWH_HIGH', 'PRODUCTION_KWH_LOW',
    'PRODUCTION_KWH_HIGH_TOTAL', 'PRODUCTION_KWH_LOW_TOTAL', 'PRODUCTION_KWH_TOTAL'];
  const SQL_INDEX_NUMBERS = [20, 30, 40, 50, 60, 70, 80, 90];
  PERIODS.forEach((period, i) => {
    const base = '/api/v1/powerproductionsolar/' + period;
    router.add(base + '/help', () => help('HELP_ROUTE_POWER_PRODUCTION_SOLAR_MIN_DAY_MONTH_YEAR_JSON'));
    router.add(base + '/{power_source_id}/{db_index}', (ctx) => {
      try {
        pyInt(ctx.pathParams.power_source_id); // parsed but never used by ZTATZ
      } catch (e) {
        throw apiError(API_PARAMETER_ERROR, ' power_source_id must be a number > 0 ' + santizeHtml(e.message));
      }
      let dbIndex;
      try {
        dbIndex = Number(pyInt(ctx.pathParams.db_index));
      } catch {
        dbIndex = 0;
      }
      if (!SQL_INDEX_NUMBERS.includes(dbIndex)) {
        throw apiError(API_PARAMETER_ERROR, santizeHtml('database index must be a value in the range [' + SQL_INDEX_NUMBERS.join(', ') + ']'));
      }
      dbIndex += i + 1;
      return runSeries(ctx, {
        regular: SQL['powerProductionSolar.sqlstr_base_regular'],
        round: SQL['powerProductionSolar.sqlstr_base_round'],
        mid: ' where TIMEPERIOD_ID = ' + dbIndex + ' and POWER_SOURCE_ID = 1 ',
        keys: solarKeys,
        start: { style: 'length', clause: clauses.andStart },
        range: { clause: clauses.andRange },
        collapse: true,
      });
    });
  });

  // --- PhaseMinMax --------------------------------------------------------------
  const mm = (prefix, suffix) => ['L1', 'L2', 'L3'].map((l) => prefix + l + suffix);
  const minMaxKeys = [...TS,
    ...mm('CONSUMPTION_', '_W_MAX'), ...mm('PRODUCTION_', '_W_MAX'), ...mm('', '_V_MAX'), ...mm('', '_A_MAX'),
    ...mm('CONSUMPTION_', '_W_MIN'), ...mm('PRODUCTION_', '_W_MIN'), ...mm('', '_V_MIN'), ...mm('', '_A_MIN')];
  router.add('/api/v1/phaseminmax/day/help', () => help('HELP_ROUTE_POWER_PHASE_MINMAX_DAY_JSON'));
  router.add('/api/v1/phaseminmax/day', (ctx) => runSeries(ctx, {
    regular: SQL['PhaseMinMax.sqlstr_base_regular'],
    round: SQL['PhaseMinMax.sqlstr_base_round'],
    keys: minMaxKeys,
    start: { style: 'strict', clause: clauses.whereStartNoSpace },
    range: { clause: clauses.andRange },
    collapse: true,
  }));

  // --- WeatherHistory -----------------------------------------------------------
  const weatherKeys = [...TS, 'CITY_ID', 'CITY_NAME', 'TEMPERATURE_LOW', 'TEMPERATURE_AVERAGE', 'TEMPERATURE_HIGH',
    'PRESSURE_LOW', 'PRESSURE_AVERAGE', 'PRESSURE_HIGH', 'HUMIDITY_LOW', 'HUMIDITY_AVERAGE', 'HUMIDITY_HIGH',
    'WIND_SPEED_LOW', 'WIND_SPEED_AVERAGE', 'WIND_SPEED_HIGH', 'WIND_DEGREES_LOW', 'WIND_DEGREES_HUMIDITY_AVERAGE',
    'WIND_DEGREES_HIGH', 'DEGREE_DAYS'];
  const weatherTables = { hour: 'weer_history_uur ', day: 'weer_history_dag ', month: 'weer_history_maand ', year: 'weer_history_jaar ' };
  for (const [period, table] of Object.entries(weatherTables)) {
    const route = '/api/v1/weather/' + period;
    router.add(route + '/help', () => help('HELP_ROUTE_WEATHER_DAY_MONTH_YEAR_JSON'));
    router.add(route, (ctx) => runSeries(ctx, {
      regular: SQL['WeatherHistory.sqlstr_base_regular'] + table,
      round: SQL['WeatherHistory.sqlstr_base_round'] + table,
      keys: weatherKeys,
      start: { style: 'strict', clause: clauses.whereStart },
      range: null,
    }));
  }

  // --- Financial ----------------------------------------------------------------
  const finKeys = [...TS, 'CONSUMPTION_COST_ELECTRICITY_HIGH', 'CONSUMPTION_COST_ELECTRICITY_LOW',
    'PRODUCTION_REVENUES_ELECTRICITY_HIGH', 'PRODUCTION_REVENUES_ELECTRICITY_LOW', 'CONSUMPTION_COST_GAS',
    'CONSUMPTION_COST_WATER'];
  const finTables = { day: 'e_financieel_dag', month: 'e_financieel_maand', year: 'e_financieel_jaar' };
  for (const [period, table] of Object.entries(finTables)) {
    const route = '/api/v1/financial/' + period;
    router.add(route + '/help', () => help('HELP_ROUTE_FINANCIAL_DAY_JSON'));
    router.add(route, (ctx) => runSeries(ctx, {
      regular: SQL['Financial.sqlstr_base_regular'] + table,
      round: SQL['Financial.sqlstr_base_round'] + table,
      keys: finKeys,
      start: { style: 'length', clause: clauses.whereStart },
      range: { clause: clauses.whereRange },
    }));
  }
  router.add('/api/v1/financial/dynamic_tariff/help', () => help('HELP_ROUTE_FINANCIAL_DYNAMIC_TARIFF_JSON'));
  router.add('/api/v1/financial/dynamic_tariff', (ctx) => runSeries(ctx, {
    regular: SQL['FinancialDynamicTariff.sqlstr_base_regular'] + 'energieprijzen_uur',
    round: SQL['FinancialDynamicTariff.sqlstr_base_round'] + 'energieprijzen_uur',
    keys: [...TS, 'DYNAMIC_TARIFF_KWH', 'DYNAMIC_TARIFF_GAS'],
    start: { style: 'length', clause: clauses.whereStart },
    range: { clause: clauses.whereRange },
  }));

  // --- Watermeter (v2, deprecated) and WatermeterDigital -----------------------
  const waterKeys = [...TS, 'TIMEPERIOD_ID', 'WATERMETER_PULS_COUNT', 'WATERMETER_CONSUMPTION_LITER',
    'WATERMETER_CONSUMPTION_TOTAL_M3'];
  PERIODS.forEach((period, i) => {
    const route = '/api/v2/watermeter/' + period;
    router.add(route + '/help', () => help('HELP_ROUTE_WATERMETER_MIN_HOUR_DAY_MONTH_YEAR_JSON'));
    router.add(route, (ctx) => runSeries(ctx, {
      regular: SQL['Watermeter.sqlstr_base_regular'],
      round: SQL['Watermeter.sqlstr_base_round'],
      mid: ' where TIMEPERIOD_ID = ' + ' ' + (11 + i) + ' ',
      keys: waterKeys,
      start: { style: 'length', clause: clauses.andStart },
      range: { clause: clauses.andRange },
    }));

    const digital = '/api/v2/watermeterdigital/' + period;
    router.add(digital + '/help', () => help('HELP_ROUTE_WATERMETER_DIGITAL_MIN_HOUR_DAY_MONTH_YEAR_JSON'));
    router.add(digital + '/{id}', (ctx) => {
      const id = ctx.pathParams.id;
      let intId;
      try {
        intId = Number(pyInt(id));
      } catch {
        throw apiError(API_PARAMETER_ERROR, santizeHtml('Index number is not a number! index used is = ' + id + ' should be a number starting with 1.'));
      }
      // id 6 is unreachable in ZTATZ (duplicate `elif int_id == 5`)
      const base = { 1: 11, 2: 21, 3: 31, 4: 41, 5: 51 }[intId];
      if (!base) throw GENERIC_500();
      return runSeries(ctx, {
        regular: SQL['WatermeterDigital.sqlstr_base_regular'],
        round: SQL['WatermeterDigital.sqlstr_base_round'],
        mid: ' where TIMEPERIOD_ID = ' + (base + i),
        keys: waterKeys,
        start: { style: 'length', clause: clauses.andStart },
        range: { clause: clauses.andRange },
        collapse: true,
      });
    });
  });

  // --- Statistics (only json + round) -------------------------------------------
  router.add('/api/v1/statistics/help', () => help('HELP_ROUTE_STATISTICS_JSON'));
  router.add('/api/v1/statistics', (ctx) => {
    let sql = SQL['Statistics.sqlstr_base_regular'];
    for (const [key, value] of items(ctx.params)) {
      if (key === 'round' && value.toLowerCase() === 'on') sql = SQL['Statistics.sqlstr_base_round'];
    }
    return query(ctx, sql, ['ID', 'DATA_ID', 'ACTIVE', 'TIMESTAMP_START', 'TIMESTAMP_STOP', 'MODE', 'VALUE', 'UPDATED'],
      jsonMode(ctx.params));
  });

  // --- Catalog --------------------------------------------------------------------
  router.add('/api/v1/catalog/help', () => help('HELP_ROUTE_CATALOG_JSON'));
  router.add('/api/v1/catalog', (ctx) => dumps(CATALOG.map((r) => ctx.lanIp + r), { ensureAscii: false }));

  // --- single-record resources ------------------------------------------------------
  const single = (ctx, keys, values) => {
    if (jsonMode(ctx.params) === 'object') {
      return dumps(Object.fromEntries(keys.map((k, i) => [k, values[i]])), { sortKeys: true, ensureAscii: false });
    }
    return dumps(values, { ensureAscii: false });
  };

  router.add('/api/v1/datetime/help', () => help('HELP_ROUTE_DATETIME'));
  router.add('/api/v1/datetime', (ctx) => {
    const now = ctx.now();
    const ts = fmtLocal(now);
    // the "internet time" is the simulated clock as well, so the variance is 0
    return single(ctx, ['SYSTEM_DATETIME', 'SYSTEM_DATETIME_UTC', 'INET_DATETIME', 'INET_DATETIME_UTC', 'TIME_VARIANCE'],
      [ts, int(unix(now)), ts, int(unix(now)), int(0)]);
  });

  router.add('/api/v1/wifi/ssid/help', () => help('HELP_ROUTE_WIFI_SSID_JSON'));
  router.add('/api/v1/wifi/ssid', (ctx) => {
    const now = ctx.now();
    const ssids = [...new Set(ctx.sim.wifiNetworks())].sort();
    return single(ctx, [...TS, 'SSID'], [fmtLocal(now), int(unix(now)), ssids]);
  });

  router.add('/api/v1/p1port/telegram/help', () => help('HELP_ROUTE_P1_PORT_TELEGRAM'));
  router.add('/api/v1/p1port/telegram', (ctx) => {
    const now = ctx.now();
    const telegram = ctx.sim.telegram();
    return single(ctx, [...TS, 'VALID_DATA', 'P1_TELEGRAM'],
      [fmtLocal(now), int(unix(now)), telegram.length > 0 ? 'valid' : 'invalid', telegram]);
  });
}

module.exports = { register };
