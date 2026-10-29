// Когда проверять обновления: чтобы новая версия была видна сама, без кнопки «Проверить обновления».
// Созвон неделями живёт в трее — поэтому таймер, возврат в окно и пробуждение компьютера
const UPDATE_EVERY_MS = 10 * 60 * 1000;
const FOCUS_AFTER_MS = 2 * 60 * 1000; // вернулись в окно — проверяем, если давно не проверяли

/** reason: 'timer' | 'focus' | 'resume'; lastAt — когда проверяли в последний раз */
function checkDue(reason, lastAt, now) {
  if (reason === 'focus') return now - lastAt > FOCUS_AFTER_MS;
  return true;
}

module.exports = { UPDATE_EVERY_MS, checkDue };
