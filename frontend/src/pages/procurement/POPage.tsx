import React, { useEffect, useRef, useState } from 'react';
import client from '../../api/client';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import StatusBadge from '../../components/StatusBadge';
import { useAuth } from '../../contexts/AuthContext';
import { formatCurrency } from '../../utils/currency';
import DocumentAttachments from '../../components/DocumentAttachments';
import ProfessionalPurchaseOrder from '../../components/ProfessionalPurchaseOrder';
import ManagementApprovalRequest from '../../components/ManagementApprovalRequest';
import { useSearchParams } from 'react-router-dom';
import { COMPANY_COPY, MANAGEMENT_COPY, PO_VENDOR_COPY, printControlledCopies } from '../../utils/printCopies';
import { downloadElementPdf } from '../../utils/downloadPdf';
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

export default function POPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const [pos, setPos] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [supplierId, setSupplierId] = useState<number | ''>('');
  const [lines, setLines] = useState<any[]>([{ item_id: '', quantity: 1, price: 0, tax: 0 }]);
  const [error, setError] = useState('');
  const [committedDeliveryDate, setCommittedDeliveryDate] = useState('');

  const [approving, setApproving] = useState<any | null>(null);
  const [approvalRef, setApprovalRef] = useState('');
  const [approvalPerson, setApprovalPerson] = useState('');
  const [history, setHistory] = useState<any[]>([]);

  const [doc, setDoc] = useState<any | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [openPrs, setOpenPrs] = useState<any[]>([]);
  const [selectedPrIds, setSelectedPrIds] = useState<number[]>([]);
  const prLoadSequence = useRef(0);

  function load() {
    client.get('/procurement/pos').then((res) => setPos(res.data));
    client.get('/procurement/prs').then((res) => setOpenPrs(res.data.filter((pr:any)=>pr.status==='Submitted'&&pr.approval_decision==='Approved')));
  }

  useEffect(() => {
    load();
    client.get('/masters/suppliers').then((res) => setSuppliers(res.data));
    client.get('/masters/items').then((res) => setItems(res.data.filter((i:any)=>i.active_yn!==0)));
  }, []);

  useEffect(() => {
    const openId = Number(searchParams.get('open'));
    const target = openId ? pos.find((row) => row.id === openId) : null;
    if (!target) return;
    setSearchParams({}, { replace: true });
    openApproval(target);
  }, [pos, searchParams, setSearchParams]);

  const pricingItemKey = Array.from(new Set(lines.map((line)=>Number(line.item_id)).filter(Number.isInteger))).sort((a,b)=>a-b).join(',');
  useEffect(() => {
    if (!supplierId || !pricingItemKey) return;
    let cancelled = false;
    client.post('/procurement/pos/pricing', { supplier_id: supplierId, item_ids: pricingItemKey.split(',').map(Number) }).then((response) => {
      if (cancelled) return;
      const pricing = new Map(response.data.map((row:any)=>[Number(row.item_id),row]));
      setLines((current) => current.map((line) => {
        const history:any = pricing.get(Number(line.item_id));
        if (!history) return line;
        return {
          ...line,
          price: history.latest_supplier_price != null ? Number(history.latest_supplier_price) : line.price,
          tax: history.latest_supplier_tax != null ? Number(history.latest_supplier_tax) : line.tax,
          latest_supplier_po_number: history.latest_supplier_po_number,
          supplier_lowest_price: history.supplier_lowest_price,
          all_supplier_average_price: history.all_supplier_average_price,
          received_history_count: Number(history.received_history_count || 0),
        };
      }));
    }).catch((e:any)=>{ if(!cancelled)setError(e?.response?.data?.error||'Unable to load supplier price history'); });
    return () => { cancelled = true; };
  }, [supplierId, pricingItemKey]);

  function addLine() {
    setLines((current) => [...current, { item_id: '', item_search: '', quantity: 1, price: 0, tax: 0 }]);
  }
  function removeLine(index: number) {
    setLines((current) => current.length === 1 ? current : current.filter((_, lineIndex) => lineIndex !== index));
  }
  function updateLine(i: number, key: string, val: any) {
    setLines((current) => current.map((line, index) => index === i ? { ...line, [key]: val } : line));
  }

  const estimatedTotal = lines.reduce((s, l) => s + (l.quantity || 0) * (l.price || 0) * (1 + (l.tax || 0) / 100), 0);

  async function submit() {
    setError('');
    if (!supplierId) return setError('Select a vendor before submitting the purchase order.');
    if (!committedDeliveryDate) return setError('Committed delivery date is required.');
    if (!editingId && committedDeliveryDate < new Date().toISOString().slice(0,10)) return setError('Committed delivery date cannot be earlier than today.');
    if (!lines.length || lines.some((line) => !Number.isInteger(Number(line.item_id)) || !(Number(line.quantity) > 0) || Number(line.price) < 0 || Number(line.tax || 0) < 0)) return setError('Select a valid item and enter a positive quantity and non-negative price/tax for every PO line.');
    const overPrBalance=lines.find((line)=>line.pr_available_quantity!=null&&Number(line.quantity)>Number(line.pr_available_quantity)+0.0001);
    if(overPrBalance)return setError(`${overPrBalance.item_search||'PO item'} quantity cannot exceed the approved outstanding PR balance of ${Number(overPrBalance.pr_available_quantity).toLocaleString()}.`);
    try {
      if (editingId) await client.put(`/procurement/pos/${editingId}`, { supplier_id: supplierId, committed_delivery_date: committedDeliveryDate, items: lines });
      else await client.post('/procurement/pos', { supplier_id: supplierId, committed_delivery_date: committedDeliveryDate, pr_ids: selectedPrIds, items: lines });
      setShowForm(false);
      setLines([{ item_id: '', item_search: '', quantity: 1, price: 0, tax: 0 }]);
      setSupplierId('');
      setCommittedDeliveryDate('');
      setEditingId(null);
      setSelectedPrIds([]);
      load();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to create PO');
    }
  }

  async function approve() {
    if (approving.external_approval_required && (!approvalRef.trim() || !approvalPerson.trim())) {
      alert('Enter the external approval reference and approving management person after uploading the signed approval document.');
      return;
    }
    try {
      await client.put(`/procurement/pos/${approving.id}/approve`, {
        approval_ref_number: approvalRef,
        approval_person_name: approvalPerson,
      });
      setApproving(null);
      setApprovalRef('');
      setApprovalPerson('');
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Approval failed');
    }
  }

  async function reject(id: number) {
    await client.put(`/procurement/pos/${id}/reject`);
    load();
  }
  async function loadPrForPo(prIds: number[] = selectedPrIds) {
    const sequence = ++prLoadSequence.current;
    if (!prIds.length) {
      setLines([{ item_id: '', item_search: '', quantity: 1, price: 0, tax: 0 }]);
      setError('');
      return;
    }
    try {
      const requisitions = await Promise.all(prIds.map((id) => client.get(`/procurement/prs/${id}`).then((response) => response.data)));
      if (sequence !== prLoadSequence.current) return;
      const consolidated = new Map<number, any>();
      requisitions.forEach((pr) => pr.items.forEach((line: any) => {
        const masterItem = items.find((candidate) => candidate.id === line.item_id);
        const existing = consolidated.get(line.item_id);
        if (existing) { existing.quantity += Number(line.remaining_quantity ?? line.quantity); existing.pr_available_quantity += Number(line.remaining_quantity ?? line.quantity); }
        else consolidated.set(line.item_id, {
          item_id: line.item_id,
          item_search: `${line.item_code} - ${line.description}`,
          quantity: Number(line.remaining_quantity ?? line.quantity),
          pr_available_quantity: Number(line.remaining_quantity ?? line.quantity),
          price: Number(masterItem?.last_purchase_price ?? masterItem?.standard_cost ?? 0),
          tax: 0,
        });
      }));
      setLines(Array.from(consolidated.values()).filter((line)=>line.quantity>0));
      const requestedDates=requisitions.flatMap((pr)=>pr.items.map((line:any)=>line.required_date).filter(Boolean)).sort();
      if(requestedDates.length&&!committedDeliveryDate)setCommittedDeliveryDate(requestedDates[requestedDates.length-1]);
      setError('');
    } catch(e:any) { if (sequence === prLoadSequence.current) setError(e?.response?.data?.error || 'Unable to consolidate the selected PRs'); }
  }

  function togglePurchaseRequisition(prId: number) {
    const next = selectedPrIds.includes(prId) ? selectedPrIds.filter((id)=>id!==prId) : [...selectedPrIds, prId];
    setSelectedPrIds(next);
    loadPrForPo(next);
  }

  async function openDoc(id: number) {
    try {
      const res = await client.get(`/procurement/pos/${id}/document`);
      setDoc(res.data);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Cannot view this PO');
    }
  }

  async function printDoc(id: number) {
    try {
      await client.post(`/procurement/pos/${id}/print`);
      await openDoc(id);
    } catch (e: any) { alert(e?.response?.data?.error || 'Cannot print this PO'); }
  }

  async function openApproval(row: any) {
    try {
      const [detail, approvalHistory] = await Promise.all([
        client.get(`/procurement/pos/${row.id}/document`),
        client.get(`/procurement/pos/${row.id}/approval-history`),
      ]);
      setApproving({ ...row, document: detail.data });
      setHistory(approvalHistory.data);
    } catch (e: any) { alert(e?.response?.data?.error || 'Cannot open PO for approval'); }
  }
  async function editPo(row: any) { try { const detail=(await client.get(`/procurement/pos/${row.id}`)).data;setEditingId(row.id);setSupplierId(detail.supplier_id);setCommittedDeliveryDate(detail.committed_delivery_date||'');setLines(detail.items);setShowForm(true); } catch(e:any){setError(e?.response?.data?.error||'Unable to edit PO');} }

  const canApprove = user && ['PurchaseManager', 'SupplyChainManager'].includes(user.role);
  const canEditPending = user && ['PurchaseOfficer', 'PurchaseManager', 'SupplyChainManager'].includes(user.role);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Purchase Orders</h1>
          <p className="text-sm text-slate-500">
            Approval routing follows both value limits and upward hierarchy: Purchase Officer creators route to Purchase Manager, Purchase Manager creators route to Supply Chain Manager, and POs above the Supply Chain Manager limit require signed higher-management approval.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          + New PO
        </button>
      </div>

      <div className="card">
        <DataTable
          columns={[
            { key: 'po_number', label: 'PO Number' },
            { key: 'pr_number', label: 'Source PR' },
            { key: 'supplier_name', label: 'Supplier' },
            { key: 'committed_delivery_date', label: 'Committed Delivery', render:(r)=><div><div>{r.committed_delivery_date||'Not set'}</div>{r.delivery_status==='Overdue'&&<div className="text-[10px] font-semibold text-rose-600">{r.days_overdue} day{r.days_overdue===1?'':'s'} overdue</div>}</div> },
            { key: 'total_amount', label: 'Total', render: (r) => formatCurrency(r.total_amount) },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          ]}
          rows={pos}
          actions={(r) => (
            <div className="flex gap-2 justify-end">
              {r.status === 'PendingApproval' && r.external_approval_required ? (
                <button className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100" onClick={() => openApproval(r)}>
                  Management Approval Request
                </button>
              ) : r.status === 'PendingApproval' && canApprove && (
                <>
                  <button className="text-emerald-600 text-xs font-medium" onClick={() => openApproval(r)}>
                    Approve
                  </button>
                  <button className="text-rose-600 text-xs font-medium" onClick={() => reject(r.id)}>
                    Reject
                  </button>
                </>
              )}
              {r.status === 'PendingApproval' && canEditPending && <button className="text-slate-600 text-xs font-medium" onClick={() => editPo(r)}>Edit Qty / PO</button>}
              {r.status === 'PendingApproval' && r.external_approval_required && user?.role === 'SupplyChainManager' && <button className="text-rose-600 text-xs font-medium" onClick={() => reject(r.id)}>Reject</button>}
              <button className="text-slate-600 text-xs font-medium" onClick={() => openDoc(r.id)}>View</button>
              {r.status === 'Approved' && (
                <button className="text-brand-600 text-xs font-medium" onClick={() => printDoc(r.id)}>
                  Print
                </button>
              )}
            </div>
          )}
        />
      </div>

      {showForm && (
        <Modal title={editingId ? 'Edit Pending Purchase Order' : 'New Purchase Order'} onClose={() => {setShowForm(false);setEditingId(null);}} wide>
          <div className="compact-form">
            {!editingId && <div className="rounded-lg border border-emerald-200 p-4 bg-emerald-50/60"><h3 className="font-medium text-emerald-900 mb-1">Approved PR Selection</h3><p className="text-xs text-slate-600 mb-3">Select one or more approved PRs. PO items, quantities, descriptions, UOMs, and available purchase prices fill immediately. Identical items are automatically consolidated.</p><label className="block text-sm font-medium mb-2">Approved PRs Awaiting PO</label><div className="max-h-40 overflow-y-auto rounded-lg border border-emerald-200 bg-white divide-y divide-slate-100">{openPrs.length ? openPrs.map((pr)=><label key={pr.id} className="flex cursor-pointer items-start gap-3 px-3 py-2 text-sm hover:bg-emerald-50"><input type="checkbox" className="mt-1" checked={selectedPrIds.includes(pr.id)} onChange={()=>togglePurchaseRequisition(pr.id)}/><span><strong>{pr.pr_number}</strong><span className="block text-xs text-slate-500">{pr.department_name || 'No department'} · {pr.requestor_name || 'Unknown requestor'}</span></span></label>):<div className="px-3 py-4 text-sm text-slate-500">No approved PRs awaiting PO creation are available.</div>}</div><div className="mt-3 text-xs text-emerald-700">{selectedPrIds.length ? `${selectedPrIds.length} PR${selectedPrIds.length===1?'':'s'} selected and automatically loaded. Source references will remain linked to the PO.` : 'Select a PR to fill the PO automatically.'}</div></div>}
            <div className="form-section-tinted">
              <h3 className="form-section-title">Supplier and Delivery Details</h3>
              <div className="grid gap-3 md:grid-cols-2">
              <SearchSelect
                label="Vendor"
                options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                value={supplierId}
                onChange={(val) => setSupplierId(Number(val))}
                placeholder="Search vendor"
              />
              <div><label className="text-sm font-medium text-slate-700">Committed Delivery Date</label><input className="input mt-1" type="date" min={editingId?undefined:new Date().toISOString().slice(0,10)} value={committedDeliveryDate} onChange={(e)=>setCommittedDeliveryDate(e.target.value)}/><p className="mt-1 text-xs text-slate-500">Locked after approval and used for overdue reporting.</p></div>
              </div>
            </div>

            <div className="form-section">
              <h3 className="form-section-title">Purchase Lines</h3>
              <div className="space-y-2 mt-1">
                {lines.map((line, i) => (
                  <div key={i} className="form-line-card grid grid-cols-12 gap-2 items-start">
                    <div className="col-span-12 lg:col-span-4">
                      <SearchSelect
                        label="Item"
                        options={items.map((it) => ({ value: it.id, label: `${it.item_code} - ${it.description}` }))}
                        value={line.item_id || line.item_search || ''}
                        onChange={(val) => {
                          const selected = items.find((it) => it.id === Number(val));
                          setLines((current) => current.map((currentLine, index) => index === i ? { ...currentLine, item_id: selected?.id || '', item_search: selected ? `${selected.item_code} - ${selected.description}` : '' } : currentLine));
                        }}
                        placeholder="Search item"
                      />
                    </div>
                    {(() => { const selectedItem=items.find((item)=>item.id===line.item_id); const unit=selectedItem?.purchase_uom || selectedItem?.uom || 'Unit'; const wholeNumber=['EA','PCS','PC','BOX','BAG','SET','PR','PAIR','PACK','ROLL','BOTTLE','CAN','DRUM','PALLET'].includes(String(unit).toUpperCase()); return <>
                    <div className="col-span-2"><label className="text-sm font-medium text-slate-700">Quantity ({unit})</label><input className="input mt-1" type="number" min={wholeNumber ? 1 : 0.001} max={line.pr_available_quantity!=null?Number(line.pr_available_quantity):undefined} step={wholeNumber ? 1 : 0.001} placeholder={`Qty in ${unit}`} value={line.quantity} onChange={(e) => updateLine(i, 'quantity', Number(e.target.value))} />{line.pr_available_quantity!=null&&<div className="mt-1 text-[10px] font-medium text-emerald-700">Approved PR balance: {Number(line.pr_available_quantity).toLocaleString()} {unit}</div>}</div>
                    <div className="col-span-3"><label className="text-sm font-medium text-slate-700">Price / {unit}</label><input className="input mt-1" type="number" min="0" step="0.01" placeholder={`Price per ${unit}`} value={line.price} onChange={(e) => updateLine(i, 'price', Number(e.target.value))} />{supplierId&&line.item_id&&<div className="mt-1 text-[10px] leading-4 text-slate-500">{line.latest_supplier_po_number ? <>Auto-filled from {line.latest_supplier_po_number}<br/>Supplier lowest: <strong>{formatCurrency(line.supplier_lowest_price)}</strong> · All-vendor average: <strong>{formatCurrency(line.all_supplier_average_price)}</strong></> : <>No received closed-PO history for this supplier{line.received_history_count ? <> · All-vendor average: <strong>{formatCurrency(line.all_supplier_average_price)}</strong></> : ''}</>}</div>}</div>
                    </>; })()}
                    <div className="col-span-3"><label className="text-sm font-medium text-slate-700">Tax %</label><input className="input mt-1" type="number" min="0" step="0.01" placeholder="Tax percentage" value={line.tax} onChange={(e) => updateLine(i, 'tax', Number(e.target.value))} /></div>
                    <div className="col-span-12 flex justify-end">{lines.length > 1 && <button type="button" className="text-xs font-medium text-rose-600 hover:text-rose-800" onClick={()=>removeLine(i)}>Remove item line</button>}</div>
                  </div>
                ))}
              </div>
              <button type="button" className="text-brand-600 text-sm font-medium mt-2" onClick={addLine}>
                + Add line
              </button>
            </div>

            <div className="text-right text-sm font-medium text-slate-700">
              Estimated Total: {formatCurrency(estimatedTotal)}
            </div>

            {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={submit}>
                {editingId ? 'Save Changes' : 'Submit PO'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {approving && (
        <Modal title={approving.external_approval_required ? `Higher Management Approval — ${approving.po_number}` : `Approve ${approving.po_number}`} onClose={() => setApproving(null)} wide={!!approving.external_approval_required}>
          <div className="space-y-3">
            <div className="text-sm text-slate-600">
              Total amount: <span className="font-semibold">{formatCurrency(approving.total_amount)}</span>
            </div>
            {approving.document && !approving.external_approval_required && (
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-sm mb-2"><span className="text-slate-500">Supplier:</span> {approving.document.po.supplier_name}</div>
                <table className="table-base">
                  <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Tax</th></tr></thead>
                  <tbody>{approving.document.items.map((line: any) => <tr key={line.id}><td>{line.item_code} - {line.description}</td><td>{line.quantity}</td><td>{formatCurrency(line.price)}</td><td>{line.tax}%</td></tr>)}</tbody>
                </table>
              </div>
            )}
            {approving.external_approval_required ? <>
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">This PO exceeds the Supply Chain Manager approval limit. Print the separate request below, obtain higher-management approval, then upload the signed document before approving the PO in ProcuraFlow.</div>
              <div className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900"><span className="text-indigo-500">System approval request reference:</span> <strong className="select-all">{approving.document?.po?.management_approval_request_number || approving.management_approval_request_number}</strong></div>
              <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-indigo-200 bg-white/95 p-3 shadow-sm print:hidden"><div><div className="font-semibold text-indigo-900">Professional Management Approval Request</div><div className="text-xs text-slate-500">Print, obtain signature, and upload the signed copy below.</div></div><div className="flex gap-2"><button className="btn-secondary" onClick={()=>downloadElementPdf('management-approval-document',`${approving.po_number}-management-approval`,{copies:[COMPANY_COPY,MANAGEMENT_COPY]})}>Download PDF</button><button className="btn-primary" onClick={() => printControlledCopies('management-approval-document', MANAGEMENT_COPY)}>Print Two Controlled Copies</button></div></div>
              {approving.document && <ManagementApprovalRequest doc={approving.document} />}
              <DocumentAttachments type="MANUAL_APPROVAL" documentId={approving.id} onUploaded={(result) => { if(result.po_status==='Approved'){ alert('Signed management approval uploaded. The PO is now approved and ready for procurement to print.'); setApproving(null); load(); } }} />
            </> : <DocumentAttachments type="PO" documentId={approving.id} />}
            {history.length > 0 && (
              <div className="text-xs bg-slate-50 rounded-lg p-2 space-y-1">
                <div className="font-medium text-slate-600 mb-1">Approval history</div>
                {history.map((h: any) => (
                  <div key={h.id} className="flex justify-between text-slate-500">
                    <span>{h.required_role || 'Requested'} by {h.requested_by_name || '—'}</span>
                    <span>{h.decision}{h.decision_by_name ? ` — ${h.decision_by_name}` : ''}</span>
                  </div>
                ))}
              </div>
            )}
            <div>
              <label className="text-sm font-medium text-slate-700">
                Signed Management Decision Reference {approving.external_approval_required ? <span className="text-rose-600">(required after approval)</span> : null}
              </label>
              <input className="input mt-1" value={approvalRef} onChange={(e) => setApprovalRef(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Approval Person Name</label>
              <input className="input mt-1" value={approvalPerson} onChange={(e) => setApprovalPerson(e.target.value)} placeholder={user?.full_name} />
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setApproving(null)}>
                Cancel
              </button>
              {Number(approving.created_by) === Number(user?.id) && user?.role !== 'SupplyChainManager' ? <span className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">You created this PO and cannot record its approval.</span> : approving.external_approval_required ? <span className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Approval completes only when signed external-management evidence is uploaded above.</span> : <button className="btn-primary" onClick={approve}>Confirm Approval</button>}
            </div>
          </div>
        </Modal>
      )}

      {doc && (
        <Modal title={`Purchase Order — ${doc.po.po_number}`} onClose={() => setDoc(null)} wide>
          <div className="space-y-4">
            <ProfessionalPurchaseOrder doc={doc} />
            <div className="po-supporting-documents print:hidden">
              <DocumentAttachments type="PO" documentId={doc.po.id} />
            </div>
            <div className="flex justify-end print:hidden">
              <button className="btn-secondary mr-2" onClick={()=>downloadElementPdf('po-print-document',`${doc.po.po_number}`,{copies:[COMPANY_COPY]})}>Download Company Record PDF</button>
              <button className="btn-primary" onClick={() => printControlledCopies('po-print-document', PO_VENDOR_COPY)}>
                Print Company + Vendor Copies
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
