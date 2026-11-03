// Треды в каналах: обсуждение сообщения в отдельной панели, чтобы не спамить в общий чат.
// Сервер уже умеет: ответы живут отдельными строками, лента комнаты их не показывает,
// уведомления уходят только участникам треда, @all расширяет рассылку на всех.
(() => {
  let thread = null; // { rootId, roomId }

  const panel = () => document.getElementById('thread-panel');
  const listEl = () => document.getElementById('thread-list');
  const headEl = () => document.getElementById('thread-title');
  const form = () => document.getElementById('thread-form');
  const input = () => document.getElementById('thread-input');

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
      paint(rows, roomId);
      input()?.focus();
    } catch (err) {
      // Старый сервер не знает про треды: не показываем «не найдено», объясняем причину
      const oldServer = /не найдено|not found|404/i.test(err.message || '');
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
      if (Array.isArray(history)) history.push(msg);
      await openThread({ id: thread.rootId, threadRoot: thread.rootId }, { roomId: thread.roomId });
      const root = history?.find((m) => m.id === thread.rootId);
      if (root) root.replies = Number(root.replies || 0) + 1;
      if (typeof renderRoomMessages === 'function') renderRoomMessages();
    } catch (err) {
      toast(err.message);
      area.value = text;
    }
  }

  function bind() {
    document.getElementById('thread-close')?.addEventListener('click', closeThread);
    form()?.addEventListener('submit', (e) => {
      e.preventDefault();
      sendReply();
    });
    input()?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendReply();
      }
      if (e.key === 'Escape') closeThread();
    });
  }

  // Счётчик ответов обновляем по событию сервера
  function bumpReplies(rootId, roomId) {
    const list = state.roomHistory.get(roomId);
    const root = list?.find((m) => m.id === rootId);
    if (!root) return;
    root.replies = Number(root.replies || 0) + 1;
    if (state.selectedRoomId === roomId && typeof renderRoomMessages === 'function') renderRoomMessages();
  }

  window.openThread = openThread;
  window.closeThread = closeThread;
  window.bumpThreadReplies = bumpReplies;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
