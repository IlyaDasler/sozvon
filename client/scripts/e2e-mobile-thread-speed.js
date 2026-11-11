// Скорость открытия треда: панель должна стать непрозрачной и полноэкранной
// сразу по клику, не дожидаясь сети/расшифровки.
const { api, register, js, sleep, openClient, runTest, waitFor } = require('./e2e-lib');

runTest(async () => {
  const a = await register('ts' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Скорость' }, a.token);
  const room = await api('POST', '/rooms', { name: 'Чат', kind: 'text', hubId: hub.id }, a.token);
  const msg = await api('POST', `/rooms/${room.id}/messages`, { text: 'корень' }, a.token);

  const w = await openClient('ts', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  await waitFor(w, `e2eeReady()`, 'ключ');
  await js(w, `openHub(${hub.id}); selectRoom(${room.id}); true`);
  await sleep(600);

  // Задерживаем сеть треда на 1.2 с и смотрим, что видно через 50 мс.
  await js(w, `(() => {
    const orig = Api.get.bind(Api);
    Api.get = (url, ...rest) => url.includes('/thread') ? new Promise((res, rej) => setTimeout(() => orig(url, ...rest).then(res, rej), 1200)) : orig(url, ...rest);
    openThread({ id: ${msg.id}, roomId: ${room.id}, threadRoot: ${msg.id} }, { roomId: ${room.id} });
    return true;
  })()`);
  await sleep(50);
  const early = JSON.parse(await js(w, `(() => {
    const p = document.getElementById('thread-panel');
    const r = p.getBoundingClientRect();
    const cs = getComputedStyle(p);
    return JSON.stringify({
      open: p.classList.contains('thread-open'),
      hidden: p.classList.contains('hidden'),
      pos: cs.position,
      w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight,
      blur: cs.backdropFilter || cs.webkitBackdropFilter,
      bg: cs.backgroundColor,
    });
  })()`));
  console.log('thread-early', JSON.stringify(early));
  if (!early.open || early.hidden) throw new Error('панель треда не открылась сразу');
  if (early.pos !== 'fixed' || Math.abs(early.w - early.vw) > 2 || Math.abs(early.h - early.vh) > 2) throw new Error('панель не полноэкранная сразу: ' + JSON.stringify(early));
  if (early.blur && early.blur !== 'none') throw new Error('blur остался при открытии: ' + early.blur);
  if (/rgba\(0, 0, 0, 0\)|transparent/.test(early.bg)) throw new Error('фон прозрачный при открытии: ' + early.bg);

  await waitFor(w, `document.querySelectorAll('#thread-list .msg').length > 0`, 'сообщения треда', 5000);
  await js(w, `closeThread(); true`);
  await sleep(200);

  // Повторное открытие из кэша — сообщения должны быть сразу.
  await js(w, `openThread({ id: ${msg.id}, roomId: ${room.id}, threadRoot: ${msg.id} }, { roomId: ${room.id} }); true`);
  await sleep(60);
  const cached = await js(w, `document.querySelectorAll('#thread-list .msg').length`);
  console.log('thread-cached-msgs', cached);
  if (cached < 1) throw new Error('повторное открытие не показало сообщения из кэша');
});
