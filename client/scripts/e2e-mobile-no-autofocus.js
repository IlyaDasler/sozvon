// На телефоне клавиатура не должна открываться сама: после открытия окна
// фокус не должен стоять на поле ввода, пока пользователь не тапнул по нему.
const { api, befriend, register, js, sleep, openClient, runTest } = require('./e2e-lib');

const active = (w) => js(w, `(() => { const e = document.activeElement; return e ? (e.tagName + '#' + (e.id || '')) : ''; })()`);

runTest(async () => {
  const a = await register('na' + Date.now().toString(36).slice(-4), 'Аня');
  const b = await register('nb' + Date.now().toString(36).slice(-4), 'Боря');
  await befriend(a, b);
  const hub = await api('POST', '/hubs', { name: 'Канал' }, a.token);
  await api('POST', '/rooms', { name: 'Чат', kind: 'text', hubId: hub.id }, a.token);

  const w = await openClient('na', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);

  const cases = [
    ['создание канала', `openHubCreate(); true`, '#hub-create'],
    ['приглашение в канал', `openHubInvite(${hub.id}); true`, '#hub-invite'],
    ['создание события', `openEventCreate(hubById(${hub.id})); true`, '#event-create'],
    ['ник участника', `openNicknameDialog(hubById(${hub.id}), hubById(${hub.id}).members.find((m) => m.id === ${b.user.id}) || { id: ${b.user.id}, displayName: 'Боря' }); true`, '#nick-modal'],
  ];

  for (const [label, open, sel] of cases) {
    await js(w, open);
    await sleep(300);
    if (!(await js(w, `!document.querySelector(${JSON.stringify(sel)})?.classList.contains('hidden')`))) {
      throw new Error('окно не открылось: ' + label);
    }
    const f = await active(w);
    if (/^(INPUT|TEXTAREA|SELECT)/.test(f)) throw new Error(`автофокус поля при открытии «${label}»: ${f}`);
    console.log('ok no-autofocus', label, f || '(body)');
    await js(w, `document.querySelector(${JSON.stringify(sel)}).classList.add('hidden'); true`);
    await sleep(120);
  }

  // Выбор друга открывает чат, но не выдёргивает клавиатуру в поле ввода.
  await js(w, `selectContact(${b.user.id}); true`);
  await sleep(500);
  const f = await active(w);
  if (/^(INPUT|TEXTAREA)/.test(f)) throw new Error('автофокус поля ввода при открытии личного чата: ' + f);
  console.log('ok no-autofocus личный чат', f || '(body)');

  // Вкладка «Добавить в друзья» не должна сама поднимать клавиатуру.
  await js(w, `document.querySelector('#friend-tabs [data-tab="add"]').click(); true`);
  await sleep(300);
  const addFocus = await active(w);
  console.log('add-tab-focus', addFocus || '(body)');
  if (/^(INPUT|TEXTAREA)/.test(addFocus)) throw new Error('клавиатура открылась на вкладке добавления: ' + addFocus);

  // После тапа по полю фокус должен работать.
  await js(w, `(() => {
    const input = document.getElementById('friend-add-input');
    input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    input.focus();
    return true;
  })()`);
  const tapped = await active(w);
  console.log('tap-focus', tapped || '(body)');
  if (!tapped.includes('friend-add-input')) throw new Error('после тапа поле не получило фокус: ' + tapped);
  await js(w, `document.getElementById('friend-add-input').blur(); true`);

  // Настройки и шаг 2FA тоже без автофокуса.
  await js(w, `openSettings(); true`);
  await sleep(600);
  const settingsFocus = await active(w);
  console.log('settings-focus', settingsFocus || '(body)');
  if (/^(INPUT|TEXTAREA)/.test(settingsFocus)) throw new Error('автофокус при открытии настроек: ' + settingsFocus);
  await js(w, `document.querySelector('#set-nav > button[data-tab="account"]').click(); true`);
  await sleep(400);
  await js(w, `document.getElementById('tf-start')?.click(); true`);
  await sleep(300);
  const tfFocus = await active(w);
  console.log('tf-focus', tfFocus || '(body)');
  if (/^(INPUT|TEXTAREA)/.test(tfFocus)) throw new Error('автофокус на шаге 2FA: ' + tfFocus);
});
