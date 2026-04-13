import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar,
  Truck,
  Users,
  Link2,
  Wallet,
  TrendingDown,
  FileText,
  Timer,
} from 'lucide-react';
import api from '../api';
import { useToast } from '../hooks/useToast';
import ParkCard from './admin/ParkCard';
import ParkSettingsModal from './admin/ParkSettingsModal';
import Modal from './ui/Modal';
import StatisticsDateModal from './admin/StatisticsDateModal';
import { FEATURE_EVACUATOR_AND_COMMISSIONER } from '../config/features';

const STAT_ACCENTS = {
  sky: {
    border: 'border-l-sky-600',
    iconDay: 'bg-sky-50 text-sky-700',
    iconNight: 'bg-sky-950/50 text-sky-300',
  },
  teal: {
    border: 'border-l-teal-600',
    iconDay: 'bg-teal-50 text-teal-700',
    iconNight: 'bg-teal-950/45 text-teal-300',
  },
  slate: {
    border: 'border-l-slate-500',
    iconDay: 'bg-slate-100 text-slate-700',
    iconNight: 'bg-slate-800 text-slate-300',
  },
  emerald: {
    border: 'border-l-emerald-600',
    iconDay: 'bg-emerald-50 text-emerald-700',
    iconNight: 'bg-emerald-950/45 text-emerald-300',
  },
  rose: {
    border: 'border-l-rose-600',
    iconDay: 'bg-rose-50 text-rose-700',
    iconNight: 'bg-rose-950/40 text-rose-300',
  },
  blue: {
    border: 'border-l-blue-600',
    iconDay: 'bg-blue-50 text-blue-700',
    iconNight: 'bg-blue-950/45 text-blue-300',
  },
  amber: {
    border: 'border-l-amber-600',
    iconDay: 'bg-amber-50 text-amber-800',
    iconNight: 'bg-amber-950/40 text-amber-200',
  },
  orange: {
    border: 'border-l-orange-600',
    iconDay: 'bg-orange-50 text-orange-800',
    iconNight: 'bg-orange-950/40 text-orange-200',
  },
};

function StatTile({ icon: Icon, label, value, sub, accent, night }) {
  const a = STAT_ACCENTS[accent] || STAT_ACCENTS.slate;
  const surface = night
    ? 'border-white/[0.10] bg-slate-900/50 shadow-black/25 ring-1 ring-inset ring-white/[0.05]'
    : 'border-white/70 bg-white/55 shadow-sm ring-1 ring-slate-900/[0.04] backdrop-blur-xl backdrop-saturate-150';
  const iconWrap = night ? a.iconNight : a.iconDay;
  return (
    <div
      className={`relative flex gap-3 rounded-xl border p-4 pl-3 backdrop-blur-sm transition hover:shadow-md ${surface} border-l-4 ${a.border}`}
    >
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconWrap}`}>
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-[11px] font-semibold uppercase tracking-wide ${night ? 'text-slate-400' : 'text-slate-500'}`}>
          {label}
        </p>
        <p className={`text-lg font-semibold tabular-nums tracking-tight ${night ? 'text-slate-50' : 'text-slate-900'}`}>
          {value}
        </p>
        {sub && (
          <p className={`mt-0.5 text-[10px] leading-snug ${night ? 'text-slate-400' : 'text-slate-500'}`}>{sub}</p>
        )}
      </div>
    </div>
  );
}

/**
 * Админ-панель: общая стата + гармошка с парками.
 * При входе — стата по всем паркам, стрелки переключения на стату парка.
 */
