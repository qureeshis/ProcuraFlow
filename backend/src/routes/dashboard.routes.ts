import { Router } from 'express';
import db from '../db';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { currentValuation } from '../utils/fifo';
import { requireRole,maxApprovalFor } from '../middleware/rbac';
import { schedulingKpis } from '../utils/workCalendar';
import { authorizedWarehouseIds } from '../utils/warehouseAccess';
import { canUserApprove } from '../utils/approvalRouting';

const router = Router();

const PAGE_ACTIONS: Record<string, string> = {
  '/': 'Reviewing the executive dashboard', '/quick-start': 'Viewing the quick-start guide',
  '/masters/departments': 'Managing departments', '/masters/employees': 'Managing employee records',
  '/masters/suppliers': 'Managing suppliers', '/masters/items': 'Managing item master data',
  '/masters/warehouses': 'Managing warehouses and locations', '/masters/settings': 'Configuring system settings',
  '/masters/import-data': 'Importing master or opening data', '/procurement/pr': 'Working on purchase requisitions',
  '/warehouse/pr': 'Working on purchase requisitions', '/procurement/rfq': 'Working on RFQs and quotations',
  '/procurement/po': 'Working on purchase orders', '/procurement/invoices': 'Working on invoices and three-way matching',
  '/warehouse/grn': 'Working on goods receipts', '/warehouse/issue': 'Working on material issues',
  '/warehouse/returns': 'Working on returns', '/warehouse/transfers': 'Working on warehouse transfers',
  '/warehouse/adjustments': 'Working on stock adjustments', '/inventory/stock': 'Reviewing real-time stock',
  '/inventory/valuation': 'Reviewing FIFO valuation', '/inventory/expiry': 'Reviewing expiry-controlled inventory',
  '/inventory/abc': 'Reviewing ABC classification', '/inventory/dead-stock': 'Reviewing dead stock',
  '/inventory/cycle-count': 'Working on cycle counts', '/advanced/tools': 'Managing tools',
  '/advanced/vendor-scorecard': 'Reviewing vendor scorecards', '/reports': 'Viewing operational reports',
  '/help': 'Reading the user guide', '/live-user-activity': 'Monitoring live user activity',
};

router.post('/activity/heartbeat', requireAuth, (req: AuthedRequest, res) => {
  const pagePath = String(req.body?.page_path || '/').split('?')[0];
  const action = PAGE_ACTIONS[pagePath] || 'Working in ProcuraFlow';
  const prior = db.prepare('SELECT page_path FROM user_activity WHERE user_id=?').get(req.user!.id) as {page_path?:string}|undefined;
  db.transaction(()=>{
    db.prepare(`INSERT INTO user_activity (user_id,last_seen,page_path,current_action,ip_address,user_agent)
      VALUES (?,datetime('now'),?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
      last_seen=datetime('now'),page_path=excluded.page_path,current_action=excluded.current_action,
      ip_address=excluded.ip_address,user_agent=excluded.user_agent`)
      .run(req.user!.id, pagePath, action, req.ip || null, String(req.headers['user-agent'] || '').slice(0, 300));
    // Store only meaningful page transitions, not every 15-second heartbeat.
    if (!prior || prior.page_path !== pagePath) {
      const identity=db.prepare(`SELECT u.full_name,u.username,u.role,d.name department_name,w.name warehouse_name FROM users u LEFT JOIN employees e ON e.id=u.employee_id LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN warehouses w ON w.id=COALESCE(u.warehouse_id,e.warehouse_id) WHERE u.id=?`).get(req.user!.id) as any;
      db.prepare(`INSERT INTO user_activity_log (user_id,full_name,username,role,department_name,warehouse_name,event_type,current_action,page_path,ip_address) VALUES (?,?,?,?,?,?,'Page View',?,?,?)`).run(req.user!.id,identity.full_name,identity.username,identity.role,identity.department_name||null,identity.warehouse_name||null,action,pagePath,req.ip||null);
    }
  })();
  res.json({ success: true });
});

