import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import client from '../api/client';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useBranding } from '../contexts/BrandingContext';

export default function Layout({ children }: { children: React.ReactNode }) {
  const { company, product } = useBranding();
  const location = useLocation();
  useEffect(() => {
    const heartbeat = () => client.post('/dashboard/activity/heartbeat', { page_path: location.pathname }).catch(() => undefined);
    heartbeat();
    const timer = window.setInterval(heartbeat, 15_000);
    return () => window.clearInterval(timer);
  }, [location.pathname]);
  return (
    <div className="app-workspace flex min-h-screen bg-transparent">
      <Sidebar />
      <div className="relative z-[1] flex-1 min-w-0">
        <Topbar />
        <main className="app-main p-6 max-w-7xl mx-auto">{children}</main><footer className="app-footer mx-auto max-w-7xl border-t border-slate-200 px-6 py-4 text-center text-xs text-slate-500">{company.company_name} | Powered by {product.name}</footer>
      </div>
    </div>
  );
}
