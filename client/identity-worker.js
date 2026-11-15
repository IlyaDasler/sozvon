// Единственный владелец privateJwk. Main и renderer получают только результаты операций.
const parentPort = process.parentPort || require('node:worker_threads').parentPort;
const { webcrypto } = require('node:crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const { argon2id } = require('hash-wasm');
const x3dh = require('./renderer/x3dh');
const ratchet = require('./renderer/ratchet-dh');
const ratchets = new Map();

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
const vaults = new Map();

const contextKey = (context) => `${context?.server || ''}|${Number(context?.userId) || 0}`;
const contextOf = (context) => ({ server: String(context?.server || ''), userId: Number(context?.userId) || 0 });

async function importIdentity(identity) {
  if (!identity?.publicKey || !identity?.privateJwk) throw new Error('Некорректный ключ');
  return {
    identity: { publicKey: String(identity.publicKey), privateJwk: identity.privateJwk },
    privateKey: await subtle.importKey('jwk', identity.privateJwk, ECDH, false, ['deriveBits']),
  };
}

async function store(context, identity) {
  const opened = await importIdentity(identity);
  vaults.set(contextKey(context), { ...opened, context: contextOf(context) });
  return { publicKey: opened.identity.publicKey };
}

async function sharedKey(privateKey, publicB64, info) {
  const publicKey = await subtle.importKey('raw', fromB64(publicB64), ECDH, false, []);
  const bits = await subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const hkdf = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(info) },
    hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

function ensure(context) {
  const value = vaults.get(contextKey(context));
  if (!value) throw new Error('Ключ не загружен');
  return value;
}

async function open(context, sealed) {
  const value = ensure(context);
  const { epk, iv, ct } = JSON.parse(sealed);
  const key = await sharedKey(value.privateKey, epk, 'sozvon-seal-v1');
  return b64(await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(ct)));
}

async function passwordKey(password, salt, iterations) {
  const base = await subtle.importKey('raw', enc.encode(String(password).normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

async function wrapBackup(context, password, userId) {
  const value = ensure(context);
  const salt = random(16);
  const iv = random(12);
  const derived = await argon2id({ password: String(password).normalize('NFKC'), salt, ...ARGON2, hashLength: 32, outputType: 'binary' });
  const key = await subtle.importKey('raw', derived, 'AES-GCM', false, ['encrypt']);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD(userId) }, key, enc.encode(JSON.stringify(value.identity)));
  const legacySalt = random(16);
  const legacyIV = random(12);
  const legacyKey = await passwordKey(password, legacySalt, ITERATIONS);
  const legacyCT = await subtle.encrypt({ name: 'AES-GCM', iv: legacyIV, additionalData: AAD(userId) }, legacyKey, enc.encode(JSON.stringify(value.identity)));
  return {
    salt: `argon2id$m=${ARGON2.memorySize},t=${ARGON2.iterations},p=${ARGON2.parallelism}$${b64(salt)}`,
    iv: b64(iv), ct: b64(ct), iterations: 100_000,
    legacySalt: b64(legacySalt), legacyIv: b64(legacyIV), legacyCt: b64(legacyCT), legacyIterations: ITERATIONS,
  };
}

async function unwrapBackup(context, backup, password, userId) {
  let key;
  const marker = /^argon2id\$m=(\d+),t=(\d+),p=(\d+)\$(.+)$/.exec(String(backup?.salt || ''));
  if (marker) {
    const derived = await argon2id({
      password: String(password).normalize('NFKC'), salt: fromB64(marker[4]),
      memorySize: Number(marker[1]), iterations: Number(marker[2]), parallelism: Number(marker[3]),
      hashLength: 32, outputType: 'binary',
    });
    key = await subtle.importKey('raw', derived, 'AES-GCM', false, ['decrypt']);
  } else {
    key = await passwordKey(password, fromB64(backup.salt), Number(backup?.iterations) || ITERATIONS);
  }
  const plain = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(backup.iv), additionalData: AAD(userId) },
    key, fromB64(backup.ct)
  );
  return store(context, JSON.parse(dec.decode(plain)));
}

function ratchetKey(context, conv) {
  return `${contextKey(context)}|${String(conv || '')}`;
}

async function ratchetEnsureStatic(context, conv, root, role, remotePublic) {
  const key = ratchetKey(context, conv);
  if (!ratchets.has(key)) {
    const value = ensure(context);
    ratchets.set(key, await ratchet.createStaticState(root, role === 'b' ? 'b' : 'a', value.identity.privateJwk, value.identity.publicKey, String(remotePublic)));
  }
  return true;
}

async function ratchetInit(context, conv, root, role) {
  const state = await ratchet.createState(root, role === 'b' ? 'b' : 'a');
  ratchets.set(ratchetKey(context, conv), state);
  return { publicKey: state.local.publicKey };
}

async function ratchetHandshake(context, conv, remotePublic) {
  const state = ratchets.get(ratchetKey(context, conv));
  if (!state) throw new Error('Ratchet не создан');
  await ratchet.handshake(state, String(remotePublic));
  return true;
}

