/* =======================================================================
   THE FLIGHT, IN 3D
   The build screen went 3D but the flight -- where a kid spends most of his
   time -- was still flat drawings: sprite rocks, painted gems, a starfield of
   streaks. This draws the play field with the same renderer and the same
   bricks, on its own canvas UNDER the 2D one. Gameplay is untouched: every
   object keeps its screen position in pixels and this camera puts it exactly
   there, so collisions, the HUD and the 2D effects on top still line up.

   - an orthographic camera tilted over the play field: a pixel on screen is
     a fixed place on the field, so nothing drifts away from its hitbox;
   - a separate perspective pass behind it for the stars and nebula, which is
     where real depth helps and nothing has to line up;
   - rocks are the actual brick clusters, tumbling; break one and its bricks
     fly apart. Crash the ship and it comes apart into what you built.
   ======================================================================= */
import * as T from './three.module.min.js';
import {buildShipGroup, minifig} from './build3d.js';
import {STUD,PLATE,CZ,CY} from './parts.js';

const ELEV=0.9;                         // camera elevation over the field (rad); ~52 degrees
const SE=Math.sin(ELEV), CE=Math.cos(ELEV);

function dotTexture(){
  const c=document.createElement('canvas');c.width=c.height=64;
  const g=c.getContext('2d'),r=g.createRadialGradient(32,32,0,32,32,32);
  r.addColorStop(0,'rgba(255,255,255,1)');r.addColorStop(0.25,'rgba(255,255,255,.85)');
  r.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=r;g.fillRect(0,0,64,64);
  const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;return t;
}
// soft overlapping clouds in a couple of colours, tiling top to bottom
function nebulaTexture(cols,seed){
  let s=seed*9301+49297;const rnd=()=>{s=(s*9301+49297)%233280;return s/233280;};
  const S=512,c=document.createElement('canvas');c.width=c.height=S;const g=c.getContext('2d');
  g.globalCompositeOperation='lighter';
  for(let i=0;i<46;i++){
    const x=rnd()*S,y=rnd()*S,r=50+rnd()*170,col=cols[i%cols.length],a=0.05+rnd()*0.09;
    for(const ox of [-S,0,S])for(const oy of [-S,0,S]){   // nine times, so it tiles both ways with no seam
      const gr=g.createRadialGradient(x+ox,y+oy,0,x+ox,y+oy,r);
      gr.addColorStop(0,col.replace('A',a.toFixed(3)));gr.addColorStop(1,col.replace('A','0'));
      g.fillStyle=gr;g.fillRect(x+ox-r,y+oy-r,r*2,r*2);}
  }
  const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;
  t.wrapS=t.wrapT=T.RepeatWrapping;return t;
}
// a few looks for space itself, so levels do not all sit in the same blue
const SKIES=[
  {neb:['rgba(70,110,255,A)','rgba(150,70,220,A)'],bg:0x050a1c},
  {neb:['rgba(40,200,190,A)','rgba(60,120,255,A)'],bg:0x041318},
  {neb:['rgba(255,90,140,A)','rgba(140,60,220,A)'],bg:0x12061a},
  {neb:['rgba(255,140,50,A)','rgba(220,60,60,A)'],bg:0x170806},
  {neb:['rgba(120,230,90,A)','rgba(40,140,200,A)'],bg:0x04140c},
];

/* One draw call per colour instead of one per brick. A ship is ~150 bricks
   and the field can hold a dozen rocks; on an older tablet the call count,
   not the triangle count, is what costs frames. Only plain brick meshes are
   merged -- studs are already instanced and the pilot is his own group. The
   unmerged original is kept for the moment it explodes. */
