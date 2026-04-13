/**
 * Скрипт для установки сертификатов (.pfx) с закрытым ключом в хранилище Windows
 * Запуск: node install-pfx-certificates.js
 * 
 * Сертификаты должны быть в корне проекта (рядом с signer-client/) или в папке certificates/
 * Формат имени: Фамилия.pfx (например, Амиргамзаев.pfx, Поливода.pfx)
 * 
 * ВАЖНО: .pfx файлы содержат закрытый ключ и нужны для подписания ЭПЛ!
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const certDir = __dirname;

console.log('[Сертификаты] Ищу .pfx файлы...');
console.log('[Сертификаты] Корень проекта:', projectRoot);
console.log('[Сертификаты] Папка signer-client:', certDir);

// Ищем .pfx файлы в корне проекта и в папке signer-client
const pfxFiles = [];
const searchPaths = [projectRoot, certDir, path.join(projectRoot, 'certificates')];

for (const searchPath of searchPaths) {
  if (fs.existsSync(searchPath)) {
    const files = fs.readdirSync(searchPath).filter(f => f.toLowerCase().endsWith('.pfx'));
    for (const file of files) {
      const fullPath = path.join(searchPath, file);
      if (!pfxFiles.find(c => c.path === fullPath)) {
        pfxFiles.push({ name: file, path: fullPath });
      }
    }
  }
}

if (pfxFiles.length === 0) {
  console.error('[Сертификаты] ❌ Не найдено ни одного .pfx файла!');
  console.error('[Сертификаты] Положи .pfx файлы в корень проекта или в папку signer-client/');
  console.error('[Сертификаты]');
  console.error('[Сертификаты] ВАЖНО: .pfx файлы содержат закрытый ключ и нужны для подписания!');
  console.error('[Сертификаты] .cer файлы не подходят - они не содержат закрытый ключ.');
  process.exit(1);
}

console.log(`[Сертификаты] Найдено .pfx файлов: ${pfxFiles.length}`);
pfxFiles.forEach(c => console.log(`  - ${c.name}`));

// Функция установки .pfx файла
function installPFX(certPath, certName) {
  try {
    console.log(`\n[Сертификаты] Устанавливаю ${certName}...`);
    console.log(`[Сертификаты] ⚠ ВНИМАНИЕ: Если потребуется пароль, введи его вручную!`);
    
    // certutil -importPFX -f -user My "путь_к_файлу.pfx"
    // -f = force (перезаписать, если уже есть)
    // -user = пользовательское хранилище
    // My = хранилище "Личное"
    const command = `certutil -importPFX -f -user My "${certPath}"`;
    
    try {
      const output = execSync(command, { encoding: 'utf8', stdio: 'pipe' });
      console.log(`[Сертификаты] ✓ ${certName} установлен успешно`);
      if (output) {
        console.log(`[Сертификаты] Вывод: ${output.trim()}`);
      }
      return true;
    } catch (execError) {
      // certutil может вернуть ошибку, даже если установка прошла успешно
      // Проверяем вывод на наличие успешных сообщений
      const errorOutput = execError.stdout || execError.stderr || '';
      if (errorOutput.includes('успешно') || errorOutput.includes('successfully') || errorOutput.includes('imported')) {
        console.log(`[Сертификаты] ✓ ${certName} установлен (с предупреждениями)`);
        return true;
      }
      throw execError;
    }
  } catch (error) {
    console.error(`[Сертификаты] ❌ Ошибка при установке ${certName}:`, error.message);
    if (error.stdout) console.log('[Сертификаты] Вывод:', error.stdout);
    if (error.stderr) console.error('[Сертификаты] Ошибка:', error.stderr);
    
    // Если ошибка связана с паролем, даём подсказку
    const errorMsg = (error.message || '').toLowerCase();
    if (errorMsg.includes('password') || errorMsg.includes('пароль')) {
      console.error('[Сертификаты] ⚠ Возможно, требуется пароль. Попробуй установить через КриптоПро CSP вручную.');
    }
    
    return false;
  }
}

// Устанавливаем все найденные .pfx файлы
console.log('\n[Сертификаты] Начинаю установку...');
let successCount = 0;
for (const cert of pfxFiles) {
  if (installPFX(cert.path, cert.name)) {
    successCount++;
  }
}

console.log(`\n[Сертификаты] Установлено: ${successCount} из ${pfxFiles.length}`);

if (successCount === pfxFiles.length) {
  console.log('[Сертификаты] ✅ Все сертификаты установлены успешно!');
  console.log('[Сертификаты] Теперь можно использовать их для подписания ЭПЛ.');
  console.log('\n[Сертификаты] Следующий шаг: проверь установку на странице диагностики:');
  console.log('[Сертификаты] https://cryptopro.ru/sites/default/files/products/cades/demopage/cades_bes_sample.html');
  console.log('[Сертификаты]');
  console.log('[Сертификаты] Выбери сертификат и проверь статус:');
  console.log('[Сертификаты] ✅ Должно быть: "Статус: Есть привязка к закрытому ключу"');
  console.log('[Сертификаты] ❌ Не должно быть: "Статус: Нет привязки к закрытому ключу"');
} else {
  console.warn('[Сертификаты] ⚠ Некоторые сертификаты не удалось установить.');
  console.warn('[Сертификаты] Проверь права доступа и наличие паролей.');
  console.warn('[Сертификаты]');
  console.warn('[Сертификаты] Если требуется пароль, установи сертификаты через КриптоПро CSP вручную:');
  console.warn('[Сертификаты] Панель управления → КриптоПро CSP → Сертификаты → Установить сертификат');
}
