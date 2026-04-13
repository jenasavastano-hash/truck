import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Users } from 'lucide-react';
import { getDrivers, searchDrivers, getPermissions, getCars, addDriver } from '../../api/managerApi';
import DriversAccordion from '../admin/DriversAccordion';
import DriverSettingsModal from '../admin/DriverSettingsModal';
import BindCarModal from '../admin/BindCarModal';
import Modal from '../ui/Modal';
import AddDriverModal from './modals/AddDriverModal';
import { useToast } from '../../hooks/useToast';
import { useAuth } from '../../AuthContext';
import Skeleton, { SkeletonList } from '../ui/Skeleton';
import { operationsShell } from '../../utils/operationsUi';

export default function DriversTab({ parkId: parkIdProp, sceneNight = false }) {
  const [drivers, setDrivers] = useState([]);
  const [cars, setCars] = useState([]);
  const [permissions, setPermissions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [showDriverSettingsModal, setShowDriverSettingsModal] = useState(false);
  const [driverForBindCar, setDriverForBindCar] = useState(null);
  const [showBindCarModal, setShowBindCarModal] = useState(false);
  const [driverBalanceModal, setDriverBalanceModal] = useState(null);
  const [balanceAmount, setBalanceAmount] = useState('');
  const [balanceType, setBalanceType] = useState('real');
  const [savingBalance, setSavingBalance] = useState(false);
  const { showToast } = useToast();
  const { user } = useAuth();
  const parkId = parkIdProp || user?.parkId || cars[0]?.parkId;

  useEffect(() => {
    loadData();
  }, [parkIdProp]);

  const loadData = async () => {
    let driversData = [];
    try {
      setLoading(true);
      const [dres, carsData, perms] = await Promise.all([
        getDrivers(parkIdProp).catch(() => []),
        getCars(parkIdProp).catch(() => []),
        getPermissions(parkIdProp).catch(() => null)
      ]);
      driversData = dres || [];
      setDrivers(driversData);
      setCars(carsData || []);
      setPermissions(perms);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка загрузки');
      console.error(err);
    } finally {
      setLoading(false);
    }
    return { drivers: driversData };
  };

  const handleAddDriver = async (driverData) => {
    try {
      const created = await addDriver(driverData, parkIdProp);
      setShowAddModal(false);
      showToast('✅ Водитель успешно добавлен', 'success');
      await loadData();
      if (created && (created.id || created.userId)) {
        const driversData = await getDrivers(parkIdProp).catch(() => []);
        const newDriver = Array.isArray(driversData) ? driversData.find(d => d.phone === created.phone || d.userId === created.id) : null;
        if (newDriver) {
          setDriverForBindCar(newDriver);
          setShowBindCarModal(true);
        } else {
          setDriverForBindCar({ ...created, userId: created.id, id: created.id });
          setShowBindCarModal(true);
        }
      }
    } catch (err) {
      console.error(err);
      showToast(`❌ Ошибка: ${err.response?.data?.error || 'Не удалось добавить водителя'}`, 'error');
    }
  };

  const handleBalanceTopup = async () => {
    if (!driverBalanceModal || !balanceAmount || Number(balanceAmount) <= 0) return;
    setSavingBalance(true);
    try {
      const { driverTopupBalance } = await import('../../api/managerApi');
      await driverTopupBalance(driverBalanceModal.userId, Number(balanceAmount), balanceType, parkIdProp);
      alert('✅ Баланс пополнен');
      setDriverBalanceModal(null);
      setBalanceAmount('');
      loadData();
    } catch (e) {
      alert(`❌ Ошибка: ${e.response?.data?.error || e.message}`);
    } finally {
      setSavingBalance(false);
    }
  };

  // Разделяем водителей: с авто (все — чтобы можно было открыть карточку и отвязать), без авто
  const driversWithCar = drivers.filter(d => d.carId || d.regNumber);
  const driversOnLine = drivers.filter(d => d.isVerified && (d.carId || d.regNumber));
  const driversWithoutCar = drivers.filter(d => !d.carId && !d.regNumber);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className={`rounded-xl p-6 shadow-lg ${operationsShell(sceneNight)}`}>
          <Skeleton width="200px" height={32} className="mb-4" />
          <Skeleton width="150px" height={20} />
        </div>
        <SkeletonList count={6} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full shadow-sm ${
            sceneNight
              ? 'border border-white/15 bg-white/[0.06] backdrop-blur-xl text-slate-100 ring-1 ring-white/10'
              : 'bg-white/75 backdrop-blur-md border border-white/60 shadow-slate-900/10'
          }`}
        >
          <Users className={`w-5 h-5 ${sceneNight ? 'text-violet-300' : 'text-purple-600'}`} />
          <h2 className={`text-sm sm:text-base font-bold tracking-wide uppercase ${sceneNight ? '' : 'text-slate-900'}`}>
            Водители
          </h2>
        </div>
      </div>
      {/* Главная гармошка "Водители" */}
      <DriversAccordion
        sceneNight={sceneNight}
        drivers={drivers}
        driversOnLine={driversWithCar}
        driversWithoutCar={driversWithoutCar}
        title="Водители"
        subtitle={`${drivers.length} всего · ${driversOnLine.length} на линии · ${driversWithoutCar.length} без авто`}
        onAddClick={() => setShowAddModal(true)}
        onDriverClick={(driver) => {
          setSelectedDriver(driver);
          setShowDriverSettingsModal(true);
        }}
        onBalanceClick={(driver) => {
          setDriverBalanceModal(driver);
        }}
        onBindCar={(driver) => {
          setDriverForBindCar(driver);
          setShowBindCarModal(true);
        }}
      />

      {/* Модалка добавления водителя */}
      {showAddModal && (
        <AddDriverModal
          onClose={() => setShowAddModal(false)}
          onSave={handleAddDriver}
        />
      )}

      {/* Модалка настроек водителя */}
      {selectedDriver && (
        <DriverSettingsModal
          driver={selectedDriver}
          cars={cars}
          parkId={parkId}
          drivers={drivers}
          showBalanceBreakdown={permissions?.canShowBalanceBreakdown}
          canChangeDriverPassword={!!permissions?.canChangeDriverPassword}
          driverStatsVisibility={{
            showBalance: permissions?.driverStatsShowBalance !== 0 && permissions?.driverStatsShowBalance !== false,
            showEpl: permissions?.driverStatsShowEpl !== 0 && permissions?.driverStatsShowEpl !== false,
            showShifts: permissions?.driverStatsShowShifts !== 0 && permissions?.driverStatsShowShifts !== false,
          }}
          isOpen={showDriverSettingsModal}
          onClose={() => {
            setShowDriverSettingsModal(false);
            setSelectedDriver(null);
          }}
          onSave={async () => {
            const data = await loadData();
            if (selectedDriver && data?.drivers) {
              const updated = data.drivers.find(d => d.userId === selectedDriver.userId || d.id === selectedDriver.id);
              if (updated) setSelectedDriver(updated);
            }
          }}
          onDelete={() => {
            setShowDriverSettingsModal(false);
            setSelectedDriver(null);
            loadData();
          }}
        />
      )}

      {/* Модалка привязки авто */}
      {driverForBindCar && (
        <BindCarModal
          driver={driverForBindCar}
          cars={cars}
          freeCarsOnly
          isOpen={showBindCarModal}
          onClose={() => {
            setShowBindCarModal(false);
            setDriverForBindCar(null);
          }}
          onSave={() => {
            loadData();
          }}
        />
      )}

      {/* Модалка пополнения баланса */}
      {driverBalanceModal && (
        <Modal
          isOpen={!!driverBalanceModal}
          onClose={() => setDriverBalanceModal(null)}
          title="Пополнить баланс"
          size="sm"
        >
          <div className="space-y-4">
            <p className="text-slate-600 text-sm mb-4">
              {driverBalanceModal.fullName || driverBalanceModal.phone}
            </p>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Сумма (₽)</label>
              <input
                type="number"
                min="1"
                step="1"
                value={balanceAmount}
                onChange={(e) => setBalanceAmount(e.target.value)}
                placeholder="0"
                className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Тип</label>
              <select
                value={balanceType}
                onChange={(e) => setBalanceType(e.target.value)}
                className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
              >
                <option value="real">Реальные (из кассы)</option>
                <option value="unreal">Бонусные (нереальные)</option>
              </select>
            </div>
            <div className="flex gap-3 pt-4 border-t border-slate-200">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleBalanceTopup}
                disabled={savingBalance || !balanceAmount}
                className="flex-1 py-3 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white rounded-xl hover:from-emerald-700 hover:to-emerald-800 font-semibold transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingBalance ? 'Сохранение...' : 'Пополнить'}
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  setDriverBalanceModal(null);
                  setBalanceAmount('');
                }}
                className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 font-semibold transition"
              >
                Отмена
              </motion.button>
            </div>
          </div>
        </Modal>
      )}

      {/* Ошибка */}
      {error && (
        <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4 text-red-700">
          Ошибка: {error}
        </div>
      )}
    </div>
  );
}
