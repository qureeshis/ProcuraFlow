import React, { useEffect } from 'react';
import { getStoredCurrency } from '../utils/currency';
import { CompanyContact, CompanyLogo, GeneratedByFooter } from './Branding';
import { ResponsibleSignature } from './EmployeeSignature';

const num = (value: unknown) => Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (value: unknown) => value ? new Date(String(value)).toLocaleDateString() : '—';

export default function ProfessionalFinancePaymentPack({ pack }: { pack: any }) {
  const { invoice: inv, company, receipts = [] } = pack;
  const currency = inv.transaction_currency || company?.currency || getStoredCurrency();
  const remaining = Number(pack.analysis?.remaining_variance || 0);
  const hasException = Boolean(inv.variance_reason || inv.variance_acceptance_note || Number(inv.reconciliation_adjustment || 0));
  const grnList = receipts.map((receipt: any) => `${receipt.grn_number} (${date(receipt.grn_date)})`);
  const grnReferences = grnList.length ? `${grnList.slice(0, 3).join(', ')}${grnList.length > 3 ? ` +${grnList.length - 3} additional posted GRN(s)` : ''}` : 'No posted GRN reference';

  useEffect(() => {
    const root = document.getElementById('finance-pack-print-document')?.parentElement;
    const buttons = root?.querySelectorAll(':scope > div:first-child button');
    if (buttons?.[0]) buttons[0].textContent = 'Download Finance Pack';
    if (buttons?.[1]) buttons[1].textContent = 'Print Three Controlled Copies';
    buttons?.forEach(button => {
      const approved = inv.finance_pack_status === 'Ready for Finance - External Process';
      (button as HTMLButtonElement).disabled = !approved;
      button.setAttribute('title', approved ? 'Approved controlled output' : 'Available after Supply Chain Manager or authorized acting approver confirmation');
    });
  }, [inv.finance_pack_status]);

  return <><div className={`print:hidden rounded-lg border px-3 py-2 text-xs font-semibold ${inv.finance_pack_status === 'Ready for Finance - External Process' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>{inv.finance_pack_status === 'Ready for Finance - External Process' ? 'External handoff recorded: controlled download and printing are available.' : `Controlled output is locked until handoff by ${pack.approval_authority?.effective_role?.replace(/([a-z])([A-Z])/g, '$1 $2') || 'the Supply Chain Manager or a valid delegate'}.`}</div><article id="finance-pack-print-document" data-output-authorized={inv.finance_pack_status === 'Ready for Finance - External Process' ? 'true' : 'false'} className="controlled-print-document finance-payment-pack rounded-lg border border-slate-200 bg-white p-5 text-slate-900">
    <header className="flex justify-between gap-5 border-b-2 border-indigo-900 pb-4">
      <div className="flex gap-3"><CompanyLogo company={company} size="document"/><div><h1 className="text-lg font-bold text-indigo-950">{company?.name || 'Company Name'}</h1><div className="mt-1 whitespace-pre-line text-[11px] leading-4 text-slate-600">{company?.address || 'Company address not configured'}</div><CompanyContact company={company}/></div></div>
      <div className="text-right"><div className="text-xl font-bold tracking-wide text-indigo-950">EXTERNAL FINANCE<br/>HANDOFF PACKAGE</div><div className="mt-1 text-xs font-bold">{inv.finance_pack_reference}</div><div className={`mt-2 inline-block rounded px-2.5 py-1 text-[10px] font-bold ${inv.finance_pack_status === 'Ready for Finance - External Process' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{inv.finance_pack_status === 'Ready for Finance - External Process' ? 'READY FOR FINANCE — EXTERNAL PROCESS' : 'DRAFT — SUPPLY CHAIN REVIEW'}</div></div>
    </header>

    <section className="my-3 grid grid-cols-2 gap-3 text-xs">
      <div className="finance-pack-panel"><h2>Payee &amp; Invoice</h2><dl><dt>Supplier</dt><dd>{inv.supplier_name} ({inv.supplier_code})</dd><dt>Invoice</dt><dd>{inv.invoice_number}</dd><dt>Invoice date</dt><dd>{date(inv.invoice_date)}</dd><dt>Payment terms</dt><dd>{inv.payment_terms || 'Not specified'}</dd></dl></div>
      <div className="finance-pack-panel"><h2>Source Documents</h2><dl><dt>Purchase order</dt><dd>{inv.po_number}</dd><dt>PO date</dt><dd>{date(inv.po_date)}</dd><dt>Posted GRN(s)</dt><dd>{grnReferences}</dd><dt>Attachments</dt><dd>{pack.attachment_count || 0} supporting file(s)</dd></dl></div>
    </section>

    <section className="grid grid-cols-4 gap-2 text-xs">
      {[['PO Authorized Value', inv.po_total], ['GRN Accepted Value', pack.grn_value], ['Supplier Invoice', inv.invoice_total], ['Amount for Processing', inv.adjusted_invoice_total ?? inv.invoice_total]].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5"><div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-sm font-bold text-indigo-950">{currency} {num(value)}</div></div>)}
    </section>

    <section className="mt-3 finance-pack-panel text-xs"><h2>Payment Control Decision</h2><div className="finance-pack-decision"><div><span>Three-way verification</span><b>{inv.reconciliation_classification || pack.analysis?.classification || inv.match_status}</b></div><div><span>Duplicate invoice control</span><b className={pack.duplicate_check_passed ? 'text-emerald-700' : 'text-rose-700'}>{pack.duplicate_check_passed ? 'PASSED' : 'FAILED'}</b></div><div><span>Balance after reconciliation</span><b className={Math.abs(remaining) <= .01 ? 'text-emerald-700' : 'text-rose-700'}>{Math.abs(remaining) <= .01 ? 'NO DIFFERENCE' : `${currency} ${num(remaining)}`}</b></div><div><span>Accounting period</span><b>{company?.financial_year || '—'}</b></div></div></section>

    {hasException && <section className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs print-avoid-break"><div className="font-bold uppercase text-amber-950">Approved Exception / Reconciliation</div><div className="mt-2 grid grid-cols-[145px_1fr] gap-y-1.5"><span>System finding</span><b>{inv.variance_reason || 'Recorded reconciliation'}</b><span>Adjustment</span><b>{currency} {num(inv.reconciliation_adjustment)}</b><span>Reason and decision</span><b>{inv.variance_acceptance_note || inv.adjustment_reason || 'Not recorded'}</b><span>Accepted by</span><b>{inv.variance_accepted_by_name || '—'} · {date(inv.variance_accepted_at)}</b></div></section>}

    <section className="mt-4 rounded-lg border-2 border-indigo-900 p-3 text-xs print-avoid-break"><div className="font-bold text-indigo-950">AUTHORIZED SUPPLY CHAIN HANDOFF</div><p className="my-2 text-slate-700">The supplier invoice, authorized PO, posted receipt evidence and three-way match were reviewed. ProcuraFlow ends when this package is marked Ready for Finance — External Process; all Finance activity occurs outside the application.</p><div className="grid grid-cols-2 gap-5"><ResponsibleSignature label="Handed off by" name={inv.confirmed_by_name || 'Pending handoff'} src={inv.confirmed_by_signature_url} date={inv.verified_date}/><div><span className="text-slate-500">Handoff comments</span><div className="mt-1 font-medium">{inv.finance_review_comments || 'No additional comments'}</div></div></div></section>

    <section className="mt-9 text-center text-xs print-avoid-break"><div className="border-t border-slate-500 pt-2">External Finance Reference / Confirmation (informational only)</div></section>
    <GeneratedByFooter note="Controlled Supply Chain handoff evidence. Finance has no ProcuraFlow access and all Finance processing occurs externally."/>
  </article></>;
}
