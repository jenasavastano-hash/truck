/**
 * Статистика для админки: агрегат по всем паркам и по одному парку.
 * Подробное описание каждого показателя (откуда берётся, как считается, каждая копейка):
 * см. docs/СТАТИСТИКА-КАЖДЫЙ-ПУНКТ.md
 */
const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken, authorizeRole } = require('../auth');
const { getMoscowDate, getMoscowDateFilter, getMoscowPeriodFilter, getLastFriday } = require('../utils/moscow-time');

// Нормализация query: period и даты из строки (trim)
function normQuery(q) {
  const period = (q.period && String(q.period).trim()) || 'today';
  const date = q.date && String(q.date).trim();
  const dateStart = q.dateStart && String(q.dateStart).trim();
  const dateEnd = q.dateEnd && String(q.dateEnd).trim();
  return { period, date: date || null, dateStart: dateStart || null, dateEnd: dateEnd || null };
}

// Общая статистика по ВСЕМ паркам (без фильтра по isActive)
router.get('/statistics/aggregate', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { period, date, dateStart, dateEnd } = normQuery(req.query);
  console.log(`[Statistics] Aggregate stats, period: ${period}, date: ${date}, dateStart: ${dateStart}, dateEnd: ${dateEnd}`);

  let dateFilter = '';
  const moscowToday = getMoscowDate();
  const [y, m, day] = moscowToday.split('-').map(Number);
  if (period === 'today') {
    dateFilter = getMoscowDateFilter('bh.createdAt', moscowToday);
  } else if (period === 'yesterday') {
    const yesterday = new Date(Date.UTC(y, m - 1, day - 1)).toISOString().split('T')[0];
    dateFilter = getMoscowDateFilter('bh.createdAt', yesterday);
  } else if (period === 'since_friday') {
    const lastFri = getLastFriday(moscowToday);
    dateFilter = getMoscowPeriodFilter('bh.createdAt', lastFri, moscowToday);
  } else if (period === 'date' && date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    dateFilter = getMoscowDateFilter('bh.createdAt', date);
  } else if (period === 'range' && dateStart && dateEnd && /^\d{4}-\d{2}-\d{2}$/.test(dateStart) && /^\d{4}-\d{2}-\d{2}$/.test(dateEnd)) {
    dateFilter = getMoscowPeriodFilter('bh.createdAt', dateStart, dateEnd);
  } else if (period === 'week') {
    const weekAgo = new Date(Date.UTC(y, m - 1, day - 7)).toISOString().split('T')[0];
    dateFilter = getMoscowPeriodFilter('bh.createdAt', weekAgo, moscowToday);
  } else if (period === 'month') {
    const monthAgo = new Date(Date.UTC(y, m - 1, day - 30)).toISOString().split('T')[0];
    dateFilter = getMoscowPeriodFilter('bh.createdAt', monthAgo, moscowToday);
  } else {
    dateFilter = getMoscowDateFilter('bh.createdAt', moscowToday);
  }

  db.get(`
    SELECT
      (SELECT COUNT(DISTINCT d.id) FROM drivers d) as users,
      (SELECT COUNT(DISTINCT c.id) FROM cars c) as cars,
      (SELECT COUNT(DISTINCT d.id) FROM drivers d WHERE d.carId IS NOT NULL) as bindings
  `, [], (err, basicStats) => {
    if (err) return res.status(500).json({ error: err.message });

    let financeQuery = `
      SELECT
        IFNULL(SUM(CASE WHEN bh.type = 'topup' AND (bh.amountType = 'real' OR bh.amountType IS NULL) THEN bh.amount ELSE 0 END), 0) AS topupsReal,
        COUNT(CASE WHEN bh.type = 'topup' AND (bh.amountType = 'real' OR bh.amountType IS NULL) THEN 1 END) AS topupsRealCount,
        IFNULL(SUM(CASE WHEN bh.type = 'topup' AND bh.amountType = 'unreal' THEN bh.amount ELSE 0 END), 0) AS topupsUnreal,
        COUNT(CASE WHEN bh.type = 'topup' AND bh.amountType = 'unreal' THEN 1 END) AS topupsUnrealCount,
        IFNULL(SUM(CASE WHEN bh.type IN ('expense','waybill_fee') AND (bh.amountType = 'real' OR bh.amountType IS NULL) THEN ABS(bh.amount) ELSE 0 END), 0) AS spentReal,
        IFNULL(SUM(CASE WHEN bh.type IN ('expense','waybill_fee') AND bh.amountType = 'unreal' THEN ABS(bh.amount) ELSE 0 END), 0) AS spentUnreal,
        IFNULL(SUM(CASE WHEN bh.type IN ('expense','waybill_fee') THEN ABS(bh.amount) ELSE 0 END), 0) AS spent,
        (SELECT IFNULL(SUM(u2.balanceReal), 0) FROM users u2 JOIN drivers d2 ON u2.id = d2.userId) AS systemBalanceReal,
        (SELECT IFNULL(SUM(u2.balanceUnreal), 0) FROM users u2 JOIN drivers d2 ON u2.id = d2.userId) AS systemBalanceUnreal
      FROM balance_history bh
      JOIN users u ON bh.userId = u.id
      JOIN drivers d ON u.id = d.userId
    `;
    if (dateFilter) financeQuery += ` WHERE ${dateFilter}`;

    db.get(financeQuery, [], (err, financeStats) => {
      if (err) return res.status(500).json({ error: err.message });

      // Подзапросы вместо JOIN — избегаем декартова произведения (6 ЭПЛ × 6 waybill_fee = 36× завышение)
      const eplDateFilter = dateFilter ? dateFilter.replace(/bh\.createdAt/g, 'epl.createdAt') : '';
      const sDateFilter = dateFilter ? dateFilter.replace(/bh\.createdAt/g, 'COALESCE(s.closedAt, s.autoClosedAt)') : '';
      const fcDateFilter = dateFilter ? dateFilter.replace(/bh\.createdAt/g, 'pca.createdAt') : '';
      const evacDateFilter = dateFilter ? dateFilter.replace(/bh\.createdAt/g, 'er.createdAt') : '';
      const bhFilter = dateFilter ? ` AND ${dateFilter}` : '';
      const eplFilter = eplDateFilter ? ` AND ${eplDateFilter}` : '';
      const shiftsFilter = sDateFilter ? ` AND ${sDateFilter}` : '';
      const evacFilter = evacDateFilter ? ` WHERE ${evacDateFilter}` : '';
      let operationsQuery = `
        SELECT
          (SELECT COUNT(DISTINCT epl.id) FROM drivers d LEFT JOIN epl ON epl.driverId = d.id AND epl.parkId = d.parkId${eplFilter}) as eplCount,
          (SELECT IFNULL(SUM(ABS(bh.amount)), 0) FROM balance_history bh JOIN users u ON bh.userId = u.id JOIN drivers d ON u.id = d.userId WHERE bh.type = 'waybill_fee'${bhFilter}) as eplAmount,
          (SELECT IFNULL(SUM(CASE WHEN bh.amountType = 'real' OR bh.amountType IS NULL THEN ABS(bh.amount) ELSE 0 END), 0) FROM balance_history bh JOIN users u ON bh.userId = u.id JOIN drivers d ON u.id = d.userId WHERE bh.type = 'waybill_fee'${bhFilter}) as eplAmountReal,
          (SELECT IFNULL(SUM(CASE WHEN bh.amountType = 'unreal' THEN ABS(bh.amount) ELSE 0 END), 0) FROM balance_history bh JOIN users u ON bh.userId = u.id JOIN drivers d ON u.id = d.userId WHERE bh.type = 'waybill_fee'${bhFilter}) as eplAmountUnreal,
          (SELECT COUNT(*) FROM photo_control_applications pca${fcDateFilter ? ` WHERE ${fcDateFilter}` : ''}) as photoControlCount,
          (SELECT IFNULL(SUM(ABS(bh.amount)), 0) FROM balance_history bh JOIN users u ON bh.userId = u.id JOIN drivers d ON u.id = d.userId WHERE bh.type = 'expense' AND bh.description LIKE '%Фотоконтроль%'${bhFilter}) as photoControlAmount,
          (SELECT IFNULL(SUM(ABS(bh.amount)), 0) FROM balance_history bh JOIN users u ON bh.userId = u.id JOIN drivers d ON u.id = d.userId WHERE bh.type = 'expense' AND bh.description LIKE '%Магазин игры%'${bhFilter}) as gameSpent,
          (SELECT COUNT(DISTINCT s.id) FROM drivers d LEFT JOIN shifts s ON s.driverId = d.userId AND s.parkId = d.parkId AND s.status IN ('closed', 'auto_closed')${shiftsFilter}) as closedShiftsCount,
          (SELECT COUNT(DISTINCT s.id) FROM drivers d LEFT JOIN shifts s ON s.driverId = d.userId AND s.parkId = d.parkId AND s.status = 'auto_closed'${shiftsFilter}) as autoClosedShiftsCount,
          (SELECT COUNT(*) FROM evacuator_requests er${evacFilter}) as evacuatorRequestsCount,
          (SELECT IFNULL(SUM(COALESCE(er.requestFeeAmount, 0)), 0) FROM evacuator_requests er${evacFilter}) as evacuatorRequestsAmount
      `;

      db.get(operationsQuery, [], (err, operationsStats) => {
        if (err) return res.status(500).json({ error: err.message });

        let autoCloseQuery = `
          SELECT
            IFNULL(SUM(CASE WHEN bh.type = 'expense' AND bh.description LIKE '%Автозакрытие%' AND (bh.amountType = 'real' OR bh.amountType IS NULL) THEN ABS(bh.amount) ELSE 0 END), 0) AS autoCloseReal,
            IFNULL(SUM(CASE WHEN bh.type = 'expense' AND bh.description LIKE '%Автозакрытие%' AND bh.amountType = 'unreal' THEN ABS(bh.amount) ELSE 0 END), 0) AS autoCloseUnreal
          FROM balance_history bh
          JOIN users u ON bh.userId = u.id
          JOIN drivers d ON u.id = d.userId
        `;
        if (dateFilter) autoCloseQuery += ` WHERE ${dateFilter}`;

        db.get(autoCloseQuery, [], (err, autoCloseStats) => {
          const autoCloseAmount = ((autoCloseStats?.autoCloseReal || 0) + (autoCloseStats?.autoCloseUnreal || 0));
          const result = {
            ...(basicStats || {}),
            ...(financeStats || {}),
            ...(operationsStats || {}),
            ...(autoCloseStats || {}),
            autoCloseAmount,
            closedShiftsAmount: autoCloseAmount,
            newDriversCount: 0,
            newBindingsCount: 0,
            forecast: Math.floor(((financeStats || {}).systemBalanceReal || 0) / Math.max(((financeStats || {}).spent || 1) / 30, 1)),
            aggregateAll: true
          };
          res.json(result);
        });
      });
    });
  });
});

