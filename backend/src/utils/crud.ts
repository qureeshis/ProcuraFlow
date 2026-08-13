import { Router } from 'express';
import db from '../db';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { logAudit } from './auditLog';
import { assertWarehouseAccess, authorizedWarehouseIds } from './warehouseAccess';

interface CrudOptions {
  table: string;
  primaryKey?: string;
  softDelete?: boolean; // if true, DELETE sets deleted_at instead of removing the row
  writeRoles?: string[]; // roles allowed to create/update/delete; omit = any authenticated user
  orderBy?: string;
  allowedFields: string[]; // explicit write allowlist; never derive SQL identifiers from request data
  autoCode?: { field: string; prefix: string };
  duplicateFields?: string[];
  immutableFields?: string[];
  normalizeBody?: (body: Record<string, any>, existing?: any) => Record<string, any>;
  afterUpdate?: (before: any, row: any, userId?:number) => void;
  validateBody?: (body: Record<string, any>, existing?: any) => string | null;
  warehouseField?: string;
}

/**
 * Builds a standard REST router (GET list, GET :id, POST, PUT :id, DELETE :id)
 * for a table, with audit logging and optional RBAC + soft delete.
 * Used for master-data screens (Section 5) and simpler transactional tables
 * where bespoke business logic isn't required.
 */
