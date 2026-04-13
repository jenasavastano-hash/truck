/**
 * API для программы на ПК клиники: заявки на создание ЭПЛ (pending_clinic) и отчёт о создании.
 * Авторизация: Bearer CLINIC_API_KEY или SIGNER_API_KEY.
 */

const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const router = express.Router();
const db = require('../database');
const TakskornAPI = require('../takskom-api');
const { deductBalance } = require('../utils/balance');
const { ensureShiftExistsForEpl } = require('../utils/shifts');
const { DOC_POLLABLE, sqlQuoteList } = require('../utils/epl-status');
const {
  normalizeCommercialShippingType,
  getCommercialShippingTaxcomLabel,
} = require('../utils/commercialShippingTypes');
const { publicAppUrl } = require('../utils/publicAppUrl');

const PUBLIC_APP_URL = publicAppUrl();

const CLINIC_API_KEY = process.env.CLINIC_API_KEY || process.env.SIGNER_API_KEY || '';

function parseFreightUnloadJson(s) {
  if (!s || typeof s !== 'string') return [];
  try {
    const j = JSON.parse(s);
    return Array.isArray(j) ? j.map((x) => String(x).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function formatTimeMsk() {
  return new Date().toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }) + ' (МСК)';
}

function requireClinicKey(req, res, next) {
  if (!CLINIC_API_KEY) {
    return res.status(503).json({ error: 'CLINIC_API_KEY или SIGNER_API_KEY не задан в .env' });
  }
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim();
  if (token !== CLINIC_API_KEY) {
    return res.status(401).json({ error: 'Неверный или отсутствующий ключ' });
  }
  next();
}

router.use(requireClinicKey);

/**
 * POST /api/clinic/heartbeat
 * Воркер ЭПЛ шлёт heartbeat для мониторинга 24/7. Тело: { source?, uptimeMin?, ticks?, lastError? }
 */
router.post('/heartbeat', (req, res) => {
  const { source = 'epl_production_worker', uptimeMin, ticks, lastError } = req.body || {};
  const src = String(source).trim() || 'epl_production_worker';
  db.run(
    `INSERT INTO worker_heartbeats (source, uptimeMin, ticks, lastError, lastSeen) VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(source) DO UPDATE SET uptimeMin = excluded.uptimeMin, ticks = excluded.ticks, lastError = excluded.lastError, lastSeen = datetime('now')`,
    [src, uptimeMin != null ? parseInt(uptimeMin, 10) : null, ticks != null ? parseInt(ticks, 10) : null, lastError || null],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ ok: true, source: src });
    }
  );
});

/**
 * GET /api/clinic/pending-creation
 * Список ЭПЛ для конвейера: pending_clinic (ещё без mintransId) и pending (уже созданы в Такском, титулы Т2–Т4).
 * После epl-created статус становится 'pending' — медик и механик должны продолжать видеть заявку по titulStatus.
 * Query: since — ISO-дата; только ЭПЛ, созданные после этой даты.
 */
