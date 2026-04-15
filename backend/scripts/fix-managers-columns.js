const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const dbPath = process.env.DB_PATH
  ? path.resolve(__dirname, '..', String(process.env.DB_PATH))
  : path.join(__dirname, '..', 'app.db');

const columnsInt = [
  ['canTopupBalance', 0],
  ['canFine', 0],
  ['canDismiss', 0],
  ['canDeleteDriver', 0],
  ['canShowBalanceBreakdown', 0],
  ['canAccessPhotoControl', 0],
  ['canAccessStatistics', 0],
  ['statsShowFinance', 1],
  ['statsShowEpl', 1],
  ['statsShowDrivers', 1],
  ['driverStatsShowBalance', 1],
  ['driverStatsShowEpl', 1],
  ['driverStatsShowShifts', 1],
  ['canViewEplLogs', 0],
  ['canControlEplQueue', 0],
  ['canCloseEplShifts', 0],
  ['canChargeOnShiftClose', 0],
  ['canDownloadEplDocs', 0],
  ['canChangeDriverPassword', 0],
  ['canAccessBroadcasts', 0],
  ['canAccessFinance', 0],
  ['financeShowKassa', 1],
  ['financeShowSalary', 1],
  ['financeShowParks', 1],
  ['financeShowMonthly', 1],
  ['financeScopeAll', 0]
];

const columnsText = [['managerType', 'park']];

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('[fix-managers-columns] DB open error:', err.message);
    process.exit(1);
  }
  console.log('[fix-managers-columns] DB_PATH =', dbPath);
  run();
});

function run() {
  db.serialize(() => {
    db.run(
      `CREATE TABLE IF NOT EXISTS managers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL UNIQUE,
        parkId INTEGER NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(userId) REFERENCES users(id),
        FOREIGN KEY(parkId) REFERENCES parks(id)
      )`,
      (createErr) => {
        if (createErr) {
          console.error('[fix-managers-columns] create managers error:', createErr.message);
          finish(2);
          return;
        }

        db.all(`PRAGMA table_info(managers)`, [], (pragmaErr, cols) => {
          if (pragmaErr || !cols) {
            console.error('[fix-managers-columns] pragma error:', pragmaErr ? pragmaErr.message : 'No cols');
            finish(3);
            return;
          }

          const existing = new Set(cols.map((c) => c.name));
          const queue = [];
          columnsInt.forEach(([name, def]) => {
            if (!existing.has(name)) queue.push(`ALTER TABLE managers ADD COLUMN ${name} INTEGER DEFAULT ${def}`);
          });
          columnsText.forEach(([name, def]) => {
            if (!existing.has(name)) queue.push(`ALTER TABLE managers ADD COLUMN ${name} TEXT DEFAULT '${def}'`);
          });

          let i = 0;
          const next = () => {
            if (i >= queue.length) {
              db.run(`UPDATE managers SET managerType = 'park' WHERE managerType IS NULL OR managerType = ''`, () => {
                console.log('[fix-managers-columns] Done. Added columns:', queue.length);
                finish(0);
              });
              return;
            }
            const sql = queue[i++];
            db.run(sql, (e) => {
              if (e && !/duplicate column name/i.test(e.message || '')) {
                console.warn('[fix-managers-columns] warn:', e.message);
              }
              next();
            });
          };
          next();
        });
      }
    );
  });
}

function finish(code) {
  db.close(() => process.exit(code));
}
