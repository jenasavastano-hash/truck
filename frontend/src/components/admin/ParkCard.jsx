import { motion } from 'framer-motion';
import { Building2, Car, Users, Link2, Wallet, Settings, Power } from 'lucide-react';
import Card from '../ui/Card';

export default function ParkCard({ park, onClick, onSettings, onDelete: _onDelete, index = 0, night = false }) {
  const isActive = park.isActive === 1 || park.isActive === true;
  const carsCount = park.carsCount ?? 0;
  const driversCount = park.driversCount ?? 0;
  const bindingsCount = park.bindingsCount ?? 0;
  const spentReal = Number(park.spentReal) || 0;

  const cellBase = night
    ? 'border border-white/[0.08] bg-white/[0.06] backdrop-blur-md'
    : 'border border-slate-200/80 bg-white/65 backdrop-blur-sm';
  const cellSpent = night
    ? 'border border-rose-400/25 bg-rose-500/[0.12] backdrop-blur-md'
    : 'border border-red-100 bg-red-50/90';

  return (
    <Card
      onClick={onClick}
      delay={index * 0.05}
      variant={night ? 'glassNight' : 'glassDay'}
      className={`p-5 transition-shadow ${
        night
          ? 'hover:border-teal-400/25 hover:shadow-[0_16px_48px_rgba(0,0,0,0.35)] hover:ring-teal-400/10'
          : 'hover:border-teal-200/90 hover:shadow-lg'
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div
            className={`p-2.5 rounded-xl shrink-0 ${
              night ? 'bg-teal-500/20 text-teal-200 ring-1 ring-teal-400/20' : 'bg-teal-100 text-teal-700'
            }`}
          >
            <Building2 className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className={`font-bold text-base sm:text-lg truncate ${night ? 'text-slate-50' : 'text-slate-800'}`}>
                {park.name}
              </h3>
              <span
                className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold flex items-center gap-1 ring-1 ${
                  isActive
                    ? night
                      ? 'bg-emerald-500/20 text-emerald-200 ring-emerald-400/25'
                      : 'bg-emerald-100 text-emerald-700'
                    : night
                      ? 'bg-slate-600/50 text-slate-300 ring-white/10'
                      : 'bg-slate-100 text-slate-600'
                }`}
              >
                <Power className={`w-3 h-3 ${isActive ? (night ? 'text-emerald-300' : 'text-emerald-600') : 'text-slate-500'}`} />
                {isActive ? 'Активен' : 'Неактивен'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className={`flex items-center gap-2 p-2.5 rounded-xl ${cellBase}`}>
          <Car className={`w-4 h-4 shrink-0 ${night ? 'text-slate-300' : 'text-slate-500'}`} />
          <div className="min-w-0">
            <p className={`text-xs font-medium ${night ? 'text-slate-400' : 'text-slate-500'}`}>Авто</p>
            <p className={`text-sm font-bold tabular-nums ${night ? 'text-slate-100' : 'text-slate-800'}`}>{carsCount}</p>
          </div>
        </div>
        <div className={`flex items-center gap-2 p-2.5 rounded-xl ${cellBase}`}>
          <Users className={`w-4 h-4 shrink-0 ${night ? 'text-slate-300' : 'text-slate-500'}`} />
          <div className="min-w-0">
            <p className={`text-xs font-medium ${night ? 'text-slate-400' : 'text-slate-500'}`}>Водители</p>
            <p className={`text-sm font-bold tabular-nums ${night ? 'text-slate-100' : 'text-slate-800'}`}>{driversCount}</p>
          </div>
        </div>
        <div className={`flex items-center gap-2 p-2.5 rounded-xl ${cellBase}`}>
          <Link2 className={`w-4 h-4 shrink-0 ${night ? 'text-slate-300' : 'text-slate-500'}`} />
          <div className="min-w-0">
            <p className={`text-xs font-medium ${night ? 'text-slate-400' : 'text-slate-500'}`}>Связки</p>
            <p className={`text-sm font-bold tabular-nums ${night ? 'text-slate-100' : 'text-slate-800'}`}>{bindingsCount}</p>
          </div>
        </div>
        <div className={`flex items-center gap-2 p-2.5 rounded-xl ${cellSpent}`}>
          <Wallet className={`w-4 h-4 shrink-0 ${night ? 'text-rose-200' : 'text-red-600'}`} />
          <div className="min-w-0">
            <p className={`text-xs font-medium ${night ? 'text-rose-200/80' : 'text-slate-500'}`}>Траты реал за день</p>
            <p className={`text-sm font-bold tabular-nums ${night ? 'text-rose-100' : 'text-red-700'}`}>
              {spentReal.toLocaleString('ru-RU')} ₽
            </p>
          </div>
        </div>
      </div>

      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={(e) => {
          e.stopPropagation();
          if (onSettings) onSettings();
        }}
        className={`w-full px-3 py-2.5 rounded-xl text-sm font-semibold transition flex items-center justify-center gap-2 ${
          night
            ? 'border border-white/[0.12] bg-white/[0.08] text-slate-100 hover:bg-white/[0.14] backdrop-blur-sm'
            : 'bg-slate-100/90 text-slate-700 hover:bg-slate-200 border border-slate-200/80'
        }`}
      >
        <Settings className="w-4 h-4" />
        Настройки
      </motion.button>
    </Card>
  );
}
