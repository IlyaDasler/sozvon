// «Жидкий» индикатор активной вкладки: подложка перетекает к выбранной кнопке
// с пружинной анимацией и лёгким растяжением — как в iOS 26 при переключении вкладок
(() => {
  const SELECTORS = ['#friend-tabs', '#set-nav', '#screen-tabs'];
  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function activeButton(root) {
    return root.querySelector('button.active, button[aria-selected="true"]');
  }

  function place(root, pill, animate = true) {
    const button = activeButton(root);
    if (!button) {
      pill.style.opacity = '0';
      return;
    }
    const box = root.getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    if (!animate) pill.style.transition = 'none';
    pill.style.opacity = '1';
    pill.style.width = `${Math.round(rect.width)}px`;
    pill.style.height = `${Math.round(rect.height)}px`;
    pill.style.transform = `translate(${Math.round(rect.left - box.left)}px, ${Math.round(rect.top - box.top)}px)`;
    if (!animate) {
      // Вернуть переход на следующем кадре, чтобы дальше всё анимировалось
      requestAnimationFrame(() => {
        pill.style.transition = '';
      });
    }
  }

  function init(root) {
    if (!root || root.dataset.liquid === 'yes') return;
    root.dataset.liquid = 'yes';
    root.classList.add('liquid-tabs');
    const pill = document.createElement('span');
    pill.className = 'liquid-pill';
    pill.setAttribute('aria-hidden', 'true');
    root.prepend(pill);
    place(root, pill, false);

    // Внутри вкладок кнопки могут перерисовываться — следим за классом «active»
    root.addEventListener('click', () => {
      root.classList.add('switching');
      // Небольшое растяжение подложки в момент переключения — «жидкий» отклик
      pill.style.width = `${Math.round(pill.getBoundingClientRect().width * 1.12)}px`;
      requestAnimationFrame(() => place(root, pill, true));
      setTimeout(() => root.classList.remove('switching'), 380);
    });

    new MutationObserver(() => place(root, pill, true)).observe(root, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    new ResizeObserver(() => place(root, pill, false)).observe(root);
    window.addEventListener('resize', () => place(root, pill, false), { passive: true });
  }

  function start() {
    if (reduced()) return;
    for (const selector of SELECTORS) init(document.querySelector(selector));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
