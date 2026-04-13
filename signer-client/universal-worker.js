/**
 * Универсальный воркер: диспетчер + медик + механик в одном процессе.
 * Один браузер на роль; в каждом тике обрабатывает до MAX_PARALLEL заявок на роль параллельно (по вкладке на заявку).
 * Проверяет titulStatus перед обработкой (T1 → T2 → T3/T4).
 *
 * Запуск: node universal-worker.js   или   node universal-worker.js --once
 * Из панели: Воркеры → 6) Универсальный воркер
 * MAX_PARALLEL в .env (по умолчанию 3) — сколько ЭПЛ обрабатывать параллельно по каждой роли.
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

// Режим «по 1 браузеру на роль» — в taxcom-create не делать релогины при переиспользовании
process.env.UNIVERSAL_WORKER = '1';

// Отдельный профиль браузера на роль — иначе все три откроют один User Data и будут конфликтовать
const profilesDir = path.join(appDir, 'profiles');
if (!fs.existsSync(profilesDir)) fs.mkdirSync(profilesDir, { recursive: true });
if (!process.env.DISPATCHER_USER_DATA_DIR) process.env.DISPATCHER_USER_DATA_DIR = path.join(profilesDir, 'dispatcher');
if (!process.env.MEDIC_USER_DATA_DIR) process.env.MEDIC_USER_DATA_DIR = path.join(profilesDir, 'medic');
if (!process.env.MECHANIC_USER_DATA_DIR) process.env.MECHANIC_USER_DATA_DIR = path.join(profilesDir, 'mechanic');

const API_URL = (process.env.API_URL || 'http://localhost:5000').replace(/\/$/, '');
const SIGNER_API_KEY = process.env.SIGNER_API_KEY || '';
const POLL_SECONDS = parseInt(process.env.POLL_SECONDS, 10) || 20;
const INTERVAL_MS = POLL_SECONDS * 1000;
const ONCE = process.argv.includes('--once');
const BROWSER_TIMEOUT_MS = parseInt(process.env.BROWSER_TIMEOUT_MS, 10) || 5 * 60 * 1000;
/** Сколько ЭПЛ обрабатывать параллельно по каждой роли (диспетчер/медик/механик) за один тик */
const MAX_PARALLEL = Math.max(1, parseInt(process.env.MAX_PARALLEL, 10) || 3);

