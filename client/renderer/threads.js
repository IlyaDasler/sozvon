// Треды в каналах: обсуждение сообщения в отдельной панели, чтобы не спамить в общий чат.
// Сервер уже умеет: ответы живут отдельными строками, лента комнаты их не показывает,
// уведомления уходят только участникам треда, @all расширяет рассылку на всех.
(() => {
  let thread = null; // { rootId, roomId }
  let editing = null; // правка сообщения прямо в треде
  let savedWidth = ''; // ширина треда до разворота
  let baseWidth = 0; // исходная ширина: меньше неё тред не сжать
  let threadReply = null; // ответ на сообщение внутри обсуждения
  let rowCache = []; // сообщения открытого обсуждения — для точечного обновления без перезагрузки

  const panel = () => document.getElementById('thread-panel');
  const isThreadOpen = () => Boolean(thread) && Boolean(panel()) && !panel().classList.contains('hidden');
  const listEl = () => document.getElementById('thread-list');
  const headEl = () => document.getElementById('thread-title');
  const form = () => document.getElementById('thread-form');
  const input = () => document.getElementById('thread-input');

  /** Правка сообщения в треде: текст уходит в поле ответа, кнопка меняется на «Сохранить» */
  function editThreadMessage(m, chat) {
    editing = { m, chat };
    const area = input();
    if (!area) return;
    area.value = m.plain?.text || '';
    area.focus();
    const btn = document.getElementById('thread-send');
    if (btn) btn.title = '\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c';
    setComposerEnabled(true);
  }

  function cancelThreadEdit() {
    if (!editing) return;
    editing = null;
    const area = input(); if (area) area.value = '';
    const btn = document.getElementById('thread-send');
    if (btn) btn.title = '\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c';
  }

  /** Полоса «ответ на сообщение» над полем обсуждения */
  function replyBarEl() {
    let bar = document.getElementById('thread-reply');
    if (bar) return bar;
    const f = form();
    if (!f) return null;
    bar = document.createElement('div');
    bar.id = 'thread-reply';
    bar.className = 'reply-bar hidden';
    f.before(bar);
    return bar;
  }

  function renderThreadReply() {
    const bar = replyBarEl();
    if (!bar) return;
    if (!threadReply) {
      bar.classList.add('hidden');
      bar.replaceChildren();
      return;
    }
    const author = userById(threadReply.fromId) || { displayName: '?' };
    const name = document.createElement('b');
    name.textContent = author.displayName;
    const text = document.createElement('span');
    text.textContent = threadReply.text || 'вложение';
    const close = document.createElement('button');
    close.type = 'button';
    close.title = 'Отменить ответ';
    close.textContent = '×';
    close.onclick = () => {
      threadReply = null;
      renderThreadReply();
    };
    bar.replaceChildren(name, text, close);
    bar.classList.remove('hidden');
  }

  /** Ответить в обсуждении: цитата попадёт в это же обсуждение */
  function replyInThread(m) {
    if (!m) return;
    threadReply = { id: m.id, fromId: m.fromId, text: m.plain?.text || '' };
    renderThreadReply();
    input()?.focus();
  }

  function threadActions(roomId) {
    return (
      state.roomActions || {
        chat: { kind: 'room', roomId },
        canDelete: (m) => m.fromId === state.me.id,
        remove: (m) => Api.del(`/rooms/${roomId}/messages/${m.id}`),
        older: () => {},
      }
    );
  }

  function paint(rows, roomId) {
    const box = listEl();
    if (!box) return;
    box.innerHTML = '';
    rowCache = rows;
    if (!rows.length) {
      box.innerHTML = '<div class="thread-empty muted small">Сообщений в обсуждении пока нет</div>';
      return;
    }
    const root = rows[0];
    // Кто участвует в треде — для аватарок под корневым сообщением
    const participants = [...new Set(rows.map((m) => m.fromId))];
    const cachedRoot = (state.roomHistory.get(roomId) || []).find((m) => m.id === root.id);
    if (cachedRoot) {
      cachedRoot.threadUsers = participants.slice(0, 5);
      cachedRoot.threadUserCount = participants.length;
      cachedRoot.replies = Math.max(0, rows.length - 1);
    }
    const actions = { ...threadActions(roomId), scope: 'thread' };
    let prev = null;
    for (const m of rows) {
      const shown = messageRow(m, prev, rows, actions, null, false);
      if (m.id === root.id) shown.row.classList.add('thread-root');
      box.append(shown.row);
      prev = m;
    }
    box.scrollTop = box.scrollHeight;
    // Участники треда сразу видны под корневым сообщением в ленте канала,
    // не дожидаясь, пока кто-то напишет ответ
    if (state.selectedRoomId === roomId && typeof renderRoomMessages === 'function') renderRoomMessages();
  }

  function appendThreadRow(m) {
    const box = listEl();
    if (!box || !thread) return;
    box.querySelector('.thread-empty')?.remove();
    const actions = { ...threadActions(thread.roomId), scope: 'thread' };
    const prev = rowCache.at(-1) || null;
    rowCache.push(m);
    const shown = messageRow(m, prev, rowCache, actions, null, true);
    box.append(shown.row);
    box.scrollTop = box.scrollHeight;
  }

  function updateThreadRow(m) {
    const box = listEl();
    if (!box || !thread) return;
    const idx = rowCache.findIndex((x) => x.id === m.id);
    if (idx < 0) return;
    const actions = { ...threadActions(thread.roomId), scope: 'thread' };
    const prev = idx ? rowCache[idx - 1] : null;
    rowCache[idx] = m;
    const shown = messageRow(m, prev, rowCache, actions, null, false);
    const old = box.querySelectorAll('.msg')[idx];
    if (old) old.replaceWith(shown.row);
    else box.append(shown.row);
  }

  /** Сообщение удалили — убираем строку из открытого обсуждения */
  function removeThreadRow(id) {
    if (!thread) return;
    if (id === thread.rootId) {
      rowCache = [];
      closeThread();
      return;
    }
    const idx = rowCache.findIndex((m) => m.id === id);
    if (idx < 0) return;
    const old = listEl()?.querySelectorAll('.msg')[idx];
    rowCache.splice(idx, 1);
    old?.remove();
  }

  /** Поле ответа доступно только если сервер умеет треды */
  function setComposerEnabled(on) {
    const area = input();
    const btn = document.getElementById('thread-send');
    if (area) {
      area.disabled = !on;
      area.placeholder = on ? 'Ответить в обсуждении' : 'Обсуждения недоступны на этом сервере';
    }
    if (btn) btn.disabled = !on;
  }

  async function openThread(message, chat) {
    const roomId = chat.roomId || message.roomId;
    const rootId = message.threadRoot || message.id;
    thread = { rootId, roomId };
    panel().classList.remove('hidden');
    panel().classList.add('thread-open');
    renderThreadReply();
    // Запоминаем исходную ширину: растянуть можно, сжать меньше исходной — нет
    if (!panel().style.width && !baseWidth) {
      baseWidth = Math.round(panel().getBoundingClientRect().width) || 360;
    }
    if (headEl()) headEl().textContent = 'Обсуждение';
    listEl().innerHTML = '<div class="thread-empty muted small">Загружаем обсуждение…</div>';
    try {
      const rows = await Api.get(`/rooms/${roomId}/messages/${rootId}/thread`);
      const known = new Map((state.roomHistory.get(roomId) || []).map((m) => [m.id, m]));
      for (const m of rows) {
        const cached = known.get(m.id);
        if (cached?.plain && !m.plain) m.plain = cached.plain;
      }
      if (typeof decryptMessages === 'function' && typeof roomConvOf === 'function') {
        try { await decryptMessages(rows, roomConvOf(roomId)); } catch {}
      }
      paint(rows, roomId);
      thread.unsupported = false;
      setComposerEnabled(true);
      input()?.focus();
    } catch (err) {
      // Старый сервер не знает про треды: не показываем «не найдено», объясняем причину
      // и ГЛУШИМ отправку, чтобы ответ не улетел обычным сообщением в общий чат
      const oldServer = /не найдено|not found|404/i.test(err.message || '');
      thread.unsupported = oldServer;
      setComposerEnabled(!oldServer);
      listEl().innerHTML = oldServer
        ? '<div class="thread-empty muted small">Обсуждения появятся после обновления сервера до 3.0</div>'
        : `<div class="error small">${err.message}</div>`;
    }
  }

  function closeThread() {
    thread = null;
    threadReply = null;
    renderThreadReply();
    panel()?.classList.add('hidden');
    panel()?.classList.remove('thread-open');
  }

  // ---------- Упоминания в треде ----------
  // В треде тот же @username, что и в комнате, но поле своё — поэтому подсказка живёт здесь.
  let mentions = null; // { list, index, start }

  function mentionBox() {
    let box = document.getElementById('thread-mentions');
    if (box) return box;
    const f = form();
    if (!f) return null;
    box = document.createElement('div');
    box.id = 'thread-mentions';
    box.className = 'mention-popup hidden';
    f.append(box);
    return box;
  }

  function mentionCandidates(query) {
    const room = roomById(thread?.roomId);
    const q = String(query || '').toLowerCase();
    const people = (room?.members || []).filter((u) => u.id !== state.me?.id);
    const found = people.filter((u) =>
      String(u.username || '').toLowerCase().includes(q) ||
      String(u.displayName || '').toLowerCase().includes(q)
    );
    const list = found.slice(0, 7).map((u) => ({ ...u, all: false }));
    if (!q || 'all'.includes(q)) list.unshift({ username: 'all', displayName: 'Все в канале', all: true });
    return list;
  }

  function closeMentions() {
    mentions = null;
    mentionBox()?.classList.add('hidden');
  }

  function renderMentions() {
    const box = mentionBox();
    if (!box) return;
    box.replaceChildren();
    if (!mentions?.list.length) return closeMentions();
    mentions.list.forEach((u, i) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `mention-item${i === mentions.index ? ' active' : ''}`;
      if (u.all) {
        item.innerHTML = '<span class="avatar micro" style="background:var(--bg-4);color:var(--text)">@</span>';
        const text = document.createElement('span');
        text.innerHTML = '<b>@all</b> <span class="muted small">все в канале</span>';
        item.append(text);
      } else {
        item.append(makeAvatar(u, undefined, 'tiny'));
        const text = document.createElement('span');
        text.innerHTML = '<b></b> <span class="muted small"></span>';
        text.querySelector('b').textContent = u.displayName || u.username;
        text.querySelector('span').textContent = `@${u.username}`;
        item.append(text);
      }
      item.onmousedown = (e) => { e.preventDefault(); pickMention(u); };
      box.append(item);
    });
    box.classList.remove('hidden');
  }

  function updateMentions() {
    const area = input();
    if (!area || !thread) return closeMentions();
    const before = area.value.slice(0, area.selectionStart);
    const match = before.match(/(?:^|\s)@([a-z0-9_.-]{0,32})$/i);
    if (!match) return closeMentions();
    const list = mentionCandidates(match[1]);
    if (!list.length) return closeMentions();
    mentions = { list, index: 0, start: before.length - match[1].length - 1 };
    renderMentions();
  }

  function mentionKey(e) {
    if (!mentions) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = mentions.list.length;
      mentions.index = (mentions.index + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      renderMentions();
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pickMention(mentions.list[mentions.index]);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMentions();
      return true;
    }
    return false;
  }

  function pickMention(user) {
    const area = input();
    if (!area || !user) return;
    const at = mentions?.start ?? area.selectionStart;
    const after = area.value.slice(area.selectionStart);
    const insert = `@${user.username} `;
    area.value = area.value.slice(0, at) + insert + after;
    const caret = at + insert.length;
    area.setSelectionRange(caret, caret);
    closeMentions();
    area.focus();
  }

  async function sendReply() {
    if (!thread) return;
    const area = input();
    const text = area.value.trim();
    if (editing) {
      const next = area.value.trim();
      if (!next) return;
      const target = editing;
      editing = null;
      const sendBtn = document.getElementById('thread-send');
      if (sendBtn) sendBtn.title = '\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c';
      try {
        await saveEdit(target.m, target.chat, next);
        area.value = '';
        // Строку обновляем на месте: список не перезагружаем, чтобы он не мигал
        updateThreadRow(target.m);
        if (typeof renderRoomMessages === 'function') renderRoomMessages();
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    if (!text) return;
    area.value = '';
    area.style.height = '';
    const quoted = threadReply;
    try {
      const { body, plain } = await encryptOutgoing(roomConvOf(thread.roomId), { text, reply: quoted });
      body.threadRootId = thread.rootId;
      // @all внутри треда: сервер разошлёт всем участникам канала, а не только треду
      if (/@all\b/i.test(text)) body.mentionAll = true;
      // Кого именно позвали: сервер пришлёт им событие, даже если они ещё не в треде
      const mentioned = typeof findMentions === 'function' ? findMentions(text) : [];
      const mentionIds = (roomById(thread.roomId)?.members || [])
        .filter((u) => u.id !== state.me?.id && mentioned.includes(String(u.username || '').toLowerCase()))
        .map((u) => u.id);
      if (mentionIds.length) body.mentionIds = mentionIds;
      const saved = await Api.post(`/rooms/${thread.roomId}/messages`, body);
      const msg = { ...saved, plain, roomId: thread.roomId };
      const history = state.roomHistory.get(thread.roomId);
      // Ответ на сообщение внутри обсуждения: полоса цитаты больше не нужна
      if (quoted) {
        threadReply = null;
        renderThreadReply();
      }
      // В общую ленту не добавляем: ответ живёт только в треде.
      // В список добавляем сразу, без перезагрузки — он не должен мигать
      appendThreadRow(msg);
      const root = history?.find((m) => m.id === thread.rootId);
      // Сервер уже вернул точное число ответов. Не прибавляем +1: это давало
      // 6 вместо 5, когда событие треда и ответ на запрос приходили оба.
      if (root && Number.isFinite(Number(saved.replies))) root.replies = Number(saved.replies);
      if (typeof renderRoomMessages === 'function') renderRoomMessages();
    } catch (err) {
      toast(err.message);
      area.value = text;
    }
  }

  /** Развернуть тред на весь чат и вернуть обратно */
  function toggleThreadFull() {
    const p = panel();
    if (!p) return;
    const full = p.classList.toggle('thread-full');
    if (full) { savedWidth = p.style.width; p.style.width = ''; }
    else if (savedWidth) { p.style.width = savedWidth; savedWidth = ''; }
    const btn = document.getElementById('thread-expand');
    if (btn) {
      btn.title = full ? 'Свернуть' : 'Развернуть на весь чат';
      btn.innerHTML = full
        ? '<svg viewBox="0 0 24 24"><path d="M9 3v4a2 2 0 0 1-2 2H3M15 3v4a2 2 0 0 0 2 2h4M9 21v-4a2 2 0 0 0-2-2H3M15 21v-4a2 2 0 0 1 2-2h4"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
    }
  }

  /** Файлы и гифки в треде: шифруем, загружаем и отправляем ответом в тред */
  async function sendThreadFiles(files) {
    if (!thread || !files.length) return;
    const rootId = thread.rootId;
    const roomId = thread.roomId;
    try {
      for (const file of files) {
        const { done } = uploadEncrypted(file, () => {});
        const attachment = await done;
        const { body, plain } = await encryptOutgoing(roomConvOf(roomId), { text: '', files: [attachment] });
        body.threadRootId = rootId;
        const saved = await Api.post(`/rooms/${roomId}/messages`, body);
        // Тред мог закрыться или смениться, пока файл загружался
        if (!thread || thread.rootId !== rootId) continue;
        appendThreadRow({ ...saved, plain, roomId });
      }
      if (typeof renderRoomMessages === 'function') renderRoomMessages();
    } catch (err) {
      toast(err.message);
    }
  }

  function bind() {
    document.getElementById('thread-close')?.addEventListener('click', closeThread);
    document.getElementById('thread-expand')?.addEventListener('click', toggleThreadFull);

    // Файлы, смайлики и гифки — как в обычном чате
    const fileInput = document.getElementById('thread-file');
    document.getElementById('thread-attach')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', async () => {
      const files = [...fileInput.files];
      fileInput.value = '';
      await sendThreadFiles(files);
    });
    const threadComposer = {
      area: input(),
      emojiBtn: document.getElementById('thread-emoji'),
      gifBtn: document.getElementById('thread-gif'),
      sendFileNow: (file) => sendThreadFiles([file]),
    };
    document.getElementById('thread-emoji')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof toggleEmojiPicker === 'function') toggleEmojiPicker(threadComposer);
    });
    document.getElementById('thread-gif')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof toggleGifPicker === 'function') toggleGifPicker(threadComposer);
    });
    form()?.addEventListener('submit', (e) => {
      e.preventDefault();
      sendReply();
    });
    input()?.addEventListener('input', updateMentions);
    input()?.addEventListener('click', updateMentions);
    input()?.addEventListener('blur', () => setTimeout(closeMentions, 140));
    input()?.addEventListener('keydown', (e) => {
      if (mentionKey(e)) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendReply();
      }
      if (e.key === 'Escape') { if (editing) cancelThreadEdit(); else closeThread(); }
    });

    // Ручка ширины у левого края треда
    const p = panel();
    if (p && !p.dataset.drops) {
      p.dataset.drops = '1';
      // Пока открыто обсуждение, файл принимает только оно: подсветка и добавление
      // остаются здесь, а у общего чата рамка не появляется и не залипает
      const clearDropTargets = () => {
        for (const el of document.querySelectorAll('.drop-target')) el.classList.remove('drop-target');
      };
      p.addEventListener('dragover', (e) => {
        if (!e.dataTransfer?.types.includes('Files') || !thread) return;
        e.preventDefault();
        e.stopPropagation();
        clearDropTargets();
        p.classList.add('drop-target');
      });
      p.addEventListener('dragleave', (e) => {
        if (!p.contains(e.relatedTarget)) p.classList.remove('drop-target');
      });
      p.addEventListener('drop', (e) => {
        clearDropTargets();
        if (!e.dataTransfer?.files.length || !thread) return;
        e.preventDefault();
        e.stopPropagation();
        sendThreadFiles([...e.dataTransfer.files]);
      });
    }
    if (p && !p.querySelector('.thread-resize')) {
      const grip = document.createElement('div');
      grip.className = 'thread-resize';
      grip.addEventListener('pointerdown', (e) => {
        if (p.classList.contains('thread-full')) return;
        e.preventDefault();
        const startX = e.clientX;
        const startW = p.getBoundingClientRect().width;
        const minW = baseWidth || Math.round(startW);
        const maxW = Math.max(minW, (p.parentElement?.clientWidth || window.innerWidth) - 24);
        const move = (ev) => {
          const w = Math.min(maxW, Math.max(minW, startW + (startX - ev.clientX)));
          p.style.width = `${w}px`;
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
      p.append(grip);
    }
  }

  /** Перерисовать открытое обсуждение — например, после удаления сообщения в нём */
  function refreshOpenThread() {
    if (!thread) return;
    const inList = (state.roomHistory.get(thread.roomId) || []).some((m) => m.id === thread.rootId);
    // Корневое сообщение удалили — обсуждать больше нечего
    if (!inList) {
      closeThread();
      return;
    }
    openThread({ id: thread.rootId, threadRoot: thread.rootId }, { roomId: thread.roomId });
  }

  // Счётчик ответов обновляем по событию сервера
  function bumpReplies(rootId, roomId, data = {}) {
    const list = state.roomHistory.get(roomId);
    const root = list?.find((m) => m.id === rootId);
    if (root) {
      root.replies = Number.isFinite(Number(data.replies)) ? Number(data.replies) : Number(root.replies || 0);
      if (Array.isArray(data.participants)) {
        root.threadUsers = data.participants.slice(0, 5);
        root.threadUserCount = data.participants.length;
      }
    }
    // Если тред этого сообщения открыт — добавляем новый ответ строкой, без перезагрузки списка
    if (thread && thread.rootId === rootId && data.message) {
      const incoming = data.message;
      if (incoming.fromId !== state.me?.id && !rowCache.some((m) => m.id === incoming.id)) {
        const roomIdOfMsg = roomId;
        const finish = () => appendThreadRow(incoming);
        if (typeof decryptMessages === 'function' && typeof roomConvOf === 'function' && !incoming.plain) {
          decryptMessages([incoming], roomConvOf(roomIdOfMsg)).then(finish).catch(finish);
        } else finish();
      }
    }
    if (state.selectedRoomId === roomId && typeof renderRoomMessages === 'function') renderRoomMessages();
  }

  window.openThread = openThread;
  window.closeThread = closeThread;
  window.editThreadMessage = editThreadMessage;
  window.replyInThread = replyInThread;
  window.isThreadOpen = isThreadOpen;
  window.refreshOpenThread = refreshOpenThread;
  window.threadMessageRemoved = removeThreadRow;
  window.bumpThreadReplies = bumpReplies;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
