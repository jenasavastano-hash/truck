/**
 * Джоб по истечению срока действия смены (ровно 12 ч).
 * Старт смены = момент загрузки PDF на сайт (documentPdfReceivedAt) или получения QR (approvedAt).
 * - За 1 ч до истечения: уведомление «Закройте смену в течение часа, иначе автозакрытие и списание 10₽».
 * - После 12 ч: авто-закрытие смены, списание 10₽ (или тариф парка autoCloseFee), уведомление водителю.
 */
const db = require('../database');
const { completeEplById } = require('./epl-complete');
const { deductBalance } = require('../utils/balance');

const SHIFT_VALIDITY_HOURS = 12;
const EPL_VALIDITY_HOURS = SHIFT_VALIDITY_HOURS;
const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_AUTO_CLOSE_FEE = 10;
const DEFAULT_KM_ADD = parseInt(process.env.EPL_COMPLETE_DEFAULT_KM, 10) || 50;

function formatTimeMsk(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
  return d.toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }) + ' (МСК)';
}

function parseUtc(s) {
  if (!s) return null;
  const str = String(s).trim();
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(str)) return new Date(str);
  const withZ = str.includes('T') ? str.replace(/\.\d{3}$/, '') + 'Z' : str.replace(' ', 'T') + 'Z';
  return new Date(withZ);
}

function getAutoCloseFee(db, parkId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT autoCloseFee FROM waybill_rates WHERE parkId = ? AND isActive = 1 ORDER BY id DESC LIMIT 1', [parkId], (err, row) => {
      if (err) return reject(err);
      const fee = (row && row.autoCloseFee != null && Number(row.autoCloseFee) >= 0) ? Number(row.autoCloseFee) : DEFAULT_AUTO_CLOSE_FEE;
      resolve(fee);
    });
  });
}

