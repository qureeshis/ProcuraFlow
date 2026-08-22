import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
export default function SearchSelect({ label, options, value, onChange, placeholder, onSearch }) {
    const [query, setQuery] = useState(''), [open, setOpen] = useState(false);
    const selectedLabel = options.find(option => String(option.value) === String(value))?.label || '';
    // Synchronize only when the external selection changes. Parent forms often
    // rebuild the options array while typing; that must never erase the query.
    useEffect(() => { setQuery(selectedLabel); }, [value, selectedLabel]);
    const normalized = query.trim().toLocaleLowerCase();
    const filtered = options.filter(option => !normalized || option.label.toLocaleLowerCase().includes(normalized)).slice(0, 100);
    return _jsxs("div", { className: "relative", children: [label && _jsx("label", { className: "text-sm font-medium text-slate-700", children: label }), _jsx("input", { className: "input mt-1 w-full", type: "search", autoComplete: "off", placeholder: placeholder, value: query, onChange: event => { const next = event.target.value; setQuery(next); setOpen(true); onSearch?.(next); if (!next)
                    onChange(''); }, onFocus: () => setOpen(true), onKeyDown: event => { if (event.key === 'Enter' && filtered.length) {
                    event.preventDefault();
                    setQuery(filtered[0].label);
                    onChange(filtered[0].value);
                    setOpen(false);
                } if (event.key === 'Escape')
                    setOpen(false); }, onBlur: () => window.setTimeout(() => setOpen(false), 150) }), open && _jsx("div", { className: "absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg", children: filtered.length ? filtered.map(option => _jsx("button", { type: "button", className: "block w-full px-3 py-2 text-left text-sm hover:bg-indigo-50 focus:bg-indigo-50", onMouseDown: event => { event.preventDefault(); setQuery(option.label); onChange(option.value); setOpen(false); }, children: option.label }, option.value)) : _jsx("div", { className: "px-3 py-2 text-sm text-slate-500", children: "No matching results" }) })] });
}
