import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Calendar } from 'lucide-react';
import { getStatistics } from '../../api/managerApi';
import StatisticsDateModal from '../admin/StatisticsDateModal';
import EplTab from './EplTab';
import { operationsShell } from '../../utils/operationsUi';

function periodLabel(statsPeriod) {
  const p = statsPeriod?.period || 'today';
  if (p === 'today') return 'сегодня';
  if (p === 'yesterday') return 'вчера';
  if (p === 'since_friday') return 'с пятницы';
  if (p === 'date' && statsPeriod?.date) return statsPeriod.date;
  if (p === 'range' && statsPeriod?.dateStart && statsPeriod?.dateEnd) return `${statsPeriod.dateStart} — ${statsPeriod.dateEnd}`;
  if (p === 'week') return 'неделя';
  if (p === 'month') return 'месяц';
  return 'период';
}

const cardStyles = {
  green:  { wrap: 'from-emerald-50 to-emerald-100/80 border-emerald-200', label: 'text-emerald-800' },
  red:    { wrap: 'from-red-50 to-red-100/80 border-red-200',             label: 'text-red-800' },
  blue:   { wrap: 'from-teal-50 to-teal-100/80 border-teal-200',          label: 'text-teal-800' },
  amber:  { wrap: 'from-amber-50 to-amber-100/80 border-amber-200',       label: 'text-amber-800' },
  violet: { wrap: 'from-violet-50 to-violet-100/80 border-violet-200',    label: 'text-violet-800' },
  sky:    { wrap: 'from-sky-50 to-sky-100/80 border-sky-200',             label: 'text-sky-800' },
  indigo: { wrap: 'from-sky-50 to-sky-100/80 border-sky-200',    label: 'text-sky-800' },
};

const cardStylesNight = {
  green:  { wrap: 'from-emerald-950/50 to-emerald-900/30 border-emerald-400/20', label: 'text-emerald-200' },
  red:    { wrap: 'from-red-950/40 to-red-900/25 border-red-400/20',             label: 'text-red-200' },
  blue:   { wrap: 'from-teal-950/45 to-slate-900/40 border-teal-400/20',          label: 'text-teal-200' },
  amber:  { wrap: 'from-amber-950/40 to-amber-900/25 border-amber-400/20',       label: 'text-amber-200' },
  violet: { wrap: 'from-violet-950/40 to-violet-900/25 border-violet-400/20',    label: 'text-violet-200' },
  sky:    { wrap: 'from-sky-950/40 to-sky-900/25 border-sky-400/20',             label: 'text-sky-200' },
  indigo: { wrap: 'from-sky-950/40 to-sky-900/25 border-sky-400/20',    label: 'text-sky-200' },
};

