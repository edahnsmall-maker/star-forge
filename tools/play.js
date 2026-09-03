const {chromium}=require('playwright');
(async()=>{
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
 const p=await b.newPage({viewport:{width:430,height:860},deviceScaleFactor:1});
 const errs=[];p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
 p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE '+m.text());});
 await p.goto('file://'+require('path').resolve(__dirname,'../index.html'));
 await p.waitForTimeout(500);
 const log=[];
 // 1. every slot cycles without error, in both directions
 await p.evaluate(()=>{unlockPoints=10;buildUI();
   for(let s=0;s<SLOTS.length;s++)for(let k=0;k<12;k++){cycleSlot(s,1);cycleSlot(s,-1);}});
 log.push('cycled every slot both ways: ok');
 // 2. locked parts are actually skipped at level 1
 const locked=await p.evaluate(()=>{unlockPoints=0;let bad=[];
   for(let s=0;s<SLOTS.length;s++){for(let k=0;k<14;k++){cycleSlot(s,1);
     const it=SLOTS[s].list[ship[SLOTS[s].key]];
     if((it.unlock||0)>unlockPoints)bad.push(SLOTS[s].label+':'+it.name);}}
   return bad;});
 log.push('locked parts reachable at Lv1: '+(locked.length?locked.join(','):'none (correct)'));
 // 3. UI buttons work: go to loadout, pick a power, land in flight
 await p.evaluate(()=>{scene=SCENE.BUILD;buildUI();});
 await p.click('#next');await p.waitForTimeout(150);
 await p.click('.pw[data-id="magnet"]');await p.waitForTimeout(400);
 log.push('scene after power pick: '+await p.evaluate(()=>scene===SCENE.FLY?'FLY (ok)':'WRONG'));
 // 4. steering hit-zones respond
 await p.evaluate(()=>{document.getElementById('zL').onmousedown({preventDefault(){}});});
 const x0=await p.evaluate(()=>fly.shipX);await p.waitForTimeout(350);
 const x1=await p.evaluate(()=>{const v=fly.shipX;document.getElementById('zL').onmouseup({preventDefault(){}});return v;});
 log.push('steer left moved ship: '+(x1<x0?'yes (ok)':'NO — '+x0+'->'+x1));
 // 5. win a level and confirm the unlock + level advance
 const before=await p.evaluate(()=>({lv:level,up:unlockPoints}));
 await p.evaluate(()=>{fly.crystals=fly.goal;winMission();});
 await p.waitForTimeout(900);await p.mouse.click(215,700);await p.waitForTimeout(300);
 const after=await p.evaluate(()=>({lv:level,up:unlockPoints,scene}));
 log.push('win -> level '+before.lv+'→'+after.lv+', unlockPoints '+before.up+'→'+after.up+
   ', back to build: '+(after.scene===0?'yes (ok)':'NO'));
 // 6. lose a level: level must NOT advance
 await p.evaluate(()=>{goLoadout();chosenPower='shield';startMission();});
 await p.waitForTimeout(200);
 const lv0=await p.evaluate(()=>level);
 await p.evaluate(()=>{fly.shield=1;hitShip();});
 await p.waitForTimeout(900);await p.mouse.click(215,700);await p.waitForTimeout(300);
 log.push('lose -> level stayed: '+(await p.evaluate(()=>level)===lv0?'yes (ok)':'NO'));
 // 7. resize mid-flight
 await p.evaluate(()=>{goLoadout();startMission();});
 await p.setViewportSize({width:900,height:500});await p.waitForTimeout(600);
 await p.setViewportSize({width:390,height:844});await p.waitForTimeout(600);
 log.push('resize mid-flight survived: '+(await p.evaluate(()=>scene===SCENE.FLY)?'yes (ok)':'NO'));
 log.push('sprite cache entries: '+await p.evaluate(()=>SPR.size));
 console.log(log.join('\n'));
 console.log(errs.length?'\nERRORS:\n'+errs.join('\n'):'\nno js errors');
 await b.close();
})();
