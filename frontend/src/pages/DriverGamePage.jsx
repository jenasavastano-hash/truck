import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../api';
import { ChevronLeft, Trophy, Gamepad2, Loader2, X, Medal, ShoppingBag, Zap, Heart, Magnet, ArrowUp, Award } from 'lucide-react';
import FreightRunnerGame from '../components/driver/FreightRunnerGame';
import { useAuth } from '../AuthContext';

const GAME_BASE = `${(import.meta.env.BASE_URL || '').replace(/\/$/, '')}/game`;
const BOOST_ICONS = { magnet: Magnet, nitro: Zap, jump: ArrowUp, extra_life: Heart };
const BOOST_NAMES = { magnet: 'Магнит', nitro: 'Нитро', jump: 'Прыжок', extra_life: 'Доп. жизнь' };

function BuyBoostInRunControls({ itemId, unitPrice, driverBalance, onConfirm, onCancel }) {
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);
  const total = unitPrice * quantity;
  const canBuy = driverBalance != null && driverBalance >= total;
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-slate-300 text-sm font-medium mb-2">Количество: {quantity}</label>
        <input
          type="range"
          min={1}
          max={10}
          value={quantity}
          onChange={(e) => setQuantity(Number(e.target.value))}
          className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-slate-600 accent-amber-500"
        />
      </div>
      <p className="text-amber-400 font-semibold">{unitPrice} ₽ × {quantity} = {total} ₽</p>
      <div className="flex gap-3">
        <button type="button" onClick={onCancel} className="flex-1 py-2.5 rounded-xl bg-slate-600 hover:bg-slate-500 text-white font-medium">Отмена</button>
        <button
          type="button"
          disabled={!canBuy || loading}
          onClick={async () => {
            setLoading(true);
            try {
              await onConfirm(quantity);
            } catch (e) {
              alert(e.response?.data?.error || 'Ошибка покупки');
            } finally {
              setLoading(false);
            }
          }}
          className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-bold"
        >
          {loading ? '...' : `Оплатить ${total} ₽`}
        </button>
      </div>
    </div>
  );
}
const BOOST_DESC = {
  magnet: 'Притягивает монеты к грузовику на время',
  nitro: 'Ускорение на несколько секунд',
  jump: 'Перепрыгнуть через машины (неуязвимость)',
  extra_life: 'Воскрешение без потери очков'
};
const BOOST_IMG = (id) => `${GAME_BASE}/boost_${id}.png`;

