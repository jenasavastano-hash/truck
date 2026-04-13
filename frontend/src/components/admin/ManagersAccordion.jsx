import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Search } from 'lucide-react';
import ManagerCard from './ManagerCard';

export default function ManagersAccordion({ managers, onAddClick, onManagerClick }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  const filteredManagers = useMemo(() => {
    if (!searchQuery.trim()) return managers;
    const query = searchQuery.toLowerCase();
    return managers.filter(m => 
      (m.fullName || '').toLowerCase().includes(query) ||
      (m.username || '').toLowerCase().includes(query) ||
      (m.phone || '').includes(query)
    );
  }, [managers, searchQuery]);

  const paginatedManagers = filteredManagers.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );
  const totalPages = Math.ceil(filteredManagers.length / itemsPerPage);

  return (
    <div className="bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden mb-6">
      {/* Header + выделенная кнопка открытия */}
      <div className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-slate-800">Менеджеры</h3>
          <p className="text-xs text-slate-500 mt-0.5">{managers.length} человек</p>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center justify-center gap-2 py-2.5 px-5 rounded-xl border-2 border-teal-200 bg-teal-50 hover:bg-teal-100 text-teal-800 font-semibold text-sm transition shrink-0"
        >
          <span>{isOpen ? 'Свернуть' : 'Развернуть'}</span>
          <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown className="w-5 h-5" />
          </motion.div>
        </button>
      </div>

      {/* Content */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="p-4 border-t border-slate-200">
              {/* Search and Add Button */}
              <div className="flex gap-3 mb-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setCurrentPage(1);
                    }}
                    placeholder="Поиск менеджеров..."
                    className="w-full pl-10 pr-4 py-2 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                  />
                </div>
                {onAddClick && (
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={onAddClick}
                    className="px-4 py-2 bg-gradient-to-r from-teal-600 to-teal-800 text-white rounded-xl hover:from-teal-700 hover:to-teal-900 font-semibold transition shadow-md flex items-center gap-2"
                  >
                    ➕ Добавить менеджера
                  </motion.button>
                )}
              </div>

              {/* Managers List */}
              {filteredManagers.length === 0 ? (
                <div className="text-center py-8 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="text-4xl mb-2">👥</div>
                  <p className="text-slate-600 font-semibold">
                    {searchQuery ? 'Ничего не найдено' : 'Нет менеджеров'}
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                    {paginatedManagers.map((manager, idx) => (
                      <ManagerCard
                        key={manager.id}
                        manager={manager}
                        onClick={() => onManagerClick(manager)}
                        index={idx}
                      />
                    ))}
                  </div>
                  {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 mt-4">
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-1 border border-slate-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
                      >
                        ←
                      </motion.button>
                      <span className="text-sm text-slate-600">
                        Страница {currentPage} из {totalPages}
                      </span>
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="px-3 py-1 border border-slate-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
                      >
                        →
                      </motion.button>
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
