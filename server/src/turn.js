import net from 'node:net';
import { createRequire } from 'node:module';
import { config } from './config.js';

const require = createRequire(import.meta.url);

// Запрещаем пересылку во внутренние сети, чтобы через TURN нельзя было достучаться до домашних устройств
const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['224.0.0.0', 4],
]) {
  blocked.addSubnet(addr, prefix, 'ipv4');
}
blocked.addSubnet('fc00::', 7, 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6');
blocked.addAddress('::1', 'ipv6');

// TURN_ALLOW_PRIVATE=1 снимает запрет — только для проверки в локальной сети
const isBlocked = (address) =>
  process.env.TURN_ALLOW_PRIVATE !== '1' && blocked.check(address, net.isIPv6(address) ? 'ipv6' : 'ipv4');

let server = null;
const users = new Map(); // логин TURN -> срок действия (мс)

/** Встроенный TURN-сервер (UDP). Включается переменной TURN_EMBEDDED=1 */
export function startEmbeddedTurn() {
  const Turn = require('node-turn');
  const Allocation = require('node-turn/lib/allocation');
  const permit = Allocation.prototype.permit;
  Allocation.prototype.permit = function (address) {
    if (!isBlocked(address)) permit.call(this, address);
  };

  server = new Turn({
    authMech: 'long-term',
    realm: 'sozvon',
    listeningPort: config.turnPort,
    minPort: config.turnMinPort,
    maxPort: config.turnMaxPort,
    externalIps: config.publicIp || undefined,
    debugLevel: 'ERROR',
  });
  server.start();

  // Удаляем просроченные учётки
  setInterval(() => {
    const now = Date.now();
    for (const [name, exp] of users) {
      if (exp < now) {
        server.removeUser(name);
        users.delete(name);
      }
    }
  }, 10 * 60_000).unref();
}

export function registerTurnUser(username, credential, expiresAt) {
  if (!server || users.has(username)) return;
  server.addUser(username, credential);
  users.set(username, expiresAt);
}
