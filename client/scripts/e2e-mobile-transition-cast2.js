// Покадровая запись перехода в уведомления и из них.
const { api, register, js, sleep, openClient, runTest } = require('./e2e-lib');
const fs = require('node:fs');
const path = require('node:path');

const dir = 'C:/Users/solom/Documents/deepseek-harness/default-workspace/_tools/transition-cast2';

runTest(async () => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const a = await register('cast2' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Переход' }, a.token);
  await api('POST', '/rooms', { name: 'чат', kind: 'text', hubId: hub.id }, a.token);
  const w = await openClient('cast2', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(500);

  const dbg = w.webContents.debugger;
  dbg.attach('1.3');
  let n = 0;
  const handlers = [];
  dbg.on('message', (_event, method, params) => {
    if (method !== 'Page.screencastFrame') return;
    n += 1;
    const name = `f-${String(n).padStart(3, '0')}.png`;
    fs.writeFileSync(path.join(dir, name), Buffer.from(params.data, 'base64'));
    dbg.sendCommand('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
  });
  await dbg.sendCommand('Page.enable');

  const capture = async (label, click, ms) => {
    await dbg.sendCommand('Page.startScreencast', { format: 'png', quality: 100, everyNthFrame: 1 });
    await sleep(50);
    await js(w, click);
    await sleep(ms);
    await dbg.sendCommand('Page.stopScreencast');
    for (const f of fs.readdirSync(dir).filter((x) => /^f-\d+\.png$/.test(x))) {
      const from = path.join(dir, f);
      const to = path.join(dir, `${label}-${f.slice(2)}`);
      if (!fs.existsSync(to)) fs.renameSync(from, to);
    }
    console.log('captured', label, fs.readdirSync(dir).filter((x) => x.startsWith(label)).length);
  };

  await capture('channels-notif', `document.querySelector('#mobile-nav [data-mobile="notifications"]').click(); true`, 500);
  await sleep(200);
  await capture('notif-settings', `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`, 500);

  dbg.detach();
});
