// Жидкий морфинг при переключении: вкладки и свитчеры
// Вкладки: подложка сначала растягивается, накрывая старую и новую кнопку, потом собирается
// Свитчеры: бегунок слегка вытягивается в момент переключения и возвращается — как капля
(() => {
  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function activeButton(root) {
    return root.querySelector('button.active, button[aria-selected="true"]');
  }

  function rectOf(root, el) {
    const box = root.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.left - box.left),
      y: Math.round(rect.top - box.top),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    };
  }

  function apply(pill, r, transition) {
    if (transition) pill.style.transition = transition;
    pill.style.opacity = '1';
    pill.style.width = `${r.w}px`;
    pill.style.height = `${r.h}px`;
    pill.style.transform = `translate(${r.x}px, ${r.y}px)`;
  }

  function initTabs(root) {
    if (!root || root.dataset.liquid === 'yes') return;
    root.dataset.liquid = 'yes';
    root.classList.add('liquid-tabs');
    const pill = document.createElement('span');
    pill.className = 'liquid-pill';
    pill.setAttribute('aria-hidden', 'true');
    root.prepend(pill);

    let current = null;
    const button = activeButton(root);
    if (button) {
      current = rectOf(root, button);
      pill.style.transition = 'none';
      apply(pill, current);
      requestAnimationFrame(() => {
        pill.style.transition = '';
      });
    } else {
      pill.style.opacity = '0';
    }

    let settling = 0;

    function settle() {
      const next = activeButton(root);
      if (!next) return;
      const target = rectOf(root, next);
      if (!current) {
        apply(pill, target, 'none');
        current = target;
        return;
      }
      if (target.x === current.x && target.w === current.w) return;

      // Фаза 1: мягко растягиваемся, накрывая старую и новую кнопку
      const left = Math.min(current.x, target.x);
      const right = Math.max(current.x + current.w, target.x + target.w);
      const stretched = { x: left, y: target.y, w: right - left, h: target.h };
      pill.style.transition =
        'width .14s cubic-bezier(.4, 0, .2, 1), transform .14s cubic-bezier(.4, 0, .2, 1), height .14s ease';
      apply(pill, stretched);

      // Фаза 2: пружинно собираемся под новой кнопкой
      const token = ++settling;
      setTimeout(() => {
        if (token !== settling) return;
        pill.style.transition =
          'transform .36s cubic-bezier(.22, 1.15, .36, 1), width .36s cubic-bezier(.22, 1.15, .36, 1), height .22s ease';
        apply(pill, target);
      }, 140);
      current = target;
    }
    root.addEventListener('click', () => requestAnimationFrame(settle));
    new MutationObserver(() => settle()).observe(root, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    new ResizeObserver(() => {
      const next = activeButton(root);
      if (!next) return;
      current = rectOf(root, next);
      apply(pill, current, 'none');
      requestAnimationFrame(() => {
        pill.style.transition = '';
      });
    }).observe(root);
  }

  // Свитчер: вытягивание бегунка в момент переключения
  function initSwitch(sw) {
    if (sw.dataset.liquidSwitch === 'yes') return;
    sw.dataset.liquidSwitch = 'yes';
    sw.addEventListener('change', () => {
      sw.classList.add('switch-morph');
      setTimeout(() => sw.classList.remove('switch-morph'), 260);
    });
  }

  function start() {
    if (reduced()) return;
    for (const selector of ['#friend-tabs', '#set-nav', '#screen-tabs']) initTabs(document.querySelector(selector));
    for (const sw of document.querySelectorAll('.switch')) initSwitch(sw);
    new MutationObserver(() => {
      for (const sw of document.querySelectorAll('.switch:not([data-liquid-switch])')) initSwitch(sw);
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
