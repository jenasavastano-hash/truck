import React from 'react';
import { MapPin, Package } from 'lucide-react';

/**
 * Упрощённый ввод грузового маршрута: дефолты парка + выбор точек из справочника + одна доп. строка.
 */
export default function DriverCreateEplFreightFields({
  sceneNight = false,
  stores = [],
  storesLoading,
  origin,
  setOrigin,
  loadAddr,
  setLoadAddr,
  selectedStoreIds,
  toggleStoreId,
  extraUnload,
  setExtraUnload,
}) {
  const label = sceneNight ? 'text-slate-200' : 'text-slate-700';
  const input = sceneNight
    ? 'border-white/20 bg-white/10 text-slate-100 placeholder:text-slate-500'
    : 'border-slate-200 bg-white text-slate-900';

  return (
    <div className="space-y-4 mt-2">
      <p className={`text-xs sm:text-sm ${sceneNight ? 'text-slate-400' : 'text-slate-600'}`}>
        Маршрут задан парком: отметьте точки выгрузки. Отправление и погрузку можно поправить, если сменились.
      </p>

      <div>
        <label className={`flex items-center gap-1.5 text-sm font-medium ${label}`}>
          <MapPin className="w-4 h-4 shrink-0 opacity-80" />
          Отправление
        </label>
        <input
          type="text"
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
          placeholder="как в путевом, одной строкой"
          className={`mt-1 w-full rounded-xl border px-3 py-2.5 text-sm ${input}`}
        />
      </div>
      <div>
        <label className={`flex items-center gap-1.5 text-sm font-medium ${label}`}>
          <Package className="w-4 h-4 shrink-0 opacity-80" />
          Погрузка
        </label>
        <input
          type="text"
          value={loadAddr}
          onChange={(e) => setLoadAddr(e.target.value)}
          placeholder="часто совпадает с отправлением"
          className={`mt-1 w-full rounded-xl border px-3 py-2.5 text-sm ${input}`}
        />
      </div>

      <div>
        <p className={`text-sm font-medium ${label}`}>Выгрузки — из списка парка</p>
        {storesLoading ? (
          <p className={`text-xs mt-2 ${sceneNight ? 'text-slate-500' : 'text-slate-500'}`}>Загрузка точек…</p>
        ) : stores.length === 0 ? (
          <p className={`text-xs mt-2 ${sceneNight ? 'text-orange-200/90' : 'text-orange-800'}`}>
            В парке пока нет точек в справочнике. Попросите диспетчера добавить их или введите адрес вручную ниже.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2 mt-2">
            {stores.map((s) => {
              const on = selectedStoreIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleStoreId(s.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold border transition ${
                    on
                      ? sceneNight
                        ? 'bg-teal-500/30 border-teal-400/60 text-teal-50'
                        : 'bg-teal-50 border-teal-500 text-teal-900'
                      : sceneNight
                        ? 'border-white/20 bg-white/5 text-slate-200 hover:bg-white/10'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                  title={s.addressText || s.name}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <label className={`text-sm font-medium ${label}`}>Дополнительная выгрузка (если нет в списке)</label>
        <input
          type="text"
          value={extraUnload}
          onChange={(e) => setExtraUnload(e.target.value)}
          placeholder="необязательно, одна строка"
          className={`mt-1 w-full rounded-xl border px-3 py-2.5 text-sm ${input}`}
        />
      </div>
    </div>
  );
}
