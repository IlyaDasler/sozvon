// Combobox / Autocomplete: подсказки под поиском, клавиатура и выбор
const { api, befriend, register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('bc' + Math.random().toString(36).slice(2, 4), 'Аня');
  const b = await register('bd' + Math.random().toString(36).slice(2, 4), 'Боря');
  await befriend(a, b);
  const win = await openClient('bca', a);
  await sleep(1600);
  win.setSize(1200, 800);
  await sleep(300);
  win.show();
  win.focus();

  // 1. Подсказки появляются по вводу
  await js(win, `(() => {
    const input = document.getElementById('friend-search');
    input.focus();
    input.value = 'Бор';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(300);
  const menu = JSON.parse(await js(win, `(() => {
    const m = document.querySelector('.cb-menu');
    const input = document.getElementById('friend-search');
    return JSON.stringify({
      open: Boolean(m),
      options: m ? m.querySelectorAll('.cb-option').length : 0,
      expanded: input.getAttribute('aria-expanded'),
      role: m ? m.getAttribute('role') : null,
      first: m ? m.querySelector('.cb-option b')?.textContent : null,
    });
  })()`));
  if (!menu.open) throw new Error('Подсказки не открылись');
  if (menu.options < 1) throw new Error('В подсказках нет вариантов');
  if (menu.expanded !== 'true') throw new Error('aria-expanded не выставлен');
  if (menu.role !== 'listbox') throw new Error('У списка нет role=listbox');
  if (menu.first !== b.user.displayName) throw new Error(`Первый вариант: ${menu.first}, ждали ${b.user.displayName}`);

  // 2. Клавиатура: стрелка + Enter открывает переписку
  await js(win, `(() => {
    const input = document.getElementById('friend-search');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    return true;
  })()`);
  await sleep(500);
  const picked = JSON.parse(await js(win, `JSON.stringify({
    selected: state.selectedId,
    chat: !document.getElementById('chat').classList.contains('hidden'),
    menu: Boolean(document.querySelector('.cb-menu')),
  })`));
  if (Number(picked.selected) !== Number(b.user.id)) throw new Error(`Выбран ${picked.selected}, ждали ${b.user.id}`);
  if (!picked.chat) throw new Error('Чат не открылся после выбора подсказки');
  if (picked.menu) throw new Error('Список не закрылся после выбора');

  // 3. Пустой запрос и Escape закрывают список
  await js(win, `(() => {
    const input = document.getElementById('friend-search');
    input.value = 'zzz';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(250);
  if (await js(win, `Boolean(document.querySelector('.cb-menu'))`)) throw new Error('Список висит на пустом результате');

  // 4. В приглашении в канал выбор подсказки нажимает «Пригласить»
  const hub = await api('POST', '/hubs', { name: 'Подсказки' }, a.token);
  await js(win, `(async () => { await refreshHubs(); openHubInvite(${hub.id}); return true; })()`);
  await sleep(500);
  await js(win, `(() => {
    const input = document.getElementById('hi-search');
    input.focus();
    input.value = 'Бор';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(300);
  await js(win, `(() => {
    const input = document.getElementById('hi-search');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    return true;
  })()`);
  await sleep(700);
  const invited = JSON.parse(await js(win, `JSON.stringify({
    text: /Позвали|Приглашён/.test(document.getElementById('hi-list')?.textContent || ''),
    list: document.getElementById('hi-list')?.textContent?.slice(0, 80),
  })`));
  if (!invited.text) throw new Error('Подсказка в приглашении не пригласила: ' + invited.list);

  console.log('✔ подсказки: клавиатура, выбор, приглашение в канал');
});
