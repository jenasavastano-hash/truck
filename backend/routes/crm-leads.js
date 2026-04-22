const express = require('express');
const db = require('../database');
const { authenticateToken, authorizeRole } = require('../auth');

const router = express.Router();

const ALLOWED_STATUSES = new Set(['new', 'in_progress', 'done', 'rejected']);

function normalizeText(value, maxLen = 500) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, maxLen);
}

// Публичная заявка с лендинга (без авторизации)
router.post('/callback', (req, res) => {
  const name = normalizeText(req.body?.name, 120);
  const contact = normalizeText(req.body?.contact, 160);
  const company = normalizeText(req.body?.company, 160);
  const businessType = normalizeText(req.body?.businessType, 80);
  const comment = normalizeText(req.body?.comment, 1000);
  const sourcePage = normalizeText(req.body?.sourcePage, 160);

  if (!name || !contact) {
    return res.status(400).json({ error: 'Укажите имя и контакт для обратного звонка' });
  }

  db.run(
    `INSERT INTO crm_callback_leads (
      name, contact, company, businessType, comment, sourcePage, status, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, 'new', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [name, contact, company, businessType, comment, sourcePage],
    function onInsert(err) {
      if (err) return res.status(500).json({ error: err.message });
      return res.status(201).json({
        success: true,
        id: this.lastID,
        message: 'Заявка на звонок отправлена',
      });
    }
  );
});

// CRM-лиды для обработки менеджером
router.get('/callback', authenticateToken, authorizeRole('admin', 'manager', 'director'), (req, res) => {
  db.all(
    `SELECT
      id, name, contact, company, businessType, comment, sourcePage,
      status, callResult, assignedManagerUserId, calledAt, createdAt, updatedAt
     FROM crm_callback_leads
     ORDER BY
      CASE status
        WHEN 'new' THEN 1
        WHEN 'in_progress' THEN 2
        WHEN 'done' THEN 3
        WHEN 'rejected' THEN 4
        ELSE 5
      END,
      createdAt DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      return res.json(rows || []);
    }
  );
});

// Обновление статуса обработки звонка
router.patch('/callback/:id', authenticateToken, authorizeRole('admin', 'manager', 'director'), (req, res) => {
  const id = Number(req.params.id);
  const status = normalizeText(req.body?.status, 40);
  const callResult = normalizeText(req.body?.callResult, 1200);

  if (!id || Number.isNaN(id)) {
    return res.status(400).json({ error: 'Некорректный id заявки' });
  }
  if (!ALLOWED_STATUSES.has(status)) {
    return res.status(400).json({ error: 'Некорректный статус обработки' });
  }

  db.run(
    `UPDATE crm_callback_leads
     SET status = ?,
         callResult = ?,
         assignedManagerUserId = ?,
         calledAt = CASE WHEN ? IN ('done', 'rejected') THEN CURRENT_TIMESTAMP ELSE calledAt END,
         updatedAt = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [status, callResult, req.user.userId, status, id],
    function onUpdate(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (!this.changes) return res.status(404).json({ error: 'Заявка не найдена' });
      return res.json({ success: true });
    }
  );
});

module.exports = router;
