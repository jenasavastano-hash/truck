/**
 * Программа на ПК клиники: одна точка входа.
 * 1) Заявки на создание ЭПЛ (pending_clinic) — опрос, отчёт epl-created (заглушка или позже Playwright).
 * 2) Титулы на подпись — опрос, подпись КриптоПро, отправка подписи.
 *
 * Режимы:
 *   node sign.js       — фон, опрос каждые N сек
 *   node sign.js --once — один проход и выход
 *
 * .env: API_URL, SIGNER_API_KEY, POLL_SECONDS (по умолчанию 20), SIGNER_CMD (опционально).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

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
const SIGNER_CMD = (process.env.SIGNER_CMD || '').trim();
const ONCE = process.argv.includes('--once');
/** Пробег на закрытие ЭПЛ: если бэкенд не присылает endOdometer, берём начальный + это значение (км). По умолчанию 100. */
const EPL_ODOMETER_ADD_KM = parseInt(process.env.EPL_ODOMETER_ADD_KM, 10) || 100;

if (!SIGNER_API_KEY) {
  console.error('Ошибка: в .env не задан SIGNER_API_KEY.');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${SIGNER_API_KEY}`,
  'Content-Type': 'application/json'
};

/** Время запуска программы — обрабатываем только ЭПЛ, созданные после этого (не старые заявки до запуска). Формат SQLite: YYYY-MM-DD HH:MM:SS */
const PROGRAM_STARTED_AT = new Date().toISOString().replace('T', ' ').slice(0, 19);

let lastProcessedEplId = null;
let lastProcessedTime = 0;
// Очередь: заявки обрабатываются по одной; пока идёт создание/подпись одного ЭПЛ, следующая не начинается. На следующем тике (через INTERVAL_MS) подхватится следующая заявка.
let isProcessing = false; // Флаг: идёт ли сейчас обработка заявки (блокирует опрос API)
let hasError = false; // Флаг: произошла ли ошибка (останавливает обработку)
// Переиспользование браузера signer между ЭПЛ
let signerContext = null;
let signerPage = null;

function signWithExternalCommand(dataToSign, signerRole) {
  const tmpFile = path.join(os.tmpdir(), `epl-sign-${process.pid}-${Date.now()}.txt`);
  try {
    fs.writeFileSync(tmpFile, dataToSign, 'utf8');
    const out = execFileSync(SIGNER_CMD, [tmpFile, signerRole], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, env: process.env });
    return (out || '').trim();
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
}

async function signWithCryptoPro(dataToSign, signerRole) {
  if (SIGNER_CMD) return signWithExternalCommand(dataToSign, signerRole);
  return null;
}

// ---- Заявки на создание ЭПЛ: создание и подпись в Такском через Playwright ----
async function processPendingCreation() {
  // Если произошла ошибка, останавливаем обработку
  if (hasError) {
    console.error('[ЭПЛ] ⛔ ОШИБКА ОБРАБОТКИ! Программа остановлена. Исправь ошибку и перезапусти программу.');
    return;
  }
  
  // Если уже обрабатываем заявку, не опрашиваем API (особенно важно в режиме отладки)
  if (isProcessing) {
    if (process.env.DEBUG_STEP_BY_STEP === '1' || process.env.DEBUG_STEP_BY_STEP === 'true') {
      // В режиме отладки не логируем каждый раз, чтобы не спамить
    }
    return;
  }
  
  try {
    const url = `${API_URL}/api/clinic/pending-creation?since=${encodeURIComponent(PROGRAM_STARTED_AT)}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      isProcessing = false;
      return;
    }
    const { items } = await res.json();
    if (!items || items.length === 0) {
      isProcessing = false;
      return;
    }
    
    // Флаг isProcessing будет установлен внутри блока обработки заявки

    let createInTaxcom = null;
    try {
      const taxcomModule = require('./taxcom-create.js');
      createInTaxcom = taxcomModule.createEplInTaxcom;
      // Проверяем, что playwright-core доступен
      const playwright = taxcomModule.getPlaywright();
      if (!playwright) {
        console.warn('[ЭПЛ] playwright-core не может быть загружен. Проверь установку: npm install playwright-core');
        createInTaxcom = null;
      }
    } catch (err) {
      console.warn('[ЭПЛ] Ошибка загрузки taxcom-create.js:', err.message);
      createInTaxcom = null;
    }

    // Обрабатываем все заявки по очереди (одна за другой — браузер/КриптоПро один на ПК)
    for (const item of items) {
      const { eplId, waybillNumber, driver, startOdometer, createdAt, titulStatus } = item;
      try {
      // Не трогаем ЭПЛ, у которого уже все Т1–Т4 подписаны (путевой готов, только QR/PDF на сайт — это qr-fetcher)
      const ts = titulStatus || {};
      if (ts.t1 === 'signed' && ts.t2 === 'signed' && ts.t3 === 'signed' && ts.t4 === 'signed') {
        console.log(`[ЭПЛ] Пропускаю ${waybillNumber} (eplId=${eplId}) — все титулы Т1–Т4 уже подписаны. QR/PDF подтянет qr-fetcher.`);
        continue;
      }

      // Проверяем, что заявка создана после запуска программы
      // SQLite CURRENT_TIMESTAMP = UTC, поэтому парсим как UTC
      if (createdAt && PROGRAM_STARTED_AT) {
        const cStr = String(createdAt).trim();
        const itemDate = new Date(/[TZ+]/.test(cStr) ? cStr : cStr.replace(' ', 'T') + 'Z');
        const pStr = String(PROGRAM_STARTED_AT).trim();
        const programStartDate = new Date(/[TZ+]/.test(pStr) ? pStr : pStr.replace(' ', 'T') + 'Z');
        if (itemDate < programStartDate) {
          console.log(`[ЭПЛ] Пропускаю заявку ${waybillNumber} (eplId=${eplId}) — создана до запуска программы (${createdAt} < ${PROGRAM_STARTED_AT})`);
          continue;
        }
      }
      
      const now = Date.now();
      if (lastProcessedEplId === eplId && (now - lastProcessedTime) < 60000) {
        console.log(`[ЭПЛ] Пропускаю заявку ${waybillNumber} (eplId=${eplId}) — уже обрабатывалась ${Math.round((now - lastProcessedTime) / 1000)} сек назад. Подожду минуту.`);
        continue;
      }
      
      // Устанавливаем флаг обработки СРАЗУ, до любых других операций
      isProcessing = true;
      lastProcessedEplId = eplId;
      lastProcessedTime = now;
      console.log(`[ЭПЛ] Поймал заявку: ${waybillNumber}, водитель: ${driver?.fullName || '—'}, пробег: ${startOdometer ?? '—'}`);
      const staffCreds = item.staff || {};
      const parkDispLogin = staffCreds.dispatcher?.taxcomLogin || '';
      const parkDispPass = staffCreds.dispatcher?.taxcomPassword || '';
      const parkMedicLogin = staffCreds.medic?.taxcomLogin || '';
      const parkMedicPass = staffCreds.medic?.taxcomPassword || '';
      const parkMechLogin = (staffCreds.technic || staffCreds.mechanic)?.taxcomLogin || '';
      const parkMechPass = (staffCreds.technic || staffCreds.mechanic)?.taxcomPassword || '';

      const hasDispatcher = !!(parkDispLogin || process.env.TAKSKOM_DISPATCHER_PHONE);

      if (!createInTaxcom || !hasDispatcher) {
        if (!createInTaxcom) {
          console.warn('[ЭПЛ] Playwright не подключён (npm install playwright-core в signer-client). Заявка остаётся в ожидании.');
        } else {
          console.warn('[ЭПЛ] Не заданы логин/пароль диспетчера ни в настройках парка, ни в .env. Заявка остаётся в ожидании.');
        }
        isProcessing = false;
        return;
      }

      const effectiveEnv = {
        ...process.env,
        ...(parkDispLogin ? { TAKSKOM_DISPATCHER_PHONE: parkDispLogin } : {}),
        ...(parkDispPass ? { TAKSKOM_DISPATCHER_PASSWORD: parkDispPass } : {}),
        ...(parkMedicLogin ? { TAKSKOM_MEDIC_PHONE: parkMedicLogin } : {}),
        ...(parkMedicPass ? { TAKSKOM_MEDIC_PASSWORD: parkMedicPass } : {}),
        ...(parkMechLogin ? { TAKSKOM_MECHANIC_PHONE: parkMechLogin } : {}),
        ...(parkMechPass ? { TAKSKOM_MECHANIC_PASSWORD: parkMechPass } : {}),
      };

      const reuseArg = (signerContext && signerPage) ? { context: signerContext, page: signerPage } : undefined;
      const reportTitulProgress = async (eplId, titul, status, mintransIdVal) => {
        try {
          const res = await fetch(`${API_URL}/api/clinic/titul-progress`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ eplId, titul, status, mintransId: mintransIdVal })
          });
          if (!res.ok) console.warn('[ЭПЛ] titul-progress:', res.status, await res.text());
        } catch (e) { console.warn('[ЭПЛ] titul-progress:', e.message); }
      };
      const hasResume = item.mintransId && item.titulStatus;
      if (hasResume) console.log(`[ЭПЛ] Продолжение с места остановки: mintransId=${item.mintransId}, титулы:`, item.titulStatus);
      console.log(`[ЭПЛ] Запускаю создание в Такском (Playwright)${reuseArg ? ' [переиспользую браузер]' : ''}: логин → форма → заполнение → сохранение.`);
      let mintransId = null;
      let eplGuid = null;
      let creationResult = null;
      const t0 = Date.now();
      {
        creationResult = await createInTaxcom(item, effectiveEnv, reuseArg, reportTitulProgress);
        const result = creationResult;
        const id = result && result.mintransId ? String(result.mintransId) : '';
        const isFakeId = id.startsWith('stub-') || id.startsWith('taxcom-');
        if (result && id && !isFakeId) {
          mintransId = result.mintransId;
          eplGuid = result.eplGuid || null;
          const ms = Date.now() - t0;
          console.log(`[ЭПЛ] Создан в Такском, mintransId: ${mintransId} (${Math.round(ms / 1000)} с)`);
          if (result.context && result.page) {
            signerContext = result.context;
            signerPage = result.page;
          }
        } else if (result && id) {
          signerContext = null;
          signerPage = null;
          console.warn(`[ЭПЛ] Реальный ID из Такском не получен (${id}). Заявка ${waybillNumber} остаётся в ожидании, перехожу к следующей.`);
          isProcessing = false;
          lastProcessedEplId = null;
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        } else {
          signerContext = null;
          signerPage = null;
          console.warn(`[ЭПЛ] Playwright не вернул ID для ${waybillNumber}. Заявка остаётся в ожидании, перехожу к следующей.`);
          isProcessing = false;
          lastProcessedEplId = null;
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
      }

      const qrCode = creationResult.qrCode || undefined;
      const documentPdf = creationResult.documentPdf || undefined;
      const eplAlreadySent = creationResult.eplAlreadySent === true;
      if (eplAlreadySent) {
        console.log(`[ЭПЛ] PDF и QR уже отправлены механиком на сайт (epl-created + epl/qr).`);
      } else {
        console.log(`[ЭПЛ] Отправляю epl-created: eplId=${eplId}, mintransId=${mintransId}${qrCode ? ', с QR' : ''}${documentPdf ? ', с PDF' : ''}`);
        try {
          const eplCreatedRes = await fetch(`${API_URL}/api/clinic/epl-created`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ eplId, mintransId, eplGuid, qrCode, documentPdf })
          });
          if (eplCreatedRes.ok) {
            const resData = await eplCreatedRes.json().catch(() => ({}));
            console.log(`[ЭПЛ] Отчёт отправлен успешно. Бэкенд обновил статус ЭПЛ. Ответ:`, JSON.stringify(resData));
          } else {
            const errText = await eplCreatedRes.text().catch(() => '');
            console.error(`[ЭПЛ] Ошибка отправки epl-created: ${eplCreatedRes.status} ${eplCreatedRes.statusText}. Ответ: ${errText}`);
            console.error(`[ЭПЛ] Заявка останется в pending_clinic и будет обрабатываться снова.`);
            lastProcessedEplId = null;
            lastProcessedTime = 0;
          }
        } catch (fetchErr) {
          console.error(`[ЭПЛ] Ошибка сети при отправке epl-created:`, fetchErr.message);
          console.error(`[ЭПЛ] Заявка останется в pending_clinic и будет обрабатываться снова.`);
          lastProcessedEplId = null;
          lastProcessedTime = 0;
        }
      }

      // Браузер переиспользуется между ЭПЛ (signerContext/signerPage уже обновлены выше)

      // Сбрасываем блокировку после успешной обработки и переходим к следующей заявке
      lastProcessedEplId = null;
      lastProcessedTime = 0;
      isProcessing = false;
      
      // Пауза перед следующей заявкой
      await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (itemErr) {
        // Ошибка по одной заявке — сбрасываем браузер, переходим к следующей
        signerContext = null;
        signerPage = null;
        console.error(`[ЭПЛ] ⛔ Ошибка по заявке ${waybillNumber} (eplId=${eplId}):`, itemErr.message);
        console.error('[ЭПЛ] Заявка остаётся в pending_clinic. Переход к следующей через 3 с.');
        lastProcessedEplId = null;
        lastProcessedTime = 0;
        isProcessing = false;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    isProcessing = false;
  } catch (e) {
    console.error('[ЭПЛ] ⛔ Критическая ошибка (сеть/API):', e.message);
    const isBrowserClosed = /closed|launch|Target page|browser has been closed/i.test(String(e.message));
    if (isBrowserClosed) {
      console.log('[ЭПЛ] Подсказка: закрой браузер (Chromium/Яндекс) вручную или установи TAXCOM_KEEP_BROWSER_OPEN=0 — тогда следующий ЭПЛ сможет запустить браузер.');
      hasError = false;
    } else {
      hasError = true;
    }
    isProcessing = false;
  } finally {
    // Гарантируем сброс флага только если нет ошибки
    if (!hasError) {
      isProcessing = false;
    }
  }
}


