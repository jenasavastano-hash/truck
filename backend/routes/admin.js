
const express = require('express');
const router = express.Router();
const db = require('../database');
const { ensureParksTable, ensureParkExists } = require('../utils/parks-db');
const TakskornAPI = require('../takskom-api');
const { authenticateToken, authorizeRole, hashPassword, generateToken } = require('../auth');
const { deductBalance, addBalance, getBalance } = require('../utils/balance');
const { getMoscowDate, getMoscowDateFilter } = require('../utils/moscow-time');
const { CANCELABLE_BEFORE_TAXCOM, CLOSE_SHIFT_FAIL_STATUSES, IN_CREATION, sqlQuoteList } = require('../utils/epl-status');
const { normalizeCommercialShippingType } = require('../utils/commercialShippingTypes');
const { generateFastEplPdf } = require('../services/fast-epl-pdf');

// Проверка связи с Такскомом
router.get('/takskom/check', authenticateToken, authorizeRole('admin'), async (req, res) => {
  try {
    const info = await TakskornAPI.getInfo();
    console.log('[Admin] Takskom check:', JSON.stringify(info, null, 2));
    res.json({ success: true, info });
  } catch (e) {
    console.error('[Admin] Takskom check error:', e.message);
    res.status(502).json({ success: false, error: e.message });
  }
});

// Получить список парков из Takskom
router.get('/takskom/carparks', authenticateToken, authorizeRole('admin'), async (req, res) => {
  try {
    const info = await TakskornAPI.getInfo();
    console.log('[Admin] Available carparks from Takskom:', info.carParks);
    res.json({ 
      success: true, 
      carParks: info.carParks || [],
      message: info.carParks?.length > 0 ? `Found ${info.carParks.length} car parks` : 'No car parks found'
    });
  } catch (e) {
    console.error('[Admin] Takskom carparks fetch error:', e.message);
    res.status(502).json({ success: false, error: e.message });
  }
});

