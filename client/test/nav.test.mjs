// Стек экранов: порядок, повтор, возврат, сброс.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { createNav } = await import('../renderer/core/nav.js');

let fail = 0;
const check = (name, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : ' — ' + extra));
  if (!cond) fail++;
};

const nav = createNav({ name: 'chats' });

check('старт: корень — чаты', nav.current.name === 'chats' && nav.depth === 1);
check('back на корне отдаёт событие системе', nav.back() === null);

nav.push({ name: 'chat', peerId: 2 });
check('push: открылся чат', nav.current.name === 'chat' && nav.depth === 2);

const back = nav.back();
check('back из чата возвращает в список', back.name === 'chats' && nav.depth === 1);
check('back из чата не отдаёт событие системе', back !== null);

nav.push({ name: 'settings' });
nav.push({ name: 'settings' });
check('повтор того же раздела не плодит шагов', nav.depth === 2);

nav.push({ name: 'chat', peerId: 5 });
nav.push({ name: 'chat', peerId: 5 });
check('одинаковые чаты — отдельные шаги', nav.depth === 4);

nav.reset({ name: 'auth' });
check('reset: один экран', nav.depth === 1 && nav.current.name === 'auth');
check('reset: back на корне отдаёт событие', nav.back() === null);

console.log(fail ? `\nПРОВАЛЕНО: ${fail}` : '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
process.exit(fail ? 1 : 0);
