/**
 * Джоб: раз в N минут проверяет ЭПЛ с PDF, но без documentQr, и генерирует QR на PDF.
 * Интервал по умолчанию 5 мин. Генерирует QR для всех ЭПЛ с documentPdf, у которых нет documentQr.
 */
const db = require('../database');
const crypto = require('crypto');
const QRCode = require('qrcode');

const INTERVAL_MINUTES = parseInt(process.env.DOCUMENT_QR_JOB_MINUTES, 10) || 5;
const INTERVAL_MS = INTERVAL_MINUTES * 60 * 1000;
const { publicAppUrl } = require('../utils/publicAppUrl');
const PUBLIC_APP_URL = publicAppUrl();

function generateDocumentQrForEpl(eplId, waybillNumber) {
  return new Promise((resolve, reject) => {
    db.get('SELECT documentPdf, documentQr FROM epl WHERE id = ?', [eplId], (checkErr, checkRow) => {
      if (checkErr) {
        console.warn(`[document-qr-job] EPL ${eplId}: ошибка проверки:`, checkErr.message);
        return reject(checkErr);
      }
      
      const hasPdf = checkRow && checkRow.documentPdf && checkRow.documentPdf.length > 0;
      const hasQr = checkRow && checkRow.documentQr && checkRow.documentQr.trim().length > 0;
      
      if (!hasPdf) {
        return resolve(false); // Нет PDF, пропускаем
      }
      
      if (hasQr) {
        return resolve(false); // QR уже есть, пропускаем
      }
      
      // Генерируем QR
      const documentToken = crypto.randomBytes(24).toString('hex');
      const documentUrl = `${PUBLIC_APP_URL}/api/public/epl-document/${eplId}?token=${documentToken}`;
      
      QRCode.toDataURL(documentUrl, { margin: 2, width: 400 }, (qrErr, dataUrl) => {
        if (qrErr) {
          console.error(`[document-qr-job] EPL ${eplId}: ошибка генерации QR:`, qrErr.message);
          return reject(qrErr);
        }
        
        if (!dataUrl || !dataUrl.startsWith('data:image')) {
          console.error(`[document-qr-job] EPL ${eplId}: QR сгенерирован, но неверный формат`);
          return reject(new Error('Invalid QR format'));
        }
        
        db.run(
          'UPDATE epl SET documentToken = ?, documentQr = ? WHERE id = ?',
          [documentToken, dataUrl, eplId],
          function (upErr) {
            if (upErr) {
              console.error(`[document-qr-job] EPL ${eplId}: ошибка сохранения:`, upErr.message);
              return reject(upErr);
            }
            
            console.log(`[document-qr-job] EPL ${eplId} (${waybillNumber || 'N/A'}): QR на PDF сгенерирован и сохранён`);
            resolve(true);
          }
        );
      });
    });
  });
}

function processEpls() {
  db.all(
    `SELECT id, waybillNumber
     FROM epl
     WHERE documentPdf IS NOT NULL AND length(documentPdf) > 0
       AND (documentQr IS NULL OR documentQr = '')
     ORDER BY id DESC
     LIMIT 10`,
    [],
    async (err, rows) => {
      if (err) {
        console.error('[document-qr-job] Ошибка запроса:', err.message);
        return;
      }
      
      if (!rows || rows.length === 0) {
        return; // Нет ЭПЛ для обработки
      }
      
      console.log(`[document-qr-job] Найдено ${rows.length} ЭПЛ с PDF без documentQr, генерирую QR...`);
      
      let processed = 0;
      let errors = 0;
      
      for (const row of rows) {
        try {
          const generated = await generateDocumentQrForEpl(row.id, row.waybillNumber);
          if (generated) processed++;
        } catch (error) {
          errors++;
          console.error(`[document-qr-job] Ошибка для EPL ${row.id}:`, error.message);
        }
      }
      
      if (processed > 0 || errors > 0) {
        console.log(`[document-qr-job] Обработано: ${processed}, ошибок: ${errors}`);
      }
    }
  );
}

let intervalId = null;

function start() {
  if (intervalId) {
    console.log('[document-qr-job] Уже запущен');
    return;
  }
  
  console.log(`[document-qr-job] Запуск: проверка каждые ${INTERVAL_MINUTES} мин, PUBLIC_APP_URL=${PUBLIC_APP_URL}`);
  
  // Первая проверка сразу при старте
  setTimeout(() => {
    processEpls();
  }, 10000); // Через 10 секунд после старта
  
  // Затем каждые N минут
  intervalId = setInterval(() => {
    processEpls();
  }, INTERVAL_MS);
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[document-qr-job] Остановлен');
  }
}

module.exports = { start, stop };
