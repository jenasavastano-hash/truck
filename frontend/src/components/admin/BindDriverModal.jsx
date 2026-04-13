import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { User, X, Link2, Unlink } from 'lucide-react';
import api from '../../api';
import { useAuth } from '../../AuthContext';
import Modal from '../ui/Modal';

export default function BindDriverModal({ car, drivers, freeDriversOnly = false, isOpen, onClose, onSave }) {
  const { user } = useAuth();
  const [selectedDriverId, setSelectedDriverId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // car.driverId с бэка — это id строки водителя (d.id), не userId
  const currentDriverByCar = (drivers || []).find(d => d.id === car?.driverId || d.driverId === car?.driverId);

  useEffect(() => {
    if (isOpen && car && drivers) {
      const current = (drivers || []).find(d => d.id === car.driverId || d.driverId === car.driverId);
      setSelectedDriverId(current?.userId ?? null);
    }
  }, [isOpen, car, drivers]);

  const availableDrivers = freeDriversOnly
    ? (drivers || []).filter(d => !d.carId || d.carId === car?.id)
    : (drivers || []);
  const filteredDrivers = availableDrivers.filter(driver => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      (driver.fullName || '').toLowerCase().includes(query) ||
      (driver.phone || '').toLowerCase().includes(query)
    );
  });

  const handleSave = async () => {
    if (!car) return;
    setLoading(true);
    try {
      const driverIdToSet = selectedDriverId;
      const isAdmin = user?.role === 'admin';

      if (driverIdToSet === null) {
        if (currentDriverByCar) {
          if (isAdmin) {
            await api.put(`/admin/drivers/${currentDriverByCar.userId}/car`, { carId: null });
          } else {
            await api.put(`/manager/drivers/${currentDriverByCar.id}`, { carId: null });
          }
        }
      } else {
        const currentDriver = drivers?.find(d => d.carId === car.id);
        if (currentDriver && currentDriver.userId !== driverIdToSet) {
          if (isAdmin) {
            await api.put(`/admin/drivers/${currentDriver.userId}/car`, { carId: null });
          } else {
            await api.put(`/manager/drivers/${currentDriver.id}`, { carId: null });
          }
        }
        const driverToBind = drivers?.find(d => d.userId === driverIdToSet);
        if (driverToBind) {
          if (isAdmin) {
            await api.put(`/admin/drivers/${driverIdToSet}/car`, { carId: car.id });
          } else {
            await api.put(`/manager/drivers/${driverToBind.id}`, { carId: car.id });
          }
        }
      }

      alert('✅ Водитель ' + (driverIdToSet === null ? 'отвязан' : 'привязан'));
      if (onSave) onSave();
      onClose();
    } catch (e) {
      alert(`❌ Ошибка: ${e.response?.data?.error || e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUnbind = async () => {
    if (!car || !currentDriverByCar) return;
    if (!window.confirm(`Отвязать водителя "${currentDriverByCar.fullName || currentDriverByCar.phone}" от автомобиля "${car.regNumber}"?`)) {
      return;
    }
    setLoading(true);
    try {
      if (user?.role === 'admin') {
        await api.put(`/admin/drivers/${currentDriverByCar.userId}/car`, { carId: null });
      } else {
        await api.put(`/manager/drivers/${currentDriverByCar.id}`, { carId: null });
      }
      alert('✅ Водитель отвязан');
      if (onSave) onSave();
      onClose();
    } catch (e) {
      alert(`❌ Ошибка: ${e.response?.data?.error || e.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!car) return null;

  const currentDriver = currentDriverByCar;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Привязка водителя: ${car.regNumber || 'Без номера'}`}
      size="md"
    >
      <div className="space-y-4">
        {/* Текущий водитель */}
        {currentDriver && (
          <div className="bg-emerald-50 border-2 border-emerald-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <User className="w-5 h-5 text-emerald-600" />
              <span className="font-semibold text-slate-800">Текущий водитель:</span>
            </div>
            <div className="text-sm text-slate-700">
              <p className="font-bold">{currentDriver.fullName || currentDriver.phone}</p>
              {currentDriver.phone && (
                <p className="text-slate-600">{currentDriver.phone}</p>
              )}
            </div>
          </div>
        )}

        {/* Поиск */}
        <div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск водителей..."
            className="w-full px-4 py-2 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
          />
        </div>

        {/* Список водителей */}
        <div className="max-h-64 overflow-y-auto border-2 border-slate-200 rounded-xl">
          {filteredDrivers.length === 0 ? (
            <div className="p-8 text-center text-slate-500">
              <User className="w-12 h-12 mx-auto mb-2 text-slate-300" />
              <p>Нет доступных водителей</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {filteredDrivers.map((driver) => {
                const isSelected = selectedDriverId === driver.userId;
                const isCurrent = driver.userId === car.driverId;
                const hasOtherCar = driver.carId && driver.carId !== car.id;

                return (
                  <motion.button
                    key={driver.userId}
                    whileHover={{ backgroundColor: '#f1f5f9' }}
                    onClick={() => {
                      if (isCurrent) {
                        setSelectedDriverId(null); // Отвязка текущего
                      } else {
                        setSelectedDriverId(driver.userId);
                      }
                    }}
                    className={`w-full p-4 text-left transition ${
                      isSelected ? 'bg-emerald-50 border-l-4 border-emerald-600' : ''
                    } ${isCurrent ? 'bg-amber-50' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <User className={`w-4 h-4 ${isSelected ? 'text-emerald-600' : 'text-slate-600'}`} />
                          <span className={`font-bold ${isSelected ? 'text-emerald-700' : 'text-slate-800'}`}>
                            {driver.fullName || driver.phone || 'Без имени'}
                          </span>
                          {isCurrent && (
                            <span className="text-xs bg-amber-200 text-amber-800 px-2 py-0.5 rounded">
                              Текущий
                            </span>
                          )}
                        </div>
                        {driver.phone && (
                          <p className="text-xs text-slate-600">{driver.phone}</p>
                        )}
                        {hasOtherCar && (
                          <p className="text-xs text-red-600 mt-1">
                            ⚠️ Привязан к другому авто: {driver.regNumber}
                          </p>
                        )}
                        {!hasOtherCar && !driver.carId && (
                          <p className="text-xs text-emerald-600 mt-1">
                            ✓ Без авто
                          </p>
                        )}
                      </div>
                      {isSelected && (
                        <Link2 className="w-5 h-5 text-emerald-600 shrink-0" />
                      )}
                    </div>
                  </motion.button>
                );
              })}
            </div>
          )}
        </div>

        {/* Кнопки */}
        <div className="flex gap-3 pt-4 border-t border-slate-200">
          {car.driverId && (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleUnbind}
              disabled={loading}
              className="px-4 py-2 bg-red-500 text-white rounded-xl hover:bg-red-600 font-semibold transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Unlink className="w-4 h-4" />
              Отвязать
            </motion.button>
          )}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleSave}
            disabled={loading || selectedDriverId === (currentDriverByCar?.userId ?? null)}
            className="flex-1 px-4 py-2 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white rounded-xl hover:from-emerald-700 hover:to-emerald-800 font-semibold transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Сохранение...' : selectedDriverId === null ? 'Отвязать' : 'Привязать'}
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 font-semibold transition disabled:opacity-50"
          >
            Отмена
          </motion.button>
        </div>
      </div>
    </Modal>
  );
}
