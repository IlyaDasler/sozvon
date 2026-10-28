// Оформление: выбор темы в настройках. Палитры — в themes.css, применяется сразу и запоминается
// (theme-boot.js ставит её до отрисовки при следующем запуске)

const THEMES = [
  { id: 'sozvon', name: 'Тёмная', hint: 'Глубокая тёмная с фиолетовым — по умолчанию' },
  { id: 'midnight', name: 'Полночь', hint: 'Чёрная, для OLED' },
  { id: 'light', name: 'Светлая', hint: 'Для дня' },
  { id: 'forest', name: 'Лес', hint: 'Тёмно-зелёная' },
  { id: 'dusk', name: 'Сумерки', hint: 'Тёплая фиолетовая' },
];

const currentTheme = () => document.documentElement.dataset.theme || 'sozvon';

let themeSwitchTimer;
function setTheme(id) {
  // На время смены цвета перетекают (см. html.theme-switching в styles.css)
  document.documentElement.classList.add('theme-switching');
  clearTimeout(themeSwitchTimer);
  themeSwitchTimer = setTimeout(() => document.documentElement.classList.remove('theme-switching'), 400);
  document.documentElement.dataset.theme = id;
  store.set('theme', id);
  renderThemePicker();
}

// Карточка темы — маленькая схема окна в цветах этой темы
function renderThemePicker() {
  const grid = $('theme-grid');
  grid.replaceChildren();
  for (const t of THEMES) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `theme-card${currentTheme() === t.id ? ' selected' : ''}`;
    card.dataset.pick = t.id;
    card.title = t.hint;
    card.innerHTML = `
      <span class="theme-preview" data-theme="${t.id}">
        <span class="tp-side"><i></i><i></i><i></i></span>
        <span class="tp-main"><i></i><i class="short"></i><b></b></span>
      </span>`;
    const name = document.createElement('span');
    name.className = 'theme-name';
    name.textContent = t.name;
    card.append(name);
    card.onclick = () => setTheme(t.id);
    grid.append(card);
  }
}
