const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const db = require('../database');
const { getMoscowDate, getMoscowDateFilter, getMoscowPeriodFilter, getLastFriday } = require('../utils/moscow-time');
const { authenticateToken, authorizeRole, hashPassword, generateToken } = require('../auth');
const takskSync = require('../services/takskom-sync');
const TakskornAPI = require('../takskom-api');
const { deductBalance, addBalance, getBalance } = require('../utils/balance');
const { CANCELABLE_BEFORE_TAXCOM, CLOSE_SHIFT_FAIL_STATUSES, sqlQuoteList } = require('../utils/epl-status');
const { parseDbUtc } = require('../utils/shifts');
const { normalizeCommercialShippingType } = require('../utils/commercialShippingTypes');
const { generateFastEplPdf } = require('../services/fast-epl-pdf');

/** Пробег по умолчанию при завершении рейса без водителя (к начальному пробегу не добавляем, а задаём примерный). */
const DEFAULT_KM_ADD_IF_NO_DRIVER = parseInt(process.env.EPL_COMPLETE_DEFAULT_KM, 10) || 50;

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

const WAYBILL_VALIDITY_HOURS = 12;
function isWaybillExpired(createdAt) {
  if (!createdAt) return false;
  const d = parseDbUtc(createdAt);
  const created = d && !isNaN(d.getTime()) ? d.getTime() : null;
  if (created == null) return false;
  return (Date.now() - created) > WAYBILL_VALIDITY_HOURS * 60 * 60 * 1000;
}

// ===== СПИСОК ПАРКОВ МЕНЕДЖЕРА =====

router.get('/parks', authenticateToken, authorizeRole('manager'), (req, res) => {
  db.all(
    `SELECT p.id, p.name, p.city, p.isActive,
            COALESCE(m.managerType, 'park') as managerType,
            COALESCE(m.canAccessPhotoControl, 0) as canAccessPhotoControl,
            (SELECT COUNT(*) FROM cars WHERE parkId = p.id) as carsCount,
            (SELECT COUNT(*) FROM drivers WHERE parkId = p.id) as driversCount,
            (SELECT COUNT(*) FROM drivers WHERE parkId = p.id AND carId IS NOT NULL) as bindingsCount
     FROM parks p
     JOIN managers m ON p.id = m.parkId
     JOIN users u ON m.userId = u.id
     WHERE u.id = ?
     ORDER BY p.name`,
    [req.user.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

// ===== ПАРК ИНФОРМАЦИЯ =====

router.get('/park', authenticateToken, authorizeRole('manager'), async (req, res) => {
  db.get(
    `SELECT p.* FROM parks p
     JOIN managers m ON p.id = m.parkId
     JOIN users u ON m.userId = u.id
     WHERE u.id = ?`,
    [req.user.userId],
    async (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!row) {
        return res.status(404).json({ error: 'Park not found' });
      }
      
      res.json({
        ...row
      });
    }
  );
});

// ===== ВЛАДЕЛЬЦЫ ТС (для менеджера — только чтение) =====

router.get('/owners', authenticateToken, authorizeRole('manager'), (req, res) => {
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(400).json({ error: 'Менеджер не привязан к парку' });
      db.all(
        'SELECT * FROM park_owners WHERE parkId = ? ORDER BY isDefault DESC, createdAt DESC',
        [manager.parkId],
        (err2, rows) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json(rows || []);
        }
      );
    }
  );
});

// ===== АВТОМОБИЛИ =====

router.get('/cars', authenticateToken, authorizeRole('manager'), (req, res) => {
  getManagerPark(req, (err, manager) => {
    if (err || !manager) {
      return res.status(500).json({ error: 'Park not found' });
    }

      db.all(
        `SELECT c.*, d.id as driverId, d.userId, u.fullName as driverName
         FROM cars c
         LEFT JOIN drivers d ON c.id = d.carId AND d.parkId = c.parkId
         LEFT JOIN users u ON d.userId = u.id
         WHERE c.parkId = ?
         ORDER BY c.createdAt DESC`,
        [manager.parkId],
        (err, rows) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.json(rows || []);
        }
      );
    }
  );
});

