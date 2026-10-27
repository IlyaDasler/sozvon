// Вложения в чате. Файл загружается отдельно и лежит на диске под случайным именем; сообщение ссылается
// на него по id. Ссылка на файл — длинная случайная строка, как у аватарок (тег img не умеет передавать токен).
// Показывать прямо в чате можно только картинки, видео и звук известных форматов. Всё остальное — в том
// числе HTML и SVG — отдаём как «скачать файл», чтобы файл не выполнился как страница.

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;
export const FILE_ID_RE = /^[a-f0-9]{32}$/;

const INLINE_TYPES = {
  image: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp'],
  video: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'],
  audio: ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/flac', 'audio/x-m4a'],
};

/** Как показывать файл: image, video, audio или file (только скачать) */
export function kindOf(mime) {
  for (const [kind, types] of Object.entries(INLINE_TYPES)) if (types.includes(mime)) return kind;
  return 'file';
}

/** Тип из заголовка запроса: только «тип/подтип», без параметров; непонятное — просто двоичные данные */
export function cleanMime(header) {
  const mime = String(header || '').split(';')[0].trim().toLowerCase();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime) ? mime : 'application/octet-stream';
}

/** Имя файла без путей и управляющих символов, не длиннее 120 символов */
export function cleanName(name) {
  const base = String(name || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"]/g, '').trim();
  return (base || 'файл').slice(0, 120);
}

/** Описание вложения в сообщении и адрес, по которому его скачать */
export const toAttachment = (row) => ({
  id: row.id,
  name: row.name,
  mime: row.mime,
  size: row.size,
  kind: row.kind,
  url: `/api/files/${row.id}/${encodeURIComponent(row.name)}`,
});

/** Заголовки ответа: показать в чате или только скачать */
export function fileHeaders(row) {
  const inline = row.kind !== 'file';
  const encoded = encodeURIComponent(row.name);
  return {
    'Content-Type': inline ? row.mime : 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encoded}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, max-age=31536000, immutable',
  };
}
