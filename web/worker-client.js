import init,{CameraWorld} from './pkg/solar_explorer.js';
// Only controls and bounded camera queries remain on the UI thread. GPU setup,
// all pipeline compilation, resource allocation, generation and rendering live
// in render-worker.js. The synchronous test/control facade caches small metadata.
export async function createWorkerExplorer(canvas,onProgress,onFatal,tier='full',body='procedural',field=null,solar=false){
 if(!canvas.transferControlToOffscreen)throw Error('This browser does not support OffscreenCanvas.');
 // ?lanes=N[&heavy=M] overrides the compiler lanes for startup experiments (gpu-startup.js); absent, the worker decides.
 const lanes=new URLSearchParams(location.search),compileQuery=['lanes','heavy'].filter(k=>lanes.has(k)).map(k=>`${k}=${Number(lanes.get(k))}`).join('&');
 const worker=new Worker(new URL('./render-worker.js'+(compileQuery?'?'+compileQuery:''),import.meta.url),{type:'module',name:'Solar renderer'});
 // Pages live in the render worker, so a measured body's camera constraint uses the ground it
 // reports under the camera, at most a frame or two old. Mesh lift still protects the view.
 let sequence=0,closed=false,failed=null,queuedFrames=0,limit=2,stats={},rows=[],animation='{}',startup,ground=0,probeGround=undefined;
 const requests=new Map();
 const fail=error=>{if(failed||closed)return;failed=String(error);queuedFrames=0;for(const p of requests.values())p.reject(Error(failed));requests.clear();onFatal(failed);};
 const update=result=>{if(result?.stats)stats=result.stats;if(result?.telemetry)rows.push(...result.telemetry);if(result?.animation)animation=result.animation;if(result?.ground!==undefined)ground=result.ground;if(result?.probe!==undefined)probeGround=result.probe;};
 worker.onmessage=({data})=>{
  if(data.type==='progress'){onProgress(data);return;}
  if(data.type==='fatal'){fail(data.message);return;}
  const request=requests.get(data.id);if(!request)return;requests.delete(data.id);
  if(data.error)request.reject(Error(data.error));else{update(data.result);request.resolve(data.result);}
 };
 worker.onerror=event=>fail(event.message||'Render worker failed');
 const rpc=(method,args=[],transfer=[])=>{
  if(failed||closed)return Promise.reject(Error(failed||'Renderer closed'));
  return new Promise((resolve,reject)=>{const id=++sequence;requests.set(id,{resolve,reject});worker.postMessage({id,method,args},transfer);});
 };
 const close=()=>{closed=true;worker.terminate();for(const p of requests.values())p.reject(Error('Renderer closed'));requests.clear();};
 try{
  const offscreen=canvas.transferControlToOffscreen();
  const [initialized]=await Promise.all([rpc('initialize',[offscreen,tier,body,field,solar],[offscreen]),init()]);
  const world=new CameraWorld(initialized.settings);startup=initialized.startup;
  const commands=(method,args)=>{const p=rpc(method,args).then(r=>r.value);p.catch(fail);return p;};
  const api={
   close(){world.free();close();},
   settings:()=>world.settings(),radius:()=>world.radius(),bookmark:name=>world.bookmark(name),
   height:(...p)=>body==='procedural'?world.height(...p):ground,safe_height:(...p)=>body==='procedural'?world.height(...p):ground,
   configure(json){world.configure(json);return commands('configure',[json]);},
   animation:()=>animation,
   restore_animation(json){animation=json;return commands('restore_animation',[json]);},
   stats:()=>JSON.stringify({...stats,pending:queuedFrames,device_lost:failed||stats.device_lost}),
   telemetry(){const result=rows;rows=[];return JSON.stringify(result);},
   // packet: what the solar system draws this frame, sent with the frame so the two cannot part. Transferred.
   // probe: a direction in the surface body's axes whose terrain height comes back with the frame (probe_ground).
   probe_ground:()=>probeGround,
   render(camera,dt,time,packet,trails,probe){
    if(failed)throw Error(failed);if(queuedFrames>=limit)return false;
    queuedFrames++;rpc('render',[Array.from(camera),dt,time,packet,trails,probe?Array.from(probe):undefined],[...(packet?[packet.buffer]:[]),...(trails?[trails.buffer]:[])]).then(()=>queuedFrames--,error=>{queuedFrames=Math.max(0,queuedFrames-1);fail(error);});return true;
   },
   frame_queue_depth(value){if(![1,2].includes(value))throw Error('frame queue depth must be one or two');limit=value;return commands('frame_queue_depth',[value]);},
   async flush(){await rpc('flush');},
   // The live report: deferred programs keep compiling after initialization.
   startup:()=>rpc('startup_report'),
  };
  return new Proxy(api,{get(target,name){if(name==='then')return undefined;if(name in target)return target[name];return (...args)=>commands(name,args);}});
 }catch(error){close();throw error;}
}
