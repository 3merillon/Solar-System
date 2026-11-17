// Bench for field page building, and home of the reference implementation. Usage: node tools/Bench-Field-Pages.mjs [fixtureDir]
// The first section is a VERBATIM copy of web/field/resample.js as it was before the pool/speed work (only the two import paths
// changed). tools/Test-Field-Logic.mjs compares the optimised builders against it. Do not "improve" it.
// JPEG tiles have no pure Node decoder here: the bench decodes the recorded JPEGs once with Python PIL into a temp cache.
// Page building: Web Mercator tiles -> 264x264 chart pages. Pure and synchronous given decoded tiles;
// this module knows nothing about networks. getTile(source,z,x,y) returns a decoded tile or null/undefined:
//   height tile {heights:Float32Array,width,height}; albedo tile {rgba:Uint8Array,width,height}.
import {R,PAGE_TEXELS as N,texelToChart,chartToDirection,directionToMercator,directionToLonLat,pageLonLatBounds} from '../web/field/chart.js';
import {terrariumHeights} from '../web/field/png.js';
export const MAP_TOLERANCE=0.02;     // source pixels: bound on interpolated-vs-exact position error
const PROBE_TOLERANCE=0.015;         // probes sample a few cells, so they are held tighter than the bound
const TAU=2*Math.PI;
const mercY=lat=>0.5-Math.atanh(Math.sin(lat*Math.PI/180))/TAU;

// Level choice follows CesiumJS's getLevelWithMaximumTexelSpacing: the coarsest level whose texel is no coarser than the target.
// Cell width is R/128/2^D at the face centre, scaled by the isotropic chart metric r^-1.5, r=sqrt(1+u^2+v^2).
export function chooseZoom(page,source){
 const s=2/2**page.level,u=-1+s*(page.x+0.5),v=-1+s*(page.y+0.5),r=Math.sqrt(1+u*u+v*v);
 const cell=R/128/2**page.level/Math.pow(r,1.5);
 const lat=directionToLonLat(chartToDirection(page.face,u,v))[1];
 const pixelAtZ0=156543.034*Math.max(Math.cos(lat),1e-6)*256/source.tileSize;
 const z=Math.ceil(Math.log2(pixelAtZ0/cell));
 return Math.max(source.minZoom,Math.min(source.maxZoom,z));
}

