import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Moon, Sun } from 'lucide-react';
import { useAuth } from '../AuthContext';
import FirstLoginModal from '../components/FirstLoginModal';
import { FEATURE_EVACUATOR_AND_COMMISSIONER } from '../config/features';
import { operationsShell } from '../utils/operationsUi';
import { DayCloudsExtra, DaySun, NightClouds, NightMoon, ShootingStar } from '../components/freight/FreightNightSkyLayers';

/** Звёздное поле: пыль / обычные / яркие, тёплый и холодный блеск */
const STAR_LAYOUT = Array.from({ length: 128 }, (_, i) => {
  const h = ((i * 1664525) % 1000000) / 1000000;
  const v = ((i * 1013904223) % 1000000) / 1000000;
  const tier = i % 13 === 0 ? 'bright' : i % 3 === 0 ? 'dust' : 'norm';
  const palette = [
    'rgba(248,250,252,0.94)',
    'rgba(254,249,195,0.9)',
    'rgba(204,251,241,0.88)',
    'rgba(224,231,255,0.82)',
    'rgba(241,245,249,0.78)',
  ];
  return {
    left: `${3.5 + h * 92}%`,
    top: `${0.5 + v * 56}%`,
    r:
      tier === 'bright'
        ? 1.35 + (i % 5) * 0.4
        : tier === 'dust'
          ? 0.4 + (i % 4) * 0.22
          : 0.65 + (i % 6) * 0.32,
    o:
      tier === 'dust'
        ? 0.18 + (i % 5) * 0.07
        : tier === 'bright'
          ? 0.62 + (i % 4) * 0.08
          : 0.28 + (i % 7) * 0.09,
    tier,
    color: palette[i % 5],
  };
});

const SKYLINE_BUILDINGS = [
  { x: 0, y: 45, w: 120, h: 95 },
  { x: 110, y: 60, w: 90, h: 80 },
  { x: 200, y: 30, w: 140, h: 110 },
  { x: 330, y: 55, w: 100, h: 85 },
  { x: 420, y: 40, w: 160, h: 100 },
  { x: 560, y: 70, w: 80, h: 70 },
  { x: 630, y: 25, w: 200, h: 115 },
  { x: 810, y: 50, w: 130, h: 90 },
  { x: 920, y: 35, w: 170, h: 105 },
  { x: 1070, y: 65, w: 130, h: 75 },
];

const PIPE_TOPS = [
  { cx: 259, cy: 5 },
  { cx: 691, cy: 2 },
  { cx: 988, cy: 8 },
  { cx: 120, cy: 52 },
  { cx: 480, cy: 48 },
  { cx: 850, cy: 55 },
  { cx: 305, cy: 0 },
  { cx: 548, cy: 2 },
  { cx: 912, cy: 6 },
];

/** Промзона за жилыми массивами — силуэты цехов и магистральные стволы */
function IndustrialBackdrop() {
  return (
    <g opacity="0.94">
      <path d="M 248 140 L 248 52 L 278 46 L 325 50 L 358 44 L 358 140 Z" fill="#172554" />
      <path d="M 518 140 L 518 56 L 552 48 L 608 52 L 652 46 L 652 140 Z" fill="#1e293b" />
      <path d="M 878 140 L 878 58 L 918 52 L 978 56 L 1018 48 L 1018 140 Z" fill="#0f172a" opacity="0.92" />
      <rect x="288" y="0" width="14" height="58" rx="1" fill="#334155" />
      <rect x="568" y="0" width="12" height="54" rx="1" fill="#334155" />
      <rect x="930" y="0" width="13" height="50" rx="1" fill="#475569" />
    </g>
  );
}

