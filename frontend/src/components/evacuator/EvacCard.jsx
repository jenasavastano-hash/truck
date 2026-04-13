import EvacStatusTimeline from './EvacStatusTimeline';

const STATUS_LABEL = {
  created: 'Новая',
  has_responses: 'Есть отклики',
  confirmed: 'Подтверждена',
  in_progress: 'В пути',
  completed: 'Выполнена',
  cancelled: 'Отменена',
};

function statusLabel(status) {
  const s = String(status || '').trim();
  return STATUS_LABEL[s] || s || '—';
}

function badgeClass(status) {
  const s = String(status || '').trim();
  if (s === 'completed') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (s === 'in_progress') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (s === 'confirmed') return 'bg-violet-50 text-violet-700 border-violet-200';
  if (s === 'has_responses') return 'bg-amber-50 text-amber-800 border-amber-200';
  if (s === 'cancelled') return 'bg-rose-50 text-rose-700 border-rose-200';
  return 'bg-slate-50 text-slate-700 border-slate-200';
}

export default function EvacCard({
  title,
  status,
  subtitle,
  metaRight,
  comment,
  timeline = true,
  chips,
  actions,
  children,
  className = '',
}) {
  const isCancelled = String(status || '').trim() === 'cancelled';
  return (
    <div className={`bg-white rounded-2xl border border-slate-200 p-4 shadow-sm ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-slate-900 truncate">{title}</p>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {metaRight}
          <span className={`text-[11px] px-2 py-1 rounded-full border font-semibold ${badgeClass(status)}`}>
            {statusLabel(status)}
          </span>
        </div>
      </div>

      {timeline && !isCancelled && (
        <div className="mt-3">
          <EvacStatusTimeline status={status} />
        </div>
      )}

      {comment && (
        <p className="text-slate-700 text-sm mt-3 whitespace-pre-wrap break-words">
          {comment}
        </p>
      )}

      {Array.isArray(chips) && chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map((c, idx) => (
            <span
              key={`${idx}-${c?.label || 'chip'}`}
              className={`text-xs px-2 py-1 rounded-full border ${c?.className || 'bg-slate-50 border-slate-200 text-slate-600'}`}
              title={c?.title}
            >
              {c?.label}
            </span>
          ))}
        </div>
      )}

      {children}

      {actions && (
        <div className="mt-4 flex flex-wrap gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}

