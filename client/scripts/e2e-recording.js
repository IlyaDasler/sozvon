// Локальная запись звонка: файл должен появиться на диске, без сервера.
const fs = require('node:fs');
const path = require('node:path');
const { api, befriend, register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

const recDir = process.env.SOZVON_RECORDING_DIR;

runTest(async () => {
  const a = await register('recA', 'Аня');
  const b = await register('recB', 'Боря');
  await befriend(a, b);
  const hub = await api('POST', '/hubs', { name: 'Запись' }, a.token);
  await api('POST', `/hubs/${hub.id}/invites`, { userIds: [b.user.id] }, a.token);
  await api('POST', `/hub-invites/${hub.id}/accept`, null, b.token);
  const room = await api('POST', '/rooms', { hubId: hub.id, name: 'Запись', kind: 'voice' }, a.token);

  const winA = await openClient('recA', a);
  const winB = await openClient('recB', b);
  await js(winA, `openHub(${hub.id}); joinRoomVoice(${room.id}); true`);
  await js(winB, `openHub(${hub.id}); joinRoomVoice(${room.id}); true`);
  await waitFor(winA, 'Boolean(activeSession())', 'голосовая сессия Ани');
  await waitFor(winB, 'Boolean(activeSession())', 'голосовая сессия Бори');
  await waitFor(winA, 'Boolean(activeSession()?.local?.tracks?.mic)', 'микрофон Ани');
  await waitFor(winB, 'Boolean(activeSession()?.local?.tracks?.mic)', 'микрофон Бори');
  await waitFor(winA, 'activeSession()?.peers?.size > 0', 'собеседник в сессии Ани');
  await waitFor(winB, 'activeSession()?.peers?.size > 0', 'собеседник в сессии Бори');

  const before = new Set(fs.existsSync(recDir) ? fs.readdirSync(recDir) : []);
  await js(winA, `document.getElementById('call-record').click(); true`);
  await waitFor(winA, 'CallRecorder.active', 'запись началась');
  await sleep(1200);
  await sleep(1000);
  await js(winA, `document.getElementById('call-record').click(); true`);
  await waitFor(winA, '!CallRecorder.active', 'запись остановлена');

  const files = (fs.existsSync(recDir) ? fs.readdirSync(recDir) : []).filter((f) => f.endsWith('.webm') && !before.has(f));
  if (!files.length) throw new Error('файл записи не появился');
  const file = path.join(recDir, files[0]);
  const size = fs.statSync(file).size;
  if (size < 1000) throw new Error(`запись слишком маленькая: ${size} байт`);
  console.log(`✔ запись звонка: ${files[0]} (${size} байт)`);
});
