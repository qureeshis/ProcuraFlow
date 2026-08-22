import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext, useEffect, useState } from 'react';
import client from '../api/client';
const AuthContext = createContext(undefined);
export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        const stored = localStorage.getItem('procuraflow_user');
        if (!stored) {
            setLoading(false);
            return;
        }
        setUser(JSON.parse(stored));
        client.get('/auth/me').then(({ data }) => { localStorage.setItem('procuraflow_user', JSON.stringify(data)); setUser(data); }).finally(() => setLoading(false));
    }, []);
    async function login(companyKey, username, password) {
        const normalizedCompanyKey = String(companyKey || '').trim().toLowerCase();
        const { data } = await client.post('/auth/login', { company_key: normalizedCompanyKey, username, password }, { headers: { 'X-Company-Key': normalizedCompanyKey } });
        localStorage.setItem('procuraflow_company_key', normalizedCompanyKey);
        localStorage.setItem('procuraflow_token', data.token);
        localStorage.setItem('procuraflow_user', JSON.stringify(data.user));
        setUser(data.user);
    }
    function logout() {
        client.post('/dashboard/activity/logout').catch(() => undefined).finally(() => {
            localStorage.removeItem('procuraflow_token');
            localStorage.removeItem('procuraflow_user');
            setUser(null);
        });
    }
    return _jsx(AuthContext.Provider, { value: { user, loading, login, logout }, children: children });
}
export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx)
        throw new Error('useAuth must be used within AuthProvider');
    return ctx;
}
