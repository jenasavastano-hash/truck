/**
 * Воркер QR: обрабатывает очередь ЭПЛ без QR (созданных ≥2 мин).
 * Свой браузер (отдельно от signer), один логин — затем работает в фоне (headless).
 * При первом запуске с QR_FETCH_SHOW_FIRST_LOGIN=1 — показывается окно для логина, потом скрывается.
 * Периодическая проверка сессии и релогин при истечении/долгой неактивности.
 *
 * Запуск: node qr-fetcher.js   (или node qr-fetcher.js --once)
 *
 * .env: API_URL, SIGNER_API_KEY, TAKSKOM_DISPATCHER_PHONE, TAKSKOM_DISPATCHER_PASSWORD
 * Опционально:
 *   QR_FETCH_USER_DATA_DIR — профиль браузера (по умолчанию signer-client/qr-fetcher-profile)
 *   QR_FETCH_SHOW_FIRST_LOGIN=1 — при первом логине показать окно, затем скрыть
 *   QR_FETCH_HEADLESS=1 — всегда невидимый (по умолчанию)
 *   QR_FETCH_SESSION_CHECK_MINUTES=10 — проверка сессии при неактивности
 *   QR_FETCH_VIA_LIST=1 — сперва открывать список ЭПЛ, вкладку «Все ЭПЛ», брать только строки со статусом «QR-код получен», по клику переходить на карточку и снимать QR+PDF (по умолчанию 1; 0 = только прямая ссылка /waybill/{id}/)
 *   QR_FETCH_LIST_URL — URL страницы списка путевых (по умолчанию TAKSKOM_URL, т.е. главная)
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
const API_KEY = process.env.SIGNER_API_KEY || process.env.CLINIC_API_KEY || '';
const MIN_AGE_MINUTES = Math.max(0, parseInt(process.env.QR_FETCH_MIN_AGE_MINUTES, 10) || 0);
const QR_BATCH_SIZE = Math.min(20, Math.max(1, parseInt(process.env.QR_FETCH_BATCH_SIZE, 10) || 5));
const IDLE_SLEEP_SEC = Math.max(5, parseInt(process.env.QR_FETCH_IDLE_SLEEP_SEC, 10) || 15);
const HEADLESS = process.env.QR_FETCH_HEADLESS !== '0';
const SHOW_FIRST_LOGIN = process.env.QR_FETCH_SHOW_FIRST_LOGIN === '1';
const SESSION_CHECK_MINUTES = Math.max(5, parseInt(process.env.QR_FETCH_SESSION_CHECK_MINUTES, 10) || 10);
const SESSION_CHECK_MS = SESSION_CHECK_MINUTES * 60 * 1000;
// Сколько подряд неудачных попыток по одному ЭПЛ, прежде чем сделать паузу.
// Раньше минимальное значение было 3, из-за чего воркер мог «отпустить» QR,
// который появляется позже после подписания механиком. Увеличиваем лимит.
const SKIP_AFTER_FAILURES = Math.max(10, parseInt(process.env.QR_FETCH_SKIP_AFTER_FAILURES, 10) || 10);
const PREFER_MINTRANS = process.env.QR_FETCH_PREFER_MINTRANS === '1';
const ONCE = process.argv.includes('--once');
const FORCE_EPL_ID = (() => {
  const arg = process.argv.find((a) => a.startsWith('--epl='));
  return arg ? parseInt(arg.split('=')[1], 10) || null : null;
})();
const KEEP_BROWSER_OPEN = process.env.QR_FETCH_KEEP_BROWSER !== '0';

const eplFailCount = new Map();

const USER_DATA_DIR = (process.env.QR_FETCH_USER_DATA_DIR || '').trim() || path.join(appDir, 'qr-fetcher-profile');
const LOGGED_IN_FLAG = path.join(USER_DATA_DIR, '.qr-fetcher-logged-in');

if (!API_KEY) {
  console.error('[qr-fetcher] В .env задайте SIGNER_API_KEY или CLINIC_API_KEY.');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json'
};

let playwright = null;
function getPlaywright() {
  if (!playwright) {
    try {
      playwright = require('playwright-core');
    } catch (e) {
      return null;
    }
  }
  return playwright;
}

/** Нужно показать окно для первого логина? */
function needShowFirstLogin() {
  return SHOW_FIRST_LOGIN && !fs.existsSync(LOGGED_IN_FLAG);
}

/** Отметить, что первый логин выполнен */
function markFirstLoginDone() {
  try {
    if (!fs.existsSync(USER_DATA_DIR)) fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    fs.writeFileSync(LOGGED_IN_FLAG, new Date().toISOString(), 'utf8');
  } catch (_) {}
}

