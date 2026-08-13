import React from 'react';

const COLORS: Record<string, string> = {
  Draft: 'bg-slate-100 text-slate-600',
  Submitted: 'bg-blue-100 text-blue-700',
  PendingApproval: 'bg-amber-100 text-amber-700',
  Approved: 'bg-emerald-100 text-emerald-700',
  Printed: 'bg-indigo-100 text-indigo-700',
  Rejected: 'bg-rose-100 text-rose-700',
  Closed: 'bg-slate-200 text-slate-600',
  Pending: 'bg-amber-100 text-amber-700',
  Open: 'bg-blue-100 text-blue-700',
  Counted: 'bg-indigo-100 text-indigo-700',
  Active: 'bg-emerald-100 text-emerald-700',
  Inactive: 'bg-slate-100 text-slate-500',
};

export default function StatusBadge({ status }: { status: string }) {
  const cls = COLORS[status] || 'bg-slate-100 text-slate-600';
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{status}</span>;
}
