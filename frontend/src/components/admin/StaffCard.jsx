import { motion } from 'framer-motion';
import { Stethoscope, Wrench, Phone as PhoneIcon, User } from 'lucide-react';
import Card from '../ui/Card';

const roleIcons = {
  medic: { icon: Stethoscope, color: 'bg-red-100', iconColor: 'text-red-600', label: 'Медик' },
  technic: { icon: Wrench, color: 'bg-teal-100', iconColor: 'text-teal-700', label: 'Механик' },
  dispatcher: { icon: PhoneIcon, color: 'bg-green-100', iconColor: 'text-green-600', label: 'Диспетчер' },
};

export default function StaffCard({ staff, role, onClick, index = 0 }) {
  const roleConfig = roleIcons[role] || { icon: User, color: 'bg-slate-100', iconColor: 'text-slate-600', label: 'Сотрудник' };
  const Icon = roleConfig.icon;

  return (
    <Card
      onClick={onClick}
      delay={index * 0.05}
      className="p-3 sm:p-4 md:p-5 hover:border-teal-300"
    >
      {/* Header */}
      <div className="flex items-start gap-2 sm:gap-3 md:gap-4">
        <div className={`p-2 sm:p-2.5 md:p-3 ${roleConfig.color} rounded-lg sm:rounded-xl shrink-0`}>
          <Icon className={`w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 ${roleConfig.iconColor}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="mb-0.5 sm:mb-1">
            <span className="text-[10px] sm:text-xs font-semibold text-slate-500 uppercase">{roleConfig.label}</span>
          </div>
          <h3 className="font-bold text-sm sm:text-base md:text-lg text-slate-800 mb-0.5 sm:mb-1 break-words">
            {staff.fullName || `${staff.lastName || ''} ${staff.firstName || ''} ${staff.secondName || ''}`.trim() || 'Без имени'}
          </h3>
          {staff.position && (
            <p className="text-xs sm:text-sm text-slate-600 mb-0.5 sm:mb-1 break-words">{staff.position}</p>
          )}
          {staff.phone && (
            <div className="flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm text-slate-600">
              <PhoneIcon className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" />
              <span className="break-all">{staff.phone}</span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