router.get('/pending-creation', (req, res) => {
  const since = (req.query.since || '').trim();
  let sql = `SELECT e.id as eplId, e.waybillNumber, e.startOdometer, e.mintransId, e.parkId, e.driverId, e.carId, e.createdAt,
     e.commercialShippingType,
     e.freightOriginAddress, e.freightLoadAddress, e.freightUnloadAddresses,
     pk.freightAddressEntryMode as parkFreightAddressEntryMode
     FROM epl e
     JOIN parks pk ON pk.id = e.parkId
     WHERE e.status IN ('pending_clinic', 'pending')
     AND (pk.eplPrintMode IS NULL OR pk.eplPrintMode != 'our_only')`;
  const params = [];
  if (since) {
    sql += ` AND e.createdAt >= ?`;
    params.push(since);
  }
  sql += ` ORDER BY e.createdAt ASC`;

  db.all(sql, params,
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!rows || rows.length === 0) {
        return res.json({ items: [] });
      }

      const driverIds = [...new Set(rows.map((r) => r.driverId))];
      const placeholders = driverIds.map(() => '?').join(',');
      db.all(
        `SELECT
           u.id as userId, u.fullName, u.firstName, u.lastName, u.secondName, u.phone, u.personnelNumber, u.inn,
           u.licenseSerial, u.licenseNumber, u.licenseDate,
           d.id as driverId, d.carId, d.license,
           c.regNumber, c.vin, c.brand, c.model, c.inventoryNumber, c.vehicleType,
           c.ownerId,
           po.type as ownerType, po.role as ownerRole, po.name as ownerName,
           po.inn as ownerInn, po.ogrn as ownerOgrn, po.ogrnip as ownerOgrnip, po.kpp as ownerKpp,
           po.phone as ownerPhone, po.email as ownerEmail,
           po.postalIndex as ownerPostalIndex, po.regionCode as ownerRegionCode,
           po.district as ownerDistrict, po.city as ownerCity, po.locality as ownerLocality,
           po.street as ownerStreet, po.house as ownerHouse, po.housing as ownerHousing, po.flat as ownerFlat,
           p.id as parkId, p.name as parkName, p.address as parkAddress,
           p.postalIndex as parkPostalIndex, p.region as parkRegion, p.regionCode as parkRegionCode,
           p.city as parkCity, p.street as parkStreet, p.house as parkHouse,
           p.ogrn as parkOgrn, p.inn as parkInn, p.kpp as parkKpp,
           p.phone as parkPhone, p.email as parkEmail,
           p.district as parkDistrict, p.locality as parkLocality, p.housing as parkHousing, p.flat as parkFlat,
           p.takskornId
         FROM drivers d
         JOIN users u ON u.id = d.userId
         LEFT JOIN cars c ON d.carId = c.id AND c.parkId = d.parkId
         LEFT JOIN park_owners po ON po.id = c.ownerId AND po.parkId = d.parkId
         LEFT JOIN parks p ON d.parkId = p.id
         WHERE d.id IN (${placeholders})`,
        driverIds,
        (err2, driversRows) => {
          if (err2) {
            return res.status(500).json({ error: err2.message });
          }
          const driversByKey = {};
          (driversRows || []).forEach((r) => {
              driversByKey[r.driverId] = {
              userId: r.userId,
              fullName: r.fullName,
              firstName: r.firstName,
              lastName: r.lastName,
              secondName: r.secondName,
              phone: r.phone || '',
              personnelNumber: r.personnelNumber,
              inn: r.inn || '',
              licenseSerial: r.licenseSerial,
              licenseNumber: r.licenseNumber,
              licenseDate: r.licenseDate,
              license: [r.licenseSerial, r.licenseNumber].filter(Boolean).join(' '),
              driverId: r.driverId,
              carId: r.carId,
              regNumber: r.regNumber,
              vin: r.vin,
              brand: r.brand,
              model: r.model,
              inventoryNumber: r.inventoryNumber,
              vehicleType: r.vehicleType,
              ownerId: r.ownerId,
              owner: r.ownerId
                ? {
                    id: r.ownerId,
                    type: r.ownerType,
                    role: r.ownerRole,
                    name: r.ownerName,
                    inn: r.ownerInn,
                    ogrn: r.ownerOgrn,
                    ogrnip: r.ownerOgrnip,
                    kpp: r.ownerKpp,
                    phone: r.ownerPhone,
                    email: r.ownerEmail,
                    postalIndex: r.ownerPostalIndex,
                    regionCode: r.ownerRegionCode,
                    district: r.ownerDistrict,
                    city: r.ownerCity,
                    locality: r.ownerLocality,
                    street: r.ownerStreet,
                    house: r.ownerHouse,
                    housing: r.ownerHousing,
                    flat: r.ownerFlat
                  }
                : null,
              parkId: r.parkId,
              parkName: r.parkName,
              parkAddress: r.parkAddress,
              parkPostalIndex: r.parkPostalIndex,
              parkRegion: r.parkRegion,
              parkRegionCode: r.parkRegionCode,
              parkCity: r.parkCity,
              parkStreet: r.parkStreet,
              parkHouse: r.parkHouse,
              parkOgrn: r.parkOgrn,
              parkInn: r.parkInn,
              parkKpp: r.parkKpp,
              parkPhone: r.parkPhone,
              parkEmail: r.parkEmail,
              parkDistrict: r.parkDistrict,
              parkLocality: r.parkLocality,
              parkHousing: r.parkHousing,
              parkFlat: r.parkFlat,
              takskornId: r.takskornId
            };
          });

          // Fallback: если у авто нет владельца — подставляем default owner парка
          const driversNeedOwner = rows.filter(r => {
            const d = driversByKey[r.driverId];
            return d && !d.owner && r.parkId;
          });
          const ownerFallbackPromise = driversNeedOwner.length > 0
            ? new Promise((resolve) => {
                const pIds = [...new Set(driversNeedOwner.map(r => r.parkId))];
                const ph = pIds.map(() => '?').join(',');
                db.all(
                  `SELECT * FROM park_owners WHERE parkId IN (${ph}) AND isDefault = 1`,
                  pIds,
                  (oErr, defaultOwners) => {
                    if (oErr || !defaultOwners) return resolve({});
                    const map = {};
                    defaultOwners.forEach(o => { map[o.parkId] = o; });
                    resolve(map);
                  }
                );
              })
            : Promise.resolve({});

          ownerFallbackPromise.then((defaultOwnerMap) => {
            rows.forEach(r => {
              const d = driversByKey[r.driverId];
              if (d && !d.owner && r.parkId && defaultOwnerMap[r.parkId]) {
                const o = defaultOwnerMap[r.parkId];
                d.ownerId = o.id;
                d.owner = {
                  id: o.id, type: o.type, role: o.role, name: o.name,
                  inn: o.inn, ogrn: o.ogrn, ogrnip: o.ogrnip, kpp: o.kpp,
                  phone: o.phone, email: o.email,
                  postalIndex: o.postalIndex, regionCode: o.regionCode,
                  district: o.district, city: o.city, locality: o.locality,
                  street: o.street, house: o.house, housing: o.housing, flat: o.flat
                };
              }
            });

          const parkIds = [...new Set(rows.map((r) => r.parkId))];
          const parkPlaceholders = parkIds.map(() => '?').join(',');
          db.all(
            `SELECT parkId, role, fullName, position, taxcomLogin, taxcomPassword
             FROM park_staff
             WHERE parkId IN (${parkPlaceholders})`,
            parkIds,
            (err3, staffRows) => {
              if (err3) {
                return res.status(500).json({ error: err3.message });
              }
              const staffByPark = {};
              parkIds.forEach((pid) => {
                staffByPark[pid] = { medic: null, technic: null, dispatcher: null };
              });
              (staffRows || []).forEach((s) => {
                const key = s.role === 'technic' ? 'technic' : s.role;
                if (staffByPark[s.parkId]) {
                  staffByPark[s.parkId][key] = {
                    fullName: s.fullName,
                    position: s.position,
                    taxcomLogin: s.taxcomLogin || null,
                    taxcomPassword: s.taxcomPassword || null,
                  };
                }
              });

              // Прогресс титулов (для resume при сбое)
              const eplIds = rows.map((r) => r.eplId);
              const titlesPlaceholders = eplIds.map(() => '?').join(',');
              db.all(
                `SELECT eplId, titleCode, status FROM epl_titles WHERE eplId IN (${titlesPlaceholders}) AND titleCode IN ('t1','t2','t3','t4')`,
                eplIds,
                (tErr, titlesRows) => {
                  const titulByEpl = {};
                  (titlesRows || []).forEach((t) => {
                    if (!titulByEpl[t.eplId]) titulByEpl[t.eplId] = { t1: null, t2: null, t3: null, t4: null };
                    titulByEpl[t.eplId]['t' + t.titleCode.charAt(1)] = t.status === 'signed' ? 'signed' : t.status;
                  });
                  const items = rows.map((e) => {
                    const driver = driversByKey[e.driverId];
                    const staff = staffByPark[e.parkId] || {};
                    const titulStatus = titulByEpl[e.eplId] || { t1: null, t2: null, t3: null, t4: null };
                    return {
                      eplId: e.eplId,
                      waybillNumber: e.waybillNumber,
                      startOdometer: e.startOdometer ?? 0,
                      mintransId: e.mintransId || null,
                      titulStatus,
                      createdAt: e.createdAt || null,
                      commercialShippingType: normalizeCommercialShippingType(e.commercialShippingType),
                      commercialShippingTaxcomLabel: getCommercialShippingTaxcomLabel(e.commercialShippingType),
                      freightAddressEntryMode: e.parkFreightAddressEntryMode === 'driver' ? 'driver' : 'manager',
                      freightAddresses: {
                        originAddress: e.freightOriginAddress || null,
                        loadAddress: e.freightLoadAddress || null,
                        unloadAddresses: parseFreightUnloadJson(e.freightUnloadAddresses),
                      },
                      driver: driver || null,
                      staff
                    };
                  }).filter((i) => i.driver).filter((i) => {
                    const t = i.titulStatus || {};
                    const allSigned = t.t1 === 'signed' && t.t2 === 'signed' && t.t3 === 'signed' && t.t4 === 'signed';
                    return !allSigned;
                  });

                  return res.json({ items });
                }
              );
            }
          );
          }); // ownerFallbackPromise.then end
        }
      );
    }
  );
});

