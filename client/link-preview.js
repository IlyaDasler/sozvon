// Превью ссылки — в главном процессе приложения отправителя: переписка зашифрована, и сервер не должен
// знать, какими ссылками делятся. Страница грузится отсюда (без ограничений браузера на чужие сайты),
// а превью уходит внутри зашифрованного сообщения. Разбор страницы — тот же, что на сервере
// (там он остался для сообщений старых версий): пакеты сервера и приложения раздельные, поэтому это копия.

const TIMEOUT_MS = 5000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;

const dns = require('node:dns');
const net = require('node:net');

// Тесты поднимают сайт на 127.0.0.1 — им разрешаем, боевому приложению нет
const allowPrivate = () => process.env.LINK_PREVIEW_ALLOW_PRIVATE === '1';

function ipv4Private(ip) {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

/** IPv6, который нельзя запрашивать: mapped/compatible, ULA, link-local, multicast,
 *  Teredo/6to4/NAT64 и документационные диапазоны. */
function ipv6Blocked(host) {
  const lower = host.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  // ::/96 — IPv4-compatible и ::ffff:0:0/96 — IPv4-mapped: любые формы внутрь не пускаем
  if (lower.startsWith('::')) return true;
  if (/^(0:){5}ffff:/.test(lower) || /^(0:){6}[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(lower)) return true;
  if (/^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || /^ff/.test(lower)) return true;
  if (/^2001:0:/.test(lower) || /^2001:db8:/.test(lower) || /^2002:/.test(lower) || /^64:ff9b:/.test(lower)) return true;
  return false;
}

/** Публичный ли адрес: не localhost, не домашняя сеть, не служебные диапазоны */
function isPublicAddress(ip) {
  if (net.isIPv4(ip)) return !ipv4Private(ip);
  if (!net.isIPv6(ip)) return false;
  return !ipv6Blocked(ip);
}

/** Адрес, для которого можно делать превью: только http/https и только наружу */
function previewableUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return null;
    if (!allowPrivate()) {
      const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
      // Буквальный адрес проверяем сразу: имя вида localhost или 192.168.… внутрь не пускаем
      if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return null;
      if (net.isIP(host) && !isPublicAddress(host)) return null;
    }
    return url;
  } catch {
    return null;
  }
}

/** Имя может указывать на домашний адрес: смотрим, куда оно на самом деле ведёт */
async function hostIsPublic(url) {
  if (allowPrivate()) return true;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return isPublicAddress(host);
  const addresses = await dns.promises.lookup(host, { all: true }).catch(() => []);
  return addresses.length > 0 && addresses.every((a) => isPublicAddress(a.address));
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…' };
const unescape = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
const clean = (s, max) => {
  const text = unescape(String(s || '')).replace(/\s+/g, ' ').trim();
  return text ? (text.length > max ? `${text.slice(0, max - 1)}…` : text) : null;
};

function metaTags(html) {
  const meta = {};
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attr = (name) => (new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag) || [])
      .slice(2)
      .find((v) => v !== undefined);
    const key = (attr('property') || attr('name') || '').toLowerCase();
    const content = attr('content');
    if (key && content !== undefined && !(key in meta)) meta[key] = content;
  }
  return meta;
}

/** Превью из HTML страницы: { url, title, description, image, siteName } или null, если заголовка нет */
function parsePreview(html, url) {
  const meta = metaTags(html);
  const title = clean(meta['og:title'] || meta['twitter:title'] || (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1], 200);
  if (!title) return null;
  let image = null;
  const rawImage = meta['og:image'] || meta['og:image:url'] || meta['twitter:image'];
  if (rawImage) {
    try {
      // Некоторые сайты экранируют адрес дважды (&amp;amp;) — раскрываем до конца
      const resolved = new URL(unescape(unescape(rawImage)), url);
      if (/^https?:$/.test(resolved.protocol)) image = resolved.toString();
    } catch {}
  }
  // Ссылка на само видео: многие сайты отдают её в og:video — тогда в чате можно играть файл напрямую
  let video = null;
  const rawVideo = meta['og:video:secure_url'] || meta['og:video:url'] || meta['og:video'] || meta['twitter:player:stream'];
  if (rawVideo) {
    try {
      const resolved = new URL(unescape(rawVideo), url);
      if (/^https?:$/.test(resolved.protocol) && /\.(mp4|webm|ogv|m4v|mov|m3u8)(\?|#|$)/i.test(resolved.pathname)) video = resolved.toString();
    } catch {}
  }
  return {
    url,
    title,
    description: clean(meta['og:description'] || meta['twitter:description'] || meta.description, 300),
    image,
    video,
    siteName: clean(meta['og:site_name'], 80) || new URL(url).hostname.replace(/^www\./, ''),
  };
}

/** Читаем не больше MAX_BYTES и угадываем кодировку по заголовку или <meta charset> */
async function readHtml(res) {
  const chunks = [];
  let size = 0;
  const reader = res.body.getReader();
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  const body = Buffer.concat(chunks);
  const type = res.headers.get('content-type') || '';
  const charset = (/charset=["']?([\w-]+)/i.exec(type) || /<meta[^>]+charset=["']?([\w-]+)/i.exec(body.subarray(0, 2048).toString('latin1')) || [])[1];
  try {
    return new TextDecoder(charset || 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

/** YouTube не отдаёт обычную страницу для разбора: название и обложку берём у oEmbed */
async function youtubePreview(start, fetchImpl) {
  const host = start.hostname.toLowerCase().replace(/^www\.|^m\./, '');
  let id = null;
  if (host === 'youtu.be') id = start.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'music.youtube.com') {
    if (start.pathname === '/watch') id = start.searchParams.get('v');
    else id = (/^\/(?:shorts|embed|live|v)\/([\w-]{6,})/.exec(start.pathname) || [])[1] || null;
  }
  if (!id) return null;
  const res = await fetchImpl(`https://www.youtube.com/oembed?url=${encodeURIComponent(start.toString())}&format=json`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SozvonPreview/1.0)', Accept: 'application/json' },
  }).catch(() => null);
  const data = res?.ok ? await res.json().catch(() => null) : null;
  if (!data?.title) return null;
  return {
    url: start.toString(),
    title: data.title,
    description: data.author_name ? `Канал: ${data.author_name}` : null,
    image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    siteName: 'YouTube',
  };
}

/** Превью страницы или null (ошибка сети, не HTML, нет заголовка) — тогда сообщение уйдёт без превью */
async function fetchPreview(value, fetchImpl = fetch) {
  const start = previewableUrl(value);
  if (!start) return null;
  let url = start;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // Куда на самом деле ведёт имя, проверяем на каждом шаге: редирект тоже может увести внутрь
      if (!(await hostIsPublic(url))) return null;
      const res = await fetchImpl(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SozvonPreview/1.0)', Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'ru,en;q=0.8' },
      });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        url = previewableUrl(new URL(location, url).toString());
        if (!url) return null;
        continue;
      }
      if (res.status !== 200 || !/text\/html|application\/xhtml/i.test(res.headers.get('content-type') || '')) break;
      const parsed = parsePreview(await readHtml(res), start.toString());
      if (parsed) return parsed;
      break; // страница без заголовка (YouTube отдаёт заглушку) — пробуем oEmbed
    }
  } catch {}
  // Обычный разбор не вышел (YouTube отдаёт заглушку вместо страницы) — пробуем oEmbed
  return youtubePreview(start, fetchImpl).catch(() => null);
}

module.exports = { parsePreview, previewableUrl, fetchPreview };
