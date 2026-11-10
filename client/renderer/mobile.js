// Мобильная оболочка поверх существующего интерфейса: нижняя навигация,
// выдвижной список каналов и двухколоночный фолд. Не трогает desktop-разметку.
(() => {
  if (document.getElementById('mobile-nav')) return;

  const nav = document.createElement('nav');
  nav.id = 'mobile-nav';
  nav.setAttribute('aria-label', 'Мобильная навигация');
  nav.innerHTML = `
    <button type="button" data-mobile="home" title="Друзья">
      <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.4-3.2 2.5-5 5.5-5s5.1 1.8 5.5 5"/><path d="M16 5.4a3 3 0 0 1 0 5.4M17 15c2 .5 3.2 1.9 3.5 4"/></svg>
      <span>Друзья</span>
    </button>
    <button type="button" data-mobile="channels" title="Каналы">
      <svg viewBox="0 0 24 24"><path d="M4 5.5h16M4 12h16M4 18.5h10"/><circle cx="19" cy="18.5" r="1.6"/></svg>
      <span>Каналы</span>
    </button>
    <button type="button" data-mobile="settings" title="Настройки">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></svg>
      <span>Ещё</span>
    </button>`;
  document.body.append(nav);

  const backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.id = 'mobile-backdrop';
  backdrop.setAttribute('aria-label', 'Закрыть список каналов');
  document.body.append(backdrop);

  // Переключатель каналов: на телефоне/фолде рейл скрыт, поэтому хабы
  // выбираются горизонтальной полосой в начале списка.
  const sidebar = document.querySelector('.sidebar');
  const hubsBar = document.createElement('div');
  hubsBar.id = 'mobile-hubs';
  if (sidebar) sidebar.prepend(hubsBar);

  const renderHubs = () => {
    if (!hubsBar) return;
    const hubs = typeof state !== 'undefined' && state.hubs ? [...state.hubs.values()] : [];
    const items = [];
    const home = document.createElement('button');
    home.type = 'button';
    home.className = 'mobile-hub' + (state?.view === 'home' ? ' active' : '');
    home.textContent = 'Друзья';
    home.onclick = () => {
      if (typeof selectContact === 'function') selectContact(null);
      renderHubs();
    };
    items.push(home);
    for (const hub of hubs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mobile-hub' + (state?.view === hub.id ? ' active' : '');
      button.textContent = hub.name || 'Канал';
      button.onclick = () => {
        if (typeof openHub === 'function') openHub(hub.id);
        renderHubs();
      };
      items.push(button);
    }
    hubsBar.replaceChildren(...items);
  };
  renderHubs();
  setInterval(renderHubs, 1000);

  const buttons = [...nav.querySelectorAll('button')];
  const setActive = (name) => {
    for (const button of buttons) button.classList.toggle('active', button.dataset.mobile === name);
  };
  const hideList = () => {
    document.body.classList.remove('mobile-list');
    setActive('home');
  };
  const showList = () => {
    document.body.classList.add('mobile-list');
    setActive('channels');
    renderHubs();
  };

  nav.querySelector('[data-mobile="home"]').onclick = () => {
    hideList();
    if (typeof selectContact === 'function') selectContact(null);
    syncBack();
  };
  nav.querySelector('[data-mobile="channels"]').onclick = () => {
    if (document.body.classList.contains('mobile-list')) hideList();
    else showList();
  };
  nav.querySelector('[data-mobile="settings"]').onclick = () => {
    hideList();
    if (typeof openSettings === 'function') openSettings();
  };
  backdrop.onclick = hideList;

  // Выбор комнаты/контакта закрывает список, чтобы сразу открылся чат.
  document.addEventListener(
    'click',
    (event) => {
      if (!document.body.classList.contains('mobile-list')) return;
      if (event.target.closest('.room-row, .contact, .friend-row, .rail-home')) { hideList(); syncBack(); }
    },
    true
  );

  // Кнопка «назад» в шапке чата на телефоне возвращает к списку каналов.
  const addChatBack = () => {
    const heads = [...document.querySelectorAll('.chat-head')].filter((item) => !item.classList.contains('friends-head'));
    const head = heads.find((item) => item.getClientRects().length) || heads[0];
    if (!head || head.querySelector('.mobile-chat-back')) return;
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'icon-btn mobile-chat-back';
    back.title = 'К списку каналов';
    back.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';
    back.onclick = showList;
    head.prepend(back);
    syncBack(back);
  };
  const syncBack = (button = [...document.querySelectorAll('.mobile-chat-back')].find((item) => item.getClientRects().length) || [...document.querySelectorAll('.mobile-chat-back')].at(-1)) => {
    if (!button) return;
    const app = typeof state !== 'undefined' ? state : window.state;
    const inRoom = Boolean(app?.room || app?.selectedRoomId);
    const inChat = Boolean(inRoom || app?.selectedId);
    button.hidden = !inChat;
    if (!document.body.classList.contains('mobile-list')) setActive(inRoom ? 'channels' : 'home');
  };
  addChatBack();
  document.addEventListener('DOMContentLoaded', addChatBack);
  const observer = new MutationObserver(() => { addChatBack(); syncBack(); });
  const originalHeader = typeof window.renderChatHeader === 'function' ? window.renderChatHeader : null;
  if (originalHeader) {
    window.renderChatHeader = function (...args) {
      const result = originalHeader.apply(this, args);
      setTimeout(() => syncBack(), 0);
      return result;
    };
  }
  setInterval(() => syncBack(), 250);
  observer.observe(document.body, { childList: true, subtree: true });

  if (typeof window !== 'undefined' && !window.desktop && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
})();
