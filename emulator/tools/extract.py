"""
One-off generator for emulator/data/*.json, built from the exported ZTATZ source.

Usage:  python emulator/tools/extract.py [path/to/ztatz/scripts]

- help.json   : every HELP_* dict from apiconst.py (pure data module)
- config.json : default rows of the `config` table   (via the real sqldb.configDB.init)
- status.json : default rows of the `status` table   (via the real sqldb.rtStatusDb.init)

Linux-only helper modules imported by sqldb.py are replaced with small stubs.
"""
import json
import os
import sys
import types
from datetime import datetime

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SCRIPTS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'ztatz', 'scripts')
OUT = os.path.join(HERE, '..', 'data')
sys.path.insert(0, SCRIPTS)


def stub(name, **attrs):
    mod = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    sys.modules[name] = mod


# Placeholder written into timestamp defaults; the emulator replaces it at startup.
NOW = '__NOW__'
stub('util', mkLocalTimeString=lambda *a, **k: NOW)
stub('samba_lib', FILESHARE_MODE_OFF='uit')
stub('utiltimestamp', utiltimestamp=object)

# --- help texts --------------------------------------------------------------
ns = {}
with open(os.path.join(SCRIPTS, 'apiconst.py'), encoding='utf-8') as f:
    exec(f.read(), ns)
help_dicts = {k: v for k, v in ns.items() if k.startswith('HELP_') and isinstance(v, dict)}

# --- config / status defaults (real init code against an in-memory db) -------
import sqldb  # noqa: E402


def dump(db_cls, table, cols):
    # insert_rec() reconnects by filename, so a real (temporary) file is needed.
    import tempfile
    path = os.path.join(tempfile.mkdtemp(), table + '.db')
    db = db_cls()
    db.init(path, table)
    import sqlite3
    con = sqlite3.connect(path)
    rows = [dict(zip(cols, r)) for r in con.execute('select ' + ','.join(cols) + ' from ' + table + ' order by ID')]
    con.close()
    return rows


config_rows = dump(sqldb.configDB, 'config', ['ID', 'PARAMETER', 'LABEL'])
status_rows = dump(sqldb.rtStatusDb, 'status', ['ID', 'STATUS', 'LABEL', 'SECURITY'])


# --- table schemas (exact CREATE statements from sqlite_master) --------------
class NullLog:
    def __getattr__(self, _name):
        return lambda *a, **k: None


import sqldb_pricing  # noqa: E402
import sqldb_statistic  # noqa: E402

SCHEMA_SOURCES = [
    (sqldb.SqlDb1, 'e_serial'),
    (sqldb.SqlDb2, 'e_history_min'),
    (sqldb.SqlDb3, 'e_history_uur'),
    (sqldb.SqlDb4, 'e_history_dag'),
    (sqldb.SqlDb4, 'e_history_maand'),
    (sqldb.SqlDb4, 'e_history_jaar'),
    (sqldb.financieelDb, 'e_financieel_dag'),
    (sqldb.financieelDb, 'e_financieel_maand'),
    (sqldb.financieelDb, 'e_financieel_jaar'),
    (sqldb_pricing.PricingDb, 'energieprijzen_uur'),
    (sqldb.currentWeatherDB, 'weer'),
    (sqldb.historyWeatherDB, 'weer_history_uur'),
    (sqldb.historyWeatherDB, 'weer_history_dag'),
    (sqldb.historyWeatherDB, 'weer_history_maand'),
    (sqldb.historyWeatherDB, 'weer_history_jaar'),
    (sqldb.temperatureDB, 'temperatuur'),
    (sqldb.WatermeterDBV2, 'watermeter'),
    (sqldb.PhaseDB, 'faseinformatie'),
    (sqldb.PhaseMaxMinDB, 'faseminmax_dag'),
    (sqldb.powerProductionDB, 'powerproduction'),
    (sqldb.powerProductionSolarDB, 'powerproduction_solar'),
    (sqldb_statistic.StatisticDb, 'statistics'),
    (sqldb.rtStatusDb, 'status'),
    (sqldb.configDB, 'config'),
]


def schema_of(db_cls, table):
    import sqlite3
    import tempfile
    path = os.path.join(tempfile.mkdtemp(), table + '.db')
    db = db_cls()
    try:
        db.init(path, table, flog=NullLog())
    except TypeError:
        db.init(path, table)
    con = sqlite3.connect(path)
    stmts = [r[0] for r in con.execute(
        "select sql from sqlite_master where sql is not null and tbl_name = ? order by type desc", (table,))]
    con.close()
    return stmts


schemas = {}
for cls, table in SCHEMA_SOURCES:
    schemas[table] = schema_of(cls, table)


# --- literal SQL base strings (class attributes sqlstr_base_*) ---------------
import ast  # noqa: E402

SQL_FILES = ['P1Api.py', 'api_solarpower_lib.py', 'api_phaseminmax_lib.py', 'api_weather_history_lib.py',
             'api_financial_lib.py', 'api_statistics_lib.py', 'api_water_lib.py']
sql = {}
for fname in SQL_FILES:
    tree = ast.parse(open(os.path.join(SCRIPTS, fname), encoding='utf-8').read())
    for cls in (n for n in tree.body if isinstance(n, ast.ClassDef)):
        for node in cls.body:
            if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name) \
                    and node.targets[0].id.startswith('sqlstr_base'):
                # string literals concatenated with const.* table names
                expr = ast.Expression(body=node.value)
                sql[cls.name + '.' + node.targets[0].id] = eval(compile(expr, fname, 'eval'),
                                                                {'const': __import__('const')})

# --- catalog route list (same algorithm as api_catalog_lib.Catalog, no IP prefix) ---
catalog = []
with open(os.path.join(SCRIPTS, 'apiconst.py'), encoding='utf-8') as search:
    for line in search:
        line = line.rstrip()
        if line.startswith('ROUTE_'):
            if '_HELP' in line:
                continue
            route = line.split('=')[1].replace("'", "").replace("/{power_source_id}", "").strip()
            if route.startswith('ROUTE_'):
                continue
            catalog.append(route)
routes = []
for route in catalog:
    routes.append(route)
    routes.append(route.replace("/{db_index}", "").strip() + '/help')
for i, r in enumerate(routes):
    if 'help' in r:
        continue
    if ns['BASE_POWERPRODUCTION_SOLAR'] in r:
        routes[i] = r.replace("/{db_index}", "/1/{db_index}").strip()
for i, r in enumerate(routes):
    if ns['BASE_WATERMETER_DIGITAL'] in r and 'help' in r:
        routes[i] = r.replace("/{id}", "").strip()
routes.sort()

os.makedirs(OUT, exist_ok=True)
meta = {'_source': 'generated by emulator/tools/extract.py on ' + datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
for name, data in (('help.json', help_dicts), ('config.json', config_rows), ('status.json', status_rows),
                   ('schema.json', schemas), ('sql.json', sql), ('catalog.json', routes)):
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
        json.dump({**meta, 'data': data}, f, ensure_ascii=False, indent=1)
    print(name, len(data))
