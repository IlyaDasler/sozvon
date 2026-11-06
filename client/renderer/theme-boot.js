// Тема применяется до отрисовки страницы, чтобы не мигала тема по умолчанию
(() => {
  window.__bootstrapPending = true;
  try {
    const theme = JSON.parse(localStorage.getItem('theme'));
    // 3.0 встречает стеклянной темой; сохранённый выбор пользователя не трогаем
    document.documentElement.dataset.theme = theme || 'glass';
  } catch {}
  // В браузере нет окна приложения: полоса с кнопками «назад/вперёд» и перетаскиванием не нужна
  if (!window.desktop) document.documentElement.classList.add('is-web');
  // macOS: у окна системные кнопки слева, наша полоса сдвигается, чтобы они не налезали
  if (window.desktop?.platform === 'darwin') document.documentElement.classList.add('is-mac');
  if (window.desktop?.platform === 'win32') document.documentElement.classList.add('is-win');
})();