// Привязать существующий парк из Takskom
router.post('/takskom/link-carpark', authenticateToken, authorizeRole('admin'), async (req, res) => {
  try {
    const { takskomId, name, ogrn, inn, kpp, regionCode } = req.body;
    
    if (!takskomId) {
      return res.status(400).json({ error: 'Takskom carpark ID is required' });
    }

    // Получаем информацию о парке из Takskom
    const info = await TakskornAPI.getInfo();
    const carPark = info.carParks?.find(p => p.id === parseInt(takskomId));
    
    if (!carPark) {
      return res.status(404).json({ error: 'Carpark not found in Takskom' });
    }

    // Валидация OGRN (если указан, должен быть 13 цифр)
    if (ogrn && ogrn.length !== 13) {
      return res.status(400).json({ error: 'OGRN должен содержать 13 цифр' });
    }

    // Пытаемся получить реквизиты из данных парка в Такскоме (если они там есть)
    // Если их нет в API, используем переданные вручную (опционально)
    const parkOgrn = ogrn || carPark.ogrn || carPark.ogrnip || null;
    const parkInn = inn || carPark.inn || null;
    const parkKpp = kpp || carPark.kpp || null;
    const parkRegionCode = regionCode || carPark.regionCode || carPark.region_code || null;

    // Определяем статус парка: активен только если все данные заполнены
    const parkIsActive = (parkOgrn && parkOgrn.length === 13 && parkInn && parkKpp) ? 1 : 0;

    // Создаем новый парк в локальной БД с данными из Takskom
    // Используем колонку `postalIndex` вместо зарезервированного слова `index`
    db.run(
      `INSERT INTO parks (name, address, takskornId, syncedWithTakskom, region, city, street, house, postalIndex, ogrn, inn, kpp, regionCode, phone, isActive, lastSyncAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        name || carPark.name || 'Park from Takskom',
        carPark.address || '',
        carPark.id,
        1, // already synced since we got it from Takskom
        carPark.city_value || carPark.region || '',
        carPark.city_value || '',
        carPark.street_value || '',
        carPark.home_value || '',
        carPark.index_value || '',
        parkOgrn,
        parkInn,
        parkKpp,
        parkRegionCode,
        carPark.phone || null,
        parkIsActive
      ],
      function (err) {
        if (err) {
          console.error('[Admin] Failed to link carpark:', err.message);
          return res.status(500).json({ error: err.message });
        }

        const parkId = this.lastID;
        console.log(`[Admin] Linked park ${parkId} with Takskom ID ${takskomId}, isActive: ${parkIsActive}`);

        db.get('SELECT * FROM parks WHERE id = ?', [parkId], (gerr, updated) => {
          if (gerr) return res.status(500).json({ error: gerr.message });
          res.status(201).json({ 
            success: true, 
            message: `Park linked from Takskom`,
            park: updated 
          });
        });
      }
    );
  } catch (e) {
    console.error('[Admin] Link carpark error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Режим создания ЭПЛ: API Такском | Наш API (программа на ПК)
router.get('/settings/epl-creation-mode', authenticateToken, authorizeRole('admin'), (req, res) => {
  db.get('SELECT value FROM settings WHERE key = ?', ['epl_creation_mode'], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    const mode = (row && row.value) || 'takskom_api';
    res.json({ mode: mode === 'clinic_api' ? 'clinic_api' : 'takskom_api' });
  });
});

router.put('/settings/epl-creation-mode', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { mode } = req.body || {};
  if (mode !== 'takskom_api' && mode !== 'clinic_api') {
    return res.status(400).json({ error: 'mode должен быть takskom_api или clinic_api' });
  }
  db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['epl_creation_mode', mode], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ mode });
  });
});

// Сводка для главной страницы (парки, менеджеры, водители)
router.get('/home-stats', authenticateToken, authorizeRole('admin'), (req, res) => {
  db.get(
    `SELECT
       (SELECT COUNT(*) FROM parks) as parksCount,
       (SELECT COUNT(*) FROM managers) as managersCount,
       (SELECT COUNT(*) FROM drivers) as driversCount,
       (SELECT COUNT(*) FROM cars) as carsCount,
       (SELECT COUNT(*) FROM epl WHERE status IN (${sqlQuoteList(IN_CREATION)}) AND mintransId IS NOT NULL) as eplPendingCount`,
    [],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        parksCount: row?.parksCount ?? 0,
        managersCount: row?.managersCount ?? 0,
        driversCount: row?.driversCount ?? 0,
        carsCount: row?.carsCount ?? 0,
        eplPendingCount: row?.eplPendingCount ?? 0
      });
    }
  );
});

function buildWaybillNumber(parkId) {
  const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
  return `WB-${parkId}-${date}-${Date.now().toString().slice(-4)}`;
}

function validateParkActivationData(parkId) {
  return new Promise((resolve) => {
    db.all(
      `SELECT role, taxcomLogin, taxcomPassword
       FROM park_staff
       WHERE parkId = ? AND COALESCE(isActive,1) = 1`,
      [parkId],
      (sErr, staffRows) => {
        if (sErr) return resolve(`Ошибка проверки персонала: ${sErr.message}`);
        const byRole = { medic: [], technic: [], dispatcher: [] };
        (staffRows || []).forEach((s) => {
          if (byRole[s.role]) byRole[s.role].push(s);
        });
        for (const role of ['dispatcher', 'medic', 'technic']) {
          if (!byRole[role].length) return resolve(`Нельзя активировать парк: нет активного сотрудника роли "${role}"`);
          const hasTaxcomCreds = byRole[role].some((s) =>
            String(s.taxcomLogin || '').trim() && String(s.taxcomPassword || '').trim()
          );
          if (!hasTaxcomCreds) {
            return resolve(`Нельзя активировать парк: у роли "${role}" не заполнены логин/пароль Такском`);
          }
        }
        resolve(null);
      }
    );
  });
}

router.get('/shift-open-requests', authenticateToken, authorizeRole('admin'), (req, res) => {
  const search = String(req.query?.search || '').trim().toLowerCase();
  const statusRaw = String(req.query?.status || 'pending').trim().toLowerCase();
  const allowedStatuses = new Set(['pending', 'approved', 'rejected', 'all']);
  const status = allowedStatuses.has(statusRaw) ? statusRaw : 'pending';
  const parkIdRaw = parseInt(req.query?.parkId, 10);
  const parkId = Number.isFinite(parkIdRaw) && parkIdRaw > 0 ? parkIdRaw : null;
  const limitRaw = parseInt(req.query?.limit, 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(300, limitRaw)) : 80;

  const where = [];
  const params = [];
  if (parkId) {
    where.push('r.parkId = ?');
    params.push(parkId);
  }
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
      OR LOWER(COALESCE(p.name,'')) LIKE ?
    )`);
    const q = `%${search}%`;
    params.push(q, q, q, q, q);
  }
  params.push(limit);

  db.all(
    `SELECT r.id, r.parkId, r.driverUserId, r.driverId, r.carId, r.message, r.status,
            r.startOdometer, r.startFuel, r.commercialShippingType,
            r.freightOriginAddress, r.freightLoadAddress, r.freightUnloadAddresses,
            r.rejectionReason, r.requestedByUserId, r.processedByUserId, r.processedByRole,
            r.resultEplId, r.createdAt, r.updatedAt,
            p.name as parkName,
            u.fullName as driverName, u.phone as driverPhone,
            c.regNumber as carRegNumber,
            e.waybillNumber as resultWaybillNumber, e.status as resultEplStatus
     FROM shift_open_requests r
     LEFT JOIN users u ON u.id = r.driverUserId
     LEFT JOIN parks p ON p.id = r.parkId
     LEFT JOIN cars c ON c.id = r.carId
     LEFT JOIN epl e ON e.id = r.resultEplId
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY
       CASE r.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END,
       r.createdAt DESC, r.id DESC
     LIMIT ?`,
    params,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

router.post('/shift-open-requests/:id/approve', authenticateToken, authorizeRole('admin'), (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  if (!Number.isFinite(requestId) || requestId <= 0) {
    return res.status(400).json({ error: 'Некорректный id заявки' });
  }
  db.get(
    `SELECT *
     FROM shift_open_requests
     WHERE id = ?`,
    [requestId],
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
        [requestRow.driverUserId, requestRow.parkId],
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
                     processedByRole = 'admin',
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
                      `Администратор открыл смену. Путевой лист #${waybillNumber} поставлен в очередь.`,
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

router.post('/shift-open-requests/:id/reject', authenticateToken, authorizeRole('admin'), (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  if (!Number.isFinite(requestId) || requestId <= 0) {
    return res.status(400).json({ error: 'Некорректный id заявки' });
  }
  const reason = String(req.body?.reason || '').trim().slice(0, 500);
  db.get(
    `SELECT id, driverUserId, status
     FROM shift_open_requests
     WHERE id = ?`,
    [requestId],
    (rErr, requestRow) => {
      if (rErr) return res.status(500).json({ error: rErr.message });
      if (!requestRow) return res.status(404).json({ error: 'Заявка не найдена' });
      if (requestRow.status !== 'pending') return res.status(409).json({ error: 'Заявка уже обработана' });

      db.run(
        `UPDATE shift_open_requests
         SET status = 'rejected',
             rejectionReason = ?,
             processedByUserId = ?,
             processedByRole = 'admin',
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
                ? `Администратор отклонил заявку: ${reason}`
                : 'Администратор отклонил заявку на открытие смены.',
            ],
            () => {}
          );
          res.json({ ok: true, requestId, status: 'rejected' });
        }
      );
    }
  );
});

router.get('/shift-plans', authenticateToken, authorizeRole('admin'), (req, res) => {
  const date = String(req.query?.date || getMoscowDate()).trim();
  const search = String(req.query?.search || '').trim().toLowerCase();
  const statusRaw = String(req.query?.status || 'planned').trim().toLowerCase();
  const allowedStatuses = new Set(['planned', 'consumed', 'cancelled', 'all']);
  const status = allowedStatuses.has(statusRaw) ? statusRaw : 'planned';
  const parkIdRaw = parseInt(req.query?.parkId, 10);
  const parkId = Number.isFinite(parkIdRaw) && parkIdRaw > 0 ? parkIdRaw : null;
  const where = ['sp.shiftDate = ?'];
  const params = [date];
  if (parkId) {
    where.push('sp.parkId = ?');
    params.push(parkId);
  }
  if (status !== 'all') {
    where.push('sp.status = ?');
    params.push(status);
  }
  if (search) {
    where.push(`(
      LOWER(COALESCE(u.fullName,'')) LIKE ?
      OR LOWER(COALESCE(u.phone,'')) LIKE ?
      OR LOWER(COALESCE(c.regNumber,'')) LIKE ?
      OR LOWER(COALESCE(p.name,'')) LIKE ?
      OR LOWER(COALESCE(sp.note,'')) LIKE ?
    )`);
    const q = `%${search}%`;
    params.push(q, q, q, q, q);
  }
  db.all(
    `SELECT sp.*,
            p.name as parkName,
            u.fullName as driverName, u.phone as driverPhone,
            c.regNumber as carRegNumber,
            e.waybillNumber as consumedWaybillNumber
     FROM shift_plans sp
     LEFT JOIN parks p ON p.id = sp.parkId
     LEFT JOIN users u ON u.id = sp.driverUserId
     LEFT JOIN cars c ON c.id = sp.carId
     LEFT JOIN epl e ON e.id = sp.consumedByEplId
     WHERE ${where.join(' AND ')}
     ORDER BY
       CASE sp.status WHEN 'planned' THEN 0 WHEN 'consumed' THEN 1 WHEN 'cancelled' THEN 2 ELSE 3 END,
       COALESCE(p.name, '') ASC,
       COALESCE(u.fullName, u.phone, '') ASC,
       sp.createdAt DESC`,
    params,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

router.post('/shift-plans', authenticateToken, authorizeRole('admin'), (req, res) => {
  const parkId = parseInt(req.body?.parkId, 10);
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
  if (!parkId || Number.isNaN(parkId)) return res.status(400).json({ error: 'Некорректный parkId' });
  if (!driverUserId || Number.isNaN(driverUserId)) return res.status(400).json({ error: 'Некорректный driverUserId' });

  db.get(
    `SELECT d.id as driverId, d.userId as driverUserId, d.carId
     FROM drivers d
     WHERE d.userId = ? AND d.parkId = ?`,
    [driverUserId, parkId],
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
          parkId,
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

router.post('/shift-plans/:id/cancel', authenticateToken, authorizeRole('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'Некорректный id' });
  db.run(
    `UPDATE shift_plans
     SET status = 'cancelled', cancelledAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'planned'`,
    [id],
    function (uErr) {
      if (uErr) return res.status(500).json({ error: uErr.message });
      if (!this.changes) return res.status(404).json({ error: 'План не найден или уже обработан' });
      res.json({ ok: true, id, status: 'cancelled' });
    }
  );
});

// Получить все парки с агрегатами: авто, водители, связки, траты реал за день (по умолчанию сегодня; ?date=YYYY-MM-DD для другой даты, ?period=all для всего времени)
router.get('/parks', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { period, date } = req.query;
  let spentRealDateFilter = '';
  if (period !== 'all') {
    const targetDate = date || getMoscowDate();
    spentRealDateFilter = ` AND ${getMoscowDateFilter('bh.createdAt', targetDate)}`;
  }
  ensureParksTable(() => {
  db.all(
    `SELECT p.*,
      (SELECT COUNT(*) FROM cars c WHERE c.parkId = p.id) AS carsCount,
      (SELECT COUNT(*) FROM drivers d WHERE d.parkId = p.id) AS driversCount,
      (SELECT COUNT(*) FROM drivers d WHERE d.parkId = p.id AND d.carId IS NOT NULL) AS bindingsCount,
      (SELECT IFNULL(SUM(ABS(bh.amount)), 0)
       FROM balance_history bh
       JOIN drivers d ON d.userId = bh.userId AND d.parkId = p.id
       WHERE bh.type IN ('expense','waybill_fee') AND (bh.amountType = 'real' OR bh.amountType IS NULL)
       ${spentRealDateFilter}
      ) AS spentReal
     FROM parks p
     ORDER BY p.createdAt DESC`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      const list = (rows || []).map((row) => {
        const r = { ...row };
        r.carsCount = Number(row.carsCount ?? row.carscount ?? 0);
        r.driversCount = Number(row.driversCount ?? row.driverscount ?? 0);
        r.bindingsCount = Number(row.bindingsCount ?? row.bindingscount ?? 0);
        r.spentReal = Number(row.spentReal ?? row.spentreal ?? 0);
        return r;
      });
      res.json(list);
    }
  );
  });
});

// Один парк с теми же агрегатами, что и в списке (без загрузки всех парков)
router.get('/parks/:parkId', authenticateToken, authorizeRole('admin'), (req, res) => {
  const parkId = parseInt(req.params.parkId, 10);
  if (!parkId || Number.isNaN(parkId)) {
    return res.status(400).json({ error: 'Некорректный parkId' });
  }
  const { period, date } = req.query;
  let spentRealDateFilter = '';
  if (period !== 'all') {
    const targetDate = date || getMoscowDate();
    spentRealDateFilter = ` AND ${getMoscowDateFilter('bh.createdAt', targetDate)}`;
  }
  ensureParksTable(() => {
    db.get(
      `SELECT p.*,
      (SELECT COUNT(*) FROM cars c WHERE c.parkId = p.id) AS carsCount,
      (SELECT COUNT(*) FROM drivers d WHERE d.parkId = p.id) AS driversCount,
      (SELECT COUNT(*) FROM drivers d WHERE d.parkId = p.id AND d.carId IS NOT NULL) AS bindingsCount,
      (SELECT IFNULL(SUM(ABS(bh.amount)), 0)
       FROM balance_history bh
       JOIN drivers d ON d.userId = bh.userId AND d.parkId = p.id
       WHERE bh.type IN ('expense','waybill_fee') AND (bh.amountType = 'real' OR bh.amountType IS NULL)
       ${spentRealDateFilter}
      ) AS spentReal
     FROM parks p
     WHERE p.id = ?`,
      [parkId],
      (err, row) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        if (!row) {
          return res.status(404).json({ error: 'Парк не найден' });
        }
        const r = { ...row };
        r.carsCount = Number(row.carsCount ?? row.carscount ?? 0);
        r.driversCount = Number(row.driversCount ?? row.driverscount ?? 0);
        r.bindingsCount = Number(row.bindingsCount ?? row.bindingscount ?? 0);
        r.spentReal = Number(row.spentReal ?? row.spentreal ?? 0);
        res.json(r);
      }
    );
  });
});

// Список ЭПЛ парка с агрегатами и группами для UI
router.get('/parks/:parkId/epl', authenticateToken, authorizeRole('admin'), (req, res) => {
  const parkId = parseInt(req.params.parkId, 10);
  if (!parkId || Number.isNaN(parkId)) {
    return res.status(400).json({ error: 'Некорректный parkId' });
  }
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
      e.errorMessage,
      e.failureCode,
      e.createAttempts,
      e.lastAttemptAt,
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
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

      const list = (rows || []).map((row) => {
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

        return {
          ...row,
          hasFastDoc,
          hasOfficialDoc,
          hasMintransQr,
          uiGroup,
        };
      });

      // Фильтрация по группе (если передана)
      const finalList = group ? list.filter((item) => item.uiGroup === group) : list;
      res.json(finalList);
    }
  );
});

// Глобальный список ЭПЛ по всем паркам (для админа)
router.get('/epl', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { parkId, group, waybillNumber, driverName, regNumber, status } = req.query || {};
  const filters = [];
  const params = [];

  if (parkId) {
    filters.push('e.parkId = ?');
    params.push(parseInt(parkId, 10));
  }
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
  if (status && String(status).trim()) {
    filters.push('e.status = ?');
    params.push(String(status).trim());
  }

  const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  db.all(
    `
    SELECT
      e.id,
      e.waybillNumber,
      e.status as eplStatus,
      e.errorMessage,
      e.failureCode,
      e.createAttempts,
      e.lastAttemptAt,
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
      p.id as parkId,
      p.name as parkName,
      shift_single.status as shiftStatus,
      CASE WHEN e.documentPdf IS NOT NULL AND length(e.documentPdf) > 0 THEN 1 ELSE 0 END as hasFastDoc,
      CASE WHEN e.mintransId IS NOT NULL AND e.mintransId != '' THEN 1 ELSE 0 END as hasOfficialDoc,
      CASE WHEN e.qrCode IS NOT NULL AND e.qrCode != '' THEN 1 ELSE 0 END as hasMintransQr
    FROM epl e
    JOIN parks p ON e.parkId = p.id
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
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
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
          // Расчётное время закрытия смены: 12 часов от documentPdfReceivedAt/approvedAt (данные в БД храним как UTC-строки без таймзоны)
          let expectedCloseAt = null;
          let shiftStart = null;
          if (row.documentPdfReceivedAt || row.approvedAt) {
            const base = row.documentPdfReceivedAt || row.approvedAt;
            // Интерпретируем как UTC, как во всех джобах (parseUtc из epl-expiry-job)
            const baseIso = base.includes('T') ? `${base.replace(' ', 'T').split('.')[0]}Z` : `${base.replace(' ', 'T')}Z`;
            const baseDate = new Date(baseIso);
            if (!Number.isNaN(baseDate.getTime())) {
              shiftStart = baseDate.toISOString().slice(0, 19).replace('T', ' ');
              const closeTs = baseDate.getTime() + 12 * 60 * 60 * 1000;
              expectedCloseAt = new Date(closeTs).toISOString().slice(0, 19).replace('T', ' ');
            }
          }
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
              shiftStart,
              expectedCloseAt,
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

// Закрыть смену по ЭПЛ без списания средств (админ)
router.post('/epl/:id/close-shift', authenticateToken, authorizeRole('admin'), (req, res) => {
  const eplId = parseInt(req.params.id, 10);
  if (!eplId || Number.isNaN(eplId)) {
    return res.status(400).json({ error: 'Некорректный id ЭПЛ' });
  }

  db.get(
    `SELECT e.id, e.status, d.userId
     FROM epl e
     JOIN drivers d ON e.driverId = d.id
     WHERE e.id = ?`,
    [eplId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Путевой лист не найден' });

      const userId = row.userId;
      db.run(
        `UPDATE shifts SET status = 'closed', closedAt = CURRENT_TIMESTAMP 
         WHERE eplId = ? AND status = 'active'`,
        [eplId],
        function (runErr) {
          if (runErr) return res.status(500).json({ error: runErr.message });

          db.run(
            `UPDATE epl SET status = 'failed', errorMessage = 'Отменён администратором' 
             WHERE driverId = (SELECT id FROM drivers WHERE userId = ?) 
             AND status IN (${sqlQuoteList(CANCELABLE_BEFORE_TAXCOM)}) 
             AND (mintransId IS NULL OR mintransId = '')`,
            [userId],
            (cancelErr) => {
              if (cancelErr) console.error('[Admin] Cancel pending EPL on close-shift error:', cancelErr.message);
              db.run(
                `UPDATE epl SET status = 'failed', errorMessage = 'Закрыт администратором' 
                 WHERE id = ? AND status IN (${sqlQuoteList(CLOSE_SHIFT_FAIL_STATUSES)})`,
                [eplId],
                (closeErr) => {
                  if (closeErr) console.error('[Admin] Close specific EPL on close-shift error:', closeErr.message);
                  res.json({ success: true, message: 'Смена закрыта. ЭПЛ помечен как закрытый администратором.' });
                }
              );
            }
          );
        }
      );
    }
  );
});

// Закрыть смену по ЭПЛ со списанием средств (админ)
router.post('/epl/:id/close-shift-with-charge', authenticateToken, authorizeRole('admin'), (req, res) => {
  const eplId = parseInt(req.params.id, 10);
  if (!eplId || Number.isNaN(eplId)) {
    return res.status(400).json({ error: 'Некорректный id ЭПЛ' });
  }
  const { amount, comment } = req.body || {};
  const sum = Number(amount);
  if (!sum || Number.isNaN(sum) || sum <= 0) {
    return res.status(400).json({ error: 'Сумма списания должна быть положительным числом' });
  }

  db.get(
    `SELECT e.id, e.status, e.parkId, d.userId
     FROM epl e
     JOIN drivers d ON e.driverId = d.id
     WHERE e.id = ?`,
    [eplId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Путевой лист не найден' });

      const userId = row.userId;
      const parkId = row.parkId;
      const description = comment && String(comment).trim()
        ? String(comment).trim()
        : 'Списание при закрытии смены администратором';

      deductBalance(
        db,
        userId,
        parkId,
        sum,
        description,
        eplId,
        'expense',
        `close_shift_charge:admin:epl:${eplId}`,
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
                `UPDATE epl SET status = 'failed', errorMessage = 'Отменён администратором (со списанием средств)' 
                 WHERE driverId = (SELECT id FROM drivers WHERE userId = ?) 
                   AND status IN (${sqlQuoteList(CANCELABLE_BEFORE_TAXCOM)}) 
                 AND (mintransId IS NULL OR mintransId = '')`,
                [userId],
                (cancelErr) => {
                  if (cancelErr) console.error('[Admin] Cancel pending EPL on close-shift-with-charge error:', cancelErr.message);
                  db.run(
                    `UPDATE epl SET status = 'failed', errorMessage = 'Закрыт администратором (со списанием средств)' 
                       WHERE id = ? AND status IN (${sqlQuoteList(CLOSE_SHIFT_FAIL_STATUSES)})`,
                    [eplId],
                    (closeErr) => {
                      if (closeErr) console.error('[Admin] Close specific EPL on close-shift-with-charge error:', closeErr.message);
                      res.json({
                        success: true,
                        message: 'Смена закрыта. Средства списаны, ЭПЛ помечен как закрытый администратором.',
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

// Поставить ЭПЛ в очередь на повторное создание в Такском (до получения mintransId)
router.post('/epl/:eplId/requeue-creation', authenticateToken, authorizeRole('admin'), (req, res) => {
  const eplId = parseInt(req.params.eplId, 10);
  if (!eplId || Number.isNaN(eplId)) {
    return res.status(400).json({ error: 'Некорректный eplId' });
  }

  db.get(
    `SELECT id, parkId, driverId, status, mintransId, errorMessage, qrCode, documentQr, eplGuid
     FROM epl
     WHERE id = ?`,
    [eplId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Путевой лист не найден' });

      if (row.mintransId) {
        return res.status(400).json({ error: 'ЭПЛ уже имеет mintransId (создан в Такском), повторное создание невозможно. Используйте повторный запрос QR.' });
      }

      // Разрешаем пересоздание только для «незавершённых» и неуспешных заявок
      const allowedStatuses = ['draft', 'pending_clinic', 'failed'];
      if (!allowedStatuses.includes(row.status)) {
        return res.status(400).json({ error: `Нельзя пересоздать ЭПЛ в статусе ${row.status}. Доступны: ${allowedStatuses.join(', ')}.` });
      }

      db.run(
        `UPDATE epl
         SET status = 'pending_clinic',
             errorMessage = NULL,
             failureCode = NULL,
             createAttempts = 0,
             lastAttemptAt = NULL,
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
              'admin',
              'creation_requeue_requested',
              'Администратор поставил ЭПЛ в очередь на повторное создание в Такском',
            ],
            () => {}
          );

          res.json({ ok: true });
        }
      );
    }
  );
});

// Подменить ИНН водителя (2 случайные цифры) и поставить ЭПЛ в очередь создания заново.
// Кнопка в админке используется, когда после череды попыток не появляется даже Т1.
router.post('/epl/:eplId/mutate-inn', authenticateToken, authorizeRole('admin'), (req, res) => {
  const eplId = parseInt(req.params.eplId, 10);
  if (!eplId || Number.isNaN(eplId)) return res.status(400).json({ error: 'Некорректный eplId' });

  db.get(
    `
      SELECT
        e.id,
        e.parkId,
        e.driverId,
        e.mintransId,
        e.status,
        d.userId as driverUserId,
        u.inn as driverInn
      FROM epl e
      JOIN drivers d ON e.driverId = d.id
      JOIN users u ON d.userId = u.id
      WHERE e.id = ?
    `,
    [eplId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Путевой лист не найден' });

      if (row.mintransId) {
        return res.status(400).json({
          error: 'ЭПЛ уже имеет mintransId (создан в Такском). Повторное создание невозможно (используйте повторный запрос QR).',
        });
      }

      const oldInnRaw = row.driverInn == null ? '' : String(row.driverInn);
      const oldInn = oldInnRaw.trim();
      if (!/^\d+$/.test(oldInn) || oldInn.length < 2) {
        return res.status(400).json({ error: 'ИНН водителя не в формате цифр или слишком короткий, подмену выполнить нельзя.' });
      }

      const len = oldInn.length;
      const positions = new Set();
      while (positions.size < 2 && positions.size < len) positions.add(Math.floor(Math.random() * len));
      const positionsArr = Array.from(positions);

      const digits = oldInn.split('');
      for (const pos of positionsArr) {
        const orig = digits[pos];
        let next = orig;
        for (let i = 0; i < 20; i++) {
          next = String(Math.floor(Math.random() * 10));
          if (next !== orig) break;
        }
        digits[pos] = next;
      }
      let newInn = digits.join('');
      if (newInn === oldInn && positionsArr.length > 0) {
        const p = positionsArr[0];
        digits[p] = String((Number(digits[p]) + 1) % 10);
        newInn = digits.join('');
      }

      if (newInn === oldInn) {
        return res.status(400).json({ error: 'Не удалось подменить ИНН (вероятно, ИНН уже невалидный).' });
      }

      db.serialize(() => {
        db.run(
          `UPDATE users
           SET inn = ?,
               innMutationApplied = 1,
               innMutationOriginalInn = ?,
               innMutationAt = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [newInn, oldInn, row.driverUserId],
          function (updUserErr) {
            if (updUserErr) return res.status(500).json({ error: updUserErr.message });

            // Возвращаем ЭПЛ в очередь создания, чтобы следующий прогон использовал новый ИНН
            db.run(
              `UPDATE epl
               SET status = 'pending_clinic',
                   errorMessage = NULL,
                   failureCode = NULL,
                   createAttempts = 0,
                   lastAttemptAt = NULL,
                   updatedAt = CURRENT_TIMESTAMP
               WHERE id = ?`,
              [eplId],
              function (updEplErr) {
                if (updEplErr) return res.status(500).json({ error: updEplErr.message });

                db.run(
                  `INSERT INTO epl_logs (eplId, driverId, parkId, source, event, message, details)
                   VALUES (?, ?, ?, ?, ?, ?, ?)`,
                  [
                    eplId,
                    row.driverId || null,
                    row.parkId || null,
                    'admin',
                    'inn_mutation_requested',
                    'Подмена ИНН водителя (2 цифры) перед повторным созданием в Такском',
                    JSON.stringify({ oldInn, newInn, positions: positionsArr }),
                  ],
                  () => {}
                );

                return res.json({ ok: true, eplId, oldInn, newInn });
              }
            );
          }
        );
      });
    }
  );
});

// ===== ВЛАДЕЛЬЦЫ/ОРГАНИЗАЦИИ ВНУТРИ ПАРКА (park_owners) =====

// Список всех владельцев по всем паркам (для выбора «скопировать в другой парк»)
router.get('/owners/all', authenticateToken, authorizeRole('admin'), (req, res) => {
  db.all(
    `SELECT po.*, p.name as parkName
     FROM park_owners po
     LEFT JOIN parks p ON p.id = po.parkId
     ORDER BY po.name ASC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

// Список владельцев парка
router.get('/parks/:parkId/owners', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { parkId } = req.params;
  db.all(
    `SELECT * FROM park_owners WHERE parkId = ? ORDER BY isDefault DESC, createdAt DESC`,
    [parkId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

// Детали конкретного ЭПЛ (в т.ч. titulStatus Т1–Т4)
router.get('/epl/:eplId', authenticateToken, authorizeRole('admin'), (req, res) => {
  const eplId = parseInt(req.params.eplId, 10);
  if (!eplId || Number.isNaN(eplId)) {
    return res.status(400).json({ error: 'Некорректный eplId' });
  }
  db.get(
    `
    SELECT
      e.*,
      d.id as driverId,
      u.fullName as driverName,
      c.regNumber,
      c.brand,
      c.model
    FROM epl e
    LEFT JOIN drivers d ON e.driverId = d.id
    LEFT JOIN users u ON d.userId = u.id
    LEFT JOIN cars c ON e.carId = c.id AND c.parkId = e.parkId
    WHERE e.id = ?
    `,
    [eplId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'EPL not found' });
      db.all(
        `SELECT titleCode, status FROM epl_titles WHERE eplId = ? AND titleCode IN ('t1','t2','t3','t4')`,
        [eplId],
        (tErr, titlesRows) => {
          const titulStatus = { t1: null, t2: null, t3: null, t4: null };
          (titlesRows || []).forEach((t) => {
            const key = 't' + t.titleCode.charAt(1);
            titulStatus[key] = t.status === 'signed' ? 'signed' : t.status || null;
          });
          res.json({ ...row, titulStatus });
        }
      );
    }
  );
});

// Логи по ЭПЛ
router.get('/epl/:eplId/logs', authenticateToken, authorizeRole('admin'), (req, res) => {
  const eplId = parseInt(req.params.eplId, 10);
  if (!eplId || Number.isNaN(eplId)) {
    return res.status(400).json({ error: 'Некорректный eplId' });
  }
  db.all(
    `
    SELECT *
    FROM epl_logs
    WHERE eplId = ?
    ORDER BY createdAt DESC, id DESC
    `,
    [eplId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

// Пометить ЭПЛ для повторного запроса QR Минтранса
router.post('/epl/:eplId/requeue-qr', authenticateToken, authorizeRole('admin'), (req, res) => {
  const eplId = parseInt(req.params.eplId, 10);
  if (!eplId || Number.isNaN(eplId)) {
    return res.status(400).json({ error: 'Некорректный eplId' });
  }
  db.get(
    `SELECT id, parkId, driverId, mintransId, qrCode FROM epl WHERE id = ?`,
    [eplId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
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
          // Логируем событие
          db.run(
            `INSERT INTO epl_logs (eplId, driverId, parkId, source, event, message)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [eplId, row.driverId, row.parkId, 'admin', 'qr_refetch_requested', 'Повторный запрос QR Минтранса поставлен в очередь'],
            () => {}
          );
          res.json({ ok: true });
        }
      );
    }
  );
});

// Скачать наш PDF-документ ЭПЛ (fast PDF) для админа
router.get('/epl/:id/document-fast', authenticateToken, authorizeRole('admin'), (req, res) => {
  const eplId = parseInt(req.params.id, 10);
  if (!eplId || Number.isNaN(eplId)) {
    return res.status(400).json({ error: 'Некорректный id ЭПЛ' });
  }
  db.get(
    'SELECT waybillNumber, documentPdf FROM epl WHERE id = ?',
    [eplId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
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

// Скачать Минтранс PDF по mintransId (админ)
router.get('/epl/:id/document-mintrans', authenticateToken, authorizeRole('admin'), async (req, res) => {
  const eplId = parseInt(req.params.id, 10);
  if (!eplId || Number.isNaN(eplId)) {
    return res.status(400).json({ error: 'Некорректный id ЭПЛ' });
  }
  db.get(
    'SELECT waybillNumber, mintransId FROM epl WHERE id = ?',
    [eplId],
    async (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
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
        console.error('[Admin] getDocumentPdf error:', e.message);
        return res.status(502).json({ error: 'Не удалось получить Минтранс PDF по API Такском' });
      }
    }
  );
});

// Получить QR Минтранса (documentQr) для админа
router.get('/epl/:id/qr-mintrans', authenticateToken, authorizeRole('admin'), (req, res) => {
  const eplId = parseInt(req.params.id, 10);
  if (!eplId || Number.isNaN(eplId)) {
    return res.status(400).json({ error: 'Некорректный id ЭПЛ' });
  }
  db.get(
    'SELECT documentQr FROM epl WHERE id = ?',
    [eplId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row || !row.documentQr) {
        return res.status(404).json({ error: 'QR Минтранса ещё не сгенерирован' });
      }
      // documentQr уже хранится как data:image/...; фронт может отрисовать <img src={qr} />
      res.json({ qr: row.documentQr });
    }
  );
});

// Создать владельца/арендодателя для парка
router.post('/parks/:parkId/owners', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { parkId } = req.params;
  const {
    type,
    role,
    name,
    inn,
    ogrn,
    ogrnip,
    kpp,
    phone,
    email,
    postalIndex,
    regionCode,
    district,
    city,
    locality,
    street,
    house,
    housing,
    flat,
    isDefault
  } = req.body || {};

  if (!type || !['legal', 'individual'].includes(type)) {
    return res.status(400).json({ error: 'type должен быть legal или individual' });
  }
  if (!role || !['С', 'А'].includes(role)) {
    return res.status(400).json({ error: 'role должен быть С или А' });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Укажите наименование организации / ФИО владельца' });
  }

  db.get('SELECT id FROM parks WHERE id = ?', [parkId], (checkErr, park) => {
    if (checkErr) return res.status(500).json({ error: checkErr.message });
    if (!park) return res.status(404).json({ error: 'Park not found' });

    const makeDefault = isDefault ? 1 : 0;
    const insertOwner = () => {
      db.run(
        `INSERT INTO park_owners (
          parkId, type, role, name,
          inn, ogrn, ogrnip, kpp,
          phone, email,
          postalIndex, regionCode, district, city, locality, street, house, housing, flat,
          isDefault
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          parkId, type, role, name.trim(),
          inn || null, ogrn || null, ogrnip || null, kpp || null,
          phone || null, email || null,
          postalIndex || null, regionCode || null, district || null, city || null, locality || null,
          street || null, house || null, housing || null, flat || null,
          makeDefault
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          const ownerId = this.lastID;
          db.get('SELECT * FROM park_owners WHERE id = ?', [ownerId], (gerr, row) => {
            if (gerr) return res.status(500).json({ error: gerr.message });
            res.status(201).json(row);
          });
        }
      );
    };

    if (makeDefault) {
      db.run(
        'UPDATE park_owners SET isDefault = 0 WHERE parkId = ?',
        [parkId],
        (updErr) => {
          if (updErr) console.warn('[Admin] Failed to reset isDefault for park_owners:', updErr.message);
          insertOwner();
        }
      );
    } else {
      insertOwner();
    }
  });
});

// Обновить владельца
router.put('/parks/:parkId/owners/:ownerId', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { parkId, ownerId } = req.params;
  const {
    type,
    role,
    name,
    inn,
    ogrn,
    ogrnip,
    kpp,
    phone,
    email,
    postalIndex,
    regionCode,
    district,
    city,
    locality,
    street,
    house,
    housing,
    flat,
    isDefault
  } = req.body || {};

  db.get('SELECT * FROM park_owners WHERE id = ? AND parkId = ?', [ownerId, parkId], (err, owner) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!owner) return res.status(404).json({ error: 'Owner not found' });

    const updates = [];
    const values = [];

    if (type !== undefined) {
      if (!['legal', 'individual'].includes(type)) {
        return res.status(400).json({ error: 'type должен быть legal или individual' });
      }
      updates.push('type = ?');
      values.push(type);
    }
    if (role !== undefined) {
      if (!['С', 'А'].includes(role)) {
        return res.status(400).json({ error: 'role должен быть С или А' });
      }
      updates.push('role = ?');
      values.push(role);
    }
    if (name !== undefined) {
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Укажите наименование организации / ФИО владельца' });
      }
      updates.push('name = ?');
      values.push(name.trim());
    }
    if (inn !== undefined) { updates.push('inn = ?'); values.push(inn || null); }
    if (ogrn !== undefined) { updates.push('ogrn = ?'); values.push(ogrn || null); }
    if (ogrnip !== undefined) { updates.push('ogrnip = ?'); values.push(ogrnip || null); }
    if (kpp !== undefined) { updates.push('kpp = ?'); values.push(kpp || null); }
    if (phone !== undefined) { updates.push('phone = ?'); values.push(phone || null); }
    if (email !== undefined) { updates.push('email = ?'); values.push(email || null); }
    if (postalIndex !== undefined) { updates.push('postalIndex = ?'); values.push(postalIndex || null); }
    if (regionCode !== undefined) { updates.push('regionCode = ?'); values.push(regionCode || null); }
    if (district !== undefined) { updates.push('district = ?'); values.push(district || null); }
    if (city !== undefined) { updates.push('city = ?'); values.push(city || null); }
    if (locality !== undefined) { updates.push('locality = ?'); values.push(locality || null); }
    if (street !== undefined) { updates.push('street = ?'); values.push(street || null); }
    if (house !== undefined) { updates.push('house = ?'); values.push(house || null); }
    if (housing !== undefined) { updates.push('housing = ?'); values.push(housing || null); }
    if (flat !== undefined) { updates.push('flat = ?'); values.push(flat || null); }

    let setDefault = null;
    if (isDefault !== undefined) {
      setDefault = isDefault ? 1 : 0;
      updates.push('isDefault = ?');
      values.push(setDefault);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Нет данных для обновления' });
    }

    const applyUpdate = () => {
      values.push(ownerId, parkId);
      db.run(
        `UPDATE park_owners SET ${updates.join(', ')}, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND parkId = ?`,
        values,
        function (uerr) {
          if (uerr) return res.status(500).json({ error: uerr.message });
          if (this.changes === 0) return res.status(404).json({ error: 'Owner not found' });
          db.get('SELECT * FROM park_owners WHERE id = ?', [ownerId], (gerr, row) => {
            if (gerr) return res.status(500).json({ error: gerr.message });
            res.json(row);
          });
        }
      );
    };

    if (setDefault === 1) {
      db.run('UPDATE park_owners SET isDefault = 0 WHERE parkId = ?', [parkId], (updErr) => {
        if (updErr) console.warn('[Admin] Failed to reset isDefault for park_owners (update):', updErr.message);
        applyUpdate();
      });
    } else {
      applyUpdate();
    }
  });
});

// Удалить владельца (если не привязан к авто)
router.delete('/parks/:parkId/owners/:ownerId', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { parkId, ownerId } = req.params;
  db.get('SELECT COUNT(*) as cnt FROM cars WHERE ownerId = ? AND parkId = ?', [ownerId, parkId], (cntErr, row) => {
    if (cntErr) return res.status(500).json({ error: cntErr.message });
    if (row && row.cnt > 0) {
      return res.status(400).json({ error: 'Нельзя удалить владельца: к нему привязаны автомобили' });
    }
    db.run('DELETE FROM park_owners WHERE id = ? AND parkId = ?', [ownerId, parkId], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Owner not found' });
      res.json({ success: true });
    });
  });
});

// Привязать парк к автопарку Такском (только существующие из GET /info; API не поддерживает создание парков).
// Тело: { takskornId } — id автопарка из списка GET /admin/takskom/carparks.
router.post('/parks/:id/sync', authenticateToken, authorizeRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { takskornId } = req.body || {};

  try {
    const park = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM parks WHERE id = ?', [id], (err, row) => (err ? reject(err) : resolve(row)));
    });
    if (!park) return res.status(404).json({ error: 'Park not found' });

    if (!takskornId || String(takskornId).trim() === '') {
      return res.status(400).json({
        error: 'API Такском не поддерживает создание парков. Укажите takskornId — выберите автопарк из списка (настройки парка или GET /admin/takskom/carparks).'
      });
    }

    const info = await TakskornAPI.getInfo();
    const list = info.carParks || [];
    const valid = list.some(p => String(p.id) === String(takskornId));
    if (!valid) {
      return res.status(400).json({ error: 'Указанный автопарк не найден в Такском. Выберите из списка.' });
    }

    await new Promise((resolve, reject) => {
      db.run('UPDATE parks SET takskornId = ?, syncedWithTakskom = 1, lastSyncAt = CURRENT_TIMESTAMP WHERE id = ?', [String(takskornId), id], function (uerr) {
        if (uerr) return reject(uerr);
        if (this.changes === 0) return reject(new Error('Park not found'));
        resolve();
      });
    });

    const updated = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM parks WHERE id = ?', [id], (gerr, row) => (gerr ? reject(gerr) : resolve(row)));
    });
    return res.json({ success: true, takskomId: String(takskornId), park: updated });
  } catch (e) {
    console.error('[Admin] /parks/:id/sync error:', e.message || e);
    if (e.message === 'Park not found') return res.status(404).json({ error: e.message });
    return res.status(500).json({ error: e.message || 'Unexpected' });
  }
});

// Создать парк (только название). Реквизиты и данные для Такском — в настройках парка.
router.post('/parks', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Укажите название парка' });
  }
  db.run(
    `INSERT INTO parks (name) VALUES (?)`,
    [name.trim()],
    function (err) {
      if (err) {
        console.error('[Admin] Park creation error:', err.message);
        return res.status(500).json({ error: err.message });
      }
      const parkId = this.lastID;
      db.get('SELECT * FROM parks WHERE id = ?', [parkId], (gerr, row) => {
        if (gerr) return res.status(500).json({ error: gerr.message });
        res.status(201).json({
          ...row,
          message: 'Парк создан. Заполните реквизиты и данные для Такском в настройках парка.'
        });
      });
    }
  );
});

// ===== ТАКСКОМ ПРИВЯЗКИ (МНОЖЕСТВЕННЫЕ) =====

// Получить список привязок Такском для парка
router.get('/parks/:parkId/taxcom-links', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { parkId } = req.params;
  db.all(
    `SELECT * FROM park_taxcom_links WHERE parkId = ? ORDER BY isPrimary DESC, id ASC`,
    [parkId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

// Добавить привязку Такском к парку
router.post('/parks/:parkId/taxcom-links', authenticateToken, authorizeRole('admin'), async (req, res) => {
  const { parkId } = req.params;
  const { taxcomId, taxcomName, force } = req.body;

  if (!taxcomId || !String(taxcomId).trim()) {
    return res.status(400).json({ error: 'Укажите taxcomId' });
  }
  const tId = String(taxcomId).trim();

  // Проверяем что уже не привязан к этому парку
  const existing = await new Promise(r => db.get(
    `SELECT id FROM park_taxcom_links WHERE parkId = ? AND taxcomId = ?`, [parkId, tId], (e, row) => r(row)
  ));
  if (existing) return res.status(400).json({ error: 'Этот Такском-парк уже привязан к этому парку' });

  // Проверяем, используется ли этот taxcomId другим парком
  const usedBy = await new Promise(r => db.all(
    `SELECT ptl.parkId, p.name as parkName FROM park_taxcom_links ptl 
     JOIN parks p ON p.id = ptl.parkId 
     WHERE ptl.taxcomId = ? AND ptl.parkId != ?`,
    [tId, parkId], (e, rows) => r(rows || [])
  ));
  if (usedBy.length > 0 && !force) {
    return res.status(409).json({
      conflict: true,
      usedBy: usedBy.map(r => ({ parkId: r.parkId, parkName: r.parkName })),
      message: `Такском-парк уже привязан к: ${usedBy.map(r => r.parkName).join(', ')}. Подтвердите для привязки к нескольким паркам.`
    });
  }

  // Определяем, это первая привязка (станет основной)?
  const count = await new Promise(r => db.get(
    `SELECT COUNT(*) as cnt FROM park_taxcom_links WHERE parkId = ?`, [parkId], (e, row) => r(row?.cnt || 0)
  ));
  const isPrimary = count === 0 ? 1 : 0;

  db.run(
    `INSERT INTO park_taxcom_links (parkId, taxcomId, taxcomName, isPrimary) VALUES (?, ?, ?, ?)`,
    [parkId, tId, taxcomName || null, isPrimary],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      // Если стала основной — обновляем parks.takskornId
      if (isPrimary) {
        db.run(`UPDATE parks SET takskornId = ?, syncedWithTakskom = 1 WHERE id = ?`, [tId, parkId]);
      }
      res.json({ id: this.lastID, parkId: parseInt(parkId), taxcomId: tId, taxcomName: taxcomName || null, isPrimary });
    }
  );
});

// Удалить привязку Такском
router.delete('/parks/:parkId/taxcom-links/:linkId', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { parkId, linkId } = req.params;
  db.get(`SELECT * FROM park_taxcom_links WHERE id = ? AND parkId = ?`, [linkId, parkId], (err, link) => {
    if (err || !link) return res.status(404).json({ error: 'Привязка не найдена' });
    db.run(`DELETE FROM park_taxcom_links WHERE id = ?`, [linkId], function (err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      // Если удалили основную — назначить следующую основной (или обнулить parks.takskornId)
      if (link.isPrimary) {
        db.get(`SELECT * FROM park_taxcom_links WHERE parkId = ? ORDER BY id ASC LIMIT 1`, [parkId], (e3, next) => {
          if (next) {
            db.run(`UPDATE park_taxcom_links SET isPrimary = 1 WHERE id = ?`, [next.id]);
            db.run(`UPDATE parks SET takskornId = ?, syncedWithTakskom = 1 WHERE id = ?`, [next.taxcomId, parkId]);
          } else {
            db.run(`UPDATE parks SET takskornId = NULL, syncedWithTakskom = 0 WHERE id = ?`, [parkId]);
          }
        });
      }
      res.json({ success: true });
    });
  });
});

// Установить привязку как основную (для ЭПЛ)
router.put('/parks/:parkId/taxcom-links/:linkId/set-primary', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { parkId, linkId } = req.params;
  db.get(`SELECT * FROM park_taxcom_links WHERE id = ? AND parkId = ?`, [linkId, parkId], (err, link) => {
    if (err || !link) return res.status(404).json({ error: 'Привязка не найдена' });
    db.serialize(() => {
      db.run(`UPDATE park_taxcom_links SET isPrimary = 0 WHERE parkId = ?`, [parkId]);
      db.run(`UPDATE park_taxcom_links SET isPrimary = 1 WHERE id = ?`, [linkId]);
      db.run(`UPDATE parks SET takskornId = ?, syncedWithTakskom = 1 WHERE id = ?`, [link.taxcomId, parkId],
        (e) => {
          if (e) return res.status(500).json({ error: e.message });
          res.json({ success: true, primaryTaxcomId: link.taxcomId });
        }
      );
    });
  });
});

// Получить настройки парка (ВАЖНО: должен быть ПЕРЕД /parks/:id)
router.get('/parks/:parkId/settings', authenticateToken, authorizeRole('admin'), async (req, res) => {
  const { parkId } = req.params;
  console.log(`[Admin] GET /parks/${parkId}/settings`);
  await new Promise((r) => ensureParksTable(r));

  // Используем Promise для работы с async/await
  const getParkSettings = () => {
    return new Promise((resolve, reject) => {
      db.get(`SELECT eplCreationMode, eplPrintMode, eplAccessMode, balanceDeductionOrder, ogrn, inn, kpp, regionCode, isActive,
        name, address, postalIndex, region, city, street, house, phone, email, district, locality, housing, flat,
        takskornId, syncedWithTakskom, broadcastRepliesRouting, freightAddressEntryMode,
        freightDefaultOriginAddress, freightDefaultLoadAddress
        FROM parks WHERE id = ?`, [parkId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  };

  const getWaybillRates = () => {
    return new Promise((resolve, reject) => {
      db.get(`SELECT eplCreationFee, autoCloseFee FROM waybill_rates WHERE parkId = ? AND isActive = 1 ORDER BY id DESC LIMIT 1`, [parkId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  };

  const getGameSettings = () => {
    return new Promise((resolve, reject) => {
      db.get(`SELECT gameEnabled, leaderboardDefault, rewardsEnabled, gameShopConfig FROM park_game_settings WHERE parkId = ?`, [parkId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  };

  const getGameRewards = () => {
    return new Promise((resolve, reject) => {
      db.all(`SELECT position, rewardType, freeEplCount, discountPercent, discountEplCount FROM park_game_rewards WHERE parkId = ? ORDER BY position`, [parkId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  };

  const getPhotoControlSettings = () => {
    return new Promise((resolve, reject) => {
      const parkIdNum = parseInt(parkId, 10);
      if (isNaN(parkIdNum)) return resolve(null);
      db.get(`SELECT enabled, price, validDays, notifyHoursBefore FROM park_photo_control_settings WHERE parkId = ?`, [parkIdNum], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  };

  try {
    const [row, rates, gameRow, gameRewards, fcRow] = await Promise.all([getParkSettings(), getWaybillRates(), getGameSettings(), getGameRewards(), getPhotoControlSettings()]);
    
    if (!row) {
      console.warn(`[Admin] Park ${parkId} not found`);
      return res.status(404).json({ error: 'Park not found' });
    }
    
    console.log(`[Admin] Park ${parkId} settings loaded:`, row);
    
    const eplPrice = (rates && rates.eplCreationFee != null && Number(rates.eplCreationFee) > 0) ? Number(rates.eplCreationFee) : 25;
    const autoClosePrice = (rates && rates.autoCloseFee != null && Number(rates.autoCloseFee) >= 0) ? Number(rates.autoCloseFee) : 10;
    
    res.json({
      eplCreationMode: row.eplCreationMode || 'takskom_api',
      eplPrintMode: row.eplPrintMode || 'our_then_taxcom',
      eplAccessMode: row.eplAccessMode === 'driver_only'
        ? 'driver_only'
        : row.eplAccessMode === 'manager_director_only'
          ? 'manager_director_only'
          : 'all',
      balanceDeductionOrder: row.balanceDeductionOrder || 'real_first',
      ogrn: row.ogrn || null,
      inn: row.inn || null,
      kpp: row.kpp || null,
      regionCode: row.regionCode || null,
      isActive: row.isActive || 0,
      name: row.name || null,
      address: row.address || null,
      postalIndex: row.postalIndex || null,
      region: row.region || null,
      city: row.city || null,
      street: row.street || null,
      house: row.house || null,
      phone: row.phone || null,
      email: row.email || null,
      district: row.district || null,
      locality: row.locality || null,
      housing: row.housing || null,
      flat: row.flat || null,
      takskornId: row.takskornId != null ? String(row.takskornId) : null,
      syncedWithTakskom: row.syncedWithTakskom || 0,
      eplPrice,
      autoClosePrice,
      gameEnabled: gameRow?.gameEnabled ?? 0,
      leaderboardDefault: gameRow?.leaderboardDefault ?? 'day',
      rewardsEnabled: gameRow?.rewardsEnabled ?? 0,
      gameShopConfig: gameRow?.gameShopConfig ?? null,
      gameRewards: (gameRewards || []).map(r => ({
        position: r.position,
        rewardType: r.rewardType,
        freeEplCount: r.freeEplCount ?? 0,
        discountPercent: r.discountPercent ?? 0,
        discountEplCount: r.discountEplCount ?? 0
      })),
      photoControlEnabled: fcRow ? (fcRow.enabled === 1 || fcRow.enabled === '1') : false,
      photoControlPrice: (fcRow && fcRow.price != null) ? Number(fcRow.price) : 150,
      photoControlValidDays: (fcRow && fcRow.validDays != null) ? Number(fcRow.validDays) : 10,
      photoControlNotifyHoursBefore: (fcRow && fcRow.notifyHoursBefore != null) ? Number(fcRow.notifyHoursBefore) : 24,
      broadcastRepliesRouting: row.broadcastRepliesRouting || 'park',
      freightAddressEntryMode: row.freightAddressEntryMode === 'driver' ? 'driver' : 'manager',
      freightDefaultOriginAddress: row.freightDefaultOriginAddress || null,
      freightDefaultLoadAddress: row.freightDefaultLoadAddress || null
    });
  } catch (err) {
    console.error('[Admin] Error loading park settings:', err);
    res.status(500).json({ error: err.message });
  }
});

// Обновить настройки парка (ВАЖНО: должен быть ПЕРЕД /parks/:id)
// API Такском не поддерживает создание парков — только привязка к существующему автопарку из GET /info (carParks).
router.put('/parks/:parkId/settings', authenticateToken, authorizeRole('admin'), async (req, res) => {
  const { parkId } = req.params;
  const {
    eplCreationMode, eplPrintMode, eplAccessMode, balanceDeductionOrder, ogrn, inn, kpp, regionCode, isActive,
    name, address, postalIndex, region, city, street, house, phone, email, district, locality, housing, flat,
    takskornId, eplPrice, autoClosePrice,
    gameEnabled, leaderboardDefault, rewardsEnabled, gameRewards, gameShopConfig,
    photoControlEnabled, photoControlPrice, photoControlValidDays, photoControlNotifyHoursBefore,
    broadcastRepliesRouting,
    freightAddressEntryMode,
    freightDefaultOriginAddress,
    freightDefaultLoadAddress
  } = req.body;
  console.log(`[Admin] PUT /parks/${parkId}/settings`, { eplCreationMode, eplAccessMode, balanceDeductionOrder, takskornId, eplPrice, autoClosePrice, gameEnabled, photoControlEnabled });

  // takskom_api = создание ЭПЛ через наш бэкенд (не внешний API)
  if (eplCreationMode && eplCreationMode !== 'takskom_api' && eplCreationMode !== 'clinic_api') {
    return res.status(400).json({ error: 'eplCreationMode должен быть takskom_api или clinic_api' });
  }

  if (balanceDeductionOrder && balanceDeductionOrder !== 'real_first' && balanceDeductionOrder !== 'unreal_first') {
    return res.status(400).json({ error: 'balanceDeductionOrder должен быть real_first или unreal_first' });
  }

  const VALID_PRINT_MODES = ['our_only', 'taxcom_only', 'our_then_taxcom'];
  if (eplPrintMode !== undefined && eplPrintMode !== null && eplPrintMode !== '' && !VALID_PRINT_MODES.includes(eplPrintMode)) {
    return res.status(400).json({ error: 'eplPrintMode должен быть: our_only, taxcom_only или our_then_taxcom' });
  }
  const VALID_EPL_ACCESS_MODES = ['all', 'driver_only', 'manager_director_only'];
  if (eplAccessMode !== undefined && eplAccessMode !== null && eplAccessMode !== '' && !VALID_EPL_ACCESS_MODES.includes(eplAccessMode)) {
    return res.status(400).json({ error: 'eplAccessMode должен быть: all, driver_only или manager_director_only' });
  }

  if (broadcastRepliesRouting != null && broadcastRepliesRouting !== '' && broadcastRepliesRouting !== 'park' && broadcastRepliesRouting !== 'sender') {
    return res.status(400).json({ error: 'broadcastRepliesRouting должен быть park или sender' });
  }

  if (freightAddressEntryMode != null && freightAddressEntryMode !== '' && freightAddressEntryMode !== 'manager' && freightAddressEntryMode !== 'driver') {
    return res.status(400).json({ error: 'freightAddressEntryMode должен быть manager или driver' });
  }

  // Валидация takskornId: проверяем существование в Такском, но не блокируем если API недоступен
  if (takskornId !== undefined && takskornId !== null && String(takskornId).trim() !== '') {
    try {
      const info = await TakskornAPI.getInfo();
      const list = info.carParks || [];
      const valid = list.some(p => String(p.id) === String(takskornId));
      if (!valid) {
        return res.status(400).json({ error: 'Указанный автопарк не найден в Такском. Выберите из списка автопарков.' });
      }
    } catch (e) {
      // Если Такском API недоступен — предупреждаем, но не блокируем сохранение
      console.warn('[Admin] Takskom API недоступен при валидации takskornId:', e.message);
    }
  }

  // Реквизиты организации теперь хранятся в park_owners (привязаны к авто), а не в parks.
  // Активировать парк можно свободно — реквизиты проверяются на уровне владельцев авто.
  const parkIdNum = parseInt(parkId, 10);
  if (isNaN(parkIdNum)) {
    return res.status(400).json({ error: 'Invalid park id' });
  }
  if (isActive === true || isActive === 1 || isActive === '1') {
    const activationError = await validateParkActivationData(parkIdNum);
    if (activationError) return res.status(400).json({ error: activationError });
  }

  // FC (фотоконтроль) значения нужны и для сохранения, и для ответа.
  // Раньше они были объявлены внутри runSave(), из-за чего при формировании ответа падали с ReferenceError.
  let fcEnabled = 0;
  let fcPrice = 150;
  let fcDays = 10;
  let fcNotify = 24;

  ensureParksTable(() => {
    ensureParkExists(parkIdNum, name, { eplCreationMode, balanceDeductionOrder }, (err) => {
      if (err) {
        console.error('[Admin] ensure park row:', err.message);
        return res.status(500).json({ error: 'Не удалось сохранить настройки парка: ' + err.message });
      }
      runSave();
    });

    function runSave() {
      const runAfterPhotoControl = () => performUpdate();
      fcEnabled = (photoControlEnabled === true || photoControlEnabled === 1 || photoControlEnabled === '1' || String(photoControlEnabled).toLowerCase() === 'true') ? 1 : 0;
      fcPrice = (photoControlPrice != null && !isNaN(Number(photoControlPrice))) ? Math.max(0, Number(photoControlPrice)) : 150;
      fcDays = (photoControlValidDays != null && !isNaN(Number(photoControlValidDays))) ? Math.max(1, Number(photoControlValidDays)) : 10;
      fcNotify = (photoControlNotifyHoursBefore != null && !isNaN(Number(photoControlNotifyHoursBefore))) ? Math.max(0, Number(photoControlNotifyHoursBefore)) : 24;
      console.log('[Admin] Saving FC settings:', { parkId: parkIdNum, photoControlEnabled: req.body.photoControlEnabled, fcEnabled, fcPrice, fcDays, fcNotify });
      db.run(
        `INSERT OR REPLACE INTO park_photo_control_settings (parkId, enabled, price, validDays, notifyHoursBefore, updatedAt)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
        [parkIdNum, fcEnabled, fcPrice, fcDays, fcNotify],
        (err) => {
          if (err) {
            console.error('[Admin] park settings save error:', err.message);
            return res.status(500).json({ error: 'Не удалось сохранить настройки парка: ' + err.message });
          }
          console.log('[Admin] FC settings saved OK for parkId', parkIdNum);
          runAfterPhotoControl();
        }
      );
    }
  });

  function performUpdate() {
    const updates = [];
    const values = [];
    
    if (eplCreationMode !== undefined) {
      updates.push('eplCreationMode = ?');
      values.push(eplCreationMode || 'takskom_api');
    }

    if (eplPrintMode !== undefined) {
      updates.push('eplPrintMode = ?');
      values.push(eplPrintMode || 'our_then_taxcom');
    }

    if (eplAccessMode !== undefined) {
      updates.push('eplAccessMode = ?');
      values.push(
        eplAccessMode === 'driver_only'
          ? 'driver_only'
          : eplAccessMode === 'manager_director_only'
            ? 'manager_director_only'
            : 'all'
      );
    }
    
    if (balanceDeductionOrder !== undefined) {
      updates.push('balanceDeductionOrder = ?');
      values.push(balanceDeductionOrder || 'real_first');
    }

    if (broadcastRepliesRouting !== undefined) {
      updates.push('broadcastRepliesRouting = ?');
      values.push(broadcastRepliesRouting || 'park');
    }

    if (freightAddressEntryMode !== undefined) {
      updates.push('freightAddressEntryMode = ?');
      values.push(freightAddressEntryMode === 'driver' ? 'driver' : 'manager');
    }

    if (freightDefaultOriginAddress !== undefined) {
      updates.push('freightDefaultOriginAddress = ?');
      values.push(freightDefaultOriginAddress != null && String(freightDefaultOriginAddress).trim() !== '' ? String(freightDefaultOriginAddress).trim() : null);
    }
    if (freightDefaultLoadAddress !== undefined) {
      updates.push('freightDefaultLoadAddress = ?');
      values.push(freightDefaultLoadAddress != null && String(freightDefaultLoadAddress).trim() !== '' ? String(freightDefaultLoadAddress).trim() : null);
    }
    
    if (ogrn !== undefined) {
      updates.push('ogrn = ?');
      values.push(ogrn || null);
    }
    
    if (inn !== undefined) {
      updates.push('inn = ?');
      values.push(inn || null);
    }
    
    if (kpp !== undefined) {
      updates.push('kpp = ?');
      values.push(kpp || null);
    }
    
    if (regionCode !== undefined) {
      updates.push('regionCode = ?');
      values.push(regionCode || null);
    }
    
    if (isActive !== undefined) {
      updates.push('isActive = ?');
      values.push(isActive ? 1 : 0);
    }
    if (name !== undefined) { updates.push('name = ?'); values.push(name || null); }
    if (address !== undefined) { updates.push('address = ?'); values.push(address || null); }
    if (postalIndex !== undefined) { updates.push('postalIndex = ?'); values.push(postalIndex || null); }
    if (region !== undefined) { updates.push('region = ?'); values.push(region || null); }
    if (city !== undefined) { updates.push('city = ?'); values.push(city || null); }
    if (street !== undefined) { updates.push('street = ?'); values.push(street || null); }
    if (house !== undefined) { updates.push('house = ?'); values.push(house || null); }
    if (phone !== undefined) { updates.push('phone = ?'); values.push(phone || null); }
    if (email !== undefined) { updates.push('email = ?'); values.push(email || null); }
    if (district !== undefined) { updates.push('district = ?'); values.push(district || null); }
    if (locality !== undefined) { updates.push('locality = ?'); values.push(locality || null); }
    if (housing !== undefined) { updates.push('housing = ?'); values.push(housing || null); }
    if (flat !== undefined) { updates.push('flat = ?'); values.push(flat || null); }
    if (takskornId !== undefined) {
      updates.push('takskornId = ?');
      values.push(takskornId === null || takskornId === '' ? null : String(takskornId));
      updates.push('syncedWithTakskom = ?');
      values.push(takskornId && String(takskornId).trim() !== '' ? 1 : 0);
    }

    const sendSuccessResponse = (eplFinal, autoCloseFinal) => {
      const addGameToPayload = (payload, done) => {
        payload.gameRewards = [];
        // В ответ PUT всегда подставляем только что сохранённые значения ФК (из замыкания), а не из БД
        payload.photoControlEnabled = (fcEnabled === 1);
        payload.photoControlPrice = fcPrice;
        payload.photoControlValidDays = fcDays;
        payload.photoControlNotifyHoursBefore = fcNotify;
        db.get('SELECT gameEnabled, leaderboardDefault, rewardsEnabled, gameShopConfig FROM park_game_settings WHERE parkId = ?', [parkId], (gerr, grow) => {
          if (gerr) return done(payload);
          payload.gameEnabled = grow?.gameEnabled ?? 0;
          payload.leaderboardDefault = grow?.leaderboardDefault ?? 'day';
          payload.rewardsEnabled = grow?.rewardsEnabled ?? 0;
          payload.gameShopConfig = grow?.gameShopConfig ?? null;
          db.all('SELECT position, rewardType, freeEplCount, discountPercent, discountEplCount FROM park_game_rewards WHERE parkId = ? ORDER BY position', [parkId], (rerr, rewards) => {
            if (!rerr) payload.gameRewards = (rewards || []).map(r => ({ position: r.position, rewardType: r.rewardType, freeEplCount: r.freeEplCount ?? 0, discountPercent: r.discountPercent ?? 0, discountEplCount: r.discountEplCount ?? 0 }));
            done(payload);
          });
        });
      };
      db.get(`SELECT eplCreationMode, eplPrintMode, eplAccessMode, balanceDeductionOrder, ogrn, inn, kpp, regionCode, isActive,
        name, address, postalIndex, region, city, street, house, phone, email, district, locality, housing, flat,
        takskornId, syncedWithTakskom, freightAddressEntryMode,
        freightDefaultOriginAddress, freightDefaultLoadAddress
        FROM parks WHERE id = ?`, [parkId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Park not found' });
        const payload = {
          eplCreationMode: row.eplCreationMode || 'takskom_api',
          eplPrintMode: row.eplPrintMode || 'our_then_taxcom',
          eplAccessMode: row.eplAccessMode === 'driver_only'
            ? 'driver_only'
            : row.eplAccessMode === 'manager_director_only'
              ? 'manager_director_only'
              : 'all',
          balanceDeductionOrder: row.balanceDeductionOrder || 'real_first',
          ogrn: row.ogrn || null,
          inn: row.inn || null,
          kpp: row.kpp || null,
          regionCode: row.regionCode || null,
          isActive: row.isActive || 0,
          name: row.name || null,
          address: row.address || null,
          postalIndex: row.postalIndex || null,
          region: row.region || null,
          city: row.city || null,
          street: row.street || null,
          house: row.house || null,
          phone: row.phone || null,
          email: row.email || null,
          district: row.district || null,
          locality: row.locality || null,
          housing: row.housing || null,
          flat: row.flat || null,
          takskornId: row.takskornId != null ? String(row.takskornId) : null,
          syncedWithTakskom: row.syncedWithTakskom || 0,
          freightAddressEntryMode: row.freightAddressEntryMode === 'driver' ? 'driver' : 'manager',
          freightDefaultOriginAddress: row.freightDefaultOriginAddress || null,
          freightDefaultLoadAddress: row.freightDefaultLoadAddress || null
        };
        if (eplFinal != null) payload.eplPrice = eplFinal;
        if (autoCloseFinal != null) payload.autoClosePrice = autoCloseFinal;
        addGameToPayload(payload, (p) => res.json(p));
      });
    };

    const saveGameSettingsAndRewards = (eplFinal, autoCloseFinal) => {
      if (gameEnabled === undefined && leaderboardDefault === undefined && rewardsEnabled === undefined && gameShopConfig === undefined && !Array.isArray(gameRewards)) {
        return sendSuccessResponse(eplFinal, autoCloseFinal);
      }
      const gEnabled = gameEnabled !== undefined ? (gameEnabled ? 1 : 0) : 0;
      const gLeaderboard = leaderboardDefault || 'day';
      const gRewards = rewardsEnabled !== undefined ? (rewardsEnabled ? 1 : 0) : 0;
      let gShopConfig = null;
      if (gameShopConfig !== undefined && gameShopConfig !== null) {
        try {
          const parsed = typeof gameShopConfig === 'string' ? JSON.parse(gameShopConfig) : gameShopConfig;
          if (parsed && typeof parsed.currencyType === 'string' && ['points', 'real'].includes(parsed.currencyType)) {
            gShopConfig = JSON.stringify({
              currencyType: parsed.currencyType,
              magnet: Math.max(0, parseInt(parsed.magnet, 10) || 0),
              nitro: Math.max(0, parseInt(parsed.nitro, 10) || 0),
              jump: Math.max(0, parseInt(parsed.jump, 10) || 0),
              extra_life: Math.max(0, parseInt(parsed.extra_life, 10) || 0)
            });
          }
        } catch (e) { /* ignore invalid */ }
      }
      db.get('SELECT parkId, gameShopConfig FROM park_game_settings WHERE parkId = ?', [parkId], (selErr, existing) => {
        if (selErr) return res.status(500).json({ error: 'Не удалось сохранить настройки игры' });
        const doInsert = () => {
          const shopVal = gShopConfig != null ? gShopConfig : (existing?.gameShopConfig ?? null);
          db.run('INSERT INTO park_game_settings (parkId, gameEnabled, leaderboardDefault, rewardsEnabled, gameShopConfig, updatedAt) VALUES (?, ?, ?, ?, ?, datetime("now"))', [parkId, gEnabled, gLeaderboard, gRewards, shopVal], (insErr) => {
            if (insErr) {
              console.error('[Admin] park_game_settings insert error:', insErr.message);
              return res.status(500).json({ error: 'Не удалось сохранить настройки игры' });
            }
            afterGameSettings();
          });
        };
        const doUpdate = () => {
          const updates = ['gameEnabled = ?', 'leaderboardDefault = ?', 'rewardsEnabled = ?', 'updatedAt = datetime("now")'];
          const vals = [gEnabled, gLeaderboard, gRewards];
          if (gShopConfig !== undefined) {
            updates.push('gameShopConfig = ?');
            vals.push(gShopConfig);
          }
          vals.push(parkId);
          db.run(`UPDATE park_game_settings SET ${updates.join(', ')} WHERE parkId = ?`, vals, (updErr) => {
            if (updErr) return res.status(500).json({ error: 'Не удалось сохранить настройки игры' });
            afterGameSettings();
          });
        };
        const afterGameSettings = () => {
          db.run('DELETE FROM park_game_rewards WHERE parkId = ?', [parkId], (delErr) => {
            if (delErr) return res.status(500).json({ error: 'Не удалось обновить награды' });
            const list = Array.isArray(gameRewards) ? gameRewards : [];
            if (list.length === 0) return sendSuccessResponse(eplFinal, autoCloseFinal);
            const placeholders = list.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
            const flat = list.flatMap(r => [
              parkId,
              parseInt(r.position, 10) || 1,
              r.rewardType === 'discount' ? 'discount' : 'free_epl',
              r.rewardType === 'free_epl' ? (parseInt(r.freeEplCount, 10) || 0) : 0,
              r.rewardType === 'discount' ? (parseInt(r.discountPercent, 10) || 0) : 0,
              r.rewardType === 'discount' ? (parseInt(r.discountEplCount, 10) || 0) : 0
            ]);
            db.run(`INSERT INTO park_game_rewards (parkId, position, rewardType, freeEplCount, discountPercent, discountEplCount) VALUES ${placeholders}`, flat, (insErr) => {
              if (insErr) return res.status(500).json({ error: 'Не удалось сохранить награды' });
              sendSuccessResponse(eplFinal, autoCloseFinal);
            });
          });
        };
        if (existing) doUpdate(); else doInsert();
      });
    };

    if (updates.length === 0) {
      if (eplPrice !== undefined || autoClosePrice !== undefined) {
        const epl = (eplPrice != null && !isNaN(Number(eplPrice))) ? Math.max(0, Number(eplPrice)) : 25;
        const autoClose = (autoClosePrice != null && !isNaN(Number(autoClosePrice))) ? Math.max(0, Number(autoClosePrice)) : 10;
        db.get('SELECT id FROM waybill_rates WHERE parkId = ? AND isActive = 1 ORDER BY id DESC LIMIT 1', [parkId], (rerr, rateRow) => {
          if (rerr) return res.status(500).json({ error: rerr.message });
          const doRate = (cb) => {
            if (rateRow) {
              db.run('UPDATE waybill_rates SET eplCreationFee = ?, autoCloseFee = ? WHERE id = ?', [epl, autoClose, rateRow.id], (uerr) => {
                if (uerr) return res.status(500).json({ error: uerr.message });
                cb(epl, autoClose);
              });
            } else {
              db.run('INSERT INTO waybill_rates (parkId, eplCreationFee, autoCloseFee, isActive) VALUES (?, ?, ?, 1)', [parkId, epl, autoClose], (ierr) => {
                if (ierr) return res.status(500).json({ error: ierr.message });
                cb(epl, autoClose);
              });
            }
          };
          doRate((eplFinal, autoCloseFinal) => saveGameSettingsAndRewards(eplFinal, autoCloseFinal));
        });
      } else {
        saveGameSettingsAndRewards();
      }
      return;
    }

    values.push(parkId);

    db.run(
      `UPDATE parks SET ${updates.join(', ')} WHERE id = ?`,
      values,
      function(err) {
        if (err) {
          console.error('[Admin] Error updating park settings:', err);
          return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) {
          console.warn(`[Admin] Park ${parkId} not found for update`);
          return res.status(404).json({ error: 'Park not found' });
        }
        console.log(`[Admin] Park ${parkId} settings updated`);

        if (eplPrice !== undefined || autoClosePrice !== undefined) {
          const epl = (eplPrice != null && !isNaN(Number(eplPrice))) ? Math.max(0, Number(eplPrice)) : 25;
          const autoClose = (autoClosePrice != null && !isNaN(Number(autoClosePrice))) ? Math.max(0, Number(autoClosePrice)) : 10;
          db.get('SELECT id FROM waybill_rates WHERE parkId = ? AND isActive = 1 ORDER BY id DESC LIMIT 1', [parkId], (rerr, rateRow) => {
            if (rerr) return res.status(500).json({ error: rerr.message });
            if (rateRow) {
              db.run('UPDATE waybill_rates SET eplCreationFee = ?, autoCloseFee = ? WHERE id = ?', [epl, autoClose, rateRow.id], (uerr) => {
                if (uerr) return res.status(500).json({ error: uerr.message });
                saveGameSettingsAndRewards(epl, autoClose);
              });
            } else {
              db.run('INSERT INTO waybill_rates (parkId, eplCreationFee, autoCloseFee, isActive) VALUES (?, ?, ?, 1)', [parkId, epl, autoClose], (ierr) => {
                if (ierr) return res.status(500).json({ error: ierr.message });
                saveGameSettingsAndRewards(epl, autoClose);
              });
            }
          });
        } else {
          saveGameSettingsAndRewards();
        }
      }
    );
  }
});

// Лидерборд мини-игры по парку (для бота / админки)
router.get('/parks/:parkId/game/leaderboard', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { parkId } = req.params;
  const period = (req.query.period || 'day').toLowerCase();
  let dateStr = req.query.date;
  if (!dateStr) {
    const now = new Date();
    const msk = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
    dateStr = `${msk.getFullYear()}-${String(msk.getMonth() + 1).padStart(2, '0')}-${String(msk.getDate()).padStart(2, '0')}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return res.status(400).json({ error: 'Invalid date format' });
  }
  const getBounds = () => {
    if (period === 'week') {
      const [y, m, d] = dateStr.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      const day = date.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      const monday = new Date(date);
      monday.setDate(date.getDate() + diff);
      const monStr = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const sunStr = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`;
      return { start: new Date(`${monStr}T00:00:00+03:00`).toISOString(), end: new Date(`${sunStr}T23:59:59.999+03:00`).toISOString() };
    }
    if (period === 'month') {
      const [y, m] = dateStr.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      return { start: new Date(`${y}-${String(m).padStart(2, '0')}-01T00:00:00+03:00`).toISOString(), end: new Date(`${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59.999+03:00`).toISOString() };
    }
    return { start: new Date(`${dateStr}T00:00:00+03:00`).toISOString(), end: new Date(`${dateStr}T23:59:59.999+03:00`).toISOString() };
  };
  const bounds = getBounds();
  db.get('SELECT gameEnabled FROM park_game_settings WHERE parkId = ?', [parkId], (e, gs) => {
    const gameEnabled = !!gs?.gameEnabled;
    db.all(
      `SELECT u.id as userId, u.fullName, u.username, SUM(s.score) as totalScore, MAX(s.score) as bestScore, COUNT(*) as gamesCount
       FROM driver_game_scores s
       JOIN users u ON s.userId = u.id
       WHERE s.parkId = ? AND s.playedAt >= ? AND s.playedAt <= ?
       GROUP BY s.userId
       ORDER BY totalScore DESC
       LIMIT 50`,
      [parkId, bounds.start, bounds.end],
      (err, list) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
          gameEnabled,
          period,
          date: dateStr,
          list: (list || []).map((r, i) => ({ rank: i + 1, userId: r.userId, fullName: r.fullName || r.username || 'Водитель', totalScore: r.totalScore, bestScore: r.bestScore, gamesCount: r.gamesCount })),
          gameUrlPath: '/driver/game'
        });
      }
    );
  });
});

// Обновить парк
router.put('/parks/:id', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { id } = req.params;
  const { name, address, region, city, street, house } = req.body;
  const postalIndex = req.body.postalIndex || req.body.index || null;

  db.run(
    'UPDATE parks SET name = ?, address = ?, postalIndex = ?, region = ?, city = ?, street = ?, house = ? WHERE id = ?',
    [name, address, postalIndex || null, region || null, city || null, street || null, house || null, id],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      db.get('SELECT * FROM parks WHERE id = ?', [id], (gerr, park) => {
        if (gerr) return res.status(500).json({ error: gerr.message });
        res.json({ message: 'Park updated', park });
      });
    }
  );
});

// Удалить парк
router.delete('/parks/:id', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { id } = req.params;

  // Каскадное удаление связанных данных парка
  // 1. Удаляем ЭПЛ (epl_titles удалятся автоматически через ON DELETE CASCADE)
  db.run('DELETE FROM epl WHERE parkId = ?', [id], (eplErr) => {
    if (eplErr) console.warn('[Delete Park] EPL deletion warning:', eplErr.message);
    
    // 2. Удаляем смены
    db.run('DELETE FROM shifts WHERE parkId = ?', [id], (shiftErr) => {
      if (shiftErr) console.warn('[Delete Park] Shifts deletion warning:', shiftErr.message);
      
      // 3. Получаем всех водителей парка для удаления их данных
      db.all('SELECT userId FROM drivers WHERE parkId = ?', [id], (driversErr, drivers) => {
        if (driversErr) console.warn('[Delete Park] Drivers fetch warning:', driversErr.message);
        
        const userIds = drivers ? drivers.map(d => d.userId) : [];
        
        // 4. Удаляем историю баланса всех водителей парка
        if (userIds.length > 0) {
          const placeholders = userIds.map(() => '?').join(',');
          db.run(`DELETE FROM balance_history WHERE userId IN (${placeholders})`, userIds, (balanceErr) => {
            if (balanceErr) console.warn('[Delete Park] Balance history deletion warning:', balanceErr.message);
          });
          
          // 5. Удаляем уведомления всех водителей парка
          db.run(`DELETE FROM notifications WHERE userId IN (${placeholders})`, userIds, (notifErr) => {
            if (notifErr) console.warn('[Delete Park] Notifications deletion warning:', notifErr.message);
          });
          
          // 6. Удаляем платежи всех водителей парка
          db.run(`DELETE FROM payments WHERE userId IN (${placeholders})`, userIds, (payErr) => {
            if (payErr) console.warn('[Delete Park] Payments deletion warning:', payErr.message);
          });
        }
        
        // 7. Удаляем водителей (park_staff удалится автоматически через ON DELETE CASCADE)
        db.run('DELETE FROM drivers WHERE parkId = ?', [id], (driversDelErr) => {
          if (driversDelErr) console.warn('[Delete Park] Drivers deletion warning:', driversDelErr.message);
          
          // 8. Удаляем менеджеров парка
          db.all('SELECT userId FROM managers WHERE parkId = ?', [id], (managersErr, managers) => {
            if (managersErr) console.warn('[Delete Park] Managers fetch warning:', managersErr.message);
            
            // 9. Удаляем записи менеджеров
            db.run('DELETE FROM managers WHERE parkId = ?', [id], (managersDelErr) => {
              if (managersDelErr) console.warn('[Delete Park] Managers deletion warning:', managersDelErr.message);
              
              // 10. Удаляем автомобили парка
              db.run('DELETE FROM cars WHERE parkId = ?', [id], (carsErr) => {
                if (carsErr) console.warn('[Delete Park] Cars deletion warning:', carsErr.message);
                
                // 11. Удаляем пользователей-водителей парка (если они не используются в других парках)
                if (userIds.length > 0) {
                  const placeholders = userIds.map(() => '?').join(',');
                  db.run(`DELETE FROM users WHERE id IN (${placeholders}) AND role = 'driver'`, userIds, (usersErr) => {
                    if (usersErr) console.warn('[Delete Park] Users deletion warning:', usersErr.message);
                  });
                }
                
                // 12. Удаляем пользователей-менеджеров парка
                if (managers && managers.length > 0) {
                  const managerUserIds = managers.map(m => m.userId);
                  const placeholders = managerUserIds.map(() => '?').join(',');
                  db.run(`DELETE FROM users WHERE id IN (${placeholders}) AND role = 'manager'`, managerUserIds, (managerUsersErr) => {
                    if (managerUsersErr) console.warn('[Delete Park] Manager users deletion warning:', managerUsersErr.message);
                  });
                }
                
                // 13. Удаляем сам парк
                db.run('DELETE FROM parks WHERE id = ?', [id], function (err) {
                  if (err) {
                    return res.status(500).json({ error: err.message });
                  }
                  res.json({ message: 'Park deleted' });
                });
              });
            });
          });
        });
      });
    });
  });
});

// Создать менеджера для парка или привязать существующего
router.post('/managers', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { parkId, username, password, phone, fullName, managerType, mode, usernameOrPhone } = req.body;
  const type = (managerType === 'fc' ? 'fc' : 'park');

  if (!parkId) {
    return res.status(400).json({ error: 'parkId is required' });
  }

  // Режим привязки существующего менеджера к парку
  if (mode === 'attach') {
    const login = usernameOrPhone;
    if (!login) {
      return res.status(400).json({ error: 'usernameOrPhone is required for attach mode' });
    }
    db.get('SELECT id, role FROM users WHERE username = ? OR phone = ?', [login, login], (err, userRow) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!userRow) {
        return res.status(404).json({ error: 'Пользователь с таким логином не найден' });
      }
      if (userRow.role !== 'manager') {
        return res.status(400).json({ error: 'Этот пользователь не является менеджером' });
      }

      // Проверяем, нет ли уже связи userId+parkId
      db.get(
        'SELECT id FROM managers WHERE userId = ? AND parkId = ?',
        [userRow.id, parkId],
        (mErr, managerRow) => {
          if (mErr) {
            return res.status(500).json({ error: mErr.message });
          }
          if (managerRow) {
            return res.status(400).json({ error: 'Менеджер уже привязан к этому парку' });
          }

          db.run(
            'INSERT INTO managers (userId, parkId, managerType) VALUES (?, ?, ?)',
            [userRow.id, parkId, type],
            function (iErr) {
              if (iErr) {
                return res.status(500).json({ error: iErr.message });
              }
              return res.status(201).json({
                success: true,
                message: 'Менеджер привязан к парку',
                managerId: this.lastID,
                userId: userRow.id
              });
            }
          );
        }
      );
    });
    return;
  }

  // Режим создания нового менеджера
  if (!username || !password || !phone || !fullName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const hashedPassword = hashPassword(password);

  // Сначала проверяем, что логин (обычно телефон) свободен
  db.get('SELECT id, role FROM users WHERE username = ?', [username], (checkErr, existingUser) => {
    if (checkErr) {
      return res.status(500).json({ error: checkErr.message });
    }
    if (existingUser) {
      return res.status(400).json({
        error:
          'Пользователь с таким логином уже существует. Используйте другой номер телефона или привяжите существующего менеджера к парку.'
      });
    }

    // Вставляем пользователя с полным именем и привязкой к парку
    db.run(
      'INSERT INTO users (username, password, phone, fullName, role, parkId, mustChangePassword, firstLogin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [username, hashedPassword, phone, fullName, 'manager', parkId, 1, 1],
      function (err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        const userId = this.lastID;

        db.run(
          'INSERT INTO managers (userId, parkId, managerType) VALUES (?, ?, ?)',
          [userId, parkId, type],
          function (err) {
            if (err) {
              return res.status(500).json({ error: err.message });
            }

            const token = generateToken(userId, 'manager', { mustChangePassword: 1, firstLogin: 1 });
            res.status(201).json({
              id: userId,
              username,
              phone,
              fullName,
              parkId,
              mustChangePassword: 1,
              firstLogin: 1,
              token,
              message: 'Manager created with default credentials'
            });
          }
        );
      }
    );
  });
});

// Получить финансы парка: закинуто/потрачено рил и фантики
router.get('/parks/:parkId/finance', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { parkId } = req.params;

  const sql = `
    SELECT
      IFNULL(SUM(CASE WHEN bh.type = 'topup' AND (bh.amountType = 'real' OR bh.amountType IS NULL) THEN bh.amount ELSE 0 END), 0) AS topupReal,
      IFNULL(SUM(CASE WHEN bh.type = 'topup' AND bh.amountType = 'unreal' THEN bh.amount ELSE 0 END), 0) AS topupUnreal,
      IFNULL(SUM(CASE WHEN bh.type IN ('expense','waybill_fee') AND (bh.amountType = 'real' OR bh.amountType IS NULL) THEN bh.amount ELSE 0 END), 0) AS spentReal,
      IFNULL(SUM(CASE WHEN bh.type IN ('expense','waybill_fee') AND bh.amountType = 'unreal' THEN bh.amount ELSE 0 END), 0) AS spentUnreal
    FROM balance_history bh
    JOIN users u ON bh.userId = u.id
    JOIN drivers d ON u.id = d.userId
    WHERE d.parkId = ?
  `;

  db.get(sql, [parkId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });

    db.get(
      `SELECT 
         IFNULL(SUM(COALESCE(balanceReal,0)),0) as totalBalanceReal,
         IFNULL(SUM(COALESCE(balanceUnreal,0)),0) as totalBalanceUnreal
       FROM users u
       JOIN drivers d ON u.id = d.userId
       WHERE d.parkId = ?`,
      [parkId],
      (err2, row2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        const totalBalanceReal = row2?.totalBalanceReal ?? 0;
        const totalBalanceUnreal = row2?.totalBalanceUnreal ?? 0;
        const r = row || {};
        res.json({
          topupReal: r.topupReal ?? 0,
          topupUnreal: r.topupUnreal ?? 0,
          spentReal: Math.abs(r.spentReal ?? 0),
          spentUnreal: Math.abs(r.spentUnreal ?? 0),
          totalBalance: totalBalanceReal + totalBalanceUnreal,
          totalBalanceReal,
          totalBalanceUnreal
        });
      }
    );
  });
});

// Получить всех менеджеров парка (с доступами)
router.get('/parks/:parkId/managers', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { parkId } = req.params;
  db.all(
    `SELECT m.id, u.id as userId, u.username, u.phone, u.fullName, m.parkId,
            COALESCE(m.canTopupBalance,0) as canTopupBalance,
            COALESCE(m.canFine,0) as canFine,
            COALESCE(m.canDismiss,0) as canDismiss,
            COALESCE(m.canDeleteDriver,0) as canDeleteDriver,
            COALESCE(m.canShowBalanceBreakdown,0) as canShowBalanceBreakdown,
            COALESCE(m.canChangeDriverPassword,0) as canChangeDriverPassword,
            COALESCE(m.canAccessBroadcasts,0) as canAccessBroadcasts,
            COALESCE(m.canAccessPhotoControl,0) as canAccessPhotoControl,
            COALESCE(m.managerType,'park') as managerType,
            COALESCE(m.canAccessStatistics,0) as canAccessStatistics,
            COALESCE(m.statsShowFinance,1) as statsShowFinance,
            COALESCE(m.statsShowEpl,1) as statsShowEpl,
            COALESCE(m.statsShowDrivers,1) as statsShowDrivers,
            COALESCE(m.canViewEplLogs,0) as canViewEplLogs,
            COALESCE(m.canControlEplQueue,0) as canControlEplQueue,
            COALESCE(m.canCloseEplShifts,0) as canCloseEplShifts,
            COALESCE(m.canChargeOnShiftClose,0) as canChargeOnShiftClose,
            COALESCE(m.canDownloadEplDocs,0) as canDownloadEplDocs
     FROM users u 
     JOIN managers m ON u.id = m.userId 
     WHERE m.parkId = ?`,
    [parkId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

// ===== ДИРЕКТОРА ПАРКА (полные права в рамках своего парка) =====

// Получить всех директоров парка (с доступами)
router.get('/parks/:parkId/directors', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { parkId } = req.params;
  db.all(
    `SELECT d.id, u.id as userId, u.username, u.phone, u.fullName, d.parkId,
            COALESCE(d.canTopupBalance,1) as canTopupBalance,
            COALESCE(d.canFine,1) as canFine,
            COALESCE(d.canDismiss,1) as canDismiss,
            COALESCE(d.canDeleteDriver,1) as canDeleteDriver,
            COALESCE(d.canShowBalanceBreakdown,1) as canShowBalanceBreakdown,
            COALESCE(d.canChangeDriverPassword,1) as canChangeDriverPassword,
            COALESCE(d.canAccessBroadcasts,1) as canAccessBroadcasts,
            COALESCE(d.canAccessPhotoControl,1) as canAccessPhotoControl,
            COALESCE(d.canAccessStatistics,1) as canAccessStatistics,
            COALESCE(d.statsShowFinance,1) as statsShowFinance,
            COALESCE(d.statsShowEpl,1) as statsShowEpl,
            COALESCE(d.statsShowDrivers,1) as statsShowDrivers,
            COALESCE(d.canViewEplLogs,1) as canViewEplLogs,
            COALESCE(d.canControlEplQueue,1) as canControlEplQueue,
            COALESCE(d.canCloseEplShifts,1) as canCloseEplShifts,
            COALESCE(d.canChargeOnShiftClose,1) as canChargeOnShiftClose,
            COALESCE(d.canDownloadEplDocs,1) as canDownloadEplDocs,
            COALESCE(d.canManageParkSettings,0) as canManageParkSettings,
            (CASE WHEN COALESCE(d.canManageParkSettings,0) = 1 OR COALESCE(d.canParkSettingsStatusName,0) = 1 THEN 1 ELSE 0 END) as canParkSettingsStatusName,
            (CASE WHEN COALESCE(d.canManageParkSettings,0) = 1 OR COALESCE(d.canParkSettingsTakskom,0) = 1 THEN 1 ELSE 0 END) as canParkSettingsTakskom,
            (CASE WHEN COALESCE(d.canManageParkSettings,0) = 1 OR COALESCE(d.canParkSettingsStaff,0) = 1 THEN 1 ELSE 0 END) as canParkSettingsStaff,
            (CASE WHEN COALESCE(d.canManageParkSettings,0) = 1 OR COALESCE(d.canParkSettingsFreight,0) = 1 THEN 1 ELSE 0 END) as canParkSettingsFreight,
            (CASE WHEN COALESCE(d.canManageParkSettings,0) = 1 OR COALESCE(d.canParkSettingsBroadcasts,0) = 1 THEN 1 ELSE 0 END) as canParkSettingsBroadcasts,
            (CASE WHEN COALESCE(d.canManageParkSettings,0) = 1 OR COALESCE(d.canParkSettingsOwners,0) = 1 THEN 1 ELSE 0 END) as canParkSettingsOwners,
            (CASE WHEN COALESCE(d.canManageParkSettings,0) = 1 OR COALESCE(d.canParkSettingsBalance,0) = 1 THEN 1 ELSE 0 END) as canParkSettingsBalance,
            (CASE WHEN COALESCE(d.canManageParkSettings,0) = 1 OR COALESCE(d.canParkSettingsPricing,0) = 1 THEN 1 ELSE 0 END) as canParkSettingsPricing,
            (CASE WHEN COALESCE(d.canManageParkSettings,0) = 1 OR COALESCE(d.canParkSettingsGame,0) = 1 THEN 1 ELSE 0 END) as canParkSettingsGame,
            (CASE WHEN COALESCE(d.canManageParkSettings,0) = 1 OR COALESCE(d.canParkSettingsPhotoControl,0) = 1 THEN 1 ELSE 0 END) as canParkSettingsPhotoControl,
            (CASE WHEN COALESCE(d.canManageParkSettings,0) = 1 OR COALESCE(d.canParkSettingsServices,0) = 1 THEN 1 ELSE 0 END) as canParkSettingsServices,
            COALESCE(d.canAccessFinance,0) as canAccessFinance,
            COALESCE(d.financeShowKassa,1) as financeShowKassa,
            COALESCE(d.financeShowSalary,1) as financeShowSalary,
            COALESCE(d.financeShowParks,1) as financeShowParks,
            COALESCE(d.financeShowMonthly,1) as financeShowMonthly,
            COALESCE(d.financeScopeAll,0) as financeScopeAll
     FROM users u
     JOIN directors d ON u.id = d.userId
     WHERE d.parkId = ?`,
    [parkId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

// Создать директора для парка или привязать существующего
router.post('/directors', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { parkId, username, password, phone, fullName, mode, usernameOrPhone } = req.body;

  if (!parkId) {
    return res.status(400).json({ error: 'parkId is required' });
  }

  // Режим привязки существующего директора к парку
  if (mode === 'attach') {
    const login = usernameOrPhone;
    if (!login) return res.status(400).json({ error: 'usernameOrPhone is required for attach mode' });
    db.get('SELECT id, role FROM users WHERE username = ? OR phone = ?', [login, login], (err, userRow) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!userRow) return res.status(404).json({ error: 'Пользователь с таким логином не найден' });
      if (userRow.role !== 'director') return res.status(400).json({ error: 'Этот пользователь не является директором' });

      db.get(
        'SELECT id FROM directors WHERE userId = ? AND parkId = ?',
        [userRow.id, parkId],
        (dErr, directorRow) => {
          if (dErr) return res.status(500).json({ error: dErr.message });
          if (directorRow) return res.status(400).json({ error: 'Директор уже привязан к этому парку' });

          db.run(
            'INSERT INTO directors (userId, parkId) VALUES (?, ?)',
            [userRow.id, parkId],
            function (iErr) {
              if (iErr) return res.status(500).json({ error: iErr.message });
              return res.status(201).json({
                success: true,
                message: 'Директор привязан к парку',
                directorId: this.lastID,
                userId: userRow.id
              });
            }
          );
        }
      );
    });
    return;
  }

  // Режим создания нового директора
  if (!username || !password || !phone || !fullName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const hashedPassword = hashPassword(password);
  db.get('SELECT id FROM users WHERE username = ? OR phone = ?', [username, phone], (checkErr, existingUser) => {
    if (checkErr) return res.status(500).json({ error: checkErr.message });
    if (existingUser) {
      return res.status(400).json({
        error: 'Пользователь с таким логином или телефоном уже существует. Используйте привязку (attach) или другой номер.'
      });
    }

    db.run(
      'INSERT INTO users (username, password, phone, fullName, role, parkId, mustChangePassword, firstLogin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [username, hashedPassword, phone, fullName, 'director', parkId, 1, 1],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        const userId = this.lastID;
        db.run(
          'INSERT INTO directors (userId, parkId) VALUES (?, ?)',
          [userId, parkId],
          function (dErr) {
            if (dErr) return res.status(500).json({ error: dErr.message });
            const token = generateToken(userId, 'director', { mustChangePassword: 1, firstLogin: 1 });
            res.status(201).json({
              id: userId,
              username,
              phone,
              fullName,
              parkId,
              mustChangePassword: 1,
              firstLogin: 1,
              token,
              message: 'Director created with default credentials'
            });
          }
        );
      }
    );
  });
});

// Обновить профиль директора (ФИО, телефон, пароль) — по id строки directors
router.put('/directors/:directorId', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { directorId } = req.params;
  const { fullName, phone, newPassword } = req.body;

  db.get('SELECT d.userId FROM directors d WHERE d.id = ?', [directorId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Директор не найден' });

    const updates = [];
    const values = [];

    if (fullName !== undefined) {
      updates.push('fullName = ?');
      values.push(fullName);
    }
    if (phone !== undefined) {
      updates.push('phone = ?');
      values.push(phone);
    }
    if (newPassword) {
      const hashedPassword = require('../auth').hashPassword(newPassword);
      updates.push('password = ?');
      values.push(hashedPassword);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Нет полей для обновления' });
    }

    values.push(row.userId);

    db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values, (upErr) => {
      if (upErr) return res.status(500).json({ error: upErr.message });
      res.json({ success: true, message: 'Директор обновлён' });
    });
  });
});

// Обновить доступы директора
router.put('/directors/:directorId/permissions', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { directorId } = req.params;
  const {
    canTopupBalance, canFine, canDismiss, canDeleteDriver, canShowBalanceBreakdown,
    canChangeDriverPassword, canAccessBroadcasts,
    canAccessPhotoControl,
    canAccessStatistics, statsShowFinance, statsShowEpl, statsShowDrivers,
    driverStatsShowBalance, driverStatsShowEpl, driverStatsShowShifts,
    canViewEplLogs, canControlEplQueue,
    canCloseEplShifts, canChargeOnShiftClose, canDownloadEplDocs,
    canManageParkSettings,
    canParkSettingsStatusName, canParkSettingsTakskom, canParkSettingsStaff, canParkSettingsFreight,
    canParkSettingsBroadcasts, canParkSettingsOwners, canParkSettingsBalance, canParkSettingsPricing,
    canParkSettingsGame, canParkSettingsPhotoControl, canParkSettingsServices,
    canAccessFinance, financeShowKassa, financeShowSalary, financeShowParks, financeShowMonthly, financeScopeAll
  } = req.body;

  db.run(
    `UPDATE directors SET
       canTopupBalance = ?, canFine = ?, canDismiss = ?, canDeleteDriver = ?, canShowBalanceBreakdown = ?,
       canChangeDriverPassword = ?,
       canAccessBroadcasts = ?,
       canAccessPhotoControl = ?,
       canAccessStatistics = ?, statsShowFinance = ?, statsShowEpl = ?, statsShowDrivers = ?,
       driverStatsShowBalance = ?, driverStatsShowEpl = ?, driverStatsShowShifts = ?,
       canViewEplLogs = ?, canControlEplQueue = ?,
       canCloseEplShifts = ?, canChargeOnShiftClose = ?, canDownloadEplDocs = ?,
       canManageParkSettings = ?,
       canParkSettingsStatusName = ?, canParkSettingsTakskom = ?, canParkSettingsStaff = ?, canParkSettingsFreight = ?,
       canParkSettingsBroadcasts = ?, canParkSettingsOwners = ?, canParkSettingsBalance = ?, canParkSettingsPricing = ?,
       canParkSettingsGame = ?, canParkSettingsPhotoControl = ?, canParkSettingsServices = ?,
       canAccessFinance = ?, financeShowKassa = ?, financeShowSalary = ?, financeShowParks = ?, financeShowMonthly = ?, financeScopeAll = ?
     WHERE id = ?`,
    [
      canTopupBalance !== false ? 1 : 0,
      canFine !== false ? 1 : 0,
      canDismiss !== false ? 1 : 0,
      canDeleteDriver !== false ? 1 : 0,
      canShowBalanceBreakdown !== false ? 1 : 0,
      canChangeDriverPassword !== false ? 1 : 0,
      canAccessBroadcasts !== false ? 1 : 0,
      canAccessPhotoControl !== false ? 1 : 0,
      canAccessStatistics !== false ? 1 : 0,
      statsShowFinance !== false ? 1 : 0,
      statsShowEpl !== false ? 1 : 0,
      statsShowDrivers !== false ? 1 : 0,
      driverStatsShowBalance !== false ? 1 : 0,
      driverStatsShowEpl !== false ? 1 : 0,
      driverStatsShowShifts !== false ? 1 : 0,
      canViewEplLogs !== false ? 1 : 0,
      canControlEplQueue !== false ? 1 : 0,
      canCloseEplShifts !== false ? 1 : 0,
      canChargeOnShiftClose !== false ? 1 : 0,
      canDownloadEplDocs !== false ? 1 : 0,
      canManageParkSettings ? 1 : 0,
      canParkSettingsStatusName ? 1 : 0,
      canParkSettingsTakskom ? 1 : 0,
      canParkSettingsStaff ? 1 : 0,
      canParkSettingsFreight ? 1 : 0,
      canParkSettingsBroadcasts ? 1 : 0,
      canParkSettingsOwners ? 1 : 0,
      canParkSettingsBalance ? 1 : 0,
      canParkSettingsPricing ? 1 : 0,
      canParkSettingsGame ? 1 : 0,
      canParkSettingsPhotoControl ? 1 : 0,
      canParkSettingsServices ? 1 : 0,
      canAccessFinance ? 1 : 0,
      financeShowKassa !== false ? 1 : 0,
      financeShowSalary !== false ? 1 : 0,
      financeShowParks !== false ? 1 : 0,
      financeShowMonthly !== false ? 1 : 0,
      financeScopeAll ? 1 : 0,
      directorId
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Директор не найден' });
      res.json({ success: true, message: 'Доступы обновлены' });
    }
  );
});

// Снять директора с парка (удалить привязку directors)
router.delete('/parks/:parkId/directors/:directorId', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { parkId, directorId } = req.params;
  db.run(
    'DELETE FROM directors WHERE id = ? AND parkId = ?',
    [directorId, parkId],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Привязка директора не найдена' });
      res.json({ success: true });
    }
  );
});

// ===== СОТРУДНИКИ ПАРКА (медик, механик, диспетчер) =====

// Получить всех сотрудников парка
router.get('/parks/:parkId/staff', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { parkId } = req.params;
  db.all(
    `SELECT id, parkId, role, fullName, firstName, lastName, secondName, position, phone, email, authorityBasis,
     licenseSerial, licenseNumber, licenseDateStart, licenseDateEnd,
     taxcomLogin, taxcomPassword, COALESCE(isActive,1) as isActive, COALESCE(priority,0) as priority
     FROM park_staff WHERE parkId = ?
     ORDER BY role, COALESCE(isActive,1) DESC, COALESCE(priority,0) DESC, id DESC`,
    [parkId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

// Создать/обновить сотрудника парка
router.post('/parks/:parkId/staff', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { parkId } = req.params;
  const { id: staffId, role, fullName, firstName, lastName, secondName, position, phone, email, authorityBasis,
          licenseSerial, licenseNumber, licenseDateStart, licenseDateEnd,
          taxcomLogin, taxcomPassword, isActive, priority } = req.body;

  if (!['medic', 'technic', 'dispatcher'].includes(role)) {
    return res.status(400).json({ error: 'role должен быть: medic, technic или dispatcher' });
  }
  if (!String(taxcomLogin || '').trim() || !String(taxcomPassword || '').trim()) {
    return res.status(400).json({ error: 'Обязательные поля: taxcomLogin, taxcomPassword' });
  }
  const defaultByRole = {
    dispatcher: { fullName: 'Диспетчер парка', position: 'Диспетчер' },
    medic: { fullName: 'Медицинский работник', position: 'Медицинский работник' },
    technic: { fullName: 'Механик', position: 'Механик' },
  };
  const safeFullName = String(fullName || '').trim() || defaultByRole[role].fullName;
  const safePosition = String(position || '').trim() || defaultByRole[role].position;

  // Разбиваем ФИО на части, если не переданы отдельно (в русском порядке: Фамилия, Имя, Отчество)
  let fioLastName = lastName || ''; // Фамилия
  let fioFirstName = firstName || ''; // Имя
  let fioSecondName = secondName || ''; // Отчество
  if (!lastName && safeFullName) {
    const fioParts = (safeFullName || '').trim().split(/\s+/);
    fioLastName = fioParts[0] || ''; // Фамилия - первая часть
    fioFirstName = fioParts[1] || ''; // Имя - вторая часть
    fioSecondName = fioParts[2] || ''; // Отчество - третья часть
  }
  const finalFullName = safeFullName || `${fioLastName} ${fioFirstName}${fioSecondName ? ' ' + fioSecondName : ''}`.trim();

  const activeVal = isActive === false || isActive === 0 || isActive === '0' ? 0 : 1;
  const priorityVal = Number.isFinite(Number(priority)) ? Number(priority) : 0;
  const parsedStaffId = Number(staffId);
  if (Number.isFinite(parsedStaffId) && parsedStaffId > 0) {
    db.run(
      `UPDATE park_staff SET
       role = ?, fullName = ?, lastName = ?, firstName = ?, secondName = ?, position = ?,
       phone = ?, email = ?, authorityBasis = ?,
       licenseSerial = ?, licenseNumber = ?, licenseDateStart = ?, licenseDateEnd = ?,
       taxcomLogin = ?, taxcomPassword = ?, isActive = ?, priority = ?, updatedAt = CURRENT_TIMESTAMP
       WHERE id = ? AND parkId = ?`,
      [
        role, finalFullName, fioLastName, fioFirstName, fioSecondName, safePosition, phone || null, email || null, authorityBasis || null,
        licenseSerial || null, licenseNumber || null, licenseDateStart || null, licenseDateEnd || null,
        taxcomLogin || null, taxcomPassword || null, activeVal, priorityVal, parsedStaffId, parkId
      ],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (!this.changes) return res.status(404).json({ error: 'Сотрудник не найден' });
        db.get('SELECT * FROM park_staff WHERE id = ?', [parsedStaffId], (gerr, staff) => {
          if (gerr) return res.status(500).json({ error: gerr.message });
          res.json({ message: 'Сотрудник обновлен', staff });
        });
      }
    );
    return;
  }
  db.run(
    `INSERT INTO park_staff
     (parkId, role, fullName, lastName, firstName, secondName, position, phone, email, authorityBasis,
      licenseSerial, licenseNumber, licenseDateStart, licenseDateEnd, taxcomLogin, taxcomPassword, isActive, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      parkId, role, finalFullName, fioLastName, fioFirstName, fioSecondName, safePosition, phone || null, email || null, authorityBasis || null,
      licenseSerial || null, licenseNumber || null, licenseDateStart || null, licenseDateEnd || null, taxcomLogin || null, taxcomPassword || null,
      activeVal, priorityVal
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      db.get('SELECT * FROM park_staff WHERE id = ?', [this.lastID], (gerr, staff) => {
        if (gerr) return res.status(500).json({ error: gerr.message });
        res.json({ message: 'Сотрудник создан', staff });
      });
    }
  );
});

// Обновить данные водителя для Такском
router.put('/drivers/:driverId/takskom', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { driverId } = req.params;
  const { lastName, firstName, secondName, licenseSerial, licenseNumber, licenseDate, personnelNumber, inn, snils, eplAccessOverride } = req.body;
  const normalizedEplAccessOverride = eplAccessOverride === 'force_allow'
    ? 'force_allow'
    : eplAccessOverride === 'force_deny'
      ? 'force_deny'
      : eplAccessOverride === undefined
        ? undefined
        : 'default';

  // driverId может быть как id водителя, так и userId - проверяем оба варианта
  // ВАЖНО: проверяем, что водитель существует (проверка парка не нужна, т.к. админ может работать с любым парком)
  db.get('SELECT id, userId FROM drivers WHERE id = ? OR userId = ?', [driverId, driverId], (checkErr, driver) => {
    if (checkErr) return res.status(500).json({ error: checkErr.message });
    if (!driver) return res.status(404).json({ error: 'Водитель не найден' });
    
    // Данные водителя хранятся в таблице users, а не drivers
    const actualUserId = driver.userId;
    
    db.run(`
      UPDATE users SET
        lastName = ?,
        firstName = ?,
        secondName = ?,
        licenseSerial = ?,
        licenseNumber = ?,
        licenseDate = ?,
        personnelNumber = ?,
        inn = ?,
        snils = ?
      WHERE id = ?
    `, [lastName, firstName, secondName, licenseSerial, licenseNumber, licenseDate, personnelNumber, inn, snils || null, actualUserId], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Пользователь не найден' });
      const runVerifyAndRespond = () => {
        // Авто-верификация: если в карточке заполнены ФИО, серия/номер ВУ и дата выдачи — ставим вериф пройден
        const canVerify = (lastName || '').trim() && (firstName || '').trim() &&
          ((licenseSerial || '').trim() || (licenseNumber || '').trim()) && (licenseDate || '').trim();
        if (canVerify) {
          db.run('UPDATE drivers SET isVerified = 1 WHERE userId = ?', [actualUserId], function(verErr) {
            if (verErr) console.warn('[Admin] auto-verify driver:', verErr.message);
            res.json({ success: true, message: 'Данные водителя для Такском обновлены' });
          });
        } else {
          res.json({ success: true, message: 'Данные водителя для Такском обновлены' });
        }
      };
      if (normalizedEplAccessOverride === undefined) {
        runVerifyAndRespond();
        return;
      }
      db.run(
        `UPDATE drivers SET eplAccessOverride = ? WHERE userId = ?`,
        [normalizedEplAccessOverride, actualUserId],
        (eplOverrideErr) => {
          if (eplOverrideErr) return res.status(500).json({ error: eplOverrideErr.message });
          runVerifyAndRespond();
        }
      );
    });
  });
});

// Обновить доступы менеджера
router.put('/managers/:managerId/permissions', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { managerId } = req.params;
  const {
    canTopupBalance, canFine, canDismiss, canDeleteDriver, canShowBalanceBreakdown,
    canChangeDriverPassword,
    canAccessBroadcasts,
    canAccessPhotoControl, managerType,
    canAccessStatistics, statsShowFinance, statsShowEpl, statsShowDrivers,
    driverStatsShowBalance, driverStatsShowEpl, driverStatsShowShifts,
    canViewEplLogs, canControlEplQueue,
    canCloseEplShifts, canChargeOnShiftClose, canDownloadEplDocs
  } = req.body;
  const type = (managerType === 'fc' ? 'fc' : 'park');
  db.run(
    `UPDATE managers SET 
       canTopupBalance = ?, canFine = ?, canDismiss = ?, canDeleteDriver = ?, canShowBalanceBreakdown = ?,
       canChangeDriverPassword = ?,
       canAccessBroadcasts = ?,
       canAccessPhotoControl = ?, managerType = ?,
       canAccessStatistics = ?, statsShowFinance = ?, statsShowEpl = ?, statsShowDrivers = ?,
       driverStatsShowBalance = ?, driverStatsShowEpl = ?, driverStatsShowShifts = ?,
       canViewEplLogs = ?, canControlEplQueue = ?,
       canCloseEplShifts = ?, canChargeOnShiftClose = ?, canDownloadEplDocs = ?
     WHERE id = ?`,
    [
      canTopupBalance ? 1 : 0, canFine ? 1 : 0, canDismiss ? 1 : 0, canDeleteDriver ? 1 : 0, canShowBalanceBreakdown ? 1 : 0,
      canChangeDriverPassword ? 1 : 0,
      canAccessBroadcasts ? 1 : 0,
      canAccessPhotoControl ? 1 : 0, type,
      canAccessStatistics ? 1 : 0,
      statsShowFinance !== false ? 1 : 0,
      statsShowEpl !== false ? 1 : 0,
      statsShowDrivers !== false ? 1 : 0,
      driverStatsShowBalance !== false ? 1 : 0,
      driverStatsShowEpl !== false ? 1 : 0,
      driverStatsShowShifts !== false ? 1 : 0,
      canViewEplLogs ? 1 : 0,
      canControlEplQueue ? 1 : 0,
      canCloseEplShifts ? 1 : 0,
      canChargeOnShiftClose ? 1 : 0,
      canDownloadEplDocs ? 1 : 0,
      managerId
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Менеджер не найден' });
      res.json({ success: true, message: 'Доступы обновлены' });
    }
  );
});

// Получить водителей парка (для админки: карточки с действиями)
router.get('/parks/:parkId/drivers', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { parkId } = req.params;
  ensureParksTable(() => {
  db.all(
    `SELECT d.id, d.id as driverId, u.id as userId, u.username, u.phone, u.fullName,
       u.firstName, u.lastName, u.secondName, u.licenseSerial, u.licenseNumber, u.licenseDate, u.personnelNumber, u.inn, u.snils,
       COALESCE(u.innMutationApplied,0) as innMutationApplied,
       COALESCE(u.balanceReal,0) as balanceReal, COALESCE(u.balanceUnreal,0) as balanceUnreal,
       (COALESCE(u.balanceReal,0) + COALESCE(u.balanceUnreal,0)) as balance,
      d.carId, d.isVerified, d.license, COALESCE(d.eplAccessOverride, 'default') as eplAccessOverride,
       c.regNumber, c.brand, c.model
     FROM drivers d
     JOIN users u ON d.userId = u.id
     LEFT JOIN cars c ON d.carId = c.id AND c.parkId = d.parkId
     WHERE d.parkId = ?`,
    [parkId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
  });
});

// Статистика по конкретному водителю (админка: карточка водителя)
router.get('/drivers/:userId/statistics', authenticateToken, authorizeRole('admin'), (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!userId || Number.isNaN(userId)) return res.status(400).json({ error: 'Некорректный userId' });

  db.get(
    `SELECT d.id as driverId, d.parkId as parkId,
            (COALESCE(u.balanceReal,0) + COALESCE(u.balanceUnreal,0)) as balance
     FROM drivers d
     JOIN users u ON u.id = d.userId
     WHERE d.userId = ?`,
    [userId],
    (dErr, dRow) => {
      if (dErr) return res.status(500).json({ error: dErr.message });
      if (!dRow) return res.status(404).json({ error: 'Водитель не найден' });

      const driverId = dRow.driverId;
      const parkId = dRow.parkId;

      db.get(
        `SELECT 
           COUNT(*) as totalEpl,
           SUM(CASE WHEN createdAt >= datetime('now', '-7 days') THEN 1 ELSE 0 END) as epl7d,
           SUM(CASE WHEN createdAt >= datetime('now', '-30 days') THEN 1 ELSE 0 END) as epl30d,
           MAX(COALESCE(documentPdfReceivedAt, approvedAt, mintransCreatedAt, createdAt)) as lastEplAt
         FROM epl
         WHERE driverId = ? AND parkId = ?`,
        [driverId, parkId],
        (eErr, eplStats) => {
          if (eErr) return res.status(500).json({ error: eErr.message });

          db.get(
            `SELECT COUNT(*) as activeShifts
             FROM shifts
             WHERE driverId = ? AND parkId = ? AND status = 'active'`,
            [driverId, parkId],
            (sErr, sRow) => {
              if (sErr) return res.status(500).json({ error: sErr.message });

              db.get(
                `SELECT 
                   COUNT(CASE WHEN status = 'completed' THEN 1 END) as totalRides,
                   SUM(CASE WHEN status = 'completed' THEN distance ELSE 0 END) as totalDistance,
                   SUM(CASE WHEN status = 'completed' THEN fare ELSE 0 END) as totalEarnings,
                   COUNT(CASE WHEN status = 'active' THEN 1 END) as activeRides
                 FROM rides
                 WHERE driverId = ?`,
                [driverId],
                (rErr, rideStats) => {
                  if (rErr) return res.status(500).json({ error: rErr.message });

                  res.json({
                    driverId,
                    userId,
                    parkId,
                    balance: Number(dRow.balance || 0),
                    epl: {
                      total: Number(eplStats?.totalEpl || 0),
                      epl7d: Number(eplStats?.epl7d || 0),
                      epl30d: Number(eplStats?.epl30d || 0),
                      lastEplAt: eplStats?.lastEplAt || null,
                    },
                    shifts: {
                      active: Number(sRow?.activeShifts || 0),
                    },
                    rides: {
                      totalRides: Number(rideStats?.totalRides || 0),
                      totalDistance: Number(rideStats?.totalDistance || 0),
                      totalEarnings: Number(rideStats?.totalEarnings || 0),
                      activeRides: Number(rideStats?.activeRides || 0),
                    }
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

// Добавить водителя в парк (админ)
router.post('/parks/:parkId/drivers', authenticateToken, authorizeRole('admin'), async (req, res) => {
  try {
    const { parkId } = req.params;
    const { username, password, phone, fullName, license, licenseSerial, licenseNumber, licenseDate, inn, snils } = req.body;

    if (!username || !password || !phone || !fullName) {
      return res.status(400).json({ error: 'Missing required fields: username, password, phone, fullName' });
    }

    await new Promise((r) => ensureParksTable(r));
    // Проверяем, что парк существует
    db.get('SELECT id, takskornId FROM parks WHERE id = ?', [parkId], async (parkErr, park) => {
      if (parkErr) {
        return res.status(500).json({ error: parkErr.message });
      }
      if (!park) {
        return res.status(404).json({ error: 'Park not found' });
      }

      const personnelNumber = `DRV-${parkId}-${Date.now()}`;
      const { hashPassword } = require('../auth');
      // Валидация обязательных полей
      if (!fullName || !phone || (!licenseSerial && !licenseNumber && !license)) {
        return res.status(400).json({ 
          error: 'Обязательные поля: ФИО, телефон, серия/номер ВУ (или license)' 
        });
      }

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

        if (park.takskornId) {
          try {
            const takskSync = require('../services/takskom-sync');
            syncResult = await takskSync.syncDriverWithTakskom({
              fullName,
              phone,
              license: license || null,
              inn: inn || null,
              snils: snils || null,
              personnelNumber
            }, park.takskornId);

            if (syncResult && syncResult.success) {
              takskornId = syncResult.takskornId;
              syncedWithTakskom = 1;
              console.log(`[Admin] Водитель ${fullName} синхронизирован с Такском, id: ${takskornId}`);
            } else {
              console.warn(`[Admin] Ошибка синхро водителя ${fullName}:`, syncResult ? syncResult.error : 'unknown');
            }
          } catch (e) {
            console.warn('[TAKSKOM] syncDriverWithTakskom failed:', e.message);
          }
        }

        const driverRole = 'driver';
        db.run(
          `INSERT INTO users (username, password, phone, fullName, firstName, lastName, secondName, role, parkId, balance, 
                             licenseSerial, licenseNumber, licenseDate, inn, snils, personnelNumber, isVerified, firstLogin, mustChangePassword)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [username, hashedPassword, phone, fullName, firstName, lastName, secondName, driverRole, parkId, 0,
           licenseSerial || null, licenseNumber || null, licenseDate || null, inn || null, snils || null, personnelNumber, syncedWithTakskom, 1, 0],
          function (err) {
            if (err) {
              return res.status(500).json({ error: err.message });
            }

            const userId = this.lastID;

            db.run(
              `INSERT INTO drivers (userId, parkId, license, takskornId, syncedWithTakskom, isVerified, lastSyncAt)
               VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
              [userId, parkId, license || null, takskornId, syncedWithTakskom, syncedWithTakskom],
              function (err) {
                if (err) {
                  return res.status(500).json({ error: err.message });
                }

                const { generateToken } = require('../auth');
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
                  parkId: parkId,
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
  } catch (error) {
    console.error('[Admin] POST /parks/:parkId/drivers error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Пополнить баланс водителя (админ, из кассы = real или бонус = unreal)
router.post('/drivers/:userId/balance', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { userId } = req.params;
  const { amount, amountType = 'real' } = req.body; // amountType: 'real' | 'unreal'
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Укажите сумму больше 0' });
  }
  const num = Number(amount);
  if (isNaN(num)) return res.status(400).json({ error: 'Некорректная сумма' });
  
  // Проверяем, что водитель существует (проверка парка не нужна, т.к. админ может работать с любым парком)
  db.get('SELECT id FROM drivers WHERE userId = ?', [userId], (checkErr, driver) => {
    if (checkErr) return res.status(500).json({ error: checkErr.message });
    if (!driver) return res.status(404).json({ error: 'Водитель не найден' });
    
    // Используем утилиту для пополнения баланса
    addBalance(
      db,
      userId,
      num,
      amountType,
      amountType === 'real' ? 'Пополнение из кассы (админ)' : 'Бонус (админ)',
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: 'Баланс пополнен', userId, amount: num, amountType });
      }
    );
  });
});

// Sanity-check балансов: ищем рассинхроны users.balance* vs сумма balance_history
router.get('/balance/sanity', authenticateToken, authorizeRole('admin'), (req, res) => {
  const diffGt = req.query.diffGt != null ? Number(req.query.diffGt) : 0.01;
  const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 200));
  if (Number.isNaN(diffGt) || diffGt < 0) return res.status(400).json({ error: 'Некорректный diffGt' });

  db.all(
    `
    WITH hist AS (
      SELECT
        userId,
        SUM(CASE WHEN amountType = 'real' THEN amount ELSE 0 END) as histReal,
        SUM(CASE WHEN amountType = 'unreal' THEN amount ELSE 0 END) as histUnreal,
        COUNT(*) as histRows,
        MAX(createdAt) as lastHistAt
      FROM balance_history
      GROUP BY userId
    )
    SELECT
      u.id as userId,
      u.fullName as fullName,
      u.phone as phone,
      COALESCE(u.balanceReal, 0) as balanceReal,
      COALESCE(u.balanceUnreal, 0) as balanceUnreal,
      COALESCE(h.histReal, 0) as histReal,
      COALESCE(h.histUnreal, 0) as histUnreal,
      COALESCE(h.histRows, 0) as histRows,
      h.lastHistAt as lastHistAt,
      (COALESCE(u.balanceReal,0) - COALESCE(h.histReal,0)) as diffReal,
      (COALESCE(u.balanceUnreal,0) - COALESCE(h.histUnreal,0)) as diffUnreal
    FROM users u
    LEFT JOIN hist h ON h.userId = u.id
    WHERE (ABS(COALESCE(u.balanceReal,0) - COALESCE(h.histReal,0)) > ?)
       OR (ABS(COALESCE(u.balanceUnreal,0) - COALESCE(h.histUnreal,0)) > ?)
    ORDER BY (ABS(COALESCE(u.balanceReal,0) - COALESCE(h.histReal,0)) + ABS(COALESCE(u.balanceUnreal,0) - COALESCE(h.histUnreal,0))) DESC
    LIMIT ?
    `,
    [diffGt, diffGt, limit],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        diffGt,
        limit,
        count: (rows || []).length,
        rows: rows || [],
      });
    }
  );
});

// Войти от имени водителя (короткоживущий токен для просмотра кабинета водителя)
router.post('/impersonate/driver/:userId', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { userId: driverUserId } = req.params;
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

  db.get(
    `SELECT u.id, u.username, u.phone, u.fullName, d.id as driverId, d.parkId
     FROM drivers d
     JOIN users u ON d.userId = u.id
     WHERE u.id = ?`,
    [driverUserId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
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

// Войти от имени эвакуатора (короткоживущий токен для просмотра кабинета эвакуатора)
router.post('/impersonate/evacuator/:userId', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { userId: evacuatorUserId } = req.params;
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

  db.get(
    `SELECT id, username, phone, fullName
     FROM users
     WHERE id = ? AND role = ?`,
    [evacuatorUserId, 'evacuator'],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Эвакуатор не найден' });

      const token = jwt.sign(
        { userId: row.id, role: 'evacuator' },
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
          role: 'evacuator'
        }
      });
    }
  );
});

// Войти от имени комиссара (короткоживущий токен для просмотра кабинета комиссара)
router.post('/impersonate/commissioner/:userId', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { userId: commissionerUserId } = req.params;
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

  db.get(
    `SELECT id, username, phone, fullName
     FROM users
     WHERE id = ? AND role = ?`,
    [commissionerUserId, 'commissioner'],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Комиссар не найден' });

      const token = jwt.sign(
        { userId: row.id, role: 'commissioner' },
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
          role: 'commissioner'
        }
      });
    }
  );
});

// Список учёток директоров (для входа от имени директора из админки)
router.get('/director-accounts', authenticateToken, authorizeRole('admin'), (req, res) => {
  db.all(
    `SELECT u.id, u.fullName, u.phone, u.username, p.name as parkName, p.id as parkId
     FROM users u
     INNER JOIN directors d ON d.userId = u.id
     INNER JOIN parks p ON p.id = d.parkId
     WHERE u.role = 'director'
     ORDER BY p.name COLLATE NOCASE, u.fullName COLLATE NOCASE`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

// Войти от имени директора (короткоживущий токен для просмотра кабинета директора)
router.post('/impersonate/director/:userId', authenticateToken, authorizeRole('admin'), (req, res) => {
  const directorUserId = parseInt(req.params.userId, 10);
  if (!directorUserId) return res.status(400).json({ error: 'Некорректный userId' });
  const parkId = req.body?.parkId != null ? parseInt(req.body.parkId, 10) : null;
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

  const finish = (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Директор не найден' });

    const token = jwt.sign(
      { userId: row.id, role: 'director', parkId: row.parkId },
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
        role: 'director',
        parkId: row.parkId
      }
    });
  };

  // Только связка directors + users по парку (как в GET /parks/:id/directors). Роль в users может расходиться с legacy-данными.
  if (parkId && !Number.isNaN(parkId)) {
    db.get(
      `SELECT u.id, u.username, u.phone, u.fullName, d.parkId
       FROM directors d
       INNER JOIN users u ON u.id = d.userId
       WHERE d.parkId = ? AND d.userId = ?`,
      [parkId, directorUserId],
      finish
    );
  } else {
    db.get(
      `SELECT u.id, u.username, u.phone, u.fullName, d.parkId
       FROM directors d
       INNER JOIN users u ON u.id = d.userId
       WHERE d.userId = ?
       ORDER BY d.parkId ASC
       LIMIT 1`,
      [directorUserId],
      finish
    );
  }
});

// Войти от имени менеджера (сессия ~1 ч; parkId — привязка к конкретному парку)
router.post('/impersonate/manager/:userId', authenticateToken, authorizeRole('admin'), (req, res) => {
  const managerUserId = parseInt(req.params.userId, 10);
  if (!managerUserId) return res.status(400).json({ error: 'Некорректный userId' });
  const parkId = req.body?.parkId != null ? parseInt(req.body.parkId, 10) : null;
  if (!parkId || Number.isNaN(parkId)) {
    return res.status(400).json({ error: 'Требуется parkId' });
  }
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

  db.get(
    `SELECT u.id, u.username, u.phone, u.fullName, m.parkId
     FROM managers m
     INNER JOIN users u ON u.id = m.userId
     WHERE m.parkId = ? AND m.userId = ?`,
    [parkId, managerUserId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Менеджер не найден для этого парка' });

      const token = jwt.sign(
        { userId: row.id, role: 'manager', parkId: row.parkId },
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
          role: 'manager',
          parkId: row.parkId
        }
      });
    }
  );
});

// Привязать/отвязать автомобиль водителю (админ)
router.put('/drivers/:userId/car', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { userId } = req.params;
  const { carId } = req.body;

  // Сначала получаем парк водителя
  db.get('SELECT parkId FROM drivers WHERE userId = ?', [userId], (driverErr, driver) => {
    if (driverErr) return res.status(500).json({ error: driverErr.message });
    if (!driver) return res.status(404).json({ error: 'Водитель не найден' });
    const driverParkId = driver.parkId;

    // Если carId === null, отвязываем авто
    if (carId === null || carId === undefined) {
      db.run(
        'UPDATE drivers SET carId = NULL WHERE userId = ? AND parkId = ?',
        [userId, driverParkId],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          if (this.changes === 0) return res.status(404).json({ error: 'Водитель не найден' });
          res.json({ success: true, message: 'Автомобиль отвязан' });
        }
      );
      return;
    }

    // Проверяем, что автомобиль существует и принадлежит тому же парку
    db.get('SELECT id, parkId FROM cars WHERE id = ?', [carId], (err, car) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!car) return res.status(404).json({ error: 'Автомобиль не найден' });
      if (car.parkId !== driverParkId) {
        return res.status(403).json({ error: 'Автомобиль принадлежит другому парку' });
      }

      // Проверяем, не занят ли автомобиль другим водителем из того же парка
      db.get(
        'SELECT userId FROM drivers WHERE carId = ? AND userId != ? AND parkId = ?',
        [carId, userId, driverParkId],
        (checkErr, occupied) => {
          if (checkErr) return res.status(500).json({ error: checkErr.message });
          
          // Если авто занято другим водителем, отвязываем его от предыдущего водителя
          if (occupied) {
            db.run(
              'UPDATE drivers SET carId = NULL WHERE carId = ? AND userId != ? AND parkId = ?',
              [carId, userId, driverParkId],
              (unbindErr) => {
                if (unbindErr) return res.status(500).json({ error: unbindErr.message });
                // Теперь привязываем авто к новому водителю
                db.run(
                  'UPDATE drivers SET carId = ? WHERE userId = ? AND parkId = ?',
                  [carId, userId, driverParkId],
                  function (updateErr) {
                    if (updateErr) {
                      // Если ошибка из-за UNIQUE constraint, значит авто уже привязано к этому водителю
                      if (updateErr.message.includes('UNIQUE') || updateErr.message.includes('unique')) {
                        return res.status(400).json({ error: 'Автомобиль уже привязан к этому водителю' });
                      }
                      return res.status(500).json({ error: updateErr.message });
                    }
                    if (this.changes === 0) return res.status(404).json({ error: 'Водитель не найден' });
                    res.json({ success: true, message: 'Автомобиль привязан (авто было отвязано от предыдущего водителя)' });
                  }
                );
              }
            );
          } else {
            // Авто свободно, привязываем напрямую
            db.run(
              'UPDATE drivers SET carId = ? WHERE userId = ? AND parkId = ?',
              [carId, userId, driverParkId],
              function (updateErr) {
                if (updateErr) {
                  // Если ошибка из-за UNIQUE constraint, значит авто уже привязано к этому водителю
                  if (updateErr.message.includes('UNIQUE') || updateErr.message.includes('unique')) {
                    return res.status(400).json({ error: 'Автомобиль уже привязан к этому водителю' });
                  }
                  return res.status(500).json({ error: updateErr.message });
                }
                if (this.changes === 0) return res.status(404).json({ error: 'Водитель не найден' });
                res.json({ success: true, message: 'Автомобиль привязан' });
              }
            );
          }
        }
      );
    });
  });
});

// Уволить водителя (отвязать авто, снять верификацию)
router.post('/drivers/:userId/dismiss', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { userId } = req.params;
  // Проверяем, что водитель существует (проверка парка не нужна, т.к. админ может работать с любым парком)
  db.get('SELECT id FROM drivers WHERE userId = ?', [userId], (checkErr, driver) => {
    if (checkErr) return res.status(500).json({ error: checkErr.message });
    if (!driver) return res.status(404).json({ error: 'Водитель не найден' });
    
    db.run(
      'UPDATE drivers SET carId = NULL, isVerified = 0 WHERE userId = ?',
      [userId],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Водитель не найден' });
        res.json({ success: true, message: 'Водитель уволен (авто и верификация сняты)' });
      }
    );
  });
});

// Штраф (списание с баланса водителя)
router.post('/drivers/:userId/fine', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { userId } = req.params;
  const { amount, description = 'Штраф' } = req.body;
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Укажите сумму штрафа больше 0' });
  }
  const num = Number(amount);
  if (isNaN(num)) return res.status(400).json({ error: 'Некорректная сумма' });
  
  // Получаем parkId водителя для передачи в deductBalance
  db.get(
    `SELECT d.parkId FROM drivers d WHERE d.userId = ?`,
    [userId],
    (err, driver) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!driver) return res.status(404).json({ error: 'Водитель не найден' });
      
      // Используем утилиту для списания баланса (с учетом настройки парка)
      deductBalance(
        db,
        userId,
        driver.parkId,
        num,
        description,
        null,
        'expense',
        (req.body && req.body.operationKey) ? String(req.body.operationKey) : `fine:admin:${userId}:${Date.now()}`,
        (err, result) => {
          if (err) {
            return res.status(400).json({ error: err.message });
          }
          res.json({ success: true, message: 'Штраф списан', amount: num });
        }
      );
    }
  );
});

// Удалить водителя из системы (жёсткое удаление пользователя и записи водителя)
// Авто отвязывается (carId обнуляется) и остаётся в парке как свободное
router.delete('/drivers/:userId', authenticateToken, authorizeRole('admin', 'manager'), (req, res) => {
  const { userId } = req.params;
  db.get('SELECT id, carId FROM drivers WHERE userId = ?', [userId], (err, driver) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!driver) return res.status(404).json({ error: 'Водитель не найден' });
    
    const driverId = driver.id;
    
    // 0. Отвязываем авто (обнуляем carId) — авто останется в парке как свободное
    db.run('UPDATE drivers SET carId = NULL WHERE id = ?', [driverId], (unbindErr) => {
      if (unbindErr) console.warn('[Delete Driver] Car unbind warning:', unbindErr.message);
      else if (driver.carId) console.log(`[Delete Driver] Авто id=${driver.carId} отвязано от водителя userId=${userId}`);
    
    // Каскадное удаление связанных записей
    // 1. Закрываем активные смены (не удаляем — для истории)
    db.run(
      `UPDATE shifts SET status = 'closed', closedAt = CURRENT_TIMESTAMP WHERE driverId = ? AND status = 'active'`,
      [userId],
      (shiftErr) => {
        if (shiftErr) console.warn('[Delete Driver] Shifts close warning:', shiftErr.message);
        
        // 2. Помечаем незавершённые ЭПЛ как failed
        db.run(
          `UPDATE epl SET status = 'failed', errorMessage = 'Водитель удалён из системы' WHERE driverId = ? AND status IN (${sqlQuoteList(CLOSE_SHIFT_FAIL_STATUSES)})`,
          [driverId],
          (eplErr) => {
            if (eplErr) console.warn('[Delete Driver] EPL cancel warning:', eplErr.message);
          
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
                      console.log(`[Delete Driver] Водитель userId=${userId} удалён из системы`);
                      res.json({ success: true, message: 'Водитель удалён из системы' });
                    });
                  });
                });
              });
            });
          }
        );
      }
    );
    }); // end unbind car
  });
});

// Получить статистику всех парков
router.get('/statistics', authenticateToken, authorizeRole('admin'), (req, res) => {
  db.all(
    `SELECT 
       p.id, 
       p.name,
       COUNT(DISTINCT d.id) as drivers,
       COUNT(DISTINCT c.id) as cars,
       SUM(COALESCE(d_user.balanceReal,0) + COALESCE(d_user.balanceUnreal,0)) as totalBalance,
       SUM(COALESCE(d_user.balanceReal,0)) as totalBalanceReal,
       SUM(COALESCE(d_user.balanceUnreal,0)) as totalBalanceUnreal
     FROM parks p
     LEFT JOIN drivers d ON p.id = d.parkId
     LEFT JOIN cars c ON p.id = c.parkId
     LEFT JOIN users d_user ON d.userId = d_user.id
     GROUP BY p.id`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(rows);
    }
  );
});

/**
 * Автоматическое создание парка при добавлении бота.
 * API Такском не поддерживает создание парков — создаём только локально.
 * Привязку к автопарку Такском делают в настройках парка (выбор из GET /info carParks).
 */
router.post('/bot/create-park', authenticateToken, authorizeRole('admin'), async (req, res) => {
  try {
    const { name, address, city, phone } = req.body;

    if (!name || !address) {
      return res.status(400).json({ error: 'Park name and address are required' });
    }

    console.log(`[Bot] Creating park locally: ${name}`);

    // Сохраняем парк локально; привязку к Такском — в настройках парка (выбор автопарка из списка)
    db.run(
      `INSERT INTO parks (name, address, city, phone, takskornId, syncedWithTakskom, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        name,
        address,
        city || null,
        phone || null,
        null,
        0
      ],
      function (err) {
        if (err) {
          console.error('[Bot] Local park creation failed:', err.message);
          return res.status(500).json({ 
            error: err.message,
            message: 'Failed to save park to database'
          });
        }

        const localParkId = this.lastID;
        console.log(`✅ [Bot] Park saved locally with ID: ${localParkId}`);

        // Шаг 3: Возвращаем результат
        db.get('SELECT * FROM parks WHERE id = ?', [localParkId], (gerr, park) => {
          if (gerr) {
            return res.status(500).json({ error: gerr.message });
          }

          // Успешный ответ
          res.status(201).json({
            success: true,
            message: 'Парк создан. Привяжите к автопарку Такском в настройках парка (выбор из списка).',
            park: park,
            nextSteps: [
              'В настройках парка выберите автопарк Такском из списка (API не создаёт парки)',
              'Добавьте менеджеров',
              'Менеджеры добавляют машины и водителей',
              'Водители создают ЭПЛ'
            ]
          });
        });
      }
    );
  } catch (e) {
    console.error('[Bot] Unexpected error:', e.message);
    res.status(500).json({ 
      error: e.message,
      message: 'Unexpected error creating park'
    });
  }
});

// Изменить учетные данные менеджера (админ меняет логин/пароль менеджеру)
// Обновить менеджера (ФИО, телефон, пароль)
router.put('/managers/:managerId', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { managerId } = req.params;
  const { fullName, phone, newPassword } = req.body;

  // Получить менеджера
  db.get('SELECT m.userId FROM managers WHERE id = ?', [managerId], (err, manager) => {
    if (err || !manager) {
      return res.status(404).json({ error: 'Manager not found' });
    }

    const updates = [];
    const values = [];

    if (fullName !== undefined) {
      updates.push('fullName = ?');
      values.push(fullName);
    }
    if (phone !== undefined) {
      updates.push('phone = ?');
      values.push(phone);
    }
    if (newPassword) {
      const hashedPassword = require('../auth').hashPassword(newPassword);
      updates.push('password = ?');
      values.push(hashedPassword);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(manager.userId);

    db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values, (upErr) => {
      if (upErr) {
        return res.status(500).json({ error: upErr.message });
      }
      res.json({ success: true, message: 'Менеджер обновлен' });
    });
  });
});

router.put('/managers/:managerId/credentials', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { managerId } = req.params;
  const { newPassword } = req.body;

  if (!newPassword) {
    return res.status(400).json({ error: 'newPassword is required' });
  }

  // Получить менеджера
  db.get('SELECT m.userId FROM managers WHERE id = ?', [managerId], (err, manager) => {
    if (err || !manager) {
      return res.status(404).json({ error: 'Manager not found' });
    }

    // Хешируем новый пароль
    const hashedPassword = require('../auth').hashPassword(newPassword);

    db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, manager.userId], (upErr) => {
      if (upErr) {
        return res.status(500).json({ error: upErr.message });
      }

      db.get('SELECT id, username, phone, role FROM users WHERE id = ?', [manager.userId], (gerr, user) => {
        if (gerr) {
          return res.status(500).json({ error: gerr.message });
        }
        res.json({ success: true, message: 'Password updated', user });
      });
    });
  });
});

