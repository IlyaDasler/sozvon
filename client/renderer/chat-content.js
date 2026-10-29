// Содержимое сообщения: текст с разметкой, вложения (картинки, видео, звук, файлы) и превью ссылки.
// Общее для чата с другом и комнаты.

// Сообщение только из смайликов (до трёх) показывается крупно
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic}|[️\u{1f3fb}-\u{1f3ff}])*\s*){1,3}$/u;

const fileUrl = (a) => `${Api.base}${a.url}`;

/** Адрес файла в элемент: обычный — сразу, зашифрованный — когда расшифруется */
function setFileSrc(el, prop, a) {
  if (!a.key) return void (el[prop] = fileUrl(a));
  decryptedFileUrl(a).then((url) => (el[prop] = url), () => el.classList.add('file-broken'));
}

/** Что показывать: у зашифрованного сообщения — расшифрованные текст, файлы (с адресами с сервера) и превью */
function messageView(m) {
  if (!m.enc) return m;
  if (!m.plain) return { ...m, text: '', attachments: [], preview: null };
  const stored = new Map((m.attachments || []).map((a) => [a.id, a]));
  const attachments = (m.plain.files || []).filter((f) => stored.has(f.id)).map((f) => ({ ...f, url: stored.get(f.id).url }));
  return { ...m, text: m.plain.text || '', attachments, preview: m.plain.preview || null };
}

// Почему зашифрованное сообщение не показать
const LOCKED_REASONS = {
  'no-identity': '🔒 Не прочитать на этом устройстве — перенесите сюда ключ шифрования (Настройки → Аккаунт)',
  'no-key': '🔒 Нет ключа к этому сообщению — его ещё не передали этому устройству',
  broken: '🔒 Сообщение повреждено — расшифровать не получилось',
};

/** Коротко о сообщении — для уведомлений */
function messageSummary(m) {
  if (m.enc && !m.plain) return '🔒 Зашифрованное сообщение';
  m = messageView(m);
  if (m.text) return m.text;
  const n = m.attachments?.length || 0;
  const kinds = new Set((m.attachments || []).map((a) => a.kind));
  if (kinds.size === 1 && kinds.has('image')) return n > 1 ? `🖼 ${n} картинки` : '🖼 Картинка';
  if (kinds.size === 1 && kinds.has('video')) return '🎬 Видео';
  if (kinds.size === 1 && kinds.has('audio')) return '🎵 Аудио';
  return n > 1 ? `📎 ${n} ${plural(n, 'файл', 'файла', 'файлов')}` : `📎 ${m.attachments?.[0]?.name || 'Файл'}`;
}

