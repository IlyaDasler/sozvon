// Экран переписки. Расшифровка — в core/messages.js; здесь только показ.
import { messages } from '../../core/messages.js';

const time = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

const LOCKED = {
  'no-identity': 'Ключ шифрования на другом устройстве',
  'no-key': 'Ключ переписки ещё не получен',
  broken: 'Сообщение не удалось расшифровать',
};

const bubble = (m, meId) => {
  const el = document.createElement('div');
  const mine = m.fromId === meId;
  el.className = `m-msg${mine ? ' m-msg--mine' : ''}`;

  const text = document.createElement('p');
  text.className = 'm-msg__text';
  if (m.plain?.text) {
    text.textContent = m.plain.text;
  } else if (m.locked) {
    text.textContent = LOCKED[m.locked] || LOCKED['no-key'];
    text.classList.add('m-msg__text--locked');
  } else {
    text.textContent = m.text || '';
  }

  const meta = document.createElement('span');
  meta.className = 'm-msg__time';
  meta.textContent = time(m.createdAt);

  el.append(text, meta);
  return el;
};

export function mountChat(container, { meId, peer, serverPublicKey, onBack }) {
  const bar = document.createElement('header');
  bar.className = 'm-topbar';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'm-iconbtn';
  back.setAttribute('aria-label', 'Назад');
  back.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>';
  back.onclick = () => onBack?.();
  const title = document.createElement('h1');
  title.className = 'm-topbar__title';
  title.textContent = peer.displayName || peer.username;
  bar.append(back, title);

  const screen = document.createElement('main');
  screen.className = 'm-screen m-screen--chat';
  const list = document.createElement('div');
  list.className = 'm-msgs';
  screen.append(list);

  container.replaceChildren(bar, screen);

  const showStatus = (text) => {
    list.replaceChildren();
    const note = document.createElement('div');
    note.className = 'm-empty';
    note.textContent = text;
    list.append(note);
  };

  (async () => {
    showStatus('Загрузка…');
    let history;
    try {
      history = await messages.dmHistory({ meId, peerId: peer.id, serverPublicKey });
    } catch (err) {
      showStatus(err.network ? 'Нет связи с сервером' : err.message || 'Не удалось загрузить переписку');
      return;
    }
    if (!history.length) {
      showStatus('Пока пусто. Напишите первым.');
      return;
    }
    list.replaceChildren(...history.map((m) => bubble(m, meId)));
    screen.scrollTop = screen.scrollHeight;
  })();
}
