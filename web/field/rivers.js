// Hydrography follows OSM centrelines and mapped bank polygons. Missing widths
// and all bed depths are estimates. Bridges, tunnels and intermittent reaches
// are excluded. This is a local reconstruction from map lines and a DEM, not a
// catchment-scale hydrodynamic solver.
//
// One network for every page level. Each z14 source tile is solved on its own,
// from its own lines, bank polygons and a fixed z13 DEM, so a reach gets the
// same course, width and water level whichever page, level or neighbour asks.
// Pages coarser than RIVER_MIN_LEVEL carry no rivers: a channel there is under
// a texel wide, and the page builder fades carving and water in by how many
// texels a channel spans. Successive levels then refine one channel instead of
// moving it.
//
// Levels (revised 5 November 2026, owner's "flying rivers"): a node's target is the lowest DEM probe at the
// centreline, and no higher than FREEBOARD under the lower of its two bank probes. Between fixed nodes (confluences,
// ends, tile edges; each the lowest of its own probes, a confluence also no higher than the ground along the reaches
// that run down into it, JUNCTION_REACH) a reach's level is the running minimum of its targets from the
// upper end (riverProfile): never above a target, never rising downstream. It is smoothed by a mean over a window
// that reaches only downstream, which for a profile that never rises can only lower it, so the guarantee survives
// the smoothing. The one exception is a reach whose ground dips under its lower fixed end: the level holds at that
// end there, counted as heldOver (and its largest excess, heldOverMax). The earlier fit (isotonic, then smoothed,
// clamped only 1.5 m over a bank, and a straight fall between the ends of any reach steeper than its class limit)
// stood rivers metres over their own floodplain, and the terrain was filled up to them: raised channels with walls.
//
// Widths: a reach's channel is symmetric about its centreline, as wide as the polygon it lies in allows on its
// narrower side (the polygon itself carries the rest of its extent, resample.js), else its class estimate. A node
// whose polygon ray runs out along a side arm or a basin is held to twice the median of its neighbours, and widths
// taper over TAPER metres where mapping stops, so no node turns into a disk.
import {tilePolygons,pieceLevel,insideRings,MAP_WATER_MIN_LEVEL,MAP_WATER_ZOOM_OFFSET} from './map-water.js';
const TAU=2*Math.PI,R=6371000;
export const RIVER_ZOOM=14;
// Coarsest page level that reads rivers: 12 m texels, where a 6 m channel starts to show.
export const RIVER_MIN_LEVEL=12;
export const RIVER_LIMITS=Object.freeze({tiles:36,tileSegments:8192,segments:16384,bins:131072,references:524288,candidates:128,solved:96});
// Water stands at least this far under the lower bank probe.
export const RIVER_FREEBOARD=0.3;
// Bank probes stand this far outside the mapped or estimated bank.
const BANK_PROBE=4;
// Length of the downstream window a level profile is averaged over, in metres, by class: a fall in the ground becomes
// a ramp ending where the ground falls, never one starting above it. Streams keep short, steep ones.
const RIVER_SMOOTHING=Object.freeze({river:120,canal:200,stream:30,drain:20,ditch:20});
// Widest bank zone beside a channel, in metres.
export const RIVER_BANK_SPAN_MAX=120;
// Widths taper from the last mapped node to the class estimate over this length, and are smoothed over WIDTH_SMOOTH.
const TAPER=150,WIDTH_SMOOTH=40;
// A channel drawn from the centreline is never wider than this either side. Where a polygon holds the reach, the
// polygon alone is the water's extent and the centreline gives only its level (resample.js), so a wide polygon
// cannot become a disk around a node.
const TAPER_WIDEST=60;
// A free end closes over this many half widths.
const END_TAPER=6;
// Valley conflation. The DEM is coarse and shifted: a mapped river often runs up its valley's side, and cutting a
// channel there leaves walls metres high. Instead the DEM's valley is moved under the mapped line: at each node the
// DEM is searched VALLEY_MAX metres either side, in VALLEY_STEP steps, for a floor: the first point out from the line
// where the ground stops falling. It is taken when its depth under the line exceeds VALLEY_COST metres per metre of
// shift, the nearest edge of a flat floor first; a slope that keeps falling, however it eases, has no floor in
// reach and is never shifted along. In the Wupper fixture the floor lies 50-60 m off the mapped line. Shifts are smoothed along the line over VALLEY_SMOOTH,
// junction and tile-edge nodes fixed, and fade to nothing over a falloff at least VALLEY_FALLOFF metres and four
// times the shift (resample.js reads the DEM through the warp, riverField.warp).
export const VALLEY_MAX=80;
const VALLEY_STEP=4,VALLEY_COST=0.08,VALLEY_SMOOTH=80,VALLEY_FALLOFF=60,VALLEY_FLAT=0.5;
// Overlapping reaches blend their levels and banks within this many metres of the nearest channel edge, so a
// confluence, a bend tighter than the channel or a change of reach is never a step.
export const RIVER_BLEND=6;
// levelAt: centrelines within this many metres give a level (a wide river polygon's far bank, or a basin beside its
// river); bins of LEVEL_BIN metres.
const LEVEL_REACH=1500,LEVEL_BIN=128,REACH_SLOPE_SPAN=250;
// A confluence or free end inside a tile stands no higher than the lowest target within this many metres along each
// reach it is the lower end of. With three nodes (about 100 m) the Wupper fixture held a reach 1.8 m over a dip
// 100-200 m from a confluence (heldOver: 20 nodes, 3 after; worst 1.76 m, 0.91 m after, a canal between tile edges).
const JUNCTION_REACH=250;
function noise(x,y){const a=Math.floor(x),b=Math.floor(y),u=x-a,v=y-b,s=u*u*(3-2*u),t=v*v*(3-2*v);const hash=(i,j)=>{let h=Math.imul(i,374761393)^Math.imul(j,668265263);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295*2-1;};return (hash(a,b)*(1-s)+hash(a+1,b)*s)*(1-t)+(hash(a,b+1)*(1-s)+hash(a+1,b+1)*s)*t;}
// Body-fixed detail, identical across source tiles and terrain pages. It never
// changes mapped centreline positions or inferred water levels. The maximum
// perturbation is 15% of depth, and vanishes at the banks.
export function riverBedDetail(x,y,ratio,depth){const metric=TAU*R/Math.cosh((.5-y)*TAU),X=x*metric,Y=y*metric,envelope=Math.max(0,1-ratio*ratio);return depth*.15*envelope*envelope*(.65*noise(X/24,Y/24)+.35*noise(X/6,Y/6));}
// Map tiles a page reads: z14 from RIVER_MIN_LEVEL, with a margin for reaches whose banks or valley warp reach in. omitted: the page
// needed more than RIVER_LIMITS.tiles and reads none, which the field statistics count.
// band: texels beyond the page that its water layer reads (water-layer.js WATER_BAND and a little more), so a shore just
// past the page is seen by every page whose texels it reaches. 0: the old margins only.
export function riverTilePlan(nodes,level,{band=0}={}){
 if(level<MAP_WATER_MIN_LEVEL)return {tiles:[],omitted:false};
 const xs=nodes.X,ys=nodes.Y;let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
 for(let i=0;i<xs.length;i++){x0=Math.min(x0,xs[i]);x1=Math.max(x1,xs[i]);y0=Math.min(y0,ys[i]);y1=Math.max(y1,ys[i]);}
 // Below RIVER_MIN_LEVEL a page reads the map's polygons alone, from tiles about twice its size, with a margin of
 // three texels for the shore distance (map-water.js reach).
 const z=level>=RIVER_MIN_LEVEL?RIVER_ZOOM:Math.min(RIVER_ZOOM,level+MAP_WATER_ZOOM_OFFSET),n=2**z,metres=Math.max(level>=RIVER_MIN_LEVEL?Math.max(300,4*VALLEY_MAX+40):3*R/128/2**level,band*R/128/2**level),margin=metres/(R*TAU*Math.max(.08,1/Math.cosh((.5-(y0+y1)/2)*TAU)));
 const a=Math.floor((x0-margin)*n),b=Math.floor((x1+margin)*n),c=Math.max(0,Math.floor((y0-margin)*n)),d=Math.min(n-1,Math.floor((y1+margin)*n));
 if((b-a+1)*(d-c+1)>RIVER_LIMITS.tiles)return {tiles:[],omitted:true};
 const tiles=[];for(let y=c;y<=d;y++)for(let x=a;x<=b;x++)tiles.push({z,x:(x%n+n)%n,y});
 return {tiles,omitted:false};
}
export function riverTileRequests(nodes,level=RIVER_MIN_LEVEL){return riverTilePlan(nodes,level).tiles;}
// Isotonic fit between fixed endpoints, monotone from the first value toward the last.
export function monotoneLevels(values){
 if(values.length<2)return values.slice();const reverse=values[0]<values.at(-1),v=reverse?values.toReversed():values.slice(),high=v[0],low=v.at(-1),blocks=[];
 for(let i=1;i<v.length-1;i++){blocks.push({sum:Math.max(low,Math.min(high,v[i])),n:1});while(blocks.length>1&&blocks.at(-2).sum/blocks.at(-2).n<blocks.at(-1).sum/blocks.at(-1).n){const b=blocks.pop(),a=blocks.at(-1);a.sum+=b.sum;a.n+=b.n;}}
 const out=[high];for(const b of blocks)for(let i=0;i<b.n;i++)out.push(b.sum/b.n);out.push(low);return reverse?out.reverse():out;
}
// A reach's water level between its fixed ends, from its targets (lowest ground probe, bank limit) at distances
// along (metres from the first node). The higher end is upstream. E: the running minimum of the targets from the
// upper end, held at the lower end's level: it never rises downstream and stands over a target only where that
// target is below the lower end. The result is E averaged over [s, s + w(s)], w growing from 0 at the upper end to
// `smooth`, E taken as the lower end past it. For a profile that never rises downstream, a window that starts at s
// and whose ends only move downstream gives a mean no higher than E(s) and never rising: the guarantee holds after
// smoothing, both ends keep their levels, and a fall in the ground is a ramp that ends where the ground falls.
export function riverProfile(targets,along,smooth){
 const n=targets.length;if(n<3)return targets.slice();
 const down=targets[0]>=targets[n-1],T=down?targets:targets.toReversed(),S=down?along:along.map(a=>along[n-1]-a).reverse();
 const A=T[0],B=T[n-1],E=new Float64Array(n);E[0]=A;E[n-1]=B;
 for(let j=1;j<n-1;j++)E[j]=Math.max(B,Math.min(E[j-1],T[j]));
 // Integral of the piecewise linear E, extended by B past the lower end.
 const I=new Float64Array(n);for(let j=1;j<n;j++)I[j]=I[j-1]+(S[j]-S[j-1])*(E[j]+E[j-1])/2;
 const L=S[n-1];let seg=0;
 const integral=x=>{if(x>=L)return I[n-1]+(x-L)*B;while(seg<n-2&&S[seg+1]<x)seg++;while(seg>0&&S[seg]>x)seg--;const a=S[seg],b=S[seg+1],u=b>a?(x-a)/(b-a):0,e=E[seg]+(E[seg+1]-E[seg])*u;return I[seg]+(x-a)*(E[seg]+e)/2;};
 const out=new Array(n);out[0]=A;out[n-1]=B;
 for(let j=1;j<n-1;j++){const w=Math.min(smooth,S[j]);if(w<=1e-6){out[j]=E[j];continue;}const lo=integral(S[j]),hi=integral(S[j]+w);out[j]=Math.min(E[j],Math.max(B,(hi-lo)/w));}
 // Rounding only: the mean is never above E, nor E above the previous level.
 for(let j=1;j<n-1;j++)out[j]=Math.min(out[j],out[j-1]);
 return down?out:out.reverse();
}
// Liang-Barsky line clipping, retaining exact tile-boundary intersections.
function clip(a,b,e){let lo=0,hi=1;const dx=b[0]-a[0],dy=b[1]-a[1];for(const [p,q] of [[-dx,a[0]],[dx,e-a[0]],[-dy,a[1]],[dy,e-a[1]]]){if(p===0){if(q<0)return null;}else{const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return null;}}return [[a[0]+lo*dx,a[1]+lo*dy],[a[0]+hi*dx,a[1]+hi*dy]];}
// Widths come from the mapped river polygons where available. Missing polygons
// retain the explicit class estimate. No random displacement of the real course.
function bankEdges(tile,stats,kind='river'){
 const layer=tile.layers?.water;if(!layer)return [];
 const edges=[],n=2**tile.z,e=layer.extent;
 for(const f of layer.features){if(f.properties.class!==kind||f.properties.intermittent)continue;
  for(const ring of f.paths)for(let i=0;i<ring.length;i++){
   if(edges.length>=8192){stats.overBudget++;return edges;}
   const a=ring[i],b=ring[(i+1)%ring.length];
   edges.push([[(tile.x+a[0]/e)/n,(tile.y+a[1]/e)/n],[(tile.x+b[0]/e)/n,(tile.y+b[1]/e)/n]]);
  }
 }
 return edges;
}
// Consecutive source-edge groups retain iteration/admission order. Their exact
// coordinate bounds skip groups that cannot cross the query latitude or the
// existing 2048 m width box. At most ceil(8192/32)*4 doubles = 8 KiB per solve;
// no persistent cache, sampling, changed geometry or additional tolerance.
function widthIndex(edges){
 const bounds=new Float64Array(Math.ceil(edges.length/32)*4);
 for(let start=0;start<edges.length;start+=32){let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(let i=start;i<Math.min(start+32,edges.length);i++)for(const p of edges[i]){x0=Math.min(x0,p[0]);y0=Math.min(y0,p[1]);x1=Math.max(x1,p[0]);y1=Math.max(y1,p[1]);}
  bounds.set([x0,y0,x1,y1],start/8);
 }
 return {edges,bounds};
}
function widths(p,tangent,index,fallback,metric,stats){
 const {edges,bounds}=index;
 const size=Math.hypot(...tangent);if(size<1e-15||!edges.length)return [fallback,fallback];
 let inside=false;for(let group=0;group<bounds.length;group+=4){if(p[1]<bounds[group+1]||p[1]>=bounds[group+3])continue;
  for(let i=group*8;i<Math.min(group*8+32,edges.length);i++){const [a,b]=edges[i];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}
 }
 if(!inside)return [fallback,fallback];
 const normal=[-tangent[1]/size,tangent[0]/size];let left=Infinity,right=Infinity,candidates=0;
 groups:for(let group=0;group<bounds.length;group+=4){
  // Subtraction and multiplication by positive metric are monotone: rejecting
  // a group implies every edge fails the original per-edge box predicate.
  if((bounds[group]-p[0])*metric>2048||(bounds[group+2]-p[0])*metric< -2048||(bounds[group+1]-p[1])*metric>2048||(bounds[group+3]-p[1])*metric< -2048)continue;
  for(let i=group*8;i<Math.min(group*8+32,edges.length);i++){const [a,b]=edges[i];
  const ax=(a[0]-p[0])*metric,ay=(a[1]-p[1])*metric,bx=(b[0]-p[0])*metric,by=(b[1]-p[1])*metric;
  if(Math.min(ax,bx)>2048||Math.max(ax,bx)<-2048||Math.min(ay,by)>2048||Math.max(ay,by)<-2048)continue;
  if(++candidates>1024){stats.overBudget++;break groups;}
  const dx=bx-ax,dy=by-ay,den=normal[0]*dy-normal[1]*dx;if(Math.abs(den)<1e-12)continue;
  const t=(ax*dy-ay*dx)/den,u=(ax*normal[1]-ay*normal[0])/den;
  if(u<0||u>1||Math.abs(t)>2048)continue;if(t>0)left=Math.min(left,t);else right=Math.min(right,-t);
 }}
 if(left<Infinity&&right<Infinity){stats.mappedWidths++;const out=[Math.max(.75,left),Math.max(.75,right)];out.mapped=true;return out;}
 return [fallback,fallback];
}
// How far a segment's valley shift reaches: none for a segment that does not shift, else at least VALLEY_FALLOFF and
// four times the shift, which bounds the warp's slope (no fold) along that segment.
const shiftFalloff=metres=>metres<.05?0:Math.max(VALLEY_FALLOFF,4*metres);
// Symmetric channel half widths (run.half), total widths (run.total, for depth and fade) and bank probe sides
// (run.sides) per node of a run, from its polygon rays (run.bank).
function cleanWidths(run,stats){
 const {ns,width,metric}=run,m=ns.length,fallback=width/2,mapped=run.bank.map(b=>!!b.mapped);
 const total=run.bank.map(b=>b[0]+b[1]),inner=run.bank.map(b=>Math.min(b[0],b[1]));
 for(let i=0;i<m;i++){if(!mapped[i])continue;const near=[];for(let k=Math.max(0,i-4);k<=Math.min(m-1,i+4);k++)if(mapped[k]&&k!==i)near.push(total[k]);
  if(!near.length)continue;near.sort((a,b)=>a-b);const median=near[near.length>>1];if(total[i]>2*median){total[i]=2*median;inner[i]=Math.min(inner[i],median/2);stats.widthOutliers++;}}
 const along=[0];for(let i=1;i<m;i++)along.push(along[i-1]+Math.hypot(ns[i].p[0]-ns[i-1].p[0],ns[i].p[1]-ns[i-1].p[1])*metric);
 const prev=new Int32Array(m).fill(-1),next=new Int32Array(m).fill(-1);
 for(let i=0,last=-1;i<m;i++){if(mapped[i])last=i;prev[i]=last;}for(let i=m-1,last=-1;i>=0;i--){if(mapped[i])last=i;next[i]=last;}
 const fill=(v,base)=>v.map((x,i)=>{if(mapped[i])return x;const p=prev[i],q=next[i];
  if(p>=0&&q>=0&&along[q]-along[p]<=2*TAPER){const t=(along[i]-along[p])/Math.max(1e-9,along[q]-along[p]);return v[p]*(1-t)+v[q]*t;}
  let best=base,d=Infinity;for(const k of [p,q])if(k>=0&&Math.abs(along[i]-along[k])<d){d=Math.abs(along[i]-along[k]);const u=Math.max(0,1-d/TAPER),s=u*u*(3-2*u);best=base+(v[k]-base)*s;}return best;});
 const half=fill(inner,fallback),tot=fill(total,2*fallback);
 if(m>2){const spacing=along[m-1]/(m-1),passes=Math.min(200,Math.round(2*(WIDTH_SMOOTH/Math.max(spacing,1))**2));
  for(const v of [half,tot]){const tmp=v.slice();for(let k=0;k<passes;k++){for(let j=1;j<m-1;j++)tmp[j]=(v[j-1]+2*v[j]+v[j+1])*.25;for(let j=1;j<m-1;j++)v[j]=tmp[j];}}}
 run.half=half.map(v=>Math.max(.5,Math.min(TAPER_WIDEST,v)));run.total=tot.map((v,i)=>Math.max(2*run.half[i],v));run.mapped=mapped;
 // Bank probes stand outside the mapped sides, held to the cleaned total, else the channel's own half width.
 run.sides=run.bank.map((b,i)=>{if(!mapped[i])return [run.half[i],run.half[i]];const s=b[0]+b[1],f=s>run.total[i]?run.total[i]/s:1;return [b[0]*f,b[1]*f];});
}
const freshStats=()=>({reaches:0,segments:0,excluded:0,missingHeight:0,overBudget:0,mappedWidths:0,widthOutliers:0,junctions:0,terrainLimited:0,outlets:0,lakeOutlets:0,bankLimited:0,inRiver:0,heldOver:0,heldOverMax:0,reversed:0,steep:0,tiles:0,cached:0,omitted:0,shifted:0,shiftMax:0,warpFolds:0});
const STAT_KEYS=Object.keys(freshStats());
// Cheap content signature, so a cached solution is reused only for the same lines and the same DEM.
function signature(tile,heightAt){
 let h=2166136261;const mix=v=>{h=Math.imul(h^(v|0),16777619);};
 for(const name of ['waterway','water']){const l=tile.layers?.[name];if(!l)continue;mix(l.features.length);for(const f of l.features){mix(f.paths.length);for(const p of f.paths){mix(p.length);for(const q of p){mix(q[0]);mix(q[1]);}}}}
 const n=2**tile.z;for(const [u,v] of [[.5,.5],[.1,.1],[.9,.1],[.1,.9],[.9,.9]]){const z=heightAt((tile.x+u)/n,(tile.y+v)/n);mix(Number.isFinite(z)?Math.round(z*64):-7);}
 return `${tile.z}/${tile.x}/${tile.y}/${h>>>0}`;
}
// Solved tiles, per worker. Each tile's answer is a pure function of its lines and the DEM.
const solved=new Map();
// One source tile's network: segments in Mercator coordinates with fitted levels.
export function solveRiverTile(tile,heightAt){
 const key=signature(tile,heightAt),known=solved.get(key);
 if(known){solved.delete(key);solved.set(key,known);return {...known,cached:true};}
 const stats=freshStats(),segments=[];stats.tiles=1;
 const l=tile.layers?.waterway;if(!l)return {segments,stats};
 const e=l.extent,n=2**tile.z,edges=bankEdges(tile,stats),bankIndex=widthIndex(edges),emptyIndex=widthIndex([]),runs=[],nodes=new Map();
 // Ocean polygons of this tile alone (its buffer covers the neighbourhood), as a union of features.
 const oceans=[];let oceanEdges=0;
 const layer=tile.layers?.water;if(layer)for(const feature of layer.features){
  if(feature.properties.class!=='ocean')continue;
  const fe=bankEdges({...tile,layers:{water:{extent:layer.extent,features:[feature]}}},stats,'ocean');
  if(oceanEdges+fe.length>16384){stats.overBudget++;continue;}oceanEdges+=fe.length;
  if(fe.length){const xs=fe.flatMap(q=>[q[0][0],q[1][0]]),ys=fe.flatMap(q=>[q[0][1],q[1][1]]);oceans.push({edges:fe,bounds:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]});}
 }
 // Still water of this tile (lakes, ponds, docks): a node inside one stands at that lake's level, as at the sea, so a
 // reach runs down into its lake and out of it at one level. The lake's level is its piece of this tile (map-water.js).
 const lakes=tilePolygons(tile).filter(q=>q.still).map(q=>{const piece=pieceLevel(tile,q,(x,y)=>({h:heightAt(x,y),water:-1e7}));let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const r of q.rings)for(let i=0;i<r.length;i+=2){x0=Math.min(x0,r[i]);x1=Math.max(x1,r[i]);y0=Math.min(y0,r[i+1]);y1=Math.max(y1,r[i+1]);}return {rings:q.rings,level:piece.level,box:[x0,y0,x1,y1]};}).filter(q=>Number.isFinite(q.level));
 const nodeAt=p=>{const k=`${Math.round(p[0]*2**28)}/${Math.round(p[1]*2**28)}`;let node=nodes.get(k);if(!node){const metric=TAU*R/Math.cosh((.5-p[1])*TAU),d=6/metric;
   // A small symmetric valley probe avoids sampling a coarse DEM's bank. It
   // uses the same source coordinates on both sides of a tile boundary.
   let h=Math.min(...[[0,0],[d,0],[-d,0],[0,d],[0,-d]].map(([x,y])=>heightAt(p[0]+x,p[1]+y))),outlet=false,ocean=null,lakeLevel=null;
   if(h<20&&oceans.length){let inside=false,near=Infinity;const margin=300/metric;for(const polygon of oceans){
    const bounds=polygon.bounds;if(p[0]<bounds[0]-margin||p[1]<bounds[1]-margin||p[0]>bounds[2]+margin||p[1]>bounds[3]+margin)continue;
    let inPolygon=false;for(const [a,b] of polygon.edges){if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inPolygon=!inPolygon;
     const dx=b[0]-a[0],dy=b[1]-a[1],q=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));near=Math.min(near,Math.hypot(p[0]-a[0]-q*dx,p[1]-a[1]-q*dy)*metric);}
    inside||=inPolygon;}
    if(inside||near<300){const q=inside?0:Math.min(1,near/300);ocean=q;h=Math.max(0,h)*q*q*(3-2*q);outlet=true;if(inside||near<1)stats.outlets++;}}
   if(!outlet)for(const lake of lakes){const b=lake.box;if(p[0]<b[0]||p[0]>b[2]||p[1]<b[1]||p[1]>b[3])continue;if(insideRings(lake.rings,p[0],p[1])){h=lake.level;lakeLevel=lake.level;outlet=true;stats.lakeOutlets++;break;}}
   node={p,h,cap:Infinity,degree:0,outlet,ocean,lakeLevel,v:[0,0],vs:[0,0],vn:0};nodes.set(k,node);}return node;};
 // River polygons of this tile, for the node where a stream's line enters one (bisected to 1/4096 of its segment).
 const riverPolys=tilePolygons(tile).filter(q=>!q.still).map(q=>{let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const r of q.rings)for(let i=0;i<r.length;i+=2){x0=Math.min(x0,r[i]);x1=Math.max(x1,r[i]);y0=Math.min(y0,r[i+1]);y1=Math.max(y1,r[i+1]);}return {rings:q.rings,box:[x0,y0,x1,y1]};});
 const inRiverPoly=(x,y)=>{for(const w of riverPolys){const b=w.box;if(x<b[0]||x>b[2]||y<b[1]||y>b[3])continue;if(insideRings(w.rings,x,y))return true;}return false;};
 const entries=(coords)=>{if(!riverPolys.length)return coords;const out=[coords[0]];let was=inRiverPoly(...coords[0]);
  for(let i=1;i<coords.length;i++){const b=coords[i],now=inRiverPoly(...b);
   if(now!==was){let lo=out.at(-1),hi=b;for(let k=0;k<12;k++){const m=[(lo[0]+hi[0])/2,(lo[1]+hi[1])/2];if(inRiverPoly(...m)===was)lo=m;else hi=m;}out.push(was?lo:hi);}
   out.push(b);was=now;}
  return out;};
 for(const f of l.features){const p=f.properties,c=p.class;
  if(p.brunnel==='tunnel'||p.brunnel==='bridge'||p.intermittent===1||p.intermittent===true||!['river','canal','stream','drain','ditch'].includes(c)){stats.excluded++;continue;}
  const width=c==='river'?16:c==='canal'?8:c==='stream'?3:1.5,smooth=RIVER_SMOOTHING[c];
  for(const path of f.paths){let run=[];const finish=()=>{
   if(run.length<2){run=[];return;}const original=run.map(q=>[(tile.x+q[0]/e)/n,(tile.y+q[1]/e)/n]),metric=TAU*R/Math.cosh((.5-original[0][1])*TAU),coords=[original[0]];
   for(let i=1;i<original.length;i++){const a=original[i-1],b=original[i],count=Math.min(32,Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])*metric/32)));for(let j=1;j<=count;j++)coords.push([a[0]+(b[0]-a[0])*j/count,a[1]+(b[1]-a[1])*j/count]);}
   if(nodes.size+coords.length>RIVER_LIMITS.tileSegments*2){stats.overBudget++;run=[];return;}
   const ns=(width<8?entries(coords):coords).map(nodeAt);if(ns.some(q=>!Number.isFinite(q.h))){stats.missingHeight++;run=[];return;}
   for(let i=1;i<ns.length;i++){ns[i-1].degree++;ns[i].degree++;}runs.push({ns,width,metric,smooth});run=[];
  };
  for(let i=1;i<path.length;i++){const edge=clip(path[i-1],path[i],e);if(!edge){finish();continue;}if(run.length&&Math.hypot(run.at(-1)[0]-edge[0][0],run.at(-1)[1]-edge[0][1])>1e-6)finish();if(!run.length)run.push(edge[0]);run.push(edge[1]);}finish();}
 }
 for(const q of nodes.values())if(q.degree>2)stats.junctions++;
 // Widths and bank limits per run node. A shared node keeps the lowest limit of its runs.
 for(const run of runs){const {ns,width,metric}=run;
  run.bank=ns.map((node,i)=>{const a=ns[Math.max(0,i-1)].p,b=ns[Math.min(ns.length-1,i+1)].p,t=[b[0]-a[0],b[1]-a[1]];return widths(node.p,t,width>=8?bankIndex:emptyIndex,width/2,metric,stats);});
  cleanWidths(run,stats);
 }
 const onEdge=p=>{const u=p[0]*n-tile.x,v=p[1]*n-tile.y;return Math.abs(u)<1e-9||Math.abs(u-1)<1e-9||Math.abs(v)<1e-9||Math.abs(v-1)<1e-9;};
 // Valley floors beside each node, from the raw DEM. The search reach comes from the class width, not the fitted one,
 // so both tiles of an edge node, which see the same source segment, find the same floor.
 // The search on each side stops halfway to other mapped water (a lake, or a river polygon the line is not in): the
 // ground falling toward it is that water's bank, not this line's floor.
 const waters=tilePolygons(tile).map(q=>{let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const r of q.rings)for(let i=0;i<r.length;i+=2){x0=Math.min(x0,r[i]);x1=Math.max(x1,r[i]);y0=Math.min(y0,r[i+1]);y1=Math.max(y1,r[i+1]);}return {rings:q.rings,box:[x0,y0,x1,y1],still:q.still};});
 const waterAt=(x,y)=>{for(const w of waters){const b=w.box;if(x<b[0]||x>b[2]||y<b[1]||y>b[3])continue;if(insideRings(w.rings,x,y))return w;}return null;};
 const floor=(p,nx,ny,reach)=>{
  const K=Math.round(reach/VALLEY_STEP),hs=[],own=waterAt(p[0],p[1]);
  for(let k=-K;k<=K;k++)hs.push(heightAt(p[0]+nx*k*VALLEY_STEP,p[1]+ny*k*VALLEY_STEP));
  for(const dir of [1,-1])for(let k=1;k<=K;k++){const x=p[0]+nx*dir*k*VALLEY_STEP,y=p[1]+ny*dir*k*VALLEY_STEP,w=waters.length?waterAt(x,y):null;if(w&&w!==own){for(let j=Math.max(1,Math.floor(k/2));j<=K;j++)hs[K+dir*j]=NaN;break;}}
  const h0=hs[K];if(!Number.isFinite(h0))return 0;let net=0,shift=0;
  // Walk out on each side to where the ground stops falling (the next two steps no more than FLAT lower): that is the
  // floor on that side. Its depth under the line, less the cost of the shift, is its net gain; the larger wins.
  for(const dir of [1,-1])for(let k=1;k<=K-2;k++){const v=hs[K+dir*k],a=hs[K+dir*(k+1)],c=hs[K+dir*(k+2)];
   if(!Number.isFinite(v)||!Number.isFinite(a)||!Number.isFinite(c))break;
   if(a>=v-VALLEY_FLAT&&c>=v-VALLEY_FLAT){const gain=h0-v-VALLEY_COST*k*VALLEY_STEP;if(gain>net){net=gain;shift=dir*k*VALLEY_STEP;}break;}}
  // Taken in full only when it pays clearly, so a marginal floor does not switch a reach on and off.
  const u=Math.max(0,Math.min(1,(net-.2)/.8));return shift*u*u*(3-2*u);
 };
 for(const run of runs){const {ns,width,metric}=run,reach=Math.min(VALLEY_MAX,Math.max(32,4*width+20));
  run.raw=ns.map((node,i)=>{const a=ns[Math.max(0,i-1)].p,b=ns[Math.min(ns.length-1,i+1)].p,size=Math.hypot(b[0]-a[0],b[1]-a[1]);if(size<1e-15)return [0,0];
   const nx=-(b[1]-a[1])/size/metric,ny=(b[0]-a[0])/size/metric;
   // A node on the tile's edge holds the mean floor of seven points along its source segment, on both sides of the
   // edge: the same points from either tile, and one noisy search does not pin a whole reach.
   if(onEdge(node.p)){const ux=(b[0]-a[0])/size,uy=(b[1]-a[1])/size;let sum=0;for(let k=-3;k<=3;k++)sum+=floor([node.p[0]+ux*k*12/metric,node.p[1]+uy*k*12/metric],nx,ny,reach);return [nx*sum/7,ny*sum/7];}
   const o=floor(node.p,nx,ny,reach);return [nx*o,ny*o];});
  for(let i=0;i<ns.length;i++){const q=ns[i];q.vs[0]+=run.raw[i][0];q.vs[1]+=run.raw[i][1];q.vn++;}
 }
 // Smoothed along each run. Nodes where runs meet or end hold the mean of their runs' floors, so every run through
 // them agrees there, as do both tiles of an edge node.
 for(const run of runs){const {ns,metric}=run,m=ns.length,vx=new Float64Array(m),vy=new Float64Array(m);
  const fix=new Uint8Array(m);for(let i=0;i<m;i++){const q=ns[i];fix[i]=q.degree!==2||i===0||i===m-1?1:0;vx[i]=fix[i]?q.vs[0]/q.vn:run.raw[i][0];vy[i]=fix[i]?q.vs[1]/q.vn:run.raw[i][1];}
  if(m>2){let span=0;for(let i=1;i<m;i++)span+=Math.hypot(ns[i].p[0]-ns[i-1].p[0],ns[i].p[1]-ns[i-1].p[1])*metric;
   const passes=Math.min(400,Math.round(2*(VALLEY_SMOOTH/Math.max(span/(m-1),1))**2)),tx=vx.slice(),ty=vy.slice();
   for(let k=0;k<passes;k++){for(let j=1;j<m-1;j++){if(fix[j])continue;tx[j]=(vx[j-1]+2*vx[j]+vx[j+1])*.25;ty[j]=(vy[j-1]+2*vy[j]+vy[j+1])*.25;}for(let j=1;j<m-1;j++)if(!fix[j]){vx[j]=tx[j];vy[j]=ty[j];}}}
  run.v=Array.from({length:m},(_,i)=>[vx[i],vy[i]]);
  for(let i=0;i<m;i++){const q=ns[i];q.v=run.v[i];const metres=Math.hypot(vx[i],vy[i])*metric;if(metres>.5)stats.shifted++;stats.shiftMax=Math.max(stats.shiftMax,metres);}
 }
 // Every height the network reads from here on is the warped DEM's: the floor moved under the line.
 const warped=(q,x,y)=>heightAt(x+q.v[0],y+q.v[1]);
 for(const q of nodes.values()){if(q.lakeLevel!==null)continue;const metric=TAU*R/Math.cosh((.5-q.p[1])*TAU),d=6/metric;
  let h=Math.min(...[[0,0],[d,0],[-d,0],[0,d],[0,-d]].map(([x,y])=>warped(q,q.p[0]+x,q.p[1]+y)));
  if(!Number.isFinite(h))continue;if(q.ocean!==null){const o=q.ocean;h=Math.max(0,h)*o*o*(3-2*o);}q.h=h;}
 for(const run of runs){const {ns,metric}=run;
  for(let i=0;i<ns.length;i++){
   // A node on the tile's edge is limited too, or each boundary would hold a hump of
   // FREEBOARD. Both tiles probe it along the same source segment, so they agree.
   // A reach ending at a confluence would probe along the other channel, reading it as a bank. Only a reach that
   // runs through the confluence limits its level.
   const node=ns[i];if(node.outlet||(node.degree>2&&(i===0||i===ns.length-1)))continue;
   const a=ns[Math.max(0,i-1)].p,b=ns[Math.min(ns.length-1,i+1)].p,size=Math.hypot(b[0]-a[0],b[1]-a[1]);if(size<1e-15)continue;
   const nx=-(b[1]-a[1])/size/metric,ny=(b[0]-a[0])/size/metric,[left,right]=run.sides[i];
   const hl=warped(node,node.p[0]+nx*(left+BANK_PROBE),node.p[1]+ny*(left+BANK_PROBE)),hr=warped(node,node.p[0]-nx*(right+BANK_PROBE),node.p[1]-ny*(right+BANK_PROBE));
   if(Number.isFinite(hl)&&Number.isFinite(hr)){node.cap=Math.min(node.cap,Math.min(hl,hr)-RIVER_FREEBOARD);node.top=Math.max(node.top??-Infinity,hl,hr);}
  }
 }
 // Fixed nodes (confluences, ends, tile edges) carry every reach that meets them. They take the lowest of probes along
 // their reaches. A node on the tile's edge probes along
 // its source segment on both sides of the edge, the same points from either tile, so both tiles agree on it.
 const probe=(q,p,metric)=>{const d=6/metric;return Math.min(...[[0,0],[d,0],[-d,0],[0,d],[0,-d]].map(([x,y])=>warped(q,p[0]+x,p[1]+y)));};
 for(const run of runs){const {ns,metric}=run;
  for(const end of [0,ns.length-1]){const node=ns[end];if(node.degree===2||node.outlet)continue;
   const inner=ns[end===0?Math.min(1,ns.length-1):Math.max(0,ns.length-2)];
   if(onEdge(node.p)){if(node.edgeMean!==undefined)continue;const dx=node.p[0]-inner.p[0],dy=node.p[1]-inner.p[1],size=Math.hypot(dx,dy);if(size<1e-15)continue;
    let low=Infinity;for(let k=-3;k<=3;k++){const q=probe(node,[node.p[0]+dx/size*k*12/metric,node.p[1]+dy/size*k*12/metric],metric);if(Number.isFinite(q))low=Math.min(low,q);}
    if(Number.isFinite(low))node.edgeMean=low;continue;}
  }
  // A confluence or an end inside the tile, at a run's end or in its middle (a tributary ending on a river's line): its
  // own probe and up to three nodes along every reach that meets it, both ways along this run.
  for(let e=0;e<ns.length;e++){const node=ns[e];if(node.degree===2||node.outlet||onEdge(node.p))continue;(node.near??=[node.h]);
   for(const step of [-1,1])for(let k=e+step,c=0;k>=0&&k<ns.length&&c<3;k+=step,c++){const q=ns[k];if(q.degree!==2)break;node.near.push(Math.min(q.h,q.cap));}}
 }
 // The lowest probe, not their mean: a fixed end is no higher than the ground around it, as every level between is.
