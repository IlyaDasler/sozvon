// Кто сейчас онлайн: у одного пользователя может быть несколько открытых клиентов
const sockets = new Map(); // userId -> Set<WebSocket>

const sendRaw = (ws, data) => {
  if (ws.readyState === 1) ws.send(data);
};

export const hub = {
  /** Возвращает true, если пользователь только что появился в сети */
  add(userId, ws) {
    let set = sockets.get(userId);
    const wasOffline = !set;
    if (!set) sockets.set(userId, (set = new Set()));
    set.add(ws);
    return wasOffline;
  },

  /** Возвращает true, если у пользователя больше не осталось подключений */
  remove(userId, ws) {
    const set = sockets.get(userId);
    if (!set) return false;
    set.delete(ws);
    if (set.size) return false;
    sockets.delete(userId);
    return true;
  },

  isOnline: (userId) => sockets.has(userId),

  send(userId, message, exceptWs) {
    const set = sockets.get(userId);
    if (!set) return;
    const data = JSON.stringify(message);
    for (const ws of set) if (ws !== exceptWs) sendRaw(ws, data);
  },

  /** Закрыть соединения человека, которые подошли под условие: приложение увидит обрыв и проверит вход */
  dropSockets(userId, shouldDrop) {
    for (const ws of sockets.get(userId) || []) if (shouldDrop(ws)) ws.close(4401, 'session closed');
  },

  sendTo(ws, message) {
    if (ws) sendRaw(ws, JSON.stringify(message));
  },
};
