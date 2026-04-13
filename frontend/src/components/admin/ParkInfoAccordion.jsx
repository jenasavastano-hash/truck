import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Building2, MapPin, Phone, Calendar, Car, Users, Link2, Wallet } from 'lucide-react';

export default function ParkInfoAccordion({ park }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!park) return null;

  const carsCount = park.carsCount ?? 0;
  const driversCount = park.driversCount ?? 0;
  const bindingsCount = park.bindingsCount ?? 0;
  const spentReal = Number(park.spentReal) || 0;

  return (
    <div className="bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden mb-6">
      {/* Header — название, адрес, метрики-сводка */}
      <div className="p-3 sm:p-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="p-2 bg-teal-100 rounded-xl shrink-0">
            <Building2 className="w-6 h-6 text-teal-700" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-base sm:text-lg text-slate-800 mb-1 truncate">{park.name}</h3>
            {park.address && (
              <div className="flex items-start gap-1.5 text-xs sm:text-sm text-slate-600 min-w-0 mb-3">
                <MapPin className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="line-clamp-2">{park.address}</span>
              </div>
            )}
            {/* Краткие метрики в шапке */}
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium">
                <Car className="w-3.5 h-3.5" /> {carsCount} авто
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium">
                <Users className="w-3.5 h-3.5" /> {driversCount} водит.
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium">
                <Link2 className="w-3.5 h-3.5" /> {bindingsCount} связок
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-red-50 text-red-700 text-xs font-medium">
                <Wallet className="w-3.5 h-3.5" /> Траты реал за день: {spentReal.toLocaleString('ru-RU')} ₽
              </span>
            </div>
          </div>
        </div>

        {/* Кнопка открытия — выделенная, видимая */}
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border-2 border-teal-200 bg-teal-50 hover:bg-teal-100 text-teal-800 font-semibold text-sm transition"
        >
          <span>{isOpen ? 'Свернуть' : 'Подробнее'}</span>
          <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown className="w-5 h-5" />
          </motion.div>
        </button>
      </div>

      {/* Раскрытый контент: город, телефон, дата, Takskom ID */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="p-3 sm:p-4 border-t border-slate-200 bg-slate-50/80">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                {park.city && (
                  <div>
                    <p className="text-xs text-slate-600 mb-1">Город</p>
                    <p className="font-semibold text-slate-800">{park.city}</p>
                  </div>
                )}
                {park.phone && (
                  <div>
                    <p className="text-xs text-slate-600 mb-1">Телефон</p>
                    <div className="flex items-center gap-1.5">
                      <Phone className="w-4 h-4 text-slate-500" />
                      <p className="font-semibold text-slate-800">{park.phone}</p>
                    </div>
                  </div>
                )}
                {park.createdAt && (
                  <div>
                    <p className="text-xs text-slate-600 mb-1">Создан</p>
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-4 h-4 text-slate-500" />
                      <p className="font-semibold text-slate-800">
                        {new Date(park.createdAt).toLocaleDateString('ru-RU')}
                      </p>
                    </div>
                  </div>
                )}
                {park.takskornId && (
                  <div>
                    <p className="text-xs text-slate-600 mb-1">Takskom ID</p>
                    <p className="font-semibold text-emerald-600">{park.takskornId}</p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
