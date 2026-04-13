/**
 * Нативное окно КриптоПро «Подтверждение доступа»: запуск скрипта, который ищет окно и нажимает «Да».
 * Только Windows. Использует PowerShell + UI Automation (без доп. зависимостей).
 */

const path = require('path');
const { spawn } = require('child_process');

/**
 * Запускает фоновый процесс: PowerShell скрипт ищет окно "Подтверждение доступа" и нажимает кнопку "Да".
 * @param {Object} env - переменные окружения (не обязательны)
 * @param {number} timeoutSeconds - сколько секунд скрипт будет пытаться (по умолчанию 90)
 * @returns {Promise<void>} - разрешается сразу после запуска (скрипт работает в фоне)
 */
function runCryptoProAllowClick(env, timeoutSeconds = 90) {
  if (process.platform !== 'win32') {
    return Promise.resolve();
  }
  if (env && (env.CRYPTOPRO_AUTO_CLICK_ALLOW === '0' || env.CRYPTOPRO_AUTO_CLICK_ALLOW === 'false')) {
    return Promise.resolve();
  }
  const scriptPath = path.join(__dirname, '..', 'scripts', 'cryptopro-click-allow.ps1');
  return new Promise((resolve) => {
    const ps = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-STA',
        '-File', scriptPath,
        String(timeoutSeconds)
      ],
      { stdio: 'ignore', windowsHide: true, detached: true }
    );
    ps.unref();
    resolve();
  });
}

module.exports = {
  runCryptoProAllowClick
};
