/**
 * Утилиты для работы с балансом пользователей
 * 
 * Логика списания зависит от настройки парка:
 * - 'real_first': сначала списываются реальные деньги, потом фантики
 * - 'unreal_first': сначала списываются фантики, потом реальные деньги
 */

function getDb(db) {
  if (db && typeof db.get === 'function') return db;
  try {
    return require('../database');
  } catch (_) {
    return db;
  }
}

function beginImmediate(database, cb) {
  database.run('BEGIN IMMEDIATE', cb);
}
function commit(database, cb) {
  database.run('COMMIT', cb);
}
function rollback(database, cb) {
  database.run('ROLLBACK', cb);
}

function getOperationSplit(database, operationKey, callback) {
  database.all(
    `SELECT amountType, amount
     FROM balance_history
     WHERE operationKey = ?`,
    [operationKey],
    (err, rows) => {
      if (err) return callback(err);
      let fromReal = 0;
      let fromUnreal = 0;
      (rows || []).forEach((r) => {
        const a = Number(r.amount) || 0; // в history расходы отрицательные
        if (r.amountType === 'real') fromReal += -a;
        if (r.amountType === 'unreal') fromUnreal += -a;
      });
      callback(null, { fromReal, fromUnreal });
    }
  );
}

/**
 * Получить баланс пользователя
 * @param {Object} db - База данных SQLite
 * @param {Number} userId - ID пользователя
 * @param {Function} callback - (err, balance) => {}
 */
function getBalance(db, userId, callback) {
  const database = getDb(db);
  database.get(
    `SELECT 
      COALESCE(balanceReal, 0) as balanceReal, 
      COALESCE(balanceUnreal, 0) as balanceUnreal,
      (COALESCE(balanceReal, 0) + COALESCE(balanceUnreal, 0)) as balance
    FROM users WHERE id = ?`,
    [userId],
    (err, row) => {
      if (err) return callback(err);
      if (!row) return callback(new Error('User not found'));
      callback(null, {
        balanceReal: row.balanceReal || 0,
        balanceUnreal: row.balanceUnreal || 0,
        balance: row.balance || 0
      });
    }
  );
}

/**
 * Получить настройку порядка списания для парка
 * @param {Object} db - База данных SQLite
 * @param {Number} parkId - ID парка
 * @param {Function} callback - (err, order) => {} где order = 'real_first' | 'unreal_first'
 */
function getDeductionOrder(db, parkId, callback) {
  const database = getDb(db);
  database.get(
    `SELECT balanceDeductionOrder FROM parks WHERE id = ?`,
    [parkId],
    (err, row) => {
      if (err) return callback(err);
      // По умолчанию: сначала реальные деньги
      const order = (row && row.balanceDeductionOrder) || 'real_first';
      callback(null, order);
    }
  );
}

/**
 * Списать баланс с учетом настройки парка
 * @param {Object} db - База данных SQLite
 * @param {Number} userId - ID пользователя
 * @param {Number} parkId - ID парка (для получения настройки порядка списания)
 * @param {Number} amount - Сумма для списания
 * @param {String} description - Описание операции
 * @param {Number} relatedEplId - ID связанного ЭПЛ (опционально)
 * @param {String} expenseType - Тип траты ('waybill_fee', 'expense', 'fine') - по умолчанию 'expense'
 * @param {String} operationKey - Идемпотентный ключ операции (опционально)
 * @param {Function} callback - (err, result) => {} где result = { fromReal, fromUnreal }
 */
