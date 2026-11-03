/* =======================================================================
   THE PARTS
   Every piece is data: {pts, y, h, hs?, ts?, ax?, c, r?, studs?, smooth?} in
   stud coordinates -- x/z in studs, y in plates, 3 plates to a brick. Nothing
   in here knows how it will be drawn, which is the point: the old canvas
   renderer and the WebGL one read exactly the same list.
   ======================================================================= */
const STUD=7, PLATE=STUD*0.4;
const TILT=0.58, RISE=0.92;
const CZ=12*STUD, CY=2.5*PLATE;
const nrm=v=>{const m=Math.hypot(v[0],v[1],v[2]);return[v[0]/m,v[1]/m,v[2]/m];};
const KEY=nrm([-0.34,0.86,0.38]);   // main light, high and to the left
const FILL=nrm([0.55,0.22,-0.55]);  // cool bounce filling the shadow side
const VIEW=nrm([0,TILT,RISE]);      // toward the camera
const HALF=nrm([KEY[0]+VIEW[0],KEY[1]+VIEW[1],KEY[2]+VIEW[2]]);

/* A tiny studio to mirror into the plastic: a big soft box overhead, a mid
   horizon, a dark floor. On a FLAT face under a directional light the Phong
   term is constant -- it can only tint the colour, which is why gloss painted
   that way reads as "a lighter shade of blue". What actually makes ABS look
   glossy in a photo is that it reflects the room, weighted by Fresnel. */
const ENV_TOP=[250,252,255], ENV_MID=[126,150,184], ENV_BOT=[24,32,50];
const GLOSS=0.82;
function envAt(ry){
 const t=ry<-1?-1:(ry>1?1:ry);
 if(t>=0){const k=Math.pow(t,0.55);
  return[ENV_MID[0]+(ENV_TOP[0]-ENV_MID[0])*k,
         ENV_MID[1]+(ENV_TOP[1]-ENV_MID[1])*k,
         ENV_MID[2]+(ENV_TOP[2]-ENV_MID[2])*k];}
 const k=Math.pow(-t,0.7);
 return[ENV_MID[0]+(ENV_BOT[0]-ENV_MID[0])*k,
        ENV_MID[1]+(ENV_BOT[1]-ENV_MID[1])*k,
        ENV_MID[2]+(ENV_BOT[2]-ENV_MID[2])*k];
}
const _envc=new Map();
const envCss=ry=>{const q=Math.round(ry*64);let v=_envc.get(q);if(v)return v;
 const e=envAt(q/64);v='rgb('+(e[0]|0)+','+(e[1]|0)+','+(e[2]|0)+')';_envc.set(q,v);return v;};

const rect=(x,z,w,d)=>[[x,z],[x+w,z],[x+w,z+d],[x,z+d]];
const px=(pts,y,h,c,r,o)=>Object.assign({pts,y,h,c,r},o);
const bx=(x,z,w,d,y,h,c,r,o)=>px(rect(x,z,w,d),y,h,c,r,o);
// rect corner order is NW,NE,SE,SW with N = nose (small z)
const SLOPES={n:(h,l)=>[l,l,h,h], s:(h,l)=>[h,h,l,l], w:(h,l)=>[l,h,h,l], e:(h,l)=>[h,l,l,h]};
const sl=(x,z,w,d,y,h,dir,c,r,o)=>px(rect(x,z,w,d),y,h,c,r,
   Object.assign({hs:SLOPES[dir](h,(o&&o.lo)||0),studs:false},o));
function ring(cx,cz,rad,n){const p=[];for(let i=0;i<n;i++){const a=i/n*Math.PI*2;
  p.push([cx+Math.cos(a)*rad,cz+Math.sin(a)*rad]);}return p;}
// vertical cylinder / cone
const cyl=(cx,cz,rad,y,h,c,r,o)=>px(ring(cx,cz,rad,(o&&o.n)||12),y,h,c,r,
   Object.assign({studs:false,smooth:true},o));
// horizontal cylinder along z -- engine nacelles, antennae, gun barrels
const tube=(cx,cy_,rad,z,len,c,r,o)=>px(ring(cx,cy_,rad,(o&&o.n)||12),z,len,c,r,
   Object.assign({ax:'z',studs:false,smooth:true},o));
const bbox=pts=>{let a=1e9,b=1e9,c=-1e9,d=-1e9;
 for(const q of pts){if(q[0]<a)a=q[0];if(q[0]>c)c=q[0];if(q[1]<b)b=q[1];if(q[1]>d)d=q[1];}
 return[a,b,c,d];};
function inPoly(pts,x,z){let hit=false;
 for(let i=0,j=pts.length-1;i<pts.length;j=i++){
   const a=pts[i],b=pts[j];
   if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;}
 return hit;}
function studCovered(all,p,sx,sz){const top=p.y+p.h;
 for(const o of all){if(o===p||(o.ax||'y')!=='y')continue;
   const oh=o.hs?Math.max.apply(null,o.hs):o.h;
   if(!(o.y<=top+0.05&&o.y+oh>top+0.05))continue;
   const bb=o._bb||(o._bb=bbox(o.pts));
   if(sx>bb[0]&&sx<bb[2]&&sz>bb[1]&&sz<bb[3])return true;}
 return false;}
// mirror a set of pieces across the centreline
const mirX=ps=>ps.concat(ps.map(p=>{
 const q=Object.assign({},p);delete q._g;delete q._bb;
 if((p.ax||'y')==='y'){q.pts=p.pts.map(a=>[-a[0],a[1]]).reverse();
   if(p.hs)q.hs=p.hs.slice().reverse();}
 else{q.pts=p.pts.map(a=>[-a[0],a[1]]).reverse();}
 return q;}));
// shift a set of pieces outboard (used to mount wings on any hull width)
const offX=(ps,dx)=>ps.map(p=>{const q=Object.assign({},p);
 delete q._g;delete q._bb;q.pts=p.pts.map(a=>[a[0]+dx,a[1]]);return q;});

/* ---------- detail generators: texture by the line, not by the piece ---------- */
// alternating plates along z -- the classic greeble strip
const strip=(x,z,n,y,c1,c2,st)=>{const o=[];st=st||1;
 for(let i=0;i<n;i++)o.push(bx(x,z+i*st,st*0.78,st*0.72,y,1,i%2?c1:c2,i%2?'trim':'dark'));
 return o;};
// a bank of pipes running back along z
const pipes=(x,yy,n,z,len,c,gap)=>{const o=[];gap=gap||0.9;
 for(let i=0;i<n;i++)o.push(tube(x+i*gap,yy,gap*0.34,z,len,c,'light',{n:6}));
 return o;};
// a raised panel inside a darker frame
const panel=(x,z,w,d,y,c,cb)=>[bx(x,z,w,d,y,1,cb||DGREY,'dark'),
 bx(x+0.3,z+0.3,w-0.6,d-0.6,y+1,1,c,'trim')];
// posts carrying a rail
const railing=(x,z,len,y,c)=>{const o=[],n=Math.max(2,Math.round(len/1.4));
 for(let i=0;i<n;i++)o.push(cyl(x,z+i*(len/(n-1)),0.2,y,2.6,c,'light',{n:6}));
 o.push(bx(x-0.22,z-0.2,0.44,len+0.4,y+2.6,0.7,c,'light'));return o;};
// a cross-braced crate
const crate=(x,z,y,sz,c,cb)=>[bx(x,z,sz,sz,y,sz*1.1,c,'dark'),
 bx(x+sz*0.4,z-0.06,sz*0.2,sz+0.12,y+sz*0.25,sz*0.6,cb,'accent'),
 bx(x-0.06,z+sz*0.4,sz+0.12,sz*0.2,y+sz*0.25,sz*0.6,cb,'accent')];
// a small round lamp
const lamp=(x,z,y,c)=>[cyl(x,z,0.44,y,0.8,DGREY,'dark',{n:6}),
 cyl(x,z,0.33,y+0.8,0.9,c,'glass',{n:6})];
// printed tiles. Real sets are covered in them and they are most of what
// makes a surface look like a set rather than a shape.
const dial=(x,z,y,c)=>[bx(x,z,1.1,1.1,y,0.6,BLACK,'dark'),
 cyl(x+0.55,z+0.55,0.4,y+0.6,0.3,c,'accent',{n:8}),
 bx(x+0.5,z+0.15,0.12,0.45,y+0.9,0.2,WHITE,'trim')];
const readout=(x,z,y,c)=>{const o=[bx(x,z,1.8,1.2,y,0.6,BLACK,'dark')];
 for(let i=0;i<4;i++)o.push(bx(x+0.2+i*0.36,z+0.25,0.22,0.25+ (i%3)*0.22,y+0.6,0.25,c,'accent'));
 return o;};
const hazard=(x,z,n,y)=>{const o=[];
 for(let i=0;i<n;i++)o.push(bx(x+i*0.62,z,0.5,1.1,y,0.5,i%2?YEL:BLACK,i%2?'accent':'dark'));
 return o;};
const spaceLogo=(x,z,y,c)=>[bx(x,z,1.5,1.5,y,0.55,WHITE,'trim'),
 cyl(x+0.75,z+0.75,0.55,y+0.55,0.28,c,'accent',{n:10}),
 bx(x+0.62,z+0.1,0.26,1.3,y+0.55,0.3,c,'accent'),
 bx(x+0.15,z+0.62,1.2,0.26,y+0.83,0.28,c,'accent')];
// a rung ladder
const ladder=(x,z,y,h,c)=>{const o=[cyl(x-0.5,z,0.16,y,h,c,'light',{n:6}),
 cyl(x+0.5,z,0.16,y,h,c,'light',{n:6})];
 for(let i=1;i<h/1.6;i++)o.push(bx(x-0.5,z-0.14,1,0.28,y+i*1.6,0.4,c,'light'));
 return o;};
// a stepped block cluster -- reads as machinery
const machine=(x,z,y,seed,c1,c2)=>{const o=[];let sd=seed*9301+49297;
 const rnd=()=>{sd=(sd*9301+49297)%233280;return sd/233280;};
 for(let i=0;i<5;i++)o.push(bx(x+((rnd()*3)|0)*0.7,z+((rnd()*3)|0)*0.7,
   0.6+rnd()*0.8,0.6+rnd()*0.8,y+((rnd()*3)|0),1+((rnd()*3)|0),
   rnd()<0.5?c1:c2,rnd()<0.5?'dark':'light'));
 return o;};

/* =======================================================================
   THE PARTS
   Nose at z=0, tail at z=25. Cockpit -3..9, hull 7..18, engine 18..25.
   Every hull is 3 studs half-width at z=7 and z=18, so any nose and any
   engine mate with any hull. Wings are drawn from x=0 outward and shifted
   onto whatever edge the hull declares, so nothing floats or clips.
   Each part carries its own colours -- mixing them is the point.
   ======================================================================= */
const GREY='#9BA19D',DGREY='#6C6E68',BLACK='#1B2A34',WHITE='#F4F4F4',SILVER='#A5A9B4',
      BLUE='#0055BF',AZ='#078BC9',NAVY='#2A4B8D',
      RED='#C91A09',DRED='#7B1C10',
      YEL='#F2CD37',ORG='#FE8A18',GOLD='#DCBE61',
      LIME='#BBE90B',GRN='#237841',
      PURP='#8320B7',LAV='#A06EB9',PINK='#E4ADC8',
      TAN='#DEC69C',STONE='#A3A2A4',WOOD='#7A5230',DWOOD='#583927',
      SAIL='#EFE3C8',BATW='#3D2A52',DPURP='#5B3A8C',BRIS='#C8A96A',
      HOTP='#F0559C',BLUSH='#F7C6DC',MINT='#7FE5C4',SKY='#8ECAF0',CREAM='#FFF2D0',
      TYEL='#F5CD2F',TBLU='#AEEFEC',TGRN='#9BE854',TORG='#FF9A3D',TPUR='#C8A0E0';

