import db from '../db';
import { getSettingNumber } from './settings';

export function activePoApprovalLimit(userId:number){
  const row=db.prepare(`SELECT e.id employee_id,e.approval_limit,e.status,u.role FROM users u JOIN employees e ON e.id=u.employee_id WHERE u.id=? AND u.is_active=1 AND u.deleted_at IS NULL AND e.status='Active' AND e.deleted_at IS NULL`).get(userId)as any;
  if(!row||!['PurchaseOfficer','PurchaseManager','SupplyChainManager'].includes(row.role))return null;
  const assigned=Number(row.approval_limit);return{employee_id:row.employee_id,role:row.role,limit:Number.isFinite(assigned)&&assigned>=0?assigned:getSettingNumber(`approval_limit_${String(row.role).replace(/([a-z])([A-Z])/g,'$1_$2').toLowerCase()}`),currency:String((db.prepare("SELECT COALESCE(base_currency,currency,'SAR') currency FROM company WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1").get()as any)?.currency||'SAR')};
}

export function activeIssueLimit(userId:number,warehouseId:number){
  const employee=db.prepare(`SELECT e.id employee_id,e.status,u.role FROM users u JOIN employees e ON e.id=u.employee_id WHERE u.id=? AND u.is_active=1 AND u.deleted_at IS NULL AND e.status='Active' AND e.deleted_at IS NULL`).get(userId)as any;if(!employee)return null;
  const row=db.prepare(`SELECT * FROM material_issue_authorization_limits WHERE employee_id=? AND active_yn=1 AND (warehouse_id=? OR warehouse_id IS NULL) AND effective_from<=date('now') AND (expiry_date IS NULL OR expiry_date>=date('now')) ORDER BY warehouse_id IS NOT NULL DESC,effective_from DESC,id DESC LIMIT 1`).get(employee.employee_id,warehouseId)as any;
  return{employee_id:employee.employee_id,role:employee.role,limit_id:row?.id??null,value_limit:row?Number(row.value_limit):getSettingNumber('material_issue_approval_threshold'),quantity_limit:row?.quantity_limit==null?null:Number(row.quantity_limit),category_scope:row?.category_scope||null,currency:row?.currency||String((db.prepare("SELECT COALESCE(base_currency,currency,'SAR') currency FROM company WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1").get()as any)?.currency||'SAR')};
}
