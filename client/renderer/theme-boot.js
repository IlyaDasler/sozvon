// Тема применяется до отрисовки страницы, чтобы не мигала тема по умолчанию
(() => {
  try {
    const theme = JSON.parse(localStorage.getItem('theme'));
    if (theme) document.documentElement.dataset.theme = theme;
  } catch {}
})();
