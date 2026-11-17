// Water the map draws: lakes, ponds, docks and river polygons of the OSM water layer (OpenMapTiles schema, as served
// by OpenFreeMap). The page builder asks, per texel, whether a polygon holds the texel and how far its shore is, in
// metres. Polygons, not the DEM, say where such water lies: the DEM flattens only some lakes and the wider rivers,
// in steps, and the imagery test in water.js misses lakes of any colour but dark blue.
//
// Extent is the map's. Levels are estimates: a still polygon (lake, pond, dock) takes one level, from the source
// water levels inside it if water.js found them, else from DEM heights inside it if they are flat, else a little
// under its lowest shore. A lake split over several tiles takes one level per OSM id, as the median of its pieces
// on the tiles a page reads. Neighbouring pages read overlapping but not equal tile sets, so a lake whose pieces
// disagree can differ between them: stats.disagreeing counts such ids. River polygons take their levels from the
// centreline network (rivers.js) where it reaches them.
//
// Bounds: a query reads the edges binned within `reach` of its bin and the edges of its own tile in its row band.
// Edges past MAP_WATER_LIMITS are dropped and counted (overBudget), never silently.
const TAU=2*Math.PI,R=6371000;
// Coarsest page level that reads map water. Below RIVER_MIN_LEVEL its tiles are z(level + 1), about two pages
// across: z(level + 2) matched a page but asked about four times the tiles in one replay visit (docs/CLOUD-RIVERS-BUILDINGS-WORK.md).
export const MAP_WATER_MIN_LEVEL=7;
export const MAP_WATER_ZOOM_OFFSET=1;
// Still water at one level. 'river' polygons are flowing water. Swimming pools and intermittent water are left out.
export const STILL_CLASSES=Object.freeze(['lake','pond','dock']);
const STILL=new Set(STILL_CLASSES);
export const MAP_WATER_LIMITS=Object.freeze({edges:200000,references:2000000,levelSamples:256,solved:96});
const BINS_PER_TILE=16,BANDS_PER_TILE=64;
export const metresPerMercator=y=>TAU*R/Math.cosh((.5-y)*TAU);
// A clip edge of the tile's buffer, not a shore: both ends on one line outside the tile proper.
const clipEdge=(a,b,e)=>(a[0]===b[0]&&(a[0]<=0||a[0]>=e))||(a[1]===b[1]&&(a[1]<=0||a[1]>=e));
const freshStats=()=>({tiles:0,features:0,still:0,rivers:0,edges:0,wetEdges:0,overBudget:0,disagreeing:0,estimated:{source:0,flat:0,shore:0,sea:0,none:0}});
// Source water this close to sea level is the sea's (resample.js SEA_LEVEL_BAND).
const SEA_BAND=1;

