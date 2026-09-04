const {chromium,devices}=require('playwright');const path=require('path');
(async()=>{
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
 for(const name of ['iPhone 12','Pixel 5','iPhone SE']){
  const d=devices[name];
  const c=await b.newContext({...d, hasTouch:true, isMobile:true});
  const p=await c.newPage();
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto('file://'+path.resolve(__dirname,'../index.html'));
  await p.waitForTimeout(800);
  const out={};
  // does the UI fit, and is the launch button reachable?
  Object.assign(out, await p.evaluate(()=>{
    unlockPoints=20;buildUI();
    const btn=document.getElementById('next').getBoundingClientRect();
    const tabs=[...document.querySelectorAll('.slot-tab')].map(t=>t.getBoundingClientRect());
    const rows=new Set(tabs.map(t=>Math.round(t.top))).size;
    const lowest=Math.max(...tabs.map(t=>t.bottom));
    return {vw:innerWidth,vh:innerHeight,dpr:DPR,
      buttonOnScreen:btn.bottom<=innerHeight&&btn.top>=0,
      buttonBottomGap:Math.round(innerHeight-btn.bottom),
      tabRows:rows, tabsBottom:Math.round(lowest),
      anyTabClipped:tabs.some(t=>t.right>innerWidth+1||t.left<-1)};}));
  // build a ship entirely through taps on the real controls
  for(let i=0;i<7;i++){
    const tabs=await p.$$('.slot-tab');
    if(tabs[i]){await tabs[i].tap();await p.waitForTimeout(60);
      const fwd=await p.$$('.cyc'); if(fwd[1]){await fwd[1].tap();await p.waitForTimeout(60);}}
  }
  out.builtByTapping=await p.evaluate(()=>NEEDED.filter(k=>ship[k]<0).length===0);
  // launch and steer by touch
  await p.tap('#next');await p.waitForTimeout(200);
  const pw=await p.$('.pw'); if(pw)await pw.tap();
  await p.waitForTimeout(500);
  out.inFlight=await p.evaluate(()=>scene===SCENE.FLY);
  const x0=await p.evaluate(()=>fly.shipX);
  await p.touchscreen.tap(30, d.viewport.height*0.7);
  await p.evaluate(()=>{document.getElementById('zL').ontouchstart({preventDefault(){}});});
  await p.waitForTimeout(400);
  out.touchSteered=await p.evaluate(x=>{const moved=fly.shipX<x;
    document.getElementById('zL').ontouchend({preventDefault(){}});return moved;},x0);
  out.fps=await p.evaluate(()=>new Promise(r=>{let n=0,t0=performance.now();
    const f=()=>{n++;if(performance.now()-t0<2200)requestAnimationFrame(f);
    else r(Math.round(n/((performance.now()-t0)/1000)));};requestAnimationFrame(f);}));
  out.flyDPR=await p.evaluate(()=>DPR);
  console.log(name.padEnd(11)+JSON.stringify(out).replace(/","/g,'", "'));
  if(errs.length)console.log('   ERRORS: '+errs.join(' | '));
  await c.close();
 }
 await b.close();
})();
