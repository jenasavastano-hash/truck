import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Wallet, CreditCard, Shield } from 'lucide-react';
import api from '../api';
import { useToast } from '../hooks/useToast';
import Card from '../components/ui/Card';

const PRESETS = [
  { label: '100 ₽', value: 100 },
  { label: '250 ₽', value: 250 },
  { label: '500 ₽', value: 500 },
  { label: '1000 ₽', value: 1000 }
];

export default function BalanceTopup() {
  const navigate = useNavigate();
  const [amount, setAmount] = useState('100');
  const [loading, setLoading] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState(100);
  const { showToast } = useToast();

  const handlePresetClick = (value) => {
    setAmount(String(value));
    setSelectedPreset(value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const num = parseInt(amount, 10);
    if (!num || num < 100) {
      showToast('❌ Введите сумму от 100 ₽', 'error');
      return;
    }
    if (num > 100000) {
      showToast('❌ Максимум 100 000 ₽', 'error');
      return;
    }
    try {
      setLoading(true);
      const { data } = await api.post('/driver/balance/topup', { amount: num });
      if (data.confirmationUrl && data.paymentId) {
        try {
          localStorage.setItem('lastYookassaPaymentId', data.paymentId);
        } catch (_) {}
        showToast('✅ Перенаправление на оплату...', 'success');
        setTimeout(() => {
          window.location.href = data.confirmationUrl;
        }, 500);
      } else {
        showToast('❌ Не получена ссылка на оплату. Попробуйте снова.', 'error');
      }
    } catch (err) {
      showToast(`❌ ${err.response?.data?.error || err.message || 'Ошибка при создании платежа'}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const numAmount = parseInt(amount, 10) || 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-amber-50 to-slate-50">
      <div className="max-w-md mx-auto px-4 py-6">
        {/* Кнопка назад */}
        <motion.button
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => navigate('/driver')}
          className="mb-6 flex items-center gap-2 text-slate-600 hover:text-slate-900 font-semibold transition"
        >
          <ArrowLeft className="w-5 h-5" />
          Назад в панель
        </motion.button>

        {/* Основная карточка */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
        >
          {/* Красивый хедер */}
          <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 text-white px-6 py-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-white/20 backdrop-blur-sm rounded-lg">
                <Wallet className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Пополнение баланса</h1>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {/* Быстрые суммы */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-3">Быстрый выбор</label>
              <div className="grid grid-cols-4 gap-2">
                {PRESETS.map((preset) => (
                  <motion.button
                    key={preset.value}
                    type="button"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handlePresetClick(preset.value)}
                    className={`py-3 px-2 rounded-xl font-semibold text-sm transition shadow-md ${
                      selectedPreset === preset.value
                        ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {preset.label}
                  </motion.button>
                ))}
              </div>
            </div>

            {/* Своя сумма */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Своя сумма (₽)</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-500 font-bold text-lg">₽</span>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => { setAmount(e.target.value); setSelectedPreset(null); }}
                  min="100"
                  max="100000"
                  step="100"
                  className="w-full pl-12 pr-4 py-3.5 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition text-lg font-semibold"
                  placeholder="Сумма"
                />
              </div>
              <p className="text-xs text-slate-500 mt-2">От 100 ₽ до 100 000 ₽</p>
            </div>

            {/* Информация о платеже */}
            <Card className="p-5 bg-gradient-to-br from-slate-50 to-amber-50/30">
              <div className="flex justify-between items-center">
                <span className="text-slate-600 font-medium">К оплате:</span>
                <span className="text-3xl font-bold text-slate-800">₽{numAmount}</span>
              </div>
            </Card>

            {/* Информационное сообщение */}
            <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-200 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800">
                  Вы будете перенаправлены на страницу оплаты ЮKassa. Баланс обновится после успешной оплаты.
                </p>
              </div>
            </div>

            {/* Кнопки */}
            <div className="flex flex-col sm:flex-row gap-3">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                type="submit"
                disabled={loading || numAmount < 10}
                className="flex-1 py-3.5 px-4 rounded-xl font-semibold bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600 transition shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Создание платежа...
                  </>
                ) : (
                  <>
                    <CreditCard className="w-4 h-4" />
                    Перейти к оплате
                  </>
                )}
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                type="button"
                onClick={() => navigate('/driver')}
                className="px-6 py-3.5 rounded-xl font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition flex items-center justify-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Отмена
              </motion.button>
            </div>
          </form>

          {/* Футер */}
          <div className="px-6 pb-6 pt-0">
            <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
              <Shield className="w-4 h-4" />
              <span>Платёж обрабатывает ЮKassa</span>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
