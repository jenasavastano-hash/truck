const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../database');
const TakskornAPI = require('../takskom-api');
const { authenticateToken, authorizeRole } = require('../auth');
const eplSign = require('../services/epl-sign');
const { deductBalance, addBalance, getBalance } = require('../utils/balance');
const { generateFastEplPdf } = require('../services/fast-epl-pdf');
const { parseDbUtc } = require('../utils/shifts');
const { CANCELABLE_BEFORE_TAXCOM, CLOSE_SHIFT_FAIL_STATUSES, sqlQuoteList } = require('../utils/epl-status');
const {
  normalizeCommercialShippingType,
  getCommercialOptionsForApi,
  getCommercialShippingHumanLabel,
} = require('../utils/commercialShippingTypes');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'photo_control');
function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

/** Нормализация ФИО для отправки в Такском: один пробел между частями (как в карточке сотрудника). */
function normalizeFio(str) {
  return (str || '').trim().replace(/\s+/g, ' ');
}

/** Объект ФИО для API Такском: { lastName, name, secondName } (для medic/technic/signature). */
function formatFioForApi(fullName) {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  return {
    lastName: (parts[0] || '').trim() || '-',
    name: (parts[1] || '').trim() || '-',
    secondName: (parts[2] || '').trim() || '-'
  };
}

/** Приведение даты к YYYY-MM-DD для лицензии медика в API Такском. */
function toLicenseDateYYYYMMDD(s) {
  if (!s || typeof s !== 'string') return null;
  const t = s.trim();
  const m = t.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (t.match(/^\d{4}-\d{2}-\d{2}$/)) return t;
  return t;
}

/** Срок действия путевого листа с момента создания (часы). */
const WAYBILL_VALIDITY_HOURS = 12;

/** Момент начала смены: PDF загружен (documentPdfReceivedAt) → QR (approvedAt) → mintransCreatedAt → createdAt. */
function getShiftStartAt(createdAt, approvedAt, mintransCreatedAt, documentPdfReceivedAt) {
  const t = documentPdfReceivedAt || approvedAt || mintransCreatedAt || createdAt;
  if (!t) return null;
  const d = parseDbUtc(t);
  return d && !isNaN(d.getTime()) ? d.getTime() : null;
}

/** Проверка: истёк ли срок действия смены (12 ч с момента получения PDF/QR/создания). */
function isWaybillExpired(createdAt, approvedAt, mintransCreatedAt, documentPdfReceivedAt) {
  const start = getShiftStartAt(createdAt, approvedAt, mintransCreatedAt, documentPdfReceivedAt);
  if (start == null) return false;
  return (Date.now() - start) > WAYBILL_VALIDITY_HOURS * 60 * 60 * 1000;
}

/** Окончание действия смены (момент старта + 12 ч). */
function getWaybillValidUntil(createdAt, approvedAt, mintransCreatedAt, documentPdfReceivedAt) {
  const start = getShiftStartAt(createdAt, approvedAt, mintransCreatedAt, documentPdfReceivedAt);
  if (start == null) return null;
  return new Date(start + WAYBILL_VALIDITY_HOURS * 60 * 60 * 1000).toISOString();
}

/** Вычисление эффективной платы за ЭПЛ с учётом наград за лидерборд (день по МСК). */
function getEffectiveEplFeeAndUsage(db, driver, fee, cb) {
  db.get('SELECT rewardsEnabled, leaderboardDefault FROM park_game_settings WHERE parkId = ?', [driver.parkId], (err, gs) => {
    if (err || !gs || !gs.rewardsEnabled) return cb(fee, null);
    const period = gs.leaderboardDefault || 'day';
    const now = new Date();
    const msk = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
    const mskDateStr = `${msk.getFullYear()}-${String(msk.getMonth() + 1).padStart(2, '0')}-${String(msk.getDate()).padStart(2, '0')}`;
    let bounds;
    if (period === 'week') {
      const [y, m, d] = mskDateStr.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      const day = date.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      const monday = new Date(date);
      monday.setDate(date.getDate() + diff);
      const monStr = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const sunStr = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`;
      bounds = { start: new Date(`${monStr}T00:00:00+03:00`).toISOString(), end: new Date(`${sunStr}T23:59:59.999+03:00`).toISOString() };
    } else if (period === 'month') {
      const [y, m] = mskDateStr.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      bounds = { start: new Date(`${y}-${String(m).padStart(2, '0')}-01T00:00:00+03:00`).toISOString(), end: new Date(`${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59.999+03:00`).toISOString() };
    } else {
      bounds = { start: new Date(`${mskDateStr}T00:00:00+03:00`).toISOString(), end: new Date(`${mskDateStr}T23:59:59.999+03:00`).toISOString() };
    }
    const periodKey = bounds.start.slice(0, 10);
    db.all(
      `SELECT userId FROM driver_game_scores WHERE parkId = ? AND playedAt >= ? AND playedAt <= ? GROUP BY userId ORDER BY SUM(score) DESC`,
      [driver.parkId, bounds.start, bounds.end],
      (e, rows) => {
        if (e || !rows || rows.length === 0) return cb(fee, null);
        const rank = rows.findIndex(r => r.userId === driver.userId) + 1;
        if (rank === 0) return cb(fee, null);
        db.get('SELECT rewardType, freeEplCount, discountPercent, discountEplCount FROM park_game_rewards WHERE parkId = ? AND position = ?', [driver.parkId, rank], (e2, reward) => {
          if (e2 || !reward) return cb(fee, null);
          db.get('SELECT freeEplUsed, discountEplUsed FROM driver_leaderboard_reward_usage WHERE userId = ? AND parkId = ? AND periodKey = ? AND periodType = ?', [driver.userId, driver.parkId, periodKey, period], (e3, usage) => {
            const freeEplUsed = usage?.freeEplUsed ?? 0;
            const discountEplUsed = usage?.discountEplUsed ?? 0;
            let effectiveFee = fee;
            let usageUpdate = null;
            if (reward.rewardType === 'free_epl' && freeEplUsed < (reward.freeEplCount || 0)) {
              effectiveFee = 0;
              usageUpdate = { periodKey, periodType: period, freeEplUsedIncr: 1, discountEplUsedIncr: 0 };
            } else if (reward.rewardType === 'discount' && discountEplUsed < (reward.discountEplCount || 0)) {
              effectiveFee = Math.round(fee * (1 - (reward.discountPercent || 0) / 100));
              usageUpdate = { periodKey, periodType: period, freeEplUsedIncr: 0, discountEplUsedIncr: 1 };
            }
            return cb(effectiveFee, usageUpdate);
          });
        });
      }
    );
  });
}

function applyRewardUsage(db, driver, usageUpdate) {
  const { periodKey, periodType, freeEplUsedIncr, discountEplUsedIncr } = usageUpdate;
  db.run(
    `UPDATE driver_leaderboard_reward_usage SET freeEplUsed = freeEplUsed + ?, discountEplUsed = discountEplUsed + ? WHERE userId = ? AND parkId = ? AND periodKey = ? AND periodType = ?`,
    [freeEplUsedIncr || 0, discountEplUsedIncr || 0, driver.userId, driver.parkId, periodKey, periodType],
    function (err) {
      if (err) return console.warn('[Driver] applyRewardUsage update error:', err.message);
      if (this.changes > 0) return;
      db.run(
        `INSERT INTO driver_leaderboard_reward_usage (userId, parkId, periodKey, periodType, freeEplUsed, discountEplUsed) VALUES (?, ?, ?, ?, ?, ?)`,
        [driver.userId, driver.parkId, periodKey, periodType, freeEplUsedIncr || 0, discountEplUsedIncr || 0],
        (insErr) => { if (insErr) console.warn('[Driver] applyRewardUsage insert error:', insErr.message); }
      );
    }
  );
}

// ===== ПРОФИЛЬ ВОДИТЕЛЯ =====

router.get('/profile', authenticateToken, authorizeRole('driver'), (req, res) => {
  db.get(
    `SELECT 
       u.id, 
       u.username, 
       u.phone,
       u.fullName,
       (COALESCE(u.balanceReal,0) + COALESCE(u.balanceUnreal,0)) as balance,
       u.personnelNumber,
       u.inn,
       u.snils,
       u.licenseSerial,
       u.licenseNumber,
       u.licenseDate,
       d.id as driverId,
       d.license as driverLicense,
       d.carId,
       d.parkId as driverParkId,
       d.isVerified,
       d.syncedWithTakskom,
       c.id as carId,
       c.regNumber,
       c.brand,
       c.model,
       c.vehicleType,
       p.id as parkId,
       p.name as parkName,
       p.freightAddressEntryMode as freightAddressEntryMode,
       p.freightDefaultOriginAddress as parkFreightDefaultOriginAddress,
       p.freightDefaultLoadAddress as parkFreightDefaultLoadAddress
     FROM users u
     JOIN drivers d ON u.id = d.userId
     LEFT JOIN cars c ON d.carId = c.id AND c.parkId = d.parkId
     LEFT JOIN parks p ON d.parkId = p.id
     WHERE u.id = ?`,
    [req.user.userId],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!row) {
        return res.status(404).json({ error: 'Driver not found' });
      }
      // Если водитель уже в Такском — верификация автоматом
      if (row.syncedWithTakskom && !row.isVerified) {
        db.run('UPDATE drivers SET isVerified = 1 WHERE userId = ?', [row.id], () => {});
        row.isVerified = 1;
      }
      // Цена ЭПЛ из waybill_rates парка водителя
      const parkId = row.driverParkId ?? row.parkId;
      if (parkId) {
        db.get('SELECT eplCreationFee FROM waybill_rates WHERE parkId = ? AND isActive = 1 ORDER BY id DESC LIMIT 1', [parkId], (rerr, rate) => {
          const fee = (rate != null && Number(rate.eplCreationFee) > 0) ? Number(rate.eplCreationFee) : 25;
          row.eplPrice = fee;
          res.json(row);
        });
      } else {
        row.eplPrice = 25;
        res.json(row);
      }
    }
  );
});

// ===== БАЛАНС И ПЛАТЕЖИ =====

/**
 * GET /api/driver/home-stats - Сводка для главной (баланс, кол-во путевых)
 */
router.get('/home-stats', authenticateToken, authorizeRole('driver'), (req, res) => {
  const userId = req.user.userId;
  db.get(
    `SELECT (COALESCE(u.balanceReal,0) + COALESCE(u.balanceUnreal,0)) as balance FROM users u WHERE u.id = ?`,
    [userId],
    (err, userRow) => {
      if (err) return res.status(500).json({ error: err.message });
      db.get(
        `SELECT 
           COUNT(*) as eplTotal,
           (SELECT COUNT(*) FROM shifts sh WHERE sh.driverId = ? AND sh.status = 'active') as eplActive
         FROM epl e
         WHERE e.driverId = (SELECT id FROM drivers WHERE userId = ?)`,
        [userId],
        (eplErr, eplRow) => {
          if (eplErr) return res.status(500).json({ error: eplErr.message });
          res.json({
            balance: userRow?.balance ?? 0,
            eplTotal: eplRow?.eplTotal ?? 0,
            eplActive: eplRow?.eplActive ?? 0
          });
        }
      );
    }
  );
});

/**
 * GET /api/driver/balance - Получить текущий баланс
 */
router.get('/balance', authenticateToken, authorizeRole('driver'), (req, res) => {
  db.get(
    `SELECT id, (COALESCE(balanceReal,0) + COALESCE(balanceUnreal,0)) as balance FROM users WHERE id = ?`,
    [req.user.userId],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ balance: row?.balance ?? 0 });
    }
  );
});

/**
 * GET /api/driver/notifications - Только непрочитанные уведомления. После «Скрыть»/«Убрать все» при перезагрузке список пустой.
 */
router.get('/notifications', authenticateToken, authorizeRole('driver'), (req, res) => {
  db.all(
    `SELECT id, type, title, body, readAt, createdAt, eplId FROM notifications WHERE userId = ? AND readAt IS NULL ORDER BY createdAt DESC LIMIT 100`,
    [req.user.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

/**
 * PATCH /api/driver/notifications/read-all — Пометить все уведомления водителя прочитанными (очистить список)
 * Важно: маршрут должен быть выше /:id/read, иначе "read-all" попадёт в :id.
 */
router.patch('/notifications/read-all', authenticateToken, authorizeRole('driver'), (req, res) => {
  db.run(
    `UPDATE notifications SET readAt = CURRENT_TIMESTAMP WHERE userId = ? AND readAt IS NULL`,
    [req.user.userId],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true, updated: this.changes });
    }
  );
});

/**
 * PATCH /api/driver/notifications/:id/read - Пометить уведомление прочитанным
 */
router.patch('/notifications/:id/read', authenticateToken, authorizeRole('driver'), (req, res) => {
  const { id } = req.params;
  db.run(
    `UPDATE notifications SET readAt = CURRENT_TIMESTAMP WHERE id = ? AND userId = ?`,
    [id, req.user.userId],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Уведомление не найдено' });
      res.json({ ok: true });
    }
  );
});

// ===== ТРЕДЫ РАССЫЛОК (диалоги с парком) =====

router.get('/broadcast-threads', authenticateToken, authorizeRole('driver'), (req, res) => {
  const userId = req.user.userId;
  db.all(
    `SELECT t.id, t.parkId, p.name as parkName, t.title, t.lastMessageAt, t.lastMessageFrom,
            t.unreadForDriver, t.createdAt, t.updatedAt
     FROM broadcast_threads t
     LEFT JOIN parks p ON p.id = t.parkId
     WHERE t.driverUserId = ?
     ORDER BY COALESCE(t.lastMessageAt, t.createdAt) DESC
     LIMIT 100`,
    [userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

router.get('/broadcast-threads/:id/messages', authenticateToken, authorizeRole('driver'), (req, res) => {
  const userId = req.user.userId;
  const threadId = parseInt(req.params.id, 10);
  if (!threadId || Number.isNaN(threadId)) return res.status(400).json({ error: 'Некорректный id' });

  db.get(`SELECT id, parkId, driverUserId FROM broadcast_threads WHERE id = ?`, [threadId], (tErr, tRow) => {
    if (tErr) return res.status(500).json({ error: tErr.message });
    if (!tRow || tRow.driverUserId !== userId) return res.status(404).json({ error: 'Не найдено' });

    // Помечаем как прочитанное для водителя
    db.run(`UPDATE broadcast_threads SET unreadForDriver = 0, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`, [threadId], () => {});
    db.run(`UPDATE broadcast_messages SET readAtDriver = COALESCE(readAtDriver, CURRENT_TIMESTAMP) WHERE threadId = ? AND fromRole = 'park'`, [threadId], () => {});

    db.all(
      `SELECT id, threadId, fromUserId, fromRole, body, createdAt
       FROM broadcast_messages
       WHERE threadId = ?
       ORDER BY id ASC
       LIMIT 500`,
      [threadId],
      (mErr, rows) => {
        if (mErr) return res.status(500).json({ error: mErr.message });
        res.json(rows || []);
      }
    );
  });
});

router.post('/broadcast-threads/:id/reply', authenticateToken, authorizeRole('driver'), (req, res) => {
  const userId = req.user.userId;
  const threadId = parseInt(req.params.id, 10);
  const body = (req.body?.body != null ? String(req.body.body) : '').trim();
  if (!threadId || Number.isNaN(threadId)) return res.status(400).json({ error: 'Некорректный id' });
  if (!body) return res.status(400).json({ error: 'Текст обязателен' });

  db.get(
    `SELECT id, parkId, driverUserId, assignedToUserId FROM broadcast_threads WHERE id = ?`,
    [threadId],
    (tErr, tRow) => {
      if (tErr) return res.status(500).json({ error: tErr.message });
      if (!tRow || tRow.driverUserId !== userId) return res.status(404).json({ error: 'Не найдено' });

      db.run(
        `INSERT INTO broadcast_messages (threadId, fromUserId, fromRole, body, readAtDriver)
         VALUES (?, ?, 'driver', ?, CURRENT_TIMESTAMP)`,
        [threadId, userId, body],
        function (iErr) {
          if (iErr) return res.status(500).json({ error: iErr.message });
          db.run(
            `UPDATE broadcast_threads
             SET lastMessageAt = CURRENT_TIMESTAMP,
                 lastMessageFrom = 'driver',
                 unreadForPark = 1,
                 updatedAt = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [threadId],
            () => {}
          );

          // Пушим уведомление: либо конкретному отправителю, либо всем менеджерам/директорам парка.
          const pushToUsers = (userIds) => {
            const uniq = Array.from(new Set((userIds || []).filter(Boolean)));
            if (uniq.length === 0) return;
            const stmt = db.prepare(`INSERT INTO notifications (userId, type, title, body) VALUES (?, 'broadcast_reply', 'Ответ на рассылку', ?)`);
            uniq.forEach((uid) => stmt.run(uid, body.slice(0, 500)));
            stmt.finalize(() => {});
          };

          if (tRow.assignedToUserId) {
            pushToUsers([tRow.assignedToUserId]);
          } else {
            db.all(`SELECT userId FROM managers WHERE parkId = ?`, [tRow.parkId], (mErr, mRows) => {
              if (mErr) return;
              const managerUserIds = (mRows || []).map((r) => r.userId);
              db.all(`SELECT userId FROM directors WHERE parkId = ?`, [tRow.parkId], (dErr, dRows) => {
                if (dErr) return;
                const directorUserIds = (dRows || []).map((r) => r.userId);
                pushToUsers([...managerUserIds, ...directorUserIds]);
              });
            });
          }
          res.status(201).json({ id: this.lastID, ok: true });
        }
      );
    }
  );
});

/**
 * POST /api/driver/balance/topup - Запрос на пополнение баланса через Юкассу
 * Body: { amount }
 * Возвращает ссылку на платёж
 */
