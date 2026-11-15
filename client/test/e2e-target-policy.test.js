'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertE2EServerAllowed } = require('../scripts/e2e-target-policy');

test('E2E server policy permits loopback HTTP(S) targets', () => {
  assert.equal(assertE2EServerAllowed('http://127.0.0.1:3000/path'), 'http://127.0.0.1:3000');
  assert.equal(assertE2EServerAllowed('https://localhost:8443'), 'https://localhost:8443');
  assert.equal(assertE2EServerAllowed('http://[::1]:3000'), 'http://[::1]:3000');
});

test('E2E server policy rejects remote and malformed targets by default', () => {
  assert.throws(() => assertE2EServerAllowed('https://api.example.com'), /remote server/);
  assert.throws(() => assertE2EServerAllowed('file:///tmp/api'), /HTTP or HTTPS/);
  assert.throws(() => assertE2EServerAllowed('http://['), /valid HTTP\(S\) URL/);
  assert.throws(() => assertE2EServerAllowed('ftp://localhost'), /HTTP or HTTPS/);
});

test('E2E server policy allows a remote target only after explicit opt-in', () => {
  assert.equal(assertE2EServerAllowed('https://staging.example.com/api', true), 'https://staging.example.com');
});
