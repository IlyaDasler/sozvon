// Окно «Выберите область»: фото профиля и картинка канала. Картинку тянут мышью, колесо и ползунок увеличивают.
// askCrop(bitmap, { title, round }) → Promise: квадрат { x, y, side } в пикселях картинки или null, если передумали.

const CROP_STAGE = 300;
let cropView = null;
let cropBitmap = null;
let cropDone = null;

function drawCrop() {
  const { x, y, side } = cropRect(cropView);
  const ctx = $('crop-stage').getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, CROP_STAGE, CROP_STAGE);
  ctx.drawImage(cropBitmap, x, y, side, side, 0, 0, CROP_STAGE, CROP_STAGE);
  $('crop-zoom').value = cropView.zoom;
}

function askCrop(bitmap, { title, round }) {
  closeCrop(null);
  cropBitmap = bitmap;
  cropView = startCrop(bitmap.width, bitmap.height);
  $('crop-title').textContent = title;
  $('crop-box').classList.toggle('round', round);
  $('crop-zoom').max = CROP_MAX_ZOOM;
  $('crop').classList.remove('hidden');
  drawCrop();
  return new Promise((resolve) => (cropDone = resolve));
}

function closeCrop(result) {
  if (!cropDone) return;
  const done = cropDone;
  cropDone = null;
  $('crop').classList.add('hidden');
  done(result);
}

function moveCrop(view) {
  cropView = view;
  drawCrop();
}

const cropOpen = () => Boolean(cropDone);

$('crop-stage').width = $('crop-stage').height = CROP_STAGE;
$('crop-ok').onclick = () => closeCrop(cropRect(cropView));
$('crop-cancel').onclick = () => closeCrop(null);
$('crop').onclick = (e) => e.target === $('crop') && closeCrop(null);
$('crop-zoom').oninput = (e) => moveCrop(zoomCrop(cropView, Number(e.target.value)));
$('crop-stage').addEventListener('wheel', (e) => {
  e.preventDefault();
  moveCrop(zoomCrop(cropView, cropView.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
}, { passive: false });
$('crop-stage').addEventListener('pointerdown', (e) => {
  const stage = e.currentTarget;
  let { clientX: lastX, clientY: lastY } = e;
  stage.setPointerCapture?.(e.pointerId);
  const move = (m) => {
    moveCrop(panCrop(cropView, m.clientX - lastX, m.clientY - lastY, stage.clientWidth));
    lastX = m.clientX;
    lastY = m.clientY;
  };
  const up = () => {
    stage.removeEventListener('pointermove', move);
    stage.removeEventListener('pointerup', up);
    stage.removeEventListener('pointercancel', up);
  };
  stage.addEventListener('pointermove', move);
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
});