router.post('/balance/topup', authenticateToken, authorizeRole('driver'), async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount < 100) {
      return res.status(400).json({ error: 'Минимальная сумма пополнения 100 ₽' });
    }

    // Получаем данные водителя
    db.get(
      'SELECT id, fullName, phone FROM users WHERE id = ?',
      [req.user.userId],
      async (err, user) => {
        if (err || !user) {
          return res.status(404).json({ error: 'Driver not found' });
        }

        try {
          // Инициируем платеж через Юкассу
          const Yookassa = require('../services/yookassa');
          const payment = await Yookassa.createPayment({
            amount,
            description: `Balance top-up for ${user.fullName}`,
            returnUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/driver`,
            metadata: {
              userId: req.user.userId,
              type: 'balance_topup'
            }
          });

          // Сохраняем платёж в БД
          db.run(
            `INSERT INTO payments (userId, amount, paymentId, yookassaPaymentId, status, description)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [req.user.userId, amount, payment.id, payment.id, 'pending', 'Balance top-up'],
            function (err) {
              if (err) {
                console.error('[Driver] Payment save error:', err.message);
                return res.status(500).json({ error: err.message });
              }

              res.json({
                paymentId: payment.id,
                confirmationUrl: payment.confirmation?.confirmation_url,
                amount,
                message: 'Payment initiated'
              });
            }
          );
        } catch (error) {
          console.error('[Driver] Yookassa error:', error.message);
          res.status(500).json({ error: error.message });
        }
      }
    );
  } catch (error) {
    console.error('[Driver] POST /balance/topup error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ===== ЭЛЕКТРОННЫЕ ПУТЕВЫЕ ЛИСТЫ =====

// Вспомогательная функция для создания ЭПЛ с данными сотрудников
const processEPLCreation = async (driver, staff, startOdometer, startFuel, res, eplOptions = {}) => {
  const commercialShippingType = normalizeCommercialShippingType(eplOptions.commercialShippingType);
  const entryMode = String(
    eplOptions.freightAddressEntryMode || driver.parkFreightAddressEntryMode || 'manager'
  ).trim();
  const unloadRaw = eplOptions.freightUnloadAddresses;
  const unloadArr = Array.isArray(unloadRaw) ? unloadRaw.map((x) => String(x).trim()).filter(Boolean) : [];
  let originStr = (eplOptions.freightOriginAddress && String(eplOptions.freightOriginAddress).trim()) || '';
  if (!originStr && driver.parkFreightDefaultOriginAddress) {
    originStr = String(driver.parkFreightDefaultOriginAddress).trim();
  }
  let loadStr = (eplOptions.freightLoadAddress && String(eplOptions.freightLoadAddress).trim()) || '';
  if (!loadStr && driver.parkFreightDefaultLoadAddress) {
    loadStr = String(driver.parkFreightDefaultLoadAddress).trim();
  }
  if (entryMode === 'driver' && (!originStr || !loadStr || unloadArr.length === 0)) {
    return res.status(400).json({
      error:
        'Укажите место отправления, адрес погрузки и хотя бы одну точку выгрузки (в настройках парка адреса вводит водитель).',
    });
  }
  const freightOriginAddress = originStr || null;
  const freightLoadAddress = loadStr || null;
  const freightUnloadAddresses = unloadArr.length > 0 ? JSON.stringify(unloadArr) : null;
  // Проверяем верификацию водителя (должна быть проверена до вызова этой функции, но на всякий случай)
  if (!driver.isVerified) {
    return res.status(403).json({
      error: 'Водитель не верифицирован. Обратитесь к менеджеру для верификации.'
    });
  }

  // Проверяем: парк активен
  if (!driver.parkIsActive) {
    return res.status(403).json({
      error: 'Парк неактивен. Создание путевых листов временно недоступно.'
    });
  }

  // Проверяем: авто привязано, парк есть. Привязка к ЛК Такском (takskornId) нужна,
  // кроме режима «только наш» (наш PDF без синхронизации с Такском — см. eplPrintMode).
  const parkPrintModeEarly = (driver.parkEplPrintMode && String(driver.parkEplPrintMode).trim()) || 'our_then_taxcom';
  if (!driver.carId) {
    return res.status(400).json({
      error: 'Не привязано авто. Обратитесь к менеджеру — привяжите водителя к автомобилю.'
    });
  }
  if (!driver.parkId) {
    return res.status(400).json({
      error: 'Водитель не привязан к парку. Обратитесь к менеджеру.'
    });
  }
  if (!driver.takskornId && parkPrintModeEarly !== 'our_only') {
    return res.status(400).json({
      error: 'Парк не привязан к Такском (нет синхронизации). Админ или менеджер должны привязать парк к организации в Такском в настройках парка — тогда можно будет создавать путевые листы.'
    });
  }
  /**
   * Раньше здесь жёстко требовали заведённых сотрудников парка (медик, механик, диспетчер)
   * для режима takskom_api и блокировали создание ЭПЛ, если их нет.
   *
   * В текущей интеграции персонал парка не используется: медик/механик/диспетчер
   * работают через свои учётки и отдельные сценарии, поэтому:
   * - не блокируем создание ЭПЛ из‑за отсутствия записей в park_staff;
   * - ниже при формировании титулов аккуратно пропускаем T2/T3, если данных медика/механика нет,
   *   и подставляем безопасные значения для подписи диспетчера.
   */

  // Валидация данных для ЭПЛ — до запроса в Такском. Водитель видит одно сообщение.
  const missing = [];
  if (!(driver.fullName || '').trim()) missing.push('ФИО');
  if (!(driver.licenseSerial || '').trim()) missing.push('серия ВУ');
  if (!(driver.licenseNumber || '').trim()) missing.push('номер ВУ');
  if (!(driver.licenseDate || '').trim()) missing.push('дата выдачи ВУ');
  if (!(driver.personnelNumber || '').trim()) missing.push('табельный номер');
  if (!(driver.inn || '').trim()) missing.push('ИНН');
  if (!(driver.phone || '').trim()) missing.push('телефон');
  if (!(driver.regNumber || '').trim()) missing.push('госномер авто');
  if (!(driver.brand || '').trim()) missing.push('марка авто');
  if (!(driver.model || '').trim()) missing.push('модель авто');
  if (missing.length > 0) {
    return res.status(400).json({
      error: `Нельзя создать путевой: не заполнены данные (${missing.join(', ')}). Обратитесь к менеджеру.`
    });
  }

  // Генерируем номер путевого листа
  const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const waybillNumber = `WB-${driver.parkId}-${date}-${Date.now().toString().slice(-4)}`;

  // Сначала сохраняем запись в БД (чтобы видеть попытки даже при ошибке)
  let eplId = null;
  db.run(
    `INSERT INTO epl (parkId, driverId, carId, waybillNumber, status, startOdometer, errorMessage, commercialShippingType, freightOriginAddress, freightLoadAddress, freightUnloadAddresses)
     VALUES (?, ?, ?, ?, 'draft', ?, NULL, ?, ?, ?, ?)`,
    [
      driver.parkId,
      driver.driverId,
      driver.carId,
      waybillNumber,
      startOdometer || 0,
      commercialShippingType,
      freightOriginAddress,
      freightLoadAddress,
      freightUnloadAddresses,
    ],
    function (err) {
      if (err) {
        console.error('[Driver] EPL save error:', err.message);
        return res.status(500).json({ error: err.message });
      }
      eplId = this.lastID;
      // Сначала проверяем настройку парка, если нет - используем глобальную
      db.get('SELECT eplCreationMode, eplPrintMode FROM parks WHERE id = ?', [driver.parkId], (parkErr, parkRow) => {
        let mode = (parkRow && parkRow.eplCreationMode) || null;
        const printMode = (parkRow && parkRow.eplPrintMode) || 'our_then_taxcom';
        if (!mode) {
          // Если у парка нет настройки, используем глобальную
          db.get('SELECT value FROM settings WHERE key = ?', ['epl_creation_mode'], (err, row) => {
            mode = (row && row.value) || 'takskom_api';
            processMode(mode, printMode);
          });
        } else {
          processMode(mode, printMode);
        }
      });

      function processMode(mode, printMode) {
        // ВАЖНО: по текущей архитектуре мы НЕ создаём ЭПЛ напрямую через API Такском.
        // Всегда работаем в режиме clinic_api: локальная программа (Google Guest / ПК клиники)
        // сама создаёт ЭПЛ и титулы. Здесь мы только создаём заявку pending_clinic.
        if (mode === 'clinic_api' || mode === 'takskom_api' || !mode) {
          // Отменяем предыдущие зависшие заявки (без QR), чтобы на сайте не висело «Создаётся» по старой
          db.run(
            `UPDATE epl SET status = 'failed', errorMessage = 'Заменена новой заявкой' 
             WHERE driverId = ? AND id != ? AND status IN (${sqlQuoteList(CANCELABLE_BEFORE_TAXCOM)}) 
             AND (mintransId IS NULL OR mintransId = '')`,
            [driver.driverId, eplId],
            (cancelErr) => {
              if (cancelErr) console.error('[Driver] Cancel old pending_clinic error:', cancelErr.message);
            }
          );
          db.run(`UPDATE epl SET status = 'pending_clinic' WHERE id = ?`, [eplId], (upErr) => {
            if (upErr) {
              console.error('[Driver] EPL status update error:', upErr.message);
              return res.status(500).json({ error: upErr.message });
            }
            console.log(`[Driver] EPL ${eplId} (${waybillNumber}) — режим clinic_api, статус pending_clinic`);

            // Режим печати:
            // - our_only: fast-PDF обязателен, а клиника/Такском не должны брать заявку (см. clinic/pending-creation фильтр).
            // - our_then_taxcom: fast-PDF сразу + дальше клиника делает офф.док/QR.
            // - taxcom_only: fast-PDF НЕ делаем, водитель ждёт офф.док/QR; смена откроется по approvedAt/documentPdfReceivedAt (ensureShiftExistsForEpl страхует shifts).
            if (printMode !== 'taxcom_only') {
              const createdAt = new Date();
              generateFastEplPdf({ eplId, driver, startOdometer, createdAt, commercialShippingType });
            }

            // Списание и открытие смены — только в fast-epl-pdf (openShiftAndCharge), Такском лишь доп. офф. документ
            return res.status(201).json({
              id: eplId,
              waybillNumber,
              status: 'pending_clinic',
              commercialShippingType,
              message: 'Заявка создана. Подождите пару минут — ЭПЛ будет создан и подписан программой на ПК.'
            });
          });
          return;
        }
        // На всякий случай: даже если в БД окажется другой режим — не вызываем TakskornAPI,
        // чтобы не использовать API Такском из этого эндпоинта.
        console.log(`[Driver] EPL ${eplId} (${waybillNumber}) — нестандартный режим ${mode}, принудительно clinic_api (без вызова Takskom API)`);
        db.run(`UPDATE epl SET status = 'pending_clinic' WHERE id = ?`, [eplId], () => {
          if (printMode !== 'taxcom_only') {
            const createdAt = new Date();
            generateFastEplPdf({ eplId, driver, startOdometer, createdAt, commercialShippingType });
          }
          return res.status(201).json({
            id: eplId,
            waybillNumber,
            status: 'pending_clinic',
            commercialShippingType,
            message: 'Заявка создана. ЭПЛ будет создан программой на ПК.'
          });
        });
      }
    }
  );

  const createEPLInTakskom = async () => {
    try {
      console.log(`[Driver] Creating EPL: ${waybillNumber} (ID: ${eplId})`);
      const dispatcherStaff = staff.dispatcher || {};
      const dispatcherFullName = normalizeFio(
        (dispatcherStaff.fullName || driver.fullName || driver.parkName || 'Диспетчер парка').trim()
      );
      const dispatcherPosition = (dispatcherStaff.position || '').trim() || 'Диспетчер';
      const eplResponse = await TakskornAPI.createSimpleEPL(
        driver.takskornId,
        waybillNumber,
        {
          fio: driver.fullName,
          license: driver.license,
          licenseSerial: driver.licenseSerial,
          licenseNumber: driver.licenseNumber,
          licenseDate: driver.licenseDate,
          personnelNumber: driver.personnelNumber,
          phone: driver.phone || '',
          inn: driver.inn || ''
        },
        {
          regNumber: driver.regNumber,
          licensePlate: driver.regNumber,
          vin: driver.vin,
          brand: driver.brand,
          model: driver.model,
          inventoryNumber: driver.inventoryNumber
        },
        null,
        {
          name: driver.parkName,
          address: driver.parkAddress || driver.parkName || '',
          phone: driver.phone || '',
          postalIndex: driver.parkPostalIndex,
          region: driver.parkRegion,
          regionCode: driver.parkRegionCode,
          city: driver.parkCity,
          street: driver.parkStreet,
          house: driver.parkHouse,
          ogrn: driver.parkOgrn,
          inn: driver.parkInn,
          kpp: driver.parkKpp,
          ownerType: driver.ownerType,
          ownerName: driver.ownerName,
          ownerInn: driver.ownerInn,
          ownerOgrn: driver.ownerOgrn,
          ownerOgrnip: driver.ownerOgrnip,
          ownerKpp: driver.ownerKpp,
          signatureFio: dispatcherFullName,
          signaturePosition: dispatcherPosition,
          commercialShippingType,
        }
      );

      if (!eplResponse.success) {
        throw new Error('Failed to create EPL in Takskom: ' + (eplResponse.error || 'Unknown error'));
      }

      const mintransId = eplResponse.mintransId;
      const eplGuid = eplResponse.eplGuid;
      // Для титулов и статуса Такском может требовать guid, а не id
      const eplIdForApi = eplGuid || mintransId;
      console.log(`[Driver] EPL created in Takskom, mintransId: ${mintransId}, guid: ${eplGuid}, eplIdForApi: ${eplIdForApi}`);
      
      if (!mintransId) {
        console.error(`[Driver] ERROR: mintransId is null! Response:`, JSON.stringify(eplResponse, null, 2));
        throw new Error('Failed to get mintransId from Takskom response');
      }
      
      const now = new Date();
      const recordDate = now.toISOString().split('T')[0];
      // API Такском: время только HH:MM (regex ^([01][0-9]|2[0-3]):[0-5][0-9]$)
      const recordTime = now.toTimeString().split(' ')[0].slice(0, 5);

      // Небольшая задержка: документ в Такском может индексироваться не сразу
      if (eplIdForApi) {
        await new Promise(r => setTimeout(r, 2500));
      }

      let t2Success = false;
      let t3Success = false;
      let t4Success = false;

      // Титул 2 — предрейсовый медосмотр: сведения о медработнике + подписант (тот же медик)
      // Если в park_staff нет медика — не блокируем создание ЭПЛ, просто пропускаем автоматическое добавление T2.
      if (eplIdForApi && staff.medic) {
        try {
          const medicFullName = (staff.medic.fullName || '').trim() || 'Медицинский работник';
          const medicPosition = (staff.medic.position || '').trim() || 'Медицинский работник';
          await TakskornAPI.addTitle2(eplIdForApi, {
            examDate: recordDate,
            examTime: recordTime,
            examResult: 'suitable',
            medicalExaminationType: '2',
            driverName: driver.fullName,
            medicName: medicFullName,
            medicPosition,
            licenseSerial: driver.licenseSerial,
            licenseNumber: driver.licenseNumber,
            licenseDate: driver.licenseDate,
            personnelNumber: driver.personnelNumber,
            inn: driver.inn,
            medic: {
              license: {
                serial: (staff.medic.licenseSerial || '').trim() || '-',
                number: (staff.medic.licenseNumber || '').trim() || '-',
                dateStart: toLicenseDateYYYYMMDD(staff.medic.licenseDateStart) || '2020-01-01',
                dateEnd: toLicenseDateYYYYMMDD(staff.medic.licenseDateEnd) || '2030-01-01'
              }
            }
          });
          t2Success = true;
          console.log('[Driver] ✅ Титул 2 (предрейсовый медосмотр) успешно добавлен');
          // Задержка перед следующим титулом
          await new Promise(r => setTimeout(r, 1500));
        } catch (t2Err) {
          console.error('[Driver] ❌ Титул 2 (предрейсовый медосмотр) не добавлен:', t2Err.message);
          if (t2Err.response) {
            console.error('[Driver] T2 error details:', JSON.stringify(t2Err.response.data || t2Err.response, null, 2));
          }
        }
      } else if (eplIdForApi) {
        console.log('[Driver] Пропускаем титул 2: нет данных медика в park_staff');
      }

      // Титул 3 — техконтроль: сведения о лице, ответственным за ТО, + подписант (тот же механик)
      // Если нет механика в park_staff — не блокируем создание ЭПЛ, просто пропускаем T3.
      if (eplIdForApi && staff.technic) {
        try {
          const regNumberClean = (driver.regNumber || '').replace(/\s+/g, '').trim();
          if (!regNumberClean || regNumberClean === '-') {
            throw new Error('Госномер автомобиля не заполнен');
          }
          const technicFullName = (staff.technic.fullName || '').trim() || 'Механик';
          const technicPosition = (staff.technic.position || '').trim() || 'Механик';
          await TakskornAPI.addTitle3(eplIdForApi, {
            examDate: recordDate,
            examTime: recordTime,
            examResult: 'suitable',
            technicName: technicFullName,
            technicPosition,
            vehicle: {
              Type: '1',
              Brand: driver.brand || '-',
              Model: driver.model || '-',
              RegistrationNumber: regNumberClean
            }
          });
          t3Success = true;
          console.log('[Driver] ✅ Титул 3 (техконтроль) успешно добавлен');
          await new Promise(r => setTimeout(r, 1500));
        } catch (t3Err) {
          console.error('[Driver] ❌ Титул 3 (техконтроль) не добавлен:', t3Err.message);
          if (t3Err.response) {
            console.error('[Driver] T3 error details:', JSON.stringify(t3Err.response.data || t3Err.response, null, 2));
          }
        }
      } else if (eplIdForApi) {
        console.log('[Driver] Пропускаем титул 3: нет данных механика в park_staff');
      }

      // Титул 4 — одометр и топливо выезда + лицо, уполномоченное на проставление данных, и подписант (механик)
      const odometer = startOdometer != null && startOdometer !== '' ? Number(startOdometer) : 0;
      const fuelValue = startFuel != null && startFuel !== '' && !isNaN(Number(startFuel)) && Number(startFuel) >= 0 ? Number(startFuel) : null;
      if (eplIdForApi) {
        try {
          const t4Payload = {
            odometerReading: odometer,
            recordDate,
            recordTime
          };
          if (fuelValue != null) t4Payload.fuelValue = fuelValue;
          await TakskornAPI.addTitle4(eplIdForApi, t4Payload);
          t4Success = true;
          console.log('[Driver] ✅ Титул 4 (одометр выезда) успешно добавлен');
        } catch (t4Err) {
          console.error('[Driver] ❌ Титул 4 (одометр выезда) не добавлен:', t4Err.message);
          if (t4Err.response) {
            console.error('[Driver] T4 error details:', JSON.stringify(t4Err.response.data || t4Err.response, null, 2));
          }
        }
      }

      // Обновляем запись в БД с mintransId, eplGuid, статусом pending и автоматически вычисляем endOdometer = startOdometer + 80
      const endOdometer = odometer + 80;
      const distance = Math.max(0, endOdometer - odometer);
      console.log(`[Driver] Updating EPL ${eplId} with mintransId: ${mintransId}, eplGuid: ${eplGuid || 'null'}, endOdometer: ${endOdometer} (startOdometer + 80)`);
      db.run(
        `UPDATE epl SET mintransId = ?, eplGuid = ?, status = 'pending', endOdometer = ?, distance = ?, errorMessage = NULL WHERE id = ?`,
        [mintransId, eplGuid || null, endOdometer, distance, eplId],
        function(err) {
          if (err) {
            console.error('[Driver] EPL update error:', err.message);
            return res.status(500).json({ error: err.message });
          }
          console.log(`[Driver] EPL ${eplId} updated successfully with mintransId: ${mintransId}, rows affected: ${this.changes}`);

          // Смена и списание — только от отрисовки (fast-epl-pdf). Такском здесь только офф. документ (mintransId, титулы, позже QR).

          // Локальные титулы для подписания (сохраняем только успешно добавленные в Такском)
          // Т1 всегда создается успешно (иначе бы была ошибка выше)
          db.run(
            `INSERT OR IGNORE INTO epl_titles (eplId, titleCode, status) VALUES (?, ?, 'filled')`,
            [eplId, 't1'],
            (insErr) => { if (insErr) console.warn('[Driver] epl_titles t1 insert:', insErr.message); }
          );
          
          // Т2, Т3, Т4 сохраняем только если успешно добавлены
          if (t2Success) {
            db.run(
              `INSERT OR IGNORE INTO epl_titles (eplId, titleCode, status) VALUES (?, ?, 'filled')`,
              [eplId, 't2'],
              (insErr) => { if (insErr) console.warn('[Driver] epl_titles t2 insert:', insErr.message); }
            );
          }
          if (t3Success) {
            db.run(
              `INSERT OR IGNORE INTO epl_titles (eplId, titleCode, status) VALUES (?, ?, 'filled')`,
              [eplId, 't3'],
              (insErr) => { if (insErr) console.warn('[Driver] epl_titles t3 insert:', insErr.message); }
            );
          }
          if (t4Success) {
            db.run(
              `INSERT OR IGNORE INTO epl_titles (eplId, titleCode, status) VALUES (?, ?, 'filled')`,
              [eplId, 't4'],
              (insErr) => { if (insErr) console.warn('[Driver] epl_titles t4 insert:', insErr.message); }
            );
          }

          // Списание за ЭПЛ и смена — только при отрисовке (fast-epl-pdf). Здесь только ответ и фоновый запрос QR.
          res.status(201).json({
            id: eplId,
            mintransId: mintransId,
            waybillNumber,
            status: 'pending',
            message: 'Waybill created successfully',
            takskornInfo: eplResponse
          });

          // В фоне: запрос QR у Такском, сохранение в БД и уведомление водителю (офф. документ — доп. к отрисовке)
          setImmediate(() => {
            db.get(
              `SELECT e.waybillNumber, e.eplGuid, e.mintransId, d.userId FROM epl e JOIN drivers d ON e.driverId = d.id WHERE e.id = ?`,
              [eplId],
              (err, row) => {
                if (err || !row) return;
                const { waybillNumber: wbNum, eplGuid: guid, mintransId: mId, userId } = row;
                TakskornAPI.getQRByWaybillNumber(wbNum)
                  .then((qrRes) => {
                    if (qrRes.success && qrRes.qr) {
                      const approvedAtIso = new Date().toISOString();
                      const updateData = { qrCode: qrRes.qr, status: 'approved', approvedAt: approvedAtIso };
                      if (qrRes.eplGuid && !guid) updateData.eplGuid = qrRes.eplGuid;
                      if (qrRes.mintransId && !mId) updateData.mintransId = qrRes.mintransId;
                      const updateSql = Object.keys(updateData).map(k => `${k} = ?`).join(', ');
                      const updateValues = [...Object.values(updateData), eplId];
                      db.run(`UPDATE epl SET ${updateSql} WHERE id = ?`, updateValues, () => {
                        db.run(
                          'INSERT INTO notifications (userId, type, title, body, eplId) VALUES (?, ?, ?, ?, ?)',
                          [userId, 'epl_ready', 'Путевой лист готов', 'Откройте карточку путевого — QR-код готов.', eplId],
                          () => {}
                        );
                        const { insertShiftWillCloseNotification } = require('../utils/shift-notifications');
                        insertShiftWillCloseNotification(db, userId, eplId, approvedAtIso);
                      });
                      console.log(`[Driver] QR сохранён для EPL ${eplId}, водителю ${userId} отправлено уведомление.`);
                    } else {
                      console.warn(`[Driver] QR не получен для waybillNumber ${wbNum}`);
                    }
                  })
                  .catch((e) => {
                    console.warn('[Driver] QR пока недоступен (не критично):', e.message);
                  });
              }
            );
          });
        }
      );

    } catch (takskornError) {
      // Сохраняем ошибку в БД
      const errorMsg = takskornError.message || 'Unknown error';
      console.error('[Driver] Takskom error for EPL', eplId, ':', errorMsg);
      console.error('[Driver] Full error:', takskornError);
      
      // Сохраняем ошибку. Если CHECK constraint не поддерживает 'failed', используем 'rejected'
      db.run(
        `UPDATE epl SET status = 'failed', errorMessage = ? WHERE id = ?`,
        [errorMsg.substring(0, 1000), eplId], // Ограничиваем длину ошибки
        (err) => {
          if (err) {
            // Если не получилось с 'failed', пробуем 'rejected' (для совместимости со старыми БД)
            console.warn('[Driver] Failed to save with status failed, trying rejected:', err.message);
            db.run(
              `UPDATE epl SET status = 'rejected', errorMessage = ? WHERE id = ?`,
              [errorMsg.substring(0, 1000), eplId],
              (err2) => {
                if (err2) {
                  console.error('[Driver] Failed to save error message:', err2.message);
                } else {
                  console.log('[Driver] Saved error with rejected status (fallback)');
                }
              }
            );
          }
        }
      );

      res.status(500).json({
        error: 'Failed to create waybill with Takskom',
        details: errorMsg,
        eplId: eplId, // Возвращаем ID попытки
        waybillNumber: waybillNumber
      });
    }
  };
};

router.get('/epl/list', authenticateToken, authorizeRole('driver'), (req, res) => {
  const driverUserId = req.user.userId;
  // Снимаем «Создаётся» с зависших заявок старше 30 мин (без mintransId).
  // ВАЖНО: если fast-PDF/QR уже отрисован водителю, такую заявку НЕ трогаем:
  // смена должна жить 12 часов от documentPdfReceivedAt/approvedAt, независимо от Такском.
  db.run(
    `UPDATE epl SET status = 'failed', errorMessage = 'Заявка не была создана (истекло время)' 
     WHERE driverId = (SELECT id FROM drivers WHERE userId = ?) 
     AND status IN (${sqlQuoteList(CANCELABLE_BEFORE_TAXCOM)}) AND (mintransId IS NULL OR mintransId = '') 
     -- В режиме taxcom_only нет fast-PDF, поэтому создание может занять дольше. Не автозакрываем такие заявки таймаутом 30 мин.
     AND (SELECT COALESCE(eplPrintMode, 'our_then_taxcom') FROM parks p WHERE p.id = epl.parkId) != 'taxcom_only'
     AND (documentPdfReceivedAt IS NULL OR documentPdfReceivedAt = '')
     AND (documentPdf IS NULL OR length(documentPdf) = 0)
     AND (documentQr IS NULL OR documentQr = '')
     AND (qrCode IS NULL OR qrCode = '')
     AND createdAt < datetime('now', '-30 minutes')`,
    [driverUserId],
    (upErr) => {
      if (upErr) console.error('[Driver] epl/list cleanup old pending_clinic:', upErr.message);
      db.all(
        `SELECT 
           e.id, e.mintransId, e.waybillNumber, e.status, e.qrCode, e.documentQr,
           e.startOdometer, e.endOdometer, e.distance,
           e.errorMessage,
           e.createdAt, e.approvedAt, e.mintransCreatedAt, e.documentPdfReceivedAt, e.updatedAt,
           e.commercialShippingType,
           (CASE WHEN e.documentPdf IS NOT NULL AND length(e.documentPdf) > 0 THEN 1 ELSE 0 END) as documentPdfAvailable,
           c.regNumber, c.brand, c.model,
           p.name as parkName,
           p.eplPrintMode as parkEplPrintMode,
           shift_single.status as shiftStatus,
           (SELECT COUNT(*) FROM epl_titles WHERE eplId = e.id) as titleFilled,
           (SELECT COUNT(*) FROM epl_titles WHERE eplId = e.id AND status = 'signed') as titleSigned,
           (SELECT (COUNT(*) = 4) FROM epl_titles WHERE eplId = e.id AND titleCode IN ('t1','t2','t3','t4') AND status = 'signed') as titlesT1T4Signed
         FROM epl e
         LEFT JOIN cars c ON e.carId = c.id AND c.parkId = e.parkId
         LEFT JOIN parks p ON e.parkId = p.id
         LEFT JOIN (
           SELECT eplId, status FROM (
             SELECT eplId, status, ROW_NUMBER() OVER (PARTITION BY eplId ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, id DESC) as rn
             FROM shifts
           ) WHERE rn = 1
         ) shift_single ON shift_single.eplId = e.id
         WHERE e.driverId = (SELECT id FROM drivers WHERE userId = ?)
         ORDER BY e.createdAt DESC`,
        [req.user.userId],
        (err, epls) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          const list = (epls || []).map((e) => {
            const filled = Number(e.titleFilled) || 0;
            const signed = Number(e.titleSigned) || 0;
            const cst = normalizeCommercialShippingType(e.commercialShippingType);
            return {
              ...e,
              commercialShippingType: cst,
              commercialShippingLabel: getCommercialShippingHumanLabel(cst),
              shiftStatus: e.shiftStatus || null,
              titleFilled: filled,
              titleSigned: signed,
              titlesT1T4Signed: !!e.titlesT1T4Signed,
              titlePercentFilled: 6 ? Math.round((filled / 6) * 100) : 0,
              titlePercentSigned: 6 ? Math.round((signed / 6) * 100) : 0
            };
          });
          res.json(list);
        }
      );
    }
  );
});

/**
 * POST /api/driver/epl/create - Создать новый путевой лист (вызов Такскома)
 * Body: { startOdometer, startFuel } (опционально)
 * 
 * Автоматически:
 * 1. Получает данные водителя и авто
 * 2. Создает ЭПЛ в Такском (Титул 1)
 * 3. Генерирует номер путевого листа
 * 4. Сохраняет в локальной БД
 * 5. Списывает комиссию с баланса (если установлена)
 */
router.get('/commercial-shipping-types', authenticateToken, authorizeRole('driver'), (req, res) => {
  res.json({ options: getCommercialOptionsForApi() });
});

/** Справочник точек выгрузки парка — для выбора маршрута при создании ЭПЛ (активные записи). */
router.get('/freight-stores', authenticateToken, authorizeRole('driver'), (req, res) => {
  db.get(`SELECT d.parkId FROM drivers d WHERE d.userId = ?`, [req.user.userId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Водитель не найден' });
    db.all(
      `SELECT id, name, addressText, contactNote, sortOrder
       FROM park_freight_stores WHERE parkId = ? AND isActive = 1
       ORDER BY sortOrder ASC, id ASC`,
      [row.parkId],
      (e2, rows) => {
        if (e2) return res.status(500).json({ error: e2.message });
        res.json(rows || []);
      }
    );
  });
});

router.post('/epl/create', authenticateToken, authorizeRole('driver'), async (req, res) => {
  try {
    const {
      startOdometer,
      startFuel,
      commercialShippingType: rawCommercial,
      freightOriginAddress,
      freightLoadAddress,
      freightUnloadAddresses,
      freightUnloadStoreIds,
    } = req.body;
    const commercialShippingType = normalizeCommercialShippingType(rawCommercial);
    // Водитель вводит пробег, но в ЭПЛ пишем значение минус 40–50 км
    const enteredOdo = startOdometer != null && startOdometer !== '' ? Number(startOdometer) : 0;
    const safeEntered = Number.isFinite(enteredOdo) && enteredOdo > 0 ? Math.floor(enteredOdo) : 0;
    const delta = 40 + Math.floor(Math.random() * 11); // 40..50
    const adjustedStartOdometer = Math.max(0, safeEntered - delta);

    // Все данные для ЭПЛ — из БД: менеджер создаёт авто, водителей и связи (d.carId).
    // Водитель ничего не выбирает: авто и парк уже привязаны; при создании ЭПЛ только подставляем данные в API.
    db.get(
      `SELECT 
         u.id as userId,
         u.fullName, u.phone, u.personnelNumber, u.inn,
         u.licenseSerial, u.licenseNumber, u.licenseDate,
         COALESCE(u.balanceReal,0) as balanceReal, COALESCE(u.balanceUnreal,0) as balanceUnreal,
         (COALESCE(u.balanceReal,0) + COALESCE(u.balanceUnreal,0)) as balance,
         d.id as driverId, d.carId, d.license, d.isVerified,
         c.id as carId, c.regNumber, c.vin, c.brand, c.model, c.vehicleType, c.inventoryNumber,
         c.ownerId,
         p.id as parkId, p.name as parkName, p.address as parkAddress,
         p.postalIndex as parkPostalIndex, p.region as parkRegion, p.regionCode as parkRegionCode,
         p.city as parkCity, p.street as parkStreet, p.house as parkHouse,
         p.ogrn as parkOgrn, p.inn as parkInn, p.kpp as parkKpp,
         p.freightAddressEntryMode as parkFreightAddressEntryMode,
         p.freightDefaultOriginAddress as parkFreightDefaultOriginAddress,
         p.freightDefaultLoadAddress as parkFreightDefaultLoadAddress,
         p.eplCreationMode as parkEplCreationMode,
         p.eplPrintMode as parkEplPrintMode,
         p.takskornId, p.memberId, p.isActive as parkIsActive,
         po.name as ownerName, po.type as ownerType, po.inn as ownerInn, po.kpp as ownerKpp,
         po.ogrn as ownerOgrn, po.ogrnip as ownerOgrnip
       FROM users u
       JOIN drivers d ON u.id = d.userId
       LEFT JOIN cars c ON d.carId = c.id AND c.parkId = d.parkId
       LEFT JOIN parks p ON u.parkId = p.id
       LEFT JOIN park_owners po ON po.id = c.ownerId
       WHERE u.id = ?`,
      [req.user.userId],
      async (err, driver) => {
        if (err || !driver) {
          console.error('[Driver] Profile fetch error:', err?.message);
          return res.status(404).json({ error: 'Driver not found' });
        }

        // Проверяем верификацию водителя
        if (!driver.isVerified) {
          return res.status(403).json({
            error: 'Водитель не верифицирован. Обратитесь к менеджеру для верификации.'
          });
        }

        // У водителя может быть только одна активная смена и один ЭПЛ в ней
        db.get(
          `SELECT s.id as shiftId, s.eplId FROM shifts s WHERE s.driverId = ? AND s.status = 'active' LIMIT 1`,
          [req.user.userId],
          (shiftErr, activeRow) => {
            if (shiftErr) {
              return res.status(500).json({ error: 'Ошибка проверки смены' });
            }
            if (activeRow) {
              // Смена есть — проверяем ЭПЛ: истёк по времени (12 ч с готовности в Такском/QR), или так и не создан (pending_clinic/draft без mintransId)
                  db.get(
                `SELECT status, mintransId, createdAt, approvedAt, mintransCreatedAt, documentPdfReceivedAt FROM epl WHERE id = ?`,
                [activeRow.eplId],
                (eplErr, eplRow) => {
                  if (eplErr || !eplRow) {
                    return res.status(400).json({
                      error: 'У вас уже открыта смена с путевым листом. Закройте смену, чтобы создать новый ЭПЛ.'
                    });
                  }
                  const closeShiftAndProceed = () => {
                    db.run(
                      `UPDATE shifts SET status = 'auto_closed', autoClosedAt = CURRENT_TIMESTAMP WHERE id = ?`,
                      [activeRow.shiftId],
                      () => { proceedToStaff(); }
                    );
                  };
                  const isExpired = isWaybillExpired(
                    eplRow.createdAt,
                    eplRow.approvedAt,
                    eplRow.mintransCreatedAt,
                    eplRow.documentPdfReceivedAt
                  );
                  // ЭПЛ считаем «не созданным» только если у него нет mintransId
                  // И НЕТ ни официального PDF, ни нашего fast PDF (documentPdfReceivedAt).
                  // Если PDF уже отрисован (водитель получил путевой), смена должна
                  // оставаться открытой до истечения 12 часов, а не закрываться сразу.
                  const neverCreated =
                    (eplRow.status === 'pending_clinic' || eplRow.status === 'draft') &&
                    !eplRow.mintransId &&
                    !eplRow.documentPdfReceivedAt;
                  if (isExpired || neverCreated) {
                    if (neverCreated) {
                      console.log(`[Driver] Смена ${activeRow.shiftId}: ЭПЛ ${activeRow.eplId} не был создан (${eplRow.status}), закрываем смену и разрешаем новую заявку.`);
                    }
                    closeShiftAndProceed();
                    return;
                  }
                  return res.status(400).json({
                    error: 'У вас уже открыта смена с путевым листом. Закройте смену, чтобы создать новый ЭПЛ.'
                  });
                }
              );
              return;
            }
            proceedToStaff();
            function proceedToStaff() {
              // Получаем данные сотрудников парка (медик, механик, диспетчер)
            db.all(
          `SELECT role, fullName, position, licenseSerial, licenseNumber, licenseDateStart, licenseDateEnd
           FROM park_staff WHERE parkId = ?`,
          [driver.parkId],
          (staffErr, staffList) => {
            if (staffErr) {
              console.error('[Driver] Staff fetch error:', staffErr?.message);
              return res.status(500).json({ error: 'Ошибка получения данных сотрудников' });
            }

            const staff = {};
            (staffList || []).forEach(s => {
              staff[s.role] = s;
            });

            const manualUnloads = Array.isArray(freightUnloadAddresses)
              ? freightUnloadAddresses.map((x) => String(x).trim()).filter(Boolean)
              : [];
            const storeIdList = Array.isArray(freightUnloadStoreIds)
              ? freightUnloadStoreIds.map((x) => parseInt(x, 10)).filter((n) => !Number.isNaN(n) && n > 0)
              : [];

            if (storeIdList.length === 0) {
              processEPLCreation(driver, staff, adjustedStartOdometer, startFuel, res, {
                commercialShippingType,
                freightOriginAddress,
                freightLoadAddress,
                freightUnloadAddresses: manualUnloads,
              });
              return;
            }

            const placeholders = storeIdList.map(() => '?').join(',');
            db.all(
              `SELECT id, addressText FROM park_freight_stores WHERE parkId = ? AND isActive = 1 AND id IN (${placeholders}) ORDER BY sortOrder ASC, id ASC`,
              [driver.parkId, ...storeIdList],
              (storeErr, storeRows) => {
                if (storeErr) {
                  console.error('[Driver] freightUnloadStoreIds merge:', storeErr.message);
                  return res.status(500).json({ error: storeErr.message });
                }
                const fromStores = (storeRows || []).map((r) => String(r.addressText || '').trim()).filter(Boolean);
                const merged = [...fromStores, ...manualUnloads];
                const seen = new Set();
                const uniq = merged.filter((a) => {
                  if (seen.has(a)) return false;
                  seen.add(a);
                  return true;
                });
                processEPLCreation(driver, staff, adjustedStartOdometer, startFuel, res, {
                  commercialShippingType,
                  freightOriginAddress,
                  freightLoadAddress,
                  freightUnloadAddresses: uniq,
                });
              }
            );
          }
        );
            }
          }
        );
      }
    );
  } catch (error) {
    console.error('[Driver] EPL create error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/driver/epl/:id/complete - Завершить рейс (добавить Т5 — одометр заезда, Т6 — послерейсовый медосмотр)
 * Body: { endOdometer (обязательно), postExamResult? (по умолчанию 'suitable') }
 */
router.post('/epl/:id/complete', authenticateToken, authorizeRole('driver'), async (req, res) => {
  try {
    const { id } = req.params;
    const { endOdometer, postExamResult = 'suitable' } = req.body;

    if (endOdometer == null || endOdometer === '') {
      return res.status(400).json({ error: 'Укажите пробег при заезде (endOdometer)' });
    }
    const endOdo = Number(endOdometer);
    if (isNaN(endOdo) || endOdo < 0) {
      return res.status(400).json({ error: 'Пробег при заезде должен быть числом ≥ 0' });
    }

    db.get(
      `SELECT e.id, e.mintransId, e.eplGuid, e.startOdometer, e.driverId, e.parkId, e.createdAt, e.approvedAt, e.mintransCreatedAt,
         e.documentPdfReceivedAt,
         d.userId, u.fullName as driverName, u.licenseSerial, u.licenseNumber, u.licenseDate, u.personnelNumber, u.inn,
         p.eplPrintMode as parkEplPrintMode
       FROM epl e
       JOIN drivers d ON e.driverId = d.id
       LEFT JOIN users u ON d.userId = u.id
       LEFT JOIN parks p ON e.parkId = p.id
       WHERE e.id = ?`,
      [id],
      async (err, epl) => {
        if (err || !epl) {
          return res.status(404).json({ error: 'Путевой лист не найден' });
        }
        if (epl.userId !== req.user.userId) {
          return res.status(403).json({ error: 'Доступ запрещён' });
        }
        // Обычно нужен mintransId/eplGuid из Такском; в режиме «только наш» достаточно полученного нашего PDF.
        const printMode = (epl.parkEplPrintMode && String(epl.parkEplPrintMode).trim()) || 'our_then_taxcom';
        const hasTaxcomIds = !!(epl.mintransId || epl.eplGuid);
        const ourOnlyReady = printMode === 'our_only' && epl.documentPdfReceivedAt;
        if (!hasTaxcomIds && !ourOnlyReady) {
          return res.status(400).json({
            error:
              printMode === 'our_only'
                ? 'Путевой ещё не готов: дождитесь нашего PDF (обычно несколько секунд после создания).'
                : 'У путевого нет mintransId или eplGuid (не создан в Такском)'
          });
        }
        if (isWaybillExpired(epl.createdAt, epl.approvedAt, epl.mintransCreatedAt, epl.documentPdfReceivedAt)) {
          return res.status(400).json({
            error: `Путевой лист действует ${WAYBILL_VALIDITY_HOURS} ч с момента получения. Срок истёк. Создайте новый путевой.`
          });
        }
        const eplIdForApi = epl.eplGuid || epl.mintransId;

        let medicName = epl.driverName || 'Медицинский работник';
        let authorizedName = epl.driverName || 'Механик';
        let medicLicense = null;
        if (epl.parkId) {
          const staffList = await new Promise((resolve) => {
            db.all(
              `SELECT role, fullName, licenseSerial, licenseNumber, licenseDateStart, licenseDateEnd
               FROM park_staff WHERE parkId = ? AND role IN ('medic', 'technic')`,
              [epl.parkId],
              (staffErr, rows) => resolve(rows || [])
            );
          });
          staffList.forEach(s => {
            if (s.role === 'medic') {
              if ((s.fullName || '').trim()) medicName = normalizeFio(s.fullName);
              if ((s.licenseSerial || '').trim() || (s.licenseNumber || '').trim()) {
                medicLicense = {
                  serial: (s.licenseSerial || '').trim() || '-',
                  number: (s.licenseNumber || '').trim() || '-',
                  dateStart: toLicenseDateYYYYMMDD(s.licenseDateStart) || '2020-01-01',
                  dateEnd: toLicenseDateYYYYMMDD(s.licenseDateEnd) || '2030-01-01'
                };
              }
            }
            if (s.role === 'technic' && (s.fullName || '').trim()) authorizedName = normalizeFio(s.fullName);
          });
        }

        // Сохраняем только пробег при заезде; Т5/Т6 заполнит подписант (pending-completion)
        const distance = epl.startOdometer != null ? Math.max(0, endOdo - epl.startOdometer) : null;
        db.run(
          `UPDATE epl SET endOdometer = ?, distance = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
          [endOdo, distance, id],
          (runErr) => {
            if (runErr) {
              console.error('[Driver] Update endOdometer error:', runErr.message);
              return res.status(500).json({ error: runErr.message });
            }
            res.json({
              id: parseInt(id, 10),
              endOdometer: endOdo,
              distance,
              status: 'pending',
              message: 'Заявка принята. В ближайшее время вы получите уведомление о завершении рейса.'
            });
          }
        );
      }
    );
  } catch (error) {
    console.error('[Driver] POST /epl/:id/complete error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/driver/epl/:id - Получить детали путевого листа с QR кодом
 */
router.get('/epl/:id', authenticateToken, authorizeRole('driver'), async (req, res) => {
  try {
    const { id } = req.params;

    db.get(
      `SELECT 
         e.id, e.mintransId, e.eplGuid, e.waybillNumber, e.status, e.qrCode, e.documentQr,
         e.startOdometer, e.endOdometer, e.distance,
         e.errorMessage,
         e.createdAt, e.approvedAt, e.mintransCreatedAt, e.documentPdfReceivedAt, e.updatedAt,
         e.commercialShippingType,
         (CASE WHEN e.documentPdf IS NOT NULL AND length(e.documentPdf) > 0 THEN 1 ELSE 0 END) as documentPdfAvailable,
         d.userId, d.id as driverId,
         u.fullName as driverName, u.phone as driverPhone,
         c.regNumber, c.brand, c.model,
         p.name as parkName, p.memberId,
         p.eplPrintMode as parkEplPrintMode,
         po.name as ownerName, po.inn as ownerInn, po.kpp as ownerKpp,
         po.ogrn as ownerOgrn, po.ogrnip as ownerOgrnip
       FROM epl e
       LEFT JOIN drivers d ON e.driverId = d.id
       LEFT JOIN users u ON d.userId = u.id
       LEFT JOIN cars c ON e.carId = c.id AND c.parkId = e.parkId
       LEFT JOIN parks p ON e.parkId = p.id
       LEFT JOIN park_owners po ON po.id = c.ownerId
       WHERE e.id = ?`,
      [id],
      async (err, epl) => {
        if (err || !epl) {
          return res.status(404).json({ error: 'Waybill not found' });
        }

        // Проверяем, что это путевой текущего водителя
        if (epl.userId !== req.user.userId) {
          return res.status(403).json({ error: 'Access denied' });
        }

        // QR запрашивает только clinic через 3 мин после epl-created. Если у ЭПЛ уже есть mintransId, но нет QR —
        // документ только что создан в ГИС, API Такском сразу вернёт 400 DOCUMENT_NOT_FOUND. Не дёргаем API при каждом открытии карточки.
        if (!epl.qrCode && epl.status === 'pending' && epl.waybillNumber && !epl.mintransId) {
          setImmediate(async () => {
            try {
              console.log(`[Driver] Background: fetching QR for EPL ${epl.id} (без mintransId)`);
              const qrResponse = await TakskornAPI.getQRByWaybillNumber(epl.waybillNumber);
              if (qrResponse.success && qrResponse.qr) {
                const approvedAtIso = new Date().toISOString();
                const updateData = { qrCode: qrResponse.qr, status: 'approved', approvedAt: approvedAtIso };
                if (qrResponse.eplGuid && !epl.eplGuid) updateData.eplGuid = qrResponse.eplGuid;
                if (qrResponse.mintransId && !epl.mintransId) updateData.mintransId = qrResponse.mintransId;
                const updateSql = Object.keys(updateData).map(k => `${k} = ?`).join(', ');
                const updateValues = [...Object.values(updateData), epl.id];
                db.run(`UPDATE epl SET ${updateSql} WHERE id = ?`, updateValues, (err) => {
                  if (err) console.warn('[Driver] QR save error:', err.message);
                  else console.log(`[Driver] QR сохранён для EPL ${epl.id}`);
                  // Уведомление «смена закроется» шлётся при получении PDF (documentPdfReceivedAt), не при QR
                });
              }
            } catch (qrErr) {
              console.warn('[Driver] QR fetch warning:', qrErr.message);
            }
          });
        }

        // Статистика титулов: заполнено / подписано (для карточки и прогресса)
        db.all(
          `SELECT titleCode, status FROM epl_titles WHERE eplId = ? ORDER BY titleCode`,
          [epl.id],
          (titErr, titleRows) => {
            const titles = titErr ? [] : (titleRows || []);
            const filled = titles.length;
            const signed = titles.filter((t) => t.status === 'signed').length;
            const t14 = titles.filter((t) => ['t1', 't2', 't3', 't4'].includes(t.titleCode));
            epl.titlesT1T4Signed = t14.length === 4 && t14.every((t) => t.status === 'signed');
            epl.titleStats = {
              total: 6,
              filled,
              signed,
              percentFilled: 6 ? Math.round((filled / 6) * 100) : 0,
              percentSigned: 6 ? Math.round((signed / 6) * 100) : 0,
              titles: titles.map((t) => ({ titleCode: t.titleCode, status: t.status }))
            };
            epl.validityHours = WAYBILL_VALIDITY_HOURS;
            epl.validUntil = getWaybillValidUntil(epl.createdAt, epl.approvedAt, epl.mintransCreatedAt, epl.documentPdfReceivedAt);
            epl.expired = isWaybillExpired(epl.createdAt, epl.approvedAt, epl.mintransCreatedAt, epl.documentPdfReceivedAt);
            epl.commercialShippingType = normalizeCommercialShippingType(epl.commercialShippingType);
            epl.commercialShippingLabel = getCommercialShippingHumanLabel(epl.commercialShippingType);
            // Логирование для отладки documentQr
            if (epl.documentPdfAvailable && !epl.documentQr) {
              console.log(`[Driver] EPL ${epl.id}: есть PDF, но нет documentQr. Фоновая задача document-qr-job должна создать QR в течение 5 минут.`);
            }
            if (epl.documentQr) {
              console.log(`[Driver] EPL ${epl.id}: documentQr присутствует, длина=${epl.documentQr.length}`);
            }
            res.json(epl);
          }
        );
      }
    );
    } catch (error) {
      console.error('[Driver] GET /epl/:id error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

/**
 * POST /api/driver/epl/:id/close-shift — Закрыть все активные смены водителя (по одному ЭПЛ — одна смена, после закрытия можно создать новый)
 */
router.post('/epl/:id/close-shift', authenticateToken, authorizeRole('driver'), (req, res) => {
  const eplId = parseInt(req.params.id, 10);
  if (!eplId) return res.status(400).json({ error: 'Invalid EPL id' });
  db.get(
    `SELECT e.id, d.userId FROM epl e JOIN drivers d ON e.driverId = d.id WHERE e.id = ?`,
    [eplId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Путевой не найден' });
      if (row.userId !== req.user.userId) return res.status(403).json({ error: 'Доступ запрещён' });
      const userId = req.user.userId;
      // Закрываем активные смены
      db.run(
        `UPDATE shifts SET status = 'closed', closedAt = CURRENT_TIMESTAMP WHERE driverId = ? AND status = 'active'`,
        [userId],
        function (runErr) {
          if (runErr) return res.status(500).json({ error: runErr.message });
          // 1) Помечаем зависшие ЭПЛ без mintransId как failed
          db.run(
            `UPDATE epl SET status = 'failed', errorMessage = 'Отменён водителем' 
             WHERE driverId = (SELECT id FROM drivers WHERE userId = ?) 
             AND status IN (${sqlQuoteList(CANCELABLE_BEFORE_TAXCOM)}) 
             AND (mintransId IS NULL OR mintransId = '')`,
            [userId],
            (cancelErr) => {
              if (cancelErr) console.error('[Driver] Cancel pending EPL on close-shift error:', cancelErr.message);
              // 2) Также закрываем конкретный ЭПЛ (даже если у него есть mintransId) — если ещё не approved/closed
              db.run(
                `UPDATE epl SET status = 'failed', errorMessage = 'Закрыт водителем' 
                 WHERE id = ? AND status IN (${sqlQuoteList(CLOSE_SHIFT_FAIL_STATUSES)})`,
                [eplId],
                (closeErr) => {
                  if (closeErr) console.error('[Driver] Close specific EPL on close-shift error:', closeErr.message);
                  res.json({ success: true, message: 'Смена закрыта. Можно создать новый путевой лист.' });
                }
              );
            }
          );
        }
      );
    }
  );
});

/**
 * GET /api/driver/epl/:id/document — отдача PDF документа ЭПЛ (из БД: отрисованный или подписанный из ГИС)
 */
router.get('/epl/:id/document', authenticateToken, authorizeRole('driver'), (req, res) => {
  const { id } = req.params;
  db.get(
    'SELECT e.mintransId, e.waybillNumber, e.documentPdf FROM epl e JOIN drivers d ON e.driverId = d.id WHERE e.id = ? AND d.userId = ?',
    [id, req.user.userId],
    (err, row) => {
      if (err || !row) {
        return res.status(404).json({ error: 'Документ не найден' });
      }
      if (row.documentPdf) {
        const pdfBuffer = Buffer.from(row.documentPdf, 'base64');
        const filename = (row.waybillNumber || `waybill-${id}`).replace(/[^a-zA-Z0-9._-]/g, '_') + '.pdf';
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        return res.send(pdfBuffer);
      }
      res.status(404).json({ error: 'Документ ещё не готов' });
    }
  );
});

/**
 * GET /api/driver/payment/:paymentId/status - Проверить статус платежа в Юкассе
 * Без вебхука - пользователь сам проверяет статус
 */
router.get('/payment/:paymentId/status', authenticateToken, authorizeRole('driver'), async (req, res) => {
  try {
    const { paymentId } = req.params;

    // Получаем платёж из БД
    db.get(
      'SELECT * FROM payments WHERE paymentId = ? AND userId = ?',
      [paymentId, req.user.userId],
      async (err, payment) => {
        if (err || !payment) {
          return res.status(404).json({ error: 'Payment not found' });
        }

        try {
          // Проверяем статус в Юкассе
          const Yookassa = require('../services/yookassa');
          const yookassaPayment = await Yookassa.getPaymentStatus(paymentId);

          // Если платёж прошёл, пополняем баланс (Юкасса = реальные деньги)
          if (yookassaPayment.status === 'succeeded' && payment.status === 'pending') {
            addBalance(
              db,
              req.user.userId,
              payment.amount,
              'real',
              'Пополнение онлайн (ЮKassa)',
              (err) => {
                if (err) {
                  console.error('[Driver] Balance update error:', err.message);
                } else {
                  db.run(
                    'UPDATE payments SET status = ? WHERE paymentId = ?',
                    ['succeeded', paymentId],
                    (err) => { if (err) console.warn('[Driver] Payment status update error:', err.message); }
                  );
                  console.log(`[Driver] Баланс пополнен на ${payment.amount}₽ (реальные деньги) для пользователя ${req.user.userId}`);
                }
              }
            );
          } else if (yookassaPayment.status === 'canceled' || yookassaPayment.status === 'failed') {
            db.run(
              'UPDATE payments SET status = ? WHERE paymentId = ?',
              [yookassaPayment.status, paymentId],
              (err) => {
                if (err) console.warn('[Driver] Payment status update error:', err.message);
              }
            );
          }

          res.json({
            paymentId,
            status: yookassaPayment.status,
            amount: payment.amount,
            description: payment.description,
            message: yookassaPayment.status === 'succeeded' 
              ? 'Payment succeeded, balance updated!' 
              : `Payment status: ${yookassaPayment.status}`
          });
        } catch (yookassaError) {
          console.error('[Driver] Yookassa check error:', yookassaError.message);
          res.status(500).json({ error: yookassaError.message });
        }
      }
    );
  } catch (error) {
    console.error('[Driver] GET /payment/:paymentId/status error:', error.message);
    res.status(500).json({ error: error.message });
  }
});


// Создать ЭПЛ (начать рейс)
router.post('/rides/start', authenticateToken, authorizeRole('driver'), (req, res) => {
  db.get(
    `SELECT d.id, d.carId FROM drivers d 
     JOIN users u ON d.userId = u.id 
     WHERE u.id = ? AND d.isVerified = 1 AND d.carId IS NOT NULL`,
    [req.user.userId],
    (err, driver) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!driver) {
        return res.status(403).json({ error: 'Driver not verified or car not assigned' });
      }

      db.run(
        'INSERT INTO rides (driverId, carId, status) VALUES (?, ?, ?)',
        [driver.id, driver.carId, 'active'],
        function (err) {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          res.status(201).json({
            id: this.lastID,
            driverId: driver.id,
            carId: driver.carId,
            status: 'active',
            startTime: new Date(),
            message: 'Ride started'
          });
        }
      );
    }
  );
});

// Завершить ЭПЛ (завершить рейс)
router.post('/rides/:rideId/end', authenticateToken, authorizeRole('driver'), (req, res) => {
  const { rideId } = req.params;
  const { distance, fare } = req.body;

  if (!distance || !fare || fare < 0) {
    return res.status(400).json({ error: 'Invalid distance or fare' });
  }

  db.get(
    `SELECT r.*, d.userId FROM rides r
     JOIN drivers d ON r.driverId = d.id
     WHERE r.id = ? AND d.userId = ? AND r.status = 'active'`,
    [rideId, req.user.userId],
    (err, ride) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!ride) {
        return res.status(404).json({ error: 'Ride not found or not active' });
      }

      db.run(
        `UPDATE rides 
         SET status = ?, endTime = CURRENT_TIMESTAMP, distance = ?, fare = ? 
         WHERE id = ?`,
        ['completed', distance, fare, rideId],
        function (err) {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          // Списываем комиссию (например 20% от тарифа)
          const commission = fare * 0.2;
          db.run(
            'INSERT INTO payments (driverId, amount, type, description) VALUES (?, ?, ?, ?)',
            [ride.driverId, -commission, 'expense', `Commission for ride #${rideId}`],
            function (err) {
              if (err) {
                return res.status(500).json({ error: err.message });
              }

              res.json({
                rideId,
                status: 'completed',
                fare,
                commission,
                distance,
                message: 'Ride completed'
              });
            }
          );
        }
      );
    }
  );
});

// Получить историю рейсов
router.get('/rides', authenticateToken, authorizeRole('driver'), (req, res) => {
  db.get(
    `SELECT d.id FROM drivers d 
     JOIN users u ON d.userId = u.id 
     WHERE u.id = ?`,
    [req.user.userId],
    (err, driver) => {
      if (err || !driver) {
        return res.status(500).json({ error: 'Driver not found' });
      }

      db.all(
        `SELECT r.*, c.regNumber, c.model 
         FROM rides r
         JOIN cars c ON r.carId = c.id
         WHERE r.driverId = ?
         ORDER BY r.createdAt DESC`,
        [driver.id],
        (err, rows) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.json(rows);
        }
      );
    }
  );
});

// Получить статистику водителя
router.get('/statistics', authenticateToken, authorizeRole('driver'), (req, res) => {
  db.get(
    `SELECT d.id FROM drivers d 
     JOIN users u ON d.userId = u.id 
     WHERE u.id = ?`,
    [req.user.userId],
    (err, driver) => {
      if (err || !driver) {
        return res.status(500).json({ error: 'Driver not found' });
      }

      const driverId = driver.id;
      db.get(
        `SELECT (COALESCE(balanceReal,0) + COALESCE(balanceUnreal,0)) as balance
         FROM users WHERE id = ?`,
        [req.user.userId],
        (bErr, bRow) => {
          if (bErr) return res.status(500).json({ error: bErr.message });
          db.get(
            `SELECT 
               COUNT(CASE WHEN status = 'completed' THEN 1 END) as totalRides,
               SUM(CASE WHEN status = 'completed' THEN distance ELSE 0 END) as totalDistance,
               SUM(CASE WHEN status = 'completed' THEN fare ELSE 0 END) as totalEarnings,
               COUNT(CASE WHEN status = 'active' THEN 1 END) as activeRides
             FROM rides
             WHERE driverId = ?`,
            [driverId],
            (rErr, rides) => {
              if (rErr) return res.status(500).json({ error: rErr.message });
              db.get(
                `SELECT 
                   COUNT(*) as totalEpl,
                   SUM(CASE WHEN createdAt >= datetime('now', '-7 days') THEN 1 ELSE 0 END) as epl7d,
                   SUM(CASE WHEN createdAt >= datetime('now', '-30 days') THEN 1 ELSE 0 END) as epl30d,
                   MAX(COALESCE(documentPdfReceivedAt, approvedAt, mintransCreatedAt, createdAt)) as lastEplAt
                 FROM epl
                 WHERE driverId = ?`,
                [driverId],
                (eErr, epl) => {
                  if (eErr) return res.status(500).json({ error: eErr.message });
                  db.get(
                    `SELECT COUNT(*) as activeShifts
                     FROM shifts
                     WHERE driverId = ? AND status = 'active'`,
                    [driverId],
                    (sErr, sRow) => {
                      if (sErr) return res.status(500).json({ error: sErr.message });
                      res.json({
                        balance: Number(bRow?.balance || 0),
                        rides: {
                          totalRides: Number(rides?.totalRides || 0),
                          totalDistance: Number(rides?.totalDistance || 0),
                          totalEarnings: Number(rides?.totalEarnings || 0),
                          activeRides: Number(rides?.activeRides || 0),
                        },
                        epl: {
                          total: Number(epl?.totalEpl || 0),
                          epl7d: Number(epl?.epl7d || 0),
                          epl30d: Number(epl?.epl30d || 0),
                          lastEplAt: epl?.lastEplAt || null,
                        },
                        shifts: { active: Number(sRow?.activeShifts || 0) }
                      });
                    }
                  );
                }
              );
            }
          );
        }
      );
    }
  );
});

// ===== ПОДПИСАНИЕ ДОКУМЕНТОВ =====

/**
 * GET /api/driver/epl/:eplId/titles - Получить титулы для подписания (только свои ЭПЛ)
 */
router.get('/epl/:eplId/titles', authenticateToken, authorizeRole('driver'), (req, res) => {
  const { eplId } = req.params;

  db.all(
    `SELECT et.id, et.eplId, et.titleCode, et.status, et.xmlData, et.signatureData
     FROM epl_titles et
     JOIN epl e ON et.eplId = e.id
     JOIN drivers d ON e.driverId = d.id
     WHERE et.eplId = ? AND d.userId = ?
     ORDER BY CASE 
       WHEN et.titleCode = 't1' THEN 1
       WHEN et.titleCode = 't2' THEN 2
       WHEN et.titleCode = 't3' THEN 3
       WHEN et.titleCode = 't4' THEN 4
       WHEN et.titleCode = 't5' THEN 5
       WHEN et.titleCode = 't6' THEN 6
       ELSE 7 END`,
    [eplId, req.user.userId],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(rows || []);
    }
  );
});

/**
 * POST /api/driver/epl/:titleId/sign - Подписать титул сертификатом
 * Body: { certPath? } — путь к сертификату (для режима real); без него работает mock.
 */
router.post('/epl/:titleId/sign', authenticateToken, authorizeRole('driver'), async (req, res) => {
  try {
    const { titleId } = req.params;
    const { certPath } = req.body || {};

    db.get(
      `SELECT et.* FROM epl_titles et
       JOIN epl e ON et.eplId = e.id
       JOIN drivers d ON e.driverId = d.id
       JOIN users u ON d.userId = u.id
       WHERE et.id = ? AND u.id = ?`,
      [titleId, req.user.userId],
      async (err, title) => {
        if (err || !title) {
          return res.status(403).json({ error: 'Доступ запрещён или титул не найден' });
        }

        let signature;
        try {
          const result = await eplSign.signTitle(db, titleId, { certPath });
          signature = result.signature;
        } catch (signErr) {
          return res.status(400).json({ error: signErr.message || 'Ошибка подписания' });
        }

        const sigFilePath = `./signatures/${titleId}-${Date.now()}.sig`;
        db.run(
          `UPDATE epl_titles SET status = ?, signatureData = ?, sigFilePath = ?, signedAt = CURRENT_TIMESTAMP WHERE id = ?`,
          ['signed', signature, sigFilePath, titleId],
          (updateErr) => {
            if (updateErr) {
              return res.status(500).json({ error: updateErr.message });
            }
            res.json({
              titleId,
              status: 'signed',
              signature,
              message: 'Титул подписан'
            });
            console.log(`[Driver] Титул ${titleId} (${title.titleCode}) подписан`);
          }
        );
      }
    );
  } catch (error) {
    console.error('[Driver] Sign error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/driver/epl/:eplId/submit - Отправить ЭПЛ на согласование в Такском
 */
router.post('/epl/:eplId/submit', authenticateToken, authorizeRole('driver'), async (req, res) => {
  try {
    const { eplId } = req.params;

    // Проверяем что водитель имеет доступ к этому ЭПЛ
    db.get(
      `SELECT e.*, d.id as driverId FROM epl e
       JOIN drivers d ON e.driverId = d.id
       JOIN users u ON d.userId = u.id
       WHERE e.id = ? AND u.id = ?`,
      [eplId, req.user.userId],
      async (err, epl) => {
        if (err || !epl) {
          return res.status(403).json({ error: 'Access denied' });
        }

        // Проверяем что все титулы подписаны
        db.get(
          `SELECT COUNT(*) as unsigned FROM epl_titles 
           WHERE eplId = ? AND status != 'signed'`,
          [eplId],
          async (err, result) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }

            if (result.unsigned > 0) {
              return res.status(400).json({ error: 'Not all titles are signed' });
            }

            // Обновляем статус ЭПЛ
            db.run(
              `UPDATE epl SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
              ['submitted', eplId],
              (err) => {
                if (err) {
                  return res.status(500).json({ error: err.message });
                }

                res.json({
                  eplId,
                  status: 'submitted',
                  message: 'Waybill submitted to Takskom'
                });

                console.log(`[Driver] ЭПЛ ${eplId} отправлен на согласование`);
              }
            );
          }
        );
      }
    );
  } catch (error) {
    console.error('[Driver] Submit error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/driver/epl/:eplId - Получить детали ЭПЛ
 */
router.get('/epl/:eplId', authenticateToken, authorizeRole('driver'), (req, res) => {
  const { eplId } = req.params;

  db.get(
    `SELECT e.*, 
            d.id as driverId, u.fullName as driverName, u.phone,
            c.id as carId, c.regNumber, c.brand, c.model,
            p.name as parkName,
            shift_single.status as shiftStatus
     FROM epl e
     JOIN drivers d ON e.driverId = d.id
     JOIN users u ON d.userId = u.id
     JOIN cars c ON e.carId = c.id AND c.parkId = e.parkId
     JOIN parks p ON e.parkId = p.id
     LEFT JOIN (
       SELECT eplId, status FROM (
         SELECT eplId, status,
                ROW_NUMBER() OVER (PARTITION BY eplId ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, id DESC) as rn
         FROM shifts
       ) WHERE rn = 1
     ) shift_single ON shift_single.eplId = e.id
     WHERE e.id = ? AND d.userId = ?`,
    [eplId, req.user.userId],
    (err, epl) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!epl) {
        return res.status(404).json({ error: 'EPL not found' });
      }
      res.json(epl);
    }
  );
});

// ===== МИНИ-ИГРА (день по МСК) =====
function getMskDateString() {
  const now = new Date();
  const msk = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
  const y = msk.getFullYear();
  const m = String(msk.getMonth() + 1).padStart(2, '0');
  const d = String(msk.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function getMskDayBounds(mskDateStr) {
  const start = new Date(`${mskDateStr}T00:00:00+03:00`);
  const end = new Date(`${mskDateStr}T23:59:59.999+03:00`);
  return { start: start.toISOString(), end: end.toISOString() };
}
function getMskWeekBounds(mskDateStr) {
  const [y, m, d] = mskDateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diff);
  const mondayStr = monday.getFullYear() + '-' + String(monday.getMonth() + 1).padStart(2, '0') + '-' + String(monday.getDate()).padStart(2, '0');
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const sundayStr = sunday.getFullYear() + '-' + String(sunday.getMonth() + 1).padStart(2, '0') + '-' + String(sunday.getDate()).padStart(2, '0');
  const start = new Date(`${mondayStr}T00:00:00+03:00`);
  const end = new Date(`${sundayStr}T23:59:59.999+03:00`);
  return { start: start.toISOString(), end: end.toISOString() };
}
function getMskMonthBounds(mskDateStr) {
  const [y, m] = mskDateStr.split('-').map(Number);
  const start = new Date(`${y}-${String(m).padStart(2, '0')}-01T00:00:00+03:00`);
  const lastDay = new Date(y, m, 0).getDate();
  const end = new Date(`${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59.999+03:00`);
  return { start: start.toISOString(), end: end.toISOString() };
}

router.get('/game/settings', authenticateToken, authorizeRole('driver'), (req, res) => {
  db.get('SELECT d.parkId FROM drivers d WHERE d.userId = ?', [req.user.userId], (err, row) => {
    if (err || !row || !row.parkId) {
      return res.json({ gameEnabled: false, leaderboardDefault: 'day', rewardsEnabled: false, rewards: [] });
    }
    db.get(
      'SELECT gameEnabled, leaderboardDefault, rewardsEnabled, gameShopConfig FROM park_game_settings WHERE parkId = ?',
      [row.parkId],
      (e, settings) => {
        if (e) return res.status(500).json({ error: e.message });
        const s = settings || { gameEnabled: 0, leaderboardDefault: 'day', rewardsEnabled: 0 };
        let shopConfig = { currencyType: 'points', magnet: 200, nitro: 200, jump: 200, extra_life: 500 };
        if (s.gameShopConfig) {
          try {
            const parsed = JSON.parse(s.gameShopConfig);
            if (parsed && typeof parsed.currencyType === 'string') shopConfig = parsed;
          } catch (_) {}
        }
        db.all(
          'SELECT position, rewardType, freeEplCount, discountPercent, discountEplCount FROM park_game_rewards WHERE parkId = ? ORDER BY position',
          [row.parkId],
          (e2, rewards) => {
            if (e2) return res.status(500).json({ error: e2.message });
            res.json({
              gameEnabled: !!s.gameEnabled,
              leaderboardDefault: s.leaderboardDefault || 'day',
              rewardsEnabled: !!s.rewardsEnabled,
              shopConfig,
              rewards: (rewards || []).map(r => ({
                position: r.position,
                rewardType: r.rewardType,
                freeEplCount: r.freeEplCount || 0,
                discountPercent: r.discountPercent || 0,
                discountEplCount: r.discountEplCount || 0
              }))
            });
          }
        );
      }
    );
  });
});

router.get('/game/leaderboard', authenticateToken, authorizeRole('driver'), (req, res) => {
  const period = (req.query.period || 'day').toLowerCase();
  const dateStr = req.query.date || getMskDateString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return res.status(400).json({ error: 'Invalid date format' });
  }
  db.get('SELECT d.parkId FROM drivers d WHERE d.userId = ?', [req.user.userId], (err, row) => {
    if (err || !row || !row.parkId) return res.status(400).json({ error: 'Driver park not set' });
    const parkId = row.parkId;
    let bounds;
    if (period === 'week') bounds = getMskWeekBounds(dateStr);
    else if (period === 'month') bounds = getMskMonthBounds(dateStr);
    else bounds = getMskDayBounds(dateStr);
    db.all(
      `SELECT u.id as userId, u.fullName, u.username,
              SUM(s.score) as totalScore, MAX(s.score) as bestScore, COUNT(*) as gamesCount
       FROM driver_game_scores s
       JOIN users u ON s.userId = u.id
       WHERE s.parkId = ? AND s.playedAt >= ? AND s.playedAt <= ?
       GROUP BY s.userId
       ORDER BY totalScore DESC
       LIMIT 50`,
      [parkId, bounds.start, bounds.end],
      (e, list) => {
        if (e) return res.status(500).json({ error: e.message });
        res.json({ period, date: dateStr, list: (list || []).map((r, i) => ({ rank: i + 1, userId: r.userId, fullName: r.fullName || r.username || 'Водитель', totalScore: r.totalScore, bestScore: r.bestScore, gamesCount: r.gamesCount })) });
      }
    );
  });
});

router.get('/game/points', authenticateToken, authorizeRole('driver'), (req, res) => {
  const userId = req.user.userId;
  db.get('SELECT COALESCE(SUM(score), 0) as totalPoints FROM driver_game_scores WHERE userId = ?', [userId], (e, row) => {
    if (e) return res.status(500).json({ error: e.message });
    res.json({ totalPoints: row?.totalPoints ?? 0 });
  });
});

router.get('/game/history', authenticateToken, authorizeRole('driver'), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  db.all(
    'SELECT id, score, playedAt, createdAt FROM driver_game_scores WHERE userId = ? ORDER BY playedAt DESC LIMIT ?',
    [req.user.userId, limit],
    (e, list) => {
      if (e) return res.status(500).json({ error: e.message });
      res.json({ list: list || [] });
    }
  );
});

// Достижения: список с id, названием, описанием, категорией, целью, наградой
const ACHIEVEMENTS = [
  { id: 'top_once', name: 'В ТОПе', description: 'Занять место в ТОПе лидерборда хотя бы раз', category: 'game', target: 1, rewardDesc: '+100 очков' },
  { id: 'top_5', name: 'Регуляр в ТОПе', description: 'Попасть в ТОП 5 раз', category: 'game', target: 5, rewardDesc: '+300 очков' },
  { id: 'score_500', name: '500 за заезд', description: 'Набрать 500 очков за один заезд', category: 'game', target: 500, rewardDesc: '+50 очков' },
  { id: 'score_1000', name: 'Мастер заезда', description: 'Набрать 1000 очков за один заезд', category: 'game', target: 1000, rewardDesc: '+150 очков' },
  { id: 'use_all_boosts', name: 'Все бусты', description: 'Использовать все 4 буста за один заезд', category: 'game', target: 1, rewardDesc: '+200 очков' },
  { id: 'total_5000', name: 'Накопитель', description: 'Набрать 5000 очков за все заезды', category: 'game', target: 5000, rewardDesc: '+500 очков' },
  { id: 'games_day_3', name: 'Активный день', description: 'Сыграть 3 раза за день', category: 'game', target: 3, rewardDesc: '+30 очков' },
  { id: 'games_week_10', name: 'Неделя в игре', description: 'Сыграть 10 раз за неделю', category: 'game', target: 10, rewardDesc: '+100 очков' },
  { id: 'epl_buy_1', name: 'Первый ЭПЛ', description: 'Купить первый путевой лист', category: 'site', target: 1, rewardDesc: 'Бонус' },
  { id: 'epl_streak_3', name: 'Серия 3 дня', description: 'Покупать ЭПЛ 3 дня подряд', category: 'site', target: 3, rewardDesc: 'Скидка' },
  { id: 'epl_total_10', name: '10 путевых', description: 'Сделать всего 10 ЭПЛ', category: 'site', target: 10, rewardDesc: 'Бонус' },
  { id: 'auto_close_1', name: 'Автозакрытие', description: 'Сделать первое автозакрытие смены', category: 'site', target: 1, rewardDesc: 'Бонус' }
];
const ACHIEVEMENT_REWARD_POINTS = {
  top_once: 100, top_5: 300, score_500: 50, score_1000: 150, use_all_boosts: 200,
  total_5000: 500, games_day_3: 30, games_week_10: 100
};

function upsertAchievementProgress(userId, achievementId, progressValue, cb) {
  const a = ACHIEVEMENTS.find((x) => x.id === achievementId);
  if (!a || progressValue == null) return (cb && cb());
  db.get(
    'SELECT id, progress, completedAt FROM driver_achievement_progress WHERE userId = ? AND achievementId = ?',
    [userId, achievementId],
    (e, row) => {
      if (e) return cb && cb(e);
      const target = a.target || 1;
      const newProgress = Math.max(row?.progress ?? 0, progressValue);
      const alreadyCompleted = !!row?.completedAt;
      const nowCompleted = !alreadyCompleted && newProgress >= target;
      if (!row) {
        db.run(
          'INSERT INTO driver_achievement_progress (userId, achievementId, progress, completedAt, updatedAt) VALUES (?, ?, ?, ?, datetime("now"))',
          [userId, achievementId, newProgress, nowCompleted ? new Date().toISOString() : null],
          (insErr) => cb && cb(insErr)
        );
      } else {
        db.run(
          'UPDATE driver_achievement_progress SET progress = ?, completedAt = COALESCE(completedAt, ?), updatedAt = datetime("now") WHERE userId = ? AND achievementId = ?',
          [newProgress, nowCompleted ? new Date().toISOString() : null, userId, achievementId],
          (upErr) => cb && cb(upErr)
        );
      }
    }
  );
}

router.get('/game/achievements', authenticateToken, authorizeRole('driver'), (req, res) => {
  const userId = req.user.userId;
  db.all('SELECT achievementId, progress, completedAt, rewardGrantedAt FROM driver_achievement_progress WHERE userId = ?', [userId], (e, rows) => {
    if (e) return res.status(500).json({ error: e.message });
    const byId = (rows || []).reduce((acc, r) => { acc[r.achievementId] = r; return acc; }, {});
    const list = ACHIEVEMENTS.map(a => {
      const p = byId[a.id] || {};
      const completed = !!p.completedAt;
      return {
        ...a,
        progress: p.progress ?? 0,
        completedAt: p.completedAt || null,
        rewardGrantedAt: p.rewardGrantedAt || null
      };
    });
    res.json({ list });
  });
});

// Получить награду за выполненное достижение (очки для магазина)
router.post('/game/achievement-grant', authenticateToken, authorizeRole('driver'), (req, res) => {
  const achievementId = req.body?.achievementId;
  const a = ACHIEVEMENTS.find((x) => x.id === achievementId);
  if (!a) return res.status(400).json({ error: 'Неизвестное достижение' });
  const pointsToAdd = ACHIEVEMENT_REWARD_POINTS[achievementId];
  if (pointsToAdd == null || pointsToAdd <= 0) return res.json({ pointsToAdd: 0, alreadyGranted: true });
  const userId = req.user.userId;
  db.get(
    'SELECT completedAt, rewardGrantedAt FROM driver_achievement_progress WHERE userId = ? AND achievementId = ?',
    [userId, achievementId],
    (e, row) => {
      if (e) return res.status(500).json({ error: e.message });
      if (!row?.completedAt) return res.status(400).json({ error: 'Достижение не выполнено' });
      if (row.rewardGrantedAt) return res.json({ pointsToAdd: 0, alreadyGranted: true });
      db.run(
        'UPDATE driver_achievement_progress SET rewardGrantedAt = datetime("now"), updatedAt = datetime("now") WHERE userId = ? AND achievementId = ?',
        [userId, achievementId],
        (upErr) => {
          if (upErr) return res.status(500).json({ error: upErr.message });
          res.json({ pointsToAdd, alreadyGranted: false });
        }
      );
    }
  );
});

router.get('/game/inventory', authenticateToken, authorizeRole('driver'), (req, res) => {
  db.get('SELECT d.parkId FROM drivers d WHERE d.userId = ?', [req.user.userId], (err, row) => {
    if (err || !row || !row.parkId) return res.json({ extraLives: 0, skins: [] });
    db.all('SELECT itemType, itemId, quantity FROM driver_game_inventory WHERE userId = ? AND parkId = ?', [req.user.userId, row.parkId], (e, rows) => {
      if (e) return res.json({ extraLives: 0, skins: [], magnet: 0, nitro: 0, jump: 0 });
      let extraLives = 0;
      let magnet = 0;
      let nitro = 0;
      let jump = 0;
      const skins = [];
      (rows || []).forEach(r => {
        const q = r.quantity || 1;
        if (r.itemType === 'boost' && r.itemId === 'extra_life') extraLives += q;
        if (r.itemType === 'boost' && r.itemId === 'magnet') magnet += q;
        if (r.itemType === 'boost' && r.itemId === 'nitro') nitro += q;
        if (r.itemType === 'boost' && r.itemId === 'jump') jump += q;
        if (r.itemType === 'skin') skins.push(r.itemId);
      });
      res.json({ extraLives, skins, magnet, nitro, jump });
    });
  });
});

router.post('/game/inventory/use', authenticateToken, authorizeRole('driver'), (req, res) => {
  const { itemId, quantity = 1 } = req.body || {};
  if (!itemId || itemId !== 'extra_life' || !Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({ error: 'Нужны itemId: extra_life и quantity >= 1' });
  }
  db.get('SELECT d.parkId FROM drivers d WHERE d.userId = ?', [req.user.userId], (err, row) => {
    if (err || !row || !row.parkId) return res.status(400).json({ error: 'Парк не найден' });
    const q = Math.min(quantity, 100);
    db.all(
      'SELECT rowid, quantity FROM driver_game_inventory WHERE userId = ? AND parkId = ? AND itemType = ? AND itemId = ?',
      [req.user.userId, row.parkId, 'boost', 'extra_life'],
      (e, rows) => {
        if (e) return res.status(500).json({ error: e.message });
        let toSpend = q;
        const updates = [];
        (rows || []).forEach((r) => {
          if (toSpend <= 0) return;
          const have = r.quantity || 1;
          const take = Math.min(have, toSpend);
          toSpend -= take;
          updates.push({ rowid: r.rowid, have, take });
        });
        if (toSpend > 0) return res.status(400).json({ error: 'Недостаточно доп. жизней в инвентаре' });
        let done = 0;
        const next = () => {
          if (done >= updates.length) return res.json({ success: true });
          const u = updates[done];
          done += 1;
          if (u.have === u.take) {
            db.run('DELETE FROM driver_game_inventory WHERE rowid = ?', [u.rowid], (delErr) => {
              if (delErr) return res.status(500).json({ error: delErr.message });
              next();
            });
          } else {
            db.run('UPDATE driver_game_inventory SET quantity = quantity - ? WHERE rowid = ?', [u.take, u.rowid], (upErr) => {
              if (upErr) return res.status(500).json({ error: upErr.message });
              next();
            });
          }
        };
        next();
      }
    );
  });
});

router.post('/game/shop/purchase', authenticateToken, authorizeRole('driver'), (req, res) => {
  const { itemId, currency, quantity: qty } = req.body || {};
  if (!itemId || !currency || !['points', 'real'].includes(currency)) return res.status(400).json({ error: 'Нужны itemId и currency (points или real)' });
  const quantity = Math.min(Math.max(1, parseInt(qty, 10) || 1), 20);
  const boostIds = ['magnet', 'nitro', 'jump', 'extra_life'];
  const skinIds = ['skin_default', 'skin_red', 'skin_blue'];
  const isBoost = boostIds.includes(itemId);
  const isSkin = skinIds.includes(itemId) || itemId.startsWith('skin_');
  if (!isBoost && !isSkin) return res.status(400).json({ error: 'Неизвестный товар' });
  if (isSkin && quantity > 1) return res.status(400).json({ error: 'Скины покупаются по одному' });

  db.get('SELECT d.parkId FROM drivers d WHERE d.userId = ?', [req.user.userId], (err, row) => {
    if (err || !row || !row.parkId) return res.status(400).json({ error: 'Парк не найден' });
    db.get('SELECT gameShopConfig FROM park_game_settings WHERE parkId = ?', [row.parkId], (gerr, grow) => {
      if (gerr || !grow || !grow.gameShopConfig) return res.status(400).json({ error: 'Магазин не настроен' });
      let shop = {};
      try { shop = JSON.parse(grow.gameShopConfig); } catch (_) {}
      const unitPrice = shop.currencyType === 'real' ? (shop[itemId] != null ? Number(shop[itemId]) : (isBoost ? 50 : 100)) : (shop[itemId] != null ? Number(shop[itemId]) : 200);
      const price = unitPrice * quantity;
      if (currency === 'real') {
        getBalance(db, req.user.userId, (balanceErr, balance) => {
          if (balanceErr) return res.status(500).json({ error: balanceErr.message || 'Ошибка баланса' });
          const total = (balance?.balanceReal ?? 0) + (balance?.balanceUnreal ?? 0);
          if (total < price) return res.status(400).json({ error: 'Недостаточно средств на балансе' });
          const description = `Магазин игры: ${itemId}${quantity > 1 ? ` ×${quantity}` : ''}`;
          deductBalance(db, req.user.userId, row.parkId, price, description, null, 'expense', (deductErr) => {
            if (deductErr) return res.status(500).json({ error: deductErr.message || 'Ошибка списания' });
            db.run(
              'INSERT INTO driver_game_inventory (userId, parkId, itemType, itemId, quantity) VALUES (?, ?, ?, ?, ?)',
              [req.user.userId, row.parkId, isBoost ? 'boost' : 'skin', itemId, quantity],
              function (insErr) {
                if (insErr) return res.status(500).json({ error: insErr.message });
                getBalance(db, req.user.userId, (_, bal) => {
                  const newBalance = (bal?.balanceReal ?? 0) + (bal?.balanceUnreal ?? 0);
                  res.json({ success: true, inventory: { itemId, quantity }, balance: newBalance });
                });
              }
            );
          });
        });
      } else {
        res.status(400).json({ error: 'Покупка за очки — в приложении (очки хранятся локально)' });
      }
    });
  });
});

/** Удвоить очки за 10₽ (после смерти в игре). Списывает 10₽ с баланса. */
const DOUBLE_COINS_PRICE = 10;
router.post('/game/double-coins', authenticateToken, authorizeRole('driver'), (req, res) => {
  db.get('SELECT d.parkId FROM drivers d WHERE d.userId = ?', [req.user.userId], (err, row) => {
    if (err || !row || !row.parkId) return res.status(400).json({ error: 'Парк не найден' });
    getBalance(db, req.user.userId, (balanceErr, balance) => {
      if (balanceErr) return res.status(500).json({ error: balanceErr.message || 'Ошибка баланса' });
      const total = (balance?.balanceReal ?? 0) + (balance?.balanceUnreal ?? 0);
      if (total < DOUBLE_COINS_PRICE) return res.status(400).json({ error: `Недостаточно средств. Нужно ${DOUBLE_COINS_PRICE} ₽.` });
      deductBalance(db, req.user.userId, row.parkId, DOUBLE_COINS_PRICE, 'Удвоение очков в игре', null, 'expense', (deductErr) => {
        if (deductErr) return res.status(500).json({ error: deductErr.message || 'Ошибка списания' });
        getBalance(db, req.user.userId, (_, bal) => {
          const newBalance = (bal?.balanceReal ?? 0) + (bal?.balanceUnreal ?? 0);
          res.json({ success: true, message: 'Очки удвоены', balance: newBalance });
        });
      });
    });
  });
});

router.post('/game/score', authenticateToken, authorizeRole('driver'), (req, res) => {
  const score = parseInt(req.body?.score, 10);
  const coinsEarned = Math.max(0, parseInt(req.body?.coinsEarned, 10) || 0);
  if (isNaN(score) || score < 0) return res.status(400).json({ error: 'Invalid score' });
  const userId = req.user.userId;
  db.get('SELECT d.parkId FROM drivers d WHERE d.userId = ?', [userId], (err, row) => {
    if (err || !row || !row.parkId) return res.status(400).json({ error: 'Driver park not set' });
    db.run(
      "INSERT INTO driver_game_scores (parkId, userId, score, playedAt, createdAt) VALUES (?, ?, ?, datetime('now'), datetime('now'))",
      [row.parkId, userId, score],
      function (insErr) {
        if (insErr) return res.status(500).json({ error: insErr.message });
        res.json({ id: this.lastID, score, coinsEarned });

        // Обновление прогресса достижений
        upsertAchievementProgress(userId, 'score_500', score);
        upsertAchievementProgress(userId, 'score_1000', score);
        db.get('SELECT COALESCE(SUM(score), 0) as total FROM driver_game_scores WHERE userId = ?', [userId], (e1, r1) => {
          if (!e1 && r1) upsertAchievementProgress(userId, 'total_5000', r1.total);
        });
        db.get(
          "SELECT COUNT(*) as cnt FROM driver_game_scores WHERE userId = ? AND date(playedAt) = date('now')",
          [userId],
          (e2, r2) => {
            if (!e2 && r2) upsertAchievementProgress(userId, 'games_day_3', r2.cnt);
          }
        );
        db.get(
          "SELECT COUNT(*) as cnt FROM driver_game_scores WHERE userId = ? AND playedAt >= date('now', '-7 days')",
          [userId],
          (e3, r3) => {
            if (!e3 && r3) upsertAchievementProgress(userId, 'games_week_10', r3.cnt);
          }
        );
        // Достижение "В ТОПе": проверить место в лидерборде за сегодня (МСК)
        const mskDate = getMskDateString();
        const dayBounds = getMskDayBounds(mskDate);
        db.all(
          `SELECT userId, SUM(score) as totalScore FROM driver_game_scores
           WHERE parkId = ? AND playedAt >= ? AND playedAt <= ?
           GROUP BY userId ORDER BY totalScore DESC LIMIT 50`,
          [row.parkId, dayBounds.start, dayBounds.end],
          (e4, lbList) => {
            if (e4 || !lbList || lbList.length === 0) return;
            const myIdx = lbList.findIndex((r) => String(r.userId) === String(userId));
            if (myIdx >= 0 && myIdx < 10) upsertAchievementProgress(userId, 'top_once', 1);
          }
        );
      }
    );
  });
});

// ===== ФОТОКОНТРОЛЬ =====

function getDriverByUserId(userId, cb) {
  db.get(
    `SELECT d.id as driverId, d.parkId, d.carId, d.userId FROM drivers d WHERE d.userId = ?`,
    [userId],
    cb
  );
}

router.get('/photo-control/settings', authenticateToken, authorizeRole('driver'), (req, res) => {
  getDriverByUserId(req.user.userId, (err, driver) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!driver) return res.status(404).json({ error: 'Driver not found' });
    db.get(
      'SELECT enabled, price, validDays, notifyHoursBefore FROM park_photo_control_settings WHERE parkId = ?',
      [driver.parkId],
      (e, row) => {
        if (e) return res.status(500).json({ error: e.message });
        if (!row || !row.enabled) {
          return res.json({ enabled: false, price: 150, validDays: 10, notifyHoursBefore: 24 });
        }
        res.json({
          enabled: true,
          price: Number(row.price) || 150,
          validDays: Number(row.validDays) || 10,
          notifyHoursBefore: Number(row.notifyHoursBefore) || 24
        });
      }
    );
  });
});

router.get('/photo-control/list', authenticateToken, authorizeRole('driver'), (req, res) => {
  getDriverByUserId(req.user.userId, (err, driver) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!driver) return res.status(404).json({ error: 'Driver not found' });
    db.all(
      `SELECT a.id, a.carId, a.status, a.approvedAt, a.validUntil, a.rejectReason, a.createdAt, a.updatedAt, a.correctionRequestedAt, c.regNumber
       FROM photo_control_applications a
       LEFT JOIN cars c ON a.carId = c.id
       WHERE a.driverId = ? ORDER BY a.createdAt DESC LIMIT 20`,
      [driver.driverId],
      (e, rows) => {
        if (e) return res.status(500).json({ error: e.message });
        res.json(rows || []);
      }
    );
  });
});

router.post('/photo-control', authenticateToken, authorizeRole('driver'), (req, res) => {
  getDriverByUserId(req.user.userId, async (err, driver) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!driver) return res.status(404).json({ error: 'Driver not found' });
    if (!driver.carId) return res.status(400).json({ error: 'Сначала менеджер должен привязать вас к автомобилю.' });
    db.get(
      'SELECT enabled, price FROM park_photo_control_settings WHERE parkId = ?',
      [driver.parkId],
      (e, fc) => {
        if (e) return res.status(500).json({ error: e.message });
        if (!fc || !fc.enabled) return res.status(400).json({ error: 'Фотоконтроль для вашего парка отключён.' });
        const price = Number(fc.price) || 150;
        getBalance(db, driver.userId, (balanceErr, balance) => {
          if (balanceErr) return res.status(500).json({ error: balanceErr.message });
          const total = (balance?.balanceReal ?? 0) + (balance?.balanceUnreal ?? 0);
          if (total < price) return res.status(400).json({ error: `Недостаточно средств. Фотоконтроль — ${price} ₽.` });
          deductBalance(db, driver.userId, driver.parkId, price, 'Фотоконтроль', null, 'expense', (deductErr) => {
            if (deductErr) return res.status(500).json({ error: deductErr.message || 'Ошибка списания' });
            db.run(
              `INSERT INTO photo_control_applications (parkId, driverId, carId, status) VALUES (?, ?, ?, 'filling')`,
              [driver.parkId, driver.driverId, driver.carId],
              function (insErr) {
                if (insErr) return res.status(500).json({ error: insErr.message });
                res.status(201).json({ id: this.lastID, status: 'filling', message: 'Заявка создана. Заполните все шаги.' });
              }
            );
          });
        });
      }
    );
  });
});

router.get('/photo-control/:id', authenticateToken, authorizeRole('driver'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  getDriverByUserId(req.user.userId, (err, driver) => {
    if (err || !driver) return res.status(404).json({ error: 'Not found' });
    db.get(
      `SELECT a.id, a.carId, a.status, a.approvedAt, a.validUntil, a.rejectReason, a.createdAt, a.updatedAt, a.correctionRequestedAt, c.regNumber
       FROM photo_control_applications a
       LEFT JOIN cars c ON a.carId = c.id
       WHERE a.id = ? AND a.driverId = ?`,
      [id, driver.driverId],
      (e, app) => {
        if (e || !app) return res.status(404).json({ error: 'Not found' });
        db.all(
          'SELECT stepIndex, mediaType, filePath, managerVerdict, managerComment FROM photo_control_steps WHERE applicationId = ? ORDER BY stepIndex',
          [id],
          (e2, steps) => {
            if (e2) return res.status(500).json({ error: e2.message });
            res.json({ ...app, steps: steps || [] });
          }
        );
      }
    );
  });
});

router.put('/photo-control/:id/steps/:stepIndex', authenticateToken, authorizeRole('driver'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const stepIndex = parseInt(req.params.stepIndex, 10);
  if (!id || stepIndex < 1 || stepIndex > 10) return res.status(400).json({ error: 'Invalid id or step' });
  const { mediaType, content } = req.body || {};
  if (!content || typeof content !== 'string') return res.status(400).json({ error: 'Требуется content (base64)' });
  const type = (mediaType === 'video' ? 'video' : 'photo');
  const ext = type === 'video' ? '.mp4' : '.jpg';
  getDriverByUserId(req.user.userId, (err, driver) => {
    if (err || !driver) return res.status(404).json({ error: 'Not found' });
    db.get(
      `SELECT id, status, correctionRequestedAt FROM photo_control_applications WHERE id = ? AND driverId = ? AND (status IN ('filling', 'draft') OR (status = 'pending' AND correctionRequestedAt IS NOT NULL))`,
      [id, driver.driverId],
      (e, app) => {
        if (e || !app) return res.status(404).json({ error: 'Not found or нельзя редактировать' });
        ensureUploadDir();
        const buf = Buffer.from(content.replace(/^data:.*?;base64,/, ''), 'base64');
        const filename = `${id}_${stepIndex}${ext}`;
        const filePath = path.join(UPLOAD_DIR, filename);
        fs.writeFile(filePath, buf, (writeErr) => {
          if (writeErr) return res.status(500).json({ error: 'Ошибка сохранения файла' });
          const relativePath = `photo_control/${filename}`;
          db.run(
            'DELETE FROM photo_control_steps WHERE applicationId = ? AND stepIndex = ?',
            [id, stepIndex],
            () => {
              db.run(
                'INSERT INTO photo_control_steps (applicationId, stepIndex, mediaType, filePath) VALUES (?, ?, ?, ?)',
                [id, stepIndex, type, relativePath],
                (dbErr) => {
                  if (dbErr) return res.status(500).json({ error: dbErr.message });
                  res.json({ stepIndex, mediaType: type, filePath: relativePath });
                }
              );
            }
          );
        });
      }
    );
  });
});

router.patch('/photo-control/:id/submit', authenticateToken, authorizeRole('driver'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  getDriverByUserId(req.user.userId, (err, driver) => {
    if (err || !driver) return res.status(404).json({ error: 'Not found' });
    db.get(
      'SELECT id FROM photo_control_applications WHERE id = ? AND driverId = ? AND status IN (\'filling\', \'draft\')',
      [id, driver.driverId],
      (e, app) => {
        if (e || !app) return res.status(404).json({ error: 'Not found or cannot submit' });
        db.get(
          'SELECT COUNT(*) as cnt FROM photo_control_steps WHERE applicationId = ?',
          [id],
          (e2, row) => {
            if (e2) return res.status(500).json({ error: e2.message });
            if ((row?.cnt || 0) < 10) return res.status(400).json({ error: 'Заполните все 10 шагов (фото и видео).' });
            db.run(
              'UPDATE photo_control_applications SET status = \'pending\', updatedAt = datetime(\'now\') WHERE id = ?',
              [id],
              (upErr) => {
                if (upErr) return res.status(500).json({ error: upErr.message });
                res.json({ status: 'pending', message: 'Заявка отправлена на проверку.' });
              }
            );
          }
        );
      }
    );
  });
});

router.get('/photo-control/:id/steps/:stepIndex/file', authenticateToken, authorizeRole('driver'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const stepIndex = parseInt(req.params.stepIndex, 10);
  if (!id || stepIndex < 1 || stepIndex > 10) return res.status(400).end();
  getDriverByUserId(req.user.userId, (err, driver) => {
    if (err || !driver) return res.status(404).end();
    db.get(
      'SELECT id FROM photo_control_applications WHERE id = ? AND driverId = ?',
      [id, driver.driverId],
      (e, app) => {
        if (e || !app) return res.status(404).end();
        db.get(
          'SELECT filePath FROM photo_control_steps WHERE applicationId = ? AND stepIndex = ?',
          [id, stepIndex],
          (e2, step) => {
            if (e2 || !step?.filePath) return res.status(404).end();
            const fullPath = path.join(__dirname, '..', 'uploads', step.filePath);
            if (!fs.existsSync(fullPath)) return res.status(404).end();
            const ext = path.extname(fullPath);
            res.setHeader('Content-Type', ext === '.mp4' ? 'video/mp4' : 'image/jpeg');
            fs.createReadStream(fullPath).pipe(res);
          }
        );
      }
    );
  });
});

// ===== ЭВАКУАТОР (заявки от водилы) =====

/** Настройки эвакуатора для парка водителя + кол-во эваков на линии */
router.get('/evacuator/settings', authenticateToken, authorizeRole('driver'), (req, res) => {
  getDriverByUserId(req.user.userId, (err, driver) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!driver) return res.status(404).json({ error: 'Driver not found' });
    const parkId = driver.parkId;
    db.get(
      'SELECT evacuatorEnabled, requestPriceOverride FROM park_evacuator_settings WHERE parkId = ?',
      [parkId],
      (e1, parkRow) => {
        if (e1) return res.status(500).json({ error: e1.message });
        if (!parkRow || !parkRow.evacuatorEnabled) {
          return res.json({ enabled: false, requestCreationPrice: 0, evacuatorsOnlineCount: 0 });
        }
        db.get('SELECT requestCreationPrice FROM evacuator_settings WHERE id = 1', [], (e2, glob) => {
          if (e2) return res.status(500).json({ error: e2.message });
          const requestPrice = parkRow.requestPriceOverride != null
            ? Number(parkRow.requestPriceOverride)
            : (Number(glob?.requestCreationPrice) || 50);
          db.get(
            `SELECT COUNT(DISTINCT o.userId) as c FROM evacuator_online o
             INNER JOIN evacuator_source_parks sp ON sp.evacuatorUserId = o.userId AND sp.parkId = ?
             WHERE o.isOnline = 1`,
            [parkId],
            (e3, countRow) => {
              if (e3) return res.status(500).json({ error: e3.message });
              res.json({
                enabled: true,
                requestCreationPrice: requestPrice,
                evacuatorsOnlineCount: countRow?.c ?? 0
              });
            }
          );
        });
      }
    );
  });
});

/** Создать заявку на эвакуатор (фикс‑сбор спишется при подтверждении отклика) */
router.post('/evacuator/requests', authenticateToken, authorizeRole('driver'), (req, res) => {
  const { address, comment, lat, lon } = req.body || {};
  if (!address || !String(address).trim()) {
    return res.status(400).json({ error: 'Укажите адрес' });
  }
  getDriverByUserId(req.user.userId, (err, driver) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!driver) return res.status(404).json({ error: 'Driver not found' });
    const parkId = driver.parkId;
    db.get(
      'SELECT evacuatorEnabled, requestPriceOverride FROM park_evacuator_settings WHERE parkId = ?',
      [parkId],
      (e1, parkRow) => {
        if (e1) return res.status(500).json({ error: e1.message });
        if (!parkRow || !parkRow.evacuatorEnabled) {
          return res.status(400).json({ error: 'Вызов эвакуатора для вашего парка отключён' });
        }
        db.get('SELECT requestCreationPrice FROM evacuator_settings WHERE id = 1', [], (e2, glob) => {
          if (e2) return res.status(500).json({ error: e2.message });
          const requestPrice = parkRow.requestPriceOverride != null
            ? Number(parkRow.requestPriceOverride)
            : (Number(glob?.requestCreationPrice) || 50);
          if (requestPrice <= 0) return doCreateEvacuatorRequest(req, res, driver, parkId, 0, address, comment, lat, lon);
          getBalance(db, driver.userId, (balanceErr, balance) => {
            if (balanceErr) return res.status(500).json({ error: balanceErr.message });
            const total = (balance?.balanceReal ?? 0) + (balance?.balanceUnreal ?? 0);
            if (total < requestPrice) {
              return res.status(400).json({
                error: `Недостаточно средств. Сбор при подтверждении заявки — ${requestPrice} ₽. Пополните баланс.`
              });
            }
            // Не списываем здесь, чтобы не было двойного списания.
            // Списание фикс‑сбора выполняется при подтверждении отклика с operationKey.
            doCreateEvacuatorRequest(req, res, driver, parkId, requestPrice, address, comment, lat, lon);
          });
        });
      }
    );
  });
});

function doCreateEvacuatorRequest(req, res, driver, parkId, requestFeeAmount, address, comment, lat, lon) {
  const addressStr = String(address).trim();
  db.run(
    `INSERT INTO evacuator_requests (authorUserId, authorParkId, address, comment, lat, lon, status, requestFeeAmount, requestFeePaidAt)
     VALUES (?, ?, ?, ?, ?, ?, 'created', ?, ?)`,
    // requestFeeAmount — сервисный сбор парка (списывается в момент подтверждения отклика)
    [driver.userId, parkId, addressStr, comment || null, lat || null, lon || null, requestFeeAmount, null],
    function (insErr) {
      if (insErr) return res.status(500).json({ error: insErr.message });
      const requestId = this.lastID;
      db.all('SELECT evacuatorUserId FROM evacuator_source_parks WHERE parkId = ?', [parkId], (e, rows) => {
        (rows || []).forEach((row) => {
          db.run(
            'INSERT INTO notifications (userId, type, title, body) VALUES (?, ?, ?, ?)',
            [row.evacuatorUserId, 'evacuator_new_request', 'Новая заявка на эвакуатор', addressStr.length > 80 ? addressStr.slice(0, 77) + '…' : addressStr]
          );
        });
      });
      res.status(201).json({
        id: requestId,
        address: String(address).trim(),
        status: 'created',
        requestFeeAmount
      });
    }
  );
}

/** Мои заявки на эвакуатор (с откликами) */
router.get('/evacuator/requests', authenticateToken, authorizeRole('driver'), (req, res) => {
  const userId = req.user.userId;
  db.all(
    `SELECT r.id, r.address, r.comment, r.lat, r.lon, r.status, r.requestFeeAmount, r.createdAt, r.completedAt
     FROM evacuator_requests r
     WHERE r.authorUserId = ?
     ORDER BY r.createdAt DESC
     LIMIT 50`,
    [userId],
    (err, requests) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!requests || requests.length === 0) return res.json([]);
      const ids = requests.map((r) => r.id);
      const placeholders = ids.map(() => '?').join(',');
      db.all(
        `SELECT resp.id, resp.requestId, resp.evacuatorUserId, resp.etaMinutes, resp.price, resp.status as responseStatus, resp.createdAt,
                u.fullName as evacuatorName, u.phone as evacuatorPhone
         FROM evacuator_responses resp
         LEFT JOIN users u ON u.id = resp.evacuatorUserId
         WHERE resp.requestId IN (${placeholders})`,
        ids,
        (e2, responses) => {
          if (e2) return res.status(500).json({ error: e2.message });
          const byRequest = {};
          (responses || []).forEach((r) => {
            if (!byRequest[r.requestId]) byRequest[r.requestId] = [];
            byRequest[r.requestId].push(r);
          });
          const list = requests.map((req) => ({
            ...req,
            responses: byRequest[req.id] || []
          }));
          res.json(list);
        }
      );
    }
  );
});

/** Подтвердить отклик (выбрать эвака) — опционально оплата с баланса */
router.post('/evacuator/requests/:requestId/confirm', authenticateToken, authorizeRole('driver'), (req, res) => {
  const userId = req.user.userId;
  const requestId = parseInt(req.params.requestId, 10);
  const { responseId } = req.body || {};
  if (!requestId || !responseId) {
    return res.status(400).json({ error: 'Нужны requestId и responseId' });
  }
  getDriverByUserId(userId, (err, driver) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!driver) return res.status(404).json({ error: 'Driver not found' });
    db.get(
      'SELECT id, authorUserId, status FROM evacuator_requests WHERE id = ?',
      [requestId],
      (e1, reqRow) => {
        if (e1) return res.status(500).json({ error: e1.message });
        if (!reqRow) return res.status(404).json({ error: 'Заявка не найдена' });
        if (reqRow.authorUserId !== userId) return res.status(403).json({ error: 'Не ваша заявка' });
        if (reqRow.status !== 'created' && reqRow.status !== 'has_responses') {
          return res.status(400).json({ error: 'Заявка уже подтверждена или закрыта' });
        }
        db.get(
          'SELECT id, requestId, evacuatorUserId, price, status FROM evacuator_responses WHERE id = ? AND requestId = ?',
          [responseId, requestId],
          (e2, respRow) => {
            if (e2) return res.status(500).json({ error: e2.message });
            if (!respRow) return res.status(404).json({ error: 'Отклик не найден' });
            if (respRow.status !== 'pending') return res.status(400).json({ error: 'Отклик уже обработан' });
            const price = Number(respRow.price) || 0;

            // Сервисный сбор с водителя (фикс по парку) — списываем В МОМЕНТ ПОДТВЕРЖДЕНИЯ
            db.get('SELECT requestPriceOverride FROM park_evacuator_settings WHERE parkId = ?', [driver.parkId], (sErr, parkSet) => {
              if (sErr) return res.status(500).json({ error: sErr.message });
              const parkOverride = parkSet && parkSet.requestPriceOverride != null ? Number(parkSet.requestPriceOverride) : null;
              db.get('SELECT requestCreationPrice FROM evacuator_settings WHERE id = 1', [], (gErr, glob) => {
                if (gErr) return res.status(500).json({ error: gErr.message });
                const driverFee = parkOverride != null ? parkOverride : (Number(glob?.requestCreationPrice) || 0);

                // Фикс‑сбор с эвакуаторщика — ставка в админке (если не задана, 0)
                db.get('SELECT evacuator_fixed_fee FROM users WHERE id = ? AND role = ?', [respRow.evacuatorUserId, 'evacuator'], (uErr, evacUser) => {
                  if (uErr) return res.status(500).json({ error: uErr.message });
                  const evacuatorFee = evacUser?.evacuator_fixed_fee != null ? Number(evacUser.evacuator_fixed_fee) : 0;

                  // Проверяем баланс водилы для сервисного сбора (+ возможная оплата эвакуатора, если payNow)
                  getBalance(db, userId, (balanceErr, balance) => {
                    if (balanceErr) return res.status(500).json({ error: balanceErr.message });
                    const totalDriver = (balance?.balanceReal ?? 0) + (balance?.balanceUnreal ?? 0);
                    if (driverFee > 0 && totalDriver < driverFee) {
                      return res.status(400).json({ error: `Недостаточно средств для подтверждения заявки (сбор ${driverFee} ₽). Пополните баланс.` });
                    }
                    // Оплата услуги эвакуатора (price) на сайте НЕ проводится — оплата по факту/на месте.

                    // Проверяем баланс эвакуатора для его фикс‑сбора
                    getBalance(db, respRow.evacuatorUserId, (ebErr, eBal) => {
                      if (ebErr) return res.status(500).json({ error: ebErr.message });
                      const totalEvac = (eBal?.balanceReal ?? 0) + (eBal?.balanceUnreal ?? 0);
                      if (evacuatorFee > 0 && totalEvac < evacuatorFee) {
                        return res.status(400).json({ error: `Эвакуатор не может быть подтверждён: у него недостаточно средств для сервисного сбора (${evacuatorFee} ₽). Выберите другого.` });
                      }

                      const nowIso = new Date().toISOString();
                      const deductDriverFee = (cb) => {
                        if (!driverFee || driverFee <= 0) return cb();
                        deductBalance(
                          db,
                          userId,
                          driver.parkId,
                          driverFee,
                          `Сбор за подтверждение заявки эвакуатора #${requestId}`,
                          null,
                          'expense',
                          `evacuator_request_fee:${requestId}`,
                          (dErr) => cb(dErr)
                        );
                      };
                      const deductEvacFee = (cb) => {
                        if (!evacuatorFee || evacuatorFee <= 0) return cb();
                        deductBalance(
                          db,
                          respRow.evacuatorUserId,
                          driver.parkId,
                          evacuatorFee,
                          `Сбор за подтверждённый заказ #${requestId}`,
                          null,
                          'expense',
                          `evacuator_fee:${requestId}:${respRow.evacuatorUserId}`,
                          (dErr) => cb(dErr)
                        );
                      };

                      deductDriverFee((d1) => {
                        if (d1) return res.status(500).json({ error: d1.message || 'Ошибка списания сбора с водителя' });
                        deductEvacFee((d2) => {
                          if (d2) return res.status(500).json({ error: d2.message || 'Ошибка списания сбора с эвакуатора' });

                          db.run(
                            'UPDATE evacuator_requests SET requestFeePaidAt = COALESCE(requestFeePaidAt, ?), evacuatorFeeAmount = ?, evacuatorFeePaidAt = COALESCE(evacuatorFeePaidAt, ?) WHERE id = ?',
                            [driverFee > 0 ? nowIso : null, evacuatorFee > 0 ? evacuatorFee : null, evacuatorFee > 0 ? nowIso : null, requestId],
                            () => {
                              doConfirmEvacuatorResponse(req, res, requestId, responseId, respRow.evacuatorUserId, 0, driver.parkId, 'cash', driverFee, evacuatorFee);
                            }
                          );
                        });
                      });
                    });
                  });
                });
              });
            });
          }
        );
      }
    );
  });
});

