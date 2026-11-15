const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeServerUrl } = require('../renderer/server-url');

test('remote server addresses must use HTTPS', () => {
  assert.equal(normalizeServerUrl('chat.example.com'), 'https://chat.example.com');
  assert.equal(normalizeServerUrl('https://chat.example.com/'), 'https://chat.example.com');
  for (const url of ['http://chat.example.com', 'http://203.0.113.10:3000']) {
    assert.throws(() => normalizeServerUrl(url), /HTTPS/);
  }
});

test('plain HTTP is limited to explicit loopback development targets', () => {
  for (const url of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://127.2.3.4:3000', 'http://[::1]:3000']) {
    assert.equal(normalizeServerUrl(url), new URL(url).origin);
  }
  assert.throws(() => normalizeServerUrl('http://localhost:3000', { allowLoopbackHttp: false }), /HTTPS/);
  assert.throws(() => normalizeServerUrl('http://192.168.1.20:3000'), /HTTPS/);
});

test('server URLs reject credentials, paths, query strings and unsupported protocols', () => {
  for (const url of [
    'https://user:pass@example.com',
    'https://example.com/api',
    'https://example.com?token=secret',
    'ftp://example.com',
  ]) {
    assert.throws(() => normalizeServerUrl(url));
  }
});