/* One dominant colour per option, with its accent used sparingly and loudly.
   Every part used to carry four or five colours of its own, so a finished ship
   came out the same confetti whatever you picked, and the options read as
   "slightly different shapes" instead of as parts pulled from different sets.
   Silver and dark-grey fittings are left alone -- a gun barrel is metal
   whatever the wing is painted. */
const PAL={
 blue   :{hull:BLUE,  light:BLUE,  trim:WHITE, accent:RED,   dark:NAVY},
 ice    :{hull:WHITE, light:WHITE, trim:AZ,    accent:AZ,    dark:'#2B3B49'},
 hazard :{hull:BLACK, light:BLACK, trim:ORG,   accent:ORG,   dark:'#0E161C'},
 red    :{hull:RED,   light:RED,   trim:WHITE, accent:WHITE, dark:DRED},
 alien  :{hull:PURP,  light:PURP,  trim:LIME,  accent:LIME,  dark:DPURP},
 yellow :{hull:YEL,   light:YEL,   trim:BLACK, accent:BLACK, dark:'#3A3524'},
 airline:{hull:WHITE, light:WHITE, trim:NAVY,  accent:NAVY,  dark:NAVY},
 jungle :{hull:GRN,   light:GRN,   trim:LIME,  accent:LIME,  dark:'#14331F'},
 sand   :{hull:TAN,   light:TAN,   trim:WOOD,  accent:DRED,  dark:DWOOD},
 gold   :{hull:GOLD,  light:GOLD,  trim:BLACK, accent:DRED,  dark:'#3A2E1C'},
 bat    :{hull:BATW,  light:BATW,  trim:PURP,  accent:LIME,  dark:'#241733'},
 candy  :{hull:PINK,  light:PINK,  trim:WHITE, accent:PURP,  dark:'#5B3A8C'},
 canvas :{hull:WOOD,  light:WOOD,  trim:SAIL,  accent:DRED,  dark:DWOOD},
 unicorn:{hull:BLUSH, light:BLUSH, trim:WHITE, accent:LAV,   dark:PURP},
 sherbet:{hull:HOTP,  light:HOTP,  trim:CREAM, accent:MINT,  dark:PURP},
};
const METAL={};METAL[SILVER]=1;METAL[DGREY]=1;METAL[STONE]=1;METAL[BLACK]=1;
function tintPart(o){
 if(!o.pal||!o.pieces||!o.pieces.length)return;
 o.pieces=o.pieces.map(q=>{
  if(q.r==='glass')return q;
  if(METAL[q.c]&&(q.r==='light'||q.r==='dark'))return q;   // fittings stay metal
  const c=o.pal[q.r];
  if(!c||c===q.c)return q;
  const n=Object.assign({},q,{c});delete n._g;delete n._bb;return n;
 });
}

// a four-blade propeller, seen from above
const prop=(cx,cz,y,rad,col,role)=>{
 const o=[];
 for(let i=0;i<4;i++){
  const a=i*Math.PI/2+0.42,ca=Math.cos(a),sa=Math.sin(a),w=0.62;
  o.push(px([[cx+ca*0.55-sa*w, cz+sa*0.55+ca*w],
             [cx+ca*rad-sa*w*0.45, cz+sa*rad+ca*w*0.45],
             [cx+ca*rad+sa*w*0.45, cz+sa*rad-ca*w*0.45],
             [cx+ca*0.55+sa*w, cz+sa*0.55-ca*w]],y,0.5,col,role||'accent',{studs:false}));
 }
 o.push(cyl(cx,cz,0.5,y-0.5,1.6,DGREY,'light',{n:8}));
 return o;
};

