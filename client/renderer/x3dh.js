// X3DH-прототип: ECDH P-256 + signed prekey. Подпись bundle ставит сервер
// своим Ed25519-ключом (тот же, что у подписи обновлений).
const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const ED25519 = { name: 'Ed25519' };
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const raw = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const fromB64 = (s) => raw(s);
const concat = (...parts) => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

async function importPrivate(jwk) { return subtle.importKey('jwk', jwk, ECDH, false, ['deriveBits']); }
async function importPublic(s) { return subtle.importKey('raw', fromB64(s), ECDH, false, []); }
async function dh(privateKey, publicB64) {
  return new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: await importPublic(publicB64) }, privateKey, 256));
}
async function hkdf(ikm, info) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(info) },
    key, 256
  ));
}

function bundleMessage(bundle) {
  return enc.encode(`sozvon-x3dh-bundle-v1|${bundle.identityPublic}|${bundle.signedPrekeyPublic}|${bundle.createdAt}`);
}

async function verifyBundle(bundle, serverPublicKeyB64) {
  if (!bundle?.identityPublic || !bundle?.signedPrekeyPublic || !bundle?.createdAt || !bundle?.signature) return false;
  try {
    const key = await subtle.importKey('spki', fromB64(serverPublicKeyB64), ED25519, false, ['verify']);
    return await subtle.verify(ED25519, key, fromB64(bundle.signature), bundleMessage(bundle));
  } catch {
    return false;
  }
}

async function initiatorSecret({ identityPrivateJwk, bundle, ephemeralKeyPair }) {
  const identityPrivate = await importPrivate(identityPrivateJwk);
  const ephemeral = ephemeralKeyPair || await subtle.generateKey(ECDH, true, ['deriveBits']);
  const ephemeralPublic = b64(await subtle.exportKey('raw', ephemeral.publicKey));
  const dh1 = await dh(identityPrivate, bundle.signedPrekeyPublic);
  const dh2 = await dh(ephemeral.privateKey, bundle.identityPublic);
  const dh3 = await dh(ephemeral.privateKey, bundle.signedPrekeyPublic);
  const root = await hkdf(concat(dh1, dh2, dh3), 'sozvon-x3dh-root-v1');
  return { root: b64(root), ephemeralPublic };
}

async function responderSecret({ identityPrivateJwk, signedPrekeyPrivateJwk, initiatorIdentityPublic, initiatorEphemeralPublic }) {
  const identityPrivate = await importPrivate(identityPrivateJwk);
  const signedPrekeyPrivate = await importPrivate(signedPrekeyPrivateJwk);
  const dh1 = await dh(signedPrekeyPrivate, initiatorIdentityPublic);
  const dh2 = await dh(identityPrivate, initiatorEphemeralPublic);
  const dh3 = await dh(signedPrekeyPrivate, initiatorEphemeralPublic);
  return b64(await hkdf(concat(dh1, dh2, dh3), 'sozvon-x3dh-root-v1'));
}

module.exports = { verifyBundle, initiatorSecret, responderSecret, bundleMessage };