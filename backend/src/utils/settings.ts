import db from '../db';

const DEFAULTS: Record<string, string> = {
  material_issue_approval_threshold: '500',
  approval_limit_purchase_officer: '10000',
  approval_limit_purchase_manager: '20000',
  approval_limit_supply_chain_manager: '50000',
  approval_limit_warehouse_manager: '0',
  approval_limit_warehouse_supervisor: '0',
  approval_limit_storekeeper: '0',
};

export function getSetting(key: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  const configured = String(row?.value ?? '').trim();
  return configured || DEFAULTS[key] || '';
}

export function getSettingNumber(key: string): number {
  return Number(getSetting(key)) || 0;
}

export function setSetting(key: string, value: string) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
