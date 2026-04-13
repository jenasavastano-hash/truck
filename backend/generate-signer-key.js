/**
 * Сгенерировать ключ для API скрипта подписания (КриптоПро).
 * Запуск: node generate-signer-key.js
 * Скопируй вывод в .env как SIGNER_API_KEY=...
 */

const crypto = require('crypto');
const key = crypto.randomBytes(32).toString('hex');
console.log('');
console.log('Добавь в backend/.env строку:');
console.log('');
console.log('SIGNER_API_KEY=' + key);
console.log('');
console.log('Этот же ключ укажи в скрипте на ПК с КриптоПро в заголовке:');
console.log('Authorization: Bearer ' + key);
console.log('');
