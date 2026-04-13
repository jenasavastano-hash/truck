import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  CheckCircle2,
  Clock,
  XCircle,
  Filter,
  Search,
} from 'lucide-react';
import {
  getEplList,
  completeEplWithoutDriver,
  requeueEplQr,
  requeueEplCreation,
  closeShiftByManager,
  closeShiftWithChargeByManager,
  downloadEplFastPdf,
  downloadEplMintransPdf,
  getEplMintransQr,
} from '../../api/managerApi';
import Card from '../ui/Card';
import { useToast } from '../../hooks/useToast';
import Skeleton from '../ui/Skeleton';
import { formatDateMsk } from '../../utils/dateFormatter';
import Modal from '../ui/Modal';
import TitulBadges from '../TitulBadges';

const FILTER_DEBOUNCE_MS = 380;

const GROUPS = [
  { id: 'open', label: 'Открытые', uiGroup: 'current_open' },
  { id: 'no_official', label: 'Без оф. ЭПЛ', uiGroup: 'no_official_epl' },
  { id: 'no_qr', label: 'Без QR Минтранса', uiGroup: 'no_mintrans_qr' },
  { id: 'closed', label: 'Закрытые', uiGroup: 'closed' },
];

export default function EplTab({ permissions = {}, embedded = false, sceneNight = false }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [completingId, setCompletingId] = useState(null);
  const [group, setGroup] = useState('open');
  const [filters, setFilters] = useState({
    waybillNumber: '',
    driverName: '',
    regNumber: '',
    status: 'all', // all | pending | submitted | failed
  });
  const filterDebounceRef = useRef(null);
  const textFiltersFirstRun = useRef(true);
  const [requeueId, setRequeueId] = useState(null);
  const [selectedEpl, setSelectedEpl] = useState(null);
  const [closingShiftId, setClosingShiftId] = useState(null);
  const [chargeModalEpl, setChargeModalEpl] = useState(null);
  const [chargeAmount, setChargeAmount] = useState('');
  const [chargeComment, setChargeComment] = useState('');
  const { showToast } = useToast();

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group]);

  useEffect(() => {
    if (textFiltersFirstRun.current) {
      textFiltersFirstRun.current = false;
      return;
    }
    if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    filterDebounceRef.current = setTimeout(() => {
      filterDebounceRef.current = null;
      load({ ...filters });
    }, FILTER_DEBOUNCE_MS);
    return () => {
      if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.waybillNumber, filters.driverName, filters.regNumber]);

  useEffect(() => {
    // мгновенно по статусу
    load({ ...filters });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status]);

  const load = async (overrideFilters = null) => {
    try {
      setLoading(true);
      const f = overrideFilters || filters;
      const groupParam = group === 'closed' ? null : (GROUPS.find((g) => g.id === group)?.uiGroup || null);
      const data = await getEplList(null, {
        ...(groupParam ? { group: groupParam } : {}),
        ...(f.waybillNumber?.trim() ? { waybillNumber: f.waybillNumber.trim() } : {}),
        ...(f.driverName?.trim() ? { driverName: f.driverName.trim() } : {}),
        ...(f.regNumber?.trim() ? { regNumber: f.regNumber.trim() } : {}),
      });
      let arr = Array.isArray(data) ? data : [];
      if (group === 'closed') {
        arr = arr.filter((x) => x?.uiGroup === 'closed' || x?.uiGroup === 'auto_closed');
      }
      if (f.status && f.status !== 'all') {
        if (f.status === 'only_fast_pdf') arr = arr.filter((x) => !!x.hasFastDoc && !x.hasOfficialDoc);
        else if (f.status === 'no_mintrans_qr') arr = arr.filter((x) => !!x.hasOfficialDoc && !x.hasMintransQr);
        else if (f.status === 'awaiting_taxcom') arr = arr.filter((x) => String(x.status || x.eplStatus || '') === 'pending');
        else arr = arr.filter((x) => String(x.status || x.eplStatus || '') === String(f.status));
      }
      setList(arr);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка загрузки списка ЭПЛ');
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteWithoutDriver = async (eplId) => {
    if (
      !window.confirm(
        'Завершить рейс без водителя? Пробег при заезде подставится автоматически (начальный + 50 км).'
      )
    ) {
      return;
    }
    try {
      setCompletingId(eplId);
      await completeEplWithoutDriver(eplId);
      await load();
      showToast('✅ Рейс успешно завершен', 'success');
    } catch (err) {
      showToast(
        `❌ Ошибка: ${
          err.response?.data?.error ||
          err.response?.data?.details ||
          'Не удалось завершить рейс'
        }`,
        'error'
      );
    } finally {
      setCompletingId(null);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'submitted':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold">
            <CheckCircle2 className="w-3 h-3" />
            Завершён
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-700 rounded-lg text-xs font-semibold">
            <Clock className="w-3 h-3" />
            На подписании
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded-lg text-xs font-semibold">
            <XCircle className="w-3 h-3" />
            Ошибка
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold">
            {status || '—'}
          </span>
        );
    }
  };

  const canControlQueue = !!permissions.canControlEplQueue;

  const handleRequeueQr = async (eplId) => {
    try {
      setRequeueId(eplId);
      await requeueEplQr(eplId);
      showToast('✅ Запрос на QR Минтранса отправлен', 'success');
    } catch (err) {
      showToast(
        `❌ Ошибка при запросе QR Минтранса: ${
          err.response?.data?.error || err.message || 'Не удалось отправить запрос'
        }`,
        'error'
      );
    } finally {
      setRequeueId(null);
    }
  };

  const handleRequeueCreation = async (eplId) => {
    try {
      setRequeueId(eplId);
      await requeueEplCreation(eplId);
      showToast('✅ ЭПЛ отправлен в очередь на создание в Такском', 'success');
    } catch (err) {
      showToast(
        `❌ Ошибка при отправке в очередь Минтранса: ${
          err.response?.data?.error || err.message || 'Не удалось отправить запрос'
        }`,
        'error'
      );
    } finally {
      setRequeueId(null);
    }
  };

  const handleCloseShift = async (eplId) => {
    if (
      !window.confirm(
        'Закрыть смену водителю по этому ЭПЛ без списания денег? После этого можно будет создать новый путевой.'
      )
    ) {
      return;
    }
    try {
      setClosingShiftId(eplId);
      await closeShiftByManager(eplId);
      showToast('✅ Смена закрыта. ЭПЛ помечен как закрытый.', 'success');
      await load();
    } catch (err) {
      showToast(
        `❌ Ошибка при закрытии смены: ${
          err.response?.data?.error || err.message || 'Не удалось закрыть смену'
        }`,
        'error'
      );
    } finally {
      setClosingShiftId(null);
    }
  };

  const handleCloseShiftWithCharge = (epl) => {
    setChargeModalEpl(epl);
    setChargeAmount('');
    setChargeComment('');
  };

  const handleSubmitChargeClose = async () => {
    if (!chargeModalEpl) return;
    const sum = Number(chargeAmount);
    if (!sum || Number.isNaN(sum) || sum <= 0) {
      showToast('❌ Введите корректную сумму списания (> 0)', 'error');
      return;
    }
    try {
      setClosingShiftId(chargeModalEpl.id);
      await closeShiftWithChargeByManager(chargeModalEpl.id, sum, chargeComment);
      showToast('✅ Смена закрыта со списанием средств.', 'success');
      setChargeModalEpl(null);
      await load();
    } catch (err) {
      showToast(
        `❌ Ошибка при закрытии смены со списанием: ${
          err.response?.data?.error || err.message || 'Не удалось закрыть смену'
        }`,
        'error'
      );
    } finally {
      setClosingShiftId(null);
    }
  };

  const openPdfFromResponse = (res, filenameFallback, successMessage) => {
    const blob = res.data;
    const cd = res?.headers?.['content-disposition'] || res?.headers?.['Content-Disposition'] || '';
    const m = String(cd).match(/filename\*=UTF-8''([^;]+)|filename=\"?([^\";]+)\"?/i);
    const filename = m ? decodeURIComponent(m[1] || m[2] || '') : filenameFallback;
    const ct = String(res?.headers?.['content-type'] || res?.headers?.['Content-Type'] || blob?.type || '').toLowerCase();
    if (ct && !ct.includes('pdf')) {
      showToast('❌ Сервер вернул не PDF (проверь доступ/готовность документа).', 'error');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || filenameFallback || 'document.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    if (successMessage) {
      showToast(successMessage, 'success');
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6">
          <Skeleton width="300px" height={32} className="mb-4" />
          <Skeleton width="200px" height={20} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="bg-white rounded-xl shadow-md border border-slate-200 p-5"
            >
              <Skeleton
                width="60%"
                height={24}
                className="mb-3"
              />
              <Skeleton
                width="100%"
                height={80}
                rounded="rounded-lg"
                className="mb-3"
              />
              <Skeleton
                width="100%"
                height={40}
                rounded="rounded-xl"
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4 text-red-700">
        Ошибка: {error}
      </div>
    );
  }

  const hasAnyEpl = Array.isArray(list) && list.length > 0;

  return (
    <div className="space-y-6">
      {!embedded && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full shadow-sm ${
              sceneNight
                ? 'border border-white/12 bg-white/[0.06] backdrop-blur-md text-slate-100 ring-1 ring-white/10'
                : 'bg-white shadow-slate-900/15'
            }`}
          >
            <FileText className={`w-5 h-5 ${sceneNight ? 'text-sky-300' : 'text-sky-500'}`} />
            <h2
              className={`text-sm sm:text-base font-bold tracking-wide uppercase ${
                sceneNight ? 'text-slate-100' : 'text-slate-900'
              }`}
            >
              Путевые листы
            </h2>
          </div>
          <div
            className={`flex items-center gap-2 text-xs sm:text-sm rounded-full px-3 py-1 shadow-sm ${
              sceneNight
                ? 'border border-white/12 bg-white/[0.05] backdrop-blur-md ring-1 ring-white/10'
                : 'bg-white shadow-slate-900/10'
            }`}
          >
            {GROUPS.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGroup(g.id)}
                className={`px-3 py-1.5 rounded-full font-semibold border transition ${
                  group === g.id
                    ? 'bg-gradient-to-r from-teal-600 to-teal-800 text-white border-teal-400/40 shadow-md'
                    : sceneNight
                      ? 'bg-white/[0.06] text-slate-200 border-white/15 hover:bg-white/10 backdrop-blur-sm'
                      : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {embedded && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full shadow-sm ${
              sceneNight
                ? 'border border-white/12 bg-white/[0.06] backdrop-blur-md text-slate-100 ring-1 ring-white/10'
                : 'bg-white shadow-slate-900/15'
            }`}
          >
            <FileText className={`w-5 h-5 ${sceneNight ? 'text-sky-300' : 'text-sky-500'}`} />
            <h2
              className={`text-sm sm:text-base font-bold tracking-wide uppercase ${
                sceneNight ? 'text-slate-100' : 'text-slate-900'
              }`}
            >
              Путевые листы
            </h2>
          </div>
          <div
            className={`flex items-center gap-2 text-xs sm:text-sm rounded-full px-3 py-1 shadow-sm ${
              sceneNight
                ? 'border border-white/12 bg-white/[0.05] backdrop-blur-md ring-1 ring-white/10'
                : 'bg-white shadow-slate-900/10'
            }`}
          >
            {GROUPS.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGroup(g.id)}
                className={`px-3 py-1.5 rounded-full font-semibold border transition ${
                  group === g.id
                    ? 'bg-gradient-to-r from-teal-600 to-teal-800 text-white border-teal-400/40 shadow-md'
                    : sceneNight
                      ? 'bg-white/[0.06] text-slate-200 border-white/15 hover:bg-white/10 backdrop-blur-sm'
                      : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Информационный блок */}
      {!embedded && (
        <div className="bg-gradient-to-r from-sky-50 to-teal-50 border-2 border-teal-200 rounded-xl p-4">
          <p className="text-sm text-teal-900">
            💡 <strong>Завершить рейс без водителя:</strong> пробег при заезде
            подставится автоматически (начальный + 50 км). Т6 не заполняем.
          </p>
        </div>
      )}

      {/* Фильтры и поиск */}
      <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="relative sm:col-span-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Номер ПЛ"
              value={filters.waybillNumber}
              onChange={(e) => setFilters((p) => ({ ...p, waybillNumber: e.target.value }))}
              className="w-full pl-10 pr-4 py-2.5 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
            />
          </div>
          <div className="relative sm:col-span-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Водитель"
              value={filters.driverName}
              onChange={(e) => setFilters((p) => ({ ...p, driverName: e.target.value }))}
              className="w-full pl-10 pr-4 py-2.5 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
            />
          </div>
          <div className="relative sm:col-span-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Госномер"
              value={filters.regNumber}
              onChange={(e) => setFilters((p) => ({ ...p, regNumber: e.target.value }))}
              className="w-full pl-10 pr-4 py-2.5 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
            />
          </div>
          <div className="flex items-center gap-2 sm:col-span-1">
            <Filter className="w-5 h-5 text-slate-600" />
            <select
              value={filters.status}
              onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}
              className="w-full px-4 py-2.5 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition font-semibold"
            >
              <option value="all">Все статусы</option>
              <option value="awaiting_taxcom">Ожидает Такском</option>
              <option value="only_fast_pdf">Только наш ПДФ</option>
              <option value="no_mintrans_qr">Без QR Минтранса</option>
              <option value="pending">На подписании</option>
              <option value="submitted">Завершённые</option>
              <option value="failed">Ошибки</option>
            </select>
          </div>
        </div>
      </div>

      {/* Список */}
      {!hasAnyEpl ? (
        <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-12 text-center">
          <FileText className="w-16 h-16 mx-auto mb-4 text-slate-400" />
          <p className="text-slate-600 text-lg font-semibold">
            {filters.waybillNumber || filters.driverName || filters.regNumber || filters.status !== 'all'
              ? 'Ничего не найдено'
              : 'Путевых листов пока нет'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {list.map((epl, index) => (
            <motion.div
              key={epl.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index, 10) * 0.04 }}
            >
              <Card
                className="p-4 hover:shadow-xl transition-shadow"
                onClick={() => setSelectedEpl(epl)}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <FileText className="w-4 h-4 text-teal-600" />
                        <h3 className="font-bold text-sm text-slate-800 font-mono">
                          {epl.waybillNumber || `ПЛ-${epl.id}`}
                        </h3>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Создан: {formatDateMsk(epl.createdAt)}
                      </p>
                    </div>
                    {getStatusBadge(epl.status)}
                  </div>

                  <div className="pt-1">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                      Титулы
                    </p>
                    <TitulBadges titulStatus={epl.titulStatus} size="sm" />
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span
                      className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        epl.hasFastDoc ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      Наш PDF
                    </span>
                    <span
                      className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        epl.hasOfficialDoc ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      Минтранс PDF
                    </span>
                    <span
                      className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        epl.hasMintransQr ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      Минтранс QR
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-slate-50 rounded-lg p-2.5">
                      <p className="text-[11px] text-slate-600 mb-0.5">Водитель</p>
                      <p className="text-sm font-semibold text-slate-800">{epl.driverName || '—'}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2.5">
                      <p className="text-[11px] text-slate-600 mb-0.5">Автомобиль</p>
                      <p className="text-sm font-semibold text-slate-800">{epl.carRegNumber || '—'}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {epl.status === 'pending' && (
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          handleCompleteWithoutDriver(epl.id);
                        }}
                        disabled={completingId === epl.id}
                        className="w-full px-4 py-2.5 bg-gradient-to-r from-teal-600 to-teal-800 text-white rounded-xl hover:from-teal-700 hover:to-teal-900 font-semibold transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {completingId === epl.id ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Завершение...
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-4 h-4" />
                            Завершить без водителя
                          </>
                        )}
                      </motion.button>
                    )}

                    {permissions.canCloseEplShifts && (
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          handleCloseShift(epl.id);
                        }}
                        disabled={closingShiftId === epl.id}
                        className="w-full px-3 py-2 rounded-xl border border-amber-300 text-amber-700 text-xs font-semibold hover:bg-amber-50 disabled:opacity-50"
                      >
                        {closingShiftId === epl.id ? 'Закрываем смену…' : 'Закрыть смену (без списания)'}
                      </button>
                    )}

                    {permissions.canChargeOnShiftClose && (
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          handleCloseShiftWithCharge(epl);
                        }}
                        className="w-full px-3 py-2 rounded-xl border border-red-300 text-red-700 text-xs font-semibold hover:bg-red-50"
                      >
                        Закрыть смену со списанием
                      </button>
                    )}

                    {canControlQueue && epl.hasOfficialDoc && !epl.hasMintransQr && (
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          handleRequeueQr(epl.id);
                        }}
                        disabled={requeueId === epl.id}
                        className="w-full px-3 py-2 rounded-xl border border-violet-300 text-violet-700 text-xs font-semibold hover:bg-violet-50 disabled:opacity-50"
                      >
                        {requeueId === epl.id ? 'QR запрашивается...' : 'Вытянуть QR Минтранса'}
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* Модалка деталей ЭПЛ */}
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
                <p className="text-sm font-semibold text-slate-800">
                  #{selectedEpl.parkId} · {selectedEpl.parkName || '—'}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-0.5">
                  Статус ЭПЛ
                </p>
                <div className="flex items-center gap-2">
                  {getStatusBadge(selectedEpl.status)}
                </div>
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
                  {selectedEpl.carRegNumber || '—'}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                Титулы ЭПЛ
              </p>
              <TitulBadges titulStatus={selectedEpl.titulStatus} size="md" showLabels />
              <p className="text-[10px] text-slate-400 mt-1.5">
                подписан · заполнен · не заполнен
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                Документы
              </p>
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                <span
                  className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    selectedEpl.hasFastDoc
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  Наш PDF
                </span>
                <span
                  className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    selectedEpl.hasOfficialDoc
                      ? 'bg-teal-100 text-teal-800'
                      : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  Минтранс PDF
                </span>
                <span
                  className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    selectedEpl.hasMintransQr
                      ? 'bg-violet-100 text-violet-700'
                      : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  Минтранс QR
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Создан: {formatDateMsk(selectedEpl.createdAt)}
              </p>
            </div>

            {/* Кнопки управления сменой */}
            {permissions.canCloseEplShifts && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => handleCloseShift(selectedEpl.id)}
                  disabled={closingShiftId === selectedEpl.id}
                  className="w-full px-3 py-2.5 rounded-xl border border-amber-300 text-amber-700 text-xs font-semibold hover:bg-amber-50 disabled:opacity-50"
                >
                  {closingShiftId === selectedEpl.id ? 'Закрываем смену…' : 'Закрыть смену без списания'}
                </button>
                {permissions.canChargeOnShiftClose && (
                  <button
                    type="button"
                    onClick={() => handleCloseShiftWithCharge(selectedEpl)}
                    className="w-full px-3 py-2.5 rounded-xl border border-red-300 text-red-700 text-xs font-semibold hover:bg-red-50"
                  >
                    Закрыть смену со списанием
                  </button>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {/* 1. В очередь на создание в Такском (если наш PDF уже есть, а офиц. ещё нет) */}
              {canControlQueue && selectedEpl.hasFastDoc && !selectedEpl.hasOfficialDoc && (
                <button
                  type="button"
                  onClick={() => handleRequeueCreation(selectedEpl.id)}
                  disabled={requeueId === selectedEpl.id}
                  className="w-full px-3 py-2.5 rounded-xl border border-sky-300 text-sky-700 text-xs font-semibold hover:bg-sky-50 disabled:opacity-50"
                >
                  {requeueId === selectedEpl.id
                    ? 'Отправляем в очередь Минтранса...'
                    : 'В очередь на создание в Такском'}
                </button>
              )}

              {/* 2. Вытянуть QR Минтранса, если PDF уже есть */}
              {canControlQueue && selectedEpl.hasOfficialDoc && !selectedEpl.hasMintransQr && (
                <button
                  type="button"
                  onClick={() => handleRequeueQr(selectedEpl.id)}
                  disabled={requeueId === selectedEpl.id}
                  className="w-full px-3 py-2.5 rounded-xl border border-violet-300 text-violet-700 text-xs font-semibold hover:bg-violet-50 disabled:opacity-50"
                >
                  {requeueId === selectedEpl.id
                    ? 'Запрашиваем QR Минтранса...'
                    : 'Вытянуть QR Минтранса'}
                </button>
              )}
            </div>

            {/* Скачать документы */}
            {permissions.canDownloadEplDocs && (
              <div className="pt-3 space-y-1">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                  Скачать
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!selectedEpl.hasFastDoc}
                    onClick={async () => {
                      try {
                        const res = await downloadEplFastPdf(selectedEpl.id);
                        const filename = `${selectedEpl.waybillNumber || `epl-${selectedEpl.id}`}.pdf`;
                        openPdfFromResponse(res, filename, 'Наш PDF скачан');
                      } catch (err) {
                        try {
                          const maybeBlob = err?.response?.data;
                          if (maybeBlob && typeof maybeBlob.text === 'function') {
                            const txt = await maybeBlob.text();
                            const j = (() => { try { return JSON.parse(txt); } catch { return null; } })();
                            const msg = j?.error || txt;
                            showToast(`❌ Ошибка при скачивании нашего PDF: ${msg || 'Не удалось скачать документ'}`, 'error');
                            return;
                          }
                        } catch {}
                        showToast(
                          `❌ Ошибка при скачивании нашего PDF: ${
                            err.response?.data?.error || err.message || 'Не удалось скачать документ'
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
                        const res = await downloadEplMintransPdf(selectedEpl.id);
                        const filename = `${selectedEpl.waybillNumber || `epl-${selectedEpl.id}`}-mintrans.pdf`;
                        openPdfFromResponse(res, filename, 'Минтранс PDF скачан');
                      } catch (err) {
                        try {
                          const maybeBlob = err?.response?.data;
                          if (maybeBlob && typeof maybeBlob.text === 'function') {
                            const txt = await maybeBlob.text();
                            const j = (() => { try { return JSON.parse(txt); } catch { return null; } })();
                            const msg = j?.error || txt;
                            showToast(`❌ Ошибка при скачивании Минтранс PDF: ${msg || 'Не удалось скачать документ'}`, 'error');
                            return;
                          }
                        } catch {}
                        showToast(
                          `❌ Ошибка при скачивании Минтранс PDF: ${
                            err.response?.data?.error || err.message || 'Не удалось скачать документ'
                          }`,
                          'error'
                        );
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg border text-xs font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed border-teal-300 text-teal-800 hover:bg-teal-50"
                  >
                    Минтранс PDF
                  </button>
                  <button
                    type="button"
                    disabled={!selectedEpl.hasMintransQr}
                    onClick={async () => {
                      try {
                        const data = await getEplMintransQr(selectedEpl.id);
                        if (data?.qr) {
                          const w = window.open('', '_blank');
                          if (w) {
                            w.document.write(`<html><body style=\"margin:0;display:flex;align-items:center;justify-content:center;background:#0f172a\"><img src=\"${data.qr}\" style=\"max-width:90vw;max-height:90vh;border-radius:16px;box-shadow:0 20px 40px rgba(15,23,42,0.7)\"/></body></html>`);
                          }
                        } else {
                          showToast('❌ QR Минтранса ещё не готов', 'error');
                        }
                      } catch (err) {
                        showToast(
                          `❌ Ошибка при получении QR Минтранса: ${
                            err.response?.data?.error || err.message || 'Не удалось получить QR'
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
            )}
          </div>
        </Modal>
      )}

      {chargeModalEpl && (
        <Modal
          isOpen={!!chargeModalEpl}
          onClose={() => setChargeModalEpl(null)}
          title={`Закрыть смену со списанием · ${chargeModalEpl.waybillNumber || `ПЛ-${chargeModalEpl.id}`}`}
          size="sm"
        >
          <div className="space-y-3 text-sm">
            <p className="text-slate-600">
              Введите сумму списания и при необходимости комментарий. Смена будет закрыта, а деньги спишутся с баланса
              водителя.
            </p>
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide">
                Сумма, ₽
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={chargeAmount}
                onChange={(e) => setChargeAmount(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/60 focus:border-red-500"
                placeholder="Например, 500"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide">
                Комментарий (опционально)
              </label>
              <textarea
                value={chargeComment}
                onChange={(e) => setChargeComment(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/60 focus:border-red-500 resize-none"
                placeholder="Например: Смена закрыта менеджером, списание за нарушение"
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <button
                type="button"
                onClick={() => setChargeModalEpl(null)}
                className="w-full sm:flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleSubmitChargeClose}
                disabled={closingShiftId === chargeModalEpl.id}
                className="w-full sm:flex-1 px-3 py-2 rounded-lg bg-gradient-to-r from-red-600 to-red-700 text-white text-sm font-semibold hover:from-red-700 hover:to-red-800 disabled:opacity-50"
              >
                {closingShiftId === chargeModalEpl.id ? 'Закрываем…' : 'Закрыть смену и списать деньги'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}