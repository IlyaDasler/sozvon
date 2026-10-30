// Подсказки при наведении: вместо системной прямоугольной рамки — своя, в стиле приложения.
// Работает для любых элементов с title (у иконок, кнопок, полей), у столбца каналов — своя подсказка.
(() => {
  let tip = null;
  let timer = 0;
  let current = null;

  function ensureTip() {
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'app-tip hidden';
      document.body.append(tip);
    }
    return tip;
  }

  function hide() {
    clearTimeout(timer);
    current = null;
    if (tip) tip.classList.add('hidden');
  }

  function place(el) {
    const text = el.dataset.tip || el.getAttribute('title');
    if (!text) return;
    // Системную подсказку убираем, чтобы не появлялась вторая, прямоугольная
    if (el.hasAttribute('title')) {
      el.dataset.tip = text;
      el.removeAttribute('title');
    }
    const box = ensureTip();
    box.textContent = text;
    box.classList.remove('hidden');
    const r = el.getBoundingClientRect();
    const t = box.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left + r.width / 2 - t.width / 2, innerWidth - t.width - 8));
    const below = r.bottom + 8;
    const top = below + t.height > innerHeight - 8 ? Math.max(8, r.top - t.height - 8) : below;
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  }

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest?.('[title], [data-tip]');
    // У столбца каналов подсказка своя — она справа от иконки
    if (!el || el.closest('#rail, .rail-tip, .app-tip')) return;
    if (el === current) return;
    current = el;
    clearTimeout(timer);
    timer = setTimeout(() => place(el), 350);
  });

  document.addEventListener('mouseout', (e) => {
    if (!current) return;
    if (e.relatedTarget && current.contains(e.relatedTarget)) return;
    hide();
  });

  document.addEventListener('mousedown', hide, true);
  document.addEventListener('scroll', hide, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  window.addEventListener('blur', hide);
})();
