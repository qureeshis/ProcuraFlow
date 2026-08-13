import db from '../db';

/**
 * Section 11: Audit System.
 * Every transaction records who/when/what. Records are never hard-deleted;
 * soft-delete (deleted_at) is used where the table supports it.
 */
export function logAudit(
  tableName: string,
  recordId: number | null,
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'APPROVE' | 'REJECT',
  changedBy: number | undefined,
  oldValues?: unknown,
  newValues?: unknown
) {
  db.prepare(
    `INSERT INTO audit_log (table_name, record_id, action, changed_by, old_values, new_values)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    tableName,
    recordId,
    action,
    changedBy ?? null,
    oldValues ? JSON.stringify(oldValues) : null,
    newValues ? JSON.stringify(newValues) : null
  );
}
