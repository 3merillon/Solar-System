// Upload measured centreline endpoints and width metadata. The GPU alone
// shades these roads directly on the displayed terrain, preserving its depth.
import {tilePointToLonLat} from './vector-tile.js';
export const ROAD_LIMIT=2048;
const widths={motorway:14,trunk:11,primary:9,secondary:8,tertiary:7,minor:5.5,service:3.6,track:3,path:1.8};
function metresBetween(tile,extent,a,b){
 const [lon,lat]=tilePointToLonLat(tile.z,tile.x,tile.y,extent,a).map(x=>x*Math.PI/180);
 const [lon2,lat2]=tilePointToLonLat(tile.z,tile.x,tile.y,extent,b).map(x=>x*Math.PI/180);
 const h=Math.sin((lat2-lat)/2)**2+Math.cos(lat)*Math.cos(lat2)*Math.sin((lon2-lon)/2)**2;
 return 2*6371000*Math.asin(Math.sqrt(Math.min(1,h)));
}
// Clip buffered MVT lines at the tile border so adjacent tiles own disjoint spans.
export function clipRoad(a,b,extent){
 let lo=0,hi=1;const d=[b[0]-a[0],b[1]-a[1]];
 for(let axis=0;axis<2;axis++){
  if(Math.abs(d[axis])<1e-9){if(a[axis]<0||a[axis]>=extent)return null;continue;}
  const x=-a[axis]/d[axis],y=(extent-a[axis])/d[axis];lo=Math.max(lo,Math.min(x,y));hi=Math.min(hi,Math.max(x,y));
 }
 return hi>lo?[a.map((v,k)=>v+d[k]*lo),a.map((v,k)=>v+d[k]*hi)]:null;
}
export function appendRoadSources(tiles,records,points,stats){
 let count=0;stats.roads=0;stats.roadOverflow=0;stats.roadWidthsEstimated=0;
 for(const tile of tiles){const layer=tile.layers?.transportation;if(!layer)continue;
  for(const f of layer.features){const p=f.properties||{},kind=p.class;if(!Object.hasOwn(widths,kind)||p.brunnel==='tunnel'||p.brunnel==='bridge')continue;
   const explicit=parseFloat(p.width),lanes=parseFloat(p.lanes);const width=Math.max(1,Math.min(30,explicit>0?explicit:lanes>0?lanes*3.2:widths[kind]));
   for(const path of f.paths){let travelled=0;for(let i=1;i<path.length;i++){
    const phase=travelled;travelled+=metresBetween(tile,layer.extent,path[i-1],path[i]);
    const span=clipRoad(path[i-1],path[i],layer.extent);if(!span)continue;
    const [a,b]=span,cx=(a[0]+b[0])/2,cy=(a[1]+b[1])/2;
    if(count>=ROAD_LIMIT||records.length>=16384||points.length+2>131072){stats.roadOverflow++;continue;}
    const [lon,lat]=tilePointToLonLat(tile.z,tile.x,tile.y,layer.extent,[cx,cy]).map(x=>x*Math.PI/180),R=6371000;
    const up=[Math.sin(lon)*Math.cos(lat),Math.sin(lat),Math.cos(lon)*Math.cos(lat)],east=[Math.cos(lon),0,-Math.sin(lon)],north=[-Math.sin(lon)*Math.sin(lat),Math.cos(lat),-Math.cos(lon)*Math.sin(lat)];
    const anchor=up.map(x=>x*R),hi=anchor.map(x=>Math.floor(x/4096)*4096),lo=anchor.map((x,k)=>x-hi[k]);
    const local=q=>{const [o,t]=tilePointToLonLat(tile.z,tile.x,tile.y,layer.extent,q).map(x=>x*Math.PI/180);const d=[Math.sin(o)*Math.cos(t)*R,Math.sin(t)*R,Math.cos(o)*Math.cos(t)*R].map((x,k)=>x-anchor[k]);return [east,north].map(axis=>axis.reduce((sum,x,k)=>sum+x*d[k],0));};
    const x=local(a),y=local(b);if(Math.hypot(y[0]-x[0],y[1]-x[1])<.2)continue;
    const start=points.length;points.push([...x,start+1,0],[...y,start,0]);
    const seed=(Math.imul(tile.x,73856093)^Math.imul(tile.y,19349663)^Math.imul(i,83492791))>>>0;
    const unpaved=['track','path'].includes(kind)||['gravel','dirt','unpaved'].includes(p.surface),colour=unpaved?[.2,.17,.12]:[.038,.044,.052];
    const dashPhase=(phase+metresBetween(tile,layer.extent,path[i-1],a))%6;
    records.push([...hi,.08,...lo,0,...east,width,...north,dashPhase,Math.min(x[0],y[0])-width,Math.min(x[1],y[1])-width,Math.max(x[0],y[0])+width,Math.max(x[1],y[1])+width,start,2,seed,0,...colour,unpaved?-2:-1]);
    count++;if(!(explicit>0))stats.roadWidthsEstimated++;
   }}
  }
 }
 stats.roads=count;
}
