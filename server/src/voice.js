// Кто сейчас сидит в голосовых комнатах. Звук и видео идут либо напрямую между участниками (каждый с каждым,
// сервер только пересылает сигналы WebRTC), либо в больших комнатах — через медиасервер LiveKit. Как именно,
// решается, когда разговор в комнате начинается, и не меняется, пока в голосе кто-то есть.
import { rooms } from './db.js';
import { hub } from './hub.js';
import { closeLivekitRoom, removeFromLivekit } from './livekit.js';

export const MAX_VOICE_PARTICIPANTS = 10;

// roomId -> Map<userId, { ws, muted, deafened, video, screen, joinedAt }>, у Map ещё media: 'p2p' | 'sfu'
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

  /** Как идёт голос в комнате сейчас; null — в голосе никого */
  mediaOf: (roomId) => voiceRooms.get(roomId)?.media ?? null,

  /** Комната, в которой человек сейчас разговаривает (с любого устройства) */
  roomOf(userId) {
    for (const [roomId, map] of voiceRooms) if (map.has(userId)) return roomId;
    return null;
  },

  join(roomId, userId, ws, flags, media = 'p2p') {
    let map = voiceRooms.get(roomId);
    if (!map) voiceRooms.set(roomId, (map = Object.assign(new Map(), { media })));
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
    // Выгнали — убираем и с медиасервера (перешёл с другого устройства — там его новое подключение, не трогаем)
    if (reason && reason !== 'moved' && map.media === 'sfu') removeFromLivekit(roomId, userId);
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
    if (map.media === 'sfu') closeLivekitRoom(roomId);
  },

  broadcast(roomId) {
    const message = { type: 'room:voice', roomId, participants: voice.participants(roomId), media: voice.mediaOf(roomId) };
    for (const m of rooms.members(roomId)) hub.send(m.id, message);
  },
};
