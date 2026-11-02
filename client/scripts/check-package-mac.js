// Проверяет, что в собранное для macOS приложение попали все файлы, которые подключает main.js
// и страница. Без этого .app может собраться, но падать при запуске.
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

const apps = fs
  .readdirSync(dist, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name.startsWith('mac'))
  .map((d) => ({ dir: d.name, app: path.join(dist, d.name, 'Sozvon.app') }))
  .filter((a) => fs.existsSync(a.app));

if (!apps.length) {
  console.error('✖ В dist нет собранного Sozvon.app');
  process.exit(1);
}

for (const { dir, app } of apps) {
  const resources = path.join(app, 'Contents', 'Resources');
  const archive = path.join(resources, 'app.asar');
  const packed = new Set(asar.listPackage(archive).map((f) => f.replace(/\\/g, '/').replace(/^\//, '')));

  const required = new Set(['main.js', 'package.json']);
  for (const file of ['main.js', 'preload.js', ...fs.readdirSync(root).filter((f) => f.endsWith('.js'))]) {
    required.add(file);
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const [, dep] of source.matchAll(/require\(['"](\.\/[^'"]+)['"]\)/g)) {
      const isDir = fs.existsSync(path.join(root, dep)) && fs.statSync(path.join(root, dep)).isDirectory();
      required.add(path.posix.normalize(isDir ? `${dep}/index.js` : dep.endsWith('.js') ? dep : `${dep}.js`));
    }
    // path.join(__dirname, 'renderer', 'index.html') — берём путь целиком, а не последний кусок
    for (const [, args] of source.matchAll(/path\.join\(__dirname, ((?:'[^']+'(?:, )?)+)\)/g))
      required.add(args.split(', ').map((a) => a.slice(1, -1)).join('/'));
  }

  const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
  for (const [, ref] of html.matchAll(/(?:src|href)="([^":#]+)"/g)) required.add(`renderer/${ref}`);

  const missing = [...required].filter((f) => !packed.has(f));
  if (missing.length) {
    console.error(`✖ ${dir}: в app.asar нет файлов: ${missing.join(', ')}`);
    process.exit(1);
  }

  // Без него приложение не знает, откуда брать обновления (проверка версий, даже ручная)
  if (!fs.existsSync(path.join(resources, 'app-update.yml'))) {
    console.error(`✖ ${dir}: нет app-update.yml`);
    process.exit(1);
  }

  // Рация: нативный модуль должен быть распакован рядом с app.asar, иначе голос по клавише не работает
  const unpacked = path.join(resources, 'app.asar.unpacked', 'node_modules', 'uiohook-napi', 'prebuilds');
  const arch = dir.includes('arm64') ? 'darwin-arm64' : 'darwin-x64';
  if (!fs.existsSync(path.join(unpacked, arch, 'uiohook-napi.node'))) {
    console.error(`✖ ${dir}: нет uiohook-napi для ${arch} — рация работать не будет`);
    process.exit(1);
  }

  console.log(`✔ ${dir}: файлы на месте (${required.size}), рация для ${arch} распакована`);
}
