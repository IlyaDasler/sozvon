// Каналы и комнаты: только чтение, без изменения серверных сущностей.
import { Api } from '../api.mjs';

export const hubs = {
  async tree() {
    const [list, rooms] = await Promise.all([Api.get('/hubs'), Api.get('/rooms')]);
    return list.map((hub) => ({
      ...hub,
      rooms: rooms.filter((room) => room.hubId === hub.id),
    }));
  },
};
