// The water layer: one canonical description of where water is, independent of the terrain's heights, and the water
// pages built from it (docs/WATER-LAYER.md, docs/DECISION.md "Water as its own layer").
//
// Water is the union of bodies: the map's polygons (OpenMapTiles water layer: ocean, lake, pond, dock, river) and the
// river network's centreline channels where no polygon holds the reach (rivers.js). Where two bodies touch, the edge
// between them is inside the union, not a shore: a shore piece is an edge piece with no water just beyond it. A point
// query answers whether water holds the point, the signed distance to the union's edge in metres (exact: the distance
// to the nearest shore piece, a straight segment), the level, the flow and the body's kind.
//
// A water page carries, per texel of the height page's grid (264 x 264, vertex aligned, same positions):
//   R  signed distance to the shore, in 1/SDF_STEPS texel units around 32768 (negative in water), exact within
//      WATER_BAND texels and clamped there: a code at the band means "at least the band" (the encoding holds
//      +-WATER_RANGE)
//   G  level of the water here, or of the nearest water for a dry texel within the band: page offset + scale * code;
//      65535 for none
//   B  low byte: coverage, the share of the texel's area (one texel square about the texel) under water, 0..255;
//      high byte: kind (2 bits: 0 none in reach, 1 sea, 2 still water, 3 river) and fetch (6 bits: 4 log2 metres)
//   A  flow in the page's texel axes, two signed bytes of FLOW_UNIT m/s (low: along i, high: along j)
// Coverage is a box filter of the texel square, so a coarse page is a filtered fine page: a river narrower than a
// texel keeps its share instead of appearing and vanishing as it crosses texel centres.
//
// Bounds. Shore pieces within the page's reach (the band beyond its texels) are binned; every texel takes the exact
// distance to each piece within BIN texels and the rest of the band takes it by propagation of nearest pieces between
// neighbouring texels (8-neighbour sweeps, each candidate distance exact), which can only overestimate. A texel with
// no piece in reach is reported at the band ("at least"), counted as unresolved. Edges and pieces past WATER_LIMITS
// are dropped and counted (overBudget), never silently. Levels of still water are estimates (map-water.js pieceLevel),
// rivers' are the network's position-only level field (rivers.js levelAt, from z14 lines from page level 12 and from
// the page's own tiles' lines below it); where no centreline is in reach a polygon river follows the lowest ground of
// its own within three texels, smoothed, counted as fallbackLevel.
import {PAGE_TEXELS as N} from './chart.js';
import {pieceLevel,insideRings,metresPerMercator} from './map-water.js';
export const WATER_BAND=32,WATER_RANGE=64,SDF_STEPS=512;
// The shore distance every page level agrees on, for the terrain (shapeTerrain): exact at the texels of a level
// WATER_REFERENCE_LEVEL page, bilinear between them on finer pages, at most WATER_FAR_REACH metres. A page's own
// distance stops at its band, 32 texels: 15.6 m on a level 16 page and 250 m on a level 12 one at Leixões, and a sea bed
// shaped from it lay 3.2 m deep on the first and 10 m on the second over the same open sea. Every reader picks its page
// level by distance from the eye, so the sea floor rose toward the camera in steps: a bright shallow disc under the
// camera and a darker band beyond it (the owner's report, 3 November 2026; docs/WATER-LAYER.md).
export const WATER_REFERENCE_LEVEL=11,WATER_FAR_REACH=200;
// Within NEAR_EXACT0 of a shore the page's own exact distance; past NEAR_EXACT1 the reference distance; blended between.
// Every level's band (15.6 m at level 16 and more on coarser pages) holds NEAR_EXACT1.
const NEAR_EXACT0=9,NEAR_EXACT1=15;
export const WATER_KIND=Object.freeze({none:0,sea:1,still:2,river:3});
export const FLOW_UNIT=4/127;
const RIVER_FLOW_SLOPE=0.002;
// Source water this close to sea level is the sea (resample.js SEA_LEVEL_BAND).
const SOURCE_SEA_BAND=1;
export const WATER_LIMITS=Object.freeze({edges:400000,pieces:200000,binRefs:2000000,bodies:64});
const KIND_OF=Object.freeze({ocean:1,lake:2,pond:2,dock:2,river:3});
const BINS_PER_TILE=16,BANDS_PER_TILE=64;
// A clip edge of the tile's buffer, not a shore: both ends on one line outside the tile proper.
const clipEdge=(a,b,e)=>(a[0]===b[0]&&(a[0]<=0||a[0]>=e))||(a[1]===b[1]&&(a[1]<=0||a[1]>=e));
// Manning's formula with n = 0.05 (a rough natural channel), clamped to 3.5 m/s: a look, not a hydraulic model. A
// segment's slope is its fitted reach's; white water starts about 2.5 m/s (water.wgsl), slopes over a few percent.
export const riverSpeed=(slope,depth)=>Math.min(3.5,Math.max(0.05,Math.pow(Math.max(depth,0.1),2/3)*Math.sqrt(Math.max(slope,1e-5))/0.05));
const fetchCode=metres=>Math.max(0,Math.min(63,Math.round(4*Math.log2(Math.max(1,metres)))));

// Polygons of one tile in Mercator with their class, id and the side their water lies on.
export function waterPolygons(tile){
 const layer=tile.layers?.water;if(!layer)return [];
 const e=layer.extent,n=2**tile.z,out=[];
 for(const f of layer.features){
  const cls=f.properties.class,kind=KIND_OF[cls];if(!kind||(f.type!==undefined&&f.type!==3))continue;
  if(f.properties.intermittent===1||f.properties.intermittent===true)continue;
  const rings=[],clips=[];let area=0,perimeter=0;
  for(const ring of f.paths){if(ring.length<3)continue;const r=new Float64Array(ring.length*2),c=new Uint8Array(ring.length);
   for(let i=0;i<ring.length;i++){r[2*i]=(tile.x+ring[i][0]/e)/n;r[2*i+1]=(tile.y+ring[i][1]/e)/n;c[i]=clipEdge(ring[i],ring[(i+1)%ring.length],e)?1:0;}
   rings.push(r);clips.push(c);}
  if(!rings.length)continue;
  const metric=metresPerMercator((tile.y+.5)/n);
  for(const r of rings){const m=r.length/2;for(let i=0,j=m-1;i<m;j=i++){area+=r[2*j]*r[2*i+1]-r[2*i]*r[2*j+1];perimeter+=Math.hypot(r[2*i]-r[2*j],r[2*i+1]-r[2*j+1]);}}
  // MVT v2: exterior rings wind positive in tile coordinates (y down), holes negative, so the polygon's interior lies
  // at (-dy, dx) of every edge. A polygon that does not follow it is flipped after one containment test.
  out.push({id:f.properties.id??f.id??null,cls,kind,rings,clips,tile:{z:tile.z,x:tile.x,y:tile.y},size:perimeter>0?Math.abs(area)/perimeter*metric:0,inward:1});
 }
 return out;
}
function tileKey(tile){let h=2166136261;const l=tile.layers?.water;if(l){h=Math.imul(h^l.features.length,16777619);for(const f of l.features){h=Math.imul(h^(f.paths.length|0),16777619);for(const p of f.paths){h=Math.imul(h^p.length,16777619);if(p.length){h=Math.imul(h^(p[0][0]|0),16777619);h=Math.imul(h^(p[0][1]|0),16777619);}}}}return `${tile.z}/${tile.x}/${tile.y}/${h>>>0}`;}

