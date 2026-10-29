// Свои звуки: любой звук приложения (звонок, уведомление, вход в голос…) можно заменить своим файлом.
// Файлы лежат на этом компьютере (IndexedDB), в разговор и на сервер не уходят. Играет их Tone (call.js).

const SOUND_EVENTS = [
  ['ring', 'Входящий звонок'],
  ['ringback', 'Ожидание ответа'],
  ['notify', 'Уведомление'],
  ['join', 'Кто-то зашёл в голос'],
  ['leave', 'Кто-то вышел из голоса'],
  ['end', 'Конец звонка'],
];
const SOUND_MAX_SECONDS = 30;
const SOUND_MAX_BYTES = 5 * 1024 * 1024;

const customSounds = new Map(); // событие -> { name, buffer: AudioBuffer }

function soundsDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('sozvon-sounds', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('sounds');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function soundsStore(mode, fn) {
  const db = await soundsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sounds', mode);
    const req = fn(tx.objectStore('sounds'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

// Свои звуки — у каждого аккаунта на этом компьютере свои
const soundKey = (kind) => `${state.me?.id}:${kind}`;

async function decodeSound(data) {
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(data.slice(0));
  } finally {
    ctx.close();
  }
}

/** При входе: свои звуки этого аккаунта — в память, чтобы играли сразу */
async function loadCustomSounds() {
  customSounds.clear();
  for (const [kind] of SOUND_EVENTS) {
    try {
      const rec = await soundsStore('readonly', (s) => s.get(soundKey(kind)));
      if (rec) customSounds.set(kind, { name: rec.name, buffer: await decodeSound(rec.data) });
    } catch {}
  }
}

/** Свой файл для события: проверяем, что это звук и он не длиннее 30 секунд */
async function saveCustomSound(kind, file) {
  if (file.size > SOUND_MAX_BYTES) throw new Error('Файл больше 5 МБ — выберите покороче');
  const data = await file.arrayBuffer();
  let buffer;
  try {
    buffer = await decodeSound(data);
  } catch {
    throw new Error('Не получилось прочитать звук — подойдут MP3, WAV, OGG');
  }
  if (buffer.duration > SOUND_MAX_SECONDS) throw new Error(`Звук длиннее ${SOUND_MAX_SECONDS} секунд — выберите покороче`);
  await soundsStore('readwrite', (s) => s.put({ name: file.name, data }, soundKey(kind)));
  customSounds.set(kind, { name: file.name, buffer });
  renderSoundSettings();
}

async function resetCustomSound(kind) {
  await soundsStore('readwrite', (s) => s.delete(soundKey(kind)));
  customSounds.delete(kind);
  renderSoundSettings();
}

/** Настройки → Звук → «Свои звуки»: событие, какой звук, прослушать, выбрать файл, вернуть стандартный */
function renderSoundSettings() {
  const box = $('custom-sounds');
  if (!box) return;
  box.replaceChildren();
  for (const [kind, label] of SOUND_EVENTS) {
    const row = document.createElement('div');
    row.className = 'sound-row';
    row.dataset.sound = kind;
    const custom = customSounds.get(kind);
    const name = document.createElement('div');
    name.className = 'sound-name';
    name.innerHTML = '<b></b><span class="muted small ellipsis"></span>';
    name.querySelector('b').textContent = label;
    name.querySelector('span').textContent = custom ? custom.name : 'стандартный';
    const play = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-btn', title: 'Прослушать' });
    play.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>';
    play.onclick = () => tone.blip(kind, undefined, 0.12);
    const pick = Object.assign(document.createElement('input'), { type: 'file', accept: 'audio/*', hidden: true });
    pick.onchange = async () => {
      const file = pick.files[0];
      pick.value = '';
      if (!file) return;
      try {
        await saveCustomSound(kind, file);
        toast(`«${label}» — теперь ваш звук`);
      } catch (err) {
        toast(err.message, 6000);
      }
    };
    const choose = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: custom ? 'Другой файл' : 'Свой файл' });
    choose.onclick = () => pick.click();
    row.append(name, play, choose, pick);
    if (custom) {
      const reset = Object.assign(document.createElement('button'), { type: 'button', className: 'btn sound-reset', textContent: 'Стандартный' });
      reset.onclick = () => resetCustomSound(kind);
      row.append(reset);
    }
    box.append(row);
  }
}
