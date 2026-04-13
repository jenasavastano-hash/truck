/**
 * Панель управления Сайт Такси — деплой на VPS, бекенд, воркеры.
 *
 * node dev-control.js     — интерактивная панель
 * node dev-control.js frontend|backend|workers — прямой запуск
 */

const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { spawn } = require('child_process');

const rootDir = path.resolve(__dirname);
const frontendDir = path.join(rootDir, 'frontend');
const backendDir = path.join(rootDir, 'backend');
const signerDir = path.join(rootDir, 'signer-client');

// грузим .env из корня и из backend/signer при необходимости
function loadEnv(dir) {
  const envPath = path.join(dir || rootDir, '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return;
      const m = t.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim();
    });
  }
}
loadEnv(rootDir);

function run(cmd, args, opts = {}) {
  const cwd = opts.cwd || rootDir;
  const env = { ...process.env, ...(opts.env || {}) };
  const p = spawn(cmd, args, {
    stdio: opts.silent ? 'pipe' : 'inherit',
    cwd,
    env,
    shell: opts.shell ?? false
  });
  if (opts.silent) {
    p.stdout?.on('data', (d) => process.stdout.write(d));
    p.stderr?.on('data', (d) => process.stderr.write(d));
  }
  return new Promise((resolve, reject) => {
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
  });
}

function npmRun(script, dir) {
  const isWin = process.platform === 'win32';
  const cwd = dir || rootDir;
  if (isWin) {
    return run('cmd', ['/c', 'npm', 'run', script], { cwd, shell: true });
  }
  return run('npm', ['run', script], { cwd });
}

async function buildFrontend() {
  console.log('[dev-control] Сборка фронта (frontend)...');
  if (!fs.existsSync(path.join(frontendDir, 'package.json'))) {
    throw new Error('Нет frontend/package.json');
  }
  await npmRun('build', frontendDir);
  console.log('[dev-control] Фронт собран: frontend/dist\n');
}

const isWin = process.platform === 'win32';
const PID_BACKEND = path.join(rootDir, '.panel-backend.pid');
const PID_WORKERS = path.join(rootDir, '.panel-workers.pid');

const profilesDir = path.join(signerDir, 'profiles');
const WORKERS_DISPLAY_FILE = path.join(signerDir, '.workers-display');

function getWorkersDisplay() {
  if (!fs.existsSync(WORKERS_DISPLAY_FILE)) return false;
  const v = fs.readFileSync(WORKERS_DISPLAY_FILE, 'utf8').trim();
  return v === '1';
}

function setWorkersDisplay(show) {
  fs.writeFileSync(WORKERS_DISPLAY_FILE, show ? '1' : '0', 'utf8');
}

function toggleWorkersDisplay() {
  const cur = getWorkersDisplay();
  setWorkersDisplay(!cur);
  return !cur;
}

const WORKERS = [
  { key: 'dispatcher', name: 'Диспетчер', script: 'dispatcher-worker.js', envKey: 'DISPATCHER_USER_DATA_DIR', envDir: 'dispatcher' },
  { key: 'medic', name: 'Медик', script: 'medic-worker.js', envKey: 'MEDIC_USER_DATA_DIR', envDir: 'medic' },
  { key: 'mechanic', name: 'Механик', script: 'mechanic-worker.js', envKey: 'MECHANIC_USER_DATA_DIR', envDir: 'mechanic' },
  { key: 'qr', name: 'QR-фетчер', script: 'qr-fetcher.js', envKey: null, envDir: null }
];

function killByPidFile(pidPath) {
  if (!fs.existsSync(pidPath)) return;
  try {
    const pid = fs.readFileSync(pidPath, 'utf8').trim();
    if (!pid) return;
    if (isWin) {
      spawn('cmd', ['/c', 'taskkill', '/PID', pid, '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      try { process.kill(parseInt(pid, 10), 'SIGTERM'); } catch (_) {}
    }
    fs.unlinkSync(pidPath);
  } catch (_) {}
}

function killWindowByTitle(title) {
  if (!isWin) return;
  try {
    spawn('cmd', ['/c', 'taskkill', '/FI', 'WINDOWTITLE eq ' + title, '/F'], { stdio: 'ignore', windowsHide: true });
  } catch (_) {}
}

function startInNewWindow(title, batFile) {
  if (isWin) {
    // Только имя файла — cwd уже задан, путь не передаём (иначе "сетевой путь" / "Такси1\")
    spawn('cmd', ['/c', 'start', '""', batFile], { cwd: rootDir, stdio: 'ignore', windowsHide: false });
  } else {
    const sh = process.env.SHELL || 'sh';
    spawn(sh, ['-c', 'cd "' + rootDir + '" && ./' + batFile.replace('.cmd', '.sh') + ' &'], { stdio: 'inherit', detached: true, cwd: rootDir });
  }
}

function spawnBackground(cmd, args, opts) {
  const child = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: opts.cwd || rootDir,
    env: opts.env || process.env,
    detached: false
  });
  child.stdout?.on('data', (d) => process.stdout.write(d));
  child.stderr?.on('data', (d) => process.stderr.write(d));
  child.on('error', (e) => console.error('[dev-control]', e.message));
  child.on('exit', (code) => {
    if (opts.onExit) opts.onExit(child, code);
  });
  return child;
}

