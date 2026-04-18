import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Car, Users, Activity, User, ChevronDown, Camera, Link2, ChevronRight, Building2, CheckCircle2, BarChart2, Send, Wallet, Sun, Moon, Store, Clock3 } from 'lucide-react';
import { getBroadcastThreads, getDashboard, getManagerParks, getDrivers, impersonateDriver } from '../api/managerApi';
import { useAuth } from '../AuthContext';
import FleetTab from '../components/manager/FleetTab';
import DriversTab from '../components/manager/DriversTab';
import FCTab from '../components/manager/FCTab';
import StatsTab from '../components/manager/StatsTab';
import BroadcastsTab from '../components/manager/BroadcastsTab';
import BroadcastInboxTab from '../components/manager/BroadcastInboxTab';
import AdminFinance from '../components/admin/AdminFinance';
import ParkSettingsModal from '../components/admin/ParkSettingsModal';
import UserProfileMenu from '../components/shared/UserProfileMenu';
import UserProfileModal from '../components/shared/UserProfileModal';
import FreightOperationsBackdrop from '../components/freight/FreightOperationsBackdrop';
import FreightStoresTab from '../components/manager/FreightStoresTab';
import ShiftsCenter from '../components/shifts/ShiftsCenter';
import {
  readOperationsSceneNight,
  operationsShell,
  operationsInset,
  operationsHeaderStrip,
  operationsStickyTabsRow,
  operationsTabInactive,
} from '../utils/operationsUi';

/** Полоса «вернуться в админку» при входе от имени директора/менеджера из админки */
function AdminImpersonationBannerStrip() {
  const [hasBackup, setHasBackup] = useState(false);

  useEffect(() => {
    try {
      setHasBackup(!!sessionStorage.getItem('adminImpersonationBackup'));
    } catch {
      setHasBackup(false);
    }
  }, []);

  if (!hasBackup) return null;

  let returnTo = '/admin';
  try {
    const raw = sessionStorage.getItem('adminImpersonationBackup');
    if (raw) returnTo = JSON.parse(raw).returnTo || '/admin';
  } catch {
    returnTo = '/admin';
  }

  const exit = () => {
    try {
      const raw = sessionStorage.getItem('adminImpersonationBackup');
      if (!raw) return;
      const { token, user, returnTo: back } = JSON.parse(raw);
      sessionStorage.removeItem('adminImpersonationBackup');
      if (token) localStorage.setItem('token', token);
      if (user) localStorage.setItem('user', user);
      window.location.href = back || '/admin';
    } catch {
      sessionStorage.removeItem('adminImpersonationBackup');
      window.location.href = '/admin';
    }
  };

  const btnLabel = returnTo === '/manager' ? 'В кабинет менеджера' : 'В админку';

  return (
    <div className="sticky top-0 z-[200] flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-amber-400/95 text-slate-900 text-sm border-b border-amber-500/80 shadow-sm">
      <span className="font-medium">Просмотр от имени администратора (временная сессия)</span>
      <button
        type="button"
        onClick={exit}
        className="shrink-0 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs sm:text-sm font-semibold hover:bg-slate-800"
      >
        {btnLabel}
      </button>
    </div>
  );
}

function getParkKey(panelRole) {
  return panelRole === 'director' ? 'director_selected_park_id' : 'manager_selected_park_id';
}

