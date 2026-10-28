// Медиасервер LiveKit для больших голосовых комнат. Сам LiveKit — отдельная программа на том же VPS;
// здесь только пропуски в его комнаты (JWT, подписанный общим секретом) и просьбы убрать человека.
// Без LIVEKIT_URL, LIVEKIT_API_KEY и LIVEKIT_API_SECRET голос везде идёт как раньше — каждый с каждым.
import crypto from 'node:crypto';
import { config } from './config.js';
import { PERMS, has } from './perms.js';

const lk = config.livekit;
export const livekitEnabled = Boolean(lk.url && lk.key && lk.secret);

const JOIN_TTL_S = 6 * 3600;
const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** JWT в формате LiveKit: iss — ключ API, sub — кто, video — права в комнатах */
function sign(claims, ttl) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ iss: lk.key, nbf: now - 10, exp: now + ttl, ...claims })}`;
  return `${body}.${crypto.createHmac('sha256', lk.secret).update(body).digest('base64url')}`;
}

export const livekitRoom = (roomId) => `sozvon-room-${roomId}`;

/** Как пойдёт голос в комнате, где разговор только начинается: большая комната — через LiveKit */
export const mediaFor = (memberCount) => (livekitEnabled && memberCount >= lk.minMembers ? 'sfu' : 'p2p');

/** Пропуск в комнату LiveKit: что можно публиковать — по правам роли (говорить, камера и экран) */
export function joinGrant(roomId, user, perms) {
  const sources = [];
  if (has(perms, PERMS.speak)) sources.push('microphone');
  if (has(perms, PERMS.video)) sources.push('camera', 'screen_share', 'screen_share_audio');
  const token = sign(
    {
      sub: String(user.id),
      name: user.display_name,
      video: { room: livekitRoom(roomId), roomJoin: true, canSubscribe: true, canPublish: sources.length > 0, canPublishData: false, canPublishSources: sources },
    },
    JOIN_TTL_S
  );
  return { url: lk.url, token };
}

// Управление комнатами LiveKit (Twirp API) — пропуск администратора на минуту
function roomService(method, body) {
  if (!livekitEnabled) return;
  fetch(`${lk.apiUrl}/twirp/livekit.RoomService/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sign({ video: { roomAdmin: true, roomList: true, room: body.room } }, 60)}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  }).catch((err) => console.warn(`LiveKit ${method}:`, err.message));
}

/** Человека выгнали из голоса — отключаем и на медиасервере, даже если его приложение не послушается */
export const removeFromLivekit = (roomId, userId) => roomService('RemoveParticipant', { room: livekitRoom(roomId), identity: String(userId) });

/** Комнату удалили — закрываем и разговор в LiveKit */
export const closeLivekitRoom = (roomId) => roomService('DeleteRoom', { room: livekitRoom(roomId) });
