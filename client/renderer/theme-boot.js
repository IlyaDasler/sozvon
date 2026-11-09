// Тема применяется до отрисовки страницы, чтобы не мигала тема по умолчанию
(() => {
  try {
    const theme = JSON.parse(localStorage.getItem('theme'));
    // Убранные темы (forest, dusk) и любые неизвестные значения — на «Глубину»
    const allowed = ['sozvon', 'dark', 'midnight', 'light', 'frost', 'cold', 'neutron', 'silenthill', 'ferrari', 'glass', 'fuji'];
    const picked = allowed.includes(theme) ? theme : (theme ? 'sozvon' : 'glass');
    document.documentElement.dataset.theme = picked === 'fuji' ? 'glass' : picked;
    document.documentElement.dataset.themeId = picked;
  } catch {}
  // В браузере нет окна приложения: полоса с кнопками «назад/вперёд» и перетаскиванием не нужна
  if (!window.desktop) document.documentElement.classList.add('is-web');
  // macOS: у окна системные кнопки слева, наша полоса сдвигается, чтобы они не налезали
  if (window.desktop?.platform === 'darwin') document.documentElement.classList.add('is-mac');
  if (window.desktop?.platform === 'win32') document.documentElement.classList.add('is-win');
})();
