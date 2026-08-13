import { Router } from 'express';
import db from '../db';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { logAudit } from '../utils/auditLog';
import { receiveStock, consumeStock } from '../utils/fifo';
import { nextDocNumber } from '../utils/numbering';
import { assertNotSelfApproval, SelfApprovalError, requestApproval, recordDecision, getApprovalHistory } from '../utils/approvalLog';
import { getSettingNumber } from '../utils/settings';
import { assertLocationAccess, assertWarehouseAccess, authorizedWarehouseIds } from '../utils/warehouseAccess';
import { assertApprovalAuthority } from '../utils/approvalRouting';
import { assertPostingPeriod } from '../utils/periodControl';
import { activeIssueLimit } from '../utils/authorizationLimits';

const router = Router();
const WAREHOUSE_ROLES = ['SupplyChainManager','WarehouseManager','WarehouseSupervisor','Storekeeper'];

function storageLocation(locationId: unknown, warehouseId: unknown) {
  if (!Number.isInteger(Number(locationId))) return null;
  return db.prepare(`SELECT id, code, type FROM locations WHERE id=? AND warehouse_id=? AND type='Bin'`).get(locationId, warehouseId) as any;
}

// ---------------------------------------------------------------------
// GRN - Goods Receipt Note (Section 7). Posting a GRN creates FIFO layers
// and updates on-hand inventory.
// ---------------------------------------------------------------------
router.get('/grns', requireAuth, requireRole(...WAREHOUSE_ROLES, 'PurchaseManager','PurchaseOfficer'), (req, res) => {
  const ids=authorizedWarehouseIds((req as AuthedRequest).user!.id);if(!ids.length)return res.json([]);
  res.json(
    db
      .prepare(
        `SELECT g.*, 'Posted' AS status, s.name AS supplier_name, po.po_number FROM grns g
         JOIN suppliers s ON s.id = g.supplier_id
         JOIN purchase_orders po ON po.id = g.po_id WHERE EXISTS(SELECT 1 FROM grn_items gi WHERE gi.grn_id=g.id AND gi.warehouse_id IN (${ids.map(()=>'?').join(',')}))
         ORDER BY g.id DESC`
      )
      .all(...ids)
  );
});

router.get('/grns/:id', requireAuth, requireRole(...WAREHOUSE_ROLES, 'PurchaseManager','PurchaseOfficer'), (req, res) => {
  const grn = db.prepare(`SELECT g.*, 'Posted' AS status, s.name supplier_name, s.address supplier_address, s.contact_person supplier_contact_person,
    s.phone supplier_phone, s.email supplier_email, s.payment_terms supplier_payment_terms,
    po.po_number, po.committed_delivery_date, po.total_amount po_total_amount, u.full_name received_by_name, e.signature_url received_by_signature_url
    FROM grns g JOIN suppliers s ON s.id=g.supplier_id JOIN purchase_orders po ON po.id=g.po_id
    LEFT JOIN users u ON u.id=g.created_by LEFT JOIN employees e ON e.id=u.employee_id WHERE g.id=?`).get(req.params.id);
  if (!grn) return res.status(404).json({ error: 'GRN not found' });
  const user=(req as AuthedRequest).user!;
  if(['WarehouseManager','WarehouseSupervisor','Storekeeper'].includes(user.role)){
    const ids=authorizedWarehouseIds(user.id);
    if(!ids.length||!db.prepare(`SELECT 1 FROM grn_items WHERE grn_id=? AND warehouse_id IN (${ids.map(()=>'?').join(',')}) LIMIT 1`).get(req.params.id,...ids))return res.status(404).json({error:'GRN not found'});
  }
  const items = db.prepare(`SELECT gi.*,i.item_code,i.description,i.uom,i.purchase_uom,w.name warehouse_name,w.warehouse_code,w.site_name,l.code location_code,l.label location_label,
    pi.tax po_tax,gi.accepted_qty*gi.unit_cost*(1+COALESCE(pi.tax,0)/100.0) accepted_line_value
    FROM grn_items gi JOIN grns gh ON gh.id=gi.grn_id JOIN po_items pi ON pi.po_id=gh.po_id AND pi.item_id=gi.item_id JOIN items i ON i.id=gi.item_id JOIN warehouses w ON w.id=gi.warehouse_id LEFT JOIN locations l ON l.id=gi.location_id WHERE gi.grn_id=?`).all(req.params.id);
  const company = db.prepare('SELECT * FROM company WHERE deleted_at IS NULL ORDER BY id LIMIT 1').get() || {};
  res.json({ ...grn as object, items, company });
});

