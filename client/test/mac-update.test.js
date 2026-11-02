// Обновление macOS своими руками: выбор ассета, путь к бандлу и скрипт подмены
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bundlePath, assetName, pickAsset, manifestEntry, swapScript } = require('../mac-update');

test('имя архива зависит от архитектуры', () => {
  assert.equal(assetName('2.9.0', 'arm64'), 'Sozvon-2.9.0-arm64.zip');
  assert.equal(assetName('2.9.0', 'x64'), 'Sozvon-2.9.0-x64.zip');
  assert.equal(assetName('2.9.0', 'ia32'), 'Sozvon-2.9.0-x64.zip');
});

test('из релиза берём архив под нашу архитектуру и только с github releases', () => {
  const release = {
    tag_name: 'v2.9.0',
    assets: [
      { name: 'Sozvon-2.9.0-arm64.dmg', browser_download_url: 'https://github.com/IlyaDasler/sozvon/releases/download/v2.9.0/Sozvon-2.9.0-arm64.dmg', size: 1 },
      { name: 'Sozvon-2.9.0-arm64.zip', browser_download_url: 'https://github.com/IlyaDasler/sozvon/releases/download/v2.9.0/Sozvon-2.9.0-arm64.zip', size: 100 },
      { name: 'Sozvon-2.9.0-x64.zip', browser_download_url: 'https://github.com/IlyaDasler/sozvon/releases/download/v2.9.0/Sozvon-2.9.0-x64.zip', size: 200 },
    ],
  };
  const arm = pickAsset(release, 'arm64');
  assert.equal(arm.version, '2.9.0');
  assert.equal(arm.name, 'Sozvon-2.9.0-arm64.zip');
  assert.equal(arm.size, 100);
  assert.equal(pickAsset(release, 'x64').size, 200);

  // Чужая ссылка (не GitHub Releases) не годится
  const bad = { tag_name: 'v2.9.0', assets: [{ name: 'Sozvon-2.9.0-arm64.zip', browser_download_url: 'https://evil.example/x.zip' }] };
  assert.equal(pickAsset(bad, 'arm64'), null);
  assert.equal(pickAsset({ assets: [] }, 'arm64'), null);
});

test('путь к бандлу находим из пути к исполняемому файлу', () => {
  assert.equal(bundlePath('/Applications/Sozvon.app/Contents/MacOS/Sozvon'), '/Applications/Sozvon.app');
  assert.equal(bundlePath('/Users/a/Desktop/Sozvon.app/Contents/MacOS/Sozvon'), '/Users/a/Desktop/Sozvon.app');
  assert.equal(bundlePath('/usr/local/bin/node'), null);
});

test('скрипт подмены ждёт процесс, держит старую копию и запускает новую', () => {
  const script = swapScript({ pid: 4242, appDir: '/Applications/Sozvon.app', newApp: '/tmp/sozvon-update/app/Sozvon.app' });
  assert.match(script, /PID=4242/);
  assert.match(script, /while kill -0 "\$PID"/);
  assert.match(script, /xattr -dr com\.apple\.quarantine/);
  assert.match(script, /mv "\$APP" "\$OLD"/);
  assert.match(script, /mv "\$NEW" "\$APP"/);
  assert.match(script, /open "\$APP"/);
  // Кавычки экранируются: путь с апострофом не должен ломать скрипт
  const weird = swapScript({ pid: 1, appDir: "/Applications/Bob's app.app", newApp: '/tmp/x.app' });
  assert.match(weird, /'\/Applications\/Bob'\\''s app\.app'/);
});
test('из latest-mac.yml берём размер и sha512 нужного архива', () => {
  const yml = [
    'version: 2.9.3',
    'files:',
    '  - url: Sozvon-2.9.3-x64.zip',
    '    sha512: AAAAx64',
    '    size: 111',
    '  - url: Sozvon-2.9.3-arm64.zip',
    '    sha512: BBBBarm',
    '    size: 222',
    '  - url: Sozvon-2.9.3-arm64.dmg',
    '    sha512: CCCCdmg',
    '    size: 333',
    'path: Sozvon-2.9.3-arm64.zip',
    "sha512: BBBBarm",
    'releaseDate: "2026-11-02T10:36:23.552Z"',
  ].join('\n');
  assert.deepEqual(manifestEntry(yml, 'Sozvon-2.9.3-arm64.zip'), { size: 222, sha512: 'BBBBarm' });
  assert.deepEqual(manifestEntry(yml, 'Sozvon-2.9.3-x64.zip'), { size: 111, sha512: 'AAAAx64' });
  // Файла нет в манифесте — проверять нечем, обновление ставить нельзя
  assert.equal(manifestEntry(yml, 'Sozvon-2.9.3-arm64.dmg2'), null);
  assert.equal(manifestEntry('version: 1.0.0\nfiles:\n', 'Sozvon-9.9.9-arm64.zip'), null);
});