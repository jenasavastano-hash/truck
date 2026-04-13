import { useState } from 'react';
import { alertError, alertSuccess } from '../utils/alerts';

/**
 * Переиспользуемый компонент для изменения пароля
 * Может быть вложен в модал или полностраничное окно
 * 
 * Props:
 * - onSuccess: callback при успешном изменении пароля
 * - onCancel: callback отмены (опционально)
 * - currentPassword: требовать текущий пароль (true для обычного юзера)
 * - isFirstLogin: показывать сообщение о первом входе (true для FirstLoginModal)
 * - newUsernameLabel: кастомный лейбл для нового ника (если нужно изменять имя пользователя)
 */
export default function PasswordChangeForm({
  onSuccess,
  onCancel,
  currentPassword = false,
  isFirstLogin = false,
  newUsernameLabel = 'New Login'
}) {
  const [formData, setFormData] = useState({
    currentPassword: '',
    newUsername: '',
    newPassword: '',
    confirmPassword: ''
  });

  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    // Очищаем ошибку для этого поля
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
  };

  const validateForm = () => {
    const newErrors = {};

    if (currentPassword && !formData.currentPassword.trim()) {
      newErrors.currentPassword = 'Current password is required';
    }

    if (!formData.newUsername.trim() && !formData.newPassword.trim()) {
      newErrors.general = 'Please change either login or password';
    }

    if (formData.newPassword || formData.confirmPassword) {
      if (formData.newPassword !== formData.confirmPassword) {
        newErrors.confirmPassword = 'Passwords do not match';
      }
      if (formData.newPassword.length < 6) {
        newErrors.newPassword = 'Password must be at least 6 characters';
      }
    }

    if (formData.newUsername && formData.newUsername.length < 3) {
      newErrors.newUsername = 'Login must be at least 3 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      const payload = {};
      if (formData.newUsername) payload.newUsername = formData.newUsername;
      if (formData.newPassword) payload.newPassword = formData.newPassword;
      if (formData.currentPassword) payload.currentPassword = formData.currentPassword;

      const response = await fetch('/api/auth/me/credentials', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update credentials');
      }

      alertSuccess('Password changed successfully. Please log in again.');
      
      // Очищаем токен и перенаправляем на логин
      localStorage.removeItem('token');
      localStorage.removeItem('userId');
      localStorage.removeItem('role');

      // Вызываем callback успеха
      if (onSuccess) {
        onSuccess();
      } else {
        // Перенаправляем на логин через окно браузера
        setTimeout(() => {
          window.location.href = '/login';
        }, 1000);
      }
    } catch (error) {
      console.error('Credentials update error:', error);
      alertError(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-4">
      {/* Сообщение о первом входе */}
      {isFirstLogin && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
          <p className="text-sm text-blue-700">
            🔐 Это ваш первый вход. Требуется изменить пароль в целях безопасности.
          </p>
        </div>
      )}

      {/* Общая ошибка */}
      {errors.general && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-red-700">{errors.general}</p>
        </div>
      )}

      {/* Текущий пароль (если требуется) */}
      {currentPassword && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Current Password
          </label>
          <input
            type="password"
            name="currentPassword"
            value={formData.currentPassword}
            onChange={handleChange}
            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              errors.currentPassword ? 'border-red-500' : 'border-gray-300'
            }`}
            placeholder="Enter your current password"
            disabled={loading}
          />
          {errors.currentPassword && (
            <p className="text-red-500 text-sm mt-1">{errors.currentPassword}</p>
          )}
        </div>
      )}

      {/* Новое имя пользователя (опционально) */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {newUsernameLabel} (optional)
        </label>
        <input
          type="text"
          name="newUsername"
          value={formData.newUsername}
          onChange={handleChange}
          className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            errors.newUsername ? 'border-red-500' : 'border-gray-300'
          }`}
          placeholder="Leave empty to keep current"
          disabled={loading}
        />
        {errors.newUsername && (
          <p className="text-red-500 text-sm mt-1">{errors.newUsername}</p>
        )}
      </div>

      {/* Новый пароль (опционально) */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          New Password (optional)
        </label>
        <input
          type="password"
          name="newPassword"
          value={formData.newPassword}
          onChange={handleChange}
          className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            errors.newPassword ? 'border-red-500' : 'border-gray-300'
          }`}
          placeholder="Leave empty to keep current"
          disabled={loading}
        />
        {errors.newPassword && (
          <p className="text-red-500 text-sm mt-1">{errors.newPassword}</p>
        )}
      </div>

      {/* Подтверждение пароля */}
      {formData.newPassword && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Confirm New Password
          </label>
          <input
            type="password"
            name="confirmPassword"
            value={formData.confirmPassword}
            onChange={handleChange}
            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              errors.confirmPassword ? 'border-red-500' : 'border-gray-300'
            }`}
            placeholder="Repeat new password"
            disabled={loading}
          />
          {errors.confirmPassword && (
            <p className="text-red-500 text-sm mt-1">{errors.confirmPassword}</p>
          )}
        </div>
      )}

      {/* Кнопки */}
      <div className="flex gap-3 pt-4">
        <button
          type="submit"
          disabled={loading}
          className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {loading ? 'Updating...' : 'Update Credentials'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-400 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
