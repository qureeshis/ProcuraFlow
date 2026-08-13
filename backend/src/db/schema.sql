-- =====================================================================
-- ProcuraFlow Professional Edition - Database Schema (SQLite for local demo)
-- ProcuraFlow Procurement, Warehouse & Material Management System
-- Section references (in comments) map back to the original spec.
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- SECTION 4: USER MANAGEMENT & SECURITY
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER REFERENCES employees(id),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'SupplyChainManager','PurchaseManager','PurchaseOfficer',
    'WarehouseManager','WarehouseSupervisor','Storekeeper'
  )),
  is_active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  password_changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  password_expires_at TEXT NOT NULL DEFAULT (datetime('now', '+90 days')),
  locked_reason TEXT,
  warehouse_id INTEGER REFERENCES warehouses(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS login_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  username_attempted TEXT,
  success INTEGER NOT NULL,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_activity (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  page_path TEXT,
  current_action TEXT,
  ip_address TEXT,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS user_activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  username TEXT NOT NULL,
  role TEXT NOT NULL,
  department_name TEXT,
  warehouse_name TEXT,
  event_type TEXT NOT NULL,
  current_action TEXT NOT NULL,
  page_path TEXT,
  ip_address TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_user_activity_log_occurred ON user_activity_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_log_user ON user_activity_log(user_id,occurred_at DESC);

-- ---------------------------------------------------------------------
-- SECTION 5: MASTER DATA
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  registration_number TEXT,
  branch_info TEXT,
  logo_url TEXT,
  tax_info TEXT,
  currency TEXT DEFAULT 'SAR',
  financial_year TEXT,
  installation_id TEXT UNIQUE,
  licensed_company_name TEXT,
  license_locked_at TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  first_name TEXT,
  middle_name TEXT,
  last_name TEXT,
  date_of_birth TEXT,
  payroll_number TEXT,
  email TEXT UNIQUE,
  signature_url TEXT,
  warehouse_id INTEGER REFERENCES warehouses(id),
  department_id INTEGER REFERENCES departments(id),
  position TEXT,
  supervisor TEXT,
  permission_keys TEXT,
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  payment_terms TEXT,
  rating REAL DEFAULT 0,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_code TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL,
  category TEXT,
  subcategory TEXT,
  uom TEXT NOT NULL DEFAULT 'EA',
  purchase_uom TEXT,
  issue_uom TEXT,
  conversion_factor REAL NOT NULL DEFAULT 1,
  consumable_returnable TEXT NOT NULL DEFAULT 'Consumable' CHECK (consumable_returnable IN ('Consumable','Returnable')),
  high_value_flag INTEGER NOT NULL DEFAULT 0,
  always_approval_yn INTEGER NOT NULL DEFAULT 0,
  tool_control_yn INTEGER NOT NULL DEFAULT 0,
  batch_control_yn INTEGER NOT NULL DEFAULT 0,
  expiry_control_yn INTEGER NOT NULL DEFAULT 0,
  inspection_required_yn INTEGER NOT NULL DEFAULT 0,
  min_stock REAL DEFAULT 0,
  max_stock REAL DEFAULT 0,
  reorder_level REAL DEFAULT 0,
  standard_cost REAL DEFAULT 0,
  last_purchase_price REAL DEFAULT 0,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  warehouse_code TEXT UNIQUE,
  site_type TEXT NOT NULL DEFAULT 'Factory' CHECK (site_type IN ('Factory','Construction Site','Remote Yard','Distribution Center','Other')),
  site_name TEXT,
  address TEXT,
  city TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS user_warehouse_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  assignment_role TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  effective_from TEXT NOT NULL DEFAULT (date('now')),
  effective_to TEXT,
  assigned_by INTEGER REFERENCES users(id),
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, warehouse_id)
);

-- Warehouse > Zone > Rack > Shelf > Bin (self-referencing hierarchy)
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  parent_id INTEGER REFERENCES locations(id),
  type TEXT NOT NULL CHECK (type IN ('Zone','Aisle','Rack','Shelf','Bin')),
  code TEXT NOT NULL UNIQUE,
  label TEXT,
  location_type TEXT NOT NULL DEFAULT 'Standard BIN',
  storage_type TEXT,
  max_quantity REAL,
  max_weight REAL,
  max_volume REAL,
  allowed_category TEXT,
  restricted_category TEXT,
  temperature_requirement TEXT,
  hazardous_material INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Available',
  inspection_required INTEGER NOT NULL DEFAULT 0,
  cycle_count_frequency_days INTEGER,
  last_cycle_count_date TEXT,
  next_cycle_count_date TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  modified_by INTEGER REFERENCES users(id),
  modified_at TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS item_warehouse_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id), warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  primary_location_id INTEGER REFERENCES locations(id), secondary_location_id INTEGER REFERENCES locations(id),
  overflow_location_id INTEGER REFERENCES locations(id), return_location_id INTEGER REFERENCES locations(id), quarantine_location_id INTEGER REFERENCES locations(id),
  picking_rule TEXT NOT NULL DEFAULT 'FIFO' CHECK(picking_rule IN ('FIFO','FEFO')),
  UNIQUE(item_id,warehouse_id)
);

