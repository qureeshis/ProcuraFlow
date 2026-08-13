import React, { useEffect, useState } from 'react';
import client from '../../api/client';
import { currencyFieldLabel, DEFAULT_COMPANY_CURRENCY, setStoredCurrency } from '../../utils/currency';
import CurrencyInput from '../../components/CurrencyInput';
import { useBranding } from '../../contexts/BrandingContext';
import { normalizeCompanyLogo } from '../../utils/companyLogo';
import { CompanyLogo } from '../../components/Branding';

const APPROVAL_ROLES = [
  { role: 'SupplyChainManager', label: 'Supply Chain Manager', key: 'approval_limit_supply_chain_manager' },
  { role: 'PurchaseManager', label: 'Purchase Manager', key: 'approval_limit_purchase_manager' },
  { role: 'PurchaseOfficer', label: 'Purchase Officer', key: 'approval_limit_purchase_officer' },
  { role: 'WarehouseManager', label: 'Warehouse Manager', key: 'approval_limit_warehouse_manager' },
  { role: 'WarehouseSupervisor', label: 'Warehouse Supervisor', key: 'approval_limit_warehouse_supervisor' },
  { role: 'Storekeeper', label: 'Storekeeper', key: 'approval_limit_storekeeper' },
];

export default function SettingsPage() {
  const { refresh: refreshBranding } = useBranding();
  const [company, setCompany] = useState<any>({ name: '', address: '', phone:'', email:'', website:'', registration_number:'', branch_info:'', tax_info: '', currency: DEFAULT_COMPANY_CURRENCY, base_currency:DEFAULT_COMPANY_CURRENCY,country_code:'SA',time_zone:'Asia/Riyadh', financial_year: '', installation_id: '', licensed_company_name: '', license_locked: false, license_locked_at: '', logo_url:'' });
  const [reference,setReference]=useState<any>({countries:[],cities:[],currencies:[]});
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [nextFinancialYear, setNextFinancialYear] = useState('');
  const [message, setMessage] = useState('');
  const [showReset, setShowReset] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [resetPhrase, setResetPhrase] = useState('');
  const [resetAcknowledged, setResetAcknowledged] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const [showAccounts, setShowAccounts] = useState(false);

  useEffect(() => {
    client.get('/settings').then((res) => {
      Object.entries(res.data).forEach(([key, value]) => {
        if (key.startsWith('approval_limit_')) {
          setLimits((prev) => ({ ...prev, [key]: String(value ?? '') }));
        }
      });
    });
    client.get('/settings/company').then((res) => {
      setCompany(res.data || {});
      if (res.data?.currency) setStoredCurrency(res.data.currency);
    });
    client.get('/auth/users').then((res) => setUsers(res.data)).catch(() => undefined);
    client.get('/workforce/reference').then(res=>setReference(res.data)).catch(()=>undefined);
  }, []);

  useEffect(() => {
    if (!logoFile) { setLogoPreview(''); return; }
    const preview = URL.createObjectURL(logoFile);
    setLogoPreview(preview);
    return () => URL.revokeObjectURL(preview);
  }, [logoFile]);

  async function save() {
    setSaving(true); setSaved(false); setSaveError('');
    try {
      await client.put('/settings/company', company);
      await Promise.all(APPROVAL_ROLES.map(({ key }) => client.put(`/settings/${key}`, { value: limits[key] || '0' })));
      if (logoFile && !(await uploadLogo())) return;
      setStoredCurrency(company.currency || DEFAULT_COMPANY_CURRENCY);
      await refreshBranding();
      setSaved(true);
      setMessage('All editable system settings were saved successfully.');
      setTimeout(() => setSaved(false), 3000);
    } catch (error: any) {
      setSaveError(error?.response?.data?.error || 'Unable to save all settings. Please review the fields and try again.');
    } finally { setSaving(false); }
  }

  async function uploadLogo() {
    if (!logoFile) return false;
    const form = new FormData();
    setUploading(true);
    setSaveError('');
    try {
      const normalizedLogo=await normalizeCompanyLogo(logoFile);
      form.append('logo', normalizedLogo);
      // Let the browser add the required multipart boundary.
      const res = await client.post('/settings/company-logo', form);
      setCompany((prev:any) => ({ ...prev, logo_url: res.data.logo_url }));
      setLogoFile(null);
      await refreshBranding();
      setMessage('Company logo was cleaned, cropped, standardized, and applied throughout ProcuraFlow.');
      return true;
    } catch(error:any) {
      setSaveError(error?.response?.data?.error||error?.message||'Unable to prepare and upload the company logo.');
      return false;
    } finally {
      setUploading(false);
    }
  }
  async function downloadBackup() {
    const res = await client.post('/settings/backup', {}, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data); const a = document.createElement('a'); a.href=url; a.download=`procuraflow-backup-${new Date().toISOString().slice(0,10)}.db`; a.click(); URL.revokeObjectURL(url); setMessage('Backup created and downloaded.');
  }
  async function stageRestore() {
    if (!restoreFile || !confirm('Validate and stage this backup for restoration? Existing data is not changed until the backend is restarted with the staged restore path.')) return;
    const body=new FormData(); body.append('backup',restoreFile); const res=await client.post('/settings/restore',body,{headers:{'Content-Type':'multipart/form-data'}}); setMessage(res.data.message);
  }
  async function closeFiscalYear() {
    if (!nextFinancialYear || !confirm('Close the current fiscal year? A database backup will be created before the year changes.')) return;
    const res=await client.post('/settings/fiscal-close',{next_financial_year:nextFinancialYear}); setCompany({...company,financial_year:res.data.financial_year}); setMessage(`Fiscal year changed. Backup: ${res.data.backup_file}`);
  }
  async function unlockUser(id: number) {
    await client.put(`/auth/users/${id}/unlock`);
    const res = await client.get('/auth/users'); setUsers(res.data); setMessage('Account restored. The user must change the password within 7 days.');
  }
  async function factoryReset() {
    if (!resetAcknowledged || resetPhrase !== 'RESET PROCURAFLOW' || !resetPassword) return;
    if (!confirm('FINAL WARNING: Reset all ProcuraFlow company, master, transaction, report, audit, and uploaded-document data?')) return;
    setResetting(true); setResetError('');
    try {
      const res = await client.post('/settings/factory-reset', {
        current_password: resetPassword,
        confirmation_phrase: resetPhrase,
        acknowledge_permanent_deletion: resetAcknowledged,
      });
      setCompany({ name: 'New Company', address: '', phone:'', email:'', website:'', registration_number:'', branch_info:'', tax_info: '', currency: DEFAULT_COMPANY_CURRENCY, financial_year: '', installation_id: '', licensed_company_name: '', license_locked: false, license_locked_at: '', logo_url:'' });
      setStoredCurrency(DEFAULT_COMPANY_CURRENCY);
      setUsers((current) => current.filter((entry) => entry.username === res.data.retained_admin));
      setLimits({}); setShowReset(false); setResetPassword(''); setResetPhrase(''); setResetAcknowledged(false);
      setMessage(`Factory reset completed. Recovery backup: ${res.data.recovery_backup}. Your administrator login was retained.`);
    } catch (error: any) {
      setResetError(error?.response?.data?.error || 'Factory reset failed. No further action should be taken until the database is checked.');
    } finally { setResetting(false); }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">System Settings</h1>
      <p className="text-sm text-slate-500 mb-4">Administration controls for company details, approval thresholds, and role limits.</p>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card p-5 space-y-4">
          {company.license_locked && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><div className="text-sm font-semibold text-emerald-900">Single-company installation active</div><div className="mt-1 text-xs text-emerald-700">This deployment is permanently licensed to <strong>{company.licensed_company_name || company.name}</strong>. Company identity and cross-company restore controls are enforced by the server.</div>{company.installation_id && <div className="mt-2 font-mono text-[10px] text-emerald-600">Installation ID: {company.installation_id}</div>}</div>}
          <div>
            <label className="text-sm font-medium text-slate-700">Company Name</label>
            <input className={`input mt-1 ${company.license_locked ? 'bg-slate-100' : ''}`} readOnly={company.license_locked} value={company.name ?? ''} onChange={(e) => setCompany({ ...company, name: e.target.value })} />
            {company.license_locked && <p className="mt-1 text-xs text-slate-500">Locked by the ProcuraFlow installation license.</p>}
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Address</label>
            <input className="input mt-1" value={company.address ?? ''} onChange={(e) => setCompany({ ...company, address: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium text-slate-700">Telephone<input className="input mt-1" value={company.phone??''} onChange={e=>setCompany({...company,phone:e.target.value})}/></label><label className="text-sm font-medium text-slate-700">Email<input type="email" className="input mt-1" value={company.email??''} onChange={e=>setCompany({...company,email:e.target.value})}/></label><label className="text-sm font-medium text-slate-700">Website<input className="input mt-1" placeholder="https://" value={company.website??''} onChange={e=>setCompany({...company,website:e.target.value})}/></label><label className="text-sm font-medium text-slate-700">Registration Number<input className="input mt-1" value={company.registration_number??''} onChange={e=>setCompany({...company,registration_number:e.target.value})}/></label></div>
          <div><label className="text-sm font-medium text-slate-700">Branch Information</label><input className="input mt-1" value={company.branch_info??''} onChange={e=>setCompany({...company,branch_info:e.target.value})}/></div>
          <div>
            <label className="text-sm font-medium text-slate-700">Tax / Registration</label>
            <input className="input mt-1" value={company.tax_info ?? ''} onChange={(e) => setCompany({ ...company, tax_info: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Base Currency</label>
            <select className="input mt-1" value={company.base_currency ?? company.currency ?? DEFAULT_COMPANY_CURRENCY} onChange={(e) => {
              const nextCurrency = e.target.value;
              setCompany({ ...company, currency: nextCurrency,base_currency:nextCurrency });
              setStoredCurrency(nextCurrency);
            }}>
              {reference.currencies.map((c:any) => <option key={c.currency_code} value={c.currency_code}>{c.currency_code} — {c.currency_name}</option>)}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium text-slate-700">Company Country<select className="input mt-1" value={company.country_code||''} onChange={e=>{const selected=reference.countries.find((c:any)=>c.country_code===e.target.value);setCompany({...company,country_code:e.target.value,base_currency:company.base_currency||selected?.default_currency_code,currency:company.currency||selected?.default_currency_code});}}><option value="">Select country</option>{reference.countries.map((c:any)=><option key={c.country_code} value={c.country_code}>{c.country_name}</option>)}</select></label><label className="text-sm font-medium text-slate-700">Time Zone<input className="input mt-1" value={company.time_zone||''} onChange={e=>setCompany({...company,time_zone:e.target.value})}/></label></div>
          <div className="grid gap-3 sm:grid-cols-3"><label className="text-sm font-medium text-slate-700">City<select className="input mt-1" value={company.city_id||''} onChange={e=>setCompany({...company,city_id:e.target.value?Number(e.target.value):null})}><option value="">Select city</option>{reference.cities.filter((c:any)=>c.country_code===company.country_code).map((c:any)=><option key={c.id} value={c.id}>{c.city_name}</option>)}</select></label><label className="text-sm font-medium text-slate-700">Region / Province<input className="input mt-1" value={company.region_province||''} onChange={e=>setCompany({...company,region_province:e.target.value})}/></label><label className="text-sm font-medium text-slate-700">Postal Code<input className="input mt-1" value={company.postal_code||''} onChange={e=>setCompany({...company,postal_code:e.target.value})}/></label></div>
          <div>
            <label className="text-sm font-medium text-slate-700">Financial Year</label>
            <input className="input mt-1" value={company.financial_year ?? ''} onChange={(e) => setCompany({ ...company, financial_year: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Company Logo (PNG, JPG, or WebP)</label>
            <div className="mt-2 flex min-h-28 items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex h-24 w-44 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                {(logoPreview || company.logo_url)
                  ? <CompanyLogo company={company} src={logoPreview || company.logo_url} size="document" className="max-h-full max-w-full" />
                  : <span className="text-center text-xs text-slate-400">No company logo uploaded</span>}
              </div>
              <div className="min-w-0 text-sm">
                <div className="font-medium text-slate-800">{logoFile ? 'Selected logo preview' : company.logo_url ? 'Current company logo' : 'Company identity'}</div>
                <div className="mt-1 truncate text-xs text-slate-500">{logoFile?.name || (company.logo_url ? 'Active throughout ProcuraFlow' : 'Select an image below')}</div>
              </div>
            </div>
            <input className="input mt-2" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { setSaveError(''); setLogoFile(e.target.files?.[0] || null); }} />
            <p className="text-xs text-slate-500 mt-1">ProcuraFlow automatically removes a plain light background, crops excess whitespace, preserves proportions, and creates a high-resolution transparent PNG for consistent use everywhere.</p>
            <button className="btn-secondary mt-2" onClick={uploadLogo} disabled={!logoFile || uploading || saving}>{uploading ? 'Uploading...' : 'Upload Logo Now'}</button>
          </div>
          <div className="flex items-center gap-3">
            <button className="btn-primary" onClick={save} disabled={saving || uploading}>{saving ? 'Saving all settings...' : 'Save All Settings'}</button>
            {saved && <span className="text-emerald-600 text-sm">All settings saved</span>}
          </div>
          {saveError && <div className="text-sm text-red-700">{saveError}</div>}
        </div>

        <div className="card p-5 space-y-4">
          <h2 className="font-medium text-slate-800">Role-Based Approvals</h2>
          <p className="text-xs text-slate-500">These database values are the default monetary approval limits used by approval workflows. An explicitly assigned employee limit takes precedence.</p>
          {APPROVAL_ROLES.map(({ role, label, key }) => (
            <div key={role}>
              <label className="text-sm font-medium text-slate-700">{currencyFieldLabel(`${label} Approval Limit`, company.currency)}</label>
              <CurrencyInput
                currency={company.currency}
                min="0"
                step="0.01"
                value={limits[key] ?? ''}
                onChange={(e) => setLimits({ ...limits, [key]: e.target.value })}
              />
            </div>
          ))}
        </div>
        <div className="card p-5 space-y-4 lg:col-span-2"><h2 className="font-medium text-slate-800">Backup, Restore & Fiscal Year Close</h2><p className="text-sm text-slate-500">Create a backup before each month-end and before changing the fiscal year. Restores are validated and staged to avoid overwriting a live database.</p><div className="flex flex-wrap gap-2"><button className="btn-secondary" onClick={downloadBackup}>Download Database Backup</button><input className="input max-w-sm" type="file" accept=".db,.sqlite,.sqlite3" onChange={(e)=>setRestoreFile(e.target.files?.[0]||null)}/><button className="btn-secondary" disabled={!restoreFile} onClick={stageRestore}>Validate & Stage Restore</button></div><div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4"><div><label className="text-sm font-medium text-slate-700">Next Fiscal Year</label><input className="input mt-1" placeholder="e.g. FY2027" value={nextFinancialYear} onChange={(e)=>setNextFinancialYear(e.target.value)}/></div><button className="btn-primary" onClick={closeFiscalYear}>Backup & Close Fiscal Year</button></div>{message&&<div className="text-sm text-emerald-600">{message}</div>}</div>
        <div className="card overflow-hidden lg:col-span-2 border border-slate-200 shadow-sm">
          <button type="button" className="w-full text-left bg-gradient-to-r from-slate-900 via-indigo-950 to-indigo-900 px-5 py-5 text-white" onClick={()=>setShowAccounts((open)=>!open)} aria-expanded={showAccounts}>
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-center gap-3"><div className="h-11 w-11 rounded-xl bg-white/10 ring-1 ring-white/20 flex items-center justify-center text-xl">♙</div><div><div className="text-xs uppercase tracking-[0.18em] text-indigo-200">Access Governance</div><h2 className="text-lg font-semibold">User Account Status</h2><p className="text-xs text-slate-300 mt-0.5">Monitor employee access, password lifecycle, and locked accounts</p></div></div>
              <div className="flex items-center gap-5"><div className="grid grid-cols-4 gap-4 text-center"><div><div className="text-xl font-semibold">{users.length}</div><div className="text-[10px] uppercase tracking-wider text-slate-300">Total</div></div><div><div className="text-xl font-semibold text-emerald-300">{users.filter((u)=>u.is_active&&!u.locked_reason).length}</div><div className="text-[10px] uppercase tracking-wider text-slate-300">Active</div></div><div><div className="text-xl font-semibold text-amber-300">{users.filter((u)=>u.locked_reason).length}</div><div className="text-[10px] uppercase tracking-wider text-slate-300">Locked</div></div><div><div className="text-xl font-semibold text-rose-300">{users.filter((u)=>!u.is_active&&!u.locked_reason).length}</div><div className="text-[10px] uppercase tracking-wider text-slate-300">Inactive</div></div></div><span className={`text-xl transition-transform duration-200 ${showAccounts?'rotate-180':''}`}>⌄</span></div>
            </div>
          </button>
          {showAccounts&&<div className="bg-white">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50"><div><div className="text-sm font-medium text-slate-800">Account Directory</div><div className="text-xs text-slate-500">Only authorized administrators can restore access.</div></div><span className="text-xs font-medium text-slate-500">{users.length} account{users.length===1?'':'s'}</span></div>
            <div className="overflow-x-auto"><table className="table"><thead><tr><th>Employee</th><th>Login ID</th><th>Assigned Role</th><th>Password Expiry</th><th>Access Status</th><th>Action</th></tr></thead><tbody>{users.map((user)=>{const locked=Boolean(user.locked_reason);const active=Boolean(user.is_active)&&!locked;return <tr key={user.id} className="hover:bg-indigo-50/40"><td><div className="font-medium text-slate-800">{user.full_name}</div><div className="text-[11px] text-slate-400">Employee account</div></td><td><span className="font-mono text-sm text-indigo-700 bg-indigo-50 px-2 py-1 rounded">{user.username}</span></td><td><span className="text-xs font-medium text-slate-600">{String(user.role).replace(/([a-z])([A-Z])/g,'$1 $2')}</span></td><td><div className="text-sm text-slate-700">{user.password_expires_at||'Not set'}</div></td><td><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${active?'bg-emerald-50 text-emerald-700':locked?'bg-amber-50 text-amber-700':'bg-rose-50 text-rose-700'}`}><span className={`h-1.5 w-1.5 rounded-full ${active?'bg-emerald-500':locked?'bg-amber-500':'bg-rose-500'}`}></span>{active?'Active':locked?'Locked':'Inactive'}</span>{locked&&<div className="text-[11px] text-amber-700 mt-1 max-w-xs">{user.locked_reason}</div>}</td><td>{(locked||!user.is_active)?<button className="btn-secondary" onClick={()=>unlockUser(user.id)}>Restore Access</button>:<span className="text-xs text-slate-400">No action required</span>}</td></tr>})}{users.length===0&&<tr><td colSpan={6} className="text-center py-10 text-slate-400">No user accounts are available.</td></tr>}</tbody></table></div>
          </div>}
        </div>
        <div className="card p-5 space-y-4 lg:col-span-2 border border-red-200 bg-red-50/40">
          <div><h2 className="font-semibold text-red-800">Danger Zone — Reset for a New Company</h2><p className="text-sm text-red-700 mt-1">Creates a recovery backup, then permanently removes all company, employee, supplier, item, procurement, warehouse, inventory, report, audit, notification, and uploaded-document data. Only your Supply Chain Manager login is retained for initial setup.</p></div>
          {!showReset ? <button className="px-4 py-2 rounded bg-red-700 text-white text-sm font-medium hover:bg-red-800" onClick={()=>setShowReset(true)}>Start Secure Factory Reset</button> : <div className="rounded-lg border border-red-300 bg-white p-4 space-y-3 max-w-xl">
            <div><label className="text-sm font-medium text-slate-800">Confirm your current password</label><input className="input mt-1" type="password" autoComplete="current-password" value={resetPassword} onChange={(e)=>setResetPassword(e.target.value)} /></div>
            <div><label className="text-sm font-medium text-slate-800">Type RESET PROCURAFLOW</label><input className="input mt-1 font-mono" value={resetPhrase} onChange={(e)=>setResetPhrase(e.target.value)} /></div>
            <label className="flex gap-2 text-sm text-slate-700"><input type="checkbox" checked={resetAcknowledged} onChange={(e)=>setResetAcknowledged(e.target.checked)} /><span>I understand that current application data and uploaded documents will be permanently deleted after the automatic backup.</span></label>
            {resetError&&<div className="text-sm text-red-700">{resetError}</div>}
            <div className="flex gap-2"><button className="px-4 py-2 rounded bg-red-700 text-white text-sm font-medium disabled:opacity-40" disabled={resetting||!resetPassword||resetPhrase!=='RESET PROCURAFLOW'||!resetAcknowledged} onClick={factoryReset}>{resetting?'Creating backup and resetting...':'Permanently Reset All Data'}</button><button className="btn-secondary" disabled={resetting} onClick={()=>{setShowReset(false);setResetPassword('');setResetPhrase('');setResetAcknowledged(false);setResetError('');}}>Cancel</button></div>
          </div>}
        </div>
      </div>
    </div>
  );
}
