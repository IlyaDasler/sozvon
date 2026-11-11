// Android back и кнопка «Назад»: закрываем ровно один верхний слой.
// PWA использует popstate в mobile.js, нативная оболочка — App.backButton.
(() => {
  const visible = (sel) => {
    const el = document.querySelector(sel);
    return Boolean(el && !el.classList.contains('hidden'));
  };

  function handleBack() {
    if (visible('#settings')) {
      if (typeof window.mobileSettingsBack === 'function' && window.mobileSettingsBack()) return true;
      if (typeof closeSettings === 'function') closeSettings();
      return true;
    }
    if (window.mobileBack?.()) return true;
    if (document.querySelector('#thread-panel.thread-open')) {
      window.closeThread?.();
      return true;
    }
    // E2EE-ключ нельзя просто закрыть: пользователь должен выбрать действие.
    if (visible('#e2ee-setup')) return true;
    // Остальные модалки закрываются своим Escape-обработчиком.
    if (document.querySelector('.modal:not(.hidden)')) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return true;
    }
    return false;
  }

  window.sozvonBack = handleBack;

  const App = window.Capacitor?.Plugins?.App;
  if (App?.addListener) {
    App.addListener('backButton', () => {
      if (!handleBack()) App.exitApp();
    });
  }
})();
