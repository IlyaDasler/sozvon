// Мобильные настройки: корень — список, раздел — отдельный экран.
// На ≤900 px desktop-модалка с боковым меню и панелью рядом не используется.
(() => {
  const mq = matchMedia('(max-width: 900px)');
  const back = document.getElementById('mobile-settings-back');
  const subnav = document.getElementById('privacy-subnav');
  const privacyPane = document.querySelector('#settings .set-pane[data-pane="privacy"]');

  if (!back || !subnav || !privacyPane) return;

  const overview = document.getElementById('mobile-settings-overview');
  const profileButton = document.querySelector('#set-nav [data-tab="profile"]');
  const profileOpen = document.getElementById('mobile-profile-open');

  const syncProfileCard = () => {
    const me = typeof state !== 'undefined' ? state.me : null;
    const avatar = document.getElementById('mobile-profile-avatar');
    const name = document.getElementById('mobile-profile-name');
    const username = document.getElementById('mobile-profile-username');
    if (!me) return;
    name.textContent = me.displayName || 'Профиль';
    username.textContent = me.username ? `@${me.username}` : '';
    avatar.textContent = (me.displayName || '?').trim().charAt(0).toUpperCase();
    avatar.style.backgroundColor = me.avatarColor || 'var(--bg-4)';
    avatar.style.backgroundImage = me.avatarUrl && typeof Api !== 'undefined'
      ? `url("${Api.base}${me.avatarUrl}")`
      : '';

    const themeId = document.documentElement.dataset.themeId || document.documentElement.dataset.theme || 'glass';
    const theme = typeof THEMES !== 'undefined' ? THEMES.find((t) => t.id === themeId) : null;
    const themeName = document.getElementById('mobile-theme-name');
    if (themeName) themeName.textContent = theme?.name || 'Тема';

    const version = document.getElementById('mobile-settings-version');
    if (version) version.textContent = `Созвон ${document.getElementById('app-version')?.textContent || ''}`.trim();

    const status = document.getElementById('mobile-settings-connection');
    if (status) {
      const online = document.getElementById('conn-dot')?.classList.contains('ok');
      status.textContent = online === false ? 'Нет связи' : 'Сервер на связи';
    }
  };

  if (profileOpen) profileOpen.onclick = () => {
    if (typeof showSettingsTab === 'function') showSettingsTab('profile');
    section('profile');
  };

  const search = document.getElementById('mobile-settings-search');
  const filterSettings = () => {
    const q = search ? search.value.trim().toLowerCase() : '';
    for (const button of document.querySelectorAll('#set-nav [data-tab]')) {
      if (button.dataset.tab === 'profile') continue;
      button.hidden = Boolean(q) && !button.textContent.toLowerCase().includes(q);
    }
    for (const group of document.querySelectorAll('#set-nav .mobile-settings-group')) {
      group.hidden = Boolean(q);
    }
  };
  if (search) search.oninput = filterSettings;

  const resetScroll = () => {
    for (const el of document.querySelectorAll('#settings .set-body, #settings .rs-main, #settings .modal-card')) {
      el.scrollTop = 0;
    }
  };

  const clearRootHighlight = () => {
    for (const button of document.querySelectorAll('#settings #set-nav [data-tab]')) {
      button.classList.remove('active');
      button.style.setProperty('background', 'transparent', 'important');
      button.style.setProperty('box-shadow', 'none', 'important');
      button.style.setProperty('border-color', 'transparent', 'important');
    }
  };

  const home = () => {
    document.body.classList.add('mobile-settings');
    document.body.classList.remove('mobile-settings-section');
    resetScroll();
    clearRootHighlight();
    if (overview) overview.hidden = false;
    if (profileButton) { profileButton.hidden = true; profileButton.style.display = 'none'; }
    if (search) { search.value = ''; filterSettings(); }
    syncProfileCard();
    setTimeout(() => { clearRootHighlight(); syncProfileCard(); }, 0);
    document.getElementById('set-title').textContent = 'Настройки';
    back.classList.add('hidden');
    if (subnav.parentElement !== document.getElementById('set-nav')) {
      document.getElementById('set-nav').insertBefore(subnav, document.getElementById('logout-btn')?.previousElementSibling || null);
      subnav.classList.add('hidden');
    }
  };

  const section = (tab) => {
    document.body.classList.add('mobile-settings', 'mobile-settings-section');
    if (overview) overview.hidden = true;
    resetScroll();
    document.getElementById('set-title').textContent =
      document.getElementById('set-nav').querySelector(`[data-tab="${tab}"]`)?.textContent?.trim() || 'Настройки';
    back.classList.remove('hidden');
    if (tab === 'privacy' && subnav.parentElement !== privacyPane) {
      privacyPane.prepend(subnav);
      subnav.classList.remove('hidden');
    }
    if (tab === 'privacy') window.showPrivacyPage?.(window.privacyPage || 'data');
  };

  // Перехватываем только результат: исходные обработчики остаются в app.js.
  const baseShow = showSettingsTab;
  showSettingsTab = function (tab) {
    baseShow(tab);
    if (!mq.matches) return;
    if (typeof tab === 'string') section(tab);
    else home();
  };

  const baseOpen = openSettings;
  openSettings = function (tab) {
    const pending = baseOpen(tab);
    if (!mq.matches) return pending;
    // Не ждём baseOpen: он может зависнуть на enumerateDevices, но окно уже открыто.
    if (typeof tab === 'string') section(tab);
    else {
      home();
      setTimeout(() => { if (document.body.classList.contains('mobile-settings-section')) home(); }, 0);
    }
    return pending;
  };

  const baseClose = closeSettings;
  closeSettings = function () {
    baseClose();
    document.body.classList.remove('mobile-settings', 'mobile-settings-section');
    back.classList.add('hidden');
  };

  const goBack = () => {
    if (!mq.matches || document.getElementById('settings').classList.contains('hidden')) return false;
    if (document.body.classList.contains('mobile-settings-section')) home();
    else closeSettings();
    return true;
  };
  window.mobileSettingsBack = goBack;
  back.onclick = () => { goBack(); };

  // Android back: из раздела — в список, из списка — закрыть настройки.
  addEventListener('popstate', () => {
    if (!mq.matches || document.getElementById('settings').classList.contains('hidden')) return;
    if (window.__mobileSettingsInternal) return;
    if (document.body.classList.contains('mobile-settings-section')) home();
    else closeSettings();
  });
})();