// The 3D forge swaps these bricks for a real minifigure; the 2D renderer
// still draws them. Every piece is marked, the first carries the seat.
const tagFig=(ps,P,at)=>{ps.forEach((q,i)=>{q.fig=P;if(!i)q.figAt=at;});return ps;};
const pilotAt=(x,z,y,P)=>tagFig([
 bx(x-0.7,z-0.7,1.4,1.4,y,2,P.shirt,'accent'),
 bx(x-0.7,z-0.7,1.4,1.4,y+1.4,0.7,P.belt||P.shirt,'dark'),
 cyl(x,z,0.55,y+2,1.3,P.skin||YEL,'accent',{n:10}),
 // a printed face: two eyes and a smile, read through the visor
 bx(x-0.30,z-0.58,0.15,0.08,y+2.62,0.15,BLACK,'dark'),
 bx(x+0.15,z-0.58,0.15,0.08,y+2.62,0.15,BLACK,'dark'),
 bx(x-0.20,z-0.57,0.40,0.07,y+2.30,0.09,BLACK,'dark'),
 bx(x-0.26,z-0.57,0.08,0.07,y+2.38,0.09,BLACK,'dark'),
 bx(x+0.18,z-0.57,0.08,0.07,y+2.38,0.09,BLACK,'dark'),
 cyl(x,z,0.82,y+2.2,1.1,P.helmet,'trim',{n:10,ts:1.12}),
 cyl(x,z,0.78,y+3.3,0.9,P.helmet,'trim',{n:10}),
 bx(x-0.62,z-0.88,1.24,0.42,y+2.28,0.94,P.visor,'glass'),
],P,[x,z,y]);
const PILOTS=[
 {name:'Rex',unlock:0,hat:'space',print:'space',face:'smile',shirt:'#C91A09',helmet:'#F4F4F4',visor:'#AEEFEC',belt:'#1B2A34'},
 {name:'Nova',unlock:0,hat:'space',print:'space',face:'lashes',shirt:'#078BC9',helmet:'#F4F4F4',visor:'#AEEFEC',belt:'#1B2A34'},
 {name:'Blaze',unlock:3,hat:'space',print:'flame',face:'grin',shirt:'#FE8A18',helmet:'#F2CD37',visor:'#FF9A3D',belt:'#7B1C10'},
 {name:'Sprout',unlock:6,hat:'space',print:'leaf',face:'freckles',shirt:'#237841',helmet:'#BBE90B',visor:'#9BE854',belt:'#1B2A34'},
 {name:'Hex',unlock:10,hat:'space',print:'hex',face:'brows',shirt:'#8320B7',helmet:'#1B2A34',visor:'#C8A0E0',belt:'#DCBE61'},
 {name:'Sir Kit',unlock:13,hat:'knight',print:'crest',face:'smile',shirt:'#A3A2A4',helmet:'#A3A2A4',visor:'#1B2A34',belt:'#7A5230'},
 {name:'Merlin',unlock:16,hat:'wizard',print:'stars',face:'beard',shirt:'#5B3A8C',helmet:'#8320B7',visor:'#C8A0E0',belt:'#DCBE61'},
];
const COCKPITS=[
 // Classic Space explorer: long wedge prow, greebled flanks, crew ladder
 {name:'Classic',unlock:0,seat:[0,5.6,6],pieces:[
   px([[-4.4,10],[4.4,10],[3,3],[-3,3]],0,1,GREY,'light'),
   px([[-3,3],[3,3],[1.4,-2],[-1.4,-2]],0,1,GREY,'light'),
   px([[-1.4,-2],[1.4,-2],[0.7,-5],[-0.7,-5]],0,1,GREY,'light'),
   px([[-2.6,3.4],[2.6,3.4],[1.3,-1.4],[-1.3,-1.4]],1,1,WHITE,'trim'),
   ...spaceLogo(-0.75,0.2,2,BLUE),
   ...readout(-0.9,4.6,6,TGRN),
   ...hazard(-2.4,8.6,4,6),
   sl(-2.8,1.6,5.6,2.4,1,5,'n',BLUE,'hull'),
   bx(-2.8,4,5.6,4.4,1,5,BLUE,'hull'),
   bx(-3.4,8.4,6.8,1.6,1,5,BLUE,'hull'),
   sl(-2.2,3.2,4.4,3,6,4,'n',TYEL,'glass'),
   bx(-2.2,6.2,4.4,2,6,4,TYEL,'glass'),
   sl(-2.2,8.2,4.4,1.4,6,4,'s',TYEL,'glass'),
   ...mirX([
     ...strip(2.9,3.8,5,1,WHITE,DGREY),
     ...panel(3.1,3.6,1.5,4.4,1,BLUE,DGREY),
     ...pipes(2.95,3,3,2.2,5,GREY,0.7),
     bx(2.4,3.4,0.7,5.4,6,1,RED,'accent'),
     ...lamp(3.4,2.2,1,TORG),
     ...ladder(3.6,9,1,6,GREY),
     bx(1.2,9.4,1.4,0.9,6,1,YEL,'accent'),
     tube(1.15,2.6,0.2,-6.4,7,GREY,'light',{n:6}),
     bx(0.75,-2.8,0.9,1.1,1,1,RED,'accent'),
     ...crate(2,-0.6,1,1.3,WHITE,RED),
   ]),
   bx(-1.8,1.2,3.6,1.4,1,2,DGREY,'dark'),
   ...strip(-0.5,0.2,3,10,GREY,DGREY,0.8),
 ]},
 // fat orange racer: dome, side intakes, exhaust pipes, spoiler
 // pink, horned, and entirely serious about it
 {name:'Unicorn',unlock:2,pal:PAL.unicorn,seat:[0,5.6,6],pieces:[
   px([[-4.4,9.4],[4.4,9.4],[3,1.6],[-3,1.6]],0,1,BLUSH,'hull'),
   px([[-3,1.6],[3,1.6],[1.5,-3.4],[-1.5,-3.4]],0,1,BLUSH,'hull'),
   bx(-3.4,2.4,6.8,6.2,1,4,BLUSH,'hull'),
   bx(-3,3,6,5,5,1,WHITE,'trim'),
   // the snout, with nostrils
   sl(-2.2,-3,4.4,4.4,1,3,'n',BLUSH,'hull'),
   ...mirX([cyl(1.1,-2.2,0.34,3.6,0.5,PURP,'dark',{n:6})]),
   // eyes
   ...mirX([cyl(1.7,1.2,0.72,4.2,0.7,WHITE,'trim',{n:10}),
            cyl(1.7,1.2,0.34,4.8,0.4,BLACK,'dark',{n:8})]),
   // the horn: three cones, gold, tapering
   cyl(0,0.6,1.15,4.2,2.2,GOLD,'accent',{n:10,ts:0.82}),
   cyl(0,0.6,0.94,6.3,2.4,CREAM,'trim',{n:10,ts:0.76}),
   cyl(0,0.6,0.72,8.6,2.6,GOLD,'accent',{n:10,ts:0.68}),
   cyl(0,0.6,0.49,11.1,2.8,CREAM,'trim',{n:10,ts:0.08}),
   // ears
   ...mirX([cyl(2.5,0.2,0.55,4.4,1.5,BLUSH,'hull',{n:6,ts:0.2})]),
   // the mane, running back over the canopy in three colours
   ...mirX([
     px([[1.0,2.6],[3.2,3.0],[3.2,8.6],[1.0,8.2]],5,2.6,LAV,'accent'),
     px([[1.5,3.4],[3.6,3.8],[3.6,8.0],[1.5,7.6]],7.6,2.4,MINT,'trim'),
     px([[2.0,4.2],[4.0,4.6],[4.0,7.4],[2.0,7.0]],10.0,2.2,HOTP,'accent'),
     px([[2.5,5.0],[4.3,5.4],[4.3,6.8],[2.5,6.4]],12.2,1.8,SKY,'trim'),
     ...lamp(3.6,9.2,1,TPUR),
   ]),
   cyl(0,5.6,2.9,5,3.2,TPUR,'glass',{n:16}),
   cyl(0,5.6,3.1,4.4,0.8,WHITE,'trim',{n:16}),
   bx(-2.2,9,4.4,0.8,5,3,LAV,'accent'),
   ...mirX([bx(2.6,9.2,1.1,1.1,5,2,MINT,'trim')]),
 ]},
 {name:'Bubble',unlock:0,seat:[0,5.4,6],pieces:[
   px([[-4.6,9.5],[4.6,9.5],[3.2,2],[-3.2,2]],0,1,WHITE,'hull'),
   px([[-3.2,2],[3.2,2],[1.6,-3],[-1.6,-3]],0,1,WHITE,'hull'),
   sl(-3.4,0.6,6.8,2.6,1,5,'n',ORG,'accent'),
   bx(-3.4,3.2,6.8,5.4,1,5,ORG,'accent'),
   bx(-3.4,8.4,6.8,1.4,1,5,WHITE,'hull'),
   ...hazard(-2.6,8.6,5,6),
   ...dial(-2.4,3.4,6,TORG),
   ...readout(0.6,3.4,6,TGRN),
   cyl(0,5.4,3.5,6,3.4,TBLU,'glass',{n:16}),
   cyl(0,5.4,3.5,9.4,3,TBLU,'glass',{n:16,ts:0.34}),
   cyl(0,5.4,3.7,5.2,1,WHITE,'hull',{n:16}),
   ...mirX([
     px([[3.3,2.6],[5.6,4.4],[5.6,7.6],[3.3,8]],1,4,ORG,'accent'),
     ...pipes(4.2,3,3,1.6,4,GREY,0.75),
     tube(4.4,2.6,0.85,0.2,3.4,DGREY,'dark',{n:10}),
     tube(4.4,2.6,1,3.2,0.7,BLACK,'dark',{n:10}),
     ...panel(3.6,4.6,1.6,3,5,WHITE,BLACK),
     ...lamp(2.4,-1.2,1,TORG),
     bx(1.5,-2.6,1.2,1.6,1,3,BLACK,'dark'),
     ...strip(3.5,3,4,5,YEL,BLACK,0.8),
   ]),
   bx(-2.4,9,4.8,0.7,6,3,ORG,'accent'),
   px([[-2,9.2],[2,9.2],[1.4,10.4],[-1.4,10.4]],9,1,BLACK,'dark'),
 ]},
 // black-and-white blade with an azure spine and a sensor mast
 {name:'Interceptor',unlock:2,seat:[0,5.8,6],pieces:[
   px([[-4,10],[4,10],[1.4,-6]],0,1,BLACK,'dark'),
   px([[-2.4,5],[2.4,5],[1,-2.6]],1,1,WHITE,'hull'),
   sl(-2.6,1.4,5.2,3.4,1,5,'n',BLACK,'dark'),
   bx(-2.6,4.8,5.2,4.4,1,5,BLACK,'dark'),
   bx(-3,8.6,6,1.4,1,5,BLACK,'dark'),
   sl(-2.1,3.4,4.2,4.2,6,4,'n',TBLU,'glass'),
   bx(-2.1,7.6,4.2,1.4,6,3,AZ,'accent'),
   ...readout(-0.9,4.4,6,TORG),
   ...dial(-1.9,6.2,6,'#FF4444'),
   ...dial(0.8,6.2,6,TBLU),
   ...mirX([
     px([[1.3,0.6],[3.9,5.2],[2.9,5.9],[1,2]],0,3,WHITE,'hull'),
     bx(2.7,5.4,1.3,4,1,5,AZ,'accent'),
     ...panel(2.75,5.8,1.2,3,6,BLACK,WHITE),
     ...strip(4,5.4,4,1,WHITE,BLACK,0.9),
     ...pipes(3,2.6,3,1,4.4,SILVER,0.7),
     tube(3.2,3.4,0.26,-1.4,5.4,GREY,'light',{n:6}),
     ...lamp(2.1,-0.6,1,'#FF4444'),
     bx(1.5,9,1.4,1,6,1,AZ,'accent'),
   ]),
   cyl(0,9.2,0.28,6,7,SILVER,'light',{n:6}),
   cyl(0,9.2,0.75,12.6,0.9,AZ,'accent',{n:8}),
   bx(-1.6,-2.6,3.2,1.6,1,2,WHITE,'hull'),
 ]},
 // two red pods bridged over a cargo deck
 {name:'Twin Pod',unlock:5,seat:[2.8,5.4,6],pieces:[
   px([[-4.6,10],[4.6,10],[3.4,1.6],[-3.4,1.6]],0,1,WHITE,'trim'),
   ...mirX([
     sl(1.2,0.2,3.2,2.2,1,5,'n',RED,'hull'),
     bx(1.2,2.4,3.2,6,1,5,RED,'hull'),
     sl(1.4,3.2,2.8,3.2,6,4,'n',TBLU,'glass'),
     bx(1.4,6.4,2.8,1.8,6,4,TBLU,'glass'),
     bx(1.2,8.2,3.2,1.2,6,1,WHITE,'trim'),
     bx(1.2,2.4,3.2,0.9,6,1,YEL,'accent'),
     tube(2.8,2.4,0.24,-4.4,5.4,GREY,'light',{n:6}),
     bx(2,-0.4,1.6,1.2,1,3,DGREY,'dark'),
     tube(4.4,1.8,0.75,2.6,4,DGREY,'dark',{n:8}),
     tube(4.4,1.8,0.9,6.2,0.8,BLACK,'dark',{n:8}),
     ...strip(4.5,2.8,4,1,WHITE,BLACK,0.9),
     ...lamp(1.6,0.2,6,TORG),
     ...ladder(1.05,8.8,1,6,GREY),
   ]),
   bx(-1.2,3.6,2.4,5,0,3,DGREY,'dark'),
   bx(-1.4,4,2.8,4.2,3,1,YEL,'accent'),
   ...crate(-1,4.6,4,1.6,WHITE,RED),
   ...crate(-1,6.6,4,1.6,BLUE,WHITE),
   cyl(0,2.8,1.1,3,2.4,TORG,'glass',{n:10}),
   ...railing(-1.5,3.8,4.6,4,GREY),
   ...railing(1.5,3.8,4.6,4,GREY),
   px([[-3.4,10],[3.4,10],[2.4,7.6],[-2.4,7.6]],0,1,DGREY,'dark'),
 ]},
 // a proper flying saucer: rim lights, legs, tractor emitter
 {name:'Saucer',unlock:9,seat:[0,3.6,5.4],pieces:[
   cyl(0,3.6,6,0,1.6,SILVER,'light',{n:20}),
   cyl(0,3.6,5.1,1.6,2,LIME,'accent',{n:20}),
   cyl(0,3.6,4,3.6,1.6,SILVER,'light',{n:18}),
   cyl(0,3.6,3,5.2,2.4,DPURP,'hull',{n:16}),
   cyl(0,3.6,2.7,7.6,3.4,TPUR,'glass',{n:16,ts:0.42}),
   ...(function(){const o=[];for(let i=0;i<10;i++){const a=i/10*Math.PI*2+0.3;
     o.push(...lamp(Math.cos(a)*5.4,3.6+Math.sin(a)*5.4,1.6,i%2?TORG:TBLU));}
     return o;})(),
   ...(function(){const o=[];for(let i=0;i<8;i++){const a=i/8*Math.PI*2+0.2;
     o.push(bx(Math.cos(a)*4.4-0.45,3.6+Math.sin(a)*4.4-0.45,0.9,0.9,3.6,1,PURP,'hull'));}
     return o;})(),
   ...mirX([
     tube(3.6,1.2,0.85,1.4,3.6,DGREY,'dark',{n:8}),
     cyl(3.6,2.4,1.1,0,1,DGREY,'dark',{n:8}),
     bx(4.4,4.6,1,1.6,1.6,2,LIME,'accent'),
   ]),
   cyl(0,-1.4,1.5,0.4,1,DGREY,'dark',{n:12}),
   cyl(0,-1.4,1.2,1.4,1.6,TGRN,'glass',{n:12}),
   px([[-3,10],[3,10],[2.2,8],[-2.2,8]],0,1,SILVER,'light'),
 ]},
 // a horned head with a jaw, teeth and a gold crest
 {name:'Dragon',unlock:13,seat:[0,3.4,7],pieces:[
   px([[-4.6,8],[4.6,8],[2.6,-3],[-2.6,-3]],0,1,BLACK,'dark'),
   sl(-2.6,-3,5.2,3.6,1,4,'n',DRED,'hull'),
   bx(-3.2,0.6,6.4,4.4,1,6,RED,'hull'),
   bx(-3.6,5,7.2,3.4,1,6,RED,'hull'),
   bx(-3.6,1.2,7.2,1.8,7,2,GOLD,'accent'),
   ...mirX([
     cyl(2,1.9,1.15,7,2.4,TORG,'glass',{n:10}),
     cyl(2,1.9,1.35,6.6,0.6,GOLD,'accent',{n:10}),
     px([[2.6,1.6],[6,-1.4],[6.8,1.4],[3.4,3.8]],6,2.4,GOLD,'accent'),
     px([[2.8,3.8],[5.8,3],[5.2,5.8],[2.8,5.8]],5,2.4,DRED,'hull'),
     tube(3.8,7,0.34,0.4,5,GOLD,'accent',{n:6}),
     bx(0.9,-3.4,0.9,1.1,1,2.4,WHITE,'trim'),
     bx(2.1,-2.6,0.9,1.1,1,2.4,WHITE,'trim'),
     bx(3.2,7.6,1.1,1.6,7,2.4,GOLD,'accent'),
     ...strip(3.7,1.4,4,1,DRED,BLACK,0.9),
     ...lamp(2.6,6.6,7,TORG),
   ]),
   bx(-1.8,4.2,3.6,2.6,7,4,GOLD,'accent'),
   bx(-1.1,5.8,2.2,1.8,11,2.6,DRED,'hull'),
   bx(-2.2,-1.4,4.4,1.8,1,4,DRED,'hull'),
   ...strip(-0.45,-2.6,4,5,GOLD,DRED,0.85),
 ]},
 // a castle gatehouse: two towers, a wall, a portcullis, banners
 {name:'Castle',unlock:4,seat:[0,3.6,8],pieces:[
   px([[-5,10],[5,10],[3.6,0.6],[-3.6,0.6]],0,1,STONE,'light'),
   bx(-2.6,1.6,5.2,4.4,1,7,STONE,'light'),
   ...(function(){const o=[];for(let i=0;i<6;i++)
     o.push(bx(-2.5+i*0.9,1.7,0.7,0.9,8,2.6,DGREY,'dark'));return o;})(),
   bx(-1.5,1.5,3,0.6,1,5,BLACK,'dark'),
   ...(function(){const o=[];for(let i=0;i<4;i++)
     o.push(bx(-1.3+i*0.75,1.4,0.24,0.5,1,5,DGREY,'dark'));return o;})(),
   bx(-1.5,1.5,3,0.6,6,1.4,DWOOD,'dark'),
   ...mirX([
     cyl(3.4,3.4,2.4,0,10,STONE,'light',{n:14}),
     cyl(3.4,3.4,2.6,0,1.2,DGREY,'dark',{n:14}),
     cyl(3.4,3.4,2.5,6,0.9,DGREY,'dark',{n:14}),
     ...(function(){const o=[];for(let i=0;i<7;i++){const a=i/7*Math.PI*2+0.2;
       o.push(bx(3.4+Math.cos(a)*2-0.45,3.4+Math.sin(a)*2-0.45,0.9,0.9,10,2.6,STONE,'light'));}
       return o;})(),
     bx(2.9,1.5,1,0.8,4,2.6,DGREY,'dark'),
     bx(3.1,1.4,0.6,0.7,4.4,2,TYEL,'glass'),
     cyl(3.4,3.4,0.24,12.6,6,DGREY,'dark',{n:6}),
     bx(3.5,3.5,0.3,2.8,15.4,3.2,RED,'accent'),
     bx(3.53,3.7,0.3,1,15.4,3.2,WHITE,'trim'),
     ...lamp(1.9,0.9,1,TORG),
     ...strip(2.1,5,4,1,STONE,DGREY,0.9),
   ]),
   ...railing(-2.2,2.4,3.4,8,DGREY),
   ...railing(2.2,2.4,3.4,8,DGREY),
   ...crate(-1.1,3.4,8,1.5,DWOOD,WOOD),
   bx(-3.6,8.8,7.2,1.2,1,5,STONE,'light'),
   ...strip(-0.45,-0.2,3,1,STONE,DGREY,0.9),
 ]},
 // a wizard tower: conical roof, stars, a balcony and a crystal ball
 {name:'Wizard',unlock:16,seat:[0,4.4,5],pieces:[
   px([[-4.6,10],[4.6,10],[3.2,0.4],[-3.2,0.4]],0,1,DPURP,'hull'),
   cyl(0,4.4,3.4,1,7,DPURP,'hull',{n:14}),
   cyl(0,4.4,3.6,1,1.2,GOLD,'accent',{n:14}),
   cyl(0,4.4,3.55,5,0.9,GOLD,'accent',{n:14}),
   cyl(0,4.4,3.9,8,1,PURP,'hull',{n:14}),
   cyl(0,4.4,3.7,9,9,PURP,'hull',{n:14,ts:0.08}),
   ...(function(){const o=[];for(let i=0;i<7;i++){const a=i/7*Math.PI*2+0.4;
     o.push(cyl(Math.cos(a)*2.6,4.4+Math.sin(a)*2.6,0.44,10.4,1,GOLD,'accent',{n:6}));}
     return o;})(),
   ...(function(){const o=[];for(let i=0;i<8;i++){const a=i/8*Math.PI*2;
     o.push(cyl(Math.cos(a)*3.75,4.4+Math.sin(a)*3.75,0.2,9,2.4,GOLD,'accent',{n:6}));}
     return o;})(),
   bx(-1,1.2,2,1,3,3.4,BLACK,'dark'),
   bx(-0.7,1.1,1.4,0.8,3.4,2.6,TPUR,'glass'),
   cyl(0,-0.6,1.7,0.4,1.2,GOLD,'accent',{n:12}),
   cyl(0,-0.6,1.5,1.6,3,TPUR,'glass',{n:14}),
   ...mirX([
     cyl(2.4,2,0.5,1,4.4,GOLD,'accent',{n:6}),
     bx(2,7,1.4,2,1,4,DPURP,'hull'),
     ...crate(2.2,8.2,1,1.4,DWOOD,GOLD),
     ...lamp(3.1,1.6,1,TPUR),
     ...strip(2.6,2.4,4,5,GOLD,DPURP,0.85),
     bx(3.4,4,0.7,1.6,5,2,TGRN,'glass'),
   ]),
   px([[-3,10],[3,10],[2.2,8],[-2.2,8]],0,1,DPURP,'hull'),
 ]},
];


