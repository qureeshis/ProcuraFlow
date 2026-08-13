import bcrypt from 'bcryptjs';
import db from './index';

function upsertUser(username: string, password: string, full_name: string, role: string) {
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined;
  const hash = bcrypt.hashSync(password, 10);
  if (exists) {
    db.prepare("UPDATE users SET password_hash=?,full_name=?,role=?,is_active=1,deleted_at=NULL,must_change_password=1,password_changed_at=datetime('now'),password_expires_at=datetime('now','+7 days'),locked_reason=NULL WHERE id=?").run(hash, full_name, role, exists.id);
    return;
  }
  db.prepare(
    "INSERT INTO users (username,password_hash,full_name,role,must_change_password,password_changed_at,password_expires_at) VALUES (?,?,?,?,1,datetime('now'),datetime('now','+7 days'))"
  ).run(username, hash, full_name, role);
}

function run() {
  console.log('Seeding ProcuraFlow demo data...');

  // Demo logins correspond only to login-enabled employees.
  upsertUser('ali.qureshi', 'password123', 'Ali Qureshi', 'SupplyChainManager');
  upsertUser('hamza.khan', 'password123', 'Hamza Khan', 'WarehouseSupervisor');
  db.prepare("UPDATE users SET is_active=0,deleted_at=COALESCE(deleted_at,datetime('now')) WHERE username NOT IN ('ali.qureshi','hamza.khan')").run();

  // Company
  if (!db.prepare('SELECT id FROM company LIMIT 1').get()) {
    db.prepare(
      `INSERT INTO company (name, address, tax_info, currency, financial_year)
       VALUES (?, ?, ?, ?, ?)`
    ).run('Precast Industries Ltd', '123 Industrial Zone, Dubai, UAE', 'TRN-100234567', 'SAR', 'FY2026');
  }

  // Departments
  const depts = ['Production', 'Maintenance', 'Quality', 'Electrical', 'Mechanical', 'Administration'];
  const deptStmt = db.prepare('INSERT OR IGNORE INTO departments (name) VALUES (?)');
  depts.forEach((d) => deptStmt.run(d));

  const deptId = (name: string) =>
    (db.prepare('SELECT id FROM departments WHERE name = ?').get(name) as any).id;

  // Employees
  if (!db.prepare('SELECT id FROM employees LIMIT 1').get()) {
    const empStmt = db.prepare(
      `INSERT INTO employees (employee_code, name, department_id, position, supervisor, status)
       VALUES (?, ?, ?, ?, ?, 'Active')`
    );
    empStmt.run('EMP_001', 'Ali Qureshi', deptId('Administration'), 'Supply Chain Manager', null);
    empStmt.run('EMP_002', 'Hamza Khan', deptId('Production'), 'Warehouse Supervisor', 'Ali Qureshi');
    db.prepare("UPDATE employees SET approval_role=CASE name WHEN 'Ali Qureshi' THEN 'SupplyChainManager' WHEN 'Hamza Khan' THEN 'WarehouseSupervisor' END WHERE name IN ('Ali Qureshi','Hamza Khan')").run();
  }

  // Suppliers
  if (!db.prepare('SELECT id FROM suppliers LIMIT 1').get()) {
    const supStmt = db.prepare(
      `INSERT INTO suppliers (supplier_code, name, contact_person, phone, email, address, payment_terms, rating)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    supStmt.run('SUP-001', 'Gulf Steel Supplies', 'Omar Faris', '+971-50-1234567', 'sales@gulfsteel.example', 'Jebel Ali, Dubai', 'Net 30', 4.5);
    supStmt.run('SUP-002', 'Al Waha Safety Equipment', 'Nadia Karam', '+971-50-7654321', 'orders@alwaha.example', 'Sharjah Industrial', 'Net 45', 4.0);
    supStmt.run('SUP-003', 'Precast Formwork Co.', 'John Baptiste', '+971-50-9988776', 'info@formworkco.example', 'Abu Dhabi', 'Net 30', 4.8);
  }

  // Items
  if (!db.prepare('SELECT id FROM items LIMIT 1').get()) {
    const itemStmt = db.prepare(
      `INSERT INTO items (item_code, description, category, subcategory, uom, purchase_uom, issue_uom, conversion_factor,
         consumable_returnable, high_value_flag, always_approval_yn, tool_control_yn, batch_control_yn, expiry_control_yn,
         inspection_required_yn, min_stock, max_stock, reorder_level, standard_cost, last_purchase_price)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    itemStmt.run('ITM-001', 'Safety Gloves', 'PPE', 'Hand Protection', 'PR', 'BOX', 'PR', 12, 'Consumable', 0, 0, 0, 0, 0, 0, 50, 500, 100, 3.5, 3.5);
    itemStmt.run('ITM-002', 'Rebar 12mm', 'Raw Material', 'Steel', 'KG', 'TON', 'KG', 1000, 'Consumable', 0, 0, 0, 1, 0, 1, 1000, 20000, 3000, 0.85, 0.85);
    itemStmt.run('ITM-003', 'Formwork Panel', 'Equipment', 'Formwork', 'EA', 'EA', 'EA', 1, 'Returnable', 1, 1, 1, 0, 0, 1, 5, 100, 10, 220.0, 220.0);
    itemStmt.run('ITM-004', 'Concrete Vibrator', 'Tools', 'Power Tools', 'EA', 'EA', 'EA', 1, 'Returnable', 1, 1, 1, 0, 0, 1, 2, 20, 4, 450.0, 450.0);
    itemStmt.run('ITM-005', 'Cement Bag 50kg', 'Raw Material', 'Cement', 'BAG', 'PALLET', 'BAG', 40, 'Consumable', 0, 0, 0, 1, 1, 1, 200, 5000, 500, 6.2, 6.2);
  }

  // Warehouses + basic location hierarchy
  if (!db.prepare('SELECT id FROM warehouses LIMIT 1').get()) {
    const whStmt = db.prepare('INSERT INTO warehouses (name) VALUES (?)');
    const mainId = whStmt.run('Main Warehouse').lastInsertRowid as number;
    whStmt.run('Yard Storage');

    const locStmt = db.prepare(
      `INSERT INTO locations (warehouse_id, parent_id, type, code) VALUES (?, ?, ?, ?)`
    );
    const zoneId = locStmt.run(mainId, null, 'Zone', 'Zone A').lastInsertRowid as number;
    const rackId = locStmt.run(mainId, zoneId, 'Rack', 'Rack A').lastInsertRowid as number;
    locStmt.run(mainId, rackId, 'Bin', 'Bin 05');
  }
  const defaultWarehouse = db.prepare('SELECT id FROM warehouses WHERE deleted_at IS NULL ORDER BY id LIMIT 1').get() as any;
  if (defaultWarehouse) {
    db.prepare("UPDATE users SET warehouse_id = COALESCE(warehouse_id, ?) WHERE role IN ('WarehouseManager','WarehouseSupervisor','Storekeeper')").run(defaultWarehouse.id);
    db.prepare("UPDATE employees SET warehouse_id = COALESCE(warehouse_id, ?) WHERE name IN (SELECT full_name FROM users WHERE role IN ('WarehouseManager','WarehouseSupervisor','Storekeeper'))").run(defaultWarehouse.id);
  }

  // Default settings (spec MST_Settings) - material issue approval threshold
  if (!db.prepare("SELECT key FROM settings WHERE key = 'material_issue_approval_threshold'").get()) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('material_issue_approval_threshold', '500');
  }
  if (!db.prepare("SELECT key FROM settings WHERE key = 'global_payment_terms'").get()) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('global_payment_terms', 'Due on Receipt, Net 15, Net 30, Net 45, Net 60, Net 90');
  }
  if (!db.prepare("SELECT key FROM settings WHERE key = 'global_transport_modes'").get()) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('global_transport_modes', 'Company Vehicle, Courier, Third-Party Truck, Employee Hand Carry, Internal Forklift');
  }

  console.log('Seed complete.');
  console.log('Demo logins (all passwords: password123):');
  console.log('  ali.qureshi / hamza.khan');
}

run();
