// Мобильная оболочка PWA: вкладки, жесты, уведомления отдельным экраном.
// Внутренний экран фолда — рабочий стол (рейл + комнаты + чат), снаружи — телефон.
(() => {
  if (document.getElementById('mobile-nav')) return;

  if (!window.desktop) document.documentElement.classList.add('pwa');

  // На телефоне клавиатура открывается только тапом по полю. Любой
  // программный focus() (открытие раздела, модалки, шага 2FA) блокируем.
  {
    let pointerOnField = false;
    const markPointer = (event) => {
      const target = event.target;
      pointerOnField = Boolean(target?.closest?.('input, textarea, [contenteditable="true"]'));
    };
    document.addEventListener('pointerdown', markPointer, true);
    document.addEventListener('touchstart', markPointer, { capture: true, passive: true });
    document.addEventListener('pointerup', () => setTimeout(() => { pointerOnField = false; }, 0), true);
    const nativeFocus = HTMLElement.prototype.focus;
    const guardedFocus = function (...args) {
      const editable = this.matches?.('input, textarea, [contenteditable="true"]');
      const mobile = window.matchMedia('(max-width: 1000px)').matches;
      if (mobile && editable && !pointerOnField && document.activeElement !== this) return;
      return nativeFocus.apply(this, args);
    };
    guardedFocus.__sozvonGuard = true;
    Object.defineProperty(HTMLElement.prototype, 'focus', {
      value: guardedFocus,
      configurable: true,
      writable: true,
    });
  }

  const transition = (fn) => {
    if (innerWidth > 1000 && typeof document.startViewTransition === 'function' && document.documentElement.dataset.performance === 'high' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.startViewTransition(fn);
    } else {
      fn();
    }
  };
  // В мобильных листах не должно быть десктопных подсказок клавиш:
  // «Удалить (Shift — без вопроса)» превращается в «Удалить».
  const touchLabel = (text) =>
    String(text || '')
      .replace(/\s*\([^)]*(?:Shift|Ctrl|Alt|Esc|Enter|Cmd|⌘|клавиш|без вопроса)[^)]*\)\s*$/i, '')
      .trim();

  // Клавиатура: VisualViewport уменьшает видимую высоту. Прячем нижнюю
  // навигацию, чтобы она не оказалась поверх поля ввода.
  const syncKeyboard = () => {
    const vv = window.visualViewport;
    const active = document.activeElement;
    const typing = active?.matches?.('input, textarea, [contenteditable="true"]');
    const keyboard = Boolean(vv && typing && vv.height < innerHeight - 120);
    document.body.classList.toggle('keyboard-open', keyboard);
  };
  window.visualViewport?.addEventListener('resize', syncKeyboard);
  document.addEventListener('focusin', syncKeyboard);
  document.addEventListener('focusout', () => setTimeout(syncKeyboard, 80));

  const buzz = (ms = 8) => {
    if (navigator.userActivation?.isActive) navigator.vibrate?.(ms);
  };

  // На телефоне в title не должно быть десктопных Ctrl/Shift/Esc.
  const cleanTitle = (value) =>
    String(value || '').replace(/\s*\((?:[^)]*(?:Shift|Ctrl|Alt|Esc|Enter|Cmd|⌘|мыш|клавиш)[^)]*)\)\s*$/i, '').trim();
  // glass-tabs.js продолжает пересоздавать плавающую капсулу даже после
  // display:none в теме. На телефоне удаляем её физически: вкладка = underline.
  const removeMobileIndicators = () => {
    for (const el of document.querySelectorAll('#privacy-subnav .glass-tab-indicator, #set-nav .glass-tab-indicator')) {
      el.remove();
    }
  };
  removeMobileIndicators();
  new MutationObserver(removeMobileIndicators).observe(document.body, { childList: true, subtree: true });

  const cleanTitles = () => {
    for (const el of document.querySelectorAll('[title]')) {
      const next = cleanTitle(el.title);
      if (next && next !== el.title) el.title = next;
    }
  };
  cleanTitles();
  new MutationObserver(cleanTitles).observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['title'],
  });

  const authCard = document.querySelector('#auth .auth-card, #auth form, #auth');
  if (authCard && !document.getElementById('auth-build-version')) {
    const version = document.createElement('div');
    version.id = 'auth-build-version';
    version.textContent = 'Версия 1.0.124';
    authCard.append(version);
  }

  const nav = document.createElement('nav');
  nav.id = 'mobile-nav';
  nav.setAttribute('aria-label', 'Мобильная навигация');
  nav.innerHTML = `
    <span class="mobile-nav-pill" aria-hidden="true"></span>
    <button type="button" data-mobile="home" title="Друзья">
      <span class="mobile-nav-icon"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.4-3.2 2.5-5 5.5-5s5.1 1.8 5.5 5"/><path d="M16 5.4a3 3 0 0 1 0 5.4M17 15c2 .5 3.2 1.9 3.5 4"/></svg></span>
      <span class="mobile-nav-label">Друзья</span>
    </button>
    <button type="button" data-mobile="channels" title="Каналы">
      <span class="mobile-nav-icon"><svg viewBox="0 0 24 24"><path d="M4 5.5h16M4 12h16M4 18.5h10"/><circle cx="19" cy="18.5" r="1.6"/></svg></span>
      <span class="mobile-nav-label">Каналы</span>
    </button>
    <button type="button" data-mobile="notifications" title="Уведомления">
      <span class="mobile-nav-icon"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg></span>
      <span class="mobile-nav-label">Уведомления</span>
      <span class="mobile-badge hidden"></span>
    </button>
    <button type="button" data-mobile="settings" title="Настройки">
      <span class="mobile-nav-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></svg></span>
      <span class="mobile-nav-label">Настройки</span>
    </button>`;
  document.body.append(nav);

  const backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.id = 'mobile-backdrop';
  backdrop.setAttribute('aria-label', 'Закрыть список каналов');
  document.body.append(backdrop);

  const buttons = [...nav.querySelectorAll('button')];
  const tabOrder = ['home', 'channels', 'notifications', 'settings'];
  const setActive = (name) => {
    buttons.forEach((button, index) => {
      const on = button.dataset.mobile === name;
      button.classList.toggle('active', on);
      if (on) nav.style.setProperty('--nav-index', index);
    });
  };
  const pushLayer = () => {
    if (history.state?.mobileLayer) return;
    history.pushState({ mobileLayer: true }, '');
  };
  const dropLayer = () => {
    if (history.state?.mobileLayer) history.replaceState(null, '');
  };
  const closeNotifications = () => {
    document.body.classList.remove('mobile-notifications');
    if (typeof closeNotifPanel === 'function' && !document.getElementById('notif-panel')?.classList.contains('hidden')) closeNotifPanel();
    dropLayer();
  };
  const hideList = () => {
    document.body.classList.remove('mobile-list');
    if (!document.body.classList.contains('mobile-notifications')) setActive('home');
    dropLayer();
  };
  const showList = () => {
    closeNotifications();
    pushLayer();
    transition(() => {
      document.body.classList.add('mobile-list');
      setActive('channels');
      renderHubs();
    });
    buzz();
  };

  // Понятное действие друзей: плюс в шапке, а не спрятанная вкладка.
  const friendsHead = document.querySelector('.friends-head');
  if (friendsHead && !document.getElementById('mobile-add-friend')) {
    const addFriend = document.createElement('button');
    addFriend.type = 'button';
    addFriend.id = 'mobile-add-friend';
    addFriend.className = 'icon-btn';
    addFriend.title = 'Добавить друга';
    addFriend.setAttribute('aria-label', 'Добавить друга');
    addFriend.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
    addFriend.onclick = () => document.querySelector('#friend-tabs [data-tab="add"]')?.click();
    friendsHead.append(addFriend);
  }

  // Переключатель каналов: на телефоне рейл скрыт, поэтому хабы выбираются
  // горизонтальной полосой в начале списка.
  const sidebar = document.querySelector('.sidebar');
  const hubsBar = document.createElement('div');
  hubsBar.id = 'mobile-hubs';
  const sidebarHead = sidebar?.querySelector('.sidebar-head');
