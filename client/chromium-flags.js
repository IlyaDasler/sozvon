// Переключатели Chromium для всего приложения — их же включают сквозные тесты, чтобы мерить то, что получит человек.
// disable-accelerated-video-encode: на части ПК (замер на ПК разработки, Electron 45) опрос аппаратного кодировщика
// в начале звонка трижды роняет процесс видеокарты, и Chromium отключает её всему приложению — интерфейс без
// ускорения, свой захват экрана не принимается. Трансляцию и камеру мы и так кодируем программно (VP9/VP8).
function applyChromiumFlags(app) {
  app.commandLine.appendSwitch('disable-accelerated-video-encode');
}

module.exports = { applyChromiumFlags };
