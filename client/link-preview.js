// Превью ссылки — в главном процессе приложения отправителя: переписка зашифрована, и сервер не должен
// знать, какими ссылками делятся. Страница грузится отсюда (без ограничений браузера на чужие сайты),
// а превью уходит внутри зашифрованного сообщения. Разбор страницы — тот же, что в server/src/link-preview.js
// (там он остался для сообщений старых версий): пакеты сервера и приложения раздельные, поэтому это копия.

const TIMEOUT_MS = 5000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;

/** Адрес, для которого можно делать превью: только http и https */
function previewableUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
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
      const resolved = new URL(unescape(rawImage), url);
      if (/^https?:$/.test(resolved.protocol)) image = resolved.toString();
    } catch {}
  }
  return {
    url,
    title,
    description: clean(meta['og:description'] || meta['twitter:description'] || meta.description, 300),
    image,
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

/** Превью страницы или null (ошибка сети, не HTML, нет заголовка) — тогда сообщение уйдёт без превью */
async function fetchPreview(value, fetchImpl = fetch) {
  const start = previewableUrl(value);
  if (!start) return null;
  let url = start;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
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
      if (res.status !== 200 || !/text\/html|application\/xhtml/i.test(res.headers.get('content-type') || '')) return null;
      return parsePreview(await readHtml(res), start.toString());
    }
  } catch {}
  return null;
}

module.exports = { parsePreview, previewableUrl, fetchPreview };