function killChild(child) {
  if (child && child.kill) {
    try { child.kill('SIGTERM'); } catch (_) {}
  }
}

async function startBackend() {
  console.log('[dev-control] Запуск бэкенда...');
  loadEnv(backendDir);
  const serverPath = path.join(backendDir, 'server.js');
  if (!fs.existsSync(serverPath)) throw new Error('Нет backend/server.js');
  const child = spawn(process.execPath, [serverPath], {
    stdio: 'inherit',
    cwd: backendDir,
    env: process.env
  });
  child.on('error', (e) => console.error('[dev-control] Backend error:', e.message));
  child.on('exit', (code) => {
    if (code != null && code !== 0) console.error('[dev-control] Backend exit', code);
  });
  console.log('[dev-control] Бэкенд запущен (остановка: Ctrl+C).\n');
  return child;
}

async function startWorkers() {
  console.log('[dev-control] Запуск воркеров...');
  loadEnv(signerDir);
  const runPath = path.join(signerDir, 'run-workers.js');
  if (!fs.existsSync(runPath)) throw new Error('Нет signer-client/run-workers.js');
  const child = spawn(process.execPath, [runPath], {
    stdio: 'inherit',
    cwd: signerDir,
    env: process.env
  });
  child.on('error', (e) => console.error('[dev-control] Workers error:', e.message));
  child.on('exit', (code) => {
    if (code != null && code !== 0) console.error('[dev-control] Workers exit', code);
  });
  console.log('[dev-control] Воркеры запущены (остановка: Ctrl+C).\n');
  return child;
}

