// Сквозной тест группового звонка: Аня звонит Боре, потом зовёт Вову. Код шифрования у всех одинаковый,
// значок звонка в столбце, звук идёт между всеми, выход одного звонок не рвёт.
// Запуск (сервер должен работать): npx electron scripts/e2e-group-call.js [адрес сервера]
const { befriend, register, js, waitFor, sleep, openClient, received, screenshot, runTest } = require('./e2e-lib');

const codeOf = (win) => js(win, `activeSession()?.code ? activeSession().code.emoji.join('') + ' ' + activeSession().code.digits : null`);

runTest(async () => {
  const a = await register('ga', 'Аня');
  const b = await register('gb', 'Боря');
  const c = await register('gc', 'Вова');
  await befriend(a, b);
  await befriend(a, c);
  const winA = await openClient('ga', a);
  const winB = await openClient('gb', b);
  const winC = await openClient('gc', c);

  // Звонок на двоих: значок в столбце, одинаковый код
  await js(winA, `selectContact(${b.user.id}).then(() => startCall())`);
  await waitFor(winB, `!document.getElementById('incoming').classList.contains('hidden')`, 'входящий у Бори');
  await js(winB, 'acceptIncoming()');
  for (const w of [winA, winB]) await waitFor(w, `state.call?.phase === 'connected' && !document.getElementById('rail-call-item').classList.contains('hidden')`, 'соединение и значок в столбце');
  await waitFor(winA, `Boolean(activeSession().code)`, 'код у Ани');
  await waitFor(winB, `Boolean(activeSession().code)`, 'код у Бори');
  const pairCode = await codeOf(winA);
  if (pairCode !== (await codeOf(winB))) throw new Error(`Коды разные: ${pairCode} / ${await codeOf(winB)}`);
  if (!(await js(winA, `!document.getElementById('call-code').classList.contains('hidden') && document.getElementById('call-code').textContent.includes(activeSession().code.digits)`)))
    throw new Error('Код не показан в строке разговора');
  console.log(`✔ звонок на двоих: значок в столбце, код шифрования одинаковый — ${pairCode}`);

  // Аня зовёт Вову через «Добавить в звонок»
  await js(winA, `document.getElementById('call-add').click(); true`);
  await waitFor(winA, `!document.getElementById('call-add-modal').classList.contains('hidden')`, 'окно «Добавить в звонок»');
  await screenshot(winA, 'group-add');
  await js(winA, `[...document.querySelectorAll('#call-add-list .member-row')].find((r) => r.textContent.includes('Вова')).querySelector('button').click(); true`);
  await waitFor(winC, `!document.getElementById('incoming').classList.contains('hidden') && document.getElementById('incoming-sub').textContent.includes('Боря')`, 'приглашение у Вовы со списком');
  await screenshot(winC, 'group-incoming');
  await js(winC, 'acceptIncoming()');
  const allConnected = `activeSession()?.peers.size === 2 && [...activeSession().peers.values()].every((p) => p.state === 'connected')`;
  for (const w of [winA, winB, winC]) await waitFor(w, allConnected, 'все соединены со всеми', 20000);
  console.log('✔ Вова принял приглашение — все трое соединены друг с другом');

  // Код теперь общий для троих и отличается от кода на двоих
  for (const w of [winA, winB, winC]) await waitFor(w, `Boolean(activeSession().code)`, 'код у всех');
  const codes = [await codeOf(winA), await codeOf(winB), await codeOf(winC)];
  if (new Set(codes).size !== 1) throw new Error(`Коды у троих разные: ${codes.join(' / ')}`);
  if (codes[0] === pairCode) throw new Error('Код не поменялся, когда пришёл третий');
  console.log(`✔ код шифрования у всех троих одинаковый — ${codes[0]}`);

  // Звук идёт от каждого к каждому
  const flows = async () => Promise.all([winA, winB, winC].map((w) => received(w)));
  const before = await flows();
  await sleep(2000);
  const after = await flows();
  for (let i = 0; i < 3; i++)
    for (const id of Object.keys(after[i])) if (!(after[i][id].audio > before[i][id].audio)) throw new Error(`Звук не идёт: окно ${i}, от ${id}`);
  await screenshot(winA, 'group-call');
  console.log('✔ звук идёт между всеми троими');

  // Боря уходит — у Ани и Вовы звонок продолжается; Аня уходит — у Вовы звонок закончен
  await js(winB, 'hangup()');
  for (const w of [winA, winC]) await waitFor(w, `activeSession()?.peers.size === 1 && state.call !== null`, 'звонок без Бори');
  await js(winA, 'hangup()');
  await waitFor(winC, `state.call === null && document.getElementById('rail-call-item').classList.contains('hidden')`, 'звонок закончился у Вовы');
  console.log('✔ выход одного звонок не рвёт; остался один — звонок закончен, значок пропал');
});
