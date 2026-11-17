// Page building: Web Mercator tiles -> 264x264 chart pages. Pure and synchronous given decoded tiles;
// this module knows nothing about networks. getTile(source,z,x,y) returns a decoded tile or null/undefined:
//   height tile {heights:Float32Array,width,height}; albedo tile {rgba:Uint8Array,width,height}.
import {R,PAGE_TEXELS as N,chartToDirection,directionToLonLat,pageLonLatBounds} from './chart.js';
import {terrariumHeights} from './png.js';
import {NO_WATER,WATER_GRID} from './water.js';
import {riverField,riverBedDetail,RIVER_MIN_LEVEL,RIVER_ZOOM,VALLEY_MAX} from './rivers.js';
import {mapWater,MAP_WATER_MIN_LEVEL,metresPerMercator} from './map-water.js';
import {waterBodies,waterUnion,buildWaterPage,shapeTerrain,sourceSea,WATER_BAND,WATER_REFERENCE_LEVEL,WATER_FAR_REACH} from './water-layer.js';
export const MAP_TOLERANCE=0.02;     // source pixels: bound on interpolated-vs-exact position error
const PROBE_TOLERANCE=0.015;         // probes sample a few cells, so they are held tighter than the bound
const TAU=2*Math.PI;
const mercY=lat=>0.5-Math.atanh(Math.sin(lat*Math.PI/180))/TAU;

// Level choice follows CesiumJS's getLevelWithMaximumTexelSpacing: the coarsest level whose texel is no coarser than the target.
// source.zoomBias (default 0) is added to that zoom before clamping: a negative bias reads coarser tiles (fewer, smaller fetches).
// Cell width is R/128/2^D at the face centre, scaled by the isotropic chart metric r^-1.5, r=sqrt(1+u^2+v^2).
export function chooseZoom(page,source){
 const s=2/2**page.level,u=-1+s*(page.x+0.5),v=-1+s*(page.y+0.5),r=Math.sqrt(1+u*u+v*v);
 const cell=R/128/2**page.level/Math.pow(r,1.5);
 const lat=directionToLonLat(chartToDirection(page.face,u,v))[1];
 const pixelAtZ0=156543.034*Math.max(Math.cos(lat),1e-6)*256/source.tileSize;
 const z=Math.ceil(Math.log2(pixelAtZ0/cell))+(source.zoomBias||0);
 return Math.max(source.minZoom,Math.min(source.maxZoom,z));
}

// Mapping from texel to normalised Mercator (X unwrapped around the first node, Y in [0,1] inside coverage).
// The expensive direction->Mercator evaluation runs on a coarse node lattice and is interpolated bilinearly.
// Probes compare interpolation with exact positions at cell midpoints and halve the step until the error is
// under the bound, so a strongly curved page (coarse level, high latitude) pays for exact positions.
// texelMercator is allocation free: same arithmetic as texelToChart -> chartToDirection -> directionToMercator, in the same order.
const TWO_PI=2*Math.PI;
function makeMapper(channel,page){return {face:page.face,s:2/2**page.level,px:page.x,py:page.y,off:channel==='height'?HEIGHT_OFFSET:ALBEDO_OFFSET,out:new Float64Array(2)};}
const HEIGHT_OFFSET=3,ALBEDO_OFFSET=3.5; // gutter 3 (vertex aligned) and gutter 4 minus the half cell
function texelMercator(m,i,j){
 const u=-1+m.s*(m.px+(i-m.off)/256),v=-1+m.s*(m.py+(j-m.off)/256);
 let a0,a1,a2;
 switch(m.face){
  case 0:a0=1;a1=v;a2=-u;break;case 1:a0=-1;a1=v;a2=u;break;case 2:a0=u;a1=1;a2=-v;break;
  case 3:a0=u;a1=-1;a2=v;break;case 4:a0=u;a1=v;a2=1;break;default:a0=-u;a1=v;a2=-1;
 }
 const n=Math.sqrt(a0*a0+a1*a1+a2*a2),d1=a1/n;
 m.out[0]=0.5+Math.atan2(a0/n,a2/n)/TWO_PI;m.out[1]=0.5-Math.atanh(d1>1?1:d1<-1?-1:d1)/TWO_PI;
}
function nodeLattice(channel,page,step){
 const M=N/step+1,X=new Float64Array(M*M),Y=new Float64Array(M*M),m=makeMapper(channel,page),o=m.out;let ref=0;
 for(let b=0;b<M;b++)for(let a=0;a<M;a++){
  texelMercator(m,a*step,b*step);
  if(a===0&&b===0)ref=o[0];
  X[b*M+a]=o[0]+Math.round(ref-o[0]);Y[b*M+a]=o[1];
 }
 return {M,X,Y,step};
}
function probeError(channel,page,L,pixelsPerUnit){
 const {M,X,Y,step}=L,cells=M-1,m=makeMapper(channel,page),o=m.out;let worst=0;
 // Every cell midpoint and every cell-edge midpoint (bilinear error peaks at either, depending on curvature signs).
 // Cost is about 3 exact evaluations per coarse cell, a few percent of exact mapping at step 8.
 for(let ib=0;ib<=2*cells;ib++)for(let ia=0;ia<=2*cells;ia++){
  if(!(ia&1)&&!(ib&1))continue;
  const a0=ia>>1,b0=ib>>1,a1=Math.min(a0+(ia&1),M-1),b1=Math.min(b0+(ib&1),M-1),k00=b0*M+a0,k10=b0*M+a1,k01=b1*M+a0,k11=b1*M+a1;
  texelMercator(m,ia*step/2,ib*step/2);
  const ix=(X[k00]+X[k10]+X[k01]+X[k11])/4,iy=(Y[k00]+Y[k10]+Y[k01]+Y[k11])/4; // duplicated corners make the edge case a mean of two
  const dX=o[0]+Math.round(ix-o[0])-ix,dY=o[1]-iy;
  if(!(Math.abs(dX)<1&&Math.abs(dY)<1))return Infinity; // NaN or pole: let the exact path and the coverage test decide
  worst=Math.max(worst,Math.abs(dX),Math.abs(dY));
 }
 return worst*pixelsPerUnit;
}
export function nodesForPage(page,channel,zoom,tileSize,forceStep=0){
 const ppu=tileSize*2**zoom;
 let step=forceStep||8,L=nodeLattice(channel,page,step);
 while(!forceStep&&step>1&&probeError(channel,page,L,ppu)>PROBE_TOLERANCE){step>>=1;L=nodeLattice(channel,page,step);}
 return L;
}
// Bilinear expansion of nodes to every texel: Float64Array X and Y of N*N, row-major j*N+i.
// expandInto writes into caller storage. It interpolates along v once per lattice column and row, then along u,
// which equals the 2x2 bilinear form up to rounding.
const COL_X=new Float64Array(N+1),COL_Y=new Float64Array(N+1);
function expandInto(L,TX,TY){
 const {M,X,Y,step}=L,inv=1/step;
 for(let j=0;j<N;j++){
  const cb=Math.min(Math.floor(j*inv),M-2),fy=j*inv-cb,gy=1-fy,r0=cb*M,r1=r0+M;
  for(let a=0;a<M;a++){COL_X[a]=X[r0+a]*gy+X[r1+a]*fy;COL_Y[a]=Y[r0+a]*gy+Y[r1+a]*fy;}
  const row=j*N;
  for(let ca=0;ca<M-1;ca++){
   const i0=ca*step,i1=ca===M-2?N:i0+step,x0=COL_X[ca],x1=COL_X[ca+1],y0=COL_Y[ca],y1=COL_Y[ca+1];
   for(let i=i0;i<i1;i++){const fx=i*inv-ca;TX[row+i]=x0*(1-fx)+x1*fx;TY[row+i]=y0*(1-fx)+y1*fx;}
  }
 }
}
// Positions of an extended grid: texels -pad .. N+pad-1 on both axes (row-major, side N+2*pad), from an exact node
// lattice of the given step, bilinear between nodes. X is unwrapped to agree with ref (a page's X[0]) to the nearest
// integer. The water layer propagates distances over it (water-layer.js), so a shore just beyond a page is found by
// every page that shares texels with it.
export function extendedTexelMap(page,pad,step,ref){
 const side=N+2*pad,m=makeMapper('height',page),o=m.out,A=Math.ceil((side-1)/step)+1,NX=new Float64Array(A*A),NY=new Float64Array(A*A);let r0=null;
 for(let b=0;b<A;b++)for(let a=0;a<A;a++){texelMercator(m,-pad+a*step,-pad+b*step);if(r0===null)r0=ref??o[0];NX[b*A+a]=o[0]+Math.round(r0-o[0]);NY[b*A+a]=o[1];}
 const X=new Float64Array(side*side),Y=new Float64Array(side*side),inv=1/step;
 for(let j=0;j<side;j++){const fb=j*inv,b=Math.min(Math.floor(fb),A-2),fy=fb-b;for(let i=0;i<side;i++){const fa=i*inv,a=Math.min(Math.floor(fa),A-2),fx=fa-a,k=b*A+a;
  X[j*side+i]=(NX[k]*(1-fx)+NX[k+1]*fx)*(1-fy)+(NX[k+A]*(1-fx)+NX[k+A+1]*fx)*fy;Y[j*side+i]=(NY[k]*(1-fx)+NY[k+1]*fx)*(1-fy)+(NY[k+A]*(1-fx)+NY[k+A+1]*fx)*fy;}}
 return {X,Y,side,pad};
}
export function expandNodes(L){const TX=new Float64Array(N*N),TY=new Float64Array(N*N);expandInto(L,TX,TY);return {X:TX,Y:TY};}
const SCR_X=new Float64Array(N*N),SCR_Y=new Float64Array(N*N); // page builds are synchronous and never nest
// Height grid lines 0 and 256 are shared with the neighbouring pages. Evaluate them exactly so that two pages
// sample the same source position at a shared grid point whatever lattice step each chose; they then differ
// only by quantisation, not by interpolation error times terrain slope.
export function snapSharedEdges(page,L,m){
 const ref=L.X[0],mp=makeMapper('height',page),o=mp.out;
 for(let t=0;t<N;t++)for(const e of [3,259]){
  for(let k=0;k<2;k++){
   const i=k?t:e,j=k?e:t,q=j*N+i;texelMercator(mp,i,j);m.X[q]=o[0]+Math.round(ref-o[0]);m.Y[q]=o[1];
  }
 }
}
// Texel positions evaluated exactly (reference for tests and for the error bound).
export function exactTexelMap(page,channel){
 const X=new Float64Array(N*N),Y=new Float64Array(N*N),mp=makeMapper(channel,page),o=mp.out;let ref=0;
 for(let j=0;j<N;j++)for(let i=0;i<N;i++){texelMercator(mp,i,j);if(i===0&&j===0)ref=o[0];X[j*N+i]=o[0]+Math.round(ref-o[0]);Y[j*N+i]=o[1];}
 return {X,Y};
}

