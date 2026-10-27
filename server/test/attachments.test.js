// Вложения: загрузка файла, отправка в личном чате и в комнате, раздача файлов и защита от подмены
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = 4200 + Math.floor(Math.random() * 90);
const base = `http://localhost:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sozvon-files-'));
let proc;

async function api(method, url, body, token) {
  const res = await fetch(base + '/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function upload(token, name, type, bytes) {
  const res = await fetch(`${base}/api/uploads?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': type, ...(token && { Authorization: `Bearer ${token}` }) },
    body: bytes,
  });
  return { status: res.status, body: await res.json() };
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

before(async () => {
  proc = spawn(process.execPath, ['src/index.js'], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, AUTH_RATE_LIMIT: '100', INVITE_CODE: '' },
    stdio: 'pipe',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Сервер не запустился');
});

after(async () => {
  const exited = new Promise((r) => proc.once('exit', r));
  proc.kill();
  await exited;
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
});

const reg = async (username) => (await api('POST', '/register', { username, password: 'secret1', displayName: username })).body;

test('картинка, видео и файл: загрузка, отправка, раздача', async () => {
  const a = await reg('files_a');
  const b = await reg('files_b');
  const c = await reg('files_c');
  await api('POST', '/contacts', { username: 'files_b' }, a.token);

  assert.equal((await upload(null, 'x.png', 'image/png', PNG)).status, 401, 'без входа не загрузить');

  const img = await upload(a.token, 'Котик.png', 'image/png', PNG);
  assert.equal(img.status, 200);
  assert.deepEqual(
    { name: img.body.name, mime: img.body.mime, size: img.body.size, kind: img.body.kind },
    { name: 'Котик.png', mime: 'image/png', size: PNG.length, kind: 'image' }
  );
  assert.match(img.body.url, /^\/api\/files\/[a-f0-9]{32}\/%D0%9A/);

  const page = await upload(a.token, 'страница.html', 'text/html', Buffer.from('<script>alert(1)</script>'));
  assert.equal(page.body.kind, 'file');
  const video = await upload(a.token, 'clip.mp4', 'video/mp4', Buffer.from('fake mp4'));
  assert.equal(video.body.kind, 'video');

  // Картинку браузер показывает, а html только скачивается и не выполняется
  const imgRes = await fetch(base + img.body.url);
  assert.equal(imgRes.headers.get('content-type'), 'image/png');
  assert.equal(imgRes.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await imgRes.arrayBuffer()), PNG);
  const pageRes = await fetch(base + page.body.url);
  assert.equal(pageRes.headers.get('content-type'), 'application/octet-stream');
  assert.match(pageRes.headers.get('content-disposition'), /^attachment/);
  assert.equal((await fetch(`${base}/api/files/${'0'.repeat(32)}/x`)).status, 404);

  // Сообщение с вложениями: текст можно не писать
  const sent = await api('POST', `/messages/${b.user.id}`, { text: '', attachmentIds: [img.body.id, page.body.id] }, a.token);
  assert.equal(sent.status, 200);
  assert.deepEqual(sent.body.attachments.map((f) => f.kind), ['image', 'file']);
  const history = (await api('GET', `/messages/${a.user.id}`, null, b.token)).body;
  assert.deepEqual(history.at(-1).attachments.map((f) => f.name), ['Котик.png', 'страница.html']);

  // Одно вложение — в одно сообщение; чужое вложение не прикрепить; пустое сообщение не отправить
  assert.equal((await api('POST', `/messages/${b.user.id}`, { text: 'ещё', attachmentIds: [img.body.id] }, a.token)).status, 400);
  const bFile = await upload(b.token, 'b.txt', 'text/plain', Buffer.from('b'));
  assert.equal((await api('POST', `/messages/${b.user.id}`, { text: 'чужое', attachmentIds: [bFile.body.id] }, a.token)).status, 400);
  assert.equal((await api('POST', `/messages/${b.user.id}`, { text: '  ', attachmentIds: [] }, a.token)).status, 400);

  // В комнате так же
  const room = (await api('POST', '/rooms', { name: 'Файлы', kind: 'text', memberIds: [b.user.id] }, a.token)).body;
  const inRoom = await api('POST', `/rooms/${room.id}/messages`, { text: 'видео', attachmentIds: [video.body.id] }, a.token);
  assert.equal(inRoom.status, 200);
  assert.equal(inRoom.body.attachments[0].kind, 'video');
  assert.equal((await api('GET', `/rooms/${room.id}/messages`, null, b.token)).body.at(-1).attachments[0].name, 'clip.mp4');
  assert.equal((await api('GET', `/rooms/${room.id}/messages`, null, c.token)).status, 404);
});

test('слишком большой файл не принимается', async () => {
  const a = await reg('files_big');
  const big = await upload(a.token, 'big.bin', 'application/octet-stream', Buffer.alloc(26 * 1024 * 1024));
  assert.equal(big.status, 413);
});
