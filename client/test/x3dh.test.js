const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyBundle, initiatorSecret, responderSecret, bundleMessage } = require('../renderer/x3dh');
const subtle = crypto.subtle;
const enc = new TextEncoder();
const b64 = (b) => Buffer.from(b).toString('base64');

async function ecdhPair() {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return {
    privateJwk: await subtle.exportKey('jwk', pair.privateKey),
    public: b64(await subtle.exportKey('raw', pair.publicKey)),
    privateKey: pair.privateKey,
  };
}

test('x3dh initiator and responder derive same secret', async () => {
  const alice = await ecdhPair();
  const bob = await ecdhPair();
  const spk = await ecdhPair();
  const server = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const serverPub = b64(await subtle.exportKey('spki', server.publicKey));
  const bundle = {
    identityPublic: bob.public,
    signedPrekeyPublic: spk.public,
    createdAt: 1,
  };
  bundle.signature = b64(await subtle.sign({ name: 'Ed25519' }, server.privateKey, bundleMessage(bundle)));
  assert.equal(await verifyBundle(bundle, serverPub), true);
  const init = await initiatorSecret({ identityPrivateJwk: alice.privateJwk, bundle });
  const resp = await responderSecret({
    identityPrivateJwk: bob.privateJwk,
    signedPrekeyPrivateJwk: spk.privateJwk,
    initiatorIdentityPublic: alice.public,
    initiatorEphemeralPublic: init.ephemeralPublic,
  });
  assert.equal(init.root, resp);
});

test('x3dh rejects tampered bundle', async () => {
  const bob = await ecdhPair();
  const spk = await ecdhPair();
  const server = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const serverPub = b64(await subtle.exportKey('spki', server.publicKey));
  const bundle = { identityPublic: bob.public, signedPrekeyPublic: spk.public, createdAt: 1 };
  bundle.signature = b64(await subtle.sign({ name: 'Ed25519' }, server.privateKey, bundleMessage(bundle)));
  const tampered = { ...bundle, signedPrekeyPublic: (await ecdhPair()).public };
  assert.equal(await verifyBundle(tampered, serverPub), false);
});