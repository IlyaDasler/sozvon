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
  // Сообщение-событие: показываем карточку, сама карточка живёт в данных комнаты
  if (m.plain?.eventId) {
    const event = roomById(m.roomId)?.events?.find((e) => e.id === m.plain.eventId);
    box.append(event ? eventCard(event, m.roomId) : Object.assign(document.createElement('div'), {
      className: 'msg-locked',
      textContent: 'Событие удалено',
    }));
    return box;
  }
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
      card.append(audioPlayer(a));
      box.append(card);
    } else if (a.kind === 'file') {
      box.append(fileCard(a));
    }
  }
  // Ссылка в сообщении: плеер (YouTube, Vimeo, прямой видеофайл) или карточка превью
  const link = (m.preview && m.preview.url) || findLinks(m.text || '')[0] || null;
  if (link) {
    const video = videoCard(link, m.preview);
    if (video) box.append(video);
    else if (m.preview) box.append(linkCard(m.preview));
    else if (m.preview === null) box.append(bareLinkCard(link));
  } else if (m.preview) {
    box.append(linkCard(m.preview));
  }
  return box;
}

/** Плеер для ссылки на видео: YouTube, Vimeo, Instagram, TikTok, файл из og:video — иначе null */
function videoCard(link, preview) {
  const yt = youtubeId(link);
  if (yt) return youtubeCard(yt, { ...(preview || {}), url: link });
  const vimeo = vimeoId(link);
  if (vimeo) return vimeoCard(vimeo, { ...(preview || {}), url: link });
  const ig = instagramId(link);
  if (ig) {
    return socialCard({
      label: 'Instagram',
      title: preview?.title,
      thumb: preview?.image,
      embed: `https://www.instagram.com/${ig.type}/${ig.code}/embed/`,
      href: link,
      frameClass: 'frame-tall',
    });
  }
  const tt = tiktokId(link);
  if (tt) {
    return socialCard({
      label: 'TikTok',
      title: preview?.title,
      thumb: preview?.image,
      embed: `https://www.tiktok.com/embed/v2/${tt}`,
      href: link,
      frameClass: 'frame-tall',
    });
  }
  // Сайт сам отдал ссылку на видеофайл — играем его прямо в ленте
  if (preview?.video) return fileVideo(preview.video, preview.image);
  if (directVideo(link)) return fileVideo(link, preview?.image);
  return null;
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

/** id ролика Vimeo */
function vimeoId(url) {
  if (!url) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'vimeo.com' && host !== 'player.vimeo.com') return null;
  const m = /^(?:\/video)?\/(\d{6,})/.exec(u.pathname);
  return m ? m[1] : null;
}

/** Карточка с обложкой и кнопкой: по щелчку вместо неё встаёт встроенный плеер */
function socialCard({ label, title, thumb, embed, href, thumbClass = '', frameClass = '' }) {
  const card = document.createElement('div');
  card.className = 'link-card yt-card';
  const cover = document.createElement('button');
  cover.type = 'button';
  cover.className = `yt-thumb${thumbClass ? ` ${thumbClass}` : ''}`;
  if (thumb) cover.style.backgroundImage = `url("${thumb}")`;
  cover.title = 'Смотреть в чате';
  cover.innerHTML = '<span class="yt-play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>';
  const text = document.createElement('div');
  text.className = 'link-card-text';
  text.append(siteLine(label), titleLink(title || 'Смотреть видео', href));
  card.append(cover, text);
  cover.onclick = () => card.replaceChildren(embedFrame(embed, title || label, href, frameClass));
  return card;
}

/** Карточка YouTube: обложка с кнопкой, по щелчку — встроенный плеер */
function youtubeCard(id, p) {
  const href = p.url || `https://www.youtube.com/watch?v=${id}`;
  return socialCard({
    label: 'YouTube',
    title: p.title,
    thumb: p.image || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    embed: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`,
    href,
  });
}

/** Карточка Vimeo: кнопка, по щелчку — встроенный плеер */
function vimeoCard(id, p) {
  const href = p.url || `https://vimeo.com/${id}`;
  return socialCard({
    label: 'Vimeo',
    title: p.title,
    thumb: p.image,
    embed: `https://player.vimeo.com/video/${id}?autoplay=1`,
    href,
    thumbClass: 'vimeo-thumb',
  });
}

/** Ссылка на пост или рилс Instagram */
function instagramId(url) {
  if (!url) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname.toLowerCase().replace(/^www\./, '') !== 'instagram.com') return null;
  const m = /^\/(p|reel|reels|tv)\/([\w-]{5,})/.exec(u.pathname);
  return m ? { type: m[1] === 'reels' ? 'reel' : m[1], code: m[2] } : null;
}

/** Ссылка на видео TikTok */
function tiktokId(url) {
  if (!url) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, '');
  if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') return null; // короткие ссылки требуют переадресации
  if (host !== 'tiktok.com') return null;
  const m = /^\/(?:@[^/]+\/)?video\/(\d{6,})/.exec(u.pathname);
  return m ? m[1] : null;
}

