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
// ---------- Форма углов и «живая» подсветка стекла ----------

const uiRadius = () => Math.min(24, Math.max(6, Number(store.get('uiRadius', 12))));
const sheenOn = () => store.get('glassSheen', true) !== false;

/** Скругление действует на весь интерфейс: от него зависят и панели, и поля, и окна */
function applyUiShape() {
  const r = uiRadius();
  const root = document.documentElement.style;
  root.setProperty('--r-s', `${Math.max(4, r - 6)}px`);
  root.setProperty('--r-m', `${r}px`);
  root.setProperty('--r-l', `${r + 4}px`);
  root.setProperty('--r-xl', `${r + 8}px`);
  root.setProperty('--radius', `${Math.max(6, r - 2)}px`);
  root.setProperty('--glass-radius', `${r + 6}px`);
  root.setProperty('--glass-sheen', sheenOn() ? '1' : '0');
  const radiusInput = $('ui-radius');
  if (radiusInput) {
    radiusInput.value = String(r);
    $('ui-radius-value').textContent = `${r} px`;
  }
  const sheen = $('ui-sheen');
  if (sheen) sheen.checked = sheenOn();
}

$('ui-radius').oninput = () => {
  store.set('uiRadius', Number($('ui-radius').value));
  applyUiShape();
};
$('ui-sheen').onchange = () => {
  store.set('glassSheen', $('ui-sheen').checked);
  applyUiShape();
};
applyUiShape();

// Подсветка следует за курсором: каждая стеклянная панель узнаёт, где курсор внутри неё,
// и «отзывается» бликом — именно это отличает жидкое стекло от простой прозрачности
let sheenQueued = false;
let lastPointer = null;

function paintSheen() {
  sheenQueued = false;
  const event = lastPointer;
  if (!event || !sheenOn()) return;
  const panel = event.target?.closest?.('.sidebar, .content, .modal-card, .call-panel');
  if (!panel) return;
  const box = panel.getBoundingClientRect();
  panel.style.setProperty('--mx', `${Math.round(event.clientX - box.left)}px`);
  panel.style.setProperty('--my', `${Math.round(event.clientY - box.top)}px`);
}

document.addEventListener(
  'pointermove',
  (event) => {
    lastPointer = event;
    if (sheenQueued) return;
    sheenQueued = true;
    requestAnimationFrame(paintSheen);
  },
  { passive: true }
);
// ---------- Цвета из системы: акцент из macOS/Windows ----------

const osAccentOn = () => store.get('osAccent', true) !== false;

function applySystemColors(info) {
  const root = document.documentElement.style;
  const accent = String(info?.accent || '').toLowerCase();
  if (osAccentOn() && /^#[0-9a-f]{6}$/.test(accent)) {
    root.setProperty('--accent', accent);
    root.setProperty('--accent-2', accent);
    root.setProperty('--accent-hover', accent);
  } else {
    root.removeProperty('--accent');
    root.removeProperty('--accent-2');
    root.removeProperty('--accent-hover');
  }
  const toggle = $('os-accent');
  if (toggle) toggle.checked = osAccentOn();
}

if (window.desktop?.system) {
  window.desktop.system.theme().then(applySystemColors).catch(() => {});
  window.desktop.system.onTheme((info) => applySystemColors(info));
}

$('os-accent').onchange = () => {
  store.set('osAccent', $('os-accent').checked);
  window.desktop?.system?.theme?.().then(applySystemColors).catch(() => {});
};
