// Bounded live source residency. Network never stalls rendering. Four requests,
// nine full z14 tiles, four outer building tiles, sixteen cached tiles and a 32 MiB budget.
import {decodeVectorTile} from './vector-tile.js';
import {buildingSources} from './buildings.js';
import {createBuildingResidency,packedSources} from './building-residency.js';
export const VECTOR_CREDIT='© OpenStreetMap contributors https://www.openstreetmap.org/copyright · OpenMapTiles https://openmaptiles.org · OpenFreeMap https://openfreemap.org. Building heights, missing river widths and all river beds are estimates.';
export function createVectors({fetch:fetchFn=globalThis.fetch.bind(globalThis),publish=()=>{},stats=()=>{}}={}){
 let template=null,resolving=null,closed=false,wanted=[],timer=null;const cache=new Map(),active=new Map(),failed=new Map();let bytes=0;
 // Identity only: no second tile cache. New fetches have new serials, including
 // a refetch of the same address after eviction. Each body owns a new instance.
 let serial=0,lastSelection=null,lastComplete=false,retained=false,eyePosition=null,pixelHeight=1080,lastScored=null,lastHeight=0;
 let view=null,lastView=null;
 const residents=createBuildingResidency(),deferredSizes=new Map();
 const byteLimit=32*1024*1024;
 const counters={tiles:0,failed:0,cancelled:0,cacheBytes:0,overBudget:0,publications:0,unchanged:0};
 const key=t=>`${t.z}/${t.x}/${t.y}`;
 async function resolve(){if(template)return template;if(!resolving)resolving=(async()=>{const r=await fetchFn('https://tiles.openfreemap.org/planet',{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(`Vector metadata HTTP ${r.status}`);const j=await r.json();const url=j.tiles?.[0];if(!url?.startsWith('https://tiles.openfreemap.org/'))throw Error('Unexpected vector tile host');return template=url;})().finally(()=>{resolving=null;});return resolving;}
 const report=()=>stats({...counters,cacheBytes:bytes,active:active.size,wanted:wanted.length,attribution:VECTOR_CREDIT});
 function viewChanged(){
  if(lastHeight!==pixelHeight||!!eyePosition!==!!lastScored)return true;
  if(eyePosition&&Math.hypot(eyePosition[0]-lastScored[0],eyePosition[1]-lastScored[1],eyePosition[2]-lastScored[2])>=100)return true;
  if(lastComplete)return false;
  if(!view||!lastView)return view!==lastView;
  return view.edge!==lastView.edge||Math.abs(view.ground-lastView.ground)>=100||view.x*lastView.x+view.y*lastView.y+view.z*lastView.z<.996;
 }
 function publishNow(){timer=null;if(closed)return;const selected=[];
  for(const address of wanted){
   const tile=cache.get(key(address));
   if(tile&&!tile.source.missing)selected.push({...tile,outer:address.outer});
  }
  const keys=selected.map(t=>`${key(t)}:${t.serial}:${t.outer?1:0}`);
  const membership=[...keys].sort().join(','),order=keys.join(',');
  const same=lastSelection?.membership===membership&&(lastComplete||lastSelection.order===order);
  if(same&&(lastComplete&&!retained||!viewChanged())){counters.unchanged++;report();return;}
  lastScored=eyePosition;lastHeight=pixelHeight;lastView=view;
  const out=residents.update(selected,eyePosition,pixelHeight,same,view);
  lastSelection={membership,order};
  if(out){retained=out.stats.retainedBuildings>0;lastComplete=out.stats.overBudget===0&&out.stats.roadOverflow===0;counters.publications++;publish(out);}
  else counters.unchanged++;
  report();}
 function changed(){if(!timer)timer=setTimeout(publishNow,150);}
 function trim(){
  if(cache.size<=16&&bytes<=byteLimit)return;
  const priority=new Map(wanted.map((t,i)=>[key(t),i]));
  const entries=[...cache].sort(([a],[b])=>(priority.get(b)??wanted.length)-(priority.get(a)??wanted.length));
  for(const [k,t] of entries){
   if(cache.size<=16&&bytes<=byteLimit)break;
   cache.delete(k);bytes-=t.bytes;counters.overBudget++;
   if(priority.has(k))deferredSizes.set(k,t.bytes);
  }
 }
 function pump(){if(closed)return;let higherBytes=0;for(const tile of wanted){const k=key(tile);if(active.size>=4)break;
   const resident=cache.get(k);if(resident){higherBytes+=resident.bytes;continue;}
   if(active.has(k)||(failed.get(k)||0)>Date.now()||(deferredSizes.get(k)||0)+higherBytes>byteLimit)continue;
   const controller=new AbortController();active.set(k,controller);
   (async()=>{try{
    const url=(await resolve()).replace('{z}',tile.z).replace('{x}',tile.x).replace('{y}',tile.y);if(controller.signal.aborted)return;
    const r=await fetchFn(url,{signal:controller.signal});if(!r.ok&&r.status!==404)throw Error(`Vector HTTP ${r.status}`);
    const b=r.status===404?new ArrayBuffer(0):await r.arrayBuffer();if(controller.signal.aborted||closed)return;
    const layers=decodeVectorTile(b,['building','water','waterway','transportation']);
    // The decoder already bounds a single tile. Apply the GPU limits across
    // all candidates after ranking, so dense tiles cannot lose their near end
    // just because its footprints occurred last in the vector file.
    const packed=packedSources(buildingSources([{...tile,layers}],{maxRecords:Infinity,maxPoints:Infinity}));
    // Only hydrology consumes decoded geometry after normalization.
    delete layers.building;delete layers.transportation;
    const size=b.byteLength+packed.words.byteLength+packed.points.byteLength+Object.values(layers).reduce((sum,l)=>sum+l.features.reduce((n,f)=>n+256+f.paths.reduce((v,p)=>v+p.length*32,0),0),0);
    if(size>byteLimit){counters.overBudget++;failed.set(k,Date.now()+30000);return;}
    const source={z:tile.z,x:tile.x,y:tile.y,layers,missing:!b.byteLength};
    deferredSizes.delete(k);cache.set(k,{...tile,source,packed,bytes:size,serial:++serial});bytes+=size;counters.tiles++;trim();changed();
   }catch(e){if(e.name!=='AbortError'){failed.set(k,Date.now()+30000);counters.failed++;}}finally{active.delete(k);report();pump();}})();
  }}
 function eye(position,height=1080,target,width,ground=0){if(closed)return;for(const [k,t] of failed)if(t<=Date.now())failed.delete(k);const [x,y,z]=position,r=Math.hypot(x,y,z),alt=r-6371000;let next=[];
  eyePosition=Number.isFinite(r)&&alt> -2000?[x,y,z]:null;
  if(Number.isFinite(height)&&height>0)pixelHeight=height;
  view=null;
  if(target&&eyePosition){
   const dx=target[0]-x,dy=target[1]-y,dz=target[2]-z,len=Math.hypot(dx,dy,dz);
   const aspect=width>0?width/pixelHeight:16/9;
   if(len>0)view={x:dx/len,y:dy/len,z:dz/len,edge:1/Math.sqrt(1+(1+aspect*aspect)/3),ground:Number.isFinite(ground)?ground:0};
  }
  if(alt<18000&&alt> -2000){const lat=Math.asin(y/r);if(Math.abs(lat)<85*Math.PI/180){const n=16384,cx=(.5+Math.atan2(x,z)/(2*Math.PI))*n,cy=(.5-Math.atanh(Math.sin(lat))/(2*Math.PI))*n;
   for(let b=-2;b<=2;b++)for(let a=-2;a<=2;a++){if(Math.abs(a)+Math.abs(b)>2)continue;const tx=Math.floor(cx)+a,ty=Math.floor(cy)+b;if(ty>=0&&ty<n)next.push({z:14,x:(tx+n)%n,y:ty,outer:Math.abs(a)===2||Math.abs(b)===2,distance:(tx+.5-cx)**2+(ty+.5-cy)**2});}
   next.sort((a,b)=>Number(a.outer)-Number(b.outer)||a.distance-b.distance);}}
  if(next.map(key).join()!==wanted.map(key).join()){wanted=next;const needed=new Set(wanted.map(key));for(const [k,c] of active)if(!needed.has(k)){c.abort();counters.cancelled++;}for(const k of deferredSizes.keys())if(!needed.has(k))deferredSizes.delete(k);changed();}
  else if((retained||!lastComplete)&&viewChanged())changed();
  pump();
 }
 return {eye,template:resolve,get(z,x,y){return cache.get(`${z}/${x}/${y}`)?.source;},close(){closed=true;clearTimeout(timer);for(const c of active.values())c.abort();cache.clear();},snapshot:()=>({...counters,cacheBytes:bytes})};
}
