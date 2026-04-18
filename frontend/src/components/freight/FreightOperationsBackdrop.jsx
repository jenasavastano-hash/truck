import { useMemo } from 'react';
/**
 * Фон операционных кабинетов (админ / менеджер / home): строгий «бизнес-океан».
 * Статично — без луны, флота и анимаций неба; динамика только на экране логина.
 */
export default function FreightOperationsBackdrop({ night }) {
  const v = night ? 'night' : 'day';

  const stars = useMemo(() => {
    const out = [];
    for (let i = 0; i < 92; i++) {
      const seed = (i * 1103515245 + 12345) >>> 0;
      const left = (seed % 960) / 10 + 1;
      const top = ((seed >> 8) % 520) / 10 + 2;
      const isMega = i % 13 === 0;
      const isLarge = !isMega && (i % 7 === 0 || i % 11 === 0);
      let size;
      if (isMega) size = 4.5 + (seed % 80) / 35;
      else if (isLarge) size = 2.8 + (seed % 55) / 22;
      else size = 1.1 + (seed % 35) / 45;
      const delay = ((seed >> 4) % 32) / 10;
      out.push({ key: i, left, top, size, isLarge: isMega || isLarge });
    }
    return out;
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <div
        className={`absolute inset-0 transition-all duration-700 ease-out ${
          night
            ? 'bg-gradient-to-b from-slate-950 via-[#0f172a] to-[#0c4a3e]'
            : 'bg-gradient-to-b from-sky-400 via-sky-200 to-cyan-100'
        }`}
      />

      {!night && (
        <>
          {/* Ясный день: слои глубины, дальняя дымка, мягкий горизонт */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_100%_60%_at_50%_-15%,rgba(255,255,255,0.65),transparent_55%)]" />
          <div className="absolute inset-0 bg-gradient-to-b from-sky-100/10 via-sky-200/20 to-emerald-100/35" />
          <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-slate-900/12 to-transparent" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_40%_at_70%_100%,rgba(16,185,129,0.12),transparent_60%)]" />
          <div className="absolute bottom-[35vh] left-0 right-0 h-40 bg-gradient-to-t from-slate-300/30 to-transparent blur-2xl" />
          {/* Солнце + блик */}
          <div className="absolute right-[12%] top-[8%] h-40 w-40 rounded-full bg-amber-100/45 blur-3xl" />
          <div className="absolute right-[18%] top-[14%] h-20 w-20 rounded-full bg-white/80 blur-2xl" />
          <div className="absolute right-[16%] top-[12%] h-3 w-24 rotate-[-15deg] rounded-full bg-white/40 blur-md" />
          <DayCloud id="a" className="left-[4%] top-[8%] w-[min(44vw,19rem)] opacity-[0.95]" />
          <DayCloud id="b" className="right-[6%] top-[14%] w-[min(38vw,16rem)] opacity-[0.88]" />
          <DayCloud id="c" className="left-[32%] top-[4%] w-[min(52vw,22rem)] opacity-[0.78]" />
          <DayCloud id="d" className="left-[55%] top-[20%] w-[min(28vw,12rem)] opacity-[0.55]" />
          <DayCloud id="e" className="right-[22%] top-[28%] w-[min(34vw,14rem)] opacity-[0.62]" />
        </>
      )}

      {night && (
        <>
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_120%_80%_at_50%_-10%,rgba(45,212,191,0.12),transparent_50%)]" />
          <div className="absolute inset-0">
            {stars.map((s) => (
              <span
                key={s.key}
                className={`absolute rounded-full bg-white/90 ${
                  s.isLarge ? 'shadow-[0_0_6px_rgba(186,230,253,0.35)]' : ''
                }`}
                style={{
                  left: `${s.left}%`,
                  top: `${s.top}%`,
                  width: `${s.size}px`,
                  height: `${s.size}px`,
                  opacity: s.isLarge ? 0.65 : 0.4,
                }}
              />
            ))}
          </div>
        </>
      )}

      <div
        className="absolute inset-0"
        style={
          !night
            ? {
                opacity: 0.035,
                backgroundImage:
                  'linear-gradient(rgba(255,255,255,0.55) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)',
                backgroundSize: '64px 64px',
              }
            : {
                opacity: 0.06,
                backgroundImage:
                  'radial-gradient(circle at center, rgba(255,255,255,0.04) 1px, transparent 1.5px)',
                backgroundSize: '32px 32px',
              }
        }
      />

      <div
        className={`absolute bottom-[26vh] left-0 right-0 h-28 opacity-45 blur-3xl ${
          night ? 'bg-teal-950/40' : 'bg-sky-300/50'
        }`}
      />

      {/* Асфальт без жёлтой анимированной разметки */}
      <div
        className="absolute bottom-0 left-0 right-0 h-[22vh] min-h-[100px]"
        style={{
          background: night
            ? 'linear-gradient(180deg,rgba(30,41,59,0.92) 0%,#020617 100%)'
            : 'linear-gradient(180deg,#64748b 0%,#1e293b 100%)',
          clipPath: 'polygon(5% 0,95% 0,100% 100%,0% 100%)',
        }}
      />
      <div
        className={`absolute bottom-[11vh] left-[14%] right-[14%] h-px ${
          night ? 'bg-slate-600/35' : 'bg-slate-400/40'
        }`}
      />
    </div>
  );
}

function DayCloud({ id, className = '' }) {
  const gid = `freight-cloud-grad-${id}`;
  return (
    <div className={`pointer-events-none absolute text-white/95 ${className}`} aria-hidden>
      <svg className="h-auto w-full drop-shadow-md" viewBox="0 0 200 80" fill="none">
        <path
          d="M28 58 Q12 58 12 44 Q12 28 32 26 Q36 10 58 12 Q72 4 92 14 Q112 6 132 22 Q158 14 176 34 Q196 38 188 58 Z"
          fill={`url(#${gid})`}
          fillOpacity="0.95"
        />
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="200" y2="80" gradientUnits="userSpaceOnUse">
            <stop stopColor="#ffffff" />
            <stop offset="1" stopColor="#e0f2fe" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}
