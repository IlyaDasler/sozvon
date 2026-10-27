import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { verifyToken } from './auth.js';
import { contacts, toPublicUser, users } from './db.js';
import { hub } from './hub.js';

const RING_TIMEOUT_MS = 45_000;

// callId -> { id, state: 'ringing' | 'active', caller: { uid, ws }, callee: { uid, ws }, timer }
const calls = new Map();

const isBusy = (uid) => [...calls.values()].some((c) => c.caller.uid === uid || c.callee.uid === uid);

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
  for (const c of contacts.list(uid)) hub.send(c.id, { type: 'presence', userId: uid, online });
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
