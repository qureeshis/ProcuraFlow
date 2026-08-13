import React, { useEffect, useState } from 'react';
import client from '../../api/client';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import StatusBadge from '../../components/StatusBadge';
import { useAuth } from '../../contexts/AuthContext';
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

export default function AdjustmentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>({});
  const [error, setError] = useState('');
  const [reviewing, setReviewing] = useState<any | null>(null);

  function load() {
    client.get('/warehouse/adjustments').then((res) => setAdjustments(res.data));
  }

  useEffect(() => {
    load();
    client.get('/masters/operational-items').then((res) => setItems(res.data));
    client.get('/masters/warehouses').then((res) => setWarehouses(res.data));
    client.get('/masters/locations').then((res) => setLocations(res.data));
  }, []);

  useEffect(() => {
    const openId = Number(searchParams.get('open'));
    const target = openId ? adjustments.find((row) => row.id === openId) : null;
    if (!target) return;
    setSearchParams({}, { replace: true });
    setReviewing(target);
  }, [adjustments, searchParams, setSearchParams]);

  async function submit() {
    setError('');
    if (!form.item_id || !form.warehouse_id || !form.location_id || !Number.isFinite(form.quantity_change) || form.quantity_change === 0 || !String(form.reason || '').trim()) return setError('Select an item, warehouse and physical Bin, enter a non-zero quantity change, and provide a reason.');
    try {
      await client.post('/warehouse/adjustments', form);
      setShowForm(false);
      setForm({});
      load();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to submit adjustment');
    }
  }

  async function approve(id: number) {
    try {
      await client.put(`/warehouse/adjustments/${id}/approve`);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Approval failed');
    }
  }

  const canApprove = user && ['WarehouseManager', 'SupplyChainManager'].includes(user.role);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Stock Adjustments</h1>
          <p className="text-sm text-slate-500">Controlled adjustment process — requires reason and approval, fully audited.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          + New Adjustment
        </button>
      </div>

      <div className="card">
        <DataTable
          columns={[
            { key: 'adjustment_number', label: 'Adjustment Number' },
            { key: 'item_code', label: 'Item' },
            { key: 'warehouse_name', label: 'Warehouse' },
            { key: 'location_code', label: 'Physical Bin' },
            { key: 'quantity_change', label: 'Qty Change' },
            { key: 'reason', label: 'Reason' },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          ]}
          rows={adjustments}
          actions={(r) =>
            r.status === 'Pending' && canApprove ? (
              <button className="text-emerald-600 text-xs font-medium" onClick={() => setReviewing(r)}>
                Review
              </button>
            ) : null
          }
        />
      </div>

      {showForm && (
        <Modal title="New Stock Adjustment" onClose={() => setShowForm(false)}>
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
            <div>
              <SearchSelect
                label="Warehouse"
                options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
                value={form.warehouse_id ?? ''}
                onChange={(val) => setForm({ ...form, warehouse_id: Number(val) })}
                placeholder="Search warehouse"
              />
            </div>
            <div><label className="text-sm font-medium text-slate-700">Physical Storage Bin</label><select className="input mt-1" value={form.location_id||''} onChange={e=>setForm({...form,location_id:Number(e.target.value)})}><option value="">Select Bin...</option>{locations.filter(l=>l.type==='Bin'&&Number(l.warehouse_id)===Number(form.warehouse_id)).map(l=><option key={l.id} value={l.id}>{l.code}{l.label ? ` — ${l.label}`:''}</option>)}</select></div>
            <div>
              <label className="text-sm font-medium text-slate-700">Quantity Change (+/-)</label>
              <input className="input mt-1" type="number" value={form.quantity_change ?? ''} onChange={(e) => setForm({ ...form, quantity_change: Number(e.target.value) })} />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Reason</label>
              <input className="input mt-1" value={form.reason ?? ''} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
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
      {reviewing && <Modal title={`Stock Adjustment - ${reviewing.adjustment_number}`} onClose={()=>setReviewing(null)}><div className="space-y-4 text-sm"><div className="grid grid-cols-2 gap-3"><div><span className="text-slate-500">Item:</span> <strong>{reviewing.item_code}</strong></div><div><span className="text-slate-500">Warehouse:</span> <strong>{reviewing.warehouse_name}</strong></div><div><span className="text-slate-500">Physical Bin:</span> <strong>{reviewing.location_code}</strong></div><div><span className="text-slate-500">Quantity change:</span> <strong>{reviewing.quantity_change}</strong></div><div><span className="text-slate-500">Status:</span> <StatusBadge status={reviewing.status}/></div></div><div><span className="text-slate-500">Reason:</span><div className="mt-1 rounded-lg bg-slate-50 p-3">{reviewing.reason}</div></div>{reviewing.status==='Pending'&&canApprove&&<div className="flex justify-end"><button className="btn-primary" onClick={async()=>{await approve(reviewing.id);setReviewing(null);}}>Approve Adjustment</button></div>}</div></Modal>}
    </div>
  );
}
