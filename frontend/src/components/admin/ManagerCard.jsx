import { motion } from 'framer-motion';
import { UserCircle, Phone, Shield, CheckCircle2, XCircle } from 'lucide-react';
import Card from '../ui/Card';

export default function ManagerCard({ manager, onClick, index = 0 }) {
  const permissions = [
    { key: 'canAccessPhotoControl', label: 'Фотоконтроль', icon: '📷' },
    { key: 'canAccessStatistics', label: 'Статистика', icon: '📊' },
    { key: 'canTopupBalance', label: 'Пополнить баланс', icon: '💰' },
    { key: 'canFine', label: 'Штраф', icon: '⚠️' },
    { key: 'canDismiss', label: 'Уволить', icon: '🚪' },
    { key: 'canDeleteDriver', label: 'Удалить из системы', icon: '🗑️' },
    { key: 'canViewEplLogs', label: 'Логи ЭПЛ', icon: '📄' },
    { key: 'canControlEplQueue', label: 'Очередь QR', icon: '🔁' },
    { key: 'canCloseEplShifts', label: 'Закрывать смены из ЭПЛ', icon: '⏱' },
    { key: 'canChargeOnShiftClose', label: 'Списание при закрытии смены', icon: '💸' },
    { key: 'canDownloadEplDocs', label: 'Скачивание документов ЭПЛ', icon: '📎' },
  ];

  const activePermissions = permissions.filter(p => manager[p.key] && manager[p.key] !== 0);
  const displayName = manager.fullName || manager.username || 'Без имени';

  return (
    <Card
      onClick={onClick}
      delay={index * 0.05}
      className="p-4 hover:border-teal-300 cursor-pointer"
    >
      {/* Compact Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="p-2 bg-teal-100 rounded-lg shrink-0">
          <UserCircle className="w-5 h-5 text-teal-700" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-base text-slate-800 mb-1 truncate">
            {displayName}
          </h3>
          {manager.phone && (
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <Phone className="w-3 h-3 shrink-0" />
              <span>{manager.phone}</span>
            </div>
          )}
          {manager.managerType === 'fc' && (
            <span className="inline-block mt-1 px-2 py-0.5 bg-sky-100 text-sky-700 text-xs rounded-md font-medium">Менеджер ФК</span>
          )}
        </div>
      </div>

      {/* Permissions - Compact (только для менеджера парка) */}
      {manager.managerType === 'fc' ? (
        <p className="text-xs text-sky-600">Работает только с заявками на фотоконтроль</p>
      ) : activePermissions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {activePermissions.map(perm => (
            <span
              key={perm.key}
              className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded-md font-medium"
            >
              {perm.icon} {perm.label}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-400 italic">Нет активных доступов</p>
      )}
    </Card>
  );
}
