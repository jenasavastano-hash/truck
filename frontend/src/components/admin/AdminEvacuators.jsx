import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Truck, Plus, Pencil, Trash2, Radio, BarChart3, ListOrdered, X, LogIn, Wallet, BookOpen, CheckCircle2, ArrowRight } from 'lucide-react';
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

export default function AdminEvacuators() {
  const { showToast } = useToast();
  const [evacuators, setEvacuators] = useState([]);
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
      api.get('/admin/evacuators'),
      api.get('/admin/parks').catch(() => ({ data: [] })),
      api.get('/admin/evacuator/requests'),
      api.get('/admin/evacuator/stats')
    ])
      .then(([evRes, parksRes, reqRes, statsRes]) => {
        setEvacuators(evRes.data || []);
        setParks(parksRes.data?.parks || parksRes.data || []);
        setRequests(reqRes.data || []);
        setStats(statsRes.data || null);
      })
      .catch(() => showToast('Ошибка загрузки', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!evacuators || evacuators.length === 0) {
      setLoginTargetId(null);
      setLoginPage(1);
      return;
    }
    if (loginTargetId == null || !evacuators.some((e) => e.id === loginTargetId)) {
      setLoginTargetId(evacuators[0].id);
    }
    setLoginPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evacuators]);

  const openCreate = () => {
    setForm({ username: '', password: '', fullName: '', phone: '', parkIds: [], fixedFee: '' });
    setModal('create');
  };

  const openEdit = (e) => {
    api.get(`/admin/evacuators/${e.id}`)
      .then((r) => {
        setForm({
          username: r.data.username,
          password: '',
          fullName: r.data.fullName || '',
          phone: r.data.phone || '',
          parkIds: r.data.parkIds || [],
          fixedFee: r.data.fixedFee != null ? String(r.data.fixedFee) : ''
        });
        setModal({ type: 'edit', id: e.id });
      })
      .catch(() => showToast('Ошибка загрузки', 'error'));
  };

  const openProfile = (e) => {
    api.get(`/admin/evacuators/${e.id}`)
      .then((r) => {
        setProfile(r.data || null);
        setTopup({ amount: '', amountType: 'real' });
        setModal({ type: 'profile', id: e.id });
      })
      .catch(() => showToast('Ошибка загрузки профиля', 'error'));
  };

  const impersonate = async (e) => {
    if (impersonating) return;
    if (!e?.id) return;
    try {
      setImpersonating(true);
      const { data } = await api.post(`/admin/impersonate/evacuator/${e.id}`);
      const backup = { token: localStorage.getItem('token'), user: localStorage.getItem('user'), returnTo: '/admin' };
      sessionStorage.setItem('adminImpersonationBackup', JSON.stringify(backup));
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      window.location.href = '/evacuator';
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
      await api.post(`/admin/evacuators/${profile.id}/balance`, { amount: num, amountType: topup.amountType });
      const r = await api.get(`/admin/evacuators/${profile.id}`);
      setProfile(r.data || null);
      showToast('Баланс пополнен', 'success');
      setTopup((t) => ({ ...t, amount: '' }));
    } catch (e) {
      showToast(e.response?.data?.error || e.message || 'Ошибка пополнения', 'error');
    } finally {
      setTopupLoading(false);
    }
  };

  const handleSaveEvacuator = () => {
    const phone = (form.phone || '').trim();
    if (modal === 'create' && !phone) { showToast('Укажите телефон', 'error'); return; }
    setSaving(true);
    const fixedFeeVal = form.fixedFee === '' ? undefined : (parseFloat(form.fixedFee) || 0);
    const payload = modal === 'create'
      ? { phone, fullName: form.fullName || undefined, parkIds: form.parkIds, fixedFee: fixedFeeVal }
      : { fullName: form.fullName, phone: form.phone, parkIds: form.parkIds, password: form.password || undefined, fixedFee: fixedFeeVal };
    const promise = modal === 'create'
      ? api.post('/admin/evacuators', payload)
      : api.put(`/admin/evacuators/${modal.id}`, payload);
    promise
      .then(() => {
        showToast(modal === 'create' ? 'Эвакуатор создан' : 'Сохранено', 'success');
        setModal(null);
        load();
      })
      .catch((e) => showToast(e.response?.data?.error || 'Ошибка', 'error'))
      .finally(() => setSaving(false));
  };

  const handleDelete = (id) => {
    if (!window.confirm('Удалить водителя эвакуатора?')) return;
    api.delete(`/admin/evacuators/${id}`)
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
          Водители эваков
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
            <h2 className="text-lg font-bold text-slate-800">Водители эвакуаторов</h2>
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
            const pageCount = Math.max(1, Math.ceil(evacuators.length / PAGE_SIZE));
            const safePage = Math.max(1, Math.min(loginPage, pageCount));
            const loginTarget = evacuators.find((e) => e.id === loginTargetId) || null;
            const pagedEvacuators = evacuators.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

            return (
              <>
                <div className="p-4 border-b border-slate-100 bg-slate-50/70">
                  <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800">Вход от лица</p>
                      <p className="text-xs text-slate-500 mt-1">Выбери эвакуатора и открой его кабинет без выхода из админки.</p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2 sm:items-start sm:justify-end w-full sm:w-auto">
                      <div className="min-w-[220px]">
                        <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                          Профиль эвакуатора
                        </label>
                        <select
                          value={loginTargetId ?? ''}
                          onChange={(e) => setLoginTargetId(e.target.value ? Number(e.target.value) : null)}
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 bg-white"
                        >
                          {evacuators.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.fullName || e.username} (ID {e.id})
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
                        <th className="p-3 w-24" />
                      </tr>
                    </thead>
                    <tbody>
                      {pagedEvacuators.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-6 text-slate-500 text-center">
                            Нет водителей эвакуаторов
                          </td>
                        </tr>
                      ) : (
                        pagedEvacuators.map((e) => (
                          <tr
                            key={e.id}
                            onClick={() => setLoginTargetId(e.id)}
                            className={`border-b border-slate-100 cursor-pointer hover:bg-slate-50 ${loginTargetId === e.id ? 'bg-teal-50' : ''}`}
                          >
                            <td className="p-3">{e.fullName || e.username}</td>
                            <td className="p-3">{e.phone || '—'}</td>
                            <td className="p-3">
                              {Array.isArray(e.parkIds) && e.parkIds.length
                                ? e.parkIds.map((id) => parks.find((p) => p.id === id)?.name || id).join(', ')
                                : '—'}
                            </td>
                            <td className="p-3">
                              {e.isOnline ? <span className="text-emerald-600 font-medium">Да</span> : 'Нет'}
                            </td>
                            <td className="p-3">{e.fixedFee != null ? e.fixedFee : '—'}</td>
                            <td className="p-3 flex gap-1" onClick={(ev) => ev.stopPropagation()}>
                              <button type="button" onClick={() => openProfile(e)} className="p-1.5 text-slate-600 hover:bg-slate-200 rounded-lg" title="Профиль / баланс">
                                <Wallet className="w-4 h-4" />
                              </button>
                              <button type="button" onClick={() => openEdit(e)} className="p-1.5 text-slate-600 hover:bg-slate-200 rounded-lg" title="Редактировать">
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button type="button" onClick={() => handleDelete(e.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg" title="Удалить">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {evacuators.length > PAGE_SIZE && (
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
              <h2 className="text-lg font-bold text-slate-800">Заявки на эвакуатор</h2>
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
              const hay = [
                r.address,
                r.comment,
                r.parkName,
                r.authorName,
                r.authorPhone,
              ].filter(Boolean).join(' ').toLowerCase();
              return hay.includes(q);
            }).length === 0 ? (
              <p className="p-6 text-slate-500">Нет заявок</p>
            ) : (
              requests
                .filter((r) => {
                  if (reqStatus !== 'all' && String(r.status || '') !== reqStatus) return false;
                  const q = reqQ.trim().toLowerCase();
                  if (!q) return true;
                  const hay = [
                    r.address,
                    r.comment,
                    r.parkName,
                    r.authorName,
                    r.authorPhone,
                  ].filter(Boolean).join(' ').toLowerCase();
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
                      { label: `С эвакуатора: ${money(r.evacuatorFeeAmount)}`, className: 'bg-violet-50 border-violet-200 text-violet-800' },
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

      {tab === 'guide' && (
        <div className="space-y-4">
          <div className="bg-gradient-to-r from-orange-50 to-amber-50 border-2 border-orange-200 rounded-2xl p-4">
            <p className="text-sm text-orange-900">
              <strong>Цель раздела “Эвакуаторы”:</strong> управлять эвакуаторщиками, видеть заявки и статусы, и понимать, где и когда
              списываются фикс‑сборы. Фактическая оплата услуги эвакуатора — <strong>на месте</strong> (вне сайта).
            </p>
          </div>

          <GuideBlock title="Роли и экраны">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-bold text-slate-900">Водитель (заявитель)</p>
                <p className="text-xs text-slate-600 mt-1">Создаёт заявку на эвакуатор, выбирает отклик, подтверждает.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-bold text-slate-900">Эвакуатор</p>
                <p className="text-xs text-slate-600 mt-1">Включает “на линии”, видит заявки, откликается, ведёт заказ до “выполнено”.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-bold text-slate-900">Админ</p>
                <p className="text-xs text-slate-600 mt-1">Создаёт эвакуаторщиков, настраивает парки/ставки, пополняет баланс, может войти “как эвакуатор”.</p>
              </div>
            </div>
          </GuideBlock>

          <GuideBlock title="Пайплайн заявки (статусы)">
            <div className="space-y-4">
              <Step idx="1" title="Создание заявки (водитель)">
                <p className="text-sm">
                  Водитель создаёт заявку: адрес/комментарий/координаты. Статус: <strong>created</strong>.
                </p>
              </Step>
              <Step idx="2" title="Отклики (эвакуаторы)">
                <p className="text-sm">
                  Эвакуаторы (которые “на линии” и которым разрешён парк) видят заявку и отправляют отклик (ETA/цена).
                  Когда есть отклики — статус становится <strong>has_responses</strong>.
                </p>
              </Step>
              <Step idx="3" title="Подтверждение отклика (водитель) — тут списания">
                <p className="text-sm">
                  Водитель выбирает отклик и подтверждает. Статус: <strong>confirmed</strong>.
                </p>
                <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm">
                  <p className="font-semibold text-orange-900 mb-1">Фикс‑списания происходят в момент подтверждения:</p>
                  <ul className="list-disc pl-5 space-y-1 text-orange-900">
                    <li><strong>С водителя</strong> — сервисный сбор парка за заявку (<code>requestFeeAmount</code>).</li>
                    <li><strong>С эвакуатора</strong> — его фикс‑ставка (<code>evacuatorFeeAmount</code>, берётся из профиля эвакуатора).</li>
                  </ul>
                  <p className="text-xs text-orange-800 mt-2">
                    В админке в карточке заявки отображаются оба значения: “С водителя” и “С эвакуатора”.
                  </p>
                </div>
              </Step>
              <Step idx="4" title="В пути (эвакуатор)">
                <p className="text-sm">
                  Эвакуатор переводит заказ в <strong>in_progress</strong>. Заполняется время <code>inProgressAt</code> (если не было).
                </p>
              </Step>
              <Step idx="5" title="Выполнено (эвакуатор)">
                <p className="text-sm">
                  Эвакуатор отмечает <strong>completed</strong>. Заполняется <code>completedAt</code>. Сайт отправляет уведомление водителю.
                </p>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                  <p className="font-semibold mb-1">Важно:</p>
                  <p>Оплата “за услугу” (по договорённой цене) происходит <strong>на месте</strong>, сайт её не проводит.</p>
                </div>
              </Step>
            </div>
          </GuideBlock>

          <GuideBlock title="Где что настраивается (админ)">
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-bold text-slate-900">Фикс‑ставка эвакуатора</p>
                <p className="text-sm text-slate-700 mt-1">
                  В профиле эвакуаторщика поле “Ставка (₽)”. Это то, что списывается с эвакуатора при подтверждении заявки.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-bold text-slate-900">Доступ эвакуатора к паркам</p>
                <p className="text-sm text-slate-700 mt-1">
                  В профиле эвакуаторщика выбираются парки. Эвакуатор видит заявки только из разрешённых парков.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-bold text-slate-900">Сервисный сбор парка с водителя</p>
                <p className="text-sm text-slate-700 mt-1">
                  Берётся из настроек эвакуатора по парку (может быть override) / глобальных настроек.
                  В заявках это видно как “С водителя: …”.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-bold text-slate-900">Пополнение баланса эвакуатора</p>
                <p className="text-sm text-slate-700 mt-1">
                  В “Профиль / баланс” можно пополнить реал/бонус. Это влияет на возможность списания фикс‑ставки.
                </p>
              </div>
            </div>
          </GuideBlock>

          <GuideBlock title="Подсказки по диагностике (если “что-то не так”)">
            <div className="space-y-2 text-sm">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5" />
                <p><strong>Эвакуатор не видит заявки</strong>: проверь “на линии” и что у него выбран нужный парк.</p>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5" />
                <p><strong>Подтверждение не проходит</strong>: обычно нет денег на фикс‑сбор (водитель/эвакуатор) или неверная настройка ставки.</p>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5" />
                <p><strong>Путаются статусы</strong>: ориентируйся на цепочку <strong>created → has_responses → confirmed → in_progress → completed</strong>.</p>
              </div>
              <div className="flex items-start gap-2">
                <ArrowRight className="w-4 h-4 text-slate-500 mt-0.5" />
                <p className="text-slate-700">
                  Вкладка “Заявки” в админке — основной экран контроля: там видно адрес, парк, автора, статусы и оба фикс‑списания.
                </p>
              </div>
            </div>
          </GuideBlock>
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
              <p className="text-xs text-slate-500">Сбор с эвакуаторов (₽)</p>
              <p className="text-2xl font-bold text-slate-800">{stats.totalEvacuatorFees ?? 0}</p>
            </div>
          </div>
          <div>
            <p className="font-semibold text-slate-800 mb-2">По эвакуаторам</p>
            <div className="space-y-2">
              {(stats.byEvacuator || []).map((e) => (
                <div key={e.evacuatorUserId} className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <span>{e.evacuatorName || `ID ${e.evacuatorUserId}`}</span>
                  <span className="text-sm text-slate-600">Заказов: {e.ordersCount} · Заработал: {e.totalEarnings} ₽</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Модалка создания/редактирования */}
      {(modal === 'create' || (modal && modal.type === 'edit')) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setModal(null)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6"
          >
            <h3 className="text-lg font-bold text-slate-800 mb-4">{modal === 'create' ? 'Новый водитель эвакуатора' : 'Редактировать'}</h3>
            <div className="space-y-3">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Телефон *</span>
                <input
                  type="text"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="+79191234567"
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
                {modal === 'create' && (
                  <p className="text-xs text-slate-500 mt-0.5">Логин и пароль для входа = телефон (только цифры).</p>
                )}
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">ФИО</span>
                <input
                  type="text"
                  value={form.fullName}
                  onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Ставка эвакуатора (₽)</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.fixedFee}
                  onChange={(e) => setForm((f) => ({ ...f, fixedFee: e.target.value }))}
                  placeholder="0"
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
                <p className="text-xs text-slate-500 mt-0.5">Фикс‑сбор списывается с баланса эвакуатора в момент подтверждения заявки водителем.</p>
              </label>
              {modal && modal.type === 'edit' && (
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Новый пароль</span>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder="Оставьте пустым, чтобы не менять"
                    className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </label>
              )}
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Парки (заявки из этих парков видны эваку)</span>
                <div className="mt-1">
                  <ParkMultiSelect
                    parks={parks}
                    value={form.parkIds}
                    onChange={(next) => setForm((f) => ({ ...f, parkIds: next }))}
                    label=""
                  />
                </div>
              </label>
            </div>
            <div className="flex gap-2 mt-6">
              <button type="button" onClick={() => setModal(null)} className="flex-1 py-2 border border-slate-300 rounded-xl text-slate-700 font-medium">Отмена</button>
              <button type="button" onClick={handleSaveEvacuator} disabled={saving} className="flex-1 py-2 bg-orange-500 text-white rounded-xl font-medium disabled:opacity-50">Сохранить</button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Профиль эвакуатора + пополнение баланса */}
      {modal && modal.type === 'profile' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setModal(null)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6"
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-slate-800 truncate">
                  Профиль эвакуатора
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  ID {profile?.id ?? '—'} {profile?.createdAt ? `· ${formatDateMsk(profile.createdAt)}` : ''}
                </p>
                <p className="text-sm font-semibold text-slate-900 truncate mt-1">
                  {profile?.fullName || profile?.username || '—'}
                </p>
                <p className="text-xs text-slate-500 truncate">{profile?.phone || '—'}</p>

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
              <button
                type="button"
                onClick={() => setModal(null)}
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-600 shrink-0"
                title="Закрыть"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 rounded-lg bg-white border border-slate-200">
                    <p className="text-[11px] font-semibold text-slate-500 uppercase">Ставка</p>
                    <p className="font-semibold text-slate-800 mt-0.5">{money(profile?.fixedFee ?? 0)}</p>
                  </div>
                  <div className="p-2 rounded-lg bg-white border border-slate-200">
                    <p className="text-[11px] font-semibold text-slate-500 uppercase">Баланс</p>
                    <p className="font-semibold text-slate-800 mt-0.5">{money(profile?.balance ?? 0)}</p>
                  </div>
                </div>

                <div className="mt-3">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase">Парки</p>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {Array.isArray(profile?.parkIds) && profile.parkIds.length > 0 ? (
                      profile.parkIds.map((id) => {
                        const pn = parks.find((p) => p.id === id)?.name || id;
                        return (
                          <span key={id} className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700">
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
                <p className="text-sm font-semibold text-slate-800">Пополнить баланс</p>
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

      {/* Детали заявки (клик по карточке) */}
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
                  { label: `С эвакуатора: ${money(selectedRequest.evacuatorFeeAmount)}`, className: 'bg-violet-50 border-violet-200 text-violet-800' },
                  selectedRequest.responses?.length > 0 ? { label: `Откликов: ${selectedRequest.responses.length}` } : null,
                ].filter(Boolean)}
                className="shadow-none"
              />
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                  <p className="text-xs text-emerald-800/80">Сбор с водителя</p>
                  <p className="font-semibold text-slate-900">{money(selectedRequest.requestFeeAmount)}</p>
                  <p className="text-xs text-emerald-800/70">{selectedRequest.requestFeePaidAt ? `оплачен: ${formatDateMsk(selectedRequest.requestFeePaidAt)}` : 'не оплачен'}</p>
                </div>
                <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3">
                  <p className="text-xs text-violet-800/80">Сбор с эвакуатора</p>
                  <p className="font-semibold text-slate-900">{money(selectedRequest.evacuatorFeeAmount)}</p>
                  <p className="text-xs text-violet-800/70">{selectedRequest.evacuatorFeePaidAt ? `оплачен: ${formatDateMsk(selectedRequest.evacuatorFeePaidAt)}` : 'не оплачен'}</p>
                </div>
              </div>

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
                            <p className="font-semibold text-slate-800 truncate">{rr.evacuatorName || `Эвакуатор #${rr.evacuatorUserId}`}</p>
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
