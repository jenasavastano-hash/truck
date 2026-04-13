import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Search } from 'lucide-react';
import DriverCard from './DriverCard';
import { operationsShell, operationsInset } from '../../utils/operationsUi';

function SubList({ drivers, label, count, onDriverClick, onBalanceClick, onBindCar, sceneNight = false }) {
  const [isOpen, setIsOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  const filtered = useMemo(() => {
    if (!Array.isArray(drivers)) return [];
    if (!searchQuery.trim()) return drivers;
    const q = searchQuery.toLowerCase();
    return drivers.filter(
      (d) =>
        d &&
        ((d.fullName || '').toLowerCase().includes(q) ||
          (d.phone || '').includes(q) ||
          (d.regNumber || '').toLowerCase().includes(q))
    );
  }, [drivers, searchQuery]);

  const paginated = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.ceil(filtered.length / itemsPerPage);

  const shell = operationsInset(sceneNight);
  const btnHover = sceneNight ? 'hover:bg-slate-800/55' : 'hover:bg-white/22';
  const labelCls = sceneNight ? 'text-slate-200' : 'text-slate-700';
  const chevCls = sceneNight ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className={`rounded-xl overflow-hidden ${shell}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center gap-2 p-3 transition text-left ${btnHover}`}
      >
        <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className={`w-4 h-4 ${chevCls}`} />
        </motion.div>
        <span className={`text-sm font-semibold ${labelCls}`}>{label}</span>
        <span className={`text-xs ml-auto ${sceneNight ? 'text-slate-500' : 'text-slate-400'}`}>{count}</span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className={`px-3 pb-3 space-y-3 ${sceneNight ? 'border-t border-white/[0.08]' : 'border-t border-white/30'}`}>
              <div className="relative pt-3">
                <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${sceneNight ? 'text-slate-500' : 'text-slate-400'}`} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Поиск..."
                  className={`w-full pl-9 pr-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/40 transition ${
                    sceneNight
                      ? 'border border-white/[0.1] bg-slate-950/40 text-slate-100 placeholder:text-slate-500'
                      : 'border border-white/50 bg-white/45 text-slate-900 placeholder:text-slate-500 focus:border-teal-500/80'
                  }`}
                />
              </div>

              {filtered.length === 0 ? (
                <div className={`text-center py-6 text-sm ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>
                  {searchQuery ? 'Ничего не найдено' : 'Нет водителей'}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {paginated.map((d, idx) => (
                      <DriverCard
                        key={d.userId || d.id}
                        driver={{ ...d, regNumber: d.regNumber || null, carId: d.carId || null }}
                        night={sceneNight}
                        onClick={() => onDriverClick && onDriverClick(d)}
                        onBalanceClick={onBalanceClick ? () => onBalanceClick(d) : undefined}
                        onBindCar={onBindCar ? () => onBindCar(d) : undefined}
                        index={idx}
                      />
                    ))}
                  </div>
                  {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 pt-2">
                      <button
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className={`px-3 py-1 text-sm rounded-lg disabled:opacity-40 ${
                          sceneNight
                            ? 'border border-white/15 bg-slate-900/50 text-slate-200 hover:bg-slate-800'
                            : 'border border-white/50 bg-white/40 text-slate-800 hover:bg-white/55'
                        }`}
                      >
                        ←
                      </button>
                      <span className={`text-xs ${sceneNight ? 'text-slate-400' : 'text-slate-500'}`}>
                        {currentPage} / {totalPages}
                      </span>
                      <button
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className={`px-3 py-1 text-sm rounded-lg disabled:opacity-40 ${
                          sceneNight
                            ? 'border border-white/15 bg-slate-900/50 text-slate-200 hover:bg-slate-800'
                            : 'border border-white/50 bg-white/40 text-slate-800 hover:bg-white/55'
                        }`}
                      >
                        →
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function DriversAccordion({
  drivers = [],
  driversOnLine,
  driversWithoutCar,
  title = 'Водители',
  subtitle,
  onAddClick,
  onDriverClick,
  onBalanceClick,
  onBindCar,
  sceneNight = false,
}) {
  const [isOpen, setIsOpen] = useState(false);

  const onLine = driversOnLine || drivers.filter((d) => d.carId || d.regNumber);
  const noCar = driversWithoutCar || drivers.filter((d) => !d.carId && !d.regNumber);

  const titleCls = sceneNight ? 'text-slate-50' : 'text-slate-800';
  const subCls = sceneNight ? 'text-slate-400' : 'text-slate-500';
  const expandBtn = sceneNight
    ? isOpen
      ? 'bg-teal-600/40 text-white border border-teal-400/30'
      : 'border border-white/12 bg-white/[0.08] text-slate-200 hover:bg-white/[0.12]'
    : isOpen
      ? 'bg-gradient-to-r from-emerald-600 to-emerald-700 text-white border border-emerald-500/35 shadow-md backdrop-blur-sm'
      : 'border border-white/55 bg-white/38 text-slate-800 hover:bg-white/48 backdrop-blur-md ring-1 ring-slate-900/[0.05]';

  return (
    <div className={`rounded-xl overflow-hidden mb-6 shadow-md ${operationsShell(sceneNight)}`}>
      <div className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-col items-start min-w-0">
          <h3 className={`text-base sm:text-lg font-bold truncate max-w-full ${titleCls}`}>{title}</h3>
          {subtitle && <p className={`text-xs mt-0.5 ${subCls}`}>{subtitle}</p>}
          {!subtitle && <p className={`text-xs mt-0.5 ${subCls}`}>{drivers.length} водителей</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onAddClick && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onAddClick}
              className="px-3 py-2 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white rounded-xl hover:from-emerald-700 hover:to-emerald-800 font-semibold text-sm transition shadow-md flex items-center gap-1.5"
            >
              <span className="text-base leading-none">+</span>
              <span className="hidden sm:inline">Добавить водителя</span>
            </motion.button>
          )}
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className={`flex items-center justify-center gap-2 py-2.5 px-5 rounded-xl border text-sm font-semibold transition ${expandBtn}`}
          >
            <span>{isOpen ? 'Свернуть' : 'Развернуть'}</span>
            <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronDown className="w-5 h-5" />
            </motion.div>
          </button>
        </div>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className={`p-3 sm:p-4 space-y-4 ${sceneNight ? 'border-t border-white/[0.08]' : 'border-t border-white/30'}`}>
              <SubList
                drivers={onLine}
                label="На линии"
                count={onLine.length}
                onDriverClick={onDriverClick}
                onBalanceClick={onBalanceClick}
                onBindCar={onBindCar}
                sceneNight={sceneNight}
              />
              <SubList
                drivers={noCar}
                label="Без авто"
                count={noCar.length}
                onDriverClick={onDriverClick}
                onBalanceClick={onBalanceClick}
                onBindCar={onBindCar}
                sceneNight={sceneNight}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