/**
 * POST /api/clinic/titul-progress
 * Сохранение прогресса титулов при создании ЭПЛ в Такском — чтобы при сбое продолжить с места остановки.
 * Тело: { eplId, mintransId?, titul: 't1'|'t2'|'t3'|'t4', status: 'filled'|'signed' }
 * mintransId — сохраняется в epl при первом вызове (после сохранения Т1 в Такском).
 */
router.post('/titul-progress', (req, res) => {
  const { eplId, mintransId, titul, status } = req.body || {};
  if (!eplId || !titul || !['t1', 't2', 't3', 't4'].includes(titul) || !['filled', 'signed'].includes(status)) {
    return res.status(400).json({ error: 'Нужны eplId, titul (t1-t4), status (filled|signed)' });
  }

  const doUpsert = () => {
    // Один upsert — без race при параллельных запросах
    db.run(
      `INSERT INTO epl_titles (eplId, titleCode, status) VALUES (?, ?, ?)
       ON CONFLICT(eplId, titleCode) DO UPDATE SET status = excluded.status, updatedAt = CURRENT_TIMESTAMP`,
      [eplId, titul, status],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        console.log(`[Clinic] titul-progress: eplId=${eplId} ${titul}=${status}`);
        res.json({ success: true, eplId, titul, status });
      }
    );
  };

  // mintransId в epl выставляем только когда Т1 подписан — чтобы медик не видел заявку до подписания Т1
  const mintransVal = mintransId && String(mintransId).trim();
  const shouldSetMintransId = mintransVal && titul === 't1' && status === 'signed';
  if (shouldSetMintransId) {
    db.run(
      `UPDATE epl SET mintransId = ? WHERE id = ? AND (mintransId IS NULL OR mintransId = '')`,
      [mintransVal, eplId],
      function (err) {
        if (err) {
          if (err.message && err.message.includes('UNIQUE') && err.message.includes('mintransId')) {
            db.get('SELECT id FROM epl WHERE mintransId = ? AND id != ?', [mintransVal, eplId], (e, row) => {
              if (!e && row) {
                console.warn(`[Clinic] titul-progress: mintransId ${mintransVal} уже у ЭПЛ ${row.id}, текущий eplId=${eplId} — пропускаю обновление mintransId, сохраняю прогресс титула`);
              }
              doUpsert();
            });
            return;
          }
          return res.status(500).json({ error: err.message });
        }
        if (this.changes > 0) console.log(`[Clinic] mintransId сохранён для eplId=${eplId} (после подписания Т1): ${mintransId}`);
        doUpsert();
      }
    );
  } else {
    doUpsert();
  }
});

/**
 * POST /api/clinic/epl-created
 * Тело: { eplId, mintransId, eplGuid?, qrCode?, documentPdf? } — documentPdf: base64 PDF, скачанный в signer-client с epl.taxcom.ru
 */
