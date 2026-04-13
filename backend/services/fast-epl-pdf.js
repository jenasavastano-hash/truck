/**
 * Fast EPL PDF generation: spawns worker_ep_l.py to create a preliminary
 * путевой лист PDF from the 2702.pdf template, then stores it in the DB
 * and generates a QR code pointing to the document.
 *
 * Called right after EPL gets status=pending_clinic so the driver gets
 * a QR instantly, without waiting for Такском.
 */

const { execFile } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const db = require('../database');
const { deductBalance } = require('../utils/balance');
const { insertShiftWillCloseNotification } = require('../utils/shift-notifications');

const fs = require('fs');

const {
  normalizeCommercialShippingType,
  getPdfHeaderLinesForWorker,
  getPdfFreightExtrasForWorker,
} = require('../utils/commercialShippingTypes');

const WORKER_SCRIPT = path.join(__dirname, '..', 'worker_ep_l.py');
const { publicAppUrl } = require('../utils/publicAppUrl');
const PUBLIC_APP_URL = publicAppUrl();
const PYTHON_BIN = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');

// 2702.pdf: ищем в backend/, затем в корне проекта
const _PDF_CANDIDATES = [
  path.join(__dirname, '..', '2702.pdf'),
  path.join(__dirname, '..', '..', '2702.pdf'),
];
const SOURCE_PDF = _PDF_CANDIDATES.find(p => fs.existsSync(p)) || _PDF_CANDIDATES[0];

const FREIGHT_DEFAULTS_JSON = path.join(__dirname, '..', 'worker_ep_l.freight-defaults.json');

/** Есть ли непустые якоря для подстановки маршрута / начала рейса (иначе не передаём флаги в Python). */
function readFreightPdfAnchorFlags() {
  try {
    if (!fs.existsSync(FREIGHT_DEFAULTS_JSON)) {
      return { route: false, trip: false };
    }
    const j = JSON.parse(fs.readFileSync(FREIGHT_DEFAULTS_JSON, 'utf8'));
    const route = Array.isArray(j.route_line_anchors)
      && j.route_line_anchors.some((x) => String(x).trim());
    const trip = Array.isArray(j.trip_start_line_anchors)
      && j.trip_start_line_anchors.some((x) => String(x).trim());
    return { route, trip };
  } catch (e) {
    console.warn('[FastEPL] worker_ep_l.freight-defaults.json:', e.message);
    return { route: false, trip: false };
  }
}

/** Даты/штампы строго по Europe/Moscow, как в шаблоне 2702.pdf: «… (+03:00 UTC)» */
function formatMskDate(d) {
  const str = d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' });
  return str.replace(/\//g, '.');
}

function formatMskDateTime(d, withSeconds = true) {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined,
    hour12: false,
  }).formatToParts(d);
  const g = (t) => parts.find((p) => p.type === t)?.value ?? '';
  const dateStr = `${g('day')}.${g('month')}.${g('year')}`;
  const timeStr = withSeconds ? `${g('hour')}:${g('minute')}:${g('second')}` : `${g('hour')}:${g('minute')}`;
  return `${dateStr} ${timeStr} (+03:00 UTC)`;
}

/**
 * @param {object} opts
 * @param {number} opts.eplId
 * @param {object} opts.driver  — row from the EPL creation query (fullName, inn, licenseSerial, licenseNumber, brand, model, regNumber, parkName, parkInn, parkKpp, parkOgrn)
 * @param {number} opts.startOdometer
 * @param {Date|string} [opts.createdAt] — момент создания заявки = «убытие» в ЭПЛ; если не передан, берётся текущее время
 * @param {string} [opts.commercialShippingType] — код вида коммерческой перевозки (ПГ|…); для ПГ в PDF всегда «грузовой» ТС
 */
