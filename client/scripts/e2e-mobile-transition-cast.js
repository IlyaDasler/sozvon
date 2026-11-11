// Покадровая запись перехода через CDP, чтобы проверить его глазами и по кадрам.
const { api, register, js, sleep, openClient, runTest } = require('./e2e-lib');
const fs = require('node:fs');
const path = require('node:path');

const dir = 'C:/Users/solom/Documents/deepseek-harness/default-workspace/_tools/transition-cast';

runTest(async () => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const a = await register('cast' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Переход' }, a.token);
  await api('POST', '/rooms', { name: 'чат', kind: 'text', hubId: hub.id }, a.token);
  const w = await openClient('cast', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);

  const dbg = w.webContents.debugger;
  dbg.attach('1.3');
  let n = 0;
  const meta = [];
  dbg.on('message', (_event, method, params) => {
    if (method !== 'Page.screencastFrame') return;
    n += 1;
    const name = `frame-${String(n).padStart(3, '0')}.png`;
    fs.writeFileSync(path.join(dir, name), Buffer.from(params.data, 'base64'));
    meta.push({ name, ts: params.metadata.timestamp });
    dbg.sendCommand('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
  });
  await dbg.sendCommand('Page.enable');
  await dbg.sendCommand('Page.startScreencast', { format: 'png', quality: 100, everyNthFrame: 1 });

  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(700);
  await dbg.sendCommand('Page.stopScreencast');
  dbg.detach();
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  console.log('cast-frames', n);
});
