// Снимает кадры перехода, чтобы глазами проверить отсутствие старого экрана.
const { api, register, js, sleep, openClient, runTest } = require('./e2e-lib');
const fs = require('node:fs');
const path = require('node:path');

const shot = async (w, name) => {
  const img = await w.webContents.capturePage();
  fs.writeFileSync(path.join('C:/Users/solom/Documents/deepseek-harness/default-workspace/_tools/transition-shots', name), img.toPNG());
};

runTest(async () => {
  const dir = 'C:/Users/solom/Documents/deepseek-harness/default-workspace/_tools/transition-shots';
  fs.mkdirSync(dir, { recursive: true });
  const a = await register('cap' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Переход' }, a.token);
  await api('POST', '/rooms', { name: 'чат', kind: 'text', hubId: hub.id }, a.token);
  const w = await openClient('cap', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);

  const seq = async (label, click) => {
    await js(w, click);
    for (let i = 0; i < 10; i += 1) {
      await shot(w, `${label}-${String(i).padStart(2, '0')}.png`);
      await sleep(25);
    }
  };

  await seq('friends-to-channels', `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(500);
  await seq('channels-to-notifications', `document.querySelector('#mobile-nav [data-mobile="notifications"]').click(); true`);
  await sleep(500);
  await seq('notifications-to-friends', `document.querySelector('#mobile-nav [data-mobile="home"]').click(); true`);
  await sleep(500);
  await seq('friends-to-channels-2', `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
});
