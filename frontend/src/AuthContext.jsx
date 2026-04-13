import React, { createContext, useContext, useState, useEffect } from 'react';
import api from './api';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (token && savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (_) {
        // битый localStorage.user
        localStorage.removeItem('user');
      }
    }

    // Валидация токена и синхронизация флагов mustChangePassword/firstLogin
    if (token) {
      api.get('/auth/me')
        .then((res) => {
          const data = res.data || {};
          let prevParkId;
          try {
            prevParkId = JSON.parse(localStorage.getItem('user') || '{}').parkId;
          } catch {
            prevParkId = undefined;
          }
          const nextUser = {
            id: data.id,
            username: data.username,
            phone: data.phone,
            role: data.role,
            mustChangePassword: data.mustChangePassword || 0,
            firstLogin: data.firstLogin || 0,
            ...(data.parkId != null ? { parkId: data.parkId } : {}),
            ...(data.parkId == null && data.role === 'director' && prevParkId != null ? { parkId: prevParkId } : {}),
          };
          localStorage.setItem('user', JSON.stringify(nextUser));
          if (data.token) localStorage.setItem('token', data.token);
          setUser(nextUser);
        })
        .catch((err) => {
          // Важный момент: не разлогиниваем из-за временной сети/5xx.
          // Разлогин только если сервер явно сказал "нет авторизации".
          const st = err?.response?.status;
          if (st === 401 || st === 403) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            setUser(null);
          }
        })
        .finally(() => setLoading(false));
      return;
    }
    setLoading(false);
  }, []);

  // Keep-alive: пока вкладка открыта, раз в 6 часов обновляем токен (/auth/me отдаёт свежий)
  useEffect(() => {
    if (!user) return;
    const intervalMs = 6 * 60 * 60 * 1000;
    const t = setInterval(() => {
      const token = localStorage.getItem('token');
      if (!token) return;
      api.get('/auth/me')
        .then((res) => {
          const data = res.data || {};
          if (data.token) localStorage.setItem('token', data.token);
          const savedUser = localStorage.getItem('user');
          if (!savedUser) return;
          try {
            const cur = JSON.parse(savedUser);
            const next = {
              ...cur,
              mustChangePassword: data.mustChangePassword || 0,
              firstLogin: data.firstLogin || 0,
              ...(data.parkId != null ? { parkId: data.parkId } : {}),
            };
            localStorage.setItem('user', JSON.stringify(next));
            setUser(next);
          } catch (_) {}
        })
        .catch(() => {});
    }, intervalMs);
    return () => clearInterval(t);
  }, [user?.id]);

  const login = async (username, password) => {
    try {
      const response = await api.post('/auth/login', { username, password });
      const { token, mustChangePassword, firstLogin, ...userData } = response.data;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify({ ...userData, mustChangePassword, firstLogin }));
      setUser({ ...userData, mustChangePassword, firstLogin });
      return { ...userData, mustChangePassword, firstLogin };
    } catch (error) {
      const message = error.response?.data?.error || error.message || 'Ошибка входа. Проверьте backend на localhost:5000.';
      throw new Error(message);
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  const refreshUser = () => {
    const savedUser = localStorage.getItem('user');
    if (savedUser) setUser(JSON.parse(savedUser));
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    // В development режиме при hot reload контекст может быть не готов
    // Возвращаем дефолтное значение вместо выброса ошибки
    if (import.meta.env.DEV) {
      console.warn('useAuth: AuthContext not ready (likely hot reload), returning default values');
      return { user: null, loading: true, login: () => {}, logout: () => {}, refreshUser: () => {} };
    }
    // В production выбрасываем ошибку
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