/** Проверка: на странице логина? (редирект при истечении сессии) */
function isLoginPage(url) {
  const u = (url || '').toLowerCase();
  return u.includes('/login') || u.includes('/auth') || u.includes('/signin') || u.includes('auth.taxcom');
}

/** Проверить, что мы ещё залогинены; при редиректе на логин — false */
async function isSessionValid(page, baseUrl) {
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 2000));
    const url = page.url();
    return !isLoginPage(url);
  } catch (e) {
    return false;
  }
}

/** ЭПЛ, которые временно пропускаем (QR не найден после N попыток) */
const skipEplUntil = new Map();

async function logEplEvent(eplId, event, message, details) {
  try {
    if (!eplId || !event) return;
    await fetch(`${API_URL}/api/clinic/epl-log`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        eplId,
        event,
        message,
        details
      })
    });
  } catch (_) {
    // Логгирование не должно ломать воркер
  }
}

/** Запросить у бэкенда батч ЭПЛ без QR (с подписанными Т1–Т4, minAgeMinutes=0 — в т.ч. последние созданные).
 * При FORCE_EPL_ID — возвращает только этот ЭПЛ (для перезалива). */
async function getNextEplBatch() {
  const forcePart = FORCE_EPL_ID ? `&forceEplId=${FORCE_EPL_ID}` : '';
  const url = `${API_URL}/api/clinic/next-epl-for-qr-fetch?minAgeMinutes=${MIN_AGE_MINUTES}&limit=${FORCE_EPL_ID ? 1 : QR_BATCH_SIZE}&requireTitlesSigned=1${forcePart}`;
  try {
    const res = await fetch(url, { headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return [];
    const list = data.items || (data.item ? [data.item] : []);
    const filtered = list.filter((item) => !skipEplUntil.has(item.eplId) || Date.now() >= skipEplUntil.get(item.eplId));
    return FORCE_EPL_ID ? filtered.filter((i) => i.eplId === FORCE_EPL_ID) : filtered;
  } catch (e) {
    return [];
  }
}

/** Отметить неудачу по ЭПЛ; при N подряд — пропускать 10 мин */
function recordQrFailure(eplId) {
  const n = (eplFailCount.get(eplId) || 0) + 1;
  eplFailCount.set(eplId, n);
  logEplEvent(eplId, 'qr_fetch_attempt_failed', `Попытка получить QR №${n} не удалась`, { attempt: n });
  if (n >= SKIP_AFTER_FAILURES) {
    const until = Date.now() + 10 * 60 * 1000;
    skipEplUntil.set(eplId, until);
    console.log(`[qr-fetcher] EPL ${eplId}: QR не найден ${n} раз подряд — пропуск на 10 мин (QR появится после подписания Т4).`);
    eplFailCount.set(eplId, 0);
    logEplEvent(eplId, 'qr_fetch_skipped', `QR не найден ${n} раз подряд — пропуск на 10 минут`, { attempts: n, skipUntil: until });
  }
}

function recordQrSuccess(eplId) {
  eplFailCount.set(eplId, 0);
  skipEplUntil.delete(eplId);
  logEplEvent(eplId, 'qr_fetch_worker_success', 'QR получен воркером qr-fetcher', null);
}

/** Пытаемся получить QR через API Такском (те же куки). waybillNumber — номер ПЛ (WB-...) для /qr/waybill-number/. */
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
          const d = 'data:' + mime + ';base64,' + data.data.qr.content;
          if (isValidQrDataUrl(d)) return d;
        }
        const qr = data.qrCode || data.qr || data.qr_code || data.qrImage || data.image;
        if (qr && typeof qr === 'string') {
          let s = qr.replace(/&gt;/g, '').replace(/>/g, '');
          let d = (s.startsWith('data:') || s.includes('base64')) ? s : (!s.startsWith('http') ? 'data:image/png;base64,' + s : null);
          if (d && isValidQrDataUrl(d)) return d;
        }
      }
      if ((ct.includes('image/png') || ct.includes('image/gif')) && body && body.length > 0) {
        const mime = ct.includes('image/gif') ? 'image/gif' : 'image/png';
        const d = 'data:' + mime + ';base64,' + body.toString('base64');
        if (isValidQrDataUrl(d)) return d;
      }
    } catch (_) {}
  }
  return null;
}

/** Ждём на странице путевого появления статуса «QR-код получен» или картинки QR (до timeoutMs). */
async function waitForQrStatusOrImage(page, timeoutMs = 20000) {
  try {
    await page.waitForFunction(
      () => {
        const text = document.body.innerText || '';
        const hasStatus = text.includes('QR-код получен');
        const hasImg = document.querySelector('img[src*="base64"]') || document.querySelector('.color-status-green');
        return hasStatus || !!hasImg;
      },
      { timeout: timeoutMs }
    );
    return true;
  } catch (_) {
    return false;
  }
}