const BODIES=[
 // narrow blue runabout with a grey spine
 {name:'Slim',tailY:4,tailZ:15.2,defY:4,defZ:8.6,unlock:0,halfW:5,wingY:2,pieces:[
   bx(-3,7,6,11,0,4,BLUE,'hull'),
   ...mirX([px([[3,8],[5,10],[5,15],[3,17]],0,3,GREY,'light')]),
   bx(-1.2,7.6,2.4,9.6,4,1,GREY,'light'),
   ...readout(-0.9,8.2,5,TBLU),
   ...dial(-0.55,11,5,YEL),
   ...spaceLogo(-0.75,13.4,5,RED),
   ...mirX([bx(1.4,8,1.4,1.4,4,1,WHITE,'trim'),
            bx(1.4,10,1.4,1.4,4,1,RED,'accent'),
            bx(1.4,12,1.4,1.4,4,1,WHITE,'trim'),
            bx(1.4,14,1.4,1.4,4,1,YEL,'accent')]),
   bx(-1.2,9,2.4,3.4,5,2,DGREY,'dark'),
   bx(-1.2,13.4,2.4,2.6,5,1,RED,'accent'),
   ...mirX([tube(2.4,2,0.5,16.4,2,DGREY,'dark',{n:8})]),
   ...mirX([bx(2.6,7.2,0.8,1.4,4,2,RED,'accent')]),
 ]},
 // broad white freighter with a bold azure deck and hazard stripes
 {name:'Wide',tailY:4,tailZ:15,defY:4,defZ:8.4,unlock:0,halfW:7,wingY:2,pieces:[
   bx(-3,7,6,11,0,4,WHITE,'hull'),
   ...mirX([px([[3,8],[7,10],[7,15],[3,17]],0,4,WHITE,'hull')]),
   ...mirX([px([[3.1,9],[6.6,10.7],[6.6,14.3],[3.1,16]],4,1,AZ,'accent')]),
   bx(-1.4,7.6,2.8,9.8,4,1,GREY,'light'),
   ...readout(-0.9,7.9,5,TORG),
   ...dial(-0.55,10.4,5,AZ),
   ...spaceLogo(-0.75,15.4,5,AZ),
   ...mirX([bx(1.6,8.2,1.4,1.4,4,1,BLACK,'dark'),
            bx(1.6,10,1.4,1.4,4,1,YEL,'accent'),
            bx(1.6,11.8,1.4,1.4,4,1,BLACK,'dark'),
            bx(1.6,13.6,1.4,1.4,4,1,YEL,'accent')]),
   bx(-1.4,8.6,2.8,3.4,5,3,DGREY,'dark'),
   bx(-1.4,13.4,2.8,3,5,2,AZ,'accent'),
   ...mirX([cyl(5.2,12.6,1,4,2.4,TBLU,'glass',{n:8})]),
   ...mirX([bx(3.6,16,1.6,1.2,4,2,ORG,'accent')]),
 ]},
 // twin outboard nacelles hung off pylons
 {name:'Pods',tailY:4,tailZ:15.2,defY:4,defZ:8.6,unlock:3,halfW:8,wingY:3,pieces:[
   bx(-3,7,6,11,0,4,DRED,'hull'),
   bx(-1.2,7.6,2.4,9.6,4,1,TAN,'light'),
   ...mirX([bx(1.4,8.4,1.4,1.4,4,1,BLACK,'dark'),
            bx(1.4,11,1.4,1.4,4,1,ORG,'accent'),
            bx(1.4,13.6,1.4,1.4,4,1,BLACK,'dark')]),
   ...mirX([
     bx(3,11,2.6,3,2,3,BLACK,'dark'),
     tube(5.8,2,2.3,7.4,9.2,TAN,'light',{n:14}),
     tube(5.8,2,2.5,15.8,1.1,BLACK,'dark',{n:14}),
     tube(5.8,2,2.45,7,0.9,ORG,'accent',{n:14}),
     bx(4.6,9.8,2.4,1,4.4,1,ORG,'accent'),
     bx(4.6,14.6,2.4,1,4.4,1,ORG,'accent'),
   ]),
   bx(-1.2,9,2.4,3.4,5,2,BLACK,'dark'),
 ]},
 // an open bay with a glowing green reactor in it
 {name:'Core',tailY:4,tailZ:15.6,defY:4,defZ:6.4,unlock:8,halfW:5,wingY:2,pieces:[
   bx(-3,7,6,11,0,4,WHITE,'hull'),
   ...mirX([px([[3,8],[5,10],[5,15],[3,17]],0,3,LIME,'accent')]),
   ...mirX([bx(2.2,10,0.9,5,4,1,DGREY,'dark')]),
   cyl(0,12.4,2.9,3,1.4,DGREY,'dark',{n:14}),
   cyl(0,12.4,2.4,4.4,5,TGRN,'glass',{n:14}),
   cyl(0,12.4,1.5,9.4,1.2,DGREY,'dark',{n:12}),
   bx(-1.4,7.4,2.8,3.6,4,1,GRN,'accent'),
   bx(-1.4,15.4,2.8,2,4,1,GRN,'accent'),
   ...mirX([bx(1.6,8.2,1.2,1.2,4,1,LIME,'accent'),
            bx(1.6,15.8,1.2,1.2,4,1,LIME,'accent')]),
   ...mirX([tube(2.4,2,0.5,16.4,2,DGREY,'dark',{n:8})]),
 ]},
 // curtain wall, corner towers, a wooden courtyard
 {name:'Keep',unlock:6,halfW:5,wingY:2,tailY:5,tailZ:15,defY:5,defZ:8.6,pieces:[
   bx(-3,7,6,11,0,5,STONE,'light'),
   ...mirX([
     cyl(2.9,8.8,1.5,0,8,STONE,'light',{n:10}),
     cyl(2.9,16,1.5,0,8,STONE,'light',{n:10}),
     cyl(2.9,8.8,1.62,0,1,DGREY,'dark',{n:10}),
     cyl(2.9,16,1.62,0,1,DGREY,'dark',{n:10}),
     cyl(2.9,8.8,1.55,7,1,DGREY,'dark',{n:10}),
     cyl(2.9,16,1.55,7,1,DGREY,'dark',{n:10}),
   ]),
   ...(function(){const o=[];for(let i=0;i<7;i++){
     o.push(bx(-2.85+i*0.85,7.1,0.62,0.9,5,2,DGREY,'dark'));
     o.push(bx(-2.85+i*0.85,17,0.62,0.9,5,2,DGREY,'dark'));}
     return o;})(),
   bx(-2,9,4,7,5,1,DWOOD,'dark'),
   bx(-1.2,10,2.4,5,6,1,WOOD,'dark'),
   ...mirX([bx(2,10.4,0.85,1.4,5,2,RED,'accent'),
            bx(2,13.8,0.85,1.4,5,2,RED,'accent')]),
   bx(-1,7.15,2,0.8,1,4,DWOOD,'dark'),
   bx(-0.7,7.08,1.4,0.6,1,2.6,BLACK,'dark'),
 ]},
];


