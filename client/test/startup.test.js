// Запуск как у Discord: окошко загрузки проверяет обновления; новая версия — скачать и поставить,
// нет её, нет сети или проверка затянулась — открыть приложение
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { runStartup } = require('../startup');

function fakeUpdater(script) {
  const u = new EventEmitter();
  u.downloads = 0;
  u.checkForUpdates = () => {
    setImmediate(() => script.check?.(u));
    return Promise.resolve();
  };
  u.downloadUpdate = () => {
    u.downloads++;
    setImmediate(() => script.download?.(u));
    return Promise.resolve();
  };
  return u;
}

const run = (updater, timeoutMs = 1000) => {
  const shown = [];
  return runStartup(updater, { onStatus: (s) => shown.push(s), timeoutMs }).then((result) => ({ result, shown }));
};

test('новой версии нет — запускаем приложение', async () => {
  const u = fakeUpdater({ check: (u) => u.emit('update-not-available', {}) });
  const { result, shown } = await run(u);
  assert.equal(result, 'start');
  assert.deepEqual(shown.map((s) => s.state), ['checking', 'starting']);
  assert.equal(u.downloads, 0);
});

test('есть новая версия — качаем с процентами и ставим', async () => {
  const u = fakeUpdater({
    check: (u) => u.emit('update-available', { version: '2.4.2' }),
    download: (u) => {
      u.emit('download-progress', { percent: 41.6 });
      u.emit('update-downloaded', { version: '2.4.2' });
    },
  });
  const { result, shown } = await run(u);
  assert.equal(result, 'install');
  assert.deepEqual(shown, [
    { state: 'checking' },
    { state: 'downloading', version: '2.4.2', percent: 0 },
    { state: 'downloading', version: '2.4.2', percent: 42 },
    { state: 'installing', version: '2.4.2' },
  ]);
});

test('ошибка проверки (нет сети) — запускаем приложение', async () => {
  const u = fakeUpdater({ check: (u) => u.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED')) });
  assert.equal((await run(u)).result, 'start');
});

test('проверка затянулась — не держим человека, запускаем', async () => {
  const u = fakeUpdater({});
  const started = Date.now();
  assert.equal((await run(u, 50)).result, 'start');
  assert.ok(Date.now() - started < 1000);
});

test('скачивание сорвалось — запускаем приложение, обновление предложат позже', async () => {
  const u = fakeUpdater({
    check: (u) => u.emit('update-available', { version: '2.4.2' }),
    download: (u) => u.emit('error', new Error('обрыв')),
  });
  assert.equal((await run(u)).result, 'start');
});

test('после запуска события обновления больше не трогают окно загрузки', async () => {
  const u = fakeUpdater({ check: (u) => u.emit('update-not-available', {}) });
  const { shown } = await run(u);
  u.emit('update-available', { version: '9.9.9' });
  assert.equal(shown.length, 2);
});