function insertNotification(db, userId, type, title, body) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO notifications (userId, type, title, body) VALUES (?, ?, ?, ?)`,
      [userId, type, title || null, body],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

function run() {
  const now = Date.now();
  // Порог в формате SQLite 'YYYY-MM-DD HH:MM:SS' (UTC), иначе сравнение строк даёт неверный результат
  const elevenHoursAgoDate = new Date(now - 11 * HOUR_MS);
  const twelveHoursAgoDate = new Date(now - EPL_VALIDITY_HOURS * HOUR_MS);
  const elevenHoursAgo = elevenHoursAgoDate.toISOString().slice(0, 19).replace('T', ' ');
  const twelveHoursAgo = twelveHoursAgoDate.toISOString().slice(0, 19).replace('T', ' ');

  // 1) Уведомление за 1 ч до истечения — только для активной смены (shifts.status='active'),
  // независимо от epl.status (Такском может фейлиться, но смена на сайте должна жить 12 часов от отрисовки).
  db.all(
    `SELECT e.id, e.waybillNumber, d.userId, e.documentPdfReceivedAt, e.approvedAt
     FROM epl e
     JOIN drivers d ON e.driverId = d.id
     JOIN shifts sh ON sh.eplId = e.id AND sh.status = 'active'
       AND e.expiryWarningSentAt IS NULL
       AND (e.documentPdfReceivedAt IS NOT NULL OR e.approvedAt IS NOT NULL)
       AND COALESCE(e.documentPdfReceivedAt, e.approvedAt) <= ?
       AND COALESCE(e.documentPdfReceivedAt, e.approvedAt) > ?`,
    [elevenHoursAgo, twelveHoursAgo],
    (err, rows) => {
      if (err) {
        console.error('[epl-expiry] Warning check error:', err.message);
        return;
      }
      (rows || []).forEach((row) => {
        const shiftStart = parseUtc(row.documentPdfReceivedAt || row.approvedAt);
        const closeAt = shiftStart ? new Date(shiftStart.getTime() + EPL_VALIDITY_HOURS * HOUR_MS) : new Date();
        const closeAtStr = formatTimeMsk(closeAt);
        const nowStr = formatTimeMsk(new Date());
        const warningBody = `Закройте смену в течение часа. Автозакрытие в ${closeAtStr}. Иначе с баланса будет списано 10₽ (или по тарифу парка). Уведомление: ${nowStr}.`;
        const warningTitle = 'Смена заканчивается через 1 час';
        insertNotification(db, row.userId, 'expiry_warning', warningTitle, warningBody)
          .then(() => {
            db.run(`UPDATE epl SET expiryWarningSentAt = CURRENT_TIMESTAMP WHERE id = ?`, [row.id], async (e) => {
              if (e) {
                console.warn('[epl-expiry] expiryWarningSentAt update:', e.message);
              } else {
                console.log(`[epl-expiry] Уведомление «закройте смену в течение часа» отправлено водителю, ЭПЛ ${row.id}`);
              }
            });
          })
          .catch((e) => console.error('[epl-expiry] Notification insert error:', e.message));
      });
    }
  );

  // 2) Авто-закрытие: 12 ч с момента отрисовки (documentPdfReceivedAt) или QR.
  // Работаем строго по shifts.status='active' и якорю времени, epl.status не учитываем.
  db.all(
    `SELECT e.id, e.startOdometer, e.parkId, d.userId, e.mintransId, e.eplGuid
     FROM epl e
     JOIN drivers d ON e.driverId = d.id
     JOIN shifts sh ON sh.eplId = e.id AND sh.status = 'active'
     WHERE (e.autoClosedAt IS NULL OR e.autoClosedAt = '')
       AND (e.documentPdfReceivedAt IS NOT NULL OR e.approvedAt IS NOT NULL)
       AND COALESCE(e.documentPdfReceivedAt, e.approvedAt) <= ?`,
    [twelveHoursAgo],
    async (err, rows) => {
      if (err) {
        console.error('[epl-expiry] Auto-close select error:', err.message);
        return;
      }
      for (const row of rows || []) {
        try {
          const hasTakskom = !!(row.mintransId || row.eplGuid);
          if (hasTakskom) {
            const start = row.startOdometer != null ? Number(row.startOdometer) : 0;
            const endOdo = start + DEFAULT_KM_ADD;
            await completeEplById(db, row.id, endOdo);
          } else {
            db.run(
              `UPDATE epl SET status = 'failed', autoClosedAt = CURRENT_TIMESTAMP, errorMessage = 'Автозакрытие смены (офф. документ Такском не получен)' WHERE id = ?`,
              [row.id],
              (e) => { if (e) console.warn('[epl-expiry] epl update (no Takskom):', e.message); }
            );
          }

          db.run(`UPDATE epl SET autoClosedAt = CURRENT_TIMESTAMP WHERE id = ?`, [row.id], (e) => {
            if (e) console.warn('[epl-expiry] autoClosedAt update:', e.message);
          });

          db.run(
            `UPDATE shifts SET status = 'auto_closed', autoClosedAt = CURRENT_TIMESTAMP, closedAt = CURRENT_TIMESTAMP WHERE eplId = ?`,
            [row.id],
            (shiftErr) => {
              if (shiftErr) console.warn('[epl-expiry] Shift update error:', shiftErr.message);
            }
          );

          const autoCloseFee = await getAutoCloseFee(db, row.parkId);
          const closedAtStr = formatTimeMsk(new Date());
          const feeDesc = `Автозакрытие смены. С баланса списано ${autoCloseFee} р.`;
          const notifText = `Смена закрыта автоматически в ${closedAtStr}. С баланса списано ${autoCloseFee}₽. Уведомление: ${closedAtStr}.`;

          deductBalance(
            db,
            row.userId,
            row.parkId,
            autoCloseFee,
            feeDesc,
            row.id,
            'expense',
            `auto_close_fee:epl:${row.id}`,
            async (err, result) => {
              if (err) {
                console.warn('[epl-expiry] Balance deduction error:', err.message);
                insertNotification(db, row.userId, 'auto_closed', 'Смена закрыта автоматически', notifText).catch(() => {});
                return;
              }
              insertNotification(db, row.userId, 'auto_closed', 'Смена закрыта автоматически', notifText)
                .then(() => {
                  console.log(`[epl-expiry] ЭПЛ ${row.id} авто-закрыт, с водителя ${row.userId} списано ${autoCloseFee} р.`);
                })
                .catch((e3) => console.warn('[epl-expiry] Notification after auto-close:', e3.message));
            }
          );
        } catch (e) {
          console.error(`[epl-expiry] Auto-close EPL ${row.id} failed:`, e.message);
        }
      }
    }
  );
}

const INTERVAL_MS = (parseInt(process.env.EPL_EXPIRY_JOB_MINUTES, 10) || 2) * 60 * 1000;

function start() {
  console.log(`[epl-expiry] Job started, interval ${INTERVAL_MS / 60000} min`);
  run();
  setInterval(run, INTERVAL_MS);
}

module.exports = { run, start };
