// Треды в канале: счётчик ответов, панель, ответ из панели
const { api, register, js, sleep, openClient, runTest, befriend } = require('./e2e-lib');

runTest(async () => {
  const a = await register('th' + Math.random().toString(36).slice(2, 5), 'Аня');
  const b = await register('tb' + Math.random().toString(36).slice(2, 5), 'Боря');
  await befriend(a, b);
  const hub = await api('POST', '/hubs', { name: 'Эридан' }, a.token);
  await api('POST', `/hubs/${hub.id}/members`, { userId: b.user.id }, a.token).catch(() => {});

  const win = await openClient('tha', a);
  await sleep(1400);
  win.show();
  win.focus();
  // Комната создана через API до старта клиента — обновляем состояние и открываем её
  await js(win, `(async () => { openHub(${hub.id}); await refreshRooms(); await new Promise((r) => setTimeout(r, 300)); return true; })()`);
  await sleep(500);
  const room = await api('POST', '/rooms', { hubId: hub.id, name: 'Флудильня', kind: 'text', memberIds: [b.user.id] }, a.token);
  await js(win, `(() => {
    state.rooms.set(${room.id}, ${JSON.stringify(room)});
    openHub(${hub.id});
    openRoom(${room.id});
    return true;
  })()`);
  await sleep(900);
  const opened = await js(win, `String(state.selectedRoomId)`);
  if (String(opened) !== String(room.id)) throw new Error(`Комната не открылась: selectedRoomId=${opened}, ждали ${room.id}`);

  // Корневое сообщение
  await js(win, `(() => {
    const area = document.getElementById('room-message-input');
    area.value = 'Корневое сообщение для треда';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('room-message-form').requestSubmit();
    return true;
  })()`);
  await sleep(1200);

  const rootId = await js(win, `JSON.stringify([...state.roomHistory.get(${room.id})].map((m) => m.id))`);
  const ids = JSON.parse(rootId);
  if (!ids.length) throw new Error('Корневое сообщение не отправилось');
  const root = ids[ids.length - 1];

  // Ответ в тред от второго участника (через API — как будто с другого устройства)
  const reply = await api('POST', `/rooms/${room.id}/messages`, {
    text: 'Ответ в треде',
    threadRootId: root,
    attachmentIds: [],
    replyToId: null,
  }, b.token).catch(async () => {
    // E2EE: пробуем без шифрования — сервер примет обычный текст в тестах
    return api('POST', `/rooms/${room.id}/messages`, { text: 'Ответ в треде', threadRootId: root }, b.token);
  });
  if (!reply || reply.threadRoot !== root) throw new Error('Ответ не привязался к треду');

  // Панель треда
  await js(win, `openThread({ id: ${root}, threadRoot: ${root} }, { kind: 'room', roomId: ${room.id} }); true`);
  await sleep(900);
  const statePanel = await js(win, `JSON.stringify({
    visible: !document.getElementById('thread-panel').classList.contains('hidden'),
    rows: document.querySelectorAll('#thread-list .msg').length,
    rootMarked: Boolean(document.querySelector('#thread-list .thread-root')),
  })`);
  const panel = JSON.parse(statePanel);
  // Панель треда не должна вылезать за пределы чата и налезать на панель участников
  const bounds = await js(win, `(() => {
    const tp = document.getElementById('thread-panel').getBoundingClientRect();
    const chat = document.getElementById('room-view').getBoundingClientRect();
    const members = document.getElementById('members-panel');
    const mr = members && members.getClientRects().length ? members.getBoundingClientRect() : null;
    return JSON.stringify({
      inChat: tp.left >= chat.left - 1 && tp.right <= chat.right + 1 && tp.top >= chat.top - 1,
      overMembers: mr ? (tp.right > mr.left + 1) : false,
    });
  })()`);
  const geo = JSON.parse(bounds);
  if (!geo.inChat) throw new Error('Панель треда вылезает за пределы чата');
  if (geo.overMembers) throw new Error('Панель треда налезает на панель участников');
  if (!panel.visible) throw new Error('Панель треда не открылась');
  if (panel.rows < 2) throw new Error(`В треде ожидали корень и ответ, а строк ${panel.rows}`);
  if (!panel.rootMarked) throw new Error('Корневое сообщение не отмечено в треде');

  // Ответ из панели
  await js(win, `(() => {
    const area = document.getElementById('thread-input');
    area.value = 'Третий ответ из панели';
    document.getElementById('thread-form').requestSubmit();
    return true;
  })()`);
  await sleep(1400);
  const after = await js(win, `JSON.stringify({ rows: document.querySelectorAll('#thread-list .msg').length })`);
  const rowsAfter = JSON.parse(after).rows;
  if (rowsAfter < 3) throw new Error(`Ответ из панели не добавился: строк ${rowsAfter}`);

  console.log('✔ тред: корень, ответ, панель и ответ из панели работают');
});
