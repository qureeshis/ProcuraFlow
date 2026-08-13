import React, { useEffect, useState } from 'react';
import client from '../../api/client';
import DataTable from '../../components/DataTable';

const ALERT_COLORS: Record<string, string> = {
  Expired: 'bg-rose-100 text-rose-700',
  '30-day': 'bg-amber-100 text-amber-700',
  '60-day': 'bg-yellow-100 text-yellow-700',
};

export default function ExpiryPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client
      .get('/inventory/expiry')
      .then((res) => setRows(res.data))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Expiry Tracking</h1>
      <p className="text-sm text-slate-500 mb-4">Batches with expiry dates, with 30-day / 60-day / expired alerts.</p>
      <div className="card">
        <DataTable
          loading={loading}
          columns={[
            { key: 'item_code', label: 'Item Code' },
            { key: 'description', label: 'Description' },
            { key: 'batch', label: 'Batch' },
            { key: 'expiry_date', label: 'Expiry Date' },
            { key: 'quantity_remaining', label: 'Qty Remaining' },
            { key: 'days_remaining', label: 'Days Remaining' },
            {
              key: 'alert',
              label: 'Alert',
              render: (r) =>
                r.alert ? (
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ALERT_COLORS[r.alert]}`}>{r.alert}</span>
                ) : (
                  '—'
                ),
            },
          ]}
          rows={rows}
        />
      </div>
    </div>
  );
}
