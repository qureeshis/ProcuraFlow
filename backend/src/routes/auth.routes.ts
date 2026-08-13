import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db';
import { signToken, requireAuth, AuthedRequest } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { authorizedWarehouseIds } from '../utils/warehouseAccess';
import { logAudit } from '../utils/auditLog';
import { defaultsForRole } from '../utils/permissions';

const router = Router();

// Section 4: Authentication (username/password, failed login tracking, login history)
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const recentFailures = (db.prepare("SELECT COUNT(*) count FROM login_history WHERE lower(username_attempted)=lower(?) AND success=0 AND created_at>=datetime('now','-15 minutes')").get(String(username).trim()) as any)?.count || 0;
  if (recentFailures >= 5) return res.status(429).json({ error: 'Too many failed login attempts. Try again after 15 minutes or contact the Supply Chain Manager.' });

  const user = db.prepare('SELECT * FROM users WHERE lower(username) = lower(?) AND deleted_at IS NULL').get(String(username).trim()) as any;

  const access=user?db.prepare(`SELECT e.status,e.system_access_yn,d.name department_name FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE e.id=? AND e.deleted_at IS NULL`).get(user.employee_id) as any:null;
  const financeExcluded=String(user?.role||'').toLowerCase()==='finance'||String(access?.department_name||'').trim().toLowerCase()==='finance';
  const success = !!user && user.is_active && access?.status==='Active' && access?.system_access_yn!==0 && !financeExcluded && bcrypt.compareSync(password, user.password_hash);
  db.prepare(
    'INSERT INTO login_history (user_id, username_attempted, success) VALUES (?, ?, ?)'
  ).run(user?.id ?? null, username, success ? 1 : 0);

  if (!success) {
    if (user && (!user.is_active||financeExcluded||access?.system_access_yn===0||access?.status!=='Active')) return res.status(403).json({ error: 'This employee has no ProcuraFlow system access' });
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  if (user.locked_reason) return res.status(423).json({ error: `Account temporarily locked: ${user.locked_reason}. Contact the Supply Chain Manager.` });
  const expiresAt = user.password_expires_at ? new Date(user.password_expires_at.replace(' ', 'T') + 'Z') : null;
  const remainingMs = expiresAt ? expiresAt.getTime() - Date.now() : Infinity;
  if (remainingMs <= 0) {
    db.prepare("UPDATE users SET locked_reason = 'Password expired' WHERE id = ?").run(user.id);
    return res.status(423).json({ error: 'Password expired. Contact the Supply Chain Manager to restore access.' });
  }

  const warehouse = user.warehouse_id ? db.prepare('SELECT name FROM warehouses WHERE id=?').get(user.warehouse_id) as any : null;
  const identity=db.prepare(`SELECT d.name department_name,w.name warehouse_name FROM users u LEFT JOIN employees e ON e.id=u.employee_id LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN warehouses w ON w.id=COALESCE(u.warehouse_id,e.warehouse_id) WHERE u.id=?`).get(user.id) as any;
  db.prepare(`INSERT INTO user_activity_log (user_id,full_name,username,role,department_name,warehouse_name,event_type,current_action,page_path,ip_address) VALUES (?,?,?,?,?,?,'Login','Signed in',NULL,?)`).run(user.id,user.full_name,user.username,user.role,identity?.department_name||null,identity?.warehouse_name||null,req.ip||null);
  const employeeAccess=db.prepare('SELECT permission_keys FROM employees WHERE id=?').get(user.employee_id) as any;let permission_keys:string[];try{permission_keys=user.role==='SupplyChainManager'?defaultsForRole(user.role):(employeeAccess?.permission_keys?JSON.parse(employeeAccess.permission_keys):defaultsForRole(user.role));}catch{permission_keys=defaultsForRole(user.role);}
  const warehouse_ids=authorizedWarehouseIds(user.id);
  const payload = { id: user.id, username: user.username, role: user.role, full_name: user.full_name, warehouse_id: warehouse_ids.length===1?warehouse_ids[0]:user.warehouse_id ?? null, warehouse_ids, warehouse_name: warehouse?.name ?? null, permission_keys, must_change_password: !!user.must_change_password, password_expires_at: user.password_expires_at, password_days_remaining: Number.isFinite(remainingMs) ? Math.ceil(remainingMs / 86400000) : null };
  const token = signToken(payload);
  res.json({ token, user: payload });
});

