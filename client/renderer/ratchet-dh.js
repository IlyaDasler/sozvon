// Прототип DH-ratchet для 3.9. Не подключён к переписке.
const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = globalThis.crypto.subtle;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const raw = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const concat = (a, b) => { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; };
const hkdf = async (ikm, info, length = 32) => {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(info) },
    key, length * 8
  ));
};
const aesKey = (bytes, usage) => subtle.importKey('raw', bytes, 'AES-GCM', false, [usage]);

async function newPair() {
  const pair = await subtle.generateKey(ECDH, true, ['deriveBits']);
  return {
    privateKey: pair.privateKey,
    publicKey: b64(await subtle.exportKey('raw', pair.publicKey)),
    privateJwk: await subtle.exportKey('jwk', pair.privateKey),
  };
}

async function importPrivate(jwk) { return subtle.importKey('jwk', jwk, ECDH, false, ['deriveBits']); }
async function importPublic(s) { return subtle.importKey('raw', raw(s), ECDH, false, []); }

async function deriveRoot(rootB64, privateKey, remoteB64, role) {
  const bits = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: await importPublic(remoteB64) }, privateKey, 256));
  const material = concat(raw(rootB64), bits);
  const sendLabel = role === 'a' ? 'sozvon-dh-a-to-b' : 'sozvon-dh-b-to-a';
  const recvLabel = role === 'a' ? 'sozvon-dh-b-to-a' : 'sozvon-dh-a-to-b';
  return {
    root: b64(await hkdf(material, 'sozvon-dh-root-v1')),
    send: b64(await hkdf(material, sendLabel)),
    recv: b64(await hkdf(material, recvLabel)),
  };
}

async function createState(rootB64, role) {
  const local = await newPair();
  return { root: rootB64, role, local, remote: null, sendChain: null, recvChain: null, sendN: 0, recvN: 0, skipped: new Map() };
}

async function handshake(state, remoteB64) {
  const derived = await deriveRoot(state.root, state.local.privateKey, remoteB64, state.role);
  state.root = derived.root;
  state.remote = remoteB64;
  state.sendChain = derived.send;
  state.recvChain = derived.recv;
  state.sendN = 0;
  state.recvN = 0;
  state.skipped.clear();
  return state;
}

async function rotate(state) {
  state.local = await newPair();
  state.sendChain = null;
  state.sendN = 0;
  return state.local.publicKey;
}

async function chainStep(chainB64) {
  const chain = raw(chainB64);
  return {
    messageKey: await hkdf(chain, 'sozvon-dh-message-v1'),
    nextChain: b64(await hkdf(chain, 'sozvon-dh-chain-v1')),
  };
}

async function encrypt(state, payload, aad) {
  if (!state.remote) throw new Error('dh handshake is not complete');
  if (!state.sendChain) {
    const derived = await deriveRoot(state.root, state.local.privateKey, state.remote, state.role);
    state.root = derived.root;
    state.sendChain = derived.send;
  }
  const { messageKey, nextChain } = await chainStep(state.sendChain);
  const n = state.sendN++;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(`${aad}|${n}`) },
    await aesKey(messageKey, 'encrypt'),
    enc.encode(JSON.stringify(payload))
  );
  state.sendChain = nextChain;
  return { v: 3, dh: state.local.publicKey, n, iv: b64(iv), ct: b64(ct) };
}

async function deriveUntil(state, target) {
  while (state.recvN < target) {
    const step = await chainStep(state.recvChain);
    state.skipped.set(state.recvN, b64(step.messageKey));
    state.recvChain = step.nextChain;
    state.recvN++;
  }
}

async function decrypt(state, envelope, aad) {
  if (!state.remote) throw new Error('dh handshake is not complete');
  if (envelope.v !== 3) throw new Error('unsupported dh version');
  if (envelope.dh !== state.remote) {
    const derived = await deriveRoot(state.root, state.local.privateKey, envelope.dh, state.role);
    state.root = derived.root;
    state.remote = envelope.dh;
    state.recvChain = derived.recv;
    state.sendChain = derived.send;
    state.recvN = 0;
    state.sendN = 0;
    state.skipped.clear();
  }
  const n = Number(envelope.n);
  let messageKey;
  if (n < state.recvN) {
    messageKey = state.skipped.get(n);
    if (!messageKey) throw new Error('dh message key is not available');
    state.skipped.delete(n);
  } else {
    await deriveUntil(state, n);
    const step = await chainStep(state.recvChain);
    messageKey = b64(step.messageKey);
    state.recvChain = step.nextChain;
    state.recvN = n + 1;
  }
  const plain = await subtle.decrypt(
    { name: 'AES-GCM', iv: raw(envelope.iv), additionalData: enc.encode(`${aad}|${n}`) },
    await aesKey(raw(messageKey), 'decrypt'),
    raw(envelope.ct)
  );
  return JSON.parse(dec.decode(plain));
}

module.exports = { createState, handshake, rotate, encrypt, decrypt };