if (!SIGNER_API_KEY) {
  console.error('[Universal] В .env не задан SIGNER_API_KEY.');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${SIGNER_API_KEY}`, 'Content-Type': 'application/json' };
const PROGRAM_STARTED_AT = new Date().toISOString().replace('T', ' ').slice(0, 19);

const logsDir = path.join(appDir, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
const logFile = path.join(logsDir, `universal-worker-${new Date().toISOString().split('T')[0]}.log`);

function log(msg, level = 'INFO') {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
  console.log(msg);
  try {
    fs.appendFileSync(logFile, line + '\n', 'utf8');
  } catch (_) {}
}

const roleState = {
  dispatcher: { context: null, page: null, isProcessing: false, lastEplId: null, lastTime: 0 },
  medic: { context: null, page: null, isProcessing: false, lastEplId: null, lastTime: 0 },
  mechanic: { context: null, page: null, isProcessing: false, lastEplId: null, lastTime: 0 }
};

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

function isBrowserClosed(context, page) {
  if (!context || !page) return true;
  try {
    if (page.isClosed()) return true;
    if (context.browser && context.browser().isConnected && !context.browser().isConnected()) return true;
  } catch (_) {
    return true;
  }
  return false;
}

function canProcess(role, eplId) {
  const s = roleState[role];
  if (s.isProcessing) return false;
  const now = Date.now();
  if (s.lastEplId === eplId && (now - s.lastTime) < 30000) return false;
  if (s.lastEplId === eplId && (now - s.lastTime) >= 300000) s.lastEplId = null;
  // Проверяем, закрыт ли браузер
  if (isBrowserClosed(s.context, s.page)) {
    s.context = null;
    s.page = null;
  }
  return true;
}

async function initRole(role) {
  const s = roleState[role];
  // Если браузер уже открыт и работает - не открываем заново
  if (s.context && s.page && !isBrowserClosed(s.context, s.page)) {
    log(`[${role}] Браузер уже открыт, пропускаю инициализацию`);
    return true;
  }
  const taxcom = require('./taxcom-create.js');
  if (!taxcom.getPlaywright()) {
    log(`[${role}] Playwright не подключён`, 'WARN');
    return false;
  }
  const opened = await taxcom.openBrowserAndLoginForRole(process.env, role);
  if (opened) {
    s.context = opened.context;
    s.page = opened.page;
    if (opened.page) opened.page.setDefaultTimeout(60000);
    log(`[${role}] Браузер открыт, логин выполнен`);
    return true;
  }
  log(`[${role}] Браузер не открыт`, 'WARN');
  return false;
}

/**
 * @param {object} item - заявка
 * @param {object} [taskPage] - если задана, используется эта вкладка (параллельный запуск); иначе основная s.page
 */
async function runDispatcher(item, taskPage) {
  const role = 'dispatcher';
  const s = roleState[role];
  const { eplId, waybillNumber, driver } = item;
  const parallel = !!taskPage;
  if (!parallel && !canProcess(role, eplId)) return;
  if (!parallel) {
    s.isProcessing = true;
    s.lastEplId = eplId;
    s.lastTime = Date.now();
  }

  const reportTitulProgress = async (eplIdVal, titul, status, mintransIdVal) => {
    try {
      await fetch(`${API_URL}/api/clinic/titul-progress`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ eplId: eplIdVal, titul, status, mintransId: mintransIdVal })
      });
    } catch (e) { log(`[Dispatcher] titul-progress: ${e.message}`, 'WARN'); }
  };

  const pageToUse = taskPage || s.page;
  try {
    log(`[Dispatcher] Заявка: ${waybillNumber}, водитель: ${driver?.fullName || '—'}`);
    if (isBrowserClosed(s.context, pageToUse)) {
      if (!parallel) { s.context = null; s.page = null; }
      return;
    }
    const taxcom = require('./taxcom-create.js');
    const reuse = s.context && pageToUse && !isBrowserClosed(s.context, pageToUse) ? { context: s.context, page: pageToUse } : undefined;
    const result = await Promise.race([
      taxcom.createEplT1Only(item, process.env, reuse, reportTitulProgress),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), BROWSER_TIMEOUT_MS))
    ]);

    const mintransId = result?.mintransId ? String(result.mintransId) : '';
    const isFake = mintransId.startsWith('stub-') || mintransId.startsWith('taxcom-');
    if (result && mintransId && !isFake) {
      if (!parallel && result.context && result.page) {
        s.context = result.context;
        s.page = result.page;
      }
      log(`[Dispatcher] ЭПЛ создан, mintransId: ${mintransId}`);
      const eplRes = await fetch(`${API_URL}/api/clinic/epl-created`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          eplId,
          mintransId,
          eplGuid: result.eplGuid || null,
          qrCode: result.qrCode || null,
          documentPdf: result.documentPdf || null
        })
      });
      if (eplRes.ok) log('[Dispatcher] epl-created отправлен');
      else log(`[Dispatcher] epl-created: ${eplRes.status}`, 'WARN');
    } else {
      if (!parallel && isBrowserClosed(s.context, s.page)) {
        s.context = null;
        s.page = null;
      }
      log(`[Dispatcher] Не получен mintransId для ${waybillNumber}`, 'WARN');
    }
  } catch (err) {
    const isCritical = err.message.includes('Target closed') || err.message.includes('browser has been closed') || err.message.includes('Context closed');
    if (!parallel && (isCritical || isBrowserClosed(s.context, s.page))) {
      s.context = null;
      s.page = null;
      log(`[Dispatcher] Браузер закрыт, будет переоткрыт при следующей попытке`, 'WARN');
    }
    log(`[Dispatcher] Ошибка ${waybillNumber}: ${err.message}`, 'ERROR');
  } finally {
    if (!parallel) {
      s.lastEplId = null;
      s.isProcessing = false;
    }
  }
}

/** @param {object} item - заявка. @param {object} [taskPage] - вкладка для параллельного запуска */
async function runMedic(item, taskPage) {
  const role = 'medic';
  const s = roleState[role];
  const { eplId, waybillNumber, mintransId } = item;
  const parallel = !!taskPage;
  if (!parallel && !canProcess(role, eplId)) return;
  if (!parallel) {
    s.isProcessing = true;
    s.lastEplId = eplId;
    s.lastTime = Date.now();
  }

  const reportTitulProgress = async (eplIdVal, titul, status, mintransIdVal) => {
    try {
      await fetch(`${API_URL}/api/clinic/titul-progress`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ eplId: eplIdVal, titul, status, mintransId: mintransIdVal })
      });
    } catch (e) { log(`[Medic] titul-progress: ${e.message}`, 'WARN'); }
  };

  const pageToUse = taskPage || s.page;
  try {
    log(`[Medic] Заявка: ${waybillNumber}, mintransId: ${mintransId}`);
    if (isBrowserClosed(s.context, pageToUse)) {
      if (!parallel) { s.context = null; s.page = null; }
      return;
    }
    const taxcom = require('./taxcom-create.js');
    const reuse = s.context && pageToUse && !isBrowserClosed(s.context, pageToUse) ? { context: s.context, page: pageToUse } : undefined;
    const result = await Promise.race([
      taxcom.fillAndSignT2Only(item, process.env, reuse, reportTitulProgress),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), BROWSER_TIMEOUT_MS))
    ]);
    if (result?.mintransId) {
      if (!parallel && result.context && result.page) {
        s.context = result.context;
        s.page = result.page;
      }
      log(`[Medic] Т2 подписан для ${waybillNumber}`);
    } else {
      if (!parallel && isBrowserClosed(s.context, s.page)) {
        s.context = null;
        s.page = null;
      }
      log(`[Medic] Т2 не подписан для ${waybillNumber}`, 'WARN');
    }
  } catch (err) {
    const isCritical = err.message.includes('Target closed') || err.message.includes('browser has been closed') || err.message.includes('Context closed');
    if (!parallel && (isCritical || isBrowserClosed(s.context, s.page))) {
      s.context = null;
      s.page = null;
      log(`[Medic] Браузер закрыт, будет переоткрыт при следующей попытке`, 'WARN');
    }
    log(`[Medic] Ошибка ${waybillNumber}: ${err.message}`, 'ERROR');
  } finally {
    if (!parallel) {
      s.lastEplId = null;
      s.isProcessing = false;
    }
  }
}

/** @param {object} item - заявка. @param {object} [taskPage] - вкладка для параллельного запуска */
async function runMechanic(item, taskPage) {
  const role = 'mechanic';
  const s = roleState[role];
  const { eplId, waybillNumber, mintransId } = item;
  const parallel = !!taskPage;
  if (!parallel && !canProcess(role, eplId)) return;
  if (!parallel) {
    s.isProcessing = true;
    s.lastEplId = eplId;
    s.lastTime = Date.now();
  }

  const reportTitulProgress = async (eplIdVal, titul, status, mintransIdVal) => {
    try {
      await fetch(`${API_URL}/api/clinic/titul-progress`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ eplId: eplIdVal, titul, status, mintransId: mintransIdVal })
      });
    } catch (e) { log(`[Mechanic] titul-progress: ${e.message}`, 'WARN'); }
  };

  const pageToUse = taskPage || s.page;
  try {
    log(`[Mechanic] Заявка: ${waybillNumber}, mintransId: ${mintransId}`);
    if (isBrowserClosed(s.context, pageToUse)) {
      if (!parallel) { s.context = null; s.page = null; }
      return;
    }
    const taxcom = require('./taxcom-create.js');
    const reuse = s.context && pageToUse && !isBrowserClosed(s.context, pageToUse) ? { context: s.context, page: pageToUse } : undefined;
    const result = await Promise.race([
      taxcom.fillAndSignT3T4Only(item, process.env, reuse, reportTitulProgress),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), BROWSER_TIMEOUT_MS))
    ]);
    if (result?.mintransId) {
      if (!parallel && result.context && result.page) {
        s.context = result.context;
        s.page = result.page;
      }
      log(`[Mechanic] Т3 и Т4 подписаны для ${waybillNumber}`);
      if (result.documentPdf || result.qrCode) {
        const eplRes = await fetch(`${API_URL}/api/clinic/epl-created`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            eplId,
            mintransId: result.mintransId,
            documentPdf: result.documentPdf || null,
            qrCode: result.qrCode || null
          })
        });
        if (eplRes.ok) log('[Mechanic] PDF/QR отправлены');
        else log(`[Mechanic] epl-created: ${eplRes.status}`, 'WARN');
      }
    } else {
      if (!parallel && isBrowserClosed(s.context, s.page)) {
        s.context = null;
        s.page = null;
      }
      log(`[Mechanic] Т3/Т4 не подписаны для ${waybillNumber}`, 'WARN');
    }
  } catch (err) {
    const isCritical = err.message.includes('Target closed') || err.message.includes('browser has been closed') || err.message.includes('Context closed');
    if (!parallel && (isCritical || isBrowserClosed(s.context, s.page))) {
      s.context = null;
      s.page = null;
      log(`[Mechanic] Браузер закрыт, будет переоткрыт при следующей попытке`, 'WARN');
    }
    log(`[Mechanic] Ошибка ${waybillNumber}: ${err.message}`, 'ERROR');
  } finally {
    if (!parallel) {
      s.lastEplId = null;
      s.isProcessing = false;
    }
  }
}

const FETCH_TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS, 10) || 30000;

let tickInProgress = false;

async function fetchPending() {
  const url = `${API_URL}/api/clinic/pending-creation?since=${encodeURIComponent(PROGRAM_STARTED_AT)}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) return null;
  const data = await res.json();
  return data.items || [];
}