// ---- Завершение ЭПЛ (Т5/Т6) через Playwright ----
async function processPendingCompletion() {
  if (hasError || isProcessing) {
    return;
  }

  // ВРЕМЕННО ОТКЛЮЧЕНО: Т5/Т6 не трогаем (закрытие рейса только вручную или отдельным джобом).
  // Включить автоматическое заполнение/подпись Т5/Т6 можно установив ENABLE_T5_T6_COMPLETION=1 в .env
  if (process.env.ENABLE_T5_T6_COMPLETION !== '1') {
    return;
  }

  try {
    const url = `${API_URL}/api/clinic/pending-completion?since=${encodeURIComponent(PROGRAM_STARTED_AT)}`;
    const res = await fetch(url, { headers });
    if (!res.ok) return;
    const { items } = await res.json();
    if (!items || items.length === 0) return;

    let completeInTaxcom = null;
    try {
      const taxcomModule = require('./taxcom-create.js');
      completeInTaxcom = taxcomModule.completeEplInTaxcom;
      const playwright = taxcomModule.getPlaywright();
      if (!playwright) {
        console.warn('[ЭПЛ] playwright-core не может быть загружен для завершения. Проверь установку: npm install playwright-core');
        completeInTaxcom = null;
      }
    } catch (err) {
      console.warn('[ЭПЛ] Ошибка загрузки taxcom-create.js для завершения:', err.message);
      completeInTaxcom = null;
    }

    if (!completeInTaxcom) {
      return;
    }

    for (const item of items) {
      const { eplId, waybillNumber, mintransId, driver, staff } = item;
      // Пробег на закрытие: если не передан — начальный + EPL_ODOMETER_ADD_KM (+100 км по умолчанию)
      const startKm = item.startOdometer != null ? Number(item.startOdometer) : null;
      const endOdometer = item.endOdometer ?? (startKm != null ? startKm + EPL_ODOMETER_ADD_KM : null);
      const completionItem = endOdometer != null ? { ...item, endOdometer } : item;
      
      if (!mintransId || endOdometer == null) {
        continue;
      }

      const now = Date.now();
      if (lastProcessedEplId === eplId && (now - lastProcessedTime) < 60000) {
        continue;
      }

      isProcessing = true;
      lastProcessedEplId = eplId;
      lastProcessedTime = now;
      if (item.endOdometer == null && startKm != null) {
        console.log(`[ЭПЛ] Пробег на закрытие не задан — подставляю начальный + ${EPL_ODOMETER_ADD_KM} км: ${startKm} → ${endOdometer}`);
      }
      console.log(`[ЭПЛ] Завершаю рейс: ${waybillNumber}, mintransId: ${mintransId}, пробег: ${endOdometer}`);

      try {
        const success = await completeInTaxcom(completionItem, process.env);
        await fetch(`${API_URL}/api/clinic/epl-completed`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ eplId, success: !!success })
        });
        if (success) {
          console.log(`[ЭПЛ] ✅ Рейс завершён: ${waybillNumber} (Т5/Т6 подписаны)`);
        } else {
          console.warn(`[ЭПЛ] ⚠ Завершение не удалось: ${waybillNumber}`);
        }
      } catch (err) {
        console.error(`[ЭПЛ] ⛔ Ошибка завершения ${waybillNumber}:`, err.message);
        await fetch(`${API_URL}/api/clinic/epl-completed`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ eplId, success: false })
        });
      }

      lastProcessedEplId = null;
      lastProcessedTime = 0;
      isProcessing = false;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } catch (e) {
    console.error('[ЭПЛ] Ошибка обработки завершения:', e.message);
    isProcessing = false;
  }
}

