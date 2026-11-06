'use strict';
// Контракт автообновления macOS. Эти тесты обязаны проходить до любого релиза.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mac = require('../mac-update');

test('инвариант автообновления macOS включён', () => {
  assert.equal(mac.MAC_UPDATE_INVARIANT.mustWork, true);
  assert.ok(mac.MAC_UPDATE_INVARIANT.covers.includes('permissions'));
  assert.ok(mac.MAC_UPDATE_INVARIANT.covers.includes('ui-recovery'));
});

test('архив выбирается по архитектуре', () => {
  assert.equal(mac.assetName('3.3.5', 'arm64'), 'Sozvon-3.3.5-arm64.zip');
  assert.equal(mac.assetName('3.3.5', 'x64'), 'Sozvon-3.3.5-x64.zip');
});

test('manifestEntry читает size и sha512 только своей архитектуры', () => {
  const yaml = [
    'version: 3.3.5',
    'files:',
    '  - url: Sozvon-3.3.5-x64.zip',
    '    sha512: AAA',
    '    size: 111',
    '  - url: Sozvon-3.3.5-arm64.zip',
    '    sha512: BBB',
    '    size: 222',
  ].join('\n');
  assert.deepEqual(mac.manifestEntry(yaml, 'Sozvon-3.3.5-arm64.zip'), { size: 222, sha512: 'BBB' });
  assert.deepEqual(mac.manifestEntry(yaml, 'Sozvon-3.3.5-x64.zip'), { size: 111, sha512: 'AAA' });
  assert.equal(mac.manifestEntry(yaml, 'Sozvon-3.3.4-arm64.zip'), null);
});

test('bundlePath находит .app из Contents/MacOS', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sozvon-bundle-'));
  const bundle = path.join(root, 'Sozvon.app');
  const macos = path.join(bundle, 'Contents', 'MacOS');
  fs.mkdirSync(macos, { recursive: true });
  assert.equal(mac.bundlePath(path.join(macos, 'Sozvon')), bundle);
  fs.rmSync(root, { recursive: true, force: true });
});

test('swap-скрипт ждёт выхода, умеет root-запуск и возвращает приложение пользователю', () => {
  const script = mac.swapScript({ pid: 123, appDir: '/Applications/Sozvon.app', newApp: '/tmp/new/Sozvon.app', log: '/tmp/swap.log' });
  assert.match(script, /kill -0 "\$PID"/);
  assert.match(script, /launchctl asuser/);
  assert.match(script, /rm -rf "\$OLD"/);
  assert.match(script, /PID=123/);
});