CREATE TABLE IF NOT EXISTS stock_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL REFERENCES items(id), warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  location_id INTEGER NOT NULL REFERENCES locations(id), quantity REAL NOT NULL CHECK(quantity>0), status TEXT NOT NULL DEFAULT 'Active',
  reference_type TEXT, reference_id INTEGER, created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT(datetime('now'))
);

-- ---------------------------------------------------------------------
-- SECTION 6: PROCUREMENT MODULE
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_requisitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pr_number TEXT UNIQUE NOT NULL,
  pr_date TEXT NOT NULL DEFAULT (date('now')),
  requestor_id INTEGER REFERENCES users(id),
  department_id INTEGER REFERENCES departments(id),
  auto_generated INTEGER NOT NULL DEFAULT 0 CHECK (auto_generated IN (0,1)),
  closed_manually INTEGER NOT NULL DEFAULT 0 CHECK (closed_manually IN (0,1)),
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Submitted','Approved','Rejected','Closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pr_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pr_id INTEGER NOT NULL REFERENCES purchase_requisitions(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  required_date TEXT,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS rfqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rfq_number TEXT UNIQUE NOT NULL,
  pr_id INTEGER REFERENCES purchase_requisitions(id),
  rfq_date TEXT NOT NULL DEFAULT (date('now')),
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Closed'))
);

CREATE TABLE IF NOT EXISTS rfq_suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rfq_id INTEGER NOT NULL REFERENCES rfqs(id),
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id)
);

CREATE TABLE IF NOT EXISTS supplier_quotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rfq_id INTEGER NOT NULL REFERENCES rfqs(id),
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  price REAL NOT NULL,
  freight REAL NOT NULL DEFAULT 0 CHECK (freight >= 0),
  tax REAL NOT NULL DEFAULT 0 CHECK (tax >= 0),
  currency TEXT NOT NULL DEFAULT 'SAR',
  delivery_time_days INTEGER,
  payment_terms TEXT,
  quality_rating REAL,
  warranty TEXT,
  selected INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_number TEXT UNIQUE NOT NULL,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  pr_id INTEGER REFERENCES purchase_requisitions(id),
  rfq_id INTEGER REFERENCES rfqs(id),
  po_date TEXT NOT NULL DEFAULT (date('now')),
  committed_delivery_date TEXT,
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','PendingApproval','Approved','Rejected','Printed','Closed')),
  total_amount REAL NOT NULL DEFAULT 0,
  approval_ref_number TEXT,
  approval_person_name TEXT,
  external_approval_required INTEGER NOT NULL DEFAULT 0 CHECK (external_approval_required IN (0,1)),
  management_approval_request_number TEXT UNIQUE,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS po_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  price REAL NOT NULL CHECK (price >= 0),
  tax REAL NOT NULL DEFAULT 0 CHECK (tax >= 0)
);

CREATE TABLE IF NOT EXISTS po_pr_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  pr_id INTEGER NOT NULL REFERENCES purchase_requisitions(id),
  UNIQUE(po_id, pr_id)
);

-- Quantity-level traceability allows one PR to be fulfilled by several POs.
CREATE TABLE IF NOT EXISTS po_pr_item_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  pr_id INTEGER NOT NULL REFERENCES purchase_requisitions(id),
  pr_item_id INTEGER NOT NULL REFERENCES pr_items(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  quantity REAL NOT NULL CHECK(quantity > 0),
  UNIQUE(po_id, pr_item_id)
);

-- ---------------------------------------------------------------------
-- SECTION 7: WAREHOUSE MANAGEMENT
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grn_number TEXT UNIQUE NOT NULL,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  delivery_note TEXT,
  grn_date TEXT NOT NULL DEFAULT (date('now')),
  accepted_value REAL NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grn_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grn_id INTEGER NOT NULL REFERENCES grns(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  quantity_received REAL NOT NULL CHECK (quantity_received > 0),
  accepted_qty REAL NOT NULL CHECK (accepted_qty >= 0),
  rejected_qty REAL NOT NULL DEFAULT 0 CHECK (rejected_qty >= 0),
  rejection_reason TEXT,
  unit_cost REAL NOT NULL CHECK (unit_cost >= 0),
  batch TEXT,
  expiry_date TEXT,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  location_id INTEGER REFERENCES locations(id)
);

-- Section 8.4 / 15.6: Invoice register + PO-GRN-Invoice three-way match
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT NOT NULL,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  grn_id INTEGER REFERENCES grns(id),
  invoice_date TEXT NOT NULL DEFAULT (date('now')),
  invoice_total REAL NOT NULL CHECK (invoice_total >= 0),
  tax REAL NOT NULL DEFAULT 0 CHECK (tax >= 0),
  match_status TEXT NOT NULL DEFAULT 'Pending' CHECK (match_status IN ('Pending','Matched','Variance','Verified')),
  verified_by INTEGER REFERENCES users(id),
  verified_date TEXT,
  finance_pack_reference TEXT UNIQUE,
  finance_pack_status TEXT NOT NULL DEFAULT 'Not Submitted',
  finance_review_comments TEXT,
  variance_reason TEXT,
  variance_acceptance_note TEXT,
  reconciliation_adjustment REAL NOT NULL DEFAULT 0,
  adjustment_reason TEXT,
  adjusted_invoice_total REAL,
  variance_accepted_by INTEGER REFERENCES users(id),
  variance_accepted_at TEXT,
  reconciliation_classification TEXT,
  reconciliation_reason_code TEXT,
  recommended_adjustment REAL,
  adjustment_manual_override INTEGER NOT NULL DEFAULT 0,
  source_documents_match INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(invoice_number, supplier_id)
);

