import { ROLE_LABELS } from '../types';
export function formatRole(role) {
    if (!role)
        return '—';
    return ROLE_LABELS[role] || role
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
