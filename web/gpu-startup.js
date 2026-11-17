// wgpu 30 exposes only immediate pipeline creation. Precompile the exact
// descriptors with WebGPU's asynchronous API, then let wgpu wrap those SAME
// completed handles. This bridge is scoped to this worker's device. No second
// compilation, global prototype changes, disabled validation or browser flags.
//
// Programs that only the ocean, the clouds, the scenery shading or diagnostics
// need are deferred: the renderer starts, and shows its first image, once the
// terrain programs exist, then creates each deferred feature as soon as its
// programs have compiled (solarPipelineReady). The renderer's Rust side lists
// the same programs as lazily created; a program deferred here but created
// eagerly there fails startup loudly instead of compiling twice.
const DEFERRED=new Set(['shade','water','ocean_vertex','ocean_cap_vertex','water_mesh_vertex','water_mesh_cap_vertex','cloud_pass','cloud_far_pass','cloud_local_generate','scenery_cull','scenery_refresh','scenery_cover_place','scenery_shade','sun_cloud_local_generate','sun_cloud_global_generate']);
// The longest deferred programs start at once in lanes of their own on
// machines with twelve or more threads, so they finish close to the first image.
const HEAVY=['water','shade','cloud_pass'];
// Diagnostic programs: no gameplay path uses them; an explicit audit compiles its program once.
const DIAGNOSTICS=new Set(['gpu_audit_morph','scenery_audit_contact','scenery_audit_footprint','scenery_audit_cover','sun_audit','sun_world_audit']);
// Lanes in two phases (measured cold, 5 Nov 2026, i7-12700F / RTX 3080, docs/STARTUP.md): the browser's GPU process
// runs only a few compilations at once, so eleven jobs at t=0 delayed the first image (26 s) behind the ocean and the
// clouds, and four lanes alone delayed the last program (76 s). Until the first image's programs exist only
// FIRST_LANES lanes run, plus the water program (the longest, alone on its lane from t=0); then the remaining lanes
// and heavy programs join.
export function installCompiler(progress,fatal){
 // Compiler jobs are browser-managed CPU work. The browser ran four concurrent
 // compilations at 3.9x; larger desktops get up to eight lanes and phones keep
 // two to four so neither the UI nor the GPU process is starved. The browser's
 // own disk shader cache makes the second launch of an identical build far
 // cheaper; the report records which case was observed.
 const cores=Math.max(1,Number(navigator.hardwareConcurrency)||4);
 const query=new URL(self.location.href).searchParams,forced=Number(query.get('lanes'))||0,forcedHeavy=query.has('heavy')?Math.max(0,Math.min(HEAVY.length,Number(query.get('heavy'))||0)):null;
 const report={pipelines:[],cacheHits:0,unexpectedCompiles:0,started:performance.now(),worker:true,concurrency:forced>0?Math.min(16,forced):cores<=4?2:cores<=8?4:Math.min(8,Math.floor(cores/2)),extra_lanes:forcedHeavy??(cores>=12?HEAVY.length:0),deferred:[...DEFERRED]};
 let complete=Promise.resolve();
 report.whenComplete=()=>complete;
 globalThis.solarCompilePipelines=async(device,json)=>{
  const programs=JSON.parse(json).filter(p=>!DIAGNOSTICS.has(p.key)),modules=new Map(),ids=new WeakMap(),cache=new Map(),compiled=new Set();
  report.on_demand=[...DIAGNOSTICS];
  globalThis.solarStartupMark?.('program registry parsed');
  const shader=device.createShaderModule.bind(device),compute=device.createComputePipeline.bind(device),render=device.createRenderPipeline.bind(device);
  let lostMessage;
  device.addEventListener('uncapturederror',event=>{event.preventDefault();fatal(`GPU error: ${event.error.message}`);});
  const lost=device.lost.then(info=>{lostMessage=`GPU device lost (${info.reason}): ${info.message}`;fatal(lostMessage);throw Error(lostMessage);});
  // The races below observe losses while compilation is pending. Retain a
  // rejection handler after initialization as well (no unhandled rejection).
  lost.catch(()=>{});
  const fingerprint=d=>JSON.stringify(canonical(d,ids));
  let completed=0;const active=new Set();
  const notify=last_ms=>progress({stage:'Compiling shaders',detail:[...active].join(' · ')||'All shaders compiled',completed,total:programs.length,elapsed_ms:performance.now()-report.started,last_ms});
  const first=programs.filter(p=>!DEFERRED.has(p.key));
  let firstRemaining=first.length,resolveFirst;const firstDone=new Promise(resolve=>{resolveFirst=resolve;});
  const compile=async p=>{
   if(lostMessage)throw Error(lostMessage);
   active.add(p.key);notify();
   const started=performance.now(),module=shader({label:p.key,code:p.code});
   modules.set(p.code,module);ids.set(module,p.key);
   const messages=(await Promise.race([module.getCompilationInfo(),lost])).messages;
   const moduleDone=performance.now();
   const errors=messages.filter(m=>m.type==='error');
   if(errors.length)throw Error(`${p.key}: ${errors.map(m=>`${m.lineNum}:${m.linePos} ${m.message}`).join('\n')}`);
   const descriptor=descriptorFor(p,module,navigator.gpu.getPreferredCanvasFormat());
   const pipeline=await Promise.race([p.compute?device.createComputePipelineAsync(descriptor):device.createRenderPipelineAsync(descriptor),lost]);
   cache.set(fingerprint(descriptor),pipeline);compiled.add(p.key);
   report.pipelines.push({name:p.key,start_ms:started-report.started,module_ms:moduleDone-started,pipeline_ms:performance.now()-moduleDone,ms:performance.now()-started,source_bytes:p.code.length,deferred:DEFERRED.has(p.key),messages:messages.map(m=>({type:m.type,message:m.message,line:m.lineNum}))});
   completed++;active.delete(p.key);notify(report.pipelines.at(-1).ms);
   if(!DEFERRED.has(p.key)&&--firstRemaining===0)resolveFirst();
  };
  // Bound compiler CPU/memory pressure. These are browser-managed asynchronous
  // compiler jobs, not dispatches on the GPU queue. Longest programs first
  // (by measured cost order, then source size) so the lanes finish together,
  // and every first-image program before the deferred ones.
  const costly=['water','cloud_pass','sun_audit','shade','scenery_shade','sun_world_audit','scenery_cull','composite','sun_cloud_local_generate','sun_cloud_global_generate','gpu_morph_vertices'];
  const rank=p=>{const i=costly.indexOf(p.key);return i<0?costly.length+1/(1+p.code.length):i;};
  const order=(a,b)=>rank(a)-rank(b);
  const later=programs.filter(p=>DEFERRED.has(p.key)).sort(order);
  const heavy=later.filter(p=>HEAVY.slice(0,report.extra_lanes).includes(p.key));
  const queue=[...first.sort(order),...later.filter(p=>!heavy.includes(p))];
  let cursor=0;
  const run=async p=>{try{await compile(p);}catch(error){throw Error(`${p.key}: ${error.message??error}`);}};
  const lane=async()=>{while(cursor<queue.length)await run(queue[cursor++]);};
  const early=heavy.filter(p=>p.key==='water'),late=heavy.filter(p=>p.key!=='water');
  report.first_lanes=Math.min(report.concurrency,report.extra_lanes?4:report.concurrency);
  const opening=[...Array.from({length:report.first_lanes},lane),...early.map(run)];
  // The rest join once the first image's programs exist.
  complete=Promise.all([...opening,firstDone.then(()=>Promise.all([...Array.from({length:report.concurrency-report.first_lanes},lane),...late.map(run)]))]);
  complete.then(()=>{
   report.compile_ms=performance.now()-report.started;
   report.longest_ms=Math.max(0,...report.pipelines.map(p=>p.ms));
   report.likely_warm_cache=report.longest_ms<1500;
   progress({stage:'All shaders compiled',detail:'',completed,total:programs.length,elapsed_ms:report.compile_ms});
  },error=>fatal(error));
  await Promise.race([firstDone,complete]);
  report.first_ms=performance.now()-report.started;
  // A warm browser shader cache compiles the whole registry in a few seconds;
  // a cold one takes tens of seconds. Record the observation for the startup
  // panel and diagnostics without claiming to know the cache state directly.
  report.longest_ms=Math.max(0,...report.pipelines.map(p=>p.ms));
  report.likely_warm_cache=report.longest_ms<1500;
  device.createShaderModule=d=>modules.get(d.code)??shader(d);
  const wrapped=d=>{const key=fingerprint(d),p=cache.get(key);if(p){report.cacheHits++;return p;}report.unexpectedCompiles++;throw Error(`Pipeline missing from asynchronous startup: ${d.label||d.compute?.entryPoint||d.vertex?.entryPoint}. Descriptor: ${key}`);};
  // The space pass's small programs have their own module and are created when it turns on, so a single body's startup never holds them.
  // The finish (finish.wgsl: the HDR frame to the display image) is a small module of its own too, created with the renderer.
  const SPACE=new Set(['space bodies','space far planet','far cloud levels','stars','space trails','space ring rocks','space belt rocks','space sky','space belt','space asteroids','finish','bloom down','bloom up','exposure meter']);
  device.createComputePipeline=d=>SPACE.has(d.label)?compute(d):wrapped(d);
  device.createRenderPipeline=d=>SPACE.has(d.label)?render(d):wrapped(d);
  // The renderer asks before creating a deferred program's pipeline.
  globalThis.solarPipelineReady=key=>compiled.has(key);
  // Diagnostics compile only when explicitly requested, on the worker.
  report.allowDiagnostics=()=>{device.createComputePipeline=d=>SPACE.has(d.label)?compute(d):cache.get(fingerprint(d))??compute(d);};
  progress({stage:'Allocating planet resources',detail:'Terrain, ocean, scenery and shadow caches',completed,total:programs.length,elapsed_ms:performance.now()-report.started});
 };
 return report;
}
export function descriptorFor(p,module,canvasFormat){
 const stage=entryPoint=>({module,entryPoint});
 if(p.compute)return {label:p.key,layout:'auto',compute:stage(p.compute)};
 const descriptor={label:p.key,layout:'auto',vertex:{...stage(p.vertex),buffers:[]},fragment:{...stage(p.fragment),targets:p.formats.map(format=>({format:format==='canvas'?canvasFormat:format,writeMask:15}))},primitive:{topology:'triangle-list',frontFace:'ccw',cullMode:p.cull??'none',unclippedDepth:false},multisample:{count:1,mask:0xffffffff,alphaToCoverageEnabled:false}};
 if(p.compare){const stencil={compare:'always',depthFailOp:'keep',failOp:'keep',passOp:'keep'};descriptor.depthStencil={format:'depth32float',depthCompare:p.compare,depthWriteEnabled:true,depthBias:p.key==='building_shadow'?2:0,depthBiasClamp:0,depthBiasSlopeScale:p.key==='building_shadow'?2:0,stencilBack:stencil,stencilFront:stencil,stencilReadMask:0,stencilWriteMask:0};}
 return descriptor;
}
function canonical(value,ids){
 if(value===null||typeof value!=='object')return value;
 if(ids.has(value))return {shader:ids.get(value)};
 if(Array.isArray(value))return value.map(v=>canonical(v,ids));
 return Object.fromEntries(Object.keys(value).filter(k=>k!=='label'&&value[k]!==undefined).sort().map(k=>[k,canonical(value[k],ids)]));
}
