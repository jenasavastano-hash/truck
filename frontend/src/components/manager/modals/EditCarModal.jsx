import React, { useState, useEffect } from 'react';
import api from '../../../api';
import { useAuth } from '../../../AuthContext';

export default function EditCarModal({ car, onClose, onSave, parkId: propParkId }) {
  const { user } = useAuth();
  const effectiveParkId = propParkId || car?.parkId || user?.parkId;
  const [formData, setFormData] = useState({
    regNumber: '',
    brand: '',
    model: '',
    vin: '',
    fuelType: '',
    tankVolume: '',
    seasonality: '',
    fuelUnit: '',
    vehicleType: '',
    inventoryNumber: '',
    ownerId: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
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

  useEffect(() => {
    if (car) {
      setFormData({
        regNumber: car.regNumber || '',
        brand: car.brand || '',
        model: car.model || '',
        vin: car.vin || '',
        fuelType: car.fuelType || '',
        tankVolume: car.tankVolume || '',
        seasonality: car.seasonality || '',
        fuelUnit: car.fuelUnit || '',
        vehicleType: car.vehicleType || 'легковой',
        inventoryNumber: car.inventoryNumber || '',
        ownerId: car.ownerId || '',
      });
    }
  }, [car]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.regNumber || !formData.brand) {
      setError('Заполни гос. номер и марку');
      return;
    }
    try {
      setLoading(true);
      await onSave(formData);
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка при сохранении');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b sticky top-0 bg-white">
          <h2 className="text-xl font-bold text-gray-900">✏️ Редактировать автомобиль</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{error}</div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Гос. номер *</label>
              <input
                type="text"
                name="regNumber"
                value={formData.regNumber}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Марка *</label>
              <input
                type="text"
                name="brand"
                value={formData.brand}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Модель</label>
              <input
                type="text"
                name="model"
                value={formData.model}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">VIN</label>
              <input
                type="text"
                name="vin"
                value={formData.vin}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Тип топлива</label>
              <select
                name="fuelType"
                value={formData.fuelType}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="">—</option>
                <option value="Бензин">Бензин</option>
                <option value="Дизель">Дизель</option>
                <option value="Газ">Газ</option>
                <option value="Электро">Электро</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Объём бака (л)</label>
              <input
                type="number"
                name="tankVolume"
                value={formData.tankVolume}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Инв. номер</label>
              <input
                type="text"
                name="inventoryNumber"
                value={formData.inventoryNumber}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Сезонность</label>
              <select
                name="seasonality"
                value={formData.seasonality}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="">—</option>
                <option value="Круглогодичная">Круглогодичная</option>
                <option value="Летняя">Летняя</option>
                <option value="Зимняя">Зимняя</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Единица топлива</label>
              <select
                name="fuelUnit"
                value={formData.fuelUnit}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="">—</option>
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

          <div className="flex gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium text-gray-700"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={loading}
              className="freight-btn-primary flex-1 rounded-lg disabled:opacity-50"
            >
              {loading ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
