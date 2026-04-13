import { useId, useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

/** Луна: мягкий шар, «моря» через радиальные пятна + холодная тень (без плоских кругов) */
export function NightMoon({ className = '' }) {
  const uid = useId().replace(/:/g, '');
  return (
    <div className={`pointer-events-none absolute ${className}`} aria-hidden>
      <svg
        className="h-full w-full drop-shadow-[0_0_42px_rgba(45,212,191,0.18)]"
        viewBox="0 0 128 128"
      >
        <defs>
          <radialGradient id={`moon-body-${uid}`} cx="32%" cy="30%" r="78%">
            <stop offset="0%" stopColor="#f5f5f4" />
            <stop offset="42%" stopColor="#d6d3d1" />
            <stop offset="72%" stopColor="#a8a29e" />
            <stop offset="100%" stopColor="#78716c" />
          </radialGradient>
          <radialGradient id={`moon-lit-${uid}`} cx="28%" cy="26%" r="42%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.95)" />
            <stop offset="55%" stopColor="rgba(255,255,255,0.08)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
          <radialGradient id={`moon-shade-${uid}`} cx="78%" cy="58%" r="58%">
            <stop offset="0%" stopColor="rgba(15,23,42,0.55)" />
            <stop offset="45%" stopColor="rgba(30,41,59,0.28)" />
            <stop offset="100%" stopColor="rgba(15,23,42,0)" />
          </radialGradient>
          <radialGradient id={`moon-sea1-${uid}`} cx="40%" cy="48%" r="28%">
            <stop offset="0%" stopColor="rgba(87,83,78,0.55)" />
            <stop offset="70%" stopColor="rgba(120,113,108,0.22)" />
            <stop offset="100%" stopColor="rgba(120,113,108,0)" />
          </radialGradient>
          <radialGradient id={`moon-sea2-${uid}`} cx="68%" cy="52%" r="32%">
            <stop offset="0%" stopColor="rgba(68,64,60,0.5)" />
            <stop offset="65%" stopColor="rgba(87,83,78,0.18)" />
            <stop offset="100%" stopColor="rgba(87,83,78,0)" />
          </radialGradient>
          <radialGradient id={`moon-sea3-${uid}`} cx="52%" cy="72%" r="22%">
            <stop offset="0%" stopColor="rgba(68,64,60,0.42)" />
            <stop offset="100%" stopColor="rgba(68,64,60,0)" />
          </radialGradient>
          <radialGradient id={`moon-rim-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="88%" stopColor="rgba(255,255,255,0)" />
            <stop offset="96%" stopColor="rgba(204,251,241,0.35)" />
            <stop offset="100%" stopColor="rgba(148,163,184,0.25)" />
          </radialGradient>
          <filter id={`moon-blur-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="0.9" />
          </filter>
        </defs>
        <circle cx="64" cy="64" r="54" fill={`url(#moon-body-${uid})`} />
        <circle cx="64" cy="64" r="54" fill={`url(#moon-lit-${uid})`} />
        <g opacity="0.9" filter={`url(#moon-blur-${uid})`}>
          <ellipse cx="48" cy="50" rx="26" ry="20" fill={`url(#moon-sea1-${uid})`} />
          <ellipse cx="74" cy="58" rx="30" ry="22" fill={`url(#moon-sea2-${uid})`} />
          <ellipse cx="56" cy="78" rx="16" ry="12" fill={`url(#moon-sea3-${uid})`} />
        </g>
        <circle cx="64" cy="64" r="54" fill={`url(#moon-shade-${uid})`} />
        <circle cx="64" cy="64" r="54" fill="none" stroke={`url(#moon-rim-${uid})`} strokeWidth="1.2" />
      </svg>
    </div>
  );
}

function BlimpSvg({ large, isDay = false }) {
  const uid = useId().replace(/:/g, '');
  const w = large ? 220 : 118;
  const h = large ? 62 : 38;
  const rx = large ? 102 : 54;
  const ry = large ? 24 : 14;
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className={
        isDay
          ? 'opacity-[0.92] drop-shadow-[0_4px_14px_rgba(255,255,255,0.35)]'
          : 'opacity-[0.88] drop-shadow-[0_4px_14px_rgba(0,0,0,0.4)]'
      }
    >
      <defs>
        <linearGradient id={`bl-${uid}`} x1="0" y1="0" x2="0" y2="1">
          {isDay ? (
            <>
              <stop offset="0%" stopColor="#e2e8f0" />
              <stop offset="50%" stopColor="#cbd5e1" />
              <stop offset="100%" stopColor="#94a3b8" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#64748b" />
              <stop offset="50%" stopColor="#334155" />
              <stop offset="100%" stopColor="#1e293b" />
            </>
          )}
        </linearGradient>
      </defs>
      <ellipse cx={w / 2} cy={h / 2 - 2} rx={rx} ry={ry} fill={`url(#bl-${uid})`} stroke={isDay ? '#94a3b8' : '#64748b'} strokeWidth="1.2" />
      <ellipse cx={w / 2} cy={h / 2 - 2} rx={rx * 0.82} ry={ry * 0.58} fill={isDay ? '#f8fafc' : '#0f172a'} opacity={isDay ? 0.2 : 0.11} />
      <rect
        x={w / 2 - 28}
        y={h / 2 + 8}
        width="56"
        height="16"
        rx="3"
        fill={isDay ? '#f1f5f9' : '#1e293b'}
        stroke={isDay ? '#cbd5e1' : '#475569'}
        strokeWidth="1"
      />
      <rect x={w / 2 - 8} y={h / 2 + 12} width="12" height="7" rx="1" fill="#0ea5e9" opacity={isDay ? 0.45 : 0.32} />
      <circle cx={w * 0.22} cy={h / 2 - 2} r="2" fill="#ef4444" opacity={isDay ? 0.75 : 0.9} />
      <circle cx={w * 0.78} cy={h / 2 - 2} r="2" fill="#22c55e" opacity={isDay ? 0.7 : 0.85} />
    </svg>
  );
}

function WideBodySvg({ isDay = false }) {
  const uid = useId().replace(/:/g, '');
  const tops = Array.from({ length: 18 }, (_, i) => 38 + i * 6.2);
  const bots = Array.from({ length: 14 }, (_, i) => 44 + i * 6.8);
  const stroke = isDay ? '#cbd5e1' : '#64748b';
  return (
    <svg
      width="210"
      height="52"
      viewBox="0 0 210 52"
      className={isDay ? 'drop-shadow-[0_3px_12px_rgba(255,255,255,0.35)]' : 'drop-shadow-[0_3px_12px_rgba(0,0,0,0.5)]'}
    >
      <defs>
        <linearGradient id={`wb-${uid}`} x1="0" y1="0" x2="0" y2="1">
          {isDay ? (
            <>
              <stop offset="0%" stopColor="#f1f5f9" />
              <stop offset="45%" stopColor="#cbd5e1" />
              <stop offset="100%" stopColor="#94a3b8" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#64748b" />
              <stop offset="45%" stopColor="#1e293b" />
              <stop offset="100%" stopColor="#0f172a" />
            </>
          )}
        </linearGradient>
        <linearGradient id={`tr-${uid}`} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0%" stopColor="rgba(255,255,255,0)" />
          <stop offset="40%" stopColor="rgba(226,232,240,0.28)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.09)" />
        </linearGradient>
      </defs>
      <motion.path
        d="M0 26 L130 26"
        stroke={`url(#tr-${uid})`}
        strokeWidth="14"
        strokeLinecap="round"
        filter="blur(4px)"
        animate={{ opacity: [0.28, 0.48, 0.28] }}
        transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <path d="M52 26 L118 10 L138 26 L118 42 Z" fill={isDay ? '#e2e8f0' : '#334155'} stroke={stroke} strokeWidth="0.7" />
      <ellipse cx="118" cy="26" rx="88" ry="11" fill={`url(#wb-${uid})`} stroke={stroke} strokeWidth="0.9" />
      <path d="M198 26 L210 23 L210 29 Z" fill={isDay ? '#94a3b8' : '#0f172a'} />
      <path d="M28 26 L10 8 L10 44 Z" fill={isDay ? '#cbd5e1' : '#334155'} stroke={isDay ? '#94a3b8' : '#475569'} strokeWidth="0.5" />
      {tops.map((x, i) => (
        <rect key={`t-${i}`} x={x} y="20" width="3.2" height="4.5" rx="0.8" fill="#bae6fd" opacity={0.12 + (i % 5) * 0.04} />
      ))}
      {bots.map((x, i) => (
        <rect key={`b-${i}`} x={x} y="28" width="3.2" height="4.5" rx="0.8" fill="#7dd3fc" opacity={0.1 + (i % 4) * 0.035} />
      ))}
      <circle cx="52" cy="16" r="1.2" fill="#22c55e" opacity="0.95" />
      <circle cx="52" cy="36" r="1.2" fill="#ef4444" opacity="0.95" />
      <circle cx="200" cy="26" r="1.8" fill="#fbbf24" style={{ filter: 'drop-shadow(0 0 5px #fbbf24)' }} />
    </svg>
  );
}

function PrivatePlaneSvg({ isDay = false }) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg
      width="112"
      height="36"
      viewBox="0 0 112 36"
      className={isDay ? 'drop-shadow-[0_2px_8px_rgba(255,255,255,0.35)]' : 'drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]'}
    >
      <defs>
        <linearGradient id={`pp-${uid}`} x1="0" y1="0" x2="0" y2="1">
          {isDay ? (
            <>
              <stop offset="0%" stopColor="#f8fafc" />
              <stop offset="100%" stopColor="#cbd5e1" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#57534e" />
              <stop offset="100%" stopColor="#1c1917" />
            </>
          )}
        </linearGradient>
      </defs>
      <ellipse cx="54" cy="17" rx="48" ry="7" fill={`url(#pp-${uid})`} stroke={isDay ? '#e2e8f0' : '#78716c'} strokeWidth="0.7" />
      <path d="M30 17 L8 6 L8 28 Z" fill={isDay ? '#e2e8f0' : '#44403c'} stroke={isDay ? '#cbd5e1' : '#57534e'} strokeWidth="0.45" />
      <ellipse cx="54" cy="22" rx="10" ry="4" fill="#292524" opacity="0.5" />
      <circle cx="88" cy="14" r="2.5" fill="#0ea5e9" opacity="0.5" />
      <path d="M54 10 L62 4 L68 10" fill="none" stroke="#a8a29e" strokeWidth="1.2" />
      <path d="M54 24 L62 30 L68 24" fill="none" stroke="#a8a29e" strokeWidth="1.2" />
    </svg>
  );
}