function doConfirmEvacuatorResponse(req, res, requestId, responseId, evacuatorUserId, agreedPrice, authorParkId, paymentMethod, driverFeeAmount, evacuatorFeeAmount) {
  const now = new Date().toISOString();
  // Сервисные сборы списываются при подтверждении (см. confirm). Здесь фиксируем выбранного эвакуатора и способ оплаты его цены.
  db.run(
    "UPDATE evacuator_responses SET status = 'rejected' WHERE requestId = ? AND id != ?",
    [requestId, responseId],
    (e1) => {
      if (e1) return res.status(500).json({ error: e1.message });
      db.run(
        "UPDATE evacuator_responses SET status = 'accepted' WHERE id = ?",
        [responseId],
        (e2) => {
          if (e2) return res.status(500).json({ error: e2.message });
          db.run(
            "UPDATE evacuator_requests SET status = 'confirmed', chosenResponseId = ?, paymentMethod = ?, confirmedAt = ?, updatedAt = ?, requestFeeAmount = COALESCE(requestFeeAmount, ?), evacuatorFeeAmount = COALESCE(evacuatorFeeAmount, ?) WHERE id = ?",
            [responseId, paymentMethod || 'cash', now, now, driverFeeAmount != null ? Number(driverFeeAmount) : null, evacuatorFeeAmount != null ? Number(evacuatorFeeAmount) : null, requestId],
            (e3) => {
              if (e3) return res.status(500).json({ error: e3.message });
              db.get('SELECT address FROM evacuator_requests WHERE id = ?', [requestId], (_, reqRow) => {
                  const addr = reqRow?.address || '';
                  db.run(
                    'INSERT INTO notifications (userId, type, title, body) VALUES (?, ?, ?, ?)',
                    [evacuatorUserId, 'evacuator_confirmed', 'Ваш отклик принят', addr.length > 100 ? addr.slice(0, 97) + '…' : addr]
                  );
                });
                res.json({
                  success: true,
                  requestId,
                  responseId,
                  status: 'confirmed',
                  paymentMethod: paymentMethod || 'cash',
                  payOnCompletion: paymentMethod === 'balance' && agreedPrice > 0
                });
              }
            );
          }
        );
      }
    );
}

