// Шифрование переписки на устройстве — только чистые функции поверх WebCrypto, без сети и состояния.
// У человека пара ключей ECDH P-256: закрытый не покидает его устройства, публичный знает сервер.
// У переписки (личной или комнатной) — общий ключ AES-256; каждому участнику сервер хранит его копию,
// запечатанную публичным ключом участника (эфемерный ECDH → HKDF → AES-GCM), поэтому открыть её сервер не может.
// Сообщения и файлы шифруются AES-GCM; к сообщению привязаны переписка, версия ключа и отправитель —
// конверт нельзя переложить в другую переписку или выдать за чужой.

const E2EE = (() => {
  const subtle = globalThis.crypto.subtle;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const ECDH = { name: 'ECDH', namedCurve: 'P-256' };

  const toB64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

  const aesKey = (raw, usage) => subtle.importKey('raw', raw, 'AES-GCM', false, usage);

  /** Новая пара ключей человека: публичный — base64 точки P-256, закрытый — JWK для хранения на устройстве */
  async function generateIdentity() {
    const pair = await subtle.generateKey(ECDH, true, ['deriveBits']);
    return {
      publicKey: toB64(await subtle.exportKey('raw', pair.publicKey)),
      privateJwk: await subtle.exportKey('jwk', pair.privateKey),
    };
  }

  const importPrivate = (jwk) => subtle.importKey('jwk', jwk, ECDH, false, ['deriveBits']);
  const importPublic = (b64) => subtle.importKey('raw', fromB64(b64), ECDH, false, []);

  /** Общий ключ из ECDH: HKDF-SHA256 с меткой назначения → AES-GCM */
  async function sharedKey(privateKey, publicKey, info) {
    const bits = await subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
    const hkdf = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    return subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(info) },
      hkdf,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /** Новый ключ переписки (base64, 32 байта) */
  const newConvKey = () => toB64(randomBytes(32));

  /** Запечатать ключ переписки публичным ключом получателя: открыть сможет только он */
  async function seal(convKeyB64, recipientPublicB64) {
    const eph = await subtle.generateKey(ECDH, true, ['deriveBits']);
    const key = await sharedKey(eph.privateKey, await importPublic(recipientPublicB64), 'sozvon-seal-v1');
    const iv = randomBytes(12);
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, fromB64(convKeyB64));
    return JSON.stringify({ epk: toB64(await subtle.exportKey('raw', eph.publicKey)), iv: toB64(iv), ct: toB64(ct) });
  }

  /** Открыть свою копию ключа переписки своим закрытым ключом */
  async function open(sealed, privateKey) {
    const { epk, iv, ct } = JSON.parse(sealed);
    const key = await sharedKey(privateKey, await importPublic(epk), 'sozvon-seal-v1');
    return toB64(await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(ct)));
  }

  // Привязка конверта: переписка, версия ключа, отправитель
  const aadOf = ({ conv, epoch, from }) => enc.encode(`sozvon-msg-v1|${conv}|${epoch}|${from}`);

  /** Зашифровать содержимое сообщения (текст, файлы с ключами, превью) ключом переписки */
  async function encryptMessage(convKeyB64, payload, aad) {
    const iv = randomBytes(12);
    const key = await aesKey(fromB64(convKeyB64), ['encrypt']);
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aadOf(aad) }, key, enc.encode(JSON.stringify(payload)));
    return { v: 1, epoch: aad.epoch, iv: toB64(iv), ct: toB64(ct) };
  }

  async function decryptMessage(convKeyB64, envelope, aad) {
    const key = await aesKey(fromB64(convKeyB64), ['decrypt']);
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(envelope.iv), additionalData: aadOf(aad) }, key, fromB64(envelope.ct));
    return JSON.parse(dec.decode(plain));
  }

  /** Файл шифруется своим случайным ключом; ключ и iv уезжают внутри зашифрованного сообщения */
  async function encryptFile(data) {
    const raw = randomBytes(32);
    const iv = randomBytes(12);
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(raw, ['encrypt']), data);
    return { data: ct, key: toB64(raw), iv: toB64(iv) };
  }

  const decryptFile = async (data, keyB64, ivB64) =>
    subtle.decrypt({ name: 'AES-GCM', iv: fromB64(ivB64) }, await aesKey(fromB64(keyB64), ['decrypt']), data);

  // ---------- Перенос ключа на новое устройство ----------

  // Код: 16 знаков без похожих (0/O, 1/I/L) — ~80 бит, удобно продиктовать или перепечатать
  const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const normalizeCode = (code) => String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');

  function makeTransferCode() {
    const bytes = randomBytes(16);
    const chars = [...bytes].map((b) => CODE_ABC[b % CODE_ABC.length]).join('');
    return chars.match(/.{4}/g).join('-');
  }

  /** По этому id сервер находит перенос, не зная самого кода */
  async function transferId(code) {
    const hash = await subtle.digest('SHA-256', enc.encode(`sozvon-transfer-id|${normalizeCode(code)}`));
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function codeKey(code, salt) {
    const base = await subtle.importKey('raw', enc.encode(normalizeCode(code)), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 310_000 }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  /** Пара ключей, зашифрованная кодом, — её можно отдать серверу на 10 минут */
  async function wrapIdentity(identity, code) {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, await codeKey(code, salt), enc.encode(JSON.stringify(identity)));
    return JSON.stringify({ salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) });
  }

  async function unwrapIdentity(blob, code) {
    const { salt, iv, ct } = JSON.parse(blob);
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, await codeKey(code, fromB64(salt)), fromB64(ct));
    return JSON.parse(dec.decode(plain));
  }

  /** Код проверки ключей двоих: одинаковый у обоих; подменят ключ — код разойдётся */
  const keyCode = (publicA, publicB) =>
    (typeof securityCode === 'function' ? securityCode : require('./call-code').securityCode)([publicA, publicB]);

  return {
    generateIdentity, importPrivate, newConvKey, seal, open, encryptMessage, decryptMessage,
    encryptFile, decryptFile, makeTransferCode, transferId, wrapIdentity, unwrapIdentity, keyCode, toB64, fromB64,
  };
})();

if (typeof module !== 'undefined') module.exports = E2EE;
