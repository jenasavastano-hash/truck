const express = require('express');
const router = express.Router();
const db = require('../database');
const path = require('path');
const fs = require('fs');
const { authenticateToken, authorizeRole, hashPassword, generateToken } = require('../auth');
const { getMoscowDate, getMoscowDateFilter, getMoscowPeriodFilter, getLastFriday } = require('../utils/moscow-time');
const takskSync = require('../services/takskom-sync');
const TakskornAPI = require('../takskom-api');
const { deductBalance, addBalance } = require('../utils/balance');
const { CANCELABLE_BEFORE_TAXCOM, CLOSE_SHIFT_FAIL_STATUSES, sqlQuoteList } = require('../utils/epl-status');
const { parseDbUtc } = require('../utils/shifts');
const { normalizeCommercialShippingType } = require('../utils/commercialShippingTypes');
const { generateFastEplPdf } = require('../services/fast-epl-pdf');

function getDirectorPark(req, cb) {
  const requestedParkId = req.query.parkId ? parseInt(req.query.parkId, 10) : null;
  const jwtParkId =
    req.user && req.user.parkId != null && req.user.parkId !== ''
      ? parseInt(req.user.parkId, 10)
      : null;
  const effectiveParkId =
    requestedParkId && !Number.isNaN(requestedParkId)
      ? requestedParkId
      : jwtParkId && !Number.isNaN(jwtParkId)
        ? jwtParkId
        : null;
  const selectFields = `
    d.parkId,
    d.id as directorId,
    COALESCE(d.canTopupBalance,1) as canTopupBalance,
    COALESCE(d.canFine,1) as canFine,
    COALESCE(d.canDismiss,1) as canDismiss,
    COALESCE(d.canDeleteDriver,1) as canDeleteDriver,
    COALESCE(d.canShowBalanceBreakdown,1) as canShowBalanceBreakdown,
    COALESCE(d.canChangeDriverPassword,1) as canChangeDriverPassword,
    COALESCE(d.canAccessBroadcasts,1) as canAccessBroadcasts,
    COALESCE(d.canAccessPhotoControl,1) as canAccessPhotoControl,
    COALESCE(d.canAccessStatistics,1) as canAccessStatistics,
    COALESCE(d.statsShowFinance,1) as statsShowFinance,
    COALESCE(d.statsShowEpl,1) as statsShowEpl,
    COALESCE(d.statsShowDrivers,1) as statsShowDrivers,
    COALESCE(d.driverStatsShowBalance,1) as driverStatsShowBalance,
    COALESCE(d.driverStatsShowEpl,1) as driverStatsShowEpl,
    COALESCE(d.driverStatsShowShifts,1) as driverStatsShowShifts,
    COALESCE(d.canViewEplLogs,1) as canViewEplLogs,
    COALESCE(d.canControlEplQueue,1) as canControlEplQueue,
    COALESCE(d.canCloseEplShifts,1) as canCloseEplShifts,
    COALESCE(d.canChargeOnShiftClose,1) as canChargeOnShiftClose,
    COALESCE(d.canDownloadEplDocs,1) as canDownloadEplDocs,
    COALESCE(d.canManageParkSettings,0) as canManageParkSettings,
    (CASE WHEN COALESCE(d.canManageParkSettings,0) = 1 OR COALESCE(d.canParkSettingsStatusName,0) = 1 THEN 1 ELSE 0 END) as canParkSettingsStatusName,
    (CASE WHEN COALESCE(d.canManageParkSettings,0) = 1 OR COALESCE(d.canParkSettingsTakskom,0) = 1 THEN 1 ELSE 0 END) as canParkSettingsTakskom,
    (CASE WHEN COALESCE(d.canManageParkSettings,0) = 1 OR COALESCE(d.canParkSettingsStaff,0) = 1 THEN 1 ELSE 0 END) as canParkSettingsStaff,
    (CASE WHEN COALESCE(d.canManageParkSettings,0) = 1 OR COALESCE(d.canParkSettingsFreight,0) = 1 THEN 1 ELSE 0 END) as canParkSettingsFreight,
    (CASE WHEN COALESCE(d.canManageParkSettings,0) = 1 OR COALESCE(d.canParkSettingsBroadcasts,0) = 1 THEN 1 ELSE 0 END) as canParkSettingsBroadcasts,
    (CASE WHEN COALESCE(d.canManageParkSettings,0) = 1 OR COALESCE(d.canParkSettingsOwners,0) = 1 THEN 1 ELSE 0 END) as canParkSettingsOwners,
    (CASE WHEN COALESCE(d.canManageParkSettings,0) = 1 OR COALESCE(d.canParkSettingsBalance,0) = 1 THEN 1 ELSE 0 END) as canParkSettingsBalance,
    (CASE WHEN COALESCE(d.canManageParkSettings,0) = 1 OR COALESCE(d.canParkSettingsPricing,0) = 1 THEN 1 ELSE 0 END) as canParkSettingsPricing,
    (CASE WHEN COALESCE(d.canManageParkSettings,0) = 1 OR COALESCE(d.canParkSettingsGame,0) = 1 THEN 1 ELSE 0 END) as canParkSettingsGame,
    (CASE WHEN COALESCE(d.canManageParkSettings,0) = 1 OR COALESCE(d.canParkSettingsPhotoControl,0) = 1 THEN 1 ELSE 0 END) as canParkSettingsPhotoControl,
    (CASE WHEN COALESCE(d.canManageParkSettings,0) = 1 OR COALESCE(d.canParkSettingsServices,0) = 1 THEN 1 ELSE 0 END) as canParkSettingsServices,
    COALESCE(d.canAccessFinance,0) as canAccessFinance,
    COALESCE(d.financeShowKassa,1) as financeShowKassa,
    COALESCE(d.financeShowSalary,1) as financeShowSalary,
    COALESCE(d.financeShowParks,1) as financeShowParks,
    COALESCE(d.financeShowMonthly,1) as financeShowMonthly,
    COALESCE(d.financeScopeAll,0) as financeScopeAll
  `;

  if (effectiveParkId) {
    db.get(
      `SELECT ${selectFields}
       FROM directors d
       JOIN users u ON d.userId = u.id
       WHERE u.id = ? AND d.parkId = ?`,
      [req.user.userId, effectiveParkId],
      (err, row) => {
        if (err) return cb(err, null);
        if (!row) return cb(new Error('Access denied to this park'), null);
        cb(null, row);
      }
    );
  } else {
    db.get(
      `SELECT ${selectFields}
       FROM directors d
       JOIN users u ON d.userId = u.id
       WHERE u.id = ?
       ORDER BY d.parkId ASC
       LIMIT 1`,
      [req.user.userId],
      (err, row) => cb(err, row)
    );
  }
}

function validateParkActivationData(parkId, cb) {
  db.all(
    `SELECT role, taxcomLogin, taxcomPassword
     FROM park_staff
     WHERE parkId = ? AND COALESCE(isActive,1) = 1`,
    [parkId],
    (sErr, staffRows) => {
      if (sErr) return cb(`Ошибка проверки персонала: ${sErr.message}`);
      const byRole = { medic: [], technic: [], dispatcher: [] };
      (staffRows || []).forEach((s) => {
        if (byRole[s.role]) byRole[s.role].push(s);
      });
      for (const role of ['dispatcher', 'medic', 'technic']) {
        if (!byRole[role].length) return cb(`Нельзя активировать парк: нет активного сотрудника роли "${role}"`);
        const hasTaxcomCreds = byRole[role].some((s) =>
          String(s.taxcomLogin || '').trim() && String(s.taxcomPassword || '').trim()
        );
        if (!hasTaxcomCreds) return cb(`Нельзя активировать парк: у роли "${role}" не заполнены логин/пароль Такском`);
      }
      cb(null);
    }
  );
}

function ensureDriverInPark(parkId, driverUserId, cb) {
  db.get(
    'SELECT id FROM drivers WHERE userId = ? AND parkId = ?',
    [driverUserId, parkId],
    (err, row) => {
      if (err) return cb(err);
      if (!row) return cb(new Error('Водитель не найден или не из вашего парка'));
      cb(null);
    }
  );
}

function ensureCanAccessBroadcasts(d, res) {
  if (!d || !d.canAccessBroadcasts) {
    res.status(403).json({ error: 'Нет доступа к рассылкам' });
    return false;
  }
  return true;
}

function ensureCanManageParkSettings(d, res) {
  const hasAnyParkSettingsAccess = !!(
    d?.canManageParkSettings ||
    d?.canParkSettingsStatusName ||
    d?.canParkSettingsTakskom ||
    d?.canParkSettingsStaff ||
    d?.canParkSettingsFreight ||
    d?.canParkSettingsBroadcasts ||
    d?.canParkSettingsOwners ||
    d?.canParkSettingsBalance ||
    d?.canParkSettingsPricing ||
    d?.canParkSettingsGame ||
    d?.canParkSettingsPhotoControl ||
    d?.canParkSettingsServices
  );
  if (!d || !hasAnyParkSettingsAccess) {
    res.status(403).json({ error: 'Нет доступа к настройкам парка' });
    return false;
  }
  return true;
}

function ensureParkSettingsSectionAccess(d, res, key, errorMessage) {
  if (!d || !d[key]) {
    res.status(403).json({ error: errorMessage || 'Нет доступа к этому разделу настроек парка' });
    return false;
  }
  return true;
}

function withDirectorParkAccess(req, parkIdRaw, res, cb) {
  const parkId = parseInt(parkIdRaw, 10);
  if (!parkId || Number.isNaN(parkId)) {
    res.status(400).json({ error: 'Некорректный parkId' });
    return;
  }
  const prevParkId = req.query?.parkId;
  req.query = { ...(req.query || {}), parkId };
  getDirectorPark(req, (err, director) => {
    if (prevParkId === undefined) {
      delete req.query.parkId;
    } else {
      req.query.parkId = prevParkId;
    }
    if (err || !director) return res.status(403).json({ error: 'Access denied' });
    cb(director, parkId);
  });
}

// ===== INBOX РАССЫЛОК (ответы водителей) — директор =====

router.get('/broadcast-threads', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Access denied' });
    if (!ensureCanAccessBroadcasts(director, res)) return;

    const q = (req.query?.q != null ? String(req.query.q) : '').trim().toLowerCase();
    const onlyUnread = String(req.query?.unread || '') === '1';
    const mineOnly = String(req.query?.mine || '') === '1';

    const where = ['t.parkId = ?'];
    const params = [director.parkId];
    if (onlyUnread) where.push('t.unreadForPark = 1');
    if (mineOnly) {
      where.push('t.assignedToUserId = ?');
      params.push(req.user.userId);
    }
    if (q) {
      where.push(`(LOWER(COALESCE(u.fullName,'')) LIKE ? OR LOWER(COALESCE(u.phone,'')) LIKE ? OR LOWER(COALESCE(t.title,'')) LIKE ?)`);
      const like = `%${q}%`;
      params.push(like, like, like);
    }

    const sql = `
      SELECT
        t.id, t.parkId, t.driverUserId,
        u.fullName as driverName, u.phone as driverPhone,
        t.title, t.lastMessageAt, t.lastMessageFrom,
        t.unreadForPark, t.unreadForDriver,
        t.assignedToUserId, t.createdByUserId,
        t.createdAt, t.updatedAt
      FROM broadcast_threads t
      LEFT JOIN users u ON u.id = t.driverUserId
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(t.lastMessageAt, t.createdAt) DESC
      LIMIT 200
    `;
    db.all(sql, params, (e2, rows) => {
      if (e2) return res.status(500).json({ error: e2.message });
      res.json(rows || []);
    });
  });
});

