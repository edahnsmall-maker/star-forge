/* =======================================================================
   THE 3D RENDERER
   The old renderer drew 3D with a 2D canvas and a painter's algorithm. Every
   artifact we chased -- faces sorting over the bricks standing on them, blank
   panels across the deck, seams between subdivided cells, rotation that moved
   in 15-degree jumps and cost most of the frame budget -- came from that one
   decision. A depth buffer makes all of it impossible rather than fixed.
   The part data did not change. Only this did.
   ======================================================================= */
import * as T from './three.module.min.js';
import {STUD,PLATE,CZ,CY,THEMES,ship,shipPieces,settle,bbox,inPoly,studCovered} from './parts.js';

/* ---------- geometry ----------------------------------------------------
   A piece is a polygon extruded along one axis, sometimes with per-corner
   heights (a slope) or a shrunken top (a cone). Flat-topped pieces get a real
   bevel, which is what the chamfer on a moulded brick actually is -- the old
   renderer faked it with a stroked line and that line was the last artifact
   still on screen.
   ------------------------------------------------------------------------ */
const BEVEL=0.42;                                  // world units, ~1.5% of a stud

function prismGeometry(p){
  // bottom ring and top ring in the piece's own 2D plane, then stitched.
  const n=p.pts.length, ts=p.ts===undefined?1:p.ts, ax=p.ax||'y';
  let cu=0,cv=0; for(const q of p.pts){cu+=q[0];cv+=q[1];} cu/=n; cv/=n;
  const map = ax==='y'
    ? (u,v,w)=>[u*STUD, w*PLATE-CY, v*STUD-CZ]
    : (u,v,w)=>[u*STUD, v*PLATE-CY, w*STUD-CZ];
  const lo=[],hi=[];
  for(let i=0;i<n;i++){
    const q=p.pts[i], th=p.hs?p.hs[i]:p.h;
    lo.push(map(q[0],q[1],p.y));
    hi.push(map(cu+(q[0]-cu)*ts, cv+(q[1]-cv)*ts, p.y+th));
  }
  const pos=[];
  const tri=(a,b,c)=>{pos.push(a[0],a[1],a[2],b[0],b[1],b[2],c[0],c[1],c[2]);};
  for(let i=1;i<n-1;i++){tri(hi[0],hi[i],hi[i+1]); tri(lo[0],lo[i+1],lo[i]);}
  for(let i=0;i<n;i++){
    const j=(i+1)%n;
    tri(lo[i],lo[j],hi[j]); tri(lo[i],hi[j],hi[i]);
  }
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.Float32BufferAttribute(pos,3));
  g.computeVertexNormals();
  return g;
}

function pieceGeometry(p){
  if(p._g3)return p._g3;
  const ts=p.ts===undefined?1:p.ts, ax=p.ax||'y';
  let g;
  if(p.hs||ts!==1){
    g=prismGeometry(p);                            // slopes and cones
  }else{
    /* Build every piece the same way -- a 2D footprint extruded along +Z from
       0 to its full thickness -- then move that one shape into place. Doing
       the transform per axis inline is how the nacelles ended up floating off
       the ship: ax:'z' pieces carry their second coordinate in plates, not
       studs, and extrude along z rather than y. */
    const total=(ax==='y'?p.h*PLATE:p.h*STUD);
    const second=(ax==='y'?STUD:PLATE);
    const sh=new T.Shape();
    p.pts.forEach((q,i)=>i
      ? sh.lineTo(q[0]*STUD,q[1]*second)
      : sh.moveTo(q[0]*STUD,q[1]*second));
    sh.closePath();
    const b=Math.min(BEVEL,total*0.28);
    g=new T.ExtrudeGeometry(sh,{depth:Math.max(0.01,total-b*2),
      bevelEnabled:b>0.02, bevelThickness:b, bevelSize:b, bevelOffset:0,
      bevelSegments:1, steps:1, curveSegments:4});
    g.translate(0,0,b);                            // now spans [0, total] in +Z
    if(ax==='y'){
      g.rotateX(Math.PI/2);                        // +Z extrusion becomes -Y
      g.translate(0, total+p.y*PLATE-CY, -CZ);     // ...and back up into place
    }else{
      g.translate(0, -CY, p.y*STUD-CZ);
    }
  }
  g.computeBoundingBox();
  return (p._g3=g);
}

/* ---------- materials --------------------------------------------------- */
const MAT=new Map();
function material(hex,clear){
  const k=hex+(clear?'|t':'');
  let m=MAT.get(k); if(m)return m;
  const col=new T.Color(hex).convertSRGBToLinear();
  /* Real transmission makes three.js re-render the whole scene into a
     separate buffer for every transmissive mesh. On a canopy the size of a
     thumbnail nobody can tell it from plain tinted plastic with a hard coat,
     and the tablet this is for certainly can. */
  m = clear
    ? new T.MeshPhysicalMaterial({color:col, roughness:0.06, metalness:0,
        transparent:true, opacity:0.62, depthWrite:false,
        clearcoat:1, clearcoatRoughness:0.03, envMapIntensity:1.6,
        vertexColors:true})
    : new T.MeshPhysicalMaterial({color:col, roughness:0.30, metalness:0,
        clearcoat:0.85, clearcoatRoughness:0.09, reflectivity:0.5,
        envMapIntensity:1.15, vertexColors:true});
  MAT.set(k,m); return m;
}

/* ---------- the model --------------------------------------------------- */
const STUD_R=STUD*0.30, STUD_H=STUD*0.23;
let studGeo=null;
function studGeometry(){
  if(studGeo)return studGeo;
  const g=new T.CylinderGeometry(STUD_R,STUD_R*1.02,STUD_H,18,1,false);
  g.translate(0,STUD_H/2,0);
  /* The pieces carry baked occlusion in a colour attribute, so the studs need
     one too or they draw with an unset attribute -- which reads as black.
     Theirs is a gradient: a stud sits in its own small shadow at the base. */
  const P=g.getAttribute('position'), col=new Float32Array(P.count*3);
  for(let i=0;i<P.count;i++){
    const f=0.80+0.20*Math.min(1,P.getY(i)/STUD_H);
    col[i*3]=col[i*3+1]=col[i*3+2]=f;
  }
  g.setAttribute('color',new T.BufferAttribute(col,3));
  return (studGeo=g);
}