router.post('/epl-created', (req, res) => {
  const { eplId, mintransId, eplGuid, qrCode, documentPdf } = req.body || {};
  console.log(`[Clinic] POST /epl-created: eplId=${eplId}, mintransId=${mintransId}, documentPdf=${documentPdf ? `present (${documentPdf.length} chars)` : 'absent'}, qrCode=${qrCode ? 'present' : 'absent'}`);
  if (!eplId || !mintransId) {
    return res.status(400).json({ error: 'Нужны eplId и mintransId' });
  }

  const doUpdate = (sql, vals, cb) => {
    db.run(sql, vals, function (err) {
      if (err) {
        if (err.message && err.message.includes('UNIQUE') && err.message.includes('mintransId')) {
          db.get('SELECT id FROM epl WHERE mintransId = ? AND id != ?', [mintransId, eplId], (e, row) => {
            if (row) {
              console.warn(`[Clinic] mintransId ${mintransId} уже у ЭПЛ ${row.id}, текущий eplId=${eplId} — дубликат, помечаем как pending без mintransId`);
              const errorMsg = `Дубликат: mintransId уже у ЭПЛ ${row.id}`;
              db.run(
                `UPDATE epl SET eplGuid = ?, status = 'failed', errorMessage = ? WHERE id = ? AND status = 'pending_clinic'`,
                [eplGuid || null, errorMsg, eplId],
                function (upErr) {
                  if (upErr) return res.status(500).json({ error: upErr.message });
                  // Уведомляем водителя — смена не открылась из-за дубликата
                  db.get(
                    `SELECT d.userId FROM epl e JOIN drivers d ON e.driverId = d.id WHERE e.id = ?`,
                    [eplId],
                    (_, dRow) => {
                      if (dRow && dRow.userId) {
                        db.run(
                          `INSERT INTO notifications (userId, type, title, body, eplId) VALUES (?, ?, ?, ?, ?)`,
                          [dRow.userId, 'auto_closed', 'Смена не открыта', `Ошибка регистрации ЭПЛ: путевой с таким номером уже существует (ЭПЛ ${row.id}). Обратитесь к менеджеру.`, eplId],
                          () => {}
                        );
                      }
                    }
                  );
                  res.json({ success: true, eplId, mintransId, duplicate: true });
                }
              );
            } else {
              return res.status(500).json({ error: err.message });
            }
          });
        } else {
          return res.status(500).json({ error: err.message });
        }
        return;
      }
      cb.call(this);
    });
  };

  const setPdf = documentPdf ? ', documentPdf = ?, documentPdfReceivedAt = CURRENT_TIMESTAMP' : '';
  const values = [mintransId, eplGuid || null, qrCode ? 'approved' : 'pending'];
  if (qrCode) values.push(qrCode);
  if (documentPdf) values.push(documentPdf);
  values.push(eplId);

  doUpdate(
    `UPDATE epl SET mintransId = ?, eplGuid = ?, status = ?, errorMessage = NULL, mintransCreatedAt = CURRENT_TIMESTAMP ${qrCode ? ', qrCode = ?, approvedAt = CURRENT_TIMESTAMP' : ''} ${setPdf} WHERE id = ? AND status = 'pending_clinic'`,
    values,
    function () {
      if (this.changes > 0) {
        return afterEplCreated();
      }
      if (!documentPdf && !qrCode) {
        return res.status(404).json({ error: 'ЭПЛ не найден или уже обработан' });
      }
      return updateDocumentForPending();
    }
  );

  function afterEplCreated() {
      ['t1', 't2', 't3', 't4'].forEach((code) => {
        db.run(
          `INSERT OR IGNORE INTO epl_titles (eplId, titleCode, status) VALUES (?, ?, 'filled')`,
          [eplId, code],
          () => {}
        );
      });

      // Смена и списание — только от отрисовки (fast-epl-pdf). Клиника лишь загружает офф. документ/QR.

      console.log(`[Clinic] EPL ${eplId} отмечен созданным, mintransId: ${mintransId}${qrCode ? ', QR передан' : ''}${documentPdf ? ', PDF сохранён' : ''}`);
      res.json({ success: true, eplId, mintransId });

      // QR на PDF: после загрузки PDF генерируем ссылку и QR, ведущий на документ
      if (documentPdf) {
        console.log(`[Clinic] EPL ${eplId}: начинаю генерацию QR на PDF, PUBLIC_APP_URL=${PUBLIC_APP_URL}, documentPdf длина=${documentPdf.length}`);
        const documentToken = crypto.randomBytes(24).toString('hex');
        const documentUrl = `${PUBLIC_APP_URL}/api/public/epl-document/${eplId}?token=${documentToken}`;
        console.log(`[Clinic] EPL ${eplId}: documentUrl=${documentUrl}`);
        QRCode.toDataURL(documentUrl, { margin: 2, width: 400 }, (qrErr, dataUrl) => {
          if (qrErr) {
            console.error(`[Clinic] EPL ${eplId}: ОШИБКА генерации QR на PDF:`, qrErr.message, qrErr.stack);
            return;
          }
          if (!dataUrl || !dataUrl.startsWith('data:image')) {
            console.error(`[Clinic] EPL ${eplId}: QR сгенерирован, но неверный формат:`, typeof dataUrl, dataUrl?.substring(0, 50));
            return;
          }
          console.log(`[Clinic] EPL ${eplId}: QR сгенерирован успешно, длина dataUrl=${dataUrl.length}, сохраняю в БД...`);
          db.run('UPDATE epl SET documentToken = ?, documentQr = ? WHERE id = ?', [documentToken, dataUrl, eplId], function(upErr) {
            if (upErr) {
              console.error(`[Clinic] EPL ${eplId}: ОШИБКА сохранения documentQr:`, upErr.message);
            } else {
              console.log(`[Clinic] EPL ${eplId}: ✅ QR на PDF успешно сохранён (documentToken=${documentToken.substring(0, 8)}..., documentQr длина=${dataUrl.length}, изменено строк=${this.changes})`);
            }
          });
        });
      } else {
        console.log(`[Clinic] EPL ${eplId}: documentPdf отсутствует, QR на PDF не генерирую`);
      }

      if (qrCode) return;

      // Один запрос QR по API Такском через 3 мин — сразу после подписания документ в ГИС ещё не готов (400 DOCUMENT_NOT_FOUND)
      setImmediate(() => {
        db.get(
          `SELECT e.waybillNumber, e.eplGuid, e.mintransId, d.userId FROM epl e JOIN drivers d ON e.driverId = d.id WHERE e.id = ?`,
          [eplId],
          (err, row) => {
            if (err) {
              console.warn('[Clinic] epl-created: не удалось выбрать EPL для отложенного QR:', err.message);
              return;
            }
            if (!row || !row.waybillNumber) {
              console.warn('[Clinic] epl-created: EPL', eplId, 'не найден или нет waybillNumber, отложенный QR не запланирован');
              return;
            }
            const { waybillNumber, eplGuid: rowGuid, mintransId: rowMintrans, userId } = row;
            const THREE_MIN_MS = 3 * 60 * 1000;
            console.log(`[Clinic] Запрос QR для EPL ${eplId} (${waybillNumber}) через 3 мин...`);
            setTimeout(() => {
              TakskornAPI.getQRByWaybillNumber(waybillNumber)
                .then((qrRes) => {
                  if (qrRes.success && qrRes.qr) {
                    const updateData = { qrCode: qrRes.qr, status: 'approved' };
                    if (qrRes.eplGuid && !rowGuid) updateData.eplGuid = qrRes.eplGuid;
                    if (qrRes.mintransId && !rowMintrans) updateData.mintransId = qrRes.mintransId;
                    const updateSql = Object.keys(updateData).map(k => `${k} = ?`).join(', ');
                    const updateValues = [...Object.values(updateData), eplId];
                    db.run(`UPDATE epl SET ${updateSql} WHERE id = ?`, updateValues, () => {});
                    db.run(
                      'INSERT INTO notifications (userId, type, title, body, eplId) VALUES (?, ?, ?, ?, ?)',
                      [userId, 'epl_ready', 'Путевой лист готов', `Откройте карточку путевого — QR-код готов. ${formatTimeMsk()}`, eplId],
                      () => {}
                    );
                    console.log(`[Clinic] QR получен по API для EPL ${eplId}, водителю ${userId} уведомление.`);
                  } else {
                    console.warn(`[Clinic] QR для ${waybillNumber} не вернулся (пустой ответ).`);
                  }
                })
                .catch((e) => {
                  console.warn(`[Clinic] QR по API для ${waybillNumber}:`, e.response?.data?.errors?.[0]?.message || e.message);
                });
            }, THREE_MIN_MS);
          }
        );
      });
  }

  function updateDocumentForPending() {
    db.get("SELECT id, documentPdfReceivedAt, approvedAt, qrCode FROM epl WHERE id = ?", [eplId], (preErr, preRow) => {
      if (preErr) return res.status(500).json({ error: preErr.message });
      if (!preRow) return res.status(404).json({ error: 'ЭПЛ не найден' });
      const sets = [];
      const vals = [];
      // Реальный PDF от Такском всегда перезаписывает (в т.ч. предварительный fast PDF).
      // documentPdfReceivedAt обновляем только при первой установке PDF — чтобы 12 ч смены не сбрасывались при замене на оффициалку.
      if (documentPdf) {
        sets.push('documentPdf = ?');
        vals.push(documentPdf);
        if (!preRow.documentPdfReceivedAt) {
          sets.push("documentPdfReceivedAt = datetime('now')");
        }
      }
      if (qrCode) {
        sets.push('qrCode = ?', 'status = ?', "approvedAt = COALESCE(approvedAt, datetime('now'))");
        vals.push(qrCode, 'approved');
      }
      if (sets.length === 0) return res.status(400).json({ error: 'Нужны documentPdf или qrCode для обновления' });
      vals.push(eplId);
      const isRefetch = (documentPdf && preRow.documentPdfReceivedAt) || (qrCode && preRow.approvedAt) || (preRow.qrCode == null || preRow.qrCode === '');
      const whereClause = isRefetch ? 'id = ?' : `id = ? AND status IN (${sqlQuoteList(DOC_POLLABLE)})`;
      db.run(
        `UPDATE epl SET ${sets.join(', ')} WHERE ${whereClause}`,
        vals,
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          if (this.changes === 0) return res.status(404).json({ error: 'ЭПЛ не найден или уже обработан' });
          const actuallyWrotePdf = !!documentPdf;
          console.log(`[Clinic] EPL ${eplId}: документ/QR обновлён${isRefetch ? ' (перезалив/замена fast PDF)' : ''}${actuallyWrotePdf ? ', PDF' : ''}${qrCode ? ', QR' : ''}.`);

          // Если появились якорные тайм-метки (PDF/QR), но shifts вдруг отсутствует — гарантируем запись.
          // НЕ списывает деньги и НЕ переоткрывает закрытую смену, только создаёт отсутствующую.
          const anchored = (actuallyWrotePdf && !preRow.documentPdfReceivedAt) || (qrCode && !preRow.approvedAt);
          if (anchored) {
            ensureShiftExistsForEpl(eplId, () => {});
          }
          
          // Генерация QR на PDF если PDF был загружен (в updateDocumentForPending)
          // Также проверяем: если PDF уже был, но documentQr отсутствует - создаём его
          db.get('SELECT documentPdf, documentQr FROM epl WHERE id = ?', [eplId], (checkErr, checkRow) => {
            if (checkErr) {
              console.warn('[Clinic] Ошибка проверки documentQr:', checkErr.message);
              return;
            }
            const hasPdf = checkRow && checkRow.documentPdf && checkRow.documentPdf.length > 0;
            const needsQr = hasPdf && (!checkRow.documentQr || !checkRow.documentQr.trim());
            if (actuallyWrotePdf || needsQr) {
              console.log(`[Clinic] EPL ${eplId}: ${actuallyWrotePdf ? 'PDF загружен, генерирую QR' : 'PDF уже есть, но documentQr отсутствует, создаю QR'}, PUBLIC_APP_URL=${PUBLIC_APP_URL}`);
              const documentToken = crypto.randomBytes(24).toString('hex');
              const documentUrl = `${PUBLIC_APP_URL}/api/public/epl-document/${eplId}?token=${documentToken}`;
              console.log(`[Clinic] EPL ${eplId}: documentUrl=${documentUrl}`);
              QRCode.toDataURL(documentUrl, { margin: 2, width: 400 }, (qrErr, dataUrl) => {
                if (qrErr) {
                  console.error(`[Clinic] EPL ${eplId}: ОШИБКА генерации QR на PDF (updateDocumentForPending):`, qrErr.message);
                  return;
                }
                if (!dataUrl || !dataUrl.startsWith('data:image')) {
                  console.error(`[Clinic] EPL ${eplId}: QR сгенерирован, но неверный формат (updateDocumentForPending):`, typeof dataUrl);
                  return;
                }
                console.log(`[Clinic] EPL ${eplId}: QR сгенерирован успешно (updateDocumentForPending), длина=${dataUrl.length}, сохраняю...`);
                db.run('UPDATE epl SET documentToken = ?, documentQr = ? WHERE id = ?', [documentToken, dataUrl, eplId], function(upErr) {
                  if (upErr) {
                    console.error(`[Clinic] EPL ${eplId}: ОШИБКА сохранения documentQr (updateDocumentForPending):`, upErr.message);
                  } else {
                    console.log(`[Clinic] EPL ${eplId}: ✅ QR на PDF успешно сохранён (updateDocumentForPending), изменено строк=${this.changes}`);
                  }
                });
              });
            }
          });
          
          // Смена только от отрисовки (fast-epl-pdf). Здесь только обновление документа и уведомления.
          if (qrCode && !isRefetch) {
            db.get('SELECT d.userId FROM drivers d JOIN epl e ON e.driverId = d.id WHERE e.id = ?', [eplId], (e, r) => {
              if (!e && r && r.userId) {
                db.run(
                  'INSERT INTO notifications (userId, type, title, body, eplId) VALUES (?, ?, ?, ?, ?)',
                  [r.userId, 'epl_ready', 'Путевой лист готов', `Откройте карточку путевого — QR-код готов. ${formatTimeMsk()}`, eplId],
                  () => {}
                );
              }
            });
          }
          if (!qrCode) scheduleQrPollByWaybill(eplId);
          res.json({ success: true, eplId, mintransId });
        }
      );
    });
  }

  function scheduleQrPollByWaybill(eplId) {
    db.get("SELECT e.waybillNumber, d.userId FROM epl e JOIN drivers d ON e.driverId = d.id WHERE e.id = ? AND (e.qrCode IS NULL OR e.qrCode = '')", [eplId], (err, row) => {
      if (err || !row || !row.waybillNumber) return;
      const waybillNumber = row.waybillNumber;
      const userId = row.userId;
      const maxAttempts = 10;
      const intervalMs = 60000; // повторные попытки раз в минуту
      const firstDelayMs = 60000; // первый запрос QR — через минуту после загрузки PDF
      let attempts = 0;
      const tryQr = () => {
        attempts++;
        TakskornAPI.getQRByWaybillNumber(waybillNumber)
          .then((qrRes) => {
            if (qrRes.success && qrRes.qr) {
              db.run("UPDATE epl SET qrCode = ?, status = 'approved', approvedAt = CURRENT_TIMESTAMP WHERE id = ? AND (qrCode IS NULL OR qrCode = '')", [qrRes.qr, eplId], function (uErr) {
                if (!uErr && this.changes > 0 && userId) {
                  db.run(
                    'INSERT INTO notifications (userId, type, title, body, eplId) VALUES (?, ?, ?, ?, ?)',
                    [userId, 'epl_ready', 'Путевой лист готов', `Откройте карточку путевого — QR-код готов. ${formatTimeMsk()}`, eplId],
                    () => {}
                  );
                  console.log(`[Clinic] EPL ${eplId}: QR получен по API Такском (waybill ${waybillNumber}), водителю уведомление.`);
                }
              });
              return;
            }
            if (attempts < maxAttempts) setTimeout(tryQr, intervalMs);
          })
          .catch(() => {
            if (attempts < maxAttempts) setTimeout(tryQr, intervalMs);
          });
      };
      setTimeout(tryQr, firstDelayMs);
    });
  }
});

