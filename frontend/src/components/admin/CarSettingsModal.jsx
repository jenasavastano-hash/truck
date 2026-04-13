import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Car, Save, User, BarChart3, Settings, Trash2, Link2, Unlink, Search } from 'lucide-react';
import api from '../../api';
import Modal from '../ui/Modal';
import BindDriverModal from './BindDriverModal';
import { useAuth } from '../../AuthContext';

export default function CarSettingsModal({ car, parkId, drivers, isOpen, onClose, onSave, onDelete, onOpenDriverSettings }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [activeTab, setActiveTab] = useState('info'); // 'info', 'driver', 'stats'
  const [formData, setFormData] = useState({
    regNumber: '',
    brand: '',
    model: '',
    vin: '',
    fuelType: 'Бензин',
    tankVolume: '',
    seasonality: 'Круглогодичная',
    fuelUnit: 'Литр',
    inventoryNumber: '',
    vehicleType: 'легковой',
    ownerId: ''
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showBindDriverModal, setShowBindDriverModal] = useState(false);
  const [owners, setOwners] = useState([]);
  const [unlinking, setUnlinking] = useState(false);
  const [binding, setBinding] = useState(false);
  const [driverSearchQuery, setDriverSearchQuery] = useState('');
  const hasAutoOpenedDriverRef = useRef(false);

  useEffect(() => {
    if (isOpen && (isAdmin ? parkId : true)) {
      const url = isAdmin ? `/admin/parks/${parkId}/owners` : `/manager/owners`;
      api.get(url)
        .then(r => setOwners(r.data || []))
        .catch(() => setOwners([]));
    }
  }, [isOpen, parkId, isAdmin]);

  useEffect(() => {
    if (isOpen && car) {
      setFormData({
        regNumber: car.regNumber || '',
        brand: car.brand || '',
        model: car.model || '',
        vin: car.vin || '',
        fuelType: car.fuelType || 'Бензин',
        tankVolume: car.tankVolume || '',
        seasonality: car.seasonality || 'Круглогодичная',
        fuelUnit: car.fuelUnit || 'Литр',
        inventoryNumber: car.inventoryNumber || '',
        vehicleType: car.vehicleType || 'легковой',
        ownerId: car.ownerId || ''
      });
    }
  }, [isOpen, car]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!car) return;
    setSaving(true);
    try {
      const url = isAdmin ? `/admin/cars/${car.id}` : `/manager/cars/${car.id}`;
      await api.put(url, formData);
      alert('✅ Автомобиль обновлен');
      if (onSave) onSave();
      onClose();
    } catch (e) {
      alert(`❌ Ошибка: ${e.response?.data?.error || e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleUnlinkDriver = async () => {
    if (!car || !currentDriver) return;
    if (!window.confirm(`Отвязать водителя "${currentDriver.fullName || currentDriver.phone}" от автомобиля "${car.regNumber}"?`)) return;
    setUnlinking(true);
    try {
      if (user?.role === 'admin') {
        await api.put(`/admin/drivers/${currentDriver.userId}/car`, { carId: null });
      } else {
        await api.put(`/manager/drivers/${currentDriver.id}`, { carId: null });
      }
      alert('✅ Водитель отвязан');
      if (onSave) onSave();
    } catch (e) {
      alert(`❌ Ошибка: ${e.response?.data?.error || e.message}`);
    } finally {
      setUnlinking(false);
    }
  };

  const handleDelete = async () => {
    if (!car) return;
    if (!window.confirm(`Удалить автомобиль "${car.regNumber}"?`)) return;
    
    setLoading(true);
    try {
      const url = isAdmin ? `/admin/cars/${car.id}` : `/manager/cars/${car.id}`;
      await api.delete(url);
      alert('✅ Автомобиль удален');
      if (onDelete) onDelete();
      onClose();
    } catch (e) {
      alert(`❌ Ошибка: ${e.response?.data?.error || e.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!car) return null;

  const currentDriver = drivers?.find(d => d.carId === car.id || d.userId === car.driverId);
  const freeDrivers = (drivers || []).filter(d => !d.carId && !d.regNumber);
  const filteredFreeDrivers = freeDrivers.filter(d => {
    if (!driverSearchQuery.trim()) return true;
    const q = driverSearchQuery.toLowerCase();
    return (d.fullName || '').toLowerCase().includes(q) || (d.phone || '').toLowerCase().includes(q);
  });

  const handleBindDriver = async (driverToBind) => {
    if (!car || !driverToBind) return;
    if (!window.confirm(`Привязать водителя "${driverToBind.fullName || driverToBind.phone}" к автомобилю "${car.regNumber || 'Без номера'}"?`)) return;
    setBinding(true);
    try {
      if (user?.role === 'admin') {
        await api.put(`/admin/drivers/${driverToBind.userId}/car`, { carId: car.id });
      } else {
        await api.put(`/manager/drivers/${driverToBind.id}`, { carId: car.id });
      }
      alert('✅ Водитель привязан');
      if (onSave) onSave();
    } catch (e) {
      alert(`❌ Ошибка: ${e.response?.data?.error || e.message}`);
    } finally {
      setBinding(false);
    }
  };

  // При открытии карточки авто без водителя — сразу показываем вкладку Водитель
  useEffect(() => {
    if (isOpen && !currentDriver && !hasAutoOpenedDriverRef.current) {
      hasAutoOpenedDriverRef.current = true;
      setActiveTab('driver');
    }
    if (!isOpen) hasAutoOpenedDriverRef.current = false;
  }, [isOpen, currentDriver]);

  const tabs = [
    { id: 'info', label: 'Информация', icon: Car },
    { id: 'driver', label: 'Водитель', icon: User },
    { id: 'stats', label: 'Статистика', icon: BarChart3 }
  ];

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={`Автомобиль: ${car.regNumber || 'Без номера'}`}
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
          {activeTab === 'info' && (
            <form onSubmit={handleSave} className="space-y-4 sm:space-y-6">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs sm:text-sm text-amber-800">
                <strong>Для ЭПЛ/Такском:</strong> обязательны гос. номер и марка. Рекомендуется: модель, тип ТС (например «легковой»).
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 sm:mb-2">Номер *</label>
                  <input
                    type="text"
                    value={formData.regNumber}
                    onChange={(e) => setFormData({...formData, regNumber: e.target.value})}
                    className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 sm:mb-2">Марка *</label>
                  <input
                    type="text"
                    value={formData.brand}
                    onChange={(e) => setFormData({...formData, brand: e.target.value})}
                    className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 sm:mb-2">Модель</label>
                  <input
                    type="text"
                    value={formData.model}
                    onChange={(e) => setFormData({...formData, model: e.target.value})}
                    className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 sm:mb-2">Тип ТС (для ЭПЛ)</label>
                  <input
                    type="text"
                    value={formData.vehicleType}
                    onChange={(e) => setFormData({...formData, vehicleType: e.target.value})}
                    placeholder="легковой"
                    className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                  />
                  <p className="text-xs text-slate-500 mt-1">Например: легковой, грузовой</p>
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 sm:mb-2">VIN</label>
                  <input
                    type="text"
                    value={formData.vin}
                    onChange={(e) => setFormData({...formData, vin: e.target.value})}
                    className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 sm:mb-2">Тип топлива</label>
                  <select
                    value={formData.fuelType}
                    onChange={(e) => setFormData({...formData, fuelType: e.target.value})}
                    className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                  >
                    <option value="Бензин">Бензин</option>
                    <option value="Дизель">Дизель</option>
                    <option value="Газ">Газ</option>
                    <option value="Электричество">Электричество</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 sm:mb-2">Объем бака</label>
                  <input
                    type="text"
                    value={formData.tankVolume}
                    onChange={(e) => setFormData({...formData, tankVolume: e.target.value})}
                    placeholder="л"
                    className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 sm:mb-2">Сезонность</label>
                  <select
                    value={formData.seasonality}
                    onChange={(e) => setFormData({...formData, seasonality: e.target.value})}
                    className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                  >
                    <option value="Круглогодичная">Круглогодичная</option>
                    <option value="Летняя">Летняя</option>
                    <option value="Зимняя">Зимняя</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 sm:mb-2">Единица измерения</label>
                  <select
                    value={formData.fuelUnit}
                    onChange={(e) => setFormData({...formData, fuelUnit: e.target.value})}
                    className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                  >
                    <option value="Литр">Литр</option>
                    <option value="Кубометр">Кубометр</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 sm:mb-2">Инвентарный номер</label>
                <input
                  type="text"
                  value={formData.inventoryNumber}
                  onChange={(e) => setFormData({...formData, inventoryNumber: e.target.value})}
                  placeholder="INV-..."
                  className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                />
                <p className="text-xs text-slate-500 mt-1">Для ЭПЛ/Такском (можно оставить пустым — сгенерируется автоматически при создании)</p>
              </div>

              {/* Владелец ТС */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 sm:mb-2">Владелец ТС (для ЭПЛ)</label>
                {owners.length > 0 ? (
                  <>
                    <select
                      value={formData.ownerId}
                      onChange={(e) => setFormData({...formData, ownerId: e.target.value})}
                      className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                    >
                      <option value="">— Не указан —</option>
                      {owners.map(o => (
                        <option key={o.id} value={o.id}>
                          {o.name} ({o.type === 'legal' ? 'ЮЛ' : 'ИП'}, {o.role === 'С' ? 'Собственник' : 'Арендодатель'})
                          {o.isDefault ? ' ★' : ''}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-500 mt-1">Организация/ИП, которому принадлежит авто — заполняется в ЭПЛ</p>
                  </>
                ) : (
                  <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    Нет юрлиц. Добавьте владельца в настройках парка (раздел «Юрлица / ИП»).
                  </p>
                )}
              </div>

              {/* Кнопки */}
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 pt-3 sm:pt-4 border-t border-slate-200">
                {onDelete && (
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleDelete}
                    disabled={loading}
                    className="w-full sm:w-auto px-4 py-2.5 sm:py-3 bg-red-500 text-white rounded-lg sm:rounded-xl hover:bg-red-600 font-semibold text-sm sm:text-base transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Удалить
                  </motion.button>
                )}
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onClose}
                  disabled={saving}
                  className="w-full sm:flex-1 px-4 py-2.5 sm:py-3 bg-slate-100 text-slate-700 rounded-lg sm:rounded-xl hover:bg-slate-200 font-semibold text-sm sm:text-base transition"
                >
                  Отмена
                </motion.button>
                <motion.button
                  type="submit"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  disabled={saving}
                  className="w-full sm:flex-1 px-4 py-2.5 sm:py-3 bg-gradient-to-r from-teal-600 to-teal-800 text-white rounded-lg sm:rounded-xl hover:from-teal-700 hover:to-teal-900 font-semibold text-sm sm:text-base transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  {saving ? 'Сохранение...' : 'Сохранить'}
                </motion.button>
              </div>
            </form>
          )}

          {activeTab === 'driver' && (
            <div className="space-y-4">
              {currentDriver ? (
                <div className="bg-emerald-50 border-2 border-emerald-200 rounded-lg sm:rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="p-2 bg-emerald-100 rounded-lg shrink-0">
                        <User className="w-5 h-5 text-emerald-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-slate-800">{currentDriver.fullName || currentDriver.phone}</p>
                        {currentDriver.phone && (
                          <p className="text-sm text-slate-600">{currentDriver.phone}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={handleUnlinkDriver}
                        disabled={unlinking}
                        className="p-2 text-red-600 hover:bg-red-100 rounded-lg transition"
                        title="Отвязать"
                      >
                        <Unlink className="w-5 h-5" />
                      </motion.button>
                      {onOpenDriverSettings ? (
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => onOpenDriverSettings(currentDriver)}
                          className="p-2 text-teal-600 hover:bg-teal-100 rounded-lg transition"
                          title="Открыть карточку водителя"
                        >
                          <Settings className="w-5 h-5" />
                        </motion.button>
                      ) : (
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => setShowBindDriverModal(true)}
                          className="p-2 text-teal-600 hover:bg-teal-100 rounded-lg transition"
                          title="Сменить водителя"
                        >
                          <Settings className="w-5 h-5" />
                        </motion.button>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-slate-600 text-sm">Выберите водителя из списка свободных — при клике запросится подтверждение связки.</p>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      value={driverSearchQuery}
                      onChange={(e) => setDriverSearchQuery(e.target.value)}
                      placeholder="Поиск по ФИО, телефону..."
                      className="w-full pl-10 pr-4 py-2.5 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                    />
                  </div>
                  <div className="max-h-56 overflow-y-auto border-2 border-slate-200 rounded-xl divide-y divide-slate-100 bg-white">
                    {filteredFreeDrivers.length === 0 ? (
                      <div className="p-8 text-center text-slate-500">
                        <User className="w-12 h-12 mx-auto mb-2 text-slate-300" />
                        <p className="font-medium">{freeDrivers.length === 0 ? 'Нет свободных водителей' : 'Нет результатов поиска'}</p>
                        <p className="text-sm mt-1">Добавьте водителя в разделе «Водители»</p>
                      </div>
                    ) : (
                      filteredFreeDrivers.map((d) => (
                        <motion.button
                          key={d.userId || d.id}
                          whileHover={{ backgroundColor: '#f8fafc' }}
                          whileTap={{ scale: 0.995 }}
                          onClick={() => handleBindDriver(d)}
                          disabled={binding}
                          className="w-full p-4 text-left flex items-center justify-between gap-3 hover:bg-slate-50 transition disabled:opacity-70"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="p-2 bg-slate-100 rounded-lg shrink-0">
                              <User className="w-5 h-5 text-slate-600" />
                            </div>
                            <div className="min-w-0 text-left">
                              <p className="font-semibold text-slate-800 truncate">{d.fullName || d.phone || 'Без имени'}</p>
                              {d.phone && <p className="text-sm text-slate-500">{d.phone}</p>}
                            </div>
                          </div>
                          <Link2 className="w-5 h-5 text-teal-600 shrink-0" />
                        </motion.button>
                      ))
                    )}
                  </div>
                  <p className="text-xs text-slate-400">При клике на карточку появится подтверждение — после согласия связка будет создана.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'stats' && (
            <div className="space-y-4">
              <div className="bg-slate-50 rounded-lg sm:rounded-xl p-4 border border-slate-200">
                <p className="text-sm text-slate-600 mb-2">Статистика по автомобилю</p>
                <p className="text-xs text-slate-500">Функционал в разработке</p>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Модалка привязки водителя */}
      {showBindDriverModal && (
        <BindDriverModal
          car={car}
          drivers={drivers}
          freeDriversOnly
          isOpen={showBindDriverModal}
          onClose={() => setShowBindDriverModal(false)}
          onSave={() => {
            if (onSave) onSave();
            setShowBindDriverModal(false);
          }}
        />
      )}
    </>
  );
}
