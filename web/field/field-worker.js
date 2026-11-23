// Field worker: the only code that touches the network. It never decides what is wanted (Rust does), never touches
// WebGPU, and never blocks the render worker: all traffic is on one MessagePort. It is the scheduler, the fetcher and the
// tile LRU; decoding fetched tiles and building pages run in a pool of field-decoder.js workers (pool.js), which keeps one
// busy core per page build instead of one for all of them. If the pool cannot start or a decoder fails, the work is done here.
//   in:  first message {type:'init',port,manifest,proxy,pack?,waterLayer?}; then on the port {type:'want',pages:[{id,face,level,x,y,channel,priority}],cancel:[id]}
//        waterLayer: build height pages with the water layer and the terrain from it (water-layer.js, docs/WATER-LAYER.md);
//        a page message then carries waterLayer:{bytes,levelOffset,levelScale,uniform,stats}
//        pack: path relative to the site root (for example 'pack/pack-earth-v1/'); the pinned pages stream in as normal page messages
//   out: {type:'page',id,face,level,x,y,channel,source,offset,scale,bytes} (bytes transferred; pinned pages have id 0 and source 'pack')
//        | {type:'missing',...} | {type:'failed',...,status} | {type:'ready',sources} | {type:'attribution',sources:[string]} | {type:'stats',...}
import {riverTilePlan,RIVER_ZOOM} from './rivers.js';
import {MAP_WATER_MIN_LEVEL} from './map-water.js';
import {decodeVectorTile} from './vector-tile.js';
import {createVectors,VECTOR_CREDIT} from './vectors.js';
import {resolveSources,proxyUrl,hostOf,UNSEEN_RANK} from './sources.js';
import {createScheduler} from './scheduler.js';
import {createTileCache} from './tile-cache.js';
import {openTileStore} from './tile-store.js';
import {chartToDirection} from './chart.js';
import {decodeTerrarium,decodePng} from './png.js';
import {makeImageDecoder} from './image.js';
import {createPool,poolSizeFor} from './pool.js';
import {SHORE_LOWEST_ZOOM} from './seabed.js';
import {LAKE_IMAGE_ZOOM} from './water.js';
import {WATER_STEPS} from './water-steps.js';
import {nodesForPage,requiredTiles,overlayTiles,overlayApplies,buildHeightPage,buildAlbedoPage,buildOverlayAlbedoPage,coarseRiverDemZoom} from './resample.js';
import {WATER_BAND} from './water-layer.js';

// The water layer's page as a message carries it (as field-decoder.js stripWater does for pool builds).
function stripWaterPage(r){const w=r?.waterPage;if(w===undefined)return;delete r.waterPage;if(!w)return;r.waterLayer={bytes:w.uniform?null:w.bytes.buffer,levelOffset:w.levelOffset,levelScale:w.levelScale,uniform:w.uniform,stats:{wet:w.stats.wet,shore:w.stats.shore,pieces:w.stats.pieces,unresolved:w.stats.unresolved,fallbackLevel:w.stats.fallbackLevel,overBudget:w.stats.overBudget,terrainLimited:w.stats.terrain?.terrainLimited??0}};}
// Yield to the event loop between pages (MessageChannel avoids the 4 ms timer clamp) so one page never holds it for long.
const makeYielder=()=>{let ch=null,waiting=[];return ()=>new Promise(r=>{if(!ch){ch=new MessageChannel();ch.port1.onmessage=()=>{const w=waiting;waiting=[];for(const f of w)f();};}waiting.push(r);ch.port2.postMessage(0);});};
const channelOf=c=>c===0||c==='height'?'height':'albedo';
const ident=(w,extra)=>({id:w.id,face:w.face,level:w.level,x:w.x,y:w.y,channel:w.channel,...extra});
const defaultSpawn=i=>new Worker(new URL('./field-decoder.js',import.meta.url),{type:'module',name:`Solar-System v2 field decoder ${i}`});

