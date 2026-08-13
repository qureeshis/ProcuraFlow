import React, { useEffect, useState } from 'react';
import client from '../../api/client';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import { currencyFieldLabel, formatCurrency } from '../../utils/currency';
import DocumentAttachments from '../../components/DocumentAttachments';
import { useAuth } from '../../contexts/AuthContext';
import ProfessionalGoodsReceiptNote from '../../components/ProfessionalGoodsReceiptNote';
import StatusBadge from '../../components/StatusBadge';
import { COMPANY_COPY, GRN_VENDOR_COPY, printControlledCopies } from '../../utils/printCopies';
import { downloadElementPdf } from '../../utils/downloadPdf';
import SearchSelect from '../../components/SearchSelect';

export default function GRNPage() {
  const { user } = useAuth();
  const authorizedWarehouseIds=(user?.warehouse_ids||[]).map(Number);
  const singleWarehouseId=authorizedWarehouseIds.length===1?authorizedWarehouseIds[0]:'';
  const [grns, setGrns] = useState<any[]>([]);
  const [pos, setPos] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [poId, setPoId] = useState<number | ''>('');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [receivingWarehouseId,setReceivingWarehouseId]=useState<number|''>(singleWarehouseId);
  const [lines, setLines] = useState<any[]>([
    { item_id: '', item_search: '', quantity_received: 1, accepted_qty: 1, rejected_qty: 0, rejection_reason: '', unit_cost: 0, batch: '', expiry_date: '', warehouse_id: '' },
  ]);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState<any | null>(null);

  function load() {
    client.get('/warehouse/grns').then((res) => setGrns(res.data));
  }

  useEffect(() => {
    load();
    client.get('/procurement/pos').then((res) => setPos(res.data.filter((p: any) => ['Approved', 'Printed', 'Closed'].includes(p.status) && !Number(p.fully_received))));
    client.get('/masters/operational-items').then((res) => setItems(res.data));
    client.get('/masters/locations').then((res) => setLocations(res.data));
  }, []);

  useEffect(()=>{if(singleWarehouseId)setReceivingWarehouseId(singleWarehouseId);},[singleWarehouseId]);

  function updateLine(i: number, key: string, val: any) {
    setLines((current) => current.map((line, index) => {
      if (index !== i) return line;
      const updated = { ...line, [key]: val };
      if (key === 'quantity_received') updated.accepted_qty = val;
      if (key === 'accepted_qty') updated.rejected_qty = Math.max(0, updated.quantity_received - val);
      if (key === 'rejected_qty') updated.accepted_qty = Math.max(0, updated.quantity_received - val);
      return updated;
    }));
  }

  function itemRequiresInspection(itemId: number) {
    return items.find((it) => it.id === itemId)?.inspection_required_yn;
  }

  async function selectPurchaseOrder(value: any) {
    const selectedId = Number(value);
    setPoId(selectedId || '');
    setError('');
    if (!selectedId) {
      setLines([]);
      return;
    }
    try {
      const po = (await client.get(`/procurement/pos/${selectedId}`)).data;
      const outstandingLines = po.items
        .filter((line: any) => Number(line.outstanding_qty ?? line.quantity) > 0)
        .map((line: any) => {
          const outstanding = Number(line.outstanding_qty ?? line.quantity);
          return {
            item_id: line.item_id,
            item_search: `${line.item_code} - ${line.description}`,
            item_code: line.item_code,
            description: line.description,
            uom: line.purchase_uom || line.uom || '',
            ordered_qty: Number(line.quantity),
            previously_received_qty: Number(line.received_qty || 0),
            outstanding_qty: outstanding,
            quantity_received: outstanding,
            accepted_qty: outstanding,
            rejected_qty: 0,
            rejection_reason: '',
            unit_cost: Number(line.price || 0),
            tax: Number(line.tax || 0),
            batch: '',
            expiry_date: '',
            warehouse_id: receivingWarehouseId,
            location_id: '',
          };
        });
      setLines(outstandingLines);
      if (!outstandingLines.length) setError('All items on this PO have already been fully received.');
    } catch (e: any) {
      setLines([]);
      setError(e?.response?.data?.error || 'Unable to load PO items');
    }
  }

  async function submit() {
    try {
      if(!receivingWarehouseId)return setError('Select the receiving warehouse.');
      await client.post('/warehouse/grns', { po_id: poId, delivery_note: deliveryNote, warehouse_id:receivingWarehouseId,items:lines.map(line=>({...line,warehouse_id:receivingWarehouseId})) });
      setShowForm(false);
      setPoId('');
      setDeliveryNote('');
      setLines([{ item_id: '', item_search: '', quantity_received: 1, accepted_qty: 1, rejected_qty: 0, rejection_reason: '', unit_cost: 0, batch: '', expiry_date: '', warehouse_id: '' }]);
      load();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to post GRN');
    }
  }

  async function viewGrn(id: number) {
    try { setViewing((await client.get(`/warehouse/grns/${id}`)).data); }
    catch (e: any) { setError(e?.response?.data?.error || 'Unable to view GRN'); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Goods Receipt Note (GRN)</h1>
          <p className="text-sm text-slate-500">
            Split accepted vs. rejected quantity on inspection. Only accepted quantity creates FIFO cost layers and updates
            stock; the item's last purchase price is updated automatically.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          + New GRN
        </button>
      </div>

      <div className="card">
        <DataTable
          columns={[
            { key: 'grn_number', label: 'GRN Number' },
            { key: 'po_number', label: 'PO Number' },
            { key: 'supplier_name', label: 'Supplier' },
            { key: 'delivery_note', label: 'Delivery Note' },
            { key: 'accepted_value', label: 'Accepted Value', render: (r) => formatCurrency(r.accepted_value ?? 0) },
            { key: 'status', label: 'GRN Status', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'grn_date', label: 'Date' },
          ]}
          rows={grns}
          actions={(row) => <button className="text-brand-600 text-xs font-medium" onClick={() => viewGrn(row.id)}>View</button>}
        />
      </div>

      {showForm && (
        <Modal title="New GRN" onClose={() => setShowForm(false)} wide>
          <div className="compact-form">
            <div className="form-section-tinted">
              <h3 className="form-section-title">GRN Header</h3>
              <div className="grid gap-3 lg:grid-cols-3">
              <SearchSelect
                label="Purchase Order"
                options={pos.map((p) => ({ value: p.id, label: `${p.po_number} — ${p.supplier_name}${p.committed_delivery_date ? ` — Due ${p.committed_delivery_date}` : ''}` }))}
                value={poId}
                onChange={selectPurchaseOrder}
                placeholder="Search PO"
              />
              <div><label className="text-sm font-medium text-slate-700">Receiving Warehouse</label>{authorizedWarehouseIds.length===1?<div className="input mt-1 bg-slate-100 text-slate-700">{locations.find(location=>Number(location.warehouse_id)===Number(singleWarehouseId))?.warehouse_name||user?.warehouse_name||'Assigned warehouse'}</div>:<select className="input mt-1" value={receivingWarehouseId} onChange={event=>{const id=Number(event.target.value)||'';setReceivingWarehouseId(id);setLines(current=>current.map(line=>({...line,warehouse_id:id,location_id:''})));}}><option value="">Select authorized warehouse...</option>{Array.from(new Map(locations.map(location=>[Number(location.warehouse_id),{id:Number(location.warehouse_id),name:location.warehouse_name}])).values()).map(warehouse=><option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select>}<p className="mt-1 text-xs text-slate-500">Controlled by the employee's active warehouse responsibility.</p></div>
              <div>
                <label className="text-sm font-medium text-slate-700">Delivery Note</label>
                <input className="input mt-1" value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} />
              </div>
              </div>
            </div>

            <div className="form-section">
              <h3 className="font-medium text-slate-800 mb-1">Items Received</h3>
              <p className="mb-3 text-xs text-slate-500">Items and outstanding quantities are filled automatically from the selected PO. Enter the actual received and inspection quantities.</p>
              <div className="space-y-3 mt-1">
                {lines.map((line, i) => (
                  <div key={i} className="form-line-card space-y-2">
                    <div className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-5"><label className="text-xs font-medium">PO Item</label><div className="input mt-1 bg-slate-50"><strong>{line.item_code}</strong> - {line.description} <span className="text-slate-500">({line.uom})</span></div></div>
                      <div className="col-span-2"><label className="text-xs font-medium">{currencyFieldLabel('PO Unit Cost')}</label><div className="input mt-1 bg-slate-100 text-right font-semibold tabular-nums">{formatCurrency(line.unit_cost)}</div><div className="mt-1 text-right text-[10px] text-slate-500">Locked from approved PO</div></div>
                      <div className="col-span-3"><label className="text-xs font-medium">Batch Number</label><input className="input mt-1" placeholder="Batch" value={line.batch} onChange={(e) => updateLine(i, 'batch', e.target.value)} /></div>
                      <div className="col-span-2"><label className="text-xs font-medium">Expiry Date</label><input className="input mt-1" type="date" value={line.expiry_date} onChange={(e) => updateLine(i, 'expiry_date', e.target.value)} /></div>
                    </div>
                    <div className="grid grid-cols-12 gap-2"><div className="col-span-3"><label className="text-xs font-medium">PO Tax</label><div className="input mt-1 bg-slate-100 text-right font-semibold tabular-nums">{Number(line.tax||0).toLocaleString(undefined,{maximumFractionDigits:2})}%</div></div><div className="col-span-3"><label className="text-xs font-medium">Accepted Net Value</label><div className="input mt-1 bg-slate-100 text-right font-semibold tabular-nums">{formatCurrency(Number(line.accepted_qty||0)*Number(line.unit_cost||0))}</div></div><div className="col-span-3"><label className="text-xs font-medium">Accepted Tax</label><div className="input mt-1 bg-slate-100 text-right font-semibold tabular-nums">{formatCurrency(Number(line.accepted_qty||0)*Number(line.unit_cost||0)*Number(line.tax||0)/100)}</div></div><div className="col-span-3"><label className="text-xs font-medium">Accepted Gross Value</label><div className="input mt-1 bg-indigo-50 text-right font-semibold tabular-nums">{formatCurrency(Number(line.accepted_qty||0)*Number(line.unit_cost||0)*(1+Number(line.tax||0)/100))}</div></div></div>
                    <div><label className="text-xs font-medium text-slate-700">Put-away Storage Bin</label><select className="input mt-1" value={line.location_id || ''} onChange={e=>updateLine(i,'location_id',Number(e.target.value))}><option value="">Select the physical Bin...</option>{locations.filter(l=>l.type==='Bin' && Number(l.warehouse_id)===Number(receivingWarehouseId)).map(l=><option key={l.id} value={l.id}>{l.code}{l.label ? ` — ${l.label}`:''}</option>)}</select><p className="mt-1 text-[11px] text-slate-500">This generated Bin ID is recorded on the GRN, FIFO layer, stock card and future issues.</p></div>
                    <div className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-3">
                        <label className="text-xs text-slate-500">Qty Received ({line.uom})</label>
                        <input className="input" type="number" min="0" max={line.outstanding_qty} value={line.quantity_received} onChange={(e) => updateLine(i, 'quantity_received', Number(e.target.value))} />
                      </div>
                      <div className="col-span-3">
                        <label className="text-xs text-slate-500">Accepted Qty</label>
                        <input className="input" type="number" value={line.accepted_qty} onChange={(e) => updateLine(i, 'accepted_qty', Number(e.target.value))} />
                      </div>
                      <div className="col-span-3">
                        <label className="text-xs text-slate-500">Rejected Qty</label>
                        <input className="input" type="number" value={line.rejected_qty} onChange={(e) => updateLine(i, 'rejected_qty', Number(e.target.value))} />
                      </div>
                      <div className="col-span-3">
                        <label className="text-xs text-slate-500">Rejection Reason</label>
                        <input className="input" value={line.rejection_reason} onChange={(e) => updateLine(i, 'rejection_reason', e.target.value)} disabled={!line.rejected_qty} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {!poId && <div className="rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-800">Select a purchase order to load its items.</div>}
            </div>

            {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button className="btn-primary" disabled={!receivingWarehouseId || !poId || !lines.length} onClick={submit}>
                Post GRN
              </button>
            </div>
          </div>
        </Modal>
      )}
      {viewing && <Modal title={`GRN - ${viewing.grn_number}`} onClose={() => setViewing(null)} wide>
        <div className="space-y-4"><div className="flex justify-end gap-2 print:hidden"><button className="btn-secondary" onClick={()=>downloadElementPdf('grn-print-document',viewing.grn_number,{copies:[COMPANY_COPY,GRN_VENDOR_COPY]})}>Download Two-Copy PDF</button><button className="btn-primary" onClick={()=>printControlledCopies('grn-print-document',GRN_VENDOR_COPY)}>Print Company + Vendor Copies</button></div><ProfessionalGoodsReceiptNote grn={viewing}/><div className="print:hidden"><DocumentAttachments type="GRN" documentId={viewing.id} /></div></div>
      </Modal>}
    </div>
  );
}
