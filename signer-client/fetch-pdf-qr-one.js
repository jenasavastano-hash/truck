/**
 * Тестовый скрипт: подтянуть PDF и QR с Такском для одного путевого и вывести в терминал (опционально отправить на бэкенд).
 *
 * Запуск:
 *   node fetch-pdf-qr-one.js <mintransId> [eplId] [--send]
 *
 * Примеры:
 *   node fetch-pdf-qr-one.js 17526223
 *   node fetch-pdf-qr-one.js 17526223 123 --send
 *
 * mintransId — ID путевого в Такском (из URL epl.taxcom.ru/waybill/17526223/).
 * eplId — ID ЭПЛ в нашей БД (нужен только для --send).
 * --send — отправить QR и PDF на бэкенд (POST /api/clinic/epl-created или epl/:id/qr).
 *
 * .env: API_URL, SIGNER_API_KEY, TAKSKOM_DISPATCHER_PHONE, TAKSKOM_DISPATCHER_PASSWORD
 *       и при --send: те же ключи для авторизации.
 */

const fs = require('fs');
const path = require('path');

const appDir = path.dirname(__dirname);
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const m = t.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
}

const API_URL = (process.env.API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_KEY = process.env.SIGNER_API_KEY || process.env.CLINIC_API_KEY || '';
const baseUrl = (process.env.TAKSKOM_URL || 'https://epl.taxcom.ru').replace(/\/$/, '');
const phone = process.env.TAKSKOM_DISPATCHER_PHONE || process.env.TAKSKOM_LOGIN_PHONE || '';
const password = process.env.TAKSKOM_DISPATCHER_PASSWORD || process.env.TAKSKOM_LOGIN_PASSWORD || '';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const doSend = process.argv.includes('--send');
const mintransId = args[0];
const eplId = args[1] ? parseInt(args[1], 10) : null;

if (!mintransId) {
  console.error('Использование: node fetch-pdf-qr-one.js <mintransId> [eplId] [--send]');
  console.error('  mintransId — ID путевого в Такском (из URL waybill/.../).');
  process.exit(1);
}

if (doSend && !eplId) {
  console.error('Для --send укажите eplId: node fetch-pdf-qr-one.js <mintransId> <eplId> --send');
  process.exit(1);
}

if (doSend && !API_KEY) {
  console.error('Для --send в .env нужен SIGNER_API_KEY или CLINIC_API_KEY.');
  process.exit(1);
}

if (!phone || !password) {
  console.error('В .env задайте TAKSKOM_DISPATCHER_PHONE и TAKSKOM_DISPATCHER_PASSWORD.');
  process.exit(1);
}

/** Пытаемся получить QR через API Такском (те же куки). Поддерживается формат из доки: /qr/waybill-number/{id} → data.data.qr.content. */
async function tryFetchQrViaApi(page, baseUrl, mintransId, waybillNumber) {
  if (!page || !page.request) return null;
  const urls = [
    baseUrl + '/qr/waybill-number/' + mintransId,
    baseUrl + '/waybill/' + mintransId + '/data',
    baseUrl + '/api/waybill/' + mintransId,
    baseUrl + '/waybill/' + mintransId + '/qr',
    baseUrl + '/waybill/' + mintransId + '/json'
  ];
  if (waybillNumber) urls.unshift(baseUrl + '/qr/waybill-number/' + encodeURIComponent(waybillNumber));
  for (const url of urls) {
    try {
      const res = await page.request.get(url, { timeout: 10000, headers: { Accept: 'application/json, image/png, image/gif, */*' } });
      if (!res.ok()) continue;
      const ct = (res.headers()['content-type'] || '').toLowerCase();
      const body = await res.body();
      if (ct.includes('application/json') && body && body.length > 0) {
        let data;
        try { data = JSON.parse(body.toString('utf8')); } catch (_) { continue; }
        if (data.status === 'success' && data.data && data.data.qr && data.data.qr.content) {
          const mime = data.data.qr.type || 'image/png';
          return 'data:' + mime + ';base64,' + data.data.qr.content;
        }
        const qr = data.qrCode || data.qr || data.qr_code || data.qrImage || data.image;
        if (qr && typeof qr === 'string') {
          let s = qr.replace(/&gt;/g, '').replace(/>/g, '');
          if (s.startsWith('data:') || s.includes('base64')) return s;
          if (!s.startsWith('http')) return 'data:image/png;base64,' + s;
        }
      }
      if ((ct.includes('image/png') || ct.includes('image/gif')) && body && body.length > 0) {
        const mime = ct.includes('image/gif') ? 'image/gif' : 'image/png';
        return 'data:' + mime + ';base64,' + body.toString('base64');
      }
    } catch (_) {}
  }
  return null;
}

async function extractQrFromPage(page) {
  await new Promise((r) => setTimeout(r, 1500));
  const collapseTrigger = await page.$('[data-bs-target="#qr-collapse-block"]');
  if (collapseTrigger) {
    await collapseTrigger.click().catch(() => {});
    await new Promise((r) => setTimeout(r, 1000));
  } else {
    await page.evaluate(() => {
      const block = document.getElementById('qr-collapse-block');
      if (block) block.classList.add('show');
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1000));
  }
  const qrImgSelector = '#qr-collapse-block img[src*="base64"], #qr-collapse-block img[src*="data:image"], img[alt*="Qr-код" i][src*="base64"], img[alt*="QR" i][src*="data:"]';
  await page.waitForSelector(qrImgSelector, { state: 'visible', timeout: 8000 }).catch(() => null);
  if (!(await page.$(qrImgSelector))) return null;
  return await page.evaluate(() => {
    const block = document.getElementById('qr-collapse-block');
    const img = block ? block.querySelector('img[src*="base64"], img[src*="data:image"]') : document.querySelector('img[alt*="Qr-код" i], img[alt*="QR" i][src*="base64"]');
    if (img && img.src) {
      let src = img.src;
      if (src.includes('&gt;')) src = src.replace(/&gt;/g, '');
      if (src.includes('>')) src = src.replace(/>/g, '');
      if (src.startsWith('data:') || src.includes('base64')) return src;
    }
    const any = document.querySelector('img[src*="base64"]');
    if (any && any.src) {
      let s = any.src;
      if (s.includes('&gt;')) s = s.replace(/&gt;/g, '');
      if (s.includes('>')) s = s.replace(/>/g, '');
      return s;
    }
    return null;
  });
}

async function fetchPdfForWaybill(page, baseUrl, id) {
  try {
    const pdfUrl = `${baseUrl}/waybill/${id}/print/download/pdf`;
    const response = await page.request.get(pdfUrl, { timeout: 30000 });
    if (!response.ok()) return null;
    const body = await response.body();
    if (body && body.length > 0) return body.toString('base64');
  } catch (e) {
    return null;
  }
  return null;
}

async function main() {
  let playwright;
  try {
    playwright = require('playwright-core');
  } catch (e) {
    console.error('Установите playwright-core: npm install playwright-core');
    process.exit(1);
  }

  const userDataDir = (process.env.QR_FETCH_USER_DATA_DIR || '').trim() || path.join(__dirname, 'qr-fetcher-profile');
  const { login } = require('./auth/login');

  console.log(`[fetch-pdf-qr-one] mintransId=${mintransId}${eplId ? ` eplId=${eplId}` : ''}${doSend ? ' (отправка на бэкенд)' : ''}`);
  console.log('[fetch-pdf-qr-one] Запуск браузера...');

  const chromium = playwright.chromium;
  const context = await chromium.launchPersistentContext(userDataDir, { headless: process.env.QR_FETCH_HEADLESS !== '0' });
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(30000);

  try {
    const ok = await login(page, baseUrl, phone, password, process.env);
    if (!ok) {
      console.error('[fetch-pdf-qr-one] Вход в Такском не удался.');
      await context.close().catch(() => {});
      process.exit(1);
    }
    console.log('[fetch-pdf-qr-one] Логин OK. Открываю путевой...');

    await page.goto(`${baseUrl}/waybill/${mintransId}/`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    if ((page.url() || '').toLowerCase().includes('/login')) {
      console.error('[fetch-pdf-qr-one] Редирект на логин — сессия истекла.');
      await context.close().catch(() => {});
      process.exit(1);
    }

    let qrCode = await tryFetchQrViaApi(page, baseUrl, mintransId);
    if (!qrCode) qrCode = await extractQrFromPage(page);
    if (!qrCode) {
      console.warn('[fetch-pdf-qr-one] QR не найден (API + страница), обновляю страницу...');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
      qrCode = await tryFetchQrViaApi(page, baseUrl, mintransId) || await extractQrFromPage(page);
    }

    const documentPdf = await fetchPdfForWaybill(page, baseUrl, mintransId);

    // Вывод в терминал
    console.log('\n========== РЕЗУЛЬТАТ ==========');
    if (qrCode) {
      const preview = qrCode.length > 120 ? qrCode.slice(0, 120) + '...' : qrCode;
      console.log('QR (длина ' + qrCode.length + '):', preview);
    } else {
      console.log('QR: не найден');
    }
    if (documentPdf) {
      const sizeBytes = Math.round((documentPdf.length * 3) / 4);
      console.log('PDF: base64 длина ' + documentPdf.length + ', ~' + Math.round(sizeBytes / 1024) + ' КБ');
    } else {
      console.log('PDF: не получен');
    }
    console.log('================================\n');

    if (doSend && eplId && API_KEY) {
      const headers = { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };
      if (documentPdf || qrCode) {
        const res = await fetch(`${API_URL}/api/clinic/epl-created`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ eplId, mintransId, documentPdf: documentPdf || undefined, qrCode: qrCode || undefined })
        });
        if (res.ok) {
          console.log('[fetch-pdf-qr-one] Отправлено на бэкенд (epl-created):', [documentPdf && 'PDF', qrCode && 'QR'].filter(Boolean).join(' + '));
        } else {
          const text = await res.text();
          console.warn('[fetch-pdf-qr-one] Ответ сервера:', res.status, text);
        }
      } else {
        console.warn('[fetch-pdf-qr-one] Нечего отправлять (нет QR и PDF).');
      }
    }

    await context.close().catch(() => {});
  } catch (e) {
    console.error('[fetch-pdf-qr-one] Ошибка:', e.message);
    await context.close().catch(() => {});
    process.exit(1);
  }
}

main();
