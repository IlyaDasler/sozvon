// Свайпы между вкладками настроек канала и комнаты.
// Работают только по телу настроек, не по самим вкладкам и не по полям.
(() => {
  let start = null;

  const bodyOf = (target) => target.closest?.('#hub-settings .rs-body, #room-manage .rs-body') || null;

  document.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1) return;
    const body = bodyOf(event.target);
    if (!body) return;
    if (event.target.closest('input, textarea, select, button, a, [contenteditable="true"]')) return;
    const t = event.touches[0];
    start = { x: t.clientX, y: t.clientY, body };
  }, { capture: true, passive: true });

  document.addEventListener('touchend', (event) => {
    if (!start) return;
    const body = start.body;
    const t = event.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    start = null;
    if (!body.isConnected || Math.abs(dx) < 54 || Math.abs(dx) < Math.abs(dy) * 1.25) return;

    const card = body.closest('.rs-card');
    const buttons = [...card.querySelectorAll('.rs-nav [data-tab]:not(.hidden)')];
    const active = buttons.findIndex((b) => b.classList.contains('active'));
    const next = active + (dx < 0 ? 1 : -1);
    if (active < 0 || next < 0 || next >= buttons.length) return;

    event.preventDefault();
    event.stopPropagation();
    buttons[next].click();
  }, { capture: true, passive: false });
})();
