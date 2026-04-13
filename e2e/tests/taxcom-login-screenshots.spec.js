/**
 * E2E: личный кабинет Такском (epl.taxcom.ru) — логин механик/медик/диспетчер, скриншоты.
 * Учётные данные из .env (TAKSKOM_*). Запуск: npm run test (или отдельно этот файл).
 */

const { test, expect } = require('@playwright/test');

const TAKSKOM_URL = process.env.E2E_TAKSKOM_URL || 'https://epl.taxcom.ru';
const ROLES = [
  { name: 'mechanic', phone: process.env.TAKSKOM_MECHANIC_PHONE, password: process.env.TAKSKOM_MECHANIC_PASSWORD },
  { name: 'medic', phone: process.env.TAKSKOM_MEDIC_PHONE, password: process.env.TAKSKOM_MEDIC_PASSWORD },
  { name: 'dispatcher', phone: process.env.TAKSKOM_DISPATCHER_PHONE, password: process.env.TAKSKOM_DISPATCHER_PASSWORD }
];

test.describe('Takskom LK login screenshots', () => {
  test.setTimeout(90000); // Внешний сайт Такском может отвечать медленно

  for (const role of ROLES) {
    test(`${role.name}: логин в Такском и скрин`, async ({ page }) => {
      if (!role.phone || !role.password) {
        test.skip(true, `TAKSKOM_${role.name.toUpperCase()}_* не заданы в .env`);
        return;
      }
      await page.goto(TAKSKOM_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1500);
      const loginInput = page.locator('input[type="text"], input[name*="login"], input[placeholder*="огин"]').first();
      const passInput = page.locator('input[type="password"]').first();
      if ((await loginInput.count()) > 0 && (await passInput.count()) > 0) {
        await loginInput.fill(role.phone);
        await passInput.fill(role.password);
        const submit = page.getByRole('button', { name: /вход|авториз|огин/i }).or(page.locator('input[type="submit"]')).first();
        await submit.click();
        await page.waitForTimeout(5000);

        // Переход в профиль (где видна роль)
        try {
          const profileLink = page.getByRole('link', { name: /профиль|личн|пользователь|кабинет|настройки|аккаунт|роль/i }).first();
          await profileLink.click({ timeout: 8000 });
          await page.waitForTimeout(3000);
        } catch {
          try {
            const byHref = page.locator('a[href*="profile"], a[href*="user"], a[href*="account"]').first();
            await byHref.click({ timeout: 5000 });
            await page.waitForTimeout(3000);
          } catch {
            try {
              await page.getByRole('button', { name: /профиль|пользователь|меню|кабинет/i }).first().click({ timeout: 5000 });
              await page.waitForTimeout(1500);
              await page.locator('a', { hasText: /профиль|роль/i }).first().click({ timeout: 5000 });
              await page.waitForTimeout(2000);
            } catch {
              // Профиль не найден — скрин с текущей страницы
            }
          }
        }

        await page.screenshot({ path: `test-results/taxcom-${role.name}-profile.png`, fullPage: true });
      } else {
        await page.screenshot({ path: `test-results/taxcom-${role.name}-login-page.png`, fullPage: true });
      }
    });
  }
});
