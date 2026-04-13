/**
 * Быстрый деплой только бэкенда (без интерактивного меню)
 * Использование: node deploy-backend-only.js [password]
 */
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');

const ROOT = path.resolve(__dirname);
const CONFIG_PATH = path.join(ROOT, 'deploy-config.json');

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    throw new Error('Не найден deploy-config.json');
  }
}

function connectSSH(creds) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn)).on('error', reject);
    conn.connect({
      host: creds.host,
      port: creds.port,
      username: creds.user,
      password: creds.password,
      readyTimeout: 20000,
    });
  });
}

function ensureRemoteDir(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, (err) => {
      if (err && err.code !== 4) return reject(err);
      resolve();
    });
  });
}

function uploadDir(sftp, localDir, remoteDir, skipDirName) {
  return new Promise((resolve, reject) => {
    fs.readdir(localDir, { withFileTypes: true }, (err, entries) => {
      if (err) return reject(err);
      const dirs = [];
      const files = [];
      for (const entry of entries) {
        if (entry.name === skipDirName) continue;
        const localPath = path.join(localDir, entry.name);
        const remotePath = remoteDir + '/' + entry.name;
        if (entry.isDirectory()) dirs.push({ localPath, remotePath });
        else if (entry.isFile()) files.push({ localPath, remotePath });
      }
      (async () => {
        await ensureRemoteDir(sftp, remoteDir);
        for (const d of dirs) {
          await ensureRemoteDir(sftp, d.remotePath);
          await uploadDir(sftp, d.localPath, d.remotePath, null);
        }
        for (const f of files) {
          if (!fs.existsSync(f.localPath)) return Promise.reject(new Error('Нет файла: ' + f.localPath));
          await new Promise((res, rej) => {
            sftp.fastPut(f.localPath, f.remotePath, (e) => (e ? rej(new Error(f.localPath + ' -> ' + (e.message || e))) : res()));
          });
        }
        resolve();
      })().catch(reject);
    });
  });
}

function execCommand(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let output = '';
      stream.on('close', (code) => {
        if (code === 0) resolve(output);
        else reject(new Error(`Command failed with code ${code}: ${output}`));
      });
      stream.stderr.on('data', (d) => { output += d.toString(); process.stderr.write(d); });
      stream.stdout.on('data', (d) => { output += d.toString(); process.stdout.write(d); });
    });
  });
}

async function main() {
  const password = process.argv[2];
  if (!password) {
    console.error('Использование: node deploy-backend-only.js <password>');
    process.exit(1);
  }

  const config = loadConfig();
  const creds = {
    host: config.host,
    port: config.port || 22,
    user: config.user || 'root',
    password: password
  };

  console.log(`\n=== Деплой бэкенда на ${creds.user}@${creds.host}:${creds.port} ===\n`);

  const backendPath = path.join(ROOT, 'backend');
  if (!fs.existsSync(backendPath)) {
    throw new Error('Папка backend не найдена.');
  }

  let conn;
  try {
    console.log('1. Подключение к серверу...');
    conn = await connectSSH(conn, creds);
    console.log('   ✓ Подключено\n');

    console.log('2. Заливка backend на сервер...');
    await new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => {
        if (err) return reject(err);
        (async () => {
          await ensureRemoteDir(sftp, '/root/backend');
          console.log('   Заливаю backend (без node_modules)...');
          await uploadDir(sftp, backendPath, '/root/backend', 'node_modules');
          resolve();
        })().catch(reject);
      });
    });
    console.log('   ✓ Файлы залиты\n');

    console.log('3. Установка зависимостей и перезапуск...');
    await execCommand(conn, 'cd /root/backend && npm install && pm2 restart freight-epl-api');
    console.log('   ✓ Готово\n');

    console.log('4. Добавление PUBLIC_APP_URL в .env (если отсутствует)...');
    await execCommand(conn, 'grep -q "^PUBLIC_APP_URL=" /root/backend/.env || echo "# PUBLIC_APP_URL=https://ваш-домен.example — раскомментируйте и укажите" >> /root/backend/.env');
    console.log('   ✓ Проверено\n');

    console.log('5. Финальный перезапуск...');
    await execCommand(conn, 'pm2 restart freight-epl-api');
    console.log('   ✓ Готово\n');

    console.log('\n✅ Деплой завершён успешно!\n');
  } catch (error) {
    console.error('\n❌ Ошибка:', error.message || error);
    process.exit(1);
  } finally {
    if (conn) conn.end();
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
