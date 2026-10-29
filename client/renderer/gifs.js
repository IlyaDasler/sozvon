// «Мои гифки»: своя коллекция GIF на этом компьютере (IndexedDB, у каждого аккаунта своя).
// Добавил один раз — дальше гифка отправляется одним щелчком из панели у поля ввода; полученную в чате
// гифку можно сохранить себе кнопкой на ней.

const GIF_MAX_BYTES = 10 * 1024 * 1024;
const GIF_TYPES = /^image\/(gif|webp)$/;

function gifsDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('sozvon-gifs', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('gifs', { keyPath: 'id', autoIncrement: true }).createIndex('owner', 'owner');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function gifsTx(mode, fn) {
  const db = await gifsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('gifs', mode);
    const req = fn(tx.objectStore('gifs'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

/** Мои гифки, новые первыми: [{ id, name, type, data }] */
async function listGifs() {
  const all = await gifsTx('readonly', (s) => s.index('owner').getAll(state.me.id));
  return all.sort((a, b) => b.addedAt - a.addedAt);
}

async function addGif(file) {
  if (!GIF_TYPES.test(file.type)) throw new Error('Это не гифка — подойдут GIF и анимированные WebP');
  if (file.size > GIF_MAX_BYTES) throw new Error('Гифка больше 10 МБ');
  const data = await file.arrayBuffer();
  await gifsTx('readwrite', (s) => s.add({ owner: state.me.id, name: file.name || 'гифка.gif', type: file.type, data, addedAt: Date.now() }));
}

const removeGif = (id) => gifsTx('readwrite', (s) => s.delete(id));

// ---------- Панель у поля ввода ----------

let gifPopover = null;
let gifTarget = null;
const gifUrls = [];

function buildGifPopover() {
  const pop = document.createElement('div');
  pop.className = 'gif-popover hidden';
  pop.addEventListener('click', (e) => e.stopPropagation());
  pop.innerHTML = '<div class="gif-head"><b>Мои гифки</b><span class="muted small">Щелчок — отправить, правая кнопка — убрать</span></div><div class="gif-grid"></div>';
  const pick = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/gif,image/webp', multiple: true, hidden: true });
  pick.onchange = async () => {
    for (const file of pick.files) await addGif(file).catch((err) => toast(err.message));
    pick.value = '';
    renderGifPopover();
  };
  pop.append(pick);
  pop.pick = pick;
  document.body.append(pop);
  return pop;
}

async function renderGifPopover() {
  const grid = gifPopover.querySelector('.gif-grid');
  for (const url of gifUrls.splice(0)) URL.revokeObjectURL(url);
  grid.replaceChildren();
  const add = Object.assign(document.createElement('button'), { type: 'button', className: 'gif-add', textContent: '+ Добавить' });
  add.title = 'Добавить гифки с компьютера';
  add.onclick = () => gifPopover.pick.click();
  grid.append(add);
  for (const g of await listGifs()) {
    const url = URL.createObjectURL(new Blob([g.data], { type: g.type }));
    gifUrls.push(url);
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'gif-item', title: g.name });
    b.innerHTML = '<img alt="">';
    b.querySelector('img').src = url;
    b.onclick = () => sendGif(g);
    b.oncontextmenu = async (e) => {
      e.preventDefault();
      if (!(await ask(`Убрать «${g.name}» из ваших гифок?`, { title: 'Убрать гифку?', ok: 'Убрать', danger: true }))) return;
      await removeGif(g.id);
      renderGifPopover();
    };
    grid.append(b);
  }
}

/** Отправить гифку сразу — в тот чат, у поля ввода которого открыта панель */
async function sendGif(g) {
  const composer = gifTarget;
  gifPopover.classList.add('hidden');
  if (!composer) return;
  try {
    await composer.sendFileNow(new File([g.data], g.name, { type: g.type }));
  } catch (err) {
    toast(err.message);
  }
}

function toggleGifPicker(composer) {
  gifPopover ??= buildGifPopover();
  const open = !gifPopover.classList.contains('hidden') && gifTarget === composer;
  if (open) return gifPopover.classList.add('hidden');
  gifTarget = composer;
  renderGifPopover();
  gifPopover.classList.remove('hidden');
  const r = composer.gifBtn.getBoundingClientRect();
  gifPopover.style.right = `${Math.max(8, innerWidth - r.right)}px`;
  gifPopover.style.bottom = `${innerHeight - r.top + 8}px`;
}

document.addEventListener('click', () => gifPopover?.classList.add('hidden'));

/** Кнопка «В мои гифки» на гифке в сообщении: берём уже расшифрованный файл со страницы */
async function saveGifFromMessage(img, a) {
  try {
    const blob = await (await fetch(img.src)).blob();
    await addGif(new File([blob], a.name || 'гифка.gif', { type: a.mime || blob.type || 'image/gif' }));
    toast('Гифка сохранена — она в «Моих гифках» у поля ввода');
  } catch (err) {
    toast(err.message);
  }
}