router.post('/cars', authenticateToken, authorizeRole('manager'), async (req, res) => {
  try {
    const { regNumber, brand, model, vin, fuelType, tankVolume, seasonality, fuelUnit, inventoryNumber: invNum, vehicleType } = req.body;

    if (!regNumber || !brand) {
      return res.status(400).json({ error: 'Гос. номер и марка обязательны' });
    }

    getManagerPark(req, async (err, mgr) => {
      if (err || !mgr) return res.status(403).json({ error: 'Access denied' });
      db.get(`SELECT p.takskornId, p.isActive FROM parks p WHERE p.id = ?`, [mgr.parkId], async (err2, park) => {
        if (err2 || !park) return res.status(403).json({ error: 'Park not found' });
        const manager = { ...mgr, takskornId: park.takskornId, isActive: park.isActive };
        if (!manager.isActive) {
          return res.status(403).json({ error: 'Парк неактивен. Добавление авто, водителей и привязка недоступны.' });
        }

        const inventoryNumber = (invNum && String(invNum).trim()) || `INV-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

        let syncResult = null;
        let takskornId = null;
        let syncedWithTakskom = 0;

        if (manager.takskornId) {
          syncResult = await takskSync.syncCarWithTakskom({
            regNumber,
            brand,
            model,
            vin,
            fuelType: fuelType || 'Бензин',
            tankVolume: tankVolume || null,
            seasonality: seasonality || 'Круглогодичная',
            fuelUnit: fuelUnit || 'Литр',
            inventoryNumber
          }, manager.takskornId);

          if (syncResult.success) {
            takskornId = syncResult.takskornId;
            syncedWithTakskom = 1;
            console.log(`[Manager] Авто ${regNumber} синхронизирован с Такском`);
          } else {
            console.warn(`[Manager] Ошибка синхро авто ${regNumber}:`, syncResult.error);
          }
        }

        const ownerId = req.body && req.body.ownerId ? req.body.ownerId : null;
        const insertCarForManager = () => {
          db.run(
            `INSERT INTO cars (parkId, regNumber, brand, model, vin, inventoryNumber, 
                             fuelType, tankVolume, seasonality, fuelUnit, vehicleType,
                             takskornId, syncedWithTakskom, lastSyncAt, ownerId)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
            [
              manager.parkId, regNumber, brand, model, vin, inventoryNumber,
              fuelType || 'Бензин', tankVolume || null, seasonality || 'Круглогодичная', fuelUnit || 'Литр', vehicleType || null,
              takskornId, syncedWithTakskom, ownerId
            ],
            function (err) {
              if (err) {
                return res.status(500).json({ error: err.message });
              }

              res.status(201).json({
                id: this.lastID,
                parkId: manager.parkId,
                regNumber,
                brand,
                model,
                vin,
                inventoryNumber,
                fuelType: fuelType || 'Бензин',
                tankVolume: tankVolume || null,
                seasonality: seasonality || 'Круглогодичная',
                fuelUnit: fuelUnit || 'Литр',
                takskornId,
                syncedWithTakskom: !!syncedWithTakskom,
                ownerId,
                message: syncedWithTakskom ? 'Car added and synced with Takskom' : 'Car added (Takskom sync pending)'
              });
            }
          );
        };

        if (ownerId) {
          db.get('SELECT id FROM park_owners WHERE id = ? AND parkId = ?', [ownerId, manager.parkId], (oErr, row) => {
            if (oErr) return res.status(500).json({ error: oErr.message });
            if (!row) return res.status(400).json({ error: 'Владелец не найден в этом парке' });
            insertCarForManager();
          });
        } else {
          insertCarForManager();
        }
      });
    });
  } catch (error) {
    console.error('[Manager] POST /cars error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== ВОДИТЕЛИ =====

router.get('/drivers', authenticateToken, authorizeRole('manager'), (req, res) => {
  try {
    getManagerPark(req, (err, manager) => {
      if (err || !manager) {
        return res.status(403).json({ error: 'Access denied' });
      }

        db.all(
          `SELECT d.id, u.id as userId, u.username, u.fullName, u.phone,
                  (COALESCE(u.balanceReal,0) + COALESCE(u.balanceUnreal,0)) as balance,
                  COALESCE(u.balanceReal,0) as balanceReal, COALESCE(u.balanceUnreal,0) as balanceUnreal,
                  d.license, u.licenseSerial, u.licenseNumber, u.licenseDate, d.carId, d.isVerified,
                  COALESCE(d.eplAccessOverride, 'default') as eplAccessOverride,
                  c.regNumber, c.brand, c.model, u.personnelNumber,
                  u.inn, u.snils, d.syncedWithTakskom
           FROM drivers d
           JOIN users u ON d.userId = u.id
           LEFT JOIN cars c ON d.carId = c.id AND c.parkId = d.parkId
           WHERE d.parkId = ?
           ORDER BY u.createdAt DESC`,
          [manager.parkId],
          (err, drivers) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }
            res.json(drivers || []);
          }
        );
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/drivers', authenticateToken, authorizeRole('manager'), async (req, res) => {
  try {
    const { username, password, phone, fullName, license, licenseSerial, licenseNumber, licenseDate, inn, snils } = req.body;

    // Валидация обязательных полей
    if (!username || !password || !phone || !fullName) {
      return res.status(400).json({ error: 'Обязательные поля: логин, пароль, телефон, ФИО' });
    }
    
    // Валидация водительского удостоверения (должно быть хотя бы одно: license или licenseSerial/licenseNumber)
    if (!license && !licenseSerial && !licenseNumber) {
      return res.status(400).json({ error: 'Обязательное поле: серия/номер ВУ (license или licenseSerial/licenseNumber)' });
    }

    getManagerPark(req, async (err, mgr) => {
      if (err || !mgr) return res.status(403).json({ error: 'Access denied' });
      db.get(`SELECT p.takskornId, p.isActive FROM parks p WHERE p.id = ?`, [mgr.parkId], async (err2, park) => {
        if (err2 || !park) return res.status(403).json({ error: 'Park not found' });
        const manager = { ...mgr, takskornId: park.takskornId, isActive: park.isActive };
        if (!manager.isActive) {
          return res.status(403).json({ error: 'Парк неактивен. Добавление авто, водителей и привязка недоступны.' });
        }

        const personnelNumber = `DRV-${manager.parkId}-${Date.now()}`;
        const hashedPassword = hashPassword(password);
        const fioParts = (fullName || '').trim().split(/\s+/).filter(Boolean);
        const lastName = fioParts[0] || null;
        const firstName = fioParts[1] || null;
        const secondName = fioParts[2] || null;

        // Проверяем, нет ли уже пользователя с таким логином или телефоном
        db.get(`SELECT id FROM users WHERE username = ? OR phone = ?`, [username, phone], async (checkErr, existing) => {
          if (checkErr) {
            return res.status(500).json({ error: checkErr.message });
          }
          if (existing) {
            return res.status(400).json({ error: 'User with this username or phone already exists' });
          }

          // Пытаемся синхронизировать с Такском (только если парк привязан)
          let syncResult = null;
          let takskornId = null;
          let syncedWithTakskom = 0;

          if (manager.takskornId) {
            try {
              syncResult = await takskSync.syncDriverWithTakskom({
                fullName,
                phone,
                license: license || null,
                inn: inn || null,
                snils: snils || null,
                personnelNumber
              }, manager.takskornId);

              if (syncResult && syncResult.success) {
                takskornId = syncResult.takskornId;
                syncedWithTakskom = 1;
                console.log(`[Manager] Водитель ${fullName} синхронизирован с Такском, id: ${takskornId}`);
              } else {
                console.warn(`[Manager] Ошибка синхро водителя ${fullName}:`, syncResult ? syncResult.error : 'unknown');
              }
            } catch (e) {
              console.warn('[TAKSKOM] syncDriverWithTakskom failed:', e.message);
            }
          }

          db.run(
            `INSERT INTO users (username, password, phone, fullName, firstName, lastName, secondName, role, parkId, balance, 
                               licenseSerial, licenseNumber, licenseDate, inn, snils, personnelNumber, isVerified, firstLogin, mustChangePassword)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [username, hashedPassword, phone, fullName, firstName, lastName, secondName, 'driver', manager.parkId, 0,
             licenseSerial || null, licenseNumber || null, licenseDate || null, inn || null, snils || null, personnelNumber, syncedWithTakskom, 1, 0],
            function (err) {
              if (err) {
                return res.status(500).json({ error: err.message });
              }

              const userId = this.lastID;

              db.run(
                `INSERT INTO drivers (userId, parkId, license, takskornId, syncedWithTakskom, isVerified, lastSyncAt)
                 VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [userId, manager.parkId, license || null, takskornId, syncedWithTakskom, syncedWithTakskom],
                function (err) {
                  if (err) {
                    return res.status(500).json({ error: err.message });
                  }

                  const token = generateToken(userId, 'driver', { firstLogin: 1, mustChangePassword: 0 });
                  res.status(201).json({
                    id: userId,
                    username,
                    phone,
                    fullName,
                    license: license || null,
                    licenseSerial: licenseSerial || null,
                    licenseNumber: licenseNumber || null,
                    licenseDate: licenseDate || null,
                    inn: inn || null,
                    snils: snils || null,
                    personnelNumber,
                    takskornId,
                    syncedWithTakskom: !!syncedWithTakskom,
                    parkId: manager.parkId,
                    token,
                    firstLogin: 1,
                    mustChangePassword: 0,
                    message: syncedWithTakskom ? 'Driver added and synced with Takskom' : 'Driver added (Takskom sync pending)'
                  });
                }
              );
            }
          );
        });
      });
    });
  } catch (error) {
    console.error('[Manager] POST /drivers error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post('/drivers/:id/link-car', authenticateToken, authorizeRole('manager'), (req, res) => {
  try {
    const { id } = req.params;
    const { carId } = req.body;

    if (!carId) {
      return res.status(400).json({ error: 'Car ID is required' });
    }

    getManagerPark(req, (err, mgr) => {
      if (err || !mgr) return res.status(403).json({ error: 'Access denied' });
      db.get('SELECT isActive FROM parks WHERE id = ?', [mgr.parkId], (e2, park) => {
        if (e2 || !park) return res.status(403).json({ error: 'Park not found' });
        const manager = { ...mgr, isActive: park.isActive };
        if (!manager.isActive) {
          return res.status(403).json({ error: 'Парк неактивен. Привязка авто к водителю недоступна.' });
        }

        db.run(
          'UPDATE drivers SET carId = ? WHERE userId = ? AND parkId = ?',
          [carId, id, manager.parkId],
          function (err) {
            if (err) {
              return res.status(500).json({ error: err.message });
            }

            db.run(
              'UPDATE users SET carId = ? WHERE id = ? AND parkId = ?',
              [carId, id, manager.parkId],
              function (err) {
                if (err) {
                  return res.status(500).json({ error: err.message });
                }
                res.json({ message: 'Car linked to driver' });
              }
            );
          }
        );
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Обновить машину (все поля для карточки/модалки)
router.put('/cars/:id', authenticateToken, authorizeRole('manager'), (req, res) => {
  const { id } = req.params;
  const { regNumber, brand, model, vin, fuelType, tankVolume, seasonality, fuelUnit, inventoryNumber, vehicleType, ownerId } = req.body;

  getManagerPark(req, (err, mgr) => {
    if (err || !mgr) return res.status(403).json({ error: 'Access denied' });
    db.get('SELECT isActive FROM parks WHERE id = ?', [mgr.parkId], (e2, park) => {
      if (e2 || !park) return res.status(403).json({ error: 'Park not found' });
      const manager = { ...mgr, isActive: park.isActive };
      if (!manager.isActive) {
        return res.status(403).json({ error: 'Парк неактивен. Редактирование авто недоступно.' });
      }
      db.run(
        `UPDATE cars SET regNumber = COALESCE(?, regNumber), brand = COALESCE(?, brand), model = ?,
         vin = ?, fuelType = ?, tankVolume = ?, seasonality = ?, fuelUnit = ?, inventoryNumber = ?, vehicleType = ?, ownerId = ? WHERE id = ? AND parkId = ?`,
        [regNumber, brand, model, vin || null, fuelType || null, tankVolume || null, seasonality || null, fuelUnit || null, inventoryNumber || null, vehicleType || null, ownerId || null, id, manager.parkId],
        function (err) {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          if (this.changes === 0) {
            return res.status(404).json({ error: 'Car not found' });
          }
          res.json({ message: 'Car updated' });
        }
      );
      });
    });
});

// Удалить машину (проверка парка)
router.delete('/cars/:id', authenticateToken, authorizeRole('manager'), (req, res) => {
  const { id } = req.params;
  getManagerPark(req, (err, mgr) => {
    if (err || !mgr) return res.status(403).json({ error: 'Access denied' });
    db.get('SELECT isActive FROM parks WHERE id = ?', [mgr.parkId], (e2, park) => {
      if (e2 || !park) return res.status(403).json({ error: 'Park not found' });
      const manager = { ...mgr, isActive: park.isActive };
      if (!manager.isActive) {
        return res.status(403).json({ error: 'Парк неактивен. Удаление авто недоступно.' });
      }
      db.run('DELETE FROM cars WHERE id = ? AND parkId = ?', [id, manager.parkId], function (err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Car not found' });
        }
        res.json({ message: 'Car deleted' });
      });
      });
    });
});



// ===== НОВЫЕ ENDPOINTS ДЛЯ МЕНЕДЖЕР ПАНЕЛИ =====

// Получить информацию парка со статистикой (для дашборда)
router.get('/dashboard', authenticateToken, authorizeRole('manager'), (req, res) => {
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(403).json({ error: 'Access denied' });
    db.get(
      `SELECT p.id, p.name,
              (SELECT COUNT(*) FROM cars WHERE parkId = p.id) as carsCount,
              (SELECT COUNT(*) FROM drivers WHERE parkId = p.id) as driversCount,
              (SELECT COUNT(*) FROM drivers WHERE parkId = p.id AND carId IS NOT NULL) as assignedDrivers
       FROM parks p WHERE p.id = ?`,
      [manager.parkId],
      (err2, data) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({
          ...(data || {}),
          managerType: manager.managerType || 'park',
          canAccessPhotoControl: !!manager.canAccessPhotoControl,
          canAccessStatistics: !!manager.canAccessStatistics,
          statsShowFinance: manager.statsShowFinance !== 0,
          statsShowEpl: manager.statsShowEpl !== 0,
          statsShowDrivers: manager.statsShowDrivers !== 0,
          // Права по ЭПЛ
          canViewEplLogs: !!manager.canViewEplLogs,
          canControlEplQueue: !!manager.canControlEplQueue,
          canCloseEplShifts: !!manager.canCloseEplShifts,
          canChargeOnShiftClose: !!manager.canChargeOnShiftClose,
          canDownloadEplDocs: !!manager.canDownloadEplDocs,
          canChangeDriverPassword: !!manager.canChangeDriverPassword,
          canAccessBroadcasts: !!manager.canAccessBroadcasts,
          canAccessFinance: !!manager.canAccessFinance,
        });
      }
    );
  });
});

// ===== СТАТИСТИКА ПАРКА ДЛЯ МЕНЕДЖЕРА =====

router.get('/statistics', authenticateToken, authorizeRole('manager'), (req, res) => {
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(403).json({ error: 'Access denied' });
    if (!manager.canAccessStatistics) return res.status(403).json({ error: 'Нет доступа к статистике' });

    const parkId = manager.parkId;
    const period = (req.query.period && String(req.query.period).trim()) || 'today';
    const date = req.query.date && String(req.query.date).trim();
    const dateStart = req.query.dateStart && String(req.query.dateStart).trim();
    const dateEnd = req.query.dateEnd && String(req.query.dateEnd).trim();

    let dateFilter = '';
    const today = getMoscowDate();
    const [yy, mm, dd] = today.split('-').map(Number);
    if (period === 'today') {
      dateFilter = getMoscowDateFilter('bh.createdAt', today);
    } else if (period === 'yesterday') {
      const yesterday = new Date(Date.UTC(yy, mm - 1, dd - 1)).toISOString().split('T')[0];
      dateFilter = getMoscowDateFilter('bh.createdAt', yesterday);
    } else if (period === 'since_friday') {
      const lastFri = getLastFriday(today);
      dateFilter = getMoscowPeriodFilter('bh.createdAt', lastFri, today);
    } else if (period === 'date' && date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      dateFilter = getMoscowDateFilter('bh.createdAt', date);
    } else if (period === 'range' && dateStart && dateEnd && /^\d{4}-\d{2}-\d{2}$/.test(dateStart) && /^\d{4}-\d{2}-\d{2}$/.test(dateEnd)) {
      dateFilter = getMoscowPeriodFilter('bh.createdAt', dateStart, dateEnd);
    } else if (period === 'week') {
      dateFilter = getMoscowPeriodFilter('bh.createdAt', new Date(Date.UTC(yy, mm - 1, dd - 7)).toISOString().split('T')[0], today);
    } else if (period === 'month') {
      dateFilter = getMoscowPeriodFilter('bh.createdAt', new Date(Date.UTC(yy, mm - 1, dd - 30)).toISOString().split('T')[0], today);
    } else {
      dateFilter = getMoscowDateFilter('bh.createdAt', today);
    }

    db.get(`
      SELECT
        (SELECT COUNT(DISTINCT d.id) FROM drivers d WHERE d.parkId = ?) as users,
        (SELECT COUNT(DISTINCT c.id) FROM cars c WHERE c.parkId = ?) as cars,
        (SELECT COUNT(DISTINCT d.id) FROM drivers d WHERE d.parkId = ? AND d.carId IS NOT NULL) as bindings
    `, [parkId, parkId, parkId], (err, basicStats) => {
      if (err) return res.status(500).json({ error: err.message });

      let financeQuery = `
        SELECT
          IFNULL(SUM(CASE WHEN bh.type = 'topup' AND (bh.amountType = 'real' OR bh.amountType IS NULL) THEN bh.amount ELSE 0 END), 0) AS topupsReal,
          COUNT(CASE WHEN bh.type = 'topup' AND (bh.amountType = 'real' OR bh.amountType IS NULL) THEN 1 END) AS topupsRealCount,
          IFNULL(SUM(CASE WHEN bh.type = 'topup' AND bh.amountType = 'unreal' THEN bh.amount ELSE 0 END), 0) AS topupsUnreal,
          COUNT(CASE WHEN bh.type = 'topup' AND bh.amountType = 'unreal' THEN 1 END) AS topupsUnrealCount,
          IFNULL(SUM(CASE WHEN bh.type IN ('expense','waybill_fee') AND (bh.amountType = 'real' OR bh.amountType IS NULL) THEN ABS(bh.amount) ELSE 0 END), 0) AS spentReal,
          IFNULL(SUM(CASE WHEN bh.type IN ('expense','waybill_fee') AND bh.amountType = 'unreal' THEN ABS(bh.amount) ELSE 0 END), 0) AS spentUnreal,
          IFNULL(SUM(CASE WHEN bh.type IN ('expense','waybill_fee') THEN ABS(bh.amount) ELSE 0 END), 0) AS spent,
          (SELECT IFNULL(SUM(u2.balanceReal), 0) FROM users u2 JOIN drivers d2 ON u2.id = d2.userId WHERE d2.parkId = ?) AS systemBalanceReal,
          (SELECT IFNULL(SUM(u2.balanceUnreal), 0) FROM users u2 JOIN drivers d2 ON u2.id = d2.userId WHERE d2.parkId = ?) AS systemBalanceUnreal
        FROM balance_history bh
        JOIN users u ON bh.userId = u.id
        JOIN drivers d ON u.id = d.userId
        WHERE d.parkId = ?
      `;
      if (dateFilter) financeQuery += ` AND ${dateFilter}`;

      db.get(financeQuery, [parkId, parkId, parkId], (err, financeStats) => {
        if (err) return res.status(500).json({ error: err.message });

        const eplDateFilter = dateFilter ? dateFilter.replace(/bh\.createdAt/g, 'epl.createdAt') : '';
        const sDateFilter = dateFilter ? dateFilter.replace(/bh\.createdAt/g, 'COALESCE(s.closedAt, s.autoClosedAt)') : '';
        const fcDateFilter = dateFilter ? dateFilter.replace(/bh\.createdAt/g, 'pca.createdAt') : '';
        const bhFilter = dateFilter ? ` AND ${dateFilter}` : '';
        const eplFilter = eplDateFilter ? ` AND ${eplDateFilter}` : '';
        const shiftsFilter = sDateFilter ? ` AND ${sDateFilter}` : '';

        const operationsQuery = `
          SELECT
            (SELECT COUNT(DISTINCT epl.id) FROM drivers d LEFT JOIN epl ON epl.driverId = d.id AND epl.parkId = d.parkId WHERE d.parkId = ?${eplFilter}) as eplCount,
            (SELECT IFNULL(SUM(ABS(bh.amount)), 0) FROM balance_history bh JOIN users u ON bh.userId = u.id JOIN drivers d ON u.id = d.userId WHERE bh.type = 'waybill_fee' AND d.parkId = ?${bhFilter}) as eplAmount,
            (SELECT IFNULL(SUM(CASE WHEN bh.amountType = 'real' OR bh.amountType IS NULL THEN ABS(bh.amount) ELSE 0 END), 0) FROM balance_history bh JOIN users u ON bh.userId = u.id JOIN drivers d ON u.id = d.userId WHERE bh.type = 'waybill_fee' AND d.parkId = ?${bhFilter}) as eplAmountReal,
            (SELECT IFNULL(SUM(CASE WHEN bh.amountType = 'unreal' THEN ABS(bh.amount) ELSE 0 END), 0) FROM balance_history bh JOIN users u ON bh.userId = u.id JOIN drivers d ON u.id = d.userId WHERE bh.type = 'waybill_fee' AND d.parkId = ?${bhFilter}) as eplAmountUnreal,
            (SELECT COUNT(*) FROM photo_control_applications pca WHERE pca.parkId = ?${fcDateFilter ? ` AND ${fcDateFilter}` : ''}) as photoControlCount,
            (SELECT IFNULL(SUM(ABS(bh.amount)), 0) FROM balance_history bh JOIN users u ON bh.userId = u.id JOIN drivers d ON u.id = d.userId WHERE d.parkId = ? AND bh.type = 'expense' AND bh.description LIKE '%Фотоконтроль%'${bhFilter}) as photoControlAmount,
            (SELECT COUNT(DISTINCT s.id) FROM drivers d LEFT JOIN shifts s ON s.driverId = d.userId AND s.parkId = d.parkId AND s.status IN ('closed', 'auto_closed') WHERE d.parkId = ?${shiftsFilter}) as closedShiftsCount,
            (SELECT COUNT(DISTINCT s.id) FROM drivers d LEFT JOIN shifts s ON s.driverId = d.userId AND s.parkId = d.parkId AND s.status = 'auto_closed' WHERE d.parkId = ?${shiftsFilter}) as autoClosedShiftsCount
        `;
        db.get(operationsQuery, [parkId, parkId, parkId, parkId, parkId, parkId, parkId, parkId], (err, operationsStats) => {
          if (err) return res.status(500).json({ error: err.message });

          let autoCloseQuery = `
            SELECT
              IFNULL(SUM(CASE WHEN bh.type = 'expense' AND bh.description LIKE '%Автозакрытие%' AND (bh.amountType = 'real' OR bh.amountType IS NULL) THEN ABS(bh.amount) ELSE 0 END), 0) AS autoCloseReal,
              IFNULL(SUM(CASE WHEN bh.type = 'expense' AND bh.description LIKE '%Автозакрытие%' AND bh.amountType = 'unreal' THEN ABS(bh.amount) ELSE 0 END), 0) AS autoCloseUnreal
            FROM balance_history bh
            JOIN users u ON bh.userId = u.id
            JOIN drivers d ON u.id = d.userId
            WHERE d.parkId = ?
          `;
          if (dateFilter) autoCloseQuery += ` AND ${dateFilter}`;

          db.get(autoCloseQuery, [parkId], (err, autoCloseStats) => {
            if (err) autoCloseStats = { autoCloseReal: 0, autoCloseUnreal: 0 };
            const autoCloseAmount = (autoCloseStats?.autoCloseReal || 0) + (autoCloseStats?.autoCloseUnreal || 0);

            // Новые водители за период
            let newDriversFilter = '1=0';
            const mt = getMoscowDate();
            const [y, m, d2] = mt.split('-').map(Number);
            if (period === 'today') newDriversFilter = getMoscowDateFilter('d.createdAt', mt);
            else if (period === 'yesterday') {
              const yesterday = new Date(Date.UTC(y, m - 1, d2 - 1)).toISOString().split('T')[0];
              newDriversFilter = getMoscowDateFilter('d.createdAt', yesterday);
            } else if (period === 'since_friday') {
              const lastFri = getLastFriday(mt);
              newDriversFilter = getMoscowPeriodFilter('d.createdAt', lastFri, mt);
            } else if (period === 'date' && date && /^\d{4}-\d{2}-\d{2}$/.test(date)) newDriversFilter = getMoscowDateFilter('d.createdAt', date);
            else if (period === 'range' && dateStart && dateEnd && /^\d{4}-\d{2}-\d{2}$/.test(dateStart) && /^\d{4}-\d{2}-\d{2}$/.test(dateEnd)) newDriversFilter = getMoscowPeriodFilter('d.createdAt', dateStart, dateEnd);
            else if (period === 'week') {
              newDriversFilter = getMoscowPeriodFilter('d.createdAt', new Date(Date.UTC(y, m - 1, d2 - 7)).toISOString().split('T')[0], mt);
            } else if (period === 'month') {
              newDriversFilter = getMoscowPeriodFilter('d.createdAt', new Date(Date.UTC(y, m - 1, d2 - 30)).toISOString().split('T')[0], mt);
            } else {
              newDriversFilter = getMoscowDateFilter('d.createdAt', mt);
            }

            db.get(
              `SELECT COUNT(*) as newDrivers FROM drivers d WHERE d.parkId = ? AND ${newDriversFilter}`,
              [parkId],
              (err, newStats) => {
                if (err) newStats = { newDrivers: 0 };
                res.json({
                  basicStats: basicStats || { users: 0, cars: 0, bindings: 0 },
                  financeStats: financeStats || {},
                  operationsStats: {
                    ...(operationsStats || {}),
                    ...(autoCloseStats || {}),
                    autoCloseAmount,
                    closedShiftsAmount: autoCloseAmount,
                  },
                  newStats: newStats || { newDrivers: 0 },
                  permissions: {
                    showFinance: !!manager.statsShowFinance,
                    showEpl: !!manager.statsShowEpl,
                    showDrivers: !!manager.statsShowDrivers,
                  }
                });
              }
            );
          });
        });
      });
    });
  });
});

// Список ЭПЛ парка для менеджера
router.get('/epl', authenticateToken, authorizeRole('manager'), (req, res) => {
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(403).json({ error: 'Access denied' });
    const parkId = manager.parkId;
    const { group, waybillNumber, driverName, regNumber } = req.query || {};

    const filters = ['e.parkId = ?'];
    const params = [parkId];

    if (waybillNumber && String(waybillNumber).trim()) {
      filters.push('e.waybillNumber LIKE ?');
      params.push(`%${String(waybillNumber).trim()}%`);
    }
    if (driverName && String(driverName).trim()) {
      filters.push('(u.fullName LIKE ? OR u.firstName LIKE ? OR u.lastName LIKE ?)');
      const q = `%${String(driverName).trim()}%`;
      params.push(q, q, q);
    }
    if (regNumber && String(regNumber).trim()) {
      filters.push('c.regNumber LIKE ?');
      params.push(`%${String(regNumber).trim()}%`);
    }

    const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    db.all(
      `
      SELECT
        e.id,
        e.waybillNumber,
        e.status as eplStatus,
        e.createdAt,
        e.approvedAt,
        e.documentPdfReceivedAt,
        e.mintransId,
        e.qrCode,
        e.documentQr,
        d.id as driverId,
        u.fullName as driverName,
        c.regNumber,
        c.brand,
        c.model,
        shift_single.status as shiftStatus,
        CASE WHEN e.documentPdf IS NOT NULL AND length(e.documentPdf) > 0 THEN 1 ELSE 0 END as hasFastDoc,
        CASE WHEN e.mintransId IS NOT NULL AND e.mintransId != '' THEN 1 ELSE 0 END as hasOfficialDoc,
        CASE WHEN e.qrCode IS NOT NULL AND e.qrCode != '' THEN 1 ELSE 0 END as hasMintransQr
      FROM epl e
      LEFT JOIN drivers d ON e.driverId = d.id
      LEFT JOIN users u ON d.userId = u.id
      LEFT JOIN cars c ON e.carId = c.id AND c.parkId = e.parkId
      LEFT JOIN (
        SELECT eplId, status FROM (
          SELECT eplId, status,
                 ROW_NUMBER() OVER (PARTITION BY eplId ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, id DESC) as rn
          FROM shifts
        ) WHERE rn = 1
      ) shift_single ON shift_single.eplId = e.id
      ${whereSql}
      ORDER BY e.createdAt DESC
      `,
      params,
      (eErr, rows) => {
        if (eErr) return res.status(500).json({ error: eErr.message });
        const rawList = rows || [];
        if (rawList.length === 0) return res.json([]);

        const eplIds = rawList.map((r) => r.id);
        const placeholders = eplIds.map(() => '?').join(',');
        db.all(
          `SELECT eplId, titleCode, status FROM epl_titles WHERE eplId IN (${placeholders}) AND titleCode IN ('t1','t2','t3','t4')`,
          eplIds,
          (tErr, titlesRows) => {
            const titulByEpl = {};
            (titlesRows || []).forEach((t) => {
              if (!titulByEpl[t.eplId]) titulByEpl[t.eplId] = { t1: null, t2: null, t3: null, t4: null };
              const key = 't' + t.titleCode.charAt(1);
              titulByEpl[t.eplId][key] = t.status === 'signed' ? 'signed' : t.status || null;
            });

            const list = rawList.map((row) => {
              const hasFastDoc = !!row.hasFastDoc;
              const hasOfficialDoc = !!row.hasOfficialDoc;
              const hasMintransQr = !!row.hasMintransQr;
              const hasAnyDoc = hasFastDoc || hasOfficialDoc || hasMintransQr || !!row.documentQr;
              let uiGroup = null;
              if (row.shiftStatus === 'active' && hasAnyDoc) {
                uiGroup = 'current_open';
              } else if (hasFastDoc && !hasOfficialDoc) {
                uiGroup = 'no_official_epl';
              } else if (hasOfficialDoc && !hasMintransQr) {
                uiGroup = 'no_mintrans_qr';
              } else if (row.shiftStatus === 'closed') {
                uiGroup = 'closed';
              } else if (row.shiftStatus === 'auto_closed') {
                uiGroup = 'auto_closed';
              }
              const titulStatus = titulByEpl[row.id] || { t1: null, t2: null, t3: null, t4: null };
              return {
                ...row,
                hasFastDoc,
                hasOfficialDoc,
                hasMintransQr,
                uiGroup,
                titulStatus,
              };
            });

            const finalList = group ? list.filter((item) => item.uiGroup === group) : list;
            res.json(finalList);
          }
        );
      }
    );
  });
});

// Закрыть смену по ЭПЛ без списания средств (менеджер)
router.post('/epl/:id/close-shift', authenticateToken, authorizeRole('manager'), (req, res) => {
  const eplId = parseInt(req.params.id, 10);
  if (!eplId || Number.isNaN(eplId)) {
    return res.status(400).json({ error: 'Некорректный id ЭПЛ' });
  }
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(403).json({ error: 'Доступ запрещён' });
    db.get(
      `SELECT e.id, e.status, e.parkId, d.userId
       FROM epl e
       JOIN drivers d ON e.driverId = d.id
       WHERE e.id = ? AND e.parkId = ?`,
      [eplId, manager.parkId],
      (eErr, row) => {
        if (eErr) return res.status(500).json({ error: eErr.message });
        if (!row) return res.status(404).json({ error: 'Путевой лист не найден или не принадлежит вашему парку' });

        const userId = row.userId;
        db.run(
          `UPDATE shifts SET status = 'closed', closedAt = CURRENT_TIMESTAMP 
           WHERE eplId = ? AND status = 'active'`,
          [eplId],
          function (runErr) {
            if (runErr) return res.status(500).json({ error: runErr.message });

            db.run(
              `UPDATE epl SET status = 'failed', errorMessage = 'Отменён менеджером' 
               WHERE driverId = (SELECT id FROM drivers WHERE userId = ?) 
               AND status IN (${sqlQuoteList(CANCELABLE_BEFORE_TAXCOM)}) 
               AND (mintransId IS NULL OR mintransId = '')`,
              [userId],
              (cancelErr) => {
                if (cancelErr) console.error('[Manager] Cancel pending EPL on close-shift error:', cancelErr.message);
                db.run(
                  `UPDATE epl SET status = 'failed', errorMessage = 'Закрыт менеджером' 
                   WHERE id = ? AND status IN (${sqlQuoteList(CLOSE_SHIFT_FAIL_STATUSES)})`,
                  [eplId],
                  (closeErr) => {
                    if (closeErr) console.error('[Manager] Close specific EPL on close-shift error:', closeErr.message);
                    res.json({ success: true, message: 'Смена закрыта менеджером. ЭПЛ помечен как закрытый.' });
                  }
                );
              }
            );
          }
        );
      }
    );
  });
});

