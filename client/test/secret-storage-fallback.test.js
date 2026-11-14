const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createStore(vault) {
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  const start = app.indexOf('const isSecret =');
  const end = app.indexOf('/** Старые настройки звука:', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const values = new Map();
  const localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  const context = { window: { desktop: vault ? { vault } : undefined }, localStorage };
  context.globalThis = context;
  vm.runInNewContext(`${app.slice(start, end)}\nglobalThis.testStore = store;`, context);
  return { store: context.testStore, values };
}

test('desktop does not save a new session in plaintext if vault encryption fails', () => {
  const { store, values } = createStore({ seal: () => null, open: () => null });
  store.set('session', { base: 'https://server.test', token: 'secret' });
  assert.equal(values.has('session'), false);
});

test('desktop discards a legacy plaintext session if it cannot migrate it to the vault', () => {
  const { store, values } = createStore({ seal: () => null, open: () => null });
  values.set('session', JSON.stringify({ base: 'https://server.test', token: 'secret' }));
  assert.equal(store.get('session', null), null);
  assert.equal(values.has('session'), false);
});

test('desktop migrates a legacy plaintext session when vault encryption succeeds', () => {
  const { store, values } = createStore({ seal: () => 'ciphertext', open: () => null });
  const session = { base: 'https://server.test', token: 'secret' };
  values.set('session', JSON.stringify(session));
  assert.equal(JSON.stringify(store.get('session', null)), JSON.stringify(session));
  assert.equal(JSON.parse(values.get('session')).vault, 'ciphertext');
});
