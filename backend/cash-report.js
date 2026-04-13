const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'app.db');
const db = new sqlite3.Database(DB_PATH);

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function fmt(n) {
  return (n || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  console.log('='.repeat(70));
  console.log('  ОТЧЁТ ПО КАССЕ');
  console.log('  Дата: ' + new Date().toLocaleString('ru-RU'));
  console.log('='.repeat(70));

  // 1. Суммарные балансы водителей
  const balances = await query(`
    SELECT 
      COUNT(*) as total_drivers,
      SUM(COALESCE(balance, 0)) as total_balance,
      SUM(COALESCE(balanceReal, 0)) as total_real,
      SUM(COALESCE(balanceUnreal, 0)) as total_unreal
    FROM users WHERE role = 'driver'
  `);
  const b = balances[0];
  console.log('\n--- БАЛАНСЫ ВОДИТЕЛЕЙ ---');
  console.log(`Всего водителей: ${b.total_drivers}`);
  console.log(`Общий баланс:     ${fmt(b.total_balance)} руб.`);
  console.log(`  Реальный:        ${fmt(b.total_real)} руб.`);
  console.log(`  Бонусный:        ${fmt(b.total_unreal)} руб.`);

  // 2. Пополнения (все типы)
  const topups = await query(`
    SELECT 
      type,
      amountType,
      COUNT(*) as cnt,
      SUM(amount) as total
    FROM balance_history
    WHERE amount > 0
    GROUP BY type, amountType
    ORDER BY type, amountType
  `);
  console.log('\n--- ПОПОЛНЕНИЯ (amount > 0) ---');
  let totalTopup = 0;
  let totalTopupReal = 0;
  let totalTopupUnreal = 0;
  topups.forEach(r => {
    console.log(`  ${r.type || 'null'} [${r.amountType || '?'}]: ${r.cnt} операций, сумма: ${fmt(r.total)} руб.`);
    totalTopup += r.total || 0;
    if (r.amountType === 'real') totalTopupReal += r.total || 0;
    if (r.amountType === 'unreal') totalTopupUnreal += r.total || 0;
  });
  console.log(`  ИТОГО пополнений: ${fmt(totalTopup)} руб. (реал: ${fmt(totalTopupReal)}, бонус: ${fmt(totalTopupUnreal)})`);

  // 3. Списания (расходы)
  const expenses = await query(`
    SELECT 
      type,
      amountType,
      COUNT(*) as cnt,
      SUM(amount) as total
    FROM balance_history
    WHERE amount < 0
    GROUP BY type, amountType
    ORDER BY type, amountType
  `);
  console.log('\n--- СПИСАНИЯ (amount < 0) ---');
  let totalExpense = 0;
  let totalExpenseReal = 0;
  let totalExpenseUnreal = 0;
  expenses.forEach(r => {
    console.log(`  ${r.type || 'null'} [${r.amountType || '?'}]: ${r.cnt} операций, сумма: ${fmt(r.total)} руб.`);
    totalExpense += r.total || 0;
    if (r.amountType === 'real') totalExpenseReal += r.total || 0;
    if (r.amountType === 'unreal') totalExpenseUnreal += r.total || 0;
  });
  console.log(`  ИТОГО списаний: ${fmt(totalExpense)} руб. (реал: ${fmt(totalExpenseReal)}, бонус: ${fmt(totalExpenseUnreal)})`);

  // 4. Платежи через ЮКассу
  const payments = await query(`
    SELECT 
      status,
      COUNT(*) as cnt,
      SUM(amount) as total
    FROM payments
    GROUP BY status
    ORDER BY status
  `);
  console.log('\n--- ПЛАТЕЖИ ЮКАССА ---');
  payments.forEach(r => {
    console.log(`  ${r.status}: ${r.cnt} шт., сумма: ${fmt(r.total)} руб.`);
  });

  // 5. Сколько заработано на ЭПЛ (путевых) — списания типа waybill_fee
  const eplFees = await query(`
    SELECT 
      amountType,
      COUNT(*) as cnt,
      SUM(ABS(amount)) as total
    FROM balance_history
    WHERE type = 'waybill_fee'
    GROUP BY amountType
  `);
  console.log('\n--- ДОХОД С ЭПЛ (waybill_fee) ---');
  let totalEplFee = 0;
  eplFees.forEach(r => {
    console.log(`  [${r.amountType || '?'}]: ${r.cnt} списаний, сумма: ${fmt(r.total)} руб.`);
    totalEplFee += r.total || 0;
  });
  console.log(`  ИТОГО доход с ЭПЛ: ${fmt(totalEplFee)} руб.`);

  // 6. Штрафы
  const fines = await query(`
    SELECT 
      amountType,
      COUNT(*) as cnt,
      SUM(ABS(amount)) as total
    FROM balance_history
    WHERE type = 'fine'
    GROUP BY amountType
  `);
  console.log('\n--- ШТРАФЫ ---');
  let totalFines = 0;
  fines.forEach(r => {
    console.log(`  [${r.amountType || '?'}]: ${r.cnt} шт., сумма: ${fmt(r.total)} руб.`);
    totalFines += r.total || 0;
  });
  console.log(`  ИТОГО штрафов: ${fmt(totalFines)} руб.`);

  // 7. Тарифы парков (сколько стоит ЭПЛ)
  const rates = await query(`
    SELECT 
      wr.parkId,
      p.name as parkName,
      wr.eplCreationFee,
      wr.autoCloseFee,
      wr.commissionPercent
    FROM waybill_rates wr
    LEFT JOIN parks p ON p.id = wr.parkId
    WHERE wr.isActive = 1
  `);
  console.log('\n--- ТАРИФЫ ПАРКОВ ---');
  rates.forEach(r => {
    console.log(`  Парк: ${r.parkName || 'ID=' + r.parkId} | ЭПЛ: ${fmt(r.eplCreationFee)} | Автозакрытие: ${fmt(r.autoCloseFee)} | Комиссия: ${r.commissionPercent || 0}%`);
  });

  // 8. Сколько надо заплатить медикам (park_staff с role=medic)
  const medics = await query(`
    SELECT 
      ps.fullName,
      ps.parkId,
      p.name as parkName,
      (SELECT COUNT(*) FROM epl e WHERE e.parkId = ps.parkId AND e.status IN ('approved', 'signed', 'submitted')) as eplCount
    FROM park_staff ps
    LEFT JOIN parks p ON p.id = ps.parkId
    WHERE ps.role = 'medic'
  `);
  console.log('\n--- МЕДИКИ (park_staff) ---');
  medics.forEach(r => {
    console.log(`  ${r.fullName} (парк: ${r.parkName || r.parkId}) — ЭПЛ обработано: ${r.eplCount}`);
  });

  // 9. Парки — статистика ЭПЛ
  const parkStats = await query(`
    SELECT 
      p.id,
      p.name,
      (SELECT COUNT(*) FROM epl e WHERE e.parkId = p.id) as totalEpl,
      (SELECT COUNT(*) FROM epl e WHERE e.parkId = p.id AND e.status = 'approved') as approvedEpl,
      (SELECT COUNT(*) FROM users u WHERE u.parkId = p.id AND u.role = 'driver') as driversCount,
      (SELECT COALESCE(SUM(ABS(bh.amount)), 0) FROM balance_history bh 
       INNER JOIN users u ON u.id = bh.userId AND u.parkId = p.id
       WHERE bh.type = 'waybill_fee') as totalEplRevenue,
      (SELECT COALESCE(SUM(bh.amount), 0) FROM balance_history bh
       INNER JOIN users u ON u.id = bh.userId AND u.parkId = p.id
       WHERE bh.type = 'topup' OR bh.type = 'admin_topup') as totalTopups
    FROM parks p
    ORDER BY p.id
  `);
  console.log('\n--- СТАТИСТИКА ПО ПАРКАМ ---');
  parkStats.forEach(r => {
    console.log(`  [${r.id}] ${r.name}: ${r.driversCount} водит., ${r.totalEpl} ЭПЛ (${r.approvedEpl} одобр.), доход ЭПЛ: ${fmt(r.totalEplRevenue)}, пополнения: ${fmt(r.totalTopups)}`);
  });

  // 10. Такском — расходы (сколько ЭПЛ было создано и отправлено)
  const taxcomStats = await query(`
    SELECT 
      status,
      COUNT(*) as cnt
    FROM epl
    GROUP BY status
    ORDER BY status
  `);
  console.log('\n--- ЭПЛ ПО СТАТУСАМ (расход Такском) ---');
  let totalEplCreated = 0;
  taxcomStats.forEach(r => {
    console.log(`  ${r.status}: ${r.cnt} шт.`);
    totalEplCreated += r.cnt;
  });
  console.log(`  ИТОГО ЭПЛ: ${totalEplCreated}`);

  // 11. Смены — статистика автозакрытий (за них берётся доп. плата)
  const shiftStats = await query(`
    SELECT 
      status,
      COUNT(*) as cnt
    FROM shifts
    GROUP BY status
  `);
  console.log('\n--- СМЕНЫ ---');
  shiftStats.forEach(r => {
    console.log(`  ${r.status}: ${r.cnt}`);
  });

  // 12. Эвакуаторы — заработок
  const evacStats = await query(`
    SELECT 
      status,
      COUNT(*) as cnt,
      SUM(COALESCE(requestFeeAmount, 0)) as totalFees,
      SUM(COALESCE(evacuatorFeeAmount, 0)) as totalEvacFees
    FROM evacuator_requests
    GROUP BY status
  `);
  if (evacStats.length > 0) {
    console.log('\n--- ЭВАКУАТОРЫ ---');
    evacStats.forEach(r => {
      console.log(`  ${r.status}: ${r.cnt} заявок, сборы: ${fmt(r.totalFees)}, комиссия эвак.: ${fmt(r.totalEvacFees)}`);
    });
  }

  // 13. Комиссары — заработок
  const commStats = await query(`
    SELECT 
      status,
      COUNT(*) as cnt,
      SUM(COALESCE(requestFeeAmount, 0)) as totalFees,
      SUM(COALESCE(commissionerFeeAmount, 0)) as totalCommFees
    FROM commissioner_requests
    GROUP BY status
  `);
  if (commStats.length > 0) {
    console.log('\n--- АВАРИЙНЫЕ КОМИССАРЫ ---');
    commStats.forEach(r => {
      console.log(`  ${r.status}: ${r.cnt} заявок, сборы: ${fmt(r.totalFees)}, комиссия комиссара: ${fmt(r.totalCommFees)}`);
    });
  }

  // 14. Детализация по операциям за последние 30 дней
  const recent = await query(`
    SELECT 
      type,
      amountType,
      COUNT(*) as cnt,
      SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as income,
      SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as outcome
    FROM balance_history
    WHERE createdAt >= datetime('now', '-30 days')
    GROUP BY type, amountType
    ORDER BY type
  `);
  console.log('\n--- ПОСЛЕДНИЕ 30 ДНЕЙ (balance_history) ---');
  let monthIncome = 0, monthOutcome = 0;
  recent.forEach(r => {
    console.log(`  ${r.type || 'null'} [${r.amountType || '?'}]: ${r.cnt} операций | приход: ${fmt(r.income)} | расход: ${fmt(r.outcome)}`);
    monthIncome += r.income || 0;
    monthOutcome += r.outcome || 0;
  });
  console.log(`  ИТОГО за 30 дней: приход ${fmt(monthIncome)}, расход ${fmt(monthOutcome)}, разница: ${fmt(monthIncome - monthOutcome)}`);

  // 15. Пользователи с отрицательным балансом
  const negativeBalance = await query(`
    SELECT id, username, fullName, balance, balanceReal, balanceUnreal, parkId
    FROM users
    WHERE role = 'driver' AND (balance < 0 OR balanceReal < 0)
    ORDER BY balance ASC
    LIMIT 20
  `);
  if (negativeBalance.length > 0) {
    console.log('\n--- ВОДИТЕЛИ С ОТРИЦАТЕЛЬНЫМ БАЛАНСОМ (топ 20) ---');
    negativeBalance.forEach(r => {
      console.log(`  [${r.id}] ${r.fullName || r.username}: баланс=${fmt(r.balance)}, реал=${fmt(r.balanceReal)}, бонус=${fmt(r.balanceUnreal)}`);
    });
  }

  // 16. Сводка — кому надо платить
  console.log('\n' + '='.repeat(70));
  console.log('  СВОДКА: КОМУ НУЖНО ЗАПЛАТИТЬ');
  console.log('='.repeat(70));

  // Медики
  console.log('\n  МЕДИКИ:');
  for (const m of medics) {
    const rate = rates.find(r => r.parkId === m.parkId);
    console.log(`    ${m.fullName} (${m.parkName}) — ${m.eplCount} ЭПЛ`);
  }

  // Такском — количество ЭПЛ, которые реально были созданы
  const taxcomPaid = await query(`
    SELECT COUNT(*) as cnt FROM epl WHERE status IN ('approved', 'signed', 'submitted', 'pending')
  `);
  console.log(`\n  ТАКСКОМ: ${taxcomPaid[0].cnt} ЭПЛ создано/отправлено`);

  // Сотрудники (park_staff)
  const allStaff = await query(`
    SELECT ps.role, ps.fullName, ps.parkId, p.name as parkName
    FROM park_staff ps
    LEFT JOIN parks p ON p.id = ps.parkId
    ORDER BY ps.parkId, ps.role
  `);
  console.log('\n  СОТРУДНИКИ ПАРКОВ:');
  allStaff.forEach(s => {
    const roleLabel = s.role === 'medic' ? 'Медик' : s.role === 'technic' ? 'Механик' : 'Диспетчер';
    console.log(`    ${roleLabel}: ${s.fullName} (${s.parkName})`);
  });

  console.log('\n' + '='.repeat(70));
  console.log('  ОБЩИЙ ПРИХОД (все пополнения):  ' + fmt(totalTopup) + ' руб.');
  console.log('  ОБЩИЙ РАСХОД (все списания):    ' + fmt(Math.abs(totalExpense)) + ' руб.');
  console.log('  КАССА (приход - расход):         ' + fmt(totalTopup + totalExpense) + ' руб.');
  console.log('  В т.ч. РЕАЛЬНЫЕ деньги:          ' + fmt(totalTopupReal + totalExpenseReal) + ' руб.');
  console.log('  В т.ч. БОНУСНЫЕ:                 ' + fmt(totalTopupUnreal + totalExpenseUnreal) + ' руб.');
  console.log('='.repeat(70));

  db.close();
}

main().catch(err => {
  console.error('Ошибка:', err);
  db.close();
});
