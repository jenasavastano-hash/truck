/**
 * Скрипт для генерации QR-кодов на PDF для существующих ЭПЛ
 * Запуск: node scripts/generate-document-qr.js
 * 
 * Находит все ЭПЛ с documentPdf, но без documentQr, и генерирует QR для каждого.
 */

const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { publicAppUrl } = require('../utils/publicAppUrl');

const DB_PATH = path.join(__dirname, '..', 'app.db');
const PUBLIC_APP_URL = publicAppUrl();

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('❌ Ошибка подключения к БД:', err.message);
    process.exit(1);
  }
  console.log('✅ Подключено к БД:', DB_PATH);
  console.log(`📡 PUBLIC_APP_URL: ${PUBLIC_APP_URL}\n`);
  processEpls();
});

function processEpls() {
  console.log('🔍 Ищу ЭПЛ с PDF, но без documentQr...\n');
  
  db.all(
    `SELECT id, waybillNumber, mintransId, 
            CASE WHEN documentPdf IS NOT NULL AND length(documentPdf) > 0 THEN 1 ELSE 0 END as hasPdf,
            CASE WHEN documentQr IS NOT NULL AND length(documentQr) > 0 THEN 1 ELSE 0 END as hasQr
     FROM epl
     WHERE documentPdf IS NOT NULL AND length(documentPdf) > 0
       AND (documentQr IS NULL OR documentQr = '')
     ORDER BY id DESC`,
    [],
    async (err, rows) => {
      if (err) {
        console.error('❌ Ошибка запроса:', err.message);
        db.close();
        process.exit(1);
      }

      if (!rows || rows.length === 0) {
        console.log('✅ Все ЭПЛ с PDF уже имеют documentQr. Ничего делать не нужно.\n');
        db.close();
        return;
      }

      console.log(`📋 Найдено ЭПЛ без documentQr: ${rows.length}\n`);
      console.log('Начинаю генерацию QR...\n');

      let processed = 0;
      let errors = 0;

      for (const row of rows) {
        const eplId = row.id;
        const waybillNumber = row.waybillNumber || `EPL-${eplId}`;
        
        try {
          const documentToken = crypto.randomBytes(24).toString('hex');
          const documentUrl = `${PUBLIC_APP_URL}/api/public/epl-document/${eplId}?token=${documentToken}`;
          
          console.log(`[${processed + 1}/${rows.length}] EPL ${eplId} (${waybillNumber}): генерирую QR...`);
          
          const dataUrl = await new Promise((resolve, reject) => {
            QRCode.toDataURL(documentUrl, { margin: 2, width: 400 }, (qrErr, dataUrl) => {
              if (qrErr) reject(qrErr);
              else resolve(dataUrl);
            });
          });

          if (!dataUrl || !dataUrl.startsWith('data:image')) {
            throw new Error('QR сгенерирован, но неверный формат');
          }

          await new Promise((resolve, reject) => {
            db.run(
              'UPDATE epl SET documentToken = ?, documentQr = ? WHERE id = ?',
              [documentToken, dataUrl, eplId],
              function (upErr) {
                if (upErr) reject(upErr);
                else resolve();
              }
            );
          });

          console.log(`  ✅ QR сохранён (documentToken=${documentToken.substring(0, 8)}..., QR длина=${dataUrl.length})`);
          processed++;
        } catch (error) {
          console.error(`  ❌ Ошибка для EPL ${eplId}:`, error.message);
          errors++;
        }
      }

      console.log('\n' + '='.repeat(50));
      console.log(`✅ Обработано: ${processed}`);
      if (errors > 0) {
        console.log(`❌ Ошибок: ${errors}`);
      }
      console.log('='.repeat(50) + '\n');

      db.close();
    }
  );
}
