// Расшифровка личной переписки: настоящие ключи через WebCrypto, подменены только сеть и хранилище.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// e2ee-crypto.js — обычный скрипт, кладём его глобально, как в браузере.
globalThis.E2EE = require('../renderer/e2ee-crypto');

globalThis.window = {};

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

let routes = {};
const calls = [];
const writes = [];
globalThis.fetch = async (url, opts = {}) => {
  const path = String(url).replace(/^https?:\/\/[^/]+/, '');
  calls.push(path);
  if (opts.method && opts.method !== 'GET') writes.push(`${opts.method} ${path}`);
  const body = routes[path];
  if (body === undefined) return { ok: false, status: 404, json: async () => ({ error: 'нет' }) };
  return { ok: true, status: 200, json: async () => body };
};

const { Api } = await import('../renderer/api.mjs');
const { messages } = await import('../renderer/core/messages.js');
const { dmConvOf, readIdentity } = await import('../renderer/core/crypto.js');

Api.base = 'https://s.example';
Api.token = 'T';

let fail = 0;
const check = (name, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : ' — ' + extra));
  if (!cond) fail++;
};

const ME = 1;
const PEER = 2;
const CONV = dmConvOf(ME, PEER);

const me = await E2EE.generateIdentity();
const peer = await E2EE.generateIdentity();
const convKey = E2EE.newConvKey();
const sealedForMe = await E2EE.seal(convKey, me.publicKey);

const encOf = (text, from = PEER, epoch = 1) =>
  E2EE.encryptMessage(convKey, { text, files: [], preview: null }, { conv: CONV, epoch, from });

const identityKey = `e2ee:s.example:identity:${ME}`;

// --- 1. Ключ на месте, всё расшифровывается ---
mem.set(identityKey, JSON.stringify(me));
check('readIdentity: находит ключ устройства', readIdentity({ base: Api.base, meId: ME, serverPublicKey: me.publicKey })?.publicKey === me.publicKey);
check('readIdentity: чужой публичный ключ с сервера — не используем',
  readIdentity({ base: Api.base, meId: ME, serverPublicKey: peer.publicKey }) === null);

routes = {
  [`/api/keys/${CONV}`]: { epoch: 1, mine: { 1: sealedForMe }, missing: [], rotate: false },
  [`/api/messages/${PEER}`]: [
    { id: 2, fromId: ME, text: '🔒', enc: await encOf('Моё сообщение', ME), createdAt: 1700000000000 },
    { id: 1, fromId: PEER, text: '🔒', enc: await encOf('Привет'), createdAt: 1699999999000 },
  ],
};

let list = await messages.dmHistory({ meId: ME, peerId: PEER, serverPublicKey: me.publicKey });
check('история: расшифрована', list[0].plain?.text === 'Привет' && list[1].plain?.text === 'Моё сообщение',
  JSON.stringify(list.map((m) => m.plain?.text)));
check('история: отсортирована по возрастанию id', list[0].id === 1 && list[1].id === 2);
check('история: заблокированных нет', list.every((m) => !m.locked));
check('история: серверный текст не остаётся в plain', list.every((m) => m.plain.text !== '🔒'));

// --- 2. Версии ключа нет: сообщение помечено, текст не подменяется ---
routes[`/api/keys/${CONV}`] = { epoch: 2, mine: { 1: sealedForMe }, missing: [], rotate: false };
routes[`/api/messages/${PEER}`] = [
  { id: 5, fromId: PEER, text: '🔒', enc: await encOf('из будущего', PEER, 9), createdAt: 1700000001000 },
];
list = await messages.dmHistory({ meId: ME, peerId: PEER, serverPublicKey: me.publicKey });
check('нет версии ключа: помечено no-key', list[0].locked === 'no-key');
check('нет версии ключа: чужого текста в plain нет', !list[0].plain);

// --- 3. Ключа устройства нет (другое устройство) ---
mem.delete(identityKey);
routes[`/api/messages/${PEER}`] = [
  { id: 7, fromId: PEER, text: '🔒', enc: await encOf('секрет'), createdAt: 1700000002000 },
];
list = await messages.dmHistory({ meId: ME, peerId: PEER, serverPublicKey: me.publicKey });
check('нет ключа: no-identity', list[0].locked === 'no-identity');
{
  const before = calls.length;
  mem.delete(identityKey);
  await messages.dmHistory({ meId: ME, peerId: PEER, serverPublicKey: me.publicKey });
  const seen = calls.slice(before);
  check('нет ключа: ключи переписки не запрашивались', !seen.some((c) => c.includes('/keys/')));
}

// --- 4. Сообщение не зашифровано: показываем как есть ---
mem.set(identityKey, JSON.stringify(me));
routes[`/api/messages/${PEER}`] = [{ id: 9, fromId: PEER, text: 'Старое открытое', enc: null, createdAt: 1700000003000 }];
list = await messages.dmHistory({ meId: ME, peerId: PEER, serverPublicKey: me.publicKey });
check('открытое сообщение: текст из text', list[0].text === 'Старое открытое' && !list[0].locked);
{
  const before = calls.length;
  await messages.dmHistory({ meId: ME, peerId: PEER, serverPublicKey: me.publicKey });
  check('открытое сообщение: ключи не запрашивались', !calls.slice(before).some((c) => c.includes('/keys/')));
}

// --- 5. Переписка сломана: 404 на ключи, сообщения помечены, падения нет ---
delete routes[`/api/keys/${CONV}`];
routes[`/api/messages/${PEER}`] = [{ id: 11, fromId: PEER, text: '🔒', enc: await encOf('x'), createdAt: 1700000004000 }];
list = await messages.dmHistory({ meId: ME, peerId: PEER, serverPublicKey: me.publicKey });
check('ключи недоступны: no-key, без исключения', list[0].locked === 'no-key');

check('ГАРАНТИЯ: ни одного запроса на запись (POST/PUT/PATCH/DELETE)', writes.length === 0, writes.join(', '));
console.log(fail ? `\nПРОВАЛЕНО: ${fail}` : '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
process.exit(fail ? 1 : 0);
