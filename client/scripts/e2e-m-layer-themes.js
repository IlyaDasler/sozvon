// Новый слой: контраст текста и вид в темах.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');
const fs = require('node:fs');
const path = require('node:path');
const dir = 'C:/Users/solom/Documents/deepseek-harness/default-workspace/_tools/m-layer';

const THEMES = ['midnight', 'light', 'frost', 'glass', 'sozvon'];

runTest(async () => {
  fs.mkdirSync(dir, { recursive: true });
  const a = await register('mt' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('mt', a);
  w.setSize(411, 960); w.show(); w.focus();
  await sleep(700);
  await js(w, `localStorage.setItem('sozvon.mobileShell','1'); location.reload(); true`);
  await sleep(1800);

  for (const theme of THEMES) {
    await js(w, `setTheme('${theme}'); true`);
    await sleep(350);
    const raw = await js(w, `(() => {
      const lum = (c) => {
        const p = c.match(/\\d+(\\.\\d+)?/g).slice(0,3).map(Number).map((v) => {
          v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126*p[0] + 0.7152*p[1] + 0.0722*p[2];
      };
      const bg = getComputedStyle(document.body).backgroundColor;
      const fg = getComputedStyle(document.querySelector('.m-row__title') || document.querySelector('.m-topbar__title')).color;
      const l1 = lum(bg), l2 = lum(fg);
      return JSON.stringify({ theme: document.documentElement.dataset.theme, bg, fg, contrast: +(((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)).toFixed(2)) });
    })()`);
    const d = JSON.parse(raw);
    console.log('m-theme', JSON.stringify(d));
    if (d.contrast < 4.5) throw new Error(theme + ': контраст ' + d.contrast);
    fs.writeFileSync(path.join(dir, 'theme-' + theme + '.png'), (await w.webContents.capturePage()).toPNG());
  }
});
