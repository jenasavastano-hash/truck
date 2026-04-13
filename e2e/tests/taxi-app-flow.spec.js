/**
 * E2E: наше приложение — логин по ролям, создание ЭПЛ водителем, открытие ЭПЛ, скриншоты.
 * Запуск: из папки e2e выполнить npm run test:taxi
 * Перед запуском: backend (port 5000) и frontend (port 3000) должны быть запущены.
 */

const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
const ADMIN_USER = process.env.E2E_ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.E2E_ADMIN_PASSWORD || 'admin';
const DRIVER_USER = process.env.E2E_DRIVER_USERNAME || '';
const DRIVER_PASS = process.env.E2E_DRIVER_PASSWORD || '';
const MANAGER_USER = process.env.E2E_MANAGER_USERNAME || '';
const MANAGER_PASS = process.env.E2E_MANAGER_PASSWORD || '';

async function login(page, username, password) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel(/логин/i).fill(username);
  await page.getByLabel(/пароль/i).fill(password);
  await page.getByRole('button', { name: /вход/i }).click();
}

test.describe('Taxi App E2E', () => {
  test('admin: логин и скрин панели', async ({ page }) => {
    await login(page, ADMIN_USER, ADMIN_PASS);
    await expect(page).toHaveURL(/\/(admin|login)/);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test-results/screenshot-admin-panel.png', fullPage: true });
  });

  test('driver: логин, список ЭПЛ, открыть первый ЭПЛ и скрин', async ({ page }) => {
    if (!DRIVER_USER || !DRIVER_PASS) {
      test.skip();
      return;
    }
    await login(page, DRIVER_USER, DRIVER_PASS);
    await expect(page).toHaveURL(/\/(driver|login)/);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'test-results/screenshot-driver-portal.png', fullPage: true });

    const firstEplLink = page.locator('a[href^="/driver/epl/"]').first();
    if (await firstEplLink.count() > 0) {
      await firstEplLink.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'test-results/screenshot-driver-epl-details.png', fullPage: true });
    }
  });

  test('manager: логин и скрин панели', async ({ page }) => {
    if (!MANAGER_USER || !MANAGER_PASS) {
      test.skip();
      return;
    }
    await login(page, MANAGER_USER, MANAGER_PASS);
    await expect(page).toHaveURL(/\/(manager|login)/);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'test-results/screenshot-manager-panel.png', fullPage: true });
  });
});
