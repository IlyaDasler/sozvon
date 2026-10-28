// Большая голосовая комната через медиасервер LiveKit: пятеро слышат друг друга, звук зашифрован ключом
// комнаты (у всех один код), камера видна всем, выгнанного отключает и медиасервер.
// Нужны: LiveKit (livekit-server --dev) и наш сервер с LIVEKIT_URL=ws://127.0.0.1:7880 LIVEKIT_API_KEY=devkey
// LIVEKIT_API_SECRET=secret. Запуск: npx electron scripts/e2e-sfu.js [адрес сервера]
const { api, befriend, register, js, waitFor, sleep, openClient, tilePlaying, screenshot, runTest } = require('./e2e-lib');

runTest(async () => {
  const people = [];
  for (const [i, name] of ['Аня', 'Боря', 'Вика', 'Гоша', 'Дина'].entries()) people.push(await register(`sf${i}`, name));
  const [owner, ...rest] = people;
  const hub = await api('POST', '/hubs', { name: 'Большая компания' }, owner.token);
  for (const u of rest) {
    await befriend(owner, u);
    await api('POST', `/hubs/${hub.id}/invites`, { userIds: [u.user.id] }, owner.token);
    await api('POST', `/hub-invites/${hub.id}/accept`, null, u.token);
  }
  const room = await api('POST', '/rooms', { name: 'Общий голос', kind: 'voice', hubId: hub.id }, owner.token);
  const wins = [];
  for (const [i, u] of people.entries()) wins.push(await openClient(`sf${i}`, u));
  for (const win of wins) await waitFor(win, `e2eeReady() && Boolean(roomById(${room.id}))`, 'вход и ключ');
  console.log('✔ пятеро вошли, комната на пятерых');

  for (const win of wins) {
    await js(win, `joinRoomVoice(${room.id}); true`);
    await sleep(400);
  }
  const allIn = `state.room?.joined && state.room.session instanceof SfuSession && state.room.session.peers.size === 4`;
  for (const win of wins)
    await waitFor(win, allIn, 'все в голосе через медиасервер', 30000).catch(async (err) => {
      for (const w of wins)
        console.error(await js(w, `JSON.stringify({ me: state.me.id, joined: state.room?.joined, kind: state.room?.session?.constructor.name, peers: [...(state.room?.session?.peers.keys() || [])], lk: state.room?.session?.room?.state, remote: [...(state.room?.session?.room?.remoteParticipants.values() || [])].map((p) => p.identity), toast: document.getElementById('toast').textContent })`));
      throw err;
    });
  console.log('✔ голос идёт через медиасервер, каждый видит четверых');

  // Звук зашифрован, и у всех один код; звук доходит (по нему срабатывает «говорит»)
  for (const win of wins) if (!(await js(win, 'state.room.session.room.isE2EEEnabled'))) throw new Error('Голос через медиасервер не зашифрован');
  const codes = await Promise.all(wins.map((w) => js(w, 'JSON.stringify(state.room.session.code)')));
  if (codes.some((c) => c === 'null' || c !== codes[0])) throw new Error(`Коды шифрования разные: ${codes}`);
  for (const win of wins)
    await waitFor(win, `[...state.room.session.peers.values()].filter((p) => p.tracks.mic).length === 4`, 'микрофоны всех четверых', 20000);
  const heard = `(() => { window.heard ??= new Set(); for (const p of state.room.session.peers.values()) if (p.speaking) heard.add(p.id); return heard.size; })()`;
  for (const win of wins) await waitFor(win, `${heard} >= 3`, 'слышно остальных (расшифровка работает)', 30000);
  console.log('✔ звук зашифрован ключом комнаты, код у всех одинаковый, все слышат друг друга');

  // Камера Бори видна остальным
  await js(wins[1], 'toggleCamera(); true');
  for (const win of [wins[0], wins[2], wins[3], wins[4]]) await waitFor(win, tilePlaying(win, `u${people[1].user.id}`), 'камера Бори', 20000);
  await screenshot(wins[0], 'sfu-room');
  console.log('✔ камера одного видна всем');

  // Дину выгнали из комнаты — медиасервер её отключает, остальные видят троих
  await api('DELETE', `/rooms/${room.id}/members/${people[4].user.id}`, null, owner.token);
  await waitFor(wins[4], '!state.room', 'Дина вне голоса');
  for (const win of wins.slice(0, 4)) await waitFor(win, 'state.room.session.peers.size === 3', 'Дины нет у остальных', 20000);
  console.log('✔ выгнанную отключает и медиасервер');
});
