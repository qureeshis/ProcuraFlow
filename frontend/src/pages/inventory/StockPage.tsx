import React, { useEffect, useState } from 'react';
import client from '../../api/client';
import DataTable from '../../components/DataTable';

export default function StockPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client
      .get('/inventory/stock')
      .then((res) => setRows(res.data))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Real-Time Inventory</h1>
      <p className="text-sm text-slate-500 mb-4">Live on-hand quantity by item, warehouse, and location.</p>
      <div className="card">
        <DataTable
          loading={loading}
          columns={[
            { key: 'item_code', label: 'Item Code' },
            { key: 'description', label: 'Description' },
            { key: 'warehouse_name', label: 'Warehouse' },
            { key: 'quantity', label: 'Quantity' },
            { key: 'uom', label: 'UOM' },
          ]}
          rows={rows}
        />
      </div>
    </div>
  );
}