/* ---------- baked crevice shading --------------------------------------
   Shadow maps catch the big shapes but not the dark line where two bricks
   meet, and that line is most of what makes an assembly read as one solid
   object rather than a pile of lit boxes. Every piece is a box, so the
   occlusion can be measured directly: step out along each vertex normal and
   see how much brick is sitting there.
   ------------------------------------------------------------------------ */
const AO_TAPS=[[1.4,0.30],[3.4,0.22],[7.0,0.14]];   // distance, weight
const AO_DEPTH=0.70;                                 // how dark a fully buried corner goes
/* Sampling straight out along the normal only finds a brick stacked directly
   on top. The dark line that makes an assembly read as one object comes from
   the brick standing *beside* the one you are looking at, so the taps lean
   off-axis too. */
const AO_BEND=0.95;
function bakeAO(entries){
  const boxes=entries.map(e=>e.box), N=boxes.length;
  if(N<2)return;
  const CELL=16, grid=new Map();
  const key=(a,b,c)=>a+','+b+','+c;
  for(let i=0;i<N;i++){
    const b=boxes[i];
    for(let x=Math.floor(b.min.x/CELL);x<=Math.floor(b.max.x/CELL);x++)
    for(let y=Math.floor(b.min.y/CELL);y<=Math.floor(b.max.y/CELL);y++)
    for(let z=Math.floor(b.min.z/CELL);z<=Math.floor(b.max.z/CELL);z++){
      const k=key(x,y,z); let a=grid.get(k); if(!a)grid.set(k,a=[]); a.push(i);
    }
  }
  const nrmv=new T.Vector3(), pos=new T.Vector3(),
        ta=new T.Vector3(), tb=new T.Vector3();
  for(let gi=0;gi<entries.length;gi++){
    const g=entries[gi].geo;
    if(g.userData.aoDone)continue; g.userData.aoDone=true;
    const P=g.getAttribute('position'), Nn=g.getAttribute('normal');
    if(!P||!Nn)continue;
    const col=new Float32Array(P.count*3);
    for(let v=0;v<P.count;v++){
      pos.fromBufferAttribute(P,v); nrmv.fromBufferAttribute(Nn,v);
      // two tangents, so the bent taps sweep all the way round the normal
      ta.set(nrmv.z,nrmv.x,nrmv.y).cross(nrmv);
      if(ta.lengthSq()<1e-6)ta.set(1,0,0); ta.normalize();
      tb.crossVectors(nrmv,ta);
      let occ=0, wsum=0;
      for(const [dist,wt] of AO_TAPS){
        for(let k=0;k<5;k++){
          const bx=k?(k===1?1:k===2?-1:0)*AO_BEND:0;
          const by=k?(k===3?1:k===4?-1:0)*AO_BEND:0;
          const w=k?wt*0.62:wt;
          wsum+=w;
          const sx=pos.x+(nrmv.x+ta.x*bx+tb.x*by)*dist,
                sy=pos.y+(nrmv.y+ta.y*bx+tb.y*by)*dist,
                sz=pos.z+(nrmv.z+ta.z*bx+tb.z*by)*dist;
          const a=grid.get(key(Math.floor(sx/CELL),Math.floor(sy/CELL),Math.floor(sz/CELL)));
          if(!a)continue;
          for(let q=0;q<a.length;q++){
            const j=a[q]; if(j===gi)continue; const b=boxes[j];
            if(sx>=b.min.x&&sx<=b.max.x&&sy>=b.min.y&&sy<=b.max.y&&
               sz>=b.min.z&&sz<=b.max.z){ occ+=w; break; }
          }
        }
      }
      occ=wsum?occ/wsum:0;
      const f=1-Math.min(1,occ)*AO_DEPTH;
      col[v*3]=col[v*3+1]=col[v*3+2]=f;
    }
    g.setAttribute('color',new T.BufferAttribute(col,3));
  }
}

/* ---------- minifigures --------------------------------------------------
   The pilot used to be built out of bricks like everything else -- a box for
   a body, a cylinder for a head, two black pixels for eyes -- and it read as
   a bollard in a hat. A minifigure is not made of bricks, so it is not built
   from them here either: a tapered torso with a printed chest, arms angled
   forward onto the controls ending in C-shaped hands, a round yellow head
   with a printed face and a stud on top, and the headgear that tells you who
   it is. Origin is the seat; the face looks down -z, the way the ship flies.
   Units are world units (a stud is 7); a real minifig at about 0.56 per mm.
   ------------------------------------------------------------------------ */
const FIGMAT=new Map();
function plastic(hex,o){
  const k=hex+JSON.stringify(o||{});
  let m=FIGMAT.get(k); if(m)return m;
  m=new T.MeshPhysicalMaterial(Object.assign({color:new T.Color(hex).convertSRGBToLinear(),
    roughness:0.3,metalness:0,clearcoat:0.8,clearcoatRoughness:0.1,envMapIntensity:1.15},o||{}));
  FIGMAT.set(k,m); return m;
}
const FIG={TW:8.4,BW:7.0,TH:6.8,TD:4.4,Y0:-3.6,HR:2.9,HH:5.2};
// the head's side profile, bottom to top; v on the face texture runs by index
const HEADP=[[0,0],[2.1,0],[2.75,0.22],[2.9,0.75],[2.9,1.5],[2.9,2.25],[2.9,3.0],[2.9,3.75],
  [2.9,4.45],[2.75,4.98],[2.1,5.2],[0,5.2]];
