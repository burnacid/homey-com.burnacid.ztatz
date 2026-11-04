'use strict';

/** Scenario switches, editable at runtime via /emulator (control page) or /emulator/api/scenario. */
const DEFAULTS = Object.freeze({
  // ok | offline (connection dropped) | html (nginx error page) | error500 | slow (delay responses)
  availability: 'ok',
  slowSeconds: 15,
  // every data route returns [] (e.g. a freshly wiped ZTATZ database)
  emptyData: false,
  // 1 or 3 phase meter; legacy_v241 uses the old L3 labels from ZTATZ 2.4.1 ("... L2 (71.7.0)")
  phases: 3,
  phaseLabels: 'current',
  // none | pulse (TIMEPERIOD 11-15, /api/v2/watermeter) | digital (P1 telegram, 21-25) | both
  water: 'pulse',
  gas: true,
  heating: true,
  s0Production: true,
  solarEdge: true,
  // auto = house model; manual = fixed consumption/production in W
  power: { mode: 'auto', consumptionW: 450, productionW: 0 },
  // auto (P weekdays 07-23, D otherwise) | P | D
  tariff: 'auto',
  // fill the "Laatste P1 monitor versie ..." status rows with a newer version
  newVersion: false,
  // simulated time multiplier
  speed: 1,
});

const ENUMS = {
  availability: ['ok', 'offline', 'html', 'error500', 'slow'],
  phaseLabels: ['current', 'legacy_v241'],
  water: ['none', 'pulse', 'digital', 'both'],
  tariff: ['auto', 'P', 'D'],
};

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

/** Validate and merge a (partial) scenario update; throws on bad input. */
function merge(current, update) {
  const next = clone(current);
  for (const [key, value] of Object.entries(update || {})) {
    if (!(key in DEFAULTS)) throw new Error('unknown scenario key: ' + key);
    if (ENUMS[key]) {
      if (!ENUMS[key].includes(value)) throw new Error(key + ' must be one of ' + ENUMS[key].join(', '));
      next[key] = value;
    } else if (key === 'phases') {
      if (![1, 3].includes(Number(value))) throw new Error('phases must be 1 or 3');
      next.phases = Number(value);
    } else if (key === 'power') {
      const p = { ...next.power, ...value };
      if (!['auto', 'manual'].includes(p.mode)) throw new Error('power.mode must be auto or manual');
      p.consumptionW = Math.max(0, Number(p.consumptionW) || 0);
      p.productionW = Math.max(0, Number(p.productionW) || 0);
      next.power = p;
    } else if (key === 'speed') {
      const s = Number(value);
      if (!(s > 0 && s <= 3600)) throw new Error('speed must be between 0 and 3600');
      next.speed = s;
    } else if (key === 'slowSeconds') {
      next.slowSeconds = Math.min(300, Math.max(0, Number(value) || 0));
    } else {
      next[key] = Boolean(value);
    }
  }
  return next;
}

module.exports = { DEFAULTS, ENUMS, merge, clone };
