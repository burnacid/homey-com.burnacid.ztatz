'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { fmtLocal } = require('./time');

const DATA_DIR = path.join(__dirname, '..', 'data');
const load = (name) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8')).data;

const SCHEMA = load('schema.json');
const CONFIG_DEFAULTS = load('config.json');
const STATUS_DEFAULTS = load('status.json');

/**
 * One in-memory SQLite database holding every ZTATZ table, created with the
 * exact CREATE statements of the real sqldb.py (see tools/extract.py).
 */
function createDatabase(now = new Date()) {
  const db = new DatabaseSync(':memory:');
  for (const stmts of Object.values(SCHEMA)) {
    for (const sql of stmts) db.exec(sql);
  }
  // Extra indexes (not in ZTATZ) so period lookups stay fast; query results are unchanged.
  db.exec(`
    create index emu_temperatuur_rec on temperatuur (RECORD_ID, TIMESTAMP);
    create index emu_watermeter_period on watermeter (TIMEPERIOD_ID, TIMESTAMP);
    create index emu_powerproduction_period on powerproduction (TIMEPERIOD_ID, POWER_SOURCE_ID, TIMESTAMP);
    create index emu_powerproduction_solar_period on powerproduction_solar (TIMEPERIOD_ID, POWER_SOURCE_ID, TIMESTAMP);
  `);
  seedDefaults(db, now);
  return db;
}

function seedDefaults(db, now) {
  const ts = fmtLocal(now);
  const insCfg = db.prepare('insert or replace into config (ID, PARAMETER, LABEL) values (?, ?, ?)');
  for (const r of CONFIG_DEFAULTS) insCfg.run(r.ID, r.PARAMETER, r.LABEL);
  const insSt = db.prepare('insert or replace into status (ID, STATUS, LABEL, SECURITY) values (?, ?, ?, ?)');
  for (const r of STATUS_DEFAULTS) {
    insSt.run(r.ID, r.STATUS === '__NOW__' ? ts : r.STATUS, r.LABEL, r.SECURITY);
  }
}

/** Reset config/status rows to their defaults (keeps history tables). */
function resetDefaults(db, now) {
  db.exec('delete from config; delete from status;');
  seedDefaults(db, now);
}

module.exports = { createDatabase, resetDefaults, SCHEMA };