function DirectorQuickDashboard({
  night,
  data,
  onOpenTab,
  canManageParkSettings,
  canAccessStats,
  canAccessBroadcasts,
  canAccessFC,
  canAccessShifts,
}) {
  const cards = [
    { id: 'cars', label: 'Авто', value: data?.carsCount || 0, icon: Car },
    { id: 'drivers', label: 'Водители', value: data?.driversCount || 0, icon: Users },
    { id: 'assigned', label: 'На линии', value: data?.assignedDrivers || 0, icon: Link2 },
  ];

  const actions = [
    { id: 'fleet', label: 'Автопарк', enabled: true },
    { id: 'drivers', label: 'Водители', enabled: true },
    { id: 'freight-stores', label: 'Точки выгрузки', enabled: true },
    { id: 'shifts', label: 'Смены', enabled: canAccessShifts },
    { id: 'broadcasts', label: 'Рассылки', enabled: canAccessBroadcasts },
    { id: 'fc', label: 'Фотоконтроль', enabled: canAccessFC },
    { id: 'stats', label: 'Статистика', enabled: canAccessStats },
    { id: 'park-settings', label: 'Настройки парка', enabled: canManageParkSettings },
  ].filter((x) => x.enabled);

  return (
    <div className={`rounded-2xl p-4 sm:p-5 ${operationsShell(night)}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className={`text-xs uppercase tracking-wide ${night ? 'text-slate-400' : 'text-slate-500'}`}>Кабинет директора</p>
          <h2 className={`text-lg font-bold ${night ? 'text-slate-100' : 'text-slate-900'}`}>{data?.name || 'Парк'}</h2>
        </div>
        <button
          type="button"
          onClick={() => onOpenTab('park-settings')}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold ${
            night
              ? 'border border-white/20 bg-white/[0.08] text-slate-100 hover:bg-white/[0.15]'
              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          <Activity className="h-4 w-4" />
          Настроить
        </button>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
        {cards.map(({ id, label, value, icon: Icon }) => (
          <div key={id} className={`rounded-xl px-3 py-3 ${operationsInset(night)}`}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className={`text-[11px] ${night ? 'text-slate-400' : 'text-slate-500'}`}>{label}</span>
              <Icon className={`h-4 w-4 ${night ? 'text-slate-300' : 'text-slate-500'}`} />
            </div>
            <div className={`text-xl font-bold leading-none ${night ? 'text-slate-100' : 'text-slate-900'}`}>{value}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {actions.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onOpenTab(a.id)}
            className={`inline-flex items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold ${
              night
                ? 'border border-white/15 bg-white/[0.06] text-slate-100 hover:bg-white/[0.12]'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span>{a.label}</span>
            <ChevronRight className="h-3.5 w-3.5 opacity-70" />
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ManagerPanel({ panelRole = 'manager' }) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('fleet');
  const [dashboardData, setDashboardData] = useState(null);
  const [broadcastUnreadCount, setBroadcastUnreadCount] = useState(0);

  // Parks list
  const [parks, setParks] = useState([]);
  const [parksLoading, setParksLoading] = useState(true);
  const [selectedParkId, setSelectedParkId] = useState(() => {
    const saved = localStorage.getItem(getParkKey(panelRole));
    return saved ? parseInt(saved, 10) : null;
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [viewAs, setViewAs] = useState('manager');
  const [driverList, setDriverList] = useState([]);
  const [driverListLoading, setDriverListLoading] = useState(false);
  const [selectedDriverForView, setSelectedDriverForView] = useState(null);
  const [impersonating, setImpersonating] = useState(false);
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const roleMenuAnchorRef = useRef(null);
  const [roleMenuPos, setRoleMenuPos] = useState(null);
  const [parkDropdownOpen, setParkDropdownOpen] = useState(false);
  const isDirectorPanel = panelRole === 'director' || user?.role === 'director';
  const [operationsNight, setOperationsNight] = useState(readOperationsSceneNight);

  useEffect(() => {
    if (!isDirectorPanel) return;
    const tokenParkId = Number.parseInt(user?.parkId, 10);
    if (!Number.isFinite(tokenParkId) || tokenParkId <= 0) return;
    setSelectedParkId(tokenParkId);
    localStorage.setItem(getParkKey(panelRole), String(tokenParkId));
  }, [isDirectorPanel, user?.parkId, panelRole]);

  useEffect(() => {
    try {
      localStorage.setItem('freight_operations_scene', operationsNight ? 'night' : 'day');
    } catch (_) {}
  }, [operationsNight]);

  useLayoutEffect(() => {
    if (!roleDropdownOpen || isDirectorPanel) {
      setRoleMenuPos(null);
      return;
    }
    let rafInner = 0;
    const measure = () => {
      const el = roleMenuAnchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (rect.width < 0.5 || rect.height < 0.5 || !Number.isFinite(rect.right) || !Number.isFinite(rect.bottom)) {
        return;
      }
      if (rect.left > vw + 4) return;
      const top = Math.min(Math.max(8, rect.bottom + 6), vh - 8);
      const right = Math.min(vw - 8, Math.max(8, vw - rect.right));
      setRoleMenuPos({ top, right });
    };
    measure();
    const rafOuter = requestAnimationFrame(() => {
      measure();
      rafInner = requestAnimationFrame(measure);
    });
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(rafOuter);
      cancelAnimationFrame(rafInner);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [roleDropdownOpen, isDirectorPanel]);

  // Load parks list on mount
  useEffect(() => {
    const fetchParks = async () => {
      try {
        setParksLoading(true);
        const list = await getManagerParks();
        setParks(list || []);
        // Auto-select if only one park or if saved selection is valid
        if (list && list.length === 1) {
          setSelectedParkId(list[0].id);
          localStorage.setItem(getParkKey(panelRole), list[0].id);
        } else if (list && list.length > 0) {
          const savedId = parseInt(localStorage.getItem(getParkKey(panelRole)), 10);
          const isValid = list.some((p) => p.id === savedId);
          if (!isValid) {
            setSelectedParkId(null);
            localStorage.removeItem(getParkKey(panelRole));
          }
        }
      } catch {
        setParks([]);
      } finally {
        setParksLoading(false);
      }
    };
    fetchParks();
  }, [panelRole]);

  // Load dashboard when selectedParkId changes
  useEffect(() => {
    if (!selectedParkId) return;
    const fetchDashboard = async () => {
      try {
        setLoading(true);
        const data = await getDashboard(selectedParkId);
        setDashboardData(data);
        setError(null);
      } catch (err) {
        setError(err.response?.data?.error || 'Ошибка загрузки');
      } finally {
        setLoading(false);
      }
    };
    fetchDashboard();
  }, [selectedParkId]);

  const handleSelectPark = useCallback((parkId) => {
    setSelectedParkId(parkId);
    localStorage.setItem(getParkKey(panelRole), parkId);
    setParkDropdownOpen(false);
    setActiveTab('fleet');
    setDashboardData(null);
  }, [panelRole]);

  useEffect(() => {
    if (isDirectorPanel) return;
    if (viewAs === 'driver' && selectedParkId) {
      setDriverListLoading(true);
      getDrivers(selectedParkId)
        .then((list) => setDriverList(list || []))
        .catch(() => setDriverList([]))
        .finally(() => setDriverListLoading(false));
    } else {
      setSelectedDriverForView(null);
    }
  }, [isDirectorPanel, viewAs, selectedParkId]);

  const isFCManager = dashboardData?.managerType === 'fc';
  const canAccessFC = dashboardData?.canAccessPhotoControl;
  const canAccessStats = dashboardData?.canAccessStatistics;
  const canAccessBroadcasts = !!dashboardData?.canAccessBroadcasts;
  const canAccessShifts = canAccessBroadcasts;
  const canAccessFinance = !!dashboardData?.canAccessFinance;
  const parkSettingsPermissions = {
    canParkSettingsStatusName: !!dashboardData?.canParkSettingsStatusName,
    canParkSettingsTakskom: !!dashboardData?.canParkSettingsTakskom,
    canParkSettingsStaff: !!dashboardData?.canParkSettingsStaff,
    canParkSettingsFreight: !!dashboardData?.canParkSettingsFreight,
    canParkSettingsBroadcasts: !!dashboardData?.canParkSettingsBroadcasts,
    canParkSettingsOwners: !!dashboardData?.canParkSettingsOwners,
    canParkSettingsBalance: !!dashboardData?.canParkSettingsBalance,
    canParkSettingsPricing: !!dashboardData?.canParkSettingsPricing,
    canParkSettingsGame: !!dashboardData?.canParkSettingsGame,
    canParkSettingsPhotoControl: !!dashboardData?.canParkSettingsPhotoControl,
    canParkSettingsServices: !!dashboardData?.canParkSettingsServices,
  };
  const canManageParkSettings = !!(
    isDirectorPanel ||
    dashboardData?.canManageParkSettings ||
    Object.values(parkSettingsPermissions).some(Boolean)
  );
  const eplPermissions = {
    canViewEplLogs: !!dashboardData?.canViewEplLogs,
    canControlEplQueue: !!dashboardData?.canControlEplQueue,
    canCloseEplShifts: !!dashboardData?.canCloseEplShifts,
    canChargeOnShiftClose: !!dashboardData?.canChargeOnShiftClose,
    canDownloadEplDocs: !!dashboardData?.canDownloadEplDocs,
  };
  const statsPermissions = {
    showFinance: dashboardData?.statsShowFinance !== false,
    showEpl: dashboardData?.statsShowEpl !== false,
    showDrivers: dashboardData?.statsShowDrivers !== false,
  };
  const tabs = isFCManager
    ? [{ id: 'fc', label: 'Фотоконтроль', icon: Camera, color: 'emerald' }]
    : [
        { id: 'fleet', label: 'Автопарк', icon: Car, color: 'emerald' },
        { id: 'drivers', label: 'Водители', icon: Users, color: 'purple' },
        { id: 'freight-stores', label: 'Точки выгрузки', icon: Store, color: 'emerald' },
        ...(canAccessShifts ? [{ id: 'shifts', label: 'Смены', icon: Clock3, color: 'emerald' }] : []),
        ...(canAccessBroadcasts ? [{ id: 'broadcasts', label: 'Рассылки', icon: Send, color: 'indigo' }] : []),
        ...(canAccessBroadcasts ? [{ id: 'broadcast-inbox', label: 'Ответы', icon: Send, color: 'indigo', badge: broadcastUnreadCount }] : []),
        ...(canAccessFC ? [{ id: 'fc', label: 'Фотоконтроль', icon: Camera, color: 'sky' }] : []),
        ...(canAccessStats ? [{ id: 'stats', label: 'Статистика', icon: BarChart2, color: 'violet' }] : []),
        ...(isDirectorPanel && canManageParkSettings ? [{ id: 'park-settings', label: 'Настройки', icon: Activity, color: 'emerald' }] : []),
        ...(canAccessFinance ? [{ id: 'finance', label: 'Касса', icon: Wallet, color: 'blue' }] : []),
      ];

  const reloadBroadcastUnread = useCallback(async () => {
    if (!canAccessBroadcasts || !selectedParkId) { setBroadcastUnreadCount(0); return; }
    try {
      const rows = await getBroadcastThreads({ unread: 1 }, selectedParkId);
      setBroadcastUnreadCount(Array.isArray(rows) ? rows.length : 0);
    } catch {
      setBroadcastUnreadCount(0);
    }
  }, [canAccessBroadcasts, selectedParkId]);

  useEffect(() => {
    reloadBroadcastUnread();
  }, [reloadBroadcastUnread]);
  useEffect(() => {
    if (isFCManager) setActiveTab('fc');
  }, [isFCManager]);

  const selectedPark = parks.find((p) => p.id === selectedParkId);

  // === PARK SELECTION SCREEN ===
  if (parksLoading) {
    return (
      <div className="relative min-h-screen">
        <FreightOperationsBackdrop night={operationsNight} />
        <div className="relative z-10 flex min-h-screen items-center justify-center">
          <div className={`rounded-2xl px-8 py-6 text-center shadow-xl ${operationsShell(operationsNight)}`}>
            <div className="mb-4 inline-block h-12 w-12 animate-spin rounded-full border-b-2 border-teal-600" />
            <p className={`font-semibold ${operationsNight ? 'text-slate-200' : 'text-slate-700'}`}>Загрузка парков...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!selectedParkId || !parks.find((p) => p.id === selectedParkId)) {
    return (
      <div className="relative min-h-screen">
        <FreightOperationsBackdrop night={operationsNight} />
        <div className="relative z-10 min-h-screen">
        <AdminImpersonationBannerStrip />
        <div className={operationsHeaderStrip(operationsNight)}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`p-2 rounded-lg ${
                  operationsNight ? 'bg-white/10' : 'bg-teal-100/90 border border-teal-200/80'
                }`}
              >
                <Activity className={`w-5 h-5 ${operationsNight ? 'text-white' : 'text-teal-700'}`} />
              </div>
              <h1 className={`text-xl font-bold ${operationsNight ? 'text-white' : 'text-slate-900'}`}>
                {panelRole === 'director' ? 'Кабинет директора' : 'Кабинет менеджера'}
              </h1>
            </div>
            <button
              type="button"
              onClick={() => setOperationsNight((n) => !n)}
              className={`flex shrink-0 items-center justify-center rounded-xl border p-2.5 shadow-sm backdrop-blur-md transition ${
                operationsNight
                  ? 'border-white/20 bg-white/[0.08] text-amber-200 hover:bg-white/[0.14]'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
              title={operationsNight ? 'Светлая сцена' : 'Ночная сцена'}
            >
              {operationsNight ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            {user && (
              <UserProfileMenu user={user} onProfileClick={() => setShowProfileModal(true)} />
            )}
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="text-center mb-8">
              <div
                className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 ${
                  operationsNight ? 'bg-teal-500/25 text-teal-200 ring-1 ring-teal-400/30' : 'bg-teal-100'
                }`}
              >
                <Building2 className={`w-8 h-8 ${operationsNight ? 'text-teal-200' : 'text-teal-700'}`} />
              </div>
              <h2 className={`text-2xl sm:text-3xl font-bold mb-2 ${operationsNight ? 'text-slate-50' : 'text-slate-800'}`}>
                Выберите автопарк
              </h2>
              <p className={`text-sm sm:text-base ${operationsNight ? 'text-slate-400' : 'text-slate-500'}`}>
                {parks.length === 0
                  ? 'Вы не привязаны ни к одному парку. Обратитесь к администратору.'
                  : `У вас есть доступ к ${parks.length} ${parks.length === 1 ? 'парку' : parks.length < 5 ? 'паркам' : 'паркам'}`}
              </p>
            </div>

            {parks.length === 0 ? (
              <div
                className={`rounded-2xl p-6 text-center ${
                  operationsNight ? 'border border-amber-500/30 bg-amber-950/35 text-amber-100' : 'border border-amber-200 bg-amber-50'
                }`}
              >
                <p className={`font-semibold ${operationsNight ? 'text-amber-100' : 'text-amber-700'}`}>Нет доступных парков</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {parks.map((park, i) => (
                  <motion.button
                    key={park.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.07 }}
                    whileHover={{ scale: 1.02, y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleSelectPark(park.id)}
                    className={`group text-left rounded-2xl p-5 shadow-sm backdrop-blur-md transition-all hover:shadow-md ${operationsShell(
                      operationsNight
                    )} ${operationsNight ? 'hover:border-teal-400/30 hover:ring-teal-400/10' : 'hover:border-teal-200'}`}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div
                          className={`p-2.5 rounded-xl transition-colors ${
                            operationsNight ? 'bg-teal-500/20 text-teal-200' : 'bg-teal-50 group-hover:bg-teal-100'
                          }`}
                        >
                          <Building2 className={`w-5 h-5 ${operationsNight ? 'text-teal-200' : 'text-teal-700'}`} />
                        </div>
                        <div>
                          <h3 className={`font-bold text-base leading-tight ${operationsNight ? 'text-slate-50' : 'text-slate-800'}`}>
                            {park.name}
                          </h3>
                          {park.city && (
                            <p className={`text-xs mt-0.5 ${operationsNight ? 'text-slate-400' : 'text-slate-500'}`}>{park.city}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {park.isActive ? (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                              operationsNight
                                ? 'bg-emerald-500/25 text-emerald-200 ring-1 ring-emerald-400/25'
                                : 'bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            <CheckCircle2 className="w-3 h-3" /> Активен
                          </span>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                              operationsNight ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            Неактивен
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className={`rounded-xl p-2.5 text-center ${operationsInset(operationsNight)}`}>
                        <Car className={`w-4 h-4 mx-auto mb-1 ${operationsNight ? 'text-slate-300' : 'text-slate-500'}`} />
                        <div className={`font-bold text-lg leading-none ${operationsNight ? 'text-slate-100' : 'text-slate-800'}`}>
                          {park.carsCount ?? 0}
                        </div>
                        <div className={`text-xs mt-0.5 ${operationsNight ? 'text-slate-400' : 'text-slate-500'}`}>Авто</div>
                      </div>
                      <div className={`rounded-xl p-2.5 text-center ${operationsInset(operationsNight)}`}>
                        <Users className={`w-4 h-4 mx-auto mb-1 ${operationsNight ? 'text-slate-300' : 'text-slate-500'}`} />
                        <div className={`font-bold text-lg leading-none ${operationsNight ? 'text-slate-100' : 'text-slate-800'}`}>
                          {park.driversCount ?? 0}
                        </div>
                        <div className={`text-xs mt-0.5 ${operationsNight ? 'text-slate-400' : 'text-slate-500'}`}>Водит.</div>
                      </div>
                      <div className={`rounded-xl p-2.5 text-center ${operationsInset(operationsNight)}`}>
                        <Link2 className={`w-4 h-4 mx-auto mb-1 ${operationsNight ? 'text-slate-300' : 'text-slate-500'}`} />
                        <div className={`font-bold text-lg leading-none ${operationsNight ? 'text-slate-100' : 'text-slate-800'}`}>
                          {park.bindingsCount ?? 0}
                        </div>
                        <div className={`text-xs mt-0.5 ${operationsNight ? 'text-slate-400' : 'text-slate-500'}`}>Связок</div>
                      </div>
                    </div>

                    <div
                      className={`mt-3 flex items-center justify-end text-sm font-semibold gap-1 group-hover:gap-2 transition-all ${
                        operationsNight ? 'text-teal-300' : 'text-teal-700'
                      }`}
                    >
                      Открыть <ChevronRight className="w-4 h-4" />
                    </div>
                  </motion.button>
                ))}
              </div>
            )}
          </motion.div>
        </div>

        {user && (
          <UserProfileModal
            user={user}
            isOpen={showProfileModal}
            onClose={() => setShowProfileModal(false)}
          />
        )}
        </div>
      </div>
    );
  }

  // === MAIN PANEL (park selected) ===

  if (loading && !dashboardData) {
    return (
      <div className="relative min-h-screen">
        <FreightOperationsBackdrop night={operationsNight} />
        <div className="relative z-10 flex min-h-screen items-center justify-center">
          <div className={`rounded-2xl px-8 py-6 text-center shadow-xl ${operationsShell(operationsNight)}`}>
            <div className="mb-4 inline-block h-12 w-12 animate-spin rounded-full border-b-2 border-teal-600" />
            <p className={`font-semibold ${operationsNight ? 'text-slate-200' : 'text-slate-700'}`}>Загрузка...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="relative min-h-screen">
        <FreightOperationsBackdrop night={operationsNight} />
        <div className="relative z-10 flex min-h-screen items-center justify-center p-4">
          <div className="max-w-md rounded-xl border-2 border-red-200 bg-red-50/95 p-6 text-center shadow-xl backdrop-blur-sm">
            <p className="mb-4 font-semibold text-red-700">Ошибка: {error}</p>
            <button
              type="button"
              onClick={() => { setSelectedParkId(null); localStorage.removeItem(getParkKey(panelRole)); }}
              className="freight-btn-primary"
            >
              Выбрать другой парк
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
      <FreightOperationsBackdrop night={operationsNight} />
      <div className="relative z-10 min-h-screen">
      <AdminImpersonationBannerStrip />
      {/* Хедер */}
      <div className={operationsHeaderStrip(operationsNight)}>
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="flex items-center justify-between gap-2 sm:gap-4 flex-nowrap min-h-[48px]"
          >
            <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
              <div
                className={`p-1.5 sm:p-2 rounded-lg shrink-0 ${
                  operationsNight ? 'bg-white/10 backdrop-blur-sm' : 'bg-teal-100/90 border border-teal-200/80'
                }`}
              >
                <Activity className={`w-5 h-5 ${operationsNight ? 'text-white' : 'text-teal-700'}`} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1
                    className={`text-base sm:text-xl font-bold truncate max-w-[160px] sm:max-w-xs ${
                      operationsNight ? 'text-white' : 'text-slate-900'
                    }`}
                  >
                    {dashboardData?.name || selectedPark?.name || 'Панель менеджера'}
                  </h1>
                  {/* Park switcher — only if >1 park */}
                  {parks.length > 1 && (
                    <div className="relative shrink-0" style={{ zIndex: 50 }}>
                      <button
                        onClick={() => setParkDropdownOpen((v) => !v)}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition border ${
                          operationsNight
                            ? 'bg-white/15 hover:bg-white/25 border-white/30 text-white'
                            : 'bg-white border border-slate-200 text-slate-800 hover:bg-slate-50 shadow-sm'
                        }`}
                      >
                        Сменить <ChevronDown className={`w-3 h-3 transition-transform ${parkDropdownOpen ? 'rotate-180' : ''}`} />
                      </button>
                      {parkDropdownOpen && (
                        <>
                          <div
                            className="fixed inset-0"
                            style={{ zIndex: 49 }}
                            onClick={() => setParkDropdownOpen(false)}
                          />
                          <div
                            className={`absolute left-0 top-full mt-2 py-1 rounded-xl shadow-2xl min-w-[220px] ${
                              operationsNight
                                ? 'bg-slate-900/95 border border-white/15 backdrop-blur-xl'
                                : 'bg-white border border-slate-200'
                            }`}
                            style={{ zIndex: 50 }}
                          >
                            <div className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wide mb-1 ${
                              operationsNight ? 'text-slate-400 border-b border-white/10' : 'text-slate-400 border-b border-slate-100'
                            }`}>
                              Ваши парки
                            </div>
                            {parks.map((p) => (
                              <button
                                key={p.id}
                                onClick={() => handleSelectPark(p.id)}
                                className={`w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors ${
                                  p.id === selectedParkId
                                    ? (operationsNight ? 'bg-teal-500/20 text-teal-100 font-bold' : 'bg-teal-50 text-teal-800 font-bold')
                                    : (operationsNight ? 'text-slate-200 hover:bg-white/10' : 'text-slate-700 hover:bg-slate-50')
                                }`}
                              >
                                <Building2 className={`w-4 h-4 shrink-0 ${operationsNight ? 'text-slate-500' : 'text-slate-400'}`} />
                                <span className="flex-1 truncate">{p.name}</span>
                                {p.id === selectedParkId && <CheckCircle2 className="w-3.5 h-3.5 text-teal-600 shrink-0" />}
                              </button>
                            ))}
                            <div className={`mt-1 pt-1 ${operationsNight ? 'border-t border-white/10' : 'border-t border-slate-100'}`}>
                              <button
                                onClick={() => { setSelectedParkId(null); localStorage.removeItem(getParkKey(panelRole)); setParkDropdownOpen(false); }}
                                className={`w-full flex items-center gap-2 px-4 py-2 text-left text-xs transition-colors ${
                                  operationsNight ? 'text-slate-400 hover:bg-white/10' : 'text-slate-400 hover:bg-slate-50'
                                }`}
                              >
                                ← Список всех парков
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {dashboardData && (
                  <div
                    className={`hidden sm:flex items-center gap-2 mt-0.5 text-xs ${
                      operationsNight ? 'text-teal-100' : 'text-slate-600'
                    }`}
                  >
                    <Users className="w-3 h-3" />
                    <span>
                      Водит.:{' '}
                      <span className={`font-semibold ${operationsNight ? 'text-white' : 'text-slate-900'}`}>
                        {dashboardData.driversCount || 0}
                      </span>
                    </span>
                    <span className={operationsNight ? 'text-teal-200' : 'text-slate-400'}>•</span>
                    <Car className="w-3 h-3" />
                    <span>
                      Авто:{' '}
                      <span className={`font-semibold ${operationsNight ? 'text-white' : 'text-slate-900'}`}>
                        {dashboardData.carsCount || 0}
                      </span>
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <div className="relative shrink-0">
                {!isDirectorPanel && (
                  <span ref={roleMenuAnchorRef} className="inline-flex">
                    <button
                      type="button"
                      onClick={() => setRoleDropdownOpen((v) => !v)}
                      className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-2 rounded-xl font-semibold transition shrink-0 ${
                        operationsNight
                          ? 'bg-white/10 backdrop-blur-sm border border-white/20 text-white hover:bg-white/20'
                          : 'bg-white border border-slate-200 text-slate-800 hover:bg-slate-50 shadow-sm'
                      }`}
                    >
                      {viewAs === 'manager' && <Users className="w-4 h-4 shrink-0" />}
                      {viewAs === 'driver' && <User className="w-4 h-4 shrink-0" />}
                      <span className="hidden sm:inline whitespace-nowrap">{viewAs === 'manager' ? 'Менеджер' : 'Водитель'}</span>
                      <ChevronDown className="w-4 h-4 shrink-0" />
                    </button>
                  </span>
                )}
                {roleDropdownOpen &&
                  !isDirectorPanel &&
                  roleMenuPos &&
                  typeof document !== 'undefined' &&
                  createPortal(
                    <>
                      <div
                        className="fixed inset-0 z-[200] bg-black/10 sm:bg-transparent"
                        onClick={() => setRoleDropdownOpen(false)}
                        aria-hidden
                      />
                      <div
                        className={`fixed z-[210] py-1 rounded-xl shadow-lg min-w-[160px] max-w-[min(16rem,calc(100vw-1rem))] whitespace-nowrap ${
                          operationsNight ? 'bg-slate-900/95 border border-white/15 backdrop-blur-xl' : 'bg-white border border-slate-200'
                        }`}
                        style={{ top: roleMenuPos.top, right: roleMenuPos.right }}
                        role="menu"
                      >
                        <button
                          type="button"
                          onClick={() => { setRoleDropdownOpen(false); setViewAs('manager'); }}
                          className={`w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm ${
                            viewAs === 'manager'
                              ? (operationsNight ? 'bg-teal-500/20 text-teal-100 font-semibold' : 'bg-teal-50 text-teal-800 font-semibold')
                              : (operationsNight ? 'text-slate-200 hover:bg-white/10' : 'text-slate-700 hover:bg-slate-50')
                          }`}
                        >
                          <Users className="w-4 h-4 shrink-0" /> Менеджер
                        </button>
                        <button
                          type="button"
                          onClick={() => { setRoleDropdownOpen(false); setViewAs('driver'); }}
                          className={`w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm ${
                            viewAs === 'driver'
                              ? (operationsNight ? 'bg-teal-500/20 text-teal-100 font-semibold' : 'bg-teal-50 text-teal-800 font-semibold')
                              : (operationsNight ? 'text-slate-200 hover:bg-white/10' : 'text-slate-700 hover:bg-slate-50')
                          }`}
                        >
                          <User className="w-4 h-4 shrink-0" /> Водитель
                        </button>
                      </div>
                    </>,
                    document.body
                  )}
              </div>
              <button
                type="button"
                onClick={() => setOperationsNight((n) => !n)}
                className={`flex shrink-0 items-center justify-center rounded-xl border p-2.5 shadow-sm backdrop-blur-md transition ${
                  operationsNight
                    ? 'border-white/20 bg-white/[0.08] text-amber-200 hover:bg-white/[0.14]'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
                title={operationsNight ? 'Светлая сцена' : 'Ночная сцена'}
              >
                {operationsNight ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </button>
              {user && (
                <UserProfileMenu user={user} onProfileClick={() => setShowProfileModal(true)} />
              )}
            </div>
          </motion.div>
        </div>
      </div>

      {/* Режим «Водитель» */}
      {!isDirectorPanel && viewAs === 'driver' && (
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4">
          <div className={`rounded-xl p-6 ${operationsShell(operationsNight)}`}>
            <h2 className={`text-lg font-bold mb-4 ${operationsNight ? 'text-slate-100' : 'text-slate-800'}`}>
              Открыть кабинет водителя
            </h2>
            {!selectedDriverForView ? (
              <>
                {driverListLoading ? (
                  <p className="text-slate-500">Загрузка водителей...</p>
                ) : driverList.length === 0 ? (
                  <p className="text-slate-500">В парке нет водителей</p>
                ) : (
                  <ul className="space-y-2">
                    {driverList.map((d) => (
                      <li key={d.userId || d.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedDriverForView(d)}
                          className={`w-full text-left px-4 py-3 rounded-lg font-medium transition ${
                            operationsNight
                              ? 'border border-white/12 bg-white/[0.06] text-slate-100 hover:bg-teal-500/15 hover:border-teal-400/30'
                              : 'border border-white/50 bg-white/40 hover:bg-teal-50/90 hover:border-teal-200/80 text-slate-800 backdrop-blur-sm'
                          }`}
                        >
                          {d.fullName || d.phone || `Водитель #${d.userId}`}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <div>
                <p className="text-slate-600 mb-4">
                  Водитель: <strong>{selectedDriverForView.fullName || selectedDriverForView.phone}</strong>. Открыть кабинет (токен на 1 час).
                </p>
                <div className="flex gap-3">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setSelectedDriverForView(null)}
                    className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 font-semibold"
                  >
                    Назад
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={async () => {
                      setImpersonating(true);
                      try {
                        const data = await impersonateDriver(selectedDriverForView.userId, selectedParkId);
                        const backup = { token: localStorage.getItem('token'), user: localStorage.getItem('user'), returnTo: '/manager' };
                        sessionStorage.setItem('adminImpersonationBackup', JSON.stringify(backup));
                        localStorage.setItem('token', data.token);
                        localStorage.setItem('user', JSON.stringify(data.user));
                        window.location.href = '/driver';
                      } catch (e) {
                        alert(`Ошибка: ${e.response?.data?.error || e.message}`);
                      } finally {
                        setImpersonating(false);
                      }
                    }}
                    disabled={impersonating}
                    className="px-6 py-2 bg-gradient-to-r from-teal-600 to-teal-800 text-white rounded-xl hover:from-teal-700 hover:to-teal-900 font-semibold shadow-md disabled:opacity-50"
                  >
                    {impersonating ? 'Открытие...' : 'Открыть кабинет'}
                  </motion.button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {viewAs === 'manager' && isDirectorPanel && (
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-4 sm:pt-5">
          <DirectorQuickDashboard
            night={operationsNight}
            data={dashboardData}
            onOpenTab={setActiveTab}
            canManageParkSettings={canManageParkSettings}
            canAccessStats={canAccessStats}
            canAccessBroadcasts={canAccessBroadcasts}
            canAccessFC={canAccessFC}
            canAccessShifts={canAccessShifts}
          />
        </div>
      )}

      {/* Табы */}
      {viewAs === 'manager' && (
        <div className={`sticky top-0 z-20 ${operationsStickyTabsRow(operationsNight)}`}>
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-9 gap-2 py-2">
              {tabs.map((tab, index) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                const inactive = operationsTabInactive(operationsNight);
                const colorClasses = {
                  emerald: isActive
                    ? 'bg-gradient-to-r from-teal-600 to-teal-700 text-white shadow-md'
                    : inactive,
                  purple: isActive
                    ? 'bg-gradient-to-r from-violet-600 to-violet-700 text-white shadow-md'
                    : inactive,
                  sky: isActive
                    ? 'bg-gradient-to-r from-sky-500 to-sky-600 text-white shadow-md'
                    : inactive,
                  violet: isActive
                    ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-md'
                    : inactive,
                  blue: isActive
                    ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md'
                    : inactive,
                  indigo: isActive
                    ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-md'
                    : inactive,
                };
                return (
                  <motion.button
                    key={tab.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setActiveTab(tab.id)}
                    className={`relative flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-2.5 font-semibold text-xs sm:text-sm transition-all rounded-xl border ${colorClasses[tab.color]}`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{tab.label}</span>
                    {tab.badge > 0 && (
                      <span className={`ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[11px] font-bold ${
                        isActive ? 'bg-white text-slate-900' : 'bg-teal-600 text-white'
                      }`}>
                        {tab.badge > 99 ? '99+' : tab.badge}
                      </span>
                    )}
                  </motion.button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Контент */}
      {viewAs === 'manager' && (
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${activeTab}-${selectedParkId}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab === 'fleet' && <FleetTab parkId={selectedParkId} sceneNight={operationsNight} />}
              {activeTab === 'drivers' && <DriversTab parkId={selectedParkId} sceneNight={operationsNight} />}
              {activeTab === 'freight-stores' && (
                <FreightStoresTab parkId={selectedParkId} sceneNight={operationsNight} useAdminApi={false} />
              )}
              {activeTab === 'broadcasts' && (
                <BroadcastsTab
                  parkId={selectedParkId}
                  sceneNight={operationsNight}
                  onSent={({ requireReply }) => {
                    if (requireReply) setActiveTab('broadcast-inbox');
                    reloadBroadcastUnread();
                  }}
                />
              )}
              {activeTab === 'broadcast-inbox' && (
                <BroadcastInboxTab
                  parkId={selectedParkId}
                  sceneNight={operationsNight}
                  onUnreadCountChange={(n) => setBroadcastUnreadCount(n)}
                />
              )}
              {activeTab === 'shifts' && (
                <ShiftsCenter
                  role={isDirectorPanel ? 'director' : 'manager'}
                  parkId={selectedParkId}
                  parkMeta={selectedPark || null}
                  sceneNight={operationsNight}
                  canManage={canAccessShifts}
                />
              )}
              {activeTab === 'fc' && <FCTab parkId={selectedParkId} sceneNight={operationsNight} />}
              {activeTab === 'stats' && (
                <StatsTab
                  parkId={selectedParkId}
                  sceneNight={operationsNight}
                  permissions={statsPermissions}
                  eplPermissions={eplPermissions}
                />
              )}
              {activeTab === 'park-settings' && isDirectorPanel && canManageParkSettings && (
                <ParkSettingsModal
                  park={selectedPark || { id: selectedParkId, name: dashboardData?.parkName || `Парк #${selectedParkId}` }}
                  isOpen
                  onClose={() => setActiveTab('fleet')}
                  onSave={async () => {
                    try {
                      if (!selectedParkId) return;
                      const data = await getDashboard(selectedParkId);
                      setDashboardData(data);
                    } catch (_) {}
                  }}
                  apiPrefix="director"
                  canDeletePark={false}
                  settingsPermissions={parkSettingsPermissions}
                />
              )}
              {activeTab === 'finance' && <AdminFinance sceneNight={operationsNight} />}
            </motion.div>
          </AnimatePresence>
        </div>
      )}

      {user && (
        <UserProfileModal
          user={user}
          isOpen={showProfileModal}
          onClose={() => setShowProfileModal(false)}
        />
      )}
      </div>
    </div>
  );
}
