import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import MasterDataPage from './MasterDataPage';
import { currencyFieldLabel, formatCurrency } from '../../utils/currency';
import client from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
const UOM_OPTIONS = [
    ['EA', 'Each'], ['PCS', 'Pieces'], ['PR', 'Pair (legacy)'], ['PAIR', 'Pair'], ['SET', 'Set'], ['BOX', 'Box'], ['BAG', 'Bag'], ['PACK', 'Pack'], ['ROLL', 'Roll'], ['BOTTLE', 'Bottle'], ['CAN', 'Can'], ['DRUM', 'Drum'], ['PALLET', 'Pallet'],
    ['MG', 'Milligram'], ['G', 'Gram'], ['KG', 'Kilogram'], ['MT', 'Metric Ton (1,000 KG)'], ['TON', 'Ton (1,000 KG)'], ['LB', 'Pound'],
    ['ML', 'Millilitre'], ['L', 'Litre'], ['LITER', 'Litre (legacy)'], ['KL', 'Kilolitre (1,000 L)'], ['GAL', 'Gallon'], ['M3', 'Cubic Metre'],
    ['MM', 'Millimetre'], ['CM', 'Centimetre'], ['M', 'Metre'], ['METER', 'Metre (legacy)'], ['KM', 'Kilometre'], ['FT', 'Foot'], ['M2', 'Square Metre'],
].map(([value, label]) => ({ value, label: `${value} — ${label}` }));
const ITEM_TAXONOMY = {
    'Raw Material': ['Cement', 'Fine Aggregate / Sand', 'Coarse Aggregate', 'Admixture', 'Water', 'Steel', 'Reinforcement Steel', 'Steel Mesh', 'Prestressing Steel', 'Fibres', 'Inserts & Cast-in Items'],
    'Production Consumable': ['Abrasive', 'Binding & Tying', 'Curing', 'Grout', 'Release Agent', 'Repair Material', 'Sealant', 'Spacers & Chairs', 'Steel Consumable', 'Welding', 'Formwork Consumable'],
    'PPE': ['Head Protection', 'Eye Protection', 'Face Protection', 'Hearing Protection', 'Hand Protection', 'Foot Protection', 'Respiratory Protection', 'Fall Protection', 'Visibility', 'Protective Clothing'],
    'Tool': ['Hand Tool', 'Power Tool', 'Measuring Tool', 'Cutting Tool', 'Concrete Tool', 'Rigging Tool', 'Welding Tool'],
    'Tools': ['Hand Tools', 'Power Tools', 'Measuring Tools', 'Cutting Tools', 'Concrete Tools'],
    'Equipment': ['Formwork', 'Moulds', 'Batching Plant', 'Concrete Vibrator', 'Lifting & Handling', 'Crane & Hoist', 'Generator', 'Compressor', 'Welding Equipment', 'Workshop Equipment'],
    'Electrical': ['Cable & Wire', 'Temporary Power', 'Plug & Socket', 'Switchgear', 'Motor & Drive', 'Lighting', 'Insulation', 'Fastening', 'Electrical Spare'],
    'Mechanical': ['Bearing', 'Belt & Chain', 'Pump', 'Valve', 'Hydraulic Component', 'Pneumatic Component', 'Machine Spare', 'Fabricated Part'],
    'Fastener': ['Bolt & Nut', 'Washer', 'Anchor', 'Screw', 'Rivet', 'Threaded Rod', 'Clamp'],
    'Maintenance Consumable': ['Lubricant', 'Chemical', 'Cleaning', 'Filter', 'Seal & Gasket', 'Workshop Consumable'],
    'Warehouse Consumable': ['Pallet', 'Packaging', 'Labeling', 'Stationery', 'Storage Bin', 'Material Handling'],
    'QC / Laboratory': ['Concrete Testing', 'Aggregate Testing', 'Cement Testing', 'Dimensional Inspection', 'Calibration Standard', 'Laboratory Consumable', 'Sample Preparation'],
    'Fuel & Lubricants': ['Diesel', 'Petrol', 'Hydraulic Oil', 'Gear Oil', 'Engine Oil', 'Grease', 'Coolant'],
    'Chemicals': ['Construction Chemical', 'Industrial Chemical', 'Water Treatment', 'Cleaning Chemical', 'Coating & Paint'],
    'Consumables': ['Accessories', 'Lubricants', 'Cleaning', 'Packaging', 'General Consumable'],
    'Production': ['Concrete', 'Reinforcement', 'Prestressing', 'Mould Preparation', 'Finishing'],
};
const CATEGORY_OPTIONS = Object.keys(ITEM_TAXONOMY).map(value => ({ value, label: value }));
const subcategoryOptions = (form) => (ITEM_TAXONOMY[String(form.category || '')] || []).map(value => ({ value, label: value }));
export default function ItemsPage() {
    const { user } = useAuth();
    const [taxonomy,setTaxonomy]=useState({categories:[],subcategories:[]});
    const loadTaxonomy=()=>client.get('/masters/item-taxonomy').then(response=>setTaxonomy(response.data));
    useEffect(()=>{loadTaxonomy();},[]);
    const categoryOptions=taxonomy.categories.length?taxonomy.categories.map(row=>({value:row.name,label:row.name})):CATEGORY_OPTIONS;
    const categoryId=(name)=>taxonomy.categories.find(row=>row.name===name)?.id;
    const subcategoryChoices=(form)=>taxonomy.subcategories.length?taxonomy.subcategories.filter(row=>Number(row.category_id)===Number(categoryId(form.category))).map(row=>({value:row.name,label:row.name})):subcategoryOptions(form);
    const defaults={conversion_factor:1,consumable_returnable:'Consumable',high_value_flag:0,always_approval_yn:0,tool_control_yn:0,batch_control_yn:0,expiry_control_yn:0,inspection_required_yn:0,min_stock:0,max_stock:0,reorder_level:0,standard_cost:0};
    return (_jsx(MasterDataPage, { title: "Items", description: "Item catalog with UOM conversion, control flags, stock levels, and cost.", endpoint: "/masters/items", wideForm: true, tableClassName: "item-master-table", initialForm: defaults, canCreate: ['SupplyChainManager', 'WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'].includes(String(user?.role)), canEdit: user?.role === 'SupplyChainManager', canDelete: user?.role === 'SupplyChainManager', transformFieldChange: (field, value, form) => field.key === 'category' ? { ...form, category: value, subcategory: '' } : { ...form, [field.key]: value }, renderFormExtra: (form) => _jsxs("div", { className: "grid gap-4 lg:grid-cols-2", children: [_jsx(TaxonomyControls, { form: form, taxonomy: taxonomy, reload: loadTaxonomy }), _jsx(SimilarityPanel, { form: form })] }), columns: [
            { key: 'item_code', label: 'Code' },
            { key: 'description', label: 'Description' },
            { key: 'category', label: 'Category' },
            { key: 'uom', label: 'UOM' },
            { key: 'consumable_returnable', label: 'Type' },
            { key: 'reorder_level', label: 'Reorder Level' },
            { key: 'available_stock', label: 'Current Available Stock', render: r => `${Number(r.available_stock || 0).toLocaleString()} ${r.uom || ''}` },
            { key: 'standard_cost', label: currencyFieldLabel('Standard Cost'), render: (r) => formatCurrency(r.standard_cost) },
            { key: 'last_purchase_price', label: currencyFieldLabel('Last Purchase Price'), render: (r) => formatCurrency(r.last_purchase_price) },
            { key: 'active_yn', label: 'Operational Status', render: r => r.active_yn === 0 ? `Disabled${r.replacement_item_id ? ' — replacement assigned' : ''}` : 'Active' },
            {
                key: 'flags',
                label: 'Flags',
                render: (r) => [
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
        ], fields: [
            { key: 'item_code', label: 'Item Code (generated on save)', readOnly: true },
            { key: 'description', label: _jsx("span", { className: "item-master-field item-description-field", children: "Item Description" }) },
            {
                key: 'category',
                label: 'Category',
                type: 'select',
                options: categoryOptions,
            },
            {
                key: 'subcategory',
                label: 'Subcategory',
                type: 'select',
                options: subcategoryChoices,
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
        ] }));
}
function TaxonomyControls({form,taxonomy,reload}) { const [category,setCategory]=useState(''),[subcategory,setSubcategory]=useState(''),[message,setMessage]=useState(''); const categoryId=taxonomy.categories.find(row=>row.name===form.category)?.id; async function addCategory(){try{await client.post('/masters/item-taxonomy/categories',{name:category});setMessage(`Category “${category.trim()}” saved.`);setCategory('');await reload();}catch(error){setMessage(error.response?.data?.error||'Unable to save category');}} async function addSubcategory(){try{await client.post('/masters/item-taxonomy/subcategories',{category_id:categoryId,name:subcategory});setMessage(`Subcategory “${subcategory.trim()}” saved under ${form.category}.`);setSubcategory('');await reload();}catch(error){setMessage(error.response?.data?.error||'Unable to save subcategory');}} return _jsxs("div", { className: "rounded-xl border border-indigo-200 bg-indigo-50/40 p-4", children: [_jsx("h3", { className: "font-semibold text-indigo-950", children: "Item Classification Master" }), _jsx("p", { className: "mt-1 text-xs text-slate-600", children: "New classifications are saved immediately and become available to imports and all Item Master forms." }), _jsxs("div", { className: "mt-3 flex gap-2", children: [_jsx("input", { className: "input", value: category, placeholder: "New category", onChange:event=>setCategory(event.target.value) }), _jsx("button", { type: "button", className: "btn-secondary shrink-0", disabled: !category.trim(), onClick:addCategory, children: "Add Category" })] }), _jsxs("div", { className: "mt-2 flex gap-2", children: [_jsx("input", { className: "input", value: subcategory, placeholder: categoryId?`New subcategory under ${form.category}`:"Select a category above first", disabled:!categoryId, onChange:event=>setSubcategory(event.target.value) }), _jsx("button", { type: "button", className: "btn-secondary shrink-0", disabled: !categoryId||!subcategory.trim(), onClick:addSubcategory, children: "Add Subcategory" })] }), message&&_jsx("div", { className: "mt-2 text-xs text-indigo-700", children: message })] }); }
function SimilarityPanel({ form }) { const [matches, setMatches] = useState([]); useEffect(() => { if (String(form.description || '').trim().length < 4) {
    setMatches([]);
    return;
} const timer = setTimeout(() => client.post('/masters/items/similarity', { description: form.description, category: form.category, subcategory: form.subcategory, uom: form.uom, exclude_id: form.id }).then(r => setMatches(r.data)).catch(() => setMatches([])), 350); return () => clearTimeout(timer); }, [form.description, form.category, form.subcategory, form.uom, form.id]); if (!matches.length)
    return _jsx("div", { className: "rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700", children: "No significant description match detected." }); return _jsxs("div", { className: "rounded-xl border border-amber-300 bg-amber-50 p-4", children: [_jsx("h3", { className: "font-semibold text-amber-900", children: "Possible Duplicate Item Found" }), _jsx("p", { className: "mb-3 text-xs text-amber-800", children: "Inspect existing items before creating another record. Category, subcategory and UOM are included in the score when available." }), _jsx("div", { className: "space-y-2", children: matches.slice(0, 5).map(m => _jsxs("div", { className: "flex justify-between rounded-lg bg-white p-3 text-sm", children: [_jsxs("div", { children: [_jsx("strong", { children: m.item_code }), " \u2014 ", m.description, _jsxs("div", { className: "text-xs text-slate-500", children: [m.category || 'No category', " \u00B7 ", m.uom || 'No UOM'] })] }), _jsxs("span", { className: "font-semibold text-amber-800", children: [m.match_type, " \u00B7 ", Math.round(Number(m.score) <= 1 ? Number(m.score) * 100 : Number(m.score)), "%"] })] }, m.id)) })] }); }
