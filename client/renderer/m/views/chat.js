// Экран переписки. Расшифровка — в core/messages.js; здесь только показ.
import { messages } from '../../core/messages.js';
import { sendDm } from '../../core/send.js';

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

  const form = document.createElement('form');
  form.className = 'm-composer';
  const input = document.createElement('textarea');
  input.rows = 1;
  input.maxLength = 2000;
  input.placeholder = 'Сообщение';
  input.className = 'm-composer__input';
  const send = document.createElement('button');
  send.type = 'submit';
  send.className = 'm-composer__send';
  send.setAttribute('aria-label', 'Отправить');
  send.innerHTML = '<svg viewBox="0 0 24 24"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>';
  form.append(input, send);

  container.replaceChildren(bar, screen, form);

  const showStatus = (text) => {
    list.replaceChildren();
    const note = document.createElement('div');
    note.className = 'm-empty';
    note.textContent = text;
    list.append(note);
  };

  let sendBusy = false;
  let loaded = false;
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (sendBusy) return;
    const text = input.value.trim();
    if (!text) return;
    sendBusy = true;
    send.disabled = true;
    input.disabled = true;
    try {
      const saved = await sendDm(peer.id, text, meId);
      if (!loaded) list.replaceChildren();
      list.append(bubble(saved, meId));
      input.value = '';
      screen.scrollTop = screen.scrollHeight;
      loaded = true;
    } catch (err) {
      const note = document.createElement('div');
      note.className = 'm-composer__error';
      note.textContent = err.message || 'Не удалось отправить';
      list.append(note);
      screen.scrollTop = screen.scrollHeight;
    } finally {
      sendBusy = false;
      send.disabled = false;
      input.disabled = false;
      input.focus();
    }
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
      loaded = true;
      return;
    }
    list.replaceChildren(...history.map((m) => bubble(m, meId)));
    loaded = true;
    screen.scrollTop = screen.scrollHeight;
  })();
}
