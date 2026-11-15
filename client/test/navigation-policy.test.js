'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { isTrustedLocalNavigation } = require('../navigation-policy');

const renderer = path.resolve(__dirname, '..', 'renderer', 'index.html');
const fileUrl = (file) => pathToFileURL(file).href;

test('allows only the trusted renderer document (including route fragments)', () => {
  assert.equal(isTrustedLocalNavigation(fileUrl(renderer), renderer), true);
  assert.equal(isTrustedLocalNavigation(`${fileUrl(renderer)}?mode=app#settings`, renderer), true);
});

test('rejects other local files and traversal targets', () => {
  assert.equal(isTrustedLocalNavigation(fileUrl(path.join(path.dirname(renderer), 'pip.html')), renderer), false);
  assert.equal(isTrustedLocalNavigation(fileUrl(path.resolve(renderer, '..', '..', 'preload.js')), renderer), false);
});

test('rejects remote, unsupported, and malformed navigation URLs', () => {
  assert.equal(isTrustedLocalNavigation('https://example.com/', renderer), false);
  assert.equal(isTrustedLocalNavigation('javascript:alert(1)', renderer), false);
  assert.equal(isTrustedLocalNavigation('file://%zz', renderer), false);
});