// ---- Подпись титулов (внешняя команда SIGNER_CMD; при создании ЭПЛ через Playwright подпись в браузере, этот блок не используется) ----
async function processSigning() {
  if (!SIGNER_CMD) return;
  try {
    const res = await fetch(`${API_URL}/api/signer/pending`, { headers });
    if (!res.ok) return;
    const { epls } = await res.json();
    if (!epls || epls.length === 0) return;
    for (const epl of epls) {
      for (const t of epl.titles) {
        try {
          const signature = await signWithExternalCommand(t.dataToSign, t.signerRole);
          await fetch(`${API_URL}/api/signer/title/${t.id}/sign`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ signature })
          });
          console.log(`[Подпись] ${epl.waybillNumber} ${t.titleCode}`);
        } catch (err) {
          console.error(`[Подпись] ${t.titleCode}:`, err.message);
        }
      }
    }
  } catch (e) {
    console.error('[Подпись] Ошибка:', e.message);
  }
}

async function tick() {
  // Если произошла ошибка, не обрабатываем ничего
  if (hasError) {
    return;
  }
  
  // Если уже обрабатываем заявку, пропускаем этот тик (особенно важно в режиме отладки)
  if (isProcessing) {
    return;
  }
  await processPendingCreation();
  await processPendingCompletion();
  await processSigning();
}

