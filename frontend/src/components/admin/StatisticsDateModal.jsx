import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Calendar, X } from 'lucide-react';
import Modal from '../ui/Modal';

const todayStr = () => new Date().toISOString().split('T')[0];

export default function StatisticsDateModal({
  isOpen,
  onClose,
  onApply,
  defaultPeriod = 'today',
  defaultDate = null,
  defaultDateStart = null,
  defaultDateEnd = null
}) {
  const [periodType, setPeriodType] = useState(defaultPeriod);
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);

  useEffect(() => {
    if (isOpen) {
      setPeriodType(defaultPeriod);
      setSelectedDate(defaultDate || todayStr());
      setStartDate(defaultDateStart || todayStr());
      setEndDate(defaultDateEnd || todayStr());
    }
  }, [isOpen, defaultPeriod, defaultDate, defaultDateStart, defaultDateEnd]);

  const handleApply = () => {
    let period = 'today';
    let date = null;
    let dateStart = null;
    let dateEnd = null;

    if (periodType === 'today') period = 'today';
    else if (periodType === 'yesterday') period = 'yesterday';
    else if (periodType === 'since_friday') period = 'since_friday';
    else if (periodType === 'date') {
      period = 'date';
      date = selectedDate;
    } else if (periodType === 'range') {
      period = 'range';
      dateStart = startDate;
      dateEnd = endDate;
    }

    if (onApply) onApply({ period, date, dateStart, dateEnd });
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Выбор периода"
      size="sm"
    >
      <div className="space-y-4">
        {/* Тип периода */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">Период</label>
          <div className="grid grid-cols-3 gap-2">
            <motion.button type="button" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              onClick={() => setPeriodType('today')}
              className={`px-3 py-2 rounded-lg text-sm font-semibold transition ${periodType === 'today' ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >Сегодня</motion.button>
            <motion.button type="button" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              onClick={() => setPeriodType('yesterday')}
              className={`px-3 py-2 rounded-lg text-sm font-semibold transition ${periodType === 'yesterday' ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >Вчера</motion.button>
            <motion.button type="button" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              onClick={() => setPeriodType('since_friday')}
              className={`px-3 py-2 rounded-lg text-sm font-semibold transition ${periodType === 'since_friday' ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >С пятницы</motion.button>
            <motion.button type="button" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              onClick={() => setPeriodType('date')}
              className={`px-3 py-2 rounded-lg text-sm font-semibold transition ${periodType === 'date' ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >Дата</motion.button>
            <motion.button type="button" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              onClick={() => setPeriodType('range')}
              className={`col-span-2 px-3 py-2 rounded-lg text-sm font-semibold transition ${periodType === 'range' ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >Период (от — до)</motion.button>
          </div>
        </div>

        {/* Выбор даты */}
        {periodType === 'date' && (
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Выберите дату</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
            />
          </div>
        )}

        {/* Выбор периода */}
        {periodType === 'range' && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">С даты</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                max={endDate}
                className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">По дату</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate}
                className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
              />
            </div>
          </div>
        )}

        {/* Кнопки */}
        <div className="flex gap-3 pt-4 border-t border-slate-200">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onClose}
            className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 font-semibold transition"
          >
            Отмена
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleApply}
            className="flex-1 px-4 py-3 bg-gradient-to-r from-teal-600 to-teal-800 text-white rounded-xl hover:from-teal-700 hover:to-teal-900 font-semibold transition shadow-md flex items-center justify-center gap-2"
          >
            <Calendar className="w-4 h-4" />
            Применить
          </motion.button>
        </div>
      </div>
    </Modal>
  );
}
