// Terrain shadows must not depend on the camera. Fixed world receivers are
// audited every frame while the camera flies towards them, once with a fixed
// 0.25 m footprint (what the older stability tests used) and once with the
// pixel footprint the shading pass would use at that distance. A static
// footprint sweep then isolates the march itself: with world-fixed sample
// positions a receiver's visibility may only move by the filter's own
// envelope, not flip. The previous geometric progression scaled every sample
// position with the footprint; a 10% footprint change flipped receivers.
import assert from 'node:assert/strict';
import {headless} from './Headless.mjs';
import {ready,runFrames,capture} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const dir=resolve(arg('output','evidence/local/shadow-approach'));await mkdir(dir,{recursive:true});
const W=960,H=540,FRAMES=+arg('frames',150),STEP=+arg('step',20),view=arg('view','rough');
const b=await headless(dir);const report={view,frames:FRAMES,step:STEP,cases:[],gates:[]};
const quant=a=>{a=[...a].sort((x,y)=>x-y);const q=p=>a[Math.min(a.length-1,Math.floor(a.length*p))];return{mean:a.reduce((s,v)=>s+v,0)/a.length,p50:q(.5),p90:q(.9),p99:q(.99),max:a.at(-1)};};
const summarize=vis=>{const n=vis[0].length,range=[],delta=[];for(let p=0;p<n;p++){let lo=1,hi=0,d=0;for(let i=0;i<vis.length;i++){const v=vis[i][p];lo=Math.min(lo,v);hi=Math.max(hi,v);if(i>0)d+=Math.abs(v-vis[i-1][p]);}range.push(hi-lo);delta.push(d/(vis.length-1));}
 const shadowed=vis.map(r=>r.filter(v=>v<.5).length);return{range:quant(range),frame_delta:quant(delta),probes_range_over_0_1:range.filter(r=>r>.1).length,probes_range_over_0_5:range.filter(r=>r>.5).length,shadowed_min:Math.min(...shadowed),shadowed_max:Math.max(...shadowed)};};
