import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ShieldAlert, Plus, Pencil, Trash2, Radio, BarChart3, ListOrdered, X, LogIn, Wallet, CheckCircle2, BookOpen, ArrowRight } from 'lucide-react';
import api from '../../api';
import { useToast } from '../../hooks/useToast';
import { formatDateMsk } from '../../utils/dateFormatter';
import EvacCard from '../evacuator/EvacCard';
import ParkMultiSelect from './ParkMultiSelect';

function GuideBlock({ title, children }) {
  return (
    <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
      <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <BookOpen className="w-4 h-4 text-slate-500" />
          {title}
        </div>
      </div>
      <div className="px-4 py-4 text-sm text-slate-700 leading-relaxed space-y-3">{children}</div>
    </div>
  );
}

function Step({ idx, title, children }) {
  return (
    <div className="flex items-start gap-3">
      <div className="shrink-0 w-7 h-7 rounded-xl bg-orange-500 text-white flex items-center justify-center font-bold text-xs">
        {idx}
      </div>
      <div className="min-w-0">
        <p className="font-bold text-slate-900">{title}</p>
        <div className="text-slate-700 mt-1 space-y-2">{children}</div>
      </div>
    </div>
  );
}

export default function AdminCommissioners() {
  const { showToast } = useToast();
  const [commissioners, setCommissioners] = useState([]);
  const [parks, setParks] = useState([]);
  const [requests, setRequests] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('list');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ username: '', password: '', fullName: '', phone: '', parkIds: [], fixedFee: '' });
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState(null);
  const [topup, setTopup] = useState({ amount: '', amountType: 'real' });
  const [topupLoading, setTopupLoading] = useState(false);
  const [impersonating, setImpersonating] = useState(false);
  const [loginTargetId, setLoginTargetId] = useState(null);
  const [loginPage, setLoginPage] = useState(1);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [reqStatus, setReqStatus] = useState('all');
  const [reqQ, setReqQ] = useState('');

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/admin/commissioners'),
      api.get('/admin/parks').catch(() => ({ data: [] })),
      api.get('/admin/commissioner/requests'),
      api.get('/admin/commissioner/stats')
    ])
      .then(([cRes, parksRes, reqRes, statsRes]) => {
        setCommissioners(cRes.data || []);
        setParks(parksRes.data?.parks || parksRes.data || []);
        setRequests(reqRes.data || []);
        setStats(statsRes.data || null);
      })
      .catch(() => showToast('Ошибка загрузки', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!commissioners || commissioners.length === 0) {
      setLoginTargetId(null);
      setLoginPage(1);
      return;
    }
    if (loginTargetId == null || !commissioners.some((c) => c.id === loginTargetId)) {
      setLoginTargetId(commissioners[0].id);
    }
    setLoginPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commissioners]);

  const openCreate = () => {
    setForm({ username: '', password: '', fullName: '', phone: '', parkIds: [], fixedFee: '' });
    setModal('create');
  };

  const openEdit = (c) => {
    api.get(`/admin/commissioners/${c.id}`)
      .then((r) => {
        setForm({
          username: r.data.username,
          password: '',
          fullName: r.data.fullName || '',
          phone: r.data.phone || '',
          parkIds: r.data.parkIds || [],
          fixedFee: r.data.fixedFee != null ? String(r.data.fixedFee) : ''
        });
        setModal({ type: 'edit', id: c.id });
      })
      .catch(() => showToast('Ошибка загрузки', 'error'));
  };

  const openProfile = (c) => {
    api.get(`/admin/commissioners/${c.id}`)
      .then((r) => {
        setProfile(r.data || null);
        setTopup({ amount: '', amountType: 'real' });
        setModal({ type: 'profile', id: c.id });
      })
      .catch(() => showToast('Ошибка загрузки профиля', 'error'));
  };

  const impersonate = async (c) => {
    if (impersonating) return;
    if (!c?.id) return;
    try {
      setImpersonating(true);
      const { data } = await api.post(`/admin/impersonate/commissioner/${c.id}`);
      const backup = { token: localStorage.getItem('token'), user: localStorage.getItem('user'), returnTo: '/admin' };
      sessionStorage.setItem('adminImpersonationBackup', JSON.stringify(backup));
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      window.location.href = '/commissioner';
    } catch (err) {
      showToast(err.response?.data?.error || err.message || 'Ошибка входа', 'error');
    } finally {
      setImpersonating(false);
    }
  };

  const submitTopup = async () => {
    if (!profile?.id) return;
    const num = Number(topup.amount);
    if (!num || Number.isNaN(num) || num <= 0) {
      showToast('Введите сумму > 0', 'error');
      return;
    }
    try {
      setTopupLoading(true);
      await api.post(`/admin/commissioners/${profile.id}/balance`, { amount: num, amountType: topup.amountType });
      const r = await api.get(`/admin/commissioners/${profile.id}`);
      setProfile(r.data || null);
      showToast('Баланс пополнен', 'success');
      setTopup((t) => ({ ...t, amount: '' }));
    } catch (e) {
      showToast(e.response?.data?.error || e.message || 'Ошибка пополнения', 'error');
    } finally {
      setTopupLoading(false);
    }
  };

  const handleSave = () => {
    const phone = (form.phone || '').trim();
    if (modal === 'create' && !phone) { showToast('Укажите телефон', 'error'); return; }
    setSaving(true);
    const fixedFeeVal = form.fixedFee === '' ? undefined : (parseFloat(form.fixedFee) || 0);
    const payload = modal === 'create'
      ? { phone, fullName: form.fullName || undefined, parkIds: form.parkIds, fixedFee: fixedFeeVal }
      : { fullName: form.fullName, phone: form.phone, parkIds: form.parkIds, password: form.password || undefined, fixedFee: fixedFeeVal };
    const promise = modal === 'create'
      ? api.post('/admin/commissioners', payload)
      : api.put(`/admin/commissioners/${modal.id}`, payload);
    promise
      .then(() => {
        showToast(modal === 'create' ? 'Комиссар создан' : 'Сохранено', 'success');
        setModal(null);
        load();
      })
      .catch((e) => showToast(e.response?.data?.error || 'Ошибка', 'error'))
      .finally(() => setSaving(false));
  };

  const handleDelete = (id) => {
    if (!window.confirm('Удалить комиссара?')) return;
    api.delete(`/admin/commissioners/${id}`)
      .then(() => { showToast('Удалено', 'success'); load(); })
      .catch((e) => showToast(e.response?.data?.error || 'Ошибка', 'error'));
  };

  const statusLabel = (s) => ({ created: 'Новая', has_responses: 'Есть отклики', confirmed: 'Подтверждена', in_progress: 'В пути', completed: 'Выполнена', cancelled: 'Отменена' }[s] || s);
  const money = (v) => {
    const n = Number(v);
    if (!n || Number.isNaN(n)) return '0 ₽';
    return `${n.toLocaleString('ru-RU')} ₽`;
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-2xl bg-white px-2 py-1.5 shadow gap-1">
        <button
          type="button"
          onClick={() => setTab('list')}
          className={`px-4 py-2 rounded-full text-sm font-semibold ${tab === 'list' ? 'bg-orange-500 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          Комиссары
        </button>
        <button
          type="button"
          onClick={() => setTab('requests')}
          className={`px-4 py-2 rounded-full text-sm font-semibold ${tab === 'requests' ? 'bg-orange-500 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          Заявки
        </button>
        <button
          type="button"
          onClick={() => setTab('stats')}
          className={`px-4 py-2 rounded-full text-sm font-semibold ${tab === 'stats' ? 'bg-orange-500 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          Статистика
        </button>
        <button
          type="button"
          onClick={() => setTab('guide')}
          className={`px-4 py-2 rounded-full text-sm font-semibold ${tab === 'guide' ? 'bg-orange-500 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          Гайд
        </button>
      </div>

      {tab === 'list' && (
        <div className="bg-white rounded-xl shadow border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-orange-500" /> Комиссары</h2>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={openCreate}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-xl font-medium"
            >
              <Plus className="w-4 h-4" /> Добавить
            </motion.button>
          </div>
          {(() => {
            const PAGE_SIZE = 8;
            const pageCount = Math.max(1, Math.ceil(commissioners.length / PAGE_SIZE));
            const safePage = Math.max(1, Math.min(loginPage, pageCount));
            const loginTarget = commissioners.find((c) => c.id === loginTargetId) || null;
            const pagedCommissioners = commissioners.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

            return (
              <>
                <div className="p-4 border-b border-slate-100 bg-slate-50/70">
                  <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800">Вход от лица</p>
                      <p className="text-xs text-slate-500 mt-1">Выбери комиссара и открой его кабинет без выхода из админки.</p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2 sm:items-start sm:justify-end w-full sm:w-auto">
                      <div className="min-w-[220px]">
                        <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                          Профиль комиссара
                        </label>
                        <select
                          value={loginTargetId ?? ''}
                          onChange={(e) => setLoginTargetId(e.target.value ? Number(e.target.value) : null)}
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 bg-white"
                        >
                          {commissioners.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.fullName || c.username} (ID {c.id})
                            </option>
                          ))}
                        </select>
                      </div>

                      <motion.button
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                        onClick={() => impersonate(loginTarget)}
                        disabled={!loginTarget || impersonating}
                        className="freight-btn-primary gap-2 disabled:opacity-50"
                      >
                        <LogIn className="w-4 h-4" />
                        {impersonating ? 'Входим…' : 'Войти'}
                      </motion.button>
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left p-3 font-semibold text-slate-700">Логин / ФИО</th>
                        <th className="text-left p-3 font-semibold text-slate-700">Телефон</th>
                        <th className="text-left p-3 font-semibold text-slate-700">Парки</th>
                        <th className="text-left p-3 font-semibold text-slate-700">На линии</th>
                        <th className="text-left p-3 font-semibold text-slate-700">Ставка (₽)</th>
                        <th className="p-3 w-28" />
                      </tr>
                    </thead>
                    <tbody>
                      {pagedCommissioners.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-6 text-slate-500 text-center">
                            Нет комиссаров
                          </td>
                        </tr>
                      ) : (
                        pagedCommissioners.map((c) => (
                          <tr
                            key={c.id}
                            onClick={() => setLoginTargetId(c.id)}
                            className={`border-b border-slate-100 cursor-pointer hover:bg-slate-50 ${loginTargetId === c.id ? 'bg-teal-50' : ''}`}
                          >
                            <td className="p-3">{c.fullName || c.username}</td>
                            <td className="p-3">{c.phone || '—'}</td>
                            <td className="p-3">
                              {Array.isArray(c.parkIds) && c.parkIds.length
                                ? c.parkIds.map((id) => parks.find((p) => p.id === id)?.name || id).join(', ')
                                : '—'}
                            </td>
                            <td className="p-3">{c.isOnline ? <span className="text-emerald-600 font-medium">Да</span> : 'Нет'}</td>
                            <td className="p-3">{c.fixedFee != null ? c.fixedFee : '—'}</td>
                            <td className="p-3 flex gap-1" onClick={(ev) => ev.stopPropagation()}>
                              <button type="button" onClick={() => openProfile(c)} className="p-1.5 text-slate-600 hover:bg-slate-200 rounded-lg" title="Профиль / баланс">
                                <Wallet className="w-4 h-4" />
                              </button>
                              <button type="button" onClick={() => openEdit(c)} className="p-1.5 text-slate-600 hover:bg-slate-200 rounded-lg" title="Редактировать">
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button type="button" onClick={() => handleDelete(c.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg" title="Удалить">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {commissioners.length > PAGE_SIZE && (
                  <div className="px-4 py-3 flex items-center justify-between gap-3 bg-white border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setLoginPage((p) => Math.max(1, p - 1))}
                      disabled={safePage === 1}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-700 disabled:opacity-40 hover:bg-slate-50"
                    >
                      ← Назад
                    </button>
                    <span className="text-xs text-slate-500">Страница {safePage} из {pageCount}</span>
                    <button
                      type="button"
                      onClick={() => setLoginPage((p) => Math.min(pageCount, p + 1))}
                      disabled={safePage === pageCount}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-700 disabled:opacity-40 hover:bg-slate-50"
                    >
                      Вперёд →
                    </button>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {tab === 'requests' && (
        <div className="bg-white rounded-xl shadow border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-lg font-bold text-slate-800">Заявки комиссару</h2>
              <div className="text-xs text-slate-500">
                Всего: <span className="font-semibold text-slate-700">{requests.length}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {[
                { id: 'all', label: 'Все' },
                { id: 'created', label: 'Новые' },
                { id: 'has_responses', label: 'Отклики' },
                { id: 'confirmed', label: 'Подтвержд.' },
                { id: 'in_progress', label: 'В пути' },
                { id: 'completed', label: 'Выполн.' },
                { id: 'cancelled', label: 'Отмен.' },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setReqStatus(s.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                    reqStatus === s.id
                      ? 'bg-slate-900 text-white border-slate-900 shadow-lg shadow-slate-900/30'
                      : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                  }`}
                >
                  {s.label}
                </button>
              ))}
              <div className="flex-1 min-w-[220px]" />
              <input
                value={reqQ}
                onChange={(e) => setReqQ(e.target.value)}
                placeholder="Поиск: адрес / парк / автор / телефон"
                className="w-full sm:w-[360px] px-3 py-2 rounded-xl border border-slate-200 text-sm"
              />
            </div>
          </div>
          <div className="divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
            {requests.filter((r) => {
              if (reqStatus !== 'all' && String(r.status || '') !== reqStatus) return false;
              const q = reqQ.trim().toLowerCase();
              if (!q) return true;
              const hay = [r.address, r.comment, r.parkName, r.authorName, r.authorPhone].filter(Boolean).join(' ').toLowerCase();
              return hay.includes(q);
            }).length === 0 ? (
              <p className="p-6 text-slate-500">Нет заявок</p>
            ) : (
              requests
                .filter((r) => {
                  if (reqStatus !== 'all' && String(r.status || '') !== reqStatus) return false;
                  const q = reqQ.trim().toLowerCase();
                  if (!q) return true;
                  const hay = [r.address, r.comment, r.parkName, r.authorName, r.authorPhone].filter(Boolean).join(' ').toLowerCase();
                  return hay.includes(q);
                })
                .map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedRequest(r)}
                    className="w-full text-left p-4 hover:bg-slate-50 transition"
                  >
                    <EvacCard
                      title={r.address}
                      status={r.status}
                      subtitle={`Парк: ${r.parkName || r.authorParkId} · ${r.authorName || '—'}${r.createdAt ? ` · ${formatDateMsk(r.createdAt)}` : ''}`}
                      comment={r.comment}
                      chips={[
                        { label: `С водителя: ${money(r.requestFeeAmount)}`, className: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
                        { label: `С комиссара: ${money(r.commissionerFeeAmount)}`, className: 'bg-violet-50 border-violet-200 text-violet-800' },
                        r.responses?.length > 0 ? { label: `Откликов: ${r.responses.length}` } : null,
                      ].filter(Boolean)}
                      className="border-slate-200 shadow-none"
                    />
                  </button>
                ))
            )}
          </div>
        </div>
      )}

      {tab === 'stats' && stats && (
        <div className="bg-white rounded-xl shadow border border-slate-200 p-6 space-y-6">
          <h2 className="text-lg font-bold text-slate-800">Статистика за период {stats.period?.from} — {stats.period?.to}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <p className="text-xs text-slate-500">Заявок создано</p>
              <p className="text-2xl font-bold text-slate-800">{stats.totalRequests ?? 0}</p>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <p className="text-xs text-slate-500">Заказов выполнено</p>
              <p className="text-2xl font-bold text-slate-800">{stats.completedOrders ?? 0}</p>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <p className="text-xs text-slate-500">Сбор с водителей (₽)</p>
              <p className="text-2xl font-bold text-slate-800">{stats.totalRequestFees ?? 0}</p>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <p className="text-xs text-slate-500">Сбор с комиссаров (₽)</p>
              <p className="text-2xl font-bold text-slate-800">{stats.totalCommissionerFees ?? 0}</p>
            </div>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
            <p className="text-sm font-semibold text-emerald-900 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              Касса (фикс‑сборы): {stats.platformTotal ?? 0} ₽
            </p>
          </div>
        </div>
      )}

      {tab === 'guide' && (
        <div className="space-y-4">
          <div className="bg-gradient-to-r from-orange-50 to-amber-50 border-2 border-orange-200 rounded-2xl p-4">
            <p className="text-sm text-orange-900">
              <strong>Цель раздела “Комиссары”:</strong> быстро подключать аварийных комиссаров к паркам, видеть заявки и статусы,
              и понимать, где именно списываются фикс‑сборы. Оплата услуги комиссара — <strong>на месте</strong>.
            </p>
          </div>

          <GuideBlock title="Роли и экраны">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-bold text-slate-900">Водитель</p>
                <p className="text-xs text-slate-600 mt-1">Создаёт заявку при ДТП, выбирает отклик, подтверждает.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-bold text-slate-900">Комиссар</p>
                <p className="text-xs text-slate-600 mt-1">Включает “на линии”, видит заявки своих парков, откликается, ведёт заказ до “выполнено”.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-bold text-slate-900">Админ</p>
                <p className="text-xs text-slate-600 mt-1">Создаёт комиссаров, назначает парки, ставку, пополняет баланс, контролирует заявки.</p>
              </div>
            </div>
          </GuideBlock>

          <GuideBlock title="Пайплайн заявки (статусы)">
            <div className="space-y-4">
              <Step idx="1" title="Создание заявки (водитель) — created">
                <p className="text-sm">Водитель создаёт заявку: адрес/комментарий/координаты.</p>
              </Step>
              <Step idx="2" title="Отклики (комиссары) — has_responses">
                <p className="text-sm">Комиссары на линии откликаются (ETA/цена). После первого отклика заявка переходит в <strong>has_responses</strong>.</p>
              </Step>
              <Step idx="3" title="Подтверждение отклика (водитель) — confirmed (тут списания)">
                <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm">
                  <p className="font-semibold text-orange-900 mb-1">Фикс‑сборы списываются в момент подтверждения:</p>
                  <ul className="list-disc pl-5 space-y-1 text-orange-900">
                    <li><strong>С водителя</strong> — сервисный сбор парка за заявку (<code>requestFeeAmount</code>).</li>
                    <li><strong>С комиссара</strong> — его ставка (<code>commissionerFeeAmount</code>, из профиля комиссара).</li>
                  </ul>
                  <p className="text-xs text-orange-800 mt-2">
                    Оплата услуги комиссара по цене отклика — <strong>на месте</strong>.
                  </p>
                </div>
              </Step>
              <Step idx="4" title="В пути — in_progress">
                <p className="text-sm">Комиссар переводит заказ в <strong>in_progress</strong>.</p>
              </Step>
              <Step idx="5" title="Выполнено — completed">
                <p className="text-sm">Комиссар отмечает <strong>completed</strong>, водитель получает уведомление.</p>
              </Step>
            </div>
          </GuideBlock>

          <GuideBlock title="Где что настраивается (админ)">
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-bold text-slate-900">Включение по паркам</p>
                <p className="text-sm text-slate-700 mt-1">
                  Для каждого парка есть настройка <code>park_commissioner_settings.commissionerEnabled</code> (если выключено — водитель не увидит раздел).
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-bold text-slate-900">Сбор с водителя</p>
                <p className="text-sm text-slate-700 mt-1">
                  Берётся из глобальных настроек <code>commissioner_settings.requestCreationPrice</code> либо override по парку <code>requestPriceOverride</code>.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-bold text-slate-900">Ставка комиссара</p>
                <p className="text-sm text-slate-700 mt-1">
                  Поле “Ставка (₽)” в профиле комиссара (списывается при подтверждении заявки).
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-bold text-slate-900">Парки комиссара</p>
                <p className="text-sm text-slate-700 mt-1">
                  В профиле назначаются парки — комиссар видит заявки только из них.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-bold text-slate-900">Баланс комиссара</p>
                <p className="text-sm text-slate-700 mt-1">
                  В профиле можно пополнить реал/бонус. Если баланса не хватает на ставку — водитель не сможет подтвердить этого комиссара.
                </p>
              </div>
            </div>
          </GuideBlock>

          <GuideBlock title="Диагностика (если “что-то не так”)">
            <div className="space-y-2 text-sm">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5" />
                <p><strong>Комиссар не видит заявки</strong>: проверь “на линии” и что у него назначен нужный парк.</p>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5" />
                <p><strong>Водитель не видит раздел</strong>: включи по парку (commissionerEnabled) и проверь, что сбор не “ломает” создание (баланс проверяется).</p>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5" />
                <p><strong>Подтверждение не проходит</strong>: чаще всего не хватает денег на фикс‑сбор у водителя или у комиссара (ставка).</p>
              </div>
              <div className="flex items-start gap-2">
                <ArrowRight className="w-4 h-4 text-slate-500 mt-0.5" />
                <p className="text-slate-700">
                  Вкладка “Заявки” — главный экран контроля: адрес, парк, автор, статусы и оба фикс‑сбора.
                </p>
              </div>
            </div>
          </GuideBlock>
        </div>
      )}

      {(modal === 'create' || modal?.type === 'edit') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setModal(null)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-0"
          >
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800">{modal === 'create' ? 'Создать комиссара' : 'Редактировать'}</h3>
              <button type="button" onClick={() => setModal(null)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="text-sm">
                  <span className="text-xs text-slate-500">ФИО</span>
                  <input value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200" />
                </label>
                <label className="text-sm">
                  <span className="text-xs text-slate-500">Телефон</span>
                  <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200" />
                </label>
                <label className="text-sm">
                  <span className="text-xs text-slate-500">Ставка (₽)</span>
                  <input value={form.fixedFee} onChange={(e) => setForm((f) => ({ ...f, fixedFee: e.target.value }))} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200" />
                </label>
                <div className="text-sm">
                  <span className="text-xs text-slate-500">Парки</span>
                  <div className="mt-1">
                    <ParkMultiSelect
                      parks={parks}
                      value={form.parkIds}
                      onChange={(next) => setForm((f) => ({ ...f, parkIds: next }))}
                      label=""
                    />
                  </div>
                </div>
              </div>
              {modal?.type === 'edit' && (
                <label className="text-sm block">
                  <span className="text-xs text-slate-500">Новый пароль (опционально)</span>
                  <input value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200" />
                </label>
              )}
              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={handleSave}
                disabled={saving}
                className="w-full px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold disabled:opacity-50"
              >
                {saving ? 'Сохраняю…' : 'Сохранить'}
              </motion.button>
            </div>
          </motion.div>
        </div>
      )}

      {modal?.type === 'profile' && profile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setModal(null)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-0 overflow-hidden"
          >
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-xs text-slate-500">
                  Профиль комиссара #{profile.id}
                  {profile?.createdAt ? ` · ${formatDateMsk(profile.createdAt)}` : ''}
                </p>
                <h3 className="text-base font-bold text-slate-800 truncate mt-1">
                  {profile.fullName || profile.username || '—'}
                </h3>
                <p className="text-xs text-slate-500 truncate mt-0.5">{profile?.phone || '—'}</p>

                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                      profile?.isOnline
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-slate-50 text-slate-600 border border-slate-200'
                    }`}
                  >
                    {profile?.isOnline ? 'На линии' : 'Оффлайн'}
                  </span>
                  {profile?.onlineUpdatedAt && (
                    <span className="text-[11px] text-slate-500">
                      Обновлено: {formatDateMsk(profile.onlineUpdatedAt)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setModal(null)}
                  className="p-2 rounded-xl hover:bg-slate-100 text-slate-600"
                  title="Закрыть"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="p-4 space-y-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 rounded-lg bg-white border border-slate-200">
                    <p className="text-[11px] font-semibold text-slate-500 uppercase">Баланс</p>
                    <p className="font-semibold text-slate-800 mt-0.5">{money(profile?.balance ?? 0)}</p>
                  </div>
                  <div className="p-2 rounded-lg bg-white border border-slate-200">
                    <p className="text-[11px] font-semibold text-slate-500 uppercase">Ставка</p>
                    <p className="font-semibold text-slate-800 mt-0.5">{money(profile?.fixedFee ?? 0)}</p>
                  </div>
                </div>

                <div className="mt-3">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase">Парки</p>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {Array.isArray(profile?.parkIds) && profile.parkIds.length > 0 ? (
                      profile.parkIds.map((id) => {
                        const pn = parks.find((p) => p.id === id)?.name || id;
                        return (
                          <span
                            key={id}
                            className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700"
                          >
                            #{id} · {pn}
                          </span>
                        );
                      })
                    ) : (
                      <span className="text-xs text-slate-500">—</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 p-3 space-y-2">
                <p className="text-sm font-semibold text-slate-800">Пополнение баланса</p>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="number"
                    min={1}
                    value={topup.amount}
                    onChange={(e) => setTopup((t) => ({ ...t, amount: e.target.value }))}
                    placeholder="Сумма"
                    className="col-span-2 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                  />
                  <select
                    value={topup.amountType}
                    onChange={(e) => setTopup((t) => ({ ...t, amountType: e.target.value }))}
                    className="px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                  >
                    <option value="real">Реал</option>
                    <option value="unreal">Бонус</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={submitTopup}
                  disabled={topupLoading}
                  className="w-full mt-1 px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold disabled:opacity-50"
                >
                  {topupLoading ? 'Пополняю…' : 'Пополнить'}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {selectedRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setSelectedRequest(null)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-0 overflow-hidden"
          >
            <div className="p-4 border-b border-slate-200 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-slate-500">Заявка #{selectedRequest.id}</p>
                <h3 className="text-base font-bold text-slate-800 truncate">{selectedRequest.address}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selectedRequest.parkName || selectedRequest.authorParkId} · {selectedRequest.authorName || '—'}
                </p>
              </div>
              <button type="button" onClick={() => setSelectedRequest(null)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-600" title="Закрыть">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <EvacCard
                title={selectedRequest.address}
                status={selectedRequest.status}
                subtitle={`${selectedRequest.parkName || selectedRequest.authorParkId} · ${selectedRequest.authorName || '—'}${selectedRequest.createdAt ? ` · ${formatDateMsk(selectedRequest.createdAt)}` : ''}`}
                comment={selectedRequest.comment}
                chips={[
                  { label: `С водителя: ${money(selectedRequest.requestFeeAmount)}`, className: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
                  { label: `С комиссара: ${money(selectedRequest.commissionerFeeAmount)}`, className: 'bg-violet-50 border-violet-200 text-violet-800' },
                  selectedRequest.responses?.length > 0 ? { label: `Откликов: ${selectedRequest.responses.length}` } : null,
                ].filter(Boolean)}
                className="shadow-none"
              />
              {Array.isArray(selectedRequest.responses) && selectedRequest.responses.length > 0 && (
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-sm font-semibold text-slate-800">
                    Отклики ({selectedRequest.responses.length})
                  </div>
                  <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
                    {selectedRequest.responses.map((rr) => (
                      <div key={rr.id} className="p-3 text-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-800 truncate">{rr.commissionerName || `Комиссар #${rr.commissionerUserId}`}</p>
                            <p className="text-xs text-slate-500">ETA: {rr.etaMinutes} мин · Цена: {money(rr.price)}</p>
                          </div>
                          <span className="text-[11px] px-2 py-1 rounded-full bg-slate-100 text-slate-600 shrink-0">{rr.responseStatus}</span>
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
    </div>
  );
}

