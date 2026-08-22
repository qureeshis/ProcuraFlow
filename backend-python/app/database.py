import os
import sqlite3
from contextvars import ContextVar
from contextlib import contextmanager
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = BACKEND_ROOT / "procuraflow.db"
DB_PATH = Path(os.getenv("DB_PATH", str(DEFAULT_DB))).resolve()
ACTIVE_DB_PATH: ContextVar[Path | None] = ContextVar('active_tenant_db_path', default=None)


def active_db_path() -> Path:
    return ACTIVE_DB_PATH.get() or DB_PATH


def use_database(path: Path):
    return ACTIVE_DB_PATH.set(Path(path).resolve())


def reset_database(token):
    ACTIVE_DB_PATH.reset(token)


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(active_db_path(), timeout=30, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 30000")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


@contextmanager
def transaction(immediate: bool = False):
    connection = connect()
    try:
        connection.execute("BEGIN IMMEDIATE" if immediate else "BEGIN")
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def fetch_one(sql: str, parameters=()):
    with connect() as connection:
        row = connection.execute(sql, parameters).fetchone()
        return dict(row) if row else None


def fetch_all(sql: str, parameters=()):
    with connect() as connection:
        return [dict(row) for row in connection.execute(sql, parameters).fetchall()]


def ensure_company_employee_schema():
    """Apply small, idempotent compatibility changes to existing installations."""
    with transaction(immediate=True) as connection:
        connection.execute("""CREATE TABLE IF NOT EXISTS delegated_authorities(
            id INTEGER PRIMARY KEY AUTOINCREMENT,delegation_number TEXT NOT NULL UNIQUE,
            delegator_employee_id INTEGER NOT NULL REFERENCES employees(id),delegate_employee_id INTEGER NOT NULL REFERENCES employees(id),
            delegate_role TEXT NOT NULL,authority_type TEXT NOT NULL,scope_type TEXT NOT NULL,scope_id INTEGER,
            effective_from TEXT NOT NULL,effective_until TEXT NOT NULL,reason TEXT NOT NULL,business_justification TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'ACTIVE',created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT(datetime('now')),
            revoked_by INTEGER REFERENCES users(id),revoked_at TEXT,revocation_reason TEXT)""")
        delegation_sql=(connection.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='delegated_authorities'").fetchone()or{'sql':''})['sql']or''
        if "authority_type='FINANCE_EXTERNAL_HANDOFF'" in delegation_sql:
            connection.execute('ALTER TABLE delegated_authorities RENAME TO delegated_authorities_legacy')
            connection.execute("""CREATE TABLE delegated_authorities(
                id INTEGER PRIMARY KEY AUTOINCREMENT,delegation_number TEXT NOT NULL UNIQUE,
                delegator_employee_id INTEGER NOT NULL REFERENCES employees(id),delegate_employee_id INTEGER NOT NULL REFERENCES employees(id),
                delegate_role TEXT NOT NULL,authority_type TEXT NOT NULL,scope_type TEXT NOT NULL,scope_id INTEGER,
                effective_from TEXT NOT NULL,effective_until TEXT NOT NULL,reason TEXT NOT NULL,business_justification TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'ACTIVE',created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT(datetime('now')),
                revoked_by INTEGER REFERENCES users(id),revoked_at TEXT,revocation_reason TEXT)""")
            connection.execute("""INSERT INTO delegated_authorities(id,delegation_number,delegator_employee_id,delegate_employee_id,delegate_role,authority_type,scope_type,scope_id,effective_from,effective_until,reason,business_justification,status,created_by,created_at,revoked_by,revoked_at,revocation_reason)
              SELECT id,delegation_number,delegator_employee_id,delegate_employee_id,delegate_role,authority_type,scope_type,scope_id,effective_from,effective_until,reason,business_justification,status,created_by,created_at,revoked_by,revoked_at,revocation_reason FROM delegated_authorities_legacy""")
            connection.execute('DROP TABLE delegated_authorities_legacy')
        delegation_columns={row['name'] for row in connection.execute('PRAGMA table_info(delegated_authorities)')}
        for column,definition in {
            'employee_role_snapshot':'TEXT','department':'TEXT','reason_code':'TEXT','reason_other':'TEXT','updated_at':'TEXT',
        }.items():
            if column not in delegation_columns:connection.execute(f'ALTER TABLE delegated_authorities ADD COLUMN {column} {definition}')
        connection.execute("""CREATE TABLE IF NOT EXISTS delegated_authority_history(
            id INTEGER PRIMARY KEY AUTOINCREMENT,delegation_id INTEGER NOT NULL REFERENCES delegated_authorities(id),
            event_type TEXT NOT NULL,previous_expiry TEXT,new_expiry TEXT,reason TEXT,changed_by INTEGER NOT NULL REFERENCES users(id),
            changed_at TEXT NOT NULL DEFAULT(datetime('now')),details_json TEXT)""")
        connection.execute("""CREATE TABLE IF NOT EXISTS delegated_authority_uses(
            id INTEGER PRIMARY KEY AUTOINCREMENT,delegation_id INTEGER NOT NULL REFERENCES delegated_authorities(id),
            authority_code TEXT NOT NULL,performed_by INTEGER NOT NULL REFERENCES users(id),table_name TEXT NOT NULL,record_id INTEGER,
            action TEXT NOT NULL,normal_role TEXT,delegated_by_employee_id INTEGER REFERENCES employees(id),used_at TEXT NOT NULL DEFAULT(datetime('now')),
            context_json TEXT)""")
        history_sql=(connection.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='delegated_authority_history'").fetchone()or{'sql':''})['sql']or''
        if 'delegated_authorities_legacy' in history_sql:
            connection.execute('ALTER TABLE delegated_authority_history RENAME TO delegated_authority_history_broken')
            connection.execute("""CREATE TABLE delegated_authority_history(id INTEGER PRIMARY KEY AUTOINCREMENT,delegation_id INTEGER NOT NULL REFERENCES delegated_authorities(id),event_type TEXT NOT NULL,previous_expiry TEXT,new_expiry TEXT,reason TEXT,changed_by INTEGER NOT NULL REFERENCES users(id),changed_at TEXT NOT NULL DEFAULT(datetime('now')),details_json TEXT)""")
            connection.execute('INSERT INTO delegated_authority_history SELECT * FROM delegated_authority_history_broken');connection.execute('DROP TABLE delegated_authority_history_broken')
        uses_sql=(connection.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='delegated_authority_uses'").fetchone()or{'sql':''})['sql']or''
        if 'delegated_authorities_legacy' in uses_sql:
            connection.execute('ALTER TABLE delegated_authority_uses RENAME TO delegated_authority_uses_broken')
            connection.execute("""CREATE TABLE delegated_authority_uses(id INTEGER PRIMARY KEY AUTOINCREMENT,delegation_id INTEGER NOT NULL REFERENCES delegated_authorities(id),authority_code TEXT NOT NULL,performed_by INTEGER NOT NULL REFERENCES users(id),table_name TEXT NOT NULL,record_id INTEGER,action TEXT NOT NULL,normal_role TEXT,delegated_by_employee_id INTEGER REFERENCES employees(id),used_at TEXT NOT NULL DEFAULT(datetime('now')),context_json TEXT)""")
            connection.execute('INSERT INTO delegated_authority_uses SELECT * FROM delegated_authority_uses_broken');connection.execute('DROP TABLE delegated_authority_uses_broken')
        connection.execute('CREATE INDEX IF NOT EXISTS idx_delegation_delegate_period ON delegated_authorities(delegate_employee_id,authority_type,effective_from,effective_until)')
        connection.execute("""CREATE TRIGGER IF NOT EXISTS prevent_duplicate_supplier_invoice
            BEFORE INSERT ON invoices WHEN EXISTS(
              SELECT 1 FROM invoices WHERE supplier_id=NEW.supplier_id
              AND lower(trim(invoice_number))=lower(trim(NEW.invoice_number)))
            BEGIN SELECT RAISE(ABORT,'duplicate supplier invoice number'); END""")
        pr_columns = {row["name"] for row in connection.execute("PRAGMA table_info(purchase_requisitions)")}
        if "business_requestor_employee_id" not in pr_columns:
            connection.execute(
                "ALTER TABLE purchase_requisitions ADD COLUMN business_requestor_employee_id INTEGER REFERENCES employees(id)"
            )
        grn_columns = {row["name"] for row in connection.execute("PRAGMA table_info(grns)")}
        if "received_for_employee_id" not in grn_columns:
            connection.execute(
                "ALTER TABLE grns ADD COLUMN received_for_employee_id INTEGER REFERENCES employees(id)"
            )
        rfq_columns = {row["name"] for row in connection.execute("PRAGMA table_info(rfqs)")}
        for column, definition in {
            "workflow_status": "TEXT NOT NULL DEFAULT 'Draft'", "issue_date": "TEXT", "closing_date": "TEXT",
            "required_delivery_date": "TEXT", "delivery_warehouse_id": "INTEGER REFERENCES warehouses(id)",
            "delivery_location_id": "INTEGER REFERENCES locations(id)", "currency": "TEXT", "payment_terms": "TEXT",
            "incoterms": "TEXT", "contact_person": "TEXT", "notes": "TEXT", "commercial_terms": "TEXT",
            "technical_requirements": "TEXT", "created_by": "INTEGER REFERENCES users(id)", "updated_at": "TEXT",
        }.items():
            if column not in rfq_columns: connection.execute(f"ALTER TABLE rfqs ADD COLUMN {column} {definition}")
        invitation_columns = {row["name"] for row in connection.execute("PRAGMA table_info(rfq_suppliers)")}
        for column, definition in {"issued_at":"TEXT", "sent_method":"TEXT", "contact_person":"TEXT", "email":"TEXT", "response_status":"TEXT NOT NULL DEFAULT 'Invited'", "quotation_received_at":"TEXT"}.items():
            if column not in invitation_columns: connection.execute(f"ALTER TABLE rfq_suppliers ADD COLUMN {column} {definition}")
        quotation_columns = {row["name"] for row in connection.execute("PRAGMA table_info(supplier_quotations)")}
        for column, definition in {
            "quotation_number":"TEXT", "quotation_date":"TEXT", "validity_date":"TEXT", "quoted_quantity":"REAL",
            "discount":"REAL NOT NULL DEFAULT 0", "other_charges":"REAL NOT NULL DEFAULT 0", "delivery_date":"TEXT",
            "technical_compliance":"TEXT", "commercial_compliance":"TEXT", "country_of_origin":"TEXT", "remarks":"TEXT",
            "revision_number":"INTEGER NOT NULL DEFAULT 1", "superseded_by_id":"INTEGER REFERENCES supplier_quotations(id)",
            "active_yn":"INTEGER NOT NULL DEFAULT 1", "created_by":"INTEGER REFERENCES users(id)", "created_at":"TEXT",
        }.items():
            if column not in quotation_columns: connection.execute(f"ALTER TABLE supplier_quotations ADD COLUMN {column} {definition}")
        connection.execute("""CREATE TABLE IF NOT EXISTS rfq_awards(
            id INTEGER PRIMARY KEY AUTOINCREMENT,rfq_id INTEGER NOT NULL REFERENCES rfqs(id),quotation_id INTEGER NOT NULL REFERENCES supplier_quotations(id),
            supplier_id INTEGER NOT NULL REFERENCES suppliers(id),item_id INTEGER NOT NULL REFERENCES items(id),awarded_quantity REAL NOT NULL CHECK(awarded_quantity>0),
            recommendation_reason TEXT NOT NULL,non_lowest_justification TEXT,status TEXT NOT NULL DEFAULT 'Awaiting Approval',recommended_by INTEGER NOT NULL REFERENCES users(id),
            recommended_at TEXT NOT NULL DEFAULT(datetime('now')),approved_by INTEGER REFERENCES users(id),approved_at TEXT,rejection_reason TEXT,po_id INTEGER REFERENCES purchase_orders(id),
            UNIQUE(rfq_id,item_id,supplier_id))""")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_rfq_awards_status ON rfq_awards(rfq_id,status)")
        connection.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_active_supplier_quote_line ON supplier_quotations(rfq_id,supplier_id,item_id) WHERE active_yn=1")
        supplier_columns = {row["name"] for row in connection.execute("PRAGMA table_info(suppliers)")}
        for column, definition in {"active_yn":"INTEGER NOT NULL DEFAULT 1", "blocked_yn":"INTEGER NOT NULL DEFAULT 0", "vendor_category":"TEXT"}.items():
            if column not in supplier_columns: connection.execute(f"ALTER TABLE suppliers ADD COLUMN {column} {definition}")
        award_columns = {row["name"] for row in connection.execute("PRAGMA table_info(rfq_awards)")}
        for column, definition in {
            "approval_limit_snapshot":"REAL", "effective_limit_source":"TEXT", "external_approval_required":"INTEGER NOT NULL DEFAULT 0",
            "external_approved_by":"TEXT", "external_approval_reference":"TEXT", "external_approval_date":"TEXT", "external_approval_notes":"TEXT"
        }.items():
            if column not in award_columns: connection.execute(f"ALTER TABLE rfq_awards ADD COLUMN {column} {definition}")
        po_item_columns = {row["name"] for row in connection.execute("PRAGMA table_info(po_items)")}
        for column, definition in {
            "quotation_id":"INTEGER REFERENCES supplier_quotations(id)", "discount":"REAL NOT NULL DEFAULT 0", "freight":"REAL NOT NULL DEFAULT 0",
            "other_charges":"REAL NOT NULL DEFAULT 0", "delivery_date":"TEXT", "warranty":"TEXT", "technical_specifications":"TEXT"
        }.items():
            if column not in po_item_columns: connection.execute(f"ALTER TABLE po_items ADD COLUMN {column} {definition}")
        for name in (
            "Production", "Laboratory", "Quality", "Engineering", "Maintenance",
            "HSE", "Planning", "Finance", "Human Resources", "Administration",
            "Logistics", "Sales & Commercial", "Information Technology", "Management",
        ):
            connection.execute(
                "INSERT INTO departments(name) SELECT ? WHERE NOT EXISTS "
                "(SELECT 1 FROM departments WHERE lower(trim(name))=lower(trim(?)) AND deleted_at IS NULL)",
                (name, name),
            )
        connection.execute("UPDATE shifts SET break_minutes=30 WHERE active_yn=1 AND COALESCE(break_minutes,0)=0")
        warehouse_columns = {row["name"] for row in connection.execute("PRAGMA table_info(warehouses)")}
        if "operating_start_time" not in warehouse_columns:
            connection.execute("ALTER TABLE warehouses ADD COLUMN operating_start_time TEXT NOT NULL DEFAULT '03:00'")
        if "operating_end_time" not in warehouse_columns:
            connection.execute("ALTER TABLE warehouses ADD COLUMN operating_end_time TEXT NOT NULL DEFAULT '03:00'")
        if "time_zone" not in warehouse_columns:
            connection.execute("ALTER TABLE warehouses ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'Asia/Riyadh'")
        if "operating_days_json" not in warehouse_columns:
            connection.execute("ALTER TABLE warehouses ADD COLUMN operating_days_json TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]'")
        if "operation_24h_yn" not in warehouse_columns:
            connection.execute("ALTER TABLE warehouses ADD COLUMN operation_24h_yn INTEGER NOT NULL DEFAULT 0")
        if "shifts_enabled_yn" not in warehouse_columns:
            connection.execute("ALTER TABLE warehouses ADD COLUMN shifts_enabled_yn INTEGER NOT NULL DEFAULT 1")
        shift_columns = {row["name"] for row in connection.execute("PRAGMA table_info(shifts)")}
        if "warehouse_id" not in shift_columns:
            connection.execute("ALTER TABLE shifts ADD COLUMN warehouse_id INTEGER REFERENCES warehouses(id)")
        if "schedule_mode" not in shift_columns:
            connection.execute("ALTER TABLE shifts ADD COLUMN schedule_mode TEXT NOT NULL DEFAULT 'MULTI'")
        connection.execute("""CREATE TABLE IF NOT EXISTS warehouse_deactivation_reports(
            id INTEGER PRIMARY KEY AUTOINCREMENT,report_number TEXT NOT NULL UNIQUE,warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
            warehouse_code TEXT NOT NULL,warehouse_name TEXT NOT NULL,deactivation_reason TEXT NOT NULL,stock_quantity REAL NOT NULL DEFAULT 0,
            fifo_quantity REAL NOT NULL DEFAULT 0,open_task_count INTEGER NOT NULL DEFAULT 0,snapshot_json TEXT NOT NULL,
            deactivated_by INTEGER NOT NULL REFERENCES users(id),deactivated_at TEXT NOT NULL DEFAULT(datetime('now')),
            created_at TEXT NOT NULL DEFAULT(datetime('now')))""")
        connection.execute('CREATE INDEX IF NOT EXISTS idx_warehouse_deactivation_reports_warehouse ON warehouse_deactivation_reports(warehouse_id,deactivated_at)')
        templates = connection.execute("SELECT * FROM shifts WHERE warehouse_id IS NULL AND active_yn=1 ORDER BY start_time,id").fetchall()
        for warehouse in connection.execute("SELECT id FROM warehouses WHERE deleted_at IS NULL").fetchall():
            if connection.execute("SELECT 1 FROM shifts WHERE warehouse_id=? LIMIT 1", (warehouse["id"],)).fetchone():
                continue
            for sequence, template in enumerate(templates, 1):
                connection.execute("""INSERT INTO shifts(shift_code,shift_label,start_time,end_time,cross_midnight_yn,break_minutes,
                    department_scope,active_yn,warehouse_id) VALUES(?,?,?,?,?,?,?,1,?)""",
                    (f"WH{warehouse['id']}-{template['shift_code']}", template['shift_label'], template['start_time'], template['end_time'],
                     template['cross_midnight_yn'], template['break_minutes'], 'Warehouse', warehouse['id']))
        connection.execute("""CREATE TABLE IF NOT EXISTS item_categories(
            id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL COLLATE NOCASE UNIQUE,active_yn INTEGER NOT NULL DEFAULT 1,
            created_by INTEGER REFERENCES users(id),created_at TEXT NOT NULL DEFAULT(datetime('now')))""")
        connection.execute("""CREATE TABLE IF NOT EXISTS item_subcategories(
            id INTEGER PRIMARY KEY AUTOINCREMENT,category_id INTEGER NOT NULL REFERENCES item_categories(id),
            name TEXT NOT NULL COLLATE NOCASE,active_yn INTEGER NOT NULL DEFAULT 1,created_by INTEGER REFERENCES users(id),
            created_at TEXT NOT NULL DEFAULT(datetime('now')),UNIQUE(category_id,name))""")
        connection.execute("""CREATE TABLE IF NOT EXISTS warehouse_operating_schedules(
            id INTEGER PRIMARY KEY AUTOINCREMENT,warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
            is_open INTEGER NOT NULL DEFAULT 1,open_time TEXT,close_time TEXT,cross_midnight_yn INTEGER NOT NULL DEFAULT 0,
            created_by INTEGER REFERENCES users(id),created_at TEXT NOT NULL DEFAULT(datetime('now')),updated_by INTEGER REFERENCES users(id),updated_at TEXT,
            UNIQUE(warehouse_id,weekday))""")
        for warehouse in connection.execute('SELECT id,operating_start_time,operating_end_time,operating_days_json,operation_24h_yn FROM warehouses WHERE deleted_at IS NULL').fetchall():
            try:operating_days={int(value)for value in __import__('json').loads(warehouse['operating_days_json']or'[]')}
            except (TypeError,ValueError):operating_days=set(range(7))
            for weekday in range(7):
                is_open=int(bool(warehouse['operation_24h_yn']or weekday in operating_days));opening='00:00'if warehouse['operation_24h_yn']else warehouse['operating_start_time']if is_open else None;closing='00:00'if warehouse['operation_24h_yn']else warehouse['operating_end_time']if is_open else None
                connection.execute('INSERT OR IGNORE INTO warehouse_operating_schedules(warehouse_id,weekday,is_open,open_time,close_time,cross_midnight_yn)VALUES(?,?,?,?,?,?)',(warehouse['id'],weekday,is_open,opening,closing,int(bool(is_open and closing<=opening))))
        calendar_columns={row['name'] for row in connection.execute('PRAGMA table_info(employee_work_calendar)')}
        for column,definition in {'warehouse_time_zone':'TEXT','warehouse_open_time':'TEXT','warehouse_close_time':'TEXT'}.items():
            if column not in calendar_columns:connection.execute(f'ALTER TABLE employee_work_calendar ADD COLUMN {column} {definition}')
        holiday_columns={row['name'] for row in connection.execute('PRAGMA table_info(holidays)')}
        holiday_additions={'region':'TEXT','observed_date':'TEXT','calendar_year':'INTEGER','day_scope':'TEXT NOT NULL DEFAULT \'FULL_DAY\'','start_time':'TEXT','end_time':'TEXT','applicability':'TEXT NOT NULL DEFAULT \'WAREHOUSE\'','notes':'TEXT'}
        for column,definition in holiday_additions.items():
            if column not in holiday_columns:connection.execute(f'ALTER TABLE holidays ADD COLUMN {column} {definition}')
        exchange_columns={row['name'] for row in connection.execute('PRAGMA table_info(exchange_rates)')}
        for column,definition in {'synchronized_at':'TEXT','synchronized_by':'INTEGER REFERENCES users(id)'}.items():
            if column not in exchange_columns:connection.execute(f'ALTER TABLE exchange_rates ADD COLUMN {column} {definition}')
        connection.execute("""CREATE TABLE IF NOT EXISTS holiday_work_exceptions(
            id INTEGER PRIMARY KEY AUTOINCREMENT,holiday_id INTEGER NOT NULL REFERENCES holidays(id),warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
            employee_id INTEGER REFERENCES employees(id),shift_id INTEGER REFERENCES shifts(id),work_required INTEGER NOT NULL DEFAULT 1,reason TEXT NOT NULL,
            approved_by INTEGER NOT NULL REFERENCES users(id),approved_at TEXT NOT NULL DEFAULT(datetime('now')),created_at TEXT NOT NULL DEFAULT(datetime('now')),
            UNIQUE(holiday_id,warehouse_id,employee_id,shift_id))""")
        connection.execute("""CREATE TABLE IF NOT EXISTS system_maintenance(
            id INTEGER PRIMARY KEY CHECK(id=1),active_yn INTEGER NOT NULL DEFAULT 0,reason TEXT,cycle_id TEXT,scheduled_at_utc TEXT,
            started_at TEXT,completed_at TEXT,result TEXT,session_epoch INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL DEFAULT(datetime('now')))""")
        connection.execute("INSERT OR IGNORE INTO system_maintenance(id)VALUES(1)")
        connection.execute("""CREATE TABLE IF NOT EXISTS backup_cycles(
            id INTEGER PRIMARY KEY AUTOINCREMENT,cycle_id TEXT NOT NULL UNIQUE,scheduled_at_utc TEXT NOT NULL,backup_time_zone TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'SCHEDULED',warning_30_at TEXT,warning_20_at TEXT,warning_10_at TEXT,started_at TEXT,completed_at TEXT,
            backup_reference TEXT,verification_result TEXT,error_message TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now')),updated_at TEXT NOT NULL DEFAULT(datetime('now')))""")
        notification_columns={row['name'] for row in connection.execute('PRAGMA table_info(notifications)')}
        if 'event_key' not in notification_columns:connection.execute('ALTER TABLE notifications ADD COLUMN event_key TEXT')
        if 'expires_at' not in notification_columns:connection.execute('ALTER TABLE notifications ADD COLUMN expires_at TEXT')
        connection.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_event_user ON notifications(event_key,user_id) WHERE event_key IS NOT NULL')
        defaults={'automatic_month_end_backup':'1','backup_time':'16:00','backup_time_zone':'Asia/Riyadh','backup_warning_minutes':'30','backup_reminder_minutes':'10',
            'procurement_shifts_enabled':'1','procurement_operating_start_time':'08:00','procurement_operating_end_time':'17:00','procurement_operating_days':'[0,1,2,3,4]'}
        for key,value in defaults.items():connection.execute('INSERT OR IGNORE INTO settings(key,value)VALUES(?,?)',(key,value))
        shift_mode_initialized=connection.execute("SELECT 1 FROM settings WHERE key='shift_mode_initialized'").fetchone()
        if not shift_mode_initialized:
            connection.execute("INSERT INTO settings(key,value)VALUES('procurement_shifts_enabled','1')ON CONFLICT(key)DO UPDATE SET value='1'")
        procurement_start=(connection.execute("SELECT value FROM settings WHERE key='procurement_operating_start_time'").fetchone()or{'value':'08:00'})['value'];procurement_end=(connection.execute("SELECT value FROM settings WHERE key='procurement_operating_end_time'").fetchone()or{'value':'17:00'})['value'];procurement_enabled=(connection.execute("SELECT value FROM settings WHERE key='procurement_shifts_enabled'").fetchone()or{'value':'0'})['value']=='1'
        psh,psm=map(int,procurement_start[:5].split(':'));peh,pem=map(int,procurement_end[:5].split(':'));procurement_duration=((peh*60+pem)-(psh*60+psm))%1440 or 1440;procurement_break=30 if procurement_duration>=360 else(15 if procurement_duration>=240 else 0);procurement_finish=(peh*60+pem+procurement_break)%1440;procurement_scheduled_end=f'{procurement_finish//60:02d}:{procurement_finish%60:02d}'
        connection.execute("""INSERT OR IGNORE INTO shifts(shift_code,shift_label,start_time,end_time,cross_midnight_yn,break_minutes,department_scope,active_yn,warehouse_id,schedule_mode)
          VALUES('PROC-STANDARD','Procurement Standard Hours',?,?,?,?,'Procurement',?,NULL,'STANDARD')""",(procurement_start,procurement_scheduled_end,int(psh*60+psm+procurement_duration+procurement_break>=1440),procurement_break,int(not procurement_enabled)))
        connection.execute("UPDATE shifts SET active_yn=? WHERE warehouse_id IS NULL AND schedule_mode='MULTI'",(int(procurement_enabled),))
        connection.execute("UPDATE shifts SET start_time=?,end_time=?,cross_midnight_yn=?,break_minutes=?,active_yn=? WHERE warehouse_id IS NULL AND schedule_mode='STANDARD'",(procurement_start,procurement_scheduled_end,int(psh*60+psm+procurement_duration+procurement_break>=1440),procurement_break,int(not procurement_enabled)))
        for warehouse in connection.execute('SELECT id,operating_start_time,operating_end_time,shifts_enabled_yn FROM warehouses WHERE deleted_at IS NULL').fetchall():
            start=warehouse['operating_start_time'];end=warehouse['operating_end_time'];enabled=bool(warehouse['shifts_enabled_yn'])
            sh,sm=map(int,start[:5].split(':'));eh,em=map(int,end[:5].split(':'));duration=((eh*60+em)-(sh*60+sm))%1440 or 1440
            standard_break=30 if duration>=360 else(15 if duration>=240 else 0);scheduled_finish=(eh*60+em+standard_break)%1440;scheduled_end=f'{scheduled_finish//60:02d}:{scheduled_finish%60:02d}'
            connection.execute("""INSERT OR IGNORE INTO shifts(shift_code,shift_label,start_time,end_time,cross_midnight_yn,break_minutes,department_scope,active_yn,warehouse_id,schedule_mode)
              VALUES(?,?,?, ?,?,?,'Warehouse',?,?,'STANDARD')""",(f"WH{warehouse['id']}-STANDARD",'Standard Operating Hours',start,scheduled_end,int(sh*60+sm+duration+standard_break>=1440),standard_break,int(not enabled),warehouse['id']))
            connection.execute("UPDATE shifts SET start_time=?,end_time=?,cross_midnight_yn=?,break_minutes=?,active_yn=? WHERE warehouse_id=? AND schedule_mode='STANDARD'",(start,scheduled_end,int(sh*60+sm+duration+standard_break>=1440),standard_break,int(not enabled),warehouse['id']))
            if not shift_mode_initialized:
                rows=list(connection.execute("SELECT id FROM shifts WHERE warehouse_id=? AND schedule_mode='MULTI' ORDER BY ((CAST(substr(start_time,1,2) AS INTEGER)*60+CAST(substr(start_time,4,2) AS INTEGER))-(?)+1440)%1440,id",(warehouse['id'],sh*60+sm)).fetchall())
                count=(duration+479)//480
                for index,row in enumerate(rows):
                    if index<count:
                        block=sh*60+sm+index*480;minutes=min(480,duration-index*480);break_minutes=30 if minutes>=360 else(15 if minutes>=240 else 0);finish=(block+minutes+break_minutes)%1440
                        connection.execute('UPDATE shifts SET start_time=?,end_time=?,cross_midnight_yn=?,break_minutes=?,active_yn=? WHERE id=?',(f'{(block%1440)//60:02d}:{block%60:02d}',f'{finish//60:02d}:{finish%60:02d}',int((block%1440)+minutes+break_minutes>=1440),break_minutes,int(enabled),row['id']))
                    else:connection.execute('UPDATE shifts SET active_yn=0 WHERE id=?',(row['id'],))
        if not shift_mode_initialized:connection.execute("INSERT INTO settings(key,value)VALUES('shift_mode_initialized','1')")
        coverage_repaired=connection.execute("SELECT 1 FROM settings WHERE key='shift_mode_coverage_repaired_v2'").fetchone()
        if not coverage_repaired:
            for warehouse in connection.execute('SELECT id,operating_start_time,operating_end_time,shifts_enabled_yn FROM warehouses WHERE deleted_at IS NULL AND shifts_enabled_yn=1').fetchall():
                start=warehouse['operating_start_time'];end=warehouse['operating_end_time'];sh,sm=map(int,start[:5].split(':'));eh,em=map(int,end[:5].split(':'));duration=((eh*60+em)-(sh*60+sm))%1440 or 1440;count=(duration+479)//480
                rows=list(connection.execute("SELECT id FROM shifts WHERE warehouse_id=? AND schedule_mode='MULTI' ORDER BY ((CAST(substr(start_time,1,2) AS INTEGER)*60+CAST(substr(start_time,4,2) AS INTEGER))-(?)+1440)%1440,id",(warehouse['id'],sh*60+sm)).fetchall())
                for index,row in enumerate(rows):
                    if index<count:
                        block=sh*60+sm+index*480;minutes=min(480,duration-index*480);break_minutes=30 if minutes>=360 else(15 if minutes>=240 else 0);finish=(block+minutes+break_minutes)%1440
                        connection.execute('UPDATE shifts SET start_time=?,end_time=?,cross_midnight_yn=?,break_minutes=?,active_yn=1 WHERE id=?',(f'{(block%1440)//60:02d}:{block%60:02d}',f'{finish//60:02d}:{finish%60:02d}',int((block%1440)+minutes+break_minutes>=1440),break_minutes,row['id']))
                    else:connection.execute('UPDATE shifts SET active_yn=0 WHERE id=?',(row['id'],))
            connection.execute("INSERT INTO settings(key,value)VALUES('shift_mode_coverage_repaired_v2','1')")
        break_end_migrated=connection.execute("SELECT 1 FROM settings WHERE key='break_inclusive_shift_end_v1'").fetchone()
        if not break_end_migrated:
            if shift_mode_initialized:
                for shift in connection.execute("SELECT id,start_time,end_time,break_minutes FROM shifts WHERE schedule_mode='MULTI'").fetchall():
                    eh,em=map(int,shift['end_time'][:5].split(':'));finish=(eh*60+em+int(shift['break_minutes']or 0))%1440;scheduled_end=f'{finish//60:02d}:{finish%60:02d}'
                    connection.execute('UPDATE shifts SET end_time=?,cross_midnight_yn=? WHERE id=?',(scheduled_end,int(scheduled_end<=shift['start_time']),shift['id']))
            connection.execute("UPDATE employee_work_calendar SET shift_end=(SELECT end_time FROM shifts WHERE shifts.id=employee_work_calendar.shift_id) WHERE shift_id IS NOT NULL AND calendar_date>=date('now') AND manual_override_yn=0")
            connection.execute("INSERT INTO settings(key,value)VALUES('break_inclusive_shift_end_v1','1')")
        active_count_repaired=connection.execute("SELECT 1 FROM settings WHERE key='shift_active_count_repaired_v3'").fetchone()
        if not active_count_repaired:
            for warehouse in connection.execute('SELECT id,operating_start_time,operating_end_time,shifts_enabled_yn FROM warehouses WHERE deleted_at IS NULL').fetchall():
                sh,sm=map(int,warehouse['operating_start_time'][:5].split(':'));eh,em=map(int,warehouse['operating_end_time'][:5].split(':'));duration=((eh*60+em)-(sh*60+sm))%1440 or 1440;count=(duration+479)//480
                rows=list(connection.execute("SELECT id FROM shifts WHERE warehouse_id=? AND schedule_mode='MULTI' ORDER BY ((CAST(substr(start_time,1,2) AS INTEGER)*60+CAST(substr(start_time,4,2) AS INTEGER))-(?)+1440)%1440,id",(warehouse['id'],sh*60+sm)).fetchall())
                for index,row in enumerate(rows):connection.execute('UPDATE shifts SET active_yn=? WHERE id=?',(int(bool(warehouse['shifts_enabled_yn'])and index<count),row['id']))
            connection.execute("INSERT INTO settings(key,value)VALUES('shift_active_count_repaired_v3','1')")
        overlap_design_migrated=connection.execute("SELECT 1 FROM settings WHERE key='two_hour_overlap_shift_design_v5'").fetchone()
        if not overlap_design_migrated:
            for warehouse in connection.execute('SELECT id,operating_start_time,operating_end_time,shifts_enabled_yn FROM warehouses WHERE deleted_at IS NULL').fetchall():
                if not warehouse['shifts_enabled_yn']:continue
                start=warehouse['operating_start_time'];sh,sm=map(int,start[:5].split(':'));eh,em=map(int,warehouse['operating_end_time'][:5].split(':'));duration=((eh*60+em)-(sh*60+sm))%1440 or 1440;offset=0;design=[]
                while True:
                    working=duration if duration<=480 else 480;break_minutes=30 if working>=360 else(15 if working>=240 else 0);scheduled=working+break_minutes;finish=(sh*60+sm+offset+scheduled)%1440
                    design.append((f'{((sh*60+sm+offset)%1440)//60:02d}:{(sh*60+sm+offset)%60:02d}',f'{finish//60:02d}:{finish%60:02d}',int((sh*60+sm+offset)%1440+scheduled>=1440),break_minutes))
                    if offset+working>=duration:break
                    offset+=scheduled-120
                rows=list(connection.execute("SELECT id FROM shifts WHERE warehouse_id=? AND schedule_mode='MULTI' ORDER BY ((CAST(substr(start_time,1,2) AS INTEGER)*60+CAST(substr(start_time,4,2) AS INTEGER))-(?)+1440)%1440,id",(warehouse['id'],sh*60+sm)).fetchall())
                for index,values in enumerate(design):
                    if index<len(rows):connection.execute('UPDATE shifts SET start_time=?,end_time=?,cross_midnight_yn=?,break_minutes=?,active_yn=1 WHERE id=?',values+(rows[index]['id'],))
                    else:connection.execute("""INSERT INTO shifts(shift_code,shift_label,start_time,end_time,cross_midnight_yn,break_minutes,department_scope,active_yn,warehouse_id,schedule_mode)
                      VALUES(?,?,?,?,?,?,'Warehouse',1,?,'MULTI')""",(f"WH{warehouse['id']}-SHIFT-{index+1}",f'Shift {index+1}',*values,warehouse['id']))
                for row in rows[len(design):]:connection.execute('UPDATE shifts SET active_yn=0 WHERE id=?',(row['id'],))
            connection.execute("UPDATE employee_work_calendar SET shift_start=(SELECT start_time FROM shifts WHERE shifts.id=employee_work_calendar.shift_id),shift_end=(SELECT end_time FROM shifts WHERE shifts.id=employee_work_calendar.shift_id) WHERE shift_id IS NOT NULL AND calendar_date>=date('now') AND manual_override_yn=0")
            connection.execute("INSERT INTO settings(key,value)VALUES('two_hour_overlap_shift_design_v5','1')")
        close_aligned_design=connection.execute("SELECT 1 FROM settings WHERE key='warehouse_close_aligned_shift_design_v6'").fetchone()
        if not close_aligned_design:
            for warehouse in connection.execute('SELECT id,operating_start_time,operating_end_time,shifts_enabled_yn FROM warehouses WHERE deleted_at IS NULL').fetchall():
                if not warehouse['shifts_enabled_yn']:continue
                start=warehouse['operating_start_time'];sh,sm=map(int,start[:5].split(':'));eh,em=map(int,warehouse['operating_end_time'][:5].split(':'));duration=((eh*60+em)-(sh*60+sm))%1440 or 1440
                if duration<=480:break_minutes=30 if duration>=360 else(15 if duration>=240 else 0);offsets=[0];scheduled_lengths=[duration]
                else:
                    break_minutes=30;final_offset=duration-510;count=max(2,(final_offset+389)//390+1);offsets=[0]+[int(((sh*60+sm+index*final_offset/(count-1))+15)//30)*30-(sh*60+sm) for index in range(1,count-1)]+[final_offset];scheduled_lengths=[510]*count
                design=[]
                for offset,scheduled in zip(offsets,scheduled_lengths):
                    begin=sh*60+sm+offset;finish=begin+scheduled;design.append((f'{(begin%1440)//60:02d}:{begin%60:02d}',f'{(finish%1440)//60:02d}:{finish%60:02d}',int((begin%1440)+scheduled>=1440),break_minutes))
                rows=list(connection.execute("SELECT id FROM shifts WHERE warehouse_id=? AND schedule_mode='MULTI' ORDER BY ((CAST(substr(start_time,1,2) AS INTEGER)*60+CAST(substr(start_time,4,2) AS INTEGER))-(?)+1440)%1440,id",(warehouse['id'],sh*60+sm)).fetchall())
                for index,values in enumerate(design):
                    if index<len(rows):connection.execute('UPDATE shifts SET start_time=?,end_time=?,cross_midnight_yn=?,break_minutes=?,active_yn=1 WHERE id=?',values+(rows[index]['id'],))
                    else:connection.execute("""INSERT INTO shifts(shift_code,shift_label,start_time,end_time,cross_midnight_yn,break_minutes,department_scope,active_yn,warehouse_id,schedule_mode)
                      VALUES(?,?,?,?,?,?,'Warehouse',1,?,'MULTI')""",(f"WH{warehouse['id']}-SHIFT-{index+1}",f'Shift {index+1}',*values,warehouse['id']))
                for row in rows[len(design):]:connection.execute('UPDATE shifts SET active_yn=0 WHERE id=?',(row['id'],))
            connection.execute("UPDATE employee_work_calendar SET shift_start=(SELECT start_time FROM shifts WHERE shifts.id=employee_work_calendar.shift_id),shift_end=(SELECT end_time FROM shifts WHERE shifts.id=employee_work_calendar.shift_id) WHERE shift_id IS NOT NULL AND calendar_date>=date('now') AND manual_override_yn=0")
            connection.execute("INSERT INTO settings(key,value)VALUES('warehouse_close_aligned_shift_design_v6','1')")
        night_shift_labeled=connection.execute("SELECT 1 FROM settings WHERE key='warehouse_fourth_night_shift_label_v1'").fetchone()
        if not night_shift_labeled:
            for warehouse in connection.execute('SELECT id,operating_start_time FROM warehouses WHERE deleted_at IS NULL').fetchall():
                sh,sm=map(int,warehouse['operating_start_time'][:5].split(':'))
                rows=list(connection.execute("SELECT id FROM shifts WHERE warehouse_id=? AND schedule_mode='MULTI' ORDER BY ((CAST(substr(start_time,1,2) AS INTEGER)*60+CAST(substr(start_time,4,2) AS INTEGER))-(?)+1440)%1440,id",(warehouse['id'],sh*60+sm)).fetchall())
                if len(rows)>=4:connection.execute("UPDATE shifts SET shift_label='Night Shift' WHERE id=?",(rows[3]['id'],))
            connection.execute("INSERT INTO settings(key,value)VALUES('warehouse_fourth_night_shift_label_v1','1')")
        standardized_shift_starts=connection.execute("SELECT 1 FROM settings WHERE key='warehouse_half_hour_shift_starts_v7'").fetchone()
        if not standardized_shift_starts:
            for warehouse in connection.execute('SELECT id,operating_start_time,operating_end_time,shifts_enabled_yn FROM warehouses WHERE deleted_at IS NULL').fetchall():
                if not warehouse['shifts_enabled_yn']:continue
                start=warehouse['operating_start_time'];sh,sm=map(int,start[:5].split(':'));eh,em=map(int,warehouse['operating_end_time'][:5].split(':'));duration=((eh*60+em)-(sh*60+sm))%1440 or 1440
                if duration<=480:offsets=[0];scheduled_lengths=[duration];break_minutes=30 if duration>=360 else(15 if duration>=240 else 0)
                else:
                    break_minutes=30;final_offset=duration-510;count=max(2,(final_offset+389)//390+1);offsets=[0]+[int(((sh*60+sm+index*final_offset/(count-1))+15)//30)*30-(sh*60+sm) for index in range(1,count-1)]+[final_offset];scheduled_lengths=[510]*count
                rows=list(connection.execute("SELECT id FROM shifts WHERE warehouse_id=? AND schedule_mode='MULTI' ORDER BY ((CAST(substr(start_time,1,2) AS INTEGER)*60+CAST(substr(start_time,4,2) AS INTEGER))-(?)+1440)%1440,id",(warehouse['id'],sh*60+sm)).fetchall())
                labels=['First Shift','Second Shift','Third Shift','Night Shift']
                for index,(offset,scheduled) in enumerate(zip(offsets,scheduled_lengths)):
                    begin=sh*60+sm+offset;finish=begin+scheduled;values=(labels[index],f'{(begin%1440)//60:02d}:{begin%60:02d}',f'{(finish%1440)//60:02d}:{finish%60:02d}',int((begin%1440)+scheduled>=1440),break_minutes)
                    if index<len(rows):connection.execute('UPDATE shifts SET shift_label=?,start_time=?,end_time=?,cross_midnight_yn=?,break_minutes=?,active_yn=1 WHERE id=?',values+(rows[index]['id'],))
                for row in rows[len(offsets):]:connection.execute('UPDATE shifts SET active_yn=0 WHERE id=?',(row['id'],))
            connection.execute("UPDATE employee_work_calendar SET shift_start=(SELECT start_time FROM shifts WHERE shifts.id=employee_work_calendar.shift_id),shift_end=(SELECT end_time FROM shifts WHERE shifts.id=employee_work_calendar.shift_id) WHERE shift_id IS NOT NULL AND calendar_date>=date('now') AND manual_override_yn=0")
            connection.execute("INSERT INTO settings(key,value)VALUES('warehouse_half_hour_shift_starts_v7','1')")
        taxonomy = {
            'Raw Material':['Cement','Fine Aggregate / Sand','Coarse Aggregate','Admixture','Water','Steel','Reinforcement Steel','Steel Mesh','Prestressing Steel','Fibres','Inserts & Cast-in Items'],
            'Production Consumable':['Abrasive','Binding & Tying','Curing','Grout','Release Agent','Repair Material','Sealant','Spacers & Chairs','Steel Consumable','Welding','Formwork Consumable'],
            'PPE':['Head Protection','Eye Protection','Face Protection','Hearing Protection','Hand Protection','Foot Protection','Respiratory Protection','Fall Protection','Visibility','Protective Clothing'],
            'Tool':['Hand Tool','Power Tool','Measuring Tool','Cutting Tool','Concrete Tool','Rigging Tool','Welding Tool'],
            'Tools':['Hand Tools','Power Tools','Measuring Tools','Cutting Tools','Concrete Tools'],
            'Equipment':['Formwork','Moulds','Batching Plant','Concrete Vibrator','Lifting & Handling','Crane & Hoist','Generator','Compressor','Welding Equipment','Workshop Equipment'],
            'Electrical':['Cable & Wire','Temporary Power','Plug & Socket','Switchgear','Motor & Drive','Lighting','Insulation','Fastening','Electrical Spare'],
            'Mechanical':['Bearing','Belt & Chain','Pump','Valve','Hydraulic Component','Pneumatic Component','Machine Spare','Fabricated Part'],
            'Fastener':['Bolt & Nut','Washer','Anchor','Screw','Rivet','Threaded Rod','Clamp'],
            'Maintenance Consumable':['Lubricant','Chemical','Cleaning','Filter','Seal & Gasket','Workshop Consumable'],
            'Warehouse Consumable':['Pallet','Packaging','Labeling','Stationery','Storage Bin','Material Handling'],
            'QC / Laboratory':['Concrete Testing','Aggregate Testing','Cement Testing','Dimensional Inspection','Calibration Standard','Laboratory Consumable','Sample Preparation'],
            'Fuel & Lubricants':['Diesel','Petrol','Hydraulic Oil','Gear Oil','Engine Oil','Grease','Coolant'],
            'Chemicals':['Construction Chemical','Industrial Chemical','Water Treatment','Cleaning Chemical','Coating & Paint'],
            'Consumables':['Accessories','Lubricants','Cleaning','Packaging','General Consumable'],
            'Production':['Concrete','Reinforcement','Prestressing','Mould Preparation','Finishing'],
        }
        for row in connection.execute("SELECT DISTINCT trim(category) category,trim(subcategory) subcategory FROM items WHERE trim(COALESCE(category,''))<>''").fetchall():
            taxonomy.setdefault(row['category'],[])
            if row['subcategory'] and row['subcategory'] not in taxonomy[row['category']]:taxonomy[row['category']].append(row['subcategory'])
        for category,subcategories in taxonomy.items():
            connection.execute("INSERT OR IGNORE INTO item_categories(name)VALUES(?)",(category,))
            category_id=connection.execute("SELECT id FROM item_categories WHERE name=? COLLATE NOCASE",(category,)).fetchone()['id']
            for subcategory in subcategories:connection.execute("INSERT OR IGNORE INTO item_subcategories(category_id,name)VALUES(?,?)",(category_id,subcategory))
        for supplier in connection.execute('SELECT id FROM suppliers WHERE deleted_at IS NULL').fetchall():
            totals=connection.execute('SELECT COALESCE(SUM(gi.quantity_received),0) received,COALESCE(SUM(gi.accepted_qty),0) accepted FROM grn_items gi JOIN grns g ON g.id=gi.grn_id WHERE g.supplier_id=?',(supplier['id'],)).fetchone()
            delivery=connection.execute('SELECT COUNT(*) deliveries,SUM(CASE WHEN po.committed_delivery_date IS NOT NULL AND date(g.grn_date)<=date(po.committed_delivery_date) THEN 1 ELSE 0 END) on_time FROM grns g JOIN purchase_orders po ON po.id=g.po_id WHERE g.supplier_id=? AND po.committed_delivery_date IS NOT NULL',(supplier['id'],)).fetchone()
            ordered=connection.execute('SELECT COALESCE(SUM(pi.quantity),0) quantity FROM po_items pi JOIN purchase_orders po ON po.id=pi.po_id WHERE po.supplier_id=? AND EXISTS(SELECT 1 FROM grns g WHERE g.po_id=po.id)',(supplier['id'],)).fetchone()['quantity']
            received=float(totals['received']or 0);accepted=float(totals['accepted']or 0)
            rating=0 if not received else round(5*(min(1,accepted/received)*.45+min(1,accepted/float(ordered or accepted or 1))*.25+(float(delivery['on_time']or 0)/float(delivery['deliveries']or 1))*.30),2)
            connection.execute('UPDATE suppliers SET rating=? WHERE id=?',(rating,supplier['id']))
    with connect() as connection:
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