/** Вытягиваем QR со страницы путевого: раскрыть блок, подождать появления img, парсить data-URL или URL картинки */
async function extractQrFromPage(page, waitMs = 3000) {
  await new Promise((r) => setTimeout(r, Math.min(2000, waitMs)));
  const collapseTrigger = await page.$('[data-bs-target="#qr-collapse-block"]');
  if (collapseTrigger) {
    await collapseTrigger.click().catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
  } else {
    await page.evaluate(() => {
      const block = document.getElementById('qr-collapse-block');
      if (block) block.classList.add('show');
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
  }
  const qrImgSelector = '#qr-collapse-block img, img[src*="base64"], img[src*="data:image"], img[alt*="Qr-код" i], img[alt*="QR" i], img[src*="qr"]';
  await page.waitForSelector('img', { state: 'visible', timeout: Math.max(8000, waitMs) }).catch(() => null);
  const dataUrl = await page.evaluate(() => {
    const block = document.getElementById('qr-collapse-block');
    const blockImg = block ? block.querySelector('img') : null;
    const imgs = blockImg ? [blockImg] : Array.from(document.querySelectorAll('img'));
    for (const img of imgs) {
      if (!img.src) continue;
      let src = String(img.src)
        .replace(/&gt;/g, '')
        .replace(/>/g, '')
        .replace(/;+/g, ';');
      if ((src.startsWith('data:') || src.includes('base64')) && src.length > 100) return src;
    }
    for (const img of imgs) {
      if (!img.src) continue;
      const parent = img.closest('div, section, aside');
      const parentText = parent ? parent.innerText || '' : '';
      if (parentText.indexOf('Срок действия') >= 0 || parentText.indexOf('QR') >= 0 || img.src.indexOf('qr') >= 0) return img.src;
    }
    for (const img of imgs) {
      if (img.src && (img.width >= 80 && img.height >= 80)) return img.src;
    }
    return null;
  });
  if (!dataUrl) return null;
  let fixed = String(dataUrl).replace(/&gt;/g, '').replace(/>/g, '').replace(/;+/g, ';');
  if (fixed.startsWith('data:') && fixed.includes('base64') && fixed.length > 100 && isValidQrDataUrl(fixed)) return fixed;
  if (dataUrl.startsWith('http')) {
    try {
      const res = await page.request.get(dataUrl, { timeout: 10000 });
      if (res.ok()) {
        const body = await res.body();
        const ct = (res.headers()['content-type'] || '').toLowerCase();
        const mime = ct.includes('image/') ? (ct.includes('gif') ? 'image/gif' : 'image/png') : 'image/png';
        if (body && body.length > 0) {
          const d = 'data:' + mime + ';base64,' + body.toString('base64');
          return isValidQrDataUrl(d) ? d : null;
        }
      }
    } catch (_) {}
  }
  return null;
}

// Мин. размер QR (байт): отсекаем заглушки/логотипы типа TAX.COM на странице Такском
const QR_MIN_IMAGE_BYTES = Math.max(1000, parseInt(process.env.QR_FETCH_MIN_IMAGE_BYTES, 10) || 6000);

/** Проверка: data URL — реальный QR, а не заглушка. Мин. размер, валидный base64. */
function isValidQrDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return false;
  const s = String(dataUrl).trim();
  if (!s.startsWith('data:image/') || !s.includes('base64,')) return false;
  const base64 = s.split('base64,')[1];
  if (!base64 || base64.length < 100) return false;
  try {
    const buf = Buffer.from(base64, 'base64');
    if (buf.length < QR_MIN_IMAGE_BYTES) return false;
    const header = buf.subarray(0, 8);
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const gif87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
    const gif89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
    const jpeg = [0xff, 0xd8, 0xff];
    const ok = (header[0] === png[0] && header[1] === png[1]) ||
      (header[0] === gif87[0] && header[1] === gif87[1]) ||
      (header[0] === jpeg[0] && header[1] === jpeg[1]);
    return !!ok;
  } catch (_) {
    return false;
  }
}

/** Страница списка путевых (вкладка «Все ЭПЛ»). По умолчанию главная epl.taxcom.ru. */
const LIST_PAGE_URL = (process.env.QR_FETCH_LIST_URL || '').trim() || null;

/**
 * Открыть список ЭПЛ, переключить на вкладку «Все ЭПЛ», собрать строки со статусом «QR-код получен».
 * Возвращает массив { waybillNumber, href, mintransId }.
 */
async function openListAndGetRowsWithQrReceived(page, baseUrl) {
  const listUrl = LIST_PAGE_URL || baseUrl;
  await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await new Promise((r) => setTimeout(r, 3000));
  if (isLoginPage(page.url())) return null;
  // Вкладка «Все ЭПЛ» — клик по тексту или по data-атрибуту
  const allEplTab = page.locator('a:has-text("Все ЭПЛ"), button:has-text("Все ЭПЛ"), [role="tab"]:has-text("Все ЭПЛ"), .nav-link:has-text("Все ЭПЛ")').first();
  if (await allEplTab.count() > 0) {
    await allEplTab.click().catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
  }
  const rows = await page.evaluate(() => {
    const result = [];
    const statusDivs = document.querySelectorAll('.color-status-green');
    for (const div of statusDivs) {
      if (!div.innerText || !div.innerText.includes('QR-код получен')) continue;
      const container = div.closest('tr, .main-grid-row, [class*="row"], [class*="grid-row"], .main-grid, table');
      if (!container) continue;
      const a = container.querySelector('a[href*="/waybill/"]');
      if (!a) continue;
      const link = a.getAttribute('href') || '';
      const waybillNumber = (a.textContent || '').trim().replace(/\s+/g, ' ');
      const mintransMatch = link.match(/\/waybill\/(\d+)/);
      const mintransId = mintransMatch ? mintransMatch[1] : '';
      if (link && mintransId) result.push({ waybillNumber, href: link, mintransId });
    }
    return result;
  });
  return Array.isArray(rows) ? rows : [];
}

/** На текущей странице списка (вкладка «Все ЭПЛ») найти ссылку на карточку по mintransId (любой статус). Для перезалива. */
async function getListRowForMintransIdFromCurrentPage(page, mintransId) {
  if (!page || !mintransId) return null;
  const row = await page.evaluate((id) => {
    const a = document.querySelector('a[href*="/waybill/' + id + '"]');
    if (!a) return null;
    const href = a.getAttribute('href') || '';
    return href ? { href, mintransId: String(id) } : null;
  }, String(mintransId));
  return row;
}

/**
 * Со страницы карточки путевого (2-й экран после клика по номеру в списке) вытянуть QR из img
 * (например img[alt="Qr-код"] или img[src*="base64"]) и нормализовать data URL (исправить &gt; в ;).
 */
async function extractQrFromDetailPage(page, waitMs = 3000) {
  await new Promise((r) => setTimeout(r, Math.min(2000, waitMs)));
  // Модальное окно QR: открыть по клику на img или по data-bs-target
  const qrImgTrigger = page.locator('img[alt*="Qr-код" i], img[alt*="QR" i], [data-bs-target*="qrModal"]').first();
  if (await qrImgTrigger.count() > 0) {
    await qrImgTrigger.click().catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
  }
  const dataUrl = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img[src*="base64"], img[alt*="Qr-код" i], img[alt*="QR" i], img[data-bs-target*="qrModal"]'));
    for (const img of imgs) {
      if (!img.src) continue;
      let src = String(img.src).replace(/&gt;/g, ';').replace(/>/g, '').replace(/;+/g, ';');
      if ((src.startsWith('data:') || src.includes('base64')) && src.length > 200) return src;
    }
    const all = document.querySelectorAll('img');
    for (const img of all) {
      if (!img.src || !img.src.includes('base64')) continue;
      let src = String(img.src).replace(/&gt;/g, ';').replace(/>/g, '').replace(/;+/g, ';');
      if (src.length > 200) return src;
    }
    return null;
  });
  if (!dataUrl) return null;
  const fixed = String(dataUrl).replace(/&gt;/g, ';').replace(/>/g, '').replace(/;+/g, ';');
  return isValidQrDataUrl(fixed) ? fixed : null;
}

