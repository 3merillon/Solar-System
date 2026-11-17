// Time browser shader compilation for the concatenated explorer WGSL without a
// WASM build: the same Tint/driver path the worker uses, one entry point at a
// time, in a private headless browser. Compilation time is CPU work in the
// browser's GPU process; it is not a rendering measurement. The worker
// compiles Naga-pruned per-entry sources; compiling the full module here can
// take far longer for a few scheduling kernels (gpu_select), so use
// Test-Startup.mjs for shipped numbers and this tool for bisection.
import {headless} from './Headless.mjs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const dir=resolve(arg('output','evidence/local/perf-pass/compile'));await mkdir(dir,{recursive:true});
const files=arg('files','explorer,surface_field,surface_detail,water,clouds,sun_visibility,sun_clouds,scenery_common,terrain_gpu,scenery,sun_casters').split(',');
const entries=arg('entries','water,shade,scenery_shade,composite,cloud_pass,scenery_cull,sun_cloud_local_generate,gpu_morph_vertices').split(',');
const repeat=+arg('repeat',1);
const shaderDir=arg('dir','shaders');let source='';for(const f of files)source+=await readFile(resolve(shaderDir,f+'.wgsl'),'utf8')+'\n';
const b=await headless(dir);
try{
 await b.send('Page.navigate',{url:'http://127.0.0.1:5198/compile-bench.html'});
 await new Promise(r=>setTimeout(r,500));
 const result=await b.evaluate(`(async()=>{
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});const device=await adapter.requestDevice();
  const code=${JSON.stringify(source)};
  const t0=performance.now();const module=device.createShaderModule({code});const info=await module.getCompilationInfo();const moduleMs=performance.now()-t0;
  const errors=info.messages.filter(m=>m.type==='error').map(m=>m.lineNum+':'+m.linePos+' '+m.message);
  if(errors.length)return {errors};
  const out={moduleMs,pipelines:[]};
  for(const entry of ${JSON.stringify(entries)}){
   for(let r=0;r<${repeat};r++){
    // Vary the label/source trivially to defeat the in-process pipeline cache on repeats.
    const m=r===0?module:device.createShaderModule({code:code+'\\n//'+r});
    const t=performance.now();
    try{await device.createComputePipelineAsync({label:entry+r,layout:'auto',compute:{module:m,entryPoint:entry}});out.pipelines.push({entry,ms:performance.now()-t});}
    catch(e){out.pipelines.push({entry,error:String(e)});}
   }
  }
  return out;})()`);
 await writeFile(resolve(dir,'report.json'),JSON.stringify({files,entries,result},null,1));
 if(result.errors){console.error(result.errors.join('\n'));process.exitCode=1;}
 else{console.log('module '+result.moduleMs.toFixed(0)+' ms');for(const p of result.pipelines)console.log(`${p.entry.padEnd(28)} ${p.error?p.error:p.ms.toFixed(0)+' ms'}`);}
}finally{await b.close();}