-- Phase 3.2: narrowly scoped, temporary external-handoff delegation.
CREATE TABLE IF NOT EXISTS delegated_authorities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delegation_number TEXT NOT NULL UNIQUE,
  delegator_employee_id INTEGER NOT NULL REFERENCES employees(id),
  delegate_employee_id INTEGER NOT NULL REFERENCES employees(id),
  delegate_role TEXT NOT NULL,
  authority_type TEXT NOT NULL CHECK(authority_type='FINANCE_EXTERNAL_HANDOFF'),
  scope_type TEXT NOT NULL DEFAULT 'ALL_PROCUREMENT' CHECK(scope_type IN ('ALL_PROCUREMENT','INVOICE','WAREHOUSE')),
  scope_id INTEGER,
  effective_from TEXT NOT NULL,
  effective_until TEXT NOT NULL,
  reason TEXT NOT NULL,
  business_justification TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REVOKED')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  revoked_by INTEGER REFERENCES users(id),
  revoked_at TEXT,
  revocation_reason TEXT,
  CHECK(delegator_employee_id<>delegate_employee_id),
  CHECK(effective_until>effective_from)
);
CREATE INDEX IF NOT EXISTS idx_delegated_authority_lookup ON delegated_authorities(delegate_employee_id,authority_type,status,effective_from,effective_until);

CREATE TABLE IF NOT EXISTS external_finance_handoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL UNIQUE REFERENCES invoices(id),
  package_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'READY_FOR_FINANCE_EXTERNAL_PROCESS' CHECK(status IN ('READY_FOR_FINANCE_EXTERNAL_PROCESS','PROCUREMENT_COMPLETED')),
  handed_off_by INTEGER NOT NULL REFERENCES users(id),
  normal_role TEXT NOT NULL,
  delegation_id INTEGER REFERENCES delegated_authorities(id),
  delegated_by_employee_id INTEGER REFERENCES employees(id),
  handoff_at TEXT NOT NULL DEFAULT(datetime('now')),
  external_finance_reference TEXT,
  confirmation_reference TEXT,
  notes TEXT,
  completed_at TEXT,
  completed_by INTEGER REFERENCES users(id)
);

-- FIFO cost layers - the authoritative source for inventory valuation
CREATE TABLE IF NOT EXISTS inventory_layers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  location_id INTEGER REFERENCES locations(id),
  batch TEXT,
  expiry_date TEXT,
  quantity_remaining REAL NOT NULL CHECK (quantity_remaining >= 0),
  unit_cost REAL NOT NULL CHECK (unit_cost >= 0),
  received_date TEXT NOT NULL DEFAULT (date('now')),
  source_grn_item_id INTEGER REFERENCES grn_items(id)
);

-- Denormalized current balance per item/warehouse/location for fast lookups
CREATE TABLE IF NOT EXISTS inventory_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  location_id INTEGER REFERENCES locations(id),
  quantity REAL NOT NULL DEFAULT 0,
  UNIQUE(item_id, warehouse_id, location_id)
);

