import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Car } from 'lucide-react';
import { getCars, searchCars, getDrivers, addCar, getPermissions } from '../../api/managerApi';
import CarsAccordion from '../admin/CarsAccordion';
import CarSettingsModal from '../admin/CarSettingsModal';
import BindDriverModal from '../admin/BindDriverModal';
import DriverSettingsModal from '../admin/DriverSettingsModal';
import AddCarModal from './modals/AddCarModal';
import { useToast } from '../../hooks/useToast';
import { useAuth } from '../../AuthContext';
import Skeleton, { SkeletonList } from '../ui/Skeleton';
import { operationsShell } from '../../utils/operationsUi';

export default function FleetTab({ parkId: parkIdProp, sceneNight = false }) {
  const { user } = useAuth();
  const [cars, setCars] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedCar, setSelectedCar] = useState(null);
  const [showCarSettingsModal, setShowCarSettingsModal] = useState(false);
  const [carForBindDriver, setCarForBindDriver] = useState(null);
  const [showBindDriverModal, setShowBindDriverModal] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [showDriverSettingsModal, setShowDriverSettingsModal] = useState(false);
  const [permissions, setPermissions] = useState(null);
  const { showToast } = useToast();

  useEffect(() => {
    loadData();
  }, [parkIdProp]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [carsData, driversData, perms] = await Promise.all([
        getCars(parkIdProp).catch(() => []),
        getDrivers(parkIdProp).catch(() => []),
        getPermissions(parkIdProp).catch(() => null)
      ]);
      setCars(carsData || []);
      setDrivers(driversData || []);
      setPermissions(perms);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка загрузки');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadCars = () => loadData();

  const handleAddCar = async (carData) => {
    try {
      await addCar(carData, parkIdProp);
      setShowAddModal(false);
      showToast('✅ Автомобиль успешно добавлен', 'success');
      loadCars();
    } catch (err) {
      console.error(err);
      showToast(`❌ Ошибка: ${err.response?.data?.error || 'Не удалось добавить автомобиль'}`, 'error');
    }
  };

  const parkId = parkIdProp || user?.parkId || cars[0]?.parkId || null;

  // Разделяем авто на категории
  // Проверяем наличие водителя через JOIN в API или через поле driverId в данных
  const carsOnLine = cars.filter(car => {
    // Проверяем наличие водителя через различные возможные поля
    return car.driverId || car.driverName || (car.driver && car.driver.userId);
  });
  const carsWithoutDriver = cars.filter(car => {
    return !car.driverId && !car.driverName && !(car.driver && car.driver.userId);
  });

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
          <Car className={`w-5 h-5 ${sceneNight ? 'text-teal-300' : 'text-emerald-600'}`} />
          <h2 className={`text-sm sm:text-base font-bold tracking-wide uppercase ${sceneNight ? '' : 'text-slate-900'}`}>
            Автопарк
          </h2>
        </div>
      </div>
      {/* Главная гармошка "Автопарк" */}
      <CarsAccordion
        sceneNight={sceneNight}
        cars={cars}
        carsOnLine={carsOnLine}
        carsWithoutDriver={carsWithoutDriver}
        title="Автопарк"
        subtitle={`${cars.length} авто · ${carsOnLine.length} на линии · ${carsWithoutDriver.length} без водителя`}
        onAddClick={() => setShowAddModal(true)}
        onCarClick={(car) => {
          setSelectedCar(car);
          setShowCarSettingsModal(true);
        }}
        onBindDriver={(car) => {
          setCarForBindDriver(car);
          setShowBindDriverModal(true);
        }}
      />

      {/* Модалка добавления авто */}
      {showAddModal && (
        <AddCarModal
          onClose={() => setShowAddModal(false)}
          onSave={handleAddCar}
          parkId={parkId}
        />
      )}

      {/* Модалка настроек авто */}
      {selectedCar && (
        <CarSettingsModal
          car={selectedCar}
          parkId={parkId}
          drivers={drivers}
          isOpen={showCarSettingsModal}
          onClose={() => {
            setShowCarSettingsModal(false);
            setSelectedCar(null);
          }}
          onSave={() => {
            loadCars();
          }}
          onDelete={() => {
            loadCars();
          }}
          onOpenDriverSettings={(driver) => {
            setShowCarSettingsModal(false);
            setSelectedCar(null);
            setSelectedDriver(driver);
            setShowDriverSettingsModal(true);
          }}
        />
      )}

      {/* Модалка карточки водителя (при переходе из карточки авто) */}
      {selectedDriver && (
        <DriverSettingsModal
          driver={selectedDriver}
          cars={cars}
          parkId={parkId}
          drivers={drivers}
          showBalanceBreakdown={permissions?.canShowBalanceBreakdown}
          isOpen={showDriverSettingsModal}
          onClose={() => {
            setShowDriverSettingsModal(false);
            setSelectedDriver(null);
          }}
          onSave={() => {
            loadData();
          }}
          onDelete={() => {
            setShowDriverSettingsModal(false);
            setSelectedDriver(null);
            loadData();
          }}
        />
      )}

      {/* Модалка привязки водителя */}
      {carForBindDriver && (
        <BindDriverModal
          car={carForBindDriver}
          drivers={drivers}
          freeDriversOnly
          isOpen={showBindDriverModal}
          onClose={() => {
            setShowBindDriverModal(false);
            setCarForBindDriver(null);
          }}
          onSave={() => {
            loadData();
          }}
        />
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
