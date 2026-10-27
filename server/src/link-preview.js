// Предпросмотр ссылок: заголовок, описание и картинка страницы (Open Graph или обычный <title>).
// Страницу загружает сервер — тогда все видят одно и то же превью, а адрес получателя никуда не уходит.
// Сервер ходит только на публичные адреса: адрес проверяется в момент соединения (в lookup), поэтому
// ни ссылка на 127.0.0.1, ни подмена DNS не приведут во внутреннюю сеть VPS.
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const TIMEOUT_MS = 5000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const CACHE_MS = 60 * 60_000;
const CACHE_SIZE = 300;
// Только для тестов: разрешить адреса этого компьютера
const allowPrivate = process.env.LINK_PREVIEW_ALLOW_PRIVATE === '1';

// ---------- Какие адреса можно открывать ----------

function ipv4Private(ip) {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  );
}

/** Публичный ли адрес (не localhost, не локальная сеть, не служебные диапазоны) */
export function isPublicAddress(ip) {
  if (net.isIPv4(ip)) return !ipv4Private(ip);
  if (!net.isIPv6(ip)) return false;
  const low = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(low);
  if (mapped) return !ipv4Private(mapped[1]);
  return !(low === '::' || low === '::1' || /^f[cd]/.test(low) || /^fe[89ab]/.test(low) || low.startsWith('ff'));
}

const blocked = () => Object.assign(new Error('Адрес закрыт для предпросмотра'), { code: 'EBLOCKED' });

// Проверяем каждый адрес, к которому реально идёт соединение
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!allowPrivate && addresses.some((a) => !isPublicAddress(a.address))) return callback(blocked());
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

// ---------- Загрузка страницы ----------

function get(url) {
  return new Promise((resolve, reject) => {
    if (net.isIP(url.hostname.replace(/^\[|\]$/g, '')) && !allowPrivate && !isPublicAddress(url.hostname.replace(/^\[|\]$/g, '')))
      return reject(blocked());
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(
      url,
      {
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SozvonPreview/1.0)',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'ru,en;q=0.8',
        },
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          chunks.push(chunk);
          if (size >= MAX_BYTES) res.destroy();
        });
        res.on('close', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function decode(body, contentType) {
  const head = body.subarray(0, 2048).toString('latin1');
  const charset = (/charset=["']?([\w-]+)/i.exec(contentType || '') || /<meta[^>]+charset=["']?([\w-]+)/i.exec(head) || [])[1];
  try {
    return new TextDecoder(charset || 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

// ---------- Разбор страницы ----------

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
export function parsePreview(html, url) {
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

// ---------- Предпросмотр с переадресациями и кешем ----------

const cache = new Map(); // url -> { preview, at }

/** Адрес, для которого можно делать предпросмотр: только http и https */
export function previewableUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

async function load(start) {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await get(url);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      url = previewableUrl(new URL(res.headers.location, url).toString());
      if (!url) return null;
      continue;
    }
    if (res.status !== 200 || !/text\/html|application\/xhtml/i.test(res.headers['content-type'] || '')) return null;
    return parsePreview(decode(res.body, res.headers['content-type']), start.toString());
  }
  return null;
}

/** Превью страницы или null. Ошибки сети и закрытые адреса — тоже null: сообщение уйдёт без превью */
export async function fetchPreview(url) {
  const key = url.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.preview;
  const preview = await load(url).catch(() => null);
  cache.set(key, { preview, at: Date.now() });
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
  return preview;
}