// Coverage in Mercator space: latitude limit and optional lon/lat bbox (both reduce to X,Y ranges).
function coverageBox(source){
 const c=source.coverage||{},ymax=c.latLimit==null?1:Math.min(1,mercY(-c.latLimit)),ymin=c.latLimit==null?0:Math.max(0,mercY(c.latLimit));
 const b=c.bbox;
 return b?{ymin:Math.max(ymin,mercY(b.latMax)),ymax:Math.min(ymax,mercY(b.latMin)),xmin:0.5+b.lonMin/360,xmax:0.5+b.lonMax/360,bbox:true}:{ymin,ymax,xmin:0,xmax:1,bbox:false};
}
const inBox=(box,X,Y)=>{if(!(Y>=box.ymin&&Y<=box.ymax))return false;if(!box.bbox)return true;const x=X-Math.floor(X);return x>=box.xmin&&x<=box.xmax;};
const allCovered=(box,TX,TY)=>{for(let o=0;o<TX.length;o++)if(!inBox(box,TX[o],TY[o]))return false;return true;};
const nodesCovered=(box,L)=>{for(let o=0;o<L.X.length;o++)if(!inBox(box,L.X[o],L.Y[o]))return false;return true;};

// Tiles that the page's texels touch: the footprint of each coarse lattice cell, widened by the
// 1-pixel bilinear stencil and a rounding margin (the interpolation error is bounded by PROBE_TOLERANCE <<0.1).
function tilesOf(L,source,z,box,pad=0){
 const {M,X,Y}=L,n=2**z,ts=source.tileSize,size=ts*n,out=new Map(),margin=0.1+pad;
 for(let b=0;b<M-1;b++)for(let a=0;a<M-1;a++){
  const k=b*M+a,k1=k+1,k2=k+M,k3=k+M+1;
  if(box&&!(inBox(box,X[k],Y[k])||inBox(box,X[k1],Y[k1])||inBox(box,X[k2],Y[k2])||inBox(box,X[k3],Y[k3])))continue;
  const xlo=Math.min(X[k],X[k1],X[k2],X[k3]),xhi=Math.max(X[k],X[k1],X[k2],X[k3]),ylo=Math.min(Y[k],Y[k1],Y[k2],Y[k3]),yhi=Math.max(Y[k],Y[k1],Y[k2],Y[k3]);
  const x0=Math.floor(xlo*size-0.5-margin),x1=Math.floor(xhi*size-0.5+margin)+1;
  const y0=Math.floor(ylo*size-0.5-margin),y1=Math.floor(yhi*size-0.5+margin)+1;
  const ty0=Math.max(0,Math.floor(y0/ts)),ty1=Math.min(n-1,Math.floor(y1/ts)),tx1=Math.floor(x1/ts);
  for(let tx=Math.floor(x0/ts);tx<=tx1;tx++)for(let ty=ty0;ty<=ty1;ty++){
   const wx=((tx%n)+n)%n,key=ty*n+wx;
   if(!out.has(key))out.set(key,{z,x:wx,y:ty});
  }
 }
 return [...out.values()];
}
// requiredTiles(page,source,{zoom}) -> [{z,x,y}] . Empty when the page lies outside the source's coverage.
// A height page from RIVER_MIN_LEVEL may read its DEM up to VALLEY_MAX metres off its texels (valley conflation,
// rivers.js), so it asks for the tiles that far around too.
export function requiredTiles(page,source,opts={}){
 const z=opts.zoom??chooseZoom(page,source),L=nodesForPage(page,source.channel,z,source.tileSize),box=coverageBox(source);
 if(opts.partial)return tilesOf(L,source,z,box); // overlays: only cells touching the source's coverage
 let pad=0;if(source.channel==='height'&&page.level>=RIVER_MIN_LEVEL){const y=L.Y[L.Y.length>>1];pad=(VALLEY_MAX+2)/(metresPerMercator(y)/(source.tileSize*2**z));}
 return nodesCovered(box,L)?tilesOf(L,source,z,null,pad):[];
}

