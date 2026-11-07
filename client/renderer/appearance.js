// Оформление: выбор темы в настройках. Палитры — в themes.css, применяется сразу и запоминается
// (theme-boot.js ставит её до отрисовки при следующем запуске)

const THEMES = [
  { id: 'sozvon', name: 'Глубина', hint: 'Тёмно-синяя с бирюзой' },
  { id: 'dark', name: 'Тёмная', hint: 'Классическая тёмная — графит и фиолетовый' },
  { id: 'midnight', name: 'Полночь', hint: 'Чёрная, для OLED' },
  { id: 'light', name: 'Светлая', hint: 'Для дня' },
  { id: 'frost', name: 'Акварель', hint: 'Пастельные разводы и полупрозрачные панели' },
  { id: 'cold', name: 'Холод', hint: 'Ледяная синева и прозрачное стекло' },
  { id: 'silenthill', name: 'Туман', hint: 'Серый туман, безысходность и ржавый акцент' },
  { id: 'neutron', name: 'Нейтрон', hint: 'Фиолетовый космос и тёмное стекло' },
  { id: 'ferrari', name: 'Феррари', hint: 'Карбон, алый Rosso Corsa и гоночный жёлтый' },
  { id: 'glass', name: 'Совон', hint: 'Совон — размытие, мягкий свет и живой лес; тема по умолчанию' },
];

const THEME_GROUPS = [
  { title: 'Классические темы', ids: ['sozvon', 'dark', 'midnight', 'light', 'neutron', 'frost', 'cold'] },
  { title: 'Новые темы', ids: ['silenthill', 'ferrari', 'glass'] },
];

const currentTheme = () => document.documentElement.dataset.theme || 'glass';

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
  if (tuning) tuning.classList.add('hidden');
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
// Карточка темы — маленькая схема окна в цветах этой темы.
// Все темы на одной странице, но двумя понятными группами.
function themeCard(t) {
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
  return card;
}

function renderThemePicker() {
  const grid = $('theme-grid');
  grid.replaceChildren();
  for (const group of THEME_GROUPS) {
    const section = document.createElement('div');
    section.className = 'theme-group';
    const title = document.createElement('h4');
    title.textContent = group.title;
    const row = document.createElement('div');
    row.className = 'theme-group-grid';
    for (const id of group.ids) {
      const t = THEMES.find((item) => item.id === id);
      if (t) row.append(themeCard(t));
    }
    section.append(title, row);
    grid.append(section);
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
// ---------- Плотность интерфейса ----------

function applyDensity() {
  const compact = Boolean(store.get('density', false));
  document.documentElement.dataset.density = compact ? 'compact' : 'normal';
  const box = $('ui-density');
  if (box) box.checked = compact;
}

$('ui-density').onchange = () => {
  store.set('density', $('ui-density').checked);
  applyDensity();
};

applyDensity();
// ---------- Шрифт интерфейса ----------

const FONT_STACKS = {
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
  inter: "'Inter', 'Segoe UI', system-ui, sans-serif",
  segoe: "'Segoe UI', system-ui, sans-serif",
  grotesk: "Arial, 'Helvetica Neue', sans-serif",
  mono: "'Cascadia Mono', Consolas, 'JetBrains Mono', monospace",
};

function applyFont() {
  const choice = FONT_STACKS[store.get('uiFont', 'system')] ? store.get('uiFont', 'system') : 'system';
  document.documentElement.style.setProperty('--font-ui', FONT_STACKS[choice]);
  const select = $('ui-font');
  if (select) select.value = choice;
}

$('ui-font').onchange = () => {
  store.set('uiFont', $('ui-font').value);
  applyFont();
};

applyFont();
// ---------- Ползунки: заполнение до бегунка ----------

function paintRange(input) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const value = Number(input.value || 0);
  const percent = max > min ? ((value - min) / (max - min)) * 100 : 0;
  input.style.setProperty('--range-p', percent + '%');
}

function paintAllRanges() {
  for (const input of document.querySelectorAll('input[type=range]')) paintRange(input);
}

document.addEventListener('input', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === 'range') paintRange(e.target);
}, true);

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paintAllRanges);
else paintAllRanges();
