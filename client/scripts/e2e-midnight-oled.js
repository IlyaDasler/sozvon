// «Полночь» на OLED: все нейтральные подложки — чистый #000, без цветного чёрного.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('md' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('md', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  await js(w, `setTheme('midnight'); true`);
  await sleep(500);

  const data = JSON.parse(await js(w, `(() => {
    const root = getComputedStyle(document.documentElement);
    const vars = ['--bg-deep','--bg','--bg-2','--bg-3','--bg-4','--bg-5'].map((k) => [k, root.getPropertyValue(k).trim().toLowerCase()]);
    const ids = ['main','mobile-nav'];
    const sels = ['body','#main','.sidebar','.content','#mobile-nav'];
    const colors = {};
    for (const s of sels) {
      const e = document.querySelector(s);
      if (e) colors[s] = getComputedStyle(e).backgroundColor;
    }
    return JSON.stringify({ theme: document.documentElement.dataset.theme, vars, colors });
  })()`));
  console.log('midnight', JSON.stringify(data));
  if (data.theme !== 'midnight') throw new Error('тема не переключилась: ' + data.theme);
  for (const [k, v] of data.vars) {
    if (!['#000000', 'rgb(0, 0, 0)'].includes(v)) throw new Error(k + ' не чистый чёрный: ' + v);
  }
  for (const [s, v] of Object.entries(data.colors)) {
    if (!/^(rgba?\(0, 0, 0(, [\d.]+)?\)|color\(srgb 0 0 0 \/ [\d.]+\)|transparent)$/.test(v)) throw new Error(s + ' не чёрный: ' + v);
  }
  // Открытые экраны тоже чёрные.
  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await sleep(400);
  const settings = JSON.parse(await js(w, `(() => {
    const c = getComputedStyle(document.getElementById('settings'));
    const card = getComputedStyle(document.querySelector('#settings .set-card'));
    return JSON.stringify({ bg: c.backgroundColor, card: card.backgroundColor });
  })()`));
  console.log('midnight-settings', JSON.stringify(settings));
  if (settings.bg !== 'rgb(0, 0, 0)' || settings.card !== 'rgb(0, 0, 0)') throw new Error('настройки не чёрные: ' + JSON.stringify(settings));
});
