const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken, authorizeRole } = require('../auth');
const { addBalance, getBalance } = require('../utils/balance');

/** Получить настройки комиссара (глобальные + список парков) */
router.get('/settings', authenticateToken, authorizeRole('commissioner'), (req, res) => {
  const userId = req.user.userId;
  db.get('SELECT requestCreationPrice, commissionPercent FROM commissioner_settings WHERE id = 1', [], (err, glob) => {
    if (err) return res.status(500).json({ error: err.message });
    db.all(
      'SELECT parkId FROM commissioner_source_parks WHERE commissionerUserId = ?',
      [userId],
      (e2, parks) => {
        if (e2) return res.status(500).json({ error: e2.message });
        res.json({
          requestCreationPrice: glob?.requestCreationPrice ?? 50,
          commissionPercent: glob?.commissionPercent ?? 15,
          sourceParkIds: (parks || []).map((p) => p.parkId)
        });
      }
    );
  });
});

/** Статус на линии: получить */
router.get('/online', authenticateToken, authorizeRole('commissioner'), (req, res) => {
  db.get(
    'SELECT isOnline, updatedAt FROM commissioner_online WHERE userId = ?',
    [req.user.userId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        isOnline: !!(row && row.isOnline),
        updatedAt: row?.updatedAt || null
      });
    }
  );
});

