import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext, useEffect, useState } from 'react';
import client from '../api/client';
import { PRODUCT_BRAND } from '../config/brand';
const fallback = { company_name: 'Company Name', logo_url: null };
const BrandingContext = createContext({ company: fallback, product: PRODUCT_BRAND, refresh: async () => { } });
export function BrandingProvider({ children }) {
    const [company, setCompany] = useState(fallback);
    async function refresh() { try {
        const { data } = await client.get('/settings/branding');
        setCompany(data);
        document.title = `${PRODUCT_BRAND.name} | ${data.company_name || PRODUCT_BRAND.description}`;
    }
    catch {
        document.title = `${PRODUCT_BRAND.name} | Supply Chain Management`;
    } }
    useEffect(() => { refresh(); }, []);
    return _jsx(BrandingContext.Provider, { value: { company, product: PRODUCT_BRAND, refresh }, children: children });
}
export const useBranding = () => useContext(BrandingContext);
