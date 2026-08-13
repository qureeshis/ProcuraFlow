import db from '../db';

const ESCALATION_CHAIN:Record<string,string[]>={
  PurchaseOfficer:['PurchaseOfficer','PurchaseManager','SupplyChainManager'],
  PurchaseManager:['PurchaseManager','SupplyChainManager'],
  WarehouseSupervisor:['WarehouseSupervisor','WarehouseManager','SupplyChainManager'],
  Storekeeper:['Storekeeper','WarehouseManager','SupplyChainManager'],
  Helper:['Helper','WarehouseManager','SupplyChainManager'],
  WarehouseManager:['WarehouseManager','SupplyChainManager'],
  // A Purchase Manager, then a Purchase Officer, may act only when no active
  // and available Supply Chain Manager exists. Route-level permissions still
  // apply, so this is controlled absence cover rather than permanent access.
  SupplyChainManager:['SupplyChainManager','PurchaseManager','PurchaseOfficer'],
};

function availableUsers(role:string,warehouseId?:number|null){
  const warehouseRestricted=role==='WarehouseManager'&&Number.isInteger(Number(warehouseId));
  return db.prepare(`SELECT DISTINCT u.id,u.full_name,e.email,e.id employee_id,u.role
    FROM users u LEFT JOIN employees e ON e.id=u.employee_id
    LEFT JOIN user_warehouse_assignments uwa ON uwa.user_id=u.id AND uwa.is_active=1
    LEFT JOIN employee_warehouse_assignments ewa ON ewa.employee_id=e.id AND ewa.active_yn=1
    WHERE u.role=? AND u.is_active=1 AND u.deleted_at IS NULL AND u.locked_reason IS NULL
      AND (e.id IS NULL OR (e.status='Active' AND e.deleted_at IS NULL))
      AND COALESCE((SELECT a.availability_status FROM employee_availability a WHERE a.employee_id=e.id AND date('now') BETWEEN date(a.date_from) AND date(a.date_to) ORDER BY a.id DESC LIMIT 1),'Available')='Available'
      AND (?=0 OR u.warehouse_id=? OR uwa.warehouse_id=? OR ewa.all_warehouses_yn=1 OR ewa.warehouse_id=?)
    ORDER BY u.id`).all(role,warehouseRestricted?1:0,warehouseId??null,warehouseId??null,warehouseId??null)as any[];
}

export function effectiveApprovalRole(requiredRole:string,warehouseId?:number|null){
  const chain=ESCALATION_CHAIN[requiredRole]||[requiredRole,'SupplyChainManager'];
  return chain.find(role=>availableUsers(role,warehouseId).length>0)||'SupplyChainManager';
}

export function approvalRecipients(requiredRole:string,warehouseId?:number|null){
  const effectiveRole=effectiveApprovalRole(requiredRole,warehouseId);
  return{effectiveRole,recipients:availableUsers(effectiveRole,warehouseId)};
}

export function assertApprovalAuthority(documentType:string,documentId:number,userId:number,userRole:string,defaultRequiredRole:string,warehouseId?:number|null){
  const pending=db.prepare("SELECT required_role FROM approval_log WHERE document_type=? AND document_id=? AND decision='Pending' ORDER BY sequence,id LIMIT 1").get(documentType,documentId)as any;
  const requiredRole=String(pending?.required_role||defaultRequiredRole);
  const effectiveRole=effectiveApprovalRole(requiredRole,warehouseId);
  if(userRole!==effectiveRole)throw Object.assign(new Error(`Approval is currently assigned to the nearest available ${effectiveRole.replace(/([a-z])([A-Z])/g,'$1 $2')}`),{status:403,effectiveRole,requiredRole});
  if(!availableUsers(effectiveRole,warehouseId).some(user=>Number(user.id)===Number(userId)))throw Object.assign(new Error('Your employee account is currently unavailable, inactive, locked, or outside the responsible warehouse'),{status:403,effectiveRole,requiredRole});
  return{requiredRole,effectiveRole,delegated:requiredRole!==effectiveRole};
}

export function canUserApprove(documentType:string,documentId:number,userId:number,userRole:string,defaultRequiredRole:string,warehouseId?:number|null){try{assertApprovalAuthority(documentType,documentId,userId,userRole,defaultRequiredRole,warehouseId);return true;}catch{return false;}}

function documentWarehouse(documentType:string,documentId:number){if(documentType==='ISSUE')return Number((db.prepare('SELECT warehouse_id FROM material_issue_items WHERE issue_id=? ORDER BY id LIMIT 1').get(documentId)as any)?.warehouse_id)||null;if(documentType==='ADJUSTMENT')return Number((db.prepare('SELECT warehouse_id FROM stock_adjustments WHERE id=?').get(documentId)as any)?.warehouse_id)||null;if(documentType==='CYCLECOUNT')return Number((db.prepare('SELECT warehouse_id FROM cycle_counts WHERE id=?').get(documentId)as any)?.warehouse_id)||null;return null;}

export function refreshPendingApprovalRouting(){const pending=db.prepare("SELECT document_type,document_id,document_number,required_role FROM approval_log WHERE decision='Pending' ORDER BY id").all()as any[];let routed=0;for(const approval of pending){const warehouseId=documentWarehouse(approval.document_type,approval.document_id),route=approvalRecipients(String(approval.required_role||'SupplyChainManager'),warehouseId),reference=approval.document_number||approval.document_id;for(const recipient of route.recipients){const message=`${approval.document_type} ${reference} is assigned to you for approval${route.effectiveRole!==approval.required_role?` on behalf of the unavailable ${String(approval.required_role).replace(/([a-z])([A-Z])/g,'$1 $2')}`:''}.`;if(!db.prepare("SELECT 1 FROM notifications WHERE user_id=? AND type='ApprovalRequired' AND message=? AND is_read=0").get(recipient.id,message)){db.prepare('INSERT INTO notifications(user_id,type,message) VALUES(?,?,?)').run(recipient.id,'ApprovalRequired',message);if(recipient.email)db.prepare('INSERT INTO email_outbox(recipient_email,subject,body,related_type,related_id) VALUES(?,?,?,?,?)').run(recipient.email,`Approval assignment: ${approval.document_type} ${reference}`,message,approval.document_type,approval.document_id);routed++;}}}return{pending:pending.length,notifications_created:routed};}