async function runPanel() {
  const showMenu = () => {
    const back = fs.existsSync(PID_BACKEND) ? ' ✓' : '';
    const wrk = fs.existsSync(PID_WORKERS) ? ' ✓' : '';
    console.log('\n========================================');
    console.log('   ПАНЕЛЬ УПРАВЛЕНИЯ — САЙТ ТАКСИ');
    console.log('========================================');
    console.log('');
    console.log('  1) Деплой на сервер     — deploy.bat (бэк + фронт на VPS)');
    console.log('  2) Сборка фронта        — frontend/dist');
    console.log(`  3) Бекенд               — запуск/перезапуск${back}`);
    console.log('');
    console.log('  ВОРКЕРЫ / СКРИПТЫ');
    console.log(`  4) Воркеры              — диспетчер, медик, механик, qr${wrk}`);
    console.log('  5) Перезалив QR         — по EPL id или waybill');
    console.log('');
    console.log('  0) Выход');
    console.log('');
  };

  const showWorkersMenu = () => {
    const disp = getWorkersDisplay();
    console.log('\n--- Воркеры (каждый в своём окне) ---');
    WORKERS.forEach((w, i) => console.log(`  ${i + 1}) ${w.name}`));
    console.log('  5) Все воркеры        — одно окно (4 процесса: диспетчер + медик + механик + qr)');
    console.log('  6) Универсальный     — один процесс (диспетчер + медик + механик; QR отдельно)');
    console.log('  8) Универсальный v2  — ретраи, перезапуск браузера, одна очередь');
    console.log('  9) Продакшен-воркер ЭПЛ — 24/7, титулы Т1–Т4, PDF и QR на сайт (рекомендуется)');
    console.log(`  7) Показать браузер  — ${disp ? 'ВКЛ (видно)' : 'ВЫКЛ (headless)'}`);
    console.log('  0) Назад');
    console.log('');
  };

  const runWorkerInWindow = (key) => {
    const w = WORKERS.find((x) => x.key === key);
    if (!w) return;
    killWindowByTitle(w.name);
    const batMap = { dispatcher: 'start-dispatcher.cmd', medic: 'start-medic.cmd', mechanic: 'start-mechanic.cmd', qr: 'start-qr.cmd' };
    const bat = batMap[key];
    if (!bat || !fs.existsSync(path.join(rootDir, bat))) throw new Error('Нет ' + bat);
    startInNewWindow(w.name, bat);
    console.log(`[dev-control] Окно "${w.name}" открыто.\n`);
  };

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = () => {
    showMenu();
    rl.question('Выбор (0-5): ', (ans) => {
      const n = (ans || '').trim();
      try {
        if (n === '0') {
          rl.close();
          process.exit(0);
          return;
        }
        if (n === '1') {
          const deployBat = path.join(rootDir, 'deploy.bat');
          if (fs.existsSync(deployBat)) {
            startInNewWindow('Деплой на сервер', 'deploy.bat');
            console.log('\n[dev-control] Окно деплоя открыто.\n');
          } else {
            console.log('[dev-control] deploy.bat не найден.\n');
          }
        } else if (n === '2') {
          startInNewWindow('Сборка фронта', 'start-frontend-build.cmd');
          console.log('\n[dev-control] Сборка фронта.\n');
        } else if (n === '3') {
          killByPidFile(PID_BACKEND);
          startInNewWindow('Backend', 'start-backend.cmd');
          console.log('\n[dev-control] Бекенд запущен.\n');
        } else if (n === '4') {
          askWorkers();
          return;
        } else if (n === '5') {
          const refetchBat = path.join(rootDir, 'refetch-qr.cmd');
          if (fs.existsSync(refetchBat)) {
            startInNewWindow('Перезалив QR', 'refetch-qr.cmd');
            console.log('\n[dev-control] Введи EPL id или waybill в окне.\n');
          } else {
            console.log('[dev-control] refetch-qr.cmd не найден.\n');
          }
        } else {
          console.log('Введи 0–5.\n');
        }
      } catch (e) {
        console.error('[dev-control] Ошибка:', e.message || e, '\n');
      }
      setImmediate(ask);
    });
  };

  const askWorkers = () => {
    showWorkersMenu();
    rl.question('Выбор (0-9): ', (ans) => {
      const n = (ans || '').trim();
      try {
        if (n === '0') {
          ask();
          return;
        }
        if (n === '1') runWorkerInWindow('dispatcher');
        else if (n === '2') runWorkerInWindow('medic');
        else if (n === '3') runWorkerInWindow('mechanic');
        else if (n === '4') runWorkerInWindow('qr');
        else if (n === '5') {
          killByPidFile(PID_WORKERS);
          startInNewWindow('Workers', 'start-workers.cmd');
          console.log('\n[dev-control] Окно воркеров (4 процесса) открыто.\n');
        } else if (n === '6') {
          killByPidFile(PID_WORKERS);
          if (!fs.existsSync(path.join(signerDir, 'universal-worker.js'))) {
            console.log('[dev-control] universal-worker.js не найден в signer-client.\n');
          } else {
            startInNewWindow('Workers (Universal)', 'start-universal-workers.cmd');
            console.log('\n[dev-control] Универсальный воркер запущен (один процесс). QR при необходимости запусти отдельно (п.4).\n');
          }
        } else if (n === '8') {
          killByPidFile(PID_WORKERS);
          if (!fs.existsSync(path.join(signerDir, 'universal-worker-v2.js'))) {
            console.log('[dev-control] universal-worker-v2.js не найден в signer-client.\n');
          } else {
            startInNewWindow('Workers (Universal v2)', 'start-universal-workers-v2.cmd');
            console.log('\n[dev-control] Универсальный воркер v2 запущен. QR при необходимости — п.4.\n');
          }
        } else if (n === '9') {
          killByPidFile(PID_WORKERS);
          if (!fs.existsSync(path.join(signerDir, 'epl-production-worker.js'))) {
            console.log('[dev-control] epl-production-worker.js не найден в signer-client.\n');
          } else {
            startInNewWindow('Workers (EPL Production)', 'start-production-worker.cmd');
            console.log('\n[dev-control] Продакшен-воркер ЭПЛ запущен: титулы Т1–Т4, PDF и QR на сайт 24/7.\n');
          }
        } else if (n === '7') {
          const now = toggleWorkersDisplay();
          console.log(`\n[dev-control] Показать браузер: ${now ? 'ВКЛ' : 'ВЫКЛ'} (применится при следующем запуске воркеров).\n`);
        } else {
          console.log('Введи 0–9.\n');
        }
      } catch (e) {
        console.error('[dev-control] Ошибка:', e.message || e, '\n');
      }
      setImmediate(askWorkers);
    });
  };

  process.on('SIGINT', () => process.exit(0));

  if (isWin) {
    try { process.stdout.write('\x1b]0;Панель управления\x07'); } catch (_) {}
  }
  console.log('Панель управления Сайт Такси — деплой на VPS, бекенд, воркеры.');
  console.log('(Каждое действие в отдельном окне.)\n');
  ask();
}

async function main() {
  const arg = (process.argv[2] || '').toLowerCase().trim();
  if (!arg || arg === 'panel') {
    await runPanel();
    return;
  }
  switch (arg) {
    case 'frontend': {
      await buildFrontend();
      return;
    }
    case 'backend': {
      await startBackend();
      return;
    }
    case 'workers': {
      await startWorkers();
      return;
    }
    default: {
      console.log('Использование: node dev-control.js [panel|frontend|backend|workers]');
      console.log('  Без аргументов — интерактивная панель.\n');
      process.exit(1);
    }
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
