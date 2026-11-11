// Уведомления/настройки — непрозрачные экраны с первого кадра, без старых слоёв.
const { api, register, js, sleep, openClient, runTest } = require('./e2e-lib');

const probe = (w, target) => js(w, `(() => {
  const el = ${target};
  const r = el.getBoundingClientRect();
  const c = getComputedStyle(el);
  const top = document.elementFromPoint(Math.round(innerWidth / 2), Math.round(innerHeight / 3));
  const empty = document.getElementById('empty-state');
  const app = document.getElementById('main');
  return JSON.stringify({
    x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    vw: innerWidth, vh: innerHeight, bg: c.backgroundColor, opacity: c.opacity,
    anim: c.animationName, blur: c.backdropFilter || c.webkitBackdropFilter,
    empty: empty ? getComputedStyle(empty).display : null,
    appVisible: app ? getComputedStyle(app).visibility : null,
    top: top ? (top.id || top.className || top.tagName) : '',
  });
})()`);

runTest(async () => {
  const a = await register('mt' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Переходы' }, a.token);
  await api('POST', '/rooms', { name: 'чат', kind: 'text', hubId: hub.id }, a.token);
  const w = await openClient('mt', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);

  // Друзья → Уведомления: панель уже непрозрачная и на весь экран.
  await js(w, `document.querySelector('#mobile-nav [data-mobile="notifications"]').click(); true`);
  await sleep(25);
  let d = JSON.parse(await probe(w, `document.getElementById('notif-panel')`));
  console.log('notif-early', JSON.stringify(d));
  if (d.w < d.vw - 2 || d.h < d.vh - 140) throw new Error('уведомления не на весь экран сразу: ' + JSON.stringify(d));
  if (/rgba\(0, 0, 0, 0\)|transparent/.test(d.bg) || d.opacity !== '1') throw new Error('уведомления прозрачные: ' + JSON.stringify(d));
  if (/scrim|pop-down|mobile-notifs-in/.test(d.anim)) throw new Error('у уведомлений осталась старая анимация: ' + d.anim);
  if (d.appVisible !== 'hidden') throw new Error('под уведомлениями виден старый экран');

  // Уведомления → Настройки: старый экран скрыт, настройки непрозрачны сразу.
  await sleep(300);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await sleep(25);
  d = JSON.parse(await probe(w, `document.getElementById('settings')`));
  console.log('settings-early', JSON.stringify(d));
  if (d.w < d.vw - 2 || d.h < d.vh - 140) throw new Error('настройки не на весь экран сразу: ' + JSON.stringify(d));
  if (/rgba\(0, 0, 0, 0\)|transparent/.test(d.bg) || d.opacity !== '1') throw new Error('настройки прозрачные: ' + JSON.stringify(d));
  if (/scrim-in|modal-in|fade/.test(d.anim)) throw new Error('у настроек осталась старая анимация: ' + d.anim);
  if (d.appVisible !== 'hidden') throw new Error('под настройками виден старый экран');

  // Настройки → Уведомления: настройки сняты, уведомления снова непрозрачны.
  await sleep(300);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="notifications"]').click(); true`);
  await sleep(25);
  d = JSON.parse(await probe(w, `document.getElementById('notif-panel')`));
  console.log('notif-from-settings', JSON.stringify(d));
  if (d.bg === 'rgba(0, 0, 0, 0)' || d.opacity !== '1') throw new Error('уведомления прозрачны при выходе из настроек');
  if (!(await js(w, `document.getElementById('settings').classList.contains('hidden')`))) throw new Error('настройки остались поверх уведомлений');
});
