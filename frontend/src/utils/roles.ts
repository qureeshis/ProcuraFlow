import { ROLE_LABELS, type Role } from '../types';

export function formatRole(role: string | null | undefined) {
  if (!role) return '—';
  return ROLE_LABELS[role as Role] || role
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