function mergeGroup(src){
  const out=new T.Group(), byMat=new Map();
  for(const c of src.children){
    const g=c.geometry;
    if(c.isMesh&&!c.isInstancedMesh&&g&&!g.index&&g.getAttribute('normal')&&g.getAttribute('color')){
      let a=byMat.get(c.material);if(!a){a=[];byMat.set(c.material,a);}a.push(c);
    }else out.add(c.clone());
  }
  for(const [mat,list] of byMat){
    let n=0;for(const c of list)n+=c.geometry.getAttribute('position').count;
    const P=new Float32Array(n*3),N=new Float32Array(n*3),C=new Float32Array(n*3);
    let o=0;const v=new T.Vector3(),nm=new T.Matrix3();
    for(const c of list){c.updateMatrix();nm.getNormalMatrix(c.matrix);
      const gp=c.geometry.getAttribute('position'),gn=c.geometry.getAttribute('normal'),gc=c.geometry.getAttribute('color');
      for(let i=0;i<gp.count;i++,o++){
        v.fromBufferAttribute(gp,i).applyMatrix4(c.matrix);P[o*3]=v.x;P[o*3+1]=v.y;P[o*3+2]=v.z;
        v.fromBufferAttribute(gn,i).applyMatrix3(nm).normalize();N[o*3]=v.x;N[o*3+1]=v.y;N[o*3+2]=v.z;
        C[o*3]=gc.getX(i);C[o*3+1]=gc.getY(i);C[o*3+2]=gc.getZ(i);}}
    const g=new T.BufferGeometry();
    g.setAttribute('position',new T.BufferAttribute(P,3));g.setAttribute('normal',new T.BufferAttribute(N,3));
    g.setAttribute('color',new T.BufferAttribute(C,3));
    out.add(new T.Mesh(g,mat));
  }
  return out;
}

