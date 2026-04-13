import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { FileText, Filter } from 'lucide-react';

const FILTER_DEBOUNCE_MS = 380;
import api from '../api';
import { useToast } from '../hooks/useToast';
import TitulBadges from './TitulBadges';
import { parseUtc } from '../utils/dateFormatter';
import { operationsFieldClass, operationsInset, operationsShell } from '../utils/operationsUi';

const GROUPS = [
  { id: 'open', label: 'Открытые', uiGroup: 'current_open' },
  { id: 'no_official', label: 'Без оф. ЭПЛ', uiGroup: 'no_official_epl' },
  { id: 'no_qr', label: 'Без QR Минтранса', uiGroup: 'no_mintrans_qr' },
  { id: 'closed', label: 'Закрытые', uiGroup: null }
];

export default function AdminEplList({ sceneNight = false }) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [group, setGroup] = useState('open');
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({
    parkId: '',
    waybillNumber: '',
    driverName: '',
    regNumber: '',
    status: '',
    failureCode: ''
  });
  const [parks, setParks] = useState([]);
  const [parksLoading, setParksLoading] = useState(false);
  const [requeueLoading, setRequeueLoading] = useState(false);
  const [innMutating, setInnMutating] = useState(false);
  const [closingId, setClosingId] = useState(null);
  const [chargeModalEpl, setChargeModalEpl] = useState(null);
  const [chargeAmount, setChargeAmount] = useState('');
  const [chargeComment, setChargeComment] = useState('');
  const { showToast } = useToast();
  const filterDebounceRef = useRef(null);
  const textFiltersFirstRun = useRef(true);

  const load = async (override = {}) => {
    try {
      setLoading(true);
      setError(null);
      const params = {};
      const f = { ...filters, ...override };
      if (f.parkId) params.parkId = f.parkId;
      if (f.waybillNumber) params.waybillNumber = f.waybillNumber;
      if (f.driverName) params.driverName = f.driverName;
      if (f.regNumber) params.regNumber = f.regNumber;
      const statusQueriable = ['pending_clinic', 'pending', 'approved', 'signed', 'failed'];
      // Для новых "документных" фильтров (только наш PDF/без QR) запрос на бэк не делаем,
      // а фильтруем фронтом по флагам hasFastDoc/hasOfficialDoc/hasMintransQr.
      if (f.status && statusQueriable.includes(f.status)) params.status = f.status;
      if (group && group !== 'closed') params.group = GROUPS.find((g) => g.id === group)?.uiGroup || null;
      const res = await api.get('/admin/epl', { params });
      const raw = Array.isArray(res.data) ? res.data : [];
      // failureCode фильтруем на фронте, чтобы не трогать бэкенд-контракт.
      let filtered = f.failureCode ? raw.filter((x) => String(x.failureCode || '') === String(f.failureCode)) : raw;

      // Фильтры по документам / ожиданию Такском (по требованиям UI)
      if (f.status === 'only_fast_pdf') filtered = filtered.filter((x) => !!x.hasFastDoc && !x.hasOfficialDoc);
      if (f.status === 'no_mintrans_qr') filtered = filtered.filter((x) => !!x.hasOfficialDoc && !x.hasMintransQr);
      if (f.status === 'awaiting_taxcom') filtered = filtered.filter((x) => String(x.status || x.eplStatus || '') === 'pending');

      setItems(filtered);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Не удалось загрузить ЭПЛ');
    } finally {
      setLoading(false);
    }
  };

  const loadParks = async () => {
    try {
      setParksLoading(true);
      const res = await api.get('/admin/parks');
      setParks(Array.isArray(res.data) ? res.data : []);
    } catch {
      setParks([]);
    } finally {
      setParksLoading(false);
    }
  };

  useEffect(() => {
    loadParks();
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group]);

  // Статус ЭПЛ — нужно перезагружать список при смене фильтра
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status]);

  useEffect(() => {
    if (textFiltersFirstRun.current) {
      textFiltersFirstRun.current = false;
      return;
    }
    if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    filterDebounceRef.current = setTimeout(() => {
      filterDebounceRef.current = null;
      load();
    }, FILTER_DEBOUNCE_MS);
    return () => {
      if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.waybillNumber, filters.driverName, filters.regNumber]);

  useEffect(() => {
    // мгновенная перезагрузка по смене фильтра проблем (без debounce)
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.failureCode]);

  const fmtDate = (s) => {
    if (!s) return '—';
    const d = parseUtc(s);
    if (!d || Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const fmtAttemptAt = (s) => {
    if (!s) return '—';
    const d = parseUtc(s);
    if (!d || Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const fmtExpectedClose = (row) => {
    if (!row || !row.expectedCloseAt) return '—';
    const d = parseUtc(row.expectedCloseAt);
    if (!d || Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const downloadBlob = async (promise, filenameFallback, successMessage) => {
    try {
      const res = await promise;
      const blob = res.data;
      const cd = res?.headers?.['content-disposition'] || res?.headers?.['Content-Disposition'] || '';
      const m = String(cd).match(/filename\*=UTF-8''([^;]+)|filename=\"?([^\";]+)\"?/i);
      const filename = (m ? decodeURIComponent(m[1] || m[2] || '') : '') || filenameFallback || 'document.pdf';
      const ct = String(res?.headers?.['content-type'] || res?.headers?.['Content-Type'] || blob?.type || '').toLowerCase();
      if (ct && !ct.includes('pdf')) {
        showToast('❌ Сервер вернул не PDF (проверь доступ/готовность документа).', 'error');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      if (successMessage) showToast(successMessage, 'success');
    } catch (e) {
      // axios при responseType:'blob' может принести ошибку как Blob
      try {
        const maybeBlob = e?.response?.data;
        if (maybeBlob && typeof maybeBlob.text === 'function') {
          const txt = await maybeBlob.text();
          const j = (() => { try { return JSON.parse(txt); } catch { return null; } })();
          const msg = j?.error || txt;
          showToast(`❌ ${msg || 'Не удалось скачать документ'}`, 'error');
          return;
        }
      } catch {}
      showToast(`❌ ${e.response?.data?.error || e.message || 'Не удалось скачать документ'}`, 'error');
    }
  };

  const shiftLabel = (row) => {
    if (row.shiftStatus === 'active') return 'Смена открыта';
    if (row.shiftStatus === 'closed') return 'Смена закрыта';
    if (row.shiftStatus === 'auto_closed') return 'Смена закрыта автоматически';
    return 'Без смены';
  };

  const byGroup = (row) => {
    const ui = row.uiGroup;
    if (group === 'closed') return ui === 'closed' || ui === 'auto_closed';
    const cfg = GROUPS.find((g) => g.id === group);
    if (!cfg || !cfg.uiGroup) return true;
    return ui === cfg.uiGroup;
  };

  const list = items.filter(byGroup);

  const selectedNoT1 = selected && (!selected.titulStatus || selected.titulStatus.t1 == null);
  const selectedCanMutateInn =
    selected &&
    selected.eplStatus === 'failed' &&
    !selected.mintransId &&
    selectedNoT1 &&
    Number(selected.createAttempts || 0) >= 2;

  const handleCloseShift = async (eplId) => {
    if (!window.confirm('Закрыть смену по этому ЭПЛ без списания денег?')) return;
    try {
      setClosingId(eplId);
      await api.post(`/admin/epl/${eplId}/close-shift`);
      showToast('✅ Смена закрыта, ЭПЛ помечен как закрытый администратором', 'success');
      await load();
    } catch (e) {
      showToast(
        `❌ Ошибка при закрытии смены: ${e.response?.data?.error || e.message || 'Не удалось закрыть смену'}`,
        'error'
      );
    } finally {
      setClosingId(null);
    }
  };

  const openChargeModal = (row) => {
    setChargeModalEpl(row);
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
      setClosingId(chargeModalEpl.id);
      const payload = { amount: sum };
      if (chargeComment.trim()) payload.comment = chargeComment.trim();
      await api.post(`/admin/epl/${chargeModalEpl.id}/close-shift-with-charge`, payload);
      showToast('✅ Смена закрыта, деньги списаны, ЭПЛ помечен как закрытый администратором', 'success');
      setChargeModalEpl(null);
      await load();
    } catch (e) {
      showToast(
        `❌ Ошибка при закрытии смены со списанием: ${e.response?.data?.error || e.message || 'Не удалось закрыть смену'}`,
        'error'
      );
    } finally {
      setClosingId(null);
    }
  };

  const night = sceneNight;
  const shell = operationsShell(night);
  const inset = operationsInset(night);
  const fc = operationsFieldClass(night);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full shadow-sm ${
            night
              ? 'border border-white/12 bg-white/[0.06] backdrop-blur-md text-slate-100 ring-1 ring-white/10'
              : 'bg-white shadow-slate-900/15'
          }`}
        >
          <FileText className={`w-5 h-5 ${night ? 'text-sky-300' : 'text-sky-500'}`} />
          <h2
            className={`text-sm sm:text-base font-bold tracking-wide uppercase ${
              night ? 'text-slate-100' : 'text-slate-900'
            }`}
          >
            ЭПЛ (глобально)
          </h2>
        </div>
        <div
          className={`flex items-center gap-2 text-xs sm:text-sm rounded-full px-3 py-1 shadow-sm ${
            night
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
                  ? night
                    ? 'bg-gradient-to-r from-sky-500 to-sky-600 text-white border-sky-400/50 shadow-md shadow-sky-900/30'
                    : 'bg-slate-900 text-white border-slate-900 shadow-lg shadow-slate-900/40'
                  : night
                    ? 'bg-white/[0.06] text-slate-200 border-white/15 hover:bg-white/10 backdrop-blur-sm'
                    : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`rounded-2xl overflow-hidden ${shell}`}>
        <div
          className={`px-4 py-3 border-b ${
            night ? 'border-white/10 bg-white/[0.05]' : 'border-slate-100 bg-slate-50/80'
          }`}
        >
          <div
            className={`flex items-center gap-2 text-sm font-semibold ${
              night ? 'text-slate-200' : 'text-slate-700'
            }`}
          >
            <Filter className={`w-4 h-4 ${night ? 'text-slate-400' : 'text-slate-500'}`} />
            Фильтры
            <span
              className={`text-xs font-normal normal-case hidden sm:inline ${
                night ? 'text-slate-400' : 'text-slate-500'
              }`}
            >
              — применяются автоматически при вводе
            </span>
          </div>
        </div>
        <div
          className={`px-4 py-3 grid grid-cols-1 sm:grid-cols-6 gap-3 border-b ${
            night ? 'border-white/10' : 'border-slate-100'
          }`}
        >
          <div className="flex flex-col gap-1">
            <label
              className={`text-[11px] font-semibold uppercase tracking-wide ${
                night ? 'text-slate-400' : 'text-slate-500'
              }`}
            >
              Парк
            </label>
            <select
              value={filters.parkId}
              onChange={(e) => {
                const value = e.target.value;
                setFilters((f) => ({ ...f, parkId: value }));
                // авто-перезагрузка при смене парка, чтобы \"фильтр по паркам\" сразу переключал список
                load({ parkId: value });
              }}
              className={fc}
            >
              <option value="">{parksLoading ? 'Загрузка...' : 'Все парки'}</option>
              {!parksLoading &&
                parks.map((p) => (
                  <option key={p.id} value={p.id}>
                    #{p.id} · {p.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label
              className={`text-[11px] font-semibold uppercase tracking-wide ${
                night ? 'text-slate-400' : 'text-slate-500'
              }`}
            >
              Статус ЭПЛ
            </label>
            <select
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              className={fc}
            >
              <option value="">Все</option>
              <option value="only_fast_pdf">Только наш ПДФ</option>
              <option value="no_mintrans_qr">Без QR Минтранса</option>
              <option value="awaiting_taxcom">Ожидает Такском</option>
              <option value="failed">Ошибка</option>
              <option value="signed">Подписан</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label
              className={`text-[11px] font-semibold uppercase tracking-wide ${
                night ? 'text-slate-400' : 'text-slate-500'
              }`}
            >
              Номер ЭПЛ
            </label>
            <input
              type="text"
              value={filters.waybillNumber}
              onChange={(e) => setFilters((f) => ({ ...f, waybillNumber: e.target.value }))}
              className={fc}
              placeholder="WB-..."
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              className={`text-[11px] font-semibold uppercase tracking-wide ${
                night ? 'text-slate-400' : 'text-slate-500'
              }`}
            >
              Водитель
            </label>
            <input
              type="text"
              value={filters.driverName}
              onChange={(e) => setFilters((f) => ({ ...f, driverName: e.target.value }))}
              className={fc}
              placeholder="ФИО"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              className={`text-[11px] font-semibold uppercase tracking-wide ${
                night ? 'text-slate-400' : 'text-slate-500'
              }`}
            >
              Госномер
            </label>
            <input
              type="text"
              value={filters.regNumber}
              onChange={(e) => setFilters((f) => ({ ...f, regNumber: e.target.value }))}
              className={fc}
              placeholder="А000АА"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              className={`text-[11px] font-semibold uppercase tracking-wide ${
                night ? 'text-slate-400' : 'text-slate-500'
              }`}
            >
              Проблемы
            </label>
            <select
              value={filters.failureCode}
              onChange={(e) => setFilters((f) => ({ ...f, failureCode: e.target.value }))}
              className={fc}
            >
              <option value="">Все</option>
              <option value="taxcom_validation">Такском: форма не сохранилась</option>
            </select>
          </div>
        </div>

        {error && (
          <div
            className={`px-4 py-3 text-sm border-b ${
              night
                ? 'text-red-200 bg-red-500/15 border-red-500/25'
                : 'text-red-700 bg-red-50 border-red-200'
            }`}
          >
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-0">
          <div
            className={`lg:col-span-2 max-h-[520px] overflow-y-auto p-3 ${
              night ? 'border-r border-white/10' : 'border-r border-slate-100'
            }`}
          >
            {loading && (
              <div className={`p-4 text-sm ${night ? 'text-slate-400' : 'text-slate-500'}`}>
                Загрузка...
              </div>
            )}
            {!loading && list.length === 0 && (
              <div className={`p-4 text-sm ${night ? 'text-slate-400' : 'text-slate-500'}`}>
                В этой группе нет ЭПЛ.
              </div>
            )}
            {!loading &&
              list.map((row) => {
                const isSelected = selected && selected.id === row.id;
                const hasFastDoc = !!row.hasFastDoc;
                const hasOfficialDoc = !!row.hasOfficialDoc;
                const hasMintransQr = !!row.hasMintransQr;
                const isTaxcomCreateFailed = row.eplStatus === 'failed' && row.failureCode === 'taxcom_validation' && !row.mintransId;
                const now = new Date();
                const expected = row.expectedCloseAt ? parseUtc(row.expectedCloseAt) : null;
                const msLeft = expected ? expected.getTime() - now.getTime() : null;
                const nearingClose =
                  expected && msLeft != null && msLeft > 0 && msLeft <= 60 * 60 * 1000 && row.shiftStatus === 'active';
                const overdue =
                  expected && msLeft != null && msLeft <= 0 && (row.shiftStatus === 'active' || row.shiftStatus === 'auto_closed');
                const borderClass = night
                  ? isSelected
                    ? 'bg-sky-500/15 border-sky-400/40 shadow-sm ring-1 ring-sky-400/20'
                    : overdue
                      ? 'bg-red-500/12 border-red-400/35 shadow-sm'
                      : nearingClose
                        ? 'bg-amber-500/12 border-amber-400/35 shadow-sm'
                        : 'bg-white/[0.04] border-white/12 hover:border-white/22 hover:bg-white/[0.07]'
                  : isSelected
                    ? 'bg-blue-50/80 border-blue-200 shadow-sm'
                    : overdue
                      ? 'bg-red-50/60 border-red-300 shadow-sm'
                      : nearingClose
                        ? 'bg-amber-50/60 border-amber-300 shadow-sm'
                        : 'bg-white border-slate-200 hover:border-blue-200 hover:shadow-sm';

                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setSelected(row)}
                    className={`w-full text-left mb-2 px-4 py-3 flex items-center justify-between gap-3 rounded-xl border transition-all ${borderClass}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span
                          className={`font-mono text-sm font-semibold truncate ${
                            night ? 'text-slate-100' : 'text-slate-900'
                          }`}
                        >
                          {row.waybillNumber || `EPL #${row.id}`}
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap ${
                            night
                              ? 'bg-white/[0.08] text-slate-300 border border-white/10'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          Парк #{row.parkId} · {row.parkName || '—'}
                        </span>
                        {isTaxcomCreateFailed && (
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap ${
                              night
                                ? 'bg-red-500/20 text-red-200 border border-red-400/30'
                                : 'bg-red-100 text-red-700 border border-red-200'
                            }`}
                          >
                            Не создано Такскомом{row.createAttempts ? ` · попыток: ${row.createAttempts}` : ''}
                          </span>
                        )}
                      </div>
                      <p className={`text-xs truncate ${night ? 'text-slate-300' : 'text-slate-600'}`}>
                        {row.driverName || 'Без водителя'} · {row.regNumber || 'Без авто'}
                      </p>
                      <p className={`text-[11px] mt-0.5 ${night ? 'text-slate-500' : 'text-slate-400'}`}>
                        Создан: {fmtDate(row.createdAt)}
                      </p>
                      <p className={`text-[11px] ${night ? 'text-slate-500' : 'text-slate-400'}`}>
                        Закроется (ожид.): {fmtExpectedClose(row)}
                      </p>
                      {isTaxcomCreateFailed && (
                        <p
                          className={`text-[11px] mt-0.5 ${night ? 'text-red-300' : 'text-red-700/90'}`}
                        >
                          Последняя попытка: {fmtAttemptAt(row.lastAttemptAt)}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <span
                        className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${
                          night
                            ? 'text-slate-200 bg-white/[0.08] border border-white/10'
                            : 'text-slate-600 bg-slate-100'
                        }`}
                      >
                        {shiftLabel(row)}
                      </span>
                      <TitulBadges titulStatus={row.titulStatus} size="sm" />
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold ${
                            hasFastDoc
                              ? night
                                ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-400/30'
                                : 'bg-emerald-100 text-emerald-700'
                              : night
                                ? 'bg-white/[0.06] text-slate-500 border border-white/10'
                                : 'bg-slate-100 text-slate-400'
                          }`}
                          title="Наш PDF/QR"
                        >
                          F
                        </span>
                        <span
                          className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold ${
                            hasOfficialDoc
                              ? night
                                ? 'bg-sky-500/25 text-sky-200 border border-sky-400/35'
                                : 'bg-blue-100 text-blue-700'
                              : night
                                ? 'bg-white/[0.06] text-slate-500 border border-white/10'
                                : 'bg-slate-100 text-slate-400'
                          }`}
                          title="Официальный ЭПЛ"
                        >
                          O
                        </span>
                        <span
                          className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold ${
                            hasMintransQr
                              ? night
                                ? 'bg-violet-500/25 text-violet-200 border border-violet-400/35'
                                : 'bg-violet-100 text-violet-700'
                              : night
                                ? 'bg-white/[0.06] text-slate-500 border border-white/10'
                                : 'bg-slate-100 text-slate-400'
                          }`}
                          title="QR Минтранса"
                        >
                          QR
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
          </div>
          <div className="lg:col-span-1 min-h-[200px]">
            <motion.div
              key={selected ? selected.id : 'empty'}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="h-full flex flex-col"
            >
              <div
                className={`p-4 border-b ${night ? 'border-white/10' : 'border-slate-100'}`}
              >
                <p
                  className={`text-xs font-semibold uppercase tracking-wide ${
                    night ? 'text-slate-400' : 'text-slate-500'
                  }`}
                >
                  Детали
                </p>
              </div>
              {!selected ? (
                <div
                  className={`flex-1 flex items-center justify-center text-sm text-center px-4 py-8 ${
                    night ? 'text-slate-400' : 'text-slate-500'
                  }`}
                >
                  Выберите ЭПЛ слева, чтобы увидеть подробности.
                </div>
              ) : (
                <div className={`flex-1 p-4 space-y-3 text-sm ${night ? 'text-slate-200' : ''}`}>
                  <div>
                    <p
                      className={`text-[11px] font-semibold uppercase tracking-wide mb-0.5 ${
                        night ? 'text-slate-400' : 'text-slate-500'
                      }`}
                    >
                      Путевой лист
                    </p>
                    <p
                      className={`font-mono text-base font-semibold ${
                        night ? 'text-slate-100' : 'text-slate-900'
                      }`}
                    >
                      {selected.waybillNumber || `EPL #${selected.id}`}
                    </p>
                    <p className={`text-[11px] mt-0.5 ${night ? 'text-slate-400' : 'text-slate-500'}`}>
                      Создан: {fmtDate(selected.createdAt)}
                    </p>
                  </div>
                  <div className={`rounded-xl px-3 py-2.5 ${inset}`}>
                    <p
                      className={`text-[11px] font-semibold uppercase tracking-wide mb-0.5 ${
                        night ? 'text-slate-400' : 'text-slate-500'
                      }`}
                    >
                      Парк
                    </p>
                    <p className={`text-sm font-semibold ${night ? 'text-slate-100' : 'text-slate-800'}`}>
                      #{selected.parkId} · {selected.parkName || '—'}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    <div className={`rounded-xl px-3 py-2.5 ${inset}`}>
                      <p
                        className={`text-[11px] font-semibold uppercase tracking-wide mb-0.5 ${
                          night ? 'text-slate-400' : 'text-slate-500'
                        }`}
                      >
                        Водитель
                      </p>
                      <p className={`text-sm font-semibold ${night ? 'text-slate-100' : 'text-slate-800'}`}>
                        {selected.driverName || '—'}
                      </p>
                    </div>
                    <div className={`rounded-xl px-3 py-2.5 ${inset}`}>
                      <p
                        className={`text-[11px] font-semibold uppercase tracking-wide mb-0.5 ${
                          night ? 'text-slate-400' : 'text-slate-500'
                        }`}
                      >
                        Автомобиль
                      </p>
                      <p className={`text-sm font-semibold ${night ? 'text-slate-100' : 'text-slate-800'}`}>
                        {selected.regNumber || '—'}
                      </p>
                      {selected.brand && selected.model && (
                        <p className={`text-[11px] mt-0.5 ${night ? 'text-slate-400' : 'text-slate-600'}`}>
                          {selected.brand} {selected.model}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className={`rounded-xl px-3 py-2.5 ${inset}`}>
                    <p
                      className={`text-[11px] font-semibold uppercase tracking-wide mb-0.5 ${
                        night ? 'text-slate-400' : 'text-slate-500'
                      }`}
                    >
                      Статус смены
                    </p>
                    <p className={`text-sm font-semibold ${night ? 'text-slate-100' : 'text-slate-800'}`}>
                      {shiftLabel(selected)}
                    </p>
                    <p className={`text-[11px] mt-0.5 ${night ? 'text-slate-400' : 'text-slate-600'}`}>
                      Ожидаемое закрытие: {fmtExpectedClose(selected)}
                    </p>
                  </div>

                  {/* Закрытие смены админом */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleCloseShift(selected.id)}
                      disabled={closingId === selected.id}
                      className="w-full px-3 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-white text-xs font-semibold shadow-md hover:from-amber-600 hover:to-amber-700 disabled:opacity-50 disabled:shadow-none"
                    >
                      {closingId === selected.id ? 'Закрываем смену…' : 'Закрыть смену без списания'}
                    </button>
                    <button
                      type="button"
                      onClick={() => openChargeModal(selected)}
                      className="w-full px-3 py-2.5 rounded-xl bg-gradient-to-r from-red-500 to-red-600 text-white text-xs font-semibold shadow-md hover:from-red-600 hover:to-red-700"
                    >
                      Закрыть смену со списанием
                    </button>
                  </div>
                  <div className={`rounded-xl px-3 py-2.5 ${inset}`}>
                    <p
                      className={`text-[11px] font-semibold uppercase tracking-wide mb-1.5 ${
                        night ? 'text-slate-400' : 'text-slate-500'
                      }`}
                    >
                      Титулы ЭПЛ
                    </p>
                    <TitulBadges titulStatus={selected.titulStatus} size="md" showLabels />
                    <p className={`text-[10px] mt-1.5 ${night ? 'text-slate-500' : 'text-slate-400'}`}>
                      подписан · заполнен · не заполнен
                    </p>
                  </div>
                  <div className={`rounded-xl px-3 py-2.5 ${inset}`}>
                    <p
                      className={`text-[11px] font-semibold uppercase tracking-wide mb-1 ${
                        night ? 'text-slate-400' : 'text-slate-500'
                      }`}
                    >
                      Документы
                    </p>
                    <ul className={`text-xs space-y-0.5 ${night ? 'text-slate-300' : 'text-slate-700'}`}>
                      <li>Наш документ: {selected.hasFastDoc ? 'есть' : 'нет'}</li>
                      <li>Официальный ЭПЛ: {selected.hasOfficialDoc ? 'есть' : 'нет'}</li>
                      <li>QR Минтранса: {selected.hasMintransQr ? 'есть' : 'нет'}</li>
                    </ul>
                  </div>

                  {(selected.eplStatus === 'failed' || selected.failureCode) && (
                    <div className={`rounded-xl px-3 py-2.5 ${inset}`}>
                      <p
                        className={`text-[11px] font-semibold uppercase tracking-wide mb-1 ${
                          night ? 'text-slate-400' : 'text-slate-500'
                        }`}
                      >
                        Ошибка/причина
                      </p>
                      <p className={`text-xs ${night ? 'text-slate-200' : 'text-slate-700'}`}>
                        {selected.failureCode ? `Код: ${selected.failureCode}` : '—'}
                        {selected.createAttempts != null ? ` · попыток: ${selected.createAttempts}` : ''}
                      </p>
                      <p
                        className={`text-xs mt-1 whitespace-pre-wrap break-words ${
                          night ? 'text-slate-300' : 'text-slate-600'
                        }`}
                      >
                        {selected.errorMessage || '—'}
                      </p>
                      <p className={`text-[11px] mt-1 ${night ? 'text-slate-400' : 'text-slate-500'}`}>
                        Последняя попытка: {fmtAttemptAt(selected.lastAttemptAt)}
                      </p>
                    </div>
                  )}

                  {/* Кнопки в очередь Минтранса: пересоздание и QR */}
                  <div className="grid grid-cols-1 gap-2 mt-1">
                    {/* Подмена ИНН, когда нет даже Т1 после попыток */}
                    {selectedCanMutateInn && (
                      <button
                        type="button"
                        disabled={innMutating}
                        onClick={async () => {
                          if (!selected) return;
                          if (!window.confirm('Подменить ИНН водителя (2 случайные цифры) и вернуть ЭПЛ в очередь Такском?')) return;
                          try {
                            setInnMutating(true);
                            const r = await api.post(`/admin/epl/${selected.id}/mutate-inn`);
                            showToast(`✅ ИНН подменён. Новый ИНН: ${r.data?.newInn || '—'}`, 'success');
                            await load();
                          } catch (e) {
                            showToast(`❌ Ошибка при подмене ИНН: ${e.response?.data?.error || e.message || 'Не удалось выполнить'}`, 'error');
                          } finally {
                            setInnMutating(false);
                          }
                        }}
                        className={`w-full px-3 py-2 rounded-xl border text-xs font-semibold disabled:opacity-50 ${
                          night
                            ? 'border-amber-400/35 text-amber-200 bg-amber-500/10 hover:bg-amber-500/20'
                            : 'border-amber-300 text-amber-700 hover:bg-amber-50'
                        }`}
                      >
                        {innMutating ? 'Подменяем ИНН…' : 'ИНН (2 цифры)'}
                      </button>
                    )}

                    {/* В очередь на создание в Такском */}
                    {((selected.hasFastDoc && !selected.hasOfficialDoc) ||
                      (selected.eplStatus === 'failed' && selected.failureCode === 'taxcom_validation' && !selected.mintransId)) && (
                      <button
                        type="button"
                        disabled={requeueLoading}
                        onClick={async () => {
                          try {
                            setRequeueLoading(true);
                            await api.post(`/admin/epl/${selected.id}/requeue-creation`);
                            showToast('✅ ЭПЛ отправлен в очередь на создание в Такском', 'success');
                            await load();
                          } catch (e) {
                            showToast(
                              `❌ Ошибка при отправке в очередь Такском: ${
                                e.response?.data?.error || e.message || 'Не удалось отправить запрос'
                              }`,
                              'error'
                            );
                          } finally {
                            setRequeueLoading(false);
                          }
                        }}
                        className={`w-full px-3 py-2 rounded-xl border text-xs font-semibold disabled:opacity-50 ${
                          night
                            ? 'border-sky-400/40 text-sky-200 bg-sky-500/10 hover:bg-sky-500/20'
                            : 'border-sky-300 text-sky-700 hover:bg-sky-50'
                        }`}
                      >
                        {requeueLoading ? 'Отправляем в очередь Такском...' : 'Перезапустить создание в Такском'}
                      </button>
                    )}

                    {/* Вытянуть QR Минтранса */}
                    {selected.hasOfficialDoc && !selected.hasMintransQr && (
                      <button
                        type="button"
                        disabled={requeueLoading}
                        onClick={async () => {
                          try {
                            setRequeueLoading(true);
                            await api.post(`/admin/epl/${selected.id}/requeue-qr`);
                            showToast('✅ Запрос на QR Минтранса отправлен', 'success');
                          } catch (e) {
                            showToast(
                              `❌ Ошибка при запросе QR Минтранса: ${
                                e.response?.data?.error || e.message || 'Не удалось отправить запрос'
                              }`,
                              'error'
                            );
                          } finally {
                            setRequeueLoading(false);
                          }
                        }}
                        className={`w-full px-3 py-2 rounded-xl border text-xs font-semibold disabled:opacity-50 ${
                          night
                            ? 'border-violet-400/40 text-violet-200 bg-violet-500/10 hover:bg-violet-500/20'
                            : 'border-violet-300 text-violet-700 hover:bg-violet-50'
                        }`}
                      >
                        {requeueLoading ? 'Запрашиваем QR Минтранса...' : 'Вытянуть QR Минтранса'}
                      </button>
                    )}
                  </div>

                  {/* Скачивание документов */}
                  <div className="mt-3 space-y-1">
                    <p
                      className={`text-[11px] font-semibold uppercase tracking-wide ${
                        night ? 'text-slate-400' : 'text-slate-500'
                      }`}
                    >
                      Скачать
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!selected.hasFastDoc}
                        onClick={async () => {
                          await downloadBlob(
                            api.get(`/admin/epl/${selected.id}/document-fast`, { responseType: 'blob' }),
                            `${selected.waybillNumber || `epl-${selected.id}`}.pdf`,
                            'Наш PDF скачан'
                          );
                        }}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed ${
                          night
                            ? 'border-emerald-400/35 text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/20'
                            : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                        }`}
                      >
                        Наш PDF
                      </button>
                      <button
                        type="button"
                        disabled={!selected.hasOfficialDoc}
                        onClick={async () => {
                          await downloadBlob(
                            api.get(`/admin/epl/${selected.id}/document-mintrans`, { responseType: 'blob' }),
                            `${selected.waybillNumber || `epl-${selected.id}`}-mintrans.pdf`,
                            'Минтранс PDF скачан'
                          );
                        }}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed ${
                          night
                            ? 'border-sky-400/40 text-sky-200 bg-sky-500/10 hover:bg-sky-500/20'
                            : 'border-blue-300 text-blue-700 hover:bg-blue-50'
                        }`}
                      >
                        Минтранс PDF
                      </button>
                      <button
                        type="button"
                        disabled={!selected.hasMintransQr}
                        onClick={async () => {
                          try {
                            const { data } = await api.get(`/admin/epl/${selected.id}/qr-mintrans`);
                            if (data?.qr) {
                              const w = window.open('', '_blank');
                              if (w) {
                                w.document.write(`<html><body style=\"margin:0;display:flex;align-items:center;justify-content:center;background:#0f172a\"><img src=\"${data.qr}\" style=\"max-width:90vw;max-height:90vh;border-radius:16px;box-shadow:0 20px 40px rgba(15,23,42,0.7)\"/></body></html>`);
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
                        className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed ${
                          night
                            ? 'border-violet-400/40 text-violet-200 bg-violet-500/10 hover:bg-violet-500/20'
                            : 'border-violet-300 text-violet-700 hover:bg-violet-50'
                        }`}
                      >
                        QR Минтранса
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        </div>
      </div>

      {/* Модалка закрытия смены со списанием для админа */}
      {chargeModalEpl && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div
            className={`rounded-2xl shadow-2xl max-w-sm w-[90vw] p-5 space-y-3 border ${
              night
                ? 'border-white/15 bg-slate-900/90 text-slate-100 backdrop-blur-xl ring-1 ring-white/10'
                : 'bg-white border-slate-200'
            }`}
          >
            <p className={`text-sm font-semibold ${night ? 'text-slate-100' : 'text-slate-900'}`}>
              Закрыть смену со списанием по ЭПЛ{' '}
              <span className="font-mono">
                {chargeModalEpl.waybillNumber || `EPL #${chargeModalEpl.id}`}
              </span>
            </p>
            <p className={`text-xs ${night ? 'text-slate-300' : 'text-slate-600'}`}>
              Укажите сумму, которая будет списана с баланса водителя, и при необходимости комментарий. После этого
              смена закроется, а ЭПЛ будет помечен как закрытый администратором.
            </p>
            <div className="space-y-1.5">
              <label
                className={`text-[11px] font-semibold uppercase tracking-wide ${
                  night ? 'text-slate-400' : 'text-slate-600'
                }`}
              >
                Сумма, ₽
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={chargeAmount}
                onChange={(e) => setChargeAmount(e.target.value)}
                className={`w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500/60 ${
                  night
                    ? 'border border-white/15 bg-white/[0.06] text-slate-100 placeholder:text-slate-500 focus:border-red-400/50'
                    : 'border border-slate-300 focus:border-red-500'
                }`}
                placeholder="Например, 500"
              />
            </div>
            <div className="space-y-1.5">
              <label
                className={`text-[11px] font-semibold uppercase tracking-wide ${
                  night ? 'text-slate-400' : 'text-slate-600'
                }`}
              >
                Комментарий (опционально)
              </label>
              <textarea
                rows={3}
                value={chargeComment}
                onChange={(e) => setChargeComment(e.target.value)}
                className={`w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500/60 resize-none ${
                  night
                    ? 'border border-white/15 bg-white/[0.06] text-slate-100 placeholder:text-slate-500 focus:border-red-400/50'
                    : 'border border-slate-300 focus:border-red-500'
                }`}
                placeholder="Например: Смена закрыта администратором, списание за нарушение"
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <button
                type="button"
                onClick={() => setChargeModalEpl(null)}
                className={`w-full sm:flex-1 px-3 py-2 rounded-xl border text-sm font-semibold ${
                  night
                    ? 'border-white/20 text-slate-200 hover:bg-white/10'
                    : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleSubmitChargeClose}
                disabled={closingId === chargeModalEpl.id}
                className="w-full sm:flex-1 px-3 py-2 rounded-xl bg-gradient-to-r from-red-600 to-red-700 text-white text-sm font-semibold hover:from-red-700 hover:to-red-800 disabled:opacity-50"
              >
                {closingId === chargeModalEpl.id ? 'Закрываем…' : 'Закрыть смену и списать деньги'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

