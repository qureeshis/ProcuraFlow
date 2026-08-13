import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ROLE_LABELS } from '../types';
import Modal from './Modal';
import client from '../api/client';
import { useBranding } from '../contexts/BrandingContext';
import { CompanyLogo } from './Branding';

export default function Topbar() {
  const { company, product } = useBranding();
  const { user, logout } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [passwords, setPasswords] = useState({ current_password: '', new_password: '' });
  const [error, setError] = useState('');
  async function changePassword() {
    try { await client.put('/auth/change-password', passwords); alert('Password changed. Please log in again.'); logout(); }
    catch (e: any) { setError(e?.response?.data?.error || 'Password change failed'); }
  }
  return (
    <header className="app-topbar h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 sticky top-0 z-10">
      <div className="flex min-w-0 items-center gap-2"><CompanyLogo company={company} size="nav"/><div className="truncate text-sm"><span className="font-semibold text-slate-800">{company.company_name}</span><span className="mx-2 text-slate-300">|</span><span className="text-slate-500">{product.name}</span></div></div>
      <div className="flex items-center gap-4">
        {(user?.must_change_password || (user?.password_days_remaining != null && user.password_days_remaining <= 7)) && <button className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700" onClick={() => setShowPassword(true)}>{user.must_change_password ? 'Change default password' : `Password expires in ${user.password_days_remaining} days`}</button>}
        <div className="text-right">
          <div className="text-sm font-medium text-slate-800">{user?.full_name}</div>
          <div className="text-xs text-slate-500">{user ? ROLE_LABELS[user.role] : ''}</div>
        </div>
        <div className="w-9 h-9 rounded-full bg-brand-600 text-white flex items-center justify-center font-semibold text-sm">
          {user?.full_name?.charAt(0)}
        </div>
        <button onClick={logout} className="btn-secondary text-xs px-3 py-1.5">
          Logout
        </button>
      </div>
      {showPassword && <Modal title="Change Password" onClose={() => setShowPassword(false)}><div className="space-y-3"><div><label className="text-sm font-medium">Current Password</label><input className="input mt-1" type="password" placeholder="Enter current password" value={passwords.current_password} onChange={(e)=>setPasswords({...passwords,current_password:e.target.value})}/></div><div><label className="text-sm font-medium">New Password</label><input className="input mt-1" type="password" placeholder="Minimum 8 characters" value={passwords.new_password} onChange={(e)=>setPasswords({...passwords,new_password:e.target.value})}/></div>{error && <div className="text-sm text-rose-600">{error}</div>}<div className="flex justify-end"><button className="btn-primary" onClick={changePassword}>Change Password</button></div></div></Modal>}
    </header>
  );
}
