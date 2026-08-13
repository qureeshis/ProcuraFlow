import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
import db from '../db';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { getSetting, setSetting } from '../utils/settings';
import { logAudit } from '../utils/auditLog';
import { companyLicenseStatus } from '../middleware/companyLock';

const router = Router();
const uploadDir = path.join(__dirname, '../../uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
const logoUpload = multer({
  dest: uploadDir,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});
const backupDir = path.join(__dirname, '../../backups');
fs.mkdirSync(backupDir, { recursive: true });
const backupUpload = multer({ dest: backupDir, limits: { fileSize: 1024 * 1024 * 1024 } });

const KEYS = ['material_issue_approval_threshold', 'global_payment_terms', 'global_transport_modes', 'backup_reminder_last_ack', 'fiscal_close_backup_path'];
const APPROVAL_LIMIT_KEYS = {
  SupplyChainManager: 'approval_limit_supply_chain_manager',
  PurchaseManager: 'approval_limit_purchase_manager',
  PurchaseOfficer: 'approval_limit_purchase_officer',
  WarehouseManager: 'approval_limit_warehouse_manager',
  WarehouseSupervisor: 'approval_limit_warehouse_supervisor',
  Storekeeper: 'approval_limit_storekeeper',
};

function toInt(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function toFlag(value: unknown) {
  return ['1', 'true', 'yes', 'y'].includes(String(value ?? '').trim().toLowerCase()) ? 1 : 0;
}

function toIsoDate(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value).trim())) {
    const parsed = XLSX.SSF.parse_date_code(Number(value));
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function normalizeSheetRows(rows: any[]) {
  return (rows || []).filter((row) => row && Object.values(row).some((value) => value !== null && value !== ''));
}

router.get('/', requireAuth, (req, res) => {
  const settings = Object.fromEntries(KEYS.map((k) => [k, getSetting(k)]));
  Object.entries(APPROVAL_LIMIT_KEYS).forEach(([role, key]) => {
    settings[key] = getSetting(key);
  });
  res.json(settings);
});

router.get('/approval-limits', requireAuth, requireRole('SupplyChainManager','PurchaseManager','WarehouseManager'), (_req,res)=>{
  res.json(Object.fromEntries(Object.entries(APPROVAL_LIMIT_KEYS).map(([role,key])=>[role,Number(getSetting(key)||0)])));
});

router.get('/company', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM company ORDER BY id DESC LIMIT 1').get() as any;
  res.json({ ...(row || {}), ...companyLicenseStatus() });
});

// Public login branding exposes no operational, financial, or user data.
router.get('/branding', (req, res) => {
  const row = db.prepare('SELECT name,logo_url,address,phone,email,website,tax_info,registration_number,branch_info,currency,base_currency,country_code,time_zone,financial_year FROM company WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1').get() as any;
  res.json({ company_name: row?.name || 'Company Name', logo_url: row?.logo_url || null, address:row?.address||'', phone:row?.phone||'', email:row?.email||'', website:row?.website||'', tax_info:row?.tax_info||'', registration_number:row?.registration_number||'', branch_info:row?.branch_info||'', currency:row?.base_currency||row?.currency||'SAR', base_currency:row?.base_currency||row?.currency||'SAR',country_code:row?.country_code||'SA',time_zone:row?.time_zone||'Asia/Riyadh', financial_year:row?.financial_year||'', application_name: 'ProcuraFlow' });
});

router.post('/backup', requireAuth, requireRole('SupplyChainManager'), async (req: AuthedRequest, res, next) => {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `procuraflow-backup-${stamp}.db`;
    const target = path.join(backupDir, filename);
    await db.backup(target);
    setSetting('backup_reminder_last_ack', new Date().toISOString());
    logAudit('settings', null, 'CREATE', req.user?.id, undefined, { action: 'database_backup', filename });
    res.download(target, filename);
  } catch (e) { next(e); }
});

