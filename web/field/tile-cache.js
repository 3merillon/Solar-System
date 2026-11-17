// Bounded LRU of decoded tiles (by byte budget) with in-flight de-duplication.
// Concurrent requests for one tile share one fetch. An owner (a page) that stops needing a tile only
// aborts the fetch when no other owner wants it. A real 404 is remembered for the life of the cache.
// A height tile prepared for water holds its raw heights, and its prepared heights and levels where those differ.
export const tileBytes=t=>(t?.heights?.byteLength??0)+(t?.rgba?.byteLength??0)+(t?.prepared&&t.prepared.heights!==t.heights?t.prepared.heights.byteLength:0)+(t?.prepared?.water?.byteLength??0)+64;
export function createTileCache({budgetBytes=128*1024*1024,sizeOf=tileBytes}={}){
 const lru=new Map(),negative=new Set(),flights=new Map(),owned=new Map(); // owned: owner -> Set(key)
 let bytes=0;const stat={hits:0,misses:0,shared:0,evictions:0,negativeHits:0,aborted:0};
 function evict(key){for(const [k,e] of lru){if(bytes<=budgetBytes||k===key)break;lru.delete(k);bytes-=e.size;stat.evictions++;}}
 function store(key,tile){
  const size=sizeOf(tile);lru.set(key,{tile,size});bytes+=size;evict(key);
 }
 // A tile in the cache grew.
 function resized(key){const e=lru.get(key);if(!e)return;const size=sizeOf(e.tile);bytes+=size-e.size;e.size=size;evict(key);}
 function forget(owner,key){const s=owned.get(owner);if(s){s.delete(key);if(!s.size)owned.delete(owner);}}
 // load(priority) -> {promise: Promise<tile>, cancel(), setPriority(p)}; a rejection with status 404 is a real 404.
 function request(key,owner,priority,load){
  const hit=lru.get(key);
  if(hit){lru.delete(key);lru.set(key,hit);stat.hits++;return Promise.resolve(hit.tile);}
  if(negative.has(key)){stat.negativeHits++;return Promise.resolve(null);}
  let f=flights.get(key);
  if(f){stat.shared++;if(priority<f.priority){f.priority=priority;f.handle.setPriority(priority);}}
  else{
   stat.misses++;
   f={priority,owners:new Set(),handle:load(priority)};
   f.promise=f.handle.promise.then(tile=>{store(key,tile);return tile;},e=>{
    if(e?.status===404){negative.add(key);return null;}
    throw e;
   }).finally(()=>{if(flights.get(key)===f)flights.delete(key);for(const o of f.owners)forget(o,key);});
   f.promise.catch(()=>{}); // the awaiting owner handles it; an abandoned flight must not warn
   flights.set(key,f);
  }
  f.owners.add(owner);
  let s=owned.get(owner);if(!s)owned.set(owner,s=new Set());s.add(key);
  return f.promise;
 }
 // The owner no longer wants anything it asked for. Fetches nobody else wants are aborted.
 function release(owner){
  const keys=owned.get(owner);if(!keys)return;
  owned.delete(owner);
  for(const key of keys){
   const f=flights.get(key);if(!f)continue;
   f.owners.delete(owner);
   if(!f.owners.size){flights.delete(key);stat.aborted++;f.handle.cancel();}
  }
 }
 return {request,release,resized,get:key=>lru.get(key)?.tile,hasNegative:key=>negative.has(key),
  stats:()=>({...stat,bytes,entries:lru.size,negative:negative.size,inFlight:flights.size,budgetBytes})};
}
