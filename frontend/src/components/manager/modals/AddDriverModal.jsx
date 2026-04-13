import React, { useState } from 'react';
import { motion } from 'framer-motion';
import Modal from '../../ui/Modal';

export default function AddDriverModal({ onClose, onSave, isOpen = true }) {
  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
    license: '',
    licenseSerial: '',
    licenseNumber: '',
    licenseDate: '',
    inn: '',
    snils: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
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
      // Логин и пароль устанавливаются автоматически как телефон
      const dataToSend = {
        fullName: formData.fullName,
        username: formData.phone,
        password: formData.phone,
        phone: formData.phone,
        license: formData.license || (formData.licenseSerial && formData.licenseNumber ? `${formData.licenseSerial} ${formData.licenseNumber}` : null),
        licenseSerial: formData.licenseSerial || null,
        licenseNumber: formData.licenseNumber || null,
        licenseDate: formData.licenseDate || null,
        inn: formData.inn || null,
        snils: formData.snils || null,
      };
      await onSave(dataToSend);
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка при сохранении');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Добавить водителя"
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
              {error}
            </div>
          )}

          {/* Row 1 - Personal Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                ФИО <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                name="fullName"
                value={formData.fullName}
                onChange={handleChange}
                placeholder="Иван Иванов"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Телефон <span className="text-red-600">*</span>
              </label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="+79990000000"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                required
              />
            </div>
          </div>

          {/* Info: Логин и пароль */}
          <div className="bg-sky-50 border border-sky-200 rounded-lg p-3 text-sm text-sky-800">
            💡 <strong>Логин:</strong> номер телефона<br/>
            💡 <strong>Пароль:</strong> номер телефона<br/>
            При первом входе водитель сможет изменить пароль
          </div>

          {/* Row 2 - ВУ (документы для ЭПЛ) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Серия ВУ
              </label>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Номер ВУ
              </label>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Дата выдачи ВУ
              </label>
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
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                ИНН
              </label>
              <input
                type="text"
                name="inn"
                value={formData.inn}
                onChange={handleChange}
                placeholder="12 цифр"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                maxLength="12"
              />
            </div>
          </div>

          {/* Row 5 - SNILS */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              СНИЛС
            </label>
            <input
              type="text"
              name="snils"
              value={formData.snils}
              onChange={handleChange}
              placeholder="11 цифр"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              maxLength="11"
            />
          </div>

          {/* Info Text */}
          <div className="bg-sky-50 border border-sky-200 rounded-lg p-4">
            <p className="text-sm text-sky-900">
              💡 <strong>ID водителя</strong> будет сгенерирован автоматически при синхронизации с Такском.
              Заполни основные данные прямо сейчас, остальное можно будет изменить потом.
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
            className="w-full sm:flex-1 px-4 py-2.5 sm:py-3 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white rounded-lg sm:rounded-xl hover:from-emerald-700 hover:to-emerald-800 font-semibold text-sm sm:text-base transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Сохранение...' : 'Добавить водителя'}
          </motion.button>
        </div>
      </form>
    </Modal>
  );
}
