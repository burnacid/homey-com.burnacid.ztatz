'use strict';

const { pyStrRepr } = require('./pyjson');

/**
 * falcon req.params: ordered by first appearance, a repeated key becomes a list
 * and ZTATZ only ever uses the first value (apiutil.list_filter_to_str).
 * Blank values are kept ("?round" -> round = "").
 */
function parseQuery(queryString) {
  const params = new Map();
  if (!queryString) return params;
  const decode = (s) => {
    try {
      return decodeURIComponent(s.replace(/\+/g, ' '));
    } catch {
      return s;
    }
  };
  for (const field of queryString.split('&')) {
    const idx = field.indexOf('=');
    const k = decode(idx === -1 ? field : field.slice(0, idx));
    const v = decode(idx === -1 ? '' : field.slice(idx + 1));
    if (!params.has(k)) params.set(k, v);
  }
  return params;
}

/** Iterate params like ZTATZ does: `for key, value in req.params.items(): key = key.lower()`. */
function* items(params) {
  for (const [k, v] of params) yield [k.toLowerCase(), v];
}

/**
 * Python int(value[, 10]). Returns a BigInt, or throws an Error whose message
 * matches Python's ValueError text.
 */
function pyInt(value) {
  const s = String(value);
  if (/^[\s]*[+-]?\d+(?:_\d+)*[\s]*$/.test(s)) {
    return BigInt(s.trim().replace(/_/g, ''));
  }
  throw new Error('invalid literal for int() with base 10: ' + pyStrRepr(s));
}

const pyAbs = (n) => (n < 0n ? -n : n);

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// apiutil.validate_timestamp — exact 'YYYY-MM-DD HH:MM:SS' that survives a
// strptime/strftime round trip (Linux strftime: no zero padding for year < 1000).
function validateTimestamp(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  if (y < 1000) return false;
  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > daysInMonth(y, mo)) return false;
  return h <= 23 && mi <= 59 && se <= 59;
}

// apiutil.validate_timestamp_by_length
function validateTimestampByLength(s) {
  const padding = '2000-01-01 00:00:00';
  return validateTimestamp(s + padding.slice(s.length));
}

// apiutil.clean_timestamp_str
function cleanTimestampStr(s) {
  return String(s).replace(/[^-:0-9 ]/g, '');
}

module.exports = {
  parseQuery,
  items,
  pyInt,
  pyAbs,
  validateTimestamp,
  validateTimestampByLength,
  cleanTimestampStr,
};