// The map's water bodies over a set of tiles of one zoom: polygons, their containment test and levels. A pure
// function of the tiles and the DEM sampler, cached per worker (bodies are shared by every page over the same tiles).
// sample(x,y): {h, water} as map-water.js pieceLevel reads it, for still levels; samplerKey names it.
const bodyCache=new Map();
export function waterBodies(tiles,sample,{seaLevel=0,samplerKey='dem'}={}){
 const list=tiles.filter(t=>t?.layers);const z=list.length?list[0].z:null;
 const key=list.filter(t=>t.z===z).map(tileKey).sort().join('|')+'#'+samplerKey+'#'+seaLevel;
 const known=bodyCache.get(key);if(known){bodyCache.delete(key);bodyCache.set(key,known);return known;}
 const stats={tiles:0,polygons:0,sea:0,still:0,riverPolygons:0,edges:0,overBudget:0,disagreeing:0,openToSea:0,flipped:0,estimated:{source:0,flat:0,shore:0,sea:0,none:0}};
 const polys=[],byTile=new Map();
 for(const tile of list){if(tile.z!==z)continue;stats.tiles++;const n=2**z;
  const own=[];for(const p of waterPolygons(tile)){p.index=polys.length;polys.push(p);own.push(p.index);stats.polygons++;if(p.kind===1)stats.sea++;else if(p.kind===2)stats.still++;else stats.riverPolygons++;}
  byTile.set(tile.y*n+tile.x,own);}
 const n=z===null?1:2**z,step=1/(n*BINS_PER_TILE);
 // Bin keys relative to the tiles' corner: small integers.
 let tx0=Infinity,ty0=Infinity;for(const tk of byTile.keys()){tx0=Math.min(tx0,tk%n);ty0=Math.min(ty0,Math.floor(tk/n));}
 const kx0=(tx0-2)*BINS_PER_TILE,ky0=(ty0-2)*BINS_PER_TILE,binKey=(bx,by)=>{const a=bx-kx0,b=by-ky0;return a<0||b<0||a>=16384||b>=16384?-1:a*16384+b;};
 // Row bands per tile for the parity test: every edge of the tile's polygons, clip edges too, so rings close.
 const EA=[],bands=new Map(),crossed=new Set();
 for(const [tk,own] of byTile){const ty=Math.floor(tk/n),tx=tk-ty*n,bandOf=y=>Math.floor((y*n-ty)*BANDS_PER_TILE);
  for(const pi of own){const p=polys[pi];
   for(let ri=0;ri<p.rings.length;ri++){const r=p.rings[ri],m=r.length/2;
    for(let i=0;i<m;i++){
     if(EA.length/5>=WATER_LIMITS.edges){stats.overBudget++;break;}
     const j=(i+1)%m,ax=r[2*i],ay=r[2*i+1],bx=r[2*j],by=r[2*j+1];if(ax===bx&&ay===by)continue;
     const e=EA.length/5;EA.push(ax,ay,bx,by,pi);if(!p.clips[ri][i])stats.edges++;
     const b0=Math.max(0,bandOf(Math.min(ay,by))),b1=Math.min(BANDS_PER_TILE-1,bandOf(Math.max(ay,by)));
     for(let b=b0;b<=b1;b++){const k=tk*BANDS_PER_TILE+b;let l=bands.get(k);if(!l)bands.set(k,l=[]);l.push(e);}
     const cx0=Math.max(tx*BINS_PER_TILE,Math.floor(Math.min(ax,bx)/step)),cx1=Math.min(tx*BINS_PER_TILE+BINS_PER_TILE-1,Math.floor(Math.max(ax,bx)/step));
     const cy0=Math.max(ty*BINS_PER_TILE,Math.floor(Math.min(ay,by)/step)),cy1=Math.min(ty*BINS_PER_TILE+BINS_PER_TILE-1,Math.floor(Math.max(ay,by)/step));
     for(let y=cy0;y<=cy1;y++)for(let x=cx0;x<=cx1;x++)crossed.add(binKey(x,y));
    }
   }
  }
 }
 const E=Float64Array.from(EA),parity=new Uint8Array(polys.length),touched=[],constant=new Map();
 // The polygon holding (x,y) on its own tile, or -1. Still water before rivers before the sea where they overlap.
 const rank=p=>p.kind===2?3:p.kind===3?2:1;
 function exactHolder(x,y){
  const tx=Math.floor(x*n),ty=Math.floor(y*n),tk=ty*n+((tx%n)+n)%n;
  const list=bands.get(tk*BANDS_PER_TILE+Math.min(BANDS_PER_TILE-1,Math.max(0,Math.floor((y*n-ty)*BANDS_PER_TILE))));if(!list)return -1;
  for(const e of list){const o=e*5,ay=E[o+1],by=E[o+3];if((ay>y)!==(by>y)){const ax=E[o],bx=E[o+2];if(x<ax+(y-ay)*(bx-ax)/(by-ay)){const p=E[o+4];if(!parity[p])touched.push(p);parity[p]^=1;}}}
  let best=-1;for(const p of touched){if(parity[p]&&(best<0||rank(polys[p])>rank(polys[best])))best=p;parity[p]=0;}touched.length=0;return best;
 }
 // A bin no edge crosses has one answer, computed once at its centre (a test fails if it is not: see
 // Test-Water-Layer-Logic, 'holder bins').
 function holder(x,y){const bx=Math.floor(x/step),by=Math.floor(y/step),bk=binKey(bx,by);if(bk<0||crossed.has(bk))return exactHolder(x,y);let v=constant.get(bk);if(v===undefined){v=exactHolder((bx+.5)*step,(by+.5)*step);constant.set(bk,v);}return v;}
 // Orientation: one test per polygon, at its longest non-clip edge inside its own tile.
 for(const p of polys){let best=-1,bl=0,br=0;for(let ri=0;ri<p.rings.length;ri++){const r=p.rings[ri],m=r.length/2;for(let i=0;i<m;i++){if(p.clips[ri][i])continue;const j=(i+1)%m,l=Math.hypot(r[2*j]-r[2*i],r[2*j+1]-r[2*i+1]);if(l>bl){bl=l;best=i;br=ri;}}}
  if(best<0)continue;const r=p.rings[br],m=r.length/2,j=(best+1)%m,ax=r[2*best],ay=r[2*best+1],dx=r[2*j]-ax,dy=r[2*j+1]-ay,l=Math.hypot(dx,dy),d=Math.min(.25*l,.05/metresPerMercator(ay));
  const qx=ax+dx/2-dy/l*d,qy=ay+dy/2+dx/l*d;if(Math.floor(qx*n)!==p.tile.x||Math.floor(qy*n)!==p.tile.y)continue;
  if(!insideRings(p.rings,qx,qy)){p.inward=-1;stats.flipped++;}}
 // Still water open to the sea: an edge with an ocean polygon just beyond it (midpoints, strided to bound the work).
 const open=new Set();
 for(const p of polys){if(p.kind!==2)continue;let count=0;for(const r of p.rings)count+=r.length/2;const stride=Math.max(1,Math.ceil(count/512));let k=0;
  for(let ri=0;ri<p.rings.length&&!open.has(p.index);ri++){const r=p.rings[ri],m=r.length/2;for(let i=0;i<m;i++,k++){if(k%stride||p.clips[ri][i])continue;const j=(i+1)%m,ax=r[2*i],ay=r[2*i+1],dx=r[2*j]-ax,dy=r[2*j+1]-ay,l=Math.hypot(dx,dy);if(!l)continue;
   const d=.1/metresPerMercator(ay),qx=ax+dx/2+dy/l*d*p.inward,qy=ay+dy/2-dx/l*d*p.inward,h=holder(qx,qy);if(h>=0&&polys[h].kind===1){open.add(p.index);break;}}}}
 // Levels of still water: one per OSM id, the weighted median of its pieces (map-water.js); water open to the sea
 // stands no higher than the sea.
 const ids=new Map();
 for(const p of polys){if(p.kind!==2)continue;p.piece=pieceLevel(p.tile,p,sample);stats.estimated[p.piece.how]++;if(p.id!==null&&p.piece.weight>0){const l=ids.get(p.id)||[];l.push(p.piece);ids.set(p.id,l);}}
 const idLevel=new Map();for(const [id,l] of ids){l.sort((a,b)=>a.level-b.level);const total=l.reduce((s,p)=>s+p.weight,0);let acc=0,level=l[0].level;for(const p of l){acc+=p.weight;if(acc>=total/2){level=p.level;break;}}idLevel.set(id,level);if(l.at(-1).level-l[0].level>.5)stats.disagreeing++;}
 const openIds=new Set([...open].map(i=>polys[i].id).filter(v=>v!==null));
 for(const p of polys){
  if(p.kind===1){p.level=seaLevel;continue;}
  if(p.kind!==2){p.level=NaN;continue;}
  p.level=p.id!==null&&idLevel.has(p.id)?idLevel.get(p.id):p.piece.level;
  if(open.has(p.index)||(p.id!==null&&openIds.has(p.id))){stats.openToSea++;if(!(p.level<=seaLevel))p.level=seaLevel;}
 }
 const out={stats,polys,holder,z,n,E,empty:!polys.length};
 bodyCache.set(key,out);while(bodyCache.size>48)bodyCache.delete(bodyCache.keys().next().value);
 return out;
}

