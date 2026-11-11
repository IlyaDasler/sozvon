// Списки по центру и компактные свитчеры в настройках канала.
const { api, befriend, register, js, sleep, openClient, runTest, waitFor } = require('./e2e-lib');

runTest(async () => {
  const a = await register('cs' + Date.now().toString(36).slice(-4), 'Аня');
  const b = await register('csb' + Date.now().toString(36).slice(-4), 'Боря');
  await befriend(a, b);
  const hub = await api('POST', '/hubs', { name: 'Центр' }, a.token);
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [b.user.id] }, a.token);
  await api('POST', `/hub-invites/${hub.id}/accept`, null, b.token);
  await api('POST', '/rooms', { name: 'Чат', kind: 'text', hubId: hub.id }, a.token);

  const w = await openClient('cs', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);

  // Корень каналов: список центрируется по вертикали, а не липнет к верху.
  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(500);
  const center = JSON.parse(await js(w, `(() => {
    const bar = document.getElementById('mobile-hubs');
    const cs = getComputedStyle(bar);
    const items = [...bar.querySelectorAll('.mobile-hub')];
    const br = bar.getBoundingClientRect();
    const first = items[0]?.getBoundingClientRect();
    return JSON.stringify({ display: cs.display, justify: cs.justifyContent, barH: Math.round(br.height), gapTop: first ? Math.round(first.top - br.top) : -1, count: items.length });
  })()`));
  console.log('channels-center', JSON.stringify(center));
  if (!/flex/.test(center.display)) throw new Error('список каналов не flex: ' + center.display);
  if (!/center/.test(center.justify)) throw new Error('список каналов не центрируется: ' + center.justify);
  if (center.gapTop < 40) throw new Error('список каналов прижат к верху: ' + center.gapTop);

  await js(w, `openHub(${hub.id}); true`);
  await waitFor(w, `document.body.classList.contains('mobile-hub-open')`, 'канал открыт', 4000);
  await js(w, `document.getElementById('mobile-channel-settings').click(); true`);
  await waitFor(w, `!document.getElementById('hub-settings').classList.contains('hidden')`, 'настройки открылись');

  // Участники: свитчер «Управляет» компактный, текст-дубль скрыт.
  await js(w, `document.querySelector('#hs-nav [data-tab="members"]').click(); true`);
  await sleep(300);
  const mgr = JSON.parse(await js(w, `(() => {
    const sw = document.querySelector('#hub-settings .manager-switch .switch');
    const span = document.querySelector('#hub-settings .manager-switch > span');
    if (!sw) return JSON.stringify({ found: false });
    const r = sw.getBoundingClientRect();
    const cs = getComputedStyle(sw);
    return JSON.stringify({ found: true, w: Math.round(r.width), h: Math.round(r.height), radius: cs.borderTopLeftRadius, span: span ? getComputedStyle(span).display : 'none' });
  })()`));
  console.log('manager-switch', JSON.stringify(mgr));
  if (!mgr.found) throw new Error('свитчер «Управляет» не найден');
  if (Math.abs(mgr.w - 38) > 1 || Math.abs(mgr.h - 22) > 1) throw new Error('свитчер не компактный: ' + JSON.stringify(mgr));
  if (mgr.radius !== '11px') throw new Error('радиус свитчера не 11px: ' + mgr.radius);
  if (mgr.span !== 'none') throw new Error('рядом со свитчером остался текст «Управляет»');

  // Роли: свитчеры прав такие же компактные.
  await js(w, `document.querySelector('#hs-nav [data-tab="roles"]').click(); true`);
  await sleep(300);
  const perm = JSON.parse(await js(w, `(() => {
    const sw = document.querySelector('#hub-settings .perm-item .switch');
    if (!sw) return JSON.stringify({ found: false });
    const r = sw.getBoundingClientRect();
    return JSON.stringify({ found: true, w: Math.round(r.width), h: Math.round(r.height), radius: getComputedStyle(sw).borderTopLeftRadius });
  })()`));
  console.log('perm-switch', JSON.stringify(perm));
  if (!perm.found) throw new Error('свитчеры прав не найдены');
  if (Math.abs(perm.w - 38) > 1 || Math.abs(perm.h - 22) > 1) throw new Error('свитчер прав не компактный: ' + JSON.stringify(perm));
});
