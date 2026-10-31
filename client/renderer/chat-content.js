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

const HUB_EMOJI_RE = /:([a-zа-яё0-9_]{2,24}):/gi;

/** :имя: в тексте сообщения → картинка смайлика канала; в коде и ссылках текст остаётся как есть */
function showHubEmojis(root, emojis) {
  if (!emojis?.length) return;
  const known = new Map(emojis.map((e) => [e.name, e]));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) if (walker.currentNode.nodeValue.includes(':')) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.parentElement.closest('code, pre, a')) continue;
    const parts = document.createDocumentFragment();
    let at = 0;
    for (const match of node.nodeValue.matchAll(HUB_EMOJI_RE)) {
      const emoji = known.get(match[1].toLowerCase());
      if (!emoji) continue;
      parts.append(node.nodeValue.slice(at, match.index));
      const img = document.createElement('img');
      img.className = 'hub-emoji';
      img.src = `${Api.base}${emoji.url}`;
      img.alt = img.title = match[0];
      parts.append(img);
      at = match.index + match[0].length;
    }
    if (!at) continue;
    parts.append(node.nodeValue.slice(at));
    node.replaceWith(parts);
  }
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
    if (m.roomId) showHubEmojis(text, hubById(roomById(m.roomId)?.hubId)?.emojis);
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
      img.attachment = a;
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
  if (m.preview) {
    const yt = youtubeId(m.preview.url);
    box.append(yt ? youtubeCard(yt, m.preview) : linkCard(m.preview));
  } else {
    // Превью нет (ссылку прислали без карточки) — но ролик YouTube всё равно покажем плеером
    const link = findLinks(m.text || '')[0];
    const yt = youtubeId(link);
    if (yt) box.append(youtubeCard(yt, { url: link }));
  }
  return box;
}

/** id ролика YouTube из ссылки (watch, youtu.be, shorts, embed, live) */
function youtubeId(url) {
  if (!url) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, '');
  if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
  if (host !== 'youtube.com' && host !== 'music.youtube.com') return null;
  if (u.pathname === '/watch') return u.searchParams.get('v');
  const m = /^\/(?:shorts|embed|live|v)\/([\w-]{6,})/.exec(u.pathname);
  return m ? m[1] : null;
}

/** Карточка ролика: обложка с кнопкой, по щелчку — встроенный плеер, никуда не уходя из чата */
function youtubeCard(id, p) {
  const card = document.createElement('div');
  card.className = 'link-card yt-card';
  const thumb = document.createElement('button');
  thumb.type = 'button';
  thumb.className = 'yt-thumb';
  thumb.style.backgroundImage = `url("https://i.ytimg.com/vi/${id}/hqdefault.jpg")`;
  thumb.title = 'Смотреть в чате';
  thumb.innerHTML = '<span class="yt-play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>';
  const text = document.createElement('div');
  text.className = 'link-card-text';
  const site = document.createElement('div');
  site.className = 'link-card-site small';
  site.textContent = 'YouTube';
  const title = document.createElement('a');
  title.className = 'link-card-title';
  title.href = p.url || `https://www.youtube.com/watch?v=${id}`;
  title.target = '_blank';
  title.rel = 'noopener noreferrer';
  title.textContent = p.title || 'Смотреть ролик';
  // YouTube не отдаёт превью серверу — название ролика берём у oEmbed, если его ещё нет
  if (!p.title) {
    fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(title.href)}&format=json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.title && title.textContent === 'Смотреть ролик') title.textContent = d.title;
      })
      .catch(() => {});
  }
  text.append(site, title);
  if (p.description) {
    const d = document.createElement('div');
    d.className = 'link-card-desc small';
    d.textContent = p.description;
    text.append(d);
  }
  card.append(thumb, text);
  thumb.onclick = () => {
    const frame = document.createElement('iframe');
    frame.className = 'yt-frame';
    frame.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
    frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen';
    frame.allowFullscreen = true;
    frame.title = p.title || 'Видео YouTube';
    // Если встроенный плеер не поднимется (сеть, ограничения) — ссылка на ролик останется под ним
    const open = document.createElement('a');
    open.className = 'yt-open small';
    open.href = p.url || `https://www.youtube.com/watch?v=${id}`;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    open.textContent = 'Открыть на YouTube';
    card.replaceChildren(frame, open);
  };
  return card;
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

// ---------- Картинка: скопировать и скачать ----------

/** Сама картинка: зашифрованную отдаёт расшифровка, ссылка на сервер дала бы только шифр */
async function imageBlob(a) {
  const res = await fetch(a.key ? await decryptedFileUrl(a) : fileUrl(a));
  if (!res.ok) throw new Error('Файл не найден');
  return res.blob();
}

/** В буфер — PNG: другой формат программы не вставят. Гифка копируется первым кадром */
async function copyImage(a) {
  try {
    const bitmap = await createImageBitmap(await imageBlob(a));
    const canvas = Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    if (window.desktop?.copyImage) await window.desktop.copyImage(canvas.toDataURL('image/png'));
    else {
      const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    }
    toast('Картинка скопирована', 1500);
  } catch {
    toast('Не удалось скопировать картинку');
  }
}

async function downloadImage(a) {
  try {
    const url = URL.createObjectURL(await imageBlob(a));
    Object.assign(document.createElement('a'), { href: url, download: a.name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    toast('Не удалось скачать картинку');
  }
}

// ---------- Просмотр картинки ----------

function openImageViewer(a) {
  const viewer = $('image-viewer');
  setFileSrc($('image-viewer-img'), 'src', a);
  $('image-viewer-img').attachment = a;
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
