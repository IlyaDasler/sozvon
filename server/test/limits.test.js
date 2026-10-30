// Один человек не может положить сервер: квота на файлы, лимиты частоты сообщений, загрузок и событий соединения
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const MB = 1024 * 1024;
let server, api, connect, befriend, reg;

before(async () => {
  server = await startServer({ env: { STORAGE_QUOTA_MB: '3', MESSAGE_RATE_LIMIT: '5', UPLOAD_RATE_LIMIT: '6', SOCKET_RATE_LIMIT: '20' } });
  ({ api, connect, befriend, reg } = server);
});

after(() => server.stop());

async function upload(token, bytes) {
  const res = await fetch(`${server.base}/api/uploads?name=a.bin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${token}` },
    body: bytes,
  });
  return { status: res.status, body: await res.json() };
}

test('квота: сверх объёма файл не принимается, чужая квота не мешает', async () => {
  const a = await reg('q_a');
  const b = await reg('q_b');
  assert.equal((await upload(a.token, Buffer.alloc(2 * MB))).status, 200);
  const over = await upload(a.token, Buffer.alloc(2 * MB));
  assert.equal(over.status, 413);
  assert.match(over.body.error, /место/);
  assert.equal((await upload(b.token, Buffer.alloc(2 * MB))).status, 200);
});

test('большой файл и пустой отклоняются, файл на диске цел', async () => {
  const a = await reg('q_c');
  assert.equal((await upload(a.token, Buffer.alloc(0))).status, 400);
  const ok = await upload(a.token, Buffer.from('содержимое'));
  assert.equal(ok.status, 200);
  const got = await fetch(`${server.base}${ok.body.url}`);
  assert.equal(await got.text(), 'содержимое');
});

test('загрузки: лимит частоты', async () => {
  const a = await reg('q_r');
  const results = [];
  for (let i = 0; i < 7; i++) results.push((await upload(a.token, Buffer.from('x'))).status);
  assert.equal(results.at(-1), 429);
  assert.equal(results.filter((s) => s === 200).length, 6);
});

test('сообщения: лимит частоты у каждого свой', async () => {
  const a = await reg('m_a');
  const b = await reg('m_b');
  await befriend(a, b);
  const results = [];
  for (let i = 0; i < 6; i++) results.push((await api('POST', `/messages/${b.user.id}`, { text: `${i}` }, a.token)).status);
  assert.deepEqual(results, [200, 200, 200, 200, 200, 429]);
  assert.equal((await api('POST', `/messages/${a.user.id}`, { text: 'привет' }, b.token)).status, 200);
});

test('соединение: поток событий обрывается', async () => {
  const a = await reg('w_a');
  const client = connect(a.token);
  await client.open;
  const closed = new Promise((resolve, reject) => {
    client.ws.once('close', resolve);
    setTimeout(() => reject(new Error('Сокет не закрылся')), 3000);
  });
  for (let i = 0; i < 40; i++) client.send({ type: 'status:auto', idle: false });
  assert.equal(await closed, 4408);
});
