import { motion } from 'framer-motion';
import { CheckCircle2, Clock, XCircle, AlertCircle } from 'lucide-react';

export default function StatusCard({ title, status, value, time, icon: Icon, color = 'blue', delay = 0 }) {
  const statusConfig = {
    active: { icon: CheckCircle2, color: 'emerald', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', iconColor: 'text-emerald-600' },
    pending: { icon: Clock, color: 'amber', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', iconColor: 'text-amber-600' },
    inactive: { icon: XCircle, color: 'slate', bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-700', iconColor: 'text-slate-500' },
    error: { icon: AlertCircle, color: 'red', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', iconColor: 'text-red-600' }
  };

  const config = statusConfig[status] || statusConfig.inactive;
  const StatusIcon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
      className={`${config.bg} ${config.border} border rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          {Icon && <Icon className={`w-5 h-5 ${config.iconColor}`} />}
          <h3 className={`text-xs font-semibold ${config.text} uppercase tracking-wide`}>{title}</h3>
        </div>
        <StatusIcon className={`w-5 h-5 ${config.iconColor}`} />
      </div>
      <div className="space-y-1">
        <p className={`text-lg font-bold ${config.text}`}>{value}</p>
        {time && (
          <p className={`text-xs font-medium ${config.text} opacity-80`}>{time}</p>
        )}
        {!time && status === 'active' && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: delay + 0.2, type: 'spring' }}
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-100"
          >
            <div className="w-2 h-2 bg-emerald-600 rounded-full animate-pulse" />
            <span className="text-xs font-medium text-emerald-700">Активна</span>
          </motion.div>
        )}
        {!time && status === 'pending' && (
          <span className="text-xs font-medium text-amber-600">Ожидает</span>
        )}
        {!time && status === 'inactive' && (
          <span className="text-xs font-medium text-slate-500">Не активна</span>
        )}
      </div>
    </motion.div>
  );
}
