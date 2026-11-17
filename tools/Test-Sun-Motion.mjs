// Deterministic motion, fixed world probes, cuts and invalidation in a private
// BrowserWebGpu session. Run sequentially with every other GPU qualification.
import assert from 'node:assert/strict';
import {headless} from './Headless.mjs';
import {ready,runFrames,capture} from './Explorer-Test-Lib.mjs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const dir=resolve(process.argv[2]||'evidence/local/sun-motion'),W=960,H=540;
await mkdir(dir,{recursive:true});const b=await headless(dir),report={cases:[],gates:[],manifest:JSON.parse((await readFile('web/pkg/explorer-manifest.json','utf8')).replace(/^\uFEFF/,''))};
const save=()=>writeFile(resolve(dir,'report.json'),JSON.stringify(report));
const audit=async()=>JSON.parse(await b.evaluate('solarExplorer.engine.audit_shadows()'));
const probeDiff=(a,c)=>Object.fromEntries([8,10,12,15,16].map(k=>{const d=a.fixed_samples.map((v,i)=>Math.abs(v[k]-c.fixed_samples[i][k])).sort((a,b)=>a-b);return[k,{mean:d.reduce((s,v)=>s+v,0)/d.length,p99:d[Math.floor(d.length*.99)],max:d.at(-1)}];}));
const finite=a=>a.samples.concat(a.fixed_samples).every(v=>v.every(Number.isFinite));
const gate=(name,pass,metrics)=>report.gates.push({name,pass,metrics});
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:false});await b.send('Page.navigate',{url:'http://127.0.0.1:5198/?test=1&body=procedural'});await ready(b);
 await b.evaluate(`solarExplorer.resize(${W},${H});solarExplorer.engine.profiling(true);solarExplorer.go('forest');solarExplorer.configure({cloud_speed:0,cloud_evolution:0,scenery_wind:0});solarExplorer.time=0;window.c=solarExplorer.camera.map(v=>[...v]);window.n=c[0].map(v=>v/Math.hypot(...c[0]));window.t=[-n[1],n[0],0];t=t.map(v=>v/Math.hypot(...t));window.u=[n[1]*t[2]-n[2]*t[1],n[2]*t[0]-n[0]*t[2],n[0]*t[1]-n[1]*t[0]];`);
 for(let i=0;i<8;i++)await runFrames(b,30);
 if(!process.argv.includes('--contact-only')){
 const base=await audit();report.base=base;
 console.log('sun motion: fixed-position 360 turn');
 const turn=[];for(let i=0;i<=72;i++){
  await b.evaluate(`{const a=${i}*Math.PI/36;solarExplorer.camera=[c[0],c[0].map((v,j)=>v+1000*(t[j]*Math.cos(a)+u[j]*Math.sin(a)-n[j]*.06)),n];}`);await runFrames(b,1);await capture(b,resolve(dir,`turn-${String(i).padStart(3,'0')}.png`),W,H);
  if(i%18===0){const a=await audit();turn.push({frame:i,difference:probeDiff(base,a),overflow:a.overflow});gate(`turn ${i} finite and no caster overflow`,finite(a)&&a.overflow===0,{overflow:a.overflow,incomplete_casters:a.incomplete_casters});}
 }report.cases.push({name:'turn',probes:turn});gate('fixed world cloud visibility during turns',turn.every(r=>r.difference[12].max<.005),turn.map(r=>r.difference[12]));await save();
 await b.evaluate('solarExplorer.camera=c');await runFrames(b,90);const settled=await audit();
 await b.evaluate('solarExplorer.engine.audit_rebase(4096,-4096,4096)');await runFrames(b,1);const rebased=await audit();const rebase=probeDiff(settled,rebased);gate('fixed world rebase',rebase[12].max<.01&&rebase[10].mean<.01,rebase);await b.evaluate('solarExplorer.engine.audit_rebase(0,0,0)');
 for(let i=0;i<24;i++){await b.evaluate(`{let d=Math.sin(${i}/24*Math.PI*2)*.02;solarExplorer.camera=[c[0].map((v,j)=>v+t[j]*d),c[1].map((v,j)=>v+t[j]*d),c[2]];}`);await runFrames(b,1);await capture(b,resolve(dir,`subpixel-${String(i).padStart(3,'0')}.png`),W,H);}
 await b.evaluate('solarExplorer.camera=c;solarExplorer.configure({shadow_steps:1})');await runFrames(b,1);const limited=await audit();const unresolved=limited.fixed_samples.filter(s=>s[9]>.5).length;const work=Math.max(...limited.fixed_samples.map(s=>Math.floor(s[19])));gate('terrain work is bounded by the budget',work<=1,{unresolved,work_max:work,total:limited.fixed_samples.length});await b.evaluate('solarExplorer.configure({shadow_steps:64})');
 await b.evaluate('solarExplorer.configure({edits:[[...n,100,12]]})');await runFrames(b,2);const edit=await audit();const editDiff=probeDiff(settled,edit);gate('terrain cache invalidates on edit',editDiff[16].max>1&&finite(edit),editDiff);await b.evaluate('solarExplorer.configure({edits:[]})');
 report.cases.push({name:'rebase and edits',rebase,editDiff,limited:{unresolved}});await save();
 console.log('sun motion: cold cuts');
 for(const view of ['coast','rough','pole','face-edge','corner','antipode','orbit']){
  await b.evaluate(`solarExplorer.go(${JSON.stringify(view)})`);const cold=await runFrames(b,1);await capture(b,resolve(dir,`cut-${view}.png`),W,H);const a=await audit();gate(`${view} cold cut`,finite(a)&&a.overflow===0,{overflow:a.overflow,unresolved:a.samples.filter(s=>s[9]>.5).length});report.cases.push({name:`cut-${view}`,cold});await save();
 }
 console.log('sun motion: cloud-layer descent and evolving sun');
 await b.evaluate(`solarExplorer.go('clouds');solarExplorer.configure({cloud_type:1,cloud_cover:.3,cloud_speed:1,cloud_evolution:1,scenery_wind:1});window.n=solarExplorer.camera[0].map(v=>v/Math.hypot(...solarExplorer.camera[0]));window.t=[-n[1],n[0],0];t=t.map(v=>v/Math.hypot(...t));`);
 const descent=[];for(let i=0;i<90;i++){
  await b.evaluate(`{const h=22000*Math.exp(-${i}/30)+1400;const eye=n.map(v=>v*(solarExplorer.engine.radius()+h));solarExplorer.camera=[eye,eye.map((v,j)=>v+t[j]*1000-n[j]*250),n];solarExplorer.time=${i}/3;const a=.2+${i}/90;solarExplorer.configure({sun:n.map((v,j)=>v*Math.sin(a)+t[j]*Math.cos(a))});}`);
  descent.push(await runFrames(b,1));await capture(b,resolve(dir,`descent-${String(i).padStart(3,'0')}.png`),W,H);
 }report.cases.push({name:'cloud-descent-sun-wind',frames:descent});await save();
 }
 // Contact captures use the exact admitted object. The regular light pass
 // still chooses representations from light texels, never the camera view.
 console.log('sun motion: close tree and rock contact');
 await b.evaluate("solarExplorer.go('forest');solarExplorer.configure({clouds:false,scenery_wind:0});solarExplorer.time=0");await runFrames(b,240);const scenery=JSON.parse(await b.evaluate('solarExplorer.engine.audit_scenery()'));const eye=await b.evaluate('solarExplorer.camera[0]');
 for(const kind of [1,2]){
  const o=scenery.objects.filter(o=>o.kind===kind&&o.shape[0]>5).sort((a,c)=>Math.hypot(...a.hi.map((v,j)=>v+a.lo[j]-eye[j]))-Math.hypot(...c.hi.map((v,j)=>v+c.lo[j]-eye[j])))[0];assert.ok(o);
  await b.evaluate(`{const o=${JSON.stringify(o)},root=o.hi.map((v,j)=>v+o.lo[j]),n=root.map(v=>v/Math.hypot(...root)),t=[-n[1],n[0],0],s=Math.hypot(...t);const eye=root.map((v,j)=>v+n[j]*o.shape[0]*.65+t[j]/s*o.shape[0]*2.5);solarExplorer.camera=[eye,root.map((v,j)=>v+n[j]*o.shape[0]*.3),n];solarExplorer.configure({scenery_isolate:o.slot+1,shadows:true,sun:n.map((v,j)=>v*.5-t[j]/s*Math.sqrt(.75))});}`);await runFrames(b,120);await capture(b,resolve(dir,`contact-${kind===1?'tree':'rock'}.png`),W,H);report.cases.push({name:`contact-${kind}`,object:o});
  await b.evaluate('solarExplorer.configure({shadows:false})');await runFrames(b,1);await capture(b,resolve(dir,`contact-${kind===1?'tree':'rock'}-off.png`),W,H);
  if(kind===1){
   await b.evaluate(`{const o=${JSON.stringify(o)},root=o.hi.map((v,j)=>v+o.lo[j]),n=root.map(v=>v/Math.hypot(...root));let t=[-n[1],n[0],0];t=t.map(v=>v/Math.hypot(...t));let q=root.map((v,j)=>v+t[j]*o.shape[0]*.8),len=Math.hypot(...q),h=solarExplorer.engine.height(...q);q=q.map(v=>v/len*(solarExplorer.engine.radius()+h));solarExplorer.camera=[q.map((v,j)=>v+n[j]*3+t[j]*2),q,n];solarExplorer.configure({shadows:true});}`);await runFrames(b,120);await capture(b,resolve(dir,'contact-tree-detail.png'),W,H);
  }

 }
 await save();console.log(JSON.stringify(report.gates));assert.ok(report.gates.every(g=>g.pass));
}finally{await b.close();}
