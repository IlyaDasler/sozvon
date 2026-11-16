// Сквозное шифрование переписки в приложении: свой ключ, ключи переписок, отправка и расшифровка.
// Шифры и ключи — в e2ee-crypto.js; здесь — когда и что с ними делать.
// - Свой ключ создаётся при первом входе. Для аккаунтов с паролем он автоматически сохраняется
//   на сервере запечатанным паролем; на новом устройстве вход тем же паролем открывает его сам.
//   Ручных кодов переноса нет: если копия не открылась, клиент просит пароль аккаунта.
// - Ключ переписки грузится один раз, открывается своим ключом; тем, у кого его ещё нет (новичок, сменил
//   ключ), делимся сами. Выгнали участника — при следующей отправке ключ меняем.
// - Сообщение и файлы шифруются перед отправкой; входящие расшифровываются, файлы — когда их показывают.

const LOCKED_TEXT = '🔒 Зашифрованное сообщение — обновите Созвон, чтобы прочитать';

const e2ee = {
  identity: null, // { publicKey, privateJwk } — свой ключ на этом устройстве
  privateKey: null,
  convs: new Map(), // переписка -> { keys: Map<epoch, ключ>, epoch, missing, rotate, loading }
  files: new Map(), // id вложения -> Promise<адрес расшифрованного файла>
};

// Ключи храним отдельно для каждого сервера: id пользователей уникальны только внутри сервера,
// и на двух серверах под одним номером могут быть разные люди. Без привязки к серверу при его
// смене подхватился бы чужой ключ
const serverScope = () => {
  const base = String(Api.base || '')
    .replace(/^https?:\/\//i, '')
    .replace(/[^a-z0-9.-]/gi, '_')
    .toLowerCase();
  return base || 'local';
};
const scopedKey = (name, id = state.me.id) => `e2ee:${serverScope()}:${name}:${id}`;
const legacyKey = (name, id = state.me.id) => `e2ee:${name}:${id}`;

/** Ключ мог лечь в хранилище запечатанным под именем, которое store не считает секретным
 *  (так было в 2.9.5) — тогда распечатываем сами и переписываем уже по правилам */
function unseal(value) {
  if (!value || typeof value !== 'object' || !value.vault) return value;
  try {
    const opened = JSON.parse(window.desktop?.vault?.open(value.vault));
    return opened ?? null;
  } catch {
    return null;
  }
}

/** Читаем ключ сервера; если его нет — один раз переносим ключ прежнего формата.
 *  Значение переносим сырым: запечатанный ключ должен остаться запечатанным */
function readScoped(name, fallback) {
  const value = unseal(store.get(scopedKey(name), null));
  if (value !== null && value !== undefined) {
    store.set(scopedKey(name), value); // переписываем заново: так ключ снова запечатан
    return value;
  }
  const legacy = legacyKey(name);
  let raw = null;
  try {
    raw = localStorage.getItem(legacy);
  } catch {}
  if (raw === null) return fallback;
  let moved = null;
  try {
    localStorage.setItem(scopedKey(name), raw);
    localStorage.removeItem(legacy);
    moved = unseal(store.get(scopedKey(name), null));
  } catch {
    return fallback;
  }
  if (moved === null || moved === undefined) return fallback;
  store.set(scopedKey(name), moved);
  return moved;
}

const identityLooksValid = (value) => Boolean(value && value.publicKey);
const identityContext = () => ({ server: serverScope(), userId: Number(state.me?.id) || 0 });
let cachedDeviceHash = '';
async function deviceHash() {
  if (cachedDeviceHash) return cachedDeviceHash;
  const key = String(window.desktop?.device?.key?.() || '');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  cachedDeviceHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return cachedDeviceHash;
}

function clearLegacyIdentityKeys(id) {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('e2ee:') && key.endsWith(`:identity:${id}`)) localStorage.removeItem(key);
    }
  } catch {}
}

/** Main-процесс — единственное место, где живёт privateJwk. Renderer получает
 *  только publicKey; legacy-ключ из localStorage импортируется один раз и стирается. */
async function readLocalIdentity() {
  const context = identityContext();
  try {
    const loaded = await window.desktop?.identity?.load(context);
    if (loaded?.publicKey) return { publicKey: loaded.publicKey };
  } catch {}
  const id = state.me?.id;
  if (!id) return null;
  const suffix = `:identity:${id}`;
  let keys = [];
  try {
    keys = Object.keys(localStorage).filter((key) => key.startsWith('e2ee:') && (key.endsWith(suffix) || key === `e2ee:identity:${id}`));
  } catch {}
  for (const key of keys) {
    try {
      const value = store.get(key, null);
      if (value?.publicKey && value?.privateJwk) {
        await useIdentity(value);
        clearLegacyIdentityKeys(id);
        return { publicKey: value.publicKey };
      }
    } catch {}
  }
  try {
    const raw = window.desktop?.vault?.loadIdentity();
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved?.server === serverScope() && Number(saved?.userId) === Number(id) && saved.identity?.privateJwk) {
        await useIdentity(saved.identity);
        clearLegacyIdentityKeys(id);
        return { publicKey: saved.identity.publicKey };
      }
    }
  } catch {}
  return null;
}

