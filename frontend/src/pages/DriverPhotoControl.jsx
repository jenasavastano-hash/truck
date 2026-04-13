import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, Plus, CheckCircle2, Clock, XCircle, Car, ChevronRight, AlertCircle } from 'lucide-react';
import api from '../api';
import { useToast } from '../hooks/useToast';
import { formatDateMsk } from '../utils/dateFormatter';

const STATUS_LABELS = {
  draft: 'Черновик',
  filling: 'Заполняется',
  pending: 'На проверке',
  approved: 'Подтверждён',
  rejected: 'Отклонён'
};

export default function DriverPhotoControl() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [settings, setSettings] = useState(null);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    try {
      setLoading(true);
      const [settingsRes, listRes] = await Promise.all([
        api.get('/driver/photo-control/settings'),
        api.get('/driver/photo-control/list')
      ]);
      setSettings(settingsRes.data || {});
      setList(Array.isArray(listRes.data) ? listRes.data : []);
    } catch (e) {
      if (e.response?.status === 404 || e.response?.status === 403) {
        setSettings({ enabled: false });
      }
      setList([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    try {
      setCreating(true);
      const { data } = await api.post('/driver/photo-control');
      showToast('Заявка создана. Заполните все шаги.', 'success');
      navigate(`/driver/photo-control/${data.id}`);
    } catch (e) {
      showToast(e.response?.data?.error || 'Не удалось создать заявку', 'error');
    } finally {
      setCreating(false);
    }
  };

  const fillingOrDraft = list.find(a => a.status === 'filling' || a.status === 'draft');
  const activeApproved = list.find(a => a.status === 'approved' && a.validUntil && new Date(a.validUntil) > new Date());

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-600" />
      </div>
    );
  }

  if (!settings?.enabled) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 p-4">
        <div className="max-w-lg mx-auto pt-6">
          <button onClick={() => navigate('/driver')} className="flex items-center gap-2 text-slate-600 hover:text-slate-800 mb-6">
            <ArrowLeft className="w-5 h-5" /> Назад
          </button>
          <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6 text-center">
            <Camera className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-600">Фотоконтроль для вашего парка отключён.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-200/50 sticky top-0 z-20">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => navigate('/driver')} className="p-2 rounded-xl hover:bg-slate-100">
            <ArrowLeft className="w-5 h-5 text-slate-700" />
          </button>
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-sky-100 rounded-lg"><Camera className="w-5 h-5 text-sky-600" /></div>
            <h1 className="text-xl font-bold text-slate-800">Фотоконтроль</h1>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        <p className="text-slate-600 text-sm">
          Загрузите несколько фото и видео авто для заявки. Механик посмотрит, оценит и подтвердит ФК — не нужно ездить в парк и ждать.
        </p>

        {/* Статус как у ЭПЛ */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
        >
          <div className="bg-gradient-to-r from-sky-600 to-sky-700 text-white px-6 py-4">
            <h2 className="text-lg font-bold">Статус</h2>
          </div>
          <div className="p-6 space-y-4">
            {activeApproved && (
              <div className="flex items-center justify-between p-4 bg-emerald-50 rounded-xl border border-emerald-200">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                  <div>
                    <p className="font-semibold text-emerald-800">ФК действует</p>
                    <p className="text-sm text-emerald-700">до {new Date(activeApproved.validUntil).toLocaleDateString('ru-RU')}</p>
                  </div>
                </div>
              </div>
            )}
            {fillingOrDraft && (
              <div
                role="button"
                onClick={() => navigate(`/driver/photo-control/${fillingOrDraft.id}`)}
                className="flex items-center justify-between p-4 bg-amber-50 rounded-xl border border-amber-200 cursor-pointer hover:bg-amber-100"
              >
                <div className="flex items-center gap-3">
                  <Clock className="w-6 h-6 text-amber-600" />
                  <div>
                    <p className="font-semibold text-amber-800">Заявка заполняется</p>
                    <p className="text-sm text-amber-700">Нажмите, чтобы добавить фото и видео</p>
                  </div>
                </div>
              </div>
            )}
            {!activeApproved && !fillingOrDraft && (
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div className="flex items-center gap-3">
                  <Car className="w-6 h-6 text-slate-500" />
                  <p className="font-medium text-slate-700">Нет активного ФК</p>
                </div>
              </div>
            )}
          </div>
        </motion.div>

        {/* Кнопка создать */}
        {!fillingOrDraft && (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleCreate}
            disabled={creating}
            className="w-full py-4 px-6 rounded-2xl font-semibold bg-gradient-to-r from-sky-500 to-sky-600 text-white hover:from-sky-600 hover:to-sky-700 shadow-lg disabled:opacity-70 flex items-center justify-center gap-2"
          >
            <Plus className="w-5 h-5" />
            {creating ? 'Создание...' : `Создать заявку (${settings?.price ?? 150} ₽)`}
          </motion.button>
        )}

        {/* Прошлые заявки */}
        {list.filter(a => a.status !== 'filling' && a.status !== 'draft').length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-3 border-b border-slate-100">
              <h2 className="font-bold text-slate-800">Прошлые заявки</h2>
            </div>
            <ul className="divide-y divide-slate-100">
              {list.filter(a => a.status !== 'filling' && a.status !== 'draft').slice(0, 5).map((app) => (
                <li key={app.id}>
                  <button
                    onClick={() => navigate(`/driver/photo-control/${app.id}`)}
                    className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-slate-50 transition"
                  >
                    <div className="flex items-center gap-3">
                      {app.status === 'approved' && <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />}
                      {app.status === 'rejected' && <XCircle className="w-5 h-5 text-red-500 shrink-0" />}
                      {app.status === 'pending' && app.correctionRequestedAt && <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />}
                      {app.status === 'pending' && !app.correctionRequestedAt && <Clock className="w-5 h-5 text-amber-500 shrink-0" />}
                      <div>
                        <p className="font-medium text-slate-800">{app.regNumber || 'Заявка'} — {app.status === 'pending' && app.correctionRequestedAt ? 'На доработке' : (STATUS_LABELS[app.status] || app.status)}</p>
                        <p className="text-xs text-slate-500">{formatDateMsk(app.createdAt)}</p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-400 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
