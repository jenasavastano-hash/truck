import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, Video, Check, ChevronRight, Upload, AlertCircle } from 'lucide-react';
import api from '../api';
import { useToast } from '../hooks/useToast';
import { formatDateMsk } from '../utils/dateFormatter';

const STEPS = [
  { index: 1, type: 'photo', title: 'Фото спереди', desc: 'Сделайте чёткое фото автомобиля спереди. Должен быть виден номер и весь автомобиль целиком. Фото должно быть светлым, без бликов и посторонних предметов.' },
  { index: 2, type: 'photo', title: 'Со стороны водителя', desc: 'Сделайте фото автомобиля сбоку со стороны водителя. Важно, чтобы были видны двери и колёса. Фото должно быть чётким и красивым.' },
  { index: 3, type: 'photo', title: 'Сбоку (напротив водителя)', desc: 'Сделайте фото ТС сбоку с противоположной от водителя стороны. Должны быть видны двери и колёса. Фото — чёткое, без бликов.' },
  { index: 4, type: 'photo', title: 'Фото сзади', desc: 'Сделайте чёткое фото автомобиля сзади. Должен быть виден номер и весь автомобиль целиком. Фото должно быть светлым, без бликов и посторонних предметов.' },
  { index: 5, type: 'photo', title: 'Открытый багажник', desc: 'Сделайте фото открытого багажника. Важно, чтобы багажник был чистым и пустым. Фото должно быть чётким.' },
  { index: 6, type: 'video', title: 'Видео обхода авто', desc: 'Снимите короткое видео (5–10 секунд), обойдите автомобиль по кругу, чтобы были видны все стороны. Видео должно быть без резких движений и хорошо освещено.' },
  { index: 7, type: 'photo', title: 'Салон спереди', desc: 'Сделайте фото передней части салона: сиденья, приборная панель, руль. Фото должно быть чётким и показывать чистоту.' },
  { index: 8, type: 'photo', title: 'Салон сзади', desc: 'Сделайте фото задней части салона: сиденья, двери. Фото должно быть чётким и показывать чистоту.' },
  { index: 9, type: 'video', title: 'Видео салона', desc: 'Снимите короткое видео салона, чтобы были видны все детали и чистота. Видео должно быть без резких движений и хорошо освещено.' },
  { index: 10, type: 'photo', title: 'Пробег', desc: 'Сделайте чёткое фото приборной панели, чтобы был виден текущий пробег. Фото должно быть без бликов и размытости.' }
];

const STATUS_LABELS = {
  draft: 'Черновик',
  filling: 'Заполняется',
  pending: 'На проверке',
  approved: 'Подтверждён',
  rejected: 'Отклонён'
};

