import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Car, Users, Link2, TrendingUp, Plus, ArrowRight, Sparkles, Zap } from 'lucide-react';
import api from '../../api';

export default function ParkDashboard({ data, onTabChange }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!data) {
    return (
      <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-8 text-center">
        <p className="text-slate-600">Нет данных</p>
      </div>
    );
  }

  const stats = [
    {
      id: 'cars',
      label: 'Автомобили',
      value: data.carsCount || 0,
      icon: Car,
      color: 'teal',
      gradient: 'from-teal-500 to-teal-600',
      bgGradient: 'from-teal-50 to-teal-100',
      action: onTabChange ? () => onTabChange('fleet') : undefined
    },
    {
      id: 'drivers',
      label: 'Водители',
      value: data.driversCount || 0,
      icon: Users,
      color: 'emerald',
      gradient: 'from-emerald-500 to-emerald-600',
      bgGradient: 'from-emerald-50 to-emerald-100',
      action: onTabChange ? () => onTabChange('drivers') : undefined
    },
    {
      id: 'assigned',
      label: 'Привязано',
      value: data.assignedDrivers || 0,
      icon: Link2,
      color: 'purple',
      gradient: 'from-purple-500 to-purple-600',
      bgGradient: 'from-purple-50 to-purple-100',
      percentage: data.driversCount > 0 ? Math.round((data.assignedDrivers / data.driversCount) * 100) : 0
    }
  ];

  const quickActions = [
    {
      id: 'add-car',
      label: 'Добавить авто',
      description: 'Зарегистрировать новый автомобиль',
      icon: Car,
      color: 'teal',
      action: onTabChange ? () => onTabChange('fleet') : undefined
    },
    {
      id: 'add-driver',
      label: 'Добавить водителя',
      description: 'Зарегистрировать нового водителя',
      icon: Users,
      color: 'emerald',
      action: onTabChange ? () => onTabChange('drivers') : undefined
    }
  ];

  return (
    <div className="space-y-6">
      {/* Статистика с красивыми карточками */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.id}
              initial={{ opacity: 0, y: 20 }}
              animate={mounted ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: index * 0.1 }}
              whileHover={{ scale: 1.02, y: -4 }}
              onClick={stat.action}
              className={`bg-gradient-to-br ${stat.bgGradient} rounded-xl shadow-lg border-2 border-${stat.color}-200 p-6 cursor-pointer transition-all hover:shadow-xl group`}
            >
              <div className="flex items-center justify-between mb-4">
                <div className={`p-3 bg-gradient-to-br ${stat.gradient} rounded-xl shadow-md group-hover:scale-110 transition-transform`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
                {stat.percentage !== undefined && (
                  <div className="flex items-center gap-1 text-sm font-semibold text-slate-600">
                    <TrendingUp className="w-4 h-4" />
                    <span>{stat.percentage}%</span>
                  </div>
                )}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-600 mb-1">{stat.label}</p>
                <p className={`text-3xl sm:text-4xl font-bold text-${stat.color}-700`}>
                  {stat.value}
                </p>
              </div>
              {stat.action && (
                <motion.div
                  className="mt-4 flex items-center gap-2 text-sm font-semibold text-slate-600 group-hover:text-slate-800 transition"
                  whileHover={{ x: 4 }}
                >
                  <span>Подробнее</span>
                  <ArrowRight className="w-4 h-4" />
                </motion.div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Быстрые действия */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={mounted ? { opacity: 1, y: 0 } : {}}
        transition={{ delay: 0.3 }}
        className="bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden"
      >
        <div className="bg-gradient-to-r from-slate-50 to-sky-50 px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-teal-600" />
            <h2 className="text-lg font-bold text-slate-800">Быстрые действия</h2>
          </div>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {quickActions.map((action, index) => {
              const Icon = action.icon;
              return (
                <motion.button
                  key={action.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={mounted ? { opacity: 1, x: 0 } : {}}
                  transition={{ delay: 0.4 + index * 0.1 }}
                  whileHover={{ scale: 1.02, x: 4 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={action.action}
                  className={`flex items-center gap-4 p-4 border-2 border-slate-200 rounded-xl hover:border-${action.color}-500 hover:bg-${action.color}-50 transition-all group text-left`}
                >
                  <div className={`p-3 bg-gradient-to-br from-${action.color}-500 to-${action.color}-600 rounded-lg shadow-md group-hover:scale-110 transition-transform`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Plus className={`w-4 h-4 text-${action.color}-600`} />
                      <p className={`font-semibold text-slate-800 group-hover:text-${action.color}-700 transition`}>
                        {action.label}
                      </p>
                    </div>
                    <p className="text-xs text-slate-600">{action.description}</p>
                  </div>
                  <ArrowRight className={`w-5 h-5 text-slate-400 group-hover:text-${action.color}-600 group-hover:translate-x-1 transition`} />
                </motion.button>
              );
            })}
          </div>
        </div>
      </motion.div>

      {/* Информационный блок */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={mounted ? { opacity: 1, y: 0 } : {}}
        transition={{ delay: 0.6 }}
        className="bg-gradient-to-r from-sky-50 via-teal-50 to-slate-50 border-2 border-teal-200 rounded-xl p-6 shadow-md"
      >
        <div className="flex items-start gap-4">
          <div className="p-2 bg-teal-100 rounded-lg">
            <Sparkles className="w-6 h-6 text-teal-700" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-teal-900 mb-2 flex items-center gap-2">
              💡 Совет
            </h3>
            <p className="text-teal-800 text-sm leading-relaxed">
              Для эффективной работы рекомендуем сначала добавить автомобили в автопарк, 
              затем зарегистрировать водителей и привязать их к авто через карточку водителя.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
