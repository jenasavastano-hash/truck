import { useState } from 'react';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';

/**
 * Кратко: что водитель вводит, что делает сервер, откуда QR Такском.
 */
export default function FreightEplHint({ night = false }) {
  const [open, setOpen] = useState(false);

  const shell = night
    ? 'border-slate-600/50 bg-slate-900/75 shadow-md shadow-black/20 backdrop-blur-sm'
    : 'border-slate-200/80 bg-white/70 shadow-sm backdrop-blur-sm';
  const btn = night
    ? 'text-slate-100 hover:bg-slate-800/80'
    : 'text-slate-800 hover:bg-white/80';
  const chev = night ? 'text-slate-400' : 'text-slate-500';
  const divider = night ? 'border-slate-600/50' : 'border-slate-200/60';
  const body = night ? 'text-slate-300' : 'text-slate-700';
  const strong = night ? 'text-slate-50' : 'text-slate-900';
  const icon = night ? 'text-teal-400' : 'text-teal-600';

  return (
    <div className={`rounded-2xl border ${shell}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between gap-2 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition ${btn}`}
      >
        <span className="flex items-center gap-2">
          <Info className={`h-4 w-4 shrink-0 ${icon}`} />
          Как устроены смена и путевой (грузовые ЭПЛ)
        </span>
        {open ? <ChevronUp className={`h-4 w-4 shrink-0 ${chev}`} /> : <ChevronDown className={`h-4 w-4 shrink-0 ${chev}`} />}
      </button>
      {open && (
        <div className={`space-y-3 border-t ${divider} px-4 pb-4 pt-2 text-sm leading-relaxed ${body}`}>
          <p>
            <strong className={strong}>Что вы вводите:</strong> при создании путевого —{' '}
            <strong>показание одометра</strong> (км) перед выездом. Остальное (ФИО, ВУ, ТС, парк) подставляется из
            карточек, которые заполняет менеджер.
          </p>
          <p>
            <strong className={strong}>Что происходит сразу:</strong> если у парка включена быстрая печать, сервер
            собирает <strong>черновой PDF</strong> по шаблону путевого и QR на страницу документа в приложении — чтобы вы
            могли ехать не с пустыми руками. В строке ТС для грузового парка по умолчанию указывается{' '}
            <strong>грузовой</strong> (в карточке авто можно задать тип ТС точнее).
          </p>
          <p>
            <strong className={strong}>QR из Такском:</strong> после того как путевой появится в ГИС и в системе
            будет номер ЭПЛ (mintransId), backend <strong>периодически запрашивает QR по API Такском</strong> (нужна лицензия
            / ключи в настройках). Пока официальный документ не создан — QR Такском может ещё не существовать; на ПК
            клиники при необходимости дополнительно работает сценарий <strong>qr-fetcher</strong> (подхват с экрана Такском).
          </p>
          <p>
            <strong className={strong}>Программа на ПК (воркеры):</strong> заявки со статусом «ожидает клинику»
            обрабатываются утилитой на компьютере медорганизации: там создаётся официальный ЭПЛ в Такском и результат
            уходит на сервер.
          </p>
        </div>
      )}
    </div>
  );
}
