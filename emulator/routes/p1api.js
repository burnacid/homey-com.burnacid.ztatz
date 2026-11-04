'use strict';

/**
 * Ports of the resource classes defined inline in ztatz/scripts/P1Api.py:
 * PowerProductionS0, IndoorTemperature, CurrentWeather, PowerGasHistory*,
 * Status, Config, SmartMeter and Phase.
 */

const { SQL, help, runSeries, query, clauses, jsonMode } = require('../lib/series');
const { pyInt, pyAbs } = require('../lib/params');
const { apiError, santizeHtml, API_PARAMETER_ERROR } = require('../lib/errors');

const TS = ['TIMESTAMP_lOCAL', 'TIMESTAMP_UTC'];
const lengthStart = (clause) => ({ style: 'length', clause });
const strictStart = (clause) => ({ style: 'strict', clause });

function register(router) {
  // --- PowerProductionS0 ------------------------------------------------------
  const s0Keys = [...TS, 'TIMEPERIOD_ID', 'POWER_SOURCE_ID', 'PRODUCTION_KWH_HIGH', 'PRODUCTION_KWH_LOW',
    'PULS_PER_TIMEUNIT_HIGH', 'PULS_PER_TIMEUNIT_LOW', 'PRODUCTION_KWH_HIGH_TOTAL', 'PRODUCTION_KWH_LOW_TOTAL',
    'PRODUCTION_KWH_TOTAL', 'PRODUCTION_PSEUDO_W'];
  const s0Periods = { minute: ' 11 ', hour: ' 12 ', day: ' 13 ', month: ' 14 ', year: ' 15 ' };
  for (const [period, id] of Object.entries(s0Periods)) {
    const route = '/api/v1/powerproduction/' + period;
    router.add(route + '/help', () => help('HELP_ROUTE_POWER_PRODUCTION_MIN_DAY_MONTH_YEAR_JSON'));
    router.add(route, (ctx) => runSeries(ctx, {
      regular: SQL['PowerProductionS0.sqlstr_base_regular'],
      round: SQL['PowerProductionS0.sqlstr_base_round'],
      mid: ' where TIMEPERIOD_ID = ' + id + ' and POWER_SOURCE_ID = 1 ',
      keys: s0Keys,
      start: lengthStart(clauses.andStart),
      range: { clause: clauses.andRange },
    }));
  }

  // --- IndoorTemperature ------------------------------------------------------
  const tempKeys = [...TS, 'ROOM_TEMPERATURE_RECORD_TYPE_ID', 'ROOM_TEMPERATURE_IN', 'ROOM_TEMPERATURE_IN_LOW',
    'ROOM_TEMPERATURE_IN_AVERAGE', 'ROOM_TEMPERATURE_IN_HIGH', 'ROOM_TEMPERATURE_OUT', 'ROOM_TEMPERATURE_OUT_LOW',
    'ROOM_TEMPERATURE_OUT_AVERAGE', 'ROOM_TEMPERATURE_OUT_HIGH'];
  const tempRoutes = { '': '10 ', '/minute': '11 ', '/hour': '12 ', '/day': '13 ', '/month': '14 ', '/year': '15 ' };
  for (const [suffix, recordId] of Object.entries(tempRoutes)) {
    const route = '/api/v1/indoor/temperature' + suffix;
    router.add(route + '/help', () => help('HELP_ROUTE_INDOOR_TEMPERATURE_JSON'));
    router.add(route, (ctx) => runSeries(ctx, {
      regular: SQL['IndoorTemperature.sqlstr_base_regular'] + recordId,
      round: SQL['IndoorTemperature.sqlstr_base_round'] + recordId,
      keys: tempKeys,
      start: lengthStart(clauses.andStart),
      range: { clause: clauses.andRange },
    }));
  }

  // --- CurrentWeather -----------------------------------------------------------
  router.add('/api/v1/weather/help', () => help('HELP_ROUTE_WEATHER_CURRENT_JSON'));
  router.add('/api/v1/weather', (ctx) => runSeries(ctx, {
    regular: SQL['CurrentWeather.sqlstr_base_regular'] + 'weer ',
    round: SQL['CurrentWeather.sqlstr_base_round'] + 'weer ',
    keys: [...TS, 'CITY_ID', 'CITY_NAME', 'TEMPERATURE', 'WEATHER_DESCRIPTION', 'WEATHER_ICON', 'PRESSURE',
      'HUMIDITY', 'WIND_SPEED', 'WIND_DEGREES', 'CLOUDS', 'WEATHER_ID'],
    start: strictStart((v) => " where datetime( TIMESTAMP, 'unixepoch', 'localtime' ) >= '" + v + "' order by timestamp "),
    range: null,
  }));

  // --- PowerGasHistory (min / hour / day / month / year) -----------------------
  const pgBase = [...TS, 'CONSUMPTION_KWH_LOW', 'CONSUMPTION_KWH_HIGH', 'PRODUCTION_KWH_LOW', 'PRODUCTION_KWH_HIGH',
    'CONSUMPTION_DELTA_KWH', 'PRODUCTION_DELTA_KWH'];
  const powerGas = [
    ['minute', 'PowerGasHistoryMin', 'e_history_min ', 'HELP_ROUTE_POWER_GAS_MIN_JSON',
      [...pgBase, 'TARIFCODE', 'CONSUMPTION_KW', 'PRODUCTION_KW', 'CONSUMPTION_GAS_M3']],
    ['hour', 'PowerGasHistoryHour', 'e_history_uur ', 'HELP_ROUTE_POWER_GAS_HOUR_JSON',
      [...pgBase, 'TARIFCODE', 'CONSUMPTION_GAS_M3', 'CONSUMPTION_GAS_DELTA_M3']],
    ['day', 'PowerGasHistoryDayMonthYear', 'e_history_dag ', 'HELP_ROUTE_POWER_GAS_DAY_MONTH_YEAR_JSON',
      [...pgBase, 'CONSUMPTION_GAS_M3', 'CONSUMPTION_GAS_DELTA_M3']],
    ['month', 'PowerGasHistoryDayMonthYear', 'e_history_maand ', 'HELP_ROUTE_POWER_GAS_DAY_MONTH_YEAR_JSON',
      [...pgBase, 'CONSUMPTION_GAS_M3', 'CONSUMPTION_GAS_DELTA_M3']],
    ['year', 'PowerGasHistoryDayMonthYear', 'e_history_jaar ', 'HELP_ROUTE_POWER_GAS_DAY_MONTH_YEAR_JSON',
      [...pgBase, 'CONSUMPTION_GAS_M3', 'CONSUMPTION_GAS_DELTA_M3']],
  ];
  for (const [period, cls, table, helpName, keys] of powerGas) {
    const route = '/api/v1/powergas/' + period;
    router.add(route + '/help', () => help(helpName));
    router.add(route, (ctx) => runSeries(ctx, {
      regular: SQL[cls + '.sqlstr_base_regular'] + table,
      round: SQL[cls + '.sqlstr_base_round'] + table,
      keys,
      start: lengthStart(clauses.whereStart),
      range: { clause: clauses.whereRangeNoSpace },
    }));
  }

  // --- Status / Config ----------------------------------------------------------
  const idResource = (cls, helpName, keys) => (ctx) => {
    let id = (ctx.pathParams.id === undefined ? 'all' : ctx.pathParams.id).toLowerCase();
    if (ctx.path.endsWith('/help')) id = 'help';
    if (id === 'help') return help(helpName);
    let sql;
    if (id === 'all') {
      sql = SQL[cls + '.sqlstr_base_regular'] + 'order by id';
    } else {
      try {
        sql = SQL[cls + '.sqlstr_base_regular'] + ' where id = ' + pyAbs(pyInt(id)).toString();
      } catch {
        throw apiError(API_PARAMETER_ERROR, santizeHtml('id value not ok, value used is ' + id));
      }
    }
    return query(ctx, sql, keys, jsonMode(ctx.params));
  };
  const status = idResource('Status', 'HELP_ROUTE_STATUS_JSON', ['STATUS_ID', 'STATUS', 'LABEL', 'SECURITY']);
  const config = idResource('Config', 'HELP_ROUTE_CONFIG_JSON', ['CONFIGURATION_ID', 'PARAMETER', 'LABEL']);
  for (const [base, handler] of [['/api/v1/status', status], ['/api/v1/configuration', config]]) {
    router.add(base, handler);
    router.add(base + '/help', handler);
    router.add(base + '/{id}', handler);
    router.add(base + '/{id}/help', handler);
  }

  // --- SmartMeter ---------------------------------------------------------------
  router.add('/api/v1/smartmeter/help', () => help('HELP_ROUTE_SMARTMETER_JSON'));
  router.add('/api/v1/smartmeter', (ctx) => runSeries(ctx, {
    regular: SQL['SmartMeter.sqlstr_base_regular'],
    round: SQL['SmartMeter.sqlstr_base_round'],
    keys: [...TS, 'RECORD_IS_PROCESSED', 'CONSUMPTION_KWH_LOW', 'CONSUMPTION_KWH_HIGH', 'PRODUCTION_KWH_LOW',
      'PRODUCTION_KWH_HIGH', 'TARIFCODE', 'CONSUMPTION_W', 'PRODUCTION_W', 'CONSUMPTION_GAS_M3', 'CONSUMPTION_WATER_M3'],
    start: strictStart(clauses.whereStartNoSpace),
    range: null,
  }));

  // --- Phase --------------------------------------------------------------------
  router.add('/api/v1/phase/help', () => help('HELP_ROUTE_PHASE_JSON'));
  router.add('/api/v1/phase', (ctx) => runSeries(ctx, {
    regular: SQL['Phase.sqlstr_base_regular'],
    round: SQL['Phase.sqlstr_base_round'],
    keys: [...TS, 'CONSUMPTION_L1_W', 'CONSUMPTION_L2_W', 'CONSUMPTION_L3_W', 'PRODUCTION_L1_W', 'PRODUCTION_L2_W',
      'PRODUCTION_L3_W', 'L1_V', 'L2_V', 'L3_V', 'L1_A', 'L2_A', 'L3_A'],
    start: strictStart(clauses.whereStartNoSpace),
    range: null,
  }));
}

module.exports = { register };
