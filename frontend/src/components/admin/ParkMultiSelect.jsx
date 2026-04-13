import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckSquare, ChevronDown, Search, Square } from 'lucide-react';

export default function ParkMultiSelect({ parks = [], value = [], onChange, label = 'Парки' }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);

  const normalizedParks = useMemo(() => {
    return (parks || [])
      .map((p) => {
        const id = p?.id ?? p?.parkId ?? p?.park_id;
        const name = p?.name ?? p?.parkName ?? p?.title ?? p?.label;
        return { raw: p, id, name: name != null ? String(name) : '' };
      })
      .filter((p) => p.id != null && p.id !== '');
  }, [parks]);

  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const allIds = useMemo(() => (normalizedParks || []).map((p) => p.id).filter((x) => x != null && x !== ''), [normalizedParks]);
  const isAll = allIds.length > 0 && allIds.every((id) => value.includes(id));

  const selectedNames = useMemo(() => {
    const map = new Map((normalizedParks || []).map((p) => [p.id, p.name || `Парк #${p.id}`]));
    return (value || []).map((id) => map.get(id)).filter(Boolean);
  }, [normalizedParks, value]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return normalizedParks || [];
    return (normalizedParks || []).filter((p) => String(p?.name || '').toLowerCase().includes(query) || String(p?.id || '').toLowerCase().includes(query));
  }, [normalizedParks, q]);

  const toggleId = (id) => {
    if (!id) return;
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else onChange([...value, id]);
  };

  return (
    <div className="relative" ref={ref}>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg bg-white flex items-center justify-between gap-2"
      >
        <span className="text-sm text-slate-800 truncate">
          {value.length === 0 ? 'Не выбрано' : isAll ? 'Все парки' : `Выбрано: ${value.length} · ${selectedNames.slice(0, 2).join(', ')}${selectedNames.length > 2 ? '…' : ''}`}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-500 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
          <div className="p-3 border-b border-slate-100 space-y-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onChange(allIds)}
                className="flex-1 px-3 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold"
              >
                Все парки
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                className="flex-1 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold"
              >
                Очистить
              </button>
            </div>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Поиск парка..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm"
              />
            </div>
          </div>

          <div className="max-h-56 overflow-y-auto p-2">
            {filtered.length === 0 ? (
              <div className="p-3 text-sm text-slate-500">Ничего не найдено</div>
            ) : (
              filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleId(p.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-50 text-left"
                >
                  {value.includes(p.id) ? (
                    <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-300 shrink-0" />
                  )}
                  <span className="text-sm text-slate-800">{p.name || `Парк #${p.id}`}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