// Статистика парка
router.get('/parks/:parkId/statistics', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { parkId } = req.params;
  const { period, date, dateStart, dateEnd } = normQuery(req.query);

  console.log(`[Statistics] Park ${parkId}, period: ${period}, date: ${date}, dateStart: ${dateStart}, dateEnd: ${dateEnd}`);

  // Если парк неактивен — статистика не считается, возвращаем нули
  db.get('SELECT isActive FROM parks WHERE id = ?', [parkId], (checkErr, parkRow) => {
    if (checkErr) return res.status(500).json({ error: checkErr.message });
    if (!parkRow) return res.status(404).json({ error: 'Park not found' });
    if (!parkRow.isActive) {
      return res.json({
        basicStats: { users: 0, cars: 0, bindings: 0 },
        financeStats: { topupsReal: 0, topupsRealCount: 0, topupsUnreal: 0, topupsUnrealCount: 0, spentReal: 0, spentUnreal: 0, spent: 0, systemBalanceReal: 0, systemBalanceUnreal: 0 },
        operationsStats: { eplCount: 0, eplAmount: 0, eplAmountReal: 0, eplAmountUnreal: 0, photoControlCount: 0, photoControlAmount: 0, gameSpentReal: 0, gameSpentUnreal: 0, gameSpentMagnet: 0, gameSpentNitro: 0, gameSpentJump: 0, gameSpentExtraLife: 0, doubleCoinsSpent: 0, closedShiftsCount: 0, autoClosedShiftsCount: 0, closedShiftsAmount: 0 },
        autoCloseStats: { autoCloseReal: 0, autoCloseUnreal: 0 },
        gameSpent: 0,
        newStats: { newDrivers: 0 },
        parkInactive: true
      });
    }

  // Определяем фильтр по дате (по МСК)
  let dateFilter = '';
  const moscowToday = getMoscowDate();
  const [year, month, day] = moscowToday.split('-').map(Number);
  if (period === 'today') {
    dateFilter = getMoscowDateFilter('bh.createdAt', moscowToday);
  } else if (period === 'yesterday') {
    const yesterday = new Date(Date.UTC(year, month - 1, day - 1)).toISOString().split('T')[0];
    dateFilter = getMoscowDateFilter('bh.createdAt', yesterday);
  } else if (period === 'since_friday') {
    const lastFri = getLastFriday(moscowToday);
    dateFilter = getMoscowPeriodFilter('bh.createdAt', lastFri, moscowToday);
  } else if (period === 'date' && date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    dateFilter = getMoscowDateFilter('bh.createdAt', date);
  } else if (period === 'range' && dateStart && dateEnd && /^\d{4}-\d{2}-\d{2}$/.test(dateStart) && /^\d{4}-\d{2}-\d{2}$/.test(dateEnd)) {
    dateFilter = getMoscowPeriodFilter('bh.createdAt', dateStart, dateEnd);
  } else if (period === 'week') {
    const weekAgo = new Date(Date.UTC(year, month - 1, day - 7)).toISOString().split('T')[0];
    dateFilter = getMoscowPeriodFilter('bh.createdAt', weekAgo, moscowToday);
  } else if (period === 'month') {
    const monthAgo = new Date(Date.UTC(year, month - 1, day - 30)).toISOString().split('T')[0];
    dateFilter = getMoscowPeriodFilter('bh.createdAt', monthAgo, moscowToday);
  } else {
    dateFilter = getMoscowDateFilter('bh.createdAt', moscowToday);
  }

  // Основные метрики
  // ВАЖНО: users = количество водителей (drivers), cars = все машины парка, bindings = водители с привязанными авто
  db.get(`
    SELECT 
      (SELECT COUNT(DISTINCT d.id) FROM drivers d WHERE d.parkId = ?) as users,
      (SELECT COUNT(DISTINCT c.id) FROM cars c WHERE c.parkId = ?) as cars,
      (SELECT COUNT(DISTINCT d.id) FROM drivers d WHERE d.parkId = ? AND d.carId IS NOT NULL) as bindings
  `, [parkId, parkId, parkId], (err, basicStats) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    // Финансы за период
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
    if (dateFilter) {
      financeQuery += ` AND ${dateFilter}`;
    }
    db.get(financeQuery, [parkId, parkId, parkId], (err, financeStats) => {
      if (err) {
        console.error('[Statistics] Finance query error:', err);
        return res.status(500).json({ error: err.message });
      }

      // Операции за период — подзапросы вместо JOIN (избегаем декартова произведения)
      const eplDateFilter = dateFilter ? dateFilter.replace(/bh\.createdAt/g, 'epl.createdAt') : '';
      const sDateFilter = dateFilter ? dateFilter.replace(/bh\.createdAt/g, 'COALESCE(s.closedAt, s.autoClosedAt)') : '';
      const fcDateFilter = dateFilter ? dateFilter.replace(/bh\.createdAt/g, 'pca.createdAt') : '';
      const evacDateFilter = dateFilter ? dateFilter.replace(/bh\.createdAt/g, 'er.createdAt') : '';
      const bhFilter = dateFilter ? ` AND ${dateFilter}` : '';
      const eplFilter = eplDateFilter ? ` AND ${eplDateFilter}` : '';
      const shiftsFilter = sDateFilter ? ` AND ${sDateFilter}` : '';
      const evacFilter = evacDateFilter ? ` AND ${evacDateFilter}` : '';
      let operationsQuery = `
        SELECT
          (SELECT COUNT(DISTINCT epl.id) FROM drivers d LEFT JOIN epl ON epl.driverId = d.id AND epl.parkId = d.parkId WHERE d.parkId = ?${eplFilter}) as eplCount,
          (SELECT IFNULL(SUM(ABS(bh.amount)), 0) FROM balance_history bh JOIN users u ON bh.userId = u.id JOIN drivers d ON u.id = d.userId WHERE bh.type = 'waybill_fee' AND d.parkId = ?${bhFilter}) as eplAmount,
          (SELECT IFNULL(SUM(CASE WHEN bh.amountType = 'real' OR bh.amountType IS NULL THEN ABS(bh.amount) ELSE 0 END), 0) FROM balance_history bh JOIN users u ON bh.userId = u.id JOIN drivers d ON u.id = d.userId WHERE bh.type = 'waybill_fee' AND d.parkId = ?${bhFilter}) as eplAmountReal,
          (SELECT IFNULL(SUM(CASE WHEN bh.amountType = 'unreal' THEN ABS(bh.amount) ELSE 0 END), 0) FROM balance_history bh JOIN users u ON bh.userId = u.id JOIN drivers d ON u.id = d.userId WHERE bh.type = 'waybill_fee' AND d.parkId = ?${bhFilter}) as eplAmountUnreal,
          (SELECT COUNT(*) FROM photo_control_applications pca WHERE pca.parkId = ?${fcDateFilter ? ` AND ${fcDateFilter}` : ''}) as photoControlCount,
          (SELECT IFNULL(SUM(ABS(bh.amount)), 0) FROM balance_history bh JOIN users u ON bh.userId = u.id JOIN drivers d ON u.id = d.userId WHERE d.parkId = ? AND bh.type = 'expense' AND bh.description LIKE '%Фотоконтроль%'${bhFilter}) as photoControlAmount,
          (SELECT IFNULL(SUM(CASE WHEN bh.amountType = 'real' OR bh.amountType IS NULL THEN ABS(bh.amount) ELSE 0 END), 0) FROM balance_history bh JOIN users u ON bh.userId = u.id JOIN drivers d ON u.id = d.userId WHERE d.parkId = ? AND bh.type = 'expense' AND bh.description LIKE '%Магазин игры%'${bhFilter}) as gameSpentReal,
          (SELECT IFNULL(SUM(CASE WHEN bh.amountType = 'unreal' THEN ABS(bh.amount) ELSE 0 END), 0) FROM balance_history bh JOIN users u ON bh.userId = u.id JOIN drivers d ON u.id = d.userId WHERE d.parkId = ? AND bh.type = 'expense' AND bh.description LIKE '%Магазин игры%'${bhFilter}) as gameSpentUnreal,
          (SELECT IFNULL(SUM(ABS(bh.amount)), 0) FROM balance_history bh JOIN users u ON bh.userId = u.id JOIN drivers d ON u.id = d.userId WHERE d.parkId = ? AND bh.type = 'expense' AND bh.description LIKE '%Магазин игры: magnet%'${bhFilter}) as gameSpentMagnet,
          (SELECT IFNULL(SUM(ABS(bh.amount)), 0) FROM balance_history bh JOIN users u ON bh.userId = u.id JOIN drivers d ON u.id = d.userId WHERE d.parkId = ? AND bh.type = 'expense' AND bh.description LIKE '%Магазин игры: nitro%'${bhFilter}) as gameSpentNitro,
          (SELECT IFNULL(SUM(ABS(bh.amount)), 0) FROM balance_history bh JOIN users u ON bh.userId = u.id JOIN drivers d ON u.id = d.userId WHERE d.parkId = ? AND bh.type = 'expense' AND bh.description LIKE '%Магазин игры: jump%'${bhFilter}) as gameSpentJump,
          (SELECT IFNULL(SUM(ABS(bh.amount)), 0) FROM balance_history bh JOIN users u ON bh.userId = u.id JOIN drivers d ON u.id = d.userId WHERE d.parkId = ? AND bh.type = 'expense' AND bh.description LIKE '%Магазин игры: extra_life%'${bhFilter}) as gameSpentExtraLife,
          (SELECT IFNULL(SUM(ABS(bh.amount)), 0) FROM balance_history bh JOIN users u ON bh.userId = u.id JOIN drivers d ON u.id = d.userId WHERE d.parkId = ? AND bh.type = 'expense' AND bh.description LIKE '%Удвоение очков в игре%'${bhFilter}) as doubleCoinsSpent,
          (SELECT COUNT(DISTINCT s.id) FROM drivers d LEFT JOIN shifts s ON s.driverId = d.userId AND s.parkId = d.parkId AND s.status IN ('closed', 'auto_closed') WHERE d.parkId = ?${shiftsFilter}) as closedShiftsCount,
          (SELECT COUNT(DISTINCT s.id) FROM drivers d LEFT JOIN shifts s ON s.driverId = d.userId AND s.parkId = d.parkId AND s.status = 'auto_closed' WHERE d.parkId = ?${shiftsFilter}) as autoClosedShiftsCount,
          (SELECT COUNT(*) FROM evacuator_requests er WHERE er.authorParkId = ?${evacFilter}) as evacuatorRequestsCount,
          (SELECT IFNULL(SUM(COALESCE(er.requestFeeAmount, 0)), 0) FROM evacuator_requests er WHERE er.authorParkId = ?${evacFilter}) as evacuatorRequestsAmount
      `;
        
        // Траты на автозакрытие (expense с описанием «Автозакрытие») — по парку и периоду
        let autoCloseQuery = `
          SELECT
            IFNULL(SUM(CASE WHEN bh.type = 'expense' AND bh.description LIKE '%Автозакрытие%' AND (bh.amountType = 'real' OR bh.amountType IS NULL) THEN ABS(bh.amount) ELSE 0 END), 0) AS autoCloseReal,
            IFNULL(SUM(CASE WHEN bh.type = 'expense' AND bh.description LIKE '%Автозакрытие%' AND bh.amountType = 'unreal' THEN ABS(bh.amount) ELSE 0 END), 0) AS autoCloseUnreal
          FROM balance_history bh
          JOIN users u ON bh.userId = u.id
          JOIN drivers d ON u.id = d.userId
          WHERE d.parkId = ?
        `;
        if (dateFilter) {
          autoCloseQuery += ` AND ${dateFilter}`;
        }
      // 17 плейсхолдеров ? в operationsQuery (eplCount..evacuatorRequestsAmount)
      const opsParams = Array(17).fill(parkId);
      db.get(operationsQuery, opsParams, (err, operationsStats) => {
        if (err) {
          console.error('[Statistics] Operations query error:', err);
          return res.status(500).json({ error: err.message });
        }

        // Получаем статистику автозакрытия смен
        db.get(autoCloseQuery, [parkId], (err, autoCloseStats) => {
          if (err) {
            console.warn('[Statistics] Auto-close query error:', err);
            // Продолжаем без статистики автозакрытия
          }

          // Новые водители и связки — по выбранному периоду (используем тот же dateFilter по МСК)
          let newDriversFilter = '1=0';
          let newBindingsFilter = '1=0';
          const mt = getMoscowDate();
          const [yy, mm, dd] = mt.split('-').map(Number);
          if (period === 'today' || !period) {
            newDriversFilter = getMoscowDateFilter('d.createdAt', mt);
            newBindingsFilter = getMoscowDateFilter('d.updatedAt', mt);
          } else if (period === 'yesterday') {
            const yesterday = new Date(yy, mm - 1, dd - 1).toISOString().split('T')[0];
            newDriversFilter = getMoscowDateFilter('d.createdAt', yesterday);
            newBindingsFilter = getMoscowDateFilter('d.updatedAt', yesterday);
          } else if (period === 'since_friday') {
            const d = new Date(yy, mm - 1, dd);
            const dow = d.getDay();
            const back = dow === 5 ? 0 : dow === 6 ? 1 : dow + 2;
            const lastFri = new Date(yy, mm - 1, dd - back).toISOString().split('T')[0];
            newDriversFilter = getMoscowPeriodFilter('d.createdAt', lastFri, mt);
            newBindingsFilter = getMoscowPeriodFilter('d.updatedAt', lastFri, mt);
          } else if (period === 'date' && date) {
            newDriversFilter = getMoscowDateFilter('d.createdAt', date);
            newBindingsFilter = getMoscowDateFilter('d.updatedAt', date);
          } else if (period === 'range' && dateStart && dateEnd) {
            newDriversFilter = getMoscowPeriodFilter('d.createdAt', dateStart, dateEnd);
            newBindingsFilter = getMoscowPeriodFilter('d.updatedAt', dateStart, dateEnd);
          } else if (period === 'week') {
            const weekAgo = new Date(yy, mm - 1, dd - 7).toISOString().split('T')[0];
            newDriversFilter = getMoscowPeriodFilter('d.createdAt', weekAgo, mt);
            newBindingsFilter = getMoscowPeriodFilter('d.updatedAt', weekAgo, mt);
          } else if (period === 'month') {
            const monthAgo = new Date(yy, mm - 1, dd - 30).toISOString().split('T')[0];
            newDriversFilter = getMoscowPeriodFilter('d.createdAt', monthAgo, mt);
            newBindingsFilter = getMoscowPeriodFilter('d.updatedAt', monthAgo, mt);
          }
          
          db.get(`
            SELECT
              COUNT(DISTINCT CASE WHEN ${newDriversFilter} THEN d.id END) as newDriversCount,
              COUNT(DISTINCT CASE WHEN d.carId IS NOT NULL AND ${newBindingsFilter} THEN d.carId END) as newBindingsCount
            FROM drivers d
            WHERE d.parkId = ?
          `, [parkId], (err, newStats) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }

            const autoCloseAmount = (autoCloseStats?.autoCloseReal || 0) + (autoCloseStats?.autoCloseUnreal || 0);
            const gameSpent = (operationsStats?.gameSpentReal || 0) + (operationsStats?.gameSpentUnreal || 0);
            const result = {
              ...basicStats,
              ...financeStats,
              ...operationsStats,
              ...(autoCloseStats || {}),
              autoCloseAmount,
              closedShiftsAmount: autoCloseAmount,
              gameSpent,
              ...newStats,
              forecast: Math.floor((financeStats.systemBalanceReal || 0) / Math.max((financeStats.spent || 1) / 30, 1))
            };
            console.log('[Statistics] Result:', result);
            res.json(result);
          });
        });
      });
    });
  });
  });
});

// Получить список автомобилей парка
router.get('/parks/:parkId/cars', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { parkId } = req.params;
  console.log(`[Statistics] Loading cars for park ${parkId}`);
  db.all(`
    SELECT c.*, d.id as driverId, d.userId, u.fullName as driverName
    FROM cars c
    LEFT JOIN drivers d ON d.carId = c.id AND d.parkId = ?
    LEFT JOIN users u ON d.userId = u.id
    WHERE c.parkId = ?
    ORDER BY c.regNumber
  `, [parkId, parkId], (err, rows) => {
    if (err) {
      console.error('[Statistics] Cars query error:', err);
      return res.status(500).json({ error: err.message });
    }
    console.log(`[Statistics] Found ${rows?.length || 0} cars for park ${parkId}`);
    res.json(rows || []);
  });
});

module.exports = router;
