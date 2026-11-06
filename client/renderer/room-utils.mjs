// Чистые помощники комнат. ES-модуль: их можно тестировать без DOM и app.js.
/**
 * @param {number} ms
 * @returns {string}
 */
export function formatVoiceTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const two = (n) => String(n).padStart(2, '0');
  const hours = Math.floor(total / 3600);
  const clock = `${two(Math.floor(total / 60) % 60)}:${two(total % 60)}`;
  return hours ? `${hours}:${clock}` : clock;
}

/**
 * @param {{groupId?: number|null}} a
 * @param {{groupId?: number|null}} b
 * @returns {boolean}
 */
export function sameRoomGroup(a, b) {
  return (a?.groupId || null) === (b?.groupId || null);
}

if (typeof window !== 'undefined') {
  window.RoomUtils = { formatVoiceTime, sameRoomGroup };
}
