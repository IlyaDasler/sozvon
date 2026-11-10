// На телефоне действия сообщения открываются долгим нажатием, без hover.
const { api, register, befriend, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('msg' + Date.now().toString(36).slice(-4), 'Аня');
  const b = await register('msgb' + Date.now().toString(36).slice(-4), 'Борис');
  await befriend(a, b);
  const hub = await api('POST', '/hubs', { name: 'Мобильный' }, a.token);
  await api('POST', `/hubs/${hub.id}/members`, { userId: b.user.id }, a.token);
  const room = await api('POST', '/rooms', { hubId: hub.id, name: 'Общий чат', kind: 'text', memberIds: [b.user.id] }, a.token);
  const w = await openClient('msg', a);
  w.setSize(390, 844);
  w.show();
  w.focus();
  await sleep(700);
  await js(w, `openHub(${hub.id}); refreshRooms().then(() => openRoomChat(${room.id})); document.body.classList.remove('mobile-list'); true`);
  await sleep(500);
  await js(w, `(() => { const el=document.getElementById('room-message-input'); el.value='Привет'; document.getElementById('room-message-form').requestSubmit(); return true; })()`);
  await waitFor(w, `Boolean(document.querySelector('#room-messages .msg'))`, 'сообщение');
  await js(w, `(() => {
    const row=document.querySelector('#room-messages .msg');
    row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 7, clientX: 120, clientY: 300 }));
    return true;
  })()`);
  await waitFor(w, `document.body.classList.contains('mobile-msg-sheet')`, 'лист действий сообщения');
  const actions = await js(w, `document.querySelectorAll('#mobile-msg-sheet button').length`);
  const labels = await js(w, `JSON.stringify([...document.querySelectorAll('#mobile-msg-sheet button')].map(b=>b.textContent))`);
  if (/Shift|Ctrl|Alt|Esc|Enter|Cmd|⌘|клавиш/i.test(labels)) throw new Error(`в мобильном листе остались подсказки клавиш: ${labels}`);
  if (actions < 4) throw new Error(`в листе сообщения только ${actions} действий`);
  await js(w, `document.getElementById('mobile-msg-backdrop').click(); true`);
  await waitFor(w, `!document.body.classList.contains('mobile-msg-sheet')`, 'лист действий закрылся');

  // Тред и участники должны открываться поверх мобильного чата.
  await js(w, `document.querySelector('#room-messages .msg')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 8, clientX: 120, clientY: 300 })); true`);
  await waitFor(w, `document.body.classList.contains('mobile-msg-sheet')`, 'лист для треда');
  await js(w, `([...document.querySelectorAll('#mobile-msg-sheet button')].find(b => b.textContent === 'Обсудить сообщение'))?.click(); true`);
  await waitFor(w, `document.getElementById('thread-panel').classList.contains('thread-open')`, 'тред открылся');
  const thread = await js(w, `(() => { const r=document.getElementById('thread-panel').getBoundingClientRect(); return JSON.stringify({left:r.left,right:r.right,vw:innerWidth}); })()`);
  const tr = JSON.parse(thread);
  if (tr.left < -1 || tr.right > tr.vw + 1) throw new Error(`тред вылезает: ${thread}`);
  await js(w, `document.getElementById('thread-close')?.click(); true`);

  await js(w, `document.querySelector('#room-view .members-toggle')?.click(); true`);
  await sleep(400);
  const members = await js(w, `(() => { const p=document.getElementById('members-panel'); if(!p)return 'none'; const r=p.getBoundingClientRect(); return JSON.stringify({visible:getComputedStyle(p).display!=='none',left:r.left,right:r.right,vw:innerWidth}); })()`);
  const mp = JSON.parse(members);
  if (!mp.visible) throw new Error('панель участников не открылась');
  if (mp.left < -1 || mp.right > mp.vw + 1) throw new Error(`участники вылезают: ${members}`);

  console.log(`✔ долгое нажатие на сообщение: ${actions} действий, тред и участники вписываются`);
});
