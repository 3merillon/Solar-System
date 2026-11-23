// Bounded live source residency. Network never stalls rendering. Four requests,
// nine full z14 tiles, four outer building tiles, sixteen cached tiles and a 32 MiB budget.
import {decodeVectorTile} from './vector-tile.js';
import {buildingSources} from './buildings.js';
export const VECTOR_CREDIT='© OpenStreetMap contributors https://www.openstreetmap.org/copyright · OpenMapTiles https://openmaptiles.org · OpenFreeMap https://openfreemap.org. Building heights, missing river widths and all river beds are estimates.';
export function createVectors({fetch:fetchFn=globalThis.fetch.bind(globalThis),publish=()=>{},stats=()=>{}}={}){
 let template=null,resolving=null,closed=false,wanted=[],timer=null;const cache=new Map(),active=new Map(),failed=new Map();let bytes=0;
 // Identity only: no second tile cache. New fetches have new serials, including
 // a refetch of the same address after eviction. Each body owns a new instance.
 let serial=0,lastSelection=null,lastComplete=false;
 const counters={tiles:0,failed:0,cancelled:0,cacheBytes:0,overBudget:0,publications:0,unchanged:0};
 const key=t=>`${t.z}/${t.x}/${t.y}`;
 async function resolve(){if(template)return template;if(!resolving)resolving=(async()=>{const r=await fetchFn('https://tiles.openfreemap.org/planet',{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(`Vector metadata HTTP ${r.status}`);const j=await r.json();const url=j.tiles?.[0];if(!url?.startsWith('https://tiles.openfreemap.org/'))throw Error('Unexpected vector tile host');return template=url;})().finally(()=>{resolving=null;});return resolving;}
 const report=()=>stats({...counters,cacheBytes:bytes,active:active.size,wanted:wanted.length,attribution:VECTOR_CREDIT});
 function publishNow(){timer=null;if(closed)return;const selected=[];
  for(const address of wanted){const tile=cache.get(key(address));if(tile)selected.push({...tile,outer:address.outer,layers:address.outer?{building:tile.layers.building}:tile.layers});}
  const selection=selected.map(t=>`${key(t)}:${t.serial}:${t.outer?1:0}`).sort().join(',');
  // Priority order can change within one tile. If the complete set fit last
  // time, reordering changes no source. Under capacity pressure priority still
  // determines admission, so build/publish normally and retain overflow reports.
  if(lastComplete&&selection===lastSelection&&Number.isSafeInteger(serial)){counters.unchanged++;report();return;}
  const out=buildingSources(selected);lastSelection=selection;lastComplete=out.stats.overBudget===0&&(out.stats.roadOverflow||0)===0;counters.publications++;publish(out);report();}
 function changed(){if(!timer)timer=setTimeout(publishNow,150);}
 function trim(){for(const [k,t] of cache){if(cache.size<=16&&bytes<=32*1024*1024)break;cache.delete(k);bytes-=t.bytes;failed.set(k,Date.now()+30000);counters.overBudget++;}}
 function pump(){if(closed)return;for(const tile of wanted){const k=key(tile);if(active.size>=4)break;if(cache.has(k)||active.has(k)||(failed.get(k)||0)>Date.now())continue;const controller=new AbortController();active.set(k,controller);
   (async()=>{try{const url=(await resolve()).replace('{z}',tile.z).replace('{x}',tile.x).replace('{y}',tile.y);if(controller.signal.aborted)return;const r=await fetchFn(url,{signal:controller.signal});if(!r.ok)throw Error(`Vector HTTP ${r.status}`);const b=await r.arrayBuffer();if(controller.signal.aborted||closed)return;const layers=decodeVectorTile(b,['building','water','waterway','transportation']);const size=b.byteLength+Object.values(layers).reduce((sum,l)=>sum+l.features.reduce((n,f)=>n+256+f.paths.reduce((v,p)=>v+p.length*32,0),0),0);if(size>32*1024*1024){counters.overBudget++;failed.set(k,Date.now()+30000);return;}cache.set(k,{...tile,layers,bytes:size,serial:++serial});bytes+=size;counters.tiles++;trim();changed();}catch(e){if(e.name!=='AbortError'){failed.set(k,Date.now()+30000);counters.failed++;}}finally{active.delete(k);report();pump();}})();
  }}
 function eye(position){if(closed)return;for(const [k,t] of failed)if(t<=Date.now())failed.delete(k);const [x,y,z]=position,r=Math.hypot(x,y,z),alt=r-6371000;let next=[];
  if(alt<18000&&alt> -2000){const lat=Math.asin(y/r);if(Math.abs(lat)<85*Math.PI/180){const n=16384,cx=(.5+Math.atan2(x,z)/(2*Math.PI))*n,cy=(.5-Math.atanh(Math.sin(lat))/(2*Math.PI))*n;
   for(let b=-2;b<=2;b++)for(let a=-2;a<=2;a++){if(Math.abs(a)+Math.abs(b)>2)continue;const tx=Math.floor(cx)+a,ty=Math.floor(cy)+b;if(ty>=0&&ty<n)next.push({z:14,x:(tx+n)%n,y:ty,outer:Math.abs(a)===2||Math.abs(b)===2,distance:(tx+.5-cx)**2+(ty+.5-cy)**2});}
   next.sort((a,b)=>Number(a.outer)-Number(b.outer)||a.distance-b.distance);}}
  if(next.map(key).join()!==wanted.map(key).join()){wanted=next;for(const [k,c] of active)if(!wanted.some(t=>key(t)===k)){c.abort();counters.cancelled++;}changed();}pump();
 }
 return {eye,template:resolve,get(z,x,y){return cache.get(`${z}/${x}/${y}`);},close(){closed=true;clearTimeout(timer);for(const c of active.values())c.abort();cache.clear();},snapshot:()=>({...counters,cacheBytes:bytes})};
}
