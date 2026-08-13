import { Router } from 'express';
import db from '../db';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { logAudit } from '../utils/auditLog';
import { crudRouter } from '../utils/crud';
import { assertWarehouseAccess, authorizedWarehouseIds } from '../utils/warehouseAccess';

const router = Router();

// Section 9: Tool Management (ID, serial, employee assignment, calibration)
router.use(
  '/tools',
  crudRouter({ table: 'tools', writeRoles: ['WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'], orderBy: 'tool_code', allowedFields: ['tool_code', 'serial_number', 'make', 'model', 'item_id', 'employee_id', 'issue_date', 'return_date', 'condition', 'calibration_due_date','warehouse_id'], warehouseField:'warehouse_id' })
);

router.put('/tools/:id/checkout', requireAuth, requireRole('WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'), (req: AuthedRequest, res) => {
  const { employee_id } = req.body || {};
  if (!Number.isInteger(Number(employee_id))) return res.status(400).json({ error: 'A valid employee is required' });
  const tool = db.prepare('SELECT * FROM tools WHERE id = ?').get(req.params.id) as any;
  if (!tool) return res.status(404).json({ error: 'Tool not found' });
  try{assertWarehouseAccess(req,tool.warehouse_id,'check out this tool');}catch{return res.status(404).json({error:'Tool not found'});}
  if (tool.employee_id && !tool.return_date) return res.status(409).json({ error: 'Tool is already checked out' });
  db.prepare(`UPDATE tools SET employee_id = ?, issue_date = date('now'), return_date = NULL WHERE id = ?`).run(employee_id, req.params.id);
  logAudit('tools', Number(req.params.id), 'UPDATE', req.user?.id, undefined, { employee_id, action: 'checkout' });
  res.json({ success: true });
});

router.put('/tools/:id/checkin', requireAuth, requireRole('WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'), (req: AuthedRequest, res) => {
  const { condition } = req.body || {};
  const tool = db.prepare('SELECT * FROM tools WHERE id = ?').get(req.params.id) as any;
  if (!tool) return res.status(404).json({ error: 'Tool not found' });
  try{assertWarehouseAccess(req,tool.warehouse_id,'check in this tool');}catch{return res.status(404).json({error:'Tool not found'});}
  if (!tool.employee_id || tool.return_date) return res.status(409).json({ error: 'Tool is not currently checked out' });
  if (!['Good', 'Damaged', 'Needs Repair'].includes(condition)) return res.status(400).json({ error: 'Select a valid condition' });
  db.prepare(`UPDATE tools SET return_date = date('now'), condition = ? WHERE id = ?`).run(condition ?? null, req.params.id);
  logAudit('tools', Number(req.params.id), 'UPDATE', req.user?.id, undefined, { condition, action: 'checkin' });
  res.json({ success: true });
});

// Tool calibration alerts (30/60 day, similar pattern to expiry tracking)
router.get('/tools/alerts/calibration', requireAuth, requireRole('SupplyChainManager','WarehouseManager','WarehouseSupervisor','Storekeeper'), (req:AuthedRequest, res) => {
  const ids=authorizedWarehouseIds(req.user!.id);if(!ids.length)return res.json([]);
  const rows = db
    .prepare(
      `SELECT *, CAST(julianday(calibration_due_date) - julianday('now') AS INTEGER) AS days_remaining
       FROM tools WHERE calibration_due_date IS NOT NULL AND warehouse_id IN(${ids.map(()=>'?').join(',')}) ORDER BY calibration_due_date ASC`
    )
    .all(...ids);
  res.json(rows);
});

// Section 9: Vendor Performance Scorecard
router.get('/vendor-scorecards', requireAuth, requireRole('SupplyChainManager','PurchaseManager'), (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT vs.*, s.name AS supplier_name FROM vendor_scorecards vs
         JOIN suppliers s ON s.id = vs.supplier_id ORDER BY vs.period DESC`
      )
      .all()
  );
});

router.post('/vendor-scorecards', requireAuth, requireRole('PurchaseManager', 'SupplyChainManager'), (req: AuthedRequest, res) => {
  const { supplier_id, period, delivery_accuracy, price_competitiveness, quality, response_time, reliability } = req.body || {};
  if (!Number.isInteger(Number(supplier_id)) || !String(period || '').trim()) return res.status(400).json({ error: 'Supplier and period are required' });
  const submittedScores = [delivery_accuracy, price_competitiveness, quality, response_time, reliability];
  if (submittedScores.some((s) => s != null && (!Number.isFinite(Number(s)) || Number(s) < 0 || Number(s) > 5))) return res.status(400).json({ error: 'Scores must be between 0 and 5' });
  const scores = submittedScores.filter((s) => s != null).map(Number);
  const overall_score = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

  const result = db
    .prepare(
      `INSERT INTO vendor_scorecards (supplier_id, period, delivery_accuracy, price_competitiveness, quality, response_time, reliability, overall_score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(supplier_id, period, delivery_accuracy ?? null, price_competitiveness ?? null, quality ?? null, response_time ?? null, reliability ?? null, overall_score);

  logAudit('vendor_scorecards', Number(result.lastInsertRowid), 'CREATE', req.user?.id, undefined, req.body);
  res.status(201).json({ id: result.lastInsertRowid, overall_score });
});

export default router;
