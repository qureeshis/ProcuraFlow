import { useEffect, useMemo, useState } from "react";
import client from "../../api/client";
import DataTable from "../../components/DataTable";
import Modal from "../../components/Modal";
import StatusBadge from "../../components/StatusBadge";
import { useAuth } from "../../contexts/AuthContext";

export default function CycleCountPage() {
  const { user } = useAuth();
  const [counts, setCounts] = useState([]), [warehouses, setWarehouses] = useState([]), [items, setItems] = useState([]);
  const [showForm, setShowForm] = useState(false), [warehouseId, setWarehouseId] = useState(""), [itemIds, setItemIds] = useState([]), [itemQuery, setItemQuery] = useState("");
  const [error, setError] = useState(""), [detail, setDetail] = useState(null), [countedQtys, setCountedQtys] = useState({});
  const load = () => client.get("/inventory/cycle-counts").then((response) => setCounts(response.data));
  useEffect(() => { load(); client.get("/masters/warehouses").then((r) => setWarehouses(r.data)); client.get("/masters/operational-items").then((r) => setItems(r.data)); }, []);
  const visibleItems = useMemo(() => { const query = itemQuery.trim().toLowerCase(); return query ? items.filter((item) => `${item.item_code} ${item.description}`.toLowerCase().includes(query)) : items; }, [items, itemQuery]);
  const allSelected = items.length > 0 && itemIds.length === items.length;
  const canApprove = user && ["WarehouseManager", "SupplyChainManager"].includes(user.role);

  async function createCount() {
    setError(""); if (!warehouseId || !itemIds.length) return setError("Select a warehouse and at least one item.");
    try { await client.post("/inventory/cycle-counts", { warehouse_id: Number(warehouseId), item_ids: itemIds }); setShowForm(false); setWarehouseId(""); setItemIds([]); setItemQuery(""); load(); }
    catch (e) { setError(e?.response?.data?.error || "Failed to create count sheet"); }
  }
  async function openDetail(count) {
    try { const { data } = await client.get(`/inventory/cycle-counts/${count.id}`); setDetail(data); setCountedQtys(Object.fromEntries(data.items.map((item) => [item.item_id, item.counted_qty ?? item.system_qty]))); }
    catch (e) { setError(e?.response?.data?.error || "Unable to open count sheet"); }
  }
  async function submitCounts() {
    const submitted = Object.entries(countedQtys).map(([item_id, counted_qty]) => ({ item_id: Number(item_id), counted_qty: Number(counted_qty) }));
    if (submitted.some((line) => !Number.isFinite(line.counted_qty) || line.counted_qty < 0)) return setError("Counted quantities must be zero or greater.");
    try { await client.put(`/inventory/cycle-counts/${detail.id}/submit-counts`, { counts: submitted }); setDetail(null); load(); }
    catch (e) { setError(e?.response?.data?.error || "Failed to submit counts"); }
  }
  async function approveCount(id) { try { await client.put(`/inventory/cycle-counts/${id}/approve`); load(); } catch (e) { setError(e?.response?.data?.error || "Failed to approve count"); } }

  return <div>
    <div className="mb-4 flex items-center justify-between"><div><h1 className="text-xl font-semibold text-slate-900">Cycle Count</h1><p className="text-sm text-slate-500">Generate count sheet → physical count → variance review → approval → adjustment.</p></div><button className="btn-primary" onClick={() => { setError(""); setShowForm(true); }}>+ New Count Sheet</button></div>
    {error && <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
    <div className="card"><DataTable columns={[{ key: "count_number", label: "Count Number" }, { key: "count_date", label: "Date" }, { key: "warehouse_name", label: "Warehouse" }, { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> }]} rows={counts} actions={(row) => <div className="flex gap-2"><button className="btn-secondary" onClick={() => openDetail(row)}>Open Count</button>{row.status === "Counted" && canApprove && <button className="btn-primary" onClick={() => approveCount(row.id)}>Approve</button>}</div>} /></div>
    {showForm && <Modal title="New Cycle Count" wide onClose={() => setShowForm(false)}><div className="space-y-4">
      <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-sm text-indigo-800">Create a controlled physical count sheet for an authorized warehouse.</div>
      <div><label className="text-sm font-medium text-slate-700">Warehouse</label><select className="input mt-1" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}><option value="">Select warehouse...</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></div>
      <div className="rounded-xl border border-slate-200 p-3"><div className="mb-3 flex flex-wrap items-center gap-2"><input type="search" className="input min-w-64 flex-1" placeholder="Search item code or description..." value={itemQuery} onChange={(e) => setItemQuery(e.target.value)} /><button type="button" className="btn-secondary" onClick={() => setItemIds(allSelected ? [] : items.map((item) => item.id))}>{allSelected ? "Clear All" : "Select All Items"}</button><span className="text-sm font-semibold text-indigo-700">{itemIds.length} selected</span></div><div className="grid max-h-72 gap-2 overflow-y-auto md:grid-cols-2">{visibleItems.map((item) => <label key={item.id} className="flex items-start gap-2 rounded-lg border border-slate-100 p-2 text-sm hover:bg-slate-50"><input className="mt-1" type="checkbox" checked={itemIds.includes(item.id)} onChange={(e) => setItemIds(e.target.checked ? [...itemIds, item.id] : itemIds.filter((id) => id !== item.id))} /><span><strong className="block text-slate-800">{item.item_code}</strong><span className="text-slate-500">{item.description}</span></span></label>)}</div></div>
      <div className="flex justify-end gap-2 border-t border-slate-200 pt-3"><button className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button><button className="btn-primary" onClick={createCount}>Generate Count Sheet</button></div>
    </div></Modal>}
    {detail && <Modal title={`Count Sheet — ${detail.count_number}`} wide onClose={() => setDetail(null)}><div className="overflow-x-auto"><table className="table-base mb-3"><thead><tr><th>Item</th><th>System Qty</th><th>Counted Qty</th><th>Variance</th></tr></thead><tbody>{detail.items.map((item) => <tr key={item.id}><td>{item.item_code} — {item.description}</td><td>{item.system_qty}</td><td><input className="input py-1" type="number" min="0" value={countedQtys[item.item_id] ?? ""} onChange={(e) => setCountedQtys({ ...countedQtys, [item.item_id]: e.target.value })} /></td><td>{Number(countedQtys[item.item_id] ?? item.system_qty) - Number(item.system_qty)}</td></tr>)}</tbody></table></div><div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setDetail(null)}>Close</button><button className="btn-primary" onClick={submitCounts}>Submit Counts</button></div></Modal>}
  </div>;
}
