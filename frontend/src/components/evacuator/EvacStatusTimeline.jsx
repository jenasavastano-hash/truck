import { Check } from 'lucide-react';

const STEPS = [
  { id: 'created', label: 'Создана' },
  { id: 'has_responses', label: 'Отклики' },
  { id: 'confirmed', label: 'Подтвержд.' },
  { id: 'in_progress', label: 'В пути' },
  { id: 'completed', label: 'Выполнена' },
];

function normalizeStatus(status) {
  const s = String(status || '').trim();
  if (!s) return 'created';
  return s;
}

export default function EvacStatusTimeline({ status }) {
  const s = normalizeStatus(status);
  const idx = STEPS.findIndex((x) => x.id === s);
  const activeIdx = idx >= 0 ? idx : 0;

  return (
    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
      {STEPS.map((step, i) => {
        const done = i < activeIdx;
        const active = i === activeIdx;
        return (
          <div key={step.id} className="flex items-center gap-2 shrink-0">
            <div
              className={`w-6 h-6 rounded-full border flex items-center justify-center text-[11px] font-bold ${
                done
                  ? 'bg-emerald-500 border-emerald-500 text-white'
                  : active
                    ? 'bg-orange-500 border-orange-500 text-white'
                    : 'bg-white border-slate-200 text-slate-400'
              }`}
              title={step.label}
            >
              {done ? <Check className="w-4 h-4" /> : i + 1}
            </div>
            <span
              className={`text-[11px] font-semibold ${
                done ? 'text-emerald-700' : active ? 'text-orange-700' : 'text-slate-400'
              }`}
            >
              {step.label}
            </span>
            {i !== STEPS.length - 1 && (
              <div className={`w-6 h-[2px] rounded ${i < activeIdx ? 'bg-emerald-300' : 'bg-slate-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

