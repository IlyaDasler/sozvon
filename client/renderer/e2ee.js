// Сквозное шифрование переписки в приложении: свой ключ, ключи переписок, отправка и расшифровка.
// Шифры и ключи — в e2ee-crypto.js; здесь — когда и что с ними делать.
// - Свой ключ создаётся при первом входе. Для аккаунтов с паролем он автоматически сохраняется
//   на сервере запечатанным паролем; на новом устройстве вход тем же паролем открывает его сам.
//   Ручной код переноса остаётся только запасным путём: OAuth без пароля, сброс пароля без локального ключа.
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

const identityStoreKey = () => scopedKey('identity');
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

async function useIdentity(identity) {
  e2ee.identity = identity;
  e2ee.privateKey = await E2EE.importPrivate(identity.privateJwk);
  e2ee.convs.clear();
  $('e2ee-setup').classList.add('hidden');
  redecryptAll();
}

async function publishIdentity(identity) {
  state.me = await Api.put('/me/key', { publicKey: identity.publicKey });
}

/** При входе: свой ключ есть и совпадает — работаем; нет нигде — создаём; на сервере другой — спрашиваем */
async function fetchKeyBackup(password) {
  if (!password || !state.me?.hasPassword) return null;
  try {
    return await Api.post('/key-backup/read', { password });
  } catch (err) {
    if (err.status !== 404) console.warn('Резервная копия ключа:', err.message);
    return null;
  }
}

/** Сохранить ключ профиля на сервере, запечатав его паролем. Сервер не может его открыть. */
async function uploadKeyBackup(identity, password) {
  if (!password || !identity || !state.me?.hasPassword) return false;
  try {
    const blob = await E2EE.wrapKeyBackup(identity, password, state.me.id);
    await Api.put('/key-backup', { password, ...blob });
    return true;
  } catch (err) {
    console.warn('Не удалось сохранить резервную копию ключа:', err.message);
    return false;
  }
}

/** Смена пароля: старый blob больше не откроется, сразу перезапечатываем текущий ключ. */
async function backupKeyWithPassword(password) {
  return uploadKeyBackup(e2ee.identity, password);
}

async function setupE2EE(password = '') {
  const local = readScoped('identity', null);
  const server = state.me.publicKey;
  try {
    // Пароль есть только в момент входа. По нему открываем серверную копию
    // автоматически — без кодов переноса и второго устройства.
    if (password && state.me.hasPassword) {
      const backup = await fetchKeyBackup(password);
      let fromBackup = null;
      if (backup?.ct) {
        try {
          fromBackup = await E2EE.unwrapKeyBackup(backup, password, state.me.id);
        } catch {
          // Пароль сменили сбросом: старую копию открыть нечем.
        }
      }
      if (fromBackup?.publicKey && (!server || server === fromBackup.publicKey)) {
        store.set(identityStoreKey(), fromBackup);
        await useIdentity(fromBackup);
        if (!server) await publishIdentity(fromBackup);
        return;
      }
      if (local && (!server || server === local.publicKey)) {
        await useIdentity(local);
        if (!server) await publishIdentity(local);
        // Обновляем/создаём копию: при следующем входе новое устройство
        // подхватит ключ само.
        await uploadKeyBackup(local, password);
        return;
      }
      if (!local && !server) {
        const identity = await E2EE.generateIdentity();
        store.set(identityStoreKey(), identity);
        await useIdentity(identity);
        await publishIdentity(identity);
        await uploadKeyBackup(identity, password);
        return;
      }
    }
    // OAuth без пароля или сброс без локального ключа: остаётся ручной перенос.
    if (local && (!server || server === local.publicKey)) {
      await useIdentity(local);
      if (!server) await publishIdentity(local);
    } else if (!local && !server) {
      const identity = await E2EE.generateIdentity();
      store.set(identityStoreKey(), identity);
      await useIdentity(identity);
      await publishIdentity(identity);
    } else {
      openKeySetup(local ? 'changed' : 'elsewhere');
    }
  } catch (err) {
    toast(`Шифрование: ${err.message}`);
  }
}

function openKeySetup(reason) {
  $('e2ee-setup-text').textContent =
    reason === 'changed'
      ? 'Ключ шифрования вашего аккаунта сменили на другом устройстве. Перенесите его сюда кодом — тогда здесь можно будет читать новую переписку.'
      : 'У вашего аккаунта уже есть ключ шифрования на другом устройстве. Перенесите его сюда кодом — тогда здесь будет видна вся зашифрованная переписка.';
  $('e2ee-code').value = '';
  $('e2ee-setup-error').textContent = '';
  $('e2ee-setup').classList.remove('hidden');
  $('e2ee-code').focus();
}

/** Перенос ключа: код с другого устройства → забираем зашифрованный ключ и открываем его кодом */
async function receiveTransfer(code) {
  const { blob } = await Api.get(`/key-transfer/${await E2EE.transferId(code)}`);
  const identity = await E2EE.unwrapIdentity(blob, code).catch(() => {
    throw new Error('Код не подошёл — проверьте его');
  });
  store.set(identityStoreKey(), identity);
  await useIdentity(identity);
  if (state.me.publicKey !== identity.publicKey) await publishIdentity(identity);
}

/** Новый ключ: старая зашифрованная переписка на этом устройстве станет недоступна, новую ключи раздадут заново */
async function resetIdentity() {
  const identity = await E2EE.generateIdentity();
  store.set(identityStoreKey(), identity);
  await publishIdentity(identity);
  await useIdentity(identity);
}

