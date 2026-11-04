"""
Parity check: compares the emulator against the REAL ZTATZ API code.

1. Asks the running emulator for a database snapshot (this pauses the simulator).
2. Loads ztatz/scripts/P1Api.py with all its database paths pointed at that snapshot.
3. Sends the same request matrix to both and diffs status, content type and body.

Requirements: a Python with falcon (4.x), pyyaml, pytz, psutil, pycryptodome,
cryptography and pynacl, e.g.
    python -m venv .venv && .venv/Scripts/pip install falcon pyyaml pytz psutil pycryptodome cryptography pynacl

Usage:
    node emulator/server.js --port 8080            (in another terminal)
    python emulator/tools/parity.py [http://127.0.0.1:8080] [path/to/ztatz/scripts]
"""
import json
import os
import shutil
import sys
import tempfile
import types
import urllib.error
import urllib.parse
import urllib.request

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8080'
SCRIPTS = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'ztatz', 'scripts')


def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), method='POST',
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def emulator_get(path, query, headers, method='GET'):
    url = BASE + urllib.parse.quote(path) + ('?' + query if query else '')
    req = urllib.request.Request(url, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.headers.get('Content-Type'), resp.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get('Content-Type'), e.read().decode('utf-8')


# --- load the real API against the snapshot --------------------------------------
snap = post('/emulator/api/snapshot', {})
work = tempfile.mkdtemp(prefix='ztatz-parity-')
db_file = os.path.join(work, 'all.db')
shutil.copy(snap['file'], db_file)
print('snapshot', snap['file'], 'taken at', snap['now'])

# Linux-only stdlib modules used by util.py
for name in ('grp', 'pwd'):
    if name not in sys.modules:
        try:
            __import__(name)
        except ImportError:
            stub = types.ModuleType(name)
            stub.getgrnam = stub.getpwnam = lambda *_a, **_k: types.SimpleNamespace(gr_gid=0, pw_uid=0, pw_gid=0)
            sys.modules[name] = stub

sys.path.insert(0, SCRIPTS)
import const  # noqa: E402

for key in dir(const):
    if key.startswith('FILE_DB_'):
        setattr(const, key, db_file)
const.DIR_FILELOG = work + os.sep

import P1Api  # noqa: E402  (opens the databases at import time)
from falcon import testing  # noqa: E402

P1Api.flog.consoleOutputOn(False)  # ZTATZ logs every rejected parameter to the console

client = testing.TestClient(P1Api.app)


def real_get(path, query, headers, method='GET'):
    r = client.simulate_request(method, path, query_string=query, headers=headers)
    return r.status_code, r.headers.get('Content-Type'), r.text


# --- request matrix ---------------------------------------------------------------
SKIP = ('/api/v1/catalog', '/api/v1/datetime', '/api/v1/wifi/ssid', '/api/v1/p1port/telegram')
catalog = json.load(open(os.path.join(HERE, '..', 'data', 'catalog.json'), encoding='utf-8'))['data']
paths = []
for route in catalog:
    if route.startswith(SKIP):
        continue
    paths.append(route.replace('{db_index}', '20').replace('{id}', '1'))
paths += ['/api/v1/status/105', '/api/v1/status/abc', '/api/v1/status/', '/api/v1/status/-7',
          '/api/v1/configuration/0', '/api/v1/configuration/14', '/api/v1/status/5/help',
          '/api/v2/watermeterdigital/day/x', '/api/v2/watermeterdigital/day/9',
          '/api/v1/powerproductionsolar/day/x/20', '/api/v1/powerproductionsolar/day/1/21',
          '/api/v1/powerproductionsolar/hour/7/30', '/api/v1/smartmeter/', '/api/v1/nope', '/api/v1/Status']

Q = urllib.parse.quote
QUERIES = ['limit=3', 'limit=2&json=object', 'limit=2&round=on', 'limit=2&sort=asc', 'limit=abc', 'limit=+2',
           'limit=-2', 'limit=%205%20', 'LIMIT=1&limit=2', 'json=OBJECT&limit=1&ROUND=On',
           'limit=2&starttime=' + Q('2026-11-03 12:00:00'), 'limit=2&starttime=2026-11', 'limit=2&starttime=bad',
           'range=2026-11-03&limit=3', 'range=2026-13', 'range=2026-11&starttime=2026-11-04&limit=2',
           'starttime=2026-11-04&range=2026-11&limit=2', 'limit=1&range=', 'limit=1&starttime=']
SMALL = ('/api/v1/status', '/api/v1/configuration', '/api/v1/statistics', '/api/v1/financial/year',
         '/api/v1/powergas/year', '/api/v1/weather/year')
HEADERS = [{}, {'Accept': 'application/json'}, {'Accept': 'application/json, */*'}, {'Accept': 'text/html'}]

cases = []
for p in paths:
    if p.endswith('/help'):
        cases.append((p, '', {}))
        continue
    if p.startswith(SMALL):
        cases.append((p, '', {}))
    for q in QUERIES:
        cases.append((p, q, {}))
for h in HEADERS:
    cases.append(('/api/v1/smartmeter', 'limit=abc', h))
    cases.append(('/api/v1/nope', '', h))
    cases.append(('/api/v1/powergas/day', 'range=2026-13', h))

failures = 0
with_data = 0
for path, query, headers in cases:
    exp = real_get(path, query, headers)
    got = emulator_get(path, query, headers)
    if exp[0] == 200 and exp[2] not in ('[]', ''):
        with_data += 1
    if exp[0] != got[0] or exp[2] != got[2] or (exp[1] or '').split(';')[0] != (got[1] or '').split(';')[0]:
        failures += 1
        if failures <= 25:
            print('\nMISMATCH', path, query, headers)
            print('  real    ', exp[0], exp[1], exp[2][:300])
            print('  emulator', got[0], got[1], got[2][:300])
# POST -> 405
for path in ('/api/v1/smartmeter', '/api/v1/status/1'):
    exp = real_get(path, '', {}, 'POST')
    got = emulator_get(path, '', {}, 'POST')
    cases.append((path, 'POST', {}))
    if exp[0] != got[0] or exp[2] != got[2]:
        failures += 1
        print('\nMISMATCH POST', path, exp, got)

post('/emulator/api/action', {'action': 'resume'})
print('\n%d requests compared (%d returned data), %d mismatches' % (len(cases), with_data, failures))
sys.exit(1 if failures else 0)