/** Варианты URL для скачивания QR с Такском/Минтранс (одна сессия). */
const QR_DOWNLOAD_URL_SUFFIXES = [
  '?action=load',
  '/qr',
  '/qr/download',
  '/qr/image',
  '/download/qr',
  '/qr/load',
  '/print/qr'
];

/** Скачать QR по прямой ссылке (Минтранс/Такском): перебор URL пока не вернётся картинка. */
async function tryFetchQrViaDownloadLink(page, baseUrl, mintransId) {
  if (!page || !page.request || !mintransId) return null;
  const base = baseUrl.replace(/\/$/, '') + '/waybill/' + mintransId;
  for (const suffix of QR_DOWNLOAD_URL_SUFFIXES) {
    const url = base + (suffix.startsWith('?') ? '/' + suffix : suffix);
    try {
      const res = await page.request.get(url, { timeout: 12000, headers: { Accept: 'image/png, image/gif, image/jpeg, */*' } });
      if (!res.ok()) continue;
      const ct = (res.headers()['content-type'] || '').toLowerCase();
      const body = await res.body();
      if (!body || body.length < QR_MIN_IMAGE_BYTES) continue;
      if (!ct.includes('image/') && !ct.includes('octet-stream')) continue;
      const mime = ct.includes('image/gif') ? 'image/gif' : ct.includes('image/png') ? 'image/png' : 'image/png';
      const dataUrl = 'data:' + mime + ';base64,' + body.toString('base64');
      if (isValidQrDataUrl(dataUrl)) return dataUrl;
    } catch (_) {}
  }
  return null;
}

