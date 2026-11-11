// Вход без сервера: fetch подменяется, проверяем запросы и сохранение сессии.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
globalThis.window = {};

const calls = [];
let reply = { ok: true, status: 200, body: {} };
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), method: opts.method, body: opts.body && JSON.parse(opts.body) });
  return {
    ok: reply.ok,
    status: reply.status,
    json: async () => reply.body,
  };
};

const { auth } = await import('../renderer/core/auth.js');
const { Api } = await import('../renderer/api.mjs');

let fail = 0;
const check = (name, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : ' — ' + extra));
  if (!cond) fail++;
};

auth.setServer('https://s.example/');
check('setServer убирает слэш', auth.server === 'https://s.example');
auth.setServer('');
check('пустой адрес → сервер по умолчанию', auth.server === 'https://135-106-226-12.sslip.io');

reply = { ok: true, status: 200, body: { token: 'T1', user: { displayName: 'Аня', id: 7 } } };
const user = await auth.login({ username: 'a@b.c', password: 'secret', remember: true });
check('login: пост на /login', calls.at(-1).url.endsWith('/api/login') && calls.at(-1).method === 'POST');
check('login: тело запроса', calls.at(-1).body.username === 'a@b.c' && calls.at(-1).body.password === 'secret');
check('login: вернулся профиль', user.displayName === 'Аня');
check('login: токен в Api', Api.token === 'T1');
check('login: сессия сохранена', JSON.parse(mem.get('session')).token === 'T1');

// Двухфакторный вход: сервер просит код, ошибка уходит наверх с данными.
reply = { ok: false, status: 401, body: { error: 'Нужен код', needTotp: true } };
let caught = null;
try {
  await auth.login({ username: 'a@b.c', password: 'secret' });
} catch (err) {
  caught = err;
}
check('login: ошибка проброшена', caught?.message === 'Нужен код', String(caught));
check('login: признак needTotp доходит до экрана', caught?.data?.needTotp === true, JSON.stringify(caught?.data));

// Ошибка входа не должна затирать уже сохранённую сессию прошлого успешного входа.
check('login: неудача не стёрла сессию', JSON.parse(mem.get('session')).token === 'T1');

reply = { ok: true, status: 200, body: { token: 'T2', user: { id: 9 } } };
await auth.register({ email: 'x@y.z', password: 'secret1', displayName: 'Боб', code: '0000' });
check('register: пост на /register', calls.at(-1).url.endsWith('/api/register'));
check('register: код приглашения и код письма в теле',
  calls.at(-1).body.code === '0000' && calls.at(-1).body.inviteCode === '');
check('register: новый токен сохранён', JSON.parse(mem.get('session')).token === 'T2');

// Провайдеры: сеть недоступна — пустой список, а не падение.
globalThis.fetch = async () => { throw new Error('offline'); };
check('providers: без сети возвращает []', (await auth.providers()).length === 0);

console.log(fail ? `\nПРОВАЛЕНО: ${fail}` : '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
process.exit(fail ? 1 : 0);