// wings are drawn from x=0 outward; big plates are split so no one piece
// spans enough depth to sort in front of the nose
const WINGS=[
 {name:'None',unlock:0,pieces:[]},
 // grey and blue -- the classic
 {name:'Delta',unlock:0,pieces:[
   px([[0,8],[2,8],[8,14],[0,14]],0,1.4,GREY,'light'),
   px([[0,14],[8,14],[6.2,17.6],[0,17.6]],0,1.4,GREY,'light'),
   bx(0,8.4,1.8,8.6,1.4,3,BLUE,'hull'),
   bx(0.2,8.8,1.4,7.8,4.4,1,WHITE,'trim'),
   px([[5.5,13.5],[6.7,14.3],[6.7,16.6],[5.5,16.1]],1.4,4,RED,'accent'),
   px([[2.2,10.6],[4.9,13],[3.9,13.9],[2.1,12]],1.4,1,BLUE,'hull'),
   px([[4.4,13.6],[7.2,15.2],[6.2,16.3],[4,14.8]],1.4,1,RED,'accent'),
   bx(2,15.3,1.4,1.6,1.4,1,YEL,'accent'),
   cyl(4.4,11.4,0.5,1.4,1.5,TBLU,'glass',{n:6}),
   tube(6.4,1.4,0.25,15.6,3.6,SILVER,'light',{n:6}),
 ]},
 // azure racer with white flashes
 {name:'Swept',unlock:1,pieces:[
   px([[0,7.4],[1.8,7.4],[8.4,14.4],[0,13]],0,1,AZ,'accent'),
   px([[0,13],[8.4,14.4],[9,17.6],[5.6,18.6],[0,17.2]],0,1,AZ,'accent'),
   bx(0,8,1.6,8.6,1,3,WHITE,'hull'),
   px([[1.9,9.4],[5.4,12.6],[4.4,13.6],[1.9,11.2]],1,1,WHITE,'hull'),
   tube(7.4,1,0.24,17.4,3.6,SILVER,'light',{n:6}),
   bx(5.6,15.2,1.6,2,1,2,NAVY,'dark'),
   ...(function(){const o=[];for(let i=0;i<3;i++)
     o.push(bx(1.9+i*0.1,14+i*1.1,1.2,0.9,1,1,WHITE,'trim'));return o;})(),
 ]},
 // black and orange rescue rig -- the pods become the Defense guns
 {name:'Guardian',unlock:3,pieces:[
   px([[0,8],[2,8],[7.6,11],[7.6,15],[0,15]],0,1,BLACK,'dark'),
   px([[0,15],[7.6,15],[6,18],[0,18]],0,1,BLACK,'dark'),
   bx(0,8.4,1.6,9.4,1,3,ORG,'accent'),
   tube(5,-1.4,1.5,10.4,6.4,DGREY,'light',{n:12}),
   tube(5,-1.4,1.6,16,1,ORG,'accent',{n:12}),
   tube(5,-1.4,0.5,7,3.6,SILVER,'light',{n:8}),
   tube(5,-1.4,0.7,9.6,1,ORG,'accent',{n:10}),
   ...(function(){const o=[];for(let i=0;i<3;i++)
     o.push(bx(2.4+i*1.6,9.2,1.4,1.2,1,1,i%2?ORG:WHITE,i%2?'accent':'trim'));return o;})(),
   bx(2.4,16,2.6,1.4,1,1,ORG,'accent'),
   px([[5.4,11.6],[7.4,12.4],[7.4,14.4],[5.4,14.4]],1,3,DGREY,'light'),
 ]},
 // red four-winger with white stripes and barrel tips
 {name:'Star-Four',unlock:7,pieces:[
   bx(0,8.4,2,9.2,0,6,RED,'hull'),
   bx(0.3,8.8,1.4,8.4,6,1,WHITE,'trim'),
   bx(1.6,9.2,1.6,2.2,3.4,3,BLACK,'dark'),
   bx(1.6,14.8,1.6,2.2,0,3,BLACK,'dark'),
   px([[0.6,9.2],[2.2,9.2],[7.4,5.4],[7.4,7.2],[2.2,10.9]],3.4,2,RED,'hull'),
   px([[1.6,9.4],[2.6,9.4],[6.8,6.3],[6.8,7.2]],5.4,1,WHITE,'trim'),
   px([[0.6,14.8],[2.2,14.8],[7.4,18.4],[7.4,20.2],[2.2,16.6]],0,2,RED,'hull'),
   px([[1.6,15],[2.6,15],[6.8,18],[6.8,18.9]],2,1,WHITE,'trim'),
   tube(6.7,5.2,0.42,3.2,4.4,SILVER,'light',{n:8}),
   tube(6.7,5.2,0.62,6.6,1,BLACK,'dark',{n:8}),
   tube(6.7,1,0.42,19.4,4.4,SILVER,'light',{n:8}),
   tube(6.7,1,0.62,18.4,1,BLACK,'dark',{n:8}),
   cyl(3.6,11,0.5,5.4,1.4,TORG,'glass',{n:6}),
   cyl(3.6,16.4,0.5,2,1.4,TORG,'glass',{n:6}),
 ]},
 // feathers, in blush and mint, with a rainbow along the trailing edge
 {name:'Pegasus',unlock:4,pal:PAL.unicorn,pieces:(function(){
   const o=[];
   o.push(px([[0,8],[2.2,7.4],[8.6,11],[8.2,13.4],[0,13]],0,1.2,BLUSH,'hull'));
   o.push(px([[0,13],[8.2,13.4],[7,17.4],[0,17]],0,1.2,BLUSH,'hull'));
   o.push(bx(0,8.4,1.7,8.4,1.2,3,WHITE,'trim'));
   // five feathers fanning off the trailing edge
   const F=[[2.2,14.2,3.4],[3.6,14.9,3.9],[5.0,15.5,3.6],[6.3,16.0,3.0],[7.4,16.4,2.4]];
   const CO=[HOTP,LAV,MINT,SKY,CREAM];
   F.forEach((f,i)=>{
     o.push(px([[f[0],f[1]],[f[0]+1.15,f[1]+0.25],[f[0]+0.8,f[1]+f[2]],[f[0]-0.1,f[1]+f[2]*0.86]],
               1.2,0.8,CO[i],i%2?'trim':'accent'));
   });
   // a second row of shorter feathers on top
   for(let i=0;i<4;i++)
     o.push(px([[2.6+i*1.35,12.2+i*0.5],[3.6+i*1.35,12.5+i*0.5],
                [3.3+i*1.35,15.0+i*0.5],[2.4+i*1.35,14.7+i*0.5]],2,0.7,WHITE,'trim'));
   o.push(...lamp(7.8,11.6,2.2,TPUR));
   o.push(tube(8.2,2,0.26,10.4,3.4,SILVER,'light',{n:6}));
   return o;})()},
 // three long bars and nothing between them -- a scaffold, not a wing.
 // Yellow with black hazard stripes, like something off a building site.
 {name:'Girder',unlock:2,pal:PAL.yellow,pieces:(function(){
   const o=[],ZS=[9.0,12.8,16.6];
   ZS.forEach((z,i)=>{
     o.push(bx(0.4,z,8.8,1.2,1+i*0.35,1,YEL,'hull'));           // the long bar
     o.push(bx(1.8,z+0.1,0.9,1.0,2+i*0.35,0.5,BLACK,'accent')); // hazard flashes
     o.push(bx(5.4,z+0.1,0.9,1.0,2+i*0.35,0.5,BLACK,'accent'));
     o.push(tube(8.9,(1+i*0.35)*1+1.1,0.62,z+0.2,2.2,DGREY,'light',{n:10}));
     o.push(tube(8.9,(1+i*0.35)*1+1.1,0.75,z+2.0,0.7,ORG,'trim',{n:10}));
     o.push(cyl(9.0,z+0.6,0.34,1+i*0.35+1.0,0.7,TYEL,'glass',{n:6}));  // tip lamp
   });
   o.push(bx(3.1,9.0,0.9,8.8,1,1,DGREY,'light'));               // two cross braces
   o.push(bx(6.7,9.0,0.9,8.8,1,1,DGREY,'light'));
   return o;})()},
 // one enormous turbofan a side, slung under a stubby white wing
 {name:'Turbofan',unlock:5,pal:PAL.airline,pieces:[
   px([[0,9.2],[3.0,9.2],[5.2,11.4],[5.2,15.4],[0,15.4]],0,1.4,WHITE,'hull'),
   bx(0,9.6,1.6,5.4,1.4,2,WHITE,'hull'),
   bx(0.3,10.0,1.0,4.6,3.4,0.6,NAVY,'trim'),
   bx(4.3,11.8,1.3,2.2,-1.6,3,DGREY,'light'),                   // pylon
   tube(6.0,-3.0,2.7,8.4,7.8,WHITE,'hull',{n:16}),              // the fan case
   tube(6.0,-3.0,2.8,15.2,1.0,NAVY,'accent',{n:16}),
   tube(6.0,-3.0,2.8,8.2,0.8,NAVY,'accent',{n:16}),
   tube(6.0,-3.0,1.95,8.0,0.7,DGREY,'light',{n:16}),            // intake lip
   tube(6.0,-3.0,0.7,7.4,1.6,SILVER,'light',{n:8}),             // spinner
   bx(5.4,10.6,1.2,1.2,2.6,0.6,NAVY,'trim'),
 ]},
 // four propellers a side on a twin boom. Deliberately silly.
 {name:'Rotors',unlock:8,pal:PAL.jungle,pieces:(function(){
   const o=[];
   o.push(bx(0,10.0,9.0,1.4,1.2,1,GRN,'hull'));
   o.push(bx(0,15.0,9.0,1.4,1.2,1,GRN,'hull'));
   o.push(bx(1.4,10.6,1.1,4.8,1.2,1,GRN,'hull'));               // spar between booms
   o.push(bx(6.6,10.6,1.1,4.8,1.2,1,GRN,'hull'));
   [[2.2,10.0],[6.2,10.0],[2.2,15.0],[6.2,15.0]].forEach(([x,z])=>{
     o.push(bx(x,z-0.1,1.6,1.6,2.2,2,LIME,'trim'));             // motor block
     o.push(...prop(x+0.8,z+0.7,4.6,3.0,LIME,'accent'));
   });
   o.push(tube(0.9,3,0.3,9.4,1.2,SILVER,'light',{n:6}));
   return o;})()},
 // alien tech: purple ring, lime beads, glowing inner nodes
 {name:'Halo',unlock:11,pieces:(function(){
   const o=[bx(0,11.6,2.4,3,1,3,PURP,'hull'),
            bx(0.4,12,1.6,2.2,4,1,LIME,'accent')];
   for(let i=0;i<16;i++){const a=i/16*Math.PI*2;
     o.push(cyl(5.4+Math.cos(a)*4.2,13+Math.sin(a)*4.2,0.62,1,1.8,
       i%2?PURP:LIME,i%2?'hull':'accent',{n:8}));}
   for(let i=0;i<4;i++){const a=i/4*Math.PI*2+0.78;
     o.push(cyl(5.4+Math.cos(a)*2.4,13+Math.sin(a)*2.4,0.45,1.6,1.2,TGRN,'glass',{n:6}));}
   return o;})()},
 // three layers of flame
 {name:'Phoenix',unlock:15,pieces:[
   bx(0,8.4,1.8,9.4,0,5,DRED,'hull'),
   px([[0,8.4],[1.8,8.4],[7.6,10.4],[5,12]],4,1,YEL,'accent'),
   px([[0,11],[1.8,11],[8.6,13.4],[5.6,15.2]],2,1,ORG,'accent'),
   px([[0,14],[1.8,14],[7.6,17.6],[3.6,18.2]],0,1,RED,'hull'),
   px([[4.6,9.6],[7,10.4],[5.6,11.6],[4,10.8]],5,1,GOLD,'accent'),
   bx(0.2,8.8,1.4,8.6,5,1,GOLD,'accent'),
   ...(function(){const o=[];for(let i=0;i<3;i++)
     o.push(cyl(2.2+i*1.2,9.4+i*2.6,0.5,5,1.4,TORG,'glass',{n:6}));return o;})(),
 ]},
 // leathery membrane on purple finger-bones
 {name:'Bat',unlock:6,pieces:[
   bx(0,8.4,1.5,9,0,4,'#3A2A44','dark'),
   px([[0,8],[1.6,8],[6.4,9.4],[4.4,11],[1.6,10.2]],1,1,BATW,'dark'),
   px([[0,10.2],[1.6,10.2],[7.2,12.2],[5,13.8],[1.6,12.8]],1,1,BATW,'dark'),
   px([[0,12.8],[1.6,12.8],[6.4,15.2],[4,16.4],[1.6,15.4]],1,1,BATW,'dark'),
   px([[1.3,8.5],[6,9.6],[5.85,10],[1.3,8.9]],2,1.2,'#B06BE0','accent'),
   px([[1.3,10.7],[6.8,12.5],[6.65,12.9],[1.3,11.1]],2,1.2,'#B06BE0','accent'),
   px([[1.3,13.3],[6,15.4],[5.85,15.8],[1.3,13.7]],2,1.2,'#B06BE0','accent'),
   cyl(6.1,9.4,0.36,1,2.6,'#C9C9C9','light',{n:6}),
   cyl(7,12.2,0.36,1,2.6,'#C9C9C9','light',{n:6}),
   cyl(6.1,15.2,0.36,1,2.6,'#C9C9C9','light',{n:6}),
   bx(0.2,8.8,1.1,8.2,4,1,PURP,'accent'),
 ]},
 // masts, canvas and a rigged yardarm
 {name:'Sails',unlock:12,pieces:[
   bx(0,8.6,1.8,8.6,0,4,WOOD,'dark'),
   bx(0.2,9,1.4,7.8,4,1,DWOOD,'dark'),
   cyl(1.9,12.4,0.5,4,13,WOOD,'dark',{n:8}),
   bx(0.4,12.1,6.4,0.55,15,1,WOOD,'dark'),
   bx(0.9,12.25,5.4,0.32,8,7,SAIL,'trim'),
   bx(0.4,12.1,6.4,0.55,7.2,0.8,WOOD,'dark'),
   bx(1.2,12.24,4.4,0.3,15.6,1,RED,'accent'),
   ...(function(){const o=[];for(let i=0;i<3;i++)
     o.push(bx(1.4+i*1.6,12.18,0.3,0.42,8,7,DWOOD,'dark'));return o;})(),
   cyl(1.9,12.4,0.75,17,1.2,GOLD,'accent',{n:8}),
   px([[1.2,15.6],[4.6,16.4],[4.6,17.2],[1.2,16.8]],4,2,DWOOD,'dark'),
   bx(0.6,9.2,1.2,1.4,4,3,DWOOD,'dark'),
 ]},
];