// Factory reset is deliberately separate from restore. It requires fresh
// password verification and an exact confirmation phrase, creates a recovery
// backup, and retains only the requesting SCM account as bootstrap access.
router.post('/factory-reset', requireAuth, requireRole('SupplyChainManager'), async (req: AuthedRequest, res, next) => {
  if (companyLicenseStatus().license_locked) return res.status(403).json({ error: 'Factory reset is disabled because this installation is permanently licensed to one company.' });
  const { current_password, confirmation_phrase, acknowledge_permanent_deletion } = req.body || {};
  if (confirmation_phrase !== 'RESET PROCURAFLOW') return res.status(400).json({ error: 'Type RESET PROCURAFLOW exactly to confirm' });
  if (acknowledge_permanent_deletion !== true) return res.status(400).json({ error: 'Permanent deletion must be acknowledged' });

  const currentUser = db.prepare('SELECT * FROM users WHERE id=? AND role=\'SupplyChainManager\' AND is_active=1 AND deleted_at IS NULL').get(req.user!.id) as any;
  if (!currentUser || !bcrypt.compareSync(String(current_password || ''), currentUser.password_hash)) {
    return res.status(403).json({ error: 'Password verification failed. No data was changed.' });
  }

  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `pre-factory-reset-${stamp}.db`;
    const target = path.join(backupDir, filename);
    await db.backup(target);

    const protectedTables = new Set(['users', 'sqlite_sequence']);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{name: string}>)
      .map((row) => row.name)
      .filter((name) => !protectedTables.has(name));

    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        // Break the retained login's employee relationship before clearing masters.
        db.prepare('UPDATE users SET employee_id=NULL, warehouse_id=NULL WHERE id=?').run(currentUser.id);
        db.prepare('DELETE FROM users WHERE id<>?').run(currentUser.id);
        for (const table of tables) db.prepare(`DELETE FROM "${table.replace(/"/g, '""')}"`).run();
        db.prepare("INSERT INTO company (name,address,logo_url,tax_info,currency,financial_year) VALUES ('New Company',NULL,NULL,NULL,'SAR',NULL)").run();
        db.prepare('DELETE FROM sqlite_sequence WHERE name<>\'users\'').run();
      })();
    } finally {
      db.pragma('foreign_keys = ON');
    }

    // Remove business documents and former branding, but never delete backups.
    const resolvedUploadDir = path.resolve(uploadDir);
    if (fs.existsSync(resolvedUploadDir) && resolvedUploadDir === path.resolve(__dirname, '../../uploads')) {
      for (const entry of fs.readdirSync(resolvedUploadDir)) fs.rmSync(path.join(resolvedUploadDir, entry), { recursive: true, force: true });
    }
    fs.mkdirSync(uploadDir, { recursive: true });

    logAudit('settings', null, 'DELETE', currentUser.id, undefined, { action: 'factory_reset', recovery_backup: filename, retained_admin: currentUser.username });
    res.json({
      success: true,
      message: 'ProcuraFlow has been reset for a new company.',
      recovery_backup: filename,
      retained_admin: currentUser.username,
    });
  } catch (e) { next(e); }
});

router.post('/restore', requireAuth, requireRole('SupplyChainManager'), backupUpload.single('backup'), (req: AuthedRequest, res) => {
  if (!req.file) return res.status(400).json({ error: 'SQLite backup file is required' });
  try {
    const Database = require('better-sqlite3');
    const candidate = new Database(req.file.path, { readonly: true });
    const integrity = candidate.pragma('integrity_check', { simple: true });
    const required = candidate.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','items','purchase_orders','inventory_layers')").all();
    const currentLicense = companyLicenseStatus();
    const candidateColumns = candidate.prepare('PRAGMA table_info(company)').all() as Array<{name:string}>;
    const hasLicenseColumns = candidateColumns.some((column) => column.name === 'licensed_company_name');
    const candidateCompany = candidate.prepare(`SELECT name${hasLicenseColumns ? ',licensed_company_name' : ''} FROM company WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1`).get() as any;
    candidate.close();
    if (integrity !== 'ok' || required.length !== 4) throw new Error('File is not a valid ProcuraFlow backup');
    if (currentLicense.license_locked && String(candidateCompany?.licensed_company_name || candidateCompany?.name || '').trim().toLowerCase() !== String(currentLicense.licensed_company_name || '').trim().toLowerCase()) {
      throw new Error('Backup belongs to a different company and cannot be restored into this licensed installation');
    }
    setSetting('fiscal_close_backup_path', req.file.path);
    logAudit('settings', null, 'CREATE', req.user?.id, undefined, { action: 'restore_staged', file: req.file.filename });
    res.json({ success: true, message: 'Backup validated and staged. Restart the backend with RESTORE_DB_PATH set to the staged path to complete the restore safely.', staged_path: req.file.path });
  } catch (e: any) { fs.unlinkSync(req.file.path); res.status(400).json({ error: e.message }); }
});