// Закрыть смену по ЭПЛ со списанием средств (менеджер)
router.post('/epl/:id/close-shift-with-charge', authenticateToken, authorizeRole('manager'), (req, res) => {
  const eplId = parseInt(req.params.id, 10);
  if (!eplId || Number.isNaN(eplId)) {
    return res.status(400).json({ error: 'Некорректный id ЭПЛ' });
  }
  const { amount, comment } = req.body || {};
  const sum = Number(amount);
  if (!sum || Number.isNaN(sum) || sum <= 0) {
    return res.status(400).json({ error: 'Сумма списания должна быть положительным числом' });
  }

  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(403).json({ error: 'Доступ запрещён' });
    if (!manager.canChargeOnShiftClose) {
      return res.status(403).json({ error: 'Нет права списывать деньги при закрытии смены' });
    }

    db.get(
      `SELECT e.id, e.status, e.parkId, d.userId
       FROM epl e
       JOIN drivers d ON e.driverId = d.id
       WHERE e.id = ? AND e.parkId = ?`,
      [eplId, manager.parkId],
      (eErr, row) => {
        if (eErr) return res.status(500).json({ error: eErr.message });
        if (!row) return res.status(404).json({ error: 'Путевой лист не найден или не принадлежит вашему парку' });

        const userId = row.userId;
        const parkId = row.parkId;
        const description = comment && String(comment).trim()
          ? String(comment).trim()
          : 'Списание при закрытии смены менеджером';

        deductBalance(
          db,
          userId,
          parkId,
          sum,
          description,
          eplId,
          'expense',
          `close_shift_charge:manager:epl:${eplId}`,
          (deductErr) => {
            if (deductErr) {
              const msg = deductErr.message || 'Не удалось списать средства';
              const status = /Недостаточно средств/i.test(msg) ? 400 : 500;
              return res.status(status).json({ error: msg });
            }

            db.run(
              `UPDATE shifts SET status = 'closed', closedAt = CURRENT_TIMESTAMP 
                   WHERE eplId = ? AND status = 'active'`,
                  [eplId],
              function (runErr) {
                if (runErr) return res.status(500).json({ error: runErr.message });

                db.run(
                  `UPDATE epl SET status = 'failed', errorMessage = 'Отменён менеджером (со списанием средств)' 
                   WHERE driverId = (SELECT id FROM drivers WHERE userId = ?) 
                     AND status IN (${sqlQuoteList(CANCELABLE_BEFORE_TAXCOM)}) 
                   AND (mintransId IS NULL OR mintransId = '')`,
                  [userId],
                  (cancelErr) => {
                    if (cancelErr) console.error('[Manager] Cancel pending EPL on close-shift-with-charge error:', cancelErr.message);
                    db.run(
                      `UPDATE epl SET status = 'failed', errorMessage = 'Закрыт менеджером (со списанием средств)' 
                         WHERE id = ? AND status IN (${sqlQuoteList(CLOSE_SHIFT_FAIL_STATUSES)})`,
                      [eplId],
                      (closeErr) => {
                        if (closeErr) console.error('[Manager] Close specific EPL on close-shift-with-charge error:', closeErr.message);
                        res.json({
                          success: true,
                          message: 'Смена закрыта менеджером. Средства списаны, ЭПЛ помечен как закрытый.',
                        });
                      }
                    );
                  }
                );
              }
            );
          }
        );
      }
    );
  });
});

// Логи по ЭПЛ (менеджер, с учётом прав)
router.get('/epl/:eplId/logs', authenticateToken, authorizeRole('manager'), (req, res) => {
  const eplId = parseInt(req.params.eplId, 10);
  if (!eplId || Number.isNaN(eplId)) return res.status(400).json({ error: 'Некорректный eplId' });
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(403).json({ error: 'Access denied' });
    if (!manager.canViewEplLogs) return res.status(403).json({ error: 'Нет доступа к логам ЭПЛ' });
    db.all(
      `SELECT l.*
       FROM epl_logs l
       JOIN epl e ON e.id = l.eplId
       WHERE l.eplId = ? AND e.parkId = ?
       ORDER BY l.createdAt DESC, l.id DESC`,
      [eplId, manager.parkId],
      (eErr, rows) => {
        if (eErr) return res.status(500).json({ error: eErr.message });
        res.json(rows || []);
      }
    );
  });
});

// Поставить ЭПЛ в очередь на повторное создание в Такском (если ещё нет mintransId)
router.post('/epl/:eplId/requeue-creation', authenticateToken, authorizeRole('manager'), (req, res) => {
  const eplId = parseInt(req.params.eplId, 10);
  if (!eplId || Number.isNaN(eplId)) return res.status(400).json({ error: 'Некорректный eplId' });

  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(403).json({ error: 'Access denied' });
    if (!manager.canControlEplQueue) return res.status(403).json({ error: 'Нет доступа к управлению очередью ЭПЛ' });

    db.get(
      `SELECT id, parkId, driverId, status, mintransId, errorMessage, documentPdf, qrCode, documentQr, eplGuid
       FROM epl
       WHERE id = ? AND parkId = ?`,
      [eplId, manager.parkId],
      (eErr, row) => {
        if (eErr) return res.status(500).json({ error: eErr.message });
        if (!row) return res.status(404).json({ error: 'Путевой лист не найден в вашем парке' });

        if (row.mintransId) {
          return res.status(400).json({ error: 'ЭПЛ уже имеет mintransId (создан в Такском), повторное создание невозможно. Используйте повторный запрос QR.' });
        }

        const allowedStatuses = ['draft', 'pending_clinic', 'failed'];
        if (!allowedStatuses.includes(row.status)) {
          return res.status(400).json({ error: `Нельзя пересоздать ЭПЛ в статусе ${row.status}. Доступны: ${allowedStatuses.join(', ')}.` });
        }

        db.run(
          `UPDATE epl
           SET status = 'pending_clinic',
               errorMessage = NULL,
               updatedAt = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [eplId],
          (updErr) => {
            if (updErr) return res.status(500).json({ error: updErr.message });

            db.run(
              `INSERT INTO epl_logs (eplId, driverId, parkId, source, event, message)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [
                eplId,
                row.driverId || null,
                row.parkId || null,
                'manager',
                'creation_requeue_requested',
                'Менеджер парка поставил ЭПЛ в очередь на повторное создание в Такском',
              ],
              () => {}
            );

            res.json({ ok: true });
          }
        );
      }
    );
  });
});