// Polygons of one tile in Mercator: [{id,cls,still,rings:[Float64Array x,y,...]}]. Pure function of the tile.
export function tilePolygons(tile){
 const layer=tile.layers?.water;if(!layer)return [];
 const e=layer.extent,n=2**tile.z,out=[];
 for(const f of layer.features){
  const cls=f.properties.class;if(f.type!==undefined&&f.type!==3)continue;
  if(cls!=='river'&&!STILL.has(cls))continue;
  if(f.properties.intermittent===1||f.properties.intermittent===true)continue;
  const rings=[],clips=[];
  for(const ring of f.paths){if(ring.length<3)continue;const r=new Float64Array(ring.length*2),c=new Uint8Array(ring.length);
   for(let i=0;i<ring.length;i++){r[2*i]=(tile.x+ring[i][0]/e)/n;r[2*i+1]=(tile.y+ring[i][1]/e)/n;c[i]=clipEdge(ring[i],ring[(i+1)%ring.length],e)?1:0;}
   rings.push(r);clips.push(c);}
  if(!rings.length)continue;
  // Size: twice area over perimeter, in metres, about a river's width or a round lake's radius. A page shows a
  // polygon by how many texels this spans, as rivers.js does a channel (resample.js channelShare).
  let area=0,perimeter=0;const metric=metresPerMercator((tile.y+.5)/n);
  for(const r of rings){const m=r.length/2;for(let i=0,j=m-1;i<m;j=i++){area+=r[2*j]*r[2*i+1]-r[2*i]*r[2*j+1];perimeter+=Math.hypot(r[2*i]-r[2*j],r[2*i+1]-r[2*j+1]);}}
  out.push({id:f.properties.id??f.id??null,cls,still:STILL.has(cls),rings,clips,size:perimeter>0?Math.abs(area)/perimeter*metric:0});
 }
 return out;
}
// Even-odd test of one polygon's rings.
export function insideRings(rings,x,y){let inside=false;for(const r of rings){const m=r.length/2;for(let i=0,j=m-1;i<m;j=i++){const ay=r[2*j+1],by=r[2*i+1];if((ay>y)!==(by>y)){const ax=r[2*j],bx=r[2*i];if(x<ax+(y-ay)*(bx-ax)/(by-ay))inside=!inside;}}}return inside;}
const quantile=(v,q)=>{if(!v.length)return NaN;const s=Float64Array.from(v).sort();return s[Math.min(s.length-1,Math.max(0,Math.floor(q*(s.length-1)+.5)))];};
// One still polygon piece's level from what lies inside the tile proper: {level,weight,how}. sample(x,y) gives
// {h,water}: the raw DEM height and the source water level there (NO_WATER, -1e6 or lower, when none).
export function pieceLevel(tile,poly,sample){
 const n=2**tile.z,x0=tile.x/n,x1=(tile.x+1)/n,y0=tile.y/n,y1=(tile.y+1)/n;
 let bx0=Infinity,bx1=-Infinity,by0=Infinity,by1=-Infinity;
 for(const r of poly.rings)for(let i=0;i<r.length;i+=2){bx0=Math.min(bx0,r[i]);bx1=Math.max(bx1,r[i]);by0=Math.min(by0,r[i+1]);by1=Math.max(by1,r[i+1]);}
 bx0=Math.max(bx0,x0);bx1=Math.min(bx1,x1);by0=Math.max(by0,y0);by1=Math.min(by1,y1);
 if(!(bx1>bx0&&by1>by0))return {level:NaN,weight:0,how:'none'};
 const water=[],heights=[],shore=[];
 for(let j=0;j<16;j++)for(let i=0;i<16;i++){const x=bx0+(i+.5)/16*(bx1-bx0),y=by0+(j+.5)/16*(by1-by0);if(!insideRings(poly.rings,x,y))continue;
  const s=sample(x,y);if(!s||!Number.isFinite(s.h))continue;heights.push(s.h);if(s.water>-1e5)water.push(s.water);}
 // Shore: ring vertices inside the tile proper, at most levelSamples, evenly strided.
 let count=0;for(const r of poly.rings)count+=r.length/2;const stride=Math.max(1,Math.ceil(count/MAP_WATER_LIMITS.levelSamples));let k=0;
 for(const r of poly.rings)for(let i=0;i<r.length;i+=2,k++){if(k%stride)continue;const x=r[i],y=r[i+1];if(x<x0||x>x1||y<y0||y>y1)continue;const s=sample(x,y);if(s&&Number.isFinite(s.h))shore.push(s.h);}
 if(heights.length&&water.length>=.4*heights.length)return {level:quantile(water,.5),weight:water.length,how:'source'};
 let out={level:NaN,weight:0,how:'none'};
 if(heights.length>=4&&quantile(heights,.8)-quantile(heights,.2)<.5)out={level:quantile(heights,.5),weight:heights.length,how:'flat'};
 else if(shore.length)out={level:Math.min(quantile(shore,.15)-.2,heights.length?quantile(heights,.5)+.5:Infinity),weight:shore.length+heights.length,how:'shore'};
 else if(heights.length)out={level:quantile(heights,.2),weight:heights.length,how:'shore'};
 // Water open to the sea (a dock, a harbour basin, a lagoon) stands no higher than the sea it touches: its quays
 // are no shore to read a level from.
 const sea=water.filter(v=>Math.abs(v)<=SEA_BAND);
 if(sea.length&&!(out.level<=quantile(sea,.5)))out={level:quantile(sea,.5),weight:Math.max(out.weight,sea.length),how:'sea'};
 return out;
}
// Solved pieces per worker, by tile and sampler: a piece's level is a function of its tile and the DEM it reads.
const solved=new Map();
function tileKey(tile){let h=2166136261;const l=tile.layers?.water;if(l){h=Math.imul(h^l.features.length,16777619);for(const f of l.features){h=Math.imul(h^(f.paths.length|0),16777619);for(const p of f.paths){h=Math.imul(h^p.length,16777619);if(p.length){h=Math.imul(h^(p[0][0]|0),16777619);h=Math.imul(h^(p[0][1]|0),16777619);}}}}return `${tile.z}/${tile.x}/${tile.y}/${h>>>0}`;}