export default function AdminParksList({ onSelectPark, night = false }) {
  const { showToast } = useToast();
  const [parks, setParks] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [selectedParkForSettings, setSelectedParkForSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [parksAccordionOpen, setParksAccordionOpen] = useState(true);

  // Статистика
  const [statsMode, setStatsMode] = useState('all'); // 'all' | parkId
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsPeriod, setStatsPeriod] = useState({ period: 'today' });
  const [showDateModal, setShowDateModal] = useState(false);
  const [statsExpanded, setStatsExpanded] = useState(false);

  useEffect(() => {
    loadParks();
  }, []);

  useEffect(() => {
    loadStats();
  }, [statsMode, statsPeriod, parks.length]);

  const loadParks = async () => {
    try {
      const res = await api.get('/admin/parks');
      setParks(res.data || []);
    } catch (e) {
      console.error('Error loading parks:', e);
    }
  };

  const loadStats = async (periodOverride) => {
    const p = periodOverride || statsPeriod;
    setStatsLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('period', p.period || 'today');
      if (p.period === 'date' && p.date) params.append('date', p.date);
      if (p.period === 'range' && p.dateStart && p.dateEnd) {
        params.append('dateStart', p.dateStart);
        params.append('dateEnd', p.dateEnd);
      }
      const q = params.toString();
      if (statsMode === 'all') {
        const res = await api.get(`/admin/statistics/aggregate?${q}`);
        setStats(res.data || null);
      } else {
        const res = await api.get(`/admin/parks/${statsMode}/statistics?${q}`);
        setStats(res.data || null);
      }
    } catch (e) {
      console.error('Error loading stats:', e);
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  };

  const handlePeriodChange = (params) => {
    setStatsPeriod(params);
  };

  const cycleStatsMode = (dir) => {
    if (statsMode === 'all') {
      if (dir === 1 && parks.length > 0) setStatsMode(String(parks[0].id));
      else if (dir === -1 && parks.length > 0) setStatsMode(String(parks[parks.length - 1].id));
    } else {
      const idx = parks.findIndex(p => String(p.id) === statsMode);
      if (dir === 1) {
        if (idx < parks.length - 1) setStatsMode(String(parks[idx + 1].id));
        else setStatsMode('all');
      } else {
        if (idx > 0) setStatsMode(String(parks[idx - 1].id));
        else setStatsMode('all');
      }
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      showToast('Укажите название парка', 'warning');
      return;
    }
    setLoading(true);
    try {
      await api.post('/admin/parks', { name: name.trim() });
      showToast('Парк создан. Откройте «Настройки» парка и заполните реквизиты и данные для Такском.', 'success');
      setName('');
      setShowModal(false);
      await loadParks();
    } catch (error) {
      showToast(error.response?.data?.error || error.message || 'Ошибка', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (parkId) => {
    if (!window.confirm('Вы уверены? Удалится парк и все связанные данные!')) return;
    try {
      await api.delete(`/admin/parks/${parkId}`);
      showToast('Парк удалён', 'success');
      await loadParks();
      if (statsMode === String(parkId)) setStatsMode('all');
    } catch (e) {
      showToast(e.response?.data?.error || e.message || 'Ошибка', 'error');
    }
  };

  const statsLabel = statsMode === 'all' ? 'Все парки' : (parks.find(p => String(p.id) === statsMode)?.name || 'Парк');
  const periodLabelMap = { today: 'сегодня', yesterday: 'вчера', since_friday: 'с пятницы' };
  const periodLabel = periodLabelMap[statsPeriod.period] || (statsPeriod.period === 'date' ? statsPeriod.date : statsPeriod.period === 'range' ? `${statsPeriod.dateStart} — ${statsPeriod.dateEnd}` : statsPeriod.period || 'период');

  const totalCars = parks.reduce((sum, p) => sum + (p.carsCount || 0), 0);
  const totalDrivers = parks.reduce((sum, p) => sum + (p.driversCount || 0), 0);
  const totalBindings = parks.reduce((sum, p) => sum + (p.bindingsCount || 0), 0);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Блок статистики — всегда видимый */}
      <div
        className={`rounded-xl shadow-md border overflow-hidden backdrop-blur-sm ${
          night ? 'border-slate-600/55 bg-slate-900/82' : 'border-slate-200 bg-white'
        }`}
      >
        <div
          className={`p-3 sm:p-4 border-b ${
            night
              ? 'border-slate-600/50 bg-gradient-to-r from-slate-800/90 to-slate-800/60'
              : 'border-slate-200 bg-gradient-to-r from-slate-50 to-sky-50/35'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
              <span className="text-xl sm:text-2xl opacity-90" aria-hidden>
                📊
              </span>
              <div className="min-w-0 flex-1">
                <h2 className={`text-base sm:text-lg font-bold truncate ${night ? 'text-slate-100' : 'text-slate-800'}`}>
                  {statsLabel}
                </h2>
                <p className={`text-xs ${night ? 'text-slate-400' : 'text-slate-500'}`}>Период: {periodLabel}</p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {statsMode !== 'all' && (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onSelectPark(Number(statsMode))}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                    night
                      ? 'bg-indigo-950/60 text-indigo-200 hover:bg-indigo-950/90'
                      : 'bg-indigo-100 hover:bg-indigo-200 text-indigo-700'
                  }`}
                  title="Открыть парк"
                >
                  В парк
                </motion.button>
              )}
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => cycleStatsMode(-1)}
                className={`p-2 rounded-lg transition ${
                  night ? 'bg-slate-800 text-slate-200 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
                title="Предыдущий парк"
              >
                <ChevronLeft className="w-5 h-5" />
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => cycleStatsMode(1)}
                className={`p-2 rounded-lg transition ${
                  night ? 'bg-slate-800 text-slate-200 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
                title="Следующий парк"
              >
                <ChevronRight className="w-5 h-5" />
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowDateModal(true)}
                className={`p-2 rounded-lg transition ${
                  night ? 'bg-sky-950/50 text-sky-200 hover:bg-sky-950/80' : 'bg-blue-100 hover:bg-blue-200 text-blue-700'
                }`}
                title="Выбрать период"
              >
                <Calendar className="w-5 h-5" />
              </motion.button>
            </div>
          </div>
        </div>
        {statsLoading ? (
          <div className="p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className={`mt-2 text-sm ${night ? 'text-slate-400' : 'text-slate-500'}`}>Загрузка...</p>
          </div>
        ) : stats ? (
          <div className="p-4 sm:p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              <StatTile
                icon={Truck}
                accent="sky"
                night={night}
                label="Авто (все парки)"
                value={totalCars.toLocaleString('ru-RU')}
              />
              <StatTile
                icon={Users}
                accent="teal"
                night={night}
                label="Водители (все парки)"
                value={totalDrivers.toLocaleString('ru-RU')}
              />
              <StatTile
                icon={Link2}
                accent="slate"
                night={night}
                label="Привязки водитель ↔ авто"
                value={totalBindings.toLocaleString('ru-RU')}
              />
            </div>

            <div
              className={`grid grid-cols-2 gap-3 sm:gap-4 ${FEATURE_EVACUATOR_AND_COMMISSIONER ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}
            >
              <StatTile
                icon={Wallet}
                accent="emerald"
                night={night}
                label="Пополнения"
                value={`${((stats.topupsReal || 0) + (stats.topupsUnreal || 0)).toLocaleString('ru-RU')} ₽`}
                sub={`${(stats.topupsReal || 0).toLocaleString('ru-RU')} ₽ реал · ${(stats.topupsUnreal || 0).toLocaleString('ru-RU')} ₽ бонусы`}
              />
              <StatTile
                icon={TrendingDown}
                accent="rose"
                night={night}
                label="Траты"
                value={`${Math.abs(stats.spent || 0).toLocaleString('ru-RU')} ₽`}
                sub={`${(stats.spentReal || 0).toLocaleString('ru-RU')} ₽ реал · ${(stats.spentUnreal || 0).toLocaleString('ru-RU')} ₽ бонусы`}
              />
              <StatTile
                icon={FileText}
                accent="blue"
                night={night}
                label="Путевые (ЭПЛ)"
                value={`${stats.eplCount || 0} шт.`}
                sub={`${(stats.eplAmountReal || 0).toLocaleString('ru-RU')} ₽ реал · ${(stats.eplAmountUnreal || 0).toLocaleString('ru-RU')} ₽ бонусы`}
              />
              <StatTile
                icon={Timer}
                accent="amber"
                night={night}
                label="Автозакрытия смен"
                value={`${stats.autoClosedShiftsCount || 0} шт.`}
                sub={`на сумму ${(stats.autoCloseAmount || 0).toLocaleString('ru-RU')} ₽`}
              />
              {FEATURE_EVACUATOR_AND_COMMISSIONER && (
                <StatTile
                  icon={Truck}
                  accent="orange"
                  night={night}
                  label="Эвакуатор"
                  value={`${stats.evacuatorRequestsCount || 0} заявок`}
                  sub={`на сумму ${(stats.evacuatorRequestsAmount || 0).toLocaleString('ru-RU')} ₽`}
                />
              )}
            </div>

            {/* Кнопка «Подробнее» — развернуть детали */}
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setStatsExpanded(!statsExpanded)}
                className={`flex items-center gap-2 py-2 px-4 rounded-xl border-2 font-semibold text-sm transition ${
                  night
                    ? 'border-slate-600 bg-slate-800/80 text-slate-200 hover:bg-slate-800'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                }`}
              >
                <span>{statsExpanded ? 'Свернуть детали' : 'Развернуть подробнее'}</span>
                <motion.div animate={{ rotate: statsExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                  <ChevronDown className="w-5 h-5" />
                </motion.div>
              </button>
            </div>

            <AnimatePresence>
              {statsExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <div className={`pt-4 space-y-4 border-t ${night ? 'border-slate-600/50' : 'border-slate-200'}`}>
                    <p className={`text-sm font-semibold ${night ? 'text-slate-200' : 'text-slate-700'}`}>Детали по периоду</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <div
                        className={`p-3 rounded-lg border ${
                          night ? 'border-slate-600/60 bg-slate-800/50' : 'border-slate-200 bg-slate-50'
                        }`}
                      >
                        <p className={`mb-1 ${night ? 'text-slate-400' : 'text-slate-600'}`}>Пополнения</p>
                        <p className={`font-semibold ${night ? 'text-slate-100' : 'text-slate-800'}`}>
                          Реал: {(stats.topupsReal || 0).toLocaleString('ru-RU')} ₽ (операций: {stats.topupsRealCount || 0}) · Бонусы:{' '}
                          {(stats.topupsUnreal || 0).toLocaleString('ru-RU')} ₽ (операций: {stats.topupsUnrealCount || 0})
                        </p>
                      </div>
                      <div
                        className={`p-3 rounded-lg border ${
                          night ? 'border-slate-600/60 bg-slate-800/50' : 'border-slate-200 bg-slate-50'
                        }`}
                      >
                        <p className={`mb-1 ${night ? 'text-slate-400' : 'text-slate-600'}`}>Траты</p>
                        <p className={`font-semibold ${night ? 'text-slate-100' : 'text-slate-800'}`}>
                          Реал: {(stats.spentReal || 0).toLocaleString('ru-RU')} ₽ · Бонусы: {(stats.spentUnreal || 0).toLocaleString('ru-RU')} ₽
                        </p>
                      </div>
                      <div
                        className={`p-3 rounded-lg border ${
                          night ? 'border-slate-600/60 bg-slate-800/50' : 'border-slate-200 bg-slate-50'
                        }`}
                      >
                        <p className={`mb-1 ${night ? 'text-slate-400' : 'text-slate-600'}`}>ЭПЛ (путевые)</p>
                        <p className={`font-semibold ${night ? 'text-slate-100' : 'text-slate-800'}`}>
                          {stats.eplCount || 0} шт. · реал: {(stats.eplAmountReal || 0).toLocaleString('ru-RU')} ₽ · бонусы:{' '}
                          {(stats.eplAmountUnreal || 0).toLocaleString('ru-RU')} ₽
                        </p>
                      </div>
                      <div
                        className={`p-3 rounded-lg border ${
                          night ? 'border-slate-600/60 bg-slate-800/50' : 'border-slate-200 bg-slate-50'
                        }`}
                      >
                        <p className={`mb-1 ${night ? 'text-slate-400' : 'text-slate-600'}`}>Автозакрытия</p>
                        <p className={`font-semibold ${night ? 'text-slate-100' : 'text-slate-800'}`}>
                          Реал: {(stats.autoCloseReal || 0).toLocaleString('ru-RU')} ₽ · бонусы: {(stats.autoCloseUnreal || 0).toLocaleString('ru-RU')} ₽
                        </p>
                      </div>
                      {(stats.systemBalanceReal != null || stats.systemBalanceUnreal != null) && (
                        <div
                          className={`p-3 rounded-lg border sm:col-span-2 ${
                            night ? 'border-slate-600/60 bg-slate-800/50' : 'border-slate-200 bg-slate-50'
                          }`}
                        >
                          <p className={`mb-1 ${night ? 'text-slate-400' : 'text-slate-600'}`}>Баланс системы (у водителей)</p>
                          <p className={`font-semibold ${night ? 'text-slate-100' : 'text-slate-800'}`}>
                            Реал: {(stats.systemBalanceReal || 0).toLocaleString('ru-RU')} ₽ · Бонусы: {(stats.systemBalanceUnreal || 0).toLocaleString('ru-RU')} ₽
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <div className={`p-6 text-center text-sm ${night ? 'text-slate-400' : 'text-slate-500'}`}>Нет данных</div>
        )}
      </div>

      {/* Гармошка: Автопарки — выделенная кнопка открытия */}
      <div
        className={`rounded-xl shadow-md border overflow-hidden backdrop-blur-sm ${
          night ? 'border-slate-600/55 bg-slate-900/82' : 'border-slate-200 bg-white'
        }`}
      >
        <div className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${night ? 'bg-indigo-950/60' : 'bg-indigo-100'}`}>
              <Building2 className={`w-5 h-5 ${night ? 'text-indigo-300' : 'text-indigo-600'}`} />
            </div>
            <div>
              <h3 className={`text-lg font-bold ${night ? 'text-slate-100' : 'text-slate-800'}`}>Автопарки</h3>
              <p className={`text-xs ${night ? 'text-slate-400' : 'text-slate-500'}`}>{parks.length} парков</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setParksAccordionOpen(!parksAccordionOpen)}
            className={`flex items-center justify-center gap-2 py-2.5 px-5 rounded-xl border-2 font-semibold text-sm transition shrink-0 ${
              night
                ? 'border-indigo-500/40 bg-indigo-950/40 text-indigo-200 hover:bg-indigo-950/60'
                : 'border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700'
            }`}
          >
            <span>{parksAccordionOpen ? 'Свернуть' : 'Развернуть'}</span>
            <motion.div animate={{ rotate: parksAccordionOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronDown className="w-5 h-5" />
            </motion.div>
          </button>
        </div>
        <AnimatePresence>
          {parksAccordionOpen && (
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              exit={{ height: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              <div className={`p-4 pt-0 border-t ${night ? 'border-slate-600/50' : 'border-slate-200'}`}>
                <div className="flex justify-end mb-4">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => { setShowModal(true); setName(''); }}
                    className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 font-semibold shadow-md"
                  >
                    <Plus className="w-5 h-5" />
                    Создать парк
                  </motion.button>
                </div>
                {parks.length === 0 ? (
                  <div
                    className={`py-12 text-center border-2 border-dashed rounded-xl ${
                      night ? 'border-slate-600/60' : 'border-slate-200'
                    }`}
                  >
                    <div className="text-5xl mb-3">🏢</div>
                    <p className={`font-semibold mb-1 ${night ? 'text-slate-200' : 'text-slate-600'}`}>Парков пока нет</p>
                    <p className={`text-sm mb-4 ${night ? 'text-slate-400' : 'text-slate-500'}`}>
                      Создайте парк и заполните настройки для Такском
                    </p>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => { setShowModal(true); setName(''); }}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl font-semibold"
                    >
                      <Plus className="w-4 h-4" />
                      Создать парк
                    </motion.button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {parks.map((park, index) => (
                      <ParkCard
                        key={park.id}
                        night={night}
                        park={park}
                        onClick={() => onSelectPark(park.id)}
                        onSettings={() => {
                          setSelectedParkForSettings(park);
                          setShowSettingsModal(true);
                        }}
                        onDelete={() => handleDelete(park.id)}
                        index={index}
                      />
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Модалка: создать парк */}
      {showModal && (
        <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Создать парк" size="md">
          <p className="text-sm text-slate-600 mb-4">Укажите название. Реквизиты и данные для Такском можно ввести в настройках парка после сохранения.</p>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Название парка *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Например: Автопарк Логистика"
                className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                required
              />
            </div>
            <div className="flex gap-3 pt-4 border-t border-slate-200">
              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} type="button" onClick={() => setShowModal(false)} className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 font-semibold transition">
                Отмена
              </motion.button>
              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} type="submit" disabled={loading} className="flex-1 px-4 py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-xl hover:from-indigo-700 hover:to-indigo-800 font-semibold transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed">
                {loading ? 'Сохранение...' : 'Создать'}
              </motion.button>
            </div>
          </form>
        </Modal>
      )}

      {/* Модалка выбора периода */}
      <StatisticsDateModal
        isOpen={showDateModal}
        onClose={() => setShowDateModal(false)}
        onApply={handlePeriodChange}
        defaultPeriod={statsPeriod.period || 'today'}
        defaultDate={statsPeriod.period === 'date' ? statsPeriod.date : null}
        defaultDateStart={statsPeriod.period === 'range' ? statsPeriod.dateStart : null}
        defaultDateEnd={statsPeriod.period === 'range' ? statsPeriod.dateEnd : null}
      />

      {selectedParkForSettings && (
        <ParkSettingsModal
          park={selectedParkForSettings}
          isOpen={showSettingsModal}
          onClose={() => { setShowSettingsModal(false); setSelectedParkForSettings(null); }}
          onSave={loadParks}
        />
      )}
    </div>
  );
}
