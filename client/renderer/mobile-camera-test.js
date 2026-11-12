// Проверка камеры на телефоне: только превью и переключение фронт/тыл.
// Никакого списка устройств и выбора «камеры по умолчанию».
(() => {
  let overlay = null;
  let video = null;
  let state = null;
  let toggle = null;
  let stream = null;
  let facing = 'user';
  let request = 0;
  let open = false;

  const stop = () => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (video) video.srcObject = null;
  };

  const start = async () => {
    const my = ++request;
    stop();
    if (!navigator.mediaDevices?.getUserMedia) {
      state.textContent = 'Камера недоступна в этом WebView';
      return;
    }
    state.textContent = (facing === 'user' ? 'Фронтальная' : 'Тыловая') + ' · запрашиваем доступ…';
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing } },
        audio: false,
      });
      if (!open || my !== request) {
        next.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = next;
      video.srcObject = next;
      state.textContent = (facing === 'user' ? 'Фронтальная' : 'Тыловая') + ' · камера включена';
      toggle.textContent = 'Переключить на ' + (facing === 'user' ? 'тыловую' : 'фронтальную');
    } catch (err) {
      state.textContent = err?.name === 'NotAllowedError'
        ? 'Нет доступа к камере. Разрешите его в настройках Android.'
        : 'Не удалось включить камеру';
    }
  };

  const close = () => {
    open = false;
    request += 1;
    stop();
    overlay?.remove();
    overlay = null;
    video = state = toggle = null;
  };

  const build = () => {
    overlay = document.createElement('div');
    overlay.id = 'mobile-camera-test';
    overlay.className = 'm-camera-test';
    const head = document.createElement('header');
    head.className = 'm-camera-test__head';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'm-camera-test__back';
    back.setAttribute('aria-label', 'Назад');
    back.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>';
    back.onclick = close;
    const title = document.createElement('b');
    title.textContent = 'Проверка камеры';
    head.append(back, title);
    const body = document.createElement('div');
    body.className = 'm-camera-test__body';
    video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.className = 'm-camera-test__video';
    state = document.createElement('p');
    state.className = 'm-camera-test__state';
    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'm-camera-test__toggle';
    toggle.onclick = () => {
      facing = facing === 'user' ? 'environment' : 'user';
      start();
    };
    body.append(video, state, toggle);
    overlay.append(head, body);
    document.body.append(overlay);
    open = true;
    start();
  };

  window.mobileCameraTest = {
    open() {
      if (typeof closeCameraPicker === 'function') closeCameraPicker();
      if (!open) build();
    },
    close,
    isOpen: () => open,
  };

  // Старый обработчик cam-test-btn открывал список устройств. Перехватываем
  // до него: на телефоне это должна быть проверка с переключением фронт/тыл.
  document.addEventListener('click', (event) => {
    if (!event.target.closest?.('#cam-test-btn')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.mobileCameraTest.open();
  }, true);
})();
