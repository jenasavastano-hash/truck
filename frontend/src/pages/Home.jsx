import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../AuthContext';
import { useNavigate } from 'react-router-dom';
import { Building2, Users, FileText, ArrowRight, BarChart3, Car, ClipboardList, Wallet, ShieldAlert, Truck, Sun, Moon } from 'lucide-react';
import api from '../api';
import { getDashboard } from '../api/managerApi';
import { FEATURE_EVACUATOR_AND_COMMISSIONER } from '../config/features';
import FreightOperationsBackdrop from '../components/freight/FreightOperationsBackdrop';
import { readOperationsSceneNight, operationsShell } from '../utils/operationsUi';

const colorMapDay = {
  blue: 'border-blue-200/80 bg-blue-50/70 text-blue-800',
  emerald: 'border-emerald-200/80 bg-emerald-50/70 text-emerald-800',
  purple: 'border-purple-200/80 bg-purple-50/70 text-purple-800',
  amber: 'border-amber-200/80 bg-amber-50/70 text-amber-800',
  slate: 'border-slate-200/80 bg-slate-50/70 text-slate-800',
};

const colorMapNight = {
  blue: 'border-sky-400/20 bg-sky-500/10 text-sky-100',
  emerald: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100',
  purple: 'border-violet-400/20 bg-violet-500/10 text-violet-100',
  amber: 'border-amber-400/20 bg-amber-500/10 text-amber-100',
  slate: 'border-white/10 bg-white/[0.06] text-slate-200',
};