const dmConvOf = (peerId) => `dm:${Math.min(state.me.id, peerId)}-${Math.max(state.me.id, peerId)}`;
const roomConvOf = (roomId) => `room:${roomId}`;
const e2eeReady = () => Boolean(e2ee.privateKey);

/** Участники переписки, как их знает приложение: личная — двое, комнатная — её участники */
function convMembersLocal(conv) {
  const dm = /^dm:(\d+)-(\d+)$/.exec(conv);
  if (dm) return [Number(dm[1]), Number(dm[2])];
  const room = roomById(Number(conv.slice(5)));
  return room ? room.members.map((m) => m.id) : [];
}

const publicKeyOf = (userId) => (userId === state.me.id ? e2ee.identity?.publicKey : userById(userId)?.publicKey) || null;

// ---------- Свой ключ ----------

async function publishPrekey() {
  try {
    if (!state.me?.publicKey) return;
    const prekey = await window.desktop?.identity?.ensurePrekey(identityContext());
    if (prekey?.publicKey) {
      await Api.put('/me/prekey', { signedPrekeyPublic: prekey.publicKey });
    }
  } catch (err) {
    console.warn('Prekey не опубликован:', err.message);
  }
}

async function useIdentity(identity) {
  if (identity?.privateJwk) {
    await window.desktop?.identity?.import(identityContext(), identity);
  }
  e2ee.identity = { publicKey: identity.publicKey };
  e2ee.privateKey = true;
  e2ee.convs.clear();
  $('e2ee-setup').classList.add('hidden');
  redecryptAll();
  await publishPrekey();
}

async function publishIdentity(identity, password = '', totpCode = '') {
  // Замена существующего ключа на сервере требует пароль: одной сессии мало.
  const body = { publicKey: identity.publicKey };
  if (password) body.password = password;
  if (totpCode) body.totpCode = totpCode;
  try {
    state.me = await Api.put('/me/key', body);
    await publishPrekey();
  } catch (err) {
    if (err.data?.needTotp && !totpCode && typeof askText === 'function') {
      const code = await askText('Введите код из приложения-аутентификатора', '', {
        hint: '6 цифр — приложение-аутентификатор',
        maxlength: 6,
      });
      if (!code) throw err;
      return publishIdentity(identity, password, code);
    }
    throw err;
  }
}

/** При входе: свой ключ есть и совпадает — работаем; нет нигде — создаём; на сервере другой — спрашиваем */
let lastKeyBackupError = '';

async function fetchKeyBackup(password) {
  if (!password || !state.me?.hasPassword) return null;
  lastKeyBackupError = '';
  try {
    return await Api.post('/key-backup/read', { password });
  } catch (err) {
    if (err.status === 401) lastKeyBackupError = 'Неверный пароль аккаунта.';
    else if (err.status !== 404) console.warn('Резервная копия ключа:', err.message);
    return null;
  }
}

/** Сохранить ключ профиля на сервере, запечатав его паролем. Сервер не может его открыть. */
async function uploadKeyBackup(password) {
  if (!password || !state.me?.hasPassword) return false;
  try {
    const blob = await window.desktop.identity.wrapBackup(identityContext(), password, state.me.id);
    await Api.put('/key-backup', { password, ...blob });
    return true;
  } catch (err) {
    console.warn('Не удалось сохранить резервную копию ключа:', err.message);
    return false;
  }
}

/** Смена пароля: старый blob больше не откроется, сразу перезапечатываем текущий ключ. */
async function backupKeyWithPassword(password) {
  return uploadKeyBackup(password);
}

