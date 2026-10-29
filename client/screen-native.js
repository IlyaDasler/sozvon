// Трансляция монитора своим захватом (native/capture). Chromium снимает кадр 3440×1440 ~20 мс — потолок ~51 к/с;
// модуль берёт его у Windows за 2,5 мс и уменьшает на видеокарте. Кадры идут в окно общей текстурой (sharedTexture),
// без копирования через процессор; там из них собирается дорожка для WebRTC.
// Окно приложения как источник, другая ОС, модуль не собран или первый кадр не дошёл (две видеокарты) — null,
// и окно снимает экран по-старому, через Chromium.
const { ipcMain, screen, sharedTexture } = require('electron');
const capture = require('./native/capture');
const { fitSize } = require('./screen-size');

const FIRST_FRAME_MS = 2000;
const MAX_IN_FLIGHT = 2; // окно не успевает — лишние кадры не копим

let session = null;
let sessionId = 0;

/** Монитор Windows для источника «screen:…» — по прямоугольнику в физических пикселях */
function outputFor(source) {
  const display = screen.getAllDisplays().find((d) => String(d.id) === String(source.display_id));
  if (!display) return null;
  const r = screen.dipToScreenRect(null, display.bounds);
  return capture.outputs().find((o) => o.left === r.x && o.top === r.y) || null;
}

/** Свой захват не вышел — окно снимет экран через Chromium; почему — в журнал */
function fallback(reason) {
  console.warn('Свой захват не используется:', reason);
  return Promise.resolve(null);
}

function stop() {
  session?.stop();
  session = null;
}

/** Запустить захват монитора в окно frame; { width, height, id } — когда первый кадр дошёл, иначе null */
function start(frame, source, mode) {
  stop();
  if (!capture || !sharedTexture) return fallback('модуль захвата недоступен');
  if (!source?.id.startsWith('screen:')) return fallback('выбран не монитор');
  const output = outputFor(source);
  if (!output) return fallback(`монитор ${source.display_id} не найден среди ${JSON.stringify(capture.outputs())}`);
  const size = fitSize({ width: output.right - output.left, height: output.bottom - output.top }, mode);
  return new Promise((resolve) => {
    let inFlight = 0;
    let first = true;
    const done = (result) => {
      if (!first) return;
      first = false;
      clearTimeout(timer);
      if (!result) stop();
      resolve(result);
    };
    let current;
    try {
      current = capture.start({ output: output.index, width: size.width, height: size.height, fps: mode.fps }, async (slot, handle, timestamp) => {
        if (session !== current || inFlight >= MAX_IN_FLIGHT || frame.isDestroyed()) return current.release(slot);
        inFlight++;
        try {
          const imported = sharedTexture.importSharedTexture({
            textureInfo: { pixelFormat: 'bgra', codedSize: size, visibleRect: { x: 0, y: 0, ...size }, timestamp, handle: { ntHandle: handle } },
            allReferencesReleased: () => current.release(slot),
          });
          await sharedTexture.sendSharedTexture({ frame, importedSharedTexture: imported });
          imported.release();
          done({ ...size, id });
        } catch (err) {
          current.release(slot);
          console.warn('Свой захват: кадр не передан —', err.message);
          done(null);
        } finally {
          inFlight--;
        }
      });
    } catch (err) {
      return resolve(fallback(err.message)); // Windows не дала захватить монитор
    }
    session = current;
    const id = ++sessionId;
    const timer = setTimeout(() => {
      console.warn('Свой захват: первый кадр не дошёл за', FIRST_FRAME_MS, 'мс');
      done(null);
    }, FIRST_FRAME_MS);
  });
}

/** chosenSource() — источник, который человек выбрал в окне выбора экрана */
function registerNativeScreen(chosenSource) {
  ipcMain.handle('screen:native-start', (event, mode) => start(event.senderFrame, chosenSource(), mode));
  // Остановить только свой захват: при смене окна на ходу новый уже запущен, старая дорожка его не трогает
  ipcMain.handle('screen:native-stop', (_event, id) => id === sessionId && stop());
}

module.exports = { registerNativeScreen };
