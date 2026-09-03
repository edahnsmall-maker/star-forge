const {chromium}=require('playwright');
const path=require('path');
(async()=>{
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
 const p=await b.newPage({viewport:{width:430,height:860},deviceScaleFactor:2});
 p.on('pageerror',e=>console.log('ERR',e.message));
 await p.goto('file://'+path.resolve(__dirname,'../index.html'));
 await p.waitForTimeout(600);
 await p.evaluate(()=>{unlockPoints=10;yawSpin=0;buildYaw=0.5;buildUI();});
 const steps=[['00-empty',null],['01-hull','body'],['02-wings','wings'],
              ['03-cockpit','cockpit'],['04-engine','engine'],['05-tail','tail'],
              ['06-defense','defense']];
 for(const [name,key] of steps){
   if(key)await p.evaluate(k=>{ship[k]=k==='wings'?1:(k==='tail'?1:0);SPR.clear();
     activeSlot=SLOTS.findIndex(s=>s.key===k);buildUI();},key);
   await p.waitForTimeout(350);
   await p.screenshot({path:process.argv[2]+'/'+name+'.png'});
 }
 console.log('build sequence captured');
 await b.close();
})();
