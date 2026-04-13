/**
 * Генератор Excel-отчёта по кассе
 *
 * Запуск:  node report-excel.js
 * Требует: npm install exceljs
 *
 * Создаёт файл Касса_ГГГГ-ММ-ДД.xlsx с листами:
 *   1. Касса         — общая сводка (приход/расход/остаток)
 *   2. ЗП по дням    — ежедневная разбивка
 *   3. По паркам     — детализация по каждому парку
 *   4. Расходы       — для ручного ввода инкассации/доп. расходов
 *   5. Помесячно     — сводка по месяцам
 */

const ExcelJS = require('exceljs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'app.db');
const db = new sqlite3.Database(DB_PATH);

const {
  YUKASSA_COMMISSION, TAX_RATE, EPL_PRICE, AUTO_CLOSE_PRICE,
  SALARY_EPL_REGULAR, SALARY_EPL_TULA_SPB, SALARY_AUTO_CLOSE,
  MEDIC_FEE, TAXCOM_FEE, isTulaSPb: isTulaSPbShared,
} = require('./utils/finance-constants');

function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}
function q1(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}

const isTulaSPb = isTulaSPbShared;

const COLORS = {
  header: 'FF1F4E79',
  headerFont: 'FFFFFFFF',
  income: 'FFD5F5E3',
  expense: 'FFFADBD8',
  total: 'FFFDEBD0',
  manual: 'FFFFF9C4',
  neutral: 'FFF2F4F4',
  white: 'FFFFFFFF',
};

function styleHeader(row, colCount) {
  for (let i = 1; i <= colCount; i++) {
    const cell = row.getCell(i);
    cell.font = { bold: true, color: { argb: COLORS.headerFont }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.header } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin' }, bottom: { style: 'thin' },
      left: { style: 'thin' }, right: { style: 'thin' }
    };
  }
}

function styleCells(row, colCount, fillColor) {
  for (let i = 1; i <= colCount; i++) {
    const cell = row.getCell(i);
    cell.border = {
      top: { style: 'thin' }, bottom: { style: 'thin' },
      left: { style: 'thin' }, right: { style: 'thin' }
    };
    if (fillColor) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
    }
    cell.alignment = { vertical: 'middle' };
  }
}

function numFmt(cell) {
  cell.numFmt = '#,##0.00 "₽"';
}

function fmtDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}.${m}.${y}`;
}

async function main() {
  console.log('Генерация Excel-отчёта...');

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Грузовые ЭПЛ Report';
  workbook.created = new Date();

  // ─── Загрузка данных ───

  const parks = await q(`SELECT id, name FROM parks ORDER BY id`);
  const parkMap = {};
  parks.forEach(p => { parkMap[p.id] = p.name; });

  const yukassa = await q1(`SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total FROM payments WHERE status='succeeded'`);
  const realTopups = await q1(`SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total FROM balance_history WHERE type='topup' AND amountType='real'`);
  const bonusTopups = await q1(`SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total FROM balance_history WHERE type='topup' AND amountType='unreal'`);
  const adminReal = Math.max(0, (realTopups.total || 0) - (yukassa.total || 0));

  const yukassaComm = (yukassa.total || 0) * YUKASSA_COMMISSION;
  const afterComm = (yukassa.total || 0) - yukassaComm + adminReal;
  const tax = afterComm * TAX_RATE;
  const cleanMoney = afterComm - tax;

  const eplByPark = await q(`
    SELECT d.parkId, p.name as parkName, bh.amountType, COUNT(*) as cnt
    FROM balance_history bh
    JOIN users u ON u.id=bh.userId JOIN drivers d ON d.userId=u.id
    LEFT JOIN parks p ON p.id=d.parkId
    WHERE bh.type='waybill_fee' GROUP BY d.parkId, bh.amountType
  `);
  const acByPark = await q(`
    SELECT d.parkId, p.name as parkName, bh.amountType, COUNT(*) as cnt
    FROM balance_history bh
    JOIN users u ON u.id=bh.userId JOIN drivers d ON d.userId=u.id
    LEFT JOIN parks p ON p.id=d.parkId
    WHERE bh.type='expense' AND bh.description LIKE '%Автозакрытие%'
    GROUP BY d.parkId, bh.amountType
  `);

  const ps = {};
  for (const r of eplByPark) {
    const k = r.parkId || 0;
    if (!ps[k]) ps[k] = { name: r.parkName, eplR: 0, eplU: 0, acR: 0, acU: 0 };
    if (r.amountType === 'real') ps[k].eplR += r.cnt; else ps[k].eplU += r.cnt;
  }
  for (const r of acByPark) {
    const k = r.parkId || 0;
    if (!ps[k]) ps[k] = { name: r.parkName, eplR: 0, eplU: 0, acR: 0, acU: 0 };
    if (r.amountType === 'real') ps[k].acR += r.cnt; else ps[k].acU += r.cnt;
  }

  const cleanEplPriceCalc = EPL_PRICE * (1 - YUKASSA_COMMISSION) * (1 - TAX_RATE);
  const cleanACPriceCalc = AUTO_CLOSE_PRICE * (1 - YUKASSA_COMMISSION) * (1 - TAX_RATE);

  let totSalMe = 0, totSalMas = 0, totSalInal = 0, totMedic = 0, totTaxcom = 0;
  let totEplAll = 0, totACAll = 0, totRemainder = 0;
  for (const [, s] of Object.entries(ps)) {
    const t = isTulaSPb(s.name);
    const sp = t ? SALARY_EPL_TULA_SPB : SALARY_EPL_REGULAR;
    const mp = t ? 0 : MEDIC_FEE;
    const tp = t ? 0 : TAXCOM_FEE;
    const totalEpl = s.eplR + s.eplU;
    const totalAC = s.acR + s.acU;
    const sal = sp * totalEpl + SALARY_AUTO_CLOSE * totalAC;
    totSalMe += sal; totSalMas += sal; totSalInal += sal;
    totMedic += mp * totalEpl;
    totTaxcom += tp * totalEpl;
    totEplAll += totalEpl;
    totACAll += totalAC;
    const remPerEpl = cleanEplPriceCalc - sp * 3 - mp - tp;
    const remPerAC = cleanACPriceCalc - SALARY_AUTO_CLOSE * 3;
    totRemainder += remPerEpl * totalEpl + remPerAC * totalAC;
  }

  const driverBal = await q1(`
    SELECT COUNT(*) as cnt, COALESCE(SUM(balanceReal),0) as totalReal,
      COALESCE(SUM(balanceUnreal),0) as totalUnreal
    FROM users WHERE role='driver'
  `);

  // ═══════════════════════════════════════
  // ЛИСТ 1: КАССА
  // ═══════════════════════════════════════
  const ws1 = workbook.addWorksheet('Касса', { properties: { tabColor: { argb: 'FF1F4E79' } } });
  ws1.columns = [
    { width: 40 }, { width: 20 }, { width: 15 }
  ];

  let r = 1;
  ws1.mergeCells(`A${r}:C${r}`);
  const titleCell = ws1.getCell(`A${r}`);
  titleCell.value = 'КАССА — ОБЩАЯ СВОДКА';
  titleCell.font = { bold: true, size: 16, color: { argb: COLORS.header } };
  titleCell.alignment = { horizontal: 'center' };
  r++;
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  ws1.getCell(`A${r}`).value = `Дата формирования: ${dd}.${mm}.${yyyy}`;
  ws1.getCell(`A${r}`).font = { italic: true, size: 10, color: { argb: 'FF888888' } };
  r += 2;

  const addKassaRow = (label, value, color, bold) => {
    const row = ws1.getRow(r);
    row.getCell(1).value = label;
    row.getCell(2).value = value;
    numFmt(row.getCell(2));
    if (bold) {
      row.getCell(1).font = { bold: true, size: 12 };
      row.getCell(2).font = { bold: true, size: 12 };
    }
    styleCells(row, 3, color);
    r++;
    return row;
  };

  // ─── ПРИХОД ───
  ws1.getRow(r).getCell(1).value = '═══ ПРИХОД ═══';
  ws1.getRow(r).getCell(1).font = { bold: true, size: 12, color: { argb: 'FF27AE60' } };
  r++;
  addKassaRow('Приход ЮКасса (succeeded)', yukassa.total || 0, COLORS.income);
  addKassaRow('  кол-во платежей', yukassa.cnt || 0, COLORS.income);
  addKassaRow('Приход админ (реальные, из кассы)', adminReal, COLORS.income);
  addKassaRow('ИТОГО реальный приход', realTopups.total || 0, COLORS.income, true);
  r++;

  // ─── КОМИССИИ ───
  ws1.getRow(r).getCell(1).value = '═══ КОМИССИИ И НАЛОГИ ═══';
  ws1.getRow(r).getCell(1).font = { bold: true, size: 12, color: { argb: 'FFC0392B' } };
  r++;
  addKassaRow('Комиссия ЮКассы (4.7%)', -yukassaComm, COLORS.expense);
  addKassaRow('Налог (13%)', -tax, COLORS.expense);
  addKassaRow('ЧИСТЫЙ ПРИХОД', cleanMoney, COLORS.income, true);
  r++;

  // ─── РАСХОДЫ (все ЭПЛ и АЗ — и реал и бонус) ───
  ws1.getRow(r).getCell(1).value = '═══ РАСХОДЫ ═══';
  ws1.getRow(r).getCell(1).font = { bold: true, size: 12, color: { argb: 'FFC0392B' } };
  r++;
  addKassaRow(`Всего ЭПЛ: ${totEplAll} шт.`, null, COLORS.neutral);
  addKassaRow(`Всего автозакрытий: ${totACAll} шт.`, null, COLORS.neutral);
  addKassaRow('ЗП — Ты', -totSalMe, COLORS.expense);
  addKassaRow('ЗП — Масис', -totSalMas, COLORS.expense);
  addKassaRow('ЗП — Инал', -totSalInal, COLORS.expense);
  addKassaRow('Медик', -totMedic, COLORS.expense);
  addKassaRow('Такском', -totTaxcom, COLORS.expense);
  const totalExp = totSalMe + totSalMas + totSalInal + totMedic + totTaxcom;
  addKassaRow('ИТОГО расходов', -totalExp, COLORS.expense, true);
  r++;

  // ─── РУЧНЫЕ РАСХОДЫ ───
  ws1.getRow(r).getCell(1).value = '═══ РУЧНЫЕ РАСХОДЫ (впиши ниже) ═══';
  ws1.getRow(r).getCell(1).font = { bold: true, size: 12, color: { argb: 'FFE67E22' } };
  r++;
  addKassaRow('Инкассация (вписать сумму →)', 0, COLORS.manual);
  addKassaRow('Доп. расход 1 (вписать →)', 0, COLORS.manual);
  addKassaRow('Доп. расход 2 (вписать →)', 0, COLORS.manual);
  addKassaRow('Доп. расход 3 (вписать →)', 0, COLORS.manual);
  r++;

  // ─── ИТОГО ───
  ws1.getRow(r).getCell(1).value = '══════════════════════════════════════';
  r++;
  const cashAfterExp = cleanMoney - totalExp;
  addKassaRow('ПОСЛЕ РАСХОДОВ', cashAfterExp, COLORS.total, true);
  r++;

  // ─── ОБОРОТНЫЕ ДЕНЬГИ ───
  ws1.getRow(r).getCell(1).value = '═══ ОБОРОТНЫЕ ДЕНЬГИ ═══';
  ws1.getRow(r).getCell(1).font = { bold: true, size: 12, color: { argb: 'FF2980B9' } };
  r++;
  addKassaRow('На балансах водителей (реал)', driverBal.totalReal || 0, COLORS.neutral);
  addKassaRow('На балансах водителей (бонус)', driverBal.totalUnreal || 0, COLORS.neutral);
  addKassaRow(`Водителей в системе: ${driverBal.cnt}`, null, COLORS.neutral);
  r++;

  // ─── ОСТАТОК С ПАРКОВ (твоя доля прибыли) ───
  ws1.getRow(r).getCell(1).value = '═══ ОСТАТОК С ПАРКОВ ═══';
  ws1.getRow(r).getCell(1).font = { bold: true, size: 12, color: { argb: 'FF27AE60' } };
  r++;
  addKassaRow('Остаток с ЭПЛ и АЗ (после ЗП, медик, такском)', totRemainder, COLORS.income, true);
  addKassaRow('Обычн парк: ~4.73₽/ЭПЛ | Тула/СПб: ~5.73₽/ЭПЛ', null, COLORS.white);
  r++;

  // ─── СВОБОДНЫЕ ДЕНЬГИ ───
  ws1.getRow(r).getCell(1).value = '══════════════════════════════════════';
  r++;
  const freeCash = cashAfterExp - (driverBal.totalReal || 0);
  const finalRow = r;
  addKassaRow('💰 РЕАЛ НА КАРТЕ (чистый приход − расходы − оборотные)', freeCash, COLORS.total, true);
  ws1.getRow(finalRow).getCell(2).font = { bold: true, size: 14, color: { argb: freeCash >= 0 ? 'FF27AE60' : 'FFC0392B' } };
  r++;
  addKassaRow('', null, COLORS.white);
  addKassaRow('Оборотные = реал деньги водителей на балансах.', null, COLORS.white);
  addKassaRow('Когда водитель тратит — часть идёт в расходы, остаток тебе.', null, COLORS.white);

  // ═══════════════════════════════════════
  // ЛИСТ 2: ЗП ПО ДНЯМ
  // ═══════════════════════════════════════
  const ws2 = workbook.addWorksheet('ЗП по дням', { properties: { tabColor: { argb: 'FF27AE60' } } });

  const dailyData = await q(`
    SELECT
      date(bh.createdAt) as day,
      d.parkId,
      p.name as parkName,
      bh.amountType,
      bh.type as bhType,
      CASE WHEN bh.description LIKE '%Автозакрытие%' THEN 1 ELSE 0 END as isAutoClose,
      COUNT(*) as cnt
    FROM balance_history bh
    JOIN users u ON u.id=bh.userId JOIN drivers d ON d.userId=u.id
    LEFT JOIN parks p ON p.id=d.parkId
    WHERE bh.type IN ('waybill_fee','expense')
      AND (bh.type='waybill_fee' OR bh.description LIKE '%Автозакрытие%')
    GROUP BY day, d.parkId, bh.amountType, isAutoClose
    ORDER BY day DESC
  `);

  const dayMap = {};
  for (const row of dailyData) {
    if (!dayMap[row.day]) dayMap[row.day] = { eplRegR: 0, eplRegU: 0, eplTSR: 0, eplTSU: 0, acR: 0, acU: 0 };
    const d = dayMap[row.day];
    const ts = isTulaSPb(row.parkName);
    if (row.isAutoClose) {
      if (row.amountType === 'real') d.acR += row.cnt; else d.acU += row.cnt;
    } else {
      if (ts) {
        if (row.amountType === 'real') d.eplTSR += row.cnt; else d.eplTSU += row.cnt;
      } else {
        if (row.amountType === 'real') d.eplRegR += row.cnt; else d.eplRegU += row.cnt;
      }
    }
  }

  ws2.columns = [
    { header: 'Дата', width: 14 },
    { header: 'ЭПЛ обычн', width: 14 },
    { header: 'ЭПЛ Тула/СПб', width: 14 },
    { header: 'АЗ', width: 10 },
    { header: 'ЗП Ты', width: 14 },
    { header: 'ЗП Масис', width: 14 },
    { header: 'ЗП Инал', width: 14 },
    { header: 'Медик', width: 12 },
    { header: 'Такском', width: 12 },
    { header: 'Всего расход', width: 14 },
    { header: 'Остаток', width: 14 },
  ];
  styleHeader(ws2.getRow(1), 11);

  let dayRowNum = 2;
  const sortedDays = Object.keys(dayMap).sort().reverse();

  for (const day of sortedDays) {
    const d = dayMap[day];
    const eplRegTotal = d.eplRegR + d.eplRegU;
    const eplTSTotal = d.eplTSR + d.eplTSU;
    const acTotal = d.acR + d.acU;

    const salMe = SALARY_EPL_REGULAR * eplRegTotal + SALARY_EPL_TULA_SPB * eplTSTotal + SALARY_AUTO_CLOSE * acTotal;
    const medic = MEDIC_FEE * eplRegTotal;
    const taxcom = TAXCOM_FEE * eplRegTotal;
    const totalDayExp = salMe * 3 + medic + taxcom;

    const grossEpl = (eplRegTotal + eplTSTotal) * EPL_PRICE + acTotal * AUTO_CLOSE_PRICE;
    const netGross = grossEpl * (1 - YUKASSA_COMMISSION) * (1 - TAX_RATE);
    const remainder = netGross - totalDayExp;

    const row = ws2.getRow(dayRowNum);
    row.values = [fmtDate(day), eplRegTotal, eplTSTotal, acTotal,
      salMe, salMe, salMe, medic, taxcom, totalDayExp, remainder];

    for (let c = 5; c <= 11; c++) numFmt(row.getCell(c));

    const color = dayRowNum % 2 === 0 ? COLORS.white : COLORS.neutral;
    styleCells(row, 11, color);
    dayRowNum++;
  }

  const totalDayRow = ws2.getRow(dayRowNum);
  totalDayRow.getCell(1).value = 'ИТОГО';
  totalDayRow.getCell(1).font = { bold: true };
  for (let c = 2; c <= 11; c++) {
    const colLetter = String.fromCharCode(64 + c);
    totalDayRow.getCell(c).value = { formula: `SUM(${colLetter}2:${colLetter}${dayRowNum - 1})` };
    numFmt(totalDayRow.getCell(c));
    totalDayRow.getCell(c).font = { bold: true };
  }
  for (let c = 2; c <= 4; c++) totalDayRow.getCell(c).numFmt = '#,##0';
  styleCells(totalDayRow, 11, COLORS.total);

  // ═══════════════════════════════════════
  // ЛИСТ 3: ПО ПАРКАМ
  // ═══════════════════════════════════════
  const ws3 = workbook.addWorksheet('По паркам', { properties: { tabColor: { argb: 'FFE67E22' } } });

  const cleanEplPrice = cleanEplPriceCalc;
  const cleanACPrice = cleanACPriceCalc;

  ws3.columns = [
    { header: 'Парк', width: 30 },
    { header: 'Тип', width: 12 },
    { header: 'ЭПЛ', width: 8 },
    { header: 'АЗ', width: 8 },
    { header: 'ЗП/ЭПЛ (×1)', width: 12 },
    { header: 'Медик/ЭПЛ', width: 12 },
    { header: 'Такском/ЭПЛ', width: 12 },
    { header: 'Остаток/ЭПЛ', width: 14 },
    { header: 'Расходы всего', width: 14 },
    { header: 'Остаток всего', width: 14 },
  ];
  styleHeader(ws3.getRow(1), 10);

  let parkRow = 2;
  for (const [pid, s] of Object.entries(ps)) {
    const t = isTulaSPb(s.name);
    const sp = t ? SALARY_EPL_TULA_SPB : SALARY_EPL_REGULAR;
    const mp = t ? 0 : MEDIC_FEE;
    const tp = t ? 0 : TAXCOM_FEE;
    const totalEpl = s.eplR + s.eplU;
    const totalAC = s.acR + s.acU;

    const remainderPerEpl = cleanEplPrice - sp * 3 - mp - tp;
    const remainderPerAC = cleanACPrice - SALARY_AUTO_CLOSE * 3;
    const parkExpenses = (sp * 3 + mp + tp) * totalEpl + (SALARY_AUTO_CLOSE * 3) * totalAC;
    const parkRemainder = remainderPerEpl * totalEpl + remainderPerAC * totalAC;

    const row = ws3.getRow(parkRow);
    row.values = [
      s.name || `ID=${pid}`,
      t ? 'Тула/СПб' : 'Обычный',
      totalEpl, totalAC,
      sp, mp, tp,
      remainderPerEpl,
      parkExpenses,
      parkRemainder
    ];
    for (let c = 5; c <= 10; c++) numFmt(row.getCell(c));
    styleCells(row, 10, parkRow % 2 === 0 ? COLORS.white : COLORS.neutral);
    if (parkRemainder > 0) row.getCell(10).font = { bold: true, color: { argb: 'FF27AE60' } };
    parkRow++;
  }

  const totalParkRow = ws3.getRow(parkRow);
  totalParkRow.getCell(1).value = 'ИТОГО';
  totalParkRow.getCell(1).font = { bold: true };
  for (const c of [3, 4]) {
    const colLetter = String.fromCharCode(64 + c);
    totalParkRow.getCell(c).value = { formula: `SUM(${colLetter}2:${colLetter}${parkRow - 1})` };
    totalParkRow.getCell(c).font = { bold: true };
    totalParkRow.getCell(c).numFmt = '#,##0';
  }
  for (const c of [9, 10]) {
    const colLetter = String.fromCharCode(64 + c);
    totalParkRow.getCell(c).value = { formula: `SUM(${colLetter}2:${colLetter}${parkRow - 1})` };
    numFmt(totalParkRow.getCell(c));
    totalParkRow.getCell(c).font = { bold: true };
  }
  styleCells(totalParkRow, 10, COLORS.total);

  parkRow += 2;
  const noteRow = ws3.getRow(parkRow);
  noteRow.getCell(1).value = 'Формула остатка за 1 ЭПЛ:';
  noteRow.getCell(1).font = { bold: true, size: 11 };
  parkRow++;
  ws3.getRow(parkRow).getCell(1).value = `Чистая цена ЭПЛ = ${EPL_PRICE}₽ − 4.7% − 13% = ${cleanEplPrice.toFixed(2)}₽`;
  parkRow++;
  ws3.getRow(parkRow).getCell(1).value = `Обычный парк: ${cleanEplPrice.toFixed(2)} − 3₽×3(зп) − 5₽(мед) − 2₽(такс) = ${(cleanEplPrice - 9 - 5 - 2).toFixed(2)}₽`;
  parkRow++;
  ws3.getRow(parkRow).getCell(1).value = `Тула/СПб: ${cleanEplPrice.toFixed(2)} − 5₽×3(зп) = ${(cleanEplPrice - 15).toFixed(2)}₽`;
  parkRow++;
  ws3.getRow(parkRow).getCell(1).value = `АЗ: ${(AUTO_CLOSE_PRICE).toFixed(0)}₽ − 4.7% − 13% = ${cleanACPrice.toFixed(2)}₽ − 3₽×3(зп) = ${(cleanACPrice - 9).toFixed(2)}₽`;

  // ═══════════════════════════════════════
  // ЛИСТ 4: РАСХОДЫ (ручной ввод)
  // ═══════════════════════════════════════
  const ws4 = workbook.addWorksheet('Расходы', { properties: { tabColor: { argb: 'FFC0392B' } } });

  ws4.columns = [
    { header: 'Дата', width: 14 },
    { header: 'Тип', width: 22 },
    { header: 'Сумма', width: 16 },
    { header: 'Комментарий', width: 40 },
  ];
  styleHeader(ws4.getRow(1), 4);

  // Примеры
  const examples = [
    ['01.04.2026', 'Инкассация', 5000, 'Снятие наличных'],
    ['02.04.2026', 'Доп. расход', 1500, 'Оплата хостинга'],
    ['', '', null, ''],
  ];
  for (let i = 0; i < examples.length; i++) {
    const row = ws4.getRow(i + 2);
    row.values = examples[i];
    numFmt(row.getCell(3));
    styleCells(row, 4, i < 2 ? COLORS.manual : COLORS.white);
    if (i < 2) row.getCell(1).font = { italic: true, color: { argb: 'FF999999' } };
  }

  // 50 пустых строк для ручного ввода
  for (let i = examples.length + 2; i <= 52; i++) {
    const row = ws4.getRow(i);
    styleCells(row, 4, COLORS.white);
    numFmt(row.getCell(3));
  }

  // Итого
  const expTotalRow = ws4.getRow(53);
  expTotalRow.getCell(1).value = 'ИТОГО';
  expTotalRow.getCell(1).font = { bold: true };
  expTotalRow.getCell(3).value = { formula: `SUM(C2:C52)` };
  numFmt(expTotalRow.getCell(3));
  expTotalRow.getCell(3).font = { bold: true };
  styleCells(expTotalRow, 4, COLORS.total);

  // ═══════════════════════════════════════
  // ЛИСТ 5: ПОМЕСЯЧНО
  // ═══════════════════════════════════════
  const ws5 = workbook.addWorksheet('Помесячно', { properties: { tabColor: { argb: 'FF8E44AD' } } });

  const monthly = await q(`
    SELECT
      strftime('%Y-%m', bh.createdAt) as month,
      SUM(CASE WHEN bh.type='topup' AND bh.amountType='real' THEN bh.amount ELSE 0 END) as topupReal,
      SUM(CASE WHEN bh.type='topup' AND bh.amountType='unreal' THEN bh.amount ELSE 0 END) as topupUnreal,
      SUM(CASE WHEN bh.type='waybill_fee' THEN 1 ELSE 0 END) as eplCount,
      SUM(CASE WHEN bh.type='expense' AND bh.description LIKE '%Автозакрытие%' THEN 1 ELSE 0 END) as acCount,
      SUM(CASE WHEN bh.type IN ('waybill_fee','expense') AND bh.amountType='real' THEN ABS(bh.amount) ELSE 0 END) as spentReal,
      SUM(CASE WHEN bh.type IN ('waybill_fee','expense') AND bh.amountType='unreal' THEN ABS(bh.amount) ELSE 0 END) as spentUnreal
    FROM balance_history bh GROUP BY month ORDER BY month DESC
  `);

  ws5.columns = [
    { header: 'Месяц', width: 14 },
    { header: 'Приход реал', width: 16 },
    { header: 'Бонусы', width: 14 },
    { header: 'ЭПЛ', width: 10 },
    { header: 'АЗ', width: 10 },
    { header: 'Расход реал', width: 16 },
    { header: 'Расход бонус', width: 16 },
    { header: 'Чистый приход', width: 16 },
    { header: 'ЗП (×1 чел)', width: 14 },
  ];
  styleHeader(ws5.getRow(1), 9);

  let mRow = 2;
  for (const m of monthly) {
    const netIncome = (m.topupReal || 0) * (1 - YUKASSA_COMMISSION) * (1 - TAX_RATE);
    const estSal = (m.eplCount || 0) * SALARY_EPL_REGULAR + (m.acCount || 0) * SALARY_AUTO_CLOSE;

    const row = ws5.getRow(mRow);
    row.values = [
      m.month.split('-').reverse().join('.'), m.topupReal || 0, m.topupUnreal || 0,
      m.eplCount || 0, m.acCount || 0,
      m.spentReal || 0, m.spentUnreal || 0,
      netIncome, estSal
    ];
    for (const c of [2, 3, 6, 7, 8, 9]) numFmt(row.getCell(c));
    styleCells(row, 9, mRow % 2 === 0 ? COLORS.white : COLORS.neutral);
    mRow++;
  }

  const mTotalRow = ws5.getRow(mRow);
  mTotalRow.getCell(1).value = 'ИТОГО';
  mTotalRow.getCell(1).font = { bold: true };
  for (let c = 2; c <= 9; c++) {
    const colLetter = String.fromCharCode(64 + c);
    mTotalRow.getCell(c).value = { formula: `SUM(${colLetter}2:${colLetter}${mRow - 1})` };
    mTotalRow.getCell(c).font = { bold: true };
  }
  for (const c of [2, 3, 6, 7, 8, 9]) numFmt(mTotalRow.getCell(c));
  styleCells(mTotalRow, 9, COLORS.total);

  // ═══════════════════════════════════════
  // Сохранение
  // ═══════════════════════════════════════
  const today = new Date().toISOString().slice(0, 10);
  const filename = `Касса_${today}.xlsx`;
  const filepath = path.join(__dirname, '..', filename);

  await workbook.xlsx.writeFile(filepath);
  console.log(`\n✅ Файл создан: ${filename}`);
  console.log(`   Путь: ${filepath}`);
  console.log('\nЛисты:');
  console.log('  1. Касса         — общая сводка приход/расход/остаток');
  console.log('  2. ЗП по дням    — ежедневная разбивка ЭПЛ/АЗ/ЗП');
  console.log('  3. По паркам     — детализация по каждому парку');
  console.log('  4. Расходы       — для ручного ввода инкассации/доп. расходов');
  console.log('  5. Помесячно     — сводка по месяцам\n');

  db.close();
}

main().catch(err => {
  console.error('Ошибка:', err.message || err);
  db.close();
});
