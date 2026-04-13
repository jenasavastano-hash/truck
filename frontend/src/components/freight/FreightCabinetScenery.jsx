import { motion, AnimatePresence } from 'framer-motion';

/**
 * Мультяшные фоны кабинетов: роль + вкладка — разные «игрушечные» сцены (SVG, без картинок).
 */

function Sun({ className = '' }) {
  return (
    <div className={`pointer-events-none absolute cartoon-float-slow ${className}`} aria-hidden>
      <svg className="h-24 w-24 drop-shadow-lg md:h-32 md:w-32" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="38" fill="#fde047" stroke="#ca8a04" strokeWidth="4" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <rect
            key={deg}
            x="56"
            y="4"
            width="8"
            height="18"
            rx="3"
            fill="#facc15"
            stroke="#ca8a04"
            strokeWidth="2"
            transform={`rotate(${deg} 60 60)`}
          />
        ))}
        <circle cx="52" cy="54" r="5" fill="#422006" opacity="0.35" />
        <path d="M44 68 Q60 76 76 68" fill="none" stroke="#422006" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function Moon({ className = '' }) {
  return (
    <div className={`pointer-events-none absolute cartoon-bob ${className}`} aria-hidden>
      <svg className="h-20 w-20 drop-shadow-lg md:h-28 md:w-28" viewBox="0 0 100 100">
        <circle cx="55" cy="45" r="32" fill="#fef9c3" stroke="#a16207" strokeWidth="4" />
        <circle cx="68" cy="42" r="28" fill="#1e1b4b" />
        <circle cx="48" cy="58" r="4" fill="#ca8a04" opacity="0.4" />
        <circle cx="62" cy="52" r="3" fill="#ca8a04" opacity="0.35" />
      </svg>
    </div>
  );
}

function Cloud({ className = '', delay = 0 }) {
  return (
    <motion.div
      className={`pointer-events-none absolute ${className}`}
      aria-hidden
      animate={{ x: [0, 12, 0] }}
      transition={{ duration: 8 + delay, repeat: Infinity, ease: 'easeInOut', delay }}
    >
      <svg className="h-16 w-28 md:h-20 md:w-36" viewBox="0 0 140 70">
        <path
          d="M20 48 Q10 48 10 38 Q10 22 28 22 Q32 10 52 12 Q68 4 88 14 Q108 8 122 24 Q138 28 128 48 Z"
          fill="#ffffff"
          stroke="#94a3b8"
          strokeWidth="3"
        />
      </svg>
    </motion.div>
  );
}

function Hills({ variant = 'green', className = '' }) {
  const fill =
    variant === 'pink'
      ? '#f9a8d4'
      : variant === 'night'
        ? '#312e81'
        : variant === 'mint'
          ? '#6ee7b7'
          : '#4ade80';
  const stroke = variant === 'night' ? '#1e1b4b' : '#166534';
  return (
    <svg
      className={`pointer-events-none absolute bottom-[32vh] left-0 right-0 h-32 w-full md:bottom-[30vh] md:h-40 ${className}`}
      viewBox="0 0 400 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d="M0 80 Q80 20 160 60 T320 50 T400 70 V100 H0 Z" fill={fill} stroke={stroke} strokeWidth="4" />
      <path d="M-20 95 Q100 40 220 75 T420 85 V100 H-20 Z" fill={fill} opacity="0.85" stroke={stroke} strokeWidth="3" />
    </svg>
  );
}

function CartoonRoad({ stripe = 'yellow' }) {
  const stripeColor = stripe === 'white' ? 'rgba(255,255,255,0.9)' : 'rgba(250,204,21,0.95)';
  return (
    <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-[28vh] min-h-[140px]" aria-hidden>
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(180deg,#475569 0%,#1e293b 55%,#0f172a 100%)',
          clipPath: 'polygon(4% 8%, 96% 2%, 100% 100%, 0% 100%)',
        }}
      />
      <div
        className="absolute bottom-[10vh] left-[18%] right-[18%] h-2 overflow-hidden rounded-full opacity-95"
        style={{
          background: `repeating-linear-gradient(90deg, ${stripeColor} 0, ${stripeColor} 24px, transparent 24px, transparent 48px)`,
        }}
      />
    </div>
  );
}