// Tile sampler: bilinear over pixel centres, reads across adjacent tiles, wraps in x, clamps in y.
// State is a plain object (stable shape, no closures). The tile that served the last lookup is remembered, so a run of texels
// inside one tile does no map lookup at all; reads whose 2x2 stencil crosses a tile edge take the slow path.
function makeSampler(getTile,source,z,kind){
 const ts=source.tileSize,n=2**z;
 return {getTile,source,z,kind,ts,n,size:ts*n,cache:new Map(),ltx:-1,lty:-1,lt:null,lh:null,lw:0};
}
function tileOf(S,tx,ty){
 const k=ty*S.n+tx;let t=S.cache.get(k);
 if(t===undefined){
  t=S.getTile(S.source,S.z,tx,ty)||null;
  if(t&&S.raw)t={...t,heights:t.riverHeights||t.heights};
  if(t&&S.kind==='height'&&!t.heights)t.heights=terrariumHeights(t.rgba,t.width,t.height);
  S.cache.set(k,t);
 }
 return t;
}
// Slow path: wrap x, clamp y.
function tileAtTexel(S,gx,gy){
 const size=S.size;gx=((gx%size)+size)%size;gy=gy<0?0:gy>=size?size-1:gy;
 return tileOf(S,Math.floor(gx/S.ts),Math.floor(gy/S.ts));
}
// True when the whole 2x2 stencil at (x0,y0) lies inside one tile that exists; that tile is then S.lt.
function selectTile(S,x0,y0){
 if(x0<0||y0<0||x0>=S.size||y0>=S.size)return false;
 const ts=S.ts,tx=(x0/ts)|0,ty=(y0/ts)|0;
 if(x0-tx*ts>=ts-1||y0-ty*ts>=ts-1)return false;
 if(tx!==S.ltx||ty!==S.lty){
  S.ltx=tx;S.lty=ty;const t=tileOf(S,tx,ty);S.lt=t;S.lh=t?t.heights||null:null;S.lw=t?t.width:0;
 }
 return S.lt!==null;
}
// NaN when a needed tile is missing.
function heightAt(S,Xv,Yv){
 const size=S.size,px=Xv*size-0.5,py=Yv*size-0.5,x0=Math.floor(px),y0=Math.floor(py),fx=px-x0,fy=py-y0;
 if(selectTile(S,x0,y0)&&S.lh!==null){
  const w=S.lw,h=S.lh,o=(y0-S.lty*S.ts)*w+(x0-S.ltx*S.ts);
  return (h[o]*(1-fx)+h[o+1]*fx)*(1-fy)+(h[o+w]*(1-fx)+h[o+w+1]*fx)*fy;
 }
 const h00=hp(S,x0,y0),h10=hp(S,x0+1,y0),h01=hp(S,x0,y0+1),h11=hp(S,x0+1,y0+1);
 return (h00*(1-fx)+h10*fx)*(1-fy)+(h01*(1-fx)+h11*fx)*fy;
}
function hp(S,a,b){const t=tileAtTexel(S,a,b);if(!t)return NaN;const size=S.size,gx=((a%size)+size)%size,gy=b<0?0:b>=size?size-1:b;return t.heights[(gy%S.ts)*t.width+(gx%S.ts)];}
// Writes linear-light rgb into out[0..2]; returns 0 when a tile is missing, 1 when fine, 2 when a stencil pixel is no-data (white or alpha 0).
function rgbAt(S,Xv,Yv,out){
 const size=S.size,px=Xv*size-0.5,py=Yv*size-0.5,x0=Math.floor(px),y0=Math.floor(py),fx=px-x0,fy=py-y0;
 let r=0,g=0,b=0,nodata=false;
 const w00=(1-fx)*(1-fy),w10=fx*(1-fy),w01=(1-fx)*fy,w11=fx*fy;
 if(selectTile(S,x0,y0)){
  const d=S.lt.rgba,rowBytes=S.lw*4,o0=((y0-S.lty*S.ts)*S.lw+(x0-S.ltx*S.ts))*4,o1=o0+4,o2=o0+rowBytes,o3=o2+4;
  if(d[o0+3]===0||d[o1+3]===0||d[o2+3]===0||d[o3+3]===0||(d[o0]&d[o0+1]&d[o0+2])===255||(d[o1]&d[o1+1]&d[o1+2])===255||(d[o2]&d[o2+1]&d[o2+2])===255||(d[o3]&d[o3+1]&d[o3+2])===255)nodata=true;
  r=SRGB_TO_LINEAR[d[o0]]*w00+SRGB_TO_LINEAR[d[o1]]*w10+SRGB_TO_LINEAR[d[o2]]*w01+SRGB_TO_LINEAR[d[o3]]*w11;
  g=SRGB_TO_LINEAR[d[o0+1]]*w00+SRGB_TO_LINEAR[d[o1+1]]*w10+SRGB_TO_LINEAR[d[o2+1]]*w01+SRGB_TO_LINEAR[d[o3+1]]*w11;
  b=SRGB_TO_LINEAR[d[o0+2]]*w00+SRGB_TO_LINEAR[d[o1+2]]*w10+SRGB_TO_LINEAR[d[o2+2]]*w01+SRGB_TO_LINEAR[d[o3+2]]*w11;
 }else{
  for(let k=0;k<4;k++){
   const dx=k&1,dy=k>>1,gx=((x0+dx)%size+size)%size,gy=Math.min(Math.max(y0+dy,0),size-1),t=tileAtTexel(S,gx,gy);
   if(!t){out[0]=out[1]=out[2]=0;return 0;}
   const o=((gy%S.ts)*t.width+(gx%S.ts))*4,d=t.rgba,w=(dx?fx:1-fx)*(dy?fy:1-fy);
   if(d[o+3]===0||(d[o]===255&&d[o+1]===255&&d[o+2]===255))nodata=true;
   r+=SRGB_TO_LINEAR[d[o]]*w;g+=SRGB_TO_LINEAR[d[o+1]]*w;b+=SRGB_TO_LINEAR[d[o+2]]*w;
  }
 }
 out[0]=r;out[1]=g;out[2]=b;
 return nodata?2:1;
}

// sRGB <-> linear. Encoding is exact: the byte is the number of decode thresholds not above the value,
// where threshold k is the linear value halfway (in gamma space) between byte k and k+1; so
// encode(decode(b)) === b for every byte, and values round as round(255*encodeFormula(l)).
// Table driven: LUT[floor(l*ENC_N)] is the count of thresholds at or below the bucket start, which never exceeds the answer;
// a short upward walk finishes it, so the result equals the binary search exactly.
const decodeFormula=c=>c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);
export const SRGB_TO_LINEAR=Float32Array.from({length:256},(_,i)=>decodeFormula(i/255));
const THRESHOLDS=Float64Array.from({length:255},(_,k)=>decodeFormula((k+0.5)/255));
const ENC_N=8192,ENC_LUT=(()=>{
 const t=new Uint8Array(ENC_N+1);
 for(let i=0;i<=ENC_N;i++){const l=i/ENC_N;let lo=0,hi=255;while(lo<hi){const mid=(lo+hi)>>1;if(THRESHOLDS[mid]<=l)lo=mid+1;else hi=mid;}t[i]=lo;}
 return t;
})();
export function linearToSrgbByte(l){
 if(!(l>0))return 0;
 if(l>=1)return 255;
 let r=ENC_LUT[(l*ENC_N)|0];
 while(r<255&&THRESHOLDS[r]<=l)r++;
 return r;
}

function missing(reason){return {missing:true,reason};}
const SCR_H=new Float32Array(N*N);
// Level of the water at a Mercator position: the nearest pixel, since levels do not interpolate.
function waterAt(S,Xv,Yv){
 const size=S.size,px=Math.floor(Xv*size),py=Math.floor(Yv*size),t=tileAtTexel(S,px,py);if(!t||!t.water)return NO_WATER;
 const gx=((px%size)+size)%size,gy=py<0?0:py>=size?size-1:py;
 return t.water[(gy%S.ts)*t.width+(gx%S.ts)];
}
// Extend geometry only underneath an already dry bank, by at most one cell.
// A lower neighbour is NOT evidence of water: it may be another valley, a
// polder or ground below a sloping river. Recursive propagation flooded whole
// coarse pages and made those false lakes disappear as finer pages arrived.
// Read candidates from the original source grid, never from the output. Work
// is bounded by 1024 cells, four neighbours and 81 height samples per cell.
export function extendWaterSupport(water,h){
 if(!water||water.length===1)return water;
 const planar=water.length>=4096,stride=planar?4:1,at=c=>c*stride,out=water.slice();
 for(let y=0;y<32;y++)for(let x=0;x<32;x++){
  const c=y*32+x,k=at(c);if(water[k]>NO_WATER)continue;
  let low=Infinity;for(let j=0;j<=8;j++)for(let i=0;i<=8;i++)low=Math.min(low,h[(3+y*8+j)*N+3+x*8+i]);
  let best=-1,bestLevel=-Infinity;
  for(const n of [x>0?c-1:-1,x<31?c+1:-1,y>0?c-32:-1,y<31?c+32:-1]){
   if(n<0)continue;const o=at(n);if(water[o]<=NO_WATER)continue;
   const dx=(x-n%32)*8,dy=(y-(n>>5))*8,gx=planar?water[o+1]:0,gy=planar?water[o+2]:0;
   const level=water[o]+gx*dx+gy*dy,highest=level+4*(Math.abs(gx)+Math.abs(gy));
   // Only hidden overlap is allowed outside the mapped support. The maximum
   // affine level over the cell must be below every sampled terrain vertex.
   if(Number.isFinite(highest)&&low>=highest&&level>bestLevel){best=n;bestLevel=level;}
  }
  if(best<0)continue;out[k]=bestLevel;
  if(planar){const o=at(best);out[k+1]=water[o+1];out[k+2]=water[o+2];out[k+3]=water[o+3];}
 }
 return out;
}

