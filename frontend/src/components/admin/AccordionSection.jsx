import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Search } from 'lucide-react';

export default function AccordionSection({ 
  title, 
  children, 
  defaultOpen = false,
  onAddClick,
  addButtonText = 'Добавить',
  searchPlaceholder = 'Поиск...',
  onSearch,
  itemsPerPage = 5,
  renderContent
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearch = (value) => {
    setSearchQuery(value);
    if (onSearch) onSearch(value);
  };

  return (
    <div className="bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden mb-6">
      {/* Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition"
      >
        <h3 className="text-lg font-bold text-slate-800">{title}</h3>
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown className="w-5 h-5 text-slate-600" />
        </motion.div>
      </button>

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
                    onChange={(e) => handleSearch(e.target.value)}
                    placeholder={searchPlaceholder}
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
                    ➕ {addButtonText}
                  </motion.button>
                )}
              </div>

              {/* Children Content */}
              {renderContent ? renderContent(searchQuery) : children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