// env (all optional, for tests): spawn(i) -> Worker-like, poolSize, fetch, importPack(), siteRoot (URL string), statsMs, decodeImage.
export function initField(data,env={}){
 const vectors=!data.manifest?.baked?(env.createVectors??createVectors)({fetch:(url,options)=>(env.fetch||globalThis.fetch.bind(globalThis))(proxyUrl(url,data.proxy||''),options),publish:out=>data.port.postMessage({type:'buildings',...out},[out.records,out.points]),stats:value=>data.port.postMessage({type:'vectorStats',...value})}):null;
 const port=data.port,resolved=resolveSources(data.manifest),cfg={height:resolved.height,albedo:resolved.albedo,overlays:resolved.overlays},waterLayer=!!data.waterLayer;
 const proxy=data.proxy||'',lim=resolved.manifest.limits||{};
 const hostLimits=Object.fromEntries(Object.values(resolved.sources).filter(s=>s.limits).map(s=>[hostOf(s.tileUrl(0,0,0)),s.limits]));
 const sched=createScheduler({fetch:env.fetch,perHost:lim.perHost,global:lim.global,hostLimits,unseenRank:UNSEEN_RANK});
 const cache=createTileCache({budgetBytes:resolved.manifest.cacheBytes});
 // The disk first, so that going back over a place asks nothing of a source. Until it opens, or where there is none, every tile comes from the network. The first pages wait a moment for it, not for long.
 let store=null;
 const storeOpen=(env.tileStore===null?Promise.resolve(null):openTileStore(env.tileStore||{})).then(s=>{store=s;return s;},()=>null);
 const storeReady=Promise.race([storeOpen,new Promise(r=>setTimeout(r,500))]);
 const decodeImage=makeImageDecoder(env.decodeImage||{});
 const jobs=new Map(),count={completed:0,failed:0,missing:0,cancelled:0,poolBuilds:0,localBuilds:0,waterDegraded:0,waterMs:0,waterTiles:0,provisional:0,riverPages:0,riverOmitted:0,riverMissingHeight:0,riverTerrainLimited:0,riverTilesOmitted:0,riverTexelPages:0,riverBankLimited:0,mapWaterPages:0,mapWaterOverBudget:0,mapWaterDisagreeing:0,waterTexelPages:0,waterLayerPages:0,waterLayerUniform:0},times=[];
 const pack={pages:0,done:false,error:null};
 const yielder=makeYielder();let chain=Promise.resolve();
 const turn=fn=>{const p=chain.then(async()=>{await yielder();return fn();});chain=p.catch(()=>{});return p;};

 let pool=null,poolInitError=null;
 try{
  const size=env.poolSize??poolSizeFor(globalThis.navigator?.hardwareConcurrency);
  if(env.spawn||typeof Worker!=='undefined')pool=createPool({spawn:env.spawn||defaultSpawn,size,manifest:data.manifest||null});
  else poolInitError='Worker is not available in the field worker';
 }catch(e){poolInitError=String(e?.message||e);}
 const poolUp=()=>pool!==null&&pool.alive>0;

 const localDecode=(source,bytes)=>source.decoder==='terrarium'?decodeTerrarium(bytes):decodeImage(bytes,source.mime);
 // Decode in the pool (bytes are transferred). A pool failure loses the transferred bytes, so fetch them again and decode here.
 async function decodeTile(source,bytes,priority,refetch){
  if(poolUp()){
   try{return await pool.decode(source.decoder==='terrarium'?'terrarium':'image',source.mime,bytes,{priority});}
   catch(e){if(e?.name!=='PoolFailed')throw e;bytes=(await refetch()).bytes;}
  }
  return localDecode(source,bytes);
 }
 // Requests under way by tile, for telling one still queued from one the host is answering.
 const asking=new Map();
 const loader=(source,z,x,y)=>priority=>{
  const url=proxyUrl(source.tileUrl(z,x,y),proxy),host=hostOf(source.tileUrl(z,x,y)),key=`${source.id}/${z}/${x}/${y}`;
  const fetched=at=>{const h=sched.request(url,{priority:at,host}),done=()=>{if(asking.get(key)===h)asking.delete(key);};asking.set(key,h);h.promise.then(done,done);return {handle:h,promise:h.promise.then(r=>{store?.put(key,r.bytes.slice(0),source.mime);return decodeTile(source,r.bytes,at,()=>sched.request(url,{priority:at,host}).promise);})};};
  if(!store?.has(key)){const f=fetched(priority);return {promise:f.promise,cancel:()=>f.handle.cancel(),setPriority:p=>f.handle.setPriority(p)};}
  // Held on disk. If it has gone, as the browser may clear it, the tile is asked for like any other.
  let at=priority,gone=false,f=null;
  const promise=store.get(key).then(bytes=>{
   if(gone)throw Object.assign(new Error('cancelled'),{name:'AbortError'});
   if(bytes)return decodeTile(source,bytes,at,()=>sched.request(url,{priority:at,host}).promise);
   f=fetched(at);return f.promise;
  });
  return {promise,cancel:()=>{gone=true;f?.handle.cancel();},setPriority:p=>{at=p;f?.handle.setPriority(p);}};
 };

 // Vector centerlines and the fixed z13 DEM needed at their source endpoints.
 // A failed source marks the page provisional, allowing the existing retry path.
 // One river network for every page level: always the z14 lines (rivers.js). Pages from MAP_WATER_MIN_LEVEL read the map's
 // water polygons too, from z(level+1) tiles below RIVER_MIN_LEVEL (map-water.js). The tiles are shared by every page
 // over them, kept in memory and on disk like any other tile, and asked for as soon as a page wants them, beside its
 // height tiles rather than after them, so that a page with a river is not the last to arrive.
 const riverCache=new Map(),riverPending=new Map();let riverBytes=0;
 const riverLayers=bytes=>{const layers=decodeVectorTile(bytes,['water','waterway']);return {layers,bytes:bytes.byteLength+Object.values(layers).reduce((sum,l)=>sum+l.features.reduce((n,f)=>n+256+f.paths.reduce((v,p)=>v+p.length*32,0),0),0)};};
 async function riverTile(t,w,job){
  const k=`${t.z}/${t.x}/${t.y}`,known=vectors?.get(t.z,t.x,t.y)||riverCache.get(k);if(known)return known;
  if(riverPending.has(k))return riverPending.get(k);
  const work=(async()=>{
   const disk=`osm-rivers/${k}`;let bytes=store?.has(disk)?await store.get(disk):null;
   if(!bytes){const template=await vectors.template(),url=template.replace('{z}',t.z).replace('{x}',t.x).replace('{y}',t.y);
    // A tile the host does not have holds no rivers. That is an answer, not a failure to ask again.
    const r=await sched.request(proxyUrl(url,proxy),{priority:waterRank(w.priority??0),host:hostOf(url)}).promise.catch(e=>{if(e?.status===404||e?.status===204)return {bytes:new ArrayBuffer(0)};throw e;});
    bytes=r.bytes;if(bytes.byteLength)store?.put(disk,bytes.slice(0),'application/x-protobuf');}
   // missing: the host has no such tile (an empty answer): a page whose vector tiles are all missing has no map, and
   // its water layer takes the source's sea instead (resample.js).
   const out={...t,...riverLayers(bytes),missing:!bytes.byteLength};
   riverCache.set(k,out);riverBytes+=out.bytes;while(riverCache.size>128||riverBytes>48*1024*1024){const first=riverCache.keys().next().value;riverBytes-=riverCache.get(first).bytes;riverCache.delete(first);}return out;
  })().finally(()=>riverPending.delete(k));riverPending.set(k,work);return work;
 }
 // Tiles, the z13 DEM their levels are probed on, and whether anything failed. Lines that failed leave the page
 // provisional, to be asked for again, rather than carved one way now and another later.
 async function riverData(page,w,job){
  if(!vectors||page.level<MAP_WATER_MIN_LEVEL)return {tiles:[],dem:new Map(),provisional:false};
  // The water layer reads shores a band beyond the page, so its tiles reach that far too.
  const plan=riverTilePlan(nodesForPage(page,'height',Math.min(14,page.level+1),256),page.level,{band:waterLayer?WATER_BAND+4:0});if(plan.omitted)count.riverTilesOmitted++;
  let provisional=false;const dem=new Map();
  const found=(await Promise.all(plan.tiles.map(t=>riverTile(t,w,job).catch(()=>{provisional=true;return null;})))).filter(Boolean);
  if(job.cancelled)return {tiles:[],dem,provisional};
  const need=new Map(),z=Math.min(13,cfg.height.maxZoom),n=2**z;
  // The fixed DEM that river levels and lake levels on river pages are probed on (rivers.js, map-water.js), about 150 m
  // around each tile, as far as valley floors are searched and banks probed.
  for(const t of found){if(t.z!==RIVER_ZOOM||!(t.layers.waterway?.features.length||t.layers.water?.features.length))continue;const factor=2**(t.z-z);for(let y=Math.floor(t.y/factor-8/256);y<=Math.floor((t.y+1)/factor+8/256);y++)for(let x=Math.floor(t.x/factor-8/256);x<=Math.floor((t.x+1)/factor+8/256);x++){if(y<0||y>=n)continue;const tx=(x+n)%n,k=`${cfg.height.id}/${z}/${tx}/${y}`;need.set(k,{x:tx,y});}}
  // The water layer solves a coarse page's network on the DEM one zoom under its vector tiles (resample.js
  // coarseRiverDemZoom), the same tiles whichever page asks, with the same margin.
  if(waterLayer)for(const t of found){if(t.z>=RIVER_ZOOM||!t.layers.waterway?.features.length)continue;const zd=coarseRiverDemZoom(t.z,cfg.height),nd=2**zd,factor=2**(t.z-zd);
   for(let y=Math.floor(t.y/factor-8/256);y<=Math.floor((t.y+1)/factor+8/256);y++)for(let x=Math.floor(t.x/factor-8/256);x<=Math.floor((t.x+1)/factor+8/256);x++){if(y<0||y>=nd)continue;const tx=(x+nd)%nd,k=`${cfg.height.id}/${zd}/${tx}/${y}`;need.set(k,{x:tx,y,z:zd});}}
  await Promise.all([...need].map(async([k,t])=>{try{const value=await cache.request(k,w.id,waterRank(w.priority??0),loader(cfg.height,t.z??z,t.x,t.y));if(value)dem.set(k,value);else provisional=true;}catch{provisional=true;}}));
  return {tiles:found.map(t=>({...t,demZoom:z})),dem,provisional};
 }
 function plan(page,kind){
  if(kind==='height')return {kind,needs:requiredTiles(page,cfg.height).map(t=>({source:cfg.height,...t})),build:g=>buildHeightPage(page,g,cfg.height),name:cfg.height.id};
  const overlay=cfg.overlays.find(o=>overlayApplies(page,o));
  if(overlay)return {kind:'overlay',overlayId:overlay.id,needs:overlayTiles(page,cfg.albedo,overlay),build:g=>buildOverlayAlbedoPage(page,g,cfg.albedo,overlay),name:`${cfg.albedo.id}+${overlay.id}`,optional:overlay.id};
  return {kind,needs:requiredTiles(page,cfg.albedo).map(t=>({source:cfg.albedo,...t})),build:g=>buildAlbedoPage(page,g,cfg.albedo),name:cfg.albedo.id};
 }

 // One step of water preparation, in the pool, so that this thread stays free to fetch; here if the pool is gone.
 const plain=t=>({heights:t.heights,width:t.width,height:t.height});
 async function step(name,args,w,job){
  if(poolUp()){
   try{const {out,ms}=await pool.water(name,args,{priority:w.priority??0,isCancelled:()=>job.cancelled});count.waterMs+=ms;return out;}
   catch(e){if(e?.name==='Cancelled')throw Object.assign(new Error('cancelled'),{name:'AbortError'});if(e?.name!=='PoolFailed')throw e;}
  }
  const t0=performance.now(),out=WATER_STEPS[name](args);count.waterMs+=performance.now()-t0;return out;
 }
 // One attempt per tile at a time. Whoever asks meanwhile waits for it, and makes its own if that one fails or lost a tile: a failure, a loss, or a page cancelled, belongs to whoever ran it.
 async function once(table,tile,job,work){
  for(;;){
   let running=table.get(tile),mine=false;
   if(!running){mine=true;running=work().finally(()=>table.delete(tile));table.set(tile,running);}
   try{const out=await running;if(mine||!out?.lost)return out;}catch(e){if(mine||job.cancelled)throw e;}
   if(job.cancelled)throw Object.assign(new Error('cancelled'),{name:'AbortError'});
  }
 }
 // The sea of a height tile, with its shoreline from imagery. A function of raw tiles alone, whichever was asked for first, so it can be kept with
 // the tile, and never when a tile it needed was lost. A fine tile starts from the sea of the z10 tile above; one at z10 or coarser asks the tile above
 // only when it holds no sea of its own, as a strip can run on across its border. So far up the chain, each tile is read once for many.
 const seas=new WeakMap(),seasRunning=[new WeakMap(),new WeakMap()];
 function seaOf(tile,source,z,x,y,extra,w,job){
  const known=seas.get(tile);if(known)return known;
  return once(seasRunning[w.refresh?1:0],tile,job,async()=>{
   const zoom=source.seabedZoom,scan=await step('scan',{tile:plain(tile),z,x,y},w,job);let sea=scan.sea,colour=null;
   if(z>=SHORE_LOWEST_ZOOM&&z<=cfg.albedo.maxZoom&&scan.holdsShore){
    let seeds=null,above=null;
    if(z>zoom||(!scan.own&&z>SHORE_LOWEST_ZOOM)){
     const uz=z>zoom?zoom:z-1,shift=z-uz,up=await extra(source,uz,x>>shift,y>>shift);
     if(up){
      above=await seaOf(up,source,uz,x>>shift,y>>shift,extra,w,job);if(above.lost)extra.lose();
      seeds=await step('seeds',{parentMask:above.sea.mask,parentWidth:up.width,z,x,y,parentZ:uz,width:tile.width,height:tile.height},w,job);
     }
    }
    if(scan.own||seeds?.any){
     const image=await extra(cfg.albedo,z,x,y);
     if(image){const r=await step('shore',{tile:plain(tile),sea,image:{rgba:image.rgba,width:image.width,height:image.height},z,y,seeds:seeds?.seeds??null,colour:above?.colour??null},w,job);sea=r.sea;colour=r.colour;}
    }
    colour=colour||above?.colour||null;
   }
   const found={sea,colour,lost:extra.lost()};if(!found.lost)seas.set(tile,found);
   return found;
  });
 }
 // What water fetches for a height page that can show ranks just behind the first pass, in the page's own order. At the page's own rank it waits in the imagery queue behind
 // pages that are only sharpening, holding one of the height channel's slots all the while, and the height pages behind it wait too. Order only. A page nothing on screen reads keeps its rank.
 const FIRST_PASS_END=6000,waterRank=rank=>rank>=UNSEEN_RANK?rank:Math.min(rank,FIRST_PASS_END+rank*0.001);
 // Retries before a tile settles for what it has, which the stats then count: an imagery outage must not hold height pages back for good.
 const WATER_TRIES=3,waterTries=new WeakMap();
 // Water would like an image for its shore, but no height page waits for one from a host that is holding back, on its budget or a pause: the ground would stay coarse for as long as the host does. The page goes up
 // with the shore its heights give, marked provisional, and the renderer asks for it again later, patient that time. A tile in memory or on disk is no wait. Waiting ends this way only while a limited host holds back, so a test of the settled image never meets it. A tile whose tries have run out, on any host, also goes up provisional, and does not stay degraded until evicted.
 const LATE=Symbol('late'),LATE_CHECK_MS=100;
 const orLate=(asked,key,host)=>new Promise((resolve,reject)=>{
  // One the host is already answering is worth waiting for.
  let timer=null;const check=()=>{const state=asking.get(key)?.state;if((state==='queued'||state==='waiting')&&sched.stalled(host))resolve(LATE);else timer=setTimeout(check,LATE_CHECK_MS);};
  asked.then(v=>{clearTimeout(timer);resolve(v);},e=>{clearTimeout(timer);reject(e);});
  timer=setTimeout(check,0);
 });
 // Raw heights never change, so nothing here depends on what was prepared first. The result sits beside them, and only that reaches a page.
 async function prepareWater(n,tile,w,job){
  const zoom=n.source.seabedZoom,{z,x,y}=n,patient=!!w.refresh;let lost=false,late=false;
  // A real miss answers null from the cache. Any other failure says nothing about the tile, so it must not settle what this one is.
  const extra=async(source,tz,tx,ty)=>{
   if(job.cancelled)throw Object.assign(new Error('cancelled'),{name:'AbortError'});
   try{
    const key=`${source.id}/${tz}/${tx}/${ty}`,host=hostOf(source.tileUrl(tz,tx,ty)),asked=cache.request(key,w.id,waterRank(w.priority??0),loader(source,tz,tx,ty));
    if(patient||!hostLimits[host]||store?.has(key))return await asked;
    const out=await orLate(asked,key,host);if(out===LATE){late=true;lost=true;return null;}
    return out;
   }catch(e){if(job.cancelled||e?.name==='AbortError')throw e;lost=true;return null;}
  };extra.lost=()=>lost;extra.lose=()=>{lost=true;};
  const found=await seaOf(tile,n.source,z,x,y,extra,w,job);if(found.lost)lost=true;
  const sea=found.sea,{zeros,regions}=await step('regions',{tile:plain(tile),z,y,sea},w,job);
  const parent=z>zoom&&zeros?await extra(n.source,zoom,x>>(z-zoom),y>>(z-zoom)):null;
  let image=null,iz=0;
  if(regions.length){
   iz=Math.max(cfg.albedo.minZoom,Math.min(z,LAKE_IMAGE_ZOOM,cfg.albedo.maxZoom));const shift=z-iz;image=await extra(cfg.albedo,iz,x>>shift,y>>shift);
  }
  // Asked again for a page already up, a tile that failed changes nothing: the page stays, and is asked for again.
  if(lost&&patient)throw Object.assign(new Error('a tile that water depends on failed'),{status:0});
  if(lost&&!late){
   const tries=(waterTries.get(tile)||0)+1;
   if(tries<WATER_TRIES){waterTries.set(tile,tries);throw Object.assign(new Error('a tile that water depends on failed'),{status:0});}
   count.waterDegraded++;
  }
  const final=await step('finish',{tile:plain(tile),z,x,y,zoom,sea,parent:parent&&plain(parent),regions,image:image&&{rgba:image.rgba,width:image.width,height:image.height},imageZ:iz},w,job);
  if(tile.prepared!==undefined&&!tile.provisional)return;
  if(!final.heights)final.heights=tile.heights;
  if(tile.prepared===undefined)count.waterTiles++;
  tile.prepared=final;tile.provisional=lost;cache.resized(`${n.source.id}/${z}/${x}/${y}`);if(lost)count.provisional++;
 }
 // A page in a hurry never waits on one that is patient for the same tile.
 const prepareRunning=[new WeakMap(),new WeakMap()];
 const prepared=(n,tile,w,job)=>once(prepareRunning[w.refresh?1:0],tile,job,()=>prepareWater(n,tile,w,job));
 // What a page reads of a tile: its prepared form where it has one.
 const pageTile=t=>({... (t.prepared||t),riverHeights:t.heights});
 async function run(job){
  const w=job.want,page={face:w.face,level:w.level,x:w.x,y:w.y},kind=channelOf(w.channel);
  // Done, so what it still has queued is for nobody, unless another page wants it too.
  const finish=msg=>{if(jobs.get(w.id)===job)jobs.delete(w.id);cache.release(w.id);return msg;};
  if(data.manifest?.baked){await runBaked(job,finish,kind);return;}
  try{
   await storeReady;if(job.cancelled)return;
   const p=plan(page,kind);
   if(!p.needs.length){count.missing++;port.postMessage(finish(ident(w,{type:'missing',reason:'coverage'})));return;}
   const tiles=new Map();
   // River lines and their DEM come in alongside the page's own tiles.
   const riverWork=kind==='height'?riverData(page,w,job).catch(()=>({tiles:[],dem:new Map(),provisional:true})):null;
   await Promise.all(p.needs.map(async n=>{
    const key=`${n.source.id}/${n.z}/${n.x}/${n.y}`,t=await cache.request(key,w.id,w.priority??0,loader(n.source,n.z,n.x,n.y));
    if(t)tiles.set(key,t);
   }));
   if(job.cancelled)return;
   // Sea floor and lakes, once per tile, before any page reads it.
   await Promise.all(p.needs.map(async n=>{
    const tile=tiles.get(`${n.source.id}/${n.z}/${n.x}/${n.y}`);
    if(n.source.seabedZoom&&tile&&tile.heights&&(tile.prepared===undefined||(w.refresh&&tile.provisional)))await prepared(n,tile,w,job);
   }));
   if(job.cancelled)return;
   // Read with what the build is handed: a refresh can finish these tiles while this page waits for the pool, and then it would go up marked final with the heights' shore, and never be asked for again.
   const rivers=riverWork?await riverWork:{tiles:[],dem:new Map(),provisional:false};
   if(job.cancelled)return;
   for(const [k,v] of rivers.dem)if(!tiles.has(k))tiles.set(k,v);
   const provisional=rivers.provisional||[...tiles.values()].some(t=>t.provisional);
   let r=null,ms=0;const buildOpts=waterLayer&&kind==='height'?{water:true,terrain:true}:{};
   if(poolUp()){
    try{ // a cancelled page waits in the pool's queue and never starts
     const o=await pool.build({kind:p.kind,overlayId:p.overlayId,page,rivers:rivers.tiles,tiles:[...tiles].map(([key,tile])=>({key,tile:pageTile(tile)})),opts:buildOpts},{priority:w.priority??0,isCancelled:()=>job.cancelled});
     r=o.result;ms=o.ms;count.poolBuilds++;
    }catch(e){if(job.cancelled||e?.name==='Cancelled')return;if(e?.name!=='PoolFailed')throw e;}
   }
   if(job.cancelled)return;
   if(!r){
    await turn(()=>{
     if(job.cancelled)return;
     const t0=performance.now();const get=(s,z,x,y)=>{const t=tiles.get(`${s.id}/${z}/${x}/${y}`);return t&&pageTile(t);};r=kind==='height'?buildHeightPage(page,get,cfg.height,rivers.tiles,buildOpts):p.build(get);ms=performance.now()-t0;count.localBuilds++;stripWaterPage(r);
    });
    if(job.cancelled||!r)return;
   }
   times.push(ms);if(times.length>256)times.shift();
   if(r.missing){count.missing++;port.postMessage(finish(ident(w,{type:'missing',reason:r.reason})));return;}
   count.completed++;
   if(r.mapWater){count.mapWaterPages++;count.mapWaterOverBudget+=r.mapWater.overBudget;count.mapWaterDisagreeing+=r.mapWater.disagreeing;}if(r.texels)count.waterTexelPages++;
   if(r.rivers){count.riverPages++;count.riverOmitted+=r.rivers.overBudget;count.riverMissingHeight+=r.rivers.missingHeight;count.riverTerrainLimited+=r.rivers.terrainLimited||0;count.riverBankLimited+=r.rivers.bankLimited||0;if(r.texels)count.riverTexelPages++;}
   if(r.waterLayer){count.waterLayerPages++;if(r.waterLayer.uniform)count.waterLayerUniform++;}
   port.postMessage(finish(ident(w,{type:'page',source:p.name+(r.rivers?.segments?'+osm':''),offset:r.offset,scale:r.scale,bytes:r.bytes,zoom:r.zoom,water:r.water,waterLayer:r.waterLayer,rivers:r.rivers,provisional})),[r.bytes,...(r.water?[r.water.buffer]:[]),...(r.waterLayer?.bytes?[r.waterLayer.bytes]:[])]);
  }catch(e){
   if(job.cancelled||e?.name==='AbortError'||e?.name==='Bumped'){if(e?.name==='Bumped'&&!job.cancelled){count.failed++;port.postMessage(finish(ident(w,{type:'failed',status:0,reason:'bumped'})));}return;}
   count.failed++;port.postMessage(finish(ident(w,{type:'failed',status:e?.status??0,reason:String(e?.message||e)})));
  }
 }

 // A baked body: a finer page is one entry of its face's page bundle (crates/solar-bake/src/pack.rs), read by byte range; the range holds the page as a level file does. Past the finest level baked there is no such page, which is an answer, not a failure.
 // Six files per level instead of thousands, so the pack uploads and serves as a few large files; the host must answer ranges with 206.
 const bundles=new Map(),pageReads=new Map(),BUNDLE_MAGIC=0x53545042,BUNDLE_HEADER=16;
 async function range(url,start,length){
  const fetchFn=env.fetch||globalThis.fetch.bind(globalThis),ctl=typeof AbortController==='undefined'?null:new AbortController();
  const res=await fetchFn(url,{headers:{Range:`bytes=${start}-${start+length-1}`},...(ctl?{signal:ctl.signal}:{})});
  if(res.status===404)return null;
  // A 200 is the whole bundle, hundreds of megabytes: stop it rather than read it.
  if(res.status!==206){ctl?.abort();throw Object.assign(new Error(res.ok?`HTTP ${res.status}: the pack host ignored the byte range`:`HTTP ${res.status}`),{status:res.status});}
  const buf=await res.arrayBuffer();
  if(buf.byteLength!==length)throw Error(`pack: a range of ${length} bytes came back as ${buf.byteLength}`);
  return buf;
 }
 // The header and index of one face's bundle, asked for once; null when the bundle is not there.
 function bundleIndex(base,level,face){
  const key=`${level}/${face}`;let p=bundles.get(key);
  if(!p){
   const n=2**level;
   p=range(`${base}pages/${level}/face-${face}.bin`,0,BUNDLE_HEADER+8*n*n).then(buf=>{
    if(!buf)return null;
    const dv=new DataView(buf);
    if(dv.getUint32(0,false)!==BUNDLE_MAGIC||dv.getUint32(4,true)!==1||dv.getUint8(8)!==level||dv.getUint8(9)!==face||dv.getUint32(12,true)!==n)throw Error(`pack: bundle ${key} has another header`);
    return new Uint32Array(buf,BUNDLE_HEADER,2*n*n); // little endian on every browser and Node target
   });
   bundles.set(key,p);p.catch(()=>bundles.delete(key)); // a failed read is asked again
  }
  return p;
 }
 // Height and albedo are one page's bytes, wanted as two jobs that are often seconds apart. The reads of the last
 // PAGE_KEEP pages stay (about 7 MB), so a page costs the host one request, not two: measured 16 November 2026, the
 // descents asked about 180 pages and, sharing only reads in flight, sent 320-340 requests (docs in README.md, Data packs).
 const PAGE_KEEP=128;
 function pageBytes(base,w){
  const key=`${w.level}/${w.face}/${w.x}/${w.y}`;let p=pageReads.get(key);
  if(p){pageReads.delete(key);pageReads.set(key,p);return p;} // most recently used last
  p=(async()=>{
   const index=await bundleIndex(base,w.level,w.face);if(!index)return null;
   const i=2*(w.y*2**w.level+w.x),offset=index[i],length=index[i+1];if(!length)return null;
   const buf=await range(`${base}pages/${w.level}/face-${w.face}.bin`,offset,length);
   if(!buf)throw Error(`pack: bundle ${w.level}/${w.face} went missing after its index was read`);
   return buf;
  })();
  pageReads.set(key,p);p.catch(()=>{if(pageReads.get(key)===p)pageReads.delete(key);}); // a failed read is asked again
  while(pageReads.size>PAGE_KEEP)pageReads.delete(pageReads.keys().next().value);
  return p;
 }
 async function runBaked(job,finish,kind){
  const w=job.want;
  try{
   const finest=await bakedFinest();
   if(w.level>finest){count.missing++;port.postMessage(finish(ident(w,{type:'missing',reason:'beyond the data'})));return;}
   const root=env.siteRoot||new URL('../',import.meta.url).href,base=new URL(data.pack,root).href;
   const buf=await pageBytes(base,w);
   if(!buf){count.missing++;port.postMessage(finish(ident(w,{type:'missing',reason:'not baked'})));return;}
   if(job.cancelled)return;
   const mod=await (env.importPack?env.importPack():import('./pack.js'));const pages=mod.parseLevel(buf),[p]=pages;
   if(pages.length!==1||p.face!==w.face||p.level!==w.level||p.x!==w.x||p.y!==w.y)throw Error(`pack: bundle entry ${w.level}/${w.face}/${w.x}_${w.y} holds another page`);
   if(kind==='height'){const h=await pool.decode('png',null,p.height.slice().buffer,{priority:w.priority??0});if(job.cancelled)return;const bytes=mod.heightBytes(h.rgba,h.width,h.height);count.completed++;port.postMessage(finish(ident(w,{type:'page',source:'pack',offset:p.offset,scale:p.scale,bytes})),[bytes]);}
   else{const a=await pool.decode('image','image/jpeg',p.albedo.slice().buffer,{priority:w.priority??0});if(job.cancelled)return;const bytes=mod.albedoBytes(a.rgba,a.width,a.height);count.completed++;port.postMessage(finish(ident(w,{type:'page',source:'pack',offset:0,scale:1,bytes})),[bytes]);}
  }catch(e){if(job.cancelled||e?.name==='AbortError')return;count.failed++;port.postMessage(finish(ident(w,{type:'failed',status:e?.status??0,reason:String(e?.message||e)})));}
 }
 let finestLevel=null;
 async function bakedFinest(){
  if(finestLevel===null){finestLevel=(async()=>{const fetchFn=env.fetch||globalThis.fetch.bind(globalThis),root=env.siteRoot||new URL('../',import.meta.url).href,r=await fetchFn(new URL(data.pack+'manifest.json',root).href);if(!r.ok)return 3;const m=await r.json();const level=Math.max(3,Math.min(16,m.finest_level??Math.max(...(m.levels||[3]))));port.postMessage({type:'sourceLimits',height:level,albedo:level});return level;})();}
  return finestLevel;
 }

 function want(msg){
  // The page most on screen stands for where the camera is, for what the disk keeps.
  if(store&&msg.pages?.length){const best=msg.pages.reduce((a,b)=>(b.priority??0)<(a.priority??0)?b:a),n=2**best.level;store.setEye(chartToDirection(best.face,(best.x+0.5)/n*2-1,(best.y+0.5)/n*2-1));}
  for(const id of msg.cancel||[]){
   const job=jobs.get(id);if(!job)continue;
   job.cancelled=true;jobs.delete(id);count.cancelled++;cache.release(id);
  }
  for(const w of msg.pages||[]){
   if(jobs.has(w.id))continue;
   const job={want:w,cancelled:false};jobs.set(w.id,job);run(job);
  }
 }

 function stats(){
  const s=sched.stats(),sorted=[...times].sort((a,b)=>a-b),mean=times.length?times.reduce((a,b)=>a+b,0)/times.length:0,ps=pool?pool.stats():{poolSize:0,poolBusy:0,poolQueued:0,poolFailed:0,poolError:null};
  port.postMessage({type:'stats',inFlight:s.inFlight,queued:s.queued,completed:count.completed,failed:count.failed,missing:count.missing,cancelled:count.cancelled,waterDegraded:count.waterDegraded,waterMs:count.waterMs,waterTiles:count.waterTiles,provisional:count.provisional,
   bytes:s.bytes,bytesPerSecond:s.bytesPerSecond,resampleMsMean:mean,resampleMsP95:sorted.length?sorted[Math.min(sorted.length-1,Math.floor(sorted.length*0.95))]:0,cacheBytes:cache.stats().bytes,
   poolSize:ps.poolSize,poolBusy:ps.poolBusy,poolQueued:ps.poolQueued,poolFailed:ps.poolFailed,poolError:ps.poolError||poolInitError,poolBuilds:count.poolBuilds,localBuilds:count.localBuilds,
   packPages:pack.pages,packDone:pack.done,packError:pack.error,hosts:s.hosts,tileStore:store?.stats()??null,
   rivers:{pages:count.riverPages,texelPages:count.riverTexelPages,omitted:count.riverOmitted,tilesOmitted:count.riverTilesOmitted,missingHeight:count.riverMissingHeight,terrainLimited:count.riverTerrainLimited,bankLimited:count.riverBankLimited},
   mapWater:{pages:count.mapWaterPages,overBudget:count.mapWaterOverBudget,disagreeing:count.mapWaterDisagreeing,texelPages:count.waterTexelPages},waterLayer:{on:waterLayer,pages:count.waterLayerPages,uniform:count.waterLayerUniform}});
 }

 // ---- pinned pack: D0 to D3 from the site's own files, decoded in the pool, never ahead of the live wants
 const attribution=[...new Set(Object.values(resolved.sources).map(s=>s.attribution).filter(Boolean))];
 const postAttribution=extra=>port.postMessage({type:'attribution',sources:[...new Set([...attribution,...extra])]});
 const copyOf=b=>{const u=b instanceof Uint8Array?b:new Uint8Array(b);return u.slice().buffer;}; // a view into the level file must not be transferred
 async function startPack(path){
  try{
   const mod=await (env.importPack?env.importPack():import('./pack.js'));
   const root=env.siteRoot||new URL('../',import.meta.url).href,base=new URL(path,root).href,baseFetch=env.fetch||globalThis.fetch.bind(globalThis);
   const packFetch=async(url,...rest)=>{
    const res=await baseFetch(url,...rest);
    if(String(url).endsWith('manifest.json')&&res.ok)res.clone().json().then(m=>{if(Array.isArray(m.attribution))postAttribution(m.attribution);}).catch(()=>{});
    return res;
   };
   const viaPool=async(kind,mime,bytes,local)=>{
    if(poolUp()){try{return await pool.decode(kind,mime,copyOf(bytes),{priority:-1});}catch(e){if(e?.name!=='PoolFailed')throw e;}}
    return local();
   };
   const report=await mod.loadPack(base,page=>{
    pack.pages++;
    port.postMessage({type:'page',id:0,face:page.face,level:page.level,x:page.x,y:page.y,channel:page.channel==='height'?0:1,source:'pack',offset:page.offset,scale:page.scale,bytes:page.bytes},[page.bytes]);
   },{
    fetch:packFetch,
    decodePng:bytes=>viaPool('png',null,bytes,()=>decodePng(bytes)),
    decodeJpeg:(bytes,mime='image/jpeg')=>viaPool('image',mime,bytes,()=>decodeImage(bytes,mime)),
   });
   if(report?.failures?.length)pack.error=`${report.failures.length} failure(s), first: ${report.failures[0].reason}${report.failures[0].level>=0?` (level ${report.failures[0].level})`:''}`;
  }catch(e){pack.error=String(e?.message||e);}
  pack.done=true;
 }

 port.onmessage=({data:m})=>{if(m?.type==='want')want(m);else if(m?.type==='vectorEye')vectors?.eye(m.position,m.height,m.target,m.width,m.ground);};
 const timer=setInterval(stats,env.statsMs??250);
 port.postMessage({type:'ready',sources:{...Object.fromEntries(Object.values(resolved.sources).map(s=>[s.id,{attribution:s.attribution,cachePermission:s.cachePermission,maxZoom:s.maxZoom}])),osm:{attribution:VECTOR_CREDIT}}});
 postAttribution([]);
 // Publish availability before demand can ask for finer pages. Otherwise a
 // pack-only body waits for a request it should never have made to learn its cap.
 if(data.manifest?.baked&&data.pack)bakedFinest().catch(e=>{pack.error=String(e?.message||e);});
 const packDone=typeof data.pack==='string'&&data.pack?startPack(data.pack):Promise.resolve();
 return {packDone,stats,close(){vectors?.close();clearInterval(timer);pool?.close();store?.close();}};
}

// Worker entry. Absent in Node, where tests call initField directly.
if(typeof WorkerGlobalScope!=='undefined'&&typeof self!=='undefined'&&self instanceof WorkerGlobalScope){
 let started=false;
 self.onmessage=({data})=>{if(data?.type!=='init'||started)return;started=true;initField(data);};
}
