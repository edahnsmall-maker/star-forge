const {chromium}=require('playwright');
// A simple competent player: dodge the nearest threat, otherwise chase gems.
const POLICY=`
 window.__step=function(){
   let steer=0, best=1e9, threat=null;
   for(const o of fly.obstacles){
     const dy=fly.shipY-o.y;
     if(dy<0||dy>260)continue;
     const dx=Math.abs(o.x-fly.shipX);
     if(dx<o.w*0.5+46&&dy<best){best=dy;threat=o;}
   }
   if(threat)steer=threat.x>fly.shipX?-1:1;
   else{
     let bg=null,bd=1e9;
     for(const g of fly.gems){const dy=fly.shipY-g.y;
       if(dy<-40||dy>460)continue;
       const d=Math.abs(g.x-fly.shipX)+dy*0.35;
       if(d<bd){bd=d;bg=g;}}
     if(bg)steer=Math.abs(bg.x-fly.shipX)<8?0:(bg.x>fly.shipX?1:-1);
   }
   if(fly.shipX<70)steer=1; if(fly.shipX>W-70)steer=-1;
   touchSteer=steer;
 };`;
const run=async(url,label)=>{
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
 const p=await b.newPage({viewport:{width:430,height:860},deviceScaleFactor:1});
 p.on('pageerror',e=>console.log('ERR',e.message));
 await p.goto(url);await p.waitForTimeout(400);
 await p.evaluate(POLICY);
 const rows=await p.evaluate(()=>{
  unlockPoints=10;
  const hasDef=typeof DEFENSES!=='undefined';
  const trial=(lv,def)=>{
    ship.cockpit=0;ship.wings=1;ship.body=0;ship.engine=1;ship.theme=0;
    if(hasDef)ship.defense=def;
    chosenPower='shield';level=lv;startMission();
    let f=0;
    for(;f<7200&&!fly.over;f++){window.__step();updateFly();}
    return{win:fly.over&&fly.win,secs:f/60,got:fly.crystals,goal:fly.goal};
  };
  const out=[];
  for(const lv of [1,3,5,8]){
    for(const def of (hasDef?[0,1,4]:[0])){
      let wins=0,secs=0,pct=0;const N=12;
      for(let i=0;i<N;i++){const r=trial(lv,def);
        if(r.win)wins++; secs+=r.secs; pct+=Math.min(1,r.got/r.goal);}
      out.push({lv,def:hasDef?DEFENSES[def].name:'n/a',
        win:Math.round(wins/N*100),secs:+(secs/N).toFixed(1),
        prog:Math.round(pct/N*100)});
    }
  }
  return out;
 });
 console.log('\n'+label);
 for(const r of rows)
   console.log('  Lv'+String(r.lv).padStart(2)+'  defence '+r.def.padEnd(8)+
     ' win '+String(r.win).padStart(3)+'%   avg run '+String(r.secs).padStart(5)+'s'+
     '   goal reached '+String(r.prog).padStart(3)+'%');
 await b.close();return rows;
};
(async()=>{
 await run('file://'+process.argv[2]+'/before.html','BEFORE (previous commit)');
 await run('file://'+require('path').resolve(__dirname,'../index.html'),'AFTER (this change)');
})();
