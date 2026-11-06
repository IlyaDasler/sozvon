const fs = require('node:fs');
const path = require('node:path');
const { api, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');
runTest(async () => {
  const a = await register('rail' + Date.now().toString(36).slice(-5), 'Илья');
  const h1 = await api('POST', '/hubs', { name: 'Первый' }, a.token);
  const h2 = await api('POST', '/hubs', { name: 'Второй' }, a.token);
  const w = await openClient('railtest', a);
  await waitFor(w, 'e2eeReady()', 'вход');
  w.setSize(1084, 655);
  await sleep(500);
  await js(w, `openHub(${h1.id}); true`);
  await sleep(700);
  const info = await js(w, `(() => {
    const ind = document.querySelector('#rail-list .glass-tab-indicator');
    const active = document.querySelector('#rail-list .rail-item.active .rail-tile');
    return JSON.stringify({ has: !!ind, hidden: ind?.hidden, rect: ind ? [Math.round(ind.getBoundingClientRect().x), Math.round(ind.getBoundingClientRect().y), Math.round(ind.getBoundingClientRect().width), Math.round(ind.getBoundingClientRect().height)] : null, active: active ? [Math.round(active.getBoundingClientRect().x), Math.round(active.getBoundingClientRect().y), Math.round(active.getBoundingClientRect().width)] : null, theme: document.documentElement.dataset.theme });
  })()`);
  fs.writeFileSync('C:/Users/solom/Documents/deepseek-harness/default-workspace/_backup/ui33/railplate/info.json', info);
  const p = 'C:/Users/solom/Documents/deepseek-harness/default-workspace/_backup/ui33/railplate/active.png';
  fs.writeFileSync(p, (await w.webContents.capturePage()).toPNG());
  console.log('PLATE', info);
});
