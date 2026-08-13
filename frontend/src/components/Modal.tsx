import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useBranding } from '../contexts/BrandingContext';
import { CompanyLogo } from './Branding';

export default function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const {company}=useBranding();
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-y-auto overscroll-contain bg-slate-950/55 p-2 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex min-h-full items-center justify-center">
      <div className={`app-modal-panel flex w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-indigo-200 ${wide ? 'max-w-[94rem]' : 'max-w-2xl'} max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)]`}>
        <div className="app-modal-header relative z-20 flex shrink-0 items-center justify-between border-b border-indigo-100 bg-gradient-to-r from-indigo-50 via-sky-50 to-teal-50 px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex min-w-0 items-center gap-3"><CompanyLogo company={company} size="nav"/><h3 className="truncate font-semibold text-indigo-900">{title}</h3></div>
          <button type="button" onClick={onClose} className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs" aria-label={`Close ${title}`}>
            <span aria-hidden="true" className="text-base leading-none">&times;</span> Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">{children}</div>
        <div className="app-modal-footer relative z-20 flex shrink-0 justify-end border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur print:hidden sm:px-5">
          <button type="button" onClick={onClose} className="btn-secondary" aria-label={`Close ${title}`}>Close</button>
        </div>
      </div>
      </div>
    </div>,
    document.body,
  );
}