const first=node=>node.edgeMean??(node.near?Math.min(...node.near):node.h);
 // Then a confluence or free end inside the tile stands no higher than the targets within JUNCTION_REACH along each
 // reach it is the lower end of: water runs down into it, and ground there under it would hold the reach over that
 // ground (heldOver). Reaches running out of it, downhill, are not read: on a steep stream they lie tens of metres
 // lower, and took a confluence 12 m under its own ground. Tile-edge nodes (both tiles must agree) and outlets keep theirs.
 for(const run of runs){const {ns,metric}=run;let s0=0;
  for(let i=1;i<ns.length;i++){if(ns[i].degree===2&&i<ns.length-1)continue;
   const a=ns[s0],b=ns[i],va=Math.min(first(a),a.cap),vb=Math.min(first(b),b.cap),[low,dir,from]=va<=vb?[a,1,s0]:[b,-1,i];
   if(!low.outlet&&low.edgeMean===undefined&&low.degree!==2){let walked=0,m=Infinity;
    for(let k=from+dir;k>s0&&k<i;k+=dir){const q=ns[k],prev=ns[k-dir];walked+=Math.hypot(q.p[0]-prev.p[0],q.p[1]-prev.p[1])*metric;if(walked>JUNCTION_REACH)break;m=Math.min(m,q.h,q.cap);}
    if(m<Infinity)low.lower=Math.min(low.lower??Infinity,m);}
   s0=i;}}
 const fixed=node=>Math.min(first(node),node.lower??Infinity);
 const target=node=>Math.min(node.degree===2?node.h:fixed(node),node.cap);
 for(const run of runs){const {ns,width,metric,smooth}=run;
  // OSM draws waterways downstream. Only a clear DEM contradiction reverses that.
  let length=0;for(let i=1;i<ns.length;i++)length+=Math.hypot(ns[i].p[0]-ns[i-1].p[0],ns[i].p[1]-ns[i-1].p[1])*metric;
  const reversed=target(ns.at(-1))>target(ns[0])+2+.003*length;if(reversed)stats.reversed++;
  const h=ns.map(target);let start=0;
  // Every confluence is a shared elevation constraint. Fits stop at it, so a
  // tributary cannot keep a different level from the main channel there.
  for(let i=1;i<ns.length;i++)if(ns[i].degree!==2||i===ns.length-1){
   const along=[0];for(let j=start+1;j<=i;j++)along.push(along.at(-1)+Math.hypot(ns[j].p[0]-ns[j-1].p[0],ns[j].p[1]-ns[j-1].p[1])*metric);
   const targets=h.slice(start,i+1);
   // A stream's nodes inside a river's polygon stand at its lower end's level (the confluence's), as a reach entering a
   // lake stands at the lake's: the line runs on across the river to its centreline, and its own falling level there,
   // read inside the polygon wherever it is the nearest line, stood a wedge of water up to 0.7 m over the river around
   // it (a confluence by the Wupper, 5 November 2026). Streams only: a river's own nodes lie inside its own polygon.
   if(width<8&&waters.length){const low=Math.min(targets[0],targets.at(-1));for(let j=1;j<targets.length-1;j++){const w=waterAt(...ns[start+j].p);if(w&&!w.still){targets[j]=low;stats.inRiver++;}}}
   const fit=riverProfile(targets,along,smooth);
   for(let j=1;j<fit.length-1;j++){const over=fit[j]-targets[j];if(over>.05){stats.heldOver++;stats.heldOverMax=Math.max(stats.heldOverMax,over);}}
   for(let j=0;j<fit.length;j++)h[start+j]=fit[j];start=i;
  }
  stats.reaches++;
  // A line's free end (a spring, or where mapping stops, but not a tile edge, a confluence or an outlet) tapers its
  // channel to nothing over END_TAPER half widths, so it closes to a point instead of a round pit.
  const freeEnd=q=>q.degree===1&&!q.outlet&&!onEdge(q.p),along=[0];for(let i=1;i<ns.length;i++)along.push(along[i-1]+Math.hypot(ns[i].p[0]-ns[i-1].p[0],ns[i].p[1]-ns[i-1].p[1])*metric);
  const fromStart=freeEnd(ns[0]),fromEnd=freeEnd(ns.at(-1)),total=along.at(-1),endDistance=i=>Math.min(fromStart?along[i]:Infinity,fromEnd?total-along[i]:Infinity);
  // A reach's slope over REACH_SLOPE_SPAN metres either way along its run, for the water's flow (water-layer.js): one
  // segment's slope follows the fitted profile's steps, which the DEM's noise puts there.
  const reachSlope=i=>{let a=i,b=i;while(a>0&&along[i]-along[a]<REACH_SLOPE_SPAN)a--;while(b<ns.length-1&&along[b]-along[i]<REACH_SLOPE_SPAN)b++;return b>a?Math.abs(h[b]-h[a])/Math.max(1,along[b]-along[a]):0;};
  for(let i=1;i<ns.length;i++){
   if(segments.length>=RIVER_LIMITS.tileSegments){stats.overBudget++;break;}
   const a=ns[i-1].p,b=ns[i].p,dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy;if(length2<1e-22)continue;
   const wa=run.half[i-1],wb=run.half[i],ta=run.total[i-1],tb=run.total[i],reach=Math.max(wa,wb,...run.sides[i-1],...run.sides[i]),depth=Math.max(.45,Math.min(3,(ta+tb)*.045));
   const metres=Math.sqrt(length2)*metric,slope=Math.abs(h[i]-h[i-1])/Math.max(metres,.01);if(slope>.08)stats.steep++;
   // The bank zone reaches as far as cutting the higher bank down to a cut bank needs (resample.js), so a cut
   // never ends in a step at the zone's edge.
   const cut=Math.max(0,Math.max(ns[i-1].top??-Infinity,ns[i].top??-Infinity)-Math.max(h[i-1],h[i]));
   const bankSpan=Math.min(RIVER_BANK_SPAN_MAX,Math.max(8,depth*6,2.5*cut));
   // dir: +1 when a to b runs downstream.
   const dir=h[i]<h[i-1]?1:h[i]>h[i-1]?-1:reversed?-1:1;
   // A stream's segment inside a river's polygon: the river's own line answers levelAt there (level and flow), not the
   // stream running on to it, whose reach slope is its own steep course (white water in a wedge of the river).
   const inRiver=width<8&&riverPolys.length>0&&inRiverPoly((a[0]+b[0])/2,(a[1]+b[1])/2);
   segments.push({inRiver,a,b,dx,dy,length2,h0:h[i-1],dh:h[i]-h[i-1],wa,wb,ta,tb,width:reach,depth,metric,bankSpan,fillSpan:Math.max(8,depth*6),slope,reachSlope:(reachSlope(i-1)+reachSlope(i))/2,dir,mapped:run.mapped[i-1]&&run.mapped[i],va:run.v[i-1],vb:run.v[i],falloff:shiftFalloff(Math.max(Math.hypot(...run.v[i-1]),Math.hypot(...run.v[i]))*metric),ea:Math.min(1e9,endDistance(i-1)/(END_TAPER*Math.max(1,wa))),eb:Math.min(1e9,endDistance(i)/(END_TAPER*Math.max(1,wb)))});
  }
 }
 stats.segments=segments.length;
 const out={segments,stats};
 // Only complete answers are kept: one that lost a reach to a missing DEM tile is asked again.
 if(!stats.missingHeight){solved.set(key,out);while(solved.size>RIVER_LIMITS.solved)solved.delete(solved.keys().next().value);}
 return out;
}
// A field is a pure function of its tiles and the DEM they are solved on (signature), so pages over the same tiles
// share one: its bins and level bins are built once. Each caller gets its own stats object.
const fields=new Map();
export function riverField(tiles,heightAt){
 const key=tiles.map(t=>signature(t,heightAt)).join('|');let known=fields.get(key);
 if(known){fields.delete(key);fields.set(key,known);return {...known,stats:{...known.stats}};}
 known=buildRiverField(tiles,heightAt);if(!known.stats.missingHeight){fields.set(key,known);while(fields.size>16)fields.delete(fields.keys().next().value);}
 return {...known,stats:{...known.stats}};
}
function buildRiverField(tiles,heightAt){
 const segments=[],stats=freshStats();
 for(const tile of tiles){
  const r=solveRiverTile(tile,heightAt);
  for(const k of STAT_KEYS)if(k==='shiftMax'||k==='heldOverMax')stats[k]=Math.max(stats[k],r.stats[k]||0);else if(k!=='segments')stats[k]+=r.stats[k]||0;if(r.cached)stats.cached++;
  for(const s of r.segments){if(segments.length>=RIVER_LIMITS.segments){stats.overBudget++;break;}segments.push(s);}
 }
 stats.segments=segments.length;
 // Bin keys relative to the segments' own corner, so they stay small integers (a key of x/step*262144 is about 2^38,
 // a heap number for every lookup). Points outside the span map to no bin.
 const bins=new Map(),step=1/262144;let references=0,anyWarp=false,kx0=Infinity,ky0=Infinity;
 for(const s of segments){kx0=Math.min(kx0,s.a[0],s.b[0]);ky0=Math.min(ky0,s.a[1],s.b[1]);}
 kx0=Math.floor(kx0/step)-8192;ky0=Math.floor(ky0/step)-8192;
 const binKey=(bx,by)=>{const a=bx-kx0,b=by-ky0;return a<0||b<0||a>=32768||b>=32768?-1:a*32768+b;};
 for(const s of segments){const zone=(s.width+s.bankSpan)/s.metric,warp=(s.falloff||0)/s.metric,reach=Math.max(zone,warp);if(warp>0)anyWarp=true;s.box=[Math.min(s.a[0],s.b[0])-zone,Math.min(s.a[1],s.b[1])-zone,Math.max(s.a[0],s.b[0])+zone,Math.max(s.a[1],s.b[1])+zone];s.wbox=warp>0?[Math.min(s.a[0],s.b[0])-warp,Math.min(s.a[1],s.b[1])-warp,Math.max(s.a[0],s.b[0])+warp,Math.max(s.a[1],s.b[1])+warp]:null;const x0=Math.floor((Math.min(s.a[0],s.b[0])-reach)/step),x1=Math.floor((Math.max(s.a[0],s.b[0])+reach)/step),y0=Math.floor((Math.min(s.a[1],s.b[1])-reach)/step),y1=Math.floor((Math.max(s.a[1],s.b[1])+reach)/step),count=(x1-x0+1)*(y1-y0+1);if(count>4096||references+count>RIVER_LIMITS.references){stats.overBudget++;continue;}const keys=[];let fresh=0,full=false;for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const k=binKey(x,y);if(k<0){full=true;continue;}const list=bins.get(k);keys.push(k);if(!list)fresh++;else if(list.length>=RIVER_LIMITS.candidates)full=true;}if(full||bins.size+fresh>RIVER_LIMITS.bins){stats.overBudget++;continue;}for(const k of keys){const list=bins.get(k)||[];list.push(s);bins.set(k,list);references++;}}
 stats.bins=bins.size;stats.references=references;
 // The nearest channel edge answers where a point lies; its neighbours within RIVER_BLEND metres of that edge blend
 // levels and banks, weighted by how close they come, so every field is continuous across reaches and confluences.
 // sdf: signed distance in metres to the edge of the channel drawn from centrelines, negative inside, over the
 // segments no polygon holds (Infinity when none is near); capDistance and capHalf are that nearest segment's
 // centreline distance and half width. ratio, distance, width, left and right are the nearest centreline's.
 const CS=[],CT=new Float64Array(RIVER_LIMITS.candidates*4),CD=new Float64Array(CT.length),CW=new Float64Array(CT.length),CF=new Float64Array(CT.length),CE=new Float64Array(CT.length);
 function sample(x,y){const list=bins.get(binKey(Math.floor(x/step),Math.floor(y/step)));if(!list)return null;
  let count=0,best=Infinity,nearest=-1,cap=-1;
  for(const s of list){const b=s.box;if(x<b[0]||y<b[1]||x>b[2]||y>b[3])continue;
   const t=Math.max(0,Math.min(1,((x-s.a[0])*s.dx+(y-s.a[1])*s.dy)/s.length2)),px=x-s.a[0]-t*s.dx,py=y-s.a[1]-t*s.dy,distance=Math.sqrt(px*px+py*py)*s.metric;
   if(distance>=s.width+s.bankSpan)continue;const e=Math.min(1,s.ea+t*(s.eb-s.ea)),taper=e*(2-e),w=(s.wa+t*(s.wb-s.wa))*taper,f=distance-w;CE[count]=taper;
   CS[count]=s;CT[count]=t;CD[count]=distance;CW[count]=w;CF[count]=f;if(f<best){best=f;nearest=count;}if(!s.mapped&&(cap<0||f<CF[cap]))cap=count;count++;}
  if(nearest<0)return null;
  let sw=0,level=0,gx=0,gy=0,depth=0,bank=0,fill=0,total=0;
  for(let i=0;i<count;i++){const u=1-(CF[i]-best)/RIVER_BLEND;if(u<=0)continue;const w=u*u,s=CS[i],t=CT[i];sw+=w;level+=w*(s.h0+t*s.dh);gx+=w*s.dh*s.dx/s.length2;gy+=w*s.dh*s.dy/s.length2;depth+=w*s.depth*CE[i];bank+=w*s.bankSpan;fill+=w*s.fillSpan;total+=w*(s.ta+t*(s.tb-s.ta));}
  const s=CS[nearest],half=CW[nearest];CS.length=0;
  return {level:level/sw,sdf:cap<0?Infinity:CF[cap],capDistance:cap<0?Infinity:CD[cap],capHalf:cap<0?0:CW[cap],half,width:half,distance:CD[nearest],ratio:CD[nearest]/half,left:total/sw/2,right:total/sw/2,total:total/sw,depth:depth/sw,bankSpan:bank/sw,fillSpan:fill/sw,gx:gx/sw,gy:gy/sw,slope:s.slope,segment:s};
 }
 // The DEM warp at a point: where the DEM's valley is read from, as a Mercator offset, or null for none. The offsets
 // of nearby segments are averaged by closeness and scaled by the nearest one's falloff, so the warp is continuous,
 // full at the line and gone at its falloff. Its slope is bounded by the falloff (at least four times the shift),
 // except between two lines with different shifts closer than their difference: resample.js counts folds there.
 function warp(x,y){if(!anyWarp)return null;const list=bins.get(binKey(Math.floor(x/step),Math.floor(y/step)));if(!list)return null;
  let sw=0,sx=0,sy=0,top=0;
  for(const s of list){const b=s.wbox;if(!b||x<b[0]||y<b[1]||x>b[2]||y>b[3])continue;
   const t=Math.max(0,Math.min(1,((x-s.a[0])*s.dx+(y-s.a[1])*s.dy)/s.length2)),px=x-s.a[0]-t*s.dx,py=y-s.a[1]-t*s.dy,u=Math.sqrt(px*px+py*py)*s.metric/s.falloff;
   if(u>=1)continue;const w=1-u*u*(3-2*u),vx=s.va[0]+t*(s.vb[0]-s.va[0]),vy=s.va[1]+t*(s.vb[1]-s.va[1]);sw+=w;sx+=w*vx;sy+=w*vy;if(w>top)top=w;}
  if(sw<=0)return null;const k=top/sw;return [sx*k,sy*k];
 }
 // The network's level at any point within LEVEL_REACH metres of a centreline: the levels of the nearest centrelines
 // at their nearest points, blended over the larger of RIVER_BLEND and half the distance, so the field is a function
 // of position alone and continuous across a wide river polygon, between reaches and at confluences (water-layer.js
 // reads it inside river polygons, where sample() does not reach). Null beyond reach; the search is bounded by the
 // bins it visits.
 let lbins=null,lstep=0,lx0=0,ly0=0;
 function levelBins(){if(lbins)return;lbins=new Map();let my=0;for(const s of segments)my+=s.a[1];my/=Math.max(1,segments.length);
  lstep=LEVEL_BIN/(TAU*R/Math.cosh((.5-my)*TAU));lx0=Infinity;ly0=Infinity;for(const s of segments){lx0=Math.min(lx0,s.a[0],s.b[0]);ly0=Math.min(ly0,s.a[1],s.b[1]);}lx0-=64*lstep;ly0-=64*lstep;
  for(const s of segments){const a0=Math.floor((Math.min(s.a[0],s.b[0])-lx0)/lstep),a1=Math.floor((Math.max(s.a[0],s.b[0])-lx0)/lstep),b0=Math.floor((Math.min(s.a[1],s.b[1])-ly0)/lstep),b1=Math.floor((Math.max(s.a[1],s.b[1])-ly0)/lstep);
   for(let b=b0;b<=b1;b++)for(let a=a0;a<=a1;a++){const k=a*65536+b;let l=lbins.get(k);if(!l)lbins.set(k,l=[]);l.push(s);}}}
 function levelAt(x,y){if(!segments.length)return null;levelBins();const ca=Math.floor((x-lx0)/lstep),cb=Math.floor((y-ly0)/lstep),rings=Math.ceil(LEVEL_REACH/LEVEL_BIN)+1;
  const found=[];let best=Infinity;
  for(let r=0;r<=rings;r++){for(let a=ca-r;a<=ca+r;a++)for(let b=cb-r;b<=cb+r;b++){if(Math.max(Math.abs(a-ca),Math.abs(b-cb))!==r)continue;const l=lbins.get(a*65536+b);if(!l)continue;
    for(const s of l){const t=Math.max(0,Math.min(1,((x-s.a[0])*s.dx+(y-s.a[1])*s.dy)/s.length2)),px=x-s.a[0]-t*s.dx,py=y-s.a[1]-t*s.dy,d=Math.sqrt(px*px+py*py)*s.metric;if(d>LEVEL_REACH)continue;found.push([d,s,t]);if(d<best)best=d;}}
   // Done once the ring searched is past the nearest found plus its blend.
   if(best<Infinity&&(r-1)*LEVEL_BIN>best+Math.max(RIVER_BLEND,best/2))break;}
  if(best===Infinity)return null;
  // A stream's segments inside a river polygon give way to any other line in reach (the river's own).
  if(found.some(f=>f[1].inRiver)&&found.some(f=>!f[1].inRiver)){for(let k=found.length-1;k>=0;k--)if(found[k][1].inRiver)found.splice(k,1);best=Math.min(...found.map(f=>f[0]));}
  const blend=Math.max(RIVER_BLEND,best/2);let sw=0,level=0,gx=0,gy=0,nearest=null;
  for(const [d,s,t] of found){const u=1-(d-best)/blend;if(u<=0)continue;const w=u*u;sw+=w;level+=w*(s.h0+t*s.dh);gx+=w*s.dh*s.dx/s.length2;gy+=w*s.dh*s.dy/s.length2;if(d===best)nearest=s;}
  return {level:level/sw,gx:gx/sw,gy:gy/sw,segment:nearest,distance:best,depth:nearest.depth};}
 return {sample,warp,levelAt,stats,segments};
}