// ===== АВАРИЙНЫЙ КОМИССАР (заявки от водилы) =====

/** Настройки комиссара для парка водителя + кол-во комиссаров на линии */
router.get('/commissioner/settings', authenticateToken, authorizeRole('driver'), (req, res) => {
  getDriverByUserId(req.user.userId, (err, driver) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!driver) return res.status(404).json({ error: 'Driver not found' });
    const parkId = driver.parkId;
    db.get(
      'SELECT commissionerEnabled, requestPriceOverride FROM park_commissioner_settings WHERE parkId = ?',
      [parkId],
      (e1, parkRow) => {
        if (e1) return res.status(500).json({ error: e1.message });
        if (!parkRow || !parkRow.commissionerEnabled) {
          return res.json({ enabled: false, requestCreationPrice: 0, commissionersOnlineCount: 0 });
        }
        db.get('SELECT requestCreationPrice FROM commissioner_settings WHERE id = 1', [], (e2, glob) => {
          if (e2) return res.status(500).json({ error: e2.message });
          const requestPrice = parkRow.requestPriceOverride != null
            ? Number(parkRow.requestPriceOverride)
            : (Number(glob?.requestCreationPrice) || 50);
          db.get(
            `SELECT COUNT(DISTINCT o.userId) as c FROM commissioner_online o
             INNER JOIN commissioner_source_parks sp ON sp.commissionerUserId = o.userId AND sp.parkId = ?
             WHERE o.isOnline = 1`,
            [parkId],
            (e3, countRow) => {
              if (e3) return res.status(500).json({ error: e3.message });
              res.json({
                enabled: true,
                requestCreationPrice: requestPrice,
                commissionersOnlineCount: countRow?.c ?? 0
              });
            }
          );
        });
      }
    );
  });
});

