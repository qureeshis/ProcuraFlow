import React, { useEffect, useMemo, useState } from 'react';
import client from '../../api/client';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';

const parentTypes: Record<string, string[]> = { Zone: [], Aisle: ['Zone'], Rack: ['Zone','Aisle'], Shelf: ['Rack'], Bin: ['Zone','Aisle','Rack','Shelf'] };
const blankWarehouse = { name: '', site_type: 'Factory', site_name: '', address: '', country_code: '', city_id: '', postal_code:'', region_province:'' };

export default function WarehousesPage() {
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [showWh, setShowWh] = useState(false);
  const [showLoc, setShowLoc] = useState(false);
  const [warehouseForm, setWarehouseForm] = useState<any>(blankWarehouse);
  const [locForm, setLocForm] = useState<any>({ type: 'Zone', label: '' });
  const [error, setError] = useState('');
  const [reference,setReference]=useState<any>({countries:[],cities:[]});
  function load() { client.get('/masters/warehouses').then(r => setWarehouses(r.data)); client.get('/masters/locations').then(r => setLocations(r.data)); }
  useEffect(()=>{load();client.get('/workforce/reference').then(r=>setReference(r.data)).catch(()=>undefined);}, []);
  const parents = useMemo(() => locations.filter(l => Number(l.warehouse_id) === Number(locForm.warehouse_id) && parentTypes[locForm.type]?.includes(l.type)), [locations, locForm]);
  async function saveWarehouse() { try { await client.post('/masters/warehouses', warehouseForm); setShowWh(false); setWarehouseForm(blankWarehouse); load(); } catch(e:any) { setError(e.response?.data?.error || 'Unable to save warehouse'); } }
  async function saveLocation() { try { await client.post('/masters/locations', locForm); setShowLoc(false); setLocForm({ type:'Zone', label:'' }); load(); } catch(e:any) { setError(e.response?.data?.error || 'Unable to save location'); } }
  return <div>
    <div className="mb-4"><h1 className="text-xl font-semibold text-slate-900">Warehouse Sites &amp; Storage Locations</h1><p className="text-sm text-slate-500">Physical structure: Site / Warehouse → Zone → Rack → Shelf → Bin. ProcuraFlow generates every operational code.</p></div>
    <div className="grid xl:grid-cols-2 gap-6">
      <div className="card p-4"><div className="flex justify-between mb-3"><h2 className="font-medium">Warehouse Sites</h2><button className="btn-secondary text-xs" onClick={()=>{setError('');setShowWh(true)}}>+ Add Warehouse</button></div>
        <DataTable rows={warehouses} columns={[{key:'warehouse_code',label:'Code'},{key:'name',label:'Warehouse'},{key:'site_type',label:'Site Type'},{key:'site_name',label:'Facility / Project'},{key:'city',label:'City'},{key:'address',label:'Address'}]} /></div>
      <div className="card p-4"><div className="flex justify-between mb-3"><h2 className="font-medium">Generated Storage IDs</h2><button className="btn-secondary text-xs" onClick={()=>{setError('');setShowLoc(true)}}>+ Add Location</button></div>
        <DataTable rows={locations} columns={[{key:'warehouse_name',label:'Warehouse'},{key:'site_name',label:'Site'},{key:'type',label:'Level'},{key:'code',label:'Physical ID'},{key:'label',label:'Description'},{key:'parent_code',label:'Parent'}]} /></div>
    </div>
    {showWh && <Modal title="New Warehouse Site" onClose={()=>setShowWh(false)}><div className="space-y-3">
      <label className="block text-sm font-medium">Warehouse Name<input className="input mt-1" value={warehouseForm.name} onChange={e=>setWarehouseForm({...warehouseForm,name:e.target.value})}/></label>
      <label className="block text-sm font-medium">Site Type<select className="input mt-1" value={warehouseForm.site_type} onChange={e=>setWarehouseForm({...warehouseForm,site_type:e.target.value})}>{['Factory','Construction Site','Distribution Center','Project Site','Office','Other'].map(x=><option key={x}>{x}</option>)}</select></label>
      <label className="block text-sm font-medium">Facility / Project / Site Name<input className="input mt-1" value={warehouseForm.site_name} onChange={e=>setWarehouseForm({...warehouseForm,site_name:e.target.value})}/></label>
      <label className="block text-sm font-medium">Physical Address<textarea className="input mt-1" value={warehouseForm.address} onChange={e=>setWarehouseForm({...warehouseForm,address:e.target.value})}/></label>
      <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-medium">Country<select className="input mt-1" value={warehouseForm.country_code} onChange={e=>setWarehouseForm({...warehouseForm,country_code:e.target.value,city_id:''})}><option value="">Select...</option>{reference.countries.map((c:any)=><option key={c.country_code} value={c.country_code}>{c.country_name}</option>)}</select></label><label className="block text-sm font-medium">City<select className="input mt-1" value={warehouseForm.city_id} onChange={e=>setWarehouseForm({...warehouseForm,city_id:Number(e.target.value)})}><option value="">Select...</option>{reference.cities.filter((c:any)=>c.country_code===warehouseForm.country_code).map((c:any)=><option key={c.id} value={c.id}>{c.city_name}</option>)}</select></label><label className="block text-sm font-medium">Region / Province<input className="input mt-1" value={warehouseForm.region_province} onChange={e=>setWarehouseForm({...warehouseForm,region_province:e.target.value})}/></label><label className="block text-sm font-medium">Postal Code<input className="input mt-1" value={warehouseForm.postal_code} onChange={e=>setWarehouseForm({...warehouseForm,postal_code:e.target.value})}/></label></div>
      <p className="text-xs text-slate-500">The warehouse code (for example WH-003) is generated after saving.</p>{error&&<p className="text-sm text-rose-600">{error}</p>}<div className="flex justify-end gap-2"><button className="btn-secondary" onClick={()=>setShowWh(false)}>Cancel</button><button className="btn-primary" onClick={saveWarehouse}>Create Warehouse</button></div>
    </div></Modal>}
    {showLoc && <Modal title="New Physical Storage Location" onClose={()=>setShowLoc(false)}><div className="space-y-3">
      <label className="block text-sm font-medium">Warehouse Site<select className="input mt-1" value={locForm.warehouse_id||''} onChange={e=>setLocForm({...locForm,warehouse_id:Number(e.target.value),parent_id:null})}><option value="">Select...</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.warehouse_code} — {w.name} ({w.site_name})</option>)}</select></label>
      <label className="block text-sm font-medium">Storage Level<select className="input mt-1" value={locForm.type} onChange={e=>setLocForm({...locForm,type:e.target.value,parent_id:null})}>{Object.keys(parentTypes).map(x=><option key={x}>{x}</option>)}</select></label>
      {locForm.type!=='Zone' && <label className="block text-sm font-medium">Parent Location<select className="input mt-1" value={locForm.parent_id||''} onChange={e=>setLocForm({...locForm,parent_id:Number(e.target.value)})}><option value="">Select...</option>{parents.map(p=><option key={p.id} value={p.id}>{p.code}{p.label ? ` — ${p.label}`:''}</option>)}</select></label>}
      <label className="block text-sm font-medium">Description / Physical Label (optional)<input className="input mt-1" placeholder="e.g. Fast-moving electrical items" value={locForm.label||''} onChange={e=>setLocForm({...locForm,label:e.target.value})}/></label>
      {locForm.type==='Bin'&&<div className="grid grid-cols-2 gap-3"><label className="text-sm font-medium">BIN Type<select className="input mt-1" value={locForm.location_type||'Standard BIN'} onChange={e=>setLocForm({...locForm,location_type:e.target.value})}>{['Standard BIN','Pallet Location','Bulk Storage','Tool Storage','Quarantine','Inspection','Rejected Material','Damaged Material','Return Area','Receiving Area','Staging Area','Outdoor Yard','Chemical Storage','Floor Storage','Bay','Tank','Silo'].map(x=><option key={x}>{x}</option>)}</select></label><label className="text-sm font-medium">Status<select className="input mt-1" value={locForm.status||'Available'} onChange={e=>setLocForm({...locForm,status:e.target.value})}>{['Available','Partially Available','Full','Blocked','Under Inspection','Maintenance','Quarantine','Inactive'].map(x=><option key={x}>{x}</option>)}</select></label><label className="text-sm font-medium">Maximum Quantity<input type="number" min="0" className="input mt-1" value={locForm.max_quantity||''} onChange={e=>setLocForm({...locForm,max_quantity:Number(e.target.value)})}/></label><label className="text-sm font-medium">Count Frequency (days)<input type="number" min="1" className="input mt-1" value={locForm.cycle_count_frequency_days||''} onChange={e=>setLocForm({...locForm,cycle_count_frequency_days:Number(e.target.value)})}/></label></div>}
      <p className="rounded bg-blue-50 p-3 text-xs text-blue-800">The physical location ID is generated automatically and remains unique across transactions and reports.</p>{error&&<p className="text-sm text-rose-600">{error}</p>}<div className="flex justify-end gap-2"><button className="btn-secondary" onClick={()=>setShowLoc(false)}>Cancel</button><button className="btn-primary" onClick={saveLocation}>Generate Location ID</button></div>
    </div></Modal>}
  </div>;
}
