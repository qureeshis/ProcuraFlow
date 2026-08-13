export type Role =
  | 'SupplyChainManager'
  | 'PurchaseManager'
  | 'PurchaseOfficer'
  | 'WarehouseManager'
  | 'WarehouseSupervisor'
  | 'Storekeeper'
  | 'Helper';
  

export interface User {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  warehouse_id?: number | null;
  warehouse_ids?: number[];
  warehouse_name?: string | null;
  permission_keys?: string[];
  must_change_password?: boolean;
  password_expires_at?: string;
  password_days_remaining?: number | null;
}

export const ROLE_LABELS: Record<Role, string> = {
  SupplyChainManager: 'Supply Chain Manager (Admin)',
  PurchaseManager: 'Purchase Manager',
  PurchaseOfficer: 'Purchase Officer',
  WarehouseManager: 'Warehouse Manager',
  WarehouseSupervisor: 'Warehouse Supervisor',
  Storekeeper: 'Storekeeper',
  Helper: 'Helper',
};

export interface Column<T> {
  key: keyof T | string;
  label: string;
  render?: (row: T) => React.ReactNode;
}
