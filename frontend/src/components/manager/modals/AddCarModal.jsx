import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Modal from '../../ui/Modal';
import api from '../../../api';
import { useAuth } from '../../../AuthContext';

export default function AddCarModal({ onClose, onSave, isOpen = true, parkId: propParkId }) {
  const { user } = useAuth();
  const effectiveParkId = propParkId || user?.parkId;
  const [formData, setFormData] = useState({
    regNumber: '',
    brand: '',
    model: '',
    vin: '',
    fuelType: '',
    tankVolume: '',
    seasonality: '',
    fuelUnit: '',
    vehicleType: 'легковой',
    inventoryNumber: '',
    ownerId: ''
  });
  const [loading, setLoading] = useState(false);
  const [owners, setOwners] = useState([]);

  useEffect(() => {
    if (!effectiveParkId) return;
    const url = user?.role === 'admin'
      ? `/admin/parks/${effectiveParkId}/owners`
      : `/manager/owners`;
    api.get(url)
      .then(r => setOwners(r.data || []))
      .catch(() => setOwners([]));
  }, [effectiveParkId, user?.role]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.regNumber || !formData.brand) {
      alert('Заполни обязательные поля');
      return;
    }

    try {
      setLoading(true);
      await onSave(formData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Добавить автомобиль"
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
          {/* Row 1 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Гос. номер* <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                name="regNumber"
                value={formData.regNumber}
                onChange={handleChange}
                placeholder="Например: А 123 АА 77"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Марка <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                name="brand"
                value={formData.brand}
                onChange={handleChange}
                placeholder="Например: Toyota"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                required
              />
            </div>
          </div>

          {/* Row 2 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Модель
              </label>
              <input
                type="text"
                name="model"
                value={formData.model}
                onChange={handleChange}
                placeholder="Например: Camry"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                VIN номер
              </label>
              <input
                type="text"
                name="vin"
                value={formData.vin}
                onChange={handleChange}
                placeholder="Например: JTHBP5C29A5034186"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>

          {/* Row 3 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Тип топлива
              </label>
              <select
                name="fuelType"
                value={formData.fuelType}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="">Выбери...</option>
                <option value="Бензин">Бензин</option>
                <option value="Дизель">Дизель</option>
                <option value="Газ">Газ</option>
                <option value="Электро">Электро</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Объём бака (л)
              </label>
              <input
                type="number"
                name="tankVolume"
                value={formData.tankVolume}
                onChange={handleChange}
                placeholder="Например: 60"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>

          {/* Тип ТС и инв. номер */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Тип ТС (для ЭПЛ)</label>
              <input
                type="text"
                name="vehicleType"
                value={formData.vehicleType}
                onChange={handleChange}
                placeholder="легковой"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Инв. номер (необязательно)</label>
              <input
                type="text"
                name="inventoryNumber"
                value={formData.inventoryNumber}
                onChange={handleChange}
                placeholder="Оставьте пустым для автогенерации"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>

          {/* Row 4 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Сезонность
              </label>
              <select
                name="seasonality"
                value={formData.seasonality}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="">Выбери...</option>
                <option value="Круглогодичная">Круглогодичная</option>
                <option value="Летняя">Летняя</option>
                <option value="Зимняя">Зимняя</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Единица топлива
              </label>
              <select
                name="fuelUnit"
                value={formData.fuelUnit}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="">Выбери...</option>
                <option value="Литр">Литр</option>
                <option value="Кубометр">Кубометр</option>
              </select>
            </div>
          </div>

          {/* Владелец ТС */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Владелец ТС (для ЭПЛ)</label>
            {owners.length > 0 ? (
              <select
                name="ownerId"
                value={formData.ownerId}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="">— Не указан —</option>
                {owners.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.type === 'legal' ? 'ЮЛ' : 'ИП'}, {o.role === 'С' ? 'Собственник' : 'Арендодатель'})
                    {o.isDefault ? ' ★' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-3">
                Нет юрлиц. Добавьте владельца в настройках парка (раздел «Юрлица / ИП»).
              </p>
            )}
          </div>

          {/* Info Text */}
          <div className="bg-sky-50 border border-sky-200 rounded-lg p-4">
            <p className="text-sm text-sky-900">
              💡 <strong>Инвентарный номер</strong> будет сгенерирован автоматически при синхронизации с Такском.
            </p>
          </div>

        {/* Buttons */}
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
            className="w-full sm:flex-1 px-4 py-2.5 sm:py-3 bg-gradient-to-r from-teal-600 to-teal-800 text-white rounded-lg sm:rounded-xl hover:from-teal-700 hover:to-teal-900 font-semibold text-sm sm:text-base transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Сохранение...' : 'Сохранить'}
          </motion.button>
        </div>
      </form>
    </Modal>
  );
}