async function setupE2EE(password = '') {
  const local = await readLocalIdentity();
  const server = state.me.publicKey;
  try {
    // Пароль есть только в момент входа. По нему открываем серверную копию
    // автоматически — без кодов переноса и второго устройства.
    if (password && state.me.hasPassword) {
      const backup = await fetchKeyBackup(password);
      let fromBackup = null;
      if (backup?.ct) {
        try {
          fromBackup = await window.desktop.identity.unwrapBackup(identityContext(), backup, password, state.me.id);
        } catch {
          lastKeyBackupError = 'Резервная копия найдена, но не открылась. Если пароль менялся, введите прежний пароль.';
        }
      }
      if (fromBackup?.publicKey && (!server || server === fromBackup.publicKey)) {
        await useIdentity(fromBackup);
        if (!server) await publishIdentity(fromBackup, password);
        return;
      }
      if (local && (!server || server === local.publicKey)) {
        await useIdentity(local);
        if (!server) await publishIdentity(local, password);
        // Обновляем/создаём копию: при следующем входе новое устройство
        // подхватит ключ само.
        await uploadKeyBackup(password);
        return;
      }
      if (!local && !server) {
        const generated = await window.desktop.identity.generate(identityContext());
        const identity = { publicKey: generated.publicKey };
        await useIdentity(identity);
        await publishIdentity(identity, password);
        await uploadKeyBackup(password);
        return;
      }
      // На этом устройстве есть ключ, а на сервере другой и копия не открылась.
      // После проверенного пароля возвращаем ключ этого устройства на сервер —
      // без кода переноса и без ручного «отправить ключ».
      if (local && password) {
        await useIdentity(local);
        await publishIdentity(local, password);
        await uploadKeyBackup(password);
        return;
      }
    }
    // Пароля нет (вход через Яндекс) или серверная копия не открылась.
    // Локальный ключ всё равно используем — он уже есть на этом устройстве.
    if (local && (!server || server === local.publicKey)) {
      await useIdentity(local);
      if (!server) {
        if (state.me?.hasPassword) {
          openKeyUnlock();
          return;
        }
        await publishIdentity(local);
      }
    } else if (!local && !server) {
      if (!state.me?.hasPassword) {
        toast('Сначала задайте пароль аккаунта — без него ключ нельзя восстановить на новом устройстве.', 8000);
        openSettings('account');
        return;
      }
      const generated = await window.desktop.identity.generate(identityContext());
      const identity = { publicKey: generated.publicKey };
      await useIdentity(identity);
      await publishIdentity(identity);
    } else if (state.me?.hasPassword) {
      // Это уже авторизованное устройство с потерянным localStorage или новое
      // устройство. Вместо кода переноса просим пароль — серверная копия
      // открывается автоматически.
      openKeyUnlock();
    } else {
      toast('Ключ шифрования этого аккаунта сохранён на другом устройстве. Задайте пароль в настройках, чтобы включить автовосстановление.');
    }
  } catch (err) {
    toast(`Шифрование: ${err.message}`);
  }
}

let keyUnlockMode = 'restore';

function openKeyUnlock(mode = 'restore') {
  keyUnlockMode = mode;
  const rebind = mode === 'rebind';
  $('e2ee-setup-title').textContent = rebind ? 'Сохраните ключ под текущим паролем' : 'Восстановите ключ шифрования';
  $('e2ee-setup-text').textContent = rebind
    ? 'Введите текущий пароль аккаунта. Ключ с этого устройства будет заново сохранён под ним; старые копии больше не нужны.'
    : 'Введите пароль от аккаунта — ключ шифрования восстановится автоматически. Если пароль недавно меняли, введите прежний: копия могла быть зашифрована им.';
  $('e2ee-unlock-btn').textContent = rebind ? 'Сохранить' : 'Восстановить';
  $('e2ee-password').value = '';
  $('e2ee-setup-error').textContent = '';
  $('e2ee-setup').classList.remove('hidden');
  $('e2ee-password').focus();
}

// ---------- Ключи переписок ----------

function loadConv(conv) {
  const cached = e2ee.convs.get(conv);
  if (cached) return cached.loading;
  const c = { keys: new Map(), epoch: 0, missing: [], rotate: false };
  c.loading = (async () => {
    const data = await Api.get(`/keys/${conv}`);
    for (const [epoch, sealed] of Object.entries(data.mine)) {
      try {
        c.keys.set(Number(epoch), await window.desktop.identity.open(identityContext(), sealed));
      } catch {}
    }
    Object.assign(c, { epoch: data.epoch, missing: data.missing, rotate: data.rotate });
    shareKeys(conv, c).catch(() => {});
    return c;
  })();
  c.loading.catch(() => e2ee.convs.delete(conv));
  e2ee.convs.set(conv, c);
  return c.loading;
}

/** Делимся ключами (всеми версиями, что есть у нас) с теми, у кого последней версии нет */
async function shareKeys(conv, c) {
  const targets = c.missing.filter((id) => id !== state.me.id && publicKeyOf(id));
  if (!targets.length || !c.keys.has(c.epoch)) return;
  for (const [epoch, key] of c.keys) {
    const sealed = {};
    for (const id of targets) sealed[id] = await E2EE.seal(key, publicKeyOf(id));
    await Api.post(`/keys/${conv}`, { epoch, sealed }).catch(() => {});
  }
}

/** Ключ для отправки: последняя версия, если она у нас есть и её не пора менять; иначе — новая версия */
async function sendKey(conv, retry = true) {
  const c = await loadConv(conv);
  if (c.epoch && !c.rotate && c.keys.has(c.epoch)) return { epoch: c.epoch, key: c.keys.get(c.epoch) };
  const key = E2EE.newConvKey();
  const sealed = {};
  for (const id of new Set([state.me.id, ...convMembersLocal(conv)])) {
    const pub = publicKeyOf(id);
    if (pub) sealed[id] = await E2EE.seal(key, pub);
  }
  try {
    await Api.post(`/keys/${conv}`, { epoch: c.epoch + 1, sealed });
  } catch (err) {
    // Кто-то успел раньше — берём его версию
    e2ee.convs.delete(conv);
    if (retry && (err.status === 409 || err.status === 403)) return sendKey(conv, false);
    throw err;
  }
  e2ee.convs.delete(conv);
  return { epoch: c.epoch + 1, key };
}

