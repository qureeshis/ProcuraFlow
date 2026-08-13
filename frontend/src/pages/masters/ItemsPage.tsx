import React,{useEffect,useState} from 'react';
import MasterDataPage from './MasterDataPage';
import { currencyFieldLabel, formatCurrency } from '../../utils/currency';
import client from '../../api/client';
import {useAuth} from '../../contexts/AuthContext';

const UOM_OPTIONS = [
  ['EA','Each'], ['PCS','Pieces'], ['PR','Pair (legacy)'], ['PAIR','Pair'], ['SET','Set'], ['BOX','Box'], ['BAG','Bag'], ['PACK','Pack'], ['ROLL','Roll'], ['BOTTLE','Bottle'], ['CAN','Can'], ['DRUM','Drum'], ['PALLET','Pallet'],
  ['MG','Milligram'], ['G','Gram'], ['KG','Kilogram'], ['MT','Metric Ton (1,000 KG)'], ['TON','Ton (1,000 KG)'], ['LB','Pound'],
  ['ML','Millilitre'], ['L','Litre'], ['LITER','Litre (legacy)'], ['KL','Kilolitre (1,000 L)'], ['GAL','Gallon'], ['M3','Cubic Metre'],
  ['MM','Millimetre'], ['CM','Centimetre'], ['M','Metre'], ['METER','Metre (legacy)'], ['KM','Kilometre'], ['FT','Foot'], ['M2','Square Metre'],
].map(([value,label]) => ({ value, label: `${value} — ${label}` }));

