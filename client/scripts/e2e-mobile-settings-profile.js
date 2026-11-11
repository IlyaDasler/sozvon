const { register, js, sleep, openClient, runTest, waitFor } = require('./e2e-lib');
runTest(async () => {
  const a = await register('sp' + Date.now().toString(36).slice(-4), 'Аня');
  const w = await openClient('sp', a);
  w.setSize(390, 844); w.show(); w.focus();
  await sleep(900);
  await js(w, `document.querySelector('#mobile-nav [data-mobile="settings"]').click(); true`);
  await waitFor(w, `!document.getElementById('settings').classList.contains('hidden')`, 'settings', 4000);
  await sleep(300);
  const d = await js(w, `(() => {
    const q=(s)=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();const c=getComputedStyle(e);return{display:c.display,justify:c.justifyContent,align:c.alignItems,text:c.textAlign,margin:c.margin,padding:c.padding,x:Math.round(r.x),w:Math.round(r.width),right:Math.round(r.right)}};
    return JSON.stringify({overview:q('#mobile-settings-overview'),card:q('#mobile-profile-open'),avatar:q('#mobile-profile-avatar'),meta:q('.mobile-profile-meta'),row:q('#set-nav button[data-tab="look"]'),nav:q('#set-nav')});
  })()`);
  console.log('profile-layout', d);
  const v = JSON.parse(d);
  if (v.card.x > v.row.x + 2 || v.card.right < v.row.right - 2) throw new Error('профиль не в сетке списка: ' + d);
  if (v.avatar.x > v.card.x + 16) throw new Error('аватар не прижат влево: ' + d);
});
