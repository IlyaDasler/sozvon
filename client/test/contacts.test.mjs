// Контакты и непрочитанное: сортировка, статусы, разбор /unread. Сеть подменяется.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
globalThis.window = {};

let reply = null;
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), method: opts.method });
  if (reply instanceof Error) throw reply;
  return { ok: true, status: 200, json: async () => reply };
};

const { contacts, presenceOf, isAvailable, statusLabel } = await import('../renderer/core/contacts.js');
const { Api } = await import('../renderer/api.mjs');
Api.base = 'https://s.example';
Api.token = 'T';

let fail = 0;
const check = (name, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : ' — ' + extra));
  if (!cond) fail++;
};

check('presenceOf: поле status важнее online', presenceOf({ status: 'dnd', online: false }) === 'dnd');
check('presenceOf: старый сервер — только online', presenceOf({ online: true }) === 'online');
check('presenceOf: нет данных — offline', presenceOf({}) === 'offline');
check('isAvailable: offline недоступен', !isAvailable({ online: false }));
check('isAvailable: invisible доступен (как в десктопе)', isAvailable({ status: 'invisible' }));
check('statusLabel: русская подпись', statusLabel({ status: 'dnd' }) === 'Не беспокоить');

reply = [
  { id: 1, displayName: 'Борис', username: 'b', online: false },
  { id: 2, displayName: 'Анна', username: 'a', online: true },
  { id: 3, displayName: 'Вера', username: 'v', status: 'idle' },
  { id: 4, displayName: 'Аристарх', username: 'ar', online: true },
];
const list = await contacts.list();
check('list: GET /contacts', calls.at(-1).url.endsWith('/api/contacts') && calls.at(-1).method === 'GET', calls.at(-1).url);
// Вера в статусе idle — она доступна, поэтому в верхней группе трое.
check('list: в сети выше, offline ниже', list.slice(0, 3).every(isAvailable) && !isAvailable(list[3]));
check('list: внутри группы — по алфавиту ru', list.map((c) => c.displayName).join(',') === 'Анна,Аристарх,Вера,Борис',
  list.map((c) => c.displayName).join(','));
check('list: исходный массив не мутирован', reply[0].id === 1);

reply = { dm: [{ peerId: 2, count: 3, lastId: 90, lastRead: 80 }], rooms: [{ roomId: 7, count: 12, lastId: 5, lastRead: 0 }] };
const unread = await contacts.unread();
check('unread: личные счётчики по peerId', unread.dm.get(2) === 3);
check('unread: счётчики комнат по roomId', unread.rooms.get(7) === 12);

reply = new Error('offline');
const broken = await contacts.unread();
check('unread: сеть упала — пустые счётчики, не исключение', broken.dm.size === 0 && broken.rooms.size === 0);

console.log(fail ? `\nПРОВАЛЕНО: ${fail}` : '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
process.exit(fail ? 1 : 0);