router.post('/activity/logout', requireAuth, (req: AuthedRequest, res) => {
  db.transaction(()=>{db.prepare("UPDATE user_activity SET last_seen=datetime('now','-1 day'),current_action='Signed out' WHERE user_id=?").run(req.user!.id);const identity=db.prepare(`SELECT u.full_name,u.username,u.role,d.name department_name,w.name warehouse_name FROM users u LEFT JOIN employees e ON e.id=u.employee_id LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN warehouses w ON w.id=COALESCE(u.warehouse_id,e.warehouse_id) WHERE u.id=?`).get(req.user!.id) as any;db.prepare(`INSERT INTO user_activity_log (user_id,full_name,username,role,department_name,warehouse_name,event_type,current_action,page_path,ip_address) VALUES (?,?,?,?,?,?,'Logout','Signed out',NULL,?)`).run(req.user!.id,identity.full_name,identity.username,identity.role,identity.department_name||null,identity.warehouse_name||null,req.ip||null);})();
  res.json({ success: true });
});

router.get('/activity/live', requireAuth, requireRole('SupplyChainManager'), (_req, res) => {
  const rows = db.prepare(`SELECT u.id,u.full_name,u.username,u.role,u.is_active,u.locked_reason,
    e.employee_code,d.name department_name,w.name warehouse_name,a.last_seen,a.page_path,a.current_action,
    CASE WHEN a.last_seen IS NULL OR (julianday('now')-julianday(a.last_seen))*86400>300 THEN 'Offline'
         WHEN (julianday('now')-julianday(a.last_seen))*86400>60 THEN 'Away' ELSE 'Online' END activity_status,
    MAX(0,CAST((julianday('now')-julianday(a.last_seen))*86400 AS INTEGER)) seconds_since_activity
    FROM users u LEFT JOIN employees e ON e.id=u.employee_id LEFT JOIN departments d ON d.id=e.department_id
    LEFT JOIN warehouses w ON w.id=COALESCE(u.warehouse_id,e.warehouse_id) LEFT JOIN user_activity a ON a.user_id=u.id
    WHERE u.deleted_at IS NULL ORDER BY CASE WHEN activity_status='Online' THEN 0 WHEN activity_status='Away' THEN 1 ELSE 2 END,a.last_seen DESC,u.full_name`).all();
  res.json({ generated_at: new Date().toISOString(), users: rows });
});

function monthLabel(month: string) {
  if (!month) return '—';
  const [year, monthNum] = month.split('-');
  const date = new Date(Number(year), Number(monthNum) - 1, 1);
  return date.toLocaleDateString('en', { month: 'short' });
}

