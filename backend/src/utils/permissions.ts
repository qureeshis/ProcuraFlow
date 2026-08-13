export const TASK_PERMISSIONS=['task.pr','task.rfq','task.po','task.invoices','task.grn','task.material_issue','task.returns','task.transfers','task.adjustments','task.inventory','task.cycle_count','task.tools','task.vendor_scorecard','task.employees','task.suppliers','task.items','task.warehouses','task.settings','task.import_data','task.live_activity'] as const;
export const REPORT_PERMISSIONS=['report.procurement','report.inventory','report.warehouse','report.employee','report.tools','report.system','report.executive'] as const;
export const ACTION_PERMISSIONS=['po.view','po.create','po.edit','po.approve','po.reject','po.print','vendor.view','vendor.create','vendor.edit','vendor.disable','grn.view','grn.post','issue.view','issue.post','adjustment.view','adjustment.create','adjustment.approve'] as const;
export const ALL_PERMISSIONS=[...TASK_PERMISSIONS,...REPORT_PERMISSIONS,...ACTION_PERMISSIONS];
const ROLE_DEFAULTS:Record<string,string[]>={
  // System-wide operational administrator: every task, report, and action.
  SupplyChainManager:[...ALL_PERMISSIONS],
  PurchaseManager:['task.pr','task.rfq','task.po','task.invoices','task.employees','task.suppliers','task.items','po.view','po.create','po.edit','po.approve','po.reject','po.print','vendor.view','vendor.create','vendor.edit','vendor.disable','report.procurement'],
  PurchaseOfficer:['task.pr','task.rfq','task.po','task.invoices','task.suppliers','task.items','po.view','po.create','po.edit','po.approve','po.reject','po.print','vendor.view','vendor.create','vendor.edit','report.procurement'],
  WarehouseManager:['task.pr','task.po','task.grn','task.material_issue','task.returns','task.transfers','task.adjustments','task.inventory','task.cycle_count','task.tools','task.employees','task.warehouses','po.view','grn.view','grn.post','issue.view','issue.post','adjustment.view','adjustment.create','adjustment.approve','report.inventory','report.warehouse','report.employee','report.tools'],
  WarehouseSupervisor:['task.pr','task.po','task.grn','task.material_issue','task.returns','task.transfers','task.adjustments','task.inventory','task.cycle_count','task.tools','task.warehouses','po.view','grn.view','grn.post','issue.view','issue.post','adjustment.view','adjustment.create','report.inventory','report.warehouse','report.employee','report.tools'],
  Storekeeper:['task.pr','task.po','task.grn','task.material_issue','task.returns','task.transfers','task.inventory','task.tools','po.view','grn.view','grn.post','issue.view','issue.post','report.inventory','report.warehouse','report.employee','report.tools'],
};
export function defaultsForRole(role:string){return ROLE_DEFAULTS[role]||[];}
export function validatePermissions(role:string,value:unknown):string|null{let keys:string[];try{keys=Array.isArray(value)?value:JSON.parse(String(value||'[]'));}catch{return'Employee permissions must be a valid list';}if(!Array.isArray(keys)||keys.some(key=>!ALL_PERMISSIONS.includes(key as any)))return'Employee permissions contain an unknown function';const allowed=new Set(defaultsForRole(role));return keys.some(key=>!allowed.has(key))?'One or more permissions exceed the selected role authority':null;}
const PROC=new Set(['pr-register','rfq-status','quotation-comparison','po-register','open-po','po-delivery-performance','purchase-summary','supplier-purchase-analysis','po-aging','price-variance','finance-payment-verification','invoice-register','po-vs-grn','po-vs-invoice','grn-vs-invoice','three-way-match']);
const INV=new Set(['stock-balance','fifo-valuation','low-stock','batch-report','cycle-count-accuracy','bin-stock']);
const WH=new Set(['grn-register','daily-receiving','daily-issues','returns-report','transfers-report','transfer-receipts-report','adjustments-report','stock-ledger']);
const EMP=new Set(['consumption-by-employee','consumption-by-department','outstanding-returnables']);
const EXEC=new Set(['executive-supply-chain-overview','open-po-commitments','approval-governance','purchase-by-category','purchase-by-month','inventory-aging','location-stock-executive','supplier-performance-executive']);
export function permissionForRequest(originalUrl:string,method='GET'):string|null{
  const path=originalUrl.split('?')[0].replace(/^\/api/,'');
  // Operational forms read shared configuration such as payment terms,
  // transport modes, and issue thresholds. Only settings mutations remain
  // protected by the administration permission.
  if(path==='/settings'&&method==='GET')return null;
  if(path==='/settings/company'||path==='/settings/branding'||path==='/settings/approval-limits')return null;
  if(path.startsWith('/reports/')){const key=path.split('/')[2];if(PROC.has(key))return'report.procurement';if(INV.has(key))return'report.inventory';if(WH.has(key))return'report.warehouse';if(EMP.has(key))return'report.employee';if(key==='tool-condition')return'report.tools';if(['user-activity-log','employee-permissions','inventory-integrity','duplicate-master-data','segregation-of-duties','system-integrity-summary','legacy-ledger-reconciliation','warehouse-access-verification','audit-finding-closure','backup-restore-history','audit-control-center'].includes(key))return'report.system';if(EXEC.has(key))return'report.executive';}
  if(path.startsWith('/procurement/pos')){if(method==='GET')return'po.view';if(/\/approve$/.test(path))return'po.approve';if(/\/reject$/.test(path))return'po.reject';if(/\/print$/.test(path))return'po.print';return method==='POST'?'po.create':'po.edit';}
  if(path.startsWith('/warehouse/grns'))return method==='GET'?'grn.view':'grn.post';
  if(path.startsWith('/warehouse/material-issues'))return method==='GET'?'issue.view':/\/(approve|reject)$/.test(path)?'adjustment.approve':'issue.post';
  if(path.startsWith('/warehouse/adjustments'))return method==='GET'?'adjustment.view':/\/approve$/.test(path)?'adjustment.approve':'adjustment.create';
  const mappings:[string,string][]=[['/procurement/pr','task.pr'],['/procurement/rfq','task.rfq'],['/procurement/quot','task.rfq'],['/procurement/pos','task.po'],['/procurement/invoices','task.invoices'],['/warehouse/grns','task.grn'],['/warehouse/material-issues','task.material_issue'],['/warehouse/returns','task.returns'],['/warehouse/transfers','task.transfers'],['/warehouse/adjustments','task.adjustments'],['/inventory/cycle-counts','task.cycle_count'],['/inventory','task.inventory'],['/advanced/tools','task.tools'],['/advanced/vendor-scorecard','task.vendor_scorecard'],['/masters/employees','task.employees'],['/masters/suppliers','task.suppliers'],['/masters/items','task.items'],['/masters/warehouses','task.warehouses'],['/masters/locations','task.warehouses'],['/settings/imports','task.import_data'],['/settings','task.settings'],['/dashboard/activity/live','task.live_activity']];
  const found=mappings.find(([prefix])=>path.startsWith(prefix));
  if(path.startsWith('/masters/items')||(found&&method==='GET'&&['/masters/suppliers','/masters/warehouses','/masters/locations'].some(prefix=>path.startsWith(prefix))))return null;
  return found?.[1]||null;
}