/**
 * POST /api/clinic/clear-qr
 * Очистить QR у ЭПЛ для перезалива. Query: eplId=129 или waybill=WB-3-20260214-7361
 */
router.post('/clear-qr', (req, res) => {
  const eplId = parseInt(req.query.eplId || req.body?.eplId, 10);
  const waybill = (req.query.waybill || req.body?.waybill || '').trim();

  const doClear = (id) => {
    if (!id) return res.status(400).json({ error: 'Нужен eplId или waybill в query/body' });
    db.run('UPDATE epl SET qrCode = NULL WHERE id = ? AND mintransId IS NOT NULL', [id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) {
        db.get('SELECT id, mintransId FROM epl WHERE id = ?', [id], (e, row) => {
          if (e) return res.status(500).json({ error: e.message });
          if (!row) return res.status(404).json({ error: 'ЭПЛ не найден', eplId: id });
          return res.status(404).json({ error: 'ЭПЛ без mintransId', eplId: id });
        });
        return;
      }
      console.log(`[Clinic] EPL ${id}: QR очищен для перезалива.`);
      res.json({ ok: true, eplId: id });
    });
  };

  if (waybill) {
    db.get('SELECT id FROM epl WHERE waybillNumber = ? AND mintransId IS NOT NULL', [waybill], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'ЭПЛ с waybill не найден', waybill });
      doClear(row.id);
    });
  } else if (eplId) {
    doClear(eplId);
  } else {
    res.status(400).json({ error: 'Нужен eplId или waybill' });
  }
});