// Section 10: Executive Dashboard KPIs
router.get('/kpis', requireAuth, (req: AuthedRequest, res) => {
  const company = db.prepare('SELECT name, logo_url, financial_year FROM company ORDER BY id DESC LIMIT 1').get() as any;
  const items = db.prepare('SELECT * FROM items WHERE deleted_at IS NULL').all() as any[];
  const totalInventoryValue = items.reduce((sum, item) => sum + currentValuation(item.id).totalValue, 0);

  const monthlyPurchase = (db
    .prepare(
      `SELECT COALESCE(SUM(total_amount),0) AS v FROM purchase_orders
       WHERE status IN ('Approved','Printed','Closed') AND strftime('%Y-%m', created_at) = strftime('%Y-%m','now')`
    )
    .get() as any).v;

  const monthlyConsumption = (db
    .prepare(
      `SELECT COALESCE(SUM(mii.value),0) AS v FROM material_issue_items mii
       JOIN material_issues mi ON mi.id = mii.issue_id
       WHERE strftime('%Y-%m', mi.issue_date) = strftime('%Y-%m','now')`
    )
    .get() as any).v;

  const lowStockItems = items.filter((item) => {
    const v = currentValuation(item.id);
    return v.totalQty <= item.reorder_level;
  }).length;

  const pendingApprovals = (db
    .prepare(`SELECT COUNT(*) AS c FROM purchase_orders WHERE status = 'PendingApproval'`)
    .get() as any).c;

  const supplierCount = (db.prepare('SELECT COUNT(*) AS c FROM suppliers WHERE deleted_at IS NULL').get() as any).c;
  const avgSupplierRating = (db.prepare('SELECT AVG(rating) AS a FROM suppliers WHERE deleted_at IS NULL').get() as any).a;

  const purchaseTrend = (db
    .prepare(
      `SELECT strftime('%Y-%m', created_at) AS month, COALESCE(SUM(total_amount),0) AS total_value
       FROM purchase_orders
       WHERE status IN ('Approved','Printed','Closed')
       GROUP BY month ORDER BY month DESC LIMIT 6`
    )
    .all() as any[])
    .reverse()
    .map((row) => ({ label: monthLabel(row.month), value: Number(row.total_value || 0) }));

  const consumptionTrend = (db
    .prepare(
      `SELECT strftime('%Y-%m', mi.issue_date) AS month, COALESCE(SUM(mii.value),0) AS total_value
       FROM material_issue_items mii
       JOIN material_issues mi ON mi.id = mii.issue_id
       GROUP BY month ORDER BY month DESC LIMIT 6`
    )
    .all() as any[])
    .reverse()
    .map((row) => ({ label: monthLabel(row.month), value: Number(row.total_value || 0) }));

  const departmentConsumption = (db
    .prepare(
      `SELECT d.name AS department_name, COALESCE(SUM(mii.value),0) AS total_value
       FROM material_issue_items mii
       JOIN material_issues mi ON mi.id = mii.issue_id
       JOIN employees e ON e.id = mi.employee_id
       JOIN departments d ON d.id = e.department_id
       GROUP BY d.id ORDER BY total_value DESC LIMIT 6`
    )
    .all() as any[]);

  const warehouseValues = (db
    .prepare(
      `SELECT w.name AS warehouse_name, COALESCE(SUM(s.quantity * COALESCE(i.standard_cost, i.last_purchase_price, 0)),0) AS total_value
       FROM inventory_stock s
       JOIN items i ON i.id = s.item_id
       JOIN warehouses w ON w.id = s.warehouse_id
       GROUP BY w.id ORDER BY total_value DESC LIMIT 6`
    )
    .all() as any[]);
  const executiveCounts=db.prepare(`SELECT
   (SELECT COUNT(*) FROM purchase_requisitions WHERE status='Submitted') open_prs,
   (SELECT COUNT(*) FROM purchase_requisitions pr WHERE pr.status='Submitted' AND NOT EXISTS(SELECT 1 FROM approval_log al WHERE al.document_type='PR' AND al.document_id=pr.id AND al.decision IN('Approved','Rejected'))) pending_pr_approvals,
   (SELECT COUNT(*) FROM purchase_orders WHERE status NOT IN('Closed','Rejected','Draft')) open_pos,
   (SELECT COALESCE(SUM(base_currency_amount),SUM(total_amount),0) FROM purchase_orders WHERE status NOT IN('Closed','Rejected','Draft')) outstanding_po_value,
   (SELECT COUNT(*) FROM purchase_orders WHERE status NOT IN('Closed','Rejected','Draft') AND committed_delivery_date<date('now')) overdue_pos,
   (SELECT COUNT(*) FROM items i WHERE i.deleted_at IS NULL AND i.active_yn=1 AND COALESCE((SELECT SUM(quantity) FROM inventory_stock WHERE item_id=i.id),0)<=0) out_of_stock_items,
   (SELECT COUNT(*) FROM items WHERE deleted_at IS NULL AND active_yn=0) inactive_items,
   (SELECT COUNT(*) FROM items WHERE deleted_at IS NULL AND active_yn=1 AND COALESCE(reorder_level,0)<=0) items_missing_reorder_level,
   (SELECT COUNT(*) FROM invoices WHERE match_status='Pending') invoices_pending,
   (SELECT COUNT(*) FROM invoices WHERE match_status='Matched') matched_invoices,
   (SELECT COUNT(*) FROM invoices WHERE match_status='Variance') invoice_exceptions,
   (SELECT COUNT(*) FROM item_duplicate_reviews WHERE review_status='Pending Review') potential_duplicate_items,
   (SELECT COUNT(*) FROM employee_work_calendar c JOIN employees e ON e.id=c.employee_id WHERE e.approval_role='Helper' AND c.calendar_date=date('now') AND c.day_type IN('WORKDAY','HOLIDAY_WORKING')) helpers_scheduled_today,
   (SELECT COUNT(DISTINCT employee_id) FROM employee_availability WHERE date('now') BETWEEN date_from AND date_to AND availability_status<>'Available') employees_unavailable_today`).get() as any;
  const poStatusDistribution=db.prepare(`SELECT status label,COUNT(*) value FROM purchase_orders GROUP BY status ORDER BY value DESC`).all();
  const invoiceMatchTrend=db.prepare(`SELECT strftime('%Y-%m',created_at) month,SUM(match_status='Matched') matched,SUM(match_status='Variance') exceptions,SUM(match_status='Pending') pending FROM invoices GROUP BY month ORDER BY month DESC LIMIT 6`).all().reverse();
  const stockMovementTrend=db.prepare(`SELECT strftime('%Y-%m',created_at) month,SUM(CASE WHEN quantity_change>0 THEN quantity_change ELSE 0 END) stock_in,ABS(SUM(CASE WHEN quantity_change<0 THEN quantity_change ELSE 0 END)) stock_out FROM stock_ledger GROUP BY month ORDER BY month DESC LIMIT 6`).all().reverse();

  const dashboardProfile=req.user!.role==='SupplyChainManager'?'executive':['PurchaseManager','PurchaseOfficer'].includes(req.user!.role)?'procurement':'warehouse';
  const payload:any={
    dashboard_profile:dashboardProfile,
    company_name: company?.name ?? 'ProcuraFlow',
    company_logo_url: company?.logo_url ?? null,
    financial_year: company?.financial_year ?? null,
    total_inventory_value: Math.round(totalInventoryValue * 100) / 100,
    monthly_purchase: monthlyPurchase,
    monthly_consumption: monthlyConsumption,
    low_stock_items: lowStockItems,
    pending_approvals: pendingApprovals,
    supplier_count: supplierCount,
    avg_supplier_rating: avgSupplierRating ? Math.round(avgSupplierRating * 10) / 10 : 0,
    purchase_trend: purchaseTrend,
    consumption_trend: consumptionTrend,
    department_consumption: departmentConsumption,
    warehouse_values: warehouseValues,
    ...executiveCounts,po_status_distribution:poStatusDistribution,invoice_match_trend:invoiceMatchTrend,stock_movement_trend:stockMovementTrend,
    ...schedulingKpis(),
  };
  if(dashboardProfile==='procurement'){
    Object.assign(payload,{total_inventory_value:0,monthly_consumption:0,low_stock_items:0,out_of_stock_items:0,inactive_items:0,items_missing_reorder_level:0,consumption_trend:[],department_consumption:[],warehouse_values:[],stock_movement_trend:[],active_warehouse_employees:0,morning_today:0,afternoon_today:0,evening_today:0,off_today:0,holiday_workers_today:0,coverage_warnings:0,unpublished_entries:0,employees_unavailable_today:0});
  }
  if(dashboardProfile==='warehouse'){
    const warehouseIds=authorizedWarehouseIds(req.user!.id),marks=warehouseIds.map(()=>'?').join(',')||'NULL';
    const scopedValue=(db.prepare(`SELECT COALESCE(SUM(s.quantity*COALESCE(i.standard_cost,i.last_purchase_price,0)),0) value FROM inventory_stock s JOIN items i ON i.id=s.item_id WHERE s.warehouse_id IN(${marks})`).get(...warehouseIds)as any)?.value||0;
    const scopedConsumption=(db.prepare(`SELECT COALESCE(SUM(mii.value),0) value FROM material_issue_items mii JOIN material_issues mi ON mi.id=mii.issue_id WHERE mii.warehouse_id IN(${marks}) AND strftime('%Y-%m',mi.issue_date)=strftime('%Y-%m','now')`).get(...warehouseIds)as any)?.value||0;
    const scopedWarehouseValues=db.prepare(`SELECT w.name warehouse_name,COALESCE(SUM(s.quantity*COALESCE(i.standard_cost,i.last_purchase_price,0)),0) total_value FROM inventory_stock s JOIN items i ON i.id=s.item_id JOIN warehouses w ON w.id=s.warehouse_id WHERE s.warehouse_id IN(${marks}) GROUP BY w.id ORDER BY total_value DESC`).all(...warehouseIds);
    const scopedConsumptionTrend=(db.prepare(`SELECT strftime('%Y-%m',mi.issue_date) month,COALESCE(SUM(mii.value),0) total_value FROM material_issue_items mii JOIN material_issues mi ON mi.id=mii.issue_id WHERE mii.warehouse_id IN(${marks}) GROUP BY month ORDER BY month DESC LIMIT 6`).all(...warehouseIds)as any[]).reverse().map(row=>({label:monthLabel(row.month),value:Number(row.total_value||0)}));
    const scopedStockTrend=(db.prepare(`SELECT strftime('%Y-%m',created_at) month,SUM(CASE WHEN quantity_change>0 THEN quantity_change ELSE 0 END) stock_in,ABS(SUM(CASE WHEN quantity_change<0 THEN quantity_change ELSE 0 END)) stock_out FROM stock_ledger WHERE warehouse_id IN(${marks}) GROUP BY month ORDER BY month DESC LIMIT 6`).all(...warehouseIds)as any[]).reverse();
    const scopedDepartmentConsumption=db.prepare(`SELECT d.name department_name,COALESCE(SUM(mii.value),0) total_value FROM material_issue_items mii JOIN material_issues mi ON mi.id=mii.issue_id JOIN employees e ON e.id=mi.employee_id JOIN departments d ON d.id=e.department_id WHERE mii.warehouse_id IN(${marks}) GROUP BY d.id ORDER BY total_value DESC LIMIT 6`).all(...warehouseIds);
    const scopedRisk=db.prepare(`SELECT SUM(CASE WHEN qty<=COALESCE(i.reorder_level,0) THEN 1 ELSE 0 END) low_stock,SUM(CASE WHEN qty<=0 THEN 1 ELSE 0 END) out_stock FROM items i JOIN(SELECT item_id,SUM(quantity) qty FROM inventory_stock WHERE warehouse_id IN(${marks}) GROUP BY item_id)s ON s.item_id=i.id WHERE i.deleted_at IS NULL AND i.active_yn=1`).get(...warehouseIds)as any;
    Object.assign(payload,{total_inventory_value:Number(scopedValue),monthly_consumption:Number(scopedConsumption),low_stock_items:Number(scopedRisk?.low_stock||0),out_of_stock_items:Number(scopedRisk?.out_stock||0),consumption_trend:scopedConsumptionTrend,warehouse_values:scopedWarehouseValues,stock_movement_trend:scopedStockTrend,department_consumption:scopedDepartmentConsumption,monthly_purchase:0,purchase_trend:[],supplier_count:0,avg_supplier_rating:0,open_prs:0,pending_pr_approvals:0,open_pos:0,outstanding_po_value:0,overdue_pos:0,pending_approvals:0,invoices_pending:0,matched_invoices:0,invoice_exceptions:0,po_status_distribution:[],invoice_match_trend:[],potential_duplicate_items:0,active_procurement_employees:0});
  }
  res.json(payload);
});