// The map's water over a page: polygons of every tile handed in (one zoom), levels per still id, and per point
// queries. reach: metres within which a query reports the nearest shore (bank shaping and texel coverage use it).
// wetAt(x,y): whether the source has water there (the sea), or null. A shore edge with water on its other side
// (another polygon, or the source's sea) is a wet edge: not a shore. Distances are to dry shore edges only, so a
// bed does not rise to the surface at a seam between two waters, and the query also reports the nearest wet edge
// within gap metres, so the page can carry a polygon's water across the seam's gap.
export function mapWater(tiles,sample,{reach=60,samplerKey='dem',wetAt=null,gap=3}={}){
 const stats=freshStats();
 if(!tiles.length)return {stats,query:()=>null,levelOf:()=>NaN,empty:true};
 const z=tiles[0].z,n=2**z,step=1/(n*BINS_PER_TILE),polys=[],byTile=new Map();
 for(const tile of tiles){
  if(tile.z!==z)continue;stats.tiles++;
  const key=tileKey(tile)+'/'+samplerKey;let known=solved.get(key);
  if(!known){const list=tilePolygons(tile);for(const p of list)if(p.still)p.piece=pieceLevel(tile,p,sample);known=list;solved.set(key,known);while(solved.size>MAP_WATER_LIMITS.solved)solved.delete(solved.keys().next().value);}
  const own=[];for(const p of known){polys.push({...p,index:polys.length});own.push(polys.length-1);stats.features++;if(p.still){stats.still++;stats.estimated[p.piece.how]++;}else stats.rivers++;}
  byTile.set(tile.y*n+tile.x,own);
 }
 // One level per still id: the weighted median of its pieces.
 const ids=new Map();for(const p of polys)if(p.still&&p.id!==null&&p.piece.weight>0){const l=ids.get(p.id)||[];l.push(p.piece);ids.set(p.id,l);}
 const idLevel=new Map();for(const [id,list] of ids){list.sort((a,b)=>a.level-b.level);const total=list.reduce((s,p)=>s+p.weight,0);let acc=0,level=list[0].level;for(const p of list){acc+=p.weight;if(acc>=total/2){level=p.level;break;}}idLevel.set(id,level);if(list.at(-1).level-list[0].level>.5)stats.disagreeing++;}
 for(const p of polys)if(p.still)p.level=p.id!==null&&idLevel.has(p.id)?idLevel.get(p.id):p.piece.level;
 // Edges: shore edges binned within reach for distance, every edge in its tile's row bands for the inside test.
 const EA=[],bins=new Map(),wetBins=new Map(),bands=new Map(),crossed=new Set(),shore=[];let references=0;
 for(const [tk,own] of byTile){const ty=Math.floor(tk/n),tx=tk-ty*n,bandOf=y=>Math.floor((y*n-ty)*BANDS_PER_TILE);
  for(const pi of own){const p=polys[pi];
   for(let ri=0;ri<p.rings.length;ri++){const r=p.rings[ri],c=p.clips[ri],m=r.length/2;
    for(let i=0;i<m;i++){
     if(EA.length/5>=MAP_WATER_LIMITS.edges){stats.overBudget++;break;}
     const j=(i+1)%m,ax=r[2*i],ay=r[2*i+1],bx=r[2*j],by=r[2*j+1];if(ax===bx&&ay===by)continue;
     const e=EA.length/5;EA.push(ax,ay,bx,by,pi);
     // Row bands of the own tile: every edge, clip edges too, so the rings stay closed for the parity test.
     const b0=Math.max(0,bandOf(Math.min(ay,by))),b1=Math.min(BANDS_PER_TILE-1,bandOf(Math.max(ay,by)));
     for(let b=b0;b<=b1;b++){const k=tk*BANDS_PER_TILE+b;let l=bands.get(k);if(!l)bands.set(k,l=[]);l.push(e);}
     // Bins the edge passes through, inside its own tile: there the inside answer varies within the bin.
     const cx0=Math.max(tx*BINS_PER_TILE,Math.floor(Math.min(ax,bx)/step)),cx1=Math.min(tx*BINS_PER_TILE+BINS_PER_TILE-1,Math.floor(Math.max(ax,bx)/step));
     const cy0=Math.max(ty*BINS_PER_TILE,Math.floor(Math.min(ay,by)/step)),cy1=Math.min(ty*BINS_PER_TILE+BINS_PER_TILE-1,Math.floor(Math.max(ay,by)/step));
     for(let y=cy0;y<=cy1;y++)for(let x=cx0;x<=cx1;x++)crossed.add(x*1048576+y);
     if(c[i])continue;stats.edges++;shore.push(e);
    }
   }
  }
 }
 const E=Float64Array.from(EA),parity=new Uint8Array(polys.length),touched=[],constant=new Map();
 // Polygon holding (x,y) on its own tile, or -1. Still water wins over a river polygon when both hold it.
 function holder(x,y){
  const tx=Math.floor(x*n),ty=Math.floor(y*n),tk=((ty*n+((tx%n)+n)%n));const list=bands.get(tk*BANDS_PER_TILE+Math.min(BANDS_PER_TILE-1,Math.max(0,Math.floor((y*n-ty)*BANDS_PER_TILE))));
  if(!list)return -1;
  for(const e of list){const o=e*5,ay=E[o+1],by=E[o+3];if((ay>y)!==(by>y)){const ax=E[o],bx=E[o+2];if(x<ax+(y-ay)*(bx-ax)/(by-ay)){const p=E[o+4];if(!parity[p])touched.push(p);parity[p]^=1;}}}
  let best=-1;for(const p of touched){if(parity[p]&&(best<0||(polys[p].still&&!polys[best].still)))best=p;parity[p]=0;}touched.length=0;return best;
 }
 // Shore edges, dry or wet: a point 1.5 m out from the edge's middle, on the side its polygon does not hold, lies in
 // another polygon or in the source's water. Dry edges are binned within reach, wet ones within gap.
 const bin=(table,e,metres)=>{const o=e*5,ax=E[o],ay=E[o+1],bx=E[o+2],by=E[o+3],pad=metres/metresPerMercator((ay+by)/2);
  const x0=Math.floor((Math.min(ax,bx)-pad)/step),x1=Math.floor((Math.max(ax,bx)+pad)/step),y0=Math.floor((Math.min(ay,by)-pad)/step),y1=Math.floor((Math.max(ay,by)+pad)/step);
  if((x1-x0+1)*(y1-y0+1)>1024||references+(x1-x0+1)*(y1-y0+1)>MAP_WATER_LIMITS.references){stats.overBudget++;return;}
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const k=x*1048576+y;let l=table.get(k);if(!l)table.set(k,l=[]);l.push(e);references++;}};
 for(const e of shore){const o=e*5,ax=E[o],ay=E[o+1],bx=E[o+2],by=E[o+3],p=E[o+4],mx=(ax+bx)/2,my=(ay+by)/2,l=Math.hypot(bx-ax,by-ay),d=1.5/metresPerMercator(my);
  let wet=false;
  if(l>0){const nx=-(by-ay)/l*d,ny=(bx-ax)/l*d;for(const sgn of [1,-1]){const x=mx+nx*sgn,y=my+ny*sgn,h=holder(x,y);if(h===p)continue;if(h>=0||(wetAt&&wetAt(x,y))){wet=true;break;}}}
  if(wet){stats.wetEdges++;bin(wetBins,e,gap);}else bin(bins,e,reach);}
 // {poly, distance, near, wet, wetDistance}: the polygon holding the point (or null), the distance to the nearest dry
 // shore edge in metres (Infinity past reach) and the polygon that edge belongs to, and the nearest wet edge's
 // polygon and distance within gap (null and Infinity past it).
 function query(x,y){
  const bx=Math.floor(x/step),by=Math.floor(y/step),bk=bx*1048576+by;
  let inside;if(crossed.has(bk))inside=holder(x,y);else{inside=constant.get(bk);if(inside===undefined){inside=holder((bx+.5)*step,(by+.5)*step);constant.set(bk,inside);}}
  const list=bins.get(bk);let best=Infinity,near=-1;
  if(list){const metric=metresPerMercator(y);for(const e of list){const o=e*5,ax=E[o],ay=E[o+1],dx=E[o+2]-ax,dy=E[o+3]-ay,l2=dx*dx+dy*dy,t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/l2)),ex=x-ax-t*dx,ey=y-ay-t*dy,d=(ex*ex+ey*ey);if(d<best){best=d;near=E[o+4];}}if(near>=0)best=Math.sqrt(best)*metric;}
  const wl=wetBins.get(bk);let wd=Infinity,wp=-1;
  if(wl){const metric=metresPerMercator(y);for(const e of wl){const o=e*5,ax=E[o],ay=E[o+1],dx=E[o+2]-ax,dy=E[o+3]-ay,l2=dx*dx+dy*dy,t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/l2)),ex=x-ax-t*dx,ey=y-ay-t*dy,d=(ex*ex+ey*ey);if(d<wd){wd=d;wp=E[o+4];}}if(wp>=0){wd=Math.sqrt(wd)*metric;if(wd>gap){wd=Infinity;wp=-1;}}}
  if(inside<0&&near<0&&wp<0)return null;
  return {poly:inside>=0?polys[inside]:null,distance:best,near:near>=0?polys[near]:null,wet:wp>=0?polys[wp]:null,wetDistance:wd};
 }
 return {stats,query,polys,empty:!polys.length};
}
