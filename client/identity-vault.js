// PrivateJwk живёт в отдельном worker-процессе. Main хранит только
// зашифрованный файл и проксирует узкие операции.
const { app, ipcMain, safeStorage, utilityProcess } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const filePath = () => path.join(app.getPath('userData'), 'e2ee-identity-v2.bin');
let worker = null;
let seq = 0;
let initialized = false;
const pending = new Map();

function workerPath() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'app.asar.unpacked', 'identity-worker.js');
  return path.join(__dirname, 'identity-worker.js');
}

function startWorker() {
  if (worker) return worker;
  worker = utilityProcess.fork(workerPath(), [], { serviceName: 'Sozvon identity' });
  worker.on('message', (message) => {
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    clearTimeout(item.timer);
    if (message.ok) item.resolve(message.result);
    else item.reject(new Error(message.error || 'identity worker error'));
  });
  worker.on('error', (err) => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(err);
    }
    pending.clear();
    worker = null;
  });
  worker.on('exit', () => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error('identity worker stopped'));
    }
    pending.clear();
    worker = null;
  });
  return worker;
}

function rpc(op, data = {}) {
  return new Promise((resolve, reject) => {
    try {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('identity worker timeout'));
      }, 30_000);
      pending.set(id, { resolve, reject, timer });
      startWorker().postMessage({ id, op, ...data });
    } catch (err) {
      reject(err);
    }
  });
}

async function loadFile() {
  if (initialized) return;
  initialized = true;
  let entries = [];
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const file = filePath();
      if (fs.existsSync(file)) {
        const packed = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
        entries = Array.isArray(packed.entries) ? packed.entries : [];
      }
    }
  } catch {}
  await rpc('init', { entries });
}

async function persist() {
  if (!safeStorage.isEncryptionAvailable()) return false;
  try {
    const entries = await rpc('exportAll');
    const packed = JSON.stringify({ entries });
    const file = filePath();
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, safeStorage.encryptString(packed), { mode: 0o600 });
    try { fs.unlinkSync(file); } catch {}
    fs.renameSync(temp, file);
    return true;
  } catch {
    return false;
  }
}

async function load(context) {
  await loadFile();
  return rpc('load', { context });
}

async function importFor(context, identity) {
  await loadFile();
  const result = await rpc('import', { context, identity });
  await persist();
  try { fs.unlinkSync(path.join(app.getPath('userData'), 'e2ee-identity.bin')); } catch {}
  return result;
}

async function verifyX3dhBundle(bundle, serverPublicKey) {
  return rpc('x3dh-verify', { bundle, serverPublicKey });
}

async function x3dhInitiator(context, bundle) {
  await loadFile();
  return rpc('x3dh-init', { context, bundle });
}

async function x3dhResponder(context, initiatorIdentityPublic, initiatorEphemeralPublic) {
  await loadFile();
  return rpc('x3dh-respond', { context, initiatorIdentityPublic, initiatorEphemeralPublic });
}

async function ensurePrekey(context) {
  await loadFile();
  const result = await rpc('prekey', { context });
  await persist();
  return result;
}

async function generateFor(context) {
  await loadFile();
  const result = await rpc('generate', { context });
  await persist();
  return result;
}

const openEvents = new Map();

async function open(context, sealed) {
  await loadFile();
  // Ограничиваем массовое открытие ключей переписок: XSS не должен
  // выгружать всю историю одним циклом IPC-вызовов.
  const key = `${context?.server || ''}|${Number(context?.userId) || 0}`;
  const now = Date.now();
  const recent = (openEvents.get(key) || []).filter((at) => now - at < 60_000);
  if (recent.length >= 240) throw new Error('Слишком много открытий ключей, подождите минуту');
  recent.push(now);
  openEvents.set(key, recent);
  return rpc('open', { context, sealed });
}

async function wrapBackup(context, password, userId) {
  await loadFile();
  return rpc('wrap', { context, password, userId });
}

async function unwrapBackup(context, backup, password, userId) {
  await loadFile();
  const result = await rpc('unwrap', { context, backup, password, userId });
  await persist();
  return result;
}

function registerIdentityVault() {
  ipcMain.handle('identity-vault:load', (_event, context) => load(context || {}));
  ipcMain.handle('identity-vault:import', (_event, context, identity) => importFor(context || {}, identity));
  ipcMain.handle('identity-vault:generate', (_event, context) => generateFor(context || {}));
  ipcMain.handle('identity-vault:prekey', (_event, context) => ensurePrekey(context || {}));
  ipcMain.handle('identity-vault:x3dh-init', (_event, context, bundle) => x3dhInitiator(context || {}, bundle));
  ipcMain.handle('identity-vault:x3dh-respond', (_event, context, identity, ephemeral) => x3dhResponder(context || {}, String(identity), String(ephemeral)));
  ipcMain.handle('identity-vault:x3dh-verify', (_event, bundle, serverPublicKey) => verifyX3dhBundle(bundle, String(serverPublicKey)));
  ipcMain.handle('identity-vault:open', (_event, context, sealed) => open(context || {}, String(sealed)));
  ipcMain.handle('identity-vault:wrap-backup', (_event, context, password, userId) => wrapBackup(context || {}, String(password), Number(userId)));
  ipcMain.handle('identity-vault:unwrap-backup', (_event, context, backup, password, userId) => unwrapBackup(context || {}, backup, String(password), Number(userId)));
  ipcMain.handle('identity-vault:clear', async () => {
    await loadFile();
    await rpc('clear');
    return true;
  });
}

module.exports = { registerIdentityVault };