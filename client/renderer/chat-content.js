// РЎРѕРґРµСЂР¶РёРјРѕРµ СЃРѕРѕР±С‰РµРЅРёСЏ: С‚РµРєСЃС‚ СЃ СЂР°Р·РјРµС‚РєРѕР№, РІР»РѕР¶РµРЅРёСЏ (РєР°СЂС‚РёРЅРєРё, РІРёРґРµРѕ, Р·РІСѓРє, С„Р°Р№Р»С‹) Рё РїСЂРµРІСЊСЋ СЃСЃС‹Р»РєРё.
// РћР±С‰РµРµ РґР»СЏ С‡Р°С‚Р° СЃ РґСЂСѓРіРѕРј Рё РєРѕРјРЅР°С‚С‹.

// РЎРѕРѕР±С‰РµРЅРёРµ С‚РѕР»СЊРєРѕ РёР· СЃРјР°Р№Р»РёРєРѕРІ (РґРѕ С‚СЂС‘С…) РїРѕРєР°Р·С‹РІР°РµС‚СЃСЏ РєСЂСѓРїРЅРѕ
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:вЂЌ\p{Extended_Pictographic}|[пёЏ\u{1f3fb}-\u{1f3ff}])*\s*){1,3}$/u;

const fileUrl = (a) => `${Api.base}${a.url}`;

/** РђРґСЂРµСЃ С„Р°Р№Р»Р° РІ СЌР»РµРјРµРЅС‚: РѕР±С‹С‡РЅС‹Р№ вЂ” СЃСЂР°Р·Сѓ, Р·Р°С€РёС„СЂРѕРІР°РЅРЅС‹Р№ вЂ” РєРѕРіРґР° СЂР°СЃС€РёС„СЂСѓРµС‚СЃСЏ */
function setFileSrc(el, prop, a) {
  if (!a.key) return void (el[prop] = fileUrl(a));
  decryptedFileUrl(a).then((url) => (el[prop] = url), () => el.classList.add('file-broken'));
}

/** Р§С‚Рѕ РїРѕРєР°Р·С‹РІР°С‚СЊ: Сѓ Р·Р°С€РёС„СЂРѕРІР°РЅРЅРѕРіРѕ СЃРѕРѕР±С‰РµРЅРёСЏ вЂ” СЂР°СЃС€РёС„СЂРѕРІР°РЅРЅС‹Рµ С‚РµРєСЃС‚, С„Р°Р№Р»С‹ (СЃ Р°РґСЂРµСЃР°РјРё СЃ СЃРµСЂРІРµСЂР°) Рё РїСЂРµРІСЊСЋ */
function messageView(m) {
  if (!m.enc) return m;
  if (!m.plain) return { ...m, text: '', attachments: [], preview: null };
  const stored = new Map((m.attachments || []).map((a) => [a.id, a]));
  const attachments = (m.plain.files || []).filter((f) => stored.has(f.id)).map((f) => ({ ...f, url: stored.get(f.id).url }));
  return { ...m, text: m.plain.text || '', attachments, preview: m.plain.preview || null };
}

// РџРѕС‡РµРјСѓ Р·Р°С€РёС„СЂРѕРІР°РЅРЅРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ РЅРµ РїРѕРєР°Р·Р°С‚СЊ
const LOCKED_REASONS = {
  'no-identity': 'рџ”’ РќРµ РїСЂРѕС‡РёС‚Р°С‚СЊ РЅР° СЌС‚РѕРј СѓСЃС‚СЂРѕР№СЃС‚РІРµ вЂ” РїРµСЂРµРЅРµСЃРёС‚Рµ СЃСЋРґР° РєР»СЋС‡ С€РёС„СЂРѕРІР°РЅРёСЏ (РќР°СЃС‚СЂРѕР№РєРё в†’ РђРєРєР°СѓРЅС‚)',
  'no-key': 'рџ”’ РќРµС‚ РєР»СЋС‡Р° Рє СЌС‚РѕРјСѓ СЃРѕРѕР±С‰РµРЅРёСЋ вЂ” РµРіРѕ РµС‰С‘ РЅРµ РїРµСЂРµРґР°Р»Рё СЌС‚РѕРјСѓ СѓСЃС‚СЂРѕР№СЃС‚РІСѓ',
  broken: 'рџ”’ РЎРѕРѕР±С‰РµРЅРёРµ РїРѕРІСЂРµР¶РґРµРЅРѕ вЂ” СЂР°СЃС€РёС„СЂРѕРІР°С‚СЊ РЅРµ РїРѕР»СѓС‡РёР»РѕСЃСЊ',
};

