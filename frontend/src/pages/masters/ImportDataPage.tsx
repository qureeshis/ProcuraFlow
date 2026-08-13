import React, { useState } from 'react';
import client from '../../api/client';

export default function ImportDataPage() {
  const [vendorFile, setVendorFile] = useState<File | null>(null);
  const [itemFile, setItemFile] = useState<File | null>(null);
  const [openingFile, setOpeningFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');

  async function uploadVendors() {
    if (!vendorFile) return;
    const form = new FormData();
    form.append('file', vendorFile);
    setImporting(true);
    setMessage('');
    try {
      const res = await client.post('/settings/imports/vendors', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setMessage(`Imported ${res.data.imported} vendor record(s).`);
    } finally {
      setImporting(false);
    }
  }

  async function uploadOpeningBalances() {
    if (!openingFile) return;
    const form = new FormData();
    form.append('file', openingFile);
    setImporting(true);
    setMessage('');
    try {
      const res = await client.post('/settings/imports/opening-balances', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setMessage(`Imported ${res.data.imported} opening balance row(s).${res.data.skipped ? ` Skipped ${res.data.skipped} invalid or unknown-item row(s).` : ''}`);
    } catch (error: any) {
      setMessage(error?.response?.data?.error || 'Opening balance import failed. Check the file and try again.');
    } finally {
      setImporting(false);
    }
  }

  async function uploadItems() {
    if (!itemFile) return;
    const form = new FormData();
    form.append('file', itemFile);
    setImporting(true);
    setMessage('');
    try {
      const res = await client.post('/settings/imports/items', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setMessage(`Imported ${res.data.imported} item record(s).`);
    } finally {
      setImporting(false);
    }
  }

  function downloadTemplate(type: 'vendors' | 'items' | 'opening') {
    const content =
      type === 'vendors'
        ? 'supplier_code,name,contact_person,phone,email,address,payment_terms,rating\nSUP-001,Example Supplier,John Doe,+971501234567,contact@example.com,Warehouse City,Net 30,4.5\n'
        : type === 'items'
          ? 'item_code,description,category,subcategory,uom,purchase_uom,issue_uom,conversion_factor,consumable_returnable,high_value_flag,always_approval_yn,tool_control_yn,batch_control_yn,expiry_control_yn,inspection_required_yn,min_stock,max_stock,reorder_level,standard_cost\nITM-001,Example Item,Raw Material,Steel,KG,TON,KG,1000,Consumable,0,0,0,1,0,1,100,1000,250,12.5\n'
        : 'item_code,description,category,subcategory,uom,purchase_uom,issue_uom,conversion_factor,consumable_returnable,high_value_flag,always_approval_yn,tool_control_yn,batch_control_yn,expiry_control_yn,inspection_required_yn,min_stock,max_stock,reorder_level,warehouse,location,quantity,unit_cost,received_date,batch,expiry_date\nITM-001,Example Steel Bar,Raw Material,Steel,KG,TON,KG,1000,Consumable,0,0,0,1,0,1,100,1000,250,Main Warehouse,Bin 05,100,5.2,2026-01-01,BATCH-001,\n';
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = type === 'vendors' ? 'vendors-template.csv' : type === 'items' ? 'items-template.csv' : 'opening-balances-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Import Data</h1>
      <p className="text-sm text-slate-500 mb-4">Import vendors, item master data, and opening inventory balances using the same fields shown in their forms.</p>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="card p-5">
          <h2 className="font-medium text-slate-800 mb-2">Import Existing Vendors</h2>
          <p className="text-sm text-slate-500 mb-3">Uses every Add Supplier field: supplier code, name, contact person, phone, email, address, payment terms, and rating.</p>
          <input className="input mt-1" type="file" accept=".csv,.xls,.xlsx" onChange={(e) => setVendorFile(e.target.files?.[0] || null)} />
          <div className="flex gap-2 mt-3">
            <button className="btn-secondary text-xs" onClick={() => downloadTemplate('vendors')}>Download Template</button>
            <button className="btn-primary" onClick={uploadVendors} disabled={!vendorFile || importing}>
              {importing ? 'Importing...' : 'Import Vendors'}
            </button>
          </div>
        </div>

        <div className="card p-5">
          <h2 className="font-medium text-slate-800 mb-2">Import New Items</h2>
          <p className="text-sm text-slate-500 mb-3">Uses every New Item field, including UOMs, stock levels, costs, and control flags. Use 1/0 or Yes/No for flags.</p>
          <input className="input mt-1" type="file" accept=".csv,.xls,.xlsx" onChange={(e) => setItemFile(e.target.files?.[0] || null)} />
          <div className="flex gap-2 mt-3">
            <button className="btn-secondary text-xs" onClick={() => downloadTemplate('items')}>Download Template</button>
            <button className="btn-primary" onClick={uploadItems} disabled={!itemFile || importing}>
              {importing ? 'Importing...' : 'Import Items'}
            </button>
          </div>
        </div>

        <div className="card p-5">
          <h2 className="font-medium text-slate-800 mb-2">Import Opening Balances</h2>
          <p className="text-sm text-slate-500 mb-3">Includes all New Item fields plus warehouse, location, quantity, unit cost, receipt date, batch, and expiry. New item codes are automatically added to Item Master when description is provided; existing master details are preserved.</p>
          <input className="input mt-1" type="file" accept=".csv,.xls,.xlsx" onChange={(e) => setOpeningFile(e.target.files?.[0] || null)} />
          <div className="flex gap-2 mt-3">
            <button className="btn-secondary text-xs" onClick={() => downloadTemplate('opening')}>Download Template</button>
            <button className="btn-primary" onClick={uploadOpeningBalances} disabled={!openingFile || importing}>
              {importing ? 'Importing...' : 'Import Balances'}
            </button>
          </div>
        </div>
      </div>

      {message && <div className={`card p-4 mt-4 text-sm ${message.toLowerCase().includes('failed') ? 'text-rose-700' : 'text-emerald-600'}`}>{message}</div>}
    </div>
  );
}