/** Вертолёт: фюзеляж + хвост + полозья; несущий винт и хвостовой — сверху по z-order SVG */
function HelicopterSvg({ reduceMotion, isDay = false }) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg
      width="128"
      height="48"
      viewBox="0 0 128 48"
      className={isDay ? 'drop-shadow-[0_3px_12px_rgba(255,255,255,0.38)]' : 'drop-shadow-[0_3px_12px_rgba(0,0,0,0.5)]'}
    >
      <defs>
        <linearGradient id={`hx-${uid}`} x1="0" y1="0" x2="0" y2="1">
          {isDay ? (
            <>
              <stop offset="0%" stopColor="#e2e8f0" />
              <stop offset="100%" stopColor="#94a3b8" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#64748b" />
              <stop offset="100%" stopColor="#1e293b" />
            </>
          )}
        </linearGradient>
      </defs>
      {/* кабина и нос */}
      <ellipse cx="46" cy="24" rx="26" ry="10" fill={`url(#hx-${uid})`} stroke="#475569" strokeWidth="0.9" />
      <path
        d="M22 24 L8 18 L8 30 Z"
        fill={isDay ? '#cbd5e1' : '#334155'}
        stroke={isDay ? '#94a3b8' : '#475569'}
        strokeWidth="0.5"
      />
      {/* хвостовая балка */}
      <path
        d="M72 23 L108 21 L108 27 L72 25 Z"
        fill={isDay ? '#e2e8f0' : '#334155'}
        stroke={isDay ? '#cbd5e1' : '#475569'}
        strokeWidth="0.45"
      />
      <path d="M108 21 L118 17 L118 31 L108 27 Z" fill={isDay ? '#cbd5e1' : '#1e293b'} />
      {/* полозья */}
      <path
        d="M34 32 L34 38 M58 32 L58 38"
        stroke={isDay ? '#94a3b8' : '#475569'}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <line
        x1="30"
        y1="38"
        x2="62"
        y2="38"
        stroke={isDay ? '#cbd5e1' : '#64748b'}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      {/* хвостовой винт */}
      <motion.g transform="translate(114,24)">
        <motion.g
          animate={reduceMotion ? {} : { rotate: [0, 360] }}
          transition={{ duration: 0.85, repeat: Infinity, ease: 'linear' }}
        >
          <line x1="-5" y1="0" x2="5" y2="0" stroke="#94a3b8" strokeWidth="1.4" />
          <line x1="0" y1="-5" x2="0" y2="5" stroke="#94a3b8" strokeWidth="1.4" />
        </motion.g>
      </motion.g>
      {/* несущий винт — поверх корпуса */}
      <g transform="translate(46,11)">
        <ellipse cx="0" cy="0" rx="52" ry="3.5" fill="rgba(148,163,184,0.35)" opacity="0.9" />
        <motion.g
          animate={reduceMotion ? {} : { rotate: [0, 360] }}
          transition={{ duration: 1.35, repeat: Infinity, ease: 'linear' }}
        >
          <line x1="-48" y1="0" x2="48" y2="0" stroke="#e2e8f0" strokeWidth="2.8" strokeLinecap="round" opacity="0.92" />
          <line x1="0" y1="-48" x2="0" y2="48" stroke="#cbd5e1" strokeWidth="1.8" strokeLinecap="round" opacity="0.55" />
        </motion.g>
      </g>
      <circle cx="46" cy="24" r="2.2" fill="#38bdf8" opacity="0.35" />
    </svg>
  );
}

