/**
 * Меню деплоя: перезалить всё / перезапустить фронт / перезапустить бэкенд.
 * Запуск: deploy.bat или node deploy/deploy.js
 *
 * Файлы пакуются в tar.gz (чистый Node.js, без внешних зависимостей) →
 * один файл загружается по SFTP → распаковка на сервере.
 */
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const readline = require('readline');
const { spawn } = require('child_process');
const { Client } = require('ssh2');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'deploy-config.json');
const TMP_DIR = os.tmpdir();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q) {
  return new Promise((resolve) => rl.question(q, resolve));
}

/* ──────── tar.gz creation (pure Node.js, no external deps) ──────── */

function collectFiles(dir, base, skip) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip && skip.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = base ? base + '/' + entry.name : entry.name;
    if (entry.isDirectory()) {
      result.push({ rel: rel + '/', full, isDir: true });
      result.push(...collectFiles(full, rel, null));
    } else if (entry.isFile()) {
      result.push({ rel, full, isDir: false, size: fs.statSync(full).size });
    }
  }
  return result;
}

function tarHeader(name, size, isDir) {
  const buf = Buffer.alloc(512, 0);
  const nameBytes = Buffer.from(name, 'utf8');
  nameBytes.copy(buf, 0, 0, Math.min(nameBytes.length, 100));

  const writeOctal = (val, offset, len) => {
    const s = val.toString(8).padStart(len - 1, '0');
    buf.write(s, offset, len - 1, 'ascii');
    buf[offset + len - 1] = 0;
  };

  writeOctal(isDir ? 0o755 : 0o644, 100, 8); // mode
  writeOctal(0, 108, 8);                       // uid
  writeOctal(0, 116, 8);                       // gid
  writeOctal(isDir ? 0 : size, 124, 12);       // size
  writeOctal(Math.floor(Date.now() / 1000), 136, 12); // mtime
  buf.write('        ', 148, 8, 'ascii');       // checksum placeholder (8 spaces)
  buf[156] = isDir ? 53 : 48;                  // typeflag: '5' dir, '0' file
  buf.write('ustar', 257, 5, 'ascii');          // magic
  buf.write('00', 263, 2, 'ascii');             // version

  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += buf[i];
  const csStr = checksum.toString(8).padStart(6, '0');
  buf.write(csStr, 148, 6, 'ascii');
  buf[154] = 0;
  buf[155] = 0x20;

  return buf;
}

function createTarGz(archivePath, sourceDir, rootName, skipDirs) {
  return new Promise((resolve, reject) => {
    console.log(`  Архивирую ${rootName}...`);
    const entries = collectFiles(sourceDir, rootName, skipDirs);
    entries.unshift({ rel: rootName + '/', full: sourceDir, isDir: true });

    const output = fs.createWriteStream(archivePath);
    const gzip = zlib.createGzip({ level: 6 });
    gzip.pipe(output);

    output.on('close', resolve);
    output.on('error', reject);
    gzip.on('error', reject);

    let fileCount = 0;
    for (const entry of entries) {
      const header = tarHeader(entry.rel, entry.isDir ? 0 : entry.size, entry.isDir);
      gzip.write(header);

      if (!entry.isDir && entry.size > 0) {
        const data = fs.readFileSync(entry.full);
        gzip.write(data);
        const pad = 512 - (data.length % 512);
        if (pad < 512) gzip.write(Buffer.alloc(pad, 0));
        fileCount++;
      }
    }

    gzip.write(Buffer.alloc(1024, 0));
    gzip.end();
    console.log(`  Запаковано файлов: ${fileCount}`);
  });
}

/* ──────── config / credentials ──────── */

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return null; }
}

function saveConfig(host, port, user) {
  const prev = loadConfig() || {};
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...prev, host, port, user }, null, 2), 'utf8');
  console.log('  Сохранено в deploy-config.json (пароль не сохраняем).\n');
}

