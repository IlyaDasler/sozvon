// Мобильные настройки: корень — список, раздел — отдельный экран.
// На ≤900 px desktop-модалка с боковым меню и панелью рядом не используется.
(() => {
  const mq = matchMedia('(max-width: 900px)');
  const back = document.getElementById('mobile-settings-back');
  const subnav = document.getElementById('privacy-subnav');
  const privacyPane = document.querySelector('#settings .set-pane[data-pane="privacy"]');

  if (!back || !subnav || !privacyPane) return;

  const home = () => {
    document.body.classList.add('mobile-settings');
    document.body.classList.remove('mobile-settings-section');
    document.getElementById('set-title').textContent = 'Настройки';
    back.classList.add('hidden');
    if (subnav.parentElement !== document.getElementById('set-nav')) {
      document.getElementById('set-nav').insertBefore(subnav, document.getElementById('logout-btn')?.previousElementSibling || null);
      subnav.classList.add('hidden');
    }
  };

  const section = (tab) => {
    document.body.classList.add('mobile-settings', 'mobile-settings-section');
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