/** Скачать PDF путевого с Такском (та же сессия, страница уже открыта). */
async function fetchPdfForWaybill(page, baseUrl, mintransId) {
  try {
    const pdfUrl = `${baseUrl}/waybill/${mintransId}/print/download/pdf`;
    const response = await page.request.get(pdfUrl, { timeout: 30000 });
    if (!response.ok()) return null;
    const body = await response.body();
    if (body && body.length > 0) return body.toString('base64');
  } catch (e) {
    return null;
  }
  return null;
}

const MIN_PDF_BYTES = 5000;

/** Кнопка «Скачать» под QR (в блоке «Срок действия ПЛ» + QR). */
function getQrDownloadButton(page) {
  const blockWithQr = page.locator('text=Срок действия ПЛ').first().locator('..').locator('..');
  return blockWithQr.locator('a:has-text("Скачать"), button:has-text("Скачать")').first();
}

/** Кнопка «Скачать» в блоке «Печатная форма ПЛ». */
function getPdfDownloadButton(page) {
  const pdfSection = page.locator('text=Печатная форма ПЛ').first().locator('..').locator('..');
  return pdfSection.locator('a:has-text("Скачать"), button:has-text("Скачать")').first();
}

/** Скачать QR по кнопке «Скачать» под QR-кодом: по href ссылки (надёжно в headless) или по событию download. */
async function downloadQrViaPageButton(page, baseUrl) {
  try {
    let downloadBtn = getQrDownloadButton(page);
    if ((await downloadBtn.count()) === 0) {
      downloadBtn = page.locator('a[href*="action=load"], a[href*="/qr"]').first();
    }
    if ((await downloadBtn.count()) === 0) {
      downloadBtn = page.locator('a:has-text("Скачать"), button:has-text("Скачать")').first();
    }
    if ((await downloadBtn.count()) === 0) return null;
    const href = await downloadBtn.getAttribute('href').catch(() => null);
    if (href && page.request && (href.startsWith('http') || href.startsWith('/'))) {
      const qrUrl = href.startsWith('http') ? href : (baseUrl || '').replace(/\/$/, '') + href;
      try {
        const res = await page.request.get(qrUrl, { timeout: 12000, headers: { Accept: 'image/png, image/gif, image/jpeg, */*' } });
        if (!res.ok()) return null;
        const body = await res.body();
        const ct = (res.headers()['content-type'] || '').toLowerCase();
        if ((!body || body.length < QR_MIN_IMAGE_BYTES)) return null;
        if (!ct.includes('image/') && !ct.includes('octet-stream')) return null;
        const mime = ct.includes('image/gif') ? 'image/gif' : ct.includes('image/png') ? 'image/png' : 'image/png';
        const dataUrl = 'data:' + mime + ';base64,' + body.toString('base64');
        if (isValidQrDataUrl(dataUrl)) return dataUrl;
      } catch (_) {}
    }
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 12000 }).catch(() => null),
      downloadBtn.click().catch(() => null)
    ]);
    if (!download) return null;
    const path = await download.path();
    if (!path || !fs.existsSync(path)) return null;
    const buf = fs.readFileSync(path);
    try { fs.unlinkSync(path); } catch (_) {}
    const suggested = download.suggestedFilename() || '';
    const ct = (download.contentType() || '').toLowerCase();
    const isImage = ct.includes('image/') || /\.(png|gif|jpe?g)$/i.test(suggested);
    if (!isImage || buf.length < QR_MIN_IMAGE_BYTES) return null;
    const mime = ct.includes('image/gif') ? 'image/gif' : ct.includes('image/png') ? 'image/png' : 'image/png';
    const dataUrl = 'data:' + mime + ';base64,' + buf.toString('base64');
    return isValidQrDataUrl(dataUrl) ? dataUrl : null;
  } catch (_) {
    return null;
  }
}

