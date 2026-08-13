import React, { useEffect, useState } from 'react';
import client from '../../api/client';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import StatusBadge from '../../components/StatusBadge';
import { useAuth } from '../../contexts/AuthContext';

export default function CycleCountPage() {
  const { user } = useAuth();
  const [counts, setCounts] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [warehouseId, setWarehouseId] = useState<number | ''>('');
  const [itemIds, setItemIds] = useState<number[]>([]);
  const [error, setError] = useState('');

  const [detail, setDetail] = useState<any | null>(null);
  const [countedQtys, setCountedQtys] = useState<Record<number, number>>({});

  function load() {
    client.get('/inventory/cycle-counts').then((res) => setCounts(res.data));
  }

  useEffect(() => {
    load();
    client.get('/masters/warehouses').then((res) => setWarehouses(res.data));
    client.get('/masters/operational-items').then((res) => setItems(res.data));
  }, []);

  async function createCount() {
    setError('');
    if (!warehouseId || !itemIds.length) return setError('Select a warehouse and at least one item.');
    try { await client.post('/inventory/cycle-counts', { warehouse_id: warehouseId, item_ids: itemIds }); setShowForm(false); setWarehouseId(''); setItemIds([]); load(); }
    catch (e: any) { setError(e?.response?.data?.error || 'Failed to create count sheet'); }
  }

  function openDetail(count: any) {
    client.get(`/inventory/cycle-counts/${count.id}`).then((res) => {
      setDetail(res.data);
      const initial: Record<number, number> = {};
      res.data.items.forEach((i: any) => (initial[i.item_id] = i.counted_qty ?? i.system_qty));
      setCountedQtys(initial);
    });
  }

  async function submitCounts() {
    const counts = Object.entries(countedQtys).map(([item_id, counted_qty]) => ({ item_id: Number(item_id), counted_qty }));
    if (counts.some((c) => !Number.isFinite(c.counted_qty) || c.counted_qty < 0)) return setError('Counted quantities must be zero or greater.');
    try { await client.put(`/inventory/cycle-counts/${detail.id}/submit-counts`, { counts }); setDetail(null); load(); }
    catch (e: any) { setError(e?.response?.data?.error || 'Failed to submit counts'); }
  }

  async function approveCount(id: number) {
    await client.put(`/inventory/cycle-counts/${id}/approve`);
    load();
  }

  const canApprove = user && ['WarehouseManager', 'SupplyChainManager'].includes(user.role);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Cycle Count</h1>
          <p className="text-sm text-slate-500">Generate count sheet → physical count → variance review → approval → adjustment.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          + New Count Sheet
        </button>
      </div>

      <div className="card">
        <DataTable
          columns={[
            { key: 'count_number', label: 'Count Number' },
            { key: 'count_date', label: 'Date' },
            { key: 'warehouse_name', label: 'Warehouse' },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          ]}
          rows={counts}
          actions={(r) => (
            <div className="flex gap-2 justify-end">
              <button className="text-brand-600 text-xs font-medium" onClick={() => openDetail(r)}>
                Open
              </button>
              {r.status === 'Counted' && canApprove && (
                <button className="text-emerald-600 text-xs font-medium" onClick={() => approveCount(r.id)}>
                  Approve
                </button>
              )}
            </div>
          )}
        />
      </div>

      {showForm && (
        <Modal title="New Cycle Count" onClose={() => setShowForm(false)}>
          <div className="compact-form">
            <div>
              <label className="text-sm font-medium text-slate-700">Warehouse</label>
              <select className="input mt-1" value={warehouseId} onChange={(e) => setWarehouseId(Number(e.target.value))}>
                <option value="">Select...</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Items to Count</label>
              <div className="mt-1 space-y-1 max-h-48 overflow-y-auto border border-slate-200 rounded-lg p-2">
                {items.map((it) => (
                  <label key={it.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={itemIds.includes(it.id)}
                      onChange={(e) => setItemIds(e.target.checked ? [...itemIds, it.id] : itemIds.filter((id) => id !== it.id))}
                    />
                    {it.item_code} - {it.description}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              {error && <div className="mr-auto text-sm text-rose-600">{error}</div>}
              <button className="btn-secondary" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={createCount}>
                Generate
              </button>
            </div>
          </div>
        </Modal>
      )}

      {detail && (
        <Modal title={`Count Sheet — ${detail.count_number}`} onClose={() => setDetail(null)} wide>
          <table className="table-base mb-3">
            <thead>
              <tr>
                <th>Item</th>
                <th>System Qty</th>
                <th>Counted Qty</th>
                <th>Variance</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((it: any) => (
                <tr key={it.id}>
                  <td>
                    {it.item_code} — {it.description}
                  </td>
                  <td>{it.system_qty}</td>
                  <td>
                    <input
                      className="input py-1"
                      type="number"
                      value={countedQtys[it.item_id] ?? ''}
                      onChange={(e) => setCountedQtys({ ...countedQtys, [it.item_id]: Number(e.target.value) })}
                    />
                  </td>
                  <td>{(countedQtys[it.item_id] ?? it.system_qty) - it.system_qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setDetail(null)}>
              Close
            </button>
            <button className="btn-primary" onClick={submitCounts}>
              Submit Counts
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