// The union of a page's bodies and its river network's channels (segments no polygon holds, rivers.js).
// sourceSea (optional, sourceSea() below): the source's sea where the page has no map, one more body after the map's.
export function waterUnion(bodies,rivers,sourceSea=null){
 const channels=[];if(rivers?.segments)for(const s of rivers.segments)if(!s.mapped)channels.push(s);
 const channelAt=(x,y)=>{if(!channels.length)return null;const s=rivers.sample(x,y);return s&&s.sdf<0?s:null;};
 let polys=bodies.polys,holder=bodies.holder,sea=null;
 if(sourceSea){sea={id:null,cls:'ocean',kind:1,rings:[],clips:[],tile:{z:0,x:0,y:0},size:1e6,inward:1,index:polys.length,level:sourceSea.level,source:true};polys=[...polys,sea];
  holder=(x,y)=>{const h=bodies.holder(x,y);return h>=0?h:sourceSea.phiAt(x,y)>0?sea.index:-1;};}
 // Levels and flow of river water (polygon or channel) come from the network's position-only level field (levelAt).
 return {...bodies,polys,holder,channels,channelAt,sourceSea,sourceSeaBody:sea,wetAt:(x,y)=>holder(x,y)>=0||channelAt(x,y)!==null,sampleRiver:rivers?.levelAt?(x,y)=>rivers.levelAt(x,y):null,empty:bodies.empty&&!channels.length&&!sea};
}
// The source's sea as a body, where a page has no map (below MAP_WATER_MIN_LEVEL, or every vector tile missing): the
// wet mask of sea pixels (water-steps.js, within seaBand of sea level) blurred with a Gaussian of sigma pixels, as the
// old shore was drawn, sampled at pixel centres; inside where the bilinear blur is positive, and its shore the same
// field's zero contour by marching squares, so the two agree. wetPixel(i,j): whether source pixel (i,j) of zoom size
// (pixels across the world) is sea. box: Mercator [x0,y0,x1,y1] the page reaches. Bounded by maxPixels (counted).
// wetLevel(i,j): the source's water level at pixel (i,j) (the sea, or a lake water.js found), NaN where dry. The body
// takes each point's level as the blur-weighted mean of the wet pixels about it (levelAt), as the old shore did.
export function sourceSea(wetLevel,size,box,{sigma=0.6,maxPixels=4194304}={}){
 const i0=Math.floor(box[0]*size-.5)-3,j0=Math.floor(box[1]*size-.5)-3,w=Math.floor(box[2]*size-.5)+5-i0,h=Math.floor(box[3]*size-.5)+5-j0;
 if(w<=0||h<=0||w*h>maxPixels)return null;
 const wet=new Float32Array(w*h),lv=new Float32Array(w*h);let any=false;for(let j=0;j<h;j++)for(let i=0;i<w;i++){const v=wetLevel(i0+i,j0+j),k=j*w+i;wet[k]=v===v?1:-1;lv[k]=v;if(v===v)any=true;}
 if(!any)return null;
 const g=[-2,-1,0,1,2].map(d=>Math.exp(-d*d/(2*sigma*sigma))),gs=g.reduce((a,b)=>a+b,0),tmp=new Float32Array(w*h),phi=new Float32Array(w*h);
 for(let j=0;j<h;j++)for(let i=0;i<w;i++){let s=0;for(let d=-2;d<=2;d++){const a=Math.min(w-1,Math.max(0,i+d));s+=g[d+2]*wet[j*w+a];}tmp[j*w+i]=s/gs;}
 for(let j=0;j<h;j++)for(let i=0;i<w;i++){let s=0;for(let d=-2;d<=2;d++){const b=Math.min(h-1,Math.max(0,j+d));s+=g[d+2]*tmp[b*w+i];}phi[j*w+i]=s/gs;}
 const at=(i,j)=>phi[Math.min(h-1,Math.max(0,j))*w+Math.min(w-1,Math.max(0,i))];
 const phiAt=(x,y)=>{const px=x*size-.5-i0,py=y*size-.5-j0,a=Math.floor(px),b=Math.floor(py),fx=px-a,fy=py-b;if(a<0||b<0||a>=w-1||b>=h-1)return -1;
  return (at(a,b)*(1-fx)+at(a+1,b)*fx)*(1-fy)+(at(a,b+1)*(1-fx)+at(a+1,b+1)*fx)*fy;};
 // Marching squares over cells between pixel centres; a saddle is split by the cell's mean.
 const segments=()=>{const out=[],P=(i,j)=>[(i0+i+.5)/size,(j0+j+.5)/size];
  const cut=(i,j,k)=>{const c=[[i,j],[i+1,j],[i+1,j+1],[i,j+1]],a=c[k],b=c[(k+1)%4],va=at(...a),vb=at(...b),t=va/(va-vb),pa=P(...a),pb=P(...b);return [pa[0]+(pb[0]-pa[0])*t,pa[1]+(pb[1]-pa[1])*t];};
  for(let j=0;j<h-1;j++)for(let i=0;i<w-1;i++){const v=[at(i,j),at(i+1,j),at(i+1,j+1),at(i,j+1)],s=v.map(x=>x>0?1:0),code=s[0]|s[1]<<1|s[2]<<2|s[3]<<3;if(code===0||code===15)continue;
   const edges=[0,1,2,3].filter(k=>s[k]!==s[(k+1)%4]);
   if(edges.length===2){const a=cut(i,j,edges[0]),b=cut(i,j,edges[1]);out.push(a[0],a[1],b[0],b[1]);}
   else{const m=(v[0]+v[1]+v[2]+v[3])/4,pair=(m>0)===(s[0]===1)?[[0,3],[1,2]]:[[0,1],[2,3]];for(const [e1,e2] of pair){const a=cut(i,j,e1),b=cut(i,j,e2);out.push(a[0],a[1],b[0],b[1]);}}}
  return out;};
 const levelAt=(x,y)=>{const px=x*size-.5-i0,py=y*size-.5-j0,a=Math.floor(px),b=Math.floor(py);let sw=0,sl=0;
  for(let q=-1;q<=2;q++)for(let p=-1;p<=2;p++){const i=a+p,j=b+q;if(i<0||j<0||i>=w||j>=h)continue;const k=j*w+i;if(wet[k]<0)continue;const dx=i-px,dy=j-py,g=Math.exp(-(dx*dx+dy*dy)/(2*sigma*sigma));sw+=g;sl+=g*lv[k];}
  if(sw>0)return sl/sw;let best=Infinity,v=NaN;for(let q=-3;q<=3;q++)for(let p=-3;p<=3;p++){const i=a+p,j=b+q;if(i<0||j<0||i>=w||j>=h)continue;const k=j*w+i;if(wet[k]<0)continue;const d=p*p+q*q;if(d<best){best=d;v=lv[k];}}return v;};
 return {phiAt,segments,levelAt,level:0,pixels:w*h};
}

