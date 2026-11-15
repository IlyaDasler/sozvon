// Приватный ключ E2EE хранится в main-процессе. Renderer не получает privateJwk:
// только публичный ключ и узкие операции open/wrap/unwrap.
const { app, ipcMain, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const { argon2id } = require('hash-wasm');

const subtle = webcrypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const AAD = (userId) => enc.encode(`sozvon-key-backup-v1|${userId}`);
const ITERATIONS = 600_000;
const ARGON2 = { memorySize: 65536, iterations: 3, parallelism: 1 };

const b64 = (buf) => Buffer.from(buf).toString('base64');
const fromB64 = (value) => Uint8Array.from(Buffer.from(String(value), 'base64'));
const random = (n) => webcrypto.getRandomValues(new Uint8Array(n));
const filePath = () => path.join(app.getPath('userData'), 'e2ee-identity-v2.bin');

const vaults = new Map(); // contextKey -> { identity, privateKey }
let loadedFile = false;

function contextKey(context) {
  return `${context?.server || ''}|${Number(context?.userId) || 0}`;
}

function contextOf(context) {
  return { server: String(context?.server || ''), userId: Number(context?.userId) || 0 };
}

async function importIdentity(identity) {
  if (!identity?.publicKey || !identity?.privateJwk) throw new Error('Некорректный ключ');
  return {
    identity: { publicKey: String(identity.publicKey), privateJwk: identity.privateJwk },
    privateKey: await subtle.importKey('jwk', identity.privateJwk, ECDH, false, ['deriveBits']),
  };
}

async function loadFile() {
  if (loadedFile) return;
  loadedFile = true;
  try {
    if (!safeStorage.isEncryptionAvailable()) return;
    const file = filePath();
    if (!fs.existsSync(file)) return;
    const packed = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
    for (const entry of packed.entries || []) {
      try {
        const opened = await importIdentity(entry.identity);
        vaults.set(contextKey(entry.context), { ...opened, context: contextOf(entry.context) });
      } catch {}
    }
  } catch {}
}

async function persist() {
  if (!safeStorage.isEncryptionAvailable()) return false;
  try {
    const entries = [...vaults.entries()].map(([key, value]) => ({ context: value.context, identity: value.identity }));
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
  const key = contextKey(context);
  const value = vaults.get(key);
  return value ? { publicKey: value.identity.publicKey } : null;
}

async function importFor(context, identity) {
  const opened = await importIdentity(identity);
  vaults.set(contextKey(context), { ...opened, context: contextOf(context) });
  await persist();
  try { fs.unlinkSync(path.join(app.getPath('userData'), 'e2ee-identity.bin')); } catch {}
  return { publicKey: opened.identity.publicKey };
}

async function generateFor(context) {
  const pair = await subtle.generateKey(ECDH, true, ['deriveBits']);
  const identity = {
    publicKey: b64(await subtle.exportKey('raw', pair.publicKey)),
    privateJwk: await subtle.exportKey('jwk', pair.privateKey),
  };
  await importFor(context, identity);
  return { publicKey: identity.publicKey };
}

async function ensure(context) {
  await loadFile();
  const value = vaults.get(contextKey(context));
  if (!value) throw new Error('Ключ не загружен');
  return value.privateKey;
}

async function sharedKey(privateKey, publicB64, info) {
  const publicKey = await subtle.importKey('raw', fromB64(publicB64), ECDH, false, []);
  const bits = await subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const hkdf = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(info) },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function open(context, sealed) {
  const { epk, iv, ct } = JSON.parse(sealed);
  const key = await sharedKey(await ensure(context), epk, 'sozvon-seal-v1');
  return b64(await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(ct)));
}

async function passwordKey(password, salt) {
  const base = await subtle.importKey('raw', enc.encode(String(password).normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function wrapBackup(context, password, userId) {
  await loadFile();
  const value = vaults.get(contextKey(context));
  if (!value) throw new Error('Ключ не загружен');
  const salt = random(16);
  const iv = random(12);
  const derived = await argon2id({
    password: String(password).normalize('NFKC'),
    salt,
    ...ARGON2,
    hashLength: 32,
    outputType: 'binary',
  });
  const key = await subtle.importKey('raw', derived, 'AES-GCM', false, ['encrypt']);
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: AAD(userId) },
    key,
    enc.encode(JSON.stringify(value.identity))
  );
  const marker = `argon2id$m=${ARGON2.memorySize},t=${ARGON2.iterations},p=${ARGON2.parallelism}$${b64(salt)}`;
  // iterations оставлен для старого сервера/валидатора; параметры Argon2 — в salt.
  return { salt: marker, iv: b64(iv), ct: b64(ct), iterations: 100_000 };
}

async function unwrapBackup(context, backup, password, userId) {
  let key;
  const marker = /^argon2id\$m=(\d+),t=(\d+),p=(\d+)\$(.+)$/.exec(String(backup?.salt || ''));
  if (marker) {
    const derived = await argon2id({
      password: String(password).normalize('NFKC'),
      salt: fromB64(marker[4]),
      memorySize: Number(marker[1]),
      iterations: Number(marker[2]),
      parallelism: Number(marker[3]),
      hashLength: 32,
      outputType: 'binary',
    });
    key = await subtle.importKey('raw', derived, 'AES-GCM', false, ['decrypt']);
  } else {
    const iterations = Number(backup?.iterations) || ITERATIONS;
    const base = await subtle.importKey('raw', enc.encode(String(password).normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
    key = await subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(backup.salt), iterations },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
  }
  const plain = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(backup.iv), additionalData: AAD(userId) },
    key,
    fromB64(backup.ct)
  );
  const identity = JSON.parse(dec.decode(plain));
  const opened = await importIdentity(identity);
  vaults.set(contextKey(context), { ...opened, context: contextOf(context) });
  await persist();
  return { publicKey: opened.identity.publicKey };
}

function registerIdentityVault() {
  ipcMain.handle('identity:load', (_event, context) => load(context || {}));
  ipcMain.handle('identity:import', (_event, context, identity) => importFor(context || {}, identity));
  ipcMain.handle('identity:generate', (_event, context) => generateFor(context || {}));
  ipcMain.handle('identity:open', (_event, context, sealed) => open(context || {}, sealed));
  ipcMain.handle('identity:wrap-backup', (_event, context, password, userId) => wrapBackup(context || {}, password, userId));
  ipcMain.handle('identity:unwrap-backup', (_event, context, backup, password, userId) => unwrapBackup(context || {}, backup, password, userId));
  ipcMain.handle('identity:clear', () => {
    vaults.clear();
    return true;
  });
}

module.exports = { registerIdentityVault };
