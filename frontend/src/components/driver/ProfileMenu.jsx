import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, LogOut, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';

export default function ProfileMenu({ driver, onProfileClick, onCloseOtherMenus, night = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);
  const navigate = useNavigate();
  const { logout } = useAuth();

  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = () => {
    setIsOpen(false);
    logout();
    navigate('/login');
  };

  const handleProfileClick = () => {
    setIsOpen(false);
    if (onProfileClick) {
      onProfileClick();
    }
  };

  const handleToggle = () => {
    const next = !isOpen;
    if (next && onCloseOtherMenus) onCloseOtherMenus();
    setIsOpen(next);
  };

  // Получаем имя и отчество из fullName
  const getNameParts = () => {
    if (!driver?.fullName) return null;
    const parts = driver.fullName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return { name: parts[1], secondName: parts[2] || '' };
    }
    return null;
  };

  const nameParts = getNameParts();
  const displayName = nameParts ? `${nameParts.name} ${nameParts.secondName}`.trim() : (driver?.fullName || driver?.username || 'Профиль');

  return (
    <div className="relative" ref={menuRef}>
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={handleToggle}
        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-sm transition-shadow font-medium ${
          night
            ? 'border border-slate-600/80 bg-slate-800/90 text-slate-100 hover:bg-slate-800'
            : 'border border-slate-200 bg-white text-slate-700 hover:shadow-md'
        }`}
      >
        <User className="w-5 h-5" />
        <span className="hidden sm:block">{displayName}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="absolute top-full left-0 mt-2 w-64 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden z-50"
          >
            {/* Кликабельный блок с ФИО и номером */}
            <motion.button
              whileHover={{ backgroundColor: '#f8fafc' }}
              onClick={handleProfileClick}
              className="w-full p-4 border-b border-slate-100 text-left hover:bg-slate-50 transition-colors"
            >
              <p className="font-semibold text-slate-800">{driver?.fullName || 'Водитель'}</p>
              <p className="text-sm text-slate-500 mt-0.5">{driver?.phone || driver?.username}</p>
            </motion.button>

            {/* Кнопка выхода */}
            <div className="p-2">
              <motion.button
                whileHover={{ backgroundColor: '#fef2f2' }}
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Выход</span>
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