router.get('/broadcast-threads/:id/messages', authenticateToken, authorizeRole('director'), (req, res) => {
  const threadId = parseInt(req.params.id, 10);
  if (!threadId || Number.isNaN(threadId)) return res.status(400).json({ error: 'Некорректный id' });

  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Access denied' });
    if (!ensureCanAccessBroadcasts(director, res)) return;

    db.get(`SELECT id, parkId FROM broadcast_threads WHERE id = ?`, [threadId], (tErr, tRow) => {
      if (tErr) return res.status(500).json({ error: tErr.message });
      if (!tRow || tRow.parkId !== director.parkId) return res.status(404).json({ error: 'Не найдено' });

      db.run(`UPDATE broadcast_threads SET unreadForPark = 0, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`, [threadId], () => {});
      db.run(`UPDATE broadcast_messages SET readAtPark = COALESCE(readAtPark, CURRENT_TIMESTAMP) WHERE threadId = ? AND fromRole = 'driver'`, [threadId], () => {});

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
});

router.post('/broadcast-threads/:id/message', authenticateToken, authorizeRole('director'), (req, res) => {
  const threadId = parseInt(req.params.id, 10);
  const body = (req.body?.body != null ? String(req.body.body) : '').trim();
  if (!threadId || Number.isNaN(threadId)) return res.status(400).json({ error: 'Некорректный id' });
  if (!body) return res.status(400).json({ error: 'Текст обязателен' });

  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Access denied' });
    if (!ensureCanAccessBroadcasts(director, res)) return;

    db.get(`SELECT id, parkId, driverUserId FROM broadcast_threads WHERE id = ?`, [threadId], (tErr, tRow) => {
      if (tErr) return res.status(500).json({ error: tErr.message });
      if (!tRow || tRow.parkId !== director.parkId) return res.status(404).json({ error: 'Не найдено' });

      db.run(
        `INSERT INTO broadcast_messages (threadId, fromUserId, fromRole, body, readAtPark)
         VALUES (?, ?, 'park', ?, CURRENT_TIMESTAMP)`,
        [threadId, req.user.userId, body],
        function (iErr) {
          if (iErr) return res.status(500).json({ error: iErr.message });

          db.run(
            `UPDATE broadcast_threads
             SET lastMessageAt = CURRENT_TIMESTAMP,
                 lastMessageFrom = 'park',
                 unreadForDriver = 1,
                 updatedAt = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [threadId],
            () => {}
          );

          db.run(
            `INSERT INTO notifications (userId, type, title, body)
             VALUES (?, 'broadcast_thread', 'Сообщение от парка', ?)`,
            [tRow.driverUserId, body.slice(0, 500)],
            () => {}
          );

          res.status(201).json({ id: this.lastID, ok: true });
        }
      );
    });
  });
});
function ensureCanDownloadEplDocs(d, res) {
  if (!d || !d.canDownloadEplDocs) {
    res.status(403).json({ error: 'Нет доступа к документам ЭПЛ' });
    return false;
  }
  return true;
}

// ===== DASHBOARD (как у менеджера) =====
router.get('/dashboard', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Access denied' });
    db.get(
      `SELECT p.id, p.name,
              (SELECT COUNT(*) FROM cars WHERE parkId = p.id) as carsCount,
              (SELECT COUNT(*) FROM drivers WHERE parkId = p.id) as driversCount,
              (SELECT COUNT(*) FROM drivers WHERE parkId = p.id AND carId IS NOT NULL) as assignedDrivers
       FROM parks p WHERE p.id = ?`,
      [director.parkId],
      (err2, data) => {
        if (err2) return res.status(500).json({ error: err2.message });
        const canManageParkSettings = !!(
          director.canManageParkSettings ||
          director.canParkSettingsStatusName ||
          director.canParkSettingsTakskom ||
          director.canParkSettingsStaff ||
          director.canParkSettingsFreight ||
          director.canParkSettingsBroadcasts ||
          director.canParkSettingsOwners ||
          director.canParkSettingsBalance ||
          director.canParkSettingsPricing ||
          director.canParkSettingsGame ||
          director.canParkSettingsPhotoControl ||
          director.canParkSettingsServices
        );
        res.json({
          ...(data || {}),
          managerType: 'park',
          canAccessPhotoControl: !!director.canAccessPhotoControl,
          canAccessStatistics: !!director.canAccessStatistics,
          statsShowFinance: director.statsShowFinance !== 0,
          statsShowEpl: director.statsShowEpl !== 0,
          statsShowDrivers: director.statsShowDrivers !== 0,
          canViewEplLogs: !!director.canViewEplLogs,
          canControlEplQueue: !!director.canControlEplQueue,
          canCloseEplShifts: !!director.canCloseEplShifts,
          canChargeOnShiftClose: !!director.canChargeOnShiftClose,
          canDownloadEplDocs: !!director.canDownloadEplDocs,
          canManageParkSettings,
          canParkSettingsStatusName: !!director.canParkSettingsStatusName,
          canParkSettingsTakskom: !!director.canParkSettingsTakskom,
          canParkSettingsStaff: !!director.canParkSettingsStaff,
          canParkSettingsFreight: !!director.canParkSettingsFreight,
          canParkSettingsBroadcasts: !!director.canParkSettingsBroadcasts,
          canParkSettingsOwners: !!director.canParkSettingsOwners,
          canParkSettingsBalance: !!director.canParkSettingsBalance,
          canParkSettingsPricing: !!director.canParkSettingsPricing,
          canParkSettingsGame: !!director.canParkSettingsGame,
          canParkSettingsPhotoControl: !!director.canParkSettingsPhotoControl,
          canParkSettingsServices: !!director.canParkSettingsServices,
          canChangeDriverPassword: !!director.canChangeDriverPassword,
          canAccessBroadcasts: !!director.canAccessBroadcasts,
          canAccessFinance: !!director.canAccessFinance,
        });
      }
    );
  });
});

// ===== ДОКУМЕНТЫ ЭПЛ (download) — директор =====

router.get('/epl/:id/document-fast', authenticateToken, authorizeRole('director'), (req, res) => {
  const eplId = parseInt(req.params.id, 10);
  if (!eplId || Number.isNaN(eplId)) return res.status(400).json({ error: 'Некорректный id ЭПЛ' });

  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Доступ запрещён' });
    if (!ensureCanDownloadEplDocs(director, res)) return;

    db.get(
      'SELECT waybillNumber, documentPdf, parkId FROM epl WHERE id = ? AND parkId = ?',
      [eplId, director.parkId],
      (eErr, row) => {
        if (eErr) return res.status(500).json({ error: eErr.message });
        if (!row || !row.documentPdf) return res.status(404).json({ error: 'Наш PDF ещё не готов' });
        const pdfBuffer = Buffer.from(row.documentPdf, 'base64');
        const filename = (row.waybillNumber || `waybill-${eplId}`).replace(/[^a-zA-Z0-9._-]/g, '_') + '.pdf';
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(pdfBuffer);
      }
    );
  });
});

router.get('/epl/:id/document-mintrans', authenticateToken, authorizeRole('director'), (req, res) => {
  const eplId = parseInt(req.params.id, 10);
  if (!eplId || Number.isNaN(eplId)) return res.status(400).json({ error: 'Некорректный id ЭПЛ' });

  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Доступ запрещён' });
    if (!ensureCanDownloadEplDocs(director, res)) return;

    db.get(
      'SELECT waybillNumber, mintransId, parkId FROM epl WHERE id = ? AND parkId = ?',
      [eplId, director.parkId],
      async (eErr, row) => {
        if (eErr) return res.status(500).json({ error: eErr.message });
        if (!row) return res.status(404).json({ error: 'Путевой лист не найден' });
        if (!row.mintransId) return res.status(400).json({ error: 'Для этого ЭПЛ ещё нет mintransId (Минтранс PDF недоступен)' });
        try {
          const pdfBuffer = await TakskornAPI.getDocumentPdf(row.mintransId);
          const filename = (row.waybillNumber || `waybill-${eplId}`).replace(/[^a-zA-Z0-9._-]/g, '_') + '-mintrans.pdf';
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          return res.send(pdfBuffer);
        } catch (e) {
          console.error('[Director] getDocumentPdf error:', e.message);
          return res.status(502).json({ error: 'Не удалось получить Минтранс PDF по API Такском' });
        }
      }
    );
  });
});

router.get('/epl/:id/qr-mintrans', authenticateToken, authorizeRole('director'), (req, res) => {
  const eplId = parseInt(req.params.id, 10);
  if (!eplId || Number.isNaN(eplId)) return res.status(400).json({ error: 'Некорректный id ЭПЛ' });

  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Доступ запрещён' });
    if (!ensureCanDownloadEplDocs(director, res)) return;

    db.get(
      'SELECT documentQr, parkId FROM epl WHERE id = ? AND parkId = ?',
      [eplId, director.parkId],
      (eErr, row) => {
        if (eErr) return res.status(500).json({ error: eErr.message });
        if (!row || !row.documentQr) return res.status(404).json({ error: 'QR Минтранса ещё не сгенерирован' });
        res.json({ qr: row.documentQr });
      }
    );
  });
});

// ===== РАССЫЛКИ (мониторинг водителей + уведомления) — директор =====

router.get('/drivers/monitoring', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Access denied' });
    if (!ensureCanAccessBroadcasts(director, res)) return;

    const category = String(req.query?.category || 'inactive_no_epl');
    const days = Math.max(1, Math.min(365, parseInt(req.query?.days || '7', 10) || 7));
    const balanceLt = Math.max(0, Number(req.query?.balanceLt ?? 200) || 200);
    const q = (req.query?.q != null ? String(req.query.q) : '').trim();
    const limit = Math.max(1, Math.min(500, parseInt(req.query?.limit || '100', 10) || 100));
    const offset = Math.max(0, parseInt(req.query?.offset || '0', 10) || 0);

    const where = ['d.parkId = ?'];
    const params = [director.parkId];
    if (q) {
      where.push('(LOWER(COALESCE(u.fullName, \'\')) LIKE ? OR LOWER(COALESCE(u.phone, \'\')) LIKE ?)');
      const like = `%${q.toLowerCase()}%`;
      params.push(like, like);
    }

    const baseSql = `
      WITH epl_agg AS (
        SELECT
          e.driverId as driverId,
          MAX(COALESCE(e.documentPdfReceivedAt, e.approvedAt, e.mintransCreatedAt, e.createdAt)) as lastEplAt,
          SUM(CASE WHEN e.createdAt >= datetime('now', '-7 days') THEN 1 ELSE 0 END) as epl7d,
          SUM(CASE WHEN e.createdAt >= datetime('now', '-30 days') THEN 1 ELSE 0 END) as epl30d
        FROM epl e
        GROUP BY e.driverId
      )
      SELECT
        d.id as driverId,
        d.userId as userId,
        d.parkId as parkId,
        p.name as parkName,
        u.fullName as fullName,
        u.phone as phone,
        (COALESCE(u.balanceReal,0) + COALESCE(u.balanceUnreal,0)) as balance,
        a.lastEplAt as lastEplAt,
        COALESCE(a.epl7d, 0) as epl7d,
        COALESCE(a.epl30d, 0) as epl30d
      FROM drivers d
      JOIN users u ON u.id = d.userId
      LEFT JOIN parks p ON p.id = d.parkId
      LEFT JOIN epl_agg a ON a.driverId = d.id
    `;

    let finalWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    if (category === 'low_balance') {
      const cond = `(COALESCE(u.balanceReal,0) + COALESCE(u.balanceUnreal,0)) < ?`;
      finalWhere = finalWhere ? `${finalWhere} AND ${cond}` : `WHERE ${cond}`;
      params.push(balanceLt);
    } else if (category === 'no_car') {
      const cond = `(d.carId IS NULL OR d.carId = '')`;
      finalWhere = finalWhere ? `${finalWhere} AND ${cond}` : `WHERE ${cond}`;
    } else {
      const cond = `(a.lastEplAt IS NULL OR a.lastEplAt < datetime('now', ?))`;
      finalWhere = finalWhere ? `${finalWhere} AND ${cond}` : `WHERE ${cond}`;
      params.push(`-${days} days`);
    }

    const orderSql = `
      ORDER BY
        CASE WHEN lastEplAt IS NULL THEN 0 ELSE 1 END ASC,
        lastEplAt ASC,
        balance ASC
    `;

    const listSql = `${baseSql} ${finalWhere} ${orderSql} LIMIT ? OFFSET ?`;
    const countSql = `${baseSql} ${finalWhere}`;
    const countWrappedSql = `SELECT COUNT(*) as total FROM (${countSql})`;
    const countParams = [...params];
    const dataParams = [...params, limit, offset];

    db.get(countWrappedSql, countParams, (cErr, cRow) => {
      if (cErr) return res.status(500).json({ error: cErr.message });
      const total = cRow?.total != null ? Number(cRow.total) : 0;
      db.all(listSql, dataParams, (qErr, rows) => {
        if (qErr) return res.status(500).json({ error: qErr.message });
        res.json({ category, parkId: director.parkId, days, balanceLt, q: q || '', total, offset, limit, items: rows || [] });
      });
    });
  });
});

router.get('/drivers/monitoring/ids', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Access denied' });
    if (!ensureCanAccessBroadcasts(director, res)) return;

    const category = String(req.query?.category || 'inactive_no_epl');
    const days = Math.max(1, Math.min(365, parseInt(req.query?.days || '7', 10) || 7));
    const balanceLt = Math.max(0, Number(req.query?.balanceLt ?? 200) || 200);
    const q = (req.query?.q != null ? String(req.query.q) : '').trim();
    const max = 2500;

    const where = ['d.parkId = ?'];
    const params = [director.parkId];
    if (q) {
      where.push('(LOWER(COALESCE(u.fullName, \'\')) LIKE ? OR LOWER(COALESCE(u.phone, \'\')) LIKE ?)');
      const like = `%${q.toLowerCase()}%`;
      params.push(like, like);
    }

    const baseSql = `
      WITH epl_agg AS (
        SELECT
          e.driverId as driverId,
          MAX(COALESCE(e.documentPdfReceivedAt, e.approvedAt, e.mintransCreatedAt, e.createdAt)) as lastEplAt
        FROM epl e
        GROUP BY e.driverId
      )
      SELECT d.userId as userId
      FROM drivers d
      JOIN users u ON u.id = d.userId
      LEFT JOIN epl_agg a ON a.driverId = d.id
    `;

    let finalWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    if (category === 'low_balance') {
      const cond = `(COALESCE(u.balanceReal,0) + COALESCE(u.balanceUnreal,0)) < ?`;
      finalWhere = finalWhere ? `${finalWhere} AND ${cond}` : `WHERE ${cond}`;
      params.push(balanceLt);
    } else if (category === 'no_car') {
      const cond = `(d.carId IS NULL OR d.carId = '')`;
      finalWhere = finalWhere ? `${finalWhere} AND ${cond}` : `WHERE ${cond}`;
    } else {
      const cond = `(a.lastEplAt IS NULL OR a.lastEplAt < datetime('now', ?))`;
      finalWhere = finalWhere ? `${finalWhere} AND ${cond}` : `WHERE ${cond}`;
      params.push(`-${days} days`);
    }

    const sql = `${baseSql} ${finalWhere} ORDER BY userId ASC LIMIT ?`;
    db.all(sql, [...params, max], (e2, rows) => {
      if (e2) return res.status(500).json({ error: e2.message });
      const ids = (rows || []).map((r) => r.userId).filter(Boolean);
      res.json({ ids, max, truncated: ids.length >= max });
    });
  });
});

router.post('/drivers/broadcast', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Access denied' });
    if (!ensureCanAccessBroadcasts(director, res)) return;

    const { userIds, title, body, requireReply } = req.body || {};
    const ids = Array.isArray(userIds) ? userIds.map((x) => parseInt(String(x), 10)).filter((n) => n && !Number.isNaN(n)) : [];
    const t = (title != null ? String(title) : '').trim();
    const b = (body != null ? String(body) : '').trim();
    if (ids.length === 0) return res.status(400).json({ error: 'Выберите водителей' });
    if (!b) return res.status(400).json({ error: 'Текст уведомления обязателен' });

    const placeholders = ids.map(() => '?').join(',');
    db.all(
      `SELECT d.userId as userId FROM drivers d WHERE d.parkId = ? AND d.userId IN (${placeholders})`,
      [director.parkId, ...ids],
      (e2, rows) => {
        if (e2) return res.status(500).json({ error: e2.message });
        const allowed = new Set((rows || []).map((r) => r.userId));
        const finalIds = ids.filter((id) => allowed.has(id));
        if (finalIds.length === 0) return res.status(403).json({ error: 'Нет доступных водителей для рассылки' });

        const needsReply = requireReply === true || requireReply === 1 || requireReply === '1' || requireReply === 'true';
        if (!needsReply) {
          const notifStmt = db.prepare('INSERT INTO notifications (userId, type, title, body) VALUES (?, ?, ?, ?)');
          finalIds.forEach((driverUserId) => {
            notifStmt.run(driverUserId, 'manager_broadcast', t || 'Сообщение от директора', b);
          });
          return notifStmt.finalize((e3) => {
            if (e3) return res.status(500).json({ error: e3.message });
            res.json({ success: true, sent: finalIds.length, skipped: ids.length - finalIds.length, threadsCreated: 0, threadsErrors: false });
          });
        }

        db.get('SELECT broadcastRepliesRouting FROM parks WHERE id = ?', [director.parkId], (pErr, pRow) => {
          const routing = (pRow?.broadcastRepliesRouting === 'sender') ? 'sender' : 'park';
          const assignedToUserId = routing === 'sender' ? req.user.userId : null;

          const notifStmt = db.prepare('INSERT INTO notifications (userId, type, title, body) VALUES (?, ?, ?, ?)');
          const threadStmt = db.prepare(
            `INSERT INTO broadcast_threads (parkId, driverUserId, createdByUserId, assignedToUserId, title, lastMessageAt, lastMessageFrom, unreadForDriver, unreadForPark)
             VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'park', 1, 0)`
          );
          const msgStmt = db.prepare(
            `INSERT INTO broadcast_messages (threadId, fromUserId, fromRole, body, readAtPark)
             VALUES (?, ?, 'park', ?, CURRENT_TIMESTAMP)`
          );

          let createdThreads = 0;
          let hadThreadErrors = false;
          let pending = finalIds.length;
          let responded = false;

          const defaultTitle = t || 'Сообщение от директора';

          const finish = () => {
            if (responded) return;
            responded = true;
            notifStmt.finalize(() => {});
            threadStmt.finalize(() => {});
            msgStmt.finalize(() => {});
            res.json({
              success: true,
              sent: finalIds.length,
              skipped: ids.length - finalIds.length,
              threadsCreated: createdThreads,
              threadsErrors: hadThreadErrors
            });
          };

          finalIds.forEach((driverUserId) => {
            notifStmt.run(driverUserId, 'manager_broadcast', defaultTitle, b);
            threadStmt.run(director.parkId, driverUserId, req.user.userId, assignedToUserId, t || 'Сообщение от парка', function (tErr) {
              if (tErr) { hadThreadErrors = true; }
              else {
                const threadId = this.lastID;
                createdThreads += 1;
                msgStmt.run(threadId, req.user.userId, b);
              }

              pending -= 1;
              if (pending <= 0) finish();
            });
          });

          if (finalIds.length === 0) finish();
        });
      }
    );
  });
});

router.get('/broadcast-templates', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Access denied' });
    if (!ensureCanAccessBroadcasts(director, res)) return;
    db.all('SELECT id, title, body, createdAt, updatedAt FROM admin_broadcast_templates ORDER BY updatedAt DESC, id DESC LIMIT 200', [], (e2, rows) => {
      if (e2) return res.status(500).json({ error: e2.message });
      res.json(rows || []);
    });
  });
});

router.post('/broadcast-templates', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Access denied' });
    if (!ensureCanAccessBroadcasts(director, res)) return;
    const title = (req.body?.title != null ? String(req.body.title) : '').trim();
    const body = (req.body?.body != null ? String(req.body.body) : '').trim();
    if (!title) return res.status(400).json({ error: 'Укажите название' });
    if (!body) return res.status(400).json({ error: 'Укажите текст' });
    db.run(
      'INSERT INTO admin_broadcast_templates (title, body, createdAt, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
      [title, body],
      function (e2) {
        if (e2) return res.status(500).json({ error: e2.message });
        res.status(201).json({ id: this.lastID, title, body });
      }
    );
  });
});

router.put('/broadcast-templates/:id', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Access denied' });
    if (!ensureCanAccessBroadcasts(director, res)) return;
    const id = parseInt(req.params.id, 10);
    if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    const title = (req.body?.title != null ? String(req.body.title) : '').trim();
    const body = (req.body?.body != null ? String(req.body.body) : '').trim();
    if (!title) return res.status(400).json({ error: 'Укажите название' });
    if (!body) return res.status(400).json({ error: 'Укажите текст' });
    db.run(
      'UPDATE admin_broadcast_templates SET title = ?, body = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
      [title, body, id],
      function (e2) {
        if (e2) return res.status(500).json({ error: e2.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Не найдено' });
        res.json({ success: true });
      }
    );
  });
});

router.delete('/broadcast-templates/:id', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Access denied' });
    if (!ensureCanAccessBroadcasts(director, res)) return;
    const id = parseInt(req.params.id, 10);
    if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    db.run('DELETE FROM admin_broadcast_templates WHERE id = ?', [id], function (e2) {
      if (e2) return res.status(500).json({ error: e2.message });
      res.json({ success: this.changes > 0 });
    });
  });
});

// Сменить пароль водителю (директор, если включено право)
router.post('/drivers/:userId/password', authenticateToken, authorizeRole('director'), (req, res) => {
  const { userId } = req.params;
  const { newPassword, mustChangePassword } = req.body || {};
  const targetUserId = parseInt(userId, 10);
  if (!targetUserId || Number.isNaN(targetUserId)) return res.status(400).json({ error: 'Некорректный userId' });
  const pwd = String(newPassword || '');
  if (!pwd || pwd.length < 6) return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });

  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Доступ запрещён' });
    if (!director.canChangeDriverPassword) return res.status(403).json({ error: 'Нет доступа: смена пароля водителя' });
    ensureDriverInPark(director.parkId, targetUserId, (e) => {
      if (e) return res.status(403).json({ error: e.message });
      const hashed = hashPassword(pwd);
      db.run(
        `UPDATE users SET password = ?, mustChangePassword = ?, firstLogin = 0 WHERE id = ?`,
        [hashed, mustChangePassword ? 1 : 0, targetUserId],
        function (uErr) {
          if (uErr) return res.status(500).json({ error: uErr.message });
          if (this.changes === 0) return res.status(404).json({ error: 'Пользователь не найден' });
          res.json({ success: true });
        }
      );
    });
  });
});

// Статистика конкретного водителя (для карточки водителя в директорке)
router.get('/drivers/:userId/statistics', authenticateToken, authorizeRole('director'), (req, res) => {
  const targetUserId = parseInt(req.params.userId, 10);
  if (!targetUserId || Number.isNaN(targetUserId)) return res.status(400).json({ error: 'Некорректный userId' });

  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Access denied' });

    ensureDriverInPark(director.parkId, targetUserId, (e) => {
      if (e) return res.status(403).json({ error: e.message });

      db.get(
        `SELECT d.id as driverId, d.parkId as parkId,
                (COALESCE(u.balanceReal,0) + COALESCE(u.balanceUnreal,0)) as balance
         FROM drivers d
         JOIN users u ON u.id = d.userId
         WHERE d.userId = ? AND d.parkId = ?`,
        [targetUserId, director.parkId],
        (dErr, dRow) => {
          if (dErr) return res.status(500).json({ error: dErr.message });
          if (!dRow) return res.status(404).json({ error: 'Водитель не найден' });

          const driverId = dRow.driverId;

          db.get(
            `SELECT 
               COUNT(*) as totalEpl,
               SUM(CASE WHEN createdAt >= datetime('now', '-7 days') THEN 1 ELSE 0 END) as epl7d,
               SUM(CASE WHEN createdAt >= datetime('now', '-30 days') THEN 1 ELSE 0 END) as epl30d,
               MAX(COALESCE(documentPdfReceivedAt, approvedAt, mintransCreatedAt, createdAt)) as lastEplAt
             FROM epl
             WHERE driverId = ? AND parkId = ?`,
            [driverId, director.parkId],
            (eErr, eplStats) => {
              if (eErr) return res.status(500).json({ error: eErr.message });

              db.get(
                `SELECT COUNT(*) as activeShifts
                 FROM shifts
                 WHERE driverId = ? AND parkId = ? AND status = 'active'`,
                [driverId, director.parkId],
                (sErr, sRow) => {
                  if (sErr) return res.status(500).json({ error: sErr.message });

                  const out = {
                    driverId,
                    userId: targetUserId,
                    parkId: director.parkId,
                  };
                  if (director.driverStatsShowBalance) out.balance = Number(dRow.balance || 0);
                  if (director.driverStatsShowEpl) {
                    out.epl = {
                      total: Number(eplStats?.totalEpl || 0),
                      epl7d: Number(eplStats?.epl7d || 0),
                      epl30d: Number(eplStats?.epl30d || 0),
                      lastEplAt: eplStats?.lastEplAt || null,
                    };
                  }
                  if (director.driverStatsShowShifts) out.shifts = { active: Number(sRow?.activeShifts || 0) };
                  res.json(out);
                }
              );
            }
          );
        }
      );
    });
  });
});

// Пополнить баланс водителю (директор)
router.post('/drivers/:userId/balance', authenticateToken, authorizeRole('director'), (req, res) => {
  const { userId } = req.params;
  const { amount, amountType = 'real' } = req.body || {};
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Укажите сумму больше 0' });
  const num = Number(amount);
  if (Number.isNaN(num)) return res.status(400).json({ error: 'Некорректная сумма' });
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Доступ запрещён' });
    if (!director.canTopupBalance) return res.status(403).json({ error: 'Нет доступа: пополнение баланса' });
    ensureDriverInPark(director.parkId, userId, (e) => {
      if (e) return res.status(403).json({ error: e.message });
      addBalance(
        db,
        userId,
        num,
        amountType,
        amountType === 'real' ? 'Пополнение из кассы (директор)' : 'Бонус (директор)',
        (bErr) => {
          if (bErr) return res.status(500).json({ error: bErr.message });
          res.json({ success: true, message: 'Баланс пополнен', amount: num, amountType });
        }
      );
    });
  });
});

// Штраф (директор)
router.post('/drivers/:userId/fine', authenticateToken, authorizeRole('director'), (req, res) => {
  const { userId } = req.params;
  const { amount, description = 'Штраф' } = req.body || {};
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Укажите сумму штрафа больше 0' });
  const num = Number(amount);
  if (Number.isNaN(num)) return res.status(400).json({ error: 'Некорректная сумма' });
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Доступ запрещён' });
    if (!director.canFine) return res.status(403).json({ error: 'Нет доступа: штраф' });
    ensureDriverInPark(director.parkId, userId, (e) => {
      if (e) return res.status(403).json({ error: e.message });
      deductBalance(
        db,
        userId,
        director.parkId,
        num,
        description,
        null,
        'expense',
        (req.body && req.body.operationKey) ? String(req.body.operationKey) : `fine:director:${userId}:${Date.now()}`,
        (dErr) => {
          if (dErr) return res.status(400).json({ error: dErr.message });
          res.json({ success: true, message: 'Штраф списан', amount: num });
        }
      );
    });
  });
});

// Уволить (директор)
router.post('/drivers/:userId/dismiss', authenticateToken, authorizeRole('director'), (req, res) => {
  const { userId } = req.params;
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Доступ запрещён' });
    if (!director.canDismiss) return res.status(403).json({ error: 'Нет доступа: уволить' });
    ensureDriverInPark(director.parkId, userId, (e) => {
      if (e) return res.status(403).json({ error: e.message });
      db.run('UPDATE drivers SET carId = NULL, isVerified = 0 WHERE userId = ?', [userId], function (uErr) {
        if (uErr) return res.status(500).json({ error: uErr.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Водитель не найден' });
        res.json({ success: true, message: 'Водитель уволен' });
      });
    });
  });
});

// Удалить водителя из системы (директор)
router.delete('/drivers/:userId/remove', authenticateToken, authorizeRole('director'), (req, res) => {
  const { userId } = req.params;
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Доступ запрещён' });
    if (!director.canDeleteDriver) return res.status(403).json({ error: 'Нет доступа: удалить из системы' });
    ensureDriverInPark(director.parkId, userId, (e) => {
      if (e) return res.status(403).json({ error: e.message });
      db.get('SELECT id, carId FROM drivers WHERE userId = ?', [userId], (getErr, driver) => {
        if (getErr) return res.status(500).json({ error: getErr.message });
        if (!driver) return res.status(404).json({ error: 'Водитель не найден' });

        const driverId = driver.id;
        db.run('UPDATE drivers SET carId = NULL WHERE id = ?', [driverId], (unbindErr) => {
          if (unbindErr) console.warn('[Delete Driver] Car unbind warning:', unbindErr.message);
        });

        db.run(
          `UPDATE epl SET status = 'failed', errorMessage = 'Водитель удалён из системы' WHERE driverId = ? AND status IN (${sqlQuoteList(CLOSE_SHIFT_FAIL_STATUSES)})`,
          [driverId],
          () => {
            db.run('DELETE FROM shifts WHERE driverId = ?', [userId], () => {
              db.run('DELETE FROM balance_history WHERE userId = ?', [userId], () => {
                db.run('DELETE FROM notifications WHERE userId = ?', [userId], () => {
                  db.run('DELETE FROM payments WHERE userId = ?', [userId], () => {
                    db.run('DELETE FROM drivers WHERE userId = ?', [userId], (e1) => {
                      if (e1) return res.status(500).json({ error: e1.message });
                      db.run('DELETE FROM users WHERE id = ?', [userId], (e2) => {
                        if (e2) return res.status(500).json({ error: e2.message });
                        res.json({ success: true, message: 'Водитель удалён из системы' });
                      });
                    });
                  });
                });
              });
            });
          }
        );
      });
    });
  });
});

// ===== ДОСТУПЫ ДИРЕКТОРА (как у менеджера) =====
router.get('/permissions', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(404).json({ error: 'Director not found' });
    const canManageParkSettings = !!(
      director.canManageParkSettings ||
      director.canParkSettingsStatusName ||
      director.canParkSettingsTakskom ||
      director.canParkSettingsStaff ||
      director.canParkSettingsFreight ||
      director.canParkSettingsBroadcasts ||
      director.canParkSettingsOwners ||
      director.canParkSettingsBalance ||
      director.canParkSettingsPricing ||
      director.canParkSettingsGame ||
      director.canParkSettingsPhotoControl ||
      director.canParkSettingsServices
    );
    res.json({
      canTopupBalance: !!director.canTopupBalance,
      canFine: !!director.canFine,
      canDismiss: !!director.canDismiss,
      canDeleteDriver: !!director.canDeleteDriver,
      canShowBalanceBreakdown: !!director.canShowBalanceBreakdown,
      canChangeDriverPassword: !!director.canChangeDriverPassword,
      canAccessBroadcasts: !!director.canAccessBroadcasts,
      canViewEplLogs: !!director.canViewEplLogs,
      canControlEplQueue: !!director.canControlEplQueue,
      canManageParkSettings,
      canParkSettingsStatusName: !!director.canParkSettingsStatusName,
      canParkSettingsTakskom: !!director.canParkSettingsTakskom,
      canParkSettingsStaff: !!director.canParkSettingsStaff,
      canParkSettingsFreight: !!director.canParkSettingsFreight,
      canParkSettingsBroadcasts: !!director.canParkSettingsBroadcasts,
      canParkSettingsOwners: !!director.canParkSettingsOwners,
      canParkSettingsBalance: !!director.canParkSettingsBalance,
      canParkSettingsPricing: !!director.canParkSettingsPricing,
      canParkSettingsGame: !!director.canParkSettingsGame,
      canParkSettingsPhotoControl: !!director.canParkSettingsPhotoControl,
      canParkSettingsServices: !!director.canParkSettingsServices,
      driverStatsShowBalance: director.driverStatsShowBalance !== 0,
      driverStatsShowEpl: director.driverStatsShowEpl !== 0,
      driverStatsShowShifts: director.driverStatsShowShifts !== 0,
    });
  });
});

function buildWaybillNumber(parkId) {
  const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
  return `WB-${parkId}-${date}-${Date.now().toString().slice(-4)}`;
}

function listShiftOpenRequestsForPark(parkId, query, cb) {
  const search = String(query?.search || '').trim().toLowerCase();
  const statusRaw = String(query?.status || 'pending').trim().toLowerCase();
  const allowedStatuses = new Set(['pending', 'approved', 'rejected', 'all']);
  const status = allowedStatuses.has(statusRaw) ? statusRaw : 'pending';
  const limitRaw = parseInt(query?.limit, 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;
  const where = ['r.parkId = ?'];
  const params = [parkId];
  if (status !== 'all') {
    where.push('r.status = ?');
    params.push(status);
  }
  if (search) {
    where.push(`(
      LOWER(COALESCE(u.fullName,'')) LIKE ?
      OR LOWER(COALESCE(u.phone,'')) LIKE ?
      OR LOWER(COALESCE(c.regNumber,'')) LIKE ?
      OR LOWER(COALESCE(r.message,'')) LIKE ?
    )`);
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }
  params.push(limit);
  db.all(
    `SELECT r.id, r.parkId, r.driverUserId, r.driverId, r.carId, r.message, r.status,
            r.startOdometer, r.startFuel, r.commercialShippingType,
            r.freightOriginAddress, r.freightLoadAddress, r.freightUnloadAddresses,
            r.rejectionReason, r.requestedByUserId, r.processedByUserId, r.processedByRole,
            r.resultEplId, r.createdAt, r.updatedAt,
            u.fullName as driverName, u.phone as driverPhone,
            c.regNumber as carRegNumber,
            e.waybillNumber as resultWaybillNumber, e.status as resultEplStatus
     FROM shift_open_requests r
     LEFT JOIN users u ON u.id = r.driverUserId
     LEFT JOIN cars c ON c.id = r.carId
     LEFT JOIN epl e ON e.id = r.resultEplId
     WHERE ${where.join(' AND ')}
     ORDER BY
       CASE r.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END,
       r.createdAt DESC, r.id DESC
     LIMIT ?`,
    params,
    cb
  );
}

router.get('/shift-open-requests', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(404).json({ error: 'Director not found' });
    if (!director.canAccessBroadcasts) return res.status(403).json({ error: 'Нет доступа к разделу "Смены"' });
    listShiftOpenRequestsForPark(director.parkId, req.query, (qErr, rows) => {
      if (qErr) return res.status(500).json({ error: qErr.message });
      res.json(rows || []);
    });
  });
});

router.post('/shift-open-requests/:id/approve', authenticateToken, authorizeRole('director'), (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  if (!Number.isFinite(requestId) || requestId <= 0) {
    return res.status(400).json({ error: 'Некорректный id заявки' });
  }
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(404).json({ error: 'Director not found' });
    if (!director.canAccessBroadcasts) return res.status(403).json({ error: 'Нет доступа к разделу "Смены"' });

    db.get(
      `SELECT *
       FROM shift_open_requests
       WHERE id = ? AND parkId = ?`,
      [requestId, director.parkId],
      (rErr, requestRow) => {
        if (rErr) return res.status(500).json({ error: rErr.message });
        if (!requestRow) return res.status(404).json({ error: 'Заявка не найдена' });
        if (requestRow.status !== 'pending') return res.status(409).json({ error: 'Заявка уже обработана' });

        db.get(
          `SELECT d.id as driverId, d.userId as driverUserId, d.parkId, d.carId,
                  p.eplPrintMode, p.name as parkName, p.inn as parkInn, p.kpp as parkKpp, p.ogrn as parkOgrn, p.city as parkCity,
                  u.fullName, u.inn, u.licenseSerial, u.licenseNumber,
                  c.regNumber, c.brand, c.model, c.vehicleType,
                  po.name as ownerName, po.inn as ownerInn, po.kpp as ownerKpp, po.ogrn as ownerOgrn, po.ogrnip as ownerOgrnip
           FROM drivers d
           JOIN parks p ON p.id = d.parkId
           LEFT JOIN users u ON u.id = d.userId
           LEFT JOIN cars c ON c.id = d.carId
           LEFT JOIN park_owners po ON po.id = c.ownerId AND po.parkId = d.parkId
           WHERE d.userId = ? AND d.parkId = ?`,
          [requestRow.driverUserId, director.parkId],
          (dErr, driverRow) => {
            if (dErr) return res.status(500).json({ error: dErr.message });
            if (!driverRow) return res.status(404).json({ error: 'Водитель не найден в парке' });
            if (!driverRow.carId) return res.status(400).json({ error: 'У водителя не привязано авто' });

            const fallbackStartOdometer = Number(requestRow.startOdometer);
            const startOdometer = Number.isFinite(fallbackStartOdometer) ? fallbackStartOdometer : 0;
            const waybillNumber = buildWaybillNumber(driverRow.parkId);
            const freightOriginAddress = req.body?.freightOriginAddress != null
              ? String(req.body.freightOriginAddress).trim() || null
              : requestRow.freightOriginAddress || null;
            const freightLoadAddress = req.body?.freightLoadAddress != null
              ? String(req.body.freightLoadAddress).trim() || null
              : requestRow.freightLoadAddress || null;
            const freightUnloadAddresses = req.body?.freightUnloadAddresses != null
              ? JSON.stringify(
                  (Array.isArray(req.body.freightUnloadAddresses) ? req.body.freightUnloadAddresses : [])
                    .map((x) => String(x).trim())
                    .filter(Boolean)
                ) || null
              : requestRow.freightUnloadAddresses || null;
            const commercialShippingType = req.body?.commercialShippingType != null
              ? String(req.body.commercialShippingType).trim() || null
              : requestRow.commercialShippingType || null;

            db.run(
              `INSERT INTO epl
                 (parkId, driverId, carId, waybillNumber, status, startOdometer, errorMessage, commercialShippingType, freightOriginAddress, freightLoadAddress, freightUnloadAddresses)
               VALUES (?, ?, ?, ?, 'pending_clinic', ?, NULL, ?, ?, ?, ?)`,
              [
                driverRow.parkId,
                driverRow.driverId,
                driverRow.carId,
                waybillNumber,
                startOdometer,
                commercialShippingType,
                freightOriginAddress,
                freightLoadAddress,
                freightUnloadAddresses,
              ],
              function (createErr) {
                if (createErr) return res.status(500).json({ error: createErr.message });
                const eplId = this.lastID;
                const printMode = driverRow?.eplPrintMode || 'our_then_taxcom';
                if (printMode !== 'taxcom_only') {
                  generateFastEplPdf({
                    eplId,
                    driver: driverRow,
                    startOdometer,
                    createdAt: new Date(),
                    commercialShippingType,
                  });
                }
                db.run(
                  `UPDATE shift_open_requests
                   SET status = 'approved',
                       processedByUserId = ?,
                       processedByRole = 'director',
                       resultEplId = ?,
                       updatedAt = CURRENT_TIMESTAMP
                   WHERE id = ?`,
                  [req.user.userId, eplId, requestId],
                  (upReqErr) => {
                    if (upReqErr) return res.status(500).json({ error: upReqErr.message });
                    db.run(
                      `INSERT INTO notifications (userId, type, title, body, eplId)
                       VALUES (?, 'shift_opened', 'Смена открыта', ?, ?)`,
                      [
                        driverRow.driverUserId,
                        `Директор открыл смену. Путевой лист #${waybillNumber} поставлен в очередь.`,
                        eplId,
                      ],
                      () => {}
                    );
                    res.json({
                      ok: true,
                      requestId,
                      eplId,
                      waybillNumber,
                      status: 'approved',
                    });
                  }
                );
              }
            );
          }
        );
      }
    );
  });
});

