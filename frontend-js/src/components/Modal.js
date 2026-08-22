import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useBranding } from '../contexts/BrandingContext';
import { CompanyLogo } from './Branding';
export default function Modal({ title, onClose, children, wide, }) {
    const { company } = useBranding();
    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const closeOnEscape = (event) => { if (event.key === 'Escape')
            onClose(); };
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [onClose]);
    return createPortal(_jsx("div", { className: "fixed inset-0 z-[100] overflow-y-auto overscroll-contain bg-slate-950/55 p-2 backdrop-blur-sm sm:p-6", role: "dialog", "aria-modal": "true", "aria-label": title, children: _jsx("div", { className: "flex min-h-full items-center justify-center", children: _jsxs("div", { className: `app-modal-panel flex w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-indigo-200 ${wide ? 'max-w-[94rem]' : 'max-w-2xl'} max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)]`, children: [_jsxs("div", { className: "app-modal-header relative z-20 flex shrink-0 items-center justify-between border-b border-indigo-100 bg-gradient-to-r from-indigo-50 via-sky-50 to-teal-50 px-4 py-3 sm:px-5 sm:py-4", children: [_jsxs("div", { className: "flex min-w-0 items-center gap-3", children: [_jsx(CompanyLogo, { company: company, size: "nav" }), _jsx("h3", { className: "truncate font-semibold text-indigo-900", children: title })] }), _jsxs("button", { type: "button", onClick: onClose, className: "btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs", "aria-label": `Close ${title}`, children: [_jsx("span", { "aria-hidden": "true", className: "text-base leading-none", children: "\u00D7" }), " Close"] })] }), _jsx("div", { className: "min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4", children: children }), _jsx("div", { className: "app-modal-footer relative z-20 flex shrink-0 justify-end border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur print:hidden sm:px-5", children: _jsx("button", { type: "button", onClick: onClose, className: "btn-secondary", "aria-label": `Close ${title}`, children: "Close" }) })] }) }) }), document.body);
}
