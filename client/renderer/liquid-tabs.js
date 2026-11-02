// Жидкие анимации интерфейса — ТОЛЬКО для темы «Жидкое стекло».
// Вкладки: подложка перетекает к выбранной кнопке; дальние прыжки — без растягивания
// «колбасой», ближние — с мягким растяжением, накрывающим старую и новую кнопку.
// Рейл каналов: плитка пружинно «вспухает» при переключении.
(() => {
  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const isGlass = () => document.documentElement.dataset.theme === 'glass';
  const TABS = ['#friend-tabs', '#set-nav', '#screen-tabs'];

  const SPRING = 'cubic-bezier(.22, 1.15, .36, 1)';

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
    if (transition !== undefined) pill.style.transition = transition;
    pill.style.opacity = '1';
    pill.style.width = `${r.w}px`;
    pill.style.height = `${r.h}px`;
    pill.style.transform = `translate(${r.x}px, ${r.y}px)`;
  }

  function initTabs(root) {
    if (!root) return;
    root.classList.add('liquid-tabs');
    const pill = document.createElement('span');
    pill.className = 'liquid-pill';
    pill.setAttribute('aria-hidden', 'true');
    root.prepend(pill);

    let current = null;
    let token = 0;
    const onClick = () => requestAnimationFrame(settle);
    const observer = new MutationObserver(() => settle());
    const ro = new ResizeObserver(() => {
      const next = activeButton(root);
      if (!next) return;
      current = rectOf(root, next);
      apply(pill, current, 'none');
      requestAnimationFrame(() => {
        pill.style.transition = '';
      });
    });

    const first = activeButton(root);
    if (first) {
      current = rectOf(root, first);
      apply(pill, current, 'none');
      requestAnimationFrame(() => {
        pill.style.transition = '';
      });
    } else {
      pill.style.opacity = '0';
    }

    function settle() {
      const next = activeButton(root);
      if (!next) return;
      const target = rectOf(root, next);
      if (!current) {
        current = target;
        apply(pill, target, 'none');
        return;
      }
      if (
        target.x === current.x &&
        target.y === current.y &&
        target.w === current.w &&
        target.h === current.h
      )
        return;

      // Один плавный морфинг для любой дистанции: подложка едет пружиной, без
      // промежуточного растяжения — так нет ни «колбасы», ни рывка на дальнем переходе
      pill.style.transition =
        `transform 320ms ${SPRING}, width 320ms ${SPRING}, height 260ms ${SPRING}`;
      apply(pill, target);
      current = target;
    }
    root.addEventListener('click', onClick);
    observer.observe(root, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    ro.observe(root);
    // Убираем за собой при переключении темы: иначе слушатели копятся
    root.__liquidDestroy = () => {
      root.removeEventListener('click', onClick);
      observer.disconnect();
      ro.disconnect();
    };
  }

  function destroyTabs() {
    for (const selector of TABS) {
      const root = document.querySelector(selector);
      if (!root) continue;
      root.__liquidDestroy?.();
      delete root.__liquidDestroy;
      root.querySelector('.liquid-pill')?.remove();
      root.classList.remove('liquid-tabs');
    }
  }

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

  function syncTheme() {
    const on = isGlass() && !reduced();
    if (on) {
      for (const selector of TABS) {
        const root = document.querySelector(selector);
        if (root && !root.classList.contains('liquid-tabs')) initTabs(root);
      }
    } else {
      destroyTabs();
    }
  }

  function start() {
    syncTheme();
    new MutationObserver(syncTheme).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
