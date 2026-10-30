// Общие хелперы серверных тестов: свой сервер на случайном порту с временной базой
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

/** Свободный порт: система выдаёт его на миг, мы сразу освобождаем и отдаём серверу */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Запускает сервер. dataDir можно передать свой — например, чтобы перезапустить сервер на той же базе */
export async function startServer({ dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sozvon-test-')), env = {} } = {}) {
  const port = await freePort();
  const base = `http://localhost:${port}`;
  const proc = spawn(process.execPath, ['src/index.js'], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, INVITE_CODE: 'friends', AUTH_RATE_LIMIT: '100', ...env },
    stdio: 'pipe',
  });

  async function api(method, url, body, token) {
    const res = await fetch(base + '/api' + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: body && JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  // Клиент WebSocket с очередью входящих сообщений
  function connect(token) {
    const ws = new WebSocket(`ws://localhost:${port}/ws?token=${encodeURIComponent(token)}`);
    const queue = [];
    const waiters = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      const i = waiters.findIndex((w) => w.type === msg.type);
      if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
      else queue.push(msg);
    });
    return {
      ws,
      open: new Promise((r) => ws.once('open', r)),
      send: (msg) => ws.send(JSON.stringify(msg)),
      next(type) {
        const i = queue.findIndex((m) => m.type === type);
        if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
        return new Promise((resolve, reject) => {
          waiters.push({ type, resolve });
          setTimeout(() => reject(new Error(`Не дождались ${type}`)), 3000);
        });
      },
    };
  }

  // Дружба — через заявку: a зовёт, b принимает
  async function befriend(a, b) {
    await api('POST', '/contacts', { username: b.user.username }, a.token);
    await api('POST', `/friend-requests/${a.user.id}/accept`, null, b.token);
  }

  const reg = async (username) =>
    (await api('POST', '/register', { username, password: 'secret11', displayName: username, inviteCode: 'friends' })).body;

  async function stop({ keepData = false } = {}) {
    const exited = new Promise((r) => proc.once('exit', r));
    proc.kill();
    await exited;
    if (!keepData) fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
  }

  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) return { base, dataDir, api, connect, befriend, reg, stop };
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Сервер не запустился');
}