function StatCard({ label, value, sub, color, sceneNight = false }) {
  const map = sceneNight ? cardStylesNight : cardStyles;
  const s = map[color] || map.blue;
  return (
    <div className={`flex flex-col gap-1 p-4 rounded-xl bg-gradient-to-br border backdrop-blur-md ${s.wrap}`}>
      <p className={`text-xs font-semibold ${s.label}`}>{label}</p>
      <p className={`text-lg font-bold tabular-nums ${sceneNight ? 'text-slate-50' : 'text-slate-900'}`}>{value}</p>
      {sub && <p className={`text-[10px] ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>{sub}</p>}
    </div>
  );
}

export default function StatsTab({ parkId, permissions = {}, eplPermissions = {}, sceneNight = false }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statsPeriod, setStatsPeriod] = useState({ period: 'today' });
  const [expanded, setExpanded] = useState(false);
  const [showDateModal, setShowDateModal] = useState(false);

  const { showFinance = true, showEpl = true, showDrivers = true } = permissions;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = statsPeriod.period || 'today';
      const extra = {};
      if (p === 'date' && statsPeriod.date) extra.date = statsPeriod.date;
      if (p === 'range' && statsPeriod.dateStart && statsPeriod.dateEnd) {
        extra.dateStart = statsPeriod.dateStart;
        extra.dateEnd = statsPeriod.dateEnd;
      }
      const data = await getStatistics(parkId, p, extra);
      setStats(data);
    } catch (e) {
      setError(e.response?.data?.error || 'Ошибка загрузки статистики');
    } finally {
      setLoading(false);
    }
  }, [parkId, statsPeriod]);

  useEffect(() => { load(); }, [load]);

  const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');

  const basic = stats?.basicStats || {};
  const finance = stats?.financeStats || {};
  const ops = stats?.operationsStats || {};
  const newStats = stats?.newStats || {};

  return (
    <div className="space-y-6">
      {/* Заголовок + выбор периода (как в админке) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full shadow-sm ${
            sceneNight
              ? 'border border-white/15 bg-white/[0.06] backdrop-blur-xl text-slate-100 ring-1 ring-white/10'
              : 'bg-white/75 backdrop-blur-md border border-white/60 shadow-slate-900/10'
          }`}
        >
          <span className="text-xl leading-none">📊</span>
          <h2 className={`text-sm sm:text-base font-bold tracking-wide uppercase ${sceneNight ? '' : 'text-slate-900'}`}>
            Статистика
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <p className={`text-xs ${sceneNight ? 'text-slate-400' : 'text-slate-600'}`}>Период: {periodLabel(statsPeriod)}</p>
          <button
            type="button"
            onClick={() => setShowDateModal(true)}
            className={`p-1.5 rounded-lg transition ${
              sceneNight ? 'text-teal-300 hover:bg-white/10' : 'text-teal-600 hover:bg-teal-50'
            }`}
            title="Выбрать период"
          >
            <Calendar className="w-4 h-4" />
          </button>
        </div>
      </div>

      <StatisticsDateModal
        isOpen={showDateModal}
        onClose={() => setShowDateModal(false)}
        onApply={(params) => {
          setShowDateModal(false);
          setStatsPeriod(params);
        }}
        defaultPeriod={statsPeriod.period || 'today'}
        defaultDate={statsPeriod.period === 'date' ? statsPeriod.date : null}
        defaultDateStart={statsPeriod.period === 'range' ? statsPeriod.dateStart : null}
        defaultDateEnd={statsPeriod.period === 'range' ? statsPeriod.dateEnd : null}
      />

      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
        </div>
      )}

      {error && (
        <div
          className={`rounded-xl p-4 text-sm border ${
            sceneNight ? 'border-red-400/30 bg-red-950/35 text-red-200' : 'bg-red-50 border border-red-200 text-red-700'
          }`}
        >
          {error}
        </div>
      )}

      {!loading && !error && stats && (
        <div className={`space-y-6 rounded-2xl p-4 sm:p-5 ${operationsShell(sceneNight)}`}>
          {/* Водители и авто */}
          {showDrivers && (
            <section>
              <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>
                Водители и авто
              </p>
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Водителей" value={`${fmt(basic.users)} чел.`} color="indigo" sceneNight={sceneNight} />
                <StatCard label="Автомобилей" value={`${fmt(basic.cars)} шт.`} color="sky" sceneNight={sceneNight} />
                <StatCard label="Привязок" value={`${fmt(basic.bindings)} шт.`} sub="водитель + авто" color="violet" sceneNight={sceneNight} />
                <StatCard label="Новых водителей" value={`${fmt(newStats.newDrivers)} чел.`} sub="за период" color="amber" sceneNight={sceneNight} />
              </div>
            </section>
          )}

          {/* Финансы */}
          {showFinance && (
            <section>
              <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>
                Финансы
              </p>
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  label="Пополнения (реал)"
                  value={`${fmt(finance.topupsReal)} ₽`}
                  sub={`${fmt(finance.topupsRealCount)} операций`}
                  color="green"
                  sceneNight={sceneNight}
                />
                <StatCard
                  label="Пополнения (бонусы)"
                  value={`${fmt(finance.topupsUnreal)} ₽`}
                  sub={`${fmt(finance.topupsUnrealCount)} операций`}
                  color="green"
                  sceneNight={sceneNight}
                />
                <StatCard
                  label="Траты (реал)"
                  value={`${fmt(finance.spentReal)} ₽`}
                  color="red"
                  sceneNight={sceneNight}
                />
                <StatCard
                  label="Траты (бонусы)"
                  value={`${fmt(finance.spentUnreal)} ₽`}
                  color="red"
                  sceneNight={sceneNight}
                />
              </div>
              <button
                onClick={() => setExpanded(!expanded)}
                className={`mt-3 w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-sm font-semibold transition border ${
                  sceneNight
                    ? 'border-white/12 bg-white/[0.06] text-slate-200 hover:bg-white/[0.1]'
                    : 'border-white/50 bg-white/40 hover:bg-white/60 text-slate-800 backdrop-blur-sm'
                }`}
              >
                <span>Балансы водителей</span>
                <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                  <ChevronDown className="w-4 h-4" />
                </motion.div>
              </button>
              <AnimatePresence>
                {expanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <StatCard label="Баланс реал (сумма)" value={`${fmt(finance.systemBalanceReal)} ₽`} color="blue" sceneNight={sceneNight} />
                      <StatCard label="Баланс бонусы (сумма)" value={`${fmt(finance.systemBalanceUnreal)} ₽`} color="violet" sceneNight={sceneNight} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          )}

          {/* ЭПЛ и смены */}
          {showEpl && (
            <section>
              <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>
                Путевые листы (ЭПЛ)
              </p>
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  label="ЭПЛ создано"
                  value={`${fmt(ops.eplCount)} шт.`}
                  sub={`${fmt(ops.eplAmountReal)} ₽ реал, ${fmt(ops.eplAmountUnreal)} ₽ бонусы`}
                  color="blue"
                  sceneNight={sceneNight}
                />
              </div>
            </section>
          )}

          {showEpl && (
            <section>
              <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>
                Смены
              </p>
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  label="Закрыто смен (всего)"
                  value={`${fmt(ops.closedShiftsCount)} шт.`}
                  sub={`вручную: ${fmt((ops.closedShiftsCount || 0) - (ops.autoClosedShiftsCount || 0))} · авто: ${fmt(ops.autoClosedShiftsCount)}`}
                  color="amber"
                  sceneNight={sceneNight}
                />
                <StatCard
                  label="Автозакрытия (списано)"
                  value={`${fmt(ops.autoCloseAmount)} ₽`}
                  sub={`реал: ${fmt(ops.autoCloseReal)} · бонусы: ${fmt(ops.autoCloseUnreal)}`}
                  color="amber"
                  sceneNight={sceneNight}
                />
              </div>
            </section>
          )}

          {showEpl && (ops.photoControlCount > 0 || ops.photoControlAmount > 0) && (
            <section>
              <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>
                Фотоконтроль
              </p>
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  label="Заявок ФК"
                  value={`${fmt(ops.photoControlCount)} шт.`}
                  color="sky"
                  sceneNight={sceneNight}
                />
                <StatCard
                  label="Списано за ФК"
                  value={`${fmt(ops.photoControlAmount)} ₽`}
                  color="sky"
                  sceneNight={sceneNight}
                />
              </div>
            </section>
          )}

          {/* Список ЭПЛ сразу под статой */}
          {showEpl && (
            <section className="pt-2">
              <EplTab permissions={eplPermissions} embedded sceneNight={sceneNight} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
