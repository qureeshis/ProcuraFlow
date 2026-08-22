export const DEFAULT_COMPANY_CURRENCY = 'SAR';
function currencyStorageKey() {
    const tenant = typeof window === 'undefined' ? 'default' : (localStorage.getItem('procuraflow_company_key') || 'default');
    return `procuraflow_currency:${tenant}`;
}
export function getStoredCurrency(defaultValue = DEFAULT_COMPANY_CURRENCY) {
    if (typeof window === 'undefined')
        return defaultValue;
    return (localStorage.getItem(currencyStorageKey()) || defaultValue).toUpperCase();
}
export function setStoredCurrency(currency) {
    if (typeof window === 'undefined')
        return;
    localStorage.setItem(currencyStorageKey(), (currency || DEFAULT_COMPANY_CURRENCY).toUpperCase());
    window.dispatchEvent(new CustomEvent('procuraflow:currency-changed', { detail: getStoredCurrency() }));
}
/** Format money with an English ISO code so every currency remains legible. */
export function formatCurrency(value, currency = getStoredCurrency()) {
    const amount = typeof value === 'number' ? value : Number(value ?? 0);
    const formatted = formatCurrencyAmount(amount);
    return `${String(currency || getStoredCurrency()).toUpperCase()} ${formatted}`;
}
export function formatCurrencyAmount(value) {
    const amount = typeof value === 'number' ? value : Number(value ?? 0);
    return (Number.isFinite(amount) ? amount : 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}
export function currencyFieldLabel(label, currency = getStoredCurrency()) {
    return `${label} (${String(currency).toUpperCase()})`;
}
const CURRENCY_FIELD_NAMES = new Set([
    'value', 'price', 'freight', 'cost', 'amount', 'approval_limit',
    'standard_cost', 'last_purchase_price', 'invoice_total', 'tax_amount',
    'total_landed_cost', 'accepted_value', 'price_variance',
]);
export function isCurrencyField(key) {
    const normalized = String(key || '').toLowerCase();
    return CURRENCY_FIELD_NAMES.has(normalized) || /(_amount|_value|_price|_cost|_spend)$/.test(normalized);
}
