const db = require('../database');

/**
 * SQLite отдаёт UTC-строки без "Z". Парсим как UTC.
 * @param {string|Date} s
 * @returns {Date|null}
 */
function parseDbUtc(s) {
  if (!s) return null;
  const str = String(s).trim();
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(str)) return new Date(str);
  const withZ = str.includes('T') ? str.replace(/\.\d{3}$/, '') + 'Z' : str.replace(' ', 'T') + 'Z';
  return new Date(withZ);
}

/**
 * Единственная “истина” по смене — shifts. Но документы/QR могут появиться без fast-PDF.
 * Этот helper гарантирует, что при появлении якоря времени (PDF/QR) будет запись shifts.
 *
 * ВАЖНО:
 * - НЕ списывает деньги
 * - НЕ “переоткрывает” закрытую смену
 * - Создаёт ТОЛЬКО если записи по eplId ещё нет
 */
function ensureShiftExistsForEpl(eplId, cb) {
  const id = Number(eplId);
  if (!id || Number.isNaN(id)) {
    if (typeof cb === 'function') cb(new Error('Invalid eplId'));
    return;
  }
  db.get('SELECT id, status FROM shifts WHERE eplId = ?', [id], (sErr, sRow) => {
    if (!sErr && sRow && sRow.id) {
      if (typeof cb === 'function') cb(null, { existed: true, status: sRow.status });
      return;
    }
    db.get(
      `SELECT e.id as eplId, e.parkId, d.userId
       FROM epl e
       JOIN drivers d ON d.id = e.driverId
       WHERE e.id = ?`,
      [id],
      (eErr, row) => {
        if (eErr) {
          if (typeof cb === 'function') cb(eErr);
          return;
        }
        if (!row || !row.userId || !row.parkId) {
          if (typeof cb === 'function') cb(new Error('EPL/driver not found for shifts'));
          return;
        }
        db.run(
          `INSERT OR IGNORE INTO shifts (driverId, eplId, parkId, status)
           VALUES (?, ?, ?, 'active')`,
          [row.userId, row.eplId, row.parkId],
          function (iErr) {
            if (typeof cb === 'function') cb(iErr || null, { existed: false, inserted: !iErr && this.changes > 0 });
          }
        );
      }
    );
  });
}

module.exports = { parseDbUtc, ensureShiftExistsForEpl };

