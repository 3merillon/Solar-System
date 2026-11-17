// Cold browser compile time of space.wgsl's body program (body_vertex + body_fragment: every body impostor and the stars), one
// fresh private headless profile per compile, createRenderPipelineAsync with an auto layout, alternating the given shader files
// for a number of rounds. Compilation is CPU work in the browser's GPU process; not a rendering measurement.
//   node tools/Measure-Space-Compile.mjs --base http://127.0.0.1:5263 --out DIR --files a.wgsl,b.wgsl [--rounds 3]
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {headless} from './Headless.mjs';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const base=arg('base','http://127.0.0.1:5198'),out=resolve(arg('out','evidence/local/space-compile'));mkdirSync(out,{recursive:true});
const files=arg('files','shaders/space.wgsl').split(','),rounds=+arg('rounds',3);const rows=[];
for(let r=0;r<rounds;r++)for(const file of files){
 const code=readFileSync(file,'utf8');const b=await headless(join(out,`.profile-${r}-${rows.length}`));
 try{
  await b.send('Page.navigate',{url:`${base}/THIRD-PARTY-NOTICES.txt`});await new Promise(x=>setTimeout(x,800));
  const ms=await b.evaluate(`(async()=>{const a=await navigator.gpu.requestAdapter();const d=await a.requestDevice();const code=${JSON.stringify(code)};
   const t0=performance.now();const m=d.createShaderModule({code});
   await d.createRenderPipelineAsync({layout:'auto',vertex:{module:m,entryPoint:'body_vertex'},fragment:{module:m,entryPoint:'body_fragment',targets:[{format:'rgba16float'},{format:'r32float'}]},primitive:{topology:'triangle-list'}});
   return performance.now()-t0;})()`);
  rows.push({round:r,file,ms});console.log(r,file,ms.toFixed(0),'ms');
 }finally{await b.close();}
}
writeFileSync(join(out,'space-compile.json'),JSON.stringify(rows,null,1));
