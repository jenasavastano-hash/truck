import axios from 'axios';
import { getResolvedApiRoot } from './utils/apiRoot';

const API_BASE_URL = getResolvedApiRoot();

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Обработка ошибок
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const reqUrl = String(error.config?.url || '');
    // Не рушим UX на /auth/login: там ошибку показывает сама форма
    const isLoginReq = reqUrl.includes('/auth/login');
    if (error.response?.status === 401 && !isLoginReq) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    // 403 с сообщением про истёкший/неверный токен — тоже редирект на логин (перелогиниться)
    if (error.response?.status === 403) {
      const msg = (error.response?.data?.error || '').toLowerCase();
      if (msg.includes('invalid') && msg.includes('token') || msg.includes('expired')) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
