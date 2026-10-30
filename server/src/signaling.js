import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { unsupportedClient } from './client-version.js';
import { contacts, rooms, toPublicUser, users } from './db.js';
import { hub } from './hub.js';
import { PERMS, has } from './perms.js';
import { broadcastPresence, setAutoIdle, userGone } from './presence.js';
import { redeemTicket, sessionOf } from './sessions.js';
import { MAX_VOICE_PARTICIPANTS, voice } from './voice.js';
import { joinGrant, mediaFor } from './livekit.js';

const RING_TIMEOUT_MS = 45_000;
const MAX_CALL_PARTICIPANTS = 10;

// Звонок: участники (members) и те, кому сейчас звонят (ringing). Пока никто не ответил, state — 'ringing'.
// На двоих звонок идёт ровно как в версиях до 2.2: call:accepted звонившему и сигналы без адресата.
// group — версия приложения умеет групповые звонки: добавлять людей можно, только если умеют все.
// callId -> { id, state, members: Map<uid, { ws, group }>, ringing: Map<uid, { timer, group }> }
const calls = new Map();

const inCall = (uid) => [...calls.values()].some((c) => c.members.has(uid) || c.ringing.has(uid));
// Занят: в звонке или сидит в голосовой комнате
const isBusy = (uid) => inCall(uid) || voice.roomOf(uid) !== null;

function memberBySocket(call, ws) {
  for (const [uid, m] of call.members) if (m.ws === ws) return uid;
  return null;
}

/** Событие об участнике звонка — с профилем: в групповом звонке люди могут быть не друзьями друг другу */
const memberEvent = (call, uid, state) => ({ type: 'call:member', callId: call.id, userId: uid, state, user: toPublicUser(users.byId(uid)) });

function toMembers(call, message, except = null) {
  for (const [uid, m] of call.members) if (uid !== except) hub.sendTo(m.ws, message);
}

function endCall(call, reason) {
  if (!calls.delete(call.id)) return;
  const message = { type: 'call:ended', callId: call.id, reason };
  toMembers(call, message);
  // Пока звонок не принят, он звонит на всех устройствах человека
  for (const [uid, r] of call.ringing) {
    clearTimeout(r.timer);
    hub.send(uid, message);
  }
}

/** Человек вышел из звонка; когда остаётся один участник — звонок закончен */
function leaveCall(call, uid, reason) {
  if (call.state === 'ringing') return endCall(call, reason);
  call.members.delete(uid);
  toMembers(call, memberEvent(call, uid, 'left'));
  if (call.members.size < 2) endCall(call, reason);
}

