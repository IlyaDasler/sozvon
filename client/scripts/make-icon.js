// Рисует иконку приложения (build/icon.png, 512×512) без сторонних библиотек.
// Та же картинка, что и logo.svg: наушники на зелёном фоне.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SIZE = 512;
const S = SIZE / 64; // масштаб относительно logo.svg (viewBox 64×64)

const clamp = (v) => Math.max(0, Math.min(1, v));

function roundedRect(px, py, x, y, w, h, r) {
  const qx = Math.abs(px - (x + w / 2)) - w / 2 + r;
  const qy = Math.abs(py - (y + h / 2)) - h / 2 + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// Дуга оголовья: окружность радиуса 18 с центром (32, 32), только верхняя половина, концы скруглены
function band(px, py) {
  const cx = 32 * S, cy = 32 * S, R = 18 * S, half = 2.25 * S;
  if (py <= cy) return Math.abs(Math.hypot(px - cx, py - cy) - R) - half;
  const left = Math.hypot(px - (cx - R), py - Math.min(py, 37 * S));
  const right = Math.hypot(px - (cx + R), py - Math.min(py, 37 * S));
  return Math.min(left, right) - half;
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  for (let x = 0; x < SIZE; x++) {
    const px = x + 0.5, py = y + 0.5;
    const t = y / SIZE;
    const bg = [0x3d + (0x1b - 0x3d) * t, 0xdc + (0x9e - 0xdc) * t, 0x97 + (0x77 - 0x97) * t];
    const bgAlpha = clamp(0.5 - roundedRect(px, py, 0, 0, SIZE, SIZE, 14 * S));
    const white = clamp(
      0.5 -
        Math.min(
          band(px, py),
          roundedRect(px, py, 10 * S, 33 * S, 10 * S, 16 * S, 4 * S),
          roundedRect(px, py, 44 * S, 33 * S, 10 * S, 16 * S, 4 * S)
        )
    );
    const o = y * (SIZE * 4 + 1) + 1 + x * 4;
    for (let c = 0; c < 3; c++) raw[o + c] = Math.round(bg[c] * (1 - white) + 255 * white);
    raw[o + 3] = Math.round(255 * bgAlpha);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // бит на канал
ihdr[9] = 6; // RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`Иконка сохранена: ${out}`);
