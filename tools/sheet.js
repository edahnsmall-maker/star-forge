const {chromium}=require('playwright');
(async()=>{
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
 const p=await b.newPage({viewport:{width:1180,height:720},deviceScaleFactor:1.6});
 p.on('pageerror',e=>console.log('ERR',e.message));
 await p.goto('file://'+require('path').resolve(__dirname,'../index.html'));
 await p.waitForTimeout(500);
 await p.evaluate(([which])=>{
  unlockPoints=10; ui.innerHTML='';
  const o=document.createElement('canvas');
  o.width=1180*2;o.height=720*2;
  o.style.cssText='position:fixed;inset:0;width:1180px;height:720px;z-index:99';
  document.body.appendChild(o);
  const g=o.getContext('2d');g.setTransform(2,0,0,2,0,0);
  g.fillStyle='#0b1435';g.fillRect(0,0,1180,720);
  const sets={cockpit:COCKPITS,wings:WINGS,body:BODIES,engine:ENGINES,defense:DEFENSES};
  const list=sets[which];
  ship.cockpit=0;ship.wings=1;ship.body=0;ship.engine=1;ship.theme=0;ship.defense=1;
  const cols=4,cw=1180/cols,ch=250;
  list.forEach((it,i)=>{
    ship[which]=i;SPR.clear();
    const cx=(i%cols)*cw+cw/2, cy=Math.floor(i/cols)*ch+ch/2+10;
    drawShip(g,cx,cy,1.15,0.6,0.42);
    g.fillStyle='#fff';g.font='bold 17px Trebuchet MS';g.textAlign='center';
    g.fillText(it.name,cx,cy+100);
  });
 },[process.argv[3]]);
 await p.waitForTimeout(400);
 await p.screenshot({path:process.argv[2]});
 await b.close();
})();
