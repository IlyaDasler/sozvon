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
  await sleep(1000);
  await js(w, `setTheme('glass2'); true`);
  await sleep(400);
  const home = JSON.parse(await js(w, `JSON.stringify({w:innerWidth,headBottom:Math.round(document.querySelector('.sidebar-head').getBoundingClientRect().bottom),chatHeadBottom:Math.round(document.querySelector('.chat-head').getBoundingClientRect().bottom),h:innerHeight,body:document.body.className,nav:getComputedStyle(document.getElementById('mobile-nav')).display,rail:getComputedStyle(document.querySelector('#rail')).display,sidebar:Math.round(document.querySelector('.sidebar').getBoundingClientRect().width),sideDisp:getComputedStyle(document.querySelector('.sidebar')).display,dock:Math.round(document.querySelector('.friends-profile-dock')?.getBoundingClientRect().width||0),dockX:Math.round(document.querySelector('.friends-profile-dock')?.getBoundingClientRect().x||0),dockRight:Math.round(document.querySelector('.friends-profile-dock')?.getBoundingClientRect().right||0),content:Math.round(document.querySelector('#main .content').getBoundingClientRect().width),hubs:getComputedStyle(document.getElementById('mobile-hubs')).display,accent:getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),bg:getComputedStyle(document.body).backgroundColor,tabs:(()=>{const t=document.getElementById('friend-tabs');const b=t?.querySelector('button');return {scroll:t?.scrollLeft,rect:t?.getBoundingClientRect().toJSON(),first:b?.getBoundingClientRect().toJSON(),pad:t?getComputedStyle(t).paddingLeft:null}})(),search:(()=>{const e=document.getElementById('friend-search');const r=e.getBoundingClientRect();return {r:r.toJSON(),d:getComputedStyle(e).display,v:getComputedStyle(e).visibility,bodyTop:Math.round(document.querySelector('.friends-body').getBoundingClientRect().top),tabsBottom:Math.round(document.querySelector('.friend-tabs').getBoundingClientRect().bottom)}})(),mainH:Math.round(document.querySelector('#main').getBoundingClientRect().height),sideH:Math.round(document.querySelector('.sidebar').getBoundingClientRect().height),railH:Math.round(document.querySelector('#rail').getBoundingClientRect().height),padB:getComputedStyle(document.querySelector('#main')).paddingBottom})`));
  console.log('wide-home', JSON.stringify(home));
  fs.writeFileSync(path.join(dir, 'home.png'), (await w.webContents.capturePage()).toPNG());
  if (home.body.includes('mobile-list')) throw new Error('на старте открыт список каналов');
  if (home.sideDisp !== 'none') throw new Error('сайдбар друзей не скрыт');
  if (home.dock < 600) throw new Error('профиль не растянут: ' + home.dock);
  if (home.dockX > 82 || home.dockRight < home.w - 10) throw new Error('полоса профиля не прижата к краям: ' + JSON.stringify(home));
  // Открыть канал через рейл.
  await js(w, `[...document.querySelectorAll('.hub-tile')][0]?.click(); true`);
  await sleep(700);
  const hub = JSON.parse(await js(w, `JSON.stringify({body:document.body.className,nav:getComputedStyle(document.getElementById('mobile-nav')).display,sidebar:Math.round(document.querySelector('.sidebar').getBoundingClientRect().width),hubs:getComputedStyle(document.getElementById('mobile-hubs')).display,head:document.querySelector('.sidebar-head')?.innerText||'',avatar:!!document.querySelector('.sidebar-head .hub-menu-avatar'),active:document.activeElement?.id||'',pad:getComputedStyle(document.querySelector('#main')).paddingBottom,sideBottom:Math.round(document.querySelector('.sidebar').getBoundingClientRect().bottom),sidePad:getComputedStyle(document.querySelector('.sidebar')).paddingBottom,me:Math.round(document.querySelector('.me-panel').getBoundingClientRect().bottom),meStyle:(()=>{const e=document.querySelector('.me-panel'),c=getComputedStyle(e);return {mb:c.marginBottom,h:c.height}})(),composer:Math.round(document.querySelector('#room-message-form').getBoundingClientRect().bottom),compStyle:(()=>{const e=document.querySelector('#room-message-form'),c=getComputedStyle(e);return {pb:c.paddingBottom,h:c.height}})(),h:innerHeight})`));
  console.log('wide-hub', JSON.stringify(hub));
  fs.writeFileSync(path.join(dir, 'hub.png'), (await w.webContents.capturePage()).toPNG());
  if (hub.nav !== 'none') throw new Error('в Workspace осталась нижняя панель');
  if (hub.hubs !== 'none') throw new Error('дублирующий ряд каналов остался');
  if (!hub.avatar) throw new Error('в шапке канала нет аватара');
  const back = await js(w, `window.mobileBack()`);
  await sleep(400);
  const afterBack = JSON.parse(await js(w, `JSON.stringify({body:document.body.className,room:!document.querySelector('#room-view').classList.contains('hidden'),sidebar:getComputedStyle(document.querySelector('.sidebar')).display})`));
  console.log('wide-back', JSON.stringify({ ...afterBack, handled: back }));
  if (!back) throw new Error('mobileBack не обработал комнату');
  if (afterBack.body.includes('mobile-list')) throw new Error('назад открыл телефонный список на фолде');
  if (afterBack.room) throw new Error('назад не закрыл комнату');
  const toHome = await js(w, `window.mobileBack()`);
  await sleep(400);
  const homeBack = JSON.parse(await js(w, `JSON.stringify({body:document.body.className,empty:!document.getElementById('empty-state').classList.contains('hidden'),list:document.body.classList.contains('mobile-list')})`));
  console.log('wide-back-home', JSON.stringify({ ...homeBack, handled: toHome }));
  if (!toHome || homeBack.list || !homeBack.empty || homeBack.body.includes('mobile-hub-open')) throw new Error('второй назад не вернул к друзьям: ' + JSON.stringify(homeBack));
  const guard1 = await js(w, `window.mobileBack()`);
  const guard2 = await js(w, `window.mobileBack()`);
  console.log('wide-back-exit-guard', guard1, guard2);
  if (guard1 !== true || guard2 !== false) throw new Error('нет защиты от случайного выхода: ' + guard1 + '/' + guard2);
  if (/message-input/.test(hub.active)) throw new Error('композер получил фокус без нажатия: ' + hub.active);
  if (hub.pad !== '0px' || hub.h - hub.sideBottom > 2) throw new Error('Workspace не заполняет высоту: ' + JSON.stringify(hub));
  if (Math.abs(hub.me - hub.composer) > 2) throw new Error('профиль и композер не выровнены по низу: ' + JSON.stringify(hub));
  if (Math.abs(hub.headBottom - hub.chatHeadBottom) > 1) throw new Error('шапки не выровнены: ' + JSON.stringify(hub));
});

