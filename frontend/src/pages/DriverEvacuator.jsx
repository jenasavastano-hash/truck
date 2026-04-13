import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import api from '../api';
import { Truck, ArrowLeft, MapPin, MessageSquare, Send, Check, Clock, Navigation, Phone, X, AlertTriangle } from 'lucide-react';
import { formatDateMsk } from '../utils/dateFormatter';
import EvacCard from '../components/evacuator/EvacCard';

const DRAFT_KEY = 'driver_evacuator_draft_v1';

function mapsUrl({ lat, lon, address }) {
  const a = (address || '').trim();
  if (lat != null && lon != null) {
    return `https://yandex.ru/maps/?pt=${encodeURIComponent(`${lon},${lat}`)}&z=16&l=map`;
  }
  if (a) return `https://yandex.ru/maps/?text=${encodeURIComponent(a)}`;
  return null;
}

export default function DriverEvacuator() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [form, setForm] = useState({ address: '', comment: '', lat: null, lon: null });
  const [error, setError] = useState('');
  const [geoLoading, setGeoLoading] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null); // { request, response }

  useEffect(() => {
    Promise.all([
      api.get('/driver/evacuator/settings'),
      api.get('/driver/evacuator/requests')
    ])
      .then(([settingsRes, requestsRes]) => {
        setSettings(settingsRes.data);
        setRequests(Array.isArray(requestsRes.data) ? requestsRes.data : []);
        try {
          const raw = localStorage.getItem(DRAFT_KEY);
          if (raw) {
            const d = JSON.parse(raw);
            if (d && typeof d === 'object') {
              setForm((p) => ({
                ...p,
                address: typeof d.address === 'string' ? d.address : p.address,
                comment: typeof d.comment === 'string' ? d.comment : p.comment,
              }));
            }
          }
        } catch {}
      })
      .catch((err) => {
        if (err.response?.status === 401) navigate('/login');
        else setError(err.response?.data?.error || 'Ошибка загрузки');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ address: form.address, comment: form.comment }));
    } catch {}
  }, [form.address, form.comment]);

  const activeRequests = useMemo(
    () => (requests || []).filter((r) => !['completed', 'cancelled'].includes(String(r.status || ''))),
    [requests]
  );
  const activeRequest = activeRequests[0] || null;
  const historyRequests = useMemo(
    () => (requests || []).filter((r) => ['completed', 'cancelled'].includes(String(r.status || ''))),
    [requests]
  );

  const handleCreate = (e) => {
    e.preventDefault();
    setError('');
    if (!form.address.trim()) {
      setError('Укажите адрес');
      return;
    }
    setCreating(true);
    api
      .post('/driver/evacuator/requests', {
        address: form.address.trim(),
        comment: form.comment.trim() || undefined,
        lat: form.lat,
        lon: form.lon,
      })
      .then(() => {
        setForm({ address: '', comment: '', lat: null, lon: null });
        try { localStorage.removeItem(DRAFT_KEY); } catch {}
        return api.get('/driver/evacuator/requests');
      })
      .then((res) => setRequests(Array.isArray(res.data) ? res.data : []))
      .catch((err) => setError(err.response?.data?.error || 'Не удалось создать заявку'))
      .finally(() => setCreating(false));
  };

  const handleConfirm = (requestId, responseId) => {
    setConfirming(responseId);
    setError('');
    api
      .post(`/driver/evacuator/requests/${requestId}/confirm`, { responseId })
      .then(() => api.get('/driver/evacuator/requests'))
      .then((res) => setRequests(Array.isArray(res.data) ? res.data : []))
      .catch((err) => setError(err.response?.data?.error || 'Ошибка подтверждения'))
      .finally(() => setConfirming(null));
  };

  const requestGeo = async () => {
    if (!navigator.geolocation) {
      showError('Геолокация не поддерживается в браузере');
      return;
    }
    setGeoLoading(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude);
        const lon = Number(pos.coords.longitude);
        const ok = Number.isFinite(lat) && Number.isFinite(lon);
        setForm((p) => ({
          ...p,
          lat: ok ? lat : null,
          lon: ok ? lon : null,
          address: p.address?.trim()
            ? p.address
            : ok
              ? `Моя геопозиция: ${lat.toFixed(6)}, ${lon.toFixed(6)}`
              : p.address,
        }));
        setGeoLoading(false);
      },
      (err) => {
        setGeoLoading(false);
        showError(err?.message || 'Не удалось получить геолокацию');
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 }
    );
  };

  const showError = (msg) => setError(String(msg || 'Ошибка'));

  const statusLabel = (s) => {
    const map = { created: 'Ожидаем откликов', has_responses: 'Есть отклики', confirmed: 'Подтверждена', in_progress: 'В работе', completed: 'Выполнена', cancelled: 'Отменена' };
    return map[s] || s;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-orange-50 to-slate-50 flex items-center justify-center">
        <div className="animate-spin w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!settings?.enabled) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-orange-50 to-slate-50 p-4 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm text-center">
          <p className="text-slate-600 mb-4">Вызов эвакуатора для вашего парка отключён.</p>
          <button
            type="button"
            onClick={() => navigate('/driver')}
            className="text-orange-600 font-medium hover:underline"
          >
            ← Назад в меню
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-orange-50 to-slate-50">
      <header className="bg-white/80 backdrop-blur border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/driver')}
            className="p-2 rounded-xl hover:bg-slate-100"
          >
            <ArrowLeft className="w-5 h-5 text-slate-700" />
          </button>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Truck className="w-6 h-6 text-orange-500" />
            Эвакуатор
          </h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Активная заявка (если есть) */}
        {activeRequest && (
          <EvacCard
            title={activeRequest.address}
            status={activeRequest.status}
            subtitle={`Активная заявка${activeRequest.createdAt ? ` · ${formatDateMsk(activeRequest.createdAt)}` : ''}`}
            comment={activeRequest.comment}
            actions={
              mapsUrl(activeRequest)
                ? (
                  <a
                    href={mapsUrl(activeRequest)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold"
                    title="Открыть место в картах"
                  >
                    <Navigation className="w-4 h-4" />
                    Карты
                  </a>
                )
                : null
            }
            className="border-orange-200"
          >
            {activeRequest.responses && activeRequest.responses.length > 0 && (activeRequest.status === 'created' || activeRequest.status === 'has_responses') && (
              <div className="mt-4 space-y-2">
                <p className="text-sm font-semibold text-slate-800">Отклики эвакуаторов</p>
                {activeRequest.responses
                  .filter((r) => r.responseStatus === 'pending')
                  .map((r) => (
                    <div
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 border border-slate-100"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 truncate">{r.evacuatorName || 'Эвакуатор'}</p>
                        <p className="text-sm text-slate-600">
                          ETA: <strong>{r.etaMinutes} мин</strong> · Цена: <strong>{r.price} ₽</strong>
                        </p>
                        {r.evacuatorPhone && <p className="text-xs text-slate-500 mt-0.5">Тел: {r.evacuatorPhone}</p>}
                      </div>
                      <button
                        type="button"
                        disabled={confirming !== null}
                        onClick={() => setConfirmModal({ request: activeRequest, response: r })}
                        className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
                      >
                        <Check className="w-4 h-4" />
                        Выбрать
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </EvacCard>
        )}

        {/* Создание заявки */}
        <div className="rounded-2xl bg-white border border-orange-100 p-4 shadow-sm">
          <p className="text-slate-600 text-sm mb-4">
            Сейчас на линии: <strong>{settings?.evacuatorsOnlineCount ?? 0}</strong> эвакуаторов
            {settings?.requestCreationPrice > 0 && (
              <span> · Сбор при подтверждении: <strong>{settings.requestCreationPrice} ₽</strong></span>
            )}
          </p>
          <form onSubmit={handleCreate} className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium text-slate-700 flex items-center gap-1">
                <MapPin className="w-4 h-4" /> Адрес *
              </span>
              <input
                type="text"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value, lat: f.lat, lon: f.lon }))}
                placeholder="Улица, дом, ориентир"
                className="mt-1 w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700 flex items-center gap-1">
                <MessageSquare className="w-4 h-4" /> Комментарий
              </span>
              <textarea
                value={form.comment}
                onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
                placeholder="Марка авто, что случилось..."
                rows={2}
                className="mt-1 w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={requestGeo}
                disabled={geoLoading}
                className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2"
                title="Добавить координаты (помогает эвакуатору быстрее приехать)"
              >
                {geoLoading ? <span className="animate-spin w-4 h-4 border-2 border-slate-600 border-t-transparent rounded-full" /> : <Navigation className="w-4 h-4" />}
                Геолокация
              </button>
              {mapsUrl(form) && (
                <a
                  href={mapsUrl(form)}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold inline-flex items-center gap-2"
                >
                  <MapPin className="w-4 h-4" />
                  Проверить в картах
                </a>
              )}
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={creating}
              className="w-full py-3 px-4 rounded-xl font-semibold bg-orange-500 hover:bg-orange-600 text-white flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {creating ? (
                <span className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
              ) : (
                <>
                  <Send className="w-5 h-5" />
                  Создать заявку
                </>
              )}
            </button>
          </form>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-slate-800 mb-3 flex items-center gap-2">
            <Clock className="w-5 h-5" />
            История
          </h2>
          {historyRequests.length === 0 ? (
            <p className="text-slate-500 text-sm">Пока нет заявок</p>
          ) : (
            <ul className="space-y-4">
              {historyRequests.map((req) => (
                <motion.li
                  key={req.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className=""
                >
                  <EvacCard
                    title={req.address}
                    status={req.status}
                    subtitle={req.createdAt ? formatDateMsk(req.createdAt) : null}
                    comment={req.comment}
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
                  />
                </motion.li>
              ))}
            </ul>
          )}
        </div>
      </main>

      {/* Модалка подтверждения выбора эвакуатора */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setConfirmModal(null)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <p className="font-bold text-slate-900">Подтвердить эвакуатор</p>
              <button type="button" onClick={() => setConfirmModal(null)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-semibold text-slate-900">{confirmModal.response?.evacuatorName || 'Эвакуатор'}</p>
                <p className="text-slate-600 mt-0.5">ETA: <strong>{confirmModal.response?.etaMinutes} мин</strong> · Цена: <strong>{confirmModal.response?.price} ₽</strong></p>
                {confirmModal.response?.evacuatorPhone && (
                  <a className="mt-2 inline-flex items-center gap-2 text-indigo-600 font-semibold" href={`tel:${confirmModal.response.evacuatorPhone}`}>
                    <Phone className="w-4 h-4" /> Позвонить
                  </a>
                )}
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
                <p className="font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Важно
                </p>
                <p className="mt-1">
                  При подтверждении спишется <strong>фикс‑сбор</strong> с вашего баланса
                  {settings?.requestCreationPrice > 0 ? ` (${settings.requestCreationPrice} ₽)` : ''}. Оплата услуги эвакуатора — <strong>на месте</strong>.
                </p>
              </div>
              {error && <p className="text-red-600">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setConfirmModal(null)}
                  className="flex-1 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  disabled={confirming !== null}
                  onClick={() => {
                    const req = confirmModal.request;
                    const resp = confirmModal.response;
                    setConfirmModal(null);
                    handleConfirm(req.id, resp.id);
                  }}
                  className="flex-1 px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold disabled:opacity-50"
                >
                  {confirming ? 'Подтверждаем…' : 'Подтвердить'}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
