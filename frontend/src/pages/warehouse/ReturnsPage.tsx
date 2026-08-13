import React, { useEffect, useState } from 'react';
import client from '../../api/client';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
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

export default function ReturnsPage() {
  const [returns, setReturns] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>({});
  const [error, setError] = useState('');

  function load() {
    client.get('/warehouse/returns').then((res) => setReturns(res.data));
  }

  useEffect(() => {
    load();
    client.get('/masters/operational-items').then((res) => setItems(res.data.filter((i: any) => i.consumable_returnable === 'Returnable')));
    client.get('/masters/employee-directory').then((res) => setEmployees(res.data));
    client.get('/masters/warehouses').then((res) => setWarehouses(res.data));
    client.get('/masters/locations').then((res) => setLocations(res.data));
  }, []);

  async function submit() {
    setError('');
    if (!form.item_id || !form.warehouse_id || !form.location_id || !(form.quantity > 0) || !form.condition) return setError('Select an item, warehouse, destination Bin, condition, and quantity greater than zero.');
    try {
      await client.post('/warehouse/returns', form);
      setShowForm(false);
      setForm({});
      load();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to record return');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Returns</h1>
          <p className="text-sm text-slate-500">Returnable items only — tools, equipment, reusable materials. Consumables don't require return.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          + New Return
        </button>
      </div>

      <div className="card">
        <DataTable
          columns={[
            { key: 'return_number', label: 'Return Number' },
            { key: 'item_code', label: 'Item' },
            { key: 'employee_name', label: 'Employee' },
            { key: 'quantity', label: 'Quantity' },
            { key: 'condition', label: 'Condition' },
            { key: 'location_code', label: 'Stored Bin' },
            { key: 'return_date', label: 'Date' },
          ]}
          rows={returns}
        />
      </div>

      {showForm && (
        <Modal title="New Return" onClose={() => setShowForm(false)}>
          <div className="compact-form">
            <div>
              <SearchSelect
                label="Item (Returnable only)"
                options={items.map((it) => ({ value: it.id, label: `${it.item_code} - ${it.description}` }))}
                value={form.item_id ?? ''}
                onChange={(val) => setForm({ ...form, item_id: Number(val) })}
                placeholder="Search item"
              />
            </div>
            <div>
              <SearchSelect
                label="Employee"
                options={employees.map((e) => ({ value: e.id, label: e.name }))}
                value={form.employee_id ?? ''}
                onChange={(val) => setForm({ ...form, employee_id: Number(val) })}
                placeholder="Search employee"
              />
            </div>
            <div>
              <SearchSelect
                label="Return to Warehouse"
                options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
                value={form.warehouse_id ?? ''}
                onChange={(val) => setForm({ ...form, warehouse_id: Number(val) })}
                placeholder="Search warehouse"
              />
            </div>
            <div><label className="text-sm font-medium text-slate-700">Destination Storage Bin</label><select className="input mt-1" value={form.location_id||''} onChange={e=>setForm({...form,location_id:Number(e.target.value)})}><option value="">Select Bin...</option>{locations.filter(l=>l.type==='Bin'&&Number(l.warehouse_id)===Number(form.warehouse_id)).map(l=><option key={l.id} value={l.id}>{l.code}{l.label ? ` — ${l.label}`:''}</option>)}</select></div>
            <div>
              <label className="text-sm font-medium text-slate-700">Quantity</label>
              <input className="input mt-1" type="number" value={form.quantity ?? ''} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Condition</label>
              <select className="input mt-1" value={form.condition ?? ''} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
                <option value="">Select...</option>
                <option value="Good">Good</option>
                <option value="Damaged">Damaged</option>
                <option value="Needs Repair">Needs Repair</option>
              </select>
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
