import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { defaultsForRole } from '../utils/permissions';

dotenv.config();

const brandedDbPath = path.join(__dirname, '../../procuraflow.db');
const DB_PATH = process.env.DB_PATH || brandedDbPath;
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// Initialize schema on first run / every boot (idempotent via IF NOT EXISTS)
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

// SQLite cannot ALTER a CHECK constraint. Upgrade the legacy four-level
// location table once so optional Aisles and flexible BIN parents are valid.
const locationTableSql=(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='locations'").get() as any)?.sql||'';
if(locationTableSql && !locationTableSql.includes("'Aisle'")){
  db.pragma('foreign_keys = OFF');db.pragma('legacy_alter_table = ON');
  db.exec(`ALTER TABLE locations RENAME TO locations_pre_aisle;
    CREATE TABLE locations(id INTEGER PRIMARY KEY AUTOINCREMENT,warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),parent_id INTEGER REFERENCES locations(id),type TEXT NOT NULL CHECK(type IN ('Zone','Aisle','Rack','Shelf','Bin')),code TEXT NOT NULL UNIQUE,label TEXT,location_type TEXT NOT NULL DEFAULT 'Standard BIN',storage_type TEXT,max_quantity REAL,max_weight REAL,max_volume REAL,allowed_category TEXT,restricted_category TEXT,temperature_requirement TEXT,hazardous_material INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'Available',inspection_required INTEGER NOT NULL DEFAULT 0,cycle_count_frequency_days INTEGER,last_cycle_count_date TEXT,next_cycle_count_date TEXT,created_by INTEGER REFERENCES users(id),created_at TEXT NOT NULL DEFAULT(datetime('now')),modified_by INTEGER REFERENCES users(id),modified_at TEXT,deleted_at TEXT);
    INSERT INTO locations(id,warehouse_id,parent_id,type,code,label,deleted_at) SELECT id,warehouse_id,parent_id,type,code,label,deleted_at FROM locations_pre_aisle;
    DROP TABLE locations_pre_aisle;`);
  db.pragma('legacy_alter_table = OFF');db.pragma('foreign_keys = ON');
}

// Migrate company logos stored by earlier releases into the dedicated public
// branding directory. Business-document uploads remain authorization protected.
const companyLogo = db.prepare('SELECT id,logo_url FROM company WHERE logo_url IS NOT NULL ORDER BY id DESC LIMIT 1').get() as { id: number; logo_url: string } | undefined;
if (companyLogo?.logo_url?.startsWith('/uploads/') && !companyLogo.logo_url.startsWith('/uploads/logos/')) {
  const filename = path.basename(companyLogo.logo_url);
  const source = path.join(__dirname, '../../uploads', filename);
  const logoDir = path.join(__dirname, '../../uploads/logos');
  const target = path.join(logoDir, filename);
  if (fs.existsSync(source)) {
    fs.mkdirSync(logoDir, { recursive: true });
    if (!fs.existsSync(target)) fs.copyFileSync(source, target);
    db.prepare('UPDATE company SET logo_url=? WHERE id=?').run(`/uploads/logos/${filename}`, companyLogo.id);
  }
}

function ensureColumn(table: string, column: string, definition: string) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!existing.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('items', 'default_warehouse_id', 'INTEGER');
ensureColumn('items', 'default_location_id', 'INTEGER');
ensureColumn('employees', 'reports_to', 'TEXT');
ensureColumn('employees', 'approval_limit', 'REAL');
ensureColumn('employees', 'approval_role', 'TEXT');
ensureColumn('employees', 'first_name', 'TEXT');
ensureColumn('employees', 'middle_name', 'TEXT');
ensureColumn('employees', 'last_name', 'TEXT');
ensureColumn('employees', 'date_of_birth', 'TEXT');
ensureColumn('employees', 'payroll_number', 'TEXT');
ensureColumn('employees', 'email', 'TEXT');
ensureColumn('employees', 'signature_url', 'TEXT');
ensureColumn('employees', 'warehouse_id', 'INTEGER');
ensureColumn('employees', 'permission_keys', 'TEXT');
ensureColumn('transfers','status',"TEXT NOT NULL DEFAULT 'In Transit'");
ensureColumn('transfers','dispatched_by','INTEGER REFERENCES users(id)');
ensureColumn('transfers','dispatched_at','TEXT');
ensureColumn('transfers','received_by','INTEGER REFERENCES users(id)');
ensureColumn('transfers','received_at','TEXT');
ensureColumn('transfers','receiving_reference','TEXT');
ensureColumn('transfers','receiving_note','TEXT');
ensureColumn('transfers','unit_cost','REAL NOT NULL DEFAULT 0');
// Legacy transfers credited their destination immediately and are already received.
db.prepare("UPDATE transfers SET status='Received',received_at=COALESCE(received_at,transfer_date||' 00:00:00'),receiving_reference=COALESCE(receiving_reference,'LEGACY-'||transfer_number) WHERE dispatched_at IS NULL").run();
ensureColumn('employees', 'employment_start_date', 'TEXT');
ensureColumn('employees', 'employment_end_date', 'TEXT');
ensureColumn('users', 'warehouse_id', 'INTEGER');
ensureColumn('users', 'employee_id', 'INTEGER');
ensureColumn('transfers', 'transport_mode', 'TEXT');
ensureColumn('transfers', 'vehicle_reference', 'TEXT');
ensureColumn('transfers', 'driver_name', 'TEXT');
ensureColumn('transfers', 'tracking_reference', 'TEXT');
ensureColumn('transfers', 'remarks', 'TEXT');
ensureColumn('tools', 'make', 'TEXT');
ensureColumn('tools', 'model', 'TEXT');
ensureColumn('supplier_quotations', 'freight', 'REAL NOT NULL DEFAULT 0');
ensureColumn('supplier_quotations', 'tax', 'REAL NOT NULL DEFAULT 0');
ensureColumn('supplier_quotations', 'currency', "TEXT NOT NULL DEFAULT 'SAR'");
ensureColumn('company', 'country_code', "TEXT DEFAULT 'SA'");
ensureColumn('company', 'base_currency', "TEXT DEFAULT 'SAR'");
ensureColumn('company', 'time_zone', "TEXT DEFAULT 'Asia/Riyadh'");
ensureColumn('suppliers', 'country_code', 'TEXT');
ensureColumn('suppliers', 'preferred_currency', 'TEXT');
ensureColumn('purchase_orders', 'transaction_currency', 'TEXT');
ensureColumn('purchase_orders', 'exchange_rate', 'REAL NOT NULL DEFAULT 1');
ensureColumn('purchase_orders', 'base_currency', 'TEXT');
ensureColumn('purchase_orders', 'base_currency_amount', 'REAL');
ensureColumn('invoices', 'transaction_currency', 'TEXT');
ensureColumn('invoices', 'exchange_rate', 'REAL NOT NULL DEFAULT 1');
ensureColumn('invoices', 'base_currency', 'TEXT');
ensureColumn('invoices', 'base_currency_amount', 'REAL');
ensureColumn('employees', 'reports_to_employee_id', 'INTEGER REFERENCES employees(id)');
ensureColumn('employees', 'system_access_yn', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('employee_work_calendar', 'warehouse_id', 'INTEGER REFERENCES warehouses(id)');
ensureColumn('company', 'city_id', 'INTEGER REFERENCES cities(id)');
ensureColumn('company', 'postal_code', 'TEXT');
ensureColumn('company', 'region_province', 'TEXT');
ensureColumn('employees', 'country_code', 'TEXT');
ensureColumn('employees', 'city_id', 'INTEGER REFERENCES cities(id)');
ensureColumn('employees', 'address_line', 'TEXT');
ensureColumn('employees', 'postal_code', 'TEXT');
ensureColumn('suppliers', 'city_id', 'INTEGER REFERENCES cities(id)');
ensureColumn('suppliers', 'postal_code', 'TEXT');
ensureColumn('suppliers', 'region_province', 'TEXT');
ensureColumn('warehouses', 'country_code', 'TEXT');
ensureColumn('warehouses', 'city_id', 'INTEGER REFERENCES cities(id)');
ensureColumn('warehouses', 'postal_code', 'TEXT');
ensureColumn('warehouses', 'region_province', 'TEXT');
ensureColumn('items', 'active_yn', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('items', 'replacement_item_id', 'INTEGER REFERENCES items(id)');
ensureColumn('items', 'duplicate_status', "TEXT DEFAULT 'Not Reviewed'");
db.prepare('UPDATE employee_work_calendar SET warehouse_id=(SELECT warehouse_id FROM employees WHERE employees.id=employee_work_calendar.employee_id) WHERE warehouse_id IS NULL').run();
// ProcuraFlow currently records and compares operational monetary values in the
// company's base currency. Normalize legacy quotation defaults so reports never
// add or compare unconverted currencies.
const currencySeed=[['SAR','Saudi Riyal','SAR',2],['AED','UAE Dirham','AED',2],['USD','US Dollar','$',2],['CAD','Canadian Dollar','C$',2],['GBP','British Pound','£',2],['EUR','Euro','€',2],['PKR','Pakistani Rupee','Rs',2],['INR','Indian Rupee','₹',2],['CNY','Chinese Yuan','¥',2],['JPY','Japanese Yen','¥',0],['QAR','Qatari Riyal','QAR',2],['OMR','Omani Rial','OMR',3],['KWD','Kuwaiti Dinar','KWD',3],['BHD','Bahraini Dinar','BHD',3]] as const;
const insertCurrency=db.prepare('INSERT OR IGNORE INTO currencies(currency_code,currency_name,currency_symbol,decimal_places) VALUES(?,?,?,?)');currencySeed.forEach(row=>insertCurrency.run(...row));
const countrySeed=[['SA','Saudi Arabia','SA','SAU','SAR','+966'],['AE','United Arab Emirates','AE','ARE','AED','+971'],['CA','Canada','CA','CAN','CAD','+1'],['US','United States','US','USA','USD','+1'],['GB','United Kingdom','GB','GBR','GBP','+44'],['PK','Pakistan','PK','PAK','PKR','+92'],['IN','India','IN','IND','INR','+91'],['CN','China','CN','CHN','CNY','+86'],['JP','Japan','JP','JPN','JPY','+81'],['QA','Qatar','QA','QAT','QAR','+974'],['OM','Oman','OM','OMN','OMR','+968'],['KW','Kuwait','KW','KWT','KWD','+965'],['BH','Bahrain','BH','BHR','BHD','+973'],['DE','Germany','DE','DEU','EUR','+49'],['FR','France','FR','FRA','EUR','+33']] as const;
const insertCountry=db.prepare('INSERT OR IGNORE INTO countries(country_code,country_name,iso_alpha2,iso_alpha3,default_currency_code,phone_code) VALUES(?,?,?,?,?,?)');countrySeed.forEach(row=>insertCountry.run(...row));
const citySeed=[['SA','Riyadh','RUH','Riyadh'],['SA','Jeddah','JED','Makkah'],['SA','Dammam','DMM','Eastern Province'],['SA','Mecca','MKK','Makkah'],['SA','Medina','MED','Medina'],['SA','Khobar','KHO','Eastern Province'],['SA','Dhahran','DHA','Eastern Province'],['SA','Jubail','JUB','Eastern Province'],['SA','Yanbu','YNB','Medina'],['SA','Taif','TIF','Makkah'],['SA','Tabuk','TUU','Tabuk'],['SA','Abha','AHB','Asir'],['CA','Toronto','YTO','Ontario'],['CA','Vancouver','YVR','British Columbia'],['CA','Montreal','YMQ','Quebec'],['CA','Calgary','YYC','Alberta'],['CA','Ottawa','YOW','Ontario'],['US','New York','NYC','New York'],['US','Los Angeles','LAX','California'],['AE','Dubai','DXB','Dubai'],['AE','Abu Dhabi','AUH','Abu Dhabi'],['PK','Karachi','KHI','Sindh'],['PK','Lahore','LHE','Punjab']] as const;const insertCity=db.prepare('INSERT OR IGNORE INTO cities(country_code,city_name,city_code,state_province_region) VALUES(?,?,?,?)');citySeed.forEach(row=>insertCity.run(...row));
// Non-destructive migration: preserve every existing employee/user warehouse
// responsibility, and preserve the SCM's prior enterprise-wide scope explicitly.
db.prepare(`INSERT OR IGNORE INTO employee_warehouse_assignments(employee_id,warehouse_id,primary_warehouse_yn,created_by) SELECT e.id,e.warehouse_id,1,NULL FROM employees e WHERE e.warehouse_id IS NOT NULL`).run();
db.prepare(`INSERT OR IGNORE INTO employee_warehouse_assignments(employee_id,warehouse_id,primary_warehouse_yn,created_by) SELECT u.employee_id,uwa.warehouse_id,CASE WHEN u.warehouse_id=uwa.warehouse_id THEN 1 ELSE 0 END,uwa.assigned_by FROM user_warehouse_assignments uwa JOIN users u ON u.id=uwa.user_id WHERE u.employee_id IS NOT NULL AND uwa.is_active=1`).run();
db.prepare(`INSERT OR IGNORE INTO employee_warehouse_assignments(employee_id,warehouse_id,all_warehouses_yn,primary_warehouse_yn,created_by) SELECT id,NULL,1,0,NULL FROM employees WHERE approval_role='SupplyChainManager' AND deleted_at IS NULL`).run();
const insertShift=db.prepare('INSERT OR IGNORE INTO shifts(shift_code,shift_label,start_time,end_time,cross_midnight_yn) VALUES(?,?,?,?,?)');insertShift.run('MORNING','Morning Shift','06:00','14:00',0);insertShift.run('AFTERNOON','Afternoon Shift','14:00','22:00',0);insertShift.run('EVENING','Evening Shift','22:00','06:00',1);
db.prepare("UPDATE company SET country_code=COALESCE(country_code,'SA'),base_currency=COALESCE(base_currency,currency,'SAR'),time_zone=COALESCE(time_zone,'Asia/Riyadh')").run();
const companyCurrency = String((db.prepare("SELECT COALESCE(base_currency,currency) currency FROM company WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1").get() as any)?.currency || 'SAR').toUpperCase();
db.prepare("UPDATE supplier_quotations SET currency=? WHERE currency IS NULL OR currency<>?").run(companyCurrency, companyCurrency);
ensureColumn('returns', 'warehouse_id', 'INTEGER');
ensureColumn('purchase_orders', 'external_approval_required', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('purchase_orders', 'management_approval_request_number', 'TEXT');
ensureColumn('purchase_orders', 'pr_id', 'INTEGER');
ensureColumn('purchase_orders', 'committed_delivery_date', 'TEXT');
ensureColumn('purchase_requisitions', 'auto_generated', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('purchase_requisitions', 'closed_manually', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'password_changed_at', 'TEXT');
ensureColumn('users', 'password_expires_at', 'TEXT');
ensureColumn('users', 'locked_reason', 'TEXT');
ensureColumn('invoices', 'finance_pack_reference', 'TEXT');
ensureColumn('invoices', 'finance_pack_status', "TEXT NOT NULL DEFAULT 'Not Submitted'");
ensureColumn('invoices', 'finance_review_comments', 'TEXT');
ensureColumn('invoices', 'variance_reason', 'TEXT');
ensureColumn('invoices', 'variance_acceptance_note', 'TEXT');
ensureColumn('invoices', 'reconciliation_adjustment', 'REAL NOT NULL DEFAULT 0');
ensureColumn('invoices', 'adjustment_reason', 'TEXT');
ensureColumn('invoices', 'adjusted_invoice_total', 'REAL');
ensureColumn('invoices', 'variance_accepted_by', 'INTEGER');
ensureColumn('invoices', 'variance_accepted_at', 'TEXT');
ensureColumn('invoices', 'reconciliation_classification', 'TEXT');
ensureColumn('invoices', 'reconciliation_reason_code', 'TEXT');
ensureColumn('invoices', 'recommended_adjustment', 'REAL');
ensureColumn('invoices', 'adjustment_manual_override', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('invoices', 'source_documents_match', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('approval_log','approval_value','REAL');
ensureColumn('approval_log','approval_currency','TEXT');
ensureColumn('approval_log','approval_limit_used','REAL');
ensureColumn('approval_log','approval_limit_source','TEXT');
ensureColumn('approval_log','approval_limit_version','INTEGER');
ensureColumn('approval_log','approval_limit_effective_at','TEXT');
ensureColumn('approval_log','approver_employee_id','INTEGER');
ensureColumn('approval_log','approver_role','TEXT');
ensureColumn('approval_log','workflow_level','TEXT');
ensureColumn('approval_log','escalation_rule','TEXT');
ensureColumn('company', 'installation_id', 'TEXT');
ensureColumn('company', 'licensed_company_name', 'TEXT');
ensureColumn('company', 'license_locked_at', 'TEXT');
ensureColumn('company', 'phone', 'TEXT');
ensureColumn('company', 'email', 'TEXT');
ensureColumn('company', 'website', 'TEXT');
ensureColumn('company', 'registration_number', 'TEXT');
ensureColumn('company', 'branch_info', 'TEXT');
ensureColumn('warehouses', 'warehouse_code', 'TEXT');
ensureColumn('warehouses', 'site_type', "TEXT NOT NULL DEFAULT 'Factory'");
ensureColumn('warehouses', 'site_name', 'TEXT');
ensureColumn('warehouses', 'address', 'TEXT');
ensureColumn('warehouses', 'city', 'TEXT');
ensureColumn('locations', 'label', 'TEXT');
ensureColumn('locations', 'location_type', "TEXT NOT NULL DEFAULT 'Standard BIN'");
ensureColumn('locations', 'storage_type', 'TEXT');
ensureColumn('locations', 'max_quantity', 'REAL');
ensureColumn('locations', 'max_weight', 'REAL');
ensureColumn('locations', 'max_volume', 'REAL');
ensureColumn('locations', 'allowed_category', 'TEXT');
ensureColumn('locations', 'restricted_category', 'TEXT');
ensureColumn('locations', 'temperature_requirement', 'TEXT');
ensureColumn('locations', 'hazardous_material', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('locations', 'status', "TEXT NOT NULL DEFAULT 'Available'");
ensureColumn('locations', 'inspection_required', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('locations', 'cycle_count_frequency_days', 'INTEGER');
ensureColumn('locations', 'last_cycle_count_date', 'TEXT');
ensureColumn('locations', 'next_cycle_count_date', 'TEXT');
ensureColumn('locations', 'created_by', 'INTEGER');
ensureColumn('locations', 'created_at', 'TEXT');
ensureColumn('locations', 'modified_by', 'INTEGER');
ensureColumn('locations', 'modified_at', 'TEXT');
ensureColumn('inventory_layers', 'location_id', 'INTEGER');
ensureColumn('material_issue_items', 'location_id', 'INTEGER');
ensureColumn('returns', 'location_id', 'INTEGER');
ensureColumn('stock_adjustments', 'location_id', 'INTEGER');
ensureColumn('tools','warehouse_id','INTEGER');
db.exec(`UPDATE tools SET warehouse_id=COALESCE((SELECT warehouse_id FROM employees WHERE employees.id=tools.employee_id),(SELECT MIN(warehouse_id) FROM inventory_stock WHERE inventory_stock.item_id=tools.item_id HAVING COUNT(DISTINCT warehouse_id)=1)) WHERE warehouse_id IS NULL`);
db.exec("UPDATE warehouses SET warehouse_code='WH-'||printf('%03d',id) WHERE warehouse_code IS NULL OR trim(warehouse_code)=''");
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_code ON warehouses(warehouse_code) WHERE warehouse_code IS NOT NULL');
db.exec(`UPDATE locations SET code=(SELECT warehouse_code FROM warehouses WHERE warehouses.id=locations.warehouse_id)||'-'||
  CASE type WHEN 'Zone' THEN 'ZN' WHEN 'Rack' THEN 'RK' WHEN 'Shelf' THEN 'SH' ELSE 'BN' END||'-'||printf('%04d',id)
  WHERE code IS NULL OR code NOT LIKE 'WH-%'`);
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_code ON locations(code) WHERE deleted_at IS NULL');
db.exec('CREATE INDEX IF NOT EXISTS idx_locations_warehouse_status ON locations(warehouse_id,status,type)');
db.exec('CREATE INDEX IF NOT EXISTS idx_stock_item_location ON inventory_stock(item_id,warehouse_id,location_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_layers_location_batch ON inventory_layers(item_id,warehouse_id,location_id,batch,received_date)');
db.exec('CREATE INDEX IF NOT EXISTS idx_ledger_warehouse_location_date ON stock_ledger(warehouse_id,location_id,created_at)');
db.exec(`INSERT OR IGNORE INTO user_warehouse_assignments(user_id,warehouse_id,assignment_role,is_active,effective_from)
  SELECT id,warehouse_id,role,1,date(created_at) FROM users WHERE warehouse_id IS NOT NULL AND deleted_at IS NULL`);
// Existing FIFO layers predate bin-level costing. Link a layer when its source
// GRN line already contains a location; otherwise it remains warehouse-level.
db.exec('UPDATE inventory_layers SET location_id=(SELECT gi.location_id FROM grn_items gi WHERE gi.id=inventory_layers.source_grn_item_id) WHERE location_id IS NULL AND source_grn_item_id IS NOT NULL');
db.exec(`UPDATE inventory_stock SET location_id=(
  SELECT MIN(l.id) FROM locations l WHERE l.warehouse_id=inventory_stock.warehouse_id AND l.type='Bin'
  HAVING COUNT(*)=1
) WHERE location_id IS NULL`);
// Legacy opening balances pre-date location-aware FIFO. Where an item has one
// unambiguous stocked position in a warehouse, attach those layers to it.
db.exec(`UPDATE inventory_layers SET location_id=(
  SELECT MIN(s.location_id) FROM inventory_stock s
  WHERE s.item_id=inventory_layers.item_id AND s.warehouse_id=inventory_layers.warehouse_id AND s.location_id IS NOT NULL
  HAVING COUNT(DISTINCT s.location_id)=1
) WHERE location_id IS NULL`);
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_company_installation_id ON company(installation_id) WHERE installation_id IS NOT NULL');

// A production installation can be permanently bound to its purchasing
// company by setting LICENSED_COMPANY_NAME. The value is stored in the database
// as well as the deployment environment so copied databases cannot silently be
// rebranded for another organization.
const licensedCompanyName = String(process.env.LICENSED_COMPANY_NAME || '').trim();
let installedCompany = db.prepare('SELECT * FROM company WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1').get() as any;
if (installedCompany && !installedCompany.installation_id) {
  db.prepare('UPDATE company SET installation_id=? WHERE id=?').run(crypto.randomUUID(), installedCompany.id);
  installedCompany = db.prepare('SELECT * FROM company WHERE id=?').get(installedCompany.id) as any;
}
if (licensedCompanyName && installedCompany) {
  if (installedCompany.licensed_company_name && installedCompany.licensed_company_name.toLowerCase() !== licensedCompanyName.toLowerCase()) {
    throw new Error('Company license mismatch: this database is locked to a different company');
  }
  db.prepare(`UPDATE company SET name=?,licensed_company_name=?,license_locked_at=COALESCE(license_locked_at,datetime('now')) WHERE id=?`)
    .run(licensedCompanyName, licensedCompanyName, installedCompany.id);
}
db.exec("UPDATE users SET password_changed_at = COALESCE(password_changed_at, created_at, datetime('now')), password_expires_at = COALESCE(password_expires_at, datetime(COALESCE(created_at, 'now'), '+90 days'))");
// Permanently link existing login accounts to their employee master records.
// Name matching is used only for this one-time migration of legacy accounts.
db.exec(`UPDATE users SET employee_id = (
  SELECT e.id FROM employees e
  WHERE lower(trim(e.name)) = lower(trim(users.full_name)) AND e.deleted_at IS NULL
  ORDER BY e.id DESC LIMIT 1
) WHERE employee_id IS NULL`);
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_active_employee ON users(employee_id) WHERE employee_id IS NOT NULL AND deleted_at IS NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_email ON employees(email) WHERE email IS NOT NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tools_serial_number ON tools(serial_number) WHERE serial_number IS NOT NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_po_management_approval_request ON purchase_orders(management_approval_request_number) WHERE management_approval_request_number IS NOT NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_po_pr_conversion ON purchase_orders(pr_id) WHERE pr_id IS NOT NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_finance_pack_reference ON invoices(finance_pack_reference) WHERE finance_pack_reference IS NOT NULL');
// Partial deliveries require more than one GRN per PO. Remove the obsolete
// one-GRN constraint if it was created by an earlier application version.
db.exec('DROP INDEX IF EXISTS idx_grns_one_per_po');
// Earlier releases allowed only one PO per PR. Rebuild the link table once so
// partial PR quantities can be purchased through multiple controlled POs.
const poPrLinksSql=(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='po_pr_links'").get() as any)?.sql||'';
if(/pr_id\s+INTEGER\s+NOT\s+NULL\s+UNIQUE/i.test(poPrLinksSql)){
  db.pragma('foreign_keys = OFF');
  db.exec(`ALTER TABLE po_pr_links RENAME TO po_pr_links_single_po;
    CREATE TABLE po_pr_links(id INTEGER PRIMARY KEY AUTOINCREMENT,po_id INTEGER NOT NULL REFERENCES purchase_orders(id),pr_id INTEGER NOT NULL REFERENCES purchase_requisitions(id),UNIQUE(po_id,pr_id));
    INSERT OR IGNORE INTO po_pr_links(id,po_id,pr_id) SELECT id,po_id,pr_id FROM po_pr_links_single_po;
    DROP TABLE po_pr_links_single_po;`);
  db.pragma('foreign_keys = ON');
}
// PR workflow: approval is recorded in approval_log; the PR remains Submitted
// until it is converted to a PO, which is the only event that closes it.
db.exec("UPDATE purchase_requisitions SET status='Submitted' WHERE status='Approved'");
db.exec(`UPDATE purchase_requisitions SET status='Submitted' WHERE status='Closed' AND auto_generated=1
  AND EXISTS (SELECT 1 FROM approval_log al WHERE al.document_type='PR' AND al.document_id=purchase_requisitions.id AND al.decision='Approved')
  AND NOT EXISTS (SELECT 1 FROM po_pr_links ppl WHERE ppl.pr_id=purchase_requisitions.id)
  AND NOT EXISTS (SELECT 1 FROM purchase_orders po WHERE po.pr_id=purchase_requisitions.id)`);
// Automatic replenishment is system work, not the personal work of whichever
// manager account happened to be available when the background job ran.
db.exec("UPDATE purchase_requisitions SET requestor_id=NULL WHERE auto_generated=1 AND status='Submitted'");
// Warehouse scope belongs only to Warehouse-department employees. Clean up
// legacy hidden assignments so UI, authorization and reporting stay aligned.
db.exec(`UPDATE employee_warehouse_assignments SET active_yn=0,effective_to=COALESCE(effective_to,date('now')) WHERE employee_id IN (SELECT e.id FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE lower(COALESCE(d.name,''))<>'warehouse');
  UPDATE employees SET warehouse_id=NULL WHERE id IN (SELECT e.id FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE lower(COALESCE(d.name,''))<>'warehouse');
  UPDATE users SET warehouse_id=NULL WHERE employee_id IN (SELECT e.id FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE lower(COALESCE(d.name,''))<>'warehouse');`);
for(const employee of db.prepare("SELECT id,permission_keys FROM employees WHERE approval_role NOT IN ('SupplyChainManager','PurchaseManager','PurchaseOfficer') AND permission_keys IS NOT NULL").all()as any[]){try{const keys=JSON.parse(employee.permission_keys);if(Array.isArray(keys)&&keys.includes('task.items'))db.prepare('UPDATE employees SET permission_keys=? WHERE id=?').run(JSON.stringify(keys.filter((key:string)=>key!=='task.items')),employee.id);}catch{/* Invalid legacy permission JSON is handled by role validation. */}}
// Linked employee scope is authoritative. In particular, NULL is intentional
// for an all-warehouses manager and must not be replaced by the first warehouse.
db.exec(`UPDATE users SET warehouse_id=(SELECT e.warehouse_id FROM employees e WHERE e.id=users.employee_id) WHERE employee_id IS NOT NULL AND EXISTS(SELECT 1 FROM employees e WHERE e.id=users.employee_id)`);

db.exec(`CREATE TABLE IF NOT EXISTS audit_finding_closure(id INTEGER PRIMARY KEY AUTOINCREMENT,finding_id TEXT NOT NULL UNIQUE,original_audit_date TEXT NOT NULL,severity TEXT NOT NULL,module TEXT NOT NULL,issue TEXT NOT NULL,root_cause TEXT,remediation TEXT,testing_performed TEXT,evidence TEXT,resolved_by INTEGER REFERENCES users(id),resolution_date TEXT,status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','IN PROGRESS','RESOLVED','ACCEPTED RISK','NOT APPLICABLE')),residual_risk TEXT,management_decision TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now')),updated_at TEXT NOT NULL DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS legacy_ledger_reconciliation(id INTEGER PRIMARY KEY AUTOINCREMENT,warning_key TEXT NOT NULL UNIQUE,item_id INTEGER NOT NULL REFERENCES items(id),warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),location_id INTEGER REFERENCES locations(id),current_quantity REAL NOT NULL,fifo_quantity REAL NOT NULL,ledger_quantity REAL NOT NULL,quantity_difference REAL NOT NULL,current_value REAL,fifo_value REAL,ledger_value REAL,value_difference REAL,earliest_relevant_transaction TEXT,earliest_ledger_transaction TEXT,opening_balance_record TEXT,root_cause_classification TEXT NOT NULL DEFAULT 'Unknown / Requires Investigation',supporting_evidence TEXT,financial_impact TEXT,inventory_impact TEXT,risk_level TEXT NOT NULL DEFAULT 'HIGH',recommended_resolution TEXT,approval_required INTEGER NOT NULL DEFAULT 1,resolution_status TEXT NOT NULL DEFAULT 'UNDER INVESTIGATION' CHECK(resolution_status IN('RESOLVED','APPROVED LEGACY EXCEPTION','CONTROLLED ADJUSTMENT REQUIRED','NO FINANCIAL IMPACT','UNDER INVESTIGATION')),approved_by INTEGER REFERENCES users(id),approved_at TEXT,reviewed_by INTEGER REFERENCES users(id),reviewed_at TEXT,notes TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now')),updated_at TEXT NOT NULL DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS sod_conflict_reviews(id INTEGER PRIMARY KEY AUTOINCREMENT,conflict_key TEXT NOT NULL UNIQUE,user_id INTEGER NOT NULL REFERENCES users(id),employee_id INTEGER REFERENCES employees(id),permission_a TEXT NOT NULL,permission_b TEXT NOT NULL,conflict_description TEXT NOT NULL,risk TEXT NOT NULL,business_justification TEXT,recommended_action TEXT,management_decision TEXT,compensating_control TEXT,review_date TEXT,expiry_date TEXT,status TEXT NOT NULL DEFAULT 'REQUIRES MANAGEMENT REVIEW' CHECK(status IN('TRUE CONFLICT','APPROVED BUSINESS EXCEPTION','FALSE POSITIVE','REQUIRES MANAGEMENT REVIEW')),approved_by INTEGER REFERENCES users(id),approval_date TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now')),updated_at TEXT NOT NULL DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS control_test_results(id INTEGER PRIMARY KEY AUTOINCREMENT,test_suite TEXT NOT NULL,test_name TEXT NOT NULL,report_api TEXT,test_user TEXT,assigned_warehouse TEXT,requested_warehouse TEXT,expected_result TEXT,actual_result TEXT,status TEXT NOT NULL CHECK(status IN('PASS','FAIL','NOT TESTED')),evidence TEXT,executed_at TEXT NOT NULL DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS backup_restore_history(id INTEGER PRIMARY KEY AUTOINCREMENT,backup_reference TEXT NOT NULL UNIQUE,backup_type TEXT NOT NULL,created_by INTEGER REFERENCES users(id),database_included INTEGER NOT NULL DEFAULT 1,attachments_included INTEGER NOT NULL DEFAULT 0,configuration_included INTEGER NOT NULL DEFAULT 0,backup_status TEXT NOT NULL,restore_tested INTEGER NOT NULL DEFAULT 0,restore_test_date TEXT,restore_tested_by INTEGER REFERENCES users(id),restore_result TEXT,notes TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS accounting_periods(id INTEGER PRIMARY KEY AUTOINCREMENT,fiscal_year TEXT NOT NULL,period TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','SOFT CLOSED','CLOSED')),closed_by INTEGER REFERENCES users(id),closed_at TEXT,reopened_by INTEGER REFERENCES users(id),reopened_at TEXT,reason TEXT,UNIQUE(fiscal_year,period));
CREATE TABLE IF NOT EXISTS document_revisions(id INTEGER PRIMARY KEY AUTOINCREMENT,document_type TEXT NOT NULL,document_id INTEGER NOT NULL,revision_number INTEGER NOT NULL,changed_by INTEGER REFERENCES users(id),change_reason TEXT NOT NULL,previous_values TEXT NOT NULL,new_values TEXT NOT NULL,approval_status TEXT NOT NULL DEFAULT 'Pending Reapproval',reapproved_by INTEGER REFERENCES users(id),reapproval_date TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now')),UNIQUE(document_type,document_id,revision_number));`);
ensureColumn('legacy_ledger_reconciliation','management_decision','TEXT');
ensureColumn('legacy_ledger_reconciliation','business_explanation','TEXT');
ensureColumn('legacy_ledger_reconciliation','evidence_reference','TEXT');
ensureColumn('legacy_ledger_reconciliation','audit_reference','TEXT');
ensureColumn('sod_conflict_reviews','permission_change','TEXT');
ensureColumn('accounting_periods','period_number','INTEGER');
ensureColumn('accounting_periods','start_date','TEXT');
ensureColumn('accounting_periods','end_date','TEXT');
ensureColumn('accounting_periods','approval_reference','TEXT');
ensureColumn('document_revisions','reapproval_required','INTEGER NOT NULL DEFAULT 1');
ensureColumn('control_test_results','is_current','INTEGER NOT NULL DEFAULT 1');
ensureColumn('control_test_results','superseded_by','TEXT');
ensureColumn('material_issues','authorization_limit_id','INTEGER');
ensureColumn('material_issues','authorization_value_limit','REAL');
ensureColumn('material_issues','authorization_currency','TEXT');
ensureColumn('material_issues','authorization_role','TEXT');
db.exec(`CREATE TABLE IF NOT EXISTS material_issue_authorization_limits(id INTEGER PRIMARY KEY AUTOINCREMENT,employee_id INTEGER NOT NULL REFERENCES employees(id),warehouse_id INTEGER REFERENCES warehouses(id),value_limit REAL NOT NULL CHECK(value_limit>=0),currency TEXT NOT NULL,quantity_limit REAL,category_scope TEXT,effective_from TEXT NOT NULL DEFAULT(date('now')),expiry_date TEXT,active_yn INTEGER NOT NULL DEFAULT 1,approved_by INTEGER NOT NULL REFERENCES users(id),approval_date TEXT NOT NULL DEFAULT(datetime('now')),created_at TEXT NOT NULL DEFAULT(datetime('now')),updated_at TEXT NOT NULL DEFAULT(datetime('now')));
CREATE INDEX IF NOT EXISTS idx_issue_limits_active ON material_issue_authorization_limits(employee_id,warehouse_id,active_yn,effective_from,expiry_date);
CREATE TABLE IF NOT EXISTS approval_limit_history(id INTEGER PRIMARY KEY AUTOINCREMENT,employee_id INTEGER NOT NULL REFERENCES employees(id),approval_type TEXT NOT NULL,old_limit REAL,new_limit REAL NOT NULL,currency TEXT NOT NULL,effective_from TEXT NOT NULL DEFAULT(date('now')),expiry_date TEXT,approved_by INTEGER NOT NULL REFERENCES users(id),approval_date TEXT NOT NULL DEFAULT(datetime('now')),status TEXT NOT NULL DEFAULT 'ACTIVE',created_at TEXT NOT NULL DEFAULT(datetime('now')));`);
db.exec(`CREATE TABLE IF NOT EXISTS legacy_ledger_disposition_batches(id INTEGER PRIMARY KEY AUTOINCREMENT,batch_reference TEXT NOT NULL UNIQUE,common_root_cause TEXT NOT NULL,common_evidence TEXT NOT NULL,evidence_reference TEXT NOT NULL,management_decision TEXT NOT NULL,business_explanation TEXT NOT NULL,audit_reference TEXT NOT NULL,reviewed_by INTEGER NOT NULL REFERENCES users(id),reviewed_at TEXT NOT NULL DEFAULT(datetime('now')),approved_by INTEGER REFERENCES users(id),approved_at TEXT,status TEXT NOT NULL DEFAULT 'AWAITING APPROVAL' CHECK(status IN('AWAITING APPROVAL','APPROVED','REJECTED')),created_at TEXT NOT NULL DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS legacy_ledger_batch_items(id INTEGER PRIMARY KEY AUTOINCREMENT,batch_id INTEGER NOT NULL REFERENCES legacy_ledger_disposition_batches(id),warning_id INTEGER NOT NULL REFERENCES legacy_ledger_reconciliation(id),UNIQUE(batch_id,warning_id));`);
db.exec(`UPDATE control_test_results SET is_current=0,superseded_by='PHASE 3 REPORT_ACCURACY_PHASE3' WHERE test_suite='REPORT_ACCURACY' AND status='NOT TESTED' AND test_name IN('Bin Stock','Invoice Register','PO vs GRN','PO vs Invoice','GRN vs Invoice','Three-Way Match') AND EXISTS(SELECT 1 FROM control_test_results newer WHERE newer.test_suite='REPORT_ACCURACY_PHASE3' AND newer.test_name=control_test_results.test_name AND newer.status='PASS');`);
const phase31Actions:Record<string,string[]>={PurchaseOfficer:['po.view','po.create','po.edit','po.approve','po.reject','po.print','vendor.view','vendor.create','vendor.edit'],PurchaseManager:['po.view','po.create','po.edit','po.approve','po.reject','po.print','vendor.view','vendor.create','vendor.edit','vendor.disable'],Storekeeper:['po.view','grn.view','grn.post','issue.view','issue.post'],WarehouseSupervisor:['po.view','grn.view','grn.post','issue.view','issue.post','adjustment.view','adjustment.create'],WarehouseManager:['po.view','grn.view','grn.post','issue.view','issue.post','adjustment.view','adjustment.create','adjustment.approve']};
for(const employee of db.prepare('SELECT id,approval_role,permission_keys FROM employees WHERE deleted_at IS NULL').all()as any[]){let keys:string[];try{keys=employee.permission_keys?JSON.parse(employee.permission_keys):[];}catch{keys=[];}const merged=Array.from(new Set([...keys,...(phase31Actions[employee.approval_role]||[])]));if(merged.length!==keys.length)db.prepare('UPDATE employees SET permission_keys=? WHERE id=?').run(JSON.stringify(merged),employee.id);}
const phase31LegacyDefaults:Record<string,string[]>={Storekeeper:['task.pr','task.po','task.grn','task.material_issue','task.returns','task.inventory','task.tools','report.inventory','report.warehouse','report.employee','report.tools'],WarehouseSupervisor:['task.pr','task.po','task.grn','task.material_issue','task.returns','task.transfers','task.adjustments','task.inventory','task.cycle_count','task.tools','task.warehouses','report.inventory','report.warehouse','report.employee','report.tools'],WarehouseManager:['task.pr','task.po','task.grn','task.material_issue','task.returns','task.transfers','task.adjustments','task.inventory','task.cycle_count','task.tools','task.employees','task.warehouses','report.inventory','report.warehouse','report.employee','report.tools']};
for(const employee of db.prepare("SELECT id,approval_role,permission_keys FROM employees WHERE approval_role IN('Storekeeper','WarehouseSupervisor','WarehouseManager') AND deleted_at IS NULL").all()as any[]){let keys:string[];try{keys=JSON.parse(employee.permission_keys||'[]');}catch{keys=[];}const actions=phase31Actions[employee.approval_role]||[];if(keys.length&&keys.every((key:string)=>actions.includes(key)))db.prepare('UPDATE employees SET permission_keys=? WHERE id=?').run(JSON.stringify(Array.from(new Set([...(phase31LegacyDefaults[employee.approval_role]||[]),...actions]))),employee.id);}
for(const employee of db.prepare("SELECT id FROM employees WHERE approval_role='SupplyChainManager' AND deleted_at IS NULL").all()as any[])db.prepare('UPDATE employees SET permission_keys=? WHERE id=?').run(JSON.stringify(defaultsForRole('SupplyChainManager')),employee.id);
db.exec(`INSERT OR IGNORE INTO legacy_ledger_reconciliation(warning_key,item_id,warehouse_id,location_id,current_quantity,fifo_quantity,ledger_quantity,quantity_difference,current_value,fifo_value,ledger_value,value_difference,earliest_relevant_transaction,earliest_ledger_transaction,opening_balance_record,root_cause_classification,financial_impact,inventory_impact,risk_level,recommended_resolution)
SELECT 'ITEM-'||k.item_id||'-WH-'||k.warehouse_id,k.item_id,k.warehouse_id,
 CASE WHEN (SELECT COUNT(DISTINCT location_id) FROM inventory_stock WHERE item_id=k.item_id AND warehouse_id=k.warehouse_id)=1 THEN (SELECT MIN(location_id) FROM inventory_stock WHERE item_id=k.item_id AND warehouse_id=k.warehouse_id) END,
 COALESCE((SELECT SUM(quantity) FROM inventory_stock WHERE item_id=k.item_id AND warehouse_id=k.warehouse_id),0),
 COALESCE((SELECT SUM(quantity_remaining) FROM inventory_layers WHERE item_id=k.item_id AND warehouse_id=k.warehouse_id),0),
 COALESCE((SELECT SUM(quantity_change) FROM stock_ledger WHERE item_id=k.item_id AND warehouse_id=k.warehouse_id),0),
 COALESCE((SELECT SUM(quantity) FROM inventory_stock WHERE item_id=k.item_id AND warehouse_id=k.warehouse_id),0)-COALESCE((SELECT SUM(quantity_change) FROM stock_ledger WHERE item_id=k.item_id AND warehouse_id=k.warehouse_id),0),
 COALESCE((SELECT SUM(quantity_remaining*unit_cost) FROM inventory_layers WHERE item_id=k.item_id AND warehouse_id=k.warehouse_id),0),
 COALESCE((SELECT SUM(quantity_remaining*unit_cost) FROM inventory_layers WHERE item_id=k.item_id AND warehouse_id=k.warehouse_id),0),
 COALESCE((SELECT SUM(quantity_change*unit_cost) FROM stock_ledger WHERE item_id=k.item_id AND warehouse_id=k.warehouse_id),0),
 COALESCE((SELECT SUM(quantity_remaining*unit_cost) FROM inventory_layers WHERE item_id=k.item_id AND warehouse_id=k.warehouse_id),0)-COALESCE((SELECT SUM(quantity_change*unit_cost) FROM stock_ledger WHERE item_id=k.item_id AND warehouse_id=k.warehouse_id),0),
 (SELECT MIN(received_date) FROM inventory_layers WHERE item_id=k.item_id AND warehouse_id=k.warehouse_id),(SELECT MIN(created_at) FROM stock_ledger WHERE item_id=k.item_id AND warehouse_id=k.warehouse_id),
 CASE WHEN (SELECT MIN(created_at) FROM stock_ledger WHERE item_id=k.item_id AND warehouse_id=k.warehouse_id) IS NULL THEN 'Stock/FIFO exists without a ledger entry' ELSE 'Stock existed before earliest retained ledger activity' END,
 CASE WHEN (SELECT MIN(created_at) FROM stock_ledger WHERE item_id=k.item_id AND warehouse_id=k.warehouse_id) IS NULL THEN 'Missing Opening Ledger Entry' ELSE 'Pre-Ledger Transaction' END,
 'Value difference is recorded; Finance review required before disposition','No current quantity impact because stock and FIFO reconcile','HIGH','Verify original opening/import evidence; approve a legacy exception or post a controlled prospective adjustment only when evidence requires it'
FROM (SELECT item_id,warehouse_id FROM inventory_stock UNION SELECT item_id,warehouse_id FROM inventory_layers) k
WHERE ABS(COALESCE((SELECT SUM(quantity) FROM inventory_stock WHERE item_id=k.item_id AND warehouse_id=k.warehouse_id),0)-COALESCE((SELECT SUM(quantity_change) FROM stock_ledger WHERE item_id=k.item_id AND warehouse_id=k.warehouse_id),0))>.0001;`);
const initialFindings=[
 ['PF-2026-001','2026-08-11','HIGH','Attachments','Attachment parent-document authorization gap','Role-only authorization omitted related warehouse scope','Added parent-document and assigned-warehouse authorization','Backend build and authenticated API review','backend/src/routes/attachments.routes.ts','RESOLVED'],
 ['PF-2026-002','2026-08-11','HIGH','Warehouse','Direct GRN detail warehouse-scope gap','Detail route did not repeat list scope','Added active assigned-warehouse check','Backend build and integrity audit','backend/src/routes/warehouse.routes.ts','RESOLVED'],
 ['PF-2026-003','2026-08-11','HIGH','Reports','Spreadsheet formula/HTML injection','Dynamic export values were interpolated','Added HTML encoding and formula neutralization','Frontend production build','frontend/src/pages/reports/ReportsPage.tsx','RESOLVED'],
 ['PF-2026-004','2026-08-11','HIGH','Inventory','Legacy permanent-ledger reconciliation warnings','Historical stock predates complete ledger coverage','Created permanent reconciliation register; evidence review required','Current stock/FIFO PASS; ledger warnings registered','legacy_ledger_reconciliation','IN PROGRESS'],
 ['PF-2026-005','2026-08-11','HIGH','Access Control','Non-management segregation-of-duties conflicts','Broad role task combinations','Created permanent review register; management disposition required','SoD report and register','sod_conflict_reviews','IN PROGRESS'],
 ['PF-2026-006','2026-08-11','HIGH','Reports','Warehouse report APIs were not uniformly assignment-scoped','Legacy reports used role checks without warehouse predicates','Applied backend active-assignment scope to warehouse-related reports','Production build and warehouse verification suite required','backend/src/routes/reports.routes.ts','IN PROGRESS']
];
const findingInsert=db.prepare(`INSERT OR IGNORE INTO audit_finding_closure(finding_id,original_audit_date,severity,module,issue,root_cause,remediation,testing_performed,evidence,status,resolution_date) VALUES(?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='RESOLVED' THEN date('now') END)`);
initialFindings.forEach(f=>findingInsert.run(...f,f[9]));

export default db;
