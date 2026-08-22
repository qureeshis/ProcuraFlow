import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useBranding } from '../contexts/BrandingContext';
import { CompanyBrand, ProductBrand } from '../components/Branding';
export default function Login() {
    const { login } = useAuth();
    const { company } = useBranding();
    const navigate = useNavigate();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await login(username, password);
            navigate('/');
        }
        catch (err) {
            setError(err?.response?.data?.error || 'Login failed');
        }
        finally {
            setLoading(false);
        }
    }
    return (_jsx("div", { className: "min-h-screen flex items-center justify-center bg-slate-950 px-4", children: _jsx("div", { className: "w-full max-w-md bg-white rounded-2xl overflow-hidden shadow-2xl", children: _jsxs("div", { className: "p-8", children: [_jsxs("div", { className: "mb-7", children: [_jsx("div", { className: "flex justify-center", children: _jsx(ProductBrand, {}) }), _jsx("div", { className: "my-5 border-t border-slate-200" }), _jsx("div", { className: "flex justify-center", children: _jsx(CompanyBrand, { company: company }) }), _jsx("div", { className: "mt-3 text-center text-sm text-slate-500", children: "Sign in to continue" })] }), _jsxs("form", { onSubmit: handleSubmit, className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "text-sm font-medium text-slate-700", children: "Username" }), _jsx("input", { className: "input mt-1", value: username, onChange: (e) => setUsername(e.target.value), autoFocus: true })] }), _jsxs("div", { children: [_jsx("label", { className: "text-sm font-medium text-slate-700", children: "Password" }), _jsx("input", { className: "input mt-1", type: "password", value: password, onChange: (e) => setPassword(e.target.value) })] }), error && _jsx("div", { className: "text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2", children: error }), _jsx("button", { className: "btn-primary w-full", disabled: loading, children: loading ? 'Signing in...' : 'Sign In' })] })] }) }) }));
}