router.put('/change-password', requireAuth, (req: AuthedRequest, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password || String(new_password).length < 8) return res.status(400).json({ error: 'Current password and a new password of at least 8 characters are required' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as any;
  if (!user || !bcrypt.compareSync(current_password, user.password_hash)) return res.status(400).json({ error: 'Current password is incorrect' });
  if (bcrypt.compareSync(new_password, user.password_hash)) return res.status(400).json({ error: 'New password must be different' });
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = datetime('now'), password_expires_at = datetime('now', '+90 days'), locked_reason = NULL WHERE id = ?").run(bcrypt.hashSync(new_password, 10), user.id);
  logAudit('users', user.id, 'UPDATE', req.user?.id, undefined, { action: 'password_changed' });
  res.json({ success: true });
});

router.get('/me', requireAuth, (req: AuthedRequest, res) => {
  const current = db.prepare('SELECT u.id,u.username,u.role,u.full_name,u.warehouse_id,w.name warehouse_name,u.must_change_password,u.password_expires_at,e.permission_keys FROM users u LEFT JOIN warehouses w ON w.id=u.warehouse_id LEFT JOIN employees e ON e.id=u.employee_id WHERE u.id=?').get(req.user!.id) as any;
  if(current){
    try{current.permission_keys=current.role==='SupplyChainManager'?defaultsForRole(current.role):(current.permission_keys?JSON.parse(current.permission_keys):defaultsForRole(current.role));}catch{current.permission_keys=defaultsForRole(current.role);}
    current.warehouse_ids=authorizedWarehouseIds(current.id);
    if(current.warehouse_ids.length===1) current.warehouse_id=current.warehouse_ids[0];
    const expiresAt=current.password_expires_at?new Date(current.password_expires_at.replace(' ','T')+'Z'):null;
    current.password_days_remaining=expiresAt?Math.ceil((expiresAt.getTime()-Date.now())/86400000):null;
    current.must_change_password=!!current.must_change_password;
  }
  res.json(current || req.user);
});

// Section 4: User management (admin only)
router.get('/users', requireAuth, requireRole('SupplyChainManager'), (req, res) => {
  const rows = db.prepare('SELECT id, username, full_name, role, is_active, must_change_password, password_expires_at, locked_reason, created_at FROM users WHERE deleted_at IS NULL ORDER BY id').all();
  res.json(rows);
});

router.post('/users', requireAuth, requireRole('SupplyChainManager'), (req: AuthedRequest, res) => {
  const { username, password, full_name, role } = req.body || {};
  if (!username || !password || !full_name || !role) return res.status(400).json({ error: 'All fields required' });
  const validRoles = ['SupplyChainManager','PurchaseManager','PurchaseOfficer','WarehouseManager','WarehouseSupervisor','Storekeeper'];
  if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must contain at least 8 characters' });
  const hash = bcrypt.hashSync(password, 10);
  const result = db
    .prepare("INSERT INTO users (username, password_hash, full_name, role, must_change_password, password_changed_at, password_expires_at) VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now','+7 days'))")
    .run(String(username).trim(), hash, String(full_name).trim(), role);
  logAudit('users', Number(result.lastInsertRowid), 'CREATE', req.user?.id, undefined, { username, full_name, role });
  res.status(201).json({ id: result.lastInsertRowid, username, full_name, role });
});

router.put('/users/:id/status', requireAuth, requireRole('SupplyChainManager'), (req: AuthedRequest, res) => {
  const { is_active } = req.body || {};
  if (Number(req.params.id) === req.user!.id && !is_active) return res.status(409).json({ error: 'You cannot deactivate your own logged-in account' });
  db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, req.params.id);
  logAudit('users', Number(req.params.id), 'UPDATE', req.user?.id, undefined, { is_active });
  res.json({ success: true });
});

router.put('/users/:id/unlock', requireAuth, requireRole('SupplyChainManager'), (req: AuthedRequest, res) => {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.prepare("UPDATE users SET locked_reason = NULL, is_active = 1, must_change_password = 1, password_expires_at = datetime('now', '+7 days') WHERE id = ?").run(req.params.id);
  logAudit('users', Number(req.params.id), 'UPDATE', req.user?.id, undefined, { action: 'account_unlocked' });
  res.json({ success: true });
});

router.get('/login-history', requireAuth, requireRole('SupplyChainManager'), (req, res) => {
  const rows = db.prepare('SELECT * FROM login_history ORDER BY id DESC LIMIT 200').all();
  res.json(rows);
});

export default router;