/** Если в deploy-config.json задан privateKeyPath и файл есть — вход по ключу. */
function tryLoadPrivateKey(saved) {
  if (!saved || !saved.privateKeyPath || !String(saved.privateKeyPath).trim()) return null;
  const keyRel = String(saved.privateKeyPath).trim();
  const keyAbs = path.isAbsolute(keyRel) ? keyRel : path.join(ROOT, keyRel);
  if (!fs.existsSync(keyAbs)) return null;
  const privateKey = fs.readFileSync(keyAbs);
  const passphrase = process.env.DEPLOY_KEY_PASSPHRASE;
  return { privateKey, passphrase: passphrase ? String(passphrase) : undefined };
}

/** Пароль: приватный ключ из deploy-config → иначе DEPLOY_PASSWORD → иначе запрос. */
async function getCredentialsForCli() {
  const saved = loadConfig();
  if (!saved || !saved.host || !saved.user) {
    throw new Error('Создайте deploy-config.json (host, user, port) по образцу deploy-config.example.json.');
  }
  const port = parseInt(saved.port, 10) || 22;
  const base = { host: saved.host, port, user: saved.user };
  const fromKey = tryLoadPrivateKey(saved);
  if (fromKey) return { ...base, ...fromKey };
  let password = process.env.DEPLOY_PASSWORD;
  if (password === undefined || password === '') {
    password = await ask('Пароль SSH: ');
  }
  if (!password) throw new Error('Пароль не задан (DEPLOY_PASSWORD или ввод).');
  return { ...base, password: String(password) };
}

async function getCredentials() {
  const saved = loadConfig();
  if (saved && saved.host && saved.user) {
    const use = await ask(`Использовать сохранённые данные? (${saved.user}@${saved.host}:${saved.port || 22}) [Д/н]: `);
    if (!use || use.toLowerCase() === 'д' || use.toLowerCase() === 'y' || use === '') {
      const fromKey = tryLoadPrivateKey(saved);
      if (fromKey) {
        return {
          host: saved.host,
          port: parseInt(saved.port, 10) || 22,
          user: saved.user,
          ...fromKey,
        };
      }
      return {
        host: saved.host,
        port: parseInt(saved.port, 10) || 22,
        user: saved.user,
        password: await ask('Пароль: '),
      };
    }
  }
  const host = await ask('Хост (IP сервера): ');
  const portStr = await ask('Порт SSH [22]: ');
  const port = parseInt(portStr, 10) || 22;
  const user = await ask('Пользователь [root]: ') || 'root';
  const password = await ask('Пароль: ');

  const save = await ask('Сохранить хост/порт/пользователь в deploy-config.json? [д/Н]: ');
  if (save && (save.toLowerCase() === 'д' || save.toLowerCase() === 'y')) saveConfig(host, port, user);
  return { host, port, user, password };
}

/* ──────── SSH helpers ──────── */

function connectSSH(creds) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn)).on('error', (err) => {
      const msg = (err && err.message) ? err.message : String(err);
      if (/ECONNRESET|Connection closed|handshake failed|kex_exchange/i.test(msg)) {
        console.error(
          '\n  Подсказка: соединение оборвалось до входа. Часто: не тот пользователь (ubuntu/debian вместо root), ' +
            'вход только по ключу, fail2ban, или нестандартный порт SSH в панели VPS. ' +
            'Проверьте веб-консоль хостинга и журнал: journalctl -u ssh\n'
        );
      }
      reject(err);
    });
    const opts = {
      host: creds.host,
      port: creds.port,
      username: creds.user,
      readyTimeout: 20000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 5,
    };
    if (creds.privateKey) {
      opts.privateKey = creds.privateKey;
      if (creds.passphrase) opts.passphrase = creds.passphrase;
    } else {
      opts.password = creds.password;
    }
    conn.connect(opts);
  });
}

