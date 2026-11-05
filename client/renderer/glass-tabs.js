// Анимированный указатель вкладок для темы «Жидкое стекло».
// Одна стеклянная плашка на группу: двигается только transform'ом (220 мс),
// ширина и высота применяются одним кадром. Никаких подложек, которые
// пересоздаются на каждом кадре — отсюда не бывает дёрганья и артефактов.
(() => {
  const GROUPS = [
    { id: 'friend-tabs', vertical: false },
    { id: 'set-nav', vertical: true },
    { id: 'privacy-subnav', vertical: true },
  ];

  const glass = () => document.documentElement.dataset.theme === 'glass';
  const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function activeOf(root) {
    const buttons = [...root.querySelectorAll(':scope > button')];
    return buttons.find((b) => b.classList.contains('active') || b.getAttribute('aria-selected') === 'true') || null;
  }

  function create(root, vertical) {
    if (root.dataset.glassTabs === '1') return null;
    root.dataset.glassTabs = '1';
    root.classList.add('glass-tabs');
    const indicator = document.createElement('span');
    indicator.className = `glass-tab-indicator${vertical ? ' vertical' : ''}`;
    indicator.setAttribute('aria-hidden', 'true');
    indicator.hidden = true;
    root.prepend(indicator);

    let shown = false;
    let last = '';
    let frame = 0;

    const hide = () => {
      indicator.hidden = true;
      shown = false;
      last = '';
    };

    const place = (animate = true) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!root.isConnected || !glass()) return hide();
        const active = activeOf(root);
        if (!active) return hide();
        const rr = root.getBoundingClientRect();
        const ar = active.getBoundingClientRect();
        if (!ar.width || !ar.height || !rr.width || !rr.height) return hide();

        const x = Math.round(ar.left - rr.left);
        const y = Math.round(ar.top - rr.top);
        const key = `${x}:${y}:${Math.round(ar.width)}:${Math.round(ar.height)}:${vertical}`;
        if (key === last) return;
        const first = !shown;
        last = key;

        // Ширина/высота — сразу, без анимации: иначе плашка «переливается» шириной.
        if (first || !animate) indicator.classList.add('no-anim');
        indicator.style.width = `${Math.round(ar.width)}px`;
        indicator.style.height = `${Math.round(ar.height)}px`;
        indicator.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        indicator.hidden = false;
        shown = true;
        if (first || !animate) {
          requestAnimationFrame(() => indicator.classList.remove('no-anim'));
        }
      });
    };

    const onScroll = () => place(false);
    root.addEventListener('scroll', onScroll, { passive: true });
    new ResizeObserver(() => place(false)).observe(root);
    new MutationObserver((records) => {
      if (records.some((r) => r.type === 'attributes' || r.type === 'childList')) place();
    }).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'aria-selected'] });
    new MutationObserver(() => place(false)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    place(false);
    return { place, hide, root };
  }

  function init() {
    for (const { id, vertical } of GROUPS) {
      const root = document.getElementById(id);
      if (root) create(root, vertical);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
