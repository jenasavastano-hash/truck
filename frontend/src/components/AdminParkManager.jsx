import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { FileText, ChevronDown } from 'lucide-react';
import api from '../api';
import { useToast } from '../hooks/useToast';
import AddDriverModal from './manager/modals/AddDriverModal';
import ManagerSettingsModal from './admin/ManagerSettingsModal';
import DirectorSettingsModal from './admin/DirectorSettingsModal';
import DriverSettingsModal from './admin/DriverSettingsModal';
import CarSettingsModal from './admin/CarSettingsModal';
import BindCarModal from './admin/BindCarModal';
import BindDriverModal from './admin/BindDriverModal';
import ManagersAccordion from './admin/ManagersAccordion';
import DirectorsAccordion from './admin/DirectorsAccordion';
import DriversAccordion from './admin/DriversAccordion';
import CarsAccordion from './admin/CarsAccordion';
import ParkStatistics from './admin/ParkStatistics';
import ParkInfoAccordion from './admin/ParkInfoAccordion';
import Modal from './ui/Modal';
import { formatDateMsk } from '../utils/dateFormatter';
import AddCarModal from './manager/modals/AddCarModal';

/**
 * AdminParkManager - управление менеджерами и водителями парка
 * Разделенный компонент для AdminPanel
 */
