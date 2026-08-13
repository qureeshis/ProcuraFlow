import React, { useEffect, useState } from 'react';
import client from '../../api/client';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import StatusBadge from '../../components/StatusBadge';
import { useAuth } from '../../contexts/AuthContext';
import { formatCurrency } from '../../utils/currency';
import { useSearchParams } from 'react-router-dom';
import SearchSelect from '../../components/SearchSelect';

export default function MaterialIssuePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const warehouseRole = !!user && ['WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'].includes(user.role);
  const authorizedWarehouseIds=(user?.warehouse_ids||[]).map(Number);
  // Lock the form only when the account has exactly one authorized warehouse.
  // Managers/supervisors with multiple or all-warehouse scope must select one.
  const warehouseBound = warehouseRole && authorizedWarehouseIds.length===1;
  const assignedWarehouseId = warehouseBound ? authorizedWarehouseIds[0] : '';
  const [issues, setIssues] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [threshold, setThreshold] = useState<number>(500);
  const [showForm, setShowForm] = useState(false);
  const [employeeId, setEmployeeId] = useState<number | ''>('');
  const [purpose, setPurpose] = useState('');
  const [lines, setLines] = useState<any[]>([{ item_id: '', item_search: '', warehouse_id: assignedWarehouseId, quantity: 1 }]);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState<any | null>(null);
  const [stock, setStock] = useState<any[]>([]);
  const [thresholdSaved, setThresholdSaved] = useState(false);

  function load() {
    client.get('/warehouse/material-issues').then((res) => setIssues(res.data));
  }

  useEffect(() => {
    load();
    client.get('/masters/employee-directory').then((res) => setEmployees(res.data));
    client.get('/masters/operational-items').then((res) => setItems(res.data.filter((i:any)=>i.active_yn!==0)));
    client.get('/masters/warehouses').then((res) => setWarehouses(res.data));
    client.get('/settings').then((res) => {
      const configured = Number(res.data.material_issue_approval_threshold);
      setThreshold(Number.isFinite(configured) ? configured : 500);
    });
    client.get('/inventory/stock').then((res) => setStock(res.data));
  }, []);

  useEffect(() => {
    const openId = Number(searchParams.get('open'));
    const target = openId ? issues.find((row) => row.id === openId) : null;
    if (!target) return;
    setSearchParams({}, { replace: true });
    viewIssue(target);
  }, [issues, searchParams, setSearchParams]);

  useEffect(() => {
    if (!assignedWarehouseId) return;
    setLines((current) => current.map((line) => ({ ...line, warehouse_id: assignedWarehouseId })));
  }, [assignedWarehouseId]);

  function addLine() {
    setLines((current) => [...current, { item_id: '', item_search: '', warehouse_id: assignedWarehouseId, quantity: 1 }]);
  }
  function removeLine(index: number) {
    setLines((current) => current.length === 1 ? current : current.filter((_, lineIndex) => lineIndex !== index));
  }
  function updateLine(i: number, key: string, val: any) {
    setLines((current) => current.map((line, index) => index === i ? { ...line, [key]: val } : line));
  }

  const estimatedValue = lines.reduce((sum, l) => {
    const item = items.find((it) => it.id === l.item_id);
    return sum + (l.quantity || 0) * (item?.standard_cost || 0);
  }, 0);
  const hasHighValueItem = lines.some(
    (l) => items.find((it) => it.id === l.item_id)?.high_value_flag || items.find((it) => it.id === l.item_id)?.always_approval_yn
  );
  const willNeedApproval = user?.role!=='SupplyChainManager'&&(estimatedValue > threshold || hasHighValueItem);
  const issueApproverRole=user?.role==='WarehouseManager'?'Supply Chain Manager':'Warehouse Manager';

  async function submit() {
    setError('');
    if (!employeeId || lines.some((line) => !line.item_id || !line.warehouse_id || !line.location_id || !(line.quantity > 0))) return setError('Employee, item, storage Bin, and a quantity greater than zero are required for every line.');
    const low = lines.find((line) => line.quantity > stock.filter((s)=>s.item_id===line.item_id&&s.warehouse_id===line.warehouse_id&&s.location_id===line.location_id).reduce((sum,s)=>sum+Number(s.quantity),0));
    if (low) return setError('Requested quantity exceeds available stock. Review the available quantity shown beside each line.');
    try {
      await client.post('/warehouse/material-issues', { employee_id: employeeId, purpose, items: lines });
      setShowForm(false);
      setEmployeeId('');
      setPurpose('');
      setLines([{ item_id: '', item_search: '', warehouse_id: assignedWarehouseId, quantity: 1 }]);
      load();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to issue material');
    }
  }

  async function approve(id: number) {
    try {
      await client.put(`/warehouse/material-issues/${id}/approve`);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Approval failed');
    }
  }

  async function reject(id: number) {
    try {
      await client.put(`/warehouse/material-issues/${id}/reject`);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Rejection failed');
    }
  }

  const canApprove = user && ['WarehouseManager', 'SupplyChainManager'].includes(user.role);
  const canConfigureThreshold = user?.role === 'SupplyChainManager';
  const canViewThreshold = !!user && ['WarehouseManager', 'SupplyChainManager'].includes(user.role);
  async function saveThreshold() { await client.put('/settings/material_issue_approval_threshold',{value:threshold});setThresholdSaved(true);setTimeout(()=>setThresholdSaved(false),2000); }
  async function viewIssue(row: any) { try { setViewing((await client.get(`/warehouse/material-issues/${row.id}`)).data); } catch (e: any) { setError(e?.response?.data?.error || 'Unable to view issue'); } }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Material Issue</h1>
          <p className="text-sm text-slate-500">
            {canViewThreshold
              ? <>Track consumption by employee. Issues over {formatCurrency(threshold)} or containing high-value/always-approval items route to the next approval authority before stock is consumed.</>
              : <>Track consumption by employee. The system will indicate when an issue requires Warehouse Manager approval before stock is consumed.</>}
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          + New Issue
        </button>
      </div>

      {canViewThreshold && <div className="card p-4 mb-4"><h2 className="font-semibold text-indigo-900">Material Issue Approval Control</h2><p className="text-xs text-slate-500 mt-1">Issues above this value require Warehouse Manager approval before stock is deducted.</p>{canConfigureThreshold ? <div className="flex items-end gap-2 mt-3 max-w-md"><div className="flex-1"><label className="text-sm font-medium">Approval Threshold</label><input className="input mt-1" type="number" min="0" value={threshold} onChange={(e)=>setThreshold(Number(e.target.value))}/></div><button className="btn-secondary" onClick={saveThreshold}>Save Threshold</button></div> : <div className="mt-3 max-w-md"><label className="text-sm font-medium">Approval Threshold (Read Only)</label><div className="input mt-1 bg-slate-100 font-semibold text-slate-700">{formatCurrency(threshold)}</div><p className="mt-1 text-xs text-amber-700">Only the Supply Chain Manager can change this control.</p></div>}{thresholdSaved&&<div className="text-xs text-emerald-600 mt-2">Approval threshold saved and recorded in the audit log.</div>}</div>}

      <div className="card">
        <DataTable
          columns={[
            { key: 'issue_number', label: 'Issue Number' },
            { key: 'employee_code', label: 'Employee Code' },
            { key: 'employee_name', label: 'Employee' },
            { key: 'issue_date', label: 'Date' },
            { key: 'total_value', label: 'Value', render: (r) => formatCurrency(r.total_value ?? 0) },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          ]}
          rows={issues}
          actions={(r) => <div className="flex gap-2 justify-end"><button className="text-brand-600 text-xs font-medium" onClick={() => viewIssue(r)}>View</button>{r.status === 'PendingApproval' && canApprove && <button className="text-emerald-600 text-xs font-medium" onClick={() => viewIssue(r)}>Review</button>}</div>}
        />
      </div>

      {showForm && (
        <Modal title="New Material Issue" onClose={() => setShowForm(false)} wide>
          <div className="compact-form">
            <div className="rounded-lg border border-slate-200 p-4 bg-slate-50">
              <h3 className="font-medium text-slate-800 mb-3">Issue Details</h3>
              <SearchSelect
                label="Employee"
                options={employees.map((e) => ({ value: e.id, label: `${e.employee_code} — ${e.name}` }))}
                value={employeeId}
                onChange={(val) => setEmployeeId(Number(val))}
                placeholder="Search employee"
              />
              <div className="mt-3">
                <label className="text-sm font-medium text-slate-700">Purpose</label>
                <input className="input mt-1" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Line 3 maintenance" />
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 p-4 bg-white">
              <h3 className="font-medium text-slate-800 mb-3">Issued Items</h3>
              <div className="space-y-2 mt-1">
                {lines.map((line, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-5">
                      <SearchSelect
                        label="Item to Issue"
                        options={items.map((it) => ({ value: it.id, label: `${it.item_code} - ${it.description}` }))}
                        value={line.item_id || line.item_search || ''}
                        onChange={(val) => {
                          const selected = items.find((it) => it.id === Number(val));
                          setLines((current) => current.map((currentLine, index) => index === i ? {
                            ...currentLine,
                            item_id: selected ? selected.id : '',
                            item_search: selected ? `${selected.item_code} - ${selected.description}` : '',
                            location_id: '',
                          } : currentLine));
                        }}
                        placeholder="Search item"
                      />
                    </div>
                    {warehouseBound ? <div className="input col-span-4 bg-slate-100 text-slate-700"><span className="block text-[10px] uppercase text-slate-500">Issuing warehouse</span>{warehouses.find(w=>Number(w.id)===Number(assignedWarehouseId))?.name || user?.warehouse_name || 'Assigned warehouse'}</div> : <div className="col-span-4"><label className="text-sm font-medium">Issuing Warehouse</label><select className="input mt-1" value={line.warehouse_id} onChange={(e) => updateLine(i, 'warehouse_id', Number(e.target.value))}>
                      <option value="">Warehouse...</option>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select></div>}
                    <div className="col-span-3"><label className="text-sm font-medium">Issue Quantity</label><input className="input mt-1" type="number" placeholder="Quantity" value={line.quantity} onChange={(e) => updateLine(i, 'quantity', Number(e.target.value))} /></div>
                    <div className="col-span-12"><label className="text-sm font-medium">Issue From Physical Bin</label><select className="input mt-1" value={line.location_id||''} onChange={e=>updateLine(i,'location_id',Number(e.target.value))}><option value="">Select stocked Bin...</option>{stock.filter(s=>s.item_id===line.item_id&&s.warehouse_id===line.warehouse_id&&Number(s.quantity)>0&&s.location_id).map(s=><option key={s.id} value={s.location_id}>{s.location_code} — Available {Number(s.quantity).toLocaleString()}</option>)}</select></div>
                    <div className="col-span-12 flex justify-end">{lines.length > 1 && <button type="button" className="text-xs font-medium text-rose-600 hover:text-rose-800" onClick={()=>removeLine(i)}>Remove item line</button>}</div>
                    <div className="col-span-12 rounded-lg border border-sky-100 bg-sky-50/70 px-3 py-2 text-xs">
                      <div className="font-medium text-sky-900">Unit: {items.find((it)=>it.id===line.item_id)?.issue_uom || items.find((it)=>it.id===line.item_id)?.uom || '—'}</div>
                      {line.item_id ? (() => {
                        const balances = stock.filter((balance) => balance.item_id === line.item_id && (!line.warehouse_id || balance.warehouse_id === line.warehouse_id));
                        return balances.length ? <div className="mt-1 space-y-1">{balances.map((balance) => <div key={balance.id} className="flex flex-wrap justify-between gap-2 text-slate-700"><span><strong>{balance.warehouse_name}</strong> · Location: <strong>{balance.location_code ? `${balance.location_type || 'Location'} ${balance.location_code}` : 'Unassigned'}</strong></span><span>Available: <strong className="text-emerald-700">{Number(balance.quantity).toLocaleString()}</strong></span></div>)}<div className="border-t border-sky-200 pt-1 flex justify-between font-semibold text-sky-900"><span>Total available{line.warehouse_id ? ' in selected warehouse' : ''}</span><span>{balances.reduce((sum, balance) => sum + Number(balance.quantity), 0).toLocaleString()}</span></div></div> : <div className="mt-1 text-rose-600">No available stock or assigned location found for this item{line.warehouse_id ? ' in the selected warehouse' : ''}.</div>;
                      })() : <div className="mt-1 text-slate-500">Select an item to view its warehouse location and available stock.</div>}
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" className="text-brand-600 text-sm font-medium mt-2" onClick={addLine}>
                + Add line
              </button>
            </div>

            <div className={`rounded-lg px-3 py-2 text-sm ${willNeedApproval ? 'bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-600'}`}>
              Estimated value: {formatCurrency(estimatedValue)}.{' '}
              {willNeedApproval
                ? `This issue will require ${issueApproverRole} approval before stock is deducted.`
                : 'Below threshold — this issue will post immediately.'}
            </div>

            {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={submit}>
                Submit
              </button>
            </div>
          </div>
        </Modal>
      )}
      {viewing && <Modal title={`Material Issue - ${viewing.issue_number}`} onClose={() => setViewing(null)} wide><div className="space-y-3 text-sm"><div><span className="text-slate-500">Employee:</span> {viewing.employee_code} - {viewing.employee_name}</div><div><span className="text-slate-500">Purpose:</span> {viewing.purpose || '-'}</div><table className="table-base"><thead><tr><th>Item</th><th>Warehouse / Site</th><th>Physical Bin</th><th>Quantity</th><th>Value</th></tr></thead><tbody>{viewing.items.map((line: any) => <tr key={line.id}><td>{line.item_code} - {line.description}</td><td>{line.warehouse_name}{line.site_name ? ` — ${line.site_name}`:''}</td><td>{line.location_code || 'Legacy / unassigned'}</td><td>{line.quantity}</td><td>{formatCurrency(line.value)}</td></tr>)}</tbody></table>{viewing.status === 'PendingApproval' && canApprove && <div className="flex justify-end gap-2"><button className="btn-secondary text-rose-600" onClick={async()=>{await reject(viewing.id);setViewing(null);}}>Reject</button><button className="btn-primary" onClick={async()=>{await approve(viewing.id);setViewing(null);}}>Approve</button></div>}</div></Modal>}
    </div>
  );
}
