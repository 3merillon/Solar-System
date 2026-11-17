// Terrain shadows seen from far away. From the orbit bookmark (9000 km up,
// sun 67 degrees high at the sub-point) the land must be lit apart from
// isolated steep slopes, every probe must resolve, and the result must not
// depend on the camera altitude. (Until 15 November the third gate checked the
// coarse horizon maps' binding distances; the horizon maps were replaced by
// the exact cached march, see SUN-SHADOWS.md.) The first horizon-map build failed all three: the pencil
// sweep ran half of every line backwards whenever the sun's vanishing point
// lay inside a coarse window, and candidate refinement then sampled the
// canonical field half a metre from receivers 9000 km away, where
// camera-relative f32 positions resolve one metre, so a third of the land
// came out as per-pixel shadow noise with window-shaped clean blocks.
import assert from 'node:assert/strict';
import {headless} from './Headless.mjs';
import {ready,runFrames,capture} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const dir=resolve(arg('output','evidence/local/shadow-orbit'));await mkdir(dir,{recursive:true});
const W=960,H=540;
const b=await headless(dir);const report={cases:[],gates:[]};
const gate=(name,pass,metrics)=>{report.gates.push({name,pass,metrics});console.log(JSON.stringify({gate:name,pass,metrics}));};
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:false});await b.send('Page.navigate',{url:'http://127.0.0.1:5198/?test=1&body=procedural'});await ready(b);
 await b.evaluate(`(async()=>{solarExplorer.resize(${W},${H});solarExplorer.go('orbit');solarExplorer.time=0;
  await solarExplorer.configure({clouds:false,trees:false,rocks:false,shadow_diagnostic:1});
  window.n=solarExplorer.camera[0].map(v=>v/Math.hypot(...solarExplorer.camera[0]));window.t=[-n[1],n[0],0];t=t.map(v=>v/Math.hypot(...t));window.u=[n[1]*t[2]-n[2]*t[1],n[2]*t[0]-n[0]*t[2],n[0]*t[1]-n[1]*t[0]];
  // Receivers on the surface at an arc distance from the sub-point along t, spread 400 km across u.
  window.probesAt=(dist,count,fp)=>{const out=[];const R=solarExplorer.engine.radius();for(let i=0;i<count;i++){const a=dist/R,c=(i/(count-1)-.5)*400000/R;let p=n.map((v,j)=>v*Math.cos(a)*Math.cos(c)+t[j]*Math.sin(a)*Math.cos(c)+u[j]*Math.sin(c));const h=solarExplorer.engine.height(...p);p=p.map(v=>v*(R+h+.05));out.push(...p,fp);}return out;};
  // Pixel footprint at the sub-point (19 km at 540p from 9000 km), capped at
  // the audit's 10 km probe limit; the sample floor makes both equivalent.
  window.pixelFootprint=()=>{const e=solarExplorer.camera[0];const R=solarExplorer.engine.radius();return Math.min(10000,(Math.hypot(...e)-R)*2*Math.tan(Math.PI/6)/${H});};
 })()`);
 await runFrames(b,40);
 await capture(b,resolve(dir,'orbit-solid.png'),W,H);
 const audit=expr=>b.evaluate(`(async()=>JSON.parse(await solarExplorer.engine.audit_shadow_points(new Float64Array(${expr}))).samples)()`);
 // Screen: every terrain pixel of the disc.
 const screen=JSON.parse(await b.evaluate('solarExplorer.engine.audit_shadows()')).samples.filter(r=>r[0]<64*1000&&(r[4]!==0||r[5]!==0||r[6]!==0)&&r[3]>=-100);
 const dark=screen.filter(r=>r[8]<.5).length,unresolved=screen.filter(r=>r[9]>.5).length;
 report.screen={terrain_pixels:screen.length,shadowed:dark,unresolved};
 // The limb beyond the eye's face chart (about 5% of the disc) has no cached
 // level and stays unresolved by design.
 gate('screen land lit',screen.length>500&&dark<=screen.length*0.005&&unresolved<=screen.length*0.1,report.screen);
 // World receivers: fixed 0.25 m footprint estimated from the cache, the
 // same footprint with the shading pass's start hint, and the pixel footprint
 // with the hint (what the frame actually renders).
 const fp=await b.evaluate('pixelFootprint()');
 let shadowed=0,partial=0,total=0,probed=0,open=0;const first={};
 for(const dist of [0,1e6,2e6,3e6]){
  for(const f of [0.25,-0.25,-fp]){
   const rows=await audit(`probesAt(${dist},128,${f})`);total+=rows.length;
   const s=rows.filter(r=>r[4]<.5).length,p=rows.filter(r=>r[4]>=.5&&r[4]<.999).length;shadowed+=s;partial+=p;
   for(const r of rows){probed++;if(r[5]>0.5)open++;}
   if(f===-fp)first[dist]=rows.map(r=>r[4]);
   report.cases.push({dist,footprint:f,shadowed:s,partial:p,unresolved:rows.filter(r=>r[5]>.5).length,work_max:Math.max(...rows.map(r=>r[19]))});
   console.log(JSON.stringify(report.cases.at(-1)));
  }
 }
 gate('world receivers lit',shadowed<=total*0.01&&partial<=total*0.05,{total,shadowed,partial});
 gate('world receivers resolved',open<=probed*0.01,{receivers:probed,unresolved:open});
 // Altitude change: 9000 km to 7000 km moves every window and footprint; the
 // same receivers must keep their result.
 await b.evaluate(`(()=>{const c=solarExplorer.camera;const R=solarExplorer.engine.radius();const s=(R+7e6)/Math.hypot(...c[0]);solarExplorer.camera=[c[0].map(v=>v*s),c[1].map(v=>v*s)];})()`);
 await runFrames(b,20);
 const fp2=await b.evaluate('pixelFootprint()');let flips=0,compared=0;
 for(const dist of [0,1e6,2e6,3e6]){const rows=await audit(`probesAt(${dist},128,${-fp2})`);rows.forEach((r,i)=>{compared++;if(Math.abs(r[4]-first[dist][i])>.5)flips++;});}
 gate('altitude change keeps results',flips<=compared*0.01,{compared,flips,footprint_before:fp,footprint_after:fp2});
 await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,1));
 assert.ok(report.gates.every(g=>g.pass),'orbit shadow gates failed: '+report.gates.filter(g=>!g.pass).map(g=>g.name).join(', '));
 console.log('shadow orbit test passed');
}finally{await b.close();}
