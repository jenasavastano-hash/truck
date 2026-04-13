import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Building2, ChevronDown, User, Users, Shield, FileText, Truck, Send, ShieldAlert, Wallet, Landmark, Sun, Moon } from 'lucide-react';
import { useAuth } from '../AuthContext';
import api from '../api';
import AdminParksList from '../components/AdminParksList';
import AdminParkManager from '../components/AdminParkManager';
import AdminEplList from '../components/AdminEplList';
import AdminEvacuators from '../components/admin/AdminEvacuators';
import AdminCommissioners from '../components/admin/AdminCommissioners';
import AdminDriversMonitoring from '../components/admin/AdminDriversMonitoring';
import AdminFinance from '../components/admin/AdminFinance';
import { FEATURE_EVACUATOR_AND_COMMISSIONER } from '../config/features';

import UserProfileMenu from '../components/shared/UserProfileMenu';
import UserProfileModal from '../components/shared/UserProfileModal';
import FreightOperationsBackdrop from '../components/freight/FreightOperationsBackdrop';

function readAdminSceneNight() {
  try {
    const v = localStorage.getItem('freight_admin_scene');
    if (v === 'day') return false;
    if (v === 'night') return true;
  } catch (_) {}
  const h = new Date().getHours();
  return h < 7 || h >= 20;
}

function adminTabInactiveClass(night) {
  return night
    ? 'bg-white/[0.06] text-slate-100 border-white/15 hover:bg-white/12 hover:border-white/25 backdrop-blur-md'
    : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200';
}

