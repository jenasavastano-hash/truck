/**
 * Воркер механика: только заполнение и подпись Т3 и Т4.
 * Опрашивает pending-creation, берёт заявки с подписанными Т1 и Т2, без подписанных Т3/Т4.
 * Запуск: node mechanic-worker.js   или   node mechanic-worker.js --once
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
const POLL_SECONDS = parseInt(process.env.MECHANIC_POLL_SECONDS || process.env.POLL_SECONDS, 10) || 10;
const INTERVAL_MS = POLL_SECONDS * 1000;
const ONCE = process.argv.includes('--once');

if (!SIGNER_API_KEY) {
  console.error('[Mechanic] В .env не задан SIGNER_API_KEY.');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${SIGNER_API_KEY}`, 'Content-Type': 'application/json' };
const PROGRAM_STARTED_AT = new Date().toISOString().replace('T', ' ').slice(0, 19);
let lastProcessedEplId = null;
let lastProcessedTime = 0;
let isProcessing = false;
let signerContext = null;
let signerPage = null;

function suitableForMechanic(item) {
  if (!item.mintransId) return false;
  const ts = item.titulStatus || {};
  if (ts.t1 !== 'signed' || ts.t2 !== 'signed') return false;
  return ts.t3 !== 'signed' || ts.t4 !== 'signed';
}

async function tick() {
  if (isProcessing) return;

  try {
    const url = `${API_URL}/api/clinic/pending-creation?since=${encodeURIComponent(PROGRAM_STARTED_AT)}`;
    let res;
    try {
      res = await fetch(url, { headers });
    } catch (fetchErr) {
      console.warn('[Mechanic] Ошибка запроса к API:', fetchErr.message);
      return;
    }
    if (!res.ok) {
      console.warn(`[Mechanic] API вернул ${res.status}: ${await res.text().catch(() => '')}`);
      return;
    }
    const { items } = await res.json();
    if (!items || items.length === 0) return;

    const forMechanic = items.filter(suitableForMechanic);
    if (forMechanic.length === 0) {
      const withMintrans = items.filter(i => i.mintransId);
      if (withMintrans.length > 0) {
        const first = withMintrans[0];
        const ts = first.titulStatus || {};
        // Ждём медика: Т2 ещё не подписан (Т1 уже filled/signed — заявка в работе у диспетчера/медика)
        if ((ts.t1 === 'signed' || ts.t1 === 'filled') && ts.t2 !== 'signed') return;
        console.log(`[Mechanic] Нет заявок для Т3/Т4. Пример: ${first.waybillNumber} t1=${ts.t1} t2=${ts.t2}.`);
      }
      return;
    }

    let fillAndSignT3T4Only = null;
    try {
      const taxcom = require('./taxcom-create.js');
      fillAndSignT3T4Only = taxcom.fillAndSignT3T4Only;
      if (!taxcom.getPlaywright()) fillAndSignT3T4Only = null;
    } catch (e) {
      console.warn('[Mechanic] Ошибка загрузки taxcom-create:', e.message);
    }
    if (!fillAndSignT3T4Only || !process.env.TAKSKOM_MECHANIC_PHONE) {
      if (!fillAndSignT3T4Only) console.warn('[Mechanic] Playwright не подключён.');
      else console.warn('[Mechanic] TAKSKOM_MECHANIC_PHONE/PASSWORD не заданы.');
      return;
    }

    const item = forMechanic[0];
    const { eplId, waybillNumber } = item;
    const now = Date.now();
    // Уменьшаем время блокировки и сбрасываем, если прошло больше 5 минут
    if (lastProcessedEplId === eplId && (now - lastProcessedTime) < 30000 && (now - lastProcessedTime) < 300000) {
      console.log(`[Mechanic] Пропускаю ${waybillNumber} (обрабатывался ${Math.round((now - lastProcessedTime) / 1000)}с назад)`);
      return;
    }
    if (lastProcessedEplId === eplId && (now - lastProcessedTime) >= 300000) {
      console.log(`[Mechanic] Сбрасываю блокировку для ${waybillNumber} (прошло ${Math.round((now - lastProcessedTime) / 60000)} мин)`);
      lastProcessedEplId = null;
    }

    isProcessing = true;
    lastProcessedEplId = eplId;
    lastProcessedTime = now;
    console.log(`[Mechanic] Заявка для Т3/Т4: ${waybillNumber}, mintransId: ${item.mintransId} (в очереди ещё ${forMechanic.length - 1})`);

    const reportTitulProgress = async (eplIdVal, titul, status, mintransIdVal) => {
      try {
        await fetch(`${API_URL}/api/clinic/titul-progress`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ eplId: eplIdVal, titul, status, mintransId: mintransIdVal })
        });
      } catch (e) { console.warn('[Mechanic] titul-progress:', e.message); }
    };

    const reuse = (signerContext && signerPage) ? { context: signerContext, page: signerPage } : undefined;
    let result = null;
    try {
      result = await fillAndSignT3T4Only(item, process.env, reuse, reportTitulProgress);
    } catch (err) {
      console.error(`[Mechanic] Ошибка обработки ${waybillNumber}:`, err.message);
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
      console.log('[Mechanic] Т3 и Т4 подписаны.');
      if (result.documentPdf || result.qrCode) {
        try {
          const eplRes = await fetch(`${API_URL}/api/clinic/epl-created`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              eplId: item.eplId,
              mintransId: result.mintransId,
              documentPdf: result.documentPdf || null,
              qrCode: result.qrCode || null
            })
          });
          if (eplRes.ok) {
            console.log('[Mechanic] PDF/QR отправлены на сайт.');
          } else {
            console.warn('[Mechanic] epl-created (документ):', eplRes.status, await eplRes.text());
          }
        } catch (e) {
          console.error('[Mechanic] Ошибка отправки PDF/QR:', e.message);
        }
      }
    } else {
      signerContext = null;
      signerPage = null;
      console.warn('[Mechanic] Т3/Т4 не подписаны, заявка остаётся в очереди.');
    }

    lastProcessedEplId = null;
    isProcessing = false;
    await new Promise(r => setTimeout(r, 2000));
  } catch (e) {
    console.error('[Mechanic] Критическая ошибка:', e.message);
    isProcessing = false;
  }
}

async function main() {
  const sec = Math.round(INTERVAL_MS / 1000);
  console.log(`[Mechanic] Воркер механика. Опрос каждые ${sec} с. API: ${API_URL}. Остановка: Ctrl+C.`);
  console.log('[Mechanic] Обрабатываю заявки с подписанными Т1 и Т2, без Т3/Т4.');
  const taxcom = require('./taxcom-create.js');
  const opened = await taxcom.openBrowserAndLoginForRole(process.env, 'mechanic');
  if (opened) {
    signerContext = opened.context;
    signerPage = opened.page;
    console.log('[Mechanic] Браузер открыт, логин выполнен.');
  } else {
    console.warn('[Mechanic] Браузер не открыт — при первой заявке откроется сам.');
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
