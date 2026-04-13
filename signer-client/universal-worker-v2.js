/**
 * Универсальный воркер v2: диспетчер + медик + механик в одном процессе.
 * — Чёткая логика: опрос очереди → инициализация браузера по роли → обработка с ретраями → отчёт прогресса.
 * — При падении браузера/критической ошибке — сброс контекста и переоткрытие на следующем тике.
 * — Ретраи: до 3 попыток на заявку с экспоненциальной задержкой (5, 15, 45 с).
 * — Браузер закрывается после 5 мин бездействия (INACTIVITY_CLOSE_MS); при открытии профиль чистится (cookies/storage).
 *
 * Запуск: node universal-worker-v2.js   или   node universal-worker-v2.js --once
 * Панель: Воркеры → 8) Универсальный воркер v2
 */

const fs = require('fs');
const path = require('path');

const appDir = typeof process.pkg !== 'undefined' ? path.dirname(process.execPath) : __dirname;
const envPath = path.join(appDir, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const m = t.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
}

process.env.UNIVERSAL_WORKER = '1';

const profilesDir = path.join(appDir, 'profiles');
if (!fs.existsSync(profilesDir)) fs.mkdirSync(profilesDir, { recursive: true });
if (!process.env.DISPATCHER_USER_DATA_DIR) process.env.DISPATCHER_USER_DATA_DIR = path.join(profilesDir, 'dispatcher');
if (!process.env.MEDIC_USER_DATA_DIR) process.env.MEDIC_USER_DATA_DIR = path.join(profilesDir, 'medic');
if (!process.env.MECHANIC_USER_DATA_DIR) process.env.MECHANIC_USER_DATA_DIR = path.join(profilesDir, 'mechanic');

const API_URL = (process.env.API_URL || 'http://localhost:5000').replace(/\/$/, '');
const SIGNER_API_KEY = process.env.SIGNER_API_KEY || '';
const POLL_SECONDS = Math.max(5, parseInt(process.env.POLL_SECONDS, 10) || 20);
const INTERVAL_MS = POLL_SECONDS * 1000;
const ONCE = process.argv.includes('--once');
const BROWSER_TIMEOUT_MS = Math.min(600000, Math.max(60000, parseInt(process.env.BROWSER_TIMEOUT_MS, 10) || 5 * 60 * 1000));
const MAX_PARALLEL = Math.max(1, Math.min(5, parseInt(process.env.MAX_PARALLEL, 10) || 3));
const RETRY_ATTEMPTS = Math.max(1, Math.min(5, parseInt(process.env.RETRY_ATTEMPTS, 10) || 3));
const RETRY_DELAYS_MS = [5000, 15000, 45000]; // 1-я, 2-я, 3-я повторная попытка
const FETCH_TIMEOUT_MS = Math.min(60000, Math.max(5000, parseInt(process.env.FETCH_TIMEOUT_MS, 10) || 30000));
const INACTIVITY_CLOSE_MS = Math.max(60000, parseInt(process.env.INACTIVITY_CLOSE_MS, 10) || 5 * 60 * 1000);
const INACTIVITY_CHECK_INTERVAL_MS = Math.min(60000, Math.max(15000, parseInt(process.env.INACTIVITY_CHECK_INTERVAL_MS, 10) || 60000));

