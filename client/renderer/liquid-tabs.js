// Жидкие микроанимации интерфейса — только для темы «Жидкое стекло».
// Вкладки намеренно НЕ используют перетекающую подложку: она ехала пружиной 320 мс,
// и при переключении за кнопкой тянулась вторая «рамка». Активную вкладку теперь
// подсвечивает обычный CSS (glass-3.css): полупрозрачная плашка переключается сразу.
// Рейл каналов: плитка пружинно «вспухает» при переключении.
(() => {
  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const isGlass = () => document.documentElement.dataset.theme === 'glass';

  // ---------- Рейл каналов: пружинное «вспухание» плитки при переключении ----------
  function railPop(tile) {
    if (!tile || !isGlass() || reduced()) return;
    tile.classList.remove('rail-pop');
    void tile.offsetWidth;
    tile.classList.add('rail-pop');
    setTimeout(() => tile.classList.remove('rail-pop'), 460);
  }

  document.addEventListener(
    'click',
    (event) => {
      const tile = event.target.closest?.('.rail-tile');
      if (tile) railPop(tile);
    },
    true
  );

  // ---------- Свитчеры: «капля» при переключении, тоже только для стекла ----------
  document.addEventListener(
    'change',
    (event) => {
      if (!isGlass() || reduced()) return;
      const sw = event.target.closest?.('.switch');
      if (!sw) return;
      sw.classList.add('switch-morph');
      setTimeout(() => sw.classList.remove('switch-morph'), 260);
    },
    true
  );
})();