function deductBalance(db, userId, parkId, amount, description, relatedEplId, expenseType, callback) {
  // Поддержка старых и новых сигнатур:
  // - deductBalance(db, userId, parkId, amount, description, relatedEplId?, expenseType?, callback)
  // - deductBalance(db, userId, parkId, amount, description, relatedEplId?, expenseType?, operationKey, callback)
  const args = Array.prototype.slice.call(arguments);
  const last = args[args.length - 1];
  const cb = typeof last === 'function' ? last : null;
  if (!cb) throw new Error('deductBalance: callback is required');

  // Убираем callback
  args.pop();

  // Раскладываем по позициям
  // [0]=db [1]=userId [2]=parkId [3]=amount [4]=description [5]=relatedEplId? [6]=expenseType? [7]=operationKey?
  description = args[4];
  relatedEplId = args.length >= 6 ? args[5] : null;

  // Если relatedEplId пропущен (передали expenseType строкой на его месте)
  if (typeof relatedEplId === 'string' && (args.length === 6 || args.length === 7)) {
    expenseType = relatedEplId;
    relatedEplId = null;
  } else {
    expenseType = args.length >= 7 ? args[6] : undefined;
  }

  const operationKey = args.length >= 8 ? args[7] : null;
  callback = cb;

  if (typeof expenseType !== 'string' || !expenseType) expenseType = 'expense';
  if (description == null) description = '';

  const database = getDb(db);
  beginImmediate(database, (bErr) => {
    if (bErr) return callback(bErr);

    const finishRollback = (e) => rollback(database, () => callback(e));

    const finishCommit = (res) => commit(database, (cErr) => (cErr ? finishRollback(cErr) : callback(null, res)));

    const opKey = operationKey != null && String(operationKey).trim() ? String(operationKey).trim() : null;
    if (opKey) {
      database.get('SELECT COUNT(*) as cnt FROM balance_history WHERE operationKey = ? LIMIT 1', [opKey], (c1Err, row) => {
        if (c1Err) return finishRollback(c1Err);
        if ((row?.cnt || 0) > 0) {
          return getOperationSplit(database, opKey, (sErr, split) => {
            if (sErr) return finishRollback(sErr);
            // Ничего не меняем, просто заканчиваем транзакцию
            return finishCommit({ ...split, idempotent: true });
          });
        }
        return proceed();
      });
    } else {
      proceed();
    }

    function proceed() {
      // Получаем настройку парка (внутри транзакции)
      getDeductionOrder(database, parkId, (oErr, order) => {
        if (oErr) return finishRollback(oErr);

        // Читаем баланс внутри транзакции
        database.get(
          `SELECT 
            COALESCE(balanceReal, 0) as balanceReal, 
            COALESCE(balanceUnreal, 0) as balanceUnreal,
            (COALESCE(balanceReal, 0) + COALESCE(balanceUnreal, 0)) as balance
          FROM users WHERE id = ?`,
          [userId],
          (gErr, balance) => {
            if (gErr) return finishRollback(gErr);
            if (!balance) return finishRollback(new Error('User not found'));

            const totalBalance = Number(balance.balance) || 0;
            if (totalBalance < amount) {
              return finishRollback(new Error(`Недостаточно средств. Доступно: ${totalBalance}₽, требуется: ${amount}₽`));
            }

            const balanceReal = Number(balance.balanceReal) || 0;
            const balanceUnreal = Number(balance.balanceUnreal) || 0;

            let fromReal = 0;
            let fromUnreal = 0;

            if (order === 'real_first') {
              fromReal = Math.min(amount, balanceReal);
              fromUnreal = amount - fromReal;
            } else {
              fromUnreal = Math.min(amount, balanceUnreal);
              fromReal = amount - fromUnreal;
            }

            database.run(
              `UPDATE users SET 
                balanceReal = COALESCE(balanceReal,0) - ?,
                balanceUnreal = COALESCE(balanceUnreal,0) - ?
              WHERE id = ?`,
              [fromReal, fromUnreal, userId],
              (uErr) => {
                if (uErr) return finishRollback(uErr);

                const desc = String(description || '').trim();
                const opKey = operationKey != null && String(operationKey).trim() ? String(operationKey).trim() : null;

                const historyWrites = [];
                if (fromReal > 0) {
                  historyWrites.push(
                    new Promise((resolve, reject) => {
                      database.run(
                        `INSERT INTO balance_history (userId, amount, type, amountType, operationKey, description, relatedEplId)
                         VALUES (?, ?, ?, 'real', ?, ?, ?)`,
                        [userId, -fromReal, expenseType, opKey, desc, relatedEplId],
                        (e) => (e ? reject(e) : resolve())
                      );
                    })
                  );
                }
                if (fromUnreal > 0) {
                  historyWrites.push(
                    new Promise((resolve, reject) => {
                      database.run(
                        `INSERT INTO balance_history (userId, amount, type, amountType, operationKey, description, relatedEplId)
                         VALUES (?, ?, ?, 'unreal', ?, ?, ?)`,
                        [userId, -fromUnreal, expenseType, opKey, desc, relatedEplId],
                        (e) => (e ? reject(e) : resolve())
                      );
                    })
                  );
                }
                Promise.all(historyWrites)
                  .then(() => finishCommit({ fromReal, fromUnreal, idempotent: false }))
                  .catch(finishRollback);
              }
            );
          }
        );
      });
    }
  });
}

/**
 * Добавить баланс пользователю
 * @param {Object} db - База данных SQLite
 * @param {Number} userId - ID пользователя
 * @param {Number} amount - Сумма для добавления
 * @param {String} amountType - Тип денег ('real' | 'unreal')
 * @param {String} description - Описание операции
 * @param {String} operationKey - Идемпотентный ключ операции (опционально)
 * @param {Function} callback - (err) => {}
 */
function addBalance(db, userId, amount, amountType, description, operationKey, callback) {
  if (typeof operationKey === 'function') {
    callback = operationKey;
    operationKey = null;
  }
  if (typeof description === 'function') {
    callback = description;
    description = '';
    operationKey = null;
  }

  const database = getDb(db);
  const col = amountType === 'real' ? 'balanceReal' : 'balanceUnreal';
  const type = amountType === 'real' ? 'topup' : 'topup';

  beginImmediate(database, (bErr) => {
    if (bErr) return callback(bErr);
    const finishRollback = (e) => rollback(database, () => callback(e));
    const finishCommit = () => commit(database, (cErr) => (cErr ? finishRollback(cErr) : callback(null)));

    const opKey = operationKey != null && String(operationKey).trim() ? String(operationKey).trim() : null;
    if (opKey) {
      database.get('SELECT id FROM balance_history WHERE operationKey = ? AND amountType = ? LIMIT 1', [opKey, amountType], (cErr, row) => {
        if (cErr) return finishRollback(cErr);
        if (row && row.id) return finishCommit(); // уже применено
        return proceed();
      });
    } else {
      proceed();
    }

    function proceed() {
      database.run(
        `UPDATE users SET ${col} = COALESCE(${col}, 0) + ? WHERE id = ?`,
        [amount, userId],
        (err) => {
          if (err) return finishRollback(err);
          database.run(
            `INSERT INTO balance_history (userId, amount, type, amountType, operationKey, description)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, amount, type, amountType, opKey, description || 'Пополнение баланса'],
            (insErr) => (insErr ? finishRollback(insErr) : finishCommit())
          );
        }
      );
    }
  });
}

module.exports = {
  getBalance,
  getDeductionOrder,
  deductBalance,
  addBalance
};
