// ПК-настройки → Аккаунт: строки «Способы входа» не должны вылезать за блок
// и обрезать кнопку «Отвязать» при длинном адресе почты.
const { register, js, sleep, openClient, runTest, waitFor } = require('./e2e-lib');

runTest(async () => {
  const a = await register('id' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('id', a);
  w.setSize(1000, 760); w.show(); w.focus();
  await sleep(900);

  await js(w, `openSettings('account'); true`);
  await sleep(500);
  await js(w, `state.me.email = 'ilya-dasler@yandex.ru';
    state.me.hasPassword = false;
    state.me.identities = [{ provider: 'yandex', email: 'ilya.dasler@yandex.ru' }];
    state.providers = [{ id: 'yandex', name: 'Яндекс' }];
    renderIdentities();
    true`);
  await sleep(300);

  const m = JSON.parse(await js(w, `(() => {
    const pane = document.querySelector('#settings [data-pane="account"]');
    const rows = [...pane.querySelectorAll('.identity-row')];
    const block = rows[0]?.closest('.set-block');
    const br = block.getBoundingClientRect();
    const first = rows[0];
    const list = pane.querySelector('.identity-list');
    const fr = first.getBoundingClientRect();
    const lr = list.getBoundingClientRect();
    const cs = getComputedStyle(first);
    const lcs = getComputedStyle(list);
    const pr = list.parentElement.getBoundingClientRect();
    return JSON.stringify({
      blockPad: getComputedStyle(block)?.padding,
      blockClient: block ? [block.clientWidth, block.scrollWidth] : null,
      list: { left: Math.round(lr.left), right: Math.round(lr.right), width: Math.round(lr.width), cssWidth: lcs.width, maxWidth: lcs.maxWidth, box: lcs.boxSizing, parent: { id: list.parentElement.id, cls: list.parentElement.className, left: Math.round(pr.left), right: Math.round(pr.right), width: Math.round(pr.width) } },
      row: { left: Math.round(fr.left), width: Math.round(fr.width), ml: cs.marginLeft, mr: cs.marginRight, box: cs.boxSizing, display: cs.display },
      vw: innerWidth,
      block: { left: Math.round(br.left), right: Math.round(br.right) },
      rows: rows.map((r) => {
        const rr = r.getBoundingClientRect();
        const btn = r.querySelector('.btn');
        const sub = r.querySelector('.ellipsis');
        return {
          right: Math.round(rr.right),
          btnRight: btn ? Math.round(btn.getBoundingClientRect().right) : null,
          btnClip: btn ? btn.scrollWidth > btn.clientWidth + 1 : false,
          subOverflow: sub ? sub.scrollWidth > sub.clientWidth + 1 : false,
        };
      }),
    });
  })()`));
  console.log('identity-layout', JSON.stringify(m));
  if (!m.rows.length) throw new Error('строки способов входа не отрисованы');
  for (const [i, r] of m.rows.entries()) {
    if (r.right > m.block.right + 1) throw new Error(`строка ${i} вылезает за блок: ${r.right} > ${m.block.right}`);
    if (r.btnRight !== null && r.btnRight > m.block.right + 1) throw new Error(`кнопка строки ${i} вылезает за блок`);
    if (r.btnClip) throw new Error(`кнопка строки ${i} обрезана`);
  }
});
