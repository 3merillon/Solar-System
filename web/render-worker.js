import init,{Explorer,SolarFlight} from './pkg/solar_explorer.js';
import {installCompiler} from './gpu-startup.js';
import {packSite,packFolder,mapFile} from './pack-base.js';
let engine,dead=false,tail=Promise.resolve();
const progress=value=>postMessage({type:'progress',...value});
const fatal=message=>{if(dead)return;dead=true;postMessage({type:'fatal',message:String(message)});};
const compilation=installCompiler(progress,fatal);
// Renderer construction marks (startup.rs mark), milliseconds from compiler start.
compilation.marks=[];globalThis.solarStartupMark=label=>compilation.marks.push([label,Math.round(performance.now()-compilation.started)]);
const report=()=>({...Object.fromEntries(Object.entries(compilation).filter(([,v])=>typeof v!=='function')),resources:performance.getEntriesByType('resource').map(e=>({name:e.name,start_ms:e.startTime,duration_ms:e.duration,transfer_bytes:e.transferSize,decoded_bytes:e.decodedBodySize}))});
// Stats are a JSON document built in WASM and structured-cloned to the page;
// at 60 submissions per second that is measurable CPU on small devices. Refresh
// them at most every 100 ms; timing rows and animation state stay per frame.
// While profiling (timing harness, diagnostics) the stats refresh every frame
// so GPU counter readbacks requested on a frame are visible on the next one.
let lastStats=0,stats=null,profilingOn=false,lastFrameCpu=0;
const metadata=force=>{const now=performance.now();if(force||profilingOn||!stats||now-lastStats>100){lastStats=now;stats=JSON.parse(engine.stats());if(fieldPort)stats.field={...fieldStats,vectors:vectorStats,attribution:[...attribution(stats.sources_in_view),...(vectorStats?.tiles?[vectorStats.attribution]:[])]};}stats={...stats,worker_frame_cpu_ms:lastFrameCpu};return {stats,telemetry:JSON.parse(engine.telemetry()),animation:engine.animation(),ground:engine.ground_height()};};
// Frames in flight on the GPU. With the default queue depth of two, a render
// request answers when the frame BEFORE it has completed, so the page encodes
// the next frame while this one runs; the WASM renderer still refuses a third
// submission. At queue depth one (isolated timing runs) the request answers
// only when its own frame has completed.
const inFlight=[];let queueDepth=2;
// A measured body's field worker owns the network; nothing here ever awaits it. Finished pages
// wait in this queue and enter the engine a few at a time just before a frame, so that page
// bytes never pile up in WASM memory and an upload burst cannot stretch one frame. Every engine
// call happens on that path: an async engine call (a capture) may be holding its borrow.
const PAGES_PER_FRAME=4;
let buildingUpdate=null,vectorStats=null,lastVectorEye=0;
let fieldPort=null,fieldStats=null;const fieldPages=[],fieldEvents=[];let fieldCredit={};
// Each page carries its sources as bits; the attribution shown follows the pages in view.
const SOURCE_BIT={pack:1,terrarium:2,eox:4,swissimage:8,osm:16};
// The solar system. The body in full detail changes with no reload: the field moves to its pack, and maps and stars stay.
let fieldWorker=null,earthField=null,mapQueue=[],packBase='pack/';
// Maps and stars: fetched once, decoded here, entering the engine one per frame. A body without its map stays grey and says so in stats.
// Bodies with no baked map (docs/SOLAR-SYSTEM.md: the Sun is drawn by the star model; Deimos, Mimas and Uranus's moons have none):
// not asked for, so a session sends the pack host no request that can only fail. A map baked later must be taken off this list.
const NO_BAKED_MAP=new Set(['sun','deimos','mimas','ariel','umbriel','titania','oberon','miranda']);
const fieldFor=name=>{
 if(name==='earth')return earthField;
 if(NO_BAKED_MAP.has(name)||name.startsWith('exo-')||name==='procedural')return null;
 return {manifest:{baked:true,body:name},proxy:'',pack:packBase+packFolder(name)};
};
async function loadSpaceAssets(names){
 const {solar:solarPack,base}=await packSite();
 async function loadMap(layer,url){
  const response=await fetch(url);
  if(!response.ok)throw Error(`Body map ${response.status}: ${url}`);
  const bitmap=await createImageBitmap(await response.blob(),{colorSpaceConversion:'none'});
  try{
   const canvas=new OffscreenCanvas(1024,512),context=canvas.getContext('2d',{willReadFrequently:true});
   context.drawImage(bitmap,0,0,1024,512);
   mapQueue.push({layer,rgba:new Uint8Array(context.getImageData(0,0,1024,512).data.buffer)});
  }finally{bitmap.close();}
 }
 const saturn=names.indexOf('saturn');
 if(saturn>=0)await loadMap(saturn,new URL('./saturn-opal-2023b.png',import.meta.url)).catch(console.warn);
 if(solarPack)try{const r=await fetch(`${base}solar/stars.bin`);if(r.ok)spaceStars=new Float32Array(await r.arrayBuffer());}catch{}
 if(solarPack)try{const r=await fetch(`${base}solar/asteroids.bin`);if(r.ok)spaceAsteroids=new Float32Array(await r.arrayBuffer());}catch{}
 // The sky: six faces at two sizes, one face entering the engine per frame.
 for(let face=0;face<6;face++){
  if(!solarPack)break;
  try{
   const r=await fetch(`${base}solar/sky-${face}.jpg`);if(!r.ok)continue;
   const bitmap=await createImageBitmap(await r.blob(),{colorSpaceConversion:'none'});
   const read=side=>{const canvas=new OffscreenCanvas(side,side),c=canvas.getContext('2d',{willReadFrequently:true});c.imageSmoothingQuality='high';c.drawImage(bitmap,0,0,side,side);return new Uint8Array(c.getImageData(0,0,side,side).data.buffer);};
   skyQueue.push({face,top:read(2048),half:read(1024)});bitmap.close();
  }catch{}
 }
 for(let layer=0;layer<names.length;layer++){
  if(!solarPack)break;
  if(layer===saturn||NO_BAKED_MAP.has(names[layer]))continue;
  await loadMap(layer,base+mapFile(names[layer])).catch(console.warn);
 }
}
let spaceStars=null,spaceAsteroids=null;const skyQueue=[];
function exchangeSpace(){
 if(spaceStars){engine.stars(spaceStars);spaceStars=null;}
 if(spaceAsteroids){engine.asteroids(spaceAsteroids);spaceAsteroids=null;}
 // The bake raised the sky by 2 to fit its bytes; this undoes that and sets how bright it stands against the planets.
 const k=skyQueue.shift();if(k)engine.sky_face(k.face,k.top,k.half,0.3);
 const m=mapQueue.shift();if(m)engine.body_map(m.layer,m.rgba);
}
const sourceBits=name=>String(name||'').split('+').reduce((bits,id)=>bits|(SOURCE_BIT[id]||0),0);
const attribution=mask=>Object.entries(SOURCE_BIT).filter(([id,bit])=>(mask&bit)&&fieldCredit[id]).flatMap(([id])=>fieldCredit[id]);
function connectField(options){
 if(options)engine.source_limits(options.manifest?.baked?3:15,options.manifest?.baked?3:12);
 buildingUpdate={records:new ArrayBuffer(0),points:new ArrayBuffer(0)};vectorStats=null;lastVectorEye=0;
 // A new body: nothing from the old one's worker may reach the engine.
 if(fieldWorker){fieldWorker.terminate();fieldPort?.close();fieldPages.length=0;fieldEvents.length=0;fieldStats=null;fieldCredit={};}
 fieldWorker=null;fieldPort=null;
 if(!options){engine.building_sources(new Uint8Array(0),new Uint8Array(0));buildingUpdate=null;return;}
 const worker=new Worker(new URL('./field/field-worker.js',import.meta.url),{type:'module',name:'Solar field'});
 const channel=new MessageChannel();fieldPort=channel.port1;
 fieldPort.onmessage=({data})=>{
  if(data.type==='buildings'){buildingUpdate=data;vectorStats={...vectorStats,...data.stats};}
  else if(data.type==='vectorStats')vectorStats={...vectorStats,...data};
  else if(data.type==='page')fieldPages.push(data);
  else if(data.type==='ready'){for(const [id,s] of Object.entries(data.sources||{}))fieldCredit[id]=[s.attribution];}
  else if(data.type==='attribution')fieldCredit.pack=data.sources;
  else{if(data.type==='stats')fieldStats=data;fieldEvents.push(data);}
 };
 worker.onerror=event=>{fieldStats={...fieldStats,error:event.message||'Field worker failed'};};
 worker.postMessage({type:'init',port:channel.port2,...options},[channel.port2]);
 fieldWorker=worker;
}
function exchangeField(){
 if(!fieldPort)return;
 if(buildingUpdate){engine.building_sources(new Uint8Array(buildingUpdate.records),new Uint8Array(buildingUpdate.points));buildingUpdate=null;}
 for(const e of fieldEvents.splice(0)){
  if(e.type==='sourceLimits')engine.source_limits(e.height,e.albedo);
  else if(e.type==='missing')engine.page_missing(e.channel,e.face,e.level,e.x,e.y);
  else if(e.type==='failed')engine.page_failed(e.channel,e.face,e.level,e.x,e.y);
  else if(e.type==='stats')engine.page_throughput(e.bytesPerSecond||0);
 }
 for(let n=0;n<PAGES_PER_FRAME&&fieldPages.length;n++){const p=fieldPages.shift();engine.page_arrived(p.channel,p.face,p.level,p.x,p.y,p.offset,p.scale,sourceBits(p.source)|(p.provisional?128:0),new Uint8Array(p.bytes),p.water||new Float32Array(0));
  // The water layer's page (docs/WATER-LAYER.md) follows its height page: texels, or a uniform body with no texels.
  if(p.waterLayer&&engine.water_page_arrived){const w=p.waterLayer;engine.water_page_arrived(p.face,p.level,p.x,p.y,w.levelOffset,w.levelScale,w.uniform?w.uniform.kind:-1,w.uniform?w.uniform.level:0,w.bytes?new Uint8Array(w.bytes):new Uint8Array(0));}}
 engine.page_backlog(fieldPages.length);
 const commands=engine.page_commands();if(commands)fieldPort.postMessage(JSON.parse(commands));
}
async function invoke(method,args){
 if(dead)throw Error('The GPU worker stopped after device loss. Retry initialization.');
 if(method==='initialize'){
  if(!navigator.gpu)throw Error('WebGPU is unavailable in this browser worker. Use a current browser with hardware acceleration.');
  progress({stage:'Loading engine',detail:'WebAssembly in render worker'});
  globalThis.solarStartupMark('wasm loading');await init();globalThis.solarStartupMark('wasm initialized');progress({stage:'Requesting GPU',detail:'Selecting adapter and creating device'});
  engine=await Explorer.create(args[0],args[1]||'full',args[2]||'procedural');
  packBase=(await packSite()).base;
  if(args[3]){earthField=args[3];connectField(args[3]);}
  globalThis.solarStartupMark('field connected');
  if(args[4]){engine.enable_space();loadSpaceAssets(JSON.parse(SolarFlight.catalogue()));}
  globalThis.solarStartupMark('space enabled');
  compilation.allowDiagnostics();
  compilation.ready_ms=performance.now()-compilation.started;
  compilation.whenComplete().then(()=>{compilation.complete_ms=performance.now()-compilation.started;},()=>{});
  return {settings:engine.settings(),...metadata(true),startup:report()};
 }
 if(method==='startup_report')return report();
 if(method==='render'){
  const cpuStarted=performance.now();
  if(args[3]){exchangeSpace();const changed=engine.space(args[3]);engine.trails(args[4]||new Float32Array(0));if(changed)connectField(fieldFor(SolarFlight.body_name(changed)));}
  if(fieldPort&&performance.now()-lastVectorEye>500){
   lastVectorEye=performance.now();
   const camera=args[0],position=stats?.buildings?.enabled===false?[0,0,0]:camera.slice(0,3);
   fieldPort.postMessage({type:'vectorEye',position,target:camera.slice(3,6),width:stats?.width,height:stats?.height,ground:engine.ground_height()});
  }
  exchangeField();
  // A direction to ask the terrain about (a landmark trip's end), on the body this frame has just made the surface one.
  const probe=args[5]?engine.height(args[5][0],args[5][1],args[5][2]):undefined;
  const rendered=engine.render(args[0],args[1],args[2]);lastFrameCpu=performance.now()-cpuStarted;
  if(rendered){
   const done=engine.completion();inFlight.push(done);
   const previous=inFlight.length>1?inFlight[inFlight.length-2]:null;
   done.then(()=>{const i=inFlight.indexOf(done);if(i>=0)inFlight.splice(i,1);},()=>{const i=inFlight.indexOf(done);if(i>=0)inFlight.splice(i,1);});
   if(queueDepth<2)await done;else if(previous)await previous;
  }
  return {rendered,probe,...metadata(false)};
 }
 if(method==='frame_queue_depth'){engine.frame_queue_depth(...args);queueDepth=args[0];return {value:undefined,...metadata(true)};}
 if(method==='flush'){if(!compilation.flushed)globalThis.solarStartupMark('first flush start');await engine.wait_idle();if(!compilation.flushed){compilation.flushed=true;globalThis.solarStartupMark('first flush done');}return metadata(true);}
 if(!engine||typeof engine[method]!=='function')throw Error(`Unknown renderer operation: ${method}`);
 if(method==='profiling')profilingOn=!!args[0];
 const value=await engine[method](...args);
 return {value,...metadata(true)};
}
const run=(id,method,args)=>{
 tail=tail.then(async()=>{
  try{const result=await invoke(method,args);const transfer=result?.value instanceof Uint8Array?[result.value.buffer]:[];postMessage({type:'result',id,result},transfer);}
  catch(error){postMessage({type:'result',id,error:String(error)});if(method==='initialize'||method==='render')fatal(error);}
 });
};
onmessage=({data:{id,method,args}})=>run(id,method,args);
onunhandledrejection=event=>{event.preventDefault();fatal(event.reason);};
