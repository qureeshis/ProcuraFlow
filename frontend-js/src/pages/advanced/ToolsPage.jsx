import { useEffect, useMemo, useState } from 'react';
import client from '../../api/client';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import SearchSelect from '../../components/SearchSelect';

const emptyForm = { item_id: '', warehouse_id: '', serial_number: '', make: '', model: '', calibration_due_date: '' };

export default function ToolsPage() {
  const [tools, setTools] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [items, setItems] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [checkoutTool, setCheckoutTool] = useState(null);
  const [checkoutEmployee, setCheckoutEmployee] = useState('');
  const [error, setError] = useState('');

  const load = () => client.get('/advanced/tools').then(({ data }) => setTools(data));
  useEffect(() => {
    load();
    Promise.all([
      client.get('/masters/employee-directory'),
      client.get('/masters/operational-items'),
      client.get('/masters/warehouses'),
    ]).then(([employeeResult, itemResult, warehouseResult]) => {
      setEmployees(employeeResult.data);
      setItems(itemResult.data.filter(item => item.consumable_returnable === 'Returnable' && item.active_yn !== 0));
      setWarehouses(warehouseResult.data.filter(warehouse => warehouse.active_yn !== 0));
    });
  }, []);

  const selectedItem = useMemo(() => items.find(item => Number(item.id) === Number(form.item_id)), [items, form.item_id]);
  async function createTool() {
    try {
      setError('');
      await client.post('/advanced/tools', { ...form, item_id: Number(form.item_id), warehouse_id: Number(form.warehouse_id) });
      setShowForm(false); setForm(emptyForm); await load();
    } catch (requestError) { setError(requestError.response?.data?.error || 'Unable to register tool.'); }
  }
  async function checkout() { await client.put(`/advanced/tools/${checkoutTool.id}/checkout`, { employee_id: Number(checkoutEmployee) }); setCheckoutTool(null); setCheckoutEmployee(''); load(); }
  async function checkin(tool) { await client.put(`/advanced/tools/${tool.id}/checkin`, { condition: 'Good' }); load(); }
  const employeeName = id => employees.find(employee => employee.id === id)?.name || '—';

  return <div>
    <div className="mb-4 flex items-center justify-between">
      <div><h1 className="text-xl font-semibold text-slate-900">Tool Management</h1><p className="text-sm text-slate-500">Register returnable tools by warehouse and track assignment, condition, and calibration.</p></div>
      <button className="btn-primary" onClick={() => { setForm(emptyForm); setError(''); setShowForm(true); }}>+ Register Tool</button>
    </div>
    <div className="card"><DataTable columns={[
      { key: 'tool_code', label: 'Tool Code' }, { key: 'item_description', label: 'Description' },
      { key: 'warehouse_name', label: 'Warehouse' }, { key: 'serial_number', label: 'Serial Number' },
      { key: 'employee_id', label: 'Assigned To', render: row => row.employee_id ? employeeName(row.employee_id) : '—' },
      { key: 'condition', label: 'Condition' }, { key: 'calibration_due_date', label: 'Calibration Due' },
    ]} rows={tools} actions={row => row.employee_id && !row.return_date
      ? <button className="btn-secondary" onClick={() => checkin(row)}>Check In</button>
      : <button className="btn-primary" onClick={() => setCheckoutTool(row)}>Check Out</button>} /></div>

    {showForm && <Modal title="Register Tool" onClose={() => setShowForm(false)}>
      <div className="compact-form">
        <SearchSelect label="Linked Returnable Item" options={items.map(item => ({ value: item.id, label: `${item.item_code} — ${item.description}` }))} value={form.item_id} onChange={value => setForm({ ...form, item_id: value })} placeholder="Search item code or description" />
        <div><label className="text-sm font-medium text-slate-700">Item Description</label><input className="input mt-1 bg-slate-50" readOnly value={selectedItem?.description || 'Select an item first'} /></div>
        <SearchSelect label="Warehouse" options={warehouses.map(warehouse => ({ value: warehouse.id, label: warehouse.name }))} value={form.warehouse_id} onChange={value => setForm({ ...form, warehouse_id: value })} placeholder="Search authorized warehouse" />
        <div><label className="text-sm font-medium text-slate-700">Tool Code</label><input className="input mt-1 bg-slate-50" readOnly value="Generated automatically after save" /></div>
        <div className="grid grid-cols-2 gap-3"><div><label className="text-sm font-medium">Serial Number</label><input className="input mt-1" value={form.serial_number} onChange={e => setForm({ ...form, serial_number: e.target.value })} /></div><div><label className="text-sm font-medium">Calibration Due</label><input className="input mt-1" type="date" value={form.calibration_due_date} onChange={e => setForm({ ...form, calibration_due_date: e.target.value })} /></div></div>
        <div className="grid grid-cols-2 gap-3"><div><label className="text-sm font-medium">Make</label><input className="input mt-1" value={form.make} onChange={e => setForm({ ...form, make: e.target.value })} /></div><div><label className="text-sm font-medium">Model</label><input className="input mt-1" value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} /></div></div>
        {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button><button className="btn-primary" disabled={!form.item_id || !form.warehouse_id || !form.serial_number.trim()} onClick={createTool}>Register Tool</button></div>
      </div>
    </Modal>}
    {checkoutTool && <Modal title={`Check Out ${checkoutTool.tool_code}`} onClose={() => setCheckoutTool(null)}><div className="space-y-3"><SearchSelect label="Employee" options={employees.map(employee => ({ value: employee.id, label: employee.name }))} value={checkoutEmployee} onChange={setCheckoutEmployee} placeholder="Search employee" /><div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setCheckoutTool(null)}>Cancel</button><button className="btn-primary" disabled={!checkoutEmployee} onClick={checkout}>Confirm Checkout</button></div></div></Modal>}
  </div>;
}