// Переочередь запроса QR Минтранса (менеджер, с учётом прав)
router.post('/epl/:eplId/requeue-qr', authenticateToken, authorizeRole('manager'), (req, res) => {
  const eplId = parseInt(req.params.eplId, 10);
  if (!eplId || Number.isNaN(eplId)) return res.status(400).json({ error: 'Некорректный eplId' });
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(403).json({ error: 'Access denied' });
    if (!manager.canControlEplQueue) return res.status(403).json({ error: 'Нет доступа к управлению очередью ЭПЛ' });
    db.get(
      `SELECT id, parkId, driverId, mintransId, qrCode
       FROM epl
       WHERE id = ? AND parkId = ?`,
      [eplId, manager.parkId],
      (eErr, row) => {
        if (eErr) return res.status(500).json({ error: eErr.message });
        if (!row) return res.status(404).json({ error: 'EPL not found' });
        if (!row.mintransId) {
          return res.status(400).json({ error: 'Для этого ЭПЛ нет mintransId, переочередь QR невозможна' });
        }
        if (row.qrCode && row.qrCode.trim() !== '') {
          return res.status(400).json({ error: 'У ЭПЛ уже есть QR-код Минтранса' });
        }
        db.run(
          `UPDATE epl SET qrRefetchRequested = 1 WHERE id = ?`,
          [eplId],
          (updErr) => {
            if (updErr) return res.status(500).json({ error: updErr.message });
            db.run(
              `INSERT INTO epl_logs (eplId, driverId, parkId, source, event, message)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [eplId, row.driverId, row.parkId, 'manager', 'qr_refetch_requested', 'Менеджер парка запросил повторное получение QR Минтранса'],
              () => {}
            );
            res.json({ ok: true });
          }
        );
      }
    );
  });
});

// Скачать наш PDF-документ ЭПЛ (fast PDF) для менеджера
router.get('/epl/:id/document-fast', authenticateToken, authorizeRole('manager'), (req, res) => {
  const eplId = parseInt(req.params.id, 10);
  if (!eplId || Number.isNaN(eplId)) {
    return res.status(400).json({ error: 'Некорректный id ЭПЛ' });
  }
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(403).json({ error: 'Доступ запрещён' });
    db.get(
      'SELECT waybillNumber, documentPdf, parkId FROM epl WHERE id = ? AND parkId = ?',
      [eplId, manager.parkId],
      (eErr, row) => {
        if (eErr) return res.status(500).json({ error: eErr.message });
        if (!row || !row.documentPdf) {
          return res.status(404).json({ error: 'Наш PDF ещё не готов' });
        }
        const pdfBuffer = Buffer.from(row.documentPdf, 'base64');
        const filename = (row.waybillNumber || `waybill-${eplId}`).replace(/[^a-zA-Z0-9._-]/g, '_') + '.pdf';
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(pdfBuffer);
      }
    );
  });
});

// Скачать Минтранс PDF по mintransId (менеджер)
router.get('/epl/:id/document-mintrans', authenticateToken, authorizeRole('manager'), (req, res) => {
  const eplId = parseInt(req.params.id, 10);
  if (!eplId || Number.isNaN(eplId)) {
    return res.status(400).json({ error: 'Некорректный id ЭПЛ' });
  }
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(403).json({ error: 'Доступ запрещён' });
    db.get(
      'SELECT waybillNumber, mintransId, parkId FROM epl WHERE id = ? AND parkId = ?',
      [eplId, manager.parkId],
      async (eErr, row) => {
        if (eErr) return res.status(500).json({ error: eErr.message });
        if (!row) return res.status(404).json({ error: 'Путевой лист не найден' });
        if (!row.mintransId) {
          return res.status(400).json({ error: 'Для этого ЭПЛ ещё нет mintransId (Минтранс PDF недоступен)' });
        }
        try {
          const pdfBuffer = await TakskornAPI.getDocumentPdf(row.mintransId);
          const filename = (row.waybillNumber || `waybill-${eplId}`).replace(/[^a-zA-Z0-9._-]/g, '_') + '-mintrans.pdf';
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          return res.send(pdfBuffer);
        } catch (e) {
          console.error('[Manager] getDocumentPdf error:', e.message);
          return res.status(502).json({ error: 'Не удалось получить Минтранс PDF по API Такском' });
        }
      }
    );
  });
});

// Получить QR Минтранса (documentQr) для менеджера
router.get('/epl/:id/qr-mintrans', authenticateToken, authorizeRole('manager'), (req, res) => {
  const eplId = parseInt(req.params.id, 10);
  if (!eplId || Number.isNaN(eplId)) {
    return res.status(400).json({ error: 'Некорректный id ЭПЛ' });
  }
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(403).json({ error: 'Доступ запрещён' });
    db.get(
      'SELECT documentQr, parkId FROM epl WHERE id = ? AND parkId = ?',
      [eplId, manager.parkId],
      (eErr, row) => {
        if (eErr) return res.status(500).json({ error: eErr.message });
        if (!row || !row.documentQr) {
          return res.status(404).json({ error: 'QR Минтранса ещё не сгенерирован' });
        }
        res.json({ qr: row.documentQr });
      }
    );
  });
});

// Поиск автомобилей по номеру или инвент номеру
router.get('/cars/search', authenticateToken, authorizeRole('manager'), (req, res) => {
  try {
    const { q } = req.query;
    
    getManagerPark(req, (err, manager) => {
        if (err || !manager) {
          return res.status(403).json({ error: 'Access denied' });
        }

        const searchQuery = `%${q || ''}%`;
        db.all(
          `SELECT id, regNumber, brand, model, inventoryNumber, carId, syncedWithTakskom
           FROM cars 
           WHERE parkId = ? AND (regNumber LIKE ? OR inventoryNumber LIKE ? OR brand LIKE ? OR model LIKE ?)
           ORDER BY createdAt DESC`,
          [manager.parkId, searchQuery, searchQuery, searchQuery, searchQuery],
          (err, rows) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }
            res.json(rows || []);
          }
        );
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Поиск водителей по ФИО, номеру или ID
router.get('/drivers/search', authenticateToken, authorizeRole('manager'), (req, res) => {
  try {
    const { q } = req.query;
    
    getManagerPark(req, (err, manager) => {
        if (err || !manager) {
          return res.status(403).json({ error: 'Access denied' });
        }

        const searchQuery = `%${q || ''}%`;
        db.all(
          `SELECT d.id, u.id as userId, u.fullName, u.phone, u.personnelNumber, 
                  d.carId, c.regNumber, d.syncedWithTakskom
           FROM drivers d
           JOIN users u ON d.userId = u.id
           LEFT JOIN cars c ON d.carId = c.id AND c.parkId = d.parkId
           WHERE d.parkId = ? AND (u.fullName LIKE ? OR u.phone LIKE ? OR u.personnelNumber LIKE ?)
           ORDER BY u.createdAt DESC`,
          [manager.parkId, searchQuery, searchQuery, searchQuery],
          (err, rows) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }
            res.json(rows || []);
          }
        );
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Получить детальную карточку водителя
router.get('/drivers/:driverId', authenticateToken, authorizeRole('manager'), (req, res) => {
  try {
    const { driverId } = req.params;
    
    getManagerPark(req, (err, manager) => {
      if (err || !manager) {
        return res.status(403).json({ error: 'Access denied' });
      }

        db.get(
          `SELECT d.id, u.id as userId, u.fullName, u.phone, u.email, u.personnelNumber,
                  d.license, u.licenseSerial, u.licenseNumber, u.licenseDate, d.carId, d.isVerified, d.syncedWithTakskom,
                  COALESCE(d.eplAccessOverride, 'default') as eplAccessOverride,
                  c.id as carId, c.regNumber, c.brand, c.model, c.inventoryNumber
           FROM drivers d
           JOIN users u ON d.userId = u.id
           LEFT JOIN cars c ON d.carId = c.id AND c.parkId = d.parkId
           WHERE d.id = ? AND d.parkId = ?`,
          [driverId, manager.parkId],
          (err, driver) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }
            if (!driver) {
              return res.status(404).json({ error: 'Driver not found' });
            }
            res.json(driver);
          }
        );
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Получить детальную карточку авто
router.get('/cars/:carId', authenticateToken, authorizeRole('manager'), (req, res) => {
  try {
    const { carId } = req.params;
    
    getManagerPark(req, (err, manager) => {
      if (err || !manager) {
        return res.status(403).json({ error: 'Access denied' });
      }

        db.get(
          `SELECT * FROM cars WHERE id = ? AND parkId = ?`,
          [carId, manager.parkId],
          (err, car) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }
            if (!car) {
              return res.status(404).json({ error: 'Car not found' });
            }
            res.json(car);
          }
        );
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Обновить водителя (привязка авто, верификация, ФИО/телефон/документы)
router.put('/drivers/:driverId', authenticateToken, authorizeRole('manager'), (req, res) => {
  try {
    const { driverId } = req.params;
    const { carId, isVerified, fullName, phone, license, licenseSerial, licenseNumber, licenseDate, inn, snils, personnelNumber, eplAccessOverride } = req.body;
    const done = () => res.json({ message: 'Driver updated successfully' });

    getManagerPark(req, (err, mgr) => {
      if (err || !mgr) return res.status(403).json({ error: 'Access denied' });
      db.get('SELECT isActive FROM parks WHERE id = ?', [mgr.parkId], (e2, park) => {
        if (e2 || !park) return res.status(403).json({ error: 'Park not found' });
        const manager = { ...mgr, isActive: park.isActive };
        if (!manager.isActive) {
          return res.status(403).json({ error: 'Парк неактивен. Редактирование водителей недоступно.' });
        }
        db.get(
          `SELECT userId FROM drivers WHERE id = ? AND parkId = ?`,
          [driverId, manager.parkId],
          (err, driver) => {
            if (err || !driver) {
              return res.status(404).json({ error: 'Driver not found' });
            }
            const userId = driver.userId;

            const driverUpdates = [];
            const driverValues = [];
            let needsCarBinding = false;
            let newCarId = null;
            
            if (carId !== undefined) {
              needsCarBinding = true;
              newCarId = carId;
              // carId будет обработан отдельно с проверкой занятости
            }
            if (isVerified !== undefined) {
              driverUpdates.push('isVerified = ?');
              driverValues.push(isVerified ? 1 : 0);
            }
            if (license !== undefined) {
              driverUpdates.push('license = ?');
              driverValues.push(license);
            }
            if (eplAccessOverride !== undefined) {
              const eplOverride = eplAccessOverride === 'force_allow'
                ? 'force_allow'
                : eplAccessOverride === 'force_deny'
                  ? 'force_deny'
                  : 'default';
              driverUpdates.push('eplAccessOverride = ?');
              driverValues.push(eplOverride);
            }

            const userUpdates = [];
            const userValues = [];
            if (fullName !== undefined) {
              userUpdates.push('fullName = ?');
              userValues.push(fullName);
              const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
              userUpdates.push('lastName = ?', 'firstName = ?', 'secondName = ?');
              userValues.push(parts[0] || null, parts[1] || null, parts[2] || null);
            }
            if (phone !== undefined) {
              userUpdates.push('phone = ?', 'username = ?');
              userValues.push(phone, phone);
            }
            if (personnelNumber !== undefined) {
              userUpdates.push('personnelNumber = ?');
              userValues.push(personnelNumber);
            }
            if (inn !== undefined) {
              userUpdates.push('inn = ?');
              userValues.push(inn);
            }
            if (snils !== undefined) {
              userUpdates.push('snils = ?');
              userValues.push(snils);
            }
            if (licenseSerial !== undefined) {
              userUpdates.push('licenseSerial = ?');
              userValues.push(licenseSerial);
            }
            if (licenseNumber !== undefined) {
              userUpdates.push('licenseNumber = ?');
              userValues.push(licenseNumber);
            }
            if (licenseDate !== undefined) {
              userUpdates.push('licenseDate = ?');
              userValues.push(licenseDate);
            }

            if (driverUpdates.length === 0 && userUpdates.length === 0 && !needsCarBinding) {
              return res.status(400).json({ error: 'No fields to update' });
            }

            const runUserUpdate = () => {
              if (userUpdates.length === 0) return tryAutoVerifyDriver(userId, done);
              userValues.push(userId);
              db.run(
                `UPDATE users SET ${userUpdates.join(', ')} WHERE id = ?`,
                userValues,
                (err) => {
                  if (err) return res.status(500).json({ error: err.message });
                  tryAutoVerifyDriver(userId, done);
                }
              );
            };
            const tryAutoVerifyDriver = (uid, callback) => {
              db.get(
                'SELECT lastName, firstName, licenseSerial, licenseNumber, licenseDate FROM users WHERE id = ?',
                [uid],
                (e, row) => {
                  if (e) return callback();
                  const ok = row && (row.lastName || '').trim() && (row.firstName || '').trim() &&
                    ((row.licenseSerial || '').trim() || (row.licenseNumber || '').trim()) && (row.licenseDate || '').trim();
                  if (!ok) return callback();
                  db.run('UPDATE drivers SET isVerified = 1 WHERE userId = ?', [uid], (verErr) => {
                    if (verErr) console.warn('[Manager] auto-verify driver:', verErr.message);
                    callback();
                  });
                }
              );
            };

            const runDriverUpdate = () => {
              if (driverUpdates.length === 0) {
                runUserUpdate();
                return;
              }
              driverValues.push(driverId, manager.parkId);
              db.run(
                `UPDATE drivers SET ${driverUpdates.join(', ')} WHERE id = ? AND parkId = ?`,
                driverValues,
                (err) => {
                  if (err) return res.status(500).json({ error: err.message });
                  runUserUpdate();
                }
              );
            };

            // Обработка привязки авто с проверкой занятости
            if (needsCarBinding) {
              if (newCarId === null || newCarId === undefined) {
                // Отвязка авто
                db.run(
                  'UPDATE drivers SET carId = NULL WHERE id = ? AND parkId = ?',
                  [driverId, manager.parkId],
                  (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    runDriverUpdate();
                  }
                );
              } else {
                // Проверяем, что автомобиль существует и принадлежит парку
                db.get(
                  'SELECT id FROM cars WHERE id = ? AND parkId = ?',
                  [newCarId, manager.parkId],
                  (err, car) => {
                    if (err) return res.status(500).json({ error: err.message });
                    if (!car) return res.status(404).json({ error: 'Автомобиль не найден в вашем парке' });

                    // Проверяем, не занят ли автомобиль другим водителем
                    db.get(
                      'SELECT id FROM drivers WHERE carId = ? AND id != ? AND parkId = ?',
                      [newCarId, driverId, manager.parkId],
                      (checkErr, occupied) => {
                        if (checkErr) return res.status(500).json({ error: checkErr.message });
                        
                        // Если авто занято другим водителем, отвязываем его от предыдущего водителя
                        if (occupied) {
                          db.run(
                            'UPDATE drivers SET carId = NULL WHERE carId = ? AND id != ? AND parkId = ?',
                            [newCarId, driverId, manager.parkId],
                            (unbindErr) => {
                              if (unbindErr) return res.status(500).json({ error: unbindErr.message });
                              // Теперь привязываем авто к новому водителю
                              db.run(
                                'UPDATE drivers SET carId = ? WHERE id = ? AND parkId = ?',
                                [newCarId, driverId, manager.parkId],
                                (updateErr) => {
                                  if (updateErr) {
                                    if (updateErr.message.includes('UNIQUE') || updateErr.message.includes('unique')) {
                                      return res.status(400).json({ error: 'Автомобиль уже привязан к этому водителю' });
                                    }
                                    return res.status(500).json({ error: updateErr.message });
                                  }
                                  runDriverUpdate();
                                }
                              );
                            }
                          );
                        } else {
                          // Авто свободно, привязываем напрямую
                          db.run(
                            'UPDATE drivers SET carId = ? WHERE id = ? AND parkId = ?',
                            [newCarId, driverId, manager.parkId],
                            (updateErr) => {
                              if (updateErr) {
                                if (updateErr.message.includes('UNIQUE') || updateErr.message.includes('unique')) {
                                  return res.status(400).json({ error: 'Автомобиль уже привязан к этому водителю' });
                                }
                                return res.status(500).json({ error: updateErr.message });
                              }
                              runDriverUpdate();
                            }
                          );
                        }
                      }
                    );
                  }
                );
              }
            } else {
              runDriverUpdate();
            }
          }
        );
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Обновить авто (добавить данные для синхра с Такском)
router.put('/cars/:carId', authenticateToken, authorizeRole('manager'), (req, res) => {
  try {
    const { carId } = req.params;
    const { regNumber, brand, model, vin, fuelType, tankVolume, seasonality, fuelUnit } = req.body;
    
    getManagerPark(req, (err, manager) => {
      if (err || !manager) {
        return res.status(403).json({ error: 'Access denied' });
      }

        db.run(
          `UPDATE cars 
           SET regNumber = COALESCE(?, regNumber),
               brand = COALESCE(?, brand),
               model = COALESCE(?, model),
               vin = COALESCE(?, vin),
               fuelType = COALESCE(?, fuelType),
               tankVolume = COALESCE(?, tankVolume),
               seasonality = COALESCE(?, seasonality),
               fuelUnit = COALESCE(?, fuelUnit)
           WHERE id = ? AND parkId = ?`,
          [regNumber, brand, model, vin, fuelType, tankVolume, seasonality, fuelUnit, carId, manager.parkId],
          function (err) {
            if (err) {
              return res.status(500).json({ error: err.message });
            }
            res.json({ message: 'Car updated successfully' });
          }
        );
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Удалить водителя
router.delete('/drivers/:driverId', authenticateToken, authorizeRole('manager'), (req, res) => {
  try {
    const { driverId } = req.params;
    
    getManagerPark(req, (err, manager) => {
      if (err || !manager) {
        return res.status(403).json({ error: 'Access denied' });
      }

        db.run(
          `DELETE FROM drivers WHERE id = ? AND parkId = ?`,
          [driverId, manager.parkId],
          function (err) {
            if (err) {
              return res.status(500).json({ error: err.message });
            }
            res.json({ message: 'Driver deleted successfully' });
          }
        );
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Удалить авто
router.delete('/cars/:carId', authenticateToken, authorizeRole('manager'), (req, res) => {
  try {
    const { carId } = req.params;
    
    getManagerPark(req, (err, manager) => {
      if (err || !manager) {
        return res.status(403).json({ error: 'Access denied' });
      }

        db.run(
          `DELETE FROM cars WHERE id = ? AND parkId = ?`,
          [carId, manager.parkId],
          function (err) {
            if (err) {
              return res.status(500).json({ error: err.message });
            }
            res.json({ message: 'Car deleted successfully' });
          }
        );
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== ДОСТУПЫ МЕНЕДЖЕРА =====
router.get('/permissions', authenticateToken, authorizeRole('manager'), (req, res) => {
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(404).json({ error: 'Manager not found' });
    db.get(
      `SELECT COALESCE(m.canTopupBalance,0) as canTopupBalance, COALESCE(m.canFine,0) as canFine,
              COALESCE(m.canDismiss,0) as canDismiss, COALESCE(m.canDeleteDriver,0) as canDeleteDriver,
              COALESCE(m.canShowBalanceBreakdown,0) as canShowBalanceBreakdown,
              COALESCE(m.canChangeDriverPassword,0) as canChangeDriverPassword,
              COALESCE(m.canAccessBroadcasts,0) as canAccessBroadcasts,
              COALESCE(m.driverStatsShowBalance,1) as driverStatsShowBalance,
              COALESCE(m.driverStatsShowEpl,1) as driverStatsShowEpl,
              COALESCE(m.driverStatsShowShifts,1) as driverStatsShowShifts,
              COALESCE(m.canViewEplLogs,0) as canViewEplLogs,
              COALESCE(m.canControlEplQueue,0) as canControlEplQueue
       FROM managers m WHERE m.parkId = ? AND m.userId = (SELECT id FROM users WHERE id = ?)`,
      [manager.parkId, req.user.userId],
      (err2, row) => {
        if (err2) return res.status(500).json({ error: err2.message });
        if (!row) return res.status(404).json({ error: 'Manager not found' });
        res.json(row);
      }
    );
  });
});

function getManagerWithPermissions(userId, parkId, cb) {
  if (typeof parkId === 'function') { cb = parkId; parkId = null; }
  const sql = parkId
    ? `SELECT m.parkId, m.canTopupBalance, m.canFine, m.canDismiss, m.canDeleteDriver, m.canShowBalanceBreakdown, m.canChangeDriverPassword, m.canAccessBroadcasts
       FROM managers m JOIN users u ON m.userId = u.id WHERE u.id = ? AND m.parkId = ?`
    : `SELECT m.parkId, m.canTopupBalance, m.canFine, m.canDismiss, m.canDeleteDriver, m.canShowBalanceBreakdown, m.canChangeDriverPassword, m.canAccessBroadcasts
       FROM managers m JOIN users u ON m.userId = u.id WHERE u.id = ?`;
  const params = parkId ? [userId, parkId] : [userId];
  db.get(sql, params, cb);
}

function buildWaybillNumber(parkId) {
  const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
  return `WB-${parkId}-${date}-${Date.now().toString().slice(-4)}`;
}

function listShiftOpenRequestsForPark(parkId, query, cb) {
  const search = String(query?.search || '').trim().toLowerCase();
  const statusRaw = String(query?.status || 'pending').trim().toLowerCase();
  const allowedStatuses = new Set(['pending', 'approved', 'rejected', 'all']);
  const status = allowedStatuses.has(statusRaw) ? statusRaw : 'pending';
  const limitRaw = parseInt(query?.limit, 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;

  const where = ['r.parkId = ?'];
  const params = [parkId];
  if (status !== 'all') {
    where.push('r.status = ?');
    params.push(status);
  }
  if (search) {
    where.push(`(
      LOWER(COALESCE(u.fullName,'')) LIKE ?
      OR LOWER(COALESCE(u.phone,'')) LIKE ?
      OR LOWER(COALESCE(c.regNumber,'')) LIKE ?
      OR LOWER(COALESCE(r.message,'')) LIKE ?
    )`);
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }
  params.push(limit);

  db.all(
    `SELECT r.id, r.parkId, r.driverUserId, r.driverId, r.carId, r.message, r.status,
            r.startOdometer, r.startFuel, r.commercialShippingType,
            r.freightOriginAddress, r.freightLoadAddress, r.freightUnloadAddresses,
            r.rejectionReason, r.requestedByUserId, r.processedByUserId, r.processedByRole,
            r.resultEplId, r.createdAt, r.updatedAt,
            u.fullName as driverName, u.phone as driverPhone,
            c.regNumber as carRegNumber,
            e.waybillNumber as resultWaybillNumber, e.status as resultEplStatus
     FROM shift_open_requests r
     LEFT JOIN users u ON u.id = r.driverUserId
     LEFT JOIN cars c ON c.id = r.carId
     LEFT JOIN epl e ON e.id = r.resultEplId
     WHERE ${where.join(' AND ')}
     ORDER BY
       CASE r.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END,
       r.createdAt DESC, r.id DESC
     LIMIT ?`,
    params,
    cb
  );
}

router.get('/shift-open-requests', authenticateToken, authorizeRole('manager'), (req, res) => {
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(404).json({ error: 'Manager not found' });
    if (!manager.canAccessBroadcasts) return res.status(403).json({ error: 'Нет доступа к разделу "Смены"' });
    listShiftOpenRequestsForPark(manager.parkId, req.query, (qErr, rows) => {
      if (qErr) return res.status(500).json({ error: qErr.message });
      res.json(rows || []);
    });
  });
});

router.post('/shift-open-requests/:id/approve', authenticateToken, authorizeRole('manager'), (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  if (!Number.isFinite(requestId) || requestId <= 0) {
    return res.status(400).json({ error: 'Некорректный id заявки' });
  }
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(404).json({ error: 'Manager not found' });
    if (!manager.canAccessBroadcasts) return res.status(403).json({ error: 'Нет доступа к разделу "Смены"' });

    db.get(
      `SELECT *
       FROM shift_open_requests
       WHERE id = ? AND parkId = ?`,
      [requestId, manager.parkId],
      (rErr, requestRow) => {
        if (rErr) return res.status(500).json({ error: rErr.message });
        if (!requestRow) return res.status(404).json({ error: 'Заявка не найдена' });
        if (requestRow.status !== 'pending') return res.status(409).json({ error: 'Заявка уже обработана' });

        db.get(
          `SELECT d.id as driverId, d.userId as driverUserId, d.parkId, d.carId,
                  p.eplPrintMode, p.name as parkName, p.inn as parkInn, p.kpp as parkKpp, p.ogrn as parkOgrn, p.city as parkCity,
                  u.fullName, u.inn, u.licenseSerial, u.licenseNumber,
                  c.regNumber, c.brand, c.model, c.vehicleType,
                  po.name as ownerName, po.inn as ownerInn, po.kpp as ownerKpp, po.ogrn as ownerOgrn, po.ogrnip as ownerOgrnip
           FROM drivers d
           JOIN parks p ON p.id = d.parkId
           LEFT JOIN users u ON u.id = d.userId
           LEFT JOIN cars c ON c.id = d.carId
           LEFT JOIN park_owners po ON po.id = c.ownerId AND po.parkId = d.parkId
           WHERE d.userId = ? AND d.parkId = ?`,
          [requestRow.driverUserId, manager.parkId],
          (dErr, driverRow) => {
            if (dErr) return res.status(500).json({ error: dErr.message });
            if (!driverRow) return res.status(404).json({ error: 'Водитель не найден в парке' });
            if (!driverRow.carId) return res.status(400).json({ error: 'У водителя не привязано авто' });

            const fallbackStartOdometer = Number(requestRow.startOdometer);
            const startOdometer = Number.isFinite(fallbackStartOdometer) ? fallbackStartOdometer : 0;
            const waybillNumber = buildWaybillNumber(driverRow.parkId);
            const freightOriginAddress = req.body?.freightOriginAddress != null
              ? String(req.body.freightOriginAddress).trim() || null
              : requestRow.freightOriginAddress || null;
            const freightLoadAddress = req.body?.freightLoadAddress != null
              ? String(req.body.freightLoadAddress).trim() || null
              : requestRow.freightLoadAddress || null;
            const freightUnloadAddresses = req.body?.freightUnloadAddresses != null
              ? JSON.stringify(
                  (Array.isArray(req.body.freightUnloadAddresses) ? req.body.freightUnloadAddresses : [])
                    .map((x) => String(x).trim())
                    .filter(Boolean)
                ) || null
              : requestRow.freightUnloadAddresses || null;
            const commercialShippingType = req.body?.commercialShippingType != null
              ? String(req.body.commercialShippingType).trim() || null
              : requestRow.commercialShippingType || null;

            db.run(
              `INSERT INTO epl
                 (parkId, driverId, carId, waybillNumber, status, startOdometer, errorMessage, commercialShippingType, freightOriginAddress, freightLoadAddress, freightUnloadAddresses)
               VALUES (?, ?, ?, ?, 'pending_clinic', ?, NULL, ?, ?, ?, ?)`,
              [
                driverRow.parkId,
                driverRow.driverId,
                driverRow.carId,
                waybillNumber,
                startOdometer,
                commercialShippingType,
                freightOriginAddress,
                freightLoadAddress,
                freightUnloadAddresses,
              ],
              function (createErr) {
                if (createErr) return res.status(500).json({ error: createErr.message });
                const eplId = this.lastID;
                const printMode = driverRow?.eplPrintMode || 'our_then_taxcom';
                if (printMode !== 'taxcom_only') {
                  generateFastEplPdf({
                    eplId,
                    driver: driverRow,
                    startOdometer,
                    createdAt: new Date(),
                    commercialShippingType,
                  });
                }
                db.run(
                  `UPDATE shift_open_requests
                   SET status = 'approved',
                       processedByUserId = ?,
                       processedByRole = 'manager',
                       resultEplId = ?,
                       updatedAt = CURRENT_TIMESTAMP
                   WHERE id = ?`,
                  [req.user.userId, eplId, requestId],
                  (upReqErr) => {
                    if (upReqErr) return res.status(500).json({ error: upReqErr.message });
                    db.run(
                      `INSERT INTO notifications (userId, type, title, body, eplId)
                       VALUES (?, 'shift_opened', 'Смена открыта', ?, ?)`,
                      [
                        driverRow.driverUserId,
                        `Менеджер открыл смену. Путевой лист #${waybillNumber} поставлен в очередь.`,
                        eplId,
                      ],
                      () => {}
                    );
                    res.json({
                      ok: true,
                      requestId,
                      eplId,
                      waybillNumber,
                      status: 'approved',
                    });
                  }
                );
              }
            );
          }
        );
      }
    );
  });
});