// Удалить менеджера и его пользователя
router.delete('/managers/:managerId', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { managerId } = req.params;

  // Получить userId менеджера
  db.get('SELECT userId, parkId FROM managers WHERE id = ?', [managerId], (err, manager) => {
    if (err || !manager) {
      return res.status(404).json({ error: 'Manager not found' });
    }

    // Удаляем менеджера из таблицы managers
    db.run('DELETE FROM managers WHERE id = ?', [managerId], (delErr) => {
      if (delErr) {
        return res.status(500).json({ error: delErr.message });
      }

      // Удаляем пользователя
      db.run('DELETE FROM users WHERE id = ?', [manager.userId], (userDelErr) => {
        if (userDelErr) {
          return res.status(500).json({ error: userDelErr.message });
        }

        res.json({ success: true, message: 'Manager and user deleted' });
      });
    });
  });
});

// ===== АВТОМОБИЛИ (для админа) =====

// Получить информацию об автомобиле
router.get('/cars/:carId', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { carId } = req.params;
  db.get(
    `SELECT c.*, d.id as driverId, d.userId, u.fullName as driverName
     FROM cars c
     LEFT JOIN drivers d ON d.carId = c.id
     LEFT JOIN users u ON d.userId = u.id
     WHERE c.id = ?`,
    [carId],
    (err, car) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!car) return res.status(404).json({ error: 'Автомобиль не найден' });
      res.json(car);
    }
  );
});

