// Подпись меняет установщик: latest.yml должен описывать подписанный файл, иначе автообновление отбросит его как испорченный
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { useSignedInstaller, withInstaller } = require('../scripts/use-signed-installer');

const LATEST = `version: 2.6.1
files:
  - url: Sozvon-Setup-2.6.1.exe
    sha512: старый==
    size: 100
    blockMapSize: 5
path: Sozvon-Setup-2.6.1.exe
sha512: старый==
releaseDate: '2026-10-31T10:00:00.000Z'
`;

test('latest.yml описывает новый файл: хеш и размер, без карты старого', () => {
  const next = withInstaller(LATEST, { sha512: 'новый+/==', size: 250 });
  assert.equal(next, `version: 2.6.1
files:
  - url: Sozvon-Setup-2.6.1.exe
    sha512: новый+/==
    size: 250
path: Sozvon-Setup-2.6.1.exe
sha512: новый+/==
releaseDate: '2026-10-31T10:00:00.000Z'
`);
});

test('файл другого вида не правим молча', () => {
  assert.throws(() => withInstaller('version: 2.6.1\n', { sha512: 'x', size: 1 }), /latest\.yml/);
});

test('подписанный установщик заменяет обычный, хеш совпадает с файлом, старой карты нет', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sozvon-sign-'));
  const dist = path.join(root, 'dist');
  const signed = path.join(root, 'signed');
  fs.mkdirSync(dist);
  fs.mkdirSync(signed);
  fs.writeFileSync(path.join(dist, 'latest.yml'), LATEST);
  fs.writeFileSync(path.join(dist, 'Sozvon-Setup-2.6.1.exe'), 'без подписи');
  fs.writeFileSync(path.join(dist, 'Sozvon-Setup-2.6.1.exe.blockmap'), 'карта');
  fs.writeFileSync(path.join(signed, 'Sozvon-Setup-2.6.1.exe'), 'с подписью');

  useSignedInstaller(dist, signed);

  const file = fs.readFileSync(path.join(dist, 'Sozvon-Setup-2.6.1.exe'));
  assert.equal(file.toString(), 'с подписью');
  assert.equal(fs.existsSync(path.join(dist, 'Sozvon-Setup-2.6.1.exe.blockmap')), false);
  const latest = fs.readFileSync(path.join(dist, 'latest.yml'), 'utf8');
  assert.match(latest, new RegExp(`size: ${file.length}\\n`));
  assert.ok(latest.includes(`sha512: ${crypto.createHash('sha512').update(file).digest('base64')}\n`));
});

test('подписанного файла нет — сборка падает, а не выпускает неподписанное', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sozvon-sign-'));
  fs.writeFileSync(path.join(root, 'latest.yml'), LATEST);
  assert.throws(() => useSignedInstaller(root, path.join(root, 'нет')), /подписанн/i);
});