export default function AdminParkManager({ parkId, onBack, onRefresh }) {
  const { showToast } = useToast();
  const [park, setPark] = useState(null);
  const [managers, setManagers] = useState([]);
  const [directors, setDirectors] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showDirectorModal, setShowDirectorModal] = useState(false);
  const [showManagerSettingsModal, setShowManagerSettingsModal] = useState(false);
  const [selectedManager, setSelectedManager] = useState(null);
  const [selectedDirector, setSelectedDirector] = useState(null);
  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
    managerType: 'park',
    mode: 'create', // 'create' | 'attach'
    existingLogin: ''
  });
  const [directorForm, setDirectorForm] = useState({
    fullName: '',
    phone: '',
    mode: 'create', // 'create' | 'attach'
    existingLogin: ''
  });
  const [driverBalanceModal, setDriverBalanceModal] = useState(null);
  const [driverFineModal, setDriverFineModal] = useState(null);
  const [balanceAmount, setBalanceAmount] = useState('');
  const [balanceType, setBalanceType] = useState('real');
  const [fineAmount, setFineAmount] = useState('');
  const [fineDescription, setFineDescription] = useState('Штраф');
  const [actionLoading, setActionLoading] = useState(false);
  const [finance, setFinance] = useState(null);
  const [savingPerms, setSavingPerms] = useState(null);
  const [showAddDriverModal, setShowAddDriverModal] = useState(false);
  const [stats, setStats] = useState(null);
  const [cars, setCars] = useState([]);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [showDriverSettingsModal, setShowDriverSettingsModal] = useState(false);
  const [showBindCarModal, setShowBindCarModal] = useState(false);
  const [driverForBindCar, setDriverForBindCar] = useState(null);
  const [carForBindDriver, setCarForBindDriver] = useState(null);
  const [showBindDriverModal, setShowBindDriverModal] = useState(false);
  const [selectedCar, setSelectedCar] = useState(null);
  const [showCarSettingsModal, setShowCarSettingsModal] = useState(false);
  const [showAddCarModal, setShowAddCarModal] = useState(false);
  const [statsPeriod, setStatsPeriod] = useState({ period: 'today' });
  const [parkEpl, setParkEpl] = useState([]);
  const [parkEplLoading, setParkEplLoading] = useState(false);
  const [parkEplError, setParkEplError] = useState(null);
  /** Секция ЭПЛ по умолчанию свёрнута — список грузится только после раскрытия */
  const [showEplSection, setShowEplSection] = useState(false);
  /** Ref, чтобы при смене парка не было гонки со state перед loadParkData */
  const eplFetchedForParkIdRef = useRef(null);
  const [eplListKnown, setEplListKnown] = useState(false);
  const [selectedEpl, setSelectedEpl] = useState(null);
  const [eplFilters, setEplFilters] = useState({
    waybillNumber: '',
    driverName: '',
    regNumber: '',
  });
  const [eplModalRequeueLoading, setEplModalRequeueLoading] = useState(false);

  useEffect(() => {
    eplFetchedForParkIdRef.current = null;
    setEplListKnown(false);
    setParkEpl([]);
    setParkEplError(null);
  }, [parkId]);

  const loadParkEpl = useCallback(async () => {
    if (!parkId) return;
    setParkEplLoading(true);
    setParkEplError(null);
    try {
      const eplRes = await api.get(`/admin/parks/${parkId}/epl`);
      setParkEpl(eplRes.data || []);
      eplFetchedForParkIdRef.current = Number(parkId);
      setEplListKnown(true);
    } catch (ee) {
      console.error('Error loading park EPL:', ee);
      setParkEpl([]);
      setParkEplError(ee.response?.data?.error || ee.message || 'Не удалось загрузить ЭПЛ парка');
      eplFetchedForParkIdRef.current = Number(parkId);
      setEplListKnown(true);
    } finally {
      setParkEplLoading(false);
    }
  }, [parkId]);

  useEffect(() => {
    if (!showEplSection || !parkId) return;
    if (eplFetchedForParkIdRef.current === Number(parkId)) return;
    loadParkEpl();
  }, [showEplSection, parkId, loadParkEpl]);

  useEffect(() => {
    loadParkData();
  }, [parkId]);

  const loadParkData = async (statsPeriodOverride) => {
    const periodToUse = statsPeriodOverride || statsPeriod;
    let loadedDrivers = [];
    let loadedCars = [];
    let loadedStats = null;
    let statsUrl = `/admin/parks/${parkId}/statistics`;
    const queryParams = new URLSearchParams();
    queryParams.append('period', periodToUse.period || 'today');
    if (periodToUse.period === 'date' && periodToUse.date) queryParams.append('date', periodToUse.date);
    if (periodToUse.period === 'range' && periodToUse.dateStart && periodToUse.dateEnd) {
      queryParams.append('dateStart', periodToUse.dateStart);
      queryParams.append('dateEnd', periodToUse.dateEnd);
    }
    if (queryParams.toString()) {
      statsUrl += '?' + queryParams.toString();
    }

    const safeArr = (p) => p.then((r) => r.data || []).catch(() => []);
    const safeNull = (p) => p.then((r) => (r.data !== undefined ? r.data : null)).catch(() => null);
    const safePark = (p) => p.then((r) => r.data).catch(() => null);

    try {
      setLoading(true);

      const includeEpl = eplFetchedForParkIdRef.current === Number(parkId);
      const eplPromise = includeEpl
        ? api.get(`/admin/parks/${parkId}/epl`).then((r) => r.data || []).catch(() => [])
        : Promise.resolve(null);

      const [
        foundPark,
        mres,
        dres2,
        dres,
        fres,
        statsRes,
        carsRes,
        eplRes,
      ] = await Promise.all([
        safePark(api.get(`/admin/parks/${parkId}`)),
        safeArr(api.get(`/admin/parks/${parkId}/managers`)),
        safeArr(api.get(`/admin/parks/${parkId}/directors`)),
        safeArr(api.get(`/admin/parks/${parkId}/drivers`)),
        safeNull(api.get(`/admin/parks/${parkId}/finance`)),
        safeNull(api.get(statsUrl)),
        safeArr(api.get(`/admin/parks/${parkId}/cars`)),
        eplPromise,
      ]);

      setManagers(mres);
      setDirectors(dres2);
      loadedDrivers = dres;
      setDrivers(loadedDrivers);
      setFinance(fres);
      loadedStats = statsRes;
      setStats(loadedStats);
      loadedCars = carsRes;
      setCars(loadedCars);

      if (eplRes !== null) {
        setParkEpl(eplRes);
        setParkEplError(null);
        setEplListKnown(true);
        eplFetchedForParkIdRef.current = Number(parkId);
      }

      const bindingsCount = loadedDrivers.filter((d) => d.carId != null && d.carId !== '').length;
      if (foundPark) {
        setPark({
          ...foundPark,
          carsCount: loadedCars.length,
          driversCount: loadedDrivers.length,
          bindingsCount,
          spentReal:
            loadedStats?.spentReal != null ? Number(loadedStats.spentReal) : foundPark.spentReal,
        });
      } else {
        setPark(null);
      }
    } catch (e) {
      console.error('Error loading park data:', e);
    } finally {
      setLoading(false);
    }

    return { drivers: loadedDrivers, cars: loadedCars, stats: loadedStats };
  };

  const saveManagerPermissions = async (manager, perms) => {
    setSavingPerms(manager.id);
    try {
      await api.put(`/admin/managers/${manager.id}/permissions`, perms);
      await loadParkData();
    } catch (e) {
      showToast(e.response?.data?.error || e.message || 'Ошибка', 'error');
    } finally {
      setSavingPerms(null);
    }
  };

  const handleCreateManager = async (e) => {
    e.preventDefault();
    if (formData.mode === 'create') {
      if (!formData.fullName.trim() || !formData.phone.trim()) {
        alert('Требуется ФИО и телефон');
        return;
      }
      try {
        await api.post('/admin/managers', {
          mode: 'create',
          parkId,
          fullName: formData.fullName,
          phone: formData.phone,
          username: formData.phone,
          password: formData.phone,
          managerType: formData.managerType || 'park'
        });
        showToast('Менеджер успешно создан', 'success');
      } catch (err) {
        alert(err.response?.data?.error || err.message);
        return;
      }
    } else {
      // Привязать существующего менеджера по логину/телефону
      if (!formData.existingLogin.trim()) {
        alert('Укажите логин/телефон существующего менеджера');
        return;
      }
      try {
        await api.post('/admin/managers', {
          mode: 'attach',
          parkId,
          usernameOrPhone: formData.existingLogin.trim(),
          managerType: formData.managerType || 'park'
        });
        showToast('Менеджер привязан к парку', 'success');
      } catch (err) {
        alert(err.response?.data?.error || err.message);
        return;
      }
    }

    try {
      setFormData({ fullName: '', phone: '', managerType: 'park', mode: 'create', existingLogin: '' });
      setShowModal(false);
      await loadParkData();
      if (onRefresh) onRefresh();
    } catch (e) {
      showToast(e.response?.data?.error || e.message || 'Ошибка', 'error');
    }
  };

  const handleCreateDirector = async (e) => {
    e.preventDefault();
    if (directorForm.mode === 'create') {
      if (!directorForm.fullName.trim() || !directorForm.phone.trim()) {
        alert('Требуется ФИО и телефон');
        return;
      }
      try {
        await api.post('/admin/directors', {
          mode: 'create',
          parkId,
          fullName: directorForm.fullName,
          phone: directorForm.phone,
          username: directorForm.phone,
          password: directorForm.phone,
        });
        showToast('Директор успешно создан', 'success');
        setShowDirectorModal(false);
        setDirectorForm({ fullName: '', phone: '', mode: 'create', existingLogin: '' });
        await loadParkData();
      } catch (err) {
        alert(err.response?.data?.error || err.message);
      }
    } else {
      if (!directorForm.existingLogin.trim()) {
        alert('Укажите логин/телефон существующего директора');
        return;
      }
      try {
        await api.post('/admin/directors', {
          mode: 'attach',
          parkId,
          usernameOrPhone: directorForm.existingLogin.trim(),
        });
        showToast('Директор привязан к парку', 'success');
        setShowDirectorModal(false);
        setDirectorForm({ fullName: '', phone: '', mode: 'create', existingLogin: '' });
        await loadParkData();
      } catch (err) {
        alert(err.response?.data?.error || err.message);
      }
    }
  };

  const handleAddDriver = async (driverData) => {
    try {
      setActionLoading(true);
      const res = await api.post(`/admin/parks/${parkId}/drivers`, driverData);
      showToast('Водитель успешно добавлен', 'success');
      setShowAddDriverModal(false);
      await loadParkData();
      if (onRefresh) onRefresh();
      // Сразу предлагаем привязать авто новому водителю
      const newDriver = res.data;
      if (newDriver && (newDriver.id || newDriver.userId)) {
        const driverForBind = { userId: newDriver.id || newDriver.userId, fullName: newDriver.fullName, phone: newDriver.phone, id: newDriver.id };
        setDriverForBindCar(driverForBind);
        setShowBindCarModal(true);
      }
    } catch (e) {
      alert(`❌ Ошибка: ${e.response?.data?.error || e.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddCar = async (formData) => {
    try {
      await api.post(`/admin/parks/${parkId}/cars`, formData);
      showToast('Автомобиль создан', 'success');
      setShowAddCarModal(false);
      await loadParkData();
      if (onRefresh) onRefresh();
    } catch (e) {
      alert(`❌ Ошибка: ${e.response?.data?.error || e.message}`);
    }
  };

  const handleDeleteManager = async (manager) => {
    if (!window.confirm(`Вы уверены, что хотите удалить менеджера "${manager.fullName || manager.username}"?`)) {
      return;
    }
    try {
      await api.delete(`/admin/managers/${manager.id}`);
      showToast('Менеджер удалён', 'success');
      await loadParkData();
    } catch (e) {
      alert(`❌ Ошибка: ${e.response?.data?.error || e.message}`);
    }
  };

  const handleDriverBalance = async () => {
    if (!driverBalanceModal || !balanceAmount || Number(balanceAmount) <= 0) {
      showToast('Укажите сумму', 'warning');
      return;
    }
    setActionLoading(true);
    try {
      await api.post(`/admin/drivers/${driverBalanceModal.userId}/balance`, {
        amount: Number(balanceAmount),
        amountType: balanceType
      });
      alert('✅ Баланс пополнен');
      setDriverBalanceModal(null);
      setBalanceAmount('');
      await loadParkData();
    } catch (e) {
      showToast(e.response?.data?.error || e.message || 'Ошибка', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDriverFine = async () => {
    if (!driverFineModal || !fineAmount || Number(fineAmount) <= 0) {
      showToast('Укажите сумму штрафа', 'warning');
      return;
    }
    setActionLoading(true);
    try {
      await api.post(`/admin/drivers/${driverFineModal.userId}/fine`, {
        amount: Number(fineAmount),
        description: fineDescription || 'Штраф'
      });
      showToast('Штраф списан', 'success');
      setDriverFineModal(null);
      setFineAmount('');
      setFineDescription('Штраф');
      await loadParkData();
    } catch (e) {
      showToast(e.response?.data?.error || e.message || 'Ошибка', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDriverDismiss = async (driver) => {
    if (!window.confirm(`Уволить водителя ${driver.fullName || driver.phone}? Будет снята привязка к авто и верификация.`)) return;
    setActionLoading(true);
    try {
      await api.post(`/admin/drivers/${driver.userId}/dismiss`);
      showToast('Водитель уволен', 'success');
      await loadParkData();
    } catch (e) {
      showToast(e.response?.data?.error || e.message || 'Ошибка', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDriverDelete = async (driver) => {
    if (!window.confirm(`Удалить водителя ${driver.fullName || driver.phone} из системы безвозвратно?`)) return;
    setActionLoading(true);
    try {
      await api.delete(`/admin/drivers/${driver.userId}`);
      showToast('Водитель удалён из системы', 'success');
      await loadParkData();
    } catch (e) {
      showToast(e.response?.data?.error || e.message || 'Ошибка', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Загрузка...</div>;
  }

  if (!park) {
    return (
      <div className="text-center py-8">
          <p className="text-red-600">Парк не найден</p>
          <button onClick={onBack} className="mt-4 px-4 py-2 bg-gray-300 rounded">Назад</button>
        </div>
    );
  }

  return (
    <div>
      {/* Информация о парке - перемещена в header */}
      <ParkInfoAccordion park={park} />

      {/* Статистика парка */}
      <ParkStatistics
        stats={stats}
        period={
          statsPeriod.period === 'today'
            ? 'сегодня'
            : statsPeriod.period === 'yesterday'
              ? 'вчера'
              : statsPeriod.period === 'since_friday'
                ? 'с пятницы'
                : statsPeriod.period === 'date'
                  ? (statsPeriod.date || 'дата')
                  : statsPeriod.period === 'range' && statsPeriod.dateStart && statsPeriod.dateEnd
                    ? `${statsPeriod.dateStart} — ${statsPeriod.dateEnd}`
                    : statsPeriod.period === 'week'
                      ? 'неделя'
                      : statsPeriod.period === 'month'
                        ? 'месяц'
                        : 'период'
        }
        periodParams={statsPeriod}
        onPeriodChange={(params) => {
          setStatsPeriod(params);
          loadParkData(params);
        }}
        parkId={parkId}
      />

      {/* Managers Accordion */}
      <ManagersAccordion
        managers={managers}
        onAddClick={() => setShowModal(true)}
        onManagerClick={(manager) => {
          setSelectedManager(manager);
          setShowManagerSettingsModal(true);
        }}
      />

      <DirectorsAccordion
        directors={directors}
        onAddClick={() => setShowDirectorModal(true)}
        onDirectorClick={(director) => {
          setSelectedDirector(director);
        }}
      />

      {/* Автопарк — один общий аккордеон с подсписками */}
      {(() => {
        const carsOnLine = cars.filter(car => car.driverId || car.driverName || (car.driver && car.driver.userId));
        const carsWithoutDriver = cars.filter(car => !car.driverId && !car.driverName && !(car.driver && car.driver.userId));
        
        return (
          <CarsAccordion
            cars={cars}
            carsOnLine={carsOnLine}
            carsWithoutDriver={carsWithoutDriver}
            title="Автопарк"
            subtitle={`${cars.length} авто · ${carsOnLine.length} на линии · ${carsWithoutDriver.length} без водителя`}
            onAddClick={() => setShowAddCarModal(true)}
            onCarClick={(car) => {
              setSelectedCar(car);
              setShowCarSettingsModal(true);
            }}
            onBindDriver={(car) => {
              setCarForBindDriver(car);
              setShowBindDriverModal(true);
            }}
          />
        );
      })()}

      {/* Водители — один общий аккордеон с подсписками */}
      {(() => {
        const driversOnLine = drivers.filter(d => d.carId || d.regNumber);
        const driversWithoutCar = drivers.filter(d => !d.carId && !d.regNumber);
        
        return (
          <DriversAccordion
            drivers={drivers}
            driversOnLine={driversOnLine}
            driversWithoutCar={driversWithoutCar}
            title="Водители"
            subtitle={`${drivers.length} водителей · ${driversOnLine.length} на линии · ${driversWithoutCar.length} без авто`}
            onAddClick={() => setShowAddDriverModal(true)}
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
        );
      })()}

      {/* ЭПЛ парка */}
      <div className="mt-6 bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowEplSection((v) => !v)}
          className="w-full px-4 py-3 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-sky-100 text-sky-600">
              <FileText className="w-4 h-4" />
            </span>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                ЭПЛ парка
              </p>
              <p className="text-sm font-semibold text-slate-800">
                {!eplListKnown
                  ? 'Раскройте блок, чтобы загрузить список'
                  : parkEpl.length
                    ? `${parkEpl.length} путевых`
                    : 'Нет путевых листов'}
              </p>
            </div>
          </div>
          <ChevronDown
            className={`w-5 h-5 text-slate-500 transition-transform ${
              showEplSection ? 'rotate-180' : ''
            }`}
          />
        </button>
        {showEplSection && (
          <>
            <div className="px-4 py-3 border-b border-slate-100 bg-white flex flex-wrap items-center gap-3 text-xs">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                  Номер ЭПЛ
                </span>
                <input
                  type="text"
                  value={eplFilters.waybillNumber}
                  onChange={(e) => setEplFilters((f) => ({ ...f, waybillNumber: e.target.value }))}
                  className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                  placeholder="WB-..."
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                  Водитель
                </span>
                <input
                  type="text"
                  value={eplFilters.driverName}
                  onChange={(e) => setEplFilters((f) => ({ ...f, driverName: e.target.value }))}
                  className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                  placeholder="ФИО"
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                  Госномер
                </span>
                <input
                  type="text"
                  value={eplFilters.regNumber}
                  onChange={(e) => setEplFilters((f) => ({ ...f, regNumber: e.target.value }))}
                  className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                  placeholder="А000АА"
                />
              </div>
            </div>
            {parkEplLoading ? (
              <div className="p-4 text-sm text-slate-500">Загрузка ЭПЛ парка…</div>
            ) : parkEplError ? (
              <div className="p-4 text-sm text-red-600">{parkEplError}</div>
            ) : parkEpl.length === 0 ? (
              <div className="p-4 text-sm text-slate-500">В парке ещё нет ЭПЛ.</div>
            ) : (
              <div className="max-h-[320px] overflow-y-auto divide-y divide-slate-100">
                {parkEpl
                  .filter((epl) => {
                    const qNumber = eplFilters.waybillNumber.trim().toLowerCase();
                    const qDriver = eplFilters.driverName.trim().toLowerCase();
                    const qReg = eplFilters.regNumber.trim().toLowerCase();
                    if (
                      qNumber &&
                      !(String(epl.waybillNumber || epl.id).toLowerCase().includes(qNumber))
                    ) {
                      return false;
                    }
                    if (
                      qDriver &&
                      !(String(epl.driverName || '').toLowerCase().includes(qDriver))
                    ) {
                      return false;
                    }
                    if (
                      qReg &&
                      !(String(epl.regNumber || '').toLowerCase().includes(qReg))
                    ) {
                      return false;
                    }
                    return true;
                  })
                  .slice(0, 50)
                  .map((epl) => {
              const hasFastDoc = !!epl.hasFastDoc;
              const hasOfficialDoc = !!epl.hasOfficialDoc;
              const hasMintransQr = !!epl.hasMintransQr;
              const shiftStatus = epl.shiftStatus;
              const shiftLabelText =
                shiftStatus === 'active'
                  ? 'Смена открыта'
                  : shiftStatus === 'closed'
                  ? 'Смена закрыта'
                  : shiftStatus === 'auto_closed'
                  ? 'Смена авто-закрыта'
                  : 'Без смены';
              return (
                <button
                  key={epl.id}
                  type="button"
                  onClick={() => setSelectedEpl(epl)}
                  className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-mono text-sm font-semibold text-slate-900 truncate">
                        {epl.waybillNumber || `EPL #${epl.id}`}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 whitespace-nowrap">
                        {shiftLabelText}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 truncate">
                      {epl.driverName || 'Без водителя'} · {epl.regNumber || 'Без авто'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold ${
                        hasFastDoc ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'
                      }`}
                      title="Наш PDF"
                    >
                      F
                    </span>
                    <span
                      className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold ${
                        hasOfficialDoc ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400'
                      }`}
                      title="Официальный ЭПЛ"
                    >
                      O
                    </span>
                    <span
                      className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold ${
                        hasMintransQr ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-400'
                      }`}
                      title="QR Минтранса"
                    >
                      QR
                    </span>
                  </div>
                </button>
              );
            })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Модалка деталей ЭПЛ парка */}
      {selectedEpl && (
        <Modal
          isOpen={!!selectedEpl}
          onClose={() => setSelectedEpl(null)}
          title={selectedEpl.waybillNumber || `Путевой лист #${selectedEpl.id}`}
          size="lg"
        >
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-0.5">
                  Парк
                </p>
                <p className="text-sm font-semibold text-slate-800">#{park.id} · {park.name}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-0.5">
                  Статус смены
                </p>
                <p className="text-sm font-semibold text-slate-800">
                  {selectedEpl.shiftStatus === 'active'
                    ? 'Смена открыта'
                    : selectedEpl.shiftStatus === 'closed'
                    ? 'Смена закрыта'
                    : selectedEpl.shiftStatus === 'auto_closed'
                    ? 'Смена авто-закрыта'
                    : 'Без смены'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-0.5">
                  Водитель
                </p>
                <p className="text-sm font-semibold text-slate-800">
                  {selectedEpl.driverName || '—'}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-0.5">
                  Автомобиль
                </p>
                <p className="text-sm font-semibold text-slate-800">
                  {selectedEpl.regNumber || '—'}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                Документы
              </p>
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                <span
                  className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    selectedEpl.hasFastDoc ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  Наш PDF
                </span>
                <span
                  className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    selectedEpl.hasOfficialDoc ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  Минтранс PDF
                </span>
                <span
                  className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    selectedEpl.hasMintransQr ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  Минтранс QR
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Создан: {formatDateMsk(selectedEpl.createdAt)}
              </p>
            </div>

            <div className="pt-1 space-y-1">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                Действия
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                {/* В очередь на создание в Такском */}
                {selectedEpl.hasFastDoc && !selectedEpl.hasOfficialDoc && (
                  <button
                    type="button"
                    disabled={eplModalRequeueLoading}
                    onClick={async () => {
                      try {
                        setEplModalRequeueLoading(true);
                        await api.post(`/admin/epl/${selectedEpl.id}/requeue-creation`);
                        showToast('✅ ЭПЛ отправлен в очередь на создание в Такском', 'success');
                      } catch (e) {
                        showToast(
                          `❌ Ошибка при отправке в очередь Минтранса: ${
                            e.response?.data?.error || e.message || 'Не удалось отправить запрос'
                          }`,
                          'error'
                        );
                      } finally {
                        setEplModalRequeueLoading(false);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-sky-300 text-sky-700 text-xs font-semibold hover:bg-sky-50 disabled:opacity-50"
                  >
                    {eplModalRequeueLoading ? 'Отправляем в очередь Минтранса...' : 'В очередь на создание в Такском'}
                  </button>
                )}

                {/* Вытянуть QR Минтранса */}
                {selectedEpl.hasOfficialDoc && !selectedEpl.hasMintransQr && (
                  <button
                    type="button"
                    disabled={eplModalRequeueLoading}
                    onClick={async () => {
                      try {
                        setEplModalRequeueLoading(true);
                        await api.post(`/admin/epl/${selectedEpl.id}/requeue-qr`);
                        showToast('✅ Запрос на QR Минтранса отправлен', 'success');
                      } catch (e) {
                        showToast(
                          `❌ Ошибка при запросе QR Минтранса: ${
                            e.response?.data?.error || e.message || 'Не удалось отправить запрос'
                          }`,
                          'error'
                        );
                      } finally {
                        setEplModalRequeueLoading(false);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-violet-300 text-violet-700 text-xs font-semibold hover:bg-violet-50 disabled:opacity-50"
                  >
                    {eplModalRequeueLoading ? 'Запрашиваем QR Минтранса...' : 'Вытянуть QR Минтранса'}
                  </button>
                )}
              </div>

              {/* Скачивание документов */}
              <div className="mt-3 space-y-1">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                  Скачать
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!selectedEpl.hasFastDoc}
                    onClick={async () => {
                      try {
                        const res = await api.get(`/admin/epl/${selectedEpl.id}/document-fast`, {
                          responseType: 'blob',
                        });
                        const blob = res.data;
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${selectedEpl.waybillNumber || `epl-${selectedEpl.id}`}.pdf`;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        setTimeout(() => URL.revokeObjectURL(url), 60000);
                      } catch (e) {
                        showToast(
                          `❌ Ошибка при скачивании нашего PDF: ${
                            e.response?.data?.error || e.message || 'Не удалось скачать документ'
                          }`,
                          'error'
                        );
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg border text-xs font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                  >
                    Наш PDF
                  </button>
                  <button
                    type="button"
                    disabled={!selectedEpl.hasOfficialDoc}
                    onClick={async () => {
                      try {
                        const res = await api.get(`/admin/epl/${selectedEpl.id}/document-mintrans`, {
                          responseType: 'blob',
                        });
                        const blob = res.data;
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${selectedEpl.waybillNumber || `epl-${selectedEpl.id}`}-mintrans.pdf`;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        setTimeout(() => URL.revokeObjectURL(url), 60000);
                      } catch (e) {
                        showToast(
                          `❌ Ошибка при скачивании Минтранс PDF: ${
                            e.response?.data?.error || e.message || 'Не удалось скачать документ'
                          }`,
                          'error'
                        );
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg border text-xs font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed border-blue-300 text-blue-700 hover:bg-blue-50"
                  >
                    Минтранс PDF
                  </button>
                  <button
                    type="button"
                    disabled={!selectedEpl.hasMintransQr}
                    onClick={async () => {
                      try {
                        const { data } = await api.get(`/admin/epl/${selectedEpl.id}/qr-mintrans`);
                        if (data?.qr) {
                          const w = window.open('', '_blank');
                          if (w) {
                            w.document.write(
                              `<html><body style="margin:0;display:flex;align-items:center;justify-content:center;background:#0f172a"><img src="${data.qr}" style="max-width:90vw;max-height:90vh;border-radius:16px;box-shadow:0 20px 40px rgba(15,23,42,0.7)"/></body></html>`
                            );
                          }
                        } else {
                          showToast('❌ QR Минтранса ещё не готов', 'error');
                        }
                      } catch (e) {
                        showToast(
                          `❌ Ошибка при получении QR Минтранса: ${
                            e.response?.data?.error || e.message || 'Не удалось получить QR'
                          }`,
                          'error'
                        );
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg border text-xs font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed border-violet-300 text-violet-700 hover:bg-violet-50"
                  >
                    QR Минтранса
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Модалка: пополнить баланс водителя */}
      {driverBalanceModal && (
        <Modal
          isOpen={!!driverBalanceModal}
          onClose={() => setDriverBalanceModal(null)}
          title="Пополнить баланс"
          size="sm"
        >
          <p className="text-slate-600 text-sm mb-6">{driverBalanceModal.fullName || driverBalanceModal.phone}</p>
          <div className="space-y-4">
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
          </div>
          <div className="flex gap-3 pt-6 border-t border-slate-200 mt-6">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleDriverBalance}
              disabled={actionLoading || !balanceAmount}
              className="flex-1 py-3 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white rounded-xl hover:from-emerald-700 hover:to-emerald-800 font-semibold transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {actionLoading ? 'Сохранение...' : 'Пополнить'}
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setDriverBalanceModal(null)}
              className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 font-semibold transition"
            >
              Отмена
            </motion.button>
          </div>
        </Modal>
      )}

      {/* Модалка: штраф водителю */}
      {driverFineModal && (
        <Modal
          isOpen={!!driverFineModal}
          onClose={() => setDriverFineModal(null)}
          title="Штраф"
          size="sm"
        >
          <p className="text-slate-600 text-sm mb-6">{driverFineModal.fullName || driverFineModal.phone}</p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Сумма (₽)</label>
              <input
                type="number"
                min="1"
                step="1"
                value={fineAmount}
                onChange={(e) => setFineAmount(e.target.value)}
                placeholder="0"
                className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Причина</label>
              <input
                type="text"
                value={fineDescription}
                onChange={(e) => setFineDescription(e.target.value)}
                placeholder="Штраф"
                className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition"
              />
            </div>
          </div>
          <div className="flex gap-3 pt-6 border-t border-slate-200 mt-6">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleDriverFine}
              disabled={actionLoading || !fineAmount}
              className="flex-1 py-3 bg-gradient-to-r from-amber-500 to-amber-600 text-white rounded-xl hover:from-amber-600 hover:to-amber-700 font-semibold transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {actionLoading ? 'Сохранение...' : 'Списать'}
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setDriverFineModal(null)}
              className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 font-semibold transition"
            >
              Отмена
            </motion.button>
          </div>
        </Modal>
      )}

      {/* Create / Attach Manager Modal */}
      {showModal && (
        <Modal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          title="Добавить менеджера"
          size="md"
        >
            <form onSubmit={handleCreateManager} className="space-y-4">
              {/* Режим: новый / существующий */}
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, mode: 'create' })}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border ${
                    formData.mode === 'create'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-slate-50 text-slate-700 border-slate-300'
                  }`}
                >
                  Новый менеджер
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, mode: 'attach' })}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border ${
                    formData.mode === 'attach'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-slate-50 text-slate-700 border-slate-300'
                  }`}
                >
                  Существующий
                </button>
              </div>

              {formData.mode === 'create' ? (
                <>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      ФИО *
                    </label>
                    <input
                      type="text"
                      value={formData.fullName}
                      onChange={(e) => setFormData({...formData, fullName: e.target.value})}
                      placeholder="Например: Иван Иванов"
                      className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Телефон *
                    </label>
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({...formData, phone: e.target.value})}
                      placeholder="Например: +7 (999) 123-45-67"
                      className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                      required
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Логин / телефон существующего менеджера *
                  </label>
                  <input
                    type="text"
                    value={formData.existingLogin}
                    onChange={(e) => setFormData({ ...formData, existingLogin: e.target.value })}
                    placeholder="Телефон или логин, который уже есть в системе"
                    className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                    required
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Менеджер с таким логином уже должен быть создан в системе. Мы просто привяжем его к этому парку.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Доступы
                </label>
                <select
                  value={formData.managerType}
                  onChange={(e) => setFormData({...formData, managerType: e.target.value})}
                  className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                >
                  <option value="park">Менеджер парка — Автопарк и Водители</option>
                  <option value="fc">Менеджер ФК — только Фотоконтроль</option>
                </select>
                <p className="text-xs text-slate-500 mt-1.5">
                  По умолчанию: доступ только к автопарку и водителям. Для доступа к фотоконтролю выберите «Менеджер ФК».
                </p>
              </div>

              {formData.mode === 'create' && (
                <p className="text-xs text-slate-500 bg-blue-50 border border-blue-200 rounded-lg p-3">
                  💡 Логин и пароль будут установлены равными номеру телефона
                </p>
              )}

              <div className="flex gap-3 pt-6 border-t border-slate-200">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 font-semibold transition shadow-md"
                >
                  Добавить
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 font-semibold transition"
                >
                  Отмена
                </motion.button>
              </div>
            </form>
        </Modal>
      )}

      {/* Manager Settings Modal */}
      {selectedManager && (
        <ManagerSettingsModal
          manager={selectedManager}
          isOpen={showManagerSettingsModal}
          onClose={() => {
            setShowManagerSettingsModal(false);
            setSelectedManager(null);
          }}
          onSave={() => {
            loadParkData();
          }}
          onDelete={handleDeleteManager}
        />
      )}

      {selectedDirector && (
        <DirectorSettingsModal
          director={selectedDirector}
          parkId={parkId}
          isOpen={!!selectedDirector}
          onClose={() => setSelectedDirector(null)}
          onSave={() => loadParkData()}
          onDetach={() => loadParkData()}
        />
      )}

      {showDirectorModal && (
        <Modal isOpen={showDirectorModal} onClose={() => setShowDirectorModal(false)} title="Добавить директора">
          <form onSubmit={handleCreateDirector} className="space-y-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDirectorForm((p) => ({ ...p, mode: 'create' }))}
                className={`flex-1 px-3 py-2 rounded-xl border-2 font-semibold text-sm ${
                  directorForm.mode === 'create'
                    ? 'bg-blue-50 border-blue-300 text-blue-700'
                    : 'bg-white border-slate-200 text-slate-700'
                }`}
              >
                Создать
              </button>
              <button
                type="button"
                onClick={() => setDirectorForm((p) => ({ ...p, mode: 'attach' }))}
                className={`flex-1 px-3 py-2 rounded-xl border-2 font-semibold text-sm ${
                  directorForm.mode === 'attach'
                    ? 'bg-blue-50 border-blue-300 text-blue-700'
                    : 'bg-white border-slate-200 text-slate-700'
                }`}
              >
                Привязать
              </button>
            </div>

            {directorForm.mode === 'create' ? (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">ФИО *</label>
                  <input
                    value={directorForm.fullName}
                    onChange={(e) => setDirectorForm((p) => ({ ...p, fullName: e.target.value }))}
                    className="w-full px-3 py-2 border-2 border-slate-200 rounded-xl"
                    placeholder="Иванов Иван"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Телефон (он же логин/пароль по умолчанию) *
                  </label>
                  <input
                    value={directorForm.phone}
                    onChange={(e) => setDirectorForm((p) => ({ ...p, phone: e.target.value }))}
                    className="w-full px-3 py-2 border-2 border-slate-200 rounded-xl"
                    placeholder="+79990000000"
                    required
                  />
                </div>
              </>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Логин или телефон существующего директора *
                </label>
                <input
                  value={directorForm.existingLogin}
                  onChange={(e) => setDirectorForm((p) => ({ ...p, existingLogin: e.target.value }))}
                  className="w-full px-3 py-2 border-2 border-slate-200 rounded-xl"
                  placeholder="+79990000000"
                  required
                />
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDirectorModal(false)}
                className="flex-1 px-3 py-2 rounded-xl bg-slate-100 text-slate-700 font-semibold"
              >
                Отмена
              </button>
              <button
                type="submit"
                className="flex-1 px-3 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold"
              >
                Сохранить
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Driver Settings Modal */}
      {selectedDriver && (
        <DriverSettingsModal
          driver={selectedDriver}
          cars={cars}
          parkId={parkId}
          drivers={drivers}
          isOpen={showDriverSettingsModal}
          onClose={() => {
            setShowDriverSettingsModal(false);
            setSelectedDriver(null);
          }}
          onSave={async () => {
            const data = await loadParkData();
            if (selectedDriver && data?.drivers) {
              const updated = data.drivers.find(d => d.userId === selectedDriver.userId || d.id === selectedDriver.id);
              if (updated) setSelectedDriver(updated);
            }
          }}
          onDelete={() => {
            setShowDriverSettingsModal(false);
            setSelectedDriver(null);
            loadParkData();
          }}
        />
      )}

      {/* Bind Car Modal (для водителя) */}
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
            loadParkData();
          }}
        />
      )}

      {/* Bind Driver Modal (для автомобиля) */}
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
            loadParkData();
          }}
        />
      )}

      {/* Car Settings Modal */}
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
            loadParkData();
          }}
          onDelete={() => {
            loadParkData();
          }}
          onOpenDriverSettings={(driver) => {
            setShowCarSettingsModal(false);
            setSelectedCar(null);
            setSelectedDriver(driver);
            setShowDriverSettingsModal(true);
          }}
        />
      )}

      {/* Модалка добавления авто */}
      {showAddCarModal && (
        <AddCarModal
          isOpen={showAddCarModal}
          onClose={() => setShowAddCarModal(false)}
          onSave={handleAddCar}
          parkId={parkId}
        />
      )}

      {/* Модальное окно добавления водителя */}
      {showAddDriverModal && (
        <AddDriverModal
          onClose={() => setShowAddDriverModal(false)}
          onSave={handleAddDriver}
        />
      )}
    </div>
  );
}
