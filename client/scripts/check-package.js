// Проверяет, что в собранное приложение попали все файлы, которые подключает main.js и страница.
// Без этого установщик может собраться, но падать при запуске.
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

const root = path.join(__dirname, '..');
const archive = path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar');
const packed = new Set(asar.listPackage(archive).map((f) => f.replace(/\\/g, '/').replace(/^\//, '')));

const required = new Set(['main.js', 'package.json']);
// Все локальные require из файлов главного процесса
for (const file of ['main.js', 'preload.js', ...fs.readdirSync(root).filter((f) => f.endsWith('.js'))]) {
  required.add(file);
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  for (const [, dep] of source.matchAll(/require\(['"](\.\/[^'"]+)['"]\)/g)) {
    // require('./native/capture') — папка: берём её index.js
    const dir = fs.existsSync(path.join(root, dep)) && fs.statSync(path.join(root, dep)).isDirectory();
    required.add(path.posix.normalize(dir ? `${dep}/index.js` : dep.endsWith('.js') ? dep : `${dep}.js`));
  }
  // Файлы рядом с приложением: path.join(__dirname, 'assets', 'tray.png') и т. п. — значок трея, страница, preload
  for (const [, args] of source.matchAll(/path\.join\(__dirname, ((?:'[^']+'(?:, )?)+)\)/g))
    required.add(args.split(', ').map((a) => a.slice(1, -1)).join('/'));
}
// Всё, что подключает страница
const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
for (const [, ref] of html.matchAll(/(?:src|href)="([^":#]+)"/g)) required.add(`renderer/${ref}`);

// Зависимости, нужные во время работы (например, electron-updater)
const { dependencies = {} } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const dep of Object.keys(dependencies)) required.add(`node_modules/${dep}/package.json`);
// Без этого файла приложение не знает, откуда брать обновления
if (!fs.existsSync(path.join(root, 'dist', 'win-unpacked', 'resources', 'app-update.yml'))) {
  console.error('✖ В сборке нет app-update.yml — автообновление работать не будет');
  process.exit(1);
}

// Нативные модули (рация) работают только распакованными рядом с app.asar
const unpacked = path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar.unpacked');
if (dependencies['uiohook-napi'] && !fs.existsSync(path.join(unpacked, 'node_modules', 'uiohook-napi', 'prebuilds', 'win32-x64', 'uiohook-napi.node'))) {
  console.error('✖ В сборке нет распакованного uiohook-napi.node — рация работать не будет');
  process.exit(1);
}

// Свой захват экрана — нативный модуль, тоже только распакованным; без него трансляция идёт через Chromium (~50 к/с)
if (!fs.existsSync(path.join(unpacked, 'native', 'capture', 'build', 'Release', 'sozvon_capture.node'))) {
  console.error('✖ В сборке нет распакованного sozvon_capture.node — трансляция не будет держать 60 к/с');
  process.exit(1);
}

const missing = [...required].filter((f) => !packed.has(f));
if (missing.length) {
  console.error(`✖ В установщик не попали файлы: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`✔ В установщике все нужные файлы (${required.size})`);
