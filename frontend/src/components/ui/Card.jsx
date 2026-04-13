import { motion } from 'framer-motion';

/**
 * Универсальный компонент карточки
 *
 * @param {'default' | 'glassNight' | 'glassDay'} variant — iOS-подобное стекло для операционных экранов
 */
export default function Card({ children, onClick, className = '', delay = 0, variant = 'default' }) {
  const surfaces = {
    default: 'bg-white rounded-xl shadow-md hover:shadow-xl transition-all duration-300 border border-slate-200',
    glassNight:
      'rounded-2xl border border-white/[0.14] bg-slate-950/42 shadow-[0_12px_48px_rgba(0,0,0,0.45)] backdrop-blur-2xl backdrop-saturate-150 ring-1 ring-white/[0.06]',
    glassDay:
      'rounded-2xl border border-white/75 bg-white/52 shadow-[0_12px_40px_rgba(15,23,42,0.08)] backdrop-blur-2xl backdrop-saturate-150 ring-1 ring-slate-900/[0.05]',
  };
  const baseClasses = surfaces[variant] || surfaces.default;
  const clickableClasses = onClick ? 'cursor-pointer hover:scale-[1.01] active:scale-[0.99]' : '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
      onClick={onClick}
      className={`${baseClasses} ${clickableClasses} ${className}`}
    >
      {children}
    </motion.div>
  );
}
