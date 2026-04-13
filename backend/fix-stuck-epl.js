/**
 * Скрипт: закрыть зависшие ЭПЛ и смены
 * Запуск: node fix-stuck-epl.js
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const DB_PATH = path.join(__dirname, 'app.db');
const db = new sqlite3.Database(DB_PATH);
const { CANCELABLE_BEFORE_TAXCOM, CLOSE_SHIFT_FAIL_STATUSES, sqlQuoteList } = require('./utils/epl-status');

console.log('=== Зависшие ЭПЛ (pending_clinic/draft/pending без QR) ===');
db.all(
  `SELECT id, waybillNumber, status, mintransId, qrCode IS NOT NULL as hasQr, createdAt 
   FROM epl 
   WHERE status IN (${sqlQuoteList(CLOSE_SHIFT_FAIL_STATUSES)}) 
   ORDER BY id DESC LIMIT 20`,
  (err, rows) => {
    if (err) { console.error(err); return; }
    console.log(rows && rows.length ? JSON.stringify(rows, null, 2) : '(нет зависших)');

    console.log('\n=== Активные смены ===');
    db.all(
      `SELECT * FROM shifts WHERE status = 'active' ORDER BY id DESC LIMIT 10`,
      (err2, shifts) => {
        if (err2) { console.error(err2); return; }
        console.log(shifts && shifts.length ? JSON.stringify(shifts, null, 2) : '(нет активных смен)');

        // Закрываем зависшие ЭПЛ
        db.run(
          `UPDATE epl SET status = 'failed', errorMessage = 'Закрыто вручную (fix-stuck)' 
           WHERE status IN (${sqlQuoteList(CANCELABLE_BEFORE_TAXCOM)}) AND (mintransId IS NULL OR mintransId = '')`,
          function(e) {
            if (e) console.error('Ошибка закрытия ЭПЛ:', e);
            else console.log(`\n✓ Закрыто зависших ЭПЛ (без mintransId): ${this.changes}`);

            // Закрываем активные смены
            db.run(
              `UPDATE shifts SET status = 'closed', closedAt = CURRENT_TIMESTAMP WHERE status = 'active'`,
              function(e2) {
                if (e2) console.error('Ошибка закрытия смен:', e2);
                else console.log(`✓ Закрыто активных смен: ${this.changes}`);

                console.log('\n=== Готово. Водитель может создать новый ЭПЛ. ===');
                db.close();
              }
            );
          }
        );
      }
    );
  }
);
