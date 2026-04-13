/**
 * Воркер медика: только заполнение и подпись Т2.
 * Опрашивает pending-creation, берёт заявки с mintransId и подписанным Т1, без подписанного Т2.
 * Запуск: node medic-worker.js   или   node medic-worker.js --once
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

const API_URL = (process.env.API_URL || 'http://localhost:5000').replace(/\/$/, '');
const SIGNER_API_KEY = process.env.SIGNER_API_KEY || '';
const POLL_SECONDS = parseInt(process.env.POLL_SECONDS, 10) || 20;
const POLL_MINUTES = Math.max(1, parseInt(process.env.POLL_MINUTES, 10) || 5);
const INTERVAL_MS = process.env.POLL_SECONDS ? POLL_SECONDS * 1000 : POLL_MINUTES * 60 * 1000;
const ONCE = process.argv.includes('--once');

if (!SIGNER_API_KEY) {
  console.error('[Medic] В .env не задан SIGNER_API_KEY.');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${SIGNER_API_KEY}`, 'Content-Type': 'application/json' };
const PROGRAM_STARTED_AT = new Date().toISOString().replace('T', ' ').slice(0, 19);
let lastProcessedEplId = null;
let lastProcessedTime = 0;
let isProcessing = false;
let signerContext = null;
let signerPage = null;

function suitableForMedic(item) {
  if (!item.mintransId) return false;
  const ts = item.titulStatus || {};
  return ts.t1 === 'signed' && ts.t2 !== 'signed';
}

async function tick() {
  if (isProcessing) return;

  try {
    const url = `${API_URL}/api/clinic/pending-creation?since=${encodeURIComponent(PROGRAM_STARTED_AT)}`;
    let res;
    try {
      res = await fetch(url, { headers });
    } catch (fetchErr) {
      console.warn('[Medic] Ошибка запроса к API:', fetchErr.message);
      return;
    }
    if (!res.ok) {
      console.warn(`[Medic] API вернул ${res.status}: ${await res.text().catch(() => '')}`);
      return;
    }
    const { items } = await res.json();
    if (!items || items.length === 0) return;

    const forMedic = items.filter(suitableForMedic);
    if (forMedic.length === 0) return;

    let fillAndSignT2Only = null;
    try {
      const taxcom = require('./taxcom-create.js');
      fillAndSignT2Only = taxcom.fillAndSignT2Only;
      if (!taxcom.getPlaywright()) fillAndSignT2Only = null;
    } catch (e) {
      console.warn('[Medic] Ошибка загрузки taxcom-create:', e.message);
    }
    if (!fillAndSignT2Only || !process.env.TAKSKOM_MEDIC_PHONE) {
      if (!fillAndSignT2Only) console.warn('[Medic] Playwright не подключён.');
      else console.warn('[Medic] TAKSKOM_MEDIC_PHONE/PASSWORD не заданы.');
      return;
    }

    const item = forMedic[0];
    const { eplId, waybillNumber } = item;
    const now = Date.now();
    // Уменьшаем время блокировки и сбрасываем, если прошло больше 5 минут
    if (lastProcessedEplId === eplId && (now - lastProcessedTime) < 30000 && (now - lastProcessedTime) < 300000) {
      console.log(`[Medic] Пропускаю ${waybillNumber} (обрабатывался ${Math.round((now - lastProcessedTime) / 1000)}с назад)`);
      return;
    }
    if (lastProcessedEplId === eplId && (now - lastProcessedTime) >= 300000) {
      console.log(`[Medic] Сбрасываю блокировку для ${waybillNumber} (прошло ${Math.round((now - lastProcessedTime) / 60000)} мин)`);
      lastProcessedEplId = null;
    }

    isProcessing = true;
    lastProcessedEplId = eplId;
    lastProcessedTime = now;
    console.log(`[Medic] Заявка: ${waybillNumber}, mintransId: ${item.mintransId}`);

    const reportTitulProgress = async (eplIdVal, titul, status, mintransIdVal) => {
      try {
        await fetch(`${API_URL}/api/clinic/titul-progress`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ eplId: eplIdVal, titul, status, mintransId: mintransIdVal })
        });
      } catch (e) { console.warn('[Medic] titul-progress:', e.message); }
    };

    const reuse = (signerContext && signerPage) ? { context: signerContext, page: signerPage } : undefined;
    let result = null;
    try {
      result = await fillAndSignT2Only(item, process.env, reuse, reportTitulProgress);
    } catch (err) {
      console.error(`[Medic] Ошибка обработки ${waybillNumber}:`, err.message);
      signerContext = null;
      signerPage = null;
      // Сбрасываем блокировку при ошибке
      lastProcessedEplId = null;
      isProcessing = false;
      await new Promise(r => setTimeout(r, 5000));
      return;
    }

    if (result && result.mintransId) {
      if (result.context && result.page) {
        signerContext = result.context;
        signerPage = result.page;
      }
      console.log('[Medic] Т2 подписан.');
    } else {
      signerContext = null;
      signerPage = null;
      console.warn('[Medic] Т2 не подписан, заявка остаётся в очереди.');
    }

    lastProcessedEplId = null;
    isProcessing = false;
    await new Promise(r => setTimeout(r, 2000));
  } catch (e) {
    console.error('[Medic] Критическая ошибка:', e.message);
    isProcessing = false;
  }
}

async function main() {
  const sec = Math.round(INTERVAL_MS / 1000);
  console.log(`[Medic] Воркер медика. Опрос каждые ${sec} с. API: ${API_URL}. Остановка: Ctrl+C.`);
  console.log('[Medic] Обрабатываю заявки с mintransId и Т1 подписан, Т2 не подписан.');
  const taxcom = require('./taxcom-create.js');
  const opened = await taxcom.openBrowserAndLoginForRole(process.env, 'medic');
  if (opened) {
    signerContext = opened.context;
    signerPage = opened.page;
    console.log('[Medic] Браузер открыт, логин выполнен.');
  } else {
    console.warn('[Medic] Браузер не открыт — при первой заявке откроется сам.');
  }
  if (ONCE) {
    await tick();
    process.exit(0);
    return;
  }
  tick().catch((e) => console.error(e));
  setInterval(() => tick().catch((e) => console.error(e)), INTERVAL_MS);
}

main().catch((e) => { console.error(e); process.exit(1); });
