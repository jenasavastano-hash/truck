import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Users, Filter, RefreshCw, Wallet, Car, Clock, Send, Bookmark, Trash2, Edit3, CheckSquare, Square, X } from 'lucide-react';
import {
  createBroadcastTemplate,
  deleteBroadcastTemplate,
  getBroadcastTemplates,
  getDriversMonitoring,
  getDriversMonitoringIds,
  sendDriversBroadcast,
  updateBroadcastTemplate,
} from '../../api/managerApi';
import { useToast } from '../../hooks/useToast';
import { formatDateMsk, parseUtc } from '../../utils/dateFormatter';
import { operationsShell } from '../../utils/operationsUi';

const CATEGORIES = [
  { id: 'inactive_no_epl', label: 'Не делали ЭПЛ давно', icon: Clock, tone: 'amber' },
  { id: 'low_balance', label: 'Низкий баланс', icon: Wallet, tone: 'red' },
  { id: 'no_car', label: 'Без авто', icon: Car, tone: 'slate' },
];

export default function BroadcastsTab({ parkId, onSent, sceneNight = false }) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ category: 'inactive_no_epl', days: 7, balanceLt: 200 });
  const [q, setQ] = useState('');
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const limit = 120;
  const qDebounceRef = useRef(null);
  const [selected, setSelected] = useState({}); // userId -> true
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [templateModal, setTemplateModal] = useState(null); // {type:'create'|'edit', id?}
  const getDefaultTitle = () => {
    try {
      const saved = localStorage.getItem('user');
      const u = saved ? JSON.parse(saved) : null;
      return u?.role === 'director' ? 'Сообщение от директора' : 'Сообщение от менеджера';
    } catch {
      return 'Сообщение от менеджера';
    }
  };
  const [message, setMessage] = useState({ title: getDefaultTitle(), body: '' });
  const [requireReply, setRequireReply] = useState(false);
  const [templateForm, setTemplateForm] = useState({ title: '', body: '' });
  const [selectingAll, setSelectingAll] = useState(false);
  const resetFilters = () => {
    setMeta({ category: 'inactive_no_epl', days: 7, balanceLt: 200 });
    setQ('');
    setSelected({});
    setItems([]);
    setTotal(0);
    setOffset(0);
    setTimeout(() => load(), 0);
  };

  const load = async () => {
    setLoading(true);
    try {
      const params = { category: meta.category, limit, offset: 0 };
      if (meta.category === 'inactive_no_epl') params.days = meta.days;
      if (meta.category === 'low_balance') params.balanceLt = meta.balanceLt;
      if (q.trim()) params.q = q.trim();
      const data = await getDriversMonitoring(params, parkId);
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(Number(data.total || 0));
      setOffset(Number(data.offset || 0));
    } catch (e) {
      setItems([]);
      setTotal(0);
      setOffset(0);
      showToast(e.response?.data?.error || e.message || 'Не удалось загрузить', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (loading) return;
    const nextOffset = items.length;
    if (total && nextOffset >= total) return;
    setLoading(true);
    try {
      const params = { category: meta.category, limit, offset: nextOffset };
      if (meta.category === 'inactive_no_epl') params.days = meta.days;
      if (meta.category === 'low_balance') params.balanceLt = meta.balanceLt;
      if (q.trim()) params.q = q.trim();
      const data = await getDriversMonitoring(params, parkId);
      const nextItems = Array.isArray(data.items) ? data.items : [];
      setItems((prev) => [...prev, ...nextItems]);
      setTotal(Number(data.total || 0));
      setOffset(Number(data.offset || nextOffset));
    } catch (e) {
      showToast(e.response?.data?.error || e.message || 'Не удалось загрузить ещё', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const rows = await getBroadcastTemplates(parkId);
      setTemplates(Array.isArray(rows) ? rows : []);
    } catch {
      setTemplates([]);
    } finally {
      setTemplatesLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [meta.category, meta.days, meta.balanceLt, parkId]);
  useEffect(() => { loadTemplates(); /* eslint-disable-next-line */ }, [parkId]);
  useEffect(() => {
    if (qDebounceRef.current) clearTimeout(qDebounceRef.current);
    qDebounceRef.current = setTimeout(() => {
      qDebounceRef.current = null;
      setSelected({});
      setItems([]);
      setTotal(0);
      setOffset(0);
      load();
    }, 350);
    return () => { if (qDebounceRef.current) clearTimeout(qDebounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const filtered = useMemo(() => items, [items]);
  const selectedIds = useMemo(
    () => Object.keys(selected).filter((k) => selected[k]).map((k) => parseInt(k, 10)).filter(Boolean),
    [selected]
  );

  const category = CATEGORIES.find((c) => c.id === meta.category) || CATEGORIES[0];
  const ToneIcon = category.icon;

  const daysSince = (lastEplAt) => {
    const d = parseUtc(lastEplAt);
    if (!d || Number.isNaN(d.getTime())) return null;
    const diff = Date.now() - d.getTime();
    return Math.floor(diff / (24 * 60 * 60 * 1000));
  };

  const toggleOne = (userId) => setSelected((prev) => ({ ...prev, [userId]: !prev[userId] }));
  const toggleAllFiltered = (value) => {
    const next = { ...selected };
    filtered.forEach((r) => { next[r.userId] = !!value; });
    setSelected(next);
  };
  const clearSelection = () => setSelected({});

  const selectAllFromServer = async () => {
    try {
      setSelectingAll(true);
      const params = { category: meta.category };
      if (meta.category === 'inactive_no_epl') params.days = meta.days;
      if (meta.category === 'low_balance') params.balanceLt = meta.balanceLt;
      if (q.trim()) params.q = q.trim();
      const data = await getDriversMonitoringIds(params, parkId);
      const ids = Array.isArray(data?.ids) ? data.ids : [];
      if (ids.length === 0) {
        showToast('Список пустой', 'error');
        return;
      }
      const next = {};
      ids.forEach((id) => { next[id] = true; });
      setSelected(next);
      if (data?.truncated) {
        showToast(`Выбрано ${ids.length} (лимит ${data?.max || ids.length}). Уточните фильтры.`, 'error');
      } else {
        showToast(`Выбрано: ${ids.length}`, 'success');
      }
    } catch (e) {
      showToast(e.response?.data?.error || e.message || 'Не удалось выбрать весь список', 'error');
    } finally {
      setSelectingAll(false);
    }
  };

  const applyTemplate = (tpl) => {
    if (!tpl) return;
    setMessage({ title: tpl.title || getDefaultTitle(), body: tpl.body || '' });
    setComposerOpen(true);
  };

  const sendBroadcast = async () => {
    if (selectedIds.length === 0) return showToast('Выбери водителей чекбоксами', 'error');
    if (!message.body.trim()) return showToast('Текст уведомления обязателен', 'error');
    try {
      setSending(true);
      await sendDriversBroadcast(selectedIds, message.title, message.body, parkId, { requireReply: !!requireReply });
      showToast(`Отправлено: ${selectedIds.length}`, 'success');
      if (typeof onSent === 'function') onSent({ requireReply: !!requireReply });
      clearSelection();
      setMessage((m) => ({ ...m, body: '' }));
      setRequireReply(false);
      setComposerOpen(false);
    } catch (e) {
      showToast(e.response?.data?.error || e.message || 'Ошибка рассылки', 'error');
    } finally {
      setSending(false);
    }
  };

  const openCreateTemplate = () => {
    setTemplateForm({ title: message.title || '', body: message.body || '' });
    setTemplateModal({ type: 'create' });
  };
  const openEditTemplate = (tpl) => {
    setTemplateForm({ title: tpl.title || '', body: tpl.body || '' });
    setTemplateModal({ type: 'edit', id: tpl.id });
  };

  const saveTemplate = async () => {
    const title = (templateForm.title || '').trim();
    const body = (templateForm.body || '').trim();
    if (!title) return showToast('Укажи название', 'error');
    if (!body) return showToast('Укажи текст', 'error');
    try {
      if (templateModal?.type === 'create') {
        await createBroadcastTemplate(title, body, parkId);
        showToast('Шаблон создан', 'success');
      } else if (templateModal?.type === 'edit' && templateModal?.id) {
        await updateBroadcastTemplate(templateModal.id, title, body, parkId);
        showToast('Шаблон обновлён', 'success');
      }
      setTemplateModal(null);
      loadTemplates();
    } catch (e) {
      showToast(e.response?.data?.error || e.message || 'Ошибка сохранения', 'error');
    }
  };

  const deleteTemplate = async (id) => {
    if (!id) return;
    if (!window.confirm('Удалить шаблон?')) return;
    try {
      await deleteBroadcastTemplate(id, parkId);
      showToast('Шаблон удалён', 'success');
      loadTemplates();
    } catch (e) {
      showToast(e.response?.data?.error || e.message || 'Ошибка удаления', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full shadow-sm ${
            sceneNight
              ? 'border border-white/15 bg-white/[0.06] backdrop-blur-xl text-slate-100 ring-1 ring-white/10'
              : 'bg-white/75 backdrop-blur-md border border-white/60 shadow-slate-900/10'
          }`}
        >
          <Users className={`w-5 h-5 ${sceneNight ? 'text-teal-300' : 'text-teal-600'}`} />
          <h2 className={`text-sm sm:text-base font-bold tracking-wide uppercase ${sceneNight ? '' : 'text-slate-900'}`}>
            Рассылки · мониторинг
          </h2>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={load}
          className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl font-semibold transition ${
            sceneNight
              ? 'border border-white/12 bg-white/[0.08] text-slate-200 hover:bg-white/[0.12]'
              : 'border border-white/55 bg-white/45 text-slate-800 hover:bg-white/60 backdrop-blur-md'
          }`}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Обновить
        </motion.button>
      </div>

      <div className={`rounded-2xl shadow-xl overflow-hidden ${operationsShell(sceneNight)}`}>
        <div
          className={`border-b px-4 py-3 ${
            sceneNight ? 'border-white/12 bg-white/[0.05] backdrop-blur-md' : 'border-slate-100 bg-slate-50/80'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className={`flex items-center gap-2 text-sm font-semibold ${sceneNight ? 'text-slate-200' : 'text-slate-700'}`}>
              <Filter className={`w-4 h-4 ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`} />
              Фильтры
            </div>
            <button
              type="button"
              onClick={resetFilters}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                sceneNight
                  ? 'border border-white/12 bg-white/[0.08] text-slate-200 hover:bg-white/[0.12]'
                  : 'border border-white/50 bg-white/50 hover:bg-white/70 text-slate-700'
              }`}
            >
              Сброс
            </button>
          </div>
        </div>
        <div className={`px-4 py-3 grid grid-cols-1 sm:grid-cols-4 gap-3 border-b ${sceneNight ? 'border-white/[0.08]' : 'border-slate-100'}`}>
          <div className="flex flex-col gap-1">
            <label className={`text-[11px] font-semibold uppercase tracking-wide ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>
              Категория
            </label>
            <div className="grid grid-cols-1 gap-2">
              <select
                value={meta.category}
                onChange={(e) => setMeta((p) => ({ ...p, category: e.target.value }))}
                className={`px-3 py-2 rounded-xl text-sm font-semibold ${
                  sceneNight
                    ? 'border border-white/15 bg-white/[0.06] backdrop-blur-md text-slate-100'
                    : 'border border-white/50 bg-white/55 text-slate-900 backdrop-blur-sm'
                }`}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => {
                  const active = meta.category === c.id;
                  const Icon = c.icon;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setMeta((p) => ({ ...p, category: c.id }))}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border ${
                        active
                          ? 'bg-teal-600 text-white border-teal-600'
                          : sceneNight
                            ? 'bg-white/[0.06] text-slate-300 border-white/12 hover:bg-white/10'
                            : 'bg-white/60 text-slate-700 border-white/55 hover:bg-white/85 backdrop-blur-sm'
                      }`}
                      title={c.label}
                    >
                      <Icon className="w-4 h-4" />
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className={`text-[11px] font-semibold uppercase tracking-wide ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>
              Дней без ЭПЛ
            </label>
            <input
              type="number"
              min="1"
              value={meta.days}
              onChange={(e) => setMeta((p) => ({ ...p, days: parseInt(e.target.value || '7', 10) || 7 }))}
              disabled={meta.category !== 'inactive_no_epl'}
              className={`px-3 py-2 rounded-xl text-sm disabled:opacity-50 ${
                sceneNight
                  ? 'border border-white/15 bg-white/[0.06] backdrop-blur-md text-slate-100'
                  : 'border border-white/50 bg-white/55 text-slate-900 disabled:bg-white/30 backdrop-blur-sm'
              }`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={`text-[11px] font-semibold uppercase tracking-wide ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>
              Баланс &lt;
            </label>
            <input
              type="number"
              min="0"
              value={meta.balanceLt}
              onChange={(e) => setMeta((p) => ({ ...p, balanceLt: parseInt(e.target.value || '200', 10) || 200 }))}
              disabled={meta.category !== 'low_balance'}
              className={`px-3 py-2 rounded-xl text-sm disabled:opacity-50 ${
                sceneNight
                  ? 'border border-white/15 bg-white/[0.06] backdrop-blur-md text-slate-100'
                  : 'border border-white/50 bg-white/55 text-slate-900 disabled:bg-white/30 backdrop-blur-sm'
              }`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={`text-[11px] font-semibold uppercase tracking-wide ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>
              Поиск
            </label>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ФИО / телефон"
              className={`px-3 py-2 rounded-xl text-sm ${
                sceneNight
                  ? 'border border-white/15 bg-white/[0.06] text-slate-100 placeholder:text-slate-400 backdrop-blur-md'
                  : 'border border-white/50 bg-white/55 text-slate-900 placeholder:text-slate-500 backdrop-blur-sm'
              }`}
            />
          </div>
        </div>

        <div className={`px-4 py-3 flex flex-wrap items-center justify-between gap-2 border-b ${sceneNight ? 'border-white/[0.08]' : 'border-slate-100'}`}>
          <div className={`flex items-center gap-2 text-xs ${sceneNight ? 'text-slate-400' : 'text-slate-600'}`}>
            <ToneIcon className={`w-4 h-4 ${sceneNight ? 'text-slate-500' : 'text-slate-500'}`} />
            <span className="font-semibold">{category.label}</span>
            <span className={sceneNight ? 'text-slate-500' : 'text-slate-400'}>•</span>
            <span>Найдено: {items.length}</span>
            <span>Всего: {total}</span>
            <span>Выбрано: {selectedIds.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => toggleAllFiltered(true)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                sceneNight
                  ? 'bg-white/[0.08] hover:bg-white/[0.12] text-slate-200 border border-white/10'
                  : 'bg-white/50 hover:bg-white/75 text-slate-700 border border-white/50 backdrop-blur-sm'
              }`}
            >
              Выбрать на экране
            </button>
            <button
              type="button"
              onClick={selectAllFromServer}
              disabled={selectingAll}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold disabled:opacity-50 transition ${
                sceneNight
                  ? 'bg-white/[0.08] hover:bg-white/[0.12] text-slate-200 border border-white/10'
                  : 'bg-white/50 hover:bg-white/75 text-slate-700 border border-white/50 backdrop-blur-sm'
              }`}
            >
              {selectingAll ? 'Выбираем…' : 'Выбрать все'}
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                sceneNight
                  ? 'bg-white/[0.08] hover:bg-white/[0.12] text-slate-200 border border-white/10'
                  : 'bg-white/50 hover:bg-white/75 text-slate-700 border border-white/50 backdrop-blur-sm'
              }`}
            >
              Снять все
            </button>
            <button
              type="button"
              onClick={() => setComposerOpen(true)}
              className="freight-btn-primary-compact"
            >
              <Send className="w-4 h-4" />
              Рассылка
            </button>
          </div>
        </div>

        {loading && items.length === 0 ? (
          <div className={`p-10 text-center ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>Загрузка…</div>
        ) : items.length === 0 ? (
          <div className={`p-10 text-center ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>Ничего не найдено</div>
        ) : (
          <div className={sceneNight ? 'divide-y divide-white/[0.08]' : 'divide-y divide-slate-100'}>
            {filtered.map((r) => {
              const checked = !!selected[r.userId];
              const last = r.lastEplAt ? formatDateMsk(r.lastEplAt) : null;
              const ds = daysSince(r.lastEplAt);
              return (
                <div
                  key={r.userId}
                  className={`px-4 py-3 flex items-start gap-3 ${sceneNight ? 'hover:bg-white/[0.04]' : 'hover:bg-slate-50/80'}`}
                >
                  <button
                    type="button"
                    onClick={() => toggleOne(r.userId)}
                    className={sceneNight ? 'mt-0.5 text-slate-400' : 'mt-0.5 text-slate-600'}
                    title={checked ? 'Убрать' : 'Выбрать'}
                  >
                    {checked ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className={`font-semibold truncate ${sceneNight ? 'text-slate-100' : 'text-slate-900'}`}>
                          {r.fullName || r.phone || `#${r.userId}`}
                        </p>
                        <p className={`text-xs truncate ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>
                          {r.parkName ? `Парк: ${r.parkName}` : 'Парк'} {r.phone ? `· ${r.phone}` : ''}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`font-bold tabular-nums ${sceneNight ? 'text-slate-50' : 'text-slate-900'}`}>
                          {Number(r.balance || 0).toLocaleString('ru-RU')} ₽
                        </p>
                        <p className={`text-[11px] ${sceneNight ? 'text-slate-500' : 'text-slate-500'}`}>
                          ЭПЛ 7д: {r.epl7d || 0} · 30д: {r.epl30d || 0}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          sceneNight ? 'bg-white/[0.08] text-slate-300 border border-white/10' : 'bg-slate-100/90 text-slate-700'
                        }`}
                      >
                        Последняя ЭПЛ: {last || 'никогда'}
                      </span>
                      {ds != null && (
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                            sceneNight ? 'bg-amber-500/15 text-amber-200 border border-amber-400/25' : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {ds} дн. назад
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {items.length < total && (
          <div className="p-4 flex justify-center">
            <button
              type="button"
              onClick={loadMore}
              disabled={loading}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold disabled:opacity-50"
            >
              {loading ? 'Загрузка…' : 'Показать ещё'}
            </button>
          </div>
        )}
      </div>

      {/* Композер */}
      {composerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setComposerOpen(false)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <p className="font-bold text-slate-900">Рассылка</p>
              <button type="button" onClick={() => setComposerOpen(false)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Заголовок</label>
                  <input
                    value={message.title}
                    onChange={(e) => setMessage((p) => ({ ...p, title: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Шаблоны</label>
                  <div className="flex gap-2">
                    <select
                      className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm"
                      defaultValue=""
                      onChange={(e) => {
                        const id = parseInt(e.target.value, 10);
                        const tpl = templates.find((t) => t.id === id);
                        if (tpl) applyTemplate(tpl);
                        e.target.value = '';
                      }}
                      disabled={templatesLoading}
                    >
                      <option value="">{templatesLoading ? 'Загрузка…' : 'Выбрать шаблон'}</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>{t.title}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={openCreateTemplate}
                      className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold"
                      title="Сохранить как шаблон"
                    >
                      <Bookmark className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">Нужен ответ водителя</p>
                  <p className="text-[11px] text-slate-500 truncate">
                    Если включить — создастся диалог “Сообщение от парка”, водитель сможет ответить, ответы будут в вкладке “Ответы”.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={requireReply}
                    onChange={(e) => setRequireReply(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:bg-teal-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:border-slate-200 after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
                </label>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Текст</label>
                <textarea
                  value={message.body}
                  onChange={(e) => setMessage((p) => ({ ...p, body: e.target.value }))}
                  rows={7}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm resize-none"
                  placeholder="Текст уведомления…"
                />
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                <p className="text-xs text-slate-500">Выбрано получателей: <span className="font-semibold text-slate-700">{selectedIds.length}</span></p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setComposerOpen(false)}
                    className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold"
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    onClick={sendBroadcast}
                    disabled={sending}
                    className="freight-btn-primary gap-2 disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                    {sending ? 'Отправка…' : 'Отправить'}
                  </button>
                </div>
              </div>

              {/* Управление шаблонами */}
              {templates.length > 0 && (
                <div className="pt-3 border-t border-slate-100">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Шаблоны</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {templates.map((t) => (
                      <div key={t.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 flex items-center justify-between gap-2">
                        <button type="button" className="text-left flex-1 min-w-0" onClick={() => applyTemplate(t)}>
                          <p className="text-sm font-semibold text-slate-800 truncate">{t.title}</p>
                          <p className="text-[11px] text-slate-500 truncate">{t.body}</p>
                        </button>
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => openEditTemplate(t)} className="p-2 rounded-lg hover:bg-white" title="Редактировать">
                            <Edit3 className="w-4 h-4 text-slate-600" />
                          </button>
                          <button type="button" onClick={() => deleteTemplate(t.id)} className="p-2 rounded-lg hover:bg-white" title="Удалить">
                            <Trash2 className="w-4 h-4 text-red-600" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* Модалка шаблона */}
      {templateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setTemplateModal(null)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <p className="font-bold text-slate-900">{templateModal.type === 'create' ? 'Новый шаблон' : 'Редактировать шаблон'}</p>
              <button type="button" onClick={() => setTemplateModal(null)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Название</label>
                <input
                  value={templateForm.title}
                  onChange={(e) => setTemplateForm((p) => ({ ...p, title: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Текст</label>
                <textarea
                  value={templateForm.body}
                  onChange={(e) => setTemplateForm((p) => ({ ...p, body: e.target.value }))}
                  rows={6}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm resize-none"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={() => setTemplateModal(null)} className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold">
                  Отмена
                </button>
                <button type="button" onClick={saveTemplate} className="freight-btn-primary">
                  Сохранить
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

