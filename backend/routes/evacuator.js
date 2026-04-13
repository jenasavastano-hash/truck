const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken, authorizeRole } = require('../auth');
const { addBalance, deductBalance, getBalance } = require('../utils/balance');

/** Получить настройки эвакуатора (глобальные + список парков эвака) */
router.get('/settings', authenticateToken, authorizeRole('evacuator'), (req, res) => {
  const userId = req.user.userId;
  db.get('SELECT requestCreationPrice, commissionPercent FROM evacuator_settings WHERE id = 1', [], (err, glob) => {
    if (err) return res.status(500).json({ error: err.message });
    db.all(
      'SELECT parkId FROM evacuator_source_parks WHERE evacuatorUserId = ?',
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
router.get('/online', authenticateToken, authorizeRole('evacuator'), (req, res) => {
  db.get(
    'SELECT isOnline, updatedAt FROM evacuator_online WHERE userId = ?',
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

/**
 * GET /api/evacuator/balance - Получить текущий баланс
 */
router.get('/balance', authenticateToken, authorizeRole('evacuator'), (req, res) => {
  db.get(
    `SELECT id, (COALESCE(balanceReal,0) + COALESCE(balanceUnreal,0)) as balance FROM users WHERE id = ?`,
    [req.user.userId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ balance: row?.balance ?? 0 });
    }
  );
});

/** Уведомления эвакуатора */
router.get('/notifications', authenticateToken, authorizeRole('evacuator'), (req, res) => {
  db.all(
    `SELECT id, type, title, body, readAt, createdAt FROM notifications WHERE userId = ? AND readAt IS NULL ORDER BY createdAt DESC LIMIT 100`,
    [req.user.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

router.patch('/notifications/read-all', authenticateToken, authorizeRole('evacuator'), (req, res) => {
  db.run(
    'UPDATE notifications SET readAt = CURRENT_TIMESTAMP WHERE userId = ? AND readAt IS NULL',
    [req.user.userId],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

router.patch('/notifications/:id/read', authenticateToken, authorizeRole('evacuator'), (req, res) => {
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

/** Статус на линии: установить */
router.patch('/online', authenticateToken, authorizeRole('evacuator'), (req, res) => {
  const isOnline = !!req.body.isOnline;
  const userId = req.user.userId;
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO evacuator_online (userId, isOnline, updatedAt) VALUES (?, ?, ?)
     ON CONFLICT(userId) DO UPDATE SET isOnline = excluded.isOnline, updatedAt = excluded.updatedAt`,
    [userId, isOnline ? 1 : 0, now],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ isOnline, updatedAt: now });
    }
  );
});

/** Список заявок для эвака (только из своих парков, не завершённые) */
router.get('/requests', authenticateToken, authorizeRole('evacuator'), (req, res) => {
  const userId = req.user.userId;
  db.all(
    `SELECT parkId FROM evacuator_source_parks WHERE evacuatorUserId = ?`,
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
         FROM evacuator_requests r
         LEFT JOIN parks p ON r.authorParkId = p.id
         LEFT JOIN users u ON r.authorUserId = u.id
         WHERE r.authorParkId IN (${placeholders})
           AND r.status IN ('created', 'has_responses', 'confirmed', 'in_progress')
         ORDER BY r.createdAt DESC`,
        parkIds,
        (e2, requests) => {
          if (e2) return res.status(500).json({ error: e2.message });
          db.all(
            `SELECT response.requestId, response.id as responseId, response.evacuatorUserId, response.etaMinutes, response.price, response.status as responseStatus
             FROM evacuator_responses response
             WHERE response.requestId IN (SELECT id FROM evacuator_requests WHERE authorParkId IN (${placeholders}))`,
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
                myResponse: (byRequest[req.id] || []).find((r) => r.evacuatorUserId === userId)
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
router.post('/requests/:requestId/respond', authenticateToken, authorizeRole('evacuator'), (req, res) => {
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
    'SELECT id, authorParkId, status FROM evacuator_requests WHERE id = ?',
    [requestId],
    (err, reqRow) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!reqRow) return res.status(404).json({ error: 'Заявка не найдена' });
      if (!['created', 'has_responses'].includes(reqRow.status)) {
        return res.status(400).json({ error: 'Заявка уже занята или закрыта' });
      }
      db.get(
        'SELECT parkId FROM evacuator_source_parks WHERE evacuatorUserId = ? AND parkId = ?',
        [userId, reqRow.authorParkId],
        (e2, link) => {
          if (e2) return res.status(500).json({ error: e2.message });
          if (!link) return res.status(403).json({ error: 'Заявки из этого парка вам недоступны' });
          db.get(
            'SELECT id FROM evacuator_responses WHERE requestId = ? AND evacuatorUserId = ?',
            [requestId, userId],
            (e3, existing) => {
              if (e3) return res.status(500).json({ error: e3.message });
              if (existing) return res.status(400).json({ error: 'Вы уже откликались на эту заявку' });
              db.run(
                'INSERT INTO evacuator_responses (requestId, evacuatorUserId, etaMinutes, price, status) VALUES (?, ?, ?, ?, ?)',
                [requestId, userId, eta, amount, 'pending'],
                function (insErr) {
                  if (insErr) return res.status(500).json({ error: insErr.message });
                  db.run(
                    "UPDATE evacuator_requests SET status = 'has_responses', updatedAt = ? WHERE id = ?",
                    [new Date().toISOString(), requestId]
                  );
                  db.get('SELECT authorUserId FROM evacuator_requests WHERE id = ?', [requestId], (_, r) => {
                    if (r?.authorUserId) {
                      db.run(
                        'INSERT INTO notifications (userId, type, title, body) VALUES (?, ?, ?, ?)',
                        [r.authorUserId, 'evacuator_response', 'По заявке откликнулся эвакуатор', 'Откройте «Мои заявки» в разделе Эвакуатор и выберите эвака.']
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

/** Мои заказы (подтверждённые заявки, где я эвак) */
router.get('/orders', authenticateToken, authorizeRole('evacuator'), (req, res) => {
  const userId = req.user.userId;
  db.all(
    `SELECT r.id, r.address, r.comment, r.lat, r.lon, r.status, r.createdAt, r.completedAt,
            r.authorUserId, r.authorParkId, resp.id as responseId, resp.etaMinutes, resp.price,
            u.fullName as authorName, u.phone as authorPhone, p.name as parkName
     FROM evacuator_requests r
     JOIN evacuator_responses resp ON resp.requestId = r.id AND resp.evacuatorUserId = ? AND resp.status = 'accepted'
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
router.patch('/orders/:requestId/status', authenticateToken, authorizeRole('evacuator'), (req, res) => {
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
    `SELECT r.id, r.status FROM evacuator_requests r
     JOIN evacuator_responses resp ON resp.requestId = r.id AND resp.evacuatorUserId = ? AND resp.status = 'accepted'
     WHERE r.id = ?`,
    [userId, requestId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Заказ не найден' });
      const now = new Date().toISOString();
      if (status === 'completed') {
        // Платёж цены эвакуатора (если оплата с баланса): списать с водилы, зачислить эваку (без процентов).
        // Сервисные сборы (водитель + эвакуатор) списываются на этапе подтверждения отклика.
        db.get(
          'SELECT authorUserId, authorParkId, paymentMethod, chosenResponseId FROM evacuator_requests WHERE id = ?',
          [requestId],
          (e3, reqRow) => {
            if (e3) return res.status(500).json({ error: e3.message });
            if (!reqRow) return res.status(404).json({ error: 'Заказ не найден' });
            const doMarkCompleted = (authorUserId) => {
              db.run(
                "UPDATE evacuator_requests SET status = 'completed', completedAt = ?, updatedAt = ? WHERE id = ?",
                [now, now, requestId],
                (e2) => {
                  if (e2) return res.status(500).json({ error: e2.message });
                  if (authorUserId) {
                    db.run(
                      'INSERT INTO notifications (userId, type, title, body) VALUES (?, ?, ?, ?)',
                      [authorUserId, 'evacuator_completed', 'Заказ эвакуатора выполнен', 'Эвакуатор отметил заказ выполненным. Оплата списана с баланса или произведена на месте.']
                    );
                  }
                  res.json({ status: 'completed', completedAt: now });
                }
              );
            };
            // Оплата услуги эвакуатора на сайте не проводится — всегда по факту/на месте.
            if (!reqRow.chosenResponseId) {
              return doMarkCompleted(reqRow.authorUserId);
            }
            db.get(
              'SELECT price, evacuatorUserId FROM evacuator_responses WHERE id = ?',
              [reqRow.chosenResponseId],
              (e4, respRow) => {
                if (e4 || !respRow) return doMarkCompleted();
                const price = Number(respRow.price) || 0;
                // Деньги за услугу не списываем/не зачисляем. Только уведомляем по факту.
                if (reqRow.authorUserId) {
                  db.run(
                    'INSERT INTO notifications (userId, type, title, body) VALUES (?, ?, ?, ?)',
                    [reqRow.authorUserId, 'evacuator_payment_offline', 'Оплата эвакуатора', `Сумма к оплате по факту: ${price} ₽. Оплатите эвакуатору после выполнения.`]
                  );
                }
                doMarkCompleted(reqRow.authorUserId);
              }
            );
          }
        );
      } else {
        db.run(
          "UPDATE evacuator_requests SET status = 'in_progress', inProgressAt = COALESCE(inProgressAt, ?), updatedAt = ? WHERE id = ?",
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
 * POST /api/evacuator/balance/topup - Запрос на пополнение баланса через Юкассу
 * Body: { amount }
 * Возвращает ссылку на платёж
 */
router.post('/balance/topup', authenticateToken, authorizeRole('evacuator'), async (req, res) => {
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
          return res.status(404).json({ error: 'Evacuator not found' });
        }

        try {
          const Yookassa = require('../services/yookassa');
          const payment = await Yookassa.createPayment({
            amount,
            description: `Balance top-up for ${user.fullName}`,
            returnUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/evacuator`,
            metadata: {
              userId: req.user.userId,
              type: 'balance_topup',
              role: 'evacuator'
            }
          });

          db.run(
            `INSERT INTO payments (userId, amount, paymentId, yookassaPaymentId, status, description)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [req.user.userId, amount, payment.id, payment.id, 'pending', 'Balance top-up'],
            function (err) {
              if (err) {
                console.error('[Evacuator] Payment save error:', err.message);
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
          console.error('[Evacuator] Yookassa error:', error.message);
          res.status(500).json({ error: error.message });
        }
      }
    );
  } catch (error) {
    console.error('[Evacuator] POST /balance/topup error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/evacuator/payment/:paymentId/status - Проверить статус платежа в Юкассе
 * Без вебхука - пользователь сам проверяет статус
 */
router.get('/payment/:paymentId/status', authenticateToken, authorizeRole('evacuator'), async (req, res) => {
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
                  console.error('[Evacuator] Balance update error:', err.message);
                } else {
                  db.run(
                    'UPDATE payments SET status = ? WHERE paymentId = ?',
                    ['succeeded', paymentId],
                    (err) => { if (err) console.warn('[Evacuator] Payment status update error:', err.message); }
                  );
                  console.log(`[Evacuator] Баланс пополнен на ${payment.amount}₽ (реальные деньги) для пользователя ${req.user.userId}`);
                }
              }
            );
          } else if (yookassaPayment.status === 'canceled' || yookassaPayment.status === 'failed') {
            db.run(
              'UPDATE payments SET status = ? WHERE paymentId = ?',
              [yookassaPayment.status, paymentId],
              (err) => {
                if (err) console.warn('[Evacuator] Payment status update error:', err.message);
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
          console.error('[Evacuator] Yookassa check error:', yookassaError.message);
          res.status(500).json({ error: yookassaError.message });
        }
      }
    );
  } catch (error) {
    console.error('[Evacuator] GET /payment/:paymentId/status error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
