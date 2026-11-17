// Keep the camera fixed while advancing the terrain clock at different frame rates.
// Frozen weather isolates publication/fade changes from wind and cloud animation.
import {headless} from './Headless.mjs';
import {ready,capture} from './Explorer-Test-Lib.mjs';
import {toEye,heading} from './Earth-Test-Lib.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const dir=process.argv[2]||'evidence/local/stationary-cover';await mkdir(dir,{recursive:true});
const b=await headless(dir),report={samples:[]};
const frames=async(n,dt)=>b.evaluate(`(async()=>{for(let i=0;i<${n};i++){while(!solarExplorer.step(${dt}))await new Promise(r=>setTimeout(r,0));while(solarExplorer.stats().pending)await new Promise(r=>setTimeout(r,0));}})()`);
const sample=async(label)=>{const s=await b.evaluate('solarExplorer.stats()');const fade=JSON.parse(await b.evaluate('solarExplorer.engine.audit_cover_fade()'));const progress=JSON.parse(await b.evaluate('solarExplorer.engine.audit_progress()'));const r={label,fade,clock:progress.clock,frame:progress.frame,cover:s.scenery.cover,generated:s.scenery.generated};report.samples.push(r);console.log(JSON.stringify(r));return fade;};
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:960,height:540,deviceScaleFactor:1,mobile:false});
 const earth=process.argv.includes('--earth');
 await b.send('Page.navigate',{url:`http://127.0.0.1:5198/?test=1&body=${earth?'earth':'procedural'}&view=${earth?'wupper':'forest'}&quality=high`});await ready(b);
 if(earth){const eye=toEye(7.1284,51.1396,111),d=heading(7.1284,51.1396,270,-.15);await b.evaluate(`solarExplorer.camera=${JSON.stringify([eye,eye.map((x,i)=>x+d[i]*1000)])}`);}
 await b.evaluate('solarExplorer.resize(960,540);solarExplorer.engine.profiling(true);solarExplorer.configure({scenery_wind:0,clouds:false,atmosphere:false,water:false});solarExplorer.time=0;');
 await frames(380,.1); // Include the coarse half-float timestamp range, above 32 seconds.
 const initial=await sample('settled');assert.ok(initial.count>100);
 assert.ok(report.samples[0].cover.draws.reduce((n,v,i)=>n+(i===3?0:v),0)>100,'vegetation must remain present, not only pebbles');
 await capture(b,dir+'/before.png',960,540);
 for(const dt of [1/60,1/120,1/240,0,1/30,.25]){
  for(let k=0;k<4;k++){await frames(20,dt);await sample(`dt=${dt},block=${k}`);}
 }
 await capture(b,dir+'/after.png',960,540);
 const visibility=report.samples.map(s=>s.fade.mean_visibility);
 report.visibility_range=Math.max(...visibility)-Math.min(...visibility);
 report.pass=report.visibility_range<.01&&report.samples.every(s=>s.fade.overflow===0);
 assert.ok(report.pass,`stationary cover visibility changed by ${report.visibility_range}`);
 assert.equal(await b.evaluate('window.explorerFailure'),null);
}catch(e){report.error=String(e);process.exitCode=1;}finally{await writeFile(dir+'/report.json',JSON.stringify(report,null,2));await b.close();}
