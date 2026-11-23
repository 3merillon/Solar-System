// Hold back a measured page, then release it during a slow, level flight.
// The audit reads the actual shared mesh used by terrain, water and prop support.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {headless} from './Headless.mjs';
import {runFrames} from './Explorer-Test-Lib.mjs';
const dir=process.argv[2]||'evidence/local/near-terrain-arrival';
const base=process.argv[3]||'http://127.0.0.1:5198/';
await mkdir(dir,{recursive:true});
const b=await headless(dir);
try{
 await b.send('Page.navigate',{url:new URL('field/chart.js',base).href});
 await b.evaluate(`(async()=>{
  document.body.innerHTML='<canvas width="640" height="360"></canvas>';
  const {createWorkerExplorer}=await import('${base}worker-client.js');
  const engine=await createWorkerExplorer(document.querySelector('canvas'),()=>{},e=>{window.fatal=e},'full','earth');
  await engine.configure(JSON.stringify({...JSON.parse(engine.settings()),clouds:false,water:false,trees:false,rocks:false,buildings:false,shadows:false,atmosphere:false,fetch_limits:false}));
  const height=new Uint8Array(264*264*2),dry=Float32Array.of(-1e6);
  for(let face=0;face<6;face++)await engine.page_arrived(0,face,0,0,0,400,0,1,height,dry);
  // Centre the path inside a level-eight page, clear of its spatial seam.
  const unit=p=>p.map(x=>x/Math.hypot(...p)),u=2*133.5/256-1,v=2*142.5/256-1;
  window.arrive=()=>engine.page_arrived(0,4,8,133,142,412,0,1,height,dry);
  window.framePose=i=>{const n=unit([u+i*.20/6371000,v,1]),eye=n.map(x=>x*(6371000+432));
   return [eye,eye.map((x,j)=>x+[1,-.04,-.18][j]),n];};
  window.solarExplorer={engine,camera:framePose(0),step(dt){return engine.render(this.camera.flat(),dt,0)},stats:()=>JSON.parse(engine.stats()),telemetry:()=>JSON.parse(engine.telemetry())};
 })()`);
 await runFrames(b,250);
 const probe=async()=>JSON.parse(await b.evaluate('solarExplorer.engine.audit_lod()')).probes.slice(0,32);
 const original=await probe();await b.evaluate('arrive()');
 let maxResidual=0,changed=0,firstChanged=null;const frames=[];
 for(let i=0;i<90;i++){
  await runFrames(b,1,'solarExplorer.camera=framePose('+i+');');
  const probes=await probe();
  const residual=Math.max(...probes.map(p=>Math.abs(p[1]-p[2])));
  const shift=Math.max(...probes.map((p,j)=>Math.abs(p[2]-original[j][2])));
  if(shift>6&&firstChanged===null)firstChanged=i;
  maxResidual=Math.max(maxResidual,residual);changed=Math.max(changed,shift);frames.push([i,residual,shift]);
 }
 const progress=JSON.parse(await b.evaluate('solarExplorer.engine.audit_progress()'));
 const result={maxResidual,changed,firstChanged,progress,frames};await writeFile(dir+'/report.json',JSON.stringify(result,null,2));
 console.log({maxResidual,changed,firstChanged,overflow:progress.overflow});
 assert.ok(changed>10,'the new 12 m source measurement must reach the mesh');
 assert.ok(maxResidual<.02,'close vertices slid after publication');
 assert.equal(progress.overflow,0);assert.equal(await b.evaluate('window.fatal||null'),null);
}finally{await b.close();}
