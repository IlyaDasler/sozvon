// Ширина боковых панелей — левой (комнаты и личные сообщения) и правой (участники) — и доля разговора
// над чатом во время звонка или голоса в комнате.
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

// Какую часть высоты занимает разговор над чатом: и звонку, и переписке всегда остаётся место
const CALL_SHARE = { min: 0.25, max: 0.85, default: 0.75 };
const callShare = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(CALL_SHARE.min, Math.min(value, CALL_SHARE.max)) : CALL_SHARE.default;

if (typeof module !== 'undefined') module.exports = { PANELS, panelWidth, callShare };

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
    document.documentElement.style.setProperty('--call-share', callShare(s.call));
  }

  function savePanelWidth(kind, value) {
    const s = { ...saved() };
    if (value == null) delete s[kind];
    else s[kind] = kind === 'call' ? Math.round(value * 1000) / 1000 : Math.round(value);
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

  // Граница между разговором и чатом: тянем вверх-вниз, двойной щелчок — как было
  function addSplitResizer(panel) {
    const handle = document.createElement('div');
    handle.className = 'panel-resizer bottom';
    handle.title = 'Потяните, чтобы поделить место между разговором и чатом; двойной щелчок — как было';
    handle.onpointerdown = (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      document.body.classList.add('resizing', 'resizing-rows');
      const box = panel.parentElement.getBoundingClientRect();
      handle.onpointermove = (m) => savePanelWidth('call', callShare((m.clientY - box.top) / box.height));
      handle.onpointerup = () => {
        handle.onpointermove = handle.onpointerup = null;
        document.body.classList.remove('resizing', 'resizing-rows');
      };
    };
    handle.ondblclick = () => savePanelWidth('call', null);
    panel.append(handle);
  }

  addResizer(document.querySelector('.sidebar'), 'sidebar', 'right');
  addSplitResizer($('call-panel'));
  addResizer($('members-panel'), 'members', 'left');
  addEventListener('resize', applyPanelWidths);
  // Список участников показали или спрятали — левой панели может стать тесно
  new MutationObserver(applyPanelWidths).observe($('members-panel'), { attributes: true, attributeFilter: ['class'] });
  applyPanelWidths();
}
