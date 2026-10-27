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
  for (const [, dep] of source.matchAll(/require\(['"](\.\/[^'"]+)['"]\)/g)) required.add(path.posix.normalize(dep.endsWith('.js') ? dep : `${dep}.js`));
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

const missing = [...required].filter((f) => !packed.has(f));
if (missing.length) {
  console.error(`✖ В установщик не попали файлы: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`✔ В установщике все нужные файлы (${required.size})`);
