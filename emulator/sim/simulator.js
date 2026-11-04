'use strict';

/**
 * Writes simulated P1 monitor data into the ZTATZ tables, following the
 * derivation rules of the real P1SerReader / P1Db / P1Watermeter / ... scripts:
 *
 *   every 10 s   e_serial, faseinformatie, temperatuur (10), live status rows
 *   every minute e_history_min + hour/day/month/year rollups, watermeter,
 *                powerproduction (S0), temperatuur, faseminmax_dag, financial
 *   every 15 min powerproduction_solar (SolarEdge interval values)
 *   every 10 min weer + weer_history_*
 *   every hour   energieprijzen_uur, statistics, retention cleanup
 *
 * History is backfilled at startup: hourly resolution for `historyDays` days,
 * then a full 10-second simulation for the last two days up to "now".
 */

const { House, weather, prices, hourlyAverages, hashRandom } = require('./model');
const { fmtLocal, periodKey, unix, daysInMonth, dsmrTimestamp, pad } = require('../lib/time');
const { floatRepr } = require('../lib/pyjson');
const { DEFAULTS, merge, clone } = require('./scenario');
const { resetDefaults } = require('../lib/db');

const TICK_MS = 10000;
const r3 = (x) => Math.round(x * 1000) / 1000;
const r4 = (x) => Math.round(x * 10000) / 10000;
const r6 = (x) => Math.round(x * 1000000) / 1000000;
// [prefix, prefix + '~']: an index friendly replacement for substr(TIMESTAMP,1,len) = prefix
const rng = (key, len) => [key.slice(0, len), key.slice(0, len) + '~'];
const pyStr = (x) => (typeof x === 'number' ? floatRepr(x) : String(x));

const P1_VERSION = '4.2.0';
const NEW_VERSION = {
  66: '4.3.0',
  67: '2026-10-30 12:00:00',
  68: 'Nieuwe versie met verbeterde fase informatie en bugfixes.',
  86: 'https://www.ztatz.nl/p1-monitor-download/',
  110: '20261101',
  133: '0',
  134: '',
  135: 'Emulated release',
};

class Simulator {
  constructor({ db, clock, scenario = DEFAULTS, lanIp = '127.0.0.1', historyDays = 400, log = () => {} }) {
    this.db = db;
    this.clock = clock;
    this.scenario = clone(scenario);
    this.lanIp = lanIp;
    this.historyDays = historyDays;
    this.log = log;
    this.timer = null;
    this.startedAt = clock.now();
    this.prepare();
  }

  // ---------------------------------------------------------------------------
  // setup
  // ---------------------------------------------------------------------------

  /** Cached prepared statement (the simulator runs the same SQL every minute). */
  stmt(sql) {
    if (!this.stmtCache) this.stmtCache = new Map();
    let st = this.stmtCache.get(sql);
    if (!st) {
      st = this.db.prepare(sql);
      this.stmtCache.set(sql, st);
    }
    return st;
  }

  prepare() {
    const p = (sql) => this.stmt(sql);
    this.q = {
      status: p('update status set STATUS = ? where ID = ?'),
      statusLabel: p('update status set LABEL = ? where ID = ?'),
      config: p('select PARAMETER from config where ID = ?'),
      setConfig: p('update config set PARAMETER = ? where ID = ?'),
      serial: p('insert or replace into e_serial (TIMESTAMP, RECORD_VERWERKT, VERBR_KWH_181, VERBR_KWH_182, GELVR_KWH_281, ' +
        'GELVR_KWH_282, TARIEFCODE, ACT_VERBR_KW_170, ACT_GELVR_KW_270, VERBR_GAS_2421, VERBR_WATER) values (?,0,?,?,?,?,?,?,?,?,?)'),
      phase: p('insert or replace into faseinformatie (TIMESTAMP, VERBR_L1_KW, VERBR_L2_KW, VERBR_L3_KW, GELVR_L1_KW, GELVR_L2_KW, ' +
        'GELVR_L3_KW, L1_V, L2_V, L3_V, L1_A, L2_A, L3_A) values (?,?,?,?,?,?,?,?,?,?,?,?,?)'),
      temp: p('insert or replace into temperatuur (TIMESTAMP, RECORD_ID, TEMPERATURE_1, TEMPERATURE_1_AVG, TEMPERATURE_1_MIN, ' +
        'TEMPERATURE_1_MAX, TEMPERATURE_2, TEMPERATURE_2_AVG, TEMPERATURE_2_MIN, TEMPERATURE_2_MAX) values (?,?,?,?,?,?,?,?,?,?)'),
      minuteAgg: p('select max(VERBR_KWH_181), max(VERBR_KWH_182), max(GELVR_KWH_281), max(GELVR_KWH_282), avg(ACT_VERBR_KW_170), ' +
        'avg(ACT_GELVR_KW_270), max(VERBR_GAS_2421), max(VERBR_WATER), count(*) from e_serial where TIMESTAMP >= ? and TIMESTAMP < ?'),
      minuteTariff: p('select TARIEFCODE from e_serial where TIMESTAMP >= ? and TIMESTAMP < ? order by TIMESTAMP desc limit 1'),
      prevMinute: p('select VERBR_KWH_181 + VERBR_KWH_182, GELVR_KWH_281 + GELVR_KWH_282 from e_history_min where TIMESTAMP < ? ' +
        'order by TIMESTAMP desc limit 1'),
      histMin: p('insert or replace into e_history_min (TIMESTAMP, VERBR_KWH_181, VERBR_KWH_182, GELVR_KWH_281, GELVR_KWH_282, ' +
        'VERBR_KWH_X, GELVR_KWH_X, TARIEFCODE, ACT_VERBR_KW_170, ACT_GELVR_KW_270, VERBR_GAS_2421) values (?,?,?,?,?,?,?,?,?,?,?)'),
      processed: p('update e_serial set RECORD_VERWERKT = 1 where TIMESTAMP >= ? and TIMESTAMP < ?'),
      histHour: p('insert or replace into e_history_uur (TIMESTAMP, VERBR_KWH_181, VERBR_KWH_182, GELVR_KWH_281, GELVR_KWH_282, ' +
        'VERBR_KWH_X, GELVR_KWH_X, TARIEFCODE, VERBR_GAS_2421, VERBR_GAS_X) values (?,?,?,?,?,?,?,?,?,0)'),
      water: p('insert or replace into watermeter (TIMESTAMP, TIMEPERIOD_ID, PULS_PER_TIMEUNIT, VERBR_PER_TIMEUNIT, VERBR_IN_M3_TOTAAL) ' +
        'values (?,?,?,?,?)'),
      s0: p('insert or replace into powerproduction (TIMESTAMP, TIMEPERIOD_ID, POWER_SOURCE_ID, PRODUCTION_KWH_HIGH, PRODUCTION_KWH_LOW, ' +
        'PULS_PER_TIMEUNIT_HIGH, PULS_PER_TIMEUNIT_LOW, PRODUCTION_KWH_HIGH_TOTAL, PRODUCTION_KWH_LOW_TOTAL, PRODUCTION_KWH_TOTAL, ' +
        'PRODUCTION_PSEUDO_KW) values (?,?,1,?,?,?,?,?,?,?,?)'),
      solar: p('insert or replace into powerproduction_solar (TIMESTAMP, TIMEPERIOD_ID, POWER_SOURCE_ID, PRODUCTION_KWH_HIGH, ' +
        'PRODUCTION_KWH_LOW, PRODUCTION_KWH_HIGH_TOTAL, PRODUCTION_KWH_LOW_TOTAL, PRODUCTION_KWH_TOTAL) values (?,?,1,?,?,?,?,?)'),
      weer: p('insert or replace into weer (TIMESTAMP, CITY_ID, CITY, TEMPERATURE, DESCRIPTION, WEATHER_ICON, PRESSURE, HUMIDITY, ' +
        'WIND_SPEED, WIND_DEGREE, CLOUDS, WEATHER_ID) values (?,?,?,?,?,?,?,?,?,?,?,?)'),
      weerHour: p('insert or replace into weer_history_uur (TIMESTAMP, CITY_ID, CITY, TEMPERATURE_MIN, TEMPERATURE_AVG, TEMPERATURE_MAX, ' +
        'PRESSURE_MIN, PRESSURE_AVG, PRESSURE_MAX, HUMIDITY_MIN, HUMIDITY_AVG, HUMIDITY_MAX, WIND_SPEED_MIN, WIND_SPEED_AVG, ' +
        'WIND_SPEED_MAX, WIND_DEGREE_MIN, WIND_DEGREE_AVG, WIND_DEGREE_MAX, DEGREE_DAYS) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'),
      price: p('insert or replace into energieprijzen_uur (TIMESTAMP, PRICE_KWH, PRICE_GAS) values (?,?,?)'),
      minmax: p('insert or replace into faseminmax_dag values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'),
    };
  }

