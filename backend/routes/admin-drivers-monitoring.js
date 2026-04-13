const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken, authorizeRole } = require('../auth');

// GET /api/admin/drivers/monitoring
// Query:
// - parkId (optional)
// - category: 'inactive_no_epl' | 'low_balance' | 'no_car'
// - days (for inactive_no_epl, default 7)
// - balanceLt (for low_balance, default 200)
// - q (optional): search by fullName/phone
// - accountAge: 'all' | '1-7' | '8-30' | '30+' (age in days based on u.createdAt)
// - limit (optional, default 100, max 500)
// - offset (optional, default 0)
router.get('/drivers/monitoring', authenticateToken, authorizeRole('admin'), (req, res) => {
  const parkIdRaw = req.query?.parkId;
  const category = String(req.query?.category || 'inactive_no_epl');
  const days = Math.max(1, Math.min(365, parseInt(req.query?.days || '7', 10) || 7));
  const balanceLt = Math.max(0, Number(req.query?.balanceLt ?? 200) || 200);
  const q = (req.query?.q != null ? String(req.query.q) : '').trim();
  const accountAge = String(req.query?.accountAge || 'all');
  const limit = Math.max(1, Math.min(500, parseInt(req.query?.limit || '100', 10) || 100));
  const offset = Math.max(0, parseInt(req.query?.offset || '0', 10) || 0);

  const parkId = parkIdRaw ? parseInt(String(parkIdRaw), 10) : null;
  const where = [];
  const params = [];
  if (parkId && !Number.isNaN(parkId)) {
    where.push('d.parkId = ?');
    params.push(parkId);
  }
  if (q) {
    // Поиск по ФИО / телефону (простая LIKE, достаточно быстрая при индексе/объёмах до нескольких тыс.)
    where.push('(LOWER(COALESCE(u.fullName, \'\')) LIKE ? OR LOWER(COALESCE(u.phone, \'\')) LIKE ?)');
    const like = `%${q.toLowerCase()}%`;
    params.push(like, like);
  }

  if (accountAge !== 'all') {
    // Age in days = julianday('now') - julianday(u.createdAt)
    if (accountAge === '1-7') {
      where.push('(julianday(\'now\') - julianday(u.createdAt)) <= 7');
    } else if (accountAge === '8-30') {
      where.push('(julianday(\'now\') - julianday(u.createdAt)) > 7 AND (julianday(\'now\') - julianday(u.createdAt)) <= 30');
    } else if (accountAge === '30+') {
      where.push('(julianday(\'now\') - julianday(u.createdAt)) > 30');
    }
  }

  // Аггрегаты по ЭПЛ одним проходом (без N+1 сабкверей)
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
      u.createdAt as registeredAt,
      COALESCE(u.innMutationApplied, 0) as innMutationApplied,
      (COALESCE(u.balanceReal,0) + COALESCE(u.balanceUnreal,0)) as balance,
      a.lastEplAt as lastEplAt,
      COALESCE(a.epl7d, 0) as epl7d,
      COALESCE(a.epl30d, 0) as epl30d
    FROM drivers d
    JOIN users u ON u.id = d.userId
    LEFT JOIN parks p ON p.id = d.parkId
    LEFT JOIN epl_agg a ON a.driverId = d.id
  `;

  const afterWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';

  let finalWhere = afterWhere;
  if (category === 'low_balance') {
    const cond = `(COALESCE(u.balanceReal,0) + COALESCE(u.balanceUnreal,0)) < ?`;
    finalWhere = finalWhere ? `${finalWhere} AND ${cond}` : `WHERE ${cond}`;
    params.push(balanceLt);
  } else if (category === 'no_car') {
    const cond = `(d.carId IS NULL OR d.carId = '')`;
    finalWhere = finalWhere ? `${finalWhere} AND ${cond}` : `WHERE ${cond}`;
  } else {
    // inactive_no_epl
    // no EPL ever OR lastEplAt older than N days
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

  const listSql = `
    ${baseSql}
    ${finalWhere}
    ${orderSql}
    LIMIT ? OFFSET ?
  `;

  const countSql = `
    ${baseSql}
    ${finalWhere}
  `;

  const countParams = [...params];
  const dataParams = [...params, limit, offset];

  const countWrappedSql = `
    SELECT COUNT(*) as total FROM (${countSql})
  `;

  db.get(countWrappedSql, countParams, (cErr, cRow) => {
    if (cErr) return res.status(500).json({ error: cErr.message });
    const total = cRow?.total != null ? Number(cRow.total) : 0;
    db.all(listSql, dataParams, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        category,
        parkId: parkId && !Number.isNaN(parkId) ? parkId : null,
        days,
        balanceLt,
        q: q || '',
        limit,
        offset,
        total,
        items: rows || []
      });
    });
  });
});

// GET /api/admin/drivers/monitoring/ids
// То же, что monitoring, но возвращает только userIds (для "выбрать весь список" без прогрузов).
// Query: parkId, category, days, balanceLt, q, accountAge
router.get('/drivers/monitoring/ids', authenticateToken, authorizeRole('admin'), (req, res) => {
  const parkIdRaw = req.query?.parkId;
  const category = String(req.query?.category || 'inactive_no_epl');
  const days = Math.max(1, Math.min(365, parseInt(req.query?.days || '7', 10) || 7));
  const balanceLt = Math.max(0, Number(req.query?.balanceLt ?? 200) || 200);
  const q = (req.query?.q != null ? String(req.query.q) : '').trim();
  const accountAge = String(req.query?.accountAge || 'all');

  const MAX_IDS = Math.max(100, Math.min(10000, parseInt(process.env.ADMIN_MONITORING_MAX_IDS || '5000', 10) || 5000));

  const parkId = parkIdRaw ? parseInt(String(parkIdRaw), 10) : null;
  const where = [];
  const params = [];
  if (parkId && !Number.isNaN(parkId)) {
    where.push('d.parkId = ?');
    params.push(parkId);
  }
  if (q) {
    where.push('(LOWER(COALESCE(u.fullName, \'\')) LIKE ? OR LOWER(COALESCE(u.phone, \'\')) LIKE ?)');
    const like = `%${q.toLowerCase()}%`;
    params.push(like, like);
  }

  if (accountAge !== 'all') {
    if (accountAge === '1-7') {
      where.push('(julianday(\'now\') - julianday(u.createdAt)) <= 7');
    } else if (accountAge === '8-30') {
      where.push('(julianday(\'now\') - julianday(u.createdAt)) > 7 AND (julianday(\'now\') - julianday(u.createdAt)) <= 30');
    } else if (accountAge === '30+') {
      where.push('(julianday(\'now\') - julianday(u.createdAt)) > 30');
    }
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
    SELECT d.userId as userId, a.lastEplAt as lastEplAt, (COALESCE(u.balanceReal,0) + COALESCE(u.balanceUnreal,0)) as balance
    FROM drivers d
    JOIN users u ON u.id = d.userId
    LEFT JOIN epl_agg a ON a.driverId = d.id
  `;

  const afterWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
  let finalWhere = afterWhere;
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

  const idsSql = `
    ${baseSql}
    ${finalWhere}
    ORDER BY
      CASE WHEN lastEplAt IS NULL THEN 0 ELSE 1 END ASC,
      lastEplAt ASC,
      balance ASC
    LIMIT ?
  `;

  db.all(idsSql, [...params, MAX_IDS], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const ids = (rows || []).map((r) => parseInt(String(r.userId), 10)).filter((n) => n && !Number.isNaN(n));
    res.json({ ids, truncated: ids.length >= MAX_IDS, max: MAX_IDS });
  });
});

