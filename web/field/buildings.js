// Source footprint normalization only. Extrusion, terrain support, visibility and draw
// generation belong to the GPU. Capacity failures are returned, never silently hidden.
import {tilePointToLonLat} from './vector-tile.js';
import {appendRoadSources} from './roads.js';
export const BUILDING_LIMIT=16384, POINT_LIMIT=131072, RING_LIMIT=256;
const R=6371000,rad=Math.PI/180;
const hash=s=>{let h=2166136261;for(const c of String(s))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
export const ringArea=p=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1];},0)*.5;
// Keep tile ownership exact in the source chart. Buffer polygons must not draw twice.
export function clipRing(points,extent){
 let p=points.slice();if(p.length>1&&p[0][0]===p.at(-1)[0]&&p[0][1]===p.at(-1)[1])p.pop();
 for(const [axis,edge,sign] of [[0,0,1],[0,extent,-1],[1,0,1],[1,extent,-1]]){
  const q=[];for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length],ia=(a[axis]-edge)*sign>=0,ib=(b[axis]-edge)*sign>=0;
   if(ia)q.push(a);if(ia!==ib){const t=(edge-a[axis])/(b[axis]-a[axis]);q.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}}
  p=q;
 }
 return p.filter((a,i)=>{const b=p[(i+1)%p.length];return a[0]!==b[0]||a[1]!==b[1];});
}
function colour(s,seed){if(typeof s==='string'&&/^#[0-9a-f]{6}$/i.test(s))return [1,3,5].map(i=>(parseInt(s.slice(i,i+2),16)/255)**2.2);const t=(seed%101)/100;return [.27+.2*t,.25+.18*t,.21+.15*t];}
export function buildingMetadata(prop,seed){
 const metres=x=>{const n=parseFloat(x);return Number.isFinite(n)&&n>0?n:null;};
 const explicit=metres(prop.height),render=metres(prop.render_height),levels=metres(prop['building:levels']??prop.levels);
 const height=Math.max(2,Math.min(1000,explicit??render??(levels?levels*3.1:7.5)));
 const minimum=Math.max(0,Math.min(height-1,metres(prop.min_height??prop.render_min_height)??0));
 const material=String(prop['building:material']??prop.material??'');
 const style=({brick:1,glass:2,stone:3,concrete:3,metal:4})[material]??(height>35?2:0);
 const roof=String(prop['roof:shape']??prop.roof_shape??'flat');
 const roofKind=({gabled:2,hipped:3,pyramidal:3,dome:4})[roof]??1;
 const roofHeight=roofKind>1?Math.min(height*.35,metres(prop['roof:height'])??2.4):0;
 return {height,minimum,style,roofKind,roofHeight,colour:colour(prop['building:colour']??prop.colour??prop.color,seed),estimated:!explicit&&!levels};
}
export function buildingSources(tiles){
 const records=[],points=[],stats={buildings:0,points:0,overBudget:0,complex:0,hidden:0,estimatedHeights:0};
 for(const tile of tiles){const layer=tile.layers?.building;if(!layer)continue;const extent=layer.extent;
  for(const feature of layer.features){const prop=feature.properties;
   if(prop.hide_3d===true||prop.hide_3d===1||prop.hide_3d==='true'){stats.hidden++;continue;}
   const groups=[];let group=null;for(const path of feature.paths){if(!path.closed||path.length<3)continue;const p=clipRing(path,extent);if(p.length<3||Math.abs(ringArea(p))<.1)continue;
    if(ringArea(p)>0||!group){group=[];groups.push(group);}group.push(p);
   }
   for(let gi=0;gi<groups.length;gi++){const rings=groups[gi],count=rings.reduce((n,p)=>n+p.length,0);
    if(count>RING_LIMIT){stats.complex++;continue;}if(records.length>=BUILDING_LIMIT||points.length+count>POINT_LIMIT){stats.overBudget++;continue;}
    const all=rings.flat(),cx=all.reduce((s,p)=>s+p[0],0)/count,cy=all.reduce((s,p)=>s+p[1],0)/count;
    const [lon,lat]=tilePointToLonLat(tile.z,tile.x,tile.y,extent,[cx,cy]).map(v=>v*rad),up=[Math.sin(lon)*Math.cos(lat),Math.sin(lat),Math.cos(lon)*Math.cos(lat)];
    const east=[Math.cos(lon),0,-Math.sin(lon)],north=[-Math.sin(lon)*Math.sin(lat),Math.cos(lat),-Math.cos(lon)*Math.sin(lat)],anchor=up.map(v=>v*R),hi=anchor.map(v=>Math.floor(v/4096)*4096),lo=anchor.map((v,k)=>v-hi[k]);
    const start=points.length,bounds=[Infinity,Infinity,-Infinity,-Infinity];
    for(const ring of rings){const first=points.length;for(let i=0;i<ring.length;i++){const p=ring[i],next=ring[(i+1)%ring.length];const [a,b]=tilePointToLonLat(tile.z,tile.x,tile.y,extent,p).map(v=>v*rad),w=[Math.sin(a)*Math.cos(b)*R,Math.sin(b)*R,Math.cos(a)*Math.cos(b)*R].map((v,k)=>v-anchor[k]);
     const x=w.reduce((s,v,k)=>s+v*east[k],0),y=w.reduce((s,v,k)=>s+v*north[k],0);bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y);
     const boundary=(p[0]===next[0]&&(p[0]===0||p[0]===extent))||(p[1]===next[1]&&(p[1]===0||p[1]===extent));
     points.push([x,y,first+(i+1)%ring.length,boundary?1:0]);
    }}
    const seed=hash(feature.id??`${tile.z}/${tile.x}/${tile.y}/${gi}/${cx}/${cy}`),meta=buildingMetadata(prop,seed);
    // A tile-cut footprint cannot identify a unique main entrance. For a
    // complete ground-level footprint choose one exterior wall in metres.
    const exteriorEnd=start+rings[0].length;
    let entrance=-1,longest=2.4,clipped=false;
    for(let j=start;j<exteriorEnd;j++){
     const [x,y,next,cut]=points[j];clipped||=cut!==0;
     const length=Math.hypot(points[next][0]-x,points[next][1]-y);
     if(length>longest){longest=length;entrance=j;}
    }
    if(meta.minimum===0&&meta.height>=2.4&&!clipped&&entrance>=0)points[entrance][3]|=2;
    records.push([...hi,meta.height,...lo,meta.minimum,...east,meta.style,...north,meta.roofHeight,...bounds,start,count,seed,0,...meta.colour,meta.roofKind]);if(meta.estimated)stats.estimatedHeights++;
   }
  }
 }
 stats.buildings=records.length;appendRoadSources(tiles,records,points,stats);
 const rb=new ArrayBuffer(records.length*112),rf=new Float32Array(rb),ru=new Uint32Array(rb);
 records.forEach((r,i)=>{rf.set(r,i*28);for(let k=20;k<24;k++)ru[i*28+k]=r[k];});
 const pb=new ArrayBuffer(points.length*16),pf=new Float32Array(pb),pu=new Uint32Array(pb);points.forEach((p,i)=>{pf[i*4]=p[0];pf[i*4+1]=p[1];pu[i*4+2]=p[2];pu[i*4+3]=p[3];});
 stats.points=points.length;return {records:rb,points:pb,stats};
}