/** Создать заявку комиссару (фикс‑сбор спишется при подтверждении отклика) */
router.post('/commissioner/requests', authenticateToken, authorizeRole('driver'), (req, res) => {
  const { address, comment, lat, lon } = req.body || {};
  if (!address || !String(address).trim()) {
    return res.status(400).json({ error: 'Укажите адрес' });
  }
  getDriverByUserId(req.user.userId, (err, driver) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!driver) return res.status(404).json({ error: 'Driver not found' });
    const parkId = driver.parkId;
    db.get(
      'SELECT commissionerEnabled, requestPriceOverride FROM park_commissioner_settings WHERE parkId = ?',
      [parkId],
      (e1, parkRow) => {
        if (e1) return res.status(500).json({ error: e1.message });
        if (!parkRow || !parkRow.commissionerEnabled) {
          return res.status(400).json({ error: 'Вызов комиссара для вашего парка отключён' });
        }
        db.get('SELECT requestCreationPrice FROM commissioner_settings WHERE id = 1', [], (e2, glob) => {
          if (e2) return res.status(500).json({ error: e2.message });
          const requestPrice = parkRow.requestPriceOverride != null
            ? Number(parkRow.requestPriceOverride)
            : (Number(glob?.requestCreationPrice) || 50);
          if (requestPrice <= 0) return doCreateCommissionerRequest(req, res, driver, parkId, 0, address, comment, lat, lon);
          getBalance(db, driver.userId, (balanceErr, balance) => {
            if (balanceErr) return res.status(500).json({ error: balanceErr.message });
            const total = (balance?.balanceReal ?? 0) + (balance?.balanceUnreal ?? 0);
            if (total < requestPrice) {
              return res.status(400).json({
                error: `Недостаточно средств. Сбор при подтверждении заявки — ${requestPrice} ₽. Пополните баланс.`
              });
            }
            // Не списываем здесь, чтобы не было двойного списания.
            // Списание фикс‑сбора выполняется при подтверждении отклика с operationKey.
            doCreateCommissionerRequest(req, res, driver, parkId, requestPrice, address, comment, lat, lon);
          });
        });
      }
    );
  });
});

