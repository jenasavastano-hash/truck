/**
 * Воркер диспетчера: только создание ЭПЛ и подпись Т1.
 * Опрашивает pending-creation, берёт заявки без mintransId, вызывает createEplT1Only, шлёт epl-created.
 * Запуск: node dispatcher-worker.js   или   node dispatcher-worker.js --once
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
  console.error('[Dispatcher] В .env не задан SIGNER_API_KEY.');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${SIGNER_API_KEY}`,
  'Content-Type': 'application/json'
};

const PROGRAM_STARTED_AT = new Date().toISOString().replace('T', ' ').slice(0, 19);
let lastProcessedEplId = null;
let lastProcessedTime = 0;
let isProcessing = false;
let hasError = false;
let signerContext = null;
let signerPage = null;

async function tick() {
  if (isProcessing) return;
  // Сбрасываем hasError после паузы (если была ошибка, даём время на восстановление)
  if (hasError) {
    console.log('[Dispatcher] Восстановление после ошибки...');
    hasError = false;
  }

  try {
    const url = `${API_URL}/api/clinic/pending-creation?since=${encodeURIComponent(PROGRAM_STARTED_AT)}`;
    let res;
    try {
      res = await fetch(url, { headers });
    } catch (fetchErr) {
      console.warn('[Dispatcher] Ошибка запроса к API:', fetchErr.message);
      return; // Пропускаем этот тик, попробуем в следующий раз
    }
    if (!res.ok) {
      console.warn(`[Dispatcher] API вернул ${res.status}: ${await res.text().catch(() => '')}`);
      return;
    }
    const { items } = await res.json();
    if (!items || items.length === 0) return;

    let createEplT1Only = null;
    try {
      const taxcom = require('./taxcom-create.js');
      createEplT1Only = taxcom.createEplT1Only;
      if (!taxcom.getPlaywright()) createEplT1Only = null;
    } catch (e) {
      console.warn('[Dispatcher] Ошибка загрузки taxcom-create:', e.message);
    }
    if (!createEplT1Only || !process.env.TAKSKOM_DISPATCHER_PHONE) {
      if (!createEplT1Only) console.warn('[Dispatcher] Playwright не подключён.');
      else console.warn('[Dispatcher] TAKSKOM_DISPATCHER_PHONE/PASSWORD не заданы.');
      return;
    }

    for (const item of items) {
      if (item.mintransId) continue; // уже создан ЭПЛ — это для медика/механика
      const { eplId, waybillNumber, driver } = item;
      if (item.createdAt && PROGRAM_STARTED_AT) {
        const cStr = String(item.createdAt).trim();
        const itemDate = new Date(/[TZ+]/.test(cStr) ? cStr : cStr.replace(' ', 'T') + 'Z');
        const pStr = String(PROGRAM_STARTED_AT).trim();
        const programStart = new Date(/[TZ+]/.test(pStr) ? pStr : pStr.replace(' ', 'T') + 'Z');
        if (itemDate < programStart) continue;
      }
      const now = Date.now();
      // Уменьшаем время блокировки с 60 до 30 секунд и сбрасываем, если прошло больше 5 минут
      if (lastProcessedEplId === eplId && (now - lastProcessedTime) < 30000 && (now - lastProcessedTime) < 300000) {
        console.log(`[Dispatcher] Пропускаю ${waybillNumber} (обрабатывался ${Math.round((now - lastProcessedTime) / 1000)}с назад)`);
        continue;
      }
      // Если прошло больше 5 минут, сбрасываем блокировку
      if (lastProcessedEplId === eplId && (now - lastProcessedTime) >= 300000) {
        console.log(`[Dispatcher] Сбрасываю блокировку для ${waybillNumber} (прошло ${Math.round((now - lastProcessedTime) / 60000)} мин)`);
        lastProcessedEplId = null;
      }

      isProcessing = true;
      lastProcessedEplId = eplId;
      lastProcessedTime = now;
      console.log(`[Dispatcher] Заявка: ${waybillNumber}, водитель: ${driver?.fullName || '—'}`);

      const reportTitulProgress = async (eplIdVal, titul, status, mintransIdVal) => {
        try {
          await fetch(`${API_URL}/api/clinic/titul-progress`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ eplId: eplIdVal, titul, status, mintransId: mintransIdVal })
          });
        } catch (e) { console.warn('[Dispatcher] titul-progress:', e.message); }
      };

      const reuse = (signerContext && signerPage) ? { context: signerContext, page: signerPage } : undefined;
      let result = null;
      try {
        result = await createEplT1Only(item, process.env, reuse, reportTitulProgress);
      } catch (err) {
        console.error(`[Dispatcher] Ошибка обработки ${waybillNumber}:`, err.message);
        signerContext = null;
        signerPage = null;
        // Сбрасываем блокировку при ошибке, чтобы можно было повторить
        lastProcessedEplId = null;
        isProcessing = false;
        await new Promise(r => setTimeout(r, 5000)); // Увеличиваем паузу до 5 сек
        return;
      }

      const mintransId = result && result.mintransId ? String(result.mintransId) : '';
      const isFake = mintransId.startsWith('stub-') || mintransId.startsWith('taxcom-');
      if (result && mintransId && !isFake) {
        if (result.context && result.page) {
          signerContext = result.context;
          signerPage = result.page;
        }
        console.log(`[Dispatcher] ЭПЛ создан, mintransId: ${mintransId}`);
        try {
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
          if (eplRes.ok) {
            console.log('[Dispatcher] epl-created отправлен.');
          } else {
            console.warn('[Dispatcher] epl-created:', eplRes.status, await eplRes.text());
          }
        } catch (e) {
          console.error('[Dispatcher] epl-created:', e.message);
        }
      } else {
        signerContext = null;
        signerPage = null;
        console.warn('[Dispatcher] Не получен mintransId, заявка остаётся в очереди.');
      }

      lastProcessedEplId = null;
      isProcessing = false;
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (e) {
    console.error('[Dispatcher] Критическая ошибка:', e.message);
    // Не блокируем навсегда - через несколько тиков попробуем снова
    hasError = true;
    isProcessing = false;
    lastProcessedEplId = null; // Сбрасываем блокировку
    // Автоматически сбросим hasError в следующем тике
  }
}

async function main() {
  const sec = Math.round(INTERVAL_MS / 1000);
  console.log(`[Dispatcher] Воркер диспетчера. Опрос каждые ${sec} с. API: ${API_URL}. Остановка: Ctrl+C.`);
  console.log('[Dispatcher] Обрабатываю только заявки без mintransId (создание ЭПЛ + Т1).');
  const taxcom = require('./taxcom-create.js');
  const opened = await taxcom.openBrowserAndLoginForRole(process.env, 'dispatcher');
  if (opened) {
    signerContext = opened.context;
    signerPage = opened.page;
    console.log('[Dispatcher] Браузер открыт, логин выполнен.');
  } else {
    console.warn('[Dispatcher] Браузер не открыт — при первой заявке откроется сам.');
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
