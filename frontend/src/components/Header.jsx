import React from 'react';
import { useAuth } from '../AuthContext';
import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Settings, LogOut } from 'lucide-react';

const Header = () => {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <header className="bg-slate-800 text-white shadow-lg">
      <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
        {/* Пустое место слева - кнопка возврата будет в AdminPanel */}
        <div></div>

        <div className="flex items-center gap-3">
          {user && (
            <>
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <Link
                  to="/change-credentials"
                  className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-xl font-semibold transition shadow-md"
                >
                  <Settings className="w-4 h-4" />
                  <span>{user.username}</span>
                </Link>
              </motion.div>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={logout}
                className="flex items-center gap-2 bg-red-500 hover:bg-red-600 px-4 py-2 rounded-xl font-semibold transition shadow-md"
              >
                <LogOut className="w-4 h-4" />
                <span>Выход</span>
              </motion.button>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
