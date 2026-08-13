import React, { useEffect, useState } from 'react';
import client from '../../api/client';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import { formatCurrency } from '../../utils/currency';

export default function ValuationPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [layers, setLayers] = useState<any | null>(null);
  const [layerItem, setLayerItem] = useState<any | null>(null);

  useEffect(() => {
    client
      .get('/inventory/valuation')
      .then((res) => setRows(res.data))
      .finally(() => setLoading(false));
  }, []);

  function openLayers(row: any) {
    setLayerItem(row);
    client.get(`/inventory/valuation/${row.item_id}/layers`).then((res) => setLayers(res.data));
  }

  const totalValue = rows.reduce((s, r) => s + r.value, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">FIFO Inventory Valuation</h1>
          <p className="text-sm text-slate-500">First-In-First-Out cost layers determine on-hand inventory value.</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500 uppercase">Total Inventory Value</div>
          <div className="text-xl font-bold text-slate-900">{formatCurrency(totalValue)}</div>
        </div>
      </div>
      <div className="card mt-4">
        <DataTable
          loading={loading}
          columns={[
            { key: 'item_code', label: 'Item Code' },
            { key: 'description', label: 'Description' },
            { key: 'quantity', label: 'On Hand Qty' },
            { key: 'avg_unit_cost', label: 'Avg Unit Cost', render: (r) => formatCurrency(r.avg_unit_cost) },
            { key: 'value', label: 'Total Value', render: (r) => formatCurrency(r.value) },
          ]}
          rows={rows}
          onRowClick={openLayers}
        />
      </div>

      {layerItem && layers && (
        <Modal title={`FIFO Cost Layers — ${layerItem.item_code}`} onClose={() => setLayerItem(null)} wide>
          <div className="mb-3 text-sm text-slate-600">
            Total: {layers.totalQty} units, {formatCurrency(layers.totalValue)}
          </div>
          <DataTable
            columns={[
              { key: 'received_date', label: 'Received Date' },
              { key: 'batch', label: 'Batch' },
              { key: 'quantity_remaining', label: 'Qty Remaining' },
              { key: 'unit_cost', label: 'Unit Cost', render: (r) => formatCurrency(r.unit_cost) },
              { key: 'layer_value', label: 'Layer Value', render: (r) => formatCurrency(r.quantity_remaining * r.unit_cost) },
            ]}
            rows={layers.layers}
          />
        </Modal>
      )}
    </div>
  );
}
