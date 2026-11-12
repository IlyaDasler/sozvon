// T1: отправка личного сообщения в новом мобильном слое.
const { api, befriend, register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('tsa' + Date.now().toString(36).slice(-4), 'Аня');
  const b = await register('tsb' + Date.now().toString(36).slice(-4), 'Боря');
  await befriend(a, b);
  const w = await openClient('tsb', b);
  w.setSize(411, 960); w.show(); w.focus();
  await sleep(700);
  await js(w, `localStorage.setItem('sozvon.mobileShell','1'); location.reload(); true`);
  await sleep(1800);
  const rows = await js(w, `document.querySelectorAll('.m-row--contact').length`);
  console.log('m-send-rows', rows);
  if (!rows) throw new Error('нет контактов в новом слое');
  await js(w, `document.querySelector('.m-row--contact').click(); true`);
  await sleep(700);
  const hasComposer = await js(w, `!!document.querySelector('.m-composer__input')`);
  if (!hasComposer) throw new Error('нет композера');
  const text = 'тест нового слоя ' + Date.now().toString(36);
  await js(w, `(() => { const i=document.querySelector('.m-composer__input'); i.value=${JSON.stringify(text)}; i.closest('form').requestSubmit(); return true; })()`);
  await sleep(1400);
  const ui = JSON.parse(await js(w, `JSON.stringify({val:document.querySelector('.m-composer__input')?.value,bubbles:document.querySelectorAll('.m-msg').length,text:document.getElementById('m-app').innerText.includes(${JSON.stringify(text)})})`));
  console.log('m-send-ui', JSON.stringify(ui));
  // Серверный GET требует отдельного собеседника; для T1 проверяем UI-отправку.
  if (!ui.text) throw new Error('сообщение не появилось в интерфейсе');
  if (ui.val !== '') throw new Error('поле не очистилось');
});