router.post('/shift-open-requests/:id/reject', authenticateToken, authorizeRole('director'), (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  if (!Number.isFinite(requestId) || requestId <= 0) {
    return res.status(400).json({ error: 'Некорректный id заявки' });
  }
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(404).json({ error: 'Director not found' });
    if (!director.canAccessBroadcasts) return res.status(403).json({ error: 'Нет доступа к разделу "Смены"' });

    const reason = String(req.body?.reason || '').trim().slice(0, 500);
    db.get(
      `SELECT id, driverUserId, status
       FROM shift_open_requests
       WHERE id = ? AND parkId = ?`,
      [requestId, director.parkId],
      (rErr, requestRow) => {
        if (rErr) return res.status(500).json({ error: rErr.message });
        if (!requestRow) return res.status(404).json({ error: 'Заявка не найдена' });
        if (requestRow.status !== 'pending') return res.status(409).json({ error: 'Заявка уже обработана' });

        db.run(
          `UPDATE shift_open_requests
           SET status = 'rejected',
               rejectionReason = ?,
               processedByUserId = ?,
               processedByRole = 'director',
               updatedAt = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [reason || null, req.user.userId, requestId],
          (uErr) => {
            if (uErr) return res.status(500).json({ error: uErr.message });
            db.run(
              `INSERT INTO notifications (userId, type, title, body)
               VALUES (?, 'shift_open_request_rejected', 'Заявка отклонена', ?)`,
              [
                requestRow.driverUserId,
                reason
                  ? `Директор отклонил заявку: ${reason}`
                  : 'Директор отклонил заявку на открытие смены.',
              ],
              () => {}
            );
            res.json({ ok: true, requestId, status: 'rejected' });
          }
        );
      }
    );
  });
});

function listShiftPlansForPark(parkId, query, cb) {
  const date = String(query?.date || getMoscowDate()).trim();
  const search = String(query?.search || '').trim().toLowerCase();
  const statusRaw = String(query?.status || 'planned').trim().toLowerCase();
  const allowedStatuses = new Set(['planned', 'consumed', 'cancelled', 'all']);
  const status = allowedStatuses.has(statusRaw) ? statusRaw : 'planned';
  const where = ['sp.parkId = ?', 'sp.shiftDate = ?'];
  const params = [parkId, date];
  if (status !== 'all') {
    where.push('sp.status = ?');
    params.push(status);
  }
  if (search) {
    where.push(`(
      LOWER(COALESCE(u.fullName,'')) LIKE ?
      OR LOWER(COALESCE(u.phone,'')) LIKE ?
      OR LOWER(COALESCE(c.regNumber,'')) LIKE ?
      OR LOWER(COALESCE(sp.note,'')) LIKE ?
    )`);
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }
  db.all(
    `SELECT sp.*,
            u.fullName as driverName, u.phone as driverPhone,
            c.regNumber as carRegNumber,
            e.waybillNumber as consumedWaybillNumber
     FROM shift_plans sp
     LEFT JOIN users u ON u.id = sp.driverUserId
     LEFT JOIN cars c ON c.id = sp.carId
     LEFT JOIN epl e ON e.id = sp.consumedByEplId
     WHERE ${where.join(' AND ')}
     ORDER BY
       CASE sp.status WHEN 'planned' THEN 0 WHEN 'consumed' THEN 1 WHEN 'cancelled' THEN 2 ELSE 3 END,
       COALESCE(u.fullName, u.phone, '') ASC,
       sp.createdAt DESC`,
    params,
    cb
  );
}

router.get('/shift-plans', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(404).json({ error: 'Director not found' });
    if (!director.canAccessBroadcasts) return res.status(403).json({ error: 'Нет доступа к разделу "Смены"' });
    listShiftPlansForPark(director.parkId, req.query, (qErr, rows) => {
      if (qErr) return res.status(500).json({ error: qErr.message });
      res.json(rows || []);
    });
  });
});

router.post('/shift-plans', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(404).json({ error: 'Director not found' });
    if (!director.canAccessBroadcasts) return res.status(403).json({ error: 'Нет доступа к разделу "Смены"' });
    const driverUserId = parseInt(req.body?.driverUserId, 10);
    const shiftDate = String(req.body?.shiftDate || getMoscowDate()).trim();
    const startOdometerRaw = Number(req.body?.startOdometer);
    const startOdometer = Number.isFinite(startOdometerRaw) && startOdometerRaw >= 0 ? startOdometerRaw : 0;
    const note = String(req.body?.note || '').trim().slice(0, 500);
    const commercialShippingType = normalizeCommercialShippingType(req.body?.commercialShippingType);
    const freightOriginAddress = req.body?.freightOriginAddress != null ? String(req.body.freightOriginAddress).trim() || null : null;
    const freightLoadAddress = req.body?.freightLoadAddress != null ? String(req.body.freightLoadAddress).trim() || null : null;
    const freightUnloadAddressesRaw = req.body?.freightUnloadAddresses;
    let freightUnloadAddressesArr = [];
    if (Array.isArray(freightUnloadAddressesRaw)) {
      freightUnloadAddressesArr = freightUnloadAddressesRaw.map((x) => String(x).trim()).filter(Boolean);
    } else if (typeof freightUnloadAddressesRaw === 'string' && freightUnloadAddressesRaw.trim()) {
      const t = freightUnloadAddressesRaw.trim();
      try {
        const parsed = JSON.parse(t);
        if (Array.isArray(parsed)) freightUnloadAddressesArr = parsed.map((x) => String(x).trim()).filter(Boolean);
        else freightUnloadAddressesArr = t.split(/\r?\n|;/).map((x) => x.trim()).filter(Boolean);
      } catch {
        freightUnloadAddressesArr = t.split(/\r?\n|;/).map((x) => x.trim()).filter(Boolean);
      }
    }
    const freightUnloadAddresses = freightUnloadAddressesArr.length > 0 ? JSON.stringify(freightUnloadAddressesArr) : null;
    if (!driverUserId || Number.isNaN(driverUserId)) {
      return res.status(400).json({ error: 'Некорректный driverUserId' });
    }

    db.get(
      `SELECT d.id as driverId, d.userId as driverUserId, d.carId
       FROM drivers d
       WHERE d.userId = ? AND d.parkId = ?`,
      [driverUserId, director.parkId],
      (dErr, driverRow) => {
        if (dErr) return res.status(500).json({ error: dErr.message });
        if (!driverRow) return res.status(404).json({ error: 'Водитель не найден в парке' });
        if (!driverRow.carId) return res.status(400).json({ error: 'У водителя не привязано авто' });

        db.run(
          `INSERT INTO shift_plans
             (parkId, shiftDate, driverUserId, driverId, carId, status, startOdometer, commercialShippingType, freightOriginAddress, freightLoadAddress, freightUnloadAddresses, note, createdByUserId, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT(parkId, shiftDate, driverUserId) DO UPDATE SET
             status = 'planned',
             startOdometer = excluded.startOdometer,
             commercialShippingType = excluded.commercialShippingType,
             freightOriginAddress = excluded.freightOriginAddress,
             freightLoadAddress = excluded.freightLoadAddress,
             freightUnloadAddresses = excluded.freightUnloadAddresses,
             note = excluded.note,
             driverId = excluded.driverId,
             carId = excluded.carId,
             createdByUserId = excluded.createdByUserId,
             cancelledAt = NULL,
             consumedAt = NULL,
             consumedByRequestId = NULL,
             consumedByEplId = NULL,
             updatedAt = CURRENT_TIMESTAMP`,
          [
            director.parkId,
            shiftDate,
            driverUserId,
            driverRow.driverId,
            driverRow.carId,
            startOdometer,
            commercialShippingType || null,
            freightOriginAddress,
            freightLoadAddress,
            freightUnloadAddresses,
            note || null,
            req.user.userId,
          ],
          function (uErr) {
            if (uErr) return res.status(500).json({ error: uErr.message });
            res.json({ ok: true, id: this.lastID || null, status: 'planned' });
          }
        );
      }
    );
  });
});

router.post('/shift-plans/:id/cancel', authenticateToken, authorizeRole('director'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'Некорректный id' });
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(404).json({ error: 'Director not found' });
    if (!director.canAccessBroadcasts) return res.status(403).json({ error: 'Нет доступа к разделу "Смены"' });
    db.run(
      `UPDATE shift_plans
       SET status = 'cancelled', cancelledAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
       WHERE id = ? AND parkId = ? AND status = 'planned'`,
      [id, director.parkId],
      function (uErr) {
        if (uErr) return res.status(500).json({ error: uErr.message });
        if (!this.changes) return res.status(404).json({ error: 'План не найден или уже обработан' });
        res.json({ ok: true, id, status: 'cancelled' });
      }
    );
  });
});

// ===== НАСТРОЙКИ ПАРКА ДЛЯ ДИРЕКТОРА (доступ регулируется админом) =====
router.get('/park/settings', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Access denied' });
    if (!ensureCanManageParkSettings(director, res)) return;

    db.get(
      `SELECT eplCreationMode, name, isActive, takskornId, syncedWithTakskom,
              eplAccessMode,
              eplPrintMode, balanceDeductionOrder, ogrn, inn, kpp, regionCode,
              phone, freightAddressEntryMode, freightDefaultOriginAddress, freightDefaultLoadAddress,
              broadcastRepliesRouting
       FROM parks WHERE id = ?`,
      [director.parkId],
      (pErr, parkRow) => {
        if (pErr) return res.status(500).json({ error: pErr.message });
        db.get(
          `SELECT eplCreationFee, autoCloseFee
           FROM waybill_rates
           WHERE parkId = ?
           ORDER BY id DESC
           LIMIT 1`,
          [director.parkId],
          (rErr, rateRow) => {
            if (rErr) return res.status(500).json({ error: rErr.message });
            db.get(
              `SELECT enabled, price, validDays, notifyHoursBefore
               FROM park_photo_control_settings
               WHERE parkId = ?`,
              [director.parkId],
              (pcErr, photoRow) => {
                if (pcErr) return res.status(500).json({ error: pcErr.message });
                db.get(
                  `SELECT gameEnabled, leaderboardDefault, rewardsEnabled, gameShopConfig
                   FROM park_game_settings
                   WHERE parkId = ?`,
                  [director.parkId],
                  (gErr, gameRow) => {
                    if (gErr) return res.status(500).json({ error: gErr.message });
                    db.all(
                      `SELECT position, rewardType, freeEplCount, discountPercent, discountEplCount
                       FROM park_game_rewards
                       WHERE parkId = ?
                       ORDER BY position`,
                      [director.parkId],
                      (grErr, gameRewards) => {
                        if (grErr) return res.status(500).json({ error: grErr.message });
                        return res.json({
                          ...(parkRow || {}),
                          eplCreationMode: parkRow?.eplCreationMode || 'takskom_api',
                          eplAccessMode: parkRow?.eplAccessMode === 'driver_only'
                            ? 'driver_only'
                            : parkRow?.eplAccessMode === 'manager_director_only'
                              ? 'manager_director_only'
                              : 'all',
                          isActive: parkRow?.isActive ? 1 : 0,
                          takskornId: parkRow?.takskornId != null ? String(parkRow.takskornId) : null,
                          syncedWithTakskom: parkRow?.syncedWithTakskom ? 1 : 0,
                          eplPrice: rateRow?.eplCreationFee != null ? Number(rateRow.eplCreationFee) : 25,
                          autoClosePrice: rateRow?.autoCloseFee != null ? Number(rateRow.autoCloseFee) : 10,
                          photoControlEnabled: !!photoRow?.enabled,
                          photoControlPrice: photoRow?.price != null ? Number(photoRow.price) : 150,
                          photoControlValidDays: photoRow?.validDays != null ? Number(photoRow.validDays) : 10,
                          photoControlNotifyHoursBefore:
                            photoRow?.notifyHoursBefore != null ? Number(photoRow.notifyHoursBefore) : 24,
                          gameEnabled: gameRow?.gameEnabled ? 1 : 0,
                          leaderboardDefault: gameRow?.leaderboardDefault || 'day',
                          rewardsEnabled: gameRow?.rewardsEnabled ? 1 : 0,
                          gameShopConfig: gameRow?.gameShopConfig || null,
                          gameRewards: (gameRewards || []).map((r) => ({
                            position: r.position,
                            rewardType: r.rewardType,
                            freeEplCount: r.freeEplCount ?? 0,
                            discountPercent: r.discountPercent ?? 0,
                            discountEplCount: r.discountEplCount ?? 0,
                          })),
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
});

router.put('/park/settings', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Access denied' });
    if (!ensureCanManageParkSettings(director, res)) return;

    const {
      name, isActive, takskornId,
      ogrn, inn, kpp, regionCode, phone,
      eplPrintMode, eplAccessMode, balanceDeductionOrder,
      freightAddressEntryMode, freightDefaultOriginAddress, freightDefaultLoadAddress,
      broadcastRepliesRouting,
      eplPrice, autoClosePrice,
      photoControlEnabled, photoControlPrice, photoControlValidDays, photoControlNotifyHoursBefore,
      gameEnabled, leaderboardDefault, rewardsEnabled, gameShopConfig, gameRewards,
    } = req.body || {};

    const hasAny = (arr) => arr.some((v) => v !== undefined);
    const assertAccess = (ok, message) => {
      if (ok) return true;
      res.status(403).json({ error: message });
      return false;
    };
    if (
      hasAny([name, isActive]) &&
      !assertAccess(!!director.canParkSettingsStatusName, 'Нет доступа к статусу и названию парка')
    ) return;
    if (
      hasAny([takskornId]) &&
      !assertAccess(!!director.canParkSettingsTakskom, 'Нет доступа к привязке Такском')
    ) return;
    if (
      hasAny([eplPrintMode, eplAccessMode]) &&
      !assertAccess(!!director.canParkSettingsTakskom, 'Нет доступа к режимам ЭПЛ')
    ) return;
    if (
      hasAny([freightAddressEntryMode, freightDefaultOriginAddress, freightDefaultLoadAddress]) &&
      !assertAccess(!!director.canParkSettingsFreight, 'Нет доступа к блоку грузовых адресов')
    ) return;
    if (
      hasAny([broadcastRepliesRouting]) &&
      !assertAccess(!!director.canParkSettingsBroadcasts, 'Нет доступа к блоку рассылок')
    ) return;
    if (
      hasAny([balanceDeductionOrder]) &&
      !assertAccess(!!director.canParkSettingsBalance, 'Нет доступа к блоку списания баланса')
    ) return;
    if (
      hasAny([ogrn, inn, kpp, regionCode, phone, eplPrice, autoClosePrice]) &&
      !assertAccess(!!director.canParkSettingsPricing, 'Нет доступа к реквизитам и тарифам')
    ) return;
    if (
      hasAny([photoControlEnabled, photoControlPrice, photoControlValidDays, photoControlNotifyHoursBefore]) &&
      !assertAccess(!!director.canParkSettingsPhotoControl, 'Нет доступа к блоку фотоконтроля')
    ) return;
    if (
      hasAny([gameEnabled, leaderboardDefault, rewardsEnabled, gameShopConfig]) || Array.isArray(gameRewards)
    ) {
      if (!assertAccess(!!director.canParkSettingsGame, 'Нет доступа к блоку игры')) return;
    }

    const updates = [];
    const vals = [];
    const setText = (name, value) => {
      if (value === undefined) return;
      updates.push(`${name} = ?`);
      vals.push(value === null ? null : String(value));
    };

    setText('ogrn', ogrn);
    setText('inn', inn);
    setText('kpp', kpp);
    setText('regionCode', regionCode);
    setText('phone', phone);
    if (name !== undefined) {
      updates.push('name = ?');
      vals.push(name ? String(name).trim() : null);
    }
    if (isActive !== undefined) {
      updates.push('isActive = ?');
      vals.push(isActive ? 1 : 0);
    }
    if (takskornId !== undefined) {
      updates.push('takskornId = ?');
      vals.push(takskornId === null || takskornId === '' ? null : String(takskornId));
      updates.push('syncedWithTakskom = ?');
      vals.push(takskornId && String(takskornId).trim() !== '' ? 1 : 0);
    }
    if (eplPrintMode !== undefined) {
      const v = eplPrintMode === 'taxcom_only' ? 'taxcom_only' : eplPrintMode === 'our_only' ? 'our_only' : 'our_then_taxcom';
      updates.push('eplPrintMode = ?');
      vals.push(v);
    }
    if (eplAccessMode !== undefined) {
      const v = eplAccessMode === 'driver_only'
        ? 'driver_only'
        : eplAccessMode === 'manager_director_only'
          ? 'manager_director_only'
          : 'all';
      updates.push('eplAccessMode = ?');
      vals.push(v);
    }
    if (balanceDeductionOrder !== undefined) {
      const v = balanceDeductionOrder === 'unreal_first' ? 'unreal_first' : 'real_first';
      updates.push('balanceDeductionOrder = ?');
      vals.push(v);
    }
    if (freightAddressEntryMode !== undefined) {
      updates.push('freightAddressEntryMode = ?');
      vals.push(freightAddressEntryMode === 'driver' ? 'driver' : 'manager');
    }
    setText('freightDefaultOriginAddress', freightDefaultOriginAddress);
    setText('freightDefaultLoadAddress', freightDefaultLoadAddress);
    if (broadcastRepliesRouting !== undefined) {
      updates.push('broadcastRepliesRouting = ?');
      vals.push(broadcastRepliesRouting === 'sender' ? 'sender' : 'park');
    }

    const finalize = () => {
      if (!updates.length) return res.json({ success: true });
      const applyUpdate = () => {
        vals.push(director.parkId);
        db.run(`UPDATE parks SET ${updates.join(', ')}, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`, vals, function (uErr) {
          if (uErr) return res.status(500).json({ error: uErr.message });
          return res.json({ success: true });
        });
      };
      if (isActive === true || isActive === 1 || isActive === '1') {
        validateParkActivationData(director.parkId, (actErr) => {
          if (actErr) return res.status(400).json({ error: actErr });
          applyUpdate();
        });
        return;
      }
      applyUpdate();
    };

    const upsertRates = (cb) => {
      if (eplPrice === undefined && autoClosePrice === undefined) return cb();
      const epl = eplPrice != null && !Number.isNaN(Number(eplPrice)) ? Math.max(0, Number(eplPrice)) : 25;
      const autoClose = autoClosePrice != null && !Number.isNaN(Number(autoClosePrice)) ? Math.max(0, Number(autoClosePrice)) : 10;
      db.run(
        `INSERT INTO waybill_rates (parkId, eplCreationFee, autoCloseFee, eplCreationFeeCurrency, commissionPercent, description, isActive, createdAt)
         VALUES (?, ?, ?, 'RUB', 0, 'director_settings', 1, CURRENT_TIMESTAMP)`,
        [director.parkId, epl, autoClose],
        () => cb()
      );
    };

    const upsertPhotoControl = (cb) => {
      if (
        photoControlEnabled === undefined &&
        photoControlPrice === undefined &&
        photoControlValidDays === undefined &&
        photoControlNotifyHoursBefore === undefined
      ) return cb();
      const enabled = photoControlEnabled ? 1 : 0;
      const price = photoControlPrice != null && !Number.isNaN(Number(photoControlPrice)) ? Math.max(0, Number(photoControlPrice)) : 150;
      const validDays = photoControlValidDays != null && !Number.isNaN(Number(photoControlValidDays)) ? Math.max(1, Number(photoControlValidDays)) : 10;
      const notifyHours = photoControlNotifyHoursBefore != null && !Number.isNaN(Number(photoControlNotifyHoursBefore))
        ? Math.max(1, Number(photoControlNotifyHoursBefore))
        : 24;
      db.run(
        `INSERT OR REPLACE INTO park_photo_control_settings
          (parkId, enabled, price, validDays, notifyHoursBefore, updatedAt)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [director.parkId, enabled, price, validDays, notifyHours],
        () => cb()
      );
    };

    const upsertGameSettings = (cb) => {
      const hasGamePayload =
        gameEnabled !== undefined ||
        leaderboardDefault !== undefined ||
        rewardsEnabled !== undefined ||
        gameShopConfig !== undefined ||
        Array.isArray(gameRewards);
      if (!hasGamePayload) return cb();
      const gEnabled = gameEnabled ? 1 : 0;
      const gLeaderboard = leaderboardDefault || 'day';
      const gRewardsEnabled = rewardsEnabled ? 1 : 0;
      let gShopConfig = null;
      if (gameShopConfig !== undefined && gameShopConfig !== null) {
        try {
          const parsed = typeof gameShopConfig === 'string' ? JSON.parse(gameShopConfig) : gameShopConfig;
          if (parsed && typeof parsed.currencyType === 'string' && ['points', 'real'].includes(parsed.currencyType)) {
            gShopConfig = JSON.stringify({
              currencyType: parsed.currencyType,
              magnet: Math.max(0, parseInt(parsed.magnet, 10) || 0),
              nitro: Math.max(0, parseInt(parsed.nitro, 10) || 0),
              jump: Math.max(0, parseInt(parsed.jump, 10) || 0),
              extra_life: Math.max(0, parseInt(parsed.extra_life, 10) || 0),
            });
          }
        } catch (_) {}
      }

      db.get('SELECT parkId, gameShopConfig FROM park_game_settings WHERE parkId = ?', [director.parkId], (selErr, existing) => {
        if (selErr) return res.status(500).json({ error: selErr.message });
        const saveRewards = () => {
          db.run('DELETE FROM park_game_rewards WHERE parkId = ?', [director.parkId], (delErr) => {
            if (delErr) return res.status(500).json({ error: delErr.message });
            const list = Array.isArray(gameRewards) ? gameRewards : [];
            if (!list.length) return cb();
            const placeholders = list.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
            const flat = list.flatMap((r) => [
              director.parkId,
              parseInt(r.position, 10) || 1,
              r.rewardType === 'discount' ? 'discount' : 'free_epl',
              r.rewardType === 'free_epl' ? (parseInt(r.freeEplCount, 10) || 0) : 0,
              r.rewardType === 'discount' ? (parseInt(r.discountPercent, 10) || 0) : 0,
              r.rewardType === 'discount' ? (parseInt(r.discountEplCount, 10) || 0) : 0,
            ]);
            db.run(
              `INSERT INTO park_game_rewards (parkId, position, rewardType, freeEplCount, discountPercent, discountEplCount) VALUES ${placeholders}`,
              flat,
              (insErr) => {
                if (insErr) return res.status(500).json({ error: insErr.message });
                cb();
              }
            );
          });
        };

        const shopVal = gShopConfig != null ? gShopConfig : (existing?.gameShopConfig ?? null);
        if (!existing) {
          db.run(
            `INSERT INTO park_game_settings (parkId, gameEnabled, leaderboardDefault, rewardsEnabled, gameShopConfig, updatedAt)
             VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [director.parkId, gEnabled, gLeaderboard, gRewardsEnabled, shopVal],
            (insErr) => {
              if (insErr) return res.status(500).json({ error: insErr.message });
              saveRewards();
            }
          );
          return;
        }
        db.run(
          `UPDATE park_game_settings
           SET gameEnabled = ?, leaderboardDefault = ?, rewardsEnabled = ?, gameShopConfig = ?, updatedAt = CURRENT_TIMESTAMP
           WHERE parkId = ?`,
          [gEnabled, gLeaderboard, gRewardsEnabled, shopVal, director.parkId],
          (updErr) => {
            if (updErr) return res.status(500).json({ error: updErr.message });
            saveRewards();
          }
        );
      });
    };

    upsertRates(() => upsertPhotoControl(() => upsertGameSettings(finalize)));
  });
});

// ===== OWNERS (read-only как у менеджера) =====
router.get('/owners', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(400).json({ error: 'Директор не привязан к парку' });
    db.all(
      'SELECT * FROM park_owners WHERE parkId = ? ORDER BY isDefault DESC, createdAt DESC',
      [director.parkId],
      (err2, rows) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json(rows || []);
      }
    );
  });
});

router.get('/owners/all', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Access denied' });
    if (!ensureParkSettingsSectionAccess(director, res, 'canParkSettingsOwners', 'Нет доступа к блоку организаций')) return;
    db.all(
      `SELECT po.*, p.name as parkName
       FROM park_owners po
       JOIN directors d ON d.parkId = po.parkId
       LEFT JOIN parks p ON p.id = po.parkId
       WHERE d.userId = ?
       ORDER BY po.name ASC`,
      [req.user.userId],
      (qErr, rows) => {
        if (qErr) return res.status(500).json({ error: qErr.message });
        res.json(rows || []);
      }
    );
  });
});

router.get('/parks/:parkId/owners', authenticateToken, authorizeRole('director'), (req, res) => {
  withDirectorParkAccess(req, req.params.parkId, res, (director, parkId) => {
    if (!ensureParkSettingsSectionAccess(director, res, 'canParkSettingsOwners', 'Нет доступа к блоку организаций')) return;
    db.all(
      `SELECT * FROM park_owners WHERE parkId = ? ORDER BY isDefault DESC, createdAt DESC`,
      [parkId],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
      }
    );
  });
});

router.post('/parks/:parkId/owners', authenticateToken, authorizeRole('director'), (req, res) => {
  withDirectorParkAccess(req, req.params.parkId, res, (director, parkId) => {
    if (!ensureParkSettingsSectionAccess(director, res, 'canParkSettingsOwners', 'Нет доступа к блоку организаций')) return;
    const {
      type, role, name, inn, ogrn, ogrnip, kpp, phone, email,
      postalIndex, regionCode, district, city, locality, street, house, housing, flat, isDefault
    } = req.body || {};

    if (!type || !['legal', 'individual'].includes(type)) return res.status(400).json({ error: 'type должен быть legal или individual' });
    if (!role || !['С', 'А'].includes(role)) return res.status(400).json({ error: 'role должен быть С или А' });
    if (!name || !name.trim()) return res.status(400).json({ error: 'Укажите наименование организации / ФИО владельца' });

    const makeDefault = isDefault ? 1 : 0;
    const insertOwner = () => {
      db.run(
        `INSERT INTO park_owners (
          parkId, type, role, name,
          inn, ogrn, ogrnip, kpp,
          phone, email, postalIndex, regionCode, district, city, locality, street, house, housing, flat, isDefault
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          parkId, type, role, name.trim(),
          inn || null, ogrn || null, ogrnip || null, kpp || null,
          phone || null, email || null, postalIndex || null, regionCode || null, district || null, city || null,
          locality || null, street || null, house || null, housing || null, flat || null, makeDefault,
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          db.get('SELECT * FROM park_owners WHERE id = ?', [this.lastID], (gErr, row) => {
            if (gErr) return res.status(500).json({ error: gErr.message });
            res.status(201).json(row);
          });
        }
      );
    };

    if (makeDefault) {
      db.run('UPDATE park_owners SET isDefault = 0 WHERE parkId = ?', [parkId], () => insertOwner());
    } else {
      insertOwner();
    }
  });
});

router.put('/parks/:parkId/owners/:ownerId', authenticateToken, authorizeRole('director'), (req, res) => {
  withDirectorParkAccess(req, req.params.parkId, res, (director, parkId) => {
    if (!ensureParkSettingsSectionAccess(director, res, 'canParkSettingsOwners', 'Нет доступа к блоку организаций')) return;
    const ownerId = parseInt(req.params.ownerId, 10);
    if (!ownerId || Number.isNaN(ownerId)) return res.status(400).json({ error: 'Некорректный ownerId' });

    const {
      type, role, name, inn, ogrn, ogrnip, kpp, phone, email,
      postalIndex, regionCode, district, city, locality, street, house, housing, flat, isDefault
    } = req.body || {};

    db.get('SELECT id FROM park_owners WHERE id = ? AND parkId = ?', [ownerId, parkId], (sErr, ownerRow) => {
      if (sErr) return res.status(500).json({ error: sErr.message });
      if (!ownerRow) return res.status(404).json({ error: 'Owner not found' });

      const updates = [];
      const vals = [];
      if (type !== undefined) {
        if (!['legal', 'individual'].includes(type)) return res.status(400).json({ error: 'type должен быть legal или individual' });
        updates.push('type = ?');
        vals.push(type);
      }
      if (role !== undefined) {
        if (!['С', 'А'].includes(role)) return res.status(400).json({ error: 'role должен быть С или А' });
        updates.push('role = ?');
        vals.push(role);
      }
      if (name !== undefined) {
        if (!String(name).trim()) return res.status(400).json({ error: 'Укажите наименование организации / ФИО владельца' });
        updates.push('name = ?');
        vals.push(String(name).trim());
      }
      if (inn !== undefined) { updates.push('inn = ?'); vals.push(inn || null); }
      if (ogrn !== undefined) { updates.push('ogrn = ?'); vals.push(ogrn || null); }
      if (ogrnip !== undefined) { updates.push('ogrnip = ?'); vals.push(ogrnip || null); }
      if (kpp !== undefined) { updates.push('kpp = ?'); vals.push(kpp || null); }
      if (phone !== undefined) { updates.push('phone = ?'); vals.push(phone || null); }
      if (email !== undefined) { updates.push('email = ?'); vals.push(email || null); }
      if (postalIndex !== undefined) { updates.push('postalIndex = ?'); vals.push(postalIndex || null); }
      if (regionCode !== undefined) { updates.push('regionCode = ?'); vals.push(regionCode || null); }
      if (district !== undefined) { updates.push('district = ?'); vals.push(district || null); }
      if (city !== undefined) { updates.push('city = ?'); vals.push(city || null); }
      if (locality !== undefined) { updates.push('locality = ?'); vals.push(locality || null); }
      if (street !== undefined) { updates.push('street = ?'); vals.push(street || null); }
      if (house !== undefined) { updates.push('house = ?'); vals.push(house || null); }
      if (housing !== undefined) { updates.push('housing = ?'); vals.push(housing || null); }
      if (flat !== undefined) { updates.push('flat = ?'); vals.push(flat || null); }

      const setDefault = isDefault !== undefined ? (isDefault ? 1 : 0) : null;
      if (setDefault !== null) {
        updates.push('isDefault = ?');
        vals.push(setDefault);
      }
      if (!updates.length) return res.status(400).json({ error: 'Нет данных для обновления' });

      const doUpdate = () => {
        vals.push(ownerId, parkId);
        db.run(
          `UPDATE park_owners SET ${updates.join(', ')}, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND parkId = ?`,
          vals,
          function (uErr) {
            if (uErr) return res.status(500).json({ error: uErr.message });
            if (!this.changes) return res.status(404).json({ error: 'Owner not found' });
            db.get('SELECT * FROM park_owners WHERE id = ?', [ownerId], (gErr, row) => {
              if (gErr) return res.status(500).json({ error: gErr.message });
              res.json(row);
            });
          }
        );
      };

      if (setDefault === 1) {
        db.run('UPDATE park_owners SET isDefault = 0 WHERE parkId = ?', [parkId], () => doUpdate());
      } else {
        doUpdate();
      }
    });
  });
});

router.delete('/parks/:parkId/owners/:ownerId', authenticateToken, authorizeRole('director'), (req, res) => {
  withDirectorParkAccess(req, req.params.parkId, res, (director, parkId) => {
    if (!ensureParkSettingsSectionAccess(director, res, 'canParkSettingsOwners', 'Нет доступа к блоку организаций')) return;
    const ownerId = parseInt(req.params.ownerId, 10);
    if (!ownerId || Number.isNaN(ownerId)) return res.status(400).json({ error: 'Некорректный ownerId' });
    db.get('SELECT COUNT(*) as cnt FROM cars WHERE ownerId = ? AND parkId = ?', [ownerId, parkId], (cntErr, row) => {
      if (cntErr) return res.status(500).json({ error: cntErr.message });
      if (row && row.cnt > 0) return res.status(400).json({ error: 'Нельзя удалить владельца: к нему привязаны автомобили' });
      db.run('DELETE FROM park_owners WHERE id = ? AND parkId = ?', [ownerId, parkId], function (dErr) {
        if (dErr) return res.status(500).json({ error: dErr.message });
        if (!this.changes) return res.status(404).json({ error: 'Owner not found' });
        res.json({ success: true });
      });
    });
  });
});

router.get('/parks/:parkId/staff', authenticateToken, authorizeRole('director'), (req, res) => {
  withDirectorParkAccess(req, req.params.parkId, res, (director, parkId) => {
    if (!ensureParkSettingsSectionAccess(director, res, 'canParkSettingsStaff', 'Нет доступа к блоку персонала')) return;
    db.all(
      `SELECT id, parkId, role, fullName, firstName, lastName, secondName, position, phone, email, authorityBasis,
       licenseSerial, licenseNumber, licenseDateStart, licenseDateEnd,
       taxcomLogin, taxcomPassword, COALESCE(isActive,1) as isActive, COALESCE(priority,0) as priority
       FROM park_staff WHERE parkId = ?
       ORDER BY role, COALESCE(isActive,1) DESC, COALESCE(priority,0) DESC, id DESC`,
      [parkId],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
      }
    );
  });
});

router.post('/parks/:parkId/staff', authenticateToken, authorizeRole('director'), (req, res) => {
  withDirectorParkAccess(req, req.params.parkId, res, (director, parkId) => {
    if (!ensureParkSettingsSectionAccess(director, res, 'canParkSettingsStaff', 'Нет доступа к блоку персонала')) return;
    const {
      id: staffId, role, fullName, firstName, lastName, secondName, position, phone, email, authorityBasis,
      licenseSerial, licenseNumber, licenseDateStart, licenseDateEnd, taxcomLogin, taxcomPassword, isActive, priority
    } = req.body || {};

    if (!['medic', 'technic', 'dispatcher'].includes(role)) return res.status(400).json({ error: 'role должен быть: medic, technic или dispatcher' });
    if (!String(taxcomLogin || '').trim() || !String(taxcomPassword || '').trim()) {
      return res.status(400).json({ error: 'Обязательные поля: taxcomLogin, taxcomPassword' });
    }
    const defaultByRole = {
      dispatcher: { fullName: 'Диспетчер парка', position: 'Диспетчер' },
      medic: { fullName: 'Медицинский работник', position: 'Медицинский работник' },
      technic: { fullName: 'Механик', position: 'Механик' },
    };
    const safeFullName = String(fullName || '').trim() || defaultByRole[role].fullName;
    const safePosition = String(position || '').trim() || defaultByRole[role].position;

    let fioLastName = lastName || '';
    let fioFirstName = firstName || '';
    let fioSecondName = secondName || '';
    if (!lastName && safeFullName) {
      const fioParts = (safeFullName || '').trim().split(/\s+/);
      fioLastName = fioParts[0] || '';
      fioFirstName = fioParts[1] || '';
      fioSecondName = fioParts[2] || '';
    }
    const finalFullName = safeFullName || `${fioLastName} ${fioFirstName}${fioSecondName ? ` ${fioSecondName}` : ''}`.trim();

    const activeVal = isActive === false || isActive === 0 || isActive === '0' ? 0 : 1;
    const priorityVal = Number.isFinite(Number(priority)) ? Number(priority) : 0;
    const parsedStaffId = Number(staffId);
    if (Number.isFinite(parsedStaffId) && parsedStaffId > 0) {
      db.run(
        `UPDATE park_staff SET
         role = ?, fullName = ?, lastName = ?, firstName = ?, secondName = ?, position = ?,
         phone = ?, email = ?, authorityBasis = ?,
         licenseSerial = ?, licenseNumber = ?, licenseDateStart = ?, licenseDateEnd = ?,
         taxcomLogin = ?, taxcomPassword = ?, isActive = ?, priority = ?, updatedAt = CURRENT_TIMESTAMP
         WHERE id = ? AND parkId = ?`,
        [
          role, finalFullName, fioLastName, fioFirstName, fioSecondName, safePosition,
          phone || null, email || null, authorityBasis || null,
          licenseSerial || null, licenseNumber || null, licenseDateStart || null, licenseDateEnd || null,
          taxcomLogin || null, taxcomPassword || null, activeVal, priorityVal, parsedStaffId, parkId
        ],
        function (uErr) {
          if (uErr) return res.status(500).json({ error: uErr.message });
          if (!this.changes) return res.status(404).json({ error: 'Сотрудник не найден' });
          db.get('SELECT * FROM park_staff WHERE id = ?', [parsedStaffId], (gErr, staff) => {
            if (gErr) return res.status(500).json({ error: gErr.message });
            res.json({ message: 'Сотрудник обновлен', staff });
          });
        }
      );
      return;
    }
    db.run(
      `INSERT INTO park_staff
       (parkId, role, fullName, lastName, firstName, secondName, position, phone, email, authorityBasis,
        licenseSerial, licenseNumber, licenseDateStart, licenseDateEnd, taxcomLogin, taxcomPassword, isActive, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        parkId, role, finalFullName, fioLastName, fioFirstName, fioSecondName, safePosition,
        phone || null, email || null, authorityBasis || null, licenseSerial || null, licenseNumber || null,
        licenseDateStart || null, licenseDateEnd || null, taxcomLogin || null, taxcomPassword || null, activeVal, priorityVal
      ],
      function (iErr) {
        if (iErr) return res.status(500).json({ error: iErr.message });
        db.get('SELECT * FROM park_staff WHERE id = ?', [this.lastID], (gErr, staff) => {
          if (gErr) return res.status(500).json({ error: gErr.message });
          res.json({ message: 'Сотрудник создан', staff });
        });
      }
    );
  });
});

router.get('/takskom/carparks', authenticateToken, authorizeRole('director'), async (req, res) => {
  getDirectorPark(req, async (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Access denied' });
    if (!ensureParkSettingsSectionAccess(director, res, 'canParkSettingsTakskom', 'Нет доступа к блоку привязки Такском')) return;
    try {
      const info = await TakskornAPI.getInfo();
      res.json({
        success: true,
        carParks: info.carParks || [],
        message: info.carParks?.length > 0 ? `Found ${info.carParks.length} car parks` : 'No car parks found',
      });
    } catch (e) {
      res.status(502).json({ success: false, error: e.message });
    }
  });
});

router.get('/parks/:parkId/evacuator-settings', authenticateToken, authorizeRole('director'), (req, res) => {
  withDirectorParkAccess(req, req.params.parkId, res, (director, parkId) => {
    if (!ensureParkSettingsSectionAccess(director, res, 'canParkSettingsServices', 'Нет доступа к сервисным блокам')) return;
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
});

router.put('/parks/:parkId/evacuator-settings', authenticateToken, authorizeRole('director'), (req, res) => {
  withDirectorParkAccess(req, req.params.parkId, res, (director, parkId) => {
    if (!ensureParkSettingsSectionAccess(director, res, 'canParkSettingsServices', 'Нет доступа к сервисным блокам')) return;
    const { evacuatorEnabled, requestPriceOverride } = req.body || {};
    const now = new Date().toISOString();
    const enabled = evacuatorEnabled ? 1 : 0;
    const override = requestPriceOverride != null && requestPriceOverride !== '' ? parseFloat(requestPriceOverride) : null;
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
        res.json({ success: true, evacuatorEnabled: !!enabled, requestPriceOverride: override });
      }
    );
  });
});

router.get('/parks/:parkId/commissioner-settings', authenticateToken, authorizeRole('director'), (req, res) => {
  withDirectorParkAccess(req, req.params.parkId, res, (director, parkId) => {
    if (!ensureParkSettingsSectionAccess(director, res, 'canParkSettingsServices', 'Нет доступа к сервисным блокам')) return;
    db.get(
      'SELECT commissionerEnabled, requestPriceOverride, updatedAt FROM park_commissioner_settings WHERE parkId = ?',
      [parkId],
      (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
          commissionerEnabled: !!(row && row.commissionerEnabled),
          requestPriceOverride: row?.requestPriceOverride ?? null,
          updatedAt: row?.updatedAt || null
        });
      }
    );
  });
});

router.put('/parks/:parkId/commissioner-settings', authenticateToken, authorizeRole('director'), (req, res) => {
  withDirectorParkAccess(req, req.params.parkId, res, (director, parkId) => {
    if (!ensureParkSettingsSectionAccess(director, res, 'canParkSettingsServices', 'Нет доступа к сервисным блокам')) return;
    const { commissionerEnabled, requestPriceOverride } = req.body || {};
    const now = new Date().toISOString();
    const enabled = commissionerEnabled ? 1 : 0;
    const override = requestPriceOverride != null && requestPriceOverride !== '' ? parseFloat(requestPriceOverride) : null;
    db.run(
      `INSERT INTO park_commissioner_settings (parkId, commissionerEnabled, requestPriceOverride, updatedAt)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(parkId) DO UPDATE SET
         commissionerEnabled = excluded.commissionerEnabled,
         requestPriceOverride = excluded.requestPriceOverride,
         updatedAt = excluded.updatedAt`,
      [parkId, enabled, override, now],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, commissionerEnabled: !!enabled, requestPriceOverride: override });
      }
    );
  });
});

// ===== CARS (как у менеджера) =====
router.get('/cars', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(500).json({ error: 'Park not found' });
    db.all(
      `SELECT c.*, d.id as driverId, d.userId, u.fullName as driverName
       FROM cars c
       LEFT JOIN drivers d ON c.id = d.carId AND d.parkId = c.parkId
       LEFT JOIN users u ON d.userId = u.id
       WHERE c.parkId = ?
       ORDER BY c.createdAt DESC`,
      [director.parkId],
      (e, rows) => {
        if (e) return res.status(500).json({ error: e.message });
        res.json(rows || []);
      }
    );
  });
});

// ===== DRIVERS (как у менеджера, базовый набор) =====
router.get('/drivers', authenticateToken, authorizeRole('director'), (req, res) => {
  try {
    getDirectorPark(req, (err, director) => {
      if (err || !director) return res.status(403).json({ error: 'Access denied' });
      db.all(
        `SELECT d.id, u.id as userId, u.username, u.fullName, u.phone,
                (COALESCE(u.balanceReal,0) + COALESCE(u.balanceUnreal,0)) as balance,
                COALESCE(u.balanceReal,0) as balanceReal, COALESCE(u.balanceUnreal,0) as balanceUnreal,
                d.license, u.licenseSerial, u.licenseNumber, u.licenseDate, d.carId, d.isVerified,
                COALESCE(d.eplAccessOverride, 'default') as eplAccessOverride,
                c.regNumber, c.brand, c.model, u.personnelNumber,
                u.inn, u.snils, d.syncedWithTakskom
         FROM drivers d
         JOIN users u ON d.userId = u.id
         LEFT JOIN cars c ON d.carId = c.id AND c.parkId = d.parkId
         WHERE d.parkId = ?
         ORDER BY u.createdAt DESC`,
        [director.parkId],
        (e, drivers) => {
          if (e) return res.status(500).json({ error: e.message });
          res.json(drivers || []);
        }
      );
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/drivers', authenticateToken, authorizeRole('director'), async (req, res) => {
  try {
    const { username, password, phone, fullName, license, licenseSerial, licenseNumber, licenseDate, inn, snils } = req.body;
    if (!username || !password || !phone || !fullName) {
      return res.status(400).json({ error: 'Обязательные поля: логин, пароль, телефон, ФИО' });
    }
    if (!license && !licenseSerial && !licenseNumber) {
      return res.status(400).json({ error: 'Обязательное поле: серия/номер ВУ (license или licenseSerial/licenseNumber)' });
    }
    getDirectorPark(req, async (err, director) => {
      if (err || !director) return res.status(403).json({ error: 'Access denied' });
      db.get(`SELECT p.takskornId, p.isActive FROM parks p WHERE p.id = ?`, [director.parkId], async (err2, park) => {
        if (err2 || !park) return res.status(403).json({ error: 'Park not found' });
        if (!park.isActive) return res.status(403).json({ error: 'Парк неактивен. Добавление авто, водителей и привязка недоступны.' });

        const personnelNumber = `DRV-${director.parkId}-${Date.now()}`;
        const hashedPassword = hashPassword(password);
        const fioParts = (fullName || '').trim().split(/\s+/).filter(Boolean);
        const lastName = fioParts[0] || null;
        const firstName = fioParts[1] || null;
        const secondName = fioParts[2] || null;

        db.get(`SELECT id FROM users WHERE username = ? OR phone = ?`, [username, phone], async (checkErr, existing) => {
          if (checkErr) return res.status(500).json({ error: checkErr.message });
          if (existing) return res.status(400).json({ error: 'Пользователь с таким логином или телефоном уже существует' });

          db.run(
            `INSERT INTO users (username, password, phone, fullName, firstName, lastName, secondName, role, personnelNumber, inn, snils, licenseSerial, licenseNumber, licenseDate)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'driver', ?, ?, ?, ?, ?, ?)`,
            [
              username,
              hashedPassword,
              phone,
              fullName,
              firstName,
              lastName,
              secondName,
              personnelNumber,
              inn || null,
              snils || null,
              licenseSerial || null,
              licenseNumber || null,
              licenseDate || null,
            ],
            function (insErr) {
              if (insErr) return res.status(500).json({ error: insErr.message });
              const userId = this.lastID;
              const licenseCombined = license || [licenseSerial, licenseNumber].filter(Boolean).join(' ');
              db.run(
                `INSERT INTO drivers (userId, parkId, license, syncedWithTakskom, isVerified, lastSyncAt)
                 VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [userId, director.parkId, licenseCombined || null, 0, 0],
                function (dErr) {
                  if (dErr) return res.status(500).json({ error: dErr.message });
                  res.status(201).json({
                    id: userId,
                    userId,
                    phone,
                    fullName,
                    personnelNumber,
                    message: 'Driver created'
                  });
                }
              );
            }
          );
        });
      });
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/drivers/search', authenticateToken, authorizeRole('director'), (req, res) => {
  try {
    const { q } = req.query;
    getDirectorPark(req, (err, director) => {
      if (err || !director) return res.status(403).json({ error: 'Access denied' });
      const searchQuery = `%${q || ''}%`;
      db.all(
        `SELECT d.id, u.id as userId, u.fullName, u.phone, u.personnelNumber,
                d.carId, c.regNumber, d.syncedWithTakskom
         FROM drivers d
         JOIN users u ON d.userId = u.id
         LEFT JOIN cars c ON d.carId = c.id AND c.parkId = d.parkId
         WHERE d.parkId = ? AND (u.fullName LIKE ? OR u.phone LIKE ? OR u.personnelNumber LIKE ?)
         ORDER BY u.createdAt DESC`,
        [director.parkId, searchQuery, searchQuery, searchQuery],
        (e, rows) => {
          if (e) return res.status(500).json({ error: e.message });
          res.json(rows || []);
        }
      );
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/drivers/:driverId', authenticateToken, authorizeRole('director'), (req, res) => {
  try {
    const { driverId } = req.params;
    getDirectorPark(req, (err, director) => {
      if (err || !director) return res.status(403).json({ error: 'Access denied' });
      db.get(
        `SELECT d.id, u.id as userId, u.fullName, u.phone, u.email, u.personnelNumber,
                d.license, u.licenseSerial, u.licenseNumber, u.licenseDate, d.carId, d.isVerified, d.syncedWithTakskom,
                COALESCE(d.eplAccessOverride, 'default') as eplAccessOverride,
                c.id as carId, c.regNumber, c.brand, c.model, c.inventoryNumber
         FROM drivers d
         JOIN users u ON d.userId = u.id
         LEFT JOIN cars c ON d.carId = c.id AND c.parkId = d.parkId
         WHERE d.id = ? AND d.parkId = ?`,
        [driverId, director.parkId],
        (e, driver) => {
          if (e) return res.status(500).json({ error: e.message });
          if (!driver) return res.status(404).json({ error: 'Driver not found' });
          res.json(driver);
        }
      );
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Обновить водителя (привязка авто, верификация, ФИО/телефон/документы)
router.put('/drivers/:driverId', authenticateToken, authorizeRole('director'), (req, res) => {
  try {
    const { driverId } = req.params;
    const { carId, isVerified, fullName, phone, license, licenseSerial, licenseNumber, licenseDate, inn, snils, personnelNumber, eplAccessOverride } = req.body;
    const done = () => res.json({ message: 'Driver updated successfully' });

    getDirectorPark(req, (err, dir) => {
      if (err || !dir) return res.status(403).json({ error: 'Access denied' });
      db.get('SELECT isActive FROM parks WHERE id = ?', [dir.parkId], (e2, park) => {
        if (e2 || !park) return res.status(403).json({ error: 'Park not found' });
        const director = { ...dir, isActive: park.isActive };
        if (!director.isActive) {
          return res.status(403).json({ error: 'Парк неактивен. Редактирование водителей недоступно.' });
        }

        db.get(
          `SELECT userId FROM drivers WHERE id = ? AND parkId = ?`,
          [driverId, director.parkId],
          (e3, driver) => {
            if (e3 || !driver) return res.status(404).json({ error: 'Driver not found' });
            const userId = driver.userId;

            const driverUpdates = [];
            const driverValues = [];
            let needsCarBinding = false;
            let newCarId = null;

            if (carId !== undefined) {
              needsCarBinding = true;
              newCarId = carId;
            }
            if (isVerified !== undefined) {
              driverUpdates.push('isVerified = ?');
              driverValues.push(isVerified ? 1 : 0);
            }
            if (license !== undefined) {
              driverUpdates.push('license = ?');
              driverValues.push(license);
            }
            if (eplAccessOverride !== undefined) {
              const eplOverride = eplAccessOverride === 'force_allow'
                ? 'force_allow'
                : eplAccessOverride === 'force_deny'
                  ? 'force_deny'
                  : 'default';
              driverUpdates.push('eplAccessOverride = ?');
              driverValues.push(eplOverride);
            }

            const userUpdates = [];
            const userValues = [];
            if (fullName !== undefined) {
              userUpdates.push('fullName = ?');
              userValues.push(fullName);
              const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
              userUpdates.push('lastName = ?', 'firstName = ?', 'secondName = ?');
              userValues.push(parts[0] || null, parts[1] || null, parts[2] || null);
            }
            if (phone !== undefined) {
              userUpdates.push('phone = ?', 'username = ?');
              userValues.push(phone, phone);
            }
            if (personnelNumber !== undefined) {
              userUpdates.push('personnelNumber = ?');
              userValues.push(personnelNumber);
            }
            if (inn !== undefined) {
              userUpdates.push('inn = ?');
              userValues.push(inn);
            }
            if (snils !== undefined) {
              userUpdates.push('snils = ?');
              userValues.push(snils);
            }
            if (licenseSerial !== undefined) {
              userUpdates.push('licenseSerial = ?');
              userValues.push(licenseSerial);
            }
            if (licenseNumber !== undefined) {
              userUpdates.push('licenseNumber = ?');
              userValues.push(licenseNumber);
            }
            if (licenseDate !== undefined) {
              userUpdates.push('licenseDate = ?');
              userValues.push(licenseDate);
            }

            if (driverUpdates.length === 0 && userUpdates.length === 0 && !needsCarBinding) {
              return res.status(400).json({ error: 'No fields to update' });
            }

            const runDriverUpdate = (callback) => {
              if (driverUpdates.length === 0) return callback();
              driverValues.push(driverId, director.parkId);
              db.run(
                `UPDATE drivers SET ${driverUpdates.join(', ')} WHERE id = ? AND parkId = ?`,
                driverValues,
                (e4) => {
                  if (e4) return res.status(500).json({ error: e4.message });
                  callback();
                }
              );
            };

            const runUserUpdate = () => {
              if (userUpdates.length === 0) return done();
              userValues.push(userId);
              db.run(
                `UPDATE users SET ${userUpdates.join(', ')} WHERE id = ?`,
                userValues,
                (e5) => {
                  if (e5) return res.status(500).json({ error: e5.message });
                  done();
                }
              );
            };

            const bindCar = (callback) => {
              if (!needsCarBinding) return callback();
              if (newCarId === null) {
                db.run(`UPDATE drivers SET carId = NULL WHERE id = ? AND parkId = ?`, [driverId, director.parkId], (e6) => {
                  if (e6) return res.status(500).json({ error: e6.message });
                  callback();
                });
                return;
              }
              db.get(`SELECT id FROM cars WHERE id = ? AND parkId = ?`, [newCarId, director.parkId], (e7, car) => {
                if (e7) return res.status(500).json({ error: e7.message });
                if (!car) return res.status(404).json({ error: 'Car not found' });

                db.get(
                  `SELECT id FROM drivers WHERE carId = ? AND parkId = ? AND id != ?`,
                  [newCarId, director.parkId, driverId],
                  (e8, occupied) => {
                    if (e8) return res.status(500).json({ error: e8.message });
                    if (occupied) return res.status(400).json({ error: 'Этот автомобиль уже привязан к другому водителю' });

                    db.run(
                      `UPDATE drivers SET carId = ? WHERE id = ? AND parkId = ?`,
                      [newCarId, driverId, director.parkId],
                      (e9) => {
                        if (e9) return res.status(500).json({ error: e9.message });
                        callback();
                      }
                    );
                  }
                );
              });
            };

            runDriverUpdate(() => bindCar(runUserUpdate));
          }
        );
      });
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== ЭПЛ (минимум для вкладки EplTab) =====
router.get('/epl', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Access denied' });
    const parkId = director.parkId;
    const { waybillNumber, driverName, regNumber } = req.query || {};

    const filters = ['e.parkId = ?'];
    const params = [parkId];

    if (waybillNumber && String(waybillNumber).trim()) {
      filters.push('e.waybillNumber LIKE ?');
      params.push(`%${String(waybillNumber).trim()}%`);
    }
    if (driverName && String(driverName).trim()) {
      filters.push('(u.fullName LIKE ? OR u.firstName LIKE ? OR u.lastName LIKE ?)');
      const q = `%${String(driverName).trim()}%`;
      params.push(q, q, q);
    }
    if (regNumber && String(regNumber).trim()) {
      filters.push('c.regNumber LIKE ?');
      params.push(`%${String(regNumber).trim()}%`);
    }

    const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    db.all(
      `
      SELECT
        e.id,
        e.waybillNumber,
        e.status as eplStatus,
        e.createdAt,
        e.approvedAt,
        e.documentPdfReceivedAt,
        e.mintransId,
        e.qrCode,
        e.documentQr,
        d.id as driverId,
        u.fullName as driverName,
        c.regNumber,
        c.brand,
        c.model,
        shift_single.status as shiftStatus,
        CASE WHEN e.documentPdf IS NOT NULL AND length(e.documentPdf) > 0 THEN 1 ELSE 0 END as hasFastDoc,
        CASE WHEN e.mintransId IS NOT NULL AND e.mintransId != '' THEN 1 ELSE 0 END as hasOfficialDoc,
        CASE WHEN e.qrCode IS NOT NULL AND e.qrCode != '' THEN 1 ELSE 0 END as hasMintransQr
      FROM epl e
      LEFT JOIN drivers d ON e.driverId = d.id
      LEFT JOIN users u ON d.userId = u.id
      LEFT JOIN cars c ON e.carId = c.id AND c.parkId = e.parkId
      LEFT JOIN (
        SELECT eplId, status FROM (
          SELECT eplId, status,
                 ROW_NUMBER() OVER (PARTITION BY eplId ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, id DESC) as rn
          FROM shifts
        ) WHERE rn = 1
      ) shift_single ON shift_single.eplId = e.id
      ${whereSql}
      ORDER BY e.createdAt DESC
      `,
      params,
      (eErr, rows) => {
        if (eErr) return res.status(500).json({ error: eErr.message });
        const rawList = rows || [];
        if (rawList.length === 0) return res.json([]);

        const eplIds = rawList.map((r) => r.id);
        const placeholders = eplIds.map(() => '?').join(',');
        db.all(
          `SELECT eplId, titleCode, status FROM epl_titles WHERE eplId IN (${placeholders}) AND titleCode IN ('t1','t2','t3','t4')`,
          eplIds,
          (tErr, titlesRows) => {
            const titulByEpl = {};
            (titlesRows || []).forEach((t) => {
              if (!titulByEpl[t.eplId]) titulByEpl[t.eplId] = { t1: null, t2: null, t3: null, t4: null };
              const key = 't' + t.titleCode.charAt(1);
              titulByEpl[t.eplId][key] = t.status === 'signed' ? 'signed' : t.status || null;
            });

            const list = rawList.map((row) => {
              const hasFastDoc = !!row.hasFastDoc;
              const hasOfficialDoc = !!row.hasOfficialDoc;
              const hasMintransQr = !!row.hasMintransQr;
              const hasAnyDoc = hasFastDoc || hasOfficialDoc || hasMintransQr || !!row.documentQr;
              let uiGroup = null;
              if (row.shiftStatus === 'active' && hasAnyDoc) uiGroup = 'current_open';
              else if (hasFastDoc && !hasOfficialDoc) uiGroup = 'no_official_epl';
              else if (hasOfficialDoc && !hasMintransQr) uiGroup = 'no_mintrans_qr';
              else if (row.shiftStatus === 'closed') uiGroup = 'closed';
              else if (row.shiftStatus === 'auto_closed') uiGroup = 'auto_closed';
              const titulStatus = titulByEpl[row.id] || { t1: null, t2: null, t3: null, t4: null };
              return { ...row, uiGroup, titulStatus };
            });

            res.json(list);
          }
        );
      }
    );
  });
});

router.get('/epl/:eplId/logs', authenticateToken, authorizeRole('director'), (req, res) => {
  const eplId = parseInt(req.params.eplId, 10);
  if (!eplId) return res.status(400).json({ error: 'Некорректный id ЭПЛ' });
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Доступ запрещён' });
    if (!director.canViewEplLogs) return res.status(403).json({ error: 'Нет доступа к логам ЭПЛ' });
    db.all(
      `SELECT id, createdAt, source, event, message, details
       FROM epl_logs
       WHERE eplId = ? AND (parkId = ? OR parkId IS NULL)
       ORDER BY id DESC
       LIMIT 200`,
      [eplId, director.parkId],
      (e, rows) => {
        if (e) return res.status(500).json({ error: e.message });
        res.json(rows || []);
      }
    );
  });
});

// ===== ЭПЛ: управление очередью/сменами (как у менеджера, но с правами директора) =====
router.post('/epl/:eplId/requeue-creation', authenticateToken, authorizeRole('director'), (req, res) => {
  const eplId = parseInt(req.params.eplId, 10);
  if (!eplId || Number.isNaN(eplId)) return res.status(400).json({ error: 'Некорректный eplId' });

  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Access denied' });
    if (!director.canControlEplQueue) return res.status(403).json({ error: 'Нет доступа к управлению очередью ЭПЛ' });

    db.get(
      `SELECT id, parkId, driverId, status, mintransId
       FROM epl
       WHERE id = ? AND parkId = ?`,
      [eplId, director.parkId],
      (eErr, row) => {
        if (eErr) return res.status(500).json({ error: eErr.message });
        if (!row) return res.status(404).json({ error: 'Путевой лист не найден в вашем парке' });

        if (row.mintransId) {
          return res.status(400).json({ error: 'ЭПЛ уже имеет mintransId (создан в Такском), повторное создание невозможно. Используйте повторный запрос QR.' });
        }

        const allowedStatuses = ['draft', 'pending_clinic', 'failed'];
        if (!allowedStatuses.includes(row.status)) {
          return res.status(400).json({ error: `Нельзя пересоздать ЭПЛ в статусе ${row.status}. Доступны: ${allowedStatuses.join(', ')}.` });
        }

        db.run(
          `UPDATE epl
           SET status = 'pending_clinic',
               errorMessage = NULL,
               updatedAt = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [eplId],
          (updErr) => {
            if (updErr) return res.status(500).json({ error: updErr.message });
            db.run(
              `INSERT INTO epl_logs (eplId, driverId, parkId, source, event, message)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [
                eplId,
                row.driverId || null,
                row.parkId || null,
                'director',
                'creation_requeue_requested',
                'Директор парка поставил ЭПЛ в очередь на повторное создание в Такском',
              ],
              () => {}
            );
            res.json({ ok: true });
          }
        );
      }
    );
  });
});

router.post('/epl/:eplId/requeue-qr', authenticateToken, authorizeRole('director'), (req, res) => {
  const eplId = parseInt(req.params.eplId, 10);
  if (!eplId || Number.isNaN(eplId)) return res.status(400).json({ error: 'Некорректный eplId' });
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Access denied' });
    if (!director.canControlEplQueue) return res.status(403).json({ error: 'Нет доступа к управлению очередью ЭПЛ' });
    db.get(
      `SELECT id, parkId, driverId, mintransId, qrCode
       FROM epl
       WHERE id = ? AND parkId = ?`,
      [eplId, director.parkId],
      (eErr, row) => {
        if (eErr) return res.status(500).json({ error: eErr.message });
        if (!row) return res.status(404).json({ error: 'EPL not found' });
        if (!row.mintransId) return res.status(400).json({ error: 'Для этого ЭПЛ нет mintransId, переочередь QR невозможна' });
        if (row.qrCode && row.qrCode.trim() !== '') return res.status(400).json({ error: 'У ЭПЛ уже есть QR-код Минтранса' });
        db.run(
          `UPDATE epl SET qrRefetchRequested = 1 WHERE id = ?`,
          [eplId],
          (updErr) => {
            if (updErr) return res.status(500).json({ error: updErr.message });
            db.run(
              `INSERT INTO epl_logs (eplId, driverId, parkId, source, event, message)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [eplId, row.driverId, row.parkId, 'director', 'qr_refetch_requested', 'Директор парка запросил повторное получение QR Минтранса'],
              () => {}
            );
            res.json({ ok: true });
          }
        );
      }
    );
  });
});

router.post('/epl/:id/close-shift', authenticateToken, authorizeRole('director'), (req, res) => {
  const eplId = parseInt(req.params.id, 10);
  if (!eplId || Number.isNaN(eplId)) return res.status(400).json({ error: 'Некорректный id ЭПЛ' });
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Доступ запрещён' });
    if (!director.canCloseEplShifts) return res.status(403).json({ error: 'Нет права закрывать смены' });
    db.get(
      `SELECT e.id, e.status, e.parkId, d.userId
       FROM epl e
       JOIN drivers d ON e.driverId = d.id
       WHERE e.id = ? AND e.parkId = ?`,
      [eplId, director.parkId],
      (eErr, row) => {
        if (eErr) return res.status(500).json({ error: eErr.message });
        if (!row) return res.status(404).json({ error: 'Путевой лист не найден или не принадлежит вашему парку' });
        const userId = row.userId;
        db.run(
          `UPDATE shifts SET status = 'closed', closedAt = CURRENT_TIMESTAMP 
           WHERE eplId = ? AND status = 'active'`,
          [eplId],
          function (runErr) {
            if (runErr) return res.status(500).json({ error: runErr.message });
            db.run(
              `UPDATE epl SET status = 'failed', errorMessage = 'Отменён директором' 
               WHERE driverId = (SELECT id FROM drivers WHERE userId = ?) 
               AND status IN (${sqlQuoteList(CANCELABLE_BEFORE_TAXCOM)}) 
               AND (mintransId IS NULL OR mintransId = '')`,
              [userId],
              () => {
                db.run(
                  `UPDATE epl SET status = 'failed', errorMessage = 'Закрыт директором' 
                   WHERE id = ? AND status IN (${sqlQuoteList(CLOSE_SHIFT_FAIL_STATUSES)})`,
                  [eplId],
                  () => res.json({ success: true, message: 'Смена закрыта директором. ЭПЛ помечен как закрытый.' })
                );
              }
            );
          }
        );
      }
    );
  });
});

router.post('/epl/:id/close-shift-with-charge', authenticateToken, authorizeRole('director'), (req, res) => {
  const eplId = parseInt(req.params.id, 10);
  if (!eplId || Number.isNaN(eplId)) return res.status(400).json({ error: 'Некорректный id ЭПЛ' });
  const { amount, comment } = req.body || {};
  const sum = Number(amount);
  if (!sum || Number.isNaN(sum) || sum <= 0) return res.status(400).json({ error: 'Сумма списания должна быть положительным числом' });

  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Доступ запрещён' });
    if (!director.canChargeOnShiftClose) return res.status(403).json({ error: 'Нет права списывать деньги при закрытии смены' });
    if (!director.canCloseEplShifts) return res.status(403).json({ error: 'Нет права закрывать смены' });

    db.get(
      `SELECT e.id, e.status, e.parkId, d.userId
       FROM epl e
       JOIN drivers d ON e.driverId = d.id
       WHERE e.id = ? AND e.parkId = ?`,
      [eplId, director.parkId],
      (eErr, row) => {
        if (eErr) return res.status(500).json({ error: eErr.message });
        if (!row) return res.status(404).json({ error: 'Путевой лист не найден или не принадлежит вашему парку' });

        const userId = row.userId;
        const parkId = row.parkId;
        const description = comment && String(comment).trim()
          ? String(comment).trim()
          : 'Списание при закрытии смены директором';

        deductBalance(
          db,
          userId,
          parkId,
          sum,
          description,
          eplId,
          'expense',
          `close_shift_charge:director:epl:${eplId}`,
          (deductErr) => {
            if (deductErr) {
              const msg = deductErr.message || 'Не удалось списать средства';
              const status = /Недостаточно средств/i.test(msg) ? 400 : 500;
              return res.status(status).json({ error: msg });
            }
            db.run(
              `UPDATE shifts SET status = 'closed', closedAt = CURRENT_TIMESTAMP 
               WHERE eplId = ? AND status = 'active'`,
              [eplId],
              (runErr) => {
                if (runErr) return res.status(500).json({ error: runErr.message });
                db.run(
                  `UPDATE epl SET status = 'failed', errorMessage = 'Отменён директором (со списанием средств)' 
                   WHERE driverId = (SELECT id FROM drivers WHERE userId = ?) 
                     AND status IN (${sqlQuoteList(CANCELABLE_BEFORE_TAXCOM)}) 
                   AND (mintransId IS NULL OR mintransId = '')`,
                  [userId],
                  () => {
                    db.run(
                      `UPDATE epl SET status = 'failed', errorMessage = 'Закрыт директором (со списанием средств)' 
                         WHERE id = ? AND status IN (${sqlQuoteList(CLOSE_SHIFT_FAIL_STATUSES)})`,
                      [eplId],
                      () => res.json({ success: true, message: 'Смена закрыта директором. Средства списаны, ЭПЛ помечен как закрытый.' })
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
});

router.post('/cars', authenticateToken, authorizeRole('director'), async (req, res) => {
  try {
    const { regNumber, brand, model, vin, fuelType, tankVolume, seasonality, fuelUnit, inventoryNumber: invNum, vehicleType } = req.body;
    if (!regNumber || !brand) return res.status(400).json({ error: 'Гос. номер и марка обязательны' });

    getDirectorPark(req, async (err, dir) => {
      if (err || !dir) return res.status(403).json({ error: 'Access denied' });
      db.get(`SELECT p.takskornId, p.isActive FROM parks p WHERE p.id = ?`, [dir.parkId], async (err2, park) => {
        if (err2 || !park) return res.status(403).json({ error: 'Park not found' });
        if (!park.isActive) return res.status(403).json({ error: 'Парк неактивен. Добавление авто, водителей и привязка недоступны.' });

        const inventoryNumber = (invNum && String(invNum).trim()) || `INV-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

        let syncResult = null;
        let takskornId = null;
        let syncedWithTakskom = 0;

        if (park.takskornId) {
          syncResult = await takskSync.syncCarWithTakskom({
            regNumber,
            brand,
            model,
            vin,
            fuelType: fuelType || 'Бензин',
            tankVolume: tankVolume || null,
            seasonality: seasonality || 'Круглогодичная',
            fuelUnit: fuelUnit || 'Литр',
            inventoryNumber
          }, park.takskornId);
          if (syncResult.success) {
            takskornId = syncResult.takskornId;
            syncedWithTakskom = 1;
          }
        }

        const ownerId = req.body && req.body.ownerId ? req.body.ownerId : null;
        const insertCar = () => {
          db.run(
            `INSERT INTO cars (parkId, regNumber, brand, model, vin, inventoryNumber,
                             fuelType, tankVolume, seasonality, fuelUnit, vehicleType,
                             takskornId, syncedWithTakskom, lastSyncAt, ownerId)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
            [
              dir.parkId, regNumber, brand, model, vin, inventoryNumber,
              fuelType || 'Бензин', tankVolume || null, seasonality || 'Круглогодичная', fuelUnit || 'Литр', vehicleType || null,
              takskornId, syncedWithTakskom, ownerId
            ],
            function (insErr) {
              if (insErr) return res.status(500).json({ error: insErr.message });
              res.status(201).json({
                id: this.lastID,
                parkId: dir.parkId,
                regNumber,
                brand,
                model,
                vin,
                inventoryNumber,
                fuelType: fuelType || 'Бензин',
                tankVolume: tankVolume || null,
                seasonality: seasonality || 'Круглогодичная',
                fuelUnit: fuelUnit || 'Литр',
                takskornId,
                syncedWithTakskom: !!syncedWithTakskom,
                ownerId,
              });
            }
          );
        };

        if (ownerId) {
          db.get('SELECT id FROM park_owners WHERE id = ? AND parkId = ?', [ownerId, dir.parkId], (oErr, row) => {
            if (oErr) return res.status(500).json({ error: oErr.message });
            if (!row) return res.status(400).json({ error: 'Владелец не найден в этом парке' });
            insertCar();
          });
        } else {
          insertCar();
        }
      });
    });
  } catch (e) {
    console.error('[Director] POST /cars error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/cars/search', authenticateToken, authorizeRole('director'), (req, res) => {
  try {
    const { q } = req.query;
    getDirectorPark(req, (err, director) => {
      if (err || !director) return res.status(403).json({ error: 'Access denied' });
      const searchQuery = `%${q || ''}%`;
      db.all(
        `SELECT id, regNumber, brand, model, inventoryNumber, carId, syncedWithTakskom
         FROM cars
         WHERE parkId = ? AND (regNumber LIKE ? OR inventoryNumber LIKE ? OR brand LIKE ? OR model LIKE ?)
         ORDER BY createdAt DESC`,
        [director.parkId, searchQuery, searchQuery, searchQuery, searchQuery],
        (e, rows) => {
          if (e) return res.status(500).json({ error: e.message });
          res.json(rows || []);
        }
      );
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/cars/:carId', authenticateToken, authorizeRole('director'), (req, res) => {
  const { carId } = req.params;
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Access denied' });
    db.get(
      `SELECT c.*, d.id as driverId, d.userId, u.fullName as driverName
       FROM cars c
       LEFT JOIN drivers d ON c.id = d.carId AND d.parkId = c.parkId
       LEFT JOIN users u ON d.userId = u.id
       WHERE c.id = ? AND c.parkId = ?`,
      [carId, director.parkId],
      (e, row) => {
        if (e) return res.status(500).json({ error: e.message });
        if (!row) return res.status(404).json({ error: 'Car not found' });
        res.json(row);
      }
    );
  });
});

router.put('/cars/:id', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Access denied' });
    const carId = parseInt(req.params.id, 10);
    if (!carId) return res.status(400).json({ error: 'Invalid car id' });
    const { regNumber, brand, model, vin, fuelType, tankVolume, seasonality, fuelUnit, inventoryNumber, vehicleType, ownerId } = req.body || {};
    db.run(
      `UPDATE cars SET regNumber = COALESCE(?, regNumber),
                     brand = COALESCE(?, brand),
                     model = COALESCE(?, model),
                     vin = COALESCE(?, vin),
                     fuelType = COALESCE(?, fuelType),
                     tankVolume = COALESCE(?, tankVolume),
                     seasonality = COALESCE(?, seasonality),
                     fuelUnit = COALESCE(?, fuelUnit),
                     inventoryNumber = COALESCE(?, inventoryNumber),
                     vehicleType = COALESCE(?, vehicleType),
                     ownerId = COALESCE(?, ownerId),
                     updatedAt = CURRENT_TIMESTAMP
       WHERE id = ? AND parkId = ?`,
      [
        regNumber || null,
        brand || null,
        model || null,
        vin || null,
        fuelType || null,
        tankVolume || null,
        seasonality || null,
        fuelUnit || null,
        inventoryNumber || null,
        vehicleType || null,
        ownerId || null,
        carId,
        director.parkId
      ],
      function (e) {
        if (e) return res.status(500).json({ error: e.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Car not found' });
        res.json({ message: 'Car updated' });
      }
    );
  });
});

router.delete('/cars/:id', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Access denied' });
    const carId = parseInt(req.params.id, 10);
    if (!carId) return res.status(400).json({ error: 'Invalid car id' });
    db.run('DELETE FROM cars WHERE id = ? AND parkId = ?', [carId, director.parkId], function (e) {
      if (e) return res.status(500).json({ error: e.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Car not found' });
      res.json({ message: 'Car deleted' });
    });
  });
});

// ===== Список парков директора =====
router.get('/parks', authenticateToken, authorizeRole('director'), (req, res) => {
  db.all(
    `SELECT p.id, p.name, p.city, p.isActive,
            d.id as directorId,
            COALESCE(d.canAccessStatistics,1) as canAccessStatistics,
            COALESCE(d.canAccessPhotoControl,1) as canAccessPhotoControl
     FROM parks p
     JOIN directors d ON p.id = d.parkId
     WHERE d.userId = ?
     ORDER BY p.name`,
    [req.user.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

// ===== Информация о парке + права директора =====
router.get('/park', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(404).json({ error: 'Park not found' });
    db.get('SELECT * FROM parks WHERE id = ?', [director.parkId], (e2, park) => {
      if (e2) return res.status(500).json({ error: e2.message });
      if (!park) return res.status(404).json({ error: 'Park not found' });
      res.json({ park, permissions: director });
    });
  });
});

// ===== Статистика (как у менеджера, но с правами директора) =====
router.get('/statistics', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Access denied' });
    if (!director.canAccessStatistics) return res.status(403).json({ error: 'Нет доступа к статистике' });

    const parkId = director.parkId;
    const period = (req.query.period && String(req.query.period).trim()) || 'today';
    const date = req.query.date && String(req.query.date).trim();
    const dateStart = req.query.dateStart && String(req.query.dateStart).trim();
    const dateEnd = req.query.dateEnd && String(req.query.dateEnd).trim();

    let dateFilter = '';
    const today = getMoscowDate();
    const [yy, mm, dd] = today.split('-').map(Number);
    if (period === 'today') {
      dateFilter = getMoscowDateFilter('bh.createdAt', today);
    } else if (period === 'yesterday') {
      const yesterday = new Date(Date.UTC(yy, mm - 1, dd - 1)).toISOString().split('T')[0];
      dateFilter = getMoscowDateFilter('bh.createdAt', yesterday);
    } else if (period === 'since_friday') {
      const lastFri = getLastFriday(today);
      dateFilter = getMoscowPeriodFilter('bh.createdAt', lastFri, today);
    } else if (period === 'date' && date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      dateFilter = getMoscowDateFilter('bh.createdAt', date);
    } else if (period === 'range' && dateStart && dateEnd && /^\d{4}-\d{2}-\d{2}$/.test(dateStart) && /^\d{4}-\d{2}-\d{2}$/.test(dateEnd)) {
      dateFilter = getMoscowPeriodFilter('bh.createdAt', dateStart, dateEnd);
    } else if (period === 'week') {
      dateFilter = getMoscowPeriodFilter('bh.createdAt', new Date(Date.UTC(yy, mm - 1, dd - 7)).toISOString().split('T')[0], today);
    } else if (period === 'month') {
      dateFilter = getMoscowPeriodFilter('bh.createdAt', new Date(Date.UTC(yy, mm - 1, dd - 30)).toISOString().split('T')[0], today);
    } else {
      dateFilter = getMoscowDateFilter('bh.createdAt', today);
    }

    db.get(
      `
      SELECT
        (SELECT COUNT(DISTINCT d.id) FROM drivers d WHERE d.parkId = ?) as users,
        (SELECT COUNT(DISTINCT c.id) FROM cars c WHERE c.parkId = ?) as cars,
        (SELECT COUNT(DISTINCT d.id) FROM drivers d WHERE d.parkId = ? AND d.carId IS NOT NULL) as bindings
      `,
      [parkId, parkId, parkId],
      (e0, basicStats) => {
        if (e0) return res.status(500).json({ error: e0.message });

        let financeQuery = `
          SELECT
            IFNULL(SUM(CASE WHEN bh.type = 'topup' AND (bh.amountType = 'real' OR bh.amountType IS NULL) THEN bh.amount ELSE 0 END), 0) AS topupsReal,
            COUNT(CASE WHEN bh.type = 'topup' AND (bh.amountType = 'real' OR bh.amountType IS NULL) THEN 1 END) AS topupsRealCount,
            IFNULL(SUM(CASE WHEN bh.type = 'topup' AND bh.amountType = 'unreal' THEN bh.amount ELSE 0 END), 0) AS topupsUnreal,
            COUNT(CASE WHEN bh.type = 'topup' AND bh.amountType = 'unreal' THEN 1 END) AS topupsUnrealCount,
            IFNULL(SUM(CASE WHEN bh.type IN ('expense','waybill_fee') AND (bh.amountType = 'real' OR bh.amountType IS NULL) THEN ABS(bh.amount) ELSE 0 END), 0) AS spentReal,
            IFNULL(SUM(CASE WHEN bh.type IN ('expense','waybill_fee') AND bh.amountType = 'unreal' THEN ABS(bh.amount) ELSE 0 END), 0) AS spentUnreal,
            IFNULL(SUM(CASE WHEN bh.type IN ('expense','waybill_fee') THEN ABS(bh.amount) ELSE 0 END), 0) AS spent,
            (SELECT IFNULL(SUM(u2.balanceReal), 0) FROM users u2 JOIN drivers d2 ON u2.id = d2.userId WHERE d2.parkId = ?) AS systemBalanceReal,
            (SELECT IFNULL(SUM(u2.balanceUnreal), 0) FROM users u2 JOIN drivers d2 ON u2.id = d2.userId WHERE d2.parkId = ?) AS systemBalanceUnreal
          FROM balance_history bh
          JOIN users u ON bh.userId = u.id
          JOIN drivers d ON u.id = d.userId
          WHERE d.parkId = ?
        `;
        if (dateFilter) financeQuery += ` AND ${dateFilter}`;

        db.get(financeQuery, [parkId, parkId, parkId], (e1, financeStats) => {
          if (e1) return res.status(500).json({ error: e1.message });

          const eplDateFilter = dateFilter ? dateFilter.replace(/bh\.createdAt/g, 'epl.createdAt') : '';
          const sDateFilter = dateFilter ? dateFilter.replace(/bh\.createdAt/g, 'COALESCE(s.closedAt, s.autoClosedAt)') : '';
          const fcDateFilter = dateFilter ? dateFilter.replace(/bh\.createdAt/g, 'pca.createdAt') : '';
          const bhFilter = dateFilter ? ` AND ${dateFilter}` : '';
          const eplFilter = eplDateFilter ? ` AND ${eplDateFilter}` : '';
          const shiftsFilter = sDateFilter ? ` AND ${sDateFilter}` : '';

          db.get(
            `
            SELECT
              COUNT(*) as eplCount,
              IFNULL(SUM(CASE WHEN bh.type = 'waybill_fee' AND (bh.amountType = 'real' OR bh.amountType IS NULL) THEN ABS(bh.amount) ELSE 0 END), 0) AS eplAmountReal,
              IFNULL(SUM(CASE WHEN bh.type = 'waybill_fee' AND bh.amountType = 'unreal' THEN ABS(bh.amount) ELSE 0 END), 0) AS eplAmountUnreal
            FROM epl epl
            LEFT JOIN drivers d ON epl.driverId = d.id
            LEFT JOIN balance_history bh ON bh.eplId = epl.id
            WHERE epl.parkId = ? ${eplFilter}
            `,
            [parkId],
            (eOps, eplOps) => {
              if (eOps) eplOps = { eplCount: 0, eplAmountReal: 0, eplAmountUnreal: 0 };

              db.get(
                `
                SELECT
                  COUNT(*) as closedShiftsCount,
                  SUM(CASE WHEN s.status = 'auto_closed' THEN 1 ELSE 0 END) as autoClosedShiftsCount,
                  IFNULL(SUM(CASE WHEN s.status = 'auto_closed' AND (bh.amountType = 'real' OR bh.amountType IS NULL) THEN ABS(bh.amount) ELSE 0 END), 0) AS autoCloseReal,
                  IFNULL(SUM(CASE WHEN s.status = 'auto_closed' AND bh.amountType = 'unreal' THEN ABS(bh.amount) ELSE 0 END), 0) AS autoCloseUnreal
                FROM shifts s
                LEFT JOIN balance_history bh ON bh.shiftId = s.id AND bh.type IN ('waybill_fee','expense')
                WHERE s.parkId = ? AND s.status IN ('closed','auto_closed') ${shiftsFilter}
                `,
                [parkId],
                (eSh, shStats) => {
                  if (eSh) shStats = { closedShiftsCount: 0, autoClosedShiftsCount: 0, autoCloseReal: 0, autoCloseUnreal: 0 };
                  const autoCloseAmount = (Number(shStats.autoCloseReal) || 0) + (Number(shStats.autoCloseUnreal) || 0);

                  db.get(
                    `
                    SELECT
                      COUNT(*) as photoControlCount,
                      IFNULL(SUM(CASE WHEN bh.type = 'expense' AND bh.comment LIKE '%фотоконтроль%' THEN ABS(bh.amount) ELSE 0 END), 0) AS photoControlAmount
                    FROM photo_control_applications pca
                    LEFT JOIN balance_history bh ON bh.userId = (SELECT userId FROM drivers WHERE id = pca.driverId) AND bh.type = 'expense'
                    WHERE pca.parkId = ? ${fcDateFilter ? ` AND ${fcDateFilter}` : ''}
                    `,
                    [parkId],
                    (eFc, fcStats) => {
                      if (eFc) fcStats = { photoControlCount: 0, photoControlAmount: 0 };

                      // Новые водители за период
                      let newDriversFilter = '';
                      if (period === 'today') newDriversFilter = getMoscowDateFilter('d.createdAt', today);
                      else if (period === 'yesterday') {
                        const yesterday = new Date(Date.UTC(yy, mm - 1, dd - 1)).toISOString().split('T')[0];
                        newDriversFilter = getMoscowDateFilter('d.createdAt', yesterday);
                      } else if (period === 'since_friday') {
                        const lastFri = getLastFriday(today);
                        newDriversFilter = getMoscowPeriodFilter('d.createdAt', lastFri, today);
                      } else if (period === 'date' && date && /^\d{4}-\d{2}-\d{2}$/.test(date)) newDriversFilter = getMoscowDateFilter('d.createdAt', date);
                      else if (period === 'range' && dateStart && dateEnd && /^\d{4}-\d{2}-\d{2}$/.test(dateStart) && /^\d{4}-\d{2}-\d{2}$/.test(dateEnd)) newDriversFilter = getMoscowPeriodFilter('d.createdAt', dateStart, dateEnd);
                      else if (period === 'week') newDriversFilter = getMoscowPeriodFilter('d.createdAt', new Date(Date.UTC(yy, mm - 1, dd - 7)).toISOString().split('T')[0], today);
                      else if (period === 'month') newDriversFilter = getMoscowPeriodFilter('d.createdAt', new Date(Date.UTC(yy, mm - 1, dd - 30)).toISOString().split('T')[0], today);
                      else newDriversFilter = getMoscowDateFilter('d.createdAt', today);

                      db.get(
                        `SELECT COUNT(*) as newDrivers FROM drivers d WHERE d.parkId = ? AND ${newDriversFilter}`,
                        [parkId],
                        (eNd, newStats) => {
                          if (eNd) newStats = { newDrivers: 0 };
                          res.json({
                            basicStats: basicStats || { users: 0, cars: 0, bindings: 0 },
                            financeStats: financeStats || {},
                            operationsStats: {
                              ...(eplOps || {}),
                              ...(shStats || {}),
                              ...(fcStats || {}),
                              autoCloseAmount,
                              closedShiftsAmount: autoCloseAmount,
                            },
                            newStats: newStats || { newDrivers: 0 },
                            permissions: {
                              showFinance: !!director.statsShowFinance,
                              showEpl: !!director.statsShowEpl,
                              showDrivers: !!director.statsShowDrivers
                            }
                          });
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        });
      }
    );
  });
});

// ===== PHOTO CONTROL (как у менеджера, но с canAccessPhotoControl) =====
function ensureDirectorCanAccessPhotoControl(d, res) {
  if (!d?.canAccessPhotoControl) {
    res.status(403).json({ error: 'Нет доступа к фотоконтролю' });
    return false;
  }
  return true;
}

router.get('/photo-control/applications', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(404).json({ error: 'Not found' });
    if (!ensureDirectorCanAccessPhotoControl(director, res)) return;
    const { status } = req.query;
    let sql = `SELECT a.id, a.driverId, a.carId, a.status, a.approvedAt, a.validUntil, a.rejectReason, a.createdAt,
                u.fullName as driverName, u.phone as driverPhone, c.regNumber
               FROM photo_control_applications a
               JOIN drivers d ON a.driverId = d.id
               JOIN users u ON d.userId = u.id
               LEFT JOIN cars c ON a.carId = c.id
               WHERE a.parkId = ?`;
    const params = [director.parkId];
    if (status === 'pending') sql += ` AND a.status = 'pending'`;
    else if (status === 'past') sql += ` AND a.status IN ('approved','rejected')`;
    sql += ' ORDER BY a.status = \'pending\' DESC, a.createdAt DESC LIMIT 50';
    db.all(sql, params, (e, rows) => {
      if (e) return res.status(500).json({ error: e.message });
      res.json(rows || []);
    });
  });
});

router.get('/photo-control/applications/:id', authenticateToken, authorizeRole('director'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(404).json({ error: 'Not found' });
    if (!ensureDirectorCanAccessPhotoControl(director, res)) return;
    db.get(
      `SELECT a.id, a.driverId, a.carId, a.status, a.approvedAt, a.validUntil, a.rejectReason, a.createdAt, a.updatedAt, a.correctionRequestedAt,
        u.fullName as driverName, u.phone as driverPhone, c.regNumber
       FROM photo_control_applications a
       JOIN drivers d ON a.driverId = d.id
       JOIN users u ON d.userId = u.id
       LEFT JOIN cars c ON a.carId = c.id
       WHERE a.id = ? AND a.parkId = ?`,
      [id, director.parkId],
      (e, app) => {
        if (e || !app) return res.status(404).json({ error: 'Not found' });
        db.all('SELECT stepIndex, mediaType, filePath, managerVerdict, managerComment, reviewedAt, reviewedByUserId FROM photo_control_steps WHERE applicationId = ? ORDER BY stepIndex', [id], (e2, steps) => {
          if (e2) return res.status(500).json({ error: e2.message });
          res.json({ ...app, steps: steps || [] });
        });
      }
    );
  });
});

router.patch('/photo-control/applications/:id/steps', authenticateToken, authorizeRole('director'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { steps: stepsBody } = req.body || {};
  if (!id || !Array.isArray(stepsBody) || stepsBody.length === 0) return res.status(400).json({ error: 'Требуется массив steps: [{ stepIndex, verdict, comment? }]' });
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(404).json({ error: 'Not found' });
    if (!ensureDirectorCanAccessPhotoControl(director, res)) return;
    db.get('SELECT id FROM photo_control_applications WHERE id = ? AND parkId = ? AND status = ?', [id, director.parkId, 'pending'], (e, app) => {
      if (e || !app) return res.status(404).json({ error: 'Not found or not pending' });
      const userId = req.user.userId;
      let done = 0;
      const total = stepsBody.length;
      const onDone = (errX) => {
        if (errX) return res.status(500).json({ error: errX.message });
        done++;
        if (done >= total) res.json({ message: 'Вердикты сохранены.' });
      };
      for (const { stepIndex, verdict, comment } of stepsBody) {
        const si = parseInt(stepIndex, 10);
        if (si < 1 || si > 10) { onDone(null); continue; }
        const v = verdict === 'needs_correction' ? 'needs_correction' : 'ok';
        db.run(
          `UPDATE photo_control_steps SET managerVerdict = ?, managerComment = ?, reviewedAt = datetime('now'), reviewedByUserId = ? WHERE applicationId = ? AND stepIndex = ?`,
          [v, comment || null, userId, id, si],
          (upErr) => { onDone(upErr); }
        );
      }
    });
  });
});

router.patch('/photo-control/applications/:id/request-correction', authenticateToken, authorizeRole('director'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(404).json({ error: 'Not found' });
    if (!ensureDirectorCanAccessPhotoControl(director, res)) return;
    db.get('SELECT id, driverId FROM photo_control_applications WHERE id = ? AND parkId = ? AND status = ?', [id, director.parkId, 'pending'], (e, app) => {
      if (e || !app) return res.status(404).json({ error: 'Not found or not pending' });
      db.all('SELECT stepIndex, managerVerdict FROM photo_control_steps WHERE applicationId = ?', [id], (e2, steps) => {
        if (e2) return res.status(500).json({ error: e2.message });
        const needsCount = (steps || []).filter((s) => s.managerVerdict === 'needs_correction').length;
        if (needsCount === 0) return res.status(400).json({ error: 'Отметьте хотя бы один шаг «На доработку».' });
        db.run(
          `UPDATE photo_control_applications SET correctionRequestedAt = datetime('now'), updatedAt = datetime('now') WHERE id = ?`,
          [id],
          (upErr) => {
            if (upErr) return res.status(500).json({ error: upErr.message });
            db.get('SELECT userId FROM drivers WHERE id = ?', [app.driverId], (e3, dr) => {
              if (!e3 && dr?.userId) {
                const stepNums = (steps || []).filter((s) => s.managerVerdict === 'needs_correction').map((s) => s.stepIndex).sort((a, b) => a - b);
                const body = `Требуется доработка шагов: ${stepNums.join(', ')}. Перезагрузите фото/видео в заявке на фотоконтроль.`;
                db.run('INSERT INTO notifications (userId, type, title, body) VALUES (?, ?, ?, ?)', [dr.userId, 'photo_control_correction', 'Фотоконтроль: на доработку', body], () => {});
              }
              res.json({ message: 'Водителю отправлено уведомление о доработке.' });
            });
          }
        );
      });
    });
  });
});

router.patch('/photo-control/applications/:id/approve', authenticateToken, authorizeRole('director'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(404).json({ error: 'Not found' });
    if (!ensureDirectorCanAccessPhotoControl(director, res)) return;
    db.get('SELECT id FROM photo_control_applications WHERE id = ? AND parkId = ? AND status = ?', [id, director.parkId, 'pending'], (e, app) => {
      if (e || !app) return res.status(404).json({ error: 'Not found or not pending' });
      db.all('SELECT stepIndex, managerVerdict FROM photo_control_steps WHERE applicationId = ?', [id], (eSteps, steps) => {
        if (eSteps) return res.status(500).json({ error: eSteps.message });
        const allOk = steps && steps.length === 10 && steps.every((s) => s.managerVerdict === 'ok');
        if (!allOk) return res.status(400).json({ error: 'Одобрить можно только когда все 10 шагов отмечены «Норм».' });
        db.get('SELECT validDays FROM park_photo_control_settings WHERE parkId = ?', [director.parkId], (e2, settings) => {
          const days = (settings && Number(settings.validDays)) || 10;
          const validUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
          db.run(
            `UPDATE photo_control_applications SET status = 'approved', approvedAt = datetime('now'), approvedByUserId = ?, validUntil = ?, correctionRequestedAt = NULL, updatedAt = datetime('now') WHERE id = ?`,
            [req.user.userId, validUntil, id],
            (upErr) => {
              if (upErr) return res.status(500).json({ error: upErr.message });
              res.json({ status: 'approved', validUntil, message: 'Фотоконтроль подтверждён.' });
            }
          );
        });
      });
    });
  });
});

router.patch('/photo-control/applications/:id/reject', authenticateToken, authorizeRole('director'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { reason } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(404).json({ error: 'Not found' });
    if (!ensureDirectorCanAccessPhotoControl(director, res)) return;
    db.get('SELECT id FROM photo_control_applications WHERE id = ? AND parkId = ? AND status = ?', [id, director.parkId, 'pending'], (e, app) => {
      if (e || !app) return res.status(404).json({ error: 'Not found or not pending' });
      db.run(
        `UPDATE photo_control_applications SET status = 'rejected', rejectReason = ?, updatedAt = datetime('now') WHERE id = ?`,
        [reason || 'Отклонено', id],
        (upErr) => {
          if (upErr) return res.status(500).json({ error: upErr.message });
          res.json({ status: 'rejected', message: 'Заявка отклонена.' });
        }
      );
    });
  });
});

router.get('/photo-control/me', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(404).json({ error: 'Not found' });
    res.json({ parkId: director.parkId, managerType: 'park' });
  });
});

router.get('/photo-control/applications/:id/steps/:stepIndex/file', authenticateToken, authorizeRole('director'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const stepIndex = parseInt(req.params.stepIndex, 10);
  if (!id || stepIndex < 1 || stepIndex > 10) return res.status(400).end();
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(404).end();
    if (!ensureDirectorCanAccessPhotoControl(director, res)) return;
    db.get('SELECT id FROM photo_control_applications WHERE id = ? AND parkId = ?', [id, director.parkId], (e, app) => {
      if (e || !app) return res.status(404).end();
      db.get('SELECT filePath FROM photo_control_steps WHERE applicationId = ? AND stepIndex = ?', [id, stepIndex], (e2, step) => {
        if (e2 || !step?.filePath) return res.status(404).end();
        const fullPath = path.join(__dirname, '..', 'uploads', step.filePath);
        if (!fs.existsSync(fullPath)) return res.status(404).end();
        const ext = path.extname(fullPath);
        res.setHeader('Content-Type', ext === '.mp4' ? 'video/mp4' : 'image/jpeg');
        fs.createReadStream(fullPath).pipe(res);
      });
    });
  });
});

// ===== Точки выгрузки / «магазины» (как у менеджера, parkId из query или JWT) =====

router.get('/freight-stores', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Доступ запрещён' });
    if (!ensureParkSettingsSectionAccess(director, res, 'canParkSettingsFreight', 'Нет доступа к точкам выгрузки')) return;
    const parkId = director.parkId;
    db.all(
      `SELECT id, parkId, name, addressText, contactNote, sortOrder, isActive, createdAt
       FROM park_freight_stores WHERE parkId = ? ORDER BY sortOrder ASC, id ASC`,
      [parkId],
      (e2, rows) => {
        if (e2) return res.status(500).json({ error: e2.message });
        res.json(rows || []);
      }
    );
  });
});

router.post('/freight-stores', authenticateToken, authorizeRole('director'), (req, res) => {
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Доступ запрещён' });
    if (!ensureParkSettingsSectionAccess(director, res, 'canParkSettingsFreight', 'Нет доступа к точкам выгрузки')) return;
    const parkId = director.parkId;
    const { name, addressText, contactNote, sortOrder, isActive } = req.body || {};
    const n = String(name || '').trim();
    const a = String(addressText || '').trim();
    if (!n || !a) return res.status(400).json({ error: 'Укажите название и адрес' });
    const so = sortOrder != null && !Number.isNaN(Number(sortOrder)) ? Math.floor(Number(sortOrder)) : 0;
    const act = isActive === false || isActive === 0 ? 0 : 1;
    db.run(
      `INSERT INTO park_freight_stores (parkId, name, addressText, contactNote, sortOrder, isActive)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [parkId, n, a, contactNote != null ? String(contactNote).trim() : null, so, act],
      function (insErr) {
        if (insErr) return res.status(500).json({ error: insErr.message });
        res.status(201).json({
          id: this.lastID,
          parkId,
          name: n,
          addressText: a,
          contactNote: contactNote != null ? String(contactNote).trim() : null,
          sortOrder: so,
          isActive: act,
        });
      }
    );
  });
});

router.put('/freight-stores/:storeId', authenticateToken, authorizeRole('director'), (req, res) => {
  const storeId = parseInt(req.params.storeId, 10);
  if (!storeId) return res.status(400).json({ error: 'Некорректный storeId' });
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Доступ запрещён' });
    if (!ensureParkSettingsSectionAccess(director, res, 'canParkSettingsFreight', 'Нет доступа к точкам выгрузки')) return;
    const parkId = director.parkId;
    const { name, addressText, contactNote, sortOrder, isActive } = req.body || {};
    const parts = [];
    const vals = [];
    if (name !== undefined) {
      parts.push('name = ?');
      vals.push(String(name).trim());
    }
    if (addressText !== undefined) {
      parts.push('addressText = ?');
      vals.push(String(addressText).trim());
    }
    if (contactNote !== undefined) {
      parts.push('contactNote = ?');
      vals.push(contactNote ? String(contactNote).trim() : null);
    }
    if (sortOrder !== undefined) {
      parts.push('sortOrder = ?');
      vals.push(Math.floor(Number(sortOrder)) || 0);
    }
    if (isActive !== undefined) {
      parts.push('isActive = ?');
      vals.push(isActive === false || isActive === 0 ? 0 : 1);
    }
    if (parts.length === 0) return res.status(400).json({ error: 'Нет полей для обновления' });
    vals.push(storeId, parkId);
    db.run(
      `UPDATE park_freight_stores SET ${parts.join(', ')} WHERE id = ? AND parkId = ?`,
      vals,
      function (uErr) {
        if (uErr) return res.status(500).json({ error: uErr.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Запись не найдена' });
        res.json({ success: true });
      }
    );
  });
});

router.delete('/freight-stores/:storeId', authenticateToken, authorizeRole('director'), (req, res) => {
  const storeId = parseInt(req.params.storeId, 10);
  if (!storeId) return res.status(400).json({ error: 'Некорректный storeId' });
  getDirectorPark(req, (err, director) => {
    if (err || !director) return res.status(403).json({ error: 'Доступ запрещён' });
    if (!ensureParkSettingsSectionAccess(director, res, 'canParkSettingsFreight', 'Нет доступа к точкам выгрузки')) return;
    const parkId = director.parkId;
    db.run(`DELETE FROM park_freight_stores WHERE id = ? AND parkId = ?`, [storeId, parkId], function (dErr) {
      if (dErr) return res.status(500).json({ error: dErr.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Запись не найдена' });
      res.json({ success: true });
    });
  });
});

module.exports = router;

