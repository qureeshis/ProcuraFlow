import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useBranding } from '../contexts/BrandingContext';
import { CompanyBrand, ProductBrand } from './Branding';

const ROLE_VISIBILITY: Record<string, string[]> = {
  SupplyChainManager: ['overview', 'master data', 'procurement', 'warehouse', 'inventory', 'advanced', 'reports', 'help'],
  PurchaseManager: ['overview', 'master data', 'procurement', 'reports', 'help'],
  PurchaseOfficer: ['overview', 'procurement', 'reports', 'help'],
  WarehouseManager: ['overview', 'warehouse', 'inventory', 'reports', 'help'],
  WarehouseSupervisor: ['overview', 'warehouse', 'inventory', 'reports', 'help'],
  Storekeeper: ['overview', 'warehouse', 'inventory', 'reports', 'help'],
};

// Keep navigation visibility aligned with the roles allowed by each route.
// Server-side RBAC remains the authority; this prevents confusing links.
const ITEM_ROLES: Record<string, string[]> = {
  '/': ['SupplyChainManager', 'PurchaseManager', 'PurchaseOfficer', 'WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'],
  '/quick-start': ['SupplyChainManager', 'PurchaseManager', 'PurchaseOfficer', 'WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'],
  '/live-user-activity': ['SupplyChainManager'],
  '/help?department=Getting%20Started': ['SupplyChainManager', 'PurchaseManager', 'PurchaseOfficer', 'WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'],
  '/help?department=Procurement': ['SupplyChainManager', 'PurchaseManager', 'PurchaseOfficer', 'WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'],
  '/help?department=Warehouse': ['SupplyChainManager', 'PurchaseManager', 'PurchaseOfficer', 'WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'],
  '/help?department=Inventory': ['SupplyChainManager', 'PurchaseManager', 'PurchaseOfficer', 'WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'],
  '/help?department=Master%20Data%20%26%20Administration': ['SupplyChainManager', 'PurchaseManager', 'PurchaseOfficer', 'WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'],
  '/help?department=Reports': ['SupplyChainManager', 'PurchaseManager', 'PurchaseOfficer', 'WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'],
  '/masters/departments': ['SupplyChainManager', 'PurchaseManager', 'WarehouseManager'],
  '/masters/employees': ['SupplyChainManager', 'PurchaseManager', 'WarehouseManager'],
  '/masters/suppliers': ['SupplyChainManager', 'PurchaseManager', 'PurchaseOfficer'],
  '/masters/items': ['SupplyChainManager','PurchaseManager','PurchaseOfficer','WarehouseManager','WarehouseSupervisor','Storekeeper'],
  '/masters/warehouses': ['SupplyChainManager', 'WarehouseManager', 'WarehouseSupervisor'],
  '/masters/settings': ['SupplyChainManager'],
  '/masters/import-data': ['SupplyChainManager'],
  '/employees/workforce-setup':['SupplyChainManager'],'/employees/calendar-management':['SupplyChainManager'],
  '/delegated-authority':['SupplyChainManager'],
  '/procurement/pr': ['SupplyChainManager', 'PurchaseManager', 'PurchaseOfficer'],
  '/procurement/rfq': ['SupplyChainManager', 'PurchaseManager', 'PurchaseOfficer'],
  '/procurement/po': ['SupplyChainManager', 'PurchaseManager', 'PurchaseOfficer'],
  '/procurement/invoices': ['SupplyChainManager', 'PurchaseManager', 'PurchaseOfficer'],
  '/procurement/work-calendar':['SupplyChainManager','PurchaseManager','PurchaseOfficer'],
  '/warehouse/grn': ['SupplyChainManager', 'WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'],
  '/warehouse/pr': ['SupplyChainManager', 'WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'],
  '/warehouse/issue': ['SupplyChainManager', 'WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'],
  '/warehouse/returns': ['SupplyChainManager', 'WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'],
  '/warehouse/transfers': ['SupplyChainManager', 'WarehouseManager', 'WarehouseSupervisor'],
  '/warehouse/bin-transfers': ['SupplyChainManager', 'WarehouseManager', 'WarehouseSupervisor','Storekeeper'],
  '/warehouse/adjustments': ['SupplyChainManager', 'WarehouseManager', 'WarehouseSupervisor'],
  '/warehouse/work-calendar':['SupplyChainManager','WarehouseManager','WarehouseSupervisor','Storekeeper'],
  '/inventory/stock': ['SupplyChainManager', 'WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'],
  '/inventory/valuation': ['SupplyChainManager', 'WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'],
  '/inventory/expiry': ['SupplyChainManager', 'WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'],
  '/inventory/abc': ['SupplyChainManager', 'WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'],
  '/inventory/dead-stock': ['SupplyChainManager', 'WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'],
  '/inventory/cycle-count': ['SupplyChainManager', 'WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'],
  '/advanced/tools': ['SupplyChainManager', 'WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'],
  '/advanced/vendor-scorecard': ['SupplyChainManager', 'PurchaseManager'],
  '/reports': ['SupplyChainManager', 'PurchaseManager', 'PurchaseOfficer', 'WarehouseManager', 'WarehouseSupervisor', 'Storekeeper'],
};
const PATH_PERMISSION:Record<string,string>={'/live-user-activity':'task.live_activity','/masters/employees':'task.employees','/masters/suppliers':'task.suppliers','/masters/items':'task.items','/masters/warehouses':'task.warehouses','/masters/settings':'task.settings','/masters/import-data':'task.import_data','/procurement/pr':'task.pr','/warehouse/pr':'task.pr','/procurement/rfq':'task.rfq','/procurement/po':'task.po','/procurement/invoices':'task.invoices','/warehouse/grn':'task.grn','/warehouse/issue':'task.material_issue','/warehouse/returns':'task.returns','/warehouse/transfers':'task.transfers','/warehouse/bin-transfers':'task.transfers','/warehouse/adjustments':'task.adjustments','/inventory/stock':'task.inventory','/inventory/valuation':'task.inventory','/inventory/expiry':'task.inventory','/inventory/abc':'task.inventory','/inventory/dead-stock':'task.inventory','/inventory/cycle-count':'task.cycle_count','/advanced/tools':'task.tools','/advanced/vendor-scorecard':'task.vendor_scorecard'};

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [{ to: '/', label: 'Dashboard' }, { to: '/live-user-activity', label: 'Live User Activity' }, { to: '/quick-start', label: 'Quick Start Guide' }],
  },
  {
    label: 'Master Data',
    items: [
      { to: '/masters/departments', label: 'Departments' },
      { to: '/masters/suppliers', label: 'Suppliers' },
      { to: '/masters/items', label: 'Items' },
      { to: '/masters/warehouses', label: 'Warehouses & Locations' },
      { to: '/masters/settings', label: 'System Settings' },
      { to: '/masters/import-data', label: 'Import Data' },
    ],
  },
  { label: 'Employees', items: [
      { to: '/masters/employees', label: 'Employee Master' },
      { to: '/employees/workforce-setup', label: 'Shift, Availability & Holiday Setup' },
      { to: '/employees/calendar-management', label: 'Calendar Management' },
      { to: '/delegated-authority', label: 'Delegated Authority' },
      { to: '/reports?report=employee-workday', label: 'Calendar Reports' },
    ],
  },
  {
    label: 'Procurement',
    items: [
      { to: '/procurement/pr', label: 'Purchase Requisitions' },
      { to: '/procurement/rfq', label: 'RFQ & Quotations' },
      { to: '/procurement/po', label: 'Purchase Orders' },
      { to: '/procurement/invoices', label: 'Invoices & 3-Way Match' },
      { to: '/procurement/work-calendar', label: 'Workday Calendar' },
    ],
  },
  {
    label: 'Warehouse',
    items: [
      { to: '/warehouse/pr', label: 'Purchase Requisitions' },
      { to: '/warehouse/grn', label: 'Goods Receipt (GRN)' },
      { to: '/warehouse/issue', label: 'Material Issue' },
      { to: '/warehouse/returns', label: 'Returns' },
      { to: '/warehouse/transfers', label: 'Transfers' },
      { to: '/warehouse/bin-transfers', label: 'BIN Transfers' },
      { to: '/warehouse/adjustments', label: 'Stock Adjustments' },
      { to: '/warehouse/work-calendar', label: 'Workday Calendar' },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { to: '/inventory/stock', label: 'Real-Time Stock' },
      { to: '/inventory/valuation', label: 'FIFO Valuation' },
      { to: '/inventory/expiry', label: 'Expiry Tracking' },
      { to: '/inventory/abc', label: 'ABC Classification' },
      { to: '/inventory/dead-stock', label: 'Dead Stock' },
      { to: '/inventory/cycle-count', label: 'Cycle Count' },
    ],
  },
  {
    label: 'Advanced',
    items: [
      { to: '/advanced/tools', label: 'Tool Management' },
      { to: '/advanced/vendor-scorecard', label: 'Vendor Scorecard' },
    ],
  },
  {
    label: 'Reports',
    items: [{ to: '/reports', label: 'Reports' }],
  },
  {
    label: 'Help',
    items: [
      { to: '/help?department=Getting%20Started', label: 'Getting Started' },
      { to: '/help?department=Procurement', label: 'Procurement Guide' },
      { to: '/help?department=Warehouse', label: 'Warehouse Guide' },
      { to: '/help?department=Inventory', label: 'Inventory Guide' },
      { to: '/help?department=Master%20Data%20%26%20Administration', label: 'Master Data & Admin' },
      { to: '/help?department=Reports', label: 'Reports Guide' },
    ],
  },
];