-- Immutable warehouse movement history. Current stock is derived from FIFO
-- layers, while this ledger remains the permanent operational audit trail.
CREATE TABLE IF NOT EXISTS stock_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_type TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  location_id INTEGER REFERENCES locations(id),
  quantity_change REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0,
  inventory_layer_id INTEGER REFERENCES inventory_layers(id),
  reference_number TEXT,
  reference_table TEXT,
  reference_id INTEGER,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS material_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_number TEXT UNIQUE NOT NULL,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  purpose TEXT,
  issue_date TEXT NOT NULL DEFAULT (date('now')),
  total_value REAL NOT NULL DEFAULT 0,
  approval_required INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Posted' CHECK (status IN ('PendingApproval','Approved','Posted','Rejected')),
  approved_by INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS material_issue_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL REFERENCES material_issues(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  location_id INTEGER REFERENCES locations(id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  value REAL NOT NULL DEFAULT 0
);

-- Immutable trace of the FIFO cost layers consumed by each posted issue line.
CREATE TABLE IF NOT EXISTS material_issue_layer_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_issue_item_id INTEGER NOT NULL REFERENCES material_issue_items(id),
  inventory_layer_id INTEGER NOT NULL REFERENCES inventory_layers(id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_cost REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS material_issue_authorization_limits (
 id INTEGER PRIMARY KEY AUTOINCREMENT,employee_id INTEGER NOT NULL REFERENCES employees(id),warehouse_id INTEGER REFERENCES warehouses(id),value_limit REAL NOT NULL CHECK(value_limit>=0),currency TEXT NOT NULL,quantity_limit REAL,category_scope TEXT,effective_from TEXT NOT NULL DEFAULT(date('now')),expiry_date TEXT,active_yn INTEGER NOT NULL DEFAULT 1,approved_by INTEGER NOT NULL REFERENCES users(id),approval_date TEXT NOT NULL DEFAULT(datetime('now')),created_at TEXT NOT NULL DEFAULT(datetime('now')),updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE IF NOT EXISTS approval_limit_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT,employee_id INTEGER NOT NULL REFERENCES employees(id),approval_type TEXT NOT NULL,old_limit REAL,new_limit REAL NOT NULL,currency TEXT NOT NULL,effective_from TEXT NOT NULL DEFAULT(date('now')),expiry_date TEXT,approved_by INTEGER NOT NULL REFERENCES users(id),approval_date TEXT NOT NULL DEFAULT(datetime('now')),status TEXT NOT NULL DEFAULT 'ACTIVE',created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE IF NOT EXISTS legacy_ledger_disposition_batches (
 id INTEGER PRIMARY KEY AUTOINCREMENT,batch_reference TEXT NOT NULL UNIQUE,common_root_cause TEXT NOT NULL,common_evidence TEXT NOT NULL,evidence_reference TEXT NOT NULL,management_decision TEXT NOT NULL,business_explanation TEXT NOT NULL,audit_reference TEXT NOT NULL,reviewed_by INTEGER NOT NULL REFERENCES users(id),reviewed_at TEXT NOT NULL DEFAULT(datetime('now')),approved_by INTEGER REFERENCES users(id),approved_at TEXT,status TEXT NOT NULL DEFAULT 'AWAITING APPROVAL' CHECK(status IN('AWAITING APPROVAL','APPROVED','REJECTED')),created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE IF NOT EXISTS legacy_ledger_batch_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT,batch_id INTEGER NOT NULL REFERENCES legacy_ledger_disposition_batches(id),warning_id INTEGER NOT NULL REFERENCES legacy_ledger_reconciliation(id),UNIQUE(batch_id,warning_id)
);

CREATE TABLE IF NOT EXISTS returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_number TEXT UNIQUE NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id),
  employee_id INTEGER REFERENCES employees(id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  condition TEXT,
  warehouse_id INTEGER REFERENCES warehouses(id),
  location_id INTEGER REFERENCES locations(id),
  return_date TEXT NOT NULL DEFAULT (date('now'))
);

CREATE TABLE IF NOT EXISTS transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_number TEXT UNIQUE NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id),
  quantity REAL NOT NULL,
  from_warehouse_id INTEGER REFERENCES warehouses(id),
  from_location_id INTEGER REFERENCES locations(id),
  to_warehouse_id INTEGER REFERENCES warehouses(id),
  to_location_id INTEGER REFERENCES locations(id),
  transport_mode TEXT,
  vehicle_reference TEXT,
  driver_name TEXT,
  tracking_reference TEXT,
  remarks TEXT,
  status TEXT NOT NULL DEFAULT 'In Transit' CHECK(status IN('In Transit','Received')),
  dispatched_by INTEGER REFERENCES users(id),
  dispatched_at TEXT,
  received_by INTEGER REFERENCES users(id),
  received_at TEXT,
  receiving_reference TEXT,
  receiving_note TEXT,
  unit_cost REAL NOT NULL DEFAULT 0,
  transfer_date TEXT NOT NULL DEFAULT (date('now'))
);

CREATE TABLE IF NOT EXISTS transfer_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_number TEXT UNIQUE NOT NULL,
  transfer_id INTEGER UNIQUE NOT NULL REFERENCES transfers(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  quantity_received REAL NOT NULL CHECK(quantity_received > 0),
  receiving_note TEXT,
  received_by INTEGER NOT NULL REFERENCES users(id),
  received_at TEXT NOT NULL DEFAULT(datetime('now'))
);

CREATE TABLE IF NOT EXISTS bin_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, transfer_number TEXT UNIQUE NOT NULL,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id), item_id INTEGER NOT NULL REFERENCES items(id),
  from_location_id INTEGER NOT NULL REFERENCES locations(id), to_location_id INTEGER NOT NULL REFERENCES locations(id),
  quantity REAL NOT NULL CHECK(quantity>0), reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Completed',
  completed_by INTEGER REFERENCES users(id), completed_at TEXT NOT NULL DEFAULT(datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adjustment_number TEXT UNIQUE NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  location_id INTEGER REFERENCES locations(id),
  quantity_change REAL NOT NULL CHECK (quantity_change <> 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
  approved_by INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  adjustment_date TEXT NOT NULL DEFAULT (date('now'))
);

-- ---------------------------------------------------------------------
-- SECTION 9: ADVANCED MODULES
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_code TEXT UNIQUE NOT NULL,
  serial_number TEXT,
  make TEXT,
  model TEXT,
  item_id INTEGER REFERENCES items(id),
  warehouse_id INTEGER REFERENCES warehouses(id),
  employee_id INTEGER REFERENCES employees(id),
  issue_date TEXT,
  return_date TEXT,
  condition TEXT,
  calibration_due_date TEXT
);