module.exports = router;

// ===== Рассылки (уведомления на сайте) =====

router.post('/drivers/broadcast', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { userIds, title, body } = req.body || {};
  const ids = Array.isArray(userIds) ? userIds.map((x) => parseInt(String(x), 10)).filter((n) => n && !Number.isNaN(n)) : [];
  const t = (title != null ? String(title) : '').trim();
  const b = (body != null ? String(body) : '').trim();
  if (ids.length === 0) return res.status(400).json({ error: 'Выберите водителей' });
  if (!b) return res.status(400).json({ error: 'Текст уведомления обязателен' });

  const stmt = db.prepare('INSERT INTO notifications (userId, type, title, body) VALUES (?, ?, ?, ?)');
  ids.forEach((id) => stmt.run(id, 'admin_broadcast', t || 'Сообщение от администрации', b));
  stmt.finalize((err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, sent: ids.length });
  });
});

router.get('/broadcast-templates', authenticateToken, authorizeRole('admin'), (req, res) => {
  db.all('SELECT id, title, body, createdAt, updatedAt FROM admin_broadcast_templates ORDER BY updatedAt DESC, id DESC LIMIT 200', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

router.post('/broadcast-templates', authenticateToken, authorizeRole('admin'), (req, res) => {
  const title = (req.body?.title != null ? String(req.body.title) : '').trim();
  const body = (req.body?.body != null ? String(req.body.body) : '').trim();
  if (!title) return res.status(400).json({ error: 'Укажите название' });
  if (!body) return res.status(400).json({ error: 'Укажите текст' });
  db.run(
    'INSERT INTO admin_broadcast_templates (title, body, createdAt, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
    [title, body],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ id: this.lastID, title, body });
    }
  );
});

router.put('/broadcast-templates/:id', authenticateToken, authorizeRole('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const title = (req.body?.title != null ? String(req.body.title) : '').trim();
  const body = (req.body?.body != null ? String(req.body.body) : '').trim();
  if (!title) return res.status(400).json({ error: 'Укажите название' });
  if (!body) return res.status(400).json({ error: 'Укажите текст' });
  db.run(
    'UPDATE admin_broadcast_templates SET title = ?, body = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
    [title, body, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Не найдено' });
      res.json({ success: true });
    }
  );
});

router.delete('/broadcast-templates/:id', authenticateToken, authorizeRole('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  db.run('DELETE FROM admin_broadcast_templates WHERE id = ?', [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: this.changes > 0 });
  });
});