// Shore pieces within a Mercator box: polygon edges in their own tile proper and channel outlines, split into pieces
// no longer than len metres; a piece is a shore when the point eps outward from its middle holds no water.
function shorePieces(union,box,len,stats){
 const PX=[],owner=[],segs=[];const {polys,n}=union;
 const push=(ax,ay,bx,by,o,seg=null)=>{if(owner.length>=WATER_LIMITS.pieces){stats.overBudget++;return;}PX.push(ax,ay,bx,by);owner.push(o);segs.push(seg);};
 const near=(ax,ay,bx,by)=>!(Math.max(ax,bx)<box[0]||Math.min(ax,bx)>box[2]||Math.max(ay,by)<box[1]||Math.min(ay,by)>box[3]);
 for(const p of polys){const t=p.tile,x0=t.x/n,x1=(t.x+1)/n,y0=t.y/n,y1=(t.y+1)/n;
  if(x1<box[0]||x0>box[2]||y1<box[1]||y0>box[3])continue;
  for(let ri=0;ri<p.rings.length;ri++){const r=p.rings[ri],c=p.clips[ri],m=r.length/2;
   for(let i=0;i<m;i++){if(c[i])continue;const j=(i+1)%m,ax=r[2*i],ay=r[2*i+1],bx=r[2*j],by=r[2*j+1];if(ax===bx&&ay===by||!near(ax,ay,bx,by))continue;
    const metric=metresPerMercator((ay+by)/2),lm=Math.hypot(bx-ax,by-ay),k=Math.max(1,Math.ceil(lm*metric/len)),ox=(by-ay)/lm*p.inward,oy=-(bx-ax)/lm*p.inward;
    // Outward offset: a fraction of a piece and under a decimetre, smaller than any gap the map means.
    const eps=Math.min(.1,.25*len)/metric;
    // Consecutive shore pieces of one edge are merged back into one segment: the distance to their union is the same.
    // Where an edge goes from shore to water (another body begins beyond it), the change is found by bisection to
    // 1/64 of a piece, so a seam's end is placed to under 1/200 texel, not to the piece.
    const wetBeyond=t=>{const x=ax+(bx-ax)*t+ox*eps,y=ay+(by-ay)*t+oy*eps,h=union.holder(x,y);return (h>=0&&h!==p.index)||!!union.channelAt(x,y);};
    const change=(ta,tb,wa)=>{for(let it=0;it<6;it++){const tm=(ta+tb)/2;if(wetBeyond(tm)===wa)ta=tm;else tb=tm;}return (ta+tb)/2;};
    let run=-1,prev=null,prevT=0;
    const close=end=>{if(run<0)return;push(ax+(bx-ax)*run,ay+(by-ay)*run,ax+(bx-ax)*end,ay+(by-ay)*end,p.index);run=-1;};
    for(let s=0;s<k;s++){const t0=s/k,t1=(s+1)/k,tm=(t0+t1)/2,px=ax+(bx-ax)*t0,py=ay+(by-ay)*t0,qx=ax+(bx-ax)*t1,qy=ay+(by-ay)*t1,mx=(px+qx)/2,my=(py+qy)/2;
     // Only the tile proper's copy of an edge: a neighbour tile's buffer repeats it.
     if(mx<x0||mx>=x1||my<y0||my>=y1||!near(px,py,qx,qy)){close(t0);prev=null;continue;}
     stats.pieces++;const wet=wetBeyond(tm);
     if(wet){stats.wetPieces++;if(prev===false)close(change(prevT,tm,false));else close(t0);}
     else if(run<0)run=prev===true?change(prevT,tm,true):t0;
     prev=wet;prevT=tm;}
    close(1);
   }
  }
 }
 // The source's sea where the page has no map: its zero contour, pieces whose outward side holds no other water.
 if(union.sourceSea&&union.sourceSeaBody){const seg=union.sourceSea.segments(),own=union.sourceSeaBody.index;
  for(let q=0;q<seg.length;q+=4){const ax=seg[q],ay=seg[q+1],bx=seg[q+2],by=seg[q+3];if(!near(ax,ay,bx,by))continue;stats.pieces++;
   const mx=(ax+bx)/2,my=(ay+by)/2,l=Math.hypot(bx-ax,by-ay)||1e-12,eps=Math.min(.1,.25*len)/metresPerMercator(my),nx=-(by-ay)/l*eps,ny=(bx-ax)/l*eps;
   const out=union.sourceSea.phiAt(mx+nx,my+ny)>0?[mx-nx,my-ny]:[mx+nx,my+ny],h=union.holder(out[0],out[1]);
   if((h>=0&&h!==own)||union.channelAt(out[0],out[1])){stats.wetPieces++;continue;}
   push(ax,ay,bx,by,own);}}
 // Channel outlines: both sides at the channel's half width and the round ends, as rivers.js sample() draws them.
 for(const s of union.channels){const pad=(s.width+1)/s.metric;if(Math.max(s.a[0],s.b[0])+pad<box[0]||Math.min(s.a[0],s.b[0])-pad>box[2]||Math.max(s.a[1],s.b[1])+pad<box[1]||Math.min(s.a[1],s.b[1])-pad>box[3])continue;
  const L=Math.sqrt(s.length2),lm=L*s.metric,ux=s.dx/L,uy=s.dy/L,nx=-uy,ny=ux;
  const half=t=>{const e=Math.min(1,s.ea+t*(s.eb-s.ea));return (s.wa+t*(s.wb-s.wa))*e*(2-e);};
  // A channel of no width holds no water and has no shore (rivers.js tapers a run with two free ends to nothing).
  if(Math.max(half(0),half(.5),half(1))<.01)continue;
  const k=Math.max(1,Math.ceil(lm/len)),pts=[];
  for(const side of [1,-1]){let prev=null;for(let i=0;i<=k;i++){const t=i/k,hw=half(t),w=hw/s.metric,x=s.a[0]+s.dx*t+nx*w*side,y=s.a[1]+s.dy*t+ny*w*side;if(prev&&(hw>=.01||prev[2]>=.01))pts.push(prev[0],prev[1],x,y);else if(prev)pts.push(NaN,NaN,NaN,NaN);prev=[x,y,hw];}pts.push(NaN,NaN,NaN,NaN);}
  for(const [end,t,dir] of [[s.a,0,-1],[s.b,1,1]]){const w=half(t);if(w<=0)continue;const m=Math.max(2,Math.ceil(Math.PI*w/len));let prev=null;
   for(let i=0;i<=m;i++){const a=-Math.PI/2+Math.PI*i/m,cx=Math.cos(a)*dir,cy=Math.sin(a),x=end[0]+(ux*cx+nx*cy)*w/s.metric,y=end[1]+(uy*cx+ny*cy)*w/s.metric;if(prev)pts.push(prev[0],prev[1],x,y);prev=[x,y];}}
  // A side's consecutive shore pieces merge into one segment where the side is straight (the half width linear: no
  // taper toward a free end); a NaN row ends a side, and caps are never merged.
  const straight=s.ea>=1&&s.eb>=1;let run=null;
  const close=()=>{if(run){push(run[0],run[1],run[2],run[3],-1,s);stats.channelPieces++;run=null;}};
  for(let q=0;q<pts.length;q+=4){const ax=pts[q],ay=pts[q+1],bx=pts[q+2],by=pts[q+3];if(ax!==ax||!near(ax,ay,bx,by)){close();continue;}const mx=(ax+bx)/2,my=(ay+by)/2,eps=Math.min(.1,.25*len)/s.metric;
   // Outward: away from the segment's nearest point.
   const t=Math.max(0,Math.min(1,((mx-s.a[0])*s.dx+(my-s.a[1])*s.dy)/s.length2)),cx=s.a[0]+s.dx*t,cy=s.a[1]+s.dy*t,dl=Math.hypot(mx-cx,my-cy)||1e-12;
   const qx=mx+(mx-cx)/dl*eps,qy=my+(my-cy)/dl*eps;stats.pieces++;
   if(union.holder(qx,qy)>=0||union.channelAt(qx,qy)){stats.wetPieces++;close();continue;}
   const cap=q>=(2*k+2)*4;
   if(straight&&!cap&&run&&run[2]===ax&&run[3]===ay){run[2]=bx;run[3]=by;continue;}
   close();run=[ax,ay,bx,by];if(!straight||cap)close();}
  close();
 }
 return {P:Float64Array.from(PX),owner:Int32Array.from(owner),segs};
}

// Nearest shore piece over a grid of side x side points (EX, EY): exact for every point within BIN cells of a piece
// (pieces binned with a pad of one bin), then propagated through the grid by three sweeps of 8-neighbour propagation,
// each candidate an exact distance to a real piece. NEAR: the piece, or -1; DM: squared Mercator distance, Infinity
// where no piece reached.
function nearestShore(P,count,EX,EY,side,box,cellM,stats,NEAR,DM,tick=()=>{}){
 const ME=side*side;NEAR.fill(-1,0,ME);DM.fill(Infinity,0,ME);
 const BIN=4,bs=BIN*cellM,BW=Math.max(1,Math.ceil((box[2]-box[0])/bs)),BH=Math.max(1,Math.ceil((box[3]-box[1])/bs));
 if(!count||BW*BH>1<<22)return;
 const heads=new Int32Array(BW*BH).fill(-1),next=[],ref=[];
 for(let i=0;i<count;i++){const o=i*4,ax=P[o],ay=P[o+1],qx=P[o+2],qy=P[o+3];
  const x0=Math.floor((Math.min(ax,qx)-box[0])/bs)-1,x1=Math.floor((Math.max(ax,qx)-box[0])/bs)+1,y0=Math.floor((Math.min(ay,qy)-box[1])/bs)-1,y1=Math.floor((Math.max(ay,qy)-box[1])/bs)+1;
  for(let b=Math.max(0,y0);b<=Math.min(BH-1,y1);b++)for(let a=Math.max(0,x0);a<=Math.min(BW-1,x1);a++){if(ref.length>=WATER_LIMITS.binRefs){stats.overBudget++;break;}const c=b*BW+a;next.push(heads[c]);ref.push(i);heads[c]=next.length-1;}}
 for(let k=0;k<ME;k++){const a=Math.floor((EX[k]-box[0])/bs),b=Math.floor((EY[k]-box[1])/bs);if(a<0||b<0||a>=BW||b>=BH)continue;
  let best=Infinity,bi=-1;for(let r=heads[b*BW+a];r>=0;r=next[r]){const i=ref[r],d=pieceDistance(P,i,EX[k],EY[k]);if(d<best){best=d;bi=i;}}
  if(bi>=0){NEAR[k]=bi;DM[k]=best;stats.exact++;}}
 tick('bins');
 // Two sweeps of 8-neighbour propagation, then a third forward one: candidates are exact distances to real pieces.
 // Neighbours already visited in this sweep's order: (i-s,j), (i-s,j-s), (i,j-s), (i+s,j-s).
 const sweep=fwd=>{const s=fwd?1:-1,row=s*side;for(let jj=0;jj<side;jj++){const j=fwd?jj:side-1-jj,up=j-s>=0&&j-s<side;for(let ii=0;ii<side;ii++){const i=fwd?ii:side-1-ii,k=j*side+i,left=i-s>=0&&i-s<side,right=i+s>=0&&i+s<side;
  const x=EX[k],y=EY[k];let own=NEAR[k],best=DM[k],c;
  if(left&&(c=NEAR[k-s])>=0&&c!==own){const d=pieceDistance(P,c,x,y);if(d<best){best=d;own=c;}}
  if(up){if(left&&(c=NEAR[k-row-s])>=0&&c!==own){const d=pieceDistance(P,c,x,y);if(d<best){best=d;own=c;}}
   if((c=NEAR[k-row])>=0&&c!==own){const d=pieceDistance(P,c,x,y);if(d<best){best=d;own=c;}}
   if(right&&(c=NEAR[k-row+s])>=0&&c!==own){const d=pieceDistance(P,c,x,y);if(d<best){best=d;own=c;}}}
  NEAR[k]=own;DM[k]=best;}}};
 sweep(true);sweep(false);sweep(true);
}
// The reference shore distance at every texel of a page finer than WATER_REFERENCE_LEVEL (FD, metres, at most
// WATER_FAR_REACH): exact at the reference grid's nodes, from pieces cut at a quarter of its cell, bilinear between.
// reference (resample.js referenceGrid, asked for only when the page needs it): node positions X, Y (side x side), cell
// (metres) and at(i, j), a texel's place in node units. Any page computes a node from the same positions and the same pieces, so pages agree at every level.
function farShoreDistance(union,reference,FD,stats){
 const {X:RX,Y:RY,side,cell:rc,at}=reference,ME=side*side;
 let bx0=Infinity,by0=Infinity,bx1=-Infinity,by1=-Infinity;for(let k=0;k<ME;k++){bx0=Math.min(bx0,RX[k]);bx1=Math.max(bx1,RX[k]);by0=Math.min(by0,RY[k]);by1=Math.max(by1,RY[k]);}
 const rcM=rc/metresPerMercator(RY[ME>>1]),reach=6*rcM,box=[bx0-reach,by0-reach,bx1+reach,by1+reach];
 const fs={pieces:0,wetPieces:0,channelPieces:0,overBudget:0,exact:0};
 const {P,owner}=shorePieces(union,box,Math.max(.05,rc/4),fs);
 const NEAR=scratch('farnear',Int32Array,ME),DM=scratch('fardm',Float64Array,ME),D=scratch('fard',Float32Array,ME);
 nearestShore(P,owner.length,RX,RY,side,box,rcM,fs,NEAR,DM);
 for(let k=0;k<ME;k++)D[k]=Number.isFinite(DM[k])?Math.min(WATER_FAR_REACH,Math.sqrt(DM[k])*metresPerMercator(RY[k])):WATER_FAR_REACH;
 for(let j=0;j<N;j++)for(let i=0;i<N;i++){const [u,v]=at(i,j),a=Math.max(0,Math.min(side-2,Math.floor(u))),b=Math.max(0,Math.min(side-2,Math.floor(v))),fx=Math.max(0,Math.min(1,u-a)),fy=Math.max(0,Math.min(1,v-b)),c=b*side+a;
  FD[j*N+i]=(D[c]*(1-fx)+D[c+1]*fx)*(1-fy)+(D[c+side]*(1-fx)+D[c+side+1]*fx)*fy;}
 stats.farPieces=fs.pieces;stats.farNodes=ME;stats.overBudget+=fs.overBudget;
}
const SCR={};const scratch=(name,T,len)=>{let a=SCR[name];if(!a||a.length!==len)a=SCR[name]=new T(len);return a;};
// Squared distance from (x,y) to piece i, in Mercator units squared.
function pieceDistance(P,i,x,y){const o=i*4,ax=P[o],ay=P[o+1],dx=P[o+2]-ax,dy=P[o+3]-ay,l=dx*dx+dy*dy,t=l>0?Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/l)):0,ex=x-ax-t*dx,ey=y-ay-t*dy;return ex*ex+ey*ey;}