CREATE TABLE IF NOT EXISTS cycle_counts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  count_number TEXT UNIQUE NOT NULL,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  count_date TEXT NOT NULL DEFAULT (date('now')),
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Counted','Approved')),
  created_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS cycle_count_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  count_id INTEGER NOT NULL REFERENCES cycle_counts(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  system_qty REAL NOT NULL DEFAULT 0,
  counted_qty REAL,
  variance REAL
);

CREATE TABLE IF NOT EXISTS vendor_scorecards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  period TEXT NOT NULL,
  delivery_accuracy REAL,
  price_competitiveness REAL,
  quality REAL,
  response_time REAL,
  reliability REAL,
  overall_score REAL
);

-- ---------------------------------------------------------------------
-- Multi-level Approval Log (spec section 8.3 DB_Approval_Log / 13.x)
-- One row per approval decision requested/made against any document.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approval_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_type TEXT NOT NULL, -- PR, PO, ISSUE, ADJUSTMENT, CYCLECOUNT
  document_id INTEGER NOT NULL,
  document_number TEXT,
  sequence INTEGER NOT NULL DEFAULT 1,
  required_role TEXT,
  requested_by INTEGER REFERENCES users(id),
  requested_date TEXT NOT NULL DEFAULT (datetime('now')),
  decision TEXT CHECK (decision IN ('Pending','Approved','Rejected')) NOT NULL DEFAULT 'Pending',
  decision_by INTEGER REFERENCES users(id),
  decision_date TEXT,
  comments TEXT,
  manual_reference TEXT,
  approval_value REAL,
  approval_currency TEXT,
  approval_limit_used REAL,
  approval_limit_source TEXT,
  approval_limit_version INTEGER,
  approval_limit_effective_at TEXT,
  approver_employee_id INTEGER REFERENCES employees(id),
  approver_role TEXT,
  workflow_level TEXT,
  escalation_rule TEXT
);

-- ---------------------------------------------------------------------
-- Sequential, year-scoped document numbering (spec section 7.8)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS numbering_counters (
  doc_type TEXT NOT NULL,
  year TEXT NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_type, year)
);

-- ---------------------------------------------------------------------
-- Configurable system settings (spec MST_Settings) - key/value store
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ---------------------------------------------------------------------
-- SECTION 11: AUDIT SYSTEM
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  record_id INTEGER,
  action TEXT NOT NULL CHECK (action IN ('CREATE','UPDATE','DELETE','APPROVE','REJECT')),
  changed_by INTEGER REFERENCES users(id),
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  old_values TEXT,
  new_values TEXT
);

-- ---------------------------------------------------------------------
-- SECTION 12: NOTIFICATIONS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS document_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_type TEXT NOT NULL CHECK (document_type IN ('PR','PO','GRN','INVOICE','MANUAL_APPROVAL')),
  document_id INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  related_type TEXT,
  related_id INTEGER,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Sent','Failed')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_attachments_document ON document_attachments(document_type, document_id);

