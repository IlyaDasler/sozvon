// Window size classes из Android/Material 3: compact < 600dp,
// medium 600–839dp, expanded >= 840dp. Это адаптация по фактическому
// окну, а не список моделей: подходит любому Android-экрану,
// включая split-screen, DeX и фолды.
(() => {
  const root = document.documentElement;
  const apply = () => {
    const w = Math.round(window.innerWidth);
    const h = Math.round(window.innerHeight);
    root.dataset.windowWidth = w < 600 ? 'compact' : w < 840 ? 'medium' : 'expanded';
    root.dataset.windowHeight = h < 480 ? 'compact' : h < 900 ? 'medium' : 'expanded';
    root.style.setProperty('--window-width', `${w}px`);
    root.style.setProperty('--window-height', `${h}px`);
  };
  apply();
  addEventListener('resize', apply, { passive: true });
  addEventListener('orientationchange', () => setTimeout(apply, 80), { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', apply, { passive: true });
  }
})();