// The water page of one height page. X, Y: Mercator positions of the 264 x 264 texels (resample.js expandInto, shared
// edges snapped). cell: metres per texel. heights: the page's DEM heights per texel (for the polygon-river fallback).
// Returns null when no water lies within the band of any texel, else {bytes (Uint16Array N*N*4), levelOffset,
// levelScale, uniform, sdf (metres), level, alpha, kind, stats}: the float planes stay in the worker for the terrain.
// The shore's own variation (owner, 4 November 2026: close up the water's edge was the map's polygon, straight segments
// metres to tens of metres long). Within SHORE_WIGGLE_REACH of the shore the signed distance moves by two octaves of
// value noise on a lattice in Mercator units scaled to metres at the equator (WIGGLE_UNIT; so real wavelengths are
// these times the cosine of the latitude, about 17 m and 5 m at 45 degrees): one point moves alike on every page that
// holds it. Each octave fades out where a page's texel is too coarse to carry it, so far views keep the map's edge, and
// rivers move a quarter as far (both banks of a narrow stream move together). Metres; 0 beyond the reach.
const SHORE_WIGGLE_REACH=5,WIGGLE_UNIT=40075016.686,WIGGLE_OCTAVES=Object.freeze([{wave:24,amp:1.8,fade:[2,6],salt:0x51},{wave:7,amp:.6,fade:[.6,1.8],salt:0xa7}]);
function wiggleHash(x,y,salt){let h=(Math.imul(x|0,0x8da6b343)^Math.imul(y|0,0xd8163841)^Math.imul(salt,0xcb1ab31f))>>>0;h^=h>>>16;h=Math.imul(h,0x7feb352d)>>>0;h^=h>>>15;h=Math.imul(h,0x846ca68b)>>>0;h^=h>>>16;return (h>>>8)/8388608-1;}
export function shoreWiggle(x,y,sd,cell,kind){
 const a=Math.abs(sd);if(!(a<SHORE_WIGGLE_REACH))return 0;const t=Math.max(0,Math.min(1,(a-.5*SHORE_WIGGLE_REACH)/(.5*SHORE_WIGGLE_REACH))),near=1-t*t*(3-2*t);
 let out=0;for(const o of WIGGLE_OCTAVES){const f=Math.max(0,Math.min(1,(cell-o.fade[0])/(o.fade[1]-o.fade[0]))),amp=o.amp*(1-f*f*(3-2*f));if(amp<=0)continue;
  const u=x*WIGGLE_UNIT/o.wave,v=y*WIGGLE_UNIT/o.wave,i=Math.floor(u),j=Math.floor(v),fx=u-i,fy=v-j,sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
  const n=(wiggleHash(i,j,o.salt)*(1-sx)+wiggleHash(i+1,j,o.salt)*sx)*(1-sy)+(wiggleHash(i,j+1,o.salt)*(1-sx)+wiggleHash(i+1,j+1,o.salt)*sx)*sy;out+=amp*n;}
 return out*near*(kind===3?.25:1);
}
export function buildWaterPage(union,X,Y,cell,heights,{band=WATER_BAND,extended=null,reference=null}={}){
 const M=N*N,stats={...union.stats,estimated:undefined,texels:0,wet:0,shore:0,pieces:0,wetPieces:0,channelPieces:0,exact:0,unresolved:0,fallbackLevel:0,levelRange:0,ms:0,overBudget:union.stats.overBudget};
 const t0=globalThis.performance?.now()??0,T={},tick=name=>{T[name]=(globalThis.performance?.now()??0);};stats.phases=T;
 const SD=scratch('sd',Float32Array,M),LV=scratch('lv',Float32Array,M),AL=scratch('al',Float32Array,M),KD=scratch('kd',Uint8Array,M),FE=scratch('fe',Uint8Array,M),FU=scratch('fu',Float32Array,M),FV=scratch('fv',Float32Array,M);
 const HOLD=scratch('hold',Int32Array,M);
 const centre=(N>>1)*N+(N>>1),cellM=cell/metresPerMercator(Y[centre]);
 // Distances are propagated over the page grid extended by the band (extended(pad): positions of texels -pad ..
 // N+pad-1), so a shore just beyond the page is found here as it is by the page that holds it: pages agree on the
 // texels they share. The page's own texels keep the page's positions.
 const pad=extended?band+2:0,ext=extended?extended(pad):null,side=N+2*pad,ME=side*side,EX=ext?ext.X:X,EY=ext?ext.Y:Y;
 if(ext)for(let j=0;j<N;j++)for(let i=0;i<N;i++){const e=(j+pad)*side+i+pad;EX[e]=X[j*N+i];EY[e]=Y[j*N+i];}
 const NEAR=scratch('near',Int32Array,ME),DM=scratch('dm',Float64Array,ME);
 let bx0=Infinity,by0=Infinity,bx1=-Infinity,by1=-Infinity;for(let k=0;k<ME;k+=7){bx0=Math.min(bx0,EX[k]);bx1=Math.max(bx1,EX[k]);by0=Math.min(by0,EY[k]);by1=Math.max(by1,EY[k]);}
 for(const k of [ME-1,side-1,ME-side]){bx0=Math.min(bx0,EX[k]);bx1=Math.max(bx1,EX[k]);by0=Math.min(by0,EY[k]);by1=Math.max(by1,EY[k]);}
 const reach=(ext?6:(band+6)*1.5)*cellM,box=[bx0-reach,by0-reach,bx1+reach,by1+reach];
 tick('ext');
 // Containment per texel: polygon (still > river > sea), else a centreline channel (-2), else -1.
 // Channels are found by rasterizing their segments over 8 x 8 texel blocks: a texel is in a channel where its distance
 // to a segment is under that segment's half width there (rivers.js sample().sdf < 0, the same formula). The network
 // itself is asked only at wet texels, for their level and flow.
 let anyWet=false;
 for(let k=0;k<M;k++){const h=union.holder(X[k],Y[k]);HOLD[k]=h;if(h>=0)anyWet=true;}
 const BL=8,NB=Math.ceil(N/BL),blockSegs=union.channels.length?new Array(NB*NB):null;
 if(blockSegs){const BB=new Float64Array(NB*NB*4);for(let c=0;c<NB*NB;c++){BB[c*4]=Infinity;BB[c*4+1]=Infinity;BB[c*4+2]=-Infinity;BB[c*4+3]=-Infinity;}
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){const k=j*N+i,c=((j/BL)|0)*NB+((i/BL)|0),o=c*4;if(X[k]<BB[o])BB[o]=X[k];if(Y[k]<BB[o+1])BB[o+1]=Y[k];if(X[k]>BB[o+2])BB[o+2]=X[k];if(Y[k]>BB[o+3])BB[o+3]=Y[k];}
  // One texel of margin about each block, so coverage samples half a texel out are covered too.
  const m=2*cellM;
  for(let si=0;si<union.channels.length;si++){const g=union.channels[si],w=(Math.max(g.wa,g.wb)+.5)/g.metric,x0=Math.min(g.a[0],g.b[0])-w,x1=Math.max(g.a[0],g.b[0])+w,y0=Math.min(g.a[1],g.b[1])-w,y1=Math.max(g.a[1],g.b[1])+w;
   for(let c=0;c<NB*NB;c++){const o=c*4;if(BB[o]-m>x1||BB[o+2]+m<x0||BB[o+1]-m>y1||BB[o+3]+m<y0)continue;(blockSegs[c]||(blockSegs[c]=[])).push(g);}}}
 const halfAt=(g,t)=>{const e=Math.min(1,g.ea+t*(g.eb-g.ea));return (g.wa+t*(g.wb-g.wa))*e*(2-e);};
 // The least (distance - half width) over a list of segments, metres; negative inside a channel.
 const channelCf=(list,x,y)=>{let best=Infinity;for(const g of list){const t=Math.max(0,Math.min(1,((x-g.a[0])*g.dx+(y-g.a[1])*g.dy)/g.length2)),px=x-g.a[0]-t*g.dx,py=y-g.a[1]-t*g.dy,f=Math.sqrt(px*px+py*py)*g.metric-halfAt(g,t);if(f<best)best=f;}return best;};
 if(blockSegs)for(let c=0;c<NB*NB;c++){const list=blockSegs[c];if(!list)continue;const bi=c%NB,bj=(c-bi)/NB;
  for(let j=bj*BL;j<Math.min(N,bj*BL+BL);j++)for(let i=bi*BL;i<Math.min(N,bi*BL+BL);i++){const k=j*N+i;if(HOLD[k]>=0)continue;if(channelCf(list,X[k],Y[k])<0){HOLD[k]=-2;anyWet=true;}}}
 // Water at a point near texel k: a polygon, or a channel of the texel's block.
 const wetNear=(k,x,y)=>{if(union.holder(x,y)>=0)return true;if(!blockSegs)return false;const i=k%N,j=(k-i)/N,list=blockSegs[((j/BL)|0)*NB+((i/BL)|0)];return !!list&&channelCf(list,x,y)<0;};
 tick('contain');
 const {P,owner,segs:pieceSegs}=shorePieces(union,box,Math.max(.05,cell/4),stats),count=owner.length;
 tick('pieces');
 if(!count&&!anyWet)return null;
 // Nearest piece: exact for every texel within BIN texels of a piece, then propagated through the extended grid.
 nearestShore(P,count,EX,EY,side,box,cellM,stats,NEAR,DM,tick);
 tick('sweeps');
 const nearOf=k=>{const i=k%N,j=(k-i)/N;return (j+pad)*side+i+pad;};
 // Signed distance in metres, clamped to the band: exact inside it, "at least the band" beyond.
 const limit=band*cell;let any=false;
 for(let k=0;k<M;k++){const e=nearOf(k),d=Number.isFinite(DM[e])?Math.sqrt(DM[e])*metresPerMercator(Y[k]):Infinity,wet=HOLD[k]!==-1;let v=Math.min(d,limit);
  if(!Number.isFinite(d))stats.unresolved++;
  SD[k]=wet?-v:v;if(wet)stats.wet++;if(v<limit||wet)any=true;}
 if(!any)return null;
 // The shore distance the terrain reads past NEAR_EXACT0 (shapeTerrain): on a page finer than the reference level,
 // the reference grid's, where any water lies farther than that from its shore; else the page's own, exact to its band
 // (500 m and more at the reference level and coarser), at most WATER_FAR_REACH.
 const FD=scratch('fd',Float32Array,M);let far=null;
 if(reference){let need=false;for(let k=0;k<M&&!need;k++)if(SD[k]<-NEAR_EXACT0)need=true;
  if(need){farShoreDistance(union,reference(),FD,stats);far=FD;}}
 else{for(let k=0;k<M;k++){const e=nearOf(k);FD[k]=Number.isFinite(DM[e])?Math.min(WATER_FAR_REACH,Math.sqrt(DM[e])*metresPerMercator(Y[k])):WATER_FAR_REACH;}far=FD;}
 tick('far');
 // River levels on a grid of every RG-th texel, bilinear between its nodes (the network's level field is smooth at that
 // scale: blended over at least 6 m); depth and segment from the nearest node. Nodes fall on texels neighbouring pages
 // share, so pages agree. Where a node has no level the texel asks the network itself.
 // The last node stands one texel past the page (texel N, extrapolated): page x's texel i is page x + 1's texel i - 256,
 // a multiple of RG, so with it every node is a node of the neighbour too. Clamped to the last texel it was not, and a
 // river's level stepped up to 0.3 m at page borders (Test-Water-Bed-Seams, Douro).
 const RG=4,GN=Math.ceil(N/RG)+1,gridCache=new Array(GN*GN);
 const nodeXY=(i,j)=>{const ii=Math.min(i,N-1),jj=Math.min(j,N-1),k=jj*N+ii,di=i-ii,dj=j-jj;if(!di&&!dj)return [X[k],Y[k]];
  const kx=ii>0?k-1:k,ky=jj>0?k-N:k;return [X[k]+di*(X[k]-X[kx])+dj*(X[k]-X[ky]),Y[k]+di*(Y[k]-Y[kx])+dj*(Y[k]-Y[ky])];};
 const nodeAt=(gi,gj)=>{const c=gj*GN+gi;let v=gridCache[c];if(v===undefined){const [x,y]=nodeXY(gi*RG,gj*RG);v=union.sampleRiver?union.sampleRiver(x,y):null;gridCache[c]=v;}return v;};
 // A cell is interpolated only where the field is linear across it: the network at the cell's middle within LINEAR_TOL
 // of the bilinear estimate there. Elsewhere (a steep stream, where two rivers' levels meet, a coarse page's wide
 // cells) every texel of the cell asks the network.
 const LINEAR_TOL=.01,cellOk=new Int8Array((GN-1)*(GN-1));
 const riverAt=k=>{if(!union.sampleRiver)return null;const i=k%N,j=(k-i)/N,gi=Math.min(GN-2,Math.floor(i/RG)),gj=Math.min(GN-2,Math.floor(j/RG)),i0=gi*RG,i1=i0+RG,j0=gj*RG,j1=j0+RG;
  const ci=gj*(GN-1)+gi;if(cellOk[ci]<0)return union.sampleRiver(X[k],Y[k]);
  const a=nodeAt(gi,gj),b=nodeAt(gi+1,gj),c=nodeAt(gi,gj+1),d=nodeAt(gi+1,gj+1);if(!a||!b||!c||!d){cellOk[ci]=-1;return union.sampleRiver(X[k],Y[k]);}
  const bil=(fx,fy)=>(a.level*(1-fx)+b.level*fx)*(1-fy)+(c.level*(1-fx)+d.level*fx)*fy;
  if(cellOk[ci]===0){const mi=(i0+i1)>>1,mj=(j0+j1)>>1,m=union.sampleRiver(...nodeXY(mi,mj));cellOk[ci]=m&&Math.abs(m.level-bil((mi-i0)/(i1-i0),(mj-j0)/(j1-j0)))<=LINEAR_TOL?1:-1;if(cellOk[ci]<0)return union.sampleRiver(X[k],Y[k]);}
  const fx=(i-i0)/(i1-i0),fy=(j-j0)/(j1-j0),near=fx<.5?(fy<.5?a:c):(fy<.5?b:d);return {level:bil(fx,fy),segment:near.segment,depth:near.depth};};
 // Levels and kinds: inside, the holding body's; outside within the band, the nearest shore's body at that shore.
 // Rivers read the network at the point.
 function flowAt(k,s){const seg=s.segment;if(!seg)return;// A river 8 m wide or more flows as if it fell at most RIVER_FLOW_SLOPE: its fitted levels on the z13 DEM put
  // falls of several percent into reaches that fall a few tenths (Wupper fixture: median segment 1.6%), and white
  // water there would cover the river. Streams keep their slope. Open: the levels themselves (docs/WATER-LAYER.md).
  const L=Math.sqrt(seg.length2),raw=seg.reachSlope??seg.slope,v=riverSpeed((seg.ta??0)>=8?Math.min(raw,RIVER_FLOW_SLOPE):raw,s.depth??seg.depth)*seg.dir;
  const i=k%N,j=(k-i)/N,ka=i<N-1?k+1:k-1,kb=j<N-1?k+N:k-N,sa=i<N-1?1:-1,sb=j<N-1?1:-1;
  const a=(X[ka]-X[k])*sa,b=(X[kb]-X[k])*sb,c=(Y[ka]-Y[k])*sa,d=(Y[kb]-Y[k])*sb,det=a*d-b*c;if(!det)return;
  // Downstream velocity in Mercator units per second, then in texels per second along the page's axes, then m/s.
  const mx=seg.dx/L*v/metresPerMercator(Y[k]),my=seg.dy/L*v/metresPerMercator(Y[k]),du=(d*mx-b*my)/det,dv=(-c*mx+a*my)/det;FU[k]=du*cell;FV[k]=dv*cell;}
 // SEGK: the network segment a river texel or a dry texel beside a river reads its depth and bank zone from (terrain).
 const SEGK=new Array(M).fill(null);
 for(let k=0;k<M;k++){const h=HOLD[k];LV[k]=NaN;KD[k]=0;FE[k]=0;FU[k]=0;FV[k]=0;
  if(h>=0&&union.polys[h].source){const v=union.sourceSea.levelAt(X[k],Y[k]);LV[k]=v;const sea=!(Math.abs(v)>SOURCE_SEA_BAND);KD[k]=sea?1:2;FE[k]=sea?63:40;}
  else if(h>=0){const p=union.polys[h];KD[k]=p.kind;FE[k]=p.kind===1?63:fetchCode(p.size*2);if(p.kind!==3)LV[k]=p.level;
   else{const s=riverAt(k);if(s){LV[k]=s.level;SEGK[k]=s.segment;flowAt(k,s);}}}
  else if(h===-2){const s=riverAt(k);if(s)SEGK[k]=s.segment;KD[k]=3;if(s){FE[k]=fetchCode(2*Math.max(s.segment?.wa??1,s.segment?.wb??1));LV[k]=s.level;flowAt(k,s);}}
 }
 tick('levels');
 // Polygon rivers without a network level: the lowest ground of their own within three texels, then smoothed over
 // their own texels (two 3 x 3 means), so the DEM's noise is not a step in the water.
 const FB=scratch('fb',Uint8Array,M).fill(0),TMP=scratch('tmp',Float32Array,M);
 for(let j=0;j<N;j++)for(let i=0;i<N;i++){const k=j*N+i,h=HOLD[k];if(h<0||union.polys[h].kind!==3||LV[k]===LV[k])continue;let low=Infinity;
  for(let b=Math.max(0,j-3);b<=Math.min(N-1,j+3);b++)for(let a=Math.max(0,i-3);a<=Math.min(N-1,i+3);a++){const o=b*N+a;if(HOLD[o]===h&&heights&&heights[o]<low)low=heights[o];}
  if(low<Infinity){LV[k]=low;FB[k]=1;stats.fallbackLevel++;}}
 if(stats.fallbackLevel)for(let pass=0;pass<2;pass++){TMP.set(LV);for(let j=0;j<N;j++)for(let i=0;i<N;i++){const k=j*N+i;if(!FB[k])continue;let sum=0,w=0;
  for(let b=Math.max(0,j-1);b<=Math.min(N-1,j+1);b++)for(let a=Math.max(0,i-1);a<=Math.min(N-1,i+1);a++){const o=b*N+a;if(HOLD[o]===HOLD[k]&&TMP[o]===TMP[o]){sum+=TMP[o];w++;}}LV[k]=sum/w;}}
 // Dry texels within the band: the level of the nearest shore's body there, so a filter across the shore reads one
 // level on both sides (no trench toward a low bank).
 const cache=new Map();
 const levelOfPiece=i=>{let v=cache.get(i);if(v!==undefined)return v;const o=i*4,mx=(P[o]+P[o+2])/2,my=(P[o+1]+P[o+3])/2,own=owner[i];
  if(own>=0&&union.polys[own].source)v=union.sourceSea.levelAt(mx,my);else if(own>=0&&union.polys[own].kind!==3)v=union.polys[own].level;else{const s=union.sampleRiver?union.sampleRiver(mx,my):null;v=s?s.level:NaN;pieceSegOf.set(i,pieceSegs[i]??s?.segment??null);}
  cache.set(i,v);return v;};
 const pieceSegOf=new Map();
 // BODY: the body a texel belongs to for the terrain (water-layer.js shapeTerrain): its holder, else the nearest shore's
 // owner within the band (a polygon index; -2 a channel; -1 none).
 const BODY=scratch('body',Int32Array,M);for(let k=0;k<M;k++)BODY[k]=HOLD[k];
 for(let k=0;k<M;k++){const e=nearOf(k);if(HOLD[k]!==-1||NEAR[e]<0||SD[k]>=limit)continue;const i=NEAR[e],own=owner[i];LV[k]=levelOfPiece(i);BODY[k]=own>=0?own:-2;SEGK[k]=pieceSegOf.get(i)??null;
  FE[k]=own>=0?(union.polys[own].kind===1?63:fetchCode(union.polys[own].size*2)):0;}
 // Texels within the band with no level yet (a polygon river nothing reaches near here): a neighbour's.
 for(let pass=0;pass<2;pass++)for(let jj=0;jj<N;jj++){const j=pass?N-1-jj:jj;for(let ii=0;ii<N;ii++){const i=pass?N-1-ii:ii,k=j*N+i;if(LV[k]===LV[k]||(HOLD[k]===-1&&SD[k]>=limit))continue;
  for(let q=0;q<4;q++){const a=q===0?i-1:q===1?i+1:i,b=q===2?j-1:q===3?j+1:j;if(a<0||b<0||a>=N||b>=N)continue;const v=LV[b*N+a];if(v===v){LV[k]=v;stats.fallbackLevel++;break;}}}}
 tick('levelfill');
 // The shore's own variation (shoreWiggle): the distance moves near the shore, and the bed, the banks, the coverage
 // and the GPU's clip all follow the moved shore.
 const WG=scratch('wg',Float32Array,M);let wiggled=false;
 for(let k=0;k<M;k++){const w=shoreWiggle(X[k],Y[k],SD[k],cell,KD[k]);WG[k]=w;if(w){SD[k]+=w;wiggled=true;}}
 if(wiggled)stats.wiggled=true;
 // Coverage: the share of the texel square under water, by 4 x 4 samples where the shore passes within 0.75 texel;
 // where the shore was moved, from the moved distance (the texel is then at most a couple of metres: the edge is
 // straight across it).
 for(let k=0;k<M;k++){const s=SD[k];if(s<=-.75*cell){AL[k]=1;continue;}if(s>=.75*cell){AL[k]=0;continue;}
  if(WG[k]){AL[k]=Math.max(0,Math.min(1,.5-s/cell));stats.shore++;continue;}
  const i=k%N,j=(k-i)/N,ka=i<N-1?k+1:k-1,kb=j<N-1?k+N:k-N,sa=i<N-1?1:-1,sb=j<N-1?1:-1;
  const ax=(X[ka]-X[k])*sa,ay=(Y[ka]-Y[k])*sa,bx=(X[kb]-X[k])*sb,by=(Y[kb]-Y[k])*sb;let w=0;
  for(let q=0;q<4;q++)for(let p=0;p<4;p++){const u=(p+.5)/4-.5,v=(q+.5)/4-.5;if(wetNear(k,X[k]+ax*u+bx*v,Y[k]+ay*u+by*v))w++;}
  AL[k]=w/16;stats.shore++;}
 tick('alpha');
 // Encode.
 let lmin=Infinity,lmax=-Infinity;for(let k=0;k<M;k++){const v=LV[k];if(v===v){if(v<lmin)lmin=v;if(v>lmax)lmax=v;}}
 if(!(lmin<=lmax)){lmin=0;lmax=0;}
 const scale=lmax>lmin?(lmax-lmin)/65534:0,bytes=new Uint16Array(M*4);stats.levelRange=lmax-lmin;
 let allWet=true,allSame=true;const k0=KD[0];
 for(let k=0;k<M;k++){const o=k*4,s=SD[k]/cell;bytes[o]=Math.max(0,Math.min(65535,Math.round(s*SDF_STEPS)+32768));
  const v=LV[k];bytes[o+1]=v===v?(scale>0?Math.min(65534,Math.max(0,Math.round((v-lmin)/scale))):0):65535;
  bytes[o+2]=Math.round(AL[k]*255)|((KD[k]&3)<<8)|((FE[k]&63)<<10);
  const fu=Math.max(-127,Math.min(127,Math.round(FU[k]/FLOW_UNIT))),fv=Math.max(-127,Math.min(127,Math.round(FV[k]/FLOW_UNIT)));bytes[o+3]=(fu&255)|((fv&255)<<8);
  if(SD[k]>-limit)allWet=false;if(KD[k]!==k0)allSame=false;}
 stats.texels=M;stats.ms=(globalThis.performance?.now()??0)-t0;
 return {bytes,levelOffset:lmin,levelScale:scale,uniform:allWet&&allSame&&scale===0?{kind:k0,level:lmin}:null,sdf:SD,far,level:LV,alpha:AL,kind:KD,body:BODY,segment:SEGK,stats};
}
// Decoding, for tests and the CPU viewer: the same arithmetic the GPU will use.
export const sdfTexels=code=>(code-32768)/SDF_STEPS;
export const levelOf=(page,code)=>code===65535?NaN:page.levelOffset+page.levelScale*code;

