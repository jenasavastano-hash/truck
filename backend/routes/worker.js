/**
 * Внутренний API для 24/7 воркеров (Playwright/КриптоПро).
 * Авторизация: Bearer <SIGNER_API_KEY> (как /api/signer/*).
 */
const express = require('express');
const router = express.Router();
const db = require('../database');

const SIGNER_API_KEY = process.env.SIGNER_API_KEY || '';

function requireWorkerKey(req, res, next) {
  if (!SIGNER_API_KEY) return res.status(503).json({ error: 'SIGNER_API_KEY не задан. Добавьте в .env.' });
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim();
  if (token !== SIGNER_API_KEY) return res.status(401).json({ error: 'Неверный или отсутствующий ключ' });
  next();
}

router.use(requireWorkerKey);

/**
 * POST /api/worker/epl/:id/create-attempt-failed
 * Body: { failureCode, errorMessage, maxAttempts, minIntervalSec }
 *
 * Увеличивает createAttempts и фиксирует причину. После N попыток переводит epl в failed.
 * Защита от флуда: не чаще, чем раз в minIntervalSec (по lastAttemptAt).
 */
router.post('/epl/:id/create-attempt-failed', (req, res) => {
  const eplId = parseInt(req.params.id, 10);
  if (!eplId || Number.isNaN(eplId)) return res.status(400).json({ error: 'Некорректный eplId' });

  const failureCode = (req.body?.failureCode != null ? String(req.body.failureCode) : 'taxcom_validation').trim() || 'taxcom_validation';
  const errorMessage = (req.body?.errorMessage != null ? String(req.body.errorMessage) : '').trim();
  const maxAttempts = Math.max(1, Math.min(20, parseInt(String(req.body?.maxAttempts ?? 3), 10) || 3));
  const minIntervalSec = Math.max(0, Math.min(300, parseInt(String(req.body?.minIntervalSec ?? 20), 10) || 20));

  db.get(
    `SELECT
        e.id,
        e.status,
        e.mintransId,
        e.createAttempts,
        e.lastAttemptAt,
        d.userId as driverUserId,
        u.innMutationApplied as innMutationApplied,
        u.innMutationOriginalInn as innMutationOriginalInn
     FROM epl e
     JOIN drivers d ON e.driverId = d.id
     JOIN users u ON d.userId = u.id
     WHERE e.id = ?`,
    [eplId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'EPL not found' });

      // Если уже создано в Такском — это не кейс create-attempt-failed
      if (row.mintransId) return res.status(200).json({ ok: true, skipped: true, reason: 'has_mintransId' });

      // Антифлуд по lastAttemptAt
      if (minIntervalSec > 0 && row.lastAttemptAt) {
        const last = new Date(String(row.lastAttemptAt).includes('T') ? row.lastAttemptAt : String(row.lastAttemptAt).replace(' ', 'T') + 'Z');
        if (!Number.isNaN(last.getTime())) {
          const ageMs = Date.now() - last.getTime();
          if (ageMs >= 0 && ageMs < minIntervalSec * 1000) {
            return res.status(200).json({ ok: true, skipped: true, reason: 'rate_limited', retryInSec: Math.ceil((minIntervalSec * 1000 - ageMs) / 1000) });
          }
        }
      }

      const prevAttempts = row.createAttempts != null ? Number(row.createAttempts) : 0;
      const nextAttempts = prevAttempts + 1;
      const finalStatus = nextAttempts >= maxAttempts ? 'failed' : (row.status === 'failed' ? 'failed' : row.status);
      const shouldRevertInnMutation =
        finalStatus === 'failed' &&
        String(row.innMutationApplied || 0) === '1' &&
        (row.innMutationOriginalInn || '').trim() !== '';

      const msg = errorMessage || 'Такском не сохранил форму (waybill/new). Проверь обязательные поля (дата действия путевого).';

      db.run(
        `UPDATE epl
         SET createAttempts = ?,
             failureCode = ?,
             lastAttemptAt = CURRENT_TIMESTAMP,
             errorMessage = ?,
             status = CASE WHEN ? = 1 THEN 'failed' ELSE status END,
             updatedAt = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [nextAttempts, failureCode, msg.substring(0, 1000), nextAttempts >= maxAttempts ? 1 : 0, eplId],
        function (uErr) {
          if (uErr) return res.status(500).json({ error: uErr.message });

          db.run(
            `INSERT INTO epl_logs (eplId, source, event, message, details)
             VALUES (?, ?, ?, ?, ?)`,
            [
              eplId,
              'worker',
              nextAttempts >= maxAttempts ? 'taxcom_create_failed_final' : 'taxcom_create_attempt_failed',
              `Taxcom create attempt failed (${failureCode})`,
              JSON.stringify({ attempts: nextAttempts, maxAttempts, status: finalStatus, failureCode, errorMessage: msg })
            ],
            () => {
              if (!shouldRevertInnMutation) {
                return res.json({
                  ok: true,
                  eplId,
                  attempts: nextAttempts,
                  maxAttempts,
                  status: nextAttempts >= maxAttempts ? 'failed' : row.status,
                  failureCode,
                });
              }

              // Такском не пропустил водителя после серии попыток — возвращаем ИНН и снимаем метку.
              db.run(
                `UPDATE users
                 SET inn = ?,
                     innMutationApplied = 0,
                     innMutationOriginalInn = NULL,
                     innMutationAt = NULL
                 WHERE id = ?`,
                [row.innMutationOriginalInn, row.driverUserId],
                (revertErr) => {
                  if (revertErr) console.warn('[EPL Worker] Failed to revert inn mutation:', revertErr.message);

                  db.run(
                    `INSERT INTO epl_logs (eplId, source, event, message, details)
                     VALUES (?, ?, ?, ?, ?)`,
                    [
                      eplId,
                      'worker',
                      'inn_mutation_reverted',
                      'ИНН подмена не дала результата — возвращено исходное значение',
                      JSON.stringify({ revertedInn: row.innMutationOriginalInn }),
                    ],
                    () => {}
                  );

                  return res.json({
                    ok: true,
                    eplId,
                    attempts: nextAttempts,
                    maxAttempts,
                    status: nextAttempts >= maxAttempts ? 'failed' : row.status,
                    failureCode,
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

module.exports = router;

