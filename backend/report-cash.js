/**
 * СКРИПТ 2: Касса — общий приход, расход, остаток
 *
 * Считает:
 *  1. Весь приход реальных денег (ЮКасса + админ-пополнения)
 *  2. Комиссия ЮКассы 4.7% (только с ЮКасса-платежей)
 *  3. Налог 13% (со всех реальных денег после комиссии)
 *  4. Чистые деньги в кассе
 *  5. Расходы: ЗП, медик, такском
 *  6. Убыток от бонусных ЭПЛ (расходы за ЭПЛ оплаченные бонусами)
 *  7. Остаток кассы
 *
 * Запуск: node report-cash.js
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'app.db');
const db = new sqlite3.Database(DB_PATH);

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

async function main() {
  console.log('='.repeat(80));
  console.log('  ОТЧЁТ: КАССА (ПРИХОД — РАСХОД — ОСТАТОК)');
  console.log('  Дата: ' + new Date().toLocaleString('ru-RU'));
  console.log('='.repeat(80));

  // ═══════════════════════════════════════════════════════════════
  // 1. ПРИХОД РЕАЛЬНЫХ ДЕНЕГ
  // ═══════════════════════════════════════════════════════════════

  // ЮКасса — succeeded платежи
  const yukassaRow = await queryOne(`
    SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total
    FROM payments WHERE status = 'succeeded'
  `);

  // Все реальные пополнения из balance_history
  const realTopups = await queryOne(`
    SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total
    FROM balance_history
    WHERE type = 'topup' AND amountType = 'real'
  `);

  // Админские реальные пополнения (те, что не через ЮКассу)
  const adminRealTopups = (realTopups.total || 0) - (yukassaRow.total || 0);
  const adminRealTopupsClamped = Math.max(0, adminRealTopups);

  // Бонусные пополнения
  const bonusTopups = await queryOne(`
    SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total
    FROM balance_history
    WHERE type = 'topup' AND amountType = 'unreal'
  `);

  console.log('\n══════════════════════════════════════════════════');
  console.log('  1. ПРИХОД');
  console.log('══════════════════════════════════════════════════');
  console.log(`  ЮКасса (succeeded):           ${yukassaRow.cnt} платежей, ${fmt(yukassaRow.total)}₽`);
  console.log(`  Админ реальные пополнения:     ${fmt(adminRealTopupsClamped)}₽ (из кассы, без комиссии ЮК)`);
  console.log(`  ИТОГО реальный приход:         ${fmt(realTopups.total)}₽`);
  console.log(`  ──────────────────────────────────────────`);
  console.log(`  Бонусные пополнения:           ${bonusTopups.cnt} шт., ${fmt(bonusTopups.total)}₽ (НЕ реальные деньги)`);

  // ═══════════════════════════════════════════════════════════════
  // 2. КОМИССИИ И НАЛОГИ
  // ═══════════════════════════════════════════════════════════════

  const yukassaCommission = (yukassaRow.total || 0) * YUKASSA_COMMISSION;
  const afterCommission = (yukassaRow.total || 0) - yukassaCommission + adminRealTopupsClamped;
  const tax = afterCommission * TAX_RATE;
  const cleanMoney = afterCommission - tax;

  console.log('\n══════════════════════════════════════════════════');
  console.log('  2. КОМИССИИ И НАЛОГИ');
  console.log('══════════════════════════════════════════════════');
  console.log(`  Комиссия ЮКассы (4.7%):       -${fmt(yukassaCommission)}₽`);
  console.log(`  После комиссии:                ${fmt(afterCommission)}₽`);
  console.log(`  Налог (13%):                   -${fmt(tax)}₽`);
  console.log(`  ──────────────────────────────────────────`);
  console.log(`  ЧИСТЫЕ ДЕНЬГИ В КАССЕ:         ${fmt(cleanMoney)}₽`);

  // ═══════════════════════════════════════════════════════════════
  // 3. РАСХОДЫ (ЭПЛ + Автозакрытия)
  // ═══════════════════════════════════════════════════════════════

  // ЭПЛ по паркам (из waybill_fee в balance_history)
  const eplByPark = await query(`
    SELECT
      d.parkId,
      p.name as parkName,
      bh.amountType,
      COUNT(*) as cnt
    FROM balance_history bh
    JOIN users u ON u.id = bh.userId
    JOIN drivers d ON d.userId = u.id
    LEFT JOIN parks p ON p.id = d.parkId
    WHERE bh.type = 'waybill_fee'
    GROUP BY d.parkId, bh.amountType
  `);

  // Автозакрытия
  const autoCloses = await query(`
    SELECT
      d.parkId,
      p.name as parkName,
      bh.amountType,
      COUNT(*) as cnt
    FROM balance_history bh
    JOIN users u ON u.id = bh.userId
    JOIN drivers d ON d.userId = u.id
    LEFT JOIN parks p ON p.id = d.parkId
    WHERE bh.type = 'expense'
      AND bh.description LIKE '%Автозакрытие%'
    GROUP BY d.parkId, bh.amountType
  `);

  let totalSalaryMe = 0, totalSalaryMasis = 0, totalSalaryInal = 0;
  let totalMedic = 0, totalTaxcom = 0;
  let totalEplReal = 0, totalEplUnreal = 0;
  let totalACReal = 0, totalACUnreal = 0;

  const parkSummary = {};

  for (const row of eplByPark) {
    const key = row.parkId || 0;
    if (!parkSummary[key]) parkSummary[key] = { name: row.parkName, eplReal: 0, eplUnreal: 0, acReal: 0, acUnreal: 0 };
    if (row.amountType === 'real') {
      parkSummary[key].eplReal += row.cnt;
      totalEplReal += row.cnt;
    } else {
      parkSummary[key].eplUnreal += row.cnt;
      totalEplUnreal += row.cnt;
    }
  }

  for (const row of autoCloses) {
    const key = row.parkId || 0;
    if (!parkSummary[key]) parkSummary[key] = { name: row.parkName, eplReal: 0, eplUnreal: 0, acReal: 0, acUnreal: 0 };
    if (row.amountType === 'real') {
      parkSummary[key].acReal += row.cnt;
      totalACReal += row.cnt;
    } else {
      parkSummary[key].acUnreal += row.cnt;
      totalACUnreal += row.cnt;
    }
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log('  3. РАСХОДЫ ПО ПАРКАМ');
  console.log('══════════════════════════════════════════════════');

  for (const [pid, s] of Object.entries(parkSummary)) {
    const tulaspb = isTulaSPb(s.name);
    const salaryPer = tulaspb ? SALARY_EPL_TULA_SPB : SALARY_EPL_REGULAR;
    const medicPer = tulaspb ? 0 : MEDIC_FEE;
    const taxcomPer = tulaspb ? 0 : TAXCOM_FEE;

    const totalEpl = s.eplReal + s.eplUnreal;
    const totalAC = s.acReal + s.acUnreal;

    const salaryFromEpl = salaryPer * totalEpl;
    const salaryFromAC = SALARY_AUTO_CLOSE * totalAC;
    const medicCost = medicPer * totalEpl;
    const taxcomCost = taxcomPer * totalEpl;

    totalSalaryMe += salaryFromEpl + salaryFromAC;
    totalSalaryMasis += salaryFromEpl + salaryFromAC;
    totalSalaryInal += salaryFromEpl + salaryFromAC;
    totalMedic += medicCost;
    totalTaxcom += taxcomCost;

    const tag = tulaspb ? '(Т/СПб)' : '(обычн)';
    console.log(`\n  ${s.name || 'ID=' + pid} ${tag}:`);
    console.log(`    ЭПЛ: ${totalEpl} (${s.eplReal} реал + ${s.eplUnreal} бонус)`);
    console.log(`    Автозакрытий: ${totalAC} (${s.acReal} реал + ${s.acUnreal} бонус)`);
    console.log(`    ЗП (×1 чел): ${fmt(salaryFromEpl + salaryFromAC)}₽ | Медик: ${fmt(medicCost)}₽ | Такском: ${fmt(taxcomCost)}₽`);
  }

  const totalEplAll = totalEplReal + totalEplUnreal;
  const totalACAll = totalACReal + totalACUnreal;

  console.log('\n══════════════════════════════════════════════════');
  console.log('  4. СВОДКА РАСХОДОВ');
  console.log('══════════════════════════════════════════════════');
  console.log(`  Всего ЭПЛ:          ${totalEplAll} шт. (${totalEplReal} реал + ${totalEplUnreal} бонус)`);
  console.log(`  Всего автозакрытий: ${totalACAll} шт. (${totalACReal} реал + ${totalACUnreal} бонус)`);
  console.log('');
  console.log(`  ЗП Ты:              ${fmt(totalSalaryMe)}₽`);
  console.log(`  ЗП Масис:           ${fmt(totalSalaryMasis)}₽`);
  console.log(`  ЗП Инал:            ${fmt(totalSalaryInal)}₽`);
  console.log(`  ЗП всего (×3):      ${fmt(totalSalaryMe + totalSalaryMasis + totalSalaryInal)}₽`);
  console.log(`  Медик:              ${fmt(totalMedic)}₽`);
  console.log(`  Такском:            ${fmt(totalTaxcom)}₽`);
  const totalExpenses = totalSalaryMe + totalSalaryMasis + totalSalaryInal + totalMedic + totalTaxcom;
  console.log(`  ──────────────────────────────────────────`);
  console.log(`  ВСЕГО расходов:     ${fmt(totalExpenses)}₽`);

  // ═══════════════════════════════════════════════════════════════
  // 5. УБЫТОК ОТ БОНУСНЫХ ЭПЛ
  // ═══════════════════════════════════════════════════════════════

  // Бонусные ЭПЛ — расходы (ЗП, медик, такском) надо платить реальными деньгами,
  // но деньги в кассу за них не приходили.
  let bonusLossEpl = 0;
  let bonusLossAC = 0;

  for (const [pid, s] of Object.entries(parkSummary)) {
    const tulaspb = isTulaSPb(s.name);
    const salaryPer = tulaspb ? SALARY_EPL_TULA_SPB : SALARY_EPL_REGULAR;
    const medicPer = tulaspb ? 0 : MEDIC_FEE;
    const taxcomPer = tulaspb ? 0 : TAXCOM_FEE;

    // За каждый бонусный ЭПЛ мы тратим реальные деньги на ЗП + медик + такском,
    // но при этом 25₽ дохода от этого ЭПЛ — фантики (не реальные).
    // Весь доход за бонусный ЭПЛ — убыток.
    bonusLossEpl += s.eplUnreal * (salaryPer * 3 + medicPer + taxcomPer);
    bonusLossAC += s.acUnreal * (SALARY_AUTO_CLOSE * 3);
  }

  const totalBonusLoss = bonusLossEpl + bonusLossAC;

  console.log('\n══════════════════════════════════════════════════');
  console.log('  5. УБЫТОК ОТ БОНУСНЫХ ОПЕРАЦИЙ');
  console.log('══════════════════════════════════════════════════');
  console.log(`  ЭПЛ оплаченные бонусами:       ${totalEplUnreal} шт. → расходы: ${fmt(bonusLossEpl)}₽`);
  console.log(`  Автозакрытия из бонусов:        ${totalACUnreal} шт. → расходы: ${fmt(bonusLossAC)}₽`);
  console.log(`  ИТОГО убыток от бонусов:        ${fmt(totalBonusLoss)}₽`);
  console.log(`  (Эти расходы покрываются из реальных денег кассы)`);

  // ═══════════════════════════════════════════════════════════════
  // 6. ТЕКУЩИЕ БАЛАНСЫ ВОДИТЕЛЕЙ
  // ═══════════════════════════════════════════════════════════════

  const driverBalances = await queryOne(`
    SELECT
      COUNT(*) as cnt,
      COALESCE(SUM(balanceReal), 0) as totalReal,
      COALESCE(SUM(balanceUnreal), 0) as totalUnreal,
      COALESCE(SUM(balanceReal + balanceUnreal), 0) as totalBalance
    FROM users WHERE role = 'driver'
  `);

  // Водители с отрицательным балансом
  const negativeDrivers = await query(`
    SELECT id, username, fullName, balanceReal, balanceUnreal,
           (COALESCE(balanceReal,0) + COALESCE(balanceUnreal,0)) as total
    FROM users
    WHERE role = 'driver' AND (balanceReal < 0 OR balanceUnreal < 0 OR (COALESCE(balanceReal,0) + COALESCE(balanceUnreal,0)) < 0)
    ORDER BY total ASC
    LIMIT 15
  `);

  console.log('\n══════════════════════════════════════════════════');
  console.log('  6. БАЛАНСЫ ВОДИТЕЛЕЙ (сейчас)');
  console.log('══════════════════════════════════════════════════');
  console.log(`  Водителей: ${driverBalances.cnt}`);
  console.log(`  Общий баланс:    ${fmt(driverBalances.totalBalance)}₽`);
  console.log(`    Реальный:      ${fmt(driverBalances.totalReal)}₽  ← эти деньги ещё «в кассе» (не потрачены водителями)`);
  console.log(`    Бонусный:      ${fmt(driverBalances.totalUnreal)}₽`);

  if (negativeDrivers.length > 0) {
    console.log(`\n  ⚠️  Водители с отрицательным балансом:`);
    negativeDrivers.forEach(d => {
      console.log(`    [${d.id}] ${d.fullName || d.username}: реал=${fmt(d.balanceReal)}, бонус=${fmt(d.balanceUnreal)}, итого=${fmt(d.total)}`);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 7. ИТОГОВАЯ КАССА
  // ═══════════════════════════════════════════════════════════════

  // Деньги что «на руках» (чистые) = приход - комиссия - налог
  // Минус все расходы (ЗП, медик, Такском)
  // Минус депозиты водителей (деньги которые ещё на балансе — они «зарезервированы»)
  // = Свободные деньги

  // Реальный доход от ЭПЛ+АЗ = только за операции оплаченные реальными деньгами
  const realEplRevenue = totalEplReal * EPL_PRICE;
  const realACRevenue = totalACReal * AUTO_CLOSE_PRICE;
  const totalRealRevenue = realEplRevenue + realACRevenue;

  // Расходы только по real-операциям
  let realExpenses = 0;
  for (const [pid, s] of Object.entries(parkSummary)) {
    const tulaspb = isTulaSPb(s.name);
    const salaryPer = tulaspb ? SALARY_EPL_TULA_SPB : SALARY_EPL_REGULAR;
    const medicPer = tulaspb ? 0 : MEDIC_FEE;
    const taxcomPer = tulaspb ? 0 : TAXCOM_FEE;
    realExpenses += s.eplReal * (salaryPer * 3 + medicPer + taxcomPer);
    realExpenses += s.acReal * (SALARY_AUTO_CLOSE * 3);
  }

  console.log('\n' + '═'.repeat(80));
  console.log('  7. ИТОГО КАССА');
  console.log('═'.repeat(80));
  console.log('');
  console.log(`  Приход (ЮКасса):                   +${fmt(yukassaRow.total)}₽`);
  console.log(`  Приход (админ реал):                +${fmt(adminRealTopupsClamped)}₽`);
  console.log(`  ──────────────────────────────────────────`);
  console.log(`  Валовой приход:                     ${fmt(realTopups.total)}₽`);
  console.log(`  Комиссия ЮКассы 4.7%:              -${fmt(yukassaCommission)}₽`);
  console.log(`  Налог 13%:                         -${fmt(tax)}₽`);
  console.log(`  ──────────────────────────────────────────`);
  console.log(`  ЧИСТЫЙ ПРИХОД:                      ${fmt(cleanMoney)}₽`);
  console.log('');
  console.log(`  Расходы за real-ЭПЛ и АЗ:`);
  console.log(`    ЗП (×3 чел):                     -${fmt(realExpenses)}₽`);
  console.log(`  Убыток от бонусных ЭПЛ/АЗ:         -${fmt(totalBonusLoss)}₽`);
  console.log(`  ──────────────────────────────────────────`);
  const cashAfterExpenses = cleanMoney - realExpenses - totalBonusLoss;
  console.log(`  ПОСЛЕ РАСХОДОВ:                     ${fmt(cashAfterExpenses)}₽`);
  console.log('');
  console.log(`  На балансах водителей (реал):       -${fmt(driverBalances.totalReal)}₽  (зарезервировано)`);
  console.log(`  ──────────────────────────────────────────`);
  const freeCash = cashAfterExpenses - (driverBalances.totalReal || 0);
  console.log(`  💰 СВОБОДНЫЙ ОСТАТОК КАССЫ:         ${fmt(freeCash)}₽`);
  console.log('');

  if (freeCash < 0) {
    console.log(`  ⚠️  КАССА В МИНУСЕ! Бонусные ЭПЛ и/или расходы превысили реальный доход.`);
  }

  console.log('═'.repeat(80));

  // Дополнительная детализация — помесячно
  const monthly = await query(`
    SELECT
      strftime('%Y-%m', bh.createdAt) as month,
      SUM(CASE WHEN bh.type = 'topup' AND bh.amountType = 'real' THEN bh.amount ELSE 0 END) as topupReal,
      SUM(CASE WHEN bh.type = 'topup' AND bh.amountType = 'unreal' THEN bh.amount ELSE 0 END) as topupUnreal,
      SUM(CASE WHEN bh.type = 'waybill_fee' THEN 1 ELSE 0 END) as eplCount,
      SUM(CASE WHEN bh.type = 'expense' AND bh.description LIKE '%Автозакрытие%' THEN 1 ELSE 0 END) as acCount,
      SUM(CASE WHEN bh.type IN ('waybill_fee','expense') AND bh.amountType = 'real' THEN ABS(bh.amount) ELSE 0 END) as spentReal,
      SUM(CASE WHEN bh.type IN ('waybill_fee','expense') AND bh.amountType = 'unreal' THEN ABS(bh.amount) ELSE 0 END) as spentUnreal
    FROM balance_history bh
    GROUP BY month
    ORDER BY month DESC
  `);

  if (monthly.length > 0) {
    console.log('\n  ПОМЕСЯЧНАЯ СТАТИСТИКА:');
    console.log('  ─────────────────────────────────────────────────────────────────────');
    console.log('  Месяц      | Приход реал | Бонусы  | ЭПЛ  | АЗ  | Расход реал | Расход бонус');
    console.log('  ─────────────────────────────────────────────────────────────────────');
    monthly.forEach(m => {
      console.log(`  ${m.month}    | ${fmt(m.topupReal).padStart(10)} | ${fmt(m.topupUnreal).padStart(7)} | ${String(m.eplCount).padStart(4)} | ${String(m.acCount).padStart(3)} | ${fmt(m.spentReal).padStart(10)} | ${fmt(m.spentUnreal).padStart(10)}`);
    });
  }

  console.log('');
  db.close();
}

main().catch(err => {
  console.error('Ошибка:', err);
  db.close();
});
