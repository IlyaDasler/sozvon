// Токен и ключ шифрования лежат на диске зашифрованными средствами системы; старые открытые записи переходят сами,
// вход и ключ после перезапуска целы. Запуск (сервер должен работать): npx electron scripts/e2e-vault.js [адрес сервера]
const { befriend, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

const ready = `e2eeReady() && document.getElementById('conn-dot').classList.contains('ok')`;
const raw = `JSON.stringify(Object.fromEntries(Object.entries(localStorage)))`;

runTest(async () => {
  const a = await register('vla', 'Аня');
  const b = await register('vlb', 'Боря');
  await befriend(a, b);
  // openClient кладёт сессию открытым текстом — как приложение версий до 2.7
  const win = await openClient('vla', a);
  await waitFor(win, ready, 'вход');
  await sleep(300);

  const stored = await js(win, raw);
  if (stored.includes(a.token)) throw new Error('Токен на диске открытым текстом');
  if (stored.includes('"d\\"') || stored.includes('privateJwk')) throw new Error('Закрытый ключ на диске открытым текстом');
  console.log('✔ токен и ключ на диске зашифрованы, старая запись перешла сама');

  const key = await js(win, 'e2ee.identity.publicKey');
  await js(win, 'location.reload()').catch(() => {});
  await sleep(1500);
  await waitFor(win, ready, 'перезапуск');
  if ((await js(win, 'state.me.id')) !== a.user.id) throw new Error('После перезапуска другой вход');
  if ((await js(win, 'e2ee.identity.publicKey')) !== key) throw new Error('После перезапуска другой ключ');
  console.log('✔ после перезапуска вход и ключ на месте');

  // Запись нельзя открыть (папку скопировали на другой компьютер): просто экран входа, без падения
  await js(win, `(() => { const s = JSON.parse(localStorage.getItem('session')); s.vault = 'мусор'; localStorage.setItem('session', JSON.stringify(s)); location.reload(); })()`).catch(() => {});
  await sleep(1500);
  await waitFor(win, `!document.getElementById('auth-form').closest('.hidden')`, 'экран входа после порченой записи');
  console.log('✔ запись не открылась — экран входа, а не падение');
});
