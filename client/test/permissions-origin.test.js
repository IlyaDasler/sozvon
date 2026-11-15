const test = require('node:test');
const assert = require('node:assert/strict');
const { applyPermissions, isTrustedAppUrl, isTrustedRequester, isTrustedRequest } = require('../permissions');

test('only packaged Sozvon renderer pages are trusted permission requesters', () => {
  assert.equal(isTrustedAppUrl('file:///C:/Program%20Files/Sozvon/renderer/index.html'), true);
  assert.equal(isTrustedAppUrl('file:///C:/Program%20Files/Sozvon/renderer/pip.html'), true);
  assert.equal(isTrustedAppUrl('https://attacker.example/renderer/index.html'), false);
  assert.equal(isTrustedAppUrl('file:///tmp/attacker.html'), false);
  assert.equal(isTrustedAppUrl('javascript:alert(1)'), false);
  assert.equal(isTrustedRequester('file://'), true);
  assert.equal(isTrustedRequester(undefined), false);
  assert.equal(isTrustedRequester('https://attacker.example'), false);
  const trusted = { getURL: () => 'file:///app/renderer/index.html' };
  assert.equal(isTrustedRequest(trusted, 'file:///app/renderer/index.html', true), true);
  assert.equal(isTrustedRequest(trusted, 'https://attacker.example/', true), false);
  assert.equal(isTrustedRequest(trusted, 'file:///app/renderer/index.html', false), false);
  assert.equal(isTrustedRequest(trusted, 'file:///app/renderer/index.html'), false);
  assert.equal(isTrustedRequest({ getURL: () => 'https://attacker.example/' }, undefined, true), false);
});

test('Electron permission callbacks deny untrusted origins and unknown capabilities', () => {
  let requestHandler;
  let checkHandler;
  applyPermissions({
    setPermissionRequestHandler: (fn) => { requestHandler = fn; },
    setPermissionCheckHandler: (fn) => { checkHandler = fn; },
  });
  const trusted = { getURL: () => 'file:///app/renderer/index.html' };
  const untrusted = { getURL: () => 'https://attacker.example/' };
  let granted;
  requestHandler(trusted, 'media', (value) => { granted = value; }, { requestingUrl: 'file:///app/renderer/index.html', isMainFrame: true });
  assert.equal(granted, true);
  requestHandler(trusted, 'media', (value) => { granted = value; }, { requestingUrl: 'https://attacker.example/', isMainFrame: true });
  assert.equal(granted, false);
  requestHandler(trusted, 'media', (value) => { granted = value; }, { requestingUrl: 'file:///app/renderer/index.html', isMainFrame: false });
  assert.equal(granted, false);
  requestHandler(trusted, 'media', (value) => { granted = value; }, { isMainFrame: true });
  assert.equal(granted, false);
  requestHandler(untrusted, 'media', (value) => { granted = value; }, {});
  assert.equal(granted, false);
  assert.equal(checkHandler(trusted, 'notifications', 'file:///app/renderer/index.html', { isMainFrame: true }), true);
  assert.equal(checkHandler(trusted, 'media', 'file://', { isMainFrame: true }), true);
  assert.equal(checkHandler(trusted, 'media', 'file://', { isMainFrame: false }), false);
  assert.equal(checkHandler(trusted, 'media', 'https://attacker.example', { isMainFrame: true }), false);
  assert.equal(checkHandler(trusted, 'geolocation', 'file:///app/renderer/index.html', { isMainFrame: true }), false);
});
