import { NextFunction, Request, Response } from 'express';
import db from '../db';

function normalizedHost(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function requireLicensedHost(req: Request, res: Response, next: NextFunction) {
  const allowed = String(process.env.LICENSED_HOSTNAMES || '')
    .split(',').map(normalizedHost).filter(Boolean);
  if (!allowed.length) return next();
  const forwarded = process.env.TRUST_PROXY==='true' ? String(req.headers['x-forwarded-host'] || '').split(',')[0].trim() : '';
  const actual = normalizedHost(forwarded || req.get('host') || '');
  if (!allowed.includes(actual)) return res.status(403).json({ error: 'This ProcuraFlow installation is not licensed for this host.' });
  next();
}

export function companyLicenseStatus() {
  const company = db.prepare(`SELECT id,name,installation_id,licensed_company_name,license_locked_at
    FROM company WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1`).get() as any;
  return {
    installation_id: company?.installation_id || null,
    licensed_company_name: company?.licensed_company_name || null,
    license_locked: Boolean(company?.license_locked_at),
    license_locked_at: company?.license_locked_at || null,
  };
}
