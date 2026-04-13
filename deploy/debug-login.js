/**
 * Диагностика и управление авторизацией на сервере.
 * Запуск: diag-login.cmd (из корня проекта) или node deploy/debug-login.js
 */

const path  = require('path');
const fs    = require('fs');
const readline = require('readline');
const https = require('https');
const http  = require('http');
const { Client } = require('ssh2');

const ROOT        = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'deploy-config.json');

const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

/* ──────── config ──────── */

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return null; }
}

async function getCredentials() {
  const saved = loadConfig();
  if (saved && saved.host && saved.user) {
    const use = await ask(`  Использовать сохранённые данные? (${saved.user}@${saved.host}:${saved.port || 22}) [Д/н]: `);
    if (!use || use.toLowerCase() !== 'н') {
      const password = await ask('  Пароль SSH: ');
      return { host: saved.host, port: parseInt(saved.port, 10) || 22, user: saved.user, password };
    }
  }
  const host     = await ask('  IP сервера: ');
  const user     = (await ask('  Пользователь [root]: ')) || 'root';
  const password = await ask('  Пароль SSH: ');
  return { host, port: 22, user, password };
}

/* ──────── SSH ──────── */

function connectSSH(creds) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn)).on('error', reject);
    conn.connect({
      host: creds.host,
      port: creds.port || 22,
      username: creds.user,
      password: creds.password,
      readyTimeout: 20000,
      keepaliveInterval: 10000,
    });
  });
}

function runRemote(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stdout = '', stderr = '';
      stream.on('data', (d) => { stdout += d.toString(); });
      stream.stderr.on('data', (d) => { stderr += d.toString(); });
      stream.on('close', (code) => resolve({ code, stdout, stderr }));
    });
  });
}

/* Заливаем JS-скрипт как временный файл на сервер, запускаем, удаляем */
function uploadText(conn, content, remotePath) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      const ws = sftp.createWriteStream(remotePath);
      ws.on('close', () => { sftp.end(); resolve(); });
      ws.on('error', (e) => { sftp.end(); reject(e); });
      ws.write(content, 'utf8');
      ws.end();
    });
  });
}

async function runScript(conn, script) {
  // Пишем скрипт прямо в /root/backend/ — тогда node_modules (bcryptjs, sqlite3) резолвятся корректно
  const tmp = `/root/backend/freight-diag-${Date.now()}.js`;
  await uploadText(conn, script, tmp);
  const result = await runRemote(conn, `cd /root/backend && node ${tmp}; rm -f ${tmp}`);
  return result;
}

/* ──────── 1. Показать пользователей ──────── */

async function showUsers(conn) {
  console.log('\n  ──────────────────────────────────────────────────');
  console.log('  ПОЛЬЗОВАТЕЛИ В БД НА СЕРВЕРЕ');
  console.log('  ──────────────────────────────────────────────────');

  const script = `
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('/root/backend/app.db', sqlite3.OPEN_READONLY, (e) => {
  if (e) { console.log('DB_OPEN_ERROR: ' + e.message); process.exit(1); }
});
db.all(
  'SELECT id, username, role, phone, mustChangePassword, firstLogin FROM users ORDER BY id',
  [],
  (e, rows) => {
    if (e) { console.log('DB_ERROR: ' + e.message); db.close(); return; }
    if (!rows || rows.length === 0) { console.log('NO_USERS'); db.close(); return; }
    rows.forEach(r => {
      console.log('USER|' + r.id + '|' + (r.username||'') + '|' + (r.role||'') + '|' + (r.phone||'') + '|mcp=' + r.mustChangePassword + '|fl=' + r.firstLogin);
    });
    db.close();
  }
);
`;

  const { stdout, stderr } = await runScript(conn, script);

  if (!stdout.trim()) {
    console.log('\n  Нет вывода от сервера.');
    if (stderr.trim()) console.log('  Stderr:', stderr.trim().slice(0, 400));
    return;
  }
  if (stdout.includes('DB_OPEN_ERROR') || stdout.includes('DB_ERROR')) {
    console.log('\n  Ошибка:', stdout.trim()); return;
  }
  if (stdout.includes('NO_USERS')) {
    console.log('\n  База пустая — нет ни одного пользователя!');
    console.log('  Используй пункт 4 чтобы создать нового пользователя.'); return;
  }

  const lines = stdout.trim().split('\n').filter(l => l.startsWith('USER|'));
  if (lines.length === 0) {
    console.log('\n  Не удалось разобрать:', stdout.slice(0, 300)); return;
  }

  console.log(`\n  Найдено пользователей: ${lines.length}\n`);
  console.log(`  ${'ID'.padEnd(4)} | ${'Логин'.padEnd(22)} | ${'Роль'.padEnd(13)} | ${'Телефон'.padEnd(16)} | Флаги`);
  console.log(`  ${'─'.repeat(4)}-+-${'─'.repeat(22)}-+-${'─'.repeat(13)}-+-${'─'.repeat(16)}-+──────────`);
  lines.forEach(line => {
    const [, id, username, role, phone, mcp, fl] = line.split('|');
    const flags = (mcp === 'mcp=1' ? '[mustChange] ' : '') + (fl === 'fl=1' ? '[firstLogin]' : '');
    console.log(`  ${(id||'').padEnd(4)} | ${(username||'').padEnd(22)} | ${(role||'').padEnd(13)} | ${(phone||'').padEnd(16)} | ${flags}`);
  });
}

