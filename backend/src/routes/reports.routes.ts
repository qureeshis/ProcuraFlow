import { Router } from 'express';
import db from '../db';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { currentValuation } from '../utils/fifo';
import { defaultsForRole } from '../utils/permissions';
import { authorizedWarehouseIds } from '../utils/warehouseAccess';

const router = Router();

// Section 10: Procurement Reports
const PROCUREMENT_ROLES = ['SupplyChainManager', 'PurchaseManager', 'PurchaseOfficer'];
const INVENTORY_ROLES = ['SupplyChainManager', 'WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'];
function scope(req:AuthedRequest){const ids=authorizedWarehouseIds(req.user!.id);return{ids,marks:ids.map(()=>'?').join(',')}}

router.get('/executive-supply-chain-overview', requireAuth, requireRole('SupplyChainManager'), (_req,res)=>res.json(db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM purchase_requisitions WHERE status='Submitted') submitted_prs,
    (SELECT COUNT(*) FROM purchase_orders WHERE status='PendingApproval') pending_po_approvals,
    (SELECT COUNT(*) FROM purchase_orders WHERE status NOT IN ('Closed','Rejected')) open_purchase_orders,
    ROUND((SELECT COALESCE(SUM(total_amount),0) FROM purchase_orders WHERE status IN ('Approved','Printed','Closed') AND po_date>=date('now','start of month')),2) monthly_purchase_value,
    ROUND((SELECT COALESCE(SUM(quantity_remaining*unit_cost),0) FROM inventory_layers),2) inventory_value,
    (SELECT COUNT(*) FROM items i WHERE i.deleted_at IS NULL AND COALESCE((SELECT SUM(s.quantity) FROM inventory_stock s WHERE s.item_id=i.id),0)<=i.reorder_level) low_stock_items,
    (SELECT COUNT(*) FROM inventory_layers WHERE quantity_remaining>0 AND expiry_date IS NOT NULL AND julianday(expiry_date)-julianday('now') BETWEEN 0 AND 90) expiry_risk_layers,
    (SELECT COUNT(*) FROM invoices WHERE match_status IN ('Pending','Variance')) invoice_match_exceptions,
    (SELECT COUNT(*) FROM suppliers WHERE deleted_at IS NULL) active_suppliers,
    (SELECT COUNT(*) FROM employees WHERE deleted_at IS NULL AND status='Active') active_employees
`).all()));

router.get('/open-po-commitments', requireAuth, requireRole('SupplyChainManager'), (_req,res)=>res.json(db.prepare(`
  SELECT po.po_date,po.committed_delivery_date,po.po_number,s.name supplier_name,i.category,i.item_code,i.description,
    pi.quantity ordered_quantity,COALESCE((SELECT SUM(gi.accepted_qty) FROM grn_items gi JOIN grns g ON g.id=gi.grn_id WHERE g.po_id=po.id AND gi.item_id=pi.item_id),0) received_quantity,
    MAX(0,pi.quantity-COALESCE((SELECT SUM(gi.accepted_qty) FROM grn_items gi JOIN grns g ON g.id=gi.grn_id WHERE g.po_id=po.id AND gi.item_id=pi.item_id),0)) outstanding_quantity,
    pi.price unit_price,ROUND(MAX(0,pi.quantity-COALESCE((SELECT SUM(gi.accepted_qty) FROM grn_items gi JOIN grns g ON g.id=gi.grn_id WHERE g.po_id=po.id AND gi.item_id=pi.item_id),0))*pi.price*(1+pi.tax/100.0),2) outstanding_value,CASE WHEN po.committed_delivery_date IS NOT NULL AND date(po.committed_delivery_date)<date('now') THEN CAST(julianday('now')-julianday(po.committed_delivery_date) AS INTEGER) ELSE 0 END days_overdue,po.status
  FROM po_items pi JOIN purchase_orders po ON po.id=pi.po_id JOIN suppliers s ON s.id=po.supplier_id JOIN items i ON i.id=pi.item_id
  WHERE po.status NOT IN ('Closed','Rejected') AND pi.quantity>COALESCE((SELECT SUM(gi.accepted_qty) FROM grn_items gi JOIN grns g ON g.id=gi.grn_id WHERE g.po_id=po.id AND gi.item_id=pi.item_id),0)
  ORDER BY po.po_date,po.po_number,i.item_code
`).all()));

router.get('/purchase-by-category', requireAuth, requireRole('SupplyChainManager'), (_req,res)=>res.json(db.prepare(`
  SELECT COALESCE(NULLIF(i.category,''),'Uncategorized') category,COUNT(DISTINCT po.id) po_count,
    ROUND(SUM(pi.quantity),2) total_quantity,ROUND(SUM(pi.quantity*pi.price*(1+pi.tax/100.0)),2) total_value
  FROM po_items pi JOIN purchase_orders po ON po.id=pi.po_id JOIN items i ON i.id=pi.item_id
  WHERE po.status IN ('Approved','Printed','Closed') GROUP BY COALESCE(NULLIF(i.category,''),'Uncategorized') ORDER BY total_value DESC
`).all()));

router.get('/purchase-by-month', requireAuth, requireRole('SupplyChainManager'), (_req,res)=>res.json(db.prepare(`
  SELECT strftime('%Y-%m',po_date) month,COUNT(*) po_count,COUNT(DISTINCT supplier_id) supplier_count,ROUND(SUM(total_amount),2) total_value
  FROM purchase_orders WHERE status IN ('Approved','Printed','Closed') GROUP BY strftime('%Y-%m',po_date) ORDER BY month DESC
`).all()));

router.get('/inventory-aging', requireAuth, requireRole('SupplyChainManager'), (_req,res)=>res.json(db.prepare(`
  SELECT i.item_code,i.description,i.category,w.name warehouse_name,il.batch,il.received_date,
    CAST(julianday('now')-julianday(il.received_date) AS INTEGER) age_days,
    CASE WHEN julianday('now')-julianday(il.received_date)<=30 THEN '0-30 Days' WHEN julianday('now')-julianday(il.received_date)<=90 THEN '31-90 Days' WHEN julianday('now')-julianday(il.received_date)<=180 THEN '91-180 Days' WHEN julianday('now')-julianday(il.received_date)<=365 THEN '181-365 Days' ELSE 'Over 365 Days' END aging_bucket,
    il.quantity_remaining quantity,il.unit_cost,ROUND(il.quantity_remaining*il.unit_cost,2) inventory_value
  FROM inventory_layers il JOIN items i ON i.id=il.item_id JOIN warehouses w ON w.id=il.warehouse_id
  WHERE il.quantity_remaining>0 ORDER BY age_days DESC,i.item_code
`).all()));

router.get('/location-stock-executive', requireAuth, requireRole('SupplyChainManager'), (_req,res)=>res.json(db.prepare(`
  SELECT w.name warehouse_name,COALESCE(l.code,'Unassigned') location,i.item_code,i.description,i.category,
    s.quantity,COALESCE(NULLIF(i.standard_cost,0),i.last_purchase_price,0) unit_cost,ROUND(s.quantity*COALESCE(NULLIF(i.standard_cost,0),i.last_purchase_price,0),2) inventory_value
  FROM inventory_stock s JOIN warehouses w ON w.id=s.warehouse_id JOIN items i ON i.id=s.item_id LEFT JOIN locations l ON l.id=s.location_id
  WHERE s.quantity<>0 ORDER BY w.name,location,i.item_code
`).all()));

router.get('/supplier-performance-executive', requireAuth, requireRole('SupplyChainManager'), (_req,res)=>res.json(db.prepare(`
  SELECT s.supplier_code,s.name supplier_name,s.rating master_rating,
    (SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id=s.id AND po.status IN ('Approved','Printed','Closed')) po_count,
    ROUND(COALESCE((SELECT SUM(po.total_amount) FROM purchase_orders po WHERE po.supplier_id=s.id AND po.status IN ('Approved','Printed','Closed')),0),2) supplier_spend,
    ROUND(COALESCE((SELECT SUM(gi.accepted_qty) FROM grn_items gi JOIN grns g ON g.id=gi.grn_id WHERE g.supplier_id=s.id),0),2) accepted_quantity,
    ROUND(COALESCE((SELECT SUM(gi.rejected_qty) FROM grn_items gi JOIN grns g ON g.id=gi.grn_id WHERE g.supplier_id=s.id),0),2) rejected_quantity,
    ROUND(CASE WHEN COALESCE((SELECT SUM(gi.quantity_received) FROM grn_items gi JOIN grns g ON g.id=gi.grn_id WHERE g.supplier_id=s.id),0)=0 THEN 0 ELSE 100.0*(SELECT SUM(gi.accepted_qty) FROM grn_items gi JOIN grns g ON g.id=gi.grn_id WHERE g.supplier_id=s.id)/(SELECT SUM(gi.quantity_received) FROM grn_items gi JOIN grns g ON g.id=gi.grn_id WHERE g.supplier_id=s.id) END,2) acceptance_pct,
    ROUND(CASE WHEN (SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id=s.id AND po.status='Closed' AND po.committed_delivery_date IS NOT NULL)=0 THEN 0 ELSE 100.0*(SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id=s.id AND po.status='Closed' AND po.committed_delivery_date IS NOT NULL AND date((SELECT MAX(g.grn_date) FROM grns g WHERE g.po_id=po.id))<=date(po.committed_delivery_date))/(SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id=s.id AND po.status='Closed' AND po.committed_delivery_date IS NOT NULL) END,2) on_time_delivery_pct,
    ROUND(COALESCE((SELECT AVG(vs.overall_score) FROM vendor_scorecards vs WHERE vs.supplier_id=s.id),0),2) overall_score
  FROM suppliers s WHERE s.deleted_at IS NULL ORDER BY supplier_spend DESC,s.name
`).all()));

router.get('/approval-governance', requireAuth, requireRole('SupplyChainManager'), (_req,res)=>res.json(db.prepare(`
  SELECT date(al.requested_date) requested_date,al.document_type,al.document_number,al.required_role,
    rq.full_name requested_by,al.decision,dc.full_name decision_by,al.decision_date,
    ROUND(CASE WHEN al.decision_date IS NULL THEN (julianday('now')-julianday(al.requested_date))*24 ELSE (julianday(al.decision_date)-julianday(al.requested_date))*24 END,2) turnaround_hours,
    al.manual_reference,al.comments
  FROM approval_log al LEFT JOIN users rq ON rq.id=al.requested_by LEFT JOIN users dc ON dc.id=al.decision_by
  ORDER BY al.requested_date DESC,al.id DESC
`).all()));

router.get('/user-activity-log', requireAuth, requireRole('SupplyChainManager'), (_req,res)=>res.json(db.prepare(`
  SELECT date(occurred_at) activity_date,time(occurred_at) activity_time,full_name employee_name,
    username login_id,role,department_name,warehouse_name,event_type,current_action,page_path
  FROM user_activity_log ORDER BY occurred_at DESC,id DESC LIMIT 10000
`).all()));
router.get('/employee-permissions', requireAuth, requireRole('SupplyChainManager'), (_req,res)=>{
  const labels:Record<string,string>={'task.pr':'Purchase Requisitions','task.rfq':'RFQs & Quotations','task.po':'Purchase Orders','task.invoices':'Invoices & Three-Way Match','task.grn':'Goods Receipts (GRN)','task.material_issue':'Material Issues','task.returns':'Material Returns','task.transfers':'Warehouse Transfers','task.adjustments':'Stock Adjustments','task.inventory':'Inventory Inquiry & Valuation','task.cycle_count':'Cycle Counts','task.tools':'Tool Management','task.vendor_scorecard':'Vendor Scorecards','task.employees':'Employee Master','task.suppliers':'Supplier Master','task.items':'Item Master','task.warehouses':'Warehouses & Locations','task.settings':'System Settings','task.import_data':'Data Imports','task.live_activity':'Live User Activity','report.procurement':'Procurement Reports','report.inventory':'Inventory Reports','report.warehouse':'Warehouse Reports','report.employee':'Employee Accountability Reports','report.tools':'Tool Reports','report.system':'System Administration Reports','report.executive':'Executive Reports'};
  const employees=db.prepare(`SELECT e.employee_code,e.name employee_name,e.position,e.approval_role,e.approval_limit,e.permission_keys,e.status,d.name department_name,w.name warehouse_name,u.username login_id,CASE WHEN u.is_active=1 AND u.locked_reason IS NULL THEN 'Active' WHEN u.locked_reason IS NOT NULL THEN 'Locked' ELSE 'Inactive' END login_status FROM employees e LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN warehouses w ON w.id=e.warehouse_id LEFT JOIN users u ON u.employee_id=e.id AND u.deleted_at IS NULL WHERE e.deleted_at IS NULL ORDER BY e.name`).all() as any[];
  const {defaultsForRole}=require('../utils/permissions');const rows:any[]=[];for(const employee of employees){let keys:string[];try{keys=employee.permission_keys?JSON.parse(employee.permission_keys):defaultsForRole(employee.approval_role);}catch{keys=defaultsForRole(employee.approval_role);}for(const key of keys)rows.push({employee_code:employee.employee_code,employee_name:employee.employee_name,login_id:employee.login_id,login_status:employee.login_status,department_name:employee.department_name,warehouse_name:employee.warehouse_name,position:employee.position,approval_role:employee.approval_role,approval_limit:employee.approval_limit,permission_type:key.startsWith('report.')?'Report':'Application Task',permission_name:labels[key]||key,assignment_source:employee.permission_keys?'Individual Assignment':'Role Default',employee_status:employee.status});}res.json(rows);
});

router.get('/pr-register', requireAuth, requireRole(...PROCUREMENT_ROLES), (_req,res)=>res.json(db.prepare(`SELECT pr.pr_number,pr.pr_date,d.name department_name,u.full_name requestor_name,pr.status FROM purchase_requisitions pr LEFT JOIN departments d ON d.id=pr.department_id LEFT JOIN users u ON u.id=pr.requestor_id ORDER BY pr.id DESC`).all()));
router.get('/rfq-status', requireAuth, requireRole(...PROCUREMENT_ROLES), (_req,res)=>res.json(db.prepare(`SELECT r.rfq_number,r.rfq_date,r.status,pr.pr_number,COUNT(DISTINCT rs.supplier_id) suppliers_invited,COUNT(DISTINCT sq.id) quotations_received FROM rfqs r LEFT JOIN purchase_requisitions pr ON pr.id=r.pr_id LEFT JOIN rfq_suppliers rs ON rs.rfq_id=r.id LEFT JOIN supplier_quotations sq ON sq.rfq_id=r.id GROUP BY r.id ORDER BY r.id DESC`).all()));
router.get('/quotation-comparison', requireAuth, requireRole(...PROCUREMENT_ROLES), (_req,res)=>res.json(db.prepare(`SELECT r.rfq_number,i.item_code,s.name supplier_name,sq.currency,sq.price unit_price,sq.freight,sq.tax,sq.delivery_time_days lead_time,sq.payment_terms,sq.warranty,sq.quality_rating,s.rating supplier_score,(sq.price+sq.freight+(sq.price*sq.tax/100.0)) total_landed_cost,sq.selected FROM supplier_quotations sq JOIN rfqs r ON r.id=sq.rfq_id JOIN items i ON i.id=sq.item_id JOIN suppliers s ON s.id=sq.supplier_id ORDER BY r.id DESC,i.item_code,total_landed_cost`).all()));
router.get('/po-register', requireAuth, requireRole(...PROCUREMENT_ROLES), (_req,res)=>res.json(db.prepare(`SELECT po.po_number,po.po_date,po.committed_delivery_date,s.name supplier_name,po.total_amount,po.status,po.approval_ref_number FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id ORDER BY po.id DESC`).all()));
router.get('/open-po', requireAuth, requireRole(...PROCUREMENT_ROLES), (_req,res)=>res.json(db.prepare(`SELECT po.po_number,po.po_date,po.committed_delivery_date,s.name supplier_name,po.total_amount,po.status,CAST(julianday('now')-julianday(po.po_date) AS INTEGER) age_days,CASE WHEN po.committed_delivery_date IS NOT NULL AND date(po.committed_delivery_date)<date('now') THEN CAST(julianday('now')-julianday(po.committed_delivery_date) AS INTEGER) ELSE 0 END days_overdue FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id WHERE po.status NOT IN ('Closed','Rejected') ORDER BY days_overdue DESC,age_days DESC`).all()));
router.get('/po-delivery-performance', requireAuth, requireRole(...PROCUREMENT_ROLES), (_req,res)=>res.json(db.prepare(`
  WITH progress AS (SELECT po.id,po.po_number,po.po_date,po.committed_delivery_date,po.status,po.total_amount,s.name supplier_name,
    SUM(pi.quantity) ordered_quantity,SUM(MIN(pi.quantity,COALESCE((SELECT SUM(gi.accepted_qty) FROM grn_items gi JOIN grns g ON g.id=gi.grn_id WHERE g.po_id=po.id AND gi.item_id=pi.item_id),0))) received_quantity,
    (SELECT MAX(g.grn_date) FROM grns g WHERE g.po_id=po.id) actual_delivery_date
    FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id JOIN po_items pi ON pi.po_id=po.id
    WHERE po.status NOT IN ('Draft','Rejected') GROUP BY po.id)
  SELECT po_number,po_date,committed_delivery_date,actual_delivery_date,supplier_name,status,ordered_quantity,received_quantity,
    ROUND(CASE WHEN ordered_quantity=0 THEN 0 ELSE 100.0*received_quantity/ordered_quantity END,2) received_pct,
    CASE WHEN committed_delivery_date IS NULL THEN 'Commitment Not Set' WHEN received_quantity>=ordered_quantity AND date(actual_delivery_date)<=date(committed_delivery_date) THEN 'Delivered On Time' WHEN received_quantity>=ordered_quantity THEN 'Delivered Late' WHEN date(committed_delivery_date)<date('now') THEN 'Overdue / Outstanding' ELSE 'Open / On Schedule' END delivery_result,
    CASE WHEN committed_delivery_date IS NULL THEN NULL WHEN received_quantity>=ordered_quantity THEN CAST(julianday(actual_delivery_date)-julianday(committed_delivery_date) AS INTEGER) ELSE CAST(julianday('now')-julianday(committed_delivery_date) AS INTEGER) END delivery_variance_days,total_amount
  FROM progress ORDER BY CASE delivery_result WHEN 'Overdue / Outstanding' THEN 0 WHEN 'Delivered Late' THEN 1 WHEN 'Commitment Not Set' THEN 2 ELSE 3 END,committed_delivery_date
`).all()));
router.get('/price-variance', requireAuth, requireRole(...PROCUREMENT_ROLES), (_req,res)=>res.json(db.prepare(`
  WITH received AS (
    SELECT gi.id grn_item_id,g.id grn_id,g.grn_number,g.grn_date,po.po_number,po.po_date,
      s.name supplier_name,i.item_code,i.description,COALESCE(i.purchase_uom,i.uom) uom,
      gi.quantity_received,gi.accepted_qty,gi.rejected_qty,gi.unit_cost actual_unit_price,i.standard_cost,
      (SELECT AVG(gi2.unit_cost) FROM grn_items gi2 JOIN grns g2 ON g2.id=gi2.grn_id
       WHERE gi2.item_id=gi.item_id AND (g2.grn_date<g.grn_date OR (g2.grn_date=g.grn_date AND gi2.id<gi.id))) prior_average_price,
      (SELECT gi3.unit_cost FROM grn_items gi3 JOIN grns g3 ON g3.id=gi3.grn_id JOIN purchase_orders po3 ON po3.id=g3.po_id
       WHERE gi3.item_id=gi.item_id AND po3.supplier_id=po.supplier_id AND (g3.grn_date<g.grn_date OR (g3.grn_date=g.grn_date AND gi3.id<gi.id))
       ORDER BY g3.grn_date DESC,gi3.id DESC LIMIT 1) previous_supplier_price
    FROM grn_items gi JOIN grns g ON g.id=gi.grn_id JOIN purchase_orders po ON po.id=g.po_id
    JOIN suppliers s ON s.id=po.supplier_id JOIN items i ON i.id=gi.item_id
  )
  SELECT grn_date,grn_number,po_number,po_date,item_code,description,supplier_name,uom,
    quantity_received,accepted_qty,rejected_qty,ROUND(actual_unit_price,2) actual_unit_price,
    ROUND(COALESCE(prior_average_price,standard_cost),2) comparison_price,
    CASE WHEN prior_average_price IS NULL THEN 'Standard Cost' ELSE 'Prior Received Average' END comparison_basis,
    ROUND(actual_unit_price-COALESCE(prior_average_price,standard_cost),2) price_variance,
    ROUND(CASE WHEN COALESCE(prior_average_price,standard_cost)=0 THEN 0 ELSE 100.0*(actual_unit_price-COALESCE(prior_average_price,standard_cost))/COALESCE(prior_average_price,standard_cost) END,2) variance_percent,
    ROUND(previous_supplier_price,2) previous_supplier_price,ROUND(accepted_qty*actual_unit_price,2) accepted_value
  FROM received ORDER BY grn_date DESC,grn_id DESC,item_code
`).all()));
router.get('/finance-payment-verification', requireAuth, requireRole(...PROCUREMENT_ROLES), (_req,res)=>res.json(db.prepare(`
  SELECT inv.finance_pack_reference,inv.invoice_number,inv.invoice_date,s.supplier_code,s.name supplier_name,
    inv.transaction_currency currency,inv.exchange_rate,inv.base_currency,ROUND(inv.base_currency_amount,2) base_currency_amount,
    po.po_number,po.po_date,po.status po_status,ROUND(po.total_amount,2) po_total,
    ROUND(COALESCE((SELECT SUM(gi.accepted_qty*gi.unit_cost*(1+COALESCE(pi.tax,0)/100.0)) FROM grn_items gi JOIN grns g ON g.id=gi.grn_id JOIN po_items pi ON pi.po_id=g.po_id AND pi.item_id=gi.item_id WHERE g.po_id=po.id),0),2) grn_value,
    ROUND(inv.invoice_total,2) invoice_total,ROUND(inv.tax,2) tax_amount,
    ROUND(inv.invoice_total-po.total_amount,2) original_value_variance,inv.variance_reason,
    ROUND(COALESCE(inv.reconciliation_adjustment,0),2) reconciliation_adjustment,
    ROUND(COALESCE(inv.adjusted_invoice_total,inv.invoice_total),2) adjusted_invoice_total,
    ROUND(COALESCE(inv.adjusted_invoice_total,inv.invoice_total)-po.total_amount,2) remaining_variance,
    inv.reconciliation_classification,inv.reconciliation_reason_code,ROUND(inv.recommended_adjustment,2) recommended_adjustment,
    inv.adjustment_manual_override,inv.source_documents_match,COALESCE(inv.variance_acceptance_note,inv.adjustment_reason) reconciliation_reason_and_acceptance,va.full_name variance_accepted_by,inv.variance_accepted_at,inv.match_status,
    inv.finance_pack_status,u.full_name confirmed_by,inv.verified_date confirmation_date,
    inv.finance_review_comments review_comments,
    (SELECT COUNT(*) FROM document_attachments da WHERE da.document_type='INVOICE' AND da.document_id=inv.id) supporting_documents
  FROM invoices inv JOIN suppliers s ON s.id=inv.supplier_id JOIN purchase_orders po ON po.id=inv.po_id
  LEFT JOIN users u ON u.id=inv.verified_by LEFT JOIN users va ON va.id=inv.variance_accepted_by ORDER BY inv.invoice_date DESC,inv.id DESC
`).all()));
router.get('/grn-register', requireAuth, requireRole(...INVENTORY_ROLES), (req:AuthedRequest,res)=>{const s=scope(req);if(!s.ids.length)return res.json([]);res.json(db.prepare(`SELECT g.grn_number,g.grn_date,po.po_number,s.name supplier_name,g.delivery_note,ROUND(SUM(gi.accepted_qty*gi.unit_cost),2) accepted_value FROM grns g JOIN purchase_orders po ON po.id=g.po_id JOIN suppliers s ON s.id=g.supplier_id JOIN grn_items gi ON gi.grn_id=g.id AND gi.warehouse_id IN(${s.marks}) GROUP BY g.id ORDER BY g.id DESC`).all(...s.ids))});
router.get('/daily-receiving', requireAuth, requireRole(...INVENTORY_ROLES), (req:AuthedRequest,res)=>{const s=scope(req);if(!s.ids.length)return res.json([]);res.json(db.prepare(`SELECT g.grn_date date,g.grn_number,i.item_code,w.warehouse_code,w.name warehouse_name,w.site_name,l.code location_code,gi.quantity_received received,gi.accepted_qty accepted,gi.rejected_qty rejected FROM grn_items gi JOIN grns g ON g.id=gi.grn_id JOIN items i ON i.id=gi.item_id JOIN warehouses w ON w.id=gi.warehouse_id LEFT JOIN locations l ON l.id=gi.location_id WHERE gi.warehouse_id IN(${s.marks}) ORDER BY g.grn_date DESC,g.id DESC`).all(...s.ids))});
router.get('/daily-issues', requireAuth, requireRole(...INVENTORY_ROLES), (req:AuthedRequest,res)=>{const s=scope(req);if(!s.ids.length)return res.json([]);res.json(db.prepare(`SELECT mi.issue_date date,mi.issue_number,e.name employee_name,d.name department_name,i.item_code,w.warehouse_code,w.name warehouse_name,w.site_name,l.code location_code,mii.quantity,mii.value FROM material_issue_items mii JOIN material_issues mi ON mi.id=mii.issue_id JOIN employees e ON e.id=mi.employee_id LEFT JOIN departments d ON d.id=e.department_id JOIN items i ON i.id=mii.item_id JOIN warehouses w ON w.id=mii.warehouse_id LEFT JOIN locations l ON l.id=mii.location_id WHERE mi.status='Posted' AND mii.warehouse_id IN(${s.marks}) ORDER BY mi.id DESC`).all(...s.ids))});
router.get('/returns-report', requireAuth, requireRole(...INVENTORY_ROLES), (req:AuthedRequest,res)=>{const s=scope(req);if(!s.ids.length)return res.json([]);res.json(db.prepare(`SELECT r.return_number,r.return_date,e.name employee_name,i.item_code,r.quantity,r.condition,w.name warehouse_name FROM returns r JOIN items i ON i.id=r.item_id LEFT JOIN employees e ON e.id=r.employee_id LEFT JOIN warehouses w ON w.id=r.warehouse_id WHERE r.warehouse_id IN(${s.marks}) ORDER BY r.id DESC`).all(...s.ids))});
router.get('/transfers-report', requireAuth, requireRole(...INVENTORY_ROLES), (req:AuthedRequest,res)=>{const s=scope(req);if(!s.ids.length)return res.json([]);res.json(db.prepare(`SELECT t.transfer_number,t.transfer_date,i.item_code,t.quantity,fw.name from_warehouse_name,tw.name to_warehouse_name,t.transport_mode,t.tracking_reference,t.status,t.dispatched_at,tr.received_at,tr.receipt_number receiving_reference,du.full_name dispatched_by_name,ru.full_name received_by_name FROM transfers t JOIN items i ON i.id=t.item_id LEFT JOIN warehouses fw ON fw.id=t.from_warehouse_id LEFT JOIN warehouses tw ON tw.id=t.to_warehouse_id LEFT JOIN users du ON du.id=t.dispatched_by LEFT JOIN transfer_receipts tr ON tr.transfer_id=t.id LEFT JOIN users ru ON ru.id=tr.received_by WHERE t.from_warehouse_id IN(${s.marks}) OR t.to_warehouse_id IN(${s.marks}) ORDER BY t.id DESC`).all(...s.ids,...s.ids))});
router.get('/transfer-receipts-report', requireAuth, requireRole(...INVENTORY_ROLES), (req:AuthedRequest,res)=>{const s=scope(req);if(!s.ids.length)return res.json([]);res.json(db.prepare(`SELECT tr.receipt_number,tr.received_at,t.transfer_number,i.item_code,i.description,tr.quantity_received,w.warehouse_code,w.name receiving_warehouse,l.code receiving_bin,u.full_name received_by_name,tr.receiving_note FROM transfer_receipts tr JOIN transfers t ON t.id=tr.transfer_id JOIN items i ON i.id=tr.item_id JOIN warehouses w ON w.id=tr.warehouse_id JOIN locations l ON l.id=tr.location_id LEFT JOIN users u ON u.id=tr.received_by WHERE tr.warehouse_id IN(${s.marks}) ORDER BY tr.id DESC`).all(...s.ids))});
router.get('/adjustments-report', requireAuth, requireRole(...INVENTORY_ROLES), (req:AuthedRequest,res)=>{const s=scope(req);if(!s.ids.length)return res.json([]);res.json(db.prepare(`SELECT a.adjustment_number,a.adjustment_date,i.item_code,w.name warehouse_name,a.quantity_change,a.reason,a.status FROM stock_adjustments a JOIN items i ON i.id=a.item_id JOIN warehouses w ON w.id=a.warehouse_id WHERE a.warehouse_id IN(${s.marks}) ORDER BY a.id DESC`).all(...s.ids))});
router.get('/stock-ledger', requireAuth, requireRole(...INVENTORY_ROLES), (req:AuthedRequest,res)=>{const s=scope(req);if(!s.ids.length)return res.json([]);res.json(db.prepare(`SELECT sl.created_at,sl.transaction_type,i.item_code,i.description,w.warehouse_code,w.name warehouse_name,w.site_name,l.code location_code,sl.quantity_change,sl.unit_cost,ROUND(sl.quantity_change*sl.unit_cost,2) total_value,sl.reference_number,u.full_name posted_by FROM stock_ledger sl JOIN items i ON i.id=sl.item_id JOIN warehouses w ON w.id=sl.warehouse_id LEFT JOIN locations l ON l.id=sl.location_id LEFT JOIN users u ON u.id=sl.created_by WHERE sl.warehouse_id IN(${s.marks}) ORDER BY sl.id DESC`).all(...s.ids))});
router.get('/low-stock', requireAuth, requireRole(...INVENTORY_ROLES), (req:AuthedRequest,res)=>{const s=scope(req);if(!s.ids.length)return res.json([]);res.json(db.prepare(`SELECT i.item_code,i.description,i.reorder_level,COALESCE(SUM(s.quantity),0) current_quantity FROM items i LEFT JOIN inventory_stock s ON s.item_id=i.id AND s.warehouse_id IN(${s.marks}) WHERE i.deleted_at IS NULL GROUP BY i.id HAVING current_quantity<=i.reorder_level ORDER BY i.item_code`).all(...s.ids))});
router.get('/batch-report', requireAuth, requireRole(...INVENTORY_ROLES), (req:AuthedRequest,res)=>{const s=scope(req);if(!s.ids.length)return res.json([]);res.json(db.prepare(`SELECT i.item_code,il.batch,il.expiry_date,w.warehouse_code,w.name warehouse_name,w.site_name,l.code location_code,SUM(il.quantity_remaining) quantity,il.unit_cost FROM inventory_layers il JOIN items i ON i.id=il.item_id JOIN warehouses w ON w.id=il.warehouse_id LEFT JOIN locations l ON l.id=il.location_id WHERE il.batch IS NOT NULL AND il.warehouse_id IN(${s.marks}) GROUP BY i.id,il.batch,il.expiry_date,w.id,l.id,il.unit_cost`).all(...s.ids))});
router.get('/cycle-count-accuracy', requireAuth, requireRole(...INVENTORY_ROLES), (req:AuthedRequest,res)=>{const s=scope(req);if(!s.ids.length)return res.json([]);res.json(db.prepare(`SELECT cc.count_number,cc.count_date,w.name warehouse_name,COUNT(cci.id) lines,SUM(CASE WHEN ABS(COALESCE(cci.variance,0))<0.0001 THEN 1 ELSE 0 END) accurate_lines,ROUND(100.0*SUM(CASE WHEN ABS(COALESCE(cci.variance,0))<0.0001 THEN 1 ELSE 0 END)/COUNT(cci.id),2) accuracy_pct FROM cycle_counts cc JOIN cycle_count_items cci ON cci.count_id=cc.id JOIN warehouses w ON w.id=cc.warehouse_id WHERE cc.status='Approved' AND cc.warehouse_id IN(${s.marks}) GROUP BY cc.id ORDER BY cc.id DESC`).all(...s.ids))});
router.get('/outstanding-returnables', requireAuth, requireRole(...INVENTORY_ROLES), (req:AuthedRequest,res)=>{const s=scope(req);if(!s.ids.length)return res.json([]);res.json(db.prepare(`SELECT e.employee_code,e.name employee_name,i.item_code,SUM(mii.quantity)-COALESCE((SELECT SUM(r.quantity) FROM returns r WHERE r.employee_id=e.id AND r.item_id=i.id AND r.warehouse_id IN(${s.marks})),0) outstanding_quantity FROM material_issue_items mii JOIN material_issues mi ON mi.id=mii.issue_id JOIN employees e ON e.id=mi.employee_id JOIN items i ON i.id=mii.item_id WHERE mi.status='Posted' AND i.consumable_returnable='Returnable' AND mii.warehouse_id IN(${s.marks}) GROUP BY e.id,i.id HAVING outstanding_quantity>0`).all(...s.ids,...s.ids))});
router.get('/tool-condition', requireAuth, requireRole(...INVENTORY_ROLES), (req:AuthedRequest,res)=>{const s=scope(req);if(!s.ids.length)return res.json([]);res.json(db.prepare(`SELECT tool_code,serial_number,make,model,condition,issue_date,return_date,calibration_due_date FROM tools WHERE condition IN ('Damaged','Lost','Needs Repair') AND warehouse_id IN(${s.marks}) ORDER BY tool_code`).all(...s.ids))});

router.get('/purchase-summary', requireAuth, requireRole(...PROCUREMENT_ROLES), (req, res) => {
  const rows = db
    .prepare(
      `SELECT date(po.created_at) AS day, COUNT(*) AS po_count, SUM(po.total_amount) AS total_value
       FROM purchase_orders po WHERE po.status IN ('Approved','Printed','Closed')
       GROUP BY day ORDER BY day DESC`
    )
    .all();
  res.json(rows);
});

router.get('/supplier-purchase-analysis', requireAuth, requireRole(...PROCUREMENT_ROLES), (req, res) => {
  const rows = db
    .prepare(
      `SELECT s.id AS supplier_id, s.name, COUNT(po.id) AS po_count, SUM(po.total_amount) AS total_value
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.status IN ('Approved','Printed','Closed')
       GROUP BY s.id ORDER BY total_value DESC`
    )
    .all();
  res.json(rows);
});

router.get('/po-aging', requireAuth, requireRole(...PROCUREMENT_ROLES), (req, res) => {
  const rows = db
    .prepare(
      `SELECT po.po_number, s.name AS supplier_name, po.status, po.total_amount,
        CAST(julianday('now') - julianday(po.created_at) AS INTEGER) AS age_days
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.status NOT IN ('Closed','Rejected')
       ORDER BY age_days DESC`
    )
    .all();
  res.json(rows);
});

// Section 10: Inventory Reports
router.get('/stock-balance', requireAuth, requireRole(...INVENTORY_ROLES), (req, res) => {
  const scoped=scope(req as AuthedRequest);if(!scoped.ids.length)return res.json([]);
  res.json(
    db
      .prepare(
        `SELECT i.item_code, i.description, w.name AS warehouse_name, s.quantity
         FROM inventory_stock s JOIN items i ON i.id = s.item_id JOIN warehouses w ON w.id = s.warehouse_id
         WHERE s.quantity > 0 AND s.warehouse_id IN(${scoped.marks}) ORDER BY i.item_code`
      )
      .all(...scoped.ids)
  );
});

router.get('/fifo-valuation', requireAuth, requireRole(...INVENTORY_ROLES), (req, res) => {
  const scoped=scope(req as AuthedRequest);if(!scoped.ids.length)return res.json([]);
  res.json(db.prepare(`SELECT i.item_code,i.description,w.warehouse_code,w.name warehouse_name,SUM(il.quantity_remaining) quantity,ROUND(SUM(il.quantity_remaining*il.unit_cost),2) value FROM inventory_layers il JOIN items i ON i.id=il.item_id JOIN warehouses w ON w.id=il.warehouse_id WHERE il.quantity_remaining>0 AND il.warehouse_id IN(${scoped.marks}) GROUP BY i.id,w.id ORDER BY i.item_code,w.name`).all(...scoped.ids));
});

// Section 10: Consumption Reports (by employee, by department)
router.get('/consumption-by-employee', requireAuth, requireRole(...INVENTORY_ROLES), (req, res) => {
  const scoped=scope(req as AuthedRequest);if(!scoped.ids.length)return res.json([]);
  res.json(
    db
      .prepare(
        `SELECT e.employee_code, e.name AS employee_name, i.item_code, i.description,
          SUM(mii.quantity) AS total_quantity, SUM(mii.value) AS total_value
         FROM material_issue_items mii
         JOIN material_issues mi ON mi.id = mii.issue_id
         JOIN employees e ON e.id = mi.employee_id
         JOIN items i ON i.id = mii.item_id
         WHERE mi.status='Posted' AND mii.warehouse_id IN(${scoped.marks}) GROUP BY e.id, i.id ORDER BY e.name`
      )
      .all(...scoped.ids)
  );
});

router.get('/consumption-by-department', requireAuth, requireRole(...INVENTORY_ROLES), (req, res) => {
  const scoped=scope(req as AuthedRequest);if(!scoped.ids.length)return res.json([]);
  res.json(
    db
      .prepare(
        `SELECT d.name AS department_name, strftime('%Y-%m', mi.issue_date) AS month, SUM(mii.value) AS total_value
         FROM material_issue_items mii
         JOIN material_issues mi ON mi.id = mii.issue_id
         JOIN employees e ON e.id = mi.employee_id
         JOIN departments d ON d.id = e.department_id
         WHERE mi.status='Posted' AND mii.warehouse_id IN(${scoped.marks}) GROUP BY d.id, month ORDER BY month DESC`
      )
      .all(...scoped.ids)
  );
});

const WORKFORCE_ROLES=['SupplyChainManager'];
const workdaySql=`SELECT e.employee_code,e.name employee_name,d.name department_name,c.role_code,w.name warehouse_name,supervisor.name reports_to,supervisor.approval_role reporting_role,c.calendar_date,strftime('%w',c.calendar_date) day_number,s.shift_label,COALESCE(c.override_start_time,c.shift_start) start_time,COALESCE(c.override_end_time,c.shift_end) end_time,COALESCE((SELECT a.availability_status FROM employee_availability a WHERE a.employee_id=e.id AND c.calendar_date BETWEEN a.date_from AND a.date_to ORDER BY a.id DESC LIMIT 1),'Available') availability,c.day_type,h.holiday_name,c.assignment_source,c.status calendar_status FROM employee_work_calendar c JOIN employees e ON e.id=c.employee_id JOIN departments d ON d.id=c.department_id LEFT JOIN warehouses w ON w.id=c.warehouse_id LEFT JOIN employees supervisor ON supervisor.id=e.reports_to_employee_id LEFT JOIN shifts s ON s.id=c.shift_id LEFT JOIN holidays h ON h.id=c.holiday_id ORDER BY c.calendar_date,e.name`;
router.get(['/employee-workday','/employee-schedule','/combined-30-day-roster','/department-shift-roster'],requireAuth,requireRole(...WORKFORCE_ROLES),(_req,res)=>res.json(db.prepare(workdaySql).all()));
router.get('/employee-shift-distribution',requireAuth,requireRole(...WORKFORCE_ROLES),(_req,res)=>res.json(db.prepare(`SELECT e.employee_code,e.name employee_name,d.name department_name,c.role_code,SUM(s.shift_code='MORNING') morning_shifts,SUM(s.shift_code='AFTERNOON') afternoon_shifts,SUM(s.shift_code='EVENING') evening_shifts,SUM(c.day_type IN ('WORKDAY','HOLIDAY_WORKING')) workdays,SUM(c.day_type='OFF') off_days,SUM(c.day_type='HOLIDAY_WORKING') holiday_working,COUNT(c.shift_id) total_shifts,ROUND(100.0*SUM(s.shift_code='MORNING')/NULLIF(COUNT(c.shift_id),0),1) morning_pct,ROUND(100.0*SUM(s.shift_code='AFTERNOON')/NULLIF(COUNT(c.shift_id),0),1) afternoon_pct,ROUND(100.0*SUM(s.shift_code='EVENING')/NULLIF(COUNT(c.shift_id),0),1) evening_pct FROM employee_work_calendar c JOIN employees e ON e.id=c.employee_id JOIN departments d ON d.id=c.department_id LEFT JOIN shifts s ON s.id=c.shift_id GROUP BY e.id ORDER BY d.name,c.role_code,e.name`).all()));
router.get(['/shift-coverage','/understaffed-shifts','/uncovered-roles'],requireAuth,requireRole(...WORKFORCE_ROLES),(_req,res)=>res.json(db.prepare(`SELECT c.calendar_date,d.name department_name,c.role_code,s.shift_label,r.minimum_staff required_staff,COUNT(CASE WHEN c.day_type IN ('WORKDAY','HOLIDAY_WORKING') THEN 1 END) assigned_staff,COUNT(CASE WHEN c.day_type IN ('WORKDAY','HOLIDAY_WORKING') THEN 1 END)-r.minimum_staff variance,CASE WHEN COUNT(CASE WHEN c.day_type IN ('WORKDAY','HOLIDAY_WORKING') THEN 1 END)=0 THEN 'UNCOVERED ROLE' WHEN COUNT(CASE WHEN c.day_type IN ('WORKDAY','HOLIDAY_WORKING') THEN 1 END)<r.minimum_staff THEN 'UNDERSTAFFED' ELSE 'COVERED' END status FROM role_shift_requirements r JOIN departments d ON d.id=r.department_id JOIN shifts s ON s.id=r.shift_id LEFT JOIN employee_work_calendar c ON c.department_id=r.department_id AND c.role_code=r.role_code AND c.shift_id=r.shift_id AND c.calendar_date BETWEEN r.effective_from AND COALESCE(r.effective_to,'9999-12-31') WHERE r.active_yn=1 GROUP BY c.calendar_date,r.id ORDER BY c.calendar_date,d.name,c.role_code`).all()));
router.get('/employee-availability',requireAuth,requireRole(...WORKFORCE_ROLES),(_req,res)=>res.json(db.prepare(`SELECT e.employee_code,e.name employee_name,d.name department_name,e.approval_role role_code,a.date_from,a.date_to,a.availability_status,a.reason,a.remarks FROM employee_availability a JOIN employees e ON e.id=a.employee_id LEFT JOIN departments d ON d.id=e.department_id ORDER BY a.date_from DESC`).all()));
router.get('/availability-conflicts',requireAuth,requireRole('SupplyChainManager'),(_req,res)=>res.json(db.prepare(`SELECT e.employee_code,e.name employee_name,c.calendar_date,s.shift_label,a.availability_status,'Scheduled while unavailable' conflict FROM employee_work_calendar c JOIN employee_availability a ON a.employee_id=c.employee_id AND c.calendar_date BETWEEN a.date_from AND a.date_to JOIN employees e ON e.id=c.employee_id LEFT JOIN shifts s ON s.id=c.shift_id WHERE c.day_type IN ('WORKDAY','HOLIDAY_WORKING') AND a.availability_status<>'Available'`).all()));
router.get('/holiday-calendar',requireAuth,requireRole(...WORKFORCE_ROLES),(_req,res)=>res.json(db.prepare(`SELECT c.country_name,h.holiday_name,h.holiday_date,h.holiday_type,h.government_yn,h.statutory_yn,h.source,h.active_yn FROM holidays h JOIN countries c ON c.country_code=h.country_code ORDER BY h.holiday_date`).all()));
router.get('/holiday-working',requireAuth,requireRole(...WORKFORCE_ROLES),(_req,res)=>res.json(db.prepare(`SELECT h.holiday_name,c.calendar_date,d.name department_name,c.role_code,e.employee_code,e.name employee_name,s.shift_label,COALESCE(c.override_start_time,c.shift_start) start_time,COALESCE(c.override_end_time,c.shift_end) end_time FROM employee_work_calendar c JOIN holidays h ON h.id=c.holiday_id JOIN employees e ON e.id=c.employee_id JOIN departments d ON d.id=c.department_id LEFT JOIN shifts s ON s.id=c.shift_id WHERE c.day_type='HOLIDAY_WORKING'`).all()));
router.get('/calendar-adjustments',requireAuth,requireRole('SupplyChainManager'),(_req,res)=>res.json(db.prepare(`SELECT o.changed_at,u.full_name changed_by,e.employee_code,e.name employee_name,c.calendar_date,o.adjustment_reason,o.remarks,o.old_values,o.new_values FROM calendar_overrides o JOIN employee_work_calendar c ON c.id=o.calendar_entry_id JOIN employees e ON e.id=c.employee_id LEFT JOIN users u ON u.id=o.changed_by ORDER BY o.changed_at DESC`).all()));
router.get('/helper-assignments',requireAuth,requireRole('SupplyChainManager'),(_req,res)=>res.json(db.prepare(`SELECT e.employee_code helper_id,e.name helper_name,w.warehouse_code,w.name warehouse_name,sup.employee_code reporting_employee_id,sup.name reporting_employee,sup.approval_role reporting_role,e.status active_status,COALESCE((SELECT sh.shift_label FROM employee_work_calendar c LEFT JOIN shifts sh ON sh.id=c.shift_id WHERE c.employee_id=e.id AND c.calendar_date=date('now') LIMIT 1),'Off') current_shift,COALESCE((SELECT a.availability_status FROM employee_availability a WHERE a.employee_id=e.id AND date('now') BETWEEN a.date_from AND a.date_to ORDER BY a.id DESC LIMIT 1),'Available') availability FROM employees e JOIN warehouses w ON w.id=e.warehouse_id LEFT JOIN employees sup ON sup.id=e.reports_to_employee_id WHERE e.approval_role='Helper' AND e.deleted_at IS NULL ORDER BY w.name,e.name`).all()));
router.get('/helper-shift-distribution',requireAuth,requireRole('SupplyChainManager'),(_req,res)=>res.json(db.prepare(`SELECT e.employee_code helper_id,e.name helper_name,w.name warehouse_name,SUM(s.shift_code='MORNING') morning_count,SUM(s.shift_code='AFTERNOON') afternoon_count,SUM(s.shift_code='EVENING') evening_count,SUM(c.day_type='OFF') off_days,SUM(c.day_type='HOLIDAY_WORKING') holiday_working FROM employees e JOIN warehouses w ON w.id=e.warehouse_id LEFT JOIN employee_work_calendar c ON c.employee_id=e.id LEFT JOIN shifts s ON s.id=c.shift_id WHERE e.approval_role='Helper' AND e.deleted_at IS NULL GROUP BY e.id ORDER BY w.name,e.name`).all()));
router.get('/availability-impact',requireAuth,requireRole('SupplyChainManager'),(_req,res)=>res.json(db.prepare(`SELECT ra.created_at regeneration_date,ra.trigger_type,e.employee_code,e.name unavailable_employee,d.name department_name,w.name warehouse_name,ra.role_code,ra.affected_from unavailable_from,ra.affected_to unavailable_to,ra.reason,ra.assignments_changed original_assignments_affected,ra.coverage_warnings,u.full_name updated_by,ra.details_json FROM calendar_regeneration_audit ra LEFT JOIN employees e ON e.id=ra.employee_id LEFT JOIN departments d ON d.id=ra.department_id LEFT JOIN warehouses w ON w.id=ra.warehouse_id LEFT JOIN users u ON u.id=ra.created_by WHERE ra.trigger_type IN('EMPLOYEE_UNAVAILABLE','EMPLOYEE_RETURNED') ORDER BY ra.id DESC`).all()));
router.get('/calendar-regeneration',requireAuth,requireRole('SupplyChainManager'),(_req,res)=>res.json(db.prepare(`SELECT ra.created_at regeneration_date,ra.trigger_type,e.employee_code,e.name employee_name,d.name department_name,w.name warehouse_name,ra.role_code,ra.affected_from,ra.affected_to,ra.reason,ra.assignments_changed,ra.coverage_warnings,u.full_name changed_by FROM calendar_regeneration_audit ra LEFT JOIN employees e ON e.id=ra.employee_id LEFT JOIN departments d ON d.id=ra.department_id LEFT JOIN warehouses w ON w.id=ra.warehouse_id LEFT JOIN users u ON u.id=ra.created_by ORDER BY ra.id DESC`).all()));
router.get('/calendar-download-audit',requireAuth,requireRole('SupplyChainManager'),(_req,res)=>res.json(db.prepare(`SELECT a.created_at,a.action_type,a.format,a.department_scope,w.name warehouse_name,a.date_from,a.date_to,u.full_name generated_by FROM calendar_download_audit a LEFT JOIN warehouses w ON w.id=a.warehouse_id LEFT JOIN users u ON u.id=a.created_by ORDER BY a.id DESC`).all()));
router.get('/country-master',requireAuth,requireRole('SupplyChainManager'),(_req,res)=>res.json(db.prepare('SELECT country_name,iso_alpha2,iso_alpha3,default_currency_code,phone_code,active_yn FROM countries ORDER BY country_name').all()));
router.get('/currency-master',requireAuth,requireRole('SupplyChainManager'),(_req,res)=>res.json(db.prepare('SELECT currency_code,currency_name,currency_symbol,decimal_places,system_currency_yn,manual_currency_yn,active_yn FROM currencies ORDER BY currency_code').all()));
router.get('/exchange-rate-master',requireAuth,requireRole('SupplyChainManager'),(_req,res)=>res.json(db.prepare('SELECT from_currency,to_currency,rate,effective_date,expiry_date,source,manual_yn,active_yn FROM exchange_rates ORDER BY effective_date DESC').all()));
router.get('/duplicate-item-analysis',requireAuth,requireRole('SupplyChainManager','PurchaseManager','WarehouseManager'),(_req,res)=>res.json(db.prepare(`SELECT p.item_code primary_item_code,p.description primary_item_description,d.item_code possible_duplicate_item_code,d.description possible_duplicate_description,p.category,p.subcategory,p.uom,r.similarity_score,r.match_type,r.review_status status,COALESCE((SELECT SUM(quantity) FROM inventory_stock WHERE item_id=d.id),0) current_stock,COALESCE((SELECT SUM(pi.quantity) FROM po_items pi JOIN purchase_orders po ON po.id=pi.po_id WHERE pi.item_id=d.id AND po.status NOT IN('Closed','Rejected')),0) open_po_quantity,COALESCE((SELECT SUM(pri.quantity) FROM pr_items pri JOIN purchase_requisitions pr ON pr.id=pri.pr_id WHERE pri.item_id=d.id AND pr.status NOT IN('Closed','Rejected')),0) open_pr_quantity,(SELECT COUNT(*) FROM stock_ledger WHERE item_id=d.id) transaction_history,CASE WHEN r.match_type='Exact Duplicate' AND (SELECT COUNT(*) FROM stock_ledger WHERE item_id=d.id)=0 THEN 'Review for safe consolidation' WHEN r.match_type IN('Exact Duplicate','High Similarity') THEN 'Disable with canonical replacement after review' ELSE 'Review and keep both if specifications differ' END recommended_action,repl.item_code replacement_item_code FROM item_duplicate_reviews r JOIN items p ON p.id=r.primary_item_id JOIN items d ON d.id=r.possible_duplicate_item_id LEFT JOIN items repl ON repl.id=COALESCE(r.replacement_item_id,d.replacement_item_id) ORDER BY r.similarity_score DESC,r.id DESC`).all()));

router.get('/inventory-integrity',requireAuth,requireRole('SupplyChainManager'),(_req,res)=>res.json(db.prepare(`
  WITH keys AS (
    SELECT item_id,warehouse_id FROM inventory_stock
    UNION SELECT item_id,warehouse_id FROM inventory_layers
    UNION SELECT item_id,warehouse_id FROM stock_ledger
  ), totals AS (
    SELECT k.item_id,k.warehouse_id,
      COALESCE((SELECT SUM(quantity_change) FROM stock_ledger l WHERE l.item_id=k.item_id AND l.warehouse_id=k.warehouse_id),0) ledger_quantity,
      COALESCE((SELECT SUM(quantity) FROM inventory_stock s WHERE s.item_id=k.item_id AND s.warehouse_id=k.warehouse_id),0) warehouse_quantity,
      COALESCE((SELECT SUM(quantity_remaining) FROM inventory_layers f WHERE f.item_id=k.item_id AND f.warehouse_id=k.warehouse_id),0) fifo_quantity,
      COALESCE((SELECT SUM(quantity_change*unit_cost) FROM stock_ledger l WHERE l.item_id=k.item_id AND l.warehouse_id=k.warehouse_id),0) ledger_value,
      COALESCE((SELECT SUM(quantity_remaining*unit_cost) FROM inventory_layers f WHERE f.item_id=k.item_id AND f.warehouse_id=k.warehouse_id),0) fifo_value,
      (SELECT MAX(created_at) FROM stock_ledger l WHERE l.item_id=k.item_id AND l.warehouse_id=k.warehouse_id) last_transaction
    FROM keys k
  )
  SELECT i.item_code,i.description,w.warehouse_code,w.name warehouse_name,t.ledger_quantity,t.warehouse_quantity,t.fifo_quantity,
    ROUND(t.warehouse_quantity-t.fifo_quantity,4) quantity_difference,ROUND(t.ledger_value-t.fifo_value,2) value_difference,t.last_transaction,
    CASE WHEN ABS(t.warehouse_quantity-t.fifo_quantity)>.0001 OR t.warehouse_quantity<0 OR t.fifo_quantity<0 THEN 'CRITICAL' WHEN ABS(t.ledger_quantity-t.warehouse_quantity)>.0001 THEN 'WARNING' ELSE 'PASS' END severity
  FROM totals t JOIN items i ON i.id=t.item_id JOIN warehouses w ON w.id=t.warehouse_id
  ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END,i.item_code,w.name
`).all()));

router.get('/duplicate-master-data',requireAuth,requireRole('SupplyChainManager'),(_req,res)=>res.json(db.prepare(`
  SELECT 'Item' master_type,lower(trim(description)) duplicate_key,COUNT(*) record_count,GROUP_CONCAT(item_code,', ') record_codes,'Review descriptions and specifications before disabling a duplicate' recommended_action FROM items WHERE deleted_at IS NULL GROUP BY lower(trim(description)) HAVING COUNT(*)>1
  UNION ALL SELECT 'Supplier',lower(trim(name)),COUNT(*),GROUP_CONCAT(supplier_code,', '),'Compare registration, tax, phone and email before disabling a duplicate' FROM suppliers WHERE deleted_at IS NULL GROUP BY lower(trim(name)) HAVING COUNT(*)>1
  UNION ALL SELECT 'Employee',lower(trim(name)),COUNT(*),GROUP_CONCAT(employee_code,', '),'Verify identity and employment number; never merge transaction history automatically' FROM employees WHERE deleted_at IS NULL GROUP BY lower(trim(name)) HAVING COUNT(*)>1
  ORDER BY master_type,duplicate_key
`).all()));

router.get('/segregation-of-duties',requireAuth,requireRole('SupplyChainManager'),(_req,res)=>{
  const users=db.prepare(`SELECT u.id,u.employee_id,u.username,u.full_name,u.role,e.employee_code,e.permission_keys,w.name warehouse_name FROM users u LEFT JOIN employees e ON e.id=u.employee_id LEFT JOIN warehouses w ON w.id=e.warehouse_id WHERE u.deleted_at IS NULL AND u.is_active=1`).all() as any[];
  const risky=[['Vendor maintenance + PO approval','vendor.edit','po.approve'],['GRN posting + invoice verification','grn.post','task.invoices'],['Material issue + adjustment approval','issue.post','adjustment.approve'],['PO creation + approval','po.create','po.approve']];
  const rows:any[]=[];
  const add=db.prepare(`INSERT OR IGNORE INTO sod_conflict_reviews(conflict_key,user_id,employee_id,permission_a,permission_b,conflict_description,risk,recommended_action) VALUES(?,?,?,?,?,?,?,?)`);
  for(const user of users){let permissions:string[];try{permissions=user.permission_keys?JSON.parse(user.permission_keys):defaultsForRole(user.role);}catch{permissions=defaultsForRole(user.role);}if(user.role==='PurchaseOfficer'&&permissions.includes('po.approve'))rows.push({employee_code:user.employee_code,employee_name:user.full_name,username:user.username,role:user.role,warehouse_name:user.warehouse_name,conflict:'PO approval within authoritative employee limit with self-approval prohibited',severity:'APPROVED BUSINESS RULE',permission_a:'po.create',permission_b:'po.approve',review_status:'APPROVED BUSINESS RULE',recommended_action:'Retain backend limit, sequence, and self-approval enforcement'});if(user.role==='Storekeeper'&&permissions.includes('issue.post'))rows.push({employee_code:user.employee_code,employee_name:user.full_name,username:user.username,role:user.role,warehouse_name:user.warehouse_name,conflict:'Material Issue within assigned warehouse and authorization limit',severity:'APPROVED BUSINESS RULE',permission_a:'issue.create',permission_b:'issue.post',review_status:'APPROVED BUSINESS RULE',recommended_action:'Retain warehouse, limit, FIFO, period, and audit enforcement'});for(const [conflict,a,b] of risky)if(permissions.includes(a)&&permissions.includes(b)&&!(conflict==='PO creation + approval'&&user.role==='PurchaseOfficer')){const key=`USER-${user.id}:${a}:${b}`;const risk=user.role==='SupplyChainManager'?'Management concentration - review':'High unauthorized concentration risk';add.run(key,user.id,user.employee_id,a,b,conflict,risk,'Confirm documented authorization and compensating independent review');const review=db.prepare('SELECT * FROM sod_conflict_reviews WHERE conflict_key=?').get(key) as any;rows.push({employee_code:user.employee_code,employee_name:user.full_name,username:user.username,role:user.role,warehouse_name:user.warehouse_name,conflict,severity:user.role==='SupplyChainManager'?'MANAGEMENT CONCENTRATION REVIEW':'HIGH',permission_a:a,permission_b:b,business_justification:review?.business_justification,management_decision:review?.management_decision,compensating_control:review?.compensating_control,review_date:review?.review_date,review_status:review?.status,recommended_action:review?.recommended_action});}}
  res.json(rows);
});

router.get('/system-integrity-summary',requireAuth,requireRole('SupplyChainManager'),(_req,res)=>{
  const scalar=(sql:string)=>Number((db.prepare(sql).get() as any)?.count||0);
  const rows=[
    {control:'SQLite foreign-key integrity',finding_count:(db.pragma('foreign_key_check') as any[]).length},
    {control:'Negative inventory balances',finding_count:scalar('SELECT COUNT(*) count FROM inventory_stock WHERE quantity<0')},
    {control:'FIFO reconciliation differences',finding_count:scalar(`SELECT COUNT(*) count FROM (SELECT s.item_id,s.warehouse_id,s.location_id,SUM(s.quantity) stock_qty,COALESCE((SELECT SUM(f.quantity_remaining) FROM inventory_layers f WHERE f.item_id=s.item_id AND f.warehouse_id=s.warehouse_id AND f.location_id IS s.location_id),0) fifo_qty FROM inventory_stock s GROUP BY s.item_id,s.warehouse_id,s.location_id HAVING ABS(stock_qty-fifo_qty)>.0001)`)},
    {control:'Duplicate PR/PO/GRN numbers',finding_count:scalar(`SELECT COUNT(*) count FROM (SELECT pr_number n FROM purchase_requisitions GROUP BY pr_number HAVING COUNT(*)>1 UNION ALL SELECT po_number FROM purchase_orders GROUP BY po_number HAVING COUNT(*)>1 UNION ALL SELECT grn_number FROM grns GROUP BY grn_number HAVING COUNT(*)>1)`)},
    {control:'Invalid GRN quantity splits',finding_count:scalar('SELECT COUNT(*) count FROM grn_items WHERE ABS(quantity_received-accepted_qty-rejected_qty)>.0001')},
    {control:'External handoff package control exceptions',finding_count:scalar("SELECT COUNT(*) count FROM invoices WHERE finance_pack_status='Ready for Finance - External Process' AND (COALESCE(source_documents_match,1)<>1 OR ABS(COALESCE(adjusted_invoice_total,invoice_total)-COALESCE((SELECT total_amount FROM purchase_orders WHERE id=invoices.po_id),0))>.011)")},
    {control:'Broken attachment file references',finding_count:scalar("SELECT COUNT(*) count FROM document_attachments WHERE trim(COALESCE(stored_name,''))=''")},
  ];
  res.json(rows.map(row=>({...row,status:row.finding_count?'FAIL':'PASS'})));
});
router.get('/bin-stock',requireAuth,requireRole(...INVENTORY_ROLES),(req:AuthedRequest,res)=>{const s=scope(req);if(!s.ids.length)return res.json([]);res.json(db.prepare(`SELECT w.name warehouse_name,l.code bin_code,l.label bin_label,i.item_code,i.description,i.uom,ROUND(SUM(st.quantity),4) quantity,ROUND(COALESCE((SELECT SUM(il.quantity_remaining*il.unit_cost) FROM inventory_layers il WHERE il.item_id=st.item_id AND il.warehouse_id=st.warehouse_id AND il.location_id IS st.location_id),0),2) value FROM inventory_stock st JOIN items i ON i.id=st.item_id JOIN warehouses w ON w.id=st.warehouse_id LEFT JOIN locations l ON l.id=st.location_id WHERE st.warehouse_id IN (${s.marks}) GROUP BY st.item_id,st.warehouse_id,st.location_id ORDER BY w.name,l.code,i.item_code`).all(...s.ids));});
router.get('/invoice-register',requireAuth,requireRole(...PROCUREMENT_ROLES),(_req,res)=>res.json(db.prepare(`SELECT inv.invoice_date,inv.invoice_number,s.name supplier_name,po.po_number,inv.transaction_currency currency,ROUND(inv.invoice_total,2) invoice_total,ROUND(inv.tax,2) tax,inv.match_status,inv.finance_pack_status FROM invoices inv JOIN suppliers s ON s.id=inv.supplier_id JOIN purchase_orders po ON po.id=inv.po_id ORDER BY inv.invoice_date,inv.id`).all()));
router.get('/po-vs-grn',requireAuth,requireRole(...PROCUREMENT_ROLES),(_req,res)=>res.json(db.prepare(`SELECT po.po_number,i.item_code,i.description,pi.quantity ordered_quantity,ROUND(COALESCE(SUM(gi.accepted_qty),0),4) accepted_quantity,ROUND(pi.quantity-COALESCE(SUM(gi.accepted_qty),0),4) outstanding_quantity,ROUND(pi.quantity*pi.price*(1+pi.tax/100.0),2) po_value,ROUND(COALESCE(SUM(gi.accepted_qty*gi.unit_cost*(1+pi.tax/100.0)),0),2) grn_value FROM po_items pi JOIN purchase_orders po ON po.id=pi.po_id JOIN items i ON i.id=pi.item_id LEFT JOIN grns g ON g.po_id=po.id LEFT JOIN grn_items gi ON gi.grn_id=g.id AND gi.item_id=pi.item_id GROUP BY pi.id ORDER BY po.po_number,i.item_code`).all()));
router.get('/po-vs-invoice',requireAuth,requireRole(...PROCUREMENT_ROLES),(_req,res)=>res.json(db.prepare(`SELECT po.po_number,s.name supplier_name,po.transaction_currency currency,ROUND(po.total_amount,2) po_total,ROUND(COALESCE(SUM(inv.invoice_total),0),2) invoice_total,ROUND(COALESCE(SUM(inv.invoice_total),0)-po.total_amount,2) difference,COUNT(inv.id) invoice_count FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id LEFT JOIN invoices inv ON inv.po_id=po.id GROUP BY po.id ORDER BY po.po_number`).all()));
router.get('/grn-vs-invoice',requireAuth,requireRole(...PROCUREMENT_ROLES),(_req,res)=>res.json(db.prepare(`SELECT po.po_number,GROUP_CONCAT(DISTINCT g.grn_number) grn_numbers,MAX(inv.invoice_number) invoice_number,ROUND(COALESCE((SELECT SUM(gi.accepted_qty*gi.unit_cost*(1+pi.tax/100.0)) FROM grn_items gi JOIN grns gx ON gx.id=gi.grn_id JOIN po_items pi ON pi.po_id=gx.po_id AND pi.item_id=gi.item_id WHERE gx.po_id=po.id),0),2) grn_value,ROUND(COALESCE(MAX(inv.invoice_total),0),2) invoice_total,ROUND(COALESCE(MAX(inv.invoice_total),0)-COALESCE((SELECT SUM(gi.accepted_qty*gi.unit_cost*(1+pi.tax/100.0)) FROM grn_items gi JOIN grns gx ON gx.id=gi.grn_id JOIN po_items pi ON pi.po_id=gx.po_id AND pi.item_id=gi.item_id WHERE gx.po_id=po.id),0),2) difference FROM purchase_orders po LEFT JOIN grns g ON g.po_id=po.id LEFT JOIN invoices inv ON inv.po_id=po.id GROUP BY po.id ORDER BY po.po_number`).all()));
router.get('/three-way-match',requireAuth,requireRole(...PROCUREMENT_ROLES),(_req,res)=>res.json(db.prepare(`SELECT inv.invoice_number,po.po_number,s.name supplier_name,ROUND(po.total_amount,2) po_total,ROUND(COALESCE((SELECT SUM(gi.accepted_qty*gi.unit_cost*(1+pi.tax/100.0)) FROM grn_items gi JOIN grns g ON g.id=gi.grn_id JOIN po_items pi ON pi.po_id=g.po_id AND pi.item_id=gi.item_id WHERE g.po_id=po.id),0),2) grn_total,ROUND(inv.invoice_total,2) invoice_total,ROUND(COALESCE(inv.adjusted_invoice_total,inv.invoice_total)-po.total_amount,2) difference,inv.reconciliation_classification,inv.match_status FROM invoices inv JOIN purchase_orders po ON po.id=inv.po_id JOIN suppliers s ON s.id=inv.supplier_id ORDER BY inv.invoice_date,inv.id`).all()));
router.get('/legacy-ledger-reconciliation',requireAuth,requireRole('SupplyChainManager'),(_req,res)=>res.json(db.prepare(`SELECT r.id warning_id,i.item_code,i.description item_name,w.name warehouse_name,l.code bin_code,r.current_quantity,r.fifo_quantity,r.ledger_quantity,r.quantity_difference,r.current_value,r.ledger_value,r.value_difference,r.earliest_relevant_transaction,r.earliest_ledger_transaction,r.opening_balance_record,r.root_cause_classification,r.supporting_evidence,r.financial_impact,r.inventory_impact,r.risk_level,r.recommended_resolution,r.approval_required,r.resolution_status,r.reviewed_at,r.approved_at FROM legacy_ledger_reconciliation r JOIN items i ON i.id=r.item_id JOIN warehouses w ON w.id=r.warehouse_id LEFT JOIN locations l ON l.id=r.location_id ORDER BY r.resolution_status,r.risk_level,r.id`).all()));
router.get('/warehouse-access-verification',requireAuth,requireRole('SupplyChainManager'),(_req,res)=>res.json(db.prepare(`SELECT report_api,test_name,test_user,assigned_warehouse,requested_warehouse,expected_result,actual_result,status,evidence,executed_at FROM control_test_results WHERE test_suite='WAREHOUSE_ACCESS' ORDER BY id`).all()));
router.get('/audit-finding-closure',requireAuth,requireRole('SupplyChainManager'),(_req,res)=>res.json(db.prepare(`SELECT finding_id,original_audit_date,severity,module,issue,root_cause,remediation,testing_performed,evidence,resolution_date,status,residual_risk,management_decision FROM audit_finding_closure ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,finding_id`).all()));
router.get('/backup-restore-history',requireAuth,requireRole('SupplyChainManager'),(_req,res)=>res.json(db.prepare(`SELECT backup_reference,backup_type,created_at backup_date,backup_status,database_included,attachments_included,configuration_included,restore_tested,restore_test_date,restore_result,notes FROM backup_restore_history ORDER BY id DESC`).all()));
router.get('/audit-control-center',requireAuth,requireRole('SupplyChainManager'),(_req,res)=>{
 const count=(sql:string,...args:any[])=>Number((db.prepare(sql).get(...args)as any)?.n||0),lastBackup=db.prepare('SELECT * FROM backup_restore_history ORDER BY id DESC LIMIT 1').get()as any;
 const cards=[
  {control:'Database Structural Integrity',status:(db.pragma('integrity_check')as any[]).every(r=>r.integrity_check==='ok')?'PASS':'FAIL',findings:0,report:'system-integrity-summary'},
  {control:'Referential Integrity',status:(db.pragma('foreign_key_check')as any[]).length?'FAIL':'PASS',findings:(db.pragma('foreign_key_check')as any[]).length,report:'system-integrity-summary'},
  {control:'Current Stock vs FIFO',status:count(`SELECT COUNT(*) n FROM (SELECT s.item_id,s.warehouse_id,s.location_id,SUM(s.quantity) q,COALESCE((SELECT SUM(f.quantity_remaining) FROM inventory_layers f WHERE f.item_id=s.item_id AND f.warehouse_id=s.warehouse_id AND f.location_id IS s.location_id),0) fq FROM inventory_stock s GROUP BY s.item_id,s.warehouse_id,s.location_id HAVING ABS(q-fq)>.0001)`)?'FAIL':'PASS',findings:0,report:'inventory-integrity'},
  {control:'Historical Ledger Reconciliation',status:count("SELECT COUNT(*) n FROM legacy_ledger_reconciliation WHERE resolution_status='UNDER INVESTIGATION'")?'WARNING':'PASS',findings:count("SELECT COUNT(*) n FROM legacy_ledger_reconciliation WHERE resolution_status='UNDER INVESTIGATION'"),report:'legacy-ledger-reconciliation'},
  {control:'Warehouse Security',status:count("SELECT COUNT(*) n FROM control_test_results WHERE test_suite='WAREHOUSE_ACCESS' AND status='FAIL'")?'FAIL':count("SELECT COUNT(*) n FROM control_test_results WHERE test_suite='WAREHOUSE_ACCESS'")?'PASS':'NOT TESTED',findings:count("SELECT COUNT(*) n FROM control_test_results WHERE test_suite='WAREHOUSE_ACCESS' AND status='FAIL'"),report:'warehouse-access-verification'},
  {control:'Segregation of Duties',status:count("SELECT COUNT(*) n FROM sod_conflict_reviews WHERE risk LIKE 'High%' AND status='REQUIRES MANAGEMENT REVIEW'")?'WARNING':'PASS',findings:count("SELECT COUNT(*) n FROM sod_conflict_reviews WHERE risk LIKE 'High%' AND status='REQUIRES MANAGEMENT REVIEW'"),report:'segregation-of-duties'},
  {control:'Duplicate Master Data',status:count("SELECT COUNT(*) n FROM item_duplicate_reviews WHERE review_status='Pending Review'")?'WARNING':'PASS',findings:count("SELECT COUNT(*) n FROM item_duplicate_reviews WHERE review_status='Pending Review'"),report:'duplicate-master-data'},
  {control:'Three-Way Match Exceptions',status:count("SELECT COUNT(*) n FROM invoices WHERE match_status='Variance'")?'WARNING':'PASS',findings:count("SELECT COUNT(*) n FROM invoices WHERE match_status='Variance'"),report:'finance-payment-verification'},
  {control:'Attachments',status:count("SELECT COUNT(*) n FROM document_attachments WHERE trim(COALESCE(stored_name,''))=''")?'FAIL':'PASS',findings:count("SELECT COUNT(*) n FROM document_attachments WHERE trim(COALESCE(stored_name,''))=''"),report:'system-integrity-summary'},
  {control:'Backup Status',status:lastBackup?.backup_status==='Completed'?'PASS':'WARNING',findings:lastBackup?0:1,report:'backup-restore-history'},
  {control:'Restore Test',status:!lastBackup?'NOT TESTED':lastBackup.restore_result==='PASS'?'PASS':lastBackup.restore_tested?'FAIL':'NOT TESTED',findings:0,report:'backup-restore-history'},
  {control:'Report Accuracy',status:count("SELECT COUNT(*) n FROM control_test_results WHERE test_suite='REPORT_ACCURACY_PHASE3'")<6?'NOT TESTED':count("SELECT COUNT(*) n FROM control_test_results WHERE test_suite='REPORT_ACCURACY_PHASE3' AND status='FAIL'")?'FAIL':'PASS',findings:count("SELECT COUNT(*) n FROM control_test_results WHERE test_suite='REPORT_ACCURACY_PHASE3' AND status<>'PASS'"),report:'audit-finding-closure'},
  {control:'Document Revision Control',status:count("SELECT COUNT(*) n FROM control_test_results WHERE test_suite='DOCUMENT_REVISION' AND status='PASS'")?'PASS':'NOT TESTED',findings:count("SELECT COUNT(*) n FROM control_test_results WHERE test_suite='DOCUMENT_REVISION' AND status='FAIL'"),report:'audit-finding-closure'},
  {control:'Accounting Period Control',status:count("SELECT COUNT(*) n FROM control_test_results WHERE test_suite='ACCOUNTING_PERIOD' AND status='PASS'")?'PASS':'NOT TESTED',findings:count("SELECT COUNT(*) n FROM control_test_results WHERE test_suite='ACCOUNTING_PERIOD' AND status='FAIL'"),report:'audit-finding-closure'},
  ...['WORKFLOW_REGRESSION','CONCURRENCY','SECURITY_REGRESSION'].map(s=>{const total=count('SELECT COUNT(*) n FROM control_test_results WHERE test_suite=?',s),fail=count("SELECT COUNT(*) n FROM control_test_results WHERE test_suite=? AND status='FAIL'",s);return{control:s.split('_').map(x=>x[0]+x.slice(1).toLowerCase()).join(' '),status:!total?'NOT TESTED':fail?'FAIL':'PASS',findings:fail,report:'audit-finding-closure'}})
 ];res.json(cards);
});

export default router;
