import React, { useState, useEffect } from 'react';

export default function EditDriverModal({ driver, onClose, onSave }) {
  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
    license: '',
    licenseSerial: '',
    licenseNumber: '',
    licenseDate: '',
    inn: '',
    snils: '',
    personnelNumber: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Преобразует DD.MM.YYYY в YYYY-MM-DD для input type="date"
  const toDateInputFormat = (val) => {
    if (!val) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
    const m = String(val).match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return val;
  };

  useEffect(() => {
    if (driver) {
      setFormData({
        fullName: driver.fullName || '',
        phone: driver.phone || '',
        license: driver.license || '',
        licenseSerial: driver.licenseSerial || '',
        licenseNumber: driver.licenseNumber || '',
        licenseDate: toDateInputFormat(driver.licenseDate) || '',
        inn: driver.inn || '',
        snils: driver.snils || '',
        personnelNumber: driver.personnelNumber || '',
      });
    }
  }, [driver]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.fullName || !formData.phone) {
      setError('Заполни обязательные поля: ФИО и телефон');
      return;
    }
    if (formData.phone.replace(/\D/g, '').length < 10) {
      setError('Телефон должен содержать не менее 10 цифр');
      return;
    }
    if (!formData.licenseSerial && !formData.licenseNumber) {
      setError('Для ЭПЛ нужны серия и/или номер ВУ');
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
          <h2 className="text-xl font-bold text-gray-900">✏️ Редактировать водителя</h2>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">ФИО *</label>
              <input
                type="text"
                name="fullName"
                value={formData.fullName}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Телефон *</label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Серия ВУ</label>
              <input
                type="text"
                name="licenseSerial"
                value={formData.licenseSerial}
                onChange={handleChange}
                placeholder="77 АВ"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Номер ВУ</label>
              <input
                type="text"
                name="licenseNumber"
                value={formData.licenseNumber}
                onChange={handleChange}
                placeholder="123456"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Дата выдачи ВУ</label>
              <input
                type="date"
                name="licenseDate"
                value={formData.licenseDate}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Табельный номер (для ЭПЛ)</label>
              <input
                type="text"
                name="personnelNumber"
                value={formData.personnelNumber}
                onChange={handleChange}
                placeholder="DRV-..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ИНН</label>
              <input
                type="text"
                name="inn"
                value={formData.inn}
                onChange={handleChange}
                maxLength="12"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">СНИЛС</label>
            <input
              type="text"
              name="snils"
              value={formData.snils}
              onChange={handleChange}
              maxLength="11"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            />
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
              className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium disabled:opacity-50"
            >
              {loading ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
