import db from '../db';

export const HANDOFF_AUTHORITY='FINANCE_EXTERNAL_HANDOFF';
export const ELIGIBLE_HANDOFF_ROLES=['PurchaseManager','WarehouseManager','SupplyChainManager'];

export function financeDepartment(employee:any){return String(employee?.department_name||'').trim().toLowerCase()==='finance';}

export function assertExternalHandoffAuthority(userId:number,invoiceId:number){
  const actor=db.prepare(`SELECT u.id user_id,u.role,u.is_active,e.id employee_id,e.status,d.name department_name
    FROM users u JOIN employees e ON e.id=u.employee_id LEFT JOIN departments d ON d.id=e.department_id
    WHERE u.id=? AND u.deleted_at IS NULL AND e.deleted_at IS NULL`).get(userId) as any;
  if(!actor||!actor.is_active||actor.status!=='Active')throw Object.assign(new Error('The employee and user account must both be active'),{status:403});
  if(financeDepartment(actor)||String(actor.role).toLowerCase()==='finance')throw Object.assign(new Error('Finance employees have no ProcuraFlow authority, including delegated authority'),{status:403});
  if(actor.role==='SupplyChainManager')return{actor,delegation:null};
  const delegation=db.prepare(`SELECT da.*,de.name delegated_by_name FROM delegated_authorities da
    JOIN employees de ON de.id=da.delegator_employee_id
    WHERE da.delegate_employee_id=? AND da.authority_type=? AND da.status='ACTIVE'
      AND datetime('now')>=datetime(da.effective_from) AND datetime('now')<=datetime(da.effective_until)
      AND (da.scope_type='ALL_PROCUREMENT' OR (da.scope_type='INVOICE' AND da.scope_id=?))
    ORDER BY datetime(da.effective_until) LIMIT 1`).get(actor.employee_id,HANDOFF_AUTHORITY,invoiceId) as any;
  if(!delegation)throw Object.assign(new Error('A current, unrevoked Finance External Handoff delegation is required'),{status:403});
  return{actor,delegation};
}
