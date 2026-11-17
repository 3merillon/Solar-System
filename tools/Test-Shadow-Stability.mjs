// Identical world receivers, translated camera, frozen sun/weather/wind.
// Reports each overlapping cascade separately so blend weights cannot hide drift.
import assert from 'node:assert/strict';
import {headless} from './Headless.mjs';
import {ready,runFrames,capture} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const dir=resolve(process.argv[2]||'evidence/local/shadow-stability'),W=960,H=540;
const sunMotion=process.argv.includes('--sun-motion');
await mkdir(dir,{recursive:true});const b=await headless(dir),report={cases:[]};
const audit=()=>b.evaluate('(async()=>JSON.parse(await solarExplorer.engine.audit_shadow_points(new Float64Array(window.probes))))()');
const summary=d=>{d.sort((a,b)=>a-b);return{count:d.length,mean:d.reduce((a,b)=>a+b,0)/Math.max(1,d.length),p99:d[Math.floor(d.length*.99)]||0,max:d.at(-1)||0,changed:d.filter(v=>v>.05).length};};
const dot=(a,b)=>a.reduce((s,v,j)=>s+v*b[j],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const overlap=(i,level,eye)=>{
 const {extents,right,sun}=report.baseline.layout,up=cross(sun,right),point=report.points.slice(i*4,i*4+3);
 return [report.camera[0],eye].every(e=>{const q=point.map((v,j)=>v-e[j]);return Math.max(Math.abs(dot(q,right)),Math.abs(dot(q,up)))<extents[level]*.92;});
};
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:false});await b.send('Page.navigate',{url:'http://127.0.0.1:5198/?test=1&body=procedural'});await ready(b);
 await b.evaluate(`solarExplorer.resize(${W},${H});solarExplorer.go('forest');solarExplorer.configure({clouds:false,scenery_wind:0,cloud_speed:0,cloud_evolution:0});solarExplorer.time=0;window.c=solarExplorer.camera.map(v=>[...v]);window.n=c[0].map(v=>v/Math.hypot(...c[0]));window.t=[-n[1],n[0],0];t=t.map(v=>v/Math.hypot(...t));window.u=[n[1]*t[2]-n[2]*t[1],n[2]*t[0]-n[0]*t[2],n[0]*t[1]-n[1]*t[0]];`);
 await runFrames(b,240);
 // A low camera over an admitted tree gives near and far maps actual foliage.
 report.object=await b.evaluate(`(async()=>{const a=JSON.parse(await solarExplorer.engine.audit_scenery());return a.objects.filter(o=>o.kind===1&&o.shape[0]>5).sort((a,b)=>Math.hypot(...a.hi.map((v,j)=>v+a.lo[j]-c[0][j]))-Math.hypot(...b.hi.map((v,j)=>v+b.lo[j]-c[0][j])))[0];})()`);
 assert.ok(report.object);
 await b.evaluate(`{const o=${JSON.stringify(report.object)};const root=o.hi.map((v,j)=>v+o.lo[j]);const eye=root.map((v,j)=>v+n[j]*8+t[j]*10);solarExplorer.camera=[eye,root,n];window.c=solarExplorer.camera.map(v=>[...v]);window.probes=[];for(const span of [8,32,96,384])for(let y=0;y<32;y++)for(let x=0;x<32;x++){let p=root.map((v,j)=>v+t[j]*(x/31-.5)*span*2+u[j]*(y/31-.5)*span*2);let len=Math.hypot(...p);let h=solarExplorer.engine.height(...p);p=p.map(v=>v/len*(solarExplorer.engine.radius()+h+.03));probes.push(...p,.1);}}`);
 await runFrames(b,180);report.camera=await b.evaluate('c');report.settings=await b.evaluate('solarExplorer.snapshot().settings');report.points=await b.evaluate('probes');report.baseline=await audit();await capture(b,resolve(dir,'baseline.png'),W,H);
 for(const d of sunMotion?[0,1/60,2/60,3/60,4/60,5/60,0]:[0,.01,.1,1,6,12,24,0]){
  if(sunMotion){const a=d*2*Math.PI/86164,[x,y,z]=report.settings.sun;await b.evaluate(`solarExplorer.configure({sun:${JSON.stringify([x*Math.cos(a)+z*Math.sin(a),y,z*Math.cos(a)-x*Math.sin(a)])}})`);}
  else await b.evaluate(`solarExplorer.camera=[c[0].map((v,j)=>v+t[j]*${d}),c[1].map((v,j)=>v+t[j]*${d}),c[2]]`);await runFrames(b,3);const a=await audit();
  const eye=await b.evaluate('solarExplorer.camera[0]');
  const diff=Object.fromEntries([4,6,8,9,10,11,12,13].map(k=>[k,summary(a.samples.flatMap((v,i)=>k<8||overlap(i,k-8,eye)?[Math.abs(v[k]-report.baseline.samples[i][k])]:[]))]));
  report.cases.push({translation:d,diff,samples:a.samples});console.log(JSON.stringify({translation:d,diff}));await capture(b,resolve(dir,`move-${report.cases.length}.png`),W,H);
 }
 report.stats=await b.evaluate('solarExplorer.stats()');
 report.gates=report.cases.map(c=>({translation:c.translation,pass:[8,9,10,11,12,13].every(k=>c.diff[k].mean<.002&&c.diff[k].p99<.02)}));
 await writeFile(resolve(dir,'report.json'),JSON.stringify(report));
 assert.ok(report.cases.every(c=>c.samples.every(v=>v.every(Number.isFinite))));
 assert.ok(report.gates.every(g=>g.pass),JSON.stringify(report.gates));
}finally{await b.close();}
