const {chromium}=require('playwright');
(async()=>{
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
 const p=await b.newPage({viewport:{width:430,height:860},deviceScaleFactor:2});
 const errs=[];p.on('pageerror',e=>errs.push('ERR '+e.message));
 await p.goto('file://'+require('path').resolve(__dirname,'../index.html'));
 await p.waitForTimeout(500);
 const rows=await p.evaluate(()=>{
  const out=[];
  for(let d=0;d<DEFENSES.length;d++){
    unlockPoints=10;ship.defense=d;if(ship.body<0){ship.body=1;ship.wings=3;ship.cockpit=0;ship.engine=2;ship.tail=1;}ship.wings=3;ship.body=1;ship.engine=2;ship.tail=1;ship.cockpit=0;
    SPR.clear();chosenPower='shield';level=2;startMission();
    fly.shipX=215;fly.shipY=560;fly.invuln=99999;      // no crashing during the test
    const tagged=[];
    for(let i=0;i<8;i++){const o={x:120+i*26,y:300,w:58,h:40,hp:2,hitT:0,
      spin:i,spinV:0,rock:i%6,sc:58/74,tag:1};tagged.push(o);fly.obstacles.push(o);}
    for(let f=0;f<300;f++){
      updateFly();
      for(const o of fly.obstacles)o.y-=fly.speed;   // hold them in place
      fly.invuln=99999;
    }
    const left=fly.obstacles.filter(o=>o.tag).length;
    out.push({name:DEFENSES[d].name,rate:DEFENSES[d].rate,killed:8-left});
  }
  return out;
 });
 console.log('rocks destroyed out of 8, over ~5 seconds of fire:');
 for(const r of rows)
   console.log('  '+r.name.padEnd(9)+String(r.killed).padStart(2)+
     (r.rate?'':'   (no defence fitted)'));
 const boss=await p.evaluate(()=>{
   const res={};
   for(const d of [0,3,5]){
     ship.defense=d;if(ship.body<0){ship.body=1;ship.wings=3;ship.cockpit=0;ship.engine=2;ship.tail=1;}SPR.clear();level=3;chosenPower='shield';startMission();
     fly.picked=fly.goal;fly.bossSpawned=true;fly.invuln=99999;
     fly.boss={x:215,y:180,r:70,hp:5,maxHp:5,vx:0,vy:0,hitT:0,fireT:0,sway:0};
     fly.shipX=215;fly.shipY=560;
     let f=0;for(;f<600&&!fly.over;f++){updateFly();fly.invuln=99999;}
     res[DEFENSES[d].name]=fly.over?(fly.win?'wins after '+(f/60).toFixed(1)+'s':'lost'):'never resolves';
   }
   return res;
 });
 console.log('\nboss level, crystals already collected:');
 for(const k in boss)console.log('  '+k.padEnd(9)+boss[k]);
 console.log('\n'+(errs.length?errs.join('\n'):'no js errors'));
 await b.close();
})();
