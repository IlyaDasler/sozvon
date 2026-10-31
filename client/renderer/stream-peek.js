// Карточка трансляции в списке голоса: кадр, «В ЭФИРЕ» и кнопка «Смотреть трансляцию».
// Показывающий раз в несколько секунд отдаёт серверу маленький кадр; сервер держит его
// только в памяти и только пока идёт показ. Сама трансляция по-прежнему идёт лишь тем, кто смотрит.

const PREVIEW_WIDTH = 320;
const PREVIEW_HEIGHT = 180;
const PREVIEW_QUALITY = 0.6;
const PREVIEW_FIRST_MS = 1500;
const PREVIEW_EVERY_MS = 10_000;
const PEEK_REFRESH_MS = 5000;
const PEEK_HIDE_MS = 200;

// ---------- Показывающий: кадры ----------

let previewTrack = null;
let previewVideo = null;
let previewTimer = null;

function stopPreviews() {
  clearTimeout(previewTimer);
  previewTrack = null;
  previewVideo = null;
}

async function sendPreview(roomId) {
  const canvas = document.createElement('canvas');
  canvas.width = PREVIEW_WIDTH;
  canvas.height = PREVIEW_HEIGHT;
  const ctx = canvas.getContext('2d');
  const { videoWidth: w, videoHeight: h } = previewVideo;
  if (!w) return;
  const scale = Math.min(PREVIEW_WIDTH / w, PREVIEW_HEIGHT / h);
  ctx.drawImage(previewVideo, (PREVIEW_WIDTH - w * scale) / 2, (PREVIEW_HEIGHT - h * scale) / 2, w * scale, h * scale);
  socket?.send({ type: 'room:preview', roomId, image: canvas.toDataURL('image/jpeg', PREVIEW_QUALITY) });
}

function previewTick() {
  const track = state.room?.joined ? state.room.session.local.tracks.screen : null;
  if (track !== previewTrack) return syncPreviews();
  sendPreview(state.room.roomId);
  previewTimer = setTimeout(previewTick, PREVIEW_EVERY_MS);
}

/** Показ начался, сменился или закончился: вызывается при каждом обновлении голоса */
function syncPreviews() {
  const track = state.room?.joined ? state.room.session.local.tracks.screen || null : null;
  if (track === previewTrack) return;
  stopPreviews();
  if (!track) return;
  previewTrack = track;
  previewVideo = Object.assign(document.createElement('video'), { muted: true, srcObject: new MediaStream([track]) });
  previewVideo.play().catch(() => {});
  previewTimer = setTimeout(previewTick, PREVIEW_FIRST_MS);
}

// ---------- Зритель: карточка ----------

let peek = null; // { roomId, userId }
let peekHideTimer = null;
let peekRefresh = null;

const peekLive = () => {
  if (!peek) return false;
  return Boolean(roomById(peek.roomId)?.voice?.some((p) => p.userId === peek.userId && p.screen));
};

function askPreview() {
  socket?.send({ type: 'room:preview:get', roomId: peek.roomId, userId: peek.userId });
}

function hideStreamPeek() {
  clearTimeout(peekHideTimer);
  clearInterval(peekRefresh);
  peek = null;
  $('stream-peek').classList.add('hidden');
}

function showStreamPeek(item, roomId, userId) {
  clearTimeout(peekHideTimer);
  if (peek?.roomId === roomId && peek.userId === userId) return;
  hideStreamPeek();
  peek = { roomId, userId };
  const box = $('stream-peek');
  const image = $('stream-peek-image');
  image.removeAttribute('src');
  image.classList.add('hidden');
  $('stream-peek-empty').classList.remove('hidden');
  $('stream-peek-watch').classList.toggle('hidden', !can(roomById(roomId), PERMS.connect));
  box.classList.remove('hidden');
  const r = item.getBoundingClientRect();
  const size = box.getBoundingClientRect();
  box.style.left = `${Math.min(r.right + 12, innerWidth - size.width - 8)}px`;
  box.style.top = `${Math.max(8, Math.min(r.top - 12, innerHeight - size.height - 8))}px`;
  askPreview();
  peekRefresh = setInterval(askPreview, PEEK_REFRESH_MS);
}

function onRoomPreview(msg) {
  if (peek?.roomId !== msg.roomId || peek.userId !== msg.userId || !msg.image) return;
  const image = $('stream-peek-image');
  image.src = msg.image;
  image.classList.remove('hidden');
  $('stream-peek-empty').classList.add('hidden');
}

/** Показ закончился, пока карточка открыта */
function syncStreamPeek() {
  if (peek && !peekLive()) hideStreamPeek();
}

const hidePeekSoon = () => {
  clearTimeout(peekHideTimer);
  peekHideTimer = setTimeout(hideStreamPeek, PEEK_HIDE_MS);
};

// Слушаем весь список: он перерисовывается, пока мышь стоит на человеке
$('room-list').addEventListener('mouseover', (e) => {
  const item = e.target.closest('[data-live-room]');
  if (item) showStreamPeek(item, Number(item.dataset.liveRoom), Number(item.dataset.voiceUser));
  else if (peek) hidePeekSoon();
});
$('room-list').addEventListener('mouseleave', () => peek && hidePeekSoon());
$('stream-peek').addEventListener('mouseenter', () => clearTimeout(peekHideTimer));
$('stream-peek').addEventListener('mouseleave', hidePeekSoon);

$('stream-peek-watch').onclick = async () => {
  const { roomId, userId } = peek;
  hideStreamPeek();
  await joinRoomVoice(roomId);
  if (state.room?.roomId !== roomId) return;
  selectRoom(roomId);
  state.room.session.setWatching(userId, true);
};