/** Возвращает массив вкладок для параллельной обработки: [mainPage, ...extraPages]. Лишние вкладки нужно закрыть после использования. */
async function getPagesForParallel(role, count) {
  const s = roleState[role];
  if (!s.context || count < 1) return [];
  const pages = [s.page].filter(Boolean);
  if (pages.length === 0 || isBrowserClosed(s.context, pages[0])) return [];
  for (let i = pages.length; i < count; i++) {
    try {
      const p = await s.context.newPage();
      p.setDefaultTimeout(60000);
      pages.push(p);
    } catch (e) {
      log(`[${role}] Новая вкладка: ${e.message}`, 'WARN');
      break;
    }
  }
  return pages;
}

async function tick() {
  if (tickInProgress) return;
  tickInProgress = true;
  try {
    // 1) Диспетчер — до MAX_PARALLEL заявок параллельно (по вкладке на заявку)
    let items = await fetchPending();
    if (!items || items.length === 0) return;
    const forD = items.filter(suitableForDispatcher).slice(0, MAX_PARALLEL);
    if (forD.length > 0) {
      const role = 'dispatcher';
      const s = roleState[role];
      const pages = await getPagesForParallel(role, forD.length);
      const toClose = pages.slice(1);
      if (pages.length > 0) {
        log(`Заявок: ${items.length}, диспетчер обрабатывает параллельно: ${forD.map((x) => x.waybillNumber).join(', ')}`);
        const results = await Promise.allSettled(forD.slice(0, pages.length).map((item, i) => runDispatcher(item, pages[i])));
        results.forEach((r, i) => {
          if (r.status === 'rejected') log(`[Dispatcher] ${forD[i]?.waybillNumber}: ${r.reason?.message}`, 'ERROR');
        });
      }
      for (const p of toClose) {
        try { await p.close(); } catch (_) {}
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    // 2) Медик — до MAX_PARALLEL заявок параллельно
    items = await fetchPending();
    if (!items || items.length === 0) return;
    const forM = items.filter(suitableForMedic).slice(0, MAX_PARALLEL);
    if (forM.length > 0) {
      const role = 'medic';
      const pages = await getPagesForParallel(role, forM.length);
      const toClose = pages.slice(1);
      if (pages.length > 0) {
        log(`Заявок: ${items.length}, медик обрабатывает параллельно: ${forM.map((x) => x.waybillNumber).join(', ')}`);
        const results = await Promise.allSettled(forM.slice(0, pages.length).map((item, i) => runMedic(item, pages[i])));
        results.forEach((r, i) => {
          if (r.status === 'rejected') log(`[Medic] ${forM[i]?.waybillNumber}: ${r.reason?.message}`, 'ERROR');
        });
      }
      for (const p of toClose) {
        try { await p.close(); } catch (_) {}
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    // 3) Механик — до MAX_PARALLEL заявок параллельно
    items = await fetchPending();
    if (!items || items.length === 0) return;
    const forMech = items.filter(suitableForMechanic).slice(0, MAX_PARALLEL);
    if (forMech.length > 0) {
      const role = 'mechanic';
      const pages = await getPagesForParallel(role, forMech.length);
      const toClose = pages.slice(1);
      if (pages.length > 0) {
        log(`Заявок: ${items.length}, механик обрабатывает параллельно: ${forMech.map((x) => x.waybillNumber).join(', ')}`);
        const results = await Promise.allSettled(forMech.slice(0, pages.length).map((item, i) => runMechanic(item, pages[i])));
        results.forEach((r, i) => {
          if (r.status === 'rejected') log(`[Mechanic] ${forMech[i]?.waybillNumber}: ${r.reason?.message}`, 'ERROR');
        });
      }
      for (const p of toClose) {
        try { await p.close(); } catch (_) {}
      }
    } else if (forD.length === 0 && forM.length === 0) {
      log(`Заявок: ${items.length} (дисп.: 0, медик: 0, механик: 0 — ждём по цепочке титулов)`);
    }
  } catch (e) {
    const isTimeout = e.name === 'AbortError' || e.message.includes('aborted') || e.message.includes('timeout');
    if (isTimeout) {
      log(`Запрос к API превысил ${FETCH_TIMEOUT_MS / 1000} с (таймаут). Следующий тик через ${POLL_SECONDS} с.`, 'WARN');
    } else {
      log(`Ошибка tick: ${e.message}`, 'ERROR');
    }
  } finally {
    tickInProgress = false;
  }
}

async function main() {
  log(`Универсальный воркер. Опрос каждые ${POLL_SECONDS} с. API: ${API_URL}. Параллельно до ${MAX_PARALLEL} ЭПЛ на роль. Остановка: Ctrl+C.`);
  log(`Пока скрипт запущен — заявки обрабатываются 24/7 (следующий тик через ${POLL_SECONDS} с после окончания предыдущего).`);

  await Promise.all([
    initRole('dispatcher'),
    initRole('medic'),
    initRole('mechanic')
  ]);

  setInterval(() => {
    const uptime = Math.floor(process.uptime() / 60);
    log(`💓 Heartbeat: uptime ${uptime} мин`);
  }, 5 * 60 * 1000);

  if (ONCE) {
    await tick();
    process.exit(0);
    return;
  }

  // Опрос по кругу: следующий тик через POLL_SECONDS после *окончания* предыдущего (без наложения)
  async function loop() {
    for (;;) {
      await tick().catch((e) => log(`tick: ${e.message}`, 'ERROR'));
      await new Promise((r) => setTimeout(r, INTERVAL_MS));
    }
  }
  loop();
}

process.on('SIGINT', () => { log('SIGINT, выход'); process.exit(0); });
process.on('SIGTERM', () => { log('SIGTERM, выход'); process.exit(0); });

main().catch((e) => {
  log(`Критическая ошибка: ${e.message}`, 'ERROR');
  process.exit(1);
});
