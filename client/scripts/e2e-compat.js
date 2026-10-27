// Совместимость со старыми версиями: звонок между текущей версией и старой (в обе стороны).
// Старую версию достаём из git:
//   mkdir old && git archive v1.4.0 client/renderer client/preload.js | tar -x -C old
// Запуск (сервер должен работать): E2E_OLD=old/client npx electron scripts/e2e-compat.js [адрес сервера]
const path = require('node:path');
const { api, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

const OLD = path.resolve(process.env.E2E_OLD || '');

// Звонок у старых версий устроен по-разному: до 1.5 — state.call.call (VoiceCall), с 1.5 — state.call.session
const connected = `(() => {
  const c = state.call;
  if (!c) return false;
  return c.session ? c.phase === 'connected' : c.call?.state === 'connected';
})()`;

const audioBytes = (win) =>
  js(
    win,
    `(async () => {
      const c = state.call;
      const pcs = c.session ? [...c.session.peers.values()].map((p) => p.link.pc) : [c.call.pc];
      let bytes = 0;
      for (const pc of pcs) (await pc.getStats()).forEach((s) => { if (s.type === 'inbound-rtp' && s.kind === 'audio') bytes += s.bytesReceived; });
      return bytes;
    })()`
  );

async function checkAudio(winA, winB, what) {
  const before = [await audioBytes(winA), await audioBytes(winB)];
  await sleep(2000);
  const after = [await audioBytes(winA), await audioBytes(winB)];
  if (!(after[0] > before[0] && after[1] > before[1])) throw new Error(`${what}: звук не идёт (${before} -> ${after})`);
}

async function call(from, to, toUser, label) {
  await js(from, `selectContact(${toUser.user.id}).then(() => startCall())`);
  await waitFor(to, `!document.getElementById('incoming').classList.contains('hidden')`, `${label}: входящий звонок`);
  await js(to, 'acceptIncoming()');
  await waitFor(from, connected, `${label}: соединение у звонящего`, 20000);
  await waitFor(to, connected, `${label}: соединение у отвечающего`, 20000);
  await checkAudio(from, to, label);
  // До 1.5 динамик играет первую звуковую дорожку из потока — это должен быть голос, а не пустой звук экрана
  for (const win of [from, to]) {
    const ok = await js(
      win,
      `(() => {
        if (state.call.session) return true;
        const played = document.getElementById('remote-audio').srcObject?.getAudioTracks()[0];
        return played === state.call.call.pc.getTransceivers()[0].receiver.track;
      })()`
    );
    if (!ok) throw new Error(`${label}: старая версия играет не ту дорожку`);
  }
  console.log(`✔ ${label}: соединились, звук идёт в обе стороны`);
}

runTest(async () => {
  if (!process.env.E2E_OLD) throw new Error('Укажите папку старой версии в E2E_OLD');
  const fresh = await register('cn', 'Новая');
  const old = await register('co', 'Старая');
  await api('POST', '/contacts', { username: old.user.username }, fresh.token);

  const winNew = await openClient('cn', fresh);
  const winOld = await openClient('co', old, OLD);
  console.log('✔ обе версии вошли и подключились');

  // Новая звонит старой; посреди звонка новая включает камеру — у старой звук не должен пропасть
  await call(winNew, winOld, old, 'новая → старая');
  await js(winNew, 'toggleCamera()');
  await sleep(2500);
  if (!(await js(winOld, connected))) throw new Error('После включения камеры у старой версии оборвался звонок');
  await checkAudio(winNew, winOld, 'после включения камеры');
  console.log('✔ камера у новой версии не ломает звонок со старой');
  await js(winNew, 'hangup()');
  await waitFor(winOld, 'state.call === null', 'завершение у старой');

  // Старая звонит новой
  await sleep(500);
  await call(winOld, winNew, fresh, 'старая → новая');
  await js(winOld, 'hangup()');
  await waitFor(winNew, 'state.call === null', 'завершение у новой');
  console.log('✔ звонок завершается у обеих');

  // Комнаты появились в 1.5: со старой версией 1.5+ сидим в одном голосовом канале
  if (!(await js(winOld, `typeof joinRoomVoice === 'function'`))) return console.log('  (в этой версии комнат ещё нет)');
  const roomId = await js(
    winNew,
    `Api.post('/rooms', { name: 'Совместимость', kind: 'voice', memberIds: [${old.user.id}] }).then((r) => { state.rooms.set(r.id, r); renderRooms(); return r.id; })`
  );
  await waitFor(winOld, `state.rooms.has(${roomId})`, 'комната у старой версии');
  await js(winNew, `openRoom(${roomId}); true`);
  await js(winOld, `joinRoomVoice(${roomId}); true`);
  for (const win of [winNew, winOld])
    await waitFor(win, `state.room?.joined && [...activeSession().peers.values()].some((p) => p.state === 'connected')`, 'голосовой канал', 20000);
  const roomBytes = (win) =>
    js(win, `(async () => { let b = 0; for (const p of activeSession().peers.values()) (await p.link.pc.getStats()).forEach((s) => { if (s.type === 'inbound-rtp' && s.kind === 'audio') b += s.bytesReceived; }); return b; })()`);
  const before = [await roomBytes(winNew), await roomBytes(winOld)];
  await sleep(2000);
  const after = [await roomBytes(winNew), await roomBytes(winOld)];
  if (!(after[0] > before[0] && after[1] > before[1])) throw new Error('В комнате со старой версией нет звука');
  console.log('✔ голосовой канал со старой версией: звук идёт в обе стороны');
});
