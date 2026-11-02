// Оформление: выбор темы в настройках. Палитры — в themes.css, применяется сразу и запоминается
// (theme-boot.js ставит её до отрисовки при следующем запуске)

const THEMES = [
  { id: 'sozvon', name: 'Тёмная', hint: 'Глубокая тёмная с фиолетовым — по умолчанию' },
  { id: 'midnight', name: 'Полночь', hint: 'Чёрная, для OLED' },
  { id: 'light', name: 'Светлая', hint: 'Для дня' },
  { id: 'forest', name: 'Лес', hint: 'Тёмно-зелёная' },
  { id: 'dusk', name: 'Сумерки', hint: 'Тёплая фиолетовая' },
  { id: 'glass', name: 'Жидкое стекло', hint: 'Полупрозрачные панели с размытием, как в iOS и macOS' },
];

const currentTheme = () => document.documentElement.dataset.theme || 'sozvon';

/** Кнопки окна Windows — в цвета полосы окна текущей темы */
function syncTitleBar() {
  const css = getComputedStyle(document.documentElement);
  window.desktop?.titleBar?.({ color: css.getPropertyValue('--bg-deep').trim(), symbolColor: css.getPropertyValue('--text-2').trim() });
}
syncTitleBar();

let themeSwitchTimer;
function setTheme(id) {
  // На время смены цвета перетекают (см. html.theme-switching в styles.css)
  document.documentElement.classList.add('theme-switching');
  clearTimeout(themeSwitchTimer);
  themeSwitchTimer = setTimeout(() => document.documentElement.classList.remove('theme-switching'), 400);
  document.documentElement.dataset.theme = id;
  store.set('theme', id);
  syncTitleBar();
  applyGlass();
  renderThemePicker();
}

// ---------- Настройки стекла: прозрачность и размытие ----------

const glassAlpha = () => Number(store.get('glassAlpha', 7));
const glassBlur = () => Number(store.get('glassBlur', 26));

/** Прозрачность и размытие — в переменные темы; ползунки видны только для «Жидкого стекла» */
function applyGlass() {
  const root = document.documentElement;
  const alpha = Math.min(30, Math.max(2, glassAlpha())) / 100;
  const blur = Math.min(40, Math.max(0, glassBlur()));
  root.style.setProperty('--glass-a', String(alpha));
  root.style.setProperty('--glass-strong-a', String(Math.min(0.9, alpha * 1.9)));
  root.style.setProperty('--glass-blur', `${blur}px`);
  const tuning = $('glass-tuning');
  if (tuning) tuning.classList.toggle('hidden', currentTheme() !== 'glass');
  const alphaInput = $('glass-alpha');
  const blurInput = $('glass-blur');
  if (alphaInput) {
    alphaInput.value = String(glassAlpha());
    $('glass-alpha-value').textContent = `${glassAlpha()}%`;
  }
  if (blurInput) {
    blurInput.value = String(glassBlur());
    $('glass-blur-value').textContent = `${glassBlur()} px`;
  }
}

$('glass-alpha').oninput = () => {
  store.set('glassAlpha', Number($('glass-alpha').value));
  applyGlass();
};
$('glass-blur').oninput = () => {
  store.set('glassBlur', Number($('glass-blur').value));
  applyGlass();
};
applyGlass();
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
