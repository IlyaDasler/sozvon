// Тема применяется до отрисовки страницы, чтобы не мигала тема по умолчанию
(() => {
  try {
    const theme = JSON.parse(localStorage.getItem('theme'));
    if (theme) document.documentElement.dataset.theme = theme;
  } catch {}
  // В браузере нет окна приложения: полоса с кнопками «назад/вперёд» и перетаскиванием не нужна
  if (!window.desktop) document.documentElement.classList.add('is-web');
})();
