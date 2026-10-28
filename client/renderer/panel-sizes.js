// Ширина боковых панелей — левой (комнаты и личные сообщения) и правой (участники).
// Край панели тянут мышью, двойной щелчок возвращает ширину по умолчанию; ширина запоминается
// в этом приложении. Чату всегда остаётся место: панель не растёт, если чат стал бы уже CHAT_MIN.

const PANELS = {
  sidebar: { min: 200, max: 420, default: 248 },
  members: { min: 200, max: 380, default: 240 },
};
const RAIL_WIDTH = 72;
const CHAT_MIN = 380;

/** Ширина панели kind: из сохранённого значения, в её пределах и так, чтобы чату хватило места.
 *  window — ширина окна, other — ширина второй боковой панели (0, если её не видно) */
function panelWidth(kind, value, { window, other = 0 }) {
  const p = PANELS[kind];
  const wanted = typeof value === 'number' && Number.isFinite(value) ? value : p.default;
  const room = window - RAIL_WIDTH - other - CHAT_MIN;
  return Math.max(p.min, Math.min(wanted, p.max, room));
}

if (typeof module !== 'undefined') module.exports = { PANELS, panelWidth };

// ---------- В окне приложения ----------

if (typeof document !== 'undefined') {
  const saved = () => store.get('panelWidths', {}) || {};
  const membersShown = () => !$('members-panel').classList.contains('hidden');

  // Ширины из сохранённых — в CSS-переменные; правую считаем первой, левая уступает чату остальное
  function applyPanelWidths() {
    const s = saved();
    const members = panelWidth('members', s.members, { window: innerWidth, other: PANELS.sidebar.min });
    const sidebar = panelWidth('sidebar', s.sidebar, { window: innerWidth, other: membersShown() ? members : 0 });
    document.documentElement.style.setProperty('--sidebar-w', `${sidebar}px`);
    document.documentElement.style.setProperty('--members-w', `${members}px`);
  }

  function savePanelWidth(kind, value) {
    const s = { ...saved() };
    if (value == null) delete s[kind];
    else s[kind] = Math.round(value);
    store.set('panelWidths', s);
    applyPanelWidths();
  }

  // Ручка на краю панели: тянем — меняется ширина, двойной щелчок — как было
  function addResizer(panel, kind, edge) {
    const handle = document.createElement('div');
    handle.className = `panel-resizer ${edge}`;
    handle.title = 'Потяните, чтобы изменить ширину; двойной щелчок — как было';
    handle.onpointerdown = (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      document.body.classList.add('resizing');
      const box = panel.getBoundingClientRect();
      handle.onpointermove = (m) => savePanelWidth(kind, edge === 'right' ? m.clientX - box.left : box.right - m.clientX);
      handle.onpointerup = () => {
        handle.onpointermove = handle.onpointerup = null;
        document.body.classList.remove('resizing');
      };
    };
    handle.ondblclick = () => savePanelWidth(kind, null);
    panel.append(handle);
  }

  addResizer(document.querySelector('.sidebar'), 'sidebar', 'right');
  addResizer($('members-panel'), 'members', 'left');
  addEventListener('resize', applyPanelWidths);
  // Список участников показали или спрятали — левой панели может стать тесно
  new MutationObserver(applyPanelWidths).observe($('members-panel'), { attributes: true, attributeFilter: ['class'] });
  applyPanelWidths();
}
