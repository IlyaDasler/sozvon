// «Аня печатает» над полем ввода. Серверу уходит только факт набора, текст остаётся на устройстве.
// Пока человек пишет, сигнал повторяется; перестал — плашка сама гаснет, отправил — гаснет сразу.

const TYPING_SEND_EVERY_MS = 3000;
const TYPING_SHOW_MS = 6000;

const typists = new Map(); // переписка -> Map(id человека -> таймер, который уберёт его из плашки)
let lastTypingSent = { conv: null, at: 0 };

const openConv = () => (state.selectedId ? `dm:${state.selectedId}` : state.selectedRoomId ? `room:${state.selectedRoomId}` : null);

/** Человек набирает текст в чате conv. Невидимку не выдаём */
function noteOwnTyping(conv) {
  const now = Date.now();
  if (state.me.status === 'invisible') return;
  if (lastTypingSent.conv === conv && now - lastTypingSent.at < TYPING_SEND_EVERY_MS) return;
  lastTypingSent = { conv, at: now };
  const [kind, id] = conv.split(':');
  socket?.send({ type: 'typing', ...(kind === 'dm' ? { to: Number(id) } : { roomId: Number(id) }) });
}

/** Отправил своё — следующая буква снова сообщит о наборе */
const resetOwnTyping = () => (lastTypingSent = { conv: null, at: 0 });

function typingText(ids) {
  const names = ids.map((id) => userById(id)?.displayName || '?');
  if (names.length === 1) return `${names[0]} печатает`;
  if (names.length === 2) return `${names[0]} и ${names[1]} печатают`;
  return 'Несколько человек печатают';
}

function renderTyping() {
  const conv = openConv();
  const ids = [...(typists.get(conv)?.keys() || [])];
  const bar = $(conv?.startsWith('room:') ? 'room-typing' : 'chat-typing');
  for (const id of ['chat-typing', 'room-typing']) if ($(id) !== bar) $(id).replaceChildren();
  if (!ids.length) return bar.replaceChildren();
  const text = document.createElement('span');
  text.className = 'ellipsis';
  text.textContent = typingText(ids);
  const dots = Object.assign(document.createElement('i'), { className: 'typing-dots' });
  dots.append(...[0, 1, 2].map(() => document.createElement('b')));
  bar.replaceChildren(dots, text);
}

/** Собеседник набирает текст */
function showTyping({ conv, userId }) {
  if (!typists.has(conv)) typists.set(conv, new Map());
  const people = typists.get(conv);
  clearTimeout(people.get(userId));
  people.set(userId, setTimeout(() => stopTyping(conv, userId), TYPING_SHOW_MS));
  renderTyping();
}

function stopTyping(conv, userId) {
  const people = typists.get(conv);
  if (!people?.has(userId)) return;
  clearTimeout(people.get(userId));
  people.delete(userId);
  renderTyping();
}

/** Выход из аккаунта */
function clearTyping() {
  for (const people of typists.values()) for (const timer of people.values()) clearTimeout(timer);
  typists.clear();
  resetOwnTyping();
  renderTyping();
}
