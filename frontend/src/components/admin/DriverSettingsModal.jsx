import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { User, Save, Wallet, FileText, BarChart3, Trash2, Car, Settings, Unlink, Link2, Search, Lock, Eye, EyeOff } from 'lucide-react';
import api from '../../api';
import Modal from '../ui/Modal';
import BindCarModal from './BindCarModal';
import CarSettingsModal from './CarSettingsModal';
import AddCarModal from '../manager/modals/AddCarModal';
import { useAuth } from '../../AuthContext';

export default function DriverSettingsModal({ driver, cars, parkId, drivers, isOpen, onClose, onSave, onDelete, showBalanceBreakdown, canChangeDriverPassword, driverStatsVisibility }) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('takskom'); // 'takskom', 'balance', 'car', 'stats'
  const [driverStatsLoading, setDriverStatsLoading] = useState(false);
  const [driverStats, setDriverStats] = useState(null);
  const [formData, setFormData] = useState({
    lastName: '',
    firstName: '',
    secondName: '',
    licenseSerial: '',
    licenseNumber: '',
    licenseDate: '',
    personnelNumber: '',
    inn: '',
    snils: ''
  });
  const [loading, setLoading] = useState(false);
  const [balanceAmount, setBalanceAmount] = useState('');
  const [balanceType, setBalanceType] = useState('real');
  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [savingBalance, setSavingBalance] = useState(false);
  const [showBindCarModal, setShowBindCarModal] = useState(false);
  const [showCarSettingsModal, setShowCarSettingsModal] = useState(false);
  const [showAddCarModal, setShowAddCarModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [bindingCar, setBindingCar] = useState(false);
  const [carSearchQuery, setCarSearchQuery] = useState('');
  const [eplAccessOverride, setEplAccessOverride] = useState('default');

  const [pwdNew, setPwdNew] = useState('');
  const [pwdConfirm, setPwdConfirm] = useState('');
  const [pwdShow, setPwdShow] = useState(false);
  const [pwdMustChangeOnLogin, setPwdMustChangeOnLogin] = useState(false);
  const [pwdSaving, setPwdSaving] = useState(false);
  const requestParkId = parkId || driver?.parkId || null;

  const handleDelete = async () => {
    if (!driver) return;
    setDeleting(true);
    try {
      const role = user?.role;
      const url = role === 'manager'
        ? `/manager/drivers/${driver.userId}/remove`
        : role === 'director'
          ? `/director/drivers/${driver.userId}/remove`
          : `/admin/drivers/${driver.userId}`;
      await api.delete(url);
      setShowDeleteConfirm(false);
      onClose();
      if (onDelete) onDelete();
      else if (onSave) onSave();
    } catch (e) {
      alert(`Ошибка удаления: ${e.response?.data?.error || e.message}`);
    } finally {
      setDeleting(false);
    }
  };

  const handleUnlinkCar = async () => {
    if (!driver || !driver.carId) return;
    if (!window.confirm(`Отвязать автомобиль от водителя "${driver.fullName || driver.phone}"?`)) return;
    setUnlinking(true);
    try {
      const role = user?.role;
      const url = role === 'manager'
        ? `/manager/drivers/${driver.id || driver.userId}`
        : role === 'director'
          ? `/director/drivers/${driver.id || driver.userId}`
          : `/admin/drivers/${driver.userId}/car`;
      await api.put(url, { carId: null }, (role === 'manager' || role === 'director') && requestParkId ? { params: { parkId: requestParkId } } : undefined);
      alert('✅ Автомобиль отвязан');
      if (onSave) onSave();
    } catch (e) {
      alert(`❌ Ошибка: ${e.response?.data?.error || e.message}`);
    } finally {
      setUnlinking(false);
    }
  };

  const handleAddCarAndBind = async (formData) => {
    if (!driver) return;
    try {
      const role = user?.role;
      const res = role === 'manager'
        ? await api.post('/manager/cars', formData)
        : role === 'director'
          ? await api.post('/director/cars', formData)
          : await api.post(`/admin/parks/${parkId}/cars`, formData);
      const newCar = res.data;
      if (newCar?.id) {
        const url = role === 'manager'
          ? `/manager/drivers/${driver.id || driver.userId}`
          : role === 'director'
            ? `/director/drivers/${driver.id || driver.userId}`
            : `/admin/drivers/${driver.userId}/car`;
        await api.put(url, { carId: newCar.id }, (role === 'manager' || role === 'director') && requestParkId ? { params: { parkId: requestParkId } } : undefined);
        alert('✅ Автомобиль создан и привязан');
      }
      setShowAddCarModal(false);
      if (onSave) onSave();
    } catch (e) {
      alert(`❌ Ошибка: ${e.response?.data?.error || e.message}`);
    }
  };

  const handleBindExistingCar = async (carToBind) => {
    if (!driver || !carToBind?.id) return;
    const carLabel = `${carToBind.regNumber || 'Без номера'} ${[carToBind.brand, carToBind.model].filter(Boolean).join(' ') || ''}`.trim();
    if (!window.confirm(`Привязать автомобиль "${carLabel}" к водителю "${driver.fullName || driver.phone}"?`)) return;
    setBindingCar(true);
    try {
      const role = user?.role;
      const url = role === 'manager'
        ? `/manager/drivers/${driver.id || driver.userId}`
        : role === 'director'
          ? `/director/drivers/${driver.id || driver.userId}`
          : `/admin/drivers/${driver.userId}/car`;
      await api.put(url, { carId: carToBind.id }, (role === 'manager' || role === 'director') && requestParkId ? { params: { parkId: requestParkId } } : undefined);
      alert('✅ Автомобиль привязан');
      if (onSave) onSave();
    } catch (e) {
      alert(`❌ Ошибка: ${e.response?.data?.error || e.message}`);
    } finally {
      setBindingCar(false);
    }
  };

  // Преобразует DD.MM.YYYY в YYYY-MM-DD для input type="date"
  const toDateInputFormat = (val) => {
    if (!val) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
    const m = String(val).match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return val;
  };

  useEffect(() => {
    if (isOpen && driver) {
      setFormData({
        lastName: driver.lastName || driver.fullName?.split(' ')[0] || '',
        firstName: driver.firstName || driver.fullName?.split(' ')[1] || '',
        secondName: driver.secondName || driver.fullName?.split(' ')[2] || '',
        licenseSerial: driver.licenseSerial || '',
        licenseNumber: driver.licenseNumber || '',
        licenseDate: toDateInputFormat(driver.licenseDate) || '',
        personnelNumber: driver.personnelNumber || driver.id?.toString() || '',
        inn: driver.inn || '',
        snils: driver.snils || ''
      });
      setPwdNew('');
      setPwdConfirm('');
      setPwdShow(false);
      setPwdMustChangeOnLogin(false);
      setDriverStats(null);
      setEplAccessOverride(
        driver.eplAccessOverride === 'force_allow'
          ? 'force_allow'
          : driver.eplAccessOverride === 'force_deny'
            ? 'force_deny'
            : 'default'
      );
    }
  }, [isOpen, driver]);

  const loadDriverStats = async () => {
    if (!driver?.userId) return;
    setDriverStatsLoading(true);
    try {
      const role = user?.role;
      const base = role === 'manager' ? '/manager' : role === 'director' ? '/director' : '/admin';
      const res = await api.get(`${base}/drivers/${driver.userId}/statistics`, { params: parkId ? { parkId } : {} });
      setDriverStats(res.data || null);
    } catch (_) {
      setDriverStats(null);
    } finally {
      setDriverStatsLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    if (activeTab !== 'stats') return;
    loadDriverStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTab, driver?.userId]);

  const handleSetPassword = async (e) => {
    e.preventDefault();
    if (!driver) return;
    const newPass = String(pwdNew || '');
    if (!newPass || newPass.length < 6) {
      alert('Пароль должен быть не менее 6 символов');
      return;
    }
    if (newPass !== String(pwdConfirm || '')) {
      alert('Пароли не совпадают');
      return;
    }
    if (!window.confirm(`Сменить пароль для "${driver.fullName || driver.phone}"?`)) return;
    setPwdSaving(true);
    try {
      const role = user?.role;
      const isParkRole = role === 'manager' || role === 'director';
      if (role === 'manager' && !canChangeDriverPassword) {
        alert('Нет доступа: смена пароля водителя');
        return;
      }
      const url = isParkRole
        ? `/${role}/drivers/${driver.userId}/password`
        : `/auth/users/${driver.userId}/credentials`;
      await api.post(url, {
        newPassword: newPass,
        mustChangePassword: pwdMustChangeOnLogin ? 1 : 0
      });
      alert('✅ Пароль обновлён');
      setPwdNew('');
      setPwdConfirm('');
      setPwdMustChangeOnLogin(false);
      if (onSave) onSave();
    } catch (e2) {
      alert(`❌ Ошибка: ${e2.response?.data?.error || e2.message}`);
    } finally {
      setPwdSaving(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!driver) return;
    if (!formData.lastName?.trim() || !formData.firstName?.trim()) {
      alert('Для создания ЭПЛ нужны фамилия и имя водителя');
      return;
    }
    if (!formData.licenseSerial?.trim() && !formData.licenseNumber?.trim()) {
      alert('Для создания ЭПЛ нужны серия и/или номер водительского удостоверения');
      return;
    }
    setLoading(true);
    try {
      const driverId = driver.id || driver.driverId || driver.userId;
      const role = user?.role;
      const isParkRole = role === 'manager' || role === 'director';
      if (isParkRole) {
        const fullName = [formData.lastName, formData.firstName, formData.secondName].filter(Boolean).join(' ').trim();
        await api.put(`/${role}/drivers/${driverId}`, {
          fullName,
          licenseSerial: formData.licenseSerial,
          licenseNumber: formData.licenseNumber,
          licenseDate: formData.licenseDate || null,
          personnelNumber: formData.personnelNumber,
          inn: formData.inn,
          snils: formData.snils || null,
          eplAccessOverride
        });
      } else {
        await api.put(`/admin/drivers/${driverId}/takskom`, {
          ...formData,
          eplAccessOverride
        });
      }
      alert('✅ Данные водителя для Такском сохранены');
      if (onSave) onSave();
      onClose();
    } catch (e) {
      alert(`❌ Ошибка: ${e.response?.data?.error || e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleBalanceTopup = async () => {
    if (!driver || !balanceAmount || Number(balanceAmount) <= 0) return;
    setSavingBalance(true);
    try {
      const isManager = user?.role === 'manager';
      const url = isManager
        ? `/manager/drivers/${driver.userId}/balance`
        : `/admin/drivers/${driver.userId}/balance`;
      await api.post(url, {
        amount: Number(balanceAmount),
        amountType: balanceType
      });
      alert('✅ Баланс пополнен');
      setShowBalanceModal(false);
      setBalanceAmount('');
      if (onSave) onSave();
    } catch (e) {
      alert(`❌ Ошибка: ${e.response?.data?.error || e.message}`);
    } finally {
      setSavingBalance(false);
    }
  };

  if (!driver) return null;

  const currentCar = cars?.find(c => c.id === driver.carId);
  const freeCars = (cars || []).filter(c => !c.driverId && !(c.driver && c.driver.userId));
  const filteredFreeCars = freeCars.filter(c => {
    if (!carSearchQuery.trim()) return true;
    const q = carSearchQuery.toLowerCase();
    return (c.regNumber || '').toLowerCase().includes(q) ||
      (c.brand || '').toLowerCase().includes(q) ||
      (c.model || '').toLowerCase().includes(q);
  });

  const canSeePasswordTab = user?.role === 'admin' || (user?.role === 'manager' && !!canChangeDriverPassword);
  const tabs = [
    { id: 'takskom', label: 'Такском', icon: FileText },
    { id: 'balance', label: 'Баланс', icon: Wallet },
    { id: 'car', label: 'Автомобиль', icon: Car },
    ...(canSeePasswordTab ? [{ id: 'security', label: 'Пароль', icon: Lock }] : []),
    { id: 'stats', label: 'Статистика', icon: BarChart3 }
  ];

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={`Водитель: ${driver.fullName || driver.phone}`}
        size="lg"
        className="max-h-[95vh] sm:max-h-[90vh]"
      >
        {/* Табы */}
        <div className="border-b border-slate-200 mb-4">
          <div className="flex gap-1 overflow-x-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <motion.button
                  key={tab.id}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 sm:py-3 text-sm sm:text-base font-semibold transition rounded-t-lg ${
                    isActive
                      ? 'bg-teal-50 text-teal-800 border-b-2 border-teal-600'
                      : 'text-slate-600 hover:text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                  <span className="whitespace-nowrap">{tab.label}</span>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Контент табов */}
        <div className="min-h-[300px]">
          {activeTab === 'takskom' && (
            <form onSubmit={handleSave} className="space-y-4 sm:space-y-6">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs sm:text-sm text-amber-800">
                <strong>Для ЭПЛ/Такском:</strong> обязательны фамилия, имя, серия/номер ВУ. Рекомендуется: отчество, дата ВУ, ИНН, табельный номер.
              </div>
              <div className="bg-slate-50 rounded-lg sm:rounded-xl p-3 sm:p-4 border border-slate-200">
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-2">Доступ к созданию ЭПЛ (персонально)</label>
                <select
                  value={eplAccessOverride}
                  onChange={(e) => setEplAccessOverride(e.target.value)}
                  className="w-full px-3 sm:px-4 py-2.5 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                >
                  <option value="default">Как в настройках парка</option>
                  <option value="force_allow">Всегда разрешить водителю создавать ЭПЛ</option>
                  <option value="force_deny">Запретить создание ЭПЛ водителю</option>
                </select>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    eplAccessOverride === 'force_allow'
                      ? 'bg-emerald-100 text-emerald-700'
                      : eplAccessOverride === 'force_deny'
                        ? 'bg-rose-100 text-rose-700'
                        : 'bg-slate-100 text-slate-700'
                  }`}>
                    {eplAccessOverride === 'force_allow'
                      ? 'Сейчас: всегда разрешено'
                      : eplAccessOverride === 'force_deny'
                        ? 'Сейчас: всегда запрещено'
                        : 'Сейчас: режим парка'}
                  </span>
                  <span className="text-xs text-slate-500">
                    Точечное исключение для конкретного водителя.
                  </span>
                </div>
              </div>
              {/* ФИО */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 sm:mb-2">Фамилия *</label>
                  <input
                    type="text"
                    value={formData.lastName}
                    onChange={(e) => setFormData({...formData, lastName: e.target.value})}
                    className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 sm:mb-2">Имя *</label>
                  <input
                    type="text"
                    value={formData.firstName}
                    onChange={(e) => setFormData({...formData, firstName: e.target.value})}
                    className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 sm:mb-2">Отчество</label>
                  <input
                    type="text"
                    value={formData.secondName}
                    onChange={(e) => setFormData({...formData, secondName: e.target.value})}
                    className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                  />
                </div>
              </div>

              {/* Водительское удостоверение */}
              <div className="bg-slate-50 rounded-lg sm:rounded-xl p-3 sm:p-4 border border-slate-200">
                <h3 className="text-xs sm:text-sm font-bold text-slate-800 mb-3 sm:mb-4">Водительское удостоверение</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                  <div>
                    <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 sm:mb-2">Серия</label>
                    <input
                      type="text"
                      value={formData.licenseSerial}
                      onChange={(e) => setFormData({...formData, licenseSerial: e.target.value})}
                      className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                      placeholder="12АВ"
                    />
                  </div>
                  <div>
                    <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 sm:mb-2">Номер</label>
                    <input
                      type="text"
                      value={formData.licenseNumber}
                      onChange={(e) => setFormData({...formData, licenseNumber: e.target.value})}
                      className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                      placeholder="345678"
                    />
                  </div>
                  <div>
                    <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 sm:mb-2">Дата выдачи</label>
                    <input
                      type="date"
                      value={formData.licenseDate}
                      onChange={(e) => setFormData({...formData, licenseDate: e.target.value})}
                      className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                    />
                  </div>
                </div>
              </div>

              {/* Дополнительные данные */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 sm:mb-2">Табельный номер</label>
                  <input
                    type="text"
                    value={formData.personnelNumber}
                    onChange={(e) => setFormData({...formData, personnelNumber: e.target.value})}
                    className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                    placeholder="000000"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 sm:mb-2">ИНН</label>
                  <input
                    type="text"
                    value={formData.inn}
                    onChange={(e) => setFormData({...formData, inn: e.target.value})}
                    className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                    placeholder="000000000000"
                    maxLength={12}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 sm:mb-2">СНИЛС</label>
                  <input
                    type="text"
                    value={formData.snils}
                    onChange={(e) => setFormData({...formData, snils: e.target.value})}
                    className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                    placeholder="000-000-000 00"
                    maxLength={14}
                  />
                </div>
              </div>

              {/* Кнопки */}
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 pt-3 sm:pt-4 border-t border-slate-200">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  className="w-full sm:flex-1 px-4 py-2.5 sm:py-3 bg-slate-100 text-slate-700 rounded-lg sm:rounded-xl hover:bg-slate-200 font-semibold text-sm sm:text-base transition"
                >
                  Отмена
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  disabled={loading}
                  className="w-full sm:flex-1 px-4 py-2.5 sm:py-3 bg-gradient-to-r from-teal-600 to-teal-800 text-white rounded-lg sm:rounded-xl hover:from-teal-700 hover:to-teal-900 font-semibold text-sm sm:text-base transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  {loading ? 'Сохранение...' : 'Сохранить'}
                </motion.button>
              </div>

              {/* Удалить водителя — только во вкладке Такском */}
              <div className="mt-6 pt-4 border-t border-slate-200">
                {!showDeleteConfirm ? (
                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="w-full py-2.5 px-4 rounded-xl text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 transition flex items-center justify-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Удалить водителя
                  </motion.button>
                ) : (
                  <div className="bg-red-50 border border-red-300 rounded-xl p-4">
                    <p className="text-sm text-red-800 font-semibold mb-1">Удалить водителя?</p>
                    <p className="text-xs text-red-600 mb-3">
                      {driver.fullName || driver.phone} будет удалён из системы. Привязанный автомобиль станет свободным. Это действие нельзя отменить.
                    </p>
                    <div className="flex gap-2">
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={handleDelete}
                        disabled={deleting}
                        className="flex-1 py-2 px-3 rounded-lg text-sm font-semibold bg-red-600 hover:bg-red-700 text-white transition disabled:opacity-50"
                      >
                        {deleting ? 'Удаление...' : 'Да, удалить'}
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setShowDeleteConfirm(false)}
                        className="flex-1 py-2 px-3 rounded-lg text-sm font-medium bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition"
                      >
                        Отмена
                      </motion.button>
                    </div>
                  </div>
                )}
              </div>
            </form>
          )}

          {activeTab === 'balance' && (
            <div className="space-y-4">
              <div className="bg-gradient-to-r from-emerald-50 to-sky-50 border-2 border-emerald-200 rounded-lg sm:rounded-xl p-4 sm:p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-xs sm:text-sm text-slate-600 mb-1">Текущий баланс</p>
                    <p className="text-2xl sm:text-3xl font-bold text-slate-800">
                      {(driver.balance !== undefined ? driver.balance : (Number(driver.balanceReal || 0) + Number(driver.balanceUnreal || 0))) || '0'} ₽
                    </p>
                    {(user?.role === 'admin' || showBalanceBreakdown) && (driver.balanceReal !== undefined || driver.balanceUnreal !== undefined) && (
                      <div className="mt-3 flex flex-wrap gap-4 text-sm">
                        <span className="text-emerald-700 font-medium">
                          Реальные: {(driver.balanceReal ?? 0)} ₽
                        </span>
                        <span className="text-amber-700 font-medium">
                          Фантики: {(driver.balanceUnreal ?? 0)} ₽
                        </span>
                      </div>
                    )}
                  </div>
                  <Wallet className="w-8 h-8 sm:w-10 sm:h-10 text-emerald-600" />
                </div>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowBalanceModal(true)}
                  className="w-full px-4 py-2.5 sm:py-3 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white rounded-lg sm:rounded-xl hover:from-emerald-700 hover:to-emerald-800 font-semibold text-sm sm:text-base transition shadow-md flex items-center justify-center gap-2"
                >
                  <Wallet className="w-4 h-4" />
                  Пополнить баланс
                </motion.button>
              </div>
            </div>
          )}

          {activeTab === 'car' && (
            <div className="space-y-4">
              {currentCar ? (
                <div className="bg-emerald-50 border-2 border-emerald-200 rounded-lg sm:rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="p-2 bg-emerald-100 rounded-lg shrink-0">
                        <Car className="w-5 h-5 text-emerald-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-slate-800 text-lg">{currentCar.regNumber || 'Без номера'}</p>
                        <p className="text-sm text-slate-600 truncate">
                          {[currentCar.brand, currentCar.model].filter(Boolean).join(' ') || '—'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={handleUnlinkCar}
                        disabled={unlinking}
                        className="p-2 text-red-600 hover:bg-red-100 rounded-lg transition"
                        title="Отвязать"
                      >
                        <Unlink className="w-5 h-5" />
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setShowCarSettingsModal(true)}
                        className="p-2 text-teal-600 hover:bg-teal-100 rounded-lg transition"
                        title="Редактировать"
                      >
                        <Settings className="w-5 h-5" />
                      </motion.button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-slate-600 text-sm">Привяжите авто из списка свободных или добавьте новое в базу — оно сразу будет связано с водителем.</p>
                  <div>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setShowAddCarModal(true)}
                      className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white rounded-xl hover:from-emerald-700 hover:to-emerald-800 font-semibold transition shadow-md flex items-center justify-center gap-2 mb-4"
                    >
                      <Car className="w-4 h-4" />
                      Добавить авто и привязать
                    </motion.button>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700 mb-2">Свободные автомобили (без водителя)</p>
                    <div className="relative mb-3">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="text"
                        value={carSearchQuery}
                        onChange={(e) => setCarSearchQuery(e.target.value)}
                        placeholder="Поиск по номеру, марке, модели..."
                        className="w-full pl-10 pr-4 py-2 border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      />
                    </div>
                    <p className="text-xs text-slate-500 mb-1">Клик по карточке → подтверждение → связка</p>
                    <div className="max-h-48 overflow-y-auto border-2 border-slate-200 rounded-xl divide-y divide-slate-100 bg-white">
                      {filteredFreeCars.length === 0 ? (
                        <div className="p-6 text-center text-slate-500 text-sm">
                          {freeCars.length === 0 ? 'Нет свободных автомобилей' : 'Нет результатов поиска'}
                        </div>
                      ) : (
                        filteredFreeCars.map((car) => (
                          <motion.button
                            key={car.id}
                            whileHover={{ backgroundColor: '#f1f5f9' }}
                            whileTap={{ scale: 0.995 }}
                            onClick={() => handleBindExistingCar(car)}
                            disabled={bindingCar}
                            className="w-full p-3 text-left flex items-center justify-between gap-2 disabled:opacity-70"
                          >
                            <div>
                              <span className="font-bold text-slate-800">{car.regNumber || 'Без номера'}</span>
                              <span className="text-slate-600 text-sm ml-2">
                                {[car.brand, car.model].filter(Boolean).join(' ')}
                              </span>
                            </div>
                            <Link2 className="w-4 h-4 text-teal-600 shrink-0" />
                          </motion.button>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'stats' && (
            <div className="space-y-4">
              <div className="bg-slate-50 rounded-lg sm:rounded-xl p-4 border border-slate-200">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Статистика по водителю</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Для разборов: баланс, ЭПЛ, смены. Если цифры не сходятся — проверьте парк/привязки.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={loadDriverStats}
                    disabled={driverStatsLoading}
                    className="px-3 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold disabled:opacity-50"
                  >
                    {driverStatsLoading ? '...' : 'Обновить'}
                  </button>
                </div>
              </div>

              {driverStatsLoading ? (
                <div className="p-4 text-sm text-slate-500">Загрузка…</div>
              ) : !driverStats ? (
                <div className="p-4 text-sm text-slate-500">Нет данных</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {driverStatsVisibility?.showBalance !== false && (
                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Баланс</p>
                      <p className="text-xl font-bold text-slate-900 mt-1 tabular-nums">
                        {Number(driverStats.balance || 0).toLocaleString('ru-RU')} ₽
                      </p>
                    </div>
                  )}
                  {driverStatsVisibility?.showShifts !== false && (
                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Активные смены</p>
                      <p className="text-xl font-bold text-slate-900 mt-1 tabular-nums">
                        {driverStats.shifts?.active ?? 0}
                      </p>
                    </div>
                  )}
                  {driverStatsVisibility?.showEpl !== false && (
                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">ЭПЛ всего</p>
                      <p className="text-xl font-bold text-slate-900 mt-1 tabular-nums">
                        {driverStats.epl?.total ?? 0}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        7д: <span className="font-semibold text-slate-700">{driverStats.epl?.epl7d ?? 0}</span> · 30д:{' '}
                        <span className="font-semibold text-slate-700">{driverStats.epl?.epl30d ?? 0}</span>
                      </p>
                    </div>
                  )}
                  <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Рейсы (rides)</p>
                    <p className="text-xl font-bold text-slate-900 mt-1 tabular-nums">
                      {driverStats.rides?.totalRides ?? 0}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Активных: <span className="font-semibold text-slate-700">{driverStats.rides?.activeRides ?? 0}</span>
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'security' && (
            <form onSubmit={handleSetPassword} className="space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-slate-800 mb-1">Смена пароля</p>
                <p className="text-xs text-slate-600">
                  Пароль меняется сразу. Опционально можно включить флаг, чтобы водителя попросило сменить пароль при следующем входе.
                </p>
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-2">Новый пароль *</label>
                <div className="relative">
                  <input
                    type={pwdShow ? 'text' : 'password'}
                    value={pwdNew}
                    onChange={(e) => setPwdNew(e.target.value)}
                    className="w-full px-4 py-3 pr-12 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                    placeholder="Минимум 6 символов"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setPwdShow((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    title={pwdShow ? 'Скрыть' : 'Показать'}
                  >
                    {pwdShow ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-2">Повтор *</label>
                <input
                  type={pwdShow ? 'text' : 'password'}
                  value={pwdConfirm}
                  onChange={(e) => setPwdConfirm(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                  placeholder="Повторите пароль"
                  required
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700 select-none">
                <input
                  type="checkbox"
                  checked={pwdMustChangeOnLogin}
                  onChange={(e) => setPwdMustChangeOnLogin(e.target.checked)}
                />
                Попросить сменить пароль при следующем входе
              </label>

              <div className="flex gap-3 pt-2 border-t border-slate-200">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={onClose}
                  disabled={pwdSaving}
                  className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 font-semibold transition disabled:opacity-50"
                >
                  Закрыть
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  disabled={pwdSaving}
                  className="flex-1 py-3 bg-gradient-to-r from-teal-600 to-teal-800 text-white rounded-xl hover:from-teal-700 hover:to-teal-900 font-semibold transition shadow-md disabled:opacity-50"
                >
                  {pwdSaving ? 'Сохраняем...' : 'Сменить пароль'}
                </motion.button>
              </div>
            </form>
          )}
        </div>
      </Modal>

      {/* Модалка пополнения баланса */}
      {showBalanceModal && (
        <Modal
          isOpen={showBalanceModal}
          onClose={() => {
            setShowBalanceModal(false);
            setBalanceAmount('');
          }}
          title="Пополнить баланс"
          size="sm"
        >
          <div className="space-y-4">
            <p className="text-slate-600 text-sm mb-4">{driver.fullName || driver.phone}</p>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Сумма (₽)</label>
              <input
                type="number"
                min="1"
                step="1"
                value={balanceAmount}
                onChange={(e) => setBalanceAmount(e.target.value)}
                placeholder="0"
                className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Тип</label>
              <select
                value={balanceType}
                onChange={(e) => setBalanceType(e.target.value)}
                className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
              >
                <option value="real">Реальные (из кассы)</option>
                <option value="unreal">Бонусные (нереальные)</option>
              </select>
            </div>
            <div className="flex gap-3 pt-4 border-t border-slate-200">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleBalanceTopup}
                disabled={savingBalance || !balanceAmount}
                className="flex-1 py-3 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white rounded-xl hover:from-emerald-700 hover:to-emerald-800 font-semibold transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingBalance ? 'Сохранение...' : 'Пополнить'}
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  setShowBalanceModal(false);
                  setBalanceAmount('');
                }}
                className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 font-semibold transition"
              >
                Отмена
              </motion.button>
            </div>
          </div>
        </Modal>
      )}

      {/* Модалка привязки автомобиля (только свободные авто) */}
      {showBindCarModal && cars && (
        <BindCarModal
          driver={driver}
          cars={cars}
          freeCarsOnly
          isOpen={showBindCarModal}
          onClose={() => setShowBindCarModal(false)}
          onSave={() => {
            if (onSave) onSave();
            setShowBindCarModal(false);
          }}
        />
      )}

      {/* Карточка авто с редактированием */}
      {showCarSettingsModal && currentCar && parkId && (
        <CarSettingsModal
          car={currentCar}
          parkId={parkId}
          drivers={drivers || []}
          isOpen={showCarSettingsModal}
          onClose={() => setShowCarSettingsModal(false)}
          onSave={() => {
            if (onSave) onSave();
            setShowCarSettingsModal(false);
          }}
        />
      )}

      {/* Добавить новый автомобиль и привязать */}
      {showAddCarModal && (
        <AddCarModal
          isOpen={showAddCarModal}
          onClose={() => setShowAddCarModal(false)}
          onSave={handleAddCarAndBind}
          parkId={parkId || undefined}
        />
      )}
    </>
  );
}
