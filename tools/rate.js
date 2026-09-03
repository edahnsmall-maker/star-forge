const {chromium}=require('playwright');
const POLICY=require('fs').readFileSync(process.argv[2]+'/bot.js','utf8')
  .match(/const POLICY=`([\s\S]*?)`;/)[1];
(async()=>{
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
 const p=await b.newPage({viewport:{width:430,height:860},deviceScaleFactor:1});
 p.on('pageerror',e=>console.log('ERR',e.message));
 await p.goto('file://'+require('path').resolve(__dirname,'../index.html'));
 await p.waitForTimeout(400);await p.evaluate(POLICY);
 const rows=await p.evaluate(()=>{
  unlockPoints=10;const out=[];
  for(const lv of [1,3,5,8,10]){
    for(const def of [0,2]){
      let at30=0,at60=0,hits=0;const N=6;
      for(let i=0;i<N;i++){
        ship.cockpit=0;ship.wings=1;ship.body=0;ship.engine=1;ship.tail=0;ship.theme=0;ship.defense=def;
        chosenPower='shield';level=lv;startMission();
        fly.goal=999999;                       // let it run, just watch the rate
        let sh=fly.shield;
        for(let f=0;f<3600;f++){
          window.__step();updateFly();
          if(fly.shield<sh){hits++;sh=fly.shield;fly.shield=9;} // survive to measure
          if(f===1800)at30+=fly.crystals;
        }
        at60+=fly.crystals;
      }
      out.push({lv,def:DEFENSES[def].name,c30:Math.round(at30/N),c60:Math.round(at60/N),
                hitsPerMin:+(hits/N).toFixed(1)});
    }
  }
  return out;
 });
 console.log('crystals collected by a competent bot, and hits it would have taken:');
 for(const r of rows)
   console.log('  Lv'+String(r.lv).padStart(2)+'  '+r.def.padEnd(8)+
     '  30s: '+String(r.c30).padStart(4)+'   60s: '+String(r.c60).padStart(4)+
     '   hits/min '+r.hitsPerMin);
 await b.close();
})();
