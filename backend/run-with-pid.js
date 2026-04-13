/**
 * Запуск server.js с записью PID в .panel-backend.pid (для панели: перезапуск = убить по PID, открыть новое окно).
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const backendDir = __dirname;
const pidFile = path.join(backendDir, '..', '.panel-backend.pid');

function cleanup() {
  try { fs.unlinkSync(pidFile); } catch (_) {}
}

fs.writeFileSync(pidFile, String(process.pid), 'utf8');
process.on('exit', cleanup);

const child = spawn(process.execPath, [path.join(backendDir, 'server.js')], {
  stdio: 'inherit',
  cwd: backendDir,
  env: process.env
});
child.on('exit', (code) => {
  cleanup();
  process.exit(code != null ? code : 0);
});
