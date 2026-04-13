import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { User, LogOut, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';

export default function UserProfileMenu({ user, onProfileClick }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();
  const { logout } = useAuth();

  useEffect(() => {
    function handleClickOutside(event) {
      const t = event.target;
      if (
        menuRef.current?.contains(t) ||
        dropdownRef.current?.contains(t)
      ) {
        return;
      }
      setIsOpen(false);
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

  const displayName = user?.fullName || user?.username || 'Профиль';

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => setIsOpen((v) => !v)}
        className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 sm:py-2.5 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl shadow-sm hover:shadow-md transition-shadow font-medium text-white"
        type="button"
      >
        <User className="w-5 h-5 shrink-0" />
        <span className="hidden sm:block truncate max-w-[120px]">{displayName}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </motion.button>

      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            <button
              type="button"
              className="fixed inset-0 z-[200] cursor-default bg-black/20 sm:bg-transparent"
              onClick={() => setIsOpen(false)}
              aria-label="Закрыть меню"
            />
            <div
              ref={dropdownRef}
              className="fixed z-[210] w-64 max-w-[min(16rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
              style={{ top: 64, right: 12 }}
              role="menu"
            >
              <button
                type="button"
                onClick={handleProfileClick}
                className="w-full border-b border-slate-100 p-4 text-left transition-colors hover:bg-slate-50"
              >
                <p className="font-semibold text-slate-800">{user?.fullName || user?.username || 'Пользователь'}</p>
                <p className="mt-0.5 text-sm text-slate-500">{user?.phone || user?.username || '—'}</p>
              </button>

              <div className="p-2">
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full rounded-lg px-3 py-2.5 text-left text-red-600 transition-colors hover:bg-red-50"
                >
                  <span className="flex items-center gap-3">
                    <LogOut className="h-4 w-4" />
                    <span>Выход</span>
                  </span>
                </button>
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
