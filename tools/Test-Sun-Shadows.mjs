// Private BrowserWebGpu qualification. Never run alongside another GPU test.
import assert from 'node:assert/strict';
import {headless} from './Headless.mjs';
import {ready,runFrames,capture} from './Explorer-Test-Lib.mjs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const args=process.argv.slice(2),option=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const dir=resolve(option('--output','evidence/local/sun-shadows/browser')),W=Number(option('--width','960')),H=Number(option('--height','540'));
const frames=Number(option('--frames','30')),warmup=Number(option('--warmup','240')),views=option('--views','forest,rocky,ground,coast,orbit').split(',');
await mkdir(dir,{recursive:true});const b=await headless(dir),report={width:W,height:H,options:args,cases:[],gates:[],manifest:JSON.parse((await readFile('web/pkg/explorer-manifest.json','utf8')).replace(/^\uFEFF/,''))};
const difference=(a,b)=>{const d=[];let sum=0,changed=0;for(let i=0;i<a.length;i+=4){const v=(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]))/3;sum+=v;changed+=v>3;d.push(v);}d.sort((a,b)=>a-b);return {mean:sum/d.length,p99:d[Math.floor(d.length*.99)],max:d.at(-1),changed};};
const quantile=v=>{v=v.filter(Number.isFinite).sort((a,b)=>a-b);return {count:v.length,p50:v[Math.floor(v.length*.5)],p95:v[Math.floor(v.length*.95)],p99:v[Math.floor(v.length*.99)]};};
const summary=run=>({frame:quantile(run.rows.filter(r=>r.gpu_ms).map(r=>r.gpu_ms.reduce((s,v)=>s+v,0))),stages:Object.fromEntries(run.stats.stage_names.map((name,i)=>[name,quantile(run.rows.filter(r=>r.gpu_ms).map(r=>r.gpu_ms[i]))])),pacing:quantile(run.pacing),bytes:run.stats.controlled_gpu_bytes});
const save=()=>writeFile(resolve(dir,'report.json'),JSON.stringify(report));
try {
 await b.send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:false});await b.send('Page.navigate',{url:'http://127.0.0.1:5198/?test=1&body=procedural'});await ready(b);
 await b.evaluate(`solarExplorer.resize(${W},${H});solarExplorer.engine.profiling(true);solarExplorer.time=0;`);
 report.defaults=await b.evaluate('solarExplorer.snapshot().settings');assert.equal(report.defaults.shadows,true);assert.equal(report.defaults.cloud_steps,128);assert.equal(report.defaults.cloud_scale,1);assert.equal(report.defaults.lod_distance,4);
 for(const view of views){
  console.log('sun:',view);await b.evaluate(`solarExplorer.configure({shadows:true,shadow_diagnostic:0});solarExplorer.go(${JSON.stringify(view)});solarExplorer.time=0;`);
  if(args.includes('--altitude'))await b.evaluate(`{const c=solarExplorer.camera,n=c[0].map(v=>v/Math.hypot(...c[0])),h=solarExplorer.engine.height(...n),eye=n.map(v=>v*(solarExplorer.engine.radius()+h+${Number(option('--altitude','8000'))}));solarExplorer.camera=[eye,c[1],c[2]];}`);
  if(args.includes('--no-props'))await b.evaluate('solarExplorer.configure({trees:false,rocks:false})');
  const stress=args.includes('--terrain-stress')&&['rough','ground'].includes(view);
  if(args.includes('--simple')||stress)await b.evaluate('solarExplorer.configure({clouds:false,water:false,atmosphere:false})');
  if(args.includes('--low-sun')||args.includes('--sun-height')||stress){const height=Number(option('--sun-height',stress?'.025':'.2'));assert.ok(height>0&&height<=1);await b.evaluate(`{const n=solarExplorer.camera[0].map(v=>v/Math.hypot(...solarExplorer.camera[0]));let t=[-n[1],n[0],0];t=t.map(v=>v/Math.hypot(...t));solarExplorer.configure({sun:n.map((v,j)=>v*${height}+t[j]*Math.sqrt(1-${height}**2))});}`);}
  const cold=[];for(let i=0;i<warmup;i+=30)cold.push(await runFrames(b,Math.min(30,warmup-i)));
  const on=await runFrames(b,frames),image=await capture(b,resolve(dir,`${view}-on.png`),W,H);
  const row={name:view,on:summary(on),cold,snapshot:await b.evaluate('solarExplorer.snapshot()')};
  if(!args.includes('--no-audit')){
   row.geometry=JSON.parse(await b.evaluate('solarExplorer.engine.audit_geometry()'));
   row.audit=JSON.parse(await b.evaluate('solarExplorer.engine.audit_shadows()'));
   await writeFile(resolve(dir,`${view}-audit.json`),JSON.stringify(row));
   report.gates.push({name:`${view}: caster overflow`,pass:row.audit.overflow===0,count:row.audit.overflow});
   report.gates.push({name:`${view}: settled caster preparation`,pass:row.audit.incomplete_casters===0,count:row.audit.incomplete_casters});
   for(const sample of row.audit.samples)assert.ok(sample.every(Number.isFinite));
  }
  await b.evaluate('solarExplorer.configure({shadows:false})');await runFrames(b,2);row.off=summary(await runFrames(b,frames));row.difference=difference(image,await capture(b,resolve(dir,`${view}-off.png`),W,H));
  await b.evaluate('solarExplorer.configure({shadows:true});solarExplorer.engine.audit_rebase(4096,-4096,4096)');await runFrames(b,2);row.rebase=difference(image,await capture(b,resolve(dir,`${view}-rebase.png`),W,H));await b.evaluate('solarExplorer.engine.audit_rebase(0,0,0)');
  for(const [name,diagnostic] of [['solid',1],['cloud',2],['unresolved',3]]){await b.evaluate(`solarExplorer.configure({shadow_diagnostic:${diagnostic}})`);await runFrames(b,1);await capture(b,resolve(dir,`${view}-${name}.png`),W,H);}
  await b.evaluate('solarExplorer.configure({shadow_diagnostic:0})');report.cases.push(row);await save();console.log(JSON.stringify({view,on:row.on,off:row.off.frame,difference:row.difference,rebase:row.rebase,casters:row.audit?.casters}));
 }
 assert.ok(report.gates.every(g=>g.pass),JSON.stringify(report.gates.filter(g=>!g.pass)));
}finally{await b.close();}
