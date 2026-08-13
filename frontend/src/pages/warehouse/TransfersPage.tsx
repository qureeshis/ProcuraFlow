import React, { useEffect, useState } from 'react';
import client from '../../api/client';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import { useAuth } from '../../contexts/AuthContext';
import SearchSelect from '../../components/SearchSelect';
import ProfessionalWarehouseTransfer from '../../components/ProfessionalWarehouseTransfer';
import { useBranding } from '../../contexts/BrandingContext';
import { downloadElementPdf } from '../../utils/downloadPdf';

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

export default function TransfersPage() {
  const { user } = useAuth();
  const { company } = useBranding();
  const [transfers, setTransfers] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [stock, setStock] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>({});
  const [error, setError] = useState('');
  const [transportModes, setTransportModes] = useState<string[]>([]);
  const [transportModesText, setTransportModesText] = useState('');
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [receiving, setReceiving] = useState<any>(null);
  const [receipt, setReceipt] = useState<any>({});
  const [documentView, setDocumentView] = useState<{transfer:any;mode:'dispatch'|'receipt'}|null>(null);

  function load() {
    client.get('/warehouse/transfers').then((res) => setTransfers(res.data));
  }

  useEffect(() => {
    load();
    client.get('/masters/operational-items').then((res) => setItems(res.data.filter((i:any)=>i.active_yn!==0)));
    client.get('/masters/warehouses').then((res) => setWarehouses(res.data));
    client.get('/masters/locations').then((res) => setLocations(res.data));
    client.get('/inventory/stock').then((res) => setStock(res.data));
    client.get('/settings').then((res) => { const configured=String(res.data.global_transport_modes || 'Company Vehicle, Courier, Third-Party Truck, Employee Hand Carry, Internal Forklift'); setTransportModesText(configured); setTransportModes(configured.split(',').map((v: string) => v.trim()).filter(Boolean)); });
  }, []);

  async function submit() {
    setError('');
    if (!form.item_id || !form.from_warehouse_id || !form.from_location_id || !form.to_warehouse_id || !form.to_location_id || !(form.quantity > 0) || !form.transport_mode) return setError('Select an item, source Bin, destination Bin, transfer mode, and quantity greater than zero.');
    if (form.from_warehouse_id === form.to_warehouse_id) return setError('Source and destination warehouses must be different.');
    try {
      await client.post('/warehouse/transfers', form);
      setShowForm(false);
      setForm({});
      load();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to record transfer');
    }
  }
  async function receive(){if(!receipt.to_location_id)return setError('Select the physical Bin where the transferred stock was received.');try{await client.put(`/warehouse/transfers/${receiving.id}/receive`,receipt);setReceiving(null);setReceipt({});setError('');load();}catch(e:any){setError(e?.response?.data?.error||'Unable to receive transfer');}}
  async function saveTransportModes() { await client.put('/settings/global_transport_modes',{value:transportModesText});setTransportModes(transportModesText.split(',').map((v)=>v.trim()).filter(Boolean));setSettingsSaved(true);setTimeout(()=>setSettingsSaved(false),2000); }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Warehouse Transfers</h1>
          <p className="text-sm text-slate-500">Move inventory between warehouses, locations, or bins.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          + New Transfer
        </button>
      </div>

      {user && ['SupplyChainManager','WarehouseManager'].includes(user.role) && <div className="card p-4 mb-4"><h2 className="font-semibold text-indigo-900">Transfer Configuration</h2><p className="text-xs text-slate-500 mt-1">Comma-separated transport modes available when recording stock transfers.</p><label className="block text-sm font-medium mt-3 mb-1">Available Transfer Modes</label><div className="flex gap-2"><input className="input" value={transportModesText} onChange={(e)=>setTransportModesText(e.target.value)}/><button className="btn-secondary shrink-0" onClick={saveTransportModes}>Save Modes</button></div>{settingsSaved&&<div className="text-xs text-emerald-600 mt-2">Transfer modes saved.</div>}</div>}

      <div className="card">
        <DataTable
          columns={[
            { key: 'transfer_number', label: 'Transfer Number' },
            { key: 'item_code', label: 'Item' },
            { key: 'quantity', label: 'Quantity' },
            { key: 'from_warehouse_name', label: 'From Warehouse' },
            { key: 'from_location_code', label: 'From Bin' },
            { key: 'to_warehouse_name', label: 'To Warehouse' },
            { key: 'to_location_code', label: 'To Bin' },
            { key: 'transfer_date', label: 'Date' },
            { key: 'transport_mode', label: 'Mode' },
            { key: 'tracking_reference', label: 'Tracking Ref.' },
            { key: 'status', label: 'Receipt Status' },
            { key: 'receipt_number', label: 'Transfer Receipt' },
          ]}
          rows={transfers}
          actions={(row)=><div className="flex flex-wrap gap-2"><button className="text-indigo-700 text-xs font-semibold" onClick={()=>setDocumentView({transfer:row,mode:'dispatch'})}>Transit Note</button>{row.status==='Received'&&<button className="text-emerald-700 text-xs font-semibold" onClick={()=>setDocumentView({transfer:row,mode:'receipt'})}>Receipt Confirmation</button>}{row.status==='In Transit'&&user?.warehouse_ids?.map(Number).includes(Number(row.to_warehouse_id))&&<button className="text-emerald-700 text-xs font-semibold" onClick={()=>{setReceiving(row);setReceipt({to_location_id:row.to_location_id,receiving_reference:`TRR-${row.transfer_number}`});setError('');}}>Create Receipt</button>}</div>}
        />
      </div>

      {receiving && <Modal title="Receive Warehouse Transfer" onClose={()=>setReceiving(null)}><div className="compact-form"><div className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900"><strong>{receiving.transfer_number}</strong> · {receiving.item_code} · Quantity {receiving.quantity}<br/>Receiving warehouse: {receiving.to_warehouse_name}</div><SearchSelect label="Receiving Physical Bin" options={locations.filter(l=>l.type==='Bin'&&Number(l.warehouse_id)===Number(receiving.to_warehouse_id)).map(l=>({value:l.id,label:`${l.code}${l.label?` — ${l.label}`:''}`}))} value={receipt.to_location_id??''} onChange={v=>setReceipt({...receipt,to_location_id:Number(v)})} placeholder="Search receiving Bin"/><div><label className="text-sm font-medium">Transfer Receipt Number</label><input className="input mt-1" value={receipt.receiving_reference??''} onChange={e=>setReceipt({...receipt,receiving_reference:e.target.value})}/></div><div><label className="text-sm font-medium">Receiving Note</label><textarea className="input mt-1" value={receipt.receiving_note??''} onChange={e=>setReceipt({...receipt,receiving_note:e.target.value})}/></div>{error&&<div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}<div className="flex justify-end gap-2"><button className="btn-secondary" onClick={()=>setReceiving(null)}>Cancel</button><button className="btn-primary" onClick={receive}>Post Transfer Receipt</button></div></div></Modal>}

      {documentView&&<Modal wide title={documentView.mode==='dispatch'?`Transfer Dispatch Note — ${documentView.transfer.transfer_number}`:`Receiving Confirmation — ${documentView.transfer.receipt_number}`} onClose={()=>setDocumentView(null)}><div className="space-y-4"><div className="flex justify-end gap-2 print:hidden"><button className="btn-secondary" onClick={()=>downloadElementPdf(documentView.mode==='dispatch'?'transfer-dispatch-print-document':'transfer-receipt-print-document',documentView.mode==='dispatch'?`${documentView.transfer.transfer_number}-transit-note`:`${documentView.transfer.receipt_number}-receiving-confirmation`)}>Download PDF</button><button className="btn-primary" onClick={()=>window.print()}>Print</button></div><ProfessionalWarehouseTransfer transfer={documentView.transfer} company={company} mode={documentView.mode}/></div></Modal>}

      {showForm && (
        <Modal title="New Transfer" onClose={() => setShowForm(false)}>
          <div className="compact-form">
            <div>
              <SearchSelect
                label="Item"
                options={items.map((it) => ({ value: it.id, label: `${it.item_code} - ${it.description}` }))}
                value={form.item_id ?? ''}
                onChange={(val) => setForm({ ...form, item_id: Number(val) })}
                placeholder="Search item"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <SearchSelect label="From Warehouse" options={warehouses.map((w) => ({ value: w.id, label: w.name }))} value={form.from_warehouse_id ?? ''} onChange={(val) => setForm({ ...form, from_warehouse_id: Number(val),from_location_id:null })} placeholder="Search warehouse" />
              <SearchSelect label="To Warehouse" options={warehouses.map((w) => ({ value: w.id, label: w.name }))} value={form.to_warehouse_id ?? ''} onChange={(val) => setForm({ ...form, to_warehouse_id: Number(val),to_location_id:null })} placeholder="Search warehouse" />
            </div>
            <div className="grid grid-cols-2 gap-3"><div><label className="text-sm font-medium">Source Physical Bin</label><select className="input mt-1" value={form.from_location_id||''} onChange={e=>setForm({...form,from_location_id:Number(e.target.value)})}><option value="">Select stocked Bin...</option>{stock.filter(s=>s.item_id===form.item_id&&s.warehouse_id===form.from_warehouse_id&&s.location_id&&Number(s.quantity)>0).map(s=><option key={s.id} value={s.location_id}>{s.location_code} — Available {s.quantity}</option>)}</select></div><div><label className="text-sm font-medium">Destination Physical Bin</label><select className="input mt-1" value={form.to_location_id||''} onChange={e=>setForm({...form,to_location_id:Number(e.target.value)})}><option value="">Select Bin...</option>{locations.filter(l=>l.type==='Bin'&&l.warehouse_id===form.to_warehouse_id).map(l=><option key={l.id} value={l.id}>{l.code}{l.label?` — ${l.label}`:''}</option>)}</select></div></div>
            <div className="grid grid-cols-2 gap-3"><div><label className="text-sm font-medium text-slate-700">Mode of Transfer</label><select className="input mt-1" value={form.transport_mode ?? ''} onChange={(e)=>setForm({...form,transport_mode:e.target.value})}><option value="">Select...</option>{transportModes.map((mode)=><option key={mode} value={mode}>{mode}</option>)}</select></div><div><label className="text-sm font-medium text-slate-700">Vehicle Reference</label><input className="input mt-1" value={form.vehicle_reference ?? ''} onChange={(e)=>setForm({...form,vehicle_reference:e.target.value})}/></div><div><label className="text-sm font-medium text-slate-700">Driver / Custodian</label><input className="input mt-1" value={form.driver_name ?? ''} onChange={(e)=>setForm({...form,driver_name:e.target.value})}/></div><div><label className="text-sm font-medium text-slate-700">Tracking Reference</label><input className="input mt-1" value={form.tracking_reference ?? ''} onChange={(e)=>setForm({...form,tracking_reference:e.target.value})}/></div></div><div><label className="text-sm font-medium text-slate-700">Remarks</label><textarea className="input mt-1" value={form.remarks ?? ''} onChange={(e)=>setForm({...form,remarks:e.target.value})}/></div>
            <div>
              <label className="text-sm font-medium text-slate-700">Quantity</label>
              <input className="input mt-1" type="number" value={form.quantity ?? ''} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
            </div>
            {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={submit}>
                Save
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
