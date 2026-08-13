import { Router } from 'express';
import db from '../db';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { logAudit } from '../utils/auditLog';
import { currentValuation } from '../utils/fifo';
import { nextDocNumber } from '../utils/numbering';
import { assertNotSelfApproval, SelfApprovalError, requestApproval, recordDecision, getApprovalHistory } from '../utils/approvalLog';
import { assertWarehouseAccess, authorizedWarehouseIds } from '../utils/warehouseAccess';
import { assertApprovalAuthority } from '../utils/approvalRouting';

const router = Router();
const INVENTORY_ROLES = ['SupplyChainManager','WarehouseManager','WarehouseSupervisor','Storekeeper'];

// Section 8: Real-Time Inventory
router.get('/stock', requireAuth, requireRole(...INVENTORY_ROLES), (req, res) => {
  const ids=authorizedWarehouseIds((req as AuthedRequest).user!.id);if(!ids.length)return res.json([]);
  const rows = db
    .prepare(
      `SELECT s.*, i.item_code, i.description, i.uom, w.name AS warehouse_name, w.warehouse_code,
              w.site_type, w.site_name, w.address warehouse_address, w.city warehouse_city,
              l.code AS location_code, l.type AS location_type, l.label location_label,l.status location_status,l.max_quantity,
              COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r WHERE r.item_id=s.item_id AND r.warehouse_id=s.warehouse_id AND r.location_id=s.location_id AND r.status='Active'),0) reserved_quantity,
              s.quantity-COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r WHERE r.item_id=s.item_id AND r.warehouse_id=s.warehouse_id AND r.location_id=s.location_id AND r.status='Active'),0) available_quantity
       FROM inventory_stock s
       JOIN items i ON i.id = s.item_id
       JOIN warehouses w ON w.id = s.warehouse_id
       LEFT JOIN locations l ON l.id = s.location_id
       WHERE s.quantity > 0 AND s.warehouse_id IN (${ids.map(()=>'?').join(',')})
       ORDER BY i.item_code`
    )
    .all(...ids);
  res.json(rows);
});

// Section 8: FIFO Inventory Valuation report
router.get('/valuation', requireAuth, requireRole(...INVENTORY_ROLES), (req, res) => {
  const items = db.prepare('SELECT * FROM items WHERE deleted_at IS NULL').all() as any[];
  const report = items.map((item) => {
    const v = currentValuation(item.id);
    return {
      item_id: item.id,
      item_code: item.item_code,
      description: item.description,
      quantity: v.totalQty,
      value: Math.round(v.totalValue * 100) / 100,
      avg_unit_cost: v.totalQty > 0 ? Math.round((v.totalValue / v.totalQty) * 100) / 100 : 0,
    };
  });
  res.json(report);
});

router.get('/valuation/:item_id/layers', requireAuth, requireRole(...INVENTORY_ROLES), (req, res) => {
  const v = currentValuation(Number(req.params.item_id));
  res.json(v);
});

// Expiry Tracking - 30/60 day and expired alerts
router.get('/expiry', requireAuth, requireRole(...INVENTORY_ROLES), (req, res) => {
  const rows = db
    .prepare(
      `SELECT il.*, i.item_code, i.description,
        CAST(julianday(il.expiry_date) - julianday('now') AS INTEGER) AS days_remaining
       FROM inventory_layers il
       JOIN items i ON i.id = il.item_id
       WHERE il.quantity_remaining > 0 AND il.expiry_date IS NOT NULL
       ORDER BY il.expiry_date ASC`
    )
    .all();
  const withAlerts = (rows as any[]).map((r) => ({
    ...r,
    alert: r.days_remaining < 0 ? 'Expired' : r.days_remaining <= 30 ? '30-day' : r.days_remaining <= 60 ? '60-day' : r.days_remaining <= 90 ? '90-day' : null,
  }));
  res.json(withAlerts);
});

// ABC Inventory Classification (by consumption/on-hand value)
router.get('/abc-classification', requireAuth, requireRole(...INVENTORY_ROLES), (req, res) => {
  const items = db.prepare('SELECT * FROM items WHERE deleted_at IS NULL').all() as any[];
  const valued = items.map((item) => {
    const v = currentValuation(item.id);
    return { item_id: item.id, item_code: item.item_code, description: item.description, value: v.totalValue };
  });
  valued.sort((a, b) => b.value - a.value);
  const totalValue = valued.reduce((s, v) => s + v.value, 0) || 1;
  let cumulative = 0;
  const classified = valued.map((v) => {
    cumulative += v.value;
    const pct = cumulative / totalValue;
    const classification = pct <= 0.8 ? 'A' : pct <= 0.95 ? 'B' : 'C';
    return { ...v, cumulative_pct: Math.round(pct * 1000) / 10, classification };
  });
  res.json(classified);
});