router.post('/fiscal-close', requireAuth, requireRole('SupplyChainManager'), async (req: AuthedRequest, res, next) => {
  const { next_financial_year } = req.body || {};
  if (!String(next_financial_year || '').trim()) return res.status(400).json({ error: 'Next financial year is required' });
  try {
    const filename = `fiscal-close-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
    const target = path.join(backupDir, filename);
    await db.backup(target);
    const company = db.prepare('SELECT * FROM company ORDER BY id DESC LIMIT 1').get() as any;
    db.prepare('UPDATE company SET financial_year=? WHERE id=?').run(String(next_financial_year).trim(), company.id);
    setSetting('backup_reminder_last_ack', new Date().toISOString());
    logAudit('company', company.id, 'UPDATE', req.user?.id, company, { financial_year: next_financial_year, fiscal_backup: filename });
    res.json({ success: true, backup_file: filename, financial_year: next_financial_year });
  } catch (e) { next(e); }
});

router.put('/company', requireAuth, requireRole('SupplyChainManager'), (req: AuthedRequest, res) => {
  const existing = db.prepare('SELECT id,name,licensed_company_name,license_locked_at,country_code,base_currency,time_zone FROM company ORDER BY id DESC LIMIT 1').get() as any;
  const payload = req.body || {};
  const currency = String(payload.base_currency || payload.currency || existing?.base_currency || 'SAR').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return res.status(400).json({ error: 'Company currency must be a valid three-letter ISO currency code' });
  if(!db.prepare('SELECT 1 FROM currencies WHERE currency_code=? AND active_yn=1').get(currency))return res.status(400).json({error:'Company base currency must be selected from the active currency master'});
  const countryCode=String(payload.country_code||existing?.country_code||'SA').toUpperCase();
  if(!db.prepare('SELECT 1 FROM countries WHERE country_code=? AND active_yn=1').get(countryCode))return res.status(400).json({error:'Company country must be selected from the active country master'});
  const cityId=payload.city_id?Number(payload.city_id):null;
  if(cityId&&!db.prepare('SELECT 1 FROM cities WHERE id=? AND country_code=? AND active_yn=1').get(cityId,countryCode))return res.status(400).json({error:'Selected company city does not belong to the selected country'});
  if (existing) {
    if (existing.license_locked_at && String(payload.name || '').trim().toLowerCase() !== String(existing.licensed_company_name || existing.name).trim().toLowerCase()) {
      return res.status(403).json({ error: `Company name is locked to ${existing.licensed_company_name || existing.name} by this installation license.` });
    }
    db.prepare(`UPDATE company SET name = ?, address = ?, phone=?, email=?, website=?, registration_number=?, branch_info=?, tax_info = ?, currency = ?,base_currency=?,country_code=?,city_id=?,postal_code=?,region_province=?,time_zone=?, financial_year = ? WHERE id = ?`).run(
      existing.license_locked_at ? (existing.licensed_company_name || existing.name) : (payload.name ?? ''),
      payload.address ?? '',
      payload.phone ?? '', payload.email ?? '', payload.website ?? '', payload.registration_number ?? '', payload.branch_info ?? '',
      payload.tax_info ?? '',
      currency,currency,countryCode,cityId,payload.postal_code||null,payload.region_province||null,String(payload.time_zone||existing.time_zone||'Asia/Riyadh'),
      payload.financial_year ?? '',
      existing.id,
    );
  } else {
    db.prepare(`INSERT INTO company (name, address, phone, email, website, registration_number, branch_info, tax_info, currency,base_currency,country_code,city_id,postal_code,region_province,time_zone,financial_year) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,?,?,?,?,?,?,?)`).run(
      payload.name ?? '',
      payload.address ?? '',
      payload.phone ?? '', payload.email ?? '', payload.website ?? '', payload.registration_number ?? '', payload.branch_info ?? '',
      payload.tax_info ?? '',
      currency,currency,countryCode,cityId,payload.postal_code||null,payload.region_province||null,String(payload.time_zone||'Asia/Riyadh'),
      payload.financial_year ?? '',
    );
  }
  // Quotation comparisons have no exchange-rate engine; keep every comparable
  // amount in the company's base currency when that master setting changes.
  db.prepare('UPDATE supplier_quotations SET currency=?').run(currency);
  res.json({ success: true, currency });
});

router.post('/company-logo', requireAuth, requireRole('SupplyChainManager'), logoUpload.single('logo'), (req: AuthedRequest, res) => {
  if (!req.file) return res.status(400).json({ error: 'No supported logo file was received. Select a PNG, JPG, or WebP image up to 5 MB.' });
  const activeCompany = db.prepare('SELECT id, logo_url FROM company WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1').get() as { id:number; logo_url?:string }|undefined;
  if (!activeCompany) { fs.unlinkSync(req.file.path); return res.status(409).json({ error: 'Save the company details before uploading its logo.' }); }
  const previous=activeCompany.logo_url;
  const ext = path.extname(req.file.originalname || '.jpg') || '.jpg';
  const finalName = `company-logo-${Date.now()}${ext.toLowerCase()}`;
  const logoDir = path.join(uploadDir, 'logos');
  fs.mkdirSync(logoDir, { recursive: true });
  const finalPath = path.join(logoDir, finalName);
  fs.renameSync(req.file.path, finalPath);
  const publicUrl = `/uploads/logos/${finalName}`;
  db.prepare('UPDATE company SET logo_url = ? WHERE id = ?').run(publicUrl, activeCompany.id);
  if(previous?.startsWith('/uploads/logos/')){const previousPath=path.join(logoDir,path.basename(previous));if(previousPath!==finalPath&&fs.existsSync(previousPath))fs.unlinkSync(previousPath);}
  logAudit('company', activeCompany.id, 'UPDATE', req.user?.id, undefined, { logo_url: publicUrl });
  res.json({ logo_url: publicUrl });
});

router.post('/imports/vendors', requireAuth, requireRole('SupplyChainManager'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as any[];
  const normalized = normalizeSheetRows(rows);

  const insertStmt = db.prepare(
    `INSERT INTO suppliers (supplier_code, name, contact_person, phone, email, address, payment_terms, rating)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let count = 0;
  for (const row of normalized) {
    const supplierCode = String(row.supplier_code || row.SupplierCode || row.code || `SUP-${count + 1}`).trim();
    const name = String(row.name || row.SupplierName || row.supplier || '').trim();
    if (!name) continue;
    const exists = db.prepare('SELECT id FROM suppliers WHERE supplier_code = ? OR name = ?').get(supplierCode, name);
    if (exists) continue;
    insertStmt.run(
      supplierCode,
      name,
      String(row.contact_person || row.ContactPerson || ''),
      String(row.phone || row.Phone || ''),
      String(row.email || row.Email || ''),
      String(row.address || row.Address || ''),
      String(row.payment_terms || row.PaymentTerms || ''),
      Number(row.rating || row.Rating || 0),
    );
    count += 1;
  }
  res.json({ imported: count });
});

