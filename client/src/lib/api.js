import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

api.interceptors.response.use(
  res => res,
  err => {
    const onLoginPage = ['/login', '/patient/login'].includes(window.location.pathname);
    if (err.response?.status === 401 && !onLoginPage) {
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