if (!SIGNER_API_KEY) {
  console.error('[UV2] В .env не задан SIGNER_API_KEY.');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${SIGNER_API_KEY}`, 'Content-Type': 'application/json' };
const PROGRAM_STARTED_AT = new Date().toISOString().replace('T', ' ').slice(0, 19);

const logsDir = path.join(appDir, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
const logFile = path.join(logsDir, `universal-worker-v2-${new Date().toISOString().split('T')[0]}.log`);

function log(msg, level = 'INFO', role = '') {
  const prefix = role ? `[${role}] ` : '';
  const line = `[${new Date().toISOString()}] [${level}] ${prefix}${msg}`;
  console.log(`[UV2] ${prefix}${msg}`);
  try {
    fs.appendFileSync(logFile, line + '\n', 'utf8');
  } catch (_) {}
}

const roleState = {
  dispatcher: { context: null, page: null, lastActivityAt: 0 },
  medic: { context: null, page: null, lastActivityAt: 0 },
  mechanic: { context: null, page: null, lastActivityAt: 0 }
};

function isBrowserClosed(context, page) {
  if (!context || !page) return true;
  try {
    if (page.isClosed && page.isClosed()) return true;
    if (context.browser && typeof context.browser === 'function') {
      const b = context.browser();
      if (b && b.isConnected && !b.isConnected()) return true;
    }
  } catch (_) {
    return true;
  }
  return false;
}

function closeBrowser(role) {
  const s = roleState[role];
  if (!s.context) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      if (s.context.close) s.context.close().then(resolve).catch(() => resolve());
      else resolve();
    } catch (_) {
      resolve();
    }
    s.context = null;
    s.page = null;
  });
}

function isCriticalError(err) {
  const msg = (err && err.message) ? String(err.message) : '';
  return /Target closed|browser has been closed|Context closed|Protocol error|Navigation failed/i.test(msg);
}

async function ensureBrowser(role) {
  const s = roleState[role];
  if (s.context && s.page && !isBrowserClosed(s.context, s.page)) return true;
  s.context = null;
  s.page = null;
  const taxcom = require('./taxcom-create.js');
  if (!taxcom.getPlaywright()) {
    log('Playwright не подключён', 'WARN', role);
    return false;
  }
  const opened = await taxcom.openBrowserAndLoginForRole(process.env, role);
  if (opened && opened.context && opened.page) {
    s.context = opened.context;
    s.page = opened.page;
    s.lastActivityAt = Date.now();
    if (opened.page.setDefaultTimeout) opened.page.setDefaultTimeout(60000);
    log('Браузер открыт, логин выполнен', 'INFO', role);
    return true;
  }
  log('Не удалось открыть браузер', 'WARN', role);
  return false;
}

function suitableForDispatcher(item) {
  return !item.mintransId;
}

function suitableForMedic(item) {
  if (!item.mintransId) return false;
  const ts = item.titulStatus || {};
  return ts.t1 === 'signed' && ts.t2 !== 'signed';
}

function suitableForMechanic(item) {
  if (!item.mintransId) return false;
  const ts = item.titulStatus || {};
  return ts.t1 === 'signed' && ts.t2 === 'signed' && (ts.t3 !== 'signed' || ts.t4 !== 'signed');
}

async function fetchPending() {
  const url = `${API_URL}/api/clinic/pending-creation?since=${encodeURIComponent(PROGRAM_STARTED_AT)}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) return [];
  const data = await res.json();
  return data.items || [];
}

async function reportTitulProgress(eplIdVal, titul, status, mintransIdVal) {
  try {
    await fetch(`${API_URL}/api/clinic/titul-progress`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ eplId: eplIdVal, titul, status, mintransId: mintransIdVal || undefined })
    });
  } catch (e) {
    log(`titul-progress: ${e.message}`, 'WARN', 'API');
  }
}

/**
 * @param {string} role
 * @param {object} item - заявка
 * @param {function} taskFn - async (item, page, context) => result (может вернуть { context, page } для обновления состояния)
 * @param {object} [usePage] - конкретная вкладка для параллельного запуска (иначе основная s.page)
 */