const ENGINES=[
 {name:'Single',unlock:0,thrust:1,pieces:[
   bx(-3,17.4,6,1.8,0,4,RED,'accent'),
   tube(0,2,3,18,5,WHITE,'light',{n:16}),
   tube(0,2,3.15,17.9,0.9,RED,'accent',{n:16}),
   tube(0,2,3.2,22,1.1,RED,'accent',{n:16}),
   tube(0,2,2.4,22.9,0.6,TBLU,'glass',{n:16}),
   ...mirX([px([[2.4,18.2],[4.6,20],[4.6,22],[2.4,22]],1,1,WHITE,'light')]),
   ...mirX([bx(2.4,18.4,1.2,3.6,4,1,RED,'accent')]),
 ],nozzles:[{x:0,y:2,z:23.6,r:14}]},
 {name:'Twin',unlock:0,thrust:1.3,pieces:[
   bx(-4.4,17.4,8.8,1.8,0,4,DGREY,'dark'),
   bx(-4.4,17.4,8.8,1.8,4,1,BLUE,'hull'),
   ...mirX([
     tube(2.9,2,2.1,18,5,BLUE,'hull',{n:14}),
     tube(2.9,2,2.2,17.9,0.8,WHITE,'trim',{n:14}),
     tube(2.9,2,2.25,22,1.1,DGREY,'dark',{n:14}),
     tube(2.9,2,1.7,22.9,0.6,TBLU,'glass',{n:14}),
     bx(1.2,18.6,0.9,3,4,1,YEL,'accent'),
   ]),
 ],nozzles:[{x:-2.9,y:2,z:23.6,r:10},{x:2.9,y:2,z:23.6,r:10}]},
 {name:'Ion',unlock:4,thrust:1.6,pieces:[
   bx(-6.5,17.4,13,1.8,0,4,BLACK,'dark'),
   bx(-6.5,17.4,13,1.8,4,1,LIME,'accent'),
   ...mirX([
     tube(4.4,2,1.5,18,4.4,BLACK,'dark',{n:12}),
     tube(4.4,2,1.6,21.6,0.9,DGREY,'dark',{n:12}),
     tube(4.4,2,1.2,22.4,0.5,TGRN,'glass',{n:12}),
     px([[5.6,17.6],[7.4,19.4],[7.4,22],[5.6,22]],1,1,LIME,'accent'),
     bx(2.6,18,1.2,1.2,4,1,LIME,'accent'),
   ]),
   tube(0,2,1.5,18,4.4,BLACK,'dark',{n:12}),
   tube(0,2,1.6,21.6,0.9,DGREY,'dark',{n:12}),
   tube(0,2,1.2,22.4,0.5,TGRN,'glass',{n:12}),
   bx(-1,18.2,2,1.4,4,2,GRN,'accent'),
 ],nozzles:[{x:-4.4,y:2,z:23,r:7},{x:0,y:2,z:23,r:7},{x:4.4,y:2,z:23,r:7}]},
 // one enormous reactor bell
 {name:'Pulse',unlock:10,thrust:2,pieces:[
   bx(-3.6,17.2,7.2,1.6,0,4,BLACK,'dark'),
   tube(0,2,4.4,17.6,5.4,PURP,'hull',{n:18}),
   tube(0,2,4.5,17.5,1,SILVER,'light',{n:18}),
   tube(0,2,4.7,22,1.4,BLACK,'dark',{n:18}),
   tube(0,2,3.6,23.2,0.8,TPUR,'glass',{n:18}),
   ...mirX([
     px([[3.4,17.8],[6.2,19.6],[6.2,22.4],[3.4,22.4]],1,1,LAV,'accent'),
     tube(4.6,5.4,0.5,18.4,4,SILVER,'light',{n:8}),
   ]),
   bx(-2,17.6,4,1.2,5,2,LAV,'accent'),
 ],nozzles:[{x:0,y:2,z:24,r:22}]},
 {name:'Quad',unlock:14,thrust:2.4,pieces:[
   bx(-7.6,17.4,15.2,1.8,0,4,DGREY,'dark'),
   bx(-7.6,17.4,15.2,1.8,4,1,ORG,'accent'),
   ...mirX([
     tube(2.3,2,1.55,18,4.6,ORG,'accent',{n:12}),
     tube(2.3,2,1.65,21.8,0.9,BLACK,'dark',{n:12}),
     tube(2.3,2,1.25,22.6,0.5,TORG,'glass',{n:12}),
     tube(6.2,2,1.55,18,4.6,ORG,'accent',{n:12}),
     tube(6.2,2,1.65,21.8,0.9,BLACK,'dark',{n:12}),
     tube(6.2,2,1.25,22.6,0.5,TORG,'glass',{n:12}),
     bx(4.1,18,0.9,3.4,4,1,ORG,'accent'),
     px([[7.4,17.6],[8.6,19],[8.6,21.6],[7.4,21.6]],1,1,ORG,'accent'),
   ]),
 ],nozzles:[{x:-6.2,y:2,z:23.2,r:7},{x:-2.3,y:2,z:23.2,r:7},
            {x:2.3,y:2,z:23.2,r:7},{x:6.2,y:2,z:23.2,r:7}]},
 // two broomsticks, bristles and all
 {name:'Broom',unlock:7,thrust:1.8,pieces:[
   bx(-2.6,17.4,5.2,1.8,0,4,DWOOD,'dark'),
   bx(-2.6,17.4,5.2,1.8,4,1,GOLD,'accent'),
   ...mirX([
     tube(2,2,0.5,17.8,5.4,WOOD,'dark',{n:8}),
     tube(2,2,0.64,20.2,0.8,GOLD,'accent',{n:8}),
     tube(2,2,1.05,22.4,0.7,'#4A3A22','dark',{n:12}),
     tube(2,2,1.45,23,2.6,BRIS,'light',{n:12,ts:0.28}),
     bx(1.4,18.2,1.2,1,4.2,1,GOLD,'accent'),
   ]),
 ],nozzles:[{x:-2,y:2,z:25.4,r:10},{x:2,y:2,z:25.4,r:10}]},
];

// Defence mounts on the hull deck the same way wings mount on the hull edge:
// each hull says where, each defence is drawn from that point forward.
const DEFENSES=[
 {name:'Blaster',unlock:2,rate:11,dmg:2,col:'#FF6A3D',
  bolts:[{x:0,vx:0}],pieces:[
   bx(-0.9,0,1.8,2.8,0,2,DGREY,'dark'),
   bx(-0.7,0.4,1.4,1.6,2,2,BLACK,'dark'),
   tube(0,3,0.38,-2.6,3.6,SILVER,'light',{n:8}),
   tube(0,3,0.55,-0.6,0.9,RED,'accent',{n:8}),
   ...mirX([bx(0.9,0.6,0.5,1.4,1,2,ORG,'accent')]),
 ]},
 {name:'Twin',unlock:4,rate:18,dmg:2,col:'#FFC13D',
  bolts:[{x:-2,vx:0},{x:2,vx:0}],pieces:[
   bx(-2.9,0.2,5.8,2.4,0,2,DGREY,'dark'),
   ...mirX([
     bx(1.2,0,1.8,2.6,2,2,BLACK,'dark'),
     tube(2.1,4,0.38,-2.4,3.6,SILVER,'light',{n:8}),
     tube(2.1,4,0.55,-0.4,0.9,YEL,'accent',{n:8}),
   ]),
   bx(-0.8,0.6,1.6,1.6,2,3,YEL,'accent'),
 ]},
 {name:'Scatter',unlock:6,rate:24,dmg:2,col:'#7BEE4A',
  bolts:[{x:0,vx:0},{x:-2.6,vx:-1.7},{x:2.6,vx:1.7}],pieces:[
   bx(-3.6,0.4,7.2,2.2,0,2,BLACK,'dark'),
   bx(-1,0,2,2.8,2,2,GRN,'accent'),
   tube(0,4,0.4,-2.6,3.6,SILVER,'light',{n:8}),
   ...mirX([
     px([[1,0.6],[3.8,0],[3.8,2.2],[1,2.4]],2,2,GRN,'accent'),
     tube(2.9,4,0.34,-1.8,3,SILVER,'light',{n:8}),
     tube(2.9,4,0.5,0.6,0.8,LIME,'accent',{n:8}),
   ]),
   bx(-0.7,2.4,1.4,1.2,4,2,LIME,'accent'),
 ]},
 {name:'Pulse',unlock:9,rate:64,dmg:2,ring:true,col:'#AEEFEC',
  pieces:[
   cyl(0,1.8,2.6,0,1.6,DGREY,'dark',{n:14}),
   cyl(0,1.8,2.1,1.6,1.4,AZ,'accent',{n:14}),
   cyl(0,1.8,1.7,3,2.2,TBLU,'glass',{n:14,ts:0.5}),
   ...(function(){const o=[];for(let i=0;i<6;i++){const a=i/6*Math.PI*2;
     o.push(cyl(Math.cos(a)*2.4,1.8+Math.sin(a)*2.4,0.42,1.6,1.4,WHITE,'trim',{n:6}));}
     return o;})(),
 ]},
 {name:'Scythe',unlock:11,rate:58,boltEvery:19,dmg:2,arc:true,arcR:60,col:'#AEEFEC',
  bolts:[{x:0,vx:0}],
  pieces:[
   bx(-1.4,0.6,2.8,3,0,3,DGREY,'dark'),
   cyl(0,2.2,0.7,3,1.6,SILVER,'light',{n:10}),
   // the boom, and the curved blade on the end of it
   tube(0,4.2,0.34,-2.6,3.4,SILVER,'light',{n:8}),
   ...(function(){const o=[];
     for(let i=0;i<7;i++){
       const a=-0.95+i*0.32, r=3.5;
       o.push(bx(Math.cos(a)*r-0.35,2.2+Math.sin(a)*r-0.35,0.75,0.75,
                 3.4+i*0.12,0.6,i%2?TBLU:SILVER,i%2?'glass':'light',{studs:false}));
     }
     return o;})(),
   ...mirX([cyl(1.5,1.2,0.36,3,1.2,AZ,'accent',{n:6})]),
 ]},
 {name:'Lance',unlock:15,rate:12,dmg:3,big:true,col:'#D9A6F0',
  bolts:[{x:0,vx:0}],pieces:[
   bx(-1.6,0.4,3.2,3.4,0,3,BLACK,'dark'),
   tube(0,4,0.95,-4.4,6,SILVER,'light',{n:12}),
   tube(0,4,1.15,-1.4,1,PURP,'accent',{n:12}),
   tube(0,4,1.15,1.6,1,PURP,'accent',{n:12}),
   tube(0,4,0.7,-5.2,0.9,TPUR,'glass',{n:12}),
   ...mirX([bx(1.4,0.8,0.7,2.4,1,3,LAV,'accent')]),
 ]},
 // a trebuchet. Slow, heavy, and it throws a rock.
 {name:'Catapult',unlock:12,rate:30,dmg:3,col:'#D9A05B',
  bolts:[{x:0,vx:0},{x:-2.4,vx:-1.5},{x:2.4,vx:1.5}],pieces:[
   bx(-2.1,0.4,4.2,3.6,0,2,DWOOD,'dark'),
   ...mirX([
     bx(1.2,0.6,0.7,0.9,2,5,WOOD,'dark'),
     bx(1.2,2.8,0.7,0.9,2,3.4,WOOD,'dark'),
     px([[1.05,0.7],[1.95,0.7],[1.95,3.4],[1.05,3.4]],6.6,0.9,WOOD,'dark'),
     bx(1.25,1.6,0.6,1.4,2,1,GOLD,'accent'),
   ]),
   px([[-0.45,-2.4],[0.45,-2.4],[0.45,2.8],[-0.45,2.8]],4,1.4,WOOD,'dark'),
   cyl(0,-2.5,0.85,4.2,1.7,DGREY,'dark',{n:10}),
   cyl(0,-2.5,0.7,5.5,1.3,STONE,'light',{n:10}),
   bx(-1.5,3.2,3,0.9,2,3,GOLD,'accent'),
   bx(-0.8,3.4,1.6,0.6,5,2,DWOOD,'dark'),
 ]},
];

