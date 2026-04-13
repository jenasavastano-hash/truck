import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, CheckCircle2, Clock, XCircle, QrCode, Send, Gamepad2, ChevronLeft, ChevronRight, LogOut } from 'lucide-react';
import api from '../api';
import { useToast } from '../hooks/useToast';
import Card from '../components/ui/Card';
import { parseUtc } from '../utils/dateFormatter';
import { openPdfFromAxiosBlob } from '../utils/openPdfFromAxiosBlob';

function formatDate(s) {
  const d = parseUtc(s);
  if (!d || isNaN(d.getTime())) return '—';
  const str = d.toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  return `${str} (МСК)`;
}

export default function EPLDetails() {
  const { eplId } = useParams();
  const navigate = useNavigate();
  const [epl, setEpl] = useState(null);
  const [titles, setTitles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [endOdometerInput, setEndOdometerInput] = useState('');
  const [completingRide, setCompletingRide] = useState(false);
  const [openingPdf, setOpeningPdf] = useState(false);
  const [closingShift, setClosingShift] = useState(false);
  const [qrSlideIndex, setQrSlideIndex] = useState(0);
  const { toast, showToast, hideToast } = useToast();

  useEffect(() => {
    loadEplData();
  }, [eplId]);

  useEffect(() => {
    setQrSlideIndex(0);
  }, [eplId, epl?.id]);

  // Автоподтягивание: пока нет qrCode или mintransId — опрашиваем каждые 15 сек
  useEffect(() => {
    if (!epl) return;
    // Если QR уже есть — нечего опрашивать
    if (epl.qrCode && (epl.documentPdfAvailable ? epl.documentQr : true)) return;
    // Если ЭПЛ в процессе создания (нет mintransId) или создан но без QR / documentQr — поллим
    const needPoll = !epl.mintransId || (!epl.qrCode && (!epl.documentPdfAvailable || !epl.documentQr));
    if (!needPoll) return;
    const interval = setInterval(async () => {
      try {
        const res = await api.get(`/driver/epl/${eplId}`);
        setEpl(prev => {
          if (res.data?.qrCode || (res.data?.mintransId && !prev?.mintransId)) return res.data;
          if (res.data?.documentQr !== prev?.documentQr || res.data?.documentPdfAvailable !== prev?.documentPdfAvailable || res.data?.titlesT1T4Signed !== prev?.titlesT1T4Signed || res.data?.status !== prev?.status || res.data?.mintransId !== prev?.mintransId) return res.data;
          return prev;
        });
        if (res.data?.qrCode && (res.data?.documentPdfAvailable ? res.data?.documentQr : true)) clearInterval(interval);
      } catch (_) {}
    }, 15000);
    return () => clearInterval(interval);
  }, [epl?.qrCode, epl?.documentPdfAvailable, epl?.mintransId, epl?.status, eplId]);

  const loadEplData = async () => {
    try {
      setLoading(true);
      const [eplRes, titlesRes] = await Promise.all([
        api.get(`/driver/epl/${eplId}`),
        api.get(`/driver/epl/${eplId}/titles`).catch(() => ({ data: [] }))
      ]);
      setEpl(eplRes.data);
      setTitles(titlesRes.data || []);
    } catch (err) {
      if (err.response?.status === 404) setEpl(null);
      else showToast(`❌ ${err.response?.data?.error || err.message || 'Не удалось загрузить путевой'}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitEpl = async () => {
    try {
      setSubmitting(true);
      await api.post(`/driver/epl/${eplId}/submit`);
      showToast('✅ Путевой отправлен', 'success');
      await loadEplData();
    } catch (err) {
      showToast(`❌ ${err.response?.data?.error || err.message || 'Не удалось отправить'}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const openDocumentPdf = async () => {
    try {
      setOpeningPdf(true);
      const res = await api.get(`/driver/epl/${eplId}/document`, { responseType: 'blob' });
      await openPdfFromAxiosBlob(res);
      showToast('✅ Документ открыт в новой вкладке.', 'success');
    } catch (err) {
      let msg = err.response?.data?.error || err.message || 'Не удалось открыть документ';
      if (err.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const data = JSON.parse(text);
          if (data.error) msg = data.error;
        } catch (_) {}
      }
      showToast(`❌ ${msg}`, 'error');
    } finally {
      setOpeningPdf(false);
    }
  };

  const handleCompleteRide = async () => {
    const endOdo = endOdometerInput.trim() === '' ? null : parseInt(endOdometerInput, 10);
    if (endOdo === null || isNaN(endOdo) || endOdo < 0) {
      showToast('❌ Введите пробег при заезде (км)', 'error');
      return;
    }
    try {
      setCompletingRide(true);
      const { data } = await api.post(`/driver/epl/${eplId}/complete`, { endOdometer: endOdo });
      showToast(data?.message || '✅ Заявка принята. В ближайшее время вы получите уведомление о завершении рейса.', 'success');
      setEndOdometerInput('');
      await loadEplData();
    } catch (err) {
      showToast(`❌ ${err.response?.data?.details || err.response?.data?.error || err.message || 'Не удалось завершить рейс'}`, 'error');
    } finally {
      setCompletingRide(false);
    }
  };

  const handleCloseShift = async () => {
    const hasAnyDoc = !!(epl?.documentPdfReceivedAt || epl?.approvedAt || epl?.documentQr || epl?.documentPdfAvailable || epl?.qrCode);
    const question = hasAnyDoc
      ? 'Закрыть смену по этому ЭПЛ? После этого можно оформить новый путевой лист.'
      : 'Отменить оформление путевого листа? Затем можно создать новый ЭПЛ.';
    if (!window.confirm(question)) return;
    try {
      setClosingShift(true);
      await api.post(`/driver/epl/${eplId}/close-shift`);
      showToast('✅ Смена и рейс закрыты', 'success');
      navigate('/driver');
    } catch (err) {
      showToast(`❌ ${err.response?.data?.error || err.message || 'Не удалось закрыть смену'}`, 'error');
    } finally {
      setClosingShift(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen freight-panel-bg flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600 mb-4"></div>
          <p className="text-slate-600 font-semibold">Загрузка путевого...</p>
        </div>
      </div>
    );
  }

  if (!epl) {
    return (
      <div className="min-h-screen freight-panel-bg flex items-center justify-center p-4">
        <Card className="p-8 max-w-sm text-center">
          <XCircle className="w-16 h-16 mx-auto mb-4 text-red-500" />
          <p className="text-red-600 font-semibold text-lg mb-4">Путевой не найден</p>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate('/driver')}
            className="w-full bg-gradient-to-r from-teal-600 to-teal-800 text-white py-3 px-4 rounded-xl hover:from-teal-700 hover:to-teal-900 font-semibold transition shadow-md flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            В кабинет
          </motion.button>
        </Card>
      </div>
    );
  }

  const stats = epl.titleStats || { total: 6, filled: 0, signed: 0, percentFilled: 0, percentSigned: 0, titles: [] };

  // Простейшие статусы для водителя: создаётся / смена открыта / закрыта / авто-закрыта
  const hasDocumentOrQr = !!(epl.documentPdfReceivedAt || epl.approvedAt || epl.documentQr || epl.documentPdfAvailable || epl.qrCode);
  const shiftStatus = epl.shiftStatus || null;
  const isAutoClosed = shiftStatus === 'auto_closed';
  const isClosed = shiftStatus === 'closed';
  const isOpen = hasDocumentOrQr && !isClosed && !isAutoClosed;
  const isShiftOpen = isOpen;
  const isTaxcomOnly = epl.parkEplPrintMode === 'taxcom_only';
  const canCancelCreating = !hasDocumentOrQr && !isClosed && !isAutoClosed && (epl.status === 'pending_clinic' || epl.status === 'pending' || epl.status === 'draft');

  let statusLabel = 'Оформляется';
  if (!hasDocumentOrQr && isTaxcomOnly) statusLabel = 'ЭПЛ оформляется';
  if (isOpen) statusLabel = 'Рейс открыт';
  else if (isClosed) statusLabel = 'Смена закрыта';
  else if (isAutoClosed) statusLabel = 'Смена закрыта автоматически';

  const getStatusBadge = () => {
    if (isOpen) return 'from-teal-600 to-teal-800';
    if (isAutoClosed) return 'from-rose-600 to-red-700';
    if (isClosed) return 'from-slate-700 to-slate-800';
    return 'from-orange-500 to-orange-700'; // оформление
  };

  return (
    <div className="min-h-screen freight-panel-bg">
      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Назад в кабинет — компактная ссылка сверху */}
        <motion.button
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => navigate('/driver')}
          className="mb-4 flex items-center gap-1.5 text-slate-500 hover:text-slate-700 font-medium text-sm transition"
        >
          <ArrowLeft className="w-4 h-4" />
          В кабинет
        </motion.button>

        {/* Основная карточка */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden"
        >
          {/* Шапка карточки — тёмный градиент, белый текст хорошо читается */}
          <div className={`bg-gradient-to-r ${getStatusBadge()} px-6 py-6 text-white`}>
            <div className="flex justify-between items-start flex-wrap gap-3">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <FileText className="w-6 h-6 text-white" />
                  <h1 className="text-2xl font-bold font-mono text-white">{epl.waybillNumber}</h1>
                </div>
                <p className="text-white/95 text-sm">
                  {hasDocumentOrQr
                    ? `Рейс открыт с: ${formatDate(epl.documentPdfReceivedAt || epl.approvedAt || epl.createdAt)}`
                    : `Создан: ${formatDate(epl.createdAt)}. ${isTaxcomOnly ? 'Скоро появятся документ и QR.' : 'Ожидайте готовности документа.'}`}
                </p>
                {epl.commercialShippingLabel && (
                  <p className="text-white/85 text-xs mt-1.5">Вид коммерческой перевозки: {epl.commercialShippingLabel}</p>
                )}
              </div>
              <span className="px-4 py-2 bg-white/25 backdrop-blur-sm rounded-xl text-sm font-semibold text-white">
                {statusLabel}
              </span>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {epl.documentPdfAvailable && (
              <div className="rounded-xl border border-teal-200 bg-gradient-to-br from-teal-50 to-white px-4 py-3.5">
                <p className="text-sm font-bold text-teal-900">Путевой лист (PDF)</p>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Печатная форма по бланку: реквизиты, ТС, штампы предрейсового контроля. Ниже — кнопка открытия и QR на этот документ для проверки.
                </p>
              </div>
            )}

            {/* Информация о путевом — две плитки: водитель и авто */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 min-h-[72px] flex flex-col justify-center">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Водитель</p>
                <p className="text-sm font-semibold text-slate-800 leading-tight truncate" title={epl.driverName || ''}>{epl.driverName || '—'}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 min-h-[72px] flex flex-col justify-center">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Транспорт</p>
                <p className="text-sm font-semibold text-slate-800 leading-tight">{epl.regNumber || '—'}</p>
                {epl.brand && epl.model && (
                  <p className="text-xs text-slate-600 mt-0.5 leading-tight truncate">{epl.brand} {epl.model}</p>
                )}
              </div>
            </div>

            {/* Ненавязчивый блок ожидания для режима taxcom_only (без тех.слов) */}
            {!hasDocumentOrQr && isTaxcomOnly && (
              <div className="rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-xl bg-sky-100 text-sky-700">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900">Оформляется путевой лист</p>
                    <p className="text-sm text-slate-700 mt-1">
                      Документ и QR появятся после обработки. Страница обновится сама.
                    </p>
                    <p className="text-xs text-slate-500 mt-2">
                      Отмена — кнопка «Отменить» внизу, затем можно оформить новый ЭПЛ.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Документ готовится: пока нет QR — текст и кнопка PDF когда доступен */}
            {epl.mintransId && !epl.qrCode && !epl.documentQr && (
              <Card className="p-5 bg-emerald-50 border-emerald-200">
                <h3 className="font-semibold text-emerald-800 mb-2 flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  Документ готовится
                </h3>
                <p className="text-slate-700 text-center text-sm mb-4">
                  {epl.documentPdfAvailable
                    ? 'Документ готов — откройте его в блоке «Действия» ниже. QR обновится автоматически.'
                    : 'Ожидайте готовности документа. Обновится автоматически.'}
                </p>
              </Card>
            )}

            {/* Пока ждёшь — мини-игра. Не показываем при taxcom_only (там уже есть отдельная подсказка выше). */}
            {!isTaxcomOnly && (epl.status === 'pending_clinic' || (epl.status === 'pending' && !epl.mintransId)) && !epl.qrCode && !epl.documentQr && (
              <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border border-sky-200 bg-sky-50/90 p-4 flex flex-col sm:flex-row items-center justify-between gap-3"
                >
                  <p className="text-sky-950 font-medium text-sm sm:text-base">
                    Пока оформляется ЭПЛ — можно сыграть в мини-игру.
                  </p>
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => navigate('/driver/game')}
                    className="shrink-0 freight-btn-primary gap-2"
                  >
                    <Gamepad2 className="w-4 h-4" />
                    Играть
                  </motion.button>
                </motion.div>
            )}

            {/* QR-коды: QR на документ и QR из ГИС */}
            {(epl.documentQr || epl.qrCode) && (() => {
              const slides = [];
              if (epl.documentQr && epl.documentQr.trim()) slides.push({ key: 'pdf', label: 'QR на документ', src: epl.documentQr });
              if (epl.qrCode && epl.qrCode.trim()) slides.push({ key: 'control', label: 'QR для контроля', src: epl.qrCode });
              const idx = Math.min(qrSlideIndex, Math.max(0, slides.length - 1));
              const slide = slides[idx];
              if (!slide) return null;
              return (
                <Card className="p-6 bg-gradient-to-br from-emerald-50 to-blue-50 text-center">
                  <div className="flex items-center justify-center gap-2 mb-3">
                    <QrCode className="w-6 h-6 text-emerald-600" />
                    <h3 className="font-bold text-slate-800 text-lg">{slide.label}</h3>
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    {slides.length > 1 && (
                      <button type="button" onClick={() => setQrSlideIndex(i => (i - 1 + slides.length) % slides.length)} className="p-2 rounded-xl bg-white/80 hover:bg-white border-2 border-emerald-200 text-emerald-700" aria-label="Предыдущий QR">
                        <ChevronLeft className="w-6 h-6" />
                      </button>
                    )}
                    <div className="inline-block bg-white p-5 rounded-xl border-2 border-emerald-200 shadow-md">
                      {slide.src.startsWith('data:image') ? (
                        <img src={slide.src} alt={slide.label} className="w-[240px] h-[240px] object-contain mx-auto" />
                      ) : (
                        <code className="text-xs text-slate-600 break-all font-mono">{slide.src}</code>
                      )}
                    </div>
                    {slides.length > 1 && (
                      <button type="button" onClick={() => setQrSlideIndex(i => (i + 1) % slides.length)} className="p-2 rounded-xl bg-white/80 hover:bg-white border-2 border-emerald-200 text-emerald-700" aria-label="Следующий QR">
                        <ChevronRight className="w-6 h-6" />
                      </button>
                    )}
                  </div>
                </Card>
              );
            })()}

            {/* Панель действий — под QR (и вообще в самом низу, чтобы всегда была на одном месте). */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-3">Действия</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <motion.button
                  type="button"
                  onClick={openDocumentPdf}
                  disabled={!epl.documentPdfAvailable || openingPdf}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  className={`w-full rounded-2xl font-semibold flex items-center justify-center gap-2 transition ${
                    epl.documentPdfAvailable
                      ? 'freight-btn-primary py-3'
                      : 'px-4 py-3 bg-slate-100 text-slate-400 cursor-not-allowed shadow-sm'
                  }`}
                >
                  {openingPdf ? (
                    <>
                      <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Открываем документ...
                    </>
                  ) : (
                    <>
                      <FileText className="w-4 h-4" />
                      Открыть путевой (PDF)
                    </>
                  )}
                </motion.button>

                <motion.button
                  type="button"
                  onClick={handleCloseShift}
                  disabled={closingShift || (!isShiftOpen && !canCancelCreating)}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  className={`w-full px-4 py-3 rounded-2xl font-semibold flex items-center justify-center gap-2 transition shadow-sm ${
                    (isShiftOpen || canCancelCreating)
                      ? 'bg-slate-700 hover:bg-slate-800 text-white'
                      : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  {closingShift ? (
                    <>
                      <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Выполняем...
                    </>
                  ) : (
                    <>
                      <LogOut className="w-4 h-4" />
                      {isShiftOpen ? 'Закрыть смену' : 'Отменить ЭПЛ'}
                    </>
                  )}
                </motion.button>
              </div>
              {!epl.documentPdfAvailable && (
                <p className="text-xs text-slate-500 mt-3">
                  Документ появится автоматически. При необходимости отмените оформление и создайте новый ЭПЛ.
                </p>
              )}
            </div>

          </div>
        </motion.div>

      </div>
    </div>
  );
}