async function runWithRetry(role, item, taskFn, usePage) {
  const wb = item.waybillNumber || item.eplId;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    const ok = await ensureBrowser(role);
    if (!ok) {
      const delay = attempt < RETRY_ATTEMPTS ? (RETRY_DELAYS_MS[attempt - 1] || 15000) : 0;
      if (delay > 0) {
        log(`Попытка ${attempt}/${RETRY_ATTEMPTS}: браузер недоступен, повтор через ${delay / 1000} с`, 'WARN', role);
        await new Promise((r) => setTimeout(r, delay));
      }
      continue;
    }
    const s = roleState[role];
    const page = usePage || s.page;
    if (isBrowserClosed(s.context, page)) {
      await closeBrowser(role);
      if (attempt < RETRY_ATTEMPTS) await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1] || 15000));
      continue;
    }
    try {
      const result = await Promise.race([
        taskFn(item, page, s.context),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), BROWSER_TIMEOUT_MS))
      ]);
      if (result && result.context) {
        s.context = result.context;
        s.page = result.page || s.page;
      }
      return result;
    } catch (err) {
      log(`${wb}: ${err.message} (попытка ${attempt}/${RETRY_ATTEMPTS})`, 'ERROR', role);
      if (isCriticalError(err)) {
        await closeBrowser(role);
        log('Браузер сброшен из-за критической ошибки', 'WARN', role);
      }
      if (attempt < RETRY_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[attempt - 1] || 15000;
        log(`Повтор через ${delay / 1000} с`, 'INFO', role);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
  return null;
}

async function getExtraPages(role, count) {
  const s = roleState[role];
  if (!s.context || count < 1) return [];
  const pages = [s.page].filter(Boolean);
  if (pages.length === 0 || isBrowserClosed(s.context, pages[0])) return [];
  for (let i = pages.length; i < count; i++) {
    try {
      const p = await s.context.newPage();
      if (p.setDefaultTimeout) p.setDefaultTimeout(60000);
      pages.push(p);
    } catch (e) {
      log(`Новая вкладка: ${e.message}`, 'WARN', role);
      break;
    }
  }
  return pages;
}

let tickInProgress = false;

async function tick() {
  if (tickInProgress) return;
  tickInProgress = true;
  try {
    let items = await fetchPending();
    if (!items || items.length === 0) return;

    const forD = items.filter(suitableForDispatcher).slice(0, MAX_PARALLEL);
    if (forD.length > 0) {
      const role = 'dispatcher';
      const ok = await ensureBrowser(role);
      if (ok) {
        roleState[role].lastActivityAt = Date.now();
        const pages = await getExtraPages(role, forD.length);
        const toClose = pages.slice(1);
        const tasks = forD.slice(0, pages.length).map((item, i) =>
          runWithRetry(role, item, async (it, page, ctx) => {
            const reuse = page && ctx ? { context: ctx, page } : undefined;
            const taxcom = require('./taxcom-create.js');
            const result = await taxcom.createEplT1Only(it, process.env, reuse, reportTitulProgress);
            const mintransId = result?.mintransId ? String(result.mintransId) : '';
            const isFake = mintransId.startsWith('stub-') || mintransId.startsWith('taxcom-');
            if (result && mintransId && !isFake) {
              await fetch(`${API_URL}/api/clinic/epl-created`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  eplId: it.eplId,
                  mintransId,
                  eplGuid: result.eplGuid || null,
                  qrCode: result.qrCode || null,
                  documentPdf: result.documentPdf || null
                })
              });
              log(`ЭПЛ создан, mintransId: ${mintransId}`, 'INFO', role);
            }
            return result;
          }, pages[i])
        );
        const results = await Promise.allSettled(tasks);
        results.forEach((r, i) => {
          if (r.status === 'rejected') log(`${forD[i]?.waybillNumber}: ${r.reason?.message}`, 'ERROR', role);
        });
        for (const p of toClose) {
          try { await p.close(); } catch (_) {}
        }
        await new Promise((r) => setTimeout(r, 2000));
      } else {
        log('Пропуск диспетчера: браузер недоступен', 'WARN', role);
      }
    }

    items = await fetchPending();
    if (!items || items.length === 0) return;
    const forM = items.filter(suitableForMedic).slice(0, MAX_PARALLEL);
    if (forM.length > 0) {
      const role = 'medic';
      const ok = await ensureBrowser(role);
      if (ok) {
        roleState[role].lastActivityAt = Date.now();
        const pages = await getExtraPages(role, forM.length);
        const toClose = pages.slice(1);
        const tasks = forM.slice(0, pages.length).map((item, i) =>
          runWithRetry(role, item, async (it, page, ctx) => {
            const taxcom = require('./taxcom-create.js');
            const reuse = page && ctx ? { context: ctx, page } : undefined;
            return taxcom.fillAndSignT2Only(it, process.env, reuse, reportTitulProgress);
          }, pages[i])
        );
        const results = await Promise.allSettled(tasks);
        results.forEach((r, i) => {
          if (r.status === 'rejected') log(`${forM[i]?.waybillNumber}: ${r.reason?.message}`, 'ERROR', role);
        });
        for (const p of toClose) {
          try { await p.close(); } catch (_) {}
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    items = await fetchPending();
    if (!items || items.length === 0) return;
    const forMech = items.filter(suitableForMechanic).slice(0, MAX_PARALLEL);
    if (forMech.length > 0) {
      const role = 'mechanic';
      const ok = await ensureBrowser(role);
      if (ok) {
        roleState[role].lastActivityAt = Date.now();
        const pages = await getExtraPages(role, forMech.length);
        const toClose = pages.slice(1);
        const tasks = forMech.slice(0, pages.length).map((item, i) =>
          runWithRetry(role, item, async (it, page, ctx) => {
            const taxcom = require('./taxcom-create.js');
            const reuse = page && ctx ? { context: ctx, page } : undefined;
            const result = await taxcom.fillAndSignT3T4Only(it, process.env, reuse, reportTitulProgress);
            if (result?.documentPdf || result?.qrCode) {
              await fetch(`${API_URL}/api/clinic/epl-created`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  eplId: it.eplId,
                  mintransId: result.mintransId,
                  documentPdf: result.documentPdf || null,
                  qrCode: result.qrCode || null
                })
              });
            }
            return result;
          }, pages[i])
        );
        const results = await Promise.allSettled(tasks);
        results.forEach((r, i) => {
          if (r.status === 'rejected') log(`${forMech[i]?.waybillNumber}: ${r.reason?.message}`, 'ERROR', role);
        });
        for (const p of toClose) {
          try { await p.close(); } catch (_) {}
        }
      }
    } else if (forD.length === 0 && forM.length === 0) {
      log(`В очереди ${items.length} заявок, ждём по цепочке титулов`, 'INFO', 'UV2');
    }
  } catch (e) {
    const isTimeout = e.name === 'AbortError' || (e.message && (e.message.includes('aborted') || e.message.includes('timeout')));
    if (isTimeout) {
      log(`Запрос к API превысил ${FETCH_TIMEOUT_MS / 1000} с`, 'WARN', 'UV2');
    } else {
      log(`Ошибка тика: ${e.message}`, 'ERROR', 'UV2');
    }
  } finally {
    tickInProgress = false;
  }
}

