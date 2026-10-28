// Поле ввода сообщения — одно и то же в чате с другом и в комнате.
// Enter — отправить, Shift+Enter — новая строка. «+» прикрепляет файлы (или перетащить в чат, или вставить
// из буфера обмена), кнопка со смайликом открывает выбор смайликов. Если в тексте есть ссылка, над полем
// появляется её превью; крестик убирает превью — тогда уйдёт только ссылка.

const MAX_FILE_MB = 25;
const MAX_FILES = 10;
const PREVIEW_DELAY_MS = 600;

const COMPOSER_ICONS = {
  attach: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>',
  emoji: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
};

const formatSize = (bytes) =>
  bytes < 1024 ? `${bytes} Б` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} КБ` : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;

function autoGrow(area) {
  area.style.height = 'auto';
  area.style.height = `${area.scrollHeight + 2}px`;
}

// Загрузка с ходом в процентах (у fetch его нет)
function uploadFile(file, onProgress) {
  const xhr = new XMLHttpRequest();
  const done = new Promise((resolve, reject) => {
    xhr.open('POST', `${Api.base}/api/uploads?name=${encodeURIComponent(file.name || 'файл')}`);
    xhr.setRequestHeader('Authorization', `Bearer ${Api.token}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || `Не удалось загрузить файл (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Сервер недоступен'));
    xhr.onabort = () => reject(new Error('Загрузка отменена'));
    xhr.send(file);
  });
  return { done, abort: () => xhr.abort() };
}

class Composer {
  /** send({ text, files, preview }) шифрует и отправляет сообщение */
  constructor(form, area, send) {
    this.form = form;
    this.area = area;
    this.send = send;
    this.files = []; // { file, url, progress, attachment, error, upload }
    this.preview = null; // { url, data }
    this.removedPreviews = new Set();
    this.previewTimer = null;
    this.build();
  }

  build() {
    const { form, area } = this;
    form.replaceChildren();
    this.filesBox = Object.assign(document.createElement('div'), { className: 'composer-files hidden' });
    this.previewBox = Object.assign(document.createElement('div'), { className: 'composer-preview hidden' });
    const bar = Object.assign(document.createElement('div'), { className: 'composer-bar' });
    const button = (cls, title, icon, type = 'button') => {
      const b = document.createElement('button');
      b.type = type;
      b.className = `composer-btn ${cls}`;
      b.title = title;
      b.innerHTML = icon;
      return b;
    };
    this.attachBtn = button('attach', 'Прикрепить файл (до 25 МБ) — можно и перетащить в чат', COMPOSER_ICONS.attach);
    this.emojiBtn = button('emoji', 'Смайлики', COMPOSER_ICONS.emoji);
    this.sendBtn = button('send', 'Отправить (Enter)', COMPOSER_ICONS.send, 'submit');
    this.picker = Object.assign(document.createElement('input'), { type: 'file', multiple: true, hidden: true });
    bar.append(this.attachBtn, area, this.emojiBtn, this.sendBtn);
    form.append(this.filesBox, this.previewBox, bar, this.picker);

    this.attachBtn.onclick = () => this.picker.click();
    this.picker.onchange = () => {
      this.addFiles([...this.picker.files]);
      this.picker.value = '';
    };
    this.emojiBtn.onclick = (e) => {
      e.stopPropagation();
      toggleEmojiPicker(this);
    };
    area.addEventListener('input', () => {
      autoGrow(area);
      this.schedulePreview();
    });
    area.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      e.preventDefault();
      form.requestSubmit();
    });
    // Картинку из буфера обмена (Ctrl+V скриншота) — сразу во вложения
    area.addEventListener('paste', (e) => {
      const files = [...(e.clipboardData?.files || [])];
      if (!files.length) return;
      e.preventDefault();
      this.addFiles(files);
    });
    form.onsubmit = (e) => {
      e.preventDefault();
      this.submit();
    };
  }

  /** Перетаскивание файлов в область чата */
  acceptDrops(zone) {
    zone.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('Files') || this.area.disabled) return;
      e.preventDefault();
      zone.classList.add('drop-target');
    });
    zone.addEventListener('dragleave', (e) => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('drop-target');
    });
    zone.addEventListener('drop', (e) => {
      zone.classList.remove('drop-target');
      if (!e.dataTransfer?.files.length || this.area.disabled) return;
      e.preventDefault();
      this.addFiles([...e.dataTransfer.files]);
    });
  }

  setDisabled(disabled, placeholder) {
    for (const el of [this.area, this.attachBtn, this.emojiBtn, this.sendBtn]) el.disabled = disabled;
    this.area.placeholder = placeholder;
  }

  focus() {
    this.area.focus();
  }

  // ---------- Файлы ----------

  addFiles(list) {
    for (const file of list) {
      if (this.files.length >= MAX_FILES) {
        toast(`Можно прикрепить не больше ${MAX_FILES} файлов`);
        break;
      }
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        toast(`«${file.name}» больше ${MAX_FILE_MB} МБ`);
        continue;
      }
      const item = { file, url: /^image\//.test(file.type) ? URL.createObjectURL(file) : null, progress: 0 };
      item.upload = uploadEncrypted(file, (p) => {
        item.progress = p;
        this.renderFiles();
      });
      item.upload.done.then(
        (attachment) => (item.attachment = attachment),
        (err) => (item.error = err.message)
      ).finally(() => this.renderFiles());
      this.files.push(item);
    }
    this.renderFiles();
    this.focus();
  }

  removeFile(item) {
    item.upload.abort();
    if (item.url) URL.revokeObjectURL(item.url);
    this.files = this.files.filter((f) => f !== item);
    this.renderFiles();
  }

  renderFiles() {
    this.filesBox.replaceChildren();
    this.filesBox.classList.toggle('hidden', !this.files.length);
    for (const item of this.files) {
      const chip = document.createElement('div');
      chip.className = `file-chip${item.error ? ' error' : ''}`;
      const thumb = document.createElement('div');
      thumb.className = 'file-thumb';
      if (item.url) thumb.style.backgroundImage = `url("${item.url}")`;
      else thumb.innerHTML = COMPOSER_ICONS.file;
      const name = document.createElement('div');
      name.className = 'file-name ellipsis';
      name.textContent = item.file.name;
      const sub = document.createElement('div');
      sub.className = 'muted small ellipsis';
      sub.textContent = item.error || (item.attachment ? formatSize(item.file.size) : `Загрузка ${Math.round(item.progress * 100)}%`);
      const bar = document.createElement('div');
      bar.className = 'file-progress';
      bar.style.width = `${item.attachment || item.error ? 0 : Math.round(item.progress * 100)}%`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'file-remove';
      remove.title = 'Убрать';
      remove.innerHTML = COMPOSER_ICONS.close;
      remove.onclick = () => this.removeFile(item);
      chip.append(thumb, name, sub, bar, remove);
      this.filesBox.append(chip);
    }
  }

  // ---------- Превью ссылки ----------

  schedulePreview() {
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => this.updatePreview(), PREVIEW_DELAY_MS);
  }

  async updatePreview() {
    const url = findLinks(this.area.value).find((u) => !this.removedPreviews.has(u)) || null;
    if (url === this.preview?.url) return;
    this.preview = url ? { url, data: undefined } : null;
    this.renderPreview();
    if (!url) return;
    // Превью делает само приложение: сервер не должен знать, какими ссылками делятся в зашифрованной переписке
    const data = await (window.desktop?.preview?.(url) ?? Promise.resolve(null)).catch(() => null);
    if (this.preview?.url !== url) return; // пока грузили, ссылка поменялась
    this.preview.data = data;
    this.renderPreview();
  }

  renderPreview() {
    const box = this.previewBox;
    box.replaceChildren();
    const p = this.preview;
    box.classList.toggle('hidden', !p || p.data === null);
    if (!p || p.data === null) return;
    box.append(p.data === undefined ? Object.assign(document.createElement('div'), { className: 'muted small', textContent: 'Загружаем превью ссылки…' }) : linkCard(p.data));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'file-remove';
    remove.title = 'Убрать превью — отправится только ссылка';
    remove.innerHTML = COMPOSER_ICONS.close;
    remove.onclick = () => {
      this.removedPreviews.add(p.url);
      this.preview = null;
      this.renderPreview();
      this.updatePreview();
    };
    box.append(remove);
  }

  // ---------- Отправка ----------

  async submit() {
    const text = this.area.value.trim();
    if (this.files.some((f) => !f.attachment && !f.error)) return toast('Подождите, файлы ещё загружаются');
    const ready = this.files.filter((f) => f.attachment);
    if (!text && !ready.length) return;
    const payload = { text, files: ready.map((f) => f.attachment), preview: null };
    if (this.preview?.data && text.includes(this.preview.url.replace(/^https:\/\/(?=www\.)/, ''))) payload.preview = this.preview.data;
    this.sendBtn.disabled = true;
    try {
      await this.send(payload);
      this.reset();
    } catch (err) {
      toast(err.message);
    } finally {
      this.sendBtn.disabled = false;
    }
  }

  reset() {
    emojiPopover?.classList.add('hidden');
    for (const f of this.files) if (f.url) URL.revokeObjectURL(f.url);
    this.files = [];
    this.preview = null;
    this.removedPreviews.clear();
    clearTimeout(this.previewTimer);
    this.area.value = '';
    autoGrow(this.area);
    this.renderFiles();
    this.renderPreview();
  }
}

// ---------- Смайлики ----------

const EMOJI_GROUPS = [
  ['Смайлы', '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖'],
  ['Жесты', '👍 👎 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 👏 🙌 👐 🤲 🤝 🙏 💪 🫡 🫶 👀 🧠 🫠 🤷 🤦 🙋 🙅 🙆 💃 🕺'],
  ['Сердца', '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 💢 💥 💫 💦 💨 🔥 ✨ ⭐ 🌟 ⚡'],
  ['Игры', '🎮 🕹️ 🎯 🎲 🧩 ♟️ 🏆 🥇 🥈 🥉 🏅 🎖️ ⚽ 🏀 🏈 ⚾ 🎾 🏐 🏓 🥊 🏹 🛡️ ⚔️ 🗡️ 🔫 💣 🧨 🪓 🔧 🛠️ 💎 👑 🎧 🎤 📸 💻 🖥️ ⌨️ 🖱️'],
  ['Природа', '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦆 🦅 🦉 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐢 🐍 🦖 🐙 🦀 🐬 🐳 🌵 🌲 🌸 🌻 🍀 🍁 🌙 ☀️ ☁️ 🌧️ ❄️ 🌈'],
  ['Еда', '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🍆 🥔 🥕 🌽 🌶️ 🥒 🍞 🧀 🥚 🍳 🥓 🍔 🍟 🍕 🌭 🥪 🌮 🍣 🍜 🍩 🍪 🎂 🍰 🍫 🍿 ☕ 🍵 🥤 🍺 🍻 🥂 🍷'],
  ['Символы', '✅ ❌ ❓ ❗ ‼️ ⚠️ 🚫 ⛔ 🔞 💤 🆗 🆒 🆕 🔝 🎉 🎊 🎁 🎈 📌 📎 🔗 🔒 🔑 🔔 🔕 📣 💬 💭 🕐 ⏰ ⌛ 🚀 ✈️ 🚗 🏠 🌍 💰 💸 📈 📉'],
];

let emojiPopover = null;
let emojiTarget = null;

function insertEmoji(composer, emoji) {
  const area = composer.area;
  const start = area.selectionStart ?? area.value.length;
  const end = area.selectionEnd ?? start;
  area.value = area.value.slice(0, start) + emoji + area.value.slice(end);
  area.selectionStart = area.selectionEnd = start + emoji.length;
  autoGrow(area);
  area.focus();
  const recent = [emoji, ...store.get('recentEmoji', []).filter((e) => e !== emoji)].slice(0, 16);
  store.set('recentEmoji', recent);
}

function buildEmojiPopover() {
  const pop = document.createElement('div');
  pop.className = 'emoji-popover hidden';
  pop.addEventListener('click', (e) => e.stopPropagation());
  const tabs = document.createElement('div');
  tabs.className = 'emoji-tabs';
  const grid = document.createElement('div');
  grid.className = 'emoji-grid';
  const show = (name) => {
    const group = name === 'Недавние' ? store.get('recentEmoji', []) : EMOJI_GROUPS.find(([n]) => n === name)[1].split(' ');
    grid.replaceChildren();
    for (const t of tabs.children) t.classList.toggle('active', t.dataset.group === name);
    if (!group.length) grid.append(Object.assign(document.createElement('p'), { className: 'muted small', textContent: 'Здесь появятся смайлики, которые вы отправляете чаще всего' }));
    for (const emoji of group) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'emoji';
      b.textContent = emoji;
      b.onclick = () => insertEmoji(emojiTarget, emoji);
      grid.append(b);
    }
  };
  for (const [name, list] of [['Недавние', '🕐'], ...EMOJI_GROUPS.map(([n, l]) => [n, l.split(' ')[0]])]) {
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'emoji-tab';
    t.dataset.group = name;
    t.title = name;
    t.textContent = list;
    t.onclick = () => show(name);
    tabs.append(t);
  }
  pop.append(tabs, grid);
  pop.show = () => show(store.get('recentEmoji', []).length ? 'Недавние' : EMOJI_GROUPS[0][0]);
  document.body.append(pop);
  return pop;
}

function toggleEmojiPicker(composer) {
  emojiPopover ??= buildEmojiPopover();
  const open = !emojiPopover.classList.contains('hidden') && emojiTarget === composer;
  if (open) return emojiPopover.classList.add('hidden');
  emojiTarget = composer;
  emojiPopover.show();
  emojiPopover.classList.remove('hidden');
  const r = composer.emojiBtn.getBoundingClientRect();
  emojiPopover.style.right = `${Math.max(8, innerWidth - r.right)}px`;
  emojiPopover.style.bottom = `${innerHeight - r.top + 8}px`;
}

document.addEventListener('click', () => emojiPopover?.classList.add('hidden'));

// ---------- Два поля ввода: чат с другом и комната ----------

const dmComposer = new Composer($('message-form'), $('message-input'), async (payload) => {
  const peerId = state.selectedId;
  if (!peerId) return;
  const { body, plain } = await encryptOutgoing(dmConvOf(peerId), payload);
  addMessage({ ...(await Api.post(`/messages/${peerId}`, body)), plain });
});
dmComposer.acceptDrops($('chat'));

const roomComposer = new Composer($('room-message-form'), $('room-message-input'), async (payload) => {
  const roomId = state.selectedRoomId;
  if (!roomId) return;
  const { body, plain } = await encryptOutgoing(roomConvOf(roomId), payload);
  addRoomMessage({ ...(await Api.post(`/rooms/${roomId}/messages`, body)), plain });
});
roomComposer.acceptDrops($('room-view'));
