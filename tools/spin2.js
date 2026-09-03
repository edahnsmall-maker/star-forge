const {chromium}=require('playwright');
(async()=>{
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
 const p=await b.newPage({viewport:{width:420,height:420},deviceScaleFactor:1});
 await p.goto('file://'+require('path').resolve(__dirname,'../index.html'));
 await p.waitForTimeout(400);
 const res=await p.evaluate(()=>{
  unlockPoints=10;ui.innerHTML='';
  const perFace=drawPieces;
  // the sort this replaced: one order per whole piece, by its centroid
  const perPiece=function(c,pieces,TH,yaw){
   const cs=Math.cos(yaw),sn=Math.sin(yaw);
   const order=pieces.map(p=>{const g=pieceGeom(p);
     return{p,g,k:TILT*g.C[1]+RISE*(-g.C[0]*sn+g.C[2]*cs)};}).sort((a,b)=>a.k-b.k);
   for(const it of order){const p=it.p,g=it.g;
     const col=(TH&&!TH.natural&&p.r&&TH[p.r])||p.c;
     for(const f of g.F){const L=faceLit(f.n,cs,sn);if(!L.vis)continue;
       c.beginPath();
       for(let i=0;i<f.i.length;i++){const q=prj(g.V[f.i[i]],cs,sn);
         i?c.lineTo(q[0],q[1]):c.moveTo(q[0],q[1]);}
       c.closePath();c.fillStyle=shade(col,L.s);c.fill();}}
  };
  const o=document.createElement('canvas');o.width=420;o.height=420;
  const g=o.getContext('2d',{willReadFrequently:true});
  const measure=()=>{
   let prev=null,worst=0,sum=0,n=0;
   for(let k=0;k<=72;k++){
     g.fillStyle='#101d47';g.fillRect(0,0,420,420);
     SPR.clear();
     drawShip(g,210,210,0.85,0,k/72*Math.PI*2);
     const d=g.getImageData(0,0,420,420).data;
     if(prev){let diff=0;
       for(let i=0;i<d.length;i+=16){if(Math.abs(d[i]-prev[i])>28)diff++;}
       sum+=diff;n++;if(diff>worst)worst=diff;}
     prev=d;}
   return{avg:Math.round(sum/n),worst,ratio:+(worst/(sum/n)).toFixed(2)};
  };
  const out=[];
  for(const cb of [[0,1,0,0,0],[5,6,2,4,0],[2,3,1,1,1]]){
    [ship.cockpit,ship.wings,ship.body,ship.engine,ship.theme]=cb;
    window.drawPieces=perPiece;const before=measure();
    window.drawPieces=perFace; const after=measure();
    out.push({cb:cb.join(''),before,after});
  }
  return out;
 });
 console.log('worst single-step jump / average step, over a full spin');
 console.log('(a piece popping in or out spikes this; smooth rotation stays near 1)');
 for(const r of res)
   console.log('  combo '+r.cb+'   per-piece sort: '+r.before.ratio+'   per-face sort: '+r.after.ratio);
 await b.close();
})();
