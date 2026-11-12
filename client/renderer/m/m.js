// Точка входа мобильного слоя. Грузится только по флагу (см. m/boot.js).
import { session } from '../core/session.js';
import { createNav } from '../core/nav.js';
import { mountAuth } from './views/auth.js';
import { mountContacts } from './views/contacts.js';
import { mountChannels, mountRoomChat } from './views/channels.js';
import { mountChat } from './views/chat.js';
import { mountSettings } from './views/settings.js';
import { mountCamera } from './views/camera.js';

const root = document.createElement('div');
root.className = 'm-app';
root.id = 'm-app';
// Включаем только новый слой: старый DOM остаётся в памяти для обратной совместимости,
// но не рисуется и не перехватывает касания.
document.body.classList.add('m-shell');
const hideForeign = (el) => {
  if (!el || el.nodeType !== 1 || el === root) return;
  el.style.display = 'none';
  el.style.visibility = 'hidden';
  el.style.pointerEvents = 'none';
};
for (const el of [...document.body.children]) hideForeign(el);
document.body.append(root);
// Старый слой может добавлять тосты и модалки после старта — не даём им всплыть.
new MutationObserver((items) => {
  for (const item of items) for (const node of item.addedNodes) hideForeign(node);
}).observe(document.body, { childList: true });

// Разделы, между которыми переключает нижняя навигация.
const TABS = [
  { id: 'chats', label: 'Чаты', icon: '<path d="M20.5 11.6a8.4 8.4 0 0 1-9 8.4 8.7 8.7 0 0 1-3.4-.7L3.5 21l1.6-4.6a8.3 8.3 0 0 1-.6-3.1 8.4 8.4 0 0 1 8.4-8.4 8.4 8.4 0 0 1 8.6 8.3z"/>' },
  { id: 'channels', label: 'Каналы', icon: '<path d="M4 6h16M4 12h16M4 18h10"/>' },
  { id: 'settings', label: 'Настройки', icon: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2m0 14v2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M3 12h2m14 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>' },
];

let nav = null;
let currentUser = null;
let screenCleanup = null;

const topbar = (title, onBack) => {
  const bar = document.createElement('header');
  bar.className = 'm-topbar';
  if (onBack) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'm-iconbtn';
    back.setAttribute('aria-label', 'Назад');
    back.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>';
    back.onclick = onBack;
    bar.append(back);
  }
  const h = document.createElement('h1');
  h.className = 'm-topbar__title';
  h.textContent = title;
  bar.append(h);
  return bar;
};

const navbar = (active, onSelect) => {
  const bar = document.createElement('nav');
  bar.className = 'm-nav';
  bar.setAttribute('aria-label', 'Основная навигация');
  for (const tab of TABS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'm-nav__item';
    if (tab.id === active) button.setAttribute('aria-current', 'page');
    button.innerHTML = `<svg viewBox="0 0 24 24">${tab.icon}</svg><span>${tab.label}</span>`;
    button.onclick = () => onSelect(tab.id);
    bar.append(button);
  }
  return bar;
};

const renderAuth = () => {
  nav = null;
  screenCleanup?.();
  screenCleanup = null;
  root.replaceChildren();
  const screen = document.createElement('main');
  screen.className = 'm-screen m-screen--auth';
  root.append(screen);
  mountAuth(screen, { onSuccess: (user) => startApp(user) });
};

// Экран с шапкой, содержимым и нижней навигацией.
const renderTab = (name, title, mount) => {
  root.replaceChildren();
  const screen = document.createElement('main');
  screen.className = 'm-screen';
  root.append(topbar(title), screen, navbar(name, switchTab));
  mount(screen);
};

const switchTab = (name) => {
  if (!nav) return;
  if (nav.current.name !== name) nav.push({ name });
  draw();
};

const openChat = (contact) => {
  if (!nav) return;
  nav.push({ name: 'chat', peerId: contact.id, contact });
  draw();
};

const openRoom = (room, hub) => {
  if (!nav) return;
  nav.push({ name: 'room', room, hub });
  draw();
};

const draw = () => {
  if (!nav || !currentUser) return;
  const route = nav.current;
  screenCleanup?.();
  screenCleanup = null;

  if (route.name === 'room') {
    root.replaceChildren();
    mountRoomChat(root, {
      room: route.room,
      meId: currentUser.id,
      serverPublicKey: currentUser.publicKey,
      onBack: goBack,
    });
    return;
  }

  if (route.name === 'chat') {
    root.replaceChildren();
    mountChat(root, {
      meId: currentUser.id,
      peer: route.contact,
      serverPublicKey: currentUser.publicKey,
      onBack: goBack,
    });
    return;
  }

  if (route.name === 'channels') {
    renderTab('channels', 'Каналы', (screen) =>
      mountChannels(screen, { onOpenRoom: (room, hub) => openRoom(room, hub) })
    );
    return;
  }

  if (route.name === 'settings') {
    renderTab('settings', 'Настройки', (screen) =>
      mountSettings(screen, {
        user: currentUser,
        onLogout: renderAuth,
        onCamera: () => { nav.push({ name: 'camera' }); draw(); },
      })
    );
    return;
  }

  if (route.name === 'camera') {
    root.replaceChildren();
    screenCleanup = mountCamera(root, { onBack: goBack });
    return;
  }

  renderTab('chats', 'Чаты', (screen) => {
    mountContacts(screen, { onOpen: openChat })();
  });
};

// Единый назад: сначала свой стек, потом то, что уже умеет старый mobile.js.
const goBack = () => {
  const prev = nav?.back();
  if (prev) {
    draw();
    return true;
  }
  return false;
};

const startApp = (user) => {
  currentUser = user;
  nav = createNav({ name: 'chats' });
  draw();

  // Не затираем обработчик старой оболочки: сначала пробуем свой стек,
  // затем отдаём событие ему (шторки, полноэкранные просмотры), затем системе.
  const previous = window.mobileBack;
  window.mobileBack = () => goBack() || (typeof previous === 'function' ? previous() : false);
};

const saved = session.load();
if (saved) {
  session.apply(saved);
  session
    .verify()
    .then((user) => (user ? startApp(user) : renderAuth()))
    .catch(() => renderAuth());
} else {
  renderAuth();
}
