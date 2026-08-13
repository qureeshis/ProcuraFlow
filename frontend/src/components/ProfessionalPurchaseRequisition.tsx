import React from 'react';
import { CompanyContact, CompanyLogo, GeneratedByFooter } from './Branding';
import { ResponsibleSignature } from './EmployeeSignature';

const displayDate = (value: unknown) => value ? new Date(String(value)).toLocaleDateString() : 'Not specified';

export default function ProfessionalPurchaseRequisition({ requisition }: { requisition: any }) {
  const approved = requisition.approvals?.find((entry: any) => entry.decision === 'Approved');
  return (
    <article id="pr-print-document" className="controlled-print-document bg-white text-slate-900 border border-slate-200 rounded-lg p-7">
      <header className="flex justify-between gap-6 border-b-2 border-teal-700 pb-5">
        <div className="flex min-w-0 gap-4">
          <CompanyLogo company={requisition.company} size="document" />
          <div><h1 className="text-xl font-bold text-teal-900">{requisition.company?.name || 'Company Name'}</h1><div className="mt-1 whitespace-pre-line text-xs leading-5 text-slate-600">{requisition.company?.address || 'Company address not configured'}</div><CompanyContact company={requisition.company}/></div>
        </div>
        <div className="shrink-0 text-right"><div className="text-2xl font-bold tracking-wide text-teal-900">PURCHASE REQUISITION</div><div className="mt-2 text-sm font-semibold">{requisition.pr_number}</div><div className="text-xs text-slate-600">PR Date: {displayDate(requisition.pr_date || requisition.created_at)}</div><div className="text-xs text-slate-600">Fiscal Year: {requisition.company?.financial_year || '—'}</div></div>
      </header>
      <section className="my-5 grid grid-cols-2 gap-5 text-xs">
        <div className="overflow-hidden rounded-md border border-slate-300"><div className="bg-teal-50 px-3 py-2 font-bold uppercase tracking-wide text-teal-900">Request Details</div><div className="grid grid-cols-[100px_1fr] gap-y-2 p-3"><span className="text-slate-500">Requested By</span><strong>{requisition.requestor_name || (requisition.auto_generated ? 'ProcuraFlow' : '—')}</strong><span className="text-slate-500">Department</span><strong>{requisition.department_name || '—'}</strong><span className="text-slate-500">Source</span><strong>{requisition.auto_generated ? 'Automatic Low-Stock Replenishment' : 'Manual Request'}</strong><span className="text-slate-500">Status</span><strong>{requisition.status}</strong></div></div>
        <div className="overflow-hidden rounded-md border border-slate-300"><div className="bg-teal-50 px-3 py-2 font-bold uppercase tracking-wide text-teal-900">Document Control</div><div className="grid grid-cols-[100px_1fr] gap-y-2 p-3"><span className="text-slate-500">Reference</span><strong>{requisition.pr_number}</strong><span className="text-slate-500">Approved By</span><strong>{approved?.decision_by_name || 'Pending approval'}</strong><span className="text-slate-500">Approval Date</span><strong>{approved ? displayDate(approved.decision_date) : '—'}</strong></div></div>
      </section>
      <table className="w-full border-collapse text-[10px]"><thead><tr className="bg-teal-800 text-white"><th className="w-8 border border-teal-700 p-2 text-center">#</th><th className="border border-teal-700 p-2 text-left">Item Code &amp; Description</th><th className="border border-teal-700 p-2 text-right">Required Qty</th><th className="border border-teal-700 p-2 text-right">Ordered Qty</th><th className="border border-teal-700 p-2 text-right">Open Balance</th><th className="border border-teal-700 p-2 text-center">Required Date</th><th className="border border-teal-700 p-2 text-left">Purpose / Reason</th></tr></thead><tbody>{requisition.items?.map((item: any, index: number)=>{const uom=item.purchase_uom||item.uom||'';return <tr key={item.id} className={index%2?'bg-slate-50':'bg-white'}><td className="border border-slate-300 p-2 text-center">{index+1}</td><td className="border border-slate-300 p-2"><strong>{item.item_code}</strong><div className="text-slate-600">{item.description}</div></td><td className="border border-slate-300 p-2 text-right font-medium">{Number(item.quantity).toLocaleString()} {uom}</td><td className="border border-slate-300 p-2 text-right">{Number(item.ordered_quantity||0).toLocaleString()} {uom}</td><td className="border border-slate-300 p-2 text-right font-semibold text-amber-700">{Number(item.remaining_quantity??item.quantity).toLocaleString()} {uom}</td><td className="border border-slate-300 p-2 text-center">{displayDate(item.required_date)}</td><td className="border border-slate-300 p-2">{item.reason || 'Not specified'}</td></tr>;})}</tbody></table>
      <section className="mt-14 grid grid-cols-3 gap-8 text-center text-xs"><ResponsibleSignature label="Requested by" name={requisition.requestor_name||(requisition.auto_generated?'ProcuraFlow':undefined)} src={requisition.requestor_signature_url} date={requisition.created_at || requisition.pr_date}/><ResponsibleSignature label="Department Authorization"/><ResponsibleSignature label="Procurement Approval" name={approved?.decision_by_name} src={approved?.decision_by_signature_url} date={approved?.decision_date}/></section>
      <GeneratedByFooter note="Official company purchase requisition. This document is not a purchase order and does not authorize a supplier commitment."/>
    </article>
  );
}