function headV(h){                     // canvas row for a height up the head
  for(let i=3;i<8;i++){const a=HEADP[i][1],b=HEADP[i+1][1];
    if(h>=a&&h<=b)return (1-(i+(h-a)/(b-a))/(HEADP.length-1))*256;}
  return 128;
}
const FACETEX=new Map();
function faceTexture(P){
  const skin=P.skin||'#F2CD37', kind=P.face||'smile', k=skin+kind;
  let t=FACETEX.get(k); if(t)return t;
  const cv=document.createElement('canvas'); cv.width=512; cv.height=256;
  const g=cv.getContext('2d'); g.fillStyle=skin; g.fillRect(0,0,512,256);
  const cx=256, ey=headV(3.0), my=headV(1.75), by=headV(3.8);
  g.fillStyle='#14181C'; g.strokeStyle='#14181C'; g.lineCap='round';
  // eyes: two tall dots with a glint, the whole personality of a minifig
  for(const s of [-1,1]){g.beginPath();g.ellipse(cx+s*27,ey,9.5,13.5,0,0,7);g.fill();}
  g.fillStyle='#fff';for(const s of [-1,1]){g.beginPath();g.arc(cx+s*27-3,ey-5,3.2,0,7);g.fill();}
  g.fillStyle='#14181C';
  if(kind==='lashes'){g.lineWidth=3.5;for(const s of [-1,1]){
    g.beginPath();g.moveTo(cx+s*33,ey-10);g.lineTo(cx+s*41,ey-17);g.stroke();
    g.beginPath();g.moveTo(cx+s*35,ey-4);g.lineTo(cx+s*44,ey-7);g.stroke();}}
  if(kind==='brows'||kind==='beard'){g.lineWidth=kind==='beard'?8:6;for(const s of [-1,1]){
    g.beginPath();g.moveTo(cx+s*14,by+(kind==='brows'?6:2));g.lineTo(cx+s*42,by-(kind==='brows'?4:0));g.stroke();}}
  if(kind==='freckles'){g.fillStyle='#C9822B';for(const s of [-1,1])for(const [dx,dy] of [[40,22],[48,28],[34,30]]){
    g.beginPath();g.arc(cx+s*dx,ey+dy,2.6,0,7);g.fill();}g.fillStyle='#14181C';}
  if(kind==='grin'){                   // a big open smile with teeth
    g.beginPath();g.moveTo(cx-34,my-14);g.quadraticCurveTo(cx,my+44,cx+34,my-14);g.closePath();g.fill();
    g.fillStyle='#fff';g.beginPath();g.moveTo(cx-28,my-11);g.quadraticCurveTo(cx,my+2,cx+28,my-11);
    g.closePath();g.fill();
  }else if(kind!=='beard'){            // the classic smile
    g.lineWidth=7;g.beginPath();g.arc(cx,my-26,34,0.22*Math.PI,0.78*Math.PI);g.stroke();
    if(kind==='lashes'){g.fillStyle='#C8323C';g.beginPath();g.ellipse(cx,my+6,9,4,0,0,7);g.fill();}
  }
  t=new T.CanvasTexture(cv); t.colorSpace=T.SRGBColorSpace; t.anisotropy=4;
  FACETEX.set(k,t); return t;
}
const PRINTTEX=new Map();
function chestTexture(P){
  const kind=P.print||'space', k=kind+P.shirt;
  let t=PRINTTEX.get(k); if(t)return t;
  const W=256,H=Math.round(256*FIG.TH/FIG.TW), cv=document.createElement('canvas');
  cv.width=W; cv.height=H; const g=cv.getContext('2d');
  // only inside the torso's trapezoid; outside stays clear
  const inset=(1-FIG.BW/FIG.TW)/2*W;
  g.beginPath();g.moveTo(0,0);g.lineTo(W,0);g.lineTo(W-inset,H);g.lineTo(inset,H);g.closePath();g.clip();
  const ink='#1B2A34', cx=W/2;
  g.lineJoin='round';g.lineCap='round';
  if(kind==='space'){                  // the classic space logo: a planet and an orbiting ship
    g.fillStyle='#F2CD37';g.strokeStyle=ink;g.lineWidth=5;
    g.beginPath();g.arc(cx,92,30,0,7);g.fill();g.stroke();
    g.strokeStyle='#fff';g.lineWidth=8;g.beginPath();
    g.ellipse(cx,92,58,19,-0.42,Math.PI*0.95,Math.PI*2.25);g.stroke();
    g.fillStyle='#fff';g.beginPath();g.moveTo(cx+56,58);g.lineTo(cx+74,46);g.lineTo(cx+66,68);g.closePath();g.fill();
  }else if(kind==='flame'){
    const f=(s,c)=>{g.fillStyle=c;g.beginPath();g.moveTo(cx,150*s+(1-s)*95);
      g.bezierCurveTo(cx-48*s,130,cx-30*s,80,cx-6*s,40+(1-s)*45);
      g.bezierCurveTo(cx+4,70,cx+14*s,60,cx+18*s,38+(1-s)*50);
      g.bezierCurveTo(cx+52*s,80,cx+44*s,130,cx,150*s+(1-s)*95);g.fill();};
    f(1,'#C91A09');f(0.62,'#F2CD37');
  }else if(kind==='leaf'){
    g.fillStyle='#9BE854';g.strokeStyle=ink;g.lineWidth=5;g.beginPath();
    g.moveTo(cx-44,140);g.bezierCurveTo(cx-50,60,cx+10,40,cx+50,36);
    g.bezierCurveTo(cx+48,90,cx+10,140,cx-44,140);g.fill();g.stroke();
    g.strokeStyle='#237841';g.lineWidth=5;g.beginPath();g.moveTo(cx-40,136);g.lineTo(cx+36,52);g.stroke();
  }else if(kind==='hex'){
    g.strokeStyle='#DCBE61';g.lineWidth=10;g.beginPath();
    for(let i=0;i<6;i++){const a=Math.PI/6+i*Math.PI/3;g.lineTo(cx+Math.cos(a)*40,92+Math.sin(a)*40);}
    g.closePath();g.stroke();g.fillStyle='#DCBE61';g.beginPath();g.arc(cx,92,10,0,7);g.fill();
  }else if(kind==='crest'){            // a knight's shield
    g.fillStyle='#0055BF';g.strokeStyle='#DCBE61';g.lineWidth=6;g.beginPath();
    g.moveTo(cx-40,44);g.lineTo(cx+40,44);g.lineTo(cx+40,96);g.quadraticCurveTo(cx+40,136,cx,156);
    g.quadraticCurveTo(cx-40,136,cx-40,96);g.closePath();g.fill();g.stroke();
    g.fillStyle='#F2CD37';g.fillRect(cx-7,54,14,90);g.fillRect(cx-30,84,60,14);
  }else if(kind==='stars'){
    const star=(x,y,r)=>{g.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,rr=i%2?r*0.45:r;
      g.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr);}g.closePath();g.fill();};
    g.fillStyle='#F2CD37';star(cx-30,70,20);star(cx+34,108,15);star(cx-6,132,10);
    g.beginPath();g.arc(cx+30,58,20,0,7);g.fill();g.fillStyle=P.shirt;g.beginPath();g.arc(cx+40,52,17,0,7);g.fill();
  }
  // a neckline, so it reads as a suit and not a box
  g.strokeStyle='rgba(0,0,0,.28)';g.lineWidth=6;g.beginPath();g.moveTo(cx-26,0);g.lineTo(cx,24);g.lineTo(cx+26,0);g.stroke();
  t=new T.CanvasTexture(cv); t.colorSpace=T.SRGBColorSpace; t.anisotropy=4;
  PRINTTEX.set(k,t); return t;
}
const FIGGEO={};
function figGeo(name,make){return FIGGEO[name]||(FIGGEO[name]=make());}
function minifig(P){
  const F=FIG, g=new T.Group(), skin=P.skin||'#F2CD37';
  const add=(geo,mat,x,y,z,rx,ry,rz)=>{const m=new T.Mesh(geo,mat);m.position.set(x||0,y||0,z||0);
    if(rx||ry||rz)m.rotation.set(rx||0,ry||0,rz||0);m.castShadow=m.receiveShadow=true;g.add(m);return m;};
  // hips, then the torso: a trapezoid, wider at the shoulders
  add(figGeo('hips',()=>new T.BoxGeometry(F.BW,1.3,F.TD*0.92)),plastic(P.belt||'#1B2A34'),0,F.Y0-0.65,0);
  const torso=figGeo('torso',()=>{
    const s=new T.Shape(); s.moveTo(-F.BW/2,0); s.lineTo(F.BW/2,0); s.lineTo(F.TW/2,F.TH); s.lineTo(-F.TW/2,F.TH); s.closePath();
    const b=0.35, e=new T.ExtrudeGeometry(s,{depth:F.TD-b*2,bevelEnabled:true,bevelThickness:b,bevelSize:b,bevelSegments:2,curveSegments:4});
    e.translate(0,0,-(F.TD-b*2)/2); return e;});
  add(torso,plastic(P.shirt),0,F.Y0,0);
  const chest=new T.Mesh(figGeo('chest',()=>new T.PlaneGeometry(F.TW,F.TH)),
    new T.MeshPhysicalMaterial({map:chestTexture(P),transparent:true,alphaTest:0.5,roughness:0.3,clearcoat:0.8,clearcoatRoughness:0.1}));
  chest.position.set(0,F.Y0+F.TH/2,-F.TD/2-0.03); chest.rotation.y=Math.PI; g.add(chest);
  // neck, head (printed face), stud
  const top=F.Y0+F.TH;
  add(figGeo('neck',()=>new T.CylinderGeometry(1.75,1.75,0.8,20)),plastic(skin),0,top+0.4,0);
  const head=figGeo('head',()=>new T.LatheGeometry(HEADP.map(q=>new T.Vector2(q[0],q[1])),32));
  add(head,new T.MeshPhysicalMaterial({map:faceTexture(P),roughness:0.32,clearcoat:0.8,clearcoatRoughness:0.1,side:T.DoubleSide}),0,top+0.8,0);
  const headTop=top+0.8+F.HH;
  add(figGeo('stud',()=>new T.CylinderGeometry(1.35,1.35,0.9,18)),plastic(skin),0,headTop+0.45,0);
  // arms reaching forward onto the controls, C-shaped hands at the ends
  const armGeo=figGeo('arm',()=>{const c=new T.CapsuleGeometry(1.2,3.4,4,12);c.translate(0,-1.7,0);return c;});
  const handGeo=figGeo('hand',()=>new T.TorusGeometry(0.95,0.5,8,16,Math.PI*1.55));
  const wristGeo=figGeo('wrist',()=>new T.CylinderGeometry(0.62,0.62,0.9,12));
  for(const s of [-1,1]){
    const arm=new T.Group(); arm.position.set(s*(F.TW/2+0.4),top-1.4,0); arm.rotation.set(0.95,0,s*0.2);
    const a=new T.Mesh(armGeo,plastic(P.shirt)); a.castShadow=a.receiveShadow=true; arm.add(a);
    const w=new T.Mesh(wristGeo,plastic(skin)); w.position.y=-4.75; arm.add(w);
    const h=new T.Mesh(handGeo,plastic(skin)); h.position.set(0,-5.9,0); h.rotation.set(0,Math.PI/2,-0.8);
    h.castShadow=true; arm.add(h); g.add(arm);
  }
  const hat=P.hat||'space', hc=P.helmet||'#F4F4F4', base=top+0.8;
  if(hat==='space'){
    // the classic space helmet: a crown, a band with the face cut out, a visor
    const crown=figGeo('crown',()=>new T.LatheGeometry([[3.48,0],[3.2,1.0],[2.6,1.75],[1.7,2.2],[0.6,2.42],[0,2.45]]
      .map(q=>new T.Vector2(q[0],q[1])),32));
    const band=figGeo('band',()=>new T.LatheGeometry([[3.45,0],[3.58,1.4],[3.58,3.0],[3.48,4.3]]
      .map(q=>new T.Vector2(q[0],q[1])),28,Math.PI+1.0,Math.PI*2-2.0));
    const hm=plastic(hc,{side:T.DoubleSide});
    add(crown,hm,0,base+3.9,0); add(band,hm,0,base-0.4,0);
    const visor=figGeo('visor',()=>new T.CylinderGeometry(3.85,3.85,4.2,24,1,true,Math.PI-1.12,2.24));
    const vm=new T.MeshPhysicalMaterial({color:new T.Color(P.visor||'#AEEFEC').convertSRGBToLinear(),
      transparent:true,opacity:0.22,roughness:0.03,clearcoat:1,side:T.DoubleSide,depthWrite:false,envMapIntensity:1.8});
    const v=new T.Mesh(visor,vm); v.position.set(0,base+1.95,0); g.add(v);
    for(const s of [-1,1])add(figGeo('pin',()=>new T.CylinderGeometry(0.55,0.55,0.6,12)),plastic('#6C6E68'),
      s*3.75,base+3.6,0.3,0,0,Math.PI/2);
    // air tanks on the back -- what you see of him from the chase camera
    const tank=figGeo('tank',()=>new T.CapsuleGeometry(0.9,3.0,4,14));
    for(const s of [-1,1])add(tank,plastic(hc),s*1.1,F.Y0+F.TH*0.55,F.TD/2+0.95);
    add(figGeo('bracket',()=>new T.BoxGeometry(4.2,1.0,1.0)),plastic(hc),0,top-1.0,F.TD/2+0.45);
  }else if(hat==='wizard'){
    const brim=figGeo('brim',()=>new T.CylinderGeometry(4.9,4.9,0.45,32));
    add(brim,plastic(hc),0,base+3.9,0,0.06,0,0);
    add(figGeo('hband',()=>new T.CylinderGeometry(3.3,3.4,0.8,28)),plastic(P.belt||'#DCBE61'),0,base+4.4,0);
    const cone=figGeo('cone',()=>{const c=new T.ConeGeometry(3.25,7.8,28,4);c.translate(0,3.9,0);return c;});
    add(cone,plastic(hc),0,base+4.3,0,0.12,0,0.16);
    // a long white beard over the chin and chest
    const beard=figGeo('beard',()=>{const s=new T.Shape();
      s.moveTo(-2.7,0);s.lineTo(2.7,0);s.quadraticCurveTo(2.9,-2.6,0.9,-4.8);s.lineTo(0,-5.8);s.lineTo(-0.9,-4.8);
      s.quadraticCurveTo(-2.9,-2.6,-2.7,0);
      const e=new T.ExtrudeGeometry(s,{depth:0.9,bevelEnabled:true,bevelThickness:0.25,bevelSize:0.25,bevelSegments:2});
      e.translate(0,0,-0.45);return e;});
    add(beard,plastic('#E6E6E6'),0,base+1.55,-F.HR-0.25);
    add(figGeo('stache',()=>new T.CapsuleGeometry(0.42,3.4,4,10)),plastic('#E6E6E6'),0,base+1.75,-F.HR-0.35,0,0,Math.PI/2);
  }else if(hat==='knight'){
    const helm=figGeo('helm',()=>new T.LatheGeometry([[3.15,0],[3.3,0.6],[3.3,4.4],[3.05,5.4],[2.2,6.0],[0,6.15]]
      .map(q=>new T.Vector2(q[0],q[1])),32));
    const steel=plastic(hc,{metalness:0.3,roughness:0.26,clearcoat:0.7,side:T.DoubleSide});
    add(helm,steel,0,base+0.15,0);
    add(figGeo('slit',()=>new T.BoxGeometry(4.6,0.55,0.8)),plastic('#14181C'),0,base+3.1,-3.05);
    add(figGeo('nose',()=>new T.BoxGeometry(0.6,3.2,0.6)),steel,0,base+2.2,-3.35);
    const plume=figGeo('plume',()=>{const sp=new T.SphereGeometry(1,16,12);sp.scale(1.0,1.7,2.6);return sp;});
    add(plume,plastic('#C91A09'),0,base+7.0,0.8,-0.25,0,0);
  }
  return g;
}

