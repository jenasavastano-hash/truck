const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken } = require('../auth');
const {
  YUKASSA_COMMISSION, TAX_RATE, EPL_PRICE, AUTO_CLOSE_PRICE,
  SALARY_EPL_REGULAR, SALARY_EPL_TULA_SPB, SALARY_AUTO_CLOSE,
  MEDIC_FEE, TAXCOM_FEE, isTulaSPb,
} = require('../utils/finance-constants');

function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}
function q1(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row || {}));
  });
}

function fmtDate(dateStr) {
  if (!dateStr) return dateStr;
  const [y, m, d] = dateStr.split('-');
  return `${d}.${m}.${y}`;
}

async function authorizeFinance(req, res, next) {
  const { role, userId } = req.user;
  if (role === 'admin') {
    req.financeScope = 'all';
    req.financePermissions = {
      showKassa: true, showSalary: true, showParks: true, showMonthly: true,
    };
    return next();
  }

  let staffRow = null;
  const table = role === 'manager' ? 'managers' : role === 'director' ? 'directors' : null;
  if (table) {
    staffRow = await q1(`SELECT * FROM ${table} WHERE userId = ?`, [userId]);
  }

  if (!staffRow || !staffRow.canAccessFinance) {
    return res.status(403).json({ error: 'No access to finance' });
  }

  req.financeScope = staffRow.financeScopeAll ? 'all' : 'own';
  req.financeParkId = staffRow.parkId;
  req.financePermissions = {
    showKassa: !!staffRow.financeShowKassa,
    showSalary: !!staffRow.financeShowSalary,
    showParks: !!staffRow.financeShowParks,
    showMonthly: !!staffRow.financeShowMonthly,
  };
  next();
}

function parkFilter(scope, parkId) {
  if (scope === 'all') return { where: '', params: [] };
  return { where: ' AND d.parkId = ?', params: [parkId] };
}

