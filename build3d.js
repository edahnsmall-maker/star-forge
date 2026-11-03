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

export function buildShipGroup(pieces,TH){
  pieces=settle(pieces);
  const grp=new T.Group();
  const aoList=[];
  const byColour=new Map();                        // colour -> {geos, studs}
  for(const p of pieces){
    const col=(TH&&!TH.natural&&p.r&&TH[p.r])||p.c;
    const clear=p.r==='glass';
    const key=col+(clear?'|t':'');
    let e=byColour.get(key);
    if(!e){e={col,clear,geos:[],studs:[]};byColour.set(key,e);}
    const geo=pieceGeometry(p);
    e.geos.push(geo);
    aoList.push({geo,box:geo.boundingBox.clone().expandByScalar(-0.35)});
    if(p.studs!==false&&!p.hs&&(p.ts===undefined||p.ts===1)&&(p.ax||'y')==='y'){
      const bb=p._bb||(p._bb=bbox(p.pts)), top=(p.y+p.h)*PLATE-CY;
      for(let sx=Math.floor(bb[0])+0.5;sx<bb[2];sx++)
      for(let sz=Math.floor(bb[1])+0.5;sz<bb[3];sz++){
        if(!inPoly(p.pts,sx,sz))continue;
        if(studCovered(pieces,p,sx,sz))continue;
        e.studs.push([sx*STUD, top, sz*STUD-CZ]);
      }
    }
  }
  bakeAO(aoList);
  for(const e of byColour.values()){
    const mat=material(e.col,e.clear);
    for(const g of e.geos){
      const m=new T.Mesh(g,mat);
      m.castShadow=true; m.receiveShadow=true;
      grp.add(m);
    }
    if(e.studs.length){
      const im=new T.InstancedMesh(studGeometry(),mat,e.studs.length);
      const d=new T.Object3D();
      e.studs.forEach((s,i)=>{d.position.set(s[0],s[1],s[2]);d.updateMatrix();
        im.setMatrixAt(i,d.matrix);});
      im.instanceMatrix.needsUpdate=true;
      im.castShadow=true; im.receiveShadow=true;
      grp.add(im);
    }
  }
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
        for(let i=0;i<pos.count;i++){v.fromBufferAttribute(pos,i);keep(v.x,v.y,v.z);}
      }
    });
    return new Float32Array(out);
  }
  let yaw=0.7, pitch=0.38, spin=0;

  function setShip(pieces,TH){
    if(model){scene.remove(model);}
    model=buildShipGroup(pieces,TH);
    scene.add(model);
    const box=new T.Box3().setFromObject(model);
    if(box.isEmpty()){radius=140;centre.set(0,0,0);}
    else{
      box.getCenter(centre);
      radius=Math.max(40,box.getSize(new T.Vector3()).length()*0.5);
      pad.position.y=box.min.y-1.5;
    }
    hull=hullPoints(model);
    renderer.shadowMap.needsUpdate=true;
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
    camera.fov=32;
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
    const vx=V.x,vy=V.y,vz=V.z, rx=R.x,ry=R.y,rz=R.z, ux=U.x,uy=U.y,uz=U.z;
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
    d*=1.05/((opt&&opt.zoom)||1);
    camera.position.copy(aim).addScaledVector(V,d);
    camera.lookAt(aim);
    key.position.set(centre.x-radius*1.1, centre.y+radius*2.2, centre.z+radius*1.2);
    key.target.position.copy(centre); key.target.updateMatrixWorld();
    // Wrap the shadow frustum tight around the model: the same 1024 map spread
    // over a quarter of the area is a far crisper contact shadow.
    const sc=key.shadow.camera, e=radius*1.15;
    if(sc.right!==e){sc.left=-e;sc.right=e;sc.top=e;sc.bottom=-e;
      sc.near=radius*0.5; sc.far=radius*6; sc.updateProjectionMatrix();
      renderer.shadowMap.needsUpdate=true;}
    scene.add(key.target);
    renderer.render(scene,camera);
  }

  return {setShip, drag, glide, render,
    get yaw(){return yaw;}, set yaw(v){yaw=v;},
    get pitch(){return pitch;}, set pitch(v){pitch=v;},
    renderer, scene, camera};
}
