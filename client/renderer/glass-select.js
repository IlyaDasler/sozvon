// Стеклянный Select: свой список вместо системного.
// Нативный <select> остаётся в разметке (его значение читает остальной код),
// но визуально его заменяет кнопка с меню.
(() => {
  let current = null; // { box, menu, select }

  function close() {
    if (!current) return;
    current.menu.remove();
    current.box.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKeydown, true);
    window.removeEventListener('resize', close, true);
    window.removeEventListener('scroll', close, true);
    current = null;
  }

  function onOutside(event) {
    if (!current) return;
    if (current.box.contains(event.target) || current.menu.contains(event.target)) return;
    close();
  }

  function onKeydown(event) {
    if (!current) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      current?.box.focus();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const active = current.menu.querySelector('.gs-option.is-active');
      if (active) pick(active);
    }
  }

  function move(step) {
    const options = [...current.menu.querySelectorAll('.gs-option')];
    if (!options.length) return;
    const index = options.findIndex((o) => o.classList.contains('is-active'));
    const next = (index + step + options.length) % options.length;
    options.forEach((o) => o.classList.remove('is-active'));
    options[next].classList.add('is-active');
    options[next].scrollIntoView({ block: 'nearest' });
  }

  function pick(option) {
    const { select, box } = current;
    select.value = option.dataset.value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    sync(select, box);
    close();
    box.focus();
  }

  function sync(select, box) {
    const option = select.options[select.selectedIndex];
    const value = box.querySelector('.gs-value');
    value.textContent = option ? option.textContent : '';
    box.classList.toggle('is-empty', !option);
  }

  function open(box, select) {
    const menu = document.createElement('div');
    menu.className = 'gs-menu';
    menu.setAttribute('role', 'listbox');
    const entries = [...select.options].filter((o) => !o.disabled);
    entries.forEach((option) => {
      const item = document.createElement('div');
      item.className = 'gs-option';
      item.setAttribute('role', 'option');
      item.dataset.value = option.value;
      item.textContent = option.textContent;
      if (option.selected) item.classList.add('is-selected', 'is-active');
      item.addEventListener('click', () => pick(item));
      item.addEventListener('pointermove', () => {
        menu.querySelectorAll('.gs-option.is-active').forEach((o) => o.classList.remove('is-active'));
        item.classList.add('is-active');
      });
      menu.append(item);
    });

    const rect = box.getBoundingClientRect();
    menu.style.left = `${Math.round(rect.left)}px`;
    menu.style.width = `${Math.round(rect.width)}px`;
    const below = window.innerHeight - rect.bottom;
    if (below < 200 && rect.top > below) {
      menu.style.bottom = `${Math.round(window.innerHeight - rect.top + 6)}px`;
    } else {
      menu.style.top = `${Math.round(rect.bottom + 6)}px`;
    }
    document.body.append(menu);
    box.setAttribute('aria-expanded', 'true');
    current = { box, menu, select };
    if (!menu.querySelector('.is-active')) menu.querySelector('.gs-option')?.classList.add('is-active');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKeydown, true);
    window.addEventListener('resize', close, true);
    window.addEventListener('scroll', close, true);
  }

  function enhance(select) {
    if (select.dataset.gsReady === '1' || select.closest('.gs-select')) return;
    // У камеры свой список с живым превью; нативный/стеклянный select
    // только дублировал бы его и открывал пустое меню.
    if (select.id === 'set-cam') return;
    select.dataset.gsReady = '1';
    select.classList.add('gs-native');
    select.tabIndex = -1;

    const box = document.createElement('div');
    box.className = 'gs-select';
    box.setAttribute('role', 'combobox');
    box.setAttribute('aria-expanded', 'false');
    box.tabIndex = 0;
    box.innerHTML =
      '<span class="gs-value"></span>' +
      '<svg class="gs-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    select.after(box);

    const refresh = () => sync(select, box);
    refresh();
    new MutationObserver(refresh).observe(select, { childList: true, subtree: true });
    select.addEventListener('change', refresh);

    const toggle = () => {
      if (current && current.box === box) return close();
      close();
      open(box, select);
    };
    box.addEventListener('click', (event) => {
      event.stopPropagation();
      toggle();
    });
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault();
        toggle();
      }
    });
  }

  function enhanceAll() {
    for (const select of document.querySelectorAll('select:not(.gs-native)')) enhance(select);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enhanceAll);
  else enhanceAll();
  // Микрофон, динамики и камера заполняются позже — повторяем после появления
  setTimeout(enhanceAll, 600);
  setTimeout(enhanceAll, 2000);
  // Селекты создаются и позже (например, выбор роли в управлении комнатой);
  // подхватываем их, чтобы вместо системного чёрного списка был меню темы.
  let enhanceTimer = 0;
  new MutationObserver(() => {
    clearTimeout(enhanceTimer);
    enhanceTimer = setTimeout(enhanceAll, 80);
  }).observe(document.body, { childList: true, subtree: true });
})();