// ---------- Отправка ----------

const IMAGE_MIME = /^image\/(png|jpe?g|gif|webp)$/;
const VIDEO_MIME = /^video\/(mp4|webm|ogg)$/;
const AUDIO_MIME = /^audio\/(mpeg|mp3|ogg|wav|webm|aac|mp4|x-m4a)$/;
/** Как показывать файл: картинкой, видео, звуком или карточкой */
const kindOfMime = (mime) => (IMAGE_MIME.test(mime) ? 'image' : VIDEO_MIME.test(mime) ? 'video' : AUDIO_MIME.test(mime) ? 'audio' : 'file');

/** Файл перед загрузкой: шифруем его ключом; ключ, имя и тип уйдут внутри сообщения */
async function encryptForUpload(file) {
  const { data, key, iv } = await E2EE.encryptFile(await file.arrayBuffer());
  // Серверу — безымянные байты: имя и тип файла уходят только внутри зашифрованного сообщения
  const blob = new File([data], 'encrypted.bin', { type: 'application/octet-stream' });
  return { blob, secret: { key, iv, name: file.name || 'файл', mime: file.type || 'application/octet-stream', size: file.size, kind: kindOfMime(file.type) } };
}

/** Тело запроса для отправки: конверт вместо текста; plain — то, что увидит отправитель сразу */
async function encryptV2Outgoing(conv, peerId, plain) {
  if (!window.desktop?.identity?.x3dhInitiator) return null;
  let list;
  try { list = await Api.get(`/users/${peerId}/prekeys`); } catch { return null; }
  if (!list?.identityPublic || !Array.isArray(list.devices) || !list.devices.length) return null;
  const serverKey = await window.desktop?.update?.publicKey?.();
  if (!serverKey) return null;
  const context = identityContext();
  const role = state.me.id < peerId ? 'a' : 'b';
  const myDevice = await deviceHash();
  const copies = [];
  for (const device of list.devices) {
    if (!device?.deviceHash || !device?.signature || !device?.signedPrekeyPublic) continue;
    const bundle = {
      identityPublic: list.identityPublic,
      signedPrekeyPublic: device.signedPrekeyPublic,
      signature: device.signature,
      createdAt: device.createdAt,
    };
    if (!(await window.desktop.identity.x3dhVerify(bundle, serverKey))) continue;
    const init = await window.desktop.identity.x3dhInitiator(context, bundle);
    const stateKey = `${conv}|to:${device.deviceHash}`;
    await window.desktop.identity.ratchetEnsureStatic(context, stateKey, init.root, role, bundle.identityPublic);
    await window.desktop.identity.ratchetRotate(context, stateKey);
    const ratchet = await window.desktop.identity.ratchetEncrypt(context, stateKey, plain, `${conv}|v3|${device.deviceHash}`);
    copies.push({
      deviceHash: device.deviceHash,
      fromDevice: myDevice,
      x3dh: { identityPublic: e2ee.identity.publicKey, ephemeralPublic: init.ephemeralPublic },
      ratchet,
    });
  }
  if (!copies.length) return null;
  const { epoch, key } = await sendKey(conv);
  const self = await E2EE.encryptMessage(key, plain, { conv, epoch, from: state.me.id });
  return { v: 3, conv, from: state.me.id, fromDevice: myDevice, copies, self };
}

async function wrapWithRoot(rootB64, bytes) {
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(rootB64), (c) => c.charCodeAt(0)), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv: btoa(String.fromCharCode(...iv)), ct: btoa(String.fromCharCode(...new Uint8Array(ct))) };
}

async function unwrapWithRoot(rootB64, sealed) {
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(rootB64), (c) => c.charCodeAt(0)), 'AES-GCM', false, ['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Uint8Array.from(atob(sealed.iv), (c) => c.charCodeAt(0)) },
    key,
    Uint8Array.from(atob(sealed.ct), (c) => c.charCodeAt(0))
  ));
}