function ToyTruck({ color = '#ef4444', className = '', mirror }) {
  const cab = color;
  const trailer = '#e2e8f0';
  return (
    <div
      className={`pointer-events-none absolute bottom-[14vh] cartoon-wiggle ${className}`}
      style={{ transform: mirror ? 'scaleX(-1)' : undefined }}
      aria-hidden
    >
      <svg className="h-20 w-44 md:h-24 md:w-52" viewBox="0 0 200 90">
        <rect x="8" y="38" width="118" height="38" rx="6" fill={trailer} stroke="#0f172a" strokeWidth="3" />
        <rect x="128" y="22" width="52" height="54" rx="8" fill={cab} stroke="#0f172a" strokeWidth="3" />
        <rect x="138" y="30" width="28" height="18" rx="3" fill="#bae6fd" stroke="#0f172a" strokeWidth="2" />
        <circle cx="38" cy="82" r="14" fill="#1e293b" stroke="#0f172a" strokeWidth="3" />
        <circle cx="38" cy="82" r="6" fill="#94a3b8" />
        <circle cx="100" cy="82" r="14" fill="#1e293b" stroke="#0f172a" strokeWidth="3" />
        <circle cx="100" cy="82" r="6" fill="#94a3b8" />
        <circle cx="168" cy="82" r="14" fill="#1e293b" stroke="#0f172a" strokeWidth="3" />
        <circle cx="168" cy="82" r="6" fill="#94a3b8" />
        <rect x="20" y="44" width="36" height="14" rx="2" fill="#fbbf24" stroke="#0f172a" strokeWidth="2" />
      </svg>
    </div>
  );
}

function ToyBlocks({ className = '' }) {
  return (
    <div className={`pointer-events-none absolute bottom-[36vh] flex gap-2 ${className}`} aria-hidden>
      {[
        { bg: '#f472b6', t: 'А' },
        { bg: '#60a5fa', t: 'Б' },
        { bg: '#4ade80', t: 'В' },
      ].map((b, i) => (
        <motion.div
          key={b.t}
          className="flex h-14 w-14 items-center justify-center rounded-lg border-4 border-slate-900 text-xl font-black text-white shadow-lg md:h-16 md:w-16 md:text-2xl"
          style={{ backgroundColor: b.bg }}
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.2 }}
        >
          {b.t}
        </motion.div>
      ))}
    </div>
  );
}

