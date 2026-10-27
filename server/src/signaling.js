import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { verifyToken } from './auth.js';
import { contacts, relatedUserIds, rooms, toPublicUser, users } from './db.js';
import { hub } from './hub.js';
import { MAX_VOICE_PARTICIPANTS, voice } from './voice.js';

const RING_TIMEOUT_MS = 45_000;

// callId -> { id, state: 'ringing' | 'active', caller: { uid, ws }, callee: { uid, ws }, timer }
const calls = new Map();

const inCall = (uid) => [...calls.values()].some((c) => c.caller.uid === uid || c.callee.uid === uid);
// Занят: в звонке один на один или сидит в голосовой комнате
const isBusy = (uid) => inCall(uid) || voice.roomOf(uid) !== null;

function endCall(call, reason) {
  if (!calls.delete(call.id)) return;
  clearTimeout(call.timer);
  const message = { type: 'call:ended', callId: call.id, reason };
  hub.sendTo(call.caller.ws, message);
  // Пока звонок не принят, он звонит на всех устройствах собеседника
  if (call.callee.ws) hub.sendTo(call.callee.ws, message);
  else hub.send(call.callee.uid, message);
}

function notifyPresence(uid, online) {
  for (const id of relatedUserIds(uid)) hub.send(id, { type: 'presence', userId: uid, online });
}

const handlers = {
  'call:invite'(ws, user, msg) {
    const to = Number(msg.to);
    if (!contacts.has(user.id, to)) return hub.sendTo(ws, { type: 'call:unavailable', reason: 'not-contact' });
    if (!hub.isOnline(to)) return hub.sendTo(ws, { type: 'call:unavailable', reason: 'offline' });
    if (isBusy(to) || isBusy(user.id)) return hub.sendTo(ws, { type: 'call:unavailable', reason: 'busy' });

    const call = {
      id: crypto.randomUUID(),
      state: 'ringing',
      caller: { uid: user.id, ws },
      callee: { uid: to, ws: null },
    };
    call.timer = setTimeout(() => endCall(call, 'timeout'), RING_TIMEOUT_MS);
    calls.set(call.id, call);

    hub.sendTo(ws, { type: 'call:ringing', callId: call.id, to });
    hub.send(to, { type: 'call:incoming', callId: call.id, from: toPublicUser(user) });
  },

  'call:accept'(ws, user, msg) {
    const call = calls.get(msg.callId);
    if (!call || call.state !== 'ringing' || call.callee.uid !== user.id) return;
    clearTimeout(call.timer);
    call.state = 'active';
    call.callee.ws = ws;
    hub.send(user.id, { type: 'call:ended', callId: call.id, reason: 'answered-elsewhere' }, ws);
    hub.sendTo(call.caller.ws, { type: 'call:accepted', callId: call.id });
  },

  'call:decline'(_ws, user, msg) {
    const call = calls.get(msg.callId);
    if (call && call.state === 'ringing' && call.callee.uid === user.id) endCall(call, 'declined');
  },

  'call:hangup'(ws, user, msg) {
    const call = calls.get(msg.callId);
    if (!call) return;
    if (call.caller.ws === ws || call.callee.ws === ws) endCall(call, 'hangup');
  },

  // Пересылаем SDP и ICE-кандидаты второму участнику звонка
  signal(ws, _user, msg) {
    const call = calls.get(msg.callId);
    if (!call || call.state !== 'active') return;
    const target = call.caller.ws === ws ? call.callee.ws : call.callee.ws === ws ? call.caller.ws : null;
    hub.sendTo(target, { type: 'signal', callId: call.id, data: msg.data });
  },

  // ---------- Голосовые комнаты ----------

  'room:join'(ws, user, msg) {
    const roomId = Number(msg.roomId);
    const room = rooms.byId(roomId);
    const fail = (reason) => hub.sendTo(ws, { type: 'room:error', roomId, reason });
    if (!room || room.kind !== 'voice' || !rooms.isMember(roomId, user.id)) return fail('not-member');
    if (inCall(user.id)) return fail('in-call');
    const others = voice.participants(roomId).filter((p) => p.userId !== user.id);
    if (others.length >= MAX_VOICE_PARTICIPANTS) return fail('full');

    // В голосе можно быть только в одном месте: со старого устройства или из другой комнаты выходим
    const current = voice.roomOf(user.id);
    if (current !== null) voice.leave(current, user.id, voice.get(current, user.id).ws === ws ? null : 'moved');

    voice.join(roomId, user.id, ws, {
      muted: Boolean(msg.muted),
      deafened: Boolean(msg.deafened),
    });
    // Новичок сам звонит каждому, кто уже в комнате, — так у двух сторон не бывает встречных предложений
    hub.sendTo(ws, { type: 'room:joined', roomId, peers: others.map((p) => p.userId) });
    voice.broadcast(roomId);
  },

  'room:leave'(ws, user, msg) {
    const roomId = Number(msg.roomId);
    if (voice.get(roomId, user.id)?.ws === ws) voice.leave(roomId, user.id);
  },

  // Пересылаем SDP и ICE-кандидаты конкретному участнику комнаты
  'room:signal'(ws, user, msg) {
    const roomId = Number(msg.roomId);
    if (voice.get(roomId, user.id)?.ws !== ws) return;
    const target = voice.get(roomId, Number(msg.to));
    if (target) hub.sendTo(target.ws, { type: 'room:signal', roomId, from: user.id, data: msg.data });
  },

  // Микрофон, звук, камера и демонстрация экрана — чтобы все видели значки в списке комнаты
  'room:state'(ws, user, msg) {
    const roomId = Number(msg.roomId);
    const p = voice.get(roomId, user.id);
    if (p?.ws !== ws) return;
    for (const key of ['muted', 'deafened', 'video', 'screen']) if (key in msg) p[key] = Boolean(msg[key]);
    voice.broadcast(roomId);
  },
};

function onConnection(ws, user) {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  if (hub.add(user.id, ws)) notifyPresence(user.id, true);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    // Профиль мог поменяться, поэтому берём свежие данные
    const fresh = users.byId(user.id);
    if (fresh && Object.hasOwn(handlers, msg?.type)) handlers[msg.type](ws, fresh, msg);
  });

  ws.on('close', () => {
    for (const call of calls.values()) {
      if (call.caller.ws === ws || call.callee.ws === ws) endCall(call, 'disconnected');
    }
    voice.leaveSocket(ws);
    if (hub.remove(user.id, ws)) notifyPresence(user.id, false);
  });
}

export function attachSignaling(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws') return socket.destroy();
    const user = users.byId(verifyToken(url.searchParams.get('token')) ?? -1);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, user));
  });

  // Пинг раз в 30 секунд, чтобы вовремя замечать оборванные соединения
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);
  wss.on('close', () => clearInterval(heartbeat));
}
