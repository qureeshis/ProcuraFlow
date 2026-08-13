import React, { useEffect, useState } from 'react';
import client from '../../api/client';
import DataTable from '../../components/DataTable';
import { formatCurrency } from '../../utils/currency';

const CLASS_COLORS: Record<string, string> = {
  A: 'bg-rose-100 text-rose-700',
  B: 'bg-amber-100 text-amber-700',
  C: 'bg-emerald-100 text-emerald-700',
};

export default function ABCPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client
      .get('/inventory/abc-classification')
      .then((res) => setRows(res.data))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">ABC Inventory Classification</h1>
      <p className="text-sm text-slate-500 mb-4">
        A = high-value items (top 80% of cumulative value), B = medium-value (next 15%), C = low-value / high quantity (remaining 5%).
      </p>
      <div className="card">
        <DataTable
          loading={loading}
          columns={[
            { key: 'item_code', label: 'Item Code' },
            { key: 'description', label: 'Description' },
            { key: 'value', label: 'Inventory Value', render: (r) => formatCurrency(r.value) },
            { key: 'cumulative_pct', label: 'Cumulative %', render: (r) => `${r.cumulative_pct}%` },
            {
              key: 'classification',
              label: 'Class',
              render: (r) => (
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${CLASS_COLORS[r.classification]}`}>{r.classification}</span>
              ),
            },
          ]}
          rows={rows}
        />
      </div>
    </div>
  );
}
