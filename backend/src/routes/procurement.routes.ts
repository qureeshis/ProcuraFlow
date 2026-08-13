import { Router } from 'express';
import db from '../db';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireRole, maxApprovalFor } from '../middleware/rbac';
import { logAudit } from '../utils/auditLog';
import { nextDocNumber } from '../utils/numbering';
import { assertNotSelfApproval, SelfApprovalError, requestApproval, recordDecision, getApprovalHistory } from '../utils/approvalLog';
import { assertApprovalAuthority } from '../utils/approvalRouting';
import { assertPostingPeriod } from '../utils/periodControl';
import { captureApprovedRevision } from '../utils/documentRevision';
import { activePoApprovalLimit } from '../utils/authorizationLimits';
import {assertExternalHandoffAuthority} from '../utils/delegatedAuthority';

const router = Router();

const EPSILON = 0.0001;
function currencyContext(transactionCurrency?:string,providedRate?:unknown,date?:string){const company=db.prepare("SELECT COALESCE(base_currency,currency,'SAR') base_currency FROM company WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1").get() as any;const base=String(company?.base_currency||'SAR').toUpperCase(),transaction=String(transactionCurrency||base).toUpperCase();if(!db.prepare('SELECT 1 FROM currencies WHERE currency_code=? AND active_yn=1').get(transaction))throw new Error(`Currency ${transaction} is inactive or invalid`);if(transaction===base)return{transaction,base,rate:1};const supplied=Number(providedRate);const stored=db.prepare(`SELECT rate FROM exchange_rates WHERE from_currency=? AND to_currency=? AND active_yn=1 AND effective_date<=? AND (expiry_date IS NULL OR expiry_date>=?) ORDER BY effective_date DESC,id DESC LIMIT 1`).get(transaction,base,date||new Date().toISOString().slice(0,10),date||new Date().toISOString().slice(0,10)) as any;const rate=Number.isFinite(supplied)&&supplied>0?supplied:Number(stored?.rate);if(!Number.isFinite(rate)||rate<=0)throw new Error(`A valid ${transaction} to ${base} exchange rate is required`);return{transaction,base,rate};}
function allocatedPrItemQuantity(prItemId:number,excludePoId?:number){return Number((db.prepare(`SELECT COALESCE(SUM(a.quantity),0) quantity FROM po_pr_item_allocations a JOIN purchase_orders po ON po.id=a.po_id WHERE a.pr_item_id=? AND po.status<>'Rejected' ${excludePoId?'AND a.po_id<>?':''}`).get(...(excludePoId?[prItemId,excludePoId]:[prItemId])) as any).quantity||0);}
function syncPrBalanceStatus(prId:number){const pr=db.prepare('SELECT status,closed_manually FROM purchase_requisitions WHERE id=?').get(prId) as any;if(!pr||pr.closed_manually)return;const lines=db.prepare('SELECT id,quantity FROM pr_items WHERE pr_id=?').all(prId) as any[];const complete=lines.length>0&&lines.every(line=>Number(line.quantity)-allocatedPrItemQuantity(Number(line.id))<=EPSILON);db.prepare("UPDATE purchase_requisitions SET status=?,closed_manually=0 WHERE id=?").run(complete?'Closed':'Submitted',prId);}

