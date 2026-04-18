import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Save, Wallet, Power, Trash2, Link2, CheckCircle, XCircle, Plus, Pencil, Trash, Users, ChevronDown, Banknote, Gamepad2, Camera, FileText, Truck, Store, ShieldAlert, Send, Stethoscope, Wrench, Phone as PhoneIcon, Eye, EyeOff } from 'lucide-react';
import api from '../../api';
import { useToast } from '../../hooks/useToast';
import { FEATURE_EVACUATOR_AND_COMMISSIONER } from '../../config/features';
import Modal from '../ui/Modal';
import FreightStoresTab from '../manager/FreightStoresTab';

function SettingsAccordion({ title, icon: Icon, iconBg, defaultOpen = false, children }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="bg-slate-50 rounded-lg sm:rounded-xl border border-slate-200 overflow-hidden">
      <button type="button" onClick={() => setIsOpen(!isOpen)} className="w-full flex items-center justify-between p-3 sm:p-4 hover:bg-slate-100 transition text-left">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className={`p-1.5 sm:p-2 ${iconBg} rounded-lg shrink-0`}><Icon className="w-4 h-4 sm:w-5 sm:h-5" /></div>
          <h3 className="text-base sm:text-lg font-bold text-slate-800">{title}</h3>
        </div>
        <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="w-5 h-5 text-slate-600 shrink-0" />
        </motion.div>
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
            <div className="p-3 sm:p-5 border-t border-slate-200">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const EMPTY_OWNER = {
  type: 'legal', role: 'С', name: '', inn: '', ogrn: '', ogrnip: '', kpp: '',
  phone: '', email: '', postalIndex: '', regionCode: '', district: '', city: '',
  locality: '', street: '', house: '', housing: '', flat: '', isDefault: false
};

export default function ParkSettingsModal({ park, isOpen, onClose, onSave, apiPrefix = 'admin', canDeletePark = true, settingsPermissions = null }) {
  const { showToast } = useToast();
  const apiRoot = `/${apiPrefix}`;
  const isAdminApi = apiPrefix === 'admin';
  const access = {
    statusName: isAdminApi || !!settingsPermissions?.canParkSettingsStatusName,
    takskom: isAdminApi || !!settingsPermissions?.canParkSettingsTakskom,
    staff: isAdminApi || !!settingsPermissions?.canParkSettingsStaff,
    freight: isAdminApi || !!settingsPermissions?.canParkSettingsFreight,
    broadcasts: isAdminApi || !!settingsPermissions?.canParkSettingsBroadcasts,
    owners: isAdminApi || !!settingsPermissions?.canParkSettingsOwners,
    balance: isAdminApi || !!settingsPermissions?.canParkSettingsBalance,
    pricing: isAdminApi || !!settingsPermissions?.canParkSettingsPricing,
    game: isAdminApi || !!settingsPermissions?.canParkSettingsGame,
    photoControl: isAdminApi || !!settingsPermissions?.canParkSettingsPhotoControl,
    services: isAdminApi || !!settingsPermissions?.canParkSettingsServices,
  };
  const canEditAnything = Object.values(access).some(Boolean);
  const [balanceDeductionOrder, setBalanceDeductionOrder] = useState('real_first');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [takskornId, setTakskornId] = useState('');
  const [carParks, setCarParks] = useState([]);
  const [carParksLoading, setCarParksLoading] = useState(false);

  const [eplPrice, setEplPrice] = useState(25);
  const [autoClosePrice, setAutoClosePrice] = useState(10);
  const [eplPrintMode, setEplPrintMode] = useState('our_then_taxcom');
  const [eplAccessMode, setEplAccessMode] = useState('all');
  /** Кто вводит адреса грузового рейса (отправление / погрузка / выгрузки): водитель при создании ЭПЛ или диспетчер/менеджер в ЛК Такском */
  const [freightAddressEntryMode, setFreightAddressEntryMode] = useState('manager');
  /** Одна строка на поле — подставляются водителю при создании ЭПЛ (режим «водитель вводит адреса»), можно править перед отправкой */
  const [freightDefaultOriginAddress, setFreightDefaultOriginAddress] = useState('');
  const [freightDefaultLoadAddress, setFreightDefaultLoadAddress] = useState('');

  // Настройки игры
  const [gameEnabled, setGameEnabled] = useState(false);
  const [leaderboardDefault, setLeaderboardDefault] = useState('day');
  const [rewardsEnabled, setRewardsEnabled] = useState(false);
  const [gameRewards, setGameRewards] = useState([]);
  // Магазин игры: очки или реал, цены на бусты
  const [gameShopCurrencyType, setGameShopCurrencyType] = useState('points');
  const [gameShopMagnet, setGameShopMagnet] = useState(200);
  const [gameShopNitro, setGameShopNitro] = useState(200);
  const [gameShopJump, setGameShopJump] = useState(200);
  const [gameShopExtraLife, setGameShopExtraLife] = useState(500);
  // Фотоконтроль
  const [photoControlEnabled, setPhotoControlEnabled] = useState(false);
  const [photoControlPrice, setPhotoControlPrice] = useState(150);
  const [photoControlValidDays, setPhotoControlValidDays] = useState(10);
  const [photoControlNotifyHoursBefore, setPhotoControlNotifyHoursBefore] = useState(24);
  const userChangedFCRef = useRef(false);
  const [evacuatorEnabled, setEvacuatorEnabled] = useState(false);
  const [evacuatorRequestPriceOverride, setEvacuatorRequestPriceOverride] = useState('');
  const [commissionerEnabled, setCommissionerEnabled] = useState(false);
  const [commissionerRequestPriceOverride, setCommissionerRequestPriceOverride] = useState('');
  const [broadcastRepliesRouting, setBroadcastRepliesRouting] = useState('park'); // 'park' | 'sender'

  // Персонал Такском (логин/пароль для подписи ЭПЛ)
  const [staffList, setStaffList] = useState([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffSaving, setStaffSaving] = useState(false);
  const [showStaffPasswords, setShowStaffPasswords] = useState({});

  // Владельцы ТС (park_owners)
  const [owners, setOwners] = useState([]);
  const [ownersLoading, setOwnersLoading] = useState(false);
  const [ownerModalOpen, setOwnerModalOpen] = useState(false);
  const [editingOwner, setEditingOwner] = useState(null);
  const [ownerForm, setOwnerForm] = useState({ ...EMPTY_OWNER });
  const [ownerSaving, setOwnerSaving] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [allOwners, setAllOwners] = useState([]);
  const [allOwnersLoading, setAllOwnersLoading] = useState(false);
  const [allOwnersSearch, setAllOwnersSearch] = useState('');

  const loadOwners = () => {
    if (!park) return;
    setOwnersLoading(true);
    api.get(`${apiRoot}/parks/${park.id}/owners`)
      .then(r => setOwners(r.data || []))
      .catch(() => setOwners([]))
      .finally(() => setOwnersLoading(false));
  };

  const STAFF_ROLES = [
    { role: 'dispatcher', label: 'Диспетчер', icon: PhoneIcon, color: 'text-green-600', bg: 'bg-green-100', defaultPosition: 'Диспетчер' },
    { role: 'medic', label: 'Медик', icon: Stethoscope, color: 'text-red-600', bg: 'bg-red-100', defaultPosition: 'Медицинский работник' },
    { role: 'technic', label: 'Механик', icon: Wrench, color: 'text-teal-600', bg: 'bg-teal-100', defaultPosition: 'Контролёр технического состояния' },
  ];

  const loadStaff = () => {
    if (!park) return;
    setStaffLoading(true);
    api.get(`${apiRoot}/parks/${park.id}/staff`)
      .then(r => {
        const existing = r.data || [];
        const merged = STAFF_ROLES.map(sr => {
          const found = existing.find(s => s.role === sr.role);
          return found || { role: sr.role, fullName: '', position: sr.defaultPosition, taxcomLogin: '', taxcomPassword: '' };
        });
        setStaffList(merged);
      })
      .catch(() => setStaffList(STAFF_ROLES.map(sr => ({ role: sr.role, fullName: '', position: sr.defaultPosition, taxcomLogin: '', taxcomPassword: '' }))))
      .finally(() => setStaffLoading(false));
  };

  const handleSaveStaff = async (staffItem) => {
    if (!park) return;
    setStaffSaving(true);
    try {
      await api.post(`${apiRoot}/parks/${park.id}/staff`, staffItem);
      showToast(`Сотрудник "${STAFF_ROLES.find(r => r.role === staffItem.role)?.label}" сохранён`, 'success');
      loadStaff();
    } catch (e) {
      showToast(e.response?.data?.error || e.message, 'error');
    } finally {
      setStaffSaving(false);
    }
  };

  const updateStaffField = (role, field, value) => {
    setStaffList(prev => prev.map(s => s.role === role ? { ...s, [field]: value } : s));
  };

  useEffect(() => {
    if (isOpen && park) {
      if (access.owners) loadOwners();
      if (access.staff) loadStaff();
    }
  }, [isOpen, park, access.owners, access.staff]);

  const openOwnerModal = (owner = null) => {
    setEditingOwner(owner);
    setOwnerForm(owner ? { ...EMPTY_OWNER, ...owner, isDefault: !!owner.isDefault } : { ...EMPTY_OWNER });
    setOwnerModalOpen(true);
  };

  const handleSaveOwner = async () => {
    if (!ownerForm.name?.trim()) { showToast('Укажите наименование организации / ФИО', 'error'); return; }
    setOwnerSaving(true);
    try {
      if (editingOwner) {
        await api.put(`${apiRoot}/parks/${park.id}/owners/${editingOwner.id}`, ownerForm);
        showToast('Владелец обновлён', 'success');
      } else {
        await api.post(`${apiRoot}/parks/${park.id}/owners`, ownerForm);
        showToast('Владелец добавлен', 'success');
      }
      loadOwners();
      setOwnerModalOpen(false);
    } catch (e) {
      showToast(e.response?.data?.error || e.message, 'error');
    } finally {
      setOwnerSaving(false);
    }
  };

  const handleDeleteOwner = async (id) => {
    if (!window.confirm('Удалить владельца?')) return;
    try {
      await api.delete(`${apiRoot}/parks/${park.id}/owners/${id}`);
      showToast('Владелец удалён', 'success');
      loadOwners();
    } catch (e) {
      showToast(e.response?.data?.error || e.message, 'error');
    }
  };

  const openImportModal = () => {
    setAllOwnersLoading(true);
    setImportModalOpen(true);
    setAllOwnersSearch('');
    api.get(`${apiRoot}/owners/all`)
      .then(r => {
        const filtered = (r.data || []).filter(o => o.parkId !== park.id);
        setAllOwners(filtered);
      })
      .catch(() => setAllOwners([]))
      .finally(() => setAllOwnersLoading(false));
  };

  const handleImportOwner = (o) => {
    const { id, parkId, parkName, createdAt, updatedAt, isDefault, ...data } = o;
    setEditingOwner(null);
    setOwnerForm({ ...EMPTY_OWNER, ...data, isDefault: false });
    setImportModalOpen(false);
    setOwnerModalOpen(true);
  };
  
  const [isActive, setIsActive] = useState(false);
  const [parkName, setParkName] = useState('');

  useEffect(() => {
    if (isOpen && park) {
      userChangedFCRef.current = false;
      setParkName(park.name || '');
      loadParkSettings();
    }
  }, [isOpen, park]);

  useEffect(() => {
    if (!isOpen || !access.takskom) return;
    setCarParksLoading(true);
    api.get(`${apiRoot}/takskom/carparks`)
      .then((res) => setCarParks(res.data?.carParks || []))
      .catch(() => setCarParks([]))
      .finally(() => setCarParksLoading(false));
  }, [isOpen, access.takskom]);

  const loadParkSettings = async () => {
    if (!park) return;
    try {
      const res = isAdminApi
        ? await api.get(`${apiRoot}/parks/${park.id}/settings`)
        : await api.get(`${apiRoot}/park/settings`, { params: { parkId: park.id } });
      setBalanceDeductionOrder(res.data?.balanceDeductionOrder || 'real_first');
      setIsActive(res.data?.isActive || false);
      setTakskornId(res.data?.takskornId != null ? String(res.data.takskornId) : '');
      setEplPrice(res.data?.eplPrice ?? 25);
      setAutoClosePrice(res.data?.autoClosePrice ?? 10);
      setEplPrintMode(res.data?.eplPrintMode || 'our_then_taxcom');
      setEplAccessMode(
        res.data?.eplAccessMode === 'driver_only'
          ? 'driver_only'
          : res.data?.eplAccessMode === 'manager_director_only'
            ? 'manager_director_only'
            : 'all'
      );
      setFreightAddressEntryMode(res.data?.freightAddressEntryMode === 'driver' ? 'driver' : 'manager');
      setFreightDefaultOriginAddress(res.data?.freightDefaultOriginAddress != null ? String(res.data.freightDefaultOriginAddress) : '');
      setFreightDefaultLoadAddress(res.data?.freightDefaultLoadAddress != null ? String(res.data.freightDefaultLoadAddress) : '');
      setGameEnabled(!!res.data?.gameEnabled);
      setLeaderboardDefault(res.data?.leaderboardDefault || 'day');
      setRewardsEnabled(!!res.data?.rewardsEnabled);
      setGameRewards(Array.isArray(res.data?.gameRewards) ? res.data.gameRewards.map(r => ({
        position: r.position ?? 1,
        rewardType: r.rewardType || 'free_epl',
        freeEplCount: r.freeEplCount ?? 0,
        discountPercent: r.discountPercent ?? 0,
        discountEplCount: r.discountEplCount ?? 0
      })) : []);
      try {
        const shop = typeof res.data?.gameShopConfig === 'string' ? JSON.parse(res.data.gameShopConfig) : res.data?.gameShopConfig;
        if (shop && typeof shop.currencyType === 'string') {
          setGameShopCurrencyType(shop.currencyType === 'real' ? 'real' : 'points');
          setGameShopMagnet(Math.max(0, parseInt(shop.magnet, 10) || 200));
          setGameShopNitro(Math.max(0, parseInt(shop.nitro, 10) || 200));
          setGameShopJump(Math.max(0, parseInt(shop.jump, 10) || 200));
          setGameShopExtraLife(Math.max(0, parseInt(shop.extra_life, 10) || 500));
        }
      } catch (_) {}
      if (!userChangedFCRef.current) {
        setPhotoControlEnabled(!!res.data?.photoControlEnabled);
        setPhotoControlPrice(res.data?.photoControlPrice ?? 150);
        setPhotoControlValidDays(res.data?.photoControlValidDays ?? 10);
        setPhotoControlNotifyHoursBefore(res.data?.photoControlNotifyHoursBefore ?? 24);
      }
      setBroadcastRepliesRouting(res.data?.broadcastRepliesRouting === 'sender' ? 'sender' : 'park');
      if (FEATURE_EVACUATOR_AND_COMMISSIONER && access.services) {
        try {
          const evRes = await api.get(`${apiRoot}/parks/${park.id}/evacuator-settings`);
          setEvacuatorEnabled(!!evRes.data?.evacuatorEnabled);
          setEvacuatorRequestPriceOverride(evRes.data?.requestPriceOverride != null ? String(evRes.data.requestPriceOverride) : '');
        } catch (_) {}
        try {
          const cRes = await api.get(`${apiRoot}/parks/${park.id}/commissioner-settings`);
          setCommissionerEnabled(!!cRes.data?.commissionerEnabled);
          setCommissionerRequestPriceOverride(cRes.data?.requestPriceOverride != null ? String(cRes.data.requestPriceOverride) : '');
        } catch (_) {}
      }
    } catch (e) {
      console.error('Error loading park settings:', e);
      // Если роут не найден (404), используем значение по умолчанию
      // Это может произойти, если сервер не перезапущен
      if (e.response?.status === 404) {
        console.warn('Settings endpoint not found');
      }
    }
  };
  
  const handleSaveSettings = async () => {
    if (!park) {
      showToast('Парк не выбран', 'error');
      return;
    }
    if (!canEditAnything) {
      showToast('Нет прав на изменение настроек', 'error');
      return;
    }
    
    setSaving(true);
    try {
      if (FEATURE_EVACUATOR_AND_COMMISSIONER && access.services) {
        await api.put(`${apiRoot}/parks/${park.id}/evacuator-settings`, {
          evacuatorEnabled,
          requestPriceOverride: evacuatorRequestPriceOverride === '' ? null : (parseFloat(evacuatorRequestPriceOverride) || null)
        }).catch(() => {});
        await api.put(`${apiRoot}/parks/${park.id}/commissioner-settings`, {
          commissionerEnabled,
          requestPriceOverride: commissionerRequestPriceOverride === '' ? null : (parseFloat(commissionerRequestPriceOverride) || null)
        }).catch(() => {});
      }

      const payload = { eplCreationMode: 'clinic_api' };
      if (access.statusName) {
        payload.name = parkName.trim() || park.name;
        payload.isActive = isActive ? 1 : 0;
      }
      if (access.takskom) {
        payload.eplPrintMode = eplPrintMode;
        payload.eplAccessMode = eplAccessMode;
        payload.takskornId = takskornId && String(takskornId).trim() ? String(takskornId).trim() : null;
      }
      if (access.balance) payload.balanceDeductionOrder = balanceDeductionOrder;
      if (access.pricing) {
        payload.eplPrice = Number(eplPrice) || 25;
        payload.autoClosePrice = Number(autoClosePrice) || 10;
      }
      if (access.photoControl) {
        payload.photoControlEnabled = photoControlEnabled;
        payload.photoControlPrice = Number(photoControlPrice) || 150;
        payload.photoControlValidDays = Number(photoControlValidDays) || 10;
        payload.photoControlNotifyHoursBefore = Number(photoControlNotifyHoursBefore) || 24;
      }
      if (access.broadcasts) payload.broadcastRepliesRouting = broadcastRepliesRouting;
      if (access.freight) {
        payload.freightAddressEntryMode = freightAddressEntryMode;
        payload.freightDefaultOriginAddress = freightDefaultOriginAddress.trim() || null;
        payload.freightDefaultLoadAddress = freightDefaultLoadAddress.trim() || null;
      }
      if (access.game) {
        payload.gameEnabled = gameEnabled;
        payload.leaderboardDefault = leaderboardDefault;
        payload.rewardsEnabled = rewardsEnabled;
        payload.gameShopConfig = {
          currencyType: gameShopCurrencyType,
          magnet: Math.max(0, parseInt(gameShopMagnet, 10) || 0),
          nitro: Math.max(0, parseInt(gameShopNitro, 10) || 0),
          jump: Math.max(0, parseInt(gameShopJump, 10) || 0),
          extra_life: Math.max(0, parseInt(gameShopExtraLife, 10) || 0)
        };
        payload.gameRewards = gameRewards.map(r => ({
          position: parseInt(r.position, 10) || 1,
          rewardType: r.rewardType || 'free_epl',
          freeEplCount: r.rewardType === 'free_epl' ? (parseInt(r.freeEplCount, 10) || 0) : 0,
          discountPercent: r.rewardType === 'discount' ? (parseInt(r.discountPercent, 10) || 0) : 0,
          discountEplCount: r.rewardType === 'discount' ? (parseInt(r.discountEplCount, 10) || 0) : 0
        }));
      }
      const response = isAdminApi
        ? await api.put(`${apiRoot}/parks/${park.id}/settings`, payload)
        : await api.put(`${apiRoot}/park/settings`, payload, { params: { parkId: park.id } });
      if (response.data?.eplPrice != null) setEplPrice(response.data.eplPrice);
      if (response.data?.autoClosePrice != null) setAutoClosePrice(response.data.autoClosePrice);
      if (response.data?.photoControlEnabled !== undefined) setPhotoControlEnabled(!!response.data.photoControlEnabled);
      if (response.data?.photoControlPrice != null) setPhotoControlPrice(response.data.photoControlPrice);
      if (response.data?.photoControlValidDays != null) setPhotoControlValidDays(response.data.photoControlValidDays);
      if (response.data?.photoControlNotifyHoursBefore != null) setPhotoControlNotifyHoursBefore(response.data.photoControlNotifyHoursBefore);
      userChangedFCRef.current = false;
      showToast('Настройки парка сохранены', 'success');
      if (onSave) {
        onSave();
      }
      onClose();
    } catch (e) {
      console.error('Error saving settings:', e);
      const errorMessage = e.response?.data?.error || e.message || 'Неизвестная ошибка';
      
      // Если 404, возможно сервер не перезапущен
      if (e.response?.status === 404) {
        showToast(`Эндпоинт не найден. Перезапустите backend. ${errorMessage}`, 'error');
      } else {
        showToast(`Ошибка сохранения: ${errorMessage}`, 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  if (!park) return null;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={`Настройки парка: ${park.name}`}
        size="md"
        className="max-h-[95vh] sm:max-h-[90vh] !max-w-[calc(100vw-1rem)] sm:!max-w-2xl"
      >
        <div className="space-y-3 sm:space-y-4">
          {!canEditAnything && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              У директора нет выданных прав на редактирование блоков настроек этого парка.
            </div>
          )}
          {/* Статус парка - остаётся сверху без гармошки */}
          {access.statusName && (
          <div className="bg-slate-50 rounded-lg sm:rounded-xl p-3 sm:p-5 border border-slate-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 sm:p-2 bg-emerald-100 rounded-lg shrink-0">
                  <Power className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-600" />
                </div>
                <p className="text-xs sm:text-sm text-slate-600">
                  {isActive ? '✅ Парк активен' : '❌ Парк неактивен'}
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-teal-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>
            </div>
          </div>
          )}

          {/* Название парка */}
          {access.statusName && (
          <div className="bg-slate-50 rounded-lg sm:rounded-xl p-3 sm:p-5 border border-slate-200">
            <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">Название парка</label>
            <input
              type="text"
              value={parkName}
              onChange={(e) => setParkName(e.target.value)}
              placeholder="Введите название парка"
              className="w-full px-3 py-2.5 text-sm border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition bg-white"
            />
          </div>
          )}

          {/* Привязка к Такском - гармошка */}
          {access.takskom && (
          <SettingsAccordion title="Привязка к Такском" icon={Link2} iconBg="bg-violet-100 text-violet-600">
            {/* Индикатор синхронизации */}
            <div className="mb-4 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm">
              {takskornId && String(takskornId).trim() ? (
                <>
                  <CheckCircle className="h-5 w-5 shrink-0 text-emerald-600" />
                  <span className="text-slate-700">
                    Привязан к Такском
                    <span className="font-medium text-emerald-700"> (id: {takskornId})</span>
                    {carParks.find((p) => String(p.id) === String(takskornId))?.name && (
                      <span className="text-slate-600"> — {carParks.find((p) => String(p.id) === String(takskornId)).name}</span>
                    )}
                  </span>
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 shrink-0 text-slate-400" />
                  <span className="text-slate-500">Не привязан к Такском. Без привязки водители не смогут создавать ЭПЛ.</span>
                </>
              )}
            </div>

            <p className="text-xs sm:text-sm text-slate-500 mb-3">
              Один Такском-парк можно привязать к нескольким паркам на сайте.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                  ID автопарка в Такском
                </label>
                <input
                  type="text"
                  value={takskornId}
                  onChange={(e) => setTakskornId(e.target.value)}
                  placeholder="Например: 27"
                  className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-600 mb-1.5">
                  Или выбрать из списка (подтягивается по API)
                </label>
                <select
                  value={takskornId}
                  onChange={(e) => setTakskornId(e.target.value)}
                  disabled={carParksLoading}
                  className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 disabled:opacity-60"
                >
                  <option value="">— Не привязан —</option>
                  {carParks.map((p) => (
                    <option key={p.id} value={String(p.id)}>{p.name} (id: {p.id})</option>
                  ))}
                </select>
                {carParksLoading && <p className="text-xs text-slate-500 mt-1">Загрузка списка…</p>}
                {!carParksLoading && carParks.length === 0 && <p className="text-xs text-amber-600 mt-1">Список пуст. Проверьте токен Такском в настройках.</p>}
              </div>
            </div>
          </SettingsAccordion>
          )}

          {/* Персонал Такском */}
          {access.staff && (
          <SettingsAccordion title="Персонал Такском" icon={Users} iconBg="bg-teal-100 text-teal-600">
            <p className="text-xs sm:text-sm text-slate-600 mb-4">
              Логины и пароли сотрудников для автоматического входа в ЛК Такском при создании/подписи ЭПЛ.
              Если не заданы — будут использоваться глобальные настройки из .env.
            </p>
            {staffLoading ? (
              <div className="text-center py-4 text-slate-500 text-sm">Загрузка…</div>
            ) : (
              <div className="space-y-5">
                {STAFF_ROLES.map(({ role, label, icon: RoleIcon, color, bg }) => {
                  const s = staffList.find(st => st.role === role) || {};
                  const showPwd = showStaffPasswords[role];
                  return (
                    <div key={role} className="bg-white rounded-xl border border-slate-200 p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <div className={`p-1.5 ${bg} rounded-lg`}><RoleIcon className={`w-4 h-4 ${color}`} /></div>
                        <h4 className="font-bold text-sm text-slate-800">{label}</h4>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1">ФИО</label>
                          <input
                            type="text"
                            value={s.fullName || ''}
                            onChange={(e) => updateStaffField(role, 'fullName', e.target.value)}
                            placeholder="Иванов Иван Иванович"
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1">Должность</label>
                          <input
                            type="text"
                            value={s.position || ''}
                            onChange={(e) => updateStaffField(role, 'position', e.target.value)}
                            placeholder="Должность"
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1">Логин Такском (телефон)</label>
                          <input
                            type="text"
                            value={s.taxcomLogin || ''}
                            onChange={(e) => updateStaffField(role, 'taxcomLogin', e.target.value)}
                            placeholder="+79001234567"
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1">Пароль Такском</label>
                          <div className="relative">
                            <input
                              type={showPwd ? 'text' : 'password'}
                              value={s.taxcomPassword || ''}
                              onChange={(e) => updateStaffField(role, 'taxcomPassword', e.target.value)}
                              placeholder="••••••"
                              className="w-full px-3 py-2 pr-10 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                            />
                            <button
                              type="button"
                              onClick={() => setShowStaffPasswords(prev => ({ ...prev, [role]: !prev[role] }))}
                              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                            >
                              {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>
                      </div>
                      {role === 'medic' && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                          <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1">Серия лицензии</label>
                            <input type="text" value={s.licenseSerial || ''} onChange={(e) => updateStaffField(role, 'licenseSerial', e.target.value)} placeholder="" className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1">Номер лицензии</label>
                            <input type="text" value={s.licenseNumber || ''} onChange={(e) => updateStaffField(role, 'licenseNumber', e.target.value)} placeholder="" className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1">Дата начала действия</label>
                            <input
                              type="date"
                              value={s.licenseDateStart || ''}
                              onChange={(e) => updateStaffField(role, 'licenseDateStart', e.target.value)}
                              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1">Дата окончания действия</label>
                            <input
                              type="date"
                              value={s.licenseDateEnd || ''}
                              onChange={(e) => updateStaffField(role, 'licenseDateEnd', e.target.value)}
                              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                            />
                          </div>
                        </div>
                      )}
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleSaveStaff(s)}
                          disabled={staffSaving || !s.fullName?.trim() || !s.position?.trim()}
                          className="freight-btn-primary gap-1.5 text-xs rounded-lg disabled:opacity-50"
                        >
                          <Save className="w-3.5 h-3.5" />
                          {staffSaving ? 'Сохранение…' : 'Сохранить'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SettingsAccordion>
          )}

          {/* Режим печати ЭПЛ */}
          {access.takskom && (
          <SettingsAccordion title="Режим печати ЭПЛ" icon={FileText} iconBg="bg-teal-100 text-teal-600">
            <p className="text-xs sm:text-sm text-slate-600 mb-3">
              Какой PDF получает водитель при создании путевого листа. На каждый парк настраивается отдельно.
            </p>
            <div className="space-y-2 sm:space-y-3">
              {[
                { value: 'our_only', label: 'Только наш', desc: 'Водитель получает наш PDF сразу. Такском не используется — программа на ПК не создаёт ЭПЛ в ЛК Такском.' },
                { value: 'taxcom_only', label: 'Только Такском', desc: 'PDF только из Такском. Наш PDF не генерируется — водитель ждёт, пока программа на ПК создаст ЭПЛ в ЛК.' },
                { value: 'our_then_taxcom', label: 'Наш, затем Такском', desc: 'Сначала водитель получает наш PDF (мгновенно), затем программа на ПК создаёт ЭПЛ в Такском и при необходимости обновит документ.' },
              ].map((opt) => (
                <label key={opt.value} className="flex items-start gap-2 sm:gap-3 p-3 sm:p-4 border-2 rounded-lg sm:rounded-xl cursor-pointer transition-all hover:bg-teal-50 hover:border-teal-300">
                  <input
                    type="radio"
                    name="eplPrintMode"
                    value={opt.value}
                    checked={eplPrintMode === opt.value}
                    onChange={() => setEplPrintMode(opt.value)}
                    className="mt-0.5 sm:mt-1 w-4 h-4 text-teal-600 focus:ring-2 focus:ring-teal-500 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm sm:text-base text-slate-800">{opt.label}</div>
                    <div className="text-xs sm:text-sm text-slate-500 mt-0.5">{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </SettingsAccordion>
          )}

          {access.takskom && (
          <SettingsAccordion title="Кто может создавать ЭПЛ" icon={Users} iconBg="bg-indigo-100 text-indigo-600">
            <p className="text-xs sm:text-sm text-slate-600 mb-3">
              Базовый режим на весь парк. Точечно по водителям можно переопределить в карточке водителя.
            </p>
            <div className="space-y-2 sm:space-y-3">
              {[
                { value: 'all', label: 'Водитель + менеджер/директор', desc: 'Обычный режим: водитель может создавать ЭПЛ в приложении.' },
                { value: 'driver_only', label: 'Только водитель', desc: 'Создание ЭПЛ разрешено только водителям в приложении.' },
                { value: 'manager_director_only', label: 'Только менеджер/директор', desc: 'Создание ЭПЛ в приложении водителя блокируется.' },
              ].map((opt) => (
                <label key={opt.value} className="flex items-start gap-2 sm:gap-3 p-3 sm:p-4 border-2 rounded-lg sm:rounded-xl cursor-pointer transition-all hover:bg-indigo-50 hover:border-indigo-300">
                  <input
                    type="radio"
                    name="eplAccessMode"
                    value={opt.value}
                    checked={eplAccessMode === opt.value}
                    onChange={() => setEplAccessMode(opt.value)}
                    className="mt-0.5 sm:mt-1 w-4 h-4 text-indigo-600 focus:ring-2 focus:ring-indigo-500 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm sm:text-base text-slate-800">{opt.label}</div>
                    <div className="text-xs sm:text-sm text-slate-500 mt-0.5">{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </SettingsAccordion>
          )}

          {access.freight && (
          <SettingsAccordion title="Грузовой рейс: адреса" icon={Truck} iconBg="bg-slate-100 text-slate-700">
            <p className="text-xs sm:text-sm text-slate-600 mb-3">
              Место отправления, погрузка и точки выгрузки в путевом (Такском). Если выбрано «водитель» — при создании ЭПЛ он обязан передать адреса в теле запроса (несколько выгрузок — массив строк).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFreightAddressEntryMode('manager')}
                className={`p-3 rounded-xl border text-left hover:bg-slate-50 ${
                  freightAddressEntryMode === 'manager' ? 'border-teal-600 bg-teal-50' : 'border-slate-200 bg-white'
                }`}
              >
                <p className="text-sm font-bold text-slate-900">Вводит диспетчер / вручную в Такском</p>
                <p className="text-xs text-slate-600 mt-0.5">Водитель при создании ЭПЛ адреса не передаёт (как в классическом сценарии).</p>
              </button>
              <button
                type="button"
                onClick={() => setFreightAddressEntryMode('driver')}
                className={`p-3 rounded-xl border text-left hover:bg-slate-50 ${
                  freightAddressEntryMode === 'driver' ? 'border-teal-600 bg-teal-50' : 'border-slate-200 bg-white'
                }`}
              >
                <p className="text-sm font-bold text-slate-900">Вводит водитель</p>
                <p className="text-xs text-slate-600 mt-0.5">Обязательны поля: место отправления, погрузка, хотя бы одна выгрузка.</p>
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-3">
              Значения по умолчанию для отправления и погрузки (подставляются в приложение водителя; выгрузки — из справочника «Точки выгрузки» ниже).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
              <label className="block text-sm">
                <span className="font-medium text-slate-700">Отправление (по умолчанию)</span>
                <textarea
                  rows={2}
                  value={freightDefaultOriginAddress}
                  onChange={(e) => setFreightDefaultOriginAddress(e.target.value)}
                  placeholder="индекс, город, база…"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-700">Погрузка (по умолчанию)</span>
                <textarea
                  rows={2}
                  value={freightDefaultLoadAddress}
                  onChange={(e) => setFreightDefaultLoadAddress(e.target.value)}
                  placeholder="часто совпадает с отправлением"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
            </div>
          </SettingsAccordion>
          )}

          {access.freight && (
          <SettingsAccordion title="Точки выгрузки (магазины)" icon={Store} iconBg="bg-amber-100 text-amber-800">
            <FreightStoresTab parkId={park?.id} sceneNight={false} useAdminApi={isAdminApi} />
          </SettingsAccordion>
          )}

          {/* Рассылки */}
          {access.broadcasts && (
          <SettingsAccordion title="Рассылки" icon={Send} iconBg="bg-teal-100 text-teal-700">
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                Настройка влияет на то, кому будут приходить ответы водителей на рассылки (треды).
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setBroadcastRepliesRouting('park')}
                  className={`p-3 rounded-xl border text-left hover:bg-slate-50 ${
                    broadcastRepliesRouting === 'park' ? 'border-teal-600 bg-teal-50' : 'border-slate-200 bg-white'
                  }`}
                >
                  <p className="text-sm font-bold text-slate-900">Ответы в парк</p>
                  <p className="text-xs text-slate-600 mt-0.5">Все ответы видят менеджеры/директора парка в “Ответах”.</p>
                </button>
                <button
                  type="button"
                  onClick={() => setBroadcastRepliesRouting('sender')}
                  className={`p-3 rounded-xl border text-left hover:bg-slate-50 ${
                    broadcastRepliesRouting === 'sender' ? 'border-teal-600 bg-teal-50' : 'border-slate-200 bg-white'
                  }`}
                >
                  <p className="text-sm font-bold text-slate-900">Ответы отправителю</p>
                  <p className="text-xs text-slate-600 mt-0.5">Ответ уходит конкретному менеджеру/директору, кто отправил.</p>
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                Примечание: если отправителя уже нет/нет доступа — ответ всё равно будет виден в парке.
              </p>
            </div>
          </SettingsAccordion>
          )}

          {/* Организации (владельцы ТС) - гармошка */}
          {access.owners && (
          <SettingsAccordion title="Организации (владельцы ТС)" icon={Users} iconBg="bg-amber-100 text-amber-600">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
              <p className="text-xs sm:text-sm text-slate-600 flex-1">
                Юр. лица / ИП, которым принадлежат автомобили парка. При создании авто выбирается владелец — его реквизиты используются при заполнении ЭПЛ.
              </p>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={openImportModal}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs sm:text-sm font-semibold hover:bg-slate-200"
                  title="Скопировать из другого парка"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  Из другого парка
                </button>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => openOwnerModal()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs sm:text-sm font-semibold hover:bg-amber-700"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Добавить
                </motion.button>
              </div>
            </div>
            {ownersLoading ? (
              <p className="text-xs text-slate-400">Загрузка...</p>
            ) : owners.length === 0 ? (
              <p className="text-xs text-slate-400">Нет владельцев. Добавьте организацию.</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {owners.map(o => (
                  <div key={o.id} className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-slate-800 truncate">{o.name}</div>
                      <div className="text-xs text-slate-500 flex flex-wrap gap-x-3">
                        <span>{o.type === 'legal' ? 'ЮЛ' : 'ИП'}</span>
                        <span>{o.role === 'С' ? 'Собственник' : 'Арендодатель'}</span>
                        {o.inn && <span>ИНН: {o.inn}</span>}
                        {o.isDefault ? <span className="text-amber-600 font-semibold">По умолч.</span> : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      <button onClick={() => openOwnerModal(o)} className="p-1.5 hover:bg-slate-100 rounded-lg" title="Редактировать"><Pencil className="w-3.5 h-3.5 text-slate-500" /></button>
                      <button onClick={() => handleDeleteOwner(o.id)} className="p-1.5 hover:bg-red-50 rounded-lg" title="Удалить"><Trash className="w-3.5 h-3.5 text-red-400" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SettingsAccordion>
          )}

          {/* Порядок списания баланса - гармошка */}
          {access.balance && (
          <SettingsAccordion title="Порядок списания баланса" icon={Wallet} iconBg="bg-purple-100 text-purple-600">
            <p className="text-xs sm:text-sm text-slate-600 mb-3 sm:mb-4">
              Выберите порядок списания средств при покупке ЭПЛ и других операциях
            </p>
            <div className="space-y-2 sm:space-y-3">
              <label className="flex items-start gap-2 sm:gap-3 p-3 sm:p-4 border-2 rounded-lg sm:rounded-xl cursor-pointer transition-all hover:bg-purple-50 hover:border-purple-300">
                <input
                  type="radio"
                  name="balanceDeductionOrder"
                  value="real_first"
                  checked={balanceDeductionOrder === 'real_first'}
                  onChange={(e) => setBalanceDeductionOrder(e.target.value)}
                  className="mt-0.5 sm:mt-1 w-4 h-4 text-purple-600 focus:ring-2 focus:ring-purple-500 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm sm:text-base text-slate-800">Сначала реальные деньги</div>
                  <div className="text-xs sm:text-sm text-slate-600 mt-1">
                    При списании сначала используются реальные деньги, затем фантики
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-2 sm:gap-3 p-3 sm:p-4 border-2 rounded-lg sm:rounded-xl cursor-pointer transition-all hover:bg-purple-50 hover:border-purple-300">
                <input
                  type="radio"
                  name="balanceDeductionOrder"
                  value="unreal_first"
                  checked={balanceDeductionOrder === 'unreal_first'}
                  onChange={(e) => setBalanceDeductionOrder(e.target.value)}
                  className="mt-0.5 sm:mt-1 w-4 h-4 text-purple-600 focus:ring-2 focus:ring-purple-500 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm sm:text-base text-slate-800">Сначала фантики</div>
                  <div className="text-xs sm:text-sm text-slate-600 mt-1">
                    При списании сначала используются фантики, затем реальные деньги
                  </div>
                </div>
              </label>
            </div>
          </SettingsAccordion>
          )}

          {/* Цены для автопарка - гармошка */}
          {access.pricing && (
          <SettingsAccordion title="Цены для автопарка" icon={Banknote} iconBg="bg-emerald-100 text-emerald-600">
            <p className="text-xs sm:text-sm text-slate-600 mb-4">
              Установите цены на услуги для водителей этого парка. Водители разных парков могут платить разные суммы.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">Цена за ЭПЛ (₽)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={eplPrice}
                  onChange={(e) => setEplPrice(e.target.value)}
                  className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
                <p className="text-xs text-slate-500 mt-1">Списание при создании путевого листа</p>
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">Автозакрытие (₽)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={autoClosePrice}
                  onChange={(e) => setAutoClosePrice(e.target.value)}
                  className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
                <p className="text-xs text-slate-500 mt-1">Списание при авто-закрытии смены (12 ч)</p>
              </div>
            </div>
          </SettingsAccordion>
          )}

          {/* Настройки игры */}
          {access.game && (
          <SettingsAccordion title="Настройки игры" icon={Gamepad2} iconBg="bg-amber-100 text-amber-600">
            <p className="text-xs sm:text-sm text-slate-600 mb-4">
              Мини-игра для водителей: лидерборд по очкам и награды за места в ТОПе (бесплатные ЭПЛ или скидка).
            </p>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-white">
                <div>
                  <p className="font-semibold text-slate-800 text-sm">Включить игру для парка</p>
                  <p className="text-xs text-slate-500 mt-0.5">Если выключено, водители парка не увидят кнопку «Игра» в меню и предложение поиграть при создании ЭПЛ.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-3">
                  <input type="checkbox" checked={gameEnabled} onChange={(e) => setGameEnabled(e.target.checked)} className="sr-only peer" />
                  <div className="w-11 h-6 bg-slate-300 peer-focus:ring-4 peer-focus:ring-amber-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                </label>
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">Лидерборд по умолчанию</label>
                <select value={leaderboardDefault} onChange={(e) => setLeaderboardDefault(e.target.value)} className="w-full px-3 py-2 border-2 border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm">
                  <option value="day">День</option>
                  <option value="week">Неделя</option>
                  <option value="month">Месяц</option>
                </select>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-white">
                <div>
                  <p className="font-semibold text-slate-800 text-sm">Награждать за ТОП</p>
                  <p className="text-xs text-slate-500 mt-0.5">Включите, чтобы награждать водителей из лидерборда бесплатными ЭПЛ или скидкой на следующие ЭПЛ.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-3">
                  <input type="checkbox" checked={rewardsEnabled} onChange={(e) => setRewardsEnabled(e.target.checked)} className="sr-only peer" />
                  <div className="w-11 h-6 bg-slate-300 peer-focus:ring-4 peer-focus:ring-amber-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                </label>
              </div>
              {rewardsEnabled && (
                <div className="border-t border-slate-200 pt-4">
                  <p className="text-sm font-semibold text-slate-800 mb-2">Награды за места в ТОПе</p>
                  <p className="text-xs text-slate-500 mb-3">Укажите награду за каждую позицию в таблице лидеров (например: топ-1 — 3 бесплатных ЭПЛ, топ-2 — 1 ЭПЛ, топ-3 — скидка 10% на 2 ЭПЛ).</p>
                  <div className="space-y-3 max-h-60 overflow-y-auto">
                    {gameRewards.map((r, idx) => (
                      <div key={idx} className="flex flex-wrap items-start gap-2 p-3 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="flex-1 min-w-[120px]">
                          <label className="block text-xs font-medium text-slate-600 mb-1">Позиция</label>
                          <select value={r.position} onChange={(e) => setGameRewards(prev => prev.map((x, i) => i === idx ? { ...x, position: parseInt(e.target.value, 10) || 1 } : x))} className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded-lg">
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>Топ-{n}</option>)}
                          </select>
                        </div>
                        <div className="flex-1 min-w-[140px]">
                          <label className="block text-xs font-medium text-slate-600 mb-1">Тип награды</label>
                          <select value={r.rewardType} onChange={(e) => setGameRewards(prev => prev.map((x, i) => i === idx ? { ...x, rewardType: e.target.value } : x))} className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded-lg">
                            <option value="free_epl">Бесплатные ЭПЛ</option>
                            <option value="discount">Скидка на ЭПЛ</option>
                          </select>
                        </div>
                        {r.rewardType === 'free_epl' && (
                          <div className="min-w-[100px]">
                            <label className="block text-xs font-medium text-slate-600 mb-1">Кол-во ЭПЛ в подарок</label>
                            <input type="number" min="0" value={r.freeEplCount} onChange={(e) => setGameRewards(prev => prev.map((x, i) => i === idx ? { ...x, freeEplCount: parseInt(e.target.value, 10) || 0 } : x))} className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded-lg" />
                            <p className="text-xs text-slate-400 mt-0.5">Сколько бесплатных путевых листов за эту позицию в топе.</p>
                          </div>
                        )}
                        {r.rewardType === 'discount' && (
                          <>
                            <div className="min-w-[80px]">
                              <label className="block text-xs font-medium text-slate-600 mb-1">Скидка %</label>
                              <input type="number" min="0" max="100" value={r.discountPercent} onChange={(e) => setGameRewards(prev => prev.map((x, i) => i === idx ? { ...x, discountPercent: parseInt(e.target.value, 10) || 0 } : x))} className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded-lg" />
                            </div>
                            <div className="min-w-[100px]">
                              <label className="block text-xs font-medium text-slate-600 mb-1">На сколько ЭПЛ</label>
                              <input type="number" min="1" value={r.discountEplCount} onChange={(e) => setGameRewards(prev => prev.map((x, i) => i === idx ? { ...x, discountEplCount: parseInt(e.target.value, 10) || 1 } : x))} className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded-lg" />
                              <p className="text-xs text-slate-400 mt-0.5">На сколько следующих путевых действует скидка.</p>
                            </div>
                          </>
                        )}
                        <button type="button" onClick={() => setGameRewards(prev => prev.filter((_, i) => i !== idx))} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg shrink-0" title="Удалить"><Trash className="w-4 h-4" /></button>
                      </div>
                    ))}
                  </div>
                  <motion.button type="button" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => { const nextPos = gameRewards.length ? Math.min(10, Math.max(...gameRewards.map(x => x.position)) + 1) : 1; setGameRewards(prev => [...prev, { position: nextPos, rewardType: 'free_epl', freeEplCount: 1, discountPercent: 0, discountEplCount: 0 }]); }} className="mt-2 flex items-center gap-2 px-3 py-2 bg-amber-100 text-amber-800 rounded-lg text-sm font-semibold hover:bg-amber-200">
                    <Plus className="w-4 h-4" /> Добавить награду
                  </motion.button>
                </div>
              )}

              <div className="border-t border-slate-200 pt-4 mt-4">
                <p className="text-sm font-semibold text-slate-800 mb-2">Магазин игры (бусты)</p>
                <p className="text-xs text-slate-500 mb-3">Водители смогут покупать бусты в игре: за очки (собранные в заездах) или за реальные деньги с баланса.</p>
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <span className="text-xs font-medium text-slate-600">Оплата бустов:</span>
                  <div className="flex rounded-lg border-2 border-slate-200 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setGameShopCurrencyType('points')}
                      className={`px-3 py-2 text-sm font-medium transition ${gameShopCurrencyType === 'points' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >
                      Очки
                    </button>
                    <button
                      type="button"
                      onClick={() => setGameShopCurrencyType('real')}
                      className={`px-3 py-2 text-sm font-medium transition ${gameShopCurrencyType === 'real' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >
                      Реал (с баланса)
                    </button>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <span className="text-sm font-medium text-slate-800">Нитро</span>
                    <div className="flex items-center gap-2">
                      <input type="number" min="0" value={gameShopNitro} onChange={(e) => setGameShopNitro(e.target.value)} className="w-20 px-2 py-1.5 text-sm border border-slate-300 rounded-lg" />
                      <span className="text-xs text-slate-500">{gameShopCurrencyType === 'points' ? 'очков' : '₽'}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <span className="text-sm font-medium text-slate-800">Перепрыгивание</span>
                    <div className="flex items-center gap-2">
                      <input type="number" min="0" value={gameShopJump} onChange={(e) => setGameShopJump(e.target.value)} className="w-20 px-2 py-1.5 text-sm border border-slate-300 rounded-lg" />
                      <span className="text-xs text-slate-500">{gameShopCurrencyType === 'points' ? 'очков' : '₽'}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <span className="text-sm font-medium text-slate-800">Вторая жизнь</span>
                    <div className="flex items-center gap-2">
                      <input type="number" min="0" value={gameShopExtraLife} onChange={(e) => setGameShopExtraLife(e.target.value)} className="w-20 px-2 py-1.5 text-sm border border-slate-300 rounded-lg" />
                      <span className="text-xs text-slate-500">{gameShopCurrencyType === 'points' ? 'очков' : '₽'}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <span className="text-sm font-medium text-slate-800">Магнит (монеты)</span>
                    <div className="flex items-center gap-2">
                      <input type="number" min="0" value={gameShopMagnet} onChange={(e) => setGameShopMagnet(e.target.value)} className="w-20 px-2 py-1.5 text-sm border border-slate-300 rounded-lg" />
                      <span className="text-xs text-slate-500">{gameShopCurrencyType === 'points' ? 'очков' : '₽'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </SettingsAccordion>
          )}

          {/* Фотоконтроль — гармошка */}
          {access.photoControl && (
          <SettingsAccordion title="Фотоконтроль" icon={Camera} iconBg="bg-sky-100 text-sky-600">
            <p className="text-xs sm:text-sm text-slate-600 mb-4">
              Водители могут подавать заявки на фотоконтроль: загружают фото/видео авто по шагам, механик подтверждает дистанционно. По умолчанию для парка выключено.
            </p>
            <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-white mb-4">
              <div>
                <p className="font-semibold text-slate-800 text-sm">Включить фотоконтроль для парка</p>
                <p className="text-xs text-slate-500 mt-0.5">Водители увидят пункт «Фотоконтроль» в меню и смогут создавать заявки.</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-3">
                <input
                  type="checkbox"
                  checked={photoControlEnabled}
                  onChange={(e) => {
                    userChangedFCRef.current = true;
                    setPhotoControlEnabled(e.target.checked);
                  }}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-300 peer-focus:ring-4 peer-focus:ring-sky-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500"></div>
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">Стоимость (₽)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={photoControlPrice}
                  onChange={(e) => setPhotoControlPrice(e.target.value)}
                  className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                />
                <p className="text-xs text-slate-500 mt-1">Списание с баланса при создании заявки</p>
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">Действует (дней)</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={photoControlValidDays}
                  onChange={(e) => setPhotoControlValidDays(e.target.value)}
                  className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                />
                <p className="text-xs text-slate-500 mt-1">Срок действия ФК после подтверждения</p>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">Уведомление за (часов) до конца</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={photoControlNotifyHoursBefore}
                  onChange={(e) => setPhotoControlNotifyHoursBefore(e.target.value)}
                  className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border-2 border-slate-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 max-w-xs"
                />
                <p className="text-xs text-slate-500 mt-1">За сколько часов до окончания ФК уведомить водителя</p>
              </div>
            </div>
          </SettingsAccordion>
          )}

          {FEATURE_EVACUATOR_AND_COMMISSIONER && access.services && (
            <>
              {/* Эвакуатор */}
              <SettingsAccordion title="Эвакуатор" icon={Truck} iconBg="bg-orange-100 text-orange-600">
                <p className="text-xs sm:text-sm text-slate-600 mb-4">
                  Водители парка смогут создавать заявки на вызов эвакуатора. Цена создания заявки задаётся для каждого парка отдельно ниже.
                </p>
                <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-white mb-4">
                  <div>
                    <p className="font-semibold text-slate-800 text-sm">Показывать кнопку «Вызвать эвакуатор» водителям</p>
                    <p className="text-xs text-slate-500 mt-0.5">Водители увидят заявки от эвакуаторов, привязанных к этому парку.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-3">
                    <input type="checkbox" checked={evacuatorEnabled} onChange={(e) => setEvacuatorEnabled(e.target.checked)} className="sr-only peer" />
                    <div className="w-11 h-6 bg-slate-300 peer-focus:ring-4 peer-focus:ring-orange-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500"></div>
                  </label>
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">Цена создания заявки для парка (₽)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={evacuatorRequestPriceOverride}
                    onChange={(e) => setEvacuatorRequestPriceOverride(e.target.value)}
                    placeholder="Например 50"
                    className="w-full max-w-[200px] px-3 py-2 border-2 border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-sm"
                  />
                  <p className="text-xs text-slate-500 mt-1">Цена списания с водителя за создание одной заявки на эвакуатор</p>
                </div>
              </SettingsAccordion>

              {/* Аварийный комиссар */}
              <SettingsAccordion title="Комиссар" icon={ShieldAlert} iconBg="bg-orange-100 text-orange-600">
                <p className="text-xs sm:text-sm text-slate-600 mb-4">
                  Водители парка смогут создавать заявки при ДТП. Сервисный сбор с водителя и ставка комиссара списываются при подтверждении отклика.
                </p>
                <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-white mb-4">
                  <div>
                    <p className="font-semibold text-slate-800 text-sm">Показывать кнопку «Вызвать комиссара» водителям</p>
                    <p className="text-xs text-slate-500 mt-0.5">Комиссары увидят заявки только из парков, к которым привязаны.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-3">
                    <input type="checkbox" checked={commissionerEnabled} onChange={(e) => setCommissionerEnabled(e.target.checked)} className="sr-only peer" />
                    <div className="w-11 h-6 bg-slate-300 peer-focus:ring-4 peer-focus:ring-orange-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500"></div>
                  </label>
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">Цена создания заявки для парка (₽)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={commissionerRequestPriceOverride}
                    onChange={(e) => setCommissionerRequestPriceOverride(e.target.value)}
                    placeholder="Например 50"
                    className="w-full max-w-[200px] px-3 py-2 border-2 border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-sm"
                  />
                  <p className="text-xs text-slate-500 mt-1">Цена списания с водителя за создание одной заявки комиссару</p>
                </div>
              </SettingsAccordion>
            </>
          )}

          {/* Удалить парк */}
          {canDeletePark && (
          <div className="border-t border-slate-200 pt-4 mt-4">
            <div className="bg-red-50 border border-red-200 rounded-lg sm:rounded-xl p-4">
              <h3 className="text-sm font-bold text-red-800 mb-2">Опасная зона</h3>
              <p className="text-xs text-red-700 mb-3">
                Удаление парка необратимо. Будут удалены все данные парка: менеджеры, водители, авто, ЭПЛ, история баланса.
              </p>
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={async () => {
                  if (!park?.id) return;
                  const parkName = (park.name || 'Парк').trim();
                  const ok = window.confirm(
                    `Вы уверены, что хотите удалить парк «${parkName}»?\n\nБудут безвозвратно удалены все данные парка: менеджеры, водители, автомобили, путевые листы.`
                  );
                  if (!ok) return;
                  setDeleting(true);
                  try {
                    await api.delete(`${apiRoot}/parks/${park.id}`);
                    if (onSave) onSave();
                    onClose();
                  } catch (e) {
                    showToast(e.response?.data?.error || e.message || 'Ошибка удаления', 'error');
                  } finally {
                    setDeleting(false);
                  }
                }}
                disabled={saving || deleting}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" />
                {deleting ? 'Удаление...' : 'Удалить парк'}
              </motion.button>
            </div>
          </div>
          )}

          {/* Кнопки */}
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 pt-3 sm:pt-4 border-t border-slate-200">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onClose}
              disabled={deleting}
              className="w-full sm:flex-1 px-4 py-2.5 sm:py-3 bg-slate-100 text-slate-700 rounded-lg sm:rounded-xl hover:bg-slate-200 font-semibold text-sm sm:text-base transition disabled:opacity-50"
            >
              Отмена
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleSaveSettings}
              disabled={saving || deleting || !canEditAnything}
              className="w-full sm:flex-1 px-4 py-2.5 sm:py-3 bg-gradient-to-r from-teal-600 to-teal-700 text-white rounded-lg sm:rounded-xl hover:from-teal-700 hover:to-teal-800 font-semibold text-sm sm:text-base transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Сохранение...' : 'Сохранить'}
            </motion.button>
          </div>
        </div>
      </Modal>

      {/* Модалка импорта юр. лица из другого парка */}
      {importModalOpen && (
        <Modal isOpen onClose={() => setImportModalOpen(false)} title="Скопировать организацию из другого парка">
          <div className="space-y-3">
            <div className="sticky top-0 bg-white z-10 pb-2">
              <input
                value={allOwnersSearch}
                onChange={(e) => setAllOwnersSearch(e.target.value)}
                placeholder="Поиск по названию / ИНН / ОГРН / парку..."
                className="w-full px-3 py-2 text-sm border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Показаны организации из других парков. Нажмите «Выбрать» — и данные скопируются в текущий парк.
              </p>
            </div>

            <div className="space-y-3 max-h-[60vh] overflow-y-auto px-1">
            {allOwnersLoading ? (
              <p className="text-sm text-slate-400 text-center py-6">Загрузка...</p>
            ) : allOwners.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">Нет организаций в других парках.</p>
            ) : (
              (() => {
                const q = (allOwnersSearch || '').trim().toLowerCase();
                const filtered = !q
                  ? allOwners
                  : allOwners.filter((o) => {
                      const hay = [
                        o.name,
                        o.inn,
                        o.ogrn,
                        o.ogrnip,
                        o.kpp,
                        o.parkName,
                      ]
                        .filter(Boolean)
                        .join(' ')
                        .toLowerCase();
                      return hay.includes(q);
                    });

                const byPark = filtered.reduce((acc, o) => {
                  const key = o.parkName || 'Другие парки';
                  if (!acc[key]) acc[key] = [];
                  acc[key].push(o);
                  return acc;
                }, {});

                const parkNames = Object.keys(byPark).sort((a, b) => a.localeCompare(b, 'ru'));

                return parkNames.map((parkName) => {
                  const list = byPark[parkName]
                    .slice()
                    .sort((a, b) => {
                      const ta = a.type === 'legal' ? 0 : 1;
                      const tb = b.type === 'legal' ? 0 : 1;
                      if (ta !== tb) return ta - tb;
                      return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
                    });

                  return (
                    <div key={parkName} className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
                      <div className="px-3 py-2 bg-slate-100 border-b border-slate-200">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-700 truncate">{parkName}</div>
                            <div className="text-[11px] text-slate-500">{list.length} организаций</div>
                          </div>
                        </div>
                      </div>
                      <div className="p-2 space-y-2">
                        {list.map((o) => (
                          <button
                            key={o.id}
                            type="button"
                            onClick={() => handleImportOwner(o)}
                            className="w-full text-left flex items-start justify-between bg-white border border-slate-200 rounded-lg px-3 py-2.5 hover:bg-amber-50 hover:border-amber-300 transition"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-sm text-slate-800 truncate">{o.name}</div>
                              <div className="text-xs text-slate-500 flex flex-wrap gap-x-3 mt-0.5">
                                <span>{o.type === 'legal' ? 'ЮЛ' : 'ИП'}</span>
                                <span>{o.role === 'С' ? 'Собственник' : 'Арендодатель'}</span>
                                {o.inn && <span>ИНН: {o.inn}</span>}
                                {(o.ogrn || o.ogrnip) && (
                                  <span>
                                    {o.type === 'legal' ? 'ОГРН' : 'ОГРНИП'}: {o.type === 'legal' ? o.ogrn : o.ogrnip}
                                  </span>
                                )}
                                {o.kpp && <span>КПП: {o.kpp}</span>}
                              </div>
                            </div>
                            <span className="ml-2 text-xs text-amber-600 font-semibold shrink-0 mt-1">Выбрать</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                });
              })()
            )}
            </div>
          </div>
        </Modal>
      )}

      {/* Модалка добавления / редактирования владельца */}
      {ownerModalOpen && (
        <Modal isOpen onClose={() => setOwnerModalOpen(false)} title={editingOwner ? 'Редактирование владельца' : 'Добавить организацию'}>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto px-1">
            {/* Тип + Роль */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Тип</label>
                <select value={ownerForm.type} onChange={e => setOwnerForm(p => ({ ...p, type: e.target.value }))} className="w-full px-3 py-2 text-sm border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500">
                  <option value="legal">Юридическое лицо</option>
                  <option value="individual">ИП</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Роль</label>
                <select value={ownerForm.role} onChange={e => setOwnerForm(p => ({ ...p, role: e.target.value }))} className="w-full px-3 py-2 text-sm border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500">
                  <option value="С">Собственник</option>
                  <option value="А">Арендодатель</option>
                </select>
              </div>
            </div>

            {/* Наименование */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Наименование организации / ФИО ИП *</label>
              <input type="text" value={ownerForm.name} onChange={e => setOwnerForm(p => ({ ...p, name: e.target.value }))} placeholder='ООО "Ромашка" или Иванов Иван Иванович' className="w-full px-3 py-2 text-sm border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>

            {/* ИНН / ОГРН / КПП */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">ИНН</label>
                <input type="text" value={ownerForm.inn} onChange={e => setOwnerForm(p => ({ ...p, inn: e.target.value }))} placeholder="1234567890" className="w-full px-3 py-2 text-sm border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">{ownerForm.type === 'legal' ? 'ОГРН' : 'ОГРНИП'}</label>
                <input type="text" value={ownerForm.type === 'legal' ? ownerForm.ogrn : ownerForm.ogrnip} onChange={e => setOwnerForm(p => ownerForm.type === 'legal' ? { ...p, ogrn: e.target.value } : { ...p, ogrnip: e.target.value })} placeholder={ownerForm.type === 'legal' ? '1027700132195' : '304500116000157'} className="w-full px-3 py-2 text-sm border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
            </div>
            {ownerForm.type === 'legal' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">КПП</label>
                  <input type="text" value={ownerForm.kpp} onChange={e => setOwnerForm(p => ({ ...p, kpp: e.target.value }))} placeholder="770001001" className="w-full px-3 py-2 text-sm border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
                </div>
              </div>
            )}

            {/* Контакты */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Телефон</label>
                <input type="text" value={ownerForm.phone} onChange={e => setOwnerForm(p => ({ ...p, phone: e.target.value }))} placeholder="+7(999)999-99-99" className="w-full px-3 py-2 text-sm border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
                <input type="text" value={ownerForm.email} onChange={e => setOwnerForm(p => ({ ...p, email: e.target.value }))} placeholder="org@mail.ru" className="w-full px-3 py-2 text-sm border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
            </div>

            {/* Адрес */}
            <p className="text-xs font-bold text-slate-600 border-b pb-1">Адрес</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Индекс</label>
                <input type="text" value={ownerForm.postalIndex} onChange={e => setOwnerForm(p => ({ ...p, postalIndex: e.target.value }))} placeholder="117105" className="w-full px-3 py-2 text-sm border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Код региона</label>
                <input type="text" value={ownerForm.regionCode} onChange={e => setOwnerForm(p => ({ ...p, regionCode: e.target.value }))} placeholder="77" className="w-full px-3 py-2 text-sm border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Район</label>
                <input type="text" value={ownerForm.district} onChange={e => setOwnerForm(p => ({ ...p, district: e.target.value }))} className="w-full px-3 py-2 text-sm border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Город</label>
                <input type="text" value={ownerForm.city} onChange={e => setOwnerForm(p => ({ ...p, city: e.target.value }))} placeholder="Москва" className="w-full px-3 py-2 text-sm border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Нас. пункт</label>
                <input type="text" value={ownerForm.locality} onChange={e => setOwnerForm(p => ({ ...p, locality: e.target.value }))} className="w-full px-3 py-2 text-sm border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Улица</label>
                <input type="text" value={ownerForm.street} onChange={e => setOwnerForm(p => ({ ...p, street: e.target.value }))} placeholder="проезд Хлебозаводский" className="w-full px-3 py-2 text-sm border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Дом</label>
                <input type="text" value={ownerForm.house} onChange={e => setOwnerForm(p => ({ ...p, house: e.target.value }))} placeholder="7" className="w-full px-3 py-2 text-sm border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Корпус</label>
                <input type="text" value={ownerForm.housing} onChange={e => setOwnerForm(p => ({ ...p, housing: e.target.value }))} className="w-full px-3 py-2 text-sm border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Квартира</label>
                <input type="text" value={ownerForm.flat} onChange={e => setOwnerForm(p => ({ ...p, flat: e.target.value }))} className="w-full px-3 py-2 text-sm border-2 border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
            </div>

            {/* По умолчанию */}
            <label className="flex items-center gap-2 mt-2">
              <input type="checkbox" checked={ownerForm.isDefault} onChange={e => setOwnerForm(p => ({ ...p, isDefault: e.target.checked }))} className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500" />
              <span className="text-sm text-slate-700">Использовать по умолчанию</span>
            </label>

            {/* Кнопки */}
            <div className="flex gap-3 pt-2 border-t">
              <button onClick={() => setOwnerModalOpen(false)} className="flex-1 px-4 py-2 bg-slate-100 rounded-lg text-sm font-semibold hover:bg-slate-200">Отмена</button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleSaveOwner}
                disabled={ownerSaving}
                className="flex-1 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-semibold hover:bg-amber-700 disabled:opacity-50"
              >
                {ownerSaving ? 'Сохранение...' : (editingOwner ? 'Обновить' : 'Добавить')}
              </motion.button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