// Обновить автомобиль
router.put('/cars/:carId', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { carId } = req.params;
  const { regNumber, brand, model, vin, fuelType, tankVolume, seasonality, fuelUnit, inventoryNumber, vehicleType, ownerId } = req.body;

  db.run(
    `UPDATE cars SET 
      regNumber = COALESCE(?, regNumber), 
      brand = COALESCE(?, brand), 
      model = ?,
      vin = ?, 
      fuelType = ?, 
      tankVolume = ?, 
      seasonality = ?, 
      fuelUnit = ?,
      inventoryNumber = ?,
      vehicleType = ?,
      ownerId = ?,
      updatedAt = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [regNumber, brand, model, vin || null, fuelType || null, tankVolume || null, seasonality || null, fuelUnit || null, inventoryNumber || null, vehicleType || null, ownerId || null, carId],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Автомобиль не найден' });
      res.json({ success: true, message: 'Автомобиль обновлен' });
    }
  );
});

// Удалить автомобиль
router.delete('/cars/:carId', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { carId } = req.params;
  db.run('DELETE FROM cars WHERE id = ?', [carId], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Автомобиль не найден' });
    res.json({ success: true, message: 'Автомобиль удален' });
  });
});

// Создать автомобиль
router.post('/parks/:parkId/cars', authenticateToken, authorizeRole('admin'), (req, res) => {
  const { parkId } = req.params;
  const { regNumber, brand, model, vin, fuelType, tankVolume, seasonality, fuelUnit, inventoryNumber: invNum, vehicleType, ownerId } = req.body;

  if (!regNumber || !brand) {
    return res.status(400).json({ error: 'Номер и марка обязательны' });
  }

  const inventoryNumber = invNum || `INV-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

  const ownerIdFinal = ownerId || null;

  const insertCar = () => {
    db.run(
      `INSERT INTO cars (parkId, regNumber, brand, model, vin, inventoryNumber, 
                       fuelType, tankVolume, seasonality, fuelUnit, vehicleType, ownerId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        parkId, regNumber, brand, model || null, vin || null, inventoryNumber,
        fuelType || 'Бензин', tankVolume || null, seasonality || 'Круглогодичная', fuelUnit || 'Литр', vehicleType || null,
        ownerIdFinal
      ],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({
          id: this.lastID,
          parkId,
          regNumber,
          brand,
          model,
          vin,
          inventoryNumber,
          fuelType: fuelType || 'Бензин',
          tankVolume: tankVolume || null,
          seasonality: seasonality || 'Круглогодичная',
          fuelUnit: fuelUnit || 'Литр',
          vehicleType: vehicleType || null,
          ownerId: ownerIdFinal,
          message: 'Автомобиль создан'
        });
      }
    );
  };

  if (ownerIdFinal) {
    db.get('SELECT id FROM park_owners WHERE id = ? AND parkId = ?', [ownerIdFinal, parkId], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(400).json({ error: 'Владелец не найден в этом парке' });
      insertCar();
    });
  } else {
    insertCar();
  }
});

// ===== Справочник «магазины» / точки выгрузки парка (грузовые маршруты) =====

router.get('/parks/:parkId/freight-stores', authenticateToken, authorizeRole('admin'), (req, res) => {
  const parkId = parseInt(req.params.parkId, 10);
  if (!parkId) return res.status(400).json({ error: 'Некорректный parkId' });
  db.all(
    `SELECT id, parkId, name, addressText, contactNote, sortOrder, isActive, createdAt
     FROM park_freight_stores WHERE parkId = ? ORDER BY sortOrder ASC, id ASC`,
    [parkId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

router.post('/parks/:parkId/freight-stores', authenticateToken, authorizeRole('admin'), (req, res) => {
  const parkId = parseInt(req.params.parkId, 10);
  if (!parkId) return res.status(400).json({ error: 'Некорректный parkId' });
  const { name, addressText, contactNote, sortOrder, isActive } = req.body || {};
  const n = String(name || '').trim();
  const a = String(addressText || '').trim();
  if (!n || !a) return res.status(400).json({ error: 'Укажите название и адрес (одной строкой для Такском)' });
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

router.put('/parks/:parkId/freight-stores/:storeId', authenticateToken, authorizeRole('admin'), (req, res) => {
  const parkId = parseInt(req.params.parkId, 10);
  const storeId = parseInt(req.params.storeId, 10);
  if (!parkId || !storeId) return res.status(400).json({ error: 'Некорректные идентификаторы' });
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

router.delete('/parks/:parkId/freight-stores/:storeId', authenticateToken, authorizeRole('admin'), (req, res) => {
  const parkId = parseInt(req.params.parkId, 10);
  const storeId = parseInt(req.params.storeId, 10);
  if (!parkId || !storeId) return res.status(400).json({ error: 'Некорректные идентификаторы' });
  db.run(`DELETE FROM park_freight_stores WHERE id = ? AND parkId = ?`, [storeId, parkId], function (dErr) {
    if (dErr) return res.status(500).json({ error: dErr.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Запись не найдена' });
    res.json({ success: true });
  });
});

module.exports = router;