// ---------------------------------------------------------------------
// Purchase Requisitions (PR)
// ---------------------------------------------------------------------
router.get('/prs', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT pr.*, d.name AS department_name, CASE WHEN pr.auto_generated=1 THEN 'ProcuraFlow' ELSE u.full_name END AS requestor_name,
         (SELECT al.decision FROM approval_log al WHERE al.document_type='PR' AND al.document_id=pr.id ORDER BY al.id DESC LIMIT 1) AS approval_decision,
         COALESCE((SELECT ppl.po_id FROM po_pr_links ppl WHERE ppl.pr_id=pr.id LIMIT 1), (SELECT po.id FROM purchase_orders po WHERE po.pr_id=pr.id LIMIT 1)) AS converted_po_id
       FROM purchase_requisitions pr
       LEFT JOIN departments d ON d.id = pr.department_id
       LEFT JOIN users u ON u.id = pr.requestor_id
       ORDER BY pr.id DESC`
    )
    .all();
  res.json(rows);
});

router.get('/prs/:id', requireAuth, (req, res) => {
  const pr = db.prepare(`SELECT pr.*,d.name department_name,CASE WHEN pr.auto_generated=1 THEN 'ProcuraFlow' ELSE u.full_name END requestor_name,e.signature_url requestor_signature_url FROM purchase_requisitions pr LEFT JOIN departments d ON d.id=pr.department_id LEFT JOIN users u ON u.id=pr.requestor_id LEFT JOIN employees e ON e.id=u.employee_id WHERE pr.id=?`).get(req.params.id);
  if (!pr) return res.status(404).json({ error: 'Not found' });
  const items = db
    .prepare(
      `SELECT pri.*, i.item_code, i.description, i.uom, i.purchase_uom, i.issue_uom,
         COALESCE((SELECT SUM(a.quantity) FROM po_pr_item_allocations a JOIN purchase_orders po ON po.id=a.po_id WHERE a.pr_item_id=pri.id AND po.status<>'Rejected'),0) AS ordered_quantity,
         MAX(0,pri.quantity-COALESCE((SELECT SUM(a.quantity) FROM po_pr_item_allocations a JOIN purchase_orders po ON po.id=a.po_id WHERE a.pr_item_id=pri.id AND po.status<>'Rejected'),0)) AS remaining_quantity
       FROM pr_items pri
       JOIN items i ON i.id = pri.item_id WHERE pri.pr_id = ?`
    )
    .all(req.params.id);
  const company=db.prepare('SELECT * FROM company WHERE deleted_at IS NULL ORDER BY id LIMIT 1').get()||{};
  const approvals=getApprovalHistory('PR',Number(req.params.id));
  res.json({ ...pr, items, company, approvals });
});

router.put('/prs/:id', requireAuth, requireRole('SupplyChainManager'), (req: AuthedRequest,res) => {
  const pr=db.prepare('SELECT * FROM purchase_requisitions WHERE id=?').get(req.params.id) as any;
  if(!pr)return res.status(404).json({error:'PR not found'});
  if(pr.status!=='Submitted')return res.status(409).json({error:`PR is ${pr.status} and cannot be edited`});
  if(db.prepare("SELECT id FROM approval_log WHERE document_type='PR' AND document_id=? AND decision='Approved' LIMIT 1").get(pr.id))return res.status(409).json({error:'An approved PR awaiting PO creation cannot be edited'});
  const {department_id,items}=req.body||{};
  if(!Number.isInteger(Number(department_id))||!Array.isArray(items)||!items.length||items.some((line:any)=>!Number.isInteger(Number(line.item_id))||!(Number(line.quantity)>0)))return res.status(400).json({error:'Valid department and positive item lines are required'});
  db.transaction(()=>{db.prepare('UPDATE purchase_requisitions SET department_id=? WHERE id=?').run(department_id,pr.id);db.prepare('DELETE FROM pr_items WHERE pr_id=?').run(pr.id);const insert=db.prepare('INSERT INTO pr_items (pr_id,item_id,quantity,required_date,reason) VALUES (?,?,?,?,?)');items.forEach((line:any)=>insert.run(pr.id,line.item_id,line.quantity,line.required_date||null,line.reason||null));logAudit('purchase_requisitions',pr.id,'UPDATE',req.user?.id,pr,{department_id,items});})();
  res.json({success:true});
});

router.post('/prs', requireAuth, requireRole('SupplyChainManager', 'PurchaseManager', 'PurchaseOfficer', 'WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'), (req: AuthedRequest, res) => {
  const { department_id, items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'At least one item required' });
  if (!Number.isInteger(Number(department_id))) return res.status(400).json({ error: 'A valid department is required' });
  if (items.some((it: any) => !Number.isInteger(Number(it.item_id)) || !Number.isFinite(Number(it.quantity)) || Number(it.quantity) <= 0)) {
    return res.status(400).json({ error: 'Every PR line requires a valid item and quantity greater than zero' });
  }
  if (!db.prepare('SELECT id FROM departments WHERE id = ? AND deleted_at IS NULL').get(department_id) || items.some((it: any) => !db.prepare('SELECT id FROM items WHERE id = ? AND deleted_at IS NULL').get(it.item_id))) return res.status(400).json({ error: 'Department or item does not exist or is inactive' });

  // Accountability: an interactive PR is always attributed to the logged-in
  // creator. System replenishment PRs are created by the background service.
  const requestorId = req.user!.id;

  const created = db.transaction(() => {
    const prNumber = nextDocNumber('PR');
    const result = db.prepare('INSERT INTO purchase_requisitions (pr_number, requestor_id, department_id, status) VALUES (?, ?, ?, ?)').run(prNumber, requestorId, department_id, 'Submitted');
    const prId = Number(result.lastInsertRowid);
    const itemStmt = db.prepare('INSERT INTO pr_items (pr_id, item_id, quantity, required_date, reason) VALUES (?, ?, ?, ?, ?)');
    for (const it of items) itemStmt.run(prId, it.item_id, it.quantity, it.required_date ?? null, it.reason ?? null);
    const requiredRole=['PurchaseManager','SupplyChainManager'].includes(req.user!.role)?'SupplyChainManager':'PurchaseManager';
    requestApproval({ document_type: 'PR', document_id: prId, document_number: prNumber, required_role: requiredRole, requested_by: req.user!.id });
    logAudit('purchase_requisitions', prId, 'CREATE', req.user?.id, undefined, { prNumber, items });
    return { prId, prNumber };
  })();
  const { prId, prNumber } = created;
  res.status(201).json({ id: prId, pr_number: prNumber });
});

router.put('/prs/:id/status', requireAuth, requireRole('PurchaseOfficer', 'PurchaseManager', 'SupplyChainManager'), (req: AuthedRequest, res) => {
  const { status } = req.body || {};
  if (!['Approved', 'Rejected', 'Closed'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const pr = db.prepare('SELECT * FROM purchase_requisitions WHERE id = ?').get(req.params.id) as any;
  if (!pr) return res.status(404).json({ error: 'Not found' });
  if ((status === 'Approved' || status === 'Rejected') && req.user!.role === 'PurchaseOfficer') return res.status(403).json({ error: 'Purchase Officers may close an approved PR balance but cannot approve or reject a PR' });
  if ((status === 'Approved' || status === 'Rejected') && pr.status !== 'Submitted') return res.status(409).json({ error: `PR is ${pr.status} and can no longer be amended` });
  const priorApproval = db.prepare("SELECT decision FROM approval_log WHERE document_type='PR' AND document_id=? AND decision IN ('Approved','Rejected') ORDER BY id DESC LIMIT 1").get(pr.id) as any;
  if ((status === 'Approved' || status === 'Rejected') && priorApproval) return res.status(409).json({ error: `PR already has a final ${priorApproval.decision.toLowerCase()} decision` });
  const hasApproval=Boolean(db.prepare("SELECT 1 FROM approval_log WHERE document_type='PR' AND document_id=? AND decision='Approved' LIMIT 1").get(pr.id));
  if (status === 'Closed' && (pr.status !== 'Submitted' || !hasApproval)) return res.status(409).json({ error: 'Only a submitted and approved PR balance can be closed' });

  if (status === 'Approved' || status === 'Rejected') {
    try{assertApprovalAuthority('PR',Number(pr.id),req.user!.id,req.user!.role,'PurchaseManager');}catch(e:any){return res.status(e.status||403).json({error:e.message});}
    try {
      assertNotSelfApproval(pr.requestor_id, req.user!.id, req.user!.role === 'SupplyChainManager');
    } catch (e) {
      if (e instanceof SelfApprovalError) return res.status(403).json({ error: e.message });
      throw e;
    }
  }

  const documentStatus = status === 'Approved' ? 'Submitted' : status;
  db.prepare('UPDATE purchase_requisitions SET status = ?, closed_manually = ? WHERE id = ?').run(documentStatus, status === 'Closed' ? 1 : 0, req.params.id);
  if (status === 'Approved' || status === 'Rejected') {
    recordDecision({ document_type: 'PR', document_id: Number(req.params.id), decision: status, decision_by: req.user!.id });
  }
  logAudit('purchase_requisitions', Number(req.params.id), status === 'Approved' ? 'APPROVE' : status === 'Closed' ? 'UPDATE' : 'REJECT', req.user?.id, undefined, { decision: status, status: documentStatus, auto_generated: !!pr.auto_generated, manual_close: status === 'Closed' });
  res.json({ success: true, status: documentStatus });
});

router.get('/prs/:id/approval-history', requireAuth, (req, res) => {
  res.json(getApprovalHistory('PR', Number(req.params.id)));
});

// ---------------------------------------------------------------------
// RFQ + Supplier Quotations + Comparison
// ---------------------------------------------------------------------
router.get('/rfqs', requireAuth, requireRole('SupplyChainManager','PurchaseManager','PurchaseOfficer'), (req, res) => {
  res.json(db.prepare('SELECT * FROM rfqs ORDER BY id DESC').all());
});

router.post('/rfqs', requireAuth, requireRole('PurchaseOfficer', 'PurchaseManager'), (req: AuthedRequest, res) => {
  const { pr_id, supplier_ids } = req.body || {};
  if (!Array.isArray(supplier_ids) || supplier_ids.length === 0) return res.status(400).json({ error: 'Select at least one supplier' });
  if (new Set(supplier_ids.map(Number)).size !== supplier_ids.length || supplier_ids.some((id: any) => !Number.isInteger(Number(id)))) {
    return res.status(400).json({ error: 'Supplier selection contains invalid or duplicate values' });
  }
  if (supplier_ids.some((id: number) => !db.prepare('SELECT id FROM suppliers WHERE id = ? AND deleted_at IS NULL').get(id))) return res.status(400).json({ error: 'A selected supplier does not exist or is inactive' });
  if (pr_id != null && !db.prepare("SELECT pr.id FROM purchase_requisitions pr WHERE pr.id=? AND pr.status='Submitted' AND EXISTS (SELECT 1 FROM approval_log al WHERE al.document_type='PR' AND al.document_id=pr.id AND al.decision='Approved')").get(pr_id)) return res.status(400).json({ error: 'Linked PR must exist and be approved' });
  const created = db.transaction(() => {
    const rfqNumber = nextDocNumber('RFQ');
    const result = db.prepare('INSERT INTO rfqs (rfq_number, pr_id) VALUES (?, ?)').run(rfqNumber, pr_id ?? null);
    const rfqId = Number(result.lastInsertRowid);
    const stmt = db.prepare('INSERT INTO rfq_suppliers (rfq_id, supplier_id) VALUES (?, ?)');
    supplier_ids.forEach((sid: number) => stmt.run(rfqId, sid));
    logAudit('rfqs', rfqId, 'CREATE', req.user?.id, undefined, req.body);
    return { rfqId, rfqNumber };
  })();
  const { rfqId, rfqNumber } = created;
  res.status(201).json({ id: rfqId, rfq_number: rfqNumber });
});

router.post('/rfqs/:id/quotations', requireAuth, requireRole('PurchaseOfficer', 'PurchaseManager'), (req: AuthedRequest, res) => {
  const { supplier_id, item_id, price, freight, tax, delivery_time_days, payment_terms, quality_rating, warranty } = req.body || {};
  if (!Number.isInteger(Number(supplier_id)) || !Number.isInteger(Number(item_id))) return res.status(400).json({ error: 'Supplier and item are required' });
  if (!Number.isFinite(Number(price)) || Number(price) <= 0) return res.status(400).json({ error: 'Price must be greater than zero' });
  if (delivery_time_days != null && (!Number.isInteger(Number(delivery_time_days)) || Number(delivery_time_days) < 0)) return res.status(400).json({ error: 'Delivery time must be zero or greater' });
  if (quality_rating != null && (!Number.isFinite(Number(quality_rating)) || Number(quality_rating) < 0 || Number(quality_rating) > 5)) return res.status(400).json({ error: 'Quality rating must be between 0 and 5' });
  if (!Number.isFinite(Number(freight ?? 0)) || Number(freight ?? 0) < 0 || !Number.isFinite(Number(tax ?? 0)) || Number(tax ?? 0) < 0) return res.status(400).json({ error: 'Freight and tax must be non-negative' });
  const invited = db.prepare('SELECT id FROM rfq_suppliers WHERE rfq_id = ? AND supplier_id = ?').get(req.params.id, supplier_id);
  if (!invited) return res.status(400).json({ error: 'Supplier was not invited to this RFQ' });
  if (!db.prepare('SELECT id FROM items WHERE id = ? AND deleted_at IS NULL').get(item_id)) return res.status(400).json({ error: 'Item does not exist or is inactive' });
  const result = db
    .prepare(
      `INSERT INTO supplier_quotations (rfq_id, supplier_id, item_id, price, freight, tax, currency, delivery_time_days, payment_terms, quality_rating, warranty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.params.id, supplier_id, item_id, price, freight ?? 0, tax ?? 0, String((db.prepare("SELECT currency FROM company WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1").get() as any)?.currency || 'SAR').toUpperCase(), delivery_time_days ?? null, payment_terms ?? null, quality_rating ?? null, warranty ?? null);
  res.status(201).json({ id: result.lastInsertRowid });
});