async function encryptV4Room(conv, room, plain) {
  if (!window.desktop?.identity?.x3dhInitiator) return null;
  const members = room?.members?.map((m) => Number(m.id)).filter(Boolean) || [];
  if (!members.length) return null;
  const serverKey = await window.desktop?.update?.publicKey?.();
  if (!serverKey) return null;
  const context = identityContext();
  const myDevice = await deviceHash();
  const msgKey = crypto.getRandomValues(new Uint8Array(32));
  const msgAes = await crypto.subtle.importKey('raw', msgKey, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payloadCT = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`${conv}|v4`) },
    msgAes,
    new TextEncoder().encode(JSON.stringify(plain))
  );
  const copies = [];
  for (const memberId of members) {
    let list;
    try { list = await Api.get(`/users/${memberId}/prekeys`); } catch { return null; }
    if (!list?.identityPublic || !Array.isArray(list.devices) || !list.devices.length) return null;
    for (const device of list.devices) {
      if (!device?.deviceHash || !device?.signature || !device?.signedPrekeyPublic) return null;
      const bundle = { identityPublic: list.identityPublic, signedPrekeyPublic: device.signedPrekeyPublic, signature: device.signature, createdAt: device.createdAt };
      if (!(await window.desktop.identity.x3dhVerify(bundle, serverKey))) return null;
      const init = await window.desktop.identity.x3dhInitiator(context, bundle);
      const sealedKey = await wrapWithRoot(init.root, msgKey);
      copies.push({
        userId: memberId,
        deviceHash: device.deviceHash,
        fromDevice: myDevice,
        x3dh: { identityPublic: e2ee.identity.publicKey, ephemeralPublic: init.ephemeralPublic },
        sealedKey,
      });
    }
  }
  return {
    v: 4,
    conv,
    from: state.me.id,
    fromDevice: myDevice,
    payload: { iv: btoa(String.fromCharCode(...iv)), ct: btoa(String.fromCharCode(...new Uint8Array(payloadCT))) },
    copies,
  };
}

async function encryptOutgoing(conv, { text, files = [], preview = null, reply = null, forward = null, eventId = null }) {
  if (!e2eeReady()) throw new Error('Сначала настройте шифрование на этом устройстве');
  const plain = {
    text,
    files: files.map(({ id, key, iv, name, mime, size, kind }) => ({ id, key, iv, name, mime, size, kind })),
    preview,
    // Ответ целиком внутри конверта: сервер видит только id, текст цитаты остаётся зашифрованным
    reply: reply ? { id: reply.id, fromId: reply.fromId, text: reply.text || '' } : null,
    // Автор пересланного: снимок, потому что получатель может его не знать
    forward,
    // Событие канала: в сообщении только id, само событие приходит вместе с комнатой
    ...(eventId ? { eventId } : {}),
  };
  const dm = /^dm:(\d+)-(\d+)$/.exec(conv);
  if (dm) {
    const a = Number(dm[1]);
    const b = Number(dm[2]);
    const peer = a === state.me.id ? b : a;
    try {
      const wire = await encryptV2Outgoing(conv, peer, plain);
      if (wire) {
        return {
          body: { text: LOCKED_TEXT, enc: wire, attachmentIds: files.map((f) => f.id), replyToId: reply?.id ?? null },
          plain,
        };
      }
    } catch (err) {
      console.warn('v2 не отправлен, используется v1:', err.message);
    }
  }
  const roomMatch = /^room:(\d+)$/.exec(conv);
  if (roomMatch) {
    const room = roomById(Number(roomMatch[1]));
    if (room) {
      try {
        const wire = await encryptV4Room(conv, room, plain);
        if (wire) {
          return { body: { text: LOCKED_TEXT, enc: wire, attachmentIds: files.map((f) => f.id), replyToId: reply?.id ?? null }, plain };
        }
      } catch (err) {
        console.warn('v4 room не отправлен, используется v1:', err.message);
      }
    }
  }
  const { epoch, key } = await sendKey(conv);
  const enc = await E2EE.encryptMessage(key, plain, { conv, epoch, from: state.me.id });
  return {
    body: { text: LOCKED_TEXT, enc, attachmentIds: files.map((f) => f.id), replyToId: reply?.id ?? null },
    plain,
  };
}

/** Файл ушёл на сервер зашифрованным; attachment — { id, url } от сервера и { key, iv, name, mime, size, kind } для сообщения */
function uploadEncrypted(file, onProgress) {
  let upload = null;
  let aborted = false;
  const done = encryptForUpload(file).then(({ blob, secret }) => {
    if (aborted) throw new Error('Загрузка отменена');
    upload = uploadFile(blob, onProgress);
    return upload.done.then((stored) => ({ ...secret, id: stored.id, url: stored.url }));
  });
  return {
    done,
    abort() {
      aborted = true;
      upload?.abort();
    },
  };
}

// ---------- Расшифровка ----------