router.post('/grns', requireAuth, requireRole('SupplyChainManager', 'WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'), (req: AuthedRequest, res) => {
  const { po_id, delivery_note, items, warehouse_id } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'At least one item required' });
  try{assertPostingPeriod(req.body?.posting_date,req.user!,req.body?.period_override_reason);}catch(e:any){return res.status(e.status||409).json({error:e.message});}
  const assigned=authorizedWarehouseIds(req.user!.id);const assignedWarehouseId=Number(warehouse_id||(assigned.length===1?assigned[0]:0));
  try{assertWarehouseAccess(req,assignedWarehouseId,'receive goods');}catch(e:any){return res.status(e.status||403).json({error:e.message});}

  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(po_id) as any;
  if (!po) return res.status(404).json({ error: 'PO not found' });
  if (!['Approved', 'Printed'].includes(po.status)) {
    return res.status(400).json({ error: 'GRN can only be created against an approved PO' });
  }

  // Section 10.2: accepted + rejected must equal received; only accepted qty creates stock
  const poItems = db.prepare('SELECT item_id,quantity,price,tax FROM po_items WHERE po_id = ?').all(po_id) as any[];
  const orderedByItem = new Map(poItems.map((line) => [Number(line.item_id), Number(line.quantity)]));
  const poLineByItem = new Map(poItems.map((line) => [Number(line.item_id), line]));
  const itemUom = new Map((db.prepare('SELECT i.id,i.uom,i.purchase_uom,i.conversion_factor FROM items i JOIN po_items pi ON pi.item_id=i.id WHERE pi.po_id=?').all(po_id) as any[]).map((item) => [Number(item.id), item]));
  const receivedByItem = new Map<number, number>();
  for (const it of items) {
    const received = Number(it.quantity_received);
    const accepted = Number(it.accepted_qty ?? it.quantity_received);
    const rejected = Number(it.rejected_qty ?? 0);
    if (!Number.isInteger(Number(it.item_id)) || !orderedByItem.has(Number(it.item_id))) return res.status(400).json({ error: `Item ${it.item_id} is not on this PO` });
    if (![received, accepted, rejected].every(Number.isFinite) || received <= 0 || accepted < 0 || rejected < 0) return res.status(400).json({ error: 'Received quantities must be positive and inspection splits must be non-negative' });
    const approvedCost=Number(poLineByItem.get(Number(it.item_id))?.price);if(!Number.isFinite(approvedCost)||approvedCost<0)return res.status(409).json({error:`Approved PO cost is unavailable for item ${it.item_id}`});
    if(it.unit_cost!=null&&Math.abs(Number(it.unit_cost)-approvedCost)>.0001)return res.status(409).json({error:`Unit cost for item ${it.item_id} must match the approved PO. Refresh the PO before posting the GRN.`});
    if (Math.abs(accepted + rejected - received) > 0.0001) {
      return res.status(400).json({ error: `Accepted (${accepted}) + rejected (${rejected}) must equal received (${it.quantity_received}) for item ${it.item_id}` });
    }
    if (accepted > 0)try{assertLocationAccess(req,it.location_id,assignedWarehouseId,'receive goods');}catch(e:any){return res.status(e.status||400).json({error:e.message});}
    receivedByItem.set(Number(it.item_id), (receivedByItem.get(Number(it.item_id)) || 0) + received);
  }
  for (const [itemId, newQty] of receivedByItem) {
    const prior = (db.prepare(`SELECT COALESCE(SUM(gi.accepted_qty), 0) qty FROM grn_items gi JOIN grns g ON g.id = gi.grn_id WHERE g.po_id = ? AND gi.item_id = ?`).get(po_id, itemId) as any).qty;
    const newlyAccepted = items.filter((line:any)=>Number(line.item_id)===itemId).reduce((sum:number,line:any)=>sum+Number(line.accepted_qty ?? line.quantity_received),0);
    if (Number(prior) + newlyAccepted > (orderedByItem.get(itemId) || 0) + 0.0001) return res.status(400).json({ error: `Accepted quantity exceeds the outstanding PO quantity for item ${itemId}` });
  }

  const createGrn = db.transaction(() => {
  // Recheck the remaining PO quantity after obtaining an immediate write lock.
  // This prevents two concurrent receipts from both relying on the same stale
  // pre-transaction balance.
  for (const [itemId] of receivedByItem) {
    const prior = Number((db.prepare(`SELECT COALESCE(SUM(gi.accepted_qty),0) qty FROM grn_items gi JOIN grns g ON g.id=gi.grn_id WHERE g.po_id=? AND gi.item_id=?`).get(po_id,itemId) as any).qty);
    const newlyAccepted=items.filter((line:any)=>Number(line.item_id)===itemId).reduce((sum:number,line:any)=>sum+Number(line.accepted_qty??line.quantity_received),0);
    if(prior+newlyAccepted>(orderedByItem.get(itemId)||0)+.0001){const error:any=new Error(`Accepted quantity exceeds the outstanding PO quantity for item ${itemId}`);error.status=409;throw error;}
  }
  const grnNumber = nextDocNumber('GRN');
  const result = db
    .prepare('INSERT INTO grns (grn_number, po_id, supplier_id, delivery_note, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(grnNumber, po_id, po.supplier_id, delivery_note ?? null, req.user!.id);
  const grnId = result.lastInsertRowid as number;

  const grnItemStmt = db.prepare(
    `INSERT INTO grn_items (grn_id, item_id, quantity_received, accepted_qty, rejected_qty, rejection_reason, unit_cost, batch, expiry_date, warehouse_id, location_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let acceptedValue = 0;
  const normalizedItems=items.map((it:any)=>({...it,unit_cost:Number(poLineByItem.get(Number(it.item_id))!.price),tax:Number(poLineByItem.get(Number(it.item_id))!.tax||0)}));
  for (const it of normalizedItems) {
    const accepted = it.accepted_qty ?? it.quantity_received;
    const rejected = it.rejected_qty ?? 0;

    const grnItemResult = grnItemStmt.run(
      grnId,
      it.item_id,
      it.quantity_received,
      accepted,
      rejected,
      it.rejection_reason ?? null,
      it.unit_cost,
      it.batch ?? null,
      it.expiry_date ?? null,
      assignedWarehouseId,
      it.location_id
    );

    // Section 8 / 10.2: FIFO layer creation happens only for the accepted quantity
    if (accepted > 0) {
      const uom = itemUom.get(Number(it.item_id)) as any;
      const conversionFactor = Number(uom?.conversion_factor || 1);
      receiveStock({
        item_id: it.item_id,
        warehouse_id: assignedWarehouseId,
        location_id: it.location_id,
        quantity: accepted * conversionFactor,
        unit_cost: Number(it.unit_cost) / conversionFactor,
        batch: it.batch ?? null,
        expiry_date: it.expiry_date ?? null,
        source_grn_item_id: Number(grnItemResult.lastInsertRowid),
        transaction_type: 'GRN_RECEIPT',
        reference_number: grnNumber,
        reference_table: 'grns',
        reference_id: grnId,
        created_by: req.user!.id,
      });
      acceptedValue += accepted * it.unit_cost;

      // Section 14.3: keep the item master's last purchase price current
      db.prepare('UPDATE items SET last_purchase_price = ? WHERE id = ?').run(it.unit_cost, it.item_id);
    }
  }

  db.prepare('UPDATE grns SET accepted_value = ? WHERE id = ?').run(acceptedValue, grnId);
  const incomplete = db.prepare(`SELECT 1 FROM po_items poi WHERE poi.po_id=? AND COALESCE((SELECT SUM(gi.accepted_qty) FROM grn_items gi JOIN grns g ON g.id=gi.grn_id WHERE g.po_id=poi.po_id AND gi.item_id=poi.item_id),0) < poi.quantity LIMIT 1`).get(po_id);
  const poStatus = incomplete ? 'Printed' : 'Closed';
  db.prepare('UPDATE purchase_orders SET status = ? WHERE id = ?').run(poStatus, po_id);

  logAudit('grns', grnId, 'CREATE', req.user?.id, undefined, { grnNumber, po_id, warehouse_id: assignedWarehouseId, po_status: poStatus, items:normalizedItems, pricing_source:'APPROVED_PO' });
  return { grnId: Number(grnId), grnNumber, acceptedValue };
  });
  let created:any;try{created=createGrn.immediate();}catch(e:any){return res.status(e.status||409).json({error:e.message||'Goods receipt could not be posted; no changes were saved'});}
  const { grnId, grnNumber, acceptedValue } = created;
  res.status(201).json({ id: grnId, grn_number: grnNumber, accepted_value: acceptedValue, status: 'Posted' });
});

// ---------------------------------------------------------------------
// Material Issue - consumption tracking by employee (Section 7 & 10)
// ---------------------------------------------------------------------
router.get('/material-issues', requireAuth, requireRole(...WAREHOUSE_ROLES), (req, res) => {
  const ids=authorizedWarehouseIds((req as AuthedRequest).user!.id);if(!ids.length)return res.json([]);
  res.json(
    db
      .prepare(
        `SELECT mi.*, e.name AS employee_name, e.employee_code FROM material_issues mi
         JOIN employees e ON e.id = mi.employee_id WHERE EXISTS(SELECT 1 FROM material_issue_items mii WHERE mii.issue_id=mi.id AND mii.warehouse_id IN (${ids.map(()=>'?').join(',')})) ORDER BY mi.id DESC`
      )
      .all(...ids)
  );
});

router.get('/material-issues/:id', requireAuth, requireRole(...WAREHOUSE_ROLES), (req, res) => {
  const issue = db.prepare(`SELECT mi.*, e.name employee_name, e.employee_code FROM material_issues mi JOIN employees e ON e.id=mi.employee_id WHERE mi.id=?`).get(req.params.id);
  if (!issue) return res.status(404).json({ error: 'Material issue not found' });
  const items = db.prepare(`SELECT mii.*, i.item_code, i.description, w.name warehouse_name, w.warehouse_code, w.site_name, l.code location_code, l.label location_label FROM material_issue_items mii JOIN items i ON i.id=mii.item_id JOIN warehouses w ON w.id=mii.warehouse_id LEFT JOIN locations l ON l.id=mii.location_id WHERE mii.issue_id=?`).all(req.params.id);
  res.json({ ...issue as object, items });
});

// Section 13.3: Material Issue Approval - a configurable value threshold, or any item flagged
// High_Value_YN / Always_Approval_YN, forces the issue to wait for Warehouse Manager approval
// before stock is actually consumed. Below threshold, it posts (and consumes FIFO stock) immediately.
router.post('/material-issues', requireAuth, requireRole('SupplyChainManager', 'WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'), (req: AuthedRequest, res) => {
  const { employee_id, purpose, items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'At least one item required' });
  try{assertPostingPeriod(req.body?.posting_date,req.user!,req.body?.period_override_reason);}catch(e:any){return res.status(e.status||409).json({error:e.message});}
  if (items.some((it: any) => !Number.isFinite(Number(it.quantity)) || Number(it.quantity) <= 0)) {
    return res.status(400).json({ error: 'Every issue quantity must be greater than zero' });
  }
  if (!Number.isInteger(Number(employee_id))) return res.status(400).json({ error: 'A valid employee is required' });
  if (!db.prepare('SELECT id FROM employees WHERE id = ? AND deleted_at IS NULL').get(employee_id)) return res.status(400).json({ error: 'Employee not found or inactive' });

  const itemMasters = items.map((it: any) => ({
    ...it,
    master: db.prepare('SELECT * FROM items WHERE id = ?').get(it.item_id) as any,
  }));
  if (itemMasters.some((it) => !it.master || !Number.isInteger(Number(it.warehouse_id)))) return res.status(400).json({ error: 'Every issue line requires a valid item and warehouse' });
  try{itemMasters.forEach(it=>assertLocationAccess(req,it.location_id,it.warehouse_id,'issue stock'));}catch(e:any){return res.status(e.status||403).json({error:e.message});}

  const estimatedValue = itemMasters.reduce((sum, it) => sum + it.quantity * (it.master?.standard_cost ?? 0), 0);
  const warehouses=Array.from(new Set(itemMasters.map(it=>Number(it.warehouse_id))));if(warehouses.length!==1)return res.status(400).json({error:'A Material Issue must contain items from one authorized warehouse'});
  const authorization=activeIssueLimit(req.user!.id,warehouses[0]);if(!authorization)return res.status(403).json({error:'No active employee authorization exists for Material Issue'});
  const threshold = authorization.value_limit;
  if(authorization.quantity_limit!=null&&itemMasters.some(it=>Number(it.quantity)>Number(authorization.quantity_limit)))return res.status(403).json({error:`Issue quantity exceeds the assigned per-line limit of ${authorization.quantity_limit}`});
  if(authorization.category_scope){const allowed=new Set(String(authorization.category_scope).split(',').map(x=>x.trim()).filter(Boolean));if(itemMasters.some(it=>!allowed.has(String(it.master?.category||''))))return res.status(403).json({error:'An item category is outside the assigned Material Issue scope'});}
  const hasHighValueItem = itemMasters.some((it) => it.master?.high_value_flag || it.master?.always_approval_yn);
  // Route exceptions upward without sending a manager's own issue back to the
  // same role. SCM is the final operational authority and posts directly.
  const approvalRequired = req.user!.role!=='SupplyChainManager'&&(estimatedValue > threshold || hasHighValueItem);
  const requiredApprovalRole=req.user!.role==='WarehouseManager'?'SupplyChainManager':'WarehouseManager';

  {
    const requested = new Map<string, number>();
    itemMasters.forEach((it) => { const key = `${it.item_id}:${it.warehouse_id}:${it.location_id}`; requested.set(key, (requested.get(key) || 0) + Number(it.quantity)); });
    for (const [key, qty] of requested) {
      const [itemId, warehouseId, locationId] = key.split(':').map(Number);
      const available = (db.prepare('SELECT COALESCE(SUM(quantity_remaining), 0) qty FROM inventory_layers WHERE item_id = ? AND warehouse_id = ? AND location_id=? AND quantity_remaining > 0').get(itemId, warehouseId, locationId) as any).qty;
      if (available < qty) return res.status(400).json({ error: `Insufficient stock at the selected Bin: requested ${qty}, available ${available}` });
    }
  }

  const issueNumber = nextDocNumber('ISSUE');
  const status = approvalRequired ? 'PendingApproval' : 'Posted';

  const result = db
    .prepare(
      `INSERT INTO material_issues (issue_number, employee_id, purpose, approval_required, status, created_by,authorization_limit_id,authorization_value_limit,authorization_currency,authorization_role)
       VALUES (?, ?, ?, ?, ?, ?,?,?,?,?)`
    )
    .run(issueNumber, employee_id, purpose ?? null, approvalRequired ? 1 : 0, status, req.user!.id,authorization.limit_id,authorization.value_limit,authorization.currency,authorization.role);
  const issueId = result.lastInsertRowid as number;

  const itemStmt = db.prepare(
    'INSERT INTO material_issue_items (issue_id, item_id, warehouse_id, location_id, quantity, value) VALUES (?, ?, ?, ?, ?, ?)'
  );

  if (approvalRequired) {
    // Lines are recorded now (at standard cost, for display) but stock is only consumed on approval
    for (const it of itemMasters) {
      itemStmt.run(issueId, it.item_id, it.warehouse_id, it.location_id, it.quantity, it.quantity * (it.master?.standard_cost ?? 0));
    }
    requestApproval({ document_type: 'ISSUE', document_id: issueId, document_number: issueNumber, required_role: requiredApprovalRole, requested_by: req.user!.id,warehouse_id:Number(itemMasters[0]?.warehouse_id)||null });
  } else {
    try {
      db.transaction(() => {
        for (const it of itemMasters) {
          const { totalCost, breakdown } = consumeStock({ item_id: it.item_id, warehouse_id: it.warehouse_id, location_id: it.location_id, quantity: it.quantity });
          const lineId = Number(itemStmt.run(issueId, it.item_id, it.warehouse_id, it.location_id, it.quantity, totalCost).lastInsertRowid);
          const usageStmt = db.prepare('INSERT INTO material_issue_layer_usage (material_issue_item_id, inventory_layer_id, quantity, unit_cost) VALUES (?, ?, ?, ?)');
          breakdown.forEach((usage) => usageStmt.run(lineId, usage.layer_id, usage.quantity, usage.unit_cost));
        }
      })();
    } catch (e: any) {
      db.prepare('DELETE FROM material_issues WHERE id=?').run(issueId);
      return res.status(400).json({ error: e.message });
    }
  }

  const totalValue = itemMasters.reduce((s, it) => s + it.quantity * (it.master?.standard_cost ?? 0), 0);
  db.prepare('UPDATE material_issues SET total_value = ? WHERE id = ?').run(totalValue, issueId);

  logAudit('material_issues', issueId, 'CREATE', req.user?.id, undefined, { issueNumber, employee_id, items, approvalRequired });
  res.status(201).json({ id: issueId, issue_number: issueNumber, status });
});

// Approve a pending material issue - consumes FIFO stock at this point, not at creation
router.put('/material-issues/:id/approve', requireAuth, requireRole('WarehouseManager', 'SupplyChainManager'), (req: AuthedRequest, res) => {
  const issue = db.prepare('SELECT * FROM material_issues WHERE id = ?').get(req.params.id) as any;
  if (!issue) return res.status(404).json({ error: 'Not found' });
  if (issue.status !== 'PendingApproval') return res.status(400).json({ error: 'This issue is not pending approval' });
  try{assertPostingPeriod(req.body?.posting_date||issue.issue_date,req.user!,req.body?.period_override_reason);}catch(e:any){return res.status(e.status||409).json({error:e.message});}
  const issueWarehouse=(db.prepare('SELECT warehouse_id FROM material_issue_items WHERE issue_id=? ORDER BY id LIMIT 1').get(issue.id)as any)?.warehouse_id;
  try{assertApprovalAuthority('ISSUE',Number(issue.id),req.user!.id,req.user!.role,'WarehouseManager',issueWarehouse);}catch(e:any){return res.status(e.status||403).json({error:e.message});}
  if (req.user!.role === 'WarehouseManager') {
    const assignedWarehouseIds=authorizedWarehouseIds(req.user!.id);
    const issueWarehouseIds=(db.prepare('SELECT DISTINCT warehouse_id FROM material_issue_items WHERE issue_id=?').all(issue.id)as Array<{warehouse_id:number}>).map(row=>Number(row.warehouse_id));
    if (!assignedWarehouseIds.length || issueWarehouseIds.some(id=>!assignedWarehouseIds.includes(id))) return res.status(403).json({ error: 'You may only approve issues from your assigned warehouse' });
  }

  try {
    assertNotSelfApproval(issue.created_by, req.user!.id, req.user!.role === 'SupplyChainManager');
  } catch (e) {
    if (e instanceof SelfApprovalError) return res.status(403).json({ error: e.message });
    throw e;
  }

  const lines = db.prepare('SELECT * FROM material_issue_items WHERE issue_id = ?').all(req.params.id) as any[];
  const requested = new Map<string, number>();
  lines.forEach((line) => { const key = `${line.item_id}:${line.warehouse_id}:${line.location_id}`; requested.set(key, (requested.get(key) || 0) + Number(line.quantity)); });
  for (const [key, qty] of requested) {
    const [itemId, warehouseId, locationId] = key.split(':').map(Number);
    const available = (db.prepare('SELECT COALESCE(SUM(quantity_remaining), 0) qty FROM inventory_layers WHERE item_id = ? AND warehouse_id = ? AND location_id=? AND quantity_remaining > 0').get(itemId, warehouseId, locationId) as any).qty;
    if (available < qty) return res.status(400).json({ error: `Insufficient stock: requested ${qty}, available ${available} for item ${itemId} in warehouse ${warehouseId}` });
  }
  let actualTotal = 0;
  try {
    db.transaction(() => {
      for (const line of lines) {
        const { totalCost, breakdown } = consumeStock({ item_id: line.item_id, warehouse_id: line.warehouse_id, location_id: line.location_id, quantity: line.quantity, transaction_type: 'MATERIAL_ISSUE', reference_number: issue.issue_number, reference_table: 'material_issues', reference_id: issue.id, created_by: req.user!.id });
        db.prepare('UPDATE material_issue_items SET value = ? WHERE id = ?').run(totalCost, line.id);
        const usageStmt = db.prepare('INSERT INTO material_issue_layer_usage (material_issue_item_id, inventory_layer_id, quantity, unit_cost) VALUES (?, ?, ?, ?)');
        breakdown.forEach((usage) => usageStmt.run(line.id, usage.layer_id, usage.quantity, usage.unit_cost));
        actualTotal += totalCost;
      }
      db.prepare(`UPDATE material_issues SET status = 'Posted', approved_by = ?, total_value = ? WHERE id = ?`).run(req.user!.id, actualTotal, req.params.id);
      recordDecision({ document_type: 'ISSUE', document_id: Number(req.params.id), decision: 'Approved', decision_by: req.user!.id });
      logAudit('material_issues', Number(req.params.id), 'APPROVE', req.user?.id, issue);
    })();
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }

  res.json({ success: true });
});

router.put('/material-issues/:id/reject', requireAuth, requireRole('WarehouseManager', 'SupplyChainManager'), (req: AuthedRequest, res) => {
  const issue = db.prepare('SELECT * FROM material_issues WHERE id = ?').get(req.params.id) as any;
  if (!issue) return res.status(404).json({ error: 'Not found' });
  if (issue.status !== 'PendingApproval') return res.status(409).json({ error: `Issue is ${issue.status} and can no longer be amended` });
  const issueWarehouse=(db.prepare('SELECT warehouse_id FROM material_issue_items WHERE issue_id=? ORDER BY id LIMIT 1').get(issue.id)as any)?.warehouse_id;
  try{assertApprovalAuthority('ISSUE',Number(issue.id),req.user!.id,req.user!.role,'WarehouseManager',issueWarehouse);}catch(e:any){return res.status(e.status||403).json({error:e.message});}
  if (req.user!.role === 'WarehouseManager') {
    const assignedWarehouseIds=authorizedWarehouseIds(req.user!.id);
    const issueWarehouseIds=(db.prepare('SELECT DISTINCT warehouse_id FROM material_issue_items WHERE issue_id=?').all(issue.id)as Array<{warehouse_id:number}>).map(row=>Number(row.warehouse_id));
    if (!assignedWarehouseIds.length || issueWarehouseIds.some(id=>!assignedWarehouseIds.includes(id))) return res.status(403).json({ error: 'You may only reject issues from your assigned warehouse' });
  }

  try {
    assertNotSelfApproval(issue.created_by, req.user!.id, req.user!.role === 'SupplyChainManager');
  } catch (e) {
    if (e instanceof SelfApprovalError) return res.status(403).json({ error: e.message });
    throw e;
  }

  db.prepare(`UPDATE material_issues SET status = 'Rejected' WHERE id = ?`).run(req.params.id);
  recordDecision({ document_type: 'ISSUE', document_id: Number(req.params.id), decision: 'Rejected', decision_by: req.user!.id });
  logAudit('material_issues', Number(req.params.id), 'REJECT', req.user?.id);
  res.json({ success: true });
});

// ---------------------------------------------------------------------
// Returns (returnable items only - tools, equipment, reusable materials)
// ---------------------------------------------------------------------
router.get('/returns', requireAuth, (req, res) => res.json(db.prepare(`SELECT r.*, i.item_code, i.description, e.name AS employee_name, w.name warehouse_name, w.warehouse_code, w.site_name, l.code location_code, l.label location_label FROM returns r JOIN items i ON i.id = r.item_id LEFT JOIN employees e ON e.id = r.employee_id LEFT JOIN warehouses w ON w.id=r.warehouse_id LEFT JOIN locations l ON l.id=r.location_id ORDER BY r.id DESC`).all()));

router.post('/returns', requireAuth, requireRole('SupplyChainManager', 'WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'), (req: AuthedRequest, res) => {
  const { item_id, employee_id, quantity, condition, warehouse_id, location_id } = req.body || {};
  try{assertPostingPeriod(req.body?.posting_date,req.user!,req.body?.period_override_reason);}catch(e:any){return res.status(e.status||409).json({error:e.message});}
  if (!Number.isInteger(Number(item_id)) || !Number.isInteger(Number(warehouse_id))) return res.status(400).json({ error: 'Item and warehouse are required' });
  if (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0) return res.status(400).json({ error: 'Quantity must be greater than zero' });
  if (!['Good', 'Damaged', 'Needs Repair'].includes(condition)) return res.status(400).json({ error: 'Select a valid condition' });
  if (!Number.isInteger(Number(employee_id))) return res.status(400).json({ error: 'Employee is required to validate the outstanding returnable quantity' });
  try{assertLocationAccess(req,location_id,warehouse_id,'receive returns');}catch(e:any){return res.status(e.status||403).json({error:e.message});}
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(item_id) as any;
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (item.consumable_returnable !== 'Returnable') {
    return res.status(400).json({ error: 'This item is Consumable and does not support returns' });
  }
  const issued = (db.prepare(`SELECT COALESCE(SUM(mii.quantity),0) qty FROM material_issue_items mii JOIN material_issues mi ON mi.id=mii.issue_id WHERE mi.employee_id=? AND mii.item_id=? AND mi.status='Posted'`).get(employee_id, item_id) as any).qty;
  const returned = (db.prepare(`SELECT COALESCE(SUM(quantity),0) qty FROM returns WHERE employee_id=? AND item_id=?`).get(employee_id, item_id) as any).qty;
  const outstanding = Number(issued) - Number(returned);
  if (Number(quantity) > outstanding) return res.status(400).json({ error: `Return quantity exceeds outstanding quantity (${outstanding})` });

  const created = db.transaction(() => {
    const returnNumber = nextDocNumber('RETURN');
    const result = db.prepare('INSERT INTO returns (return_number, item_id, employee_id, quantity, condition, warehouse_id, location_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(returnNumber, item_id, employee_id, quantity, condition, warehouse_id, location_id);
    receiveStock({ item_id, warehouse_id, location_id, quantity, unit_cost: item.standard_cost, transaction_type: 'RETURN', reference_number: returnNumber, reference_table: 'returns', reference_id: Number(result.lastInsertRowid), created_by: req.user!.id });
    logAudit('returns', Number(result.lastInsertRowid), 'CREATE', req.user?.id, undefined, req.body);
    return { id: result.lastInsertRowid, returnNumber };
  })();
  const { id, returnNumber } = created;
  res.status(201).json({ id, return_number: returnNumber });
});

// ---------------------------------------------------------------------
// Warehouse Transfers (between warehouse / location / bin)
// ---------------------------------------------------------------------
router.get('/bin-transfers',requireAuth,requireRole(...WAREHOUSE_ROLES),(req:AuthedRequest,res)=>{const ids=authorizedWarehouseIds(req.user!.id);if(!ids.length)return res.json([]);res.json(db.prepare(`SELECT bt.*,w.warehouse_code,w.name warehouse_name,i.item_code,i.description,fl.code from_bin,tl.code to_bin,u.full_name completed_by_name FROM bin_transfers bt JOIN warehouses w ON w.id=bt.warehouse_id JOIN items i ON i.id=bt.item_id JOIN locations fl ON fl.id=bt.from_location_id JOIN locations tl ON tl.id=bt.to_location_id LEFT JOIN users u ON u.id=bt.completed_by WHERE bt.warehouse_id IN (${ids.map(()=>'?').join(',')}) ORDER BY bt.id DESC`).all(...ids));});
router.post('/bin-transfers',requireAuth,requireRole('SupplyChainManager','WarehouseManager','WarehouseSupervisor','Storekeeper'),(req:AuthedRequest,res)=>{const {warehouse_id,item_id,from_location_id,to_location_id,quantity,reason}=req.body||{};if(!Number.isInteger(Number(item_id))||!Number.isFinite(Number(quantity))||Number(quantity)<=0||!String(reason||'').trim())return res.status(400).json({error:'Item, positive quantity and transfer reason are required'});if(Number(from_location_id)===Number(to_location_id))return res.status(400).json({error:'Source and destination BIN must be different'});try{assertLocationAccess(req,from_location_id,warehouse_id,'move stock between BINs');assertLocationAccess(req,to_location_id,warehouse_id,'move stock between BINs');const created=db.transaction(()=>{const number=nextDocNumber('BINTRANSFER');const consumed=consumeStock({item_id:Number(item_id),warehouse_id:Number(warehouse_id),location_id:Number(from_location_id),quantity:Number(quantity),transaction_type:'BIN_TRANSFER_OUT',reference_number:number,reference_table:'bin_transfers',created_by:req.user!.id});receiveStock({item_id:Number(item_id),warehouse_id:Number(warehouse_id),location_id:Number(to_location_id),quantity:Number(quantity),unit_cost:consumed.totalCost/Number(quantity),transaction_type:'BIN_TRANSFER_IN',reference_number:number,reference_table:'bin_transfers',created_by:req.user!.id});const row=db.prepare('INSERT INTO bin_transfers(transfer_number,warehouse_id,item_id,from_location_id,to_location_id,quantity,reason,completed_by) VALUES(?,?,?,?,?,?,?,?)').run(number,warehouse_id,item_id,from_location_id,to_location_id,quantity,String(reason).trim(),req.user!.id);logAudit('bin_transfers',Number(row.lastInsertRowid),'CREATE',req.user!.id,undefined,req.body);return{id:Number(row.lastInsertRowid),transfer_number:number};})();return res.status(201).json(created);}catch(e:any){return res.status(e.status||400).json({error:e.message});}});

router.get('/transfers', requireAuth, (req:AuthedRequest, res) => {const ids=authorizedWarehouseIds(req.user!.id);if(!ids.length)return res.json([]);res.json(db.prepare(`SELECT t.*, i.item_code, i.description, fw.name AS from_warehouse_name, fw.site_name from_site_name, tw.name AS to_warehouse_name, tw.site_name to_site_name, fl.code from_location_code, tl.code to_location_code,du.full_name dispatched_by_name,ru.full_name received_by_name,tr.receipt_number FROM transfers t JOIN items i ON i.id=t.item_id LEFT JOIN warehouses fw ON fw.id=t.from_warehouse_id LEFT JOIN warehouses tw ON tw.id=t.to_warehouse_id LEFT JOIN locations fl ON fl.id=t.from_location_id LEFT JOIN locations tl ON tl.id=t.to_location_id LEFT JOIN users du ON du.id=t.dispatched_by LEFT JOIN users ru ON ru.id=t.received_by LEFT JOIN transfer_receipts tr ON tr.transfer_id=t.id WHERE t.from_warehouse_id IN(${ids.map(()=>'?').join(',')}) OR t.to_warehouse_id IN(${ids.map(()=>'?').join(',')}) ORDER BY t.id DESC`).all(...ids,...ids));});

router.post('/transfers', requireAuth, requireRole('SupplyChainManager', 'WarehouseManager', 'WarehouseSupervisor'), (req: AuthedRequest, res) => {
  const { item_id, quantity, from_warehouse_id, from_location_id, to_warehouse_id, to_location_id, transport_mode, vehicle_reference, driver_name, tracking_reference, remarks } = req.body || {};
  try{assertPostingPeriod(req.body?.posting_date,req.user!,req.body?.period_override_reason);}catch(e:any){return res.status(e.status||409).json({error:e.message});}
  if (![item_id, from_warehouse_id, to_warehouse_id].every((v) => Number.isInteger(Number(v)))) return res.status(400).json({ error: 'Item, source warehouse, and destination warehouse are required' });
  if (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0) return res.status(400).json({ error: 'Quantity must be greater than zero' });
  if (Number(from_warehouse_id) === Number(to_warehouse_id) && Number(from_location_id || 0) === Number(to_location_id || 0)) return res.status(400).json({ error: 'Source and destination must be different' });
  if (!String(transport_mode || '').trim()) return res.status(400).json({ error: 'Mode of transfer is required' });
  try{assertLocationAccess(req,from_location_id,from_warehouse_id,'dispatch stock');}catch(e:any){return res.status(e.status||403).json({error:e.message});}
  const destination=db.prepare("SELECT id FROM locations WHERE id=? AND warehouse_id=? AND type='Bin' AND deleted_at IS NULL").get(to_location_id,to_warehouse_id);if(!destination)return res.status(400).json({error:'Select a valid destination Bin in the receiving warehouse'});
  try {
    const result = db.transaction(() => {
      const transferNumber = nextDocNumber('TRANSFER');
      const { totalCost } = consumeStock({ item_id, warehouse_id: from_warehouse_id, location_id: from_location_id, quantity, transaction_type:'TRANSFER_DISPATCH', reference_number:transferNumber, reference_table:'transfers', created_by:req.user!.id });
      const unitCost = totalCost / quantity;
      const insert = db.prepare(
        `INSERT INTO transfers (transfer_number,item_id,quantity,from_warehouse_id,from_location_id,to_warehouse_id,to_location_id,transport_mode,vehicle_reference,driver_name,tracking_reference,remarks,status,dispatched_by,dispatched_at,unit_cost)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'In Transit',?,datetime('now'),?)`
      ).run(transferNumber,item_id,quantity,from_warehouse_id,from_location_id??null,to_warehouse_id,to_location_id??null,transport_mode,vehicle_reference??null,driver_name??null,tracking_reference??null,remarks??null,req.user!.id,unitCost);
      return { insert, transferNumber };
    })();
    logAudit('transfers', Number(result.insert.lastInsertRowid), 'CREATE', req.user?.id, undefined, req.body);
    return res.status(201).json({ id: result.insert.lastInsertRowid, transfer_number: result.transferNumber });
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
});

router.put('/transfers/:id/receive',requireAuth,requireRole('SupplyChainManager','WarehouseManager','WarehouseSupervisor','Storekeeper'),(req:AuthedRequest,res)=>{const transfer=db.prepare('SELECT * FROM transfers WHERE id=?').get(req.params.id)as any;if(!transfer)return res.status(404).json({error:'Transfer not found'});if(transfer.status!=='In Transit')return res.status(409).json({error:`Transfer is already ${transfer.status}`});try{assertWarehouseAccess(req,transfer.to_warehouse_id,'receive this warehouse transfer');assertLocationAccess(req,req.body?.to_location_id||transfer.to_location_id,transfer.to_warehouse_id,'receive transferred stock');assertPostingPeriod(req.body?.posting_date,req.user!,req.body?.period_override_reason);}catch(e:any){return res.status(e.status||403).json({error:e.message});}const locationId=Number(req.body?.to_location_id||transfer.to_location_id),reference=String(req.body?.receiving_reference||'').trim()||`TRR-${transfer.transfer_number}`;try{db.transaction(()=>{receiveStock({item_id:transfer.item_id,warehouse_id:transfer.to_warehouse_id,location_id:locationId,quantity:transfer.quantity,unit_cost:Number(transfer.unit_cost||0),transaction_type:'TRANSFER_RECEIPT',reference_number:reference,reference_table:'transfer_receipts',reference_id:transfer.id,created_by:req.user!.id});db.prepare('INSERT INTO transfer_receipts(receipt_number,transfer_id,warehouse_id,location_id,item_id,quantity_received,receiving_note,received_by) VALUES(?,?,?,?,?,?,?,?)').run(reference,transfer.id,transfer.to_warehouse_id,locationId,transfer.item_id,transfer.quantity,req.body?.receiving_note||null,req.user!.id);const changed=db.prepare("UPDATE transfers SET status='Received',to_location_id=?,received_by=?,received_at=datetime('now'),receiving_reference=?,receiving_note=? WHERE id=? AND status='In Transit'").run(locationId,req.user!.id,reference,req.body?.receiving_note||null,transfer.id);if(!changed.changes)throw Object.assign(new Error('Another user already received this transfer'),{status:409});logAudit('transfer_receipts',transfer.id,'CREATE',req.user!.id,undefined,{receipt_number:reference,transfer_id:transfer.id,to_location_id:locationId});}).immediate();res.json({success:true,status:'Received',receipt_number:reference});}catch(e:any){res.status(e.status||409).json({error:e.message});}});

// ---------------------------------------------------------------------
// Stock Adjustments - requires reason + approval (Section 7)
// ---------------------------------------------------------------------
router.get('/adjustments', requireAuth, (req, res) => res.json(db.prepare(`SELECT a.*, i.item_code, i.description, w.name AS warehouse_name, w.site_name, l.code location_code, l.label location_label FROM stock_adjustments a JOIN items i ON i.id = a.item_id JOIN warehouses w ON w.id = a.warehouse_id LEFT JOIN locations l ON l.id=a.location_id ORDER BY a.id DESC`).all()));

router.post('/adjustments', requireAuth, requireRole('SupplyChainManager', 'WarehouseManager', 'WarehouseSupervisor'), (req: AuthedRequest, res) => {
  const { item_id, warehouse_id, location_id, quantity_change, reason } = req.body || {};
  if (!Number.isInteger(Number(item_id)) || !Number.isInteger(Number(warehouse_id))) return res.status(400).json({ error: 'Item and warehouse are required' });
  if (!Number.isFinite(Number(quantity_change)) || Number(quantity_change) === 0) return res.status(400).json({ error: 'Quantity change must be a non-zero number' });
  if (!String(reason || '').trim()) return res.status(400).json({ error: 'Reason is required for stock adjustments' });
  try{assertLocationAccess(req,location_id,warehouse_id,'adjust stock');}catch(e:any){return res.status(e.status||403).json({error:e.message});}
  const created = db.transaction(() => {
    const adjustmentNumber = nextDocNumber('ADJUSTMENT');
    const result = db.prepare(`INSERT INTO stock_adjustments (adjustment_number, item_id, warehouse_id, location_id, quantity_change, reason, status, created_by) VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?)`).run(adjustmentNumber, item_id, warehouse_id, location_id, quantity_change, reason, req.user!.id);
    const adjId = Number(result.lastInsertRowid);
    requestApproval({ document_type: 'ADJUSTMENT', document_id: adjId, document_number: adjustmentNumber, required_role: 'WarehouseManager', requested_by: req.user!.id,warehouse_id:Number(warehouse_id) });
    logAudit('stock_adjustments', adjId, 'CREATE', req.user?.id, undefined, req.body);
    return { adjId, adjustmentNumber };
  })();
  const { adjId, adjustmentNumber } = created;
  res.status(201).json({ id: adjId, adjustment_number: adjustmentNumber });
});

router.put('/adjustments/:id/approve', requireAuth, requireRole('WarehouseManager', 'SupplyChainManager'), (req: AuthedRequest, res) => {
  const adj = db.prepare('SELECT * FROM stock_adjustments WHERE id = ?').get(req.params.id) as any;
  if (!adj) return res.status(404).json({ error: 'Not found' });
  if (adj.status !== 'Pending') return res.status(400).json({ error: 'Already processed' });
  try{assertPostingPeriod(req.body?.posting_date||adj.adjustment_date,req.user!,req.body?.period_override_reason);}catch(e:any){return res.status(e.status||409).json({error:e.message});}
  try{assertApprovalAuthority('ADJUSTMENT',Number(adj.id),req.user!.id,req.user!.role,'WarehouseManager',Number(adj.warehouse_id));}catch(e:any){return res.status(e.status||403).json({error:e.message});}

  try {
    assertNotSelfApproval(adj.created_by, req.user!.id, req.user!.role === 'SupplyChainManager');
  } catch (e) {
    if (e instanceof SelfApprovalError) return res.status(403).json({ error: e.message });
    throw e;
  }

  try { db.transaction(() => {
    if (adj.quantity_change > 0) {
      const item = db.prepare('SELECT * FROM items WHERE id = ?').get(adj.item_id) as any;
      receiveStock({ item_id: adj.item_id, warehouse_id: adj.warehouse_id, location_id: adj.location_id, quantity: adj.quantity_change, unit_cost: item.standard_cost, transaction_type: 'ADJUSTMENT', reference_number: adj.adjustment_number, reference_table: 'stock_adjustments', reference_id: adj.id, created_by: req.user!.id });
    } else consumeStock({ item_id: adj.item_id, warehouse_id: adj.warehouse_id, location_id: adj.location_id, quantity: Math.abs(adj.quantity_change), transaction_type: 'ADJUSTMENT', reference_number: adj.adjustment_number, reference_table: 'stock_adjustments', reference_id: adj.id, created_by: req.user!.id });
    db.prepare(`UPDATE stock_adjustments SET status = 'Approved', approved_by = ? WHERE id = ?`).run(req.user!.id, req.params.id);
    recordDecision({ document_type: 'ADJUSTMENT', document_id: Number(req.params.id), decision: 'Approved', decision_by: req.user!.id });
    logAudit('stock_adjustments', Number(req.params.id), 'APPROVE', req.user?.id, adj);
  })(); } catch (e: any) { return res.status(400).json({ error: e.message }); }
  res.json({ success: true });
});

router.get('/material-issues/:id/approval-history', requireAuth, (req, res) => {
  res.json(getApprovalHistory('ISSUE', Number(req.params.id)));
});

router.get('/adjustments/:id/approval-history', requireAuth, (req, res) => {
  res.json(getApprovalHistory('ADJUSTMENT', Number(req.params.id)));
});

export default router;
