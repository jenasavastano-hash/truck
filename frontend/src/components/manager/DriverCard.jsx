import React, { useState, useEffect } from 'react';
import { getCars, updateDriver, driverTopupBalance, driverFine, driverDismiss, driverRemoveFromSystem } from '../../api/managerApi';
import EditDriverModal from './modals/EditDriverModal';

export default function DriverCard({ driver, permissions, onDelete, onUpdate }) {
  const [showCarSelection, setShowCarSelection] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [showFineModal, setShowFineModal] = useState(false);
  const [balanceAmount, setBalanceAmount] = useState('');
  const [balanceType, setBalanceType] = useState('real');
  const [fineAmount, setFineAmount] = useState('');
  const [fineDescription, setFineDescription] = useState('Штраф');
  const [actionLoading, setActionLoading] = useState(false);
  const [cars, setCars] = useState([]);
  const [loadingCars, setLoadingCars] = useState(false);
  const perms = permissions || {};

  const loadCars = async () => {
    try {
      setLoadingCars(true);
      const data = await getCars();
      setCars(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingCars(false);
    }
  };

  useEffect(() => {
    if (showCarSelection && cars.length === 0) {
      loadCars();
    }
  }, [showCarSelection]);

  const handleLinkCar = async (carId) => {
    try {
      await updateDriver(driver.id, { carId });
      setShowCarSelection(false);
      onUpdate();
    } catch (err) {
      console.error(err);
      alert('Ошибка при привязке авто');
    }
  };

  const handleUnlinkCar = async () => {
    try {
      await updateDriver(driver.id, { carId: null });
      onUpdate();
    } catch (err) {
      console.error(err);
      alert('Ошибка при отвязке авто');
    }
  };

  const handleSaveEdit = async (data) => {
    try {
      await updateDriver(driver.id, data);
      setShowEditModal(false);
      onUpdate();
    } catch (err) {
      console.error(err);
      throw err;
    }
  };

  const handleBalanceTopup = async () => {
    if (!balanceAmount || Number(balanceAmount) <= 0) return;
    setActionLoading(true);
    try {
      await driverTopupBalance(driver.userId, Number(balanceAmount), balanceType);
      setShowBalanceModal(false);
      setBalanceAmount('');
      onUpdate();
    } catch (err) {
      alert(err.response?.data?.error || 'Ошибка');
    } finally {
      setActionLoading(false);
    }
  };

  const handleFine = async () => {
    if (!fineAmount || Number(fineAmount) <= 0) return;
    setActionLoading(true);
    try {
      await driverFine(driver.userId, Number(fineAmount), fineDescription || 'Штраф');
      setShowFineModal(false);
      setFineAmount('');
      setFineDescription('Штраф');
      onUpdate();
    } catch (err) {
      alert(err.response?.data?.error || 'Ошибка');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDismiss = async () => {
    if (!window.confirm(`Уволить ${driver.fullName || driver.phone}?`)) return;
    setActionLoading(true);
    try {
      await driverDismiss(driver.userId);
      onUpdate();
    } catch (err) {
      alert(err.response?.data?.error || 'Ошибка');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveFromSystem = async () => {
    if (!window.confirm(`Удалить ${driver.fullName || driver.phone} из системы безвозвратно?`)) return;
    setActionLoading(true);
    try {
      await driverRemoveFromSystem(driver.userId);
      onUpdate();
    } catch (err) {
      alert(err.response?.data?.error || 'Ошибка');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteClick = () => {
    if (perms.canDeleteDriver) {
      handleRemoveFromSystem();
    } else {
      onDelete();
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-4 hover:shadow-lg transition">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900 text-base">{driver.fullName || driver.username}</h3>
          <p className="text-xs text-gray-600">📱 {driver.phone}</p>
        </div>
        <button
          onClick={handleDeleteClick}
          disabled={actionLoading}
          className="text-red-600 hover:text-red-800 text-xl flex-shrink-0 ml-2 disabled:opacity-50"
          title={perms.canDeleteDriver ? 'Удалить из системы' : 'Удалить'}
        >
          🗑️
        </button>
      </div>

      {/* Status Badge */}
      <div className="mb-3">
        {driver.syncedWithTakskom ? (
          <span className="inline-block px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">
            ✓ В Такском
          </span>
        ) : (
          <span className="inline-block px-2 py-1 bg-sky-100 text-sky-900 rounded text-xs font-medium">
            ⏱ Ожидание синхронизации
          </span>
        )}
      </div>

      {/* Car Info */}
      <div className="bg-teal-50 rounded p-2 mb-3 text-sm">
        {driver.carId ? (
          <>
            <p className="text-xs text-teal-700 font-semibold">✅ Привязано авто</p>
            <p className="font-medium text-gray-900">
              {driver.brand && driver.model ? `${driver.brand} ${driver.model}` : (driver.regNumber || 'Авто')}
            </p>
            {driver.regNumber && <p className="text-xs text-gray-600">ГНЗ: {driver.regNumber}</p>}
          </>
        ) : (
          <p className="text-xs text-orange-700">❌ ТС не привязано</p>
        )}
      </div>

      {/* Car Selection (раскрытый блок) */}
      {showCarSelection && (
        <div className="mt-4 p-4 bg-gray-50 rounded-lg border-2 border-teal-200">
          <h4 className="font-semibold text-gray-900 mb-3">Выбери автомобиль</h4>
          {loadingCars ? (
            <p className="text-gray-600 text-center py-4">Загрузка...</p>
          ) : cars.length === 0 ? (
            <p className="text-gray-600 text-center py-4 text-sm">Нет доступных автомобилей</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {cars.map((car) => (
                <button
                  key={car.id}
                  onClick={() => handleLinkCar(car.id)}
                  className="w-full p-3 text-left bg-white border border-gray-200 rounded hover:border-teal-500 hover:bg-teal-50 transition"
                >
                  <p className="font-medium text-gray-900">
                    {car.brand} {car.model}
                  </p>
                  <p className="text-xs text-gray-600">
                    ГНЗ: {car.regNumber} {car.inventoryNumber && `| Инвент: ${car.inventoryNumber}`}
                  </p>
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowCarSelection(false)}
            className="mt-3 w-full py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg"
          >
            Закрыть
          </button>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2 mt-3">
        <button
          type="button"
          onClick={() => setShowCarSelection(!showCarSelection)}
          className="freight-btn-primary-compact rounded px-2"
        >
          {driver.carId ? '🔄 Авто' : '➕ Авто'}
        </button>
        <button
          type="button"
          onClick={() => setShowEditModal(true)}
          className="px-2 py-2 bg-green-600 text-white rounded text-xs hover:bg-green-700 font-medium"
        >
          ✏️ Редактировать
        </button>
        {perms.canTopupBalance && (
          <button type="button" onClick={() => { setShowBalanceModal(true); setBalanceAmount(''); setBalanceType('real'); }} className="px-2 py-2 bg-emerald-600 text-white rounded text-xs hover:bg-emerald-700 font-medium">💰 Пополнить</button>
        )}
        {perms.canFine && (
          <button type="button" onClick={() => { setShowFineModal(true); setFineAmount(''); setFineDescription('Штраф'); }} className="px-2 py-2 bg-amber-500 text-white rounded text-xs hover:bg-amber-600 font-medium">⚠️ Штраф</button>
        )}
        {perms.canDismiss && (
          <button type="button" onClick={handleDismiss} disabled={actionLoading} className="px-2 py-2 bg-orange-500 text-white rounded text-xs hover:bg-orange-600 font-medium disabled:opacity-50">🚪 Уволить</button>
        )}
      </div>

      {showBalanceModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-4 shadow-xl">
            <h4 className="font-bold text-gray-800 mb-2">Пополнить баланс</h4>
            <p className="text-sm text-gray-600 mb-3">{driver.fullName || driver.phone}</p>
            <input type="number" min="1" value={balanceAmount} onChange={(e) => setBalanceAmount(e.target.value)} placeholder="Сумма" className="w-full px-3 py-2 border rounded-lg mb-2" />
            <select value={balanceType} onChange={(e) => setBalanceType(e.target.value)} className="w-full px-3 py-2 border rounded-lg mb-4">
              <option value="real">Реальные (касса)</option>
              <option value="unreal">Бонусные</option>
            </select>
            <div className="flex gap-2">
              <button onClick={handleBalanceTopup} disabled={actionLoading || !balanceAmount} className="flex-1 py-2 bg-green-600 text-white rounded-lg font-medium disabled:opacity-50">Пополнить</button>
              <button onClick={() => setShowBalanceModal(false)} className="flex-1 py-2 bg-gray-300 rounded-lg font-medium">Отмена</button>
            </div>
          </div>
        </div>
      )}

      {showFineModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-4 shadow-xl">
            <h4 className="font-bold text-gray-800 mb-2">Штраф</h4>
            <p className="text-sm text-gray-600 mb-3">{driver.fullName || driver.phone}</p>
            <input type="number" min="1" value={fineAmount} onChange={(e) => setFineAmount(e.target.value)} placeholder="Сумма" className="w-full px-3 py-2 border rounded-lg mb-2" />
            <input type="text" value={fineDescription} onChange={(e) => setFineDescription(e.target.value)} placeholder="Причина" className="w-full px-3 py-2 border rounded-lg mb-4" />
            <div className="flex gap-2">
              <button onClick={handleFine} disabled={actionLoading || !fineAmount} className="flex-1 py-2 bg-amber-500 text-white rounded-lg font-medium disabled:opacity-50">Списать</button>
              <button onClick={() => setShowFineModal(false)} className="flex-1 py-2 bg-gray-300 rounded-lg font-medium">Отмена</button>
            </div>
          </div>
        </div>
      )}

      {showEditModal && (
        <EditDriverModal
          driver={driver}
          onClose={() => setShowEditModal(false)}
          onSave={handleSaveEdit}
        />
      )}
    </div>
  );
}
