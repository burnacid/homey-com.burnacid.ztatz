'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { dumps, int } = require('./pyjson');
const { items, pyInt, pyAbs, validateTimestamp, validateTimestampByLength, cleanTimestampStr } = require('./params');
const { apiError, santizeHtml, API_PARAMETER_ERROR, API_TIMESTAMP_ERROR, API_DB_ERROR, API_GENERAL_ERROR } = require('./errors');

const DATA_DIR = path.join(__dirname, '..', 'data');

// Keep Python int vs float apart: a JSON number without '.', 'e' is a Python int.
function loadPy(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'), (key, value, ctx) => {
    if (typeof value === 'number' && ctx && ctx.source && !/[.eE]/.test(ctx.source)) return int(value);
    return value;
  }).data;
}

const HELP = loadPy('help.json');
const SQL = loadPy('sql.json');

/** json.dumps(apiconst.HELP_X, sort_keys=True, indent=2) */
function help(name) {
  if (!HELP[name]) throw apiError(API_GENERAL_ERROR, santizeHtml(name));
  return dumps(HELP[name], { sortKeys: true, indent: 2, ensureAscii: true });
}

function limitClause(value) {
  try {
    return ' limit ' + pyAbs(pyInt(value)).toString();
  } catch {
    throw apiError(API_PARAMETER_ERROR, santizeHtml('limit value not ok, value used is ' + value));
  }
}

function timestampError(value) {
  return apiError(API_TIMESTAMP_ERROR, santizeHtml(value));
}

/** Run a ZTATZ select and serialize it in array or object mode. */
function query(ctx, sql, keys, jsonMode) {
  let rows;
  try {
    const st = ctx.db.prepare(sql);
    st.setReadBigInts(true);
    st.setReturnArrays(true);
    rows = st.all();
  } catch (e) {
    throw apiError(API_DB_ERROR, santizeHtml(e.message + ' query used: ' + sql));
  }
  if (ctx.scenario && ctx.scenario.emptyData) rows = [];
  if (jsonMode === 'object') {
    const objs = rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i]])));
    return dumps(objs, { sortKeys: true, ensureAscii: false });
  }
  return dumps(rows, { ensureAscii: false });
}

/**
 * Generic port of the ZTATZ time-series on_get() loop.
 *
 * spec:
 *   regular / round  base SELECT strings (table already appended)
 *   mid              text between base and the tail (fixed WHERE), default ''
 *   keys             object-mode keys in column order
 *   start            null | { style: 'length' | 'strict', clause: v => sql }
 *                    'length': validate_timestamp_by_length, error on invalid, clears range
 *                    'strict': clean_timestamp_str + validate_timestamp, ignored when invalid
 *   range            null | { clause: (v) => sql }  (validated by length, error, clears start)
 *   collapse         " ".join(sql.split())
 */
function runSeries(ctx, spec) {
  let sql = spec.regular;
  let vLimit = '';
  let vSort = 'DESC';
  let vJson = '';
  let vStart = ' order by timestamp ';
  let vRange = '';

  for (const [key, value] of items(ctx.params)) {
    if (key === 'limit') vLimit = limitClause(value);
    if (key === 'sort' && value.toLowerCase() === 'asc') vSort = 'ASC';
    if (key === 'json' && value.toLowerCase() === 'object') vJson = 'object';
    if (key === 'round' && value.toLowerCase() === 'on') sql = spec.round;
    if (key === 'starttime' && spec.start) {
      if (spec.start.style === 'length') {
        vRange = '';
        if (!validateTimestampByLength(value)) throw timestampError(value);
        vStart = spec.start.clause(value);
      } else {
        const v = cleanTimestampStr(value);
        if (validateTimestamp(v)) vStart = spec.start.clause(v);
      }
    }
    if (key === 'range' && spec.range) {
      vStart = '';
      if (!validateTimestampByLength(value)) throw timestampError(value);
      vRange = spec.range.clause(value);
    }
  }

  let full = sql + (spec.mid || '') + vStart + vRange + vSort + vLimit;
  if (spec.collapse) full = full.trim().split(/\s+/).join(' ');
  return query(ctx, full, spec.keys, vJson);
}

/** Common starttime / range clause builders. */
const clauses = {
  andStart: (v) => " and TIMESTAMP >= '" + v + "' order by timestamp ",
  andRange: (v) => ' and substr(timestamp,1,' + Array.from(v).length + ") = '" + v + "' order by timestamp ",
  whereStart: (v) => " where TIMESTAMP >= '" + v + "' order by timestamp ",
  whereRange: (v) => ' where substr(timestamp,1,' + Array.from(v).length + ") = '" + v + "' order by timestamp ",
  whereStartNoSpace: (v) => "where TIMESTAMP >= '" + v + "' order by timestamp ",
  whereRangeNoSpace: (v) => 'where substr(timestamp,1,' + Array.from(v).length + ") = '" + v + "' order by timestamp ",
};

/** Only the `json` parameter (Status, Config, datetime, wifi, p1port, ...). */
function jsonMode(params) {
  let mode = '';
  for (const [key, value] of items(params)) {
    if (key === 'json' && value.toLowerCase() === 'object') mode = 'object';
  }
  return mode;
}

module.exports = { SQL, HELP, help, runSeries, query, clauses, jsonMode, limitClause };
