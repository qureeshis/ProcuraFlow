import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import db from '../db';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { logAudit } from '../utils/auditLog';
import { assertNotSelfApproval, recordDecision } from '../utils/approvalLog';
import { maxApprovalFor } from '../middleware/rbac';
import { assertApprovalAuthority } from '../utils/approvalRouting';
import { authorizedWarehouseIds } from '../utils/warehouseAccess';

const router = Router();
const docsDir = path.join(__dirname, '../../uploads/documents');
fs.mkdirSync(docsDir, { recursive: true });
const upload = multer({
  dest: docsDir,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ['application/pdf', 'image/jpeg', 'image/png'].includes(file.mimetype)),
});
const allowedTypes = ['PR', 'PO', 'GRN', 'INVOICE', 'MANUAL_APPROVAL'];
const accessRoles: Record<string,string[]> = {
  PR: ['SupplyChainManager','PurchaseManager','PurchaseOfficer','WarehouseManager','WarehouseSupervisor','Storekeeper'],
  PO: ['SupplyChainManager','PurchaseManager','PurchaseOfficer','WarehouseManager','WarehouseSupervisor','Storekeeper'],
  GRN: ['SupplyChainManager','PurchaseManager','PurchaseOfficer','WarehouseManager','WarehouseSupervisor','Storekeeper'],
  INVOICE: ['SupplyChainManager','PurchaseManager','PurchaseOfficer'],
  MANUAL_APPROVAL: ['SupplyChainManager','PurchaseManager','PurchaseOfficer'],
};
const uploadRoles: Record<string,string[]> = {
  PR: accessRoles.PR, PO: ['SupplyChainManager','PurchaseManager','PurchaseOfficer'],
  GRN: ['SupplyChainManager','WarehouseManager','WarehouseSupervisor','Storekeeper'],
  INVOICE: ['SupplyChainManager','PurchaseManager','PurchaseOfficer'], MANUAL_APPROVAL: ['SupplyChainManager'],
};
function can(role: string, type: string, write = false) { return (write ? uploadRoles : accessRoles)[type]?.includes(role); }
function validSignature(filePath:string,mime:string){const b=fs.readFileSync(filePath).subarray(0,12);if(mime==='application/pdf')return b.subarray(0,5).toString()==='%PDF-';if(mime==='image/png')return b.length>=8&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));if(mime==='image/jpeg')return b.length>=3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff;return false;}
function documentExists(type: string, id: string) {
  const table = type === 'PR' ? 'purchase_requisitions' : type === 'PO' || type === 'MANUAL_APPROVAL' ? 'purchase_orders' : type === 'GRN' ? 'grns' : 'invoices';
  return !!db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id);
}
const warehouseScopedRoles = new Set(['WarehouseManager','WarehouseSupervisor','Storekeeper']);
function canAccessDocument(req: AuthedRequest, type: string, id: string) {
  if (!documentExists(type,id)) return false;
  if (!warehouseScopedRoles.has(req.user!.role)) return true;
  if (type === 'GRN') {
    const warehouseIds=authorizedWarehouseIds(req.user!.id);
    if(!warehouseIds.length)return false;
    return !!db.prepare(`SELECT 1 FROM grn_items WHERE grn_id=? AND warehouse_id IN (${warehouseIds.map(()=>'?').join(',')}) LIMIT 1`).get(id,...warehouseIds);
  }
  if (type === 'PO') {
    return !!db.prepare("SELECT 1 FROM purchase_orders WHERE id=? AND status IN ('Approved','Printed')").get(id);
  }
  return type === 'PR';
}

router.get('/file/:id', requireAuth, (req: AuthedRequest, res) => {
  const file = db.prepare('SELECT * FROM document_attachments WHERE id=?').get(req.params.id) as any;
  if (!file || !can(req.user!.role, file.document_type) || !canAccessDocument(req,file.document_type,String(file.document_id))) return res.status(404).json({ error: 'Attachment not found' });
  const filePath = path.resolve(docsDir, file.stored_name);
  if (!filePath.startsWith(path.resolve(docsDir) + path.sep) || !fs.existsSync(filePath)) return res.status(404).json({ error: 'Attachment file is missing' });
  res.type(file.mime_type); res.setHeader('Content-Disposition', `inline; filename="${String(file.original_name).replace(/["\r\n]/g,'_')}"`); res.sendFile(filePath);
});

