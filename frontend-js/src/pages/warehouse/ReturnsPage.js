import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import client from '../../api/client';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import SearchSelect from '../../components/SearchSelect';
function LegacySearchSelect({ label, options, value, onChange, placeholder, }) {
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    useEffect(() => {
        const selected = options.find((opt) => String(opt.value) === String(value))?.label || String(value || '');
        setQuery(selected);
    }, [value, options]);
    const filtered = options.filter((opt) => `${opt.label}`.toLowerCase().includes(query.toLowerCase()));
    return (_jsxs("div", { className: "relative", children: [_jsx("label", { className: "text-sm font-medium text-slate-700", children: label }), _jsx("input", { className: "input mt-1 w-full", placeholder: placeholder, value: query, onChange: (e) => {
                    setQuery(e.target.value);
                    setOpen(true);
                }, onFocus: () => setOpen(true), onBlur: () => setTimeout(() => setOpen(false), 120) }), open && filtered.length > 0 && (_jsx("div", { className: "absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg", children: filtered.map((opt) => (_jsx("button", { type: "button", className: "block w-full px-3 py-2 text-left text-sm hover:bg-slate-50", onMouseDown: () => {
                        setQuery(opt.label);
                        onChange(opt.value);
                        setOpen(false);
                    }, children: opt.label }, opt.value))) }))] }));
}
export default function ReturnsPage() {
    const [returns, setReturns] = useState([]);
    const [items, setItems] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [warehouses, setWarehouses] = useState([]);
    const [locations, setLocations] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({});
    const [error, setError] = useState('');
    function load() {
        client.get('/warehouse/returns').then((res) => setReturns(res.data));
    }
    useEffect(() => {
        load();
        client.get('/masters/operational-items').then((res) => setItems(res.data.filter((i) => i.consumable_returnable === 'Returnable')));
        client.get('/masters/employee-directory').then((res) => setEmployees(res.data));
        client.get('/masters/warehouses').then((res) => setWarehouses(res.data));
        client.get('/masters/locations').then((res) => setLocations(res.data));
    }, []);
    async function submit() {
        setError('');
        if (!form.item_id || !form.warehouse_id || !form.location_id || !(form.quantity > 0) || !form.condition)
            return setError('Select an item, warehouse, destination Bin, condition, and quantity greater than zero.');
        try {
            await client.post('/warehouse/returns', form);
            setShowForm(false);
            setForm({});
            load();
        }
        catch (e) {
            setError(e?.response?.data?.error || 'Failed to record return');
        }
    }
    return (_jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-xl font-semibold text-slate-900", children: "Returns" }), _jsx("p", { className: "text-sm text-slate-500", children: "Returnable items only \u2014 tools, equipment, reusable materials. Consumables don't require return." })] }), _jsx("button", { className: "btn-primary", onClick: () => setShowForm(true), children: "+ New Return" })] }), _jsx("div", { className: "card", children: _jsx(DataTable, { columns: [
                        { key: 'return_number', label: 'Return Number' },
                        { key: 'item_code', label: 'Item' },
                        { key: 'employee_name', label: 'Employee' },
                        { key: 'quantity', label: 'Quantity' },
                        { key: 'condition', label: 'Condition' },
                        { key: 'location_code', label: 'Stored Bin' },
                        { key: 'return_date', label: 'Date' },
                    ], rows: returns }) }), showForm && (_jsx(Modal, { title: "New Return", onClose: () => setShowForm(false), children: _jsxs("div", { className: "compact-form", children: [_jsx("div", { children: _jsx(SearchSelect, { label: "Item (Returnable only)", options: items.map((it) => ({ value: it.id, label: `${it.item_code} - ${it.description}` })), value: form.item_id ?? '', onChange: (val) => setForm({ ...form, item_id: Number(val) }), placeholder: "Search item" }) }), _jsx("div", { children: _jsx(SearchSelect, { label: "Employee", options: employees.map((e) => ({ value: e.id, label: e.name })), value: form.employee_id ?? '', onChange: (val) => setForm({ ...form, employee_id: Number(val) }), placeholder: "Search employee" }) }), _jsx("div", { children: _jsx(SearchSelect, { label: "Return to Warehouse", options: warehouses.map((w) => ({ value: w.id, label: w.name })), value: form.warehouse_id ?? '', onChange: (val) => setForm({ ...form, warehouse_id: Number(val) }), placeholder: "Search warehouse" }) }), _jsxs("div", { children: [_jsx("label", { className: "text-sm font-medium text-slate-700", children: "Destination Storage Bin" }), _jsxs("select", { className: "input mt-1", value: form.location_id || '', onChange: e => setForm({ ...form, location_id: Number(e.target.value) }), children: [_jsx("option", { value: "", children: "Select Bin..." }), locations.filter(l => l.type === 'Bin' && Number(l.warehouse_id) === Number(form.warehouse_id)).map(l => _jsxs("option", { value: l.id, children: [l.code, l.label ? ` — ${l.label}` : ''] }, l.id))] })] }), _jsxs("div", { children: [_jsx("label", { className: "text-sm font-medium text-slate-700", children: "Quantity" }), _jsx("input", { className: "input mt-1", type: "number", value: form.quantity ?? '', onChange: (e) => setForm({ ...form, quantity: Number(e.target.value) }) })] }), _jsxs("div", { children: [_jsx("label", { className: "text-sm font-medium text-slate-700", children: "Condition" }), _jsxs("select", { className: "input mt-1", value: form.condition ?? '', onChange: (e) => setForm({ ...form, condition: e.target.value }), children: [_jsx("option", { value: "", children: "Select..." }), _jsx("option", { value: "Good", children: "Good" }), _jsx("option", { value: "Damaged", children: "Damaged" }), _jsx("option", { value: "Needs Repair", children: "Needs Repair" })] })] }), error && _jsx("div", { className: "text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2", children: error }), _jsxs("div", { className: "flex justify-end gap-2 pt-2", children: [_jsx("button", { className: "btn-secondary", onClick: () => setShowForm(false), children: "Cancel" }), _jsx("button", { className: "btn-primary", onClick: submit, children: "Save" })] })] }) }))] }));
}
