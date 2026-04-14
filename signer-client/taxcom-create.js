/**
 * Создание ЭПЛ в ЛК Такском через Playwright: логин диспетчера → заполнение формы → сохранение.
 * Подписание титулов отключено — только создание и заполнение. Титулы создаются без подписи.
 * После получения mintransId бэкенд создаст титулы Т1–Т4 без подписи.
 *
 * .env: TAKSKOM_DISPATCHER_PHONE, TAKSKOM_DISPATCHER_PASSWORD, CHROMIUM_GOST_PATH.
 */

const path = require('path');
const fs = require('fs');

// Импортируем модули
const { highlightElement, waitForUserConfirmation, waitForContinue, clearScreenshotsDir, takeScreenshot } = require('./utils/debug');
const { runCertPicker } = require('./utils/certificates');
const { login, logout } = require('./auth/login');
const { signTitle, closeModalDialogs, waitForSignSuccess } = require('./titles/sign');

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

const SCREENSHOTS_ERR_HINT = 'При ошибке смотри скриншоты в screenshots/ — последние по времени от этого запуска.';

/** Клик по видимой кнопке «Сохранить» (не по скрытому input[name="save"]). */
async function clickVisibleSaveBtn(page) {
  const candidates = [
    page.locator('#save_btn').first(),
    page.locator('button:has-text("Сохранить")').first(),
    page.locator('input[type="submit"][value="Сохранить"]').first()
  ];
  for (const loc of candidates) {
    if ((await loc.count()) === 0) continue;
    const visible = await loc.isVisible().catch(() => false);
    if (visible) {
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      await loc.click({ timeout: 10000 });
      return true;
    }
  }
  return false;
}

/**
 * Грузовой ЭПЛ (отличие от «такси»): вид коммерческой перевозки, признак начала рейса, вид сообщения и т.д.
 * Подбор option по подстроке в тексте — под разные версии формы Bitrix/Такском.
 */
async function selectOptionFirstMatch(page, selectors, substring, logLabel) {
  if (!substring || !String(substring).trim()) return false;
  const needle = String(substring).trim().toLowerCase();
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    const count = await loc.locator('option').count();
    for (let i = 0; i < count; i++) {
      const opt = loc.locator('option').nth(i);
      const text = ((await opt.innerText().catch(() => '')) || '').trim();
      if (text.toLowerCase().includes(needle)) {
        try {
          await loc.selectOption({ index: i });
          console.log(`[Taxcom] ✓ ${logLabel}: ${text.slice(0, 100)}${text.length > 100 ? '…' : ''}`);
          await page.waitForTimeout(350);
          await loc.dispatchEvent('change');
          return true;
        } catch (e) {
          console.warn(`[Taxcom] selectOptionFirstMatch ${logLabel}:`, e.message);
        }
      }
    }
  }
  return false;
}

/** Подстрока для селекта «Вид коммерческой перевозки» из заявки (clinic) или код ЭПЛ. */
function resolveCommercialShippingEnv(item, baseEnv) {
  const merged = { ...baseEnv };
  const fromApi = (item.commercialShippingTaxcomLabel || '').trim();
  const code = String(item.commercialShippingType || 'ПГ')
    .trim()
    .toUpperCase();
  const fallbackCommercial = {
    ПГ: 'перевозка грузов',
    РП: 'регулярная перевозка',
    ЗП: 'по заказу',
    ТЛ: 'легковым такси',
    ОД: 'групп детей',
  };
  const fallbackMessage = {
    ПГ: 'пригород',
    РП: 'городск',
    ЗП: 'городск',
    ТЛ: 'городск',
    ОД: 'городск',
  };
  if (fromApi) {
    merged.TAXCOM_COMMERCIAL_SHIPPING_LABEL = fromApi;
  } else {
    merged.TAXCOM_COMMERCIAL_SHIPPING_LABEL = fallbackCommercial[code] || fallbackCommercial.ПГ;
  }
  if (!merged.TAXCOM_MESSAGE_KIND_LABEL) {
    merged.TAXCOM_MESSAGE_KIND_LABEL = fallbackMessage[code] || 'городск';
  }
  if (!merged.TAXCOM_SHIPPING_TYPE_VALUE) {
    merged.TAXCOM_SHIPPING_TYPE_VALUE = 'КП';
  }
  return merged;
}

/**
 * Шаг 1: select#shipping_type (SHIPPING_TYPE) — только КП/СН/СТ.
 * Коммерческие грузовые рейсы: value «КП» → затем waybill.runShipping() подгружает подтипы.
 */
async function selectShippingTypeCategoryKpThenRunShipping(page, env) {
  const e = env || {};
  const value = (e.TAXCOM_SHIPPING_TYPE_VALUE || 'КП').trim();
  const selectors = ['select#shipping_type', 'select[name="SHIPPING_TYPE"]'];
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    try {
      await loc.selectOption({ value });
      console.log(`[Taxcom] ✓ SHIPPING_TYPE (категория) value=${value}`);
      await page.waitForTimeout(400);
      await loc.dispatchEvent('change').catch(() => {});
    } catch (err) {
      const ok = await selectOptionFirstMatch(page, [sel], 'коммерческ', 'SHIPPING_TYPE (КП по подписи)');
      if (!ok) continue;
    }
    await page.waitForTimeout(500);
    await page
      .evaluate(() => {
        try {
          if (typeof window.waybill !== 'undefined' && window.waybill && typeof window.waybill.runShipping === 'function') {
            window.waybill.runShipping();
          }
        } catch (_) {}
      })
      .catch(() => {});
    await page.waitForTimeout(700);
    return true;
  }
  console.warn('[Taxcom] ⚠ Не выбран SHIPPING_TYPE (КП) — подтип коммерческой перевозки может быть недоступен.');
  return false;
}

/** Логируем адреса из заявки; автозаполнение полей ЛК — по мере уточнения селекторов Такском. */
function logFreightAddressesForWaybill(item) {
  const f = item && item.freightAddresses;
  if (!f || typeof f !== 'object') return;
  const { originAddress, loadAddress, unloadAddresses } = f;
  const unloads = Array.isArray(unloadAddresses) ? unloadAddresses : [];
  if (!originAddress && !loadAddress && unloads.length === 0) return;
  console.log('[Taxcom] Адреса грузового рейса (из заявки):', JSON.stringify({ originAddress, loadAddress, unloadAddresses: unloads }, null, 0));
}

/**
 * Заполнение полей поиска адреса на форме создания ЭПЛ (/waybill/new/): место отправления,
 * первая пара «погрузка / выгрузка», дальше — кнопка «Добавить» и последнее поле ввода = следующая выгрузка.
 * Ориентир по скринам ЛК: placeholder «Введите адрес», блок «Адреса пунктов погрузки и выгрузки», вкладки 1…n.
 * Отключить: TAXCOM_SKIP_ADDRESS_AUTOFILL=1
 */
async function fillFreightAddressesOnTaxcomWaybillForm(page, item, env) {
  const e = { ...(env || {}), ...(process.env || {}) };
  if (/^(1|true|yes)$/i.test(String(e.TAXCOM_SKIP_ADDRESS_AUTOFILL || '').trim())) return;

  const f = item && item.freightAddresses;
  if (!f || typeof f !== 'object') return;

  const origin = String(f.originAddress || '').trim();
  const load = String(f.loadAddress || '').trim();
  const unloads = Array.isArray(f.unloadAddresses) ? f.unloadAddresses.map((x) => String(x).trim()).filter(Boolean) : [];

  if (!origin && !load && unloads.length === 0) return;

  let formScope = page.locator('#title_form').first();
  if ((await formScope.count()) === 0) {
    formScope = page.locator('form').first();
  }
  const addrInputs = formScope.locator('input[placeholder*="Введите"], textarea[placeholder*="Введите"]');

  try {
    if ((await formScope.count()) === 0) {
      console.warn('[Taxcom] fillFreightAddresses: форма не найдена — поля «Введите адрес» по всей странице');
    }

    let inputs = addrInputs;
    if ((await inputs.count()) === 0) {
      inputs = page.locator('input[placeholder*="Введите"], textarea[placeholder*="Введите"]');
    }

    const safeFillNthGlobal = async (n, text, label) => {
      if (!text) return false;
      const loc = inputs.nth(n);
      if ((await loc.count()) === 0) return false;
      const vis = await loc.isVisible().catch(() => false);
      if (!vis) return false;
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      await loc.click({ timeout: 8000 }).catch(() => {});
      await loc.fill('');
      await loc.fill(text);
      await page.waitForTimeout(220);
      console.log(`[Taxcom] ✓ ${label} (поле #${n} среди «Введите…»)`);
      return true;
    };

    let idx = 0;

    if (origin) {
      const ok = await safeFillNthGlobal(idx, origin, 'Место отправления');
      if (ok) idx += 1;
    }

    if (load) {
      const ok = await safeFillNthGlobal(idx, load, 'Погрузка (первая пара)');
      if (ok) idx += 1;
    }

    if (unloads.length > 0) {
      const ok = await safeFillNthGlobal(idx, unloads[0], 'Выгрузка (первая пара)');
      if (ok) idx += 1;
    }

    for (let seg = 1; seg < unloads.length; seg++) {
      const addBtn = formScope.getByRole('button', { name: /^Добавить$/i }).first();
      if ((await addBtn.count()) > 0 && (await addBtn.isVisible().catch(() => false))) {
        await addBtn.click().catch(() => {});
        await page.waitForTimeout(750);
      } else {
        const addBtnPage = page.getByRole('button', { name: /^Добавить$/i }).first();
        if ((await addBtnPage.count()) > 0 && (await addBtnPage.isVisible().catch(() => false))) {
          await addBtnPage.click().catch(() => {});
          await page.waitForTimeout(750);
        } else {
          console.warn('[Taxcom] ⚠ Кнопка «Добавить» не найдена — дальнейшие выгрузки не заполнены');
          break;
        }
      }

      const cnt = await inputs.count();
      if (cnt === 0) break;
      const unloadText = unloads[seg];
      const last = inputs.nth(cnt - 1);
      await last.scrollIntoViewIfNeeded().catch(() => {});
      await last.click({ timeout: 8000 }).catch(() => {});
      await last.fill('');
      await last.fill(unloadText);
      await page.waitForTimeout(220);
      console.log(`[Taxcom] ✓ Выгрузка сегмент ${seg + 1}: ${unloadText.slice(0, 80)}${unloadText.length > 80 ? '…' : ''}`);
    }
  } catch (err) {
    console.warn('[Taxcom] fillFreightAddressesOnTaxcomWaybillForm:', err.message);
  }
}

async function applyFreightWaybillTaxcomFields(page, env) {
  const e = env || {};
  const commercial = e.TAXCOM_COMMERCIAL_SHIPPING_LABEL || 'перевозка грузов';
  const tripStart = e.TAXCOM_TRIP_START_LABEL || 'парковк';
  const messageKind = e.TAXCOM_MESSAGE_KIND_LABEL || 'городск';
  const shippingKind = (e.TAXCOM_SHIPPING_KIND_LABEL || '').trim();

  const commercialSelectors = [
    'select[name="COMMERCIAL_SHIPPING_TYPE"]',
    'select#commercial_shipping_type',
    '#commercial_shipping_type',
    'select[id*="commercial"][id*="shipping"]',
    'select[name*="COMMERCIAL"]',
  ];
  const tripStartSelectors = [
    'select[name="TRIP_START_FEATURE"]',
    'select#trip_start_feature',
    '#TRIP_START_FEATURE',
    'select[id*="trip"][id*="start"]',
    'select[name*="TRIP_START"]',
  ];
  const messageKindSelectors = [
    'select[name="AREA_SHIPPING_TYPE"]',
    'select[name="MESSAGE_KIND"]',
    '#area_shipping_type',
    'select[id*="message"]',
    'select[id*="AREA"]',
  ];
  const shippingKindSelectors = [
    'select[name="SHIPPING_KIND"]',
    'select#shipping_kind',
    '#SHIPPING_KIND',
    'select[id*="shipping_kind"]',
    'select[name*="SHIPPING_KIND"]',
    'select[id*="SHIPPING"][id*="KIND"]',
  ];

  await selectShippingTypeCategoryKpThenRunShipping(page, e);
  await selectOptionFirstMatch(page, commercialSelectors, commercial, 'Вид коммерческой перевозки (подтип)');
  if (shippingKind) {
    await selectOptionFirstMatch(page, shippingKindSelectors, shippingKind, 'Характер перевозки (грузовые / коммерч. и т.п.)');
  }
  await selectOptionFirstMatch(page, tripStartSelectors, tripStart, 'Признак начала рейса');
  await selectOptionFirstMatch(page, messageKindSelectors, messageKind, 'Сведения о виде сообщения');
}

/**
 * На форме создания ЭПЛ Такском иногда сначала просит выбрать автопарк (профиль).
 * Привязка должна идти по `takskornId` парка из настроек сайта (parks.takskornId → item.driver.takskornId).
 */
async function ensureCarParkSelectedOnT1(page, desiredTakskornId, desiredParkName, env) {
  const targetId = desiredTakskornId != null ? String(desiredTakskornId).trim() : '';
  if (!targetId) return false;

  // 1) Если форма уже на месте (поле "номер путевого" видно) — считаем, что профиль выбран.
  const hasWaybillInput = page.locator('input[placeholder*="номер путевого"], input[name="WAYBILL_NUMBER"], #waybill_number').first();
  if ((await hasWaybillInput.count()) > 0 && await hasWaybillInput.isVisible().catch(() => false)) return true;

  // 2) Попытка: модалка/блок выбора профиля (есть searchValueProfile)
  const search = page.locator('#searchValueProfile, input[id="searchValueProfile"]').first();
  if ((await search.count()) > 0 && await search.isVisible().catch(() => false)) {
    await search.fill('');
    await search.fill(targetId);
    await page.waitForTimeout(400);

    const pickCandidate = async (q) => {
      if (!q) return false;
      // Ищем строку/кнопку/элемент с совпадением по ID или названию
      const candidates = [
        page.locator(`text="${q}"`).first(),
        page.locator(`text=${q}`).first(),
        page.locator(`tr:has-text("${q}")`).first(),
        page.locator(`li:has-text("${q}")`).first(),
        page.locator(`div:has-text("${q}")`).first(),
        page.locator(`button:has-text("${q}")`).first(),
      ];
      for (const c of candidates) {
        if ((await c.count()) > 0 && await c.isVisible().catch(() => false)) {
          await c.scrollIntoViewIfNeeded().catch(() => {});
          await c.click().catch(() => {});
          await page.waitForTimeout(1200);
          return true;
        }
      }
      return false;
    };

    let picked = await pickCandidate(targetId);
    if (!picked && desiredParkName) {
      await search.fill('');
      await search.fill(String(desiredParkName));
      await page.waitForTimeout(400);
      picked = await pickCandidate(String(desiredParkName));
    }

    // после выбора профиль обычно уводит на /waybill/new (форма) — ждём появления полей
    if (picked) {
      await page.waitForTimeout(1200);
      const nowHasWaybill = (await hasWaybillInput.count()) > 0 && await hasWaybillInput.isVisible().catch(() => false);
      if (!nowHasWaybill) {
        // иногда требуется подтверждение (кнопка "Выбрать")
        const chooseBtn = page.locator('button:has-text("Выбрать"), button:has-text("Применить")').first();
        if ((await chooseBtn.count()) > 0 && await chooseBtn.isVisible().catch(() => false)) {
          await chooseBtn.click().catch(() => {});
          await page.waitForTimeout(1500);
        }
      }
      console.log('[Taxcom] ✓ Выбран автопарк (профиль) по takskornId =', targetId);
      await takeScreenshot(page, '04_01_carpark_selected', env, `Автопарк выбран: ${targetId}`);
      return true;
    }
  }

  // 3) Попытка: select с профилями
  const select = page.locator('select#profile, select#profile_id, select[name*="profile"], select[name*="PROFILE"]').first();
  if ((await select.count()) > 0 && await select.isVisible().catch(() => false)) {
    await select.selectOption({ value: targetId }).catch(() => {});
    await page.waitForTimeout(1200);
    console.log('[Taxcom] ✓ Выбран автопарк (select) по takskornId =', targetId);
    await takeScreenshot(page, '04_01_carpark_selected', env, `Автопарк выбран: ${targetId}`);
    return true;
  }

  // Не смогли явно выбрать — продолжим, но это может привести к неверному автопарку.
  console.warn('[Taxcom] ⚠ Не удалось явно выбрать автопарк на Т1 по takskornId =', targetId, '— продолжу как есть.');
  return false;
}

/** Парсинг даты из SQLite: если нет таймзоны — считаем UTC (SQLite CURRENT_TIMESTAMP = UTC) */
function parseUtcDate(str) {
  if (!str) return new Date();
  const s = String(str).trim();
  // Если уже содержит Z, +, T — стандартный ISO, парсим как есть
  if (/[TZ+]/.test(s)) return new Date(s);
  // SQLite формат "YYYY-MM-DD HH:MM:SS" — добавляем Z для UTC
  return new Date(s.replace(' ', 'T') + 'Z');
}

/** Дата по МСК в формате ДД.ММ.ГГГГ */
function getMoscowDateString(date) {
  return date.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Время по МСК: HH:MM или HH:MM:SS */
function getMoscowTimeString(date, withSeconds = true) {
  return date.toLocaleTimeString('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {})
  });
}

/** Профиль браузера по роли (для многопоточных воркеров: диспетчер / медик / механик в разных окнах). */
function getUserDataDirForRole(env, role) {
  const r = (role || '').toLowerCase();
  if (r === 'dispatcher') return (env.DISPATCHER_USER_DATA_DIR || env.TAXCOM_USER_DATA_DIR || '').trim();
  if (r === 'medic') return (env.MEDIC_USER_DATA_DIR || env.TAXCOM_USER_DATA_DIR || '').trim();
  if (r === 'mechanic') return (env.MECHANIC_USER_DATA_DIR || env.TAXCOM_USER_DATA_DIR || '').trim();
  return (env.TAXCOM_USER_DATA_DIR || '').trim();
}

/**
 * Заполнение и подпись Т2 (медик) при уже открытой странице и залогиненном медике.
 * Используется из createEplInTaxcom (после релогина) и из fillAndSignT2Only (воркер медика).
 */