/**
 * GET /api/clinic/next-epl-for-qr-fetch
 * ЭПЛ без QR для фоновой задачи: зайти на путевой в Такском и скачать QR.
 * Условия: mintransId есть, qrCode пустой, статус pending/approved.
 * Query: minAgeMinutes (0 = любые по времени), limit (1–20, по умолчанию 1), requireTitlesSigned=1 — только с подписанными Т1–Т4 (QR появляется после Т4).
 * forceEplId=N — вернуть только этот ЭПЛ (для перезалива).
 * При limit=1 возвращает { item }; при limit>1 — { items: [...] }.
 */
router.get('/next-epl-for-qr-fetch', (req, res) => {
  const forceEplId = parseInt(req.query.forceEplId, 10);
  const minAgeMinutes = Math.max(0, parseInt(req.query.minAgeMinutes, 10));
  const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 1));
  const requireTitlesSigned = req.query.requireTitlesSigned === '1' || req.query.requireTitlesSigned === 'true';
  const minCreatedAt = minAgeMinutes > 0 ? new Date(Date.now() - minAgeMinutes * 60 * 1000).toISOString() : null;

  if (forceEplId) {
    const sql = `SELECT e.id as eplId, e.mintransId, e.waybillNumber, d.userId
       FROM epl e
       JOIN drivers d ON e.driverId = d.id
       WHERE e.id = ? AND e.mintransId IS NOT NULL`;
    db.get(sql, [forceEplId], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.json({ item: null, items: [] });
      res.json({ item: { eplId: row.eplId, mintransId: row.mintransId, waybillNumber: row.waybillNumber, userId: row.userId }, items: [row] });
    });
    return;
  }

  let sql = `SELECT e.id as eplId, e.mintransId, e.waybillNumber, d.userId
     FROM epl e
     JOIN drivers d ON e.driverId = d.id
     WHERE e.mintransId IS NOT NULL
       AND (e.qrCode IS NULL OR e.qrCode = '')
       AND e.status IN (${sqlQuoteList(DOC_POLLABLE)})`;
  const params = [];
  if (minCreatedAt) {
    sql += ` AND e.createdAt <= ?`;
    params.push(minCreatedAt);
  }
  if (requireTitlesSigned) {
    sql += ` AND (SELECT COUNT(*) FROM epl_titles t WHERE t.eplId = e.id AND t.titleCode IN ('t1','t2','t3','t4') AND t.status = 'signed') = 4`;
  }
  sql += ` ORDER BY e.qrRefetchRequested DESC, e.createdAt ASC LIMIT ?`;
  params.push(limit);

  const run = (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const list = rows || [];
    if (limit === 1) {
      const row = list[0];
      if (!row) return res.json({ item: null });
      return res.json({ item: { eplId: row.eplId, mintransId: row.mintransId, waybillNumber: row.waybillNumber, userId: row.userId } });
    }
    const items = list.map((r) => ({ eplId: r.eplId, mintransId: r.mintransId, waybillNumber: r.waybillNumber, userId: r.userId }));
    res.json({ items });
  };

  if (limit === 1) {
    db.get(sql, params, (err, row) => run(err, row ? [row] : []));
  } else {
    db.all(sql, params, run);
  }
});