function StatCard({ icon: Icon, label, value, color = 'slate', night = false }) {
  const map = night ? colorMapNight : colorMapDay;
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 shadow-sm backdrop-blur-md ${map[color] || map.slate}`}>
      <Icon className="w-8 h-8 flex-shrink-0 opacity-90" />
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide opacity-80">{label}</p>
        <p className="font-bold text-lg truncate">{value}</p>
      </div>
    </div>
  );
}

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [night, setNight] = useState(readOperationsSceneNight);

  useEffect(() => {
    try {
      localStorage.setItem('freight_operations_scene', night ? 'night' : 'day');
    } catch (_) {}
  }, [night]);

  useEffect(() => {
    let cancelled = false;
    const role = user?.role;
    if (!role) {
      setStatsLoading(false);
      return;
    }
    if (role === 'admin') {
      api
        .get('/admin/home-stats')
        .then((r) => {
          if (!cancelled) setStats(r.data);
        })
        .catch(() => {
          if (!cancelled) setStats(null);
        })
        .finally(() => {
          if (!cancelled) setStatsLoading(false);
        });
    } else if (role === 'manager') {
      getDashboard()
        .then((data) => {
          if (!cancelled)
            setStats({
              parkName: data?.name,
              driversCount: data?.driversCount ?? 0,
              carsCount: data?.carsCount ?? 0,
            });
        })
        .catch(() => {
          if (!cancelled) setStats(null);
        })
        .finally(() => {
          if (!cancelled) setStatsLoading(false);
        });
    } else if (role === 'director') {
      api
        .get('/director/park')
        .then((r) => {
          const p = r?.data?.park;
          if (!cancelled)
            setStats({
              parkName: p?.name,
              driversCount: null,
              carsCount: null,
            });
        })
        .catch(() => {
          if (!cancelled) setStats(null);
        })
        .finally(() => {
          if (!cancelled) setStatsLoading(false);
        });
    } else if (role === 'driver') {
      api
        .get('/driver/home-stats')
        .then((r) => {
          if (!cancelled) setStats(r.data);
        })
        .catch(() => {
          if (!cancelled) setStats(null);
        })
        .finally(() => {
          if (!cancelled) setStatsLoading(false);
        });
    } else {
      setStatsLoading(false);
    }
    return () => {
      cancelled = true;
    };
  }, [user?.role]);

  const quickLinks = [
    {
      id: 'admin',
      label: 'Админ-панель',
      description: 'Управление парками и менеджерами',
      icon: Building2,
      color: 'blue',
      path: '/admin',
      roles: ['admin'],
    },
    {
      id: 'manager',
      label: 'Панель менеджера',
      description: 'Управление автопарком и водителями',
      icon: Users,
      color: 'emerald',
      path: '/manager',
      roles: ['manager'],
    },
    {
      id: 'director',
      label: 'Панель директора',
      description: 'Полный доступ к своему парку',
      icon: Building2,
      color: 'blue',
      path: '/director',
      roles: ['director'],
    },
    {
      id: 'driver',
      label: 'Личный кабинет водителя',
      description: 'Создание путевых листов',
      icon: FileText,
      color: 'purple',
      path: '/driver',
      roles: ['driver'],
    },
    {
      id: 'evacuator',
      label: 'Кабинет эвакуатора',
      description: 'Заявки, отклики и заказы',
      icon: Truck,
      color: 'amber',
      path: '/evacuator',
      roles: ['evacuator'],
    },
    {
      id: 'commissioner',
      label: 'Кабинет комиссара',
      description: 'Заявки по ДТП и заказы',
      icon: ShieldAlert,
      color: 'amber',
      path: '/commissioner',
      roles: ['commissioner'],
    },
  ].filter(
    (link) =>
      (!link.roles || link.roles.includes(user?.role)) &&
      (FEATURE_EVACUATOR_AND_COMMISSIONER || (link.id !== 'evacuator' && link.id !== 'commissioner'))
  );

  return (
    <div className="relative min-h-screen">
      <FreightOperationsBackdrop night={night} />
      <div className="absolute right-4 top-4 z-50 flex items-center gap-2 rounded-full border border-white/20 bg-black/15 p-1 backdrop-blur-md">
        <button
          type="button"
          onClick={() => setNight(false)}
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
          onClick={() => setNight(true)}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
            night ? 'bg-slate-700 text-amber-100 shadow' : 'text-white/80 hover:text-white'
          }`}
          title="Ночь"
        >
          <Moon className="h-4 w-4" />
          Ночь
        </button>
      </div>

      <div className="relative z-10 min-h-screen">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
              className="inline-block mb-6"
            >
              <Truck className={`w-16 h-16 ${night ? 'text-teal-300' : 'text-blue-600'}`} />
            </motion.div>
            <p className={`text-sm font-semibold uppercase tracking-wide mb-2 ${night ? 'text-teal-300/90' : 'text-blue-700'}`}>
              Грузовые ЭПЛ
            </p>
            <h1
              className={`text-4xl sm:text-5xl font-bold mb-4 drop-shadow-sm ${
                night
                  ? 'bg-gradient-to-r from-slate-100 via-teal-100 to-slate-200 bg-clip-text text-transparent'
                  : 'bg-gradient-to-r from-blue-700 via-indigo-700 to-teal-700 bg-clip-text text-transparent'
              }`}
            >
              Добро пожаловать!
            </h1>
            {user && (
              <p className={`text-lg ${night ? 'text-slate-300' : 'text-slate-600'}`}>
                {user.fullName || user.username}, выберите раздел для работы с путевыми листами
              </p>
            )}
          </motion.div>

          {!statsLoading && stats && (
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className={`mb-10 rounded-2xl p-4 shadow-lg sm:p-5 ${operationsShell(night)}`}
            >
              <h2 className={`mb-4 flex items-center gap-2 text-xl font-bold ${night ? 'text-slate-100' : 'text-slate-800'}`}>
                <BarChart3 className={`w-6 h-6 ${night ? 'text-teal-300' : 'text-blue-600'}`} />
                Сводка
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                {user?.role === 'admin' && (
                  <>
                    <StatCard icon={Building2} label="Парков" value={stats.parksCount} color="blue" night={night} />
                    <StatCard icon={Users} label="Менеджеров" value={stats.managersCount} color="emerald" night={night} />
                    <StatCard icon={FileText} label="Водителей" value={stats.driversCount} color="purple" night={night} />
                    <StatCard icon={Car} label="Автомобилей" value={stats.carsCount} color="amber" night={night} />
                    <StatCard icon={ClipboardList} label="ЭПЛ в работе" value={stats.eplPendingCount} color="slate" night={night} />
                  </>
                )}
                {user?.role === 'manager' && (
                  <>
                    {stats.parkName && (
                      <div
                        className={`col-span-2 sm:col-span-3 lg:col-span-1 flex items-center rounded-xl border px-4 py-3 shadow-sm backdrop-blur-md ${
                          night
                            ? 'border-white/12 bg-white/[0.06] text-slate-100'
                            : 'border-white/50 bg-white/45 text-slate-800'
                        }`}
                      >
                        <Building2 className={`w-8 h-8 mr-3 flex-shrink-0 ${night ? 'text-sky-300' : 'text-blue-600'}`} />
                        <div>
                          <p className={`text-xs uppercase tracking-wide ${night ? 'text-slate-400' : 'text-slate-500'}`}>Парк</p>
                          <p className="font-semibold truncate">{stats.parkName}</p>
                        </div>
                      </div>
                    )}
                    <StatCard icon={Users} label="Водителей" value={stats.driversCount} color="emerald" night={night} />
                    <StatCard icon={Car} label="Автомобилей" value={stats.carsCount} color="amber" night={night} />
                  </>
                )}
                {user?.role === 'director' && stats.parkName && (
                  <div
                    className={`col-span-2 sm:col-span-3 flex items-center rounded-xl border px-4 py-3 shadow-sm backdrop-blur-md ${
                      night ? 'border-white/12 bg-white/[0.06] text-slate-100' : 'border-white/50 bg-white/45 text-slate-800'
                    }`}
                  >
                    <Building2 className={`w-8 h-8 mr-3 flex-shrink-0 ${night ? 'text-sky-300' : 'text-blue-600'}`} />
                    <div>
                      <p className={`text-xs uppercase tracking-wide ${night ? 'text-slate-400' : 'text-slate-500'}`}>Ваш парк</p>
                      <p className="font-semibold truncate">{stats.parkName}</p>
                    </div>
                  </div>
                )}
                {user?.role === 'driver' && (
                  <>
                    <StatCard
                      icon={Wallet}
                      label="Баланс"
                      value={`${Number(stats.balance ?? 0).toLocaleString('ru-RU')} ₽`}
                      color="emerald"
                      night={night}
                    />
                    <StatCard icon={FileText} label="Путевых листов" value={stats.eplTotal} color="purple" night={night} />
                    <StatCard icon={ClipboardList} label="В работе" value={stats.eplActive} color="blue" night={night} />
                  </>
                )}
              </div>
            </motion.section>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {quickLinks.map((link, index) => {
              const Icon = link.icon;
              const colorClasses = {
                blue: 'from-blue-500 to-blue-600',
                emerald: 'from-emerald-500 to-emerald-600',
                purple: 'from-purple-500 to-purple-600',
                amber: 'from-amber-500 to-amber-600',
              };
              return (
                <motion.div
                  key={link.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  whileHover={{ scale: 1.02, y: -4 }}
                  onClick={() => navigate(link.path)}
                  className={`cursor-pointer rounded-2xl p-6 shadow-lg transition-all hover:shadow-xl group ${operationsShell(night)}`}
                >
                  <div
                    className={`p-4 bg-gradient-to-br ${colorClasses[link.color] || 'from-slate-500 to-slate-600'} rounded-xl shadow-md group-hover:scale-110 transition-transform mb-4 inline-block`}
                  >
                    <Icon className="w-8 h-8 text-white" />
                  </div>
                  <h3 className={`text-xl font-bold mb-2 ${night ? 'text-slate-50' : 'text-slate-800'}`}>{link.label}</h3>
                  <p className={`text-sm mb-4 ${night ? 'text-slate-400' : 'text-slate-600'}`}>{link.description}</p>
                  <div
                    className={`flex items-center gap-2 text-sm font-semibold ${night ? 'text-teal-300' : 'text-blue-600 group-hover:text-blue-700'}`}
                  >
                    <span>Перейти</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition" />
                  </div>
                </motion.div>
              );
            })}
          </div>

          {quickLinks.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className={`rounded-2xl p-8 text-center shadow-lg ${operationsShell(night)}`}
            >
              <p className={`text-lg mb-4 ${night ? 'text-slate-200' : 'text-slate-600'}`}>Нет доступных разделов для вашей роли</p>
              <p className={night ? 'text-slate-400' : 'text-slate-500'}>Обратитесь к администратору</p>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
