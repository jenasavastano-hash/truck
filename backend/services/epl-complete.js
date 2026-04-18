/**
 * Общая логика завершения рейса (Т5 в Такском + обновление БД).
 * Используется: водитель (driver.js), менеджер (manager.js), авто-закрытие по истечении 12 ч (epl-expiry-job.js).
 */
const TakskornAPI = require('../takskom-api');

function normalizeFio(str) {
  return (str || '').trim().replace(/\s+/g, ' ');
}

function toLicenseDateYYYYMMDD(s) {
  if (!s || typeof s !== 'string') return null;
  const t = s.trim();
  const m = t.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (t.match(/^\d{4}-\d{2}-\d{2}$/)) return t;
  return t;
}

/**
 * Завершить ЭПЛ: отправить Т5 в Такском, обновить запись epl.
 * @param {object} db - sqlite3 Database
 * @param {number} eplId - id записи epl
 * @param {number} endOdometer - пробег при заезде
 * @returns {Promise<{ distance: number }>}
 */
async function completeEplById(db, eplId, endOdometer) {
  const epl = await new Promise((resolve, reject) => {
    db.get(
      `SELECT e.id, e.mintransId, e.eplGuid, e.startOdometer, e.parkId,
              d.userId, u.fullName as driverName, u.licenseSerial, u.licenseNumber, u.licenseDate, u.personnelNumber, u.inn
       FROM epl e
       JOIN drivers d ON e.driverId = d.id
       LEFT JOIN users u ON d.userId = u.id
       WHERE e.id = ?`,
      [eplId],
      (err, row) => (err ? reject(err) : resolve(row))
    );
  });

  if (!epl) throw new Error('ЭПЛ не найден');
  // Для ЭПЛ, созданных через Playwright, mintransId может быть, но API может не находить документ по нему
  // Поэтому проверяем наличие хотя бы одного идентификатора
  if (!epl.mintransId && !epl.eplGuid) {
    throw new Error('У путевого нет mintransId или eplGuid');
  }

  let medicName = epl.driverName || 'Медицинский работник';
  let authorizedName = epl.driverName || 'Механик';
  let medicLicense = null;
  const staffList = await new Promise((resolve) => {
    db.all(
      `SELECT role, fullName, licenseSerial, licenseNumber, licenseDateStart, licenseDateEnd
       FROM park_staff
       WHERE parkId = ? AND role IN ('medic', 'technic') AND COALESCE(isActive,1) = 1
       ORDER BY COALESCE(priority,0) DESC, id DESC`,
      [epl.parkId],
      (staffErr, rows) => resolve(rows || [])
    );
  });
  staffList.forEach(s => {
    if (s.role === 'medic' && !medicLicense) {
      if ((s.fullName || '').trim()) medicName = normalizeFio(s.fullName);
      if ((s.licenseSerial || '').trim() || (s.licenseNumber || '').trim()) {
        medicLicense = {
          serial: (s.licenseSerial || '').trim() || '-',
          number: (s.licenseNumber || '').trim() || '-',
          dateStart: toLicenseDateYYYYMMDD(s.licenseDateStart) || '2020-01-01',
          dateEnd: toLicenseDateYYYYMMDD(s.licenseDateEnd) || '2030-01-01'
        };
      }
    }
    if (s.role === 'technic' && authorizedName === (epl.driverName || 'Механик') && (s.fullName || '').trim()) {
      authorizedName = normalizeFio(s.fullName);
    }
  });

  const eplIdForApi = epl.eplGuid || epl.mintransId;
  await TakskornAPI.completeRide(eplIdForApi, endOdometer, 'suitable', {
    driverName: epl.driverName || 'Водитель',
    medicName,
    authorizedName,
    licenseSerial: epl.licenseSerial,
    licenseNumber: epl.licenseNumber,
    licenseDate: epl.licenseDate,
    personnelNumber: epl.personnelNumber,
    inn: epl.inn,
    medic: medicLicense ? { license: medicLicense } : undefined
  });

  const distance = epl.startOdometer != null ? Math.max(0, endOdometer - epl.startOdometer) : null;

  await new Promise((resolve, reject) => {
    db.run(
      `INSERT OR IGNORE INTO epl_titles (eplId, titleCode, status) VALUES (?, 't5', 'filled')`,
      [eplId],
      (insErr) => { if (insErr) console.warn('[epl-complete] epl_titles t5 insert:', insErr.message); resolve(); }
    );
  });
  await new Promise((resolve, reject) => {
    db.run(
      `UPDATE epl SET endOdometer = ?, distance = ?, status = 'submitted', updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      [endOdometer, distance, eplId],
      (runErr) => (runErr ? reject(runErr) : resolve())
    );
  });

  // Обновляем смену: закрываем её (статус 'closed' для ручного закрытия, 'auto_closed' для автозакрытия)
  // Проверяем, есть ли уже запись о смене
  await new Promise((resolve) => {
    db.get(`SELECT id FROM shifts WHERE eplId = ?`, [eplId], (err, shift) => {
      if (err || !shift) {
        // Если смены нет, создаем её (на случай если ЭПЛ был создан до добавления логики shifts)
        db.run(
          `INSERT OR IGNORE INTO shifts (driverId, eplId, parkId, status, closedAt) VALUES (?, ?, ?, 'closed', CURRENT_TIMESTAMP)`,
          [epl.userId, eplId, epl.parkId],
          () => resolve()
        );
      } else {
        // Обновляем существующую смену
        db.run(
          `UPDATE shifts SET status = 'closed', closedAt = CURRENT_TIMESTAMP WHERE eplId = ?`,
          [eplId],
          () => resolve()
        );
      }
    });
  });

  return { distance };
}

module.exports = { completeEplById };
