import React from 'react';
import { CheckCircle2, Circle, Minus } from 'lucide-react';

/**
 * Компактное отображение статусов титулов ЭПЛ Т1–Т4 для админа и менеджера.
 * @param {Object} titulStatus - { t1, t2, t3, t4 } — 'signed' | 'filled' | null
 * @param {string} size - 'sm' | 'md' — размер бейджей
 * @param {boolean} showLabels - показывать подписи Т1–Т4
 */
export default function TitulBadges({ titulStatus = {}, size = 'md', showLabels = false }) {
  const t = titulStatus.t1 != null || titulStatus.t2 != null || titulStatus.t3 != null || titulStatus.t4 != null
    ? titulStatus
    : { t1: null, t2: null, t3: null, t4: null };

  const titles = [
    { key: 't1', label: 'Т1' },
    { key: 't2', label: 'Т2' },
    { key: 't3', label: 'Т3' },
    { key: 't4', label: 'Т4' },
  ];

  const isSm = size === 'sm';
  const boxClass = isSm ? 'w-6 h-6' : 'w-8 h-8';
  const iconClass = isSm ? 'w-3.5 h-3.5' : 'w-4 h-4';
  const textClass = isSm ? 'text-[10px]' : 'text-xs';

  const renderBadge = (key, label) => {
    const status = t[key];
    const signed = status === 'signed';
    const filled = status === 'filled';
    const empty = status == null || status === '';

    let bg = 'bg-slate-100 text-slate-400';
    let title = `${label}: не заполнен`;
    if (signed) {
      bg = 'bg-emerald-100 text-emerald-700';
      title = `${label}: подписан`;
    } else if (filled) {
      bg = 'bg-amber-100 text-amber-700';
      title = `${label}: заполнен`;
    }

    return (
      <span
        key={key}
        className={`inline-flex items-center justify-center rounded-lg font-semibold ${boxClass} ${bg} ${textClass} shrink-0`}
        title={title}
      >
        {signed && <CheckCircle2 className={iconClass} aria-hidden />}
        {filled && <Circle className={iconClass} aria-hidden />}
        {empty && <Minus className={`${iconClass} opacity-50`} aria-hidden />}
      </span>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {showLabels ? (
        titles.map(({ key, label }) => (
          <div key={key} className="flex items-center gap-1">
            <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">{label}</span>
            {renderBadge(key, label)}
          </div>
        ))
      ) : (
        titles.map(({ key, label }) => renderBadge(key, label))
      )}
    </div>
  );
}
