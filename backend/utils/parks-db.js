/**
 * Централизованные проверки для таблицы parks и дочерних таблиц.
 * Гарантируют наличие таблицы parks и при необходимости — строки парка (для избежания FK ошибок).
 */

const db = require('../database');

const PARKS_SCHEMA = `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT,
  postalIndex TEXT, region TEXT, regionCode TEXT, city TEXT, street TEXT, house TEXT,
  ogrn TEXT, inn TEXT, kpp TEXT,
  takskornId TEXT, takskornPassword TEXT, memberId TEXT,
  phone TEXT, email TEXT, district TEXT, locality TEXT, housing TEXT, flat TEXT,
  syncedWithTakskom INTEGER DEFAULT 0, lastSyncAt DATETIME,
  eplCreationMode TEXT DEFAULT 'clinic_api',
  balanceDeductionOrder TEXT DEFAULT 'real_first',
  isActive INTEGER DEFAULT 0,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
`;

function dropParksOldUniqueFixRefs(callback) {
  const badRefs = [
    'parks_old_unique_fix',
    'parks_backup_takskornid',
    'parks_backup_taskskornid',
    'parks_backup_taskskornil'
  ];
  const refs = Array.from(new Set(badRefs));
  let idx = 0;

  const processNext = () => {
    if (idx >= refs.length) {
      ensureParksOldUniqueFixStub(callback);
      return;
    }
    const badTable = refs[idx++];
    db.all(
      `SELECT type, name FROM sqlite_master WHERE (type='trigger' OR type='view') AND sql LIKE ?`,
      ['%' + badTable + '%'],
      (err, rows) => {
        if (err || !rows || rows.length === 0) {
          processNext();
          return;
        }
        let n = 0;
        const done = () => {
          n++;
          if (n >= rows.length) processNext();
        };
        rows.forEach((r) => {
          db.run(`DROP ${r.type.toUpperCase()} IF EXISTS ${r.name}`, () => done());
        });
      }
    );
  };

  processNext();
}

function ensureParksOldUniqueFixStub(callback) {
  const stubTables = [
    'parks_old_unique_fix',
    'parks_backup_takskornid',
    'parks_backup_taskskornid',
    'parks_backup_taskskornil'
  ];
  let i = 0;
  const ensureOne = () => {
    if (i >= stubTables.length) {
      callback();
      return;
    }
    const t = stubTables[i++];
    db.run(`CREATE TABLE IF NOT EXISTS ${t} (${PARKS_SCHEMA})`, (e) => {
      if (!e) console.log('[parks-db] Ensured stub table:', t);
      ensureOne();
    });
  };
  ensureOne();
}

/**
 * Гарантирует наличие таблицы parks (восстановление из бэка или создание минимальной).
 * @param {Function} callback - вызывается без аргументов когда готово
 */
function ensureParksTable(callback) {
  db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='parks'`, [], (err, row) => {
    if (!err && row) {
      dropParksOldUniqueFixRefs(() => callback());
      return;
    }
    const tryRename = (oldName, next) => {
      db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [oldName], (e, r) => {
        if (e || !r) return next();
        db.run(`ALTER TABLE ${oldName} RENAME TO parks`, (e2) => {
          if (!e2) {
            console.log('[parks-db] Recovered parks table from', oldName);
            dropParksOldUniqueFixRefs(() => callback());
            return;
          }
          next();
        });
      });
    };
    tryRename('parks_backup_takskornid', () => {
      tryRename('parks_backup_taskskornid', () => {
        tryRename('parks_backup_taskskornil', () => {
      tryRename('parks_old_unique_fix', () => {
        db.run(`CREATE TABLE IF NOT EXISTS parks (${PARKS_SCHEMA})`, (e3) => {
          if (!e3) console.log('[parks-db] Created minimal parks table');
          dropParksOldUniqueFixRefs(() => callback());
        });
      });
        });
      });
    });
  });
}

/**
 * Гарантирует наличие строки парка с указанным id (для избежания FOREIGN KEY при вставке в дочерние таблицы).
 * @param {number} parkId - id парка
 * @param {string|null} nameOrNull - имя парка (если создаём новую строку)
 * @param {Object} options - опции: eplCreationMode, balanceDeductionOrder
 * @param {Function} callback - (err) => {} — err только при реальной ошибке БД
 */
function ensureParkExists(parkId, nameOrNull, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  const name = (nameOrNull && String(nameOrNull).trim()) || `Парк ${parkId}`;
  const eplMode = options.eplCreationMode || 'takskom_api';
  const deductionOrder = options.balanceDeductionOrder || 'real_first';

  db.get('SELECT id FROM parks WHERE id = ?', [parkId], (err, row) => {
    if (err) return callback(err);
    if (row) return callback(null);
    db.run(
      `INSERT OR IGNORE INTO parks (id, name, eplCreationMode, balanceDeductionOrder, isActive, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, 0, datetime('now'), datetime('now'))`,
      [parkId, name, eplMode, deductionOrder],
      (insErr) => {
        if (insErr) return callback(insErr);
        console.log('[parks-db] Created missing park row id=', parkId);
        callback(null);
      }
    );
  });
}

module.exports = {
  ensureParksTable,
  ensureParkExists,
  dropParksOldUniqueFixRefs,
  ensureParksOldUniqueFixStub
};