export function crudRouter(opts: CrudOptions) {
  const { table, primaryKey = 'id', softDelete = false, writeRoles, orderBy, allowedFields, autoCode, duplicateFields = [], immutableFields = [], normalizeBody, afterUpdate, validateBody, warehouseField } = opts;
  const router = Router();
  const writeGuard = writeRoles ? [requireAuth, requireRole(...writeRoles)] : [requireAuth];

  router.get('/', requireAuth, (req, res) => {
    const ids=warehouseField?authorizedWarehouseIds((req as AuthedRequest).user!.id):[];
    if(warehouseField&&!ids.length)return res.json([]);
    const conditions=[softDelete?'deleted_at IS NULL':'',warehouseField?`${warehouseField} IN(${ids.map(()=>'?').join(',')})`:''].filter(Boolean);
    const whereClause = conditions.length?`WHERE ${conditions.join(' AND ')}`:'';
    const order = orderBy ? `ORDER BY ${orderBy}` : `ORDER BY ${primaryKey} DESC`;
    const rows = db.prepare(`SELECT * FROM ${table} ${whereClause} ${order}`).all(...ids);
    res.json(rows);
  });

  router.get('/:id', requireAuth, (req, res) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE ${primaryKey} = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if(warehouseField&&!authorizedWarehouseIds((req as AuthedRequest).user!.id).includes(Number((row as any)[warehouseField])))return res.status(404).json({error:'Not found'});
    res.json(row);
  });

  router.post('/', ...writeGuard, (req: AuthedRequest, res) => {
    let body = { ...(req.body || {}) };
    if(warehouseField){const ids=authorizedWarehouseIds(req.user!.id);if(!body[warehouseField]&&ids.length===1)body[warehouseField]=ids[0];try{assertWarehouseAccess(req,body[warehouseField],`create ${table}`);}catch(e:any){return res.status(e.status||403).json({error:e.message});}}
    if (normalizeBody) body = normalizeBody(body);
    const createValidationError = validateBody?.(body);
    if (createValidationError) return res.status(400).json({ error: createValidationError });
    if (autoCode && !String(body[autoCode.field] || '').trim()) {
      const last = db.prepare(`SELECT ${autoCode.field} code FROM ${table} WHERE ${autoCode.field} LIKE ? ORDER BY id DESC LIMIT 1`).get(`${autoCode.prefix}-%`) as { code?: string } | undefined;
      const next = (Number(last?.code?.split('-').pop()) || 0) + 1;
      body[autoCode.field] = `${autoCode.prefix}-${String(next).padStart(4, '0')}`;
    }
    const unknown = Object.keys(body).filter((k) => !allowedFields.includes(k));
    if (unknown.length) return res.status(400).json({ error: `Unknown fields: ${unknown.join(', ')}` });
    const keys = Object.keys(body).filter((k) => allowedFields.includes(k));
    if (keys.length === 0) return res.status(400).json({ error: 'No fields provided' });
    for (const field of duplicateFields) if (body[field] != null && db.prepare(`SELECT ${primaryKey} FROM ${table} WHERE lower(${field})=lower(?)${softDelete ? ' AND deleted_at IS NULL' : ''} LIMIT 1`).get(String(body[field]).trim())) return res.status(409).json({ error: `Duplicate ${field.replace(/_/g, ' ')} already exists` });
    const placeholders = keys.map(() => '?').join(', ');
    const stmt = db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`);
    const result = stmt.run(...keys.map((k) => body[k]));
    const newId = result.lastInsertRowid;
    logAudit(table, Number(newId), 'CREATE', req.user?.id, undefined, body);
    const row = db.prepare(`SELECT * FROM ${table} WHERE ${primaryKey} = ?`).get(newId);
    res.status(201).json(row);
  });

  router.put('/:id', requireAuth,requireRole('SupplyChainManager'), (req: AuthedRequest, res) => {
    const before = db.prepare(`SELECT * FROM ${table} WHERE ${primaryKey} = ?`).get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    if(warehouseField)try{assertWarehouseAccess(req,(before as any)[warehouseField],`update ${table}`);}catch{return res.status(404).json({error:'Not found'});}
    let body = { ...(req.body || {}) };
    if (normalizeBody) body = normalizeBody(body, before);
    const updateValidationError = validateBody?.(body, before);
    if (updateValidationError) return res.status(400).json({ error: updateValidationError });
    const unknown = Object.keys(body).filter((k) => !allowedFields.includes(k));
    if (unknown.length) return res.status(400).json({ error: `Unknown fields: ${unknown.join(', ')}` });
    const keys = Object.keys(body).filter((k) => allowedFields.includes(k) && !immutableFields.includes(k));
    if (keys.length === 0) return res.status(400).json({ error: 'No fields provided' });
    for (const field of duplicateFields) if (body[field] != null && db.prepare(`SELECT ${primaryKey} FROM ${table} WHERE lower(${field})=lower(?) AND ${primaryKey}<>?${softDelete ? ' AND deleted_at IS NULL' : ''} LIMIT 1`).get(String(body[field]).trim(), req.params.id)) return res.status(409).json({ error: `Duplicate ${field.replace(/_/g, ' ')} already exists` });
    const setClause = keys.map((k) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE ${table} SET ${setClause} WHERE ${primaryKey} = ?`).run(...keys.map((k) => body[k]), req.params.id);
    logAudit(table, Number(req.params.id), 'UPDATE', req.user?.id, before, body);
    const row = db.prepare(`SELECT * FROM ${table} WHERE ${primaryKey} = ?`).get(req.params.id);
    afterUpdate?.(before,row,req.user?.id);
    res.json(row);
  });

  router.delete('/:id', requireAuth,requireRole('SupplyChainManager'), (req: AuthedRequest, res) => {
    const before = db.prepare(`SELECT * FROM ${table} WHERE ${primaryKey} = ?`).get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    if(warehouseField)try{assertWarehouseAccess(req,(before as any)[warehouseField],`delete ${table}`);}catch{return res.status(404).json({error:'Not found'});}
    if (softDelete) {
      db.prepare(`UPDATE ${table} SET deleted_at = datetime('now') WHERE ${primaryKey} = ?`).run(req.params.id);
    } else {
      db.prepare(`DELETE FROM ${table} WHERE ${primaryKey} = ?`).run(req.params.id);
    }
    logAudit(table, Number(req.params.id), 'DELETE', req.user?.id, before, undefined);
    res.json({ success: true, softDeleted: softDelete });
  });

  return router;
}
