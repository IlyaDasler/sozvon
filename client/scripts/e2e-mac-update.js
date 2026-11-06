'use strict';
// Реальный e2e автообновления macOS: скачиваем предыдущий релиз, ставим его
// во временную папку, затем текущим updater'ом (локальный фид) заменяем .app
// и проверяем CFBundleShortVersionString. Запускается только на macOS после dist:mac.
process.env.SOZVON_UPDATE_TEST = '1';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
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

const REPO = 'IlyaDasler/sozvon';
const API = `https://api.github.com/repos/${REPO}/releases?per_page=10`;
const GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';

function getJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'User-Agent': 'Sozvon-E2E',
            Accept: 'application/vnd.github+json',
            ...(GH_TOKEN && { Authorization: `Bearer ${GH_TOKEN}` }),
          },
        },
        (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`GitHub API ${res.statusCode}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

function downloadFile(url, dest, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 6) return reject(new Error('слишком много редиректов'));
    https
      .get(url, { headers: { 'User-Agent': 'Sozvon-E2E' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          downloadFile(res.headers.location, dest, hops + 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`скачивание ${res.statusCode}`));
          return;
        }
        const out = fs.createWriteStream(dest);
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve(dest)));
        out.on('error', reject);
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

function plistVersion(app) {
  const text = fs.readFileSync(path.join(app, 'Contents', 'Info.plist'), 'utf8');
  return /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(text)?.[1] || '';
}

(async () => {
  // Предыдущий опубликованный релиз, а не фикстура: список нужен и после
  // того, как текущая версия станет latest.
  const releases = await getJson(API);
  const previous = releases.find((r) => String(r.tag_name || '').replace(/^v/, '') !== version);
  assert.ok(previous, 'не найден предыдущий релиз');
  const previousVersion = String(previous.tag_name).replace(/^v/, '');
  const previousName = mac.assetName(previousVersion, arch);
  const previousAsset = (previous.assets || []).find((a) => a.name === previousName);
  assert.ok(previousAsset?.browser_download_url, `в ${previousVersion} нет ${previousName}`);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sozvon-mac-e2e-'));
  const previousZip = path.join(root, previousName);
  console.log(`предыдущая версия: ${previousVersion}`);
  await downloadFile(previousAsset.browser_download_url, previousZip);

  const previousDir = path.join(root, 'previous');
  const unpack = spawnSync('ditto', ['-x', '-k', previousZip, previousDir], { encoding: 'utf8' });
  assert.equal(unpack.status, 0, `не распаковали предыдущий релиз: ${unpack.stderr}`);
  const oldApp = fs.readdirSync(previousDir).map((n) => path.join(previousDir, n)).find((p) => p.endsWith('.app'));
  assert.ok(oldApp, 'в предыдущем релизе нет .app');
  assert.equal(plistVersion(oldApp), previousVersion, `старая версия ${plistVersion(oldApp)}, ждали ${previousVersion}`);

  // Локальный фид отдаёт собранный текущий архив. prepare проверяет sha512.
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

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const newApp = await mac.prepare({
      version,
      base,
      onProgress: (p) => process.stdout.write(`\rскачано ${p}%`),
    });
    console.log('\nраспаковано:', newApp);
    assert.equal(plistVersion(newApp), version, `в новом архиве ${plistVersion(newApp)}, ждали ${version}`);

    // apply ждёт выхода своего pid. Вызываем в дочернем процессе и проверяем,
    // что настоящий .app предыдущего релиза заменён новой версией.
    const driver = path.join(root, 'driver.js');
    fs.writeFileSync(
      driver,
      `const mac = require(${JSON.stringify(path.join(client, 'mac-update.js'))});\n` +
        `mac.apply({ newApp: process.argv[2], app: process.argv[3], onQuit: () => {} });\n`
    );
    const applied = spawnSync(process.execPath, [driver, newApp, oldApp], {
      env: { ...process.env, SOZVON_UPDATE_TEST: '1' },
      encoding: 'utf8',
    });
    assert.equal(applied.status, 0, `apply упал: ${applied.stderr || applied.stdout}`);

    let installed = '';
    for (let i = 0; i < 60; i++) {
      try {
        installed = plistVersion(oldApp);
      } catch {}
      if (installed === version) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.equal(installed, version, `после swap версия ${installed || 'нет'}, ждали ${version}`);
    console.log(`✔ macOS updater e2e: ${previousVersion} → ${version}, swap и проверка версии`);
  } finally {
    server.close();
  }
})().catch((err) => {
  console.error(`✖ macOS updater e2e: ${err.message}`);
  process.exitCode = 1;
});
