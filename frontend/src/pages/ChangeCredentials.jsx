import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { KeyRound, Eye, EyeOff, CheckCircle2, XCircle } from 'lucide-react';
import api from '../api';
import { useAuth } from '../AuthContext';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../hooks/useToast';

export default function ChangeCredentials() {
  const { user, login, logout } = useAuth();
  const navigate = useNavigate();
  const [newUsername, setNewUsername] = useState(user?.username || '');
  const [newPassword, setNewPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.put('/auth/me/credentials', {
        currentPassword,
        newUsername,
        newPassword: newPassword || undefined
      });
      showToast('✅ Данные успешно изменены! Выполняю вход...', 'success');

      // Автоматический повторный вход
      try {
        const loginUsername = newUsername || user?.username;
        const loginPassword = newPassword || currentPassword;

        if (loginUsername && loginPassword) {
          await login(loginUsername, loginPassword);
          setTimeout(() => {
            if (user?.role === 'admin') navigate('/admin');
            else if (user?.role === 'manager') navigate('/manager');
            else if (user?.role === 'driver') navigate('/driver');
            else navigate('/home');
          }, 1000);
          return;
        }

        logout();
        navigate('/login');
      } catch (reloginErr) {
        console.warn('Auto re-login failed:', reloginErr);
        logout();
        showToast('Данные изменены. Пожалуйста, войдите снова.', 'info');
        setTimeout(() => navigate('/login'), 2000);
      }
    } catch (err) {
      const errorMsg = err?.response?.data?.error || err.message || 'Ошибка';
      setError(errorMsg);
      showToast(`❌ ${errorMsg}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const passwordStrength = (password) => {
    if (!password) return { strength: 0, label: '', color: '' };
    let strength = 0;
    if (password.length >= 6) strength++;
    if (password.length >= 8) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^A-Za-z0-9]/.test(password)) strength++;

    if (strength <= 2) return { strength, label: 'Слабый', color: 'red' };
    if (strength <= 3) return { strength, label: 'Средний', color: 'amber' };
    return { strength, label: 'Сильный', color: 'emerald' };
  };

  const pwdStrength = passwordStrength(newPassword);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden"
      >
        {/* Красивый хедер */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-white/20 rounded-lg">
              <KeyRound className="w-6 h-6" />
            </div>
            <h2 className="text-2xl font-bold">Смена логина и пароля</h2>
          </div>
          <p className="text-blue-100 text-sm">Обновите свои учетные данные</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Новый логин */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Новый логин
            </label>
            <input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
              required
              placeholder="Введите новый логин"
            />
          </div>

          {/* Текущий пароль */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Текущий пароль
            </label>
            <div className="relative">
              <input
                type={showCurrentPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-4 py-3 pr-12 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                required
                placeholder="Введите текущий пароль"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showCurrentPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Новый пароль */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Новый пароль
            </label>
            <div className="relative">
              <input
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-4 py-3 pr-12 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                required
                placeholder="Введите новый пароль"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            {newPassword && (
              <div className="mt-2">
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(pwdStrength.strength / 5) * 100}%` }}
                      className={`h-full rounded-full ${
                        pwdStrength.color === 'red' ? 'bg-red-500' :
                        pwdStrength.color === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                    />
                  </div>
                  <span className={`text-xs font-semibold ${
                    pwdStrength.color === 'red' ? 'text-red-600' :
                    pwdStrength.color === 'amber' ? 'text-amber-600' : 'text-emerald-600'
                  }`}>
                    {pwdStrength.label}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Ошибка */}
          {error && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-red-50 border-2 border-red-200 rounded-xl p-4 flex items-start gap-3"
            >
              <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <p className="text-red-700 text-sm flex-1">{error}</p>
            </motion.div>
          )}

          {/* Кнопки */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={() => {
                if (user?.role === 'admin') navigate('/admin');
                else if (user?.role === 'manager') navigate('/manager');
                else if (user?.role === 'driver') navigate('/driver');
                else navigate('/home');
              }}
              className="w-full sm:w-auto px-6 py-3 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 font-semibold transition"
            >
              Отмена
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={loading}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 font-semibold transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Сохранение...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Сохранить
                </>
              )}
            </motion.button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
