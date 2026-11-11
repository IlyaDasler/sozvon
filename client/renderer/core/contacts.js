// Контакты и непрочитанное. Без DOM: только запросы и приведение данных к виду для экрана.
import { Api } from '../api.mjs';

const STATUS_LABEL = {
  online: 'В сети',
  idle: 'Неактивен',
  dnd: 'Не беспокоить',
  invisible: 'Невидимка',
  offline: 'Не в сети',
};

// Статус как в десктопе (notifications.js): status важнее online, offline — если не online.
export const presenceOf = (user) => user?.status || (user?.online ? 'online' : 'offline');

export const isAvailable = (user) => presenceOf(user) !== 'offline';

export const statusLabel = (user) => STATUS_LABEL[presenceOf(user)] || STATUS_LABEL.offline;

const byAvailableThenName = (a, b) =>
  Number(isAvailable(b)) - Number(isAvailable(a)) ||
  (a.displayName || a.username || '').localeCompare(b.displayName || b.username || '', 'ru');

export const contacts = {
  // Список контактов, отсортированный как в десктопе: сначала в сети, потом по имени.
  async list() {
    const raw = await Api.get('/contacts');
    return raw.slice().sort(byAvailableThenName);
  },

  // Непрочитанное по личным перепискам и комнатам. Ошибка не валит экран: вернёт пустое.
  async unread() {
    try {
      const data = await Api.get('/unread');
      return {
        dm: new Map((data.dm || []).map((row) => [row.peerId, row.count])),
        rooms: new Map((data.rooms || []).map((row) => [row.roomId, row.count])),
      };
    } catch {
      return { dm: new Map(), rooms: new Map() };
    }
  },
};