function FlyAcross({ top, durationSec, children }) {
  return (
    <div className="pointer-events-none absolute left-0 w-full" style={{ top }}>
      <motion.div
        className="relative will-change-transform scale-[1.12] sm:scale-[1.15]"
        style={{ left: '-18%' }}
        initial={{ x: '0vw' }}
        animate={{ x: ['0vw', '128vw'] }}
        transition={{ duration: durationSec, ease: 'linear', repeat: Infinity }}
      >
        {children}
      </motion.div>
    </div>
  );
}

/**
 * Один тип воздушного объекта за раз, смена ~30 с — без перегрузки неба.
 * При prefers-reduced-motion — статичный крупный дирижабль.
 */
function SkyFleet({ isDay = false }) {
  const reduce = useReducedMotion();
  const [slot, setSlot] = useState(0);

  useEffect(() => {
    if (reduce) return undefined;
    const id = setInterval(() => setSlot((s) => (s + 1) % 5), 30_000);
    return () => clearInterval(id);
  }, [reduce]);

  if (reduce) {
    return (
      <div
        className={`pointer-events-none absolute left-[10%] top-[14%] z-[6] scale-110 ${isDay ? 'opacity-85' : 'opacity-75'}`}
      >
        <BlimpSvg large isDay={isDay} />
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-[6] overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.div
          key={slot}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.9 }}
          className="absolute inset-0"
        >
          {slot === 0 && (
            <FlyAcross top="12%" durationSec={92}>
              <BlimpSvg large isDay={isDay} />
            </FlyAcross>
          )}
          {slot === 1 && (
            <FlyAcross top="17%" durationSec={74}>
              <BlimpSvg large={false} isDay={isDay} />
            </FlyAcross>
          )}
          {slot === 2 && (
            <FlyAcross top="10%" durationSec={58}>
              <WideBodySvg isDay={isDay} />
            </FlyAcross>
          )}
          {slot === 3 && (
            <FlyAcross top="18%" durationSec={46}>
              <PrivatePlaneSvg isDay={isDay} />
            </FlyAcross>
          )}
          {slot === 4 && (
            <FlyAcross top="14%" durationSec={52}>
              <HelicopterSvg reduceMotion={false} isDay={isDay} />
            </FlyAcross>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export function NightPlanes() {
  return <SkyFleet isDay={false} />;
}

/** Дневной небесный флот — те же слоты, светлые силуэты под голубое небо */
export function DayPlanes() {
  return <SkyFleet isDay />;
}

/** Совместимость: отдельный «вечный» дирижабль не используется в NightPlanes; оставлен для импортов. */
export function NightBlimp() {
  return (
    <div className="pointer-events-none absolute left-[8%] top-[15%] z-[2] opacity-75">
      <BlimpSvg large />
    </div>
  );
}

/** Дневное солнце — мягкое ядро и широкий диффузный ореол (без «шарика») */
export function DaySun({ className = '' }) {
  const uid = useId().replace(/:/g, '');
  return (
    <div className={`pointer-events-none absolute ${className}`} aria-hidden>
      <svg className="h-full w-full" viewBox="0 0 140 140">
        <defs>
          <radialGradient id={`sun-outer-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(254,249,195,0.55)" />
            <stop offset="35%" stopColor="rgba(253,230,138,0.22)" />
            <stop offset="65%" stopColor="rgba(125,211,252,0.08)" />
            <stop offset="100%" stopColor="rgba(125,211,252,0)" />
          </radialGradient>
          <radialGradient id={`sun-mid-${uid}`} cx="42%" cy="40%" r="55%">
            <stop offset="0%" stopColor="rgba(255,251,235,0.95)" />
            <stop offset="40%" stopColor="rgba(254,240,138,0.75)" />
            <stop offset="75%" stopColor="rgba(251,191,36,0.35)" />
            <stop offset="100%" stopColor="rgba(251,146,60,0.12)" />
          </radialGradient>
          <radialGradient id={`sun-core-${uid}`} cx="45%" cy="42%" r="35%">
            <stop offset="0%" stopColor="#fffef9" />
            <stop offset="50%" stopColor="#fff7c2" />
            <stop offset="100%" stopColor="#fde68a" />
          </radialGradient>
        </defs>
        <circle cx="70" cy="70" r="64" fill={`url(#sun-outer-${uid})`} />
        <circle cx="70" cy="70" r="44" fill={`url(#sun-mid-${uid})`} />
        <circle cx="70" cy="70" r="22" fill={`url(#sun-core-${uid})`} />
      </svg>
    </div>
  );
}

/** Дополнительные мягкие облака для логина (день) */
export function DayCloudsExtra() {
  const reduce = useReducedMotion();
  const t = reduce
    ? { duration: 0 }
    : { duration: 38, repeat: Infinity, ease: 'easeInOut' };
  return (
    <>
      <motion.div
        className="pointer-events-none absolute left-[4%] top-[14%] h-10 w-[min(48vw,20rem)] rounded-[100%] bg-white/40 blur-xl"
        animate={reduce ? {} : { x: [0, 22, 0], opacity: [0.55, 0.72, 0.55] }}
        transition={t}
        aria-hidden
      />
      <motion.div
        className="pointer-events-none absolute right-[6%] top-[20%] h-12 w-[min(42vw,17rem)] rounded-[100%] bg-sky-100/50 blur-2xl"
        animate={reduce ? {} : { x: [0, -16, 0] }}
        transition={{ ...t, duration: 44, delay: 2 }}
        aria-hidden
      />
      <motion.div
        className="pointer-events-none absolute left-[28%] top-[8%] h-8 w-[min(56vw,22rem)] rounded-[100%] bg-white/32 blur-lg"
        animate={reduce ? {} : { x: [0, 14, 0], opacity: [0.4, 0.58, 0.4] }}
        transition={{ ...t, duration: 52, delay: 1 }}
        aria-hidden
      />
      <motion.div
        className="pointer-events-none absolute right-[18%] top-[11%] h-9 w-[min(36vw,15rem)] rounded-[100%] bg-white/38 blur-xl"
        animate={reduce ? {} : { x: [0, -10, 0], opacity: [0.45, 0.62, 0.45] }}
        transition={{ ...t, duration: 48, delay: 0.5 }}
        aria-hidden
      />
      <motion.div
        className="pointer-events-none absolute left-[48%] top-[18%] h-11 w-[min(44vw,18rem)] rounded-[100%] bg-sky-50/45 blur-2xl"
        animate={reduce ? {} : { x: [0, 12, 0] }}
        transition={{ ...t, duration: 56, delay: 3 }}
        aria-hidden
      />
    </>
  );
}

export function NightClouds() {
  const reduce = useReducedMotion();
  const common = 'pointer-events-none absolute rounded-[100%]';
  if (reduce) {
    return (
      <>
        <div className={`${common} left-[4%] top-[18%] h-14 w-[min(42vw,18rem)] bg-slate-400/[0.08] blur-2xl`} aria-hidden />
        <div className={`${common} right-[8%] top-[24%] h-12 w-[min(36vw,15rem)] bg-slate-300/[0.07] blur-2xl`} aria-hidden />
      </>
    );
  }
  return (
    <>
      <motion.div
        className={`${common} left-[4%] top-[18%] h-14 w-[min(42vw,18rem)] bg-slate-400/[0.08] blur-2xl`}
        animate={{ x: [0, 18, 0], opacity: [0.45, 0.65, 0.45] }}
        transition={{ duration: 48, repeat: Infinity, ease: 'easeInOut' }}
        aria-hidden
      />
      <motion.div
        className={`${common} right-[8%] top-[24%] h-12 w-[min(36vw,15rem)] bg-slate-300/[0.07] blur-2xl`}
        animate={{ x: [0, -14, 0], opacity: [0.4, 0.58, 0.4] }}
        transition={{ duration: 56, repeat: Infinity, ease: 'easeInOut', delay: 4 }}
        aria-hidden
      />
      <motion.div
        className={`${common} left-[28%] top-[10%] h-10 w-[min(48vw,20rem)] bg-sky-900/[0.09] blur-3xl`}
        animate={{ x: [0, 12, 0] }}
        transition={{ duration: 62, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
        aria-hidden
      />
      <motion.div
        className={`${common} right-[22%] top-[32%] h-20 w-[min(55vw,22rem)] bg-slate-500/[0.05] blur-3xl`}
        animate={{ x: [0, -10, 0], opacity: [0.35, 0.5, 0.35] }}
        transition={{ duration: 70, repeat: Infinity, ease: 'easeInOut', delay: 8 }}
        aria-hidden
      />
    </>
  );
}

export function ShootingStar() {
  const reduce = useReducedMotion();
  if (reduce) return null;
  return (
    <motion.div
      className="pointer-events-none absolute left-[20%] top-[16%] h-px w-20 origin-left opacity-0"
      style={{
        background: 'linear-gradient(90deg, rgba(255,255,255,0.95), transparent)',
        boxShadow: '0 0 10px rgba(255,255,255,0.65)',
        rotate: '-35deg',
      }}
      animate={{ opacity: [0, 1, 0], x: [0, 140], y: [0, 70] }}
      transition={{ duration: 1.1, repeat: Infinity, repeatDelay: 19, ease: 'easeOut' }}
      aria-hidden
    />
  );
}
