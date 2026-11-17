// Water page gates on recorded fixtures, on the CPU (docs/WATER-LAYER.md, phase 1). For a grid of height pages it
// builds the old water (the excess plane of resample.js) and the water layer (water-layer.js), and measures both
// against a brute-force reference of the map's water: containment by even-odd over every ring of the point's tile
// and every centreline channel (no bins, bands or orientation), and the union's edge found by sampling every polygon
// edge and channel outline every 1/16 texel and keeping the samples where water changes across them (no wet-edge
// rules). Measures, per level:
//   shore      zero crossings of the page's water (sdf < 0, or excess > 0) along texel rows and columns: their
//              distance to the reference edge, in texels (gate: within half a texel)
//   classes    texels farther than half a texel from the reference edge whose wet/dry differs from it
//   sdf        |page distance - reference distance| for texels within 4 texels of the edge, in texels
//   edges      neighbouring pages at the same level: largest difference over their overlapping texels (levels where
//              both pages are wet or within two texels of a shore, where the surface reads them)
//   levels     adjacent wet texels whose level step exceeds the reference's own step by over 5 cm, and wet texels
//              more than 10 cm under the reference level (a trench); seam texels (wet beside wet of another body)
//              the page leaves dry
//   coarse     the water layer at level L against L+1 at their common grid points: distance, level, and coverage
//              against the 2 x 2 tent filter of the finer coverage
//   ms         page build times (warm, second build): whole page, and the water layer alone
//   node tools/Measure-Water-Pages.mjs --fixture-path F --at X,Y --levels 12,13,14,15 --radius 1 [--sea] --out DIR
//   [--modules DIR] another build of web/field for the old path
import {withCoarserTiles} from './Fixture-Dem.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {png} from './Explorer-Test-Lib.mjs';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const modules=resolve(arg('modules','web/field')),url=(d,f)=>pathToFileURL(resolve(d,f)).href;
const {buildHeightPage,waterExcessValue,exactTexelMap,pageCellMetres,coarseRiverDemZoom}=await import(url('web/field','resample.js'));
const old=modules===resolve('web/field')?null:await import(url(modules,'resample.js'));
const {directionToChart,lonLatToDirection,mercatorToLonLat}=await import(url('web/field','chart.js'));
const {waterBodies}=await import(url('web/field','water-layer.js'));
const {NO_WATER}=await import(url('web/field','water.js'));
const {metresPerMercator,insideRings}=await import(url('web/field','map-water.js'));
const {riverField}=await import(url('web/field','rivers.js'));
const real=JSON.parse(await readFile(arg('fixture-path'),'utf8')),levels=arg('levels','12,13,14,15').split(',').map(Number),radius=+arg('radius',1);
const [AX,AY]=(arg('at')??(()=>{const t=real.rivers[real.rivers.length>>1],n=2**t.z;return `${(t.x+.5)/n},${(t.y+.5)/n}`;})()).split(',').map(Number);
const sea=process.argv.includes('--sea'),out=resolve(arg('out','evidence/local/water-pages'));await mkdir(out,{recursive:true});
const z=real.dem[0].z,source={id:'fixture',channel:'height',tileSize:256,minZoom:z,maxZoom:z,coverage:{latLimit:85},seabedZoom:10};
const {WATER_STEPS}=await import(url('web/field','water-steps.js'));
const prepare=t=>{const tile={...t,heights:Float32Array.from(t.heights)};if(!sea)return tile;
 const scan=WATER_STEPS.scan({tile,z:t.z,x:t.x,y:t.y}),o=WATER_STEPS.finish({tile,z:t.z,x:t.x,y:t.y,zoom:10,sea:scan.sea,parent:null,regions:[],image:null,imageZ:0});
 return {...tile,riverHeights:tile.heights,heights:o.heights||tile.heights,water:o.water};};
