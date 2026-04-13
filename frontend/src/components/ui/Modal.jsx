import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect } from 'react';

/**
 * Универсальный компонент модального окна
 * 
 * @param {boolean} isOpen - открыто ли модальное окно
 * @param {function} onClose - функция закрытия
 * @param {string} title - заголовок модалки
 * @param {ReactNode} children - содержимое модалки
 * @param {string} size - размер: 'sm', 'md', 'lg', 'xl', 'full'
 * @param {boolean} showCloseButton - показывать ли кнопку закрытия
 * @param {string} className - дополнительные классы для контента
 */
export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  showCloseButton = true,
  className = ''
}) {
  // Закрытие по Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    // Блокируем скролл body при открытой модалке
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  const sizeClasses = {
    sm: 'max-w-[calc(100vw-1rem)] sm:max-w-md',
    md: 'max-w-[calc(100vw-1rem)] sm:max-w-lg',
    lg: 'max-w-[calc(100vw-1rem)] sm:max-w-2xl',
    xl: 'max-w-[calc(100vw-1rem)] sm:max-w-4xl',
    full: 'max-w-[calc(100vw-1rem)] sm:max-w-6xl'
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />

          {/* Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 pointer-events-none overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: 'spring', duration: 0.3 }}
              onClick={(e) => e.stopPropagation()}
              className={`bg-white rounded-xl sm:rounded-2xl shadow-2xl w-full ${sizeClasses[size]} max-w-[calc(100vw-1rem)] sm:max-w-none max-h-[95vh] sm:max-h-[90vh] flex flex-col pointer-events-auto ${className}`}
            >
              {/* Header */}
              {title && (
                <div className="flex items-center justify-between p-3 sm:p-6 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white">
                  <h2 className="text-lg sm:text-2xl font-bold text-slate-800 pr-2 truncate">{title}</h2>
                  {showCloseButton && (
                    <motion.button
                      whileHover={{ scale: 1.1, rotate: 90 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={onClose}
                      className="p-1.5 sm:p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors shrink-0"
                    >
                      <X className="w-4 h-4 sm:w-5 sm:h-5" />
                    </motion.button>
                  )}
                </div>
              )}

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-3 sm:p-6">
                {children}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
