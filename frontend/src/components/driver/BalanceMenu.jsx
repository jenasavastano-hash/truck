import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wallet, Plus, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function BalanceMenu({ balance, eplPrice = 25, onOpen }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleToggle = () => {
    const next = !isOpen;
    if (next && onOpen) onOpen();
    setIsOpen(next);
  };

  const availableEpls = Math.floor(balance / eplPrice);

  return (
    <div className="relative" ref={menuRef}>
      <motion.button
        type="button"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={handleToggle}
        className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl shadow-md hover:shadow-lg transition-shadow font-semibold"
      >
        <Wallet className="w-5 h-5" />
        <span className="text-lg">₽{balance}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="absolute top-full right-0 mt-2 w-72 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden z-50"
          >
            <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-100">
              <p className="text-xs font-medium text-amber-700 uppercase tracking-wide mb-1">Текущий баланс</p>
              <p className="text-3xl font-bold text-amber-700">₽{balance}</p>
            </div>
            
            <div className="p-4 space-y-3">
              <div className="bg-slate-50 rounded-lg p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Стоимость путевого:</span>
                  <span className="font-semibold text-slate-800">{eplPrice} ₽</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Доступно путевых:</span>
                  <span className={`font-semibold ${availableEpls > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {availableEpls} шт.
                  </span>
                </div>
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  setIsOpen(false);
                  navigate('/driver/balance-topup');
                }}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-semibold hover:from-amber-600 hover:to-orange-600 transition-all shadow-md"
              >
                <Plus className="w-5 h-5" />
                Пополнить баланс
              </motion.button>

              <p className="text-xs text-slate-500 text-center">
                Оплата через ЮKassa
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
