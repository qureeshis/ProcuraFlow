import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import client from '../../api/client';
import DataTable from '../../components/DataTable';
export default function StockPage() {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        client
            .get('/inventory/stock')
            .then((res) => setRows(res.data))
            .finally(() => setLoading(false));
    }, []);
    return (_jsxs("div", { children: [_jsx("h1", { className: "text-xl font-semibold text-slate-900 mb-1", children: "Real-Time Inventory" }), _jsx("p", { className: "text-sm text-slate-500 mb-4", children: "Live on-hand quantity by item, warehouse, and location." }), _jsx("div", { className: "card", children: _jsx(DataTable, { loading: loading, columns: [
                        { key: 'item_code', label: 'Item Code' },
                        { key: 'description', label: 'Description' },
                        { key: 'warehouse_name', label: 'Warehouse' },
                        { key: 'location_code', label: 'Location' },
                        { key: 'location_label', label: 'Location Description' },
                        { key: 'quantity', label: 'Quantity' },
                        { key: 'available_quantity', label: 'Available Qty' },
                        { key: 'uom', label: 'UOM' },
                    ], rows: rows }) })] }));
}