/** Скачать PDF: сначала по кнопке «Скачать» в блоке «Печатная форма ПЛ», иначе по прямой ссылке. */
async function downloadPdfViaPageOrRequest(page, baseUrl, mintransId) {
  let base64 = null;
  try {
    const pdfBtn = getPdfDownloadButton(page);
    if ((await pdfBtn.count()) > 0) {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
        pdfBtn.click().catch(() => null)
      ]);
      if (download) {
        const path = await download.path();
        if (path && fs.existsSync(path)) {
          const buf = fs.readFileSync(path);
          try { fs.unlinkSync(path); } catch (_) {}
          if (buf.length >= MIN_PDF_BYTES) base64 = buf.toString('base64');
        }
      }
    }
  } catch (_) {}
  if (base64) return base64;
  try {
    base64 = await fetchPdfForWaybill(page, baseUrl, mintransId);
  } catch (_) {}
  if (base64 && Buffer.byteLength(Buffer.from(base64, 'base64')) >= MIN_PDF_BYTES) return base64;
  try {
    const pdfLink = page.locator('a[href*="print/download/pdf"], a[href*="download/pdf"], a[href*="/pdf"]').first();
    if ((await pdfLink.count()) > 0) {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
        pdfLink.click().catch(() => null)
      ]);
      if (download) {
        const path = await download.path();
        if (path && fs.existsSync(path)) {
          const buf = fs.readFileSync(path);
          try { fs.unlinkSync(path); } catch (_) {}
          if (buf.length >= MIN_PDF_BYTES) base64 = buf.toString('base64');
        }
      }
    }
  } catch (_) {}
  return base64;
}

