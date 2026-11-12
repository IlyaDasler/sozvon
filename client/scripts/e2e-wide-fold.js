// Широкое окно/DeX: включается Workspace, нет скачка и виден аватар канала.
const { api, register, js, sleep, openClient, runTest } = require('./e2e-lib');
const fs = require('node:fs');
const path = require('node:path');
const dir = 'C:/Users/solom/Documents/deepseek-harness/default-workspace/_tools/wide-fold';

runTest(async () => {
  fs.mkdirSync(dir, { recursive: true });
  const a = await register('wf' + Date.now().toString(36).slice(-4), 'Аня');
  const seedHub = await api('POST', '/hubs', { name: 'Канал Fold' }, a.token);
  await api('POST', '/rooms', { name: 'Голосовая', kind: 'voice', hubId: seedHub.id }, a.token);
  await api('POST', '/rooms', { name: 'Переписка', kind: 'text', hubId: seedHub.id }, a.token);
  const w = await openClient('wf', a);
  w.setSize(1228, 838); w.show(); w.focus();
  await sleep(1200);
  const home = JSON.parse(await js(w, `JSON.stringify({w:innerWidth,h:innerHeight,body:document.body.className,nav:getComputedStyle(document.getElementById('mobile-nav')).display,rail:getComputedStyle(document.querySelector('#rail')).display,sidebar:Math.round(document.querySelector('.sidebar').getBoundingClientRect().width),hubs:getComputedStyle(document.getElementById('mobile-hubs')).display,mainH:Math.round(document.querySelector('#main').getBoundingClientRect().height),sideH:Math.round(document.querySelector('.sidebar').getBoundingClientRect().height),railH:Math.round(document.querySelector('#rail').getBoundingClientRect().height),padB:getComputedStyle(document.querySelector('#main')).paddingBottom})`));
  console.log('wide-home', JSON.stringify(home));
  fs.writeFileSync(path.join(dir, 'home.png'), (await w.webContents.capturePage()).toPNG());
  if (home.body.includes('mobile-list')) throw new Error('на старте открыт список каналов');
  // Открыть канал через рейл.
  await js(w, `[...document.querySelectorAll('.hub-tile')][0]?.click(); true`);
  await sleep(700);
  const hub = JSON.parse(await js(w, `JSON.stringify({body:document.body.className,nav:getComputedStyle(document.getElementById('mobile-nav')).display,sidebar:Math.round(document.querySelector('.sidebar').getBoundingClientRect().width),hubs:getComputedStyle(document.getElementById('mobile-hubs')).display,head:document.querySelector('.sidebar-head')?.innerText||'',avatar:!!document.querySelector('.sidebar-head .hub-menu-avatar'),active:document.activeElement?.id||'',pad:getComputedStyle(document.querySelector('#main')).paddingBottom,sideBottom:Math.round(document.querySelector('.sidebar').getBoundingClientRect().bottom),sidePad:getComputedStyle(document.querySelector('.sidebar')).paddingBottom,me:Math.round(document.querySelector('.me-panel').getBoundingClientRect().bottom),meStyle:(()=>{const e=document.querySelector('.me-panel'),c=getComputedStyle(e);return {mb:c.marginBottom,h:c.height}})(),composer:Math.round(document.querySelector('#room-message-form').getBoundingClientRect().bottom),compStyle:(()=>{const e=document.querySelector('#room-message-form'),c=getComputedStyle(e);return {pb:c.paddingBottom,h:c.height}})(),h:innerHeight})`));
  console.log('wide-hub', JSON.stringify(hub));
  fs.writeFileSync(path.join(dir, 'hub.png'), (await w.webContents.capturePage()).toPNG());
  if (hub.nav !== 'none') throw new Error('в Workspace осталась нижняя панель');
  if (hub.hubs !== 'none') throw new Error('дублирующий ряд каналов остался');
  if (!hub.avatar) throw new Error('в шапке канала нет аватара');
  if (/message-input/.test(hub.active)) throw new Error('композер получил фокус без нажатия: ' + hub.active);
  if (hub.pad !== '0px' || hub.h - hub.sideBottom > 2) throw new Error('Workspace не заполняет высоту: ' + JSON.stringify(hub));
  if (Math.abs(hub.me - hub.composer) > 2) throw new Error('профиль и композер не выровнены по низу: ' + JSON.stringify(hub));
});

