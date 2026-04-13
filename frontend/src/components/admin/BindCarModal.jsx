import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Car, X, Link2, Unlink } from 'lucide-react';
import api from '../../api';
import { useAuth } from '../../AuthContext';
import Modal from '../ui/Modal';

export default function BindCarModal({ driver, cars, freeCarsOnly = false, isOpen, onClose, onSave }) {
  const { user } = useAuth();
  const [selectedCarId, setSelectedCarId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (isOpen && driver) {
      setSelectedCarId(driver.carId || null);
    }
  }, [isOpen, driver]);

  const availableCars = freeCarsOnly
    ? (cars || []).filter(c => (!c.driverId && !(c.driver && c.driver.userId)) || c.id === driver?.carId)
    : (cars || []);
  const filteredCars = availableCars.filter(car => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      (car.regNumber || '').toLowerCase().includes(query) ||
      (car.brand || '').toLowerCase().includes(query) ||
      (car.model || '').toLowerCase().includes(query)
    );
  });

  const handleSave = async () => {
    if (!driver) return;
    setLoading(true);
    try {
      const carIdToSet = selectedCarId === driver.carId ? null : selectedCarId;
      
      // Определяем правильный эндпоинт в зависимости от роли
      let endpoint;
      let payload;
      
      if (user?.role === 'admin') {
        // Админ использует прямой эндпоинт
        endpoint = `/admin/drivers/${driver.userId}/car`;
        payload = { carId: carIdToSet === null ? null : carIdToSet };
      } else if (user?.role === 'manager') {
        // Менеджер использует эндпоинт через driverId
        endpoint = `/manager/drivers/${driver.id}`;
        payload = { carId: carIdToSet === null ? null : carIdToSet };
      } else {
        throw new Error('Недостаточно прав для привязки авто');
      }
      
      await api.put(endpoint, payload);
      alert('✅ Автомобиль ' + (carIdToSet === null ? 'отвязан' : 'привязан'));
      if (onSave) onSave();
      onClose();
    } catch (e) {
      const errorMsg = e.response?.data?.error || e.message || 'Неизвестная ошибка';
      alert(`❌ Ошибка: ${errorMsg}`);
      console.error('BindCarModal error:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleUnbind = async () => {
    if (!driver || !driver.carId) return;
    if (!window.confirm(`Отвязать автомобиль от водителя "${driver.fullName || driver.phone}"?`)) {
      return;
    }
    setLoading(true);
    try {
      // Определяем правильный эндпоинт в зависимости от роли
      let endpoint;
      let payload;
      
      if (user?.role === 'admin') {
        endpoint = `/admin/drivers/${driver.userId}/car`;
        payload = { carId: null };
      } else if (user?.role === 'manager') {
        endpoint = `/manager/drivers/${driver.id}`;
        payload = { carId: null };
      } else {
        throw new Error('Недостаточно прав для отвязки авто');
      }
      
      await api.put(endpoint, payload);
      alert('✅ Автомобиль отвязан');
      if (onSave) onSave();
      onClose();
    } catch (e) {
      const errorMsg = e.response?.data?.error || e.message || 'Неизвестная ошибка';
      alert(`❌ Ошибка: ${errorMsg}`);
      console.error('BindCarModal unbind error:', e);
    } finally {
      setLoading(false);
    }
  };

  if (!driver) return null;

  const currentCar = cars?.find(c => c.id === driver.carId);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Привязка авто: ${driver.fullName || driver.phone}`}
      size="md"
    >
      <div className="space-y-4">
        {/* Текущее авто */}
        {currentCar && (
          <div className="bg-sky-50 border-2 border-sky-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Car className="w-5 h-5 text-teal-600" />
              <span className="font-semibold text-slate-800">Текущее авто:</span>
            </div>
            <div className="text-sm text-slate-700">
              <p className="font-bold">{currentCar.regNumber}</p>
              {(currentCar.brand || currentCar.model) && (
                <p className="text-slate-600">{currentCar.brand} {currentCar.model}</p>
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
            placeholder="Поиск автомобилей..."
            className="w-full px-4 py-2 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
          />
        </div>

        {/* Список авто */}
        <div className="max-h-64 overflow-y-auto border-2 border-slate-200 rounded-xl">
          {filteredCars.length === 0 ? (
            <div className="p-8 text-center text-slate-500">
              <Car className="w-12 h-12 mx-auto mb-2 text-slate-300" />
              <p>Нет доступных автомобилей</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {filteredCars.map((car) => {
                const isSelected = selectedCarId === car.id;
                const isCurrent = car.id === driver.carId;
                const hasOtherDriver = car.driverId && car.driverId !== driver.userId;

                return (
                  <motion.button
                    key={car.id}
                    whileHover={{ backgroundColor: '#f1f5f9' }}
                    onClick={() => {
                      if (isCurrent) {
                        setSelectedCarId(null); // Отвязка текущего
                      } else {
                        setSelectedCarId(car.id);
                      }
                    }}
                    className={`w-full p-4 text-left transition ${
                      isSelected ? 'bg-teal-50 border-l-4 border-teal-600' : ''
                    } ${isCurrent ? 'bg-amber-50' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Car className={`w-4 h-4 ${isSelected ? 'text-teal-600' : 'text-slate-600'}`} />
                          <span className={`font-bold ${isSelected ? 'text-teal-800' : 'text-slate-800'}`}>
                            {car.regNumber || 'Без номера'}
                          </span>
                          {isCurrent && (
                            <span className="text-xs bg-amber-200 text-amber-800 px-2 py-0.5 rounded">
                              Текущее
                            </span>
                          )}
                        </div>
                        {(car.brand || car.model) && (
                          <p className="text-xs text-slate-600">
                            {car.brand} {car.model}
                          </p>
                        )}
                        {hasOtherDriver && (
                          <p className="text-xs text-red-600 mt-1">
                            ⚠️ Привязан к другому водителю: {car.driverName}
                          </p>
                        )}
                        {!hasOtherDriver && !car.driverId && (
                          <p className="text-xs text-emerald-600 mt-1">
                            ✓ Свободен
                          </p>
                        )}
                      </div>
                      {isSelected && (
                        <Link2 className="w-5 h-5 text-teal-600 shrink-0" />
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
          {driver.carId && (
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
            disabled={loading || selectedCarId === driver.carId}
            className="flex-1 px-4 py-2 bg-gradient-to-r from-teal-600 to-teal-800 text-white rounded-xl hover:from-teal-700 hover:to-teal-900 font-semibold transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Сохранение...' : selectedCarId === null ? 'Отвязать' : 'Привязать'}
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