/** Прямая ссылка на видеофайл — его можно проигрывать самим, без чужого плеера */
function directVideo(url) {
  try {
    return /\.(mp4|webm|ogv|ogg|m4v|mov|m3u8)$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** Сам видеофайл: играем в ленте, постер — картинка превью, если она есть */
function fileVideo(src, poster) {
  const video = document.createElement('video');
  video.className = 'video-card';
  video.controls = true;
  video.preload = 'metadata';
  if (poster) video.poster = poster;
  video.src = src;
  return video;
}

function siteLine(name) {
  const site = document.createElement('div');
  site.className = 'link-card-site small';
  site.textContent = name;
  return site;
}

function titleLink(text, href) {
  const a = document.createElement('a');
  a.className = 'link-card-title';
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = text;
  return a;
}

function embedFrame(src, title, href, frameClass = '') {
  const wrap = document.createElement('div');
  wrap.className = `embed-wrap${frameClass ? ` ${frameClass}` : ''}`;
  const frame = document.createElement('iframe');
  frame.className = 'yt-frame';
  frame.src = src;
  // Чужой странице нечего делать с нашим окном: только её собственный скрипт, полноэкранный
  // показ и всплывающие окна плеера — ничего из возможностей Electron
  frame.sandbox = 'allow-scripts allow-same-origin allow-presentation allow-popups allow-forms';
  frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen';
  frame.allowFullscreen = true;
  frame.title = title;
  // Если встроенный плеер не поднимется — останется ссылка «Открыть»
  const open = document.createElement('a');
  open.className = 'yt-open small';
  open.href = href;
  open.target = '_blank';
  open.rel = 'noopener noreferrer';
  open.textContent = 'Открыть на сайте';
  wrap.append(frame, open);
  return wrap;
}

/** Мини-карточка, когда сайт закрыт от ботов и превью не получить: домен и путь */
function bareLinkCard(url) {
  let host = url;
  let path = '';
  try {
    const u = new URL(url);
    host = u.hostname.replace(/^www\./, '');
    path = decodeURIComponent(u.pathname).replace(/[-_/]+/g, ' ').trim();
  } catch {}
  const card = document.createElement('div');
  card.className = 'link-card bare-card';
  const text = document.createElement('div');
  text.className = 'link-card-text';
  text.append(siteLine(host), titleLink(path || url, url));
  card.append(text);
  return card;
}

const AUDIO_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
const AUDIO_PAUSE = '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';

const clock = (seconds) => {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Свой плеер аудио: кнопка, полоса перемотки и время — в стиле приложения, без системных кнопок */
function audioPlayer(a) {
  const box = document.createElement('div');
  box.className = 'audio-player';
  const audio = document.createElement('audio');
  audio.preload = 'metadata';
  setFileSrc(audio, 'src', a);

  const row = document.createElement('div');
  row.className = 'audio-row';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'audio-btn';
  toggle.title = 'Слушать';
  toggle.innerHTML = AUDIO_PLAY;
  const seek = document.createElement('input');
  seek.type = 'range';
  seek.className = 'audio-seek';
  seek.min = '0';
  seek.max = '1000';
  seek.value = '0';
  seek.setAttribute('aria-label', 'Перемотка');
  const time = document.createElement('span');
  time.className = 'audio-time';
  time.textContent = '0:00 / 0:00';
  row.append(toggle, seek, time);
  box.append(audio, row);

  const refresh = () => {
    if (!seek.dataset.dragging) seek.value = String(audio.duration ? (audio.currentTime / audio.duration) * 1000 : 0);
    time.textContent = `${clock(audio.currentTime)} / ${clock(audio.duration)}`;
    toggle.innerHTML = audio.paused ? AUDIO_PLAY : AUDIO_PAUSE;
    toggle.title = audio.paused ? 'Слушать' : 'Пауза';
    seek.style.setProperty('--filled', `${seek.value / 10}%`);
  };
  audio.onloadedmetadata = refresh;
  audio.ontimeupdate = refresh;
  audio.onplay = () => {
    // Одновременно звучит только одно сообщение
    for (const other of document.querySelectorAll('audio')) if (other !== audio) other.pause();
    refresh();
  };
  audio.onpause = refresh;
  audio.onended = () => {
    audio.currentTime = 0;
    refresh();
  };
  toggle.onclick = () => (audio.paused ? audio.play().catch(() => {}) : audio.pause());
  seek.oninput = () => {
    seek.dataset.dragging = '1';
    seek.style.setProperty('--filled', `${seek.value / 10}%`);
    time.textContent = `${clock((seek.value / 1000) * audio.duration)} / ${clock(audio.duration)}`;
  };
  const commit = () => {
    delete seek.dataset.dragging;
    if (Number.isFinite(audio.duration)) audio.currentTime = (seek.value / 1000) * audio.duration;
    refresh();
  };
  seek.onchange = commit;
  seek.onpointerup = () => seek.dataset.dragging && commit();
  return box;
}

/** Иконки по типу файла: в карточке сразу видно, что это — музыка, видео, архив, документ */
const FILE_ICONS = {
  audio: '<svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>',
  video: '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="14" height="14" rx="2"/><path d="M16 10l6-3v10l-6-3z"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-6 6-3-3-4 4"/></svg>',
  archive: '<svg viewBox="0 0 24 24"><path d="M4 8h16v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M2 4h20v4H2zM10 12h4"/></svg>',
  pdf: '<svg viewBox="0 0 24 24"><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/><path d="M9 17v-4h1.5a1.5 1.5 0 0 1 0 3H9"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5M9 13h6M9 17h6"/></svg>',
  sheet: '<svg viewBox="0 0 24 24"><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5M8 12h8M8 16h8M11 12v8"/></svg>',
  slides: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8"/></svg>',
  code: '<svg viewBox="0 0 24 24"><path d="M8 6l-5 6 5 6M16 6l5 6-5 6"/></svg>',
  app: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/></svg>',
};

/** Тип файла: сначала по виду вложения, потом по расширению — на случай старых сообщений */
function fileType(a) {
  if (a.kind === 'audio' || a.kind === 'video' || a.kind === 'image') return a.kind;
  const ext = String(a.name || '').toLowerCase().split('.').pop();
  if (/^(mp3|wav|ogg|oga|flac|m4a|aac|opus|wma)$/.test(ext)) return 'audio';
  if (/^(mp4|webm|mkv|mov|avi|m4v|ogv)$/.test(ext)) return 'video';
  if (/^(png|jpe?g|gif|webp|bmp|svg|heic)$/.test(ext)) return 'image';
  if (/^(zip|rar|7z|tar|gz|bz2|xz)$/.test(ext)) return 'archive';
  if (ext === 'pdf') return 'pdf';
  if (/^(xls|xlsx|csv|ods|numbers)$/.test(ext)) return 'sheet';
  if (/^(doc|docx|rtf|odt|txt|md|pages)$/.test(ext)) return 'doc';
  if (/^(ppt|pptx|odp|key)$/.test(ext)) return 'slides';
  if (/^(js|ts|jsx|tsx|json|html|css|py|java|c|cpp|cs|go|rs|sh|yml|yaml|xml|sql)$/.test(ext)) return 'code';
  if (/^(exe|msi|apk|dmg|deb|appimage)$/.test(ext)) return 'app';
  return 'file';
}

function fileCard(a) {
  const card = document.createElement('div');
  card.className = 'file-card';
  const row = document.createElement('div');
  row.className = 'file-card-row';
  const type = fileType(a);
  const icon = document.createElement('span');
  icon.className = `file-card-icon type-${type}`;
  icon.innerHTML = FILE_ICONS[type] || FILE_ICONS.file;
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

// Скопировать открытую картинку — то же, что копирование из чата: в буфер идёт PNG
$('image-viewer-copy').onclick = (e) => {
  e.stopPropagation();
  const a = $('image-viewer-img').attachment;
  if (a) copyImage(a);
};

$('image-viewer').onclick = (e) => {
  if (e.target.closest('a')) return;
  closeImageViewer();
};

// ---------- Событие канала в чате ----------
// Карточка собирается из данных комнаты (room.events), поэтому готовность участников
// обновляется у всех сразу: «буду», «не смогу», «готов в другое время»

const EVENT_STATUS_LABEL = { yes: 'буду', no: 'не смогу', maybe: 'готов в другое время' };

function eventPersonName(room, userId) {
  const member = room?.members?.find((m) => m.id === userId);
  const user = userById(userId);
  return member?.nickname || member?.displayName || user?.displayName || user?.username || '?';
}

function eventCard(event, roomId) {
  const room = roomById(roomId);
  const card = document.createElement('div');
  card.className = 'event-card';
  card.dataset.eventId = event.id;
  card.dataset.roomId = roomId;

  const head = document.createElement('div');
  head.className = 'event-head';
  const badge = document.createElement('span');
  badge.className = 'event-badge';
  badge.textContent = 'Событие';
  const title = document.createElement('b');
  title.className = 'event-title';
  title.textContent = event.title;
  head.append(badge, title);

  const when = document.createElement('div');
  when.className = 'event-when';
  when.textContent = `${formatDay(event.startsAt)} · ${formatTime(event.startsAt)}`;
  card.append(head, when);

  const people = document.createElement('div');
  people.className = 'event-people';
  const answers = (event.responses || []).filter((r) => r.status !== 'invited');
  for (const r of answers) {
    const chip = document.createElement('span');
    chip.className = `event-chip ${r.status}`;
    const extra = r.status === 'maybe' && r.readyAt ? ` · в ${formatTime(r.readyAt)}` : '';
    chip.textContent = `${eventPersonName(room, r.userId)} — ${EVENT_STATUS_LABEL[r.status]}${extra}`;
    people.append(chip);
  }
  if (!answers.length) {
    people.className = 'event-people muted small';
    people.textContent = 'Пока никто не ответил';
  }
  card.append(people);

  const mine = (event.responses || []).find((r) => r.userId === state.me?.id);
  const answer = async (status, readyAt) => {
    try {
      const room = await Api.put(`/events/${event.id}/response`, { status, readyAt });
      applyRoomUpdate(room);
      refreshEventCards();
    } catch (err) {
      toast(err.message);
    }
  };
  const actions = document.createElement('div');
  actions.className = 'event-actions';
  const option = (label, status) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn small event-btn${mine?.status === status ? ' active' : ''}`;
    b.textContent = label;
    b.onclick = () => answer(status);
    return b;
  };
  actions.append(option('Буду', 'yes'), option('Не смогу', 'no'));

  // «Готов в 21:30»: своё время рядом с кнопкой
  const later = document.createElement('span');
  later.className = 'event-later';
  const time = document.createElement('input');
  time.type = 'time';
  time.className = 'event-time';
  if (mine?.status === 'maybe' && mine.readyAt) time.value = new Date(mine.readyAt).toTimeString().slice(0, 5);
  const laterBtn = document.createElement('button');
  laterBtn.type = 'button';
  laterBtn.className = `btn small event-btn${mine?.status === 'maybe' ? ' active' : ''}`;
  laterBtn.textContent = 'Готов в другое время';
  laterBtn.onclick = () => {
    if (!time.value) return toast('Укажите время');
    const [h, min] = time.value.split(':').map(Number);
    const at = new Date(event.startsAt);
    at.setHours(h, min, 0, 0);
    answer('maybe', at.getTime());
  };
  later.append(time, laterBtn);
  actions.append(later);
  card.append(actions);
  return card;
}

/** Обновить карточки событий на месте: ответы приходят и от других участников */
function refreshEventCards() {
  for (const card of document.querySelectorAll('.event-card')) {
    const roomId = Number(card.dataset.roomId);
    const eventId = Number(card.dataset.eventId);
    const event = roomById(roomId)?.events?.find((e) => e.id === eventId);
    const fresh = event
      ? eventCard(event, roomId)
      : Object.assign(document.createElement('div'), { className: 'msg-locked', textContent: 'Событие удалено' });
    card.replaceWith(fresh);
  }
}
