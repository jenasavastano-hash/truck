/**
 * Скрипт дебага ЭПЛ. Запускать при уже работающем бэкенде (launch-api).
 * Не перезапускает сайт/API.
 *
 * Использование:
 *   node backend/scripts/epl-debug.js --poll   — один запрос GET /api/clinic/pending-creation, вывод в консоль
 *   node backend/scripts/epl-debug.js --create — логин водителя + POST создания ЭПЛ (режим в админке должен быть «Наш API»)
 *   node backend/scripts/epl-debug.js          — по умолчанию --poll
 *
 * .env в backend/: API_URL, SIGNER_API_KEY (для --poll). Для --create: EPL_DEBUG_DRIVER_USER, EPL_DEBUG_DRIVER_PASS (по умолчанию driver/driver).
 */

const path = require('path');
const fs = require('fs');

const backendDir = path.join(__dirname, '..');
const envPath = path.join(backendDir, '.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const m = t.match(/^([^=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  });
}

const API_URL = (process.env.API_URL || 'http://localhost:5000').replace(/\/$/, '');
const SIGNER_API_KEY = process.env.SIGNER_API_KEY || process.env.CLINIC_API_KEY || '';
const DRIVER_USER = process.env.EPL_DEBUG_DRIVER_USER || 'driver';
const DRIVER_PASS = process.env.EPL_DEBUG_DRIVER_PASS || 'driver';

const args = process.argv.slice(2);
const modePoll = args.includes('--poll') || (!args.includes('--create') && args.length === 0);
const modeCreate = args.includes('--create');

async function checkHealth() {
  const res = await fetch(`${API_URL}/api/health`);
  if (!res.ok) throw new Error(`API не доступен: ${res.status}`);
  console.log('API доступен:', await res.json());
}

async function pollPendingCreation() {
  if (!SIGNER_API_KEY) {
    console.error('Задайте SIGNER_API_KEY в backend/.env');
    process.exit(1);
  }
  const res = await fetch(`${API_URL}/api/clinic/pending-creation`, {
    headers: { Authorization: `Bearer ${SIGNER_API_KEY}`, 'Content-Type': 'application/json' }
  });
  if (!res.ok) {
    console.error('GET pending-creation:', res.status, await res.text());
    process.exit(1);
  }
  const data = await res.json();
  console.log('Заявки на создание ЭПЛ (pending_clinic):', JSON.stringify(data, null, 2));
}

async function createEplAsDriver() {
  const loginRes = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: DRIVER_USER, password: DRIVER_PASS })
  });
  if (!loginRes.ok) {
    console.error('Логин водителя не удался:', loginRes.status, await loginRes.text());
    process.exit(1);
  }
  const { token } = await loginRes.json();
  if (!token) {
    console.error('Нет token в ответе логина');
    process.exit(1);
  }
  const createRes = await fetch(`${API_URL}/api/driver/epl/create`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ startOdometer: 1000, startFuel: null })
  });
  const text = await createRes.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch (_) {
    body = { raw: text };
  }
  if (!createRes.ok) {
    console.error('Создание ЭПЛ:', createRes.status, body);
    process.exit(1);
  }
  console.log('Создание ЭПЛ успешно:', body);
}

async function main() {
  await checkHealth();
  if (modePoll) {
    await pollPendingCreation();
  }
  if (modeCreate) {
    await createEplAsDriver();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