router.post('/shift-open-requests/:id/reject', authenticateToken, authorizeRole('manager'), (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  if (!Number.isFinite(requestId) || requestId <= 0) {
    return res.status(400).json({ error: 'Некорректный id заявки' });
  }
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(404).json({ error: 'Manager not found' });
    if (!manager.canAccessBroadcasts) return res.status(403).json({ error: 'Нет доступа к разделу "Смены"' });

    const reason = String(req.body?.reason || '').trim().slice(0, 500);
    db.get(
      `SELECT id, driverUserId, status
       FROM shift_open_requests
       WHERE id = ? AND parkId = ?`,
      [requestId, manager.parkId],
      (rErr, requestRow) => {
        if (rErr) return res.status(500).json({ error: rErr.message });
        if (!requestRow) return res.status(404).json({ error: 'Заявка не найдена' });
        if (requestRow.status !== 'pending') return res.status(409).json({ error: 'Заявка уже обработана' });

        db.run(
          `UPDATE shift_open_requests
           SET status = 'rejected',
               rejectionReason = ?,
               processedByUserId = ?,
               processedByRole = 'manager',
               updatedAt = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [reason || null, req.user.userId, requestId],
          (uErr) => {
            if (uErr) return res.status(500).json({ error: uErr.message });
            db.run(
              `INSERT INTO notifications (userId, type, title, body)
               VALUES (?, 'shift_open_request_rejected', 'Заявка отклонена', ?)`,
              [
                requestRow.driverUserId,
                reason
                  ? `Менеджер отклонил заявку: ${reason}`
                  : 'Менеджер отклонил заявку на открытие смены.',
              ],
              () => {}
            );
            res.json({ ok: true, requestId, status: 'rejected' });
          }
        );
      }
    );
  });
});

function listShiftPlansForPark(parkId, query, cb) {
  const date = String(query?.date || getMoscowDate()).trim();
  const search = String(query?.search || '').trim().toLowerCase();
  const statusRaw = String(query?.status || 'planned').trim().toLowerCase();
  const allowedStatuses = new Set(['planned', 'consumed', 'cancelled', 'all']);
  const status = allowedStatuses.has(statusRaw) ? statusRaw : 'planned';
  const where = ['sp.parkId = ?', 'sp.shiftDate = ?'];
  const params = [parkId, date];
  if (status !== 'all') {
    where.push('sp.status = ?');
    params.push(status);
  }
  if (search) {
    where.push(`(
      LOWER(COALESCE(u.fullName,'')) LIKE ?
      OR LOWER(COALESCE(u.phone,'')) LIKE ?
      OR LOWER(COALESCE(c.regNumber,'')) LIKE ?
      OR LOWER(COALESCE(sp.note,'')) LIKE ?
    )`);
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }
  db.all(
    `SELECT sp.*,
            u.fullName as driverName, u.phone as driverPhone,
            c.regNumber as carRegNumber,
            e.waybillNumber as consumedWaybillNumber
     FROM shift_plans sp
     LEFT JOIN users u ON u.id = sp.driverUserId
     LEFT JOIN cars c ON c.id = sp.carId
     LEFT JOIN epl e ON e.id = sp.consumedByEplId
     WHERE ${where.join(' AND ')}
     ORDER BY
       CASE sp.status WHEN 'planned' THEN 0 WHEN 'consumed' THEN 1 WHEN 'cancelled' THEN 2 ELSE 3 END,
       COALESCE(u.fullName, u.phone, '') ASC,
       sp.createdAt DESC`,
    params,
    cb
  );
}

router.get('/shift-plans', authenticateToken, authorizeRole('manager'), (req, res) => {
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(404).json({ error: 'Manager not found' });
    if (!manager.canAccessBroadcasts) return res.status(403).json({ error: 'Нет доступа к разделу "Смены"' });
    listShiftPlansForPark(manager.parkId, req.query, (qErr, rows) => {
      if (qErr) return res.status(500).json({ error: qErr.message });
      res.json(rows || []);
    });
  });
});

router.post('/shift-plans', authenticateToken, authorizeRole('manager'), (req, res) => {
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(404).json({ error: 'Manager not found' });
    if (!manager.canAccessBroadcasts) return res.status(403).json({ error: 'Нет доступа к разделу "Смены"' });
    const driverUserId = parseInt(req.body?.driverUserId, 10);
    const shiftDate = String(req.body?.shiftDate || getMoscowDate()).trim();
    const startOdometerRaw = Number(req.body?.startOdometer);
    const startOdometer = Number.isFinite(startOdometerRaw) && startOdometerRaw >= 0 ? startOdometerRaw : 0;
    const note = String(req.body?.note || '').trim().slice(0, 500);
    const commercialShippingType = normalizeCommercialShippingType(req.body?.commercialShippingType);
    const freightOriginAddress = req.body?.freightOriginAddress != null ? String(req.body.freightOriginAddress).trim() || null : null;
    const freightLoadAddress = req.body?.freightLoadAddress != null ? String(req.body.freightLoadAddress).trim() || null : null;
    const freightUnloadAddressesRaw = req.body?.freightUnloadAddresses;
    let freightUnloadAddressesArr = [];
    if (Array.isArray(freightUnloadAddressesRaw)) {
      freightUnloadAddressesArr = freightUnloadAddressesRaw.map((x) => String(x).trim()).filter(Boolean);
    } else if (typeof freightUnloadAddressesRaw === 'string' && freightUnloadAddressesRaw.trim()) {
      const t = freightUnloadAddressesRaw.trim();
      try {
        const parsed = JSON.parse(t);
        if (Array.isArray(parsed)) freightUnloadAddressesArr = parsed.map((x) => String(x).trim()).filter(Boolean);
        else freightUnloadAddressesArr = t.split(/\r?\n|;/).map((x) => x.trim()).filter(Boolean);
      } catch {
        freightUnloadAddressesArr = t.split(/\r?\n|;/).map((x) => x.trim()).filter(Boolean);
      }
    }
    const freightUnloadAddresses = freightUnloadAddressesArr.length > 0 ? JSON.stringify(freightUnloadAddressesArr) : null;
    if (!driverUserId || Number.isNaN(driverUserId)) {
      return res.status(400).json({ error: 'Некорректный driverUserId' });
    }

    db.get(
      `SELECT d.id as driverId, d.userId as driverUserId, d.carId
       FROM drivers d
       WHERE d.userId = ? AND d.parkId = ?`,
      [driverUserId, manager.parkId],
      (dErr, driverRow) => {
        if (dErr) return res.status(500).json({ error: dErr.message });
        if (!driverRow) return res.status(404).json({ error: 'Водитель не найден в парке' });
        if (!driverRow.carId) return res.status(400).json({ error: 'У водителя не привязано авто' });

        db.run(
          `INSERT INTO shift_plans
             (parkId, shiftDate, driverUserId, driverId, carId, status, startOdometer, commercialShippingType, freightOriginAddress, freightLoadAddress, freightUnloadAddresses, note, createdByUserId, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT(parkId, shiftDate, driverUserId) DO UPDATE SET
             status = 'planned',
             startOdometer = excluded.startOdometer,
             commercialShippingType = excluded.commercialShippingType,
             freightOriginAddress = excluded.freightOriginAddress,
             freightLoadAddress = excluded.freightLoadAddress,
             freightUnloadAddresses = excluded.freightUnloadAddresses,
             note = excluded.note,
             driverId = excluded.driverId,
             carId = excluded.carId,
             createdByUserId = excluded.createdByUserId,
             cancelledAt = NULL,
             consumedAt = NULL,
             consumedByRequestId = NULL,
             consumedByEplId = NULL,
             updatedAt = CURRENT_TIMESTAMP`,
          [
            manager.parkId,
            shiftDate,
            driverUserId,
            driverRow.driverId,
            driverRow.carId,
            startOdometer,
            commercialShippingType || null,
            freightOriginAddress,
            freightLoadAddress,
            freightUnloadAddresses,
            note || null,
            req.user.userId,
          ],
          function (uErr) {
            if (uErr) return res.status(500).json({ error: uErr.message });
            res.json({ ok: true, id: this.lastID || null, status: 'planned' });
          }
        );
      }
    );
  });
});

router.post('/shift-plans/:id/cancel', authenticateToken, authorizeRole('manager'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'Некорректный id' });
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(404).json({ error: 'Manager not found' });
    if (!manager.canAccessBroadcasts) return res.status(403).json({ error: 'Нет доступа к разделу "Смены"' });
    db.run(
      `UPDATE shift_plans
       SET status = 'cancelled', cancelledAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
       WHERE id = ? AND parkId = ? AND status = 'planned'`,
      [id, manager.parkId],
      function (uErr) {
        if (uErr) return res.status(500).json({ error: uErr.message });
        if (!this.changes) return res.status(404).json({ error: 'План не найден или уже обработан' });
        res.json({ ok: true, id, status: 'cancelled' });
      }
    );
  });
});

// Сменить пароль водителю (менеджер, если включено право)
router.post('/drivers/:userId/password', authenticateToken, authorizeRole('manager'), (req, res) => {
  const { userId } = req.params;
  const { newPassword, mustChangePassword } = req.body || {};
  const targetUserId = parseInt(userId, 10);
  if (!targetUserId || Number.isNaN(targetUserId)) return res.status(400).json({ error: 'Некорректный userId' });
  const pwd = String(newPassword || '');
  if (!pwd || pwd.length < 6) return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });

  getManagerWithPermissions(req.user.userId, req.query.parkId ? parseInt(req.query.parkId, 10) : null, (err, m) => {
    if (err || !m) return res.status(403).json({ error: 'Доступ запрещён' });
    if (!m.canChangeDriverPassword) return res.status(403).json({ error: 'Нет доступа: смена пароля водителя' });
    ensureDriverInPark(m.parkId, targetUserId, (e) => {
      if (e) return res.status(403).json({ error: e.message });
      const { hashPassword } = require('../auth');
      const hashed = hashPassword(pwd);
      db.run(
        `UPDATE users SET password = ?, mustChangePassword = ?, firstLogin = 0 WHERE id = ?`,
        [hashed, mustChangePassword ? 1 : 0, targetUserId],
        function (uErr) {
          if (uErr) return res.status(500).json({ error: uErr.message });
          if (this.changes === 0) return res.status(404).json({ error: 'Пользователь не найден' });
          res.json({ success: true });
        }
      );
    });
  });
});

// Статистика конкретного водителя (для карточки водителя в менеджерке)
router.get('/drivers/:userId/statistics', authenticateToken, authorizeRole('manager'), (req, res) => {
  const targetUserId = parseInt(req.params.userId, 10);
  if (!targetUserId || Number.isNaN(targetUserId)) return res.status(400).json({ error: 'Некорректный userId' });

  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(403).json({ error: 'Access denied' });

    ensureDriverInPark(manager.parkId, targetUserId, (e) => {
      if (e) return res.status(403).json({ error: e.message });

      db.get(
        `SELECT d.id as driverId, d.parkId as parkId,
                (COALESCE(u.balanceReal,0) + COALESCE(u.balanceUnreal,0)) as balance
         FROM drivers d
         JOIN users u ON u.id = d.userId
         WHERE d.userId = ? AND d.parkId = ?`,
        [targetUserId, manager.parkId],
        (dErr, dRow) => {
          if (dErr) return res.status(500).json({ error: dErr.message });
          if (!dRow) return res.status(404).json({ error: 'Водитель не найден' });

          const driverId = dRow.driverId;

          db.get(
            `SELECT 
               COUNT(*) as totalEpl,
               SUM(CASE WHEN createdAt >= datetime('now', '-7 days') THEN 1 ELSE 0 END) as epl7d,
               SUM(CASE WHEN createdAt >= datetime('now', '-30 days') THEN 1 ELSE 0 END) as epl30d,
               MAX(COALESCE(documentPdfReceivedAt, approvedAt, mintransCreatedAt, createdAt)) as lastEplAt
             FROM epl
             WHERE driverId = ? AND parkId = ?`,
            [driverId, manager.parkId],
            (eErr, eplStats) => {
              if (eErr) return res.status(500).json({ error: eErr.message });

              db.get(
                `SELECT COUNT(*) as activeShifts
                 FROM shifts
                 WHERE driverId = ? AND parkId = ? AND status = 'active'`,
                [driverId, manager.parkId],
                (sErr, sRow) => {
                  if (sErr) return res.status(500).json({ error: sErr.message });

                  const out = {
                    driverId,
                    userId: targetUserId,
                    parkId: manager.parkId,
                  };
                  if (manager.driverStatsShowBalance) out.balance = Number(dRow.balance || 0);
                  if (manager.driverStatsShowEpl) {
                    out.epl = {
                      total: Number(eplStats?.totalEpl || 0),
                      epl7d: Number(eplStats?.epl7d || 0),
                      epl30d: Number(eplStats?.epl30d || 0),
                      lastEplAt: eplStats?.lastEplAt || null,
                    };
                  }
                  if (manager.driverStatsShowShifts) out.shifts = { active: Number(sRow?.activeShifts || 0) };
                  res.json(out);
                }
              );
            }
          );
        }
      );
    });
  });
});

// ===== РАССЫЛКИ (мониторинг водителей + уведомления) — менеджер (если включено) =====

function ensureCanAccessBroadcasts(m, res) {
  if (!m || !m.canAccessBroadcasts) {
    res.status(403).json({ error: 'Нет доступа к рассылкам' });
    return false;
  }
  return true;
}

// ===== INBOX РАССЫЛОК (ответы водителей) — менеджер =====

router.get('/broadcast-threads', authenticateToken, authorizeRole('manager'), (req, res) => {
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(403).json({ error: 'Access denied' });
    if (!ensureCanAccessBroadcasts(manager, res)) return;

    const q = (req.query?.q != null ? String(req.query.q) : '').trim().toLowerCase();
    const onlyUnread = String(req.query?.unread || '') === '1';
    const mineOnly = String(req.query?.mine || '') === '1';

    const where = ['t.parkId = ?'];
    const params = [manager.parkId];
    if (onlyUnread) where.push('t.unreadForPark = 1');
    if (mineOnly) {
      where.push('t.assignedToUserId = ?');
      params.push(req.user.userId);
    }
    if (q) {
      where.push(`(LOWER(COALESCE(u.fullName,'')) LIKE ? OR LOWER(COALESCE(u.phone,'')) LIKE ? OR LOWER(COALESCE(t.title,'')) LIKE ?)`);
      const like = `%${q}%`;
      params.push(like, like, like);
    }

    const sql = `
      SELECT
        t.id, t.parkId, t.driverUserId,
        u.fullName as driverName, u.phone as driverPhone,
        t.title, t.lastMessageAt, t.lastMessageFrom,
        t.unreadForPark, t.unreadForDriver,
        t.assignedToUserId, t.createdByUserId,
        t.createdAt, t.updatedAt
      FROM broadcast_threads t
      LEFT JOIN users u ON u.id = t.driverUserId
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(t.lastMessageAt, t.createdAt) DESC
      LIMIT 200
    `;
    db.all(sql, params, (e2, rows) => {
      if (e2) return res.status(500).json({ error: e2.message });
      res.json(rows || []);
    });
  });
});

router.get('/broadcast-threads/:id/messages', authenticateToken, authorizeRole('manager'), (req, res) => {
  const threadId = parseInt(req.params.id, 10);
  if (!threadId || Number.isNaN(threadId)) return res.status(400).json({ error: 'Некорректный id' });

  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(403).json({ error: 'Access denied' });
    if (!ensureCanAccessBroadcasts(manager, res)) return;

    db.get(`SELECT id, parkId FROM broadcast_threads WHERE id = ?`, [threadId], (tErr, tRow) => {
      if (tErr) return res.status(500).json({ error: tErr.message });
      if (!tRow || tRow.parkId !== manager.parkId) return res.status(404).json({ error: 'Не найдено' });

      db.run(`UPDATE broadcast_threads SET unreadForPark = 0, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`, [threadId], () => {});
      db.run(`UPDATE broadcast_messages SET readAtPark = COALESCE(readAtPark, CURRENT_TIMESTAMP) WHERE threadId = ? AND fromRole = 'driver'`, [threadId], () => {});

      db.all(
        `SELECT id, threadId, fromUserId, fromRole, body, createdAt
         FROM broadcast_messages
         WHERE threadId = ?
         ORDER BY id ASC
         LIMIT 500`,
        [threadId],
        (mErr, rows) => {
          if (mErr) return res.status(500).json({ error: mErr.message });
          res.json(rows || []);
        }
      );
    });
  });
});

router.post('/broadcast-threads/:id/message', authenticateToken, authorizeRole('manager'), (req, res) => {
  const threadId = parseInt(req.params.id, 10);
  const body = (req.body?.body != null ? String(req.body.body) : '').trim();
  if (!threadId || Number.isNaN(threadId)) return res.status(400).json({ error: 'Некорректный id' });
  if (!body) return res.status(400).json({ error: 'Текст обязателен' });

  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(403).json({ error: 'Access denied' });
    if (!ensureCanAccessBroadcasts(manager, res)) return;

    db.get(`SELECT id, parkId, driverUserId FROM broadcast_threads WHERE id = ?`, [threadId], (tErr, tRow) => {
      if (tErr) return res.status(500).json({ error: tErr.message });
      if (!tRow || tRow.parkId !== manager.parkId) return res.status(404).json({ error: 'Не найдено' });

      db.run(
        `INSERT INTO broadcast_messages (threadId, fromUserId, fromRole, body, readAtPark)
         VALUES (?, ?, 'park', ?, CURRENT_TIMESTAMP)`,
        [threadId, req.user.userId, body],
        function (iErr) {
          if (iErr) return res.status(500).json({ error: iErr.message });

          db.run(
            `UPDATE broadcast_threads
             SET lastMessageAt = CURRENT_TIMESTAMP,
                 lastMessageFrom = 'park',
                 unreadForDriver = 1,
                 updatedAt = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [threadId],
            () => {}
          );

          // Водителю — нотификация о новом сообщении в треде
          db.run(
            `INSERT INTO notifications (userId, type, title, body)
             VALUES (?, 'broadcast_thread', 'Сообщение от парка', ?)`,
            [tRow.driverUserId, body.slice(0, 500)],
            () => {}
          );

          res.status(201).json({ id: this.lastID, ok: true });
        }
      );
    });
  });
});
router.get('/drivers/monitoring', authenticateToken, authorizeRole('manager'), (req, res) => {
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(403).json({ error: 'Access denied' });
    if (!ensureCanAccessBroadcasts(manager, res)) return;

    const category = String(req.query?.category || 'inactive_no_epl');
    const days = Math.max(1, Math.min(365, parseInt(req.query?.days || '7', 10) || 7));
    const balanceLt = Math.max(0, Number(req.query?.balanceLt ?? 200) || 200);
    const q = (req.query?.q != null ? String(req.query.q) : '').trim();
    const limit = Math.max(1, Math.min(500, parseInt(req.query?.limit || '100', 10) || 100));
    const offset = Math.max(0, parseInt(req.query?.offset || '0', 10) || 0);

    const where = ['d.parkId = ?'];
    const params = [manager.parkId];
    if (q) {
      where.push('(LOWER(COALESCE(u.fullName, \'\')) LIKE ? OR LOWER(COALESCE(u.phone, \'\')) LIKE ?)');
      const like = `%${q.toLowerCase()}%`;
      params.push(like, like);
    }

    const baseSql = `
      WITH epl_agg AS (
        SELECT
          e.driverId as driverId,
          MAX(COALESCE(e.documentPdfReceivedAt, e.approvedAt, e.mintransCreatedAt, e.createdAt)) as lastEplAt,
          SUM(CASE WHEN e.createdAt >= datetime('now', '-7 days') THEN 1 ELSE 0 END) as epl7d,
          SUM(CASE WHEN e.createdAt >= datetime('now', '-30 days') THEN 1 ELSE 0 END) as epl30d
        FROM epl e
        GROUP BY e.driverId
      )
      SELECT
        d.id as driverId,
        d.userId as userId,
        d.parkId as parkId,
        p.name as parkName,
        u.fullName as fullName,
        u.phone as phone,
        (COALESCE(u.balanceReal,0) + COALESCE(u.balanceUnreal,0)) as balance,
        a.lastEplAt as lastEplAt,
        COALESCE(a.epl7d, 0) as epl7d,
        COALESCE(a.epl30d, 0) as epl30d
      FROM drivers d
      JOIN users u ON u.id = d.userId
      LEFT JOIN parks p ON p.id = d.parkId
      LEFT JOIN epl_agg a ON a.driverId = d.id
    `;

    let finalWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    if (category === 'low_balance') {
      const cond = `(COALESCE(u.balanceReal,0) + COALESCE(u.balanceUnreal,0)) < ?`;
      finalWhere = finalWhere ? `${finalWhere} AND ${cond}` : `WHERE ${cond}`;
      params.push(balanceLt);
    } else if (category === 'no_car') {
      const cond = `(d.carId IS NULL OR d.carId = '')`;
      finalWhere = finalWhere ? `${finalWhere} AND ${cond}` : `WHERE ${cond}`;
    } else {
      const cond = `(a.lastEplAt IS NULL OR a.lastEplAt < datetime('now', ?))`;
      finalWhere = finalWhere ? `${finalWhere} AND ${cond}` : `WHERE ${cond}`;
      params.push(`-${days} days`);
    }

    const orderSql = `
      ORDER BY
        CASE WHEN lastEplAt IS NULL THEN 0 ELSE 1 END ASC,
        lastEplAt ASC,
        balance ASC
    `;

    const listSql = `${baseSql} ${finalWhere} ${orderSql} LIMIT ? OFFSET ?`;
    const countSql = `${baseSql} ${finalWhere}`;
    const countWrappedSql = `SELECT COUNT(*) as total FROM (${countSql})`;
    const countParams = [...params];
    const dataParams = [...params, limit, offset];

    db.get(countWrappedSql, countParams, (cErr, cRow) => {
      if (cErr) return res.status(500).json({ error: cErr.message });
      const total = cRow?.total != null ? Number(cRow.total) : 0;
      db.all(listSql, dataParams, (qErr, rows) => {
        if (qErr) return res.status(500).json({ error: qErr.message });
        res.json({
          category,
          parkId: manager.parkId,
          days,
          balanceLt,
          q: q || '',
          total,
          offset,
          limit,
          items: rows || [],
        });
      });
    });
  });
});

