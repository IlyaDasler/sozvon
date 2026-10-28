// Код шифрования звонка. Звук и видео идут напрямую между участниками и шифруются ключами, которые
// создаются на их компьютерах (DTLS-SRTP); сервер ключей не знает. Код — отпечаток всех ключей звонка:
// у каждого участника он одинаковый, а если кто-то посередине подменил ключ, коды у людей разойдутся.
// Сверить код вслух или в чате — и можно быть уверенным, что разговор слышат только свои.

// 64 непохожих друг на друга смайлика: по шесть бит на каждый
const CODE_EMOJI = [
  '🐶', '🐱', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🦉', '🦄',
  '🐝', '🦋', '🐢', '🐙', '🦀', '🐬', '🐳', '🦈', '🌵', '🌲', '🍀', '🌻', '🌹', '🍄', '🌙', '⭐',
  '🔥', '🌈', '❄️', '⚡', '🍎', '🍋', '🍉', '🍇', '🍓', '🍒', '🥕', '🌽', '🍕', '🍩', '🎂', '☕',
  '⚽', '🏀', '🎸', '🎲', '🎯', '🚀', '🚗', '⛵', '🎈', '🎁', '🔑', '💎', '🔔', '📷', '🧭', '⏰',
];

/** Отпечаток ключа из описания соединения (SDP): строка a=fingerprint */
function fingerprintOf(sdp) {
  const m = /^a=fingerprint:\S+ ([0-9A-Fa-f:]+)\s*$/m.exec(sdp || '');
  return m ? m[1].toUpperCase() : null;
}

/** Код по всем ключам звонка: четыре смайлика и восемь цифр. Порядок и повторы не важны */
async function securityCode(fingerprints) {
  const unique = [...new Set(fingerprints.filter(Boolean).map((f) => f.toUpperCase()))].sort();
  if (unique.length < 2) return null;
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(unique.join('|'))));
  const emoji = [0, 1, 2, 3].map((i) => CODE_EMOJI[hash[i] & 63]);
  const num = ((hash[4] << 24) | (hash[5] << 16) | (hash[6] << 8) | hash[7]) >>> 0;
  const digits = String(num % 100_000_000).padStart(8, '0');
  return { emoji, digits: `${digits.slice(0, 4)} ${digits.slice(4)}` };
}

if (typeof module !== 'undefined') module.exports = { securityCode, fingerprintOf, CODE_EMOJI };
