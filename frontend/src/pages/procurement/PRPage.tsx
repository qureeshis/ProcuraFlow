import React, { useEffect, useState } from 'react';
import client from '../../api/client';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import StatusBadge from '../../components/StatusBadge';
import { useAuth } from '../../contexts/AuthContext';
import DocumentAttachments from '../../components/DocumentAttachments';
import ProfessionalPurchaseRequisition from '../../components/ProfessionalPurchaseRequisition';
import { downloadElementPdf } from '../../utils/downloadPdf';
import { useSearchParams } from 'react-router-dom';
import SearchSelect from '../../components/SearchSelect';

function LegacySearchSelect({
  label,
  options,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  options: any[];
  value: string | number;
  onChange: (value: any) => void;
  placeholder: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const selected = options.find((opt) => String(opt.value) === String(value))?.label || String(value || '');
    setQuery(selected);
  }, [value, options]);

  const filtered = options.filter((opt) => `${opt.label}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="relative">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <input
        className="input mt-1 w-full"
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
          {filtered.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
              onMouseDown={() => {
                setQuery(opt.label);
                onChange(opt.value);
                setOpen(false);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PRPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [depts, setDepts] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [departmentId, setDepartmentId] = useState<number | ''>('');
  const [requestorName, setRequestorName] = useState(user?.full_name || '');
  const [lines, setLines] = useState<any[]>([{ item_id: '', item_search: '', quantity: 1, required_date: '', reason: '' }]);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState<any | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [createdPrNumber, setCreatedPrNumber] = useState('');

  function load() {
    client.get('/procurement/prs').then((res) => setRows(res.data));
  }

  useEffect(() => {
    load();
    client.get('/masters/items').then((res) => setItems(res.data.filter((i:any)=>i.active_yn!==0)));
    client.get('/masters/departments').then((res) => setDepts(res.data));
    client.get('/masters/employee-directory').then((res) => setEmployees(res.data));
    if (user?.full_name) setRequestorName(user.full_name);
  }, [user]);

  useEffect(() => {
    const openId = Number(searchParams.get('open'));
    const target = openId ? rows.find((row) => row.id === openId) : null;
    if (!target) return;
    setSearchParams({}, { replace: true });
    viewPr(target);
  }, [rows, searchParams, setSearchParams]);

  function addLine() {
    setLines((current) => [...current, { item_id: '', item_search: '', quantity: 1, required_date: '', reason: '' }]);
  }

  function removeLine(index: number) {
    setLines((current) => current.length === 1 ? current : current.filter((_, lineIndex) => lineIndex !== index));
  }

  function updateLine(i: number, key: string, val: any) {
    setLines((current) => current.map((line, index) => index === i ? { ...line, [key]: val } : line));
  }

  async function submit() {
    setError('');
    if (!departmentId || !requestorName.trim() || lines.some((line) => !line.item_id || !Number.isFinite(line.quantity) || line.quantity <= 0)) {
      setError('Select a requestor, department, and valid item quantity greater than zero for every line.');
      return;
    }
    try {
      if (editingId) await client.put(`/procurement/prs/${editingId}`, { department_id: departmentId, items: lines });
      else { const response=await client.post('/procurement/prs', { department_id: departmentId, requestor_name: requestorName, items: lines }); setCreatedPrNumber(response.data.pr_number); }
      setShowForm(false);
      setLines([{ item_id: '', item_search: '', quantity: 1, required_date: '', reason: '' }]);
      setDepartmentId('');
      setRequestorName(user?.full_name || '');
      setEditingId(null);
      load();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to submit PR');
    }
  }

  async function setStatus(id: number, status: string) {
    try { await client.put(`/procurement/prs/${id}/status`, { status }); load(); }
    catch (e: any) { setError(e?.response?.data?.error || `Failed to ${status.toLowerCase()} PR`); }
  }
  async function viewPr(row: any) {
    try { setViewing({ ...row, ...(await client.get(`/procurement/prs/${row.id}`)).data }); }
    catch (e: any) { setError(e?.response?.data?.error || 'Unable to view PR'); }
  }
  async function editPr(row: any) { try { const detail=(await client.get(`/procurement/prs/${row.id}`)).data; setEditingId(row.id);setDepartmentId(detail.department_id);setRequestorName(row.requestor_name||'');setLines(detail.items);setShowForm(true); } catch(e:any){setError(e?.response?.data?.error||'Unable to edit PR');} }

  const canCreate = !!user && ['SupplyChainManager','PurchaseManager','PurchaseOfficer', 'WarehouseManager', 'WarehouseSupervisor','Storekeeper'].includes(user.role);
  const canApprove = !!user && ['PurchaseManager', 'SupplyChainManager'].includes(user.role);
  const canCloseBalance = !!user && ['PurchaseOfficer', 'PurchaseManager', 'SupplyChainManager'].includes(user.role);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Purchase Requisitions</h1>
          <p className="text-sm text-slate-500">Department requests that kick off the procurement workflow.</p>
        </div>
        {canCreate && <button className="btn-primary" onClick={() => { setError(''); setShowForm(true); }}>
          + New PR
        </button>}
      </div>

      <div className="card">
        <DataTable
          columns={[
            { key: 'pr_number', label: 'PR Number' },
            { key: 'department_name', label: 'Department' },
            { key: 'requestor_name', label: 'Requestor' },
            { key: 'auto_generated', label: 'Source', render: (r) => r.auto_generated ? <span className="rounded-full bg-cyan-100 px-2 py-1 text-xs font-semibold text-cyan-800">Automatic Low Stock</span> : <span className="text-xs text-slate-500">Manual</span> },
            { key: 'approval_decision', label: 'Approval', render: (r) => <StatusBadge status={r.approval_decision || 'Pending'} /> },
            { key: 'pr_date', label: 'Date' },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          ]}
          rows={rows}
          actions={(r) => <div className="flex gap-2 justify-end"><button className="text-brand-600 text-xs font-medium" onClick={() => viewPr(r)}>View</button>{r.status === 'Submitted' && r.approval_decision !== 'Approved' && canApprove && <><button className="text-slate-600 text-xs font-medium" onClick={()=>editPr(r)}>Edit</button><button className="text-emerald-600 text-xs font-medium" onClick={() => viewPr(r)}>Review</button></>}</div>}
        />
      </div>

      {showForm && (
        <Modal title={editingId ? 'Edit Purchase Requisition' : 'New Purchase Requisition'} onClose={() => {setShowForm(false);setEditingId(null);}} wide>
          <div className="compact-form">
            <div className="form-section-tinted">
              <h3 className="form-section-title">Request Details</h3>
              <div className="grid md:grid-cols-2 gap-3">
                <SearchSelect
                  label="Employee requesting items"
                  options={employees.map((e) => ({ value: e.name, label: e.name }))}
                  value={requestorName}
                  onChange={(val) => setRequestorName(String(val))}
                  placeholder="Search employee"
                />
                <SearchSelect
                  label="Department"
                  options={depts.map((d) => ({ value: d.id, label: d.name }))}
                  value={departmentId}
                  onChange={(val) => setDepartmentId(Number(val))}
                  placeholder="Search department"
                />
              </div>
            </div>

            <div className="form-section">
              <h3 className="form-section-title">Requested Items</h3>
              <div className="space-y-2 mt-1">
                {lines.map((line, i) => (
                  <div key={i} className="form-line-card grid grid-cols-12 gap-2 items-start">
                    <div className="col-span-12 lg:col-span-4">
                      <SearchSelect
                        label="Requested Item"
                        options={items.map((it) => ({ value: it.id, label: `${it.item_code} - ${it.description}` }))}
                        value={line.item_id || line.item_search || ''}
                        onChange={(val) => {
                          const selected = items.find((it) => it.id === Number(val));
                          setLines((current) => current.map((currentLine, index) => index === i ? {...currentLine,item_id:selected?.id || '',item_search:selected ? `${selected.item_code} - ${selected.description}` : ''} : currentLine));
                        }}
                        placeholder="Search item"
                      />
                    </div>
                    <div className="col-span-4 lg:col-span-2"><label className="text-sm font-medium">Quantity</label><input
                      className="input mt-1"
                      type="number" min="0.0001" step="any"
                      placeholder="Qty"
                      value={line.quantity}
                      onChange={(e) => updateLine(i, 'quantity', Number(e.target.value))}
                    /></div>
                    <div className="col-span-8 lg:col-span-3"><label className="text-sm font-medium">Required Date</label><input
                      className="input mt-1"
                      type="date"
                      value={line.required_date}
                      onChange={(e) => updateLine(i, 'required_date', e.target.value)}
                    /></div>
                    <div className="col-span-12 lg:col-span-3"><label className="text-sm font-medium">Reason / Justification</label><input
                      className="input mt-1"
                      placeholder="Reason"
                      value={line.reason}
                      onChange={(e) => updateLine(i, 'reason', e.target.value)}
                    /></div>
                    <div className="col-span-12 flex justify-end">{lines.length > 1 && <button type="button" className="text-xs font-medium text-rose-600 hover:text-rose-800" onClick={()=>removeLine(i)}>Remove item line</button>}</div>
                  </div>
                ))}
              </div>
              <button type="button" className="text-brand-600 text-sm font-medium mt-2" onClick={addLine}>
                + Add line
              </button>
            </div>

            {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={submit}>
                {editingId ? 'Save Changes' : 'Submit PR'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {createdPrNumber && <Modal title="Purchase Requisition Submitted" onClose={()=>setCreatedPrNumber('')}><div className="space-y-4 text-sm"><p className="text-slate-600">The system generated the following unique PR reference:</p><div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center text-xl font-bold text-emerald-800 select-all">{createdPrNumber}</div><p className="text-xs text-slate-500">Use this reference for review, approval, reporting, and PO conversion.</p><div className="flex justify-end"><button className="btn-primary" onClick={()=>setCreatedPrNumber('')}>Done</button></div></div></Modal>}
      {viewing && <Modal title={`Purchase Requisition - ${viewing.pr_number}`} onClose={() => setViewing(null)} wide>
        <div className="space-y-4"><div className="flex justify-end gap-2 print:hidden"><button className="btn-secondary" onClick={()=>downloadElementPdf('pr-print-document',viewing.pr_number)}>Download PDF</button><button className="btn-primary" onClick={()=>window.print()}>Print Professional PR</button></div><ProfessionalPurchaseRequisition requisition={viewing}/><div className="print:hidden"><DocumentAttachments type="PR" documentId={viewing.id} /></div>
        {viewing.status === 'Submitted' && !viewing.approvals?.some((approval:any)=>approval.decision==='Approved') && canApprove && <div className="flex justify-end gap-2 print:hidden"><button className="btn-secondary text-rose-600" onClick={async () => { await setStatus(viewing.id, 'Rejected'); setViewing(null); }}>Reject</button><button className="btn-primary" onClick={async () => { await setStatus(viewing.id, 'Approved'); setViewing(null); }}>Approve</button></div>}
        {viewing.status === 'Submitted' && viewing.approvals?.some((approval:any)=>approval.decision==='Approved') && canCloseBalance && <div className="print:hidden rounded-lg border border-amber-200 bg-amber-50 p-3"><div className="mb-2 text-sm text-amber-900">The PR has an approved open balance. Close it only when no further PO will be created for the remaining quantity.</div><div className="flex justify-end"><button className="btn-secondary text-amber-800" onClick={async()=>{if(window.confirm('Close the remaining PR balance? No additional PO can be created from this PR.')){await setStatus(viewing.id,'Closed');setViewing(null);}}}>Close Remaining PR Balance</button></div></div>}</div>
      </Modal>}
    </div>
  );
}
