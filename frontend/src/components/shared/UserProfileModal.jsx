import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Shield, Eye, EyeOff, CheckCircle2, XCircle, Phone, KeyRound, Building2, UserCircle, Lock } from 'lucide-react';
import api from '../../api';
import Modal from '../ui/Modal';
import { useToast } from '../../hooks/useToast';
import { useAuth } from '../../AuthContext';
import { useNavigate } from 'react-router-dom';

export default function UserProfileModal({ user, isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('profile');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [newUsername, setNewUsername] = useState(user?.username || '');
  const [newPassword, setNewPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();
  const { login, logout } = useAuth();
  const navigate = useNavigate();

  const handleSaveSecurity = async (e) => {
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

      try {
        const loginUsername = newUsername || user?.username;
        const loginPassword = newPassword || currentPassword;

        if (loginUsername && loginPassword) {
          await login(loginUsername, loginPassword);
          setTimeout(() => {
            onClose();
            if (user?.role === 'admin') navigate('/admin');
            else if (user?.role === 'manager') navigate('/manager');
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
        setTimeout(() => {
          onClose();
          navigate('/login');
        }, 2000);
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

  const tabs = [
    { id: 'profile', label: 'Профиль', icon: User, gradient: 'from-blue-500 to-indigo-600' },
    { id: 'security', label: 'Безопасность', icon: Shield, gradient: 'from-emerald-500 to-emerald-600' }
  ];

  const profileFields = [
    { 
      label: 'ФИО', 
      value: user?.fullName || '—', 
      icon: UserCircle,
      gradient: 'from-blue-500 to-blue-600'
    },
    { 
      label: 'Телефон', 
      value: user?.phone || user?.username || '—', 
      icon: Phone,
      gradient: 'from-emerald-500 to-emerald-600'
    },
    { 
      label: 'Логин', 
      value: user?.username || '—', 
      icon: KeyRound,
      gradient: 'from-purple-500 to-purple-600'
    },
    { 
      label: 'Роль', 
      value: user?.role === 'admin' ? 'Администратор' : user?.role === 'manager' ? 'Менеджер парка' : 'Пользователь',
      icon: Building2,
      gradient: 'from-indigo-500 to-indigo-600'
    }
  ];

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title=""
        size="lg"
        className="max-h-[95vh] sm:max-h-[90vh] overflow-hidden !max-w-[calc(100vw-1rem)] sm:!max-w-2xl"
      >
        {/* Красивый хедер с аватаром */}
        <div className="bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-600 text-white p-6 sm:p-8 -m-3 sm:-m-6 mb-4 sm:mb-6">
          <div className="flex items-center gap-4">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200 }}
              className="w-16 h-16 sm:w-20 sm:h-20 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center border-4 border-white/30"
            >
              <User className="w-8 h-8 sm:w-10 sm:h-10" />
            </motion.div>
            <div className="flex-1 min-w-0">
              <motion.h2
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="text-xl sm:text-2xl font-bold mb-1 truncate"
              >
                {user?.fullName || user?.username || 'Пользователь'}
              </motion.h2>
              <motion.p
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 }}
                className="text-blue-100 text-sm sm:text-base truncate"
              >
                {user?.phone || user?.username || '—'}
              </motion.p>
            </div>
          </div>
        </div>

        {/* Табы с градиентами */}
        <div className="mb-4 sm:mb-6">
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <motion.button
                  key={tab.id}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-3 sm:px-6 py-2.5 sm:py-3 rounded-lg sm:rounded-xl font-semibold text-sm sm:text-base transition-all relative shrink-0 ${
                    isActive
                      ? `bg-gradient-to-r ${tab.gradient} text-white shadow-lg`
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                  <span className="whitespace-nowrap">{tab.label}</span>
                  {isActive && (
                    <motion.div
                      layoutId="activeTab"
                      className={`absolute inset-0 bg-gradient-to-r ${tab.gradient} rounded-lg sm:rounded-xl -z-10`}
                      transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                    />
                  )}
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Контент табов */}
        <AnimatePresence mode="wait">
          {activeTab === 'profile' && (
            <motion.div
              key="profile"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {profileFields.map((field, index) => {
                  const Icon = field.icon;
                  return (
                    <motion.div
                      key={field.label}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="bg-gradient-to-br from-white to-slate-50 rounded-xl p-4 border-2 border-slate-200 hover:border-blue-300 hover:shadow-lg transition-all group"
                    >
                      <div className="flex items-start gap-3">
                        <div className={`p-2.5 rounded-lg bg-gradient-to-br ${field.gradient} text-white shadow-md group-hover:scale-110 transition-transform`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                            {field.label}
                          </p>
                          <p className="font-bold text-slate-800 text-sm sm:text-base">
                            {field.value}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {activeTab === 'security' && (
            <motion.form
              key="security"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              onSubmit={handleSaveSecurity}
              className="space-y-5"
            >
              {/* Новый логин */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 }}
                className="bg-gradient-to-br from-white to-slate-50 rounded-xl p-5 border-2 border-slate-200"
              >
                <label className="block text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-blue-600" />
                  Новый логин
                </label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition bg-white"
                  required
                  placeholder="Введите новый логин"
                />
              </motion.div>

              {/* Текущий пароль */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
                className="bg-gradient-to-br from-white to-slate-50 rounded-xl p-5 border-2 border-slate-200"
              >
                <label className="block text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-emerald-600" />
                  Текущий пароль
                </label>
                <div className="relative">
                  <input
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full px-4 py-3 pr-12 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition bg-white"
                    required
                    placeholder="Введите текущий пароль"
                  />
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"
                  >
                    {showCurrentPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </motion.button>
                </div>
              </motion.div>

              {/* Новый пароль */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
                className="bg-gradient-to-br from-white to-slate-50 rounded-xl p-5 border-2 border-slate-200"
              >
                <label className="block text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-purple-600" />
                  Новый пароль
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-4 py-3 pr-12 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition bg-white"
                    required
                    placeholder="Введите новый пароль"
                  />
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"
                  >
                    {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </motion.button>
                </div>
                {newPassword && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mt-3"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex-1 h-3 bg-slate-200 rounded-full overflow-hidden shadow-inner">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${(pwdStrength.strength / 5) * 100}%` }}
                          transition={{ duration: 0.5 }}
                          className={`h-full rounded-full ${
                            pwdStrength.color === 'red' ? 'bg-gradient-to-r from-red-500 to-red-600' :
                            pwdStrength.color === 'amber' ? 'bg-gradient-to-r from-amber-500 to-amber-600' : 
                            'bg-gradient-to-r from-emerald-500 to-emerald-600'
                          } shadow-sm`}
                        />
                      </div>
                      <span className={`text-xs font-bold px-2 py-1 rounded-lg ${
                        pwdStrength.color === 'red' ? 'bg-red-100 text-red-700' :
                        pwdStrength.color === 'amber' ? 'bg-amber-100 text-amber-700' : 
                        'bg-emerald-100 text-emerald-700'
                      }`}>
                        {pwdStrength.label}
                      </span>
                    </div>
                  </motion.div>
                )}
              </motion.div>

              {/* Ошибка */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-gradient-to-r from-red-50 to-red-100 border-2 border-red-300 rounded-xl p-4 flex items-start gap-3 shadow-md"
                >
                  <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  <p className="text-red-700 text-sm font-medium flex-1">{error}</p>
                </motion.div>
              )}

              {/* Кнопки */}
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={onClose}
                  className="w-full sm:w-auto px-6 py-3 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 font-semibold transition shadow-md"
                >
                  Отмена
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02, shadow: 'lg' }}
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  disabled={loading}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl hover:from-emerald-600 hover:to-emerald-700 font-semibold transition shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Сохранение...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Сохранить изменения
                    </>
                  )}
                </motion.button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>
      </Modal>
    </>
  );
}
