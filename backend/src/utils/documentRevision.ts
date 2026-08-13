import db from '../db';
import { logAudit } from './auditLog';

export function captureApprovedRevision(documentType:string,documentId:number,changedBy:number,reason:unknown,previousValues:unknown,newValues:unknown,material=true){
  const explanation=String(reason||'').trim();
  if(!explanation)throw Object.assign(new Error('A revision reason is required when changing an approved document'),{status:400});
  const next=Number((db.prepare('SELECT COALESCE(MAX(revision_number),0)+1 n FROM document_revisions WHERE document_type=? AND document_id=?').get(documentType,documentId) as any).n);
  const status=material?'Pending Reapproval':'Approved - Non-Material';
  const result=db.prepare(`INSERT INTO document_revisions(document_type,document_id,revision_number,changed_by,change_reason,previous_values,new_values,approval_status,reapproval_required)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(documentType,documentId,next,changedBy,explanation,JSON.stringify(previousValues),JSON.stringify(newValues),status,material?1:0);
  logAudit('document_revisions',Number(result.lastInsertRowid),'CREATE',changedBy,undefined,{document_type:documentType,document_id:documentId,revision_number:next,material,reason:explanation});
  return next;
}