  cfg(id) {
    const row = this.q.config.get(id);
    return row ? Number(row.PARAMETER) || 0 : 0;
  }

  setStatus(id, value) {
    this.q.status.run(pyStr(value), id);
  }

  tariffAt(d) {
    if (this.scenario.tariff !== 'auto') return this.scenario.tariff;
    const h = d.getHours();
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    return !weekend && h >= 7 && h < 23 ? 'P' : 'D';
  }

  waterPulse() {
    return this.scenario.water === 'pulse' || this.scenario.water === 'both';
  }

  waterDigital() {
    return this.scenario.water === 'digital' || this.scenario.water === 'both';
  }

  // ---------------------------------------------------------------------------
  // lifecycle
  // ---------------------------------------------------------------------------

  /** Build all history up to now. */
  init() {
    const t0 = Date.now();
    const now = this.clock.now();
    const fineStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2);
    const histStart = new Date(fineStart.getFullYear(), fineStart.getMonth(), fineStart.getDate() - this.historyDays);

    this.house = new House(42);
    this.meter = {
      t1: 8000 + hashRandom('m1') * 500, t2: 7000 + hashRandom('m2') * 500,
      g1: 2500, g2: 3000,
      gasExact: 3500, gasReading: 3500,
      waterM3: 400, waterPulseM3: 400,
      s0High: 6000, s0Low: 4000,
      seHigh: 9000, seLow: 6000,
    };
    this.resetAccumulators();
    this.applyStatic(now);

    this.db.exec('BEGIN');
    this.backfillHourly(histStart, fineStart);
    this.db.exec('COMMIT');