/* ──────── 2. Проверить пароль ──────── */

async function checkPassword(conn) {
  console.log('\n  ──────────────────────────────────────────────────');
  console.log('  ПРОВЕРКА ПАРОЛЯ В БД (без изменений)');
  console.log('  ──────────────────────────────────────────────────');

  const username = await ask('  Введите логин: ');
  const password = await ask('  Введите пароль: ');

  const script = `
const bcrypt  = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('/root/backend/app.db', sqlite3.OPEN_READONLY);
const username = ${JSON.stringify(username.trim())};
const password = ${JSON.stringify(password)};
function digits(v) { return (v||'').replace(/\\D/g,''); }
const tryRow = (row) => {
  if (!row) { console.log('RESULT: NOT_FOUND'); db.close(); return; }
  const ok1 = bcrypt.compareSync(password, row.password);
  const dig  = digits(password);
  const ok2  = dig.length > 0 && bcrypt.compareSync(dig, row.password);
  console.log('RESULT: ' + (ok1||ok2 ? 'MATCH' : 'NO_MATCH'));
  console.log('INFO: id=' + row.id + ' role=' + row.role + ' mcp=' + row.mustChangePassword + ' fl=' + row.firstLogin);
  db.close();
};
db.get('SELECT * FROM users WHERE username=?', [username], (e, row) => {
  if (e) { console.log('RESULT: DB_ERROR ' + e.message); db.close(); return; }
  if (row) return tryRow(row);
  const dig = digits(username);
  if (!dig) return tryRow(null);
  db.get('SELECT * FROM users WHERE username=? OR phone=?', [dig, dig], (e2, row2) => {
    if (e2) { console.log('RESULT: DB_ERROR ' + e2.message); db.close(); return; }
    tryRow(row2||null);
  });
});
`;

  console.log('\n  Проверяю...');
  const { stdout, stderr } = await runScript(conn, script);

  if (!stdout.trim()) {
    console.log('\n  Нет ответа от сервера.');
    if (stderr.trim()) console.log('  Stderr:', stderr.trim().slice(0, 400));
    return;
  }

  stdout.trim().split('\n').forEach(line => {
    line = line.trim();
    if (!line) return;
    if (line.startsWith('RESULT: MATCH')) {
      console.log('\n  ПАРОЛЬ ВЕРНЫЙ — должен пускать в систему!');
      console.log('  Если не входит — проблема не в пароле (CORS, nginx, браузер).');
    } else if (line.startsWith('RESULT: NO_MATCH')) {
      console.log('\n  ПАРОЛЬ НЕ СОВПАДАЕТ — вот почему 401!');
      console.log('  Используй пункт 4 "Сбросить пароль" чтобы задать новый.');
    } else if (line.startsWith('RESULT: NOT_FOUND')) {
      console.log('\n  ПОЛЬЗОВАТЕЛЬ НЕ НАЙДЕН в БД!');
      console.log('  Смотри пункт 1 — возможно логин написан иначе.');
    } else if (line.startsWith('RESULT: DB_ERROR')) {
      console.log('\n  Ошибка БД:', line.replace('RESULT: DB_ERROR ', ''));
    } else if (line.startsWith('INFO:')) {
      console.log('  ' + line);
    }
  });
}

/* ──────── 3. Тест API ──────── */

