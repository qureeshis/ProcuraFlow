import db from '../db';
import { approvalRecipients } from './approvalRouting';

/**
 * Section 5.4: Segregation of Duties - "A user must not approve a
 * transaction they created." Section 8.3: DB_Approval_Log - every
 * approval decision is recorded with sequence, requester, and decision.
 */

export class SelfApprovalError extends Error {
  constructor() {
    super('Segregation of duties: you cannot approve a document you created');
    this.name = 'SelfApprovalError';
  }
}

export function assertNotSelfApproval(createdBy: number | null | undefined, approverId: number, allowSupplyChainManagerException = false) {
  if (createdBy != null && createdBy === approverId && !allowSupplyChainManagerException) {
    throw new SelfApprovalError();
  }
}

export function requestApproval(params: {
  document_type: string;
  document_id: number;
  document_number?: string;
  required_role?: string;
  requested_by?: number;
  sequence?: number;
  warehouse_id?: number | null;
}) {
  const routing=params.required_role?approvalRecipients(params.required_role,params.warehouse_id):null;
  const effectiveRole=routing?.effectiveRole||params.required_role;
  db.prepare(
    `INSERT INTO approval_log (document_type, document_id, document_number, sequence, required_role, requested_by, decision)
     VALUES (?, ?, ?, ?, ?, ?, 'Pending')`
  ).run(
    params.document_type,
    params.document_id,
    params.document_number ?? null,
    params.sequence ?? 1,
    params.required_role ?? null,
    params.requested_by ?? null
  );
  if (effectiveRole) {
    const recipients = (routing?.recipients||[]).filter((recipient:any)=>recipient.id!==(params.requested_by??-1));
    for (const recipient of recipients) {
      const delegated=params.required_role!==effectiveRole?` Routed to ${effectiveRole.replace(/([a-z])([A-Z])/g,'$1 $2')} because no ${String(params.required_role).replace(/([a-z])([A-Z])/g,'$1 $2')} is currently available.`:'';
      const message = `${params.document_type} ${params.document_number || params.document_id} is waiting for your approval.${delegated}`;
      db.prepare(`INSERT INTO notifications (user_id,type,message) VALUES (?,?,?)`).run(recipient.id, 'ApprovalRequired', message);
      if (recipient.email) db.prepare(`INSERT INTO email_outbox (recipient_email,subject,body,related_type,related_id) VALUES (?,?,?,?,?)`).run(recipient.email, `Approval required: ${params.document_type} ${params.document_number || ''}`, message, params.document_type, params.document_id);
    }
  }
}

export function recordDecision(params: {
  document_type: string;
  document_id: number;
  decision: 'Approved' | 'Rejected';
  decision_by: number;
  comments?: string;
  manual_reference?: string;
  approval_snapshot?:{value:number;currency:string;limit:number;source:string;version?:number|null;effective_at:string;employee_id:number;role:string;workflow_level:string;escalation_rule?:string|null};
}) {
  const pending = db
    .prepare(
      `SELECT id FROM approval_log WHERE document_type = ? AND document_id = ? AND decision = 'Pending' ORDER BY sequence ASC LIMIT 1`
    )
    .get(params.document_type, params.document_id) as any;

  if (pending) {
    db.prepare(
      `UPDATE approval_log SET decision=?,decision_by=?,decision_date=datetime('now'),comments=?,manual_reference=?,approval_value=?,approval_currency=?,approval_limit_used=?,approval_limit_source=?,approval_limit_version=?,approval_limit_effective_at=?,approver_employee_id=?,approver_role=?,workflow_level=?,escalation_rule=? WHERE id=?`
    ).run(params.decision,params.decision_by,params.comments??null,params.manual_reference??null,params.approval_snapshot?.value??null,params.approval_snapshot?.currency??null,params.approval_snapshot?.limit??null,params.approval_snapshot?.source??null,params.approval_snapshot?.version??null,params.approval_snapshot?.effective_at??null,params.approval_snapshot?.employee_id??null,params.approval_snapshot?.role??null,params.approval_snapshot?.workflow_level??null,params.approval_snapshot?.escalation_rule??null,pending.id);
  } else {
    // No pending request row existed (e.g. auto-approved docs) - log the decision directly for a complete audit trail
    db.prepare(
      `INSERT INTO approval_log(document_type,document_id,decision,decision_by,decision_date,comments,manual_reference,approval_value,approval_currency,approval_limit_used,approval_limit_source,approval_limit_version,approval_limit_effective_at,approver_employee_id,approver_role,workflow_level,escalation_rule) VALUES(?,?,?,?,datetime('now'),?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(params.document_type,params.document_id,params.decision,params.decision_by,params.comments??null,params.manual_reference??null,params.approval_snapshot?.value??null,params.approval_snapshot?.currency??null,params.approval_snapshot?.limit??null,params.approval_snapshot?.source??null,params.approval_snapshot?.version??null,params.approval_snapshot?.effective_at??null,params.approval_snapshot?.employee_id??null,params.approval_snapshot?.role??null,params.approval_snapshot?.workflow_level??null,params.approval_snapshot?.escalation_rule??null);
  }
}

export function getApprovalHistory(document_type: string, document_id: number) {
  return db
    .prepare(
      `SELECT al.*, u1.full_name AS requested_by_name, u2.full_name AS decision_by_name, e1.signature_url AS requested_by_signature_url, e2.signature_url AS decision_by_signature_url
       FROM approval_log al
       LEFT JOIN users u1 ON u1.id = al.requested_by
       LEFT JOIN users u2 ON u2.id = al.decision_by
       LEFT JOIN employees e1 ON e1.id=u1.employee_id
       LEFT JOIN employees e2 ON e2.id=u2.employee_id
       WHERE al.document_type = ? AND al.document_id = ?
       ORDER BY al.sequence ASC, al.id ASC`
    )
    .all(document_type, document_id);
}
