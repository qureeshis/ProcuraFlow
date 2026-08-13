import React, { useEffect, useState } from 'react';
import client from '../api/client';
import { formatCurrency } from '../utils/currency';
import { useNavigate } from 'react-router-dom';
import {useAuth} from '../contexts/AuthContext';

interface KPIs {
  dashboard_profile:'executive'|'procurement'|'warehouse';
  company_name: string;
  company_logo_url: string | null;
  financial_year: string | null;
  total_inventory_value: number;
  monthly_purchase: number;
  monthly_consumption: number;
  low_stock_items: number;
  pending_approvals: number;
  supplier_count: number;
  avg_supplier_rating: number;
  purchase_trend: Array<{ label: string; value: number }>;
  consumption_trend: Array<{ label: string; value: number }>;
  department_consumption: Array<{ department_name: string; total_value: number }>;
  warehouse_values: Array<{ warehouse_name: string; total_value: number }>;
  active_warehouse_employees:number; active_procurement_employees:number; morning_today:number; afternoon_today:number; evening_today:number; off_today:number; holiday_workers_today:number; unpublished_entries:number;coverage_warnings:number;
  open_prs:number;pending_pr_approvals:number;open_pos:number;outstanding_po_value:number;overdue_pos:number;out_of_stock_items:number;inactive_items:number;items_missing_reorder_level:number;invoices_pending:number;matched_invoices:number;invoice_exceptions:number;potential_duplicate_items:number;helpers_scheduled_today:number;employees_unavailable_today:number;
  po_status_distribution:Array<{label:string;value:number}>; invoice_match_trend:Array<{month:string;matched:number;exceptions:number;pending:number}>; stock_movement_trend:Array<{month:string;stock_in:number;stock_out:number}>;
}

function MiniBars({title,subtitle,rows,series}:{title:string;subtitle:string;rows:any[];series:Array<{key:string;label:string;color:string}>}){
  const max=Math.max(1,...rows.flatMap(row=>series.map(s=>Number(row[s.key]||0))));
  return <div className="card flex min-h-64 flex-col p-4"><div><h3 className="font-semibold text-slate-800">{title}</h3><p className="text-xs text-slate-500">{subtitle}</p></div><div className="mt-4 flex flex-1 items-end gap-3 border-b border-slate-200 px-1">{rows.map((row,index)=><div className="flex h-40 flex-1 items-end justify-center gap-1" key={`${row.month||row.label}-${index}`}>{series.map(s=><div key={s.key} title={`${s.label}: ${Number(row[s.key]||0).toLocaleString()}`} className={`w-full max-w-5 rounded-t ${s.color} transition hover:brightness-110`} style={{height:`${Math.max(4,Number(row[s.key]||0)/max*125)}px`}}/>)}</div>)}</div><div className="mt-2 flex justify-around gap-2 text-[9px] text-slate-500">{rows.map((row,index)=><span key={index}>{String(row.month||row.label||'').slice(-7)}</span>)}</div><div className="mt-3 flex flex-wrap justify-center gap-3">{series.map(s=><span key={s.key} className="flex items-center gap-1 text-[10px] text-slate-600"><i className={`h-2 w-2 rounded-full ${s.color}`}/>{s.label}</span>)}</div></div>;
}