const tiles=new Map(real.dem.map(t=>[t.z+'/'+t.x+'/'+t.y,prepare(t)])),coarser=withCoarserTiles(tiles,real.dem[0].z),get=(s,zz,x,y)=>coarser(zz,x,y);
const N=264,M=N*N;
const q=(v,p)=>{if(!v.length)return null;const s=Float64Array.from(v).sort();return +s[Math.min(s.length-1,Math.floor(p*(s.length-1)+.5))].toFixed(4);};
const dist=v=>({n:v.length,p50:q(v,.5),p95:q(v,.95),p99:q(v,.99),max:v.length?+Math.max(...v).toFixed(4):null});
const dem13=(x,y)=>{const zz=13,n=2**zz,px=x*n*256-.5,py=y*n*256-.5,x0=Math.floor(px),y0=Math.floor(py),fx=px-x0,fy=py-y0;const g=(i,j)=>{const t=tiles.get(zz+'/'+Math.floor(i/256)+'/'+Math.floor(j/256));return t?(t.riverHeights||t.heights)[(j%256)*256+(i%256)]:NaN;};return (g(x0,y0)*(1-fx)+g(x0+1,y0)*fx)*(1-fy)+(g(x0,y0+1)*(1-fx)+g(x0+1,y0+1)*fx)*fy;};

