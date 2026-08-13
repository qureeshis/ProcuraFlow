import React, { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import client from './api/client';
import { setStoredCurrency } from './utils/currency';

const Login=lazy(()=>import('./pages/Login'));const Dashboard=lazy(()=>import('./pages/Dashboard'));const QuickStartPage=lazy(()=>import('./pages/QuickStartPage'));const LiveUserActivityPage=lazy(()=>import('./pages/LiveUserActivityPage'));const HelpPage=lazy(()=>import('./pages/HelpPage'));
const DepartmentsPage=lazy(()=>import('./pages/masters/DepartmentsPage'));const EmployeesPage=lazy(()=>import('./pages/masters/EmployeesPage'));const SuppliersPage=lazy(()=>import('./pages/masters/SuppliersPage'));const ItemsPage=lazy(()=>import('./pages/masters/ItemsPage'));const WarehousesPage=lazy(()=>import('./pages/masters/WarehousesPage'));const SettingsPage=lazy(()=>import('./pages/masters/SettingsPage'));const ImportDataPage=lazy(()=>import('./pages/masters/ImportDataPage'));
const PRPage=lazy(()=>import('./pages/procurement/PRPage'));const RFQPage=lazy(()=>import('./pages/procurement/RFQPage'));const POPage=lazy(()=>import('./pages/procurement/POPage'));const InvoicesPage=lazy(()=>import('./pages/procurement/InvoicesPage'));
const GRNPage=lazy(()=>import('./pages/warehouse/GRNPage'));const MaterialIssuePage=lazy(()=>import('./pages/warehouse/MaterialIssuePage'));const ReturnsPage=lazy(()=>import('./pages/warehouse/ReturnsPage'));const TransfersPage=lazy(()=>import('./pages/warehouse/TransfersPage'));const BinTransfersPage=lazy(()=>import('./pages/warehouse/BinTransfersPage'));const AdjustmentsPage=lazy(()=>import('./pages/warehouse/AdjustmentsPage'));
const StockPage=lazy(()=>import('./pages/inventory/StockPage'));const ValuationPage=lazy(()=>import('./pages/inventory/ValuationPage'));const ExpiryPage=lazy(()=>import('./pages/inventory/ExpiryPage'));const ABCPage=lazy(()=>import('./pages/inventory/ABCPage'));const DeadStockPage=lazy(()=>import('./pages/inventory/DeadStockPage'));const CycleCountPage=lazy(()=>import('./pages/inventory/CycleCountPage'));
const ToolsPage=lazy(()=>import('./pages/advanced/ToolsPage'));const VendorScorecardPage=lazy(()=>import('./pages/advanced/VendorScorecardPage'));const ReportsPage=lazy(()=>import('./pages/reports/ReportsPage'));
const WorkCalendarPage=lazy(()=>import('./pages/WorkCalendarPage'));const WorkforceSetupPage=lazy(()=>import('./pages/WorkforceSetupPage'));
const DelegatedAuthorityPage=lazy(()=>import('./pages/DelegatedAuthorityPage'));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-400">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

function RoleRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles: string[] }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-400">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!allowedRoles.includes(user.role)) {
    return <div className="min-h-screen flex items-center justify-center text-slate-600">Access denied for this role.</div>;
  }
  return <Layout>{children}</Layout>;
}

