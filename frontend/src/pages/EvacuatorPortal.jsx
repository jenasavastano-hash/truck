import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../api';
import { Truck, MapPin, MessageSquare, Radio, LogOut, ListOrdered, ClipboardList, Send, Check, Navigation, Bell, Clock, Phone, Wallet, User } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { formatDateMsk } from '../utils/dateFormatter';
import EvacCard from '../components/evacuator/EvacCard';

function mapsUrl({ lat, lon, address }) {
  const a = (address || '').trim();
  if (lat != null && lon != null) {
    return `https://yandex.ru/maps/?pt=${encodeURIComponent(`${lon},${lat}`)}&z=16&l=map`;
  }
  if (a) return `https://yandex.ru/maps/?text=${encodeURIComponent(a)}`;
  return null;
}

export default function EvacuatorPortal() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [online, setOnline] = useState(false);
  const [balance, setBalance] = useState(0);
  const [requests, setRequests] = useState([]);
  const [orders, setOrders] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationsRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('requests');
  const [responding, setResponding] = useState(null);
  const [respondForm, setRespondForm] = useState({ etaMinutes: 30, price: '' });
  const [updatingOrder, setUpdatingOrder] = useState(null);
  const [showProfile, setShowProfile] = useState(false);

  const loadAll = () => {
    Promise.all([
      api.get('/evacuator/online'),
      api.get('/evacuator/balance').catch(() => ({ data: { balance: 0 } })),
      api.get('/evacuator/requests'),
      api.get('/evacuator/orders'),
      api.get('/evacuator/notifications').catch(() => ({ data: [] }))
    ])
      .then(([onRes, balRes, reqRes, ordRes, notifRes]) => {
        setOnline(!!onRes.data?.isOnline);
        setBalance(Number(balRes?.data?.balance) || 0);
        setRequests(Array.isArray(reqRes.data) ? reqRes.data : []);
        setOrders(Array.isArray(ordRes.data) ? ordRes.data : []);
        setNotifications(Array.isArray(notifRes?.data) ? notifRes.data : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAll();
    const t = setInterval(loadAll, 15000);
    return () => clearInterval(t);
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
        await api.get(`/evacuator/payment/${paymentId}/status`);
      } catch (err) {
        console.error('Yookassa payment status check error:', err);
      } finally {
        try {
          localStorage.removeItem('lastYookassaPaymentId');
        } catch (_) {}
        loadAll();
      }
    }

    checkPayment();
  }, []);

  useEffect(() => {
    function handleClickOutside(e) {
      if (notificationsRef.current && !notificationsRef.current.contains(e.target)) {
        setShowNotifications(false);
        setShowProfile(false);
      }
    }
    if (showNotifications || showProfile) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showNotifications, showProfile]);

  const markNotificationRead = (id, closeMenu = false) => {
    api.patch(`/evacuator/notifications/${id}/read`).then(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      if (closeMenu) setShowNotifications(false);
    });
  };

  const handleNotificationClick = (n) => {
    markNotificationRead(n.id, true);
    if (n.type === 'evacuator_new_request' || n.type === 'evacuator_confirmed') setTab(n.type === 'evacuator_confirmed' ? 'orders' : 'requests');
  };

  const toggleOnline = () => {
    api
      .patch('/evacuator/online', { isOnline: !online })
      .then((r) => setOnline(!!r.data?.isOnline))
      .catch(() => {});
  };

  const handleRespond = (requestId) => {
    const eta = parseInt(respondForm.etaMinutes, 10) || 30;
    const price = parseFloat(respondForm.price);
    if (isNaN(price) || price < 0) return;
    setResponding(requestId);
    api
      .post(`/evacuator/requests/${requestId}/respond`, { etaMinutes: eta, price })
      .then(() => {
        setRespondForm({ etaMinutes: 30, price: '' });
        loadAll();
      })
      .finally(() => setResponding(null));
  };

  const setOrderStatus = (requestId, status) => {
    setUpdatingOrder(requestId);
    api
      .patch(`/evacuator/orders/${requestId}/status`, { status })
      .then(loadAll)
      .finally(() => setUpdatingOrder(null));
  };

  const handleLogout = () => {
    try {
      logout();
    } finally {
      window.location.href = '/login';
    }
  };

  const goTopup = () => navigate('/evacuator/balance-topup');

  const statusLabel = (s) => {
    const map = { created: 'Новая', has_responses: 'Есть отклики', confirmed: 'Подтверждена', in_progress: 'В пути', completed: 'Выполнена' };
    return map[s] || s;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-orange-50 to-slate-50 flex items-center justify-center">
        <div className="animate-spin w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-orange-50 to-slate-50">
      <header className="bg-white/80 backdrop-blur border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Truck className="w-6 h-6 text-orange-500" />
              Эвакуатор
            </h1>
            <div className="relative flex items-center gap-2" ref={notificationsRef}>
              <button
                type="button"
                onClick={() => setShowProfile((v) => !v)}
                className="relative p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50"
                title="Профиль"
              >
                <User className="w-5 h-5 text-slate-700" />
              </button>
              {showProfile && (
                <AnimatePresence>
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="absolute right-4 top-full mt-2 w-72 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden"
                  >
                    <div className="p-3 border-b border-slate-100 font-semibold text-slate-800">Профиль</div>
                    <div className="p-3 space-y-2">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Баланс</p>
                        <p className="text-2xl font-bold text-slate-900">₽{balance}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setShowProfile(false); goTopup(); }}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 text-white font-semibold"
                      >
                        <Wallet className="w-4 h-4" />
                        Пополнить баланс
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowProfile(false); handleLogout(); }}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                      >
                        <LogOut className="w-4 h-4" />
                        Выйти
                      </button>
                    </div>
                  </motion.div>
                </AnimatePresence>
              )}
              <button
                type="button"
                onClick={() => { setShowNotifications(!showNotifications); if (!showNotifications) loadAll(); }}
                className="relative p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50"
              >
                <Bell className="w-5 h-5 text-slate-700" />
                {notifications.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-orange-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
                    {notifications.length}
                  </span>
                )}
              </button>
              {showNotifications && (
                <AnimatePresence>
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="absolute right-4 top-full mt-2 w-72 max-h-80 overflow-y-auto bg-white rounded-xl shadow-xl border border-slate-200 z-50"
                  >
                    <div className="p-3 border-b border-slate-100 font-semibold text-slate-800">Уведомления</div>
                    {notifications.length === 0 ? (
                      <p className="p-4 text-slate-500 text-sm">Нет новых</p>
                    ) : (
                      <ul className="p-2">
                        {notifications.map((n) => (
                          <li key={n.id}>
                            <button
                              type="button"
                              onClick={() => handleNotificationClick(n)}
                              className="w-full text-left p-3 rounded-lg hover:bg-orange-50 transition block"
                            >
                              <span className="font-medium text-slate-800 text-sm block">{n.title}</span>
                              <span className="text-slate-500 text-xs mt-0.5 block">{n.body}</span>
                              {n.createdAt && (
                                <span className="text-slate-400 text-xs flex items-center gap-1 mt-1">
                                  <Clock className="w-3 h-3 shrink-0" />
                                  {formatDateMsk(n.createdAt)}
                                </span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </motion.div>
                </AnimatePresence>
              )}
              <button
                type="button"
                onClick={toggleOnline}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium transition ${
                  online ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'
                }`}
              >
                <Radio className="w-4 h-4" />
                {online ? 'На линии' : 'Не на линии'}
              </button>
              <button
                type="button"
                onClick={goTopup}
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl font-medium border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                title="Пополнить баланс"
              >
                <Wallet className="w-4 h-4 text-orange-500" />
                <span className="hidden sm:inline">₽{balance}</span>
              </button>
              <button type="button" onClick={handleLogout} className="p-2 rounded-xl hover:bg-slate-100 text-slate-600" title="Выйти">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={() => setTab('requests')}
              className={`flex-1 py-2.5 rounded-xl font-medium flex items-center justify-center gap-2 ${
                tab === 'requests' ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              <ListOrdered className="w-4 h-4" />
              Заявки
            </button>
            <button
              type="button"
              onClick={() => setTab('orders')}
              className={`flex-1 py-2.5 rounded-xl font-medium flex items-center justify-center gap-2 ${
                tab === 'orders' ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              <ClipboardList className="w-4 h-4" />
              Мои заказы ({orders.length})
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {tab === 'requests' && (
          <div className="space-y-4">
            {!online && (
              <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm">
                Выйдите на линию, чтобы видеть заявки и откликаться.
              </p>
            )}
            {requests.length === 0 ? (
              <p className="text-slate-500 text-center py-8">Нет заявок</p>
            ) : (
              requests.map((req) => (
                <motion.div
                  key={req.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className=""
                >
                  <EvacCard
                    title={req.address}
                    status={req.status}
                    subtitle={[
                      req.parkName ? `Парк: ${req.parkName}` : null,
                      req.createdAt ? formatDateMsk(req.createdAt) : null,
                    ].filter(Boolean).join(' · ')}
                    comment={req.comment ? <span className="inline-flex items-center gap-1"><MessageSquare className="w-4 h-4 shrink-0" />{req.comment}</span> : null}
                    actions={
                      mapsUrl(req)
                        ? (
                          <a
                            href={mapsUrl(req)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold"
                          >
                            <Navigation className="w-4 h-4" />
                            Открыть в картах
                          </a>
                        )
                        : null
                    }
                  >
                    {req.myResponse ? (
                      <p className="mt-3 text-sm text-slate-600">
                        Ваш отклик: через <strong>{req.myResponse.etaMinutes} мин</strong>, <strong>{req.myResponse.price} ₽</strong>
                      </p>
                    ) : (req.status === 'created' || req.status === 'has_responses') && online && (
                      <div className="mt-4 p-3 rounded-xl bg-slate-50 border border-slate-100">
                        <div className="flex flex-wrap gap-2 mb-2">
                          {[15, 25, 35, 45].map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setRespondForm((f) => ({ ...f, etaMinutes: m }))}
                              className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition ${
                                Number(respondForm.etaMinutes) === m
                                  ? 'bg-slate-900 text-white border-slate-900'
                                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                              }`}
                            >
                              {m} мин
                            </button>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-3 items-end">
                          <label className="flex-1 min-w-[80px]">
                            <span className="text-xs text-slate-600">Через мин</span>
                            <input
                              type="number"
                              min={1}
                              max={300}
                              value={respondForm.etaMinutes}
                              onChange={(e) => setRespondForm((f) => ({ ...f, etaMinutes: e.target.value }))}
                              className="mt-0.5 w-full px-3 py-2 border border-slate-300 rounded-xl"
                            />
                          </label>
                          <label className="flex-1 min-w-[80px]">
                            <span className="text-xs text-slate-600">Цена ₽</span>
                            <input
                              type="number"
                              min={0}
                              step={100}
                              value={respondForm.price}
                              onChange={(e) => setRespondForm((f) => ({ ...f, price: e.target.value }))}
                              placeholder="0"
                              className="mt-0.5 w-full px-3 py-2 border border-slate-300 rounded-xl"
                            />
                          </label>
                          <button
                            type="button"
                            disabled={responding !== null}
                            onClick={() => handleRespond(req.id)}
                            className="py-2 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
                          >
                            {responding === req.id ? <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> : <Send className="w-4 h-4" />}
                            Откликнуться
                          </button>
                        </div>
                      </div>
                    )}
                  </EvacCard>
                </motion.div>
              ))
            )}
          </div>
        )}

        {tab === 'orders' && (
          <div className="space-y-4">
            {orders.length === 0 ? (
              <p className="text-slate-500 text-center py-8">Нет заказов</p>
            ) : (
              orders.map((o) => (
                <motion.div
                  key={o.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className=""
                >
                  <EvacCard
                    title={o.address}
                    status={o.status}
                    subtitle={[
                      (o.authorName || 'Клиент') ? `${o.authorName || 'Клиент'} · ${o.authorPhone || '—'} · ${o.price} ₽` : null,
                      o.createdAt ? formatDateMsk(o.createdAt) : null,
                    ].filter(Boolean).join(' · ')}
                    comment={o.comment}
                    actions={
                      <>
                        {o.authorPhone && (
                          <a
                            href={`tel:${o.authorPhone}`}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold"
                          >
                            <Phone className="w-4 h-4" />
                            Позвонить
                          </a>
                        )}
                        {mapsUrl(o) && (
                          <a
                            href={mapsUrl(o)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold"
                          >
                            <Navigation className="w-4 h-4" />
                            Карты
                          </a>
                        )}
                      </>
                    }
                  >
                    <div className="mt-4 flex flex-wrap gap-2">
                    {o.status === 'confirmed' && (
                      <button
                        type="button"
                        disabled={updatingOrder !== null}
                        onClick={() => setOrderStatus(o.id, 'in_progress')}
                        className="py-2 px-4 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
                      >
                        {updatingOrder === o.id ? <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> : <Navigation className="w-4 h-4" />}
                        В пути
                      </button>
                    )}
                    {(o.status === 'confirmed' || o.status === 'in_progress') && (
                      <button
                        type="button"
                        disabled={updatingOrder !== null}
                        onClick={() => setOrderStatus(o.id, 'completed')}
                        className="py-2 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
                      >
                        {updatingOrder === o.id ? <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> : <Check className="w-4 h-4" />}
                        Выполнено
                      </button>
                    )}
                    </div>
                  </EvacCard>
                </motion.div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
}