export default function ItemsPage() {
  const{user}=useAuth();
  return (
    <MasterDataPage
      title="Items"
      description="Item catalog with UOM conversion, control flags, stock levels, and cost."
      endpoint="/masters/items"
      canCreate={['SupplyChainManager','WarehouseManager','WarehouseSupervisor','Storekeeper'].includes(String(user?.role))}
      canEdit={user?.role==='SupplyChainManager'}
      canDelete={user?.role==='SupplyChainManager'}
      renderFormExtra={(form)=><SimilarityPanel form={form}/>}
      columns={[
        { key: 'item_code', label: 'Code' },
        { key: 'description', label: 'Description' },
        { key: 'category', label: 'Category' },
        { key: 'uom', label: 'UOM' },
        { key: 'consumable_returnable', label: 'Type' },
        { key: 'reorder_level', label: 'Reorder Level' },
        { key:'available_stock',label:'Current Available Stock',render:r=>`${Number(r.available_stock||0).toLocaleString()} ${r.uom||''}` },
        { key: 'standard_cost', label: currencyFieldLabel('Standard Cost'), render: (r) => formatCurrency(r.standard_cost) },
        { key: 'last_purchase_price', label: currencyFieldLabel('Last Purchase Price'), render: (r) => formatCurrency(r.last_purchase_price) },
        {key:'active_yn',label:'Operational Status',render:r=>r.active_yn===0?`Disabled${r.replacement_item_id?' — replacement assigned':''}`:'Active'},
        {
          key: 'flags',
          label: 'Flags',
          render: (r) =>
            [
              r.high_value_flag ? 'High Value' : null,
              r.always_approval_yn ? 'Always Approve' : null,
              r.tool_control_yn ? 'Tool' : null,
              r.batch_control_yn ? 'Batch' : null,
              r.expiry_control_yn ? 'Expiry' : null,
              r.inspection_required_yn ? 'Inspect' : null,
            ]
              .filter(Boolean)
              .join(', ') || '—',
        },
      ]}
      fields={[
        { key: 'item_code', label: 'Item Code (auto-generated)' },
        { key: 'description', label: 'Item Description' },
        {
          key: 'category',
          label: 'Category',
          type: 'select',
          options: [
            { value: 'Raw Material', label: 'Raw Material' },
            { value: 'PPE', label: 'PPE' },
            { value: 'Electrical', label: 'Electrical' },
            { value: 'Mechanical', label: 'Mechanical' },
            { value: 'Tools', label: 'Tools' },
            { value: 'Production', label: 'Production' },
            { value: 'Consumables', label: 'Consumables' },
            { value: 'Equipment', label: 'Equipment' },
            { value: 'Fuel & Lubricants', label: 'Fuel & Lubricants' },
            { value: 'Chemicals', label: 'Chemicals' },
            { value: 'Water & Liquids', label: 'Water & Liquids' },
          ],
        },
        {
          key: 'subcategory',
          label: 'Subcategory',
          type: 'select',
          options: [
            { value: 'Steel', label: 'Steel' },
            { value: 'Cement', label: 'Cement' },
            { value: 'Formwork', label: 'Formwork' },
            { value: 'Hand Protection', label: 'Hand Protection' },
            { value: 'Power Tools', label: 'Power Tools' },
            { value: 'Electrical Parts', label: 'Electrical Parts' },
            { value: 'Mechanical Parts', label: 'Mechanical Parts' },
            { value: 'Production Consumables', label: 'Production Consumables' },
            { value: 'Molds', label: 'Molds' },
            { value: 'Accessories', label: 'Accessories' },
            { value: 'Diesel', label: 'Diesel' },
            { value: 'Lubricants', label: 'Lubricants' },
            { value: 'Industrial Chemicals', label: 'Industrial Chemicals' },
            { value: 'Water Treatment', label: 'Water Treatment' },
          ],
        },
        {
          key: 'uom',
          label: 'Base Unit of Measure',
          type: 'select',
          options: UOM_OPTIONS,
        },
        { key: 'purchase_uom', label: 'Purchase UOM', type: 'select', options: UOM_OPTIONS },
        { key: 'issue_uom', label: 'Issue UOM', type: 'select', options: UOM_OPTIONS },
        { key: 'conversion_factor', label: 'Purchase UOM → Base UOM Conversion Factor', type: 'number' },
        {
          key: 'consumable_returnable',
          label: 'Consumable / Returnable',
          type: 'select',
          options: [
            { value: 'Consumable', label: 'Consumable' },
            { value: 'Returnable', label: 'Returnable' },
          ],
        },
        { key: 'high_value_flag', label: 'High Value Item', type: 'checkbox' },
        { key: 'always_approval_yn', label: 'Always Requires Approval (issue/adjustment)', type: 'checkbox' },
        { key: 'tool_control_yn', label: 'Tool-Controlled (track via Tool Management)', type: 'checkbox' },
        { key: 'batch_control_yn', label: 'Batch-Controlled', type: 'checkbox' },
        { key: 'expiry_control_yn', label: 'Expiry-Controlled', type: 'checkbox' },
        { key: 'inspection_required_yn', label: 'Inspection Required on Receipt', type: 'checkbox' },
        { key: 'min_stock', label: 'Minimum Stock', type: 'number' },
        { key: 'max_stock', label: 'Maximum Stock', type: 'number' },
        { key: 'reorder_level', label: 'Reorder Level', type: 'number' },
        { key: 'standard_cost', label: currencyFieldLabel('Standard Cost'), type: 'number' },
        {key:'duplicate_override_reason',label:'Duplicate Override Reason (required only when continuing after a warning)',createOnly:true},
      ]}
    />
  );
}
function SimilarityPanel({form}:{form:any}){const[matches,setMatches]=useState<any[]>([]);useEffect(()=>{if(String(form.description||'').trim().length<4){setMatches([]);return;}const timer=setTimeout(()=>client.post('/masters/items/similarity',{description:form.description,category:form.category,subcategory:form.subcategory,uom:form.uom,exclude_id:form.id}).then(r=>setMatches(r.data)).catch(()=>setMatches([])),350);return()=>clearTimeout(timer);},[form.description,form.category,form.subcategory,form.uom,form.id]);if(!matches.length)return <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">No significant description match detected.</div>;return <div className="rounded-xl border border-amber-300 bg-amber-50 p-4"><h3 className="font-semibold text-amber-900">Possible Duplicate Item Found</h3><p className="mb-3 text-xs text-amber-800">Inspect existing items before creating another record. Different dimensions and specifications are scored separately.</p><div className="space-y-2">{matches.slice(0,5).map(m=><div key={m.id} className="flex justify-between rounded-lg bg-white p-3 text-sm"><div><strong>{m.item_code}</strong> — {m.description}<div className="text-xs text-slate-500">{m.category||'No category'} · {m.uom||'No UOM'}</div></div><span className="font-semibold text-amber-800">{m.match_type} · {m.score}%</span></div>)}</div></div>}