router.get('/drivers/monitoring/ids', authenticateToken, authorizeRole('manager'), (req, res) => {
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(403).json({ error: 'Access denied' });
    if (!ensureCanAccessBroadcasts(manager, res)) return;

    const category = String(req.query?.category || 'inactive_no_epl');
    const days = Math.max(1, Math.min(365, parseInt(req.query?.days || '7', 10) || 7));
    const balanceLt = Math.max(0, Number(req.query?.balanceLt ?? 200) || 200);
    const q = (req.query?.q != null ? String(req.query.q) : '').trim();
    const max = 2500;

    const where = ['d.parkId = ?'];
    const params = [manager.parkId];
    if (q) {
      where.push('(LOWER(COALESCE(u.fullName, \'\')) LIKE ? OR LOWER(COALESCE(u.phone, \'\')) LIKE ?)');
      const like = `%${q.toLowerCase()}%`;
      params.push(like, like);
    }

    const baseSql = `
      WITH epl_agg AS (
        SELECT
          e.driverId as driverId,
          MAX(COALESCE(e.documentPdfReceivedAt, e.approvedAt, e.mintransCreatedAt, e.createdAt)) as lastEplAt
        FROM epl e
        GROUP BY e.driverId
      )
      SELECT d.userId as userId
      FROM drivers d
      JOIN users u ON u.id = d.userId
      LEFT JOIN epl_agg a ON a.driverId = d.id
    `;

    let finalWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    if (category === 'low_balance') {
      const cond = `(COALESCE(u.balanceReal,0) + COALESCE(u.balanceUnreal,0)) < ?`;
      finalWhere = finalWhere ? `${finalWhere} AND ${cond}` : `WHERE ${cond}`;
      params.push(balanceLt);
    } else if (category === 'no_car') {
      const cond = `(d.carId IS NULL OR d.carId = '')`;
      finalWhere = finalWhere ? `${finalWhere} AND ${cond}` : `WHERE ${cond}`;
    } else {
      const cond = `(a.lastEplAt IS NULL OR a.lastEplAt < datetime('now', ?))`;
      finalWhere = finalWhere ? `${finalWhere} AND ${cond}` : `WHERE ${cond}`;
      params.push(`-${days} days`);
    }

    const sql = `${baseSql} ${finalWhere} ORDER BY userId ASC LIMIT ?`;
    db.all(sql, [...params, max], (e2, rows) => {
      if (e2) return res.status(500).json({ error: e2.message });
      const ids = (rows || []).map((r) => r.userId).filter(Boolean);
      res.json({ ids, max, truncated: ids.length >= max });
    });
  });
});

router.post('/drivers/broadcast', authenticateToken, authorizeRole('manager'), (req, res) => {
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(403).json({ error: 'Access denied' });
    if (!ensureCanAccessBroadcasts(manager, res)) return;

    const { userIds, title, body, requireReply } = req.body || {};
    const ids = Array.isArray(userIds) ? userIds.map((x) => parseInt(String(x), 10)).filter((n) => n && !Number.isNaN(n)) : [];
    const t = (title != null ? String(title) : '').trim();
    const b = (body != null ? String(body) : '').trim();
    if (ids.length === 0) return res.status(400).json({ error: 'Выберите водителей' });
    if (!b) return res.status(400).json({ error: 'Текст уведомления обязателен' });

    const placeholders = ids.map(() => '?').join(',');
    db.all(
      `SELECT d.userId as userId FROM drivers d WHERE d.parkId = ? AND d.userId IN (${placeholders})`,
      [manager.parkId, ...ids],
      (e2, rows) => {
        if (e2) return res.status(500).json({ error: e2.message });
        const allowed = new Set((rows || []).map((r) => r.userId));
        const finalIds = ids.filter((id) => allowed.has(id));
        if (finalIds.length === 0) return res.status(403).json({ error: 'Нет доступных водителей для рассылки' });

        const needsReply = requireReply === true || requireReply === 1 || requireReply === '1' || requireReply === 'true';
        if (!needsReply) {
          const notifStmt = db.prepare('INSERT INTO notifications (userId, type, title, body) VALUES (?, ?, ?, ?)');
          finalIds.forEach((driverUserId) => {
            notifStmt.run(driverUserId, 'manager_broadcast', t || 'Сообщение от менеджера', b);
          });
          return notifStmt.finalize((e3) => {
            if (e3) return res.status(500).json({ error: e3.message });
            res.json({ success: true, sent: finalIds.length, skipped: ids.length - finalIds.length, threadsCreated: 0, threadsErrors: false });
          });
        }

        db.get('SELECT broadcastRepliesRouting FROM parks WHERE id = ?', [manager.parkId], (pErr, pRow) => {
          const routing = (pRow?.broadcastRepliesRouting === 'sender') ? 'sender' : 'park';
          const assignedToUserId = routing === 'sender' ? req.user.userId : null;

          const notifStmt = db.prepare('INSERT INTO notifications (userId, type, title, body) VALUES (?, ?, ?, ?)');
          const threadStmt = db.prepare(
            `INSERT INTO broadcast_threads (parkId, driverUserId, createdByUserId, assignedToUserId, title, lastMessageAt, lastMessageFrom, unreadForDriver, unreadForPark)
             VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'park', 1, 0)`
          );
          const msgStmt = db.prepare(
            `INSERT INTO broadcast_messages (threadId, fromUserId, fromRole, body, readAtPark)
             VALUES (?, ?, 'park', ?, CURRENT_TIMESTAMP)`
          );

          let createdThreads = 0;
          let hadThreadErrors = false;
          let pending = finalIds.length;
          let responded = false;

          const finish = () => {
            if (responded) return;
            responded = true;
            notifStmt.finalize(() => {});
            threadStmt.finalize(() => {});
            msgStmt.finalize(() => {});
            res.json({
              success: true,
              sent: finalIds.length,
              skipped: ids.length - finalIds.length,
              threadsCreated: createdThreads,
              threadsErrors: hadThreadErrors
            });
          };

          finalIds.forEach((driverUserId) => {
            notifStmt.run(driverUserId, 'manager_broadcast', t || 'Сообщение от менеджера', b);
            threadStmt.run(manager.parkId, driverUserId, req.user.userId, assignedToUserId, t || 'Сообщение от парка', function (tErr) {
              if (tErr) { hadThreadErrors = true; }
              else {
                const threadId = this.lastID;
                createdThreads += 1;
                msgStmt.run(threadId, req.user.userId, b);
              }

              pending -= 1;
              if (pending <= 0) finish();
            });
          });
          if (finalIds.length === 0) finish();
        });
      }
    );
  });
});

