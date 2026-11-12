// Настройки мобильного слоя: профиль и выход. Остальные разделы — в следующих этапах.
import { session } from '../../core/session.js';

const row = (title, sub, onClick, danger = false) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `m-row${danger ? ' m-row--danger' : ''}`;
  const main = document.createElement('div');
  main.className = 'm-row__main';
  const t = document.createElement('p');
  t.className = 'm-row__title';
  t.textContent = title;
  main.append(t);
  if (sub) {
    const s = document.createElement('p');
    s.className = 'm-row__sub';
    s.textContent = sub;
    main.append(s);
  }
  button.append(main);
  button.onclick = onClick;
  return button;
};

export function mountSettings(container, { user, onLogout, onCamera }) {
  const list = document.createElement('div');
  list.className = 'm-list';

  const head = document.createElement('h2');
  head.className = 'm-section__title';
  head.textContent = 'Профиль';

  const who = document.createElement('div');
  who.className = 'm-row m-row--static';
  const main = document.createElement('div');
  main.className = 'm-row__main';
  const name = document.createElement('p');
  name.className = 'm-row__title';
  name.textContent = user.displayName || user.username;
  const login = document.createElement('p');
  login.className = 'm-row__sub';
  login.textContent = `@${user.username}`;
  main.append(name, login);
  who.append(main);

  const exitHead = document.createElement('h2');
  exitHead.className = 'm-section__title';
  exitHead.textContent = 'Аккаунт';

  const logout = () => {
    session.clear();
    onLogout?.();
  };

  list.append(
    head,
    who,
    row('Проверка камеры', 'Фронтальная и тыловая', onCamera),
    exitHead,
    row('Выйти из аккаунта', null, logout, true)
  );
  container.replaceChildren(list);
}
