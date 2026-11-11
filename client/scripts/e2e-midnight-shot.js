// Скриншоты «Полночи» для проверки OLED-чёрного глазами.
const { register, js, sleep, openClient, runTest } = require('./e2e-lib');
const fs = require('node:fs');
const path = require('node:path');
const dir = 'C:/Users/solom/Documents/deepseek-harness/default-workspace/_tools/midnight-shots';

runTest(async () => {
  fs.mkdirSync(dir, { recursive: true });
  const a = await register('ms' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('ms', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  fs.writeFileSync(path.join(dir, 'home-sozvon.png'), (await w.webContents.capturePage()).toPNG());
  console.log('layout-sozvon', JSON.stringify(await js(w, `(() => { const ids=['empty-state','friend-tabs']; const o={}; for(const id of ids){const e=document.getElementById(id); const r=e.getBoundingClientRect(); o[id]={top:Math.round(r.top),h:Math.round(r.height),scroll:e.scrollTop,display:getComputedStyle(e).display};} const fb=document.querySelector('.friends-body'); o.friendsBody=fb?{top:Math.round(fb.getBoundingClientRect().top),h:Math.round(fb.getBoundingClientRect().height),margin:getComputedStyle(fb).margin,padding:getComputedStyle(fb).padding}:null; return JSON.stringify(o); })()`)));
  await js(w, `setTheme('midnight'); true`);
  await sleep(500);
  fs.writeFileSync(path.join(dir, 'home.png'), (await w.webContents.capturePage()).toPNG());
  console.log('layout-midnight', JSON.stringify(await js(w, `(() => { const ids=['empty-state','friend-tabs']; const o={}; for(const id of ids){const e=document.getElementById(id); const r=e.getBoundingClientRect(); o[id]={top:Math.round(r.top),h:Math.round(r.height),scroll:e.scrollTop,display:getComputedStyle(e).display};} const fb=document.querySelector('.friends-body'); o.friendsBody=fb?{top:Math.round(fb.getBoundingClientRect().top),h:Math.round(fb.getBoundingClientRect().height),margin:getComputedStyle(fb).margin,padding:getComputedStyle(fb).padding}:null; return JSON.stringify(o); })()`)));
  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await sleep(500);
  fs.writeFileSync(path.join(dir, 'settings.png'), (await w.webContents.capturePage()).toPNG());
});
