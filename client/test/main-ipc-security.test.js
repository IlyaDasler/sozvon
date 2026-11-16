'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('all privileged main IPC is routed through the trusted renderer gate', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const direct = [...main.matchAll(/ipcMain\.(?:handle|on)\(['"]([^'"]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(direct, ['pip:close', 'pip:frame', 'pip:open']);
  assert.match(main, /ipcMain\.handle\('pip:open',[\s\S]*?if \(!isTrustedMainIpc\(event\)\)/);
  assert.match(main, /ipcMain\.on\('pip:frame',[\s\S]*?if \(!isTrustedMainIpc\(event\)\) return/);
  assert.match(main, /ipcMain\.on\('pip:close',[\s\S]*?isTrustedIpcEvent\(event, pipWin\?\.webContents, pipEntry\)/);
  for (const module of ['screen-native.js', 'vault.js', 'clipboard-image.js', 'identity-vault.js', 'device-key.js']) {
    const source = fs.readFileSync(path.join(root, module), 'utf8');
    assert.match(source, /function register\w+\([^)]*ipc = ipcMain\)/, module);
  }
});
