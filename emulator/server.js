#!/usr/bin/env node
'use strict';

/**
 * ZTATZ / P1 Monitor API emulator.
 *
 *   node emulator/server.js [--port 8080] [--host 0.0.0.0] [--speed 1] [--history-days 400] [--quiet]
 *
 * Serves every route of the real ZTATZ API (/api/v1/..., /api/v2/...) from
 * an in-memory SQLite database that a simulator keeps filling with live data.
 * Scenario switches live at http://<host>:<port>/emulator
 */

const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { createDatabase } = require('./lib/db');
const { Clock, fmtLocal } = require('./lib/time');
const { Router } = require('./lib/router');
const { parseQuery } = require('./lib/params');
const { HttpError, serializeError } = require('./lib/errors');
const { Simulator } = require('./sim/simulator');
const { DEFAULTS, ENUMS, merge } = require('./sim/scenario');

// --- options ---------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { port: Number(process.env.PORT) || 8080, host: '0.0.0.0', speed: 1, historyDays: 400, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--port' || a === '-p') opts.port = Number(next());
    else if (a === '--host') opts.host = next();
    else if (a === '--speed') opts.speed = Number(next());
    else if (a === '--history-days') opts.historyDays = Number(next());
    else if (a === '--quiet' || a === '-q') opts.quiet = true;
    else if (a === '--help' || a === '-h') {
      console.log('usage: node emulator/server.js [--port 8080] [--host 0.0.0.0] [--speed 1] [--history-days 400] [--quiet]');
      process.exit(0);
    }
  }
  return opts;
}

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const nic of list || []) {
      if (nic.family === 'IPv4' && !nic.internal) return nic.address;
    }
  }
  return '127.0.0.1';
}

// --- responses -------------------------------------------------------------------
function send(res, status, type, body, headers = {}) {
  const buf = Buffer.from(body, 'utf8');
  const code = Number(String(status).slice(0, 3));
  const reason = String(status).slice(4);
  const all = { Server: 'nginx', 'Content-Type': type, 'Content-Length': buf.length, ...headers };
  if (reason) res.writeHead(code, reason, all);
  else res.writeHead(code, all);
  res.end(buf);
}

function sendError(req, res, err) {
  const { type, headers, body } = serializeError(err, req.headers.accept);
  send(res, err.status, type, body, headers);
}

