import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, Search, XCircle } from 'lucide-react';
import api from '../../api';
import {
  approveShiftOpenRequest,
  cancelShiftPlan,
  getFreightStores,
  getDrivers,
  getShiftOpenRequests,
  getShiftPlans,
  rejectShiftOpenRequest,
  upsertShiftPlan,
} from '../../api/managerApi';

function statusLabel(status) {
  if (status === 'approved') return 'Принята';
  if (status === 'rejected') return 'Отклонена';
  return 'В ожидании';
}

function statusClass(status, night) {
  if (status === 'approved') return night ? 'bg-emerald-500/20 text-emerald-200' : 'bg-emerald-100 text-emerald-800';
  if (status === 'rejected') return night ? 'bg-rose-500/20 text-rose-200' : 'bg-rose-100 text-rose-800';
  return night ? 'bg-amber-500/20 text-amber-200' : 'bg-amber-100 text-amber-800';
}

function parseFreightTextList(value) {
  if (!value) return [];
  return String(value)
    .split(/\r?\n|;/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseFreightUnloadsJson(value) {
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((x) => String(x).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function uniqStrings(list) {
  const out = [];
  const seen = new Set();
  (list || []).forEach((item) => {
    const value = String(item || '').trim();
    if (!value) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(value);
  });
  return out;
}

export default function ShiftsCenter({
  role = 'manager',
  parkId = null,
  parkMeta = null,
  sceneNight = false,
  canManage = true,
}) {
  const isAdmin = role === 'admin';
  const todayLocal = new Date().toISOString().slice(0, 10);
  const [mode, setMode] = useState('requests');
  const [rows, setRows] = useState([]);
  const [plans, setPlans] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [plansLoading, setPlansLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [planBusyId, setPlanBusyId] = useState(null);
  const [search, setSearch] = useState('');
  const [planSearch, setPlanSearch] = useState('');
  const [status, setStatus] = useState('pending');
  const [planStatus, setPlanStatus] = useState('planned');
  const [planDate, setPlanDate] = useState(todayLocal);
  const [selectedParkId, setSelectedParkId] = useState(parkId || null);
  const [parks, setParks] = useState([]);
  const [planDriverUserId, setPlanDriverUserId] = useState('');
  const [planOdometer, setPlanOdometer] = useState('0');
  const [planNote, setPlanNote] = useState('');
  const [planCommercialShippingType, setPlanCommercialShippingType] = useState('ПГ');
  const [planFreightOriginAddress, setPlanFreightOriginAddress] = useState('');
  const [planFreightLoadAddress, setPlanFreightLoadAddress] = useState('');
  const [planFreightUnloadStoreIds, setPlanFreightUnloadStoreIds] = useState([]);
  const [planFreightUnloadExtra, setPlanFreightUnloadExtra] = useState('');
  const [freightStores, setFreightStores] = useState([]);
  const [freightStoresLoading, setFreightStoresLoading] = useState(false);
  const [approveFreightOriginAddress, setApproveFreightOriginAddress] = useState('');
  const [approveFreightLoadAddress, setApproveFreightLoadAddress] = useState('');
  const [approveFreightUnloadStoreIds, setApproveFreightUnloadStoreIds] = useState([]);
  const [approveFreightUnloadExtra, setApproveFreightUnloadExtra] = useState('');
  const [approveCommercialShippingType, setApproveCommercialShippingType] = useState('ПГ');
  const [error, setError] = useState('');
  const [actionModal, setActionModal] = useState(null); // { type: 'approve' | 'reject', row }
  const [modalReason, setModalReason] = useState('');
  const [modalBusy, setModalBusy] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    api.get('/admin/parks')
      .then((res) => setParks(Array.isArray(res.data) ? res.data : []))
      .catch(() => setParks([]));
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) setSelectedParkId(parkId || null);
  }, [isAdmin, parkId]);

  const activeParkMeta = useMemo(() => {
    if (isAdmin) return parks.find((p) => Number(p.id) === Number(selectedParkId)) || null;
    return parkMeta || null;
  }, [isAdmin, parkMeta, parks, selectedParkId]);

  const freightAddressRequired = activeParkMeta?.freightAddressEntryMode === 'driver';
  const routeAddressOptions = useMemo(() => uniqStrings([
    activeParkMeta?.freightDefaultOriginAddress,
    activeParkMeta?.freightDefaultLoadAddress,
    ...freightStores.map((s) => s.addressText),
  ]), [activeParkMeta, freightStores]);

  const unloadAddressesFromStoreIds = (ids) => {
    const byId = new Map((freightStores || []).map((s) => [Number(s.id), String(s.addressText || '').trim()]));
    return uniqStrings(
      (ids || [])
        .map((id) => byId.get(Number(id)))
        .filter(Boolean)
    );
  };

  const composeUnloadAddresses = (storeIds, extraText) => uniqStrings([
    ...unloadAddressesFromStoreIds(storeIds),
    ...parseFreightTextList(extraText),
  ]);

  const togglePlanStoreId = (id) => {
    setPlanFreightUnloadStoreIds((prev) => {
      const num = Number(id);
      if (!Number.isFinite(num)) return prev;
      return prev.includes(num) ? prev.filter((x) => x !== num) : [...prev, num];
    });
  };

  const toggleApproveStoreId = (id) => {
    setApproveFreightUnloadStoreIds((prev) => {
      const num = Number(id);
      if (!Number.isFinite(num)) return prev;
      return prev.includes(num) ? prev.filter((x) => x !== num) : [...prev, num];
    });
  };

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const params = {
        status,
        search: search.trim() || undefined,
      };
      if (isAdmin && selectedParkId) params.parkId = selectedParkId;
      const data = isAdmin
        ? (await api.get('/admin/shift-open-requests', { params })).data
        : await getShiftOpenRequests(params);
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setRows([]);
      setError(e.response?.data?.error || e.message || 'Не удалось загрузить заявки');
    } finally {
      setLoading(false);
    }
  };

  const loadPlans = async () => {
    try {
      setPlansLoading(true);
      const params = {
        date: planDate,
        status: planStatus,
        search: planSearch.trim() || undefined,
      };
      if (isAdmin && selectedParkId) params.parkId = selectedParkId;
      const data = isAdmin
        ? (await api.get('/admin/shift-plans', { params })).data
        : await getShiftPlans(params);
      setPlans(Array.isArray(data) ? data : []);
    } catch (e) {
      setPlans([]);
      setError(e.response?.data?.error || e.message || 'Не удалось загрузить планы смен');
    } finally {
      setPlansLoading(false);
    }
  };

  const loadDriversForPlanning = async () => {
    try {
      let rowsData = [];
      if (isAdmin) {
        if (!selectedParkId) {
          setDrivers([]);
          return;
        }
        const res = await api.get(`/admin/parks/${selectedParkId}/drivers`);
        rowsData = Array.isArray(res.data) ? res.data : [];
      } else {
        rowsData = await getDrivers(parkId || undefined);
      }
      setDrivers(Array.isArray(rowsData) ? rowsData : []);
    } catch (_) {
      setDrivers([]);
    }
  };

  useEffect(() => {
    if (mode === 'requests') load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, status, selectedParkId]);

  useEffect(() => {
    if (mode !== 'plans') return;
    loadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, planDate, planStatus, selectedParkId]);

  useEffect(() => {
    if (mode !== 'plans') return;
    loadDriversForPlanning();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, isAdmin, selectedParkId, parkId]);

  useEffect(() => {
    if (mode !== 'plans') return;
    setPlanFreightOriginAddress(String(activeParkMeta?.freightDefaultOriginAddress || '').trim());
    setPlanFreightLoadAddress(String(activeParkMeta?.freightDefaultLoadAddress || '').trim());
    setPlanFreightUnloadStoreIds([]);
    setPlanFreightUnloadExtra('');
  }, [mode, activeParkMeta?.id, activeParkMeta?.freightDefaultLoadAddress, activeParkMeta?.freightDefaultOriginAddress]);

  useEffect(() => {
    let cancelled = false;
    const canLoad = isAdmin ? !!selectedParkId : !!parkId;
    if (!canLoad) {
      setFreightStores([]);
      setFreightStoresLoading(false);
      return;
    }
    setFreightStoresLoading(true);
    const req = isAdmin
      ? api.get(`/admin/parks/${selectedParkId}/freight-stores`)
      : Promise.resolve().then(() => getFreightStores());
    req
      .then((res) => {
        if (cancelled) return;
        const rows = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
        setFreightStores(rows);
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
  }, [isAdmin, parkId, selectedParkId]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const s = [
        r.driverName,
        r.driverPhone,
        r.carRegNumber,
        r.parkName,
        r.message,
      ].map((x) => String(x || '').toLowerCase()).join(' ');
      return s.includes(q);
    });
  }, [rows, search]);

  const filteredPlans = useMemo(() => {
    const q = planSearch.trim().toLowerCase();
    if (!q) return plans;
    return plans.filter((r) => {
      const s = [
        r.driverName,
        r.driverPhone,
        r.carRegNumber,
        r.parkName,
        r.note,
      ].map((x) => String(x || '').toLowerCase()).join(' ');
      return s.includes(q);
    });
  }, [plans, planSearch]);

  const handleSavePlan = async () => {
    if (!canManage) return;
    const driverUserId = Number(planDriverUserId);
    const startOdometer = Number(planOdometer);
    if (!Number.isFinite(driverUserId) || driverUserId <= 0) {
      window.alert('Выберите водителя для плана смены.');
      return;
    }
    if (!planDate) {
      window.alert('Выберите дату смены.');
      return;
    }
    if (!Number.isFinite(startOdometer) || startOdometer < 0) {
      window.alert('Введите корректный стартовый одометр.');
      return;
    }
    const unloadAddresses = composeUnloadAddresses(planFreightUnloadStoreIds, planFreightUnloadExtra);
    if (freightAddressRequired) {
      const hasOrigin = String(planFreightOriginAddress || '').trim().length > 0;
      const hasLoad = String(planFreightLoadAddress || '').trim().length > 0;
      if (!hasOrigin || !hasLoad || unloadAddresses.length === 0) {
        window.alert('Для этого парка укажите отправление, погрузку и хотя бы одну точку выгрузки.');
        return;
      }
    }
    try {
      setPlanBusyId('create');
      const payload = {
        driverUserId,
        shiftDate: planDate,
        startOdometer,
        note: planNote.trim() || undefined,
        commercialShippingType: planCommercialShippingType || 'ПГ',
        freightOriginAddress: planFreightOriginAddress.trim() || undefined,
        freightLoadAddress: planFreightLoadAddress.trim() || undefined,
        freightUnloadAddresses: unloadAddresses,
      };
      if (isAdmin) payload.parkId = selectedParkId;
      if (isAdmin) {
        await api.post('/admin/shift-plans', payload);
      } else {
        await upsertShiftPlan(payload);
      }
      setPlanDriverUserId('');
      setPlanOdometer('0');
      setPlanNote('');
      setPlanCommercialShippingType('ПГ');
      setPlanFreightOriginAddress(String(activeParkMeta?.freightDefaultOriginAddress || '').trim());
      setPlanFreightLoadAddress(String(activeParkMeta?.freightDefaultLoadAddress || '').trim());
      setPlanFreightUnloadStoreIds([]);
      setPlanFreightUnloadExtra('');
      await loadPlans();
    } catch (e) {
      window.alert(e.response?.data?.error || e.message || 'Не удалось сохранить план смены');
    } finally {
      setPlanBusyId(null);
    }
  };

  const handleCancelPlan = async (row) => {
    if (!canManage || row.status !== 'planned') return;
    if (!window.confirm('Отменить план смены для водителя?')) return;
    try {
      setPlanBusyId(row.id);
      if (isAdmin) {
        await api.post(`/admin/shift-plans/${row.id}/cancel`);
      } else {
        await cancelShiftPlan(row.id);
      }
      await loadPlans();
    } catch (e) {
      window.alert(e.response?.data?.error || e.message || 'Не удалось отменить план');
    } finally {
      setPlanBusyId(null);
    }
  };

  const openApproveModal = (row) => {
    if (!canManage || row.status !== 'pending') return;
    const routeFromRequest = parseFreightUnloadsJson(row.freightUnloadAddresses);
    setModalReason('');
    setApproveCommercialShippingType(row.commercialShippingType || 'ПГ');
    setApproveFreightOriginAddress(
      String(row.freightOriginAddress || activeParkMeta?.freightDefaultOriginAddress || '').trim()
    );
    setApproveFreightLoadAddress(
      String(row.freightLoadAddress || activeParkMeta?.freightDefaultLoadAddress || '').trim()
    );
    setApproveFreightUnloadStoreIds([]);
    setApproveFreightUnloadExtra(routeFromRequest.join('\n'));
    setActionModal({ type: 'approve', row });
  };

  const openRejectModal = (row) => {
    if (!canManage || row.status !== 'pending') return;
    setModalReason('');
    setActionModal({ type: 'reject', row });
  };

  const closeModal = () => {
    setActionModal(null);
    setModalReason('');
    setApproveFreightUnloadStoreIds([]);
    setApproveFreightUnloadExtra('');
  };

  const handleApprove = async () => {
    if (!actionModal || actionModal.type !== 'approve') return;
    const row = actionModal.row;
    const unloadAddresses = composeUnloadAddresses(approveFreightUnloadStoreIds, approveFreightUnloadExtra);
    if (freightAddressRequired) {
      const hasOrigin = String(approveFreightOriginAddress || '').trim().length > 0;
      const hasLoad = String(approveFreightLoadAddress || '').trim().length > 0;
      if (!hasOrigin || !hasLoad || unloadAddresses.length === 0) {
        window.alert('Для этого парка укажите отправление, погрузку и хотя бы одну точку выгрузки.');
        return;
      }
    }
    const payload = {
      commercialShippingType: approveCommercialShippingType || row.commercialShippingType || 'ПГ',
      freightOriginAddress: String(approveFreightOriginAddress || '').trim() || undefined,
      freightLoadAddress: String(approveFreightLoadAddress || '').trim() || undefined,
      freightUnloadAddresses: unloadAddresses,
    };
    try {
      setBusyId(row.id);
      setModalBusy(true);
      if (isAdmin) {
        await api.post(`/admin/shift-open-requests/${row.id}/approve`, payload);
      } else {
        await approveShiftOpenRequest(row.id, payload);
      }
      closeModal();
      await load();
    } catch (e) {
      window.alert(e.response?.data?.error || e.message || 'Не удалось принять заявку');
    } finally {
      setBusyId(null);
      setModalBusy(false);
    }
  };

  const handleReject = async () => {
    if (!actionModal || actionModal.type !== 'reject') return;
    const row = actionModal.row;
    const reason = String(modalReason || '').trim();
    try {
      setBusyId(row.id);
      setModalBusy(true);
      if (isAdmin) {
        await api.post(`/admin/shift-open-requests/${row.id}/reject`, { reason });
      } else {
        await rejectShiftOpenRequest(row.id, { reason });
      }
      closeModal();
      await load();
    } catch (e) {
      window.alert(e.response?.data?.error || e.message || 'Не удалось отклонить заявку');
    } finally {
      setBusyId(null);
      setModalBusy(false);
    }
  };

  return (
    <section className={`rounded-2xl border p-4 sm:p-5 ${sceneNight ? 'border-white/15 bg-white/[0.06]' : 'border-slate-200 bg-white'}`}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className={`text-lg font-bold ${sceneNight ? 'text-slate-100' : 'text-slate-900'}`}>Смены</h2>
            <p className={`text-sm ${sceneNight ? 'text-slate-300' : 'text-slate-600'}`}>
              Заявки на открытие + планирование смен заранее
            </p>
          </div>
          {isAdmin && (
            <select
              value={selectedParkId || ''}
              onChange={(e) => setSelectedParkId(e.target.value ? Number(e.target.value) : null)}
              className={`rounded-xl border px-3 py-2 text-sm ${sceneNight ? 'border-white/20 bg-slate-900/60 text-slate-100' : 'border-slate-300 bg-white text-slate-700'}`}
            >
              <option value="">Все парки</option>
              {parks.map((p) => (
                <option key={p.id} value={p.id}>{p.name || `Парк #${p.id}`}</option>
              ))}
            </select>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode('requests')}
            className={`rounded-xl border px-3 py-2 text-sm font-semibold ${mode === 'requests'
              ? 'bg-indigo-600 text-white border-indigo-400'
              : sceneNight ? 'border-white/20 text-slate-100 hover:bg-white/[0.08]' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}
          >
            Заявки
          </button>
          <button
            type="button"
            onClick={() => setMode('plans')}
            className={`inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-sm font-semibold ${mode === 'plans'
              ? 'bg-emerald-600 text-white border-emerald-400'
              : sceneNight ? 'border-white/20 text-slate-100 hover:bg-white/[0.08]' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}
          >
            <CalendarClock className="h-4 w-4" />
            План смен
          </button>
        </div>

        {mode === 'requests' ? (
          <div className="flex flex-wrap gap-2">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={`rounded-xl border px-3 py-2 text-sm ${sceneNight ? 'border-white/20 bg-slate-900/60 text-slate-100' : 'border-slate-300 bg-white text-slate-700'}`}
            >
              <option value="pending">В ожидании</option>
              <option value="approved">Принятые</option>
              <option value="rejected">Отклоненные</option>
              <option value="all">Все</option>
            </select>
            <div className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 ${sceneNight ? 'border-white/20 bg-slate-900/60 text-slate-100' : 'border-slate-300 bg-white text-slate-700'}`}>
              <Search className="h-4 w-4 opacity-70" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по ФИО, телефону, авто"
                className="w-52 bg-transparent text-sm outline-none"
              />
            </div>
            <button
              type="button"
              onClick={load}
              className={`rounded-xl border px-3 py-2 text-sm font-semibold ${sceneNight ? 'border-white/20 text-slate-100 hover:bg-white/[0.08]' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}
            >
              Обновить
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <input
                type="date"
                value={planDate}
                onChange={(e) => setPlanDate(e.target.value)}
                className={`rounded-xl border px-3 py-2 text-sm ${sceneNight ? 'border-white/20 bg-slate-900/60 text-slate-100' : 'border-slate-300 bg-white text-slate-700'}`}
              />
              <select
                value={planStatus}
                onChange={(e) => setPlanStatus(e.target.value)}
                className={`rounded-xl border px-3 py-2 text-sm ${sceneNight ? 'border-white/20 bg-slate-900/60 text-slate-100' : 'border-slate-300 bg-white text-slate-700'}`}
              >
                <option value="planned">Запланированные</option>
                <option value="consumed">Использованные</option>
                <option value="cancelled">Отмененные</option>
                <option value="all">Все</option>
              </select>
              <div className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 ${sceneNight ? 'border-white/20 bg-slate-900/60 text-slate-100' : 'border-slate-300 bg-white text-slate-700'}`}>
                <Search className="h-4 w-4 opacity-70" />
                <input
                  value={planSearch}
                  onChange={(e) => setPlanSearch(e.target.value)}
                  placeholder="Поиск по планам"
                  className="w-52 bg-transparent text-sm outline-none"
                />
              </div>
              <button
                type="button"
                onClick={loadPlans}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold ${sceneNight ? 'border-white/20 text-slate-100 hover:bg-white/[0.08]' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}
              >
                Обновить
              </button>
            </div>
            {canManage && (
              <div className={`grid gap-2 rounded-xl border p-3 sm:grid-cols-2 lg:grid-cols-4 ${sceneNight ? 'border-white/15 bg-black/20' : 'border-slate-200 bg-slate-50/70'}`}>
                <select
                  value={planDriverUserId}
                  onChange={(e) => setPlanDriverUserId(e.target.value)}
                  className={`rounded-lg border px-2.5 py-2 text-sm ${sceneNight ? 'border-white/20 bg-slate-900 text-slate-100' : 'border-slate-300 bg-white text-slate-700'}`}
                >
                  <option value="">Выбери водителя</option>
                  {drivers.map((d) => (
                    <option key={d.userId || d.id} value={d.userId || d.id}>
                      {(d.fullName || d.phone || `Водитель #${d.userId || d.id}`)}{d.regNumber ? ` · ${d.regNumber}` : ''}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="0"
                  value={planOdometer}
                  onChange={(e) => setPlanOdometer(e.target.value)}
                  placeholder="Стартовый одометр"
                  className={`rounded-lg border px-2.5 py-2 text-sm ${sceneNight ? 'border-white/20 bg-slate-900 text-slate-100' : 'border-slate-300 bg-white text-slate-700'}`}
                />
                <input
                  value={planNote}
                  onChange={(e) => setPlanNote(e.target.value)}
                  placeholder="Комментарий (опц.)"
                  className={`rounded-lg border px-2.5 py-2 text-sm ${sceneNight ? 'border-white/20 bg-slate-900 text-slate-100' : 'border-slate-300 bg-white text-slate-700'}`}
                />
                <select
                  value={planCommercialShippingType}
                  onChange={(e) => setPlanCommercialShippingType(e.target.value)}
                  className={`rounded-lg border px-2.5 py-2 text-sm ${sceneNight ? 'border-white/20 bg-slate-900 text-slate-100' : 'border-slate-300 bg-white text-slate-700'}`}
                >
                  <option value="ПГ">ПГ — Перевозка грузов</option>
                  <option value="РП">РП — Регулярная перевозка</option>
                  <option value="ЗП">ЗП — Перевозка по заказу</option>
                  <option value="ТЛ">ТЛ — Легковое такси</option>
                  <option value="ОД">ОД — Перевозка детей</option>
                </select>
                <input
                  value={planFreightOriginAddress}
                  onChange={(e) => setPlanFreightOriginAddress(e.target.value)}
                  list="freight-route-address-options"
                  placeholder={freightAddressRequired ? 'Адрес отправления (обяз.)' : 'Адрес отправления (опц.)'}
                  className={`rounded-lg border px-2.5 py-2 text-sm ${sceneNight ? 'border-white/20 bg-slate-900 text-slate-100' : 'border-slate-300 bg-white text-slate-700'}`}
                />
                <input
                  value={planFreightLoadAddress}
                  onChange={(e) => setPlanFreightLoadAddress(e.target.value)}
                  list="freight-route-address-options"
                  placeholder={freightAddressRequired ? 'Адрес погрузки (обяз.)' : 'Адрес погрузки (опц.)'}
                  className={`rounded-lg border px-2.5 py-2 text-sm ${sceneNight ? 'border-white/20 bg-slate-900 text-slate-100' : 'border-slate-300 bg-white text-slate-700'}`}
                />
                <div className={`rounded-lg border px-2.5 py-2 ${sceneNight ? 'border-white/20 bg-slate-900 text-slate-100' : 'border-slate-300 bg-white text-slate-700'} sm:col-span-2 lg:col-span-2`}>
                  <p className="text-xs font-semibold">Выгрузка (рестораны/магазины)</p>
                  {freightStoresLoading ? (
                    <p className={`mt-1 text-xs ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>Загрузка точек…</p>
                  ) : freightStores.length === 0 ? (
                    <p className={`mt-1 text-xs ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>Список точек пуст — можно добавить вручную ниже.</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {freightStores.map((store) => {
                        const on = planFreightUnloadStoreIds.includes(Number(store.id));
                        return (
                          <button
                            key={store.id}
                            type="button"
                            onClick={() => togglePlanStoreId(store.id)}
                            className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                              on
                                ? sceneNight
                                  ? 'border-teal-400/70 bg-teal-500/30 text-teal-50'
                                  : 'border-teal-500 bg-teal-50 text-teal-900'
                                : sceneNight
                                  ? 'border-white/20 bg-white/5 text-slate-200 hover:bg-white/10'
                                  : 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100'
                            }`}
                            title={store.addressText || store.name}
                          >
                            {store.name || `Точка #${store.id}`}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <input
                    value={planFreightUnloadExtra}
                    onChange={(e) => setPlanFreightUnloadExtra(e.target.value)}
                    placeholder="Доп. выгрузка (через ; или новая строка)"
                    className={`mt-2 w-full rounded-lg border px-2.5 py-2 text-sm ${sceneNight ? 'border-white/20 bg-slate-800 text-slate-100 placeholder:text-slate-500' : 'border-slate-300 bg-white text-slate-700 placeholder:text-slate-400'}`}
                  />
                </div>
                <button
                  type="button"
                  disabled={planBusyId === 'create'}
                  onClick={handleSavePlan}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 sm:col-span-2 lg:col-span-4"
                >
                  {planBusyId === 'create' ? 'Сохраняем...' : 'Запланировать смену'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <datalist id="freight-route-address-options">
        {routeAddressOptions.map((addr) => (
          <option key={addr} value={addr} />
        ))}
      </datalist>

      {error && (
        <div className="mt-3 rounded-xl border border-rose-300/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="mt-4 space-y-2">
        {mode === 'requests' ? (loading ? (
          <div className={`rounded-xl border px-4 py-8 text-center text-sm ${sceneNight ? 'border-white/15 text-slate-300' : 'border-slate-200 text-slate-500'}`}>
            Загрузка заявок...
          </div>
        ) : filteredRows.length === 0 ? (
          <div className={`rounded-xl border px-4 py-8 text-center text-sm ${sceneNight ? 'border-white/15 text-slate-300' : 'border-slate-200 text-slate-500'}`}>
            Заявок не найдено
          </div>
        ) : (
          filteredRows.map((row) => (
            <article
              key={row.id}
              className={`rounded-xl border p-3 ${sceneNight ? 'border-white/15 bg-black/20' : 'border-slate-200 bg-slate-50/70'}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className={`text-sm font-semibold ${sceneNight ? 'text-slate-100' : 'text-slate-900'}`}>
                    {row.driverName || row.driverPhone || `Водитель #${row.driverUserId}`}
                  </div>
                  <div className={`text-xs ${sceneNight ? 'text-slate-300' : 'text-slate-600'}`}>
                    {row.driverPhone || 'без телефона'}{row.carRegNumber ? ` · ${row.carRegNumber}` : ''}{row.parkName ? ` · ${row.parkName}` : ''}
                  </div>
                </div>
                <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${statusClass(row.status, sceneNight)}`}>
                  {statusLabel(row.status)}
                </span>
              </div>
              {row.message && (
                <p className={`mt-2 text-sm ${sceneNight ? 'text-slate-200' : 'text-slate-700'}`}>{row.message}</p>
              )}
              <div className={`mt-2 text-xs ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>
                Одометр: {row.startOdometer ?? '—'} · Создана: {row.createdAt || '—'}
              </div>
              {row.status === 'rejected' && row.rejectionReason && (
                <div className={`mt-2 text-xs ${sceneNight ? 'text-rose-200' : 'text-rose-700'}`}>Причина: {row.rejectionReason}</div>
              )}
              {row.status === 'approved' && (
                <div className={`mt-2 text-xs ${sceneNight ? 'text-emerald-200' : 'text-emerald-700'}`}>
                  Путевой: {row.resultWaybillNumber || (row.resultEplId ? `#${row.resultEplId}` : 'создан')}
                </div>
              )}
              {canManage && row.status === 'pending' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => openApproveModal(row)}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Открыть смену
                  </button>
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => openRejectModal(row)}
                    className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Отклонить
                  </button>
                </div>
              )}
            </article>
          ))
        )) : (plansLoading ? (
          <div className={`rounded-xl border px-4 py-8 text-center text-sm ${sceneNight ? 'border-white/15 text-slate-300' : 'border-slate-200 text-slate-500'}`}>
            Загрузка планов смен...
          </div>
        ) : filteredPlans.length === 0 ? (
          <div className={`rounded-xl border px-4 py-8 text-center text-sm ${sceneNight ? 'border-white/15 text-slate-300' : 'border-slate-200 text-slate-500'}`}>
            Планов на выбранную дату не найдено
          </div>
        ) : (
          filteredPlans.map((row) => (
            <article
              key={`plan-${row.id}`}
              className={`rounded-xl border p-3 ${sceneNight ? 'border-white/15 bg-black/20' : 'border-slate-200 bg-slate-50/70'}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className={`text-sm font-semibold ${sceneNight ? 'text-slate-100' : 'text-slate-900'}`}>
                    {row.driverName || row.driverPhone || `Водитель #${row.driverUserId}`}
                  </div>
                  <div className={`text-xs ${sceneNight ? 'text-slate-300' : 'text-slate-600'}`}>
                    {row.driverPhone || 'без телефона'}{row.carRegNumber ? ` · ${row.carRegNumber}` : ''}{row.parkName ? ` · ${row.parkName}` : ''}
                  </div>
                </div>
                <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${statusClass(
                  row.status === 'planned' ? 'pending' : row.status === 'consumed' ? 'approved' : 'rejected',
                  sceneNight
                )}`}>
                  {row.status === 'planned' ? 'Запланирована' : row.status === 'consumed' ? 'Использована' : 'Отменена'}
                </span>
              </div>
              <div className={`mt-2 text-xs ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>
                Дата: {row.shiftDate || '—'} · Одометр: {row.startOdometer ?? '—'}
              </div>
              {row.note && (
                <div className={`mt-2 text-xs ${sceneNight ? 'text-slate-300' : 'text-slate-600'}`}>{row.note}</div>
              )}
              {(row.freightOriginAddress || row.freightLoadAddress || row.freightUnloadAddresses) && (
                <div className={`mt-2 text-xs ${sceneNight ? 'text-slate-300' : 'text-slate-600'}`}>
                  {(() => {
                    const unloadChain = parseFreightUnloadsJson(row.freightUnloadAddresses);
                    return (
                      <>
                  Маршрут: {row.freightOriginAddress || '—'} → {row.freightLoadAddress || '—'}
                  {unloadChain.length > 0 ? ` → ${unloadChain.join(' → ')}` : ''}
                      </>
                    );
                  })()}
                </div>
              )}
              {row.status === 'consumed' && (
                <div className={`mt-2 text-xs ${sceneNight ? 'text-emerald-200' : 'text-emerald-700'}`}>
                  Путевой: {row.consumedWaybillNumber || (row.consumedByEplId ? `#${row.consumedByEplId}` : 'создан')}
                </div>
              )}
              {canManage && row.status === 'planned' && (
                <div className="mt-3">
                  <button
                    type="button"
                    disabled={planBusyId === row.id}
                    onClick={() => handleCancelPlan(row)}
                    className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Отменить план
                  </button>
                </div>
              )}
            </article>
          ))
        ))}
      </div>

      {actionModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 px-3">
          <div className={`w-full max-w-md rounded-2xl border p-4 sm:p-5 ${sceneNight ? 'border-white/15 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-900'}`}>
            <h3 className="text-base font-bold">
              {actionModal.type === 'approve' ? 'Открыть смену' : 'Отклонить заявку'}
            </h3>
            <p className={`mt-1 text-sm ${sceneNight ? 'text-slate-300' : 'text-slate-600'}`}>
              {actionModal.row.driverName || actionModal.row.driverPhone || `Водитель #${actionModal.row.driverUserId}`}
              {actionModal.row.carRegNumber ? ` · ${actionModal.row.carRegNumber}` : ''}
            </p>

            {actionModal.type === 'approve' ? (
              <div className="mt-4 space-y-2">
                <div className={`rounded-xl border px-3 py-2 text-sm ${sceneNight ? 'border-white/20 bg-slate-800 text-slate-200' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                  Пробег будет взят из заявки водителя: <span className="font-semibold">{actionModal.row.startOdometer ?? 0} км</span>
                </div>
                <select
                  value={approveCommercialShippingType}
                  onChange={(e) => setApproveCommercialShippingType(e.target.value)}
                  className={`w-full rounded-xl border px-3 py-2 text-sm ${sceneNight ? 'border-white/20 bg-slate-800 text-slate-100' : 'border-slate-300 bg-white text-slate-700'}`}
                >
                  <option value="ПГ">ПГ — Перевозка грузов</option>
                  <option value="РП">РП — Регулярная перевозка</option>
                  <option value="ЗП">ЗП — Перевозка по заказу</option>
                  <option value="ТЛ">ТЛ — Легковое такси</option>
                  <option value="ОД">ОД — Перевозка детей</option>
                </select>
                <input
                  value={approveFreightOriginAddress}
                  onChange={(e) => setApproveFreightOriginAddress(e.target.value)}
                  list="freight-route-address-options"
                  placeholder={freightAddressRequired ? 'Адрес отправления (обяз.)' : 'Адрес отправления (опц.)'}
                  className={`w-full rounded-xl border px-3 py-2 text-sm ${sceneNight ? 'border-white/20 bg-slate-800 text-slate-100 placeholder:text-slate-500' : 'border-slate-300 bg-white text-slate-700 placeholder:text-slate-400'}`}
                />
                <input
                  value={approveFreightLoadAddress}
                  onChange={(e) => setApproveFreightLoadAddress(e.target.value)}
                  list="freight-route-address-options"
                  placeholder={freightAddressRequired ? 'Адрес погрузки (обяз.)' : 'Адрес погрузки (опц.)'}
                  className={`w-full rounded-xl border px-3 py-2 text-sm ${sceneNight ? 'border-white/20 bg-slate-800 text-slate-100 placeholder:text-slate-500' : 'border-slate-300 bg-white text-slate-700 placeholder:text-slate-400'}`}
                />
                <div className={`rounded-xl border px-3 py-2 ${sceneNight ? 'border-white/20 bg-slate-800 text-slate-100' : 'border-slate-300 bg-white text-slate-700'}`}>
                  <p className="text-xs font-semibold">Выгрузка (кнопки из справочника)</p>
                  {freightStoresLoading ? (
                    <p className={`mt-1 text-xs ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>Загрузка точек…</p>
                  ) : freightStores.length === 0 ? (
                    <p className={`mt-1 text-xs ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>Справочник пуст — добавьте вручную ниже.</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {freightStores.map((store) => {
                        const on = approveFreightUnloadStoreIds.includes(Number(store.id));
                        return (
                          <button
                            key={`approve-store-${store.id}`}
                            type="button"
                            onClick={() => toggleApproveStoreId(store.id)}
                            className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                              on
                                ? sceneNight
                                  ? 'border-teal-400/70 bg-teal-500/30 text-teal-50'
                                  : 'border-teal-500 bg-teal-50 text-teal-900'
                                : sceneNight
                                  ? 'border-white/20 bg-white/5 text-slate-200 hover:bg-white/10'
                                  : 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100'
                            }`}
                            title={store.addressText || store.name}
                          >
                            {store.name || `Точка #${store.id}`}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <input
                    value={approveFreightUnloadExtra}
                    onChange={(e) => setApproveFreightUnloadExtra(e.target.value)}
                    placeholder="Доп. выгрузки: через ; или новая строка"
                    className={`mt-2 w-full rounded-lg border px-2.5 py-2 text-sm ${sceneNight ? 'border-white/20 bg-slate-900 text-slate-100 placeholder:text-slate-500' : 'border-slate-300 bg-white text-slate-700 placeholder:text-slate-400'}`}
                  />
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                <label className={`block text-xs font-semibold ${sceneNight ? 'text-slate-300' : 'text-slate-700'}`}>
                  Причина отклонения (опционально)
                </label>
                <textarea
                  value={modalReason}
                  onChange={(e) => setModalReason(e.target.value)}
                  rows={3}
                  placeholder="Например: уточните одометр или привяжите авто"
                  className={`w-full rounded-xl border px-3 py-2 text-sm ${sceneNight ? 'border-white/20 bg-slate-800 text-slate-100 placeholder:text-slate-500' : 'border-slate-300 bg-white text-slate-800 placeholder:text-slate-400'}`}
                />
              </div>
            )}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                disabled={modalBusy}
                className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${sceneNight ? 'border-white/20 text-slate-200 hover:bg-white/[0.08]' : 'border-slate-300 text-slate-700 hover:bg-slate-50'} disabled:opacity-60`}
              >
                Отмена
              </button>
              {actionModal.type === 'approve' ? (
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={modalBusy}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {modalBusy ? 'Открываем...' : 'Подтвердить и открыть'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={modalBusy}
                  className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                >
                  {modalBusy ? 'Отклоняем...' : 'Подтвердить отклонение'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
