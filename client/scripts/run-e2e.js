// Портативный прогон сквозных сценариев для CI.
// Запускается из client: node scripts/run-e2e.js e2e-groups e2e-hubs ...
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const client = path.resolve(__dirname, '..');
const electron =
  process.platform === 'win32'
    ? path.join(client, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(client, 'node_modules', 'electron', 'dist', 'electron');
const names = process.argv.slice(2);
if (!fs.existsSync(electron)) {
  console.error(`Нет Electron: ${electron}`);
  process.exit(2);
}
if (!names.length) {
  console.error('Укажи сценарии: node scripts/run-e2e.js e2e-groups ...');
  process.exit(2);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const tmp = path.join(os.tmpdir(), `sozvon-e2e-${process.pid}`);
fs.mkdirSync(tmp, { recursive: true });
env.TEMP = tmp;
env.TMP = tmp;
env.MAIL_TEST_FILE = env.MAIL_TEST_FILE || path.join(tmp, 'mail.log');
env.LINK_PREVIEW_ALLOW_PRIVATE = '1';

const logs = path.join(client, 'e2e-logs');
fs.mkdirSync(logs, { recursive: true });
const summary = [];
let failed = 0;

for (const name of names) {
  const started = Date.now();
  const gpu = process.env.E2E_NO_GPU ? ['--disable-gpu'] : [];
  const res = spawnSync(electron, ['--no-sandbox', ...gpu, `scripts/${name}.js`], {
    cwd: client,
    env,
    stdio: 'inherit',
    timeout: 600_000
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  if (res.error) console.error(`${name}: ${res.error.message}`);
  const line = `${name.padEnd(24)} ${res.status === 0 ? 'OK' : `FAIL(${res.status ?? res.signal ?? 'null'})`} ${String(seconds).padStart(4)}s`;
  summary.push(line);
  console.log(line);
  if (res.status !== 0) {
    failed++;
    fs.writeFileSync(path.join(logs, `${name}.log`), `exit=${res.status} signal=${res.signal || ''}`);
  }
}
fs.writeFileSync(path.join(logs, '_summary.txt'), summary.join('\n'));
process.exit(failed ? 1 : 0);