async function fillTitle2Core(page, baseUrl, env, item, mintransId, report) {
  const driver = item.driver || {};
  const staff = item.staff || {};
  const medic = staff.medic || {};
  const eplId = item.eplId;
  const createdAt = parseUtcDate(item.createdAt);
  if (createdAt) createdAt.setSeconds(0, 0);
  const tRelease = createdAt; // убытие (Т4)
  // Случайный разброс 2-5 минут для медосмотра
  const randomMedOffset = Math.floor(Math.random() * (5 - 2 + 1) + 2) * 60 * 1000; // 2-5 минут
  const tMed = new Date(tRelease.getTime() - 60 * 60 * 1000 - randomMedOffset); // медосмотр за ~60 минут до убытия ± 2-5 мин (Т2)

  console.log('[Taxcom] [Т2] Открываю страницу ЭПЛ...');
  await page.goto(`${baseUrl}/waybill/${mintransId}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  await takeScreenshot(page, 't2_epl_page', env, 'Страница ЭПЛ открыта (медик)');

  const errorElements = await page.locator('.error, .alert-danger, [class*="error"], [class*="Error"]').count();
  if (errorElements > 0) {
    const errorTexts = await page.locator('.error, .alert-danger, [class*="error"]').allTextContents().catch(() => []);
    console.warn('[Taxcom] ⚠ Обнаружены ошибки на странице ЭПЛ:', errorTexts.join('; '));
    await takeScreenshot(page, 't2_error_on_epl_page', env, 'Ошибка на странице ЭПЛ');
  }

  console.log('[Taxcom] [Т2] Ищу кнопку "Заполнить" для Т2...');
  const fillT2Buttons = [
    page.locator('a[href*="/2/"]').filter({ hasText: 'Заполнить' }),
    page.locator('button[onclick*="2"]').filter({ hasText: 'Заполнить' }),
    page.locator(`a[href*="/waybill/${mintransId}/2/"]`)
  ];
  let t2FormOpened = false;
  for (const btn of fillT2Buttons) {
    if ((await btn.count()) > 0 && await btn.isVisible().catch(() => false)) {
      await btn.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await btn.click();
      await page.waitForTimeout(2000);
      await takeScreenshot(page, 't2_forma_opened', env, 'Форма Т2 открыта через кнопку');
      t2FormOpened = true;
      break;
    }
  }
  if (!t2FormOpened) {
    await page.goto(`${baseUrl}/waybill/${mintransId}/2/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
  }
  await takeScreenshot(page, 't2_forma', env, 'Форма Т2 открыта');

  const t2ErrorElements = await page.locator('.error, .alert-danger, [class*="error"], [class*="Error"], [class*="TypeError"]').count();
  if (t2ErrorElements > 0) {
    const fullPageText = await page.textContent('body').catch(() => '');
    if (fullPageText.includes('TypeError') || fullPageText.includes('getMedicalId')) {
      console.error('[Taxcom] ⛔ КРИТИЧЕСКАЯ ОШИБКА: Медик не привязан к автопарку в системе Такском');
      await takeScreenshot(page, 't2_critical_error', env, 'Критическая ошибка на странице Т2');
      return false;
    }
  }

  const medicParts = (medic.fullName || '').trim().split(/\s+/);
  const medicLastName = medic.lastName || medicParts[0] || '';
  const medicName = medic.firstName || medicParts[1] || '';
  const medicSecondName = medic.secondName || medicParts[2] || '';
  const medicPosition = medic.position || 'Медицинский работник';

  console.log('[Taxcom] [Т2] Заполняю данные медика...');
  const medicLastNameField = page.locator('#MEDIC_LAST_NAME, input[name="MEDIC_LAST_NAME"]').first();
  if ((await medicLastNameField.count()) > 0 && medicLastName) await medicLastNameField.fill(medicLastName);
  await page.waitForTimeout(300);
  const medicNameField = page.locator('#MEDIC_NAME, input[name="MEDIC_NAME"]').first();
  if ((await medicNameField.count()) > 0 && medicName) await medicNameField.fill(medicName);
  await page.waitForTimeout(300);
  const medicSecondNameField = page.locator('#MEDIC_SECOND_NAME, input[name="MEDIC_SECOND_NAME"]').first();
  if ((await medicSecondNameField.count()) > 0 && medicSecondName) await medicSecondNameField.fill(medicSecondName);
  await page.waitForTimeout(300);
  const medicPositionField = page.locator('#job_med, #MEDIC_POSITION, input[name="MEDIC_POSITION"]').first();
  if ((await medicPositionField.count()) > 0 && medicPosition) await medicPositionField.fill(medicPosition);
  await page.waitForTimeout(300);

  const medExamDate = getMoscowDateString(tMed);
  const medExamTime = getMoscowTimeString(tMed, false);
  const medExamTimeWithSec = getMoscowTimeString(tMed, true);
  const medDateSelectors = ['#date_pr', 'input[name="MEDIC_RESULT_DATE"]', '#date_med', 'input[name="MEDIC_EXAMINATION_DATE"]', 'input[type="date"]'];
  for (const sel of medDateSelectors) {
    const field = page.locator(sel).first();
    if ((await field.count()) > 0 && await field.isVisible().catch(() => false)) {
      await field.fill(medExamDate);
      await page.waitForTimeout(300);
      break;
    }
  }
  const medTimeSelectors = ['#time_pr', 'input[name="MEDIC_RESULT_TIME"]', '#time_med', 'input[name="MEDIC_EXAMINATION_TIME"]', 'input[type="time"]'];
  for (const sel of medTimeSelectors) {
    const field = page.locator(sel).first();
    if ((await field.count()) > 0 && await field.isVisible().catch(() => false)) {
      const step = await field.getAttribute('step').catch(() => null);
      await field.fill(step ? medExamTimeWithSec : medExamTime);
      await page.waitForTimeout(300);
      break;
    }
  }
  const medResultSelectors = ['select[name="MEDIC_RESULT"]', '#MEDIC_RESULT', 'select[name*="MEDIC_RESULT"]'];
  for (const sel of medResultSelectors) {
    const field = page.locator(sel).first();
    if ((await field.count()) > 0 && await field.isVisible().catch(() => false)) {
      await field.selectOption('ALLOWED').catch(() => field.selectOption('1').catch(() => {}));
      await page.waitForTimeout(300);
      break;
    }
  }

  await takeScreenshot(page, 't2_zapolnen', env, 'Т2 (медик) заполнен');
  if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
    const action = await waitForUserConfirmation('Т2 заполнен. Подписать?', env);
    if (action === 'back') return false;
  }
  console.log('[Taxcom] Подписываю Т2 (кнопка «Подписать»)...');
  await closeModalDialogs(page, env);
  const signBtnT2 = page.locator('#sign_btn').first();
  if ((await signBtnT2.count()) > 0 && await signBtnT2.isVisible().catch(() => false)) {
    const isDisabled = await signBtnT2.isDisabled().catch(() => false);
    if (isDisabled) {
      await page.waitForTimeout(3000);
      const stillDisabled = await signBtnT2.isDisabled().catch(() => true);
      if (stillDisabled) {
        console.log('[Taxcom] [Т2] Кнопка «Подписать» неактивна — Т2 уже подписан, пропускаю подпись.');
        await report(eplId, 't2', 'signed', mintransId);
        console.log('[ЭПЛ] Подписал Т2 (медик).');
        return true;
      }
    }
    if (!(await signBtnT2.isDisabled().catch(() => true))) {
      await signBtnT2.click({ timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(5000);
    }
  } else {
    const t2Signed = await signTitle(page, 'Т2', 'medic', env, baseUrl, mintransId);
    if (t2Signed) await page.waitForTimeout(5000);
  }
  await report(eplId, 't2', 'signed', mintransId);
  console.log('[ЭПЛ] Подписал Т2 (медик).');
  return true;
}

/**
 * @param {Object} item - Данные ЭПЛ
 * @param {Object} env - Переменные окружения
 * @param {Object} [reuse] - { context, page } — переиспользовать браузер (если закрыт — запустим заново)
 * @param {Function} [reportTitulProgress] - (eplId, titul, status, mintransId?) — отчёт прогресса титулов для resume при сбое
 */
async function createEplInTaxcom(item, env, reuse, reportTitulProgress) {
  const noop = () => {};
  const report = reportTitulProgress || noop;
  const eplId = item.eplId;
  const startFromT3 = !!(
    item.mintransId &&
    item.titulStatus &&
    item.titulStatus.t1 === 'signed' &&
    item.titulStatus.t2 === 'signed'
  );
  const driver = item.driver || {};
  const staff = item.staff || {};
  const waybillNumber = item.waybillNumber || '';
  const startOdometer = item.startOdometer ?? 0;
  const createdAt = parseUtcDate(item.createdAt);
  if (createdAt) createdAt.setSeconds(0, 0);
  const dateFrom = getMoscowDateString(createdAt);
  const nextDay = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);
  const dateTo = getMoscowDateString(nextDay);
  const tRelease = createdAt; // убытие (Т4)
  // Случайный разброс 2-5 минут для каждого пункта
  const randomMedOffset = Math.floor(Math.random() * (5 - 2 + 1) + 2) * 60 * 1000; // 2-5 минут
  const randomTechOffset = Math.floor(Math.random() * (5 - 2 + 1) + 2) * 60 * 1000; // 2-5 минут
  const randomReleaseOffset = Math.floor(Math.random() * (5 - 2 + 1) + 2) * 60 * 1000; // 2-5 минут
  const tMed = new Date(tRelease.getTime() - 60 * 60 * 1000 - randomMedOffset); // медосмотр за ~60 минут до убытия ± 2-5 мин (Т2)
  const tTech = new Date(tRelease.getTime() - 55 * 60 * 1000 - randomTechOffset); // техконтроль за ~55 минут до убытия ± 2-5 мин (Т3)
  const tReleaseLine = new Date(tRelease.getTime() - 49 * 60 * 1000 - randomReleaseOffset); // выпуск на линию за ~49 минут до убытия ± 2-5 мин (Т3)
  const { chromium } = getPlaywright();
  if (!chromium) {
    console.warn('[Taxcom] playwright-core не установлен. Выполни в signer-client: npm install playwright-core');
    return null;
  }

  // Если в БД уже записано, что Т1 ПОДПИСАН, но при этом нет mintransId,
  // значит состояние неконсистентное (ЭПЛ уже существует в Такском с этим
  // номером, но backend не получил его ID). В таком случае нельзя заново
  // создавать S0/T1 с тем же WB-номером — Такском начнёт ругаться на дубликат.
  // Для безопасности просто пропускаем такую заявку, чтобы не плодить мусор.
  if (
    item.titulStatus &&
    item.titulStatus.t1 === 'signed' &&
    (!item.mintransId || String(item.mintransId).trim() === '')
  ) {
    console.warn(
      `[Taxcom] ЭПЛ eplId=${eplId}, waybill=${waybillNumber}: Т1 уже signed в БД, но mintransId отсутствует. ` +
      'Пропускаю создание, чтобы не плодить дубликат S0/T1. Нужно вручную синхронизировать mintransId или очистить титулы.'
    );
    return null;
  }

  const baseUrl = (env.TAKSKOM_URL || 'https://epl.taxcom.ru').replace(/\/$/, '');
  const dispPhone = env.TAKSKOM_DISPATCHER_PHONE || env.TAKSKOM_LOGIN_PHONE || '';
  const dispPass = env.TAKSKOM_DISPATCHER_PASSWORD || env.TAKSKOM_LOGIN_PASSWORD || '';
  let browserPath = (env.CHROMIUM_GOST_PATH || '').trim();
  // Можно явно выбрать Яндекс.Браузер (путь подставится сам, если не задан CHROMIUM_GOST_PATH)
  const useYandex = env.USE_YANDEX_BROWSER === '1' || env.USE_YANDEX_BROWSER === 'true';
  if (useYandex && !browserPath) {
    const localAppData = process.env.LOCALAPPDATA || process.env.USERPROFILE || '';
    const yandexExe = localAppData ? path.join(localAppData, 'Yandex', 'YandexBrowser', 'Application', 'browser.exe') : '';
    if (yandexExe && fs.existsSync(yandexExe)) {
      browserPath = yandexExe;
      console.log('[Taxcom] Используется Яндекс.Браузер:', browserPath);
    } else {
      console.warn('[Taxcom] USE_YANDEX_BROWSER=1, но browser.exe не найден по пути:', yandexExe || '(нет LOCALAPPDATA)');
    }
  }

  if (!dispPhone || !dispPass) {
    console.warn('[Taxcom] Не заданы TAKSKOM_DISPATCHER_PHONE и TAKSKOM_DISPATCHER_PASSWORD в .env');
    return null;
  }

  // Профиль: по роли (диспетчер/механик) для воркеров или явный TAXCOM_USER_DATA_DIR, иначе авто из CHROMIUM_GOST_PATH
  const effectiveRole = startFromT3 ? 'mechanic' : 'dispatcher';
  let userDataDir = getUserDataDirForRole(env, effectiveRole);
  if (!userDataDir && browserPath) {
    const exeDir = path.dirname(browserPath);
    const pathLower = browserPath.toLowerCase();
    const localAppData = process.env.LOCALAPPDATA || process.env.USERPROFILE || '';
    // Яндекс.Браузер — профиль в AppData
    if (pathLower.includes('yandex')) {
      const yandexUserData = localAppData ? path.join(localAppData, 'Yandex', 'YandexBrowser', 'User Data') : '';
      if (yandexUserData && fs.existsSync(yandexUserData)) {
        userDataDir = yandexUserData;
        console.log('[Taxcom] Используется профиль Яндекс.Браузера (расширения, КриптоПро):', userDataDir);
      }
    }
    if (!userDataDir) {
      // Папка ГОСТ/портальный: User Data рядом с exe или на уровень выше
      const nextToExe = path.join(exeDir, 'User Data');
      const oneLevelUp = path.join(path.dirname(exeDir), 'User Data');
      if (fs.existsSync(nextToExe)) {
        userDataDir = nextToExe;
        console.log('[Taxcom] Используется профиль из папки браузера (расширения, КриптоПро):', userDataDir);
      } else if (fs.existsSync(oneLevelUp)) {
        userDataDir = oneLevelUp;
        console.log('[Taxcom] Используется профиль из папки браузера (расширения, КриптоПро):', userDataDir);
      } else if (exeDir.includes('Chromium') && localAppData) {
        userDataDir = path.join(localAppData, 'Chromium', 'User Data');
        console.log('[Taxcom] Используется профиль Chromium по умолчанию:', userDataDir);
      }
    }
  }
  if (userDataDir && (env.TAXCOM_USER_DATA_DIR || '').trim() === userDataDir) {
    console.log('[Taxcom] Используется профиль (TAXCOM_USER_DATA_DIR):', userDataDir);
  }
  if (!userDataDir) {
    console.warn('[Taxcom] ⚠ Профиль не задан — браузер без расширений. Укажи CHROMIUM_GOST_PATH на папку с ГОСТ-браузером (где есть User Data и КриптоПро) или задай TAXCOM_USER_DATA_DIR.');
  }
  const launchOptions = { headless: userDataDir ? false : (env.TAXCOM_HEADLESS !== '0') };
  if (browserPath) launchOptions.executablePath = browserPath;
  // Логируем режим браузера для отладки
  if (launchOptions.headless) {
    console.log('[Taxcom] Браузер запущен в headless режиме (скрыт). Для отладки установи TAXCOM_HEADLESS=0 в .env');
  } else {
    console.log('[Taxcom] Браузер запущен в видимом режиме (окно будет показано)');
  }

  clearScreenshotsDir(env);

  let browser = null;
  let persistentContext = null;
  let context;
  let page;
  let useReuse = !!(reuse && reuse.context && reuse.page);

  if (useReuse) {
    context = reuse.context;
    page = reuse.page;
    try {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 8000 });
    } catch (e) {
      if (/Target closed|browser has been closed|Context closed|Target page, context or browser has been closed/i.test(String(e.message))) {
        console.log('[Taxcom] Браузер закрыт — запускаю заново.');
        useReuse = false;
      } else {
        throw e;
      }
    }
    if (useReuse) {
      // Универсальный воркер: по 1 браузеру на роль, уже залогинен — релогин не нужен
      if (env.UNIVERSAL_WORKER !== '1') {
        await logout(page, baseUrl, env);
        if (startFromT3) {
          const mechanicPhone = env.TAKSKOM_MECHANIC_PHONE || '';
          const mechanicPass = env.TAKSKOM_MECHANIC_PASSWORD || '';
          if (!mechanicPhone || !mechanicPass) {
            console.warn('[Taxcom] Resume Т3: не заданы TAKSKOM_MECHANIC_PHONE/PASSWORD.');
            return null;
          }
          console.log('[Taxcom] Переиспользую браузер — логин механика (продолжение с Т3)...');
          if (!(await login(page, baseUrl, mechanicPhone, mechanicPass, env))) {
            console.warn('[Taxcom] Вход механика не удался.');
            return null;
          }
          console.log('[Taxcom] Механик: вход OK (resume)');
        } else {
          console.log('[Taxcom] Переиспользую браузер — логин диспетчера...');
          if (!(await login(page, baseUrl, dispPhone, dispPass, env))) {
            console.warn('[Taxcom] Релогин диспетчера не удался.');
            return null;
          }
          console.log('[Taxcom] Диспетчер: вход OK (переиспользование)');
        }
      } else {
        if (startFromT3) {
          console.log('[Taxcom] Универсальный воркер: браузер механика уже залогинен.');
        } else {
          console.log('[Taxcom] Универсальный воркер: браузер диспетчера уже залогинен.');
          // На всякий случай проверяем, не оказались ли мы на странице логина (сессия могла истечь)
          const loginTab = page.locator('text=По логину').first();
          const loginBtn = page.locator('button:has-text("Войти"), input[type="submit"][value="Войти"]').first();
          const loginInput = page.locator('input[name="USER_LOGIN"], input[name*="login"]').first();
          const [loginTabVisible, loginBtnVisible, loginInputVisible] = await Promise.all([
            loginTab.isVisible().catch(() => false),
            loginBtn.isVisible().catch(() => false),
            loginInput.isVisible().catch(() => false)
          ]);
          if (loginTabVisible || loginBtnVisible || loginInputVisible) {
            console.log('[Taxcom] Универсальный воркер: обнаружена страница логина вместо кабинета — выполняю повторный вход диспетчера...');
            if (!(await login(page, baseUrl, dispPhone, dispPass, env))) {
              console.warn('[Taxcom] Универсальный воркер: повторный вход диспетчера не удался.', SCREENSHOTS_ERR_HINT);
              return null;
            }
            console.log('[Taxcom] Универсальный воркер: повторный вход диспетчера OK.');
          }
        }
      }
      page.setDefaultTimeout(60000);
    }
  }

  try {
    if (!useReuse) {
    if (userDataDir) {
      console.log('[Taxcom] Запускаю браузер с профилем (расширения, КриптоПро)...');
      if ((userDataDir.includes('Chromium') || userDataDir.includes('Yandex')) && userDataDir.includes('User Data')) {
        console.log('[Taxcom] Подсказка: закрой этот браузер (Chromium/Яндекс), если он открыт — иначе профиль занят.');
      }
      // Без ignoreDefaultArgs Playwright передаёт --disable-extensions → расширения (КриптоПро) не грузятся, браузер может падать
      persistentContext = await chromium.launchPersistentContext(userDataDir, {
        locale: 'ru-RU',
        headless: false,
        channel: browserPath ? undefined : 'chrome',
        executablePath: browserPath || undefined,
        ignoreDefaultArgs: ['--disable-extensions']
      });
      context = persistentContext;
      page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    } else {
      console.log('[Taxcom] Запускаю браузер (Playwright)...');
      browser = await chromium.launch(launchOptions);
      context = await browser.newContext({ locale: 'ru-RU' });
      page = await context.newPage();
    }
    page.setDefaultTimeout(60000);

    if (startFromT3) {
      const mechanicPhone = env.TAKSKOM_MECHANIC_PHONE || '';
      const mechanicPass = env.TAKSKOM_MECHANIC_PASSWORD || '';
      if (!mechanicPhone || !mechanicPass) {
        console.warn('[Taxcom] Resume Т3: не заданы TAKSKOM_MECHANIC_PHONE/PASSWORD.');
        if (browser) await browser.close(); else if (persistentContext) await persistentContext.close();
        return null;
      }
      console.log('[Taxcom] Логин механика (продолжение с Т3)...');
      if (!(await login(page, baseUrl, mechanicPhone, mechanicPass, env))) {
        console.warn('[Taxcom] Вход механика не удался.');
        if (browser) await browser.close(); else if (persistentContext) await persistentContext.close();
        return null;
      }
      console.log('[Taxcom] Механик: вход OK');
    } else {
      // ——— Диспетчер: логин ———
      console.log('[Taxcom] Логин диспетчера...');
      if (!(await login(page, baseUrl, dispPhone, dispPass, env))) {
        console.warn('[Taxcom] Вход диспетчера не удался. Проверь логин/пароль.', SCREENSHOTS_ERR_HINT);
        const keepOpen = env.TAXCOM_KEEP_BROWSER_OPEN === '1' || env.TAXCOM_KEEP_BROWSER_OPEN === 'true';
        if (keepOpen) console.log('[Taxcom] TAXCOM_KEEP_BROWSER_OPEN=1 — браузер не закрыт.');
        else if (browser) await browser.close(); else if (persistentContext) await persistentContext.close();
        return null;
      }
      await takeScreenshot(page, '03_dispatcher_posle_vhoda', env, 'Кабинет после входа диспетчера');
      console.log('[Taxcom] Диспетчер: вход OK');
    }
    } // end if (!useReuse)

    let mintransId = startFromT3 ? String(item.mintransId) : null;
    if (startFromT3) {
      console.log('[ЭПЛ] Продолжение с Т3, mintransId:', mintransId);
    }

    if (!startFromT3) {
    // ——— Кнопка/ссылка «Создать путевой» или переход по URL формы создания ———
    console.log('[Taxcom] Ищу кнопку или ссылку создания путевого...');
    const createSelectors = [
      () => page.locator('a[href*="/waybill/new"], a[href*="waybill/new"]').first(),
      () => page.getByRole('link', { name: /создать|путевой|добавить.*пл|новый.*путевой|эпл/i }).first(),
      () => page.getByRole('button', { name: /создать|путевой|добавить|новый/i }).first(),
      () => page.locator('a[href*="create"], a[href*="add"]').first(),
      () => page.locator('a[href*="waybill"]').first()
    ];
    let createFormOpened = false;
    for (const getSel of createSelectors) {
      const el = getSel();
      if ((await el.count()) > 0 && await el.isVisible().catch(() => false)) {
        await el.scrollIntoViewIfNeeded();
        await el.click();
        createFormOpened = true;
        console.log('[Taxcom] Открыл форму создания по кнопке/ссылке');
        break;
      }
    }
    if (!createFormOpened) {
      console.log('[Taxcom] Пробую страницу списка путевых, затем кнопку создания...');
      try {
        await page.goto(`${baseUrl}/waybill/`, { waitUntil: 'domcontentloaded', timeout: 12000 });
        await page.waitForTimeout(2000);
        const linkNew = page.locator('a[href*="/waybill/new"], a[href*="waybill/new"]').first();
        if ((await linkNew.count()) > 0 && await linkNew.isVisible().catch(() => false)) {
          await linkNew.click();
          await page.waitForTimeout(2000);
          createFormOpened = true;
        }
        if (!createFormOpened) {
          const anyCreate = page.getByRole('link', { name: /создать|новый|добавить/i }).first();
          if ((await anyCreate.count()) > 0 && await anyCreate.isVisible().catch(() => false)) {
            await anyCreate.click();
            await page.waitForTimeout(2000);
            createFormOpened = true;
          }
        }
      } catch (e) {
        console.warn('[Taxcom] Страница списка waybill:', e.message);
      }
    }
    if (!createFormOpened) {
      console.log('[Taxcom] Переход по прямой ссылке на форму создания ЭПЛ...');
      for (const path of ['/waybill/new/', '/waybill/new', '/waybill/create/']) {
        try {
          await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await page.waitForTimeout(2500);
          const urlNow = page.url();
          const hasForm = urlNow.includes('waybill') && (urlNow.includes('new') || urlNow.includes('create'));
          const formField = page.locator('input[placeholder*="номер"], input[placeholder*="путевой"], #waybill_date, #save_btn').first();
          if (hasForm || ((await formField.count()) > 0 && await formField.isVisible().catch(() => false))) {
            createFormOpened = true;
            console.log('[Taxcom] Форма создания открыта по URL:', path);
            break;
          }
        } catch (e) {
          console.warn('[Taxcom] Переход на', path, ':', e.message);
        }
      }
    }
    if (!createFormOpened) {
      console.warn('[Taxcom] Не найдена кнопка/ссылка создания путевого и не удалось открыть форму по URL.', SCREENSHOTS_ERR_HINT);
    }
    await page.waitForTimeout(2000);
    await takeScreenshot(page, '04_forma_sozdaniya_epl_otkryta', env, 'Форма создания ЭПЛ открыта');
    console.log('[ЭПЛ] Заполняю Т1 (форма)...');

    const driver = item.driver || {};
    const staff = item.staff || {};
    const waybillNumber = item.waybillNumber || '';
    const startOdometer = item.startOdometer ?? 0;
    const parkName = driver.parkName || '';

    // Перед заполнением Т1 — жёстко выбираем нужный автопарк (профиль) по привязке в настройках сайта.
    // Иначе Такском может подставить "дефолтный" парк из профиля аккаунта.
    await ensureCarParkSelectedOnT1(page, driver.takskornId, parkName, env);

    // Дата/время: считаем, что момент запроса ЭПЛ водителем = время выезда на линию.
    // Всё остальное (медик, механик) размазываем чуть раньше, чтобы выглядело «как в жизни».
    const createdAt = parseUtcDate(item.createdAt);
    // Округляем вниз до минут, чтобы везде были красивые значения HH:MM
    createdAt.setSeconds(0, 0);
    const dateFrom = getMoscowDateString(createdAt); // ДД.ММ.ГГГГ по МСК
    const nextDay = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);
    const dateTo = getMoscowDateString(nextDay);
    console.log(`[Taxcom] createdAt из БД: "${item.createdAt}" → parsed UTC: ${createdAt.toISOString()} → МСК: ${getMoscowTimeString(createdAt, true)}`);
    console.log(`[Taxcom] Дата "от" по МСК (создание водителем): ${dateFrom}, время запроса ЭПЛ (выезд на линию): ${getMoscowTimeString(createdAt, true)}`);
    // Срок действия по времени ЗАЯВКИ (каждой своей): до 12:00 МСК — один день (да), одна дата; с 12:00 МСК — два дня (нет), дата начала + дата окончания
    const moscowHour = parseInt(getMoscowTimeString(createdAt, false).slice(0, 2), 10);
    const useTwoDates = moscowHour >= 12;
    console.log(`[Taxcom] Час заявки по МСК: ${moscowHour} → признак "один день" = ${useTwoDates ? 'нет' : 'да'}, даты: ${useTwoDates ? `${dateFrom} — ${dateTo}` : dateFrom}`);
    const dispatcherName = staff.dispatcher?.fullName || '';
    const parts = (driver.fullName || '').trim().split(/\s+/);
    const lastName = driver.lastName || parts[0] || '';
    // Для каждой заявки — свои данные: водитель, авто (парк/владелец из карточки авто)
    const ownerName = (driver.owner && driver.owner.name) ? driver.owner.name : '(не указан)';
    console.log(`[Taxcom] Данные этой заявки: водитель ${driver.fullName || '—'}, ТС ${driver.brand || ''} ${driver.model || ''} ${driver.regNumber || '—'}, владелец: ${ownerName}, парк: ${parkName || '—'}`);
    const firstName = driver.firstName || parts[1] || '';
    const patronymic = driver.secondName != null && driver.secondName !== '' ? driver.secondName : (parts[2] || '-');
    const licenseDateFormatted = driver.licenseDate
      ? driver.licenseDate.replace(/^(\d{4})-(\d{2})-(\d{2}).*/, '$3.$2.$1')
      : '';

    const fill = async (placeholders, value, logLabel, scrollTo = true, envForDebug = null) => {
      if (value == null || value === '') {
        if (logLabel) console.log('[Taxcom] Пропускаю:', logLabel, '(пустое значение)');
        return false;
      }
      const str = String(value).trim();
      if (!str) {
        if (logLabel) console.log('[Taxcom] Пропускаю:', logLabel, '(пустая строка)');
        return false;
      }
      const noSearch = ':not([id="searchValueProfile"]):not([placeholder*="Поиск"]):not([placeholder*="Выберите транспортное"]):not([placeholder*="Выберите водителя"])';
      const selectors = Array.isArray(placeholders) ? placeholders : [placeholders];
      for (const p of selectors) {
        const clean = p.replace(/\s/g, '');
        const sel = `input${noSearch}[placeholder*="${p}"], input${noSearch}[name*="${clean}"], input${noSearch}[id*="${clean}"]`;
        const el = page.locator(sel).first();
        const count = await el.count();
        if (count > 0) {
          const visible = await el.isVisible().catch(() => false);
          if (!visible) {
            console.warn('[Taxcom] Поле найдено, но невидимо:', logLabel, `(селектор: ${p})`);
            continue;
          }
          if (scrollTo) {
            await el.scrollIntoViewIfNeeded();
            await page.waitForTimeout(200);
          }
          await el.fill(str);
          if (logLabel) console.log('[Taxcom] ✓ Заполнено:', logLabel, '=', str);
          await page.waitForTimeout(300);
          // Скриншот и подтверждение в режиме отладки
          const debugEnv = envForDebug || env;
          if (debugEnv && (debugEnv.DEBUG_STEP_BY_STEP === '1' || debugEnv.DEBUG_STEP_BY_STEP === 'true')) {
            // Подсвечиваем заполненное поле
            await highlightElement(page, el, '#00ff00', 2000);
            await page.waitForTimeout(500); // Даём время подсветке появиться
            const stepNum = String(Date.now()).slice(-6);
            await takeScreenshot(page, `debug_${stepNum}_${logLabel.replace(/[^a-zа-я0-9]/gi, '_')}`, debugEnv, `DEBUG: ${logLabel} = ${str}`);
            const action = await waitForUserConfirmation(`Заполнено поле "${logLabel}"`, debugEnv);
            if (action === 'back') {
              // Очищаем поле и возвращаемся
              await el.fill('');
              return 'back';
            } else if (action === 'skip') {
              return 'skip';
            }
          }
          return true;
        }
      }
      // Попытка найти по label (текст рядом с полем) - более точный поиск
      for (const p of selectors) {
        try {
          // Ищем label с точным текстом или содержащим текст
          const labelSelectors = [
            `label:has-text("${p}")`,
            `label:has-text("${p}") input`,
            `label:has-text("${p}") + input`,
            `label:has-text("${p}") ~ input`,
            `[for*="${p}"]`,
            `label[for*="${clean}"]`,
            `div:has-text("${p}") input`,
            `span:has-text("${p}") + input`,
            `td:has-text("${p}") + td input`,
            `th:has-text("${p}") + td input`
          ];
          
          for (const labelSel of labelSelectors) {
            try {
              const labelEl = page.locator(labelSel).first();
              const labelCount = await labelEl.count();
              if (labelCount > 0) {
                // Если это уже input
                if (labelSel.includes(' input')) {
                  const visible = await labelEl.isVisible().catch(() => false);
                  if (visible) {
                    if (scrollTo) {
                      await labelEl.scrollIntoViewIfNeeded();
                      await page.waitForTimeout(200);
                    }
                    await labelEl.fill(str);
                    if (logLabel) console.log('[Taxcom] ✓ Заполнено (через label-селектор):', logLabel, '=', str);
                    await page.waitForTimeout(300);
                    if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
                      const stepNum = String(Date.now()).slice(-6);
                      await takeScreenshot(page, `debug_${stepNum}_${logLabel.replace(/[^a-zа-я0-9]/gi, '_')}`, env, `DEBUG: ${logLabel} = ${str}`);
                      await waitForUserConfirmation(`Заполнено поле "${logLabel}"`, env);
                    }
                    return true;
                  }
                } else {
                  // Это label, ищем связанный input
                  const forAttr = await labelEl.getAttribute('for').catch(() => '');
                  if (forAttr) {
                    const inputByFor = page.locator(`input#${forAttr}, input[name="${forAttr}"]`).first();
                    const inputCount = await inputByFor.count();
                    if (inputCount > 0) {
                      const visible = await inputByFor.isVisible().catch(() => false);
                      if (visible) {
                        if (scrollTo) {
                          await inputByFor.scrollIntoViewIfNeeded();
                          await page.waitForTimeout(200);
                        }
                        await inputByFor.fill(str);
                        if (logLabel) console.log('[Taxcom] ✓ Заполнено (через label for):', logLabel, '=', str);
                        await page.waitForTimeout(300);
                        const debugEnv = envForDebug || env;
                        if (debugEnv && (debugEnv.DEBUG_STEP_BY_STEP === '1' || debugEnv.DEBUG_STEP_BY_STEP === 'true')) {
                          await highlightElement(page, inputByFor, '#00ff00', 2000);
                          await page.waitForTimeout(500);
                          const stepNum = String(Date.now()).slice(-6);
                          await takeScreenshot(page, `debug_${stepNum}_${logLabel.replace(/[^a-zа-я0-9]/gi, '_')}`, debugEnv, `DEBUG: ${logLabel} = ${str}`);
                          const action = await waitForUserConfirmation(`Заполнено поле "${logLabel}"`, debugEnv);
                          if (action === 'back') {
                            await inputByFor.fill('');
                            return 'back';
                          } else if (action === 'skip') {
                            return 'skip';
                          }
                        }
                        return true;
                      }
                    }
                  }
                  // Ищем input рядом с label (родитель, следующий элемент, и т.д.)
                  const nearbyInputs = [
                    labelEl.locator('..').locator('input').first(),
                    labelEl.locator('../..').locator('input').first(),
                    labelEl.locator('following-sibling::input').first(),
                    page.locator(`label:has-text("${p}") + input`).first(),
                    page.locator(`label:has-text("${p}") ~ input`).first()
                  ];
                  for (const nearbyInput of nearbyInputs) {
                    const nearCount = await nearbyInput.count();
                    if (nearCount > 0) {
                      const visible = await nearbyInput.isVisible().catch(() => false);
                      if (visible) {
                        if (scrollTo) {
                          await nearbyInput.scrollIntoViewIfNeeded();
                          await page.waitForTimeout(200);
                        }
                        await nearbyInput.fill(str);
                        if (logLabel) console.log('[Taxcom] ✓ Заполнено (рядом с label):', logLabel, '=', str);
                        await page.waitForTimeout(300);
                        const debugEnv = envForDebug || env;
                        if (debugEnv && (debugEnv.DEBUG_STEP_BY_STEP === '1' || debugEnv.DEBUG_STEP_BY_STEP === 'true')) {
                          await highlightElement(page, nearbyInput, '#00ff00', 2000);
                          await page.waitForTimeout(500);
                          const stepNum = String(Date.now()).slice(-6);
                          await takeScreenshot(page, `debug_${stepNum}_${logLabel.replace(/[^a-zа-я0-9]/gi, '_')}`, debugEnv, `DEBUG: ${logLabel} = ${str}`);
                          const action = await waitForUserConfirmation(`Заполнено поле "${logLabel}"`, debugEnv);
                          if (action === 'back') {
                            await nearbyInput.fill('');
                            return 'back';
                          } else if (action === 'skip') {
                            return 'skip';
                          }
                        }
                        return true;
                      }
                    }
                  }
                }
              }
            } catch (_) {}
          }
        } catch (_) {}
      }
      console.warn('[Taxcom] Поле не найдено:', logLabel, `(пробовал: ${selectors.join(', ')})`);
      return false;
    };

    console.log('[Taxcom] Заполняю данные ЭПЛ последовательно, шаг за шагом...');
    
    // ШАГ 1: Номер путевого
    console.log('[Taxcom] [ШАГ 1] Заполняю номер путевого...');
    const step1Result = await fill(['номер путевого', 'путевой лист', 'waybill', 'waybillNumber'], waybillNumber, 'номер путевого', true, env);
    if (step1Result === 'back' || step1Result === 'skip') {
      console.log('[DEBUG] ШАГ 1 пропущен или откачен');
    }
    await takeScreenshot(page, '05_01_nomer_zapolnen', env, 'Номер путевого заполнен');
    const step1Action = await waitForUserConfirmation('ШАГ 1: Номер путевого заполнен', env);
    if (step1Action === 'back' && step1Result !== false) {
      // Откатываем заполнение номера
      const numField = page.locator('input[placeholder*="номер путевого"], input[placeholder*="путевой"]').first();
      if ((await numField.count()) > 0) await numField.fill('');
    }
    
    // ШАГ 2: Признак "один день" (если нужно)
    console.log('[Taxcom] [ШАГ 2] Устанавливаю признак формирования путевого листа на один день...');
    if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
      await takeScreenshot(page, 'debug_step2_before', env, 'DEBUG: Перед установкой признака "один день"');
    }
    const oneDayValue = useTwoDates ? 'нет' : 'да';
    
    // Ищем селектор по ID (самый надёжный способ)
    let oneDaySelect = page.locator('#day_waybill_feature').first();
    if ((await oneDaySelect.count()) === 0) {
      // Запасной вариант по name
      oneDaySelect = page.locator('select[name="DAY_WAYBILL_FEATURE"]').first();
    }
    if ((await oneDaySelect.count()) === 0) {
      // Запасной вариант по label
      const label = page.locator('label[for="day_waybill_feature"]').first();
      if ((await label.count()) > 0) {
        oneDaySelect = label.locator('..').locator('select').first();
      }
    }
    
    if (oneDaySelect && (await oneDaySelect.count()) > 0) {
      await oneDaySelect.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      try {
        // Пробуем разные способы выбора
        await oneDaySelect.selectOption({ label: new RegExp(oneDayValue, 'i') }).catch(async () => {
          // Если не сработало по label, пробуем по value (1 = да, 2 = нет)
          const valueToSelect = oneDayValue === 'да' ? '1' : '2';
          await oneDaySelect.selectOption({ value: valueToSelect }).catch(async () => {
            // Если не сработало по value, пробуем по индексу
            const options = await oneDaySelect.locator('option').allTextContents();
            const index = options.findIndex(opt => opt.toLowerCase().includes(oneDayValue.toLowerCase()));
            if (index >= 0) {
              await oneDaySelect.selectOption({ index });
            } else {
              // Последняя попытка - клик и выбор опции
              await oneDaySelect.click();
              await page.waitForTimeout(300);
              const option = page.locator(`option:has-text("${oneDayValue}"), option:text-is("${oneDayValue}")`).first();
              if ((await option.count()) > 0) {
                await option.click();
              }
            }
          });
        });
        // Принудительно вызываем change через evaluate — Bitrix может слушать jQuery/BX-событие
        await oneDaySelect.dispatchEvent('change');
        await page.evaluate((val) => {
          const sel = document.getElementById('day_waybill_feature') || document.querySelector('select[name="DAY_WAYBILL_FEATURE"]');
          if (sel) {
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            sel.dispatchEvent(new Event('input', { bubbles: true }));
            if (typeof window.BX !== 'undefined' && window.BX.fireEvent) {
              try { window.BX.fireEvent(sel, 'change'); } catch(_) {}
            }
            if (typeof window.$ !== 'undefined' || typeof window.jQuery !== 'undefined') {
              try { (window.$ || window.jQuery)(sel).trigger('change'); } catch(_) {}
            }
          }
        }, oneDayValue);
        console.log(`[Taxcom] ✓ Установлен признак "один день" = "${oneDayValue}"`);
        if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
          await highlightElement(page, oneDaySelect, '#00ff00', 2000);
          await page.waitForTimeout(500);
        }
        await page.waitForTimeout(1000);
        if (useTwoDates) {
          await page.waitForSelector('#fDayN', { state: 'visible', timeout: 5000 }).catch(() => {});
        } else {
          await page.waitForSelector('#fDayY', { state: 'visible', timeout: 5000 }).catch(() => {});
        }
        await page.waitForTimeout(500);
      } catch (err) {
        console.warn('[Taxcom] Не удалось установить признак:', err.message);
      }
    } else {
      console.warn('[Taxcom] Селектор признака не найден, пропускаю.');
    }

    // Признак обязательности послесменного/послерейсового медосмотра: для грузового сценария — «да» (1), как на скринах Такском.
    // Отключить: TAXCOM_POST_SHIFT_MEDICAL_REQUIRED=0|false в .env
    const medicalExplicitNo = /^(0|false|no|нет)$/i.test(String(env.TAXCOM_POST_SHIFT_MEDICAL_REQUIRED || '').trim());
    const medicalExamValue = medicalExplicitNo ? '2' : '1';
    const medicalExamSelect = page.locator('#medical_exam_feature, select[name="MEDICAL_EXAM_FEATURE"]').first();
    if ((await medicalExamSelect.count()) > 0) {
      try {
        await medicalExamSelect.selectOption({ value: medicalExamValue });
        console.log(`[Taxcom] ✓ Признак обязательности послесменного медосмотра = ${medicalExplicitNo ? 'нет' : 'да'} (value ${medicalExamValue})`);
        await page.waitForTimeout(300);
      } catch (err) {
        console.warn('[Taxcom] Не удалось установить признак медосмотра:', err.message);
      }
    }

    // Грузовой ЭПЛ: сначала КП (SHIPPING_TYPE) → runShipping → подтип «перевозка грузов», парковка, вид сообщения (TAXCOM_*_LABEL)
    logFreightAddressesForWaybill(item);
    try {
      await applyFreightWaybillTaxcomFields(page, resolveCommercialShippingEnv(item, { ...process.env, ...env }));
    } catch (fe) {
      console.warn('[Taxcom] applyFreightWaybillTaxcomFields:', fe.message);
    }
    try {
      await fillFreightAddressesOnTaxcomWaybillForm(page, item, env);
    } catch (addrErr) {
      console.warn('[Taxcom] fillFreightAddressesOnTaxcomWaybillForm:', addrErr.message);
    }

    if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
      await takeScreenshot(page, 'debug_step2_after', env, 'DEBUG: После установки признака "один день"');
      const step2Action = await waitForUserConfirmation('ШАГ 2: Признак "один день" установлен', env);
      if (step2Action === 'back' && oneDaySelect) {
        // Откатываем к противоположному значению
        const oppositeValue = oneDayValue === 'да' ? 'нет' : 'да';
        try {
          await oneDaySelect.selectOption({ label: new RegExp(oppositeValue, 'i') });
          console.log(`[DEBUG] Откат: установлен "${oppositeValue}"`);
        } catch (_) {}
      }
    }
    
    // ШАГ 3: Дата ЭПЛ
    console.log('[Taxcom] [ШАГ 3] Заполняю дату ЭПЛ...');
    
    // Сначала заполняем поле "от" (дата создания ЭПЛ) - рядом с номером путевого
    console.log('[Taxcom] Заполняю поле "от" (дата создания ЭПЛ)...');
    let dateFromField = null;
    
    // Способ 1: Прямой поиск по ID (самый надёжный) - #waybill_date
    dateFromField = page.locator('#waybill_date').first();
    if ((await dateFromField.count()) === 0) {
      // Пробуем другие варианты
      dateFromField = page.locator('input#waybill_date').first();
    }
    if ((await dateFromField.count()) === 0) {
      // Поиск по name
      dateFromField = page.locator('input[name="WAYBILL_DATE"]').first();
    }
    if ((await dateFromField.count()) === 0) {
      // Поиск по классу
      dateFromField = page.locator('input.main-ui-date-input').first();
    }
    
    // Способ 2: Ищем input с календарём рядом с полем номера путевого (по позиции)
    if (!dateFromField || (await dateFromField.count()) === 0) {
      // Находим поле номера путевого
      const waybillNumberField = page.locator('input[placeholder*="номер путевого"], input[value*="WB-"], input[value*="WB"]').first();
      if ((await waybillNumberField.count()) > 0) {
        const waybillBox = await waybillNumberField.boundingBox().catch(() => null);
        if (waybillBox) {
          // Ищем input с календарём справа от номера (в той же строке)
          const allInputs = await page.locator('input[type="text"], input[placeholder*="ДД"], input[placeholder*="дд"], input').all();
          for (const inp of allInputs) {
            const inpBox = await inp.boundingBox().catch(() => null);
            if (inpBox) {
              // Проверяем, что input находится справа от номера и примерно на той же высоте
              const isRightOfWaybill = inpBox.x > waybillBox.x + waybillBox.width - 50;
              const isSameRow = Math.abs(inpBox.y - waybillBox.y) < 30;
              const placeholder = await inp.getAttribute('placeholder').catch(() => '');
              const hasCalendar = await inp.locator('..').locator('[class*="calendar"], [class*="date"], svg').count().catch(() => 0);
              if (isRightOfWaybill && isSameRow && (placeholder.includes('ДД') || placeholder.includes('дд') || placeholder.includes('гггг') || hasCalendar > 0)) {
                dateFromField = inp;
                break;
              }
            }
          }
        }
      }
    }
    
    // Способ 3: Ищем все input с placeholder "дд.мм.гггг" и берём первый (обычно это поле "от")
    if (!dateFromField || (await dateFromField.count()) === 0) {
      const allDateInputs = page.locator('input[placeholder*="ДД.ММ.ГГГГ"], input[placeholder*="дд.мм.гггг"], input[placeholder*="ДД"], input[placeholder*="дд"]');
      const count = await allDateInputs.count();
      if (count > 0) {
        // Берём первый input с датой (обычно это поле "от")
        dateFromField = allDateInputs.first();
      }
    }
    
    // Способ 4: Ищем input в той же строке/контейнере что и номер путевого
    if (!dateFromField || (await dateFromField.count()) === 0) {
      const waybillNumberField = page.locator('input[value*="WB-"], input[value*="WB"]').first();
      if ((await waybillNumberField.count()) > 0) {
        // Ищем родительский контейнер номера
        const container = waybillNumberField.locator('..').locator('..');
        const dateInputInContainer = container.locator('input[placeholder*="ДД"], input[placeholder*="дд"]').first();
        if ((await dateInputInContainer.count()) > 0) {
          dateFromField = dateInputInContainer;
        }
      }
    }
    
    // Способ 5: Используем JavaScript для поиска input справа от номера путевого
    if (!dateFromField || (await dateFromField.count()) === 0) {
      try {
        const foundInput = await page.evaluate((waybillValue) => {
          // Находим input с номером путевого
          const waybillInput = Array.from(document.querySelectorAll('input')).find(inp => 
            inp.value && inp.value.includes(waybillValue)
          );
          if (!waybillInput) return null;
          
          const waybillRect = waybillInput.getBoundingClientRect();
          
          // Ищем все input с placeholder содержащим "ДД" или "дд"
          const allInputs = Array.from(document.querySelectorAll('input[type="text"], input'));
          for (const inp of allInputs) {
            if (inp === waybillInput) continue;
            const placeholder = inp.getAttribute('placeholder') || '';
            if (!placeholder.includes('ДД') && !placeholder.includes('дд') && !placeholder.includes('гггг')) continue;
            
            const inpRect = inp.getBoundingClientRect();
            // Проверяем, что input справа от номера и на той же строке
            const isRight = inpRect.left > waybillRect.right - 50;
            const isSameRow = Math.abs(inpRect.top - waybillRect.top) < 30;
            
            if (isRight && isSameRow) {
              // Помечаем input для поиска
              inp.setAttribute('data-found-date-from', 'true');
              return inp.outerHTML.substring(0, 200); // Возвращаем часть HTML для идентификации
            }
          }
          return null;
        }, waybillNumber);
        
        if (foundInput) {
          // Находим помеченный input
          dateFromField = page.locator('input[data-found-date-from="true"]').first();
          // Убираем атрибут
          await page.evaluate(() => {
            const inp = document.querySelector('input[data-found-date-from="true"]');
            if (inp) inp.removeAttribute('data-found-date-from');
          });
        }
      } catch (err) {
        console.warn('[Taxcom] Ошибка при поиске поля "от" через JavaScript:', err.message);
      }
    }
    
    if (dateFromField && (await dateFromField.count()) > 0) {
      // Проверяем видимость перед заполнением
      const isVisible = await dateFromField.isVisible().catch(() => false);
      if (!isVisible) {
        // Пробуем прокрутить к полю без scrollIntoViewIfNeeded
        const box = await dateFromField.boundingBox().catch(() => null);
        if (box) {
          await page.evaluate(({ x, y }) => {
            window.scrollTo({ top: y - 200, behavior: 'smooth' });
          }, box);
          await page.waitForTimeout(500);
        }
      }
      await dateFromField.fill(dateFrom);
      console.log(`[Taxcom] ✓ Заполнено поле "от": ${dateFrom}`);
      await page.waitForTimeout(300);
      if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
        await highlightElement(page, dateFromField, '#00ff00', 2000);
        await page.waitForTimeout(500);
      }
    } else {
      console.warn('[Taxcom] Поле "от" (дата создания) не найдено рядом с номером путевого');
      console.warn('[Taxcom] Попробую найти все input с датами и заполнить второй (первый обычно номер путевого)...');
      // Запасной вариант: берём второй input с датой (первый обычно номер путевого)
      const allDateInputs = page.locator('input[placeholder*="ДД"], input[placeholder*="дд"], input[placeholder*="гггг"]');
      const count = await allDateInputs.count();
      if (count >= 2) {
        dateFromField = allDateInputs.nth(1); // Берём второй (индекс 1)
        const isVisible = await dateFromField.isVisible().catch(() => false);
        if (isVisible) {
          await dateFromField.fill(dateFrom);
          console.log(`[Taxcom] ✓ Заполнено поле "от" (второй input с датой): ${dateFrom}`);
          await page.waitForTimeout(300);
          if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
            await highlightElement(page, dateFromField, '#00ff00', 2000);
            await page.waitForTimeout(500);
          }
        } else {
          console.warn('[Taxcom] Второй input с датой найден, но невидим');
        }
      } else {
        console.warn(`[Taxcom] Найдено только ${count} input(ов) с датами, нужно минимум 2`);
      }
    }
    
    // Затем заполняем основное поле даты
    if (useTwoDates) {
      // Две даты: "Дата начала" и "Дата окончания"
      console.log('[Taxcom] Заполняю две даты (начало и окончание)...');
      const dateStartField = page.locator('#use_waybill_date_start').first();
      if ((await dateStartField.count()) > 0) {
        const isVisible = await dateStartField.isVisible().catch(() => false);
        if (isVisible) {
          await dateStartField.scrollIntoViewIfNeeded();
          await page.waitForTimeout(200);
          await dateStartField.fill(dateFrom);
          console.log(`[Taxcom] ✓ Заполнено поле "Дата начала": ${dateFrom}`);
          await page.waitForTimeout(300);
          if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
            await highlightElement(page, dateStartField, '#00ff00', 2000);
            await page.waitForTimeout(500);
          }
        } else {
          console.warn('[Taxcom] Поле #use_waybill_date_start найдено, но невидимо');
          await fill(['Дата начала срока действия', 'дата начала'], dateFrom, 'дата начала срока действия', true, env);
        }
      } else {
        await fill(['Дата начала срока действия', 'дата начала'], dateFrom, 'дата начала срока действия', true, env);
      }
      
      const dateEndField = page.locator('#use_waybill_date_end').first();
      if ((await dateEndField.count()) > 0) {
        const isVisible = await dateEndField.isVisible().catch(() => false);
        if (isVisible) {
          await dateEndField.scrollIntoViewIfNeeded();
          await page.waitForTimeout(200);
          await dateEndField.fill(dateTo);
          console.log(`[Taxcom] ✓ Заполнено поле "Дата окончания": ${dateTo}`);
          await page.waitForTimeout(300);
          if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
            await highlightElement(page, dateEndField, '#00ff00', 2000);
            await page.waitForTimeout(500);
          }
        } else {
          console.warn('[Taxcom] Поле #use_waybill_date_end найдено, но невидимо');
          await fill(['Дата окончания срока действия', 'дата окончания', 'дата по'], dateTo, 'дата окончания срока действия', true, env);
        }
      } else {
        await fill(['Дата окончания срока действия', 'дата окончания', 'дата по'], dateTo, 'дата окончания срока действия', true, env);
      }
    } else {
      // Одна дата: "Дата, в течении которой путевой лист может быть использован"
      console.log('[Taxcom] Заполняю одну дату (использования)...');
      let dateFieldFound = false;
      
      // Способ 1: Прямой поиск по ID (самый надёжный) — если блок скрыт, принудительно показываем
      const useWaybillDateField = page.locator('#use_waybill_date').first();
      if ((await useWaybillDateField.count()) > 0) {
        const parentDiv = page.locator('#fDayY').first();
        const parentVisible = await parentDiv.isVisible().catch(() => false);
        if (!parentVisible && (await parentDiv.count()) > 0) {
          console.log('[Taxcom] Блок #fDayY скрыт — принудительно показываю...');
          await page.evaluate(() => {
            const block = document.getElementById('fDayY');
            if (block) {
              block.style.display = 'block';
              block.style.visibility = 'visible';
              block.style.opacity = '1';
              block.style.height = 'auto';
              block.classList.remove('d-none', 'hidden');
            }
            const inp = document.getElementById('use_waybill_date');
            if (inp) {
              inp.removeAttribute('readonly');
              inp.removeAttribute('disabled');
            }
          });
          await page.waitForTimeout(300);
        }
        const isVisible = await useWaybillDateField.isVisible().catch(() => false);
        if (isVisible) {
          await useWaybillDateField.scrollIntoViewIfNeeded().catch(() => {});
          await page.waitForTimeout(200);
          await useWaybillDateField.click({ force: true }).catch(() => {});
          await useWaybillDateField.fill(dateFrom);
          await useWaybillDateField.dispatchEvent('change');
          console.log(`[Taxcom] ✓ Заполнено поле даты (по ID): ${dateFrom}`);
          dateFieldFound = true;
          await page.waitForTimeout(300);
          if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
            await highlightElement(page, useWaybillDateField, '#00ff00', 2000);
            await page.waitForTimeout(500);
          }
        } else {
          console.warn('[Taxcom] Поле #use_waybill_date найдено, но всё ещё невидимо после принудительного показа');
        }
      }
      
      // Способ 2: По name
      if (!dateFieldFound) {
        const useWaybillDateByName = page.locator('input[name="USE_WAYBILL_DATE"]').first();
        if ((await useWaybillDateByName.count()) > 0) {
          const isVisible = await useWaybillDateByName.isVisible().catch(() => false);
          if (isVisible) {
            await useWaybillDateByName.fill(dateFrom);
            console.log(`[Taxcom] ✓ Заполнено поле даты (по name): ${dateFrom}`);
            dateFieldFound = true;
            await page.waitForTimeout(300);
            if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
              await highlightElement(page, useWaybillDateByName, '#00ff00', 2000);
              await page.waitForTimeout(500);
            }
          }
        }
      }
      
      // Способ 3: По label (запасной)
      if (!dateFieldFound) {
        const dateLabel = page.locator('label[for="use_waybill_date"]').first();
        if ((await dateLabel.count()) > 0) {
          const inputByLabel = page.locator('#use_waybill_date').first();
          if ((await inputByLabel.count()) > 0) {
            const isVisible = await inputByLabel.isVisible().catch(() => false);
            if (isVisible) {
              await inputByLabel.fill(dateFrom);
              console.log(`[Taxcom] ✓ Заполнено поле даты (через label for): ${dateFrom}`);
              dateFieldFound = true;
              await page.waitForTimeout(300);
              if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
                await highlightElement(page, inputByLabel, '#00ff00', 2000);
                await page.waitForTimeout(500);
              }
            }
          }
        }
      }
      
      // Способ 2: Ищем все input с placeholder "дд.мм.гггг" или календарём
      if (!dateFieldFound) {
        const allDateInputs = await page.locator('input[placeholder*="ДД"], input[placeholder*="дд"], input[type="date"], input[placeholder*="гггг"]').all();
        for (const dateInput of allDateInputs) {
          const placeholder = await dateInput.getAttribute('placeholder').catch(() => '');
          // Ищем label/текст рядом с input (в родителе, перед input, после input)
          const parent = dateInput.locator('..');
          const labelText = await parent.locator('label, div, span').first().textContent().catch(() => '') ||
                          await dateInput.locator('preceding-sibling::label, preceding-sibling::div, preceding-sibling::span').first().textContent().catch(() => '') ||
                          await dateInput.locator('following-sibling::label, following-sibling::div, following-sibling::span').first().textContent().catch(() => '');
          
          // Проверяем, что это поле связано с датой использования
          if (labelText.includes('Дата, в течении которой') || labelText.includes('может быть использован') || 
              (placeholder.includes('ДД') && !placeholder.includes('от'))) {
            await dateInput.scrollIntoViewIfNeeded();
            await page.waitForTimeout(200);
            await dateInput.fill(dateFrom);
            console.log(`[Taxcom] ✓ Заполнено поле даты (через поиск всех input): ${dateFrom}`);
            dateFieldFound = true;
            await page.waitForTimeout(300);
            if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
              await highlightElement(page, dateInput, '#00ff00', 2000);
              await page.waitForTimeout(500);
            }
            break;
          }
        }
      }
      
      // Способ 2.5: Ищем input рядом с селектором "признак один день" (обычно поле даты находится справа от него)
      if (!dateFieldFound) {
        const oneDaySelectFound = page.locator('select').filter({ hasText: /да|нет/i }).first();
        if ((await oneDaySelectFound.count()) > 0) {
          const selectBox = await oneDaySelectFound.boundingBox().catch(() => null);
          if (selectBox) {
            const allInputs = await page.locator('input[placeholder*="ДД"], input[placeholder*="дд"]').all();
            for (const inp of allInputs) {
              const inpBox = await inp.boundingBox().catch(() => null);
              if (inpBox) {
                // Проверяем, что input находится справа от селектора и на той же строке
                const isRightOfSelect = inpBox.x > selectBox.x + selectBox.width - 50;
                const isSameRow = Math.abs(inpBox.y - selectBox.y) < 30;
                if (isRightOfSelect && isSameRow) {
                  await inp.scrollIntoViewIfNeeded();
                  await page.waitForTimeout(200);
                  await inp.fill(dateFrom);
                  console.log(`[Taxcom] ✓ Заполнено поле даты (справа от селектора "один день"): ${dateFrom}`);
                  dateFieldFound = true;
                  await page.waitForTimeout(300);
                  if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
                    await highlightElement(page, inp, '#00ff00', 2000);
                    await page.waitForTimeout(500);
                  }
                  break;
                }
              }
            }
          }
        }
      }
      
      // Способ 3: Используем функцию fill как запасной вариант
      if (!dateFieldFound) {
        await fill(['Дата, в течении которой путевой лист может быть использован', 'дата путевого', 'дата'], dateFrom, 'дата ЭПЛ', true, env);
      }
    }
    
    // Всегда пробуем заполнить поле одной даты (если на форме выбран «один день» — иначе будет «Заполните это поле» и форма не сохранится)
    await fill(['Дата, в течении которой путевой лист может быть использован', 'дата путевого', 'дата'], dateFrom, 'дата ЭПЛ (обязательное)', true, env);
    const singleDateById = page.locator('#use_waybill_date').first();
    if ((await singleDateById.count()) > 0 && await singleDateById.isVisible().catch(() => false)) {
      await singleDateById.fill(dateFrom);
      console.log('[Taxcom] ✓ Дополнительно заполнено поле одной даты (#use_waybill_date):', dateFrom);
    }
    
    await takeScreenshot(page, '05_02_data_zapolnena', env, 'Дата заполнена');
    const step3Action = await waitForUserConfirmation('ШАГ 3: Дата ЭПЛ заполнена', env);
    if (step3Action === 'back') {
      // Очищаем даты
      if (useTwoDates) {
        await fill(['Дата начала срока действия', 'дата начала'], '', 'дата начала (очистка)', true, env);
        await fill(['Дата окончания срока действия', 'дата окончания'], '', 'дата окончания (очистка)', true, env);
      } else {
        const dateLabel = page.locator('label:has-text("Дата, в течении которой")').first();
        if ((await dateLabel.count()) > 0) {
          const inputNearLabel = dateLabel.locator('..').locator('input').first();
          if ((await inputNearLabel.count()) > 0) await inputNearLabel.fill('');
        }
      }
    }
    
    // ШАГ 4: Лицо, оформившее путевой лист — данные владельца авто (из park_owners, привязан к карточке авто).
    // Реквизиты организации берутся ТОЛЬКО из карточки авто (owner), без фолбэка на парк.
    const ow = driver.owner || null;
    if (!ow) {
      console.warn('[Taxcom] [ШАГ 4] ⚠ У авто не указан владелец (owner). Блок «Лицо, оформившее путевой лист» будет пропущен. Укажите владельца в карточке авто.');
    }
    const issInn        = (ow?.inn || '').trim();
    const issOgrn       = (ow ? (ow.type === 'individual' ? (ow.ogrnip || '') : (ow.ogrn || '')) : '').trim();
    const issName       = (ow?.name || '').trim();
    const issKpp        = (ow?.kpp || '').trim();
    const issPhone      = (ow?.phone || '').trim();
    const issEmail      = (ow?.email || '').trim();
    const issIndex      = (ow?.postalIndex || '').trim();
    const issRegion     = (ow?.regionCode || '').trim();
    const issCity       = (ow?.city || '').trim();
    const issStreet     = (ow?.street || '').trim();
    const issHouse      = (ow?.house || '').trim();
    const issDistrict   = (ow?.district || '').trim();
    const issLocality   = (ow?.locality || '').trim();
    const issHousing    = (ow?.housing || '').trim();
    const issFlat       = (ow?.flat || '').trim();
    const isIndividual  = ow ? ow.type === 'individual' : false;
    const issRole       = ow?.role || 'С'; // С — собственник, А — арендодатель

    console.log('[Taxcom] [ШАГ 4] Заполняю лицо, оформившее путевой лист', ow ? `(владелец id=${ow.id}: ${issName})` : '(владелец не указан)');

    let accordionButton = page.locator('#accordionButton').first();
    if ((await accordionButton.count()) === 0) {
      accordionButton = page.locator('button:has-text("Лицо, оформившее путевой лист"), button[data-bs-target="#collapseContPerson"]').first();
    }
    if ((await accordionButton.count()) > 0) {
      const collapseSection = page.locator('#collapseContPerson').first();
      const isExpanded = await collapseSection.evaluate(el => el.classList.contains('show')).catch(() => false);
      if (!isExpanded) {
        const box = await accordionButton.boundingBox().catch(() => null);
        if (box) {
          await page.evaluate(({ y }) => { window.scrollTo({ top: y - 200, behavior: 'smooth' }); }, box);
          await page.waitForTimeout(300);
        }
        await accordionButton.click({ timeout: 5000 });
        await page.waitForSelector('#collapseContPerson.show', { state: 'visible', timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500);
      }

      // Тип лица: ЮЛ / ИП
      const legalTypeSelect = page.locator('#issue_person_legal_type').first();
      if ((await legalTypeSelect.count()) > 0) {
        await legalTypeSelect.selectOption({ value: isIndividual ? 'individual' : 'legal' });
        await page.waitForTimeout(500);
        await page.evaluate(() => { if (window.waybill && window.waybill.runPerson) window.waybill.runPerson(); }).catch(() => {});
        await page.waitForTimeout(300);
      }

      // Роль: Собственник (С) / Арендодатель (А)
      const roleSelect = page.locator('#issue_person_role, select[name="issue_person_role"]').first();
      if ((await roleSelect.count()) > 0 && await roleSelect.isVisible().catch(() => false)) {
        const roleValue = issRole === 'А' ? 'А' : 'С';
        await roleSelect.selectOption({ value: roleValue }).catch(async () => {
          // Попробуем по тексту
          await roleSelect.selectOption({ label: issRole === 'А' ? 'Арендодатель' : 'Собственник' }).catch(() => {});
        });
        console.log('[Taxcom] ✓ Лицо оформившее: роль =', roleValue);
      }

      if (isIndividual) {
        if (issInn) {
          const innEl = page.locator('#issue_person_innip').first();
          if ((await innEl.count()) > 0 && await innEl.isVisible().catch(() => false)) {
            await innEl.fill(issInn);
            console.log('[Taxcom] ✓ Лицо оформившее (ИП): ИНН =', issInn);
          }
        }
        if (issName) {
          // ИП: ФИО может заполняться в общее поле name или в разбивку
          const nameEl = page.locator('#issue_person_name, #issue_person_ip_name').first();
          if ((await nameEl.count()) > 0 && await nameEl.isVisible().catch(() => false)) {
            await nameEl.fill(issName);
            console.log('[Taxcom] ✓ Лицо оформившее (ИП): ФИО =', issName);
          }
        }
        if (issOgrn && issOgrn.length >= 15) {
          const ogrnEl = page.locator('#issue_person_ogrnip').first();
          if ((await ogrnEl.count()) > 0 && await ogrnEl.isVisible().catch(() => false)) {
            await ogrnEl.fill(issOgrn);
            console.log('[Taxcom] ✓ Лицо оформившее (ИП): ОГРНИП =', issOgrn);
          }
        }
      } else {
        if (issName) {
          const nameEl = page.locator('#issue_person_name').first();
          if ((await nameEl.count()) > 0 && await nameEl.isVisible().catch(() => false)) {
            await nameEl.fill(issName);
            console.log('[Taxcom] ✓ Лицо оформившее (ЮЛ): наименование =', issName);
          }
        }
        if (issInn && issInn.length === 10) {
          const innEl = page.locator('#issue_person_inn').first();
          if ((await innEl.count()) > 0 && await innEl.isVisible().catch(() => false)) {
            await innEl.fill(issInn);
            console.log('[Taxcom] ✓ Лицо оформившее (ЮЛ): ИНН =', issInn);
          }
        }
        if (issOgrn && issOgrn.length >= 13) {
          const ogrnEl = page.locator('#issue_person_ogrn').first();
          if ((await ogrnEl.count()) > 0 && await ogrnEl.isVisible().catch(() => false)) {
            await ogrnEl.fill(issOgrn);
            console.log('[Taxcom] ✓ Лицо оформившее (ЮЛ): ОГРН =', issOgrn);
          }
        }
        if (issKpp) {
          const kppEl = page.locator('#issue_person_kpp').first();
          if ((await kppEl.count()) > 0 && await kppEl.isVisible().catch(() => false)) {
            await kppEl.fill(issKpp);
            console.log('[Taxcom] ✓ Лицо оформившее (ЮЛ): КПП =', issKpp);
          }
        }
      }

      // Контакты
      if (issPhone) {
        const phoneEl = page.locator('#issue_person_contact_phone').first();
        if ((await phoneEl.count()) > 0 && await phoneEl.isVisible().catch(() => false)) {
          await phoneEl.fill(issPhone);
          console.log('[Taxcom] ✓ Лицо оформившее: телефон =', issPhone);
        }
      }
      if (issEmail) {
        const emailEl = page.locator('#ISSUE_PERSON_EMAIL, input[name="ISSUE_PERSON_EMAIL"]').first();
        if ((await emailEl.count()) > 0 && await emailEl.isVisible().catch(() => false)) {
          await emailEl.fill(issEmail);
          console.log('[Taxcom] ✓ Лицо оформившее: эл. почта =', issEmail);
        }
      }
      // Индекс
      if (issIndex) {
        const idxEl = page.locator('#ISSUE_PERSON_INDEX').first();
        if ((await idxEl.count()) > 0 && await idxEl.isVisible().catch(() => false)) {
          await idxEl.fill(issIndex);
          console.log('[Taxcom] ✓ Лицо оформившее: индекс =', issIndex);
        }
      }
      // Регион
      if (issRegion) {
        const regionEl = page.locator('#ISSUE_PERSON_REGION').first();
        if ((await regionEl.count()) > 0 && await regionEl.isVisible().catch(() => false)) {
          await regionEl.selectOption({ value: issRegion });
          console.log('[Taxcom] ✓ Лицо оформившее: регион =', issRegion);
        }
      }
      // Район
      if (issDistrict) {
        const districtEl = page.locator('#ISSUE_PERSON_DISTRICT, input[name="ISSUE_PERSON_DISTRICT"], #Район').first();
        if ((await districtEl.count()) > 0 && await districtEl.isVisible().catch(() => false)) {
          await districtEl.fill(issDistrict);
          console.log('[Taxcom] ✓ Лицо оформившее: район =', issDistrict);
        }
      }
      // Город
      if (issCity) {
        const cityEl = page.locator('#ISSUE_PERSON_CITY').first();
        if ((await cityEl.count()) > 0 && await cityEl.isVisible().catch(() => false)) {
          try {
            await cityEl.click().catch(() => {});
            await cityEl.fill('');
            await cityEl.fill(issCity);
            await page.waitForTimeout(250);

            const suggestion = page
              .locator('ul li, .dropdown-menu li, .autocomplete-items div, .tt-menu .tt-suggestion, .ui-menu-item')
              .filter({ hasText: issCity })
              .first();
            if ((await suggestion.count()) > 0 && await suggestion.isVisible().catch(() => false)) {
              await suggestion.click().catch(() => {});
              await page.waitForTimeout(200);
            } else {
              await cityEl.press('ArrowDown').catch(() => {});
              await cityEl.press('Enter').catch(() => {});
            }
            await cityEl.evaluate((el) => {
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              el.dispatchEvent(new Event('blur', { bubbles: true }));
            }).catch(() => {});
          } catch (e) {
            console.warn('[Taxcom] Лицо оформившее: не удалось корректно выбрать город:', e.message);
          }
          const finalVal = await cityEl.inputValue().catch(() => '');
          console.log('[Taxcom] ✓ Лицо оформившее: город =', finalVal || issCity);
        }
      }
      // Населённый пункт
      if (issLocality) {
        const localityEl = page.locator('#ISSUE_PERSON_LOCALITY, input[name="ISSUE_PERSON_LOCALITY"], #Населённый_пункт').first();
        if ((await localityEl.count()) > 0 && await localityEl.isVisible().catch(() => false)) {
          try {
            // В Такском это часто автокомплит. Простого fill иногда недостаточно — остаётся дефолтное значение.
            await localityEl.click().catch(() => {});
            await localityEl.fill('');
            await localityEl.fill(issLocality);
            await page.waitForTimeout(250);

            // Пытаемся выбрать подсказку, если она появилась (любые списки/дропдауны).
            const suggestion = page
              .locator('ul li, .dropdown-menu li, .autocomplete-items div, .tt-menu .tt-suggestion, .ui-menu-item')
              .filter({ hasText: issLocality })
              .first();
            if ((await suggestion.count()) > 0 && await suggestion.isVisible().catch(() => false)) {
              await suggestion.click().catch(() => {});
              await page.waitForTimeout(200);
            } else {
              // Фолбэк: "принять" ввод клавиатурой
              await localityEl.press('ArrowDown').catch(() => {});
              await localityEl.press('Enter').catch(() => {});
            }

            // Добиваем change/input событиями
            await localityEl.evaluate((el) => {
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              el.dispatchEvent(new Event('blur', { bubbles: true }));
            }).catch(() => {});
          } catch (e) {
            console.warn('[Taxcom] Лицо оформившее: не удалось корректно выбрать населённый пункт:', e.message);
          }
          const finalVal = await localityEl.inputValue().catch(() => '');
          console.log('[Taxcom] ✓ Лицо оформившее: населённый пункт =', finalVal || issLocality);
        }
      }
      // Улица
      if (issStreet) {
        const streetEl = page.locator('#ISSUE_PERSON_STREET').first();
        if ((await streetEl.count()) > 0 && await streetEl.isVisible().catch(() => false)) {
          await streetEl.fill(issStreet);
          console.log('[Taxcom] ✓ Лицо оформившее: улица =', issStreet);
        }
      }
      // Дом
      if (issHouse) {
        const houseEl = page.locator('#ISSUE_PERSON_HOUSE').first();
        if ((await houseEl.count()) > 0 && await houseEl.isVisible().catch(() => false)) {
          await houseEl.fill(issHouse);
          console.log('[Taxcom] ✓ Лицо оформившее: дом =', issHouse);
        }
      }
      // Корпус
      if (issHousing) {
        const housingEl = page.locator('#ISSUE_PERSON_HOUSING, input[name="ISSUE_PERSON_HOUSING"], #Корпус').first();
        if ((await housingEl.count()) > 0 && await housingEl.isVisible().catch(() => false)) {
          await housingEl.fill(issHousing);
          console.log('[Taxcom] ✓ Лицо оформившее: корпус =', issHousing);
        }
      }
      // Квартира
      if (issFlat) {
        const flatEl = page.locator('#ISSUE_PERSON_FLAT, input[name="ISSUE_PERSON_FLAT"], #Квартира').first();
        if ((await flatEl.count()) > 0 && await flatEl.isVisible().catch(() => false)) {
          await flatEl.fill(issFlat);
          console.log('[Taxcom] ✓ Лицо оформившее: квартира =', issFlat);
        }
      }
      await page.waitForTimeout(300);
    } else {
      console.warn('[Taxcom] Аккордеон "Лицо, оформившее путевой лист" не найден.');
    }
    
    await takeScreenshot(page, '05_03_dispatcher_zapolnen', env, 'Лицо оформившее заполнено');
    const step4Action = await waitForUserConfirmation('ШАГ 4: Лицо оформившее заполнено', env);
    
    // ШАГ 5: Блок ТС — заполняем в Т1 (в Т3 уже не трогаем, там подставлено после Т1)
    console.log('[Taxcom] [ШАГ 5] Заполняю данные о транспортном средстве...');
    
    // Тип ТС: по карточке авто (vehicleType) или грузовой по умолчанию (продукт «Грузовые ЭПЛ»)
    const vehicleTypeField = page.locator('#vehicle_type').first();
    if ((await vehicleTypeField.count()) > 0) {
      const wanted = (driver.vehicleType && String(driver.vehicleType).trim())
        || env.TAXCOM_DEFAULT_VEHICLE_TYPE
        || 'грузовой';
      const isReadonly = await vehicleTypeField.getAttribute('readonly').then(v => v != null);
      const current = await vehicleTypeField.inputValue().catch(() => '');
      if (isReadonly || current === wanted) {
        if (current) console.log(`[Taxcom] ✓ Тип ТС уже задан (readonly или совпадает): ${current}`);
      } else {
        await vehicleTypeField.fill(wanted);
        console.log(`[Taxcom] ✓ Заполнено: тип ТС = ${wanted}`);
      }
      await page.waitForTimeout(300);
      if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
        await highlightElement(page, vehicleTypeField, '#00ff00', 2000);
        await page.waitForTimeout(500);
      }
    }
    
    // Марка ТС
    const vehicleBrandField = page.locator('#vehicle_brand').first();
    if ((await vehicleBrandField.count()) > 0 && driver.brand) {
      const brandReadonly = await vehicleBrandField.getAttribute('readonly').then(v => v != null);
      if (!brandReadonly) {
        await vehicleBrandField.fill(driver.brand);
        console.log(`[Taxcom] ✓ Заполнено: марка ТС = ${driver.brand}`);
      } else {
        console.log(`[Taxcom] ✓ Марка ТС уже задана: ${await vehicleBrandField.inputValue().catch(() => '')}`);
      }
      await page.waitForTimeout(300);
      if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
        await highlightElement(page, vehicleBrandField, '#00ff00', 2000);
        await page.waitForTimeout(500);
      }
    }
    
    // Модель ТС
    const vehicleModelField = page.locator('#vehicle_model').first();
    if ((await vehicleModelField.count()) > 0 && driver.model) {
      const modelReadonly = await vehicleModelField.getAttribute('readonly').then(v => v != null);
      if (!modelReadonly) {
        await vehicleModelField.fill(driver.model);
        console.log(`[Taxcom] ✓ Заполнено: модель ТС = ${driver.model}`);
      } else {
        console.log(`[Taxcom] ✓ Модель ТС уже задана`);
      }
      await page.waitForTimeout(300);
      if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
        await highlightElement(page, vehicleModelField, '#00ff00', 2000);
        await page.waitForTimeout(500);
      }
    }
    
    // Гос. номер ТС
    const vehicleRegNumberField = page.locator('#vehicle_registration_number').first();
    if ((await vehicleRegNumberField.count()) > 0 && driver.regNumber) {
      const regReadonly = await vehicleRegNumberField.getAttribute('readonly').then(v => v != null);
      if (!regReadonly) {
        await vehicleRegNumberField.fill(driver.regNumber);
        console.log(`[Taxcom] ✓ Заполнено: гос. номер ТС = ${driver.regNumber}`);
      } else {
        console.log(`[Taxcom] ✓ Гос. номер ТС уже задан`);
      }
      await page.waitForTimeout(300);
      if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
        await highlightElement(page, vehicleRegNumberField, '#00ff00', 2000);
        await page.waitForTimeout(500);
      }
    }
    
    await takeScreenshot(page, '05_04_ts_zapolneno', env, 'Данные ТС заполнены');
    const step5Action = await waitForUserConfirmation('ШАГ 5: Данные ТС заполнены', env);
    if (step5Action === 'back') {
      console.log('[DEBUG] Откат шага 5: очистка полей ТС');
      await fill(['Тип транспортного средства'], '', 'тип ТС (очистка)', true, env);
      await fill(['Марка транспортного средства'], '', 'марка ТС (очистка)', true, env);
      await fill(['Модель транспортного средства'], '', 'модель ТС (очистка)', true, env);
      await fill(['Государственный регистрационный номер ТС'], '', 'гос. номер ТС (очистка)', true, env);
    }
    
    // ШАГ 6: Блок водителя (заполняем по точным ID, НЕ используем поле "Выберите водителя")
    console.log('[Taxcom] [ШАГ 6] Заполняю данные о водителе...');
    
    // Табельный номер (из системы, например DRV-10-...)
    const tabNumberField = page.locator('#tab_number').first();
    if ((await tabNumberField.count()) > 0) {
      // Табельный номер может быть в driver.id или driver.personnelNumber
      const tabNumber = driver.personnelNumber || driver.id || (driver.id ? `DRV-10-${driver.id}` : '');
      if (tabNumber) {
        await tabNumberField.fill(tabNumber);
        console.log(`[Taxcom] ✓ Заполнено: табельный номер = ${tabNumber}`);
        await page.waitForTimeout(300);
        if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
          await highlightElement(page, tabNumberField, '#00ff00', 2000);
          await page.waitForTimeout(500);
        }
      }
    }
    
    // Фамилия
    const driverLastNameField = page.locator('#driver_last_name_0').first();
    if ((await driverLastNameField.count()) > 0 && lastName) {
      await driverLastNameField.fill(lastName);
      console.log(`[Taxcom] ✓ Заполнено: фамилия водителя = ${lastName}`);
      await page.waitForTimeout(300);
      if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
        await highlightElement(page, driverLastNameField, '#00ff00', 2000);
        await page.waitForTimeout(500);
      }
    }
    
    // Имя
    const driverNameField = page.locator('#driver_name_0').first();
    if ((await driverNameField.count()) > 0 && firstName) {
      await driverNameField.fill(firstName);
      console.log(`[Taxcom] ✓ Заполнено: имя водителя = ${firstName}`);
      await page.waitForTimeout(300);
      if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
        await highlightElement(page, driverNameField, '#00ff00', 2000);
        await page.waitForTimeout(500);
      }
    }
    
    // Отчество
    const driverSecondNameField = page.locator('#driver_second_name_0').first();
    if ((await driverSecondNameField.count()) > 0 && patronymic) {
      await driverSecondNameField.fill(patronymic);
      console.log(`[Taxcom] ✓ Заполнено: отчество водителя = ${patronymic}`);
      await page.waitForTimeout(300);
      if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
        await highlightElement(page, driverSecondNameField, '#00ff00', 2000);
        await page.waitForTimeout(500);
      }
    }
    
    // ИНН (для физлица в РФ — 12 цифр; Такском ругается на 11 цифр)
    const driverInnField = page.locator('#driver_inn_0').first();
    if ((await driverInnField.count()) > 0 && driver.inn) {
      let innStr = String(driver.inn).replace(/\D/g, '');
      if (innStr.length === 11) innStr = '0' + innStr;
      else if (innStr.length === 10) innStr = '00' + innStr;
      else if (innStr.length > 0 && innStr.length !== 12) {
        console.warn(`[Taxcom] ИНН водителя не 12 цифр (сейчас ${innStr.length}), дополняю нулями слева`);
        innStr = innStr.padStart(12, '0').slice(-12);
      }
      await driverInnField.fill(innStr);
      console.log(`[Taxcom] ✓ Заполнено: ИНН водителя = ${innStr}`);
      await page.waitForTimeout(300);
      if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
        await highlightElement(page, driverInnField, '#00ff00', 2000);
        await page.waitForTimeout(500);
      }
    }
    
    // ВУ: НЕ ставим галочку "иностранное ВУ", заполняем российское ВУ
    console.log(`[Taxcom] Данные ВУ из системы: серия="${driver.licenseSerial || 'не указана'}", номер="${driver.licenseNumber || 'не указан'}"`);

    // Сначала гарантированно снимаем флажок «иностранное ВУ», если он установлен
    const foreignCheckbox = page.locator('#CHECKED_IN_LICENSE_0').first();
    if ((await foreignCheckbox.count()) > 0) {
      const isChecked = await foreignCheckbox.isChecked().catch(() => false);
      if (isChecked) {
        console.log('[Taxcom] Снимаю флажок "иностранное ВУ", чтобы заполнить российское ВУ');
        await foreignCheckbox.click();
        await page.waitForTimeout(500); // даём форме перестроиться
      }
    }
    
    // Проверяем видимость блоков для российского и иностранного ВУ
    const foreignBlock = page.locator('#DriverIn_0').first();
    const russianBlock = page.locator('#DriverRus_0').first();
    const isForeignBlockVisible = (await foreignBlock.count()) > 0 && await foreignBlock.isVisible().catch(() => false);
    const isRussianBlockVisible = (await russianBlock.count()) > 0 && await russianBlock.isVisible().catch(() => false);
    
    console.log(`[Taxcom] Проверка блоков ВУ: блок иностранного видим=${isForeignBlockVisible}, блок российского видим=${isRussianBlockVisible}`);
    
    // Если блок иностранного ВУ всё ещё виден — просто предупреждаем в логах, но данные пишем в российский блок
    if (isForeignBlockVisible) {
      console.warn('[Taxcom] Внимание: блок иностранного ВУ видим, но данные ВУ будут записаны в российское поле');
    }

    // Заполняем российское ВУ (одно поле "Серия/номер") в формате "NNNN NNNNNN"
    const driverLicenseNumberField = page.locator('#driver_license_number_0').first();
    if ((await driverLicenseNumberField.count()) > 0 && (driver.licenseSerial || driver.licenseNumber)) {
      // Берём только цифры из серии и номера
      const serialDigits = (driver.licenseSerial || '').replace(/\D/g, '');
      const numberDigits = (driver.licenseNumber || '').replace(/\D/g, '');
      let licenseValue = '';

      if (serialDigits.length >= 4 && numberDigits.length >= 6) {
        licenseValue = `${serialDigits.slice(0, 4)} ${numberDigits.slice(0, 6)}`;
      } else {
        // Если данных не хватает, склеиваем и добиваем нулями до 10 цифр
        const all = (serialDigits + numberDigits).padEnd(10, '0');
        licenseValue = `${all.slice(0, 4)} ${all.slice(4, 10)}`;
      }

      await driverLicenseNumberField.fill(licenseValue);
      console.log(`[Taxcom] ✓ Заполнено: серия/номер ВУ (российское) = ${licenseValue}`);
      console.log(`[Taxcom] Исходные данные: серия="${driver.licenseSerial}", номер="${driver.licenseNumber}"`);
      await page.waitForTimeout(500);
        
        // Проверяем, нет ли ошибки валидации после заполнения
        const hasError = await driverLicenseNumberField.evaluate(el => {
          return el.classList.contains('is-invalid') || 
                 el.classList.contains('error') || 
                 el.getAttribute('aria-invalid') === 'true' ||
                 (el.parentElement && el.parentElement.querySelector('.invalid-feedback, .error-message'));
        }).catch(() => false);
        
        if (hasError) {
          console.warn(`[Taxcom] ⚠ После заполнения ВУ обнаружена ошибка валидации. Значение: ${licenseValue}`);
          await takeScreenshot(page, 'vu_validation_error', env, 'Ошибка валидации ВУ');
        }
        
        if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
          await highlightElement(page, driverLicenseNumberField, '#00ff00', 2000);
          await page.waitForTimeout(500);
        }
      } else if ((await driverLicenseNumberField.count()) > 0 && driver.licenseNumber) {
        // Если серии нет, заполняем только номер (но это может вызвать ошибку валидации)
        console.warn('[Taxcom] Серия ВУ отсутствует, заполняю только номер (может быть ошибка валидации)');
        await driverLicenseNumberField.fill(driver.licenseNumber);
        console.log(`[Taxcom] ✓ Заполнено: номер ВУ (российское, без серии) = ${driver.licenseNumber}`);
        await page.waitForTimeout(300);
        if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
          await highlightElement(page, driverLicenseNumberField, '#00ff00', 2000);
          await page.waitForTimeout(500);
        }
      }
    
    // Дата выдачи ВУ
    const driverLicenseDateField = page.locator('#driver_license_date_0').first();
    if ((await driverLicenseDateField.count()) > 0 && licenseDateFormatted) {
      await driverLicenseDateField.fill(licenseDateFormatted);
      console.log(`[Taxcom] ✓ Заполнено: дата выдачи ВУ = ${licenseDateFormatted}`);
      await page.waitForTimeout(300);
      if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
        await highlightElement(page, driverLicenseDateField, '#00ff00', 2000);
        await page.waitForTimeout(500);
      }
    }
    
    // НЕ ставим галочку "иностранное ВУ" (#CHECKED_IN_LICENSE_0) - по требованию пользователя
    await takeScreenshot(page, '05_05_voditel_zapolnen', env, 'Данные водителя заполнены');
    const step6Action = await waitForUserConfirmation('ШАГ 6: Данные водителя заполнены', env);
    if (step6Action === 'back') {
      console.log('[DEBUG] Откат шага 6: очистка полей водителя');
      await fill(['Фамилия'], '', 'фамилия (очистка)', true, env);
      await fill(['Имя'], '', 'имя (очистка)', true, env);
      await fill(['Отчество'], '', 'отчество (очистка)', true, env);
      await fill(['ИНН'], '', 'ИНН (очистка)', true, env);
      await fill(['Серия/номер водительского удостоверения', 'Серия'], '', 'серия/номер ВУ (очистка)', true, env);
      await fill(['Дата выдачи водительского удостоверения'], '', 'дата выдачи ВУ (очистка)', true, env);
    }
    
    // Базовые времена по МСК:
    // createdAt (запрос ЭПЛ) = время убытия (Т4).
    // tMed = медосмотр за ~60 минут до убытия ± 2-5 мин (Т2).
    // tTech = техконтроль за ~55 минут до убытия ± 2-5 мин (Т3).
    // tReleaseLine = выпуск на линию за ~49 минут до убытия ± 2-5 мин (Т3).
    const tRelease = createdAt;
    // Случайный разброс 2-5 минут для каждого пункта
    const randomMedOffset = Math.floor(Math.random() * (5 - 2 + 1) + 2) * 60 * 1000; // 2-5 минут
    const randomTechOffset = Math.floor(Math.random() * (5 - 2 + 1) + 2) * 60 * 1000; // 2-5 минут
    const randomReleaseOffset = Math.floor(Math.random() * (5 - 2 + 1) + 2) * 60 * 1000; // 2-5 минут
    const tMed = new Date(tRelease.getTime() - 60 * 60 * 1000 - randomMedOffset);
    const tTech = new Date(tRelease.getTime() - 55 * 60 * 1000 - randomTechOffset);
    const tReleaseLine = new Date(tRelease.getTime() - 49 * 60 * 1000 - randomReleaseOffset);

    // ШАГ 7: Заполняем Т4 (одометр при выезде)
    console.log('[Taxcom] [ШАГ 7] Заполняю Т4 (одометр при выезде)...');
    
    // Дата выезда ТС с парковки (используем дату создания ЭПЛ)
    const tripStartDateField = page.locator('#date_end_p, #TRIP_START_DATE').first();
    if ((await tripStartDateField.count()) > 0) {
      await tripStartDateField.fill(dateFrom);
      console.log(`[Taxcom] ✓ Заполнено: дата выезда ТС = ${dateFrom}`);
      await page.waitForTimeout(300);
      if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
        await highlightElement(page, tripStartDateField, '#00ff00', 2000);
        await page.waitForTimeout(500);
      }
    }
    
    // Время выезда ТС с парковки — по МСК, берём момент запроса ЭПЛ (createdAt)
    const timeStr = getMoscowTimeString(tRelease, true);
    const tripStartTimeField = page.locator('#time_end_p, #TRIP_START_TIME').first();
    if ((await tripStartTimeField.count()) > 0) {
      await tripStartTimeField.fill(timeStr);
      console.log(`[Taxcom] ✓ Заполнено: время выезда ТС = ${timeStr}`);
      await page.waitForTimeout(300);
      if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
        await highlightElement(page, tripStartTimeField, '#00ff00', 2000);
        await page.waitForTimeout(500);
      }
    }
    
    // Показания одометра при выезде
    const odometerField = page.locator('#ODOMETR_VALUE').first();
    if ((await odometerField.count()) > 0 && startOdometer > 0) {
      await odometerField.fill(String(startOdometer));
      console.log(`[Taxcom] ✓ Заполнено: показания одометра при выезде = ${startOdometer}`);
      await page.waitForTimeout(300);
      if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
        await highlightElement(page, odometerField, '#00ff00', 2000);
        await page.waitForTimeout(500);
      }
    }
    
    await takeScreenshot(page, '05_06_t4_zapolnen', env, 'Т4 (одометр при выезде) заполнен');
    const step7Action = await waitForUserConfirmation('ШАГ 7: Т4 (одометр при выезде) заполнен', env);
    if (step7Action === 'back') {
      console.log('[DEBUG] Откат шага 7: очистка полей Т4');
      if ((await odometerField.count()) > 0) {
        await odometerField.fill('');
      }
    }
    
    await page.waitForTimeout(500);
    
    // Проверяем наличие ошибок валидации перед сохранением
    console.log('[Taxcom] Проверяю наличие ошибок валидации перед сохранением...');
    const validationErrorsBeforeSave = await page.locator('input.is-invalid, select.is-invalid, textarea.is-invalid, [aria-invalid="true"], .invalid-feedback:visible, .error-message:visible').count();
    if (validationErrorsBeforeSave > 0) {
      console.error(`[Taxcom] ⛔ ОБНАРУЖЕНО ${validationErrorsBeforeSave} ОШИБОК ВАЛИДАЦИИ ПЕРЕД СОХРАНЕНИЕМ!`);
      const errorFields = await page.locator('input.is-invalid, select.is-invalid').all();
      for (let i = 0; i < Math.min(errorFields.length, 10); i++) {
        const field = errorFields[i];
        let fieldName = await field.getAttribute('name').catch(() => null);
        if (!fieldName) {
          fieldName = await field.getAttribute('id').catch(() => null);
        }
        if (!fieldName) {
          fieldName = 'неизвестное поле';
        }
        const fieldValue = await field.inputValue().catch(() => '');
        const errorText = await field.evaluate(el => {
          const parent = el.closest('.form-group, .mb-3, .form-control-group');
          if (parent) {
            const errorMsg = parent.querySelector('.invalid-feedback, .error-message');
            return errorMsg ? errorMsg.textContent.trim() : '';
          }
          return '';
        }).catch(() => '');
        console.error(`[Taxcom]   ⛔ Поле "${fieldName}" = "${fieldValue}": ${errorText || 'ошибка валидации'}`);
      }
      await takeScreenshot(page, 'validation_errors_before_save', env, 'Ошибки валидации перед сохранением');
      console.error('[Taxcom] ⛔ ВНИМАНИЕ: Есть ошибки валидации! Проверь скриншот validation_errors_before_save');
    } else {
      console.log('[Taxcom] ✓ Ошибок валидации не обнаружено');
    }

    // Обязательное поле «Дата, в течении которой путевой лист может быть использован» при «два дня» может быть скрыто — показываем и заполняем через Playwright .fill(), иначе Bitrix-фреймворк не зарегистрирует значение и форма не сохранится
    try {
      await page.evaluate(() => {
        const block = document.getElementById('fDayY');
        const input = document.getElementById('use_waybill_date') || document.querySelector('input[name="USE_WAYBILL_DATE"]');
        if (block) {
          block.style.display = 'block';
          block.style.visibility = 'visible';
          block.style.opacity = '1';
          block.style.height = 'auto';
          block.classList.remove('d-none', 'hidden');
        }
        if (input) {
          input.removeAttribute('readonly');
          input.removeAttribute('disabled');
          input.style.display = '';
          input.style.visibility = 'visible';
        }
      });
      await page.waitForTimeout(300);

      const dateInput = page.locator('#use_waybill_date').first();
      const dateInputByName = page.locator('input[name="USE_WAYBILL_DATE"]').first();
      const target = (await dateInput.count()) > 0 ? dateInput : ((await dateInputByName.count()) > 0 ? dateInputByName : null);

      if (target) {
        await target.scrollIntoViewIfNeeded().catch(() => {});
        await target.click({ force: true }).catch(() => {});
        await page.waitForTimeout(200);
        await target.fill('');
        await target.fill(dateFrom);
        await target.dispatchEvent('change');
        await target.evaluate((el) => {
          el.dispatchEvent(new Event('blur', { bubbles: true }));
        });
        await page.waitForTimeout(200);
        const actualVal = await target.inputValue().catch(() => '');
        if (actualVal === dateFrom) {
          console.log('[Taxcom] ✓ Поле одной даты (use_waybill_date) заполнено через Playwright .fill():', dateFrom);
        } else {
          console.warn(`[Taxcom] ⚠ Поле use_waybill_date: ожидалось "${dateFrom}", получено "${actualVal}". Пробую type()...`);
          await target.click({ force: true }).catch(() => {});
          await target.fill('');
          await target.type(dateFrom, { delay: 50 });
          await target.dispatchEvent('change');
          console.log('[Taxcom] ✓ Поле одной даты (use_waybill_date) заполнено через type():', dateFrom);
        }
      } else {
        console.warn('[Taxcom] ⚠ Поле use_waybill_date не найдено ни по ID, ни по name');
      }
    } catch (e) {
      console.error('[Taxcom] ⚠ Ошибка при заполнении use_waybill_date:', e.message);
    }
    await page.waitForTimeout(500);

    // Т1: сначала «Сохранить» — создаётся путевой и редирект на waybill/{id}/1/, потом подпись
    console.log('[ЭПЛ] Сохраняю Т1...');
    const saveBtn = page.locator('#save_btn').first();
    if ((await saveBtn.count()) > 0 && await saveBtn.isVisible().catch(() => false)) {
      await saveBtn.click();
      console.log('[Taxcom] Кнопка «Сохранить» нажата');
    } else {
      const saveByText = page.getByRole('button', { name: /сохранить/i }).first();
      if ((await saveByText.count()) > 0 && await saveByText.isVisible().catch(() => false)) {
        await saveByText.click();
      } else {
        await page.keyboard.press('Enter');
      }
    }
    console.log('[Taxcom] Жду редирект после сохранения (до 10 сек)...');
    await page.waitForTimeout(5000);
    let url = page.url();
    if (url.includes('/waybill/new') || url.replace(/\/$/, '').endsWith('/new')) {
      await page.waitForTimeout(5000);
      url = page.url();
    }
    console.log('[Taxcom] Ищу mintransId в URL:', url);
    const mintransMatch = url.match(/\/(?:waybill|epl|document)\/([a-f0-9-]+|\d+)/i) || url.match(/id=(\d+)/i) || url.match(/[?&]id=([a-f0-9-]+|\d+)/i);
    mintransId = mintransMatch ? mintransMatch[1] : null;
    if (mintransId) {
      console.log('[Taxcom] mintransId найден в URL:', mintransId);
    } else {
      if (url.includes('/waybill/new') || url.replace(/\/$/, '').endsWith('/new')) {
        console.error('[Taxcom] ⛔ Форма не сохранилась (URL остался waybill/new)!');
        await takeScreenshot(page, 'save_failed_still_new', env, 'Форма не сохранилась — URL остался /new');
        try {
          const validationErrors = await page.locator('input.is-invalid, select.is-invalid, .invalid-feedback:visible, .error-message:visible, [aria-invalid="true"]').all();
          if (validationErrors.length > 0) {
            console.error(`[Taxcom]   Найдено ${validationErrors.length} ошибок валидации на форме:`);
            for (let vi = 0; vi < Math.min(validationErrors.length, 10); vi++) {
              const el = validationErrors[vi];
              const tag = await el.evaluate(e => e.tagName).catch(() => '?');
              const id = await el.getAttribute('id').catch(() => null);
              const name = await el.getAttribute('name').catch(() => null);
              const text = await el.textContent().catch(() => '');
              const val = await el.inputValue().catch(() => null);
              console.error(`[Taxcom]   ${vi + 1}. <${tag}> id="${id}" name="${name}" value="${val}" text="${text.trim().substring(0, 100)}"`);
            }
          } else {
            console.warn('[Taxcom]   Ошибок валидации (.is-invalid) не найдено — возможно, ошибка серверная или поле не заполнено фреймворком');
          }
          const alertErrors = await page.locator('.alert-danger, .alert-error, .error-block, [class*="error"]:visible').allTextContents().catch(() => []);
          if (alertErrors.length > 0) {
            console.error('[Taxcom]   Блоки ошибок на странице:', alertErrors.map(t => t.trim().substring(0, 200)).join(' | '));
          }
        } catch (ve) {
          console.warn('[Taxcom]   Не удалось извлечь ошибки валидации:', ve.message);
        }
        mintransId = null;
      } else {
        console.log('[Taxcom] mintransId не в URL, ищу в тексте страницы...');
        const bodyText = await page.textContent('body').catch(() => '');
        const numMatch = bodyText.match(/№\s*(\d+)/) || bodyText.match(/mintransId["\s:]+(\d+)/i) || bodyText.match(/id["\s:]+["']?([a-f0-9-]+)/i) || bodyText.match(/путевой.*?№\s*(\d+)/i);
        if (numMatch) {
          mintransId = numMatch[1];
          console.log('[Taxcom] mintransId найден в тексте:', mintransId);
        } else {
          console.warn('[Taxcom] mintransId не найден ни в URL, ни в тексте страницы. Проверь скриншот 06_posle_sozdaniya_epl.');
          const title = await page.title().catch(() => '');
          console.log('[Taxcom] Заголовок страницы:', title);
        }
      }
    }
    if (!mintransId) {
      console.warn('[Taxcom] Не удалось получить реальный ID путевого из URL или страницы. Не отправляю epl-created.', SCREENSHOTS_ERR_HINT);
      // Фиксируем неудачную попытку (анти-бесконечная очередь): после N попыток бэкенд переведёт ЭПЛ в failed (failureCode=taxcom_validation).
      try {
        const apiUrl = (env.API_URL || 'http://localhost:5000').replace(/\/$/, '');
        const apiKey = env.SIGNER_API_KEY || env.CLINIC_API_KEY || '';
        if (apiUrl && apiKey && item && item.eplId) {
          const attemptRes = await fetch(`${apiUrl}/api/worker/epl/${item.eplId}/create-attempt-failed`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              failureCode: 'taxcom_validation',
              errorMessage: 'Такском не сохранил форму (waybill/new). Проверь обязательные поля (дата действия путевого).',
              maxAttempts: 3,
              minIntervalSec: 20
            })
          });
          if (!attemptRes.ok) {
            console.warn('[Taxcom] create-attempt-failed:', attemptRes.status, await attemptRes.text().catch(() => ''));
          } else {
            const data = await attemptRes.json().catch(() => null);
            if (data && data.attempts) {
              console.log(`[Taxcom] Попытка создания зафиксирована: attempts=${data.attempts}/${data.maxAttempts || 3} status=${data.status || '—'}`);
            }
          }
        }
      } catch (e) {
        console.warn('[Taxcom] create-attempt-failed network:', e.message);
      }
      const keepOpen = env.TAXCOM_KEEP_BROWSER_OPEN === '1' || env.TAXCOM_KEEP_BROWSER_OPEN === 'true';
      if (keepOpen) console.log('[Taxcom] TAXCOM_KEEP_BROWSER_OPEN=1 — браузер не закрыт.');
      else if (browser) await browser.close(); else if (persistentContext) await persistentContext.close();
      return null;
    }
    console.log('[Taxcom] ЭПЛ создан в Такском, mintransId:', mintransId);
    await report(eplId, 't1', 'filled', mintransId);
    await page.waitForTimeout(1500);

    } // end if (!startFromT3)

    // Используем импортированные функции из модулей
    
    /** Жёсткая верификация: все титулы Т1–Т4 подписаны. QR-блок появляется только после подписания всех 4. */
    const verifyAllTitlesSignedOnPage = async (p, base, mId) => {
      try {
        await p.goto(`${base}/waybill/${mId}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await p.waitForTimeout(3000);
        const collapseTrigger = await p.$('[data-bs-target="#qr-collapse-block"]');
        if (collapseTrigger) await collapseTrigger.click().catch(() => {});
        await p.waitForTimeout(1500);
        const qrBlock = await p.$('#qr-collapse-block img[src*="base64"], #qr-collapse-block img[src*="data:"]');
        if (qrBlock) {
          return true;
        }
        const bodyText = (await p.textContent('body').catch(() => '')) || '';
        const signedMentions = (bodyText.match(/подписан|подписание документов/gi) || []).length;
        if (signedMentions >= 4) return true;
        const signBtns = await p.locator('button:has-text("Подписать"), a:has-text("Подписать")').count();
        if (signBtns > 2) {
          console.warn(`[Taxcom] Верификация: на странице ещё ${signBtns} кнопок "Подписать" — не все титулы подписаны`);
          return false;
        }
        if (signedMentions >= 4) return true;
        console.warn(`[Taxcom] Верификация: QR не найден, упоминаний подписи: ${signedMentions} (нужно 4)`);
        return false;
      } catch (err) {
        console.warn('[Taxcom] Верификация подписей:', err.message);
        return false;
      }
    };

    // Функция для перехода к титулу по номеру
    const navigateToTitle = async (titleNumber) => {
      console.log(`[Taxcom] Перехожу к титулу Т${titleNumber}...`);
      // Пробуем разные способы найти ссылку/вкладку титула
      const titleSelectors = [
        page.locator(`a:has-text("Т${titleNumber}"), a:has-text("Титул ${titleNumber}")`).first(),
        page.locator(`[role="tab"]:has-text("Т${titleNumber}")`).first(),
        page.locator(`.tab:has-text("Т${titleNumber}")`).first(),
        page.locator(`a[href*="t${titleNumber}"], a[href*="title${titleNumber}"]`).first(),
        page.locator(`button:has-text("Т${titleNumber}")`).first()
      ];
      
      for (const selector of titleSelectors) {
        if ((await selector.count()) > 0 && await selector.isVisible().catch(() => false)) {
          await selector.click();
          await page.waitForTimeout(2000);
          console.log(`[Taxcom] Переход к Т${titleNumber} выполнен`);
          return true;
        }
      }
      
      // Пробуем через прямой переход по URL
      try {
        await page.goto(`${baseUrl}/waybill/${mintransId}/${titleNumber}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        console.log(`[Taxcom] Переход к Т${titleNumber} через URL выполнен`);
        return true;
      } catch (err) {
        console.warn(`[Taxcom] Не удалось перейти к Т${titleNumber}:`, err.message);
        return false;
      }
    };
    
    // Функция для заполнения Т2 (медик)
    const fillTitle2 = async (medicPhone, medicPass) => {
      if (!medicPhone || !medicPass) return false;
      const medic = staff.medic || {};
      if (!staff.medic) console.log('[Taxcom] Подписываю Т2 по логину из .env (в заявке нет данных медика).');
      console.log('[Taxcom] [Т2] Логинюсь под медиком...');
      await closeModalDialogs(page, env);
      
      // Контрольная точка перед выходом из аккаунта диспетчера
      console.log('\n[Taxcom] ════════════════════════════════════════════════════════');
      console.log('[Taxcom] ⚠ КОНТРОЛЬНАЯ ТОЧКА: Выход из аккаунта диспетчера');
      console.log('[Taxcom] Сейчас будет выход из аккаунта диспетчера для входа под медиком (Т2 — предрейсовый медосмотр)');
      await takeScreenshot(page, 'checkpoint_logout_dispatcher_for_medic', env, 'Контрольная точка: выход из аккаунта диспетчера для медика');
      
      if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
        const action = await waitForUserConfirmation('Выйти из аккаунта диспетчера и войти под медиком (Т2)?', env);
        if (action === 'back') {
          console.log('[Taxcom] Пользователь выбрал откат. Останавливаю обработку.');
          return false;
        }
      } else {
        console.log('[ЭПЛ] Выход из диспетчера, вход под медиком...');
      }
      // Пауза перед релогином — даём титулу Т1 успеть сохраниться/подписаться на сервере
      console.log('[Taxcom] Ждём 5 сек, чтобы титул Т1 успел сохраниться на сервере перед релогином...');
      await page.waitForTimeout(5000);
      // Выходим из текущего аккаунта (диспетчера после подписания Т1)
      await logout(page, baseUrl, env);
      await takeScreenshot(page, 'logout_dispatcher_for_medic', env, 'Выход из аккаунта диспетчера для медика');
      
      // Логинимся под медиком
      if (!(await login(page, baseUrl, medicPhone, medicPass, env))) {
        console.warn('[Taxcom] Вход медика не удался. Пропускаю Т2.');
        return false;
      }
      return fillTitle2Core(page, baseUrl, env, item, mintransId, report);
    };
    
    // Функция для заполнения Т3 (механик)
    const fillTitle3 = async (mechanicPhone, mechanicPass) => {
      if (!mechanicPhone || !mechanicPass) return false;
      const technic = staff.technic || {};
      if (!staff.technic) console.log('[Taxcom] Подписываю Т3 по логину из .env (в заявке нет данных механика).');
      await closeModalDialogs(page, env);

      // Универсальный воркер: браузер уже под механиком, релогин не нужен
      if (env.UNIVERSAL_WORKER !== '1') {
        console.log('[Taxcom] [Т3] Логинюсь под механиком...');
        console.log('\n[Taxcom] ════════════════════════════════════════════════════════');
        console.log('[Taxcom] ⚠ КОНТРОЛЬНАЯ ТОЧКА: Выход из аккаунта медика');
        console.log('[Taxcom] Сейчас будет выход из аккаунта медика для входа под механиком (Т3 — техконтроль + Т4 — убытие)');
        await takeScreenshot(page, 'checkpoint_logout_medic_for_mechanic', env, 'Контрольная точка: выход из аккаунта медика для механика');
        if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
          const action = await waitForUserConfirmation('Выйти из аккаунта медика и войти под механиком (Т3 + Т4)?', env);
          if (action === 'back') {
            console.log('[Taxcom] Пользователь выбрал откат. Останавливаю обработку.');
            return false;
          }
        } else {
          console.log('[ЭПЛ] Выход из медика, вход под механиком...');
        }
        console.log('[Taxcom] Ждём 5 сек, чтобы титул Т2 успел сохраниться на сервере перед релогином...');
        await page.waitForTimeout(5000);
        await logout(page, baseUrl, env);
        await takeScreenshot(page, 'logout_medic_for_mechanic', env, 'Выход из аккаунта медика для механика');
        if (!(await login(page, baseUrl, mechanicPhone, mechanicPass, env))) {
          console.warn('[Taxcom] Вход механика не удался. Пропускаю Т3.');
          return false;
        }
      } else {
        console.log('[Taxcom] [Т3] Универсальный воркер: браузер механика уже залогинен, перехожу к Т3/Т4.');
      }

      // Сначала открываем главную страницу ЭПЛ (не напрямую к Т3)
      console.log('[Taxcom] [Т3] Открываю страницу ЭПЛ...');
      await page.goto(`${baseUrl}/waybill/${mintransId}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
      await takeScreenshot(page, 't3_epl_page', env, 'Страница ЭПЛ открыта (механик)');
      
      // Проверяем наличие ошибок на странице
      const errorElementsT3 = await page.locator('.error, .alert-danger, [class*="error"], [class*="Error"]').count();
      if (errorElementsT3 > 0) {
        const errorTextsT3 = await page.locator('.error, .alert-danger, [class*="error"]').allTextContents().catch(() => []);
        console.warn('[Taxcom] ⚠ Обнаружены ошибки на странице ЭПЛ:', errorTextsT3.join('; '));
        await takeScreenshot(page, 't3_error_on_epl_page', env, 'Ошибка на странице ЭПЛ');
      }
      
      // Пробуем найти кнопку "Заполнить" для Т3 и кликнуть на неё (несколько вариантов селекторов и прокрутка)
      console.log('[Taxcom] [Т3] Ищу кнопку "Заполнить" для Т3...');
      const fillT3Selectors = [
        () => page.locator('a[href*="/3/"]').filter({ hasText: 'Заполнить' }),
        () => page.locator(`a[href*="/waybill/${mintransId}/3/"]`),
        () => page.locator('a[href*="/3/"]').first()
      ];
      
      let t3FormOpened = false;
      for (const getLoc of fillT3Selectors) {
        const btn = getLoc();
        const count = await btn.count();
        if (count > 0) {
          const first = btn.first();
          const isVisible = await first.isVisible().catch(() => false);
          if (isVisible) {
            console.log('[Taxcom] Найдена кнопка "Заполнить" для Т3, кликаю...');
            await first.scrollIntoViewIfNeeded();
            await page.waitForTimeout(500);
            await first.click();
            await page.waitForTimeout(2000);
            await takeScreenshot(page, 't3_forma_opened', env, 'Форма Т3 открыта через кнопку');
            t3FormOpened = true;
            break;
          }
        }
      }
      
      // Если кнопка не найдена — прокручиваем вниз и пробуем ещё раз (форма Т3 может быть ниже)
      if (!t3FormOpened) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1000);
        const fillT3Again = page.locator('a[href*="/3/"]:has-text("Заполнить"), a[href*="/waybill/' + mintransId + '/3/"]').first();
        if ((await fillT3Again.count()) > 0 && await fillT3Again.isVisible().catch(() => false)) {
          console.log('[Taxcom] Найдена кнопка "Заполнить" для Т3 после прокрутки, кликаю...');
          await fillT3Again.scrollIntoViewIfNeeded();
          await fillT3Again.click();
          await page.waitForTimeout(2000);
          t3FormOpened = true;
        }
      }
      
      // Если кнопка так и не найдена, переходим напрямую по URL Т3
      if (!t3FormOpened) {
        console.log('[Taxcom] Кнопка "Заполнить" не найдена, перехожу напрямую к Т3...');
        await page.goto(`${baseUrl}/waybill/${mintransId}/3/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        await closeModalDialogs(page, env);
        await page.waitForTimeout(1500);
        // Ждём появления формы Т3 (поля или кнопки Подписать). Если видим модалку входа — мы не на форме.
        const t3FormMarker = page.locator('#TECHNIC_EXAMINATION_RESULT, #sign_btn, #date_contr, input[name="TECHNIC_EXAMINATION_DATE"]').first();
        let formVisible = false;
        for (let w = 0; w < 12; w++) {
          if ((await t3FormMarker.count()) > 0 && await t3FormMarker.isVisible().catch(() => false)) {
            formVisible = true;
            break;
          }
          const loginVisible = await page.locator('text=По логину').first().isVisible().catch(() => false);
          if (loginVisible) {
            console.log('[Taxcom] На странице Т3 открыта модалка входа — закрываю и жду форму...');
            await closeModalDialogs(page, env);
            await page.waitForTimeout(1000);
          }
          await page.waitForTimeout(500);
        }
        if (!formVisible) {
          console.log('[Taxcom] Форма Т3 не появилась после перехода по URL. Пробую открыть с обзорной страницы...');
          await page.goto(`${baseUrl}/waybill/${mintransId}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(2000);
          await closeModalDialogs(page, env);
          const openT3 = page.locator('a[href*="/3/"]').first();
          if ((await openT3.count()) > 0 && await openT3.isVisible().catch(() => false)) {
            await openT3.scrollIntoViewIfNeeded();
            await openT3.click();
            await page.waitForTimeout(2500);
          }
        }
      }
      
      await takeScreenshot(page, 't3_forma', env, 'Форма Т3 открыта');
      
      // Проверяем наличие ошибок на странице Т3
      const t3ErrorElements = await page.locator('.error, .alert-danger, [class*="error"], [class*="Error"], [class*="TypeError"]').count();
      if (t3ErrorElements > 0) {
        const t3ErrorTexts = await page.locator('.error, .alert-danger, [class*="error"], [class*="TypeError"]').allTextContents().catch(() => []);
        const fullPageTextT3 = await page.textContent('body').catch(() => '');
        const hasTypeErrorT3 = fullPageTextT3.includes('TypeError') || fullPageTextT3.includes('getTechnicId') || fullPageTextT3.includes('getMechanicId');
        
        if (hasTypeErrorT3) {
          console.error('[Taxcom] ⛔ КРИТИЧЕСКАЯ ОШИБКА: Механик не привязан к автопарку в системе Такском');
          console.error('[Taxcom] Ошибка:', t3ErrorTexts.join('; '));
          await takeScreenshot(page, 't3_critical_error', env, 'Критическая ошибка на странице Т3');
          console.error('[Taxcom]');
          console.error('[Taxcom] ⚠ РЕШЕНИЕ:');
          console.error('[Taxcom] 1. Зайди в систему Такском под администратором');
          console.error('[Taxcom] 2. Убедись, что механик привязан к нужному автопарку');
          console.error('[Taxcom] 3. Проверь, что у механика есть права на работу с ЭПЛ');
          console.error('[Taxcom] 4. После исправления перезапусти программу');
          return false;
        } else {
          console.warn('[Taxcom] ⚠ Обнаружены ошибки на странице Т3:', t3ErrorTexts.join('; '));
          await takeScreenshot(page, 't3_warning_errors', env, 'Предупреждения на странице Т3');
          // Продолжаем работу, возможно это не критично
        }
      }
      
      const technicParts = (technic.fullName || '').trim().split(/\s+/);
      const technicLastName = technic.lastName || technicParts[0] || '';
      const technicName = technic.firstName || technicParts[1] || '';
      const technicSecondName = technic.secondName || technicParts[2] || '';
      const technicPosition = technic.position || 'Механик';
      
      // Техконтроль: за 55 минут до убытия
      const examDate = getMoscowDateString(tTech);
      const examTime = getMoscowTimeString(tTech, true);
      // Выпуск на линию: за 49 минут до убытия (через 6 минут после техконтроля)
      const releaseLineDate = getMoscowDateString(tReleaseLine);
      const releaseLineTime = getMoscowTimeString(tReleaseLine, true);
      
      console.log('[Taxcom] [Т3] Заполняю данные механика...');
      
      // Результат контроля - "выпуск на линию разрешен" (value="1")
      let examResult = 'выпуск на линию разрешен';
      const examResultField = page.locator('#TECHNIC_EXAMINATION_RESULT, select[name="TECHNIC_EXAMINATION_RESULT"]').first();
      if ((await examResultField.count()) > 0) {
        await examResultField.selectOption('1');
        console.log('[Taxcom] ✓ Установлен результат контроля: выпуск на линию разрешен');
        await page.waitForTimeout(500);
      } else {
        examResult = 'не указан';
      }
      
      // Дата проведения контроля
      const examDateField = page.locator('#date_contr, #TECHNIC_EXAMINATION_DATE, input[name="TECHNIC_EXAMINATION_DATE"]').first();
      if ((await examDateField.count()) > 0) {
        await examDateField.fill(examDate);
        console.log(`[Taxcom] ✓ Заполнено: дата проведения контроля = ${examDate}`);
        await page.waitForTimeout(300);
      }
      
      // Время проведения контроля
      const examTimeField = page.locator('#time_contr, #TECHNIC_EXAMINATION_TIME, input[name="TECHNIC_EXAMINATION_TIME"]').first();
      if ((await examTimeField.count()) > 0) {
        await examTimeField.fill(examTime);
        console.log(`[Taxcom] ✓ Заполнено: время проведения контроля = ${examTime}`);
        await page.waitForTimeout(300);
      }
      
      // Дата выпуска на линию (отдельно от техконтроля, через 6 минут после)
      const tripStartDateField = page.locator('#TECHNIC_TRIP_START_DATE, input[name="TECHNIC_TRIP_START_DATE"]').first();
      if ((await tripStartDateField.count()) > 0) {
        await tripStartDateField.fill(releaseLineDate);
        console.log(`[Taxcom] ✓ Заполнено: дата выпуска на линию = ${releaseLineDate}`);
        await page.waitForTimeout(300);
      }
      
      // Время выпуска на линию (отдельно от техконтроля, через 6 минут после)
      const tripStartTimeField = page.locator('#TECHNIC_TRIP_START_TIME, input[name="TECHNIC_TRIP_START_TIME"]').first();
      if ((await tripStartTimeField.count()) > 0) {
        await tripStartTimeField.fill(releaseLineTime);
        console.log(`[Taxcom] ✓ Заполнено: время выпуска на линию = ${releaseLineTime}`);
        await page.waitForTimeout(300);
      }
      
      // Фамилия механика
      const technicLastNameField = page.locator('#TECHNIC_LAST_NAME, input[name="TECHNIC_LAST_NAME"]').first();
      if ((await technicLastNameField.count()) > 0 && technicLastName) {
        await technicLastNameField.fill(technicLastName);
        console.log(`[Taxcom] ✓ Заполнено: фамилия механика = ${technicLastName}`);
        await page.waitForTimeout(300);
      }
      
      // Имя механика
      const technicNameField = page.locator('#TECHNIC_NAME, input[name="TECHNIC_NAME"]').first();
      if ((await technicNameField.count()) > 0 && technicName) {
        await technicNameField.fill(technicName);
        console.log(`[Taxcom] ✓ Заполнено: имя механика = ${technicName}`);
        await page.waitForTimeout(300);
      }
      
      // Отчество механика
      const technicSecondNameField = page.locator('#TECHNIC_SECOND_NAME, input[name="TECHNIC_SECOND_NAME"]').first();
      if ((await technicSecondNameField.count()) > 0 && technicSecondName) {
        await technicSecondNameField.fill(technicSecondName);
        console.log(`[Taxcom] ✓ Заполнено: отчество механика = ${technicSecondName}`);
        await page.waitForTimeout(300);
      }
      
      // Должность механика
      const technicPositionField = page.locator('#job_tech, #TECHNIC_POSITION, input[name="TECHNIC_POSITION"]').first();
      if ((await technicPositionField.count()) > 0 && technicPosition) {
        await technicPositionField.fill(technicPosition);
        console.log(`[Taxcom] ✓ Заполнено: должность механика = ${technicPosition}`);
        await page.waitForTimeout(300);
      }
      
      // Данные ТС и подписанта в Т3 — Такском подставляет сам, не заполняем
      console.log('[Taxcom] [Т3] Данные ТС и подписанта подставляет Такском, пропускаем.');
      await takeScreenshot(page, 't3_vehicle_filled', env, 'Т3: данные механика заполнены');
      
      // Интерактивная пауза после заполнения Т3
      // examResult определена выше в коде (строка 2239)
      const examResultText = examResult || 'не указан';
      console.log('\n[Taxcom] ════════════════════════════════════════════════════════');
      console.log('[Taxcom] ✅ Т3 ЗАПОЛНЕН:');
      console.log(`[Taxcom]   - Механик: ${technicLastName} ${technicName} ${technicSecondName}`);
      console.log(`[Taxcom]   - Должность: ${technicPosition}`);
      console.log(`[Taxcom]   - Результат контроля: ${examResultText}`);
      console.log(`[Taxcom]   - ТС: ${driver.brand || '-'} ${driver.model || '-'}, гос. номер: ${driver.regNumber || '-'}`);
      console.log('[Taxcom] ════════════════════════════════════════════════════════');
      await takeScreenshot(page, 't3_zapolnen', env, 'Т3 (механик) заполнен');
      
      if (env.DEBUG_STEP_BY_STEP === '1' || env.DEBUG_STEP_BY_STEP === 'true') {
        const action = await waitForUserConfirmation('Т3 заполнен. Подписать?', env);
        if (action === 'back') return false;
      }
      console.log('[Taxcom] Проверяю ошибки валидации Т3...');
      const t3ValidationErrors = await page.locator('input.is-invalid, select.is-invalid, textarea.is-invalid, [aria-invalid="true"], .invalid-feedback:visible').count();
      if (t3ValidationErrors > 0) {
        console.error(`[Taxcom] ⛔ ОБНАРУЖЕНО ${t3ValidationErrors} ОШИБОК ВАЛИДАЦИИ В Т3!`);
        const t3ErrorFields = await page.locator('input.is-invalid, select.is-invalid').all();
        for (let i = 0; i < Math.min(t3ErrorFields.length, 10); i++) {
          const field = t3ErrorFields[i];
          let fieldName = await field.getAttribute('name').catch(() => null);
        if (!fieldName) {
          fieldName = await field.getAttribute('id').catch(() => null);
        }
        if (!fieldName) {
          fieldName = 'неизвестное поле';
        }
          const fieldValue = await field.inputValue().catch(() => '');
          const errorText = await field.evaluate(el => {
            const parent = el.closest('.form-group, .mb-3');
            if (parent) {
              const errorMsg = parent.querySelector('.invalid-feedback, .error-message');
              return errorMsg ? errorMsg.textContent.trim() : '';
            }
            return '';
          }).catch(() => '');
          console.error(`[Taxcom]   ⛔ Поле "${fieldName}" = "${fieldValue}": ${errorText || 'ошибка валидации'}`);
        }
        await takeScreenshot(page, 't3_validation_errors', env, 'Ошибки валидации Т3');
      }

      // Т3: после ввода данных — «Подписать», без «Сохранить», ждём 5 сек
      console.log('[Taxcom] Подписываю Т3 (кнопка «Подписать»)...');
      await closeModalDialogs(page, env);
      const signBtnT3 = page.locator('#sign_btn').first();
      let t3Signed = false;
      if ((await signBtnT3.count()) > 0 && await signBtnT3.isVisible().catch(() => false)) {
        await signBtnT3.click();
        t3Signed = await waitForSignSuccess(page, 'Т3', env, 60000);
        if (t3Signed) await page.waitForTimeout(3000);
      } else {
        t3Signed = await signTitle(page, 'Т3', 'mechanic', env, baseUrl, mintransId);
        if (t3Signed) await page.waitForTimeout(5000);
      }
      if (t3Signed) {
        await report(eplId, 't3', 'signed');
        console.log('[ЭПЛ] Подписал Т3 (механик). Заполняю Т4...');
        await page.waitForTimeout(3000);
      } else {
        console.warn('[ЭПЛ] Т3 подпись не подтверждена — не отправляю t3=signed. Заявка останется в очереди.');
      }

      // Т4 — показания одометра при выезде (механик, та же сессия после Т3)
      let t4Signed = false;
      if (t3Signed) {
        console.log('[Taxcom] [Т4] Перехожу к титулу 4 (одометр при выезде)...');
        await closeModalDialogs(page, env);
        // После подписи Т3 мы на форме Т3. Переходим на обзор путевого и открываем форму Т4 по кнопке «Заполнить», иначе Т4 может не открыться.
        await page.goto(`${baseUrl}/waybill/${mintransId}/1/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(2000);
        const fillT4Btn = page.locator('a[href*="/4/"]:has-text("Заполнить"), a[href*="/4/"], a[href*="/waybill/' + mintransId + '/4/"]').first();
        if ((await fillT4Btn.count()) > 0 && await fillT4Btn.isVisible().catch(() => false)) {
          console.log('[Taxcom] Открываю форму Т4 (кнопка «Заполнить»)...');
          await fillT4Btn.scrollIntoViewIfNeeded();
          await fillT4Btn.click();
          await page.waitForTimeout(2500);
        } else {
          await page.goto(`${baseUrl}/waybill/${mintransId}/4/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await page.waitForTimeout(2000);
        }
        const tripStartDateT4 = page.locator('#date_end_p, #TRIP_START_DATE, input[name="TRIP_START_DATE"]').first();
        if ((await tripStartDateT4.count()) > 0) {
          await tripStartDateT4.fill(dateFrom);
          console.log('[Taxcom] ✓ Т4: дата выезда =', dateFrom);
          await page.waitForTimeout(300);
        }
        const timeStrT4 = getMoscowTimeString(tRelease, true);
        const tripStartTimeT4 = page.locator('#time_end_p, #TRIP_START_TIME, input[name="TRIP_START_TIME"]').first();
        if ((await tripStartTimeT4.count()) > 0) {
          await tripStartTimeT4.fill(timeStrT4);
          console.log('[Taxcom] ✓ Т4: время выезда =', timeStrT4);
          await page.waitForTimeout(300);
        }
        const odometerT4 = page.locator('#ODOMETR_VALUE, input[name="ODOMETR_VALUE"]').first();
        if ((await odometerT4.count()) > 0 && startOdometer > 0) {
          await odometerT4.fill(String(startOdometer));
          console.log('[Taxcom] ✓ Т4: одометр при выезде =', startOdometer);
          await page.waitForTimeout(300);
        }
        // Т4: после ввода данных — «Подписать», без «Сохранить», ждём 5 сек
        try {
          await page.evaluate(() => {
            document.querySelectorAll('#ODOMETR_VALUE, input[name="ODOMETR_VALUE"], #TRIP_START_DATE, #TRIP_START_TIME').forEach(el => {
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            });
          });
        } catch (_) {}
        await page.waitForTimeout(500);
        console.log('[Taxcom] Подписываю Т4 (кнопка «Подписать»)...');
        await closeModalDialogs(page, env);
        const signBtnT4 = page.locator('#sign_btn').first();
        if ((await signBtnT4.count()) > 0 && await signBtnT4.isVisible().catch(() => false)) {
          await signBtnT4.click();
          t4Signed = await waitForSignSuccess(page, 'Т4', env, 60000);
          if (t4Signed) await page.waitForTimeout(3000);
        } else {
          t4Signed = await signTitle(page, 'Т4', 'mechanic', env, baseUrl, mintransId);
          if (t4Signed) await page.waitForTimeout(5000);
        }
        if (t4Signed) {
          await report(eplId, 't4', 'signed');
          console.log('[ЭПЛ] Подписал Т4 (механик). Все титулы Т1–Т4 обработаны.');
        } else {
          console.warn('[ЭПЛ] Т4 заполнен, но подпись не подтверждена — не отправляю t4=signed. Заявка останется в очереди.');
        }
      }

      return t3Signed && t4Signed;
    };
    
    let t3t4Signed = false;
    const mechanicPhone = env.TAKSKOM_MECHANIC_PHONE || '';
    const mechanicPass = env.TAKSKOM_MECHANIC_PASSWORD || '';

    if (startFromT3) {
      if (mechanicPhone && mechanicPass) {
        console.log('[ЭПЛ] Продолжение с Т3 (механик) — техконтроль + Т4...');
        t3t4Signed = await fillTitle3(mechanicPhone, mechanicPass);
        if (!t3t4Signed) {
          console.error('[Taxcom] ⛔ Т3 или Т4 НЕ ПОДПИСАНЫ при продолжении.');
          throw new Error('Т3/Т4 не подписаны — подпиши вручную в Такском или проверь логи.');
        }
      } else {
        throw new Error('TAKSKOM_MECHANIC_PHONE/PASSWORD не заданы — нельзя подписать Т3/Т4.');
      }
    } else {
    // После сохранения Т1 переходим на обзор, открываем форму Т1 и подписываем
    console.log('[ЭПЛ] Подписываю Т1 (диспетчер)...');
    await closeModalDialogs(page, env);
    await page.goto(`${baseUrl}/waybill/${mintransId}/1/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);
    const fillT1Btn = page.locator('a:has-text("Заполнить"), button:has-text("Заполнить")').first();
    if ((await fillT1Btn.count()) > 0 && await fillT1Btn.isVisible().catch(() => false)) {
      await fillT1Btn.scrollIntoViewIfNeeded();
      await fillT1Btn.click();
      await page.waitForTimeout(3000);
    }
    const signBtnT1 = page.locator('#sign_btn').first();
    if ((await signBtnT1.count()) > 0 && await signBtnT1.isVisible().catch(() => false)) {
      await signBtnT1.scrollIntoViewIfNeeded();
      await signBtnT1.click();
      console.log('[Taxcom] Кнопка «Подписать» Т1 нажата, жду 15 сек...');
      await page.waitForTimeout(15000);
    } else {
      const t1Signed = await signTitle(page, 'Т1', 'dispatcher', env, baseUrl, mintransId);
      if (t1Signed) await page.waitForTimeout(15000);
    }
    await report(eplId, 't1', 'signed', mintransId);
    console.log('[ЭПЛ] Подписал Т1 (диспетчер). Жду 10 сек перед переходом к Т2 (медик)...');
    await page.waitForTimeout(10000);

    // Режим «только Т1»: воркер диспетчера отдаёт заявку медику/механику в других окнах
    if (env.TAXCOM_STAGE === 't1-only') {
      console.log('[Taxcom] TAXCOM_STAGE=t1-only — завершаю после Т1, дальше медик/механик в своих воркерах.');
      return {
        mintransId,
        eplGuid: null,
        eplId: item.eplId,
        qrCode: null,
        documentPdf: null,
        page,
        context: persistentContext || (browser && context) || context
      };
    }

    // Заполняем и подписываем Т2 (медик) - ПЕРВЫМ после Т1 (медосмотр ДО техконтроля и убытия)
    let t2Signed = false;
    const medicPhone = env.TAKSKOM_MEDIC_PHONE || '';
    const medicPass = env.TAKSKOM_MEDIC_PASSWORD || '';
    if (medicPhone && medicPass) {
      console.log('[ЭПЛ] Заполняю Т2 (медик) — предрейсовый медосмотр...');
      t2Signed = await fillTitle2(medicPhone, medicPass);
      if (!t2Signed) {
        console.error('[Taxcom] ⛔ Т2 НЕ ПОДПИСАН! ЭПЛ остаётся в очереди для повторной обработки.');
        throw new Error('Т2 не подписан — подпиши вручную в Такском или проверь логи.');
      }
    } else {
      console.warn('[Taxcom] Не заданы TAKSKOM_MEDIC_PHONE и TAKSKOM_MEDIC_PASSWORD. Т2 пропущен.');
      throw new Error('TAKSKOM_MEDIC_PHONE/PASSWORD не заданы — нельзя подписать Т2.');
    }

    // Заполняем и подписываем Т3 + Т4 (механик)
    if (mechanicPhone && mechanicPass) {
      console.log('[ЭПЛ] Заполняю Т3 (механик) — техконтроль + Т4 убытие...');
      t3t4Signed = await fillTitle3(mechanicPhone, mechanicPass);
      if (!t3t4Signed) {
        console.error('[Taxcom] ⛔ Т3 или Т4 НЕ ПОДПИСАНЫ! ЭПЛ остаётся в очереди для повторной обработки.');
        throw new Error('Т3/Т4 не подписаны — подпиши вручную в Такском или проверь логи.');
      }
    } else {
      console.warn('[Taxcom] Не заданы TAKSKOM_MECHANIC_PHONE и TAKSKOM_MECHANIC_PASSWORD. Т3 пропущен.');
      throw new Error('TAKSKOM_MECHANIC_PHONE/PASSWORD не заданы — нельзя подписать Т3/Т4.');
    }

    } // end else (!startFromT3)

    // Жёсткая проверка: убедиться, что на странице Такском все 4 титула подписаны
    const allSigned = await verifyAllTitlesSignedOnPage(page, baseUrl, mintransId);
    if (!allSigned) {
      console.error('[Taxcom] ⛔ Верификация подписей не прошла: не все титулы Т1–Т4 подписаны на странице. ЭПЛ остаётся в очереди.');
      throw new Error('Не все титулы Т1–Т4 подписаны — проверь в Такском вручную.');
    }
    console.log('[Taxcom] ✓ Верификация: все титулы Т1–Т4 подписаны.');
    console.log('[ЭПЛ] Готово: ЭПЛ создан и подписан (Т1, Т2, Т3, Т4). mintransId:', mintransId);

    // 1) Скачиваем PDF и сразу отправляем на сайт
    let documentPdf = null;
    const pdfUrl = `${baseUrl}/waybill/${mintransId}/print/download/pdf`;
    try {
      const response = await page.request.get(pdfUrl, { timeout: 30000 });
      if (response.ok()) {
        const body = await response.body();
        documentPdf = body.toString('base64');
        console.log('[Taxcom] PDF документа скачан, отправлю на сайт.');
      } else {
        console.warn('[Taxcom] PDF: ответ', response.status());
      }
    } catch (pdfErr) {
      console.warn('[Taxcom] Скачивание PDF:', pdfErr.message);
    }

    const apiUrl = (env.API_URL || 'http://localhost:5000').replace(/\/$/, '');
    const apiKey = env.SIGNER_API_KEY || env.CLINIC_API_KEY || '';
    const headers = apiKey ? { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };

    if (documentPdf && apiUrl && apiKey) {
      try {
        const eplRes = await fetch(`${apiUrl}/api/clinic/epl-created`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ eplId: item.eplId, mintransId, documentPdf })
        });
        if (eplRes.ok) {
          console.log('[Taxcom] PDF отправлен на сайт.');
        } else {
          console.warn('[Taxcom] Ответ epl-created:', eplRes.status, await eplRes.text().catch(() => ''));
        }
      } catch (e) {
        console.warn('[Taxcom] Ошибка отправки PDF на сайт:', e.message);
      }
    }

    // Кнопка «Скачать» PDF (ссылка на Такском)
    console.log('[Taxcom] Скачать PDF:', `${baseUrl}/waybill/${mintransId}/print/download/pdf`);

    // 2) Механик остаётся на странице ЭПЛ: ждём 1 минуту, затем обновляем страницу и ищем QR
    const waybillPageUrl = `${baseUrl}/waybill/${mintransId}/`;
    console.log('[Taxcom] Жду 1 мин на странице ЭПЛ, затем обновлю страницу и буду искать QR-код...');
    await page.waitForTimeout(60000);

    let qrCode = null;
    const QR_MIN_BYTES = 6000;

    function tryGetQrFromPage() {
      return page.evaluate((minBytes) => {
        const img = document.querySelector('img[alt*="Qr-код" i], img[alt*="QR" i][src*="base64"], img[src*="base64"]');
        if (!img || !img.src) return null;
        let s = img.src;
        if (s.includes('&gt;')) s = s.replace(/&gt;/g, '');
        if (!s.startsWith('data:') || !s.includes('base64,')) return null;
        try {
          const base64Part = s.split('base64,')[1];
          if (!base64Part) return null;
          const binary = atob(base64Part);
          if (binary.length >= minBytes) return s;
        } catch (_) {}
        return null;
      }, QR_MIN_BYTES);
    }

    // 3) До 3 попыток: обновить страницу ЭПЛ → раскрыть блок с QR → взять img
    for (let attempt = 1; attempt <= 3 && !qrCode; attempt++) {
      try {
        await page.goto(waybillPageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(3000);
        const collapseTrigger = await page.$('[data-bs-target="#qr-collapse-block"]');
        if (collapseTrigger) {
          await collapseTrigger.click().catch(() => {});
          await page.waitForTimeout(1500);
        } else {
          await page.evaluate(() => {
            const block = document.getElementById('qr-collapse-block');
            if (block) block.classList.add('show');
          }).catch(() => {});
          await page.waitForTimeout(1000);
        }
        const qrImgSelector = 'img[alt*="Qr-код" i][src*="base64"], img[alt*="QR" i][src*="data:"], img[src*="base64"]';
        await page.waitForSelector(qrImgSelector, { state: 'visible', timeout: 8000 }).catch(() => null);
        qrCode = await tryGetQrFromPage();
        if (qrCode) {
          console.log('[Taxcom] QR найден на странице ЭПЛ после обновления (попытка ' + attempt + '), отправляю на сайт.');
          break;
        }
      } catch (pageErr) {
        console.warn('[Taxcom] Попытка ' + attempt + ' вылова QR со страницы:', pageErr.message);
      }
      if (!qrCode && attempt < 3) await page.waitForTimeout(10000);
    }

    // Запасной вариант: по ссылке ?action=load (если на странице QR не появился)
    if (!qrCode) {
      console.log('[Taxcom] Пробую забрать QR по ссылке ?action=load...');
      for (let attempt = 1; attempt <= 3 && !qrCode; attempt++) {
        try {
          const res = await page.request.get(`${waybillPageUrl}?action=load`, { timeout: 12000, headers: { Accept: 'image/png, image/gif, image/jpeg, */*' } });
          if (res.ok()) {
            const body = await res.body();
            const ct = (res.headers() || {})['content-type'] || '';
            if (body && body.length >= QR_MIN_BYTES && (ct.includes('image/') || ct.includes('octet-stream'))) {
              const mime = ct.includes('image/gif') ? 'image/gif' : 'image/png';
              qrCode = 'data:' + mime + ';base64,' + body.toString('base64');
              console.log('[Taxcom] QR получен по ?action=load (попытка ' + attempt + ').');
            }
          }
        } catch (_) {}
        if (!qrCode && attempt < 3) await page.waitForTimeout(10000);
      }
    }
    if (!qrCode) {
      console.warn('[Taxcom] QR за 3 обновления страницы и 3 попытки ?action=load не получен (можно перезалить: refetch-qr-once.js).');
    }
    if (qrCode && apiUrl && apiKey) {
      try {
        const qrRes = await fetch(`${apiUrl}/api/clinic/epl/${item.eplId}/qr`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ qrCode })
        });
        if (qrRes.ok) {
          console.log('[Taxcom] QR отправлен на сайт.');
        } else {
          console.warn('[Taxcom] Ответ epl/qr:', qrRes.status);
        }
      } catch (e) {
        console.warn('[Taxcom] Ошибка отправки QR на сайт:', e.message);
      }
    }

    const keepOpen = env.TAXCOM_KEEP_BROWSER_OPEN === '1' || env.TAXCOM_KEEP_BROWSER_OPEN === 'true';
    if (keepOpen) {
      console.log('[Taxcom] TAXCOM_KEEP_BROWSER_OPEN=1 — браузер оставлен открытым для отладки, закрывать вручную.');
    }
    return { mintransId, eplGuid: null, eplId: item.eplId, qrCode, documentPdf, eplAlreadySent: true, page, context: persistentContext || (browser && context) || context };
  } catch (e) {
    console.error('[Taxcom] ⛔ КРИТИЧЕСКАЯ ОШИБКА:', e.message);
    console.error('[Taxcom]', SCREENSHOTS_ERR_HINT);
    if (e.stack) {
      console.error('[Taxcom] Стек ошибки:', e.stack);
    }
    const keepOpen = env.TAXCOM_KEEP_BROWSER_OPEN === '1' || env.TAXCOM_KEEP_BROWSER_OPEN === 'true';
    if (keepOpen) {
      console.log('[Taxcom] TAXCOM_KEEP_BROWSER_OPEN=1 — браузер оставлен открытым после ошибки, закрой его вручную.');
    } else if (browser) {
      await browser.close().catch(() => {});
    } else if (persistentContext) {
      await persistentContext.close().catch(() => {});
    }
    return null;
  }
}

