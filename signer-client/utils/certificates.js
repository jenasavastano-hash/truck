/**
 * Утилиты для работы с сертификатами КриптоПро
 */

const { spawn } = require('child_process');

function runCertPicker(env, role) {
  const exe = (env.CERT_PICKER_EXE || '').trim();
  if (!exe) {
    // Если нет exe для автовыбора, возвращаем информацию о сертификате для ручного выбора
    const certMapping = {
      dispatcher: env.CERT_DISPATCHER || 'диспетчера',
      medic: env.CERT_MEDIC || 'медика',
      mechanic: env.CERT_MECHANIC || 'механика'
    };
    const certName = certMapping[role] || role;
    console.log(`[КриптоПро] Для роли "${role}" используй сертификат: ${certName}`);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const child = spawn(exe, [role], { stdio: 'ignore', windowsHide: true });
    const t = setTimeout(() => {
      child.kill();
      resolve();
    }, 20000);
    child.on('close', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

module.exports = {
  runCertPicker
};
