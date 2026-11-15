// Конверт v2. Пока только формат и валидация; отправка остаётся на v1.
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const isB64 = (value) => typeof value === 'string' && value.length > 0 && B64.test(value);
const isId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;

function buildV2({ conv, from, identityPublic, ephemeralPublic, dh, n, iv, ct }) {
  if (typeof conv !== 'string' || !conv) throw new Error('v2: нет переписки');
  if (!isId(from)) throw new Error('v2: нет отправителя');
  if (!isB64(identityPublic) || !isB64(ephemeralPublic)) throw new Error('v2: нет X3DH');
  if (!isB64(dh) || !Number.isSafeInteger(n) || n < 0 || !isB64(iv) || !isB64(ct)) throw new Error('v2: нет ratchet');
  return {
    v: 2,
    conv,
    from: Number(from),
    x3dh: { identityPublic, ephemeralPublic },
    ratchet: { dh, n, iv, ct },
  };
}

function parseV2(enc) {
  if (enc?.v !== 2) return null;
  if (typeof enc.conv !== 'string' || !enc.conv) return null;
  if (!isId(enc.from)) return null;
  if (!isB64(enc.x3dh?.identityPublic) || !isB64(enc.x3dh?.ephemeralPublic)) return null;
  if (!isB64(enc.ratchet?.dh) || !Number.isSafeInteger(enc.ratchet.n) || enc.ratchet.n < 0) return null;
  if (!isB64(enc.ratchet.iv) || !isB64(enc.ratchet.ct)) return null;
  return enc;
}

module.exports = { buildV2, parseV2 };