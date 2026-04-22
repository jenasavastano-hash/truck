const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DB_PATH
  ? path.resolve(__dirname, String(process.env.DB_PATH))
  : path.join(__dirname, 'app.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Database error:', err);
    return;
  }
  console.log('Connected to SQLite database');
  // Отключаем проверку FK при подключении — порядок миграций и восстановления parks может иначе вызывать ошибки
  db.run('PRAGMA foreign_keys = OFF', (e) => {
    if (e) console.warn('PRAGMA foreign_keys OFF:', e.message);
  });
});

// Инициализация БД; callback вызывается после всех миграций (сервер должен стартовать после)
const runMigrations = (callback) => {
  let pending = 4;
  const onDone = () => {
    pending--;
    if (pending === 0) {
      db.run('PRAGMA foreign_keys = OFF', (e) => {
        if (e) console.warn('PRAGMA foreign_keys OFF (after migrations):', e.message);
        callback();
      });
    }
  };

  // Восстановление parks до всех миграций (если таблица переименована после сбоя)
  const runRest = () => {
  db.serialize(() => {
    // ===== ОСНОВНЫЕ ТАБЛИЦЫ =====
    
    // Таблица пользователей (админ, менеджер, водитель)
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        fullName TEXT,
        firstName TEXT,
        lastName TEXT,
        secondName TEXT,
        phone TEXT,
        email TEXT,
        role TEXT NOT NULL CHECK(role IN ('admin', 'manager', 'driver', 'director', 'evacuator', 'commissioner')),
        parkId INTEGER,
        isVerified INTEGER DEFAULT 0,
        carId INTEGER,
        balance REAL DEFAULT 0,
        
        -- Данные водителя (из Такскома)
        inn TEXT,
        snils TEXT,
        licenseSerial TEXT,
        licenseNumber TEXT,
        licenseDate TEXT,
        personnelNumber TEXT,
        
        -- Флаги для смены пароля
        mustChangePassword INTEGER DEFAULT 1,
        firstLogin INTEGER DEFAULT 1,

        -- Метка подмены ИНН (когда Такском не пропускает водителя)
        innMutationApplied INTEGER DEFAULT 0,
        innMutationOriginalInn TEXT,
        innMutationAt DATETIME,
        
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(parkId) REFERENCES parks(id)
      )
    `);

    // Ensure 'mustChangePassword' and 'firstLogin' columns exist for users (migration for older DBs)
    db.all(`PRAGMA table_info(users)`, [], (err, cols) => {
      if (err) return console.warn('Failed to read users table info:', err.message);
      const hasMust = cols && cols.some(c => c.name === 'mustChangePassword');
      const hasFirst = cols && cols.some(c => c.name === 'firstLogin');
      const hasInnMutationApplied = cols && cols.some(c => c.name === 'innMutationApplied');
      const hasInnMutationOriginalInn = cols && cols.some(c => c.name === 'innMutationOriginalInn');
      const hasInnMutationAt = cols && cols.some(c => c.name === 'innMutationAt');
      if (!hasMust) {
        db.run(`ALTER TABLE users ADD COLUMN mustChangePassword INTEGER DEFAULT 0`, (e) => {
          if (e) console.warn('Failed to add mustChangePassword column:', e.message);
          else console.log('Migrated users: added mustChangePassword column');
        });
      }
      if (!hasFirst) {
        db.run(`ALTER TABLE users ADD COLUMN firstLogin INTEGER DEFAULT 1`, (e) => {
          if (e) console.warn('Failed to add firstLogin column:', e.message);
          else console.log('Migrated users: added firstLogin column');
        });
      }

      if (!hasInnMutationApplied) {
        db.run(`ALTER TABLE users ADD COLUMN innMutationApplied INTEGER DEFAULT 0`, (e) => {
          if (e) console.warn('Failed to add innMutationApplied column:', e.message);
          else console.log('Migrated users: added innMutationApplied column');
        });
      }
      if (!hasInnMutationOriginalInn) {
        db.run(`ALTER TABLE users ADD COLUMN innMutationOriginalInn TEXT`, (e) => {
          if (e) console.warn('Failed to add innMutationOriginalInn column:', e.message);
          else console.log('Migrated users: added innMutationOriginalInn column');
        });
      }
      if (!hasInnMutationAt) {
        db.run(`ALTER TABLE users ADD COLUMN innMutationAt DATETIME`, (e) => {
          if (e) console.warn('Failed to add innMutationAt column:', e.message);
          else console.log('Migrated users: added innMutationAt column');
        });
      }
      const hasBalanceReal = cols && cols.some(c => c.name === 'balanceReal');
      const hasBalanceUnreal = cols && cols.some(c => c.name === 'balanceUnreal');
      const hasLicenseSerial = cols && cols.some(c => c.name === 'licenseSerial');
      const hasLicenseNumber = cols && cols.some(c => c.name === 'licenseNumber');
      const hasLicenseDate = cols && cols.some(c => c.name === 'licenseDate');
      const runAfterUsersMigration = () => {
        onDone();
      };
      const addLicenseColumnsIfNeeded = (cb) => {
        const toAdd = [];
        if (!hasLicenseSerial) toAdd.push('licenseSerial TEXT');
        if (!hasLicenseNumber) toAdd.push('licenseNumber TEXT');
        if (!hasLicenseDate) toAdd.push('licenseDate TEXT');
        if (toAdd.length === 0) return cb();
        let i = 0;
        const runOne = () => {
          if (i >= toAdd.length) return cb();
          const def = toAdd[i++];
          const colName = def.split(' ')[0];
          db.run(`ALTER TABLE users ADD COLUMN ${colName} TEXT`, (e) => {
            if (e) console.warn('Failed to add users.' + colName + ':', e.message);
            else console.log('Migrated users: added ' + colName + ' column');
            runOne();
          });
        };
        runOne();
      };

      if (!hasBalanceReal && !hasBalanceUnreal) {
        db.run(`ALTER TABLE users ADD COLUMN balanceReal REAL DEFAULT 0`, (e) => {
          if (e) console.warn('Failed to add balanceReal:', e.message);
          else console.log('Migrated users: added balanceReal column');
          db.run(`ALTER TABLE users ADD COLUMN balanceUnreal REAL DEFAULT 0`, (e2) => {
            if (e2) console.warn('Failed to add balanceUnreal:', e2.message);
            else console.log('Migrated users: added balanceUnreal column');
            db.run(`UPDATE users SET balanceReal = COALESCE(balance, 0) WHERE balanceReal = 0 OR balanceReal IS NULL`, () => addLicenseColumnsIfNeeded(runAfterUsersMigration));
          });
        });
      } else if (!hasBalanceReal) {
        db.run(`ALTER TABLE users ADD COLUMN balanceReal REAL DEFAULT 0`, (e) => {
          if (e) console.warn('Failed to add balanceReal:', e.message);
          else console.log('Migrated users: added balanceReal column');
          db.run(`UPDATE users SET balanceReal = COALESCE(balance, 0) WHERE balanceReal = 0 OR balanceReal IS NULL`, () => addLicenseColumnsIfNeeded(runAfterUsersMigration));
        });
      } else if (!hasBalanceUnreal) {
        db.run(`ALTER TABLE users ADD COLUMN balanceUnreal REAL DEFAULT 0`, (e) => {
          if (e) console.warn('Failed to add balanceUnreal:', e.message);
          else console.log('Migrated users: added balanceUnreal column');
          addLicenseColumnsIfNeeded(runAfterUsersMigration);
        });
      } else {
        addLicenseColumnsIfNeeded(runAfterUsersMigration);
      }
    });

    db.all(`PRAGMA table_info(balance_history)`, [], (err, bCols) => {
      if (err || !bCols) { onDone(); return; }
      // Таблицы ещё нет — CREATE TABLE ниже по коду создаст её уже с amountType
      if (bCols.length === 0) {
        onDone();
        return;
      }
      const hasAmountType = bCols.some(c => c.name === 'amountType');
      if (!hasAmountType) {
        db.run(`ALTER TABLE balance_history ADD COLUMN amountType TEXT`, (e) => {
          if (e) {
            const msg = e.message || '';
            if (!/duplicate column name/i.test(msg)) console.warn('balance_history amountType:', msg);
          } else {
            console.log('Migrated balance_history: added amountType column');
          }
          onDone();
        });
        return;
      }
      onDone();
    });

    db.all(`PRAGMA table_info(managers)`, [], (err, mCols) => {
      if (err || !mCols) { onDone(); return; }

      const ensureManagersColumns = (cols) => {
        const hasCol = (name) => cols.some((c) => c.name === name);
        const queue = [];
        const addInt = (name, def) => {
          if (!hasCol(name)) queue.push({
            sql: `ALTER TABLE managers ADD COLUMN ${name} INTEGER DEFAULT ${def}`,
            label: name
          });
        };
        const addText = (name, def) => {
          if (!hasCol(name)) queue.push({
            sql: `ALTER TABLE managers ADD COLUMN ${name} TEXT DEFAULT '${def}'`,
            label: name
          });
        };

        addInt('canTopupBalance', 0);
        addInt('canFine', 0);
        addInt('canDismiss', 0);
        addInt('canDeleteDriver', 0);
        addInt('canShowBalanceBreakdown', 0);
        addInt('canAccessPhotoControl', 0);
        addInt('canAccessStatistics', 0);
        addInt('statsShowFinance', 1);
        addInt('statsShowEpl', 1);
        addInt('statsShowDrivers', 1);
        // Статистика водителя (карточка водителя): видимость блоков
        addInt('driverStatsShowBalance', 1);
        addInt('driverStatsShowEpl', 1);
        addInt('driverStatsShowShifts', 1);
        // Доступы по ЭПЛ: просмотр логов и управление очередью QR
        addInt('canViewEplLogs', 0);
        addInt('canControlEplQueue', 0);
        // Новые доступы по ЭПЛ: закрытие смен и скачивание документов
        addInt('canCloseEplShifts', 0);
        addInt('canChargeOnShiftClose', 0);
        addInt('canDownloadEplDocs', 0);
        // Доступ: смена пароля водителя (в карточке водителя)
        addInt('canChangeDriverPassword', 0);
        // Доступ: рассылки/мониторинг водителей (в менеджерке)
        addInt('canAccessBroadcasts', 0);
        // Доступ: Касса (финансовый дашборд)
        addInt('canAccessFinance', 0);
        addInt('financeShowKassa', 1);
        addInt('financeShowSalary', 1);
        addInt('financeShowParks', 1);
        addInt('financeShowMonthly', 1);
        addInt('financeScopeAll', 0);
        addText('managerType', 'park');

        if (queue.length === 0) { onDone(); return; }
        let i = 0;
        const runNext = () => {
          if (i >= queue.length) {
            db.run(`UPDATE managers SET managerType = 'park' WHERE managerType IS NULL OR managerType = ''`, () => onDone());
            return;
          }
          const item = queue[i++];
          db.run(item.sql, (e) => {
            if (e) {
              const msg = e.message || '';
              if (!/duplicate column name/i.test(msg)) console.warn('Failed to add managers.' + item.label + ':', msg);
            } else {
              console.log('Migrated managers: added ' + item.label);
            }
            runNext();
          });
        };
        runNext();
      };

      if (mCols.length === 0) {
        db.run(`
          CREATE TABLE IF NOT EXISTS managers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER NOT NULL UNIQUE,
            parkId INTEGER NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(userId) REFERENCES users(id),
            FOREIGN KEY(parkId) REFERENCES parks(id)
          )
        `, (createErr) => {
          if (createErr) { onDone(); return; }
          db.all(`PRAGMA table_info(managers)`, [], (e2, cols2) => {
            if (e2 || !cols2) { onDone(); return; }
            ensureManagersColumns(cols2);
          });
        });
        return;
      }

      ensureManagersColumns(mCols);
    });

    // Таблица директоров парка (права как у менеджера, но по умолчанию всё включено)
    db.run(`
      CREATE TABLE IF NOT EXISTS directors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        parkId INTEGER NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(userId) REFERENCES users(id),
        FOREIGN KEY(parkId) REFERENCES parks(id),
        UNIQUE(userId, parkId)
      )
    `);

    // Миграции колонок прав для directors (аналог managers, но дефолты = 1)
    db.all(`PRAGMA table_info(directors)`, [], (err, dCols) => {
      if (err || !dCols) { onDone(); return; }
      const add = (name, def) => {
        if (dCols.some(c => c.name === name)) return;
        try {
          db.run(`ALTER TABLE directors ADD COLUMN ${name} INTEGER DEFAULT ${def}`);
          console.log('Migrated directors: added ' + name);
        } catch (e) {
          console.warn('Failed to add directors.' + name, e.message);
        }
      };
      // Финансы/штрафы/увольнения/удаления
      add('canTopupBalance', 1);
      add('canFine', 1);
      add('canDismiss', 1);
      add('canDeleteDriver', 1);
      add('canShowBalanceBreakdown', 1);
      // Модули
      add('canAccessPhotoControl', 1);
      add('canAccessStatistics', 1);
      add('statsShowFinance', 1);
      add('statsShowEpl', 1);
      add('statsShowDrivers', 1);
      // Статистика водителя (карточка водителя): видимость блоков
      add('driverStatsShowBalance', 1);
      add('driverStatsShowEpl', 1);
      add('driverStatsShowShifts', 1);
      // ЭПЛ
      add('canViewEplLogs', 1);
      add('canControlEplQueue', 1);
      add('canCloseEplShifts', 1);
      add('canChargeOnShiftClose', 1);
      add('canDownloadEplDocs', 1);
      // Пользователи
      add('canChangeDriverPassword', 1);
      add('canAccessBroadcasts', 1);
      // Доступ: управление настройками парка (как в админке, но только своего парка)
      add('canManageParkSettings', 0);
      add('canParkSettingsStatusName', 0);
      add('canParkSettingsTakskom', 0);
      add('canParkSettingsStaff', 0);
      add('canParkSettingsFreight', 0);
      add('canParkSettingsBroadcasts', 0);
      add('canParkSettingsOwners', 0);
      add('canParkSettingsBalance', 0);
      add('canParkSettingsPricing', 0);
      add('canParkSettingsGame', 0);
      add('canParkSettingsPhotoControl', 0);
      add('canParkSettingsServices', 0);
      // Доступ: Касса (финансовый дашборд)
      add('canAccessFinance', 0);
      add('financeShowKassa', 1);
      add('financeShowSalary', 1);
      add('financeShowParks', 1);
      add('financeShowMonthly', 1);
      add('financeScopeAll', 0);
      onDone();
    });

    // Таблица менеджеров (создаётся выше), миграция уникальности userId -> (userId, parkId)
    db.get(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'managers'`,
      [],
      (err, row) => {
        if (!err && row && row.sql && row.sql.includes('userId INTEGER NOT NULL UNIQUE')) {
          console.log('Migrating managers table to allow multiple parks per manager...');
          db.serialize(() => {
            db.run(`ALTER TABLE managers RENAME TO managers_old`, (e1) => {
              if (e1) {
                console.warn('Failed to rename managers table:', e1.message);
              } else {
                db.run(
                  `CREATE TABLE IF NOT EXISTS managers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId INTEGER NOT NULL,
                    parkId INTEGER NOT NULL,
                    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(userId) REFERENCES users(id),
                    FOREIGN KEY(parkId) REFERENCES parks(id)
                  )`,
                  (e2) => {
                    if (e2) {
                      console.warn('Failed to create new managers table:', e2.message);
                    } else {
                      db.run(
                        `INSERT INTO managers (userId, parkId, createdAt)
                         SELECT userId, parkId, createdAt FROM managers_old`,
                        (e3) => {
                          if (e3) {
                            console.warn('Failed to copy data to new managers table:', e3.message);
                          } else {
                            console.log('Managers table migrated successfully.');
                          }
                        }
                      );
                    }
                  }
                );
              }
            });
          });
        } else {
          // Если есть старая таблица managers_old и новая managers пуста — пробуем докопировать данные
          db.get(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'managers_old'`,
            [],
            (oldErr, oldRow) => {
              if (!oldErr && oldRow) {
                db.get(`SELECT COUNT(*) as c FROM managers`, [], (cntErr, cntRow) => {
                  if (!cntErr && cntRow && cntRow.c === 0) {
                    console.log('Found managers_old with data and empty managers table — copying data back.');
                    db.run(
                      `INSERT INTO managers (userId, parkId, createdAt)
                       SELECT userId, parkId, createdAt FROM managers_old`,
                      (copyErr) => {
                        if (copyErr) {
                          console.warn('Failed to copy data from managers_old:', copyErr.message);
                        } else {
                          console.log('Managers restored from managers_old.');
                        }
                      }
                    );
                  }
                });
              }
            }
          );
        }
      }
    );

    // Таблица парков
    db.run(`
      CREATE TABLE IF NOT EXISTS parks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        address TEXT,

        -- Почтовые и адресные поля для карточки парка
        postalIndex TEXT,
        region TEXT,
        regionCode TEXT,
        city TEXT,
        street TEXT,
        house TEXT,
        
        -- Реквизиты организации для ЭПЛ
        ogrn TEXT,
        inn TEXT,
        kpp TEXT,
        
        -- Интеграция с Такском
        takskornId TEXT UNIQUE,
        takskornPassword TEXT,
        memberId TEXT,
        
        -- Контакты
        phone TEXT,
        
        syncedWithTakskom INTEGER DEFAULT 0,
        lastSyncAt DATETIME,
        eplAccessMode TEXT DEFAULT 'all',
        
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Таблица владельцев/арендодателей ТС внутри парка (юрлица / ИП)
    db.run(`
      CREATE TABLE IF NOT EXISTS park_owners (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parkId INTEGER NOT NULL,
        
        -- Тип лица: юридическое / индивидуальный предприниматель
        type TEXT NOT NULL CHECK(type IN ('legal', 'individual')),
        -- Роль: собственник (С) или арендодатель (А)
        role TEXT NOT NULL CHECK(role IN ('С', 'А')),
        
        -- Наименование / ФИО
        name TEXT NOT NULL,
        
        -- Реквизиты
        inn TEXT,
        ogrn TEXT,
        ogrnip TEXT,
        kpp TEXT,
        
        -- Контакты
        phone TEXT,
        email TEXT,
        
        -- Адрес
        postalIndex TEXT,
        regionCode TEXT,
        district TEXT,
        city TEXT,
        locality TEXT,
        street TEXT,
        house TEXT,
        housing TEXT,
        flat TEXT,
        
        -- Владелец по умолчанию для новых авто
        isDefault INTEGER DEFAULT 0,
        
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        FOREIGN KEY(parkId) REFERENCES parks(id) ON DELETE CASCADE
      )
    `);

    // Таблица сотрудников парка (медик, механик, диспетчер)
    db.run(`
      CREATE TABLE IF NOT EXISTS park_staff (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parkId INTEGER NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('medic', 'technic', 'dispatcher')),
        
        -- ФИО
        fullName TEXT NOT NULL,
        firstName TEXT,
        lastName TEXT,
        secondName TEXT,
        
        -- Должность и контакты
        position TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        authorityBasis TEXT,
        
        -- Лицензия медика (для медика)
        licenseSerial TEXT,
        licenseNumber TEXT,
        licenseDateStart TEXT,
        licenseDateEnd TEXT,
        isActive INTEGER DEFAULT 1,
        priority INTEGER DEFAULT 0,
        
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        FOREIGN KEY(parkId) REFERENCES parks(id) ON DELETE CASCADE
      )
    `);

    // Миграция: добавление полей phone, email, authorityBasis если их нет
    db.all(`PRAGMA table_info(park_staff)`, [], (err, cols) => {
      if (err) return;
      const hasPhone = cols && cols.some(c => c.name === 'phone');
      const hasEmail = cols && cols.some(c => c.name === 'email');
      const hasAuthorityBasis = cols && cols.some(c => c.name === 'authorityBasis');
      
      if (!hasPhone) {
        db.run(`ALTER TABLE park_staff ADD COLUMN phone TEXT`, (e) => {
          if (!e) console.log('Migrated park_staff: added phone column');
        });
      }
      if (!hasEmail) {
        db.run(`ALTER TABLE park_staff ADD COLUMN email TEXT`, (e) => {
          if (!e) console.log('Migrated park_staff: added email column');
        });
      }
      if (!hasAuthorityBasis) {
        db.run(`ALTER TABLE park_staff ADD COLUMN authorityBasis TEXT`, (e) => {
          if (!e) console.log('Migrated park_staff: added authorityBasis column');
        });
      }

      const hasTaxcomLogin = cols && cols.some(c => c.name === 'taxcomLogin');
      const hasTaxcomPassword = cols && cols.some(c => c.name === 'taxcomPassword');
      const hasIsActive = cols && cols.some(c => c.name === 'isActive');
      const hasPriority = cols && cols.some(c => c.name === 'priority');
      if (!hasTaxcomLogin) {
        db.run(`ALTER TABLE park_staff ADD COLUMN taxcomLogin TEXT`, (e) => {
          if (!e) console.log('Migrated park_staff: added taxcomLogin column');
        });
      }
      if (!hasTaxcomPassword) {
        db.run(`ALTER TABLE park_staff ADD COLUMN taxcomPassword TEXT`, (e) => {
          if (!e) console.log('Migrated park_staff: added taxcomPassword column');
        });
      }
      if (!hasIsActive) {
        db.run(`ALTER TABLE park_staff ADD COLUMN isActive INTEGER DEFAULT 1`, (e) => {
          if (!e) console.log('Migrated park_staff: added isActive column');
        });
      }
      if (!hasPriority) {
        db.run(`ALTER TABLE park_staff ADD COLUMN priority INTEGER DEFAULT 0`, (e) => {
          if (!e) console.log('Migrated park_staff: added priority column');
        });
      }
    });

    db.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='park_staff'`, [], (psErr, psRow) => {
      if (psErr || !psRow || !psRow.sql) return;
      const sqlLower = String(psRow.sql).toLowerCase();
      if (!sqlLower.includes('unique(parkid, role)') && !sqlLower.includes('unique (parkid, role)')) {
        return;
      }
      db.run(`ALTER TABLE park_staff RENAME TO park_staff_old_unique`, (renErr) => {
        if (renErr) return;
        db.run(
          `CREATE TABLE IF NOT EXISTS park_staff (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            parkId INTEGER NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('medic', 'technic', 'dispatcher')),
            fullName TEXT NOT NULL,
            firstName TEXT,
            lastName TEXT,
            secondName TEXT,
            position TEXT NOT NULL,
            phone TEXT,
            email TEXT,
            authorityBasis TEXT,
            licenseSerial TEXT,
            licenseNumber TEXT,
            licenseDateStart TEXT,
            licenseDateEnd TEXT,
            taxcomLogin TEXT,
            taxcomPassword TEXT,
            isActive INTEGER DEFAULT 1,
            priority INTEGER DEFAULT 0,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(parkId) REFERENCES parks(id) ON DELETE CASCADE
          )`,
          (createErr) => {
            if (createErr) return;
            db.run(
              `INSERT INTO park_staff
                 (id, parkId, role, fullName, firstName, lastName, secondName, position, phone, email, authorityBasis,
                  licenseSerial, licenseNumber, licenseDateStart, licenseDateEnd, taxcomLogin, taxcomPassword, isActive, priority, createdAt, updatedAt)
               SELECT id, parkId, role, fullName, firstName, lastName, secondName, position, phone, email, authorityBasis,
                      licenseSerial, licenseNumber, licenseDateStart, licenseDateEnd, NULL, NULL,
                      1, 0, createdAt, updatedAt
               FROM park_staff_old_unique`,
              (copyErr) => {
                if (copyErr) return;
                db.run(`DROP TABLE park_staff_old_unique`, () => {});
                console.log('Migrated park_staff: removed UNIQUE(parkId, role), added active/priority model');
              }
            );
          }
        );
      });
    });

    // Миграция: убрать UNIQUE с parks.takskornId (чтобы несколько парков могли использовать один Такском-парк)
    // Поддерживаем оба имени временной таблицы (старый код использовал parks_old_unique_fix).
    const TEMP_PARKS = 'parks_backup_takskornid';
    const TEMP_PARKS_ALT = 'parks_old_unique_fix';
    db.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='parks'`, [], (err, row) => {
      if (err || !row || !row.sql) return;
      const sqlLower = row.sql.toLowerCase();
      const hasUniqueTakskornId = /takskornid\s+text\s+unique/.test(sqlLower) || (sqlLower.includes('takskornid') && sqlLower.includes('unique'));
      if (!hasUniqueTakskornId) return;
      db.all(`PRAGMA table_info(parks)`, [], (err2, cols) => {
        if (err2 || !cols || cols.length === 0) return;
        const newTableCols = ['id','name','address','postalIndex','region','regionCode','city','street','house','ogrn','inn','kpp','takskornId','takskornPassword','memberId','phone','email','district','locality','housing','flat','syncedWithTakskom','lastSyncAt','eplCreationMode','eplAccessMode','balanceDeductionOrder','isActive','createdAt','updatedAt'];
        const colNames = cols.map(c => c.name).filter(n => newTableCols.includes(n)).join(', ');
        if (!colNames) return;
        db.run('PRAGMA foreign_keys = OFF', (e1) => {
          if (e1) return;
          db.run(`ALTER TABLE parks RENAME TO ${TEMP_PARKS}`, (e2) => {
            if (e2) { db.run('PRAGMA foreign_keys = ON'); return; }
            db.run(`
              CREATE TABLE parks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                address TEXT,
                postalIndex TEXT, region TEXT, regionCode TEXT, city TEXT, street TEXT, house TEXT,
                ogrn TEXT, inn TEXT, kpp TEXT,
                takskornId TEXT, takskornPassword TEXT, memberId TEXT,
                phone TEXT, email TEXT, district TEXT, locality TEXT, housing TEXT, flat TEXT,
                syncedWithTakskom INTEGER DEFAULT 0, lastSyncAt DATETIME,
                eplCreationMode TEXT DEFAULT 'clinic_api',
                eplAccessMode TEXT DEFAULT 'all',
                balanceDeductionOrder TEXT DEFAULT 'real_first',
                isActive INTEGER DEFAULT 0,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
              )
            `, (e3) => {
              if (e3) { db.run('PRAGMA foreign_keys = ON'); return; }
              // Данные лежат в TEMP_PARKS (мы только что сделали RENAME parks TO TEMP_PARKS). Не используем parks_old_unique_fix в запросах.
              db.run(`INSERT INTO parks (${colNames}) SELECT ${colNames} FROM ${TEMP_PARKS}`, (e5) => {
                if (e5) { db.run('PRAGMA foreign_keys = ON'); return; }
                db.run(`DROP TABLE IF EXISTS ${TEMP_PARKS}`, () => {
                  db.run(`DROP TABLE IF EXISTS ${TEMP_PARKS_ALT}`, () => {
                    db.run('PRAGMA foreign_keys = ON', () => {
                      console.log('Migrated parks: removed UNIQUE constraint from takskornId');
                    });
                  });
                });
              });
            });
          });
        });
      });
    });

    // Таблица привязок Такском-парков к паркам (многие-к-одному)
    db.run(`
      CREATE TABLE IF NOT EXISTS park_taxcom_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parkId INTEGER NOT NULL,
        taxcomId TEXT NOT NULL,
        taxcomName TEXT,
        isPrimary INTEGER DEFAULT 0,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(parkId) REFERENCES parks(id) ON DELETE CASCADE
      )
    `, (err) => {
      if (err) return;
      // Заполняем ссылки на следующем тике, чтобы миграция parks (UNIQUE) успела завершиться
      const fillTaxcomLinks = () => {
        db.all(
          `SELECT id, takskornId FROM parks WHERE takskornId IS NOT NULL AND takskornId != '' AND id NOT IN (SELECT DISTINCT parkId FROM park_taxcom_links)`,
          [],
          (err2, rows) => {
            if (err2 || !rows) return;
            rows.forEach(p => {
              db.run(
                `INSERT OR IGNORE INTO park_taxcom_links (parkId, taxcomId, isPrimary) VALUES (?, ?, 1)`,
                [p.id, String(p.takskornId)],
                (e) => { if (!e) console.log(`Migrated taxcom link for park ${p.id}: ${p.takskornId}`); }
              );
            });
          }
        );
      };
      setImmediate(fillTaxcomLinks);
    });

    // Миграция: добавление полей ogrn, inn, kpp, regionCode если их нет
    db.all(`PRAGMA table_info(parks)`, [], (err, cols) => {
      if (err) return;
      const hasOgrn = cols && cols.some(c => c.name === 'ogrn');
      const hasInn = cols && cols.some(c => c.name === 'inn');
      const hasKpp = cols && cols.some(c => c.name === 'kpp');
      const hasRegionCode = cols && cols.some(c => c.name === 'regionCode');
      const hasEplCreationMode = cols && cols.some(c => c.name === 'eplCreationMode');
      const hasEplPrintMode = cols && cols.some(c => c.name === 'eplPrintMode');
      const hasEplAccessMode = cols && cols.some(c => c.name === 'eplAccessMode');
      
      if (!hasOgrn) {
        db.run(`ALTER TABLE parks ADD COLUMN ogrn TEXT`, (e) => {
          if (!e) console.log('Migrated parks: added ogrn column');
        });
      }
      if (!hasInn) {
        db.run(`ALTER TABLE parks ADD COLUMN inn TEXT`, (e) => {
          if (!e) console.log('Migrated parks: added inn column');
        });
      }
      if (!hasKpp) {
        db.run(`ALTER TABLE parks ADD COLUMN kpp TEXT`, (e) => {
          if (!e) console.log('Migrated parks: added kpp column');
        });
      }
      if (!hasRegionCode) {
        db.run(`ALTER TABLE parks ADD COLUMN regionCode TEXT`, (e) => {
          if (!e) console.log('Migrated parks: added regionCode column');
        });
      }
      if (!hasEplCreationMode) {
        db.run(`ALTER TABLE parks ADD COLUMN eplCreationMode TEXT DEFAULT 'takskom_api'`, (e) => {
          if (!e) console.log('Migrated parks: added eplCreationMode column');
        });
      }
      if (!hasEplPrintMode) {
        db.run(`ALTER TABLE parks ADD COLUMN eplPrintMode TEXT DEFAULT 'our_then_taxcom'`, (e) => {
          if (!e) console.log('Migrated parks: added eplPrintMode column');
        });
      }
      if (!hasEplAccessMode) {
        db.run(`ALTER TABLE parks ADD COLUMN eplAccessMode TEXT DEFAULT 'all'`, (e) => {
          if (!e) console.log('Migrated parks: added eplAccessMode column');
        });
      }
      const hasBalanceDeductionOrder = cols && cols.some(c => c.name === 'balanceDeductionOrder');
      if (!hasBalanceDeductionOrder) {
        db.run(`ALTER TABLE parks ADD COLUMN balanceDeductionOrder TEXT DEFAULT 'real_first'`, (e) => {
          if (!e) console.log('Migrated parks: added balanceDeductionOrder column');
        });
      }
      const hasIsActive = cols && cols.some(c => c.name === 'isActive');
      if (!hasIsActive) {
        db.run(`ALTER TABLE parks ADD COLUMN isActive INTEGER DEFAULT 0`, (e) => {
          if (!e) console.log('Migrated parks: added isActive column');
        });
      }
      const hasPhone = cols && cols.some(c => c.name === 'phone');
      if (!hasPhone) {
        db.run(`ALTER TABLE parks ADD COLUMN phone TEXT`, (e) => {
          if (!e) console.log('Migrated parks: added phone column');
        });
      }
      ['email', 'district', 'locality', 'housing', 'flat'].forEach((col) => {
        if (!cols || !cols.some(c => c.name === col)) {
          db.run(`ALTER TABLE parks ADD COLUMN ${col} TEXT`, (e) => {
            if (!e) console.log('Migrated parks: added', col, 'column');
          });
        }
      });

      // Куда идут ответы водителя на рассылки: в парк или конкретному отправителю
      const hasBroadcastRepliesRouting = cols && cols.some(c => c.name === 'broadcastRepliesRouting');
      if (!hasBroadcastRepliesRouting) {
        db.run(`ALTER TABLE parks ADD COLUMN broadcastRepliesRouting TEXT DEFAULT 'park'`, (e) => {
          if (!e) console.log('Migrated parks: added broadcastRepliesRouting column');
        });
      }
      const hasFreightAddressEntryMode = cols && cols.some(c => c.name === 'freightAddressEntryMode');
      if (!hasFreightAddressEntryMode) {
        db.run(`ALTER TABLE parks ADD COLUMN freightAddressEntryMode TEXT DEFAULT 'manager'`, (e) => {
          if (!e) console.log('Migrated parks: added freightAddressEntryMode column');
        });
      }
      ['freightDefaultOriginAddress', 'freightDefaultLoadAddress'].forEach((col) => {
        if (!cols || !cols.some((c) => c.name === col)) {
          db.run(`ALTER TABLE parks ADD COLUMN ${col} TEXT`, (e) => {
            if (!e) console.log('Migrated parks: added', col, 'column');
          });
        }
      });
    });
    
    // Миграция: добавление ownerId в cars
    db.all(`PRAGMA table_info(cars)`, [], (err, cols) => {
      if (err) return;
      const hasOwnerId = cols && cols.some(c => c.name === 'ownerId');
      if (!hasOwnerId) {
        db.run(`ALTER TABLE cars ADD COLUMN ownerId INTEGER`, (e) => {
          if (!e) console.log('Migrated cars: added ownerId column');
        });
      }
    });

    // Миграция cars: vehicleType для Такском (легковой, грузовой и т.д.)
    db.all(`PRAGMA table_info(cars)`, [], (err, cols) => {
      if (err) return;
      const hasVehicleType = cols && cols.some(c => c.name === 'vehicleType');
      if (!hasVehicleType) {
        db.run(`ALTER TABLE cars ADD COLUMN vehicleType TEXT`, (e) => {
          if (!e) console.log('Migrated cars: added vehicleType column');
        });
      }
    });

    // Таблица менеджеров парка
    db.run(`
      CREATE TABLE IF NOT EXISTS managers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL UNIQUE,
        parkId INTEGER NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(userId) REFERENCES users(id),
        FOREIGN KEY(parkId) REFERENCES parks(id)
      )
    `);

    // Таблица автомобилей
    db.run(`
      CREATE TABLE IF NOT EXISTS cars (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parkId INTEGER NOT NULL,
        regNumber TEXT NOT NULL,
        brand TEXT,
        model TEXT,
        vin TEXT,
        
        -- Данные для Такскома
        inventoryNumber TEXT,
        fuelType TEXT,
        fuelUnit TEXT,
        seasonality TEXT,
        tankVolume TEXT,
        
        takskornId TEXT UNIQUE,
        syncedWithTakskom INTEGER DEFAULT 0,
        lastSyncAt DATETIME,
        
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(parkId) REFERENCES parks(id)
      )
    `);

    // Таблица водителей
    db.run(`
      CREATE TABLE IF NOT EXISTS drivers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL UNIQUE,
        parkId INTEGER NOT NULL,
        license TEXT,
        
        takskornId TEXT UNIQUE,
        syncedWithTakskom INTEGER DEFAULT 0,
        lastSyncAt DATETIME,
        eplAccessOverride TEXT DEFAULT 'default',
        
        isVerified INTEGER DEFAULT 0,
        carId INTEGER,
        
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(userId) REFERENCES users(id),
        FOREIGN KEY(parkId) REFERENCES parks(id),
        FOREIGN KEY(carId) REFERENCES cars(id)
      )
    `);

    // ===== ТАБЛИЦЫ ТАКСКОМА =====
    
    // Таблица ЭПЛ (путевых листов)
    db.run(`
      CREATE TABLE IF NOT EXISTS epl (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        
        -- Связи
        parkId INTEGER NOT NULL,
        driverId INTEGER NOT NULL,
        carId INTEGER NOT NULL,
        
        -- Данные из Такскома
        mintransId TEXT UNIQUE,
        waybillNumber TEXT,
        
        -- Статус (pending_clinic = ждёт создания программой на ПК)
        status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'pending_clinic', 'pending', 'signed', 'submitted', 'approved', 'rejected', 'failed')),
        
        -- Ошибка создания (если статус = 'failed')
        errorMessage TEXT,
        
        -- QR код (base64)
        qrCode TEXT,
        
        -- Данные путевого
        startOdometer INTEGER,
        endOdometer INTEGER,
        distance INTEGER,
        -- Флаг для ручной переочереди запроса QR Минтранса
        qrRefetchRequested INTEGER DEFAULT 0,
        
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        FOREIGN KEY(parkId) REFERENCES parks(id),
        FOREIGN KEY(driverId) REFERENCES drivers(id),
        FOREIGN KEY(carId) REFERENCES cars(id)
      )
    `);

    // Миграция для таблицы epl: добавление поля errorMessage и исправление CHECK constraint для статуса 'failed'
    db.all(`PRAGMA table_info(epl)`, [], (err, cols) => {
      if (err) {
        console.warn('Failed to read epl table info:', err.message);
        onDone();
        return;
      }
      
      const hasErrorMessage = cols && cols.some(c => c.name === 'errorMessage');
      
      // Добавляем поле errorMessage если его нет
      if (!hasErrorMessage) {
        db.run(`ALTER TABLE epl ADD COLUMN errorMessage TEXT`, (e) => {
          if (e) console.warn('Failed to add errorMessage column:', e.message);
          else console.log('Migrated epl: added errorMessage column');
        });
      }
      
      const hasEplGuid = cols && cols.some(c => c.name === 'eplGuid');
      if (!hasEplGuid) {
        db.run(`ALTER TABLE epl ADD COLUMN eplGuid TEXT`, (e) => {
          if (e) console.warn('Failed to add eplGuid column:', e.message);
          else console.log('Migrated epl: added eplGuid column');
        });
      }
      const hasExpiryWarning = cols && cols.some(c => c.name === 'expiryWarningSentAt');
      if (!hasExpiryWarning) {
        db.run(`ALTER TABLE epl ADD COLUMN expiryWarningSentAt DATETIME`, (e) => {
          if (e) console.warn('Failed to add expiryWarningSentAt:', e.message);
          else console.log('Migrated epl: added expiryWarningSentAt column');
        });
      }
      const hasAutoClosed = cols && cols.some(c => c.name === 'autoClosedAt');
      if (!hasAutoClosed) {
        db.run(`ALTER TABLE epl ADD COLUMN autoClosedAt DATETIME`, (e) => {
          if (e) console.warn('Failed to add autoClosedAt:', e.message);
          else console.log('Migrated epl: added autoClosedAt column');
        });
      }
      const hasDocumentPdf = cols && cols.some(c => c.name === 'documentPdf');
      if (!hasDocumentPdf) {
        db.run(`ALTER TABLE epl ADD COLUMN documentPdf TEXT`, (e) => {
          if (e) console.warn('Failed to add documentPdf:', e.message);
          else console.log('Migrated epl: added documentPdf column');
        });
      }
      const hasDocumentPdfReceivedAt = cols && cols.some(c => c.name === 'documentPdfReceivedAt');
      if (!hasDocumentPdfReceivedAt) {
        db.run(`ALTER TABLE epl ADD COLUMN documentPdfReceivedAt DATETIME`, (e) => {
          if (e) console.warn('Failed to add documentPdfReceivedAt:', e.message);
          else {
            console.log('Migrated epl: added documentPdfReceivedAt column');
            db.run(`UPDATE epl SET documentPdfReceivedAt = COALESCE(updatedAt, mintransCreatedAt, approvedAt, createdAt) WHERE documentPdf IS NOT NULL AND length(documentPdf) > 0 AND documentPdfReceivedAt IS NULL`, (e2) => {
              if (e2) console.warn('Backfill documentPdfReceivedAt:', e2.message);
            });
          }
        });
      }
      const hasApprovedAt = cols && cols.some(c => c.name === 'approvedAt');
      if (!hasApprovedAt) {
        db.run(`ALTER TABLE epl ADD COLUMN approvedAt DATETIME`, (e) => {
          if (e) console.warn('Failed to add approvedAt:', e.message);
          else console.log('Migrated epl: added approvedAt column');
        });
      }
      const hasMintransCreatedAt = cols && cols.some(c => c.name === 'mintransCreatedAt');
      if (!hasMintransCreatedAt) {
        db.run(`ALTER TABLE epl ADD COLUMN mintransCreatedAt DATETIME`, (e) => {
          if (e) console.warn('Failed to add mintransCreatedAt:', e.message);
          else console.log('Migrated epl: added mintransCreatedAt column');
        });
      }
      const hasDocumentQr = cols && cols.some(c => c.name === 'documentQr');
      if (!hasDocumentQr) {
        db.run(`ALTER TABLE epl ADD COLUMN documentQr TEXT`, (e) => {
          if (e) console.warn('Failed to add documentQr:', e.message);
          else console.log('Migrated epl: added documentQr column');
        });
      }
      const hasDocumentToken = cols && cols.some(c => c.name === 'documentToken');
      if (!hasDocumentToken) {
        db.run(`ALTER TABLE epl ADD COLUMN documentToken TEXT`, (e) => {
          if (e) console.warn('Failed to add documentToken:', e.message);
          else console.log('Migrated epl: added documentToken column');
        });
      }
      const hasQrRefetchRequested = cols && cols.some(c => c.name === 'qrRefetchRequested');
      if (!hasQrRefetchRequested) {
        db.run(`ALTER TABLE epl ADD COLUMN qrRefetchRequested INTEGER DEFAULT 0`, (e) => {
          if (e) console.warn('Failed to add qrRefetchRequested:', e.message);
          else console.log('Migrated epl: added qrRefetchRequested column');
        });
      }

      const hasCreateAttempts = cols && cols.some(c => c.name === 'createAttempts');
      if (!hasCreateAttempts) {
        db.run(`ALTER TABLE epl ADD COLUMN createAttempts INTEGER DEFAULT 0`, (e) => {
          if (e) console.warn('Failed to add createAttempts:', e.message);
          else console.log('Migrated epl: added createAttempts column');
        });
      }

      const hasFailureCode = cols && cols.some(c => c.name === 'failureCode');
      if (!hasFailureCode) {
        db.run(`ALTER TABLE epl ADD COLUMN failureCode TEXT`, (e) => {
          if (e) console.warn('Failed to add failureCode:', e.message);
          else console.log('Migrated epl: added failureCode column');
        });
      }

      const hasLastAttemptAt = cols && cols.some(c => c.name === 'lastAttemptAt');
      if (!hasLastAttemptAt) {
        db.run(`ALTER TABLE epl ADD COLUMN lastAttemptAt DATETIME`, (e) => {
          if (e) console.warn('Failed to add lastAttemptAt:', e.message);
          else console.log('Migrated epl: added lastAttemptAt column');
        });
      }

      const hasCommercialShippingType = cols && cols.some(c => c.name === 'commercialShippingType');
      if (!hasCommercialShippingType) {
        db.run(`ALTER TABLE epl ADD COLUMN commercialShippingType TEXT`, (e) => {
          if (e) console.warn('Failed to add commercialShippingType:', e.message);
          else console.log('Migrated epl: added commercialShippingType column');
        });
      }
      const hasFreightOriginAddress = cols && cols.some(c => c.name === 'freightOriginAddress');
      if (!hasFreightOriginAddress) {
        db.run(`ALTER TABLE epl ADD COLUMN freightOriginAddress TEXT`, (e) => {
          if (e) console.warn('Failed to add freightOriginAddress:', e.message);
          else console.log('Migrated epl: added freightOriginAddress column');
        });
      }
      const hasFreightLoadAddress = cols && cols.some(c => c.name === 'freightLoadAddress');
      if (!hasFreightLoadAddress) {
        db.run(`ALTER TABLE epl ADD COLUMN freightLoadAddress TEXT`, (e) => {
          if (e) console.warn('Failed to add freightLoadAddress:', e.message);
          else console.log('Migrated epl: added freightLoadAddress column');
        });
      }
      const hasFreightUnloadAddresses = cols && cols.some(c => c.name === 'freightUnloadAddresses');
      if (!hasFreightUnloadAddresses) {
        db.run(`ALTER TABLE epl ADD COLUMN freightUnloadAddresses TEXT`, (e) => {
          if (e) console.warn('Failed to add freightUnloadAddresses:', e.message);
          else console.log('Migrated epl: added freightUnloadAddresses column');
        });
      }

      // Проверяем, нужна ли миграция таблицы (пересоздание для CHECK constraint)
      // Проверяем структуру таблицы epl - если все нужные колонки есть, миграция не нужна
      const requiredColumns = ['errorMessage', 'eplGuid', 'expiryWarningSentAt', 'autoClosedAt'];
      const hasAllColumns = requiredColumns.every(col => cols.some(c => c.name === col));
      
      // Если все колонки есть, проверяем структуру таблицы через sqlite_master
      db.all(`SELECT sql FROM sqlite_master WHERE type='table' AND name='epl'`, [], (errCheck, checkRows) => {
        if (errCheck) {
          console.warn('Failed to check epl table structure:', errCheck.message);
          onDone();
          return;
        }
        
        // Если таблица существует и имеет правильную структуру (содержит 'failed' в CHECK), миграция не нужна
        if (checkRows && checkRows.length > 0 && checkRows[0].sql && checkRows[0].sql.includes("'failed'")) {
          // Удаляем временную таблицу если она осталась
          db.run(`DROP TABLE IF EXISTS epl_new`, () => {
            onDone();
          });
          return;
        }
        
        // Если таблицы нет или структура старая - выполняем миграцию
        
        // SQLite не поддерживает изменение CHECK constraint напрямую
        // Пересоздаем таблицу с правильным CHECK constraint, сохраняя данные
        db.all(`SELECT * FROM epl`, [], (err2, rows) => {
          if (err2) {
            // Если таблицы epl нет, создаем её с правильной структурой
            db.run(`
              CREATE TABLE IF NOT EXISTS epl (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                parkId INTEGER NOT NULL,
                driverId INTEGER NOT NULL,
                carId INTEGER NOT NULL,
                mintransId TEXT UNIQUE,
                eplGuid TEXT,
                waybillNumber TEXT,
                status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'pending_clinic', 'pending', 'signed', 'submitted', 'approved', 'rejected', 'failed')),
                errorMessage TEXT,
                failureCode TEXT,
                createAttempts INTEGER DEFAULT 0,
                lastAttemptAt DATETIME,
                qrCode TEXT,
                startOdometer INTEGER,
                endOdometer INTEGER,
                distance INTEGER,
                qrRefetchRequested INTEGER DEFAULT 0,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                expiryWarningSentAt DATETIME,
                autoClosedAt DATETIME,
                FOREIGN KEY(parkId) REFERENCES parks(id),
                FOREIGN KEY(driverId) REFERENCES drivers(id),
                FOREIGN KEY(carId) REFERENCES cars(id)
              )
            `, (e) => {
              if (e) {
                console.warn('Failed to create epl table:', e.message);
              }
              onDone();
            });
            return;
          }
          
          // Сохраняем данные
          const eplData = rows || [];
          
          // Пересоздаем таблицу с правильным CHECK constraint только если есть данные или нужно обновить структуру
          db.serialize(() => {
            // Создаем временную таблицу с правильной структурой
            db.run(`
              CREATE TABLE IF NOT EXISTS epl_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                parkId INTEGER NOT NULL,
                driverId INTEGER NOT NULL,
                carId INTEGER NOT NULL,
                mintransId TEXT UNIQUE,
                eplGuid TEXT,
                waybillNumber TEXT,
                status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'pending_clinic', 'pending', 'signed', 'submitted', 'approved', 'rejected', 'failed')),
                errorMessage TEXT,
                failureCode TEXT,
                createAttempts INTEGER DEFAULT 0,
                lastAttemptAt DATETIME,
                qrCode TEXT,
                startOdometer INTEGER,
                endOdometer INTEGER,
                distance INTEGER,
                qrRefetchRequested INTEGER DEFAULT 0,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                expiryWarningSentAt DATETIME,
                autoClosedAt DATETIME,
                FOREIGN KEY(parkId) REFERENCES parks(id),
                FOREIGN KEY(driverId) REFERENCES drivers(id),
                FOREIGN KEY(carId) REFERENCES cars(id)
              )
            `, (e) => {
              if (e) {
                console.warn('Failed to create epl_new table:', e.message);
                onDone();
                return;
              }
              
              // Копируем данные (если есть)
              if (eplData.length > 0) {
                const stmt = db.prepare(`
                  INSERT INTO epl_new (id, parkId, driverId, carId, mintransId, eplGuid, waybillNumber, status, errorMessage, failureCode, createAttempts, lastAttemptAt, qrCode, startOdometer, endOdometer, distance, createdAt, updatedAt, expiryWarningSentAt, autoClosedAt)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                
                eplData.forEach(row => {
                  const status = row.status === 'failed' ? 'failed' : row.status;
                  stmt.run([
                    row.id, row.parkId, row.driverId, row.carId,
                    row.mintransId, row.eplGuid || null, row.waybillNumber, status,
                    row.errorMessage || null,
                    row.failureCode || null,
                    row.createAttempts != null ? row.createAttempts : 0,
                    row.lastAttemptAt || null,
                    row.qrCode || null,
                    row.startOdometer || null, row.endOdometer || null, row.distance || null,
                    row.createdAt, row.updatedAt || row.createdAt,
                    row.expiryWarningSentAt || null, row.autoClosedAt || null
                  ]);
                });
                
                stmt.finalize((e2) => {
                  if (e2) {
                    console.warn('Failed to copy epl data:', e2.message);
                    db.run(`DROP TABLE IF EXISTS epl_new`, () => {
                      onDone();
                    });
                    return;
                  }
                  
                  // Заменяем старую таблицу новой
                  db.run(`DROP TABLE epl`, (e3) => {
                    if (e3) {
                      console.warn('Failed to drop old epl table:', e3.message);
                      onDone();
                      return;
                    }
                    
                    db.run(`ALTER TABLE epl_new RENAME TO epl`, (e4) => {
                      if (e4) {
                        console.warn('Failed to rename epl_new:', e4.message);
                      } else {
                        console.log('Migrated epl: recreated table with failed status support');
                      }
                      onDone();
                    });
                  });
                });
              } else {
                // Если данных нет, просто заменяем таблицу
                db.run(`DROP TABLE epl`, (e3) => {
                  if (e3) {
                    console.warn('Failed to drop old epl table:', e3.message);
                    onDone();
                    return;
                  }
                  
                  db.run(`ALTER TABLE epl_new RENAME TO epl`, (e4) => {
                    if (e4) {
                      console.warn('Failed to rename epl_new:', e4.message);
                    } else {
                      console.log('Migrated epl: recreated empty table with failed status support');
                    }
                    onDone();
                  });
                });
              }
            });
          });
        });
      });
    });

    // Индексы для быстрого поиска ЭПЛ
    try {
      db.run(`CREATE INDEX IF NOT EXISTS idx_epl_waybillNumber ON epl(waybillNumber)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_cars_regNumber ON cars(regNumber)`);
    } catch (e) {
      console.warn('Failed to create EPL indexes:', e.message);
    }

    // Таблица титулов ЭПЛ
    db.run(`
      CREATE TABLE IF NOT EXISTS epl_titles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        
        eplId INTEGER NOT NULL,
        titleCode TEXT NOT NULL CHECK(titleCode IN ('t1', 't2', 't3', 't4', 't5', 't6')),
        
        -- Статус подписания
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'filled', 'signed', 'submitted')),
        
        -- XML данные и подпись
        xmlData TEXT,
        sigFilePath TEXT,
        
        -- Метаданные
        filledBy TEXT,
        signedBy TEXT,
        signedAt DATETIME,
        
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        UNIQUE(eplId, titleCode),
        FOREIGN KEY(eplId) REFERENCES epl(id) ON DELETE CASCADE
      )
    `);

    // Миграция: подпись титула (base64 КЭП)
    db.all(`PRAGMA table_info(epl_titles)`, [], (err, cols) => {
      if (err) return;
      const hasSigData = cols && cols.some(c => c.name === 'signatureData');
      if (!hasSigData) {
        db.run(`ALTER TABLE epl_titles ADD COLUMN signatureData TEXT`, (e) => {
          if (e) console.warn('epl_titles: add signatureData failed:', e.message);
          else console.log('Migrated epl_titles: added signatureData column');
        });
      }
    });

    // Таблица настроек (ключ-значение)
    db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('epl_creation_mode', 'takskom_api')`, (e) => {
      if (e) console.warn('Settings seed:', e.message);
    });

    // Таблица истории рейсов (для совместимости)
    db.run(`
      CREATE TABLE IF NOT EXISTS rides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        driverId INTEGER NOT NULL,
        carId INTEGER NOT NULL,
        eplId INTEGER,
        
        startTime DATETIME DEFAULT CURRENT_TIMESTAMP,
        endTime DATETIME,
        distance REAL,
        fare REAL,
        
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'cancelled')),
        
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(driverId) REFERENCES drivers(id),
        FOREIGN KEY(carId) REFERENCES cars(id),
        FOREIGN KEY(eplId) REFERENCES epl(id)
      )
    `);

    // ===== ТАБЛИЦЫ ПЛАТЕЖЕЙ И БАЛАНСОВ =====
    
    // Таблица истории баланса (amountType: 'real' = из кассы, 'unreal' = бонус/онлайн)
    db.run(`
      CREATE TABLE IF NOT EXISTS balance_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        amount REAL NOT NULL,
        type TEXT CHECK(type IN ('topup', 'expense', 'waybill_fee', 'refund', 'fine', 'admin_topup')),
        amountType TEXT CHECK(amountType IN ('real', 'unreal')),
        operationKey TEXT,
        description TEXT,
        relatedEplId INTEGER,
        
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(userId) REFERENCES users(id),
        FOREIGN KEY(relatedEplId) REFERENCES epl(id)
      )
    `);

    // Миграция: operationKey для идемпотентности списаний/пополнений
    db.all(`PRAGMA table_info(balance_history)`, [], (err, cols) => {
      if (err) return;
      const hasOperationKey = cols && cols.some((c) => c.name === 'operationKey');
      if (!hasOperationKey) {
        db.run(`ALTER TABLE balance_history ADD COLUMN operationKey TEXT`, (e) => {
          if (!e) console.log('Migrated balance_history: added operationKey');
        });
      }
      // Уникальность по (operationKey, amountType): одна операция может писать 2 строки (real/unreal), но без дублей
      db.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_balance_history_operationKey_amountType_unique
         ON balance_history(operationKey, amountType)
         WHERE operationKey IS NOT NULL`,
        (e) => { if (e) console.warn('balance_history operationKey index:', e.message); }
      );
      db.run(
        `CREATE INDEX IF NOT EXISTS idx_balance_history_user_type_created
         ON balance_history(userId, type, createdAt)`,
        (e) => { if (e) console.warn('balance_history user/type/created index:', e.message); }
      );
    });

    // Heartbeat воркеров ЭПЛ (24/7 мониторинг)
    db.run(`
      CREATE TABLE IF NOT EXISTS worker_heartbeats (
        source TEXT PRIMARY KEY,
        uptimeMin INTEGER,
        ticks INTEGER,
        lastError TEXT,
        lastSeen DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Логи по ЭПЛ и интеграции (Такском, воркеры, fast PDF и т.д.)
    db.run(`
      CREATE TABLE IF NOT EXISTS epl_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        eplId INTEGER,
        driverId INTEGER,
        parkId INTEGER,
        source TEXT,
        event TEXT,
        message TEXT,
        details TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(eplId) REFERENCES epl(id),
        FOREIGN KEY(driverId) REFERENCES drivers(id),
        FOREIGN KEY(parkId) REFERENCES parks(id)
      )
    `);

    // Таблица смен (shifts) - для отслеживания автозакрытия
    db.run(`
      CREATE TABLE IF NOT EXISTS shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        driverId INTEGER NOT NULL,
        eplId INTEGER NOT NULL,
        parkId INTEGER NOT NULL,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'closed', 'auto_closed')),
        closedAt DATETIME,
        autoClosedAt DATETIME,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(driverId) REFERENCES users(id),
        FOREIGN KEY(eplId) REFERENCES epl(id),
        FOREIGN KEY(parkId) REFERENCES parks(id)
      )
    `);

    // Нормализация shifts: одна запись на один eplId (убираем дубли и ставим UNIQUE индекс)
    // ВАЖНО: без этого возможны "сюрпризы" при INSERT OR REPLACE / дублях, и разные части системы могут видеть разные shiftStatus.
    db.run(
      `DELETE FROM shifts
       WHERE id NOT IN (SELECT MAX(id) FROM shifts GROUP BY eplId)`,
      (e) => { if (e) console.warn('shifts dedupe:', e.message); }
    );
    db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_eplId_unique ON shifts(eplId)`,
      (e) => { if (e) console.warn('shifts unique index:', e.message); }
    );
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_shifts_driver_status ON shifts(driverId, status)`,
      (e) => { if (e) console.warn('shifts driver_status index:', e.message); }
    );

    // Уведомления для водителей (смена закрыть в течение часа, смена закрыта автоматически и т.д.)
    db.run(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        type TEXT NOT NULL,
        title TEXT,
        body TEXT NOT NULL,
        readAt DATETIME,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        eplId INTEGER,
        FOREIGN KEY(userId) REFERENCES users(id)
      )
    `);
    db.run('ALTER TABLE notifications ADD COLUMN eplId INTEGER', (err) => {
      if (err && !/duplicate column/i.test(err.message)) console.error('notifications eplId migration:', err);
    });

    // CRM: лиды обратного звонка с лендинга (обрабатываются менеджером)
    db.run(`
      CREATE TABLE IF NOT EXISTS crm_callback_leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        contact TEXT NOT NULL,
        company TEXT,
        businessType TEXT,
        comment TEXT,
        sourcePage TEXT,
        status TEXT DEFAULT 'new' CHECK(status IN ('new', 'in_progress', 'done', 'rejected')),
        callResult TEXT,
        assignedManagerUserId INTEGER,
        calledAt DATETIME,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(assignedManagerUserId) REFERENCES users(id)
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_crm_callback_leads_status_created ON crm_callback_leads(status, createdAt DESC)`);

    // Шаблоны рассылок (админ)
    db.run(`
      CREATE TABLE IF NOT EXISTS admin_broadcast_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Треды рассылок: диалоги водитель ↔ парк
    db.run(`
      CREATE TABLE IF NOT EXISTS broadcast_threads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parkId INTEGER NOT NULL,
        driverUserId INTEGER NOT NULL,
        createdByUserId INTEGER,
        assignedToUserId INTEGER,
        title TEXT,
        lastMessageAt DATETIME,
        lastMessageFrom TEXT CHECK(lastMessageFrom IN ('park','driver')),
        unreadForPark INTEGER DEFAULT 0,
        unreadForDriver INTEGER DEFAULT 0,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(parkId) REFERENCES parks(id) ON DELETE CASCADE,
        FOREIGN KEY(driverUserId) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_broadcast_threads_park ON broadcast_threads(parkId, lastMessageAt)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_broadcast_threads_driver ON broadcast_threads(driverUserId, lastMessageAt)`);

    db.run(`
      CREATE TABLE IF NOT EXISTS broadcast_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        threadId INTEGER NOT NULL,
        fromUserId INTEGER NOT NULL,
        fromRole TEXT NOT NULL CHECK(fromRole IN ('park','driver')),
        body TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        readAtPark DATETIME,
        readAtDriver DATETIME,
        FOREIGN KEY(threadId) REFERENCES broadcast_threads(id) ON DELETE CASCADE,
        FOREIGN KEY(fromUserId) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_broadcast_messages_thread ON broadcast_messages(threadId, createdAt)`);

    // Таблица платежей (пополнение баланса через Юкассу)
    db.run(`
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        amount REAL NOT NULL,
        
        -- Юкасса
        paymentId TEXT UNIQUE,
        yookassaPaymentId TEXT,
        
        -- Статус
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'succeeded', 'canceled', 'failed')),
        
        description TEXT,
        
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        completedAt DATETIME,
        FOREIGN KEY(userId) REFERENCES users(id)
      )
    `);

    // Таблица тарифов на путевые листы
    db.run(`
      CREATE TABLE IF NOT EXISTS waybill_rates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parkId INTEGER,
        
        -- Тариф на создание ЭПЛ
        eplCreationFee REAL DEFAULT 0,
        eplCreationFeeCurrency TEXT DEFAULT 'RUB',
        
        -- Тариф за автозакрытие смены
        autoCloseFee REAL DEFAULT 10,
        
        -- Процент комиссии
        commissionPercent REAL DEFAULT 0,
        
        -- Описание
        description TEXT,
        
        isActive INTEGER DEFAULT 1,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(parkId) REFERENCES parks(id)
      )
    `);

    // Миграция: autoCloseFee в waybill_rates (для старых БД)
    db.all(`PRAGMA table_info(waybill_rates)`, [], (err, cols) => {
      if (err) return;
      const hasAutoCloseFee = cols && cols.some(c => c.name === 'autoCloseFee');
      if (!hasAutoCloseFee) {
        db.run(`ALTER TABLE waybill_rates ADD COLUMN autoCloseFee REAL DEFAULT 10`, (e) => {
          if (!e) console.log('Migrated waybill_rates: added autoCloseFee column');
        });
      }
    });

    // Настройки мини-игры по паркам
    db.run(`
      CREATE TABLE IF NOT EXISTS park_game_settings (
        parkId INTEGER PRIMARY KEY,
        gameEnabled INTEGER DEFAULT 0,
        leaderboardDefault TEXT DEFAULT 'day',
        rewardsEnabled INTEGER DEFAULT 0,
        gameShopConfig TEXT,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(parkId) REFERENCES parks(id)
      )
    `);
    db.all(`PRAGMA table_info(park_game_settings)`, (err, cols) => {
      if (!err && cols && !cols.some((c) => c.name === 'gameShopConfig')) {
        db.run(`ALTER TABLE park_game_settings ADD COLUMN gameShopConfig TEXT`, (e) => {
          if (!e) console.log('Migrated park_game_settings: added gameShopConfig column');
        });
      }
    });
    db.run(`
      CREATE TABLE IF NOT EXISTS park_game_rewards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parkId INTEGER NOT NULL,
        position INTEGER NOT NULL,
        rewardType TEXT NOT NULL CHECK(rewardType IN ('free_epl', 'discount')),
        freeEplCount INTEGER DEFAULT 0,
        discountPercent INTEGER DEFAULT 0,
        discountEplCount INTEGER DEFAULT 0,
        FOREIGN KEY(parkId) REFERENCES parks(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS driver_game_scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parkId INTEGER NOT NULL,
        userId INTEGER NOT NULL,
        score INTEGER NOT NULL,
        playedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(parkId) REFERENCES parks(id),
        FOREIGN KEY(userId) REFERENCES users(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS driver_leaderboard_reward_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        parkId INTEGER NOT NULL,
        periodKey TEXT NOT NULL,
        periodType TEXT NOT NULL,
        freeEplUsed INTEGER DEFAULT 0,
        discountEplUsed INTEGER DEFAULT 0,
        UNIQUE(userId, parkId, periodKey, periodType),
        FOREIGN KEY(userId) REFERENCES users(id),
        FOREIGN KEY(parkId) REFERENCES parks(id)
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_driver_game_scores_park_played ON driver_game_scores(parkId, playedAt)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_driver_game_scores_user ON driver_game_scores(userId)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_park_game_rewards_parkId ON park_game_rewards(parkId)`);
    db.run(`
      CREATE TABLE IF NOT EXISTS driver_game_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        parkId INTEGER NOT NULL,
        itemType TEXT NOT NULL,
        itemId TEXT NOT NULL,
        quantity INTEGER DEFAULT 1,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(userId) REFERENCES users(id),
        FOREIGN KEY(parkId) REFERENCES parks(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS driver_achievement_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        achievementId TEXT NOT NULL,
        progress INTEGER DEFAULT 0,
        completedAt DATETIME,
        rewardGrantedAt DATETIME,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(userId, achievementId),
        FOREIGN KEY(userId) REFERENCES users(id)
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_driver_game_inventory_user ON driver_game_inventory(userId)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_driver_achievement_progress_user ON driver_achievement_progress(userId)`);

    // Фотоконтроль: настройки по парку
    db.run(`
      CREATE TABLE IF NOT EXISTS park_photo_control_settings (
        parkId INTEGER PRIMARY KEY,
        enabled INTEGER DEFAULT 0,
        price REAL DEFAULT 150,
        validDays INTEGER DEFAULT 10,
        notifyHoursBefore INTEGER DEFAULT 24,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(parkId) REFERENCES parks(id)
      )
    `);
    // Заявки на фотоконтроль
    db.run(`
      CREATE TABLE IF NOT EXISTS photo_control_applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parkId INTEGER NOT NULL,
        driverId INTEGER NOT NULL,
        carId INTEGER NOT NULL,
        status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'filling', 'pending', 'approved', 'rejected')),
        approvedAt DATETIME,
        approvedByUserId INTEGER,
        validUntil DATETIME,
        rejectReason TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(parkId) REFERENCES parks(id),
        FOREIGN KEY(driverId) REFERENCES drivers(id),
        FOREIGN KEY(carId) REFERENCES cars(id),
        FOREIGN KEY(approvedByUserId) REFERENCES users(id)
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_photo_control_apps_park ON photo_control_applications(parkId)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_photo_control_apps_driver ON photo_control_applications(driverId)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_photo_control_apps_status ON photo_control_applications(status)`);
    // Шаги заявки (1–10): фото/видео
    db.run(`
      CREATE TABLE IF NOT EXISTS photo_control_steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        applicationId INTEGER NOT NULL,
        stepIndex INTEGER NOT NULL CHECK(stepIndex >= 1 AND stepIndex <= 10),
        mediaType TEXT NOT NULL CHECK(mediaType IN ('photo', 'video')),
        filePath TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(applicationId) REFERENCES photo_control_applications(id) ON DELETE CASCADE,
        UNIQUE(applicationId, stepIndex)
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_photo_control_steps_app ON photo_control_steps(applicationId)`);

    // ===== ЭВАКУАТОРЫ =====
    db.run(`
      CREATE TABLE IF NOT EXISTS evacuator_settings (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        requestCreationPrice REAL DEFAULT 50,
        commissionPercent REAL DEFAULT 15,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.run(`INSERT OR IGNORE INTO evacuator_settings (id, requestCreationPrice, commissionPercent) VALUES (1, 50, 15)`);

    db.run(`
      CREATE TABLE IF NOT EXISTS park_evacuator_settings (
        parkId INTEGER PRIMARY KEY,
        evacuatorEnabled INTEGER DEFAULT 0,
        requestPriceOverride REAL,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(parkId) REFERENCES parks(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS evacuator_source_parks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        evacuatorUserId INTEGER NOT NULL,
        parkId INTEGER NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(evacuatorUserId, parkId),
        FOREIGN KEY(evacuatorUserId) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(parkId) REFERENCES parks(id) ON DELETE CASCADE
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_evacuator_source_parks_user ON evacuator_source_parks(evacuatorUserId)`);

    db.run(`
      CREATE TABLE IF NOT EXISTS evacuator_online (
        userId INTEGER PRIMARY KEY,
        isOnline INTEGER DEFAULT 0,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS evacuator_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        authorUserId INTEGER NOT NULL,
        authorParkId INTEGER NOT NULL,
        address TEXT NOT NULL,
        comment TEXT,
        lat REAL,
        lon REAL,
        status TEXT DEFAULT 'created' CHECK(status IN ('created', 'has_responses', 'confirmed', 'in_progress', 'completed', 'cancelled')),
        chosenResponseId INTEGER,
        requestFeeAmount REAL,
        requestFeePaidAt DATETIME,
        completedAt DATETIME,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(authorUserId) REFERENCES users(id),
        FOREIGN KEY(authorParkId) REFERENCES parks(id)
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_evacuator_requests_park ON evacuator_requests(authorParkId)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_evacuator_requests_status ON evacuator_requests(status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_evacuator_requests_author ON evacuator_requests(authorUserId)`);

    db.run(`
      CREATE TABLE IF NOT EXISTS evacuator_responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requestId INTEGER NOT NULL,
        evacuatorUserId INTEGER NOT NULL,
        etaMinutes INTEGER NOT NULL,
        price REAL NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected')),
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(requestId) REFERENCES evacuator_requests(id) ON DELETE CASCADE,
        FOREIGN KEY(evacuatorUserId) REFERENCES users(id)
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_evacuator_responses_request ON evacuator_responses(requestId)`);

    db.all(`PRAGMA table_info(evacuator_requests)`, [], (err, cols) => {
      if (!err && cols && !cols.some(c => c.name === 'paymentMethod')) {
        db.run(`ALTER TABLE evacuator_requests ADD COLUMN paymentMethod TEXT DEFAULT 'cash'`, (e) => {
          if (!e) console.log('Migrated evacuator_requests: added paymentMethod column');
        });
      }
      if (!err && cols && !cols.some(c => c.name === 'confirmedAt')) {
        db.run(`ALTER TABLE evacuator_requests ADD COLUMN confirmedAt DATETIME`, (e) => {
          if (!e) console.log('Migrated evacuator_requests: added confirmedAt column');
        });
      }
      if (!err && cols && !cols.some(c => c.name === 'inProgressAt')) {
        db.run(`ALTER TABLE evacuator_requests ADD COLUMN inProgressAt DATETIME`, (e) => {
          if (!e) console.log('Migrated evacuator_requests: added inProgressAt column');
        });
      }
      if (!err && cols && !cols.some(c => c.name === 'evacuatorFeeAmount')) {
        db.run(`ALTER TABLE evacuator_requests ADD COLUMN evacuatorFeeAmount REAL`, (e) => {
          if (!e) console.log('Migrated evacuator_requests: added evacuatorFeeAmount column');
        });
      }
      if (!err && cols && !cols.some(c => c.name === 'evacuatorFeePaidAt')) {
        db.run(`ALTER TABLE evacuator_requests ADD COLUMN evacuatorFeePaidAt DATETIME`, (e) => {
          if (!e) console.log('Migrated evacuator_requests: added evacuatorFeePaidAt column');
        });
      }
    });

    db.all(`PRAGMA table_info(users)`, [], (err, cols) => {
      if (!err && cols && !cols.some(c => c.name === 'evacuator_commission_percent')) {
        db.run(`ALTER TABLE users ADD COLUMN evacuator_commission_percent REAL`, (e) => {
          if (!e) console.log('Migrated users: added evacuator_commission_percent column');
        });
      }
      if (!err && cols && !cols.some(c => c.name === 'evacuator_fixed_fee')) {
        db.run(`ALTER TABLE users ADD COLUMN evacuator_fixed_fee REAL`, (e) => {
          if (!e) console.log('Migrated users: added evacuator_fixed_fee column');
        });
      }
      if (!err && cols && !cols.some(c => c.name === 'commissioner_fixed_fee')) {
        db.run(`ALTER TABLE users ADD COLUMN commissioner_fixed_fee REAL`, (e) => {
          if (!e) console.log('Migrated users: added commissioner_fixed_fee column');
        });
      }
    });

    // Миграция: добавить роли 'evacuator'/'commissioner' и гарантировать 'driver' в users (SQLite не позволяет изменить CHECK, пересоздаём таблицу)
    db.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='users'`, [], (err, row) => {
      const needRoleFix = !err && row && row.sql && (
        !row.sql.includes("'director'") ||
        !row.sql.includes("'evacuator'") ||
        !row.sql.includes("'commissioner'") ||
        !row.sql.includes("'driver'")
      );
      if (!needRoleFix) return;

      const ensureUsersColumnsThenMigrate = (next) => {
        db.all(`PRAGMA table_info(users)`, [], (e, cols) => {
          if (e || !cols) return next();
          const names = (cols || []).map(c => c.name);
          const add = (col, sql, done) => {
            if (names.includes(col)) return done();
            db.run(sql, (err) => {
              if (!err) console.log('Migrated users: added column', col);
              done();
            });
          };
          add('email', 'ALTER TABLE users ADD COLUMN email TEXT', () =>
            add('balanceReal', 'ALTER TABLE users ADD COLUMN balanceReal REAL DEFAULT 0', () =>
              add('balanceUnreal', 'ALTER TABLE users ADD COLUMN balanceUnreal REAL DEFAULT 0', () =>
                add('innMutationApplied', 'ALTER TABLE users ADD COLUMN innMutationApplied INTEGER DEFAULT 0', () =>
                  add('innMutationOriginalInn', 'ALTER TABLE users ADD COLUMN innMutationOriginalInn TEXT', () =>
                    add('innMutationAt', 'ALTER TABLE users ADD COLUMN innMutationAt DATETIME', next))))));
        });
      };

      ensureUsersColumnsThenMigrate(() => {
        db.run('PRAGMA foreign_keys = OFF', (e1) => {
          db.run('DROP TABLE IF EXISTS users_new', () => {
            db.run(`
              CREATE TABLE users_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                fullName TEXT,
                firstName TEXT,
                lastName TEXT,
                secondName TEXT,
                phone TEXT,
                email TEXT,
                role TEXT NOT NULL CHECK(role IN ('admin', 'manager', 'driver', 'director', 'evacuator', 'commissioner')),
                parkId INTEGER,
                isVerified INTEGER DEFAULT 0,
                carId INTEGER,
                balance REAL DEFAULT 0,
                balanceReal REAL DEFAULT 0,
                balanceUnreal REAL DEFAULT 0,
                inn TEXT,
                snils TEXT,
                licenseSerial TEXT,
                licenseNumber TEXT,
                licenseDate TEXT,
                personnelNumber TEXT,
                mustChangePassword INTEGER DEFAULT 1,
                firstLogin INTEGER DEFAULT 1,
                innMutationApplied INTEGER DEFAULT 0,
                innMutationOriginalInn TEXT,
                innMutationAt DATETIME,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(parkId) REFERENCES parks(id)
              )
            `, (e2) => {
              if (e2) {
                console.warn('Evacuator role migration create table:', e2.message);
                return;
              }
              db.run(`INSERT INTO users_new SELECT id, username, password, fullName, firstName, lastName, secondName, phone, COALESCE(email, ''), role, parkId, isVerified, carId, COALESCE(balance,0), COALESCE(balanceReal,0), COALESCE(balanceUnreal,0), inn, snils, licenseSerial, licenseNumber, licenseDate, personnelNumber, COALESCE(mustChangePassword,0), COALESCE(firstLogin,1), COALESCE(innMutationApplied,0), innMutationOriginalInn, innMutationAt, createdAt, updatedAt FROM users`, (e3) => {
                if (e3) {
                  console.warn('Evacuator role migration copy:', e3.message);
                  db.run('DROP TABLE users_new');
                  return;
                }
                db.run('DROP TABLE users', (e4) => {
                  if (e4) {
                    console.warn('Evacuator role migration drop:', e4.message);
                    return;
                  }
                  db.run('ALTER TABLE users_new RENAME TO users', (e5) => {
                    if (!e5) console.log('Migrated users: added roles director/evacuator/commissioner, ensured driver');
                  });
                });
              });
            });
          });
        });
      });
    });

    // ===== АВАРИЙНЫЕ КОМИССАРЫ =====
    db.run(`
      CREATE TABLE IF NOT EXISTS commissioner_settings (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        requestCreationPrice REAL DEFAULT 50,
        commissionPercent REAL DEFAULT 15,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.run(`INSERT OR IGNORE INTO commissioner_settings (id, requestCreationPrice, commissionPercent) VALUES (1, 50, 15)`);

    db.run(`
      CREATE TABLE IF NOT EXISTS park_commissioner_settings (
        parkId INTEGER PRIMARY KEY,
        commissionerEnabled INTEGER DEFAULT 0,
        requestPriceOverride REAL,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(parkId) REFERENCES parks(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS commissioner_source_parks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        commissionerUserId INTEGER NOT NULL,
        parkId INTEGER NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(commissionerUserId, parkId),
        FOREIGN KEY(commissionerUserId) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(parkId) REFERENCES parks(id) ON DELETE CASCADE
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_commissioner_source_parks_user ON commissioner_source_parks(commissionerUserId)`);

    db.run(`
      CREATE TABLE IF NOT EXISTS commissioner_online (
        userId INTEGER PRIMARY KEY,
        isOnline INTEGER DEFAULT 0,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS commissioner_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        authorUserId INTEGER NOT NULL,
        authorParkId INTEGER NOT NULL,
        address TEXT NOT NULL,
        comment TEXT,
        lat REAL,
        lon REAL,
        status TEXT DEFAULT 'created' CHECK(status IN ('created', 'has_responses', 'confirmed', 'in_progress', 'completed', 'cancelled')),
        chosenResponseId INTEGER,
        paymentMethod TEXT DEFAULT 'cash',
        requestFeeAmount REAL,
        requestFeePaidAt DATETIME,
        commissionerFeeAmount REAL,
        commissionerFeePaidAt DATETIME,
        confirmedAt DATETIME,
        inProgressAt DATETIME,
        completedAt DATETIME,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(authorUserId) REFERENCES users(id),
        FOREIGN KEY(authorParkId) REFERENCES parks(id)
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_commissioner_requests_park ON commissioner_requests(authorParkId)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_commissioner_requests_status ON commissioner_requests(status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_commissioner_requests_author ON commissioner_requests(authorUserId)`);

    /** Справочник точек выгрузки / «магазинов» парка — адреса для маршрутов и подстановки в ЭПЛ */
    db.run(`
      CREATE TABLE IF NOT EXISTS park_freight_stores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parkId INTEGER NOT NULL,
        name TEXT NOT NULL,
        addressText TEXT NOT NULL,
        contactNote TEXT,
        sortOrder INTEGER DEFAULT 0,
        isActive INTEGER DEFAULT 1,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(parkId) REFERENCES parks(id) ON DELETE CASCADE
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_park_freight_stores_park ON park_freight_stores(parkId)`);

    db.run(`
      CREATE TABLE IF NOT EXISTS commissioner_responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requestId INTEGER NOT NULL,
        commissionerUserId INTEGER NOT NULL,
        etaMinutes INTEGER NOT NULL,
        price REAL NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected')),
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(requestId) REFERENCES commissioner_requests(id) ON DELETE CASCADE,
        FOREIGN KEY(commissionerUserId) REFERENCES users(id)
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_commissioner_responses_request ON commissioner_responses(requestId)`);

    db.all(`PRAGMA table_info(photo_control_applications)`, [], (err, cols) => {
      if (!err && cols && !cols.some(c => c.name === 'expiryWarningSentAt')) {
        db.run(`ALTER TABLE photo_control_applications ADD COLUMN expiryWarningSentAt DATETIME`, (e) => {
          if (!e) console.log('Migrated photo_control_applications: added expiryWarningSentAt');
        });
      }
      if (!err && cols && !cols.some(c => c.name === 'correctionRequestedAt')) {
        db.run(`ALTER TABLE photo_control_applications ADD COLUMN correctionRequestedAt DATETIME`, (e) => {
          if (!e) console.log('Migrated photo_control_applications: added correctionRequestedAt');
        });
      }
    });
    db.all(`PRAGMA table_info(photo_control_steps)`, [], (err, cols) => {
      if (!err && cols && !cols.some(c => c.name === 'managerVerdict')) {
        db.run(`ALTER TABLE photo_control_steps ADD COLUMN managerVerdict TEXT`, (e) => {
          if (!e) console.log('Migrated photo_control_steps: added managerVerdict');
        });
      }
      if (!err && cols && !cols.some(c => c.name === 'managerComment')) {
        db.run(`ALTER TABLE photo_control_steps ADD COLUMN managerComment TEXT`, (e) => {
          if (!e) console.log('Migrated photo_control_steps: added managerComment');
        });
      }
      if (!err && cols && !cols.some(c => c.name === 'reviewedAt')) {
        db.run(`ALTER TABLE photo_control_steps ADD COLUMN reviewedAt DATETIME`, (e) => {
          if (!e) console.log('Migrated photo_control_steps: added reviewedAt');
        });
      }
      if (!err && cols && !cols.some(c => c.name === 'reviewedByUserId')) {
        db.run(`ALTER TABLE photo_control_steps ADD COLUMN reviewedByUserId INTEGER`, (e) => {
          if (!e) console.log('Migrated photo_control_steps: added reviewedByUserId');
        });
      }
    });

    // Индексы для быстрого поиска
    db.run(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_users_parkId ON users(parkId)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_cars_parkId ON cars(parkId)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_drivers_parkId ON drivers(parkId)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_epl_parkId ON epl(parkId)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_epl_driverId ON epl(driverId)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_epl_status ON epl(status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_users_fullName ON users(fullName)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_epl_driver_createdAt ON epl(driverId, createdAt)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_epl_status_createdAt ON epl(status, createdAt)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_epl_park_status_createdAt ON epl(parkId, status, createdAt)`);
    // failureCode / lastAttemptAt добавляются миграциями выше асинхронно — индексы только после появления колонок
    setImmediate(() => {
      db.all(`PRAGMA table_info(epl)`, [], (ie, cols) => {
        if (ie || !cols) return;
        if (cols.some((c) => c.name === 'failureCode')) {
          db.run(`CREATE INDEX IF NOT EXISTS idx_epl_failureCode ON epl(failureCode)`);
        }
        if (cols.some((c) => c.name === 'lastAttemptAt')) {
          db.run(`CREATE INDEX IF NOT EXISTS idx_epl_lastAttemptAt ON epl(lastAttemptAt)`);
        }
      });
    });
    db.run(`CREATE INDEX IF NOT EXISTS idx_payments_userId ON payments(userId)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_shifts_driverId ON shifts(driverId)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_shifts_eplId ON shifts(eplId)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_shifts_parkId ON shifts(parkId)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created ON notifications(userId, readAt, createdAt)`);

    db.all(`PRAGMA table_info(drivers)`, [], (driversColsErr, driversCols) => {
      if (driversColsErr || !driversCols) return;
      const hasEplAccessOverride = driversCols.some((c) => c.name === 'eplAccessOverride');
      if (!hasEplAccessOverride) {
        db.run(`ALTER TABLE drivers ADD COLUMN eplAccessOverride TEXT DEFAULT 'default'`, (e) => {
          if (e) {
            const msg = e.message || '';
            if (!/duplicate column name/i.test(msg)) {
              console.warn('Failed to add drivers.eplAccessOverride:', msg);
            }
          } else {
            console.log('Migrated drivers: added eplAccessOverride column');
          }
        });
      }
    });

    db.run(
      `CREATE TABLE IF NOT EXISTS shift_open_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parkId INTEGER NOT NULL,
        driverUserId INTEGER NOT NULL,
        driverId INTEGER,
        carId INTEGER,
        message TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        startOdometer REAL,
        startFuel REAL,
        commercialShippingType TEXT,
        freightOriginAddress TEXT,
        freightLoadAddress TEXT,
        freightUnloadAddresses TEXT,
        rejectionReason TEXT,
        requestedByUserId INTEGER,
        processedByUserId INTEGER,
        processedByRole TEXT,
        resultEplId INTEGER,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      (e) => {
        if (e) console.warn('[DB] shift_open_requests create:', e.message);
      }
    );
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_shift_open_requests_park_status
       ON shift_open_requests(parkId, status, createdAt DESC)`,
      (e) => {
        if (e) console.warn('[DB] idx_shift_open_requests_park_status:', e.message);
      }
    );
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_shift_open_requests_driver_status
       ON shift_open_requests(driverUserId, status, createdAt DESC)`,
      (e) => {
        if (e) console.warn('[DB] idx_shift_open_requests_driver_status:', e.message);
      }
    );
    db.run(
      `CREATE TABLE IF NOT EXISTS shift_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parkId INTEGER NOT NULL,
        shiftDate TEXT NOT NULL,
        driverUserId INTEGER NOT NULL,
        driverId INTEGER,
        carId INTEGER,
        status TEXT NOT NULL DEFAULT 'planned',
        startOdometer REAL,
        startFuel REAL,
        commercialShippingType TEXT,
        freightOriginAddress TEXT,
        freightLoadAddress TEXT,
        freightUnloadAddresses TEXT,
        note TEXT,
        createdByUserId INTEGER,
        consumedByRequestId INTEGER,
        consumedByEplId INTEGER,
        consumedAt DATETIME,
        cancelledAt DATETIME,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      (e) => {
        if (e) console.warn('[DB] shift_plans create:', e.message);
      }
    );
    db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_plans_unique_driver_day
       ON shift_plans(parkId, shiftDate, driverUserId)`,
      (e) => {
        if (e) console.warn('[DB] idx_shift_plans_unique_driver_day:', e.message);
      }
    );
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_shift_plans_park_date_status
       ON shift_plans(parkId, shiftDate, status, createdAt DESC)`,
      (e) => {
        if (e) console.warn('[DB] idx_shift_plans_park_date_status:', e.message);
      }
    );
    
    // Миграция: добавление UNIQUE constraint на drivers.carId (1 водитель = 1 авто)
    // SQLite не поддерживает ALTER TABLE ADD CONSTRAINT, поэтому используем UNIQUE индекс
    // Миграция: UNIQUE(eplId) в shifts — одна смена на один ЭПЛ, нет дублей «создана и сразу закрыта»
    db.all(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_shifts_eplId_unique'`, [], (errSh, rowsSh) => {
      if (!errSh && (!rowsSh || rowsSh.length === 0)) {
        db.run(`
          DELETE FROM shifts WHERE id NOT IN (
            SELECT id FROM (
              SELECT id, ROW_NUMBER() OVER (PARTITION BY eplId ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, id DESC) as rn
              FROM shifts
            ) WHERE rn = 1
          )
        `, (delErr) => {
          if (delErr) console.warn('[DB] shifts dedup:', delErr.message);
          db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_eplId_unique ON shifts(eplId)`, (idxErr) => {
            if (idxErr) console.warn('[DB] idx_shifts_eplId_unique:', idxErr.message);
            else console.log('[DB] shifts: добавлен UNIQUE(eplId)');
          });
        });
      }
    });

    db.all(`SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_drivers_carId_unique'`, [], (err, rows) => {
      if (err) {
        console.warn('Failed to check drivers.carId unique index:', err.message);
        return;
      }
      if (!rows || rows.length === 0) {
        // Сначала очищаем дубликаты (если есть): оставляем только первый водитель для каждого авто
        db.run(`
          UPDATE drivers 
          SET carId = NULL 
          WHERE id NOT IN (
            SELECT MIN(id) 
            FROM drivers 
            WHERE carId IS NOT NULL 
            GROUP BY carId
          ) AND carId IS NOT NULL
        `, (e) => {
          if (e) console.warn('Failed to clean duplicate carId:', e.message);
          else console.log('Migrated drivers: cleaned duplicate carId bindings');
          
          // Создаем UNIQUE индекс на carId (NULL значения игнорируются в UNIQUE индексе SQLite)
          db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_drivers_carId_unique ON drivers(carId) WHERE carId IS NOT NULL`, (e2) => {
            if (e2) console.warn('Failed to create drivers.carId unique index:', e2.message);
            else console.log('Migrated drivers: added UNIQUE constraint on carId');
          });
        });
      }
    });
  });
  };

  // Сначала восстановить parks (если переименована после сбоя), затем запустить миграции
  db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='parks'`, [], (err, parksRow) => {
    if (!err && parksRow) return runRest();
    const recoverFrom = [
      'parks_old_unique_fix',
      'parks_backup_takskornid',
      'parks_backup_taskskornid',
      'parks_backup_taskskornil'
    ];
    const tryRecover = (idx) => {
      if (idx >= recoverFrom.length) return runRest();
      const oldName = recoverFrom[idx];
      db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [oldName], (e, r) => {
        if (e || !r) return tryRecover(idx + 1);
        db.run(`ALTER TABLE ${oldName} RENAME TO parks`, (e2) => {
          if (!e2) console.log('Migrated: recovered parks table from', oldName);
          runRest();
        });
      });
    };
    tryRecover(0);
  });
};

// Seed default users (local dev convenience). If users already exist, skip.
let seedDefaultUsers = () => {};
try {
  const { hashPassword } = require('./auth');

  seedDefaultUsers = () => {
    // Admin
    db.get('SELECT id FROM users WHERE username = ?', ['admin'], (err, row) => {
      if (err) return console.warn('Seed check error (admin):', err.message);
      if (!row) {
        const pw = hashPassword('admin');
        db.run(
          'INSERT INTO users (username, password, phone, role) VALUES (?, ?, ?, ?)',
          ['admin', pw, '+70000000000', 'admin'],
          function (e) {
            if (e) console.warn('Failed to seed admin:', e.message);
            else console.log('Seeded default admin/admin');
          }
        );
      }
    });

    // Manager
    db.get('SELECT id FROM users WHERE username = ?', ['manager'], (err, row) => {
      if (err) return console.warn('Seed check error (manager):', err.message);
      if (!row) {
        const pw = hashPassword('manager');
        db.run(
          'INSERT INTO users (username, password, phone, role) VALUES (?, ?, ?, ?)',
          ['manager', pw, '+70000000001', 'manager'],
          function (e) {
            if (e) console.warn('Failed to seed manager:', e.message);
            else console.log('Seeded default manager/manager');
          }
        );
      }
    });

    // Driver
    db.get('SELECT id FROM users WHERE username = ?', ['driver'], (err, row) => {
      if (err) return console.warn('Seed check error (driver):', err.message);
      if (!row) {
        const pw = hashPassword('driver');
        db.run(
          'INSERT INTO users (username, password, phone, role) VALUES (?, ?, ?, ?)',
          ['driver', pw, '+70000000002', 'driver'],
          function (e) {
            if (e) console.warn('Failed to seed driver:', e.message);
            else console.log('Seeded default driver/driver');
          }
        );
      }
    });
  };
} catch (e) {
  console.warn('Seeding skipped:', e.message);
}

// Один тестовый парк и привязка менеджера/водителя (чтобы в админке было что смотреть)
function seedDefaultParkAndDriver() {
  db.get('SELECT COUNT(*) as c FROM parks', [], (err, row) => {
    if (err) return console.warn('Seed parks check error:', err.message);
    if (row && row.c > 0) return; // парки уже есть
    db.run(
      "INSERT INTO parks (name, address) VALUES (?, ?)",
      ['Тестовый парк', 'Локальная разработка'],
      function (e) {
        if (e) return console.warn('Failed to seed park:', e.message);
        const parkId = this.lastID;
        console.log('Seeded default park (id=' + parkId + ')');
        db.run('UPDATE users SET parkId = ? WHERE username = ?', [parkId, 'manager'], (e2) => {
          if (e2) console.warn('Failed to link manager to park:', e2.message);
          else console.log('Manager linked to park');
        });
        db.get('SELECT id FROM users WHERE username = ?', ['driver'], (e3, driverUser) => {
          if (e3 || !driverUser) return;
          db.run(
            'INSERT INTO drivers (userId, parkId) VALUES (?, ?)',
            [driverUser.id, parkId],
            function (e4) {
              if (e4) console.warn('Failed to seed driver record:', e4.message);
              else console.log('Seeded driver for park (driverId=' + this.lastID + ')');
            }
          );
        });
      }
    );
  });
}

function runSeed() {
  try {
    seedDefaultUsers();
    // Парк и водитель — через задержку, чтобы пользователи успели создаться
    setTimeout(seedDefaultParkAndDriver, 1500);
  } catch (e) {
    console.warn('Seed error:', e.message);
  }
}

const initializeDB = runMigrations;

module.exports = Object.assign(db, { initializeDB, runSeed });