async function ratchetExportAll() {
  return [...ratchets.entries()].map(([key, state]) => ({ key, state: ratchet.exportState(state) }));
}

async function ratchetImportAll(entries) {
  for (const entry of entries || []) {
    try {
      ratchets.set(String(entry.key), await ratchet.importState(entry.state));
    } catch {}
  }
  return true;
}

async function ratchetEncrypt(context, conv, payload, aad) {
  const state = ratchets.get(ratchetKey(context, conv));
  if (!state) throw new Error('Ratchet не создан');
  return ratchet.encrypt(state, payload, String(aad));
}

async function ratchetDecrypt(context, conv, envelope, aad) {
  const state = ratchets.get(ratchetKey(context, conv));
  if (!state) throw new Error('Ratchet не создан');
  return ratchet.decrypt(state, envelope, String(aad));
}

async function x3dhInit(context, bundle) {
  const value = ensure(context);
  return x3dh.initiatorSecret({ identityPrivateJwk: value.identity.privateJwk, bundle });
}

async function x3dhRespond(context, initiatorIdentityPublic, initiatorEphemeralPublic) {
  const value = ensure(context);
  if (!value.identity.signedPrekey?.privateJwk) throw new Error('Signed prekey не создан');
  const root = await x3dh.responderSecret({
    identityPrivateJwk: value.identity.privateJwk,
    signedPrekeyPrivateJwk: value.identity.signedPrekey.privateJwk,
    initiatorIdentityPublic,
    initiatorEphemeralPublic,
  });
  return { root };
}

async function ensurePrekey(context) {
  const value = ensure(context);
  if (!value.identity.signedPrekey) {
    const pair = await subtle.generateKey(ECDH, true, ['deriveBits']);
    value.identity.signedPrekey = {
      publicKey: b64(await subtle.exportKey('raw', pair.publicKey)),
      privateJwk: await subtle.exportKey('jwk', pair.privateKey),
      createdAt: Math.floor(Date.now() / 1000),
    };
  }
  return { publicKey: value.identity.signedPrekey.publicKey, createdAt: value.identity.signedPrekey.createdAt };
}

async function generate(context) {
  const pair = await subtle.generateKey(ECDH, true, ['deriveBits']);
  const identity = {
    publicKey: b64(await subtle.exportKey('raw', pair.publicKey)),
    privateJwk: await subtle.exportKey('jwk', pair.privateKey),
  };
  return store(context, identity);
}

async function exportAll() {
  return [...vaults.entries()].map(([key, value]) => ({ context: value.context, identity: value.identity }));
}

parentPort.on('message', async (event) => {
  const message = event?.data || event;
  const { id, op } = message;
  try {
    let result;
    if (op === 'init') {
      for (const entry of message.entries || []) {
        try { await store(entry.context, entry.identity); } catch {}
      }
      result = true;
    } else if (op === 'load') result = vaults.get(contextKey(message.context))?.identity.publicKey ? { publicKey: vaults.get(contextKey(message.context)).identity.publicKey } : null;
    else if (op === 'import') result = await store(message.context, message.identity);
    else if (op === 'generate') result = await generate(message.context);
    else if (op === 'prekey') result = await ensurePrekey(message.context);
    else if (op === 'x3dh-init') result = await x3dhInit(message.context, message.bundle);
    else if (op === 'x3dh-verify') result = await x3dh.verifyBundle(message.bundle, message.serverPublicKey);
    else if (op === 'x3dh-respond') result = await x3dhRespond(message.context, message.initiatorIdentityPublic, message.initiatorEphemeralPublic);
    else if (op === 'ratchet-init') result = await ratchetInit(message.context, message.conv, message.root, message.role);
    else if (op === 'ratchet-ensure-static') result = await ratchetEnsureStatic(message.context, message.conv, message.root, message.role, message.remotePublic);
    else if (op === 'ratchet-handshake') result = await ratchetHandshake(message.context, message.conv, message.remotePublic);
    else if (op === 'ratchet-encrypt') result = await ratchetEncrypt(message.context, message.conv, message.payload, message.aad);
    else if (op === 'ratchet-decrypt') result = await ratchetDecrypt(message.context, message.conv, message.envelope, message.aad);
    else if (op === 'ratchet-export') result = await ratchetExportAll();
    else if (op === 'ratchet-import') result = await ratchetImportAll(message.entries);
    else if (op === 'open') result = await open(message.context, message.sealed);
    else if (op === 'wrap') result = await wrapBackup(message.context, message.password, message.userId);
    else if (op === 'unwrap') result = await unwrapBackup(message.context, message.backup, message.password, message.userId);
    else if (op === 'exportAll') result = await exportAll();
    else if (op === 'clear') { vaults.clear(); result = true; }
    else throw new Error('unknown identity op');
    parentPort.postMessage({ id, ok: true, result });
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
});