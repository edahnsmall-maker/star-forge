const {chromium}=require('playwright');
(async()=>{
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
 const p=await b.newPage({viewport:{width:1280,height:820},deviceScaleFactor:2});
 p.on('pageerror',e=>console.log('ERR',e.message));
 await p.goto('file://'+require('path').resolve(__dirname,'../index.html'));
 await p.waitForTimeout(500);
 await p.evaluate(()=>{unlockPoints=10;ship.cockpit=0;ship.wings=3;ship.body=1;
   ship.engine=1;ship.defense=2;ship.theme=1;SPR.clear();buildUI();yawSpin=0;buildYaw=0.5;});
 await p.waitForTimeout(700);
 await p.screenshot({path:process.argv[2],clip:{x:330,y:190,width:620,height:430}});
 console.log('sprite bake scale used:',await p.evaluate(()=>{
   const sc=Math.min(innerWidth,innerHeight)/360*1.05;return 'draw scale '+sc.toFixed(2)+
   ' x DPR '+devicePixelRatio+' -> baked at '+bakeSS(sc)+'x';}));
 await b.close();
})();
