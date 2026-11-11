// Вложение в личном чате: файл выбирается, загружается и отправляется.
const { befriend, register, js, sleep, openClient, runTest, waitFor } = require('./e2e-lib');

runTest(async () => {
  const a = await register('at' + Date.now().toString(36).slice(-4), 'Аня');
  const b = await register('atb' + Date.now().toString(36).slice(-4), 'Боря');
  await befriend(a, b);
  const w = await openClient('at', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  await js(w, `selectContact(${b.user.id}); true`);
  await sleep(700);

  await js(w, `(() => {
    const input = document.querySelector('#chat .composer input[type="file"]');
    const file = new File(['hello attachment'], 'test-attach.txt', { type: 'text/plain' });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor(w, `Boolean(document.querySelector('#message-form .file-chip:not(.error)'))`, 'файл прикрепился', 8000);
  await waitFor(w, `dmComposer.files.length > 0 && dmComposer.files.every((f) => f.attachment)`, 'файл загрузился', 15000);
  console.log('attachment-chip');

  await js(w, `document.getElementById('message-form').requestSubmit(); true`);
  await waitFor(w, `document.getElementById('messages').textContent.includes('test-attach.txt')`, 'вложение отправлено', 10000);
  console.log('attachment-sent');
});