export default function App() {
  const { user, loading } = useAuth();

  useEffect(() => {
    // The company endpoint is protected. Requesting it while the login screen
    // is displayed triggers the global 401 redirect and reloads that screen.
    if (loading || !user) return;

    client.get('/settings/company').then((res) => {
      if (res.data?.currency) setStoredCurrency(res.data.currency);
    }).catch(() => undefined);
  }, [loading, user]);

  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-500">Loading ProcuraFlow workspace...</div>}><Routes>
      <Route path="/login" element={<Login />} />

      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/quick-start" element={<ProtectedRoute><QuickStartPage /></ProtectedRoute>} />
      <Route path="/live-user-activity" element={<RoleRoute allowedRoles={['SupplyChainManager']}><LiveUserActivityPage /></RoleRoute>} />
      <Route path="/help" element={<ProtectedRoute><HelpPage /></ProtectedRoute>} />

      <Route path="/masters/departments" element={<RoleRoute allowedRoles={['SupplyChainManager','PurchaseManager','WarehouseManager']}><DepartmentsPage /></RoleRoute>} />
      <Route path="/masters/employees" element={<RoleRoute allowedRoles={['SupplyChainManager','PurchaseManager','WarehouseManager']}><EmployeesPage /></RoleRoute>} />
      <Route path="/masters/suppliers" element={<RoleRoute allowedRoles={['SupplyChainManager','PurchaseManager','PurchaseOfficer']}><SuppliersPage /></RoleRoute>} />
      <Route path="/masters/items" element={<RoleRoute allowedRoles={['SupplyChainManager','PurchaseManager','PurchaseOfficer','WarehouseManager','WarehouseSupervisor','Storekeeper']}><ItemsPage /></RoleRoute>} />
      <Route path="/masters/warehouses" element={<RoleRoute allowedRoles={['SupplyChainManager','WarehouseManager','WarehouseSupervisor']}><WarehousesPage /></RoleRoute>} />
      <Route path="/masters/settings" element={<RoleRoute allowedRoles={['SupplyChainManager']}><SettingsPage /></RoleRoute>} />
      <Route path="/masters/import-data" element={<RoleRoute allowedRoles={['SupplyChainManager']}><ImportDataPage /></RoleRoute>} />
      <Route path="/employees/workforce-setup" element={<RoleRoute allowedRoles={['SupplyChainManager']}><WorkforceSetupPage /></RoleRoute>} />
      <Route path="/employees/calendar-management" element={<RoleRoute allowedRoles={['SupplyChainManager']}><WorkCalendarPage admin /></RoleRoute>} />
      <Route path="/delegated-authority" element={<RoleRoute allowedRoles={['SupplyChainManager']}><DelegatedAuthorityPage /></RoleRoute>} />

      <Route path="/procurement/pr" element={<RoleRoute allowedRoles={['SupplyChainManager','PurchaseManager','PurchaseOfficer','WarehouseManager','WarehouseSupervisor','Storekeeper']}><PRPage /></RoleRoute>} />
      <Route path="/procurement/rfq" element={<RoleRoute allowedRoles={['SupplyChainManager','PurchaseManager','PurchaseOfficer']}><RFQPage /></RoleRoute>} />
      <Route path="/procurement/po" element={<RoleRoute allowedRoles={['SupplyChainManager','PurchaseManager','PurchaseOfficer']}><POPage /></RoleRoute>} />
      <Route path="/procurement/invoices" element={<RoleRoute allowedRoles={['SupplyChainManager','PurchaseManager','PurchaseOfficer']}><InvoicesPage /></RoleRoute>} />
      <Route path="/procurement/work-calendar" element={<RoleRoute allowedRoles={['SupplyChainManager','PurchaseManager','PurchaseOfficer']}><WorkCalendarPage scope="Procurement" /></RoleRoute>} />

      <Route path="/warehouse/grn" element={<RoleRoute allowedRoles={['SupplyChainManager','WarehouseManager','WarehouseSupervisor','Storekeeper']}><GRNPage /></RoleRoute>} />
      <Route path="/warehouse/pr" element={<RoleRoute allowedRoles={['SupplyChainManager','WarehouseManager','WarehouseSupervisor','Storekeeper']}><PRPage /></RoleRoute>} />
      <Route path="/warehouse/issue" element={<RoleRoute allowedRoles={['SupplyChainManager','WarehouseManager','WarehouseSupervisor','Storekeeper']}><MaterialIssuePage /></RoleRoute>} />
      <Route path="/warehouse/returns" element={<RoleRoute allowedRoles={['SupplyChainManager','WarehouseManager','WarehouseSupervisor','Storekeeper']}><ReturnsPage /></RoleRoute>} />
      <Route path="/warehouse/transfers" element={<RoleRoute allowedRoles={['SupplyChainManager','WarehouseManager','WarehouseSupervisor']}><TransfersPage /></RoleRoute>} />
      <Route path="/warehouse/bin-transfers" element={<RoleRoute allowedRoles={['SupplyChainManager','WarehouseManager','WarehouseSupervisor','Storekeeper']}><BinTransfersPage /></RoleRoute>} />
      <Route path="/warehouse/adjustments" element={<RoleRoute allowedRoles={['SupplyChainManager','WarehouseManager','WarehouseSupervisor']}><AdjustmentsPage /></RoleRoute>} />
      <Route path="/warehouse/work-calendar" element={<RoleRoute allowedRoles={['SupplyChainManager','WarehouseManager','WarehouseSupervisor','Storekeeper']}><WorkCalendarPage scope="Warehouse" /></RoleRoute>} />

      <Route path="/inventory/stock" element={<RoleRoute allowedRoles={['SupplyChainManager','WarehouseManager','WarehouseSupervisor','Storekeeper']}><StockPage /></RoleRoute>} />
      <Route path="/inventory/valuation" element={<RoleRoute allowedRoles={['SupplyChainManager','WarehouseManager','WarehouseSupervisor','Storekeeper']}><ValuationPage /></RoleRoute>} />
      <Route path="/inventory/expiry" element={<RoleRoute allowedRoles={['SupplyChainManager','WarehouseManager','WarehouseSupervisor','Storekeeper']}><ExpiryPage /></RoleRoute>} />
      <Route path="/inventory/abc" element={<RoleRoute allowedRoles={['SupplyChainManager','WarehouseManager','WarehouseSupervisor','Storekeeper']}><ABCPage /></RoleRoute>} />
      <Route path="/inventory/dead-stock" element={<RoleRoute allowedRoles={['SupplyChainManager','WarehouseManager','WarehouseSupervisor','Storekeeper']}><DeadStockPage /></RoleRoute>} />
      <Route path="/inventory/cycle-count" element={<RoleRoute allowedRoles={['SupplyChainManager','WarehouseManager','WarehouseSupervisor','Storekeeper']}><CycleCountPage /></RoleRoute>} />

      <Route path="/advanced/tools" element={<RoleRoute allowedRoles={['SupplyChainManager','WarehouseManager','WarehouseSupervisor','Storekeeper']}><ToolsPage /></RoleRoute>} />
      <Route path="/advanced/vendor-scorecard" element={<RoleRoute allowedRoles={['SupplyChainManager','PurchaseManager']}><VendorScorecardPage /></RoleRoute>} />

      <Route path="/reports" element={<ProtectedRoute><ReportsPage /></ProtectedRoute>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></Suspense>
  );
}
