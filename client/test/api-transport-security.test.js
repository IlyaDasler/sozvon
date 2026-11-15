const test = require('node:test');
const assert = require('node:assert/strict');

test('API refuses remote HTTP before sending credentials', async () => {
  globalThis.window = { desktop: { version: 'test' } };
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; throw new Error('fetch should not run'); };
  const { Api } = await import('../renderer/api.mjs');
  Api.base = 'http://attacker.example:3000';
  Api.token = 'sensitive-session-token';
  await assert.rejects(Api.get('/me'), /HTTPS/);
  assert.equal(fetchCalls, 0);

  Api.base = 'http://localhost:3000';
  await assert.rejects(Api.post('/me'), (error) => error.network === true);
  assert.equal(fetchCalls, 1);

});
