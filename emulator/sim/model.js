'use strict';

/**
 * House model for the simulator: electricity load (per phase), solar
 * production, gas, water, central heating temperatures, outdoor weather and
 * dynamic energy prices. Everything is a function of (simulated) time plus a
 * small amount of randomness, so data looks plausible over days and seasons.
 */

// Deterministic pseudo random number in [0, 1) for a string key (per day / hour values).
function hashRandom(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dayKey = (d) => d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
const hourKey = (d) => dayKey(d) + 'h' + d.getHours();
const hours = (d) => d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
const dayOfYear = (d) => Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
const isDst = (d) => d.getTimezoneOffset() < new Date(d.getFullYear(), 0, 1).getTimezoneOffset();
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

// --- weather -------------------------------------------------------------------

/** Cloudiness 0 (clear) .. 1 (overcast) for this hour, smooth within a day. */
function cloudiness(d) {
  const dayType = hashRandom('cloud' + dayKey(d)); // sunny .. grey day
  const hourVar = hashRandom('cloudh' + hourKey(d)) - 0.5;
  return Math.min(1, Math.max(0, dayType * 0.9 + hourVar * 0.3));
}

function outdoorTemperature(d) {
  const doy = dayOfYear(d);
  const seasonal = 10.5 - 7.5 * Math.cos((2 * Math.PI * (doy - 15)) / 365);
  const diurnal = 4 * Math.sin((2 * Math.PI * (hours(d) - 9)) / 24);
  const dayOffset = (hashRandom('temp' + dayKey(d)) - 0.5) * 6;
  const clouds = cloudiness(d);
  return seasonal + diurnal * (1 - clouds * 0.5) + dayOffset;
}

function weather(d) {
  const clouds = cloudiness(d);
  const rain = clouds > 0.85 && hashRandom('rain' + hourKey(d)) > 0.4;
  let description;
  let icon;
  let id;
  if (rain) [description, icon, id] = ['lichte regen', '10', 500];
  else if (clouds < 0.15) [description, icon, id] = ['onbewolkt', '01', 800];
  else if (clouds < 0.4) [description, icon, id] = ['licht bewolkt', '02', 801];
  else if (clouds < 0.7) [description, icon, id] = ['half bewolkt', '03', 802];
  else [description, icon, id] = ['zwaar bewolkt', '04', 804];
  const h = hours(d);
  const day = h > 7 && h < 20;
  return {
    temperature: Math.round(outdoorTemperature(d) * 100) / 100,
    description,
    icon: icon + (day ? 'd' : 'n'),
    weatherId: id,
    pressure: Math.round(1013 + (hashRandom('pres' + dayKey(d)) - 0.5) * 30 + (hashRandom('presh' + hourKey(d)) - 0.5) * 3),
    humidity: Math.round(Math.min(99, 55 + clouds * 35 + (hashRandom('hum' + hourKey(d)) - 0.5) * 10)),
    windSpeed: Math.round((1 + hashRandom('wind' + dayKey(d)) * 7 + (hashRandom('windh' + hourKey(d)) - 0.5) * 2) * 100) / 100,
    windDegree: Math.round((hashRandom('wdir' + dayKey(d)) * 360 + (hashRandom('wdirh' + hourKey(d)) - 0.5) * 40 + 360) % 360),
    clouds: Math.round(clouds * 100),
  };
}

// --- solar -----------------------------------------------------------------------

const SOLAR_PEAK_W = 4200;

/** Solar production in W (without the short-term noise). */
function solarPower(d) {
  const doy = dayOfYear(d);
  const dayLength = 12 + 4.3 * Math.sin((2 * Math.PI * (doy - 80)) / 365);
  const noon = 12.7 + (isDst(d) ? 1 : 0);
  const sunrise = noon - dayLength / 2;
  const h = hours(d);
  if (h <= sunrise || h >= sunrise + dayLength) return 0;
  const elevation = Math.sin((Math.PI * (h - sunrise)) / dayLength);
  const season = 0.45 + 0.4 * Math.sin((2 * Math.PI * (doy - 80)) / 365);
  const clouds = cloudiness(d);
  return SOLAR_PEAK_W * season * Math.pow(elevation, 1.3) * (1 - clouds * 0.75);
}

// --- electricity load ---------------------------------------------------------

/** Expected (smooth) base load profile in W, without appliance events. */
function baseLoad(d) {
  const h = hours(d);
  let w = 180; // always-on: fridge, router, standby
  if (h >= 6.5 && h < 9) w += 250; // morning
  if (h >= 12 && h < 13.5 && isWeekend(d)) w += 300; // weekend lunch
  if (h >= 17 && h < 23) w += 350; // evening lights, tv
  if (h >= 17.5 && h < 18.5) w += 900; // cooking
  if (h >= 23 || h < 6.5) w -= 40;
  return w;
}

// Appliances that start randomly: [name, watts, minutes, phase, startsPerDay, activeHours]
const APPLIANCES = [
  ['kettle', 2200, 3, 0, 4, [6, 23]],
  ['microwave', 1100, 4, 0, 2, [7, 22]],
  ['washing machine', 2000, 25, 1, 0.5, [8, 20]],
  ['dryer', 2400, 60, 1, 0.3, [10, 21]],
  ['dishwasher', 1900, 40, 2, 0.8, [19, 23]],
  ['oven', 2800, 35, 2, 0.3, [17, 19]],
  ['vacuum', 1200, 20, 0, 0.3, [9, 18]],
  ['ev charger', 3680, 120, 2, 0.15, [18, 23]],
];

const appliancePhases = (phase, phases) => (phases === 1 ? 0 : phase);

class House {
  constructor(seed = 42) {
    this.rand = mulberry32(seed);
    this.events = []; // { name, watts, phase, until }
    this.fridgeOn = false;
    this.fridgeToggle = 0;
    this.waterEvents = []; // { lpm, until }
    this.gasEvents = []; // { m3PerMin, until }
  }

  /**
   * Instantaneous state for a tick of `dt` seconds ending at `d`.
   * Returns per-phase load and solar (W), plus gas (m3) and water (L) used in dt.
   */
  step(d, dt, phases) {
    const t = d.getTime();
    const h = hours(d);
    const rnd = this.rand;

    // appliance events
    this.events = this.events.filter((e) => e.until > t);
    for (const [name, watts, minutes, phase, perDay, [from, to]] of APPLIANCES) {
      if (h < from || h >= to || this.events.some((e) => e.name === name)) continue;
      const p = (perDay / ((to - from) * 3600)) * dt;
      if (rnd() < p) {
        this.events.push({ name, watts, phase: appliancePhases(phase, phases), until: t + minutes * 60000 });
        if (name === 'washing machine') this.waterEvents.push({ lpm: 2.5, until: t + minutes * 60000 });
        if (name === 'dishwasher') this.waterEvents.push({ lpm: 0.4, until: t + minutes * 60000 });
      }
    }
    // fridge compressor cycle
    if (t >= this.fridgeToggle) {
      this.fridgeOn = !this.fridgeOn;
      this.fridgeToggle = t + (this.fridgeOn ? 12 : 25) * 60000 * (0.8 + rnd() * 0.4);
    }

    const load = [0, 0, 0];
    const base = baseLoad(d) + (rnd() - 0.5) * 30;
    if (phases === 1) load[0] = base;
    else {
      load[0] = base * 0.5;
      load[1] = base * 0.3;
      load[2] = base * 0.2;
    }
    if (this.fridgeOn) load[phases === 1 ? 0 : 1] += 90;
    for (const e of this.events) load[e.phase] += e.watts;

    // solar inverter on L1 (single phase inverter)
    const solar = [0, 0, 0];
    const s = solarPower(d);
    if (s > 0) solar[0] = Math.max(0, s * (0.97 + rnd() * 0.06));

    // water: showers, toilet, taps
    this.waterEvents = this.waterEvents.filter((e) => e.until > t);
    const perTick = (perDay, from, to) => (h >= from && h < to ? (perDay / ((to - from) * 3600)) * dt : 0);
    if (rnd() < perTick(1.5, 6.5, 9) + perTick(0.5, 19, 23)) {
      const minutes = 6 + rnd() * 6;
      this.waterEvents.push({ lpm: 8, until: t + minutes * 60000 });
      this.gasEvents.push({ m3PerMin: 0.018, until: t + minutes * 60000 });
    }
    if (rnd() < perTick(8, 6, 24)) this.waterEvents.push({ lpm: 6, until: t + 60000 }); // toilet
    if (rnd() < perTick(10, 7, 23)) this.waterEvents.push({ lpm: 4, until: t + 30000 }); // tap
    let waterL = 0;
    for (const e of this.waterEvents) waterL += (e.lpm * dt) / 60;

    // gas: central heating depending on outdoor temperature, plus hot water
    this.gasEvents = this.gasEvents.filter((e) => e.until > t);
    const heating = heatingDemand(d);
    let gasM3 = (heating.m3PerHour * dt) / 3600;
    if (h >= 17.5 && h < 18.25) gasM3 += (0.15 * dt) / 3600; // cooking
    for (const e of this.gasEvents) gasM3 += (e.m3PerMin * dt) / 60;

    return { load, solar, gasM3, waterL, heating };
  }
}

/** Central heating: gas use and supply/return temperatures ("in"/"out"). */
function heatingDemand(d) {
  const h = hours(d);
  const tOut = outdoorTemperature(d);
  const setpoint = h >= 6.5 && h < 22.5 ? 20 : 16;
  const demand = Math.max(0, setpoint - 2 - tOut) / 20; // 0..~1
  const active = demand > 0.05;
  const supply = active ? Math.min(65, 32 + demand * 40) : 24;
  return {
    m3PerHour: active ? 0.04 + demand * 0.5 : 0,
    tIn: supply,
    tOut: active ? supply - 6 - demand * 4 : supply - 1.5,
  };
}

/** Dynamic electricity / gas prices (EUR) for the hour starting at `d`. */
function prices(d) {
  const h = d.getHours();
  let kwh = 0.085;
  if (h >= 7 && h < 9) kwh += 0.03;
  if (h >= 17 && h < 21) kwh += 0.07;
  if (h >= 0 && h < 6) kwh -= 0.015;
  const solar = solarPower(new Date(d.getTime() + 30 * 60000)) / SOLAR_PEAK_W;
  kwh -= solar * 0.11;
  kwh += (hashRandom('price' + hourKey(d)) - 0.5) * 0.03;
  const gas = 0.52 + (hashRandom('gas' + dayKey(d)) - 0.5) * 0.06;
  return { kwh: Math.round(kwh * 100000) / 100000, gas: Math.round(gas * 100000) / 100000 };
}

/**
 * Expected hourly averages, used for the long history backfill where a
 * 10-second simulation would be too slow.
 */
function hourlyAverages(d, phases) {
  const samples = 6;
  let loadW = 0;
  let solarW = 0;
  for (let i = 0; i < samples; i++) {
    const s = new Date(d.getTime() + (i + 0.5) * (3600000 / samples));
    loadW += baseLoad(s) + 90 / 3;
    solarW += solarPower(s);
  }
  loadW /= samples;
  solarW /= samples;
  // average appliance energy spread over their active hours
  const h = d.getHours();
  for (const [, watts, minutes, , perDay, [from, to]] of APPLIANCES) {
    if (h >= from && h < to) loadW += (watts * minutes * perDay) / 60 / (to - from);
  }
  loadW *= 0.85 + hashRandom('load' + hourKey(d)) * 0.3;
  const heating = heatingDemand(new Date(d.getTime() + 1800000));
  let gasM3 = heating.m3PerHour;
  if (h >= 6 && h < 9) gasM3 += 0.12;
  if (h >= 17 && h < 19) gasM3 += 0.08;
  let waterL = 0;
  if (h >= 6 && h < 9) waterL += 30;
  if (h >= 7 && h < 23) waterL += 8;
  if (h >= 19 && h < 23) waterL += 10;
  waterL *= 0.7 + hashRandom('water' + hourKey(d)) * 0.6;
  return { loadW, solarW, gasM3, waterL, heating, phases };
}

module.exports = {
  House,
  weather,
  outdoorTemperature,
  solarPower,
  heatingDemand,
  prices,
  hourlyAverages,
  hashRandom,
  isWeekend,
};
