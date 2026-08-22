import axios from 'axios';
const client = axios.create({ baseURL: '/api' });
client.interceptors.request.use((config) => {
    const token = localStorage.getItem('procuraflow_token');
    if (token)
        config.headers.Authorization = `Bearer ${token}`;
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
