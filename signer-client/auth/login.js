/**
 * Авторизация в системе Такском
 */

const { takeScreenshot } = require('../utils/debug');

async function login(page, baseUrl, phone, password, env) {
  console.log('[Taxcom] Открываю страницу входа:', baseUrl);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  await takeScreenshot(page, '01_stranica_vhoda', env, 'Страница входа Такском');
  
  // Более точный селектор для поля телефона/логина - исключаем поля формы (LAST_NAME, FIRST_NAME и т.д.)
  // Ищем поле с placeholder или name, содержащим "телефон", "login", или input без id (обычно это поле входа)
  const loginSelectors = [
    'input[placeholder*="телефон" i]',
    'input[placeholder*="логин" i]',
    'input[name*="phone" i]',
    'input[name*="login" i]',
    'input[type="tel"]',
    // Исключаем поля формы регистрации/редактирования
    'input[type="text"]:not([id="LAST_NAME"]):not([id="FIRST_NAME"]):not([id="SECOND_NAME"]):not([id*="driver"]):not([id*="vehicle"])'
  ];
  
  let loginInput = null;
  for (const selector of loginSelectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0) {
      const isVisible = await locator.isVisible().catch(() => false);
      const id = await locator.getAttribute('id').catch(() => '');
      const name = await locator.getAttribute('name').catch(() => '');
      const placeholder = await locator.getAttribute('placeholder').catch(() => '');
      
      // Пропускаем поля формы (не для входа)
      if (id && (id.includes('LAST_NAME') || id.includes('FIRST_NAME') || id.includes('SECOND_NAME') || id.includes('driver') || id.includes('vehicle'))) {
        continue;
      }
      
      if (isVisible && (placeholder.toLowerCase().includes('телефон') || placeholder.toLowerCase().includes('логин') || name.toLowerCase().includes('phone') || name.toLowerCase().includes('login') || !id)) {
        loginInput = locator;
        console.log(`[Taxcom] Найдено поле логина: selector=${selector}, id=${id}, name=${name}, placeholder=${placeholder}`);
        break;
      }
    }
  }
  
  if (!loginInput) {
    // Последняя попытка - ищем первое текстовое поле, которое видимо и не является полем формы
    const allTextInputs = page.locator('input[type="text"]');
    const count = await allTextInputs.count();
    for (let i = 0; i < Math.min(count, 5); i++) {
      const input = allTextInputs.nth(i);
      const id = await input.getAttribute('id').catch(() => '');
      const isVisible = await input.isVisible().catch(() => false);
      if (isVisible && !id.includes('LAST_NAME') && !id.includes('FIRST_NAME') && !id.includes('SECOND_NAME')) {
        loginInput = input;
        console.log(`[Taxcom] Использую поле логина (fallback): id=${id}`);
        break;
      }
    }
  }
  
  let passInput = page.locator('input[type="password"]').first();
  if (!loginInput || (await loginInput.count()) === 0 || (await passInput.count()) === 0) {
    console.warn('[Taxcom] Поля логин/пароль не найдены с первого раза, жду 3 сек и повторяю...');
    await page.waitForTimeout(3000);
    for (const selector of loginSelectors) {
      const locator = page.locator(selector).first();
      if ((await locator.count()) > 0 && await locator.isVisible().catch(() => false)) {
        const name = await locator.getAttribute('name').catch(() => '');
        if (name && (name.toLowerCase().includes('phone') || name.toLowerCase().includes('login'))) {
          loginInput = locator;
          break;
        }
      }
    }
    passInput = page.locator('input[type="password"]').first();
  }
  if (!loginInput || (await loginInput.count()) === 0 || (await passInput.count()) === 0) {
    const url = (page.url() || '').toLowerCase();
    const hasLogout = (await page.locator('a:has-text("Выход"), button:has-text("Выход")').count()) > 0;
    const bodyText = await page.textContent('body').catch(() => '') || '';
    const hasCabinetText = /путевой|личный кабинет|эпл|waybill/i.test(bodyText);
    const notLoginPage = !url.includes('/login') && !url.includes('/auth') && !url.includes('signin');
    const looksLikeCabinet = hasLogout || (notLoginPage && (url.includes('/waybill') || url.includes('/dashboard') || url.includes('/profile') || url.includes('/personal') || hasCabinetText));
    if (looksLikeCabinet) {
      console.log('[Taxcom] Поля входа не найдены — уже в кабинете (сессия из профиля).');
      return true;
    }
    console.warn('[Taxcom] Не найдены поля логин/пароль на странице входа.');
    await takeScreenshot(page, '01_error_no_login_fields', env, 'Ошибка: поля входа не найдены');
    return false;
  }
  
  await loginInput.fill(phone);
  await passInput.fill(password);
  await takeScreenshot(page, '02_forma_vhoda_zapolnena', env, 'Форма входа заполнена');
  let submitBtn = page.getByRole('button', { name: /вход|авториз|огин/i }).first();
  if ((await submitBtn.count()) === 0) {
    submitBtn = page.locator('input[type="submit"]').first();
  }
  await submitBtn.click();
  await page.waitForTimeout(5000);
  return true;
}

async function logout(page, baseUrl, env) {
  try {
    console.log('[Taxcom] Выхожу из аккаунта...');
    const logoutBtn = page.locator('a:has-text("Выход"), button:has-text("Выход"), a[href*="logout"], a[href*="exit"]').first();
    if ((await logoutBtn.count()) > 0) {
      const isVisible = await logoutBtn.isVisible().catch(() => false);
      if (isVisible) {
        await logoutBtn.click();
        await page.waitForTimeout(3000);
        await takeScreenshot(page, 'logout', env, 'Выход из аккаунта');
        // Ждём, пока страница перейдёт на страницу входа
        await page.waitForURL(/login|auth|entry|$/, { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(2000);
        return true;
      }
    }
    // Если кнопка выхода не найдена — принудительный переход на страницу входа (сброс сессии)
    console.log('[Taxcom] Кнопка выхода не найдена, перехожу на страницу входа...');
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    // Такском: пробуем явный logout по URL
    try {
      await page.goto(baseUrl.replace(/\/$/, '') + '/?logout=1', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(3000);
    } catch (_) {}
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);
    return true;
  } catch (err) {
    console.warn('[Taxcom] Ошибка при выходе из аккаунта:', err.message);
    // Всё равно пробуем перейти на страницу входа
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    return false;
  }
}

module.exports = {
  login,
  logout
};
