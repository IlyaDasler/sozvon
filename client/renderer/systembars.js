// Иконки системного трея под цвет темы. Сам WebView уже edge-to-edge.
(() => {
  const Bars = window.Capacitor?.Plugins?.SystemBars;
  if (!Bars?.setStyle) return;
  const lightThemes = new Set(['light', 'frost', 'glass2']);
  const apply = () => {
    const theme = document.documentElement.dataset.themeId || document.documentElement.dataset.theme || '';
    Bars.setStyle({ style: lightThemes.has(theme) ? 'LIGHT' : 'DARK' }).catch(() => {});
  };
  apply();
  document.addEventListener('sozvon:theme', apply);
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-theme-id'] });
})();
