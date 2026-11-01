// Превью ссылки делает приложение отправителя (переписка зашифрована — сервер ссылок не видит).
// Разбор страницы тот же, что был на сервере: Open Graph или <title>, описание, картинка, сайт
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePreview, previewableUrl } = require('../link-preview');

test('Open Graph: заголовок, описание, картинка по относительному адресу, название сайта', () => {
  const html = `<html><head>
    <meta property="og:title" content="Игра &laquo;Ночь&raquo;">
    <meta property="og:description" content="  Описание
      в две строки ">
    <meta property="og:image" content="/img/cover.png">
    <meta property="og:site_name" content="Steam">
    <title>Запасной</title></head></html>`;
  assert.deepEqual(parsePreview(html, 'https://store.example.com/app/1'), {
    url: 'https://store.example.com/app/1',
    title: 'Игра «Ночь»',
    description: 'Описание в две строки',
    image: 'https://store.example.com/img/cover.png',
    siteName: 'Steam',
    video: null,
  });
});

test('og:video: ссылка на само видео попадает в превью, чтобы в чате игралось напрямую', () => {
  const html = `<html><head>
    <meta property="og:title" content="Ролик">
    <meta property="og:video" content="https://cdn.example.com/game/trailer.mp4">
    </head></html>`;
  assert.equal(parsePreview(html, 'https://example.com/post').video, 'https://cdn.example.com/game/trailer.mp4');

  // Не видео — не подставляем: иначе в чате появится битый плеер
  const page = parsePreview('<html><head><meta property="og:title" content="Страница"><meta property="og:video" content="https://example.com/player"></head></html>', 'https://example.com/p');
  assert.equal(page.video, null);
});

test('без Open Graph — <title> и адрес сайта; без заголовка — превью нет; картинка только http(s)', () => {
  const p = parsePreview('<title>Просто страница</title><meta property="og:image" content="javascript:alert(1)">', 'https://www.ya.ru/x');
  assert.equal(p.title, 'Просто страница');
  assert.equal(p.siteName, 'ya.ru');
  assert.equal(p.image, null);
  assert.equal(parsePreview('<p>без заголовка</p>', 'https://a.b/'), null);
});

test('превью — только для http и https', () => {
  assert.ok(previewableUrl('https://ya.ru'));
  assert.equal(previewableUrl('file:///C:/secret.txt'), null);
  assert.equal(previewableUrl('javascript:alert(1)'), null);
});

test('приватные адреса не годятся для превью: внутрь домашней сети приложение не ходит', () => {
  const bad = ['http://127.0.0.1:3000/api/health', 'http://192.168.1.1/', 'http://10.0.0.5/', 'http://172.16.0.1/', 'http://localhost/', 'http://router.local/'];
  for (const url of bad) assert.equal(previewableUrl(url), null, url);
  assert.ok(previewableUrl('https://example.com/page'));
});