function messageContent(m) {
  const box = document.createElement('div');
  box.className = 'msg-content';
  box.title = formatTime(m.createdAt);
  if (m.enc && !m.plain) {
    const locked = document.createElement('div');
    locked.className = 'msg-locked';
    locked.textContent = LOCKED_REASONS[m.locked] || 'Расшифровка…';
    box.append(locked);
    return box;
  }
  m = messageView(m);
  if (m.text) {
    const text = document.createElement('div');
    text.className = `msg-text${EMOJI_ONLY.test(m.text.trim()) ? ' emoji-only' : ''}`;
    text.append(renderMarkdown(m.text));
    box.append(text);
  }
  const attachments = m.attachments || [];
  const images = attachments.filter((a) => a.kind === 'image');
  if (images.length) {
    const grid = document.createElement('div');
    grid.className = `msg-images n${Math.min(images.length, 4)}`;
    for (const a of images) {
      const img = document.createElement('img');
      setFileSrc(img, 'src', a);
      img.alt = a.name;
      img.loading = 'lazy';
      img.title = `${a.name} — нажмите, чтобы открыть`;
      img.onclick = () => openImageViewer(a);
      // Гифку можно сохранить себе в «Мои гифки»
      if (/gif|webp/.test(a.mime || a.name || '')) {
        const cell = document.createElement('div');
        cell.className = 'gif-cell';
        const save = Object.assign(document.createElement('button'), { type: 'button', className: 'gif-save', title: 'В мои гифки' });
        save.innerHTML = '<svg viewBox="0 0 24 24"><path d="m12 3 2.8 5.6 6.2.9-4.5 4.4 1 6.1L12 17.2 6.5 20l1-6.1L3 9.5l6.2-.9z"/></svg>';
        save.onclick = (e) => {
          e.stopPropagation();
          saveGifFromMessage(img, a);
        };
        cell.append(img, save);
        grid.append(cell);
        continue;
      }
      grid.append(img);
    }
    box.append(grid);
  }
  for (const a of attachments) {
    if (a.kind === 'video') {
      const video = document.createElement('video');
      video.className = 'msg-video';
      setFileSrc(video, 'src', a);
      video.controls = true;
      video.preload = 'metadata';
      box.append(video);
    } else if (a.kind === 'audio') {
      const card = fileCard(a);
      const audio = document.createElement('audio');
      setFileSrc(audio, 'src', a);
      audio.controls = true;
      audio.preload = 'metadata';
      card.append(audio);
      box.append(card);
    } else if (a.kind === 'file') {
      box.append(fileCard(a));
    }
  }
  if (m.preview) box.append(linkCard(m.preview));
  return box;
}

function fileCard(a) {
  const card = document.createElement('div');
  card.className = 'file-card';
  const row = document.createElement('div');
  row.className = 'file-card-row';
  const icon = document.createElement('span');
  icon.className = 'file-card-icon';
  icon.innerHTML = COMPOSER_ICONS.file;
  const info = document.createElement('div');
  info.className = 'file-card-info';
  const name = document.createElement('a');
  name.className = 'ellipsis';
  setFileSrc(name, 'href', a);
  name.download = a.name;
  name.textContent = a.name;
  name.title = 'Скачать';
  const size = document.createElement('span');
  size.className = 'muted small';
  size.textContent = formatSize(a.size);
  info.append(name, size);
  const download = document.createElement('a');
  download.className = 'icon-btn';
  setFileSrc(download, 'href', a);
  download.download = a.name;
  download.title = 'Скачать';
  download.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>';
  row.append(icon, info, download);
  card.append(row);
  return card;
}

/** Карточка превью ссылки: сайт, заголовок-ссылка, описание и картинка */
function linkCard(p) {
  const card = document.createElement('div');
  card.className = 'link-card';
  const text = document.createElement('div');
  text.className = 'link-card-text';
  const site = document.createElement('div');
  site.className = 'link-card-site small';
  site.textContent = p.siteName || '';
  const title = document.createElement('a');
  title.className = 'link-card-title';
  title.href = p.url;
  title.target = '_blank';
  title.rel = 'noopener noreferrer';
  title.textContent = p.title;
  text.append(site, title);
  if (p.description) {
    const d = document.createElement('div');
    d.className = 'link-card-desc small';
    d.textContent = p.description;
    text.append(d);
  }
  card.append(text);
  if (p.image) {
    const img = document.createElement('img');
    img.className = 'link-card-image';
    img.src = p.image;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => img.remove();
    card.append(img);
  }
  return card;
}

// ---------- Просмотр картинки ----------

function openImageViewer(a) {
  const viewer = $('image-viewer');
  setFileSrc($('image-viewer-img'), 'src', a);
  $('image-viewer-name').textContent = a.name;
  setFileSrc($('image-viewer-open'), 'href', a);
  $('image-viewer-open').download = a.name;
  viewer.classList.remove('hidden');
}

const closeImageViewer = () => {
  $('image-viewer').classList.add('hidden');
  $('image-viewer-img').removeAttribute('src');
};

$('image-viewer').onclick = (e) => {
  if (e.target.closest('a')) return;
  closeImageViewer();
};
