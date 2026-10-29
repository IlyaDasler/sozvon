// Размер трансляции своим захватом: монитор вписываем в рамку режима (1440p, 1080p…), пропорции те же,
// больше монитора не растягиваем; стороны чётные — так их требует кодировщик
function fitSize(monitor, max) {
  const scale = Math.min(1, max.width / monitor.width, max.height / monitor.height);
  const even = (v, limit) => Math.max(2, Math.min(Math.round((v * scale) / 2) * 2, limit - (limit % 2)));
  return { width: even(monitor.width, Math.max(max.width, monitor.width)), height: even(monitor.height, Math.max(max.height, monitor.height)) };
}

module.exports = { fitSize };