CREATE INDEX IF NOT EXISTS idx_layers_item_wh ON inventory_layers(item_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_item_wh ON inventory_stock(item_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_audit_table_record ON audit_log(table_name, record_id);

-- Enterprise country, currency, holiday and workforce scheduling foundation
CREATE TABLE IF NOT EXISTS currencies (
 id INTEGER PRIMARY KEY AUTOINCREMENT,currency_code TEXT NOT NULL UNIQUE,currency_name TEXT NOT NULL,currency_symbol TEXT NOT NULL,
 decimal_places INTEGER NOT NULL DEFAULT 2 CHECK(decimal_places BETWEEN 0 AND 6),decimal_separator TEXT NOT NULL DEFAULT '.',thousand_separator TEXT NOT NULL DEFAULT ',',
 symbol_position TEXT NOT NULL DEFAULT 'BEFORE' CHECK(symbol_position IN ('BEFORE','AFTER')),active_yn INTEGER NOT NULL DEFAULT 1,
 system_currency_yn INTEGER NOT NULL DEFAULT 1,manual_currency_yn INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT(datetime('now')),created_by INTEGER REFERENCES users(id),updated_at TEXT,updated_by INTEGER REFERENCES users(id));
CREATE TABLE IF NOT EXISTS countries (
 id INTEGER PRIMARY KEY AUTOINCREMENT,country_code TEXT NOT NULL UNIQUE,country_name TEXT NOT NULL UNIQUE,iso_alpha2 TEXT NOT NULL UNIQUE,iso_alpha3 TEXT NOT NULL UNIQUE,
 default_currency_code TEXT REFERENCES currencies(currency_code),phone_code TEXT,active_yn INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT(datetime('now')),created_by INTEGER REFERENCES users(id),updated_at TEXT,updated_by INTEGER REFERENCES users(id));
CREATE TABLE IF NOT EXISTS exchange_rates (
 id INTEGER PRIMARY KEY AUTOINCREMENT,from_currency TEXT NOT NULL REFERENCES currencies(currency_code),to_currency TEXT NOT NULL REFERENCES currencies(currency_code),
 rate REAL NOT NULL CHECK(rate>0),effective_date TEXT NOT NULL,expiry_date TEXT,source TEXT,manual_yn INTEGER NOT NULL DEFAULT 1,active_yn INTEGER NOT NULL DEFAULT 1,
 created_by INTEGER REFERENCES users(id),created_at TEXT NOT NULL DEFAULT(datetime('now')),UNIQUE(from_currency,to_currency,effective_date));
CREATE TABLE IF NOT EXISTS holidays (
 id INTEGER PRIMARY KEY AUTOINCREMENT,country_code TEXT NOT NULL REFERENCES countries(country_code),holiday_name TEXT NOT NULL,holiday_date TEXT NOT NULL,holiday_type TEXT,
 government_yn INTEGER NOT NULL DEFAULT 1,statutory_yn INTEGER NOT NULL DEFAULT 1,paid_holiday_yn INTEGER NOT NULL DEFAULT 1,recurring_yn INTEGER NOT NULL DEFAULT 0,
 source TEXT,active_yn INTEGER NOT NULL DEFAULT 1,created_by INTEGER REFERENCES users(id),created_at TEXT NOT NULL DEFAULT(datetime('now')),updated_by INTEGER REFERENCES users(id),updated_at TEXT,
 UNIQUE(country_code,holiday_name,holiday_date));
CREATE TABLE IF NOT EXISTS shifts (
 id INTEGER PRIMARY KEY AUTOINCREMENT,shift_code TEXT NOT NULL UNIQUE,shift_label TEXT NOT NULL,start_time TEXT NOT NULL,end_time TEXT NOT NULL,
 cross_midnight_yn INTEGER NOT NULL DEFAULT 0,break_minutes INTEGER NOT NULL DEFAULT 0,department_scope TEXT NOT NULL DEFAULT 'ALL',active_yn INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT(datetime('now')),created_by INTEGER REFERENCES users(id),updated_at TEXT,updated_by INTEGER REFERENCES users(id));
CREATE TABLE IF NOT EXISTS employee_availability (
 id INTEGER PRIMARY KEY AUTOINCREMENT,employee_id INTEGER NOT NULL REFERENCES employees(id),date_from TEXT NOT NULL,date_to TEXT NOT NULL,
 availability_status TEXT NOT NULL CHECK(availability_status IN ('Available','Unavailable','Leave','Sick','Training','Other')),reason TEXT,remarks TEXT,
 created_by INTEGER REFERENCES users(id),created_at TEXT NOT NULL DEFAULT(datetime('now')),updated_by INTEGER REFERENCES users(id),updated_at TEXT,CHECK(date_to>=date_from));
CREATE TABLE IF NOT EXISTS role_shift_requirements (
 id INTEGER PRIMARY KEY AUTOINCREMENT,department_id INTEGER NOT NULL REFERENCES departments(id),role_code TEXT NOT NULL,shift_id INTEGER NOT NULL REFERENCES shifts(id),
 minimum_staff INTEGER NOT NULL DEFAULT 0 CHECK(minimum_staff>=0),effective_from TEXT NOT NULL DEFAULT(date('now')),effective_to TEXT,active_yn INTEGER NOT NULL DEFAULT 1,
 created_by INTEGER REFERENCES users(id),created_at TEXT NOT NULL DEFAULT(datetime('now')),UNIQUE(department_id,role_code,shift_id,effective_from));
CREATE TABLE IF NOT EXISTS employee_work_calendar (
 id INTEGER PRIMARY KEY AUTOINCREMENT,employee_id INTEGER NOT NULL REFERENCES employees(id),department_id INTEGER NOT NULL REFERENCES departments(id),role_code TEXT NOT NULL,
 calendar_date TEXT NOT NULL,day_type TEXT NOT NULL CHECK(day_type IN ('WORKDAY','OFF','HOLIDAY','HOLIDAY_WORKING')),shift_id INTEGER REFERENCES shifts(id),
 shift_start TEXT,shift_end TEXT,override_start_time TEXT,override_end_time TEXT,holiday_id INTEGER REFERENCES holidays(id),
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PROVISIONAL','PUBLISHED','LOCKED')),assignment_source TEXT NOT NULL DEFAULT 'AUTO' CHECK(assignment_source IN ('AUTO','MANUAL')),
 manual_override_yn INTEGER NOT NULL DEFAULT 0,schedule_version INTEGER NOT NULL DEFAULT 1,remarks TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now')),created_by INTEGER REFERENCES users(id),updated_at TEXT,updated_by INTEGER REFERENCES users(id),
 UNIQUE(employee_id,calendar_date));
CREATE TABLE IF NOT EXISTS calendar_overrides (
 id INTEGER PRIMARY KEY AUTOINCREMENT,calendar_entry_id INTEGER NOT NULL REFERENCES employee_work_calendar(id),old_values TEXT NOT NULL,new_values TEXT NOT NULL,
 adjustment_reason TEXT NOT NULL,remarks TEXT,changed_by INTEGER NOT NULL REFERENCES users(id),changed_at TEXT NOT NULL DEFAULT(datetime('now')));
CREATE INDEX IF NOT EXISTS idx_calendar_date_department ON employee_work_calendar(calendar_date,department_id,status);
CREATE INDEX IF NOT EXISTS idx_availability_employee_dates ON employee_availability(employee_id,date_from,date_to);
CREATE TABLE IF NOT EXISTS shift_versions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,shift_id INTEGER NOT NULL REFERENCES shifts(id),shift_label TEXT NOT NULL,start_time TEXT NOT NULL,end_time TEXT NOT NULL,cross_midnight_yn INTEGER NOT NULL DEFAULT 0,break_minutes INTEGER NOT NULL DEFAULT 0,effective_from TEXT NOT NULL,effective_to TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now')),created_by INTEGER REFERENCES users(id),UNIQUE(shift_id,effective_from));
CREATE TABLE IF NOT EXISTS calendar_regeneration_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,trigger_type TEXT NOT NULL,employee_id INTEGER REFERENCES employees(id),department_id INTEGER REFERENCES departments(id),warehouse_id INTEGER REFERENCES warehouses(id),role_code TEXT,affected_from TEXT NOT NULL,affected_to TEXT NOT NULL,reason TEXT,assignments_changed INTEGER NOT NULL DEFAULT 0,coverage_warnings INTEGER NOT NULL DEFAULT 0,details_json TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now')),created_by INTEGER REFERENCES users(id));
CREATE TABLE IF NOT EXISTS calendar_coverage_warnings (
 id INTEGER PRIMARY KEY AUTOINCREMENT,calendar_date TEXT NOT NULL,department_id INTEGER REFERENCES departments(id),warehouse_id INTEGER REFERENCES warehouses(id),role_code TEXT NOT NULL,shift_id INTEGER REFERENCES shifts(id),required_staff INTEGER NOT NULL,available_staff INTEGER NOT NULL,warning_status TEXT NOT NULL DEFAULT 'OPEN' CHECK(warning_status IN('OPEN','RESOLVED')),reason TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now')),resolved_at TEXT,resolved_by INTEGER REFERENCES users(id));
CREATE TABLE IF NOT EXISTS calendar_download_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,action_type TEXT NOT NULL CHECK(action_type IN('PRINT','DOWNLOAD')),format TEXT NOT NULL,department_scope TEXT,warehouse_id INTEGER REFERENCES warehouses(id),date_from TEXT NOT NULL,date_to TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT(datetime('now')),created_by INTEGER NOT NULL REFERENCES users(id));
CREATE INDEX IF NOT EXISTS idx_calendar_regeneration_range ON calendar_regeneration_audit(affected_from,affected_to);
CREATE INDEX IF NOT EXISTS idx_calendar_warnings_date ON calendar_coverage_warnings(calendar_date,warning_status);
CREATE TABLE IF NOT EXISTS employee_warehouse_assignments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,employee_id INTEGER NOT NULL REFERENCES employees(id),warehouse_id INTEGER REFERENCES warehouses(id),all_warehouses_yn INTEGER NOT NULL DEFAULT 0,primary_warehouse_yn INTEGER NOT NULL DEFAULT 0,effective_from TEXT NOT NULL DEFAULT(date('now')),effective_to TEXT,active_yn INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT(datetime('now')),created_by INTEGER REFERENCES users(id),CHECK(all_warehouses_yn=1 OR warehouse_id IS NOT NULL),UNIQUE(employee_id,warehouse_id));
CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_all_warehouse_scope ON employee_warehouse_assignments(employee_id) WHERE all_warehouses_yn=1 AND active_yn=1;
CREATE TABLE IF NOT EXISTS cities (
 id INTEGER PRIMARY KEY AUTOINCREMENT,country_code TEXT NOT NULL REFERENCES countries(country_code),city_name TEXT NOT NULL,city_code TEXT,state_province_region TEXT,major_city_yn INTEGER NOT NULL DEFAULT 1,active_yn INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT(datetime('now')),created_by INTEGER REFERENCES users(id),updated_at TEXT,updated_by INTEGER REFERENCES users(id),UNIQUE(country_code,city_name));
CREATE TABLE IF NOT EXISTS item_duplicate_reviews (
 id INTEGER PRIMARY KEY AUTOINCREMENT,primary_item_id INTEGER NOT NULL REFERENCES items(id),possible_duplicate_item_id INTEGER NOT NULL REFERENCES items(id),similarity_score REAL NOT NULL,match_type TEXT NOT NULL,review_status TEXT NOT NULL DEFAULT 'Pending Review',review_reason TEXT,replacement_item_id INTEGER REFERENCES items(id),detected_at TEXT NOT NULL DEFAULT(datetime('now')),detected_by INTEGER REFERENCES users(id),reviewed_at TEXT,reviewed_by INTEGER REFERENCES users(id),UNIQUE(primary_item_id,possible_duplicate_item_id));
CREATE INDEX IF NOT EXISTS idx_employee_warehouse_active ON employee_warehouse_assignments(employee_id,active_yn,effective_from,effective_to);
CREATE INDEX IF NOT EXISTS idx_cities_country ON cities(country_code,active_yn,city_name);

CREATE TABLE IF NOT EXISTS audit_finding_closure (
 id INTEGER PRIMARY KEY AUTOINCREMENT,finding_id TEXT NOT NULL UNIQUE,original_audit_date TEXT NOT NULL,severity TEXT NOT NULL,module TEXT NOT NULL,issue TEXT NOT NULL,root_cause TEXT,remediation TEXT,testing_performed TEXT,evidence TEXT,resolved_by INTEGER REFERENCES users(id),resolution_date TEXT,status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','IN PROGRESS','RESOLVED','ACCEPTED RISK','NOT APPLICABLE')),residual_risk TEXT,management_decision TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now')),updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE IF NOT EXISTS legacy_ledger_reconciliation (
 id INTEGER PRIMARY KEY AUTOINCREMENT,warning_key TEXT NOT NULL UNIQUE,item_id INTEGER NOT NULL REFERENCES items(id),warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),location_id INTEGER REFERENCES locations(id),current_quantity REAL NOT NULL,fifo_quantity REAL NOT NULL,ledger_quantity REAL NOT NULL,quantity_difference REAL NOT NULL,current_value REAL,fifo_value REAL,ledger_value REAL,value_difference REAL,earliest_relevant_transaction TEXT,earliest_ledger_transaction TEXT,opening_balance_record TEXT,root_cause_classification TEXT NOT NULL DEFAULT 'Unknown / Requires Investigation',supporting_evidence TEXT,financial_impact TEXT,inventory_impact TEXT,risk_level TEXT NOT NULL DEFAULT 'HIGH',recommended_resolution TEXT,approval_required INTEGER NOT NULL DEFAULT 1,resolution_status TEXT NOT NULL DEFAULT 'UNDER INVESTIGATION' CHECK(resolution_status IN('RESOLVED','APPROVED LEGACY EXCEPTION','CONTROLLED ADJUSTMENT REQUIRED','NO FINANCIAL IMPACT','UNDER INVESTIGATION')),approved_by INTEGER REFERENCES users(id),approved_at TEXT,reviewed_by INTEGER REFERENCES users(id),reviewed_at TEXT,notes TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now')),updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE IF NOT EXISTS sod_conflict_reviews (
 id INTEGER PRIMARY KEY AUTOINCREMENT,conflict_key TEXT NOT NULL UNIQUE,user_id INTEGER NOT NULL REFERENCES users(id),employee_id INTEGER REFERENCES employees(id),permission_a TEXT NOT NULL,permission_b TEXT NOT NULL,conflict_description TEXT NOT NULL,risk TEXT NOT NULL,business_justification TEXT,recommended_action TEXT,management_decision TEXT,compensating_control TEXT,review_date TEXT,expiry_date TEXT,status TEXT NOT NULL DEFAULT 'REQUIRES MANAGEMENT REVIEW' CHECK(status IN('TRUE CONFLICT','APPROVED BUSINESS EXCEPTION','FALSE POSITIVE','REQUIRES MANAGEMENT REVIEW')),approved_by INTEGER REFERENCES users(id),approval_date TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now')),updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE IF NOT EXISTS control_test_results (
 id INTEGER PRIMARY KEY AUTOINCREMENT,test_suite TEXT NOT NULL,test_name TEXT NOT NULL,report_api TEXT,test_user TEXT,assigned_warehouse TEXT,requested_warehouse TEXT,expected_result TEXT,actual_result TEXT,status TEXT NOT NULL CHECK(status IN('PASS','FAIL','NOT TESTED')),evidence TEXT,executed_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE IF NOT EXISTS backup_restore_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT,backup_reference TEXT NOT NULL UNIQUE,backup_type TEXT NOT NULL,created_by INTEGER REFERENCES users(id),database_included INTEGER NOT NULL DEFAULT 1,attachments_included INTEGER NOT NULL DEFAULT 0,configuration_included INTEGER NOT NULL DEFAULT 0,backup_status TEXT NOT NULL,restore_tested INTEGER NOT NULL DEFAULT 0,restore_test_date TEXT,restore_tested_by INTEGER REFERENCES users(id),restore_result TEXT,notes TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE IF NOT EXISTS accounting_periods (
 id INTEGER PRIMARY KEY AUTOINCREMENT,fiscal_year TEXT NOT NULL,period TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','SOFT CLOSED','CLOSED')),closed_by INTEGER REFERENCES users(id),closed_at TEXT,reopened_by INTEGER REFERENCES users(id),reopened_at TEXT,reason TEXT,UNIQUE(fiscal_year,period)
);
CREATE TABLE IF NOT EXISTS document_revisions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,document_type TEXT NOT NULL,document_id INTEGER NOT NULL,revision_number INTEGER NOT NULL,changed_by INTEGER REFERENCES users(id),change_reason TEXT NOT NULL,previous_values TEXT NOT NULL,new_values TEXT NOT NULL,approval_status TEXT NOT NULL DEFAULT 'Pending Reapproval',reapproved_by INTEGER REFERENCES users(id),reapproval_date TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now')),UNIQUE(document_type,document_id,revision_number)
);
-- Phase 3 migrations add governance fields to existing Phase 2 installations.
-- New databases receive the same additions from db/index.ts via ensureColumn.
