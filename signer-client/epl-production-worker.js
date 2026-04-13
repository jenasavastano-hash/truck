/**
 * Продакшен-воркер ЭПЛ 24/7: создание документов в Такском, титулы Т1–Т4, PDF и QR на сайт.
 *
 * — Очередь: GET /api/clinic/pending-creation без since — подхватываются все pending_clinic/pending (очередь Такском).
 * — Диспетчер (Т1) → медик (Т2) → механик (Т3+Т4) → выдача PDF/QR на сайт.
 * — Ретраи с экспоненциальной задержкой, при падении браузера — сброс и переоткрытие.
 * — Сессия Такском ~15 мин: принудительный перелогин каждые 10 мин (TAXCOM_SESSION_MAX_AGE_MS).
 * — Heartbeat: POST /api/clinic/heartbeat раз в 2 мин (HEARTBEAT_INTERVAL_MS) для мониторинга 24/7.
 * — Статистика по ролям, логи в файл, корректное завершение по SIGINT/SIGTERM.
 * — Браузер закрывается после 5 мин бездействия (INACTIVITY_CLOSE_MS); при открытии профиль чистится (cookies/storage).
 *
 * Запуск: node epl-production-worker.js  |  node epl-production-worker.js --once
 * Панель: Воркеры → 9) Продакшен-воркер ЭПЛ
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
const POLL_SECONDS = Math.max(3, parseInt(process.env.POLL_SECONDS, 10) || 15);
const INTERVAL_MS = POLL_SECONDS * 1000;
const ONCE = process.argv.includes('--once');
const BROWSER_TIMEOUT_MS = Math.min(600000, Math.max(90000, parseInt(process.env.BROWSER_TIMEOUT_MS, 10) || 6 * 60 * 1000));
const MAX_PARALLEL = Math.max(1, Math.min(6, parseInt(process.env.MAX_PARALLEL, 10) || 4));
const RETRY_ATTEMPTS = Math.max(1, Math.min(5, parseInt(process.env.RETRY_ATTEMPTS, 10) || 3));
const RETRY_DELAYS_MS = [5000, 20000, 60000];
const FETCH_TIMEOUT_MS = Math.min(60000, Math.max(5000, parseInt(process.env.FETCH_TIMEOUT_MS, 10) || 25000));
const API_POST_TIMEOUT_MS = Math.min(30000, Math.max(5000, parseInt(process.env.API_POST_TIMEOUT_MS, 10) || 15000));
const STATS_INTERVAL_MIN = Math.max(1, parseInt(process.env.STATS_INTERVAL_MIN, 10) || 5);
const SHUTDOWN_WAIT_MS = Math.min(120000, Math.max(10000, parseInt(process.env.SHUTDOWN_WAIT_MS, 10) || 45000));
const CONSECUTIVE_FAILURES_BEFORE_RESTART = Math.max(2, parseInt(process.env.CONSECUTIVE_FAILURES_BEFORE_RESTART, 10) || 3);
/** Сессия Такском живёт ~15 мин — принудительно перелогиниваемся каждые 10 мин */
const TAXCOM_SESSION_MAX_AGE_MS = Math.min(14 * 60 * 1000, Math.max(8 * 60 * 1000, parseInt(process.env.TAXCOM_SESSION_MAX_AGE_MS, 10) || 10 * 60 * 1000));
const HEARTBEAT_INTERVAL_MS = Math.min(5 * 60 * 1000, Math.max(60 * 1000, parseInt(process.env.HEARTBEAT_INTERVAL_MS, 10) || 2 * 60 * 1000));
/** Пауза после закрытия браузера перед новым запуском (профиль должен освободиться) */
const DELAY_AFTER_CLOSE_MS = Math.min(15000, Math.max(2000, parseInt(process.env.DELAY_AFTER_CLOSE_MS, 10) || 4000));
/** Минимальная пауза перед любым запуском браузера, если контекст был закрыт (снижает race с профилем) */
const MIN_DELAY_BEFORE_LAUNCH_MS = Math.min(5000, Math.max(1000, parseInt(process.env.MIN_DELAY_BEFORE_LAUNCH_MS, 10) || 2500));
/** Закрывать браузер после N минут бездействия (нет батчей по этой роли) */
const INACTIVITY_CLOSE_MS = Math.max(60 * 1000, parseInt(process.env.INACTIVITY_CLOSE_MS, 10) || 5 * 60 * 1000);
const INACTIVITY_CHECK_INTERVAL_MS = Math.min(60000, Math.max(15000, parseInt(process.env.INACTIVITY_CHECK_INTERVAL_MS, 10) || 60000));
/** Когда в тике была работа — следующий опрос через это время (мс), иначе через INTERVAL_MS */
const POLL_BUSY_MS = Math.min(INTERVAL_MS, Math.max(2000, parseInt(process.env.POLL_BUSY_MS, 10) || 5000));