function doCreateCommissionerRequest(req, res, driver, parkId, requestFeeAmount, address, comment, lat, lon) {
  const addressStr = String(address).trim();
  db.run(
    `INSERT INTO commissioner_requests (authorUserId, authorParkId, address, comment, lat, lon, status, requestFeeAmount, requestFeePaidAt)
     VALUES (?, ?, ?, ?, ?, ?, 'created', ?, ?)`,
    [driver.userId, parkId, addressStr, comment || null, lat || null, lon || null, requestFeeAmount, null],
    function (insErr) {
      if (insErr) return res.status(500).json({ error: insErr.message });
      const requestId = this.lastID;
      db.all('SELECT commissionerUserId FROM commissioner_source_parks WHERE parkId = ?', [parkId], (e, rows) => {
        (rows || []).forEach((row) => {
          db.run(
            'INSERT INTO notifications (userId, type, title, body) VALUES (?, ?, ?, ?)',
            [row.commissionerUserId, 'commissioner_new_request', 'Новая заявка комиссару', addressStr.length > 80 ? addressStr.slice(0, 77) + '…' : addressStr]
          );
        });
      });
      res.status(201).json({
        id: requestId,
        address: addressStr,
        status: 'created',
        requestFeeAmount
      });
    }
  );
}

/** Мои заявки комиссару (с откликами) */
router.get('/commissioner/requests', authenticateToken, authorizeRole('driver'), (req, res) => {
  const userId = req.user.userId;
  db.all(
    `SELECT r.id, r.address, r.comment, r.lat, r.lon, r.status, r.requestFeeAmount, r.createdAt, r.completedAt
     FROM commissioner_requests r
     WHERE r.authorUserId = ?
     ORDER BY r.createdAt DESC
     LIMIT 50`,
    [userId],
    (err, requests) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!requests || requests.length === 0) return res.json([]);
      const ids = requests.map((r) => r.id);
      const placeholders = ids.map(() => '?').join(',');
      db.all(
        `SELECT resp.id, resp.requestId, resp.commissionerUserId, resp.etaMinutes, resp.price, resp.status as responseStatus, resp.createdAt,
                u.fullName as commissionerName, u.phone as commissionerPhone
         FROM commissioner_responses resp
         LEFT JOIN users u ON u.id = resp.commissionerUserId
         WHERE resp.requestId IN (${placeholders})`,
        ids,
        (e2, responses) => {
          if (e2) return res.status(500).json({ error: e2.message });
          const byRequest = {};
          (responses || []).forEach((r) => {
            if (!byRequest[r.requestId]) byRequest[r.requestId] = [];
            byRequest[r.requestId].push(r);
          });
          const list = requests.map((req) => ({
            ...req,
            responses: byRequest[req.id] || []
          }));
          res.json(list);
        }
      );
    }
  );
});

