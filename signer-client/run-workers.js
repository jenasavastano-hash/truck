/**
 * Запуск всех 4 воркеров конвейера ЭПЛ в одном окне (4 дочерних процесса).
 * Логины берутся из .env (TAKSKOM_DISPATCHER_*, TAKSKOM_MEDIC_*, TAKSKOM_MECHANIC_*).
 *
 * Запуск: node run-workers.js
 * Остановка: Ctrl+C (все 4 процесса завершатся).
 *
 * Отдельно от бэкенда: бэкенд и фронт (Netlify) могут быть где угодно;
 * этот скрипт крутится на ПК клиники (или на сервере с Node и .env).
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const appDir = path.resolve(__dirname);
const envPath = path.join(appDir, '.env');

if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const m = t.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
}

// Панель: показать браузер — signer-client/.workers-display = "1"
const workersDisplayFile = path.join(appDir, '.workers-display');
const showBrowser = fs.existsSync(workersDisplayFile) && fs.readFileSync(workersDisplayFile, 'utf8').trim() === '1';

const profilesDir = path.join(appDir, 'profiles');

function getSourceProfilePath() {
  const explicit = (process.env.CRYPTOPRO_SOURCE_PROFILE || process.env.TAXCOM_USER_DATA_DIR || '').trim();
  if (explicit && fs.existsSync(explicit)) return explicit;
  const exe = (process.env.CHROMIUM_GOST_PATH || '').trim();
  if (!exe || !fs.existsSync(exe)) return null;
  const exeDir = path.dirname(exe);
  const pathLower = exe.toLowerCase();
  if (pathLower.includes('chromium')) {
    const next = path.join(exeDir, 'User Data');
    if (fs.existsSync(next)) return next;
    const up = path.join(path.dirname(exeDir), 'User Data');
    if (fs.existsSync(up)) return up;
    const localAppData = process.env.LOCALAPPDATA || process.env.USERPROFILE || '';
    if (localAppData) {
      const def = path.join(localAppData, 'Chromium', 'User Data');
      if (fs.existsSync(def)) return def;
    }
  }
  if (pathLower.includes('yandex')) {
    const localAppData = process.env.LOCALAPPDATA || process.env.USERPROFILE || '';
    const yandex = localAppData ? path.join(localAppData, 'Yandex', 'YandexBrowser', 'User Data') : '';
    if (yandex && fs.existsSync(yandex)) return yandex;
  }
  const nextToExe = path.join(exeDir, 'User Data');
  if (fs.existsSync(nextToExe)) return nextToExe;
  return path.join(path.dirname(exeDir), 'User Data');
}

function isProfileSeeded(profileDir) {
  return fs.existsSync(path.join(profileDir, 'Local State')) || fs.existsSync(path.join(profileDir, 'Default'));
}

try {
  if (!fs.existsSync(profilesDir)) fs.mkdirSync(profilesDir, { recursive: true });
  const sourceProfile = getSourceProfilePath();
  const roleDirs = ['dispatcher', 'medic', 'mechanic'];
  if (sourceProfile && fs.existsSync(sourceProfile)) {
    for (const name of roleDirs) {
      const dest = path.join(profilesDir, name);
      if (!isProfileSeeded(dest)) {
        try {
          if (fs.existsSync(dest)) {
            try { fs.rmSync(dest, { recursive: true, force: true }); } catch (_) {}
          }
          fs.cpSync(sourceProfile, dest, { recursive: true, force: true });
          console.log(`Профиль с КриптоПро скопирован в profiles/${name}`);
        } catch (copyErr) {
          console.warn(`Не удалось скопировать профиль в profiles/${name}: ${copyErr.message}. Закрой браузер Chromium и запусти снова.`);
          if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        }
      }
    }
  } else {
    if (!sourceProfile) console.warn('Не найден профиль с КриптоПро (CHROMIUM_GOST_PATH или CRYPTOPRO_SOURCE_PROFILE). Задай в .env путь к папке User Data с установленным КриптоПро.');
    for (const name of roleDirs) {
      const d = path.join(profilesDir, name);
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    }
  }
} catch (_) {}

const USE_EPL_PRODUCTION = process.env.USE_EPL_PRODUCTION_WORKER === '1';
const USE_UNIVERSAL_V2 = process.env.USE_UNIVERSAL_V2 === '1' && !USE_EPL_PRODUCTION;
const USE_UNIVERSAL = process.env.USE_UNIVERSAL_WORKER === '1' && !USE_UNIVERSAL_V2 && !USE_EPL_PRODUCTION;

const workers = USE_EPL_PRODUCTION
  ? [{ name: 'EPL-Production', script: 'epl-production-worker.js', prefix: '[EPL-Prod]', envKey: null, envDir: null }]
  : USE_UNIVERSAL_V2
  ? [{ name: 'UniversalV2', script: 'universal-worker-v2.js', prefix: '[UV2]', envKey: null, envDir: null }]
  : USE_UNIVERSAL
  ? [{ name: 'Universal', script: 'universal-worker.js', prefix: '[Universal]', envKey: null, envDir: null }]
  : [
      { name: 'Dispatcher', script: 'dispatcher-worker.js', prefix: '[Dispatcher]', envKey: 'DISPATCHER_USER_DATA_DIR', envDir: 'dispatcher' },
      { name: 'Medic', script: 'medic-worker.js', prefix: '[Medic]', envKey: 'MEDIC_USER_DATA_DIR', envDir: 'medic' },
      { name: 'Mechanic', script: 'mechanic-worker.js', prefix: '[Mechanic]', envKey: 'MECHANIC_USER_DATA_DIR', envDir: 'mechanic' },
      { name: 'QR', script: 'qr-fetcher.js', prefix: '[QR]', envKey: null, envDir: null }
    ];

const children = [];

function runOne(w) {
  const scriptPath = path.join(appDir, w.script);
  let env = { ...process.env };
  if (w.envKey && w.envDir) {
    const dir = process.env[w.envKey] || path.join(profilesDir, w.envDir);
    env[w.envKey] = dir;
  }
  if (showBrowser) {
    if (w.script.includes('qr-fetcher')) env.QR_FETCH_HEADLESS = '0';
    else env.TAXCOM_HEADLESS = '0';
  }
  const child = spawn(process.execPath, [scriptPath], {
    env,
    cwd: appDir,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    chunk.split('\n').filter(Boolean).forEach(line => console.log(`${w.prefix} ${line}`));
  });
  child.stderr.on('data', (chunk) => {
    chunk.split('\n').filter(Boolean).forEach(line => console.error(`${w.prefix} ${line}`));
  });
  child.on('error', (err) => console.error(`${w.prefix} error:`, err.message));
  child.on('exit', (code, signal) => {
    if (code != null && code !== 0) console.error(`${w.prefix} exit ${code}`);
    if (signal) console.error(`${w.prefix} killed: ${signal}`);
  });
  children.push(child);
}

if (USE_EPL_PRODUCTION) {
  console.log('Запуск продакшен-воркера ЭПЛ 24/7 (титулы, PDF, QR на сайт). Остановка: Ctrl+C.');
} else if (USE_UNIVERSAL_V2) {
  console.log('Запуск универсального воркера v2 (ретраи, перезапуск браузера, одна очередь). Остановка: Ctrl+C.');
} else if (USE_UNIVERSAL) {
  console.log('Запуск универсального воркера (диспетчер + медик + механик в одном процессе). Остановка: Ctrl+C.');
} else {
  console.log('Запуск 4 воркеров конвейера ЭПЛ (логины из .env). Остановка: Ctrl+C.');
}
if (showBrowser) console.log('Браузер: показывать (панель → Воркеры → 7).\n');
if (!USE_UNIVERSAL) console.log('Профили: profiles/dispatcher, profiles/medic, profiles/mechanic (с КриптоПро при первом копировании).\n');
workers.forEach(runOne);

function shutdown() {
  console.log('\nОстановка воркеров...');
  children.forEach(c => {
    try { c.kill('SIGTERM'); } catch (_) {}
  });
  setTimeout(() => {
    children.forEach(c => {
      try { if (c.kill) c.kill('SIGKILL'); } catch (_) {}
    });
    process.exit(0);
  }, 3000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