// Water per texel, beside the heights. A page with any water carries a second u16 plane after its heights: the
// water's excess over the ground at each texel, e = level - height, in WATER_EXCESS_UNIT steps around
// WATER_EXCESS_ZERO. Positive is under water, negative dry. The GPU reads e through the same spline as the heights,
// so the water surface is height + e and the shore is where e crosses zero, at texel resolution with no cells.
// e is taken against the quantized heights the GPU reads, so height + e is the level to a code.
// Deep water saturates: a code of 65535 (e of DEEP_EXCESS or more) says only "deep", and the GPU reads the level of
// the texel's cell in the page's water grid instead. Only still water is that deep.
//
// Three kinds of water write e, and the highest answer at a texel stands:
//  - the map's still water (lakes, ponds, docks: map-water.js) at its polygon's level, with a bed falling from
//    the polygon's shore;
//  - rivers (rivers.js): the union of the centreline's channel and the river polygon, at the network's level;
//  - the source's own water (water.js: the sea, and flat lakes the imagery confirms), where the map does not
//    claim the texel. The source says wet or dry per pixel, so a shore drawn where its heights cross the level
//    is a staircase of pixel squares. The shore is instead where a Gaussian blur of the wet mask (SHORE_SIGMA
//    pixels) crosses zero: a function of position alone, so pages and levels agree on it. Within SHORE_BAND of
//    it the ground is drawn to a beach through the level, and the water stays flat.
// Outside each kind's shore e is held below zero and sinks away from it, so no water stands on ground the map or
// the source does not put it on, however low that ground lies.
export const WATER_EXCESS_UNIT=1/1024,WATER_EXCESS_ZERO=32768;
// Far from any water: deep enough under the ground that no filter brings it back to the surface.
export const WATER_EXCESS_FAR=-32;
// Saturated: this deep or more is coded 65535, and the GPU reads the cell's level (surface_field.wgsl).
export const DEEP_EXCESS=31.98;
// Just outside a shore, the water stays at least this far under the ground, and sinks this much per metre.
const WATER_OUTSIDE=-0.03,WATER_SINK=0.5;
// Banks stand this far above the water where the shoulder meets the channel.
const BANK_FREEBOARD=0.1;
// The map's channel wins over the DEM: a mapped river often lies partly up the DEM's valley wall, as the DEM is
// coarse and shifted; valley conflation (rivers.js) first moves the DEM's floor under the line, and what is left is cut. Ground is cut down to the bed inside the channel, and outside it down to a cut bank rising at
// WALL_SLOPE from the bank, joined to the existing ground with a smooth minimum, so a cut reads as a bank and not a
// trench. The cut fades back to the ground over the outer quarter of the reach's bank zone, which rivers.js sizes to
// the cut, so it never ends in a step. Cuts stop at CUT_LIMIT and fills at FILL_LIMIT; hits are counted (terrainLimited).
const CUT_LIMIT=30,FILL_LIMIT=2,WALL_SLOPE=0.6,WALL_STEEPEST=1.2,WALL_SOFT=3.0;
// Map lakes: the bed falls from the shore at SHORE_SLOPE toward a depth by class. The DEM holds no lake depth.
// Ground just outside the shore is raised to STILL_FREEBOARD over the level, fading back over STILL_FILL_SPAN.
const SHORE_SLOPE=0.25,STILL_DEPTH=Object.freeze({lake:6,pond:1.5,dock:4}),STILL_FREEBOARD=0.2,STILL_FILL_SPAN=12;
// A river polygon the network does not reach (a side arm, or a page coarser than RIVER_MIN_LEVEL) follows the DEM
// inside it, this deep.
const POLYGON_RIVER_DEPTH=2;
// Source water this close to sea level is the sea's, which the map never replaces.
const SEA_LEVEL_BAND=1;
// Source shores: blur radius in source pixels; the blurred mask's band (|phi| under SHORE_BAND) where the ground
// is a beach falling at SHORE_PROFILE through the level; at least SHORE_HOLD m/m on the right side of it.
const SHORE_SIGMA=0.6,SHORE_BAND=0.95,SHORE_PROFILE=0.1,SHORE_HOLD=0.02,SHORE_METRES=0.75*SHORE_SIGMA/0.6;
const smoothMin=(a,b,k)=>{const t=Math.max(k-Math.abs(a-b),0)/k;return Math.min(a,b)-t*t*k*0.25;};
export const waterExcessCode=e=>e>=DEEP_EXCESS?65535:Math.max(1,Math.min(65534,Math.round(e/WATER_EXCESS_UNIT)+WATER_EXCESS_ZERO));
export const waterExcessValue=code=>(code-WATER_EXCESS_ZERO)*WATER_EXCESS_UNIT;
// How much of a channel a page shows: none below 0.75 texels wide, all from 2. Carving and water fade together, so
// a coarse page never shows a river wider than it is, and finer pages deepen one channel rather than move it.
export const channelShare=(width,cell)=>{const t=Math.max(0,Math.min(1,(width/cell-0.75)/1.25));return t*t*(3-2*t);};
// Metres per height texel at the page centre: R/128/2^level, scaled by the chart metric as chooseZoom does.
// DEM zoom a coarse page's river network is solved on: one under its vector tiles (z12 lines on z11 heights), at most
// the river DEM's z13. The worker fetches these tiles beside the vector tiles (field-worker.js riverData).
export const coarseRiverDemZoom=(vectorZoom,source)=>Math.max(0,Math.min(13,source.maxZoom,vectorZoom-1));
// The reference grid of a page finer than WATER_REFERENCE_LEVEL (water-layer.js farShoreDistance): the texels of its
// ancestor page at that level, as that page places them (same mapper, same integer texels, so any descendant computes a
// node at the same position), over the page and WATER_FAR_REACH beyond it. at(i, j): texel (i, j) of the page in node
// units. Texels are vertex aligned (gutter 3), so a page's texel i lies at ancestor texel 3 + (i - 3 + 256 sub) / 2^d.
export function referenceGrid(page,ref){
 const d=page.level-WATER_REFERENCE_LEVEL;if(d<=0)return null;
 const sc=2**d,ax=Math.floor(page.x/sc),ay=Math.floor(page.y/sc),sx=page.x-ax*sc,sy=page.y-ay*sc,anc={face:page.face,level:WATER_REFERENCE_LEVEL,x:ax,y:ay};
 const cell=pageCellMetres(anc),margin=Math.ceil(WATER_FAR_REACH/cell)+3,span=Math.ceil((N-1)/sc)+2,side=span+2*margin;
 const kx0=Math.floor(3+(-3+256*sx)/sc)-margin,ky0=Math.floor(3+(-3+256*sy)/sc)-margin;
 const m=makeMapper('height',anc),o=m.out,X=new Float64Array(side*side),Y=new Float64Array(side*side);
 for(let b=0;b<side;b++)for(let a=0;a<side;a++){texelMercator(m,kx0+a,ky0+b);X[b*side+a]=o[0]+Math.round(ref-o[0]);Y[b*side+a]=o[1];}
 return {X,Y,side,cell,at:(i,j)=>[3+(i-3+256*sx)/sc-kx0,3+(j-3+256*sy)/sc-ky0]};
}
export function pageCellMetres(page){const s=2/2**page.level,u=-1+s*(page.x+0.5),v=-1+s*(page.y+0.5);return R/128/2**page.level/Math.pow(1+u*u+v*v,0.75);}
const SCR_HG=new Float32Array(N*N),SCR_XW=new Float64Array(N*N),SCR_YW=new Float64Array(N*N),SCR_QP=new Int32Array(N*N),SCR_QN=new Int32Array(N*N),SCR_QD=new Float32Array(N*N),SCR_ENV=new Float32Array(N*N),SCR_PHI=new Float32Array(N*N),SCR_E=new Float32Array(N*N),SCR_SL=new Float32Array(N*N),SCR_SC=new Float32Array(N*N),SCR_RL=new Float32Array(N*N),SCR_RC=new Float32Array(N*N),SCR_SRC=new Float32Array(N*N),SCR_LW=new Float32Array(N*N),SCR_NEAR=new Int32Array(N*N),SCR_OWN=new Uint8Array(N*N);
// opts.water: also build the page's water layer (water-layer.js) from the same tiles and network, returned as
// r.waterPage. Off by default until the GPU reads it (docs/WATER-LAYER.md).
export function buildHeightPage(page,getTile,source,riverTiles=[],opts={}){
 const z=chooseZoom(page,source),L=nodesForPage(page,'height',z,source.tileSize),box=coverageBox(source);
 if(!nodesCovered(box,L))return missing('coverage');
 const X=SCR_X,Y=SCR_Y;expandInto(L,X,Y);snapSharedEdges(page,L,{X,Y});
 if(!allCovered(box,X,Y))return missing('coverage');
 const S=makeSampler(getTile,source,z,'height'),h=SCR_H,M=N*N,cell=pageCellMetres(page),grid=!!source.seabedZoom;
 // The map first: polygons on every page from MAP_WATER_MIN_LEVEL, the river network from RIVER_MIN_LEVEL on z14
 // tiles. Both read the fixed z13 DEM and the map, never this page's heights.
 let map=null,rivers=null,riverStats=null,mapStats=null,union=null,unionMs=0,unionRivers=null;
 const tilesIn=riverTiles.filter(t=>t&&t.layers);
 if(tilesIn.length&&page.level>=MAP_WATER_MIN_LEVEL){
  const fine=page.level>=RIVER_MIN_LEVEL&&tilesIn[0].z===RIVER_ZOOM,raw=makeSampler(getTile,source,z,'height');raw.raw=true;
  let dem=null;if(fine){dem=makeSampler(getTile,source,Math.min(13,source.maxZoom,...tilesIn.map(t=>t.demZoom??13)),'height');dem.raw=true;}
  const demAt=(x,y)=>{if(dem){const v=heightAt(dem,x,y);if(v===v)return v;}return heightAt(raw,x,y);};
  // Lake levels on river pages come from the fixed z13 DEM, as the network's do, so every such level agrees;
  // coarser pages read their own source. Both read the source's water too, so a dock or lagoon open to the sea
  // stands at the sea's level.
  const water=grid?(x,y)=>waterAt(S,x,y):()=>NO_WATER;
  if(!(opts.water&&opts.terrain))map=mapWater(tilesIn,fine?(x,y)=>({h:demAt(x,y),water:water(x,y)}):(x,y)=>({h:heightAt(raw,x,y),water:water(x,y)}),{reach:Math.max(60,3*cell),samplerKey:(fine?'dem':'z')+z,wetAt:grid?(x,y)=>waterAt(S,x,y)>NO_WATER:null,gap:Math.max(3,1.5*cell)});
  if(map){mapStats=map.stats;if(map.empty)map=null;}
  if(fine){rivers=riverField(tilesIn,(x,y)=>heightAt(dem,x,y));riverStats=rivers.stats;if(!riverStats.segments)rivers=null;}
  // The water layer's network: the page's own below RIVER_MIN_LEVEL, from the lines of the tiles it reads (z(level+1)),
  // on its own DEM, so coarse pages carry the same rivers' levels and thin channels' coverage as fine ones.
  // Below RIVER_MIN_LEVEL the network is solved on the DEM one zoom under the vector tiles (coarseRiverDemZoom), fixed
  // per vector zoom, so it is a function of the tiles alone, complete, and shared by every page over them.
  if(opts.water){const t0=performance.now();let net=rivers;
   if(!fine){const cd=makeSampler(getTile,source,coarseRiverDemZoom(tilesIn[0].z,source),'height');cd.raw=true;net=riverField(tilesIn,(x,y)=>heightAt(cd,x,y));}
   unionRivers=net?.segments?.length?net:null;
   union=waterUnion(waterBodies(tilesIn,fine?(x,y)=>({h:demAt(x,y),water:water(x,y)}):(x,y)=>({h:heightAt(raw,x,y),water:water(x,y)}),{samplerKey:(fine?'dem':'z')+z}),net?.segments?.length?net:null);unionMs=performance.now()-t0;}
 }
 // Valley conflation (rivers.js): near a mapped river the DEM is read through a warp that brings its valley floor
 // under the line. The DEM's own water moves with it. The map, its polygons and its rivers stay where they are.
 const XW=SCR_XW,YW=SCR_YW;let folds=0;
 if(rivers){for(let k=0;k<M;k++){const w=rivers.warp(X[k],Y[k]);XW[k]=w?X[k]+w[0]:X[k];YW[k]=w?Y[k]+w[1]:Y[k];}
  // A fold: where the warp's slope reverses the DEM (Jacobian determinant under a quarter of the plain map's).
  for(let j=3;j<259;j+=2)for(let i=3;i<259;i+=2){const k=j*N+i,a=X[k+1]-X[k],b=X[k+N]-X[k],c=Y[k+1]-Y[k],d=Y[k+N]-Y[k],aw=XW[k+1]-XW[k],bw=XW[k+N]-XW[k],cw=YW[k+1]-YW[k],dw=YW[k+N]-YW[k];if((aw*dw-bw*cw)/(a*d-b*c)<.25)folds++;}
  riverStats.warpFolds=folds;}
 else{XW.set(X);YW.set(Y);}
 let min=Infinity,max=-Infinity;
 for(let o=0;o<M;o++){
  const v=heightAt(S,XW[o],YW[o]);
  if(v!==v)return missing('tile');
  h[o]=v;if(v<min)min=v;if(v>max)max=v;
 }
 // The water layer reads the map's positions (the DEM's warp moves only the DEM) and the unshaped DEM.
 let waterPage=null;
 // Wherever no vector tile of the page covers a point (below MAP_WATER_MIN_LEVEL, no tiles, a tile the host does not
 // have, or one that failed and leaves the page provisional), the source's sea stands in for the map's ocean there
 // (water-layer.js sourceSea). Before, a page short of one tile drew the sea under it as dry ground (owner's report,
 // 3 November 2026: sea tiles turning to grass while parked).
 if(opts.water&&grid){
  const zv=tilesIn.length&&page.level>=MAP_WATER_MIN_LEVEL?tilesIn[0].z:null,nv=zv===null?1:2**zv,present=new Set(tilesIn.filter(t=>!t.missing&&t.z===zv).map(t=>t.x+'/'+t.y));
  const covered=(x,y)=>zv!==null&&present.has((((Math.floor(x*nv))%nv)+nv)%nv+'/'+Math.floor(y*nv));
  const t0=performance.now(),size=S.size,reach=Math.max((WATER_BAND+6)*cell,page.level>WATER_REFERENCE_LEVEL?WATER_FAR_REACH+3*pageCellMetres({...page,level:WATER_REFERENCE_LEVEL,x:page.x>>(page.level-WATER_REFERENCE_LEVEL),y:page.y>>(page.level-WATER_REFERENCE_LEVEL)}):0)/metresPerMercator(Y[M>>1]);
  let bx0=Infinity,by0=Infinity,bx1=-Infinity,by1=-Infinity;for(let k=0;k<M;k+=97){bx0=Math.min(bx0,XW[k]);bx1=Math.max(bx1,XW[k]);by0=Math.min(by0,YW[k]);by1=Math.max(by1,YW[k]);}
  for(const k of [0,N-1,M-N,M-1]){bx0=Math.min(bx0,XW[k]);bx1=Math.max(bx1,XW[k]);by0=Math.min(by0,YW[k]);by1=Math.max(by1,YW[k]);}
  const box=[bx0-reach,by0-reach,bx1+reach,by1+reach];let open=false;
  for(let j=0;j<=8&&!open;j++)for(let i=0;i<=8;i++)if(!covered(box[0]+(box[2]-box[0])*i/8,box[1]+(box[3]-box[1])*j/8)){open=true;break;}
  if(open){const sea=sourceSea((i,j)=>{const x=(i+.5)/size,y=(j+.5)/size;if(covered(x,y))return NaN;const v=waterAt(S,x,y);return v>NO_WATER?v:NaN;},size,box);
   if(sea){union=waterUnion(union&&!union.empty?union:waterBodies([],()=>({h:NaN,water:NO_WATER})),unionRivers,sea);unionMs+=performance.now()-t0;}}
 }
 if(union&&!union.empty){waterPage=buildWaterPage(union,X,Y,cell,Float32Array.from(h),{extended:pad=>extendedTexelMap(page,pad,L.step,X[0]),reference:page.level>WATER_REFERENCE_LEVEL?()=>referenceGrid(page,X[0]):null});if(waterPage)waterPage.stats.unionMs=unionMs;}
 // opts.terrain (with opts.water): the terrain takes its beds and banks from the water layer (water-layer.js
 // shapeTerrain) and the old rules below (map water, river beds, source beaches, the excess plane) are not run. The
 // page then carries heights alone; its water is the water page.
 if(opts.water&&opts.terrain){
  // The ground starts from the raw DEM on land: a prepared tile's sea (water-steps.js) digs a seabed into every pixel
  // the DEM calls sea, beaches, piers and breakwaters the map calls land included. Inside the water the prepared
  // floor stays where it is deeper (the DEM's flat sea holds no depth).
  if(waterPage&&grid){const RW=makeSampler(getTile,source,z,'height');RW.raw=true;for(let o=0;o<M;o++){const v=heightAt(RW,XW[o],YW[o]);if(v===v)h[o]=waterPage.sdf[o]<0?Math.min(h[o],v):v;}}
  if(waterPage)waterPage.stats.terrain=shapeTerrain(union,waterPage,h,X,Y,cell);
  let lo=Infinity,hi=-Infinity;for(let o=0;o<M;o++){const v=h[o];if(v<lo)lo=v;if(v>hi)hi=v;}
  const sc=hi>lo?(hi-lo)/65535:0,q16=new Uint16Array(M);if(sc>0)for(let o=0;o<M;o++){const q=Math.round((h[o]-lo)/sc);q16[o]=q>65535?65535:q<0?0:q;}
  const r={offset:lo,scale:sc,bytes:q16.buffer,min:lo,max:hi,zoom:z,step:L.step,waterPage};if(riverStats)r.rivers=riverStats;if(mapStats)r.mapWater=mapStats;
  return r;
 }
 // Whether any source tile under the page holds water (water.js); the levels are read per pixel below.
 let anySource=false;if(grid)for(const t of S.cache.values())if(t&&t.water){anySource=true;break;}
 const SL=SCR_SL.fill(NaN),SC=SCR_SC,RL=SCR_RL.fill(NaN),RC=SCR_RC,own=SCR_OWN.fill(0),chosen=new Array(WATER_GRID*WATER_GRID).fill(null);
 let terrainLimited=0;
 if(map||rivers){
  // Queries first: shaping a texel reads its neighbours' answers.
  const QP=SCR_QP.fill(-1),QD=SCR_QD,QN=SCR_QN.fill(-1),RS=new Array(M).fill(null),polys=map?map.polys:[];
  // A texel just outside a polygon across a wet edge (the seam between two waters, under gap) takes that polygon's
  // water, so the seam is wet on both sides and no dry line stands between them.
  for(let k=0;k<M;k++){const q=map?map.query(X[k],Y[k]):null;if(q){QP[k]=q.poly?q.poly.index:q.wet?q.wet.index:-1;QD[k]=q.distance;QN[k]=q.near?q.near.index:-1;}if(rivers)RS[k]=rivers.sample(X[k],Y[k]);}
  // A river polygon the network does not reach follows the lowest ground of its own within two texels: on a
  // coarse page a texel's height averages the banks with the water, and stands over the river.
  const ENV=SCR_ENV;
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){const k=j*N+i,p=QP[k];if(p<0||RS[k]||polys[p].still)continue;let low=Infinity;
   for(let b=Math.max(0,j-2);b<=Math.min(N-1,j+2);b++)for(let a=Math.max(0,i-2);a<=Math.min(N-1,i+2);a++){const o=b*N+a;if(QP[o]===p&&h[o]<low)low=h[o];}ENV[k]=low;}
  // The hillside's own slope, before any shaping, for the cut banks below.
  const HG=SCR_HG;for(let j=0;j<N;j++)for(let i=0;i<N;i++){const k=j*N+i,a=i>0?k-1:k,b=i<N-1?k+1:k,c=j>0?k-N:k,d=j<N-1?k+N:k;HG[k]=Math.hypot((h[b]-h[a])/((b-a)*cell),(h[d]-h[c])/((d-c)/N*cell));}
  // A polygon shows by how many texels it spans, as a channel does: under 0.75 none, from 2 all. A partly shown
  // polygon keeps water only deeper inside than its missing share of a texel, so it shrinks away, not spreads.
  const shown=(share,s)=>share>=1?Infinity:s-(1-share)*cell;
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){
   const k=j*N+i,x=X[k],y=Y[k],r=RS[k],poly=QP[k]>=0?polys[QP[k]]:null,near=QN[k]>=0?polys[QN[k]]:null,distance=QD[k];
   if(!poly&&!near&&!r)continue;
   // Where the source has the sea, the sea stands: map water there never rises over it.
   const sea=anySource&&(poly?.still||near?.still)?waterAt(S,XW[k],YW[k]):NO_WATER,atSea=sea>NO_WATER&&Math.abs(sea)<=SEA_LEVEL_BAND;
   // Still map water: the polygon's level over a bed falling from its shore.
   if(poly&&poly.still){
    const share=channelShare(poly.size,cell);if(!Number.isFinite(poly.level)||share<=0||(atSea&&poly.level>=sea))continue;
    const D=STILL_DEPTH[poly.cls]??4,sd=Math.min(distance,1e5),bed=poly.level-D*(1-Math.exp(-SHORE_SLOPE*sd/D));
    if(h[k]>bed){if(h[k]-bed>CUT_LIMIT)terrainLimited++;h[k]-=share*Math.min(h[k]-bed,CUT_LIMIT);}
    SL[k]=poly.level;SC[k]=shown(share,sd);own[k]=1;continue;
   }
   // Beside a lake: ground under its level rises to a low bank, and its water sinks under the ground.
   if(!poly&&near?.still&&Number.isFinite(near.level)&&!atSea){
    const share=channelShare(near.size,cell);
    if(share>0){const o=distance,level=near.level,top=level+STILL_FREEBOARD;
     if(h[k]<top){const u=Math.min(1,o/STILL_FILL_SPAN),b=u*u*(3-2*u),d=(top-h[k])*(1-b);if(d>FILL_LIMIT)terrainLimited++;h[k]+=share*Math.min(FILL_LIMIT,d);}
     SL[k]=level;SC[k]=WATER_OUTSIDE-WATER_SINK*o;if(o<2*cell)own[k]=2;}
   }
   // Rivers: the union of the centreline's channel and the river polygon, at the network's level.
   const riverPoly=poly&&!poly.still?poly:null,nearRiver=!poly&&near&&!near.still?near:null;
   if(!r&&!riverPoly)continue;
   // The sea is not a river, nor is a source lake the map puts no river polygon over.
   const sv=anySource?waterAt(S,XW[k],YW[k]):NO_WATER;
   if(sv>NO_WATER&&(Math.abs(sv)<=SEA_LEVEL_BAND||!riverPoly))continue;
   let level,depth,ramp,share,bankSpan,fillSpan,capsule=Infinity,inner=Infinity;
   if(r){
    // The channel convolved with the texel: wider by half a texel, shallower in proportion, so a coarse page
    // holds the same cross-section without aliasing between texel centres.
    const half=r.capHalf,wide=Math.sqrt(half*half+cell*cell*.25);if(half>0)capsule=r.capDistance-wide;
    level=r.level;share=channelShare(r.total,cell);bankSpan=r.bankSpan;fillSpan=r.fillSpan;
    // In a polygon the bed reaches its depth a quarter of the river's width in from the shore, wherever the
    // centreline's channel also reaches: one rule over the whole polygon, so the bed has no seam where the two meet.
    depth=riverPoly?r.depth:r.depth*half/wide;ramp=riverPoly?Math.max(3,Math.min(30,r.total/4)):wide;
   }else{share=channelShare(riverPoly.size,cell);level=sv>NO_WATER?sv:ENV[k];depth=POLYGON_RIVER_DEPTH;ramp=4*depth+2;bankSpan=8;fillSpan=8;inner=shown(share,distance);}
   if(share<=0)continue;
   const sdf=Math.min(capsule,riverPoly?-distance:nearRiver?distance:Infinity);
   const inside=sdf<0,top=level+BANK_FREEBOARD;let target;
   if(inside){const u=Math.min(1,-sdf/ramp);target=level-depth*Math.pow(1-(1-u)*(1-u),1.3)+riverBedDetail(x,y,1-u,depth);}
   // High ground is cut to the bank wall. Low ground beside the channel is filled to the bank over a broad smooth
   // shoulder, so water stays in where the DEM misses a bank; large levees are forbidden.
   // The bank rises steeply enough to meet its hillside, continued at the hillside's own slope, by the time the
   // zone's fade begins (three quarters of bankSpan), so the fade has nothing left to lift: a bank that had not yet
   // met its hillside there was lifted back in a few metres, a ledge striped by each segment's own zone width.
   else if(h[k]>=top){const q2=Math.min(1,sdf/bankSpan),fade=Math.max(0,Math.min(1,(q2-.75)*4)),f=fade*fade*(3-2*fade),end=.75*bankSpan;
    const wall=Math.max(WALL_SLOPE,Math.min(WALL_STEEPEST,(h[k]-top+HG[k]*Math.max(0,end-sdf))/Math.max(end,1)));
    target=smoothMin(h[k],top+wall*sdf,WALL_SOFT)*(1-f)+h[k]*f;}
   else{const q2=Math.min(1,sdf/fillSpan),blend=q2*q2*(3-2*q2);target=top*(1-blend)+h[k]*blend;}
   let d=target-h[k];if(d<-CUT_LIMIT||d>FILL_LIMIT){terrainLimited++;d=Math.max(-CUT_LIMIT,Math.min(FILL_LIMIT,d));}
   h[k]+=share*d;
   // Outside the channel the water sinks away from the bank, so ground lower than the river nearby is plainly dry
   // and no filter of a near-zero excess paints it wet from afar.
   RL[k]=level;RC[k]=inside?inner:WATER_OUTSIDE-WATER_SINK*sdf;
   if(inside||riverPoly)own[k]=1;
   if(r&&inside&&i>=3&&i<259&&j>=3&&j<259){const c=((j-3)>>3)*32+((i-3)>>3),old=chosen[c];if(!old||r.total>old.total*1.1||(r.total>=old.total*.9&&r.ratio<old.ratio))chosen[c]=r;}
  }
  if(riverStats)riverStats.terrainLimited=(riverStats.terrainLimited||0)+terrainLimited;
 }
 // The source's own water where the map does not claim the texel; the sea it keeps everywhere. phi: the source's
 // wet mask blurred with a Gaussian of SHORE_SIGMA pixels, +1 deep in water, -1 well inland; level: the mean level
 // of the wet pixels under the blur. Texels with no wet pixel within two pixels stay as the map leaves them.
 const SRC=SCR_SRC.fill(NaN),PHI=SCR_PHI;let anyWet=false;const size=S.size,pixelM=metresPerMercator(YW[(N>>1)*N+(N>>1)])/size;
 if(anySource){
  let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;for(let k=0;k<M;k++){const fx=XW[k]*size,fy=YW[k]*size;if(fx<x0)x0=fx;if(fx>x1)x1=fx;if(fy<y0)y0=fy;if(fy>y1)y1=fy;}
  const ax=Math.floor(x0)-3,ay=Math.floor(y0)-3,rw=Math.floor(x1)+4-ax,rh=Math.floor(y1)+4-ay,local=rw*rh<=4194304;
  const raster=local?new Float32Array(rw*rh):null;
  if(local)for(let j=0;j<rh;j++)for(let i=0;i<rw;i++)raster[j*rw+i]=waterAt(S,(ax+i+.5)/size,(ay+j+.5)/size);
  // mixed[p]: the 4 x 4 pixels from p hold more than one value, so a texel over them takes the blur; any other
  // texel is plainly in water at one level, or plainly dry.
  let mixed=null;if(local){const row=new Uint8Array(rw*rh);mixed=new Uint8Array(rw*rh);
   for(let j=0;j<rh;j++)for(let i=0;i+3<rw;i++){const o=j*rw+i,v=raster[o];row[o]=v!==raster[o+1]||v!==raster[o+2]||v!==raster[o+3]?1:0;}
   for(let j=0;j+3<rh;j++)for(let i=0;i+3<rw;i++){const o=j*rw+i,v=raster[o];mixed[o]=row[o]|row[o+rw]|row[o+2*rw]|row[o+3*rw]|(v!==raster[o+rw]||v!==raster[o+2*rw]||v!==raster[o+3*rw]?1:0);}}
  const lv=local?(i,j)=>raster[(j-ay)*rw+(i-ax)]:(i,j)=>waterAt(S,(i+.5)/size,(j+.5)/size),inv=1/(2*SHORE_SIGMA*SHORE_SIGMA),gx=new Float64Array(4),gy=new Float64Array(4);
  for(let k=0;k<M;k++){
   const fx=XW[k]*size-.5,fy=YW[k]*size-.5,ix=Math.floor(fx),iy=Math.floor(fy);
   let phi,level;
   if(local&&!mixed[(iy-1-ay)*rw+(ix-1-ax)]){const v=raster[(iy-1-ay)*rw+(ix-1-ax)];if(!(v>NO_WATER))continue;phi=1;level=v;}
   else{let sw=0,sp=0,sl=0,wl=0;for(let a=0;a<4;a++){const dx=ix+a-1-fx,dy=iy+a-1-fy;gx[a]=Math.exp(-dx*dx*inv);gy[a]=Math.exp(-dy*dy*inv);}
    for(let b=0;b<4;b++)for(let a=0;a<4;a++){const w=gx[a]*gy[b],v=lv(ix+a-1,iy+b-1);sw+=w;if(v>NO_WATER){sp+=w;sl+=w*v;wl+=w;}else sp-=w;}
    if(wl<=0)continue;phi=sp/sw;level=sl/wl;}
   if(own[k]&&Math.abs(level)>SEA_LEVEL_BAND)continue;
   SRC[k]=level;PHI[k]=phi;anyWet=true;
   // The beach: within the band the ground meets the level where phi crosses zero, and no texel lies on the wrong
   // side of it; outside the band the ground is the source's. Not under map water: a lagoon, estuary or harbour the
   // map draws past the source's shore keeps its bed, or the beach stood up in it as a ridge to the surface.
   const a2=Math.abs(phi);if(a2>=SHORE_BAND||own[k]===1)continue;
   const d=SHORE_METRES*phi*pixelM,u=Math.max(0,Math.min(1,(a2-.35)/(SHORE_BAND-.35))),w=u*u*(3-2*u);
   let hn=(level-SHORE_PROFILE*d)*(1-w)+h[k]*w;hn=phi>0?Math.min(hn,level-SHORE_HOLD*d):Math.max(hn,level-SHORE_HOLD*d);
   h[k]=hn;
  }
 }
 let anyWater=anyWet;if(!anyWater)for(let k=0;k<M;k++)if(SL[k]===SL[k]||RL[k]===RL[k]){anyWater=true;break;}
 if(!anyWater){
  const scale=max>min?(max-min)/65535:0,u16=new Uint16Array(M);
  if(scale>0)for(let o=0;o<M;o++){const q=Math.round((h[o]-min)/scale);u16[o]=q>65535?65535:q<0?0:q;}
  const r={offset:min,scale,bytes:u16.buffer,min,max,zoom:z,step:L.step};if(grid||map||rivers)r.water=Float32Array.of(NO_WATER);
  if(riverStats)r.rivers=riverStats;if(mapStats)r.mapWater=mapStats;if(opts.water)r.waterPage=waterPage;
  return r;
 }
 min=Infinity;max=-Infinity;for(let o=0;o<M;o++){const v=h[o];if(v<min)min=v;if(v>max)max=v;}
 const scale=max>min?(max-min)/65535:0,u16=new Uint16Array(2*M);
 for(let o=0;o<M;o++){const q=scale>0?Math.round((h[o]-min)/scale):0;u16[o]=q>65535?65535:q<0?0:q;}
 const E=SCR_E,LW=SCR_LW.fill(NaN);
 for(let k=0;k<M;k++){
  const hq=min+scale*u16[k];let e=WATER_EXCESS_FAR,lw=NaN;
  if(SL[k]===SL[k]){const v=Math.min(SL[k]-hq,SC[k]);if(v>e){e=v;lw=SL[k];}}
  if(RL[k]===RL[k]){const v=Math.min(RL[k]-hq,RC[k]);if(v>e){e=v;lw=NaN;}}
  // Source water: flat at its level inside the blurred shore, held under the ground outside it.
  if(SRC[k]===SRC[k]){const level=SRC[k],phi=PHI[k],v=phi>0?level-hq:Math.min(level-hq,WATER_OUTSIDE+WATER_SINK*SHORE_METRES*phi*pixelM);if(v>e){e=v;lw=level;}}
  E[k]=e;LW[k]=lw;u16[M+k]=waterExcessCode(e);
 }
 // The page's water grid, per 8 x 8 cell: the commonest still level among its wet texels (the level deep texels
 // read), else a river cell for flow alone, else none.
 const planes=new Float32Array(WATER_GRID*WATER_GRID*4);
 for(let c=0;c<1024;c++){
  const cx=c&31,cy=c>>5;let first=NaN,mixed=false;
  for(let j=3+cy*8;j<11+cy*8;j++)for(let i=3+cx*8;i<11+cx*8;i++){const k=j*N+i;if(E[k]>0&&LW[k]===LW[k]){if(first!==first)first=LW[k];else if(LW[k]!==first)mixed=true;}}
  let level=first===first?first:NO_WATER;
  if(mixed){const counts=new Map();for(let j=3+cy*8;j<11+cy*8;j++)for(let i=3+cx*8;i<11+cx*8;i++){const k=j*N+i;if(E[k]>0&&LW[k]===LW[k])counts.set(LW[k],(counts.get(LW[k])||0)+1);}
   let best=0;for(const [v,n] of counts)if(n>best||(n===best&&v>level)){best=n;level=v;}}
  planes[c*4]=level;
 }
 if(rivers)for(let y=0;y<32;y++)for(let x=0;x<32;x++){
  const c=y*32+x,r=chosen[c];if(!r||planes[c*4]>NO_WATER)continue;const k=(y*8+7)*N+x*8+7,s=r.segment;
  const a=X[k+1]-X[k],b=X[k+N]-X[k],cc=Y[k+1]-Y[k],d=Y[k+N]-Y[k],det=a*d-b*cc;
  const center=rivers.sample(X[k],Y[k]),t=((X[k]-s.a[0])*s.dx+(Y[k]-s.a[1])*s.dy)/s.length2;
  // Flow only: a level at the cell centre, the fitted gradient of the reach (never a finite difference that
  // could cross into another reach) and the downstream direction. The packed angle marks a river cell.
  planes[c*4]=center?.level??s.h0+Math.max(0,Math.min(1,t))*s.dh;
  const gx=center?.gx??s.dh*s.dx/s.length2,gy=center?.gy??s.dh*s.dy/s.length2;
  planes[c*4+1]=gx*a+gy*cc;planes[c*4+2]=gx*b+gy*d;
  const du=(d*s.dx-b*s.dy)/det*s.dir,dv=(-cc*s.dx+a*s.dy)/det*s.dir;
  planes[c*4+3]=2+Math.atan2(dv,du)/(2*Math.PI);
 }
 const r={offset:min,scale,bytes:u16.buffer,min,max,zoom:z,step:L.step,water:planes,texels:true};
 if(riverStats)r.rivers=riverStats;if(mapStats)r.mapWater=mapStats;if(opts.water)r.waterPage=waterPage;
 return r;
}