if (!SIGNER_API_KEY) {
  console.error('[EPL-Prod] В .env не задан SIGNER_API_KEY.');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${SIGNER_API_KEY}`, 'Content-Type': 'application/json' };
/** Для логов; очередь подхватываем без фильтра по дате (все pending_clinic/pending) */
const PROGRAM_STARTED_AT = new Date().toISOString().replace('T', ' ').slice(0, 19);

const logsDir = path.join(appDir, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
const logFile = path.join(logsDir, `epl-production-worker-${new Date().toISOString().split('T')[0]}.log`);

const stats = {
  startTime: Date.now(),
  ticks: 0,
  dispatcher: { ok: 0, fail: 0, lastError: null },
  medic: { ok: 0, fail: 0, lastError: null },
  mechanic: { ok: 0, fail: 0, lastError: null },
  apiErrors: 0
};

let shuttingDown = false;
let heartbeat404Logged = false;
/** Количество ролей, сейчас выполняющих батч (для корректного shutdown) */
let activeRoleBatches = 0;

function log(msg, level = 'INFO', meta = {}) {
  const role = meta.role || '';
  const eplId = meta.eplId != null ? ` eplId=${meta.eplId}` : '';
  const wb = meta.waybill ? ` ${meta.waybill}` : '';
  const prefix = role ? `[${role}]` : '[EPL-Prod]';
  const line = `[${new Date().toISOString()}] [${level}] ${prefix}${eplId}${wb} ${msg}`;
  console.log(`[EPL-Prod] ${prefix}${eplId}${wb} ${msg}`);
  try {
    fs.appendFileSync(logFile, line + '\n', 'utf8');
  } catch (_) {}
}

const roleState = {
  dispatcher: { context: null, page: null, consecutiveFailures: 0, lastLoginAt: 0, lastActivityAt: 0 },
  medic: { context: null, page: null, consecutiveFailures: 0, lastLoginAt: 0, lastActivityAt: 0 },
  mechanic: { context: null, page: null, consecutiveFailures: 0, lastLoginAt: 0, lastActivityAt: 0 }
};

function isBrowserClosed(context, page) {
  if (!context || !page) return true;
  try {
    if (typeof page.isClosed === 'function' && page.isClosed()) return true;
    if (context.browser && typeof context.browser === 'function') {
      const b = context.browser();
      if (b && typeof b.isConnected === 'function' && !b.isConnected()) return true;
    }
  } catch (_) {
    return true;
  }
  return false;
}

function closeBrowser(role) {
  const s = roleState[role];
  const ctx = s.context;
  s.context = null;
  s.page = null;
  s.consecutiveFailures = 0;
  s.lastLoginAt = 0;
  if (!ctx) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      if (ctx.close) ctx.close().then(resolve).catch(() => resolve());
      else resolve();
    } catch (_) {
      resolve();
    }
  });
}

function isCriticalError(err) {
  const msg = (err && err.message) ? String(err.message) : '';
  return /Target closed|browser has been closed|Context closed|Protocol error|Navigation failed/i.test(msg);
}

async function ensureBrowser(role) {
  const s = roleState[role];
  const now = Date.now();
  const sessionAge = now - (s.lastLoginAt || 0);
  if (s.context && s.page && !isBrowserClosed(s.context, s.page)) {
    if (sessionAge >= TAXCOM_SESSION_MAX_AGE_MS) {
      log(`Сессия Такском старше ${Math.round(sessionAge / 60000)} мин — перелогин (аккаунт ${role})`, 'INFO', { role });
      await closeBrowser(role);
      log(`Пауза ${DELAY_AFTER_CLOSE_MS / 1000} с после закрытия профиля перед новым запуском`, 'INFO', { role });
      await new Promise((r) => setTimeout(r, DELAY_AFTER_CLOSE_MS));
    } else {
      return true;
    }
  } else {
    s.context = null;
    s.page = null;
    if (MIN_DELAY_BEFORE_LAUNCH_MS > 0) {
      log(`Пауза ${MIN_DELAY_BEFORE_LAUNCH_MS / 1000} с перед запуском браузера (профиль)`, 'INFO', { role });
      await new Promise((r) => setTimeout(r, MIN_DELAY_BEFORE_LAUNCH_MS));
    }
  }
  const taxcom = require('./taxcom-create.js');
  if (!taxcom.getPlaywright()) {
    log('Playwright не подключён', 'WARN', { role });
    return false;
  }
  const opened = await taxcom.openBrowserAndLoginForRole(process.env, role);
  if (opened && opened.context && opened.page) {
    s.context = opened.context;
    s.page = opened.page;
    s.lastLoginAt = Date.now();
    s.lastActivityAt = Date.now();
    if (opened.page.setDefaultTimeout) opened.page.setDefaultTimeout(60000);
    log('Браузер открыт, логин выполнен', 'INFO', { role });
    return true;
  }
  log('Не удалось открыть браузер', 'WARN', { role });
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

function suitableForRole(role) {
  if (role === 'dispatcher') return suitableForDispatcher;
  if (role === 'medic') return suitableForMedic;
  if (role === 'mechanic') return suitableForMechanic;
  return () => false;
}

async function fetchPending() {
  const url = `${API_URL}/api/clinic/pending-creation`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    stats.apiErrors++;
    log(`pending-creation: ${res.status}`, 'WARN', {});
    return [];
  }
  const data = await res.json();
  return Array.isArray(data.items) ? data.items : [];
}

async function reportTitulProgress(eplIdVal, titul, status, mintransIdVal) {
  try {
    await fetch(`${API_URL}/api/clinic/titul-progress`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ eplId: eplIdVal, titul, status, mintransId: mintransIdVal || undefined }),
      signal: AbortSignal.timeout(API_POST_TIMEOUT_MS)
    });
  } catch (e) {
    stats.apiErrors++;
    log(`titul-progress: ${e.message}`, 'WARN', { role: 'API' });
  }
}

async function postEplCreated(payload) {
  try {
    const res = await fetch(`${API_URL}/api/clinic/epl-created`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(API_POST_TIMEOUT_MS)
    });
    if (!res.ok) {
      stats.apiErrors++;
      log(`epl-created: ${res.status}`, 'WARN', { role: 'API', eplId: payload.eplId });
      return false;
    }
    return true;
  } catch (e) {
    stats.apiErrors++;
    log(`epl-created: ${e.message}`, 'WARN', { role: 'API', eplId: payload.eplId });
    return false;
  }
}

async function runWithRetry(role, item, taskFn, usePage) {
  const wb = item.waybillNumber || item.eplId;
  const s = roleState[role];
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    if (shuttingDown) return null;
    const ok = await ensureBrowser(role);
    if (!ok) {
      const delay = attempt < RETRY_ATTEMPTS ? (RETRY_DELAYS_MS[attempt - 1] ?? 15000) : 0;
      if (delay > 0) {
        log(`браузер недоступен, повтор через ${delay / 1000} с (${attempt}/${RETRY_ATTEMPTS})`, 'WARN', { role, waybill: wb });
        await new Promise((r) => setTimeout(r, delay));
      }
      continue;
    }
    if (s.consecutiveFailures >= CONSECUTIVE_FAILURES_BEFORE_RESTART) {
      log(`подряд ошибок: ${s.consecutiveFailures}, перезапуск браузера`, 'WARN', { role });
      await closeBrowser(role);
      s.consecutiveFailures = 0;
      if (attempt < RETRY_ATTEMPTS) await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[0]));
      continue;
    }
    const page = usePage || s.page;
    if (isBrowserClosed(s.context, page)) {
      await closeBrowser(role);
      if (attempt < RETRY_ATTEMPTS) await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1] ?? 15000));
      continue;
    }
    try {
      const result = await Promise.race([
        taskFn(item, page, s.context),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), BROWSER_TIMEOUT_MS))
      ]);
      s.consecutiveFailures = 0;
      if (result && result.context) {
        s.context = result.context;
        s.page = result.page || s.page;
      }
      return result;
    } catch (err) {
      s.consecutiveFailures++;
      if (stats[role]) {
        stats[role].fail++;
        stats[role].lastError = err.message;
      }
      log(`${err.message} (попытка ${attempt}/${RETRY_ATTEMPTS})`, 'ERROR', { role, eplId: item.eplId, waybill: wb });
      if (isCriticalError(err)) {
        await closeBrowser(role);
        log('браузер сброшен (критическая ошибка)', 'WARN', { role });
      }
      if (attempt < RETRY_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? 15000;
        await new Promise((r) => setTimeout(r, delay));
      } else {
        return null;
      }
    }
  }
  return null;
}

/** Закрывает все вкладки в контексте роли, кроме основной (s.page). Вызывать при входе в батч и после выхода. */
async function closeExtraTabs(role) {
  const s = roleState[role];
  if (!s?.context) return;
  try {
    const all = typeof s.context.pages === 'function' ? await s.context.pages() : [];
    const main = s.page;
    for (const p of all) {
      if (p !== main && p && typeof p.close === 'function') {
        try {
          if (!p.isClosed || !p.isClosed()) await p.close();
        } catch (_) {}
      }
    }
    if (all.length > 1) log(`Закрыто лишних вкладок: ${all.length - 1}`, 'INFO', { role });
  } catch (e) {
    log(`Закрытие лишних вкладок: ${e.message}`, 'WARN', { role });
  }
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
      log(`новая вкладка: ${e.message}`, 'WARN', { role });
      break;
    }
  }
  return pages;
}

async function runDispatcherBatch(items) {
  const role = 'dispatcher';
  const ok = await ensureBrowser(role);
  if (!ok) return;
  if (shuttingDown) return;
  roleState[role].lastActivityAt = Date.now();
  await closeExtraTabs(role);
  const pages = await getExtraPages(role, items.length);
  const toClose = pages.slice(1);
  const tasks = items.slice(0, pages.length).map((item, i) =>
    runWithRetry(role, item, async (it, page, ctx) => {
      const taxcom = require('./taxcom-create.js');
      const reuse = page && ctx ? { context: ctx, page } : undefined;
      const result = await taxcom.createEplT1Only(it, process.env, reuse, reportTitulProgress);
      const mintransId = result?.mintransId ? String(result.mintransId) : '';
      const isFake = mintransId.startsWith('stub-') || mintransId.startsWith('taxcom-');
      if (result && mintransId && !isFake) {
        await postEplCreated({
          eplId: it.eplId,
          mintransId,
          eplGuid: result.eplGuid || null,
          qrCode: result.qrCode || null,
          documentPdf: result.documentPdf || null
        });
        stats.dispatcher.ok++;
        log('ЭПЛ создан, mintransId получен', 'INFO', { role, eplId: it.eplId, waybill: it.waybillNumber });
      }
      return result;
    }, pages[i])
  );
  const results = await Promise.allSettled(tasks);
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      stats.dispatcher.fail++;
      stats.dispatcher.lastError = r.reason?.message;
      log(`${r.reason?.message}`, 'ERROR', { role, waybill: items[i]?.waybillNumber });
    }
  });
  for (const p of toClose) {
    try { await p.close(); } catch (_) {}
  }
  await closeExtraTabs(role);
}

async function runMedicBatch(items) {
  const role = 'medic';
  const ok = await ensureBrowser(role);
  if (!ok) return;
  if (shuttingDown) return;
  roleState[role].lastActivityAt = Date.now();
  await closeExtraTabs(role);
  const pages = await getExtraPages(role, items.length);
  const toClose = pages.slice(1);
  const tasks = items.slice(0, pages.length).map((item, i) =>
    runWithRetry(role, item, async (it, page, ctx) => {
      const taxcom = require('./taxcom-create.js');
      const reuse = page && ctx ? { context: ctx, page } : undefined;
      return taxcom.fillAndSignT2Only(it, process.env, reuse, reportTitulProgress);
    }, pages[i])
  );
  const results = await Promise.allSettled(tasks);
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value?.mintransId) {
      stats.medic.ok++;
      log('Т2 подписан', 'INFO', { role, eplId: items[i]?.eplId, waybill: items[i]?.waybillNumber });
    } else if (r.status === 'rejected') {
      stats.medic.fail++;
      stats.medic.lastError = r.reason?.message;
      log(`${r.reason?.message}`, 'ERROR', { role, waybill: items[i]?.waybillNumber });
    }
  });
  for (const p of toClose) {
    try { await p.close(); } catch (_) {}
  }
  await closeExtraTabs(role);
}

async function runMechanicBatch(items) {
  const role = 'mechanic';
  const ok = await ensureBrowser(role);
  if (!ok) return;
  if (shuttingDown) return;
  roleState[role].lastActivityAt = Date.now();
  await closeExtraTabs(role);
  const pages = await getExtraPages(role, items.length);
  const toClose = pages.slice(1);
  const tasks = items.slice(0, pages.length).map((item, i) =>
    runWithRetry(role, item, async (it, page, ctx) => {
      const taxcom = require('./taxcom-create.js');
      const reuse = page && ctx ? { context: ctx, page } : undefined;
      const result = await taxcom.fillAndSignT3T4Only(it, process.env, reuse, reportTitulProgress);
      if (result?.mintransId) {
        stats.mechanic.ok++;
        log('Т3 и Т4 подписаны', 'INFO', { role, eplId: it.eplId, waybill: it.waybillNumber });
        if (result.documentPdf || result.qrCode) {
          const sent = await postEplCreated({
            eplId: it.eplId,
            mintransId: result.mintransId,
            documentPdf: result.documentPdf || null,
            qrCode: result.qrCode || null
          });
          if (sent) log('PDF/QR минтранс отправлены на сайт', 'INFO', { role, eplId: it.eplId });
        }
      }
      return result;
    }, pages[i])
  );
  const results = await Promise.allSettled(tasks);
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      stats.mechanic.fail++;
      stats.mechanic.lastError = r.reason?.message;
      log(`${r.reason?.message}`, 'ERROR', { role, waybill: items[i]?.waybillNumber });
    }
  });
  for (const p of toClose) {
    try { await p.close(); } catch (_) {}
  }
  await closeExtraTabs(role);
}

function logStats() {
  const uptimeMin = Math.floor((Date.now() - stats.startTime) / 60000);
  log(
    `Статистика: тиков=${stats.ticks} uptime=${uptimeMin}мин | ` +
    `Диспетчер: ok=${stats.dispatcher.ok} fail=${stats.dispatcher.fail} | ` +
    `Медик: ok=${stats.medic.ok} fail=${stats.medic.fail} | ` +
    `Механик: ok=${stats.mechanic.ok} fail=${stats.mechanic.fail} | apiErrors=${stats.apiErrors}`,
    'INFO',
    {}
  );
  if (stats.dispatcher.lastError || stats.medic.lastError || stats.mechanic.lastError) {
    log(
      `Последние ошибки: Д=${stats.dispatcher.lastError || '—'} М=${stats.medic.lastError || '—'} Мех=${stats.mechanic.lastError || '—'}`,
      'WARN',
      {}
    );
  }
}

/** Один цикл для роли: взять подходящие заявки, обработать батч, пауза. Новая заявка подхватывается при следующем цикле без ожидания других ролей. */
async function roleLoop(role) {
  const label = role === 'dispatcher' ? 'диспетчер' : role === 'medic' ? 'медик' : 'механик';
  const runBatch =
    role === 'dispatcher' ? runDispatcherBatch : role === 'medic' ? runMedicBatch : runMechanicBatch;
  const suitable = suitableForRole(role);
  while (!shuttingDown) {
    try {
      const items = await fetchPending();
      if (shuttingDown || !items || items.length === 0) {
        await new Promise((r) => setTimeout(r, INTERVAL_MS));
        continue;
      }
      const batch = items.filter(suitable).slice(0, MAX_PARALLEL);
      if (batch.length === 0) {
        await new Promise((r) => setTimeout(r, INTERVAL_MS));
        continue;
      }
      stats.ticks++;
      log(`Очередь: всего ${items.length}, ${label} обрабатывает ${batch.length}`, 'INFO', {});
      activeRoleBatches++;
      try {
        await runBatch(batch);
      } finally {
        activeRoleBatches--;
      }
      const delayMs = POLL_BUSY_MS;
      if (!shuttingDown) await new Promise((r) => setTimeout(r, delayMs));
    } catch (e) {
      const isTimeout = e.name === 'AbortError' || (e.message && (e.message.includes('aborted') || e.message.includes('timeout')));
      log(isTimeout ? `Запрос к API превысил ${FETCH_TIMEOUT_MS / 1000} с` : `Ошибка цикла ${label}: ${e.message}`, isTimeout ? 'WARN' : 'ERROR', {});
      if (!shuttingDown) await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

async function main() {
  log(
    `Старт. API=${API_URL} опрос=${POLL_SECONDS}с параллель=${MAX_PARALLEL} ретраев=${RETRY_ATTEMPTS} таймаут браузера=${BROWSER_TIMEOUT_MS / 1000}с`,
    'INFO',
    {}
  );
  log(`Логи: ${logFile}`, 'INFO', {});

  await ensureBrowser('dispatcher');
  await ensureBrowser('medic');
  await ensureBrowser('mechanic');

  async function sendHeartbeat() {
    if (shuttingDown) return;
    const uptimeMin = Math.floor(process.uptime() / 60);
    const lastErr = [stats.dispatcher.lastError, stats.medic.lastError, stats.mechanic.lastError].filter(Boolean).join('; ') || null;
    try {
      const res = await fetch(`${API_URL}/api/clinic/heartbeat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          source: 'epl_production_worker',
          uptimeMin,
          ticks: stats.ticks,
          lastError: lastErr
        }),
        signal: AbortSignal.timeout(5000)
      });
      if (res.status === 404) {
        if (!heartbeat404Logged) {
          heartbeat404Logged = true;
          log('Heartbeat: endpoint не найден (404) — задеплойте backend с POST /api/clinic/heartbeat', 'INFO', {});
        }
      } else if (!res.ok) {
        log(`heartbeat: ${res.status}`, 'WARN', {});
      }
    } catch (e) {
      log(`heartbeat: ${e.message}`, 'WARN', {});
    }
    log(`Heartbeat: uptime ${uptimeMin} мин, тиков ${stats.ticks}`, 'INFO', {});
  }

  setInterval(() => { sendHeartbeat(); }, HEARTBEAT_INTERVAL_MS);
  sendHeartbeat();

  setInterval(() => {
    if (shuttingDown) return;
    const now = Date.now();
    for (const role of ['dispatcher', 'medic', 'mechanic']) {
      const s = roleState[role];
      if (!s.context || !s.page) continue;
      if (isBrowserClosed(s.context, s.page)) continue;
      const inactiveMs = now - (s.lastActivityAt || 0);
      if (inactiveMs >= INACTIVITY_CLOSE_MS) {
        log(`Бездействие ${Math.round(inactiveMs / 60000)} мин — закрываю браузер`, 'INFO', { role });
        closeBrowser(role);
      }
    }
  }, INACTIVITY_CHECK_INTERVAL_MS);

  setInterval(() => {
    if (shuttingDown) return;
    logStats();
  }, STATS_INTERVAL_MIN * 60 * 1000);

  if (ONCE) {
    let items = await fetchPending();
    if (items?.length) await runDispatcherBatch(items.filter(suitableForDispatcher).slice(0, MAX_PARALLEL));
    items = await fetchPending();
    if (items?.length) await runMedicBatch(items.filter(suitableForMedic).slice(0, MAX_PARALLEL));
    items = await fetchPending();
    if (items?.length) await runMechanicBatch(items.filter(suitableForMechanic).slice(0, MAX_PARALLEL));
    await Promise.all(['dispatcher', 'medic', 'mechanic'].map((r) => closeBrowser(r)));
    logStats();
    process.exit(0);
    return;
  }

  const shutdownPromise = new Promise((resolve) => { shutdownResolve = resolve; });

  Promise.all([roleLoop('dispatcher'), roleLoop('medic'), roleLoop('mechanic')]).catch((e) => {
    log(`Цикл роли: ${e.message}`, 'ERROR', {});
  });

  await shutdownPromise;
  await shutdown();
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log('Завершение работы (SIGINT/SIGTERM), ожидание текущих батчей...', 'INFO', {});
  const deadline = Date.now() + SHUTDOWN_WAIT_MS;
  while (activeRoleBatches > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
  }
  logStats();
  log('Закрытие браузеров...', 'INFO', {});
  await Promise.all(['dispatcher', 'medic', 'mechanic'].map((r) => closeBrowser(r)));
  log('Выход', 'INFO', {});
  process.exit(0);
}

let shutdownResolve;
process.on('SIGINT', () => { shuttingDown = true; if (typeof shutdownResolve === 'function') shutdownResolve(); });
process.on('SIGTERM', () => { shuttingDown = true; if (typeof shutdownResolve === 'function') shutdownResolve(); });

main().catch((e) => {
  log(`Критическая ошибка: ${e.message}`, 'ERROR', {});
  process.exit(1);
});
