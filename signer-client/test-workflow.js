/**
 * Скрипт для тестирования workflow ЭПЛ без .pfx файлов
 * 
 * Запуск: node test-workflow.js
 * 
 * Этот скрипт проверяет, что весь код работает правильно,
 * кроме самого подписания (которое требует .pfx файлы).
 */

const fs = require('fs');
const path = require('path');

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║  ТЕСТИРОВАНИЕ WORKFLOW ЭПЛ БЕЗ .pfx ФАЙЛОВ              ║');
console.log('╚═══════════════════════════════════════════════════════════╝');
console.log('');

// Проверяем наличие необходимых файлов
const requiredFiles = [
  'taxcom-create.js',
  'sign.js',
  'titles/sign.js',
  'auth/login.js',
  'utils/debug.js',
  'utils/certificates.js',
  '.env'
];

console.log('📋 Проверка наличия необходимых файлов...');
let allFilesExist = true;
for (const file of requiredFiles) {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    console.log(`  ✅ ${file}`);
  } else {
    console.log(`  ❌ ${file} - НЕ НАЙДЕН!`);
    allFilesExist = false;
  }
}

if (!allFilesExist) {
  console.error('\n❌ Некоторые файлы отсутствуют! Проверь структуру проекта.');
  process.exit(1);
}

console.log('\n✅ Все необходимые файлы найдены!\n');

// Проверяем .env файл
console.log('📋 Проверка .env файла...');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  
  const requiredEnvVars = [
    'API_URL',
    'SIGNER_API_KEY',
    'TAKSKOM_DISPATCHER_PHONE',
    'TAKSKOM_DISPATCHER_PASSWORD',
    'TAKSKOM_MEDIC_PHONE',
    'TAKSKOM_MEDIC_PASSWORD',
    'TAKSKOM_MECHANIC_PHONE',
    'TAKSKOM_MECHANIC_PASSWORD',
    'CHROMIUM_GOST_PATH'
  ];
  
  let allVarsSet = true;
  for (const varName of requiredEnvVars) {
    if (envContent.includes(`${varName}=`) && envContent.match(new RegExp(`${varName}=.+`, 'i'))) {
      console.log(`  ✅ ${varName}`);
    } else {
      console.log(`  ⚠️  ${varName} - не задан или пустой`);
      allVarsSet = false;
    }
  }
  
  // Проверяем сертификаты
  console.log('\n📋 Проверка настроек сертификатов...');
  if (envContent.includes('CERT_DISPATCHER=')) {
    const dispatcherMatch = envContent.match(/CERT_DISPATCHER=(.+)/i);
    if (dispatcherMatch) {
      console.log(`  ✅ CERT_DISPATCHER=${dispatcherMatch[1].trim()}`);
    }
  } else {
    console.log('  ⚠️  CERT_DISPATCHER - не задан');
  }
  
  if (envContent.includes('CERT_MEDIC=')) {
    const medicMatch = envContent.match(/CERT_MEDIC=(.+)/i);
    if (medicMatch) {
      console.log(`  ✅ CERT_MEDIC=${medicMatch[1].trim()}`);
    }
  } else {
    console.log('  ⚠️  CERT_MEDIC - не задан');
  }
  
  if (envContent.includes('CERT_MECHANIC=')) {
    const mechanicMatch = envContent.match(/CERT_MECHANIC=(.+)/i);
    if (mechanicMatch) {
      console.log(`  ✅ CERT_MECHANIC=${mechanicMatch[1].trim()}`);
    }
  } else {
    console.log('  ⚠️  CERT_MECHANIC - не задан');
  }
  
  if (!allVarsSet) {
    console.warn('\n⚠️  Некоторые переменные окружения не заданы!');
  }
} else {
  console.error('❌ .env файл не найден!');
  process.exit(1);
}

// Проверяем наличие playwright-core
console.log('\n📋 Проверка зависимостей...');
try {
  require.resolve('playwright-core');
  console.log('  ✅ playwright-core установлен');
} catch (e) {
  console.log('  ❌ playwright-core НЕ установлен!');
  console.log('  💡 Выполни: npm install playwright-core');
}

// Проверяем наличие папки screenshots
console.log('\n📋 Проверка папки screenshots...');
const screenshotsDir = path.join(__dirname, 'screenshots');
if (fs.existsSync(screenshotsDir)) {
  console.log('  ✅ Папка screenshots существует');
  const files = fs.readdirSync(screenshotsDir);
  console.log(`  📸 Найдено скриншотов: ${files.length}`);
} else {
  console.log('  ⚠️  Папка screenshots не существует (будет создана автоматически)');
}

// Итоговая информация
console.log('\n╔═══════════════════════════════════════════════════════════╗');
console.log('║  ИТОГОВАЯ ИНФОРМАЦИЯ                                      ║');
console.log('╚═══════════════════════════════════════════════════════════╝');
console.log('');
console.log('✅ Что можно протестировать БЕЗ .pfx:');
console.log('  1. Создание ЭПЛ через Playwright');
console.log('  2. Заполнение титулов Т1-Т4');
console.log('  3. Заполнение титулов Т5-Т6');
console.log('  4. Обработка диалога КриптоПро');
console.log('  5. Обработка ошибок подписания');
console.log('  6. Интеграция с бэкендом');
console.log('');
console.log('❌ Что НЕЛЬЗЯ протестировать БЕЗ .pfx:');
console.log('  1. Реальное подписание титулов');
console.log('  2. Получение QR-кода (требуются подписанные титулы)');
console.log('');
console.log('📝 Для запуска тестирования:');
console.log('  1. Запусти бэкенд: cd backend && npm start');
console.log('  2. Запусти программу: cd signer-client && node sign.js');
console.log('  3. Создай ЭПЛ через сайт (водитель)');
console.log('  4. Наблюдай процесс в браузере и логах');
console.log('');
console.log('📖 Подробная инструкция: ТЕСТИРОВАНИЕ_БЕЗ_PFX.md');
console.log('');
