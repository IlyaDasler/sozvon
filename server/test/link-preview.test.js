// Предпросмотр ссылок: разбор страницы, защита внутренней сети сервера, превью в сообщении
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { isPublicAddress, parsePreview } from '../src/link-preview.js';

test('внутренние адреса сервера закрыты для предпросмотра', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.10', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1'])
    assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ['77.88.55.88', '172.32.0.1', '8.8.8.8', '2a02:6b8::2:242', '::ffff:8.8.8.8']) assert.equal(isPublicAddress(ip), true, ip);
});

test('разбор страницы: Open Graph, обычный title и относительная картинка', () => {
  const og = parsePreview(
    `<html><head><meta property="og:title" content="Котики &amp; собачки">
     <meta property="og:description" content="Лучшие фото"><meta property="og:image" content="/img/cat.jpg">
     <meta property="og:site_name" content="Зоо"><title>Запасной</title></head></html>`,
    'https://zoo.example/page'
  );
  assert.deepEqual(og, {
    url: 'https://zoo.example/page',
    title: 'Котики & собачки',
    description: 'Лучшие фото',
    image: 'https://zoo.example/img/cat.jpg',
    siteName: 'Зоо',
  });
  const plain = parsePreview('<title>  Просто страница </title><meta name="description" content="Описание">', 'https://a.ru/x');
  assert.deepEqual(plain, { url: 'https://a.ru/x', title: 'Просто страница', description: 'Описание', image: null, siteName: 'a.ru' });
  assert.equal(parsePreview('<p>без заголовка</p>', 'https://a.ru'), null);
  assert.equal(parsePreview('<meta property="og:title" content="t"><meta property="og:image" content="javascript:alert(1)">', 'https://a.ru').image, null);
});

// Сервер с разрешённым доступом к адресам этого компьютера (только для теста) и поддельный сайт
const port = 4300 + Math.floor(Math.random() * 90);
const base = `http://localhost:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sozvon-preview-'));
let proc;
let site;
let siteUrl;

before(async () => {
  site = http.createServer((req, res) => {
    if (req.url === '/page') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<meta property="og:title" content="Новости"><meta property="og:description" content="Главное за день">');
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/page' });
      return res.end();
    }
    if (req.url === '/file') {
      res.writeHead(200, { 'Content-Type': 'application/zip' });
      return res.end('PK');
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  siteUrl = `http://127.0.0.1:${site.address().port}`;
  proc = spawn(process.execPath, ['src/index.js'], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, AUTH_RATE_LIMIT: '100', INVITE_CODE: '', LINK_PREVIEW_ALLOW_PRIVATE: '1' },
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
  site.close();
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
});

async function api(method, url, body, token) {
  const res = await fetch(base + '/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('предпросмотр ссылки и превью в сообщении', async () => {
  const a = (await api('POST', '/register', { username: 'prev_a', password: 'secret11' })).body;
  const b = (await api('POST', '/register', { username: 'prev_b', password: 'secret11' })).body;
  await api('POST', '/contacts', { username: 'prev_b' }, a.token);
  await api('POST', `/friend-requests/${a.user.id}/accept`, null, b.token);

  const q = (url) => api('GET', `/link-preview?url=${encodeURIComponent(url)}`, null, a.token);
  assert.equal((await api('GET', `/link-preview?url=${encodeURIComponent(siteUrl + '/page')}`)).status, 401);
  const page = await q(`${siteUrl}/page`);
  assert.equal(page.status, 200);
  assert.deepEqual([page.body.title, page.body.description], ['Новости', 'Главное за день']);
  assert.equal((await q(`${siteUrl}/redirect`)).body.title, 'Новости', 'переадресация');
  assert.equal((await q(`${siteUrl}/file`)).body, null, 'не страница — без превью');
  assert.equal((await q('ftp://example.com/x')).status, 400);

  // Превью сохраняется в сообщении; без previewUrl — сообщение без превью (человек его убрал)
  const withPreview = await api('POST', `/messages/${b.user.id}`, { text: `${siteUrl}/page`, previewUrl: `${siteUrl}/page` }, a.token);
  assert.equal(withPreview.body.preview.title, 'Новости');
  const without = await api('POST', `/messages/${b.user.id}`, { text: `${siteUrl}/page` }, a.token);
  assert.equal(without.body.preview, null);
  // Превью можно запросить только для ссылки из самого сообщения
  const other = await api('POST', `/messages/${b.user.id}`, { text: 'привет', previewUrl: `${siteUrl}/page` }, a.token);
  assert.equal(other.body.preview, null);
});
