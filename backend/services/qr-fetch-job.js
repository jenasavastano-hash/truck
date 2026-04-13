/**
 * Джоб: раз в N минут запрашивает QR по API Такском для ЭПЛ, у которых есть mintransId, но ещё нет qrCode.
 * Не блокирует создание ЭПЛ — QR подтягивается в фоне. Интервал по умолчанию 10 мин.
 */
const db = require('../database');
const TakskornAPI = require('../takskom-api');
const { ensureShiftExistsForEpl } = require('../utils/shifts');
const { DOC_POLLABLE, sqlQuoteList } = require('../utils/epl-status');

const INTERVAL_MINUTES = parseInt(process.env.QR_FETCH_JOB_MINUTES, 10) || 10;
const INTERVAL_MS = INTERVAL_MINUTES * 60 * 1000;
const LOOKBACK_HOURS = parseInt(process.env.QR_FETCH_LOOKBACK_HOURS, 10) || 24;
// Не запрашивать QR у ЭПЛ, созданных только что — в ГИС документ появляется с задержкой (3+ мин)
const MIN_AGE_MINUTES = parseInt(process.env.QR_FETCH_MIN_AGE_MINUTES, 10) || 3;
// При старте бэкенда: через сколько мс запросить QR для путевых с PDF без QR (1 мин)
const STARTUP_QR_DELAY_MS = 60000;

/** Один запрос QR по API и обновление ЭПЛ + уведомление водителю */
function fetchAndSaveQr(row) {
  TakskornAPI.getQRByWaybillNumber(row.waybillNumber)
    .then((qrRes) => {
      if (qrRes.success && qrRes.qr) {
        db.run(
          'UPDATE epl SET qrCode = ?, status = \'approved\', approvedAt = CURRENT_TIMESTAMP WHERE id = ? AND (qrCode IS NULL OR qrCode = \'\')',
          [qrRes.qr, row.eplId],
          function (uErr) {
            if (!uErr && this.changes > 0 && row.userId) {
              // На случай, если shifts не создался (fast-PDF мог упасть), гарантируем наличие смены.
              ensureShiftExistsForEpl(row.eplId, () => {});
              db.run(
                'INSERT INTO notifications (userId, type, title, body, eplId) VALUES (?, ?, ?, ?, ?)',
                [row.userId, 'epl_ready', 'Путевой лист готов', 'Откройте карточку путевого — QR-код готов.', row.eplId],
                () => {}
              );
              console.log(`[qr-fetch-job] QR сохранён для EPL ${row.eplId}, waybill ${row.waybillNumber} (старт).`);
            }
          }
        );
      }
    })
    .catch((e) => console.warn(`[qr-fetch-job] Старт: ошибка API для ${row.waybillNumber}:`, e.message));
}

/**
 * При перезапуске бэкенда: путевые с загруженным PDF, но без QR — запросить QR через минуту.
 */
function runStartupQrForPdfOnly() {
  db.all(
    `SELECT e.id as eplId, e.waybillNumber, d.userId
     FROM epl e
     JOIN drivers d ON e.driverId = d.id
     WHERE e.documentPdf IS NOT NULL AND length(e.documentPdf) > 0
       AND (e.qrCode IS NULL OR e.qrCode = '')
       AND e.status IN (${sqlQuoteList(DOC_POLLABLE)})
       AND e.mintransId IS NOT NULL
     ORDER BY e.updatedAt DESC
     LIMIT 50`,
    [],
    (err, rows) => {
      if (err) {
        console.warn('[qr-fetch-job] Старт: ошибка выборки ЭПЛ с PDF без QR:', err.message);
        return;
      }
      if (!rows || rows.length === 0) return;
      console.log(`[qr-fetch-job] При старте: ${rows.length} путевых с PDF без QR — запрос QR через ${STARTUP_QR_DELAY_MS / 1000} сек.`);
      rows.forEach((row) => {
        setTimeout(() => fetchAndSaveQr(row), STARTUP_QR_DELAY_MS);
      });
    }
  );
}

function run() {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const minAgeAgo = new Date(Date.now() - MIN_AGE_MINUTES * 60 * 1000).toISOString();
  db.all(
    `SELECT e.id as eplId, e.waybillNumber, e.eplGuid, e.mintransId, d.userId
     FROM epl e
     JOIN drivers d ON e.driverId = d.id
     WHERE e.mintransId IS NOT NULL
       AND (e.qrCode IS NULL OR e.qrCode = '')
       AND e.status IN (${sqlQuoteList(DOC_POLLABLE)})
       AND e.createdAt >= ?
       AND e.createdAt <= ?`,
    [since, minAgeAgo],
    (err, rows) => {
      if (err) {
        console.warn('[qr-fetch-job] Select error:', err.message);
        return;
      }
      if (!rows || rows.length === 0) {
        return;
      }
      console.log(`[qr-fetch-job] ЭПЛ без QR: ${rows.length}, запрашиваю API Такском (waybill: ${rows.map(r => r.waybillNumber).join(', ')})...`);
      let done = 0;
      rows.forEach((row) => {
        TakskornAPI.getQRByWaybillNumber(row.waybillNumber)
          .then((qrRes) => {
            if (qrRes.success && qrRes.qr) {
              const updateData = { qrCode: qrRes.qr, status: 'approved' };
              if (qrRes.eplGuid && !row.eplGuid) updateData.eplGuid = qrRes.eplGuid;
              if (qrRes.mintransId && !row.mintransId) updateData.mintransId = qrRes.mintransId;
              const updateSql = Object.keys(updateData).map((k) => `${k} = ?`).join(', ');
              const updateValues = [...Object.values(updateData), row.eplId];
              db.run(`UPDATE epl SET ${updateSql} WHERE id = ?`, updateValues, () => {});
              ensureShiftExistsForEpl(row.eplId, () => {});
              db.run(
                'INSERT INTO notifications (userId, type, title, body, eplId) VALUES (?, ?, ?, ?, ?)',
                [row.userId, 'epl_ready', 'Путевой лист готов', 'Откройте карточку путевого — QR-код готов.', row.eplId],
                () => {}
              );
              console.log(`[qr-fetch-job] QR сохранён для EPL ${row.eplId}, waybill ${row.waybillNumber}`);
            } else {
              console.log(`[qr-fetch-job] API Такском вернул пустой QR для ${row.waybillNumber} — попробуйте qr-fetcher (см. ниже)`);
            }
          })
          .catch((e) => {
            console.warn(`[qr-fetch-job] Ошибка API для ${row.waybillNumber}:`, e.message);
          })
          .finally(() => {
            done++;
          });
      });
    }
  );
}

function start() {
  console.log(`[qr-fetch-job] Запущен: интервал ${INTERVAL_MINUTES} мин, ЭПЛ не моложе ${MIN_AGE_MINUTES} мин`);
  console.log('[qr-fetch-job] QR через API Такском часто пустой. Чтобы подхватывать QR со страницы путевого, на ПК клиники запустите: node qr-fetcher.js (в папке signer-client)');
  run();
  runStartupQrForPdfOnly(); // при перезапуске — через минуту запросить QR для последних путевых с PDF без QR
  setInterval(run, INTERVAL_MS);
}

module.exports = { run, start };
