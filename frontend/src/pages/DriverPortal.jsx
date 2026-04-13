import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../api';
import StatusOverview from '../components/driver/StatusOverview';
import BalanceMenu from '../components/driver/BalanceMenu';
import ProfileMenu from '../components/driver/ProfileMenu';
import DriverProfileModal from '../components/driver/DriverProfileModal';
import { FileText, Bell, Gamepad2, Clock, FileCheck, AlertCircle, Truck, ShieldAlert, MessageCircle, Sun, Moon } from 'lucide-react';
import FreightCinematicBackdrop from '../components/FreightCinematicBackdrop';
import FreightEplHint from '../components/driver/FreightEplHint';
import DriverCreateEplFreightFields from '../components/driver/DriverCreateEplFreightFields';
import { parseUtc, formatDateMsk, formatNotificationTime } from '../utils/dateFormatter';
import { FEATURE_EVACUATOR_AND_COMMISSIONER } from '../config/features';

function readDriverSceneNight() {
  try {
    const v = localStorage.getItem('freight_driver_scene');
    if (v === 'day') return false;
    if (v === 'night') return true;
  } catch (_) {}
  const h = new Date().getHours();
  return h < 7 || h >= 20;
}

export default function DriverPortal() {
  const navigate = useNavigate();
  const [driver, setDriver] = useState(null);
  /** В парке включён ввод адресов водителем при создании ЭПЛ */
  const freightDriverEntry = driver?.freightAddressEntryMode === 'driver';
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showCreateEplModal, setShowCreateEplModal] = useState(false);
  const [createEplOdometer, setCreateEplOdometer] = useState('');
  const [creatingEpl, setCreatingEpl] = useState(false);
  const [createEplStep, setCreateEplStep] = useState('form');
  const [createEplError, setCreateEplError] = useState('');
  const [createEplCommercial, setCreateEplCommercial] = useState('ПГ');
  const [commercialOpts, setCommercialOpts] = useState([]);
  const [freightStores, setFreightStores] = useState([]);
  const [freightStoresLoading, setFreightStoresLoading] = useState(false);
  const [createFreightOrigin, setCreateFreightOrigin] = useState('');
  const [createFreightLoad, setCreateFreightLoad] = useState('');
  const [createFreightStoreIds, setCreateFreightStoreIds] = useState([]);
  const [createFreightExtraUnload, setCreateFreightExtraUnload] = useState('');
  const [eplList, setEplList] = useState([]);
  const [loadingEplList, setLoadingEplList] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [activeShift, setActiveShift] = useState(null);
  const [pendingEpl, setPendingEpl] = useState(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [activeTab, setActiveTab] = useState('menu');
  const [showProfileModal, setShowProfileModal] = useState(false);
  const notificationsMenuRef = useRef(null);
  const [isImpersonation, setIsImpersonation] = useState(false);
  const [gameEnabled, setGameEnabled] = useState(false);
  const [photoControlEnabled, setPhotoControlEnabled] = useState(false);
  const [photoControlStatus, setPhotoControlStatus] = useState(null);
  const [evacuatorEnabled, setEvacuatorEnabled] = useState(false);
  const [evacuatorOnlineCount, setEvacuatorOnlineCount] = useState(0);
  const [evacuatorRequestPrice, setEvacuatorRequestPrice] = useState(0);
  const [commissionerEnabled, setCommissionerEnabled] = useState(false);
  const [commissionerOnlineCount, setCommissionerOnlineCount] = useState(0);
  const [commissionerRequestPrice, setCommissionerRequestPrice] = useState(0);
  const [sceneNight, setSceneNight] = useState(readDriverSceneNight);

  useEffect(() => {
    try {
      localStorage.setItem('freight_driver_scene', sceneNight ? 'night' : 'day');
    } catch (_) {}
  }, [sceneNight]);

  useEffect(() => {
    try {
      setIsImpersonation(!!sessionStorage.getItem('adminImpersonationBackup'));
    } catch (_) {}
  }, []);

  useEffect(() => {
    api.get('/driver/game/settings')
      .then((r) => setGameEnabled(!!r.data?.gameEnabled))
      .catch(() => setGameEnabled(false));
  }, []);

  useEffect(() => {
    api.get('/driver/photo-control/settings')
      .then((r) => setPhotoControlEnabled(!!r.data?.enabled))
      .catch(() => setPhotoControlEnabled(false));
  }, []);

  useEffect(() => {
    if (!FEATURE_EVACUATOR_AND_COMMISSIONER) return;
    api.get('/driver/evacuator/settings')
      .then((r) => {
        setEvacuatorEnabled(!!r.data?.enabled);
        setEvacuatorOnlineCount(r.data?.evacuatorsOnlineCount ?? 0);
        setEvacuatorRequestPrice(r.data?.requestCreationPrice ?? 0);
      })
      .catch(() => {
        setEvacuatorEnabled(false);
        setEvacuatorOnlineCount(0);
      });
  }, []);

  useEffect(() => {
    if (!FEATURE_EVACUATOR_AND_COMMISSIONER) return;
    api.get('/driver/commissioner/settings')
      .then((r) => {
        setCommissionerEnabled(!!r.data?.enabled);
        setCommissionerOnlineCount(r.data?.commissionersOnlineCount ?? 0);
        setCommissionerRequestPrice(r.data?.requestCreationPrice ?? 0);
      })
      .catch(() => {
        setCommissionerEnabled(false);
        setCommissionerOnlineCount(0);
      });
  }, []);

  useEffect(() => {
    if (!photoControlEnabled) {
      setPhotoControlStatus(null);
      return;
    }
    api.get('/driver/photo-control/list')
      .then((r) => {
        const list = Array.isArray(r.data) ? r.data : [];
        const activeApproved = list.find((a) => a.status === 'approved' && a.validUntil && new Date(a.validUntil) > new Date());
        const fillingOrDraft = list.find((a) => a.status === 'filling' || a.status === 'draft');
        const pendingCorrection = list.find((a) => a.status === 'pending' && a.correctionRequestedAt);
        const pending = list.find((a) => a.status === 'pending');
        if (activeApproved) {
          setPhotoControlStatus({
            value: 'ФК действует',
            status: 'active',
            time: `до ${new Date(activeApproved.validUntil).toLocaleDateString('ru-RU')}`
          });
        } else if (pendingCorrection) {
          setPhotoControlStatus({ value: 'На доработке', status: 'creating' });
        } else if (pending || fillingOrDraft) {
          setPhotoControlStatus({ value: pending ? 'На проверке' : 'Заявка заполняется', status: 'creating' });
        } else {
          setPhotoControlStatus({ value: 'Нет активного ФК', status: 'inactive' });
        }
      })
      .catch(() => setPhotoControlStatus({ value: 'Нет активного ФК', status: 'inactive' }));
  }, [photoControlEnabled]);

  const exitImpersonation = () => {
    try {
      const raw = sessionStorage.getItem('adminImpersonationBackup');
      if (!raw) return;
      const { token, user, returnTo } = JSON.parse(raw);
      sessionStorage.removeItem('adminImpersonationBackup');
      if (token) localStorage.setItem('token', token);
      if (user) localStorage.setItem('user', user);
      window.location.href = returnTo || '/admin';
    } catch (_) {
      sessionStorage.removeItem('adminImpersonationBackup');
      window.location.href = '/admin';
    }
  };

  // Закрытие меню уведомлений при клике вне его
  useEffect(() => {
    function handleClickOutside(event) {
      if (notificationsMenuRef.current && !notificationsMenuRef.current.contains(event.target)) {
        setShowNotifications(false);
      }
    }
    if (showNotifications) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showNotifications]);

  useEffect(() => {
    loadDriverData();
    loadEplList();
    loadNotifications();
  }, []);

  // После возврата с ЮKassa пробуем один раз проверить статус последнего платежа
  useEffect(() => {
    let paymentId = null;
    try {
      paymentId = localStorage.getItem('lastYookassaPaymentId');
    } catch (_) {
      paymentId = null;
    }
    if (!paymentId) return;

    async function checkPayment() {
      try {
        await api.get(`/driver/payment/${paymentId}/status`);
        await loadDriverData(true);
      } catch (err) {
        console.error('Yookassa payment status check error:', err);
      } finally {
        try {
          localStorage.removeItem('lastYookassaPaymentId');
        } catch (_) {}
      }
    }

    checkPayment();
  }, []);

  const loadDriverData = async (skipFullScreenLoader = false) => {
    try {
      if (!skipFullScreenLoader) setLoading(true);
      const [profileRes, balanceRes] = await Promise.all([
        api.get('/driver/profile'),
        api.get('/driver/balance')
      ]);
      setDriver(profileRes.data);
      setBalance(balanceRes.data?.balance ?? 0);
    } catch (err) {
      console.error('Driver data loading error:', err);
      if (err.response?.status === 401) {
        navigate('/login');
        return;
      }
      setDriver(null);
    } finally {
      if (!skipFullScreenLoader) setLoading(false);
    }
  };

  const loadEplList = async () => {
    try {
      setLoadingEplList(true);
      const res = await api.get('/driver/epl/list');
      const epls = res.data || [];
      // Берём только последние 3
      setEplList(epls.slice(0, 3));
      
      // Активная смена: когда водитель уже получил PDF или QR; 12 ч с момента старта. pending_clinic с документом/QR = смена открыта
      const now = Date.now();
      const active = epls.find(epl => {
        const hasOpened = epl.documentPdfReceivedAt || epl.approvedAt || epl.documentQr || epl.documentPdfAvailable || epl.qrCode;
        if (!hasOpened) return false;
        const shiftStart = epl.documentPdfReceivedAt || epl.approvedAt || epl.mintransCreatedAt || epl.createdAt;
        const start = parseUtc(shiftStart)?.getTime();
        if (start == null || Number.isNaN(start)) return false;
        const hoursAgo = (now - start) / (1000 * 60 * 60);
        const shiftClosed = epl.shiftStatus === 'closed' || epl.shiftStatus === 'auto_closed';
        // Источник правды по смене — shifts.status. Но если shifts ещё не успел создаться, держим fallback по документу+времени.
        const shiftActive = epl.shiftStatus === 'active';
        return (shiftActive || epl.shiftStatus == null) && hoursAgo < 12 && !shiftClosed;
      });
      setActiveShift(active || null);
      // «Создаётся»: заявка без PDF/QR ещё (pending_clinic или pending без approvedAt).
      // ВАЖНО: не ограничиваем “30 минутами”, иначе при задержках клиники/Такском водитель увидит “Нет активной смены”
      // и будет думать, что система сломалась. Скрываем только если уже есть активная смена по этой же заявке.
      const creating = epls.find(e => {
        if (e.id === active?.id) return false;
        const hasAnyDoc = e.documentPdfReceivedAt || e.approvedAt || e.documentQr || e.documentPdfAvailable || e.qrCode;
        if (hasAnyDoc) return false;
        const isCreating = e.status === 'pending_clinic' || (e.status === 'pending' && !e.approvedAt && !e.qrCode);
        if (!isCreating) return false;
        // Не показываем “создаётся”, если смена уже явно закрыта/авто-закрыта
        const shiftClosed = e.shiftStatus === 'closed' || e.shiftStatus === 'auto_closed';
        if (shiftClosed) return false;
        return true;
      });
      setPendingEpl(creating || null);
    } catch (err) {
      console.error('EPL list loading error:', err);
      setEplList([]);
    } finally {
      setLoadingEplList(false);
    }
  };

  const loadNotifications = async () => {
    try {
      setLoadingNotifications(true);
      const res = await api.get('/driver/notifications');
      setNotifications(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('Notifications loading error:', err);
      setNotifications([]);
    } finally {
      setLoadingNotifications(false);
    }
  };

  const markNotificationRead = async (id, closeMenu = false, removeFromList = true) => {
    try {
      await api.patch(`/driver/notifications/${id}/read`);
      if (removeFromList) {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
      } else {
        setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
      }
      if (closeMenu) setShowNotifications(false);
    } catch (err) {
      console.error('Mark read error:', err);
      await loadNotifications();
    }
  };

  const [clearingAllNotifications, setClearingAllNotifications] = useState(false);
  const markAllNotificationsRead = async () => {
    try {
      setClearingAllNotifications(true);
      await api.patch('/driver/notifications/read-all');
      setNotifications([]);
      setShowNotifications(false);
    } catch (err) {
      console.error('Mark all read error:', err);
      await loadNotifications();
    } finally {
      setClearingAllNotifications(false);
    }
  };

  const handleNotificationClick = (n) => {
    if ((n.type === 'epl_ready' || n.type === 'shift_opened') && (n.eplId != null || activeShift?.id)) {
      markNotificationRead(n.id, true, true);
      navigate(`/driver/epl/${n.eplId ?? activeShift.id}`);
    } else if (n.type === 'photo_control_correction' || n.type === 'photo_control_expiry') {
      markNotificationRead(n.id, false, true);
      navigate('/driver/photo-control');
    } else if (
      FEATURE_EVACUATOR_AND_COMMISSIONER &&
      (n.type === 'evacuator_response' || n.type === 'evacuator_completed')
    ) {
      markNotificationRead(n.id, true, true);
      navigate('/driver/evacuator');
    } else {
      markNotificationRead(n.id, false, true);
    }
  };

  const openCreateEplModal = () => {
    // Проверяем верификацию водителя
    if (!driver?.isVerified) {
      alert('Водитель не верифицирован. Обратитесь к менеджеру для верификации.');
      return;
    }
    // Проверяем привязку к авто
    if (!driver?.carId) {
      alert('Сначала менеджер должен привязать вас к автомобилю.');
      return;
    }
    const eplPrice = driver?.eplPrice ?? 25;
    if (balance < eplPrice) {
      alert(`Недостаточно средств. Создание путевого листа — ${eplPrice} ₽. Пополните баланс.`);
      return;
    }
    setCreateEplOdometer('');
    setCreateEplCommercial('ПГ');
    setCreateFreightOrigin(String(driver?.parkFreightDefaultOriginAddress || '').trim());
    setCreateFreightLoad(String(driver?.parkFreightDefaultLoadAddress || '').trim());
    setCreateFreightStoreIds([]);
    setCreateFreightExtraUnload('');
    setShowCreateEplModal(true);
  };

  const toggleFreightStoreId = (id) => {
    setCreateFreightStoreIds((prev) => {
      const n = Number(id);
      if (Number.isNaN(n)) return prev;
      return prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n];
    });
  };

  useEffect(() => {
    if (!showCreateEplModal) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/driver/commercial-shipping-types');
        if (!cancelled && Array.isArray(data?.options) && data.options.length) {
          setCommercialOpts(data.options);
        }
      } catch (_) {
        if (!cancelled) {
          setCommercialOpts([
            { code: 'ПГ', label: 'Перевозка грузов по договору' },
            { code: 'РП', label: 'Регулярные перевозки пассажиров и багажа' },
            { code: 'ЗП', label: 'Пассажиры и багаж по заказу' },
            { code: 'ТЛ', label: 'Легковое такси' },
            { code: 'ОД', label: 'Организованная перевозка детей (автобусы)' },
          ]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showCreateEplModal]);

  useEffect(() => {
    if (!showCreateEplModal || !freightDriverEntry) {
      setFreightStores([]);
      setFreightStoresLoading(false);
      return;
    }
    let cancelled = false;
    setFreightStoresLoading(true);
    api
      .get('/driver/freight-stores')
      .then((res) => {
        if (!cancelled) setFreightStores(Array.isArray(res.data) ? res.data : []);
      })
      .catch(() => {
        if (!cancelled) setFreightStores([]);
      })
      .finally(() => {
        if (!cancelled) setFreightStoresLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showCreateEplModal, freightDriverEntry]);

  const handleCreateEpl = async () => {
    setCreateEplError('');
    if (freightDriverEntry) {
      const o = createFreightOrigin.trim();
      const l = createFreightLoad.trim();
      const hasUnload = createFreightStoreIds.length > 0 || createFreightExtraUnload.trim();
      if (!o || !l || !hasUnload) {
        setCreateEplError('Укажите отправление, погрузку и хотя бы одну выгрузку (из списка или дополнительную строку).');
        setCreateEplStep('error');
        return;
      }
    }
    try {
      setCreatingEpl(true);
      setCreateEplStep('sending');
      const startOdometer = createEplOdometer === '' ? 0 : parseInt(createEplOdometer, 10);
      const body = {
        startOdometer: isNaN(startOdometer) ? 0 : startOdometer,
        commercialShippingType: createEplCommercial || 'ПГ',
      };
      if (freightDriverEntry) {
        body.freightOriginAddress = createFreightOrigin.trim();
        body.freightLoadAddress = createFreightLoad.trim();
        body.freightUnloadStoreIds = createFreightStoreIds;
        if (createFreightExtraUnload.trim()) {
          body.freightUnloadAddresses = [createFreightExtraUnload.trim()];
        }
      }
      const { data } = await api.post('/driver/epl/create', body);
      setCreateEplStep('success');
      await loadDriverData();
      await loadEplList();
      await loadNotifications();
      setTimeout(() => {
        setShowCreateEplModal(false);
        setCreateEplStep('form');
        if (data.id) {
          navigate(`/driver/epl/${data.id}`);
        }
      }, 800);
    } catch (err) {
      const msg = err.response?.data?.details || err.response?.data?.error || err.message || 'Не удалось создать путевой лист.';
      setCreateEplStep('error');
      setCreateEplError(msg);
    } finally {
      setCreatingEpl(false);
    }
  };

  const closeCreateEplModal = () => {
    setShowCreateEplModal(false);
    setCreateEplStep('form');
    setCreateEplError('');
  };

  const [closingShift, setClosingShift] = useState(false);
  const [showCloseShiftConfirm, setShowCloseShiftConfirm] = useState(false);
  const handleCloseShiftClick = () => {
    if (!activeShift && !pendingEpl) return;
    setShowCloseShiftConfirm(true);
  };
  const confirmCloseShift = async () => {
    const epl = activeShift || pendingEpl;
    if (!epl) return;
    try {
      setClosingShift(true);
      setShowCloseShiftConfirm(false);
      await api.post(`/driver/epl/${epl.id}/close-shift`);
      await loadEplList();
      navigate('/driver');
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || 'Не удалось закрыть смену');
    } finally {
      setClosingShift(false);
    }
  };

  // Статус смены: активна (есть QR/документ), ожидание клиники (заявка без QR), или нет смены
  const getShiftStatus = () => {
    if (activeShift) {
      const shiftStart = activeShift.documentPdfReceivedAt || activeShift.approvedAt || activeShift.createdAt;
      const created = parseUtc(shiftStart) || new Date(0);
      const now = Date.now();
      const SHIFT_HOURS = 12;
      const validUntil = new Date(created.getTime() + SHIFT_HOURS * 60 * 60 * 1000);
      const hoursLeft = (validUntil.getTime() - now) / (1000 * 60 * 60);
      return {
        status: 'active',
        value: 'Путевой лист открыт, смена активна',
        time: hoursLeft > 0 ? `До конца смены: ${Math.floor(hoursLeft)}ч ${Math.floor((hoursLeft % 1) * 60)}м` : 'Смена скоро завершится',
        shiftOpenedAt: formatDateMsk(shiftStart)
      };
    }
    if (pendingEpl && pendingEpl.createdAt) {
      const isTaxcomOnly = pendingEpl.parkEplPrintMode === 'taxcom_only';
      return {
        status: 'creating',
        value: isTaxcomOnly ? 'Оформляется путевой в Такском' : 'Оформление путевого листа…',
        time: formatDateMsk(pendingEpl.createdAt),
        hint: isTaxcomOnly
          ? 'Официальный документ и QR Такском появятся после обработки (обычно несколько минут).'
          : 'Черновой PDF может появиться сразу; официальный ЭПЛ и QR Такском — после программы на ПК и ГИС.'
      };
    }
    return { status: 'inactive', value: 'Нет открытого путевого — смена не начата', time: null };
  };

  // Приветствие с временем суток (по МСК)
  const getGreeting = () => {
    // Используем МСК время
    const now = new Date();
    const hour = parseInt(now.toLocaleTimeString('en-US', { 
      timeZone: 'Europe/Moscow',
      hour12: false,
      hour: '2-digit'
    }), 10);
    if (hour >= 5 && hour < 12) return 'Доброе утро';
    if (hour >= 12 && hour < 17) return 'Добрый день';
    if (hour >= 17 && hour < 22) return 'Добрый вечер';
    return 'Доброй ночи';
  };

  // Получаем имя и отчество
  const getNameParts = () => {
    if (!driver?.fullName) return null;
    const parts = driver.fullName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return { name: parts[1], secondName: parts[2] || '' };
    }
    return null;
  };

  const nameParts = getNameParts();
  const displayName = nameParts ? `${nameParts.name} ${nameParts.secondName}`.trim() : (driver?.fullName || '');

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'shift_will_close':
      case 'expiry_warning':
        return Clock;
      case 'shift_opened':
        return Truck;
      case 'epl_ready':
        return FileCheck;
      case 'auto_closed':
      case 'photo_control_expiry':
        return AlertCircle;
      default:
        return Bell;
    }
  };

  const shiftStatus = getShiftStatus();
  const unreadCount = notifications.filter((n) => !n.readAt).length;

  if (loading) {
    return (
      <div className="relative min-h-screen">
        <FreightCinematicBackdrop night={sceneNight} />
        <div className="relative z-10 flex min-h-screen items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            className="inline-block w-12 h-12 border-4 border-teal-600 border-t-transparent rounded-full mb-4"
          />
          <p className={`font-medium drop-shadow-sm ${sceneNight ? 'text-slate-200' : 'text-slate-700'}`}>Загрузка...</p>
        </motion.div>
        </div>
      </div>
    );
  }

  if (!driver) {
    return (
      <div className="relative min-h-screen">
        <FreightCinematicBackdrop night={sceneNight} />
        <div className="relative z-10 flex min-h-screen items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className={`max-w-sm rounded-2xl border p-8 text-center shadow-2xl backdrop-blur-md ${
            sceneNight ? 'border-slate-600/60 bg-slate-900/90 text-slate-100' : 'border-white/50 bg-white/90'
          }`}
        >
          <p className="text-red-600 font-semibold mb-4">Не удалось загрузить профиль</p>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => navigate('/login')}
            className="freight-btn-primary w-full py-3 shadow-md"
          >
            Войти снова
          </motion.button>
        </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
      <FreightCinematicBackdrop night={sceneNight} />
      <div className="relative z-10">
      {isImpersonation && (
        <div className="flex items-center justify-center gap-3 bg-amber-500/95 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm">
          <span>Просмотр от имени водителя (админ)</span>
          <button
            type="button"
            onClick={exitImpersonation}
            className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded-lg font-semibold"
          >
            Выйти из режима водителя
          </button>
        </div>
      )}
      {/* Хедер с профилем и балансом (поменяны местами) */}
      <header
        className={`sticky top-0 z-30 border-b shadow-sm backdrop-blur-xl ${
          sceneNight ? 'border-slate-700/60 bg-slate-950/82 text-slate-100' : 'border-white/35 bg-white/55'
        }`}
      >
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <ProfileMenu
              driver={driver}
              night={sceneNight}
              onProfileClick={() => setShowProfileModal(true)}
              onCloseOtherMenus={() => setShowNotifications(false)}
            />
            <div className="relative flex items-center gap-2 sm:gap-3" ref={notificationsMenuRef}>
              <button
                type="button"
                onClick={() => setSceneNight((n) => !n)}
                className={`rounded-xl border p-2.5 shadow-sm backdrop-blur-sm transition ${
                  sceneNight
                    ? 'border-slate-600/70 bg-slate-800/90 hover:bg-slate-800'
                    : 'border-white/50 bg-white/60 hover:bg-white/85'
                }`}
                title={sceneNight ? 'Светлая сцена' : 'Ночная сцена'}
              >
                {sceneNight ? (
                  <Sun className="h-5 w-5 text-amber-500" />
                ) : (
                  <Moon className="h-5 w-5 text-slate-600" />
                )}
              </button>
              {evacuatorEnabled && (
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => navigate('/driver/evacuator')}
                  className={`p-2.5 rounded-xl shadow-sm transition-shadow ${
                    sceneNight
                      ? 'border border-orange-500/40 bg-orange-950/55 text-orange-200 hover:bg-orange-950/75 hover:shadow-md'
                      : 'border border-orange-200 bg-orange-100 text-orange-800 hover:bg-orange-200 hover:shadow-md'
                  }`}
                  title="Вызвать эвакуатор"
                >
                  <Truck className="w-5 h-5" />
                </motion.button>
              )}
              {commissionerEnabled && (
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => navigate('/driver/commissioner')}
                  className={`p-2.5 rounded-xl shadow-sm transition-shadow ${
                    sceneNight
                      ? 'border border-orange-500/40 bg-orange-950/55 text-orange-200 hover:bg-orange-950/75 hover:shadow-md'
                      : 'border border-orange-200 bg-orange-100 text-orange-800 hover:bg-orange-200 hover:shadow-md'
                  }`}
                  title="Вызвать комиссара"
                >
                  <ShieldAlert className="w-5 h-5" />
                </motion.button>
              )}
              {gameEnabled && (
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => navigate('/driver/game')}
                  className={`p-2.5 rounded-xl shadow-sm transition-shadow ${
                    sceneNight
                      ? 'border border-teal-500/35 bg-teal-950/50 text-teal-200 hover:bg-teal-950/70 hover:shadow-md'
                      : 'border border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100 hover:shadow-md'
                  }`}
                  title="Мини-игра"
                >
                  <Gamepad2 className="w-5 h-5" />
                </motion.button>
              )}
              {/* Кнопка уведомлений */}
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                const next = !showNotifications;
                setShowNotifications(next);
                if (next) loadNotifications();
              }}
                className={`relative p-2.5 rounded-xl shadow-sm transition-shadow ${
                  sceneNight
                    ? 'border border-slate-600/70 bg-slate-800/90 hover:bg-slate-800 hover:shadow-md'
                    : 'border border-slate-200 bg-white hover:shadow-md'
                }`}
              >
                <Bell className={`w-5 h-5 ${sceneNight ? 'text-slate-200' : 'text-slate-700'}`} />
                {unreadCount > 0 && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold"
                  >
                    {unreadCount}
                  </motion.span>
                )}
              </motion.button>
              <BalanceMenu balance={balance} eplPrice={driver?.eplPrice ?? 25} onOpen={() => { setShowNotifications(false); loadDriverData(true); }} />
              
              {/* Выпадающее меню уведомлений */}
              {showNotifications && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute top-full right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-xl border border-slate-200 z-50 flex flex-col max-h-[min(24rem,70vh)]"
                >
                  <div className="p-4 border-b border-slate-100 shrink-0">
                    <h3 className="font-semibold text-slate-800">Уведомления</h3>
                  </div>
                  <div className="flex flex-col flex-1 min-h-0">
                    {loadingNotifications ? (
                      <p className="text-slate-500 py-4 text-center">Загрузка...</p>
                    ) : notifications.length === 0 ? (
                      <p className="text-slate-500 py-4 text-center">Пока нет уведомлений</p>
                    ) : (
                      <div className="p-2 overflow-y-auto flex-1">
                        <AnimatePresence mode="popLayout" initial={false}>
                          {notifications.slice(0, 20).map((n) => (
                            <motion.div
                              key={`notif-${n.id}-${n.createdAt || ''}`}
                              layout
                              initial={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0, marginBottom: 0, overflow: 'hidden' }}
                              transition={{ duration: 0.2, ease: 'easeInOut' }}
                              role="button"
                              tabIndex={0}
                              onClick={() => handleNotificationClick(n)}
                              onKeyDown={(e) => e.key === 'Enter' && handleNotificationClick(n)}
                              className={`p-3 rounded-lg mb-1 cursor-pointer ${!n.readAt ? 'bg-amber-50' : 'bg-slate-50'} hover:bg-slate-100/80 transition-colors`}
                            >
                              {(() => {
                                const Icon = getNotificationIcon(n.type);
                                return (
                                  <>
                                    <div className="flex items-start gap-2">
                                      <Icon className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                                      <div className="flex-1 min-w-0">
                                        <p className="font-medium text-slate-800 text-sm">{n.title || 'Уведомление'}</p>
                                        <p className="text-slate-600 text-xs mt-0.5">{n.body}</p>
                                        <p className="text-slate-400 text-xs mt-1.5 flex items-center gap-1">
                                          <Clock className="w-3.5 h-3.5 shrink-0" />
                                          {formatNotificationTime(n.createdAt)}
                                        </p>
                                        {!n.readAt && (
                                          <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); markNotificationRead(n.id, false, true); }}
                                            className="text-xs text-amber-600 mt-1 underline hover:text-amber-700"
                                          >
                                            Прочитано
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  </>
                                );
                              })()}
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      </div>
                    )}
                    {notifications.length > 0 && (
                      <div className="p-3 border-t border-slate-100 shrink-0 bg-slate-50 rounded-b-xl">
                        <button
                          type="button"
                          onClick={markAllNotificationsRead}
                          disabled={clearingAllNotifications}
                          className="w-full py-2.5 text-sm font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition disabled:opacity-50"
                        >
                          {clearingAllNotifications ? 'Отмечаем...' : 'Отметить все прочитанными'}
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Главная */}
        {activeTab === 'menu' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="space-y-6"
          >
            {/* Приветствие */}
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className={`rounded-2xl border p-6 shadow-xl transition-all duration-500 ${
                sceneNight
                  ? 'border-[var(--freight-driver-border-night)] bg-[var(--freight-driver-surface-night)] text-white shadow-[0_12px_40px_rgba(0,0,0,0.42)] backdrop-blur-xl'
                  : 'border-[var(--freight-driver-border)] bg-white/90 text-slate-900 shadow-[0_12px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl'
              }`}
            >
              <h1 className={`text-2xl font-bold tracking-tight ${sceneNight ? 'text-white' : 'text-slate-900'}`}>
                {getGreeting()}{displayName ? `, ${displayName}` : ''}!
              </h1>
              <p
                className={`mt-2 text-sm font-medium ${
                  sceneNight ? 'text-teal-200/90' : 'text-slate-700'
                }`}
              >
                Грузовые перевозки · электронный путевой лист
              </p>
            </motion.div>

            {/* Объединённая карточка статусов — клик: нет смены → модалка создания, создаётся/активна → карточка путевого */}
            <div className="space-y-4">
            <StatusOverview
              cinematic
              night={sceneNight}
              shiftStatus={shiftStatus}
              isVerified={driver.isVerified}
              carId={driver.carId}
              regNumber={driver.regNumber}
              onStatusClick={() => {
                if (activeShift) navigate(`/driver/epl/${activeShift.id}`);
                else if (pendingEpl) navigate(`/driver/epl/${pendingEpl.id}`);
                else openCreateEplModal();
              }}
              isShiftActive={!!(activeShift || pendingEpl)}
              photoControlEnabled={photoControlEnabled}
              photoControlStatus={photoControlStatus}
              onPhotoControlClick={() => navigate('/driver/photo-control')}
            />
            <FreightEplHint night={sceneNight} />
            </div>

            {/* Эвакуатор */}
            {evacuatorEnabled && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`rounded-2xl border p-4 ${
                  sceneNight ? 'border-orange-500/35 bg-slate-900/75 text-orange-100' : 'border-orange-200 bg-orange-50/80'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <p className={`font-semibold flex items-center gap-2 ${sceneNight ? 'text-orange-100' : 'text-orange-900'}`}>
                      <Truck className="w-5 h-5" />
                      Эвакуатор
                    </p>
                    <p className={`text-sm mt-1 ${sceneNight ? 'text-orange-200/90' : 'text-orange-800'}`}>
                      Сейчас на линии: <strong>{evacuatorOnlineCount}</strong> {evacuatorOnlineCount === 1 ? 'эвакуатор' : 'эвакуаторов'}
                      {evacuatorRequestPrice > 0 && ` · Заявка ${evacuatorRequestPrice} ₽`}
                    </p>
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => navigate('/driver/evacuator')}
                    className="shrink-0 px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm flex items-center gap-2 shadow-md"
                  >
                    <Truck className="w-4 h-4" />
                    Вызвать эвак
                  </motion.button>
                </div>
              </motion.div>
            )}

            {/* Комиссар */}
            {commissionerEnabled && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`rounded-2xl border p-4 ${
                  sceneNight ? 'border-orange-500/35 bg-slate-900/75 text-orange-100' : 'border-orange-200 bg-orange-50/80'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <p className={`font-semibold flex items-center gap-2 ${sceneNight ? 'text-orange-100' : 'text-orange-900'}`}>
                      <ShieldAlert className="w-5 h-5" />
                      Аварийный комиссар
                    </p>
                    <p className={`text-sm mt-1 ${sceneNight ? 'text-orange-200/90' : 'text-orange-800'}`}>
                      Сейчас на линии: <strong>{commissionerOnlineCount}</strong> {commissionerOnlineCount === 1 ? 'комиссар' : 'комиссаров'}
                      {commissionerRequestPrice > 0 && ` · Заявка ${commissionerRequestPrice} ₽`}
                    </p>
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => navigate('/driver/commissioner')}
                    className="shrink-0 px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm flex items-center gap-2 shadow-md"
                  >
                    <ShieldAlert className="w-4 h-4" />
                    Вызвать комиссара
                  </motion.button>
                </div>
              </motion.div>
            )}

            {/* Пока создаётся путевой — предложение поиграть */}
            {pendingEpl && gameEnabled && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`rounded-2xl border p-4 flex flex-col sm:flex-row items-center justify-between gap-3 ${
                  sceneNight ? 'border-sky-600/40 bg-slate-900/75' : 'border-sky-200 bg-sky-50/90'
                }`}
              >
                <p className={`font-medium text-sm sm:text-base ${sceneNight ? 'text-sky-100' : 'text-sky-950'}`}>
                  Пока оформляется путевой — можно сыграть в мини-игру и набрать очки.
                </p>
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => navigate('/driver/game')}
                  className="shrink-0 freight-btn-primary gap-2 shadow-md"
                >
                  <Gamepad2 className="w-4 h-4" />
                  Играть
                </motion.button>
              </motion.div>
            )}

            {/* Кнопки: при активной смене или создающемся путевом — открыть, иначе — создать путевой лист */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="flex flex-col sm:flex-row gap-3"
            >
              {(activeShift || pendingEpl) ? (
                <>
                  <motion.button
                    whileHover={{ scale: 1.02, y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => navigate(`/driver/epl/${(activeShift || pendingEpl).id}`)}
                    className="flex-1 py-4 px-6 rounded-2xl font-semibold flex items-center justify-center gap-3 transition shadow-lg bg-gradient-to-r from-teal-600 to-teal-800 text-white hover:from-teal-700 hover:to-teal-900"
                  >
                    <FileText className="w-5 h-5" />
                    <span>Открыть путевой лист</span>
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02, y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleCloseShiftClick()}
                    disabled={closingShift}
                    className="flex-1 py-4 px-6 rounded-2xl font-semibold flex items-center justify-center gap-3 transition shadow-lg bg-slate-600 hover:bg-slate-700 text-white disabled:opacity-50"
                  >
                    {closingShift ? 'Закрываем...' : (activeShift ? 'Закрыть смену' : 'Отменить заявку')}
                  </motion.button>
                </>
              ) : (
                <motion.button
                  whileHover={{ scale: 1.02, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={openCreateEplModal}
                  disabled={!driver.carId || balance < (driver?.eplPrice ?? 25)}
                  className={`w-full py-4 px-6 rounded-2xl font-semibold flex items-center justify-center gap-3 transition shadow-lg ${
                    driver.carId && balance >= (driver?.eplPrice ?? 25)
                      ? 'bg-gradient-to-r from-teal-600 to-teal-800 text-white hover:from-teal-700 hover:to-teal-900'
                      : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <FileText className="w-5 h-5" />
                  <span>Новый путевой лист</span>
                </motion.button>
              )}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.22 }}
              className="flex"
            >
              <motion.button
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => navigate('/driver/messages')}
                className={`w-full py-4 px-6 rounded-2xl font-semibold flex items-center justify-center gap-3 transition shadow-lg ${
                  sceneNight
                    ? 'border border-slate-600/70 bg-slate-800/90 text-slate-100 hover:bg-slate-800 shadow-black/25'
                    : 'border border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                }`}
              >
                <MessageCircle className={`w-5 h-5 ${sceneNight ? 'text-teal-400' : 'text-indigo-600'}`} />
                <span>Сообщения от парка</span>
              </motion.button>
            </motion.div>

            {/* Предупреждения */}
            {!driver.carId && (
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className={`rounded-xl border p-4 ${
                  sceneNight ? 'border-orange-400/40 bg-orange-950/45 text-orange-100' : 'border-orange-200 bg-orange-50'
                }`}
              >
                <p className={`font-medium ${sceneNight ? 'text-orange-100' : 'text-orange-900'}`}>
                  ⚠️ Транспортное средство не привязано. Обратитесь к диспетчеру или менеджеру парка.
                </p>
              </motion.div>
            )}
            {balance < (driver?.eplPrice ?? 25) && (
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className={`rounded-xl border p-4 ${
                  sceneNight ? 'border-orange-400/40 bg-orange-950/45' : 'border-orange-200 bg-orange-50'
                }`}
              >
                <p className={`font-medium ${sceneNight ? 'text-orange-100' : 'text-orange-800'}`}>
                  💰 Мало средств для создания путевого ({(driver?.eplPrice ?? 25)} ₽). Пополните баланс.
                </p>
              </motion.div>
            )}

          </motion.div>
        )}

      </main>

      {/* Модальное окно: создание путевого */}
      {showCreateEplModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={closeCreateEplModal}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
          >
            {createEplStep === 'success' ? (
              <div className="text-center py-4">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 200 }}
                  className="text-5xl mb-3"
                >
                  ✅
                </motion.div>
                <h3 className="text-lg font-semibold text-emerald-700">Путевой лист создан</h3>
                <p className="text-slate-600 text-sm mt-1">Переход к путевому…</p>
              </div>
            ) : createEplStep === 'error' ? (
              <div>
                <h3 className="text-lg font-semibold text-red-700">Ошибка создания</h3>
                <p className="text-slate-700 text-sm mt-2 whitespace-pre-wrap">{createEplError}</p>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={closeCreateEplModal}
                  className="mt-6 w-full py-2.5 px-4 rounded-xl font-semibold bg-slate-200 text-slate-800 hover:bg-slate-300"
                >
                  Закрыть
                </motion.button>
              </div>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-slate-800">Новый путевой лист</h3>
                <p className="text-slate-600 text-sm mt-1">
                  {freightDriverEntry
                    ? 'Вид перевозки и пробег — как обычно. Маршрут: точки выгрузки из списка парка (минимум действий).'
                    : 'Укажите вид коммерческой перевозки (для грузового парка обычно «перевозка грузов»). Пробег — перед выездом; адреса рейса диспетчер внесёт в Такском.'}
                </p>
                <label className="block mt-4 text-sm font-medium text-slate-700">Вид коммерческой перевозки</label>
                <select
                  value={createEplCommercial}
                  onChange={(e) => setCreateEplCommercial(e.target.value)}
                  disabled={creatingEpl}
                  className="mt-1 w-full freight-input py-3 rounded-xl disabled:bg-slate-100 text-slate-900"
                >
                  {(commercialOpts.length ? commercialOpts : [{ code: 'ПГ', label: 'Перевозка грузов по договору' }]).map(
                    (o) => (
                      <option key={o.code} value={o.code}>
                        {o.code} — {o.label}
                      </option>
                    )
                  )}
                </select>
                {freightDriverEntry && (
                  <DriverCreateEplFreightFields
                    sceneNight={false}
                    stores={freightStores}
                    storesLoading={freightStoresLoading}
                    origin={createFreightOrigin}
                    setOrigin={setCreateFreightOrigin}
                    loadAddr={createFreightLoad}
                    setLoadAddr={setCreateFreightLoad}
                    selectedStoreIds={createFreightStoreIds}
                    toggleStoreId={toggleFreightStoreId}
                    extraUnload={createFreightExtraUnload}
                    setExtraUnload={setCreateFreightExtraUnload}
                  />
                )}
                <label className="block mt-4 text-sm font-medium text-slate-700">Пробег при выезде (км)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                  value={createEplOdometer}
                  onChange={(e) => setCreateEplOdometer(e.target.value)}
                  disabled={creatingEpl}
                  className="mt-1 freight-input py-3 rounded-xl disabled:bg-slate-100"
                />
                {creatingEpl && (
                  <p className="mt-3 text-sm text-teal-700 flex items-center gap-2">
                    <motion.span
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      className="inline-block w-4 h-4 border-2 border-teal-600 border-t-transparent rounded-full"
                    />
                    Создаём заявку и путевой…
                  </p>
                )}
                <div className="mt-6 flex gap-3">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={closeCreateEplModal}
                    disabled={creatingEpl}
                    className="freight-btn-secondary flex-1"
                  >
                    Отмена
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleCreateEpl}
                    disabled={creatingEpl}
                    className="freight-btn-primary flex-1 disabled:opacity-60"
                  >
                    {creatingEpl ? '…' : 'Создать ЭПЛ'}
                  </motion.button>
                </div>
              </>
            )}
          </motion.div>
          </motion.div>
        )}

      {/* Подтверждение закрытия смены */}
      {showCloseShiftConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 border border-slate-200"
          >
            <h3 className="text-lg font-bold text-slate-800 mb-2">
              {activeShift ? 'Закрыть смену и путевой лист?' : 'Отменить оформление путевого?'}
            </h3>
            <p className="text-slate-600 text-sm mb-6">
              {activeShift 
                ? 'Смена закроется по текущему путевому. Новый путевой можно оформить после закрытия; история сохранится.'
                : 'Заявка на путевой будет снята. Позже можно создать новый.'
              }
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowCloseShiftConfirm(false)}
                className="flex-1 py-2.5 px-4 rounded-xl font-medium border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Назад
              </button>
              <button
                type="button"
                onClick={confirmCloseShift}
                disabled={closingShift}
                className="flex-1 py-2.5 px-4 rounded-xl font-semibold bg-slate-700 hover:bg-slate-800 text-white disabled:opacity-50"
              >
                {closingShift ? 'Закрываем...' : (activeShift ? 'Закрыть смену' : 'Отменить заявку')}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Модалка профиля */}
      <DriverProfileModal
        driver={driver}
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
      />
      </div>
    </div>
  );
}
