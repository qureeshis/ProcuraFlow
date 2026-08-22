import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import client from '../../api/client';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import StatusBadge from '../../components/StatusBadge';
import { useAuth } from '../../contexts/AuthContext';
import { formatCurrency } from '../../utils/currency';
import DocumentAttachments from '../../components/DocumentAttachments';
import ProfessionalPurchaseOrder from '../../components/ProfessionalPurchaseOrder';
import ManagementApprovalRequest from '../../components/ManagementApprovalRequest';
import { useSearchParams } from 'react-router-dom';
import { COMPANY_COPY, MANAGEMENT_COPY, PO_VENDOR_COPY, printControlledCopies } from '../../utils/printCopies';
import { downloadElementPdf } from '../../utils/downloadPdf';
function normalizePoDocument(data) {
    if (data?.po?.po_number)
        return data;
    if (data?.po_number) {
        const { items = [], company = {}, approvals = [], ...po } = data;
        return { po, items, company, approvals };
    }
    throw new Error('Purchase order document data is incomplete');
}
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
export default function POPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const { user } = useAuth();
    const [pos, setPos] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [items, setItems] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [supplierId, setSupplierId] = useState('');
    const [lines, setLines] = useState([{ item_id: '', quantity: 1, price: 0, tax: 0 }]);
    const [error, setError] = useState('');
    const [committedDeliveryDate, setCommittedDeliveryDate] = useState('');
    const [approving, setApproving] = useState(null);
    const [approvalRef, setApprovalRef] = useState('');
    const [approvalPerson, setApprovalPerson] = useState('');
    const [history, setHistory] = useState([]);
    const [doc, setDoc] = useState(null);
    const [editingId, setEditingId] = useState(null);
    const [openPrs, setOpenPrs] = useState([]);
    const [selectedPrIds, setSelectedPrIds] = useState([]);
    const prLoadSequence = useRef(0);
    function load() {
        client.get('/procurement/pos').then((res) => setPos(res.data));
        client.get('/procurement/prs').then((res) => setOpenPrs(res.data.filter((pr) => pr.status === 'Submitted' && pr.approval_decision === 'Approved')));
    }
    useEffect(() => {
        load();
        client.get('/masters/suppliers').then((res) => setSuppliers(res.data));
        client.get('/masters/items').then((res) => setItems(res.data.filter((i) => i.active_yn !== 0)));
    }, []);
    useEffect(() => {
        const openId = Number(searchParams.get('open'));
        const target = openId ? pos.find((row) => row.id === openId) : null;
        if (!target)
            return;
        setSearchParams({}, { replace: true });
        openApproval(target);
    }, [pos, searchParams, setSearchParams]);
    const pricingItemKey = Array.from(new Set(lines.map((line) => Number(line.item_id)).filter(Number.isInteger))).sort((a, b) => a - b).join(',');
    useEffect(() => {
        if (!supplierId || !pricingItemKey)
            return;
        let cancelled = false;
        client.post('/procurement/pos/pricing', { supplier_id: supplierId, item_ids: pricingItemKey.split(',').map(Number) }).then((response) => {
            if (cancelled)
                return;
            const pricing = new Map(response.data.map((row) => [Number(row.item_id), row]));
            setLines((current) => current.map((line) => {
                const history = pricing.get(Number(line.item_id));
                if (!history)
                    return line;
                return {
                    ...line,
                    price: history.latest_supplier_price != null ? Number(history.latest_supplier_price) : line.price,
                    tax: history.latest_supplier_tax != null ? Number(history.latest_supplier_tax) : line.tax,
                    latest_supplier_po_number: history.latest_supplier_po_number,
                    supplier_lowest_price: history.supplier_lowest_price,
                    all_supplier_average_price: history.all_supplier_average_price,
                    received_history_count: Number(history.received_history_count || 0),
                };
            }));
        }).catch((e) => { if (!cancelled)
            setError(e?.response?.data?.error || 'Unable to load supplier price history'); });
        return () => { cancelled = true; };
    }, [supplierId, pricingItemKey]);
    function addLine() {
        setLines((current) => [...current, { item_id: '', item_search: '', quantity: 1, price: 0, tax: 0 }]);
    }
    function removeLine(index) {
        setLines((current) => current.length === 1 ? current : current.filter((_, lineIndex) => lineIndex !== index));
    }
    function updateLine(i, key, val) {
        setLines((current) => current.map((line, index) => index === i ? { ...line, [key]: val } : line));
    }
    const estimatedTotal = lines.reduce((s, l) => s + (l.quantity || 0) * (l.price || 0) * (1 + (l.tax || 0) / 100), 0);
    async function submit() {
        setError('');
        if (!supplierId)
            return setError('Select a vendor before submitting the purchase order.');
        if (!committedDeliveryDate)
            return setError('Committed delivery date is required.');
        if (!editingId && committedDeliveryDate < new Date().toISOString().slice(0, 10))
            return setError('Committed delivery date cannot be earlier than today.');
        if (!lines.length || lines.some((line) => !Number.isInteger(Number(line.item_id)) || !(Number(line.quantity) > 0) || Number(line.price) < 0 || Number(line.tax || 0) < 0))
            return setError('Select a valid item and enter a positive quantity and non-negative price/tax for every PO line.');
        const overPrBalance = lines.find((line) => line.pr_available_quantity != null && Number(line.quantity) > Number(line.pr_available_quantity) + 0.0001);
        if (overPrBalance)
            return setError(`${overPrBalance.item_search || 'PO item'} quantity cannot exceed the approved outstanding PR balance of ${Number(overPrBalance.pr_available_quantity).toLocaleString()}.`);
        try {
            if (editingId)
                await client.put(`/procurement/pos/${editingId}`, { supplier_id: supplierId, committed_delivery_date: committedDeliveryDate, items: lines });
            else
                await client.post('/procurement/pos', { supplier_id: supplierId, committed_delivery_date: committedDeliveryDate, pr_ids: selectedPrIds, items: lines });
            setShowForm(false);
            setLines([{ item_id: '', item_search: '', quantity: 1, price: 0, tax: 0 }]);
            setSupplierId('');
            setCommittedDeliveryDate('');
            setEditingId(null);
            setSelectedPrIds([]);
            load();
        }
        catch (e) {
            setError(e?.response?.data?.error || 'Failed to create PO');
        }
    }
    async function approve() {
        if (approving.external_approval_required && (!approvalRef.trim() || !approvalPerson.trim())) {
            alert('Enter the external approval reference and approving management person after uploading the signed approval document.');
            return;
        }
        try {
            await client.put(`/procurement/pos/${approving.id}/approve`, {
                approval_ref_number: approvalRef,
                approval_person_name: approvalPerson,
            });
            setApproving(null);
            setApprovalRef('');
            setApprovalPerson('');
            load();
        }
        catch (e) {
            alert(e?.response?.data?.error || 'Approval failed');
        }
    }
    async function reject(id) {
        await client.put(`/procurement/pos/${id}/reject`);
        load();
    }
    async function loadPrForPo(prIds = selectedPrIds) {
        const sequence = ++prLoadSequence.current;
        if (!prIds.length) {
            setLines([{ item_id: '', item_search: '', quantity: 1, price: 0, tax: 0 }]);
            setError('');
            return;
        }
        try {
            const requisitions = await Promise.all(prIds.map((id) => client.get(`/procurement/prs/${id}`).then((response) => response.data)));
            if (sequence !== prLoadSequence.current)
                return;
            const consolidated = new Map();
            requisitions.forEach((pr) => pr.items.forEach((line) => {
                const masterItem = items.find((candidate) => candidate.id === line.item_id);
                const existing = consolidated.get(line.item_id);
                if (existing) {
                    existing.quantity += Number(line.remaining_quantity ?? line.quantity);
                    existing.pr_available_quantity += Number(line.remaining_quantity ?? line.quantity);
                }
                else
                    consolidated.set(line.item_id, {
                        item_id: line.item_id,
                        item_search: `${line.item_code} - ${line.description}`,
                        quantity: Number(line.remaining_quantity ?? line.quantity),
                        pr_available_quantity: Number(line.remaining_quantity ?? line.quantity),
                        price: Number(masterItem?.last_purchase_price ?? masterItem?.standard_cost ?? 0),
                        tax: 0,
                    });
            }));
            setLines(Array.from(consolidated.values()).filter((line) => line.quantity > 0));
            const requestedDates = requisitions.flatMap((pr) => pr.items.map((line) => line.required_date).filter(Boolean)).sort();
            if (requestedDates.length && !committedDeliveryDate)
                setCommittedDeliveryDate(requestedDates[requestedDates.length - 1]);
            setError('');
        }
        catch (e) {
            if (sequence === prLoadSequence.current)
                setError(e?.response?.data?.error || 'Unable to consolidate the selected PRs');
        }
    }
    function togglePurchaseRequisition(prId) {
        const next = selectedPrIds.includes(prId) ? selectedPrIds.filter((id) => id !== prId) : [...selectedPrIds, prId];
        setSelectedPrIds(next);
        loadPrForPo(next);
    }
    async function openDoc(id) {
        try {
            const res = await client.get(`/procurement/pos/${id}/document`);
            setDoc(normalizePoDocument(res.data));
            load();
        }
        catch (e) {
            alert(e?.response?.data?.error || 'Cannot view this PO');
        }
    }
    async function printDoc(id) {
        try {
            await client.post(`/procurement/pos/${id}/print`);
            await openDoc(id);
        }
        catch (e) {
            alert(e?.response?.data?.error || 'Cannot print this PO');
        }
    }
    async function openApproval(row) {
        try {
            const [detail, approvalHistory] = await Promise.all([
                client.get(`/procurement/pos/${row.id}/document`),
                client.get(`/procurement/pos/${row.id}/approval-history`),
            ]);
            setApproving({ ...row, document: normalizePoDocument(detail.data) });
            setHistory(approvalHistory.data);
        }
        catch (e) {
            alert(e?.response?.data?.error || 'Cannot open PO for approval');
        }
    }
    async function editPo(row) { try {
        const detail = (await client.get(`/procurement/pos/${row.id}`)).data;
        setEditingId(row.id);
        setSupplierId(detail.supplier_id);
        setCommittedDeliveryDate(detail.committed_delivery_date || '');
        setLines(detail.items);
        setShowForm(true);
    }
    catch (e) {
        setError(e?.response?.data?.error || 'Unable to edit PO');
    } }
    const canApprove = user && ['PurchaseOfficer', 'PurchaseManager', 'SupplyChainManager'].includes(user.role);
    const canEditPending = user && ['PurchaseOfficer', 'PurchaseManager', 'SupplyChainManager'].includes(user.role);
    return (_jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-xl font-semibold text-slate-900", children: "Purchase Orders" }), _jsx("p", { className: "text-sm text-slate-500", children: "Approval routing follows both value limits and upward hierarchy: Purchase Officer creators route to Purchase Manager, Purchase Manager creators route to Supply Chain Manager, and POs above the Supply Chain Manager limit require signed higher-management approval." })] }), _jsx("button", { className: "btn-primary", onClick: () => setShowForm(true), children: "+ New PO" })] }), _jsx("div", { className: "card", children: _jsx(DataTable, { columns: [
                        { key: 'po_number', label: 'PO Number' },
                        { key: 'pr_number', label: 'Source PR' },
                        { key: 'supplier_name', label: 'Supplier' },
                        { key: 'committed_delivery_date', label: 'Committed Delivery', render: (r) => _jsxs("div", { children: [_jsx("div", { children: r.committed_delivery_date || 'Not set' }), r.delivery_status === 'Overdue' && _jsxs("div", { className: "text-[10px] font-semibold text-rose-600", children: [r.days_overdue, " day", r.days_overdue === 1 ? '' : 's', " overdue"] })] }) },
                        { key: 'total_amount', label: 'Total', render: (r) => formatCurrency(r.total_amount) },
                        { key: 'status', label: 'Status', render: (r) => _jsx(StatusBadge, { status: r.status }) },
                    ], rows: pos, actions: (r) => (_jsxs("div", { className: "flex gap-2 justify-end", children: [r.status === 'PendingApproval' && r.external_approval_required ? (_jsx("button", { className: "rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100", onClick: () => openApproval(r), children: "Management Approval Request" })) : r.status === 'PendingApproval' && canApprove && (_jsxs(_Fragment, { children: [_jsx("button", { className: "text-emerald-600 text-xs font-medium", onClick: () => openApproval(r), children: "Approve" }), _jsx("button", { className: "text-rose-600 text-xs font-medium", onClick: () => reject(r.id), children: "Reject" })] })), r.status === 'PendingApproval' && canEditPending && _jsx("button", { className: "text-slate-600 text-xs font-medium", onClick: () => editPo(r), children: "Edit Qty / PO" }), r.status === 'PendingApproval' && r.external_approval_required && user?.role === 'SupplyChainManager' && _jsx("button", { className: "text-rose-600 text-xs font-medium", onClick: () => reject(r.id), children: "Reject" }), _jsx("button", { className: "text-slate-600 text-xs font-medium", onClick: () => openDoc(r.id), children: "View" }), r.status === 'Approved' && (_jsx("button", { className: "text-brand-600 text-xs font-medium", onClick: () => printDoc(r.id), children: "Print" }))] })) }) }), showForm && (_jsx(Modal, { title: editingId ? 'Edit Pending Purchase Order' : 'New Purchase Order', onClose: () => { setShowForm(false); setEditingId(null); }, wide: true, children: _jsxs("div", { className: "compact-form", children: [!editingId && _jsxs("div", { className: "rounded-lg border border-emerald-200 p-4 bg-emerald-50/60", children: [_jsx("h3", { className: "font-medium text-emerald-900 mb-1", children: "Approved PR Selection" }), _jsx("p", { className: "text-xs text-slate-600 mb-3", children: "Select one or more approved PRs. PO items, quantities, descriptions, UOMs, and available purchase prices fill immediately. Identical items are automatically consolidated." }), _jsx("label", { className: "block text-sm font-medium mb-2", children: "Approved PRs Awaiting PO" }), _jsx("div", { className: "max-h-40 overflow-y-auto rounded-lg border border-emerald-200 bg-white divide-y divide-slate-100", children: openPrs.length ? openPrs.map((pr) => _jsxs("label", { className: "flex cursor-pointer items-start gap-3 px-3 py-2 text-sm hover:bg-emerald-50", children: [_jsx("input", { type: "checkbox", className: "mt-1", checked: selectedPrIds.includes(pr.id), onChange: () => togglePurchaseRequisition(pr.id) }), _jsxs("span", { children: [_jsx("strong", { children: pr.pr_number }), _jsxs("span", { className: "block text-xs text-slate-500", children: [pr.department_name || 'No department', " \u00B7 ", pr.requestor_name || 'Unknown requestor'] })] })] }, pr.id)) : _jsx("div", { className: "px-3 py-4 text-sm text-slate-500", children: "No approved PRs awaiting PO creation are available." }) }), _jsx("div", { className: "mt-3 text-xs text-emerald-700", children: selectedPrIds.length ? `${selectedPrIds.length} PR${selectedPrIds.length === 1 ? '' : 's'} selected and automatically loaded. Source references will remain linked to the PO.` : 'Select a PR to fill the PO automatically.' })] }), _jsxs("div", { className: "form-section-tinted", children: [_jsx("h3", { className: "form-section-title", children: "Supplier and Delivery Details" }), _jsxs("div", { className: "grid gap-3 md:grid-cols-2", children: [_jsx(SearchSelect, { label: "Vendor", options: suppliers.map((s) => ({ value: s.id, label: s.name })), value: supplierId, onChange: (val) => setSupplierId(Number(val)), placeholder: "Search vendor" }), _jsxs("div", { children: [_jsx("label", { className: "text-sm font-medium text-slate-700", children: "Committed Delivery Date" }), _jsx("input", { className: "input mt-1", type: "date", min: editingId ? undefined : new Date().toISOString().slice(0, 10), value: committedDeliveryDate, onChange: (e) => setCommittedDeliveryDate(e.target.value) }), _jsx("p", { className: "mt-1 text-xs text-slate-500", children: "Locked after approval and used for overdue reporting." })] })] })] }), _jsxs("div", { className: "form-section", children: [_jsx("h3", { className: "form-section-title", children: "Purchase Lines" }), _jsx("div", { className: "space-y-2 mt-1", children: lines.map((line, i) => (_jsxs("div", { className: "form-line-card grid grid-cols-12 gap-2 items-start", children: [_jsx("div", { className: "col-span-12 lg:col-span-4", children: _jsx(SearchSelect, { label: "Item", options: items.map((it) => ({ value: it.id, label: `${it.item_code} - ${it.description}` })), value: line.item_id || line.item_search || '', onChange: (val) => {
                                                        const selected = items.find((it) => it.id === Number(val));
                                                        setLines((current) => current.map((currentLine, index) => index === i ? { ...currentLine, item_id: selected?.id || '', item_search: selected ? `${selected.item_code} - ${selected.description}` : '' } : currentLine));
                                                    }, placeholder: "Search item" }) }), (() => {
                                                const selectedItem = items.find((item) => item.id === line.item_id);
                                                const unit = selectedItem?.purchase_uom || selectedItem?.uom || 'Unit';
                                                const wholeNumber = ['EA', 'PCS', 'PC', 'BOX', 'BAG', 'SET', 'PR', 'PAIR', 'PACK', 'ROLL', 'BOTTLE', 'CAN', 'DRUM', 'PALLET'].includes(String(unit).toUpperCase());
                                                return _jsxs(_Fragment, { children: [_jsxs("div", { className: "col-span-2", children: [_jsxs("label", { className: "text-sm font-medium text-slate-700", children: ["Quantity (", unit, ")"] }), _jsx("input", { className: "input mt-1", type: "number", min: wholeNumber ? 1 : 0.001, max: line.pr_available_quantity != null ? Number(line.pr_available_quantity) : undefined, step: wholeNumber ? 1 : 0.001, placeholder: `Qty in ${unit}`, value: line.quantity, onChange: (e) => updateLine(i, 'quantity', Number(e.target.value)) }), line.pr_available_quantity != null && _jsxs("div", { className: "mt-1 text-[10px] font-medium text-emerald-700", children: ["Approved PR balance: ", Number(line.pr_available_quantity).toLocaleString(), " ", unit] })] }), _jsxs("div", { className: "col-span-3", children: [_jsxs("label", { className: "text-sm font-medium text-slate-700", children: ["Price / ", unit] }), _jsx("input", { className: "input mt-1", type: "number", min: "0", step: "0.01", placeholder: `Price per ${unit}`, value: line.price, onChange: (e) => updateLine(i, 'price', Number(e.target.value)) }), supplierId && line.item_id && _jsx("div", { className: "mt-1 text-[10px] leading-4 text-slate-500", children: line.latest_supplier_po_number ? _jsxs(_Fragment, { children: ["Auto-filled from ", line.latest_supplier_po_number, _jsx("br", {}), "Supplier lowest: ", _jsx("strong", { children: formatCurrency(line.supplier_lowest_price) }), " \u00B7 All-vendor average: ", _jsx("strong", { children: formatCurrency(line.all_supplier_average_price) })] }) : _jsxs(_Fragment, { children: ["No received closed-PO history for this supplier", line.received_history_count ? _jsxs(_Fragment, { children: [" \u00B7 All-vendor average: ", _jsx("strong", { children: formatCurrency(line.all_supplier_average_price) })] }) : ''] }) })] })] });
                                            })(), _jsxs("div", { className: "col-span-3", children: [_jsx("label", { className: "text-sm font-medium text-slate-700", children: "Tax %" }), _jsx("input", { className: "input mt-1", type: "number", min: "0", step: "0.01", placeholder: "Tax percentage", value: line.tax, onChange: (e) => updateLine(i, 'tax', Number(e.target.value)) })] }), _jsx("div", { className: "col-span-12 flex justify-end", children: lines.length > 1 && _jsx("button", { type: "button", className: "text-xs font-medium text-rose-600 hover:text-rose-800", onClick: () => removeLine(i), children: "Remove item line" }) })] }, i))) }), _jsx("button", { type: "button", className: "text-brand-600 text-sm font-medium mt-2", onClick: addLine, children: "+ Add line" })] }), _jsxs("div", { className: "text-right text-sm font-medium text-slate-700", children: ["Estimated Total: ", formatCurrency(estimatedTotal)] }), error && _jsx("div", { className: "text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2", children: error }), _jsxs("div", { className: "flex justify-end gap-2 pt-2", children: [_jsx("button", { className: "btn-secondary", onClick: () => setShowForm(false), children: "Cancel" }), _jsx("button", { className: "btn-primary", onClick: submit, children: editingId ? 'Save Changes' : 'Submit PO' })] })] }) })), approving && (_jsx(Modal, { title: approving.external_approval_required ? `Higher Management Approval — ${approving.po_number}` : `Approve ${approving.po_number}`, onClose: () => setApproving(null), wide: !!approving.external_approval_required, children: _jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "text-sm text-slate-600", children: ["Total amount: ", _jsx("span", { className: "font-semibold", children: formatCurrency(approving.total_amount) })] }), approving.document && !approving.external_approval_required && (_jsxs("div", { className: "rounded-lg border border-slate-200 p-3", children: [_jsxs("div", { className: "text-sm mb-2", children: [_jsx("span", { className: "text-slate-500", children: "Supplier:" }), " ", approving.document.po.supplier_name] }), _jsxs("table", { className: "table-base", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Item" }), _jsx("th", { children: "Qty" }), _jsx("th", { children: "Price" }), _jsx("th", { children: "Tax" })] }) }), _jsx("tbody", { children: approving.document.items.map((line) => _jsxs("tr", { children: [_jsxs("td", { children: [line.item_code, " - ", line.description] }), _jsx("td", { children: line.quantity }), _jsx("td", { children: formatCurrency(line.price) }), _jsxs("td", { children: [line.tax, "%"] })] }, line.id)) })] })] })), approving.external_approval_required ? _jsxs(_Fragment, { children: [_jsx("div", { className: "rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900", children: "This PO exceeds the Supply Chain Manager approval limit. Print the separate request below, obtain higher-management approval, then upload the signed document before approving the PO in ProcuraFlow." }), _jsxs("div", { className: "rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900", children: [_jsx("span", { className: "text-indigo-500", children: "System approval request reference:" }), " ", _jsx("strong", { className: "select-all", children: approving.document?.po?.management_approval_request_number || approving.management_approval_request_number })] }), _jsxs("div", { className: "sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-indigo-200 bg-white/95 p-3 shadow-sm print:hidden", children: [_jsxs("div", { children: [_jsx("div", { className: "font-semibold text-indigo-900", children: "Professional Management Approval Request" }), _jsx("div", { className: "text-xs text-slate-500", children: "Print, obtain signature, and upload the signed copy below." })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { className: "btn-secondary", onClick: () => downloadElementPdf('management-approval-document', `${approving.po_number}-management-approval`, { copies: [COMPANY_COPY, MANAGEMENT_COPY] }), children: "Download PDF" }), _jsx("button", { className: "btn-primary", onClick: () => printControlledCopies('management-approval-document', MANAGEMENT_COPY), children: "Print Two Controlled Copies" })] })] }), approving.document && _jsx(ManagementApprovalRequest, { doc: approving.document }), _jsx(DocumentAttachments, { type: "MANUAL_APPROVAL", documentId: approving.id, onUploaded: (result) => { if (result.po_status === 'Approved') {
                                        alert('Signed management approval uploaded. The PO is now approved and ready for procurement to print.');
                                        setApproving(null);
                                        load();
                                    } } })] }) : _jsx(DocumentAttachments, { type: "PO", documentId: approving.id }), history.length > 0 && (_jsxs("div", { className: "text-xs bg-slate-50 rounded-lg p-2 space-y-1", children: [_jsx("div", { className: "font-medium text-slate-600 mb-1", children: "Approval history" }), history.map((h) => (_jsxs("div", { className: "flex justify-between text-slate-500", children: [_jsxs("span", { children: [h.required_role || 'Requested', " by ", h.requested_by_name || '—'] }), _jsxs("span", { children: [h.decision, h.decision_by_name ? ` — ${h.decision_by_name}` : ''] })] }, h.id)))] })), _jsxs("div", { children: [_jsxs("label", { className: "text-sm font-medium text-slate-700", children: ["Signed Management Decision Reference ", approving.external_approval_required ? _jsx("span", { className: "text-rose-600", children: "(required after approval)" }) : null] }), _jsx("input", { className: "input mt-1", value: approvalRef, onChange: (e) => setApprovalRef(e.target.value) })] }), _jsxs("div", { children: [_jsx("label", { className: "text-sm font-medium text-slate-700", children: "Approval Person Name" }), _jsx("input", { className: "input mt-1", value: approvalPerson, onChange: (e) => setApprovalPerson(e.target.value), placeholder: user?.full_name })] }), _jsxs("div", { className: "flex justify-end gap-2", children: [_jsx("button", { className: "btn-secondary", onClick: () => setApproving(null), children: "Cancel" }), Number(approving.created_by) === Number(user?.id) && user?.role !== 'SupplyChainManager' ? _jsx("span", { className: "rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700", children: "You created this PO and cannot record its approval." }) : approving.external_approval_required ? _jsx("span", { className: "rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800", children: "Approval completes only when signed external-management evidence is uploaded above." }) : _jsx("button", { className: "btn-primary", onClick: approve, children: "Confirm Approval" })] })] }) })), doc && (_jsx(Modal, { title: `Purchase Order — ${doc.po.po_number}`, onClose: () => setDoc(null), wide: true, children: _jsxs("div", { className: "space-y-4", children: [_jsx(ProfessionalPurchaseOrder, { doc: doc }), _jsx("div", { className: "po-supporting-documents print:hidden", children: _jsx(DocumentAttachments, { type: "PO", documentId: doc.po.id }) }), _jsxs("div", { className: "flex justify-end print:hidden", children: [_jsx("button", { className: "btn-secondary mr-2", onClick: () => downloadElementPdf('po-print-document', `${doc.po.po_number}`, { copies: [COMPANY_COPY] }), children: "Download Company Record PDF" }), _jsx("button", { className: "btn-primary", onClick: () => printControlledCopies('po-print-document', PO_VENDOR_COPY), children: "Print Company + Vendor Copies" })] })] }) }))] }));
}