router.get('/broadcast-templates', authenticateToken, authorizeRole('manager'), (req, res) => {
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(403).json({ error: 'Access denied' });
    if (!ensureCanAccessBroadcasts(manager, res)) return;
    db.all('SELECT id, title, body, createdAt, updatedAt FROM admin_broadcast_templates ORDER BY updatedAt DESC, id DESC LIMIT 200', [], (e2, rows) => {
      if (e2) return res.status(500).json({ error: e2.message });
      res.json(rows || []);
    });
  });
});

router.post('/broadcast-templates', authenticateToken, authorizeRole('manager'), (req, res) => {
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(403).json({ error: 'Access denied' });
    if (!ensureCanAccessBroadcasts(manager, res)) return;
    const title = (req.body?.title != null ? String(req.body.title) : '').trim();
    const body = (req.body?.body != null ? String(req.body.body) : '').trim();
    if (!title) return res.status(400).json({ error: 'Укажите название' });
    if (!body) return res.status(400).json({ error: 'Укажите текст' });
    db.run(
      'INSERT INTO admin_broadcast_templates (title, body, createdAt, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
      [title, body],
      function (e2) {
        if (e2) return res.status(500).json({ error: e2.message });
        res.status(201).json({ id: this.lastID, title, body });
      }
    );
  });
});

router.put('/broadcast-templates/:id', authenticateToken, authorizeRole('manager'), (req, res) => {
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(403).json({ error: 'Access denied' });
    if (!ensureCanAccessBroadcasts(manager, res)) return;
    const id = parseInt(req.params.id, 10);
    if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    const title = (req.body?.title != null ? String(req.body.title) : '').trim();
    const body = (req.body?.body != null ? String(req.body.body) : '').trim();
    if (!title) return res.status(400).json({ error: 'Укажите название' });
    if (!body) return res.status(400).json({ error: 'Укажите текст' });
    db.run(
      'UPDATE admin_broadcast_templates SET title = ?, body = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
      [title, body, id],
      function (e2) {
        if (e2) return res.status(500).json({ error: e2.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Не найдено' });
        res.json({ success: true });
      }
    );
  });
});

router.delete('/broadcast-templates/:id', authenticateToken, authorizeRole('manager'), (req, res) => {
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(403).json({ error: 'Access denied' });
    if (!ensureCanAccessBroadcasts(manager, res)) return;
    const id = parseInt(req.params.id, 10);
    if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    db.run('DELETE FROM admin_broadcast_templates WHERE id = ?', [id], function (e2) {
      if (e2) return res.status(500).json({ error: e2.message });
      res.json({ success: this.changes > 0 });
    });
  });
});

function ensureDriverInPark(parkId, driverUserId, cb) {
  db.get(
    'SELECT id FROM drivers WHERE userId = ? AND parkId = ?',
    [driverUserId, parkId],
    (err, row) => {
      if (err) return cb(err);
      if (!row) return cb(new Error('Водитель не найден или не из вашего парка'));
      cb(null);
    }
  );
}

router.post('/drivers/:userId/balance', authenticateToken, authorizeRole('manager'), (req, res) => {
  const { userId } = req.params;
  const { amount, amountType = 'real' } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Укажите сумму больше 0' });
  const num = Number(amount);
  if (isNaN(num)) return res.status(400).json({ error: 'Некорректная сумма' });
  getManagerWithPermissions(req.user.userId, req.query.parkId ? parseInt(req.query.parkId, 10) : null, (err, m) => {
    if (err || !m) return res.status(403).json({ error: 'Доступ запрещён' });
      if (!m.canTopupBalance) return res.status(403).json({ error: 'Нет доступа: пополнение баланса' });
      ensureDriverInPark(m.parkId, userId, (e) => {
        if (e) return res.status(403).json({ error: e.message });
        // Используем утилиту для пополнения баланса
        addBalance(
          db,
          userId,
          num,
          amountType,
          amountType === 'real' ? 'Пополнение из кассы (менеджер)' : 'Бонус (менеджер)',
          (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: 'Баланс пополнен', amount: num, amountType });
          }
        );
      });
  });
});

router.post('/drivers/:userId/fine', authenticateToken, authorizeRole('manager'), (req, res) => {
  const { userId } = req.params;
  const { amount, description = 'Штраф' } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Укажите сумму штрафа больше 0' });
  const num = Number(amount);
  if (isNaN(num)) return res.status(400).json({ error: 'Некорректная сумма' });
  getManagerWithPermissions(req.user.userId, req.query.parkId ? parseInt(req.query.parkId, 10) : null, (err, m) => {
    if (err || !m) return res.status(403).json({ error: 'Доступ запрещён' });
      if (!m.canFine) return res.status(403).json({ error: 'Нет доступа: штраф' });
      ensureDriverInPark(m.parkId, userId, (e) => {
        if (e) return res.status(403).json({ error: e.message });
        // Используем утилиту для списания баланса (с учетом настройки парка)
        deductBalance(
          db,
          userId,
          m.parkId,
          num,
          description,
          null,
          'expense',
          (req.body && req.body.operationKey) ? String(req.body.operationKey) : `fine:manager:${userId}:${Date.now()}`,
          (err, result) => {
            if (err) {
              return res.status(400).json({ error: err.message });
            }
            res.json({ success: true, message: 'Штраф списан', amount: num });
          }
        );
      });
  });
});

