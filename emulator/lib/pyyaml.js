'use strict';

/**
 * Minimal emulation of PyYAML's yaml.dump() for a flat {str: str} mapping,
 * which is all ZTATZ needs for its error bodies (falcon error -> to_dict()).
 * Keys are sorted, scalars use plain / single-quoted / double-quoted style
 * following PyYAML's rules, and long scalars are folded at 80 columns.
 */

const BEST_WIDTH = 80;
const INDENT = 2;

// YAML 1.1 implicit resolvers (PyYAML's Resolver) for plain scalars that
// would NOT be read back as a string and therefore must be quoted.
const IMPLICIT = [
  /^(?:yes|Yes|YES|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF)$/,
  /^(?:[-+]?(?:[0-9][0-9_]*)\.[0-9_]*(?:[eE][-+][0-9]+)?|\.[0-9][0-9_]*(?:[eE][-+][0-9]+)?|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/,
  /^(?:[-+]?0b[0-1_]+|[-+]?0[0-7_]+|[-+]?(?:0|[1-9][0-9_]*)|[-+]?0x[0-9a-fA-F_]+|[-+]?[1-9][0-9_]*(?::[0-5]?[0-9])+)$/,
  /^(?:<<)$/,
  /^(?:~|null|Null|NULL|)$/,
  /^(?:[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]|[0-9][0-9][0-9][0-9]-[0-9][0-9]?-[0-9][0-9]?(?:[Tt]|[ \t]+)[0-9][0-9]?:[0-9][0-9]:[0-9][0-9](?:\.[0-9]*)?(?:[ \t]*(?:Z|[-+][0-9][0-9]?(?::[0-9][0-9])?))?)$/,
  /^(?:=)$/,
];

function isPrintableAscii(ch) {
  const c = ch.charCodeAt(0);
  return c === 0x09 || c === 0x0a || c === 0x0d || (c >= 0x20 && c <= 0x7e);
}

// Port of the relevant parts of Emitter.analyze_scalar().
function analyze(s) {
  if (s === '') return { plain: false, single: true };
  let blockIndicators = false;
  let specialChars = false;
  let lineBreaks = false;
  let leadingSpace = false;
  let trailingSpace = false;
  let spaceBreak = false;

  if (s.startsWith('---') || s.startsWith('...')) blockIndicators = true;

  let precededByWhitespace = true;
  const chars = Array.from(s);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = chars[i + 1];
    const followedByWhitespace = next === undefined || ' \t\r\n'.includes(next);
    if (i === 0) {
      if ('#,[]{}&*!|>\'"%@`'.includes(ch)) blockIndicators = true;
      if ((ch === '?' || ch === ':' || ch === '-') && followedByWhitespace) blockIndicators = true;
    } else {
      if (ch === ':' && followedByWhitespace) blockIndicators = true;
      if (ch === '#' && precededByWhitespace) blockIndicators = true;
    }
    if (ch === '\n') lineBreaks = true;
    if (!isPrintableAscii(ch)) specialChars = true;
    if (ch === ' ') {
      if (i === 0) leadingSpace = true;
      if (i === chars.length - 1) trailingSpace = true;
    }
    precededByWhitespace = ' \t\r\n'.includes(ch);
  }

  let plain = !(leadingSpace || trailingSpace || spaceBreak || lineBreaks || specialChars || blockIndicators);
  if (plain && IMPLICIT.some((re) => re.test(s))) plain = false;
  return { plain, single: !specialChars && !lineBreaks };
}

// Emitter.write_plain / write_single_quoted folding: a single space is turned
// into a line break once the column is past BEST_WIDTH.
function fold(text, startColumn, quoteChar) {
  let out = '';
  let column = startColumn;
  let start = 0;
  let spaces = false;
  for (let end = 0; end <= text.length; end++) {
    const ch = end < text.length ? text[end] : null;
    if (spaces) {
      if (ch !== ' ') {
        if (start + 1 === end && column > BEST_WIDTH && start !== 0 && end !== text.length) {
          out += '\n' + ' '.repeat(INDENT);
          column = INDENT;
        } else {
          out += text.slice(start, end);
          column += end - start;
        }
        start = end;
      }
    } else if (ch === null || ch === ' ' || ch === quoteChar) {
      if (start < end) {
        out += text.slice(start, end);
        column += end - start;
        start = end;
      }
    }
    if (quoteChar && ch === quoteChar) {
      out += "''";
      column += 2;
      start = end + 1;
    }
    if (ch !== null) spaces = ch === ' ';
  }
  return out;
}

function doubleQuoted(s) {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '"' || ch === '\\') out += '\\' + ch;
    else if (isPrintableAscii(ch) && ch !== '\n' && ch !== '\r' && ch !== '\t') out += ch;
    else if (c <= 0xff) out += '\\x' + c.toString(16).toUpperCase().padStart(2, '0');
    else if (c <= 0xffff) out += '\\u' + c.toString(16).toUpperCase().padStart(4, '0');
    else out += '\\U' + c.toString(16).toUpperCase().padStart(8, '0');
  }
  return out + '"';
}

function dumpMapping(obj) {
  let out = '';
  for (const key of Object.keys(obj).sort()) {
    const value = String(obj[key]);
    const prefix = key + ':';
    const a = analyze(value);
    if (a.plain) {
      out += prefix + ' ' + fold(value, prefix.length + 1, null) + '\n';
    } else if (a.single) {
      out += prefix + " '" + fold(value, prefix.length + 2, "'") + "'\n";
    } else {
      out += prefix + ' ' + doubleQuoted(value) + '\n';
    }
  }
  return out;
}

module.exports = { dumpMapping };
