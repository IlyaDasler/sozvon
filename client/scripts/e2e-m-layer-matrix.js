// Новый слой: геометрия и отсутствие старого слоя на ширинах 320–840.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');
const fs = require('node:fs');
const path = require('node:path');

const dir = 'C:/Users/solom/Documents/deepseek-harness/default-workspace/_tools/m-layer';

runTest(async () => {
  fs.mkdirSync(dir, { recursive: true });
  const a = await register('mx' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('mx', a);
  w.setSize(411, 960); w.show(); w.focus();
  await sleep(700);
  await js(w, `setTheme('midnight'); localStorage.setItem('sozvon.mobileShell','1'); location.reload(); true`);
  await sleep(1800);

  const sizes = [[320, 640], [360, 740], [411, 960], [480, 900], [600, 900], [840, 900]];
  for (const [width, height] of sizes) {
    w.setSize(width, height);
    await sleep(350);
    const d = JSON.parse(await js(w, `(() => {
      const app = document.getElementById('m-app');
      const nav = document.querySelector('.m-nav');
      const bar = document.querySelector('.m-topbar');
      const nr = nav?.getBoundingClientRect();
      const br = bar?.getBoundingClientRect();
      return JSON.stringify({
        w: innerWidth, h: innerHeight,
        apps: document.querySelectorAll('#m-app').length,
        oldMain: getComputedStyle(document.getElementById('main')).display,
        scrollW: document.documentElement.scrollWidth,
        navBottom: nr ? Math.round(nr.bottom) : -1,
        barTop: br ? Math.round(br.top) : -1,
        text: app?.innerText.slice(0, 80) || '',
      });
    })()`));
    console.log('m-layer-size', JSON.stringify(d));
    if (d.apps !== 1) throw new Error(width + ': #m-app=' + d.apps);
    if (d.oldMain !== 'none') throw new Error(width + ': старый слой виден');
    if (d.scrollW > d.w + 1) throw new Error(width + ': горизонтальное переполнение ' + d.scrollW + '>' + d.w);
    if (d.barTop < 0 || d.navBottom > d.h + 1) throw new Error(width + ': шапка/навигация вне экрана ' + JSON.stringify(d));
    fs.writeFileSync(path.join(dir, `${width}x${height}.png`), (await w.webContents.capturePage()).toPNG());
  }

  // Экран входа нового слоя.
  await w.setSize(411, 960);
  await sleep(250);
  await js(w, `document.querySelectorAll('.m-nav__item')[1].click(); true`);
  await sleep(300);
  await js(w, `document.querySelector('.m-row--danger').click(); true`);
  await sleep(500);
  const auth = JSON.parse(await js(w, `JSON.stringify({ text: document.getElementById('m-app').innerText.slice(0,200), oldMain: getComputedStyle(document.getElementById('main')).display, apps: document.querySelectorAll('#m-app').length })`));
  console.log('m-layer-auth', JSON.stringify(auth));
  if (!/Вход в Созвон/.test(auth.text)) throw new Error('не открылся экран входа');
  if (auth.oldMain !== 'none' || auth.apps !== 1) throw new Error('на экране входа старый слой/дубль');
  fs.writeFileSync(path.join(dir, 'auth-411.png'), (await w.webContents.capturePage()).toPNG());
});
