/**
 * iOS-подобные панели для операционных кабинетов (менеджер / директор), согласовано с админкой.
 * Ночью — светлое стекло на фоне (без тяжёлых «чёрных рам»).
 * @param {boolean} night
 */
export function operationsShell(night) {
  return night
    ? 'border border-white/[0.14] bg-white/[0.07] backdrop-blur-2xl shadow-[0_16px_48px_rgba(0,0,0,0.25)] ring-1 ring-white/[0.08]'
    : 'border border-white/72 bg-white/50 backdrop-blur-2xl shadow-[0_12px_40px_rgba(15,23,42,0.1)] ring-1 ring-slate-900/[0.06] saturate-[1.15]';
}

export function operationsInset(night) {
  return night
    ? 'border border-white/[0.12] bg-white/[0.06] backdrop-blur-md ring-1 ring-white/[0.06]'
    : 'border border-white/55 bg-white/38 backdrop-blur-xl ring-1 ring-slate-900/[0.04] saturate-[1.08]';
}

/** Верхняя полоса под хедером (менеджер / админ): прозрачное стекло */
export function operationsHeaderStrip(night) {
  return night
    ? 'border-b border-white/12 bg-slate-900/35 backdrop-blur-2xl shadow-[0_8px_40px_rgba(15,23,42,0.22)]'
    : 'border-b border-slate-200/85 bg-white/85 backdrop-blur-xl shadow-sm';
}

/** Sticky-ряд табов под хедером */
export function operationsStickyTabsRow(night) {
  return night
    ? 'border-b border-white/10 bg-slate-950/30 backdrop-blur-2xl shadow-[0_4px_28px_rgba(0,0,0,0.2)]'
    : 'border-b border-slate-200/70 bg-white/80 backdrop-blur-xl shadow-sm';
}

/** Неактивная кнопка в табах ночью — стекло, не сплошной slate-800 */
export function operationsTabInactive(night) {
  return night
    ? 'border-white/12 bg-white/[0.04] text-slate-200 hover:text-white hover:bg-white/[0.1] hover:border-white/25'
    : 'border-slate-200 bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50';
}

/** Поля ввода и select в операционных панелях (ночь — тёмное стекло). */
export function operationsFieldClass(night, opts = {}) {
  const focus =
    opts.focus === 'teal'
      ? 'focus:ring-teal-500/40 focus:border-teal-400/35'
      : 'focus:ring-sky-500/40 focus:border-sky-400/35';
  return night
    ? `px-3 py-2 rounded-lg border border-white/[0.14] bg-white/[0.06] text-slate-100 placeholder:text-slate-500 text-sm focus:outline-none focus:ring-2 ${focus} backdrop-blur-sm [&>option]:bg-slate-900 [&>option]:text-slate-100`
    : 'px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/60 focus:border-blue-500 bg-white';
}

export function readOperationsSceneNight() {
  try {
    const v = localStorage.getItem('freight_operations_scene');
    if (v === 'day') return false;
    if (v === 'night') return true;
  } catch (_) {}
  const h = new Date().getHours();
  return h < 7 || h >= 20;
}