    this.live = false;
    this.lastTick = fineStart.getTime();
    this.db.exec('BEGIN');
    this.runTicksUntil(now.getTime());
    this.db.exec('COMMIT');
    this.live = true;
    this.hourly(new Date(this.lastTick));
    this.liveStatus(new Date(this.lastTick));
    this.log('history built in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  }

  start() {
    this.timer = setInterval(() => this.catchUp(), 1000);
  }

  stop() {
    clearInterval(this.timer);
  }

  catchUp(maxTicks = 5000) {
    const target = this.clock.now().getTime();
    if (this.lastTick + TICK_MS > target) return;
    this.db.exec('BEGIN');
    try {
      this.runTicksUntil(target, maxTicks);
    } finally {
      this.db.exec('COMMIT');
    }
  }

  runTicksUntil(target, maxTicks = Infinity) {
    let n = 0;
    while (this.lastTick + TICK_MS <= target && n++ < maxTicks) {
      this.lastTick += TICK_MS;
      this.tick(new Date(this.lastTick));
    }
  }

  /** Fast-forward the simulated clock (no gaps in the data). */
  advanceTo(target) {
    const max = this.clock.now().getTime() + 7 * 86400000;
    const t = Math.min(target.getTime(), max);
    if (t <= this.clock.now().getTime()) return;
    this.db.exec('BEGIN');
    try {
      this.runTicksUntil(t);
    } finally {
      this.db.exec('COMMIT');
    }
    this.clock.setNow(new Date(t));
  }

  resetAccumulators() {
    this.acc = {
      minuteWaterL: 0, waterPulseCarry: 0, prevDigitalM3: null,
      minuteS0Kwh: 0, s0Carry: 0,
      seWh: 0, seStart: null,
      tempIn: null, tempOut: null,
      day: null, dayStart: null, maxC: 0, maxCts: null, maxP: 0, maxPts: null,
      minC: null, minCts: null, minP: null, minPts: null,
      prevGasReading: null, prevGasTime: null, gasRate: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // scenario
  // ---------------------------------------------------------------------------

  updateScenario(update) {
    const prev = this.scenario;
    const next = merge(prev, update);
    this.scenario = next;
    if (next.speed !== prev.speed) this.clock.setSpeed(next.speed);
    if (next.phaseLabels !== prev.phaseLabels || next.newVersion !== prev.newVersion) this.applyStatic(this.clock.now());
    if (!this.waterPulse()) this.db.exec('delete from watermeter where TIMEPERIOD_ID between 11 and 15');
    if (!this.waterDigital()) this.db.exec('delete from watermeter where TIMEPERIOD_ID between 21 and 25');
    if (!next.heating) this.db.exec('delete from temperatuur');
    if (!next.s0Production) this.db.exec('delete from powerproduction');
    if (!next.solarEdge) this.db.exec('delete from powerproduction_solar');
    return next;
  }

  /** Static status / config rows: system info, version info, phase labels. */
  applyStatic(now) {
    const ts = fmtLocal(now);
    const s = (id, v) => this.setStatus(id, v);
    s(5, fmtLocal(this.startedAt));
    s(6, fmtLocal(this.startedAt));
    s(17, fmtLocal(this.startedAt));
    s(20, this.lanIp);
    s(22, 'Debian GNU/Linux 13 (trixie)');
    s(23, ts);
    s(24, 'ja');
    s(25, '3.13.5');
    s(26, '203.0.113.10');
    s(27, 'p1mon.example.net');
    s(28, 'p1mon');
    s(51, 'Cortex-A72');
    s(52, 'BCM2835');
    s(53, 'c03114');
    s(55, 'Raspberry Pi 4 Model B Rev 1.4');
    s(72, 'dc:a6:32:12:34:56');
    s(73, 'dc:a6:32:12:34:57');
    s(80, 'API data succesvol verwerkt.');
    s(92, '/dev/ttyUSB0');
    s(93, 'Debian GNU/Linux 13 (trixie) aarch64');
    s(107, 'proces start(watchdog)');
    s(117, '0');
    s(118, '0');
    s(119, '0');
    s(122, '192.168.1.1');
    s(139, 'p1mon');

    // Version check (P1Watchdog): rows are cleared when there is no newer version.
    if (this.scenario.newVersion) {
      this.q.setConfig.run('1', 51);
      for (const [id, v] of Object.entries(NEW_VERSION)) s(Number(id), v);
      s(136, '1');
    } else {
      for (const id of [66, 67, 68, 110, 133, 134, 135]) s(id, id === 133 ? '0' : '');
      s(86, '');
      s(136, '0');
    }
    s(137, '0');

    // ZTATZ <= 2.4.1 used "L2" in the L3 labels.
    const legacy = this.scenario.phaseLabels === 'legacy_v241';
    this.q.statusLabel.run(legacy ? 'Huidige Amperage L2 (71.7.0)' : 'Huidige Amperage L3 (71.7.0)', 102);
    this.q.statusLabel.run(legacy ? 'Huidige Voltage L2 (72.7.0)' : 'Huidige Voltage L3 (72.7.0)', 105);
  }

  resetAll() {
    this.stop();
    for (const t of ['e_serial', 'e_history_min', 'e_history_uur', 'e_history_dag', 'e_history_maand', 'e_history_jaar',
      'e_financieel_dag', 'e_financieel_maand', 'e_financieel_jaar', 'energieprijzen_uur', 'weer', 'weer_history_uur',
      'weer_history_dag', 'weer_history_maand', 'weer_history_jaar', 'temperatuur', 'watermeter', 'faseinformatie',
      'faseminmax_dag', 'powerproduction', 'powerproduction_solar', 'statistics']) {
      this.db.exec('delete from ' + t);
    }
    this.clock.setNow(new Date());
    this.clock.setSpeed(this.scenario.speed);
    this.startedAt = this.clock.now();
    resetDefaults(this.db, this.startedAt);
    this.init();
    this.start();
  }

  // ---------------------------------------------------------------------------
  // 10 second tick
  // ---------------------------------------------------------------------------

  tick(d) {
    const sc = this.scenario;
    const dt = TICK_MS / 1000;
    const m = this.meter;
    const a = this.acc;
    const phases = sc.phases;
    const step = this.house.step(d, dt, phases);

    let load = step.load;
    let solar = step.solar;
    if (phases === 1) {
      // appliances started while in 3-phase mode end up on the only phase
      load = [load[0] + load[1] + load[2], 0, 0];
      solar = [solar[0] + solar[1] + solar[2], 0, 0];
    }
    if (sc.power.mode === 'manual') {
      const split = phases === 1 ? [1, 0, 0] : [0.5, 0.3, 0.2];
      load = split.map((f) => sc.power.consumptionW * f);
      solar = [sc.power.productionW, 0, 0];
    }

    // per phase net power, voltage and (integer) current like a DSMR meter
    const net = [0, 1, 2].map((i) => load[i] - solar[i]);
    const volts = [0, 1, 2].map((i) => {
      if (phases === 1 && i > 0) return 0;
      const v = 230 + (hashRandom('v' + i + d.getHours()) - 0.5) * 6 - net[i] * 0.0012 + (this.house.rand() - 0.5) * 0.6;
      return Math.round(v * 10) / 10;
    });
    const amps = net.map((w, i) => (volts[i] > 0 ? Math.round(Math.abs(w) / volts[i]) : 0));
    const phaseKw = net.map((w) => r3(Math.abs(w) / 1000));
    const consKw = net.map((w, i) => (w > 0 ? phaseKw[i] : 0));
    const prodKw = net.map((w, i) => (w < 0 ? phaseKw[i] : 0));
    const totalNet = net[0] + net[1] + net[2];
    const actC = totalNet > 0 ? r3(totalNet / 1000) : 0;
    const actP = totalNet < 0 ? r3(-totalNet / 1000) : 0;

    // meter registers
    const tariff = this.tariffAt(d);
    const kwh = (Math.abs(totalNet) * dt) / 3600000;
    if (totalNet > 0) {
      if (tariff === 'D') m.t1 += kwh;
      else m.t2 += kwh;
    } else if (tariff === 'D') m.g1 += kwh;
    else m.g2 += kwh;

    // gas: DSMR 5 meters report a new reading every 5 minutes
    if (sc.gas) {
      m.gasExact += step.gasM3;
      if (d.getMinutes() % 5 === 0 && d.getSeconds() < dt) m.gasReading = r3(m.gasExact);
    }
    const gasReading = sc.gas ? m.gasReading : 0;

    // water
    if (this.waterPulse() || this.waterDigital()) {
      m.waterM3 += step.waterL / 1000;
      a.minuteWaterL += step.waterL;
    }
    const waterReading = this.waterDigital() ? r3(m.waterM3) : 0;

    // solar production meters
    const solarKwh = ((solar[0] + solar[1] + solar[2]) * dt) / 3600000;
    if (sc.s0Production) a.minuteS0Kwh += solarKwh;
    if (sc.solarEdge) a.seWh += solarKwh * 1000;

    const ts = fmtLocal(d);
    this.q.serial.run(ts, r3(m.t1), r3(m.t2), r3(m.g1), r3(m.g2), tariff, actC, actP, gasReading, waterReading);
    this.q.phase.run(ts, consKw[0], consKw[1], consKw[2], prodKw[0], prodKw[1], prodKw[2],
      volts[0], volts[1], volts[2], amps[0], amps[1], amps[2]);
    this.trackPhaseDay(d, [...consKw, ...prodKw, ...volts, ...amps]);

    if (sc.heating) {
      const tIn = step.heating.tIn + (this.house.rand() - 0.5) * 0.4;
      const tOut = step.heating.tOut + (this.house.rand() - 0.5) * 0.4;
      a.tempIn = a.tempIn === null ? tIn : a.tempIn * 0.9 + tIn * 0.1;
      a.tempOut = a.tempOut === null ? tOut : a.tempOut * 0.9 + tOut * 0.1;
      this.q.temp.run(ts, 10, Math.round(tIn * 10) / 10, Math.round(a.tempIn * 100) / 100, 0, 0,
        Math.round(tOut * 10) / 10, Math.round(a.tempOut * 100) / 100, 0, 0);
    }

    this.last = { d, ts, tariff, actC, actP, consKw, prodKw, volts, amps, gasReading, waterReading };
    this.trackDay(d, actC, actP);
    if (this.live) this.liveStatus(d);

    // the minute that just ended is processed at the first tick of the next one
    if (d.getSeconds() < dt) this.minute(new Date(d.getTime() - 60000));
  }

  trackDay(d, actC, actP) {
    const a = this.acc;
    const day = periodKey.day(d);
    const ts = fmtLocal(d);
    if (a.day !== day) {
      a.day = day;
      a.dayStart = { t1: this.meter.t1, t2: this.meter.t2, g1: this.meter.g1, g2: this.meter.g2 };
      a.maxC = 0; a.maxCts = ts; a.maxP = 0; a.maxPts = ts;
      a.minC = null; a.minCts = ts; a.minP = null; a.minPts = ts;
    }
    if (actC > a.maxC) { a.maxC = actC; a.maxCts = ts; }
    if (actP > a.maxP) { a.maxP = actP; a.maxPts = ts; }
    if (a.minC === null || actC < a.minC) { a.minC = actC; a.minCts = ts; }
    if (a.minP === null || actP < a.minP) { a.minP = actP; a.minPts = ts; }
  }

  /** Status rows the real P1SerReader updates for every telegram. */
  liveStatus(d) {
    const l = this.last;
    if (!l) return;
    const a = this.acc;
    const m = this.meter;
    const s = (id, v) => this.setStatus(id, v);
    s(16, l.ts);
    s(87, String(unix(d)));
    s(46, '1');
    s(123, '1');
    s(125, '0');
    s(85, l.tariff);
    s(1, a.maxC); s(2, a.maxCts);
    s(3, a.maxP); s(4, a.maxPts);
    s(113, a.minC ?? 0); s(114, a.minCts);
    s(115, a.minP ?? 0); s(116, a.minPts);
    s(8, r3(m.t1 - a.dayStart.t1));
    s(9, r3(m.t2 - a.dayStart.t2));
    s(10, r3(m.g1 - a.dayStart.g1));
    s(11, r3(m.g2 - a.dayStart.g2));
    s(43, l.gasReading);
    if (a.prevGasReading !== null && l.gasReading !== a.prevGasReading) {
      a.gasRate = r4(((l.gasReading - a.prevGasReading) / ((d - a.prevGasTime) / 1000)) * 3600);
    }
    if (a.prevGasReading !== l.gasReading) { a.prevGasReading = l.gasReading; a.prevGasTime = d; }
    s(50, a.gasRate);
    for (let i = 0; i < 3; i++) {
      s(74 + i, l.consKw[i]);
      s(77 + i, l.prodKw[i]);
      s(100 + i, l.amps[i]);
      s(103 + i, l.volts[i]);
    }
    s(106, l.ts);
    const sumC = r3(l.consKw[0] + l.consKw[1] + l.consKw[2]);
    const sumP = r3(l.prodKw[0] + l.prodKw[1] + l.prodKw[2]);
    s(130, sumC);
    s(131, sumP);
    s(132, r3(sumC - sumP));
  }

  // ---------------------------------------------------------------------------
  // minute processing (P1Db)
  // ---------------------------------------------------------------------------

  minute(d) {
    const key = periodKey.minute(d);
    const like = key.slice(0, 16);
    const agg = Object.values(this.q.minuteAgg.get(...rng(key, 16)));
    if (!agg[8]) return;
    const [v181, v182, g281, g282, actC, actP, gas] = agg;
    const tariff = this.q.minuteTariff.get(...rng(key, 16)).TARIEFCODE;
    const prev = this.q.prevMinute.get(key);
    const prevVals = prev ? Object.values(prev) : null;
    const dIn = prevVals ? Math.max(0, r3(v181 + v182 - prevVals[0])) : 0;
    const dOut = prevVals ? Math.max(0, r3(g281 + g282 - prevVals[1])) : 0;
    this.q.histMin.run(key, v181, v182, g281, g282, dIn, dOut, tariff, r3(actC), r3(actP), gas);
    this.q.processed.run(...rng(key, 16));

    this.rollupEnergy(d, 'minute');
    this.minuteWater(d, key, agg[7]);
    this.minuteS0(d, key, tariff);
    if (this.scenario.solarEdge && d.getMinutes() % 15 === 14) this.solarEdgeInterval(d, tariff);
    if (this.scenario.heating) this.rollupTemperature(d, 'minute');
    this.phaseMinMax(d);
    this.financial(d);
    if (d.getMinutes() % 10 === 0) this.weather(d);

    if (this.live) {
      const ts = fmtLocal(new Date(d.getTime() + 60000));
      for (const id of [7, 12, 13, 14, 15, 127]) this.setStatus(id, ts);
      const day = this.stmt('select VERBR_GAS_X from e_history_dag where TIMESTAMP = ?').get(periodKey.day(d));
      this.setStatus(44, day ? day.VERBR_GAS_X : 0);
      this.setStatus(19, uptime(this.clock.now() - this.startedAt));
      this.setStatus(18, r3(3 + hashRandom('cpu' + key) * 9));
      this.setStatus(31, r3(22 + hashRandom('ram' + key) * 4));
      this.setStatus(21, r3(9 + hashRandom('rd' + periodKey.hour(d)) * 2));
      this.setStatus(69, Math.round((45 + hashRandom('cput' + key) * 8) * 10) / 10);
      this.setStatus(81, ts);
    }
    if (d.getMinutes() === 59) this.hourly(new Date(d.getTime() + 60000));
  }

  /** e_history_uur/dag/maand/jaar rollups, starting above `from` ('minute' or 'hour'). */
  rollupEnergy(d, from) {
    const db = this.db;
    if (from === 'minute') {
      const hour = periodKey.hour(d);
      this.stmt(`insert or replace into e_history_uur (TIMESTAMP, VERBR_KWH_181, VERBR_KWH_182, GELVR_KWH_281, GELVR_KWH_282,
          VERBR_KWH_X, GELVR_KWH_X, TARIEFCODE, VERBR_GAS_2421, VERBR_GAS_X)
        select ?, max(VERBR_KWH_181), max(VERBR_KWH_182), max(GELVR_KWH_281), max(GELVR_KWH_282),
          round(sum(VERBR_KWH_X), 3), round(sum(GELVR_KWH_X), 3),
          (select TARIEFCODE from e_history_min where TIMESTAMP >= ? and TIMESTAMP < ? order by TIMESTAMP desc limit 1),
          max(VERBR_GAS_2421), 0
        from e_history_min where TIMESTAMP >= ? and TIMESTAMP < ?`).run(hour, ...rng(hour, 13), ...rng(hour, 13));
    }
    this.gasHour(d);
    const up = (table, lower, key, len, gasSql) => {
      this.stmt(`insert or replace into ${table} (TIMESTAMP, VERBR_KWH_181, VERBR_KWH_182, GELVR_KWH_281, GELVR_KWH_282,
          VERBR_KWH_X, GELVR_KWH_X, VERBR_GAS_2421, VERBR_GAS_X)
        select ?, max(VERBR_KWH_181), max(VERBR_KWH_182), max(GELVR_KWH_281), max(GELVR_KWH_282),
          round(sum(VERBR_KWH_X), 3), round(sum(GELVR_KWH_X), 3), max(VERBR_GAS_2421), ${gasSql}
        from ${lower} where TIMESTAMP >= ? and TIMESTAMP < ?`).run(key, ...rng(key, len));
    };
    up('e_history_dag', 'e_history_uur', periodKey.day(d), 10, '0');
    this.gasDay(d);
    up('e_history_maand', 'e_history_dag', periodKey.month(d), 7, 'round(sum(VERBR_GAS_X), 3)');
    up('e_history_jaar', 'e_history_maand', periodKey.year(d), 4, 'round(sum(VERBR_GAS_X), 3)');
  }

  // P1Db.updateGas: hour = |reading - previous hour reading|, day = reading - yesterday's reading
  gasHour(d) {
    const key = periodKey.hour(d);
    const row = this.stmt('select VERBR_GAS_2421 from e_history_uur where TIMESTAMP = ?').get(key);
    if (!row) return;
    const prev = this.stmt('select VERBR_GAS_2421 from e_history_uur where TIMESTAMP < ? and VERBR_GAS_2421 > 0 ' +
      'order by TIMESTAMP desc limit 1').get(key);
    const delta = row.VERBR_GAS_2421 > 0 && prev ? r4(Math.abs(row.VERBR_GAS_2421 - prev.VERBR_GAS_2421)) : 0;
    this.stmt('update e_history_uur set VERBR_GAS_X = ? where TIMESTAMP = ?').run(delta, key);
  }

  gasDay(d) {
    const key = periodKey.day(d);
    const row = this.stmt('select VERBR_GAS_2421 from e_history_dag where TIMESTAMP = ?').get(key);
    if (!row) return;
    const prev = this.stmt('select VERBR_GAS_2421 from e_history_dag where TIMESTAMP < ? and VERBR_GAS_2421 > 0 ' +
      'order by TIMESTAMP desc limit 1').get(key);
    let delta = row.VERBR_GAS_2421 > 0 && prev ? r3(Math.max(0, row.VERBR_GAS_2421 - prev.VERBR_GAS_2421)) : 0;
    if (delta > 10) delta = 0;
    this.stmt('update e_history_dag set VERBR_GAS_X = ? where TIMESTAMP = ?').run(delta, key);
  }

  /** Generic sum/max rollup for tables keyed by (TIMESTAMP, TIMEPERIOD_ID). */
  rollupPeriods(d, table, firstId, fromLevel, cols, extraWhere = '') {
    const levels = [['hour', 13], ['day', 10], ['month', 7], ['year', 4]];
    const start = fromLevel === 'minute' ? 0 : 1;
    for (let i = start; i < levels.length; i++) {
      const [level, len] = levels[i];
      const id = firstId + i + 1;
      const key = periodKey[level](d);
      const names = cols.map((c) => c[0]);
      const exprs = cols.map(([c, fn]) => `${fn}(${c})`);
      this.stmt(`insert or replace into ${table} (TIMESTAMP, TIMEPERIOD_ID, ${extraWhere ? 'POWER_SOURCE_ID, ' : ''}${names.join(', ')})
        select ?, ?, ${extraWhere ? '1, ' : ''}${exprs.join(', ')} from ${table}
        where TIMEPERIOD_ID = ? ${extraWhere} and TIMESTAMP >= ? and TIMESTAMP < ?
        having count(*) > 0`).run(key, id, id - 1, ...rng(key, len));
    }
  }

  minuteWater(d, key, digitalReading) {
    const a = this.acc;
    const cols = [['PULS_PER_TIMEUNIT', 'sum'], ['VERBR_PER_TIMEUNIT', 'sum'], ['VERBR_IN_M3_TOTAAL', 'max']];
    if (this.waterPulse()) {
      // P1WatermeterV2: one pulse per litre (config 98), total in m3 with 6 decimals
      const litres = a.minuteWaterL + a.waterPulseCarry;
      const pulses = Math.floor(litres);
      a.waterPulseCarry = litres - pulses;
      this.meter.waterPulseM3 = r6(this.meter.waterPulseM3 + pulses / 1000);
      this.q.water.run(key, 11, pulses, pulses * this.cfgLitresPerPulse(), this.meter.waterPulseM3);
      this.rollupPeriods(d, 'watermeter', 11, 'minute', cols);
    }
    if (this.waterDigital()) {
      // p1_telegram_water_lib: litres from the difference of the meter reading
      const prev = a.prevDigitalM3 ?? digitalReading;
      const litres = Math.max(0, Math.trunc((digitalReading - prev) * 1000));
      a.prevDigitalM3 = digitalReading;
      if (litres <= 100) {
        this.q.water.run(key, 21, 0, litres, digitalReading);
        this.rollupPeriods(d, 'watermeter', 21, 'minute', cols);
      }
    }
    a.minuteWaterL = 0;
  }

  cfgLitresPerPulse() {
    return this.cfg(98) || 1;
  }

  minuteS0(d, key, tariff) {
    if (!this.scenario.s0Production) return;
    const a = this.acc;
    const m = this.meter;
    const perPulse = this.cfg(127) || 0.0005;
    const kwh = a.minuteS0Kwh + a.s0Carry;
    const pulses = Math.floor(kwh / perPulse);
    a.s0Carry = kwh - pulses * perPulse;
    a.minuteS0Kwh = 0;
    const produced = r6(pulses * perPulse);
    const high = tariff === 'P';
    if (high) m.s0High = r6(m.s0High + produced);
    else m.s0Low = r6(m.s0Low + produced);
    this.q.s0.run(key, 11, high ? produced : 0, high ? 0 : produced, high ? pulses : 0, high ? 0 : pulses,
      m.s0High, m.s0Low, r6(m.s0High + m.s0Low), Number((produced * 16.66).toFixed(6)));
    this.rollupPeriods(d, 'powerproduction', 11, 'minute', [
      ['PRODUCTION_KWH_HIGH', 'sum'], ['PRODUCTION_KWH_LOW', 'sum'], ['PULS_PER_TIMEUNIT_HIGH', 'sum'],
      ['PULS_PER_TIMEUNIT_LOW', 'sum'], ['PRODUCTION_KWH_HIGH_TOTAL', 'max'], ['PRODUCTION_KWH_LOW_TOTAL', 'max'],
      ['PRODUCTION_KWH_TOTAL', 'max'], ['PRODUCTION_PSEUDO_KW', 'sum']], 'and POWER_SOURCE_ID = 1');
  }

  /** SolarEdge delivers 15-minute values; the row is stamped with the interval start. */
  solarEdgeInterval(d, tariff) {
    const a = this.acc;
    const m = this.meter;
    const start = new Date(d.getTime() - 14 * 60000);
    const kwh = r3(a.seWh / 1000);
    a.seWh = 0;
    const high = tariff === 'P';
    if (high) m.seHigh = r3(m.seHigh + kwh);
    else m.seLow = r3(m.seLow + kwh);
    this.q.solar.run(periodKey.minute(start), 21, high ? kwh : 0, high ? 0 : kwh, m.seHigh, m.seLow, r3(m.seHigh + m.seLow));
    this.rollupSolar(start, 'minute');
  }

  rollupSolar(d, from) {
    this.rollupPeriods(d, 'powerproduction_solar', 21, from, [
      ['PRODUCTION_KWH_HIGH', 'sum'], ['PRODUCTION_KWH_LOW', 'sum'], ['PRODUCTION_KWH_HIGH_TOTAL', 'max'],
      ['PRODUCTION_KWH_LOW_TOTAL', 'max'], ['PRODUCTION_KWH_TOTAL', 'max']], 'and POWER_SOURCE_ID = 1');
  }

  /** temperatuur: 11 = minute average of the raw (10) rows, 12..15 = printf('%.1f') avg / min / max. */
  rollupTemperature(d, from) {
    const db = this.db;
    if (from === 'minute') {
      const key = periodKey.minute(d);
      this.stmt(`insert or replace into temperatuur (TIMESTAMP, RECORD_ID, TEMPERATURE_1, TEMPERATURE_1_AVG, TEMPERATURE_1_MIN,
          TEMPERATURE_1_MAX, TEMPERATURE_2, TEMPERATURE_2_AVG, TEMPERATURE_2_MIN, TEMPERATURE_2_MAX)
        select ?, 11, 0, round(avg(TEMPERATURE_1_AVG), 2), round(avg(TEMPERATURE_1_AVG), 2), round(avg(TEMPERATURE_1_AVG), 2),
          0, round(avg(TEMPERATURE_2_AVG), 2), round(avg(TEMPERATURE_2_AVG), 2), round(avg(TEMPERATURE_2_AVG), 2)
        from temperatuur where RECORD_ID = 10 and TIMESTAMP >= ? and TIMESTAMP < ? having count(*) > 0`).run(key, ...rng(key, 16));
    }
    const levels = [['hour', 13], ['day', 10], ['month', 7], ['year', 4]];
    for (let i = from === 'minute' ? 0 : 1; i < levels.length; i++) {
      const [level, len] = levels[i];
      const key = periodKey[level](d);
      this.stmt(`insert or replace into temperatuur (TIMESTAMP, RECORD_ID, TEMPERATURE_1, TEMPERATURE_1_AVG, TEMPERATURE_1_MIN,
          TEMPERATURE_1_MAX, TEMPERATURE_2, TEMPERATURE_2_AVG, TEMPERATURE_2_MIN, TEMPERATURE_2_MAX)
        select ?, ?, 0, printf('%.1f', avg(TEMPERATURE_1_AVG)), min(TEMPERATURE_1_MIN), max(TEMPERATURE_1_MAX),
          0, printf('%.1f', avg(TEMPERATURE_2_AVG)), min(TEMPERATURE_2_MIN), max(TEMPERATURE_2_MAX)
        from temperatuur where RECORD_ID = ? and TIMESTAMP >= ? and TIMESTAMP < ? having count(*) > 0`)
        .run(key, 12 + i, 11 + i, ...rng(key, len));
    }
  }

  /** Track the day's per-phase max/min (kW, V, A) like faseminmax_dag. */
  trackPhaseDay(d, values) {
    const day = periodKey.day(d);
    const a = this.acc;
    if (!a.phaseDay || a.phaseDay.day !== day) {
      a.prevPhaseDay = a.phaseDay;
      a.phaseDay = { day, max: values.slice(), min: values.slice() };
      return;
    }
    for (let i = 0; i < values.length; i++) {
      if (values[i] > a.phaseDay.max[i]) a.phaseDay.max[i] = values[i];
      if (values[i] < a.phaseDay.min[i]) a.phaseDay.min[i] = values[i];
    }
  }

  phaseMinMax(d) {
    const day = periodKey.day(d);
    const pd = [this.acc.phaseDay, this.acc.prevPhaseDay].find((x) => x && x.day === day);
    if (pd) this.q.minmax.run(day, ...pd.max, ...pd.min);
  }


  /** financial_lib.Cost2Database for the day of `d`, plus month / year sums. */
  financial(d) {
    const db = this.db;
    const day = periodKey.day(d);
    const dim = daysInMonth(d);
    const dynamic = this.cfg(204) > 0;
    const hours = this.stmt('select TIMESTAMP, TARIEFCODE, VERBR_KWH_X, GELVR_KWH_X, VERBR_GAS_X from e_history_uur ' +
      'where TIMESTAMP >= ? and TIMESTAMP < ?').all(...rng(day, 10));
    if (hours.length === 0) return;
    const priceAt = this.stmt('select PRICE_KWH, PRICE_GAS from energieprijzen_uur where TIMESTAMP = ?');
    let vp = 0, vd = 0, gp = 0, gd = 0, gas = 0;
    for (const h of hours) {
      let pVl = this.cfg(1), pVh = this.cfg(2), pGl = this.cfg(3), pGh = this.cfg(4), pGas = this.cfg(15);
      if (dynamic) {
        const p = priceAt.get(h.TIMESTAMP);
        if (p && p.PRICE_KWH !== null) {
          const flex = this.cfg(205);
          const kwhPrice = p.PRICE_KWH < 0 ? p.PRICE_KWH - flex : p.PRICE_KWH + flex;
          pVl = pVh = pGl = pGh = kwhPrice;
        }
        if (p && p.PRICE_GAS !== null) pGas = p.PRICE_GAS + this.cfg(208);
      }
      if (h.TARIEFCODE === 'P') {
        vp += h.VERBR_KWH_X * pVh;
        gp += h.GELVR_KWH_X * pGh;
      } else {
        vd += h.VERBR_KWH_X * pVl;
        gd += h.GELVR_KWH_X * pGl;
      }
      gas += h.VERBR_GAS_X * pGas;
    }
    vd += this.cfg(5) / dim;
    gas += this.cfg(16) / dim;
    const litres = this.stmt('select coalesce(sum(VERBR_PER_TIMEUNIT), 0) as L from watermeter where TIMEPERIOD_ID in (12, 22) ' +
      'and TIMESTAMP >= ? and TIMESTAMP < ?').get(...rng(day, 10)).L;
    const water = litres * (this.cfg(104) / 1000) + this.cfg(103) / dim;
    const r = (x) => Math.round(x * 100000) / 100000;
    this.stmt('insert or replace into e_financieel_dag values (?,?,?,?,?,?,?)').run(day, r(vp), r(vd), r(gp), r(gd), r(gas), r(water));
    const sumInto = (table, lower, key, len) => this.stmt(`insert or replace into ${table}
        select ?, round(sum(VERBR_P),5), round(sum(VERBR_D),5), round(sum(GELVR_P),5), round(sum(GELVR_D),5),
          round(sum(GELVR_GAS),5), round(sum(VERBR_WATER),5)
        from ${lower} where TIMESTAMP >= ? and TIMESTAMP < ?`).run(key, ...rng(key, len));
    sumInto('e_financieel_maand', 'e_financieel_dag', periodKey.month(d), 7);
    sumInto('e_financieel_jaar', 'e_financieel_maand', periodKey.year(d), 4);
  }

  /** Current weather (OpenWeatherMap style, UTC epoch timestamp) and weather history rollups. */
  weather(d) {
    const w = weather(d);
    this.q.weer.run(String(unix(d) - 90), this.cfg(25), this.cityName(), w.temperature, w.description, w.icon,
      w.pressure, w.humidity, w.windSpeed, w.windDegree, w.clouds, w.weatherId);
    const hour = periodKey.hour(d);
    this.stmt(`insert or replace into weer_history_uur select ?, max(CITY_ID), max(CITY),
        min(TEMPERATURE), round(avg(TEMPERATURE), 2), max(TEMPERATURE),
        min(PRESSURE), round(avg(PRESSURE)), max(PRESSURE), min(HUMIDITY), round(avg(HUMIDITY)), max(HUMIDITY),
        min(WIND_SPEED), round(avg(WIND_SPEED), 1), max(WIND_SPEED), min(WIND_DEGREE), round(avg(WIND_DEGREE)), max(WIND_DEGREE),
        round(max(0, ? - avg(TEMPERATURE)) / 24, 4)
      from weer where substr(datetime(TIMESTAMP, 'unixepoch', 'localtime'),1,13) = ? having count(*) > 0`)
      .run(hour, this.cfg(202) || 18, hour.slice(0, 13));
    this.rollupWeather(d);
  }

  cityName() {
    const row = this.q.config.get(14);
    return row ? row.PARAMETER : 'Amsterdam';
  }

  rollupWeather(d) {
    const room = this.cfg(202) || 18;
    const up = (table, lower, key, len, degree) => this.stmt(`insert or replace into ${table} select ?, max(CITY_ID), max(CITY),
        min(TEMPERATURE_MIN), round(avg(TEMPERATURE_AVG), 2), max(TEMPERATURE_MAX),
        min(PRESSURE_MIN), round(avg(PRESSURE_AVG)), max(PRESSURE_MAX), min(HUMIDITY_MIN), round(avg(HUMIDITY_AVG)), max(HUMIDITY_MAX),
        min(WIND_SPEED_MIN), round(avg(WIND_SPEED_AVG), 1), max(WIND_SPEED_MAX),
        min(WIND_DEGREE_MIN), round(avg(WIND_DEGREE_AVG)), max(WIND_DEGREE_MAX), ${degree}
      from ${lower} where TIMESTAMP >= ? and TIMESTAMP < ? having count(*) > 0`).run(key, ...rng(key, len));
    up('weer_history_dag', 'weer_history_uur', periodKey.day(d), 10, `round(max(0, ${room} - avg(TEMPERATURE_AVG)), 2)`);
    up('weer_history_maand', 'weer_history_dag', periodKey.month(d), 7, 'round(sum(DEGREE_DAYS), 2)');
    up('weer_history_jaar', 'weer_history_maand', periodKey.year(d), 4, 'round(sum(DEGREE_DAYS), 2)');
  }

  // ---------------------------------------------------------------------------
  // hourly tasks
  // ---------------------------------------------------------------------------

  hourly(d) {
    // dynamic prices: today, plus tomorrow once published (13:00)
    const today = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const hoursAhead = d.getHours() >= 13 ? 48 : 24;
    for (let h = 0; h < hoursAhead; h++) {
      const t = new Date(today.getTime() + h * 3600000);
      const p = prices(t);
      this.stmt('insert or ignore into energieprijzen_uur values (?,?,?)').run(periodKey.hour(t), p.kwh, p.gas);
    }
    this.statistics(d);
    if (this.live) this.prune(d);
  }

  statistics(d) {
    const db = this.db;
    const ts = fmtLocal(d);
    const from = fmtLocal(new Date(d.getTime() - 30 * 86400000)).slice(0, 10) + ' 00:00:00';
    const val = (sql) => {
      const row = this.stmt(sql).get(from);
      const v = row ? Object.values(row)[0] : null;
      return v === null ? 0 : Math.round(v * 1000) / 1000;
    };
    const rows = [
      [1, 3, 1, 1, val('select avg(VERBR_KWH_X) from e_history_dag where TIMESTAMP >= ?')],
      [2, 3, 1, 2, val('select max(VERBR_KWH_X) from e_history_dag where TIMESTAMP >= ?')],
      [3, 8, 1, 4, val('select sum(GELVR_KWH_X) from e_history_dag where TIMESTAMP >= ?')],
      [4, 12, 1, 1, val('select avg(VERBR_GAS_X) from e_history_dag where TIMESTAMP >= ?')],
      [5, 17, this.waterPulse() ? 1 : 0, 1, val('select avg(VERBR_PER_TIMEUNIT) from watermeter where TIMEPERIOD_ID = 13 and TIMESTAMP >= ?')],
      [6, 2, 0, 2, val('select max(VERBR_KWH_X) from e_history_uur where TIMESTAMP >= ?')],
    ];
    const ins = this.stmt('insert or replace into statistics values (?,?,?,?,?,?,?,?)');
    for (const [id, dataId, active, mode, value] of rows) ins.run(id, dataId, active, from, ts, mode, value, ts);
  }

  /** Retention like the real ZTATZ cleanup jobs. */
  prune(d) {
    const ago = (days) => fmtLocal(new Date(d.getTime() - days * 86400000));
    const db = this.db;
    this.stmt('delete from e_serial where TIMESTAMP < ?').run(ago(7));
    this.stmt('delete from faseinformatie where TIMESTAMP < ?').run(ago(7));
    this.stmt('delete from temperatuur where RECORD_ID = 10 and TIMESTAMP < ?').run(ago(1));
    this.stmt('delete from temperatuur where RECORD_ID = 11 and TIMESTAMP < ?').run(ago(7));
    this.stmt('delete from e_history_min where TIMESTAMP < ?').run(ago(31));
    this.stmt('delete from watermeter where TIMEPERIOD_ID in (11, 21) and TIMESTAMP < ?').run(ago(31));
    this.stmt('delete from powerproduction where TIMEPERIOD_ID = 11 and TIMESTAMP < ?').run(ago(31));
    this.stmt('delete from weer where cast(TIMESTAMP as integer) < ?').run(unix(d) - 2 * 86400);
  }

  // ---------------------------------------------------------------------------
  // long history backfill (hourly resolution)
  // ---------------------------------------------------------------------------

  backfillHourly(from, to) {
    const m = this.meter;
    const sc = this.scenario;
    for (let t = from.getTime(); t < to.getTime(); t += 3600000) {
      const d = new Date(t);
      const a = hourlyAverages(d, sc.phases);
      const tariff = this.tariffAt(d);
      const both = Math.min(a.loadW, a.solarW) * 0.12;
      const imp = (Math.max(0, a.loadW - a.solarW) + both) / 1000;
      const exp = (Math.max(0, a.solarW - a.loadW) + both) / 1000;
      if (tariff === 'D') { m.t1 += imp; m.g1 += exp; } else { m.t2 += imp; m.g2 += exp; }
      if (sc.gas) {
        m.gasExact += a.gasM3;
        m.gasReading = r3(m.gasExact);
      }
      const hour = periodKey.hour(d);
      this.q.histHour.run(hour, r3(m.t1), r3(m.t2), r3(m.g1), r3(m.g2), r3(imp), r3(exp), tariff, sc.gas ? m.gasReading : 0);
      this.gasHour(d);

      if (this.waterPulse() || this.waterDigital()) {
        const litres = Math.round(a.waterL);
        m.waterM3 = r6(m.waterM3 + litres / 1000);
        m.waterPulseM3 = r6(m.waterPulseM3 + litres / 1000);
        if (this.waterPulse()) this.q.water.run(hour, 12, litres, litres, m.waterPulseM3);
        if (this.waterDigital()) this.q.water.run(hour, 22, 0, litres, r3(m.waterM3));
      }

      const solarKwh = a.solarW / 1000;
      const high = tariff === 'P';
      if (sc.s0Production) {
        const pulses = Math.round(solarKwh / 0.0005);
        const kwh = r6(pulses * 0.0005);
        if (high) m.s0High = r6(m.s0High + kwh); else m.s0Low = r6(m.s0Low + kwh);
        this.q.s0.run(hour, 12, high ? kwh : 0, high ? 0 : kwh, high ? pulses : 0, high ? 0 : pulses,
          m.s0High, m.s0Low, r6(m.s0High + m.s0Low), Number((kwh * 16.66).toFixed(6)));
      }
      if (sc.solarEdge) {
        const kwh = r3(solarKwh);
        if (high) m.seHigh = r3(m.seHigh + kwh); else m.seLow = r3(m.seLow + kwh);
        this.q.solar.run(hour, 22, high ? kwh : 0, high ? 0 : kwh, m.seHigh, m.seLow, r3(m.seHigh + m.seLow));
      }
      if (sc.heating) {
        const tin = Math.round(a.heating.tIn * 10) / 10;
        const tout = Math.round(a.heating.tOut * 10) / 10;
        this.q.temp.run(hour, 12, 0, tin, r3(tin - 1.5), r3(tin + 2), 0, tout, r3(tout - 1.5), r3(tout + 1.5));
      }
      const w = weather(new Date(t + 1800000));
      const temp = w.temperature;
      this.q.weerHour.run(hour, this.cfg(25), this.cityName(), r3(temp - 0.6), temp, r3(temp + 0.6), w.pressure - 1, w.pressure,
        w.pressure + 1, w.humidity - 3, w.humidity, w.humidity + 3, Math.max(0, r3(w.windSpeed - 1)), w.windSpeed,
        r3(w.windSpeed + 1.5), Math.max(0, w.windDegree - 15), w.windDegree, Math.min(359, w.windDegree + 15),
        r4(Math.max(0, (this.cfg(202) || 18) - temp) / 24));
      const p = prices(d);
      this.q.price.run(hour, p.kwh, p.gas);

      if (d.getHours() === 23) this.closeBackfillDay(d);
    }
  }

  closeBackfillDay(d) {
    this.rollupEnergy(d, 'hour');
    const cols = [['PULS_PER_TIMEUNIT', 'sum'], ['VERBR_PER_TIMEUNIT', 'sum'], ['VERBR_IN_M3_TOTAAL', 'max']];
    if (this.waterPulse()) this.rollupPeriods(d, 'watermeter', 11, 'hour', cols);
    if (this.waterDigital()) this.rollupPeriods(d, 'watermeter', 21, 'hour', cols);
    if (this.scenario.s0Production) {
      this.rollupPeriods(d, 'powerproduction', 11, 'hour', [
        ['PRODUCTION_KWH_HIGH', 'sum'], ['PRODUCTION_KWH_LOW', 'sum'], ['PULS_PER_TIMEUNIT_HIGH', 'sum'],
        ['PULS_PER_TIMEUNIT_LOW', 'sum'], ['PRODUCTION_KWH_HIGH_TOTAL', 'max'], ['PRODUCTION_KWH_LOW_TOTAL', 'max'],
        ['PRODUCTION_KWH_TOTAL', 'max'], ['PRODUCTION_PSEUDO_KW', 'sum']], 'and POWER_SOURCE_ID = 1');
    }
    if (this.scenario.solarEdge) this.rollupSolar(d, 'hour');
    if (this.scenario.heating) this.rollupTemperature(d, 'hour');
    this.rollupWeather(d);
    this.financial(d);

    // phase min/max for days without 10 s phase data
    const peak = 2200 + hashRandom('pk' + periodKey.day(d)) * 5000;
    const solarPeak = this.scenario.solarEdge || this.scenario.s0Production ? 1500 + hashRandom('sp' + periodKey.day(d)) * 2500 : 0;
    const one = this.scenario.phases === 1;
    const ph = (v, i) => (one && i > 0 ? 0 : v);
    const maxC = [0.5, 0.3, 0.4].map((f, i) => ph(r3((peak * (one ? 1 : f)) / 1000), i));
    const maxP = [1, 0, 0].map((f, i) => ph(r3((solarPeak * f) / 1000), i));
    const maxV = [0, 1, 2].map((i) => ph(Math.round((236 + hashRandom('vx' + i + d.getDate()) * 6) * 10) / 10, i));
    const maxA = maxC.map((kw, i) => ph(Math.round(Math.max(kw, maxP[i]) * 1000 / 230), i));
    const minV = [0, 1, 2].map((i) => ph(Math.round((222 + hashRandom('vn' + i + d.getDate()) * 5) * 10) / 10, i));
    this.q.minmax.run(periodKey.day(d), ...maxC, ...maxP, ...maxV, ...maxA, 0, 0, 0, 0, 0, 0, ...minV, 0, 0, 0);
  }

  // ---------------------------------------------------------------------------
  // P1 telegram (DSMR 5) and misc
  // ---------------------------------------------------------------------------

  telegram() {
    const l = this.last;
    if (!l) return '';
    const m = this.meter;
    const kwh = (x) => r3(x).toFixed(3).padStart(10, '0');
    const kw = (x) => x.toFixed(3).padStart(6, '0');
    const three = this.scenario.phases === 3;
    const lines = [
      '/ISK5\\2M550T-1012',
      '',
      '1-3:0.2.8(50)',
      '0-0:1.0.0(' + dsmrTimestamp(l.d) + ')',
      '0-0:96.1.1(4530303434303037313331363530363139)',
      '1-0:1.8.1(' + kwh(m.t1) + '*kWh)',
      '1-0:1.8.2(' + kwh(m.t2) + '*kWh)',
      '1-0:2.8.1(' + kwh(m.g1) + '*kWh)',
      '1-0:2.8.2(' + kwh(m.g2) + '*kWh)',
      '0-0:96.14.0(' + (l.tariff === 'P' ? '0002' : '0001') + ')',
      '1-0:1.7.0(' + kw(l.actC) + '*kW)',
      '1-0:2.7.0(' + kw(l.actP) + '*kW)',
      '0-0:96.7.21(00012)',
      '0-0:96.7.9(00004)',
      '1-0:99.97.0(1)(0-0:96.7.19)(230412103208S)(0000000262*s)',
      '1-0:32.32.0(00003)',
    ];
    if (three) lines.push('1-0:52.32.0(00002)', '1-0:72.32.0(00002)');
    lines.push('0-0:96.13.0()');
    const phaseLines = (fmt, obis) => obis.slice(0, three ? 3 : 1).map((o, i) => '1-0:' + o + '(' + fmt(i) + ')');
    lines.push(...phaseLines((i) => l.volts[i].toFixed(1).padStart(5, '0') + '*V', ['32.7.0', '52.7.0', '72.7.0']));
    lines.push(...phaseLines((i) => String(l.amps[i]).padStart(3, '0') + '*A', ['31.7.0', '51.7.0', '71.7.0']));
    lines.push(...phaseLines((i) => kw(l.consKw[i]) + '*kW', ['21.7.0', '41.7.0', '61.7.0']));
    lines.push(...phaseLines((i) => kw(l.prodKw[i]) + '*kW', ['22.7.0', '42.7.0', '62.7.0']));
    if (this.scenario.gas) {
      const gasTime = new Date(l.d.getTime() - (l.d.getMinutes() % 5) * 60000 - l.d.getSeconds() * 1000);
      lines.push('0-1:24.1.0(003)', '0-1:96.1.0(4730303339303031393336393930363139)',
        '0-1:24.2.1(' + dsmrTimestamp(gasTime) + ')(' + l.gasReading.toFixed(3).padStart(9, '0') + '*m3)');
    }
    if (this.waterDigital()) {
      lines.push('0-2:24.1.0(007)', '0-2:96.1.0(3253313031303930323033353637)',
        '0-2:24.2.1(' + dsmrTimestamp(l.d) + ')(' + l.waterReading.toFixed(3).padStart(9, '0') + '*m3)');
    }
    const body = lines.join('\r\n') + '\r\n!';
    lines.push('!' + crc16(body));
    return lines.join('\n') + '\n';
  }

  wifiNetworks() {
    return ['Ziggo1234567', 'KPN-A1B2C3', 'p1mon-guest', 'H369A9F0E12', 'Ziggo1234567'];
  }

  snapshot() {
    return {
      now: fmtLocal(this.clock.now()),
      speed: this.clock.speed,
      tariff: this.last ? this.last.tariff : null,
      consumptionW: this.last ? Math.round(this.last.actC * 1000) : 0,
      productionW: this.last ? Math.round(this.last.actP * 1000) : 0,
      gasM3: this.last ? this.last.gasReading : 0,
      meter: Object.fromEntries(Object.entries(this.meter).map(([k, v]) => [k, r3(v)])),
    };
  }
}

/** CRC16/ARC as used by DSMR P1 telegrams. */
function crc16(text) {
  let crc = 0;
  for (const byte of Buffer.from(text, 'latin1')) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Uptime text like P1Watchdog: "N dagen HH:MM:SS" / "1 dag HH:MM:SS" / "HH:MM:SS". */
function uptime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(s / 86400);
  const hms = pad(Math.floor((s % 86400) / 3600)) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(s % 60);
  if (days === 0) return hms;
  return days + (days === 1 ? ' dag ' : ' dagen ') + hms;
}

module.exports = { Simulator, crc16, uptime, P1_VERSION };
