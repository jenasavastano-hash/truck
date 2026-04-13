const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const dbPath = process.env.DB_PATH
  ? path.resolve(__dirname, String(process.env.DB_PATH))
  : path.join(__dirname, 'app.db');

console.log('[integrity-check] DB_PATH =', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('[integrity-check] open error:', err.message);
    process.exit(1);
  }

  db.get('PRAGMA integrity_check;', (e, row) => {
    if (e) {
      console.error('[integrity-check] pragma error:', e.message);
      process.exit(2);
    }
    const val = row && (row.integrity_check || row['integrity_check']);
    console.log('[integrity-check] result:', val);
    db.close(() => process.exit(val === 'ok' ? 0 : 3));
  });
});
