// Quick look at the scenery in a private headless browser: per view, the scenery counters (generation jobs, variants
// ready, draws per class, ground cover) and a still. Not a qualification; a development aid. GPU work: run serially.
//   node tools/Inspect-Scenery.mjs --out $SOLAR_DATA/.../inspect [--base http://127.0.0.1:5198] [--views forest,rocky]
//   [--frames 400] [--settings '{"scenery_lod":1}'] [--camera '[[x,y,z],[tx,ty,tz]]'] [--body procedural] [--width 1280 --height 720]
import {headless} from './Headless.mjs';
import {ready,capture,runFrames} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const base=arg('base','http://127.0.0.1:5198'),dir=resolve(arg('out','evidence/local/scenery-inspect')),W=+arg('width',1280),H=+arg('height',720),frames=+arg('frames',400);
const readWatch=async()=>{for(let i=0;i<20;i++){try{return await readFile(arg('watch'),'utf8');}catch{await new Promise(r=>setTimeout(r,50));}}return '';};
const views=arg('views','forest').split(','),settings=JSON.parse(arg('settings','{}')),body=arg('body','procedural');
await mkdir(dir,{recursive:true});
const b=await headless(dir);const report={base,views:{}};
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:false});
 await b.send('Page.navigate',{url:`${base}/explorer.html?test=1&body=${body}${arg('extra','')}`});await ready(b);
 await b.evaluate(`solarExplorer.resize(${W},${H});solarExplorer.engine.profiling(true);`);
 if(Object.keys(settings).length)await b.evaluate(`solarExplorer.configure(${JSON.stringify(settings)})`);
 // --ab '[{...},{...}]' --rounds N: settings variants timed interleaved in this one session on the first view.
 if(arg('ab')){const variants=JSON.parse(arg('ab')),rounds=+arg('rounds',2),view=views[0];await b.evaluate(`solarExplorer.go(${JSON.stringify(view)})`);await runFrames(b,300);const rows=[];
  for(let r=0;r<rounds;r++)for(const [k,v] of variants.entries()){await b.evaluate(`solarExplorer.configure(${JSON.stringify(v)})`);await runFrames(b,60);const t0=Date.now();const run=await runFrames(b,frames);const names=run.stats.stage_names||[];const rr=run.rows.filter(x=>x.gpu_ms);const q=(vv,p)=>{const x=[...vv].sort((a,c)=>a-c);return x.length?+x[Math.floor((x.length-1)*p)].toFixed(3):null;};
   let foreign=null;if(arg('watch')){const t1=Date.now();foreign=0;for(const l of (await readWatch()).split(String.fromCharCode(10))){const [t,...rest]=l.trim().split(' ');if(+t<t0||+t>t1)continue;for(const x of rest){foreign=Math.max(foreign,+x.split(':')[2]);}}}
   const row={round:r,variant:k,settings:v,foreign,gpu:q(rr.map(x=>x.gpu_ms.reduce((a,c)=>a+c,0)),.5),stages:Object.fromEntries(names.map((n,i)=>[n,q(rr.map(x=>x.gpu_ms[i]),.5)]).filter(x=>x[1]>0.02))};rows.push(row);
   console.log(JSON.stringify({round:r,variant:k,foreign,gpu:row.gpu,cull:row.stages.scenery_culling_support,raster:row.stages.scenery_raster,shading:row.stages.scenery_shading,cover:row.stages.ground_cover??row.stages.scenery_atlas_clear}));}
  await writeFile(resolve(dir,'ab.json'),JSON.stringify(rows,null,1));
 }
 for(const view of (arg('ab')?[]:views)){
  if(arg('camera'))await b.evaluate(`solarExplorer.camera=${arg('camera')}`);else await b.evaluate(`solarExplorer.go(${JSON.stringify(view)})`);
  await b.evaluate('solarExplorer.time=0');
  const t0=Date.now();await b.evaluate('window.motionBase=solarExplorer.camera.map(v=>[...v])');const speed=+arg('move',0);
  const run=await runFrames(b,frames,speed?`{const c=motionBase,d=c[1].map((x,j)=>x-c[0][j]);const t=i/60;solarExplorer.camera=c.map((v,k)=>k===2?v:v.map((x,j)=>x+d[j]*t*${speed}));solarExplorer.time=t;}`:'');const s=run.stats;const rows=run.rows.filter(r=>r.gpu_ms);
  const q=(v,p)=>{const x=[...v].sort((a,c)=>a-c);return x.length?+x[Math.floor((x.length-1)*p)].toFixed(3):null;};
  const names=s.stage_names||[];const stage=n=>{const i=names.indexOf(n);return i<0?null:q(rows.map(r=>r.gpu_ms[i]),.5);};
  const all=names.map((n,i)=>[n,q(rows.map(r=>r.gpu_ms[i]),.5)]).filter(x=>x[1]>0.05).sort((x,y)=>y[1]-x[1]);
  report.views[view]={all,scenery:s.scenery,bytes:s.scenery_gpu_bytes,gpu_p50:q(rows.map(r=>r.gpu_ms.reduce((a,c)=>a+c,0)),.5),stages:Object.fromEntries(['scenery_placement','scenery_generation','scenery_atlas','scenery_culling_support','scenery_raster','scenery_shading','scenery_atlas_filter','ground_cover','scenery_atlas_clear','scenery_cover'].map(n=>[n,stage(n)])),pending:s.pending_features,error:await b.evaluate('window.explorerFailure||null')};
  await capture(b,resolve(dir,`${view}.png`),W,H);
  // Contention: other processes' 3D engine use logged by a watcher (--watch FILE, lines 'ms name:pid:pct ...').
  let foreign=null;if(arg('watch')){const t1=Date.now();const lines=(await readWatch()).split(String.fromCharCode(10));foreign=0;for(const l of lines){const [t,...rest]=l.trim().split(' ');if(+t<t0||+t>t1)continue;for(const r of rest){const p=+r.split(':')[2];if(p>foreign)foreign=p;}}report.views[view].foreign_gpu_max_pct=foreign;}
  const sc=s.scenery||{};console.log(view,JSON.stringify({foreign,gpu:report.views[view].gpu_p50,jobs:sc.jobs_done,job:sc.job,variants:sc.variants,leaf:sc.leaf_ready?.filter(Boolean).length,templates:sc.templates,trees:sc.trees,rocks:sc.rocks,draws:sc.class_draws,appended:sc.class_appended,cover:sc.cover,overflow:sc.overflow,support:sc.support_deferred,fp:sc.footprint_rejected,top:all.slice(0,12).map(x=>x[0]+':'+x[1])}));
  await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,1));
 }
}finally{await b.close();}
const events=await readFile(resolve(dir,'browser-events.log'),'utf8').catch(()=>'');
const errors=events.split('\n').filter(l=>/error|invalid|warning/i.test(l)).slice(0,20);if(errors.length)console.log('browser events:\n'+errors.map(l=>l.slice(0,400)).join('\n'));
