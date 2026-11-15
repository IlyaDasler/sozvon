// Прототип symmetric ratchet для 3.9. Не подключён к переписке:
// сначала нужны тесты и миграция формата, затем DH-ratchet и X3DH.
const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = globalThis.crypto.subtle;

const raw = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const hkdf = async (ikm, info, length = 32) => {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(info) },
    key,
    length * 8
  ));
};

async function chainStep(chainB64) {
  const chain = raw(chainB64);
  const messageKey = await hkdf(chain, 'sozvon-ratchet-message-v1');
  const nextChain = await hkdf(chain, 'sozvon-ratchet-chain-v1');
  return { messageKey, nextChain: b64(nextChain) };
}

async function aesKey(bytes, usage) {
  return subtle.importKey('raw', bytes, 'AES-GCM', false, [usage]);
}

function createState(rootB64, role) {
  // role: 'a' или 'b'; направления зеркальны.
  return {
    root: rootB64,
    role,
    sendChain: null,
    recvChain: null,
    sendN: 0,
    recvN: 0,
    skipped: new Map(),
  };
}

async function initState(rootB64, role) {
  const state = createState(rootB64, role);
  const root = raw(rootB64);
  const sendLabel = role === 'a' ? 'sozvon-ratchet-a-to-b' : 'sozvon-ratchet-b-to-a';
  const recvLabel = role === 'a' ? 'sozvon-ratchet-b-to-a' : 'sozvon-ratchet-a-to-b';
  state.sendChain = b64(await hkdf(root, sendLabel));
  state.recvChain = b64(await hkdf(root, recvLabel));
  return state;
}

async function encrypt(state, payload, aad) {
  if (!state.sendChain) throw new Error('ratchet is not initialized');
  const { messageKey, nextChain } = await chainStep(state.sendChain);
  const n = state.sendN++;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(`${aad}|${n}`) },
    await aesKey(messageKey, 'encrypt'),
    enc.encode(JSON.stringify(payload))
  );
  state.sendChain = nextChain;
  return { v: 2, n, iv: b64(iv), ct: b64(ct) };
}

async function deriveUntil(state, target) {
  while (state.recvN < target) {
    const { messageKey, nextChain } = await chainStep(state.recvChain);
    state.skipped.set(state.recvN, b64(messageKey));
    state.recvChain = nextChain;
    state.recvN++;
  }
}

async function decrypt(state, envelope, aad) {
  if (!state.recvChain) throw new Error('ratchet is not initialized');
  if (envelope.v !== 2) throw new Error('unsupported ratchet version');
  const n = Number(envelope.n);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('bad ratchet counter');
  let messageKey;
  if (n < state.recvN) {
    messageKey = state.skipped.get(n);
    if (!messageKey) throw new Error('ratchet key is not available');
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

module.exports = { initState, encrypt, decrypt };