// Новый слой: альбом и увеличенный шрифт (зум) — без переполнений.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');
const fs = require('node:fs');
const path = require('node:path');
const dir = 'C:/Users/solom/Documents/deepseek-harness/default-workspace/_tools/m-layer';

runTest(async () => {
  fs.mkdirSync(dir, { recursive: true });
  const a = await register('mz' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('mz', a);
  w.setSize(411, 960); w.show(); w.focus();
  await sleep(700);
  await js(w, `localStorage.setItem('sozvon.mobileShell','1'); location.reload(); true`);
  await sleep(1800);

  const probe = async (label) => {
    const d = JSON.parse(await js(w, `JSON.stringify({
      w: innerWidth, h: innerHeight,
      sw: document.documentElement.scrollWidth,
      apps: document.querySelectorAll('#m-app').length,
      old: getComputedStyle(document.getElementById('main')).display,
      nav: (() => { const r = document.querySelector('.m-nav')?.getBoundingClientRect(); return r ? [Math.round(r.top), Math.round(r.bottom)] : null; })(),
    })`));
    console.log('m-stress', label, JSON.stringify(d));
    if (d.apps !== 1 || d.old !== 'none') throw new Error(label + ': слой не изолирован');
    if (d.sw > d.w + 1) throw new Error(label + ': горизонтальное переполнение');
    if (!d.nav || d.nav[1] > d.h + 1) throw new Error(label + ': меню вне экрана');
    fs.writeFileSync(path.join(dir, label + '.png'), (await w.webContents.capturePage()).toPNG());
  };

  w.setSize(900, 400);
  await sleep(300);
  await probe('landscape-900x400');

  w.setSize(411, 960);
  await sleep(300);
  w.webContents.setZoomFactor(2);
  await sleep(300);
  await probe('zoom-200');
  w.webContents.setZoomFactor(1);
});
