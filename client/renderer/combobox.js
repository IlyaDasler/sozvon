// Combobox / Autocomplete: подсказки под поиском с клавиатурой.
// Работает поверх существующих списков: выбор подсказки нажимает нужную строку
// (пригласить, добавить в звонок) или открывает переписку в списке друзей.
(() => {
  const SEARCH = '#friend-search, #hi-search, #ri-search, #call-add-search';
  let input = null;
  let menu = null;
  let options = [];
  let active = 0;

  const close = () => {
    if (menu) menu.remove();
    menu = null;
    options = [];
    active = 0;
    if (input) {
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
    input = null;
  };

  const scopeOf = (el) => el.closest('.modal, .friends-body, .set-body, .call-add, .sidebar') || document;

  function choose(id) {
    const source = input;
    const scope = scopeOf(source);
    close();
    const row =
      scope.querySelector(`[data-profile="${id}"]`)?.closest('.member-row, .contact, .invite-row') ||
      scope.querySelector(`[data-contact="${id}"]`);
    if (row) {
      const button = row.querySelector('button');
      if (button) button.click();
      else row.click();
      return;
    }
    if (typeof selectContact === 'function' && state.contacts.has(Number(id))) selectContact(Number(id));
  }

  function paint() {
    if (!menu) return;
    for (const [index, option] of options.entries()) {
      option.classList.toggle('is-active', index === active);
      option.setAttribute('aria-selected', index === active ? 'true' : 'false');
    }
    const current = options[active];
    if (current) input?.setAttribute('aria-activedescendant', current.id);
    current?.scrollIntoView({ block: 'nearest' });
  }

  function open() {
    if (menu) return;
    menu = document.createElement('div');
    menu.className = 'cb-menu';
    menu.setAttribute('role', 'listbox');
    menu.id = 'cb-menu';
    document.body.append(menu);
    input?.setAttribute('aria-expanded', 'true');
    input?.setAttribute('aria-controls', 'cb-menu');
  }

  function build(source, query) {
    const text = query.trim().toLowerCase();
    if (!text) return close();
    const matches = [...state.contacts.values()]
      .filter((c) => `${c.displayName} ${c.username}`.toLowerCase().includes(text))
      .sort((a, b) => Number(isAvailable(b)) - Number(isAvailable(a)) || a.displayName.localeCompare(b.displayName, 'ru'))
      .slice(0, 6);
    if (!matches.length) return close();

    input = source;
    open();
    menu.replaceChildren();
    options = matches.map((user, index) => {
      const option = document.createElement('div');
      option.className = 'cb-option';
      option.id = `cb-option-${index}`;
      option.setAttribute('role', 'option');
      option.dataset.id = user.id;
      const dot = document.createElement('span');
      dot.className = 'cb-dot';
      dot.style.background = user.avatarColor || 'var(--accent)';
      dot.textContent = (user.displayName || '?').trim().charAt(0).toUpperCase();
      const body = document.createElement('span');
      body.className = 'cb-body';
      const name = document.createElement('b');
      name.textContent = user.displayName;
      const login = document.createElement('span');
      login.className = 'muted';
      login.textContent = '@' + user.username;
      body.append(name, login);
      option.append(dot, body);
      option.addEventListener('pointerdown', (event) => event.preventDefault());
      option.addEventListener('click', () => choose(Number(user.id)));
      menu.append(option);
      return option;
    });
    active = 0;
    paint();

    const rect = source.getBoundingClientRect();
    menu.style.left = `${Math.round(rect.left)}px`;
    menu.style.width = `${Math.round(rect.width)}px`;
    const below = window.innerHeight - rect.bottom;
    if (below < 220 && rect.top > below) menu.style.bottom = `${Math.round(window.innerHeight - rect.top + 6)}px`;
    else menu.style.top = `${Math.round(rect.bottom + 6)}px`;
  }

  document.addEventListener('input', (event) => {
    const source = event.target.closest?.(SEARCH);
    if (!source) return;
    build(source, source.value);
  });

  document.addEventListener('keydown', (event) => {
    const source = event.target.closest?.(SEARCH);
    if (!source) return;
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (!menu) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        build(source, source.value);
      }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      paint();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[active];
      if (option) choose(Number(option.dataset.id));
    }
  });

  document.addEventListener('focusout', (event) => {
    if (!menu) return;
    if (event.target.closest?.(SEARCH)) setTimeout(() => { if (!document.querySelector('.cb-menu:hover')) close(); }, 120);
  });

  document.addEventListener('pointerdown', (event) => {
    if (!menu) return;
    if (event.target.closest?.('.cb-menu') || event.target.closest?.(SEARCH)) return;
    close();
  }, true);

  window.addEventListener('scroll', close, { passive: true, capture: true });
  window.addEventListener('resize', close, { passive: true });
})();