function openShiftAndCharge(eplId) {
  // Открываем смену для водителя и списываем тариф за ЭПЛ, если ещё не списан
  db.get(
    `SELECT e.id as eplId, e.driverId, e.parkId, d.userId
     FROM epl e
     JOIN drivers d ON e.driverId = d.id
     WHERE e.id = ?`,
    [eplId],
    (err, row) => {
      if (err || !row) {
        console.warn('[FastEPL] openShiftAndCharge: failed to load EPL/driver for', eplId, err && err.message);
        return;
      }
      const userId = row.userId;
      const parkId = row.parkId;

      // 1) Открываем смену (или обновляем существующую) для этого ЭПЛ
      db.run(
        `INSERT INTO shifts (driverId, eplId, parkId, status)
         VALUES (?, ?, ?, 'active')
         ON CONFLICT(eplId) DO UPDATE SET
           driverId = excluded.driverId,
           parkId = excluded.parkId,
           status = 'active',
           closedAt = NULL,
           autoClosedAt = NULL`,
        [userId, eplId, parkId],
        (shiftErr) => {
          if (shiftErr) {
            console.warn('[FastEPL] openShiftAndCharge: shift insert error:', shiftErr.message);
          } else {
            // После генерации fast-PDF documentPdfReceivedAt уже установлен — используем его
            db.get(
              'SELECT documentPdfReceivedAt FROM epl WHERE id = ?',
              [eplId],
              (eErr, eRow) => {
                if (!eErr && eRow && eRow.documentPdfReceivedAt) {
                  insertShiftWillCloseNotification(db, userId, eplId, eRow.documentPdfReceivedAt);
                }
              }
            );
          }
        }
      );

      // 2) Списание за создание ЭПЛ, если ещё не списано (waybill_fee)
      db.get(
        'SELECT id FROM balance_history WHERE type = ? AND relatedEplId = ? LIMIT 1',
        ['waybill_fee', eplId],
        (checkErr, existing) => {
          if (checkErr || existing) {
            if (existing) {
              console.log(`[FastEPL] EPL ${eplId}: waybill_fee already charged, skipping.`);
            }
            return;
          }
          const DEFAULT_EPL_FEE = 25;
          db.get(
            'SELECT eplCreationFee FROM waybill_rates WHERE parkId = ? AND isActive = 1',
            [parkId],
            (rateErr, rate) => {
              if (rateErr) {
                console.warn('[FastEPL] openShiftAndCharge: rate load error:', rateErr.message);
                return;
              }
              const fee = (rate != null && Number(rate.eplCreationFee) > 0)
                ? Number(rate.eplCreationFee)
                : DEFAULT_EPL_FEE;
              if (fee <= 0) {
                console.log(`[FastEPL] EPL ${eplId}: eplCreationFee is 0, no charge.`);
                return;
              }
              deductBalance(
                db,
                userId,
                parkId,
                fee,
                'Списание за создание ЭПЛ',
                eplId,
                'waybill_fee',
                `waybill_fee:epl:${eplId}`,
                (deductErr) => {
                  if (deductErr) {
                    console.warn('[FastEPL] openShiftAndCharge: fee deduction error:', deductErr.message);
                  } else {
                    console.log(`[FastEPL] Списано ${fee}₽ за ЭПЛ ${eplId} с баланса водителя ${userId} (fast PDF).`);
                  }
                }
              );
            }
          );
        }
      );
    }
  );
}

/**
 * Строка ТС в бланке 2702: согласована с выбором «вид коммерческой перевозки».
 * Для перевозки грузов (ПГ) — всегда тип «грузовой», чтобы PDF совпадал с Такском/заявкой.
 */
