import React from 'react';
import { getStoredCurrency } from '../utils/currency';
import { CompanyContact, CompanyLogo, GeneratedByFooter } from './Branding';
import { ResponsibleSignature } from './EmployeeSignature';

const amount = (value: unknown) => Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ProfessionalPurchaseOrder({ doc }: { doc: any }) {
  const subtotal = doc.items.reduce((sum: number, item: any) => sum + Number(item.quantity) * Number(item.price), 0);
  const tax = doc.items.reduce((sum: number, item: any) => sum + Number(item.quantity) * Number(item.price) * Number(item.tax || 0) / 100, 0);
  const currency = doc.company?.currency || getStoredCurrency();
  const documentStatus = ['Approved', 'Printed', 'Closed'].includes(doc.po.status) ? 'APPROVED' : String(doc.po.status || '').toUpperCase();
  const approvedDecision = doc.approvals?.find((entry: any) => entry.decision === 'Approved');
  const workflowApprover = approvedDecision?.decision_by_name;
  const approvedBy = doc.po.external_approval_required
    ? (doc.po.approval_person_name || workflowApprover || '—')
    : (workflowApprover || doc.po.created_by_name || '—');
  return (
    <article id="po-print-document" className="controlled-print-document po-document bg-white text-slate-900 border border-slate-200 rounded-lg p-7">
      <header className="flex justify-between gap-6 border-b-2 border-indigo-700 pb-5">
        <div className="flex gap-4 min-w-0">
          <CompanyLogo company={doc.company} size="document" />
          <div><h1 className="text-xl font-bold text-indigo-900">{doc.company?.name || 'Company Name'}</h1><div className="mt-1 text-xs leading-5 text-slate-600 whitespace-pre-line">{doc.company?.address || 'Company address not configured'}</div><CompanyContact company={doc.company}/></div>
        </div>
        <div className="text-right shrink-0"><div className="text-2xl font-bold tracking-wide text-indigo-900">PURCHASE ORDER</div><div className="mt-2 text-sm font-semibold">{doc.po.po_number}</div><div className="text-xs text-slate-600">Date: {new Date(doc.po.created_at).toLocaleDateString()}</div><div className="text-xs text-slate-600">Fiscal Year: {doc.company?.financial_year || '—'}</div></div>
      </header>
      <section className="grid grid-cols-2 gap-5 my-5 text-xs">
        <div className="rounded-md border border-slate-300 overflow-hidden"><div className="bg-indigo-50 px-3 py-2 font-bold text-indigo-900 uppercase tracking-wide">Vendor / Supplier</div><div className="p-3 space-y-1"><div className="text-sm font-bold">{doc.po.supplier_name}</div><div className="whitespace-pre-line">{doc.po.supplier_address || 'Address not recorded'}</div>{doc.po.supplier_contact_person && <div>Contact: {doc.po.supplier_contact_person}</div>}{doc.po.supplier_phone && <div>Phone: {doc.po.supplier_phone}</div>}{doc.po.supplier_email && <div>Email: {doc.po.supplier_email}</div>}</div></div>
        <div className="rounded-md border border-slate-300 overflow-hidden"><div className="bg-indigo-50 px-3 py-2 font-bold text-indigo-900 uppercase tracking-wide">Order Information</div><div className="p-3 grid grid-cols-[130px_1fr] gap-y-1"><span className="text-slate-500">Payment Terms</span><strong>{doc.po.supplier_payment_terms || 'Not specified'}</strong><span className="text-slate-500">Committed Delivery</span><strong>{doc.po.committed_delivery_date ? new Date(`${doc.po.committed_delivery_date}T00:00:00`).toLocaleDateString() : 'Not specified'}</strong><span className="text-slate-500">Currency</span><strong>{currency}</strong><span className="text-slate-500">Prepared By</span><strong>{doc.po.created_by_name || '—'}</strong><span className="text-slate-500">Status</span><strong className={documentStatus === 'APPROVED' ? 'text-emerald-700' : ''}>{documentStatus}</strong>{Boolean(doc.po.external_approval_required) && <><span className="text-slate-500">Management Approval Ref.</span><strong>{doc.po.approval_ref_number || '—'}</strong></>}</div></div>
      </section>
      <table className="w-full text-xs border-collapse"><thead><tr className="bg-indigo-800 text-white"><th className="border border-indigo-700 p-2 text-center w-10">#</th><th className="border border-indigo-700 p-2 text-left">Item Code & Description</th><th className="border border-indigo-700 p-2 text-right">Qty / UOM</th><th className="border border-indigo-700 p-2 text-right">Unit Price</th><th className="border border-indigo-700 p-2 text-right">Tax</th><th className="border border-indigo-700 p-2 text-right">Line Total</th></tr></thead><tbody>{doc.items.map((item: any, index: number) => <tr key={item.id} className={index % 2 ? 'bg-slate-50' : 'bg-white'}><td className="border border-slate-300 p-2 text-center">{index + 1}</td><td className="border border-slate-300 p-2"><strong>{item.item_code}</strong><div className="text-slate-600">{item.description}</div></td><td className="border border-slate-300 p-2 text-right">{Number(item.quantity).toLocaleString()} {item.purchase_uom || item.uom || ''}</td><td className="border border-slate-300 p-2 text-right">{amount(item.price)} / {item.purchase_uom || item.uom || 'unit'}</td><td className="border border-slate-300 p-2 text-right">{Number(item.tax || 0).toFixed(2)}%</td><td className="border border-slate-300 p-2 text-right font-medium">{amount(Number(item.quantity) * Number(item.price) * (1 + Number(item.tax || 0) / 100))}</td></tr>)}</tbody></table>
      <section className="flex justify-end mt-4 text-sm"><div className="w-72"><div className="flex justify-between border-b border-slate-300 py-2"><span>Subtotal</span><span>{amount(subtotal)}</span></div><div className="flex justify-between border-b border-slate-300 py-2"><span>Tax</span><span>{amount(tax)}</span></div><div className="flex justify-between bg-indigo-50 border-y-2 border-indigo-700 px-2 py-2.5 text-base font-bold text-indigo-900"><span>Total ({currency})</span><span>{amount(doc.po.total_amount)}</span></div></div></section>
      <section className="grid grid-cols-3 gap-8 mt-12 pt-2 text-xs text-center"><ResponsibleSignature label="Prepared by" name={doc.po.created_by_name} src={doc.po.created_by_signature_url} date={doc.po.created_at}/><ResponsibleSignature label="Approved by" name={approvedBy} src={approvedDecision?.decision_by_signature_url} date={approvedDecision?.decision_date}/><ResponsibleSignature label="Supplier Acceptance"/></section>
      <GeneratedByFooter note="Official company purchase order. Quote the PO number on all invoices, delivery notes, and correspondence."/>
    </article>
  );
}
