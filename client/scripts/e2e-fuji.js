// Фуджи: отдельная японская тема на стеклянном движке, динамический пейзаж
// по времени суток и активный указатель в рейле каналов.
const { api, register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('fj' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Фуджи' }, a.token);
  const hub2 = await api('POST', '/hubs', { name: 'Киото' }, a.token);
  await api('POST', '/rooms', { hubId: hub.id, name: 'Ворота в Киото', kind: 'text' }, a.token);
  const w = await openClient('fj', a);
  await sleep(1000);
  w.setSize(1084, 655);
  w.show();
  w.focus();
  w.webContents.setBackgroundThrottling(false);
  await js(w, `setTheme('fuji'); openHub(${hub.id}); true`);
  await sleep(900);

  const theme = await js(w, `JSON.stringify({theme:document.documentElement.dataset.theme, id:document.documentElement.dataset.themeId, accent:getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()})`);
  const t = JSON.parse(theme);
  if (t.theme !== 'glass' || t.id !== 'fuji') throw new Error(`Фуджи не включилась: ${theme}`);
  if (t.accent.toLowerCase() !== '#cf4e44') throw new Error(`Не киноварный акцент: ${t.accent}`);

  // Четыре кадра подключаются к фону без перезагрузки.
  for (const phase of ['dawn', 'day', 'sunset', 'night']) {
    await js(w, `sozvonDaypart.show('${phase}'); true`);
    await sleep(120);
    const state = await js(w, `JSON.stringify({phase:document.documentElement.dataset.daypart, bg:[...document.querySelectorAll('.lg-aurora')].map(e=>e.style.getPropertyValue('--scene')).join(' ')})`);
    const s = JSON.parse(state);
    if (s.phase !== phase || !s.bg.includes(`fuji-${phase}.jpg`)) throw new Error(`Фаза ${phase} не применилась: ${state}`);
  }

  // Указатель рейла виден и в Фуджи, и в «Глубине»; раскрытая папка тоже
  // остаётся выделенным разделом, а не теряет подсветку.
  for (const id of ['fuji', 'sozvon']) {
    await js(w, `setTheme('${id}'); store.set('rail:' + state.me.id, { items: [{ folder: 'f-test', name: 'Тест', hubs: [${hub.id}, ${hub2.id}], collapsed: false }] }); renderRail(); true`);
    await sleep(500);
    const rail = await js(w, `(() => { const head=document.querySelector('.rail-item.folder-head.active'); const ind=document.querySelector('#rail-list > .glass-tab-indicator'); return JSON.stringify({head:Boolean(head), hidden:ind?.hidden !== false, width:ind?.style.width || ''}); })()`);
    const r = JSON.parse(rail);
    if (!r.head) throw new Error(`В ${id} папка не стала активным разделом`);
    if (r.hidden) throw new Error(`В ${id} указатель рейла не появился`);
  }

  // Фуджи есть в группе «Новые темы».
  await js(w, `openSettings('look'); true`);
  await sleep(400);
  const groups = await js(w, `JSON.stringify([...document.querySelectorAll('#theme-grid .theme-group')].map(g=>({title:g.querySelector('h4')?.textContent, ids:[...g.querySelectorAll('.theme-card')].map(c=>c.dataset.pick)})))`);
  const g = JSON.parse(groups).find((x) => x.title === 'Новые темы');
  if (!g?.ids.includes('fuji')) throw new Error(`Фуджи нет в «Новых темах»: ${groups}`);
});
