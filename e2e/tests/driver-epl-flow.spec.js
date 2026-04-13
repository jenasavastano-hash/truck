/**
 * E2E: водитель — создание ЭПЛ, переход в карточку, скриншоты.
 * Требует E2E_DRIVER_USERNAME и E2E_DRIVER_PASSWORD в .env.
 * Backend (5000) и frontend (3000) должны быть запущены.
 */

const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
const DRIVER_USER = process.env.E2E_DRIVER_USERNAME;
const DRIVER_PASS = process.env.E2E_DRIVER_PASSWORD;

test.describe('Driver EPL flow', () => {
  test.beforeEach(async ({ page }) => {
    if (!DRIVER_USER || !DRIVER_PASS) {
      test.skip(true, 'E2E_DRIVER_USERNAME / E2E_DRIVER_PASSWORD не заданы в .env');
    }
  });

  test('логин водителя, создание ЭПЛ, открытие карточки, скриншоты', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel(/логин/i).fill(DRIVER_USER);
    await page.getByLabel(/пароль/i).fill(DRIVER_PASS);
    await page.getByRole('button', { name: /вход/i }).click();
    await expect(page).toHaveURL(/\/driver/);
    await page.waitForTimeout(2000);

    const createBtn = page.getByRole('button', { name: /создать путевой|создать эпл/i });
    if (await createBtn.count() > 0) {
      await createBtn.click();
      await page.waitForTimeout(500);
      await page.locator('input[type="number"]').first().fill('0');
      const fuelInput = page.locator('input[placeholder*="топлив"], input[step="0.1"]').first();
      if (await fuelInput.count() > 0) await fuelInput.fill('50');
      const submitBtn = page.getByRole('button', { name: /создать|подтвердить/i }).last();
      await submitBtn.click();
      await page.waitForTimeout(5000);
    }

    const firstEpl = page.locator('a[href^="/driver/epl/"]').first();
    await expect(firstEpl).toBeVisible({ timeout: 10000 });
    await firstEpl.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'test-results/epl-details-after-create.png', fullPage: true });
  });
});
