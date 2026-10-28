// Рисует иконку приложения (build/icon.png, 512×512) и значок в трее (assets/tray.png, 32×32) из
// renderer/logo.svg — одна картинка на всё. Рисует сам Chromium, поэтому запуск — через Electron:
//   npm run icon   (то же, что npx electron scripts/make-icon.js)
// Готовые PNG лежат в репозитории; перерисовать нужно, только если поменяли logo.svg.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'renderer', 'logo.svg'), 'utf8');

async function render(size) {
  const win = new BrowserWindow({
    show: false,
    width: size,
    height: size,
    useContentSize: true,
    frame: false,
    backgroundColor: '#00000000', // углы иконки прозрачные
    webPreferences: { offscreen: true },
  });
  await win.loadURL('about:blank');
  await win.webContents.executeJavaScript(`new Promise((done) => {
    document.body.style.cssText = 'margin:0;background:transparent';
    const img = new Image(${size}, ${size});
    img.style.display = 'block';
    img.onload = () => requestAnimationFrame(() => requestAnimationFrame(done));
    img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
    document.body.append(img);
  })`);
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  win.destroy();
  // Экран с масштабом 125% и т. п. даёт снимок крупнее — приводим к нужной стороне
  return image.getSize().width === size ? image : image.resize({ width: size, height: size, quality: 'best' });
}

app.whenReady().then(async () => {
  // Рисуем один раз крупно; значок трея — уменьшенная копия
  const big = await render(512);
  for (const [file, size] of [['build/icon.png', 512], ['assets/tray.png', 32]]) {
    fs.writeFileSync(path.join(root, file), (size === 512 ? big : big.resize({ width: size, height: size, quality: 'best' })).toPNG());
    console.log(`${file} — ${size}×${size}`);
  }
  app.exit(0);
});