/** Цикл: браузер держим открытым, залогинились — обрабатываем очередь подряд */
async function runSession(existingContext, lastSessionCheck) {
  const { chromium } = getPlaywright();
  if (!chromium) {
    console.warn('[qr-fetcher] playwright-core не установлен. npm install playwright-core');
    return { processed: 0, context: null, lastSessionCheck };
  }

  const baseUrl = (process.env.TAKSKOM_URL || 'https://epl.taxcom.ru').replace(/\/$/, '');
  const phone = process.env.TAKSKOM_DISPATCHER_PHONE || process.env.TAKSKOM_LOGIN_PHONE || '';
  const password = process.env.TAKSKOM_DISPATCHER_PASSWORD || process.env.TAKSKOM_LOGIN_PASSWORD || '';
  if (!phone || !password) {
    console.warn('[qr-fetcher] TAKSKOM_DISPATCHER_PHONE и TAKSKOM_DISPATCHER_PASSWORD не заданы.');
    return { processed: 0, context: null, lastSessionCheck };
  }

  const { login } = require('./auth/login');
  let context = existingContext;
  let page = null;
  let firstLoginShown = false;
  let needCloseAndRelaunchHeadless = false;

  try {
    if (!context) {
      const showWindow = needShowFirstLogin();
      const headless = showWindow ? false : HEADLESS;
      if (showWindow) {
        console.log('[qr-fetcher] Первый логин — показываю окно. Залогинься, потом браузер скроется.');
      }
      console.log(`[qr-fetcher] Запуск браузера (headless: ${headless})...`);
      context = await chromium.launchPersistentContext(USER_DATA_DIR, { headless });
      page = context.pages()[0] || await context.newPage();
      firstLoginShown = showWindow;
    } else {
      page = context.pages()[0] || await context.newPage();
    }

    const doLogin = async () => {
      const ok = await login(page, baseUrl, phone, password, process.env);
      if (ok && firstLoginShown) {
        markFirstLoginDone();
        needCloseAndRelaunchHeadless = true;
        console.log('[qr-fetcher] Логин OK. Скрываю браузер — продолжу в фоне.');
      } else if (ok) {
        console.log('[qr-fetcher] Релогин OK.');
      }
      return ok;
    };

    // Проверка сессии: если долго неактивны — проверяем и релогиним при необходимости
    const now = Date.now();
    if (lastSessionCheck && (now - lastSessionCheck) > SESSION_CHECK_MS) {
      if (!(await isSessionValid(page, baseUrl))) {
        console.log('[qr-fetcher] Сессия истекла (неактивность >' + SESSION_CHECK_MINUTES + ' мин). Релогин...');
        if (!(await doLogin())) {
          console.warn('[qr-fetcher] Релогин не удался.');
          if (context) await context.close().catch(() => {});
          return { processed: 0, context: null, lastSessionCheck };
        }
      }
      lastSessionCheck = now;
    } else if (!lastSessionCheck) {
      lastSessionCheck = now;
    }

    // Первый запуск — всегда логиним
    if (!existingContext) {
      if (!(await isSessionValid(page, baseUrl))) {
        if (!(await doLogin())) {
          console.warn('[qr-fetcher] Вход в Такском не удался.');
          if (context) await context.close().catch(() => {});
          return { processed: 0, context: null, lastSessionCheck };
        }
      } else {
        console.log('[qr-fetcher] Сессия активна (сохранённый профиль).');
      }
    }

    // После первого логина — закрываем видимое окно и перезапускаем в нужном режиме (headless берём из QR_FETCH_HEADLESS)
    if (needCloseAndRelaunchHeadless && context) {
      await context.close().catch(() => {});
      context = await chromium.launchPersistentContext(USER_DATA_DIR, { headless: HEADLESS });
      page = context.pages()[0] || await context.newPage();
    }

    const QR_MAX_ATTEMPTS = Math.max(3, parseInt(process.env.QR_FETCH_MAX_ATTEMPTS, 10) || 4);
    const QR_WAIT_AFTER_LOAD_MS = Math.max(3000, parseInt(process.env.QR_FETCH_WAIT_AFTER_LOAD_MS, 10) || 10000);
    const QR_INITIAL_DELAY_MS = Math.max(5000, parseInt(process.env.QR_FETCH_INITIAL_DELAY_MS, 10) || 15000);
    const QR_STATUS_TIMEOUT_MS = Math.max(15000, parseInt(process.env.QR_FETCH_STATUS_TIMEOUT_MS, 10) || 30000);
    const useListFlow = process.env.QR_FETCH_VIA_LIST !== '0';
    let processed = 0;
    const batch = await getNextEplBatch();
    let listRowsWithQr = null;
    if (useListFlow && batch.length > 0) {
      listRowsWithQr = await openListAndGetRowsWithQrReceived(page, baseUrl);
      if (listRowsWithQr && listRowsWithQr.length > 0) {
        console.log(`[qr-fetcher] В списке «Все ЭПЛ» со статусом «QR-код получен»: ${listRowsWithQr.length} шт.`);
      }
    }
    for (const item of batch) {
      const t0 = Date.now();
      console.log(`[qr-fetcher] EPL ${item.eplId}, waybill ${item.waybillNumber}, mintransId ${item.mintransId}...`);
      try {
        let qrCode = null;
        let usedListFlow = false;
        let listRow = listRowsWithQr && listRowsWithQr.find(
          (r) => r.mintransId === String(item.mintransId) || (r.waybillNumber && item.waybillNumber && r.waybillNumber.replace(/\s/g, '') === item.waybillNumber.replace(/\s/g, ''))
        );
        if (!listRow && FORCE_EPL_ID && item.mintransId && listRowsWithQr !== null) {
          listRow = await getListRowForMintransIdFromCurrentPage(page, item.mintransId);
          if (listRow) console.log('[qr-fetcher] Перезалив: карточка найдена в списке по mintransId, открываю.');
        }
        if (listRow) {
          const detailUrl = listRow.href.startsWith('http') ? listRow.href : baseUrl.replace(/\/$/, '') + listRow.href;
          await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
          await new Promise((r) => setTimeout(r, 3500));
          if (!isLoginPage(page.url())) {
            qrCode = await downloadQrViaPageButton(page, baseUrl);
            if (qrCode) {
              usedListFlow = true;
              console.log('[qr-fetcher] QR скачан по кнопке «Скачать» (список → карточка).');
            }
            if (!qrCode) {
              qrCode = await tryFetchQrViaDownloadLink(page, baseUrl, listRow.mintransId);
              if (qrCode) console.log('[qr-fetcher] QR по ссылке Минтранс (список → карточка).');
            }
            if (!qrCode) {
              const fromPage = await extractQrFromDetailPage(page, QR_WAIT_AFTER_LOAD_MS);
              if (fromPage) console.log('[qr-fetcher] QR со страницы не используем (Такском-заглушка), только кнопка/ссылка.');
            }
          }
        }
        if (!qrCode) {
          await page.goto(`${baseUrl}/waybill/${item.mintransId}/`, { waitUntil: 'domcontentloaded', timeout: 25000 });
          await new Promise((r) => setTimeout(r, QR_INITIAL_DELAY_MS));
          if (isLoginPage(page.url())) {
            if (!(await login(page, baseUrl, phone, password, process.env))) {
              console.warn('[qr-fetcher] Релогин не удался, пропуск EPL ' + item.eplId);
              continue;
            }
            await page.goto(`${baseUrl}/waybill/${item.mintransId}/`, { waitUntil: 'domcontentloaded', timeout: 25000 });
          }
          for (let attempt = 1; attempt <= QR_MAX_ATTEMPTS && !qrCode; attempt++) {
            if (attempt > 1) {
              await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
              await new Promise((r) => setTimeout(r, QR_WAIT_AFTER_LOAD_MS));
            }
            qrCode = await downloadQrViaPageButton(page, baseUrl);
            if (qrCode) {
              console.log(`[qr-fetcher] QR по кнопке «Скачать» (попытка ${attempt}).`);
              break;
            }
            if (item.mintransId) {
              qrCode = await tryFetchQrViaDownloadLink(page, baseUrl, item.mintransId);
              if (qrCode) console.log(`[qr-fetcher] QR по ссылке Минтранс (попытка ${attempt}).`);
            }
            if (!qrCode) {
              qrCode = await tryFetchQrViaApi(page, baseUrl, item.mintransId, item.waybillNumber);
              if (qrCode) console.log(`[qr-fetcher] QR через API (попытка ${attempt}).`);
            }
            if (!qrCode) {
              const fromPage = await extractQrFromPage(page, QR_WAIT_AFTER_LOAD_MS);
              if (fromPage) console.log(`[qr-fetcher] QR со страницы не используем (Такском-заглушка), попытка ${attempt}.`);
            }
          }
        }
        if (!qrCode || !isValidQrDataUrl(qrCode)) {
          if (qrCode) console.log(`[qr-fetcher] QR отклонён (заглушка/малый размер <${QR_MIN_IMAGE_BYTES} байт), повтор...`);
          recordQrFailure(item.eplId);
          continue;
        }
        let documentPdf = await downloadPdfViaPageOrRequest(page, baseUrl, item.mintransId);
        if (documentPdf) {
          console.log('[qr-fetcher] PDF скачан, отправляю QR + PDF на сайт.');
        }
        const res = documentPdf
          ? await fetch(`${API_URL}/api/clinic/epl-created`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                eplId: item.eplId,
                mintransId: item.mintransId,
                documentPdf,
                qrCode
              })
            })
          : await fetch(`${API_URL}/api/clinic/epl/${item.eplId}/qr`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ qrCode })
            });
        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          console.warn('[qr-fetcher] Ответ сервера:', res.status, errBody ? errBody.slice(0, 200) : '');
          continue;
        }
        const ms = Date.now() - t0;
        console.log(`[qr-fetcher] QR${documentPdf ? ' и PDF' : ''} сохранены EPL ${item.eplId} (${Math.round(ms / 1000)} с).`);
        recordQrSuccess(item.eplId);
        processed++;
        lastSessionCheck = Date.now();
      } catch (e) {
        console.warn(`[qr-fetcher] Ошибка EPL ${item.eplId}:`, e.message);
      }
    }

    if (!KEEP_BROWSER_OPEN && context) {
      await context.close().catch(() => {});
      return { processed, context: null, lastSessionCheck };
    }
    return { processed, context, lastSessionCheck };
  } catch (e) {
    console.warn('[qr-fetcher] Ошибка сессии:', e.message);
    if (context) await context.close().catch(() => {});
    return { processed: 0, context: null, lastSessionCheck };
  }
}