/** РљРѕСЂРѕС‚РєРѕ Рѕ СЃРѕРѕР±С‰РµРЅРёРё вЂ” РґР»СЏ СѓРІРµРґРѕРјР»РµРЅРёР№ */
function messageSummary(m) {
  if (m.enc && !m.plain) return 'рџ”’ Р—Р°С€РёС„СЂРѕРІР°РЅРЅРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ';
  m = messageView(m);
  if (m.text) return m.text;
  const n = m.attachments?.length || 0;
  const kinds = new Set((m.attachments || []).map((a) => a.kind));
  if (kinds.size === 1 && kinds.has('image')) return n > 1 ? `рџ–ј ${n} РєР°СЂС‚РёРЅРєРё` : 'рџ–ј РљР°СЂС‚РёРЅРєР°';
  if (kinds.size === 1 && kinds.has('video')) return 'рџЋ¬ Р’РёРґРµРѕ';
  if (kinds.size === 1 && kinds.has('audio')) return 'рџЋµ РђСѓРґРёРѕ';
  return n > 1 ? `рџ“Ћ ${n} ${plural(n, 'С„Р°Р№Р»', 'С„Р°Р№Р»Р°', 'С„Р°Р№Р»РѕРІ')}` : `рџ“Ћ ${m.attachments?.[0]?.name || 'Р¤Р°Р№Р»'}`;
}

const HUB_EMOJI_RE = /:([a-zР°-СЏС‘0-9_]{2,24}):/gi;

