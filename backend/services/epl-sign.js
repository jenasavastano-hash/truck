/**
 * Подписание титулов ЭПЛ сертификатом (КЭП).
 * Сейчас: mock-режим (подпись-заглушка для отладки).
 * Позже: EPL_SIGN_MODE=real + путь к сертификату/ключу — вызов КриптоПро или внешней утилиты.
 *
 * Автоматизация: подпись должна происходить без ручного входа — при создании ЭПЛ водителем
 * бэкенд может вызывать signTitle() для каждого титула после успешной отправки в Такском
 * (если Такском не подписывает титулы сам по нашим ключам). См. ВОПРОСЫ_ПОДДЕРЖКЕ_ТАКСКОМ.md.
 */

const crypto = require('crypto');

const SIGN_MODE = process.env.EPL_SIGN_MODE || 'mock';

/**
 * Формирует строку данных для подписи титула (хеш от неё потом подписывается КЭП).
 * @param {object} ctx - { eplId, titleCode, waybillNumber }
 * @returns {string}
 */
function buildDataToSign(ctx) {
  const { eplId, titleCode, waybillNumber } = ctx;
  return [eplId, titleCode, waybillNumber || '', Date.now()].join('|');
}

/**
 * Стабильная строка для подписи (без времени) — для скрипта с КриптоПро.
 * Скрипт подписывает эту строку; сервер сохраняет подпись.
 */
function buildDataToSignStable(eplId, titleCode, waybillNumber) {
  return [eplId, titleCode, waybillNumber || ''].join('|');
}

/**
 * Подписать один титул.
 * @param {object} db - экземпляр sqlite3 Database
 * @param {number} titleId - id записи в epl_titles
 * @param {object} options - { certPath?, keyPath?, mode? }
 * @returns {Promise<{ signature: string, dataToSign: string }>}
 */
function signTitle(db, titleId, options = {}) {
  return new Promise((resolve, reject) => {
    const mode = options.mode || SIGN_MODE;

    db.get(
      `SELECT et.id, et.eplId, et.titleCode, et.status, e.waybillNumber
       FROM epl_titles et
       JOIN epl e ON et.eplId = e.id
       WHERE et.id = ?`,
      [titleId],
      (err, row) => {
        if (err) return reject(err);
        if (!row) return reject(new Error('Титул не найден'));
        if (row.status === 'signed') return reject(new Error('Титул уже подписан'));

        const dataToSign = buildDataToSign({
          eplId: row.eplId,
          titleCode: row.titleCode,
          waybillNumber: row.waybillNumber
        });

        if (mode === 'real' && options.certPath) {
          // Режим КЭП: здесь вызвать КриптоПро / внешнюю утилиту / node-gost.
          // Пока — не реализовано, fallback на mock с пометкой в логе.
          console.warn('[EPL-Sign] Режим real: подписание сертификатом не реализовано, используется mock');
          const signature = mockSign(dataToSign);
          return resolve({ signature, dataToSign });
        }

        const signature = mockSign(dataToSign);
        resolve({ signature, dataToSign });
      }
    );
  });
}

/**
 * Mock-подпись для отладки (не криптографическая).
 * В проде при EPL_SIGN_MODE=real должна вызываться реальная КЭП.
 */
function mockSign(dataToSign) {
  const hash = crypto.createHash('sha256').update(dataToSign, 'utf8').digest('hex');
  const blob = `MOCK-SIG-${hash}-${Date.now()}`;
  return Buffer.from(blob, 'utf8').toString('base64');
}

module.exports = {
  signTitle,
  buildDataToSign,
  buildDataToSignStable,
  SIGN_MODE
};
