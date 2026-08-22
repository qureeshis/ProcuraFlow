import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import client from '../../api/client';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import { useAuth } from '../../contexts/AuthContext';
import SearchSelect from '../../components/SearchSelect';
import ProfessionalWarehouseTransfer from '../../components/ProfessionalWarehouseTransfer';
import { useBranding } from '../../contexts/BrandingContext';
import { downloadElementPdf } from '../../utils/downloadPdf';
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
export default function TransfersPage() {
    const { user } = useAuth();
    const { company } = useBranding();
    const [transfers, setTransfers] = useState([]);
    const [items, setItems] = useState([]);
    const [warehouses, setWarehouses] = useState([]);
    const [locations, setLocations] = useState([]);
    const [stock, setStock] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({});
    const [error, setError] = useState('');
    const [transportModes, setTransportModes] = useState([]);
    const [transportModesText, setTransportModesText] = useState('');
    const [settingsSaved, setSettingsSaved] = useState(false);
    const [receiving, setReceiving] = useState(null);
    const [receipt, setReceipt] = useState({});
    const [documentView, setDocumentView] = useState(null);
    function load() {
        client.get('/warehouse/transfers').then((res) => setTransfers(res.data));
    }
    useEffect(() => {
        load();
        client.get('/masters/operational-items').then((res) => setItems(res.data.filter((i) => i.active_yn !== 0)));
        client.get('/masters/warehouses').then((res) => setWarehouses(res.data));
        client.get('/masters/locations').then((res) => setLocations(res.data));
        client.get('/inventory/stock').then((res) => setStock(res.data));
        client.get('/settings').then((res) => { const configured = String(res.data.global_transport_modes || 'Company Vehicle, Courier, Third-Party Truck, Employee Hand Carry, Internal Forklift'); setTransportModesText(configured); setTransportModes(configured.split(',').map((v) => v.trim()).filter(Boolean)); });
    }, []);
    async function submit() {
        setError('');
        if (!form.item_id || !form.from_warehouse_id || !form.from_location_id || !form.to_warehouse_id || !form.to_location_id || !(form.quantity > 0) || !form.transport_mode)
            return setError('Select an item, source Bin, destination Bin, transfer mode, and quantity greater than zero.');
        if (form.from_warehouse_id === form.to_warehouse_id)
            return setError('Source and destination warehouses must be different.');
        try {
            await client.post('/warehouse/transfers', form);
            setShowForm(false);
            setForm({});
            load();
        }
        catch (e) {
            setError(e?.response?.data?.error || 'Failed to record transfer');
        }
    }
    async function receive() { if (!receipt.to_location_id)
        return setError('Select the physical Bin where the transferred stock was received.'); try {
        await client.put(`/warehouse/transfers/${receiving.id}/receive`, receipt);
        setReceiving(null);
        setReceipt({});
        setError('');
        load();
    }
    catch (e) {
        setError(e?.response?.data?.error || 'Unable to receive transfer');
    } }
    async function saveTransportModes() { await client.put('/settings/global_transport_modes', { value: transportModesText }); setTransportModes(transportModesText.split(',').map((v) => v.trim()).filter(Boolean)); setSettingsSaved(true); setTimeout(() => setSettingsSaved(false), 2000); }
    return (_jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-xl font-semibold text-slate-900", children: "Warehouse Transfers" }), _jsx("p", { className: "text-sm text-slate-500", children: "Move inventory between warehouses, locations, or bins." })] }), _jsx("button", { className: "btn-primary", onClick: () => setShowForm(true), children: "+ New Transfer" })] }), user && ['SupplyChainManager', 'WarehouseManager'].includes(user.role) && _jsxs("div", { className: "card p-4 mb-4", children: [_jsx("h2", { className: "font-semibold text-indigo-900", children: "Transfer Configuration" }), _jsx("p", { className: "text-xs text-slate-500 mt-1", children: "Comma-separated transport modes available when recording stock transfers." }), _jsx("label", { className: "block text-sm font-medium mt-3 mb-1", children: "Available Transfer Modes" }), _jsxs("div", { className: "flex gap-2", children: [_jsx("input", { className: "input", value: transportModesText, onChange: (e) => setTransportModesText(e.target.value) }), _jsx("button", { className: "btn-secondary shrink-0", onClick: saveTransportModes, children: "Save Modes" })] }), settingsSaved && _jsx("div", { className: "text-xs text-emerald-600 mt-2", children: "Transfer modes saved." })] }), _jsx("div", { className: "card", children: _jsx(DataTable, { columns: [
                        { key: 'transfer_number', label: 'Transfer Number' },
                        { key: 'item_code', label: 'Item' },
                        { key: 'quantity', label: 'Quantity' },
                        { key: 'from_warehouse_name', label: 'From Warehouse' },
                        { key: 'from_location_code', label: 'From Bin' },
                        { key: 'to_warehouse_name', label: 'To Warehouse' },
                        { key: 'to_location_code', label: 'To Bin' },
                        { key: 'transfer_date', label: 'Date' },
                        { key: 'transport_mode', label: 'Mode' },
                        { key: 'tracking_reference', label: 'Tracking Ref.' },
                        { key: 'status', label: 'Receipt Status' },
                        { key: 'receipt_number', label: 'Transfer Receipt' },
                    ], rows: transfers, actions: (row) => _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsx("button", { className: "text-indigo-700 text-xs font-semibold", onClick: () => setDocumentView({ transfer: row, mode: 'dispatch' }), children: "Transit Note" }), row.status === 'Received' && _jsx("button", { className: "text-emerald-700 text-xs font-semibold", onClick: () => setDocumentView({ transfer: row, mode: 'receipt' }), children: "Receipt Confirmation" }), row.status === 'In Transit' && user?.warehouse_ids?.map(Number).includes(Number(row.to_warehouse_id)) && _jsx("button", { className: "text-emerald-700 text-xs font-semibold", onClick: () => { setReceiving(row); setReceipt({ to_location_id: row.to_location_id, receiving_reference: `TRR-${row.transfer_number}` }); setError(''); }, children: "Create Receipt" })] }) }) }), receiving && _jsx(Modal, { title: "Receive Warehouse Transfer", onClose: () => setReceiving(null), children: _jsxs("div", { className: "compact-form", children: [_jsxs("div", { className: "rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900", children: [_jsx("strong", { children: receiving.transfer_number }), " \u00B7 ", receiving.item_code, " \u00B7 Quantity ", receiving.quantity, _jsx("br", {}), "Receiving warehouse: ", receiving.to_warehouse_name] }), _jsx(SearchSelect, { label: "Receiving Physical Bin", options: locations.filter(l => l.type === 'Bin' && Number(l.warehouse_id) === Number(receiving.to_warehouse_id)).map(l => ({ value: l.id, label: `${l.code}${l.label ? ` — ${l.label}` : ''}` })), value: receipt.to_location_id ?? '', onChange: v => setReceipt({ ...receipt, to_location_id: Number(v) }), placeholder: "Search receiving Bin" }), _jsxs("div", { children: [_jsx("label", { className: "text-sm font-medium", children: "Transfer Receipt Number" }), _jsx("input", { className: "input mt-1", value: receipt.receiving_reference ?? '', onChange: e => setReceipt({ ...receipt, receiving_reference: e.target.value }) })] }), _jsxs("div", { children: [_jsx("label", { className: "text-sm font-medium", children: "Receiving Note" }), _jsx("textarea", { className: "input mt-1", value: receipt.receiving_note ?? '', onChange: e => setReceipt({ ...receipt, receiving_note: e.target.value }) })] }), error && _jsx("div", { className: "text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2", children: error }), _jsxs("div", { className: "flex justify-end gap-2", children: [_jsx("button", { className: "btn-secondary", onClick: () => setReceiving(null), children: "Cancel" }), _jsx("button", { className: "btn-primary", onClick: receive, children: "Post Transfer Receipt" })] })] }) }), documentView && _jsx(Modal, { wide: true, title: documentView.mode === 'dispatch' ? `Transfer Dispatch Note — ${documentView.transfer.transfer_number}` : `Receiving Confirmation — ${documentView.transfer.receipt_number}`, onClose: () => setDocumentView(null), children: _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex justify-end gap-2 print:hidden", children: [_jsx("button", { className: "btn-secondary", onClick: () => downloadElementPdf(documentView.mode === 'dispatch' ? 'transfer-dispatch-print-document' : 'transfer-receipt-print-document', documentView.mode === 'dispatch' ? `${documentView.transfer.transfer_number}-transit-note` : `${documentView.transfer.receipt_number}-receiving-confirmation`), children: "Download PDF" }), _jsx("button", { className: "btn-primary", onClick: () => window.print(), children: "Print" })] }), _jsx(ProfessionalWarehouseTransfer, { transfer: documentView.transfer, company: company, mode: documentView.mode })] }) }), showForm && (_jsx(Modal, { title: "New Transfer", onClose: () => setShowForm(false), children: _jsxs("div", { className: "compact-form", children: [_jsx("div", { children: _jsx(SearchSelect, { label: "Item", options: items.map((it) => ({ value: it.id, label: `${it.item_code} - ${it.description}` })), value: form.item_id ?? '', onChange: (val) => setForm({ ...form, item_id: Number(val) }), placeholder: "Search item" }) }), _jsxs("div", { className: "grid grid-cols-2 gap-3", children: [_jsx(SearchSelect, { label: "From Warehouse", options: warehouses.map((w) => ({ value: w.id, label: w.name })), value: form.from_warehouse_id ?? '', onChange: (val) => setForm({ ...form, from_warehouse_id: Number(val), from_location_id: null }), placeholder: "Search warehouse" }), _jsx(SearchSelect, { label: "To Warehouse", options: warehouses.map((w) => ({ value: w.id, label: w.name })), value: form.to_warehouse_id ?? '', onChange: (val) => setForm({ ...form, to_warehouse_id: Number(val), to_location_id: null }), placeholder: "Search warehouse" })] }), _jsxs("div", { className: "grid grid-cols-2 gap-3", children: [_jsxs("div", { children: [_jsx("label", { className: "text-sm font-medium", children: "Source Physical Bin" }), _jsxs("select", { className: "input mt-1", value: form.from_location_id || '', onChange: e => setForm({ ...form, from_location_id: Number(e.target.value) }), children: [_jsx("option", { value: "", children: "Select stocked Bin..." }), stock.filter(s => s.item_id === form.item_id && s.warehouse_id === form.from_warehouse_id && s.location_id && Number(s.quantity) > 0).map(s => _jsxs("option", { value: s.location_id, children: [s.location_code, " \u2014 Available ", s.quantity] }, s.id))] })] }), _jsxs("div", { children: [_jsx("label", { className: "text-sm font-medium", children: "Destination Physical Bin" }), _jsxs("select", { className: "input mt-1", value: form.to_location_id || '', onChange: e => setForm({ ...form, to_location_id: Number(e.target.value) }), children: [_jsx("option", { value: "", children: "Select Bin..." }), locations.filter(l => l.type === 'Bin' && l.warehouse_id === form.to_warehouse_id).map(l => _jsxs("option", { value: l.id, children: [l.code, l.label ? ` — ${l.label}` : ''] }, l.id))] })] })] }), _jsxs("div", { className: "grid grid-cols-2 gap-3", children: [_jsxs("div", { children: [_jsx("label", { className: "text-sm font-medium text-slate-700", children: "Mode of Transfer" }), _jsxs("select", { className: "input mt-1", value: form.transport_mode ?? '', onChange: (e) => setForm({ ...form, transport_mode: e.target.value }), children: [_jsx("option", { value: "", children: "Select..." }), transportModes.map((mode) => _jsx("option", { value: mode, children: mode }, mode))] })] }), _jsxs("div", { children: [_jsx("label", { className: "text-sm font-medium text-slate-700", children: "Vehicle Reference" }), _jsx("input", { className: "input mt-1", value: form.vehicle_reference ?? '', onChange: (e) => setForm({ ...form, vehicle_reference: e.target.value }) })] }), _jsxs("div", { children: [_jsx("label", { className: "text-sm font-medium text-slate-700", children: "Driver / Custodian" }), _jsx("input", { className: "input mt-1", value: form.driver_name ?? '', onChange: (e) => setForm({ ...form, driver_name: e.target.value }) })] }), _jsxs("div", { children: [_jsx("label", { className: "text-sm font-medium text-slate-700", children: "Tracking Reference" }), _jsx("input", { className: "input mt-1", value: form.tracking_reference ?? '', onChange: (e) => setForm({ ...form, tracking_reference: e.target.value }) })] })] }), _jsxs("div", { children: [_jsx("label", { className: "text-sm font-medium text-slate-700", children: "Remarks" }), _jsx("textarea", { className: "input mt-1", value: form.remarks ?? '', onChange: (e) => setForm({ ...form, remarks: e.target.value }) })] }), _jsxs("div", { children: [_jsx("label", { className: "text-sm font-medium text-slate-700", children: "Quantity" }), _jsx("input", { className: "input mt-1", type: "number", value: form.quantity ?? '', onChange: (e) => setForm({ ...form, quantity: Number(e.target.value) }) })] }), error && _jsx("div", { className: "text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2", children: error }), _jsxs("div", { className: "flex justify-end gap-2 pt-2", children: [_jsx("button", { className: "btn-secondary", onClick: () => setShowForm(false), children: "Cancel" }), _jsx("button", { className: "btn-primary", onClick: submit, children: "Save" })] })] }) }))] }));
}
