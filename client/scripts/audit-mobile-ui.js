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

  // Вкладки друзей: активная не должна превращаться в плавающую капсулу
  const friendTabs = JSON.parse(await js(w, `(() => {
    const tabs=[...document.querySelectorAll('#friend-tabs button')];
    return JSON.stringify(tabs.map(b=>({text:(b.textContent||'').trim(),w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height})));
  })()`));
  if (!friendTabs.length) throw new Error('нет вкладок друзей');
  if (friendTabs.some(t => t.h < 40)) throw new Error('вкладка друзей меньше 40px: '+JSON.stringify(friendTabs));
  await js(w, `document.querySelectorAll('#friend-tabs button')[2]?.click(); true`);
  await sleep(300);
  const indicator = await js(w, `(() => { const i=document.querySelector('#friend-tabs .glass-tab-indicator'); return i ? getComputedStyle(i).display : 'none'; })()`);
  if (indicator !== 'none') throw new Error('glass-tab-indicator виден на телефоне: '+indicator);
  await screenshot(w, 'audit-01b-friend-tabs');
  await js(w, `document.querySelectorAll('#friend-tabs button')[0]?.click(); true`);

  await js(w, `document.querySelector('#mobile-nav [data-mobile="channels"]').click(); true`);
  await sleep(500); await screenshot(w, 'audit-02-channels'); await report('channels');

  await js(w, `openHub(${hub.id}); refreshRooms().then(() => new Promise(r => setTimeout(r, 300))); true`);
  await sleep(600);
  await js(w, `document.querySelector('#room-list .room-row').click(); true`);
  await sleep(600); await screenshot(w, 'audit-03-chat'); await report('chat');

  await js(w, `openSettings(); true`);
  await sleep(800); await screenshot(w, 'audit-04-settings'); await report('settings');
  console.log('settings-profile', await js(w, `(() => {
    const b=document.querySelector('#set-nav [data-tab="profile"]'); const c=getComputedStyle(b);
    return JSON.stringify({bg:c.backgroundColor,bgi:c.backgroundImage,border:c.border,shadow:c.boxShadow,outline:c.outline,cls:b.className,body:document.body.className});
  })()`));

  // Все семь разделов должны открываться именно как кнопки, а не только через showSettingsTab()
  for (const tab of ['profile','look','sound','notify','account','privacy','about']) {
    await js(w, `document.querySelector('#set-nav [data-tab="${tab}"]').click(); true`);
    await sleep(250);
    const opened = await js(w, `(() => {
      const pane=document.querySelector('#settings .set-pane[data-pane="${tab}"]');
      const active=document.querySelector('#set-nav [data-tab="${tab}"]');
      return Boolean(pane && getComputedStyle(pane).display !== 'none' && active?.classList.contains('active'));
    })()`);
    if (!opened) throw new Error('раздел настроек не открылся: '+tab);
    await js(w, `document.getElementById('mobile-settings-back').click(); true`);
    await sleep(200);
  }
  // Уведомления: оба видимых переключателя должны менять состояние
  await js(w, `document.querySelector('#set-nav [data-tab="notify"]').click(); true`);
  await sleep(300);
  for (const id of ['set-notify-preview','set-notify-sound']) {
    const before = await js(w, `document.getElementById('${id}').checked`);
    await js(w, `document.getElementById('${id}').click(); true`);
    await sleep(250);
    const after = await js(w, `document.getElementById('${id}').checked`);
    if (before === after) throw new Error('уведомление не переключилось: '+id);
  }
  await js(w, `document.getElementById('mobile-settings-back').click(); true`);
  await sleep(200);

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

  // В видимом мобильном тексте не должно оставаться PC-лексики
  const visibleText = await js(w, `document.body.innerText`);
  const banned = ['рабочий стол','рабочем столе','Windows','macOS','компьютер','мышь','Ctrl','Shift','Esc'];
  for (const word of banned) {
    if (visibleText.toLowerCase().includes(word.toLowerCase())) throw new Error('PC-текст в мобильном UI: '+word);
  }
  const badTitles = JSON.parse(await js(w, `JSON.stringify([...document.querySelectorAll('[title]')].map(e=>e.title).filter(t=>/(Ctrl|Shift|Esc|Windows|macOS)/.test(t)))`));
  if (badTitles.length) throw new Error('PC-title: '+badTitles.join('; '));

  await js(w, `showPrivacyPage('profile'); true`);
  await sleep(300);
  const before = await js(w, `Boolean(state.me?.privacy?.typing)`);
  await js(w, `document.querySelector('[data-privacy-toggle="typing"]').click(); true`);
  await sleep(700);
  const after = await js(w, `Boolean(state.me?.privacy?.typing)`);
  if (before === after) throw new Error('privacy toggle typing не сохранился');
  await js(w, `document.querySelector('[data-privacy-toggle="typing"]').click(); true`);
  await sleep(500);
});