function main() {
  const sec = Math.round(INTERVAL_MS / 1000);
  console.log(`ПК клиники: опрос каждые ${sec} с. API: ${API_URL}. Остановка: Ctrl+C.`);
  console.log(`[ЭПЛ] Время запуска программы: ${PROGRAM_STARTED_AT}`);
  console.log(`[ЭПЛ] Будут обрабатываться только ЭПЛ, созданные после этого времени.`);
  const dispPhone = process.env.TAKSKOM_DISPATCHER_PHONE || process.env.TAKSKOM_LOGIN_PHONE || '';
  const dispPass = process.env.TAKSKOM_DISPATCHER_PASSWORD || process.env.TAKSKOM_LOGIN_PASSWORD || '';
  if (dispPhone && dispPass) {
    console.log(`[ЭПЛ] Taxcom: логин задан, браузер будет переиспользоваться между ЭПЛ.`);
  } else {
    console.warn(`[ЭПЛ] Taxcom: TAKSKOM_DISPATCHER_PHONE/PASSWORD не заданы — создание ЭПЛ недоступно.`);
  }
  if (ONCE) {
    tick().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
    return;
  }
  tick().catch((e) => console.error(e));
  setInterval(() => tick().catch((e) => console.error(e)), INTERVAL_MS);

  // Воркер QR выключен по умолчанию: PDF и QR забирает механик после Т4. Включить: ENABLE_QR_FETCHER=1
  if (process.env.ENABLE_QR_FETCHER === '1') {
    try {
      const { spawn } = require('child_process');
      const qrPath = path.join(__dirname, 'qr-fetcher.js');
      const qrProc = spawn(process.execPath, [qrPath], { stdio: 'inherit', env: process.env, cwd: __dirname, shell: false });
      qrProc.on('error', (e) => console.warn('[ЭПЛ] QR-фетчер ошибка:', e.message));
      qrProc.on('exit', (code) => { if (code !== 0 && code !== null) console.warn('[ЭПЛ] QR-фетчер завершился с кодом', code); });
      console.log('[ЭПЛ] QR-фетчер запущен (ENABLE_QR_FETCHER=1).');
    } catch (e) {
      console.warn('[ЭПЛ] QR-фетчер не запущен:', e.message);
    }
  } else {
    console.log('[ЭПЛ] QR-фетчер выключен. PDF и QR забирает механик после подписания Т4.');
  }
}

main();
