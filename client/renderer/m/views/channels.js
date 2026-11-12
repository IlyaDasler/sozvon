// Каналы в новом мобильном слое: список каналов и их комнат, только чтение.
import { hubs } from '../../core/hubs.js';
import { messages } from '../../core/messages.js';

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

const roomRow = (room, onOpen) => {
  const row = el('button', 'm-room');
  row.type = 'button';
  row.append(el('span', 'm-room__icon', room.kind === 'voice' ? '🔊' : '#'));
  const main = el('span', 'm-room__main');
  main.append(el('span', 'm-room__name', room.name));
  row.append(main);
  row.onclick = () => onOpen(room);
  return row;
};

export function mountChannels(container, { onOpenRoom }) {
  const screen = el('div', 'm-channels');
  const status = el('p', 'm-empty', 'Загрузка каналов…');
  screen.append(status);
  container.append(screen);
  (async () => {
    let tree;
    try {
      tree = await hubs.tree();
    } catch (err) {
      status.textContent = err.message || 'Не удалось загрузить каналы';
      return;
    }
    screen.replaceChildren();
    if (!tree.length) {
      screen.append(el('p', 'm-empty', 'Каналов пока нет.'));
      return;
    }
    for (const hub of tree) {
      const section = el('section', 'm-hub');
      const head = el('div', 'm-hub__head');
      const avatar = el('span', 'm-hub__avatar', (hub.name || '?').slice(0, 2).toUpperCase());
      if (hub.iconUrl) {
        const img = el('img');
        img.src = hub.iconUrl;
        img.alt = '';
        avatar.replaceChildren(img);
      }
      head.append(avatar, el('b', 'm-hub__name', hub.name));
      section.append(head);
      if (!hub.rooms.length) section.append(el('p', 'm-muted', 'Комнат нет'));
      for (const room of hub.rooms) section.append(roomRow(room, (r) => onOpenRoom(r, hub)));
      screen.append(section);
    }
  })();
}

const bubble = (m, meId) => {
  const wrap = el('div', 'm-msg');
  const who = m.fromId === meId ? 'Вы' : m.fromName || 'Участник';
  wrap.append(el('div', 'm-msg__author', who));
  const text = m.plain?.text || (m.locked ? 'Сообщение зашифровано на другом устройстве' : m.text || '');
  wrap.append(el('div', 'm-msg__text', text || 'Вложение'));
  return wrap;
};

export function mountRoomChat(container, { room, meId, serverPublicKey, onBack }) {
  const bar = el('header', 'm-topbar');
  const back = el('button', 'm-iconbtn');
  back.type = 'button';
  back.setAttribute('aria-label', 'Назад');
  back.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>';
  back.onclick = onBack;
  bar.append(back, el('h1', 'm-topbar__title', room.name || 'Комната'));
  const screen = el('main', 'm-screen m-screen--room');
  const list = el('div', 'm-msgs');
  screen.append(list);
  container.replaceChildren(bar, screen);
  const status = el('p', 'm-empty', 'Загрузка…');
  list.append(status);
  (async () => {
    try {
      const rows = await messages.roomHistory({ roomId: room.id, meId, serverPublicKey });
      if (!rows.length) {
        status.textContent = 'Сообщений пока нет';
        return;
      }
      list.replaceChildren(...rows.map((m) => bubble(m, meId)));
      screen.scrollTop = screen.scrollHeight;
    } catch (err) {
      status.textContent = err.message || 'Не удалось загрузить комнату';
    }
  })();
}
