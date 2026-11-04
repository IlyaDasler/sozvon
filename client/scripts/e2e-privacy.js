// Данные и конфиденциальность: раздел в настройках, сохранение на сервере,
// запрет заявок и приглашений и восстановление настроек после перезапуска.
const { api, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

const check = (condition, message) => { if (!condition) throw new Error(message); };

runTest(async () => {
  const a = await register('pra' + Math.random().toString(36).slice(2, 5), 'Аня');
  const b = await register('prb' + Math.random().toString(36).slice(2, 5), 'Боря');
  const win = await openClient('pra', a);
  win.show();
  await waitFor(win, 'e2eeReady()', 'готово', 20000);

  await js(win, `openSettings('privacy'); true`);
  await sleep(400);
  const tabs = await js(win, `[...document.querySelectorAll('#set-nav [data-tab]')].map((b) => b.dataset.tab)`);
  check(tabs.includes('privacy'), 'в настройках нет «Данные и конфиденциальность»');
  const subpages = await js(win, `[...document.querySelectorAll('#privacy-subnav [data-privacy]')].map((b) => b.dataset.privacy)`);
  check(subpages.join() === 'data,profile,contact,crypto', 'подразделы приватности: ' + subpages.join());
  const footer = await js(win, `getComputedStyle(document.querySelector('#settings .set-foot')).display`);
  check(footer === 'none', 'в приватности остался блок «Сохранить»: ' + footer);

  // Выключаем игру и заявки, приглашения — только от друзей
  await js(win, `showPrivacyPage('profile'); document.querySelector('[data-privacy-toggle="gameActivity"]').click(); true`);
  await waitFor(win, 'state.me.privacy.gameActivity === false', 'игра скрыта');
  await js(win, `showPrivacyPage('contact'); document.querySelector('[data-privacy-toggle="friendRequests"]').click(); true`);
  await waitFor(win, 'state.me.privacy.friendRequests === false', 'заявки закрыты');
  await js(win, `(() => { const s = document.getElementById('privacy-invites'); s.value = 'friends'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitFor(win, `state.me.privacy.invitePolicy === 'friends'`, 'приглашения только от друзей');
  const server = await js(win, `Api.get('/me').then((me) => me.privacy)`);
  check(server.gameActivity === false && server.friendRequests === false && server.invitePolicy === 'friends', 'настройки не сохранились на сервере');

  // Заявку от Бори сервер больше не принимает
  const request = await api('POST', '/contacts', { username: a.user.username }, b.token).then(() => 'ок', (e) => e.message);
  check(request !== 'ок', 'заявка прошла при выключенных заявках');

  // Приглашение в канал — только от друзей (Боря с Аней не друзья)
  const hub = await api('POST', '/hubs', { name: 'Приватность' }, b.token);
  const invite = await api('POST', `/hubs/${hub.id}/invites`, { userIds: [a.user.id] }, b.token).then(() => 'ок', (e) => e.message);
  check(invite !== 'ок', 'приглашение прошло при политике «только друзья»');

  // Перезагрузка: настройки восстанавливаются из сервера
  await js(win, 'location.reload()').catch(() => {});
  await sleep(1500);
  await waitFor(win, 'e2eeReady()', 'перезапуск');
  const saved = await js(win, `state.me.privacy`);
  check(saved.gameActivity === false && saved.friendRequests === false && saved.invitePolicy === 'friends', 'после перезагрузки настройки потерялись');
  await js(win, `openSettings('privacy'); showPrivacyPage('profile'); true`);
  await sleep(400);
  const checked = await js(win, `document.querySelector('[data-privacy-toggle="gameActivity"]').checked`);
  check(checked === false, 'переключатель после перезагрузки показывает неверное значение');
  console.log('✔ приватность: раздел, сохранение, запреты и перезапуск');
});