function StatusBars({rows}:{rows:Array<{label:string;value:number}>}){const total=rows.reduce((sum,row)=>sum+Number(row.value||0),0);const colors=['bg-indigo-500','bg-cyan-500','bg-emerald-500','bg-amber-500','bg-rose-500','bg-violet-500'];return <div className="card min-h-64 p-4"><h3 className="font-semibold text-slate-800">PO Status Portfolio</h3><p className="text-xs text-slate-500">Distribution of purchase orders by lifecycle status.</p><div className="mt-5 flex h-4 overflow-hidden rounded-full bg-slate-100">{rows.map((r,i)=><div title={`${r.label}: ${r.value}`} key={r.label} className={colors[i%colors.length]} style={{width:`${total?Number(r.value)/total*100:0}%`}}/>)}</div><div className="mt-4 grid grid-cols-2 gap-2">{rows.map((r,i)=><div key={r.label} className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-2 text-xs"><span className="flex min-w-0 items-center gap-2"><i className={`h-2.5 w-2.5 shrink-0 rounded-full ${colors[i%colors.length]}`}/><span className="truncate">{r.label}</span></span><strong>{r.value}</strong></div>)}</div></div>}

function KpiCard({ label, value, accent, helper, tone='blue' }: { label: string; value: string; accent?: string; helper?: string; tone?: 'blue'|'emerald'|'amber'|'violet'|'rose'|'cyan' }) {
  const tones={blue:'from-blue-500 to-indigo-600',emerald:'from-emerald-500 to-teal-600',amber:'from-amber-400 to-orange-500',violet:'from-violet-500 to-purple-600',rose:'from-rose-500 to-pink-600',cyan:'from-cyan-500 to-blue-500'};
  return (
    <div className="card group relative min-h-32 overflow-hidden bg-gradient-to-br from-white to-slate-50 p-4 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg">
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${tones[tone]}`}/><div className={`absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br ${tones[tone]} opacity-[0.08] transition-transform group-hover:scale-125`}/>
      <div className="relative text-xs uppercase tracking-wide text-slate-500 font-semibold">{label}</div>
      <div className={`relative text-2xl font-bold mt-2 ${accent || 'text-slate-900'}`}>{value}</div>
      {helper ? <div className="text-xs text-slate-500 mt-2">{helper}</div> : null}
    </div>
  );
}

function TrendChart({ data, title, colorClass }: { data: Array<{ label: string; value: number }>; title: string; colorClass: string }) {
  const [hovered,setHovered]=useState<number|null>(null);
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="card p-5 bg-gradient-to-br from-white to-slate-50 transition-shadow hover:shadow-md">
      <div className="mb-4 flex items-center justify-between"><div className="font-semibold text-slate-800">{title}</div><div className="text-xs text-slate-400">Hover for value</div></div>
      <div className="flex items-end gap-2 h-44 border-b border-slate-200">
        {data.map((item,index) => (
          <div key={item.label} className="relative flex h-full flex-1 flex-col items-center justify-end gap-2" onMouseEnter={()=>setHovered(index)} onMouseLeave={()=>setHovered(null)}>
            {hovered===index&&<div className="absolute z-10 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg" style={{bottom:`${Math.max(18,(item.value/max)*125)+30}px`}}>{formatCurrency(item.value)}</div>}
            <div className={`w-full max-w-10 rounded-t-md ${colorClass} transition-all duration-300 ${hovered===index?'brightness-110 shadow-lg scale-x-110':'opacity-85'}`} style={{ height: `${Math.max(12, (item.value / max) * 125)}px` }} />
            <div className="h-6 text-[10px] text-slate-500 text-center">{item.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DistributionBars({ rows, labelKey, valueKey, color='bg-indigo-500' }: { rows:any[]; labelKey:string; valueKey:string; color?:string }) {
  const max=Math.max(...rows.map((row)=>Number(row[valueKey]||0)),1);
  return <div className="space-y-3">{rows.length?rows.map((row,index)=><div key={`${row[labelKey]}-${index}`} className="group"><div className="mb-1 flex justify-between gap-3 text-xs"><span className="truncate font-medium text-slate-600 group-hover:text-slate-900">{row[labelKey]}</span><span className="font-semibold text-slate-800">{formatCurrency(row[valueKey])}</span></div><div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${color} transition-all duration-500 group-hover:brightness-110`} style={{width:`${Math.max(3,Number(row[valueKey]||0)/max*100)}%`}}/></div></div>):<div className="text-sm text-slate-400">No activity recorded.</div>}</div>;
}

function PortfolioDonut({ rows }: { rows:Array<{warehouse_name:string;total_value:number}> }) {
  const [hovered,setHovered]=useState<number|null>(null); const total=rows.reduce((sum,row)=>sum+Number(row.total_value||0),0); const circumference=251.2; const colors=['#4f46e5','#06b6d4','#10b981','#f59e0b','#f43f5e','#8b5cf6']; let offset=0;
  const segments=rows.map((row,index)=>{const fraction=total?Number(row.total_value||0)/total:0;const segment={...row,index,dash:fraction*circumference,offset};offset+=segment.dash;return segment;});
  const selected=hovered==null?null:segments[hovered];
  return <div className="flex flex-col items-center gap-5 sm:flex-row"><div className="relative h-48 w-48 shrink-0"><svg viewBox="0 0 100 100" className="h-full w-full"><circle cx="50" cy="50" r="40" fill="none" stroke="#e2e8f0" strokeWidth="12"/>{segments.map((segment)=><circle key={segment.warehouse_name} cx="50" cy="50" r="40" fill="none" stroke={colors[segment.index%colors.length]} strokeWidth={hovered===segment.index?15:12} strokeDasharray={`${segment.dash} ${circumference-segment.dash}`} strokeDashoffset={-segment.offset} strokeLinecap="butt" transform="rotate(-90 50 50)" className="cursor-pointer transition-all" onMouseEnter={()=>setHovered(segment.index)} onMouseLeave={()=>setHovered(null)}/>)}</svg><div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center"><span className="text-[10px] uppercase text-slate-400">{selected?'Selected':'Inventory'}</span><strong className="max-w-28 text-sm text-slate-800">{selected?formatCurrency(selected.total_value):formatCurrency(total)}</strong></div></div><div className="w-full space-y-2">{segments.map((segment)=><div key={segment.warehouse_name} className={`flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors ${hovered===segment.index?'bg-slate-100':'hover:bg-slate-50'}`} onMouseEnter={()=>setHovered(segment.index)} onMouseLeave={()=>setHovered(null)}><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full" style={{backgroundColor:colors[segment.index%colors.length]}}/>{segment.warehouse_name}</span><strong>{total?(Number(segment.total_value)/total*100).toFixed(1):'0.0'}%</strong></div>)}</div></div>;
}

