const {chromium}=require('playwright');
(async()=>{
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
 for(const [f,out] of [['/tmp/cmp/old.html','/tmp/cmp/a.png'],['/tmp/cmp/new.html','/tmp/cmp/b.png']]){
  const p=await b.newPage({viewport:{width:520,height:620},deviceScaleFactor:2});
  p.on('pageerror',e=>console.log('ERR',f,e.message));
  await p.goto('file://'+f);await p.waitForTimeout(700);
  await p.evaluate(()=>{
    unlockPoints=20;
    ship.cockpit=0;ship.body=0;ship.wings=1;ship.engine=1;ship.theme=0;
    if('tail' in ship)ship.tail=0;
    if('defense' in ship)ship.defense=0;
    if('pilot' in ship)ship.pilot=1;
    SPR.clear();buildUI();yawSpin=0;buildYaw=0.5;});
  await p.waitForTimeout(900);
  await p.screenshot({path:out,clip:{x:60,y:150,width:400,height:330}});
  await p.close();
 }
 // stack them with labels, at true 1:1 pixels
 const p=await b.newPage({viewport:{width:840,height:400},deviceScaleFactor:2});
 await p.setContent(`<body style="margin:0;background:#0b1330;font:13px system-ui;color:#cfe">
  <div style="display:flex;gap:8px;padding:8px">
   <div><div style="padding:4px 2px">before the shading work</div>
     <img src="file:///tmp/cmp/a.png" style="width:400px;display:block"></div>
   <div><div style="padding:4px 2px">now</div>
     <img src="file:///tmp/cmp/b.png" style="width:400px;display:block"></div>
  </div></body>`);
 await p.waitForTimeout(600);
 await p.screenshot({path:'/tmp/cmp/side.png'});
 console.log('comparison rendered at true build-screen size');
 await b.close();
})();
