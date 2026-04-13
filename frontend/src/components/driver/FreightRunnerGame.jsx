import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ——— Константы игры ———
const LANES = 4;
const ROAD_LEFT = 0.12;
const ROAD_RIGHT = 0.88;
const LANE_WIDTH = (ROAD_RIGHT - ROAD_LEFT) / LANES;

// Размеры машин. Хитбоксы уже визуала (0.8 = только при реальном перекрытии, без ложных срабатываний).
const HITBOX_SCALE = 0.74;
const HIT_MIN_OVERLAP_Y = 0.048; // мин. перекрытие по вертикали — ювелирная езда без столкновения «об воздух»
const PLAYER_W = 0.20;
const PLAYER_H = 0.18;
const CAR_W = 0.18;
const CAR_H = 0.14;
const CAR_RED_W = 0.20;
const CAR_RED_H = 0.18;
const CAR_BLUE_W = 0.20;
const CAR_BLUE_H = 0.18;
const BUS_W = 0.16;
const BUS_H = 0.38;
const TRUCK_W = 0.15;
const TRUCK_H = 0.32;

const COIN_R = 0.06;
const BOOST_R = 0.055;
const BASE_SPEED = 0.0042;
const SPEED_INC = 0.000018;
const COIN_POINTS = 10;
const COMBO_TIMEOUT = 0.055;
const COMBO_MAX = 5;
const NEAR_MISS_BONUS = 50;
const NEAR_MISS_MARGIN = 0.022;
const OBSTACLE_SPAWN_CHANCE = 0.022;
const OBSTACLE_MIN_GAP = 0.28;   // мин. дистанция по полосе между машинами
const OBSTACLE_SPAWN_INTERVAL = 0.095; // мин. интервал между попытками спавна
const COIN_SPAWN_CHANCE = 0.016;
const DECOR_SPAWN_CHANCE = 0.065;
const DECOR_MIN_DIST = 0.14;
const POWERUP_SPAWN_CHANCE = 0.0045;
const MAGNET_DURATION = 2.52;  // ~10 сек
const NITRO_DURATION = 1.76;   // ~7 сек
const JUMP_DURATION = 1.76;    // ~7 сек окно прыжка
const JUMP_INVULN = 0.18;      // длительность одного перелёта (чуть дольше для читаемости анимации)
const RESPAWN_INVULN = 0.4;    // неуязвимость после воскрешения (+1 жизнь), чтобы не убило сразу
const NITRO_MULT = 1.7;
const NITRO_POINTS_MULT = 1.5; // множитель очков за дистанцию при нитро
const MAGNET_RADIUS = 0.28;    // радиус магнита вокруг грузовика (норм. координаты)
const MAGNET_PULL_SPEED = 0.08; // скорость притяжения монет к грузовику за кадр
const MAGNET_COLLECT_DIST = 0.04; // дистанция до ТС, при которой монета засчитывается
const DISTANCE_MULT = 5;
const SHAKE_TURN = 0.016;
const SHAKE_CRASH = 0.065;
const SHAKE_DECAY = 0.88;
const ZOOM = 1.04;
const FLOATING_DURATION = 0.22;
const PARTICLE_LIFE = 0.1;
const COIN_ANIM_DURATION = 0.07;
const PLAYER_Y = 0.82;
const HEADLIGHT_NEAR = 0.2;

const POWERUP_TYPES = [
  { id: 'magnet', label: 'Магнит', color: '#a78bfa' },
  { id: 'nitro', label: 'Нитро', color: '#f97316' },
  { id: 'jump', label: 'Прыжок', color: '#22d3ee' },
  { id: 'extra_life', label: '+1 жизнь', color: '#34d399' }
];

// На полосах — авто, монетки, бусты. На обочине — деревья, светофоры, знаки.
const OBSTACLE_TYPES = ['car', 'car_red', 'car_blue', 'bus', 'truck'];
const DECOR_TYPES = [
  { type: 'tree', side: 'left' },
  { type: 'tree', side: 'right' },
  { type: 'sign', side: 'left' },
  { type: 'sign', side: 'right' },
  { type: 'traffic_light', side: 'left' },
  { type: 'traffic_light', side: 'right' }
];

function obsWidth(type) {
  if (type === 'bus') return BUS_W;
  if (type === 'truck') return TRUCK_W;
  if (type === 'car_red') return CAR_RED_W;
  if (type === 'car_blue') return CAR_BLUE_W;
  return CAR_W;
}
function obsHeight(type) {
  if (type === 'bus') return BUS_H;
  if (type === 'truck') return TRUCK_H;
  if (type === 'car_red') return CAR_RED_H;
  if (type === 'car_blue') return CAR_BLUE_H;
  return CAR_H;
}

const SHOP_COINS_KEY = 'freight_driver_coins';
const LEGACY_SHOP_COINS_KEY = 'taxi_driver_coins';

function readStoredCoins() {
  try {
    const cur = localStorage.getItem(SHOP_COINS_KEY);
    if (cur != null) return parseInt(cur, 10) || 0;
    const old = localStorage.getItem(LEGACY_SHOP_COINS_KEY);
    if (old != null) {
      const n = parseInt(old, 10) || 0;
      localStorage.setItem(SHOP_COINS_KEY, String(n));
      return n;
    }
  } catch (_) {}
  return 0;
}