async function main() {
  const showFirst = needShowFirstLogin();
  console.log(`[qr-fetcher] Опрос очереди ЭПЛ без QR каждые ${IDLE_SLEEP_SEC} с. Батч до ${QR_BATCH_SIZE}${MIN_AGE_MINUTES > 0 ? `, возраст ≥${MIN_AGE_MINUTES} мин` : ''}.`);
  console.log(`[qr-fetcher] Профиль: ${USER_DATA_DIR}. Headless: ${HEADLESS}. Проверка сессии Такском (релогин при истечении): раз в ${SESSION_CHECK_MINUTES} мин.`);
  if (showFirst) console.log('[qr-fetcher] При первом логине покажу окно, затем скрою.');

  let context = null;
  let lastSessionCheck = null;

  if (ONCE) {
    const { processed } = await runSession(null, null);
    console.log(`[qr-fetcher] Обработано: ${processed}`);
    process.exit(0);
    return;
  }

  for (;;) {
    const { processed, context: ctx, lastSessionCheck: lsc } = await runSession(context, lastSessionCheck);
    if (KEEP_BROWSER_OPEN) {
      context = ctx;
      lastSessionCheck = lsc;
    } else {
      context = null;
      lastSessionCheck = null;
    }
    if (processed === 0) {
      await new Promise((r) => setTimeout(r, IDLE_SLEEP_SEC * 1000));
    }
  }
}

if (require.main === module) {
  main();
} else {
  module.exports = { main };
}