// Section 12: Notifications
router.get('/notifications', requireAuth, (req: AuthedRequest, res) => {
  const rows = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? OR user_id IS NULL ORDER BY id DESC LIMIT 50')
    .all(req.user!.id);
  res.json(rows);
});

router.put('/notifications/:id/read', requireAuth, (req: AuthedRequest, res) => {
  const result = db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND (user_id = ? OR user_id IS NULL)').run(req.params.id, req.user!.id);
  if (!result.changes) return res.status(404).json({ error: 'Notification not found' });
  res.json({ success: true });
});

router.get('/tasks', requireAuth, (req: AuthedRequest, res) => {
  const tasks: any[] = [];
  const role = req.user!.role;
  if (['PurchaseManager','SupplyChainManager'].includes(role)) {
    (db.prepare(`SELECT id,po_number number,total_amount,status,created_at due_date FROM purchase_orders WHERE status='PendingApproval' ORDER BY created_at`).all() as any[]).filter(r=>canUserApprove('PO',r.id,req.user!.id,role,Number(r.total_amount)>maxApprovalFor('PurchaseManager')?'SupplyChainManager':'PurchaseManager')).forEach((r)=>tasks.push({ type:'PO approval', priority:'High', ...r }));
    (db.prepare(`SELECT pr.id,pr.pr_number number,pr.status,pr.created_at due_date FROM purchase_requisitions pr WHERE pr.status='Submitted' AND NOT EXISTS (SELECT 1 FROM approval_log al WHERE al.document_type='PR' AND al.document_id=pr.id AND al.decision IN ('Approved','Rejected')) ORDER BY pr.created_at`).all() as any[]).filter(r=>canUserApprove('PR',r.id,req.user!.id,role,'PurchaseManager')).forEach((r)=>tasks.push({ type:'PR review', priority:'High', ...r }));
    (db.prepare(`SELECT id,po_number number,status,committed_delivery_date due_date FROM purchase_orders WHERE status NOT IN ('Closed','Rejected','Draft') AND committed_delivery_date IS NOT NULL AND date(committed_delivery_date)<date('now') ORDER BY committed_delivery_date`).all() as any[]).forEach((r)=>tasks.push({type:'PO delivery overdue',priority:'High',...r}));
  }
  if (['WarehouseManager','SupplyChainManager'].includes(role)) {
    (db.prepare(`SELECT mi.id,mi.issue_number number,mi.total_value,mi.status,mi.created_at due_date,(SELECT warehouse_id FROM material_issue_items WHERE issue_id=mi.id ORDER BY id LIMIT 1) warehouse_id FROM material_issues mi WHERE mi.status='PendingApproval' ORDER BY mi.created_at`).all() as any[]).filter(r=>canUserApprove('ISSUE',r.id,req.user!.id,role,'WarehouseManager',r.warehouse_id)).forEach((r)=>tasks.push({ type:'Issue approval', priority:'High', ...r }));
    (db.prepare(`SELECT id,adjustment_number number,status,adjustment_date due_date,warehouse_id FROM stock_adjustments WHERE status='Pending' ORDER BY adjustment_date`).all() as any[]).filter(r=>canUserApprove('ADJUSTMENT',r.id,req.user!.id,role,'WarehouseManager',r.warehouse_id)).forEach((r)=>tasks.push({ type:'Adjustment approval', priority:'High', ...r }));
    (db.prepare(`SELECT id,count_number number,status,count_date due_date,warehouse_id FROM cycle_counts WHERE status='Counted' ORDER BY count_date`).all() as any[]).filter(r=>canUserApprove('CYCLECOUNT',r.id,req.user!.id,role,'WarehouseManager',r.warehouse_id)).forEach((r)=>tasks.push({type:'Cycle count approval',priority:'High',...r}));
  }
  if (['SupplyChainManager','WarehouseManager','WarehouseSupervisor','Storekeeper'].includes(role)) {
    const warehouseIds=authorizedWarehouseIds(req.user!.id);
    if(warehouseIds.length){const marks=warehouseIds.map(()=>'?').join(',');
      const lowStock=db.prepare(`SELECT i.id,i.item_code number,'Low stock' type,'Medium' priority,NULL due_date FROM items i WHERE i.deleted_at IS NULL AND COALESCE((SELECT SUM(s.quantity) FROM inventory_stock s WHERE s.item_id=i.id AND s.warehouse_id IN(${marks})),0)<=i.reorder_level`).all(...warehouseIds);
      const expiry=db.prepare(`SELECT il.id,i.item_code number,'Expiry approaching' type,CASE WHEN julianday(il.expiry_date)-julianday('now')<=30 THEN 'High' ELSE 'Medium' END priority,il.expiry_date due_date FROM inventory_layers il JOIN items i ON i.id=il.item_id WHERE il.warehouse_id IN(${marks}) AND il.quantity_remaining>0 AND il.expiry_date IS NOT NULL AND julianday(il.expiry_date)-julianday('now')<=90`).all(...warehouseIds);
      tasks.push(...lowStock as any[],...expiry as any[]);
    }
  }
  if (role === 'SupplyChainManager' && new Date().getDate() >= 25) {
    const ack = db.prepare("SELECT value FROM settings WHERE key='backup_reminder_last_ack'").get() as any;
    const currentMonth = new Date().toISOString().slice(0,7);
    if (!String(ack?.value || '').startsWith(currentMonth)) tasks.unshift({ id: 'month-backup', type: 'Month-end database backup required', number: currentMonth, priority: 'High', due_date: new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).toISOString().slice(0,10) });
  }
  if(role==='SupplyChainManager'){
    const publicationDue=db.prepare(`SELECT lower(d.name) scope,MIN(c.calendar_date) first_work_date,date(MIN(c.calendar_date),'-7 days') publication_deadline,COUNT(*) unpublished_entries FROM employee_work_calendar c JOIN departments d ON d.id=c.department_id WHERE c.status IN('DRAFT','PROVISIONAL','LOCKED') AND date(c.calendar_date) BETWEEN date('now') AND date('now','+14 days') GROUP BY lower(d.name) ORDER BY first_work_date`).all() as any[];
    publicationDue.forEach(entry=>tasks.unshift({id:`calendar-${entry.scope}`,type:'Workday calendar publication due',number:`${entry.scope} · ${entry.unpublished_entries} entries · starts ${entry.first_work_date}`,priority:entry.publication_deadline<=new Date().toISOString().slice(0,10)?'Critical':'High',due_date:entry.publication_deadline}));
    const duplicates=(db.prepare("SELECT COUNT(*) n FROM item_duplicate_reviews WHERE review_status='Pending Review'").get()as any).n;if(duplicates)tasks.push({id:'duplicate-items',type:'Duplicate items pending review',number:`${duplicates} potential matches`,priority:'Medium',due_date:null});
    const gaps=(db.prepare("SELECT COUNT(*) n FROM calendar_coverage_warnings WHERE warning_status='OPEN'").get()as any).n;if(gaps)tasks.push({id:'coverage-warnings',type:'Employee coverage gap',number:`${gaps} open warnings`,priority:'High',due_date:null});
    const exceptions=(db.prepare("SELECT COUNT(*) n FROM invoices WHERE match_status='Variance'").get()as any).n;if(exceptions)tasks.push({id:'invoice-exceptions',type:'Three-way match exception',number:`${exceptions} invoice exceptions`,priority:'High',due_date:null});
  }
  res.json(tasks);
});

export default router;
