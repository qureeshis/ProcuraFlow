import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import db from '../db';
import { defaultsForRole, permissionForRequest } from '../utils/permissions';

const configuredSecret=String(process.env.JWT_SECRET||'').trim();
if(process.env.NODE_ENV==='production'&&configuredSecret.length<32)throw new Error('JWT_SECRET must be configured with at least 32 characters in production');
const JWT_SECRET = configuredSecret || 'dev-secret-change-me';

export interface AuthedRequest extends Request {
  user?: { id: number; username: string; role: string; full_name: string; warehouse_id?: number | null; warehouse_ids?: number[]; warehouse_name?: string | null; permission_keys?: string[]; must_change_password?: boolean; password_expires_at?: string; password_days_remaining?: number | null };
}

export function signToken(payload: AuthedRequest['user']) {
  return jwt.sign(payload as object, JWT_SECRET, { expiresIn: '8h' });
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = header.slice('Bearer '.length);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as NonNullable<AuthedRequest['user']>;
    const account=db.prepare(`SELECT u.id,u.username,u.role,u.full_name,u.is_active,u.locked_reason,u.deleted_at,u.password_expires_at,e.status employee_status,e.system_access_yn,d.name department_name FROM users u LEFT JOIN employees e ON e.id=u.employee_id LEFT JOIN departments d ON d.id=e.department_id WHERE u.id=?`).get(decoded?.id)as any;
    if(!account||account.deleted_at||!account.is_active)return res.status(401).json({error:'Account is inactive or no longer available'});
    if(String(account.role).toLowerCase()==='finance'||String(account.department_name||'').trim().toLowerCase()==='finance'||account.system_access_yn===0||account.employee_status==='Inactive')return res.status(403).json({error:'This employee has no ProcuraFlow system access'});
    if(account.locked_reason)return res.status(423).json({error:`Account temporarily locked: ${account.locked_reason}`});
    if(account.password_expires_at&&new Date(String(account.password_expires_at).replace(' ','T')+'Z').getTime()<=Date.now()){
      db.prepare("UPDATE users SET locked_reason='Password expired' WHERE id=? AND locked_reason IS NULL").run(account.id);
      return res.status(423).json({error:'Password expired. Contact the Supply Chain Manager to restore access.'});
    }
    decoded.username=account.username;decoded.role=account.role;decoded.full_name=account.full_name;
    req.user = decoded;
    const requiredPermission=permissionForRequest(req.originalUrl,req.method);
    if(requiredPermission&&decoded.role!=='SupplyChainManager'){const row=db.prepare('SELECT e.permission_keys FROM users u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.id=?').get(decoded.id) as any;let assigned:string[];try{assigned=row?.permission_keys?JSON.parse(row.permission_keys):defaultsForRole(decoded.role);}catch{assigned=defaultsForRole(decoded.role);}if(!assigned.includes(requiredPermission))return res.status(403).json({error:`This employee account is not assigned permission '${requiredPermission}'`});}
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