function RoleDashboard({kpis,user,tasks,isProcurement,isLoading,lastUpdated,onRefresh,onOpenTask}:{kpis:KPIs;user:any;tasks:any[];isProcurement:boolean;isLoading:boolean;lastUpdated:string|null;onRefresh:()=>void;onOpenTask:(task:any)=>void}){
  const [expanded,setExpanded]=useState(false),profileLabel=isProcurement?'Procurement Operations Center':'Warehouse Operations Center',description=isProcurement?'Purchasing, sourcing, supplier, delivery and invoice intelligence for this procurement role.':'Inventory, receiving, issues and stock-control intelligence for the employee’s authorized warehouse scope.';
  return <div className="role-dashboard-summary"><header className="executive-hero relative mb-6 overflow-hidden rounded-3xl border border-indigo-400/20 bg-slate-950 text-white shadow-xl shadow-indigo-950/15"><div className={`absolute inset-0 bg-gradient-to-br ${isProcurement?'from-indigo-700/90 via-slate-900 to-cyan-950':'from-emerald-700/90 via-slate-900 to-cyan-950'}`}/><div className="absolute -right-24 -top-28 h-80 w-80 rounded-full bg-cyan-400/20 blur-3xl"/><div className="absolute inset-0 opacity-[0.08]" style={{backgroundImage:'linear-gradient(rgba(255,255,255,.6) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.6) 1px,transparent 1px)',backgroundSize:'32px 32px'}}/><div className="relative p-6 lg:p-8"><div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between"><div><div className="mb-1 flex items-center gap-2"><span className="text-[10px] font-semibold uppercase tracking-[.3em] text-cyan-200">{profileLabel}</span><span className="flex items-center gap-1.5 rounded-full border border-emerald-300/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-200"><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300"/>Live</span></div><h1 className="text-2xl font-bold lg:text-3xl">{kpis.company_name}</h1><p className="mt-1 max-w-2xl text-sm text-slate-300">{description}</p></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:min-w-[520px]"><div className="rounded-xl border border-white/10 bg-white/[.07] px-3 py-2.5"><div className="text-[10px] uppercase text-slate-400">Role</div><div className="mt-1 text-sm font-semibold">{String(user?.role||'').replace(/([a-z])([A-Z])/g,'$1 $2')}</div></div><div className="rounded-xl border border-white/10 bg-white/[.07] px-3 py-2.5"><div className="text-[10px] uppercase text-slate-400">Today</div><div className="mt-1 text-sm font-semibold">{new Date().toLocaleDateString(undefined,{day:'2-digit',month:'short'})}</div></div><div className="rounded-xl border border-white/10 bg-white/[.07] px-3 py-2.5"><div className="text-[10px] uppercase text-slate-400">Open Tasks</div><div className="mt-1 text-sm font-semibold text-amber-300">{tasks.length}</div></div><div className="rounded-xl border border-white/10 bg-white/[.07] px-3 py-2.5"><div className="text-[10px] uppercase text-slate-400">Scope</div><div className="mt-1 text-sm font-semibold text-cyan-200">{isProcurement?'Procurement':'Assigned Warehouses'}</div></div></div></div><div className="mt-6 flex flex-wrap justify-between gap-3 border-t border-white/10 pt-4 text-xs text-slate-400"><span>ProcuraFlow Professional Edition · Role-Based Control Tower</span><span>Last synchronized: {lastUpdated||'Loading live data...'}</span></div></div></header><div className="mb-6 rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 via-white to-cyan-50 p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs font-semibold uppercase tracking-[.18em] text-indigo-500">Daily Action Center</div><div className="mt-1 text-lg font-bold text-slate-900">My Task List</div><div className="text-xs text-slate-500">Only work assigned to this role and authorized scope is displayed.</div></div><button className="btn-primary" onClick={()=>setExpanded(value=>!value)}>{expanded?'Close My Task List':'Open My Task List'}</button></div></div>{expanded&&<div className="mb-6"><TaskList tasks={tasks} onOpen={onOpenTask} forceExpanded/></div>}<div className="mb-6 flex items-end justify-between"><div><h2 className="text-xl font-semibold text-slate-900">Live KPI Snapshot</h2><p className="text-sm text-slate-500">Real-time, role-authorized operational indicators.</p></div><button className="btn-secondary" disabled={isLoading} onClick={onRefresh}>{isLoading?'Refreshing...':'Refresh'}</button></div><div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{isProcurement?<><KpiCard label="Monthly Purchase" value={formatCurrency(kpis.monthly_purchase)} tone="violet"/><KpiCard label="Open Requisitions" value={String(kpis.open_prs||0)} helper={`${kpis.pending_pr_approvals||0} pending`} tone="cyan"/><KpiCard label="Open Purchase Orders" value={String(kpis.open_pos||0)} helper={formatCurrency(kpis.outstanding_po_value||0)} tone="blue"/><KpiCard label="Overdue POs" value={String(kpis.overdue_pos||0)} tone="rose"/><KpiCard label="Active Suppliers" value={String(kpis.supplier_count||0)} tone="cyan"/><KpiCard label="Invoice Exceptions" value={String(kpis.invoice_exceptions||0)} tone="amber"/></>:<><KpiCard label="Inventory Value" value={formatCurrency(kpis.total_inventory_value)} helper="Authorized warehouses" tone="blue"/><KpiCard label="Monthly Consumption" value={formatCurrency(kpis.monthly_consumption)} tone="emerald"/><KpiCard label="Low Stock Items" value={String(kpis.low_stock_items||0)} tone="amber"/><KpiCard label="Out of Stock" value={String(kpis.out_of_stock_items||0)} tone="rose"/><KpiCard label="Reorder Data Gaps" value={String(kpis.items_missing_reorder_level||0)} tone="amber"/><KpiCard label="Unavailable Employees" value={String(kpis.employees_unavailable_today||0)} tone="violet"/></>}</div><div className="mt-6 grid gap-4 lg:grid-cols-2">{isProcurement?<><TrendChart data={kpis.purchase_trend??[]} title="Purchase Trend" colorClass="bg-indigo-500"/><StatusBars rows={kpis.po_status_distribution??[]}/><MiniBars title="Invoice Match Control" subtitle="Matched, pending and exception outcomes." rows={kpis.invoice_match_trend??[]} series={[{key:'matched',label:'Matched',color:'bg-emerald-500'},{key:'exceptions',label:'Exceptions',color:'bg-rose-500'},{key:'pending',label:'Pending',color:'bg-amber-500'}]}/></>:<><TrendChart data={kpis.consumption_trend??[]} title="Consumption Trend" colorClass="bg-emerald-500"/><MiniBars title="Stock Movement" subtitle="Authorized warehouse inbound and outbound quantities." rows={kpis.stock_movement_trend??[]} series={[{key:'stock_in',label:'Stock In',color:'bg-emerald-500'},{key:'stock_out',label:'Stock Out',color:'bg-indigo-500'}]}/><div className="card p-5"><h2 className="mb-3 font-semibold">Warehouse Inventory Portfolio</h2><PortfolioDonut rows={kpis.warehouse_values??[]}/></div><div className="card p-5"><h2 className="mb-3 font-semibold">Consumption by Department</h2><DistributionBars rows={kpis.department_consumption??[]} labelKey="department_name" valueKey="total_value" color="bg-emerald-500"/></div></>}</div></div>;
}

