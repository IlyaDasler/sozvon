// Кнопки окна в стиле приложения: нативных Windows-кнопок больше нет
(() => {
  const api = window.desktop?.window;
  if (!api) return;
  document.getElementById('win-min')?.addEventListener('click', () => api.minimize());
  document.getElementById('win-max')?.addEventListener('click', () => api.toggleMaximize());
  document.getElementById('win-close')?.addEventListener('click', () => api.close());
  api.onState?.((state) => {
    const max = document.getElementById('win-max');
    if (!max) return;
    const on = Boolean(state?.maximized);
    max.classList.toggle('maximized', on);
    max.title = on ? 'Восстановить' : 'Развернуть';
  });
})();