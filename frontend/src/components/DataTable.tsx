import React,{useMemo,useState} from 'react';
import { Column } from '../types';
import { formatCurrency, isCurrencyField } from '../utils/currency';

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  emptyLabel?: string;
  onRowClick?: (row: T) => void;
  actions?: (row: T) => React.ReactNode;
  footer?: React.ReactNode[];
  searchable?: boolean;
}

export default function DataTable<T extends Record<string, any>>({
  columns,
  rows,
  loading,
  emptyLabel = 'No records found',
  onRowClick,
  actions,
  footer,
  searchable=true,
}: Props<T>) {
  const [query,setQuery]=useState('');
  const visibleRows=useMemo(()=>{const needle=query.trim().toLocaleLowerCase();return needle?rows.filter(row=>Object.values(row).some(value=>String(value??'').toLocaleLowerCase().includes(needle))):rows;},[rows,query]);
  const displayValue = (row: T, key: string) => {
    const raw = row[key];
    if (raw == null || raw === '') return '—';
    if (isCurrencyField(key)) return formatCurrency(raw, row.currency || undefined);
    return String(raw);
  };
  return (
    <div>{searchable&&<div className="border-b border-slate-100 p-3"><input type="search" autoComplete="off" className="input w-full max-w-sm" placeholder="Search this table..." value={query} onChange={event=>setQuery(event.target.value)}/><div className="mt-1 text-[11px] text-slate-400">{query?`${visibleRows.length} matching records`:`${rows.length} total records`}</div></div>}<div className="overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={String(c.key)}>{c.label}</th>
            ))}
            {actions && <th className="text-right">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={columns.length + (actions ? 1 : 0)} className="text-center py-8 text-slate-400">
                Loading...
              </td>
            </tr>
          )}
          {!loading && visibleRows.length === 0 && (
            <tr>
              <td colSpan={columns.length + (actions ? 1 : 0)} className="text-center py-8 text-slate-400">
                {emptyLabel}
              </td>
            </tr>
          )}
          {!loading &&
            visibleRows.map((row, i) => (
              <tr
                key={row.id ?? i}
                onClick={() => onRowClick?.(row)}
                className={onRowClick ? 'cursor-pointer hover:bg-slate-50' : ''}
              >
                {columns.map((c) => (
                  <td key={String(c.key)} className={isCurrencyField(String(c.key)) ? 'text-right tabular-nums' : ''}>{c.render ? c.render(row) : displayValue(row, String(c.key))}</td>
                ))}
                {actions && (
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                    {actions(row)}
                  </td>
                )}
              </tr>
            ))}
        </tbody>
        {!loading && rows.length > 0 && footer && <tfoot><tr className="bg-slate-100 font-bold text-slate-900">{footer.map((cell,index)=><td key={index} className="border-t-2 border-slate-300 px-4 py-3">{cell}</td>)}{actions&&<td className="border-t-2 border-slate-300"/>}</tr></tfoot>}
      </table>
    </div></div>
  );
}
