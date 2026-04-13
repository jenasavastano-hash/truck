import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import api from '../api';

export default function FirstLoginModal({ userId, token, onClose, onSuccess, refreshUser }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChangeCredentials = async (e) => {
    e.preventDefault();
    setError('');

    if (!newPassword) {
      setError('Укажите новый пароль');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Пароли не совпадают');
      return;
    }

    if (newPassword.length < 6) {
      setError('Пароль должен быть не менее 6 символов');
      return;
    }

    setLoading(true);
    try {
      const response = await api.put(
        '/auth/me/credentials',
        { currentPassword: '', newPassword },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = response?.data || response;
      const newToken = data.token;
      if (!newToken) {
        throw new Error('Сервер не вернул новый токен');
      }
      const updatedUser = {
        id: data.id,
        username: data.username,
        phone: data.phone,
        role: data.role,
        mustChangePassword: 0,
        firstLogin: 0
      };
      localStorage.setItem('token', newToken);
      localStorage.setItem('user', JSON.stringify(updatedUser));
      if (typeof refreshUser === 'function') refreshUser();
      onSuccess(updatedUser);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Ошибка при сохранении пароля';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-2xl font-bold mb-2">🔐 Первый вход</h2>
        <p className="text-gray-600 mb-6">Укажите новый пароль для вашего аккаунта</p>

        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleChangeCredentials} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Новый пароль *</label>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Минимум 6 символов"
                className="w-full border border-gray-300 rounded px-3 py-2 pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                title={showPwd ? 'Скрыть' : 'Показать'}
              >
                {showPwd ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Подтверждение пароля *</label>
            <input
              type={showPwd ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Повторите пароль"
              className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div className="flex gap-2 pt-4">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400 font-semibold"
            >
              {loading ? 'Сохранение...' : 'Сохранить пароль'}
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  localStorage.removeItem('token');
                  localStorage.removeItem('user');
                } catch (_) {}
                onClose();
                window.location.href = '/login';
              }}
              className="flex-1 bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400 font-semibold"
            >
              Выйти
            </button>
          </div>
        </form>

        <p className="text-xs text-gray-500 mt-4">
          💡 Ваш логин: номер телефона (не может быть изменён)<br/>
          Это модальное окно появляется только при первом входе.
        </p>
      </div>
    </div>
  );
}