/** Код для переноса ключа на другое устройство: ключ, зашифрованный кодом, сервер хранит 10 минут */
async function startTransfer() {
  const code = E2EE.makeTransferCode();
  await Api.post('/key-transfer', { id: await E2EE.transferId(code), blob: await E2EE.wrapIdentity(e2ee.identity, code) });
  return code;
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
        c.keys.set(Number(epoch), await E2EE.open(sealed, e2ee.privateKey));
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
async function encryptOutgoing(conv, { text, files = [], preview = null, reply = null, forward = null, eventId = null }) {
  if (!e2eeReady()) throw new Error('Сначала настройте шифрование на этом устройстве');
  const { epoch, key } = await sendKey(conv);
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
async function decryptMessages(list, conv) {
  const encrypted = list.filter((m) => m.enc && !m.plain);
  if (!encrypted.length) return;
  if (!e2eeReady()) {
    for (const m of encrypted) m.locked = 'no-identity';
    return;
  }
  let c = await loadConv(conv).catch(() => null);
  // Ключа нужной версии нет — возможно, им только что поделились: перечитываем один раз
  if (c && encrypted.some((m) => !c.keys.has(m.enc.epoch))) {
    e2ee.convs.delete(conv);
    c = await loadConv(conv).catch(() => null);
  }
  await Promise.all(
    encrypted.map(async (m) => {
      const key = c?.keys.get(m.enc.epoch);
      if (!key) return (m.locked = 'no-key');
      try {
        m.plain = await E2EE.decryptMessage(key, m.enc, { conv, epoch: m.enc.epoch, from: m.fromId });
        delete m.locked;
      } catch {
        m.locked = 'broken';
      }
    })
  );
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
    Сменился мой — значит, на другом устройстве создали новый: здесь его нужно перенести */
function onUserKey(user) {
  if (!state.me || !user.publicKey || !e2eeReady()) return;
  if (user.id === state.me.id) {
    state.me.publicKey = user.publicKey;
    if (e2ee.identity.publicKey === user.publicKey) return;
    e2ee.identity = e2ee.privateKey = null;
    e2ee.convs.clear();
    return openKeySetup('changed');
  }
  if (userById(user.id)?.publicKey === user.publicKey) return;
  for (const u of noteKeys([user])) toast(`У ${u.displayName} сменился ключ шифрования — сверьте код в его профиле`, 6000);
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

// ---------- Окно настройки ключа ----------

$('e2ee-transfer-btn').onclick = async () => {
  const code = $('e2ee-code').value.trim();
  if (!code) return ($('e2ee-setup-error').textContent = 'Введите код с другого устройства');
  $('e2ee-transfer-btn').disabled = true;
  try {
    await receiveTransfer(code);
    toast('Ключ шифрования перенесён');
  } catch (err) {
    $('e2ee-setup-error').textContent = err.message;
  } finally {
    $('e2ee-transfer-btn').disabled = false;
  }
};

$('e2ee-later-btn').onclick = () => $('e2ee-setup').classList.add('hidden');

// Поле кода: буквы-цифры, регистр не важен, автоматом ставим дефисы по 4 символа.
// Так видно, что ввод доходит, и вставленный код сразу выглядит как на другом устройстве
const CODE_CHARS = 16;
function formatTransferCode(raw) {
  const clean = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_CHARS);
  return clean.match(/.{1,4}/g)?.join('-') ?? '';
}
const codeInput = $('e2ee-code');
codeInput.oninput = () => {
  const caretAtEnd = codeInput.selectionStart === codeInput.value.length;
  const next = formatTransferCode(codeInput.value);
  if (next !== codeInput.value) {
    codeInput.value = next;
    if (caretAtEnd) codeInput.setSelectionRange(next.length, next.length);
  }
};
// На macOS клик по полю иногда не отдаёт фокус (окно без рамки) — фокусируем явно
codeInput.onmousedown = (e) => {
  e.preventDefault();
  codeInput.focus();
  codeInput.select();
};

$('e2ee-paste-btn').onclick = async () => {
  let text = '';
  try {
    text = (await window.desktop?.paste?.()) ?? '';
  } catch {}
  // Запасной путь для веб-версии: обычное чтение буфера браузером
  if (!text) {
    try {
      text = await navigator.clipboard.readText();
    } catch {}
  }
  if (!text.trim()) {
    $('e2ee-setup-error').textContent = 'В буфере нет кода — скопируйте его на другом устройстве';
    return;
  }
  codeInput.value = text.trim();
  codeInput.oninput();
  $('e2ee-setup-error').textContent = '';
  codeInput.focus();
};

codeInput.onkeydown = (e) => e.key === 'Enter' && $('e2ee-transfer-btn').click();

// Настройки → Аккаунт: показать код для нового устройства (или ввести код, если ключа здесь ещё нет)
$('e2ee-share-btn').onclick = async () => {
  if (!e2eeReady()) return openKeySetup('elsewhere');
  $('e2ee-share-btn').disabled = true;
  try {
    $('e2ee-share-code').textContent = await startTransfer();
    $('e2ee-share-code').classList.remove('hidden');
    $('e2ee-share-hint').textContent = 'Введите этот код на новом устройстве в течение 10 минут. Код одноразовый — никому его не показывайте.';
  } catch (err) {
    $('e2ee-share-hint').textContent = err.message;
  } finally {
    $('e2ee-share-btn').disabled = false;
  }
};

$('e2ee-reset-btn').onclick = async () => {
  const ok = await ask(
    'Зашифрованная переписка до этого момента на этом устройстве станет недоступна, а на другом устройстве понадобится перенести новый ключ. Новую переписку ключи раздадут заново.',
    { title: 'Создать новый ключ?', ok: 'Создать новый ключ', danger: true }
  );
  if (!ok) return;
  try {
    await resetIdentity();
    toast('Создан новый ключ шифрования');
  } catch (err) {
    $('e2ee-setup-error').textContent = err.message;
  }
};

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
