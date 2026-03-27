import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

api.interceptors.response.use(
  res => res,
  err => {
    const path = window.location.pathname;
    const isPublicPage = path.startsWith('/pay/') ||
      path === '/login' ||
      path === '/customer/login' ||
      path === '/customer/forgot-password' ||
      path === '/customer/set-password';
    if (err.response?.status === 401 && !isPublicPage) {
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
