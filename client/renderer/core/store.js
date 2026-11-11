// Состояние мобильного слоя: данные + подписки. Без DOM.
// Смысл: экраны читают отсюда и подписываются, а не лезут в чужой app.js.

const listeners = new Map(); // событие -> Set<fn>

const data = {
  ready: false,
  me: null,
  contacts: new Map(),   // id -> контакт
  chats: new Map(),      // id -> { id, peer, lastMessage, unread }
  histories: new Map(),  // id -> сообщения
  hubs: new Map(),       // id -> канал
  rooms: new Map(),      // id -> комната
  unread: new Map(),     // id -> число
};

export const store = {
  get state() {
    return data;
  },

  // Подписка на изменение. Возвращает функцию отписки.
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event)?.delete(fn);
  },

  emit(event, payload) {
    for (const fn of listeners.get(event) || []) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[store] обработчик ${event} упал:`, err);
      }
    }
  },

  setMe(me) {
    data.me = me;
    data.ready = true;
    this.emit('me', me);
  },

  setContacts(list) {
    data.contacts = new Map(list.map((c) => [c.id, c]));
    this.emit('contacts', data.contacts);
  },

  setChats(list) {
    data.chats = new Map(list.map((c) => [c.id, c]));
    this.emit('chats', data.chats);
  },

  setMessages(chatId, messages) {
    data.histories.set(chatId, messages);
    this.emit('messages', { chatId, messages });
  },

  pushMessage(chatId, message) {
    const list = data.histories.get(chatId) || [];
    // Одно и то же сообщение может прийти и из истории, и по сокету.
    if (list.some((m) => m.id === message.id)) return;
    list.push(message);
    data.histories.set(chatId, list);
    this.emit('message', { chatId, message });
  },

  setUnread(chatId, count) {
    if (count > 0) data.unread.set(chatId, count);
    else data.unread.delete(chatId);
    this.emit('unread', { chatId, count });
  },

  totalUnread() {
    let sum = 0;
    for (const n of data.unread.values()) sum += n;
    return sum;
  },
};
