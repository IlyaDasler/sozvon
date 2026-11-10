const {register,js,sleep,openClient,runTest}=require('./e2e-lib');
runTest(async()=>{
 const a=await register('form'+Date.now().toString(36).slice(-4),'Аня');
 const w=await openClient('form',a);w.show();w.focus();await sleep(700);
 const probe=async(width,height)=>{w.setSize(width,height);await sleep(500);const raw=await js(w,`(()=>{const css=s=>{const e=document.querySelector(s);return e?getComputedStyle(e).display:null};return JSON.stringify({w:innerWidth,h:innerHeight,rail:css('#rail'),sidebar:css('.sidebar'),nav:css('#mobile-nav'),railUtility:css('#mobile-rail-utility')})})()`);console.log(width,raw);return JSON.parse(raw)};
 const foldOuter=await probe(344,882);
 const foldInner=await probe(673,841);
 const flipOpen=await probe(396,935);
 if(foldOuter.rail!=='none'||foldOuter.sidebar!=='none'||foldOuter.nav==='none')throw new Error('fold outer must be phone');
 if(foldInner.rail==='none'||foldInner.sidebar==='none'||foldInner.nav!=='none')throw new Error('fold inner must be workspace');
 if(flipOpen.rail!=='none'||flipOpen.sidebar!=='none'||flipOpen.nav==='none')throw new Error('flip open must be a tall phone, not workspace');
 console.log('✔ fold outer = phone, fold inner = workspace, flip open = tall phone');
});
