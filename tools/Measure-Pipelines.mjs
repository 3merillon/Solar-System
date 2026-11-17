// Serial browser compile time of the exact pruned startup programs the build
// emits (OUT_DIR/pipelines.json), one at a time, in a private headless browser
// with a fresh profile (cold browser shader cache). Uses the worker's own
// descriptorFor, so descriptors match startup. Compilation is CPU work in the
// browser's GPU process; this is not a rendering measurement.
//   node tools/Measure-Pipelines.mjs [--json path] [--only a,b] [--output dir] [--repeat n] [--base http://127.0.0.1:5198]
import {headless} from './Headless.mjs';
import {readFile,readdir,stat,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
async function newestPipelines(){
 let best=null;
 for(const root of ['target/wasm32-unknown-unknown/release/build','target/debug/build','target/release/build']){
  let names=[];try{names=await readdir(root);}catch{continue;}
  for(const n of names.filter(n=>n.startsWith('solar-explorer-'))){const p=join(root,n,'out','pipelines.json');try{const s=await stat(p);if(!best||s.mtimeMs>best.t)best={p,t:s.mtimeMs};}catch{}}
 }
 return best?.p;
}
const file=arg('json',await newestPipelines());
const programs=JSON.parse(await readFile(file,'utf8'));
const only=arg('only','')?arg('only').split(','):null;
const list=programs.filter(p=>!only||only.includes(p.key));
// --src dir: replace each program's code by dir/<key>.wgsl when present (experiments on copies).
const srcDir=arg('src',null);
if(srcDir)for(const p of list){try{p.code=await readFile(join(srcDir,p.key+'.wgsl'),'utf8');}catch{}}
const dir=resolve(arg('output','evidence/local/startup/pipelines'));await mkdir(dir,{recursive:true});
const repeat=+arg('repeat',1);
const b=await headless(dir);
// --loads n: repeat the whole measurement in fresh page loads of the same profile (browser shader cache test, with --fixed).
for(let load=0;load<+arg('loads',1);load++)try{
 await b.send('Page.navigate',{url:arg('base','http://127.0.0.1:5198')+'/compile-bench.html?'+load});
 await new Promise(r=>setTimeout(r,500));
 // Device once per page load; one evaluate per program (a single evaluate of every program outlives the CDP timeout).
 const adapterInfo=await b.evaluate(`(async()=>{
  const {descriptorFor}=await import('/gpu-startup.js');window.descriptorFor=descriptorFor;
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});const L=adapter.limits,keys=['maxStorageBuffersPerShaderStage','maxSampledTexturesPerShaderStage','maxStorageTexturesPerShaderStage','maxBindingsPerBindGroup','maxUniformBuffersPerShaderStage','maxComputeWorkgroupStorageSize','maxComputeInvocationsPerWorkgroup','maxStorageBufferBindingSize','maxBufferSize','maxColorAttachmentBytesPerSample'];
  window.device=await adapter.requestDevice({requiredLimits:Object.fromEntries(keys.map(k=>[k,L[k]])),requiredFeatures:[...adapter.features].filter(f=>['float32-filterable','timestamp-query','shader-f16','rg11b10ufloat-renderable','float32-blendable'].includes(f))});
  window.gpuErrors=[];device.addEventListener('uncapturederror',e=>gpuErrors.push(e.error.message));
  return adapter.info?{vendor:adapter.info.vendor,architecture:adapter.info.architecture}:null;})()`);
 const fixed=process.argv.includes("--fixed");const results=[];
 for(const p of list)for(let r=0;r<repeat;r++){
  results.push(await b.evaluate(`(async()=>{const p=${JSON.stringify(p)};
   const code=${fixed}?p.code:p.code+String.fromCharCode(10)+'// '+${r}+' '+Math.random();
   const t0=performance.now();const module=device.createShaderModule({label:p.key,code});const info=await module.getCompilationInfo();const t1=performance.now();
   const err=info.messages.filter(m=>m.type==='error').map(m=>m.lineNum+':'+m.message);
   if(err.length)return {key:p.key,error:err.join('; ')};
   try{const d=descriptorFor(p,module,navigator.gpu.getPreferredCanvasFormat());await (p.compute?device.createComputePipelineAsync(d):device.createRenderPipelineAsync(d));return {key:p.key,module_ms:t1-t0,pipeline_ms:performance.now()-t1,bytes:p.code.length};}
   catch(e){return {key:p.key,error:String(e)};}})()`));
 }
 const out={rows:results,errors:await b.evaluate('gpuErrors'),adapter:adapterInfo};
 await writeFile(resolve(dir,'report.json'),JSON.stringify({file,browser:b.version,...out},null,1));
 const rows=out.rows.slice().sort((a,b)=>(b.pipeline_ms||0)-(a.pipeline_ms||0));
 let total=0;for(const r of rows){total+=r.pipeline_ms||0;console.log(`${r.key.padEnd(30)} ${r.error?'ERROR '+r.error.slice(0,200):(r.pipeline_ms.toFixed(0).padStart(7)+' ms  module '+r.module_ms.toFixed(0).padStart(4)+' ms  '+(r.bytes/1024).toFixed(0)+'k')}`);}
 console.log('serial total',total.toFixed(0),'ms; adapter',JSON.stringify(out.adapter),'errors',out.errors.length);
}finally{if(load+1>=+arg('loads',1))await b.close();}