const nginxPage = (code, text) =>
  `<html>\r\n<head><title>${code} ${text}</title></head>\r\n<body>\r\n<center><h1>${code} ${text}</h1></center>\r\n` +
  '<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n';

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// --- main --------------------------------------------------------------------------
function main() {
  const opts = parseArgs(process.argv.slice(2));
  const log = (...a) => console.log('[' + new Date().toISOString().slice(11, 19) + ']', ...a);
  const lanIp = lanAddress();

  const clock = new Clock(opts.speed);
  const db = createDatabase(clock.now());
  const scenario = merge(DEFAULTS, { speed: opts.speed });
  const sim = new Simulator({ db, clock, scenario, lanIp, historyDays: opts.historyDays, log });
  log('building ' + opts.historyDays + ' days of history ...');
  sim.init();
  sim.start();

  const router = new Router();
  require('./routes/p1api').register(router);
  require('./routes/libs').register(router);

  const controlPage = path.join(__dirname, 'control', 'index.html');

  async function control(req, res, url) {
    const json = (status, obj) => send(res, status, 'application/json', JSON.stringify(obj, null, 2));
    const state = () => ({ scenario: sim.scenario, sim: sim.snapshot(), defaults: DEFAULTS, enums: ENUMS, lanIp, port: opts.port });
    try {
      if (url.pathname === '/emulator' || url.pathname === '/emulator/') {
        return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(controlPage, 'utf8'));
      }
      if (url.pathname === '/emulator/api/state' && req.method === 'GET') return json(200, state());
      if (url.pathname === '/emulator/api/scenario') {
        if (req.method === 'GET') return json(200, sim.scenario);
        if (req.method === 'POST') {
          const update = JSON.parse((await readBody(req)) || '{}');
          sim.updateScenario(update);
          log('scenario', JSON.stringify(update));
          return json(200, state());
        }
      }
      if (url.pathname === '/emulator/api/action' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}');
        if (body.action === 'reset') {
          sim.resetAll();
          log('reset: history rebuilt');
        } else if (body.action === 'advance') {
          const minutes = Math.max(0, Number(body.minutes) || 0);
          sim.advanceTo(new Date(clock.now().getTime() + minutes * 60000));
          log('advanced ' + minutes + ' min, now ' + fmtLocal(clock.now()));
        } else if (body.action === 'jump') {
          // jump forward to the next occurrence of HH:MM[:SS]
          const [h, m, s = 0] = String(body.time || '23:59:30').split(':').map(Number);
          const now = clock.now();
          const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, s);
          if (target <= now) target.setDate(target.getDate() + 1);
          sim.advanceTo(target);
          log('jumped to ' + fmtLocal(clock.now()));
        } else if (body.action === 'pause') {
          sim.stop();
        } else if (body.action === 'resume') {
          sim.stop();
          sim.start();
        } else {
          return json(400, { error: 'unknown action' });
        }
        return json(200, state());
      }
      if (url.pathname === '/emulator/api/snapshot' && req.method === 'POST') {
        // pause the simulator and write the database to a file (used by tools/parity.py)
        const body = JSON.parse((await readBody(req)) || '{}');
        const file = path.resolve(body.file || path.join(os.tmpdir(), 'ztatz-emulator-snapshot.db'));
        sim.stop();
        if (fs.existsSync(file)) fs.unlinkSync(file);
        db.prepare('vacuum into ?').run(file);
        return json(200, { file, paused: true, now: fmtLocal(clock.now()) });
      }
      return json(404, { error: 'not found' });
    } catch (e) {
      return json(400, { error: e.message });
    }
  }

  async function handle(req, res) {
    const started = Date.now();
    const url = new URL(req.url, 'http://localhost');
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      pathname = url.pathname;
    }
    if (pathname === '/emulator' || pathname.startsWith('/emulator/')) return control(req, res, url);

    const sc = sim.scenario;
    const done = (status) => {
      if (!opts.quiet) log(req.method, req.url, status, (Date.now() - started) + 'ms');
    };

    if (sc.availability === 'offline') {
      req.socket.destroy();
      return done('dropped');
    }
    if (sc.availability === 'slow') await new Promise((r) => setTimeout(r, sc.slowSeconds * 1000));
    if (sc.availability === 'html') {
      send(res, '502 Bad Gateway', 'text/html', nginxPage(502, 'Bad Gateway'));
      return done(502);
    }

    // nginx serves the web UI for everything outside /api
    if (!pathname.startsWith('/api/')) {
      if (pathname === '/' || pathname === '/index.html') {
        send(res, 200, 'text/html', '<html><head><title>P1 monitor</title></head><body><h1>P1 monitor (emulated)</h1>' +
          '<p>API: <a href="/api/v1/catalog">/api/v1/catalog</a> &middot; Emulator controls: <a href="/emulator">/emulator</a></p></body></html>');
        return done(200);
      }
      send(res, '404 Not Found', 'text/html', nginxPage(404, 'Not Found'));
      return done(404);
    }

    try {
      if (sc.availability === 'error500') throw new HttpError('500 Internal Server Error', { title: '500 Internal Server Error' });
      const match = router.match(pathname);
      if (!match) throw new HttpError('404 Not Found', { title: '404 Not Found' });
      if (req.method === 'OPTIONS') {
        send(res, 200, 'application/json', '', { Allow: 'GET, OPTIONS' });
        return done(200);
      }
      if (req.method !== 'GET') {
        throw new HttpError('405 Method Not Allowed', { title: '405 Method Not Allowed' }, { Allow: 'GET, OPTIONS' });
      }
      const ctx = {
        db,
        path: pathname,
        params: parseQuery(url.search.slice(1)),
        pathParams: match.params,
        scenario: sc,
        sim,
        lanIp,
        now: () => clock.now(),
      };
      const body = match.handler(ctx);
      send(res, 200, 'application/json', body);
      done(200);
    } catch (err) {
      const e = err instanceof HttpError ? err : new HttpError('500 Internal Server Error', { title: '500 Internal Server Error' });
      if (!(err instanceof HttpError)) log('handler crashed:', err.stack);
      sendError(req, res, e);
      done(e.status.slice(0, 3));
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      log('request failed:', e.stack);
      if (!res.headersSent) send(res, 500, 'text/plain', 'emulator error');
    });
  });
  server.listen(opts.port, opts.host, () => {
    log(`ZTATZ emulator listening on http://${lanIp}:${opts.port}  (controls: http://${lanIp}:${opts.port}/emulator)`);
    log(`simulated time ${fmtLocal(clock.now())}, speed x${clock.speed}`);
  });

  const shutdown = () => {
    sim.stop();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
