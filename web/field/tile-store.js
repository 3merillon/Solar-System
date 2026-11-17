// A tile store on the user's own machine, so that flying back over a place asks nothing of a free service. EOX's FAQ recommends it: "cache tiles on your own CDN or device".
// Raw bytes as the source sent them, in the browser's Cache Storage, so that nothing here depends on how they are decoded. An index in memory says what is held, which answers a miss
// with no disk read. Over its budget it drops what is least likely to be wanted again: far from where the camera has been, long unused, and fine, as a coarse tile covers more ground and is
// read from farther away. Everything here may fail, or the browser may clear it: a tile not found is only asked for again.
import {mercatorToLonLat,lonLatToDirection,R} from './chart.js';
export const TILE_STORE_NAME='solar-tiles-v1';
const INDEX_PATH='/__strata-tiles/index',path=key=>`/__strata-tiles/${key}`;
const MOST_BYTES=2*1024*1024*1024,QUOTA_SHARE=0.2,KEEP_SHARE=0.9,SAVE_INDEX_MS=10000,TIDY_AFTER_MS=5000,BACK_OFF_AFTER_ERROR_MS=60000;
// What makes a tile worth dropping, in days of not being used: 500 km from the camera counts as one, and so do four zoom levels.
const KM_PER_DAY=500,ZOOMS_PER_DAY=4,MS_PER_DAY=86400000;
export function dropScore(key,used,eye,t){
 const [,z,x,y]=key.split('/').map(Number),n=2**z,direction=lonLatToDirection(...mercatorToLonLat((x+0.5)/n,(y+0.5)/n));
 const along=eye?Math.max(-1,Math.min(1,direction[0]*eye[0]+direction[1]*eye[1]+direction[2]*eye[2])):1;
 return Math.acos(along)*R/1000/KM_PER_DAY+Math.max(0,t-used)/MS_PER_DAY+z/ZOOMS_PER_DAY;
}
// Null if the browser has no Cache Storage here. caches, estimate, now and setTimer are for tests.
export async function openTileStore({caches:storage=globalThis.caches,estimate=()=>globalThis.navigator?.storage?.estimate?.(),now=Date.now,setTimer=setTimeout,name=TILE_STORE_NAME,budgetBytes=null}={}){
 if(!storage)return null;
 let cache=null;
 try{cache=await storage.open(name);}catch{return null;}
 // Entries [bytes, last used]. The key is source/z/x/y.
 const index=new Map(),count={hits:0,misses:0,writes:0,dropped:0,hitBytes:0};
 let total=0,dirty=false,eye=null,error=null,quietUntil=0,saving=false,closed=false,saveTimer=null;
 try{
  const saved=await cache.match(INDEX_PATH);
  if(saved)for(const [key,bytes,used] of await saved.json()){index.set(key,[bytes,used]);total+=bytes;}
 }catch{ // An index that cannot be read says nothing about what is held, so start again.
  index.clear();total=0;
  try{await storage.delete(name);cache=await storage.open(name);}catch{return null;}
 }
 let budget=budgetBytes;
 if(budget===null){budget=MOST_BYTES;try{const e=await estimate();if(e?.quota)budget=Math.min(MOST_BYTES,e.quota*QUOTA_SHARE);}catch{}}
 const forget=key=>{const e=index.get(key);if(e){total-=e[0];index.delete(key);dirty=true;}};
 function drop(){
  const t=now(),list=[...index].map(([key,e])=>[dropScore(key,e[1],eye,t),key]).sort((a,b)=>b[0]-a[0]);
  for(const [,key] of list){
   if(total<=budget*KEEP_SHARE)break;
   forget(key);count.dropped++;cache.delete(path(key)).catch(()=>{});
  }
 }
 async function save(){
  saveTimer=null;
  if(!dirty||saving)return;
  saving=true;dirty=false;
  try{await cache.put(INDEX_PATH,new Response(JSON.stringify([...index].map(([key,e])=>[key,e[0],e[1]])),{headers:{'content-type':'application/json'}}));}
  catch(e){error=String(e?.message||e);dirty=true;}
  saving=false;
 }
 const soon=()=>{if(saveTimer===null&&!closed)saveTimer=setTimer(save,SAVE_INDEX_MS);};
 // What the index no longer knows, written just before the last session ended.
 setTimer(async()=>{
  try{
   for(const request of await cache.keys()){
    const at=new URL(request.url,'http://local').pathname;
    if(at===INDEX_PATH)continue;
    const key=decodeURIComponent(at.slice('/__strata-tiles/'.length));
    if(!index.has(key))cache.delete(request).catch(()=>{});
   }
  }catch{}
 },TIDY_AFTER_MS);
 return {
  has:key=>index.has(key),
  // The bytes, or null if they are gone: the caller then fetches.
  async get(key){
   const e=index.get(key);
   if(!e){count.misses++;return null;}
   try{
    const r=await cache.match(path(key));
    if(!r){forget(key);count.misses++;return null;}
    const bytes=await r.arrayBuffer();
    e[1]=now();dirty=true;soon();count.hits++;count.hitBytes+=bytes.byteLength;
    return bytes;
   }catch{forget(key);count.misses++;return null;}
  },
  // Takes its own copy of nothing: pass bytes that are not going to be transferred elsewhere.
  put(key,bytes,mime){
   if(index.has(key)||bytes.byteLength>budget*0.01||now()<quietUntil)return;
   cache.put(path(key),new Response(bytes,{headers:{'content-type':mime||'application/octet-stream'}})).then(()=>{
    if(index.has(key))return;
    index.set(key,[bytes.byteLength,now()]);total+=bytes.byteLength;count.writes++;dirty=true;soon();
    if(total>budget)drop();
   },e=>{error=String(e?.message||e);quietUntil=now()+BACK_OFF_AFTER_ERROR_MS;if(total>budget*0.5)drop();});
  },
  // Where the camera is looking now, a unit vector, for what to keep.
  setEye(direction){eye=direction;},
  save,
  close(){closed=true;return save();},
  stats:()=>({bytes:total,tiles:index.size,budgetBytes:budget,...count,error}),
 };
}
