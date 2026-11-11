// В шапке личного чата звонок — иконка, имя собеседника не съедается.
const { befriend, register, js, sleep, openClient, runTest } = require('./e2e-lib');

runTest(async () => {
  const a = await register('hd' + Date.now().toString(36).slice(-4), 'Аня');
  const b = await register('hdb' + Date.now().toString(36).slice(-4), 'Боря');
  await befriend(a, b);
  const w = await openClient('hd', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  await js(w, `selectContact(${b.user.id}); true`);
  await sleep(700);

  const d = JSON.parse(await js(w, `(() => {
    const btn = document.getElementById('call-btn');
    const label = btn.querySelector('.call-label');
    const svg = btn.querySelector('svg');
    const name = document.getElementById('peer-name');
    const nr = name.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    return JSON.stringify({
      callW: Math.round(br.width), callH: Math.round(br.height),
      label: label ? getComputedStyle(label).display : 'absent',
      svg: svg ? getComputedStyle(svg).display : 'absent',
      name: name.textContent, nameW: Math.round(nr.width),
      nameClipped: name.scrollWidth > name.clientWidth + 1,
      vw: innerWidth,
    });
  })()`));
  console.log('chat-header', JSON.stringify(d));
  if (d.callW > 44 || d.callH > 44) throw new Error('кнопка звонка всё ещё большая: ' + JSON.stringify(d));
  if (d.label !== 'none') throw new Error('текст «Позвонить» остался');
  if (d.svg === 'none') throw new Error('иконка звонка исчезла');
  if (d.nameW < 50 || d.nameClipped) throw new Error('имя собеседника не помещается: ' + JSON.stringify(d));
});
