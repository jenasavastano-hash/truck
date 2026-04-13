const express = require('express');
const router = express.Router();
const db = require('../database');
const { ensureParksTable, ensureParkExists } = require('../utils/parks-db');
const { authenticateToken, authorizeRole, hashPassword } = require('../auth');

// ===== Глобальные настройки эвакуаторов =====
router.get('/evacuator/settings', authenticateToken, authorizeRole('admin'), (req, res) => {
  db.get('SELECT requestCreationPrice, commissionPercent, updatedAt FROM evacuator_settings WHERE id = 1', [], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({
      requestCreationPrice: row?.requestCreationPrice ?? 50,
      commissionPercent: row?.commissionPercent ?? 15,
      updatedAt: row?.updatedAt || null
    });
  });
});

router.put('/evacuator/settings', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { requestCreationPrice, commissionPercent } = req.body || {};
  const price = requestCreationPrice != null ? parseFloat(requestCreationPrice) : null;
  const percent = commissionPercent != null ? parseFloat(commissionPercent) : null;
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO evacuator_settings (id, requestCreationPrice, commissionPercent, updatedAt) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       requestCreationPrice = COALESCE(?, requestCreationPrice),
       commissionPercent = COALESCE(?, commissionPercent),
       updatedAt = excluded.updatedAt`,
    [price ?? 50, percent ?? 15, now, price, percent],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, requestCreationPrice: price ?? 50, commissionPercent: percent ?? 15 });
    }
  );
});

// ===== Список водителей эвакуаторов =====
router.get('/evacuators', authenticateToken, authorizeRole('admin'), (req, res) => {
  db.all(
    `SELECT u.id, u.username, u.fullName, u.phone, u.createdAt,
            (SELECT GROUP_CONCAT(esp.parkId) FROM evacuator_source_parks esp WHERE esp.evacuatorUserId = u.id) as parkIds,
            u.evacuator_fixed_fee as fixedFee,
            o.isOnline, o.updatedAt as onlineUpdatedAt
     FROM users u
     LEFT JOIN evacuator_online o ON o.userId = u.id
     WHERE u.role = 'evacuator'
     ORDER BY u.id`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const list = (rows || []).map((r) => ({
        id: r.id,
        username: r.username,
        fullName: r.fullName,
        phone: r.phone,
        createdAt: r.createdAt,
        parkIds: r.parkIds ? r.parkIds.split(',').map(Number) : [],
        fixedFee: r.fixedFee != null ? Number(r.fixedFee) : null,
        isOnline: !!r.isOnline,
        onlineUpdatedAt: r.onlineUpdatedAt
      }));
      res.json(list);
    }
  );
});

// ===== Один эвакуатор + парки =====
router.get('/evacuators/:id', authenticateToken, authorizeRole('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  db.get(
    'SELECT id, username, fullName, phone, createdAt, evacuator_fixed_fee, balanceReal, balanceUnreal FROM users WHERE id = ? AND role = ?',
    [id, 'evacuator'],
    (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user) return res.status(404).json({ error: 'Not found' });
      db.all(
        'SELECT parkId FROM evacuator_source_parks WHERE evacuatorUserId = ?',
        [id],
        (e2, parks) => {
          if (e2) return res.status(500).json({ error: e2.message });
          db.get('SELECT isOnline, updatedAt FROM evacuator_online WHERE userId = ?', [id], (e3, online) => {
            const fixedFee = user.evacuator_fixed_fee != null ? Number(user.evacuator_fixed_fee) : null;
            res.json({
              ...user,
              fixedFee: fixedFee ?? 0,
              balance: (Number(user.balanceReal || 0) + Number(user.balanceUnreal || 0)),
              parkIds: (parks || []).map((p) => p.parkId),
              isOnline: !!(online && online.isOnline),
              onlineUpdatedAt: online?.updatedAt || null
            });
          });
        }
      );
    }
  );
});

// Нормализация телефона в логин (только цифры)
function phoneToLogin(phone) {
  if (!phone || typeof phone !== 'string') return '';
  return phone.replace(/\D/g, '').trim() || phone.trim();
}

// ===== Создать водителя эвакуатора =====
// Логин и пароль опциональны: если не указаны, используются телефон (только цифры) как логин и пароль
router.post('/evacuators', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { username, password, fullName, phone, parkIds, fixedFee } = req.body || {};
  const login = (username && String(username).trim()) || phoneToLogin(phone);
  const pass = (password && String(password)) || login;
  if (!login) return res.status(400).json({ error: 'Укажите телефон или логин' });
  const parkIdList = Array.isArray(parkIds) ? parkIds.filter((p) => p != null) : [];
  const feeVal = fixedFee != null && fixedFee !== '' ? parseFloat(fixedFee) : null;
  db.get('SELECT id FROM users WHERE username = ?', [login], (err, exist) => {
    if (err) return res.status(500).json({ error: err.message });
    if (exist) return res.status(400).json({ error: 'Пользователь с таким логином уже есть' });
    const hashedPassword = hashPassword(pass);
    db.run(
      `INSERT INTO users (username, password, fullName, phone, role, evacuator_fixed_fee) VALUES (?, ?, ?, ?, 'evacuator', ?)`,
      [login, hashedPassword, fullName || null, phone || null, feeVal],
      function (insErr) {
        if (insErr) return res.status(500).json({ error: insErr.message });
        const userId = this.lastID;
        if (parkIdList.length > 0) {
          const stmt = db.prepare('INSERT INTO evacuator_source_parks (evacuatorUserId, parkId) VALUES (?, ?)');
          parkIdList.forEach((parkId) => stmt.run(userId, parkId));
          stmt.finalize();
        }
        res.status(201).json({
          id: userId,
          username: login,
          fullName: fullName || null,
          phone: phone || null,
          parkIds: parkIdList
        });
      }
    );
  });
});

// ===== Обновить эвакуатора (парки, комиссия) =====
router.put('/evacuators/:id', authenticateToken, authorizeRole('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { fullName, phone, parkIds, password, fixedFee } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  db.get('SELECT id FROM users WHERE id = ? AND role = ?', [id, 'evacuator'], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(404).json({ error: 'Not found' });
    const updates = [];
    const params = [];
    if (fullName !== undefined) {
      updates.push('fullName = ?');
      params.push(fullName);
    }
    if (phone !== undefined) {
      updates.push('phone = ?');
      params.push(phone);
    }
    if (fixedFee !== undefined) {
      const v = fixedFee === '' || fixedFee == null ? null : parseFloat(fixedFee);
      updates.push('evacuator_fixed_fee = ?');
      params.push(v);
    }
    if (password !== undefined && String(password).trim()) {
      const { hashPassword } = require('../auth');
      updates.push('password = ?');
      params.push(hashPassword(password));
    }
    params.push(id);
    if (updates.length > 0) {
      db.run(`UPDATE users SET ${updates.join(', ')}, updatedAt = ? WHERE id = ?`, [...params.slice(0, -1), new Date().toISOString(), id], (e2) => {
        if (e2) return res.status(500).json({ error: e2.message });
        updateEvacuatorParks(id, parkIds, res);
      });
    } else {
      updateEvacuatorParks(id, parkIds, res);
    }
  });
});

function updateEvacuatorParks(userId, parkIds, res) {
  if (!res) return;
  const parkIdList = Array.isArray(parkIds) ? parkIds.filter((p) => p != null) : [];
  db.run('DELETE FROM evacuator_source_parks WHERE evacuatorUserId = ?', [userId], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    if (parkIdList.length === 0) return res.json({ success: true });
    const stmt = db.prepare('INSERT INTO evacuator_source_parks (evacuatorUserId, parkId) VALUES (?, ?)');
    parkIdList.forEach((parkId) => stmt.run(userId, parkId));
    stmt.finalize((e2) => {
      if (e2) return res.status(500).json({ error: e2.message });
      res.json({ success: true });
    });
  });
}

// ===== Удалить эвакуатора =====
router.delete('/evacuators/:id', authenticateToken, authorizeRole('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  db.get('SELECT id FROM users WHERE id = ? AND role = ?', [id, 'evacuator'], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(404).json({ error: 'Not found' });
    db.run('DELETE FROM evacuator_source_parks WHERE evacuatorUserId = ?', [id], () => {
      db.run('DELETE FROM evacuator_online WHERE userId = ?', [id], () => {
        db.run('DELETE FROM users WHERE id = ?', [id], (e3) => {
          if (e3) return res.status(500).json({ error: e3.message });
          res.json({ success: true });
        });
      });
    });
  });
});

// Пополнить баланс эвакуатора (админ)
router.post('/evacuators/:id/balance', authenticateToken, authorizeRole('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { amount, amountType = 'real' } = req.body || {};
  const num = Number(amount);
  if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  if (!num || Number.isNaN(num) || num <= 0) return res.status(400).json({ error: 'Укажите сумму больше 0' });
  const { addBalance } = require('../utils/balance');
  db.get('SELECT id FROM users WHERE id = ? AND role = ?', [id, 'evacuator'], (e1, row) => {
    if (e1) return res.status(500).json({ error: e1.message });
    if (!row) return res.status(404).json({ error: 'Эвакуатор не найден' });
    addBalance(db, id, num, amountType, amountType === 'real' ? 'Пополнение эвакуатора (админ)' : 'Бонус эвакуатора (админ)', (e2) => {
      if (e2) return res.status(500).json({ error: e2.message });
      res.json({ success: true, amount: num, amountType });
    });
  });
});

// ===== Настройки эвакуатора по парку =====
router.get('/parks/:parkId/evacuator-settings', authenticateToken, authorizeRole('admin'), (req, res) => {
  const parkId = parseInt(req.params.parkId, 10);
  if (!parkId) return res.status(400).json({ error: 'Invalid parkId' });
  db.get(
    'SELECT evacuatorEnabled, requestPriceOverride, updatedAt FROM park_evacuator_settings WHERE parkId = ?',
    [parkId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        evacuatorEnabled: !!(row && row.evacuatorEnabled),
        requestPriceOverride: row?.requestPriceOverride ?? null,
        updatedAt: row?.updatedAt || null
      });
    }
  );
});

router.put('/parks/:parkId/evacuator-settings', authenticateToken, authorizeRole('admin'), (req, res) => {
  const parkId = parseInt(req.params.parkId, 10);
  const { evacuatorEnabled, requestPriceOverride } = req.body || {};
  if (!parkId) return res.status(400).json({ error: 'Invalid parkId' });
  const now = new Date().toISOString();
  const enabled = evacuatorEnabled ? 1 : 0;
  const override = requestPriceOverride != null && requestPriceOverride !== '' ? parseFloat(requestPriceOverride) : null;

  ensureParksTable(() => {
    ensureParkExists(parkId, null, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      db.run(
        `INSERT INTO park_evacuator_settings (parkId, evacuatorEnabled, requestPriceOverride, updatedAt)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(parkId) DO UPDATE SET
           evacuatorEnabled = excluded.evacuatorEnabled,
           requestPriceOverride = excluded.requestPriceOverride,
           updatedAt = excluded.updatedAt`,
        [parkId, enabled, override, now],
        (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({
            success: true,
            evacuatorEnabled: !!enabled,
            requestPriceOverride: override
          });
        }
      );
    });
  });
});

// ===== Список заявок на эвакуатор (для админки) =====
router.get('/evacuator/requests', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { status, parkId } = req.query || {};
  let sql = `
    SELECT r.id, r.authorUserId, r.authorParkId, r.address, r.comment, r.lat, r.lon, r.status,
           r.requestFeeAmount, r.requestFeePaidAt, r.evacuatorFeeAmount, r.evacuatorFeePaidAt,
           r.chosenResponseId, r.createdAt, r.confirmedAt, r.inProgressAt, r.completedAt,
           p.name as parkName, u.fullName as authorName, u.phone as authorPhone
    FROM evacuator_requests r
    LEFT JOIN parks p ON r.authorParkId = p.id
    LEFT JOIN users u ON r.authorUserId = u.id
    WHERE 1=1`;
  const params = [];
  if (status) {
    sql += ' AND r.status = ?';
    params.push(status);
  }
  if (parkId) {
    sql += ' AND r.authorParkId = ?';
    params.push(parseInt(parkId, 10));
  }
  sql += ' ORDER BY r.createdAt DESC LIMIT 200';
  db.all(sql, params, (err, requests) => {
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
        res.json(requests.map((req) => ({ ...req, responses: byRequest[req.id] || [] })));
      }
    );
  });
});

// ===== Статистика по эвакуаторам =====
router.get('/evacuator/stats', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { from, to } = req.query || {};
  const fromDate = from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const toDate = to || new Date().toISOString().slice(0, 10);
  const fromTs = `${fromDate}T00:00:00.000Z`;
  const toTs = `${toDate}T23:59:59.999Z`;

  db.get(
    `SELECT
       COUNT(*) as totalRequests,
       SUM(CASE WHEN status IN ('confirmed','in_progress','completed') THEN 1 ELSE 0 END) as confirmedOrders,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedOrders,
       SUM(COALESCE(requestFeeAmount, 0)) as totalRequestFees,
       SUM(COALESCE(evacuatorFeeAmount, 0)) as totalEvacuatorFees
     FROM evacuator_requests
     WHERE createdAt >= ? AND createdAt <= ?`,
    [fromTs, toTs],
    (err, agg) => {
      if (err) return res.status(500).json({ error: err.message });
      db.all(
        `SELECT r.id, r.price, r.evacuatorUserId, u.fullName as evacuatorName
         FROM evacuator_responses r
         JOIN evacuator_requests req ON req.id = r.requestId AND req.status = 'completed'
         LEFT JOIN users u ON u.id = r.evacuatorUserId
         WHERE r.status = 'accepted' AND req.completedAt >= ? AND req.completedAt <= ?`,
        [fromTs, toTs],
        (e2, orders) => {
          if (e2) return res.status(500).json({ error: e2.message });
          const orderSum = (orders || []).reduce((s, o) => s + (Number(o.price) || 0), 0);
          const byEvacuator = {};
          (orders || []).forEach((o) => {
            const uid = o.evacuatorUserId;
            if (!byEvacuator[uid]) {
              byEvacuator[uid] = { evacuatorUserId: uid, evacuatorName: o.evacuatorName, ordersCount: 0, totalEarnings: 0 };
            }
            byEvacuator[uid].ordersCount += 1;
            byEvacuator[uid].totalEarnings += Number(o.price) || 0;
          });
          const byList = Object.values(byEvacuator);
          const driverFees = Number(agg?.totalRequestFees) || 0;
          const evacFees = Number(agg?.totalEvacuatorFees) || 0;
          res.json({
            period: { from: fromDate, to: toDate },
            totalRequests: agg?.totalRequests ?? 0,
            confirmedOrders: agg?.confirmedOrders ?? 0,
            completedOrders: agg?.completedOrders ?? 0,
            totalRequestFees: driverFees,
            totalEvacuatorFees: evacFees,
            totalOrderSum: orderSum,
            platformTotal: driverFees + evacFees,
            byEvacuator: byList
          });
        }
      );
    }
  );
});

module.exports = router;
