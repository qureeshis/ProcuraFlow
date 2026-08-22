import os
import re
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from . import database

TENANT_ROOT = Path(os.getenv('TENANT_DATA_DIR',str(database.BACKEND_ROOT/'tenants'))).resolve()
REGISTRY_PATH = TENANT_ROOT / 'tenant-registry.db'
TENANT_KEY = re.compile(r'^[a-z0-9][a-z0-9-]{2,47}$')
REFERENCE_TABLES = ('countries','cities','currencies','item_categories','item_subcategories','settings','role_shift_requirements')


def normalize_tenant_key(value: str) -> str:
    key=re.sub(r'[^a-z0-9]+','-',str(value or'').strip().lower()).strip('-')
    if not TENANT_KEY.fullmatch(key):raise ValueError('Company login ID must contain 3-48 lowercase letters, numbers, or hyphens')
    return key


def ensure_registry():
    TENANT_ROOT.mkdir(parents=True,exist_ok=True)
    with sqlite3.connect(REGISTRY_PATH)as c:
        c.execute('''CREATE TABLE IF NOT EXISTS tenants(
          tenant_key TEXT PRIMARY KEY,company_name TEXT NOT NULL COLLATE NOCASE UNIQUE,database_path TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'Active',created_at TEXT NOT NULL DEFAULT(datetime('now')))''')
        c.execute("INSERT OR IGNORE INTO tenants(tenant_key,company_name,database_path)VALUES('default','Existing ProcuraFlow Company',?)",(str(database.DB_PATH),))


def tenant_record(key: str):
    if str(key or'').lower()=='default':return {'tenant_key':'default','company_name':'Existing ProcuraFlow Company','database_path':str(database.DB_PATH),'status':'Active'}
    ensure_registry()
    with sqlite3.connect(REGISTRY_PATH)as c:
        c.row_factory=sqlite3.Row;row=c.execute("SELECT * FROM tenants WHERE tenant_key=? AND status='Active'",(str(key or'').lower(),)).fetchone()
        return dict(row)if row else None


@contextmanager
def tenant_database(key: str):
    row=tenant_record(key)
    if not row:raise LookupError('Company login ID was not found')
    token=database.use_database(Path(row['database_path']))
    try:yield row
    finally:database.reset_database(token)


@contextmanager
def tenant_database_for_registration(path: Path):
    token=database.use_database(path)
    try:yield
    finally:database.reset_database(token)


def _create_schema(target: Path):
    source=sqlite3.connect(database.DB_PATH);source.row_factory=sqlite3.Row
    target_connection=sqlite3.connect(target)
    try:
        target_connection.execute('PRAGMA foreign_keys=OFF')
        objects=source.execute("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 1 WHEN 'index' THEN 2 ELSE 3 END").fetchall()
        for row in objects:
            try:target_connection.execute(row['sql'])
            except sqlite3.OperationalError as error:
                if 'already exists'not in str(error).lower():raise
        for table in REFERENCE_TABLES:
            exists=source.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",(table,)).fetchone()
            if not exists:continue
            columns=[row['name']for row in source.execute(f'PRAGMA table_info({table})')]
            rows=source.execute(f'SELECT * FROM {table}').fetchall()
            if rows:
                placeholders=','.join('?'for _ in columns)
                target_connection.executemany(f"INSERT INTO {table}({','.join(columns)})VALUES({placeholders})",([row[column]for column in columns]for row in rows))
        target_connection.execute("INSERT OR IGNORE INTO system_maintenance(id,active_yn,session_epoch)VALUES(1,0,1)")
        target_connection.commit()
    finally:target_connection.close();source.close()


def provision_tenant(key: str, company_name: str) -> Path:
    ensure_registry();key=normalize_tenant_key(key);target=(TENANT_ROOT/f'{key}.db').resolve()
    if target.exists():raise FileExistsError('Company database already exists')
    with sqlite3.connect(REGISTRY_PATH)as registry:
        if registry.execute('SELECT 1 FROM tenants WHERE tenant_key=? OR lower(company_name)=lower(?)',(key,company_name)).fetchone():raise FileExistsError('Company name or login ID is already registered')
    _create_schema(target)
    return target


def register_tenant(key: str, company_name: str, target: Path):
    with sqlite3.connect(REGISTRY_PATH)as c:c.execute('INSERT INTO tenants(tenant_key,company_name,database_path)VALUES(?,?,?)',(key,company_name,str(target)))