export default function Sidebar() {
  const { company } = useBranding();
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  const visibleGroups = (user?.role ? ROLE_VISIBILITY[user.role] : []) as string[];
  const canSee = (to: string) => {if(!user||!(ITEM_ROLES[to]||[]).includes(user.role))return false;const required=to==='/masters/items'?undefined:PATH_PERMISSION[to];if(required&&user.permission_keys&&!user.permission_keys.includes(required))return false;if(to==='/reports'&&user.permission_keys&&!user.permission_keys.some(key=>key.startsWith('report.')))return false;return true;};
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(['Overview']));

  // Always reveal the section containing the page being viewed. Other sections
  // remain collapsed until the user chooses to open them.
  useEffect(() => {
    const activeGroup = NAV_GROUPS.find((group) =>
      group.items.some((item) => item.to === '/' ? pathname === '/' : pathname.startsWith(item.to.split('?')[0]))
    );
    if (activeGroup) {
      setOpenGroups(new Set([activeGroup.label]));
    }
  }, [pathname]);

  function toggleGroup(label: string) {
    setOpenGroups((current) => {
      return current.has(label) ? new Set() : new Set([label]);
    });
  }

  return (
    <aside className="app-sidebar w-64 bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-900 text-slate-300 h-screen sticky top-0 overflow-y-auto flex flex-col flex-shrink-0 shadow-2xl shadow-indigo-950/30">
      <div className="px-5 py-5 border-b border-white/10">
        <ProductBrand compact inverse />
      </div>
      <nav className="py-3 flex-1">
        {NAV_GROUPS.filter((group) => visibleGroups.includes(group.label.toLowerCase()) || group.items.some((item) => canSee(item.to))).map((group) => {
          const items = group.items.filter((item) => canSee(item.to));
          if (items.length === 0) return null;
          const isOpen = openGroups.has(group.label);
          const hasActiveItem = items.some((item) => item.to === '/' ? pathname === '/' : pathname.startsWith(item.to.split('?')[0]));

          return (
          <div key={group.label} className={`mb-1 px-2 rounded-xl transition-colors ${isOpen ? 'bg-cyan-400/5' : ''}`}>
            <button
              type="button"
              onClick={() => toggleGroup(group.label)}
              aria-expanded={isOpen}
              className={`sidebar-group-button flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                isOpen ? 'text-cyan-100 bg-gradient-to-r from-indigo-600/80 to-cyan-600/50 ring-1 ring-cyan-300/20 shadow-md shadow-indigo-950/30' : hasActiveItem ? 'text-indigo-200 bg-indigo-500/10' : 'text-slate-500 hover:bg-white/5 hover:text-slate-300'
              }`}
            >
              {group.label}
              <svg className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.09 1.04l-4.25 4.5a.75.75 0 0 1-1.09 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
              </svg>
            </button>
            {isOpen && (
              <div className="mb-2 overflow-hidden">
                {items.map((item: any) => (<React.Fragment key={item.to}>
                  {item.section && <div className="px-4 pl-6 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{item.section}</div>}
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      `sidebar-link block rounded-md px-4 py-2 pl-6 text-sm transition-colors ${
                        (item.to.includes('?') ? `${pathname}${search}` === item.to : isActive && !search) ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold border-l-4 border-cyan-200 shadow-sm' : 'text-slate-300 border-l-4 border-transparent hover:bg-cyan-400/10 hover:border-cyan-500/50 hover:text-cyan-50'
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                </React.Fragment>))}
              </div>
            )}
          </div>
          );
        })}
      </nav>
      <div className="sticky bottom-0 border-t border-white/10 bg-slate-950/90 p-4 backdrop-blur"><div className="mb-2 text-[9px] uppercase tracking-[.2em] text-slate-500">Operating Organization</div><CompanyBrand company={company} compact inverse /></div>
    </aside>
  );
}
