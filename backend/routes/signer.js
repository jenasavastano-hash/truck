/**
 * API для скрипта подписания на ПК с КриптоПро.
 * Авторизация: заголовок Authorization: Bearer <SIGNER_API_KEY> (из .env).
 * См. ПОДПИСЬ_ЭПЛ_КРИПТОПРО.md
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const eplSign = require('../services/epl-sign');

const SIGNER_API_KEY = process.env.SIGNER_API_KEY || '';

function requireSignerKey(req, res, next) {
  if (!SIGNER_API_KEY) {
    return res.status(503).json({ error: 'SIGNER_API_KEY не задан. Добавьте в .env.' });
  }
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim();
  if (token !== SIGNER_API_KEY) {
    return res.status(401).json({ error: 'Неверный или отсутствующий ключ' });
  }
  next();
}

router.use(requireSignerKey);

/** Роль подписанта по коду титула */
const TITLE_SIGNER_ROLE = {
  t1: 'dispatcher',
  t2: 'medic',
  t3: 'mechanic',
  t4: 'mechanic',
  t5: 'mechanic',
  t6: 'medic'
};

/**
 * GET /api/signer/pending
 * Список ЭПЛ, у которых есть титулы со статусом filled (ждут подписи).
 * Для каждого титула: id, titleCode, dataToSign (строка для КриптоПро), signerRole.
 */
router.get('/pending', (req, res) => {
  const parkId = req.query.parkId ? Number(req.query.parkId) : null;
  const parkFilter = parkId ? ' AND e.parkId = ?' : '';
  const params = parkId ? [parkId] : [];
  db.all(
    `SELECT et.id as titleId, et.eplId, et.titleCode, et.status,
            e.waybillNumber, e.mintransId, e.parkId
     FROM epl_titles et
     JOIN epl e ON et.eplId = e.id
     WHERE et.status = 'filled'${parkFilter}
     ORDER BY e.id, et.titleCode`,
    params,
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      const byEpl = {};
      for (const r of rows || []) {
        if (!byEpl[r.eplId]) {
          byEpl[r.eplId] = {
            eplId: r.eplId,
            waybillNumber: r.waybillNumber,
            mintransId: r.mintransId,
            titles: []
          };
        }
        byEpl[r.eplId].titles.push({
          id: r.titleId,
          titleCode: r.titleCode,
          status: r.status,
          dataToSign: eplSign.buildDataToSignStable(r.eplId, r.titleCode, r.waybillNumber),
          signerRole: TITLE_SIGNER_ROLE[r.titleCode] || 'unknown'
        });
      }
      res.json({ epls: Object.values(byEpl) });
    }
  );
});

/**
 * POST /api/signer/title/:titleId/sign
 * Тело: { "signature": "base64 подпись из КриптоПро" }
 * Сохраняет подпись в epl_titles, статус → signed.
 */
router.post('/title/:titleId/sign', (req, res) => {
  const titleId = req.params.titleId;
  const signature = req.body?.signature;

  if (!signature || typeof signature !== 'string') {
    return res.status(400).json({ error: 'В теле запроса нужен signature (base64)' });
  }

  db.run(
    `UPDATE epl_titles SET status = 'signed', signatureData = ?, signedAt = CURRENT_TIMESTAMP WHERE id = ?`,
    [signature.trim(), titleId],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Титул не найден или уже подписан' });
      }
      res.json({ ok: true, titleId, message: 'Подпись сохранена' });
    }
  );
});

module.exports = router;