export default function DriverPhotoControlApplication() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const fileInputRef = useRef(null);
  const correctionFileRef = useRef(null);
  const [replaceStepIndex, setReplaceStepIndex] = useState(null);
  const [app, setApp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [stepBlobUrls, setStepBlobUrls] = useState({});
  const blobUrlsRef = useRef({});

  useEffect(() => {
    load();
  }, [id]);

  // Для просмотра прошлой заявки: загружаем файлы шагов как blob URL
  useEffect(() => {
    const isFilling = app?.status === 'filling' || app?.status === 'draft';
    if (!app || !id || isFilling || !(app.steps?.length)) return;
    const stepsWithFile = (app.steps || []).filter((s) => s.filePath);
    if (stepsWithFile.length === 0) return;
    // Освобождаем предыдущие blob URL
    Object.values(blobUrlsRef.current).forEach((u) => typeof u === 'string' && URL.revokeObjectURL(u));
    blobUrlsRef.current = {};
    let cancelled = false;
    (async () => {
      for (const step of stepsWithFile) {
        if (cancelled) break;
        try {
          const { data } = await api.get(`/driver/photo-control/${id}/steps/${step.stepIndex}/file`, { responseType: 'blob' });
          if (cancelled) {
            URL.revokeObjectURL(URL.createObjectURL(data));
            break;
          }
          const url = URL.createObjectURL(data);
          blobUrlsRef.current[step.stepIndex] = url;
        } catch (_) {
          blobUrlsRef.current[step.stepIndex] = null;
        }
      }
      if (!cancelled) setStepBlobUrls({ ...blobUrlsRef.current });
    })();
    return () => {
      cancelled = true;
      Object.values(blobUrlsRef.current).forEach((u) => typeof u === 'string' && URL.revokeObjectURL(u));
      blobUrlsRef.current = {};
    };
  }, [app?.id, app?.status, app?.steps, id]);

  const load = async () => {
    try {
      setLoading(true);
      const { data } = await api.get(`/driver/photo-control/${id}`);
      setApp(data);
    } catch (e) {
      showToast('Заявка не найдена', 'error');
      navigate('/driver/photo-control');
    } finally {
      setLoading(false);
    }
  };

  const stepData = app?.steps || [];
  const hasStep = (idx) => stepData.some(s => s.stepIndex === idx);
  const filledCount = stepData.length;
  const canSubmit = filledCount >= 10;
  const isFilling = app?.status === 'filling' || app?.status === 'draft';

  const handleFile = async (file, stepIndex, mediaType) => {
    if (!file) return;
    const step = STEPS.find(s => s.index === stepIndex);
    const isVideo = step?.type === 'video';
    const reader = new FileReader();
    reader.onload = async () => {
      const content = reader.result;
      try {
        setUploading(true);
        await api.put(`/driver/photo-control/${id}/steps/${stepIndex}`, {
          mediaType: isVideo ? 'video' : 'photo',
          content: content.split(',')[1] || content
        });
        showToast(`Шаг ${stepIndex} сохранён`, 'success');
        await load();
      } catch (e) {
        showToast(e.response?.data?.error || 'Ошибка загрузки', 'error');
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleInputChange = (e, stepIndex) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const step = STEPS.find(s => s.index === stepIndex);
    if (step?.type === 'video') {
      handleFile(file, stepIndex, 'video');
    } else {
      handleFile(file, stepIndex, 'photo');
    }
    e.target.value = '';
  };

  const handleSubmit = async () => {
    if (!canSubmit) {
      showToast('Заполните все 10 шагов', 'error');
      return;
    }
    try {
      setSubmitting(true);
      await api.patch(`/driver/photo-control/${id}/submit`);
      showToast('Заявка отправлена на проверку', 'success');
      navigate('/driver/photo-control');
    } catch (e) {
      showToast(e.response?.data?.error || 'Ошибка отправки', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !app) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-600" />
      </div>
    );
  }

  // На доработке: механик запросил исправить часть шагов
  if (!isFilling && app.status === 'pending' && app.correctionRequestedAt) {
    const stepsToFix = (app.steps || []).filter((s) => s.managerVerdict === 'needs_correction');
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 pb-12">
        <header className="bg-white/80 backdrop-blur-md border-b border-slate-200/50 sticky top-0 z-20">
          <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
            <button onClick={() => navigate('/driver/photo-control')} className="p-2 rounded-xl hover:bg-slate-100">
              <ArrowLeft className="w-5 h-5 text-slate-700" />
            </button>
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-amber-100 rounded-lg"><AlertCircle className="w-5 h-5 text-amber-600" /></div>
              <h1 className="text-lg font-bold text-slate-800">Доработка заявки</h1>
            </div>
          </div>
        </header>
        <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <p className="font-semibold text-amber-800">Механик запросил доработку</p>
            <p className="text-sm text-amber-700 mt-1">Перезагрузите фото или видео для указанных шагов. После сохранения заявка снова попадёт на проверку.</p>
          </div>
          <input
            ref={correctionFileRef}
            type="file"
            accept={replaceStepIndex ? (STEPS.find((s) => s.index === replaceStepIndex)?.type === 'video' ? 'video/*' : 'image/*') : ''}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && replaceStepIndex) {
                const step = STEPS.find((s) => s.index === replaceStepIndex);
                handleFile(file, replaceStepIndex, step?.type === 'video' ? 'video' : 'photo');
                setReplaceStepIndex(null);
              }
              e.target.value = '';
            }}
          />
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
            {stepsToFix.map((step) => {
              const stepDef = STEPS.find((s) => s.index === step.stepIndex);
              const blobUrl = stepBlobUrls[step.stepIndex];
              const isVideo = step.mediaType === 'video';
              return (
                <div key={step.stepIndex} className="p-4 sm:p-6">
                  <div className="flex items-center gap-2 mb-2">
                    {isVideo ? <Video className="w-5 h-5 text-sky-600 shrink-0" /> : <Camera className="w-5 h-5 text-sky-600 shrink-0" />}
                    <h3 className="font-semibold text-slate-800">Шаг {step.stepIndex}/10 — {stepDef?.title || step.stepIndex}</h3>
                  </div>
                  {step.managerComment && (
                    <p className="text-sm text-amber-700 bg-amber-50 rounded-lg p-2 mb-3">Комментарий механика: {step.managerComment}</p>
                  )}
                  {blobUrl ? (
                    isVideo ? (
                      <video src={blobUrl} controls className="w-full rounded-xl border border-slate-200 bg-slate-900 max-h-[280px]" playsInline />
                    ) : (
                      <img src={blobUrl} alt="" className="w-full rounded-xl border border-slate-200 object-contain max-h-[280px] bg-slate-50" />
                    )
                  ) : (
                    <div className="py-8 rounded-xl bg-slate-50 border border-slate-200 text-center text-slate-500 text-sm">Загрузка…</div>
                  )}
                  <button
                    type="button"
                    onClick={() => { setReplaceStepIndex(step.stepIndex); setTimeout(() => correctionFileRef.current?.click(), 0); }}
                    disabled={uploading}
                    className="mt-3 w-full py-2.5 rounded-xl border-2 border-sky-300 bg-sky-50 text-sky-700 font-medium hover:bg-sky-100 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <Upload className="w-4 h-4" /> {uploading ? 'Загрузка…' : 'Заменить ' + (isVideo ? 'видео' : 'фото')}
                  </button>
                </div>
              );
            })}
          </div>
        </main>
      </div>
    );
  }

  // Просмотр прошлой заявки: все фото/видео и подробная информация
  if (!isFilling) {
    const stepDataMap = (app?.steps || []).reduce((acc, s) => { acc[s.stepIndex] = s; return acc; }, {});
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 pb-12">
        <header className="bg-white/80 backdrop-blur-md border-b border-slate-200/50 sticky top-0 z-20">
          <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
            <button onClick={() => navigate('/driver/photo-control')} className="p-2 rounded-xl hover:bg-slate-100">
              <ArrowLeft className="w-5 h-5 text-slate-700" />
            </button>
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-sky-100 rounded-lg"><Camera className="w-5 h-5 text-sky-600" /></div>
              <h1 className="text-lg font-bold text-slate-800">Заявка на фотоконтроль</h1>
            </div>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
          {/* Карточка: авто, статус, даты */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-sky-600 to-sky-700 text-white px-6 py-4">
              <h2 className="text-lg font-bold">Подробности заявки</h2>
            </div>
            <div className="p-6 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Автомобиль</span>
                <span className="font-semibold text-slate-800">{app.regNumber || `Заявка #${app.id}`}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Статус</span>
                <span className={`font-semibold ${app.status === 'approved' ? 'text-emerald-600' : app.status === 'rejected' ? 'text-red-600' : 'text-amber-600'}`}>
                  {STATUS_LABELS[app.status] || app.status}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Создана</span>
                <span className="text-slate-800">{formatDateMsk(app.createdAt)}</span>
              </div>
              {app.approvedAt && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Подтверждена</span>
                  <span className="text-slate-800">{formatDateMsk(app.approvedAt)}</span>
                </div>
              )}
              {app.validUntil && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">ФК действует до</span>
                  <span className="text-slate-800">{new Date(app.validUntil).toLocaleDateString('ru-RU')}</span>
                </div>
              )}
              {app.status === 'rejected' && app.rejectReason && (
                <div className="mt-3 p-3 bg-red-50 rounded-xl border border-red-100">
                  <p className="text-sm text-red-800 font-medium">Причина отклонения</p>
                  <p className="text-slate-700 mt-1">{app.rejectReason}</p>
                </div>
              )}
            </div>
          </div>

          {/* Фото и видео по шагам */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-3 border-b border-slate-100">
              <h2 className="font-bold text-slate-800">Фото и видео заявки</h2>
            </div>
            <div className="divide-y divide-slate-100">
              {STEPS.map((step) => {
                const stepInfo = stepDataMap[step.index];
                const blobUrl = stepInfo ? stepBlobUrls[step.index] : null;
                const isVideo = step.type === 'video';
                return (
                  <div key={step.index} className="p-4 sm:p-6">
                    <div className="flex items-center gap-2 mb-3">
                      {isVideo ? (
                        <Video className="w-5 h-5 text-sky-600 shrink-0" />
                      ) : (
                        <Camera className="w-5 h-5 text-sky-600 shrink-0" />
                      )}
                      <h3 className="font-semibold text-slate-800">
                        Шаг {step.index}/10 — {step.title}
                      </h3>
                    </div>
                    {blobUrl ? (
                      isVideo ? (
                        <video
                          src={blobUrl}
                          controls
                          className="w-full rounded-xl border border-slate-200 bg-slate-900 max-h-[320px]"
                          playsInline
                        />
                      ) : (
                        <img
                          src={blobUrl}
                          alt={step.title}
                          className="w-full rounded-xl border border-slate-200 object-contain max-h-[400px] bg-slate-50"
                        />
                      )
                    ) : stepInfo ? (
                      <div className="py-8 rounded-xl bg-slate-50 border border-slate-200 text-center text-slate-500 text-sm">
                        Загрузка…
                      </div>
                    ) : (
                      <div className="py-6 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-center text-slate-400 text-sm">
                        Файл не загружен
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      </div>
    );
  }

  const step = STEPS.find(s => s.index === currentStep);
  const hasCurrent = hasStep(currentStep);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 pb-24">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-200/50 sticky top-0 z-20">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <button onClick={() => navigate('/driver/photo-control')} className="p-2 rounded-xl hover:bg-slate-100">
            <ArrowLeft className="w-5 h-5 text-slate-700" />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-600">Шаг {currentStep}/10</span>
            <div className="w-24 h-2 bg-slate-200 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-sky-500 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${(filledCount / 10) * 100}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
          >
            <div className="p-6">
              <div className="flex items-center gap-2 mb-2">
                {step?.type === 'video' ? (
                  <Video className="w-6 h-6 text-sky-600" />
                ) : (
                  <Camera className="w-6 h-6 text-sky-600" />
                )}
                <h2 className="text-lg font-bold text-slate-800">
                  📸 Шаг {step?.index}/10 — {step?.title}
                </h2>
              </div>
              <p className="text-slate-600 text-sm mb-6">{step?.desc}</p>

              <input
                ref={fileInputRef}
                type="file"
                accept={step?.type === 'video' ? 'video/*' : 'image/*'}
                capture={step?.type === 'video' ? undefined : 'environment'}
                className="hidden"
                onChange={(e) => handleInputChange(e, currentStep)}
              />

              {hasCurrent ? (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex items-center gap-3">
                  <Check className="w-6 h-6 text-emerald-600" />
                  <span className="font-medium text-emerald-800">Файл загружен</span>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="ml-auto text-sm text-emerald-600 hover:underline"
                  >
                    Заменить
                  </button>
                </div>
              ) : (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="w-full py-8 px-6 rounded-xl border-2 border-dashed border-sky-300 bg-sky-50/50 hover:bg-sky-50 flex flex-col items-center gap-2 text-sky-700 font-medium disabled:opacity-60"
                >
                  <Upload className="w-10 h-10" />
                  {uploading ? 'Загрузка...' : (step?.type === 'video' ? 'Выбрать видео' : 'Сделать или выбрать фото')}
                </motion.button>
              )}
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Навигация по шагам */}
        <div className="flex items-center justify-between mt-6">
          <button
            type="button"
            onClick={() => setCurrentStep((s) => Math.max(1, s - 1))}
            disabled={currentStep === 1}
            className="py-2.5 px-4 rounded-xl border border-slate-300 text-slate-700 font-medium disabled:opacity-40"
          >
            Назад
          </button>
          {currentStep < 10 ? (
            <button
              type="button"
              onClick={() => setCurrentStep((s) => s + 1)}
              className="py-2.5 px-4 rounded-xl bg-sky-600 text-white font-medium flex items-center gap-1"
            >
              Далее <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <div />
          )}
        </div>

        {/* Чеклист и отправка */}
        <div className="mt-8 bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h3 className="font-bold text-slate-800 mb-4">🧾 Проверим комплект:</h3>
          <ul className="space-y-2 mb-6">
            {STEPS.map((s) => (
              <li key={s.index} className="flex items-center gap-2 text-sm">
                {hasStep(s.index) ? (
                  <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                ) : (
                  <span className="w-4 h-4 rounded-full border-2 border-slate-300 shrink-0" />
                )}
                <span className={hasStep(s.index) ? 'text-slate-700' : 'text-slate-400'}>
                  {s.type === 'video' ? '🎥' : '📸'} {s.title}
                </span>
              </li>
            ))}
          </ul>
          <motion.button
            whileHover={canSubmit ? { scale: 1.02 } : {}}
            whileTap={canSubmit ? { scale: 0.98 } : {}}
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className={`w-full py-4 rounded-xl font-semibold ${canSubmit ? 'bg-gradient-to-r from-sky-500 to-sky-600 text-white hover:from-sky-600 hover:to-sky-700' : 'bg-slate-200 text-slate-500 cursor-not-allowed'} disabled:opacity-70`}
          >
            {submitting ? 'Отправка...' : 'Отправить на проверку'}
          </motion.button>
        </div>
      </main>
    </div>
  );
}