/** Подтвердить отклик (выбрать комиссара) */
router.post('/commissioner/requests/:requestId/confirm', authenticateToken, authorizeRole('driver'), (req, res) => {
  const userId = req.user.userId;
  const requestId = parseInt(req.params.requestId, 10);
  const { responseId } = req.body || {};
  if (!requestId || !responseId) {
    return res.status(400).json({ error: 'Нужны requestId и responseId' });
  }
  getDriverByUserId(userId, (err, driver) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!driver) return res.status(404).json({ error: 'Driver not found' });
    db.get(
      'SELECT id, authorUserId, status FROM commissioner_requests WHERE id = ?',
      [requestId],
      (e1, reqRow) => {
        if (e1) return res.status(500).json({ error: e1.message });
        if (!reqRow) return res.status(404).json({ error: 'Заявка не найдена' });
        if (reqRow.authorUserId !== userId) return res.status(403).json({ error: 'Не ваша заявка' });
        if (reqRow.status !== 'created' && reqRow.status !== 'has_responses') {
          return res.status(400).json({ error: 'Заявка уже подтверждена или закрыта' });
        }
        db.get(
          'SELECT id, requestId, commissionerUserId, price, status FROM commissioner_responses WHERE id = ? AND requestId = ?',
          [responseId, requestId],
          (e2, respRow) => {
            if (e2) return res.status(500).json({ error: e2.message });
            if (!respRow) return res.status(404).json({ error: 'Отклик не найден' });
            if (respRow.status !== 'pending') return res.status(400).json({ error: 'Отклик уже обработан' });

            // Сервисный сбор с водителя — списываем В МОМЕНТ ПОДТВЕРЖДЕНИЯ
            db.get('SELECT requestPriceOverride FROM park_commissioner_settings WHERE parkId = ?', [driver.parkId], (sErr, parkSet) => {
              if (sErr) return res.status(500).json({ error: sErr.message });
              const parkOverride = parkSet && parkSet.requestPriceOverride != null ? Number(parkSet.requestPriceOverride) : null;
              db.get('SELECT requestCreationPrice FROM commissioner_settings WHERE id = 1', [], (gErr, glob) => {
                if (gErr) return res.status(500).json({ error: gErr.message });
                const driverFee = parkOverride != null ? parkOverride : (Number(glob?.requestCreationPrice) || 0);

                // Фикс‑сбор с комиссара — ставка в админке (если не задана, 0)
                db.get('SELECT commissioner_fixed_fee FROM users WHERE id = ? AND role = ?', [respRow.commissionerUserId, 'commissioner'], (uErr, comUser) => {
                  if (uErr) return res.status(500).json({ error: uErr.message });
                  const commissionerFee = comUser?.commissioner_fixed_fee != null ? Number(comUser.commissioner_fixed_fee) : 0;

                  getBalance(db, userId, (balanceErr, balance) => {
                    if (balanceErr) return res.status(500).json({ error: balanceErr.message });
                    const totalDriver = (balance?.balanceReal ?? 0) + (balance?.balanceUnreal ?? 0);
                    if (driverFee > 0 && totalDriver < driverFee) {
                      return res.status(400).json({ error: `Недостаточно средств для подтверждения заявки (сбор ${driverFee} ₽). Пополните баланс.` });
                    }

                    getBalance(db, respRow.commissionerUserId, (cbErr, cBal) => {
                      if (cbErr) return res.status(500).json({ error: cbErr.message });
                      const totalCom = (cBal?.balanceReal ?? 0) + (cBal?.balanceUnreal ?? 0);
                      if (commissionerFee > 0 && totalCom < commissionerFee) {
                        return res.status(400).json({ error: `Комиссар не может быть подтверждён: у него недостаточно средств для сервисного сбора (${commissionerFee} ₽). Выберите другого.` });
                      }

                      const nowIso = new Date().toISOString();
                      const deductDriverFee = (cb) => {
                        if (!driverFee || driverFee <= 0) return cb();
                        deductBalance(
                          db,
                          userId,
                          driver.parkId,
                          driverFee,
                          `Сбор за подтверждение заявки комиссара #${requestId}`,
                          null,
                          'expense',
                          `commissioner_request_fee:${requestId}`,
                          (dErr) => cb(dErr)
                        );
                      };
                      const deductCommissionerFee = (cb) => {
                        if (!commissionerFee || commissionerFee <= 0) return cb();
                        deductBalance(
                          db,
                          respRow.commissionerUserId,
                          driver.parkId,
                          commissionerFee,
                          `Сбор за подтверждённый заказ #${requestId}`,
                          null,
                          'expense',
                          `commissioner_fee:${requestId}:${respRow.commissionerUserId}`,
                          (dErr) => cb(dErr)
                        );
                      };

                      deductDriverFee((d1) => {
                        if (d1) return res.status(500).json({ error: d1.message || 'Ошибка списания сбора с водителя' });
                        deductCommissionerFee((d2) => {
                          if (d2) return res.status(500).json({ error: d2.message || 'Ошибка списания сбора с комиссара' });

                          db.run(
                            'UPDATE commissioner_requests SET requestFeePaidAt = COALESCE(requestFeePaidAt, ?), commissionerFeeAmount = ?, commissionerFeePaidAt = COALESCE(commissionerFeePaidAt, ?) WHERE id = ?',
                            [driverFee > 0 ? nowIso : null, commissionerFee > 0 ? commissionerFee : null, commissionerFee > 0 ? nowIso : null, requestId],
                            () => {
                              doConfirmCommissionerResponse(req, res, requestId, responseId, respRow.commissionerUserId, 'cash', driverFee, commissionerFee);
                            }
                          );
                        });
                      });
                    });
                  });
                });
              });
            });
          }
        );
      }
    );
  });
});

