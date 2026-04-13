import { motion } from 'framer-motion';
import { Truck, ShieldCheck, CheckCircle2, Clock, XCircle, Loader2, Camera } from 'lucide-react';

export default function StatusOverview({
  shiftStatus,
  isVerified,
  carId,
  regNumber,
  onShiftClick,
  onStatusClick,
  isShiftActive,
  delay = 0,
  photoControlEnabled,
  photoControlStatus,
  onPhotoControlClick,
  cinematic = false,
  night = false,
}) {
  const handleStatusClick = onStatusClick || onShiftClick;
  const isClickable = !!handleStatusClick;
  const fcClickable = photoControlEnabled && !!onPhotoControlClick;

  const rowSurface = cinematic
    ? night
      ? 'border-slate-600/50 bg-slate-800/55 backdrop-blur-sm shadow-sm shadow-black/20'
      : 'border-slate-200/80 bg-white/90 backdrop-blur-sm shadow-sm'
    : 'border-slate-200/80 bg-white shadow-sm';

  const labelCls = night ? 'text-slate-400' : 'text-slate-500';
  const mutedCls = night ? 'text-slate-400' : 'text-slate-600';
  const titleActive = night ? 'text-teal-300' : 'text-teal-800';
  const titleCreating = night ? 'text-orange-300' : 'text-orange-800';
  const titleInactive = night ? 'text-slate-200' : 'text-slate-700';
  const verifiedTitle = night ? 'text-emerald-300' : 'text-emerald-700';
  const pendingTitle = night ? 'text-amber-300' : 'text-amber-700';
  const carTitle = night ? 'text-sky-200' : 'text-sky-900';
  const carUnset = night ? 'text-slate-300' : 'text-slate-700';

  const iconShiftActive = night ? 'bg-teal-950/70' : 'bg-teal-100';
  const iconShiftCreating = night ? 'bg-orange-950/60' : 'bg-orange-100';
  const iconShiftInactive = night ? 'bg-slate-700/80' : 'bg-slate-100';
  const truckIconActive = night ? 'text-teal-300' : 'text-teal-700';
  const truckIconInactive = night ? 'text-slate-400' : 'text-slate-500';

  const outerCard = cinematic
    ? night
      ? 'border-slate-600/50 bg-[var(--freight-driver-surface-night)] shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-md'
      : 'border-white/50 bg-white/75 shadow-[0_12px_40px_rgba(15,23,42,0.12)] backdrop-blur-md'
    : 'border-slate-200/60 bg-gradient-to-br from-white via-slate-50/80 to-white shadow-lg';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className={`overflow-hidden rounded-2xl border ${outerCard}`}
    >
      {/* Грузовые перевозки: бирюза = путевой активен, оранж = оформление, шлак = нет путевого */}
      <div
        className={`px-6 py-4 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] ${
          shiftStatus.status === 'active'
            ? 'bg-gradient-to-r from-teal-600 to-teal-800'
            : shiftStatus.status === 'creating'
              ? 'bg-gradient-to-r from-orange-500 to-orange-700'
              : 'bg-gradient-to-r from-slate-700 to-slate-900'
        }`}
      >
        <h2 className="text-xl font-bold tracking-tight">Смена и путевой лист</h2>
        <p className="text-white/80 text-xs mt-1 font-medium">Грузовой транспорт · ЭПЛ</p>
      </div>

      {/* Контент */}
      <div className="p-6 space-y-4">
        <div
          role={isClickable ? 'button' : undefined}
          tabIndex={isClickable ? 0 : undefined}
          onClick={isClickable ? handleStatusClick : undefined}
          onKeyDown={isClickable ? (e) => e.key === 'Enter' && handleStatusClick() : undefined}
          className={`flex items-start justify-between rounded-xl border p-4 ${rowSurface} ${isClickable ? (night ? 'cursor-pointer hover:bg-slate-700/45 hover:border-teal-600/45 transition' : 'cursor-pointer hover:bg-teal-50/40 hover:border-teal-200/80 transition') : ''}`}
        >
          <div className="flex items-start gap-3 flex-1">
            <div
              className={`p-2 rounded-lg ${
                shiftStatus.status === 'active'
                  ? iconShiftActive
                  : shiftStatus.status === 'creating'
                    ? iconShiftCreating
                    : iconShiftInactive
              }`}
            >
              {shiftStatus.status === 'active' && <Truck className={`w-5 h-5 ${truckIconActive}`} />}
              {shiftStatus.status === 'creating' && <Loader2 className="w-5 h-5 text-orange-400 animate-spin" />}
              {shiftStatus.status === 'inactive' && <Truck className={`w-5 h-5 ${truckIconInactive}`} />}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-semibold ${labelCls} uppercase tracking-wide mb-1`}>Путевой лист</p>
              <p
                className={`text-base font-bold ${
                  shiftStatus.status === 'active'
                    ? titleActive
                    : shiftStatus.status === 'creating'
                      ? titleCreating
                      : titleInactive
                }`}
              >
                {shiftStatus.value}
              </p>
              {shiftStatus.shiftOpenedAt && (
                <p className={`text-xs ${mutedCls} mt-0.5`}>Смена открыта: {shiftStatus.shiftOpenedAt}</p>
              )}
              {shiftStatus.time && <p className={`text-xs ${mutedCls} mt-0.5`}>{shiftStatus.time}</p>}
              {shiftStatus.hint && <p className={`text-xs ${mutedCls} mt-1`}>{shiftStatus.hint}</p>}
            </div>
          </div>
          {shiftStatus.status === 'active' && <CheckCircle2 className={`w-5 h-5 shrink-0 ${night ? 'text-teal-400' : 'text-teal-600'}`} />}
          {shiftStatus.status === 'creating' && <Clock className="w-5 h-5 text-orange-400 shrink-0" />}
          {shiftStatus.status === 'inactive' && <XCircle className={`w-5 h-5 shrink-0 ${night ? 'text-slate-500' : 'text-slate-400'}`} />}
        </div>

        <div className={`flex items-start justify-between rounded-xl border p-4 ${rowSurface}`}>
          <div className="flex items-start gap-3 flex-1">
            <div className={`p-2 rounded-lg ${isVerified ? (night ? 'bg-emerald-950/70' : 'bg-emerald-100') : night ? 'bg-amber-950/50' : 'bg-amber-100'}`}>
              <ShieldCheck className={`w-5 h-5 ${isVerified ? (night ? 'text-emerald-400' : 'text-emerald-600') : night ? 'text-amber-400' : 'text-amber-600'}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-semibold ${labelCls} uppercase tracking-wide mb-1`}>Верификация</p>
              <p className={`text-base font-bold ${isVerified ? verifiedTitle : pendingTitle}`}>
                {isVerified ? 'Подтверждён' : 'Ожидает'}
              </p>
            </div>
          </div>
          {isVerified ? (
            <CheckCircle2 className={`w-5 h-5 shrink-0 ${night ? 'text-emerald-400' : 'text-emerald-600'}`} />
          ) : (
            <Clock className={`w-5 h-5 shrink-0 ${night ? 'text-amber-400' : 'text-amber-600'}`} />
          )}
        </div>

        <div className={`flex items-start justify-between rounded-xl border p-4 ${rowSurface}`}>
          <div className="flex items-start gap-3 flex-1">
            <div className={`p-2 rounded-lg ${carId ? (night ? 'bg-sky-950/60' : 'bg-sky-100') : iconShiftInactive}`}>
              <Truck className={`w-5 h-5 ${carId ? (night ? 'text-sky-300' : 'text-sky-800') : truckIconInactive}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-semibold ${labelCls} uppercase tracking-wide mb-1`}>Транспортное средство</p>
              <p className={`text-base font-bold ${carId ? carTitle : carUnset}`}>{carId ? regNumber || 'Привязано' : 'Не привязано'}</p>
            </div>
          </div>
          {carId ? (
            <CheckCircle2 className={`w-5 h-5 shrink-0 ${night ? 'text-teal-400' : 'text-teal-600'}`} />
          ) : (
            <XCircle className={`w-5 h-5 shrink-0 ${night ? 'text-slate-500' : 'text-slate-400'}`} />
          )}
        </div>

        {photoControlEnabled && photoControlStatus && (
          <div
            role={fcClickable ? 'button' : undefined}
            tabIndex={fcClickable ? 0 : undefined}
            onClick={fcClickable ? onPhotoControlClick : undefined}
            onKeyDown={fcClickable ? (e) => e.key === 'Enter' && onPhotoControlClick() : undefined}
            className={`flex items-start justify-between rounded-xl border p-4 ${rowSurface} ${fcClickable ? (night ? 'cursor-pointer hover:bg-slate-700/40 hover:border-sky-600/40 transition' : 'cursor-pointer hover:bg-sky-50/50 hover:border-sky-200 transition') : ''}`}
          >
            <div className="flex items-start gap-3 flex-1">
              <div
                className={`p-2 rounded-lg ${
                  photoControlStatus.status === 'active'
                    ? night
                      ? 'bg-emerald-950/60'
                      : 'bg-emerald-100'
                    : photoControlStatus.status === 'creating'
                      ? night
                        ? 'bg-amber-950/50'
                        : 'bg-amber-100'
                      : iconShiftInactive
                }`}
              >
                {photoControlStatus.status === 'active' && <Camera className={`w-5 h-5 ${night ? 'text-emerald-400' : 'text-emerald-600'}`} />}
                {(photoControlStatus.status === 'creating' || photoControlStatus.status === 'inactive') && (
                  <Camera
                    className={`w-5 h-5 ${
                      photoControlStatus.status === 'creating' ? (night ? 'text-amber-400' : 'text-amber-600') : truckIconInactive
                    }`}
                  />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-semibold ${labelCls} uppercase tracking-wide mb-1`}>Фотоконтроль</p>
                <p
                  className={`text-base font-bold ${
                    photoControlStatus.status === 'active'
                      ? verifiedTitle
                      : photoControlStatus.status === 'creating'
                        ? pendingTitle
                        : titleInactive
                  }`}
                >
                  {photoControlStatus.value}
                </p>
                {photoControlStatus.time && <p className={`text-xs ${mutedCls} mt-1`}>{photoControlStatus.time}</p>}
              </div>
            </div>
            {photoControlStatus.status === 'active' && <CheckCircle2 className={`w-5 h-5 shrink-0 ${night ? 'text-emerald-400' : 'text-emerald-600'}`} />}
            {photoControlStatus.status === 'creating' && <Clock className="w-5 h-5 text-amber-400 shrink-0" />}
            {photoControlStatus.status === 'inactive' && <XCircle className={`w-5 h-5 shrink-0 ${night ? 'text-slate-500' : 'text-slate-400'}`} />}
          </div>
        )}
      </div>
    </motion.div>
  );
}