function Rainbow({ className = '' }) {
  const bands = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7'];
  return (
    <svg className={`pointer-events-none absolute h-40 w-72 md:h-48 md:w-96 ${className}`} viewBox="0 0 240 120" aria-hidden>
      {bands.map((c, i) => (
        <path
          key={c}
          d={`M ${20 + i * 6} 110 A ${100 - i * 8} ${100 - i * 8} 0 0 1 ${220 - i * 6} 110`}
          fill="none"
          stroke={c}
          strokeWidth="10"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

function RadioToy({ className = '' }) {
  return (
    <div className={`pointer-events-none absolute cartoon-bob ${className}`} aria-hidden>
      <svg className="h-28 w-28 md:h-36 md:w-36" viewBox="0 0 100 100">
        <rect x="18" y="32" width="64" height="48" rx="10" fill="#fcd34d" stroke="#0f172a" strokeWidth="3" />
        <circle cx="50" cy="56" r="16" fill="#38bdf8" stroke="#0f172a" strokeWidth="3" />
        <circle cx="50" cy="56" r="6" fill="#fff" />
        <path d="M38 24 L50 32 L62 24" fill="none" stroke="#0f172a" strokeWidth="4" strokeLinecap="round" />
        <motion.g animate={{ rotate: [0, 15, -15, 0] }} transition={{ duration: 3, repeat: Infinity }}>
          <line x1="78" y1="44" x2="94" y2="36" stroke="#0f172a" strokeWidth="4" strokeLinecap="round" />
        </motion.g>
      </svg>
    </div>
  );
}

function ChartToy({ className = '' }) {
  return (
    <div className={`pointer-events-none absolute flex items-end gap-3 ${className}`} aria-hidden>
      {[['#60a5fa', 40], ['#f472b6', 64], ['#4ade80', 52]].map(([c, h], i) => (
        <motion.div
          key={i}
          className="w-10 rounded-t-lg border-4 border-slate-900 shadow-md md:w-12"
          style={{ backgroundColor: c, height: h }}
          animate={{ height: [h, h + 12, h] }}
          transition={{ duration: 2.5, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </div>
  );
}

function CoinsToy({ className = '' }) {
  return (
    <div className={`pointer-events-none absolute ${className}`} aria-hidden>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="absolute h-12 w-12 rounded-full border-4 border-amber-900 bg-gradient-to-br from-amber-200 to-amber-500 shadow-lg"
          style={{ left: i * 18, top: i * -6, zIndex: 3 - i }}
        />
      ))}
    </div>
  );
}

function KiddieStars({ count = 18 }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className="absolute text-lg text-amber-200 opacity-80 cartoon-float-slow"
          style={{
            left: `${(i * 47) % 92}%`,
            top: `${(i * 31) % 40}%`,
            animationDelay: `${(i % 7) * 0.4}s`,
          }}
        >
          ★
        </span>
      ))}
    </div>
  );
}

function PolkaDots({ color = 'rgba(255,255,255,0.35)' }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 opacity-50"
      style={{
        backgroundImage: `radial-gradient(circle at center, ${color} 3px, transparent 3.5px)`,
        backgroundSize: '28px 28px',
      }}
      aria-hidden
    />
  );
}

function ScanGrid() {
  return (
    <div
      className="pointer-events-none absolute inset-0 opacity-30"
      style={{
        backgroundImage:
          'linear-gradient(rgba(52,211,153,0.5) 2px, transparent 2px), linear-gradient(90deg, rgba(52,211,153,0.5) 2px, transparent 2px)',
        backgroundSize: '36px 36px',
      }}
      aria-hidden
    />
  );
}

function WindowToy({ children }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 opacity-40 md:p-10" aria-hidden>
      <div className="relative h-full max-h-[65vh] w-full max-w-4xl rounded-3xl border-[14px] border-amber-900/40 bg-sky-200/30 shadow-2xl">
        <div className="absolute inset-3 rounded-2xl border-4 border-white/50" />
        {children}
      </div>
    </div>
  );
}

function MailboxToy({ className = '' }) {
  return (
    <div className={`pointer-events-none absolute cartoon-wiggle ${className}`} aria-hidden>
      <svg className="h-32 w-24" viewBox="0 0 80 100">
        <rect x="8" y="28" width="64" height="56" rx="8" fill="#3b82f6" stroke="#0f172a" strokeWidth="4" />
        <polygon points="8,28 40,8 72,28" fill="#60a5fa" stroke="#0f172a" strokeWidth="4" />
        <rect x="28" y="44" width="24" height="16" rx="3" fill="#fef08a" stroke="#0f172a" strokeWidth="2" />
        <rect x="36" y="88" width="8" height="12" fill="#78350f" />
      </svg>
    </div>
  );
}

function FactoryToy({ night }) {
  return (
    <svg
      className={`pointer-events-none absolute bottom-[34vh] left-[6%] h-24 w-40 md:h-28 md:w-48 ${night ? 'text-indigo-300' : 'text-slate-600'}`}
      viewBox="0 0 160 80"
      aria-hidden
    >
      <rect x="10" y="30" width="50" height="48" fill="currentColor" stroke="#0f172a" strokeWidth="3" rx="4" />
      <rect x="70" y="18" width="80" height="60" fill="currentColor" stroke="#0f172a" strokeWidth="3" rx="4" />
      <rect x="95" y="8" width="14" height="14" fill="#fbbf24" stroke="#0f172a" strokeWidth="2" />
      <motion.path
        d="M100 8 Q108 2 116 8"
        fill="none"
        stroke="#cbd5e1"
        strokeWidth="4"
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 2, repeat: Infinity }}
      />
    </svg>
  );
}

/** @typedef {{ sky: string; ground: string; groundClip?: string; recipe: string }} Preset */

