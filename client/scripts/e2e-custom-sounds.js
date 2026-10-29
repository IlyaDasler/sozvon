// Свои звуки: файл вместо стандартного звука (звонок, уведомление, вход в голос…) — играет, переживает
// перезапуск, сбрасывается; слишком длинный файл не принимается.
// Запуск (сервер должен работать): npx electron scripts/e2e-custom-sounds.js [адрес сервера]
const { register, js, waitFor, sleep, openClient, runTest } = require('./e2e-lib');

// WAV с синусом заданной длины — как будто человек выбрал свой файл
const wavFile = (seconds, name) => `(() => {
  const rate = 22050, n = Math.round(rate * ${seconds}), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / 8) * 12000, true);
  return new File([buf], '${name}', { type: 'audio/wav' });
})()`;

runTest(async () => {
  const a = await register('snd', 'Илья');
  const win = await openClient('snd', a);
  await js(win, `openSettings('audio'); true`);
  await waitFor(win, `Boolean(document.querySelector('#custom-sounds [data-sound="notify"]'))`, 'список своих звуков в настройках');

  // Свой звук уведомления: строка показывает имя файла, уведомление играет его
  await js(win, `saveCustomSound('notify', ${wavFile(1, 'дзынь.wav')}).then(() => true)`);
  await waitFor(win, `document.querySelector('#custom-sounds [data-sound="notify"]').textContent.includes('дзынь.wav')`, 'имя своего файла');
  await js(win, `tone.blip('notify'); true`);
  if ((await js(win, 'tone.lastPlayed')) !== 'custom:notify') throw new Error('Играет стандартный звук, а не свой');
  await js(win, `tone.blip('join'); true`);
  if ((await js(win, 'tone.lastPlayed')) !== 'pattern:join') throw new Error('Свой звук попал не туда');
  console.log('✔ свой звук уведомления играет вместо стандартного, остальные — свои');

  // Переживает перезапуск
  await js(win, 'location.reload(); true');
  await sleep(800);
  await waitFor(win, `document.getElementById('conn-dot').classList.contains('ok') && customSounds.has('notify')`, 'свои звуки после перезапуска');
  await js(win, `tone.blip('notify'); true`);
  if ((await js(win, 'tone.lastPlayed')) !== 'custom:notify') throw new Error('Свой звук пропал после перезапуска');
  console.log('✔ свой звук сохраняется после перезапуска');

  // Слишком длинный не берём; «Стандартный» возвращает свой звук приложения
  const err = await js(win, `saveCustomSound('ring', ${wavFile(40, 'песня.wav')}).then(() => '', (e) => e.message)`);
  if (!/30 секунд/.test(err)) throw new Error(`Длинный файл принят: «${err}»`);
  await js(win, `openSettings('audio'); true`);
  await waitFor(win, `Boolean(document.querySelector('#custom-sounds [data-sound="notify"] .sound-reset'))`, 'кнопка «Стандартный»');
  await js(win, `document.querySelector('#custom-sounds [data-sound="notify"] .sound-reset').click(); true`);
  await waitFor(win, `!customSounds.has('notify')`, 'свой звук сброшен');
  await js(win, `tone.blip('notify'); true`);
  if ((await js(win, 'tone.lastPlayed')) !== 'pattern:notify') throw new Error('После сброса играет не стандартный звук');
  console.log('✔ длинный файл не принимается, «Стандартный» возвращает звук приложения');
});
