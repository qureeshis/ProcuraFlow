import React, { useEffect, useState } from 'react';
import client from '../../api/client';
import MasterDataPage from './MasterDataPage';
import Modal from '../../components/Modal';
import { useAuth } from '../../contexts/AuthContext';
import { currencyFieldLabel, formatCurrency } from '../../utils/currency';
import { formatRole } from '../../utils/roles';

const PERMISSIONS=[
  {key:'task.pr',type:'Task',label:'Purchase Requisitions'},{key:'task.rfq',type:'Task',label:'RFQs & Quotations'},{key:'task.po',type:'Task',label:'Purchase Orders'},{key:'task.invoices',type:'Task',label:'Invoices & Three-Way Match'},
  {key:'task.grn',type:'Task',label:'Goods Receipts (GRN)'},{key:'task.material_issue',type:'Task',label:'Material Issues'},{key:'task.returns',type:'Task',label:'Material Returns'},{key:'task.transfers',type:'Task',label:'Warehouse Transfers'},{key:'task.adjustments',type:'Task',label:'Stock Adjustments'},
  {key:'task.inventory',type:'Task',label:'Inventory Inquiry & Valuation'},{key:'task.cycle_count',type:'Task',label:'Cycle Counts'},{key:'task.tools',type:'Task',label:'Tool Management'},{key:'task.vendor_scorecard',type:'Task',label:'Vendor Scorecards'},
  {key:'task.employees',type:'Administration',label:'Employee Master'},{key:'task.suppliers',type:'Administration',label:'Supplier Master'},{key:'task.items',type:'Administration',label:'Item Master'},{key:'task.warehouses',type:'Administration',label:'Warehouses & Locations'},{key:'task.settings',type:'Administration',label:'System Settings'},{key:'task.import_data',type:'Administration',label:'Data Imports'},{key:'task.live_activity',type:'Administration',label:'Live User Activity'},
  {key:'report.procurement',type:'Report',label:'Procurement Reports'},{key:'report.inventory',type:'Report',label:'Inventory Reports'},{key:'report.warehouse',type:'Report',label:'Warehouse Reports'},{key:'report.employee',type:'Report',label:'Employee Accountability Reports'},{key:'report.tools',type:'Report',label:'Tool Reports'},{key:'report.system',type:'Report',label:'System Administration Reports'},{key:'report.executive',type:'Report',label:'Executive Reports'},
];
const ROLE_DEFAULTS:Record<string,string[]>={SupplyChainManager:PERMISSIONS.map(p=>p.key).filter(key=>key!=='task.items'),PurchaseManager:['task.pr','task.rfq','task.po','task.invoices','task.employees','task.suppliers','task.items','report.procurement'],PurchaseOfficer:['task.pr','task.rfq','task.po','task.invoices','task.suppliers','task.items','report.procurement'],WarehouseManager:['task.pr','task.po','task.grn','task.material_issue','task.returns','task.transfers','task.adjustments','task.inventory','task.cycle_count','task.tools','task.employees','task.warehouses','report.inventory','report.warehouse','report.employee','report.tools'],WarehouseSupervisor:['task.pr','task.po','task.grn','task.material_issue','task.returns','task.transfers','task.adjustments','task.inventory','task.cycle_count','task.tools','task.warehouses','report.inventory','report.warehouse','report.employee','report.tools'],Storekeeper:['task.pr','task.po','task.grn','task.material_issue','task.returns','task.inventory','task.tools','report.inventory','report.warehouse','report.employee','report.tools'],Helper:[]};
ROLE_DEFAULTS.SupplyChainManager=PERMISSIONS.map(permission=>permission.key);
const REPORTING_HIERARCHY:Record<string,string[]>={SupplyChainManager:['SupplyChainManager'],PurchaseManager:['SupplyChainManager'],PurchaseOfficer:['PurchaseManager','SupplyChainManager'],WarehouseManager:['SupplyChainManager'],WarehouseSupervisor:['WarehouseManager','SupplyChainManager'],Storekeeper:['WarehouseManager','SupplyChainManager'],Helper:['WarehouseManager','SupplyChainManager']};
function permissionList(value:any,role:string){try{return value?JSON.parse(value):ROLE_DEFAULTS[role]||[];}catch{return ROLE_DEFAULTS[role]||[];}}
function warehouseIds(employee:any){try{return JSON.parse(employee.warehouse_ids_json||'[]').map(Number);}catch{return employee.warehouse_id?[Number(employee.warehouse_id)]:[];}}
function reportingRolesForForm(form:any,employees:any[]){const role=String(form.approval_role||''),chain=REPORTING_HIERARCHY[role]||[];if(chain.length<2)return chain;const selected=(Array.isArray(form.warehouse_ids)?form.warehouse_ids:[]).map(Number);const primaryAvailable=employees.some(employee=>{if(employee.approval_role!==chain[0])return false;if(role==='PurchaseOfficer')return true;return !!employee.all_warehouses_yn||selected.some((id:number)=>warehouseIds(employee).includes(id));});return primaryAvailable?[chain[0]]:[chain[1]];}