function runLocal(cmd, args, cwd, description, envOverrides) {
  return new Promise((resolve, reject) => {
    console.log(`  ${description}...`);
    const env = envOverrides ? { ...process.env, ...envOverrides } : process.env;
    const p = spawn(cmd, args, { cwd, shell: true, stdio: 'inherit', env });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Exit ${code}`))));
    p.on('error', reject);
  });
}

function runRemote(conn, cmd, label) {
  return new Promise((resolve, reject) => {
    if (label) console.log(`  ${label}...`);
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stdout = '', stderr = '';
      stream.on('data', (d) => { const s = d.toString(); stdout += s; process.stdout.write(s); });
      stream.stderr.on('data', (d) => { const s = d.toString(); stderr += s; process.stderr.write(s); });
      stream.on('close', (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`Remote cmd failed (code ${code}): ${cmd}\n${stderr}`));
      });
    });
  });
}

function sftpUpload(conn, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    const fileName = path.basename(localPath);
    const sizeBytes = fs.statSync(localPath).size;
    const sizeMB = (sizeBytes / 1024 / 1024).toFixed(1);
    console.log(`  Загружаю ${fileName} (${sizeMB} MB)...`);

    conn.sftp((err, sftp) => {
      if (err) return reject(err);

      const readStream = fs.createReadStream(localPath);
      const writeStream = sftp.createWriteStream(remotePath);
      let uploaded = 0;
      const startTime = Date.now();

      readStream.on('data', (chunk) => {
        uploaded += chunk.length;
        const pct = ((uploaded / sizeBytes) * 100).toFixed(0);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        process.stdout.write(`\r  Прогресс: ${pct}% (${(uploaded / 1024 / 1024).toFixed(1)}/${sizeMB} MB, ${elapsed}s)`);
      });

      writeStream.on('close', () => {
        process.stdout.write('\n');
        sftp.end();
        resolve();
      });

      writeStream.on('error', (e) => { sftp.end(); reject(new Error(`SFTP write error: ${e.message}`)); });
      readStream.on('error', (e) => { sftp.end(); reject(new Error(`Local read error: ${e.message}`)); });
      readStream.pipe(writeStream);
    });
  });
}

function sftpDownload(conn, remotePath, localPath) {
  return new Promise((resolve, reject) => {
    const fileName = path.basename(remotePath);
    console.log(`  Скачиваю ${fileName} с сервера...`);

    conn.sftp((err, sftp) => {
      if (err) return reject(err);

      sftp.stat(remotePath, (statErr, stats) => {
        const sizeBytes = statErr ? 0 : stats.size;
        const sizeMB = (sizeBytes / 1024 / 1024).toFixed(1);

        const readStream = sftp.createReadStream(remotePath);
        const writeStream = fs.createWriteStream(localPath);
        let downloaded = 0;
        const startTime = Date.now();

        readStream.on('data', (chunk) => {
          downloaded += chunk.length;
          if (sizeBytes > 0) {
            const pct = ((downloaded / sizeBytes) * 100).toFixed(0);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
            process.stdout.write(`\r  Прогресс: ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)}/${sizeMB} MB, ${elapsed}s)`);
          }
        });

        writeStream.on('close', () => {
          process.stdout.write('\n');
          sftp.end();
          resolve();
        });

        writeStream.on('error', (e) => { sftp.end(); reject(new Error(`Local write error: ${e.message}`)); });
        readStream.on('error', (e) => { sftp.end(); reject(new Error(`SFTP read error: ${e.message}`)); });
        readStream.pipe(writeStream);
      });
    });
  });
}

/* ──────── actions ──────── */

async function actionFullDeploy(conn, opts = {}) {
  const skipBuild = !!opts.skipBuild;
  const backendPath = path.join(ROOT, 'backend');
  const frontendPath = path.join(ROOT, 'frontend');
  const distPath = path.join(frontendPath, 'dist');

  if (!fs.existsSync(backendPath)) throw new Error('Папка backend не найдена.');

  if (skipBuild) {
    console.log('\n1. Сборка фронта пропущена (--skip-build), использую существующий frontend/dist...');
    if (!fs.existsSync(distPath)) throw new Error('Нет frontend/dist. Соберите: cd frontend && npm run build');
  } else {
    console.log('\n1. Сборка фронта (API = /api)...');
    await runLocal('npm', ['run', 'build'], frontendPath, 'npm run build', { VITE_API_URL: '' });
    if (!fs.existsSync(distPath)) throw new Error('После сборки не найдена папка frontend/dist');
  }

  console.log('\n2. Упаковка в архивы...');
  const backendTar = path.join(TMP_DIR, 'freight-backend.tar.gz');
  const distTar = path.join(TMP_DIR, 'freight-dist.tar.gz');

  // ВАЖНО: из архива исключаем БД (app.db), чтобы не затирать боевую базу при деплое
  await createTarGz(backendTar, backendPath, 'backend', ['node_modules', 'app.db', 'app.db-shm', 'app.db-wal']);
  await createTarGz(distTar, distPath, 'dist', null);

  console.log('\n3. Заливка на сервер...');
  await sftpUpload(conn, backendTar, '/tmp/freight-backend.tar.gz');
  await sftpUpload(conn, distTar, '/tmp/freight-dist.tar.gz');

  console.log('\n4. Резервная копия базы данных (app.db)...');
  await runRemote(conn,
    'mkdir -p /root/db-backups && if [ -f /root/backend/app.db ]; then TS=$(date +%Y%m%d_%H%M%S) && cp /root/backend/app.db /root/db-backups/database_$TS.db && cp /root/backend/app.db /tmp/freight-db-deploy-backup.db && echo "OK: BD saved /root/db-backups/database_$TS.db"; else echo "SKIP: app.db not found (first deploy)"; fi',
    'Бэкап БД'
  );

  console.log('\n5. Распаковка и настройка на сервере...');
  await runRemote(conn, [
    'rm -rf /root/backend /root/dist',
    'tar xzf /tmp/freight-backend.tar.gz -C /root/',
    'tar xzf /tmp/freight-dist.tar.gz -C /root/',
    'rm -f /tmp/freight-backend.tar.gz /tmp/freight-dist.tar.gz',
  ].join(' && '), 'Распаковка архивов');

  console.log('\n6. Восстановление базы данных (app.db)...');
  await runRemote(conn,
    'if [ -f /tmp/freight-db-deploy-backup.db ]; then cp /tmp/freight-db-deploy-backup.db /root/backend/app.db && chmod 644 /root/backend/app.db && rm -f /tmp/freight-db-deploy-backup.db && echo "OK: app.db restored ($(stat -c%s /root/backend/app.db) bytes)"; else echo "SKIP: no backup (first deploy) — existing or fresh DB app.db будет использована"; fi',
    'Восстановление БД'
  );

  console.log('\n7. Права и nginx...');
  await runRemote(conn,
    'chmod 755 /root && chmod -R 755 /root/dist && nginx -t && systemctl reload nginx',
    'Права и nginx'
  );

  console.log('\n8. npm install + перезапуск pm2...');
  await runRemote(conn,
    'cd /root/backend && npm install --production && (pm2 restart freight-epl-api 2>/dev/null || (pm2 start server.js --name freight-epl-api && pm2 save))',
    'npm install + pm2'
  );

  console.log('  Python-зависимости для fast EPL PDF...');
  await runRemote(conn,
    'apt-get install -y -qq python3 python3-pip fonts-liberation 2>/dev/null; pip3 install PyMuPDF 2>/dev/null || pip install PyMuPDF 2>/dev/null; echo "Python deps OK"',
    null
  );

  try { fs.unlinkSync(backendTar); } catch {}
  try { fs.unlinkSync(distTar); } catch {}

  // Удаляем старые бэкапы БД, оставляем 10 последних
  await runRemote(conn,
    'ls -t /root/db-backups/database_*.db 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null; echo "Хранится $(ls /root/db-backups/database_*.db 2>/dev/null | wc -l) бэкапов БД"',
    'Очистка старых бэкапов БД'
  ).catch(() => {});

  console.log('\n  ✔ Готово: бэк и фронт залиты, БД сохранена, nginx и PM2 перезапущены.\n');
  console.log('  Бэкапы БД: /root/db-backups/ (хранится до 10 последних)\n');
}

async function actionFrontendOnly(conn, opts = {}) {
  const skipBuild = !!opts.skipBuild;
  const frontendPath = path.join(ROOT, 'frontend');
  const distPath = path.join(frontendPath, 'dist');

  if (skipBuild) {
    console.log('\n1. Сборка пропущена (--skip-build), использую frontend/dist...');
    if (!fs.existsSync(distPath)) throw new Error('Нет frontend/dist. Соберите: cd frontend && npm run build');
  } else {
    console.log('\n1. Сборка фронта (API = /api)...');
    await runLocal('npm', ['run', 'build'], frontendPath, 'npm run build', { VITE_API_URL: '' });
    if (!fs.existsSync(distPath)) throw new Error('После сборки не найдена папка frontend/dist');
  }

  console.log('\n2. Упаковка dist...');
  const distTar = path.join(TMP_DIR, 'freight-dist.tar.gz');
  await createTarGz(distTar, distPath, 'dist', null);

  console.log('\n3. Заливка на сервер...');
  await sftpUpload(conn, distTar, '/tmp/freight-dist.tar.gz');

  console.log('\n4. Распаковка на сервере...');
  await runRemote(conn, [
    'rm -rf /root/dist',
    'tar xzf /tmp/freight-dist.tar.gz -C /root/',
    'rm -f /tmp/freight-dist.tar.gz',
  ].join(' && '), 'Распаковка');

  await runRemote(conn,
    'chmod 755 /root && chmod -R 755 /root/dist && nginx -t && systemctl reload nginx',
    'Права и nginx'
  );

  try { fs.unlinkSync(distTar); } catch {}
  console.log('\n  Готово: фронт залит, права выставлены, nginx перезагружен.\n');
}

async function actionBackendRestart(conn) {
  await runRemote(conn, 'pm2 restart freight-epl-api', 'Перезапуск freight-epl-api');
  console.log('\n  Готово: бэкенд (freight-epl-api) перезапущен.\n');
}

async function actionDownloadDB(conn) {
  // Основная БД бэкенда — app.db (см. backend/database.js)
  const localDbPath = path.join(ROOT, 'backend', 'app.db');
  const localBackupDir = path.join(ROOT, 'backend', 'db-backups');

  // Создаём папку для локальных бэкапов
  if (!fs.existsSync(localBackupDir)) fs.mkdirSync(localBackupDir, { recursive: true });

  // Если локальная БД уже есть — сохраняем её как бэкап
  if (fs.existsSync(localDbPath)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const backupPath = path.join(localBackupDir, `database_${ts}.db`);
    fs.copyFileSync(localDbPath, backupPath);
    console.log(`  Старая локальная БД сохранена: backend/db-backups/database_${ts}.db`);
  }

  console.log('\n  Скачиваю базу данных с сервера (app.db)...');
  await sftpDownload(conn, '/root/backend/app.db', localDbPath);

  const sizeMB = (fs.statSync(localDbPath).size / 1024 / 1024).toFixed(2);
  console.log(`\n  ✔ БД скачана: backend/app.db (${sizeMB} MB)\n`);

  // Чистим старые локальные бэкапы (храним 5)
  try {
    const backups = fs.readdirSync(localBackupDir)
      .filter(f => f.startsWith('database_') && f.endsWith('.db'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(localBackupDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    backups.slice(5).forEach(b => fs.unlinkSync(path.join(localBackupDir, b.name)));
    console.log(`  Локальных бэкапов БД: ${Math.min(backups.length, 5)}`);
  } catch {}
}

async function actionUploadDB(conn) {
  const localDbPath = path.join(ROOT, 'backend', 'app.db');

  if (!fs.existsSync(localDbPath)) {
    console.log('\n  ОШИБКА: Файл backend/app.db не найден локально.');
    console.log('  Сначала скачайте БД с сервера (пункт 5) или убедитесь, что файл существует.\n');
    return;
  }

  const sizeMB = (fs.statSync(localDbPath).size / 1024 / 1024).toFixed(2);
  console.log(`\n  Локальная БД: backend/app.db (${sizeMB} MB)`);
  const confirm = await ask('  Залить эту БД на сервер? Текущая БД сервера будет ЗАМЕНЕНА! [да/Н]: ');
  if (!confirm || !['да', 'yes', 'y', 'д'].includes(confirm.trim().toLowerCase())) {
    console.log('  Отмена.\n');
    return;
  }

  // Бэкап серверной БД перед заменой
  console.log('\n  Создаю бэкап серверной БД...');
  await runRemote(conn,
    'mkdir -p /root/db-backups && if [ -f /root/backend/app.db ]; then TS=$(date +%Y%m%d_%H%M%S) && cp /root/backend/app.db /root/db-backups/database_$TS.db && echo "Бэкап: /root/db-backups/database_$TS.db"; else echo "SKIP: БД на сервере не найдена"; fi',
    'Бэкап серверной БД'
  );

  // pm2 stop чтобы не было блокировки
  console.log('\n  Останавливаю backend на время загрузки...');
  await runRemote(conn, 'pm2 stop freight-epl-api 2>/dev/null; echo "pm2 stopped"', null).catch(() => {});

  console.log('\n  Загружаю БД на сервер (app.db)...');
  await sftpUpload(conn, localDbPath, '/root/backend/app.db');
  await runRemote(conn, 'chmod 644 /root/backend/app.db && echo "OK: rights set"', null);

  // Перезапускаем
  console.log('\n  Запускаю backend...');
  await runRemote(conn, 'cd /root/backend && (pm2 restart freight-epl-api 2>/dev/null || (pm2 start server.js --name freight-epl-api && pm2 save)); echo "pm2 restarted"', 'Перезапуск pm2');

  console.log('\n  ✔ БД успешно залита на сервер и backend перезапущен.\n');
}

async function actionRestoreDBFromServerBackup(conn) {
  console.log('\n  Ищу бэкапы БД на сервере (/root/db-backups)...');
  const listRaw = await runRemote(
    conn,
    'ls -t /root/db-backups/database_*.db 2>/dev/null | head -n 10 || true',
    null
  );
  const files = (listRaw || '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  if (files.length === 0) {
    console.log('\n  ОШИБКА: На сервере нет бэкапов в /root/db-backups/database_*.db\n');
    return;
  }

  console.log('\n  Доступные бэкапы (последние 10):');
  files.forEach((f, i) => console.log(`   ${i + 1}) ${f}`));
  const pick = await ask('\n  Выберите номер для восстановления [1]: ');
  const idx = Math.max(1, Math.min(files.length, parseInt((pick || '1').trim(), 10) || 1));
  const chosen = files[idx - 1];

  const confirm = await ask(`\n  ВОССТАНОВИТЬ БД из "${chosen}"? Текущая /root/backend/app.db будет заменена. [да/Н]: `);
  if (!confirm || !['да', 'yes', 'y', 'д'].includes(confirm.trim().toLowerCase())) {
    console.log('  Отмена.\n');
    return;
  }

  console.log('\n  Останавливаю backend на время восстановления...');
  await runRemote(conn, 'pm2 stop freight-epl-api 2>/dev/null; echo "pm2 stopped"', null).catch(() => {});

  await runRemote(conn, [
    'mkdir -p /root/backend',
    `cp -f "${chosen}" /root/backend/app.db`,
    'chmod 644 /root/backend/app.db',
    'echo "OK: restored -> /root/backend/app.db ($(stat -c%s /root/backend/app.db) bytes)"',
  ].join(' && '), 'Восстановление app.db');

  console.log('\n  Запускаю backend...');
  await runRemote(conn, 'cd /root/backend && (pm2 restart freight-epl-api 2>/dev/null || (pm2 start server.js --name freight-epl-api && pm2 save)); echo "pm2 restarted"', 'Перезапуск pm2');

  console.log('\n  ✔ Готово: БД восстановлена из бэкапа и backend перезапущен.\n');
}

async function actionChangeIP(conn, creds) {
  const ip = (creds.host || '').trim();
  if (!ip) throw new Error('Не указан IP (хост).');
  const safeIp = ip.replace(/[^0-9.a-fA-F:-]/g, '');
  const cmd = `grep -q "${safeIp}" /etc/nginx/sites-available/taxi 2>/dev/null || sed -i "s/\\(server_name [^;]*\\)/\\1 ${safeIp}/" /etc/nginx/sites-available/taxi; nginx -t && systemctl reload nginx && pm2 restart freight-epl-api`;
  await runRemote(conn, cmd, 'Обновление nginx');
  console.log('\n  Готово: IP ' + ip + ' добавлен в nginx, nginx перезагружен, бэкенд перезапущен.\n');
}

/* ──────── menu ──────── */

function showMenu() {
  console.log('\n  ╔══════════════════════════════════════╗');
  console.log('  ║         ДЕПЛОЙ ПАНЕЛЬ ТАКСИ          ║');
  console.log('  ╠══════════════════════════════════════╣');
  console.log('  ║  1. Залить всё  (бэк + фронт)        ║');
  console.log('  ║  2. Залить фронт (только dist)        ║');
  console.log('  ║  3. Перезапустить бэкенд (pm2)        ║');
  console.log('  ║  4. Сменить IP сервера                ║');
  console.log('  ║──────────────────────────────────────║');
  console.log('  ║  5. Скачать БД с сервера → локально   ║');
  console.log('  ║  6. Залить локальную БД на сервер     ║');
  console.log('  ║  7. Восстановить БД из бэкапа (сервер)║');
  console.log('  ║──────────────────────────────────────║');
  console.log('  ║  0. Выход                             ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
}

async function runMenu() {
  showMenu();
  const choice = await ask('  Выбор (1/2/3/4/5/6/7/0): ');
  const n = choice.trim();

  if (n === '0') { rl.close(); process.exit(0); }
  if (!['1', '2', '3', '4', '5', '6', '7'].includes(n)) {
    console.log('  Неверный выбор.\n');
    return runMenu();
  }

  let conn;
  try {
    let creds;
    if (n === '4') {
      const newIp = await ask('Новый IP сервера (или Enter — оставить текущий из конфига): ');
      const trimmed = newIp.trim();
      const saved = loadConfig();
      if (trimmed) {
        saveConfig(trimmed, saved?.port || 22, saved?.user || 'root');
        console.log('  Сохранён IP в deploy-config.json.\n');
      }
      creds = await getCredentials();
      conn = await connectSSH(creds);
      await actionChangeIP(conn, creds);
    } else {
      creds = await getCredentials();
      conn = await connectSSH(creds);
      if (n === '1') await actionFullDeploy(conn);
      else if (n === '2') await actionFrontendOnly(conn);
      else if (n === '3') await actionBackendRestart(conn);
      else if (n === '5') await actionDownloadDB(conn);
      else if (n === '6') await actionUploadDB(conn);
      else if (n === '7') await actionRestoreDBFromServerBackup(conn);
    }
  } catch (e) {
    console.error('\n  Ошибка:', e.message || e);
  } finally {
    if (conn) conn.end();
  }
  return runMenu();
}

function parseCliArgs() {
  const argv = process.argv.slice(2);
  return {
    full: argv.includes('--full'),
    frontendOnly: argv.includes('--frontend-only') || argv.includes('--frontend'),
    restart: argv.includes('--restart-backend') || argv.includes('--restart'),
    skipBuild: argv.includes('--skip-build'),
  };
}

async function runCli() {
  const flags = parseCliArgs();
  let conn;
  try {
    const creds = await getCredentialsForCli();
    conn = await connectSSH(creds);
    if (flags.full) await actionFullDeploy(conn, { skipBuild: flags.skipBuild });
    else if (flags.frontendOnly) await actionFrontendOnly(conn, { skipBuild: flags.skipBuild });
    else if (flags.restart) await actionBackendRestart(conn);
  } finally {
    if (conn) conn.end();
    rl.close();
  }
}

async function main() {
  const flags = parseCliArgs();
  if (flags.full || flags.frontendOnly || flags.restart) {
    try {
      await runCli();
    } catch (e) {
      console.error('\n  Ошибка:', e.message || e);
      process.exit(1);
    }
    process.exit(0);
  }
  await runMenu();
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