// ---- Terrain from the water layer (docs/WATER-LAYER.md phase 2). Beds and banks are a function of the water page's
// distance, level and coverage, in the same build, so ground and water agree by construction at every level:
//   wet target (the texel all water): the ground no higher than the level less a bed falling from the shore at
//     SHORE_SLOPE toward the body's depth (the sea and deeper DEM keep their own floor);
//   dry target (the texel all ground): ground just beside the water raised to the level and a little over it within
//     FILL_SPAN (at most FILL_LIMIT); beside a river, high ground cut to a bank rising from BANK_FREEBOARD over the
//     level at WALL_SLOPE at least, steeply enough to meet its hillside by three quarters of the bank zone, faded back
//     to the ground over the last quarter (the old river rule; valley conflation moves the DEM first). The sea's and
//     lakes' high shores are not cut: cliffs and quays stand.
//   the texel: coverage times the wet target plus the rest times the dry one, a box filter, so a coarse texel over a
//     thin river carves its share of it, not a texel-wide trench.
// Cuts past CUT_LIMIT and fills past FILL_LIMIT are clamped and counted (terrainLimited).
const BANK_SLOPE=0.6,BANK_HILLSIDE=1.5,BANK_STEEPEST=3.0,SEA_FLOOR_SLOPE=0.3,SEA_FLOOR_REACH=12,SHORE_SLOPE=0.25,BODY_DEPTH=Object.freeze({ocean:10,lake:6,pond:1.5,dock:4,river:2}),FILL_SPAN=12,FILL_LIMIT=2,CUT_LIMIT=30,BANK_FREEBOARD=0.1,STILL_FREEBOARD=0.2,WALL_SLOPE=0.6,WALL_STEEPEST=1.2,WALL_SOFT=3;
// The deepest a mapped river's bed falls (rivers.js caps a segment's depth at 3 m, at about 33 m of width).
const RIVER_POLY_DEPTH=3;
const smoothstep=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const smoothMin=(a,b,k)=>{const t=Math.max(k-Math.abs(a-b),0)/k;return Math.min(a,b)-t*t*k*0.25;};
export function shapeTerrain(union,page,h,X,Y,cell){
 const M=N*N,stats={shaped:0,cut:0,filled:0,lifted:0,liftMax:0,terrainLimited:0};if(!page)return stats;
 const {sdf:SD,far:FD,level:LV,alpha:AL,body:BODY}=page;
 // The hillside's own slope, before shaping, for the cut banks.
 const HG=scratch('hg',Float32Array,M);for(let j=0;j<N;j++)for(let i=0;i<N;i++){const k=j*N+i,a=i>0?k-1:k,b=i<N-1?k+1:k,c=j>0?k-N:k,d=j<N-1?k+N:k;HG[k]=Math.hypot((h[b]-h[a])/((b-a)*cell),(h[d]-h[c])/((d-c)/N*cell));}
 const out=scratch('shaped',Float32Array,M);out.set(h);
 for(let k=0;k<M;k++){const b=BODY[k],L=LV[k];if(b===-1||L!==L)continue;const d=SD[k],a=AL[k],h0=h[k];
  const poly=b>=0?union.polys[b]:null,river=!poly||poly.kind===3;
  // A mapped river's bed is as deep as its shore distance allows (half its width at most), to RIVER_POLY_DEPTH: the
  // network segment nearest a texel is a property of the page (each page builds the network from the features near
  // it), and inside the Douro's polygon one page read the Douro (3 m) where its neighbour read a 1.5 m stream running
  // into it (0.45 m), a 2.5 m wall at the page border (Test-Water-Bed-Seams, owner's "sudden deep shelves", 4
  // November 2026). A channel with no polygon is its segment, and keeps the segment's depth.
  let D=poly?(poly.kind===3?RIVER_POLY_DEPTH:BODY_DEPTH[poly.cls]??4):BODY_DEPTH.river,bankSpan=8;
  const seg=river?page.segment[k]:null;if(seg){bankSpan=seg.bankSpan;if(!poly)D=Math.max(.45,seg.depth);}
  const inside=Math.max(0,-d),outside=Math.max(0,d);
  // Wet: the bed, from the shore distance every page level agrees on: the page's own close to the shore, the reference
  // distance past NEAR_EXACT1 (WATER_REFERENCE_LEVEL). From the page's own, clamped at its band, the bed's depth was a
  // property of the page level.
  const blend=FD?smoothstep(NEAR_EXACT0,NEAR_EXACT1,inside):0,reach=Math.min(WATER_FAR_REACH,FD?inside+(FD[k]-inside)*blend:inside);
  const bed=L-D*(1-Math.exp(-SHORE_SLOPE*reach/D));let wet=Math.min(h0,bed);if(h0-wet>CUT_LIMIT){wet=h0-CUT_LIMIT;stats.terrainLimited++;}
  // The sea's floor near the shore falls no faster than SEA_FLOOR_SLOPE: a prepared seabed (seabed.js) is a fill from a
  // coarser tile, not a measured depth, and standing deep right at the map's coastline it made a step there.
  // Only within SEA_FLOOR_REACH of the shore, a distance every page level resolves alike: measured to the band's
  // clamp it held a fine page's open sea at 23 m and a coarse one's at 115, page-shaped patches of water colour.
  if(poly&&poly.kind===1&&inside<SEA_FLOOR_REACH){const q=inside/SEA_FLOOR_REACH,f=q*q*(3-2*q);wet=Math.max(wet,L-SEA_FLOOR_SLOPE*inside)*(1-f)+wet*f;}
  // Dry: fill beside the water; and beside any water (sea, lake, river alike) high ground is cut to a bank line rising
  // from its top at BANK_SLOPE at least, or at BANK_HILLSIDE times the hillside's own slope where that is steeper (a
  // cliff stays a cliff, as steep as the ground has it), so the line always climbs out of the ground and meets it.
  // Inside the water the bed is cut straight down from whatever the DEM holds; without the bank beside a lake or the
  // sea, a DEM that put land over the map's water stood there as a vertical wall at the shore, and the water's shading
  // ran up it (owner's report, 3 November 2026). The cut never takes the bank under its top (a pit beside the water)
  // and fades out over the last quarter of the band, where the distance stops being known.
  let dry=h0;const top=L+(river?BANK_FREEBOARD:STILL_FREEBOARD),limit=WATER_BAND*cell;
  if(h0<top&&outside<FILL_SPAN){const u=outside/FILL_SPAN,f=u*u*(3-2*u),rise=L+Math.min(top-L,.1*outside);let lift=(rise-h0)*(1-f);if(lift>FILL_LIMIT){lift=FILL_LIMIT;stats.terrainLimited++;}if(lift>0){dry=h0+lift;stats.filled++;stats.lifted+=lift;stats.liftMax=Math.max(stats.liftMax,lift);}}
  else if(h0>top){const wall=Math.min(BANK_STEEPEST,Math.max(BANK_SLOPE,BANK_HILLSIDE*HG[k])),q=Math.max(0,Math.min(1,(outside/limit-.75)*4)),f=q*q*(3-2*q);
   let v=Math.max(top,smoothMin(h0,top+wall*outside,WALL_SOFT))*(1-f)+h0*f;if(h0-v>CUT_LIMIT){v=h0-CUT_LIMIT;stats.terrainLimited++;}if(v<h0)stats.cut++;dry=v;}
  const g=a*wet+(1-a)*dry;if(g!==h0)stats.shaped++;out[k]=g;}
 h.set(out);return stats;
}
