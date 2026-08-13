import React, { useEffect, useState } from 'react';
import client from '../../api/client';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';

export default function VendorScorecardPage() {
  const [scores, setScores] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>({});

  function load() {
    client.get('/advanced/vendor-scorecards').then((res) => setScores(res.data));
  }

  useEffect(() => {
    load();
    client.get('/masters/suppliers').then((res) => setSuppliers(res.data));
  }, []);

  async function submit() {
    await client.post('/advanced/vendor-scorecards', form);
    setShowForm(false);
    setForm({});
    load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Vendor Performance Scorecard</h1>
          <p className="text-sm text-slate-500">Delivery accuracy, price competitiveness, quality, response time, and reliability.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          + New Scorecard
        </button>
      </div>

      <div className="card">
        <DataTable
          columns={[
            { key: 'supplier_name', label: 'Supplier' },
            { key: 'period', label: 'Period' },
            { key: 'delivery_accuracy', label: 'Delivery' },
            { key: 'price_competitiveness', label: 'Price' },
            { key: 'quality', label: 'Quality' },
            { key: 'response_time', label: 'Response' },
            { key: 'reliability', label: 'Reliability' },
            { key: 'overall_score', label: 'Overall', render: (r) => <span className="font-semibold">{r.overall_score?.toFixed(1)}</span> },
          ]}
          rows={scores}
        />
      </div>

      {showForm && (
        <Modal title="New Vendor Scorecard" onClose={() => setShowForm(false)}>
          <div className="compact-form">
            <select className="input" value={form.supplier_id ?? ''} onChange={(e) => setForm({ ...form, supplier_id: Number(e.target.value) })}>
              <option value="">Supplier...</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input className="input" placeholder="Period (e.g. 2026-Q3)" value={form.period ?? ''} onChange={(e) => setForm({ ...form, period: e.target.value })} />
            {['delivery_accuracy', 'price_competitiveness', 'quality', 'response_time', 'reliability'].map((key) => (
              <div key={key}>
                <label className="text-sm font-medium text-slate-700 capitalize">{key.replace(/_/g, ' ')} (0-5)</label>
                <input
                  className="input mt-1"
                  type="number"
                  min={0}
                  max={5}
                  value={form[key] ?? ''}
                  onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
                />
              </div>
            ))}
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
