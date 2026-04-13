/**
 * Уведомление водителю за N часов до окончания срока действия фотоконтроля.
 * N берётся из park_photo_control_settings.notifyHoursBefore (по умолчанию 24).
 */
const db = require('../database');
const { parseDbUtc } = require('../utils/shifts');

function run() {
  const now = new Date();
  db.all(
    `SELECT a.id, a.validUntil, a.parkId, d.userId, s.notifyHoursBefore
     FROM photo_control_applications a
     JOIN drivers d ON a.driverId = d.id
     LEFT JOIN park_photo_control_settings s ON a.parkId = s.parkId
     WHERE a.status = 'approved'
       AND a.validUntil IS NOT NULL
       AND (a.expiryWarningSentAt IS NULL OR a.expiryWarningSentAt = '')
       AND datetime(a.validUntil) <= datetime('now', '+' || COALESCE(s.notifyHoursBefore, 24) || ' hours')
       AND datetime(a.validUntil) > datetime('now')`,
    [],
    (err, rows) => {
      if (err) {
        console.error('[fc-expiry] Warning check error:', err.message);
        return;
      }
      (rows || []).forEach((row) => {
        const hours = row.notifyHoursBefore || 24;
        const d = parseDbUtc(row.validUntil);
        const validUntil = d && !isNaN(d.getTime())
          ? d.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' (МСК)'
          : '';
        db.run(
          `INSERT INTO notifications (userId, type, title, body) VALUES (?, 'photo_control_expiry', ?, ?)`,
          [row.userId, 'Скоро заканчивается фотоконтроль', `Действие фотоконтроля истекает через ${hours} ч. Окончание: ${validUntil}. Подайте новую заявку при необходимости.`],
          (insErr) => {
            if (insErr) return console.warn('[fc-expiry] Notification insert:', insErr.message);
            db.run(
              `UPDATE photo_control_applications SET expiryWarningSentAt = datetime('now') WHERE id = ?`,
              [row.id],
              (upErr) => {
                if (!upErr) console.log(`[fc-expiry] Уведомление об окончании ФК отправлено водителю, заявка ${row.id}`);
              }
            );
          }
        );
      });
    }
  );
}

function start() {
  run();
  setInterval(run, 30 * 60 * 1000);
}

module.exports = { run, start };
