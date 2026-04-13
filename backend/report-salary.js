/**
 * СКРИПТ 1: Ежедневный отчёт — ЗП и расходы
 *
 * Считает за каждый день:
 *  - Сколько ЭПЛ создано, по каким паркам
 *  - Сколько автозакрытий
 *  - ЗП: тебе, Масису, Иналу
 *  - Расходы: медик, Такском
 *  - Разбивка real / unreal (бонус)
 *  - Остаток (прибыль) за день
 *
 * Запуск: node report-salary.js [дней назад, по умолчанию 30]
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'app.db');
const db = new sqlite3.Database(DB_PATH);

const DAYS_BACK = parseInt(process.argv[2], 10) || 30;

const YUKASSA_COMMISSION = 0.047;
const TAX_RATE = 0.13;

const EPL_PRICE = 25;
const AUTO_CLOSE_PRICE = 10;

const SALARY_EPL_REGULAR = 3;
const SALARY_EPL_TULA_SPB = 5;
const SALARY_AUTO_CLOSE = 3;

const MEDIC_FEE = 5;
const TAXCOM_FEE = 2;

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function queryOne(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function fmt(n) {
  return (n || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function isTulaSPb(parkName) {
  if (!parkName) return false;
  const lower = parkName.toLowerCase();
  return lower.includes('тул') || lower.includes('питер') || lower.includes('спб') ||
         lower.includes('петербург') || lower.includes('tula') || lower.includes('spb') ||
         lower.includes('peter');
}

function netAfterCommissionTax(gross) {
  return gross * (1 - YUKASSA_COMMISSION) * (1 - TAX_RATE);
}

async function main() {
  console.log('='.repeat(80));
  console.log('  ОТЧЁТ: ЗП И РАСХОДЫ ПО ДНЯМ');
  console.log(`  Период: последние ${DAYS_BACK} дней`);
  console.log('  Дата формирования: ' + new Date().toLocaleString('ru-RU'));
  console.log('='.repeat(80));

  const parks = await query(`SELECT id, name FROM parks ORDER BY id`);
  const parkMap = {};
  parks.forEach(p => { parkMap[p.id] = p.name; });

  console.log('\n  Парки в системе:');
  parks.forEach(p => {
    const tag = isTulaSPb(p.name) ? ' [ТУЛА/СПб — без медика/такскома, ЗП 5₽]' : ' [обычный — медик 5₽, такском 2₽, ЗП 3₽]';
    console.log(`    [${p.id}] ${p.name}${tag}`);
  });

  const days = await query(`
    SELECT DISTINCT date(bh.createdAt) as day
    FROM balance_history bh
    WHERE bh.createdAt >= datetime('now', '-${DAYS_BACK} days')
      AND bh.type IN ('waybill_fee', 'expense')
    ORDER BY day DESC
  `);

  let grandTotalSalaryMe = 0, grandTotalSalaryMasis = 0, grandTotalSalaryInal = 0;
  let grandTotalMedic = 0, grandTotalTaxcom = 0;
  let grandTotalRemainder = 0;
  let grandTotalEpl = 0, grandTotalAutoClose = 0;
  let grandTotalFromReal = 0, grandTotalFromUnreal = 0;

  for (const { day } of days) {
    const eplByPark = await query(`
      SELECT
        d.parkId,
        p.name as parkName,
        bh.amountType,
        COUNT(*) as cnt,
        SUM(ABS(bh.amount)) as totalCharged
      FROM balance_history bh
      JOIN users u ON u.id = bh.userId
      JOIN drivers d ON d.userId = u.id
      LEFT JOIN parks p ON p.id = d.parkId
      WHERE date(bh.createdAt) = ?
        AND bh.type = 'waybill_fee'
      GROUP BY d.parkId, bh.amountType
    `, [day]);

    const autoCloses = await query(`
      SELECT
        d.parkId,
        p.name as parkName,
        bh.amountType,
        COUNT(*) as cnt,
        SUM(ABS(bh.amount)) as totalCharged
      FROM balance_history bh
      JOIN users u ON u.id = bh.userId
      JOIN drivers d ON d.userId = u.id
      LEFT JOIN parks p ON p.id = d.parkId
      WHERE date(bh.createdAt) = ?
        AND bh.type = 'expense'
        AND bh.description LIKE '%Автозакрытие%'
      GROUP BY d.parkId, bh.amountType
    `, [day]);

    if (eplByPark.length === 0 && autoCloses.length === 0) continue;

    let daySalaryMe = 0, daySalaryMasis = 0, daySalaryInal = 0;
    let dayMedic = 0, dayTaxcom = 0;
    let dayRemainder = 0;
    let dayEplCount = 0, dayAutoCloseCount = 0;
    let dayFromReal = 0, dayFromUnreal = 0;

    console.log(`\n${'─'.repeat(80)}`);
    console.log(`  📅 ${day}`);
    console.log(`${'─'.repeat(80)}`);

    // ЭПЛ
    const parkEplSummary = {};
    for (const row of eplByPark) {
      const key = row.parkId || 'unknown';
      if (!parkEplSummary[key]) parkEplSummary[key] = { name: row.parkName, real: 0, unreal: 0, total: 0, charged: 0 };
      if (row.amountType === 'real') {
        parkEplSummary[key].real += row.cnt;
        dayFromReal += row.totalCharged;
      } else {
        parkEplSummary[key].unreal += row.cnt;
        dayFromUnreal += row.totalCharged;
      }
      parkEplSummary[key].total += row.cnt;
      parkEplSummary[key].charged += row.totalCharged;
    }

    if (Object.keys(parkEplSummary).length > 0) {
      console.log('\n  ЭПЛ:');
      for (const [pid, s] of Object.entries(parkEplSummary)) {
        const tulaspb = isTulaSPb(s.name);
        const salaryPer = tulaspb ? SALARY_EPL_TULA_SPB : SALARY_EPL_REGULAR;
        const medicPer = tulaspb ? 0 : MEDIC_FEE;
        const taxcomPer = tulaspb ? 0 : TAXCOM_FEE;

        const netPerEpl = netAfterCommissionTax(EPL_PRICE);
        const salaryTotal = salaryPer * s.total;
        const medicTotal = medicPer * s.total;
        const taxcomTotal = taxcomPer * s.total;
        const remainder = (netPerEpl - salaryPer * 3 - medicPer - taxcomPer) * s.total;

        daySalaryMe += salaryPer * s.total;
        daySalaryMasis += salaryPer * s.total;
        daySalaryInal += salaryPer * s.total;
        dayMedic += medicTotal;
        dayTaxcom += taxcomTotal;
        dayRemainder += remainder;
        dayEplCount += s.total;

        const tag = tulaspb ? '(Т/СПб)' : '(обычн)';
        console.log(`    ${s.name || 'ID=' + pid} ${tag}: ${s.total} ЭПЛ (${s.real} реал, ${s.unreal} бонус) | ЗП×3: ${fmt(salaryTotal * 3)}₽ | Медик: ${fmt(medicTotal)}₽ | Такском: ${fmt(taxcomTotal)}₽`);
      }
    }

    // Автозакрытия
    const parkACSummary = {};
    for (const row of autoCloses) {
      const key = row.parkId || 'unknown';
      if (!parkACSummary[key]) parkACSummary[key] = { name: row.parkName, total: 0, charged: 0 };
      parkACSummary[key].total += row.cnt;
      parkACSummary[key].charged += row.totalCharged;
      if (row.amountType === 'real') dayFromReal += row.totalCharged;
      else dayFromUnreal += row.totalCharged;
    }

    if (Object.keys(parkACSummary).length > 0) {
      console.log('\n  Автозакрытия:');
      for (const [pid, s] of Object.entries(parkACSummary)) {
        const salaryTotal = SALARY_AUTO_CLOSE * s.total;
        const netPerAC = netAfterCommissionTax(AUTO_CLOSE_PRICE);
        const remainder = (netPerAC - SALARY_AUTO_CLOSE * 3) * s.total;

        daySalaryMe += salaryTotal;
        daySalaryMasis += salaryTotal;
        daySalaryInal += salaryTotal;
        dayRemainder += remainder;
        dayAutoCloseCount += s.total;

        console.log(`    ${s.name || 'ID=' + pid}: ${s.total} автозакр. | ЗП×3: ${fmt(salaryTotal * 3)}₽`);
      }
    }

    console.log(`\n  ИТОГО ЗА ${day}:`);
    console.log(`    ЭПЛ: ${dayEplCount} шт. | Автозакрытий: ${dayAutoCloseCount} шт.`);
    console.log(`    Оплачено из РЕАЛЬНЫХ: ${fmt(dayFromReal)}₽ | из БОНУСНЫХ: ${fmt(dayFromUnreal)}₽`);
    console.log(`    ─────────────────────────────────────────`);
    console.log(`    ЗП Ты:     ${fmt(daySalaryMe)}₽`);
    console.log(`    ЗП Масис:  ${fmt(daySalaryMasis)}₽`);
    console.log(`    ЗП Инал:   ${fmt(daySalaryInal)}₽`);
    console.log(`    Медик:     ${fmt(dayMedic)}₽`);
    console.log(`    Такском:   ${fmt(dayTaxcom)}₽`);
    console.log(`    Остаток:   ${fmt(dayRemainder)}₽`);

    grandTotalSalaryMe += daySalaryMe;
    grandTotalSalaryMasis += daySalaryMasis;
    grandTotalSalaryInal += daySalaryInal;
    grandTotalMedic += dayMedic;
    grandTotalTaxcom += dayTaxcom;
    grandTotalRemainder += dayRemainder;
    grandTotalEpl += dayEplCount;
    grandTotalAutoClose += dayAutoCloseCount;
    grandTotalFromReal += dayFromReal;
    grandTotalFromUnreal += dayFromUnreal;
  }

  console.log('\n' + '='.repeat(80));
  console.log(`  ИТОГО ЗА ${DAYS_BACK} ДНЕЙ`);
  console.log('='.repeat(80));
  console.log(`  ЭПЛ:            ${grandTotalEpl} шт.`);
  console.log(`  Автозакрытий:    ${grandTotalAutoClose} шт.`);
  console.log(`  Из реальных:     ${fmt(grandTotalFromReal)}₽`);
  console.log(`  Из бонусных:     ${fmt(grandTotalFromUnreal)}₽ ⚠️  (убыток — расходы покрываются из кассы)`);
  console.log('');
  console.log(`  ЗП Ты:           ${fmt(grandTotalSalaryMe)}₽`);
  console.log(`  ЗП Масис:        ${fmt(grandTotalSalaryMasis)}₽`);
  console.log(`  ЗП Инал:         ${fmt(grandTotalSalaryInal)}₽`);
  console.log(`  Медик (всего):   ${fmt(grandTotalMedic)}₽`);
  console.log(`  Такском (всего): ${fmt(grandTotalTaxcom)}₽`);
  console.log(`  ────────────────────────────────────────`);
  const totalExpenses = grandTotalSalaryMe + grandTotalSalaryMasis + grandTotalSalaryInal + grandTotalMedic + grandTotalTaxcom;
  console.log(`  ВСЕГО расходов:  ${fmt(totalExpenses)}₽`);
  console.log(`  Остаток:         ${fmt(grandTotalRemainder)}₽`);
  console.log('='.repeat(80));

  db.close();
}

main().catch(err => {
  console.error('Ошибка:', err);
  db.close();
});
