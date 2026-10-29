// «Назад» и «Вперёд», как в браузере: кнопки в полосе окна, боковые кнопки мыши, Alt+← и Alt+→.
// Место — где человек сейчас: чат, комната, канал без комнат или «Друзья». Переходы записываем, оборачивая
// selectContact, selectRoom и openHub: их зовут отовсюду, а внутренние вызовы (openHub → selectRoom) — один шаг.

const navBack = [];
const navForward = [];
let navDepth = 0;
let navReplaying = false;

function currentPlace() {
  if (state.selectedRoomId) return { room: state.selectedRoomId };
  if (state.selectedId) return { contact: state.selectedId };
  if (state.view && state.view !== 'home') return { hub: state.view };
  return { home: true };
}

const samePlace = (a, b) => a.room === b.room && a.contact === b.contact && a.hub === b.hub && a.home === b.home;

/** Место ещё существует (чат не удалён, из комнаты не выгнали) */
function placeExists(p) {
  if (p.contact) return state.contacts.has(p.contact);
  if (p.room) return Boolean(roomById(p.room));
  if (p.hub) return Boolean(hubById(p.hub));
  return true;
}

function goPlace(p) {
  navReplaying = true;
  try {
    if (p.contact) selectContact(p.contact);
    else if (p.room) selectRoom(p.room);
    else if (p.hub) openHub(p.hub);
    else selectContact(null);
  } finally {
    navReplaying = false;
  }
  renderNav();
}

function navStep(from, to) {
  let p;
  while ((p = from.pop()) && !placeExists(p));
  if (!p) return renderNav();
  to.push(currentPlace());
  goPlace(p);
}

const goBack = () => navStep(navBack, navForward);
const goForward = () => navStep(navForward, navBack);

function renderNav() {
  $('nav-back').disabled = !navBack.length;
  $('nav-forward').disabled = !navForward.length;
}

for (const name of ['selectContact', 'selectRoom', 'openHub']) {
  const fn = window[name];
  window[name] = function (...args) {
    const from = currentPlace();
    navDepth++;
    try {
      return fn.apply(this, args);
    } finally {
      navDepth--;
      if (!navDepth && !navReplaying && !samePlace(from, currentPlace())) {
        navBack.push(from);
        navForward.length = 0;
        renderNav();
      }
    }
  };
}

$('nav-back').onclick = goBack;
$('nav-forward').onclick = goForward;
window.addEventListener('mouseup', (e) => {
  if (e.button === 3) goBack();
  if (e.button === 4) goForward();
});
window.addEventListener('keydown', (e) => {
  if (!e.altKey || e.ctrlKey || e.shiftKey) return;
  if (e.key === 'ArrowLeft') goBack();
  else if (e.key === 'ArrowRight') goForward();
  else return;
  e.preventDefault();
});
renderNav();
