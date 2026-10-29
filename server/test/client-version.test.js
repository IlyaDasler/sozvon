// Версии приложения ниже 2.0 больше не поддерживаются: сервер отвечает «обновите Созвон» (426),
// а само приложение 1.x при запуске показывает окно обновления. Версию приложение сообщает в User-Agent (Sozvon/1.9.0)
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startServer } from './helpers.js';
import { unsupportedClient } from '../src/client-version.js';

const ua = (version) => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Sozvon/${version} Chrome/138.0.0.0 Electron/37.0.0 Safari/537.36`;

test('ниже 2.0 — не поддерживается; 2.x, браузер и запросы без версии — работают', () => {
  assert.equal(unsupportedClient(ua('1.9.0')), true);
  assert.equal(unsupportedClient(ua('0.5.2')), true);
  assert.equal(unsupportedClient(ua('2.0.0')), false);
  assert.equal(unsupportedClient(ua('2.4.1')), false);
  assert.equal(unsupportedClient('Mozilla/5.0 (Windows NT 10.0) Chrome/138.0.0.0 Safari/537.36'), false);
  assert.equal(unsupportedClient(undefined), false);
});

let server;
before(async () => {
  server = await startServer();
});
after(() => server.stop());

test('приложение 1.x получает 426 «обновите Созвон» на запросы', async () => {
  const old = await fetch(server.base + '/api/health', { headers: { 'User-Agent': ua('1.9.0') } });
  assert.equal(old.status, 426);
  assert.match((await old.json()).error, /обновите/i);
  const fresh = await fetch(server.base + '/api/health', { headers: { 'User-Agent': ua('2.4.1') } });
  assert.equal(fresh.status, 200);
});

test('приложение 1.x не подключается к живым событиям', async () => {
  const { token } = await server.reg('oldclient');
  const status = await new Promise((resolve) => {
    const ws = new WebSocket(`${server.base.replace('http', 'ws')}/ws?token=${token}`, { headers: { 'User-Agent': ua('1.9.0') } });
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
    ws.on('open', () => {
      ws.close();
      resolve(101);
    });
    ws.on('error', () => {});
  });
  assert.equal(status, 426);
});