// Mapping from texel to normalised Mercator (X unwrapped around the first node, Y in [0,1] inside coverage).
// The expensive direction->Mercator evaluation runs on a coarse node lattice and is interpolated bilinearly.
// Probes compare interpolation with exact positions at cell midpoints and halve the step until the error is
// under the bound, so a strongly curved page (coarse level, high latitude) pays for exact positions.
function exactNode(channel,page,i,j){const [u,v]=texelToChart(channel,page,i,j);return directionToMercator(chartToDirection(page.face,u,v));}
function nodeLattice(channel,page,step){
 const M=N/step+1,X=new Float64Array(M*M),Y=new Float64Array(M*M);let ref=0;
 for(let b=0;b<M;b++)for(let a=0;a<M;a++){
  const p=exactNode(channel,page,a*step,b*step);
  if(a===0&&b===0)ref=p[0];
  X[b*M+a]=p[0]+Math.round(ref-p[0]);Y[b*M+a]=p[1];
 }
 return {M,X,Y,step};
}
function probeError(channel,page,L,pixelsPerUnit){
 const {M,X,Y,step}=L,cells=M-1;let worst=0;
 // Every cell midpoint and every cell-edge midpoint (bilinear error peaks at either, depending on curvature signs).
 // Cost is about 3 exact evaluations per coarse cell, a few percent of exact mapping at step 8.
 for(let ib=0;ib<=2*cells;ib++)for(let ia=0;ia<=2*cells;ia++){
  if(!(ia&1)&&!(ib&1))continue;
  const a0=ia>>1,b0=ib>>1,a1=Math.min(a0+(ia&1),M-1),b1=Math.min(b0+(ib&1),M-1),k00=b0*M+a0,k10=b0*M+a1,k01=b1*M+a0,k11=b1*M+a1;
  const p=exactNode(channel,page,ia*step/2,ib*step/2);
  const ix=(X[k00]+X[k10]+X[k01]+X[k11])/4,iy=(Y[k00]+Y[k10]+Y[k01]+Y[k11])/4; // duplicated corners make the edge case a mean of two
  const dX=p[0]+Math.round(ix-p[0])-ix,dY=p[1]-iy;
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
export function expandNodes(L){
 const {M,X,Y,step}=L,TX=new Float64Array(N*N),TY=new Float64Array(N*N);
 for(let j=0;j<N;j++){
  const cb=Math.min(Math.floor(j/step),M-2),fy=j/step-cb;
  for(let i=0;i<N;i++){
   const ca=Math.min(Math.floor(i/step),M-2),fx=i/step-ca,k=cb*M+ca,o=j*N+i;
   TX[o]=(X[k]*(1-fx)+X[k+1]*fx)*(1-fy)+(X[k+M]*(1-fx)+X[k+M+1]*fx)*fy;
   TY[o]=(Y[k]*(1-fx)+Y[k+1]*fx)*(1-fy)+(Y[k+M]*(1-fx)+Y[k+M+1]*fx)*fy;
  }
 }
 return {X:TX,Y:TY};
}
// Height grid lines 0 and 256 are shared with the neighbouring pages. Evaluate them exactly so that two pages
// sample the same source position at a shared grid point whatever lattice step each chose; they then differ
// only by quantisation, not by interpolation error times terrain slope.
export function snapSharedEdges(page,L,m){
 const ref=L.X[0];
 for(let t=0;t<N;t++)for(const e of [3,259]){
  for(const [i,j] of [[e,t],[t,e]]){const p=exactNode('height',page,i,j),o=j*N+i;m.X[o]=p[0]+Math.round(ref-p[0]);m.Y[o]=p[1];}
 }
}
// Texel positions evaluated exactly (reference for tests and for the error bound).
export function exactTexelMap(page,channel){
 const X=new Float64Array(N*N),Y=new Float64Array(N*N);let ref=0;
 for(let j=0;j<N;j++)for(let i=0;i<N;i++){const p=exactNode(channel,page,i,j);if(i===0&&j===0)ref=p[0];X[j*N+i]=p[0]+Math.round(ref-p[0]);Y[j*N+i]=p[1];}
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
function tilesOf(L,source,z,box){
 const {M,X,Y}=L,n=2**z,size=source.tileSize*n,out=new Map(),margin=0.1;
 for(let b=0;b<M-1;b++)for(let a=0;a<M-1;a++){
  const k=b*M+a;
  if(box&&!(inBox(box,X[k],Y[k])||inBox(box,X[k+1],Y[k+1])||inBox(box,X[k+M],Y[k+M])||inBox(box,X[k+M+1],Y[k+M+1])))continue;
  const xs=[X[k],X[k+1],X[k+M],X[k+M+1]],ys=[Y[k],Y[k+1],Y[k+M],Y[k+M+1]];
  const x0=Math.floor(Math.min(...xs)*size-0.5-margin),x1=Math.floor(Math.max(...xs)*size-0.5+margin)+1;
  const y0=Math.floor(Math.min(...ys)*size-0.5-margin),y1=Math.floor(Math.max(...ys)*size-0.5+margin)+1;
  const ty0=Math.max(0,Math.floor(y0/source.tileSize)),ty1=Math.min(n-1,Math.floor(y1/source.tileSize));
  for(let tx=Math.floor(x0/source.tileSize);tx<=Math.floor(x1/source.tileSize);tx++)for(let ty=ty0;ty<=ty1;ty++){
   const wx=((tx%n)+n)%n;out.set(`${z}/${wx}/${ty}`,{z,x:wx,y:ty});
  }
 }
 return [...out.values()];
}
// requiredTiles(page,source,{zoom}) -> [{z,x,y}] . Empty when the page lies outside the source's coverage.
export function requiredTiles(page,source,opts={}){
 const z=opts.zoom??chooseZoom(page,source),L=nodesForPage(page,source.channel,z,source.tileSize),box=coverageBox(source);
 if(opts.partial)return tilesOf(L,source,z,box); // overlays: only cells touching the source's coverage
 return nodesCovered(box,L)?tilesOf(L,source,z):[];
}

// Tile sampler: bilinear over pixel centres, reads across adjacent tiles, wraps in x, clamps in y.
function makeSampler(getTile,source,z,kind){
 const ts=source.tileSize,n=2**z,size=ts*n,cache=new Map();
 const tile=(tx,ty)=>{const k=ty*n+tx;let t=cache.get(k);if(t===undefined){t=getTile(source,z,tx,ty)||null;if(t&&kind==='height'&&!t.heights){t.heights=terrariumHeights(t.rgba,t.width,t.height);}cache.set(k,t);}return t;};
 const find=(gx,gy)=>{
  gx=((gx%size)+size)%size;gy=gy<0?0:gy>=size?size-1:gy;
  return tile(Math.floor(gx/ts),Math.floor(gy/ts));
 };
 const hp=(a,b)=>{const gx=((a%size)+size)%size,gy=b<0?0:b>=size?size-1:b,t=tile(Math.floor(gx/ts),Math.floor(gy/ts));return t?t.heights[(gy%ts)*t.width+(gx%ts)]:NaN;};
 // Fast path: the 2x2 stencil lies inside one tile (almost always); the last tile is remembered.
 let ltx=-1,lty=-1,lt=null;
 const inner=(x0,y0)=>{
  if(x0<0||y0<0)return null;
  const tx=Math.floor(x0/ts),ty=Math.floor(y0/ts);
  if(x0-tx*ts>=ts-1||y0-ty*ts>=ts-1)return null;
  if(tx!==ltx||ty!==lty){ltx=tx;lty=ty;lt=tile(tx,ty);}
  return lt;
 };
 return {
  size,
  // NaN when a needed tile is missing.
  height(X,Y){
   const px=X*size-0.5,py=Y*size-0.5,x0=Math.floor(px),y0=Math.floor(py),fx=px-x0,fy=py-y0,t=inner(x0,y0);
   if(t){const o=(y0-lty*ts)*t.width+(x0-ltx*ts),h=t.heights;return (h[o]*(1-fx)+h[o+1]*fx)*(1-fy)+(h[o+t.width]*(1-fx)+h[o+t.width+1]*fx)*fy;}
   const h00=hp(x0,y0),h10=hp(x0+1,y0),h01=hp(x0,y0+1),h11=hp(x0+1,y0+1);
   return (h00*(1-fx)+h10*fx)*(1-fy)+(h01*(1-fx)+h11*fx)*fy;
  },
  // Writes linear-light rgb into out[0..2]; returns 0 when a tile is missing, 1 when fine, 2 when a stencil pixel is no-data (white or alpha 0).
  rgb(X,Y,out){
   const px=X*size-0.5,py=Y*size-0.5,x0=Math.floor(px),y0=Math.floor(py),fx=px-x0,fy=py-y0;
   out[0]=out[1]=out[2]=0;let nodata=false;
   const t0=inner(x0,y0);
   if(t0){
    const d=t0.rgba,o0=((y0-lty*ts)*t0.width+(x0-ltx*ts))*4,r=t0.width*4;
    for(let k=0;k<4;k++){
     const o=o0+(k&1)*4+(k>>1)*r,w=((k&1)?fx:1-fx)*((k>>1)?fy:1-fy);
     if(d[o+3]===0||(d[o]===255&&d[o+1]===255&&d[o+2]===255))nodata=true;
     out[0]+=SRGB_TO_LINEAR[d[o]]*w;out[1]+=SRGB_TO_LINEAR[d[o+1]]*w;out[2]+=SRGB_TO_LINEAR[d[o+2]]*w;
    }
    return nodata?2:1;
   }
   for(let k=0;k<4;k++){
    const dx=k&1,dy=k>>1,gx=((x0+dx)%size+size)%size,gy=Math.min(Math.max(y0+dy,0),size-1),t=find(gx,gy);
    if(!t)return 0;
    const o=((gy%ts)*t.width+(gx%ts))*4,d=t.rgba,w=(dx?fx:1-fx)*(dy?fy:1-fy);
    if(d[o+3]===0||(d[o]===255&&d[o+1]===255&&d[o+2]===255))nodata=true;
    out[0]+=SRGB_TO_LINEAR[d[o]]*w;out[1]+=SRGB_TO_LINEAR[d[o+1]]*w;out[2]+=SRGB_TO_LINEAR[d[o+2]]*w;
   }
   return nodata?2:1;
  },
 };
}

// sRGB <-> linear. Encoding is exact: the byte is the number of decode thresholds not above the value,
// where threshold k is the linear value halfway (in gamma space) between byte k and k+1; so
// encode(decode(b)) === b for every byte, and values round as round(255*encodeFormula(l)).
const decodeFormula=c=>c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);
export const SRGB_TO_LINEAR=Float32Array.from({length:256},(_,i)=>decodeFormula(i/255));
const THRESHOLDS=Float64Array.from({length:255},(_,k)=>decodeFormula((k+0.5)/255));
export function linearToSrgbByte(l){
 let lo=0,hi=255; // count of thresholds <= l
 while(lo<hi){const mid=(lo+hi)>>1;if(THRESHOLDS[mid]<=l)lo=mid+1;else hi=mid;}
 return lo;
}

function missing(reason){return {missing:true,reason};}

export function buildHeightPage(page,getTile,source){
 const z=chooseZoom(page,source),L=nodesForPage(page,'height',z,source.tileSize),box=coverageBox(source);
 if(!nodesCovered(box,L))return missing('coverage');
 const m=expandNodes(L);snapSharedEdges(page,L,m);
 const {X,Y}=m;
 if(!allCovered(box,X,Y))return missing('coverage');
 const s=makeSampler(getTile,source,z,'height'),h=new Float32Array(N*N);let min=Infinity,max=-Infinity;
 for(let o=0;o<h.length;o++){
  const v=s.height(X[o],Y[o]);
  if(v!==v)return missing('tile');
  h[o]=v;if(v<min)min=v;if(v>max)max=v;
 }
 const scale=max>min?(max-min)/65535:0,u16=new Uint16Array(N*N); // platform is little endian in every browser and Node target
 if(scale>0)for(let o=0;o<h.length;o++)u16[o]=Math.min(65535,Math.max(0,Math.round((h[o]-min)/scale)));
 return {offset:min,scale,bytes:u16.buffer,min,max,zoom:z,step:L.step};
}

export function buildAlbedoPage(page,getTile,source){
 const z=chooseZoom(page,source),L=nodesForPage(page,'albedo',z,source.tileSize),box=coverageBox(source);
 if(!nodesCovered(box,L))return missing('coverage');
 const {X,Y}=expandNodes(L);
 if(!allCovered(box,X,Y))return missing('coverage');
 const s=makeSampler(getTile,source,z,'albedo'),out=new Uint8Array(N*N*4),c=new Float32Array(3);
 for(let o=0;o<N*N;o++){
  if(!s.rgb(X[o],Y[o],c))return missing('tile');
  out[o*4]=linearToSrgbByte(c[0]);out[o*4+1]=linearToSrgbByte(c[1]);out[o*4+2]=linearToSrgbByte(c[2]);out[o*4+3]=255;
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
 const b=overlay.coverage?.bbox;if(!b)return true;
 const q=pageLonLatBounds(page),d=180/Math.PI; // bbox is assumed not to straddle the antimeridian
 return !(q.latMax*d<b.latMin||q.latMin*d>b.latMax||q.lonMax*d<b.lonMin||q.lonMin*d>b.lonMax);
}
// Feather weights from a validity mask: 0 at and beside invalid texels, rising smoothly to 1 at FEATHER texels away.
export function featherWeights(valid,width=N,height=N,feather=FEATHER){
 const d=new Float32Array(width*height),BIG=1e9,D=Math.SQRT2;let any=false;
 for(let o=0;o<d.length;o++){if(valid[o])d[o]=BIG;else{d[o]=0;any=true;}}
 if(any){
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const o=y*width+x;let v=d[o];
   if(x>0)v=Math.min(v,d[o-1]+1);if(y>0){v=Math.min(v,d[o-width]+1);if(x>0)v=Math.min(v,d[o-width-1]+D);if(x<width-1)v=Math.min(v,d[o-width+1]+D);}d[o]=v;}
  for(let y=height-1;y>=0;y--)for(let x=width-1;x>=0;x--){const o=y*width+x;let v=d[o];
   if(x<width-1)v=Math.min(v,d[o+1]+1);if(y<height-1){v=Math.min(v,d[o+width]+1);if(x<width-1)v=Math.min(v,d[o+width+1]+D);if(x>0)v=Math.min(v,d[o+width-1]+D);}d[o]=v;}
 }
 const w=new Float32Array(width*height);
 for(let o=0;o<w.length;o++){const t=Math.min(d[o]/feather,1);w[o]=t*t*(3-2*t);}
 return w;
}
export function buildOverlayAlbedoPage(page,getTile,base,overlay){
 const plan=overlayPlan(page,base,overlay),Lb=nodesForPage(page,'albedo',Math.max(plan.zBase,plan.zHigh),base.tileSize),boxB=coverageBox(base);
 if(!nodesCovered(boxB,Lb))return missing('coverage');
 const {X,Y}=expandNodes(Lb);
 if(!allCovered(boxB,X,Y))return missing('coverage');
 const sb=makeSampler(getTile,base,plan.zBase,'albedo'),boxO=coverageBox(overlay);
 const sh=makeSampler(getTile,overlay,plan.zHigh,'albedo'),sl=makeSampler(getTile,overlay,plan.zLow,'albedo');
 const lin=new Float32Array(N*N*3),ovl=new Float32Array(N*N*3),valid=new Uint8Array(N*N),cb=new Float32Array(3),ch=new Float32Array(3),cl=new Float32Array(3);
 let anyValid=false;
 for(let o=0;o<N*N;o++){
  if(!sb.rgb(X[o],Y[o],cb))return missing('tile');
  lin[o*3]=cb[0];lin[o*3+1]=cb[1];lin[o*3+2]=cb[2];
  if(!inBox(boxO,X[o],Y[o]))continue;
  if(sh.rgb(X[o],Y[o],ch)!==1||sl.rgb(X[o],Y[o],cl)!==1)continue;
  valid[o]=1;anyValid=true;
  for(let k=0;k<3;k++)ovl[o*3+k]=ch[k]*Math.min(GAIN_MAX,Math.max(GAIN_MIN,cb[k]/Math.max(cl[k],EPS)));
 }
 const w=anyValid?featherWeights(valid):null,out=new Uint8Array(N*N*4);
 for(let o=0;o<N*N;o++){
  const a=w?w[o]*valid[o]:0;
  for(let k=0;k<3;k++)out[o*4+k]=linearToSrgbByte(a>0?lin[o*3+k]*(1-a)+ovl[o*3+k]*a:lin[o*3+k]);
  out[o*4+3]=255;
 }
 return {offset:0,scale:1,bytes:out.buffer,zoom:plan.zBase,overlayZoom:plan.zHigh,overlayCoverage:anyValid?valid.reduce((s,v)=>s+v,0)/valid.length:0};
}
// Everything the worker must fetch for one albedo page: [{source,z,x,y}]. Empty array: nothing is possible (coverage).
export function overlayTiles(page,base,overlay){
 const p=overlayPlan(page,base,overlay),tag=(source,list)=>list.map(t=>({source,...t}));
 const b=requiredTiles(page,base,{zoom:p.zBase});if(!b.length)return [];
 const hi=requiredTiles(page,overlay,{zoom:p.zHigh,partial:true}),lo=p.zLow===p.zHigh?[]:requiredTiles(page,overlay,{zoom:p.zLow,partial:true});
 return [...tag(base,b),...tag(overlay,hi),...tag(overlay,lo)];
}

// ======================================================================= bench (not the reference)
import {readdirSync,readFileSync,writeFileSync,existsSync,mkdirSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {decodeTerrarium} from '../web/field/png.js';
import {SOURCES} from '../web/field/sources.js';
import * as cur from '../web/field/resample.js';
import {directionToChart,lonLatToDirection} from '../web/field/chart.js';

export const DEFAULT_FIXTURE=(process.env.SOLAR_DATA||'data')+'/fixtures/tour';
// url -> {bin,bytes} for every recorded tile.
export function indexFixtures(dir=DEFAULT_FIXTURE){
 const idx=new Map();
 for(const host of readdirSync(dir)){
  const hd=join(dir,host);if(!statSync(hd).isDirectory())continue;
  for(const d of readdirSync(hd)){
   const dd=join(hd,d);if(!statSync(dd).isDirectory())continue;
   for(const f of readdirSync(dd))if(f.endsWith('.json')){
    const m=JSON.parse(readFileSync(join(dd,f),'utf8'));if(m.status!==200)continue;
    idx.set(m.url,{bin:join(dd,f.slice(0,-5)+'.bin'),bytes:m.bytes,type:m.contentType});
   }
  }
 }
 return idx;
}
const D2R=Math.PI/180;
export function pageAt(lonDeg,latDeg,level){const c=directionToChart(lonLatToDirection(lonDeg*D2R,latDeg*D2R)),n=2**level,cl=v=>Math.min(n-1,Math.max(0,Math.floor((v+1)/2*n)));return {face:c.face,level,x:cl(c.u),y:cl(c.v)};}
// Decoded-tile provider over the recorded files. prepare(list) must be awaited before get() sees JPEGs.
export function makeProvider(idx){
 const cache=new Map(),jpegDir=join(tmpdir(),'solar-bench-jpeg');mkdirSync(jpegDir,{recursive:true});
 const urlOf=(s,z,x,y)=>s.tileUrl(z,x,y);
 const has=(s,z,x,y)=>idx.has(urlOf(s,z,x,y));
 async function prepare(list){ // list: [{source,z,x,y}]
  const jpegs=[];
  for(const n of list){
   const key=`${n.source.id}/${n.z}/${n.x}/${n.y}`;if(cache.has(key))continue;
   const e=idx.get(urlOf(n.source,n.z,n.x,n.y));if(!e){cache.set(key,null);continue;}
   if(n.source.decoder==='terrarium'){cache.set(key,await decodeTerrarium(readFileSync(e.bin)));continue;}
   const out=join(jpegDir,e.bin.replace(/[^A-Za-z0-9]/g,'_').slice(-90)+'.rgba');
   if(!existsSync(out))jpegs.push([e.bin,out]);
   cache.set(key,{pending:out});
  }
  if(jpegs.length){
   const py=`import sys,json\nfrom PIL import Image\nfor a,b in json.load(sys.stdin):\n im=Image.open(a).convert('RGBA');assert im.size==(256,256),im.size\n open(b,'wb').write(im.tobytes())\n`;
   const r=spawnSync('python',['-I','-c',py],{input:JSON.stringify(jpegs),encoding:'utf8'});
   if(r.status!==0)throw Error('python PIL JPEG decode failed: '+r.stderr);
  }
  for(const [k,v] of cache)if(v?.pending){const b=readFileSync(v.pending);cache.set(k,{width:256,height:256,rgba:new Uint8Array(b.buffer,b.byteOffset,b.byteLength)});}
 }
 return {has,prepare,get:(s,z,x,y)=>cache.get(`${s.id}/${z}/${x}/${y}`)||null,size:()=>cache.size};
}
// First page near (lon,lat) at `level` whose required tiles are all recorded.
export function findPage(level,lon,lat,tilesFor,has){
 for(let r=0;r<40;r++)for(let a=-r;a<=r;a++)for(let b=-r;b<=r;b++){
  if(Math.max(Math.abs(a),Math.abs(b))!==r)continue;
  const p0=pageAt(lon,lat,level),p={...p0,x:p0.x+a,y:p0.y+b};
  if(p.x<0||p.y<0||p.x>=2**level||p.y>=2**level)continue;
  const need=tilesFor(p);if(need.length&&need.every(n=>has(n.source,n.z,n.x,n.y)))return {page:p,need};
 }
 return null;
}
const time=(fn,reps)=>{fn();const ts=[];for(let k=0;k<reps;k++){const t0=performance.now();fn();ts.push(performance.now()-t0);}ts.sort((a,b)=>a-b);return {mean:ts.reduce((s,v)=>s+v,0)/ts.length,p50:ts[ts.length>>1],min:ts[0]};};
export async function runBench(dir=DEFAULT_FIXTURE,reps=20){
 const idx=indexFixtures(dir),prov=makeProvider(idx),out={};
 // cur.* = web/field/resample.js (after); bare names = the verbatim reference above (before)
 const T0={...SOURCES.terrarium,zoomBias:0},EOX=SOURCES.eox,SW=SOURCES.swissimage;
 const cases=[
  ['D11 height (zoom bias 0)',11,6.63,46.52,p=>cur.requiredTiles(p,T0).map(t=>({source:T0,...t})),(p,g)=>cur.buildHeightPage(p,g,T0),(p,g)=>buildHeightPage(p,g,T0)],
  ['D11 height (terrarium zoomBias as shipped)',11,6.63,46.52,p=>cur.requiredTiles(p,SOURCES.terrarium).map(t=>({source:SOURCES.terrarium,...t})),(p,g)=>cur.buildHeightPage(p,g,SOURCES.terrarium),null],
  ['D12 albedo',12,6.63,46.52,p=>cur.requiredTiles(p,EOX).map(t=>({source:EOX,...t})),(p,g)=>cur.buildAlbedoPage(p,g,EOX),(p,g)=>buildAlbedoPage(p,g,EOX)],
  ['D12 overlay albedo',12,6.63,46.52,p=>cur.overlayTiles(p,EOX,SW),(p,g)=>cur.buildOverlayAlbedoPage(p,g,EOX,SW),(p,g)=>buildOverlayAlbedoPage(p,g,EOX,SW)],
 ];
 for(const [name,level,lon,lat,need,fnNew,fnOld] of cases){
  const f=findPage(level,lon,lat,need,prov.has);
  if(!f){console.log(`${name}: no page with all tiles recorded near ${lon},${lat}`);continue;}
  await prov.prepare(f.need);
  const g=(s,z,x,y)=>prov.get(s,z,x,y);
  const now=time(()=>fnNew(f.page,g),reps),old=fnOld?time(()=>fnOld(f.page,g),reps):null;
  const r=fnNew(f.page,g);
  out[name]={page:f.page,tiles:f.need.length,zoom:r.zoom,missing:!!r.missing,now,old};
  console.log(`${name}: page ${JSON.stringify(f.page)} ${f.need.length} tiles zoom ${r.zoom}${r.missing?' MISSING '+r.reason:''}  before ${old?old.mean.toFixed(2)+' ms (p50 '+old.p50.toFixed(2)+')':'n/a'}  after ${now.mean.toFixed(2)} ms (p50 ${now.p50.toFixed(2)})`);
 }
 return out;
}
// Fetch volume: for the same set of pages, bytes of the distinct Terrarium tiles needed at zoom bias 0 against -1,
// using the recorded size of each tile. Only pages whose tiles are all recorded at BOTH settings count.
export function fetchVolume(dir=DEFAULT_FIXTURE){
 const idx=indexFixtures(dir),T0={...SOURCES.terrarium,zoomBias:0},T1={...SOURCES.terrarium,zoomBias:-1};
 const has=(s,t)=>idx.has(s.tileUrl(t.z,t.x,t.y));
 const sets=[new Map(),new Map()],pagesUsed=[];let tried=0;
 for(const level of [8,9,10,11])for(let i=0;i<16;i++)for(let j=0;j<16;j++){
  const lon=5.9+i*0.3,lat=45.5+j*0.15,p=pageAt(lon,lat,level);tried++;
  const a=cur.requiredTiles(p,T0),b=cur.requiredTiles(p,T1);
  if(!a.length||!b.length||!a.every(t=>has(T0,t))||!b.every(t=>has(T1,t)))continue;
  pagesUsed.push(p);
  for(const [k,list] of [[0,a],[1,b]])for(const t of list)sets[k].set(`${t.z}/${t.x}/${t.y}`,idx.get(T0.tileUrl(t.z,t.x,t.y)).bytes);
 }
 const sum=m=>[...m.values()].reduce((s,v)=>s+v,0);
 return {tried,pages:pagesUsed.length,tiles0:sets[0].size,tiles1:sets[1].size,bytes0:sum(sets[0]),bytes1:sum(sets[1])};
}
// ---- main
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const dir=process.argv[2]||DEFAULT_FIXTURE;
 console.log(`field page build, Node ${process.version}, fixtures ${dir}`);
 await runBench(dir);
 const v=fetchVolume(dir);
 console.log(`terrarium fetch volume on ${v.pages} recorded-complete pages: zoomBias 0 ${v.tiles0} tiles ${(v.bytes0/1e6).toFixed(2)} MB; zoomBias -1 ${v.tiles1} tiles ${(v.bytes1/1e6).toFixed(2)} MB; ratio ${(v.bytes0/Math.max(1,v.bytes1)).toFixed(2)}x`);
}
