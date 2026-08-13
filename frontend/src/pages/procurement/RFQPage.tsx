import React, { useEffect, useState } from 'react';
import client from '../../api/client';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import StatusBadge from '../../components/StatusBadge';
import { useAuth } from '../../contexts/AuthContext';
import { formatCurrency, getStoredCurrency } from '../../utils/currency';

export default function RFQPage() {
  const { user } = useAuth();
  const [rfqs, setRfqs] = useState<any[]>([]);
  const [prs, setPrs] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [prId, setPrId] = useState<number | ''>('');
  const [supplierIds, setSupplierIds] = useState<number[]>([]);

  const [comparing, setComparing] = useState<any | null>(null);
  const [comparison, setComparison] = useState<any[]>([]);
  const [showQuoteForm, setShowQuoteForm] = useState(false);
  const [quoteForm, setQuoteForm] = useState<any>({});
  const [error, setError] = useState('');

  function load() {
    client.get('/procurement/rfqs').then((res) => setRfqs(res.data));
  }

  useEffect(() => {
    load();
    client.get('/procurement/prs').then((res) => setPrs(res.data.filter((pr: any) => pr.status === 'Submitted' && pr.approval_decision === 'Approved' && !pr.converted_po_id)));
    client.get('/masters/suppliers').then((res) => setSuppliers(res.data));
    client.get('/masters/items').then((res) => setItems(res.data));
  }, []);

  async function createRfq() {
    setError('');
    if (!supplierIds.length) return setError('Select at least one supplier.');
    try {
      await client.post('/procurement/rfqs', { pr_id: prId || null, supplier_ids: supplierIds });
      setShowForm(false); setPrId(''); setSupplierIds([]); load();
    } catch (e: any) { setError(e?.response?.data?.error || 'Failed to create RFQ'); }
  }

  function openComparison(rfq: any) {
    setComparing(rfq);
    client.get(`/procurement/rfqs/${rfq.id}/comparison`).then((res) => setComparison(res.data));
  }

  async function addQuote() {
    setError('');
    if (!quoteForm.supplier_id || !quoteForm.item_id || !(quoteForm.price > 0) || quoteForm.delivery_time_days < 0 || quoteForm.quality_rating < 0 || quoteForm.quality_rating > 5) return setError('Select supplier and item; price must be positive, delivery non-negative, and quality rating 0–5.');
    try {
      await client.post(`/procurement/rfqs/${comparing.id}/quotations`, quoteForm);
      setShowQuoteForm(false); setQuoteForm({}); openComparison(comparing);
    } catch (e: any) { setError(e?.response?.data?.error || 'Failed to record quotation'); }
  }

  async function selectQuote(id: number) {
    try { await client.put(`/procurement/quotations/${id}/select`); openComparison(comparing); }
    catch (e: any) { setError(e?.response?.data?.error || 'Failed to select quotation'); }
  }

  const canWrite = !!user && ['PurchaseOfficer', 'PurchaseManager'].includes(user.role);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">RFQ &amp; Supplier Quotations</h1>
          <p className="text-sm text-slate-500">Send RFQs, record quotations, and compare suppliers.</p>
        </div>
        {canWrite && <button className="btn-primary" onClick={() => { setError(''); setShowForm(true); }}>
          + New RFQ
        </button>}
      </div>

      {error && <div className="mb-4 text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}
      <div className="card">
        <DataTable
          columns={[
            { key: 'rfq_number', label: 'RFQ Number' },
            { key: 'rfq_date', label: 'Date' },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          ]}
          rows={rfqs}
          actions={(r) => (
            <button className="text-brand-600 text-xs font-medium" onClick={() => openComparison(r)}>
              View / Compare
            </button>
          )}
        />
      </div>

      {showForm && (
        <Modal title="New RFQ" onClose={() => setShowForm(false)}>
          <div className="compact-form">
            <div>
              <label className="text-sm font-medium text-slate-700">Linked PR (optional)</label>
              <select className="input mt-1" value={prId} onChange={(e) => setPrId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">None</option>
                {prs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.pr_number}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Send to Suppliers</label>
              <div className="mt-1 space-y-1 max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2">
                {suppliers.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={supplierIds.includes(s.id)}
                      onChange={(e) =>
                        setSupplierIds(e.target.checked ? [...supplierIds, s.id] : supplierIds.filter((id) => id !== s.id))
                      }
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={createRfq}>
                Create RFQ
              </button>
            </div>
          </div>
        </Modal>
      )}

      {comparing && (
        <Modal title={`Quotation Comparison — ${comparing.rfq_number}`} onClose={() => setComparing(null)} wide>
          <div className="flex justify-end mb-2">
            {canWrite && <button className="btn-secondary text-xs" onClick={() => { setError(''); setShowQuoteForm(true); }}>
              + Record Quotation
            </button>}
          </div>
          <DataTable
            columns={[
              { key: 'item_code', label: 'Item' },
              { key: 'supplier_name', label: 'Supplier' },
              { key: 'price', label: 'Unit Price', render: (r) => formatCurrency(r.price, r.currency || getStoredCurrency()) },
              { key: 'freight', label: 'Freight', render: (r) => formatCurrency(r.freight, r.currency || getStoredCurrency()) },
              { key: 'tax', label: 'Tax %' },
              { key: 'currency', label: 'Currency' },
              { key: 'total_landed_cost', label: 'Landed Cost', render: (r) => formatCurrency(r.total_landed_cost, r.currency || getStoredCurrency()) },
              { key: 'delivery_time_days', label: 'Delivery (days)' },
              { key: 'payment_terms', label: 'Payment Terms' },
              { key: 'quality_rating', label: 'Quality' },
              { key: 'supplier_score', label: 'Supplier Score' },
              { key: 'warranty', label: 'Warranty' },
              { key: 'selected', label: 'Selected', render: (r) => (r.selected ? '✅' : '') },
            ]}
            rows={comparison}
            actions={(r) =>
              !r.selected && canWrite ? (
                <button className="text-brand-600 text-xs font-medium" onClick={() => selectQuote(r.id)}>
                  Select
                </button>
              ) : null
            }
          />

          {showQuoteForm && (
            <Modal title="Record Supplier Quotation" onClose={() => setShowQuoteForm(false)}>
              <div className="space-y-3">
                <div><label className="text-sm font-medium">Supplier</label><select className="input mt-1" value={quoteForm.supplier_id ?? ''} onChange={(e) => setQuoteForm({ ...quoteForm, supplier_id: Number(e.target.value) })}>
                  <option value="">Supplier...</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select></div>
                <div><label className="text-sm font-medium">Quoted Item</label><select className="input mt-1" value={quoteForm.item_id ?? ''} onChange={(e) => setQuoteForm({ ...quoteForm, item_id: Number(e.target.value) })}>
                  <option value="">Item...</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.item_code} - {it.description}
                    </option>
                  ))}
                </select></div>
                <div><label className="text-sm font-medium">Unit Price ({quoteForm.currency || getStoredCurrency()})</label><input className="input mt-1" type="number" placeholder="Price" value={quoteForm.price ?? ''} onChange={(e) => setQuoteForm({ ...quoteForm, price: Number(e.target.value) })} /></div>
                <div><label className="text-sm font-medium">Freight Cost ({quoteForm.currency || getStoredCurrency()})</label><input className="input mt-1" type="number" min="0" placeholder="Freight" value={quoteForm.freight ?? ''} onChange={(e) => setQuoteForm({ ...quoteForm, freight: Number(e.target.value) })} /></div>
                <div><label className="text-sm font-medium">Tax Percentage</label><input className="input mt-1" type="number" min="0" placeholder="Tax %" value={quoteForm.tax ?? ''} onChange={(e) => setQuoteForm({ ...quoteForm, tax: Number(e.target.value) })} /></div>
                <div><label className="text-sm font-medium">Quotation Currency</label><input className="input mt-1 bg-slate-100" readOnly value={getStoredCurrency()} title="Controlled by the company master currency in System Settings"/><p className="mt-1 text-xs text-slate-500">Controlled by Company Master Data.</p></div>
                <div><label className="text-sm font-medium">Lead Time (Days)</label><input className="input mt-1" type="number" placeholder="Delivery time" value={quoteForm.delivery_time_days ?? ''} onChange={(e) => setQuoteForm({ ...quoteForm, delivery_time_days: Number(e.target.value) })} /></div>
                <div><label className="text-sm font-medium">Payment Terms</label><input className="input mt-1" placeholder="Payment terms" value={quoteForm.payment_terms ?? ''} onChange={(e) => setQuoteForm({ ...quoteForm, payment_terms: e.target.value })} /></div>
                <div><label className="text-sm font-medium">Quality Rating (0–5)</label><input className="input mt-1" type="number" placeholder="Quality rating" value={quoteForm.quality_rating ?? ''} onChange={(e) => setQuoteForm({ ...quoteForm, quality_rating: Number(e.target.value) })} /></div>
                <div><label className="text-sm font-medium">Warranty</label><input className="input mt-1" placeholder="Warranty details" value={quoteForm.warranty ?? ''} onChange={(e) => setQuoteForm({ ...quoteForm, warranty: e.target.value })} /></div>
                <div className="flex justify-end gap-2">
                  <button className="btn-secondary" onClick={() => setShowQuoteForm(false)}>
                    Cancel
                  </button>
                  <button className="btn-primary" onClick={addQuote}>
                    Save
                  </button>
                </div>
              </div>
            </Modal>
          )}
        </Modal>
      )}
    </div>
  );
}