async function testApiLogin(creds) {
  console.log('\n  ──────────────────────────────────────────────────');
  console.log('  ТЕСТ ЖИВОГО API: POST /api/auth/login');
  console.log('  ──────────────────────────────────────────────────');

  const username = await ask('  Логин: ');
  const password = await ask('  Пароль: ');
  const body = JSON.stringify({ username, password });

  const urls = [
    `http://127.0.0.1:5000/api/auth/login`,
    `http://${creds.host}:5000/api/auth/login`,
  ];

  for (const url of urls) {
    await new Promise((resolve) => {
      try {
        const mod = url.startsWith('https') ? https : http;
        const u = new URL(url);
        const req = mod.request({
          hostname: u.hostname,
          port: u.port || (url.startsWith('https') ? 443 : 80),
          path: u.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
          timeout: 8000,
          rejectUnauthorized: false,
        }, (res) => {
          let data = '';
          res.on('data', (d) => { data += d; });
          res.on('end', () => {
            const icon = res.statusCode === 200 ? 'OK ' : 'ERR';
            console.log(`\n  [${icon}] ${url}`);
            console.log(`       HTTP ${res.statusCode}: ${data.slice(0, 250)}`);
            resolve();
          });
        });
        req.on('error',   (e) => { console.log(`\n  [ERR] ${url}: ${e.message}`); resolve(); });
        req.on('timeout', ()  => { req.destroy(); console.log(`\n  [TMO] ${url}: Timeout`); resolve(); });
        req.write(body);
        req.end();
      } catch (ex) { console.log(`\n  [EXC] ${url}: ${ex.message}`); resolve(); }
    });
  }
}

/* ──────── 4. Сброс пароля ──────── */

async function resetPassword(conn) {
  console.log('\n  ──────────────────────────────────────────────────');
  console.log('  СБРОС ПАРОЛЯ ПОЛЬЗОВАТЕЛЯ');
  console.log('  ──────────────────────────────────────────────────');

  // Сначала показываем список пользователей для удобства
  console.log('\n  Загружаю список пользователей...');
  await showUsers(conn);

  console.log('');
  const username    = await ask('  Логин пользователя: ');
  const newPassword = await ask('  Новый пароль: ');
  const confirm2    = await ask('  Повторите пароль: ');

  if (newPassword !== confirm2) { console.log('\n  Пароли не совпадают. Отмена.'); return; }
  if (newPassword.length < 4)  { console.log('\n  Пароль слишком короткий (минимум 4 символа).'); return; }

  const confirm = await ask(`\n  Сменить пароль для "${username.trim()}" на "${newPassword}"? [да/н]: `);
  if (!confirm || !['да','д','yes','y'].includes(confirm.trim().toLowerCase())) {
    console.log('  Отмена.'); return;
  }

  const script = `
const bcrypt  = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('/root/backend/app.db');
const username = ${JSON.stringify(username.trim())};
const hash = bcrypt.hashSync(${JSON.stringify(newPassword)}, 10);
db.run(
  'UPDATE users SET password=?, mustChangePassword=0, firstLogin=0 WHERE username=?',
  [hash, username],
  function(e) {
    if (e)               console.log('ERROR: ' + e.message);
    else if (this.changes === 0) console.log('NOT_FOUND: пользователь "' + username + '" не найден');
    else                 console.log('OK: пароль обновлён (' + this.changes + ' строк)');
    db.close();
  }
);
`;

  console.log('\n  Обновляю пароль на сервере...');
  const { stdout, stderr } = await runScript(conn, script);
  const out = stdout.trim();

  if (out.startsWith('OK:')) {
    console.log(`\n  ${out}`);
    console.log(`\n  Теперь логин: ${username.trim()} / ${newPassword}`);
    console.log('  Рекомендуется сменить пароль после входа.');
  } else if (out.startsWith('NOT_FOUND:')) {
    console.log(`\n  ${out}`);
    console.log('  Проверь написание логина в пункте 1.');
  } else if (out.startsWith('ERROR:')) {
    console.log(`\n  ${out}`);
  } else {
    console.log('\n  Ответ:', out || stderr.trim());
  }
}

/* ──────── 5. Статус сервера ──────── */

