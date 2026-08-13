import { Response, NextFunction } from 'express';
import db from '../db';
import { AuthedRequest } from './auth';
import { getSetting } from '../utils/settings';
import { defaultsForRole, permissionForRequest } from '../utils/permissions';

/**
 * Section 4: Role-Based Access Control.
 * Usage: router.post('/', requireRole('SupplyChainManager', 'PurchaseManager'), handler)
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `Role '${req.user.role}' is not permitted to perform this action` });
    }
    const requiredPermission=permissionForRequest(req.originalUrl,req.method);
    if(requiredPermission&&req.user.role!=='SupplyChainManager'){const row=db.prepare('SELECT e.permission_keys FROM users u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.id=?').get(req.user.id) as any;let assigned:string[];try{assigned=row?.permission_keys?JSON.parse(row.permission_keys):defaultsForRole(req.user.role);}catch{assigned=defaultsForRole(req.user.role);}if(!assigned.includes(requiredPermission))return res.status(403).json({error:`This employee account is not assigned permission '${requiredPermission}'`});}
    next();
  };
}

function roleSettingKey(role: string): string {
  switch (role) {
    case 'SupplyChainManager': return 'approval_limit_supply_chain_manager';
    case 'PurchaseManager': return 'approval_limit_purchase_manager';
    case 'PurchaseOfficer': return 'approval_limit_purchase_officer';
    case 'WarehouseManager': return 'approval_limit_warehouse_manager';
    case 'WarehouseSupervisor': return 'approval_limit_warehouse_supervisor';
    case 'Storekeeper': return 'approval_limit_storekeeper';
    default: return '';
  }
}

function fallbackLimitFor(role: string): number {
  const configured = Number(getSetting(roleSettingKey(role)));
  if (Number.isFinite(configured) && configured > 0) return configured;

  switch (role) {
    case 'PurchaseOfficer': return 10000;
    case 'PurchaseManager': return 20000;
    case 'SupplyChainManager': return 50000;
    default: return 0;
  }
}

export function maxApprovalFor(userOrRole: string | { id?: number; role: string; full_name?: string; username?: string } | undefined): number {
  if (typeof userOrRole === 'string') return fallbackLimitFor(userOrRole);
  if (!userOrRole) return 0;

  const employee = db
    .prepare(`SELECT e.approval_role, e.approval_limit
      FROM employees e LEFT JOIN users u ON u.employee_id=e.id
      WHERE (u.id=? OR (u.id IS NULL AND (e.name=? OR e.employee_code=?))) AND e.deleted_at IS NULL
      ORDER BY CASE WHEN u.id=? THEN 0 ELSE 1 END LIMIT 1`)
    .get(userOrRole.id ?? -1, userOrRole.full_name || '', userOrRole.username || '', userOrRole.id ?? -1) as { approval_role?: string; approval_limit?: number } | undefined;

  const role = employee?.approval_role || userOrRole.role;
  const customLimit = employee?.approval_limit != null ? Number(employee.approval_limit) : null;
  if (customLimit && customLimit > 0) return customLimit;
  return fallbackLimitFor(role);
}