function buildVehicleLineForFastPdf(driver, commercialShippingType) {
  const code = normalizeCommercialShippingType(commercialShippingType);
  const brand = driver.brand || '';
  const model = driver.model || '';
  const reg = driver.regNumber || '';
  const rawVt = (driver.vehicleType && String(driver.vehicleType).trim()) || '';
  const vtLower = rawVt.toLowerCase();

  let vehicleCategory;
  if (code === 'ПГ') {
    vehicleCategory = 'грузовой';
  } else if (code === 'ОД') {
    vehicleCategory = 'автобус';
  } else if (code === 'РП' || code === 'ЗП' || code === 'ТЛ') {
    vehicleCategory = 'легковой';
  } else {
    vehicleCategory = 'грузовой';
    if (/легков|легк|passenger|car/i.test(rawVt) || vtLower === 'легковой') {
      vehicleCategory = 'легковой';
    } else if (/груз|truck|freight|фургон|тягач/i.test(rawVt) || vtLower === 'грузовой') {
      vehicleCategory = 'грузовой';
    } else if (rawVt) {
      vehicleCategory = rawVt;
    }
  }

  return `Тип: ${vehicleCategory}, Марка: ${brand} , Модель: ${model}, Регистрационный номер: ${reg}`;
}

function generateFastEplPdf(opts) {
  const { eplId, driver, startOdometer, createdAt: createdAtOpt, commercialShippingType: cstOpt } = opts;

  // Якорь — фактический момент нажатия кнопки «Взять ЭПЛ».
  const anchor = createdAtOpt ? (typeof createdAtOpt === 'string' ? new Date(createdAtOpt) : createdAtOpt) : new Date();
  const MIN_MS = 60 * 1000;

  // Убытие: на ~1 час раньше фактического времени (57–63 мин назад) — чтобы выглядело как 16:30–35 при фактических 17:33
  const departureOffsetMin = 57 + Math.floor(Math.random() * 7);     // 57–63 мин
  const tDeparture = anchor.getTime() - departureOffsetMin * MIN_MS;

  // Выпуск на линию: за 2–4 мин до убытия
  const releaseOffsetMin = 2 + Math.floor(Math.random() * 3);        // 2–4 мин
  const tRelease = tDeparture - releaseOffsetMin * MIN_MS;

  // Техконтроль (механик): за 5–9 мин до убытия → примерно 16:23–27 при убытии 16:30–35
  const techOffsetMin = 5 + Math.floor(Math.random() * 5);           // 5–9 мин
  const tTech = tDeparture - techOffsetMin * MIN_MS;

  // Медосмотр (медик): за 10–15 мин до убытия — всегда до механика
  const medOffsetMin = 10 + Math.floor(Math.random() * 6);           // 10–15 мин
  const tMed = tDeparture - medOffsetMin * MIN_MS;

  // Рандомные секунды для каждого штампа — чтобы времена выглядели естественно
  const randSec = () => Math.floor(Math.random() * 60) * 1000;
  const medDatetime     = formatMskDateTime(new Date(tMed     + randSec()), true);
  const techDatetime    = formatMskDateTime(new Date(tTech    + randSec()), true);
  const releaseDatetime = formatMskDateTime(new Date(tRelease + randSec()), true);
  const startDatetime   = formatMskDateTime(new Date(tDeparture + randSec()), true);

  const dateStr = formatMskDate(new Date(tDeparture));
  const dateTo = formatMskDate(new Date(tDeparture + 24 * 60 * 60 * 1000));

  // Приоритет: данные юр. лица (park_owners), иначе данные из таблицы parks
  const orgName = driver.ownerName || driver.parkName;
  const orgInn  = driver.ownerInn  || driver.parkInn;
  const orgKpp  = driver.ownerKpp  || driver.parkKpp;
  const orgOgrn = driver.ownerOgrn || driver.ownerOgrnip || driver.parkOgrn;
  const orgParts = [];
  if (orgName) orgParts.push(orgName);
  if (orgInn)  orgParts.push(`ИНН: ${orgInn}`);
  if (orgKpp)  orgParts.push(`КПП: ${orgKpp}`);
  if (orgOgrn) orgParts.push(`ОГРН: ${orgOgrn}`);
  const orgLine = orgParts.join(' ') || 'Организация';

  const shipCode = normalizeCommercialShippingType(cstOpt);
  const { shippingLine, messageKind } = getPdfHeaderLinesForWorker(shipCode);
  const vehicleLine = buildVehicleLineForFastPdf(driver, cstOpt);

  const driverName = driver.fullName || '';
  const driverInn = driver.inn || '';
  const driverLicense = `${driver.licenseSerial || ''} ${driver.licenseNumber || ''}`.trim();
  const driverLine = `${driverName} , ИНН: ${driverInn} Водительское удостоверение: ${driverLicense}`;

  const args = [
    WORKER_SCRIPT,
    '--source', SOURCE_PDF,
    '--output', '-',
    '--date-from', dateStr,
    '--date-to', dateTo,
    '--shipping-line', shippingLine,
    '--message-kind', messageKind,
    '--org-line', orgLine,
    '--vehicle-line', vehicleLine,
    '--driver-line', driverLine,
    '--med-datetime', medDatetime,
    '--tech-datetime', techDatetime,
    '--release-datetime', releaseDatetime,
    '--start-datetime', startDatetime,
    '--start-odometer', String(startOdometer || 0),
  ];

  const anchorFlags = readFreightPdfAnchorFlags();
  const freightCtx = { parkCity: driver.parkCity, city: driver.parkCity };
  const { routeLine, tripStartLine } = getPdfFreightExtrasForWorker(shipCode, freightCtx);
  if (anchorFlags.route && routeLine && String(routeLine).trim()) {
    args.push('--route-line', String(routeLine).trim());
  }
  if (anchorFlags.trip && tripStartLine && String(tripStartLine).trim()) {
    args.push('--trip-start-line', String(tripStartLine).trim());
  }

  console.log(
    `[FastEPL] EPL ${eplId}: spawning worker_ep_l.py (коммерч. вид ${shipCode}, ТС: ${vehicleLine.slice(0, 80)}…)…`
  );

  execFile(PYTHON_BIN, args, { maxBuffer: 20 * 1024 * 1024, timeout: 30000 }, (err, stdout, stderr) => {
    if (stderr) console.log(`[FastEPL] EPL ${eplId} stderr: ${stderr}`);

    if (err) {
      console.error(`[FastEPL] EPL ${eplId}: worker error:`, err.message);
      return;
    }

    const pdfBase64 = stdout.trim();
    if (!pdfBase64 || pdfBase64.length < 100) {
      console.error(`[FastEPL] EPL ${eplId}: worker returned empty/short output (${pdfBase64.length} chars)`);
      return;
    }

    console.log(`[FastEPL] EPL ${eplId}: got fast PDF (${pdfBase64.length} chars base64), saving...`);

    const documentToken = crypto.randomBytes(24).toString('hex');
    const documentUrl = `${PUBLIC_APP_URL}/api/public/epl-document/${eplId}?token=${documentToken}`;

    QRCode.toDataURL(documentUrl, { margin: 2, width: 400 }, (qrErr, dataUrl) => {
      if (qrErr) {
        console.error(`[FastEPL] EPL ${eplId}: QR generation error:`, qrErr.message);
        db.run(
          'UPDATE epl SET documentPdf = ?, documentPdfReceivedAt = CURRENT_TIMESTAMP WHERE id = ?',
          [pdfBase64, eplId],
          (upErr) => {
            if (upErr) {
              console.error(`[FastEPL] EPL ${eplId}: DB update (pdf only) error:`, upErr.message);
            } else {
              console.log(`[FastEPL] EPL ${eplId}: fast PDF saved (without QR)`);
              openShiftAndCharge(eplId);
            }
          }
        );
        return;
      }

      db.run(
        'UPDATE epl SET documentPdf = ?, documentPdfReceivedAt = CURRENT_TIMESTAMP, documentToken = ?, documentQr = ? WHERE id = ?',
        [pdfBase64, documentToken, dataUrl, eplId],
        function (upErr) {
          if (upErr) {
            console.error(`[FastEPL] EPL ${eplId}: DB update error:`, upErr.message);
          } else {
            console.log(`[FastEPL] EPL ${eplId}: fast PDF + QR saved (${this.changes} rows, documentQr len=${dataUrl.length})`);
            openShiftAndCharge(eplId);
          }
        }
      );
    });
  });
}

module.exports = { generateFastEplPdf, buildVehicleLineForFastPdf };