// Quotation comparison report - grouped by item, ranked by price
router.get('/rfqs/:id/comparison', requireAuth, requireRole('SupplyChainManager','PurchaseManager','PurchaseOfficer'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT sq.*, s.name AS supplier_name, s.rating AS supplier_score, i.item_code, i.description,
        (sq.price + sq.freight + (sq.price * sq.tax / 100.0)) AS total_landed_cost
       FROM supplier_quotations sq
       JOIN suppliers s ON s.id = sq.supplier_id
       JOIN items i ON i.id = sq.item_id
       WHERE sq.rfq_id = ?
       ORDER BY sq.item_id, sq.price ASC`
    )
    .all(req.params.id);
  res.json(rows);
});

router.put('/quotations/:id/select', requireAuth, requireRole('PurchaseOfficer', 'PurchaseManager'), (req: AuthedRequest, res) => {
  const quotation = db.prepare('SELECT * FROM supplier_quotations WHERE id = ?').get(req.params.id) as any;
  if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
  db.transaction(() => {
    // Exactly one winning quotation is allowed per RFQ item.
    db.prepare('UPDATE supplier_quotations SET selected = 0 WHERE rfq_id = ? AND item_id = ?').run(quotation.rfq_id, quotation.item_id);
    db.prepare('UPDATE supplier_quotations SET selected = 1 WHERE id = ?').run(req.params.id);
  })();
  logAudit('supplier_quotations', Number(req.params.id), 'UPDATE', req.user?.id, undefined, { selected: true });
  res.json({ success: true });
});

// ---------------------------------------------------------------------
// Purchase Orders + Approval Workflow (Section 6)
//   <= $10,000            -> Purchase Officer can create & print directly
//   $10,001 - $50,000      -> Purchase Manager review & approve
//   > $50,000               -> System generates an approval document;
//                             management approval is manual (entered as a reference)
// ---------------------------------------------------------------------
router.get('/pos', requireAuth, requireRole('SupplyChainManager','PurchaseManager','PurchaseOfficer','WarehouseManager','WarehouseSupervisor','Storekeeper'), (req: AuthedRequest, res) => {
  const warehouseViewer=['WarehouseManager','WarehouseSupervisor','Storekeeper'].includes(req.user!.role);
  const rows = (db
    .prepare(
      `SELECT po.*, s.name AS supplier_name,
        CASE WHEN po.committed_delivery_date IS NULL THEN 'Not Set' WHEN po.status='Closed' THEN 'Delivered' WHEN date(po.committed_delivery_date)<date('now') THEN 'Overdue' ELSE 'On Schedule' END AS delivery_status,
        CASE WHEN po.status<>'Closed' AND po.committed_delivery_date IS NOT NULL AND date(po.committed_delivery_date)<date('now') THEN CAST(julianday('now')-julianday(po.committed_delivery_date) AS INTEGER) ELSE 0 END AS days_overdue,
        (SELECT COUNT(*) FROM grns g WHERE g.po_id=po.id) AS grn_count,
        CASE WHEN NOT EXISTS (
          SELECT 1 FROM po_items poi WHERE poi.po_id=po.id
            AND COALESCE((SELECT SUM(gi.accepted_qty) FROM grn_items gi JOIN grns g ON g.id=gi.grn_id WHERE g.po_id=po.id AND gi.item_id=poi.item_id),0) < poi.quantity
        ) THEN 1 ELSE 0 END AS fully_received,
        COALESCE((SELECT GROUP_CONCAT(pr2.pr_number, ', ') FROM po_pr_links ppl JOIN purchase_requisitions pr2 ON pr2.id=ppl.pr_id WHERE ppl.po_id=po.id), pr.pr_number) AS pr_number
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id LEFT JOIN purchase_requisitions pr ON pr.id=po.pr_id ${warehouseViewer ? "WHERE po.status IN ('Approved','Printed')" : ''} ORDER BY po.id DESC`
    )
    .all() as any[]).map((po) => { const external=po.external_approval_required || Number(po.total_amount)>maxApprovalFor('SupplyChainManager'); if(external&&!po.management_approval_request_number){po.management_approval_request_number=nextDocNumber('MAR');db.prepare('UPDATE purchase_orders SET external_approval_required=1,management_approval_request_number=? WHERE id=?').run(po.management_approval_request_number,po.id);} return {...po,external_approval_required:external?1:0}; });
  res.json(rows);
});

// Historical pricing assistance for PO entry. Only fully received/closed PO
// history is considered, preventing quotations or unreceived orders from
// distorting actual purchase-price guidance.
router.post('/pos/pricing', requireAuth, requireRole('PurchaseOfficer', 'PurchaseManager', 'SupplyChainManager'), (req, res) => {
  const supplierId = Number(req.body?.supplier_id);
  const itemIds = Array.from(new Set((Array.isArray(req.body?.item_ids) ? req.body.item_ids : []).map(Number)));
  if (!Number.isInteger(supplierId) || itemIds.some((id) => !Number.isInteger(id))) return res.status(400).json({ error: 'Valid supplier and item references are required' });
  const statement = db.prepare(`SELECT i.id item_id,
    (SELECT poi.price FROM po_items poi JOIN purchase_orders po ON po.id=poi.po_id WHERE poi.item_id=i.id AND po.supplier_id=? AND po.status='Closed' AND EXISTS (SELECT 1 FROM grns g WHERE g.po_id=po.id) ORDER BY po.id DESC LIMIT 1) latest_supplier_price,
    (SELECT poi.tax FROM po_items poi JOIN purchase_orders po ON po.id=poi.po_id WHERE poi.item_id=i.id AND po.supplier_id=? AND po.status='Closed' AND EXISTS (SELECT 1 FROM grns g WHERE g.po_id=po.id) ORDER BY po.id DESC LIMIT 1) latest_supplier_tax,
    (SELECT po.po_number FROM po_items poi JOIN purchase_orders po ON po.id=poi.po_id WHERE poi.item_id=i.id AND po.supplier_id=? AND po.status='Closed' AND EXISTS (SELECT 1 FROM grns g WHERE g.po_id=po.id) ORDER BY po.id DESC LIMIT 1) latest_supplier_po_number,
    (SELECT MIN(poi.price) FROM po_items poi JOIN purchase_orders po ON po.id=poi.po_id WHERE poi.item_id=i.id AND po.supplier_id=? AND po.status='Closed' AND EXISTS (SELECT 1 FROM grns g WHERE g.po_id=po.id)) supplier_lowest_price,
    (SELECT AVG(poi.price) FROM po_items poi JOIN purchase_orders po ON po.id=poi.po_id WHERE poi.item_id=i.id AND po.status='Closed' AND EXISTS (SELECT 1 FROM grns g WHERE g.po_id=po.id)) all_supplier_average_price,
    (SELECT COUNT(*) FROM po_items poi JOIN purchase_orders po ON po.id=poi.po_id WHERE poi.item_id=i.id AND po.status='Closed' AND EXISTS (SELECT 1 FROM grns g WHERE g.po_id=po.id)) received_history_count
    FROM items i WHERE i.id=? AND i.deleted_at IS NULL`);
  res.json(itemIds.map((itemId) => statement.get(supplierId, supplierId, supplierId, supplierId, itemId)));
});

router.get('/pos/:id', requireAuth, requireRole('SupplyChainManager','PurchaseManager','PurchaseOfficer','WarehouseManager','WarehouseSupervisor','Storekeeper'), (req: AuthedRequest, res) => {
  const po = db.prepare(`SELECT po.*, s.name supplier_name, s.address supplier_address FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?`).get(req.params.id);
  if (!po) return res.status(404).json({ error: 'Not found' });
  if(['WarehouseManager','WarehouseSupervisor','Storekeeper'].includes(req.user!.role)&&!['Approved','Printed'].includes((po as any).status))return res.status(403).json({error:'Warehouse roles may view only approved POs that are open for receiving'});
  const items = db
    .prepare(
      `SELECT poi.*, i.item_code, i.description, i.uom, i.purchase_uom,
              COALESCE((SELECT SUM(gi.accepted_qty) FROM grn_items gi JOIN grns g ON g.id=gi.grn_id WHERE g.po_id=poi.po_id AND gi.item_id=poi.item_id), 0) AS received_qty,
              poi.quantity - COALESCE((SELECT SUM(gi.accepted_qty) FROM grn_items gi JOIN grns g ON g.id=gi.grn_id WHERE g.po_id=poi.po_id AND gi.item_id=poi.item_id), 0) AS outstanding_qty,
              COALESCE((SELECT SUM(pri.quantity-COALESCE((SELECT SUM(a.quantity) FROM po_pr_item_allocations a JOIN purchase_orders other_po ON other_po.id=a.po_id WHERE a.pr_item_id=pri.id AND other_po.status<>'Rejected' AND a.po_id<>poi.po_id),0)) FROM po_pr_links ppl JOIN pr_items pri ON pri.pr_id=ppl.pr_id WHERE ppl.po_id=poi.po_id AND pri.item_id=poi.item_id),poi.quantity) AS pr_available_quantity
       FROM po_items poi
       JOIN items i ON i.id = poi.item_id WHERE poi.po_id = ?`
    )
    .all(req.params.id);
  res.json({ ...po, items });
});

router.put('/pos/:id/amend',requireAuth,requireRole('SupplyChainManager'),(req:AuthedRequest,res)=>{const po=db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(req.params.id)as any;if(!po)return res.status(404).json({error:'PO not found'});if(!['Approved','Printed'].includes(po.status))return res.status(409).json({error:'Only an approved, unreceived PO can enter controlled amendment'});if(db.prepare('SELECT 1 FROM grns WHERE po_id=? LIMIT 1').get(po.id))return res.status(409).json({error:'A PO with posted receipts cannot be amended'});const {supplier_id,committed_delivery_date,items,revision_reason}=req.body||{};if(!String(revision_reason||'').trim()||!Number.isInteger(Number(supplier_id))||!Array.isArray(items)||!items.length||items.some((x:any)=>!Number.isInteger(Number(x.item_id))||!(Number(x.quantity)>0)||Number(x.price)<0||Number(x.tax||0)<0))return res.status(400).json({error:'Revision reason, supplier, delivery date, and valid lines are required'});if(!db.prepare('SELECT 1 FROM suppliers WHERE id=? AND deleted_at IS NULL').get(supplier_id)||items.some((x:any)=>!db.prepare('SELECT 1 FROM items WHERE id=? AND deleted_at IS NULL').get(x.item_id)))return res.status(400).json({error:'Supplier or item is inactive'});const total=items.reduce((s:number,x:any)=>s+Number(x.quantity)*Number(x.price)*(1+Number(x.tax||0)/100),0);db.transaction(()=>{const previousItems=db.prepare('SELECT item_id,quantity,price,tax FROM po_items WHERE po_id=? ORDER BY id').all(po.id);captureApprovedRevision('PO',Number(po.id),req.user!.id,revision_reason,{...po,items:previousItems},{supplier_id,committed_delivery_date,total_amount:total,items},true);db.prepare("UPDATE purchase_orders SET supplier_id=?,committed_delivery_date=?,total_amount=?,status='PendingApproval' WHERE id=?").run(supplier_id,committed_delivery_date,total,po.id);db.prepare('DELETE FROM po_items WHERE po_id=?').run(po.id);const insert=db.prepare('INSERT INTO po_items(po_id,item_id,quantity,price,tax) VALUES(?,?,?,?,?)');items.forEach((x:any)=>insert.run(po.id,x.item_id,x.quantity,x.price,x.tax||0));requestApproval({document_type:'PO',document_id:Number(po.id),document_number:po.po_number,required_role:'SupplyChainManager',requested_by:req.user!.id});logAudit('purchase_orders',Number(po.id),'UPDATE',req.user!.id,po,{action:'CONTROLLED_AMENDMENT',revision_reason,total_amount:total});}).immediate();res.json({success:true,status:'PendingApproval',total_amount:total});});

router.put('/pos/:id', requireAuth, requireRole('SupplyChainManager'), (req: AuthedRequest,res) => {
  const po=db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(req.params.id) as any;
  if(!po)return res.status(404).json({error:'PO not found'});
  if(po.status!=='PendingApproval')return res.status(409).json({error:`PO is ${po.status} and cannot be edited`});
  const {supplier_id,items,committed_delivery_date}=req.body||{};
  if(!Number.isInteger(Number(supplier_id))||!Array.isArray(items)||!items.length||items.some((line:any)=>!Number.isInteger(Number(line.item_id))||!(Number(line.quantity)>0)||Number(line.price)<0||Number(line.tax||0)<0))return res.status(400).json({error:'Valid supplier and PO lines are required'});
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(committed_delivery_date||''))||String(committed_delivery_date)<String(po.po_date))return res.status(400).json({error:'Committed delivery date is required and cannot be earlier than the PO date'});
  const countUnits = new Set(['EA','PCS','PC','BOX','BAG','SET','PR','PAIR','PACK','ROLL','BOTTLE','CAN','DRUM','PALLET']);
  for (const line of items) { const item=db.prepare('SELECT uom,purchase_uom FROM items WHERE id=? AND deleted_at IS NULL').get(line.item_id) as any; if(!item)return res.status(400).json({error:'PO item does not exist or is inactive'}); const unit=String(item.purchase_uom||item.uom||'').toUpperCase(); if(countUnits.has(unit)&&!Number.isInteger(Number(line.quantity)))return res.status(400).json({error:`Quantity for count-based unit ${unit} must be a whole number`}); }
  const total=items.reduce((sum:number,line:any)=>sum+Number(line.quantity)*Number(line.price)*(1+Number(line.tax||0)/100),0);
  const linkedPrIds=(db.prepare('SELECT pr_id FROM po_pr_links WHERE po_id=? ORDER BY id').all(po.id) as any[]).map(row=>Number(row.pr_id));const editAllocationPlan:Array<{pr_id:number;pr_item_id:number;item_id:number;quantity:number}>=[];
  if(linkedPrIds.length){const demand=new Map<number,number>(items.map((item:any)=>[Number(item.item_id),Number(item.quantity)]));for(const prId of linkedPrIds){const prLines=db.prepare('SELECT id,item_id,quantity FROM pr_items WHERE pr_id=? ORDER BY id').all(prId) as any[];for(const prLine of prLines){const needed=Number(demand.get(Number(prLine.item_id))||0);if(needed<=EPSILON)continue;const available=Math.max(0,Number(prLine.quantity)-allocatedPrItemQuantity(Number(prLine.id),Number(po.id)));const take=Math.min(needed,available);if(take>EPSILON){editAllocationPlan.push({pr_id:prId,pr_item_id:Number(prLine.id),item_id:Number(prLine.item_id),quantity:take});demand.set(Number(prLine.item_id),needed-take);}}}const excess=Array.from(demand.entries()).find(([,quantity])=>quantity>EPSILON);if(excess){const line=items.find((item:any)=>Number(item.item_id)===excess[0]);const master=db.prepare('SELECT item_code,description,purchase_uom,uom FROM items WHERE id=?').get(excess[0]) as any;const available=Number(line.quantity)-excess[1];return res.status(400).json({error:`${master?.item_code||`Item ${excess[0]}`} - ${master?.description||'Item'}: PO quantity ${Number(line.quantity).toLocaleString()} exceeds the approved outstanding PR balance of ${available.toLocaleString()} ${master?.purchase_uom||master?.uom||''}. Reduce the PO quantity or amend and reapprove the PR.`});}}
  db.transaction(()=>{db.prepare('UPDATE purchase_orders SET supplier_id=?,committed_delivery_date=?,total_amount=? WHERE id=?').run(supplier_id,committed_delivery_date,total,po.id);db.prepare('DELETE FROM po_items WHERE po_id=?').run(po.id);const insert=db.prepare('INSERT INTO po_items (po_id,item_id,quantity,price,tax) VALUES (?,?,?,?,?)');items.forEach((line:any)=>insert.run(po.id,line.item_id,line.quantity,line.price,line.tax||0));if(linkedPrIds.length){db.prepare('DELETE FROM po_pr_item_allocations WHERE po_id=?').run(po.id);const allocation=db.prepare('INSERT INTO po_pr_item_allocations (po_id,pr_id,pr_item_id,item_id,quantity) VALUES (?,?,?,?,?)');editAllocationPlan.forEach(entry=>allocation.run(po.id,entry.pr_id,entry.pr_item_id,entry.item_id,entry.quantity));linkedPrIds.forEach(syncPrBalanceStatus);}logAudit('purchase_orders',po.id,'UPDATE',req.user?.id,po,{supplier_id,committed_delivery_date,total,items,pr_allocations:editAllocationPlan});})();
  res.json({success:true,total_amount:total});
});

router.post('/pos', requireAuth, requireRole('PurchaseOfficer', 'PurchaseManager', 'SupplyChainManager'), (req: AuthedRequest, res) => {
  const { supplier_id, pr_id, pr_ids, rfq_id, items, committed_delivery_date,transaction_currency,exchange_rate } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'At least one item required' });
  if (!Number.isInteger(Number(supplier_id))) return res.status(400).json({ error: 'A valid supplier is required' });
  const today=new Date().toISOString().slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(committed_delivery_date||''))||String(committed_delivery_date)<today)return res.status(400).json({error:'Committed delivery date is required and cannot be earlier than today'});
  if (items.some((it: any) => !Number.isInteger(Number(it.item_id)) || !Number.isFinite(Number(it.quantity)) || Number(it.quantity) <= 0 || !Number.isFinite(Number(it.price)) || Number(it.price) < 0 || !Number.isFinite(Number(it.tax ?? 0)) || Number(it.tax ?? 0) < 0)) {
    return res.status(400).json({ error: 'Every PO line requires a valid item, positive quantity, and non-negative price and tax' });
  }
  const countUnits = new Set(['EA','PCS','PC','BOX','BAG','SET','PR','PAIR','PACK','ROLL','BOTTLE','CAN','DRUM','PALLET']);
  for (const line of items) { const item=db.prepare('SELECT uom,purchase_uom FROM items WHERE id=? AND deleted_at IS NULL').get(line.item_id) as any; if(!item)return res.status(400).json({error:'PO item does not exist or is inactive'}); const unit=String(item.purchase_uom||item.uom||'').toUpperCase(); if(countUnits.has(unit)&&!Number.isInteger(Number(line.quantity)))return res.status(400).json({error:`Quantity for count-based unit ${unit} must be a whole number`}); }
  if (!db.prepare('SELECT id FROM suppliers WHERE id = ? AND deleted_at IS NULL').get(supplier_id) || items.some((it: any) => !db.prepare('SELECT id FROM items WHERE id = ? AND deleted_at IS NULL').get(it.item_id))) return res.status(400).json({ error: 'Supplier or item does not exist or is inactive' });
  const linkedPrIds = Array.from(new Set((Array.isArray(pr_ids) ? pr_ids : pr_id != null ? [pr_id] : []).map(Number)));
  if (linkedPrIds.some((id)=>!Number.isInteger(id))) return res.status(400).json({error:'PR selection contains an invalid reference'});
  const allocationPlan:Array<{pr_id:number;pr_item_id:number;item_id:number;quantity:number}>=[];
  if (linkedPrIds.length) {
    if (new Set(items.map((item: any) => Number(item.item_id))).size !== items.length) return res.status(400).json({error:'Duplicate PO item lines are not allowed; combine each item into one line'});
    const demand=new Map<number,number>(items.map((item:any)=>[Number(item.item_id),Number(item.quantity)]));
    for(const id of linkedPrIds){
      if(!db.prepare("SELECT pr.id FROM purchase_requisitions pr WHERE pr.id=? AND pr.status='Submitted' AND EXISTS (SELECT 1 FROM approval_log al WHERE al.document_type='PR' AND al.document_id=pr.id AND al.decision='Approved')").get(id))return res.status(409).json({error:`PR ${id} is not approved or has no open balance`});
      const prLines=db.prepare('SELECT id,item_id,quantity FROM pr_items WHERE pr_id=? ORDER BY id').all(id) as any[];
      for(const prLine of prLines){const needed=Number(demand.get(Number(prLine.item_id))||0);if(needed<=EPSILON)continue;const available=Math.max(0,Number(prLine.quantity)-allocatedPrItemQuantity(Number(prLine.id)));const take=Math.min(needed,available);if(take>EPSILON){allocationPlan.push({pr_id:id,pr_item_id:Number(prLine.id),item_id:Number(prLine.item_id),quantity:take});demand.set(Number(prLine.item_id),needed-take);}}
    }
    const excess=Array.from(demand.entries()).find(([,quantity])=>quantity>EPSILON);
    if(excess){const line=items.find((item:any)=>Number(item.item_id)===excess[0]);const master=db.prepare('SELECT item_code,description,purchase_uom,uom FROM items WHERE id=?').get(excess[0]) as any;const available=Number(line.quantity)-excess[1];return res.status(400).json({error:`${master?.item_code||`Item ${excess[0]}`} - ${master?.description||'Item'}: PO quantity ${Number(line.quantity).toLocaleString()} exceeds the approved outstanding PR balance of ${available.toLocaleString()} ${master?.purchase_uom||master?.uom||''}. Reduce the PO quantity or amend and reapprove the PR.`});}
  }

  const total = items.reduce((sum: number, it: any) => sum + it.quantity * it.price * (1 + (it.tax ?? 0) / 100), 0);
  let money;try{const supplier=db.prepare('SELECT preferred_currency FROM suppliers WHERE id=?').get(supplier_id) as any;money=currencyContext(transaction_currency||supplier?.preferred_currency,exchange_rate,today);}catch(error:any){return res.status(400).json({error:error.message});}
  const baseTotal=Math.round(total*money.rate*100)/100;
  // Determine initial status by approval-limit logic (spec section 13.1)
  const requesterLimit = maxApprovalFor(req.user!);
  const supplyChainManagerLimit = maxApprovalFor('SupplyChainManager');
  const externalApprovalRequired = baseTotal > supplyChainManagerLimit ? 1 : 0;
  // A creator never auto-approves their own PO. Assigned limits determine the
  // independent approval route, not whether approval can be skipped.
  const status = 'PendingApproval';

  const created = db.transaction(() => {
  const poNumber = nextDocNumber('PO');
    const managementRequestNumber = externalApprovalRequired ? nextDocNumber('MAR') : null;
    const result = db.prepare(`INSERT INTO purchase_orders (po_number, supplier_id, pr_id, rfq_id, committed_delivery_date, total_amount,transaction_currency,exchange_rate,base_currency,base_currency_amount, status, external_approval_required, management_approval_request_number, created_by) VALUES (?, ?, NULL, ?, ?, ?,?,?,?,?, ?, ?, ?, ?)`).run(poNumber, supplier_id, rfq_id ?? null, committed_delivery_date, total,money.transaction,money.rate,money.base,baseTotal, status, externalApprovalRequired, managementRequestNumber, req.user!.id);
    const poId = Number(result.lastInsertRowid);
    const itemStmt = db.prepare('INSERT INTO po_items (po_id, item_id, quantity, price, tax) VALUES (?, ?, ?, ?, ?)');
    for (const it of items) itemStmt.run(poId, it.item_id, it.quantity, it.price, it.tax ?? 0);
    if(allocationPlan.length){const link=db.prepare('INSERT INTO po_pr_links (po_id,pr_id) VALUES (?,?)');const allocation=db.prepare('INSERT INTO po_pr_item_allocations (po_id,pr_id,pr_item_id,item_id,quantity) VALUES (?,?,?,?,?)');const usedPrIds=Array.from(new Set(allocationPlan.map(entry=>entry.pr_id)));usedPrIds.forEach(id=>link.run(poId,id));allocationPlan.forEach(entry=>allocation.run(poId,entry.pr_id,entry.pr_item_id,entry.item_id,entry.quantity));usedPrIds.forEach(syncPrBalanceStatus);}
    if (status === 'PendingApproval') {
      const valueRole = baseTotal <= maxApprovalFor('PurchaseOfficer') ? 'PurchaseOfficer' : baseTotal <= maxApprovalFor('PurchaseManager') ? 'PurchaseManager' : 'SupplyChainManager';
      const roleRank:Record<string,number>={PurchaseOfficer:1,PurchaseManager:2,SupplyChainManager:3};
      const creatorMinimum=req.user!.role==='PurchaseOfficer'?'PurchaseManager':'SupplyChainManager';
      const requiredRole=roleRank[valueRole]>=roleRank[creatorMinimum]?valueRole:creatorMinimum;
      requestApproval({ document_type: 'PO', document_id: poId, document_number: poNumber, required_role: requiredRole, requested_by: req.user!.id });
    }
    logAudit('purchase_orders', poId, 'CREATE', req.user?.id, undefined, { poNumber, committed_delivery_date, total, status });
    return { poId, poNumber };
  })();
  const { poId, poNumber } = created;
  res.status(201).json({ id: poId, po_number: poNumber, total_amount: total,transaction_currency:money.transaction,exchange_rate:money.rate,base_currency:money.base,base_currency_amount:baseTotal,status });
});

// Approve a PO that is pending (Purchase Manager for $10,001-$50,000, SCM above that).
// Above $50,000 also requires a manual higher-management approval reference (spec 13.1/13.2).
router.put('/pos/:id/approve', requireAuth, requireRole('PurchaseOfficer','PurchaseManager', 'SupplyChainManager'), (req: AuthedRequest, res) => {
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id) as any;
  if (!po) return res.status(404).json({ error: 'Not found' });
  if (po.status !== 'PendingApproval') return res.status(409).json({ error: `PO is ${po.status} and can no longer be amended or approved` });
  const baseValue=Number(po.base_currency_amount??po.total_amount),requiredRole=baseValue<=maxApprovalFor('PurchaseOfficer')?'PurchaseOfficer':baseValue<=maxApprovalFor('PurchaseManager')?'PurchaseManager':'SupplyChainManager';
  try{assertApprovalAuthority('PO',Number(po.id),req.user!.id,req.user!.role,requiredRole);}catch(e:any){return res.status(e.status||403).json({error:e.message});}

  const authority=activePoApprovalLimit(req.user!.id),limit=authority?.limit??-1;
  if (!authority||baseValue > limit) {
    const currency = String((db.prepare("SELECT currency FROM company WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1").get() as any)?.currency || 'SAR').toUpperCase();
    logAudit('purchase_orders',Number(po.id),'UPDATE',req.user!.id,po,{action:'UNAUTHORIZED_APPROVAL_ATTEMPT',base_value:baseValue,authoritative_limit:limit,client_limit_ignored:req.body?.approval_limit});
    return res.status(403).json({ error: `Amount exceeds your active approval limit (${currency} ${Math.max(0,limit).toLocaleString()})` });
  }

  const externalApprovalRequired = !!po.external_approval_required || Number(po.total_amount) > maxApprovalFor('SupplyChainManager');
  try {
    assertNotSelfApproval(po.created_by, req.user!.id, req.user!.role === 'SupplyChainManager' && !externalApprovalRequired);
  } catch (e) {
    if (e instanceof SelfApprovalError) return res.status(403).json({ error: e.message });
    throw e;
  }

  const { approval_ref_number, approval_person_name } = req.body || {};
  if (externalApprovalRequired && req.user!.role !== 'SupplyChainManager') {
    return res.status(403).json({ error: 'Only the Supply Chain Manager may record a completed external-management approval' });
  }
  if (externalApprovalRequired && (!String(approval_ref_number || '').trim() || !String(approval_person_name || '').trim())) {
    return res.status(400).json({ error: 'External approval reference and approving management person are required' });
  }
  if (externalApprovalRequired && !db.prepare("SELECT id FROM document_attachments WHERE document_type = 'MANUAL_APPROVAL' AND document_id = ? LIMIT 1").get(po.id)) {
    return res.status(400).json({ error: 'Upload the signed external-management approval document before approving this PO' });
  }

  try{db.transaction(()=>{const atomicAuthority=activePoApprovalLimit(req.user!.id);if(!atomicAuthority||baseValue>atomicAuthority.limit)throw Object.assign(new Error(`Amount exceeds the approval limit effective at the atomic decision point`),{status:403});const limitVersion=db.prepare("SELECT id,effective_from,approval_date FROM approval_limit_history WHERE employee_id=? AND approval_type='PO' AND status='ACTIVE' ORDER BY datetime(approval_date) DESC,id DESC LIMIT 1").get(atomicAuthority.employee_id) as any;const effectiveAt=String(limitVersion?.approval_date||limitVersion?.effective_from||new Date().toISOString());const transition=db.prepare(
    `UPDATE purchase_orders SET status = 'Approved', approval_ref_number = ?, approval_person_name = ? WHERE id = ? AND status='PendingApproval'`
  ).run(approval_ref_number ?? null, approval_person_name ?? req.user!.full_name, req.params.id);if(!transition.changes)throw Object.assign(new Error('Another user already completed this PO approval decision'),{status:409});recordDecision({
    document_type: 'PO',
    document_id: Number(req.params.id),
    decision: 'Approved',
    decision_by: req.user!.id,
    manual_reference: approval_ref_number,
    approval_snapshot:{value:baseValue,currency:String(po.base_currency||po.transaction_currency||'SAR'),limit:atomicAuthority.limit,source:limitVersion?'APPROVAL_LIMIT_HISTORY':'EMPLOYEE_MASTER',version:limitVersion?.id||null,effective_at:effectiveAt,employee_id:atomicAuthority.employee_id,role:atomicAuthority.role,workflow_level:requiredRole,escalation_rule:`PO value routed to ${requiredRole}`}
  });logAudit('purchase_orders', Number(req.params.id), 'APPROVE', req.user?.id, po, { approval_ref_number, approval_person_name,po_value:po.total_amount,base_value:baseValue,currency:po.transaction_currency,base_currency:po.base_currency,approval_limit_used:atomicAuthority.limit,approval_limit_source:limitVersion?'APPROVAL_LIMIT_HISTORY':'EMPLOYEE_MASTER',approval_limit_version:limitVersion?.id||null,approval_limit_effective_at:effectiveAt,approval_level:atomicAuthority.role,previous_status:po.status,final_status:'Approved' });}).immediate();}catch(e:any){return res.status(e.status||409).json({error:e.message});}
  res.json({ success: true });
});

router.put('/pos/:id/reject', requireAuth, requireRole('PurchaseManager', 'SupplyChainManager'), (req: AuthedRequest, res) => {
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id) as any;
  if (!po) return res.status(404).json({ error: 'Not found' });
  po.external_approval_required = po.external_approval_required || Number(po.total_amount) > maxApprovalFor('SupplyChainManager') ? 1 : 0;
  if (po.external_approval_required && req.user!.role !== 'SupplyChainManager') return res.status(403).json({ error: 'Only the Supply Chain Manager may reject a PO routed to higher management' });
  if (po.external_approval_required && !po.management_approval_request_number) { po.management_approval_request_number=nextDocNumber('MAR'); db.prepare('UPDATE purchase_orders SET external_approval_required=1,management_approval_request_number=? WHERE id=?').run(po.management_approval_request_number,po.id); }
  if (po.status !== 'PendingApproval') return res.status(409).json({ error: `PO is ${po.status} and can no longer be amended or rejected` });
  try{assertApprovalAuthority('PO',Number(po.id),req.user!.id,req.user!.role,Number(po.total_amount)>maxApprovalFor('PurchaseManager')?'SupplyChainManager':'PurchaseManager');}catch(e:any){return res.status(e.status||403).json({error:e.message});}

  try {
    assertNotSelfApproval(po.created_by, req.user!.id);
  } catch (e) {
    if (e instanceof SelfApprovalError) return res.status(403).json({ error: e.message });
    throw e;
  }

  try{db.transaction(()=>{const transition=db.prepare(`UPDATE purchase_orders SET status = 'Rejected' WHERE id = ? AND status='PendingApproval'`).run(req.params.id);if(!transition.changes)throw Object.assign(new Error('Another user already completed this PO approval decision'),{status:409});(db.prepare('SELECT pr_id FROM po_pr_links WHERE po_id=?').all(po.id) as any[]).forEach(row=>syncPrBalanceStatus(Number(row.pr_id)));recordDecision({ document_type: 'PO', document_id: Number(req.params.id), decision: 'Rejected', decision_by: req.user!.id });logAudit('purchase_orders', Number(req.params.id), 'REJECT', req.user?.id);}).immediate();}catch(e:any){return res.status(e.status||409).json({error:e.message});}
  res.json({ success: true });
});

router.get('/pos/:id/approval-history', requireAuth, (req, res) => {
  res.json(getApprovalHistory('PO', Number(req.params.id)));
});

// Read-only document view. Opening a PO never changes its status.
router.get('/pos/:id/document', requireAuth, (req: AuthedRequest, res) => {
  const po = db
    .prepare(
      `SELECT po.*, s.name AS supplier_name, s.address AS supplier_address,
              s.contact_person AS supplier_contact_person, s.phone AS supplier_phone,
              s.email AS supplier_email, s.payment_terms AS supplier_payment_terms,
              u.full_name AS created_by_name, e.signature_url AS created_by_signature_url
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN users u ON u.id = po.created_by LEFT JOIN employees e ON e.id=u.employee_id
       WHERE po.id = ?`
    )
    .get(req.params.id) as any;
  if (!po) return res.status(404).json({ error: 'Not found' });
  if(['WarehouseManager','WarehouseSupervisor','Storekeeper'].includes(req.user!.role)&&!['Approved','Printed'].includes(po.status))return res.status(403).json({error:'Warehouse roles may view only approved POs that are open for receiving'});
  po.external_approval_required = po.external_approval_required || Number(po.total_amount) > maxApprovalFor('SupplyChainManager') ? 1 : 0;
  if (!['PendingApproval', 'Approved', 'Printed', 'Rejected', 'Closed'].includes(po.status)) return res.status(400).json({ error: 'PO is not available to view' });

  const items = db
    .prepare(
      `SELECT poi.*, i.item_code, i.description, i.uom, i.purchase_uom FROM po_items poi
       JOIN items i ON i.id = poi.item_id WHERE poi.po_id = ?`
    )
    .all(req.params.id);

  const company = db.prepare('SELECT * FROM company WHERE deleted_at IS NULL ORDER BY id LIMIT 1').get() || {};
  const approvals = getApprovalHistory('PO', Number(req.params.id));
  res.json({ po, items, company, approvals });
});

// Printing locks the commercial document, while receiving remains open until
// cumulative accepted GRN quantities fulfill every PO line.
router.post('/pos/:id/print', requireAuth, requireRole('PurchaseOfficer', 'PurchaseManager', 'SupplyChainManager'), (req: AuthedRequest, res) => {
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id) as any;
  if (!po) return res.status(404).json({ error: 'Not found' });
  if (po.status === 'Printed' || po.status === 'Closed') return res.json({ success: true, status: po.status });
  if (po.status !== 'Approved') return res.status(409).json({ error: 'Only an approved PO can be printed' });
  db.prepare("UPDATE purchase_orders SET status = 'Printed' WHERE id = ?").run(req.params.id);
  logAudit('purchase_orders', Number(req.params.id), 'UPDATE', req.user?.id, po, { status: 'Printed', locked_by_action: 'PRINT' });
  res.json({ success: true, status: 'Printed' });
});

// ---------------------------------------------------------------------
// Invoice Register + PO-GRN-Invoice Three-Way Match (spec sections 8.4, 15.6)
// ---------------------------------------------------------------------
function invoiceVarianceAnalysis(poId:number,invoiceTotal:number,adjustment=0){
  const po=db.prepare('SELECT total_amount FROM purchase_orders WHERE id=?').get(poId) as any;
  const receipt=db.prepare(`SELECT COALESCE(SUM(gi.accepted_qty*gi.unit_cost*(1+COALESCE(pi.tax,0)/100.0)),0) value
    FROM grn_items gi JOIN grns g ON g.id=gi.grn_id JOIN po_items pi ON pi.po_id=g.po_id AND pi.item_id=gi.item_id WHERE g.po_id=?`).get(poId) as any;
  const lines=db.prepare(`SELECT i.item_code,i.description,pi.quantity ordered_qty,COALESCE(SUM(gi.accepted_qty),0) accepted_qty,COALESCE(SUM(gi.rejected_qty),0) rejected_qty
    FROM po_items pi JOIN items i ON i.id=pi.item_id LEFT JOIN grns g ON g.po_id=pi.po_id LEFT JOIN grn_items gi ON gi.grn_id=g.id AND gi.item_id=pi.item_id
    WHERE pi.po_id=? GROUP BY pi.id ORDER BY pi.id`).all(poId) as any[];
  const poTotal=Number(po?.total_amount??0),grnValue=Math.round(Number(receipt?.value||0)*100)/100,adjusted=Math.round((invoiceTotal+adjustment)*100)/100;
  const reasons:string[]=[];
  const short=lines.filter(x=>Number(x.accepted_qty)<Number(x.ordered_qty)-0.000001);if(short.length)reasons.push(`Quantity shortfall: ${short.map(x=>`${x.item_code} accepted ${Number(x.accepted_qty).toLocaleString()} of ${Number(x.ordered_qty).toLocaleString()}`).join('; ')}`);
  const rejected=lines.filter(x=>Number(x.rejected_qty)>0);if(rejected.length)reasons.push(`Rejected receipt quantity: ${rejected.map(x=>`${x.item_code} ${Number(x.rejected_qty).toLocaleString()}`).join('; ')}`);
  if(Math.abs(grnValue-poTotal)>0.01)reasons.push(`Cumulative accepted GRN value differs from PO value by ${(grnValue-poTotal).toFixed(2)}.`);
  if(Math.abs(invoiceTotal-poTotal)>0.01)reasons.push(`Supplier invoice value differs from PO value by ${(invoiceTotal-poTotal).toFixed(2)}.`);
  if(Math.abs(invoiceTotal-grnValue)>0.01)reasons.push(`Supplier invoice value differs from cumulative accepted GRN value by ${(invoiceTotal-grnValue).toFixed(2)}.`);
  if(!reasons.length)reasons.push('No quantity or value difference detected within rounding tolerance.');
  const sourceDocumentsMatch=Math.abs(poTotal-grnValue)<=0.01,originalVariance=Math.round((invoiceTotal-poTotal)*100)/100,recommendedAdjustment=Math.round((poTotal-invoiceTotal)*100)/100,remainingVariance=Math.round((adjusted-poTotal)*100)/100;
  const commercialTolerance=Math.max(1,Math.abs(poTotal)*0.01);let classification='Variance — Review Required';
  if(!sourceDocumentsMatch)classification='Blocked — Source Documents Differ';else if(Math.abs(originalVariance)<=0.01)classification='Exact Match';else if(adjustment!==0&&Math.abs(remainingVariance)<=0.01)classification='Reconciled';else if(adjustment===0&&Math.abs(originalVariance)<=commercialTolerance)classification='Within Tolerance';
  return {po_total:poTotal,grn_value:grnValue,original_invoice_total:invoiceTotal,original_variance:originalVariance,recommended_adjustment:recommendedAdjustment,adjustment:Math.round(adjustment*100)/100,adjusted_invoice_total:adjusted,remaining_variance:remainingVariance,reasons,source_documents_match:sourceDocumentsMatch,classification,match_status:['Exact Match','Within Tolerance','Reconciled'].includes(classification)?'Matched':'Variance'};
}

const RECONCILIATION_REASONS=new Set(['SUPPLIER_CREDIT_NOTE','APPROVED_DISCOUNT','TAX_CORRECTION','FREIGHT_ADJUSTMENT','ROUNDING_DIFFERENCE','PRICE_CORRECTION','QUANTITY_DISCREPANCY','REJECTED_GOODS','CORRECTED_INVOICE','OTHER']);

router.get('/pos/:id/invoice-context', requireAuth, requireRole('SupplyChainManager','PurchaseManager','PurchaseOfficer'), (req, res) => {
  const po = db.prepare(`SELECT po.*, s.name supplier_name, s.supplier_code, s.address supplier_address,
    s.contact_person, s.phone supplier_phone, s.email supplier_email, s.payment_terms
    FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id WHERE po.id=?`).get(req.params.id) as any;
  if (!po) return res.status(404).json({ error: 'Purchase Order not found' });
  if (po.status!=='Closed') return res.status(409).json({ error: 'Supplier invoices can be registered only against fully received, closed POs' });
  const receipts = db.prepare(`SELECT g.id,g.grn_number,g.grn_date,g.delivery_note,ROUND(COALESCE(SUM(gi.accepted_qty*gi.unit_cost*(1+COALESCE(pi.tax,0)/100.0)),0),2) accepted_value,
    COALESCE(SUM(gi.quantity_received),0) received_qty,COALESCE(SUM(gi.accepted_qty),0) accepted_qty,COALESCE(SUM(gi.rejected_qty),0) rejected_qty
    FROM grns g LEFT JOIN grn_items gi ON gi.grn_id=g.id LEFT JOIN po_items pi ON pi.po_id=g.po_id AND pi.item_id=gi.item_id WHERE g.po_id=? GROUP BY g.id ORDER BY g.grn_date,g.id`).all(po.id) as any[];
  if (!receipts.length) return res.status(409).json({ error: 'The closed PO has no posted GRN and cannot be used for invoice verification' });
  const items = db.prepare(`SELECT pi.id,i.item_code,i.description,i.uom,pi.quantity ordered_qty,pi.price unit_price,pi.tax,
    COALESCE(SUM(gi.accepted_qty),0) accepted_qty,COALESCE(SUM(gi.rejected_qty),0) rejected_qty
    FROM po_items pi JOIN items i ON i.id=pi.item_id
    LEFT JOIN grns g ON g.po_id=pi.po_id LEFT JOIN grn_items gi ON gi.grn_id=g.id AND gi.item_id=pi.item_id
    WHERE pi.po_id=? GROUP BY pi.id ORDER BY pi.id`).all(po.id);
  const grnValue=receipts.reduce((sum,row)=>sum+Number(row.accepted_value||0),0);
  res.json({po,supplier:{id:po.supplier_id,name:po.supplier_name,supplier_code:po.supplier_code,address:po.supplier_address,contact_person:po.contact_person,phone:po.supplier_phone,email:po.supplier_email,payment_terms:po.payment_terms},receipts,items,grn_value:Math.round(grnValue*100)/100});
});

router.get('/invoices', requireAuth, requireRole('SupplyChainManager','PurchaseManager','PurchaseOfficer'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT inv.*, s.name AS supplier_name, po.po_number, g.grn_number
       FROM invoices inv
       JOIN suppliers s ON s.id = inv.supplier_id
       JOIN purchase_orders po ON po.id = inv.po_id
       LEFT JOIN grns g ON g.id = inv.grn_id
       ORDER BY inv.id DESC`
    )
    .all();
  res.json(rows);
});

