import axios from 'axios';
const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
});
client.interceptors.request.use((config) => {
    const token = localStorage.getItem('procuraflow_token');
    if (token && !config.skipAuth)
        config.headers.Authorization = `Bearer ${token}`;
    const companyKey = localStorage.getItem('procuraflow_company_key');
    if (companyKey && !config.skipTenant)
        config.headers['X-Company-Key'] = companyKey;
    return config;
});
client.interceptors.response.use((res) => res, (err) => {
    if (err.response?.status === 401) {
        localStorage.removeItem('procuraflow_token');
        localStorage.removeItem('procuraflow_user');
        window.location.href = '/login';
    }
    return Promise.reject(err);
});
export default client;
