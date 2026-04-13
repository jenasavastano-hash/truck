import { motion } from 'framer-motion';
import { Car, User, Hash, Link2, Unlink } from 'lucide-react';
import Card from '../ui/Card';

export default function CarCard({ car, onClick, onBindDriver, index = 0, night = false }) {
  const hasDriver = car.driverId && car.driverName;
  const displayRegNumber = car.regNumber || 'Без номера';
  const displayBrandModel =
    car.brand || car.model ? `${car.brand || ''} ${car.model || ''}`.trim() : 'Марка/модель не указана';

  const driverBox = hasDriver
    ? night
      ? 'bg-emerald-500/15 border border-emerald-400/25'
      : 'bg-emerald-50 border border-emerald-200'
    : night
      ? 'bg-slate-800/60 border border-white/[0.08]'
      : 'bg-slate-50 border border-slate-200';

  return (
    <Card
      onClick={onClick}
      delay={index * 0.05}
      variant={night ? 'glassNight' : 'glassDay'}
      className={`p-4 cursor-pointer ${night ? 'hover:border-teal-400/35' : 'hover:border-teal-300'}`}
    >
      <div className="flex items-start gap-3 mb-3">
        <div
          className={`p-2 rounded-lg shrink-0 ${
            night ? 'bg-teal-500/20 text-teal-200' : 'bg-teal-100 text-teal-700'
          }`}
        >
          <Car className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Hash className={`w-4 h-4 shrink-0 ${night ? 'text-slate-400' : 'text-slate-500'}`} />
            <h3 className={`font-bold text-base truncate ${night ? 'text-slate-50' : 'text-slate-800'}`}>
              {displayRegNumber}
            </h3>
          </div>
          <p className={`text-xs mb-1 ${night ? 'text-slate-400' : 'text-slate-600'}`}>{displayBrandModel}</p>
          {car.inventoryNumber && (
            <p className={`text-xs ${night ? 'text-slate-500' : 'text-slate-500'}`}>Инв. №: {car.inventoryNumber}</p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className={`flex items-center justify-between p-2 rounded-lg ${driverBox}`}>
          <div className="flex items-center gap-2 text-xs flex-1 min-w-0">
            <User
              className={`w-3 h-3 shrink-0 ${hasDriver ? (night ? 'text-emerald-300' : 'text-emerald-600') : 'text-slate-400'}`}
            />
            <span
              className={`truncate ${
                hasDriver
                  ? night
                    ? 'text-emerald-200 font-medium'
                    : 'text-emerald-700 font-medium'
                  : night
                    ? 'text-slate-400'
                    : 'text-slate-600'
              }`}
            >
              {hasDriver ? car.driverName : 'Водитель не привязан'}
            </span>
          </div>
          {onBindDriver && (
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={(e) => {
                e.stopPropagation();
                onBindDriver(car);
              }}
              className={`p-1.5 rounded-lg transition shrink-0 ${
                hasDriver
                  ? night
                    ? 'text-emerald-300 hover:bg-emerald-500/20'
                    : 'text-emerald-600 hover:bg-emerald-100'
                  : night
                    ? 'text-slate-400 hover:bg-slate-700/50'
                    : 'text-slate-500 hover:bg-slate-200'
              }`}
              title={hasDriver ? 'Изменить водителя' : 'Привязать водителя'}
            >
              {hasDriver ? <Unlink className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
            </motion.button>
          )}
        </div>
      </div>
    </Card>
  );
}
