/**
 * Одноразовый скрипт: очистить QR у EPL и перезалить (перезалив на Минтранс).
 * Использование: node refetch-qr-once.js <eplId|waybill>
 * Примеры: node refetch-qr-once.js 129
 *          node refetch-qr-once.js WB-3-20260214-7361
 */
const fs = require('fs');
const path = require('path');

const appDir = __dirname;
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

const arg = (process.argv[2] || '129').trim();
const eplId = parseInt(arg, 10);
const waybill = isNaN(eplId) || arg.toUpperCase().startsWith('WB') ? arg : null;
const query = waybill ? `waybill=${encodeURIComponent(waybill)}` : `eplId=${eplId}`;

if (!eplId && !waybill) {
  console.error('Укажи EPL id или waybill: node refetch-qr-once.js 129 | WB-3-20260214-7361');
  process.exit(1);
}

async function main() {
  console.log(`[refetch] Очищаю QR ${waybill ? 'для waybill ' + waybill : 'у EPL ' + eplId}...`);
  const clearRes = await fetch(`${API_URL}/api/clinic/clear-qr?${query}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
  });
  const clearData = await clearRes.json().catch(() => ({}));
  if (!clearRes.ok) {
    console.error('[refetch] Ошибка очистки:', clearData.error || clearRes.status);
    process.exit(1);
  }
  const resolvedEplId = clearData.eplId || eplId;
  if (!resolvedEplId) {
    console.error('[refetch] Не удалось определить eplId');
    process.exit(1);
  }
  console.log('[refetch] QR очищен. Запускаю qr-fetcher --once --epl=' + resolvedEplId + '...');
  const { spawn } = require('child_process');
  const workersDisplay = path.join(appDir, '.workers-display');
  const showBrowser = fs.existsSync(workersDisplay) && fs.readFileSync(workersDisplay, 'utf8').trim() === '1';
  const env = { ...process.env, QR_FETCH_PREFER_MINTRANS: '1' };
  if (showBrowser) env.QR_FETCH_HEADLESS = '0';
  const proc = spawn('node', [path.join(appDir, 'qr-fetcher.js'), '--once', '--epl=' + resolvedEplId], {
    env,
    stdio: 'inherit',
    cwd: appDir
  });
  proc.on('close', (code) => process.exit(code || 0));
}

main().catch((e) => {
  console.error('[refetch]', e.message);
  process.exit(1);
});
