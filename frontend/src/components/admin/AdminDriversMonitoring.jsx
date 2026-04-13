import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Users, Filter, RefreshCw, AlertTriangle, Wallet, Car, Clock, Send, MessageSquare, Bookmark, Trash2, Edit3, CheckSquare, Square, X } from 'lucide-react';
import api from '../../api';
import { useToast } from '../../hooks/useToast';
import { formatDateMsk, parseUtc } from '../../utils/dateFormatter';
import { operationsFieldClass, operationsInset, operationsShell } from '../../utils/operationsUi';

const CATEGORIES = [
  { id: 'inactive_no_epl', label: 'Не делали ЭПЛ давно', icon: Clock, tone: 'amber' },
  { id: 'low_balance', label: 'Низкий баланс', icon: Wallet, tone: 'red' },
  { id: 'no_car', label: 'Без авто', icon: Car, tone: 'slate' },
];

export default function AdminDriversMonitoring({ sceneNight = false }) {
  const { showToast } = useToast();
  const [parks, setParks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ category: 'inactive_no_epl', days: 7, balanceLt: 200, parkId: '', accountAge: 'all' });
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
  const [message, setMessage] = useState({ title: 'Сообщение от администрации', body: '' });
  const [templateForm, setTemplateForm] = useState({ title: '', body: '' });
  const [selectingAll, setSelectingAll] = useState(false);

  const loadParks = async () => {
    try {
      const res = await api.get('/admin/parks');
      setParks(res.data?.parks || res.data || []);
    } catch {
      setParks([]);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (meta.parkId) params.parkId = meta.parkId;
      params.category = meta.category;
      if (meta.category === 'inactive_no_epl') params.days = meta.days;
      if (meta.category === 'low_balance') params.balanceLt = meta.balanceLt;
      if (q.trim()) params.q = q.trim();
      if (meta.accountAge && meta.accountAge !== 'all') params.accountAge = meta.accountAge;
      params.limit = limit;
      params.offset = 0;
      const res = await api.get('/admin/drivers/monitoring', { params });
      const data = res.data || {};
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(Number(data.total || 0));
      setOffset(Number(data.offset || 0));
    } catch (e) {
      setItems([]);
      setTotal(0);
      setOffset(0);
      showToast(e.response?.data?.error || e.message || 'Не удалось загрузить мониторинг', 'error');
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
      const params = {};
      if (meta.parkId) params.parkId = meta.parkId;
      params.category = meta.category;
      if (meta.category === 'inactive_no_epl') params.days = meta.days;
      if (meta.category === 'low_balance') params.balanceLt = meta.balanceLt;
      if (q.trim()) params.q = q.trim();
      if (meta.accountAge && meta.accountAge !== 'all') params.accountAge = meta.accountAge;
      params.limit = limit;
      params.offset = nextOffset;
      const res = await api.get('/admin/drivers/monitoring', { params });
      const data = res.data || {};
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
      const res = await api.get('/admin/broadcast-templates');
      setTemplates(Array.isArray(res.data) ? res.data : []);
    } catch {
      setTemplates([]);
    } finally {
      setTemplatesLoading(false);
    }
  };

  useEffect(() => { loadParks(); }, []);
  useEffect(() => {
    // reset selection when filters change (чтобы не отправить рассылку не тем)
    setSelected({});
    setItems([]);
    setTotal(0);
    setOffset(0);
    load();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [meta.category, meta.days, meta.balanceLt, meta.parkId, meta.accountAge]);
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
    return () => {
      if (qDebounceRef.current) clearTimeout(qDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  useEffect(() => { loadTemplates(); }, []);

  const filtered = useMemo(() => items, [items]);
  const selectedIds = useMemo(() => Object.keys(selected).filter((k) => selected[k]).map((k) => parseInt(k, 10)).filter(Boolean), [selected]);

  const toggleOne = (userId) => {
    setSelected((prev) => ({ ...prev, [userId]: !prev[userId] }));
  };

  const toggleAllFiltered = (value) => {
    const next = { ...selected };
    filtered.forEach((r) => { next[r.userId] = !!value; });
    setSelected(next);
  };

  const selectAllFromServer = async () => {
    try {
      setSelectingAll(true);
      const params = {};
      if (meta.parkId) params.parkId = meta.parkId;
      params.category = meta.category;
      if (meta.category === 'inactive_no_epl') params.days = meta.days;
      if (meta.category === 'low_balance') params.balanceLt = meta.balanceLt;
      if (q.trim()) params.q = q.trim();
      if (meta.accountAge && meta.accountAge !== 'all') params.accountAge = meta.accountAge;
      const res = await api.get('/admin/drivers/monitoring/ids', { params });
      const ids = Array.isArray(res.data?.ids) ? res.data.ids : [];
      if (ids.length === 0) {
        showToast('Список пустой', 'error');
        return;
      }
      const next = {};
      ids.forEach((id) => { next[id] = true; });
      setSelected(next);
      if (res.data?.truncated) {
        showToast(`Выбрано ${ids.length} (лимит ${res.data?.max || ids.length}). Уточните фильтры.`, 'error');
      } else {
        showToast(`Выбрано: ${ids.length}`, 'success');
      }
    } catch (e) {
      showToast(e.response?.data?.error || e.message || 'Не удалось выбрать весь список', 'error');
    } finally {
      setSelectingAll(false);
    }
  };

  const clearSelection = () => setSelected({});

  const applyTemplate = (tpl) => {
    if (!tpl) return;
    setMessage({ title: tpl.title || 'Сообщение от администрации', body: tpl.body || '' });
    setComposerOpen(true);
  };

  const sendBroadcast = async () => {
    if (selectedIds.length === 0) {
      showToast('Выбери водителей чекбоксами', 'error');
      return;
    }
    if (!message.body.trim()) {
      showToast('Текст уведомления обязателен', 'error');
      return;
    }
    try {
      setSending(true);
      await api.post('/admin/drivers/broadcast', { userIds: selectedIds, title: message.title, body: message.body });
      showToast(`Отправлено: ${selectedIds.length}`, 'success');
      clearSelection();
      setMessage((m) => ({ ...m, body: '' }));
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
    const title = templateForm.title.trim();
    const body = templateForm.body.trim();
    if (!title) { showToast('Укажи название', 'error'); return; }
    if (!body) { showToast('Укажи текст', 'error'); return; }
    try {
      if (templateModal?.type === 'edit') {
        await api.put(`/admin/broadcast-templates/${templateModal.id}`, { title, body });
        showToast('Шаблон обновлён', 'success');
      } else {
        await api.post('/admin/broadcast-templates', { title, body });
        showToast('Шаблон сохранён', 'success');
      }
      setTemplateModal(null);
      await loadTemplates();
    } catch (e) {
      showToast(e.response?.data?.error || e.message || 'Ошибка сохранения', 'error');
    }
  };

  const deleteTemplate = async (tpl) => {
    if (!window.confirm('Удалить шаблон?')) return;
    try {
      await api.delete(`/admin/broadcast-templates/${tpl.id}`);
      showToast('Удалено', 'success');
      await loadTemplates();
    } catch (e) {
      showToast(e.response?.data?.error || e.message || 'Ошибка удаления', 'error');
    }
  };

  const category = CATEGORIES.find((c) => c.id === meta.category) || CATEGORIES[0];
  const ToneIcon = category.icon;
  const night = sceneNight;
  const shell = operationsShell(night);
  const inset = operationsInset(night);
  const fc = operationsFieldClass(night, { focus: 'teal' });

  const daysSince = (lastEplAt) => {
    const d = parseUtc(lastEplAt);
    if (!d || Number.isNaN(d.getTime())) return null;
    const diff = Date.now() - d.getTime();
    return Math.floor(diff / (24 * 60 * 60 * 1000));
  };

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
          <Users className={`w-5 h-5 ${night ? 'text-teal-300' : 'text-teal-600'}`} />
          <h2
            className={`text-sm sm:text-base font-bold tracking-wide uppercase ${
              night ? 'text-slate-100' : 'text-slate-900'
            }`}
          >
            Рассылки · мониторинг
          </h2>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={load}
          className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl font-semibold border ${
            night
              ? 'border-white/15 bg-white/[0.08] text-slate-200 hover:bg-white/[0.12]'
              : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Обновить
        </motion.button>
      </div>

      <div className={`rounded-2xl overflow-hidden ${shell}`}>
        <div
          className={`px-4 py-3 border-b ${night ? 'border-white/10 bg-white/[0.05]' : 'border-slate-100 bg-slate-50/80'}`}
        >
          <div className={`flex items-center gap-2 text-sm font-semibold ${night ? 'text-slate-200' : 'text-slate-700'}`}>
            <Filter className={`w-4 h-4 ${night ? 'text-slate-400' : 'text-slate-500'}`} />
            Фильтры
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
              value={meta.parkId}
              onChange={(e) => setMeta((m) => ({ ...m, parkId: e.target.value }))}
              className={fc}
            >
              <option value="">Все парки</option>
              {parks.map((p) => (
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
              Категория
            </label>
            <select
              value={meta.category}
              onChange={(e) => setMeta((m) => ({ ...m, category: e.target.value }))}
              className={fc}
            >
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label
              className={`text-[11px] font-semibold uppercase tracking-wide ${
                night ? 'text-slate-400' : 'text-slate-500'
              }`}
            >
              Возраст акка
            </label>
            <select
              value={meta.accountAge}
              onChange={(e) => setMeta((m) => ({ ...m, accountAge: e.target.value }))}
              className={fc}
            >
              <option value="all">Все</option>
              <option value="1-7">1-7 дней</option>
              <option value="8-30">8-30 дней</option>
              <option value="30+">30+ дней</option>
            </select>
          </div>

          {meta.category === 'inactive_no_epl' && (
            <div className="flex flex-col gap-1">
              <label
                className={`text-[11px] font-semibold uppercase tracking-wide ${
                  night ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                Дней без ЭПЛ
              </label>
              <input
                type="number"
                min={1}
                max={365}
                value={meta.days}
                onChange={(e) => setMeta((m) => ({ ...m, days: Number(e.target.value || 7) }))}
                className={fc}
              />
            </div>
          )}

          {meta.category === 'low_balance' && (
            <div className="flex flex-col gap-1">
              <label
                className={`text-[11px] font-semibold uppercase tracking-wide ${
                  night ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                Баланс ниже (₽)
              </label>
              <input
                type="number"
                min={0}
                value={meta.balanceLt}
                onChange={(e) => setMeta((m) => ({ ...m, balanceLt: Number(e.target.value || 0) }))}
                className={fc}
              />
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label
              className={`text-[11px] font-semibold uppercase tracking-wide ${
                night ? 'text-slate-400' : 'text-slate-500'
              }`}
            >
              Поиск
            </label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ФИО / телефон"
              className={fc}
            />
          </div>
        </div>

        <div
          className={`px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-sm border-b ${
            night ? 'border-white/10' : 'border-slate-100'
          }`}
        >
          <div
            className={`inline-flex items-center gap-2 font-semibold ${night ? 'text-slate-200' : 'text-slate-700'}`}
          >
            <ToneIcon className={`w-4 h-4 ${night ? 'text-slate-400' : 'text-slate-600'}`} />
            {category.label}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={night ? 'text-slate-400' : 'text-slate-500'}>
              Найдено:{' '}
              <span className={`font-semibold ${night ? 'text-slate-100' : 'text-slate-800'}`}>{filtered.length}</span>
            </span>
            {total > 0 && (
              <span className={night ? 'text-slate-400' : 'text-slate-500'}>
                Всего:{' '}
                <span className={`font-semibold ${night ? 'text-slate-100' : 'text-slate-800'}`}>{total}</span>
              </span>
            )}
            <span className={night ? 'text-slate-400' : 'text-slate-500'}>
              Выбрано:{' '}
              <span className={`font-semibold ${night ? 'text-slate-100' : 'text-slate-800'}`}>
                {selectedIds.length}
              </span>
            </span>
            <button
              type="button"
              onClick={selectAllFromServer}
              disabled={selectingAll}
              className={`px-3 py-1.5 rounded-full font-semibold text-xs ${
                night
                  ? 'bg-white/[0.08] hover:bg-white/[0.12] text-slate-200 border border-white/12'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              {selectingAll ? 'Выбираю…' : 'Выбрать все'}
            </button>
            <button
              type="button"
              onClick={() => toggleAllFiltered(false)}
              className={`px-3 py-1.5 rounded-full font-semibold text-xs ${
                night
                  ? 'bg-white/[0.08] hover:bg-white/[0.12] text-slate-200 border border-white/12'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              Снять все
            </button>
            <button
              type="button"
              onClick={() => setComposerOpen((v) => !v)}
              className="freight-btn-primary-compact rounded-full"
            >
              <Send className="w-3.5 h-3.5" />
              Рассылка
            </button>
          </div>
        </div>

        {/* Композер рассылки */}
        {composerOpen && (
          <div
            className={`px-4 py-4 border-b ${
              night
                ? 'border-white/10 bg-teal-500/[0.08] backdrop-blur-md'
                : 'bg-gradient-to-r from-teal-50 to-slate-50 border-slate-200'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div
                className={`inline-flex items-center gap-2 text-sm font-semibold ${
                  night ? 'text-slate-100' : 'text-slate-800'
                }`}
              >
                <MessageSquare className={`w-4 h-4 ${night ? 'text-teal-300' : 'text-teal-600'}`} />
                Рассылка (уведомления на сайте)
              </div>
              <button
                type="button"
                onClick={() => setComposerOpen(false)}
                className={`p-2 rounded-xl ${night ? 'hover:bg-white/10 text-slate-300' : 'hover:bg-white/60 text-slate-600'}`}
                title="Свернуть"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div className="lg:col-span-2 space-y-2">
                <label className="block">
                  <span
                    className={`text-[11px] font-semibold uppercase tracking-wide ${
                      night ? 'text-slate-400' : 'text-slate-600'
                    }`}
                  >
                    Заголовок
                  </span>
                  <input
                    value={message.title}
                    onChange={(e) => setMessage((m) => ({ ...m, title: e.target.value }))}
                    className={`mt-1 w-full rounded-xl ${fc}`}
                    placeholder="Сообщение от администрации"
                  />
                </label>
                <label className="block">
                  <span
                    className={`text-[11px] font-semibold uppercase tracking-wide ${
                      night ? 'text-slate-400' : 'text-slate-600'
                    }`}
                  >
                    Текст *
                  </span>
                  <textarea
                    value={message.body}
                    onChange={(e) => setMessage((m) => ({ ...m, body: e.target.value }))}
                    rows={4}
                    className={`mt-1 w-full rounded-xl ${fc}`}
                    placeholder="Например: Бро, проверь баланс / давно не делал ЭПЛ…"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={sendBroadcast}
                    disabled={sending || selectedIds.length === 0}
                    className="freight-btn-primary gap-2 disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                    {sending ? 'Отправляю…' : `Отправить (${selectedIds.length})`}
                  </button>
                  <button
                    type="button"
                    onClick={openCreateTemplate}
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border font-semibold ${
                      night
                        ? 'border-white/15 bg-white/[0.06] text-slate-200 hover:bg-white/10'
                        : 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <Bookmark className={`w-4 h-4 ${night ? 'text-teal-300' : 'text-teal-600'}`} />
                    Сохранить как шаблон
                  </button>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className={`px-4 py-2 rounded-xl border font-semibold ${
                      night
                        ? 'border-white/15 bg-white/[0.06] text-slate-200 hover:bg-white/10'
                        : 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    Очистить выбор
                  </button>
                </div>
              </div>

              <div className={`rounded-2xl p-3 ${night ? inset : 'bg-white border border-slate-200'}`}>
                <div className="flex items-center justify-between">
                  <p className={`text-sm font-semibold ${night ? 'text-slate-100' : 'text-slate-800'}`}>Шаблоны</p>
                  <button
                    type="button"
                    onClick={loadTemplates}
                    className={`text-xs font-semibold hover:underline ${
                      night ? 'text-slate-400' : 'text-slate-600'
                    }`}
                    disabled={templatesLoading}
                  >
                    обновить
                  </button>
                </div>
                {templates.length === 0 ? (
                  <p className={`text-xs mt-2 ${night ? 'text-slate-500' : 'text-slate-500'}`}>Нет шаблонов</p>
                ) : (
                  <div className="mt-2 space-y-2 max-h-48 overflow-y-auto pr-1">
                    {templates.map((t) => (
                      <div
                        key={t.id}
                        className={`rounded-xl p-2.5 ${
                          night ? 'border border-white/10 bg-white/[0.04]' : 'border border-slate-200 bg-slate-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button type="button" onClick={() => applyTemplate(t)} className="text-left min-w-0 flex-1">
                            <p
                              className={`text-sm font-semibold truncate ${
                                night ? 'text-slate-100' : 'text-slate-900'
                              }`}
                            >
                              {t.title}
                            </p>
                            <p className={`text-xs line-clamp-2 ${night ? 'text-slate-400' : 'text-slate-600'}`}>
                              {t.body}
                            </p>
                          </button>
                          <div className="flex gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => openEditTemplate(t)}
                              className={`p-1.5 rounded-lg ${night ? 'hover:bg-white/10' : 'hover:bg-white'}`}
                              title="Редактировать"
                            >
                              <Edit3 className={`w-4 h-4 ${night ? 'text-slate-400' : 'text-slate-600'}`} />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteTemplate(t)}
                              className={`p-1.5 rounded-lg ${night ? 'hover:bg-white/10' : 'hover:bg-white'}`}
                              title="Удалить"
                            >
                              <Trash2 className={`w-4 h-4 ${night ? 'text-red-400' : 'text-red-600'}`} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {loading && items.length === 0 ? (
          <div className={`p-6 ${night ? 'text-slate-400' : 'text-slate-500'}`}>Загрузка…</div>
        ) : filtered.length === 0 ? (
          <div className={`p-6 flex items-center gap-2 ${night ? 'text-slate-400' : 'text-slate-500'}`}>
            <AlertTriangle className="w-4 h-4" />
            Ничего не найдено.
          </div>
        ) : (
          <div
            className={`max-h-[560px] overflow-y-auto ${night ? 'divide-y divide-white/10' : 'divide-y divide-slate-100'}`}
          >
            {filtered.map((r) => {
              const d = daysSince(r.lastEplAt);
              const regDays = daysSince(r.registeredAt);
              return (
                <div key={r.userId} className={`p-4 ${night ? 'hover:bg-white/[0.04]' : 'hover:bg-slate-50/60'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => toggleOne(r.userId)}
                        className={`mt-0.5 p-1.5 rounded-lg border ${
                          night
                            ? 'border-white/12 bg-white/[0.06] hover:bg-white/10'
                            : 'hover:bg-white border border-slate-200 bg-white'
                        }`}
                        title="Выбрать водителя"
                      >
                        {selected[r.userId] ? (
                          <CheckSquare className={`w-4 h-4 ${night ? 'text-teal-300' : 'text-teal-600'}`} />
                        ) : (
                          <Square className={`w-4 h-4 ${night ? 'text-slate-500' : 'text-slate-500'}`} />
                        )}
                      </button>
                      <div className="min-w-0">
                        <p className={`font-semibold truncate ${night ? 'text-slate-100' : 'text-slate-900'}`}>
                          {r.fullName || r.phone || `Водитель #${r.userId}`}
                        </p>
                        <p className={`text-xs ${night ? 'text-slate-400' : 'text-slate-500'}`}>
                          {r.parkName ? `Парк: ${r.parkName}` : `Парк #${r.parkId}`} · {r.phone || '—'}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold tabular-nums ${night ? 'text-slate-100' : 'text-slate-900'}`}>
                        {Number(r.balance || 0).toLocaleString('ru-RU')} ₽
                      </p>
                      <p className={`text-xs ${night ? 'text-slate-400' : 'text-slate-500'}`}>
                        ЭПЛ 7д: {r.epl7d || 0} · 30д: {r.epl30d || 0}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span
                      className={`px-2 py-1 rounded-full ${
                        night
                          ? 'bg-white/[0.08] text-slate-200 border border-white/10'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      Последняя ЭПЛ: {r.lastEplAt ? formatDateMsk(r.lastEplAt) : 'никогда'}
                      {d != null ? ` · ${d}д` : ''}
                    </span>
                    {r.registeredAt && (
                      <span
                        className={`px-2 py-1 rounded-full border ${
                          night
                            ? 'bg-amber-500/15 border-amber-400/30 text-amber-100'
                            : 'bg-amber-50 border-amber-200 text-amber-900'
                        }`}
                      >
                        Зарегистрирован: {formatDateMsk(r.registeredAt)}
                        {regDays != null ? ` · ${regDays}д` : ''}
                      </span>
                    )}
                    {String(r.innMutationApplied || 0) === '1' && (
                      <span
                        className={`px-2 py-1 rounded-full border ${
                          night
                            ? 'bg-amber-500/15 border-amber-400/30 text-amber-100'
                            : 'bg-amber-50 border-amber-200 text-amber-900'
                        }`}
                      >
                        ИНН подменён
                      </span>
                    )}
                    {meta.category === 'no_car' && (
                      <span
                        className={`px-2 py-1 rounded-full border ${
                          night
                            ? 'bg-amber-500/15 border-amber-400/30 text-amber-100'
                            : 'bg-amber-50 border-amber-200 text-amber-800'
                        }`}
                      >
                        Нет привязки к авто
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {total > filtered.length && (
              <div className="p-4 flex items-center justify-center">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loading}
                  className={`px-4 py-2 rounded-xl border font-semibold disabled:opacity-50 ${
                    night
                      ? 'border-white/15 bg-white/[0.06] text-slate-200 hover:bg-white/10'
                      : 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  {loading ? 'Загружаю…' : 'Показать ещё'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Модалка шаблона */}
      {templateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setTemplateModal(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            className={`rounded-2xl shadow-xl max-w-lg w-full p-6 border ${
              night
                ? 'bg-slate-900/95 border-white/15 text-slate-100 ring-1 ring-white/10'
                : 'bg-white border-slate-200'
            }`}
          >
            <h3 className={`text-lg font-bold mb-4 ${night ? 'text-slate-100' : 'text-slate-800'}`}>
              {templateModal.type === 'edit' ? 'Редактировать шаблон' : 'Новый шаблон'}
            </h3>
            <div className="space-y-3">
              <label className="block">
                <span className={`text-sm font-medium ${night ? 'text-slate-300' : 'text-slate-700'}`}>Название</span>
                <input
                  value={templateForm.title}
                  onChange={(e) => setTemplateForm((f) => ({ ...f, title: e.target.value }))}
                  className={`mt-1 w-full px-3 py-2 rounded-xl border ${
                    night
                      ? 'border-white/15 bg-white/[0.06] text-slate-100'
                      : 'border-slate-300'
                  }`}
                />
              </label>
              <label className="block">
                <span className={`text-sm font-medium ${night ? 'text-slate-300' : 'text-slate-700'}`}>Текст</span>
                <textarea
                  rows={6}
                  value={templateForm.body}
                  onChange={(e) => setTemplateForm((f) => ({ ...f, body: e.target.value }))}
                  className={`mt-1 w-full px-3 py-2 rounded-xl border ${
                    night
                      ? 'border-white/15 bg-white/[0.06] text-slate-100'
                      : 'border-slate-300'
                  }`}
                />
              </label>
            </div>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setTemplateModal(null)}
                className={`flex-1 py-2 rounded-xl font-semibold ${
                  night ? 'bg-white/10 hover:bg-white/15 text-slate-200' : 'bg-slate-100 hover:bg-slate-200'
                }`}
              >
                Отмена
              </button>
              <button type="button" onClick={saveTemplate} className="freight-btn-primary flex-1">
                Сохранить
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

