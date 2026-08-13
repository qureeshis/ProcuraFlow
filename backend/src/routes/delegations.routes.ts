import {Router} from 'express';
import crypto from 'crypto';
import db from '../db';
import {requireAuth,AuthedRequest} from '../middleware/auth';
import {requireRole} from '../middleware/rbac';
import {logAudit} from '../utils/auditLog';
import {ELIGIBLE_HANDOFF_ROLES,HANDOFF_AUTHORITY,financeDepartment} from '../utils/delegatedAuthority';

const router=Router();
const management=[requireAuth,requireRole('SupplyChainManager')] as const;

router.get('/',...management,(_req,res)=>{
  const rows=db.prepare(`SELECT da.*,delegator.name delegator_name,delegate.name delegate_name,d.name delegate_department,
    CASE WHEN da.status='REVOKED' THEN 'REVOKED' WHEN datetime('now')<datetime(da.effective_from) THEN 'FUTURE' WHEN datetime('now')>datetime(da.effective_until) THEN 'EXPIRED' ELSE 'ACTIVE' END effective_status
    FROM delegated_authorities da JOIN employees delegator ON delegator.id=da.delegator_employee_id JOIN employees delegate ON delegate.id=da.delegate_employee_id LEFT JOIN departments d ON d.id=delegate.department_id ORDER BY da.created_at DESC`).all();
  res.json(rows);
});

router.get('/eligible-employees',...management,(_req,res)=>res.json(db.prepare(`SELECT e.id,e.employee_code,e.name,e.approval_role,d.name department_name
  FROM employees e JOIN users u ON u.employee_id=e.id LEFT JOIN departments d ON d.id=e.department_id
  WHERE e.status='Active' AND e.deleted_at IS NULL AND e.system_access_yn=1 AND u.is_active=1 AND u.deleted_at IS NULL
    AND e.approval_role IN ('PurchaseManager','WarehouseManager','SupplyChainManager') AND lower(COALESCE(d.name,''))<>'finance' ORDER BY e.name`).all()));

router.post('/',...management,(req:AuthedRequest,res)=>{
  const b=req.body||{},delegateId=Number(b.delegate_employee_id),delegator=db.prepare(`SELECT e.id,e.name,e.approval_role,d.name department_name FROM users u JOIN employees e ON e.id=u.employee_id LEFT JOIN departments d ON d.id=e.department_id WHERE u.id=? AND e.status='Active' AND e.deleted_at IS NULL`).get(req.user!.id) as any;
  const delegate=db.prepare(`SELECT e.id,e.name,e.approval_role,e.status,e.system_access_yn,d.name department_name,u.id user_id,u.is_active FROM employees e LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN users u ON u.employee_id=e.id AND u.deleted_at IS NULL WHERE e.id=? AND e.deleted_at IS NULL`).get(delegateId) as any;
  if(!delegator||delegator.approval_role!=='SupplyChainManager')return res.status(403).json({error:'Only an active Supply Chain Manager may delegate this authority'});
  if(delegateId===Number(delegator.id))return res.status(409).json({error:'Self-delegation is not permitted'});
  if(!delegate||delegate.status!=='Active'||!delegate.is_active||delegate.system_access_yn===0)return res.status(400).json({error:'Delegate must have an active employee record and active ProcuraFlow account'});
  if(financeDepartment(delegate)||String(delegate.approval_role).toLowerCase()==='finance')return res.status(403).json({error:'Finance employees cannot receive ProcuraFlow delegated authority'});
  if(!ELIGIBLE_HANDOFF_ROLES.includes(String(delegate.approval_role)))return res.status(403).json({error:'Delegate role is not eligible for Finance External Handoff authority'});
  const from=String(b.effective_from||''),until=String(b.effective_until||''),scope=String(b.scope_type||'ALL_PROCUREMENT'),scopeId=b.scope_id==null?null:Number(b.scope_id);
  if(!from||!until||Number.isNaN(Date.parse(from))||Number.isNaN(Date.parse(until))||Date.parse(until)<=Date.parse(from))return res.status(400).json({error:'A valid effective period with expiry after start is required'});
  if(!['ALL_PROCUREMENT','INVOICE','WAREHOUSE'].includes(scope)||(scope!=='ALL_PROCUREMENT'&&!Number.isInteger(scopeId)))return res.status(400).json({error:'Select a valid, specific delegation scope'});
  if(!String(b.reason||'').trim()||!String(b.business_justification||'').trim())return res.status(400).json({error:'Reason and business justification are required'});
  const overlap=db.prepare(`SELECT id FROM delegated_authorities WHERE delegate_employee_id=? AND authority_type=? AND status='ACTIVE' AND datetime(effective_from)<datetime(?) AND datetime(effective_until)>datetime(?)`).get(delegateId,HANDOFF_AUTHORITY,until,from);
  if(overlap)return res.status(409).json({error:'An overlapping active delegation already exists for this employee'});
  const number=`DEL-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
  const result=db.prepare(`INSERT INTO delegated_authorities(delegation_number,delegator_employee_id,delegate_employee_id,delegate_role,authority_type,scope_type,scope_id,effective_from,effective_until,reason,business_justification,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(number,delegator.id,delegateId,delegate.approval_role,HANDOFF_AUTHORITY,scope,scopeId,from,until,String(b.reason).trim(),String(b.business_justification).trim(),req.user!.id);
  db.prepare(`INSERT INTO notifications(user_id,type,message) VALUES(?, 'DelegatedAuthority', ?)`).run(delegate.user_id,`Finance External Handoff authority ${number} granted by ${delegator.name}, effective ${from} through ${until}. Scope: ${scope}${scopeId?` ${scopeId}`:''}.`);
  logAudit('delegated_authorities',Number(result.lastInsertRowid),'CREATE',req.user!.id,undefined,{delegation_number:number,delegate_employee_id:delegateId,normal_role:delegate.approval_role,authority_type:HANDOFF_AUTHORITY,scope_type:scope,scope_id:scopeId,effective_from:from,effective_until:until,reason:b.reason,business_justification:b.business_justification,re_delegation_allowed:false});
  res.status(201).json({id:result.lastInsertRowid,delegation_number:number});
});

router.put('/:id/revoke',...management,(req:AuthedRequest,res)=>{
  const row=db.prepare("SELECT * FROM delegated_authorities WHERE id=? AND status='ACTIVE'").get(req.params.id) as any;if(!row)return res.status(404).json({error:'Active delegation not found'});
  const reason=String(req.body?.reason||'').trim();if(!reason)return res.status(400).json({error:'Revocation reason is required'});
  db.prepare("UPDATE delegated_authorities SET status='REVOKED',revoked_by=?,revoked_at=datetime('now'),revocation_reason=? WHERE id=? AND status='ACTIVE'").run(req.user!.id,reason,row.id);
  logAudit('delegated_authorities',row.id,'UPDATE',req.user!.id,row,{action:'REVOKE',reason});res.json({success:true,status:'REVOKED'});
});

export default router;
