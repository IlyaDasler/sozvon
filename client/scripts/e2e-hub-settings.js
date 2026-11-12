// Настройки канала: свайпы между вкладками и автосохранение без кнопки.
const fs = require('node:fs');
const { api, register, js, sleep, openClient, runTest } = require('./e2e-lib');

const swipe = async (w, fromX, toX) => {
  await js(w, `(() => {
    const body = document.querySelector('#hub-settings .rs-body');
    const target = body;
    const make = (x) => new Touch({ identifier: 1, target, clientX: x, clientY: 400, pageX: x, pageY: 400 });
    const a = make(${fromX});
    target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [a], targetTouches: [a], changedTouches: [a] }));
    const b = make(${toX});
    target.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [b] }));
    return true;
  })()`);
  await sleep(300);
};

runTest(async () => {
  const a = await register('hset' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Канал настроек' }, a.token);
  const w = await openClient('hset', a);
  w.setSize(1228, 838); w.show(); w.focus();
  await sleep(1000);
  await js(w, `openHubSettings(${hub.id}); true`);
  await sleep(400);

  const initial = JSON.parse(await js(w, `JSON.stringify({title:document.querySelector('#hs-title').textContent,tab:document.querySelector('#hs-nav [data-tab].active')?.dataset.tab,save:[...document.querySelectorAll('#hub-settings button')].some((b)=>b.textContent.trim()==='Сохранить')})`));
  console.log('hub-settings-initial', JSON.stringify(initial));
  if (initial.tab !== 'overview') throw new Error('открылся не обзор');
  if (initial.save) throw new Error('осталась кнопка Сохранить');

  await swipe(w, 1000, 300);
  let d = JSON.parse(await js(w, `JSON.stringify({title:document.querySelector('#hs-title').textContent,tab:document.querySelector('#hs-nav [data-tab].active')?.dataset.tab})`));
  console.log('hub-swipe-events', JSON.stringify(d));
  if (d.tab !== 'events') throw new Error('свайп не открыл события: ' + d.tab);

  await swipe(w, 1000, 300);
  d = JSON.parse(await js(w, `JSON.stringify({title:document.querySelector('#hs-title').textContent,tab:document.querySelector('#hs-nav [data-tab].active')?.dataset.tab})`));
  console.log('hub-swipe-roles', JSON.stringify(d));
  if (d.tab !== 'roles') throw new Error('свайп не открыл роли: ' + d.tab);

  // Без кнопки сохранения: поле и подсказка автосохранения на месте.
  await js(w, `document.querySelector('#hs-nav [data-tab="overview"]').click(); true`);
  await sleep(300);
  const auto = JSON.parse(await js(w, `JSON.stringify({save:[...document.querySelectorAll('#hub-settings button')].some((b)=>b.textContent.trim()==='Сохранить'),hint:document.querySelector('#hub-settings .hs-autosave')?.textContent||'',name:!!document.querySelector('#hub-settings input[data-keep="hub-name"]')})`));
  console.log('hub-autosave-ui', JSON.stringify(auto));
  if (auto.save || !auto.hint || !auto.name) throw new Error('автосохранение не настроено: ' + JSON.stringify(auto));
  fs.writeFileSync('C:/Users/solom/Documents/deepseek-harness/default-workspace/_tools/hub-settings.png', (await w.webContents.capturePage()).toPNG());
});
