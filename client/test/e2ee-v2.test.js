const test = require('node:test');
const assert = require('node:assert/strict');
const { buildV2, parseV2 } = require('../renderer/e2ee-v2');

test('v2 envelope roundtrip', () => {
  const enc = buildV2({
    conv: 'dm:1-2', from: 1,
    identityPublic: 'aGVsbG8=', ephemeralPublic: 'd29ybGQ=',
    dh: 'ZGg=', n: 0, iv: 'aXY=', ct: 'Y3Q=',
  });
  assert.deepEqual(parseV2(enc), enc);
});

test('v2 rejects broken envelope', () => {
  assert.equal(parseV2({ v: 2 }), null);
  assert.throws(() => buildV2({ conv: 'dm:1-2', from: 0 }), /v2/);
});