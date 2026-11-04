'use strict';

/**
 * Emulates Python's json.dumps() output, as used by the ZTATZ API.
 *
 * Value mapping (rows come from node:sqlite with setReadBigInts(true)):
 *   BigInt          -> Python int    (12)
 *   Number          -> Python float  (12.0, 1e-05, 1e+16)
 *   PyInt wrapper   -> Python int    (for computed values that are ints in Python)
 *   null/undefined  -> null
 */

class PyInt {
  constructor(value) { this.value = value; }
}
const int = (v) => new PyInt(v);

// Python repr() of a float: shortest round-trip digits, fixed notation when
// -4 <= exponent < 16, otherwise scientific with at least two exponent digits.
function floatRepr(x) {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Infinity';
  if (x === -Infinity) return '-Infinity';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';

  const [mant, expStr] = x.toExponential().split('e');
  const exp = parseInt(expStr, 10);
  const neg = mant.startsWith('-');
  const digits = mant.replace('-', '').replace('.', '');

  let out;
  if (exp >= -4 && exp < 16) {
    if (exp >= 0) {
      const intPart = digits.slice(0, exp + 1).padEnd(exp + 1, '0');
      const frac = digits.slice(exp + 1) || '0';
      out = intPart + '.' + frac;
    } else {
      out = '0.' + '0'.repeat(-exp - 1) + digits;
    }
  } else {
    const m = digits.length > 1 ? digits[0] + '.' + digits.slice(1) : digits;
    const e = Math.abs(exp).toString().padStart(2, '0');
    out = m + 'e' + (exp < 0 ? '-' : '+') + e;
  }
  return (neg ? '-' : '') + out;
}

function strRepr(s, ensureAscii) {
  let out = JSON.stringify(s);
  if (ensureAscii) {
    out = out.replace(/[\u007f-￿]/g, (c) => {
      const code = c.charCodeAt(0);
      return code === 0x7f ? c : '\\u' + code.toString(16).padStart(4, '0');
    });
  }
  return out;
}

function dumps(value, opts = {}) {
  const { sortKeys = false, indent = null, ensureAscii = true } = opts;
  const itemSep = indent === null ? ', ' : ',';
  const keySep = ': ';

  function enc(v, level) {
    if (v === null || v === undefined) return 'null';
    if (v instanceof PyInt) return String(v.value);
    switch (typeof v) {
      case 'bigint': return v.toString();
      case 'number': return floatRepr(v);
      case 'boolean': return v ? 'true' : 'false';
      case 'string': return strRepr(v, ensureAscii);
    }
    const nl = indent === null ? '' : '\n' + ' '.repeat(indent * (level + 1));
    const nlEnd = indent === null ? '' : '\n' + ' '.repeat(indent * level);
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]';
      return '[' + nl + v.map((x) => enc(x, level + 1)).join(itemSep + nl) + nlEnd + ']';
    }
    let keys = Object.keys(v);
    if (keys.length === 0) return '{}';
    if (sortKeys) keys = keys.sort();
    return '{' + nl + keys.map((k) => strRepr(k, ensureAscii) + keySep + enc(v[k], level + 1)).join(itemSep + nl) + nlEnd + '}';
  }
  return enc(value, 0);
}

// Python repr() of a str, as used in exception messages such as
// "invalid literal for int() with base 10: 'abc'".
function pyStrRepr(s) {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let body = '';
  for (const ch of s) {
    if (ch === '\\') body += '\\\\';
    else if (ch === quote) body += '\\' + ch;
    else if (ch === '\n') body += '\\n';
    else if (ch === '\r') body += '\\r';
    else if (ch === '\t') body += '\\t';
    else if (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f) body += '\\x' + ch.charCodeAt(0).toString(16).padStart(2, '0');
    else body += ch;
  }
  return quote + body + quote;
}

module.exports = { dumps, floatRepr, int, PyInt, pyStrRepr };