export function buildAlbedoPage(page,getTile,source){
 const z=chooseZoom(page,source),L=nodesForPage(page,'albedo',z,source.tileSize),box=coverageBox(source);
 if(!nodesCovered(box,L))return missing('coverage');
 const X=SCR_X,Y=SCR_Y;expandInto(L,X,Y);
 if(!allCovered(box,X,Y))return missing('coverage');
 const S=makeSampler(getTile,source,z,'albedo'),out=new Uint8Array(N*N*4),c=new Float64Array(3);
 for(let o=0;o<N*N;o++){
  if(!rgbAt(S,X[o],Y[o],c))return missing('tile');
  const q=o*4;out[q]=linearToSrgbByte(c[0]);out[q+1]=linearToSrgbByte(c[1]);out[q+2]=linearToSrgbByte(c[2]);out[q+3]=255;
 }
 return {offset:0,scale:1,bytes:out.buffer,zoom:z,step:L.step};
}

// ---- Overlay: the sharp source contributes only detail over a colour base matched to the base source.
// result = overlayHigh * clamp(baseLow / max(overlayLow, eps), 0.25, 4) in linear light, where baseLow and
// overlayLow are both read at the base source's zoom (so they share a resolution). Where the overlay has
// no data the base is used, with a feather of about FEATHER texels so the edge is not a hard line.
export const FEATHER=16,GAIN_MIN=0.25,GAIN_MAX=4,EPS=0.002;
// Zooms the overlay build uses, shared with the worker so it fetches exactly these tiles.
export function overlayPlan(page,base,overlay){
 const zb=chooseZoom(page,base),zh=chooseZoom(page,overlay),zl=Math.max(overlay.minZoom,Math.min(Math.min(zb,zh),overlay.maxZoom));
 return {zBase:zb,zHigh:zh,zLow:zl};
}
export function overlayApplies(page,overlay){
 // Coarser pages have nothing to gain over the base imagery, and would fetch many overlay tiles.
 if(page.level<(overlay.minLevel??0))return false;
 const b=overlay.coverage?.bbox;if(!b)return true;
 const q=pageLonLatBounds(page),d=180/Math.PI; // bbox is assumed not to straddle the antimeridian
 return !(q.latMax*d<b.latMin||q.latMin*d>b.latMax||q.lonMax*d<b.lonMin||q.lonMin*d>b.lonMax);
}
// Feather weights from a validity mask: 0 at and beside invalid texels, rising smoothly to 1 at FEATHER texels away.
export function featherWeights(valid,width=N,height=N,feather=FEATHER){
 const d=new Float32Array(width*height),BIG=1e9,D=Math.SQRT2;let any=false;
 for(let o=0;o<d.length;o++){if(valid[o])d[o]=BIG;else{d[o]=0;any=true;}}
 if(any){
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const o=y*width+x;let v=d[o],c;
   if(x>0&&(c=d[o-1]+1)<v)v=c;
   if(y>0){
    if((c=d[o-width]+1)<v)v=c;
    if(x>0&&(c=d[o-width-1]+D)<v)v=c;
    if(x<width-1&&(c=d[o-width+1]+D)<v)v=c;
   }
   d[o]=v;
  }
  for(let y=height-1;y>=0;y--)for(let x=width-1;x>=0;x--){
   const o=y*width+x;let v=d[o],c;
   if(x<width-1&&(c=d[o+1]+1)<v)v=c;
   if(y<height-1){
    if((c=d[o+width]+1)<v)v=c;
    if(x<width-1&&(c=d[o+width+1]+D)<v)v=c;
    if(x>0&&(c=d[o+width-1]+D)<v)v=c;
   }
   d[o]=v;
  }
 }
 const w=new Float32Array(width*height),inv=1/feather;
 for(let o=0;o<w.length;o++){const t=Math.min(d[o]*inv,1);w[o]=t*t*(3-2*t);}
 return w;
}
const SCR_LIN=new Float32Array(N*N*3),SCR_OVL=new Float32Array(N*N*3),SCR_VALID=new Uint8Array(N*N);
export function buildOverlayAlbedoPage(page,getTile,base,overlay){
 const plan=overlayPlan(page,base,overlay),Lb=nodesForPage(page,'albedo',Math.max(plan.zBase,plan.zHigh),base.tileSize),boxB=coverageBox(base);
 if(!nodesCovered(boxB,Lb))return missing('coverage');
 const X=SCR_X,Y=SCR_Y;expandInto(Lb,X,Y);
 if(!allCovered(boxB,X,Y))return missing('coverage');
 const sb=makeSampler(getTile,base,plan.zBase,'albedo'),boxO=coverageBox(overlay);
 const sh=makeSampler(getTile,overlay,plan.zHigh,'albedo'),sl=makeSampler(getTile,overlay,plan.zLow,'albedo');
 const lin=SCR_LIN,ovl=SCR_OVL,valid=SCR_VALID,cb=new Float64Array(3),ch=new Float64Array(3),cl=new Float64Array(3);
 valid.fill(0);let anyValid=false,count=0;
 for(let o=0;o<N*N;o++){
  if(!rgbAt(sb,X[o],Y[o],cb))return missing('tile');
  const q=o*3;lin[q]=cb[0];lin[q+1]=cb[1];lin[q+2]=cb[2];
  if(!inBox(boxO,X[o],Y[o]))continue;
  if(rgbAt(sh,X[o],Y[o],ch)!==1||rgbAt(sl,X[o],Y[o],cl)!==1)continue;
  valid[o]=1;anyValid=true;count++;
  for(let k=0;k<3;k++)ovl[q+k]=ch[k]*Math.min(GAIN_MAX,Math.max(GAIN_MIN,cb[k]/Math.max(cl[k],EPS)));
 }
 const w=anyValid?featherWeights(valid):null,out=new Uint8Array(N*N*4);
 for(let o=0;o<N*N;o++){
  const a=w?w[o]*valid[o]:0,q=o*3,r=o*4;
  if(a>0){for(let k=0;k<3;k++)out[r+k]=linearToSrgbByte(lin[q+k]*(1-a)+ovl[q+k]*a);}
  else{out[r]=linearToSrgbByte(lin[q]);out[r+1]=linearToSrgbByte(lin[q+1]);out[r+2]=linearToSrgbByte(lin[q+2]);}
  out[r+3]=255;
 }
 return {offset:0,scale:1,bytes:out.buffer,zoom:plan.zBase,overlayZoom:plan.zHigh,overlayCoverage:anyValid?count/(N*N):0};
}
// Everything the worker must fetch for one albedo page: [{source,z,x,y}]. Empty array: nothing is possible (coverage).
export function overlayTiles(page,base,overlay){
 const p=overlayPlan(page,base,overlay),tag=(source,list)=>list.map(t=>({source,...t}));
 const b=requiredTiles(page,base,{zoom:p.zBase});if(!b.length)return [];
 const hi=requiredTiles(page,overlay,{zoom:p.zHigh,partial:true}),lo=p.zLow===p.zHigh?[]:requiredTiles(page,overlay,{zoom:p.zLow,partial:true});
 return [...tag(base,b),...tag(overlay,hi),...tag(overlay,lo)];
}
