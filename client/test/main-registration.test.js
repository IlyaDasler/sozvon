const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('main process registers the E2EE identity service', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(source, /require\(['"]\.\/identity-vault['"]\)/);
  assert.match(source, /registerIdentityVault\(\);/);
});