/**
 * POST /api/clinic/epl-log
 * Универсальная точка для записи логов от фоновых воркеров (qr-fetcher и т.п.) в таблицу epl_logs.
 * Тело: { eplId, driverId?, parkId?, source?, event, message?, details? }
 */
router.post('/epl-log', (req, res) => {
  const { eplId, driverId, parkId, source, event, message, details } = req.body || {};
  const eplIdNum = parseInt(eplId, 10);
  if (!eplIdNum || Number.isNaN(eplIdNum) || !event || typeof event !== 'string') {
    return res.status(400).json({ error: 'Нужны eplId и event' });
  }
  const src = (source && String(source).trim()) || 'worker';
  const msg = message != null ? String(message) : null;
  const det = details != null ? (typeof details === 'string' ? details : JSON.stringify(details)) : null;

  // Если driverId/parkId не переданы, попытаемся взять из epl
  if (!driverId || !parkId) {
    db.get('SELECT driverId, parkId FROM epl WHERE id = ?', [eplIdNum], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      const dId = driverId || (row && row.driverId) || null;
      const pId = parkId || (row && row.parkId) || null;
      db.run(
        `INSERT INTO epl_logs (eplId, driverId, parkId, source, event, message, details)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [eplIdNum, dId, pId, src, event, msg, det],
        (insErr) => {
          if (insErr) return res.status(500).json({ error: insErr.message });
          res.json({ ok: true });
        }
      );
    });
  } else {
    db.run(
      `INSERT INTO epl_logs (eplId, driverId, parkId, source, event, message, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [eplIdNum, driverId, parkId, src, event, msg, det],
      (insErr) => {
        if (insErr) return res.status(500).json({ error: insErr.message });
        res.json({ ok: true });
      }
    );
  }
});

/**
 * POST /api/clinic/epl/:id/qr
 * Сохранить QR-код (data URL или base64), полученный фоновой задачей qr-fetcher.
 * Тело: { qrCode }. Обновляет epl, ставит status=approved, шлёт уведомление водителю.
 */
router.post('/epl/:id/qr', (req, res) => {
  const eplId = parseInt(req.params.id, 10);
  const { qrCode } = req.body || {};
  if (!eplId || !qrCode || typeof qrCode !== 'string' || !qrCode.trim()) {
    return res.status(400).json({ error: 'Нужны id ЭПЛ и qrCode (строка)' });
  }
  db.run(
    `UPDATE epl SET qrCode = ?, status = 'approved', qrRefetchRequested = 0 WHERE id = ? AND (qrCode IS NULL OR qrCode = '')`,
    [qrCode.trim(), eplId],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) {
        return res.json({ ok: true, message: 'QR уже был сохранён' });
      }
      db.get('SELECT driverId, parkId FROM epl WHERE id = ?', [eplId], (e, r) => {
        if (!e && r && r.driverId) {
          db.run(
            'INSERT INTO notifications (userId, type, title, body, eplId) SELECT d.userId, ?, ?, ?, ? FROM drivers d WHERE d.id = ?',
            ['epl_ready', 'Путевой лист готов', `Откройте карточку путевого — QR-код готов. ${formatTimeMsk()}`, eplId, r.driverId],
            () => {}
          );
          // Логируем успешное получение QR Минтранса
          db.run(
            `INSERT INTO epl_logs (eplId, driverId, parkId, source, event, message)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [eplId, r.driverId, r.parkId || null, 'qr_fetcher', 'qr_saved', 'QR Минтранса сохранён фоновой задачей'],
            () => {}
          );
        }
      });
      console.log(`[Clinic] QR сохранён для EPL ${eplId} (фоновый qr-fetcher)`);
      res.json({ ok: true });
    }
  );
});

/**
 * GET /api/clinic/pending-completion
 * Список ЭПЛ, требующих завершения (Т5/Т6) через Playwright.
 * Query: since — ISO-дата; только ЭПЛ, созданные после этой даты.
 * Возвращает ЭПЛ со статусом 'pending' или 'approved', у которых есть mintransId, но нет endOdometer или статус не 'submitted'.
 */
router.get('/pending-completion', (req, res) => {
  const since = (req.query.since || '').trim();
  let sql = `SELECT e.id as eplId, e.waybillNumber, e.mintransId, e.endOdometer, e.startOdometer, e.parkId, e.driverId, e.carId, e.createdAt
     FROM epl e
     WHERE e.mintransId IS NOT NULL 
       AND e.status IN (${sqlQuoteList(DOC_POLLABLE)})
       AND e.endOdometer IS NOT NULL
       AND e.status != 'submitted'`;
  const params = [];
  if (since) {
    sql += ` AND e.createdAt >= ?`;
    params.push(since);
  }
  sql += ` ORDER BY e.createdAt ASC LIMIT 10`;

  db.all(sql, params,
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!rows || rows.length === 0) {
        return res.json({ items: [] });
      }

      const driverIds = [...new Set(rows.map((r) => r.driverId))];
      const placeholders = driverIds.map(() => '?').join(',');
      db.all(
        `SELECT
           u.id as userId, u.fullName, u.firstName, u.lastName, u.secondName, u.phone, u.personnelNumber, u.inn,
           u.licenseSerial, u.licenseNumber, u.licenseDate,
           d.id as driverId, d.carId, d.license,
           c.regNumber, c.vin, c.brand, c.model, c.inventoryNumber, c.vehicleType,
           p.id as parkId, p.name as parkName
         FROM drivers d
         JOIN users u ON u.id = d.userId
         LEFT JOIN cars c ON d.carId = c.id AND c.parkId = d.parkId
         LEFT JOIN parks p ON d.parkId = p.id
         WHERE d.id IN (${placeholders})`,
        driverIds,
        (err2, driversRows) => {
          if (err2) {
            return res.status(500).json({ error: err2.message });
          }
          const driversByKey = {};
          (driversRows || []).forEach((r) => {
            driversByKey[r.driverId] = {
              userId: r.userId,
              fullName: r.fullName,
              firstName: r.firstName,
              lastName: r.lastName,
              secondName: r.secondName,
              phone: r.phone || '',
              personnelNumber: r.personnelNumber,
              inn: r.inn || '',
              licenseSerial: r.licenseSerial,
              licenseNumber: r.licenseNumber,
              licenseDate: r.licenseDate,
              driverId: r.driverId,
              carId: r.carId,
              regNumber: r.regNumber,
              vin: r.vin,
              brand: r.brand,
              model: r.model,
              inventoryNumber: r.inventoryNumber,
              vehicleType: r.vehicleType,
              parkId: r.parkId,
              parkName: r.parkName
            };
          });

          const parkIds = [...new Set(rows.map((r) => r.parkId))];
          const parkPlaceholders = parkIds.map(() => '?').join(',');
          db.all(
            `SELECT parkId, role, fullName, firstName, lastName, secondName, position, taxcomLogin, taxcomPassword
             FROM park_staff
             WHERE parkId IN (${parkPlaceholders})`,
            parkIds,
            (err3, staffRows) => {
              if (err3) {
                return res.status(500).json({ error: err3.message });
              }
              const staffByPark = {};
              parkIds.forEach((pid) => {
                staffByPark[pid] = { medic: null, technic: null, dispatcher: null };
              });
              (staffRows || []).forEach((s) => {
                const key = s.role === 'technic' ? 'technic' : s.role === 'medic' ? 'medic' : s.role === 'dispatcher' ? 'dispatcher' : null;
                if (key && staffByPark[s.parkId]) {
                  staffByPark[s.parkId][key] = {
                    fullName: s.fullName,
                    firstName: s.firstName,
                    lastName: s.lastName,
                    secondName: s.secondName,
                    position: s.position,
                    taxcomLogin: s.taxcomLogin || null,
                    taxcomPassword: s.taxcomPassword || null,
                  };
                }
              });

              const items = rows.map((e) => {
                const driver = driversByKey[e.driverId];
                const staff = staffByPark[e.parkId] || {};
                return {
                  eplId: e.eplId,
                  waybillNumber: e.waybillNumber,
                  mintransId: e.mintransId,
                  endOdometer: e.endOdometer,
                  startOdometer: e.startOdometer ?? 0,
                  createdAt: e.createdAt || null,
                  driver: driver || null,
                  staff
                };
              }).filter((i) => i.driver && i.mintransId && i.endOdometer != null);

              return res.json({ items });
            }
          );
        }
      );
    }
  );
});

/**
 * POST /api/clinic/epl-completed
 * Тело: { eplId, success }
 * Обновляет статус ЭПЛ после завершения Т5/Т6 через Playwright.
 */
router.post('/epl-completed', (req, res) => {
  const { eplId, success } = req.body || {};
  if (!eplId) {
    return res.status(400).json({ error: 'Нужен eplId' });
  }

  if (success) {
    db.run(
      `UPDATE epl SET status = 'submitted', updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      [eplId],
      function (err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        ['t5', 't6'].forEach((code) => {
          db.run(
            `INSERT OR IGNORE INTO epl_titles (eplId, titleCode, status) VALUES (?, ?, 'signed')`,
            [eplId, code],
            () => {}
          );
        });
        
        // Обновляем смену: закрываем её (через Playwright = ручное закрытие)
        db.run(
          `UPDATE shifts SET status = 'closed', closedAt = CURRENT_TIMESTAMP WHERE eplId = ?`,
          [eplId],
          (shiftErr) => {
            if (shiftErr) console.warn('[Clinic] Shift update error:', shiftErr.message);
          }
        );
        
        console.log(`[Clinic] EPL ${eplId} завершён (Т5/Т6 подписаны)`);
        res.json({ success: true, eplId });
      }
    );
  } else {
    res.json({ success: false, eplId, message: 'Завершение не удалось' });
  }
});

module.exports = router;
