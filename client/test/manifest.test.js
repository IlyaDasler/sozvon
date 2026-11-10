const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'manifest.webmanifest'), 'utf8'));

test('PWA-манифест устанавливается отдельным приложением', () => {
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.orientation, 'any');
});

test('у PWA есть иконки 192 и 512', () => {
  const sizes = manifest.icons.map((icon) => icon.sizes);
  assert.ok(sizes.includes('192x192'));
  assert.ok(sizes.includes('512x512'));
  for (const icon of manifest.icons) {
    const file = path.join(__dirname, '..', 'renderer', icon.src);
    assert.ok(fs.existsSync(file), `нет ${icon.src}`);
  }
});