// Raw DEM at any zoom of the fixture (coarser ones synthesized), bilinear over pixel centres.
const demAt=zz=>(x,y)=>{const n=2**zz,px=x*n*256-.5,py=y*n*256-.5,x0=Math.floor(px),y0=Math.floor(py),fx=px-x0,fy=py-y0;const g=(i,j)=>{const t=coarser(zz,Math.floor(i/256),Math.floor(j/256));return t?(t.riverHeights||t.heights)[(((j%256)+256)%256)*256+(((i%256)+256)%256)]:NaN;};return (g(x0,y0)*(1-fx)+g(x0+1,y0)*fx)*(1-fy)+(g(x0,y0+1)*(1-fx)+g(x0+1,y0+1)*fx)*fy;};
// Source water at a point (the prepared sea, --sea), nearest z13 pixel, as the page builder reads it for levels.
const waterRef=(x,y)=>{const zz=13,n=2**zz,px=Math.floor(x*n*256),py=Math.floor(y*n*256),t=tiles.get(zz+'/'+Math.floor(px/256)+'/'+Math.floor(py/256));return t?.water?t.water[(py%256)*256+(px%256)]:NO_WATER;};
// ---- Reference: brute force over the tiles a level reads. Polygons and their levels are the canonical description's
// (levels are estimates by definition); containment and the edge are computed here independently of the builder.
function reference(vec,level){
 const polys=waterBodies(vec,(x,y)=>({h:dem13(x,y),water:waterRef(x,y)}),{samplerKey:'reference'}).polys;
 const zz=vec[0].z,n=2**zz;
 // Every unmapped segment of the network (river pages only), as the definition of a centreline channel.
 // The network as the builder solves it: z14 lines on the z13 DEM, coarser lines on the DEM one zoom under them.
 const dz=vec[0].z>=14?13:coarseRiverDemZoom(vec[0].z,source),rivers=riverField(vec,dz===13?dem13:demAt(dz));const segs=rivers.segments.filter(s=>!s.mapped);
 const halfAt=(s,t)=>{const e=Math.min(1,s.ea+t*(s.eb-s.ea));return (s.wa+t*(s.wb-s.wa))*e*(2-e);};
 const inChannel=(x,y)=>{for(const s of segs){const t=Math.max(0,Math.min(1,((x-s.a[0])*s.dx+(y-s.a[1])*s.dy)/s.length2)),px=x-s.a[0]-t*s.dx,py=y-s.a[1]-t*s.dy;if(Math.sqrt(px*px+py*py)*s.metric<halfAt(s,t))return s;}return null;};
 const rank=p=>p.kind===2?3:p.kind===3?2:1;
 const inPoly=(x,y)=>{const tx=Math.floor(x*n),ty=Math.floor(y*n);let best=null;for(const p of polys){if(p.tile.x!==((tx%n)+n)%n||p.tile.y!==ty)continue;if(insideRings(p.rings,x,y)&&(!best||rank(p)>rank(best)))best=p;}return best;};
 const body=(x,y)=>inPoly(x,y)??inChannel(x,y);
 const wet=(x,y)=>body(x,y)!==null;
 return {polys,segs,halfAt,body,wet,rivers,n};
}
// The reference edge near a box: samples every `step` metres along every polygon edge (own tile proper) and channel
// outline where water changes across the sample (0.05 m either side), in a hash grid.
function referenceEdge(ref,box,stepM){
 const pts=[];const {n}=ref,inBox=(x,y)=>x>=box[0]&&x<=box[2]&&y>=box[1]&&y<=box[3];
 const test=(x,y,nx,ny,metric)=>{const d=.05/metric;return ref.wet(x+nx*d,y+ny*d)!==ref.wet(x-nx*d,y-ny*d);};
 for(const p of ref.polys){const t=p.tile,x0=t.x/n,x1=(t.x+1)/n,y0=t.y/n,y1=(t.y+1)/n;if(x1<box[0]||x0>box[2]||y1<box[1]||y0>box[3])continue;
  for(let ri=0;ri<p.rings.length;ri++){const r=p.rings[ri],m=r.length/2;for(let i=0;i<m;i++){if(p.clips[ri][i])continue;const j=(i+1)%m,ax=r[2*i],ay=r[2*i+1],bx=r[2*j],by=r[2*j+1];
   if(Math.max(ax,bx)<box[0]||Math.min(ax,bx)>box[2]||Math.max(ay,by)<box[1]||Math.min(ay,by)>box[3])continue;
   const metric=metresPerMercator((ay+by)/2),l=Math.hypot(bx-ax,by-ay),k=Math.max(1,Math.ceil(l*metric/stepM)),nx=(by-ay)/l,ny=-(bx-ax)/l;
   for(let s=0;s<=k;s++){const x=ax+(bx-ax)*s/k,y=ay+(by-ay)*s/k;if(x<x0||x>=x1||y<y0||y>=y1||!inBox(x,y))continue;if(test(x,y,nx,ny,metric))pts.push(x,y);}}}}
 for(const s of ref.segs){const L=Math.sqrt(s.length2),ux=s.dx/L,uy=s.dy/L,nx=-uy,ny=ux,pad=(s.width+2)/s.metric;if(Math.max(s.a[0],s.b[0])+pad<box[0]||Math.min(s.a[0],s.b[0])-pad>box[2]||Math.max(s.a[1],s.b[1])+pad<box[1]||Math.min(s.a[1],s.b[1])-pad>box[3])continue;
  const k=Math.max(1,Math.ceil(L*s.metric/stepM));
  for(const side of [1,-1])for(let i=0;i<=k;i++){const t=i/k,w=ref.halfAt(s,t)/s.metric,x=s.a[0]+s.dx*t+nx*w*side,y=s.a[1]+s.dy*t+ny*w*side;if(inBox(x,y)&&test(x,y,nx*side,ny*side,s.metric))pts.push(x,y);}
  for(const [e,t,dir] of [[s.a,0,-1],[s.b,1,1]]){const w=ref.halfAt(s,t);if(w<=0)continue;const m=Math.max(4,Math.ceil(Math.PI*w/stepM));for(let i=0;i<=m;i++){const a=-Math.PI/2+Math.PI*i/m,cx=Math.cos(a)*dir,cy=Math.sin(a),ox=ux*cx+nx*cy,oy=uy*cx+ny*cy,x=e[0]+ox*w/s.metric,y=e[1]+oy*w/s.metric;if(inBox(x,y)&&test(x,y,ox,oy,s.metric))pts.push(x,y);}}}
 const P=Float64Array.from(pts),cs=(box[2]-box[0])/256,grid=new Map();
 for(let i=0;i<P.length/2;i++){const k=Math.floor((P[2*i]-box[0])/cs)*65536+Math.floor((P[2*i+1]-box[1])/cs);let l=grid.get(k);if(!l)grid.set(k,l=[]);l.push(i);}
 // Distance to the nearest edge sample, Mercator units, searching rings of cells out to maxCells.
 const near=(x,y,maxCells)=>{const cx=Math.floor((x-box[0])/cs),cy=Math.floor((y-box[1])/cs);let best=Infinity;
  for(let r=0;r<=maxCells;r++){for(let a=cx-r;a<=cx+r;a++)for(let b=cy-r;b<=cy+r;b++){if(Math.max(Math.abs(a-cx),Math.abs(b-cy))!==r)continue;const l=grid.get(a*65536+b);if(!l)continue;for(const i of l){const d=Math.hypot(P[2*i]-x,P[2*i+1]-y);if(d<best)best=d;}}
   if(best<r*cs)break;}return best;};
 return {near,count:P.length/2,cs};
}
// Page geometry: the same positions the builder uses (exact here, which the builder's lattice matches to 0.02 px).
const report={fixture:arg('fixture-path'),at:[AX,AY],sea,levels:{}};
const layers=new Map();
for(const level of levels){
 const vec=real.vectors?.[level>=12?14:Math.min(14,level+1)]??real.rivers;
 const ref=reference(vec,level);
 const [lon,lat]=mercatorToLonLat(AX,AY),c=directionToChart(lonLatToDirection(lon,lat)),n=2**level;
 const px=Math.floor((c.u+1)/2*n),py=Math.floor((c.v+1)/2*n),pages=new Map();
 const R={shoreNew:[],shoreOld:[],sdf:[],classNew:0,classOld:0,classTexels:0,signNew:0,edgesNew:{sdf:0,level:0,levelMissing:0,alpha:0,kind:0,texels:0},edgesOld:{excess:0,texels:0},
  stepNew:[],stepOld:[],sdfNoRef:0,noRefAt:[],slopeOld:{n:0,over35:0,over45:0},slopeNew:{n:0,over35:0,over45:0},wetTexels:0,pokeOld:0,pokeNew:0,bankTexels:0,pitOld:0,pitNew:0,limited:0,trenchNew:0,trenchOld:0,seam:0,seamDryNew:0,seamDryOld:0,msPage:[],msWater:[],msOld:[],unresolved:0,overBudget:0,fallback:0,pieces:0,refEdge:0};
 for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
  const page={face:c.face,level,x:px+dx,y:py+dy};
  buildHeightPage(page,get,source,vec,{water:true});
  const t0=performance.now(),r=buildHeightPage(page,get,source,vec,{water:true}),ms=performance.now()-t0;
  if(r.missing)continue;
  let ro=r;if(old){old.buildHeightPage(page,get,source,vec);const t1=performance.now();ro=old.buildHeightPage(page,get,source,vec);R.msOld.push(performance.now()-t1);}
  else{buildHeightPage(page,get,source,vec);const t1=performance.now();ro=buildHeightPage(page,get,source,vec);R.msOld.push(performance.now()-t1);}
  const rt=buildHeightPage(page,get,source,vec,{water:true,terrain:true});
  R.msPage.push(ms);const w=r.waterPage;if(w){R.msWater.push(w.stats.ms+(w.stats.unionMs||0));R.unresolved+=w.stats.unresolved;R.overBudget+=w.stats.overBudget;R.fallback+=w.stats.fallbackLevel;R.pieces+=w.stats.pieces;}
  const map=exactTexelMap(page,'height'),cell=pageCellMetres(page),X=map.X,Y=map.Y;
  pages.set(dx+','+dy,{page,r,ro,rt,X,Y,cell});
  // Terrain gates (phase 2): slope of the ground within 45 m outside the water, wholly wet texels whose ground stands
  // at or over the level, wholly dry texels within 1.5 texels of the shore more than 10 cm under it (ground under the
  // water at the shore: the water would end in a face). Ground falling away behind a raised bank is not counted. Old: the old path's heights
  // against the layer's water; new: the layer's terrain.
  if(w){const ut=new Uint16Array(rt.bytes),uo=new Uint16Array(ro.bytes),ht=k=>rt.offset+rt.scale*ut[k],ho=k=>ro.offset+ro.scale*uo[k];
   for(let j=4;j<259;j++)for(let i=4;i<259;i++){const k=j*N+i;const sd=(w.bytes[k*4]-32768)/512,lv=w.bytes[k*4+1]===65535?NaN:w.levelOffset+w.levelScale*w.bytes[k*4+1],m=sd*cell;
    if(m>0&&m<=45){for(const [hf,T] of [[ho,R.slopeOld],[ht,R.slopeNew]]){const gx=(hf(k+1)-hf(k-1))/(2*cell),gy=(hf(k+N)-hf(k-N))/(2*cell),deg=Math.atan(Math.hypot(gx,gy))*180/Math.PI;T.n++;if(deg>35)T.over35++;if(deg>45)T.over45++;}}
    if(lv===lv&&sd<-.5&&(w.bytes[k*4+2]&255)===255){R.wetTexels++;if(ho(k)>=lv-.01)R.pokeOld++;if(ht(k)>=lv-.01)R.pokeNew++;}
    if(lv===lv&&sd>=.75&&sd<=1.5&&(w.bytes[k*4+2]&255)===0){R.bankTexels++;if(ho(k)<lv-.1)R.pitOld++;if(ht(k)<lv-.1)R.pitNew++;}}
   if(rt.waterPage?.stats.terrain){const st=rt.waterPage.stats.terrain;R.limited+=st.terrainLimited;R.filled=(R.filled||0)+(st.filled||0);R.lifted=(R.lifted||0)+(st.lifted||0);R.liftMax=Math.max(R.liftMax||0,st.liftMax||0);}}
  // Reference over the page and its reach.
  let bx0=Infinity,by0=Infinity,bx1=-Infinity,by1=-Infinity;for(let k=0;k<M;k++){bx0=Math.min(bx0,X[k]);bx1=Math.max(bx1,X[k]);by0=Math.min(by0,Y[k]);by1=Math.max(by1,Y[k]);}
  const cellM=cell/metresPerMercator(Y[M>>1]),pad=8*cellM,edge=referenceEdge(ref,[bx0-pad,by0-pad,bx1+pad,by1+pad],cell/16);R.refEdge+=edge.count;
  const refWet=new Uint8Array(M),refBody=new Array(M);
  for(let k=0;k<M;k++){const b=ref.body(X[k],Y[k]);refBody[k]=b;refWet[k]=b?1:0;}
  const refD=k=>edge.near(X[k],Y[k],8)*metresPerMercator(Y[k])/cell; // texels, capped near 8 texels
  // Only texels the fixture's vector tiles cover, 8 texels in from their border: beyond it a fixture has no map.
  const vz=vec[0].z,vn=2**vz,have=new Set(vec.map(t=>t.x+'/'+t.y)),marg=8*cellM;
  const covered=k=>{const x=X[k],y=Y[k];for(const [ox,oy] of [[-marg,-marg],[marg,-marg],[-marg,marg],[marg,marg]])if(!have.has(Math.floor((x+ox)*vn)+'/'+Math.floor((y+oy)*vn)))return false;return true;};
  const COV=new Uint8Array(M);for(let k=0;k<M;k++)COV[k]=covered(k)?1:0;pages.get(dx+','+dy).cov=COV;
  const u=new Uint16Array(ro.bytes),hq=k=>ro.offset+ro.scale*u[k],oldWet=k=>ro.texels?waterExcessValue(u[M+k])>0:false,oldE=k=>ro.texels?waterExcessValue(u[M+k]):-1;
  const b=w?.bytes,newSd=k=>b?(b[k*4]-32768)/512:32,newLv=k=>b&&b[k*4+1]!==65535?w.levelOffset+w.levelScale*b[k*4+1]:NaN;
  const refLevel=k=>{const o=refBody[k];if(!o)return NaN;if(o.rings&&o.kind!==3)return o.level;const r2=ref.rivers.levelAt(X[k],Y[k]);return r2?r2.level:NaN;};
  // Shore crossings along rows and columns of the interior (texels 3..259).
  for(let j=3;j<=259;j++)for(let i=3;i<=259;i++){const k=j*N+i;if(!COV[k])continue;
   for(const k2 of [i<259?k+1:-1,j<259?k+N:-1]){if(k2<0||!COV[k2])continue;
    const a=newSd(k),c2=newSd(k2);if(b&&(a<0)!==(c2<0)){const t=a/(a-c2),x=X[k]+(X[k2]-X[k])*t,y=Y[k]+(Y[k2]-Y[k])*t;R.shoreNew.push(edge.near(x,y,8)*metresPerMercator(y)/cell);}
    const e1=oldE(k),e2=oldE(k2);if(ro.texels&&(e1>0)!==(e2>0)){const t=e1/(e1-e2),x=X[k]+(X[k2]-X[k])*t,y=Y[k]+(Y[k2]-Y[k])*t;R.shoreOld.push(edge.near(x,y,8)*metresPerMercator(y)/cell);}}
   // Classes beyond half a texel of the reference edge.
   const pw=b?newSd(k)<0:false,ow=oldWet(k);
   if(pw!==!!refWet[k]||ow!==!!refWet[k]){const d=refD(k);if(d>.5){if(pw!==!!refWet[k])R.classNew++;if(ow!==!!refWet[k])R.classOld++;}}
   if(refWet[k]||pw||ow)R.classTexels++;
   // Distance accuracy near the edge.
   if(b&&Math.abs(newSd(k))<4){const rd=refD(k),d=rd*(refWet[k]?-1:1);if(Number.isFinite(rd))R.sdf.push(Math.abs(d-newSd(k)));else{R.sdfNoRef++;if(R.noRefAt.length<5)R.noRefAt.push([page.x,page.y,i,j,+newSd(k).toFixed(3),refWet[k]]);}}
   // Levels: steps between wet neighbours beyond the reference's own step, trenches, seams.
   for(const k2 of [i<259?k+1:-1,j<259?k+N:-1]){if(k2<0||!COV[k2])continue;const rl1=refLevel(k),rl2=refLevel(k2),refStep=Math.abs(rl1-rl2);
    if(b&&newSd(k)<0&&newSd(k2)<0){const s=Math.abs(newLv(k)-newLv(k2))-(refStep===refStep?refStep:0);if(s>.05)R.stepNew.push(s);}
    if(ow&&oldWet(k2)){const s=Math.abs((hq(k)+oldE(k))-(hq(k2)+oldE(k2)))-(refStep===refStep?refStep:0);if(s>.05)R.stepOld.push(s);}
    if(refWet[k]&&refWet[k2]&&refBody[k]!==refBody[k2]){R.seam++;if(b&&!(newSd(k)<0&&newSd(k2)<0))R.seamDryNew++;if(!(ow&&oldWet(k2)))R.seamDryOld++;}}
   const rl=refLevel(k);if(rl===rl){if(b&&newSd(k)<0&&newLv(k)<rl-.1)R.trenchNew++;if(ow&&hq(k)+oldE(k)<rl-.1)R.trenchOld++;}
  }
 }
 // Shared edges between neighbours (same level): page A texels 256..262 and page B texels 0..6, same row (or column).
 for(const [key,A] of pages){const [dx,dy]=key.split(',').map(Number);
  for(const [ex,ey] of [[1,0],[0,1]]){const B=pages.get((dx+ex)+','+(dy+ey));if(!B)continue;
   for(let t=2;t<=261;t++)for(let o=0;o<=6;o++){const ka=ex?t*N+256+o:(256+o)*N+t,kb=ex?t*N+o:o*N+t;if(!A.cov[ka]||!B.cov[kb])continue;
    const wa=A.r.waterPage,wb=B.r.waterPage;
    if(wa&&wb){const a=wa.bytes,c=wb.bytes;R.edgesNew.texels++;R.edgesNew.sdf=Math.max(R.edgesNew.sdf,Math.abs(a[ka*4]-c[kb*4])/512);
     // Levels count where the surface reads them: wet, or within two texels of a shore, on both pages.
     const used=(a[ka*4]-32768)/512<2&&(c[kb*4]-32768)/512<2;
     const la=a[ka*4+1]===65535?NaN:wa.levelOffset+wa.levelScale*a[ka*4+1],lb=c[kb*4+1]===65535?NaN:wb.levelOffset+wb.levelScale*c[kb*4+1];if(used){if((la===la)!==(lb===lb))R.edgesNew.levelMissing++;else if(la===la)R.edgesNew.level=Math.max(R.edgesNew.level,Math.abs(la-lb));}
     R.edgesNew.alpha=Math.max(R.edgesNew.alpha,Math.abs((a[ka*4+2]&255)-(c[kb*4+2]&255))/255);if(((a[ka*4+2]>>8)&3)!==((c[kb*4+2]>>8)&3))R.edgesNew.kind++;}
    else if(wa||wb){const w=wa||wb,kk=wa?ka:kb;if(Math.abs(w.bytes[kk*4]-32768)/512<32)R.edgesNew.sdf=Infinity;}
    if(A.ro.texels&&B.ro.texels){const ua=new Uint16Array(A.ro.bytes),ub=new Uint16Array(B.ro.bytes);R.edgesOld.texels++;const ha=A.ro.offset+A.ro.scale*ua[ka]+waterExcessValue(ua[M+ka]),hb=B.ro.offset+B.ro.scale*ub[kb]+waterExcessValue(ub[M+kb]);if(waterExcessValue(ua[M+ka])>0||waterExcessValue(ub[M+kb])>0)R.edgesOld.excess=Math.max(R.edgesOld.excess,Math.abs(ha-hb));}}}}
 layers.set(level,pages);
 const L={pages:pages.size,shore_new:{...dist(R.shoreNew),over_half:R.shoreNew.filter(v=>v>.5).length},shore_old:{...dist(R.shoreOld),over_half:R.shoreOld.filter(v=>v>.5).length},
  sdf_error:{...dist(R.sdf),no_reference:R.sdfNoRef,first:R.noRefAt},classes:{new:R.classNew,old:R.classOld,near_water_texels:R.classTexels},edges:{new:R.edgesNew,old:R.edgesOld},
  level_steps:{new:{...dist(R.stepNew)},old:{...dist(R.stepOld)}},trench:{new:R.trenchNew,old:R.trenchOld},seams:{texel_pairs:R.seam,dry_new:R.seamDryNew,dry_old:R.seamDryOld},
  ms:{page_with_layer:{p50:q(R.msPage,.5),p95:q(R.msPage,.95)},layer:{p50:q(R.msWater,.5),p95:q(R.msWater,.95)},page_old:{p50:q(R.msOld,.5),p95:q(R.msOld,.95)}},
  terrain:{steep_within_45m:{old:{over35:+(R.slopeOld.over35/Math.max(1,R.slopeOld.n)).toFixed(4),over45:+(R.slopeOld.over45/Math.max(1,R.slopeOld.n)).toFixed(4)},new:{over35:+(R.slopeNew.over35/Math.max(1,R.slopeNew.n)).toFixed(4),over45:+(R.slopeNew.over45/Math.max(1,R.slopeNew.n)).toFixed(4)},texels:R.slopeNew.n},
   ground_at_or_over_water:{old:R.pokeOld,new:R.pokeNew,of:R.wetTexels},pits_beside_water:{old:R.pitOld,new:R.pitNew,of:R.bankTexels},terrainLimited:R.limited,filled:{texels:R.filled||0,metres:+(R.lifted||0).toFixed(1),max:+(R.liftMax||0).toFixed(2)}},
  counters:{unresolved:R.unresolved,overBudget:R.overBudget,fallbackLevel:R.fallback,pieces:R.pieces,referenceEdgeSamples:R.refEdge}};
 report.levels[level]=L;console.log(JSON.stringify({level,...L}));
}
// Coarse against fine: level L page texel at grid point g against the L+1 child at 2g.
report.coarse={};
for(const level of levels){const fine=layers.get(level+1),coarse=layers.get(level);if(!fine||!coarse)continue;const S={sdf:[],level:[],alpha:[],texels:0};
 for(const [,C] of coarse){const wc=C.r.waterPage;if(!wc)continue;
  for(const [,F] of fine){const wf=F.r.waterPage;if(!wf)continue;const ox=F.page.x-2*C.page.x,oy=F.page.y-2*C.page.y;if(ox<0||ox>1||oy<0||oy>1)continue;
   for(let gj=0;gj<=128;gj++)for(let gi=0;gi<=128;gi++){const ci=3+gi+128*ox,cj=3+gj+128*oy,fi=3+2*gi,fj=3+2*gj;if(fi<4||fj<4||fi>258||fj>258||!C.cov[cj*N+ci]||!F.cov[fj*N+fi])continue;
    const kc=cj*N+ci,kf=fj*N+fi,a=wc.bytes,b=wf.bytes,sc=(a[kc*4]-32768)/512*C.cell,sf=(b[kf*4]-32768)/512*F.cell;
    if(Math.abs(sc)>=8*C.cell&&Math.abs(sf)>=8*F.cell)continue;S.texels++;
    if(Math.abs(sf)<16*F.cell)S.sdf.push(Math.abs(sc-sf)/C.cell);
    const lc=a[kc*4+1]===65535?NaN:wc.levelOffset+wc.levelScale*a[kc*4+1],lf=b[kf*4+1]===65535?NaN:wf.levelOffset+wf.levelScale*b[kf*4+1];if(lc===lc&&lf===lf&&sc<0&&sf<0)S.level.push(Math.abs(lc-lf));
    let tent=0;for(let v=-1;v<=1;v++)for(let h=-1;h<=1;h++)tent+=(b[(kf+v*N+h)*4+2]&255)/255*(2-Math.abs(h))*(2-Math.abs(v))/16;S.alpha.push(Math.abs((a[kc*4+2]&255)/255-tent));}}}
 report.coarse[level]={texels:S.texels,sdf_texels:dist(S.sdf),level_m:dist(S.level),alpha:dist(S.alpha)};console.log(JSON.stringify({coarse:level,...report.coarse[level]}));}
await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,1));
