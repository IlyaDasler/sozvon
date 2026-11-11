// Мобильная оболочка PWA: вкладки, жесты, уведомления отдельным экраном.
// Внутренний экран фолда — рабочий стол (рейл + комнаты + чат), снаружи — телефон.
(() => {
  if (document.getElementById('mobile-nav')) return;

  if (!window.desktop) document.documentElement.classList.add('pwa');

  const transition = (fn) => {
    if (innerWidth > 900 && typeof document.startViewTransition === 'function' && document.documentElement.dataset.performance === 'high' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
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
    for (const el of document.querySelectorAll('#friend-tabs .glass-tab-indicator, #privacy-subnav .glass-tab-indicator, #set-nav .glass-tab-indicator')) {
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
    <button type="button" data-mobile="notifications" title="Уведомления">
      <svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>
      <span>Уведомления</span>
      <span class="mobile-badge hidden"></span>
    </button>
    <button type="button" data-mobile="settings" title="Настройки">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></svg>
      <span>Настройки</span>
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
    for (const button of buttons) button.classList.toggle('active', button.dataset.mobile === name);
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

  const renderHubs = () => {
    if (!hubsBar) return;
    const hubs = typeof state !== 'undefined' && state.hubs ? [...state.hubs.values()] : [];
    // Не пересоздаём кнопки каждую секунду: иначе касание попадает в уже
    // удалённый узел, а полоса мигает. Обновляем только при реальном изменении.
    const signature = (state?.view ?? '') + '|' + hubs.map((h) => `${h.id}:${h.name}`).join('|');
    if (hubsBar.dataset.signature === signature) return;
    hubsBar.dataset.signature = signature;
    const items = [];
    const inHub = state?.view && state.hubs?.has(state.view);
    document.body.classList.toggle('mobile-hub-open', Boolean(inHub));
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
    } else {
      for (const hub of hubs) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mobile-hub';
        button.dataset.hub = hub.id;
        button.innerHTML = `<span class="mobile-hub__avatar">${(hub.name || 'К').trim().charAt(0).toUpperCase()}</span><span class="mobile-hub__name"></span>`;
        button.querySelector('.mobile-hub__name').textContent = hub.name || 'Канал';
        button.onclick = () => {
          if (typeof openHub === 'function') openHub(hub.id);
          renderHubs();
        };
        items.push(button);
      }
    }
    hubsBar.replaceChildren(...items);
  };
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

  const switchTab = (name) => {
    closeNotifications();
    setChannelsMode(name === 'channels');
    if (name === 'home') {
      hideList();
      if (typeof selectContact === 'function') selectContact(null);
      setActive('home');
    } else if (name === 'channels') {
      if (typeof selectContact === 'function') selectContact(null);
      showList();
      renderHubs();
      setActive('channels');
    } else if (name === 'notifications') {
      openNotifications();
    } else if (name === 'settings') {
      hideList();
      if (typeof openSettings === 'function') openSettings();
      setActive('settings');
    }
  };

  nav.querySelector('[data-mobile="home"]').onclick = () => switchTab('home');
  nav.querySelector('[data-mobile="channels"]').onclick = () => switchTab('channels');
  nav.querySelector('[data-mobile="notifications"]').onclick = (event) => {
    event.stopPropagation();
    if (document.body.classList.contains('mobile-notifications')) {
      closeNotifications();
      setActive('home');
    } else openNotifications();
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