async function main() {
  log(`Универсальный воркер v2. Опрос каждые ${POLL_SECONDS} с. API: ${API_URL}. Параллельно до ${MAX_PARALLEL} на роль. Ретраев: ${RETRY_ATTEMPTS}.`, 'INFO', 'UV2');
  log(`Логи: ${logFile}`, 'INFO', 'UV2');

  await ensureBrowser('dispatcher');
  await ensureBrowser('medic');
  await ensureBrowser('mechanic');

  setInterval(() => {
    const now = Date.now();
    for (const role of ['dispatcher', 'medic', 'mechanic']) {
      const s = roleState[role];
      if (!s.context || !s.page) continue;
      if (isBrowserClosed(s.context, s.page)) continue;
      const inactiveMs = now - (s.lastActivityAt || 0);
      if (inactiveMs >= INACTIVITY_CLOSE_MS) {
        log('Бездействие ' + Math.round(inactiveMs / 60000) + ' мин — закрываю браузер [' + role + ']', 'INFO', 'UV2');
        closeBrowser(role);
      }
    }
  }, INACTIVITY_CHECK_INTERVAL_MS);

  setInterval(() => {
    const uptime = Math.floor(process.uptime() / 60);
    log('Heartbeat: uptime ' + uptime + ' мин', 'INFO', 'UV2');
  }, 5 * 60 * 1000);

  if (ONCE) {
    await tick();
    await Promise.all(['dispatcher', 'medic', 'mechanic'].map((r) => closeBrowser(r)));
    process.exit(0);
    return;
  }

  async function loop() {
    for (;;) {
      await tick().catch((e) => log(`tick: ${e.message}`, 'ERROR', 'UV2'));
      await new Promise((r) => setTimeout(r, INTERVAL_MS));
    }
  }
  loop();
}

async function shutdown() {
  log('Завершение работы, закрытие браузеров...', 'INFO', 'UV2');
  await Promise.all(['dispatcher', 'medic', 'mechanic'].map((r) => closeBrowser(r)));
  process.exit(0);
}

process.on('SIGINT', () => { shutdown(); });
process.on('SIGTERM', () => { shutdown(); });

main().catch((e) => {
  log(`Критическая ошибка: ${e.message}`, 'ERROR', 'UV2');
  process.exit(1);
});