async function showServerStatus(conn) {
  console.log('\n  ──────────────────────────────────────────────────');
  console.log('  СТАТУС СЕРВЕРА');
  console.log('  ──────────────────────────────────────────────────\n');

  const checks = [
    ['pm2 list 2>/dev/null || echo "(pm2 не найден)"',                                                              '[PM2]'],
    ['ls -lh /root/backend/app.db 2>/dev/null && echo "OK" || echo "app.db НЕ НАЙДЕН!"',                           '[app.db]'],
    ['ls -lht /root/db-backups/database_*.db 2>/dev/null | head -5 || echo "(бэкапов нет)"',                       '[Бэкапы]'],
    ['systemctl is-active nginx 2>/dev/null && echo "nginx active" || echo "nginx не активен"',                    '[nginx]'],
    ['df -h / 2>/dev/null | tail -1',                                                                              '[Диск]'],
    ['free -h 2>/dev/null | grep Mem',                                                                              '[RAM]'],
    ['uptime',                                                                                                      '[Uptime]'],
  ];

  for (const [cmd, label] of checks) {
    const { stdout } = await runRemote(conn, cmd).catch(e => ({ stdout: 'Ошибка: ' + e.message }));
    console.log(`  ${label}:`);
    (stdout||'').trim().split('\n').forEach(l => console.log('    ' + l));
    console.log('');
  }
}

/* ──────── 6. Логи PM2 ──────── */

async function showPm2Logs(conn) {
  console.log('\n  ──────────────────────────────────────────────────');
  console.log('  ПОСЛЕДНИЕ ЛОГИ PM2 (freight-epl-api / taxi-api) — 80 строк');
  console.log('  ──────────────────────────────────────────────────\n');

  const { stdout, stderr } = await runRemote(conn,
    '(pm2 logs freight-epl-api --lines 80 --nostream 2>/dev/null || pm2 logs taxi-api --lines 80 --nostream 2>/dev/null) || ' +
    'tail -80 ~/.pm2/logs/freight-epl-api-out.log 2>/dev/null || tail -80 ~/.pm2/logs/taxi-api-out.log 2>/dev/null || echo "Логи не найдены"'
  );
  console.log(stdout || stderr || '(нет вывода)');
}

/* ──────── МЕНЮ ──────── */

function showMenu() {
  console.log('\n  ╔══════════════════════════════════════════╗');
  console.log('  ║     ДИАГНОСТИКА АВТОРИЗАЦИИ               ║');
  console.log('  ╠══════════════════════════════════════════╣');
  console.log('  ║  1. Все пользователи в БД                 ║');
  console.log('  ║  2. Проверить пароль (MATCH / NO MATCH)   ║');
  console.log('  ║  3. Тест API: POST /api/auth/login        ║');
  console.log('  ║  4. Сбросить пароль пользователя          ║');
  console.log('  ║  5. Статус сервера (pm2/БД/nginx/диск)    ║');
  console.log('  ║  6. Логи PM2 (последние 80 строк)         ║');
  console.log('  ║───────────────────────────────────────────║');
  console.log('  ║  0. Выход                                 ║');
  console.log('  ╚══════════════════════════════════════════╝');
}

async function runMenu(conn, creds) {
  showMenu();
  const choice = (await ask('\n  Выбор (0-6): ')).trim();

  if (choice === '0') {
    console.log('\n  Выход.\n');
    rl.close();
    if (conn) conn.end();
    process.exit(0);
  }

  try {
    if      (choice === '1') await showUsers(conn);
    else if (choice === '2') await checkPassword(conn);
    else if (choice === '3') await testApiLogin(creds);
    else if (choice === '4') await resetPassword(conn);
    else if (choice === '5') await showServerStatus(conn);
    else if (choice === '6') await showPm2Logs(conn);
    else                     console.log('  Неверный выбор.');
  } catch (e) {
    console.error('\n  Ошибка:', e.message || e);
  }

  return runMenu(conn, creds);
}

/* ──────── СТАРТ ──────── */

async function main() {
  console.log('\n  ╔══════════════════════════════════════════╗');
  console.log('  ║   ДИАГНОСТИКА АВТОРИЗАЦИИ — Грузовые ЭПЛ   ║');
  console.log('  ╚══════════════════════════════════════════╝\n');

  const creds = await getCredentials();
  console.log(`\n  Подключаюсь к ${creds.user}@${creds.host}:${creds.port || 22}...`);

  let conn;
  try {
    conn = await connectSSH(creds);
    console.log('  SSH подключение установлено!');
  } catch (e) {
    console.error(`\n  Не удалось подключиться: ${e.message}\n`);
    rl.close();
    process.exit(1);
  }

  await runMenu(conn, creds);
}

main().catch((e) => { console.error('\n  Критическая ошибка:', e.message); process.exit(1); });
