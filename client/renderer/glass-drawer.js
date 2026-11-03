// Drawer: на узком окне панели участников и треда выезжают поверх чата,
// с затемнением. На широком окне поведение прежнее — колонки в сетке.
(() => {
  const NARROW = 900;
  let scrim = null;

  function getScrim() {
    if (scrim) return scrim;
    scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.addEventListener('pointerdown', closeDrawers);
    document.body.append(scrim);
    return scrim;
  }

  const isOpen = (panel) => panel && !panel.classList.contains('hidden');

  // Тред открывается кодом — ему достаточно класса. Участники открываются
  // только по нажатию кнопки, чтобы не накрывать панель звонка сами собой.
  function syncDrawerClass() {
    const narrow = window.innerWidth <= NARROW;
    const thread = document.getElementById('thread-panel');
    if (thread) thread.classList.toggle('drawer-open', narrow && isOpen(thread));
    const members = document.getElementById('members-panel');
    if (members && (!narrow || !members.classList.contains('drawer-open'))) members.classList.remove('drawer-open');
  }

  function syncScrim() {
    syncDrawerClass();
    const narrow = window.innerWidth <= NARROW;
    const open = narrow && (
      document.getElementById('members-panel')?.classList.contains('drawer-open') ||
      document.getElementById('thread-panel')?.classList.contains('drawer-open')
    );
    const layer = getScrim();
    const next = Boolean(open);
    if (layer.classList.contains('is-on') !== next) layer.classList.toggle('is-on', next);
  }

  function closeDrawers() {
    if (window.innerWidth > NARROW) return;
    for (const id of ['members-panel', 'thread-panel']) {
      const panel = document.getElementById(id);
      if (!panel) continue;
      panel.classList.add('hidden');
      panel.classList.remove('drawer-open');
    }
    syncScrim();
  }

  // На узком окне кнопка «участники» открывает выдвижную панель
  document.addEventListener('click', (event) => {
    const toggle = event.target.closest?.('.members-toggle');
    if (!toggle || window.innerWidth > NARROW) return;
    event.preventDefault();
    event.stopPropagation();
    const panel = document.getElementById('members-panel');
    if (!panel) return;
    const willOpen = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !willOpen);
    panel.classList.toggle('drawer-open', willOpen);
    syncScrim();
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDrawers();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > NARROW) {
      getScrim().classList.remove('is-on');
      for (const id of ['members-panel', 'thread-panel']) document.getElementById(id)?.classList.remove('drawer-open');
    } else {
      syncScrim();
    }
  }, { passive: true });

  // Следим только за классами самих панелей: наблюдение за всем body
  // зацикливалось на переключении класса у затемнения
  const observer = new MutationObserver(syncScrim);
  for (const id of ['members-panel', 'thread-panel']) {
    const panel = document.getElementById(id);
    if (panel) observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
  }
  syncScrim();
})();