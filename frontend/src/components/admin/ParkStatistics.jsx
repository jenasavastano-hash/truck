import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Users, Car, Link as LinkIcon, Wallet, FileText, Calendar, UserPlus } from 'lucide-react';
import StatisticsDateModal from './StatisticsDateModal';
import { FEATURE_EVACUATOR_AND_COMMISSIONER } from '../../config/features';

export default function ParkStatistics({ stats, period = 'сегодня', onPeriodChange, parkId, periodParams = null }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showDateModal, setShowDateModal] = useState(false);

  if (!stats) {
    return (
      <div className="bg-white rounded-xl shadow-md border border-slate-200 p-4 sm:p-6 mb-6">
        <div className="text-center py-4">
          <p className="text-slate-500 mb-2 text-sm">Загрузка статистики...</p>
          <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-md border border-slate-200 mb-6 overflow-hidden">
      {stats.parkInactive && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 text-amber-800 text-sm font-medium">
          Парк неактивен — статистика не считается. Включите парк в настройках.
        </div>
      )}
      {/* Заголовок — период и выбор даты */}
      <div className="w-full flex items-center justify-between p-3 sm:p-4">
        <div className="flex items-center gap-3 flex-1">
          <span className="text-xl sm:text-2xl">📊</span>
          <div className="text-left flex-1">
            <h2 className="text-base sm:text-lg font-bold text-slate-800">Статистика</h2>
            <div className="flex items-center gap-2">
              <p className="text-xs text-slate-600">Период: {period}</p>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDateModal(true);
                }}
                className="p-1 text-teal-600 hover:bg-teal-50 rounded transition"
                title="Выбрать период"
              >
                <Calendar className="w-3 h-3" />
              </motion.button>
            </div>
          </div>
        </div>
      </div>

      {/* Сводка как в «Все парки»: суммы реал/бонусы, ЭПЛ с разбивкой, эвакуатор */}
      <div className="px-4 pb-4 border-b border-slate-200">
        <div
          className={`grid grid-cols-2 gap-3 sm:gap-4 ${FEATURE_EVACUATOR_AND_COMMISSIONER ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}
        >
          <div className="flex flex-col gap-1 p-4 rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100/80 border border-emerald-200">
            <p className="text-xs font-semibold text-emerald-800/90">Пополнения</p>
            <p className="text-lg font-bold text-slate-900 tabular-nums">
              {((stats.topupsReal || 0) + (stats.topupsUnreal || 0)).toLocaleString('ru-RU')} ₽
            </p>
            <p className="text-[10px] text-emerald-700/80">{(stats.topupsReal || 0).toLocaleString('ru-RU')} ₽ реал, {(stats.topupsUnreal || 0).toLocaleString('ru-RU')} ₽ бонусы</p>
          </div>
          <div className="flex flex-col gap-1 p-4 rounded-xl bg-gradient-to-br from-red-50 to-red-100/80 border border-red-200">
            <p className="text-xs font-semibold text-red-800/90">Траты</p>
            <p className="text-lg font-bold text-red-800 tabular-nums">{(stats.spent || 0).toLocaleString('ru-RU')} ₽</p>
            <p className="text-[10px] text-red-700/80">{(stats.spentReal || 0).toLocaleString('ru-RU')} ₽ реал, {(stats.spentUnreal || 0).toLocaleString('ru-RU')} ₽ бонусы</p>
          </div>
          <div className="flex flex-col gap-1 p-4 rounded-xl bg-gradient-to-br from-sky-50 to-teal-100/80 border border-teal-200">
            <p className="text-xs font-semibold text-teal-900/90">Путевые (ЭПЛ)</p>
            <p className="text-lg font-bold text-slate-900 tabular-nums">{stats.eplCount || 0} шт.</p>
            <p className="text-[10px] text-teal-800/80">{(stats.eplAmountReal || 0).toLocaleString('ru-RU')} ₽ реал, {(stats.eplAmountUnreal || 0).toLocaleString('ru-RU')} ₽ бонусы</p>
          </div>
          <div className="flex flex-col gap-1 p-4 rounded-xl bg-gradient-to-br from-amber-50 to-amber-100/80 border border-amber-200">
            <p className="text-xs font-semibold text-amber-800/90">Автозакрытия смен</p>
            <p className="text-lg font-bold text-slate-900 tabular-nums">{stats.autoClosedShiftsCount || 0} шт.</p>
            <p className="text-[10px] text-amber-700/80">на сумму {(stats.autoCloseAmount || 0).toLocaleString('ru-RU')} ₽</p>
          </div>
          {FEATURE_EVACUATOR_AND_COMMISSIONER && (
            <div className="flex flex-col gap-1 p-4 rounded-xl bg-gradient-to-br from-orange-50 to-orange-100/80 border border-orange-200">
              <p className="text-xs font-semibold text-orange-800/90">Эвакуатор</p>
              <p className="text-lg font-bold text-slate-900 tabular-nums">{stats.evacuatorRequestsCount || 0} заявок</p>
              <p className="text-[10px] text-orange-700/80">на сумму {(stats.evacuatorRequestsAmount || 0).toLocaleString('ru-RU')} ₽</p>
            </div>
          )}
        </div>
      </div>

      {/* Кнопка «Развернуть подробнее» */}
      <div className="px-4 py-3 flex justify-center">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 py-2 px-4 rounded-xl border-2 border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold text-sm transition"
        >
          <span>{isExpanded ? 'Свернуть детали' : 'Развернуть подробнее'}</span>
          <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown className="w-5 h-5" />
          </motion.div>
        </button>
      </div>

      {/* Детальная статистика - раскрывается */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
              {/* Финансы за период */}
              <div>
                <div className="flex items-center gap-2 mb-3 sm:mb-4">
                  <span className="text-lg sm:text-xl">💰</span>
                  <h3 className="text-base sm:text-lg font-bold text-slate-800">Финансы за период:</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div className="p-3 sm:p-4 bg-emerald-50 rounded-lg sm:rounded-xl border border-emerald-200">
                    <p className="text-xs sm:text-sm text-slate-600 mb-1">Пополнения реал:</p>
                    <p className="text-sm sm:text-base font-bold text-emerald-700">{(stats.topupsReal || 0).toLocaleString('ru-RU')} ₽</p>
                    <p className="text-[10px] sm:text-xs text-slate-500 mt-1">{stats.topupsRealCount || 0} операций</p>
                  </div>
                  <div className="p-3 sm:p-4 bg-teal-50 rounded-lg sm:rounded-xl border border-teal-200">
                    <p className="text-xs sm:text-sm text-slate-600 mb-1">Пополнения бонусы:</p>
                    <p className="text-sm sm:text-base font-bold text-teal-700">{(stats.topupsUnreal || 0).toLocaleString('ru-RU')} ₽</p>
                    <p className="text-[10px] sm:text-xs text-slate-500 mt-1">{stats.topupsUnrealCount || 0} операций</p>
                  </div>
                  <div className="p-3 sm:p-4 bg-red-50 rounded-lg sm:rounded-xl border border-red-200">
                    <p className="text-xs sm:text-sm text-slate-600 mb-1">Траты реал:</p>
                    <p className="text-sm sm:text-base font-bold text-red-600">{(stats.spentReal || 0).toLocaleString('ru-RU')} ₽</p>
                    <p className="text-[10px] sm:text-xs text-slate-500 mt-1">только реальные деньги</p>
                  </div>
                  <div className="p-3 sm:p-4 bg-orange-50 rounded-lg sm:rounded-xl border border-orange-200">
                    <p className="text-xs sm:text-sm text-slate-600 mb-1">Траты бонусы:</p>
                    <p className="text-sm sm:text-base font-bold text-orange-600">{(stats.spentUnreal || 0).toLocaleString('ru-RU')} ₽</p>
                    <p className="text-[10px] sm:text-xs text-slate-500 mt-1">только бонусные деньги</p>
                  </div>
                  <div className="p-3 sm:p-4 bg-slate-50 rounded-lg sm:rounded-xl border border-slate-200">
                    <p className="text-xs sm:text-sm text-slate-600 mb-1">Траты (всего):</p>
                    <p className="text-sm sm:text-base font-bold text-slate-800">{(stats.spent || 0).toLocaleString('ru-RU')} ₽</p>
                    <p className="text-[10px] sm:text-xs text-slate-500 mt-1">
                      ЭПЛ: {(stats.eplAmount || 0).toLocaleString('ru-RU')}₽ · Автозакр.: {(stats.autoCloseAmount || 0).toLocaleString('ru-RU')}₽ · ФК: {(stats.photoControlAmount || 0).toLocaleString('ru-RU')}₽ · Игра: {((stats.gameSpentReal || 0) + (stats.gameSpentUnreal || 0)).toLocaleString('ru-RU')}₽ (реал {(stats.gameSpentReal || 0).toLocaleString('ru-RU')}₽, бонусы {(stats.gameSpentUnreal || 0).toLocaleString('ru-RU')}₽) · Удвоение: {(stats.doubleCoinsSpent || 0).toLocaleString('ru-RU')}₽
                    </p>
                  </div>
                  <div className="p-3 sm:p-4 bg-slate-50 rounded-lg sm:rounded-xl border border-slate-200">
                    <p className="text-xs sm:text-sm text-slate-600 mb-1">Баланс водителей сейчас:</p>
                    <p className="text-sm sm:text-base font-bold text-slate-800">
                      {(stats.systemBalanceReal || 0).toLocaleString('ru-RU')} ₽ реал / {(stats.systemBalanceUnreal || 0).toLocaleString('ru-RU')} ₽ бонусы
                    </p>
                    <p className="text-[10px] sm:text-xs text-slate-500 mt-1">текущий остаток на счетах</p>
                  </div>
                  {stats.forecast && stats.forecast > 0 && (
                    <div className="p-3 sm:p-4 bg-slate-50 rounded-lg sm:rounded-xl border border-slate-200">
                      <p className="text-xs sm:text-sm text-slate-600 mb-1">Прогноз:</p>
                      <p className="text-sm sm:text-base font-bold text-teal-700">{stats.forecast} дн.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Операции за период */}
              <div>
                <div className="flex items-center gap-2 mb-3 sm:mb-4">
                  <span className="text-lg sm:text-xl">📄</span>
                  <h3 className="text-base sm:text-lg font-bold text-slate-800">Операции за период:</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div className="p-3 sm:p-4 bg-slate-50 rounded-lg sm:rounded-xl border border-slate-200">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-base sm:text-lg">📋</span>
                      <p className="text-xs sm:text-sm font-semibold text-slate-800">ЭПЛ (создано / списано):</p>
                    </div>
                    <p className="text-sm sm:text-base font-bold text-slate-800">
                      {stats.eplCount || 0} шт. — {(stats.eplAmount || 0).toLocaleString('ru-RU')} ₽
                    </p>
                    <p className="text-[10px] sm:text-xs text-slate-500 mt-1">
                      Реал: {(stats.eplAmountReal || 0).toLocaleString('ru-RU')} ₽ / Бонусы: {(stats.eplAmountUnreal || 0).toLocaleString('ru-RU')} ₽
                    </p>
                  </div>
                  <div className="p-3 sm:p-4 bg-slate-50 rounded-lg sm:rounded-xl border border-slate-200">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-base sm:text-lg">✅</span>
                      <p className="text-xs sm:text-sm font-semibold text-slate-800">Закрытия смен (всего):</p>
                    </div>
                    <p className="text-sm sm:text-base font-bold text-slate-800">
                      {stats.closedShiftsCount || 0} шт.
                    </p>
                    <p className="text-[10px] sm:text-xs text-slate-500 mt-1">
                      вручную: {(stats.closedShiftsCount || 0) - (stats.autoClosedShiftsCount || 0)} · авто: {stats.autoClosedShiftsCount || 0}
                    </p>
                  </div>
                  <div className="p-3 sm:p-4 bg-slate-50 rounded-lg sm:rounded-xl border border-slate-200">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-base sm:text-lg">🔒</span>
                      <p className="text-xs sm:text-sm font-semibold text-slate-800">Автозакрытия (списания):</p>
                    </div>
                    <p className="text-sm sm:text-base font-bold text-slate-800">
                      {stats.autoClosedShiftsCount || 0} шт. — {(stats.autoCloseAmount || 0).toLocaleString('ru-RU')} ₽
                    </p>
                    <p className="text-[10px] sm:text-xs text-slate-500 mt-1">
                      Реал: {(stats.autoCloseReal || 0).toLocaleString('ru-RU')} ₽ / Бонусы: {(stats.autoCloseUnreal || 0).toLocaleString('ru-RU')} ₽
                    </p>
                  </div>
                  <div className="p-3 sm:p-4 bg-slate-50 rounded-lg sm:rounded-xl border border-slate-200">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-base sm:text-lg">📷</span>
                      <p className="text-xs sm:text-sm font-semibold text-slate-800">Фотоконтроль:</p>
                    </div>
                    <p className="text-sm sm:text-base font-bold text-slate-800">
                      {stats.photoControlCount || 0} заявок — {(stats.photoControlAmount || 0).toLocaleString('ru-RU')}₽
                    </p>
                  </div>
                  <div className="p-3 sm:p-4 bg-slate-50 rounded-lg sm:rounded-xl border border-slate-200">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-base sm:text-lg">🎮</span>
                      <p className="text-xs sm:text-sm font-semibold text-slate-800">Игра (магазин):</p>
                    </div>
                    <p className="text-sm sm:text-base font-bold text-slate-800">
                      {(stats.gameSpent || 0).toLocaleString('ru-RU')}₽
                    </p>
                    <p className="text-[10px] sm:text-xs text-slate-500 mt-1">
                      Реал: {stats.gameSpentReal || 0}₽ / Бонусы: {stats.gameSpentUnreal || 0}₽
                    </p>
                    <div className="mt-2 pt-2 border-t border-slate-200">
                      <p className="text-[10px] font-semibold text-slate-600 mb-1">По бустам:</p>
                      <p className="text-[10px] text-slate-600">
                        Магнит: {(stats.gameSpentMagnet || 0).toLocaleString('ru-RU')}₽ · Нитро: {(stats.gameSpentNitro || 0).toLocaleString('ru-RU')}₽ · Прыжок: {(stats.gameSpentJump || 0).toLocaleString('ru-RU')}₽ · +1 жизнь: {(stats.gameSpentExtraLife || 0).toLocaleString('ru-RU')}₽
                      </p>
                    </div>
                    <div className="mt-2 pt-2 border-t border-slate-200">
                      <p className="text-[10px] font-semibold text-slate-600 mb-1">Удвоение после смерти:</p>
                      <p className="text-[10px] text-slate-600">
                        {(stats.doubleCoinsSpent || 0).toLocaleString('ru-RU')}₽ ({(Math.round((stats.doubleCoinsSpent || 0) / 10) || 0)} раз по 10 ₽)
                      </p>
                    </div>
                  </div>
                  <div className="p-3 sm:p-4 bg-slate-50 rounded-lg sm:rounded-xl border border-slate-200">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-base sm:text-lg">🆕</span>
                      <p className="text-xs sm:text-sm font-semibold text-slate-800">Новых водителей:</p>
                    </div>
                    <p className="text-sm sm:text-base font-bold text-slate-800">
                      {stats.newDriversCount || 0} | Связок: {stats.newBindingsCount || 0}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Модалка выбора даты */}
      <StatisticsDateModal
        isOpen={showDateModal}
        onClose={() => setShowDateModal(false)}
        onApply={(params) => {
          setShowDateModal(false);
          if (onPeriodChange) onPeriodChange(params);
        }}
        defaultPeriod={periodParams?.period || (period === 'сегодня' ? 'today' : period === 'вчера' ? 'yesterday' : period === 'с пятницы' ? 'since_friday' : 'date')}
        defaultDate={periodParams?.period === 'date' ? periodParams.date : null}
        defaultDateStart={periodParams?.period === 'range' ? periodParams.dateStart : null}
        defaultDateEnd={periodParams?.period === 'range' ? periodParams.dateEnd : null}
      />
    </div>
  );
}