/* A piece's identity is its shape, place and base colour -- not the object,
   which the part tables rebuild on every call. Two ships share a piece when
   they share its signature, and that is how the forge knows which bricks just
   arrived. */
export const sig=p=>[p.c,p.r||'',p.ax||'y',p.y,p.h,p.ts===undefined?1:p.ts,
  p.hs?p.hs.join(' '):'',p.pts.map(q=>q[0]+','+q[1]).join(' ')].join('|');

export function buildShipGroup(pieces,TH,inDrop){
  // the pilot's stand-in bricks are swapped for a real minifigure; they still
  // count as covering the studs under him, and still decide when he drops in
  const figs=[], cover=pieces;
  for(const p of pieces)if(p.fig&&p.figAt)figs.push({P:p.fig,at:p.figAt,fall:!!(inDrop&&inDrop(p))});
  pieces=settle(pieces.filter(p=>!p.fig));
  const grp=new T.Group(), drop=new T.Group();
  const aoList=[];
  const byColour=new Map();                        // colour+group -> {geos, studs}
  for(const p of pieces){
    const col=(TH&&!TH.natural&&p.r&&TH[p.r])||p.c;
    const clear=p.r==='glass', falling=!!(inDrop&&inDrop(p));
    const key=col+(clear?'|t':'')+(falling?'|d':'');
    let e=byColour.get(key);
    if(!e){e={col,clear,falling,geos:[],studs:[]};byColour.set(key,e);}
    const geo=pieceGeometry(p);
    e.geos.push(geo);
    aoList.push({geo,box:geo.boundingBox.clone().expandByScalar(-0.35)});
    if(p.studs!==false&&!p.hs&&(p.ts===undefined||p.ts===1)&&(p.ax||'y')==='y'){
      const bb=p._bb||(p._bb=bbox(p.pts)), top=(p.y+p.h)*PLATE-CY;
      for(let sx=Math.floor(bb[0])+0.5;sx<bb[2];sx++)
      for(let sz=Math.floor(bb[1])+0.5;sz<bb[3];sz++){
        if(!inPoly(p.pts,sx,sz))continue;
        if(studCovered(cover,p,sx,sz))continue;
        e.studs.push([sx*STUD, top, sz*STUD-CZ]);
      }
    }
  }
  bakeAO(aoList);
  for(const e of byColour.values()){
    const mat=material(e.col,e.clear), into=e.falling?drop:grp;
    for(const g of e.geos){
      const m=new T.Mesh(g,mat);
      m.castShadow=true; m.receiveShadow=true;
      into.add(m);
    }
    if(e.studs.length){
      const im=new T.InstancedMesh(studGeometry(),mat,e.studs.length);
      const d=new T.Object3D();
      e.studs.forEach((s,i)=>{d.position.set(s[0],s[1],s[2]);d.updateMatrix();
        im.setMatrixAt(i,d.matrix);});
      im.instanceMatrix.needsUpdate=true;
      im.castShadow=true; im.receiveShadow=true;
      into.add(im);
    }
  }
  for(const f of figs){
    const m=minifig(f.P);
    m.position.set(f.at[0]*STUD, f.at[2]*PLATE-CY, f.at[1]*STUD-CZ);
    (f.fall?drop:grp).add(m);
  }
  if(drop.children.length){grp.add(drop);grp.userData.drop=drop;}
  return grp;
}