if (sidebarHead) sidebarHead.after(hubsBar);
else if (sidebar) sidebar.prepend(hubsBar);

  // ---------- Каналы: гармошка, папки и drag&drop ----------
  const collapsedChannels = new Set();
  const channelLayoutKey = () => `mobileHubLayout:${state?.me?.id || 'anon'}`;
  const readChannelLayout = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(channelLayoutKey()) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  };
  const saveChannelLayout = (layout) => {
    try { localStorage.setItem(channelLayoutKey(), JSON.stringify(layout)); } catch {}
  };
  let dragChannelState = null;

  const normalizeChannelLayout = (hubs) => {
    const ids = hubs.map((h) => h.id);
    const byId = new Map(hubs.map((h) => [h.id, h]));
    const out = [];
    const seen = new Set();
    const addTop = (id) => {
      if (!byId.has(id) || seen.has(id)) return;
      seen.add(id);
      out.push({ type: 'hub', id });
    };
    for (const item of readChannelLayout()) {
      if (item?.type === 'folder') {
        const members = (Array.isArray(item.hubs) ? item.hubs : []).filter((id) => byId.has(id) && !seen.has(id));
        if (members.length >= 2) {
          members.forEach((id) => seen.add(id));
          out.push({ type: 'folder', id: item.id || `f${Date.now()}${Math.random().toString(36).slice(2, 5)}`, hubs: members });
        } else {
          members.forEach(addTop);
        }
      } else {
        addTop(item?.id);
      }
    }
    for (const id of ids) addTop(id);
    return out;
  };

  const hubLocation = (layout, id) => {
    for (let i = 0; i < layout.length; i += 1) {
      const item = layout[i];
      if (item.type === 'hub' && item.id === id) return { index: i, folder: null };
      if (item.type === 'folder') {
        const memberIndex = item.hubs.indexOf(id);
        if (memberIndex >= 0) return { index: i, folder: item, memberIndex };
      }
    }
    return null;
  };

  const removeHubFromLayout = (layout, id) => {
    const loc = hubLocation(layout, id);
    if (!loc) return;
    if (loc.folder) {
      loc.folder.hubs.splice(loc.memberIndex, 1);
      if (loc.folder.hubs.length < 2) layout.splice(loc.index, 1, ...loc.folder.hubs.map((hubId) => ({ type: 'hub', id: hubId })));
    } else {
      layout.splice(loc.index, 1);
    }
  };

  const makeFolder = (hubs) => ({ type: 'folder', id: `f${Date.now()}${Math.random().toString(36).slice(2, 5)}`, hubs });

  const channelDropTarget = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const dropout = el?.closest?.('.mobile-hub-dropout');
    if (dropout) return { type: 'out', el: dropout };
    const folder = el?.closest?.('.mobile-hub-folder');
    if (folder) return { type: 'folder', id: folder.dataset.folder, el: folder };
    const card = el?.closest?.('.mobile-hub-card');
    if (card?.dataset.hub) return { type: 'hub', id: Number(card.dataset.hub), el: card };
    return null;
  };

  const applyChannelDrop = (sourceId, target) => {
    if (!target || target.id === sourceId) return;
    const hubs = state?.hubs ? [...state.hubs.values()] : [];
    const layout = normalizeChannelLayout(hubs);
    const source = hubLocation(layout, sourceId);
    if (!source) return;
    if (target.type === 'out') {
      removeHubFromLayout(layout, sourceId);
      layout.push({ type: 'hub', id: sourceId });
    } else if (target.type === 'folder') {
      removeHubFromLayout(layout, sourceId);
      const folder = layout.find((i) => i.type === 'folder' && i.id === target.id);
      if (!folder || folder.hubs.includes(sourceId)) return;
      folder.hubs.push(sourceId);
    } else {
      const targetLoc = hubLocation(layout, target.id);
      if (!targetLoc) return;
      removeHubFromLayout(layout, sourceId);
      const freshTarget = hubLocation(layout, target.id);
      if (!freshTarget) return;
      if (freshTarget.folder && source.folder === freshTarget.folder) {
        freshTarget.folder.hubs.splice(freshTarget.memberIndex, 0, sourceId);
      } else if (freshTarget.folder) {
        freshTarget.folder.hubs.splice(freshTarget.memberIndex + 1, 0, sourceId);
      } else {
        layout.splice(freshTarget.index, 1, makeFolder([target.id, sourceId]));
      }
    }
    saveChannelLayout(layout);
    hubsBar.dataset.signature = '';
    renderHubs();
  };

  function startChannelDrag(card, sourceId, startX, startY) {
    const rect = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.classList.add('mobile-channel-ghost');
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    document.body.append(ghost);
    card.classList.add('channel-dragging');
    document.documentElement.classList.add('channel-drag-active');
    const hubs = state?.hubs ? [...state.hubs.values()] : [];
    const sourceLoc = hubLocation(normalizeChannelLayout(hubs), sourceId);
    let dropout = null;
    if (sourceLoc?.folder) {
      dropout = document.createElement('div');
      dropout.className = 'mobile-hub-dropout';
      dropout.textContent = 'Вынуть из папки';
      hubsBar.append(dropout);
    }
    dragChannelState = { sourceId, ghost, card };
    let target = null;
    const clearHighlight = () => {
      for (const el of document.querySelectorAll('.channel-drop')) el.classList.remove('channel-drop');
    };
    const move = (event) => {
      if (!dragChannelState) return;
      if (event.cancelable) event.preventDefault();
      ghost.style.left = `${event.clientX - rect.width / 2}px`;
      ghost.style.top = `${event.clientY - 28}px`;
      target = channelDropTarget(event.clientX, event.clientY);
      clearHighlight();
      target?.el?.classList.add('channel-drop');
    };
    const finish = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
      clearHighlight();
      ghost.remove();
      dropout?.remove();
      card.classList.remove('channel-dragging');
      document.documentElement.classList.remove('channel-drag-active');
      dragChannelState = null;
      if (target) {
        const suppress = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
        document.addEventListener('click', suppress, true);
        setTimeout(() => document.removeEventListener('click', suppress, true), 350);
        applyChannelDrop(sourceId, target);
      }
    };
    move({ clientX: startX, clientY: startY, cancelable: false });
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
  }

  const initChannelDrag = () => {
    if (hubsBar.dataset.dragBound === '1') return;
    hubsBar.dataset.dragBound = '1';
    let press = null;
    hubsBar.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const head = event.target.closest?.('.mobile-hub-card__head');
      if (!head || event.target.closest('button')) return;
      const card = head.closest('.mobile-hub-card');
      if (!card?.dataset.hub) return;
      press = { card, id: Number(card.dataset.hub), x: event.clientX, y: event.clientY, timer: 0 };
      press.timer = setTimeout(() => {
        if (!press) return;
        const p = press;
        press = null;
        startChannelDrag(p.card, p.id, p.x, p.y);
      }, 340);
    });
    const cancel = (event) => {
      if (!press) return;
      if (!event || Math.abs(event.clientX - press.x) > 8 || Math.abs(event.clientY - press.y) > 8) {
        clearTimeout(press.timer);
        press = null;
      }
    };
    hubsBar.addEventListener('pointermove', (event) => {
      if (press && (Math.abs(event.clientX - press.x) > 8 || Math.abs(event.clientY - press.y) > 8)) cancel(event);
    }, { passive: true });
    hubsBar.addEventListener('pointerup', () => { if (press) { clearTimeout(press.timer); press = null; } }, { passive: true });
    hubsBar.addEventListener('pointercancel', () => { if (press) { clearTimeout(press.timer); press = null; } }, { passive: true });
  };

  const renderHubs = () => {
    if (!hubsBar) return;
    const hubs = typeof state !== 'undefined' && state.hubs ? [...state.hubs.values()] : [];
    // Не пересоздаём кнопки каждую секунду: иначе касание попадает в уже
    // удалённый узел, а полоса мигает. Обновляем только при реальном изменении.
    const signature = (state?.view ?? '') + '|' + hubs.map((h) => `${h.id}:${h.name}:${(typeof roomsOfHub === 'function' ? roomsOfHub(h.id).length : 0)}`).join('|') + '|c' + [...collapsedChannels].join(',') + '|l' + JSON.stringify(readChannelLayout());
    if (hubsBar.dataset.signature === signature) return;
    hubsBar.dataset.signature = signature;
    const items = [];
    const inHub = state?.view && state.hubs?.has(state.view);
    document.body.classList.toggle('mobile-hub-open', Boolean(inHub));
    document.getElementById('mobile-channel-settings')?.classList.toggle('hidden', !inHub);
    if (!inHub) {
      document.getElementById('hub-menu-btn')?.classList.add('hidden');
      document.getElementById('head-home')?.classList.remove('hidden');
    }
    if (inHub) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'mobile-hub mobile-hub-back';
      back.textContent = 'Все каналы';
      back.onclick = () => {
        if (typeof selectContact === 'function') selectContact(null);
        renderHubs();
      };
      items.push(back);
      // Рейл каналов остаётся видимым и в открытом канале: можно переключаться
      // между каналами, не возвращаясь на общий экран.
      for (const hub of hubs) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'mobile-hub-chip' + (hub.id === state.view ? ' active' : '');
        chip.dataset.hub = hub.id;
        chip.title = hub.name || 'Канал';
        chip.setAttribute('aria-label', hub.name || 'Канал');
        chip.innerHTML = `<span class="mobile-hub-chip__avatar">${(hub.name || 'К').trim().charAt(0).toUpperCase()}</span>`;
        const av = chip.querySelector('.mobile-hub-chip__avatar');
        if (av && typeof fillHubIcon === 'function') fillHubIcon(av, hub);
        chip.onclick = () => {
          if (typeof openHub === 'function') openHub(hub.id);
          renderHubs();
        };
        items.push(chip);
      }
    } else {
      const createCard = (hub) => {
        // Карточка канала сразу с его комнатами — экран каналов не пустует,
        // как сайдбар Discord, но в нашей логике.
        const card = document.createElement('div');
        card.className = 'mobile-hub-card';
        card.dataset.hub = hub.id;
        card.classList.toggle('collapsed', collapsedChannels.has(String(hub.id)));
        const head = document.createElement('div');
        head.className = 'mobile-hub-card__head';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mobile-hub';
        button.dataset.hub = hub.id;
        button.innerHTML = `<span class="mobile-hub__avatar">${(hub.name || 'К').trim().charAt(0).toUpperCase()}</span><span class="mobile-hub__name"></span>`;
        button.querySelector('.mobile-hub__name').textContent = hub.name || 'Канал';
        const avatar = button.querySelector('.mobile-hub__avatar');
        if (avatar && typeof fillHubIcon === 'function') fillHubIcon(avatar, hub);
        button.onclick = () => {
          if (typeof openHub === 'function') openHub(hub.id);
          renderHubs();
        };
        const gear = document.createElement('button');
        gear.type = 'button';
        gear.className = 'mobile-hub-card__settings';
        gear.title = 'Настройки канала';
        gear.setAttribute('aria-label', 'Настройки канала');
        gear.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></svg>';
        gear.onclick = (event) => {
          event.stopPropagation();
          if (typeof openHubSettings === 'function') openHubSettings(hub.id);
        };
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'mobile-hub-card__toggle';
        toggle.title = collapsedChannels.has(String(hub.id)) ? 'Развернуть комнаты' : 'Свернуть комнаты';
        toggle.setAttribute('aria-expanded', String(!collapsedChannels.has(String(hub.id))));
        toggle.innerHTML = '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>';
        toggle.onclick = (event) => {
          event.stopPropagation();
          const key = String(hub.id);
          if (collapsedChannels.has(key)) collapsedChannels.delete(key); else collapsedChannels.add(key);
          hubsBar.dataset.signature = '';
          renderHubs();
        };
        head.append(button, toggle, gear);
        card.append(head);

        const rooms = typeof roomsOfHub === 'function' ? roomsOfHub(hub.id) : [];
        if (rooms.length && !collapsedChannels.has(String(hub.id))) {
          const list = document.createElement('div');
          list.className = 'mobile-hub-card__rooms';
          for (const room of rooms) {
            const row = document.createElement('div');
            row.className = 'mobile-hub-room';
            row.dataset.room = room.id;
            row.dataset.kind = room.kind || 'text';
            const name = document.createElement('button');
            name.type = 'button';
            name.className = 'mobile-hub-room__name';
            name.textContent = `${room.kind === 'voice' ? '🔊' : '#'} ${room.name}`;
            name.onclick = () => {
              // Голосовую комнату открываем входом в голос, а чат — отдельной кнопкой.
              if (room.kind === 'voice' && typeof openRoom === 'function') {
                openRoom(room.id);
              } else {
                if (typeof selectRoom === 'function') selectRoom(room.id);
                if (typeof hideList === 'function') hideList();
              }
              if (typeof setActive === 'function') setActive('channels');
            };
            const chat = document.createElement('button');
            chat.type = 'button';
            chat.className = 'mobile-hub-room__action';
            chat.title = 'Открыть чат без голоса';
            chat.innerHTML = '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/></svg>';
            chat.onclick = (event) => {
              event.stopPropagation();
              if (typeof openRoomChat === 'function') openRoomChat(room.id);
              if (typeof hideList === 'function') hideList();
              if (typeof setActive === 'function') setActive('channels');
            };
            const settings = document.createElement('button');
            settings.type = 'button';
            settings.className = 'mobile-hub-room__action';
            settings.title = 'Настройки комнаты';
            settings.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></svg>';
            settings.onclick = (event) => {
              event.stopPropagation();
              if (typeof openRoomManage === 'function') openRoomManage(room.id);
            };
            row.append(name, chat, settings);
            row.onclick = () => name.click();
            list.append(row);
          }
          card.append(list);
        }
        return card;
      };

      const layout = normalizeChannelLayout(hubs);
      for (const item of layout) {
        if (item.type === 'folder') {
          const frame = document.createElement('div');
          frame.className = 'mobile-hub-folder';
          frame.dataset.folder = item.id;
          const title = document.createElement('div');
          title.className = 'mobile-hub-folder__title';
          title.textContent = 'Папка · ' + item.hubs.length;
          frame.append(title);
          for (const id of item.hubs) {
            const hub = hubs.find((h) => h.id === id);
            if (hub) frame.append(createCard(hub));
          }
          items.push(frame);
        } else {
          const hub = hubs.find((h) => h.id === item.id);
          if (hub) items.push(createCard(hub));
        }
      }
    }
    hubsBar.replaceChildren(...items);
  };
  const channelSettings = document.getElementById('mobile-channel-settings');
  if (channelSettings) channelSettings.onclick = (event) => {
    event.stopPropagation();
    const hub = state.hubs?.get(state.view);
    if (hub && typeof openHubSettings === 'function') openHubSettings(hub.id);
  };
  initChannelDrag();
  renderHubs();
  setInterval(renderHubs, 1000);

  const panel = document.getElementById('notif-panel');
  const openNotifications = () => {
    hideList();
    pushLayer();
    if (panel && panel.parentElement !== document.body) document.body.append(panel);
    if (typeof openNotifPanel === 'function') openNotifPanel();
    document.body.classList.add('mobile-notifications');
    setActive('notifications');
    buzz();
  };

  // Лист действий комнаты: открыть, настройки, пригласить. Появляется
  // долгим нажатием, поэтому строка списка остаётся чистой.
  const roomSheet = document.createElement('div');
  roomSheet.id = 'mobile-room-sheet';
  const roomBackdrop = document.createElement('button');
  roomBackdrop.type = 'button';
  roomBackdrop.id = 'mobile-room-backdrop';
  roomBackdrop.setAttribute('aria-label', 'Закрыть действия комнаты');
  document.body.append(roomBackdrop, roomSheet);
  const closeRoomSheet = () => document.body.classList.remove('mobile-room-sheet');
  roomBackdrop.onclick = closeRoomSheet;
  const openRoomSheet = (roomId) => {
    const room = typeof roomById === 'function' ? roomById(roomId) : null;
    if (!room) return;
    roomSheet.replaceChildren();
    const title = document.createElement('div');
    title.className = 'sheet-title';
    title.textContent = room.name;
    roomSheet.append(title);
    const add = (label, run) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = touchLabel(label);
      button.onclick = () => {
        closeRoomSheet();
        run();
      };
      roomSheet.append(button);
    };
    add('Открыть чат', () => {
      if (typeof openRoomChat === 'function') openRoomChat(room.id);
    });
    add('Настройки комнаты', () => {
      if (typeof openRoomManage === 'function') openRoomManage(room.id);
    });
    add('Пригласить в комнату', () => {
      if (typeof openRoomInvite === 'function') openRoomInvite(room.id);
    });
    document.body.classList.add('mobile-room-sheet');
  };

  // На раскрытом фолде нет нижних вкладок: уведомления и настройки живут
  // в нижней части рейла, как навигационные иконки мобильного приложения.
  const railEl = document.getElementById('rail');
  let railUtility = null;
  let railUtilityBadge = null;
  if (railEl) {
    railUtility = document.createElement('div');
    railUtility.id = 'mobile-rail-utility';
    railUtility.innerHTML = `
      <button type="button" id="mobile-rail-notifs" title="Уведомления" aria-label="Уведомления">
        <svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>
        <span class="mobile-badge hidden"></span>
      </button>
      <button type="button" id="mobile-rail-settings" title="Настройки" aria-label="Настройки">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></svg>
      </button>`;
    railEl.append(railUtility);
    railUtility.querySelector('#mobile-rail-notifs').onclick = (event) => {
      event.stopPropagation();
      openNotifications();
    };
    railUtility.querySelector('#mobile-rail-settings').onclick = () => {
      if (typeof openSettings === 'function') openSettings();
    };
    railUtilityBadge = railUtility.querySelector('.mobile-badge');
  }

  const setChannelsMode = (on) => {
    document.body.classList.toggle('mobile-channels', on);
    const friends = document.getElementById('friends');
    if (friends) friends.style.display = on ? 'none' : '';
    const home = document.querySelector('#head-home span');
    if (home) home.textContent = on ? 'Каналы' : 'Созвон';
  };

  // Нижнее меню — верхний уровень навигации: всё, что открыто поверх комнаты,
  // должно закрыться, иначе окно останется висеть над новым разделом.
  const closeMobileOverlays = () => {
    // Уходим из раздела — поле ввода не должно оставаться активным и держать клавиатуру.
    const active = document.activeElement;
    if (active?.matches?.('input, textarea, select, [contenteditable="true"]')) active.blur();
    window.closeMobileDrawers?.();
    const visible = (id) => {
      const el = document.getElementById(id);
      return Boolean(el && !el.classList.contains('hidden'));
    };
    if (visible('thread-panel')) window.closeThread?.();
    if (visible('settings')) window.closeSettings?.();
    if (visible('hub-settings') && typeof closeHubSettings === 'function') closeHubSettings();
    if (visible('room-manage') && typeof closeRoomManage === 'function') closeRoomManage();
    if (visible('event-create') && typeof closeEventCreate === 'function') closeEventCreate();
    // Остальные окна (приглашение, кик, создание комнаты) не имеют общего
    // close-хука — просто убираем их, чтобы они не висели поверх раздела.
    for (const modal of document.querySelectorAll('.modal:not(.hidden)')) {
      if (modal.id === 'incoming' || modal.id === 'updating') continue;
      modal.classList.add('hidden');
    }
  };
  window.closeMobileOverlays = closeMobileOverlays;

  // Переход между разделами: короткая непрозрачная шторка, затем новый экран.
  // Старый раздел не просвечивает и не остаётся поверх нового.
  const tabFade = document.createElement('div');
  tabFade.id = 'mobile-tab-fade';
  tabFade.setAttribute('aria-hidden', 'true');
  document.body.append(tabFade);
  let tabSwitching = false;
  let pendingTab = null;
  let tabFadeTimer = 0;

  const runTab = (name) => {
    closeMobileOverlays();
    closeNotifications();
    setChannelsMode(name === 'channels');
    if (name !== 'settings' && typeof closeSettings === 'function' && !document.getElementById('settings').classList.contains('hidden')) {
      closeSettings();
    }
    if (name === 'home') {
      // Сбрасываем канал/комнату, иначе на «Друзьях» остаются их классы и слои.
      if (typeof state !== 'undefined') {
        state.view = 'home';
        state.selectedRoomId = null;
        state.selectedId = null;
      }
      hideList();
      if (typeof selectContact === 'function') selectContact(null);
      renderHubs();
      setActive('home');
    } else if (name === 'channels') {
      if (typeof selectContact === 'function') selectContact(null);
      showList();
      renderHubs();
      setActive('channels');
    } else if (name === 'notifications') {
      openNotifications();
      setActive('notifications');
    } else if (name === 'settings') {
      hideList();
      if (typeof openSettings === 'function') openSettings();
      setActive('settings');
    }
  };

  const switchTab = (name) => {
    const active = nav.querySelector('button.active')?.dataset.mobile;
    if (active === name) {
      // Повторный тап по активной вкладке закрывает окна/панели поверх неё
      // и возвращает к корню раздела (из комнаты — к списку каналов).
      closeMobileOverlays();
      closeNotifications();
      if (name === 'channels') {
        if (typeof selectContact === 'function') selectContact(null);
        showList();
        renderHubs();
        setActive('channels');
      } else if (name === 'home') {
        hideList();
        if (typeof selectContact === 'function') selectContact(null);
        renderHubs();
        setActive('home');
      }
      return;
    }
    // Сразу подсвечиваем выбранный пункт — отклик не ждёт смены экрана.
    setActive(name);
    if (tabSwitching) {
      pendingTab = name;
      return;
    }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      runTab(name);
      return;
    }
    tabSwitching = true;
    tabFade.classList.remove('out');
    tabFade.classList.add('on');
    clearTimeout(tabFadeTimer);
    tabFadeTimer = setTimeout(() => {
      runTab(name);
      // Даём браузеру отрисовать новый раздел, затем плавно убираем шторку.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        tabFade.classList.add('out');
        setTimeout(() => {
          tabFade.classList.remove('on', 'out');
          tabSwitching = false;
          if (pendingTab && pendingTab !== name) {
            const next = pendingTab;
            pendingTab = null;
            switchTab(next);
          } else {
            pendingTab = null;
          }
        }, 150);
      }));
    }, 40);
  };

  // Свайп по нижнему меню листает вкладки. Жест живёт ТОЛЬКО внутри nav:
  // touchstart/touchend не всплывают, поэтому контент и роллер друзей не задействованы.
  const navOrder = ['home', 'channels', 'notifications', 'settings'];
  const navSwipe = (dir) => {
    const current = nav.querySelector('button.active')?.dataset.mobile || 'home';
    const index = Math.max(0, navOrder.indexOf(current));
    const target = navOrder[index + (dir > 0 ? 1 : -1)];
    if (target && target !== current) switchTab(target);
  };
  let navTouch = null;
  nav.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1) return;
    const t = event.touches[0];
    navTouch = { x: t.clientX, y: t.clientY };
    event.stopPropagation();
  }, { passive: true });
  nav.addEventListener('touchend', (event) => {
    if (!navTouch) return;
    const t = event.changedTouches[0];
    const dx = t.clientX - navTouch.x;
    const dy = t.clientY - navTouch.y;
    navTouch = null;
    event.stopPropagation();
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    const suppress = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
    document.addEventListener('click', suppress, true);
    setTimeout(() => document.removeEventListener('click', suppress, true), 350);
    navSwipe(dx < 0 ? 1 : -1);
  }, { passive: true });

  nav.querySelector('[data-mobile="home"]').onclick = () => switchTab('home');
  nav.querySelector('[data-mobile="channels"]').onclick = () => switchTab('channels');
  nav.querySelector('[data-mobile="notifications"]').onclick = (event) => {
    event.stopPropagation();
    if (document.body.classList.contains('mobile-notifications')) {
      closeNotifications();
      switchTab('home');
    } else switchTab('notifications');
  };
  nav.querySelector('[data-mobile="settings"]').onclick = () => switchTab('settings');
  backdrop.onclick = hideList;

  // Бейдж событий живёт в нижней вкладке, а не на колокольчике.
  const badge = nav.querySelector('.mobile-badge');
  const syncBadge = () => {
    if (!badge) return;
    const source = document.getElementById('notif-badge');
    const value = source && !source.classList.contains('hidden') ? source.textContent : '';
    badge.textContent = value;
    badge.classList.toggle('hidden', !value);
    if (railUtilityBadge) {
      railUtilityBadge.textContent = value;
      railUtilityBadge.classList.toggle('hidden', !value);
    }
  };
  syncBadge();
  setInterval(syncBadge, 600);

  // Панель уведомлений закрылась — снимаем полноэкранный режим.
  if (panel) {
    const head = panel.querySelector('.notif-head');
    if (head && !head.querySelector('#notif-close')) {
      const close = document.createElement('button');
      close.type = 'button';
      close.id = 'notif-close';
      close.title = 'Закрыть';
      close.setAttribute('aria-label', 'Закрыть уведомления');
      close.innerHTML = '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>';
      close.onclick = closeNotifications;
      head.append(close);
    }
    new MutationObserver(() => {
      if (panel.classList.contains('hidden')) document.body.classList.remove('mobile-notifications');
    }).observe(panel, { attributes: true, attributeFilter: ['class'] });
  }

  // Выбор комнаты/контакта закрывает список, чтобы сразу открылся чат.
  document.addEventListener(
    'click',
    (event) => {
      if (!document.body.classList.contains('mobile-list')) return;
      if (event.target.closest('.room-row, .contact, .friend-row, .rail-home')) {
        hideList();
        syncBack();
      }
    },
    true
  );

  // Долгое нажатие на иконку хаба открывает действия канала: пригласить,
  // создать комнату или событие, уведомления, настройки, выйти/удалить.
  let hubPressTimer = null;
  let hubLongPressed = false;
  const cancelHubPress = () => {
    if (hubPressTimer) clearTimeout(hubPressTimer);
    hubPressTimer = null;
  };
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType === 'mouse') return;
      const tile = event.target.closest('#rail .rail-item[data-hub], .mobile-hub[data-hub]');
      if (!tile) return;
      cancelHubPress();
      hubPressTimer = setTimeout(() => {
        const hub = typeof hubById === 'function' ? hubById(Number(tile.dataset.hub)) : null;
        if (!hub || typeof showMenu !== 'function' || typeof hubMenuItems !== 'function') return;
        hubLongPressed = true;
        buzz(12);
        const r = tile.getBoundingClientRect();
        const items = hubMenuItems(hub).map((item) => (item && item.label ? { ...item, label: touchLabel(item.label) } : item));
        showMenu(Math.min(r.right + 4, innerWidth - 220), r.top, items);
      }, 550);
    },
    { passive: true }
  );
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    document.addEventListener(type, cancelHubPress, { passive: true });
  }

  // Нижний лист действий сообщения. Берём уже существующие кнопки msg-tools,
  // поэтому на мобильном остаётся весь набор: ответ, тред, пересылка, реакция,
  // изменение, удаление, закреп.
  const msgSheet = document.createElement('div');
  msgSheet.id = 'mobile-msg-sheet';
  const msgBackdrop = document.createElement('button');
  msgBackdrop.type = 'button';
  msgBackdrop.id = 'mobile-msg-backdrop';
  msgBackdrop.setAttribute('aria-label', 'Закрыть действия сообщения');
  document.body.append(msgBackdrop, msgSheet);
  const closeMsgSheet = () => document.body.classList.remove('mobile-msg-sheet');
  msgBackdrop.onclick = closeMsgSheet;
  const openMsgSheet = (messageRow) => {
    const tools = [...messageRow.querySelectorAll('.msg-tools .msg-tool')];
    if (!tools.length) return;
    msgSheet.replaceChildren();
    const title = document.createElement('div');
    title.className = 'sheet-title';
    title.textContent = 'Сообщение';
    msgSheet.append(title);
    for (const tool of tools) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = touchLabel(tool.title);
      button.onclick = () => {
        closeMsgSheet();
        if (tool.title === 'Реакция' && typeof openReactions === 'function' && messageRow.message && messageRow.actions) {
          openReactions(messageRow.message, messageRow.actions.chat, button);
          return;
        }
        tool.click();
      };
      msgSheet.append(button);
    }
    document.body.classList.add('mobile-msg-sheet');
  };

  // Долгое нажатие на комнату открывает её настройки: на сенсорном экране
  // не нужно держать три мелкие иконки в каждой строке.
  let roomPressTimer = null;
  let roomLongPressed = false;
  const cancelRoomPress = () => {
    if (roomPressTimer) clearTimeout(roomPressTimer);
    roomPressTimer = null;
  };
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType === 'mouse') return;
      const row = event.target.closest('.room-row');
      if (!row || event.target.closest('button')) return;
      cancelRoomPress();
      roomPressTimer = setTimeout(() => {
        roomLongPressed = true;
        buzz(12);
        openRoomSheet(Number(row.dataset.room));
      }, 550);
    },
    { passive: true }
  );
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    document.addEventListener(type, cancelRoomPress, { passive: true });
  }
  document.addEventListener(
    'click',
    (event) => {
      if (!roomLongPressed && !hubLongPressed && !msgLongPressed) return;
      const source = event.target.closest('.msg, .room-row, #rail .rail-item[data-hub], .mobile-hub');
      roomLongPressed = false;
      hubLongPressed = false;
      msgLongPressed = false;
      // Гасим только клик по самой строке, а не по backdrop/кнопкам листа.
      if (!source) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true
  );

  // Долгое нажатие на сообщение — мобильные действия вместо hover-панели.
  let msgPressTimer = null;
  let msgLongPressed = false;
  let msgStart = null;
  const cancelMsgPress = () => {
    if (msgPressTimer) clearTimeout(msgPressTimer);
    msgPressTimer = null;
  };
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType === 'mouse') return;
      const row = event.target.closest('.msg');
      if (!row || event.target.closest('a, button, input, textarea, select')) return;
      cancelMsgPress();
      msgStart = { x: event.clientX, y: event.clientY };
      msgPressTimer = setTimeout(() => {
        msgLongPressed = true;
        buzz(10);
        openMsgSheet(row);
      }, 520);
    },
    { passive: true }
  );
  document.addEventListener(
    'pointermove',
    (event) => {
      if (!msgStart) return;
      if (Math.abs(event.clientX - msgStart.x) > 12 || Math.abs(event.clientY - msgStart.y) > 12) {
        cancelMsgPress();
        msgStart = null;
      }
    },
    { passive: true }
  );
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    document.addEventListener(type, () => {
      cancelMsgPress();
      msgStart = null;
    }, { passive: true });
  }

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
    const onFriends = Boolean(document.querySelector('.friends-head')?.getClientRects().length);
    const inRoom = Boolean(app?.room || app?.selectedRoomId) && !onFriends;
    const inChat = Boolean(inRoom || app?.selectedId) && !onFriends;
    button.hidden = !inChat;
    // Настройки — отдельный раздел нижнего меню: не сбрасываем активную вкладку на «Друзья».
    if (document.body.classList.contains('mobile-settings')) return;
    if (!document.body.classList.contains('mobile-list') && !document.body.classList.contains('mobile-notifications'))
      setActive(inRoom ? 'channels' : 'home');
  };
  addChatBack();
  document.addEventListener('DOMContentLoaded', addChatBack);
  const observer = new MutationObserver(() => {
    addChatBack();
    syncBack();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setInterval(() => syncBack(), 250);
  const originalHeader = typeof window.renderChatHeader === 'function' ? window.renderChatHeader : null;
  if (originalHeader) {
    window.renderChatHeader = function (...args) {
      const result = originalHeader.apply(this, args);
      setTimeout(() => syncBack(), 0);
      return result;
    };
  }

  // Системная кнопка/жест «назад» в Android закрывает верхний мобильный слой.
  window.addEventListener('popstate', () => {
    if (document.body.classList.contains('mobile-notifications')) {
      document.body.classList.remove('mobile-notifications');
      if (typeof closeNotifPanel === 'function') closeNotifPanel();
      setActive('home');
    } else if (document.body.classList.contains('mobile-list')) {
      document.body.classList.remove('mobile-list');
      setActive('home');
    }
  });

  // Активная вкладка всегда должна быть видна в роллере: докручиваем его.
  const friendTabs = document.getElementById('friend-tabs');
  if (friendTabs) {
    let scrollTimer = 0;
    const revealActiveFriendTab = () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const active = friendTabs.querySelector('button.active');
        if (!active) return;
        const r = friendTabs.getBoundingClientRect();
        const a = active.getBoundingClientRect();
        if (a.left >= r.left && a.right <= r.right) return;
        active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }, 30);
    };
    friendTabs.addEventListener('click', (event) => {
      if (event.target.closest('button')) revealActiveFriendTab();
    }, true);
    new MutationObserver(revealActiveFriendTab).observe(friendTabs, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    revealActiveFriendTab();
  }

  // Свайп по экрану «Друзья» листает роллер вкладок, как в мобильном Telegram.
  const friendsScreen = document.getElementById('empty-state');
  if (friendsScreen) {
    const order = () => [...document.querySelectorAll('#friend-tabs [data-tab]')].map((b) => b.dataset.tab);
    const animateFriends = (dir) => {
      friendsScreen.classList.remove('friends-swipe-left', 'friends-swipe-right');
      void friendsScreen.offsetWidth;
      friendsScreen.classList.add(dir > 0 ? 'friends-swipe-left' : 'friends-swipe-right');
      clearTimeout(animateFriends.timer);
      animateFriends.timer = setTimeout(() => friendsScreen.classList.remove('friends-swipe-left', 'friends-swipe-right'), 260);
    };
    window.friendsSwipe = (dir) => {
      const tabs = order();
      const current = document.querySelector('#friend-tabs [data-tab].active')?.dataset.tab;
      const index = Math.max(0, tabs.indexOf(current));
      const target = tabs[index + (dir > 0 ? 1 : -1)];
      if (!target || typeof showFriendsTab !== 'function') return false;
      showFriendsTab(target);
      animateFriends(dir);
      return true;
    };
    let start = null;
    friendsScreen.addEventListener('touchstart', (event) => {
      if (event.touches.length !== 1) return;
      if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const t = event.touches[0];
      start = { x: t.clientX, y: t.clientY };
      // Жест начался на экране друзей: общий обработчик свайпов не должен
      // открывать каналы даже если движение чуть ниже порога роллера.
      event.stopPropagation();
    }, { passive: true });
    friendsScreen.addEventListener('touchend', (event) => {
      if (!start) return;
      const t = event.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      start = null;
      event.stopPropagation();
      if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      window.friendsSwipe(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  // Жесты: правый свайп от левого края — каналы, левый от правого — события,
  // свайп влево по открытому списку — назад, свайп вниз по событиям — закрыть.
  let touch = null;
  document.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length !== 1) return;
      if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const t = event.touches[0];
      // Первые/последние 24 dp и верхняя кромка принадлежат системе:
      // back-жест и статус-бар не перехватываем вообще.
      if (t.clientX < 24 || t.clientX > innerWidth - 24 || t.clientY < 24) return;
      touch = { x: t.clientX, y: t.clientY };
    },
    { passive: true }
  );
  document.addEventListener(
    'touchend',
    (event) => {
      if (!touch) return;
      const t = event.changedTouches[0];
      const dx = t.clientX - touch.x;
      const dy = t.clientY - touch.y;
      const was = touch;
      touch = null;
      if (Math.abs(dx) < 32 && Math.abs(dy) < 32) return;
      if (document.body.classList.contains('mobile-notifications') && dy > 55 && Math.abs(dy) > Math.abs(dx)) {
        closeNotifications();
        setActive('home');
        return;
      }
      // Не требуем строго горизонтального жеста: палец на телефоне всегда
      // уходит по диагонали, а прежний порог 1.3 отбрасывал половину свайпов.
      if (Math.abs(dx) < 42 || Math.abs(dx) < Math.abs(dy) * 1.08) return;
      if (document.body.classList.contains('mobile-list') && dx < -42) {
        hideList();
        buzz();
      } else if (!document.body.classList.contains('mobile-list') && dx > 42 && !event.target.closest('button, a, .rail, #mobile-nav')) {
        showList();
      }
    },
    { passive: true }
  );

  // Единый порядок закрытия для Android back и системной кнопки.
  // Возвращает true, если событие поглощено приложением.
  window.mobileBack = () => {
    if (document.getElementById('stream-float') && !document.getElementById('stream-float').classList.contains('hidden')) {
      document.getElementById('stream-float-close')?.click();
      return true;
    }
    if (document.getElementById('fullview') && !document.getElementById('fullview').classList.contains('hidden')) {
      document.getElementById('fullview-exit')?.click();
      return true;
    }
    if (document.body.classList.contains('mobile-msg-sheet')) { closeMsgSheet(); return true; }
    if (document.body.classList.contains('mobile-room-sheet')) { closeRoomSheet(); return true; }
    if (document.body.classList.contains('mobile-notifications')) { closeNotifications(); setActive('home'); return true; }
    // Открытая комната/DM: системный back сначала возвращает к списку.
    if (!document.body.classList.contains('mobile-list') &&
        (document.querySelector('#room-view:not(.hidden)') || document.querySelector('#chat:not(.hidden)'))) {
      showList();
      return true;
    }
    if (state?.view && state.hubs?.has(state.view)) {
      if (typeof selectContact === 'function') selectContact(null);
      renderHubs();
      showList();
      setChannelsMode(true);
      return true;
    }
    if (document.body.classList.contains('mobile-list')) {
      hideList();
      setChannelsMode(false);
      setActive('home');
      return true;
    }
    return false;
  };

  if (!window.desktop && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
})();
