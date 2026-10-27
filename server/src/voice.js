// Кто сейчас сидит в голосовых комнатах. Звук и видео идут напрямую между участниками (каждый с каждым),
// сервер только пересылает сигналы WebRTC и рассказывает всем участникам комнаты, кто подключён.
import { rooms } from './db.js';
import { hub } from './hub.js';

export const MAX_VOICE_PARTICIPANTS = 10;

// roomId -> Map<userId, { ws, muted, deafened, video, screen, joinedAt }>
const voiceRooms = new Map();

const publicState = (userId, p) => ({
  userId,
  muted: p.muted,
  deafened: p.deafened,
  video: p.video,
  screen: p.screen,
  joinedAt: p.joinedAt,
});

export const voice = {
  participants(roomId) {
    const map = voiceRooms.get(roomId);
    return map ? [...map].map(([userId, p]) => publicState(userId, p)) : [];
  },

  get: (roomId, userId) => voiceRooms.get(roomId)?.get(userId),

  /** Комната, в которой человек сейчас разговаривает (с любого устройства) */
  roomOf(userId) {
    for (const [roomId, map] of voiceRooms) if (map.has(userId)) return roomId;
    return null;
  },

  join(roomId, userId, ws, flags) {
    let map = voiceRooms.get(roomId);
    if (!map) voiceRooms.set(roomId, (map = new Map()));
    map.set(userId, { ws, muted: false, deafened: false, video: false, screen: false, ...flags, joinedAt: Date.now() });
  },

  /** Убирает человека из голосового канала и сообщает об этом всем участникам комнаты */
  leave(roomId, userId, reason) {
    const map = voiceRooms.get(roomId);
    const p = map?.get(userId);
    if (!p) return;
    map.delete(userId);
    if (!map.size) voiceRooms.delete(roomId);
    if (reason) hub.sendTo(p.ws, { type: 'room:left', roomId, reason });
    voice.broadcast(roomId);
  },

  /** Все голосовые каналы, где сидит это подключение (его закрыли) */
  leaveSocket(ws) {
    for (const [roomId, map] of [...voiceRooms]) {
      for (const [userId, p] of map) if (p.ws === ws) voice.leave(roomId, userId);
    }
  },

  closeRoom(roomId) {
    const map = voiceRooms.get(roomId);
    if (!map) return;
    voiceRooms.delete(roomId);
    for (const p of map.values()) hub.sendTo(p.ws, { type: 'room:left', roomId, reason: 'removed' });
  },

  broadcast(roomId) {
    const message = { type: 'room:voice', roomId, participants: voice.participants(roomId) };
    for (const m of rooms.members(roomId)) hub.send(m.id, message);
  },
};