// Tails mount at the back of the deck. A bigger tail turns the ship faster.
const TAILS=[
 {name:'Fin',unlock:0,turn:1.15,pieces:[
   px([[-0.55,0],[0.55,0],[0.55,4.4],[-0.55,4.4]],0,9,BLUE,'hull'),
   px([[-0.6,0.2],[0.6,0.2],[0.6,2.2],[-0.6,2.2]],9,2,WHITE,'trim'),
   bx(-1.6,0,3.2,1.6,0,2,DGREY,'dark'),
   ...mirX([bx(0.6,0.4,1,1.2,2,1,RED,'accent')]),
 ]},
 {name:'Twin Fin',unlock:2,turn:1.28,pieces:[
   bx(-2.6,0,5.2,1.8,0,2,DGREY,'dark'),
   ...mirX([
     px([[1,0.2],[2.1,0.2],[2.6,4],[1.5,4]],2,8,RED,'hull'),
     px([[1.1,0.4],[2,0.4],[2.3,2],[1.4,2]],10,2,WHITE,'trim'),
     bx(1.2,3.4,1.2,1,2,1,YEL,'accent'),
   ]),
 ]},
 {name:'Sail',unlock:5,turn:1.06,pieces:[
   bx(-3.4,0,6.8,1.6,0,2,BLACK,'dark'),
   px([[-2.9,1.3],[2.9,1.3],[2.2,2.2],[-2.2,2.2]],2,11,ORG,'accent'),
   px([[-2.5,1.4],[2.5,1.4],[1.95,2.1],[-1.95,2.1]],13,2,WHITE,'trim'),
   px([[-1.2,1.35],[1.2,1.35],[1.0,2.15],[-1.0,2.15]],6,3,BLACK,'dark'),
   ...mirX([cyl(2.4,0.7,0.5,2,3,TORG,'glass',{n:6}),
            px([[1.4,0.3],[2.6,0.5],[2.6,1.3],[1.4,1.3]],2,3,ORG,'accent')]),
 ]},
 {name:'Boom',unlock:9,turn:1.34,pieces:[
   bx(-1.4,0,2.8,1.8,0,3,DGREY,'dark'),
   tube(0,3,0.85,0.6,6.4,SILVER,'light',{n:10}),
   tube(0,3,1.05,5.4,0.9,AZ,'accent',{n:10}),
   tube(0,3,0.6,6.8,0.8,TBLU,'glass',{n:10}),
   ...mirX([
     px([[0.7,1.4],[3,2.6],[3,4],[0.7,3.4]],2,2,AZ,'accent'),
     cyl(2.5,3.2,0.45,4,1.4,TBLU,'glass',{n:6}),
   ]),
 ]},
 {name:'Spines',unlock:12,turn:1.12,pieces:(function(){
   const o=[bx(-1.5,0,3,5.4,0,2,DRED,'hull')];
   for(let i=0;i<5;i++)
     o.push(px([[-0.5,0.4+i*1],[0.5,0.4+i*1],[0.35,1.2+i*1],[-0.35,1.2+i*1]],
       2,7-i*0.8,i%2?GOLD:DRED,i%2?'accent':'hull'));
   return o;})()},
 // a pennant on a pole, gold-striped
 {name:'Banner',unlock:3,turn:1.1,pieces:[
   bx(-1.4,0,2.8,2.2,0,3,DWOOD,'dark'),
   cyl(0,1,0.28,3,12,WOOD,'dark',{n:6}),
   cyl(0,1,0.55,14.6,1,GOLD,'accent',{n:8}),
   bx(0.1,1.15,0.3,4.4,8,6,RED,'accent'),
   bx(0.14,1.3,0.3,1.1,8,6,GOLD,'accent'),
   bx(0.14,3.6,0.3,1.1,8,6,GOLD,'accent'),
   bx(0.1,5.55,0.3,1,9.4,3.2,RED,'accent'),
   ...mirX([bx(0.9,0.4,0.7,1.2,3,2,GOLD,'accent')]),
 ]},
];

/* ---------- colour: keep the real piece colours, or repaint by role ---------- */
const THEMES=[
 {name:'Classic',unlock:0,natural:true,glow:TYEL,flame:'#FFF3C0',flame2:'#4BA3E3'},
 {name:'Rocket Red',unlock:0,hull:RED,trim:WHITE,light:GREY,dark:BLACK,glass:TBLU,accent:YEL,
  glow:YEL,flame:'#FFF3C0',flame2:ORG},
 {name:'Jungle',unlock:1,hull:GRN,trim:LIME,light:GREY,dark:BLACK,glass:TGRN,accent:LIME,
  glow:LIME,flame:'#F2FFD0',flame2:LIME},
 {name:'Sunburst',unlock:4,hull:YEL,trim:ORG,light:WHITE,dark:BLACK,glass:TORG,accent:RED,
  glow:ORG,flame:'#FFFFFF',flame2:ORG},
 {name:'Violet',unlock:7,hull:LAV,trim:WHITE,light:PINK,dark:BLACK,glass:TPUR,accent:PURP,
  glow:'#C86FE0',flame:'#FFFFFF',flame2:'#C86FE0'},
 {name:'Ice',unlock:9,hull:WHITE,trim:AZ,light:'#C9D6DE',dark:BLACK,glass:TBLU,accent:AZ,
  glow:'#78D9F0',flame:'#FFFFFF',flame2:'#78D9F0'},
 {name:'Unicorn',unlock:1,hull:BLUSH,trim:WHITE,light:'#F2D8E6',dark:PURP,glass:TPUR,accent:LAV,
  glow:'#E7A6E0',flame:'#FFFFFF',flame2:'#E7A6E0'},
 {name:'Sherbet',unlock:3,hull:HOTP,trim:CREAM,light:'#FFB9D6',dark:PURP,glass:TPUR,accent:MINT,
  glow:MINT,flame:'#FFFFFF',flame2:'#7FE5C4'},
 {name:'Midnight',unlock:2,hull:'#1B2A34',trim:GOLD,light:'#3E4C57',dark:'#0E161C',glass:TYEL,accent:GOLD,
  glow:GOLD,flame:'#FFF3C0',flame2:GOLD},
 {name:'Candy',unlock:5,hull:'#E4ADC8',trim:WHITE,light:'#F7DCE8',dark:'#8E4C6B',glass:'#FFD9EC',accent:'#FF5FA2',
  glow:'#FF5FA2',flame:'#FFFFFF',flame2:'#FF8FC4'},
 {name:'Desert',unlock:8,hull:TAN,trim:'#7A5230',light:'#E8D8B0',dark:'#4A3A22',glass:TORG,accent:'#B5651D',
  glow:'#E8A33D',flame:'#FFF3C0',flame2:'#E8A33D'},
 {name:'Toxic',unlock:11,hull:'#3A4A12',trim:LIME,light:'#7E8F3A',dark:'#12180A',glass:TGRN,accent:LIME,
  glow:LIME,flame:'#EFFFC0',flame2:LIME},
 {name:'Coral',unlock:14,hull:'#FF6A4D',trim:'#0FB5AE',light:'#FFB3A0',dark:'#7A2418',glass:'#9FF0EC',accent:'#0FB5AE',
  glow:'#0FB5AE',flame:'#FFFFFF',flame2:'#5BE0DA'},
];

/* ---------- assembling the ship ---------- */
// defence sits on the deck, so it shifts in y and z rather than x
const placeZ=(ps,dy,dz)=>ps.map(p=>{
 const q=Object.assign({},p);delete q._g;delete q._bb;
 if((p.ax||'y')==='y'){q.pts=p.pts.map(a=>[a[0],a[1]+dz]);q.y=p.y+dy;}
 else{q.pts=p.pts.map(a=>[a[0],a[1]+dy]);q.y=p.y+dz;}
 return q;});
const place=(ps,dx,dy)=>ps.map(p=>{
 const q=Object.assign({},p);delete q._g;delete q._bb;
 if((p.ax||'y')==='y'){q.pts=p.pts.map(a=>[a[0]+dx,a[1]]);q.y=p.y+dy;}
 else{q.pts=p.pts.map(a=>[a[0]+dx,a[1]+dy]);}
 return q;});
// -1 everywhere: an empty baseplate until he builds something
// tail slot removed: the fins never looked like anything
const ship={body:-1,wings:-1,cockpit:-1,engine:-1,tail:-1,defense:-1,pilot:-1,theme:0};
/* Assign each option its dominant colour, then open four of everything at
   level one instead of two, filling the rest in by level twelve. A kid should
   have a real choice on the first screen, not two shapes and a lock. */
/* What each part is for. None of it changes how the ship flies -- it is there
   so a six-year-old choosing between two shapes has a reason to prefer one. */