/** Статус на линии: установить */
router.patch('/online', authenticateToken, authorizeRole('commissioner'), (req, res) => {
  const isOnline = !!req.body.isOnline;
  const userId = req.user.userId;
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO commissioner_online (userId, isOnline, updatedAt) VALUES (?, ?, ?)
     ON CONFLICT(userId) DO UPDATE SET isOnline = excluded.isOnline, updatedAt = excluded.updatedAt`,
    [userId, isOnline ? 1 : 0, now],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ isOnline, updatedAt: now });
    }
  );
});

/** Баланс комиссара */
router.get('/balance', authenticateToken, authorizeRole('commissioner'), (req, res) => {
  db.get(
    `SELECT id, (COALESCE(balanceReal,0) + COALESCE(balanceUnreal,0)) as balance FROM users WHERE id = ?`,
    [req.user.userId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ balance: row?.balance ?? 0 });
    }
  );
});

/** Уведомления комиссара */
router.get('/notifications', authenticateToken, authorizeRole('commissioner'), (req, res) => {
  db.all(
    `SELECT id, type, title, body, readAt, createdAt FROM notifications WHERE userId = ? AND readAt IS NULL ORDER BY createdAt DESC LIMIT 100`,
    [req.user.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

router.patch('/notifications/read-all', authenticateToken, authorizeRole('commissioner'), (req, res) => {
  db.run(
    'UPDATE notifications SET readAt = CURRENT_TIMESTAMP WHERE userId = ? AND readAt IS NULL',
    [req.user.userId],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

router.patch('/notifications/:id/read', authenticateToken, authorizeRole('commissioner'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  db.run(
    'UPDATE notifications SET readAt = CURRENT_TIMESTAMP WHERE id = ? AND userId = ?',
    [id, req.user.userId],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: this.changes > 0 });
    }
  );
});

/** Список заявок для комиссара (только из своих парков, активные) */
router.get('/requests', authenticateToken, authorizeRole('commissioner'), (req, res) => {
  const userId = req.user.userId;
  db.all(
    `SELECT parkId FROM commissioner_source_parks WHERE commissionerUserId = ?`,
    [userId],
    (err, myParks) => {
      if (err) return res.status(500).json({ error: err.message });
      const parkIds = (myParks || []).map((p) => p.parkId);
      if (parkIds.length === 0) return res.json([]);

      const placeholders = parkIds.map(() => '?').join(',');
      db.all(
        `SELECT r.id, r.authorUserId, r.authorParkId, r.address, r.comment, r.lat, r.lon, r.status,
                r.requestFeeAmount, r.createdAt,
                p.name as parkName,
                u.fullName as authorName, u.phone as authorPhone
         FROM commissioner_requests r
         LEFT JOIN parks p ON r.authorParkId = p.id
         LEFT JOIN users u ON r.authorUserId = u.id
         WHERE r.authorParkId IN (${placeholders})
           AND r.status IN ('created', 'has_responses', 'confirmed', 'in_progress')
         ORDER BY r.createdAt DESC`,
        parkIds,
        (e2, requests) => {
          if (e2) return res.status(500).json({ error: e2.message });
          db.all(
            `SELECT response.requestId, response.id as responseId, response.commissionerUserId, response.etaMinutes, response.price, response.status as responseStatus
             FROM commissioner_responses response
             WHERE response.requestId IN (SELECT id FROM commissioner_requests WHERE authorParkId IN (${placeholders}))`,
            parkIds,
            (e3, responses) => {
              if (e3) return res.status(500).json({ error: e3.message });
              const byRequest = {};
              (responses || []).forEach((r) => {
                if (!byRequest[r.requestId]) byRequest[r.requestId] = [];
                byRequest[r.requestId].push(r);
              });
              const list = (requests || []).map((req) => ({
                ...req,
                responses: byRequest[req.id] || [],
                myResponse: (byRequest[req.id] || []).find((r) => r.commissionerUserId === userId)
              }));
              res.json(list);
            }
          );
        }
      );
    }
  );
});

/** Откликнуться на заявку */
router.post('/requests/:requestId/respond', authenticateToken, authorizeRole('commissioner'), (req, res) => {
  const userId = req.user.userId;
  const requestId = parseInt(req.params.requestId, 10);
  const { etaMinutes, price } = req.body || {};
  if (!requestId || etaMinutes == null || price == null) {
    return res.status(400).json({ error: 'Нужны requestId, etaMinutes и price' });
  }
  const eta = parseInt(etaMinutes, 10);
  const amount = parseFloat(price);
  if (isNaN(eta) || eta < 1 || eta > 300) {
    return res.status(400).json({ error: 'etaMinutes от 1 до 300' });
  }
  if (isNaN(amount) || amount < 0) {
    return res.status(400).json({ error: 'Укажите цену' });
  }

  db.get(
    'SELECT id, authorParkId, status FROM commissioner_requests WHERE id = ?',
    [requestId],
    (err, reqRow) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!reqRow) return res.status(404).json({ error: 'Заявка не найдена' });
      if (!['created', 'has_responses'].includes(reqRow.status)) {
        return res.status(400).json({ error: 'Заявка уже занята или закрыта' });
      }
      db.get(
        'SELECT parkId FROM commissioner_source_parks WHERE commissionerUserId = ? AND parkId = ?',
        [userId, reqRow.authorParkId],
        (e2, link) => {
          if (e2) return res.status(500).json({ error: e2.message });
          if (!link) return res.status(403).json({ error: 'Заявки из этого парка вам недоступны' });
          db.get(
            'SELECT id FROM commissioner_responses WHERE requestId = ? AND commissionerUserId = ?',
            [requestId, userId],
            (e3, existing) => {
              if (e3) return res.status(500).json({ error: e3.message });
              if (existing) return res.status(400).json({ error: 'Вы уже откликались на эту заявку' });
              db.run(
                'INSERT INTO commissioner_responses (requestId, commissionerUserId, etaMinutes, price, status) VALUES (?, ?, ?, ?, ?)',
                [requestId, userId, eta, amount, 'pending'],
                function (insErr) {
                  if (insErr) return res.status(500).json({ error: insErr.message });
                  db.run(
                    "UPDATE commissioner_requests SET status = 'has_responses', updatedAt = ? WHERE id = ?",
                    [new Date().toISOString(), requestId]
                  );
                  db.get('SELECT authorUserId FROM commissioner_requests WHERE id = ?', [requestId], (_, r) => {
                    if (r?.authorUserId) {
                      db.run(
                        'INSERT INTO notifications (userId, type, title, body) VALUES (?, ?, ?, ?)',
                        [r.authorUserId, 'commissioner_response', 'По заявке откликнулся комиссар', 'Откройте «Мои заявки» в разделе Комиссар и выберите отклик.']
                      );
                    }
                  });
                  res.status(201).json({
                    id: this.lastID,
                    requestId,
                    etaMinutes: eta,
                    price: amount,
                    status: 'pending'
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

/** Мои заказы (подтверждённые заявки, где я комиссар) */
router.get('/orders', authenticateToken, authorizeRole('commissioner'), (req, res) => {
  const userId = req.user.userId;
  db.all(
    `SELECT r.id, r.address, r.comment, r.lat, r.lon, r.status, r.createdAt, r.completedAt,
            r.authorUserId, r.authorParkId, resp.id as responseId, resp.etaMinutes, resp.price,
            u.fullName as authorName, u.phone as authorPhone, p.name as parkName
     FROM commissioner_requests r
     JOIN commissioner_responses resp ON resp.requestId = r.id AND resp.commissionerUserId = ? AND resp.status = 'accepted'
     LEFT JOIN users u ON r.authorUserId = u.id
     LEFT JOIN parks p ON r.authorParkId = p.id
     WHERE r.status IN ('confirmed', 'in_progress', 'completed')
     ORDER BY r.createdAt DESC`,
    [userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

/** Отметить заказ: в пути / выполнен */
router.patch('/orders/:requestId/status', authenticateToken, authorizeRole('commissioner'), (req, res) => {
  const userId = req.user.userId;
  const requestId = parseInt(req.params.requestId, 10);
  const { status } = req.body || {};
  if (!requestId || !status) {
    return res.status(400).json({ error: 'Нужны requestId и status' });
  }
  if (!['in_progress', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'status: in_progress или completed' });
  }

  db.get(
    `SELECT r.id, r.status FROM commissioner_requests r
     JOIN commissioner_responses resp ON resp.requestId = r.id AND resp.commissionerUserId = ? AND resp.status = 'accepted'
     WHERE r.id = ?`,
    [userId, requestId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Заказ не найден' });
      const now = new Date().toISOString();
      if (status === 'completed') {
        db.get(
          'SELECT authorUserId, chosenResponseId FROM commissioner_requests WHERE id = ?',
          [requestId],
          (e3, reqRow) => {
            if (e3) return res.status(500).json({ error: e3.message });
            if (!reqRow) return res.status(404).json({ error: 'Заказ не найден' });
            const doMarkCompleted = (authorUserId) => {
              db.run(
                "UPDATE commissioner_requests SET status = 'completed', completedAt = ?, updatedAt = ? WHERE id = ?",
                [now, now, requestId],
                (e2) => {
                  if (e2) return res.status(500).json({ error: e2.message });
                  if (authorUserId) {
                    db.run(
                      'INSERT INTO notifications (userId, type, title, body) VALUES (?, ?, ?, ?)',
                      [authorUserId, 'commissioner_completed', 'Работа комиссара завершена', 'Комиссар отметил заказ выполненным. Оплата услуги — на месте.']
                    );
                    db.run(
                      'INSERT INTO notifications (userId, type, title, body) VALUES (?, ?, ?, ?)',
                      [authorUserId, 'commissioner_payment_offline', 'Оплата комиссара', 'Оплатите комиссару на месте после завершения.']
                    );
                  }
                  res.json({ status: 'completed', completedAt: now });
                }
              );
            };
            doMarkCompleted(reqRow.authorUserId);
          }
        );
      } else {
        db.run(
          "UPDATE commissioner_requests SET status = 'in_progress', inProgressAt = COALESCE(inProgressAt, ?), updatedAt = ? WHERE id = ?",
          [now, now, requestId],
          (e2) => {
            if (e2) return res.status(500).json({ error: e2.message });
            res.json({ status: 'in_progress' });
          }
        );
      }
    }
  );
});

/**
 * POST /api/commissioner/balance/topup - Запрос на пополнение баланса через Юкассу
 * Body: { amount }
 */
router.post('/balance/topup', authenticateToken, authorizeRole('commissioner'), async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount < 100) {
      return res.status(400).json({ error: 'Минимальная сумма пополнения 100 ₽' });
    }

    db.get(
      'SELECT id, fullName, phone FROM users WHERE id = ?',
      [req.user.userId],
      async (err, user) => {
        if (err || !user) {
          return res.status(404).json({ error: 'Commissioner not found' });
        }

        try {
          const Yookassa = require('../services/yookassa');
          const payment = await Yookassa.createPayment({
            amount,
            description: `Balance top-up for ${user.fullName}`,
            returnUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/commissioner`,
            metadata: {
              userId: req.user.userId,
              type: 'balance_topup',
              role: 'commissioner'
            }
          });

          db.run(
            `INSERT INTO payments (userId, amount, paymentId, yookassaPaymentId, status, description)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [req.user.userId, amount, payment.id, payment.id, 'pending', 'Balance top-up'],
            function (err) {
              if (err) {
                console.error('[Commissioner] Payment save error:', err.message);
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
          console.error('[Commissioner] Yookassa error:', error.message);
          res.status(500).json({ error: error.message });
        }
      }
    );
  } catch (error) {
    console.error('[Commissioner] POST /balance/topup error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/commissioner/payment/:paymentId/status - Проверить статус платежа в Юкассе
 */
router.get('/payment/:paymentId/status', authenticateToken, authorizeRole('commissioner'), async (req, res) => {
  try {
    const { paymentId } = req.params;

    db.get(
      'SELECT * FROM payments WHERE paymentId = ? AND userId = ?',
      [paymentId, req.user.userId],
      async (err, payment) => {
        if (err || !payment) {
          return res.status(404).json({ error: 'Payment not found' });
        }

        try {
          const Yookassa = require('../services/yookassa');
          const yookassaPayment = await Yookassa.getPaymentStatus(paymentId);

          if (yookassaPayment.status === 'succeeded' && payment.status === 'pending') {
            addBalance(
              db,
              req.user.userId,
              payment.amount,
              'real',
              'Пополнение онлайн (ЮKassa)',
              (err) => {
                if (err) {
                  console.error('[Commissioner] Balance update error:', err.message);
                } else {
                  db.run(
                    'UPDATE payments SET status = ? WHERE paymentId = ?',
                    ['succeeded', paymentId],
                    (err) => { if (err) console.warn('[Commissioner] Payment status update error:', err.message); }
                  );
                }
              }
            );
          } else if (yookassaPayment.status === 'canceled' || yookassaPayment.status === 'failed') {
            db.run(
              'UPDATE payments SET status = ? WHERE paymentId = ?',
              [yookassaPayment.status, paymentId],
              (err) => {
                if (err) console.warn('[Commissioner] Payment status update error:', err.message);
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
          console.error('[Commissioner] Yookassa check error:', yookassaError.message);
          res.status(500).json({ error: yookassaError.message });
        }
      }
    );
  } catch (error) {
    console.error('[Commissioner] GET /payment/:paymentId/status error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

