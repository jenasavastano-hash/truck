import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { UserCircle, Shield, Save } from 'lucide-react';
import api from '../../api';
import Modal from '../ui/Modal';

export default function ManagerSettingsModal({ manager, isOpen, onClose, onSave, onDelete }) {
  const [activeTab, setActiveTab] = useState('profile'); // 'profile' или 'permissions'
  const [formData, setFormData] = useState({
    fullName: '',
    username: '',
    phone: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [permissions, setPermissions] = useState({
    canTopupBalance: false,
    canFine: false,
    canDismiss: false,
    canDeleteDriver: false,
    canShowBalanceBreakdown: false,
    canAccessPhotoControl: false,
    managerType: 'park',
    canAccessStatistics: false,
    statsShowFinance: true,
    statsShowEpl: true,
    statsShowDrivers: true,
    canViewEplLogs: false,
    canControlEplQueue: false,
    canCloseEplShifts: false,
    canChargeOnShiftClose: false,
    canDownloadEplDocs: false,
    canChangeDriverPassword: false,
    canAccessBroadcasts: false,
    canAccessFinance: false,
    financeShowKassa: true,
    financeShowSalary: true,
    financeShowParks: true,
    financeShowMonthly: true,
    financeScopeAll: false,
    driverStatsShowBalance: true,
    driverStatsShowEpl: true,
    driverStatsShowShifts: true,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen && manager) {
      setFormData({
        fullName: manager.fullName || '',
        username: manager.username || '',
        phone: manager.phone || '',
        newPassword: '',
        confirmPassword: ''
      });
      setPermissions({
        canTopupBalance: manager.canTopupBalance || false,
        canFine: manager.canFine || false,
        canDismiss: manager.canDismiss || false,
        canDeleteDriver: manager.canDeleteDriver || false,
        canShowBalanceBreakdown: manager.canShowBalanceBreakdown || false,
        canAccessPhotoControl: !!manager.canAccessPhotoControl,
        managerType: manager.managerType === 'fc' ? 'fc' : 'park',
        canAccessStatistics: !!manager.canAccessStatistics,
        statsShowFinance: manager.statsShowFinance !== false && manager.statsShowFinance !== 0,
        statsShowEpl: manager.statsShowEpl !== false && manager.statsShowEpl !== 0,
        statsShowDrivers: manager.statsShowDrivers !== false && manager.statsShowDrivers !== 0,
        canViewEplLogs: !!manager.canViewEplLogs,
        canControlEplQueue: !!manager.canControlEplQueue,
        canCloseEplShifts: !!manager.canCloseEplShifts,
        canChargeOnShiftClose: !!manager.canChargeOnShiftClose,
        canDownloadEplDocs: !!manager.canDownloadEplDocs,
        canChangeDriverPassword: !!manager.canChangeDriverPassword,
        canAccessBroadcasts: !!manager.canAccessBroadcasts,
        canAccessFinance: !!manager.canAccessFinance,
        financeShowKassa: manager.financeShowKassa !== false && manager.financeShowKassa !== 0,
        financeShowSalary: manager.financeShowSalary !== false && manager.financeShowSalary !== 0,
        financeShowParks: manager.financeShowParks !== false && manager.financeShowParks !== 0,
        financeShowMonthly: manager.financeShowMonthly !== false && manager.financeShowMonthly !== 0,
        financeScopeAll: !!manager.financeScopeAll,
        driverStatsShowBalance: manager.driverStatsShowBalance !== false && manager.driverStatsShowBalance !== 0,
        driverStatsShowEpl: manager.driverStatsShowEpl !== false && manager.driverStatsShowEpl !== 0,
        driverStatsShowShifts: manager.driverStatsShowShifts !== false && manager.driverStatsShowShifts !== 0,
      });
    }
  }, [isOpen, manager]);

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!manager) return;
    setSaving(true);
    try {
      const updates = {};
      if (formData.fullName !== manager.fullName) updates.fullName = formData.fullName;
      if (formData.phone !== manager.phone) updates.phone = formData.phone;
      if (formData.newPassword && formData.newPassword === formData.confirmPassword) {
        updates.newPassword = formData.newPassword;
      }

      if (Object.keys(updates).length > 0) {
        await api.put(`/admin/managers/${manager.id}`, updates);
      }

      if (formData.newPassword && formData.newPassword !== formData.confirmPassword) {
        alert('Пароли не совпадают');
        setSaving(false);
        return;
      }

      if (onSave) onSave();
      onClose();
    } catch (e) {
      alert(`❌ Ошибка: ${e.response?.data?.error || e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSavePermissions = async () => {
    if (!manager) return;
    setSaving(true);
    try {
      const { managerType, ...rest } = permissions;
      await api.put(`/admin/managers/${manager.id}/permissions`, { ...rest, managerType });
      if (onSave) onSave();
      onClose();
    } catch (e) {
      alert(`❌ Ошибка: ${e.response?.data?.error || e.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!manager) return null;

  const permissionLabels = [
    { key: 'canTopupBalance', label: 'Пополнить баланс водителю', icon: '💰' },
    { key: 'canShowBalanceBreakdown', label: 'Разделять отображаемый баланс водителя (реал / фантики)', icon: '📊' },
    { key: 'canFine', label: 'Штраф', icon: '⚠️' },
    { key: 'canDismiss', label: 'Уволить', icon: '🚪' },
    { key: 'canDeleteDriver', label: 'Удалить из системы', icon: '🗑️' },
    { key: 'canChangeDriverPassword', label: 'Сменить пароль водителю (в карточке водителя)', icon: '🔐' },
    { key: 'canAccessBroadcasts', label: 'Доступ к рассылкам (мониторинг водителей + уведомления)', icon: '📣' },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Настройки менеджера: ${manager.fullName || manager.username}`}
      size="lg"
      className="max-h-[95vh] sm:max-h-[90vh]"
    >
      {/* Табы */}
      <div className="border-b border-slate-200 mb-4">
        <div className="flex gap-1 overflow-x-auto">
          {[
            { id: 'profile', label: 'Профиль', icon: UserCircle },
            { id: 'permissions', label: 'Доступы', icon: Shield }
          ].map((tab) => {
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
                    ? 'bg-teal-50 text-teal-700 border-b-2 border-teal-600'
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
        {activeTab === 'profile' && (
          <form onSubmit={handleSaveProfile} className="space-y-4 sm:space-y-6">
          <div>
            <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 sm:mb-2">ФИО *</label>
            <input
              type="text"
              value={formData.fullName}
              onChange={(e) => setFormData({...formData, fullName: e.target.value})}
              placeholder="Иван Иванов"
              className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
              required
            />
          </div>

          <div>
            <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 sm:mb-2">Логин</label>
            <input
              type="text"
              value={formData.username}
              disabled
              className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl bg-slate-100 text-slate-600 cursor-not-allowed"
            />
            <p className="text-xs text-slate-500 mt-1">Логин нельзя изменить (это телефон менеджера)</p>
          </div>

          <div>
            <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 sm:mb-2">Телефон *</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({...formData, phone: e.target.value})}
              placeholder="+7 (999) 123-45-67"
              className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
              required
            />
          </div>

          <div className="pt-4 border-t border-slate-200">
            <h4 className="text-xs sm:text-sm font-semibold text-slate-700 mb-3">Изменить пароль</h4>
            <div className="space-y-3">
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 sm:mb-2">Новый пароль</label>
                <input
                  type="password"
                  value={formData.newPassword}
                  onChange={(e) => setFormData({...formData, newPassword: e.target.value})}
                  placeholder="Оставьте пустым, если не хотите менять"
                  className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 sm:mb-2">Подтвердите пароль</label>
                <input
                  type="password"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({...formData, confirmPassword: e.target.value})}
                  placeholder="Повторите новый пароль"
                  className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                />
              </div>
              {formData.newPassword && formData.newPassword !== formData.confirmPassword && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                  Пароли не совпадают
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 pt-3 sm:pt-4 border-t border-slate-200">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={onClose}
              className="w-full sm:flex-1 px-4 py-2.5 sm:py-3 bg-slate-100 text-slate-700 rounded-lg sm:rounded-xl hover:bg-slate-200 font-semibold text-sm sm:text-base transition"
            >
              Отмена
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={saving}
              className="w-full sm:flex-1 px-4 py-2.5 sm:py-3 bg-gradient-to-r from-teal-600 to-teal-700 text-white rounded-lg sm:rounded-xl hover:from-teal-700 hover:to-teal-800 font-semibold text-sm sm:text-base transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Сохранение...' : 'Сохранить'}
            </motion.button>
          </div>
        </form>
        )}

        {activeTab === 'permissions' && (
        <div className="space-y-4">
          <div className="mb-4">
            <label className="block text-sm font-semibold text-slate-700 mb-2">Тип доступа</label>
            <select
              value={permissions.managerType}
              onChange={(e) => setPermissions({ ...permissions, managerType: e.target.value })}
              className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
            >
              <option value="park">Менеджер парка — Автопарк и Водители</option>
              <option value="fc">Менеджер ФК — только Фотоконтроль</option>
            </select>
            <p className="text-xs text-slate-500 mt-1.5">
              По умолчанию: только автопарк и водители. Фотоконтроль — отдельный доступ (только заявки ФК).
            </p>
          </div>
          {permissions.managerType === 'park' && (
          <>
          <label className="flex items-start gap-3 p-4 border-2 rounded-xl cursor-pointer transition-all hover:bg-sky-50 hover:border-sky-300 mb-4">
            <input
              type="checkbox"
              checked={permissions.canAccessPhotoControl}
              onChange={(e) => setPermissions({...permissions, canAccessPhotoControl: e.target.checked})}
              className="mt-1 w-5 h-5 rounded border-slate-300 text-teal-600 focus:ring-2 focus:ring-teal-500"
            />
            <div className="flex-1">
              <div className="font-semibold text-slate-800">📷 Доступ к Фотоконтролю</div>
              <p className="text-xs text-slate-500 mt-0.5">В меню появится раздел «Фотоконтроль»</p>
            </div>
          </label>
          <p className="text-sm text-slate-600">
            Дополнительные права для менеджера парка
          </p>
          <div className="space-y-3">
            {permissionLabels.map(({ key, label, icon }) => (
              <label key={key} className="flex items-start gap-3 p-4 border-2 rounded-xl cursor-pointer transition-all hover:bg-teal-50 hover:border-teal-300">
                <input
                  type="checkbox"
                  checked={permissions[key]}
                  onChange={(e) => setPermissions({...permissions, [key]: e.target.checked})}
                  className="mt-1 w-5 h-5 rounded border-slate-300 text-teal-600 focus:ring-2 focus:ring-teal-500"
                />
                <div className="flex-1">
                  <div className="font-semibold text-slate-800">{icon} {label}</div>
                </div>
              </label>
            ))}
            <label className="flex items-start gap-3 p-4 border-2 rounded-xl cursor-pointer transition-all hover:bg-teal-50 hover:border-teal-300">
              <input
                type="checkbox"
                checked={permissions.canViewEplLogs}
                onChange={(e) => setPermissions({ ...permissions, canViewEplLogs: e.target.checked })}
                className="mt-1 w-5 h-5 rounded border-slate-300 text-teal-600 focus:ring-2 focus:ring-teal-500"
              />
              <div className="flex-1">
                <div className="font-semibold text-slate-800">📄 Просматривать логи ЭПЛ</div>
                <p className="text-xs text-slate-500 mt-0.5">Показывать историю интеграции по ЭПЛ (для разборов)</p>
              </div>
            </label>
            <label className="flex items-start gap-3 p-4 border-2 rounded-xl cursor-pointer transition-all hover:bg-teal-50 hover:border-teal-300">
              <input
                type="checkbox"
                checked={permissions.canControlEplQueue}
                onChange={(e) => setPermissions({ ...permissions, canControlEplQueue: e.target.checked })}
                className="mt-1 w-5 h-5 rounded border-slate-300 text-teal-600 focus:ring-2 focus:ring-teal-500"
              />
              <div className="flex-1">
                <div className="font-semibold text-slate-800">🔁 Управлять очередью QR Минтранса</div>
                <p className="text-xs text-slate-500 mt-0.5">Разрешить перекидывать ЭПЛ в приоритетную очередь запроса QR</p>
              </div>
            </label>
            <label className="flex items-start gap-3 p-4 border-2 rounded-xl cursor-pointer transition-all hover:bg-teal-50 hover:border-teal-300">
              <input
                type="checkbox"
                checked={permissions.canCloseEplShifts}
                onChange={(e) => setPermissions({ ...permissions, canCloseEplShifts: e.target.checked })}
                className="mt-1 w-5 h-5 rounded border-slate-300 text-teal-600 focus:ring-2 focus:ring-teal-500"
              />
              <div className="flex-1">
                <div className="font-semibold text-slate-800">⏱ Закрывать смены из ЭПЛ</div>
                <p className="text-xs text-slate-500 mt-0.5">Разрешить менеджеру закрывать смену водителя из карточки ЭПЛ</p>
              </div>
            </label>
            <label className="flex items-start gap-3 p-4 border-2 rounded-xl cursor-pointer transition-all hover:bg-teal-50 hover:border-teal-300">
              <input
                type="checkbox"
                checked={permissions.canChargeOnShiftClose}
                onChange={(e) => setPermissions({ ...permissions, canChargeOnShiftClose: e.target.checked })}
                className="mt-1 w-5 h-5 rounded border-slate-300 text-teal-600 focus:ring-2 focus:ring-teal-500"
              />
              <div className="flex-1">
                <div className="font-semibold text-slate-800">💸 Списывать деньги при закрытии смены</div>
                <p className="text-xs text-slate-500 mt-0.5">Разрешить вводить сумму и списывать средства при ручном закрытии смены</p>
              </div>
            </label>
            <label className="flex items-start gap-3 p-4 border-2 rounded-xl cursor-pointer transition-all hover:bg-teal-50 hover:border-teal-300">
              <input
                type="checkbox"
                checked={permissions.canDownloadEplDocs}
                onChange={(e) => setPermissions({ ...permissions, canDownloadEplDocs: e.target.checked })}
                className="mt-1 w-5 h-5 rounded border-slate-300 text-teal-600 focus:ring-2 focus:ring-teal-500"
              />
              <div className="flex-1">
                <div className="font-semibold text-slate-800">📎 Скачивать документы ЭПЛ</div>
                <p className="text-xs text-slate-500 mt-0.5">Разрешить скачивать наш PDF, Минтранс PDF и QR Минтранса из карточки ЭПЛ</p>
              </div>
            </label>
          </div>
          </>
          )}

          {/* Статистика */}
          {permissions.managerType === 'park' && (
          <div className="border-2 border-violet-200 rounded-xl overflow-hidden">
            <label className="flex items-start gap-3 p-4 cursor-pointer transition-all hover:bg-violet-50 bg-violet-50/50">
              <input
                type="checkbox"
                checked={permissions.canAccessStatistics}
                onChange={(e) => setPermissions({ ...permissions, canAccessStatistics: e.target.checked })}
                className="mt-1 w-5 h-5 rounded border-slate-300 text-violet-600 focus:ring-2 focus:ring-violet-500"
              />
              <div className="flex-1">
                <div className="font-semibold text-slate-800">📊 Доступ к Статистике</div>
                <p className="text-xs text-slate-500 mt-0.5">В меню появится раздел «Статистика» по парку</p>
              </div>
            </label>
            {permissions.canAccessStatistics && (
              <div className="px-4 pb-4 pt-2 bg-white space-y-2 border-t border-violet-200">
                <p className="text-xs font-semibold text-slate-600 mb-2">Разделы статистики:</p>
                {[
                  { key: 'statsShowFinance', label: 'Финансы (пополнения, траты, баланс)' },
                  { key: 'statsShowEpl', label: 'ЭПЛ (путевые листы, смены)' },
                  { key: 'statsShowDrivers', label: 'Водители и авто' },
                ].map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2.5 cursor-pointer hover:bg-slate-50 rounded-lg px-2 py-1.5 transition">
                    <input
                      type="checkbox"
                      checked={permissions[key]}
                      onChange={(e) => setPermissions({ ...permissions, [key]: e.target.checked })}
                      className="w-4 h-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                    />
                    <span className="text-sm text-slate-700">{label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          )}

          {/* Касса (финансовый дашборд) */}
          {permissions.managerType === 'park' && (
            <div className="border-2 border-teal-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-teal-50/60 border-b border-teal-200">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={permissions.canAccessFinance}
                    onChange={(e) => setPermissions({ ...permissions, canAccessFinance: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  <div>
                    <p className="font-semibold text-slate-800">💰 Касса (финансовый дашборд)</p>
                    <p className="text-xs text-slate-500 mt-0.5">Доступ к разделу Касса с финансовой сводкой</p>
                  </div>
                </label>
              </div>
              {permissions.canAccessFinance && (
                <div className="px-4 py-3 bg-white space-y-2">
                  <p className="text-xs font-medium text-slate-500 mb-1">Видимые вкладки:</p>
                  {[
                    { key: 'financeShowKassa', label: 'Касса (общая сводка)' },
                    { key: 'financeShowSalary', label: 'ЗП по дням' },
                    { key: 'financeShowParks', label: 'По паркам' },
                    { key: 'financeShowMonthly', label: 'Помесячно' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2.5 cursor-pointer hover:bg-slate-50 rounded-lg px-2 py-1.5 transition">
                      <input
                        type="checkbox"
                        checked={!!permissions[key]}
                        onChange={(e) => setPermissions({ ...permissions, [key]: e.target.checked })}
                        className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                      />
                      <span className="text-sm text-slate-700">{label}</span>
                    </label>
                  ))}
                  <div className="pt-2 mt-2 border-t border-slate-100">
                    <label className="flex items-center gap-2.5 cursor-pointer hover:bg-slate-50 rounded-lg px-2 py-1.5 transition">
                      <input
                        type="checkbox"
                        checked={!!permissions.financeScopeAll}
                        onChange={(e) => setPermissions({ ...permissions, financeScopeAll: e.target.checked })}
                        className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                      />
                      <div>
                        <span className="text-sm text-slate-700">Видеть все парки</span>
                        <p className="text-xs text-slate-400">Если выкл — видит только свой парк</p>
                      </div>
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Статистика водителя (карточка водителя) */}
          {permissions.managerType === 'park' && (
            <div className="border-2 border-teal-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-teal-50/60 border-b border-teal-200">
                <p className="font-semibold text-slate-800">📌 Статистика водителя (в карточке)</p>
                <p className="text-xs text-slate-500 mt-0.5">Какие блоки видит менеджер, когда открывает карточку водителя.</p>
              </div>
              <div className="px-4 py-3 bg-white space-y-2">
                {[
                  { key: 'driverStatsShowBalance', label: 'Баланс' },
                  { key: 'driverStatsShowEpl', label: 'ЭПЛ (total/7d/30d/last)' },
                  { key: 'driverStatsShowShifts', label: 'Активные смены' },
                ].map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2.5 cursor-pointer hover:bg-slate-50 rounded-lg px-2 py-1.5 transition">
                    <input
                      type="checkbox"
                      checked={!!permissions[key]}
                      onChange={(e) => setPermissions({ ...permissions, [key]: e.target.checked })}
                      className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                    />
                    <span className="text-sm text-slate-700">{label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Кнопка удаления */}
          {onDelete && (
            <div className="pt-4 border-t border-red-200">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  if (window.confirm(`Вы уверены, что хотите удалить менеджера "${manager.fullName || manager.username}"?`)) {
                    onDelete(manager);
                    onClose();
                  }
                }}
                className="w-full px-4 py-3 bg-red-600 text-white rounded-xl hover:bg-red-700 font-semibold transition shadow-md flex items-center justify-center gap-2"
              >
                🗑️ Удалить менеджера
              </motion.button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 pt-3 sm:pt-4 border-t border-slate-200">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onClose}
              className="w-full sm:flex-1 px-4 py-2.5 sm:py-3 bg-slate-100 text-slate-700 rounded-lg sm:rounded-xl hover:bg-slate-200 font-semibold text-sm sm:text-base transition"
            >
              Отмена
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleSavePermissions}
              disabled={saving}
              className="w-full sm:flex-1 px-4 py-2.5 sm:py-3 bg-gradient-to-r from-teal-600 to-teal-700 text-white rounded-lg sm:rounded-xl hover:from-teal-700 hover:to-teal-800 font-semibold text-sm sm:text-base transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Сохранение...' : 'Сохранить'}
            </motion.button>
          </div>
        </div>
        )}
      </div>
    </Modal>
  );
}
