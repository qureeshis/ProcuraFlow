import React, { useEffect, useState } from 'react';
import client from '../api/client';

export default function DocumentAttachments({ type, documentId, onUploaded }: { type: string; documentId: number; onUploaded?: (result: any) => void }) {
  const [files, setFiles] = useState<any[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const load = () => client.get(`/attachments/${type}/${documentId}`).then((r) => setFiles(r.data)).catch(() => setError('Unable to load attachments'));
  useEffect(() => { load(); }, [type, documentId]);
  async function upload() {
    if (!file) return;
    const body = new FormData(); body.append('file', file);
    try { const response=await client.post(`/attachments/${type}/${documentId}`, body, { headers: { 'Content-Type': 'multipart/form-data' } }); setFile(null); setError(''); await load(); onUploaded?.(response.data); }
    catch (e: any) { setError(e?.response?.data?.error || 'Upload failed'); }
  }
  async function openFile(f:any){try{const response=await client.get(`/attachments/file/${f.id}`,{responseType:'blob'});const url=URL.createObjectURL(response.data);window.open(url,'_blank','noopener,noreferrer');setTimeout(()=>URL.revokeObjectURL(url),60000);}catch{setError('You are not authorized to open this document');}}
  return <div className="rounded-lg border border-slate-200 p-3"><div className="font-medium text-slate-700 mb-2">Supporting Documents</div><div className="space-y-1 mb-2">{files.length ? files.map((f) => <button type="button" key={f.id} className="block text-left text-brand-600 hover:underline" onClick={()=>openFile(f)}>{f.original_name} <span className="text-xs text-slate-400">({f.uploaded_by_name}, {f.uploaded_at})</span></button>) : <div className="text-xs text-slate-400">No documents uploaded.</div>}</div><label className="block text-sm font-medium text-slate-700 mb-1">Select PDF or image to upload</label><div className="flex gap-2"><input className="input" aria-label="Supporting document file" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e)=>setFile(e.target.files?.[0] || null)}/><button className="btn-secondary" disabled={!file} onClick={upload}>Upload</button></div>{error && <div className="text-xs text-rose-600 mt-1">{error}</div>}</div>;
}
