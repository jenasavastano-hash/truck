import { motion } from 'framer-motion';
import { User, Phone, Car, Wallet, CheckCircle2, AlertCircle, Link2, Unlink } from 'lucide-react';
import Card from '../ui/Card';

export default function DriverCard({ driver, onClick, onBalanceClick, onBindCar, index = 0, night = false }) {
  const hasCar = driver.carId && driver.regNumber;
  const isVerified = driver.isVerified;
  const displayName = driver.fullName || driver.phone || 'Без имени';
  const balance = driver.balance || 0;
  const hasLowBalance = balance < 25;

  const iconBox = isVerified
    ? night
      ? 'bg-emerald-500/20 text-emerald-300'
      : 'bg-emerald-100 text-emerald-600'
    : night
      ? 'bg-amber-500/20 text-amber-300'
      : 'bg-amber-100 text-amber-600';

  const carRow = hasCar
    ? night
      ? 'bg-teal-500/15 border border-teal-400/25'
      : 'bg-teal-50 border border-teal-200'
    : night
      ? 'bg-slate-800/60 border border-white/[0.08]'
      : 'bg-slate-50 border border-slate-200';

  const balRow = hasLowBalance
    ? night
      ? 'bg-red-500/12 border border-red-400/25'
      : 'bg-red-50 border border-red-200'
    : night
      ? 'bg-emerald-500/12 border border-emerald-400/25'
      : 'bg-emerald-50 border border-emerald-200';

  return (
    <Card
      onClick={onClick}
      delay={index * 0.05}
      variant={night ? 'glassNight' : 'glassDay'}
      className={`p-4 cursor-pointer ${night ? 'hover:border-teal-400/35' : 'hover:border-teal-300'}`}
    >
      <div className="flex items-start gap-3 mb-3">
        <div className={`p-2 rounded-lg shrink-0 ${iconBox}`}>
          <User className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className={`font-bold text-base truncate ${night ? 'text-slate-50' : 'text-slate-800'}`}>{displayName}</h3>
            {isVerified ? (
              <CheckCircle2
                className={`w-4 h-4 shrink-0 ${night ? 'text-emerald-400' : 'text-emerald-600'}`}
                aria-label="Верифицирован"
              />
            ) : (
              <AlertCircle
                className={`w-4 h-4 shrink-0 ${night ? 'text-amber-400' : 'text-amber-600'}`}
                aria-label="Не верифицирован"
              />
            )}
          </div>
          {String(driver.innMutationApplied || 0) === '1' && (
            <div
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium mt-2 ${
                night ? 'bg-amber-500/15 border border-amber-400/30 text-amber-100' : 'bg-amber-50 border border-amber-200 text-amber-900'
              }`}
            >
              ИНН подменён
            </div>
          )}
          {driver.phone && (
            <div className={`flex items-center gap-1.5 text-xs mb-1 ${night ? 'text-slate-400' : 'text-slate-600'}`}>
              <Phone className="w-3 h-3 shrink-0" />
              <span>{driver.phone}</span>
            </div>
          )}
          <div
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium mt-1 ${
              isVerified
                ? night
                  ? 'bg-emerald-500/15 text-emerald-200'
                  : 'bg-emerald-100 text-emerald-700'
                : night
                  ? 'bg-amber-500/15 text-amber-200'
                  : 'bg-amber-100 text-amber-700'
            }`}
          >
            {isVerified ? '✓ Верифицирован' : '⚠ Не верифицирован'}
          </div>
        </div>
      </div>

      <div className="space-y-2 mb-3">
        <div className={`flex items-center justify-between p-2 rounded-lg ${carRow}`}>
          <div className="flex items-center gap-2 text-xs min-w-0">
            <Car
              className={`w-3 h-3 shrink-0 ${hasCar ? (night ? 'text-teal-300' : 'text-teal-600') : 'text-slate-400'}`}
            />
            <span
              className={`truncate ${hasCar ? (night ? 'text-teal-100 font-medium' : 'text-teal-800 font-medium') : night ? 'text-slate-400' : 'text-slate-600'}`}
            >
              {hasCar ? driver.regNumber : 'Авто не привязано'}
            </span>
            {hasCar && driver.brand && driver.model && (
              <span className={`text-xs shrink-0 ${night ? 'text-slate-500' : 'text-slate-500'}`}>
                ({driver.brand} {driver.model})
              </span>
            )}
          </div>
          {onBindCar && (
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={(e) => {
                e.stopPropagation();
                onBindCar(driver);
              }}
              className={`p-1.5 rounded-lg transition shrink-0 ${
                hasCar
                  ? night
                    ? 'text-teal-300 hover:bg-teal-500/20'
                    : 'text-teal-600 hover:bg-teal-100'
                  : night
                    ? 'text-slate-400 hover:bg-slate-700/50'
                    : 'text-slate-500 hover:bg-slate-200'
              }`}
              title={hasCar ? 'Изменить авто' : 'Привязать авто'}
            >
              {hasCar ? <Unlink className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
            </motion.button>
          )}
        </div>

        <div className={`flex items-center justify-between p-2 rounded-lg ${balRow}`}>
          <div className="flex items-center gap-2 text-xs min-w-0">
            <Wallet
              className={`w-3 h-3 shrink-0 ${hasLowBalance ? (night ? 'text-red-300' : 'text-red-600') : night ? 'text-emerald-300' : 'text-emerald-600'}`}
            />
            <span className={night ? 'text-slate-300' : 'text-slate-700'}>Баланс:</span>
            <span
              className={`font-bold ${hasLowBalance ? (night ? 'text-red-300' : 'text-red-600') : night ? 'text-emerald-300' : 'text-emerald-600'}`}
            >
              ₽{balance}
            </span>
          </div>
          {onBalanceClick && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={(e) => {
                e.stopPropagation();
                onBalanceClick(driver);
              }}
              className="px-2 py-1 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700 font-semibold transition shadow-sm"
            >
              Пополнить
            </motion.button>
          )}
        </div>
      </div>
    </Card>
  );
}