/** Приводим id из SQLite/JSON к числу (иначе сравнение с === ломает поиск выбранной строки). */
function normalizeId(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeParkId(v) {
  const n = normalizeId(v);
  return n != null && n > 0 ? n : null;
}

/** Админ-панель: парки и менеджеры парков. Переключатель: Админ | Менеджер | Директор (вход от имени) | Водитель */
export default function AdminPanel() {
  const { user } = useAuth();
  const [view, setView] = useState('parks');
  const [selectedParkId, setSelectedParkId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showProfileModal, setShowProfileModal] = useState(false);
  // Переключатель ролей (вид от имени): только для admin
  const [viewRole, setViewRole] = useState('admin');
  const [viewParkId, setViewParkId] = useState(null);
  const [viewDriverUserId, setViewDriverUserId] = useState(null);
  const [driverList, setDriverList] = useState([]);
  const [driverListLoading, setDriverListLoading] = useState(false);
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const roleMenuAnchorRef = useRef(null);
  /** null — пока не измерили якорь (не рисуем меню, чтобы не было «прыжка» в 0,0) */
  const [roleMenuPos, setRoleMenuPos] = useState(null);

  useLayoutEffect(() => {
    if (!roleDropdownOpen) {
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
      // Невалидный rect на первом кадре → vw - rect.right огромный, меню уезжает влево
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
  }, [roleDropdownOpen]);
  const [driverSearch, setDriverSearch] = useState('');
  const [driverPage, setDriverPage] = useState(1);
  const [adminSection, setAdminSection] = useState('parks'); // 'parks' | 'epl' | 'evacuators' | 'commissioners' | 'drivers' | 'finance'
  const [directorList, setDirectorList] = useState([]);
  const [directorListLoading, setDirectorListLoading] = useState(false);
  const [directorSearch, setDirectorSearch] = useState('');
  const [directorPage, setDirectorPage] = useState(1);
  const [viewDirectorUserId, setViewDirectorUserId] = useState(null);
  const [managerList, setManagerList] = useState([]);
  const [managerListLoading, setManagerListLoading] = useState(false);
  const [managerSearch, setManagerSearch] = useState('');
  const [managerPage, setManagerPage] = useState(1);
  const [viewManagerUserId, setViewManagerUserId] = useState(null);
  const [impersonateLoading, setImpersonateLoading] = useState(false);
  const [directorListError, setDirectorListError] = useState(null);
  const [managerListError, setManagerListError] = useState(null);
  const [adminSceneNight, setAdminSceneNight] = useState(readAdminSceneNight);

  useEffect(() => {
    try {
      localStorage.setItem('freight_admin_scene', adminSceneNight ? 'night' : 'day');
    } catch (_) {}
  }, [adminSceneNight]);

  useEffect(() => {
    if (
      !FEATURE_EVACUATOR_AND_COMMISSIONER &&
      (adminSection === 'evacuators' || adminSection === 'commissioners')
    ) {
      setAdminSection('parks');
    }
  }, [adminSection]);

  useEffect(() => {
    if (viewRole !== 'director' || !viewParkId || directorListLoading) return;
    if (viewDirectorUserId == null) return;
    const uid = normalizeId(viewDirectorUserId);
    if (uid == null) {
      setViewDirectorUserId(null);
      return;
    }
    const ok = directorList.some((x) => normalizeId(x.userId) === uid);
    if (!ok) setViewDirectorUserId(null);
  }, [viewRole, viewParkId, viewDirectorUserId, directorListLoading, directorList]);

  useEffect(() => {
    if (viewRole !== 'manager' || !viewParkId || managerListLoading) return;
    if (viewManagerUserId == null) return;
    const uid = normalizeId(viewManagerUserId);
    if (uid == null) {
      setViewManagerUserId(null);
      return;
    }
    const ok = managerList.some((x) => normalizeId(x.userId) === uid);
    if (!ok) setViewManagerUserId(null);
  }, [viewRole, viewParkId, viewManagerUserId, managerListLoading, managerList]);

  const impersonateDirector = async (userId, parkId) => {
    const uid = normalizeId(userId);
    const pid = normalizeParkId(parkId);
    if (uid == null || pid == null) return;
    setImpersonateLoading(true);
    try {
      const { data } = await api.post(`/admin/impersonate/director/${uid}`, { parkId: pid });
      const backup = { token: localStorage.getItem('token'), user: localStorage.getItem('user'), returnTo: '/admin' };
      sessionStorage.setItem('adminImpersonationBackup', JSON.stringify(backup));
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      window.location.href = '/director';
    } catch (e) {
      alert(e.response?.data?.error || e.message || 'Ошибка входа');
    } finally {
      setImpersonateLoading(false);
    }
  };

  const impersonateManager = async (userId, parkId) => {
    const uid = normalizeId(userId);
    const pid = normalizeParkId(parkId);
    if (uid == null || pid == null) return;
    setImpersonateLoading(true);
    try {
      const { data } = await api.post(`/admin/impersonate/manager/${uid}`, { parkId: pid });
      const backup = { token: localStorage.getItem('token'), user: localStorage.getItem('user'), returnTo: '/admin' };
      sessionStorage.setItem('adminImpersonationBackup', JSON.stringify(backup));
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      window.location.href = '/manager';
    } catch (e) {
      alert(e.response?.data?.error || e.message || 'Ошибка входа');
    } finally {
      setImpersonateLoading(false);
    }
  };

  const handleSelectPark = (parkId) => {
    const pid = normalizeParkId(parkId);
    if (pid == null) return;

    setSelectedParkId(pid);
    if (viewRole === 'driver') {
      setViewParkId(pid);
      setViewDriverUserId(null);
      setDriverList([]);
      setDriverListLoading(true);
      api.get(`/admin/parks/${pid}/drivers`)
        .then((r) => {
          const rows = Array.isArray(r.data) ? r.data : [];
          setDriverList(
            rows.map((row) => ({
              ...row,
              userId: normalizeId(row.userId) ?? row.userId
            }))
          );
        })
        .catch(() => setDriverList([]))
        .finally(() => setDriverListLoading(false));
    } else if (viewRole === 'director') {
      setViewParkId(pid);
      setViewDirectorUserId(null);
      setDirectorSearch('');
      setDirectorPage(1);
      setDirectorList([]);
      setDirectorListError(null);
      setDirectorListLoading(true);
      api
        .get(`/admin/parks/${pid}/directors`)
        .then((r) => {
          const rows = Array.isArray(r.data) ? r.data : [];
          setDirectorList(
            rows.map((row) => ({
              ...row,
              id: normalizeId(row.id) ?? row.id,
              userId: normalizeId(row.userId) ?? row.userId,
              parkId: normalizeId(row.parkId) ?? row.parkId
            }))
          );
        })
        .catch((e) => {
          setDirectorList([]);
          setDirectorListError(
            e.response?.data?.error || e.message || 'Не удалось загрузить список директоров'
          );
        })
        .finally(() => setDirectorListLoading(false));
    } else if (viewRole === 'manager') {
      setViewParkId(pid);
      setViewManagerUserId(null);
      setManagerSearch('');
      setManagerPage(1);
      setManagerList([]);
      setManagerListError(null);
      setManagerListLoading(true);
      api
        .get(`/admin/parks/${pid}/managers`)
        .then((r) => {
          const rows = Array.isArray(r.data) ? r.data : [];
          setManagerList(
            rows.map((row) => ({
              ...row,
              id: normalizeId(row.id) ?? row.id,
              userId: normalizeId(row.userId) ?? row.userId,
              parkId: normalizeId(row.parkId) ?? row.parkId
            }))
          );
        })
        .catch((e) => {
          setManagerList([]);
          setManagerListError(
            e.response?.data?.error || e.message || 'Не удалось загрузить список менеджеров'
          );
        })
        .finally(() => setManagerListLoading(false));
    } else {
      setView('manager');
    }
  };

  const handleBackToParks = () => {
    setView('parks');
    setSelectedParkId(null);
    if (viewRole === 'manager') {
      setViewParkId(null);
      setViewManagerUserId(null);
      setManagerList([]);
      setManagerListError(null);
    }
    if (viewRole === 'director') {
      setViewParkId(null);
      setViewDirectorUserId(null);
      setDirectorList([]);
      setDirectorListError(null);
    }
    if (viewRole === 'driver') {
      setViewParkId(null);
      setViewDriverUserId(null);
      setDriverList([]);
    }
    setRefreshKey((k) => k + 1);
  };

  const handleDriverModeBack = () => {
    if (viewDriverUserId) {
      setViewDriverUserId(null);
    } else {
      setViewParkId(null);
      setDriverList([]);
    }
  };

  const handleDirectorModeBack = () => {
    if (viewDirectorUserId) {
      setViewDirectorUserId(null);
    } else {
      setViewParkId(null);
      setDirectorList([]);
    }
  };

  const handleManagerModeBack = () => {
    if (viewManagerUserId) {
      setViewManagerUserId(null);
    } else {
      setViewParkId(null);
      setManagerList([]);
    }
  };

  const handleRefresh = () => setRefreshKey((k) => k + 1);

  const setRole = (role) => {
    setRoleDropdownOpen(false);
    setViewRole(role);
    setViewDriverUserId(null);
    setDriverList([]);
    setViewDirectorUserId(null);
    setDirectorList([]);
    setDirectorListError(null);
    setViewManagerUserId(null);
    setManagerList([]);
    setManagerListError(null);
    if (role === 'admin') {
      setViewParkId(null);
      setView('parks');
      setSelectedParkId(null);
    } else if (role === 'manager' || role === 'director' || role === 'driver') {
      setViewParkId(null);
      setView('parks');
      setSelectedParkId(null);
    }
  };

  const handleImpersonateDriver = async () => {
    if (!viewDriverUserId) return;
    setImpersonateLoading(true);
    try {
      const { data } = await api.post(`/admin/impersonate/driver/${viewDriverUserId}`);
      const backup = { token: localStorage.getItem('token'), user: localStorage.getItem('user'), returnTo: '/admin' };
      sessionStorage.setItem('adminImpersonationBackup', JSON.stringify(backup));
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      window.location.href = '/driver';
    } catch (e) {
      alert(`Ошибка: ${e.response?.data?.error || e.message}`);
    } finally {
      setImpersonateLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen">
      <FreightOperationsBackdrop night={adminSceneNight} />
      <div className="relative z-10 min-h-screen">
      {/* Красивый хедер — мобильная вёрстка: одна строка, заголовок с truncate */}
      <div
        className={`relative z-30 border-b backdrop-blur-2xl shadow-[0_8px_40px_rgba(15,23,42,0.15)] ${
          adminSceneNight
            ? 'border-white/15 bg-white/[0.08]'
            : 'border-white/30 bg-white/65'
        }`}
      >
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-6">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between gap-2 sm:gap-4 flex-nowrap min-h-[48px]"
          >
            {/* Слева: назад + заголовок (сжимается) */}
            <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0 overflow-hidden">
              {(view !== 'parks' ||
                (viewRole === 'driver' && (viewParkId || viewDriverUserId)) ||
                (viewRole === 'director' && (viewParkId || viewDirectorUserId)) ||
                (viewRole === 'manager' && (viewParkId || viewManagerUserId))) && (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    if (viewRole === 'driver' && (viewParkId || viewDriverUserId)) handleDriverModeBack();
                    else if (viewRole === 'director' && (viewParkId || viewDirectorUserId)) handleDirectorModeBack();
                    else if (viewRole === 'manager' && (viewParkId || viewManagerUserId)) handleManagerModeBack();
                    else handleBackToParks();
                  }}
                  className={`flex items-center justify-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 rounded-xl font-semibold transition shadow-md shrink-0 ${
                    adminSceneNight
                      ? 'bg-white/10 backdrop-blur-sm border border-white/20 text-white hover:bg-white/20'
                      : 'bg-white/90 border border-slate-200 text-slate-800 hover:bg-white shadow-sm'
                  }`}
                >
                  <ArrowLeft className="w-5 h-5 shrink-0" />
                  <span className="hidden sm:inline">
                    {viewRole === 'driver' && viewDriverUserId
                      ? 'К списку'
                      : viewRole === 'director' && viewDirectorUserId
                        ? 'К списку'
                        : viewRole === 'manager' && viewManagerUserId
                          ? 'К списку'
                          : 'К паркам'}
                  </span>
                </motion.button>
              )}
              <div className="min-w-0 flex-1 overflow-hidden">
                <h1
                  className={`text-base sm:text-2xl font-bold truncate ${
                    adminSceneNight ? 'text-white' : 'text-slate-900'
                  }`}
                >
                  {viewRole === 'driver' && viewParkId
                    ? viewDriverUserId
                      ? 'Вход от имени водителя'
                      : 'Выберите водителя'
                    : viewRole === 'director' && viewParkId
                      ? viewDirectorUserId
                        ? 'Вход от имени директора'
                        : 'Выберите директора'
                      : viewRole === 'manager' && viewParkId
                        ? viewManagerUserId
                          ? 'Вход от имени менеджера'
                          : 'Выберите менеджера'
                        : viewRole === 'admin' && adminSection === 'finance'
                          ? 'Касса'
                          : viewRole === 'admin' && adminSection === 'epl'
                            ? 'ЭПЛ (глобально)'
                            : view === 'parks'
                              ? viewRole === 'admin'
                                ? 'Админ-панель'
                                : viewRole === 'manager'
                                  ? 'Режим менеджера'
                                  : viewRole === 'director'
                                    ? 'Режим директора'
                                    : viewRole === 'driver'
                                      ? 'Режим водителя'
                                      : 'Админ-панель'
                              : 'Управление парком'}
                </h1>
              </div>
            </div>
            {/* Справа: переключатель ролей + профиль (не сжимаются) */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {user?.role === 'admin' && (
                <div className="relative shrink-0">
                  <span ref={roleMenuAnchorRef} className="inline-flex">
                    <button
                      type="button"
                      onClick={() => setRoleDropdownOpen((v) => !v)}
                      className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-2 rounded-xl font-semibold transition shrink-0 ${
                        adminSceneNight
                          ? 'bg-white/10 backdrop-blur-sm border border-white/20 text-white hover:bg-white/20'
                          : 'bg-white/90 border border-slate-200 text-slate-800 hover:bg-white shadow-sm'
                      }`}
                    >
                      {viewRole === 'admin' && <Shield className="w-4 h-4 shrink-0" />}
                      {viewRole === 'manager' && <Users className="w-4 h-4 shrink-0" />}
                      {viewRole === 'director' && <Landmark className="w-4 h-4 shrink-0" />}
                      {viewRole === 'driver' && <User className="w-4 h-4 shrink-0" />}
                      <span className="hidden sm:inline whitespace-nowrap">
                        {viewRole === 'admin'
                          ? 'Админ'
                          : viewRole === 'manager'
                            ? 'Менеджер'
                            : viewRole === 'director'
                              ? 'Директор'
                              : 'Водитель'}
                      </span>
                      <ChevronDown className="w-4 h-4 shrink-0" />
                    </button>
                  </span>
                  {roleDropdownOpen &&
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
                          className="fixed z-[210] py-1 bg-white rounded-xl shadow-lg border border-slate-200 min-w-[160px] max-w-[min(16rem,calc(100vw-1rem))] whitespace-nowrap"
                          style={{ top: roleMenuPos.top, right: roleMenuPos.right }}
                          role="menu"
                        >
                          <button
                            type="button"
                            onClick={() => setRole('admin')}
                            className={`w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm ${viewRole === 'admin' ? 'bg-teal-50 text-teal-800 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}
                          >
                            <Shield className="w-4 h-4 shrink-0" /> Админ
                          </button>
                          <button
                            type="button"
                            onClick={() => setRole('manager')}
                            className={`w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm ${viewRole === 'manager' ? 'bg-teal-50 text-teal-800 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}
                          >
                            <Users className="w-4 h-4 shrink-0" /> Менеджер
                          </button>
                          <button
                            type="button"
                            onClick={() => setRole('director')}
                            className={`w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm ${viewRole === 'director' ? 'bg-teal-50 text-teal-800 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}
                          >
                            <Landmark className="w-4 h-4 shrink-0" /> Директор
                          </button>
                          <button
                            type="button"
                            onClick={() => setRole('driver')}
                            className={`w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm ${viewRole === 'driver' ? 'bg-teal-50 text-teal-800 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}
                          >
                            <User className="w-4 h-4 shrink-0" /> Водитель
                          </button>
                        </div>
                      </>,
                      document.body
                    )}
                </div>
              )}
              <button
                type="button"
                onClick={() => setAdminSceneNight((n) => !n)}
                className={`flex shrink-0 items-center justify-center rounded-xl border p-2.5 shadow-sm backdrop-blur-md transition ${
                  adminSceneNight
                    ? 'border-white/20 bg-white/[0.08] text-amber-200 hover:bg-white/[0.14]'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
                title={adminSceneNight ? 'Светлая сцена' : 'Ночная сцена'}
              >
                {adminSceneNight ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </button>
              {user && (
                <div className="shrink-0">
                  <UserProfileMenu user={user} onProfileClick={() => setShowProfileModal(true)} />
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </div>

      <main className="relative z-10 max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-8">
        {/* Табы разделов для роли Админ: Парки / ЭПЛ */}
        {viewRole === 'admin' && !viewParkId && (
          <div className="relative z-20 mb-4 w-full min-w-0 -mx-1 sm:mx-0">
            <div className="overflow-x-auto overflow-y-hidden pb-1 scrollbar-thin [scrollbar-color:rgba(100,116,139,0.45)_transparent]">
              <div
                className={`inline-flex min-w-max flex-nowrap gap-2 rounded-2xl border px-3 py-2 shadow-md backdrop-blur-xl ${
                  adminSceneNight
                    ? 'border-white/15 bg-white/[0.06] shadow-black/20 ring-1 ring-white/10'
                    : 'border-white/40 bg-white/90 shadow-slate-900/15'
                }`}
              >
            <button
              type="button"
              onClick={() => { setAdminSection('parks'); setView('parks'); }}
              className={`inline-flex shrink-0 items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border transition ${
                adminSection === 'parks'
                  ? 'bg-teal-600 text-white border-teal-300 shadow-lg shadow-teal-900/40'
                  : adminTabInactiveClass(adminSceneNight)
              }`}
            >
              <Building2 className="w-4 h-4" />
              Парки
            </button>
            <button
              type="button"
              onClick={() => { setAdminSection('epl'); setView('parks'); }}
              className={`inline-flex shrink-0 items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border transition ${
                adminSection === 'epl'
                  ? 'bg-sky-500 text-white border-sky-300 shadow-lg shadow-sky-900/40'
                  : adminTabInactiveClass(adminSceneNight)
              }`}
            >
              <FileText className="w-4 h-4" />
              ЭПЛ
            </button>
            {FEATURE_EVACUATOR_AND_COMMISSIONER && (
              <>
                <button
                  type="button"
                  onClick={() => { setAdminSection('evacuators'); setView('parks'); }}
                  className={`inline-flex shrink-0 items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border transition ${
                    adminSection === 'evacuators'
                      ? 'bg-orange-500 text-white border-orange-300 shadow-lg shadow-orange-900/40'
                      : adminTabInactiveClass(adminSceneNight)
                  }`}
                >
                  <Truck className="w-4 h-4" />
                  Эвакуаторы
                </button>
                <button
                  type="button"
                  onClick={() => { setAdminSection('commissioners'); setView('parks'); }}
                  className={`inline-flex shrink-0 items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border transition ${
                    adminSection === 'commissioners'
                      ? 'bg-orange-500 text-white border-orange-300 shadow-lg shadow-orange-900/40'
                      : adminTabInactiveClass(adminSceneNight)
                  }`}
                >
                  <ShieldAlert className="w-4 h-4" />
                  Комиссары
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => { setAdminSection('drivers'); setView('parks'); }}
              className={`inline-flex shrink-0 items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border transition ${
                adminSection === 'drivers'
                  ? 'bg-sky-600 text-white border-sky-300 shadow-lg shadow-sky-900/40'
                  : adminTabInactiveClass(adminSceneNight)
              }`}
            >
              <Send className="w-4 h-4" />
              Рассылки
            </button>
            <button
              type="button"
              onClick={() => { setAdminSection('finance'); setView('parks'); }}
              className={`inline-flex shrink-0 items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border transition ${
                adminSection === 'finance'
                  ? 'bg-teal-600 text-white border-teal-300 shadow-lg shadow-teal-900/40'
                  : adminTabInactiveClass(adminSceneNight)
              }`}
            >
              <Wallet className="w-4 h-4" />
              Касса
            </button>
              </div>
            </div>
          </div>
        )}

        {viewRole === 'director' && viewParkId ? (
          <div className="space-y-4">
            {!viewDirectorUserId ? (
              <div className="bg-white rounded-2xl shadow-lg border border-slate-200/90 p-6 sm:p-8 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900 tracking-tight">Директора парка</h2>
                    <p className="text-sm text-slate-500 mt-1">Выберите учётную запись, затем подтвердите вход</p>
                  </div>
                  <div className="w-full sm:max-w-xs">
                    <label className="sr-only">Поиск</label>
                    <input
                      type="search"
                      value={directorSearch}
                      onChange={(e) => {
                        setDirectorSearch(e.target.value);
                        setDirectorPage(1);
                      }}
                      placeholder="ФИО, телефон или логин..."
                      className="w-full px-4 py-2.5 border-2 border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50/50"
                    />
                  </div>
                </div>
                {directorListError && (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
                    <span className="min-w-0">{directorListError}</span>
                    <button
                      type="button"
                      onClick={() => viewParkId != null && handleSelectPark(viewParkId)}
                      className="shrink-0 px-4 py-2 rounded-lg bg-red-100 hover:bg-red-200 font-semibold text-red-900"
                    >
                      Повторить
                    </button>
                  </div>
                )}
                {directorListLoading ? (
                  <div className="flex items-center justify-center py-16 text-slate-500 gap-3">
                    <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                    <span className="font-medium">Загрузка...</span>
                  </div>
                ) : directorList.length === 0 && !directorListError ? (
                  <p className="text-center py-12 text-slate-500">В этом парке нет привязанных директоров</p>
                ) : directorList.length === 0 && directorListError ? null : (
                  (() => {
                    const q = directorSearch.trim().toLowerCase();
                    const filtered = !q
                      ? directorList
                      : directorList.filter((d) => {
                          const name = (d.fullName || '').toLowerCase();
                          const phone = (d.phone || '').toLowerCase();
                          const login = (d.username || '').toLowerCase();
                          return name.includes(q) || phone.includes(q) || login.includes(q);
                        });
                    const pageSize = 16;
                    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
                    const currentPage = Math.min(directorPage, totalPages);
                    const start = (currentPage - 1) * pageSize;
                    const paged = filtered.slice(start, start + pageSize);
                    return (
                      <>
                        {filtered.length === 0 ? (
                          <p className="text-center py-10 text-slate-500">Ничего не найдено</p>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {paged.map((d) => (
                              <button
                                key={`${d.userId}-${d.id}`}
                                type="button"
                                onClick={() => {
                                  const uid = normalizeId(d.userId);
                                  if (uid != null) setViewDirectorUserId(uid);
                                }}
                                className="text-left rounded-2xl border-2 border-slate-100 hover:border-indigo-300 hover:bg-indigo-50/40 px-4 py-3.5 transition shadow-sm"
                              >
                                <span className="text-sm font-bold text-slate-900 truncate block">
                                  {d.fullName || d.username || `Директор #${d.userId}`}
                                </span>
                                {d.phone && <span className="text-xs text-slate-600 mt-1 block">{d.phone}</span>}
                                {d.username && (
                                  <span className="text-[11px] text-slate-400 mt-0.5 block font-mono">{d.username}</span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                        {totalPages > 1 && (
                          <div className="flex items-center justify-center gap-4 pt-2">
                            <button
                              type="button"
                              onClick={() => setDirectorPage((p) => Math.max(1, p - 1))}
                              disabled={currentPage === 1}
                              className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 disabled:opacity-40 hover:bg-slate-50"
                            >
                              Назад
                            </button>
                            <span className="text-sm text-slate-500 tabular-nums">
                              {currentPage} / {totalPages}
                            </span>
                            <button
                              type="button"
                              onClick={() => setDirectorPage((p) => Math.min(totalPages, p + 1))}
                              disabled={currentPage === totalPages}
                              className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 disabled:opacity-40 hover:bg-slate-50"
                            >
                              Далее
                            </button>
                          </div>
                        )}
                      </>
                    );
                  })()
                )}
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6 sm:p-8">
                <p className="text-slate-600 mb-2">
                  Кабинет директора для выбранного парка. Сессия около 1 часа.
                </p>
                <p className="text-sm font-semibold text-slate-800 mb-6">
                  {(() => {
                    const uid = normalizeId(viewDirectorUserId);
                    const row = directorList.find((x) => normalizeId(x.userId) === uid);
                    return row?.fullName || row?.username || (uid != null ? `Учётная запись #${uid}` : '—');
                  })()}
                </p>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => impersonateDirector(viewDirectorUserId, viewParkId)}
                  disabled={impersonateLoading}
                  className="w-full sm:w-auto px-8 py-3.5 bg-gradient-to-r from-indigo-600 to-violet-700 text-white rounded-xl hover:from-indigo-700 hover:to-violet-800 font-semibold shadow-lg disabled:opacity-50"
                >
                  {impersonateLoading ? 'Вход...' : 'Открыть кабинет директора'}
                </motion.button>
              </div>
            )}
          </div>
        ) : viewRole === 'manager' && viewParkId ? (
          <div className="space-y-4">
            {!viewManagerUserId ? (
              <div className="bg-white rounded-2xl shadow-lg border border-slate-200/90 p-6 sm:p-8 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900 tracking-tight">Менеджеры парка</h2>
                    <p className="text-sm text-slate-500 mt-1">Выберите учётную запись, затем подтвердите вход</p>
                  </div>
                  <div className="w-full sm:max-w-xs">
                    <input
                      type="search"
                      value={managerSearch}
                      onChange={(e) => {
                        setManagerSearch(e.target.value);
                        setManagerPage(1);
                      }}
                      placeholder="ФИО, телефон или логин..."
                      className="w-full px-4 py-2.5 border-2 border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 bg-slate-50/50"
                    />
                  </div>
                </div>
                {managerListError && (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
                    <span className="min-w-0">{managerListError}</span>
                    <button
                      type="button"
                      onClick={() => viewParkId != null && handleSelectPark(viewParkId)}
                      className="shrink-0 px-4 py-2 rounded-lg bg-red-100 hover:bg-red-200 font-semibold text-red-900"
                    >
                      Повторить
                    </button>
                  </div>
                )}
                {managerListLoading ? (
                  <div className="flex items-center justify-center py-16 text-slate-500 gap-3">
                    <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
                    <span className="font-medium">Загрузка...</span>
                  </div>
                ) : managerList.length === 0 ? (
                  <p className="text-center py-12 text-slate-500">В этом парке нет менеджеров</p>
                ) : (
                  (() => {
                    const q = managerSearch.trim().toLowerCase();
                    const filtered = !q
                      ? managerList
                      : managerList.filter((m) => {
                          const name = (m.fullName || '').toLowerCase();
                          const phone = (m.phone || '').toLowerCase();
                          const login = (m.username || '').toLowerCase();
                          return name.includes(q) || phone.includes(q) || login.includes(q);
                        });
                    const pageSize = 16;
                    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
                    const currentPage = Math.min(managerPage, totalPages);
                    const start = (currentPage - 1) * pageSize;
                    const paged = filtered.slice(start, start + pageSize);
                    return (
                      <>
                        {filtered.length === 0 ? (
                          <p className="text-center py-10 text-slate-500">Ничего не найдено</p>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {paged.map((m) => (
                              <button
                                key={`${m.userId}-${m.id}`}
                                type="button"
                                onClick={() => {
                                  const uid = normalizeId(m.userId);
                                  if (uid != null) setViewManagerUserId(uid);
                                }}
                                className="text-left rounded-2xl border-2 border-slate-100 hover:border-teal-300 hover:bg-teal-50/50 px-4 py-3.5 transition shadow-sm"
                              >
                                <span className="text-sm font-bold text-slate-900 truncate block">
                                  {m.fullName || m.username || `Менеджер #${m.userId}`}
                                </span>
                                {m.phone && <span className="text-xs text-slate-600 mt-1 block">{m.phone}</span>}
                                {m.username && (
                                  <span className="text-[11px] text-slate-400 mt-0.5 block font-mono">{m.username}</span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                        {totalPages > 1 && (
                          <div className="flex items-center justify-center gap-4 pt-2">
                            <button
                              type="button"
                              onClick={() => setManagerPage((p) => Math.max(1, p - 1))}
                              disabled={currentPage === 1}
                              className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 disabled:opacity-40 hover:bg-slate-50"
                            >
                              Назад
                            </button>
                            <span className="text-sm text-slate-500 tabular-nums">
                              {currentPage} / {totalPages}
                            </span>
                            <button
                              type="button"
                              onClick={() => setManagerPage((p) => Math.min(totalPages, p + 1))}
                              disabled={currentPage === totalPages}
                              className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 disabled:opacity-40 hover:bg-slate-50"
                            >
                              Далее
                            </button>
                          </div>
                        )}
                      </>
                    );
                  })()
                )}
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6 sm:p-8">
                <p className="text-slate-600 mb-2">
                  Кабинет менеджера для выбранного парка. Сессия около 1 часа.
                </p>
                <p className="text-sm font-semibold text-slate-800 mb-6">
                  {(() => {
                    const uid = normalizeId(viewManagerUserId);
                    const row = managerList.find((x) => normalizeId(x.userId) === uid);
                    return row?.fullName || row?.username || (uid != null ? `Учётная запись #${uid}` : '—');
                  })()}
                </p>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => impersonateManager(viewManagerUserId, viewParkId)}
                  disabled={impersonateLoading}
                  className="w-full sm:w-auto px-8 py-3.5 bg-gradient-to-r from-teal-600 to-emerald-700 text-white rounded-xl hover:from-teal-700 hover:to-emerald-800 font-semibold shadow-lg disabled:opacity-50"
                >
                  {impersonateLoading ? 'Вход...' : 'Открыть кабинет менеджера'}
                </motion.button>
              </div>
            )}
          </div>
        ) : viewRole === 'driver' && viewParkId ? (
          <div className="space-y-4">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleDriverModeBack}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-semibold shadow-sm"
            >
              <ArrowLeft className="w-5 h-5" />
              {viewDriverUserId ? 'К списку водителей' : 'К выбору парка'}
            </motion.button>
            {!viewDriverUserId ? (
              <div className="bg-white rounded-xl shadow-md border border-slate-200 p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <h2 className="text-lg font-bold text-slate-800">Выберите водителя</h2>
                  <div className="flex-1 max-w-xs">
                    <input
                      type="text"
                      value={driverSearch}
                      onChange={(e) => {
                        setDriverSearch(e.target.value);
                        setDriverPage(1);
                      }}
                      placeholder="Поиск по ФИО или телефону..."
                      className="w-full px-3 py-2 border-2 border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                    />
                  </div>
                </div>
                {driverListLoading ? (
                  <p className="text-slate-500">Загрузка...</p>
                ) : driverList.length === 0 ? (
                  <p className="text-slate-500">В парке нет водителей</p>
                ) : (
                  (() => {
                    const query = driverSearch.trim().toLowerCase();
                    const filtered = !query
                      ? driverList
                      : driverList.filter((d) => {
                          const name = (d.fullName || '').toLowerCase();
                          const phone = (d.phone || '').toLowerCase();
                          return name.includes(query) || phone.includes(query);
                        });
                    const pageSize = 16;
                    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
                    const currentPage = Math.min(driverPage, totalPages);
                    const start = (currentPage - 1) * pageSize;
                    const paged = filtered.slice(start, start + pageSize);

                    return (
                      <>
                        {filtered.length === 0 ? (
                          <p className="text-slate-500">Ничего не найдено</p>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {paged.map((d) => (
                              <button
                                key={d.userId || d.id}
                                type="button"
                                onClick={() => setViewDriverUserId(d.userId)}
                                className="text-left rounded-2xl border border-slate-200 hover:border-teal-300 hover:shadow-md bg-slate-50/60 px-4 py-3 transition flex flex-col gap-1.5"
                              >
                                <span className="text-sm font-bold text-slate-900 truncate">
                                  {d.fullName || d.phone || `Водитель #${d.userId}`}
                                </span>
                                {d.phone && (
                                  <span className="text-xs text-slate-600">{d.phone}</span>
                                )}
                                {d.regNumber && (
                                  <span className="text-xs text-slate-500">
                                    Авто: {d.regNumber}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                        {totalPages > 1 && (
                          <div className="flex items-center justify-center gap-3 pt-3">
                            <button
                              type="button"
                              onClick={() => setDriverPage((p) => Math.max(1, p - 1))}
                              disabled={currentPage === 1}
                              className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-700 disabled:opacity-40 hover:bg-slate-50"
                            >
                              ←
                            </button>
                            <span className="text-xs text-slate-500">
                              Страница {currentPage} из {totalPages}
                            </span>
                            <button
                              type="button"
                              onClick={() => setDriverPage((p) => Math.min(totalPages, p + 1))}
                              disabled={currentPage === totalPages}
                              className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-700 disabled:opacity-40 hover:bg-slate-50"
                            >
                              →
                            </button>
                          </div>
                        )}
                      </>
                    );
                  })()
                )}
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-md border border-slate-200 p-6">
                <p className="text-slate-600 mb-4">
                  Открыть кабинет водителя в новой сессии (токен на 1 час).
                </p>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleImpersonateDriver}
                  disabled={impersonateLoading}
                  className="px-6 py-3 bg-gradient-to-r from-teal-600 to-teal-800 text-white rounded-xl hover:from-teal-700 hover:to-teal-900 font-semibold shadow-md disabled:opacity-50"
                >
                  {impersonateLoading ? 'Открытие...' : 'Открыть кабинет водителя'}
                </motion.button>
              </div>
            )}
          </div>
        ) : viewRole === 'director' || viewRole === 'manager' || viewRole === 'driver' ? (
          <AdminParksList key={refreshKey} night={adminSceneNight} onSelectPark={handleSelectPark} />
        ) : viewRole === 'admin' && adminSection === 'finance' ? (
          <AdminFinance sceneNight={adminSceneNight} />
        ) : viewRole === 'admin' && FEATURE_EVACUATOR_AND_COMMISSIONER && adminSection === 'evacuators' ? (
          <AdminEvacuators />
        ) : viewRole === 'admin' && FEATURE_EVACUATOR_AND_COMMISSIONER && adminSection === 'commissioners' ? (
          <AdminCommissioners />
        ) : viewRole === 'admin' && adminSection === 'drivers' ? (
          <AdminDriversMonitoring sceneNight={adminSceneNight} />
        ) : viewRole === 'admin' && adminSection === 'epl' ? (
          <AdminEplList sceneNight={adminSceneNight} />
        ) : view === 'parks' ? (
          <AdminParksList key={refreshKey} night={adminSceneNight} onSelectPark={handleSelectPark} />
        ) : (
          <AdminParkManager
            parkId={selectedParkId}
            onBack={handleBackToParks}
            onRefresh={handleRefresh}
          />
        )}
      </main>

      {/* Модалка профиля */}
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