export function createFlight(canvas,data){
  const renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.outputColorSpace=T.SRGBColorSpace;
  renderer.toneMapping=T.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.3;
  renderer.autoClear=false;

  /* ---- the field ---- */
  const scene=new T.Scene();
  const cam=new T.OrthographicCamera(-1,1,1,-1,-4000,4000);
  cam.position.set(0,1000*SE,1000*CE); cam.lookAt(0,0,0);
  scene.add(new T.HemisphereLight(0xcfe3ff,0x2a2440,1.5));
  const key=new T.DirectionalLight(0xfff2de,3.0); key.position.set(-300,700,450); scene.add(key);
  const rim=new T.DirectionalLight(0x8fb8ff,1.1); rim.position.set(400,200,-600); scene.add(rim);
  (function(){                          // the same little studio the forge reflects
    const pm=new T.PMREMGenerator(renderer), es=new T.Scene(), box=new T.BoxGeometry(1,1,1);
    const lite=(c,i)=>new T.MeshBasicMaterial({color:new T.Color(c).multiplyScalar(i)});
    const room=new T.Mesh(box,new T.MeshBasicMaterial({color:0x141b2c,side:T.BackSide}));
    room.scale.setScalar(40);es.add(room);
    const panel=(x,y,z,sx,sy,sz,c,i)=>{const m=new T.Mesh(box,lite(c,i));m.position.set(x,y,z);m.scale.set(sx,sy,sz);es.add(m);};
    panel(0,16,0,22,0.4,22,0xffffff,2.4);panel(-14,2,8,0.4,10,14,0x9ec8ff,1.2);panel(14,0,-8,0.4,10,14,0xffd7a8,0.6);
    scene.environment=pm.fromScene(es,0.04).texture;pm.dispose();
  })();

  /* ---- deep space behind it ---- */
  const bg=new T.Scene();
  const bgCam=new T.PerspectiveCamera(62,1,1,9000);
  bgCam.rotation.x=-ELEV;
  const dot=dotTexture();
  const layers=[];
  for(const [n,size,depth,col] of [[1100,9,2600,0xbcd4ff],[380,16,1500,0xffffff],[90,26,700,0xffffff]]){
    const pos=new Float32Array(n*3);
    for(let i=0;i<n;i++){pos[i*3]=(Math.random()-0.5)*depth*6;pos[i*3+1]=-depth*(0.7+Math.random()*0.6);
      pos[i*3+2]=-depth*3+Math.random()*depth*3.4;}
    const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(pos,3));
    const m=new T.PointsMaterial({size,map:dot,color:col,transparent:true,depthWrite:false,
      blending:T.AdditiveBlending,sizeAttenuation:true});
    const p=new T.Points(g,m);bg.add(p);layers.push({p,pos,n,depth,span:depth*3.4,z1:depth*0.4});
  }
  const neb=new T.Mesh(new T.PlaneGeometry(64000,64000),
    new T.MeshBasicMaterial({transparent:true,depthWrite:false,blending:T.AdditiveBlending,opacity:0.8}));
  neb.rotation.x=-Math.PI/2; neb.position.y=-3800; bg.add(neb);
  let skyIx=-1;
  function setSky(i){i=((i%SKIES.length)+SKIES.length)%SKIES.length;if(i===skyIx)return;skyIx=i;
    const S=SKIES[i];if(neb.material.map)neb.material.map.dispose();
    neb.material.map=nebulaTexture(S.neb,i+3);neb.material.map.repeat.set(9,9);neb.material.needsUpdate=true;
    bg.background=new T.Color(S.bg);}
  setSky(0);

  /* ---- what lives on the field ---- */
  let W=1,H=1;
  const toWorld=(x,y,o)=>o.set(x-W/2,0,(y-H/2)/SE);
  // rocks: the real brick clusters, centred, one prototype per kind
  const rockSrc=[];
  const rockProto=(data.rocks||[]).map(ps=>{
    const g=buildShipGroup(ps,null), box=new T.Box3().setFromObject(g), c=new T.Vector3(), sz=new T.Vector3();
    box.getCenter(c);box.getSize(sz);
    const mg=mergeGroup(g);mg.position.copy(c).negate();g.position.copy(c).negate();
    const src=new T.Group();src.add(g);rockSrc.push(src);
    const w=new T.Group();w.add(mg);w.userData.ext=Math.max(sz.x,sz.z);return w;});
  let bossProto=null;
  if(data.boss){const g=buildShipGroup(data.boss,null),box=new T.Box3().setFromObject(g),c=new T.Vector3(),sz=new T.Vector3();
    box.getCenter(c);box.getSize(sz);
    const eyeM=new T.MeshBasicMaterial({color:0xffe14a});
    for(const e of [[-5,7],[5,7]]){const m=new T.Mesh(new T.SphereGeometry(8,16,12),eyeM);
      m.position.set(e[0]*STUD,17*PLATE-CY+4,e[1]*STUD-CZ-14);g.add(m);}
    g.position.sub(c);bossProto=new T.Group();bossProto.add(g);bossProto.userData.ext=Math.max(sz.x,sz.z);}
  // a drone is a machine, not a rock: a dark saucer with a red eye
  const droneProto=(function(){const g=new T.Group();
    const hull=new T.MeshPhysicalMaterial({color:0x2b333b,roughness:0.35,metalness:0.4,clearcoat:0.6});
    const trim=new T.MeshPhysicalMaterial({color:0x6c6e68,roughness:0.3,metalness:0.5});
    const a=new T.Mesh(new T.CylinderGeometry(20,24,7,28),hull);g.add(a);
    const r=new T.Mesh(new T.TorusGeometry(22,2.2,8,32),trim);r.rotation.x=Math.PI/2;g.add(r);
    const d=new T.Mesh(new T.SphereGeometry(11,20,12,0,Math.PI*2,0,Math.PI/2),hull);d.position.y=3;g.add(d);
    const e=new T.Mesh(new T.SphereGeometry(5,14,10),new T.MeshBasicMaterial({color:0xff3030}));
    e.position.set(0,6,-9);g.add(e);g.userData.ext=48;return g;})();   // eye is children[3]
  // gems: faceted, lit from inside, with a soft glow round them
  const gemGeo=new T.OctahedronGeometry(1,0);
  const gemMat={g:new T.MeshStandardMaterial({color:0x2fe85a,emissive:0x16b836,emissiveIntensity:0.8,roughness:0.12,metalness:0.1,flatShading:true}),
                y:new T.MeshStandardMaterial({color:0xffd23f,emissive:0xd99a00,emissiveIntensity:0.6,roughness:0.1,metalness:0.3,flatShading:true})};
  const glowMat={g:new T.SpriteMaterial({map:dot,color:0x5cff78,transparent:true,opacity:0.5,blending:T.AdditiveBlending,depthWrite:false}),
                 y:new T.SpriteMaterial({map:dot,color:0xffd23f,transparent:true,opacity:0.55,blending:T.AdditiveBlending,depthWrite:false}),
                 o:new T.SpriteMaterial({map:dot,color:0xff8a30,transparent:true,opacity:0.7,blending:T.AdditiveBlending,depthWrite:false})};
  function makeGem(gold){const g=new T.Group(),m=new T.Mesh(gemGeo,gold?gemMat.y:gemMat.g),h=new T.Sprite(gold?glowMat.y:glowMat.g);
    g.add(m);g.add(h);g.userData.m=m;g.userData.h=h;return g;}

  /* ---- keeping meshes in step with the game's objects ---- */
  const live=new Map();                 // game object -> mesh
  let stamp=0;
  function track(o,make){let e=live.get(o);if(!e){e={m:make(),s:0};scene.add(e.m);live.set(o,e);}e.s=stamp;return e.m;}
  function sweep(){for(const [o,e] of live)if(e.s!==stamp){scene.remove(e.m);live.delete(o);}}

  let shipG=null,shipSrc=null,shipKey='';
  function setShip(pieces,TH,k){if(k===shipKey&&shipG)return;shipKey=k;
    if(shipG)scene.remove(shipG);shipSrc=buildShipGroup(pieces,TH);shipG=mergeGroup(shipSrc);scene.add(shipG);}

  /* ---- bricks flying apart ---- */
  const debris=[];
  const _p=new T.Vector3(),_q=new T.Quaternion(),_s=new T.Vector3(),_c=new T.Vector3();
  function shatter(src,power,max){
    if(!src)return;src.updateMatrixWorld(true);
    new T.Box3().setFromObject(src).getCenter(_c);
    const parts=[];src.traverse(o=>{if(o.isMesh&&!o.isInstancedMesh&&o.geometry&&o.material&&!o.isSprite)parts.push(o);});
    const step=Math.max(1,Math.ceil(parts.length/(max||60)));
    for(let i=0;i<parts.length;i+=step){const o=parts[i];
      o.matrixWorld.decompose(_p,_q,_s);
      const m=new T.Mesh(o.geometry,o.material);m.position.copy(_p);m.quaternion.copy(_q);m.scale.copy(_s);
      const dir=_p.clone().sub(_c);dir.y=0;if(dir.lengthSq()<1e-4)dir.set(Math.random()-0.5,0,Math.random()-0.5);
      dir.normalize().multiplyScalar(power*(0.5+Math.random()));dir.y=power*(0.6+Math.random()*0.9);
      const life=46+Math.random()*30;
      debris.push({m,v:dir,w:new T.Vector3((Math.random()-0.5)*0.3,(Math.random()-0.5)*0.3,(Math.random()-0.5)*0.3),
        life,max:life,s0:_s.clone()});
      scene.add(m);
    }
    while(debris.length>420){const d=debris.shift();scene.remove(d.m);}
  }
  function stepDebris(k,scroll){
    for(let i=debris.length-1;i>=0;i--){const d=debris[i];
      d.m.position.addScaledVector(d.v,k);d.m.position.z+=scroll*k/SE*0.6;d.v.y-=0.12*k;d.v.multiplyScalar(Math.pow(0.985,k));
      d.m.rotation.x+=d.w.x*k;d.m.rotation.y+=d.w.y*k;d.m.rotation.z+=d.w.z*k;
      d.life-=k;const f=d.life/d.max;if(f<0.4)d.m.scale.copy(d.s0).multiplyScalar(Math.max(0.01,f/0.4));
      if(d.life<=0){scene.remove(d.m);debris.splice(i,1);}}
  }

  /* ---- each frame ---- */
  let lastT=performance.now(), t=0;
  const V=new T.Vector3();
  function frame(st){
    const now=performance.now(),k=Math.min(3,(now-lastT)/16.67);lastT=now;t+=k;
    if(W!==st.W||H!==st.H||renderer.getPixelRatio()!==st.dpr){W=st.W;H=st.H;
      renderer.setPixelRatio(st.dpr);renderer.setSize(W,H,false);
      cam.left=-W/2;cam.right=W/2;cam.top=H/2;cam.bottom=-H/2;cam.updateProjectionMatrix();
      bgCam.aspect=W/H;bgCam.updateProjectionMatrix();}
    if(st.sky!==undefined)setSky(st.sky);
    // the camera carries the shake, so the whole field shakes together
    cam.position.set(st.shakeX||0,1000*SE,1000*CE-(st.shakeY||0)/SE);
    cam.lookAt(st.shakeX||0,0,-(st.shakeY||0)/SE);
    stamp++;
    // stars stream past at the speed of the level, the near ones faster
    for(const L of layers){const a=L.pos,dz=st.speed*k*(1.2+2600/L.depth*0.5);
      for(let i=0;i<L.n;i++){a[i*3+2]+=dz;if(a[i*3+2]>L.z1)a[i*3+2]-=L.span;}
      L.p.geometry.attributes.position.needsUpdate=true;}
    if(neb.material.map)neb.material.map.offset.y+=st.speed*k*0.00018;

    for(const o of st.rocks){
      let m;
      if(o.drone){m=track(o,()=>droneProto.clone());m.scale.setScalar(o.w/48);
        m.rotation.y=Math.atan2(st.ship.x-o.x,-(st.ship.y-o.y))||0;
        m.children[3].scale.setScalar(0.8+0.3*Math.sin(t*0.15));}
      else{
        const P=rockProto[o.rock%rockProto.length];
        m=track(o,()=>{const c=P.clone();if(o.spit){const s=new T.Sprite(glowMat.o);s.scale.setScalar(60);c.add(s);c.userData.core=s;}return c;});
        const sc=o.w*0.95/P.userData.ext*(1+(o.hitT||0)*0.025);
        m.scale.setScalar(sc);m.rotation.set(Math.sin(o.spin)*0.6,o.spin,Math.cos(o.spin*0.7)*0.3);
        if(m.userData.core){const tt=Math.min(1,(o.spitT||0)/72);m.userData.core.material.opacity=0.35+tt*0.6;
          m.userData.core.scale.setScalar((40+tt*40)/sc);}
      }
      toWorld(o.x,o.y,m.position);m.position.y=8;
    }
    for(const g of st.gems){if(g.got)continue;
      const m=track(g,()=>makeGem(g.gold));
      toWorld(g.x,g.y,m.position);m.position.y=14;
      const r=g.r,tw=0.8+0.2*Math.sin(g.spin*3);
      m.userData.m.scale.set(r*0.8,r*1.2/CE,r*0.8);m.userData.m.rotation.y=g.spin*1.4;
      m.userData.h.scale.setScalar(r*4.4*tw);
    }
    if(st.boss&&bossProto){const b=st.boss,m=track(b,()=>bossProto.clone());
      m.scale.setScalar(b.r*2.15/bossProto.userData.ext*(1+(b.hitT||0)*0.02));
      m.rotation.set(0,Math.sin(b.sway)*0.35,0);toWorld(b.x,b.y,m.position);m.position.y=10;}
    for(const r of st.rescues||[]){
      const m=track(r,()=>{const g=new T.Group(),f=minifig(r.P);g.add(f);g.userData.f=f;
        const h=new T.Sprite(glowMat.y);h.scale.setScalar(28);g.add(h);return g;});
      m.scale.setScalar(3.4);toWorld(r.x,r.y,m.position);m.position.y=30;
      // leaning back to face up at the camera, turning slowly, waving both arms
      m.rotation.x=-(Math.PI/2-ELEV)-0.25;
      m.userData.f.rotation.set(Math.sin(r.spin)*0.25,Math.PI+Math.sin(r.spin*0.7)*0.6,Math.cos(r.spin*0.6)*0.25);
      m.userData.f.children.forEach(c=>{if(c.isGroup&&c.children.length===3)
        c.rotation.x=Math.PI-0.45+Math.sin(t*0.25+c.position.x)*0.55;});        // up over his head
    }
    if(shipG){shipG.visible=st.ship.vis;
      toWorld(st.ship.x,st.ship.y,shipG.position);shipG.position.y=20;
      shipG.scale.setScalar(st.ship.s);shipG.rotation.set(0,0,st.ship.roll);}
    sweep();
    stepDebris(k,st.speed);

    renderer.clear();
    renderer.render(bg,bgCam);
    renderer.clearDepth();
    renderer.render(scene,cam);
  }
  // where a point of the ship model is on screen right now, in pixels
  function shipPoint(x,y,z){if(!shipG)return null;shipG.updateMatrixWorld(true);
    V.set(x,y,z).applyMatrix4(shipG.matrixWorld).project(cam);
    return [(V.x+1)/2*W,(1-V.y)/2*H];}
  function shatterObj(o,power,max){const e=live.get(o);if(!e)return;
    let src=e.m;
    // a merged rock flies apart as its separate bricks, in the same place
    if(!o.drone&&rockSrc.length&&o.rock!==undefined&&e.m.userData.ext){const R=rockSrc[o.rock%rockSrc.length];
      R.position.copy(e.m.position);R.quaternion.copy(e.m.quaternion);R.scale.copy(e.m.scale);src=R;}
    shatter(src,power,max);scene.remove(e.m);live.delete(o);}
  return {setShip,frame,shipPoint,renderer,
    rock:o=>shatterObj(o,3.2,24), boss:b=>shatterObj(b,5,80),
    ship:()=>{if(shipG){shipSrc.position.copy(shipG.position);shipSrc.quaternion.copy(shipG.quaternion);
      shipSrc.scale.copy(shipG.scale);shatter(shipSrc,4.4,90);shipG.visible=false;}},
    rescue:r=>{const e=live.get(r);if(e){scene.remove(e.m);live.delete(r);}}};
}