export default function EmployeesPage() {
  const { user } = useAuth();
  const [depts, setDepts] = useState<{ value: any; label: string }[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<{ value: any; label: string }[]>([]);
  const [credentials, setCredentials] = useState<{ employee_code: string; username: string; password: string } | null>(null);
  const [roleLimits,setRoleLimits]=useState<Record<string,number>>({});
  const [roleDefaults,setRoleDefaults]=useState<Record<string,string[]>>(ROLE_DEFAULTS);
  const departmentIsWarehouse=(departmentId:any)=>/\bwarehouse\b/i.test(String(depts.find(dept=>String(dept.value)===String(departmentId))?.label||''));
  // Keep an explicit selection flag so the dependent warehouse controls render in
  // the same event cycle as the Department change. The lookup remains the source
  // of truth when an existing employee is opened for editing.
  const isWarehouseDepartment=(form:any)=>form._warehouse_department_selected===true||departmentIsWarehouse(form.department_id);

  useEffect(() => {
    client.get('/masters/departments').then((res) => setDepts(res.data.map((d: any) => ({ value: d.id, label: d.name }))));
    client.get('/masters/employee-directory').then((res) => setEmployees(res.data.map((e: any) => ({ ...e, value: e.id, label: `${e.employee_code} — ${e.name} (${formatRole(e.approval_role)}${e.department_name?` / ${e.department_name}`:''})` }))));
    client.get('/masters/warehouses').then((res) => setWarehouses(res.data.map((w: any) => ({ value: w.id, label: w.name }))));
    client.get('/settings/approval-limits').then((res)=>setRoleLimits(res.data)).catch(()=>undefined);
    client.get('/masters/role-permission-defaults').then((res)=>setRoleDefaults({...ROLE_DEFAULTS,...res.data})).catch(()=>undefined);
  }, []);

  return (<>
    <MasterDataPage
      title="Employees"
      description="Used for material issuance, approval routing, and reporting structure."
      endpoint="/masters/employees"
      deriveForm={(form) => ({ ...form,warehouse_ids:Array.isArray(form.warehouse_ids)?form.warehouse_ids:(()=>{try{return JSON.parse(form.warehouse_ids_json||'[]')}catch{return form.warehouse_id?[form.warehouse_id]:[]}})(),primary_warehouse_id:form.primary_warehouse_id||form.warehouse_id,name:[form.first_name,form.last_name].map((v)=>String(v||'').trim()).filter(Boolean).join(' ') })}
      wideForm
      transformFieldChange={(field,value,form)=>field.key==='department_id'?(()=>{const warehouse=departmentIsWarehouse(value);return{...form,department_id:value,_warehouse_department_selected:warehouse,...(!warehouse?{warehouse_ids:[],warehouse_id:null,primary_warehouse_id:null,all_warehouses_yn:0}:{}),reports_to_employee_id:null};})():field.key==='approval_role'?{...form,approval_role:value,reports_to_employee_id:null,approval_limit:roleLimits[value]??0,permission_keys:JSON.stringify(roleDefaults[value]||[]),system_access_yn:value==='Helper'?0:1}:field.key==='warehouse_ids'?(()=>{const selected=(Array.isArray(value)?value:[]).map(Number).filter(Boolean),currentPrimary=Number(form.primary_warehouse_id);const primary=selected.includes(currentPrimary)?currentPrimary:(selected[0]||null);return{...form,warehouse_ids:selected,warehouse_id:primary,primary_warehouse_id:primary};})():field.key==='primary_warehouse_id'?(()=>{const primary=Number(value)||null,selected=(Array.isArray(form.warehouse_ids)?form.warehouse_ids:[]).map(Number).filter(Boolean);return{...form,warehouse_ids:primary&&!selected.includes(primary)?[...selected,primary]:selected,primary_warehouse_id:primary,warehouse_id:primary};})():{...form,[field.key]:value}}
      extraPayload={user?.role==='SupplyChainManager'?(form,editing)=>{const allowed=new Set(ROLE_DEFAULTS[String(form.approval_role||'')]||[]),warehouse=isWarehouseDepartment(form),warehouseId=warehouse?(Number(form.primary_warehouse_id||form.warehouse_id)||null):null,base={permission_keys:JSON.stringify(permissionList(form.permission_keys,String(form.approval_role||'')).filter((key:string)=>allowed.has(key))),warehouse_id:warehouseId};return editing?base:{...base,warehouse_ids:warehouse?(form.warehouse_ids||[]):[],all_warehouses_yn:warehouse&&form.all_warehouses_yn?1:0,primary_warehouse_id:warehouseId}}:undefined}
      onSaved={user?.role==='SupplyChainManager'?async(record,form,editing)=>{if(editing)await client.put(`/masters/employees/${record.id}/warehouse-assignments`,{warehouse_ids:form.warehouse_ids||[],all_warehouses_yn:!!form.all_warehouses_yn,primary_warehouse_id:form.primary_warehouse_id||null});const role=String(form.approval_role||record.approval_role||'');const keys=permissionList(form.permission_keys,role);if(role){await client.put(`/masters/role-permission-defaults/${role}`,{permission_keys:keys});setRoleDefaults(current=>({...current,[role]:keys}));}}:undefined}
      renderFormExtra={user?.role==='SupplyChainManager'?(form,setForm)=>{const role=String(form.approval_role||'');const allowed=ROLE_DEFAULTS[role]||[];const selected=permissionList(form.permission_keys,role).filter((key:string)=>allowed.includes(key));const types=['Task','Administration','Report'];return <><div className="rounded-xl border border-sky-200 bg-sky-50/40 p-4"><h3 className="font-semibold text-sky-950">Reporting Structure</h3><p className="mt-1 text-xs text-slate-600">The Reports To list uses the nearest active manager for the role and warehouse. If that manager role is unavailable, it automatically falls back to the Supply Chain Manager.</p><div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">{Object.entries(REPORTING_HIERARCHY).filter(([roleName])=>roleName!=='SupplyChainManager').map(([roleName,managerRoles])=><div key={roleName} className="rounded-lg border border-sky-100 bg-white px-3 py-2"><span className="font-semibold text-slate-700">{formatRole(roleName)}</span><span className="mx-2 text-sky-500">→</span><span className="text-slate-600">{managerRoles.map((managerRole,index)=>(index?'SCM fallback: ':'Primary: ')+formatRole(managerRole)).join(' · ')}</span></div>)}</div></div><div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-indigo-950">Application Task & Report Assignment</h3><p className="mt-1 text-xs text-slate-600">Role-approved functions are preselected. Clear a function to restrict this individual; permissions outside the selected role cannot be assigned.</p></div><button type="button" className="btn-secondary" disabled={!role} onClick={()=>setForm(current=>({...current,permission_keys:JSON.stringify(roleDefaults[role]||allowed)}))}>Apply Role Defaults</button></div>{!role?<div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Select an Approval Role to load its authorized task and report matrix.</div>:<div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white"><table className="w-full text-sm"><thead className="bg-slate-800 text-white"><tr><th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-left">Application Function / Report Group</th><th className="px-3 py-2 text-center">Assigned</th></tr></thead><tbody>{types.flatMap(type=>PERMISSIONS.filter(permission=>permission.type===type&&allowed.includes(permission.key)).map((permission,index)=><tr key={permission.key} className="border-t border-slate-100 hover:bg-indigo-50/50"><td className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{index===0?type:''}</td><td className="px-3 py-2 font-medium text-slate-700">{permission.label}</td><td className="px-3 py-2 text-center"><input type="checkbox" checked={selected.includes(permission.key)} onChange={(e)=>{const next=e.target.checked?[...selected,permission.key]:selected.filter((key:string)=>key!==permission.key);setForm(current=>({...current,permission_keys:JSON.stringify(next)}));}}/></td></tr>))}</tbody></table></div>}<div className="mt-3 flex justify-between text-xs text-slate-500"><span>Selected role: <strong>{role.replace(/([a-z])([A-Z])/g,'$1 $2')||'None'}</strong></span><span><strong>{selected.length}</strong> of {allowed.length} role-authorized functions assigned</span></div></div></>}:undefined}
      onCreated={(record) => setCredentials(record.credentials || null)}
      columns={[
        { key: 'employee_code', label: 'Employee ID (auto-generated)', },
        { key: 'name', label: 'Name' },
        { key: 'login_id', label: 'Login ID', render: (record) => record.login_id ? <div><strong className="font-mono text-indigo-700">{record.login_id}</strong><div className={`text-[10px] ${record.login_status === 'Active' ? 'text-emerald-600' : 'text-amber-600'}`}>{record.login_status}</div></div> : <span className="text-xs text-slate-400">No login assigned</span> },
        { key:'system_access_yn',label:'System Access',render:(record)=><span className={`rounded-full px-2 py-1 text-xs font-semibold ${record.system_access_yn?'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-600'}`}>{record.system_access_yn?'Enabled':'No access'}</span>},
        { key: 'email', label: 'Email' },
        { key: 'payroll_number', label: 'Payroll No.' },
        { key: 'position', label: 'Position' },
        { key: 'warehouse_id', label: 'Assigned Warehouse', render: (record) => warehouses.find((warehouse) => Number(warehouse.value) === Number(record.warehouse_id))?.label || '—' },
        { key: 'department_name', label: 'Department' },
        { key:'assigned_warehouses',label:'Warehouse Responsibility',render:(record)=>record.all_warehouses_yn?'All Warehouses':record.assigned_warehouses||'—' },
        { key: 'approval_role', label: 'Approval Role', render: (record) => formatRole(record.approval_role) },
        { key: 'reports_to_employee_id', label: 'Reports To', render: (record) => employees.find((employee) => Number(employee.id) === Number(record.reports_to_employee_id))?.name || '—' },
        { key: 'approval_limit', label: currencyFieldLabel('Approval Limit'), render: (record) => formatCurrency(record.approval_limit) },
        { key: 'permission_keys', label: 'Assigned Functions', render:(record)=>`${permissionList(record.permission_keys,record.approval_role).length} assigned` },
        { key: 'status', label: 'Status' },
      ]}
      fields={[
        { key: 'first_name', label: 'First Name' },
        { key: 'middle_name', label: 'Middle Name' },
        { key: 'last_name', label: 'Last Name' },
        { key: 'name', label: 'Display Name (automatic)', readOnly: true },
        { key: 'email', label: 'Email Address' },
        { key: 'signature_file', label: 'Employee Signature', type: 'signature' },
        { key: 'date_of_birth', label: 'Date of Birth', type: 'date' },
        { key: 'payroll_number', label: 'Employee / Payroll No.' },
        { key: 'department_id', label: 'Department', type: 'select', options: depts },
        { key: 'position', label: 'Position' },
        { key:'warehouse_ids',label:'Assigned Warehouse(s)',type:'multicheckbox',options:warehouses,submit:false,visible:isWarehouseDepartment },
        { key:'all_warehouses_yn',label:'All Warehouses (automatically includes future warehouses)',type:'checkbox',submit:false,visible:isWarehouseDepartment },
        { key:'primary_warehouse_id',label:'Primary Warehouse',type:'select',options:warehouses,submit:false,visible:isWarehouseDepartment },
        {
          key: 'approval_role',
          label: 'Approval Role',
          type: 'select',
          options: [
            { value: 'PurchaseOfficer', label: 'Purchase Officer' },
            { value: 'PurchaseManager', label: 'Purchase Manager' },
            { value: 'WarehouseManager', label: 'Warehouse Manager' },
            { value: 'WarehouseSupervisor', label: 'Warehouse Supervisor' },
            { value: 'Storekeeper', label: 'Storekeeper' },
            { value: 'Helper', label: 'Helper — workforce only, no login' },
            { value: 'SupplyChainManager', label: 'Supply Chain Manager' },
          ],
        },
        { key: 'reports_to_employee_id', label: 'Reports To (automatic active-role fallback)', type: 'select', options: (form:any) => { const allowed=reportingRolesForForm(form,employees);const selected=(Array.isArray(form.warehouse_ids)?form.warehouse_ids:[]).map(Number);return employees.filter((employee)=>{if(Number(employee.id)===Number(form.id)||!allowed.includes(String(employee.approval_role)))return false;if(!['WarehouseSupervisor','Storekeeper','Helper'].includes(String(form.approval_role))||employee.approval_role==='SupplyChainManager')return true;const managerWarehouses=warehouseIds(employee);return !!employee.all_warehouses_yn||selected.some((id:number)=>managerWarehouses.includes(id));}); } },
        { key: 'approval_limit', label: currencyFieldLabel('Approval Limit'), type: 'number' },
        {
          key: 'status',
          label: 'Status',
          type: 'select',
          options: [
            { value: 'Active', label: 'Active' },
            { value: 'Inactive', label: 'Inactive' },
          ],
        },
      ]}
    />
    {credentials && (
      <Modal title="Employee Login Created" onClose={() => setCredentials(null)}>
        <div className="space-y-4 text-sm">
          <p className="text-slate-600">The employee ID and login were generated automatically. Save these credentials now; the temporary password is shown only on this screen.</p>
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-2">
            <div><span className="text-slate-500">Employee ID:</span> <strong className="select-all">{credentials.employee_code}</strong></div>
            <div><span className="text-slate-500">Username:</span> <strong className="select-all">{credentials.username}</strong></div>
            <div><span className="text-slate-500">Temporary password:</span> <strong className="select-all">{credentials.password}</strong></div>
          </div>
          <div className="flex justify-end"><button className="btn-primary" onClick={() => setCredentials(null)}>I have saved it</button></div>
        </div>
      </Modal>
    )}
  </>);
}