/** Расшифровать сообщения переписки: m.plain — содержимое, m.locked — почему не получилось */
async function decryptV2(m, conv) {
  if (m.enc.self) {
    const c = await loadConv(conv).catch(() => null);
    const key = c?.keys.get(m.enc.self.epoch);
    if (!key) throw new Error('Нет ключа для собственной копии');
    return E2EE.decryptMessage(key, m.enc.self, { conv, epoch: m.enc.self.epoch, from: m.fromId });
  }
  const myHash = await deviceHash();
  const copy = (m.enc.copies || []).find((c) => c.deviceHash === myHash);
  if (!copy) throw new Error('Нет копии для этого устройства');
  const root = await window.desktop.identity.x3dhResponder(identityContext(), copy.x3dh.identityPublic, copy.x3dh.ephemeralPublic);
  const role = state.me.id < Number(m.fromId) ? 'a' : 'b';
  const stateKey = `${conv}|peer:${copy.fromDevice}`;
  await window.desktop.identity.ratchetEnsureStatic(identityContext(), stateKey, root.root, role, copy.x3dh.identityPublic);
  return window.desktop.identity.ratchetDecrypt(identityContext(), stateKey, copy.ratchet, `${conv}|v3|${myHash}`);
}

async function decryptV4Room(m, conv) {
  const myHash = await deviceHash();
  const copy = (m.enc.copies || []).find((c) => c.userId === state.me.id && c.deviceHash === myHash);
  if (!copy) throw new Error('Нет копии для этого устройства');
  const root = await window.desktop.identity.x3dhResponder(identityContext(), copy.x3dh.identityPublic, copy.x3dh.ephemeralPublic);
  const msgKey = await unwrapWithRoot(root.root, copy.sealedKey);
  const key = await crypto.subtle.importKey('raw', msgKey, 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Uint8Array.from(atob(m.enc.payload.iv), (c) => c.charCodeAt(0)), additionalData: new TextEncoder().encode(`${conv}|v4`) },
    key,
    Uint8Array.from(atob(m.enc.payload.ct), (c) => c.charCodeAt(0))
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

async function decryptMessages(list, conv) {
  const encrypted = list.filter((m) => m.enc && !m.plain);
  if (!encrypted.length) return;
  if (!e2eeReady()) {
    for (const m of encrypted) m.locked = 'no-identity';
    return;
  }
  const v2 = encrypted.filter((m) => m.enc.v === 2 || m.enc.v === 3);
  const v4 = encrypted.filter((m) => m.enc.v === 4);
  const v1 = encrypted.filter((m) => m.enc.v !== 2 && m.enc.v !== 4);
  let c = await loadConv(conv).catch(() => null);
  // Ключа нужной версии нет — возможно, им только что поделились: перечитываем один раз
  if (c && v1.some((m) => !c.keys.has(m.enc.epoch))) {
    e2ee.convs.delete(conv);
    c = await loadConv(conv).catch(() => null);
  }
  await Promise.all([
    ...v1.map(async (m) => {
      const key = c?.keys.get(m.enc.epoch);
      if (!key) return (m.locked = 'no-key');
      try {
        m.plain = await E2EE.decryptMessage(key, m.enc, { conv, epoch: m.enc.epoch, from: m.fromId });
        delete m.locked;
      } catch {
        m.locked = 'broken';
      }
    }),
    ...v2.map(async (m) => {
      const cacheKey = `e2ee:v2plain:${serverScope()}:${m.id}:${m.editedAt || 0}`;
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          try {
            m.plain = JSON.parse(await window.desktop.identity.cacheOpen(identityContext(), cached));
            delete m.locked;
            return;
          } catch (err) {
            localStorage.removeItem(cacheKey);
          }
        }
        const plain = await decryptV2(m, conv);
        try {
          const blob = await window.desktop.identity.cacheSeal(identityContext(), JSON.stringify(plain));
          localStorage.setItem(cacheKey, blob);
        } catch (err) {
        }
        m.plain = plain;
        delete m.locked;
      } catch (err) {
        m.locked = 'broken';
      }
    }),
    ...v4.map(async (m) => {
      const cacheKey = `e2ee:v4plain:${serverScope()}:${m.id}:${m.editedAt || 0}`;
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          try {
            m.plain = JSON.parse(await window.desktop.identity.cacheOpen(identityContext(), cached));
            delete m.locked;
            return;
          } catch {
            localStorage.removeItem(cacheKey);
          }
        }
        const plain = await decryptV4Room(m, conv);
        try {
          const blob = await window.desktop.identity.cacheSeal(identityContext(), JSON.stringify(plain));
          localStorage.setItem(cacheKey, blob);
        } catch {}
        m.plain = plain;
        delete m.locked;
      } catch (err) {
        m.locked = 'broken';
      }
    }),
  ]);
}

/** Переписки, которые сейчас в памяти, и их сообщения */
function* knownConvs() {
  for (const [peerId, list] of state.history) yield [dmConvOf(peerId), list];
  for (const [roomId, list] of state.roomHistory) yield [roomConvOf(roomId), list];
}

/** Заново пробуем то, что не расшифровалось (появился свой ключ или поделились ключом переписки) */
async function redecryptAll(onlyConv = null) {
  for (const [conv, list] of knownConvs()) {
    if (onlyConv && conv !== onlyConv) continue;
    const locked = list.filter((m) => m.locked);
    if (!locked.length) continue;
    for (const m of locked) delete m.locked;
    await decryptMessages(locked, conv);
  }
  renderMessages();
  if (state.selectedRoomId) renderRoomMessages();
}