const RECIPE = {
  /** @param {Preset} p */
  render(p) {
    switch (p.recipe) {
      case 'sunset_window':
        return (
          <>
            <Sun className="right-[8%] top-[6%]" />
            <Cloud className="left-[10%] top-[14%]" />
            <Cloud className="left-[40%] top-[20%]" delay={1} />
            <WindowToy>
              <div className="absolute inset-0 bg-gradient-to-br from-sky-300/50 via-amber-200/40 to-fuchsia-300/40" />
            </WindowToy>
            <Hills variant="pink" />
            <CartoonRoad stripe="yellow" />
            <ToyTruck color="#f97316" className="right-[12%]" />
          </>
        );
      case 'sun_highway':
        return (
          <>
            <Sun className="left-[6%] top-[8%]" />
            <Cloud className="right-[12%] top-[18%]" />
            <Hills variant="green" />
            <PolkaDots color="rgba(255,255,255,0.2)" />
            <CartoonRoad />
            <ToyTruck color="#0ea5e9" className="left-[8%]" />
            <ToyBlocks className="right-[10%]" />
          </>
        );
      case 'violet_drivers':
        return (
          <>
            <Moon className="right-[10%] top-[10%]" />
            <KiddieStars count={14} />
            <Hills variant="night" />
            <CartoonRoad stripe="white" />
            <ToyTruck color="#a78bfa" className="right-[14%]" mirror />
          </>
        );
      case 'rainbow_radio':
        return (
          <>
            <Rainbow className="left-[4%] top-[6%]" />
            <Sun className="right-[6%] top-[10%]" />
            <Cloud className="right-[30%] top-[22%]" />
            <RadioToy className="left-[8%] bottom-[38vh]" />
            <Hills variant="mint" />
            <CartoonRoad />
            <ToyTruck color="#ec4899" className="right-[10%]" />
          </>
        );
      case 'sky_mailbox':
        return (
          <>
            <div className="absolute inset-0 bg-gradient-to-b from-sky-300/30 to-transparent" />
            <Cloud className="left-[15%] top-[12%]" />
            <Cloud className="left-[55%] top-[18%]" delay={0.8} />
            <MailboxToy className="right-[12%] bottom-[40vh]" />
            <Hills variant="green" />
            <CartoonRoad />
          </>
        );
      case 'scan_fc':
        return (
          <>
            <ScanGrid />
            <Sun className="right-[8%] top-[8%]" />
            <motion.div
              className="pointer-events-none absolute left-1/2 top-[20%] h-16 w-16 -translate-x-1/2 rounded-full border-8 border-emerald-400 bg-emerald-200 shadow-xl"
              animate={{ scale: [1, 1.08, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
            <Hills variant="mint" />
            <CartoonRoad />
            <ToyTruck color="#10b981" className="left-[10%]" />
          </>
        );
      case 'stats_chart':
        return (
          <>
            <PolkaDots color="rgba(59,130,246,0.25)" />
            <Sun className="left-[10%] top-[6%]" />
            <ChartToy className="right-[8%] bottom-[38vh]" />
            <Hills variant="green" />
            <CartoonRoad />
            <ToyTruck color="#6366f1" className="right-[12%]" />
          </>
        );
      case 'gold_finance':
        return (
          <>
            <Sun className="right-[6%] top-[4%]" />
            <CoinsToy className="left-[10%] bottom-[40vh]" />
            <Hills variant="pink" />
            <CartoonRoad />
            <ToyBlocks className="right-[8%]" />
          </>
        );
      case 'manager_night_run':
        return (
          <>
            <Moon className="left-[8%] top-[10%]" />
            <KiddieStars count={22} />
            <FactoryToy night />
            <Hills variant="night" />
            <CartoonRoad stripe="white" />
            <ToyTruck color="#22d3ee" className="right-[10%]" mirror />
          </>
        );
      case 'manager_teal_speed':
        return (
          <>
            <Sun className="right-[5%] top-[12%]" />
            <div
              className="pointer-events-none absolute inset-0 opacity-25"
              style={{
                background: 'repeating-linear-gradient(-12deg, transparent, transparent 40px, rgba(34,211,238,0.35) 40px, rgba(34,211,238,0.35) 42px)',
              }}
            />
            <Hills variant="mint" />
            <CartoonRoad />
            <ToyTruck color="#14b8a6" className="left-[6%]" />
            <ToyBlocks className="right-[6%]" />
          </>
        );
      case 'admin_command':
        return (
          <>
            <ScanGrid />
            <div className="absolute left-[8%] top-[20%] h-20 w-20 rounded-2xl border-4 border-slate-900 bg-amber-300 shadow-xl cartoon-wiggle" />
            <Hills variant="night" />
            <CartoonRoad stripe="white" />
            <ToyTruck color="#f59e0b" className="right-[8%]" />
          </>
        );
      case 'admin_docs':
        return (
          <>
            <Cloud className="left-[12%] top-[14%]" />
            <Cloud className="left-[48%] top-[20%]" delay={1} />
            <div className="pointer-events-none absolute right-[10%] top-[24%] h-24 w-20 rounded-lg border-4 border-slate-900 bg-white shadow-lg cartoon-float-slow">
              <div className="m-2 space-y-2">
                <div className="h-2 rounded bg-slate-300" />
                <div className="h-2 rounded bg-slate-300" />
                <div className="h-2 w-10 rounded bg-slate-300" />
              </div>
            </div>
            <Hills variant="green" />
            <CartoonRoad />
          </>
        );
      case 'admin_evac':
        return (
          <>
            <Sun className="left-[6%] top-[8%]" />
            <div className="pointer-events-none absolute right-[12%] bottom-[42vh] text-6xl cartoon-bob">🧸</div>
            <Hills variant="pink" />
            <CartoonRoad />
            <ToyTruck color="#fb923c" className="right-[10%]" />
          </>
        );
      case 'admin_flag':
        return (
          <>
            <Rainbow className="right-[0%] top-[4%] opacity-90" />
            <Sun className="left-[8%] top-[6%]" />
            <Hills variant="mint" />
            <CartoonRoad />
            <ToyTruck color="#ef4444" className="left-[8%]" />
          </>
        );
      case 'home_welcome':
        return (
          <>
            <Sun className="left-[4%] top-[6%]" />
            <Rainbow className="right-[2%] top-[4%] opacity-80" />
            <Cloud className="left-[20%] top-[16%]" />
            <Cloud className="left-[50%] top-[22%]" delay={0.7} />
            <Hills variant="green" />
            <CartoonRoad />
            <ToyTruck color="#3b82f6" className="right-[10%]" />
            <ToyBlocks className="left-[8%]" />
          </>
        );
      case 'home_card_admin':
        return (
          <>
            <ScanGrid />
            <Sun className="right-[6%] top-[8%]" />
            <Hills variant="night" />
            <CartoonRoad />
            <ToyTruck color="#64748b" className="left-[10%]" />
          </>
        );
      case 'home_card_manager':
        return (
          <>
            <Sun className="left-[8%] top-[10%]" />
            <div
              className="pointer-events-none absolute inset-0 opacity-20"
              style={{
                background: 'repeating-linear-gradient(90deg, rgba(45,212,191,0.4) 0, rgba(45,212,191,0.4) 3px, transparent 3px, transparent 28px)',
              }}
            />
            <Hills variant="mint" />
            <CartoonRoad />
            <ToyTruck color="#2dd4bf" className="right-[12%]" />
          </>
        );
      case 'home_card_director':
        return (
          <>
            <WindowToy>
              <div className="absolute inset-0 bg-gradient-to-t from-amber-200/50 to-sky-300/40" />
            </WindowToy>
            <Sun className="right-[5%] top-[6%]" />
            <Hills variant="pink" />
            <CartoonRoad />
            <ToyTruck color="#f97316" className="left-[6%]" />
          </>
        );
      case 'home_card_driver':
        return (
          <>
            <Moon className="right-[8%] top-[12%]" />
            <KiddieStars count={16} />
            <Hills variant="night" />
            <CartoonRoad stripe="white" />
            <ToyTruck color="#a855f7" className="right-[8%]" />
          </>
        );
      case 'home_card_evac':
        return (
          <>
            <Sun className="left-[5%] top-[6%]" />
            <div className="pointer-events-none absolute right-[10%] top-[28%] text-5xl cartoon-float-slow">🚛</div>
            <Hills variant="pink" />
            <CartoonRoad />
            <ToyTruck color="#ea580c" className="left-[10%]" />
          </>
        );
      case 'home_card_commissioner':
        return (
          <>
            <div className="pointer-events-none absolute left-[8%] top-[20%] h-16 w-16 rounded-full border-4 border-red-700 bg-red-400 shadow-lg cartoon-spin-slow" />
            <Sun className="right-[10%] top-[8%]" />
            <Hills variant="green" />
            <CartoonRoad />
            <ToyTruck color="#dc2626" className="right-[10%]" mirror />
          </>
        );
      case 'admin_radar':
        return (
          <>
            <PolkaDots color="rgba(16,185,129,0.2)" />
            <Sun className="left-[6%] top-[8%]" />
            <svg className="pointer-events-none absolute right-[8%] top-[18%] h-32 w-32 text-emerald-400/50" viewBox="0 0 100 100" aria-hidden>
              {[1, 2, 3, 4].map((i) => (
                <circle key={i} cx="50" cy="50" r={i * 12} fill="none" stroke="currentColor" strokeWidth="3" />
              ))}
            </svg>
            <Hills variant="mint" />
            <CartoonRoad />
            <ToyTruck color="#22c55e" className="right-[10%]" />
          </>
        );
      default:
        return (
          <>
            <Sun className="right-[8%] top-[10%]" />
            <Cloud className="left-[12%] top-[18%]" />
            <Hills variant="green" />
            <CartoonRoad />
            <ToyTruck color="#0ea5e9" className="left-[10%]" />
          </>
        );
    }
  },
};

/** Ключ сцены: роль + вкладка — у каждого свой «детсадовский» градиент и набор слоёв */
function resolvePreset(role, scene) {
  const key = `${role}:${scene}`;
  /** @type {Record<string, Preset>} */
  const presets = {
    'director:park-pick': {
      sky: 'from-pink-300 via-amber-200 to-sky-400',
      ground: 'from-fuchsia-600 via-pink-500 to-rose-700',
      recipe: 'sunset_window',
    },
    'director:fleet': {
      sky: 'from-orange-300 via-amber-200 to-cyan-300',
      ground: 'from-emerald-600 via-teal-600 to-slate-900',
      recipe: 'sun_highway',
    },
    'director:drivers': {
      sky: 'from-violet-400 via-purple-300 to-indigo-500',
      ground: 'from-indigo-800 via-violet-900 to-slate-950',
      recipe: 'violet_drivers',
    },
    'director:broadcasts': {
      sky: 'from-fuchsia-300 via-yellow-200 to-sky-300',
      ground: 'from-pink-500 via-fuchsia-600 to-purple-900',
      recipe: 'rainbow_radio',
    },
    'director:broadcast-inbox': {
      sky: 'from-sky-300 via-cyan-200 to-indigo-300',
      ground: 'from-blue-600 via-sky-700 to-slate-900',
      recipe: 'sky_mailbox',
    },
    'director:fc': {
      sky: 'from-emerald-300 via-lime-200 to-teal-400',
      ground: 'from-emerald-700 via-green-800 to-slate-950',
      recipe: 'scan_fc',
    },
    'director:stats': {
      sky: 'from-blue-300 via-indigo-200 to-violet-300',
      ground: 'from-indigo-700 via-blue-800 to-slate-950',
      recipe: 'stats_chart',
    },
    'director:finance': {
      sky: 'from-amber-300 via-yellow-200 to-lime-200',
      ground: 'from-amber-600 via-yellow-700 to-stone-900',
      recipe: 'gold_finance',
    },
    'manager:park-pick': {
      sky: 'from-indigo-400 via-slate-800 to-violet-950',
      ground: 'from-slate-800 via-indigo-950 to-black',
      recipe: 'manager_night_run',
    },
    'manager:fleet': {
      sky: 'from-cyan-400 via-teal-300 to-blue-500',
      ground: 'from-teal-700 via-cyan-800 to-slate-950',
      recipe: 'manager_teal_speed',
    },
    'manager:drivers': {
      sky: 'from-blue-500 via-indigo-400 to-slate-900',
      ground: 'from-slate-800 via-blue-950 to-black',
      recipe: 'violet_drivers',
    },
    'manager:broadcasts': {
      sky: 'from-pink-300 via-orange-200 to-cyan-300',
      ground: 'from-rose-600 via-fuchsia-700 to-slate-950',
      recipe: 'rainbow_radio',
    },
    'manager:broadcast-inbox': {
      sky: 'from-slate-400 via-sky-300 to-indigo-400',
      ground: 'from-slate-700 via-slate-900 to-black',
      recipe: 'sky_mailbox',
    },
    'manager:fc': {
      sky: 'from-lime-300 via-emerald-200 to-teal-400',
      ground: 'from-emerald-800 via-teal-900 to-black',
      recipe: 'scan_fc',
    },
    'manager:stats': {
      sky: 'from-sky-300 via-blue-200 to-violet-300',
      ground: 'from-blue-800 via-indigo-900 to-black',
      recipe: 'stats_chart',
    },
    'manager:finance': {
      sky: 'from-yellow-300 via-amber-200 to-orange-300',
      ground: 'from-amber-700 via-orange-800 to-stone-950',
      recipe: 'gold_finance',
    },
    'admin:parks': {
      sky: 'from-zinc-400 via-slate-600 to-amber-900',
      ground: 'from-amber-900 via-stone-900 to-black',
      recipe: 'admin_command',
    },
    'admin:epl': {
      sky: 'from-sky-300 via-blue-200 to-slate-400',
      ground: 'from-slate-700 via-blue-900 to-black',
      recipe: 'admin_docs',
    },
    'admin:finance': {
      sky: 'from-yellow-300 via-amber-200 to-orange-300',
      ground: 'from-amber-700 via-yellow-900 to-stone-950',
      recipe: 'gold_finance',
    },
    'admin:drivers': {
      sky: 'from-emerald-300 via-green-200 to-teal-500',
      ground: 'from-green-800 via-emerald-900 to-black',
      recipe: 'admin_radar',
    },
    'admin:evacuators': {
      sky: 'from-orange-300 via-amber-200 to-red-300',
      ground: 'from-orange-700 via-red-900 to-black',
      recipe: 'admin_evac',
    },
    'admin:commissioners': {
      sky: 'from-red-300 via-rose-200 to-orange-300',
      ground: 'from-red-800 via-rose-900 to-black',
      recipe: 'admin_flag',
    },
    'home:welcome': {
      sky: 'from-sky-400 via-indigo-300 to-amber-200',
      ground: 'from-teal-500 via-emerald-600 to-slate-900',
      recipe: 'home_welcome',
    },
    'home:admin': {
      sky: 'from-slate-500 via-blue-400 to-indigo-600',
      ground: 'from-slate-800 via-slate-950 to-black',
      recipe: 'home_card_admin',
    },
    'home:manager': {
      sky: 'from-teal-400 via-cyan-300 to-blue-500',
      ground: 'from-cyan-700 via-teal-800 to-slate-950',
      recipe: 'home_card_manager',
    },
    'home:director': {
      sky: 'from-amber-300 via-orange-200 to-rose-400',
      ground: 'from-orange-600 via-rose-700 to-slate-950',
      recipe: 'home_card_director',
    },
    'home:driver': {
      sky: 'from-violet-500 via-fuchsia-400 to-indigo-700',
      ground: 'from-purple-900 via-slate-950 to-black',
      recipe: 'home_card_driver',
    },
    'home:evacuator': {
      sky: 'from-orange-400 via-amber-300 to-yellow-300',
      ground: 'from-orange-700 via-amber-900 to-stone-950',
      recipe: 'home_card_evac',
    },
    'home:commissioner': {
      sky: 'from-red-400 via-rose-300 to-orange-300',
      ground: 'from-red-800 via-rose-900 to-black',
      recipe: 'home_card_commissioner',
    },
  };
  return presets[key] || presets[`${role}:fleet`] || presets['manager:fleet'] || presets['home:welcome'];
}

export default function FreightCabinetScenery({ role, scene = 'fleet' }) {
  const preset = resolvePreset(role, scene);
  const transitionKey = `${role}-${scene}`;

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <AnimatePresence mode="sync">
        <motion.div
          key={transitionKey}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          className="absolute inset-0"
        >
          <div className={`absolute inset-0 bg-gradient-to-b ${preset.sky}`} />
          <div
            className={`absolute bottom-0 left-0 right-0 h-[42vh] min-h-[180px] bg-gradient-to-t ${preset.ground}`}
            style={{
              clipPath: preset.groundClip || 'polygon(0 10%, 100% 4%, 100% 100%, 0% 100%)',
            }}
          />
          <div className="absolute bottom-[30vh] left-0 right-0 h-20 bg-gradient-to-t from-white/25 to-transparent blur-2xl" />
          {RECIPE.render(preset)}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
