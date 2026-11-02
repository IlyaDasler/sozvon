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

      const vertical = Math.abs(target.y - current.y) > Math.abs(target.x - current.x);
      const distance = vertical ? Math.abs(target.y - current.y) : Math.abs(target.x - current.x);
      const size = vertical ? current.h : current.w;

      // Дальний прыжок (первая вкладка → последняя): едем пружиной, но НЕ растягиваемся
      // на весь путь — иначе подложка превращается в «колбасу» через весь тулбар
      if (distance > size * 1.8) {
        pill.style.transition = `transform .30s ${SPRING}, width .30s ${SPRING}, height .26s ${SPRING}`;
        apply(pill, target);
        current = target;
        return;
      }

      // Ближний переход: растяжение 140 мс, затем пружинная сборка под новую кнопку
      const stretched = vertical
        ? {
            x: target.x,
            y: Math.min(current.y, target.y),
            w: target.w,
            h:
              Math.max(current.y + current.h, target.y + target.h) -
              Math.min(current.y, target.y),
          }
        : {
            x: Math.min(current.x, target.x),
            y: target.y,
            w:
              Math.max(current.x + current.w, target.x + target.w) -
              Math.min(current.x, target.x),
            h: target.h,
          };

      pill.style.transition =
        'width .14s cubic-bezier(.4, 0, .2, 1), height .14s cubic-bezier(.4, 0, .2, 1), transform .14s cubic-bezier(.4, 0, .2, 1)';
      apply(pill, stretched);

      const mine = ++token;
      setTimeout(() => {
        if (mine !== token) return;
        pill.style.transition = `transform .36s ${SPRING}, width .36s ${SPRING}, height .26s ${SPRING}`;
        apply(pill, target);
      }, 140);
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