function IndustrialSkyline({ night }) {
  const windows = useMemo(() => {
    const nodes = [];
    let k = 0;
    SKYLINE_BUILDINGS.forEach((b, bi) => {
      const stepX = 12;
      const stepY = 11;
      for (let py = b.y + 6; py + 8 < b.y + b.h - 4; py += stepY) {
        for (let px = b.x + 5; px + 9 < b.x + b.w - 4; px += stepX) {
          const seed = ((bi * 193 + px) * 7919 + py * 17) >>> 0;
          const litRoll = (seed >> 3) % 100;

          if (night) {
            if (litRoll < 46) {
              nodes.push(
                <rect
                  key={k++}
                  x={px}
                  y={py}
                  width="8"
                  height="7"
                  rx="0.8"
                  fill="#020617"
                  opacity={0.32 + (seed % 30) / 120}
                />
              );
              continue;
            }
            if (seed % 11 < 2) continue;
            const warm = seed % 4;
            const fill = warm === 0 ? '#fde68a' : warm === 1 ? '#fcd34d' : warm === 2 ? '#fbbf24' : '#fdba74';
            const flicker = 0.22 + (seed % 55) / 100;
            nodes.push(
              <rect
                key={k++}
                x={px}
                y={py}
                width="8"
                height="7"
                rx="0.8"
                fill={fill}
                opacity={flicker}
              />
            );
          } else if (litRoll < 12) {
            nodes.push(
              <rect
                key={k++}
                x={px}
                y={py}
                width="8"
                height="7"
                rx="0.8"
                fill={(seed % 2) === 0 ? '#bae6fd' : '#e0f2fe'}
                opacity={0.2 + (seed % 35) / 100}
              />
            );
          }
        }
      }
    });
    return nodes;
  }, [night]);

  return (
    <svg
      className="pointer-events-none absolute bottom-[22vh] left-0 right-0 h-[min(32vh,240px)] w-full text-slate-700/90"
      viewBox="0 0 1200 140"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="login-facade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={night ? '#1e293b' : '#64748b'} />
          <stop offset="100%" stopColor={night ? '#0f172a' : '#475569'} />
        </linearGradient>
        <filter id="login-steam-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4.5" />
        </filter>
      </defs>
      <IndustrialBackdrop />
      {SKYLINE_BUILDINGS.map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill="url(#login-facade)" />
      ))}
      {SKYLINE_BUILDINGS.map((b, bi) => {
        const roof = b.y;
        const rx = (pct) => b.x + (b.w * pct) / 100;
        const m = (bi * 13) % 9;
        return (
          <g key={`roof-${bi}`}>
            <rect
              x={rx(10 + m * 0.4) - 2.5}
              y={roof - 18}
              width="5"
              height="18"
              rx="1"
              fill={night ? '#475569' : '#94a3b8'}
              stroke="#334155"
              strokeWidth="0.7"
            />
            <line
              x1={rx(32 + (m % 3))}
              y1={roof}
              x2={rx(32 + (m % 3))}
              y2={roof - 26}
              stroke={night ? '#64748b' : '#475569'}
              strokeWidth="1.1"
            />
            <circle cx={rx(32 + (m % 3))} cy={roof - 28} r="2.2" fill={night ? '#94a3b8' : '#64748b'} />
            <rect
              x={rx(48) - 10}
              y={roof - 8}
              width="20"
              height="8"
              rx="1.2"
              fill="#1e293b"
              stroke="#475569"
              strokeWidth="0.55"
              opacity="0.92"
            />
            <line
              x1={rx(65)}
              y1={roof}
              x2={rx(65)}
              y2={roof - 20}
              stroke="#64748b"
              strokeWidth="0.85"
              opacity="0.75"
            />
            <path
              d={`M ${rx(65) - 1} ${roof - 22} L ${rx(65) + 5} ${roof - 24} L ${rx(65) + 1} ${roof - 18} Z`}
              fill="#64748b"
              opacity="0.65"
            />
            {bi % 2 === 0 && (
              <rect
                x={rx(82)}
                y={roof - 12}
                width="4"
                height="12"
                fill="#334155"
                stroke="#475569"
                strokeWidth="0.4"
                opacity="0.9"
              />
            )}
          </g>
        );
      })}
      <rect x="250" y="5" width="18" height="35" fill={night ? '#334155' : '#64748b'} />
      <rect x="680" y="0" width="22" height="40" fill={night ? '#334155' : '#64748b'} />
      <rect x="980" y="10" width="16" height="35" fill={night ? '#334155' : '#64748b'} />
      {windows}
      {night && (
        <>
          <circle cx="259" cy="8" r="3" fill="#f87171" className="animate-pulse" opacity="0.9" />
          <circle cx="691" cy="2" r="3" fill="#f87171" className="animate-pulse" opacity="0.7" style={{ animationDelay: '0.5s' }} />
          <circle cx="988" cy="14" r="2.5" fill="#f87171" className="animate-pulse" opacity="0.65" style={{ animationDelay: '1.1s' }} />
        </>
      )}
      {PIPE_TOPS.flatMap((p, i) =>
        [0, 1].map((layer) => (
          <motion.ellipse
            key={`steam-${i}-${layer}`}
            cx={p.cx + layer * 5 - 2.5}
            cy={p.cy}
            rx={10 + layer * 2}
            ry={12 + layer * 2}
            fill={night ? (layer === 0 ? '#f1f5f9' : '#cbd5e1') : layer === 0 ? 'rgba(255,255,255,0.72)' : 'rgba(226,232,240,0.55)'}
            filter="url(#login-steam-blur)"
            opacity={night ? '0.4' : '0.28'}
            animate={{
              cy: [p.cy, p.cy - 48 - layer * 8],
              opacity: night ? [0.48, 0] : [0.34, 0],
              rx: [10 + layer * 2, 18 + layer * 4],
            }}
            transition={{
              duration: 2.2 + i * 0.22 + layer * 0.4,
              repeat: Infinity,
              ease: 'easeOut',
              delay: i * 0.45 + layer * 0.35,
            }}
          />
        ))
      )}
    </svg>
  );
}

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showFirstLoginModal, setShowFirstLoginModal] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [currentToken, setCurrentToken] = useState(null);
  const [sceneMode, setSceneMode] = useState('night'); // 'day' | 'night'
  const { user, loading: authLoading, login, refreshUser } = useAuth();
  const navigate = useNavigate();
  const getRoleRoute = (role) => {
    if (role === 'admin') return '/admin';
    if (role === 'manager') return '/manager';
    if (role === 'driver') return '/driver';
    if (role === 'evacuator') return FEATURE_EVACUATOR_AND_COMMISSIONER ? '/evacuator' : '/home';
    if (role === 'commissioner') return FEATURE_EVACUATOR_AND_COMMISSIONER ? '/commissioner' : '/home';
    return '/home';
  };

  // Если пользователь уже авторизован, не показываем форму логина (исправляет "разлогин" по кнопке Back).
  useEffect(() => {
    if (authLoading || !user) return;
    if (user.mustChangePassword || user.firstLogin) {
      navigate('/change-credentials', { replace: true });
      return;
    }
    navigate(getRoleRoute(user.role), { replace: true });
  }, [authLoading, user, navigate]);


  const night = sceneMode === 'night';

  const skyClass = night
    ? 'bg-gradient-to-b from-[#0a0f1c] via-[#0f172a] to-[#1e3a5f]'
    : 'bg-gradient-to-b from-[#38bdf8] via-[#7dd3fc] to-[#fde68a]';

  const stars = useMemo(() => STAR_LAYOUT, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const userData = await login(username, password);
      const token = localStorage.getItem('token');

      if (userData.firstLogin) {
        setCurrentUser(userData);
        setCurrentToken(token);
        setShowFirstLoginModal(true);
        setLoading(false);
      } else if (userData.mustChangePassword) {
        navigate('/change-credentials', { replace: true });
      } else if (userData.role === 'admin') {
        navigate('/admin', { replace: true });
      } else if (userData.role === 'manager') {
        navigate('/manager', { replace: true });
      } else if (userData.role === 'driver') {
        navigate('/driver', { replace: true });
      } else if (userData.role === 'evacuator') {
        navigate(FEATURE_EVACUATOR_AND_COMMISSIONER ? '/evacuator' : '/home', { replace: true });
      } else if (userData.role === 'commissioner') {
        navigate(FEATURE_EVACUATOR_AND_COMMISSIONER ? '/commissioner' : '/home', { replace: true });
      } else {
        navigate('/home', { replace: true });
      }
    } catch (err) {
      let msg = err?.response?.data?.error || err?.message || 'Ошибка входа';
      if (msg === 'Network Error' || err?.code === 'ERR_NETWORK') {
        const api =
          import.meta.env.VITE_API_URL ||
          (import.meta.env.DEV ? 'http://127.0.0.1:5000/api' : '/api');
        msg = `Нет связи с сервером. Запустите backend и проверьте VITE_API_URL (сейчас ожидается ${api}).`;
      }
      setError(msg);
      setLoading(false);
    }
  };

  const handleFirstLoginSuccess = (_updatedUser) => {
    setShowFirstLoginModal(false);
    const role = currentUser.role;
    setTimeout(() => {
      if (role === 'admin') {
        navigate('/admin', { replace: true });
      } else if (role === 'manager') {
        navigate('/manager', { replace: true });
      } else if (role === 'driver') {
        navigate('/driver', { replace: true });
      } else if (role === 'evacuator') {
        navigate(FEATURE_EVACUATOR_AND_COMMISSIONER ? '/evacuator' : '/home', { replace: true });
      } else if (role === 'commissioner') {
        navigate(FEATURE_EVACUATOR_AND_COMMISSIONER ? '/commissioner' : '/home', { replace: true });
      } else {
        navigate('/home', { replace: true });
      }
    }, 150);
  };

  return (
    <div
      className={`login-page relative min-h-[100dvh] min-h-screen overflow-x-hidden overflow-y-auto ${
        night ? 'login-scene-night bg-[#0f172a]' : 'login-scene-day bg-[#7dd3fc]'
      }`}
    >
      {/* Небо и атмосфера */}
      <div className={`pointer-events-none absolute inset-0 ${skyClass}`} />

      {night && (
        <div className="pointer-events-none absolute inset-0">
          <NightClouds />
          {stars.map((s, i) => {
            const starClass =
              s.tier === 'bright' ? 'freight-star-lg' : s.tier === 'dust' ? 'freight-star-dust' : 'freight-star';
            return (
              <div
                key={i}
                className={`absolute rounded-full ${starClass}`}
                style={{
                  left: s.left,
                  top: s.top,
                  width: s.r,
                  height: s.r,
                  opacity: s.o,
                  backgroundColor: s.color,
                  boxShadow:
                    s.tier === 'bright'
                      ? '0 0 6px 1px rgba(255,255,255,0.35)'
                      : s.tier === 'dust'
                        ? 'none'
                        : '0 0 3px rgba(255,255,255,0.2)',
                  animationDelay: `${(i % 18) * 0.19}s`,
                }}
              />
            );
          })}
          <NightMoon className="right-[3%] top-[2.5%] z-[3] h-[6.5rem] w-[6.5rem] sm:h-[7.25rem] sm:w-[7.25rem]" />
          <ShootingStar />
        </div>
      )}

      {!night && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <DaySun className="right-0 top-[3%] z-[2] h-[9rem] w-[9rem] sm:right-[1%] sm:h-[9.5rem] sm:w-[9.5rem]" />
          <DayCloudsExtra />
        </div>
      )}

      <IndustrialSkyline night={night} />

      {/* Дорога */}
      <div
        className="pointer-events-none absolute bottom-0 left-0 right-0 z-[4] h-[min(28vh,200px)] min-h-[150px]"
        style={{
          background: night
            ? 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)'
            : 'linear-gradient(180deg, #64748b 0%, #475569 100%)',
          clipPath: 'polygon(8% 0, 92% 0, 100% 100%, 0% 100%)',
        }}
      >
        <div
          className={`absolute bottom-[38%] left-[20%] right-[20%] h-px ${
            night ? 'bg-slate-500/40' : 'bg-white/35'
          }`}
        />
      </div>

      {/* Переключатель день / ночь */}
      <div className="absolute right-3 top-2 z-50 flex items-center gap-2 rounded-full border border-white/25 bg-black/20 p-1 backdrop-blur-md sm:right-4">
        <button
          type="button"
          onClick={() => setSceneMode('day')}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
            !night ? 'bg-amber-100 text-amber-900 shadow' : 'text-white/80 hover:text-white'
          }`}
          title="День"
        >
          <Sun className="h-4 w-4" />
          День
        </button>
        <button
          type="button"
          onClick={() => setSceneMode('night')}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
            night ? 'bg-slate-700 text-amber-100 shadow' : 'text-white/80 hover:text-white'
          }`}
          title="Ночь"
        >
          <Moon className="h-4 w-4" />
          Ночь
        </button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 flex min-h-[100dvh] min-h-screen items-center justify-center px-4 py-6 sm:py-8"
      >
        <div
          className={`w-full max-w-md rounded-2xl p-7 shadow-2xl md:p-9 ${
            night
              ? 'border border-white/[0.09] bg-slate-950/[0.26] backdrop-blur-xl shadow-[0_20px_52px_rgba(0,0,0,0.36)] ring-1 ring-white/[0.05]'
              : operationsShell(false)
          }`}
        >
          <div className="mb-8 text-center">
            <motion.h1
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
              className={`text-3xl font-bold sm:text-4xl ${
                night
                  ? 'bg-gradient-to-r from-teal-100 via-white to-slate-200 bg-clip-text text-transparent'
                  : 'bg-gradient-to-r from-slate-800 via-sky-800 to-teal-800 bg-clip-text text-transparent'
              }`}
            >
              Грузовые ЭПЛ
            </motion.h1>
            <p className={`mt-1 text-xs sm:text-sm ${night ? 'text-slate-400' : 'text-slate-500'}`}>
              Электронные путевые листы для грузоперевозок
            </p>
            <p className={`mt-2 text-sm ${night ? 'text-slate-300' : 'text-slate-600'}`}>Войдите в систему</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}>
              <label
                htmlFor="login-input"
                className={`mb-2 block text-sm font-semibold ${night ? 'text-slate-300' : 'text-slate-700'}`}
              >
                Логин
              </label>
              <input
                id="login-input"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Введите логин"
                className={`login-field w-full rounded-xl px-4 py-3 text-base transition focus:outline-none focus:ring-2 focus:ring-teal-500/40 ${
                  night
                    ? 'login-field-night border border-slate-500/90 placeholder:text-slate-400'
                    : 'login-field-day border border-slate-300 placeholder:text-slate-500'
                }`}
                required
              />
            </motion.div>

            <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.28 }}>
              <label
                htmlFor="password-input"
                className={`mb-2 block text-sm font-semibold ${night ? 'text-slate-300' : 'text-slate-700'}`}
              >
                Пароль
              </label>
              <div className="relative">
                <input
                  id="password-input"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Введите пароль"
                  className={`login-field w-full rounded-xl px-4 py-3 pr-12 text-base transition focus:outline-none focus:ring-2 focus:ring-teal-500/40 ${
                    night
                      ? 'login-field-night border border-slate-500/90 placeholder:text-slate-400'
                      : 'login-field-day border border-slate-300 placeholder:text-slate-500'
                  }`}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 ${night ? 'text-slate-400 hover:text-slate-200' : 'text-slate-400 hover:text-slate-600'}`}
                  title={showPassword ? 'Скрыть' : 'Показать'}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </motion.div>

            {error && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`rounded-xl border p-4 text-sm ${
                  night
                    ? 'border-red-400/35 bg-red-950/40 text-red-200'
                    : 'border-red-200 bg-red-50/95 text-red-700'
                }`}
              >
                {error}
              </motion.div>
            )}

            <motion.button
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-gradient-to-r from-teal-600 to-teal-800 py-3 font-bold text-white shadow-lg transition-all hover:from-teal-700 hover:to-teal-900 hover:shadow-xl disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="h-5 w-5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Загрузка...
                </span>
              ) : (
                'Войти'
              )}
            </motion.button>
          </form>
        </div>
      </motion.div>

      {showFirstLoginModal && currentUser && currentToken && (
        <FirstLoginModal
          userId={currentUser.id}
          token={currentToken}
          onClose={() => setShowFirstLoginModal(false)}
          onSuccess={handleFirstLoginSuccess}
          refreshUser={refreshUser}
        />
      )}
    </div>
  );
}
