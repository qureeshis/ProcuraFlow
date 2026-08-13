import React, { useEffect, useState } from 'react';
import client from '../../api/client';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import { Column } from '../../types';
import CurrencyInput from '../../components/CurrencyInput';
import { isCurrencyField } from '../../utils/currency';
import { normalizeSignature } from '../../utils/signature';
import EmployeeSignature from '../../components/EmployeeSignature';
import {useAuth} from '../../contexts/AuthContext';

export interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'checkbox' | 'select' | 'multiselect' | 'multicheckbox' | 'signature';
  submit?:boolean;
  createOnly?:boolean;
  options?: { value: any; label: string; [key:string]:any }[] | ((form:Record<string,any>)=>{value:any;label:string;[key:string]:any}[]);
  readOnly?: boolean;
  visible?: (form:Record<string,any>)=>boolean;
}

interface Props {
  title: string;
  description: string;
  endpoint: string; // e.g. /masters/items
  columns: Column<any>[];
  fields: FieldDef[];
  singleRecord?: boolean; // for Company (one row only)
  onCreated?: (record: any) => void;
  deriveForm?: (form: Record<string, any>) => Record<string, any>;
  extraPayload?: (form: Record<string, any>,editing:boolean) => Record<string, any>;
  renderFormExtra?: (form: Record<string, any>, setForm: React.Dispatch<React.SetStateAction<Record<string, any>>>, editing: any | null) => React.ReactNode;
  wideForm?: boolean;
  transformFieldChange?: (field: FieldDef, value: any, form: Record<string, any>) => Record<string, any>;
  onSaved?: (record:any,form:Record<string,any>,editing:boolean)=>Promise<void>|void;
  readOnly?: boolean;
  canCreate?:boolean;
  canEdit?:boolean;
  canDelete?:boolean;
}