export default function DriverGamePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [leaderboard, setLeaderboard] = useState({ list: [], period: 'day', date: '' });
  const [period, setPeriod] = useState('day');
  const [dateStr, setDateStr] = useState('');
  const [loadingLb, setLoadingLb] = useState(false);
  const [history, setHistory] = useState({ list: [] });
  const [showGame, setShowGame] = useState(false);
  const [showLeaderboardModal, setShowLeaderboardModal] = useState(false);
  const [showShop, setShowShop] = useState(false);
  const [showAchievements, setShowAchievements] = useState(false);
  const [achievements, setAchievements] = useState({ list: [] });
  const [serverInventory, setServerInventory] = useState({ extraLives: 0, skins: [], magnet: 0, nitro: 0, jump: 0 });
  const [buyBoostModal, setBuyBoostModal] = useState(null); // { itemId, onPurchased }
  const [confirmPurchase, setConfirmPurchase] = useState(null); // { itemId, name, price, isPoints } для модалки подтверждения в магазине
  const SHOP_COINS_KEY = 'freight_driver_coins';
  const SHOP_DATA_KEY = 'freight_driver_shop';
  const [shopCoins, setShopCoins] = useState(() => {
    try {
      const cur = localStorage.getItem(SHOP_COINS_KEY);
      if (cur != null) return parseInt(cur, 10) || 0;
      const old = localStorage.getItem('taxi_driver_coins');
      if (old != null) {
        localStorage.setItem(SHOP_COINS_KEY, old);
        return parseInt(old, 10) || 0;
      }
      return 0;
    } catch { return 0; }
  });
  const [shopData, setShopData] = useState(() => {
    try {
      let raw = localStorage.getItem(SHOP_DATA_KEY);
      if (!raw && localStorage.getItem('taxi_driver_shop')) {
        raw = localStorage.getItem('taxi_driver_shop');
        localStorage.setItem(SHOP_DATA_KEY, raw);
      }
      const data = raw ? JSON.parse(raw) : { extraLives: 0, equippedSkin: 'default' };
      return {
        extraLives: data.extraLives || 0,
        equippedSkin: data.equippedSkin || 'default',
        magnet: data.magnet || 0,
        nitro: data.nitro || 0,
        jump: data.jump || 0
      };
    } catch { return { extraLives: 0, equippedSkin: 'default', magnet: 0, nitro: 0, jump: 0 }; }
  });
  const saveShop = (coins, data) => {
    try {
      if (coins != null) { localStorage.setItem(SHOP_COINS_KEY, String(coins)); setShopCoins(coins); }
      if (data != null) { localStorage.setItem(SHOP_DATA_KEY, JSON.stringify(data)); setShopData(data); }
    } catch (_) {}
  };
  const [serverExtraLivesUsed, setServerExtraLivesUsed] = useState(0);
  const serverExtraLivesUsedRef = useRef(0);
  const pendingGameOverRef = useRef(null);
  const [driverBalance, setDriverBalance] = useState(null);
  const [totalPoints, setTotalPoints] = useState(0);
  const totalExtraLives = (shopData.extraLives || 0) + (serverInventory.extraLives || 0) - serverExtraLivesUsed;
  const initialBoostInventory = {
    magnet: (shopData.magnet || 0) + (serverInventory.magnet || 0),
    nitro: (shopData.nitro || 0) + (serverInventory.nitro || 0),
    jump: (shopData.jump || 0) + (serverInventory.jump || 0)
  };
  const shopConfig = settings?.shopConfig || { currencyType: 'points', magnet: 200, nitro: 200, jump: 200, extra_life: 500 };
  const isShopReal = shopConfig.currencyType === 'real';

  const buyWithPoints = (itemId, price) => {
    if (shopCoins < price) return;
    const newCoins = shopCoins - price;
    let newData = { ...shopData };
    if (itemId === 'extra_life') newData.extraLives = (newData.extraLives || 0) + 1;
    if (itemId === 'magnet') newData.magnet = (newData.magnet || 0) + 1;
    if (itemId === 'nitro') newData.nitro = (newData.nitro || 0) + 1;
    if (itemId === 'jump') newData.jump = (newData.jump || 0) + 1;
    if (itemId.startsWith('skin_')) newData.equippedSkin = itemId;
    setShopCoins(newCoins);
    setShopData(newData);
    saveShop(newCoins, newData);
  };

  const buyWithReal = async (itemId, quantity = 1) => {
    try {
      const res = await api.post('/driver/game/shop/purchase', { itemId, currency: 'real', quantity });
      const invRes = await api.get('/driver/game/inventory');
      setServerInventory(invRes.data || { extraLives: 0, skins: [], magnet: 0, nitro: 0, jump: 0 });
      if (res.data?.balance != null) setDriverBalance(res.data.balance);
      else api.get('/driver/balance').then((r) => { if (r.data?.balance != null) setDriverBalance(r.data.balance); }).catch(() => {});
    } catch (e) {
      throw e;
    }
  };

  const useExtraLifeForRun = () => {
    if (totalExtraLives <= 0) return 0;
    if ((shopData.extraLives || 0) > 0) {
      const newData = { ...shopData, extraLives: Math.max(0, (shopData.extraLives || 0) - 1) };
      setShopData(newData);
      saveShop(null, newData);
      return 1;
    }
    serverExtraLivesUsedRef.current += 1;
    setServerExtraLivesUsed((u) => u + 1);
    return 1;
  };

  function getTodayMsk() {
    const now = new Date();
    const msk = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
    const y = msk.getFullYear();
    const m = String(msk.getMonth() + 1).padStart(2, '0');
    const d = String(msk.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const refreshLeaderboard = useCallback(() => {
    const d = dateStr || getTodayMsk();
    setLoadingLb(true);
    api.get(`/driver/game/leaderboard?period=${period}&date=${d}`)
      .then((res) => setLeaderboard(res.data))
      .catch(() => setLeaderboard((prev) => ({ ...prev, list: [] })))
      .finally(() => setLoadingLb(false));
  }, [period, dateStr]);

  const refreshHistory = useCallback(() => {
    api.get('/driver/game/history?limit=1').then((res) => setHistory(res.data || { list: [] })).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.get('/driver/game/settings')
      .then((res) => { if (!cancelled) setSettings(res.data); })
      .catch(() => { if (!cancelled) setSettings({ gameEnabled: false }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!settings?.gameEnabled) return;
    const d = dateStr || getTodayMsk();
    setLoadingLb(true);
    api.get(`/driver/game/leaderboard?period=${period}&date=${d}`)
      .then((res) => setLeaderboard(res.data))
      .catch(() => setLeaderboard((prev) => ({ ...prev, list: [] })))
      .finally(() => setLoadingLb(false));
  }, [settings?.gameEnabled, period, dateStr]);

  useEffect(() => {
    if (!settings?.gameEnabled) return;
    api.get('/driver/game/history?limit=1').then((res) => setHistory(res.data || { list: [] })).catch(() => {});
  }, [settings?.gameEnabled]);

  useEffect(() => {
    if (!settings?.gameEnabled) return;
    api.get('/driver/game/inventory').then((r) => setServerInventory(r.data || { extraLives: 0, skins: [], magnet: 0, nitro: 0, jump: 0 })).catch(() => {});
    api.get('/driver/game/achievements').then((r) => setAchievements(r.data || { list: [] })).catch(() => {});
    api.get('/driver/game/points').then((r) => setTotalPoints(r.data?.totalPoints ?? 0)).catch(() => {});
  }, [settings?.gameEnabled]);


  useEffect(() => {
    if (showShop && shopConfig.currencyType === 'real') {
      api.get('/driver/balance').then((r) => setDriverBalance(r.data?.balance ?? 0)).catch(() => setDriverBalance(0));
    }
  }, [showShop, shopConfig.currencyType]);
  useEffect(() => {
    if (buyBoostModal && isShopReal) {
      api.get('/driver/balance').then((r) => setDriverBalance(r.data?.balance ?? 0)).catch(() => {});
    }
  }, [buyBoostModal, isShopReal]);

  // При открытии достижений — выдать неполученные награды (очки)
  useEffect(() => {
    if (!showAchievements || !achievements.list?.length) return;
    const toGrant = achievements.list.filter((a) => a.completedAt && !a.rewardGrantedAt && (a.rewardDesc || '').includes('очков'));
    if (toGrant.length === 0) return;
    let added = 0;
    toGrant.forEach((a) => {
      api.post('/driver/game/achievement-grant', { achievementId: a.id })
        .then((res) => {
          if (res.data?.pointsToAdd) {
            added += res.data.pointsToAdd;
            setShopCoins((c) => { const n = c + res.data.pointsToAdd; try { localStorage.setItem(SHOP_COINS_KEY, String(n)); } catch (_) {} return n; });
          }
          api.get('/driver/game/achievements').then((r) => setAchievements(r.data || { list: [] })).catch(() => {});
        })
        .catch(() => {});
    });
  }, [showAchievements]);

  const myRank = leaderboard.list.find((r) => String(r.userId) === String(user?.id))?.rank ?? null;
  const refreshTotalPoints = useCallback(() => {
    api.get('/driver/game/points').then((r) => setTotalPoints(r.data?.totalPoints ?? 0)).catch(() => {});
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-amber-950/30 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 text-amber-400 animate-spin mx-auto mb-3" />
          <p className="text-slate-300">Загрузка...</p>
        </div>
      </div>
    );
  }

  if (!settings?.gameEnabled) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-amber-950/30 flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-slate-800/90 rounded-2xl shadow-2xl p-8 max-w-sm text-center border border-amber-500/20">
          <Gamepad2 className="w-12 h-12 text-amber-500/50 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-white mb-2">Игра отключена</h2>
          <p className="text-slate-400 text-sm mb-6">Для вашего парка мини-игра не включена.</p>
          <button
            type="button"
            onClick={() => navigate('/driver')}
            className="w-full py-3 px-4 rounded-xl bg-amber-500/20 text-amber-300 font-medium hover:bg-amber-500/30 border border-amber-500/30"
          >
            В кабинет
          </button>
        </motion.div>
      </div>
    );
  }

  const MENU_BG = `${GAME_BASE}/menu_bg.png`;
  const LOGO_IMG = `${GAME_BASE}/logo.png`;

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Задний план: текстура + градиент */}
      <div
        className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-amber-950/50"
        style={{
          backgroundImage: `url(${MENU_BG}), linear-gradient(135deg, rgba(15,23,42,0.97) 0%, rgba(30,41,59,0.95) 50%, rgba(120,53,15,0.2) 100%)`,
          backgroundSize: 'cover, cover',
          backgroundPosition: 'center, center'
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(245,158,11,0.12),transparent)]" />
      <div className="absolute inset-0 bg-slate-900/75 backdrop-blur-[2px]" />

      {/* Шапка: назад + подложка под общий счёт */}
      <header className="relative z-20 bg-slate-800/60 backdrop-blur-md border-b border-amber-500/20 sticky top-0 shadow-lg shadow-black/30">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate('/driver')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-700/90 hover:bg-slate-600 text-slate-200 hover:text-white border border-slate-500/50 hover:border-amber-500/30 shadow-md hover:shadow-amber-500/10 transition-all duration-200 active:scale-[0.98]"
            aria-label="В главное меню"
          >
            <ChevronLeft className="w-5 h-5" />
            <span className="text-sm font-semibold hidden sm:inline">Назад</span>
          </button>
          {/* Общее кол-во очков — красивая подложка */}
          <div className="rounded-2xl bg-gradient-to-br from-amber-500/25 to-amber-600/15 border border-amber-500/40 px-5 py-2.5 shadow-lg shadow-amber-900/30 min-w-[120px] text-center">
            <p className="text-amber-200/90 text-xs font-semibold uppercase tracking-wide">Очки</p>
            <p className="text-amber-300 font-bold text-xl tabular-nums drop-shadow-sm">{totalPoints}</p>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-2xl mx-auto px-4 py-8 flex flex-col items-center justify-center min-h-[calc(100vh-120px)]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm space-y-5"
        >
          {/* Карточка меню */}
          <div className="rounded-3xl bg-slate-800/70 backdrop-blur-md border border-amber-500/25 shadow-2xl shadow-black/40 p-8 pb-8">
            {/* Один блок: крупный лого как слой, текст сверху */}
            <div
              className="relative rounded-2xl overflow-hidden mb-6 min-h-[160px] flex flex-col justify-end bg-slate-900/60 border border-amber-500/20"
              style={{
                backgroundImage: `url(${LOGO_IMG})`,
                backgroundSize: '160px auto',
                backgroundPosition: 'center center',
                backgroundRepeat: 'no-repeat'
              }}
            >
              <div className="relative z-10 text-center pt-5 pb-4 px-2">
                <h1 className="text-2xl font-bold text-white flex items-center justify-center gap-2 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
                  <Gamepad2 className="w-8 h-8 text-amber-400 shrink-0" />
                  Грузоранер
                </h1>
                <p className="text-slate-300 text-sm mt-1 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">Собирай монеты, объезжай препятствия</p>
              </div>
            </div>

            {/* 1. Кнопка Новая игра — один слой, без картинки */}
            <button
              type="button"
              onClick={() => { serverExtraLivesUsedRef.current = 0; setServerExtraLivesUsed(0); setShowGame(true); }}
              className="w-full py-4 px-6 rounded-2xl font-bold text-lg text-slate-900 flex items-center justify-center gap-3 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] mb-5 bg-gradient-to-b from-amber-400 to-amber-600 hover:from-amber-500 hover:to-amber-700"
            >
              <Gamepad2 className="w-6 h-6" />
              Новая игра
            </button>

            {/* 2. Бусты в заезде + покупка */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-5 p-4 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/30"
            >
              <p className="text-xs font-semibold text-amber-200/90 mb-2">Бусты в заезде</p>
              <p className="text-slate-400 text-xs mb-3">Что есть — попадёт в заезд. Покупай здесь или в Магазине.</p>
              <div className="flex flex-col gap-2">
                {[
                  { id: 'magnet', name: 'Магнит', have: (shopData.magnet || 0) + (serverInventory.magnet || 0), price: shopConfig.magnet },
                  { id: 'nitro', name: 'Нитро', have: (shopData.nitro || 0) + (serverInventory.nitro || 0), price: shopConfig.nitro },
                  { id: 'jump', name: 'Прыжок', have: (shopData.jump || 0) + (serverInventory.jump || 0), price: shopConfig.jump },
                  { id: 'extra_life', name: 'Доп. жизнь', have: totalExtraLives, price: shopConfig.extra_life }
                ].map(({ id, name, have, price }) => {
                  const canBuy = isShopReal ? (driverBalance != null && driverBalance >= price) : (shopCoins >= price);
                  return (
                    <motion.div
                      key={id}
                      whileHover={{ scale: 1.01 }}
                      className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-slate-800/80 border border-amber-500/30"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-slate-900/80 border border-amber-500/20 flex items-center justify-center shrink-0">
                          <img src={BOOST_IMG(id)} alt="" className="w-5 h-5 object-contain" onError={(e) => { e.target.style.display = 'none'; }} />
                        </div>
                        <span className="text-slate-300 text-sm font-medium">{name}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-amber-400 font-bold text-sm tabular-nums bg-amber-500/20 px-2 py-0.5 rounded">×{have}</span>
                        <button
                          type="button"
                          onClick={() => isShopReal ? buyWithReal(id).catch((e) => alert(e.response?.data?.error || 'Ошибка')) : buyWithPoints(id, price)}
                          disabled={!canBuy}
                          className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-semibold text-xs shadow border border-amber-400/50 active:scale-[0.98]"
                        >
                          {isShopReal ? `${price} ₽` : `${price} очк.`}
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
              <p className="text-slate-500 text-xs mt-2">В заезде: подбираешь с дороги или активируешь купленные кнопкой.</p>
            </motion.div>

            {/* 3. Лидерборд — один слой */}
            <button
              type="button"
              onClick={() => setShowLeaderboardModal(true)}
              className="w-full py-3.5 px-6 rounded-2xl font-semibold text-slate-200 flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.98] hover:opacity-95 bg-slate-700 hover:bg-slate-600"
            >
              <Trophy className="w-5 h-5 text-amber-400" />
              Лидерборд
            </button>

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => setShowShop(true)}
                className="flex-1 py-3 px-4 rounded-2xl font-semibold text-slate-200 bg-slate-700/90 hover:bg-slate-600 border border-slate-500/50 hover:border-amber-500/30 flex items-center justify-center gap-2 shadow-lg transition-all duration-200 active:scale-[0.98]"
              >
                <ShoppingBag className="w-5 h-5 text-amber-400" />
                Магазин
              </button>
              <button
                type="button"
                onClick={() => setShowAchievements(true)}
                className="flex-1 py-3 px-4 rounded-2xl font-semibold text-slate-200 bg-slate-700/90 hover:bg-slate-600 border border-slate-500/50 hover:border-amber-500/30 flex items-center justify-center gap-2 shadow-lg transition-all duration-200 active:scale-[0.98]"
              >
                <Award className="w-5 h-5 text-amber-400" />
                Достижения
              </button>
            </div>
            <p className="text-center text-slate-500 text-xs mt-3">
              {shopConfig.currencyType === 'real' ? (
                driverBalance != null ? <>Баланс: <span className="text-amber-400 font-medium">{driverBalance} ₽</span></> : null
              ) : (
                <>Очков для магазина: <span className="text-amber-400 font-medium">{shopCoins}</span></>
              )}
            </p>
          </div>
        </motion.div>
      </main>

      {/* Модалка лидерборда: день / неделя / месяц, место водителя */}
      <AnimatePresence>
        {showLeaderboardModal && (
          <motion.div
            key="leaderboard-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowLeaderboardModal(false)}
          >
            <motion.div
              key="leaderboard-content"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-800/95 backdrop-blur-md border border-amber-500/30 rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden"
            >
              <div className="p-4 border-b border-slate-600/80 flex items-center justify-between bg-slate-800/50">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-amber-400" />
                  Лидерборд
                </h2>
                <button
                  type="button"
                  onClick={() => setShowLeaderboardModal(false)}
                  className="p-2.5 rounded-xl bg-slate-700/80 hover:bg-slate-600 text-slate-400 hover:text-white border border-slate-600 transition-colors"
                  aria-label="Закрыть"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-3 border-b border-slate-700 flex gap-2">
                {['day', 'week', 'month'].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPeriod(p)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                      period === p
                        ? 'bg-amber-500 text-slate-900 shadow-lg shadow-amber-500/30 border border-amber-400/50'
                        : 'bg-slate-700/80 text-slate-300 hover:bg-slate-600 border border-slate-600 hover:border-amber-500/20'
                    }`}
                  >
                    {p === 'day' ? 'День' : p === 'week' ? 'Неделя' : 'Месяц'}
                  </button>
                ))}
              </div>
              {myRank != null && (
                <div className="mx-4 mt-3 py-2 px-3 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center gap-2">
                  <Medal className="w-4 h-4 text-amber-400" />
                  <span className="text-amber-200 text-sm font-medium">Ты на месте {myRank}</span>
                </div>
              )}
              <div className="flex-1 overflow-y-auto p-4 min-h-[200px]">
                {loadingLb ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
                  </div>
                ) : leaderboard.list.length === 0 ? (
                  <p className="text-slate-400 text-center py-8">Пока никого нет. Сыграй первым!</p>
                ) : (
                  <ul className="space-y-2">
                    {leaderboard.list.map((row) => {
                      const isMe = String(row.userId) === String(user?.id);
                      return (
                        <li
                          key={row.userId}
                          className={`flex items-center justify-between py-3 px-4 rounded-xl ${
                            isMe ? 'bg-amber-500/20 border border-amber-500/40' : 'bg-slate-700/50'
                          }`}
                        >
                          <span className="font-medium text-white flex items-center gap-2">
                            <span className="text-amber-400 w-6">#{row.rank}</span>
                            {row.fullName}
                            {isMe && <span className="text-amber-400 text-xs">(ты)</span>}
                          </span>
                          <span className="text-amber-400 font-bold tabular-nums">{row.totalScore}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Магазин: бусты и скины */}
      <AnimatePresence>
        {showShop && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => { setShowShop(false); setConfirmPurchase(null); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="relative bg-slate-800/95 backdrop-blur-md border border-amber-500/30 rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden"
            >
              {confirmPurchase && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 rounded-2xl p-4">
                  <div className="bg-slate-800 border border-amber-500/40 rounded-xl p-5 shadow-xl max-w-xs w-full">
                    <p className="text-white font-semibold mb-1">Подтвердить покупку</p>
                    <p className="text-slate-300 text-sm mb-4">
                      Купить <span className="text-amber-400 font-medium">{confirmPurchase.name}</span> за{' '}
                      {confirmPurchase.isPoints ? `${confirmPurchase.price} очков` : `${confirmPurchase.price} ₽`}?
                    </p>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => setConfirmPurchase(null)}
                        className="flex-1 py-2.5 rounded-xl bg-slate-600 hover:bg-slate-500 text-white font-medium text-sm"
                      >
                        Отмена
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirmPurchase.isPoints) {
                            buyWithPoints(confirmPurchase.itemId, confirmPurchase.price);
                          } else {
                            buyWithReal(confirmPurchase.itemId).catch((e) => alert(e.response?.data?.error || 'Ошибка покупки'));
                          }
                          setConfirmPurchase(null);
                        }}
                        className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm"
                      >
                        Подтвердить
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <div className="p-4 border-b border-slate-600/80 flex items-center justify-between bg-slate-800/50">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <ShoppingBag className="w-5 h-5 text-amber-400" />
                  Магазин
                </h2>
                <button type="button" onClick={() => setShowShop(false)} className="p-2.5 rounded-xl bg-slate-700/80 hover:bg-slate-600 text-slate-400 hover:text-white border border-slate-600 transition-colors" aria-label="Закрыть"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-3 border-b border-slate-700 flex items-center justify-between">
                {isShopReal ? (
                  <span className="text-slate-300 text-sm">Баланс: <span className="text-amber-400 font-bold">{driverBalance != null ? `${driverBalance} ₽` : '—'}</span></span>
                ) : (
                  <span className="text-slate-300 text-sm">Очки: <span className="text-amber-400 font-bold">{shopCoins}</span></span>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <p className="text-sm font-semibold text-amber-200/90">Бусты</p>
                {['magnet', 'nitro', 'jump', 'extra_life'].map((id) => {
                  const Icon = BOOST_ICONS[id];
                  const price = shopConfig[id] != null ? Number(shopConfig[id]) : 200;
                  const isPoints = !isShopReal;
                  const canBuy = isPoints ? shopCoins >= price : (driverBalance != null && driverBalance >= price);
                  return (
                    <motion.div
                      key={id}
                      whileHover={{ scale: 1.02 }}
                      className="p-4 rounded-xl bg-slate-700/80 border border-slate-600 hover:border-amber-500/30 flex items-center gap-4 transition-colors"
                    >
                      <div className="w-16 h-16 rounded-2xl bg-slate-900/90 border border-amber-500/25 flex items-center justify-center shrink-0 overflow-hidden relative ring-1 ring-inset ring-white/5">
                        <img src={BOOST_IMG(id)} alt="" className="w-11 h-11 object-contain relative z-10 drop-shadow-sm" onError={(e) => { e.target.style.opacity = '0'; }} />
                        <span className="absolute inset-0 flex items-center justify-center z-0">{Icon && <Icon className="w-7 h-7 text-amber-400" />}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-white">{BOOST_NAMES[id]}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{BOOST_DESC[id]}</p>
                        <p className="text-amber-400 text-sm mt-1">{isPoints ? `${price} очков` : `${price} ₽`}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setConfirmPurchase({ itemId: id, name: BOOST_NAMES[id], price, isPoints: !isShopReal })}
                        disabled={!canBuy}
                        className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-semibold text-sm shadow-lg shadow-amber-900/20 border border-amber-400/30"
                      >
                        Купить
                      </button>
                    </motion.div>
                  );
                })}
                <p className="text-sm font-semibold text-amber-200/90 pt-2">Скины</p>
                {['skin_red', 'skin_blue'].map((id) => (
                  <motion.div
                    key={id}
                    whileHover={{ scale: 1.02 }}
                    className="p-4 rounded-xl bg-slate-700/80 border border-slate-600 hover:border-amber-500/30 flex items-center gap-4 transition-colors"
                  >
                    <div className="w-14 h-14 rounded-xl border border-amber-500/20 flex items-center justify-center shrink-0" style={{ background: id === 'skin_red' ? '#dc2626' : id === 'skin_blue' ? '#2563eb' : '#475569' }} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white">{id === 'skin_red' ? 'Красный' : 'Синий'}</p>
                      <p className="text-amber-400 text-sm">800 очков</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setConfirmPurchase({ itemId: id, name: id === 'skin_red' ? 'Красный скин' : 'Синий скин', price: 800, isPoints: true })}
                      disabled={shopCoins < 800}
                      className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-semibold text-sm shadow-lg shadow-amber-900/20 border border-amber-400/30"
                    >
                      Купить
                    </button>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Достижения */}
      <AnimatePresence>
        {showAchievements && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowAchievements(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-800/95 backdrop-blur-md border border-amber-500/30 rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden"
            >
              <div className="p-4 border-b border-slate-600/80 flex items-center justify-between bg-slate-800/50">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Award className="w-5 h-5 text-amber-400" />
                  Достижения
                </h2>
                <button type="button" onClick={() => setShowAchievements(false)} className="p-2.5 rounded-xl bg-slate-700/80 hover:bg-slate-600 text-slate-400 hover:text-white border border-slate-600 transition-colors" aria-label="Закрыть"><X className="w-5 h-5" /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {(achievements.list || []).length === 0 ? (
                  <p className="text-slate-400 text-center py-8">Пока нет достижений. Играй и открывай новые!</p>
                ) : (
                  (achievements.list || []).map((a) => (
                    <motion.div
                      key={a.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`p-4 rounded-xl border transition-colors ${a.completedAt ? 'bg-amber-500/10 border-amber-500/40 shadow-lg shadow-amber-900/10' : 'bg-slate-700/50 border-slate-600 hover:border-amber-500/20'}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${a.completedAt ? 'bg-amber-500/30 border-amber-500/50' : 'bg-slate-600 border-slate-500'}`}>
                          <Award className={`w-5 h-5 ${a.completedAt ? 'text-amber-400' : 'text-slate-400'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-white">{a.name}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{a.description}</p>
                          <div className="mt-2 h-2 rounded-full bg-slate-600 overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${Math.min(100, (a.progress / (a.target || 1)) * 100)}%` }}
                              transition={{ type: 'spring', stiffness: 80, damping: 18 }}
                              className="h-full bg-gradient-to-r from-amber-500 to-amber-400 rounded-full"
                            />
                          </div>
                          <p className="text-xs text-amber-400 mt-1">{a.progress} / {a.target} · {a.rewardDesc}</p>
                        </div>
                        {a.completedAt && <span className="text-amber-400 shrink-0 text-lg" title="Выполнено">✓</span>}
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Модалка покупки буста во время заезда (нет буста — пауза, предложить купить) */}
      <AnimatePresence>
        {buyBoostModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
            onClick={() => { buyBoostModal?.onCancel?.(); setBuyBoostModal(null); }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-800/95 border border-amber-500/30 rounded-2xl shadow-2xl w-full max-w-sm p-6"
            >
              <h3 className="text-lg font-bold text-white mb-2">Купить {BOOST_NAMES[buyBoostModal.itemId] || buyBoostModal.itemId}?</h3>
              <p className="text-slate-400 text-sm mb-4">Бустов нет. Оплата с баланса.</p>
              <BuyBoostInRunControls
                itemId={buyBoostModal.itemId}
                unitPrice={shopConfig[buyBoostModal.itemId] != null ? Number(shopConfig[buyBoostModal.itemId]) : 50}
                driverBalance={driverBalance}
                onConfirm={async (quantity) => {
                  await buyWithReal(buyBoostModal.itemId, quantity);
                  buyBoostModal.onPurchased(quantity);
                  setBuyBoostModal(null);
                }}
                onCancel={() => {
                buyBoostModal.onCancel?.();
                setBuyBoostModal(null);
              }}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showGame && (
          <motion.div
            key="game-screen"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="fixed inset-0 z-50"
          >
            <FreightRunnerGame
          initialExtraLives={totalExtraLives}
          initialBoostInventory={initialBoostInventory}
          onClose={() => {
            setShowGame(false);
            refreshHistory();
            refreshLeaderboard();
            refreshTotalPoints();
          }}
          onShowLeaderboard={() => {
            setShowGame(false);
            setShowLeaderboardModal(true);
            refreshLeaderboard();
            refreshHistory();
            refreshTotalPoints();
          }}
          onCoinsEarned={(coins) => {
            setShopCoins((c) => { const n = c + coins; try { localStorage.setItem(SHOP_COINS_KEY, String(n)); } catch (_) {} return n; });
          }}
          onUseExtraLife={useExtraLifeForRun}
          onBoostUsed={(itemId) => {
            setShopData((prev) => {
              const next = { ...prev, [itemId]: Math.max(0, (prev[itemId] || 0) - 1) };
              try { localStorage.setItem(SHOP_DATA_KEY, JSON.stringify(next)); } catch (_) {}
              return next;
            });
          }}
          onRequestBuyBoost={isShopReal ? (itemId, onPurchased, onCancel) => setBuyBoostModal({ itemId, onPurchased, onCancel }) : undefined}
          onDoubleCoins={isShopReal ? async (scoreToDouble) => {
            const r = await api.post('/driver/game/double-coins');
            setShopCoins((c) => c + (scoreToDouble || 0));
            if (r.data?.balance != null) setDriverBalance(r.data.balance);
            else api.get('/driver/balance').then((res) => { if (res.data?.balance != null) setDriverBalance(res.data.balance); }).catch(() => {});
            const pending = pendingGameOverRef.current;
            if (pending) {
              try {
                await api.post('/driver/game/score', { score: pending.finalScore * 2, coinsEarned: (pending.coinsEarned || 0) * 2 });
                api.get('/driver/game/achievements').then((res) => setAchievements(res.data || { list: [] })).catch(() => {});
                refreshLeaderboard();
                refreshHistory();
                refreshTotalPoints();
              } catch (_) {}
              pendingGameOverRef.current = null;
            }
            return { balance: r.data?.balance };
          } : undefined}
          onLeaveGameOver={() => {
            const pending = pendingGameOverRef.current;
            if (!pending) return;
            pendingGameOverRef.current = null;
            api.post('/driver/game/score', { score: pending.finalScore, coinsEarned: pending.coinsEarned || 0 }).then(() => {
              api.get('/driver/game/achievements').then((r) => setAchievements(r.data || { list: [] })).catch(() => {});
              refreshLeaderboard();
              refreshHistory();
              refreshTotalPoints();
            }).catch(() => {});
          }}
          onGameOver={async (finalScore, coinsEarned) => {
            pendingGameOverRef.current = { finalScore, coinsEarned: coinsEarned || 0 };
            try {
              const used = serverExtraLivesUsedRef.current;
              if (used > 0) {
                try {
                  await api.post('/driver/game/inventory/use', { itemId: 'extra_life', quantity: used });
                  setServerExtraLivesUsed(0);
                  const inv = await api.get('/driver/game/inventory');
                  setServerInventory(inv.data || { extraLives: 0, skins: [] });
                } catch (_) {}
              }
            } catch (_) {}
          }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
