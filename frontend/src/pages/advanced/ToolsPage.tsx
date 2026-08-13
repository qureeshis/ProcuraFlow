import React, { useEffect, useState } from 'react';
import client from '../../api/client';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';

export default function ToolsPage() {
  const [tools, setTools] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>({});
  const [checkoutTool, setCheckoutTool] = useState<any | null>(null);
  const [checkoutEmployee, setCheckoutEmployee] = useState<number | ''>('');

  function load() {
    client.get('/advanced/tools').then((res) => setTools(res.data));
  }

  useEffect(() => {
    load();
    client.get('/masters/employee-directory').then((res) => setEmployees(res.data));
    client.get('/masters/operational-items').then((res) => setItems(res.data.filter((i: any) => i.consumable_returnable === 'Returnable')));
  }, []);

  async function createTool() {
    await client.post('/advanced/tools', form);
    setShowForm(false);
    setForm({});
    load();
  }

  async function checkout() {
    await client.put(`/advanced/tools/${checkoutTool.id}/checkout`, { employee_id: checkoutEmployee });
    setCheckoutTool(null);
    setCheckoutEmployee('');
    load();
  }

  async function checkin(tool: any) {
    await client.put(`/advanced/tools/${tool.id}/checkin`, { condition: 'Good' });
    load();
  }

  const employeeName = (id: number) => employees.find((e) => e.id === id)?.name;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Tool Management</h1>
          <p className="text-sm text-slate-500">Track tools by serial number, employee assignment, condition, and calibration.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          + Register Tool
        </button>
      </div>

      <div className="card">
        <DataTable
          columns={[
            { key: 'tool_code', label: 'Tool Code' },
            { key: 'serial_number', label: 'Serial Number' },
            { key: 'employee_id', label: 'Assigned To', render: (r) => (r.employee_id ? employeeName(r.employee_id) : '—') },
            { key: 'issue_date', label: 'Issue Date' },
            { key: 'return_date', label: 'Return Date' },
            { key: 'calibration_due_date', label: 'Calibration Due' },
          ]}
          rows={tools}
          actions={(r) =>
            r.employee_id && !r.return_date ? (
              <button className="text-amber-600 text-xs font-medium" onClick={() => checkin(r)}>
                Check In
              </button>
            ) : (
              <button className="text-brand-600 text-xs font-medium" onClick={() => setCheckoutTool(r)}>
                Check Out
              </button>
            )
          }
        />
      </div>

      {showForm && (
        <Modal title="Register Tool" onClose={() => setShowForm(false)}>
          <div className="compact-form">
            <div>
              <label className="text-sm font-medium text-slate-700">Tool Code</label>
              <input className="input mt-1" value={form.tool_code ?? ''} onChange={(e) => setForm({ ...form, tool_code: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Serial Number</label>
              <input className="input mt-1" value={form.serial_number ?? ''} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Linked Item</label>
              <select className="input mt-1" value={form.item_id ?? ''} onChange={(e) => setForm({ ...form, item_id: Number(e.target.value) })}>
                <option value="">Select...</option>
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.item_code} - {it.description}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Calibration Due Date</label>
              <input className="input mt-1" type="date" value={form.calibration_due_date ?? ''} onChange={(e) => setForm({ ...form, calibration_due_date: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={createTool}>
                Save
              </button>
            </div>
          </div>
        </Modal>
      )}

      {checkoutTool && (
        <Modal title={`Check Out ${checkoutTool.tool_code}`} onClose={() => setCheckoutTool(null)}>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-slate-700">Employee</label>
              <select className="input mt-1" value={checkoutEmployee} onChange={(e) => setCheckoutEmployee(Number(e.target.value))}>
                <option value="">Select...</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setCheckoutTool(null)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={checkout}>
                Confirm
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