const ABOUT={
 BODIES:{Slim:'Narrow and quick. Nothing spare on it.',
   Wide:'A flat deck with room to bolt anything on.',
   Pods:'Cargo pods down both sides. Built to haul.',
   Core:'A reactor in the middle, glowing away.',
   Keep:'Cut from castle stone. Heavy, and proud of it.'},
 WINGS:{None:'No wings at all. Very brave.',
   Delta:'The classic swept wing. Steady in a straight line.',
   Swept:'Thin and fast. For going somewhere in a hurry.',
   Guardian:'Rescue rig with side pods. Turns up when things go wrong.',
   'Star-Four':'Four wings in an X, a cannon on every tip.',
   Girder:'Three long girders and a lamp on each end. Built, not styled.',
   Turbofan:'Two enormous fans. Loud. Moves a lot of air.',
   Rotors:'Eight propellers. Nobody is sure why it works.',
   Halo:'An alien ring that hums. Best not to touch it.',
   Phoenix:'Feathered, and warm to the touch.',
   Bat:'Leathery wings, for flying at night.',
   Sails:'Actual canvas sails. Catches the solar wind.'},
 COCKPITS:{Classic:'The one everybody starts with. Good windows.',
   Bubble:'A round glass dome. You can see everything.',
   Interceptor:'Low, sharp, and pointed forward.',
   'Twin Pod':'Two seats. Bring a friend.',
   Saucer:'Definitely borrowed from something that landed.',
   Dragon:'It has a face. The face has opinions.',
   Castle:'A stone turret with a flag on top.',
   Wizard:'A pointed hat. Steers on vibes.'},
 ENGINES:{Single:'One engine, straight down the middle.',
   Twin:'Two engines. Twice the shove.',
   Ion:'A quiet blue ion drive. Sneaky.',
   Pulse:'Fires in thumps you can feel.',
   Quad:'Four nozzles. Absurd, and it knows it.',
   Broom:'A broomstick. It flies. Do not ask.'},
 TAILS:{Fin:'One fin at the back. Keeps you pointing forward.',
   'Twin Fin':'Two fins. Twice as pointed forward.',
   Sail:'A tall sail, mostly for the look.',
   Boom:'A long boom out the back with lights on it.',
   Spines:'Spiky. Discourages tailgating.',
   Banner:'Flies your colours out behind you.'},
 DEFENSES:{Blaster:'One steady blaster. Never jams.',
   Scythe:'A blade on a boom. Sweeps whatever gets close.',
   Twin:'Two barrels, fired together.',
   Scatter:'Sprays wide. Good when you are panicking.',
   Pulse:'A ring that goes out and shoves rocks apart.',
   Lance:'One long beam. Punches straight through.',
   Catapult:'Lobs a rock back at the rocks.'},
};
const PART_PAL={
 COCKPITS:{Classic:'blue',Bubble:'ice',Interceptor:'red','Twin Pod':'airline',
           Saucer:'alien',Dragon:'jungle',Castle:'sand',Wizard:'candy'},
 BODIES:  {Slim:'blue',Wide:'ice',Pods:'hazard',Core:'red',Keep:'sand'},
 WINGS:   {Delta:'blue',Swept:'ice',Guardian:'hazard','Star-Four':'red',
           Girder:'yellow',Turbofan:'airline',Rotors:'jungle',Halo:'alien',
           Phoenix:'gold',Bat:'bat',Sails:'canvas'},
 ENGINES: {Single:'blue',Twin:'ice',Ion:'alien',Pulse:'hazard',Quad:'red',Broom:'sand'},
 TAILS:   {Fin:'blue','Twin Fin':'red',Sail:'canvas',Boom:'yellow',Spines:'alien',Banner:'gold'},
 DEFENSES:{Blaster:'hazard',Twin:'yellow',Scatter:'red',Pulse:'alien',Scythe:'ice',
           Lance:'ice',Catapult:'sand'},
};
// four options everywhere at level one, everything open by twelve
const UNLOCK_STEPS=[0,0,0,0,1,2,3,4,5,6,7,8];
(function(){
 const slots={COCKPITS,BODIES,WINGS,ENGINES,TAILS,DEFENSES};
 for(const k in slots){
   const list=slots[k],tbl=PART_PAL[k]||{};
   const ab=ABOUT[k]||{};
   list.forEach(o=>{const n=tbl[o.name];if(n&&PAL[n])o.pal=PAL[n];tintPart(o);
     if(ab[o.name])o.about=ab[o.name];});
   list.map((o,i)=>i).sort((a,b)=>(list[a].unlock-list[b].unlock)||(a-b))
       .forEach((k2,rank)=>{
         list[k2].unlock=UNLOCK_STEPS[Math.min(rank,UNLOCK_STEPS.length-1)];});
 }
 THEMES.map((o,i)=>i).sort((a,b)=>(THEMES[a].unlock-THEMES[b].unlock)||(a-b))
   .forEach((k2,rank)=>{THEMES[k2].unlock=UNLOCK_STEPS[Math.min(rank,UNLOCK_STEPS.length-1)];});
})();

function shipPieces(){
 const hull=ship.body>=0?BODIES[ship.body]:null;
 const hw=hull?hull.halfW:4,wy=hull?hull.wingY:2,
       dy=hull?hull.defY:4,dz=hull?hull.defZ:8.6,
       ty=hull?hull.tailY:4,tz=hull?hull.tailZ:15.2;
 let out=hull?hull.pieces.slice():[];
 if(ship.cockpit>=0){const C=COCKPITS[ship.cockpit];out=out.concat(C.pieces);
   if(ship.pilot>=0&&C.seat)out=out.concat(pilotAt(C.seat[0],C.seat[1],C.seat[2],PILOTS[ship.pilot]));}
 if(ship.wings>=0){const w=WINGS[ship.wings].pieces;
   if(w.length)out=out.concat(mirX(place(w,hw,wy)));}
 if(ship.engine>=0)out=out.concat(ENGINES[ship.engine].pieces);
 if(ship.defense>=0)out=out.concat(placeZ(DEFENSES[ship.defense].pieces,dy,dz));
 return out;
}

export {
 STUD, PLATE, TILT, RISE, CZ, CY, nrm,
 rect, px, bx, SLOPES, sl, ring, cyl, tube, mirX, place, placeZ, prop, pilotAt,
 PAL, tintPart, ABOUT, PART_PAL, UNLOCK_STEPS,
 PILOTS, COCKPITS, BODIES, WINGS, ENGINES, DEFENSES, TAILS, THEMES,
 ship, shipPieces, bbox, inPoly, studCovered,
};

/* ---------- settle: no piece hangs in mid-air ---------------------------
   Small decorative pieces -- greeble strips, badges, lamps -- were authored
   against a painter's-algorithm renderer, where a tile a plate too high still
   drew over the brick below and read as attached. A depth buffer shows the
   gap. Rather than hand-nudging dozens of y values across the catalogue, drop
   anything that ends up detached onto whatever is directly beneath it.
   Units here are studs throughout: y in plates is scaled by 0.4.
   ------------------------------------------------------------------------ */
function solid(p){                                   // [x0,x1,y0,y1,z0,z1] in studs
  const ax=p.ax||'y';
  let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9,z0=1e9,z1=-1e9;
  const put=(x,y,z)=>{if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;
                      if(z<z0)z0=z;if(z>z1)z1=z;};
  // A dome or cone is far narrower at the top than its footprint suggests;
  // using the footprint for both ends is what let a tile hover on a canopy's
  // shoulder and still count as resting on it.
  const ts=p.ts===undefined?1:p.ts;
  let cu=0,cv=0; for(const q of p.pts){cu+=q[0];cv+=q[1];}
  cu/=p.pts.length; cv/=p.pts.length;
  for(let k=0;k<p.pts.length;k++){
    const q=p.pts[k], th=p.hs?p.hs[k]:p.h;
    const tu=cu+(q[0]-cu)*ts, tv=cv+(q[1]-cv)*ts;
    if(ax==='y'){ put(q[0],p.y*0.4,q[1]); put(tu,(p.y+th)*0.4,tv); }
    else        { put(q[0],q[1]*0.4,p.y); put(tu,tv*0.4,p.y+th); }
  }
  return [x0,x1,y0,y1,z0,z1];
}
export function settle(ps){
  const B=ps.map(solid), n=B.length, G=0.18;         // touching within ~half a plate
  const near=(a,b)=>a[0]-G<b[1]&&b[0]-G<a[1]&&a[2]-G<b[3]&&b[2]-G<a[3]&&
                    a[4]-G<b[5]&&b[4]-G<a[5];
  const comp=new Array(n).fill(-1); let c=0;
  for(let i=0;i<n;i++){ if(comp[i]>=0)continue;
    const st=[i]; comp[i]=c;
    while(st.length){ const k=st.pop();
      for(let j=0;j<n;j++) if(comp[j]<0&&near(B[k],B[j])){comp[j]=c;st.push(j);} }
    c++; }
  if(c<2)return ps;
  const size=new Array(c).fill(0); for(const v of comp)size[v]++;
  let main=0; for(let k=1;k<c;k++) if(size[k]>size[main])main=k;

  // Studs. A loose piece can fall a long way onto the deck below it -- that
  // only ever looks more right -- but sliding one sideways into a neighbour
  // is a guess, so sideways stays short.
  const MAXDROP=6, MAXSLIDE=1.7;
  const out=ps.slice();
  for(let k=0;k<c;k++){
    if(k===main)continue;
    const f=[1e9,-1e9,1e9,-1e9,1e9,-1e9];            // the stray group's own box
    for(let i=0;i<n;i++) if(comp[i]===k){ const b=B[i];
      for(let a=0;a<6;a+=2){ f[a]=Math.min(f[a],b[a]); f[a+1]=Math.max(f[a+1],b[a+1]); } }

    /* Move it the shortest way back into contact. Gravity is the usual
       answer -- a badge a plate too high -- so vertical moves are costed
       straight and sideways ones at a premium, which keeps a tile settling
       onto the canopy under it rather than sliding into a neighbour. */
    let best=null;
    for(let ax=0;ax<3;ax++){
      const lo=ax*2, w=(ax+1)%3*2, v=(ax+2)%3*2, bias=ax===1?1:1.35;
      for(let i=0;i<n;i++){
        if(comp[i]!==main)continue;                  // settle onto the body, never onto another stray
        const b=B[i];
        if(b[w]-G>=f[w+1]||f[w]-G>=b[w+1])continue;  // must already line up
        if(b[v]-G>=f[v+1]||f[v]-G>=b[v+1])continue;  // on the other two axes
        let t;
        if(f[lo]>=b[lo+1]) t=b[lo+1]-f[lo];          // sitting above / outboard
        else if(f[lo+1]<=b[lo]) t=b[lo]-f[lo+1];
        else continue;                               // already through it
        if(Math.abs(t)>(ax===1?MAXDROP:MAXSLIDE))continue;
        if(ax===1&&t>0.9)continue;                   // lift it a touch, never launch it
        if(!best||Math.abs(t)*bias<best.cost) best={ax,t,cost:Math.abs(t)*bias};
      }
    }
    if(!best||Math.abs(best.t)<0.02)continue;        // nothing to meet, or already touching

    const dx=best.ax===0?best.t:0, dy=best.ax===1?best.t:0, dz=best.ax===2?best.t:0;
    const dp=dy/0.4;                                 // studs back into plates
    for(let i=0;i<n;i++){ if(comp[i]!==k)continue;
      const q=Object.assign({},out[i]);
      delete q._g; delete q._bb; delete q._g3;
      if((q.ax||'y')==='y'){ q.y+=dp; q.pts=q.pts.map(a=>[a[0]+dx,a[1]+dz]); }
      else                 { q.y+=dz; q.pts=q.pts.map(a=>[a[0]+dx,a[1]+dp]); }
      out[i]=q; }
  }
  return out;
}