router.post('/drivers/:userId/dismiss', authenticateToken, authorizeRole('manager'), (req, res) => {
  const { userId } = req.params;
  getManagerWithPermissions(req.user.userId, req.query.parkId ? parseInt(req.query.parkId, 10) : null, (err, m) => {
    if (err || !m) return res.status(403).json({ error: 'Доступ запрещён' });
    if (!m.canDismiss) return res.status(403).json({ error: 'Нет доступа: уволить' });
    ensureDriverInPark(m.parkId, userId, (e) => {
      if (e) return res.status(403).json({ error: e.message });
      db.run('UPDATE drivers SET carId = NULL, isVerified = 0 WHERE userId = ?', [userId], function (uErr) {
        if (uErr) return res.status(500).json({ error: uErr.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Водитель не найден' });
        res.json({ success: true, message: 'Водитель уволен' });
      });
    });
  });
});

// Войти от имени водителя своего парка (короткоживущий токен)
router.post('/impersonate-driver/:driverUserId', authenticateToken, authorizeRole('manager'), (req, res) => {
  const { driverUserId } = req.params;
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

  getManagerWithPermissions(req.user.userId, req.query.parkId ? parseInt(req.query.parkId, 10) : null, (err, m) => {
    if (err || !m) return res.status(403).json({ error: 'Доступ запрещён' });
    ensureDriverInPark(m.parkId, driverUserId, (e) => {
      if (e) return res.status(403).json({ error: e.message });
      db.get(
        `SELECT u.id, u.username, u.phone, u.fullName, d.parkId
         FROM drivers d
         JOIN users u ON d.userId = u.id
         WHERE u.id = ? AND d.parkId = ?`,
        [driverUserId, m.parkId],
        (dbErr, row) => {
          if (dbErr) return res.status(500).json({ error: dbErr.message });
          if (!row) return res.status(404).json({ error: 'Водитель не найден' });

          const token = jwt.sign(
            { userId: row.id, role: 'driver' },
            JWT_SECRET,
            { expiresIn: '1h' }
          );
          res.json({
            token,
            user: {
              id: row.id,
              username: row.username,
              phone: row.phone,
              fullName: row.fullName,
              role: 'driver',
              parkId: row.parkId
            }
          });
        }
      );
    });
  });
});

router.delete('/drivers/:userId/remove', authenticateToken, authorizeRole('manager'), (req, res) => {
  const { userId } = req.params;
  getManagerWithPermissions(req.user.userId, req.query.parkId ? parseInt(req.query.parkId, 10) : null, (err, m) => {
    if (err || !m) return res.status(403).json({ error: 'Доступ запрещён' });
    if (!m.canDeleteDriver) return res.status(403).json({ error: 'Нет доступа: удалить из системы' });
    ensureDriverInPark(m.parkId, userId, (e) => {
      if (e) return res.status(403).json({ error: e.message });
      // Получаем driverId для каскадного удаления
      db.get('SELECT id, carId FROM drivers WHERE userId = ?', [userId], (getErr, driver) => {
        if (getErr) return res.status(500).json({ error: getErr.message });
        if (!driver) return res.status(404).json({ error: 'Водитель не найден' });
        
        const driverId = driver.id;
        
        // 0. Отвязываем авто — авто останется в парке как свободное
        db.run('UPDATE drivers SET carId = NULL WHERE id = ?', [driverId], (unbindErr) => {
          if (unbindErr) console.warn('[Delete Driver] Car unbind warning:', unbindErr.message);
          else if (driver.carId) console.log(`[Delete Driver] Авто id=${driver.carId} отвязано от водителя userId=${userId}`);
        });
        
        // Каскадное удаление связанных записей
        // 1. Помечаем незавершённые ЭПЛ как failed, не удаляем историю
        db.run(
          `UPDATE epl SET status = 'failed', errorMessage = 'Водитель удалён из системы' WHERE driverId = ? AND status IN (${sqlQuoteList(CLOSE_SHIFT_FAIL_STATUSES)})`,
          [driverId],
          (eplErr) => {
          if (eplErr) console.warn('[Delete Driver] EPL deletion warning:', eplErr.message);
          
          // 2. Удаляем смены (shifts)
          db.run('DELETE FROM shifts WHERE driverId = ?', [userId], (shiftErr) => {
            if (shiftErr) console.warn('[Delete Driver] Shifts deletion warning:', shiftErr.message);
            
            // 3. Удаляем историю баланса
            db.run('DELETE FROM balance_history WHERE userId = ?', [userId], (balanceErr) => {
              if (balanceErr) console.warn('[Delete Driver] Balance history deletion warning:', balanceErr.message);
              
              // 4. Удаляем уведомления
              db.run('DELETE FROM notifications WHERE userId = ?', [userId], (notifErr) => {
                if (notifErr) console.warn('[Delete Driver] Notifications deletion warning:', notifErr.message);
                
                // 5. Удаляем платежи
                db.run('DELETE FROM payments WHERE userId = ?', [userId], (payErr) => {
                  if (payErr) console.warn('[Delete Driver] Payments deletion warning:', payErr.message);
                  
                  // 6. Удаляем запись водителя
                  db.run('DELETE FROM drivers WHERE userId = ?', [userId], (e1) => {
                    if (e1) return res.status(500).json({ error: e1.message });
                    
                    // 7. Удаляем пользователя
                    db.run('DELETE FROM users WHERE id = ?', [userId], (e2) => {
                      if (e2) return res.status(500).json({ error: e2.message });
                      res.json({ success: true, message: 'Водитель удалён из системы' });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});

/**
 * GET /api/manager/epl — список ЭПЛ парка (для кнопки «Завершить без водителя» и т.п.)
 */
router.get('/epl', authenticateToken, authorizeRole('manager'), (req, res) => {
  getManagerPark(req, (err, manager) => {
    if (err || !manager) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }
      db.all(
        `SELECT e.id, e.waybillNumber, e.status, e.startOdometer, e.endOdometer, e.distance, e.createdAt,
                u.fullName as driverName, c.regNumber as carRegNumber
         FROM epl e
         JOIN drivers d ON e.driverId = d.id
         LEFT JOIN users u ON d.userId = u.id
         LEFT JOIN cars c ON e.carId = c.id AND c.parkId = e.parkId
         WHERE e.parkId = ?
         ORDER BY e.createdAt DESC
         LIMIT 500`,
        [manager.parkId],
        (errEpl, rows) => {
          if (errEpl) {
            return res.status(500).json({ error: errEpl.message });
          }
          res.json(rows || []);
        }
      );
    }
  );
});

/**
 * POST /api/manager/epl/:id/complete-without-driver
 * Завершить рейс без водителя: Т5 (одометр заезда) отправляется в Такском, Т6 не заполняем.
 * Body: { endOdometer? } — если не указан, берётся startOdometer + DEFAULT_KM (50 км или EPL_COMPLETE_DEFAULT_KM).
 */
router.post('/epl/:id/complete-without-driver', authenticateToken, authorizeRole('manager'), async (req, res) => {
  try {
    const { id } = req.params;
    const { endOdometer } = req.body;

    getManagerPark(req, (err, manager) => {
      if (err || !manager) {
        return res.status(403).json({ error: 'Доступ запрещён' });
      }

        db.get(
          `SELECT e.id, e.mintransId, e.eplGuid, e.startOdometer, e.parkId, e.createdAt,
             d.userId, u.fullName as driverName, u.licenseSerial, u.licenseNumber, u.licenseDate, u.personnelNumber, u.inn
           FROM epl e
           JOIN drivers d ON e.driverId = d.id
           LEFT JOIN users u ON d.userId = u.id
           WHERE e.id = ? AND e.parkId = ?`,
          [id, manager.parkId],
          async (errEpl, epl) => {
            if (errEpl || !epl) {
              return res.status(404).json({ error: 'Путевой лист не найден или не принадлежит вашему парку' });
            }
            if (!epl.mintransId) {
              return res.status(400).json({ error: 'У путевого нет mintransId (не создан в Такском)' });
            }
            if (isWaybillExpired(epl.createdAt)) {
              return res.status(400).json({
                error: `Путевой лист действует ${WAYBILL_VALIDITY_HOURS} ч с момента создания. Срок истёк.`
              });
            }

            let endOdo;
            if (endOdometer != null && endOdometer !== '') {
              endOdo = Number(endOdometer);
              if (isNaN(endOdo) || endOdo < 0) {
                return res.status(400).json({ error: 'Пробег при заезде должен быть числом ≥ 0' });
              }
            } else {
              const start = epl.startOdometer != null ? Number(epl.startOdometer) : 0;
              endOdo = start + DEFAULT_KM_ADD_IF_NO_DRIVER;
            }

            const eplIdForApi = epl.eplGuid || epl.mintransId;
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

            try {
              await TakskornAPI.completeRide(eplIdForApi, endOdo, 'suitable', {
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
            } catch (takskErr) {
              console.error('[Manager] completeRide Takskom error:', takskErr.message);
              return res.status(502).json({
                error: 'Не удалось завершить рейс в Такском',
                details: takskErr.message
              });
            }

            const distance = epl.startOdometer != null ? Math.max(0, endOdo - epl.startOdometer) : null;
            db.run(
              `INSERT OR IGNORE INTO epl_titles (eplId, titleCode, status) VALUES (?, 't5', 'filled')`,
              [id],
              (insErr) => { if (insErr) console.warn('[Manager] epl_titles t5 insert:', insErr.message); }
            );
            db.run(
              `UPDATE epl SET endOdometer = ?, distance = ?, status = 'submitted', updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
              [endOdo, distance, id],
              function (runErr) {
                if (runErr) {
                  return res.status(500).json({ error: runErr.message });
                }
                res.json({
                  id: parseInt(id, 10),
                  endOdometer: endOdo,
                  distance,
                  status: 'submitted',
                  message: 'Рейс завершён без водителя. Титул Т5 отправлен в Такском, Т6 не заполняем.'
                });
              }
            );
          }
        );
      }
    );
  } catch (error) {
    console.error('[Manager] POST /epl/:id/complete-without-driver error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ===== ФОТОКОНТРОЛЬ (менеджер парка или менеджер ФК) =====

function getManagerPark(req, cb) {
  const requestedParkId = req.query.parkId ? parseInt(req.query.parkId, 10) : null;
  const selectFields = `m.parkId, m.id as managerId, COALESCE(m.managerType, 'park') as managerType,
              COALESCE(m.canAccessPhotoControl, 0) as canAccessPhotoControl,
              COALESCE(m.canAccessStatistics, 0) as canAccessStatistics,
              COALESCE(m.statsShowFinance, 1) as statsShowFinance,
              COALESCE(m.statsShowEpl, 1) as statsShowEpl,
              COALESCE(m.statsShowDrivers, 1) as statsShowDrivers,
              COALESCE(m.driverStatsShowBalance, 1) as driverStatsShowBalance,
              COALESCE(m.driverStatsShowEpl, 1) as driverStatsShowEpl,
              COALESCE(m.driverStatsShowShifts, 1) as driverStatsShowShifts,
              COALESCE(m.canViewEplLogs, 0) as canViewEplLogs,
              COALESCE(m.canControlEplQueue, 0) as canControlEplQueue,
              COALESCE(m.canCloseEplShifts, 0) as canCloseEplShifts,
              COALESCE(m.canChargeOnShiftClose, 0) as canChargeOnShiftClose,
              COALESCE(m.canDownloadEplDocs, 0) as canDownloadEplDocs,
              COALESCE(m.canChangeDriverPassword, 0) as canChangeDriverPassword,
              COALESCE(m.canAccessBroadcasts, 0) as canAccessBroadcasts,
              COALESCE(m.canAccessFinance, 0) as canAccessFinance,
              COALESCE(m.financeShowKassa, 1) as financeShowKassa,
              COALESCE(m.financeShowSalary, 1) as financeShowSalary,
              COALESCE(m.financeShowParks, 1) as financeShowParks,
              COALESCE(m.financeShowMonthly, 1) as financeShowMonthly,
              COALESCE(m.financeScopeAll, 0) as financeScopeAll`;
  if (requestedParkId) {
    db.get(
      `SELECT ${selectFields}
       FROM managers m JOIN users u ON m.userId = u.id
       WHERE u.id = ? AND m.parkId = ?`,
      [req.user.userId, requestedParkId],
      (err, row) => {
        if (err) return cb(err, null);
        if (!row) return cb(new Error('Access denied to this park'), null);
        cb(null, row);
      }
    );
  } else {
    db.get(
      `SELECT ${selectFields}
       FROM managers m JOIN users u ON m.userId = u.id WHERE u.id = ?`,
      [req.user.userId],
      cb
    );
  }
}

router.get('/photo-control/applications', authenticateToken, authorizeRole('manager'), (req, res) => {
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(404).json({ error: 'Manager not found' });
    const { status } = req.query;
    let sql = `SELECT a.id, a.driverId, a.carId, a.status, a.approvedAt, a.validUntil, a.rejectReason, a.createdAt,
                u.fullName as driverName, u.phone as driverPhone, c.regNumber
                FROM photo_control_applications a
                JOIN drivers d ON a.driverId = d.id
                JOIN users u ON d.userId = u.id
                LEFT JOIN cars c ON a.carId = c.id
                WHERE a.parkId = ?`;
    const params = [manager.parkId];
    if (status === 'pending') {
      sql += ' AND a.status = \'pending\'';
    } else if (status === 'past') {
      sql += ' AND a.status IN (\'approved\', \'rejected\')';
    }
    sql += ' ORDER BY a.status = \'pending\' DESC, a.createdAt DESC LIMIT 50';
    db.all(sql, params, (e, rows) => {
      if (e) return res.status(500).json({ error: e.message });
      res.json(rows || []);
    });
  });
});

router.get('/photo-control/applications/:id', authenticateToken, authorizeRole('manager'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(404).json({ error: 'Not found' });
    db.get(
      `SELECT a.id, a.driverId, a.carId, a.status, a.approvedAt, a.validUntil, a.rejectReason, a.createdAt, a.updatedAt, a.correctionRequestedAt,
        u.fullName as driverName, u.phone as driverPhone, c.regNumber
       FROM photo_control_applications a
       JOIN drivers d ON a.driverId = d.id
       JOIN users u ON d.userId = u.id
       LEFT JOIN cars c ON a.carId = c.id
       WHERE a.id = ? AND a.parkId = ?`,
      [id, manager.parkId],
      (e, app) => {
        if (e || !app) return res.status(404).json({ error: 'Not found' });
        db.all('SELECT stepIndex, mediaType, filePath, managerVerdict, managerComment, reviewedAt, reviewedByUserId FROM photo_control_steps WHERE applicationId = ? ORDER BY stepIndex', [id], (e2, steps) => {
          if (e2) return res.status(500).json({ error: e2.message });
          res.json({ ...app, steps: steps || [] });
        });
      }
    );
  });
});

router.patch('/photo-control/applications/:id/steps', authenticateToken, authorizeRole('manager'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { steps: stepsBody } = req.body || {};
  if (!id || !Array.isArray(stepsBody) || stepsBody.length === 0) return res.status(400).json({ error: 'Требуется массив steps: [{ stepIndex, verdict, comment? }]' });
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(404).json({ error: 'Not found' });
    db.get('SELECT id FROM photo_control_applications WHERE id = ? AND parkId = ? AND status = ?', [id, manager.parkId, 'pending'], (e, app) => {
      if (e || !app) return res.status(404).json({ error: 'Not found or not pending' });
      const userId = req.user.userId;
      let done = 0;
      const total = stepsBody.length;
      const onDone = (err) => {
        if (err) return res.status(500).json({ error: err.message });
        done++;
        if (done >= total) res.json({ message: 'Вердикты сохранены.' });
      };
      for (const { stepIndex, verdict, comment } of stepsBody) {
        const si = parseInt(stepIndex, 10);
        if (si < 1 || si > 10) { onDone(null); continue; }
        const v = verdict === 'needs_correction' ? 'needs_correction' : 'ok';
        db.run(
          `UPDATE photo_control_steps SET managerVerdict = ?, managerComment = ?, reviewedAt = datetime('now'), reviewedByUserId = ? WHERE applicationId = ? AND stepIndex = ?`,
          [v, comment || null, userId, id, si],
          (upErr) => { onDone(upErr); }
        );
      }
    });
  });
});

router.patch('/photo-control/applications/:id/request-correction', authenticateToken, authorizeRole('manager'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(404).json({ error: 'Not found' });
    db.get('SELECT id, driverId FROM photo_control_applications WHERE id = ? AND parkId = ? AND status = ?', [id, manager.parkId, 'pending'], (e, app) => {
      if (e || !app) return res.status(404).json({ error: 'Not found or not pending' });
      db.all('SELECT stepIndex, managerVerdict FROM photo_control_steps WHERE applicationId = ?', [id], (e2, steps) => {
        if (e2) return res.status(500).json({ error: e2.message });
        const needsCount = (steps || []).filter((s) => s.managerVerdict === 'needs_correction').length;
        if (needsCount === 0) return res.status(400).json({ error: 'Отметьте хотя бы один шаг «На доработку».' });
        db.run(
          `UPDATE photo_control_applications SET correctionRequestedAt = datetime('now'), updatedAt = datetime('now') WHERE id = ?`,
          [id],
          (upErr) => {
            if (upErr) return res.status(500).json({ error: upErr.message });
            db.get('SELECT userId FROM drivers WHERE id = ?', [app.driverId], (e3, dr) => {
              if (!e3 && dr?.userId) {
                const stepNums = (steps || []).filter((s) => s.managerVerdict === 'needs_correction').map((s) => s.stepIndex).sort((a, b) => a - b);
                const body = `Требуется доработка шагов: ${stepNums.join(', ')}. Перезагрузите фото/видео в заявке на фотоконтроль.`;
                db.run('INSERT INTO notifications (userId, type, title, body) VALUES (?, ?, ?, ?)', [dr.userId, 'photo_control_correction', 'Фотоконтроль: на доработку', body], () => {});
              }
              res.json({ message: 'Водителю отправлено уведомление о доработке.' });
            });
          }
        );
      });
    });
  });
});

router.patch('/photo-control/applications/:id/approve', authenticateToken, authorizeRole('manager'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(404).json({ error: 'Not found' });
    db.get(
      'SELECT id FROM photo_control_applications WHERE id = ? AND parkId = ? AND status = ?',
      [id, manager.parkId, 'pending'],
      (e, app) => {
        if (e || !app) return res.status(404).json({ error: 'Not found or not pending' });
        db.all('SELECT stepIndex, managerVerdict FROM photo_control_steps WHERE applicationId = ?', [id], (eSteps, steps) => {
          if (eSteps) return res.status(500).json({ error: eSteps.message });
          const allOk = steps && steps.length === 10 && steps.every((s) => s.managerVerdict === 'ok');
          if (!allOk) return res.status(400).json({ error: 'Одобрить можно только когда все 10 шагов отмечены «Норм».' });
          db.get('SELECT validDays FROM park_photo_control_settings WHERE parkId = ?', [manager.parkId], (e2, settings) => {
            const days = (settings && Number(settings.validDays)) || 10;
            const validUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
            db.run(
              `UPDATE photo_control_applications SET status = 'approved', approvedAt = datetime('now'), approvedByUserId = ?, validUntil = ?, correctionRequestedAt = NULL, updatedAt = datetime('now') WHERE id = ?`,
              [req.user.userId, validUntil, id],
              (upErr) => {
                if (upErr) return res.status(500).json({ error: upErr.message });
                res.json({ status: 'approved', validUntil, message: 'Фотоконтроль подтверждён.' });
              }
            );
          });
        });
      }
    );
  });
});

router.patch('/photo-control/applications/:id/reject', authenticateToken, authorizeRole('manager'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { reason } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(404).json({ error: 'Not found' });
    db.get(
      'SELECT id FROM photo_control_applications WHERE id = ? AND parkId = ? AND status = ?',
      [id, manager.parkId, 'pending'],
      (e, app) => {
        if (e || !app) return res.status(404).json({ error: 'Not found or not pending' });
        db.run(
          `UPDATE photo_control_applications SET status = 'rejected', rejectReason = ?, updatedAt = datetime('now') WHERE id = ?`,
          [reason || 'Отклонено', id],
          (upErr) => {
            if (upErr) return res.status(500).json({ error: upErr.message });
            res.json({ status: 'rejected', message: 'Заявка отклонена.' });
          }
        );
      }
    );
  });
});

router.get('/photo-control/me', authenticateToken, authorizeRole('manager'), (req, res) => {
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(404).json({ error: 'Not found' });
    res.json({ parkId: manager.parkId, managerType: manager.managerType || 'park' });
  });
});

router.get('/photo-control/applications/:id/steps/:stepIndex/file', authenticateToken, authorizeRole('manager'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const stepIndex = parseInt(req.params.stepIndex, 10);
  if (!id || stepIndex < 1 || stepIndex > 10) return res.status(400).end();
  getManagerPark(req, (err, manager) => {
    if (err || !manager) return res.status(404).end();
    db.get(
      'SELECT id FROM photo_control_applications WHERE id = ? AND parkId = ?',
      [id, manager.parkId],
      (e, app) => {
        if (e || !app) return res.status(404).end();
        db.get(
          'SELECT filePath FROM photo_control_steps WHERE applicationId = ? AND stepIndex = ?',
          [id, stepIndex],
          (e2, step) => {
            if (e2 || !step?.filePath) return res.status(404).end();
            const fullPath = path.join(__dirname, '..', 'uploads', step.filePath);
            if (!fs.existsSync(fullPath)) return res.status(404).end();
            const ext = path.extname(fullPath);
            res.setHeader('Content-Type', ext === '.mp4' ? 'video/mp4' : 'image/jpeg');
            fs.createReadStream(fullPath).pipe(res);
          }
        );
      }
    );
  });
});

// ===== Точки выгрузки / «магазины» (справочник парка) =====

router.get('/freight-stores', authenticateToken, authorizeRole('manager'), (req, res) => {
  const parkId = req.query.parkId ? parseInt(req.query.parkId, 10) : null;
  if (!parkId) return res.status(400).json({ error: 'Укажите parkId' });
  getManagerWithPermissions(req.user.userId, parkId, (err, m) => {
    if (err || !m) return res.status(403).json({ error: 'Доступ запрещён' });
    db.all(
      `SELECT id, parkId, name, addressText, contactNote, sortOrder, isActive, createdAt
       FROM park_freight_stores WHERE parkId = ? ORDER BY sortOrder ASC, id ASC`,
      [parkId],
      (e2, rows) => {
        if (e2) return res.status(500).json({ error: e2.message });
        res.json(rows || []);
      }
    );
  });
});

router.post('/freight-stores', authenticateToken, authorizeRole('manager'), (req, res) => {
  const parkId = req.query.parkId ? parseInt(req.query.parkId, 10) : null;
  if (!parkId) return res.status(400).json({ error: 'Укажите parkId' });
  getManagerWithPermissions(req.user.userId, parkId, (err, m) => {
    if (err || !m) return res.status(403).json({ error: 'Доступ запрещён' });
    const { name, addressText, contactNote, sortOrder, isActive } = req.body || {};
    const n = String(name || '').trim();
    const a = String(addressText || '').trim();
    if (!n || !a) return res.status(400).json({ error: 'Укажите название и адрес' });
    const so = sortOrder != null && !Number.isNaN(Number(sortOrder)) ? Math.floor(Number(sortOrder)) : 0;
    const act = isActive === false || isActive === 0 ? 0 : 1;
    db.run(
      `INSERT INTO park_freight_stores (parkId, name, addressText, contactNote, sortOrder, isActive)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [parkId, n, a, contactNote != null ? String(contactNote).trim() : null, so, act],
      function (insErr) {
        if (insErr) return res.status(500).json({ error: insErr.message });
        res.status(201).json({
          id: this.lastID,
          parkId,
          name: n,
          addressText: a,
          contactNote: contactNote != null ? String(contactNote).trim() : null,
          sortOrder: so,
          isActive: act,
        });
      }
    );
  });
});

router.put('/freight-stores/:storeId', authenticateToken, authorizeRole('manager'), (req, res) => {
  const parkId = req.query.parkId ? parseInt(req.query.parkId, 10) : null;
  const storeId = parseInt(req.params.storeId, 10);
  if (!parkId || !storeId) return res.status(400).json({ error: 'Укажите parkId и storeId' });
  getManagerWithPermissions(req.user.userId, parkId, (err, m) => {
    if (err || !m) return res.status(403).json({ error: 'Доступ запрещён' });
    const { name, addressText, contactNote, sortOrder, isActive } = req.body || {};
    const parts = [];
    const vals = [];
    if (name !== undefined) {
      parts.push('name = ?');
      vals.push(String(name).trim());
    }
    if (addressText !== undefined) {
      parts.push('addressText = ?');
      vals.push(String(addressText).trim());
    }
    if (contactNote !== undefined) {
      parts.push('contactNote = ?');
      vals.push(contactNote ? String(contactNote).trim() : null);
    }
    if (sortOrder !== undefined) {
      parts.push('sortOrder = ?');
      vals.push(Math.floor(Number(sortOrder)) || 0);
    }
    if (isActive !== undefined) {
      parts.push('isActive = ?');
      vals.push(isActive === false || isActive === 0 ? 0 : 1);
    }
    if (parts.length === 0) return res.status(400).json({ error: 'Нет полей для обновления' });
    vals.push(storeId, parkId);
    db.run(
      `UPDATE park_freight_stores SET ${parts.join(', ')} WHERE id = ? AND parkId = ?`,
      vals,
      function (uErr) {
        if (uErr) return res.status(500).json({ error: uErr.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Запись не найдена' });
        res.json({ success: true });
      }
    );
  });
});

router.delete('/freight-stores/:storeId', authenticateToken, authorizeRole('manager'), (req, res) => {
  const parkId = req.query.parkId ? parseInt(req.query.parkId, 10) : null;
  const storeId = parseInt(req.params.storeId, 10);
  if (!parkId || !storeId) return res.status(400).json({ error: 'Укажите parkId и storeId' });
  getManagerWithPermissions(req.user.userId, parkId, (err, m) => {
    if (err || !m) return res.status(403).json({ error: 'Доступ запрещён' });
    db.run(`DELETE FROM park_freight_stores WHERE id = ? AND parkId = ?`, [storeId, parkId], function (dErr) {
      if (dErr) return res.status(500).json({ error: dErr.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Запись не найдена' });
      res.json({ success: true });
    });
  });
});

module.exports = router;