router.post('/invoices', requireAuth, requireRole('PurchaseOfficer', 'PurchaseManager', 'SupplyChainManager'), (req: AuthedRequest, res) => {
  const { invoice_number, supplier_id, po_id, grn_id, invoice_date, invoice_total, tax,transaction_currency,exchange_rate,variance_acceptance_note,adjustment_reason,reconciliation_reason_code } = req.body || {};
  const reconciliationAdjustment=Number(req.body?.reconciliation_adjustment||0);
  try{assertPostingPeriod(invoice_date,req.user!,req.body?.period_override_reason);}catch(e:any){return res.status(e.status||409).json({error:e.message});}
  if (!invoice_number || !supplier_id || !po_id || invoice_total == null) {
    return res.status(400).json({ error: 'invoice_number, supplier_id, po_id, and invoice_total are required' });
  }
  if (!Number.isFinite(Number(invoice_total)) || Number(invoice_total) < 0 || !Number.isFinite(Number(tax ?? 0)) || Number(tax ?? 0) < 0) return res.status(400).json({ error: 'Invoice total and tax must be non-negative' });
  if(!Number.isFinite(reconciliationAdjustment))return res.status(400).json({error:'Reconciliation adjustment must be a valid amount'});
  if(String(variance_acceptance_note||'').trim()&&req.user!.role!=='SupplyChainManager')return res.status(403).json({error:'Only the Supply Chain Manager can accept and document a variance'});
  if(reconciliationAdjustment!==0&&req.user!.role!=='SupplyChainManager')return res.status(403).json({error:'Only the Supply Chain Manager can enter a reconciliation adjustment'});
  if(reconciliationAdjustment!==0&&!String(variance_acceptance_note||'').trim())return res.status(400).json({error:'A reconciliation reason and acceptance note is required'});
  if (db.prepare('SELECT id FROM invoices WHERE invoice_number = ? AND supplier_id = ?').get(String(invoice_number).trim(), supplier_id)) return res.status(409).json({ error: 'Duplicate supplier invoice number' });

  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(po_id) as any;
  const relatedGrns=db.prepare('SELECT * FROM grns WHERE po_id=? ORDER BY grn_date,id').all(po_id) as any[];
  const selectedGrnId=grn_id??relatedGrns[0]?.id??null;
  const grn = selectedGrnId ? relatedGrns.find((row)=>Number(row.id)===Number(selectedGrnId)) : null;
  if (!po) return res.status(400).json({ error: 'Purchase Order does not exist' });
  if (po.status!=='Closed') return res.status(409).json({ error: 'Supplier invoices can be registered only against fully received, closed POs' });
  if (!relatedGrns.length) return res.status(409).json({ error: 'At least one posted GRN is required before registering the supplier invoice' });
  if (Number(po.supplier_id) !== Number(supplier_id)) return res.status(400).json({ error: 'Invoice supplier must match the Purchase Order supplier' });
  if (selectedGrnId && !grn) return res.status(400).json({ error: 'Selected GRN does not belong to the Purchase Order' });
  let money;try{money=currencyContext(transaction_currency||po.transaction_currency,exchange_rate,invoice_date);}catch(error:any){return res.status(400).json({error:error.message});}
  const baseInvoiceTotal=Math.round(Number(invoice_total)*money.rate*100)/100;

  const analysis=invoiceVarianceAnalysis(Number(po_id),Number(invoice_total),reconciliationAdjustment);
  const reasonCode=String(reconciliation_reason_code||'').trim();const manualOverride=reconciliationAdjustment!==0&&Math.abs(reconciliationAdjustment-analysis.recommended_adjustment)>0.01;
  if(!analysis.source_documents_match&&reconciliationAdjustment!==0)return res.status(409).json({error:'Reconciliation is blocked because PO and accepted GRN values differ. Resolve the source-document discrepancy first.'});
  if((reconciliationAdjustment!==0||String(variance_acceptance_note||'').trim())&&!RECONCILIATION_REASONS.has(reasonCode))return res.status(400).json({error:'Select a valid reconciliation reason category'});
  const currencyMatches=money.base===String(po.base_currency||money.base);
  const match_status=currencyMatches?analysis.match_status:'Variance';

  const financePackReference=nextDocNumber('FINPACK');
  const result = db
    .prepare(
      `INSERT INTO invoices (invoice_number,supplier_id,po_id,grn_id,invoice_date,invoice_total,tax,transaction_currency,exchange_rate,base_currency,base_currency_amount,match_status,created_by,finance_pack_reference,variance_reason,variance_acceptance_note,reconciliation_adjustment,adjustment_reason,adjusted_invoice_total,variance_accepted_by,variance_accepted_at,reconciliation_classification,reconciliation_reason_code,recommended_adjustment,adjustment_manual_override,source_documents_match)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(String(invoice_number).trim(),supplier_id,po_id,selectedGrnId,invoice_date??null,invoice_total,tax??0,money.transaction,money.rate,money.base,baseInvoiceTotal,match_status,req.user!.id,financePackReference,analysis.reasons.join('\n'),String(variance_acceptance_note||'').trim()||null,reconciliationAdjustment,String(adjustment_reason||variance_acceptance_note||'').trim()||null,analysis.adjusted_invoice_total,String(variance_acceptance_note||'').trim()?req.user!.id:null,String(variance_acceptance_note||'').trim()?new Date().toISOString():null,analysis.classification,reasonCode||null,analysis.recommended_adjustment,manualOverride?1:0,analysis.source_documents_match?1:0);

  logAudit('invoices', Number(result.lastInsertRowid), 'CREATE', req.user?.id, undefined, req.body);
  res.status(201).json({ id: result.lastInsertRowid, match_status, finance_pack_reference:financePackReference,analysis });
});

router.put('/invoices/:id/reconcile',requireAuth,requireRole('SupplyChainManager','PurchaseManager','PurchaseOfficer'),(req:AuthedRequest,res)=>{
  const invoice=db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id) as any;if(!invoice)return res.status(404).json({error:'Invoice not found'});
  if(invoice.finance_pack_status==='Ready for Finance - External Process')return res.status(409).json({error:'A package already handed off to the external Finance process cannot be changed'});
  let approvalAuthority:any;try{approvalAuthority=assertApprovalAuthority('FINANCEPACK',Number(invoice.id),req.user!.id,req.user!.role,'SupplyChainManager');}catch(e:any){return res.status(e.status||403).json({error:e.message});}
  const adjustment=Number(req.body?.reconciliation_adjustment||0),note=String(req.body?.variance_acceptance_note||'').trim(),reason=String(req.body?.adjustment_reason||'').trim(),reasonCode=String(req.body?.reconciliation_reason_code||'').trim();
  if(!Number.isFinite(adjustment))return res.status(400).json({error:'Reconciliation adjustment must be a valid amount'});if(!note)return res.status(400).json({error:'A reconciliation reason and acceptance note is required'});
  const analysis=invoiceVarianceAnalysis(Number(invoice.po_id),Number(invoice.invoice_total),adjustment);
  if(!analysis.source_documents_match)return res.status(409).json({error:'Reconciliation is blocked because PO and accepted GRN values differ. Resolve the source-document discrepancy first.'});if(!RECONCILIATION_REASONS.has(reasonCode))return res.status(400).json({error:'Select a valid reconciliation reason category'});
  const manualOverride=Math.abs(adjustment-analysis.recommended_adjustment)>0.01;
  db.prepare(`UPDATE invoices SET variance_reason=?,variance_acceptance_note=?,reconciliation_adjustment=?,adjustment_reason=?,adjusted_invoice_total=?,match_status=?,variance_accepted_by=?,variance_accepted_at=datetime('now'),reconciliation_classification=?,reconciliation_reason_code=?,recommended_adjustment=?,adjustment_manual_override=?,source_documents_match=? WHERE id=?`).run(analysis.reasons.join('\n'),note,adjustment,reason||note,analysis.adjusted_invoice_total,analysis.match_status,req.user!.id,analysis.classification,reasonCode,analysis.recommended_adjustment,manualOverride?1:0,1,invoice.id);
  logAudit('invoices',invoice.id,'UPDATE',req.user!.id,invoice,{action:'RECONCILE_VARIANCE',...analysis,variance_acceptance_note:note,adjustment_reason:reason||null});res.json({success:true,analysis});
});

router.get('/invoices/:id/three-way-match', requireAuth, requireRole('SupplyChainManager','PurchaseManager','PurchaseOfficer'), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
  if (!inv) return res.status(404).json({ error: 'Not found' });
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(inv.po_id) as any;
  const grns = db.prepare('SELECT grn_number FROM grns WHERE po_id=? ORDER BY grn_date,id').all(inv.po_id) as any[];
  const analysis=invoiceVarianceAnalysis(Number(inv.po_id),Number(inv.invoice_total),Number(inv.reconciliation_adjustment||0));

  res.json({
    po_number: po?.po_number,
    grn_numbers: grns.map(row=>row.grn_number),
    invoice_number: inv.invoice_number,
    po_total: analysis.po_total,
    grn_value: analysis.grn_value,
    invoice_total: inv.invoice_total,
    original_variance: analysis.original_variance,
    recommended_adjustment: analysis.recommended_adjustment,
    adjustment: analysis.adjustment,
    adjusted_invoice_total: analysis.adjusted_invoice_total,
    remaining_variance: analysis.remaining_variance,
    classification: analysis.classification,
    reasons: analysis.reasons,
    match_status: inv.match_status,
  });
});

router.get('/invoices/:id/payment-pack', requireAuth, requireRole('SupplyChainManager','PurchaseManager','PurchaseOfficer'), (req:AuthedRequest, res) => {
  const invoice = db.prepare(`SELECT inv.*, s.name supplier_name, s.supplier_code, s.address supplier_address,
    s.contact_person, s.phone supplier_phone, s.email supplier_email, s.payment_terms,
    po.po_number, po.po_date, po.status po_status, po.total_amount po_total,
    creator.full_name registered_by_name, verifier.full_name confirmed_by_name, accepter.full_name variance_accepted_by_name, ce.signature_url registered_by_signature_url, ve.signature_url confirmed_by_signature_url
    FROM invoices inv JOIN suppliers s ON s.id=inv.supplier_id
    JOIN purchase_orders po ON po.id=inv.po_id
    LEFT JOIN users creator ON creator.id=inv.created_by LEFT JOIN employees ce ON ce.id=creator.employee_id
    LEFT JOIN users verifier ON verifier.id=inv.verified_by LEFT JOIN employees ve ON ve.id=verifier.employee_id LEFT JOIN users accepter ON accepter.id=inv.variance_accepted_by WHERE inv.id=?`).get(req.params.id) as any;
  if (!invoice) return res.status(404).json({ error: 'Not found' });
  if (!invoice.finance_pack_reference) {
    invoice.finance_pack_reference = nextDocNumber('FINPACK');
    db.prepare('UPDATE invoices SET finance_pack_reference=? WHERE id=?').run(invoice.finance_pack_reference, invoice.id);
  }
  const receipts = db.prepare(`SELECT g.id,g.grn_number,g.grn_date,g.delivery_note,ROUND(COALESCE(SUM(gi.accepted_qty*gi.unit_cost*(1+COALESCE(pi.tax,0)/100.0)),0),2) accepted_value,
    u.full_name received_by_name,e.signature_url received_by_signature_url FROM grns g LEFT JOIN grn_items gi ON gi.grn_id=g.id LEFT JOIN po_items pi ON pi.po_id=g.po_id AND pi.item_id=gi.item_id LEFT JOIN users u ON u.id=g.created_by LEFT JOIN employees e ON e.id=u.employee_id WHERE g.po_id=? GROUP BY g.id ORDER BY g.grn_date,g.id`).all(invoice.po_id) as any[];
  const items = db.prepare(`SELECT pi.id, i.item_code, i.description, i.uom, pi.quantity ordered_qty, pi.price unit_price, pi.tax,
    COALESCE(SUM(gi.accepted_qty),0) accepted_qty, COALESCE(SUM(gi.rejected_qty),0) rejected_qty
    FROM po_items pi JOIN items i ON i.id=pi.item_id
    LEFT JOIN grns g ON g.po_id=pi.po_id LEFT JOIN grn_items gi ON gi.grn_id=g.id AND gi.item_id=pi.item_id
    WHERE pi.po_id=? GROUP BY pi.id ORDER BY pi.id`).all(invoice.po_id) as any[];
  const company = db.prepare('SELECT * FROM company WHERE deleted_at IS NULL ORDER BY id LIMIT 1').get() || {};
  const attachmentCount = (db.prepare("SELECT COUNT(*) count FROM document_attachments WHERE document_type='INVOICE' AND document_id=?").get(invoice.id) as any)?.count || 0;
  const duplicateCount = (db.prepare('SELECT COUNT(*) count FROM invoices WHERE supplier_id=? AND invoice_number=?').get(invoice.supplier_id, invoice.invoice_number) as any).count;
  const grnValue = receipts.reduce((sum, row) => sum + Number(row.accepted_value || 0), 0);
  const analysis=invoiceVarianceAnalysis(Number(invoice.po_id),Number(invoice.invoice_total),Number(invoice.reconciliation_adjustment||0));
  const sourcing=db.prepare(`SELECT po.id po_id,po.po_number,po.rfq_id,rfq.rfq_number,GROUP_CONCAT(DISTINCT ppl.pr_id) pr_ids
    FROM purchase_orders po LEFT JOIN rfqs rfq ON rfq.id=po.rfq_id LEFT JOIN po_pr_links ppl ON ppl.po_id=po.id WHERE po.id=? GROUP BY po.id`).get(invoice.po_id) as any;
  const quotations=sourcing?.rfq_id?db.prepare(`SELECT sq.id,sq.supplier_id,s.name supplier_name,sq.item_id,sq.price,sq.freight,sq.tax,sq.currency,sq.selected FROM supplier_quotations sq JOIN suppliers s ON s.id=sq.supplier_id WHERE sq.rfq_id=? ORDER BY sq.item_id,sq.id`).all(sourcing.rfq_id):[];
  let approvalAuthority:any={can_approve:false,required_role:'SupplyChainManager',effective_role:req.user!.role,delegated:false};
  if(invoice.finance_pack_status!=='Ready for Finance - External Process')try{const authority=assertExternalHandoffAuthority(req.user!.id,Number(invoice.id));approvalAuthority={can_approve:true,required_role:'SupplyChainManager',effective_role:authority.actor.role,delegated:!!authority.delegation,delegation_id:authority.delegation?.id||null};}catch(error:any){approvalAuthority={...approvalAuthority,message:error.message};}
  res.json({ invoice, receipts, items, company, attachment_count: attachmentCount, duplicate_check_passed: duplicateCount === 1,
    grn_value: grnValue, value_variance: Math.round((Number(invoice.invoice_total)-Number(invoice.po_total))*100)/100,analysis,
    sourcing:{...sourcing,pr_ids:String(sourcing?.pr_ids||'').split(',').filter(Boolean).map(Number),quotations,selected_quotation:quotations.find((row:any)=>row.selected===1)||null},
    finance_boundary:'Finance has no ProcuraFlow access. This package is exported by Supply Chain for the external Finance process.',
    approval_authority:approvalAuthority,can_output:invoice.finance_pack_status==='Ready for Finance - External Process' });
});

router.put('/invoices/:id/ready-for-finance', requireAuth, requireRole('SupplyChainManager','PurchaseManager','WarehouseManager'), (req: AuthedRequest, res) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
  if (!invoice) return res.status(404).json({ error: 'Not found' });
  if (invoice.finance_pack_status === 'Ready for Finance - External Process') return res.status(409).json({ error: 'This package is already Ready for Finance - External Process' });
  try{assertPostingPeriod(req.body?.posting_date||invoice.invoice_date,req.user!,req.body?.period_override_reason);}catch(e:any){return res.status(e.status||409).json({error:e.message});}
  const analysis=invoiceVarianceAnalysis(Number(invoice.po_id),Number(invoice.invoice_total),Number(invoice.reconciliation_adjustment||0));
  if(!analysis.source_documents_match)return res.status(409).json({error:'External Finance handoff is blocked because the PO and accepted GRN values differ'});
  if(analysis.classification==='Variance — Review Required'&&!invoice.variance_acceptance_note)return res.status(409).json({error:'The unresolved variance requires a Supply Chain Manager acceptance decision'});
  const evidenceRequired=analysis.classification==='Reconciled'||Boolean(invoice.adjustment_manual_override)||Boolean(invoice.variance_acceptance_note);
  if(evidenceRequired&&!RECONCILIATION_REASONS.has(String(invoice.reconciliation_reason_code||'')))return res.status(409).json({error:'A controlled reconciliation reason category is required before external Finance handoff'});
  const evidence=(db.prepare("SELECT COUNT(*) count FROM document_attachments WHERE document_type='INVOICE' AND document_id=?").get(invoice.id) as any)?.count||0;
  if(evidenceRequired&&!evidence)return res.status(409).json({error:'Supporting evidence is required before this reconciliation can be handed off to the external Finance process'});
  let authority:any;try{authority=assertExternalHandoffAuthority(req.user!.id,Number(invoice.id));}catch(e:any){return res.status(e.status||403).json({error:e.message});}
  try { assertNotSelfApproval(invoice.created_by, req.user!.id, req.user!.role === 'SupplyChainManager'); } catch (error) {
    if (error instanceof SelfApprovalError) return res.status(403).json({ error: 'The Supply Chain Manager who registered this invoice cannot confirm the same payment pack' });
    throw error;
  }
  const reference = invoice.finance_pack_reference || nextDocNumber('FINPACK');
  const handoff=db.transaction(()=>{db.prepare(`UPDATE invoices SET finance_pack_reference=?, finance_pack_status='Ready for Finance - External Process',finance_review_comments=?,verified_by=?,verified_date=datetime('now') WHERE id=?`).run(reference,String(req.body?.comments||'').trim()||null,req.user!.id,req.params.id);return db.prepare(`INSERT INTO external_finance_handoffs(invoice_id,package_reference,handed_off_by,normal_role,delegation_id,delegated_by_employee_id,external_finance_reference,confirmation_reference,notes) VALUES(?,?,?,?,?,?,?,?,?)`).run(invoice.id,reference,req.user!.id,authority.actor.role,authority.delegation?.id||null,authority.delegation?.delegator_employee_id||null,String(req.body?.external_finance_reference||'').trim()||null,String(req.body?.confirmation_reference||'').trim()||null,String(req.body?.comments||'').trim()||null);})();
  logAudit('external_finance_handoffs',Number(handoff.lastInsertRowid),'CREATE',req.user!.id,undefined,{action:'READY_FOR_FINANCE_EXTERNAL_PROCESS',invoice_id:invoice.id,package_reference:reference,actual_employee_id:authority.actor.employee_id,normal_role:authority.actor.role,delegation_id:authority.delegation?.id||null,delegated_by_employee_id:authority.delegation?.delegator_employee_id||null,delegation_effective_from:authority.delegation?.effective_from||null,delegation_effective_until:authority.delegation?.effective_until||null});
  res.json({success:true,finance_pack_reference:reference,status:'Ready for Finance - External Process',delegation_id:authority.delegation?.id||null});
});

// Old action name is deliberately retired so integrations cannot imply an in-system Finance action.
router.put('/invoices/:id/submit-finance',requireAuth,(_req,res)=>res.status(410).json({error:'Use the Ready for Finance - External Process handoff action'}));

// Compatibility endpoint: confirmation remains exclusively with Supply Chain Manager.
router.put('/invoices/:id/verify', requireAuth, requireRole('SupplyChainManager'), (_req, res) =>
  res.status(410).json({ error: 'Use the Ready for Finance - External Process handoff action' }));

export default router;