/**
 * Заполнение и подписание Т5 и Т6 через Playwright (завершение рейса)
 * @param {Object} item - Данные ЭПЛ: { eplId, mintransId, endOdometer, driver, staff }
 * @param {Object} env - Переменные окружения
 * @param {Object} [existingPage] - Если передан (вместе с existingContext) — используем этот браузер, новый не запускаем
 * @param {Object} [existingContext] - Контекст от создания ЭПЛ (та же сессия)
 */
async function completeEplInTaxcom(item, env, existingPage, existingContext) {
  const { chromium } = getPlaywright();
  if (!chromium) {
    console.warn('[Taxcom] playwright-core не установлен. Выполни в signer-client: npm install playwright-core');
    return false;
  }

  const { mintransId, endOdometer, driver = {}, staff = {} } = item;
  
  if (!mintransId || !endOdometer) {
    console.warn('[Taxcom] Не указаны mintransId или endOdometer для Т5/Т6');
    return false;
  }

  // Время выезда на линию из заявки (то же, что и в createEplInTaxcom)
  const createdAt = parseUtcDate(item.createdAt);
  createdAt.setSeconds(0, 0);
  const tRelease = createdAt;
  console.log(`[Taxcom] [Т5/Т6] Время выезда из заявки (tRelease по МСК): ${getMoscowTimeString(tRelease, true)}`);

  const baseUrl = (env.TAKSKOM_URL || 'https://epl.taxcom.ru').replace(/\/$/, '');
  let browser = null;
  let persistentContext = null;
  let context;
  let page;
  const useExistingBrowser = existingPage && existingContext;

  if (useExistingBrowser) {
    console.log('[Taxcom] Использую тот же браузер для Т5/Т6 (без нового запуска).');
    page = existingPage;
    context = existingContext;
  } else {
    let browserPath = (env.CHROMIUM_GOST_PATH || '').trim();
    if ((env.USE_YANDEX_BROWSER === '1' || env.USE_YANDEX_BROWSER === 'true') && !browserPath) {
      const localAppData = process.env.LOCALAPPDATA || process.env.USERPROFILE || '';
      const yandexExe = localAppData ? path.join(localAppData, 'Yandex', 'YandexBrowser', 'Application', 'browser.exe') : '';
      if (yandexExe && fs.existsSync(yandexExe)) browserPath = yandexExe;
    }
    let userDataDir = (env.TAXCOM_USER_DATA_DIR || '').trim();
    if (!userDataDir && browserPath) {
      const exeDir = path.dirname(browserPath);
      const pathLower = browserPath.toLowerCase();
      const localAppData = process.env.LOCALAPPDATA || process.env.USERPROFILE || '';
      if (pathLower.includes('yandex')) {
        const yandexUserData = localAppData ? path.join(localAppData, 'Yandex', 'YandexBrowser', 'User Data') : '';
        if (yandexUserData && fs.existsSync(yandexUserData)) userDataDir = yandexUserData;
      }
      if (!userDataDir) {
        const nextToExe = path.join(exeDir, 'User Data');
        const oneLevelUp = path.join(path.dirname(exeDir), 'User Data');
        if (fs.existsSync(nextToExe)) userDataDir = nextToExe;
        else if (fs.existsSync(oneLevelUp)) userDataDir = oneLevelUp;
        else if (exeDir.includes('Chromium') && localAppData) userDataDir = path.join(localAppData, 'Chromium', 'User Data');
      }
    }
    const launchOptions = { headless: userDataDir ? false : (env.TAXCOM_HEADLESS !== '0') };
    if (browserPath) launchOptions.executablePath = browserPath;
    const persistentContextOptions = {
      locale: 'ru-RU',
      headless: false,
      channel: browserPath ? undefined : 'chrome',
      executablePath: browserPath || undefined,
      ignoreDefaultArgs: ['--disable-extensions']
    };
    if (userDataDir) {
      console.log('[Taxcom] Запускаю браузер для Т5/Т6 (КриптоПро)...');
      try {
        persistentContext = await chromium.launchPersistentContext(userDataDir, persistentContextOptions);
      } catch (launchErr) {
        if (launchErr.message && launchErr.message.includes('closed')) {
          console.warn('[Taxcom] Профиль занят (закрой Chromium после создания ЭПЛ). Через 25 сек повторю запуск для Т5/Т6.');
          await new Promise(r => setTimeout(r, 25000));
          persistentContext = await chromium.launchPersistentContext(userDataDir, persistentContextOptions);
        } else {
          throw launchErr;
        }
      }
      context = persistentContext;
      page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    } else {
      console.log('[Taxcom] Запускаю браузер для Т5/Т6...');
      browser = await chromium.launch(launchOptions);
      context = await browser.newContext({ locale: 'ru-RU' });
      page = await context.newPage();
    }
  }

  try {
    page.setDefaultTimeout(60000);

    // Функция для навигации к титулу
    const navigateToTitle = async (titleNumber) => {
      try {
        const titleSelectors = [
          page.locator(`a:has-text("Т${titleNumber}"), a:has-text("Титул ${titleNumber}")`).first(),
          page.locator(`[role="tab"]:has-text("Т${titleNumber}")`).first(),
          page.locator(`.tab:has-text("Т${titleNumber}")`).first(),
          page.locator(`a[href*="t${titleNumber}"], a[href*="title${titleNumber}"]`).first(),
          page.locator(`button:has-text("Т${titleNumber}")`).first()
        ];
        
        for (const selector of titleSelectors) {
          const count = await selector.count();
          if (count > 0) {
            const isVisible = await selector.isVisible().catch(() => false);
            if (isVisible) {
              await selector.scrollIntoViewIfNeeded();
              await page.waitForTimeout(500);
              await selector.click();
              await page.waitForTimeout(2000);
              return true;
            }
          }
        }
        
        // Если не нашли через селекторы, пробуем через URL
        await page.goto(`${baseUrl}/waybill/${mintransId}/${titleNumber}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        return true;
      } catch (err) {
        console.warn(`[Taxcom] Не удалось перейти к Т${titleNumber}:`, err.message);
        return false;
      }
    };

    // Заполняем и подписываем Т5 (механик) - одометр заезда
    const mechanicPhone = env.TAKSKOM_MECHANIC_PHONE || '';
    const mechanicPass = env.TAKSKOM_MECHANIC_PASSWORD || '';
    let t5Success = false;
    
    const technic = staff.technic || {};
    if (mechanicPhone && mechanicPass) {
      console.log('[Taxcom] [Т5] Логинюсь под механиком...');
      if (await login(page, baseUrl, mechanicPhone, mechanicPass, env)) {
        await page.goto(`${baseUrl}/waybill/${mintransId}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        await takeScreenshot(page, 't5_epl_page', env, 'Страница ЭПЛ открыта (механик для Т5)');
        
        // Проверяем доступ к ЭПЛ
        const accessDenied = page.locator('text=/нет доступа|доступ запрещён|недостаточно прав|access denied/i').first();
        if ((await accessDenied.count()) > 0) {
          const errorText = await accessDenied.textContent().catch(() => '');
          console.error(`[Taxcom] ⛔ НЕТ ДОСТУПА К ЭПЛ для механика: ${errorText}`);
          await takeScreenshot(page, 't5_access_denied', env, 'Нет доступа к ЭПЛ (механик)');
          t5Success = false;
        } else if (await navigateToTitle(5)) {
          await takeScreenshot(page, 't5_forma', env, 'Форма Т5 открыта');
          
          const technicParts = (technic.fullName || '').trim().split(/\s+/);
          const technicLastName = technic.lastName || technicParts[0] || '';
          const technicName = technic.firstName || technicParts[1] || '';
          const technicSecondName = technic.secondName || technicParts[2] || '';
          const technicPosition = technic.position || 'Механик';
          
          const arrivalBase = new Date(tRelease.getTime() + 15 * 60 * 1000);
          const recordDate = getMoscowDateString(arrivalBase); // ДД.ММ.ГГГГ по МСК
          const recordTime = getMoscowTimeString(arrivalBase, false);
          
          console.log('[Taxcom] [Т5] Заполняю данные одометра заезда...');
          
          // Заполняем поля Т5 с скриншотами после каждого поля
          const fillField = async (selectors, value, label) => {
            if (!value) return false;
            for (const sel of selectors) {
              const field = page.locator(sel).first();
              if ((await field.count()) > 0) {
                const isVisible = await field.isVisible().catch(() => false);
                if (!isVisible) {
                  await field.scrollIntoViewIfNeeded();
                  await page.waitForTimeout(300);
                }
                await field.fill(String(value));
                console.log(`[Taxcom] ✓ Заполнено: ${label} = ${value}`);
                await page.waitForTimeout(300);
                // Скриншот после заполнения каждого поля
                await takeScreenshot(page, `t5_field_${label.replace(/[^a-zа-я0-9]/gi, '_')}`, env, `Т5: заполнено поле ${label}`);
                return true;
              }
            }
            return false;
          };
          
          await fillField(['#T5_ARRIVAL_DATE', 'input[name*="ARRIVAL_DATE"]'], recordDate, 'дата заезда');
          await fillField(['#T5_ARRIVAL_TIME', 'input[name*="ARRIVAL_TIME"]'], recordTime, 'время заезда');
          await fillField(['#T5_ODOMETER', 'input[name*="ODOMETER"]'], String(endOdometer), 'одометр заезда');
          await fillField(['#T5_AUTHORIZED_LAST_NAME', 'input[name*="AUTHORIZED_LAST_NAME"]'], technicLastName, 'фамилия механика');
          await fillField(['#T5_AUTHORIZED_NAME', 'input[name*="AUTHORIZED_NAME"]'], technicName, 'имя механика');
          await fillField(['#T5_AUTHORIZED_SECOND_NAME', 'input[name*="AUTHORIZED_SECOND_NAME"]'], technicSecondName, 'отчество механика');
          await fillField(['#T5_AUTHORIZED_POSITION', 'input[name*="AUTHORIZED_POSITION"]'], technicPosition, 'должность механика');
          
          await takeScreenshot(page, 't5_zapolnen', env, 'Т5 заполнен полностью');
          
          // Проверяем ошибки валидации перед сохранением
          console.log('[Taxcom] [Т5] Проверяю ошибки валидации перед сохранением...');
          await page.waitForTimeout(1000);
          const validationErrors = await page.locator('input.is-invalid, select.is-invalid, textarea.is-invalid, [aria-invalid="true"], .invalid-feedback, .error-message, .alert-danger').all();
          if (validationErrors.length > 0) {
            console.warn(`[Taxcom] ⚠ Обнаружено ${validationErrors.length} ошибок валидации на странице Т5`);
            for (const errEl of validationErrors.slice(0, 5)) {
              const errText = await errEl.textContent().catch(() => '');
              if (errText && errText.trim()) {
                console.warn(`[Taxcom]   - Ошибка: ${errText.trim()}`);
              }
            }
            await takeScreenshot(page, 't5_validation_errors', env, 'Ошибки валидации Т5');
          }
          
          // Сохраняем Т5
          console.log('[Taxcom] [Т5] Сохраняю Т5...');
          await closeModalDialogs(page, env);
          
          // Ждём активации кнопки "Сохранить" (может быть disabled из-за незаполненных полей)
          const saveT5Btn = page.locator('#save_btn, button:has-text("Сохранить"), button[id*="save"]').first();
          let saveT5Success = false;
          if ((await saveT5Btn.count()) > 0) {
            // Ждём до 10 секунд, пока кнопка станет enabled
            for (let i = 0; i < 20; i++) {
              const isVisible = await saveT5Btn.isVisible().catch(() => false);
              const isEnabled = await saveT5Btn.isEnabled().catch(() => false);
              if (isVisible && isEnabled) {
                await saveT5Btn.scrollIntoViewIfNeeded();
                await page.waitForTimeout(500);
                await saveT5Btn.click({ timeout: 5000 });
                await page.waitForTimeout(2000); // Увеличиваем время ожидания после сохранения
                
                // Проверяем, что сохранение прошло успешно
                const saveSuccess = page.locator('text=/сохранён|сохранено|успешно.*сохран|saved/i').first();
                if ((await saveSuccess.count()) > 0) {
                  const successText = await saveSuccess.textContent().catch(() => '');
                  console.log(`[Taxcom] ✓ Т5 сохранён успешно. Сообщение: ${successText}`);
                } else {
                  console.log('[Taxcom] ✓ Т5 сохранён (сообщение об успехе не найдено, но кнопка была нажата)');
                }
                
                saveT5Success = true;
                await takeScreenshot(page, 't5_saved', env, 'Т5 сохранён');
                
                // Дополнительное ожидание для активации кнопки "Подписать"
                await page.waitForTimeout(2000);
                break;
              }
              await page.waitForTimeout(500);
            }
            if (!saveT5Success) {
              console.warn('[Taxcom] ⚠ Кнопка "Сохранить" для Т5 не активировалась. Проверь заполнение всех обязательных полей.');
              await takeScreenshot(page, 't5_save_button_disabled', env, 'Кнопка Сохранить Т5 неактивна');
              // Пробуем найти причину - какие поля не заполнены
              try {
                const emptyRequiredFields = await page.locator('input[required]:not([value]), select[required]:not([value]), textarea[required]:not([value])').all();
                if (emptyRequiredFields.length > 0) {
                  console.warn(`[Taxcom] ⚠ Найдено ${emptyRequiredFields.length} незаполненных обязательных полей в Т5`);
                  for (const field of emptyRequiredFields.slice(0, 5)) {
                    try {
                      let fieldName = await field.getAttribute('name');
                      if (!fieldName) {
                        fieldName = await field.getAttribute('id');
                      }
                      if (!fieldName) {
                        fieldName = 'неизвестное поле';
                      }
                      console.warn(`[Taxcom]   - Незаполненное поле Т5: ${fieldName}`);
                    } catch (fieldErr) {
                      console.warn(`[Taxcom]   - Незаполненное поле Т5: неизвестное`);
                    }
                  }
                }
              } catch (emptyFieldsErr) {
                // Игнорируем ошибки при поиске незаполненных полей
              }
            }
          } else {
            console.warn('[Taxcom] ⚠ Кнопка "Сохранить" для Т5 не найдена');
            await takeScreenshot(page, 't5_no_save_button', env, 'Кнопка Сохранить Т5 не найдена');
          }
          
          // Подписываем Т5
          if (saveT5Success) {
            // Дополнительная проверка: возможно, нужно перезагрузить страницу или подождать дольше
            console.log('[Taxcom] [Т5] Ожидаю активации кнопки "Подписать" после сохранения...');
            await page.waitForTimeout(2000);
            
            // Проверяем, что нет ошибок на странице
            const pageErrors = await page.locator('.alert-danger, .error, .alert-error, text=/ошибка|error/i').all();
            if (pageErrors.length > 0) {
              console.warn(`[Taxcom] ⚠ Обнаружено ${pageErrors.length} ошибок на странице после сохранения Т5`);
              for (const errEl of pageErrors.slice(0, 3)) {
                const errText = await errEl.textContent().catch(() => '');
                if (errText && errText.trim()) {
                  console.warn(`[Taxcom]   - Ошибка: ${errText.trim()}`);
                }
              }
              await takeScreenshot(page, 't5_errors_after_save', env, 'Ошибки после сохранения Т5');
            }
            
            t5Success = await signTitle(page, 'Т5', 'mechanic', env, baseUrl, mintransId);
          } else {
            console.warn('[Taxcom] ⚠ Т5 не сохранён, пропускаю подписание');
            t5Success = false;
          }
          if (t5Success) {
            console.log('[Taxcom] ✅ Т5 ПОДПИСАН МЕХАНИКОМ');
          }
        }
      }
    } else {
      console.warn('[Taxcom] Не заданы данные механика для Т5. Т5 пропущен.');
    }
    
    // Заполняем и подписываем Т6 (медик) - послерейсовый медосмотр
    const medicPhone = env.TAKSKOM_MEDIC_PHONE || '';
    const medicPass = env.TAKSKOM_MEDIC_PASSWORD || '';
    let t6Success = false;
    
    if (medicPhone && medicPass && staff.medic) {
      console.log('[Taxcom] [Т6] Выхожу из аккаунта механика...');
      await page.waitForTimeout(2000); // Пауза перед сменой аккаунта
      await logout(page, baseUrl, env);
      await takeScreenshot(page, 'logout_mechanic_t6', env, 'Выход из аккаунта механика перед Т6');
      
      console.log('[Taxcom] [Т6] Логинюсь под медиком...');
      if (await login(page, baseUrl, medicPhone, medicPass, env)) {
        await page.goto(`${baseUrl}/waybill/${mintransId}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        await takeScreenshot(page, 't6_epl_page', env, 'Страница ЭПЛ открыта (медик для Т6)');
        
        // Проверяем доступ к ЭПЛ
        const accessDenied = page.locator('text=/нет доступа|доступ запрещён|недостаточно прав|access denied/i').first();
        if ((await accessDenied.count()) > 0) {
          const errorText = await accessDenied.textContent().catch(() => '');
          console.error(`[Taxcom] ⛔ НЕТ ДОСТУПА К ЭПЛ для медика: ${errorText}`);
          await takeScreenshot(page, 't6_access_denied', env, 'Нет доступа к ЭПЛ (медик)');
          t6Success = false;
        } else if (await navigateToTitle(6)) {
          await takeScreenshot(page, 't6_forma', env, 'Форма Т6 открыта');
          
          // Правильный порядок ФИО: lastName, firstName, secondName
          const medicLastName = staff.medic.lastName || (staff.medic.fullName ? staff.medic.fullName.trim().split(/\s+/)[0] : '') || '';
          const medicName = staff.medic.firstName || (staff.medic.fullName ? staff.medic.fullName.trim().split(/\s+/)[1] : '') || '';
          const medicSecondName = staff.medic.secondName || (staff.medic.fullName ? staff.medic.fullName.trim().split(/\s+/)[2] : '') || '';
          const medicPosition = staff.medic.position || 'Медицинский работник';
          
          console.log(`[Taxcom] [Т6] Данные медика: Фамилия=${medicLastName}, Имя=${medicName}, Отчество=${medicSecondName}, Должность=${medicPosition}`);
          
          const postMedBase = new Date(tRelease.getTime() + 20 * 60 * 1000);
          const examDate = getMoscowDateString(postMedBase); // ДД.ММ.ГГГГ по МСК
          const examTime = getMoscowTimeString(postMedBase, false);
          
          console.log('[Taxcom] [Т6] Заполняю данные послерейсового медосмотра...');
          
          // Заполняем поля Т6 с скриншотами после каждого поля
          const fillField = async (selectors, value, label) => {
            if (!value) return false;
            for (const sel of selectors) {
              const field = page.locator(sel).first();
              if ((await field.count()) > 0) {
                const isVisible = await field.isVisible().catch(() => false);
                if (!isVisible) {
                  await field.scrollIntoViewIfNeeded();
                  await page.waitForTimeout(300);
                }
                await field.fill(String(value));
                console.log(`[Taxcom] ✓ Заполнено: ${label} = ${value}`);
                await page.waitForTimeout(300);
                // Скриншот после заполнения каждого поля
                await takeScreenshot(page, `t6_field_${label.replace(/[^a-zа-я0-9]/gi, '_')}`, env, `Т6: заполнено поле ${label}`);
                return true;
              }
            }
            return false;
          };
          
          await fillField(['#T6_EXAM_DATE', 'input[name*="EXAM_DATE"]'], examDate, 'дата медосмотра');
          await fillField(['#T6_EXAM_TIME', 'input[name*="EXAM_TIME"]'], examTime, 'время медосмотра');
          
          // Результат медосмотра
          const examResultField = page.locator('#T6_EXAM_RESULT, select[name*="EXAM_RESULT"]').first();
          if ((await examResultField.count()) > 0) {
            await examResultField.scrollIntoViewIfNeeded();
            await page.waitForTimeout(300);
            await examResultField.selectOption('1').catch(() => examResultField.selectOption('ALLOWED'));
            console.log('[Taxcom] ✓ Установлен результат медосмотра: годен');
            await page.waitForTimeout(300);
            await takeScreenshot(page, 't6_field_result', env, 'Т6: установлен результат медосмотра');
          }
          
          await fillField(['#T6_MEDIC_LAST_NAME', 'input[name*="MEDIC_LAST_NAME"]'], medicLastName, 'фамилия медика');
          await fillField(['#T6_MEDIC_NAME', 'input[name*="MEDIC_NAME"]'], medicName, 'имя медика');
          await fillField(['#T6_MEDIC_SECOND_NAME', 'input[name*="MEDIC_SECOND_NAME"]'], medicSecondName, 'отчество медика');
          await fillField(['#T6_MEDIC_POSITION', 'input[name*="MEDIC_POSITION"]'], medicPosition, 'должность медика');
          
          await takeScreenshot(page, 't6_zapolnen', env, 'Т6 заполнен полностью');
          
          // Проверяем ошибки валидации перед сохранением
          console.log('[Taxcom] [Т6] Проверяю ошибки валидации перед сохранением...');
          await page.waitForTimeout(1000);
          const validationErrors = await page.locator('input.is-invalid, select.is-invalid, textarea.is-invalid, [aria-invalid="true"], .invalid-feedback, .error-message, .alert-danger').all();
          if (validationErrors.length > 0) {
            console.warn(`[Taxcom] ⚠ Обнаружено ${validationErrors.length} ошибок валидации на странице Т6`);
            for (const errEl of validationErrors.slice(0, 5)) {
              const errText = await errEl.textContent().catch(() => '');
              if (errText && errText.trim()) {
                console.warn(`[Taxcom]   - Ошибка: ${errText.trim()}`);
              }
            }
            await takeScreenshot(page, 't6_validation_errors', env, 'Ошибки валидации Т6');
          }
          
          // Сохраняем Т6
          console.log('[Taxcom] [Т6] Сохраняю Т6...');
          await closeModalDialogs(page, env);
          
          // Ждём активации кнопки "Сохранить" (может быть disabled из-за незаполненных полей)
          const saveT6Btn = page.locator('#save_btn, button:has-text("Сохранить"), button[id*="save"]').first();
          let saveT6Success = false;
          if ((await saveT6Btn.count()) > 0) {
            // Ждём до 10 секунд, пока кнопка станет enabled
            for (let i = 0; i < 20; i++) {
              const isVisible = await saveT6Btn.isVisible().catch(() => false);
              const isEnabled = await saveT6Btn.isEnabled().catch(() => false);
              if (isVisible && isEnabled) {
                await saveT6Btn.scrollIntoViewIfNeeded();
                await page.waitForTimeout(500);
                await saveT6Btn.click({ timeout: 5000 });
                await page.waitForTimeout(2000); // Увеличиваем время ожидания после сохранения
                
                // Проверяем, что сохранение прошло успешно
                const saveSuccess = page.locator('text=/сохранён|сохранено|успешно.*сохран|saved/i').first();
                if ((await saveSuccess.count()) > 0) {
                  const successText = await saveSuccess.textContent().catch(() => '');
                  console.log(`[Taxcom] ✓ Т6 сохранён успешно. Сообщение: ${successText}`);
                } else {
                  console.log('[Taxcom] ✓ Т6 сохранён (сообщение об успехе не найдено, но кнопка была нажата)');
                }
                
                saveT6Success = true;
                await takeScreenshot(page, 't6_saved', env, 'Т6 сохранён');
                
                // Дополнительное ожидание для активации кнопки "Подписать"
                await page.waitForTimeout(2000);
                break;
              }
              await page.waitForTimeout(500);
            }
            if (!saveT6Success) {
              console.warn('[Taxcom] ⚠ Кнопка "Сохранить" для Т6 не активировалась. Проверь заполнение всех обязательных полей.');
              await takeScreenshot(page, 't6_save_button_disabled', env, 'Кнопка Сохранить Т6 неактивна');
              // Пробуем найти причину - какие поля не заполнены
              try {
                const emptyRequiredFields = await page.locator('input[required]:not([value]), select[required]:not([value]), textarea[required]:not([value])').all();
                if (emptyRequiredFields.length > 0) {
                  console.warn(`[Taxcom] ⚠ Найдено ${emptyRequiredFields.length} незаполненных обязательных полей`);
                  for (const field of emptyRequiredFields.slice(0, 5)) {
                    try {
                      let fieldName = await field.getAttribute('name');
                      if (!fieldName) {
                        fieldName = await field.getAttribute('id');
                      }
                      if (!fieldName) {
                        fieldName = 'неизвестное поле';
                      }
                      console.warn(`[Taxcom]   - Незаполненное поле: ${fieldName}`);
                    } catch (fieldErr) {
                      console.warn(`[Taxcom]   - Незаполненное поле: неизвестное`);
                    }
                  }
                }
              } catch (emptyFieldsErr) {
                // Игнорируем ошибки при поиске незаполненных полей
              }
            }
          } else {
            console.warn('[Taxcom] ⚠ Кнопка "Сохранить" для Т6 не найдена');
            await takeScreenshot(page, 't6_no_save_button', env, 'Кнопка Сохранить Т6 не найдена');
          }
          
          // Подписываем Т6
          if (saveT6Success) {
            // Дополнительная проверка: возможно, нужно перезагрузить страницу или подождать дольше
            console.log('[Taxcom] [Т6] Ожидаю активации кнопки "Подписать" после сохранения...');
            await page.waitForTimeout(2000);
            
            // Проверяем, что нет ошибок на странице
            const pageErrors = await page.locator('.alert-danger, .error, .alert-error, text=/ошибка|error/i').all();
            if (pageErrors.length > 0) {
              console.warn(`[Taxcom] ⚠ Обнаружено ${pageErrors.length} ошибок на странице после сохранения Т6`);
              for (const errEl of pageErrors.slice(0, 3)) {
                const errText = await errEl.textContent().catch(() => '');
                if (errText && errText.trim()) {
                  console.warn(`[Taxcom]   - Ошибка: ${errText.trim()}`);
                }
              }
              await takeScreenshot(page, 't6_errors_after_save', env, 'Ошибки после сохранения Т6');
            }
            
            t6Success = await signTitle(page, 'Т6', 'medic', env, baseUrl, mintransId);
          } else {
            console.warn('[Taxcom] ⚠ Т6 не сохранён, пропускаю подписание');
            t6Success = false;
          }
          if (t6Success) {
            console.log('[Taxcom] ✅ Т6 ПОДПИСАН МЕДИКОМ');
          }
        }
      }
    } else {
      console.warn('[Taxcom] Не заданы данные медика для Т6. Т6 пропущен.');
    }
    
    if (!useExistingBrowser) {
      const keepOpen = env.TAXCOM_KEEP_BROWSER_OPEN === '1' || env.TAXCOM_KEEP_BROWSER_OPEN === 'true';
      if (keepOpen) {
        console.log('[Taxcom] TAXCOM_KEEP_BROWSER_OPEN=1 — браузер оставлен открытым после Т5/Т6, закрывать вручную.');
      } else if (browser) {
        await browser.close();
      } else if (persistentContext) {
        await persistentContext.close();
      }
    }
    return t5Success && t6Success;
  } catch (e) {
    console.error('[Taxcom] ⛔ ОШИБКА при заполнении Т5/Т6:', e.message);
    if (e.stack) {
      console.error('[Taxcom] Стек ошибки:', e.stack);
    }
    if (!useExistingBrowser) {
      const keepOpen = env.TAXCOM_KEEP_BROWSER_OPEN === '1' || env.TAXCOM_KEEP_BROWSER_OPEN === 'true';
      if (keepOpen) {
        console.log('[Taxcom] TAXCOM_KEEP_BROWSER_OPEN=1 — браузер оставлен открытым после ошибки Т5/Т6, закрой его вручную.');
      } else if (browser) {
        await browser.close().catch(() => {});
      } else if (persistentContext) {
        await persistentContext.close().catch(() => {});
      }
    }
    return false;
  }
}

/**
 * Открыть браузер с профилем роли и войти в Такском. Для «прогрева» воркеров — при старте открываются 3 окна.
 * @param {Object} env - process.env
 * @param {'dispatcher'|'medic'|'mechanic'} role
 * @returns {Promise<{ context: object, page: object } | null>}
 */
async function openBrowserAndLoginForRole(env, role) {
  const { chromium } = getPlaywright();
  if (!chromium) return null;
  const baseUrl = (env.TAKSKOM_URL || 'https://epl.taxcom.ru').replace(/\/$/, '');
  let browserPath = (env.CHROMIUM_GOST_PATH || '').trim();
  if ((env.USE_YANDEX_BROWSER === '1' || env.USE_YANDEX_BROWSER === 'true') && !browserPath) {
    const localAppData = process.env.LOCALAPPDATA || process.env.USERPROFILE || '';
    const yandexExe = localAppData ? path.join(localAppData, 'Yandex', 'YandexBrowser', 'Application', 'browser.exe') : '';
    if (yandexExe && fs.existsSync(yandexExe)) browserPath = yandexExe;
  }
  let userDataDir = getUserDataDirForRole(env, role);
  if (!userDataDir && browserPath) {
    const exeDir = path.dirname(browserPath);
    const pathLower = browserPath.toLowerCase();
    const localAppData = process.env.LOCALAPPDATA || process.env.USERPROFILE || '';
    if (pathLower.includes('yandex')) {
      const yandexUserData = localAppData ? path.join(localAppData, 'Yandex', 'YandexBrowser', 'User Data') : '';
      if (yandexUserData && fs.existsSync(yandexUserData)) userDataDir = yandexUserData;
    }
    if (!userDataDir) {
      const nextToExe = path.join(exeDir, 'User Data');
      const oneLevelUp = path.join(path.dirname(exeDir), 'User Data');
      if (fs.existsSync(nextToExe)) userDataDir = nextToExe;
      else if (fs.existsSync(oneLevelUp)) userDataDir = oneLevelUp;
    }
  }
  if (!userDataDir) {
    console.warn(`[Taxcom] [${role}] Нет профиля для роли. Задай в .env ${role.toUpperCase()}_USER_DATA_DIR или TAXCOM_USER_DATA_DIR.`);
    return null;
  }
  userDataDir = path.isAbsolute(userDataDir) ? userDataDir : path.join(__dirname, userDataDir);
  try {
    if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
  } catch (e) {
    console.warn(`[Taxcom] [${role}] Не удалось создать папку профиля:`, e.message);
  }
  let phone = '';
  let pass = '';
  if (role === 'dispatcher') {
    phone = env.TAKSKOM_DISPATCHER_PHONE || env.TAKSKOM_LOGIN_PHONE || '';
    pass = env.TAKSKOM_DISPATCHER_PASSWORD || env.TAKSKOM_LOGIN_PASSWORD || '';
  } else if (role === 'medic') {
    phone = env.TAKSKOM_MEDIC_PHONE || '';
    pass = env.TAKSKOM_MEDIC_PASSWORD || '';
  } else if (role === 'mechanic') {
    phone = env.TAKSKOM_MECHANIC_PHONE || '';
    pass = env.TAKSKOM_MECHANIC_PASSWORD || '';
  }
  if (!phone || !pass) {
    console.warn(`[Taxcom] [${role}] Не заданы логин/пароль для роли.`);
    return null;
  }
  try {
    const persistentContext = await chromium.launchPersistentContext(userDataDir, {
      locale: 'ru-RU',
      headless: false,
      channel: browserPath ? undefined : 'chrome',
      executablePath: browserPath || undefined,
      ignoreDefaultArgs: ['--disable-extensions']
    });
    await persistentContext.clearCookies();
    const page = persistentContext.pages().length > 0 ? persistentContext.pages()[0] : await persistentContext.newPage();
    try {
      await page.evaluate(() => {
        try { localStorage.clear(); } catch (_) {}
        try { sessionStorage.clear(); } catch (_) {}
      });
    } catch (storageErr) {
      console.warn(`[Taxcom] [${role}] Очистка storage:`, storageErr.message);
    }
    page.setDefaultTimeout(60000);
    if (!(await login(page, baseUrl, phone, pass, env))) {
      await persistentContext.close().catch(() => {});
      return null;
    }
    return { context: persistentContext, page };
  } catch (e) {
    console.warn(`[Taxcom] [${role}] openBrowserAndLoginForRole:`, e.message);
    return null;
  }
}

/**
 * Только Т1: создание ЭПЛ и подпись Т1 (диспетчер). Для воркера диспетчера — дальше медик/механик в своих окнах.
 */
async function createEplT1Only(item, env, reuse, reportTitulProgress) {
  const stageEnv = { ...env, TAXCOM_STAGE: 't1-only' };
  return createEplInTaxcom(item, stageEnv, reuse, reportTitulProgress);
}

/**
 * Только Т3 и Т4 (механик). item должен содержать mintransId и titulStatus с t1/t2 signed.
 */
async function fillAndSignT3T4Only(item, env, reuse, reportTitulProgress) {
  if (!item.mintransId || !item.titulStatus || item.titulStatus.t1 !== 'signed' || item.titulStatus.t2 !== 'signed') {
    console.warn('[Taxcom] fillAndSignT3T4Only: нужны mintransId и titulStatus.t1/t2=signed.');
    return null;
  }
  return createEplInTaxcom(item, env, reuse, reportTitulProgress);
}

/**
 * Только Т2 (медик). Запускает браузер с профилем медика, логин, заполнение и подпись Т2.
 */
async function fillAndSignT2Only(item, env, reuse, reportTitulProgress) {
  const noop = () => {};
  const report = reportTitulProgress || noop;
  const mintransId = item.mintransId ? String(item.mintransId) : null;
  if (!mintransId) {
    console.warn('[Taxcom] fillAndSignT2Only: в item нет mintransId.');
    return null;
  }
  const medicPhone = env.TAKSKOM_MEDIC_PHONE || '';
  const medicPass = env.TAKSKOM_MEDIC_PASSWORD || '';
  if (!medicPhone || !medicPass) {
    console.warn('[Taxcom] fillAndSignT2Only: не заданы TAKSKOM_MEDIC_PHONE/PASSWORD.');
    return null;
  }
  const { chromium } = getPlaywright();
  if (!chromium) {
    console.warn('[Taxcom] playwright-core не установлен.');
    return null;
  }
  const baseUrl = (env.TAKSKOM_URL || 'https://epl.taxcom.ru').replace(/\/$/, '');
  let browserPath = (env.CHROMIUM_GOST_PATH || '').trim();
  if ((env.USE_YANDEX_BROWSER === '1' || env.USE_YANDEX_BROWSER === 'true') && !browserPath) {
    const localAppData = process.env.LOCALAPPDATA || process.env.USERPROFILE || '';
    const yandexExe = localAppData ? path.join(localAppData, 'Yandex', 'YandexBrowser', 'Application', 'browser.exe') : '';
    if (yandexExe && fs.existsSync(yandexExe)) browserPath = yandexExe;
  }
  let userDataDir = getUserDataDirForRole(env, 'medic');
  if (!userDataDir && browserPath) {
    const exeDir = path.dirname(browserPath);
    const pathLower = browserPath.toLowerCase();
    const localAppData = process.env.LOCALAPPDATA || process.env.USERPROFILE || '';
    if (pathLower.includes('yandex')) {
      const yandexUserData = localAppData ? path.join(localAppData, 'Yandex', 'YandexBrowser', 'User Data') : '';
      if (yandexUserData && fs.existsSync(yandexUserData)) userDataDir = yandexUserData;
    }
    if (!userDataDir) {
      const nextToExe = path.join(exeDir, 'User Data');
      const oneLevelUp = path.join(path.dirname(exeDir), 'User Data');
      if (fs.existsSync(nextToExe)) userDataDir = nextToExe;
      else if (fs.existsSync(oneLevelUp)) userDataDir = oneLevelUp;
    }
  }
  let browser = null;
  let persistentContext = null;
  let context;
  let page;
  const useReuse = !!(reuse && reuse.context && reuse.page);
  if (useReuse) {
    context = reuse.context;
    page = reuse.page;
    try {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 8000 });
    } catch (e) {
      if (/Target closed|browser has been closed|Context closed/i.test(String(e.message))) {
        console.log('[Taxcom] [Medic] Браузер закрыт — запускаю заново.');
      } else throw e;
    }
  }
  try {
    if (!useReuse) {
      if (userDataDir) {
        persistentContext = await chromium.launchPersistentContext(userDataDir, {
          locale: 'ru-RU',
          headless: false,
          channel: browserPath ? undefined : 'chrome',
          executablePath: browserPath || undefined,
          ignoreDefaultArgs: ['--disable-extensions']
        });
        context = persistentContext;
        page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
      } else {
        const launchOptions = { headless: env.TAXCOM_HEADLESS !== '0' };
        if (browserPath) launchOptions.executablePath = browserPath;
        browser = await chromium.launch(launchOptions);
        context = await browser.newContext({ locale: 'ru-RU' });
        page = await context.newPage();
      }
      page.setDefaultTimeout(60000);
    }
    if (useReuse && env.UNIVERSAL_WORKER !== '1') {
      try {
        await logout(page, baseUrl, env);
      } catch (e) {
        if (/Target closed|browser has been closed|Context closed/i.test(String(e.message))) throw e;
        console.warn('[Taxcom] [Medic] Ошибка при выходе:', e.message);
      }
    }
    if (useReuse && env.UNIVERSAL_WORKER === '1') {
      console.log('[Taxcom] [Medic] Универсальный воркер: браузер медика уже залогинен.');
    } else {
      if (!(await login(page, baseUrl, medicPhone, medicPass, env))) {
        console.warn('[Taxcom] [Medic] Вход медика не удался.');
        if (!useReuse) { if (browser) await browser.close(); else if (persistentContext) await persistentContext.close(); }
        return null;
      }
    }
    page.setDefaultTimeout(60000);
    const ok = await fillTitle2Core(page, baseUrl, env, item, mintransId, report);
    if (!ok) {
      if (!useReuse) { if (browser) await browser.close(); else if (persistentContext) await persistentContext.close(); }
      return null;
    }
    return {
      mintransId,
      eplId: item.eplId,
      page,
      context: persistentContext || (browser && context) || context
    };
  } catch (e) {
    console.error('[Taxcom] [Medic] fillAndSignT2Only:', e.message);
    if (!useReuse) { if (browser) await browser.close().catch(() => {}); else if (persistentContext) await persistentContext.close().catch(() => {}); }
    return null;
  }
}

module.exports = {
  createEplInTaxcom,
  createEplT1Only,
  fillAndSignT2Only,
  fillAndSignT3T4Only,
  openBrowserAndLoginForRole,
  completeEplInTaxcom,
  getPlaywright,
  runCertPicker,
  getUserDataDirForRole,
  fillTitle2Core
};