/** :РёРјСЏ: РІ С‚РµРєСЃС‚Рµ СЃРѕРѕР±С‰РµРЅРёСЏ в†’ РєР°СЂС‚РёРЅРєР° СЃРјР°Р№Р»РёРєР° РєР°РЅР°Р»Р°; РІ РєРѕРґРµ Рё СЃСЃС‹Р»РєР°С… С‚РµРєСЃС‚ РѕСЃС‚Р°С‘С‚СЃСЏ РєР°Рє РµСЃС‚СЊ */
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
    locked.textContent = LOCKED_REASONS[m.locked] || 'Р Р°СЃС€РёС„СЂРѕРІРєР°вЂ¦';
    box.append(locked);
    return box;
  }
  m = messageView(m);
  // РЎРѕРѕР±С‰РµРЅРёРµ-СЃРѕР±С‹С‚РёРµ: РїРѕРєР°Р·С‹РІР°РµРј РєР°СЂС‚РѕС‡РєСѓ, СЃР°РјР° РєР°СЂС‚РѕС‡РєР° Р¶РёРІС‘С‚ РІ РґР°РЅРЅС‹С… РєРѕРјРЅР°С‚С‹
  if (m.plain?.eventId) {
    const event = roomById(m.roomId)?.events?.find((e) => e.id === m.plain.eventId);
    box.append(event ? eventCard(event, m.roomId) : Object.assign(document.createElement('div'), {
      className: 'msg-locked',
      textContent: 'РЎРѕР±С‹С‚РёРµ СѓРґР°Р»РµРЅРѕ',
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
      img.title = `${a.name} вЂ” РЅР°Р¶РјРёС‚Рµ, С‡С‚РѕР±С‹ РѕС‚РєСЂС‹С‚СЊ`;
      img.onclick = () => openImageViewer(a);
      // Р“РёС„РєСѓ РјРѕР¶РЅРѕ СЃРѕС…СЂР°РЅРёС‚СЊ СЃРµР±Рµ РІ В«РњРѕРё РіРёС„РєРёВ»
      if (/gif|webp/.test(a.mime || a.name || '')) {
        const cell = document.createElement('div');
        cell.className = 'gif-cell';
        const save = Object.assign(document.createElement('button'), { type: 'button', className: 'gif-save', title: 'Р’ РјРѕРё РіРёС„РєРё' });
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
  // РЎСЃС‹Р»РєР° РІ СЃРѕРѕР±С‰РµРЅРёРё: РїР»РµРµСЂ (YouTube, Vimeo, РїСЂСЏРјРѕР№ РІРёРґРµРѕС„Р°Р№Р») РёР»Рё РєР°СЂС‚РѕС‡РєР° РїСЂРµРІСЊСЋ
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

/** РџР»РµРµСЂ РґР»СЏ СЃСЃС‹Р»РєРё РЅР° РІРёРґРµРѕ: YouTube, Vimeo, Instagram, TikTok, С„Р°Р№Р» РёР· og:video вЂ” РёРЅР°С‡Рµ null */
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
  // РЎР°Р№С‚ СЃР°Рј РѕС‚РґР°Р» СЃСЃС‹Р»РєСѓ РЅР° РІРёРґРµРѕС„Р°Р№Р» вЂ” РёРіСЂР°РµРј РµРіРѕ РїСЂСЏРјРѕ РІ Р»РµРЅС‚Рµ
  if (preview?.video) return fileVideo(preview.video, preview.image);
  if (directVideo(link)) return fileVideo(link, preview?.image);
  return null;
}

/** id СЂРѕР»РёРєР° YouTube РёР· СЃСЃС‹Р»РєРё (watch, youtu.be, shorts, embed, live) */
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

/** id СЂРѕР»РёРєР° Vimeo */
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

/** РљР°СЂС‚РѕС‡РєР° СЃ РѕР±Р»РѕР¶РєРѕР№ Рё РєРЅРѕРїРєРѕР№: РїРѕ С‰РµР»С‡РєСѓ РІРјРµСЃС‚Рѕ РЅРµС‘ РІСЃС‚Р°С‘С‚ РІСЃС‚СЂРѕРµРЅРЅС‹Р№ РїР»РµРµСЂ */
function socialCard({ label, title, thumb, embed, href, thumbClass = '', frameClass = '' }) {
  const card = document.createElement('div');
  card.className = 'link-card yt-card';
  const cover = document.createElement('button');
  cover.type = 'button';
  cover.className = `yt-thumb${thumbClass ? ` ${thumbClass}` : ''}`;
  if (thumb) cover.style.backgroundImage = `url("${thumb}")`;
  cover.title = 'РЎРјРѕС‚СЂРµС‚СЊ РІ С‡Р°С‚Рµ';
  cover.innerHTML = '<span class="yt-play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>';
  const text = document.createElement('div');
  text.className = 'link-card-text';
  text.append(siteLine(label), titleLink(title || 'РЎРјРѕС‚СЂРµС‚СЊ РІРёРґРµРѕ', href));
  card.append(cover, text);
  cover.onclick = () => card.replaceChildren(embedFrame(embed, title || label, href, frameClass));
  return card;
}

/** РљР°СЂС‚РѕС‡РєР° YouTube: РѕР±Р»РѕР¶РєР° СЃ РєРЅРѕРїРєРѕР№, РїРѕ С‰РµР»С‡РєСѓ вЂ” РІСЃС‚СЂРѕРµРЅРЅС‹Р№ РїР»РµРµСЂ */
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

/** РљР°СЂС‚РѕС‡РєР° Vimeo: РєРЅРѕРїРєР°, РїРѕ С‰РµР»С‡РєСѓ вЂ” РІСЃС‚СЂРѕРµРЅРЅС‹Р№ РїР»РµРµСЂ */
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

/** РЎСЃС‹Р»РєР° РЅР° РїРѕСЃС‚ РёР»Рё СЂРёР»СЃ Instagram */
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

/** РЎСЃС‹Р»РєР° РЅР° РІРёРґРµРѕ TikTok */
function tiktokId(url) {
  if (!url) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, '');
  if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') return null; // РєРѕСЂРѕС‚РєРёРµ СЃСЃС‹Р»РєРё С‚СЂРµР±СѓСЋС‚ РїРµСЂРµР°РґСЂРµСЃР°С†РёРё
  if (host !== 'tiktok.com') return null;
  const m = /^\/(?:@[^/]+\/)?video\/(\d{6,})/.exec(u.pathname);
  return m ? m[1] : null;
}

/** РџСЂСЏРјР°СЏ СЃСЃС‹Р»РєР° РЅР° РІРёРґРµРѕС„Р°Р№Р» вЂ” РµРіРѕ РјРѕР¶РЅРѕ РїСЂРѕРёРіСЂС‹РІР°С‚СЊ СЃР°РјРёРј, Р±РµР· С‡СѓР¶РѕРіРѕ РїР»РµРµСЂР° */
function directVideo(url) {
  try {
    return /\.(mp4|webm|ogv|ogg|m4v|mov|m3u8)$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** РЎР°Рј РІРёРґРµРѕС„Р°Р№Р»: РёРіСЂР°РµРј РІ Р»РµРЅС‚Рµ, РїРѕСЃС‚РµСЂ вЂ” РєР°СЂС‚РёРЅРєР° РїСЂРµРІСЊСЋ, РµСЃР»Рё РѕРЅР° РµСЃС‚СЊ */
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
  // Р§СѓР¶РѕР№ СЃС‚СЂР°РЅРёС†Рµ РЅРµС‡РµРіРѕ РґРµР»Р°С‚СЊ СЃ РЅР°С€РёРј РѕРєРЅРѕРј: С‚РѕР»СЊРєРѕ РµС‘ СЃРѕР±СЃС‚РІРµРЅРЅС‹Р№ СЃРєСЂРёРїС‚, РїРѕР»РЅРѕСЌРєСЂР°РЅРЅС‹Р№
  // РїРѕРєР°Р· Рё РІСЃРїР»С‹РІР°СЋС‰РёРµ РѕРєРЅР° РїР»РµРµСЂР° вЂ” РЅРёС‡РµРіРѕ РёР· РІРѕР·РјРѕР¶РЅРѕСЃС‚РµР№ Electron
  frame.sandbox = 'allow-scripts allow-same-origin allow-presentation allow-popups allow-forms';
  frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen';
  frame.allowFullscreen = true;
  frame.title = title;
  // Р•СЃР»Рё РІСЃС‚СЂРѕРµРЅРЅС‹Р№ РїР»РµРµСЂ РЅРµ РїРѕРґРЅРёРјРµС‚СЃСЏ вЂ” РѕСЃС‚Р°РЅРµС‚СЃСЏ СЃСЃС‹Р»РєР° В«РћС‚РєСЂС‹С‚СЊВ»
  const open = document.createElement('a');
  open.className = 'yt-open small';
  open.href = href;
  open.target = '_blank';
  open.rel = 'noopener noreferrer';
  open.textContent = 'РћС‚РєСЂС‹С‚СЊ РЅР° СЃР°Р№С‚Рµ';
  wrap.append(frame, open);
  return wrap;
}

/** РњРёРЅРё-РєР°СЂС‚РѕС‡РєР°, РєРѕРіРґР° СЃР°Р№С‚ Р·Р°РєСЂС‹С‚ РѕС‚ Р±РѕС‚РѕРІ Рё РїСЂРµРІСЊСЋ РЅРµ РїРѕР»СѓС‡РёС‚СЊ: РґРѕРјРµРЅ Рё РїСѓС‚СЊ */
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

/** РЎРІРѕР№ РїР»РµРµСЂ Р°СѓРґРёРѕ: РєРЅРѕРїРєР°, РїРѕР»РѕСЃР° РїРµСЂРµРјРѕС‚РєРё Рё РІСЂРµРјСЏ вЂ” РІ СЃС‚РёР»Рµ РїСЂРёР»РѕР¶РµРЅРёСЏ, Р±РµР· СЃРёСЃС‚РµРјРЅС‹С… РєРЅРѕРїРѕРє */
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
  toggle.title = 'РЎР»СѓС€Р°С‚СЊ';
  toggle.innerHTML = AUDIO_PLAY;
  const seek = document.createElement('input');
  seek.type = 'range';
  seek.className = 'audio-seek';
  seek.min = '0';
  seek.max = '1000';
  seek.value = '0';
  seek.setAttribute('aria-label', 'РџРµСЂРµРјРѕС‚РєР°');
  const time = document.createElement('span');
  time.className = 'audio-time';
  time.textContent = '0:00 / 0:00';
  row.append(toggle, seek, time);
  box.append(audio, row);

  const refresh = () => {
    if (!seek.dataset.dragging) seek.value = String(audio.duration ? (audio.currentTime / audio.duration) * 1000 : 0);
    time.textContent = `${clock(audio.currentTime)} / ${clock(audio.duration)}`;
    toggle.innerHTML = audio.paused ? AUDIO_PLAY : AUDIO_PAUSE;
    toggle.title = audio.paused ? 'РЎР»СѓС€Р°С‚СЊ' : 'РџР°СѓР·Р°';
    seek.style.setProperty('--filled', `${seek.value / 10}%`);
  };
  audio.onloadedmetadata = refresh;
  audio.ontimeupdate = refresh;
  audio.onplay = () => {
    // РћРґРЅРѕРІСЂРµРјРµРЅРЅРѕ Р·РІСѓС‡РёС‚ С‚РѕР»СЊРєРѕ РѕРґРЅРѕ СЃРѕРѕР±С‰РµРЅРёРµ
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

/** РРєРѕРЅРєРё РїРѕ С‚РёРїСѓ С„Р°Р№Р»Р°: РІ РєР°СЂС‚РѕС‡РєРµ СЃСЂР°Р·Сѓ РІРёРґРЅРѕ, С‡С‚Рѕ СЌС‚Рѕ вЂ” РјСѓР·С‹РєР°, РІРёРґРµРѕ, Р°СЂС…РёРІ, РґРѕРєСѓРјРµРЅС‚ */
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

/** РўРёРї С„Р°Р№Р»Р°: СЃРЅР°С‡Р°Р»Р° РїРѕ РІРёРґСѓ РІР»РѕР¶РµРЅРёСЏ, РїРѕС‚РѕРј РїРѕ СЂР°СЃС€РёСЂРµРЅРёСЋ вЂ” РЅР° СЃР»СѓС‡Р°Р№ СЃС‚Р°СЂС‹С… СЃРѕРѕР±С‰РµРЅРёР№ */
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
  name.title = 'РЎРєР°С‡Р°С‚СЊ';
  const size = document.createElement('span');
  size.className = 'muted small';
  size.textContent = formatSize(a.size);
  info.append(name, size);
  const download = document.createElement('a');
  download.className = 'icon-btn';
  setFileSrc(download, 'href', a);
  download.download = a.name;
  download.title = 'РЎРєР°С‡Р°С‚СЊ';
  download.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>';
  row.append(icon, info, download);
  card.append(row);
  return card;
}

/** РљР°СЂС‚РѕС‡РєР° РїСЂРµРІСЊСЋ СЃСЃС‹Р»РєРё: СЃР°Р№С‚, Р·Р°РіРѕР»РѕРІРѕРє-СЃСЃС‹Р»РєР°, РѕРїРёСЃР°РЅРёРµ Рё РєР°СЂС‚РёРЅРєР° */
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

// ---------- РљР°СЂС‚РёРЅРєР°: СЃРєРѕРїРёСЂРѕРІР°С‚СЊ Рё СЃРєР°С‡Р°С‚СЊ ----------

/** РЎР°РјР° РєР°СЂС‚РёРЅРєР°: Р·Р°С€РёС„СЂРѕРІР°РЅРЅСѓСЋ РѕС‚РґР°С‘С‚ СЂР°СЃС€РёС„СЂРѕРІРєР°, СЃСЃС‹Р»РєР° РЅР° СЃРµСЂРІРµСЂ РґР°Р»Р° Р±С‹ С‚РѕР»СЊРєРѕ С€РёС„СЂ */
async function imageBlob(a) {
  const res = await fetch(a.key ? await decryptedFileUrl(a) : fileUrl(a));
  if (!res.ok) throw new Error('Р¤Р°Р№Р» РЅРµ РЅР°Р№РґРµРЅ');
  return res.blob();
}

/** Р’ Р±СѓС„РµСЂ вЂ” PNG: РґСЂСѓРіРѕР№ С„РѕСЂРјР°С‚ РїСЂРѕРіСЂР°РјРјС‹ РЅРµ РІСЃС‚Р°РІСЏС‚. Р“РёС„РєР° РєРѕРїРёСЂСѓРµС‚СЃСЏ РїРµСЂРІС‹Рј РєР°РґСЂРѕРј */
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
    toast('РљР°СЂС‚РёРЅРєР° СЃРєРѕРїРёСЂРѕРІР°РЅР°', 1500);
  } catch {
    toast('РќРµ СѓРґР°Р»РѕСЃСЊ СЃРєРѕРїРёСЂРѕРІР°С‚СЊ РєР°СЂС‚РёРЅРєСѓ');
  }
}

async function downloadImage(a) {
  try {
    const url = URL.createObjectURL(await imageBlob(a));
    Object.assign(document.createElement('a'), { href: url, download: a.name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    toast('РќРµ СѓРґР°Р»РѕСЃСЊ СЃРєР°С‡Р°С‚СЊ РєР°СЂС‚РёРЅРєСѓ');
  }
}

// ---------- РџСЂРѕСЃРјРѕС‚СЂ РєР°СЂС‚РёРЅРєРё ----------

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

// РЎРєРѕРїРёСЂРѕРІР°С‚СЊ РѕС‚РєСЂС‹С‚СѓСЋ РєР°СЂС‚РёРЅРєСѓ вЂ” С‚Рѕ Р¶Рµ, С‡С‚Рѕ РєРѕРїРёСЂРѕРІР°РЅРёРµ РёР· С‡Р°С‚Р°: РІ Р±СѓС„РµСЂ РёРґС‘С‚ PNG
$('image-viewer-copy').onclick = (e) => {
  e.stopPropagation();
  const a = $('image-viewer-img').attachment;
  if (a) copyImage(a);
};

$('image-viewer').onclick = (e) => {
  if (e.target.closest('a')) return;
  closeImageViewer();
};

// ---------- РЎРѕР±С‹С‚РёРµ РєР°РЅР°Р»Р° РІ С‡Р°С‚Рµ ----------
// РљР°СЂС‚РѕС‡РєР° СЃРѕР±РёСЂР°РµС‚СЃСЏ РёР· РґР°РЅРЅС‹С… РєРѕРјРЅР°С‚С‹ (room.events), РїРѕСЌС‚РѕРјСѓ РіРѕС‚РѕРІРЅРѕСЃС‚СЊ СѓС‡Р°СЃС‚РЅРёРєРѕРІ
// РѕР±РЅРѕРІР»СЏРµС‚СЃСЏ Сѓ РІСЃРµС… СЃСЂР°Р·Сѓ: В«Р±СѓРґСѓВ», В«РЅРµ СЃРјРѕРіСѓВ», В«РіРѕС‚РѕРІ РІ РґСЂСѓРіРѕРµ РІСЂРµРјСЏВ»

const EVENT_STATUS_LABEL = { yes: 'Р±СѓРґСѓ', no: 'РЅРµ СЃРјРѕРіСѓ', maybe: 'РіРѕС‚РѕРІ РІ РґСЂСѓРіРѕРµ РІСЂРµРјСЏ' };

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
  badge.textContent = 'РЎРѕР±С‹С‚РёРµ';
  const title = document.createElement('b');
  title.className = 'event-title';
  title.textContent = event.title;
  head.append(badge, title);

  const when = document.createElement('div');
  when.className = 'event-when';
  when.textContent = `${formatDay(event.startsAt)} В· ${formatTime(event.startsAt)}`;
  card.append(head, when);

  // РџРѕРІС‚РѕСЂ Рё РЅР°РїРѕРјРёРЅР°РЅРёРµ
  const REPEAT_LABEL = { daily: 'РљР°Р¶РґС‹Р№ РґРµРЅСЊ', weekdays: 'РџРѕ Р±СѓРґРЅСЏРј', weekly: 'РљР°Р¶РґСѓСЋ РЅРµРґРµР»СЋ' };
  if (event.repeat && event.repeat !== 'none') {
    const repeat = document.createElement('div');
    repeat.className = 'event-repeat';
    const remind = event.remind ? ` В· РЅР°РїРѕРјРЅРёРј Р·Р° ${event.remind} РјРёРЅ` : '';
    repeat.textContent = `${REPEAT_LABEL[event.repeat] || ''}${remind}`;
    card.append(repeat);
  } else if (event.remind) {
    const repeat = document.createElement('div');
    repeat.className = 'event-repeat';
    repeat.textContent = `РќР°РїРѕРјРЅРёРј Р·Р° ${event.remind} РјРёРЅ`;
    card.append(repeat);
  }

  // РџСЂРѕС€РµРґС€РµРµ СЃРѕР±С‹С‚РёРµ: Р±РѕР»СЊС€Рµ РЅРµ РѕС‚РІРµС‡Р°РµРј
  if (event.completed) {
    const done = document.createElement('div');
    done.className = 'event-done';
    done.textContent = 'РЎРѕР±С‹С‚РёРµ Р·Р°РІРµСЂС€РµРЅРѕ';
    card.classList.add('completed');
    card.append(done);
    return card;
  }

  const people = document.createElement('div');
  people.className = 'event-people';
  const answers = (event.responses || []).filter((r) => r.status !== 'invited');
  for (const r of answers) {
    const chip = document.createElement('span');
    chip.className = `event-chip ${r.status}`;
    const extra = r.status === 'maybe' && r.readyAt ? ` В· РІ ${formatTime(r.readyAt)}` : '';
    chip.textContent = `${eventPersonName(room, r.userId)} - ${EVENT_STATUS_LABEL[r.status]}${extra}`;
    people.append(chip);
  }
  if (!answers.length) {
    people.className = 'event-people muted small';
    people.textContent = 'РџРѕРєР° РЅРёРєС‚Рѕ РЅРµ РѕС‚РІРµС‚РёР»';
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
  actions.append(option('Р‘СѓРґСѓ', 'yes'), option('РќРµ СЃРјРѕРіСѓ', 'no'));

  // В«Р“РѕС‚РѕРІ РІ РґСЂСѓРіРѕРµ РІСЂРµРјСЏВ»: СЃРІРѕС‘ РѕРєРЅРѕ РІС‹Р±РѕСЂР° РІСЂРµРјРµРЅРё РІ СЃС‚РёР»Рµ РїСЂРёР»РѕР¶РµРЅРёСЏ
  const readyDate = mine?.status === 'maybe' && mine.readyAt ? new Date(mine.readyAt) : new Date(event.startsAt);
  const draft = { h: readyDate.getHours(), m: Math.floor(readyDate.getMinutes() / 5) * 5 };

  const later = document.createElement('div');
  later.className = 'event-later';
  const wrap = document.createElement('div');
  wrap.className = 'event-time-wrap';
  const laterBtn = document.createElement('button');
  laterBtn.type = 'button';
  laterBtn.className = `btn small event-btn${mine?.status === 'maybe' ? ' active' : ''}`;
  const syncLater = () => {
    const hasTime = mine?.status === 'maybe' && mine.readyAt;
    laterBtn.textContent = hasTime ? `Р“РѕС‚РѕРІ РІ ${pad2(draft.h)}:${pad2(draft.m)}` : 'Р“РѕС‚РѕРІ РІ РґСЂСѓРіРѕРµ РІСЂРµРјСЏ';
  };
  syncLater();
  const pop = document.createElement('div');
  pop.className = 'event-time-pop hidden';

  const drawPop = () => {
    const body = document.createElement('div');
    body.className = 'time-drum-body';
    buildTimeDrum(body, `${pad2(draft.h)}:${pad2(draft.m)}`, (h, m) => {
      draft.h = h;
      draft.m = m;
      syncLater();
    });
    const foot = document.createElement('div');
    foot.className = 'time-foot';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'btn small primary';
    ok.textContent = 'ОК';
    ok.onclick = () => {
      const at = new Date(event.startsAt);
      at.setHours(draft.h, draft.m, 0, 0);
      pop.classList.add('hidden');
      answer('maybe', at.getTime());
    };
    foot.append(ok);
    pop.replaceChildren(body, foot);
  };

  laterBtn.onclick = (e) => {
    e.stopPropagation();
    const opening = pop.classList.contains('hidden');
    drawPop();
    pop.classList.toggle('hidden', !opening);
  };
  wrap.append(laterBtn, pop);
  later.append(wrap);
  actions.append(later);
  card.append(actions);
  return card;
}

/** РћР±РЅРѕРІРёС‚СЊ РєР°СЂС‚РѕС‡РєРё СЃРѕР±С‹С‚РёР№ РЅР° РјРµСЃС‚Рµ: РѕС‚РІРµС‚С‹ РїСЂРёС…РѕРґСЏС‚ Рё РѕС‚ РґСЂСѓРіРёС… СѓС‡Р°СЃС‚РЅРёРєРѕРІ */
function refreshEventCards() {
  for (const card of document.querySelectorAll('.event-card')) {
    const roomId = Number(card.dataset.roomId);
    const eventId = Number(card.dataset.eventId);
    const event = roomById(roomId)?.events?.find((e) => e.id === eventId);
    const fresh = event
      ? eventCard(event, roomId)
      : Object.assign(document.createElement('div'), { className: 'msg-locked', textContent: 'РЎРѕР±С‹С‚РёРµ СѓРґР°Р»РµРЅРѕ' });
    card.replaceWith(fresh);
  }
}
