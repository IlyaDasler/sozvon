const { api, register, befriend, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('ga' + Date.now().toString(36).slice(-5), 'Илья');
  const b = await register('gb' + Date.now().toString(36).slice(-5), 'Вася');
  await befriend(a, b);
  const hub = await api('POST', '/hubs', { name: 'Группы' }, a.token);
  await api('POST', `/hubs/${hub.id}/members`, { userId: b.user.id }, a.token).catch(() => {});
  const one = await api('POST', '/rooms', { hubId: hub.id, name: 'Голос 1', kind: 'voice', memberIds: [b.user.id] }, a.token);
  const two = await api('POST', '/rooms', { hubId: hub.id, name: 'Голос 2', kind: 'voice', memberIds: [b.user.id] }, a.token);
  await api('POST', `/hubs/${hub.id}/groups`, { name: 'ПРОВЕРКА', roomIds: [one.id, two.id] }, a.token);

  const winA = await openClient('ga' + Date.now().toString(36).slice(-5), a);
  await waitFor(winA, 'e2eeReady()', 'вход А');
  await js(winA, `joinRoomVoice(${one.id}); true`);
  await sleep(1200);

  // Новый клиент должен увидеть участника в голосовой комнате сразу, без входа в неё
  const winB = await openClient('gb' + Date.now().toString(36).slice(-5), b);
  await waitFor(winB, 'e2eeReady()', 'вход Б');
  await js(winB, `refreshRooms().then(() => true)`);
  await sleep(800);
  const voice = await js(winB, `JSON.stringify((roomById(${one.id})?.voice || []).map((p) => p.userId))`);
  if (!JSON.parse(voice).includes(a.user.id)) throw new Error(`В комнате группы не видно участника: ${voice}`);

  // Группа видна у второго клиента
  const grouped = await js(winB, `JSON.stringify((state.hubs.get(${hub.id})?.groups || []).map((g) => g.name))`);
  if (!grouped.includes('ПРОВЕРКА')) throw new Error(`Группа не загрузилась: ${grouped}`);

  // Убираем по одной комнате: после последней группа должна исчезнуть
  await api('PATCH', `/rooms/${one.id}`, { groupId: null }, a.token);
  let groups = await api('GET', '/hubs', null, a.token);
  let found = (groups.find((h) => h.id === hub.id)?.groups || []).some((g) => g.name === 'ПРОВЕРКА');
  if (!found) throw new Error('Группа исчезла раньше времени');
  await api('PATCH', `/rooms/${two.id}`, { groupId: null }, a.token);
  groups = await api('GET', '/hubs', null, a.token);
  found = (groups.find((h) => h.id === hub.id)?.groups || []).some((g) => g.name === 'ПРОВЕРКА');
  if (found) throw new Error('Пустая группа осталась после разделения');

  console.log('✔ группа: участники голоса видны до входа, пустая группа удаляется');
});