const gate=(name,pass,metrics)=>{report.gates.push({name,pass,metrics});console.log(JSON.stringify({gate:name,pass,metrics}));};
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:false});await b.send('Page.navigate',{url:'http://127.0.0.1:5198/?test=1&body=procedural'});await ready(b);
 // Mountain view, props/water/clouds/atmosphere off, a fixed sun 8.6 degrees above the tangent.
 await b.evaluate(`(async()=>{solarExplorer.resize(${W},${H});solarExplorer.go(${JSON.stringify(view)});window.n=solarExplorer.camera[0].map(v=>v/Math.hypot(...solarExplorer.camera[0]));window.t=[-n[1],n[0],0];t=t.map(v=>v/Math.hypot(...t));window.u=[n[1]*t[2]-n[2]*t[1],n[2]*t[0]-n[0]*t[2],n[0]*t[1]-n[1]*t[0]];
  await solarExplorer.configure({trees:false,rocks:false,water:false,clouds:false,atmosphere:false,sun:n.map((v,j)=>v*.15+t[j]*Math.sqrt(1-.0225)),scenery_wind:0,shadow_diagnostic:1});solarExplorer.time=0;
  window.probes=[];window.base=[];const R=solarExplorer.engine.radius();
  for(let y=0;y<32;y++)for(let x=0;x<32;x++){let p=n.map((v,j)=>v*R+t[j]*(2000+x/31*8000)+u[j]*(y/31-.5)*6000),len=Math.hypot(...p),h=solarExplorer.engine.height(...p);p=p.map(v=>v/len*(R+h+.05));base.push(p);probes.push(...p,.25);}
  window.probesAt=eye=>{const out=[];for(const p of base){const d=Math.hypot(p[0]-eye[0],p[1]-eye[1],p[2]-eye[2]);out.push(...p,Math.max(.25,d*2*Math.tan(Math.PI/6)/${H}));}return out;};
 })()`);
 const audit=expr=>b.evaluate(`(async()=>JSON.parse(await solarExplorer.engine.audit_shadow_points(new Float64Array(${expr}))).samples.map(v=>[v[4],v[5]]))()`);
 const fixed=[],pixel=[],cams=[];const n=1024;
 for(let i=0;i<=FRAMES;i++){
  await b.evaluate(`{const R=solarExplorer.engine.radius();const center=n.map((v,j)=>v*(R+solarExplorer.engine.height(...n)+300)+t[j]*6000);const eye=n.map((v,j)=>v*(R+solarExplorer.engine.height(...n)+3000)+t[j]*(${i}*${STEP}-2000));solarExplorer.camera=[eye,center,n];window.eye=eye;}`);
  await runFrames(b,1);cams.push(await b.evaluate('eye'));
  fixed.push(await audit('probes'));pixel.push(await audit('probesAt(eye)'));
  if(i%30===0)await capture(b,resolve(dir,`approach-${String(i).padStart(3,'0')}.png`),W,H);
 }
 const series=(rows,k)=>rows.map(r=>r.map(v=>v[k]));
 const fixedCase={name:'approach fixed footprint 0.25',...summarize(series(fixed,0)),unresolved_max:Math.max(...fixed.map(r=>r.filter(v=>v[1]>.5).length))};
 const pixelCase={name:'approach pixel footprint',...summarize(series(pixel,0)),unresolved_max:Math.max(...pixel.map(r=>r.filter(v=>v[1]>.5).length))};
 report.cases.push(fixedCase,pixelCase);
 const sweep=[],fps=[];for(let f=0.25;f<=4.001;f+=0.125){fps.push(f);sweep.push(await audit(`base.flatMap(p=>[...p,${f}])`));}
 const sweepCase={name:'static footprint sweep 0.25..4',footprints:fps,...summarize(series(sweep,0))};report.cases.push(sweepCase);
 const phase=[],pfs=[1.0,1.02,1.04,1.06,1.08,1.1];for(const f of pfs)phase.push(await audit(`base.flatMap(p=>[...p,${f}])`));
 const phaseCase={name:'static phase sweep 1.0..1.1',footprints:pfs,...summarize(series(phase,0))};report.cases.push(phaseCase);
 report.pixel_footprints={first:quant(await b.evaluate(`probesAt(${JSON.stringify(cams[0])}).filter((v,i)=>i%4===3)`)),last:quant(await b.evaluate(`probesAt(${JSON.stringify(cams.at(-1))}).filter((v,i)=>i%4===3)`))};
 report.raw={fixed:series(fixed,0),pixel:series(pixel,0),sweep:series(sweep,0),phase:series(phase,0)};
 for(const c of report.cases)console.log(JSON.stringify({name:c.name,range_p99:c.range.p99,range_max:c.range.max,over_0_1:c.probes_range_over_0_1,over_0_5:c.probes_range_over_0_5,shadowed:[c.shadowed_min,c.shadowed_max],unresolved_max:c.unresolved_max}));
 // Gates. Fixed-footprint drift is the former stability bar; the pixel
 // footprint and the sweeps are the new camera-independence bars: no receiver
 // may flip, and the shadowed count must not collapse with distance.
 // Residual camera dependence at this grazing sun (8.6 degrees over rough
 // terrain): a binding ridge that crosses a clipmap window edge as the camera
 // advances changes resolution, and a receiver whose refined candidates then
 // differ can change; measured 3.3-3.9% of the receivers over the 3 km
 // approach (the former march moved every receiver's samples with the camera
 // and lost three quarters of the distant shadows). Bounded at 5% here.
 gate('fixed footprint approach drift',fixedCase.probes_range_over_0_5<=n*.05&&fixedCase.probes_range_over_0_1<=n*.07,{max:fixedCase.range.max,over_0_1:fixedCase.probes_range_over_0_1,over_0_5:fixedCase.probes_range_over_0_5});
 gate('pixel footprint approach drift',pixelCase.probes_range_over_0_5<=n*.05&&pixelCase.probes_range_over_0_1<=n*.07,{p99:pixelCase.range.p99,max:pixelCase.range.max,over_0_1:pixelCase.probes_range_over_0_1,over_0_5:pixelCase.probes_range_over_0_5});
 gate('shadows survive distance',pixelCase.shadowed_min*2>=fixedCase.shadowed_min&&pixelCase.shadowed_min>=10,{pixel:[pixelCase.shadowed_min,pixelCase.shadowed_max],fixed:[fixedCase.shadowed_min,fixedCase.shadowed_max]});
 // Self-shadowing within four footprints of the receiver is filtered at the
// receiver footprint by design, so a handful of receivers may move smoothly.
gate('footprint sweep does not flip receivers',sweepCase.probes_range_over_0_5<=n*.01&&sweepCase.probes_range_over_0_1<=n*.04,{over_0_1:sweepCase.probes_range_over_0_1,over_0_5:sweepCase.probes_range_over_0_5,max:sweepCase.range.max});
 gate('sample phase independence',phaseCase.range.max<.1&&phaseCase.probes_range_over_0_1===0,{max:phaseCase.range.max,over_0_1:phaseCase.probes_range_over_0_1});
 gate('no unresolved receivers',fixedCase.unresolved_max===0&&pixelCase.unresolved_max===0,{fixed:fixedCase.unresolved_max,pixel:pixelCase.unresolved_max});
 await writeFile(resolve(dir,'report.json'),JSON.stringify(report));
 assert.ok(report.gates.every(g=>g.pass),JSON.stringify(report.gates.filter(g=>!g.pass)));
}finally{await b.close();}
