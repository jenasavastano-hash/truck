/**
 * Запуск run-workers.js с записью PID в .panel-workers.pid (для панели: перезапуск = убить по PID, открыть новое окно).
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const signerDir = __dirname;
const pidFile = path.join(signerDir, '..', '.panel-workers.pid');

function cleanup() {
  try { fs.unlinkSync(pidFile); } catch (_) {}
}

fs.writeFileSync(pidFile, String(process.pid), 'utf8');
process.on('exit', cleanup);

const child = spawn(process.execPath, [path.join(signerDir, 'run-workers.js')], {
  stdio: 'inherit',
  cwd: signerDir,
  env: process.env
});
child.on('exit', (code) => {
  cleanup();
  process.exit(code != null ? code : 0);
});