/** Расшифрованный файл вложения (адрес blob:) — один раз на вложение */
function decryptedFileUrl(a) {
  if (!e2ee.files.has(a.id)) {
    const p = (async () => {
      const res = await fetch(`${Api.base}${a.url}`);
      if (!res.ok) throw new Error('Файл не найден');
      const plain = await E2EE.decryptFile(await res.arrayBuffer(), a.key, a.iv);
      return URL.createObjectURL(new Blob([plain], { type: a.mime }));
    })();
    p.catch(() => e2ee.files.delete(a.id));
    e2ee.files.set(a.id, p);
  }
  return e2ee.files.get(a.id);
}

// ---------- Ключи собеседников: смена ключа и код проверки ----------

const seenKeysStore = () => scopedKey('seen');
const changedKeysStore = () => scopedKey('changed');
const keyChanged = (userId) => readScoped('changed', []).includes(userId);

const keyHistoryRootKey = (userId) => `e2ee:${serverScope()}:keyhistory:${userId}`;
const KEY_WITNESS_URL = 'https://cdn.jsdelivr.net/gh/IlyaDasler/sozvon@main/transparency/key-history.json';
let keyWitnessCache = null;
async function witnessedKeyHistory(entryHash) {
  if (!entryHash) return null;
  try {
    if (!keyWitnessCache) {
      const res = await fetch(KEY_WITNESS_URL, { cache: 'no-store' });
      if (!res.ok) return null;
      keyWitnessCache = await res.json();
    }
    const users = Array.isArray(keyWitnessCache?.users) ? keyWitnessCache.users : [];
    return users.some((user) => (user.entries || []).some((entry) => entry.entryHash === entryHash));
  } catch {
    return null;
  }
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function verifyKeyHistory(userId, items) {
  const ordered = [...items].reverse();
  let prev = '';
  let latest = '';
  for (const item of ordered) {
    if (!item?.entryHash) continue;
    const at = Math.floor(new Date(item.changedAt).getTime() / 1000);
    const expected = await sha256Hex(`${item.prevHash}|${Number(userId)}|${item.publicKey}|${at}`);
    if (item.prevHash !== prev || item.entryHash !== expected) {
      toast('История ключей не прошла проверку целостности — не доверяйте новому ключу без сверки кода.', 10000);
      return items;
    }
    if (item.signature && window.desktop?.update?.verifyKeyHistory) {
      const valid = await window.desktop.update.verifyKeyHistory(item.entryHash, item.signature);
      if (!valid) {
        toast('Подпись истории ключей неверна — не доверяйте новому ключу.', 10000);
        return items;
      }
    }
    prev = item.entryHash;
    latest = item.entryHash;
  }
  if (latest) {
    const cached = store.get(keyHistoryRootKey(userId), '');
    if (cached && !ordered.some((item) => item.entryHash === cached)) {
      toast('История ключей переписана сервером — сверьте ключ вручную.', 10000);
    }
    store.set(keyHistoryRootKey(userId), latest);
    const witnessed = await witnessedKeyHistory(latest);
    if (witnessed === false) console.warn('История ключей ещё не подтверждена внешним журналом');
    if (witnessed === true) store.set(`${keyHistoryRootKey(userId)}:witnessed`, latest);
  }
  return items;
}

async function fetchKeyHistory(userId) {
  try {
    const data = await Api.get(`/users/${userId}/key-history`);
    const items = Array.isArray(data?.items) ? data.items : [];
    return await verifyKeyHistory(userId, items);
  } catch {
    return [];
  }
}

function setKeyChanged(userId, changed) {
  const rest = readScoped('changed', []).filter((id) => id !== userId);
  store.set(changedKeysStore(), changed ? [...rest, userId] : rest);
}

/** Запоминаем ключи людей; ключ, отличный от виденного раньше, отмечаем — стоит сверить код. Возвращает сменившихся */
function noteKeys(users) {
  const seen = readScoped('seen', {});
  const changed = [];
  for (const u of users) {
    if (!u?.publicKey || u.id === state.me.id || seen[u.id] === u.publicKey) continue;
    if (seen[u.id]) {
      setKeyChanged(u.id, true);
      changed.push(u);
    }
    seen[u.id] = u.publicKey;
  }
  store.set(seenKeysStore(), seen);
  return changed;
}

/** Человек обновил профиль. Сменился его ключ — копии ключей переписок для него пропали: делимся заново.
    Сменился мой — значит, на другом устройстве создали новый: здесь его нужно восстановить по паролю */
function onUserKey(user) {
  if (!state.me || !user.publicKey || !e2eeReady()) return;
  if (user.id === state.me.id) {
    state.me.publicKey = user.publicKey;
    if (e2ee.identity.publicKey === user.publicKey) return;
    e2ee.identity = e2ee.privateKey = null;
    e2ee.convs.clear();
    if (!state.me?.hasPassword) { toast('Ключ шифрования этого аккаунта сохранён на другом устройстве.'); return; }
    return openKeyUnlock();
  }
  if (userById(user.id)?.publicKey === user.publicKey) return;
  for (const u of noteKeys([user])) toast(`У ${u.displayName} сменился ключ шифрования — сверьте код в его профиле`, 6000);
  fetchKeyHistory(user.id).then((items) => {
    if (items.length > 1) toast(`В истории ключей ${user.displayName}: ${items.length} записей. Проверьте последнюю смену.`, 8000);
  });
  for (const conv of [...e2ee.convs.keys()]) if (convMembersLocal(conv).includes(user.id)) refreshConv(conv);
}

/** Ключи переписки поменялись (поделились, сменили версию, изменился состав): перечитываем и делимся сами */
function refreshConv(conv) {
  if (!e2eeReady()) return;
  const used = e2ee.convs.has(conv);
  e2ee.convs.delete(conv);
  if (used) loadConv(conv).catch(() => {});
  redecryptAll(conv);
  // Голос большой комнаты зашифрован её ключом — сменился ключ, меняем и в разговоре
  const sfu = state.room?.session;
  if (sfu instanceof SfuSession && conv === roomConvOf(state.room.roomId))
    sendKey(conv).then(({ key }) => sfu.setKey(key), () => {});
}

/** Выход из аккаунта: ключи и расшифрованные файлы — из памяти */
function resetE2EE() {
  e2ee.identity = e2ee.privateKey = null;
  e2ee.convs.clear();
  for (const p of e2ee.files.values()) p.then(URL.revokeObjectURL, () => {});
  e2ee.files.clear();
  $('e2ee-setup').classList.add('hidden');
}

// ---------- Восстановление ключа паролем ----------

$('e2ee-unlock-btn').onclick = async () => {
  const password = $('e2ee-password').value;
  if (!password) return ($('e2ee-setup-error').textContent = 'Введите пароль аккаунта');
  $('e2ee-unlock-btn').disabled = true;
  $('e2ee-setup-error').textContent = '';
  lastKeyBackupError = '';
  try {
    if (keyUnlockMode === 'rebind' && e2eeReady()) {
      if (await uploadKeyBackup(password)) {
        $('e2ee-setup').classList.add('hidden');
        toast('Ключ сохранён под текущим паролем');
        return;
      }
      $('e2ee-setup-error').textContent = 'Неверный пароль аккаунта.';
      return;
    }
    await setupE2EE(password);
    if (e2eeReady()) {
      $('e2ee-setup').classList.add('hidden');
      toast('Ключ шифрования восстановлен');
    } else {
      $('e2ee-setup-error').textContent = lastKeyBackupError || 'Не удалось открыть резервную копию. Проверьте пароль.';
    }
  } catch (err) {
    $('e2ee-setup-error').textContent = err.message;
  } finally {
    $('e2ee-unlock-btn').disabled = false;
  }
};

$('e2ee-password').onkeydown = (e) => {
  if (e.key === 'Enter') $('e2ee-unlock-btn').click();
};
$('e2ee-later-btn').onclick = () => $('e2ee-setup').classList.add('hidden');
$('e2ee-restore-btn').onclick = () => openKeyUnlock('restore');
$('e2ee-rebind-btn').onclick = () => openKeyUnlock('rebind');

// ---------- Код проверки ключей в карточке профиля ----------

/** Код ключей с человеком: у вас и у него одинаковый — значит, ключи никто не подменил */
function keyCodeBox(user) {
  const box = document.createElement('div');
  box.className = 'pc-keycode';
  const code = document.createElement('div');
  code.className = 'pc-keycode-value';
  code.textContent = '…';
  E2EE.keyCode(e2ee.identity.publicKey, user.publicKey).then((c) => (code.textContent = c ? `${c.emoji.join(' ')}   ${c.digits}` : '—'));
  const hint = document.createElement('div');
  hint.className = 'muted small';
  hint.textContent = 'Сравните с кодом в его карточке — лично или в звонке. Совпадает — переписку никто не подменил.';
  box.append(code, hint);
  if (keyChanged(user.id)) {
    box.classList.add('changed');
    const warn = document.createElement('div');
    warn.className = 'pc-keycode-warn small';
    warn.textContent = `Ключ ${user.displayName} недавно сменился (новое устройство?) — сверьте код заново.`;
    fetchKeyHistory(user.id).then((items) => {
      if (items.length > 1) warn.textContent += ` В журнале ${items.length} смен ключа.`;
    });
    const ok = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: 'Код совпал' });
    ok.onclick = () => {
      setKeyChanged(user.id, false);
      box.classList.remove('changed');
      warn.remove();
      ok.remove();
    };
    box.append(warn, ok);
  }
  return box;
}
