import React, { useEffect, useState } from 'react';
import client from '../../api/client';
import DataTable from '../../components/DataTable';

export default function DeadStockPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client
      .get('/inventory/dead-stock')
      .then((res) => setRows(res.data))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Dead Stock Analysis</h1>
      <p className="text-sm text-slate-500 mb-4">Items with no movement (GRN, issue, or transfer) for 90+, 180+, or 365+ days.</p>
      <div className="card">
        <DataTable
          loading={loading}
          emptyLabel="No dead stock detected"
          columns={[
            { key: 'item_code', label: 'Item Code' },
            { key: 'description', label: 'Description' },
            { key: 'quantity', label: 'On Hand Qty' },
            { key: 'last_movement', label: 'Last Movement', render: (r) => r.last_movement || 'Never' },
            { key: 'days_since_movement', label: 'Days Idle', render: (r) => r.days_since_movement ?? '—' },
            { key: 'bucket', label: 'Bucket' },
          ]}
          rows={rows}
        />
      </div>
    </div>
  );
}
