// Треды в каналах: обсуждение сообщения в отдельной панели, чтобы не спамить в общий чат.
// Сервер уже умеет: ответы живут отдельными строками, лента комнаты их не показывает,
// уведомления уходят только участникам треда, @all расширяет рассылку на всех.
(() => {
  let thread = null; // { rootId, roomId }
  let editing = null; // правка сообщения прямо в треде
  let savedWidth = ''; // ширина треда до разворота

  const panel = () => document.getElementById('thread-panel');
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
    if (btn) btn.textContent = '\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c';
    setComposerEnabled(true);
  }

  function cancelThreadEdit() {
    if (!editing) return;
    editing = null;
    const area = input(); if (area) area.value = '';
    const btn = document.getElementById('thread-send');
    if (btn) btn.textContent = '\u041e\u0442\u0432\u0435\u0442\u0438\u0442\u044c';
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
    if (!rows.length) {
      box.innerHTML = '<div class="thread-empty muted small">Сообщений в треде пока нет</div>';
      return;
    }
    const root = rows[0];
    // Кто участвует в треде — для аватарок под корневым сообщением
    const participants = [...new Set(rows.map((m) => m.fromId))];
    const cachedRoot = (state.roomHistory.get(roomId) || []).find((m) => m.id === root.id);
    if (cachedRoot) {
      cachedRoot.threadUsers = participants.slice(0, 5);
      cachedRoot.threadUserCount = participants.length;
    }
    const actions = threadActions(roomId);
    let prev = null;
    for (const m of rows) {
      const shown = messageRow(m, prev, rows, actions, null, false);
      if (m.id === root.id) shown.row.classList.add('thread-root');
      box.append(shown.row);
      prev = m;
    }
    box.scrollTop = box.scrollHeight;
  }

  /** Поле ответа доступно только если сервер умеет треды */
  function setComposerEnabled(on) {
    const area = input();
    const btn = document.getElementById('thread-send');
    if (area) {
      area.disabled = !on;
      area.placeholder = on ? 'Ответить в треде' : 'Треды недоступны на этом сервере';
    }
    if (btn) btn.disabled = !on;
  }

  async function openThread(message, chat) {
    const roomId = chat.roomId || message.roomId;
    const rootId = message.threadRoot || message.id;
    thread = { rootId, roomId };
    panel().classList.remove('hidden');
    panel().classList.add('thread-open');
    if (headEl()) headEl().textContent = 'Тред';
    listEl().innerHTML = '<div class="thread-empty muted small">Загружаем тред…</div>';
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
        ? '<div class="thread-empty muted small">Треды появятся после обновления сервера до 3.0</div>'
        : `<div class="error small">${err.message}</div>`;
    }
  }

  function closeThread() {
    thread = null;
    panel()?.classList.add('hidden');
    panel()?.classList.remove('thread-open');
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
      if (sendBtn) sendBtn.textContent = '\u041e\u0442\u0432\u0435\u0442\u0438\u0442\u044c';
      try {
        await saveEdit(target.m, target.chat, next);
        area.value = '';
        await openThread({ id: thread.rootId, threadRoot: thread.rootId }, { roomId: thread.roomId });
        if (typeof renderRoomMessages === 'function') renderRoomMessages();
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    if (!text) return;
    area.value = '';
    area.style.height = '';
    try {
      const { body, plain } = await encryptOutgoing(roomConvOf(thread.roomId), { text });
      body.threadRootId = thread.rootId;
      // @all внутри треда: сервер разошлёт всем участникам канала, а не только треду
      if (/@all\b/i.test(text)) body.mentionAll = true;
      const saved = await Api.post(`/rooms/${thread.roomId}/messages`, body);
      const msg = { ...saved, plain, roomId: thread.roomId };
      const history = state.roomHistory.get(thread.roomId);
      // В общую ленту не добавляем: ответ живёт только в треде
      await openThread({ id: thread.rootId, threadRoot: thread.rootId }, { roomId: thread.roomId });
      const root = history?.find((m) => m.id === thread.rootId);
      if (root) root.replies = Number(root.replies || 0) + 1;
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

  function bind() {
    document.getElementById('thread-close')?.addEventListener('click', closeThread);
    document.getElementById('thread-expand')?.addEventListener('click', toggleThreadFull);
    form()?.addEventListener('submit', (e) => {
      e.preventDefault();
      sendReply();
    });
    input()?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendReply();
      }
      if (e.key === 'Escape') { if (editing) cancelThreadEdit(); else closeThread(); }
    });

    // Ручка ширины у левого края треда
    const p = panel();
    if (p && !p.querySelector('.thread-resize')) {
      const grip = document.createElement('div');
      grip.className = 'thread-resize';
      grip.addEventListener('pointerdown', (e) => {
        if (p.classList.contains('thread-full')) return;
        e.preventDefault();
        const startX = e.clientX;
        const startW = p.getBoundingClientRect().width;
        const maxW = Math.max(320, (p.parentElement?.clientWidth || window.innerWidth) - 24);
        const move = (ev) => {
          const w = Math.min(maxW, Math.max(300, startW + (startX - ev.clientX)));
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

  // Счётчик ответов обновляем по событию сервера
  function bumpReplies(rootId, roomId, data = {}) {
    const list = state.roomHistory.get(roomId);
    const root = list?.find((m) => m.id === rootId);
    if (root) {
      root.replies = data.replies ?? Number(root.replies || 0) + 1;
      if (Array.isArray(data.participants)) {
        root.threadUsers = data.participants.slice(0, 5);
        root.threadUserCount = data.participants.length;
      }
    }
    // Если тред этого сообщения открыт — подтягиваем новый ответ
    if (thread && thread.rootId === rootId) {
      openThread({ id: rootId, threadRoot: rootId }, { roomId });
    }
    if (state.selectedRoomId === roomId && typeof renderRoomMessages === 'function') renderRoomMessages();
  }

  window.openThread = openThread;
  window.closeThread = closeThread;
  window.editThreadMessage = editThreadMessage;
  window.bumpThreadReplies = bumpReplies;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
