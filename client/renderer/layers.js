// Слои поверх окна: всплывающие меню и панели, окна (modal), просмотр картинки и трансляции.
// Одно место решает, что закрывается: Esc закрывает только верхний слой, а открытое окно
// убирает все всплывающие меню, чтобы они не висели поверх него.

// Всплывающие меню и панели — закрываются все разом
const POPOVERS = [
  () => hideMenu(),
  () => closeProfileCard(),
  () => $('status-menu').classList.add('hidden'),
  () => closeNotifPanel(),
  () => document.querySelector('.emoji-popover')?.classList.add('hidden'),
  () => hideRailTip(),
  () => $('chat-theme-pop').classList.add('hidden'),
];

const POPOVER_SELECTOR = '#popup-menu, #profile-card, #status-menu, #notif-panel, .emoji-popover, #chat-theme-pop';
const anyPopoverOpen = () => [...document.querySelectorAll(POPOVER_SELECTOR)].some((el) => !el.classList.contains('hidden'));

function closePopovers() {
  for (const close of POPOVERS) close();
}

// Окна со своим закрытием (сбрасывают состояние); остальные просто прячутся.
// Входящий звонок и установка обновления Esc не закрывает — там нужен осознанный выбор
const MODAL_CLOSE = {
  settings: () => closeSettings(),
  'screen-picker': () => closeScreenPicker(),
  'room-manage': () => closeRoomManage(),
  'hub-settings': () => closeHubSettings(),
  dialog: () => closeDialog(false),
};
const MODAL_KEEP = new Set(['incoming', 'updating']);

const openModals = () => [...document.querySelectorAll('.modal:not(.hidden)')];

function closeTopLayer() {
  if (anyPopoverOpen()) return closePopovers();
  if (document.querySelector('.fullview:not(.hidden)')) return closeFullView();
  if (!$('image-viewer').classList.contains('hidden')) return closeImageViewer();
  // Верхнее окно — последнее в разметке
  const top = openModals().at(-1);
  if (!top || MODAL_KEEP.has(top.id)) return;
  (MODAL_CLOSE[top.id] || (() => top.classList.add('hidden')))();
}

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  closeTopLayer();
});

// Окно открылось — меню под ним больше не нужны
const modalWatcher = new MutationObserver((changes) => {
  if (changes.some((c) => !c.target.classList.contains('hidden') && c.oldValue?.includes('hidden'))) closePopovers();
});
for (const modal of document.querySelectorAll('.modal'))
  modalWatcher.observe(modal, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