router.get('/:type/:id', requireAuth, (req: AuthedRequest, res) => {
  const type = req.params.type.toUpperCase();
  if (!allowedTypes.includes(type)) return res.status(400).json({ error: 'Invalid document type' });
  if (!can(req.user!.role, type)) return res.status(403).json({ error: 'Your role cannot access this document type' });
  if (!canAccessDocument(req,type,req.params.id)) return res.status(404).json({ error: 'Document not found' });
  const rows = db.prepare(`SELECT da.*, u.full_name uploaded_by_name FROM document_attachments da LEFT JOIN users u ON u.id=da.uploaded_by WHERE document_type=? AND document_id=? ORDER BY uploaded_at DESC`).all(type, req.params.id);
  res.json(rows);
});

router.post('/:type/:id', requireAuth, upload.single('file'), (req: AuthedRequest, res) => {
  const type = req.params.type.toUpperCase();
  if (!allowedTypes.includes(type)) { if (req.file) fs.unlinkSync(req.file.path); return res.status(400).json({ error: 'Invalid document type' }); }
  if (!can(req.user!.role, type, true)) { if (req.file) fs.unlinkSync(req.file.path); return res.status(403).json({ error: 'Your role cannot upload this document type' }); }
  if (!req.file) return res.status(400).json({ error: 'A PDF, JPG, or PNG file is required (maximum 15 MB)' });
  if(!validSignature(req.file.path,req.file.mimetype)){fs.unlinkSync(req.file.path);return res.status(400).json({error:'File content does not match the declared PDF, JPG, or PNG type'});}
  if (!canAccessDocument(req,type,req.params.id)) { fs.unlinkSync(req.file.path); return res.status(404).json({ error: 'Document not found' }); }
  let po: any = null;
  if (type === 'MANUAL_APPROVAL') {
    po = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(req.params.id) as any;
    const externalRequired = !!po?.external_approval_required || Number(po?.total_amount) > maxApprovalFor('SupplyChainManager');
    if (!po || po.status !== 'PendingApproval' || !externalRequired) { fs.unlinkSync(req.file.path); return res.status(409).json({ error: 'This PO is not awaiting external management approval' }); }
    if (req.user!.role !== 'SupplyChainManager') { fs.unlinkSync(req.file.path); return res.status(403).json({ error: 'Only a Supply Chain Manager may upload and record signed higher-management approval' }); }
    try{assertApprovalAuthority('PO',Number(po.id),req.user!.id,req.user!.role,'SupplyChainManager');}catch(e:any){fs.unlinkSync(req.file.path);return res.status(e.status||403).json({error:e.message});}
    // The independent approver is the external management signatory. The SCM
    // may upload that signed evidence even when they originally created the PO.
    assertNotSelfApproval(po.created_by, req.user!.id, true);
  }
  try {
    const outcome = db.transaction(() => {
      const result = db.prepare(`INSERT INTO document_attachments (document_type,document_id,original_name,stored_name,mime_type,file_size,uploaded_by) VALUES (?,?,?,?,?,?,?)`).run(type, req.params.id, req.file!.originalname, req.file!.filename, req.file!.mimetype, req.file!.size, req.user!.id);
      logAudit('document_attachments', Number(result.lastInsertRowid), 'CREATE', req.user?.id, undefined, { type, document_id: Number(req.params.id), original_name: req.file!.originalname });
      if (type === 'MANUAL_APPROVAL') {
        const reference = po.management_approval_request_number || `PO-${po.po_number}`;
        db.prepare("UPDATE purchase_orders SET status='Approved', approval_ref_number=?, approval_person_name='Higher Management (signed approval on file)' WHERE id=?").run(reference, po.id);
        recordDecision({ document_type: 'PO', document_id: Number(po.id), decision: 'Approved', decision_by: req.user!.id, comments: 'Signed higher-management approval uploaded', manual_reference: reference });
        logAudit('purchase_orders', Number(po.id), 'APPROVE', req.user?.id, po, { approval_reference: reference, evidence_attachment_id: Number(result.lastInsertRowid) });
      }
      return result;
    })();
    res.status(201).json({ id: outcome.lastInsertRowid, original_name: req.file.originalname, url: `/uploads/documents/${req.file.filename}`, po_status: type === 'MANUAL_APPROVAL' ? 'Approved' : undefined });
  } catch (error) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    throw error;
  }
});

export default router;