export default function FreightRunnerGame({
  onGameOver,
  onClose,
  onShowLeaderboard,
  onLeaveGameOver,
  onCoinsEarned,
  onUseExtraLife,
  onBoostUsed,
  onDoubleCoins,
  onRequestBuyBoost,
  initialExtraLives = 0,
  initialBoostInventory = { magnet: 0, nitro: 0, jump: 0 },
  skinId = 'default'
}) {
  const canvasRef = useRef(null);
  const [displayScore, setDisplayScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [finalCoinsEarned, setFinalCoinsEarned] = useState(0);
  const [doubleCoinsUsed, setDoubleCoinsUsed] = useState(false);
  const [doubleCoinsLoading, setDoubleCoinsLoading] = useState(false);
  const [doubleResult, setDoubleResult] = useState(null);
  const [boostInventory, setBoostInventory] = useState({ magnet: 0, nitro: 0, jump: 0 });
  const [initialBoostCounts, setInitialBoostCounts] = useState({ magnet: 0, nitro: 0, jump: 0 });
  const [foundBoostsInRun, setFoundBoostsInRun] = useState({ magnet: 0, nitro: 0, jump: 0 });
  const [extraLivesCount, setExtraLivesCount] = useState(0);
  const [countdown, setCountdown] = useState(3); // 3/2/1 = цифры, 0 = Поехали!, -1 = скрыт
  const GAME_ASSETS = `${(import.meta.env.BASE_URL || '').replace(/\/$/, '')}/game`;
  const coinsRef = useRef(0);
  const moveLaneRef = useRef({ left: () => {}, right: () => {}, jump: () => {}, activateMagnet: () => {}, activateNitro: () => {}, activateJump: () => {} });
  const onBoostUsedRef = useRef(onBoostUsed);
  const onUseExtraLifeRef = useRef(onUseExtraLife);
  const onRequestBuyBoostRef = useRef(onRequestBuyBoost);
  const submitScoreRef = useRef(() => {});
  onRequestBuyBoostRef.current = onRequestBuyBoost;

  const state = useRef({
    lane: 1,
    lanePrev: 1,
    obstacles: [],
    coins: [],
    powerUps: [],
    decors: [],
    floatingTexts: [],
    particles: [],
    speed: BASE_SPEED,
    distance: 0,
    lastObstacle: 0,
    lastDecor: 0,
    comboCount: 0,
    lastCoinDist: -1,
    running: true,
    cameraShake: 0,
    pendingGameOver: false,
    pendingRespawn: false,
    magnetUntil: 0,
    nitroUntil: 0,
    jumpUntil: 0,
    jumpActiveUntil: 0,
    respawnInvulnUntil: 0,
    extraLives: 0,
    boostInventory: { magnet: 0, nitro: 0, jump: 0 },
    nitroBonus: 0,
    gamePaused: false,
    wouldHit: false
  });

  const sprites = useRef({
    player: null,
    coin: null,
    road: null,
    road_edge_left: null,
    road_edge_right: null,
    obstacle: null,
    obstacle_car_red: null,
    obstacle_car_blue: null,
    obstacle_bus: null,
    obstacle_truck: null,
    tree: null,
    sign: null,
    traffic_light: null,
    boost_magnet: null,
    boost_nitro: null,
    boost_jump: null,
    boost_extra_life: null
  });

  useEffect(() => {
    const base = `${(import.meta.env.BASE_URL || '').replace(/\/$/, '')}/game`;
    const load = (key, files) => {
      const tryFile = (i) => {
        if (i >= files.length) return;
        const img = new Image();
        img.onload = () => { sprites.current[key] = img; };
        img.onerror = () => tryFile(i + 1);
        img.src = `${base}/${files[i]}`;
      };
      tryFile(0);
    };
    load('player', ['truck.svg', 'truck.png', 'taxi.png', 'taxi_sprite.png']);
    load('coin', ['coin.png', 'coin_sprite.png']);
    load('road', ['road.png', 'road_texture.png']);
    load('road_edge_left', ['road_edge_left.png']);
    load('road_edge_right', ['road_edge_right.png']);
    load('obstacle', ['obstacle.png', 'obstacle_sprite.png']);
    load('obstacle_car_red', ['obstacle_car_red.png']);
    load('obstacle_car_blue', ['obstacle_car_blue.png']);
    load('obstacle_bus', ['obstacle_bus.png']);
    load('obstacle_truck', ['obstacle_truck.png']);
    load('tree', ['tree.png']);
    load('sign', ['sign.png', 'road_sign.png']);
    load('traffic_light', ['traffic_light.png']);
    load('boost_magnet', ['boost_magnet.png']);
    load('boost_nitro', ['boost_nitro.png']);
    load('boost_jump', ['boost_jump.png']);
    load('boost_extra_life', ['boost_extra_life.png']);
  }, []);

  const submitScore = useCallback((finalScore, coinsEarned) => {
    if (submitted) return;
    setSubmitted(true);
    onCoinsEarned?.(coinsEarned ?? 0);
    onGameOver?.(finalScore, coinsEarned ?? 0);
  }, [onGameOver, onCoinsEarned, submitted]);

  onBoostUsedRef.current = onBoostUsed;
  onUseExtraLifeRef.current = onUseExtraLife;
  submitScoreRef.current = submitScore;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || gameOver) return;

    const ctx = canvas.getContext('2d');
    let w = 0, h = 0, animId = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      w = rect.width;
      h = rect.height;
    };
    resize();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    window.addEventListener('resize', resize);

    const s = state.current;
    s.lane = 1;
    s.lanePrev = 1;
    s.obstacles = [];
    s.coins = [];
    s.powerUps = [];
    s.decors = [];
    s.floatingTexts = [];
    s.particles = [];
    s.speed = BASE_SPEED;
    s.distance = 0;
    s.lastObstacle = 0;
    s.lastDecor = 0;
    s.comboCount = 0;
    s.lastCoinDist = -1;
    s.running = true;
    s.cameraShake = 0;
    s.pendingGameOver = false;
    s.pendingRespawn = false;
    s.finalScore = 0;
    s.magnetUntil = 0;
    s.nitroUntil = 0;
    s.jumpUntil = 0;
    s.jumpActiveUntil = 0;
    s.respawnInvulnUntil = 0;
    s.extraLives = typeof initialExtraLives === 'number' ? initialExtraLives : 0;
    const startBoosts = {
      magnet: Math.max(0, Number(initialBoostInventory?.magnet) || 0),
      nitro: Math.max(0, Number(initialBoostInventory?.nitro) || 0),
      jump: Math.max(0, Number(initialBoostInventory?.jump) || 0)
    };
    s.boostInventory = { ...startBoosts };
    s.nitroBonus = 0;
    coinsRef.current = 0;
    setBoostInventory({ ...startBoosts });
    setInitialBoostCounts({ ...startBoosts });
    setFoundBoostsInRun({ magnet: 0, nitro: 0, jump: 0 });
    setExtraLivesCount(s.extraLives);

    moveLaneRef.current.left = () => { s.lane = Math.max(0, s.lane - 1); };
    moveLaneRef.current.right = () => { s.lane = Math.min(LANES - 1, s.lane + 1); };
    moveLaneRef.current.jump = () => {
      if (s.distance < s.jumpUntil && s.distance >= s.jumpActiveUntil - JUMP_INVULN + 0.02)
        s.jumpActiveUntil = s.distance + JUMP_INVULN;
    };
    moveLaneRef.current.activateMagnet = () => {
      if (s.boostInventory.magnet > 0 && s.distance >= s.magnetUntil) {
        s.boostInventory.magnet--;
        s.magnetUntil = s.distance + MAGNET_DURATION;
        setBoostInventory((prev) => ({ ...prev, magnet: prev.magnet - 1 }));
        onBoostUsedRef.current?.('magnet');
      } else if (s.boostInventory.magnet <= 0 && onRequestBuyBoostRef.current) {
        s.gamePaused = true;
        onRequestBuyBoostRef.current('magnet', (qty) => {
          s.boostInventory.magnet += qty;
          setBoostInventory((prev) => ({ ...prev, magnet: (prev.magnet || 0) + qty }));
          s.gamePaused = false;
        }, () => { s.gamePaused = false; });
      }
    };
    moveLaneRef.current.activateNitro = () => {
      if (s.boostInventory.nitro > 0 && s.distance >= s.nitroUntil) {
        s.boostInventory.nitro--;
        s.nitroUntil = s.distance + NITRO_DURATION;
        setBoostInventory((prev) => ({ ...prev, nitro: prev.nitro - 1 }));
        onBoostUsedRef.current?.('nitro');
      } else if (s.boostInventory.nitro <= 0 && onRequestBuyBoostRef.current) {
        s.gamePaused = true;
        onRequestBuyBoostRef.current('nitro', (qty) => {
          s.boostInventory.nitro += qty;
          setBoostInventory((prev) => ({ ...prev, nitro: (prev.nitro || 0) + qty }));
          s.gamePaused = false;
        }, () => { s.gamePaused = false; });
      }
    };
    moveLaneRef.current.activateJump = () => {
      if (s.boostInventory.jump > 0 && s.distance >= s.jumpUntil) {
        s.boostInventory.jump--;
        s.jumpUntil = s.distance + JUMP_DURATION;
        setBoostInventory((prev) => ({ ...prev, jump: prev.jump - 1 }));
        onBoostUsedRef.current?.('jump');
      } else if (s.boostInventory.jump <= 0 && onRequestBuyBoostRef.current) {
        s.gamePaused = true;
        onRequestBuyBoostRef.current('jump', (qty) => {
          s.boostInventory.jump += qty;
          setBoostInventory((prev) => ({ ...prev, jump: (prev.jump || 0) + qty }));
          s.gamePaused = false;
        }, () => { s.gamePaused = false; });
      }
    };

    const laneCenterNorm = (lane) => ROAD_LEFT + (lane + 0.5) * LANE_WIDTH;
    const laneToX = (lane) => laneCenterNorm(lane) * w;
    const rLeft = () => w * ROAD_LEFT;
    const rRight = () => w * ROAD_RIGHT;
    const rW = () => rRight() - rLeft();

    function roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
    }

    function drawRoad() {
      const rL = rLeft();
      const rR = rRight();
      const width = rW();
      const edgeW = w * ROAD_LEFT;
      const laneW = width / LANES;

      // 4 полосы: рисуем каждую полосу отдельно (асфальт + опционально текстура)
      const roadImg = sprites.current.road;
      const segH = h * 0.2;
      const offset = (s.distance * h * 0.36) % segH;
      for (let lane = 0; lane < LANES; lane++) {
        const x0 = rL + lane * laneW;
        ctx.fillStyle = lane % 2 === 0 ? '#1e293b' : '#252d3d';
        ctx.fillRect(x0, 0, laneW, h);
        if (roadImg?.complete && roadImg.naturalWidth) {
          const nw = roadImg.naturalWidth;
          const nh = roadImg.naturalHeight;
          const tileW = segH * (nw / nh);
          ctx.save();
          ctx.beginPath();
          ctx.rect(x0, 0, laneW, h);
          ctx.clip();
          for (let i = -1; i <= 12; i++) {
            for (let x = 0; x < laneW + tileW; x += tileW)
              ctx.drawImage(roadImg, 0, 0, nw, nh, x0 + x, i * segH - offset, tileW, segH);
          }
          ctx.restore();
        }
      }

      ctx.fillStyle = '#334155';
      ctx.fillRect(0, 0, edgeW, h);
      ctx.fillRect(w - edgeW, 0, edgeW, h);
      const edgeImg = sprites.current.road_edge_right;
      if (edgeImg?.complete && edgeImg.naturalWidth) {
        ctx.save();
        ctx.translate(edgeW, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(edgeImg, 0, 0, edgeW, h);
        ctx.restore();
        ctx.drawImage(edgeImg, w - edgeW, 0, edgeW, h);
      }

      // Разметка: пунктир между полосами, сплошная по краям проезжей части
      const dashLen = 16;
      const gapLen = 14;
      const dashOffset = (s.distance * h * 0.32) % (dashLen + gapLen);
      ctx.setLineDash([dashLen, gapLen]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      for (let i = 1; i < LANES; i++) {
        const x = rL + i * laneW;
        ctx.beginPath();
        for (let sy = -dashOffset; sy < h + dashLen + gapLen; sy += dashLen + gapLen) {
          ctx.moveTo(x, sy);
          ctx.lineTo(x, Math.min(sy + dashLen, h));
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(rL, 0);
      ctx.lineTo(rL, h);
      ctx.moveTo(rR, 0);
      ctx.lineTo(rR, h);
      ctx.stroke();

      const decorSize = h * 0.1;
      const shoulderL = rL - decorSize * 1.5;
      const shoulderR = rR + decorSize * 0.5;
      const time = s.distance * 70;
      s.decors.forEach((d) => {
        const dy = d.y * h;
        if (dy < -60 || dy > h + 60) return;
        const dx = d.side === 'right' ? shoulderR : shoulderL;
        const img = sprites.current[d.type];
        const wobble = d.type === 'sign' ? Math.sin(time + d.y * 15) * 2 : 0;
        if (img?.complete && img.naturalWidth) {
          if (d.type === 'tree')
            ctx.drawImage(img, dx + wobble, dy - decorSize * 0.2, decorSize, decorSize);
          else
            ctx.drawImage(img, dx + wobble, dy, decorSize * 0.5, decorSize);
          if (d.type === 'traffic_light') {
            const phase = Math.floor((time * 0.12) % 3);
            const colors = ['#ef4444', '#eab308', '#22c55e'];
            ctx.fillStyle = colors[phase];
            ctx.beginPath();
            ctx.arc(dx + decorSize * 0.25, dy + decorSize * 0.2, 4, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          if (d.type === 'tree') {
            ctx.fillStyle = '#166534';
            ctx.beginPath();
            ctx.arc(dx, dy, decorSize * 0.35, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillStyle = d.type === 'traffic_light' ? '#374151' : '#fbbf24';
            ctx.fillRect(dx, dy, 8, decorSize * 0.6);
          }
        }
      });
    }

    function drawPlayer() {
      const cx = laneToX(s.lane);
      const bounce = Math.sin(s.distance * 0.5) * (h * 0.006);
      const jumpProgress = (s.jumpActiveUntil - s.distance) / JUMP_INVULN;
      const jumpLift = s.distance < (s.jumpActiveUntil || 0) ? -h * 0.12 * Math.max(0, Math.min(1, jumpProgress)) : 0;
      const y = h * PLAYER_Y + bounce + jumpLift;
      const tw = w * PLAYER_W;
      const th = h * PLAYER_H;
      if (jumpLift < 0) {
        ctx.save();
        ctx.shadowColor = 'rgba(34, 211, 238, 0.5)';
        ctx.shadowBlur = 16;
        ctx.shadowColor = 'rgba(0,0,0,0.4)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 4;
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.beginPath();
        ctx.ellipse(cx, h * PLAYER_Y + 2, tw * 0.4, th * 0.15, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.restore();
      }
      if (jumpLift < 0) {
        ctx.save();
        ctx.shadowColor = 'rgba(34, 211, 238, 0.7)';
        ctx.shadowBlur = 22;
      }
      const img = sprites.current.player;
      if (img?.complete && img.naturalWidth) {
        ctx.drawImage(img, cx - tw / 2, y - th, tw, th);
      } else {
        ctx.fillStyle = '#eab308';
        ctx.fillRect(cx - tw / 2, y - th, tw, th);
        ctx.fillStyle = '#1e2937';
        ctx.fillRect(cx - tw / 4, y - th + 4, tw / 2, th / 3);
      }
      // Фары грузовика — на кабине (передняя часть ТС)
      const blink = Math.sin(s.distance * 25) > 0;
      if (blink) {
        const r = Math.min(tw, th) * 0.07;
        const bumpY = y - th * 0.38;
        const bumpX = tw * 0.14;
        ctx.save();
        ctx.shadowColor = '#fef08a';
        ctx.shadowBlur = 3;
        ctx.fillStyle = '#fef9c3';
        ctx.beginPath();
        ctx.arc(cx - bumpX, bumpY, r, 0, Math.PI * 2);
        ctx.arc(cx + bumpX, bumpY, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();
      }
      if (jumpLift < 0) {
        ctx.shadowBlur = 0;
        ctx.restore();
      }
    }

    function drawObstacle(obs) {
      const x = obs.x * w;
      const y = obs.y * h;
      const isLong = obs.type === 'bus' || obs.type === 'truck';
      const spriteKey = obs.type === 'car' ? 'obstacle' : `obstacle_${obs.type}`;
      const img = sprites.current[spriteKey];

      if (isLong) {
        const ow = w * (obs.type === 'bus' ? BUS_W : TRUCK_W);
        const oh = h * (obs.type === 'bus' ? BUS_H : TRUCK_H);
        if (img?.complete && img.naturalWidth) {
          ctx.save();
          ctx.translate(x, y + oh / 2);
          ctx.rotate(obs.type === 'bus' ? (Math.PI / 2 + Math.PI) : (-Math.PI / 2 + Math.PI));
          ctx.drawImage(img, -oh / 2, -ow / 2, oh, ow);
          ctx.restore();
        } else {
          ctx.fillStyle = obs.type === 'bus' ? '#2563eb' : '#ea580c';
          ctx.fillRect(x - ow / 2, y, ow, oh);
        }
        const nearLong = obs.y > PLAYER_Y - HEADLIGHT_NEAR && obs.y < PLAYER_Y + 0.06;
        const obsLaneLong = Math.min(LANES - 1, Math.max(0, Math.floor((obs.x - ROAD_LEFT) / LANE_WIDTH)));
        if (nearLong && Math.abs(obsLaneLong - s.lane) <= 1 && Math.sin(s.distance * 32) > 0) {
          const r = Math.min(ow, oh) * 0.07;
          const fx = ow * 0.14;
          const fy = y + oh * 0.28;
          ctx.save();
          ctx.shadowColor = '#fef08a';
          ctx.shadowBlur = 3;
          ctx.fillStyle = '#fef9c3';
          ctx.beginPath();
          ctx.arc(x - fx, fy, r, 0, Math.PI * 2);
          ctx.arc(x + fx, fy, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.restore();
        }
      } else {
        const ow = w * obsWidth(obs.type);
        const oh = h * obsHeight(obs.type);
        if (img?.complete && img.naturalWidth) {
          ctx.save();
          ctx.translate(x, y + oh / 2);
          ctx.rotate(0);
          ctx.drawImage(img, -ow / 2, -oh / 2, ow, oh);
          ctx.restore();
        } else {
          const colors = { car: '#64748b', car_red: '#dc2626', car_blue: '#2563eb' };
          ctx.fillStyle = colors[obs.type] || '#64748b';
          ctx.fillRect(x - ow / 2, y, ow, oh);
        }
        // Фары машин — маленькие круги на капоте (перед машины), по размеру спрайта
        const near = obs.y > PLAYER_Y - HEADLIGHT_NEAR && obs.y < PLAYER_Y + 0.06;
        const obsLane = Math.min(LANES - 1, Math.max(0, Math.floor((obs.x - ROAD_LEFT) / LANE_WIDTH)));
        if (near && Math.abs(obsLane - s.lane) <= 1 && Math.sin(s.distance * 32) > 0) {
          const r = Math.min(ow, oh) * 0.07;
          const fx = ow * 0.14;
          const fy = y + oh * 0.36;
          ctx.save();
          ctx.shadowColor = '#fef08a';
          ctx.shadowBlur = 3;
          ctx.fillStyle = '#fef9c3';
          ctx.beginPath();
          ctx.arc(x - fx, fy, r, 0, Math.PI * 2);
          ctx.arc(x + fx, fy, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.restore();
        }
      }
    }

    function drawCoin(c) {
      const cx = c.x * w;
      const cy = c.y * h;
      const r = w * COIN_R;
      const collecting = c.collectedAt != null;
      const pulled = c.magnetPull && !collecting;
      const t = collecting ? Math.min(1, (s.distance - c.collectedAt) / COIN_ANIM_DURATION) : 0;
      const bounce = collecting ? 0 : pulled ? 0 : Math.sin(s.distance * 0.5 + c.x * 12) * (h * 0.014);
      const scale = collecting ? 1 + t * 1.4 : pulled ? 1.1 + Math.sin(s.distance * 6) * 0.06 : 1 + Math.sin(s.distance * 0.6 + c.x * 8) * 0.06;
      const alpha = collecting ? 1 - t * t : 1;
      const spin = collecting ? t * Math.PI * 2 : (s.distance * 1.8 + c.x * 10) % (Math.PI * 2);
      if (alpha <= 0) return;
      ctx.save();
      if (pulled) {
        ctx.shadowColor = '#a78bfa';
        ctx.shadowBlur = 12;
      }
      ctx.globalAlpha = alpha;
      ctx.translate(cx, cy + bounce);
      ctx.rotate(spin);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -(cy + bounce));
      const img = sprites.current.coin;
      if (img?.complete && img.naturalWidth)
        ctx.drawImage(img, cx - r, cy - r + bounce, r * 2, r * 2);
      else {
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(cx, cy + bounce, r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (pulled) ctx.shadowBlur = 0;
      ctx.restore();
    }

    function drawPowerUp(pu) {
      const px = pu.x * w;
      const float = Math.sin(s.distance * 0.4 + pu.x * 20) * (h * 0.012);
      const py = pu.y * h + float;
      const r = w * BOOST_R;
      const info = POWERUP_TYPES.find((t) => t.id === pu.type) || POWERUP_TYPES[0];
      const pulse = 1 + Math.sin(s.distance * 2.2 + pu.x * 15) * 0.1;
      const tilt = Math.sin(s.distance * 0.3 + pu.x * 12) * 0.08;
      const img = sprites.current['boost_' + pu.type];
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(tilt);
      ctx.scale(pulse, pulse);
      const glowPulse = 12 + Math.sin(s.distance * 3 + pu.x * 10) * 6;
      ctx.shadowColor = info.color;
      ctx.shadowBlur = glowPulse;
      if (img?.complete && img.naturalWidth) {
        ctx.drawImage(img, -r, -r, r * 2, r * 2);
      } else {
        ctx.fillStyle = info.color;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.floor(r)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pu.type === 'magnet' ? 'M' : pu.type === 'nitro' ? 'N' : pu.type === 'jump' ? 'P' : '♥', 0, 0);
      }
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    const hitTestCoin = (lane, c) => {
      const tx = laneToX(lane);
      const ty = h * PLAYER_Y;
      const cx = c.x * w;
      const cy = c.y * h;
      const cr = w * COIN_R;
      const tw = w * PLAYER_W / 2;
      const th = h * PLAYER_H / 2;
      return Math.abs(tx - cx) < tw + cr && Math.abs(ty - cy) < th + cr;
    };

    const hitTestPowerUp = (lane, pu) => {
      const tx = laneToX(lane);
      const ty = h * PLAYER_Y;
      const px = pu.x * w;
      const py = pu.y * h;
      const halfLaneW = (w * LANE_WIDTH) / 2;
      const inLane = Math.abs(px - tx) <= halfLaneW * 0.85;
      const inFront = Math.abs(ty - py) < (h * PLAYER_H) / 2 + h * BOOST_R * 0.5;
      return inLane && inFront;
    };

    const handleKey = (e) => {
      if (e.key === 'ArrowLeft') { s.lane = Math.max(0, s.lane - 1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { s.lane = Math.min(LANES - 1, s.lane + 1); e.preventDefault(); }
      else if (e.key === ' ') { moveLaneRef.current.jump(); e.preventDefault(); }
    };
    window.addEventListener('keydown', handleKey);

    let touchStartX = 0;
    let touchStartY = 0;
    let lastLaneChangeAt = 0;
    const SWIPE_MIN_PX = 95;
    const SWIPE_MAX_VERTICAL_RATIO = 2.5;
    const TAP_MAX_PX = 28;
    const LANE_CHANGE_COOLDOWN_MS = 220;
    const applyLaneChange = (delta) => {
      const now = Date.now();
      if (now - lastLaneChangeAt < LANE_CHANGE_COOLDOWN_MS) return;
      if (delta < 0) s.lane = Math.max(0, s.lane - 1);
      else if (delta > 0) s.lane = Math.min(LANES - 1, s.lane + 1);
      lastLaneChangeAt = now;
    };
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches[0]) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }
    }, { passive: true });
    canvas.addEventListener('touchend', (e) => {
      if (!e.changedTouches[0]) return;
      const tx = e.changedTouches[0].clientX;
      const ty = e.changedTouches[0].clientY;
      const dx = tx - touchStartX;
      const dy = ty - touchStartY;
      const distSq = dx * dx + dy * dy;
      const rect = canvas.getBoundingClientRect();
      const xInCanvas = tx - rect.left;
      if (distSq < TAP_MAX_PX * TAP_MAX_PX) {
        if (xInCanvas < rect.width * 0.35) applyLaneChange(-1);
        else if (xInCanvas > rect.width * 0.65) applyLaneChange(1);
        return;
      }
      if (Math.abs(dy) > Math.abs(dx) * SWIPE_MAX_VERTICAL_RATIO) return;
      if (dx < -SWIPE_MIN_PX) applyLaneChange(-1);
      else if (dx > SWIPE_MIN_PX) applyLaneChange(1);
    }, { passive: true });

    function renderFrame() {
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(ZOOM, ZOOM);
      ctx.translate(-w / 2, -h / 2);
      if (s.cameraShake > 0.002)
        ctx.translate((Math.random() - 0.5) * 2 * s.cameraShake * w, (Math.random() - 0.5) * 2 * s.cameraShake * h);
      drawRoad();
      s.obstacles.forEach(drawObstacle);
      if (s.distance < s.magnetUntil) {
        const tx = laneToX(s.lane);
        const ty = h * PLAYER_Y;
        const radiusPx = MAGNET_RADIUS * Math.min(w, h);
        const pulse = 0.94 + Math.sin(s.distance * 5) * 0.06;
        const alpha = 0.28 + Math.sin(s.distance * 4) * 0.08;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(tx, ty, radiusPx * pulse, 0, Math.PI * 2);
        const grad = ctx.createRadialGradient(tx, ty, radiusPx * 0.15, tx, ty, radiusPx * pulse);
        grad.addColorStop(0, 'rgba(167, 139, 250, 0.5)');
        grad.addColorStop(0.4, 'rgba(139, 92, 246, 0.25)');
        grad.addColorStop(0.8, 'rgba(139, 92, 246, 0.08)');
        grad.addColorStop(1, 'rgba(139, 92, 246, 0)');
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.85 + Math.sin(s.distance * 6) * 0.15;
        ctx.strokeStyle = 'rgba(196, 181, 253, 0.9)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(tx, ty, radiusPx * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 8]);
        ctx.strokeStyle = 'rgba(167, 139, 250, 0.6)';
        ctx.beginPath();
        ctx.arc(tx, ty, radiusPx * pulse * 0.97, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
      if (s.distance < s.nitroUntil) {
        const flash = 0.4 + Math.sin(s.distance * 18) * 0.35;
        ctx.save();
        ctx.globalAlpha = flash;
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#f97316';
        ctx.shadowBlur = 12;
        const drawBolt = (bx, segs) => {
          ctx.beginPath();
          ctx.moveTo(bx, 0);
          let yy = 0;
          const step = h / segs;
          for (let i = 1; i <= segs; i++) {
            yy += step * (0.7 + Math.sin(s.distance * 20 + i) * 0.3);
            const xx = bx + (Math.sin(s.distance * 25 + i * 2) * 15);
            ctx.lineTo(xx, yy);
          }
          ctx.stroke();
        };
        drawBolt(w * 0.2, 8);
        drawBolt(w * 0.8, 8);
        drawBolt(w * 0.35, 6);
        drawBolt(w * 0.65, 6);
        ctx.shadowBlur = 0;
        ctx.restore();
      }
      s.coins.forEach(drawCoin);
      s.powerUps.forEach(drawPowerUp);
      drawPlayer();
      s.floatingTexts.forEach((ft) => {
        const age = s.distance - ft.birth;
        const dur = ft.isPowerUp ? 0.32 : FLOATING_DURATION;
        if (age >= dur) return;
        const norm = age / dur;
        const alpha = 1 - norm * norm;
        const scale = 0.85 + Math.min(norm * 0.5, 0.25);
        const py = ft.y * h - age * h * 0.4;
        const px = ft.x * w;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(px, py);
        ctx.scale(scale, scale);
        ctx.font = ft.isPowerUp ? 'bold 16px sans-serif' : 'bold 13px sans-serif';
        ctx.fillStyle = ft.isPowerUp ? '#c4b5fd' : ft.text.startsWith('Близко') ? '#fbbf24' : '#fef08a';
        ctx.strokeStyle = '#1e2937';
        ctx.lineWidth = 2;
        ctx.textAlign = 'center';
        ctx.strokeText(ft.text, 0, 0);
        ctx.fillText(ft.text, 0, 0);
        ctx.restore();
      });
      s.particles.forEach((p) => {
        const age = s.distance - p.birth;
        const life = 1 - age / PARTICLE_LIFE;
        if (life <= 0) return;
        const size = 2 + life * 3;
        ctx.save();
        ctx.globalAlpha = life * life;
        ctx.fillStyle = '#fde047';
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();
      });
      if (s.comboCount >= 2) {
        ctx.save();
        ctx.font = 'bold 14px sans-serif';
        ctx.fillStyle = '#fef08a';
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 2;
        ctx.textAlign = 'right';
        ctx.strokeText(`COMBO x${s.comboCount}`, w - 10, 26);
        ctx.fillText(`COMBO x${s.comboCount}`, w - 10, 26);
        ctx.restore();
      }
      if (s.distance < s.jumpUntil) {
        const bottomY = h - 36;
        const barH = 28;
        const isWouldHit = s.wouldHit && s.distance >= (s.jumpActiveUntil || 0) - JUMP_INVULN + 0.02;
        ctx.save();
        ctx.fillStyle = isWouldHit ? 'rgba(34, 211, 238, 0.35)' : 'rgba(34, 211, 238, 0.2)';
        ctx.strokeStyle = isWouldHit ? 'rgba(34, 211, 238, 0.9)' : 'rgba(34, 211, 238, 0.6)';
        ctx.lineWidth = 2;
        roundRect(ctx, w / 2 - 140, bottomY - barH / 2, 280, barH, 14);
        ctx.fill();
        ctx.stroke();
        const pulse = 1 + Math.sin(s.distance * 10) * (isWouldHit ? 0.12 : 0.05);
        ctx.font = `bold ${Math.floor((isWouldHit ? 18 : 14) * pulse)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#0e7490';
        ctx.lineWidth = 2;
        ctx.strokeText(isWouldHit ? 'НАЖМИ ПРЫЖОК!' : 'Прыжок активен', w / 2, bottomY);
        ctx.fillText(isWouldHit ? 'НАЖМИ ПРЫЖОК!' : 'Прыжок активен', w / 2, bottomY);
        ctx.restore();
      }
      if (s.distance < s.jumpUntil && s.wouldHit && s.distance >= (s.jumpActiveUntil || 0) - JUMP_INVULN + 0.02) {
        ctx.save();
        const jumpPulse = 1 + Math.sin(s.distance * 8) * 0.1;
        ctx.font = `bold ${Math.floor(18 * jumpPulse)}px sans-serif`;
        ctx.fillStyle = '#67e8f9';
        ctx.strokeStyle = '#0e7490';
        ctx.lineWidth = 3;
        ctx.textAlign = 'center';
        ctx.strokeText('ЖМИ КНОПКУ!', w / 2, h * PLAYER_Y - h * 0.14);
        ctx.fillText('ЖМИ КНОПКУ!', w / 2, h * PLAYER_Y - h * 0.14);
        ctx.restore();
      }
      let iconX = 10;
      if (s.distance < s.magnetUntil) {
        ctx.fillStyle = '#a78bfa';
        ctx.beginPath();
        ctx.arc(iconX, 22, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('M', iconX, 24);
        iconX += 24;
      }
      if (s.distance < s.nitroUntil) {
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.arc(iconX, 22, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('N', iconX, 24);
        iconX += 24;
      }
      if (s.distance < s.jumpUntil) {
        ctx.fillStyle = '#22d3ee';
        ctx.beginPath();
        ctx.arc(iconX, 22, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('P', iconX, 24);
        iconX += 24;
      }
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'left';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 3;
      ctx.fillStyle = '#fef08a';
      ctx.strokeText('Жизни:', iconX, 26);
      ctx.fillText('Жизни:', iconX, 26);
      iconX += 42;
      const heartSize = 22;
      const heartStep = 20;
      for (let i = 0; i < s.extraLives; i++) {
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2.5;
        ctx.fillStyle = '#34d399';
        ctx.font = `bold ${heartSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeText('♥', iconX + i * heartStep, 26);
        ctx.fillText('♥', iconX + i * heartStep, 26);
      }
      ctx.restore();
    }

    function gameLoop() {
      if (s.pendingRespawn) {
        s.cameraShake *= SHAKE_DECAY;
        if (s.cameraShake < 0.005) {
          s.pendingRespawn = false;
          s.running = true;
          s.respawnInvulnUntil = s.distance + RESPAWN_INVULN;
        }
        renderFrame();
        animId = requestAnimationFrame(gameLoop);
        return;
      }
      if (s.pendingGameOver) {
        s.cameraShake *= SHAKE_DECAY;
        if (s.cameraShake < 0.005) {
          s.pendingGameOver = false;
          const coins = coinsRef.current || 0;
          const score = s.finalScore || (coins + Math.floor(s.distance * DISTANCE_MULT) + Math.floor((s.nitroBonus || 0) * DISTANCE_MULT));
          setFinalCoinsEarned(coins);
          setGameOver(true);
          submitScoreRef.current?.(score, coins);
          try {
            const total = readStoredCoins() + coins;
            localStorage.setItem(SHOP_COINS_KEY, String(total));
          } catch (_) {}
        }
        renderFrame();
        animId = requestAnimationFrame(gameLoop);
        return;
      }
      if (!s.running) return;
      if (s.gamePaused) {
        renderFrame();
        animId = requestAnimationFrame(gameLoop);
        return;
      }

      const nitroOn = s.distance < s.nitroUntil;
      const speed = s.speed * (nitroOn ? NITRO_MULT : 1);
      s.distance += speed;
      if (nitroOn) s.nitroBonus += speed * (NITRO_POINTS_MULT - 1);
      s.speed = Math.min(s.speed + SPEED_INC, BASE_SPEED * 2.8);

      s.obstacles.forEach((o) => { o.y += speed; });
      s.obstacles = s.obstacles.filter((o) => o.y < 1.15);
      s.decors.forEach((d) => { d.y += speed; });
      s.decors = s.decors.filter((d) => d.y < 1.15);
      s.powerUps.forEach((pu) => { pu.y += speed; });
      const playerXNorm = laneCenterNorm(s.lane);
      const magnetActive = s.distance < s.magnetUntil;
      s.coins.forEach((c) => {
        if (c.collectedAt) return;
        if (magnetActive) {
          const dx = playerXNorm - c.x;
          const dy = PLAYER_Y - c.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= MAGNET_RADIUS) {
            c.magnetPull = true;
            const pull = Math.min(1, MAGNET_PULL_SPEED / Math.max(0.01, dist));
            c.x += dx * pull;
            c.y += dy * pull;
            return;
          }
        }
        c.magnetPull = false;
        c.y += speed;
      });

      if (s.lastObstacle === 0 || s.distance - s.lastObstacle > OBSTACLE_SPAWN_INTERVAL) {
        if (Math.random() < OBSTACLE_SPAWN_CHANCE) {
          const spawnY = -0.08;
          const laneClear = (lane) => {
            return !s.obstacles.some((o) => {
              if (o.lane !== lane) return false;
              const oLen = obsHeight(o.type);
              return o.y + oLen > spawnY - 0.02 && o.y < spawnY + OBSTACLE_MIN_GAP;
            });
          };
          const lanes = [0, 1, 2, 3].filter(laneClear);
          if (lanes.length > 0) {
            s.lastObstacle = s.distance;
            const lane = lanes[Math.floor(Math.random() * lanes.length)];
            s.obstacles.push({
              lane,
              x: laneCenterNorm(lane),
              y: spawnY,
              type: OBSTACLE_TYPES[Math.floor(Math.random() * OBSTACLE_TYPES.length)]
            });
          }
        }
        if (Math.random() < COIN_SPAWN_CHANCE) {
          const clane = Math.floor(Math.random() * LANES);
          s.coins.push({ x: laneCenterNorm(clane), y: -0.04 });
        }
        if (Math.random() < POWERUP_SPAWN_CHANCE) {
          const pick = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
          const plane = Math.floor(Math.random() * LANES);
          s.powerUps.push({ type: pick.id, x: laneCenterNorm(plane), y: -0.05 });
        }
      }

      if (s.lastDecor === 0 || s.distance - s.lastDecor > DECOR_MIN_DIST) {
        if (Math.random() < DECOR_SPAWN_CHANCE) {
          s.lastDecor = s.distance;
          const d = DECOR_TYPES[Math.floor(Math.random() * DECOR_TYPES.length)];
          s.decors.push({ ...d, y: -0.1 });
        }
      }

      s.powerUps = s.powerUps.filter((pu) => {
        if (pu.y > 1.15) return false;
        if (hitTestPowerUp(s.lane, pu)) {
          if (pu.type === 'magnet') {
            s.boostInventory.magnet++;
            setBoostInventory((prev) => ({ ...prev, magnet: prev.magnet + 1 }));
            setFoundBoostsInRun((prev) => ({ ...prev, magnet: prev.magnet + 1 }));
          } else if (pu.type === 'nitro') {
            s.boostInventory.nitro++;
            setBoostInventory((prev) => ({ ...prev, nitro: prev.nitro + 1 }));
            setFoundBoostsInRun((prev) => ({ ...prev, nitro: prev.nitro + 1 }));
          } else if (pu.type === 'jump') {
            s.boostInventory.jump++;
            setBoostInventory((prev) => ({ ...prev, jump: prev.jump + 1 }));
            setFoundBoostsInRun((prev) => ({ ...prev, jump: prev.jump + 1 }));
          } else if (pu.type === 'extra_life') {
            s.extraLives += 1;
            setExtraLivesCount(s.extraLives);
          }
          const info = POWERUP_TYPES.find((t) => t.id === pu.type);
          s.floatingTexts.push({ text: info?.label || pu.type, x: pu.x, y: pu.y, birth: s.distance, isPowerUp: true });
          for (let i = 0; i < 10; i++)
            s.particles.push({ x: pu.x, y: pu.y, vx: (Math.random() - 0.5) * 0.02, vy: -0.03, birth: s.distance });
          return false;
        }
        return true;
      });

      s.coins = s.coins.filter((c) => {
        if (c.y > 1.15 && !c.collectedAt) return false;
        const dx = playerXNorm - c.x;
        const dy = PLAYER_Y - c.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const magnetCollect = magnetActive && !c.collectedAt && (c.magnetPull && dist < MAGNET_COLLECT_DIST);
        if ((hitTestCoin(s.lane, c) || magnetCollect) && !c.collectedAt) {
          c.collectedAt = s.distance;
          const combo = (s.distance - s.lastCoinDist < COMBO_TIMEOUT) ? s.comboCount + 1 : 1;
          s.comboCount = Math.min(combo, COMBO_MAX);
          s.lastCoinDist = s.distance;
          const pts = COIN_POINTS * s.comboCount;
          coinsRef.current += pts;
          s.floatingTexts.push({ text: `+${pts}`, x: c.x, y: c.y, birth: s.distance });
          for (let i = 0; i < 6; i++)
            s.particles.push({ x: c.x, y: c.y, vx: (Math.random() - 0.5) * 0.012, vy: -0.025, birth: s.distance });
        }
        if (c.collectedAt) return s.distance - c.collectedAt <= COIN_ANIM_DURATION;
        return true;
      });

      let invuln = s.distance < s.jumpActiveUntil || s.distance < (s.respawnInvulnUntil || 0);
      const jumpActive = s.distance < s.jumpUntil;
      const playerTop = PLAYER_Y - (PLAYER_H * HITBOX_SCALE) / 2;
      const playerBottom = PLAYER_Y + (PLAYER_H * HITBOX_SCALE) / 2;
      s.wouldHit = false;
      const wouldHit = s.obstacles.some((obs) => {
        const oh = obsHeight(obs.type);
        const ow = obsWidth(obs.type);
        const obsBottom = obs.y + oh * HITBOX_SCALE;
        const overlapTop = Math.max(playerTop, obs.y);
        const overlapBottom = Math.min(playerBottom, obsBottom);
        const overlapY = overlapBottom - overlapTop;
        if (overlapY < HIT_MIN_OVERLAP_Y) return false;
        const halfW = (PLAYER_W * HITBOX_SCALE + ow * HITBOX_SCALE) / 2;
        const hit = Math.abs(laneCenterNorm(s.lane) - obs.x) < halfW - 0.014;
        if (hit) s.wouldHit = true;
        return hit;
      });
      if (jumpActive && wouldHit && !invuln) {
        s.jumpActiveUntil = s.distance + JUMP_INVULN;
        invuln = true;
      }
      const obsHit = !invuln && wouldHit && s.running;

      if (obsHit) {
        s.cameraShake = SHAKE_CRASH;
        s.running = false;
        s.finalScore = coinsRef.current + Math.floor(s.distance * DISTANCE_MULT) + Math.floor(s.nitroBonus * DISTANCE_MULT);
        setDisplayScore(s.finalScore);
        if (s.extraLives > 0) {
          s.extraLives -= 1;
          setExtraLivesCount(s.extraLives);
          onUseExtraLifeRef.current?.();
          s.pendingRespawn = true;
        } else {
          s.pendingGameOver = true;
        }
      }

      s.obstacles.forEach((obs) => {
        if (obs.nearDone) return;
        const oh = obsHeight(obs.type);
        const ow = obsWidth(obs.type);
        const pTop = PLAYER_Y - (PLAYER_H * HITBOX_SCALE) / 2;
        const pBottom = PLAYER_Y + (PLAYER_H * HITBOX_SCALE) / 2;
        if (obs.y + oh * HITBOX_SCALE < pTop - 0.02 || obs.y > pBottom + 0.02) return;
        const gap = Math.abs(laneCenterNorm(s.lane) - obs.x);
        const hitW = (PLAYER_W * HITBOX_SCALE + ow * HITBOX_SCALE) / 2;
        if (gap >= hitW - 0.02 && gap < hitW + NEAR_MISS_MARGIN) {
          obs.nearDone = true;
          coinsRef.current += NEAR_MISS_BONUS;
          s.floatingTexts.push({ text: `Близко! +${NEAR_MISS_BONUS}`, x: obs.x, y: obs.y, birth: s.distance });
        }
      });

      if (s.lane !== s.lanePrev) {
        s.cameraShake = Math.max(s.cameraShake, SHAKE_TURN);
        s.lanePrev = s.lane;
      }
      s.cameraShake *= SHAKE_DECAY;
      s.floatingTexts = s.floatingTexts.filter((ft) => s.distance - ft.birth < (ft.isPowerUp ? 0.32 : FLOATING_DURATION));
      s.particles = s.particles.filter((p) => s.distance - p.birth < PARTICLE_LIFE);
      s.particles.forEach((p) => { p.x += p.vx; p.y += p.vy; });

      renderFrame();
      animId = requestAnimationFrame(gameLoop);
    }

    animId = requestAnimationFrame(gameLoop);
    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', handleKey);
      cancelAnimationFrame(animId);
    };
  // initialBoostInventory / onBoostUsed не в deps: иначе при использовании буста родитель обновляет счётчики,
  // передаёт новый initialBoostInventory и эффект перезапускается — игра обнуляется. Начальные бусты читаем только при старте.
  }, [gameOver, initialExtraLives]);

  useEffect(() => {
    if (gameOver) return;
    const t = setInterval(() => {
      const g = state.current;
      if (g.running) setDisplayScore(coinsRef.current + Math.floor((g.distance || 0) * DISTANCE_MULT) + Math.floor((g.nitroBonus || 0) * DISTANCE_MULT));
    }, 100);
    return () => clearInterval(t);
  }, [gameOver]);

  // Обратный отсчёт при входе в игру: 3 → 2 → 1 → Поехали! → скрыть
  useEffect(() => {
    if (gameOver || countdown < 0) return;
    const isGo = countdown === 0;
    const delay = isGo ? 700 : 900;
    const id = setTimeout(() => setCountdown((c) => (c === 0 ? -1 : c - 1)), delay);
    return () => clearTimeout(id);
  }, [gameOver, countdown]);

  return (
    <div className="absolute inset-0 bg-slate-900 flex flex-col select-none overflow-hidden" style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none', overscrollBehavior: 'none' }}>
      {/* Канвас на весь экран без рамок */}
      <div className="absolute inset-0 w-full h-full">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full block"
          style={{ touchAction: 'manipulation' }}
        />
      </div>

      {/* Обратный отсчёт при входе: 3, 2, 1, Поехали! */}
      <AnimatePresence>
        {!gameOver && countdown >= 0 && (
          <motion.div
            key={countdown}
            initial={{ opacity: 0, scale: 0.3 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.4 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none"
          >
            <div className="bg-slate-900/60 backdrop-blur-sm rounded-full px-16 py-12 sm:px-24 sm:py-16 border-4 border-amber-400/60 shadow-2xl shadow-amber-500/30">
              {countdown > 0 ? (
                <motion.span
                  className="text-8xl sm:text-9xl font-black text-amber-400 drop-shadow-2xl tabular-nums"
                  style={{ textShadow: '0 0 40px rgba(251,191,36,0.6)' }}
                >
                  {countdown}
                </motion.span>
              ) : (
                <motion.span
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                  className="text-3xl sm:text-4xl font-black text-amber-300 uppercase tracking-widest"
                  style={{ textShadow: '0 0 30px rgba(251,191,36,0.8)' }}
                >
                  Поехали!
                </motion.span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Шапка: очки + выход — поверх игры, компактно */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-3 py-2 bg-slate-900/70 backdrop-blur-sm">
        <span className="text-amber-400 font-bold text-base sm:text-lg tabular-nums drop-shadow-md">Очки: {displayScore}</span>
        <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg bg-slate-700/90 hover:bg-slate-600 text-white text-sm font-medium" aria-label="Выход">
          Выход
        </button>
      </div>

      {/* Бусты справа — поверх игры */}
      {!gameOver && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-3 pointer-events-auto">
          {[
            { id: 'magnet', label: 'Магнит', bg: 'bg-violet-600/95 hover:bg-violet-500 border-violet-300/60', img: 'boost_magnet.png' },
            { id: 'nitro', label: 'Нитро', bg: 'bg-orange-600/95 hover:bg-orange-500 border-orange-300/60', img: 'boost_nitro.png' },
            { id: 'jump', label: 'Прыжок', bg: 'bg-cyan-600/95 hover:bg-cyan-500 border-cyan-300/60', img: 'boost_jump.png' }
          ].map((b) => {
            const have = boostInventory[b.id] ?? 0;
            const found = foundBoostsInRun[b.id] ?? 0;
            const bought = initialBoostCounts[b.id] ?? 0;
            const onActivate = () => moveLaneRef.current[b.id === 'magnet' ? 'activateMagnet' : b.id === 'nitro' ? 'activateNitro' : 'activateJump']?.();
            return (
              <button key={b.id} type="button" onClick={onActivate} disabled={have <= 0 && !onRequestBuyBoost} title={have <= 0 && onRequestBuyBoost ? `Нет бустов. Нажми, чтобы купить` : `${b.label}: найдено ${found}, куплено ${bought}`} className={`flex flex-col items-center justify-center gap-0.5 rounded-full min-w-[44px] min-h-[44px] w-11 h-11 p-0 overflow-hidden border-2 ${b.bg} ${have <= 0 && onRequestBuyBoost ? 'opacity-90 ring-2 ring-amber-400/60' : ''} disabled:opacity-40 disabled:pointer-events-none text-white shadow-lg select-none transition-all touch-manipulation active:scale-95`}>
                <img src={`${GAME_ASSETS}/${b.img}`} alt="" className="w-5 h-5 object-contain pointer-events-none flex-shrink-0" />
                <span className="text-[8px] font-bold tabular-nums leading-none">{found}/{bought}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Управление внизу — поверх игры */}
      {!gameOver && (
        <div className="absolute bottom-4 left-0 right-0 z-20 flex flex-col items-center gap-2 pointer-events-auto px-2">
          <div className="flex gap-3 items-center">
            <button type="button" aria-label="Влево" onTouchStart={(e) => e.preventDefault()} onClick={() => moveLaneRef.current.left()} className="min-w-[48px] min-h-[48px] w-12 h-12 rounded-xl bg-slate-700/90 hover:bg-slate-600 active:bg-amber-500/80 text-white text-xl font-bold active:scale-95 transition-transform select-none touch-manipulation">←</button>
            <button type="button" aria-label="Прыжок" onTouchStart={(e) => e.preventDefault()} onClick={() => moveLaneRef.current.jump?.()} className="min-h-[44px] px-5 py-2.5 rounded-xl bg-cyan-500/80 hover:bg-cyan-500 text-white font-bold text-sm select-none touch-manipulation active:scale-95" title="Перед препятствием">Прыжок</button>
            <button type="button" aria-label="Вправо" onTouchStart={(e) => e.preventDefault()} onClick={() => moveLaneRef.current.right()} className="min-w-[48px] min-h-[48px] w-12 h-12 rounded-xl bg-slate-700/90 hover:bg-slate-600 active:bg-amber-500/80 text-white text-xl font-bold active:scale-95 transition-transform select-none touch-manipulation">→</button>
          </div>
          <p className="text-slate-400/90 text-[10px] drop-shadow-md">← → полосы · Прыжок</p>
        </div>
      )}

      {gameOver && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-end p-4 pb-6 bg-slate-900/95 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-sm text-center">
          <p className="text-lg sm:text-xl font-bold text-white mb-0.5">Игра окончена</p>
          <p className="text-amber-400 font-bold text-xl sm:text-2xl mb-1">
            Очки за игру: {doubleCoinsUsed ? displayScore * 2 : displayScore}
          </p>
          {onDoubleCoins && displayScore > 0 && !doubleCoinsUsed && (
            <div className="mb-3 p-3 rounded-xl bg-amber-500/20 border border-amber-500/40">
              <p className="text-amber-200 text-sm font-medium mb-2">Удвоить счёт за 10 ₽?</p>
              <p className="text-slate-300 text-xs mb-2">+{displayScore} очков к счёту</p>
              <button
                type="button"
                disabled={doubleCoinsLoading}
                onClick={async () => {
                  setDoubleCoinsLoading(true);
                  try {
                    const result = await onDoubleCoins(displayScore);
                    setDoubleCoinsUsed(true);
                    if (result?.balance != null) setDoubleResult({ bonusPoints: displayScore, balance: result.balance });
                  } catch (e) {
                    alert(e.response?.data?.error || e.message || 'Ошибка');
                  } finally {
                    setDoubleCoinsLoading(false);
                  }
                }}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-bold text-sm touch-manipulation"
              >
                {doubleCoinsLoading ? '...' : `Удвоить (+${displayScore}) за 10 ₽`}
              </button>
            </div>
          )}
          {doubleCoinsUsed && doubleResult && (
            <div className="mb-3 p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40">
              <p className="text-emerald-200 text-sm font-semibold">Удвоено очков: {doubleResult.bonusPoints}</p>
              <p className="text-slate-300 text-xs mt-0.5">10 ₽ · остаток {Number(doubleResult.balance).toLocaleString('ru-RU')} ₽</p>
            </div>
          )}
          <p className="text-slate-400 text-xs sm:text-sm mb-3 max-w-xs mx-auto">
            Счёт ушёл в таблицу лидеров.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 justify-center flex-wrap">
            <button type="button" onClick={() => { onLeaveGameOver?.(); onShowLeaderboard?.(); onClose?.(); }} className="px-4 py-2.5 rounded-2xl bg-amber-500/25 text-amber-200 border-2 border-amber-500/50 font-semibold text-sm touch-manipulation">Лидерборд</button>
            <button type="button" onClick={() => { onLeaveGameOver?.(); setGameOver(false); setDisplayScore(0); setSubmitted(false); setDoubleCoinsUsed(false); setFinalCoinsEarned(0); setDoubleResult(null); }} className="px-4 py-2.5 rounded-2xl bg-gradient-to-b from-amber-400 to-amber-600 text-slate-900 font-bold text-sm touch-manipulation">Играть снова</button>
            <button type="button" onClick={() => { onLeaveGameOver?.(); onClose?.(); }} className="px-4 py-2.5 rounded-2xl bg-slate-700 hover:bg-slate-600 text-white font-semibold text-sm touch-manipulation">Выход</button>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