function TaskList({tasks,onOpen,forceExpanded=false,requestedGroup}:{tasks:any[];onOpen:(task:any)=>void;forceExpanded?:boolean;requestedGroup?:{type:string;requestId:number}|null}){
  const [expanded,setExpanded]=useState<Record<string,boolean>>({});
  const groups=Array.from(tasks.reduce((map:Map<string,any[]>,task:any)=>{
    const type=String(task.type||'Other Tasks');
    map.set(type,[...(map.get(type)||[]),task]);
    return map;
  },new Map<string,any[]>()).entries());
  useEffect(()=>{
    if(!requestedGroup)return;
    setExpanded(current=>({...current,[requestedGroup.type]:true}));
  },[requestedGroup?.requestId]);
  useEffect(()=>{if(!forceExpanded)setExpanded({});},[forceExpanded]);
  const hasExpandedGroup=groups.some(([type])=>expanded[type]);
  const wide=forceExpanded||hasExpandedGroup;
  const priorityClass=(priority:string)=>priority==='Critical'?'bg-rose-100 text-rose-800':priority==='High'?'bg-amber-100 text-amber-800':'bg-sky-100 text-sky-800';
  return <div id="my-task-list" className={`card scroll-mt-4 flex flex-col overflow-hidden p-5 transition-all duration-300 ${wide?'h-[28rem] w-full':'h-[18rem] w-full lg:max-w-3xl'}`}>
    <div className="mb-3 flex shrink-0 items-center justify-between"><div><div className="flex items-center gap-2"><h2 className="font-medium text-slate-800">My Task List</h2><span className="h-2 w-2 animate-pulse rounded-full bg-rose-500"/></div><p className="text-xs text-slate-500">Open a task group to expand the workspace. Double-click an entry for action.</p></div><span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">{tasks.length} open · {groups.length} groups</span></div>
    <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200"><table className="table-base"><thead className="sticky top-0 z-10 bg-slate-100 shadow-sm"><tr><th>Task</th><th>Reference</th><th>Priority</th><th>Due / Date</th></tr></thead><tbody>
      {groups.length?groups.map(([type,group])=><React.Fragment key={type}><tr className="border-t border-indigo-100 bg-gradient-to-r from-indigo-50 to-sky-50"><td colSpan={4} className="p-0"><button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left" onClick={()=>setExpanded(current=>({...current,[type]:!current[type]}))}><span className="flex items-center gap-2 font-semibold text-indigo-900"><span className={`text-xs transition-transform ${expanded[type]?'':'rotate-[-90deg]'}`}>▼</span>{type}</span><span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-indigo-700 shadow-sm">{group.length}</span></button></td></tr>{expanded[type]&&group.map((task,index)=><tr key={`${type}-${task.id}-${index}`} className="cursor-pointer select-none hover:bg-indigo-50/50" title="Double-click to open this task" onDoubleClick={()=>onOpen(task)}><td className="text-xs text-slate-500">Action required</td><td className="font-medium text-brand-700">{task.number}</td><td><span className={`rounded-full px-2 py-1 text-xs font-semibold ${priorityClass(task.priority)}`}>{task.priority}</span></td><td>{task.due_date||'—'}</td></tr>)}</React.Fragment>):<tr><td colSpan={4} className="text-center text-slate-400">No open tasks</td></tr>}
    </tbody></table></div>
  </div>;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const {user}=useAuth();
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [taskPanelExpanded,setTaskPanelExpanded]=useState(false);
  const [requestedTaskGroup,setRequestedTaskGroup]=useState<{type:string;requestId:number}|null>(null);
  const profile=kpis?.dashboard_profile||(user?.role==='SupplyChainManager'?'executive':['PurchaseManager','PurchaseOfficer'].includes(user?.role||'')?'procurement':'warehouse');
  const isExecutive=profile==='executive',isProcurement=profile==='procurement',isWarehouse=profile==='warehouse';
  const taskGroupSummaries=Array.from(tasks.reduce((map:Map<string,number>,task:any)=>{const type=String(task.type||'Other Tasks');map.set(type,(map.get(type)||0)+1);return map;},new Map<string,number>()).entries());

  const loadKpis = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await client.get('/dashboard/kpis');
      setKpis(res.data);
      client.get('/dashboard/tasks').then((taskRes) => setTasks(taskRes.data)).catch(() => setTasks([]));
      setLastUpdated(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    } catch (err) {
      setError('Unable to load KPI data right now. Please try again in a moment.');
      setKpis(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadKpis();
    const intervalId = window.setInterval(loadKpis, 30000);

    return () => window.clearInterval(intervalId);
  }, []);

  function openTask(task: any) {
    const destinations: Record<string, string> = {
      'PO approval': `/procurement/po?open=${task.id}`,
      'PR review': `/procurement/pr?open=${task.id}`,
      'PO delivery overdue': `/procurement/po?open=${task.id}`,
      'Issue approval': `/warehouse/issue?open=${task.id}`,
      'Adjustment approval': `/warehouse/adjustments?open=${task.id}`,
      'Cycle count approval': `/inventory/cycle-count?open=${task.id}`,
      'Low stock': `/inventory/stock?item=${task.id}`,
      'Expiry approaching': `/inventory/expiry?layer=${task.id}`,
      'Month-end database backup required': '/masters/settings',
      'Workday calendar publication due': '/employees/calendar-management',
      'Duplicate items pending review':'/reports?report=duplicate-item-analysis','Employee coverage gap':'/reports?report=shift-coverage','Three-way match exception':'/procurement/invoices',
    };
    const destination = destinations[task.type];
    if (destination) navigate(destination);
  }

  function focusTaskList(){const opening=!taskPanelExpanded;setTaskPanelExpanded(opening);if(opening)window.setTimeout(()=>document.getElementById('my-task-list')?.scrollIntoView({behavior:'smooth',block:'start'}),50);}
  function openTaskGroup(type:string){setTaskPanelExpanded(true);setRequestedTaskGroup({type,requestId:Date.now()});window.setTimeout(()=>document.getElementById('my-task-list')?.scrollIntoView({behavior:'smooth',block:'start'}),50);}

  if(kpis&&!isExecutive)return <RoleDashboard kpis={kpis} user={user} tasks={tasks} isProcurement={isProcurement} isLoading={isLoading} lastUpdated={lastUpdated} onRefresh={loadKpis} onOpenTask={openTask}/>;

  if(kpis&&!isExecutive) return <div><header className={`relative mb-6 overflow-hidden rounded-3xl p-7 text-white shadow-xl ${isProcurement?'bg-gradient-to-br from-indigo-800 via-blue-800 to-cyan-800':'bg-gradient-to-br from-emerald-800 via-teal-800 to-slate-900'}`}><div className="relative flex flex-wrap items-center justify-between gap-5"><div><div className="text-[10px] font-semibold uppercase tracking-[.3em] text-cyan-200">{isProcurement?'Procurement Operations Center':'Warehouse Operations Center'}</div><h1 className="mt-2 text-3xl font-bold">{kpis.company_name}</h1><p className="mt-1 text-sm text-white/75">{isProcurement?'Purchasing, supplier, delivery and invoice control for your procurement role.':'Inventory, stock movement, consumption and warehouse exceptions for your assigned warehouse scope.'}</p></div><div className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-right"><div className="text-[10px] uppercase text-white/60">Signed in as</div><div className="font-semibold">{user?.full_name}</div><div className="text-xs text-cyan-100">{String(user?.role||'').replace(/([a-z])([A-Z])/g,'$1 $2')}</div></div></div></header><div className="mb-4 flex items-center justify-between"><div><h2 className="text-xl font-semibold">Role-Based KPI Snapshot</h2><p className="text-sm text-slate-500">Only information authorized for your operational responsibility is displayed.</p></div><button className="btn-secondary" onClick={loadKpis}>{isLoading?'Refreshing…':'Refresh'}</button></div><div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{isProcurement?<><KpiCard label="Monthly Purchase" value={formatCurrency(kpis.monthly_purchase)} tone="violet"/><KpiCard label="Open Requisitions" value={String(kpis.open_prs||0)} helper={`${kpis.pending_pr_approvals||0} pending approval`} tone="cyan"/><KpiCard label="Open Purchase Orders" value={String(kpis.open_pos||0)} helper={formatCurrency(kpis.outstanding_po_value||0)} tone="blue"/><KpiCard label="Overdue POs" value={String(kpis.overdue_pos||0)} tone="rose"/><KpiCard label="Active Suppliers" value={String(kpis.supplier_count||0)} tone="cyan"/><KpiCard label="Supplier Rating" value={`${kpis.avg_supplier_rating||0} / 5`} tone="amber"/><KpiCard label="Invoices Pending" value={String(kpis.invoices_pending||0)} tone="amber"/><KpiCard label="Invoice Exceptions" value={String(kpis.invoice_exceptions||0)} tone="rose"/><KpiCard label="Matched Invoices" value={String(kpis.matched_invoices||0)} tone="emerald"/></>:<><KpiCard label="Inventory Value" value={formatCurrency(kpis.total_inventory_value)} helper="Authorized warehouses only" tone="blue"/><KpiCard label="Monthly Consumption" value={formatCurrency(kpis.monthly_consumption)} tone="emerald"/><KpiCard label="Low Stock Items" value={String(kpis.low_stock_items||0)} tone="amber"/><KpiCard label="Out of Stock" value={String(kpis.out_of_stock_items||0)} tone="rose"/><KpiCard label="Reorder Data Gaps" value={String(kpis.items_missing_reorder_level||0)} tone="amber"/><KpiCard label="Unavailable Employees" value={String(kpis.employees_unavailable_today||0)} tone="violet"/></>}</div><div className="mt-5 grid gap-4 lg:grid-cols-2">{isProcurement?<><TrendChart data={kpis.purchase_trend??[]} title="Purchase Trend" colorClass="bg-indigo-500"/><StatusBars rows={kpis.po_status_distribution??[]}/><MiniBars title="Invoice Match Control" subtitle="Matched, pending and exception outcomes." rows={kpis.invoice_match_trend??[]} series={[{key:'matched',label:'Matched',color:'bg-emerald-500'},{key:'exceptions',label:'Exceptions',color:'bg-rose-500'},{key:'pending',label:'Pending',color:'bg-amber-500'}]}/></>:<><TrendChart data={kpis.consumption_trend??[]} title="Consumption Trend" colorClass="bg-emerald-500"/><MiniBars title="Stock Movement" subtitle="Inbound and outbound quantities in assigned warehouses." rows={kpis.stock_movement_trend??[]} series={[{key:'stock_in',label:'Stock In',color:'bg-emerald-500'},{key:'stock_out',label:'Stock Out',color:'bg-indigo-500'}]}/><div className="card p-5"><h2 className="mb-3 font-semibold">Warehouse Inventory Value</h2><PortfolioDonut rows={kpis.warehouse_values??[]}/></div><div className="card p-5"><h2 className="mb-3 font-semibold">Consumption by Department</h2><DistributionBars rows={kpis.department_consumption??[]} labelKey="department_name" valueKey="total_value" color="bg-emerald-500"/></div></>}</div><div className="mt-5"><TaskList tasks={tasks} onOpen={openTask}/></div></div>;

  return (
    <div id="executive-dashboard-summary">
      <header className="executive-hero relative mb-6 overflow-hidden rounded-3xl border border-indigo-400/20 bg-slate-950 text-white shadow-xl shadow-indigo-950/15">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-700/90 via-slate-900 to-cyan-950"/><div className="absolute -right-24 -top-28 h-80 w-80 rounded-full bg-cyan-400/20 blur-3xl"/><div className="absolute -bottom-36 left-1/3 h-72 w-72 rounded-full bg-violet-500/20 blur-3xl"/><div className="absolute inset-0 opacity-[0.08]" style={{backgroundImage:'linear-gradient(rgba(255,255,255,.6) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.6) 1px,transparent 1px)',backgroundSize:'32px 32px'}}/>
        <div className="relative p-6 lg:p-8"><div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between"><div className="flex min-w-0 items-center gap-4">{kpis?.company_logo_url?<div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-white/25 bg-white p-2 shadow-lg"><img src={kpis.company_logo_url} alt="Company logo" className="h-full w-full object-contain"/></div>:<div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-indigo-500 text-xl font-black shadow-lg">PM</div>}<div className="min-w-0"><div className="mb-1 flex flex-wrap items-center gap-2"><span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-cyan-200">Executive Command Center</span><span className="flex items-center gap-1.5 rounded-full border border-emerald-300/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-200"><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300"/>Live</span></div><h1 className="truncate text-2xl font-bold tracking-tight lg:text-3xl">{kpis?.company_name||'ProcuraFlow Executive Dashboard'}</h1><p className="mt-1 text-sm text-slate-300">Procurement, warehouse and inventory intelligence in one operational view.</p></div></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:min-w-[520px]"><div className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2.5 backdrop-blur"><div className="text-[10px] uppercase tracking-wide text-slate-400">Today</div><div className="mt-1 text-sm font-semibold">{new Date().toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'})}</div></div><div className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2.5 backdrop-blur"><div className="text-[10px] uppercase tracking-wide text-slate-400">Fiscal Year</div><div className="mt-1 text-sm font-semibold text-cyan-200">{kpis?.financial_year||'Not set'}</div></div><div className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2.5 backdrop-blur"><div className="text-[10px] uppercase tracking-wide text-slate-400">Approvals</div><div className={`mt-1 text-sm font-semibold ${kpis?.pending_approvals?'text-amber-300':'text-emerald-300'}`}>{kpis?.pending_approvals??0} pending</div></div><div className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2.5 backdrop-blur"><div className="text-[10px] uppercase tracking-wide text-slate-400">Stock Alerts</div><div className={`mt-1 text-sm font-semibold ${kpis?.low_stock_items?'text-rose-300':'text-emerald-300'}`}>{kpis?.low_stock_items??0} items</div></div></div></div><div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4 text-xs"><span className="text-slate-400">ProcuraFlow Professional Edition · Supply Chain Control Tower</span><span className="rounded-full bg-white/[0.07] px-3 py-1.5 text-slate-300">Last synchronized: {lastUpdated||'Loading live data…'}</span></div></div>
      </header>

      <div className="mb-4 rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 via-white to-cyan-50 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs font-semibold uppercase tracking-[.18em] text-indigo-500">Daily Action Center</div><div className="mt-1 text-lg font-bold text-slate-900">My Task List</div><div className="text-xs text-slate-500">{tasks.length} open tasks grouped into actionable work queues.</div></div><button type="button" className="btn-primary" onClick={focusTaskList}>{taskPanelExpanded?'Close My Task List':'Open My Task List'} <span aria-hidden="true">{taskPanelExpanded?'↑':'↓'}</span></button></div>
        <div className="mt-3 flex flex-wrap gap-2">{taskGroupSummaries.length?taskGroupSummaries.map(([type,count])=><button type="button" key={type} onClick={()=>openTaskGroup(type)} className="group flex items-center gap-2 rounded-xl border border-indigo-100 bg-white px-3 py-2 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow"><span><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Task Group</span><span className="text-xs font-semibold text-slate-700 group-hover:text-indigo-700">{type}</span></span><strong className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700">{count}</strong></button>):<span className="text-sm text-emerald-700">No open tasks requiring action.</span>}</div>
      </div>
      {taskPanelExpanded&&<div className="mb-6"><TaskList tasks={tasks} onOpen={openTask} forceExpanded requestedGroup={requestedTaskGroup}/></div>}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 mb-1">Live KPI Snapshot</h2>
          <p className="text-sm text-slate-500">Real-time supply chain KPIs across procurement, warehouse, and inventory.</p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated ? <span className="text-xs text-slate-400">Updated {lastUpdated}</span> : null}
          <button
            type="button"
            onClick={() => loadKpis()}
            className="btn-secondary text-xs px-3 py-1.5"
            disabled={isLoading}
          >
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {isLoading && !kpis ? (
        <div className="text-slate-400">Loading KPIs...</div>
      ) : error ? (
        <div className="card p-5 text-sm text-rose-600">
          <p>{error}</p>
        </div>
      ) : kpis ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard label="Total Inventory Value" value={formatCurrency(kpis.total_inventory_value)} helper="Current stock value across all warehouses" tone="blue" />
            <KpiCard label="Monthly Purchase" value={formatCurrency(kpis.monthly_purchase)} helper="Procurement spend for the month" tone="violet" />
            <KpiCard label="Monthly Consumption" value={formatCurrency(kpis.monthly_consumption)} helper="Issued material and usage trend" tone="emerald" />
            <KpiCard
              label="Low Stock Items"
              value={String(kpis.low_stock_items)}
              accent={kpis.low_stock_items > 0 ? 'text-amber-600' : undefined}
              helper="Items below minimum stock"
              tone="amber"
            />
            <KpiCard
              label="Pending Approvals"
              value={String(kpis.pending_approvals)}
              accent={kpis.pending_approvals > 0 ? 'text-rose-600' : undefined}
              helper="Awaiting review or sign-off"
              tone="rose"
            />
            <KpiCard label="Active Suppliers" value={String(kpis.supplier_count)} helper="Approved vendors in the system" tone="cyan" />
            <KpiCard label="Avg Supplier Rating" value={`${kpis.avg_supplier_rating} / 5`} helper="Vendor performance benchmark" tone="amber" />
            <KpiCard label="Open Purchase Orders" value={String(kpis.open_pos||0)} helper={formatCurrency(kpis.outstanding_po_value||0)+' outstanding commitment'} tone="blue" />
            <KpiCard label="Overdue Purchase Orders" value={String(kpis.overdue_pos||0)} helper="Committed delivery date exceeded" tone="rose" />
            <KpiCard label="Invoice Exceptions" value={String(kpis.invoice_exceptions||0)} helper={`${kpis.matched_invoices||0} invoices matched`} tone="amber" />
            <KpiCard label="Potential Duplicate Items" value={String(kpis.potential_duplicate_items||0)} helper="Master-data records awaiting review" tone="violet" />
            <KpiCard label="Open Requisitions" value={String(kpis.open_prs||0)} helper={`${kpis.pending_pr_approvals||0} awaiting approval`} tone="cyan" />
            <KpiCard label="Out of Stock" value={String(kpis.out_of_stock_items||0)} helper="Active items with zero balance" accent={kpis.out_of_stock_items?'text-rose-600':undefined} tone="rose" />
            <KpiCard label="Invoices Pending" value={String(kpis.invoices_pending||0)} helper="Awaiting three-way confirmation" tone="amber" />
            <KpiCard label="Matched Invoices" value={String(kpis.matched_invoices||0)} helper="Cleared for SCM evidence" tone="emerald" />
            <KpiCard label="Inactive Items" value={String(kpis.inactive_items||0)} helper="Retained for historical integrity" tone="violet" />
            <KpiCard label="Reorder Data Gaps" value={String(kpis.items_missing_reorder_level||0)} helper="Active items missing a reorder level" tone="amber" />
            <KpiCard label="Employees Unavailable" value={String(kpis.employees_unavailable_today||0)} helper="Leave, training, sick or unavailable" tone="rose" />
          </div>

          <div className="card mt-6 p-5"><div className="mb-4"><h2 className="font-semibold text-slate-800">Workforce Coverage Today</h2><p className="text-xs text-slate-500">Live shift allocation, coverage exceptions and rolling-calendar readiness.</p></div><div className="grid grid-cols-2 gap-3 md:grid-cols-5 xl:grid-cols-9">{[['Warehouse',kpis.active_warehouse_employees],['Procurement',kpis.active_procurement_employees],['Morning',kpis.morning_today],['Afternoon',kpis.afternoon_today],['Evening',kpis.evening_today],['Rest Day',kpis.off_today],['Holiday Duty',kpis.holiday_workers_today],['Coverage Warnings',kpis.coverage_warnings],['Unpublished',kpis.unpublished_entries]].map(([label,value])=><div key={String(label)} className={`rounded-xl border p-3 ${label==='Coverage Warnings'&&Number(value)>0?'border-rose-200 bg-rose-50':'border-slate-200 bg-gradient-to-br from-white to-indigo-50'}`}><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className={`mt-1 text-xl font-bold ${label==='Coverage Warnings'&&Number(value)>0?'text-rose-700':'text-indigo-700'}`}>{Number(value||0)}</div></div>)}</div></div>

          <div className="grid lg:grid-cols-2 gap-4 mt-6">
            <TrendChart data={kpis.purchase_trend ?? []} title="Purchase Trend" colorClass="bg-brand-500" />
            <TrendChart data={kpis.consumption_trend ?? []} title="Consumption Trend" colorClass="bg-emerald-500" />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <StatusBars rows={kpis.po_status_distribution??[]}/>
            <MiniBars title="Stock Movement" subtitle="Monthly inbound and outbound quantities." rows={kpis.stock_movement_trend??[]} series={[{key:'stock_in',label:'Stock In',color:'bg-emerald-500'},{key:'stock_out',label:'Stock Out',color:'bg-indigo-500'}]}/>
            <MiniBars title="Invoice Match Control" subtitle="Three-way match outcome trend." rows={kpis.invoice_match_trend??[]} series={[{key:'matched',label:'Matched',color:'bg-emerald-500'},{key:'exceptions',label:'Exceptions',color:'bg-rose-500'},{key:'pending',label:'Pending',color:'bg-amber-500'}]}/>
          </div>
          <div className="card mt-6 overflow-hidden p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold text-slate-800">Operational Financial Pulse</h2><p className="text-xs text-slate-500">Current-month purchasing and consumption relative to inventory value.</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${kpis.monthly_purchase>=kpis.monthly_consumption?'bg-blue-50 text-blue-700':'bg-amber-50 text-amber-700'}`}>{kpis.monthly_purchase>=kpis.monthly_consumption?'Stock investment ahead of usage':'Consumption ahead of purchasing'}</span></div><div className="grid gap-5 md:grid-cols-3"><div><div className="text-xs text-slate-500">Purchase / Inventory</div><div className="mt-1 text-xl font-bold text-indigo-700">{kpis.total_inventory_value?((kpis.monthly_purchase/kpis.total_inventory_value)*100).toFixed(1):'0.0'}%</div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500" style={{width:`${Math.min(100,kpis.total_inventory_value?kpis.monthly_purchase/kpis.total_inventory_value*100:0)}%`}}/></div></div><div><div className="text-xs text-slate-500">Consumption / Inventory</div><div className="mt-1 text-xl font-bold text-emerald-700">{kpis.total_inventory_value?((kpis.monthly_consumption/kpis.total_inventory_value)*100).toFixed(1):'0.0'}%</div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{width:`${Math.min(100,kpis.total_inventory_value?kpis.monthly_consumption/kpis.total_inventory_value*100:0)}%`}}/></div></div><div><div className="text-xs text-slate-500">Purchase vs. Consumption</div><div className="mt-1 text-xl font-bold text-slate-800">{formatCurrency(kpis.monthly_purchase-kpis.monthly_consumption)}</div><div className="mt-2 text-xs text-slate-500">Net monthly material investment</div></div></div></div>
          <div className="grid lg:grid-cols-2 gap-4 mt-6">
            <div className="card p-5 bg-gradient-to-br from-indigo-50/60 to-white">
              <div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold text-slate-800">Inventory Portfolio</h2><p className="text-xs text-slate-500">Interactive value allocation by warehouse.</p></div><span className="rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-semibold text-indigo-700">Executive View</span></div>
              <PortfolioDonut rows={kpis.warehouse_values??[]}/>
              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-indigo-100 pt-4"><div className="rounded-lg bg-white p-3 shadow-sm"><div className="text-[10px] uppercase tracking-wide text-slate-400">Stock Risk</div><div className={`mt-1 text-lg font-bold ${kpis.low_stock_items?'text-amber-600':'text-emerald-600'}`}>{kpis.low_stock_items} items</div><div className="text-[10px] text-slate-500">At or below reorder level</div></div><div className="rounded-lg bg-white p-3 shadow-sm"><div className="text-[10px] uppercase tracking-wide text-slate-400">Approval Load</div><div className={`mt-1 text-lg font-bold ${kpis.pending_approvals?'text-rose-600':'text-emerald-600'}`}>{kpis.pending_approvals} pending</div><div className="text-[10px] text-slate-500">Documents awaiting action</div></div></div>
            </div>
            <div className="card p-5">
              <h2 className="font-medium text-slate-800 mb-2">Department Consumption</h2>
              <DistributionBars rows={kpis.department_consumption??[]} labelKey="department_name" valueKey="total_value" color="bg-emerald-500"/>
              <div className="mt-4 border-t border-slate-100 pt-3">
                <h3 className="text-sm font-medium text-slate-700 mb-2">Warehouse Value Distribution</h3>
                <DistributionBars rows={kpis.warehouse_values??[]} labelKey="warehouse_name" valueKey="total_value" color="bg-indigo-500"/>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
