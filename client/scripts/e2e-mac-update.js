// Реальный e2e автообновления macOS: не имитация apply(), а
// локальный фид → prepare (скачать/сверить/распаковать) → swap настоящего .app.
// Запускается только на macOS после npm run dist:mac.
process.env.SOZVON_UPDATE_TEST = '1';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const mac = require('../mac-update');

if (process.platform !== 'darwin') {
  console.log('SKIP: macOS-only e2e');
  process.exit(0);
}

const client = path.resolve(__dirname, '..');
const dist = path.join(client, 'dist');
const version = require('../package.json').version;
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const zipName = mac.assetName(version, arch);
const zipPath = path.join(dist, zipName);
const manifestPath = path.join(dist, 'latest-mac.yml');
assert.ok(fs.existsSync(zipPath), `нет ${zipPath}: сначала npm run dist:mac`);
assert.ok(fs.existsSync(manifestPath), `нет ${manifestPath}`);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sozvon-mac-e2e-'));
const oldApp = path.join(root, 'Sozvon.app');
const oldMacOS = path.join(oldApp, 'Contents', 'MacOS');
fs.mkdirSync(oldMacOS, { recursive: true });
fs.writeFileSync(
  path.join(oldApp, 'Contents', 'Info.plist'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>0.0.1</string></dict></plist>\n`
);
fs.writeFileSync(path.join(oldMacOS, 'Sozvon'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '').replace(/^\/updates\/mac\/?/, ''));
  const file = rel === 'latest-mac.yml' ? manifestPath : path.join(dist, path.basename(rel));
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-length': fs.statSync(file).size });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const newApp = await mac.prepare({
      version,
      base,
      onProgress: (p) => process.stdout.write(`\rскачано ${p}%`)
    });
    console.log('\nраспаковано:', newApp);
    assert.ok(fs.existsSync(path.join(newApp, 'Contents', 'Info.plist')), 'в архиве нет Info.plist');

    // apply() ждёт выхода своего pid. Вызываем его в дочернем процессе,
    // а родитель проверяет, что swap действительно заменил .app.
    const driver = path.join(root, 'driver.js');
    fs.writeFileSync(
      driver,
      `const mac = require(${JSON.stringify(path.join(client, 'mac-update.js'))});\n` +
        `mac.apply({ newApp: process.argv[2], app: process.argv[3], onQuit: () => {} });\n`
    );
    const applied = spawnSync(process.execPath, [driver, newApp, oldApp], {
      env: { ...process.env, SOZVON_UPDATE_TEST: '1' },
      encoding: 'utf8'
    });
    assert.equal(applied.status, 0, `apply упал: ${applied.stderr || applied.stdout}`);

    let installed = '';
    for (let i = 0; i < 60; i++) {
      try {
        const plist = fs.readFileSync(path.join(oldApp, 'Contents', 'Info.plist'), 'utf8');
        const m = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist);
        installed = m?.[1] || '';
      } catch {}
      if (installed === version) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.equal(installed, version, `после swap версия ${installed || 'нет'}, ждали ${version}`);
    assert.ok(
      fs.existsSync(path.join(oldApp, 'Contents', 'MacOS', 'Sozvon')) ||
        fs.existsSync(path.join(oldApp, 'Contents', 'MacOS')),
      'нет установленного приложения'
    );
    console.log('✔ macOS updater e2e: скачивание, sha512, распаковка, swap и новая версия .app');
  } finally {
    server.close();
  }
})().catch((err) => {
  console.error(`✖ macOS updater e2e: ${err.message}`);
  process.exitCode = 1;
});
