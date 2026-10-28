// Код шифрования звонка: одинаков у всех, кто видит один и тот же набор ключей, и меняется при подмене любого
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { securityCode, fingerprintOf, CODE_EMOJI } = require('../renderer/call-code');

const A = 'AA:11:22:33';
const B = 'BB:44:55:66';
const C = 'CC:77:88:99';

test('порядок ключей не важен — у каждого участника тот же код', async () => {
  const one = await securityCode([A, B, C]);
  const two = await securityCode([C, A, B]);
  assert.deepEqual(one, two);
  assert.equal(one.emoji.length, 4);
  assert.match(one.digits, /^\d{4} \d{4}$/);
  for (const e of one.emoji) assert.ok(CODE_EMOJI.includes(e));
});

test('подменили один ключ — код другой', async () => {
  const real = await securityCode([A, B]);
  const forged = await securityCode([A, 'BB:44:55:67']);
  assert.notEqual(real.digits, forged.digits);
});

test('меньше двух ключей — кода нет; регистр и повторы не важны', async () => {
  assert.equal(await securityCode([A]), null);
  assert.equal(await securityCode([]), null);
  assert.deepEqual(await securityCode([A.toLowerCase(), B, B]), await securityCode([A, B]));
});

test('отпечаток берётся из SDP', () => {
  const sdp = 'v=0\r\na=group:BUNDLE 0\r\na=fingerprint:sha-256 AB:CD:EF\r\nm=audio 9\r\n';
  assert.equal(fingerprintOf(sdp), 'AB:CD:EF');
  assert.equal(fingerprintOf('v=0\r\n'), null);
});
