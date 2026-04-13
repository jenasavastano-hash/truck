import React, { useState, useEffect } from 'react';
import api from '../api';

export default function ParkManagersList({ parkId, reloadKey }) {
  const [managers, setManagers] = useState([]);

  useEffect(() => {
    if (!parkId) return;
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parkId, reloadKey]);

  const fetchList = async () => {
    try {
      const res = await api.get(`/admin/parks/${parkId}/managers`);
      setManagers(res.data || []);
    } catch (err) {
      console.error('Ошибка загрузки менеджеров', err);
    }
  };

  if (!managers || managers.length === 0) return <div className="text-sm text-gray-600">Менеджеры не найдены</div>;

  return (
    <div className="space-y-2">
      {managers.map((m) => (
        <div key={m.id} className="p-2 border rounded flex justify-between items-center">
          <div>
            <div className="font-medium">{m.username || m.fullName}</div>
            <div className="text-sm text-gray-600">{m.phone}</div>
          </div>
          <div className="text-sm text-gray-500">Карточка</div>
        </div>
      ))}
    </div>
  );
}
