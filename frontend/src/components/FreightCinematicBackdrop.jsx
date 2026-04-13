import { useMemo } from 'react';

const STAR_SEEDS = Array.from({ length: 28 }, (_, i) => ({
  left: `${((i * 41) % 96) + 2}%`,
  top: `${((i * 29) % 38) + 4}%`,
  r: 0.8 + (i % 4) * 0.4,
  o: 0.35 + (i % 5) * 0.1,
}));

/**
 * Фон кабинета водителя: строгий статичный градиент (без луны, флота, анимаций неба).
 * Динамика только на экране авторизации.
 */
export default function FreightCinematicBackdrop({ night }) {
  const stars = useMemo(() => STAR_SEEDS, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <div
        className={`absolute inset-0 transition-all duration-700 ease-out ${
          night
            ? 'bg-gradient-to-b from-slate-950 via-slate-900 to-teal-950'
            : 'bg-gradient-to-b from-sky-400 via-cyan-300 to-amber-200'
        }`}
      />

      {!night && (
        <>
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_90%_50%_at_50%_0%,rgba(255,255,255,0.45),transparent_55%)]" />
          <div className="absolute left-[8%] top-[12%] h-16 w-[min(40vw,16rem)] rounded-[100%] bg-white/35 blur-2xl" />
          <div className="absolute right-[10%] top-[18%] h-14 w-[min(36vw,14rem)] rounded-[100%] bg-sky-100/40 blur-xl" />
        </>
      )}

      {night && (
        <>
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_100%_70%_at_50%_-5%,rgba(45,212,191,0.1),transparent_45%)]" />
          <div className="absolute inset-0">
            {stars.map((s, i) => (
              <span
                key={i}
                className="absolute rounded-full bg-white/90"
                style={{
                  left: s.left,
                  top: s.top,
                  width: `${s.r}px`,
                  height: `${s.r}px`,
                  opacity: s.o * 0.75,
                }}
              />
            ))}
          </div>
        </>
      )}

      <div
        className={`absolute bottom-[20vh] left-0 right-0 h-40 opacity-50 blur-3xl ${
          night ? 'bg-slate-900/45' : 'bg-amber-200/50'
        }`}
      />

      <svg
        className={`absolute bottom-[18vh] left-0 right-0 h-16 w-full ${night ? 'text-slate-800/85' : 'text-emerald-700/55'}`}
        viewBox="0 0 400 56"
        preserveAspectRatio="none"
      >
        <path
          d="M0 40 Q60 8 120 36 T240 28 T400 40 V56 H0 Z"
          fill="currentColor"
          stroke={night ? '#0f172a' : '#166534'}
          strokeWidth="3"
        />
      </svg>

      <div
        className="absolute bottom-0 left-0 right-0 h-[20vh] min-h-[100px]"
        style={{
          background: night
            ? 'linear-gradient(180deg,#334155 0%,#0f172a 100%)'
            : 'linear-gradient(180deg,#64748b 0%,#1e293b 100%)',
          clipPath: 'polygon(6% 0,94% 0,100% 100%,0% 100%)',
        }}
      />
      <div
        className={`absolute bottom-[13vh] left-[14%] right-[14%] h-px ${
          night ? 'bg-slate-600/40' : 'bg-slate-400/45'
        }`}
      />
    </div>
  );
}
