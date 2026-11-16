'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isTrustedIpcEvent, trustedIpcMain } = require('../ipc-policy');

const entry = 'C:/app/renderer/index.html';

test('IPC policy accepts only the expected main frame and renderer file', () => {
  const frame = { url: 'file:///C:/app/renderer/index.html' };
  const contents = { isDestroyed: () => false, get mainFrame() { return frame; } };
  assert.equal(isTrustedIpcEvent({ sender: contents, senderFrame: frame }, contents, entry), true);
  assert.equal(isTrustedIpcEvent({ sender: {}, senderFrame: frame }, contents, entry), false);
  assert.equal(isTrustedIpcEvent({ sender: contents, senderFrame: { url: frame.url } }, contents, entry), false);
  assert.equal(isTrustedIpcEvent({ sender: contents, senderFrame: { url: 'https://evil.test/' } }, contents, entry), false);
});

test('trusted IPC facade ignores untrusted events and rejects untrusted invoke calls', async () => {
  const handlers = new Map();
  const ipc = {
    on: (channel, fn) => handlers.set(`on:${channel}`, fn),
    handle: (channel, fn) => handlers.set(`handle:${channel}`, fn),
  };
  const trusted = trustedIpcMain(ipc, (event) => event?.trusted === true);
  let called = false;
  trusted.on('fire', () => { called = true; });
  trusted.handle('invoke', () => 'ok');
  handlers.get('on:fire')({ trusted: false });
  assert.equal(called, false);
  assert.equal(handlers.get('handle:invoke')({ trusted: true }), 'ok');
  assert.throws(() => handlers.get('handle:invoke')({ trusted: false }), /Untrusted IPC sender/);
});
