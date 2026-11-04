'use strict';

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** Local 'YYYY-MM-DD HH:MM:SS' (util.mkLocalTimeString). */
function fmtLocal(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

/** Period keys following the ZTATZ timestamp conventions. */
const periodKey = {
  second: (d) => fmtLocal(d),
  minute: (d) => fmtLocal(d).slice(0, 16) + ':00',
  hour: (d) => fmtLocal(d).slice(0, 13) + ':00:00',
  day: (d) => fmtLocal(d).slice(0, 10) + ' 00:00:00',
  month: (d) => fmtLocal(d).slice(0, 7) + '-01 00:00:00',
  year: (d) => fmtLocal(d).slice(0, 4) + '-01-01 00:00:00',
};

const unix = (d) => Math.floor(d.getTime() / 1000);

function daysInMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/** DSMR timestamp YYMMDDhhmmssX (X = S summer / W winter). */
function dsmrTimestamp(d) {
  const jan = new Date(d.getFullYear(), 0, 1).getTimezoneOffset();
  const dst = d.getTimezoneOffset() < jan;
  return pad(d.getFullYear() % 100) + pad(d.getMonth() + 1) + pad(d.getDate()) +
    pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + (dst ? 'S' : 'W');
}

/**
 * Simulated clock. Sim time runs at `speed` x real time and can be jumped
 * forward (the simulator fast-forwards so no data gaps appear).
 */
class Clock {
  constructor(speed = 1) {
    this.speed = speed;
    this.baseReal = Date.now();
    this.baseSim = Date.now();
  }

  now() {
    return new Date(this.baseSim + (Date.now() - this.baseReal) * this.speed);
  }

  setSpeed(speed) {
    const now = this.now().getTime();
    this.baseReal = Date.now();
    this.baseSim = now;
    this.speed = speed;
  }

  setNow(date) {
    this.baseReal = Date.now();
    this.baseSim = date.getTime();
  }
}

module.exports = { fmtLocal, periodKey, unix, daysInMonth, dsmrTimestamp, Clock, pad };
