// Проверка без браузера: подменяем localStorage и window, загружаем модули.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const sealed = [];
globalThis.window = {
  desktop: {
    vault: {
      seal: (t) => { sealed.push(t); return 'SEALED:' + Buffer.from(t).toString('base64'); },
      open: (s) => Buffer.from(s.replace('SEALED:', ''), 'base64').toString(),
    },
  },
};
const { session } = await import('../renderer/core/session.js');
const { Api } = await import('../renderer/api.mjs');
let fail = 0;
const check = (name, cond) => { console.log((cond ? '  ✓ ' : '  ✗ ') + name); if (!cond) fail++; };

session.save({ base: 'https://s.example', token: 'T1', remember: true });
check('save: токен записан в Api', Api.token === 'T1' && Api.base === 'https://s.example');
check('save: в localStorage лежит не открытый токен, а vault', !mem.get('session').includes('T1'));
check('save: vault получил сериализованную сессию', sealed.length === 1 && sealed[0].includes('"token":"T1"'));

Api.token = ''; Api.base = '';
const loaded = session.load();
check('load: расшифровывает сессию из vault', loaded?.token === 'T1' && loaded?.base === 'https://s.example');
check('apply: восстанавливает Api', session.apply() && Api.token === 'T1');

session.clear();
check('clear: сессия стёрта', session.load() === null && Api.token === '');

globalThis.window = {};
mem.set('session', JSON.stringify({ token: 'T2', base: 'https://s.example' }));
check('без vault (веб): читает обычный JSON', session.load()?.token === 'T2');

console.log(fail ? `\nПРОВАЛЕНО: ${fail}` : '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
process.exit(fail ? 1 : 0);