/** Тому, кого позвали, так и не ответили (или он отказался) — звонок у остальных продолжается */
function stopRinging(call, uid, state) {
  const r = call.ringing.get(uid);
  if (!r) return;
  clearTimeout(r.timer);
  call.ringing.delete(uid);
  hub.send(uid, { type: 'call:ended', callId: call.id, reason: state === 'missed' ? 'timeout' : 'declined' });
  toMembers(call, memberEvent(call, uid, state));
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
      members: new Map([[user.id, { ws, group: Boolean(msg.group) }]]),
      ringing: new Map(),
    };
    call.ringing.set(to, { timer: setTimeout(() => endCall(call, 'timeout'), RING_TIMEOUT_MS) });
    calls.set(call.id, call);

    hub.sendTo(ws, { type: 'call:ringing', callId: call.id, to });
    hub.send(to, { type: 'call:incoming', callId: call.id, from: toPublicUser(user) });
  },

  // Позвать друга в идущий звонок: позвать может любой участник, если все участники — версии 2.2+
  'call:add'(ws, user, msg) {
    const call = calls.get(msg.callId);
    if (!call || call.state !== 'active' || memberBySocket(call, ws) !== user.id) return;
    const to = Number(msg.to);
    const fail = (reason) => hub.sendTo(ws, { type: 'call:add:failed', callId: call.id, to, reason });
    if (!contacts.has(user.id, to)) return fail('not-contact');
    if (!hub.isOnline(to)) return fail('offline');
    if (isBusy(to)) return fail('busy');
    if (call.members.size + call.ringing.size >= MAX_CALL_PARTICIPANTS) return fail('full');
    if ([...call.members.values()].some((m) => !m.group)) return fail('old-version');

    call.ringing.set(to, { timer: setTimeout(() => stopRinging(call, to, 'missed'), RING_TIMEOUT_MS) });
    const others = [...call.members.keys()].map((uid) => toPublicUser(users.byId(uid)));
    hub.send(to, { type: 'call:incoming', callId: call.id, from: toPublicUser(user), group: true, others });
    toMembers(call, memberEvent(call, to, 'ringing'));
  },

  'call:accept'(ws, user, msg) {
    const call = calls.get(msg.callId);
    const r = call?.ringing.get(user.id);
    if (!r) return;
    // В групповой звонок старая версия не попадёт: она умеет только звонки на двоих
    if (call.state === 'active' && !msg.group) {
      clearTimeout(r.timer);
      call.ringing.delete(user.id);
      hub.sendTo(ws, { type: 'call:ended', callId: call.id, reason: 'old-version' });
      toMembers(call, memberEvent(call, user.id, 'declined'));
      return;
    }
    clearTimeout(r.timer);
    call.ringing.delete(user.id);
    const peers = [...call.members.keys()];
    call.members.set(user.id, { ws, group: Boolean(msg.group) });
    hub.send(user.id, { type: 'call:ended', callId: call.id, reason: 'answered-elsewhere' }, ws);
    if (call.state === 'ringing') {
      // Первый ответ — обычный звонок на двоих: соединение предлагает звонивший
      call.state = 'active';
      toMembers(call, { type: 'call:accepted', callId: call.id }, user.id);
    } else {
      // Новенький сам предлагает соединение каждому, как в голосовых комнатах
      hub.sendTo(ws, { type: 'call:joined', callId: call.id, peers });
      toMembers(call, memberEvent(call, user.id, 'joined'), user.id);
    }
  },

  'call:decline'(_ws, user, msg) {
    const call = calls.get(msg.callId);
    if (!call?.ringing.has(user.id)) return;
    if (call.state === 'ringing') endCall(call, 'declined');
    else stopRinging(call, user.id, 'declined');
  },

  'call:hangup'(ws, user, msg) {
    const call = calls.get(msg.callId);
    if (call && memberBySocket(call, ws) === user.id) leaveCall(call, user.id, 'hangup');
  },

  // Пересылаем SDP и ICE-кандидаты: адресату (to) или, в звонке на двоих, второму участнику
  signal(ws, user, msg) {
    const call = calls.get(msg.callId);
    if (!call || call.state !== 'active' || memberBySocket(call, ws) !== user.id) return;
    let target = msg.to != null ? call.members.get(Number(msg.to)) : null;
    if (msg.to == null && call.members.size === 2) target = [...call.members.values()].find((m) => m.ws !== ws);
    if (target) hub.sendTo(target.ws, { type: 'signal', callId: call.id, from: user.id, data: msg.data });
  },

  // ---------- Голосовые комнаты ----------

  'room:join'(ws, user, msg) {
    const roomId = Number(msg.roomId);
    const room = rooms.byId(roomId);
    const fail = (reason) => hub.sendTo(ws, { type: 'room:error', roomId, reason });
    if (!room || room.kind !== 'voice' || !rooms.isMember(roomId, user.id)) return fail('not-member');
    const perms = rooms.permsOf(room, user.id);
    if (!has(perms, PERMS.connect)) return fail('no-access');
    if (inCall(user.id)) return fail('in-call');
    // Большая комната — через LiveKit (решено, когда разговор начался); версии до 2.3.1 его не умеют
    const media = voice.mediaOf(roomId) ?? mediaFor(rooms.members(roomId).length);
    if (media === 'sfu' && !msg.sfu) return fail('old-version');
    // Каждый с каждым — не больше 10 человек; через медиасервер — сколько участников в комнате
    const others = voice.participants(roomId).filter((p) => p.userId !== user.id);
    if (media === 'p2p' && others.length >= MAX_VOICE_PARTICIPANTS) return fail('full');

    // В голосе можно быть только в одном месте: со старого устройства или из другой комнаты выходим
    const current = voice.roomOf(user.id);
    if (current !== null) voice.leave(current, user.id, voice.get(current, user.id).ws === ws ? null : 'moved');

    voice.join(roomId, user.id, ws, {
      muted: Boolean(msg.muted) || !has(perms, PERMS.speak),
      deafened: Boolean(msg.deafened),
    }, media);
    // Новичок сам звонит каждому, кто уже в комнате, — так у двух сторон не бывает встречных предложений.
    // Через LiveKit звонить не нужно: приложение подключается к медиасерверу по пропуску
    hub.sendTo(ws, {
      type: 'room:joined',
      roomId,
      peers: others.map((p) => p.userId),
      media,
      ...(media === 'sfu' && { livekit: joinGrant(roomId, user, perms) }),
    });
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

  // Приложение сообщает, что за компьютером давно никого нет (или человек вернулся)
  'status:auto'(_ws, user, msg) {
    setAutoIdle(user.id, Boolean(msg.idle));
  },

  // Микрофон, звук, камера и демонстрация экрана — чтобы все видели значки в списке комнаты
  'room:state'(ws, user, msg) {
    const roomId = Number(msg.roomId);
    const p = voice.get(roomId, user.id);
    if (p?.ws !== ws) return;
    for (const key of ['muted', 'deafened', 'video', 'screen']) if (key in msg) p[key] = Boolean(msg[key]);
    // Без права говорить или показывать значки всегда «выключено» — остальные и так не слышат и не видят
    const perms = rooms.permsOf(rooms.byId(roomId), user.id);
    if (!has(perms, PERMS.speak)) p.muted = true;
    if (!has(perms, PERMS.video)) p.video = p.screen = false;
    voice.broadcast(roomId);
  },
};

function onConnection(ws, user) {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  if (hub.add(user.id, ws)) broadcastPresence(user.id);

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
    for (const call of [...calls.values()]) {
      const uid = memberBySocket(call, ws);
      if (uid !== null) leaveCall(call, uid, 'disconnected');
    }
    voice.leaveSocket(ws);
    if (hub.remove(user.id, ws)) userGone(user.id);
  });
}

export function attachSignaling(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws') return socket.destroy();
    if (unsupportedClient(req.headers['user-agent'])) {
      socket.write('HTTP/1.1 426 Upgrade Required\r\n\r\n');
      return socket.destroy();
    }
    // Билет; токен в адресе — приложения версий до 2.7
    const ticket = url.searchParams.get('ticket');
    const session = ticket ? redeemTicket(ticket) : sessionOf(url.searchParams.get('token'));
    if (!session) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.sid = session.sid;
      onConnection(ws, session.user);
    });
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