// Item master import uses the same column names as the New Item form.
router.post('/imports/items', requireAuth, requireRole('SupplyChainManager'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = normalizeSheetRows(XLSX.utils.sheet_to_json(sheet, { defval: '' }) as any[]);
  const insertStmt = db.prepare(
    `INSERT INTO items (item_code, description, category, subcategory, uom, purchase_uom, issue_uom, conversion_factor,
      consumable_returnable, high_value_flag, always_approval_yn, tool_control_yn, batch_control_yn, expiry_control_yn,
      inspection_required_yn, min_stock, max_stock, reorder_level, standard_cost)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let count = 0;
  for (const row of rows) {
    const itemCode = String(row.item_code || row.ItemCode || row.code || '').trim();
    const description = String(row.description || row.ItemDescription || row.item_description || '').trim();
    if (!itemCode || !description) continue;
    if (db.prepare('SELECT id FROM items WHERE item_code = ?').get(itemCode)) continue;

    insertStmt.run(
      itemCode, description, String(row.category || ''), String(row.subcategory || ''), String(row.uom || 'EA'),
      String(row.purchase_uom || ''), String(row.issue_uom || ''), Number(row.conversion_factor || 1),
      String(row.consumable_returnable || 'Consumable'), toFlag(row.high_value_flag), toFlag(row.always_approval_yn),
      toFlag(row.tool_control_yn), toFlag(row.batch_control_yn), toFlag(row.expiry_control_yn), toFlag(row.inspection_required_yn),
      Number(row.min_stock || 0), Number(row.max_stock || 0), Number(row.reorder_level || 0), Number(row.standard_cost || 0),
    );
    count += 1;
  }
  res.json({ imported: count });
});

router.post('/imports/opening-balances', requireAuth, requireRole('SupplyChainManager'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
  const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as any[];
  const normalized = normalizeSheetRows(rows);

  let count = 0;
  let skipped = 0;
  const warehouseStmt = db.prepare('SELECT id, warehouse_code FROM warehouses WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL');
  const createWarehouseStmt = db.prepare('INSERT INTO warehouses (name) VALUES (?)');
  const locationStmt = db.prepare('SELECT id FROM locations WHERE warehouse_id = ? AND deleted_at IS NULL AND (code = ? COLLATE NOCASE OR label = ? COLLATE NOCASE)');
  const locationCodeExistsStmt = db.prepare('SELECT 1 FROM locations WHERE code = ? AND deleted_at IS NULL');
  const locationCountStmt = db.prepare("SELECT COUNT(*) count FROM locations WHERE warehouse_id = ? AND type = 'Bin'");
  const createLocationStmt = db.prepare('INSERT INTO locations (warehouse_id, type, code, label, created_by) VALUES (?, ?, ?, ?, ?)');
  const itemStmt = db.prepare('SELECT id, default_warehouse_id, default_location_id FROM items WHERE item_code = ?');
  const createItemStmt = db.prepare(
    `INSERT INTO items (item_code, description, category, subcategory, uom, purchase_uom, issue_uom, conversion_factor,
      consumable_returnable, high_value_flag, always_approval_yn, tool_control_yn, batch_control_yn, expiry_control_yn,
      inspection_required_yn, min_stock, max_stock, reorder_level, standard_cost, last_purchase_price)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const stockStmt = db.prepare('INSERT INTO inventory_stock (item_id, warehouse_id, location_id, quantity) VALUES (?, ?, ?, ?) ON CONFLICT(item_id, warehouse_id, location_id) DO UPDATE SET quantity = excluded.quantity');
  const layerStmt = db.prepare('INSERT INTO inventory_layers (item_id, warehouse_id, location_id, batch, expiry_date, quantity_remaining, unit_cost, received_date, source_grn_item_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)');
  // Snapshot movement history before this import. This prevents a repeated
  // opening import while still allowing one legitimate opening file to split
  // the same item across several BINs.
  const existingMovementPairs = new Set((db.prepare('SELECT DISTINCT item_id,warehouse_id FROM stock_ledger').all() as Array<{item_id:number;warehouse_id:number}>).map(row=>`${row.item_id}:${row.warehouse_id}`));
  const clearUnpostedOpeningLayersStmt = db.prepare('DELETE FROM inventory_layers WHERE item_id=? AND warehouse_id=? AND location_id IS ? AND source_grn_item_id IS NULL');
  const ledgerStmt = db.prepare(`INSERT INTO stock_ledger
    (transaction_type,item_id,warehouse_id,location_id,quantity_change,unit_cost,inventory_layer_id,reference_number,reference_table,created_by)
    VALUES ('OPENING_BALANCE',?,?,?,?,?,?,?,'opening_balance_import',?)`);
  const importReference = `OPENING-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;

  const importRows = db.transaction(() => {
  for (const row of normalized) {
    const itemCode = String(row.item_code || row.ItemCode || row.item || '').trim();
    let item = itemStmt.get(itemCode) as any;
    if (!item) {
      const description = String(row.description || row.item_description || row.ItemDescription || '').trim();
      if (!itemCode || !description) {
        skipped += 1;
        continue;
      }
      const importUnitCost = toNumber(row.unit_cost || row.UnitCost || row.cost || 0);
      createItemStmt.run(
        itemCode, description, String(row.category || ''), String(row.subcategory || ''), String(row.uom || 'EA'),
        String(row.purchase_uom || ''), String(row.issue_uom || ''), Number(row.conversion_factor || 1),
        String(row.consumable_returnable || 'Consumable'), toFlag(row.high_value_flag), toFlag(row.always_approval_yn),
        toFlag(row.tool_control_yn), toFlag(row.batch_control_yn), toFlag(row.expiry_control_yn), toFlag(row.inspection_required_yn),
        Number(row.min_stock || 0), Number(row.max_stock || 0), Number(row.reorder_level || 0),
        Number.isFinite(importUnitCost) ? importUnitCost : 0, Number.isFinite(importUnitCost) ? importUnitCost : 0,
      );
      item = itemStmt.get(itemCode) as any;
    }

    const warehouseName = String(row.warehouse || row.Warehouse || 'Main Warehouse').trim() || 'Main Warehouse';
    let warehouse = warehouseStmt.get(warehouseName) as any;
    if (!warehouse) {
      const result = createWarehouseStmt.run(warehouseName);
      const warehouseId = Number(result.lastInsertRowid);
      const warehouseCode = `WH-${String(warehouseId).padStart(3, '0')}`;
      db.prepare('UPDATE warehouses SET warehouse_code=? WHERE id=?').run(warehouseCode, warehouseId);
      warehouse = { id: warehouseId, warehouse_code: warehouseCode };
    }

    const locationCode = String(row.location || row.Location || row.bin || row.Bin || '').trim();
    let locationId = item.default_location_id ?? null;
    if (locationCode) {
      const found = locationStmt.get(warehouse.id, locationCode, locationCode) as any;
      if (found) locationId = found.id;
      else {
        const prefix = String(warehouse.warehouse_code || `WH-${String(warehouse.id).padStart(3, '0')}`);
        let sequence = Number((locationCountStmt.get(warehouse.id) as any).count) + 1;
        let generatedCode = `${prefix}-B${String(sequence).padStart(2, '0')}`;
        while (locationCodeExistsStmt.get(generatedCode)) {
          sequence += 1;
          generatedCode = `${prefix}-B${String(sequence).padStart(2, '0')}`;
        }
        const result = createLocationStmt.run(warehouse.id, 'Bin', generatedCode, locationCode, (req as AuthedRequest).user?.id ?? null);
        locationId = result.lastInsertRowid as number;
      }
    }

    const quantity = toNumber(row.quantity || row.Quantity || row.qty || row.balance || 0);
    const unitCost = toNumber(row.unit_cost || row.UnitCost || row.cost || 0);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0) {
      skipped += 1;
      continue;
    }

    // Opening balances may replace earlier unposted opening layers, including
    // remnants from the legacy non-transactional importer. Never overwrite a
    // location after any controlled warehouse movement has been posted.
    if (existingMovementPairs.has(`${item.id}:${warehouse.id}`)) {
      skipped += 1;
      continue;
    }

    clearUnpostedOpeningLayersStmt.run(item.id, warehouse.id, locationId);
    stockStmt.run(item.id, warehouse.id, locationId, quantity);
    const layerResult = layerStmt.run(
      item.id,
      warehouse.id,
      locationId,
      String(row.batch || row.Batch || ''),
      toIsoDate(row.expiry_date || row.ExpiryDate),
      quantity,
      unitCost,
      toIsoDate(row.received_date || row.ReceivedDate) || new Date().toISOString().slice(0, 10),
    );
    ledgerStmt.run(item.id, warehouse.id, locationId, quantity, unitCost, layerResult.lastInsertRowid, importReference, (req as AuthedRequest).user?.id ?? null);
    db.prepare('UPDATE items SET last_purchase_price = ? WHERE id = ?').run(unitCost, item.id);
    count += 1;
  }
  });
  importRows();

  res.json({ imported: count, skipped });
  } catch (error: any) {
    res.status(400).json({ error: `Opening balance import failed. No rows were committed. ${error?.message || 'Invalid import file.'}` });
  }
});

// Keep this parameterized route after the named settings endpoints. Otherwise
// PUT /company is interpreted as an attempt to update a setting named "company".
router.put('/:key', requireAuth, (req: AuthedRequest, res) => {
  const { key } = req.params;
  if (!KEYS.includes(key) && !Object.values(APPROVAL_LIMIT_KEYS).includes(key)) {
    return res.status(400).json({ error: 'Unknown setting key' });
  }
  const delegatedRoles: Record<string, string[]> = {
    material_issue_approval_threshold: ['SupplyChainManager'],
    global_payment_terms: ['SupplyChainManager', 'PurchaseManager'],
    global_transport_modes: ['SupplyChainManager', 'WarehouseManager'],
  };
  const allowedRoles = delegatedRoles[key] || ['SupplyChainManager'];
  if (!allowedRoles.includes(req.user!.role)) return res.status(403).json({ error: `Role '${req.user!.role}' cannot change this setting` });
  const { value } = req.body || {};
  if (key === 'material_issue_approval_threshold' && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
    return res.status(400).json({ error: 'Material Issue Approval Threshold must be a non-negative number' });
  }
  if (Object.values(APPROVAL_LIMIT_KEYS).includes(key) && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
    return res.status(400).json({ error: 'Approval limit must be a non-negative number' });
  }
  setSetting(key, String(value));
  logAudit('settings', null, 'UPDATE', req.user?.id, undefined, { key, value });
  res.json({ key, value: String(value) });
});

export default router;
