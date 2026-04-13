import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Camera, CheckCircle2, XCircle, Clock, User, Car, ChevronRight, ThumbsUp, AlertCircle } from 'lucide-react';
import api from '../../api';
import {
  getPhotoControlApplications,
  getPhotoControlApplication,
  approvePhotoControl,
  rejectPhotoControl,
  setPhotoControlStepVerdicts,
  requestPhotoControlCorrection
} from '../../api/managerApi';
import { operationsShell } from '../../utils/operationsUi';

const FC_STEP_TITLES = {
  1: 'Фото спереди',
  2: 'Со стороны водителя',
  3: 'Сбоку (напротив водителя)',
  4: 'Фото сзади',
  5: 'Открытый багажник',
  6: 'Видео обхода авто',
  7: 'Салон спереди',
  8: 'Салон сзади',
  9: 'Видео салона',
  10: 'Пробег'
};

function StepMedia({ appId, step }) {
  const [blobUrl, setBlobUrl] = useState('');
  useEffect(() => {
    if (!appId || !step?.stepIndex) return;
    api.get(`/manager/photo-control/applications/${appId}/steps/${step.stepIndex}/file`, { responseType: 'blob' })
      .then((r) => setBlobUrl(URL.createObjectURL(r.data)))
      .catch(() => {});
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [appId, step?.stepIndex]);
  if (!blobUrl) return <div className="rounded-lg bg-slate-100 w-full h-32 flex items-center justify-center text-slate-400">Загрузка...</div>;
  if (step.mediaType === 'video') {
    return <video src={blobUrl} controls className="rounded-lg w-full max-h-48 bg-black" />;
  }
  return <img src={blobUrl} alt={`Шаг ${step.stepIndex}`} className="rounded-lg w-full object-contain max-h-48 bg-slate-100" />;
}

export default function FCTab({ parkId, sceneNight = false }) {
  const [filter, setFilter] = useState('pending');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [actioning, setActioning] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [stepVerdicts, setStepVerdicts] = useState({});
  const [stepComments, setStepComments] = useState({});

  const loadList = async () => {
    setLoading(true);
    try {
      const data = await getPhotoControlApplications(filter, parkId);
      setList(Array.isArray(data) ? data : []);
    } catch (_) {
      setList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadList();
  }, [filter, parkId]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setStepVerdicts({});
      setStepComments({});
      return;
    }
    getPhotoControlApplication(selectedId, parkId).then((d) => {
      setDetail(d);
      const v = {};
      const c = {};
      (d?.steps || []).forEach((s) => {
        if (s.managerVerdict) v[s.stepIndex] = s.managerVerdict;
        if (s.managerComment) c[s.stepIndex] = s.managerComment;
      });
      setStepVerdicts(v);
      setStepComments(c);
    }).catch(() => setDetail(null));
  }, [selectedId]);

  const stepsArray = useMemo(() => {
    if (!detail?.steps?.length) return [];
    return detail.steps.map((s) => ({ ...s, title: FC_STEP_TITLES[s.stepIndex] || `Шаг ${s.stepIndex}` }));
  }, [detail?.steps]);

  const allOk = stepsArray.length === 10 && stepsArray.every((s) => stepVerdicts[s.stepIndex] === 'ok');
  const hasNeedsCorrection = stepsArray.some((s) => stepVerdicts[s.stepIndex] === 'needs_correction');

  const setVerdict = (stepIndex, verdict, comment) => {
    setStepVerdicts((prev) => ({ ...prev, [stepIndex]: verdict }));
    if (comment !== undefined) setStepComments((prev) => ({ ...prev, [stepIndex]: comment || '' }));
  };

  const buildStepsPayload = () =>
    stepsArray.map((s) => ({
      stepIndex: s.stepIndex,
      verdict: stepVerdicts[s.stepIndex] || 'ok',
      comment: stepVerdicts[s.stepIndex] === 'needs_correction' ? (stepComments[s.stepIndex] || '') : undefined
    }));

  const handleApprove = async () => {
    if (!selectedId || !allOk) return;
    setActioning(true);
    try {
      await setPhotoControlStepVerdicts(selectedId, buildStepsPayload(), parkId);
      await approvePhotoControl(selectedId, parkId);
      setSelectedId(null);
      loadList();
    } catch (e) {
      alert(e.response?.data?.error || 'Ошибка');
    } finally {
      setActioning(false);
    }
  };

  const handleRequestCorrection = async () => {
    if (!selectedId || !hasNeedsCorrection) return;
    setActioning(true);
    try {
      await setPhotoControlStepVerdicts(selectedId, buildStepsPayload(), parkId);
      await requestPhotoControlCorrection(selectedId, parkId);
      setSelectedId(null);
      loadList();
    } catch (e) {
      alert(e.response?.data?.error || 'Ошибка');
    } finally {
      setActioning(false);
    }
  };

  const handleReject = async () => {
    if (!selectedId) return;
    setActioning(true);
    try {
      await rejectPhotoControl(selectedId, rejectReason || 'Отклонено', parkId);
      setSelectedId(null);
      setRejectReason('');
      loadList();
    } catch (e) {
      alert(e.response?.data?.error || 'Ошибка');
    } finally {
      setActioning(false);
    }
  };

  const chip = sceneNight
    ? 'border border-white/15 bg-white/[0.06] backdrop-blur-xl text-slate-100 ring-1 ring-white/10'
    : 'bg-white/75 backdrop-blur-md border border-white/60 shadow-slate-900/10';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full shadow-sm ${chip}`}>
          <Camera className={`w-5 h-5 ${sceneNight ? 'text-sky-300' : 'text-sky-600'}`} />
          <h2 className={`text-sm sm:text-base font-bold tracking-wide uppercase ${sceneNight ? '' : 'text-slate-900'}`}>
            Фотоконтроль
          </h2>
        </div>
        <div className={`flex items-center gap-2 text-xs sm:text-sm rounded-full px-3 py-1 shadow-sm ${chip}`}>
          <button
            type="button"
            onClick={() => setFilter('pending')}
            className={`px-3 py-1.5 rounded-full font-semibold border transition ${
              filter === 'pending'
                ? 'bg-teal-600 text-white border-teal-500 shadow-md'
                : sceneNight
                  ? 'bg-white/[0.08] text-slate-200 border-white/12 hover:bg-white/[0.12]'
                  : 'bg-white/50 text-slate-700 border-white/55 hover:bg-white/75'
            }`}
          >
            Новые
          </button>
          <button
            type="button"
            onClick={() => setFilter('past')}
            className={`px-3 py-1.5 rounded-full font-semibold border transition ${
              filter === 'past'
                ? 'bg-teal-600 text-white border-teal-500 shadow-md'
                : sceneNight
                  ? 'bg-white/[0.08] text-slate-200 border-white/12 hover:bg-white/[0.12]'
                  : 'bg-white/50 text-slate-700 border-white/55 hover:bg-white/75'
            }`}
          >
            Прошлые
          </button>
        </div>
      </div>

      {loading ? (
        <div className={`rounded-xl p-6 shadow-lg ${operationsShell(sceneNight)} ${sceneNight ? 'text-slate-300' : 'text-slate-600'}`}>
          Загрузка...
        </div>
      ) : list.length === 0 ? (
        <div className={`rounded-xl p-8 text-center shadow-md ${operationsShell(sceneNight)} ${sceneNight ? 'text-slate-400' : 'text-slate-600'}`}>
          <Camera className={`w-12 h-12 mx-auto mb-3 ${sceneNight ? 'text-slate-500' : 'text-slate-400'}`} />
          {filter === 'pending' ? 'Нет новых заявок на фотоконтроль' : 'Нет прошлых заявок'}
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((app) => (
            <motion.li
              key={app.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className={`rounded-xl shadow-sm overflow-hidden ${operationsShell(sceneNight)}`}
            >
              <button
                type="button"
                onClick={() => setSelectedId(app.id)}
                className={`w-full flex items-center justify-between p-4 text-left transition ${
                  sceneNight ? 'hover:bg-white/[0.04]' : 'hover:bg-white/30'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${sceneNight ? 'bg-sky-500/20' : 'bg-sky-100'}`}>
                    <Car className={`w-5 h-5 ${sceneNight ? 'text-sky-300' : 'text-sky-600'}`} />
                  </div>
                  <div>
                    <p className={`font-semibold ${sceneNight ? 'text-slate-50' : 'text-slate-800'}`}>
                      {app.driverName || app.driverPhone || 'Водитель'}
                    </p>
                    <p className={`text-sm ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>
                      {app.regNumber || 'Авто'} · {app.status === 'pending' ? 'На проверке' : app.status === 'approved' ? 'Подтверждён' : 'Отклонён'}
                    </p>
                  </div>
                </div>
                <ChevronRight className={`w-5 h-5 ${sceneNight ? 'text-slate-500' : 'text-slate-400'}`} />
              </button>
            </motion.li>
          ))}
        </ul>
      )}

      {/* Модалка детали заявки */}
      {selectedId && detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setSelectedId(null)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            className={`rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col ${
              sceneNight
                ? 'border border-white/15 bg-white/[0.07] backdrop-blur-xl text-slate-100 ring-1 ring-white/10'
                : 'border border-white/50 bg-white/92 backdrop-blur-xl'
            }`}
          >
            <div className={`p-4 flex items-center justify-between border-b ${sceneNight ? 'border-white/10' : 'border-slate-200'}`}>
              <div>
                <h3 className={`font-bold ${sceneNight ? 'text-slate-50' : 'text-slate-800'}`}>{detail.driverName || detail.driverPhone}</h3>
                <p className={`text-sm ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>{detail.regNumber} · {detail.status}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className={`p-2 rounded-lg ${sceneNight ? 'hover:bg-white/10 text-slate-300' : 'hover:bg-slate-100 text-slate-600'}`}
              >
                ✕
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 space-y-5">
              {stepsArray.length > 0 ? (
                stepsArray.map((step) => (
                  <div key={step.stepIndex} className={`border-b pb-4 last:border-0 ${sceneNight ? 'border-white/[0.08]' : 'border-slate-100'}`}>
                    <p className={`text-sm font-semibold mb-1 ${sceneNight ? 'text-slate-200' : 'text-slate-700'}`}>
                      Шаг {step.stepIndex} ({step.mediaType === 'video' ? 'видео' : 'фото'}) — {step.title}
                    </p>
                    <StepMedia appId={detail.id} step={step} />
                    {detail.status === 'pending' && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setVerdict(step.stepIndex, 'ok')}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${
                            stepVerdicts[step.stepIndex] === 'ok'
                              ? 'bg-emerald-600 text-white'
                              : sceneNight
                                ? 'bg-white/[0.08] text-slate-200 hover:bg-white/[0.12]'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          <ThumbsUp className="w-4 h-4" /> Норм
                        </button>
                        <button
                          type="button"
                          onClick={() => setVerdict(step.stepIndex, 'needs_correction')}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${
                            stepVerdicts[step.stepIndex] === 'needs_correction'
                              ? 'bg-amber-600 text-white'
                              : sceneNight
                                ? 'bg-white/[0.08] text-slate-200 hover:bg-white/[0.12]'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          <AlertCircle className="w-4 h-4" /> На доработку
                        </button>
                        {stepVerdicts[step.stepIndex] === 'needs_correction' && (
                          <input
                            type="text"
                            placeholder="Комментарий водителю (что исправить)"
                            value={stepComments[step.stepIndex] || ''}
                            onChange={(e) => setStepComments((prev) => ({ ...prev, [step.stepIndex]: e.target.value }))}
                            className={`flex-1 min-w-[180px] px-3 py-1.5 rounded-lg text-sm ${
                              sceneNight
                                ? 'border border-white/15 bg-white/[0.06] text-slate-100 placeholder:text-slate-400 backdrop-blur-md'
                                : 'border border-slate-300 bg-white/80'
                            }`}
                          />
                        )}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <p className={sceneNight ? 'text-slate-400 text-sm' : 'text-slate-500 text-sm'}>Нет загруженных шагов</p>
              )}
            </div>
            {detail.status === 'pending' && (
              <div className={`p-4 flex flex-col gap-3 border-t ${sceneNight ? 'border-white/10' : 'border-slate-200'}`}>
                <input
                  type="text"
                  placeholder="Причина отклонения (если отклонить)"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className={`w-full px-4 py-2 rounded-xl text-sm ${
                    sceneNight
                      ? 'border border-white/15 bg-white/[0.06] text-slate-100 placeholder:text-slate-400 backdrop-blur-md'
                      : 'border border-slate-300 bg-white/80'
                  }`}
                />
                <div className="flex flex-wrap gap-3">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleApprove}
                    disabled={actioning || !allOk}
                    className="flex-1 min-w-[120px] py-2.5 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {actioning ? '...' : 'Одобрить'}
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleRequestCorrection}
                    disabled={actioning || !hasNeedsCorrection}
                    className="flex-1 min-w-[160px] py-2.5 rounded-xl bg-amber-500 text-white font-semibold hover:bg-amber-600 disabled:opacity-50"
                  >
                    Отправить на доработку
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleReject}
                    disabled={actioning}
                    className="flex-1 min-w-[100px] py-2.5 rounded-xl bg-red-100 text-red-700 font-semibold hover:bg-red-200 disabled:opacity-50"
                  >
                    Отклонить
                  </motion.button>
                </div>
                {!allOk && stepsArray.length === 10 && (
                  <p className={`text-xs ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>
                    Одобрить можно только когда все 10 шагов отмечены «Норм».
                  </p>
                )}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
}