export default function MasterDataPage({ title, description, endpoint, columns, fields, singleRecord, onCreated, onSaved,deriveForm, extraPayload, renderFormExtra, wideForm, transformFieldChange,readOnly=false,canCreate=!readOnly,canEdit,canDelete }: Props) {
  const{user}=useAuth();
  const effectiveCanEdit=canEdit??(!readOnly&&user?.role==='SupplyChainManager');
  const effectiveCanDelete=canDelete??(!readOnly&&user?.role==='SupplyChainManager');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  function load() {
    setLoading(true);
    client
      .get(endpoint)
      .then((res) => setRows(res.data))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, [endpoint]);

  function openCreate() {
    setEditing(null);
    setForm({});
    setError('');
    setShowForm(true);
  }

  function openEdit(row: any) {
    setEditing(row);
    setForm(deriveForm ? deriveForm(row) : row);
    setError('');
    setShowForm(true);
  }

  async function save() {
    try {
      const payload = { ...Object.fromEntries(fields.filter((field) => field.type!=='signature'&&field.submit!==false&&(!field.createOnly||!editing)&&(!field.readOnly || !editing)).map((field) => [field.key, form[field.key]])), ...(extraPayload?.(form,!!editing)||{}) };
      let saved:any;
      if (editing) {
        saved=(await client.put(`${endpoint}/${editing.id}`, payload)).data;
      } else {
        const response = await client.post(endpoint, payload);
        saved=response.data;
        onCreated?.(response.data);
      }
      const signature=fields.find(field=>field.type==='signature');const file=signature?form[signature.key]:null;
      if(file instanceof File){const blob=await normalizeSignature(file);const body=new FormData();body.append('signature',blob,'employee-signature.png');await client.post(`${endpoint}/${saved.id}/signature`,body,{headers:{'Content-Type':'multipart/form-data'}});}
      await onSaved?.(saved,form,!!editing);
      setShowForm(false);
      load();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Save failed');
    }
  }

  async function remove(row: any) {
    if (!confirm(`Delete this record?`)) return;
    try { await client.delete(`${endpoint}/${row.id}`); setError(''); load(); }
    catch (e:any) { setError(e?.response?.data?.error || 'Delete failed'); }
  }

  const filteredRows = (singleRecord ? rows.slice(0, 1) : rows).filter((row) => {
    if (!search.trim()) return true;
    const haystack = Object.values(row).join(' ').toLowerCase();
    return haystack.includes(search.toLowerCase());
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          <p className="text-sm text-slate-500">{description}</p>
        </div>
        {canCreate&&!(singleRecord && rows.length > 0) && (
          <button className="btn-primary" onClick={openCreate}>
            + Add {title.replace(/s$/, '')}
          </button>
        )}
      </div>

      <div className="card mt-4">
        {error && !showForm && <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="text-sm text-slate-500">Search existing records to avoid duplicates.</div>
          <input
            className="input max-w-xs"
            placeholder={`Search ${title.toLowerCase()}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <DataTable
          columns={columns}
          rows={filteredRows}
          loading={loading}
          actions={!effectiveCanEdit&&!effectiveCanDelete?undefined:(row) => (
            <div className="flex gap-2 justify-end">
              {effectiveCanEdit&&<button className="text-brand-600 text-xs font-medium" onClick={() => openEdit(row)}>
                Edit
              </button>}
              {effectiveCanDelete&&!singleRecord && (
                <button className="text-rose-600 text-xs font-medium" onClick={() => remove(row)}>
                  Delete
                </button>
              )}
            </div>
          )}
        />
      </div>

      {showForm && (
        <Modal title={editing ? `Edit ${title}` : `New ${title}`} onClose={() => setShowForm(false)} wide={wideForm}>
          <div className={`grid gap-x-4 gap-y-3 ${wideForm?'md:grid-cols-2 xl:grid-cols-3':'md:grid-cols-2'}`}>
            {fields.filter((f)=>f.visible?.(form)!==false).map((f) => (
              <div key={f.key}>
                <label className="text-sm font-medium text-slate-700">{f.label}</label>
                {f.type === 'signature' ? <div className="mt-1 rounded-lg border border-sky-200 bg-slate-50 p-3"><div className="flex items-center gap-4">{editing?.signature_url&&<EmployeeSignature src={editing.signature_url} name={editing.name}/>}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>setForm({...form,[f.key]:e.target.files?.[0]})}/></div><p className="mt-2 text-xs text-slate-500">Upload a clear signature on white or transparent background. ProcuraFlow automatically removes the background, crops whitespace and stores a transparent PNG.</p></div> : f.type === 'checkbox' ? (
                  <input
                    type="checkbox"
                    className="mt-1 ml-1"
                    checked={!!form[f.key]}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.checked ? 1 : 0 })}
                  />
                ) : f.type === 'multicheckbox' ? (
                  <div className="mt-1 grid max-h-40 gap-1 overflow-y-auto rounded-lg border border-slate-300 bg-white p-2 sm:grid-cols-2">
                    {((typeof f.options==='function'?f.options(form):f.options)||[]).map((o:any)=>{const selected=Array.isArray(form[f.key])&&form[f.key].some((value:any)=>String(value)===String(o.value));return <label key={String(o.value)} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${selected?'border-sky-400 bg-sky-50 text-sky-900':'border-slate-200 text-slate-700 hover:bg-slate-50'}`}><input type="checkbox" checked={selected} onChange={e=>{const current=Array.isArray(form[f.key])?form[f.key]:[];const value=e.target.checked?[...current,o.value]:current.filter((item:any)=>String(item)!==String(o.value));const next=transformFieldChange?.(f,value,form)||{...form,[f.key]:value};setForm(deriveForm?deriveForm(next):next);}}/><span>{o.label}</span></label>;})}
                    {!((typeof f.options==='function'?f.options(form):f.options)||[]).length&&<div className="col-span-full px-2 py-3 text-sm text-amber-700">No active warehouses are available. Create a warehouse first.</div>}
                  </div>
                ) : f.type === 'multiselect' ? (<select multiple className="input mt-1 min-h-28" value={Array.isArray(form[f.key])?form[f.key].map(String):[]} onChange={e=>{const value=Array.from(e.target.selectedOptions).map(option=>option.value);const next=transformFieldChange?.(f,value,form)||{...form,[f.key]:value};setForm(deriveForm?deriveForm(next):next);}}>{(typeof f.options==='function'?f.options(form):f.options)?.map((o:any)=><option key={String(o.value)} value={o.value}>{o.label}</option>)}</select>) : f.type === 'select' ? (
                  <select
                    className="input mt-1"
                    value={form[f.key] ?? ''}
                    onChange={(e) => {const next=transformFieldChange?.(f,e.target.value,form)||{...form,[f.key]:e.target.value};setForm(deriveForm?deriveForm(next):next);}}
                  >
                    <option value="">Select...</option>
                    {(typeof f.options==='function'?f.options(form):f.options)?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.type === 'number' && isCurrencyField(f.key) ? (
                  <CurrencyInput
                    value={form[f.key] ?? ''}
                    min="0"
                    readOnly={f.readOnly}
                    onChange={(e) => {
                      const next = { ...form, [f.key]: e.target.value === '' ? '' : Number(e.target.value) };
                      setForm(deriveForm ? deriveForm(next) : next);
                    }}
                  />
                ) : (
                  <input
                    className="input mt-1"
                    type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                    value={form[f.key] ?? ''}
                    readOnly={f.readOnly}
                    onChange={(e) => {
                      const next = { ...form, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value };
                      setForm(deriveForm ? deriveForm(next) : next);
                    }}
                  />
                )}
              </div>
            ))}
            {renderFormExtra&&<div className="md:col-span-2 xl:col-span-3">{renderFormExtra(form,setForm,editing)}</div>}
            {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}
            <div className="flex justify-end gap-2 pt-2 md:col-span-2 xl:col-span-3">
              <button className="btn-secondary" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={save}>
                Save
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
