/**
 * Скрипт для установки сертификатов (.cer) в хранилище Windows
 * Запуск: node install-certificates.js
 * 
 * Сертификаты должны быть в корне проекта (рядом с этим файлом или в папке certificates/)
 * Формат имени: Фамилия.cer (например, Амиргамзаев.cer, Поливода.cer)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const certDir = __dirname;

console.log('[Сертификаты] Ищу .cer файлы...');
console.log('[Сертификаты] Корень проекта:', projectRoot);
console.log('[Сертификаты] Папка signer-client:', certDir);

// Ищем .cer файлы в корне проекта и в папке signer-client
const certFiles = [];
const searchPaths = [projectRoot, certDir, path.join(projectRoot, 'certificates')];

for (const searchPath of searchPaths) {
  if (fs.existsSync(searchPath)) {
    const files = fs.readdirSync(searchPath).filter(f => f.toLowerCase().endsWith('.cer'));
    for (const file of files) {
      const fullPath = path.join(searchPath, file);
      if (!certFiles.find(c => c.path === fullPath)) {
        certFiles.push({ name: file, path: fullPath });
      }
    }
  }
}

if (certFiles.length === 0) {
  console.error('[Сертификаты] ❌ Не найдено ни одного .cer файла!');
  console.error('[Сертификаты] Положи .cer файлы в корень проекта или в папку signer-client/');
  process.exit(1);
}

console.log(`[Сертификаты] Найдено сертификатов: ${certFiles.length}`);
certFiles.forEach(c => console.log(`  - ${c.name}`));

// Функция установки сертификата через certutil
function installCertificate(certPath, certName) {
  try {
    console.log(`[Сертификаты] Устанавливаю ${certName}...`);
    
    // Используем certutil для установки в хранилище "Личное" (My)
    // certutil -addstore -user My "путь_к_файлу"
    const command = `certutil -addstore -user My "${certPath}"`;
    const output = execSync(command, { encoding: 'utf8', stdio: 'pipe' });
    
    console.log(`[Сертификаты] ✓ ${certName} установлен успешно`);
    return true;
  } catch (error) {
    console.error(`[Сертификаты] ❌ Ошибка при установке ${certName}:`, error.message);
    if (error.stdout) console.log('[Сертификаты] Вывод:', error.stdout);
    if (error.stderr) console.error('[Сертификаты] Ошибка:', error.stderr);
    return false;
  }
}

// Устанавливаем все найденные сертификаты
let successCount = 0;
for (const cert of certFiles) {
  if (installCertificate(cert.path, cert.name)) {
    successCount++;
  }
}

console.log(`\n[Сертификаты] Установлено: ${successCount} из ${certFiles.length}`);

if (successCount === certFiles.length) {
  console.log('[Сертификаты] ✅ Все сертификаты установлены успешно!');
  console.log('[Сертификаты] Теперь можно использовать их для подписания ЭПЛ.');
} else {
  console.warn('[Сертификаты] ⚠ Некоторые сертификаты не удалось установить.');
  console.warn('[Сертификаты] Проверь права доступа и формат файлов.');
}

console.log('\n[Сертификаты] Следующий шаг: установи расширение КриптоПро ЭЦП Browser plug-in в браузер.');
console.log('[Сертификаты] Скачать: https://cryptopro.ru/products/cades/plugin-download');
