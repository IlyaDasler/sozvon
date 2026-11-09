// Входящий звонок приходит на все устройства одного человека. После ответа
// на одном устройстве остальные обязаны перестать звонить, а не продолжать
// мигать «входящий».
const { befriend, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('mda', 'Аня');
  const b = await register('mdb', 'Боря');
  await befriend(a, b);

  const winA = await openClient('mda', a);
  const winB1 = await openClient('mdb1', b);
  const winB2 = await openClient('mdb2', b);
  await sleep(800);

  await js(winA, `selectContact(${b.user.id}).then(() => startCall())`);
  await waitFor(winB1, `!document.getElementById('incoming').classList.contains('hidden')`, 'входящий на первом устройстве Б', 10000);
  await waitFor(winB2, `!document.getElementById('incoming').classList.contains('hidden')`, 'входящий на втором устройстве Б', 10000);
  console.log('✔ звонок пришёл на оба устройства Б');

  await js(winB1, 'acceptIncoming()');
  await waitFor(winA, `state.call?.phase === 'connected'`, 'Аня соединилась', 20000);
  await waitFor(winB1, `state.call?.phase === 'connected'`, 'первое устройство Б соединилось', 20000);
  await waitFor(winB2, `document.getElementById('incoming').classList.contains('hidden') && state.incoming === null`, 'второе устройство Б перестало звонить', 10000);
  console.log('✔ после ответа на первом устройстве второе устройство перестало звонить');

  await js(winA, 'hangup(); true');
  await waitFor(winB1, 'state.call === null', 'звонок завершён у первого устройства', 10000);
  console.log('✔ звонок завершается штатно');
});
