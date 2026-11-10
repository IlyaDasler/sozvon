const { api, register, js, sleep, openClient, runTest, screenshot } = require('./e2e-lib');
runTest(async () => {
  const a = await register('audit' + Date.now().toString(36).slice(-4), 'Аня');
  const hub = await api('POST', '/hubs', { name: 'Дизайн' }, a.token);
  await api('POST', '/rooms', { hubId: hub.id, name: 'Общий чат', kind: 'text' }, a.token);
  const w = await openClient('audit', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  await screenshot(w, 'audit-01-home');

  const report = async (label) => {
    const r = await js(w, `(() => {
      const bad = [];
      for (const el of document.querySelectorAll('button,a,[tabindex],input,textarea')) {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const ow = parseFloat(cs.outlineWidth) || 0;
        if (cs.outlineStyle !== 'none' && ow > 0) bad.push({tag:el.tagName,id:el.id,cls:el.className?.toString().slice(0,40),outline:cs.outline,text:(el.textContent||'').trim().slice(0,20)});
      }
      return JSON.stringify({bad, active: document.activeElement?.id || document.activeElement?.className || '', docScroll: document.documentElement.scrollHeight > innerHeight, bodyOverflow: getComputedStyle(document.body).overflow});
    })()`);
    console.log(label, r);
  };
  await report('home');

  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(500); await screenshot(w, 'audit-02-channels'); await report('channels');

  await js(w, `openHub(${hub.id}); refreshRooms().then(() => new Promise(r => setTimeout(r, 300))); true`);
  await sleep(600);
  await js(w, `document.querySelector('#room-list .room-row').click(); true`);
  await sleep(600); await screenshot(w, 'audit-03-chat'); await report('chat');

  await js(w, `openSettings(); true`);
  await sleep(800); await screenshot(w, 'audit-04-settings'); await report('settings');

  await js(w, `document.querySelector('#set-nav [data-tab="look"]').click(); true`);
  await sleep(600); await screenshot(w, 'audit-05-look'); await report('look');

  await js(w, `document.querySelector('#set-nav [data-tab="privacy"]').click(); true`);
  await sleep(600); await screenshot(w, 'audit-06-privacy'); await report('privacy');
  const privacy = JSON.parse(await js(w, `(() => {
    const nav=document.getElementById('privacy-subnav');
    const nr=nav?.getBoundingClientRect();
    return JSON.stringify({nav: nav ? {display:getComputedStyle(nav).display,w:nr.width,h:nr.height} : null,
      pages:[...document.querySelectorAll('#settings [data-privacy-page]')].map(p=>({p:p.dataset.privacyPage,hidden:p.classList.contains('hidden'),h:p.getBoundingClientRect().height})),
      buttons:[...document.querySelectorAll('#privacy-subnav [data-privacy]')].map(b=>({p:b.dataset.privacy,display:getComputedStyle(b).display,w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height}))});
  })()`));
  console.log('privacy-dom', JSON.stringify(privacy));
  for (const page of ['data','profile','contact','crypto']) {
    await js(w, `document.querySelector('#privacy-subnav [data-privacy="${page}"]').click(); true`);
    await sleep(250);
    const visible = await js(w, `!document.querySelector('#settings [data-privacy-page="${page}"]').classList.contains('hidden')`);
    if (!visible) throw new Error('privacy page не открылась: '+page);
  }
  await screenshot(w, 'audit-07-privacy-crypto');
});