// Dead Stock Analysis - no movement in 90/180/365 days
router.get('/dead-stock', requireAuth, requireRole(...INVENTORY_ROLES), (req, res) => {
  const rows = db
    .prepare(
      `SELECT i.id AS item_id, i.item_code, i.description, s.quantity,
        (SELECT MAX(d) FROM (
           SELECT MAX(grn_date) AS d FROM grns g JOIN grn_items gi ON gi.grn_id = g.id WHERE gi.item_id = i.id
           UNION SELECT MAX(issue_date) FROM material_issues mi JOIN material_issue_items mii ON mii.issue_id = mi.id WHERE mii.item_id = i.id
           UNION SELECT MAX(transfer_date) FROM transfers WHERE item_id = i.id
        )) AS last_movement
       FROM items i
       JOIN inventory_stock s ON s.item_id = i.id AND s.quantity > 0
       WHERE i.deleted_at IS NULL`
    )
    .all() as any[];

  const withAge = rows.map((r) => {
    const days = r.last_movement ? Math.floor((Date.now() - new Date(r.last_movement).getTime()) / 86400000) : null;
    let bucket: string | null = null;
    if (days === null) bucket = 'Never Moved';
    else if (days >= 365) bucket = '365+ days';
    else if (days >= 180) bucket = '180+ days';
    else if (days >= 90) bucket = '90+ days';
    return { ...r, days_since_movement: days, bucket };
  });
  res.json(withAge.filter((r) => r.bucket));
});

// ---------------------------------------------------------------------
// Cycle Count Module
// ---------------------------------------------------------------------
router.get('/cycle-counts', requireAuth, (req:AuthedRequest, res) => {const ids=authorizedWarehouseIds(req.user!.id);if(!ids.length)return res.json([]);res.json(db.prepare(`SELECT cc.*, w.name AS warehouse_name FROM cycle_counts cc JOIN warehouses w ON w.id = cc.warehouse_id WHERE cc.warehouse_id IN (${ids.map(()=>'?').join(',')}) ORDER BY cc.id DESC`).all(...ids));});

router.post('/cycle-counts', requireAuth, requireRole('WarehouseManager', 'WarehouseSupervisor'), (req: AuthedRequest, res) => {
  const { warehouse_id, item_ids } = req.body || {};
  if (!Number.isInteger(Number(warehouse_id))) return res.status(400).json({ error: 'A valid warehouse is required' });
  try{assertWarehouseAccess(req,warehouse_id,'create cycle counts');}catch(e:any){return res.status(e.status||403).json({error:e.message});}
  if (!Array.isArray(item_ids) || item_ids.length === 0) return res.status(400).json({ error: 'Select at least one item' });
  if (new Set(item_ids.map(Number)).size !== item_ids.length || item_ids.some((id: any) => !Number.isInteger(Number(id)))) return res.status(400).json({ error: 'Item selection contains invalid or duplicate values' });
  if (!db.prepare('SELECT id FROM warehouses WHERE id = ? AND deleted_at IS NULL').get(warehouse_id) || item_ids.some((id: number) => !db.prepare('SELECT id FROM items WHERE id = ? AND deleted_at IS NULL').get(id))) return res.status(400).json({ error: 'Warehouse or item does not exist or is inactive' });
  const created = db.transaction(() => {
    const countNumber = nextDocNumber('CYCLECOUNT');
    const result = db.prepare(`INSERT INTO cycle_counts (count_number, warehouse_id, created_by) VALUES (?, ?, ?)`).run(countNumber, warehouse_id, req.user!.id);
    const countId = Number(result.lastInsertRowid);
    const itemStmt = db.prepare('INSERT INTO cycle_count_items (count_id, item_id, system_qty) VALUES (?, ?, ?)');
    for (const itemId of item_ids) {
      const stock = db.prepare('SELECT SUM(quantity) AS qty FROM inventory_stock WHERE item_id = ? AND warehouse_id = ?').get(itemId, warehouse_id) as any;
      itemStmt.run(countId, itemId, stock?.qty ?? 0);
    }
    logAudit('cycle_counts', countId, 'CREATE', req.user?.id, undefined, req.body);
    return { countId, countNumber };
  })();
  const { countId, countNumber } = created;
  res.status(201).json({ id: countId, count_number: countNumber });
});