function doConfirmCommissionerResponse(req, res, requestId, responseId, commissionerUserId, paymentMethod, driverFeeAmount, commissionerFeeAmount) {
  const now = new Date().toISOString();
  db.run(
    "UPDATE commissioner_responses SET status = 'rejected' WHERE requestId = ? AND id != ?",
    [requestId, responseId],
    (e1) => {
      if (e1) return res.status(500).json({ error: e1.message });
      db.run(
        "UPDATE commissioner_responses SET status = 'accepted' WHERE id = ?",
        [responseId],
        (e2) => {
          if (e2) return res.status(500).json({ error: e2.message });
          db.run(
            "UPDATE commissioner_requests SET status = 'confirmed', chosenResponseId = ?, paymentMethod = ?, confirmedAt = ?, updatedAt = ?, requestFeeAmount = COALESCE(requestFeeAmount, ?), commissionerFeeAmount = COALESCE(commissionerFeeAmount, ?) WHERE id = ?",
            [responseId, paymentMethod || 'cash', now, now, driverFeeAmount != null ? Number(driverFeeAmount) : null, commissionerFeeAmount != null ? Number(commissionerFeeAmount) : null, requestId],
            (e3) => {
              if (e3) return res.status(500).json({ error: e3.message });
              db.get('SELECT address, authorUserId FROM commissioner_requests WHERE id = ?', [requestId], (_, reqRow) => {
                const addr = reqRow?.address || '';
                if (commissionerUserId) {
                  db.run(
                    'INSERT INTO notifications (userId, type, title, body) VALUES (?, ?, ?, ?)',
                    [commissionerUserId, 'commissioner_confirmed', 'Ваш отклик принят', addr.length > 100 ? addr.slice(0, 97) + '…' : addr]
                  );
                }
              });
              res.json({
                success: true,
                requestId,
                responseId,
                status: 'confirmed',
                paymentMethod: paymentMethod || 'cash'
              });
            }
          );
        }
      );
    }
  );
}

module.exports = router;
