import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { X, QrCode, FileText, Loader2, Trash2, Gamepad2, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../api';
import { openPdfFromAxiosBlob } from '../utils/openPdfFromAxiosBlob';

export default function EPLQRFullScreen() {
  const { eplId } = useParams();
  const navigate = useNavigate();
  const [epl, setEpl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openingPdf, setOpeningPdf] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [gameEnabled, setGameEnabled] = useState(false);
  const [qrSlideIndex, setQrSlideIndex] = useState(0);

  useEffect(() => {
    setQrSlideIndex(0);
    let cancelled = false;
    api
      .get(`/driver/epl/${eplId}`)
      .then((res) => {
        if (!cancelled) setEpl(res.data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.error || 'Не удалось загрузить данные');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [eplId]);

  // Polling: пока нет QR (documentQr или qrCode) — опрашиваем каждые 15 сек
  useEffect(() => {
    if (!epl) return;
    const hasAnyQr = (epl.documentQr && epl.documentQr.trim()) || (epl.qrCode && epl.qrCode.trim());
    if (hasAnyQr) return;
    const interval = setInterval(async () => {
      try {
        const res = await api.get(`/driver/epl/${eplId}`);
        if (res.data) setEpl(res.data);
        const any = (res.data?.documentQr && res.data.documentQr.trim()) || (res.data?.qrCode && res.data.qrCode.trim());
        if (any) clearInterval(interval);
      } catch (_) {}
    }, 15000);
    return () => clearInterval(interval);
  }, [epl?.qrCode, epl?.documentQr, eplId]);

  useEffect(() => {
    const hasAnyQr = epl && ((epl.documentQr && epl.documentQr.trim()) || (epl.qrCode && epl.qrCode.trim()));
    if (!epl || hasAnyQr) return;
    api.get('/driver/game/settings')
      .then((r) => setGameEnabled(!!r.data?.gameEnabled))
      .catch(() => setGameEnabled(false));
  }, [epl?.id, epl?.qrCode, epl?.documentQr]);

  const openDocumentPdf = async () => {
    try {
      setOpeningPdf(true);
      const res = await api.get(`/driver/epl/${eplId}/document`, { responseType: 'blob' });
      await openPdfFromAxiosBlob(res);
      alert('Документ открыт в новой вкладке.');
    } catch (err) {
      let msg = err.response?.data?.error || err.message || 'Не удалось открыть документ';
      if (err.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const data = JSON.parse(text);
          if (data.error) msg = data.error;
        } catch (_) {}
      }
      alert(msg);
    } finally {
      setOpeningPdf(false);
    }
  };

  const cancelEpl = async () => {
    try {
      setCancelling(true);
      setShowCancelConfirm(false);
      await api.post(`/driver/epl/${eplId}/close-shift`);
      navigate('/driver');
    } catch (err) {
      alert(err.response?.data?.error || 'Не удалось отменить путевой лист');
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-slate-900/95 flex items-center justify-center z-50">
        <div className="text-white text-center">
          <div className="inline-block w-10 h-10 border-2 border-white border-t-transparent rounded-full animate-spin mb-4" />
          <p>Загрузка путевого листа...</p>
        </div>
      </div>
    );
  }

  if (error || !epl) {
    return (
      <div className="fixed inset-0 bg-slate-900/95 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800 rounded-2xl p-8 max-w-sm text-center text-white">
          <p className="text-red-300 mb-6">{error || 'Путевой не найден'}</p>
          <button
            type="button"
            onClick={() => navigate('/driver')}
            className="px-6 py-2 rounded-xl bg-slate-600 hover:bg-slate-500"
          >
            В кабинет
          </button>
        </div>
      </div>
    );
  }

  const hasDocumentQr = epl.documentQr && epl.documentQr.trim().length > 0;
  const hasTakskomQr = epl.qrCode && epl.qrCode.trim().length > 0;
  const hasQr = hasDocumentQr || hasTakskomQr;
  const hasMintrans = !!epl.mintransId;
  const hasPdf = !!epl.documentPdfAvailable;
  const qrSlides = [];
  if (hasDocumentQr) qrSlides.push({ key: 'pdf', label: 'QR на документ', src: epl.documentQr });
  if (hasTakskomQr) qrSlides.push({ key: 'takskom', label: 'QR из ГИС', src: epl.qrCode });
  const qrIdx = Math.min(qrSlideIndex, Math.max(0, qrSlides.length - 1));
  const currentQrSlide = qrSlides[qrIdx];

  return (
    <div className="fixed inset-0 bg-slate-900/98 flex flex-col items-center justify-center z-50 p-4 overflow-y-auto">
      <button
        type="button"
        onClick={() => navigate('/driver')}
        className="absolute top-4 right-4 p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition z-10"
        aria-label="Закрыть"
      >
        <X className="w-6 h-6" />
      </button>

      <div className="bg-white rounded-3xl shadow-2xl p-8 sm:p-10 flex flex-col items-center max-w-lg w-full border-4 border-emerald-500/30 my-auto">
        {/* Заголовок */}
        <div className="flex items-center gap-2 text-slate-700 mb-2">
          <FileText className="w-7 h-7 text-emerald-600" />
          <span className="text-xl font-bold">Электронный путевой лист</span>
        </div>
        {epl.waybillNumber && (
          <p className="text-slate-500 text-sm font-mono mb-5">{epl.waybillNumber}</p>
        )}

        {/* QR-код на документ или из ГИС */}
        {hasQr && currentQrSlide && (
          <div className="mb-6">
            <div className="flex items-center justify-center gap-2 mb-3">
              <QrCode className="w-5 h-5 text-emerald-600" />
              <span className="text-sm font-semibold text-slate-600">{currentQrSlide.label}</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              {qrSlides.length > 1 && (
                <button type="button" onClick={() => setQrSlideIndex(i => (i - 1 + qrSlides.length) % qrSlides.length)} className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700" aria-label="Предыдущий QR">
                  <ChevronLeft className="w-6 h-6" />
                </button>
              )}
              <div className="bg-white p-5 rounded-2xl border-2 border-emerald-200 shadow-inner">
                {currentQrSlide.src.startsWith('data:image') ? (
                  <img
                    src={currentQrSlide.src}
                    alt={currentQrSlide.label}
                    className="w-56 h-56 sm:w-72 sm:h-72 object-contain mx-auto"
                  />
                ) : (
                  <div className="w-56 h-56 sm:w-72 sm:h-72 flex items-center justify-center">
                    <code className="text-xs text-slate-600 break-all font-mono p-2">{currentQrSlide.src}</code>
                  </div>
                )}
              </div>
              {qrSlides.length > 1 && (
                <button type="button" onClick={() => setQrSlideIndex(i => (i + 1) % qrSlides.length)} className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700" aria-label="Следующий QR">
                  <ChevronRight className="w-6 h-6" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Путевой в процессе — нейтральный текст */}
        {!hasQr && (
          <div className="mb-6 text-center">
            <div className="flex items-center justify-center gap-2 mb-3">
              <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />
              <span className="text-sm font-semibold text-slate-600">
                {hasMintrans ? 'Документ готовится' : 'Оформление'}
              </span>
            </div>
            <p className="text-slate-500 text-sm">
              Документ и QR появятся здесь. Обновится автоматически.
            </p>
            {gameEnabled && (
              <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <p className="text-amber-800 font-medium text-sm mb-2">Пока ждёте — сыграйте!</p>
                <button
                  type="button"
                  onClick={() => navigate('/driver/game')}
                  className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold flex items-center justify-center gap-2"
                >
                  <Gamepad2 className="w-5 h-5" />
                  Мини-игра
                </button>
              </div>
            )}
          </div>
        )}

        {/* Кнопка PDF — показываем, как только документ доступен */}
        {hasPdf && (
          <button
            type="button"
            onClick={openDocumentPdf}
            disabled={openingPdf}
            className="w-full py-3.5 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold flex items-center justify-center gap-2 transition shadow-lg mb-3"
          >
            {openingPdf ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Загрузка PDF...
              </>
            ) : (
              <>
                <FileText className="w-5 h-5" />
                Открыть документ (PDF)
              </>
            )}
          </button>
        )}

        {/* Кнопка Отменить путевой (только если нет QR и документ ещё не оформлен) */}
        {!hasQr && !hasMintrans && (
          <button
            type="button"
            onClick={() => setShowCancelConfirm(true)}
            disabled={cancelling}
            className="w-full py-3 px-6 rounded-xl bg-red-100 hover:bg-red-200 text-red-700 font-medium flex items-center justify-center gap-2 transition mb-3"
          >
            <Trash2 className="w-4 h-4" />
            {cancelling ? 'Отменяем...' : 'Отменить путевой лист'}
          </button>
        )}

        {/* Кнопка Закрыть */}
        <button
          type="button"
          onClick={() => navigate('/driver')}
          className="w-full py-3 px-6 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium transition"
        >
          Назад
        </button>
      </div>

      {/* Модал подтверждения отмены */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-bold text-slate-800 mb-2">Отменить путевой лист?</h3>
            <p className="text-slate-600 text-sm mb-6">
              Создающийся путевой лист будет отменён. После этого вы сможете создать новый.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowCancelConfirm(false)}
                className="flex-1 py-2.5 px-4 rounded-xl font-medium border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Назад
              </button>
              <button
                type="button"
                onClick={cancelEpl}
                disabled={cancelling}
                className="flex-1 py-2.5 px-4 rounded-xl font-semibold bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
              >
                {cancelling ? 'Отменяем...' : 'Отменить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