router.get('/finance', authenticateToken, authorizeFinance, async (req, res) => {
  try {
    const scope = req.financeScope;
    const parkId = req.financeParkId;
    const perms = req.financePermissions;
    const pf = parkFilter(scope, parkId);

    const result = { permissions: perms };

    // --- SUMMARY (Касса) ---
    if (perms.showKassa) {
      let yukassa, realTopups, adminReal;
      if (scope === 'all') {
        yukassa = await q1(`SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total FROM payments WHERE status='succeeded'`);
        realTopups = await q1(`SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total FROM balance_history WHERE type='topup' AND amountType='real'`);
      } else {
        yukassa = await q1(`SELECT COUNT(*) as cnt, COALESCE(SUM(p.amount),0) as total FROM payments p JOIN users u ON u.id=p.userId JOIN drivers drv ON drv.userId=u.id WHERE p.status='succeeded' AND drv.parkId=?`, [parkId]);
        realTopups = await q1(`SELECT COUNT(*) as cnt, COALESCE(SUM(bh.amount),0) as total FROM balance_history bh JOIN users u ON u.id=bh.userId JOIN drivers drv ON drv.userId=u.id WHERE bh.type='topup' AND bh.amountType='real' AND drv.parkId=?`, [parkId]);
      }
      adminReal = Math.max(0, (realTopups.total || 0) - (yukassa.total || 0));
      const yukassaComm = (yukassa.total || 0) * YUKASSA_COMMISSION;
      const afterComm = (yukassa.total || 0) - yukassaComm + adminReal;
      const tax = afterComm * TAX_RATE;
      const cleanMoney = afterComm - tax;

      const eplByPark = await q(`
        SELECT d.parkId, p.name as parkName, bh.amountType, COUNT(*) as cnt
        FROM balance_history bh
        JOIN users u ON u.id=bh.userId JOIN drivers d ON d.userId=u.id
        LEFT JOIN parks p ON p.id=d.parkId
        WHERE bh.type='waybill_fee'${pf.where}
        GROUP BY d.parkId, bh.amountType
      `, pf.params);

      const acByPark = await q(`
        SELECT d.parkId, p.name as parkName, bh.amountType, COUNT(*) as cnt
        FROM balance_history bh
        JOIN users u ON u.id=bh.userId JOIN drivers d ON d.userId=u.id
        LEFT JOIN parks p ON p.id=d.parkId
        WHERE bh.type='expense' AND bh.description LIKE '%Автозакрытие%'${pf.where}
        GROUP BY d.parkId, bh.amountType
      `, pf.params);

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

      const cleanEplPrice = EPL_PRICE * (1 - YUKASSA_COMMISSION) * (1 - TAX_RATE);
      const cleanACPrice = AUTO_CLOSE_PRICE * (1 - YUKASSA_COMMISSION) * (1 - TAX_RATE);

      let totSalMe = 0, totMedic = 0, totTaxcom = 0, totEplAll = 0, totACAll = 0, totRemainder = 0;
      for (const [, s] of Object.entries(ps)) {
        const t = isTulaSPb(s.name);
        const sp = t ? SALARY_EPL_TULA_SPB : SALARY_EPL_REGULAR;
        const mp = t ? 0 : MEDIC_FEE;
        const tp = t ? 0 : TAXCOM_FEE;
        const totalEpl = s.eplR + s.eplU;
        const totalAC = s.acR + s.acU;
        const sal = sp * totalEpl + SALARY_AUTO_CLOSE * totalAC;
        totSalMe += sal;
        totMedic += mp * totalEpl;
        totTaxcom += tp * totalEpl;
        totEplAll += totalEpl;
        totACAll += totalAC;
        totRemainder += (cleanEplPrice - sp * 3 - mp - tp) * totalEpl + (cleanACPrice - SALARY_AUTO_CLOSE * 3) * totalAC;
      }

      const totalExp = totSalMe * 3 + totMedic + totTaxcom;
      const cashAfterExp = cleanMoney - totalExp;

      let driverBal;
      if (scope === 'all') {
        driverBal = await q1(`SELECT COUNT(*) as cnt, COALESCE(SUM(balanceReal),0) as totalReal, COALESCE(SUM(balanceUnreal),0) as totalUnreal FROM users WHERE role='driver'`);
      } else {
        driverBal = await q1(`SELECT COUNT(*) as cnt, COALESCE(SUM(u.balanceReal),0) as totalReal, COALESCE(SUM(u.balanceUnreal),0) as totalUnreal FROM users u JOIN drivers d ON d.userId=u.id WHERE u.role='driver' AND d.parkId=?`, [parkId]);
      }

      const freeCash = cashAfterExp - (driverBal.totalReal || 0);

      result.summary = {
        yukassaTotal: yukassa.total || 0,
        yukassaCnt: yukassa.cnt || 0,
        adminReal,
        realTotal: realTopups.total || 0,
        yukassaComm,
        tax,
        cleanMoney,
        totEplAll,
        totACAll,
        salaryMe: totSalMe,
        salaryMasis: totSalMe,
        salaryInal: totSalMe,
        medic: totMedic,
        taxcom: totTaxcom,
        totalExp,
        cashAfterExp,
        driverBalReal: driverBal.totalReal || 0,
        driverBalUnreal: driverBal.totalUnreal || 0,
        driverCnt: driverBal.cnt || 0,
        remainder: totRemainder,
        freeCash,
        cleanEplPrice,
        cleanACPrice,
      };
    }

    // --- DAILY (ЗП по дням) ---
    if (perms.showSalary) {
      const dailyData = await q(`
        SELECT date(bh.createdAt) as day, d.parkId, p.name as parkName, bh.amountType, bh.type as bhType,
          CASE WHEN bh.description LIKE '%Автозакрытие%' THEN 1 ELSE 0 END as isAutoClose, COUNT(*) as cnt
        FROM balance_history bh
        JOIN users u ON u.id=bh.userId JOIN drivers d ON d.userId=u.id
        LEFT JOIN parks p ON p.id=d.parkId
        WHERE bh.type IN ('waybill_fee','expense') AND (bh.type='waybill_fee' OR bh.description LIKE '%Автозакрытие%')${pf.where}
        GROUP BY day, d.parkId, bh.amountType, isAutoClose ORDER BY day DESC
      `, pf.params);

      const dayMap = {};
      for (const row of dailyData) {
        if (!dayMap[row.day]) dayMap[row.day] = { eplReg: 0, eplTS: 0, ac: 0 };
        const d = dayMap[row.day];
        const ts = isTulaSPb(row.parkName);
        const cnt = row.cnt;
        if (row.isAutoClose) { d.ac += cnt; }
        else if (ts) { d.eplTS += cnt; }
        else { d.eplReg += cnt; }
      }

      result.daily = Object.keys(dayMap).sort().reverse().map(day => {
        const d = dayMap[day];
        const salMe = SALARY_EPL_REGULAR * d.eplReg + SALARY_EPL_TULA_SPB * d.eplTS + SALARY_AUTO_CLOSE * d.ac;
        const medic = MEDIC_FEE * d.eplReg;
        const taxcom = TAXCOM_FEE * d.eplReg;
        const totalDayExp = salMe * 3 + medic + taxcom;
        const gross = (d.eplReg + d.eplTS) * EPL_PRICE + d.ac * AUTO_CLOSE_PRICE;
        const net = gross * (1 - YUKASSA_COMMISSION) * (1 - TAX_RATE);
        return {
          day: fmtDate(day),
          eplReg: d.eplReg,
          eplTS: d.eplTS,
          ac: d.ac,
          salaryPer: salMe,
          medic,
          taxcom,
          totalExp: totalDayExp,
          remainder: net - totalDayExp,
        };
      });
    }

    // --- PARKS (По паркам) ---
    if (perms.showParks) {
      const eplByParkFull = await q(`
        SELECT d.parkId, p.name as parkName, bh.amountType, COUNT(*) as cnt
        FROM balance_history bh
        JOIN users u ON u.id=bh.userId JOIN drivers d ON d.userId=u.id
        LEFT JOIN parks p ON p.id=d.parkId
        WHERE bh.type='waybill_fee'${pf.where}
        GROUP BY d.parkId, bh.amountType
      `, pf.params);

      const acByParkFull = await q(`
        SELECT d.parkId, p.name as parkName, bh.amountType, COUNT(*) as cnt
        FROM balance_history bh
        JOIN users u ON u.id=bh.userId JOIN drivers d ON d.userId=u.id
        LEFT JOIN parks p ON p.id=d.parkId
        WHERE bh.type='expense' AND bh.description LIKE '%Автозакрытие%'${pf.where}
        GROUP BY d.parkId, bh.amountType
      `, pf.params);

      const parkStats = {};
      for (const r of eplByParkFull) {
        const k = r.parkId || 0;
        if (!parkStats[k]) parkStats[k] = { name: r.parkName, eplR: 0, eplU: 0, acR: 0, acU: 0 };
        if (r.amountType === 'real') parkStats[k].eplR += r.cnt; else parkStats[k].eplU += r.cnt;
      }
      for (const r of acByParkFull) {
        const k = r.parkId || 0;
        if (!parkStats[k]) parkStats[k] = { name: r.parkName, eplR: 0, eplU: 0, acR: 0, acU: 0 };
        if (r.amountType === 'real') parkStats[k].acR += r.cnt; else parkStats[k].acU += r.cnt;
      }

      const cep = EPL_PRICE * (1 - YUKASSA_COMMISSION) * (1 - TAX_RATE);
      const cap = AUTO_CLOSE_PRICE * (1 - YUKASSA_COMMISSION) * (1 - TAX_RATE);

      result.parks = Object.entries(parkStats).map(([pid, s]) => {
        const t = isTulaSPb(s.name);
        const sp = t ? SALARY_EPL_TULA_SPB : SALARY_EPL_REGULAR;
        const mp = t ? 0 : MEDIC_FEE;
        const tp = t ? 0 : TAXCOM_FEE;
        const totalEpl = s.eplR + s.eplU;
        const totalAC = s.acR + s.acU;
        const remPerEpl = cep - sp * 3 - mp - tp;
        const remPerAC = cap - SALARY_AUTO_CLOSE * 3;
        const parkExpenses = (sp * 3 + mp + tp) * totalEpl + (SALARY_AUTO_CLOSE * 3) * totalAC;
        const parkRemainder = remPerEpl * totalEpl + remPerAC * totalAC;
        return {
          id: pid, name: s.name || `ID=${pid}`,
          type: t ? 'Тула/СПб' : 'Обычный',
          epl: totalEpl, ac: totalAC,
          salaryPerEpl: sp, medicPerEpl: mp, taxcomPerEpl: tp,
          remainderPerEpl: remPerEpl,
          expenses: parkExpenses,
          remainder: parkRemainder,
        };
      });

      result.parkFormulas = {
        cleanEplPrice: cep,
        cleanACPrice: cap,
        regularRemainder: cep - SALARY_EPL_REGULAR * 3 - MEDIC_FEE - TAXCOM_FEE,
        tulaSPbRemainder: cep - SALARY_EPL_TULA_SPB * 3,
        acRemainder: cap - SALARY_AUTO_CLOSE * 3,
      };
    }

    // --- MONTHLY (Помесячно) ---
    if (perms.showMonthly) {
      const monthly = await q(`
        SELECT strftime('%Y-%m', bh.createdAt) as month,
          SUM(CASE WHEN bh.type='topup' AND bh.amountType='real' THEN bh.amount ELSE 0 END) as topupReal,
          SUM(CASE WHEN bh.type='topup' AND bh.amountType='unreal' THEN bh.amount ELSE 0 END) as topupUnreal,
          SUM(CASE WHEN bh.type='waybill_fee' THEN 1 ELSE 0 END) as eplCount,
          SUM(CASE WHEN bh.type='expense' AND bh.description LIKE '%Автозакрытие%' THEN 1 ELSE 0 END) as acCount,
          SUM(CASE WHEN bh.type IN ('waybill_fee','expense') AND bh.amountType='real' THEN ABS(bh.amount) ELSE 0 END) as spentReal,
          SUM(CASE WHEN bh.type IN ('waybill_fee','expense') AND bh.amountType='unreal' THEN ABS(bh.amount) ELSE 0 END) as spentUnreal
        FROM balance_history bh
        ${scope !== 'all' ? 'JOIN users u ON u.id=bh.userId JOIN drivers d ON d.userId=u.id' : ''}
        ${scope !== 'all' ? 'WHERE d.parkId = ?' : ''}
        GROUP BY month ORDER BY month DESC
      `, scope !== 'all' ? [parkId] : []);

      result.monthly = monthly.map(m => {
        const netIncome = (m.topupReal || 0) * (1 - YUKASSA_COMMISSION) * (1 - TAX_RATE);
        const estSal = (m.eplCount || 0) * SALARY_EPL_REGULAR + (m.acCount || 0) * SALARY_AUTO_CLOSE;
        return {
          month: m.month ? m.month.split('-').reverse().join('.') : '',
          topupReal: m.topupReal || 0,
          topupUnreal: m.topupUnreal || 0,
          eplCount: m.eplCount || 0,
          acCount: m.acCount || 0,
          spentReal: m.spentReal || 0,
          spentUnreal: m.spentUnreal || 0,
          netIncome,
          estSalary: estSal,
        };
      });
    }

    res.json(result);
  } catch (err) {
    console.error('Finance API error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/finance/export', authenticateToken, authorizeFinance, async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Грузовые ЭПЛ Report';
    workbook.created = new Date();

    const scope = req.financeScope;
    const parkId = req.financeParkId;
    const pf = parkFilter(scope, parkId);

    const yukassa = scope === 'all'
      ? await q1(`SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total FROM payments WHERE status='succeeded'`)
      : await q1(`SELECT COUNT(*) as cnt, COALESCE(SUM(p.amount),0) as total FROM payments p JOIN users u ON u.id=p.userId JOIN drivers drv ON drv.userId=u.id WHERE p.status='succeeded' AND drv.parkId=?`, [parkId]);

    const realTopups = scope === 'all'
      ? await q1(`SELECT COALESCE(SUM(amount),0) as total FROM balance_history WHERE type='topup' AND amountType='real'`)
      : await q1(`SELECT COALESCE(SUM(bh.amount),0) as total FROM balance_history bh JOIN users u ON u.id=bh.userId JOIN drivers drv ON drv.userId=u.id WHERE bh.type='topup' AND bh.amountType='real' AND drv.parkId=?`, [parkId]);

    const adminReal = Math.max(0, (realTopups.total || 0) - (yukassa.total || 0));
    const yukassaComm = (yukassa.total || 0) * YUKASSA_COMMISSION;
    const afterComm = (yukassa.total || 0) - yukassaComm + adminReal;
    const tax = afterComm * TAX_RATE;
    const cleanMoney = afterComm - tax;

    const ws = workbook.addWorksheet('Касса');
    ws.columns = [{ width: 45 }, { width: 20 }];

    let r = 1;
    const addRow = (label, value, bold) => {
      const row = ws.getRow(r);
      row.getCell(1).value = label;
      if (value !== null && value !== undefined) {
        row.getCell(2).value = value;
        row.getCell(2).numFmt = '#,##0.00 "₽"';
      }
      if (bold) { row.getCell(1).font = { bold: true }; row.getCell(2).font = { bold: true }; }
      r++;
    };

    addRow('КАССА — СВОДКА', null, true);
    const now = new Date();
    addRow(`Дата: ${String(now.getDate()).padStart(2,'0')}.${String(now.getMonth()+1).padStart(2,'0')}.${now.getFullYear()}`, null);
    r++;
    addRow('Приход ЮКасса', yukassa.total || 0);
    addRow('Приход админ (реал)', adminReal);
    addRow('ИТОГО реальный приход', realTopups.total || 0, true);
    r++;
    addRow('Комиссия ЮКассы (4.7%)', -yukassaComm);
    addRow('Налог (13%)', -tax);
    addRow('ЧИСТЫЙ ПРИХОД', cleanMoney, true);

    const buf = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Kassa_${now.toISOString().slice(0,10)}.xlsx`);
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error('Finance export error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