/* ---------- the scene --------------------------------------------------- */
export function createForge(canvas,opt){
  /* The game draws everything else into a 2D canvas -- sky, UI, part cards --
     so the forge renders to its own surface and that surface is blitted into
     the frame. Keeping the buffer lets the blit happen after the draw call. */
  const renderer=new T.WebGLRenderer({canvas, antialias:true, alpha:true,
    preserveDrawingBuffer:!!(opt&&opt.blit), powerPreference:'high-performance'});
  renderer.outputColorSpace=T.SRGBColorSpace;
  renderer.toneMapping=T.ACESFilmicToneMapping;
  renderer.toneMappingExposure=(opt&&opt.exposure)||1.25;
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=T.PCFSoftShadowMap;
  /* The light is fixed to the model, so spinning the camera cannot change
     where the shadow falls. Re-rendering the shadow map every frame is the
     single most expensive thing on this screen and it produces an identical
     result; render it when the ship changes and leave it alone. */
  renderer.shadowMap.autoUpdate=false;

  const scene=new T.Scene();
  const camera=new T.PerspectiveCamera(32,1,1,4000);

  // A soft box overhead and a cool bounce, the same two lamps the old
  // renderer faked per face -- except these cast real shadows.
  const key=new T.DirectionalLight(0xfff4e2,3.4);
  key.position.set(-180,320,170);
  key.castShadow=true;
  key.shadow.mapSize.set(1024,1024);
  key.shadow.bias=-0.0015;
  key.shadow.normalBias=0.6;
  const cam=key.shadow.camera;
  cam.near=40; cam.far=900; cam.left=-260; cam.right=260; cam.top=260; cam.bottom=-260;
  scene.add(key);
  scene.add(new T.HemisphereLight(0xcfe3ff,0x26304a,1.45));
  const rim=new T.DirectionalLight(0x9fc4ff,0.75);
  rim.position.set(220,120,-220);
  scene.add(rim);

  // A tiny procedural environment so the plastic has something to reflect.
  const pmrem=new T.PMREMGenerator(renderer);
  const envScene=new T.Scene();
  (function(){
    const box=new T.BoxGeometry(1,1,1);
    const lite=(c,i)=>new T.MeshBasicMaterial({color:new T.Color(c).multiplyScalar(i)});
    const room=new T.Mesh(box,new T.MeshBasicMaterial({color:0x1b2436,side:T.BackSide}));
    room.scale.setScalar(40); envScene.add(room);
    const panel=(x,y,z,sx,sy,sz,c,i)=>{const m=new T.Mesh(box,lite(c,i));
      m.position.set(x,y,z);m.scale.set(sx,sy,sz);envScene.add(m);};
    panel(0,16,0, 22,0.4,22, 0xffffff,2.6);        // the soft box
    panel(-14,2,8, 0.4,10,14, 0x9ec8ff,1.1);       // cool wall
    panel(14,0,-8, 0.4,10,14, 0xffd7a8,0.65);      // warm bounce
    panel(0,-15,0, 30,0.4,30, 0x0a0e18,1.0);       // dark floor
  })();
  scene.environment=pmrem.fromScene(envScene,0.04).texture;
  envScene.traverse(o=>{if(o.geometry)o.geometry.dispose();});
  pmrem.dispose();

  // The pad the model sits on: invisible, but it catches the shadow.
  const pad=new T.Mesh(new T.PlaneGeometry(1400,1400),
    new T.ShadowMaterial({opacity:0.52, color:0x00040e}));
  pad.rotation.x=-Math.PI/2;
  pad.receiveShadow=true;
  // A thumbnail is a part on a card, not an object on a table: it wants no
  // ground under it.
  if(!(opt&&opt.pad===false))scene.add(pad);

  let zoomK=(opt&&opt.zoom)||1;
  let model=null, radius=140, centre=new T.Vector3(), hull=new Float32Array(0);
  const V=new T.Vector3(), R=new T.Vector3(), U=new T.Vector3(), aim=new T.Vector3();

  /* The points the camera has to keep on screen. A bounding box is a bad
     stand-in for a ship shaped like a cross -- its corners are empty air, and
     fitting them is what left the model sitting small in the middle of the
     screen. Collect the real vertices instead, thinned to a one-unit grid so
     the per-frame fit stays cheap. */
  function hullPoints(root){
    const seen=new Set(), out=[], v=new T.Vector3();
    const keep=(x,y,z)=>{
      const k=(Math.round(x)+2048)+','+(Math.round(y)+2048)+','+(Math.round(z)+2048);
      if(seen.has(k))return; seen.add(k); out.push(x,y,z);
    };
    root.traverse(o=>{
      if(!o.geometry)return;
      const pos=o.geometry.getAttribute('position'); if(!pos)return;
      if(o.isInstancedMesh){
        const m=new T.Matrix4();
        for(let i=0;i<o.count;i++){
          o.getMatrixAt(i,m);
          const x=m.elements[12], y=m.elements[13], z=m.elements[14];
          keep(x-STUD_R,y,z-STUD_R); keep(x+STUD_R,y,z-STUD_R);
          keep(x-STUD_R,y+STUD_H,z+STUD_R); keep(x+STUD_R,y+STUD_H,z+STUD_R);
        }
      }else{
        const mw=o.matrixWorld;
        for(let i=0;i<pos.count;i++){v.fromBufferAttribute(pos,i).applyMatrix4(mw);keep(v.x,v.y,v.z);}
      }
    });
    return new Float32Array(out);
  }
  let yaw=0.7, pitch=0.38, spin=0;

  /* THE BUILD TABLE. The camera used to refit itself to whatever was on the
     pad, so every part that snapped on zoomed the view out -- the ship you
     were building kept shrinking away from you. A frame fixes the camera to
     everything that COULD be built, and the ship grows into it instead.
     Points are the corners of every candidate piece, thinned to a grid. */
  let frame=null, frameAim=new T.Vector3(), frameR=140, frameLow=0;
  const frameD=new Map();
  function setFrame(pieces){
    const seen=new Set(), pts=[];
    let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9,z0=1e9,z1=-1e9;
    const put=(x,y,z)=>{
      const k=Math.round(x/2)+','+Math.round(y/2)+','+Math.round(z/2);
      if(seen.has(k))return; seen.add(k); pts.push(x,y,z);
      if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;if(z<z0)z0=z;if(z>z1)z1=z;};
    for(const p of pieces){
      const ax=p.ax||'y';
      for(let k=0;k<p.pts.length;k++){
        const q=p.pts[k], th=p.hs?p.hs[k]:p.h;
        if(ax==='y'){ put(q[0]*STUD,p.y*PLATE-CY,q[1]*STUD-CZ);
                      put(q[0]*STUD,(p.y+th)*PLATE-CY+STUD_H,q[1]*STUD-CZ); }
        else        { put(q[0]*STUD,q[1]*PLATE-CY,p.y*STUD-CZ);
                      put(q[0]*STUD,q[1]*PLATE-CY,(p.y+th)*STUD-CZ); }
      }
    }
    if(!pts.length){frame=null;return;}
    frame=new Float32Array(pts); frameD.clear();
    frameAim.set((x0+x1)/2,(y0+y1)/2,(z0+z1)/2);
    frameR=Math.max(40,Math.hypot(x1-x0,y1-y0,z1-z0)/2);
    frameLow=y0;
    pad.position.y=frameLow-1.5;
    renderer.shadowMap.needsUpdate=true;
  }
  /* The distance depends on the frame and the angle, never on the ship: a
     part snapping on cannot move the camera. Fitting the single widest
     angle of a whole turn left the ship small at every other angle (on a
     phone the diagonal of a cross-shaped ship is half again its width), so
     instead each angle gets its own fit, widened over a window either side
     and blended, which turns it into a slow, gentle push-in as the ship
     comes round rather than a jump. */
  const NY=48;
  function fitAt(yw,pt,tv,th){
    const cp=Math.cos(pt), spt=Math.sin(pt);
    const vx=Math.sin(yw)*cp, vy=spt, vz=Math.cos(yw)*cp;
    let rx=vz, rz=-vx; const rl=Math.hypot(rx,rz)||1; rx/=rl; rz/=rl;
    const ux=-rz*vy, uy=rz*vx-rx*vz, uz=rx*vy;      // R x V
    let d=frameR*0.4;
    for(let i=0;i<frame.length;i+=3){
      const ex=frame[i]-frameAim.x, ey=frame[i+1]-frameAim.y, ez=frame[i+2]-frameAim.z;
      const along=ex*vx+ey*vy+ez*vz;
      const a=along+Math.abs(ex*rx+ez*rz)/th;           if(a>d)d=a;
      const b=along+Math.abs(ex*ux+ey*uy+ez*uz)/tv;     if(b>d)d=b;
    }
    return d;
  }
  function frameDistance(pt,aspect,vr,hr,yw){
    const k=Math.round(pt*40)+'|'+Math.round(aspect*24);
    let tab=frameD.get(k);
    if(!tab){
      const tv=Math.tan(vr), th=Math.tan(hr)*1.04, raw=[];
      for(let j=0;j<NY;j++)raw.push(fitAt(j/NY*Math.PI*2,pt,tv,th));
      tab=raw.map((_,j)=>{let m=0;for(let o=-2;o<=2;o++)m=Math.max(m,raw[(j+o+NY)%NY]);return m;});
      frameD.set(k,tab);
    }
    const u=((yw/(Math.PI*2))%1+1)%1*NY, j=Math.floor(u)%NY, f=u-Math.floor(u);
    const sm=f*f*(3-2*f);
    return tab[j]*(1-sm)+tab[(j+1)%NY]*sm;
  }

  /* SNAP. Whatever is new since the last ship falls onto it from above and
     lands with a bounce. That arrival is the whole Lego moment -- before,
     the bricks just appeared. */
  let lastSigs=null, drop=null, dropT0=0, dropH=0, landed=true, onLand=null;
  const DROP_FALL=290, DROP_BOUNCE=230;
  function setShip(pieces,TH,animate){
    if(model){scene.remove(model);}
    const sigs=new Set(pieces.map(sig)), prev=lastSigs;
    const inDrop=animate?(p=>!prev||!prev.has(sig(p))):null;
    lastSigs=sigs;
    model=buildShipGroup(pieces,TH,inDrop);
    scene.add(model);
    drop=model.userData.drop||null;
    model.updateMatrixWorld(true);
    const box=new T.Box3().setFromObject(model);
    hull=hullPoints(model);                         // measured with everything in its final place
    if(drop){dropT0=performance.now();dropH=(frame?frameR:radius)*0.62;
      drop.position.y=dropH;landed=false;}
    if(box.isEmpty()){radius=140;centre.set(0,0,0);}
    else{
      box.getCenter(centre);
      radius=Math.max(40,box.getSize(new T.Vector3()).length()*0.5);
      if(!frame)pad.position.y=box.min.y-1.5;
    }
    renderer.shadowMap.needsUpdate=true;
  }
  function stepDrop(){
    if(!drop||drop.position.y===0&&landed)return;
    const u=performance.now()-dropT0;
    let y;
    if(u<DROP_FALL){const k=u/DROP_FALL; y=dropH*(1-k*k);}             // falling, speeding up
    else{
      if(!landed){landed=true; if(onLand)onLand(dropPoint());}
      const k=(u-DROP_FALL)/DROP_BOUNCE;
      y=k>=1?0:dropH*0.075*Math.sin(Math.PI*k)*(1-k*0.4);              // one small hop
    }
    drop.position.y=y;
    renderer.shadowMap.needsUpdate=true;
  }
  // where the new part came down, as a fraction of the canvas -- for the sparkle
  const _dp=new T.Vector3(), _db=new T.Box3();
  function dropPoint(){
    if(!drop)return null;
    _db.setFromObject(drop); if(_db.isEmpty())return null;
    _db.getCenter(_dp); _dp.y=_db.min.y-drop.position.y; _dp.project(camera);
    return {x:(_dp.x+1)/2, y:(1-_dp.y)/2};
  }
  function drag(dx,dy){
    yaw-=dx*0.009;
    pitch=Math.max(0.06,Math.min(1.25,pitch+dy*0.006));
    spin=0;
  }
  function glide(v){spin=v;}

  function render(w,h,dpr,t){
    if(renderer.domElement.width!==Math.round(w*dpr)||
       renderer.domElement.height!==Math.round(h*dpr)){
      renderer.setPixelRatio(dpr);
      renderer.setSize(w,h,false);
    }
    if(spin){yaw+=spin;spin*=0.96;if(Math.abs(spin)<0.0004)spin=0;}
    camera.aspect=w/h;
    // A longer lens on the build table: less perspective, so the near wingtip
    // does not balloon and set the fit for the whole ship.
    camera.fov=frame?25:32;
    camera.updateProjectionMatrix();
    /* Fit the eight corners of the model, not a sphere around it. A ship is
       wide and flat, so its bounding sphere is mostly empty air -- fitting
       that is why the model sat small in the middle of the screen. */
    const vr=camera.fov*Math.PI/360, hr=Math.atan(Math.tan(vr)*camera.aspect);
    const tv=Math.tan(vr), th=Math.tan(hr);
    V.set(Math.sin(yaw)*Math.cos(pitch), Math.sin(pitch), Math.cos(yaw)*Math.cos(pitch))
     .normalize();
    R.set(V.z,0,-V.x); if(R.lengthSq()<1e-6)R.set(1,0,0); R.normalize();
    U.crossVectors(R,V).normalize();
    stepDrop();
    const vx=V.x,vy=V.y,vz=V.z, rx=R.x,ry=R.y,rz=R.z, ux=U.x,uy=U.y,uz=U.z;
    if(frame){
      const d=frameDistance(pitch,camera.aspect,vr,hr,yaw)/zoomK;
      camera.position.copy(frameAim).addScaledVector(V,d);
      camera.lookAt(frameAim);
      lightAround(frameAim,frameR);
      renderer.render(scene,camera);
      return;
    }
    /* Aim at the middle of the silhouette, not the middle of the model. They
       are different for a ship with long wings and a tall fin, and aiming at
       the model is what left a band of empty sky above it. */
    let r0=1e9,r1=-1e9,u0=1e9,u1=-1e9;
    for(let i=0;i<hull.length;i+=3){
      const ex=hull[i]-centre.x, ey=hull[i+1]-centre.y, ez=hull[i+2]-centre.z;
      const a=ex*rx+ey*ry+ez*rz, b=ex*ux+ey*uy+ez*uz;
      if(a<r0)r0=a; if(a>r1)r1=a; if(b<u0)u0=b; if(b>u1)u1=b;
    }
    const mr=hull.length?(r0+r1)*0.5:0, mu=hull.length?(u0+u1)*0.5:0;
    aim.copy(centre).addScaledVector(R,mr).addScaledVector(U,mu);
    let d=radius*0.4;
    for(let i=0;i<hull.length;i+=3){
      const ex=hull[i]-aim.x, ey=hull[i+1]-aim.y, ez=hull[i+2]-aim.z;
      const along=ex*vx+ey*vy+ez*vz;
      const a=along+Math.abs(ex*rx+ey*ry+ez*rz)/th;  if(a>d)d=a;
      const b=along+Math.abs(ex*ux+ey*uy+ez*uz)/tv;  if(b>d)d=b;
    }
    d*=1.05/zoomK;
    camera.position.copy(aim).addScaledVector(V,d);
    camera.lookAt(aim);
    lightAround(centre,radius);
    renderer.render(scene,camera);
  }
  // The lamp hangs over the table, not over the model -- on a fixed frame it
  // stays put while parts arrive, so nothing on screen moves but the part.
  function lightAround(c,r){
    key.position.set(c.x-r*1.1, c.y+r*2.2, c.z+r*1.2);
    if(!key.target.parent)scene.add(key.target);
    if(!key.target.position.equals(c)){key.target.position.copy(c);key.target.updateMatrixWorld();
      renderer.shadowMap.needsUpdate=true;}
    // Wrap the shadow frustum tight around the model: the same 1024 map spread
    // over a quarter of the area is a far crisper contact shadow.
    const sc=key.shadow.camera, e=r*1.15;
    if(sc.right!==e){sc.left=-e;sc.right=e;sc.top=e;sc.bottom=-e;
      sc.near=r*0.5; sc.far=r*6; sc.updateProjectionMatrix();
      renderer.shadowMap.needsUpdate=true;}
  }

  /* FLIGHT SPRITES. The flight scene is still a 2D canvas, and its hitbox,
     exhaust and everything else were placed with the old projection. So the
     3D ship is rendered through a camera that reproduces that projection
     exactly -- same elevation, same perspective distance, same scale at the
     origin -- and the image drops into the slot the old sprite filled. The
     one thing it adds is a real bank: the ship rolls into a turn, which a
     sprite turned on a turntable could only ever fake.
     tilt/rise/camd are the 2D projection's own constants. */
  const _sv=new T.Vector3(), _su=new T.Vector3(), _sr=new T.Vector3(), _sp=new T.Vector3();
  function sprite(roll,ppu,P2){
    if(!model||!hull.length)return null;
    const L=Math.hypot(P2.tilt,P2.rise), D=P2.camd/L;
    _sv.set(0,P2.tilt/L,P2.rise/L); _su.set(0,P2.rise/L,-P2.tilt/L); _sr.set(1,0,0);
    model.rotation.z=roll; model.updateMatrixWorld(true);
    const cr=Math.cos(roll), sr=Math.sin(roll);
    let X0=1e9,X1=-1e9,Y0=1e9,Y1=-1e9;
    for(let i=0;i<hull.length;i+=3){
      const x=hull[i]*cr-hull[i+1]*sr, y=hull[i]*sr+hull[i+1]*cr, z=hull[i+2];
      const dep=D-(y*_sv.y+z*_sv.z), X=x*D/dep, Y=(y*_su.y+z*_su.z)*D/dep;
      if(X<X0)X0=X;if(X>X1)X1=X;if(Y<Y0)Y0=Y;if(Y>Y1)Y1=Y;
    }
    X0-=3;X1+=3;Y0-=3;Y1+=3;
    const w=Math.max(8,Math.round((X1-X0)*ppu)), h=Math.max(8,Math.round((Y1-Y0)*L*ppu));
    renderer.setPixelRatio(1); renderer.setSize(w,h,false);
    const near=2;
    camera.position.copy(_sv).multiplyScalar(D); camera.up.set(0,1,0); camera.lookAt(0,0,0);
    camera.projectionMatrix.makePerspective(X0*near/D,X1*near/D,Y1*near/D,Y0*near/D,near,6000);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    lightAround(centre,radius);
    renderer.shadowMap.needsUpdate=true;
    renderer.render(scene,camera);
    model.rotation.z=0; model.updateMatrixWorld(true);
    const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
    cv.getContext('2d').drawImage(renderer.domElement,0,0);
    // in the 2D projection's units: x as is, y stretched by its tilt/rise length
    return {cv, ox:X0, oy:-Y1*L, w:X1-X0, h:(Y1-Y0)*L};
  }

  return {setShip, setFrame, drag, glide, render, dropPoint, sprite,
    set onLand(f){onLand=f;}, get dropping(){return !!drop&&!landed;},
    get yaw(){return yaw;}, set yaw(v){yaw=v;},
    get pitch(){return pitch;}, set pitch(v){pitch=v;}, set zoom(v){zoomK=v;},
    renderer, scene, camera};
}
