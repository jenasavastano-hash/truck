import React, { useState } from 'react';
import EditCarModal from './modals/EditCarModal';

export default function CarCard({ car, onDelete, onUpdate }) {
  const [showEditModal, setShowEditModal] = useState(false);

  const handleSaveEdit = async (data) => {
    await onUpdate(car.id, data);
    setShowEditModal(false);
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-4 hover:shadow-lg transition">
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="font-semibold text-gray-900">
            {car.brand} {car.model}
          </h3>
          <p className="text-sm text-gray-600">ГНЗ: {car.regNumber}</p>
        </div>
        <button
          onClick={() => onDelete(car.id)}
          className="text-red-600 hover:text-red-800 text-xl"
          title="Удалить"
        >
          ✕
        </button>
      </div>

      <div className="space-y-2 text-sm text-gray-700 mb-4">
        {car.vin && (
          <p>
            <span className="font-medium">VIN:</span> {car.vin}
          </p>
        )}
        {car.inventoryNumber && (
          <p>
            <span className="font-medium">Инвент:</span> {car.inventoryNumber}
          </p>
        )}
        {car.fuelType && (
          <p>
            <span className="font-medium">Топливо:</span> {car.fuelType}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs mb-3">
        {car.syncedWithTakskom ? (
          <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full font-medium">
            ✓ В Такском
          </span>
        ) : (
          <span className="px-2 py-1 bg-slate-200 text-slate-800 rounded-full font-medium">
            ⏱ Не синхронизирован
          </span>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setShowEditModal(true)}
          className="freight-btn-primary-compact flex-1 rounded"
        >
          ✏️ Редактировать
        </button>
      </div>

      {showEditModal && (
        <EditCarModal
          car={car}
          onClose={() => setShowEditModal(false)}
          onSave={handleSaveEdit}
        />
      )}
    </div>
  );
}
