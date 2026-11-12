// Проверка камеры в мобильном слое: без выбора устройств, только переключение фронт/тыл.
const FACING = [
  { id: 'user', label: 'Фронтальная' },
  { id: 'environment', label: 'Тыловая' },
];

export function mountCamera(container, { onBack }) {
  const bar = document.createElement('header');
  bar.className = 'm-topbar';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'm-iconbtn';
  back.setAttribute('aria-label', 'Назад');
  back.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>';
  const title = document.createElement('h1');
  title.className = 'm-topbar__title';
  title.textContent = 'Проверка камеры';
  bar.append(back, title);

  const screen = document.createElement('main');
  screen.className = 'm-screen m-screen--camera';
  const video = document.createElement('video');
  video.className = 'm-camera';
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  const state = document.createElement('p');
  state.className = 'm-camera__state';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'm-btn m-btn--primary m-camera__toggle';
  const shot = document.createElement('div');
  shot.className = 'm-camera__body';
  shot.append(video, state);
  screen.append(shot, toggle);
  container.replaceChildren(bar, screen);

  let stream = null;
  let facing = 'user';
  let stopped = false;
  let request = 0;

  const stop = () => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
  };

  const start = async (next) => {
    facing = next || facing;
    const my = ++request;
    stop();
    const label = FACING.find((x) => x.id === facing)?.label || '';
    toggle.textContent = 'Переключить на ' + (facing === 'user' ? 'тыловую' : 'фронтальную');
    state.textContent = label + ' · запрашиваем доступ…';
    if (!navigator.mediaDevices?.getUserMedia) {
      state.textContent = 'Камера недоступна в этом WebView';
      return;
    }
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing } },
        audio: false,
      });
      if (stopped || my !== request) {
        nextStream.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = nextStream;
      video.srcObject = nextStream;
      state.textContent = label + ' · камера включена';
    } catch (err) {
      if (stopped) return;
      state.textContent = err?.name === 'NotAllowedError'
        ? 'Нет доступа к камере. Разрешите его в настройках Android.'
        : 'Не удалось включить камеру';
    }
  };

  back.onclick = () => {
    stopped = true;
    request += 1;
    stop();
    onBack?.();
  };
  toggle.onclick = () => start(facing === 'user' ? 'environment' : 'user');
  start('user');

  return () => {
    stopped = true;
    request += 1;
    stop();
  };
}
