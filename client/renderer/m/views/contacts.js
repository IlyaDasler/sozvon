// Список контактов. Возвращает функцию обновления.
import { contacts, isAvailable, statusLabel } from '../../core/contacts.js';

const avatar = (contact) => {
  const el = document.createElement('div');
  el.className = 'm-avatar';
  el.style.backgroundColor = contact.avatarColor || 'var(--m-surface-2)';
  if (contact.avatarUrl) {
    el.classList.add('m-avatar--image');
    el.style.backgroundImage = `url("${contact.avatarUrl}")`;
  } else {
    el.textContent = (contact.displayName || contact.username || '?').trim().charAt(0).toUpperCase();
  }
  el.dataset.presence = isAvailable(contact) ? 'on' : 'off';
  return el;
};

const row = (contact, unreadCount, onOpen) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'm-row m-row--contact';

  const main = document.createElement('div');
  main.className = 'm-row__main';
  const title = document.createElement('p');
  title.className = 'm-row__title';
  title.textContent = contact.displayName || contact.username;
  const sub = document.createElement('p');
  sub.className = 'm-row__sub';
  sub.textContent = statusLabel(contact);
  main.append(title, sub);

  button.append(avatar(contact), main);

  if (unreadCount) {
    const badge = document.createElement('span');
    badge.className = 'm-badge';
    badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
    button.append(badge);
  }

  button.onclick = () => onOpen?.(contact);
  return button;
};

export function mountContacts(container, { onOpen } = {}) {
  const list = document.createElement('div');
  list.className = 'm-list';
  container.append(list);

  const refresh = async () => {
    // Скелетон на время загрузки: пустой экран выглядит как зависание.
    if (!list.childElementCount) {
      for (let i = 0; i < 6; i++) {
        const bone = document.createElement('div');
        bone.className = 'm-skeleton m-skeleton--row';
        list.append(bone);
      }
    }

    let people = [];
    let unread = { dm: new Map() };
    try {
      [people, unread] = await Promise.all([contacts.list(), contacts.unread()]);
    } catch (err) {
      list.replaceChildren();
      const empty = document.createElement('div');
      empty.className = 'm-empty';
      empty.textContent = err.network ? 'Нет связи с сервером' : err.message || 'Не удалось загрузить контакты';
      list.append(empty);
      return;
    }

    list.replaceChildren();
    if (!people.length) {
      const empty = document.createElement('div');
      empty.className = 'm-empty';
      empty.textContent = 'Пока никого. Добавьте друга по логину.';
      list.append(empty);
      return;
    }

    const available = people.filter(isAvailable);
    const offline = people.filter((c) => !isAvailable(c));
    const section = (title, items) => {
      if (!items.length) return;
      const head = document.createElement('h2');
      head.className = 'm-section__title';
      head.textContent = title;
      list.append(head);
      for (const contact of items) list.append(row(contact, unread.dm.get(contact.id), onOpen));
    };
    section('В сети', available);
    section('Не в сети', offline);
  };

  return refresh;
}
