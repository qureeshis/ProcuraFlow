import db from '../db';
import { AuthedRequest } from '../middleware/auth';
import { logAudit } from './auditLog';

export function authorizedWarehouseIds(userId: number): number[] {
  const user=db.prepare('SELECT employee_id,role FROM users WHERE id=? AND deleted_at IS NULL AND is_active=1').get(userId) as {employee_id:number|null;role:string}|undefined;
  // The Supply Chain Manager owns system-wide operations and may maintain and
  // transact against every active warehouse without a separate assignment row.
  if(user?.role==='SupplyChainManager')return(db.prepare('SELECT id FROM warehouses WHERE deleted_at IS NULL ORDER BY id').all()as Array<{id:number}>).map(row=>Number(row.id));
  if(user?.employee_id){const all=db.prepare(`SELECT 1 FROM employee_warehouse_assignments WHERE employee_id=? AND all_warehouses_yn=1 AND active_yn=1 AND effective_from<=date('now') AND(effective_to IS NULL OR effective_to>=date('now'))`).get(user.employee_id);if(all)return(db.prepare('SELECT id FROM warehouses WHERE deleted_at IS NULL ORDER BY id').all()as Array<{id:number}>).map(r=>Number(r.id));const assigned=db.prepare(`SELECT warehouse_id FROM employee_warehouse_assignments WHERE employee_id=? AND warehouse_id IS NOT NULL AND active_yn=1 AND effective_from<=date('now') AND(effective_to IS NULL OR effective_to>=date('now')) ORDER BY primary_warehouse_yn DESC,warehouse_id`).all(user.employee_id)as any[];if(assigned.length)return assigned.map(r=>Number(r.warehouse_id));}
  // Compatibility fallback for unlinked legacy accounts only.
  return (db.prepare(`SELECT warehouse_id FROM user_warehouse_assignments
    WHERE user_id=? AND is_active=1 AND effective_from<=date('now')
      AND (effective_to IS NULL OR effective_to>=date('now'))`).all(userId) as any[]).map(r=>Number(r.warehouse_id));
}

export function canAccessWarehouse(userId: number, warehouseId: number) {
  return authorizedWarehouseIds(userId).includes(Number(warehouseId));
}

export function assertWarehouseAccess(req: AuthedRequest, warehouseId: unknown, operation: string) {
  const id=Number(warehouseId);
  if (!req.user || !Number.isInteger(id) || !canAccessWarehouse(req.user.id,id)) {
    logAudit('warehouse_access',id||0,'UPDATE',req.user?.id,undefined,{event:'UNAUTHORIZED_ATTEMPT',warehouse_id:warehouseId,operation,path:req.originalUrl});
    const error:any=new Error(`You are not authorized to ${operation} for this warehouse`);error.status=403;throw error;
  }
  return id;
}

export function assertLocationAccess(req: AuthedRequest, locationId: unknown, warehouseId: unknown, operation: string, normalStock=true) {
  const wh=assertWarehouseAccess(req,warehouseId,operation);
  const location=db.prepare(`SELECT * FROM locations WHERE id=? AND warehouse_id=? AND deleted_at IS NULL`).get(locationId,wh) as any;
  if(!location || location.type!=='Bin') { const e:any=new Error('Select a valid BIN belonging to the authorized warehouse');e.status=400;throw e; }
  if(normalStock && !['Available','Partially Available'].includes(location.status)) { const e:any=new Error(`BIN ${location.code} is ${location.status} and unavailable for normal stock movement`);e.status=409;throw e; }
  return location;
}