router.get('/cycle-counts/:id', requireAuth, (req, res) => {
  const count = db.prepare('SELECT * FROM cycle_counts WHERE id = ?').get(req.params.id) as any;
  if(!count)return res.status(404).json({error:'Cycle count not found'});try{assertWarehouseAccess(req as AuthedRequest,count.warehouse_id,'view cycle counts');}catch(e:any){return res.status(e.status||403).json({error:e.message});}
  const items = db
    .prepare(
      `SELECT cci.*, i.item_code, i.description FROM cycle_count_items cci
       JOIN items i ON i.id = cci.item_id WHERE cci.count_id = ?`
    )
    .all(req.params.id);
  res.json({ ...(count as object), items });
});

router.put('/cycle-counts/:id/submit-counts', requireAuth, requireRole('WarehouseSupervisor', 'Storekeeper'), (req: AuthedRequest, res) => {
  const header=db.prepare('SELECT warehouse_id FROM cycle_counts WHERE id=?').get(req.params.id) as any;if(!header)return res.status(404).json({error:'Cycle count not found'});try{assertWarehouseAccess(req,header.warehouse_id,'submit cycle counts');}catch(e:any){return res.status(e.status||403).json({error:e.message});}
  const { counts } = req.body || {}; // [{ item_id, counted_qty }]
  if (!Array.isArray(counts) || counts.length === 0) return res.status(400).json({ error: 'At least one count is required' });
  if (counts.some((c: any) => !Number.isInteger(Number(c.item_id)) || !Number.isFinite(Number(c.counted_qty)) || Number(c.counted_qty) < 0)) return res.status(400).json({ error: 'Counted quantities must be valid numbers of zero or greater' });
  for (const c of counts || []) {
    const row = db
      .prepare('SELECT * FROM cycle_count_items WHERE count_id = ? AND item_id = ?')
      .get(req.params.id, c.item_id) as any;
    if (row) {
      const variance = c.counted_qty - row.system_qty;
      db.prepare('UPDATE cycle_count_items SET counted_qty = ?, variance = ? WHERE id = ?').run(c.counted_qty, variance, row.id);
    }
  }
  db.prepare(`UPDATE cycle_counts SET status = 'Counted' WHERE id = ?`).run(req.params.id);
  res.json({ success: true });
});

router.put('/cycle-counts/:id/approve', requireAuth, requireRole('WarehouseManager', 'SupplyChainManager'), (req: AuthedRequest, res) => {
  const count = db.prepare('SELECT * FROM cycle_counts WHERE id = ?').get(req.params.id) as any;
  if (!count) return res.status(404).json({ error: 'Not found' });
  try{assertWarehouseAccess(req,count.warehouse_id,'approve cycle counts');}catch(e:any){return res.status(e.status||403).json({error:e.message});}
  if (count.status !== 'Counted') return res.status(409).json({ error: `Cycle count is ${count.status} and cannot be approved` });
  try{assertApprovalAuthority('CYCLECOUNT',Number(count.id),req.user!.id,req.user!.role,'WarehouseManager',Number(count.warehouse_id));}catch(e:any){return res.status(e.status||403).json({error:e.message});}

  try {
    assertNotSelfApproval(count.created_by, req.user!.id, req.user!.role === 'SupplyChainManager');
  } catch (e) {
    if (e instanceof SelfApprovalError) return res.status(403).json({ error: e.message });
    throw e;
  }

  db.prepare(`UPDATE cycle_counts SET status = 'Approved' WHERE id = ?`).run(req.params.id);
  recordDecision({ document_type: 'CYCLECOUNT', document_id: Number(req.params.id), decision: 'Approved', decision_by: req.user!.id });
  logAudit('cycle_counts', Number(req.params.id), 'APPROVE', req.user?.id);
  res.json({ success: true });
});

router.get('/cycle-counts/:id/approval-history', requireAuth, (req, res) => {
  const count=db.prepare('SELECT warehouse_id FROM cycle_counts WHERE id=?').get(req.params.id)as any;
  if(!count)return res.status(404).json({error:'Cycle count not found'});
  try{assertWarehouseAccess(req as AuthedRequest,count.warehouse_id,'view cycle count approval history');}catch(e:any){return res.status(e.status||403).json({error:e.message});}
  res.json(getApprovalHistory('CYCLECOUNT', Number(req.params.id)));
});

export default router;
