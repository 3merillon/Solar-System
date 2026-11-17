// Headless WebGPU regression: no interior cap outlines, smooth source arrival,
// stable re-publication. Source paths are independent of the shader's capsules.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {headless} from './Headless.mjs';
import {runFrames,capture} from './Explorer-Test-Lib.mjs';
const dir=resolve(process.argv[2]||'evidence/local/road-surface'),W=960,H=720;
const paths=[{width:8,points:[[-35,-55],[-35,-30],[-35,-5],[-20,18],[5,28],[35,28],[50,42]]},
 {width:8,points:[[-55,-5],[-35,-5],[-10,-5],[20,-5],[45,-5]]}];
await mkdir(dir,{recursive:true});const b=await headless(dir),report={browser:b.version,paths,failures:[]};
const half=n=>{const sign=n&32768?-1:1,e=(n>>10)&31,m=n&1023;return sign*(e===0?m*2**-24:e===31?NaN:(1+m/1024)*2**(e-15));};
const colour=(buf,i)=>[0,2,4].map(k=>half(buf.readUInt16LE(i*8+k)));
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
function distances(q){let edge=Infinity,center=Infinity;
 for(const path of paths)for(let i=1;i<path.points.length;i++){
  const a=path.points[i-1],z=path.points[i],d=z.map((v,k)=>v-a[k]),v=q.map((x,k)=>x-a[k]);
  const t=Math.max(0,Math.min(1,dot(v,d)/dot(d,d))),r=Math.hypot(...v.map((x,k)=>x-t*d[k]));
  edge=Math.min(edge,r-path.width*.5);center=Math.min(center,r);
 }return {edge,center};
}
const check=(ok,message)=>{if(!ok)report.failures.push(message);};
try{
 await b.send('Page.navigate',{url:'http://127.0.0.1:5198/field/chart.js'});
 await b.evaluate(`(async()=>{
  document.body.innerHTML='<canvas width="${W}" height="${H}"></canvas>';
  const {createWorkerExplorer}=await import('/worker-client.js'),{buildingSources}=await import('/field/buildings.js');
  const engine=await createWorkerExplorer(document.querySelector('canvas'),()=>{},e=>window.fatal=e,'full','earth');
  await engine.profiling(true);
  await engine.configure(JSON.stringify({...JSON.parse(engine.settings()),clouds:false,trees:false,rocks:false,buildings:true,atmosphere:false,water:false,shadows:false,ground_detail:false,render_scale:1}));
  const lon=7.1284*Math.PI/180,lat=51.1396*Math.PI/180,X=.5+lon/(2*Math.PI),Y=.5-Math.atanh(Math.sin(lat))/(2*Math.PI),metric=2*Math.PI*6371000*Math.cos(lat);
  const up=[Math.cos(lat)*Math.sin(lon),Math.sin(lat),Math.cos(lat)*Math.cos(lon)],east=[Math.cos(lon),0,-Math.sin(lon)],north=[-Math.sin(lat)*Math.sin(lon),Math.cos(lat),-Math.sin(lat)*Math.cos(lon)];
  await engine.configure(JSON.stringify({...JSON.parse(engine.settings()),clouds:false,trees:false,rocks:false,buildings:true,atmosphere:false,water:false,shadows:false,ground_detail:false,render_scale:1,sun:up}));
  const z=14,tx=Math.floor(X*2**z),ty=Math.floor(Y*2**z),point=([x,y])=>[((X+x/metric)*2**z-tx)*4096,((Y-y/metric)*2**z-ty)*4096];
  const features=${JSON.stringify(paths)}.map((p,i)=>({id:i,properties:{class:'secondary',width:p.width},paths:[p.points.map(point)]}));
  const make=features=>buildingSources([{z,x:tx,y:ty,layers:{transportation:{extent:4096,features}}}]);
  window.roads=make(features);window.reordered=make([...features].reverse());
  window.upload=async data=>engine.building_sources(new Uint8Array(data.records),new Uint8Array(data.points));
  const height=new Uint8Array(264*264*2),albedo=new Uint8Array(264*264*4);for(let i=0;i<albedo.length;i+=4)albedo.set([66,105,45,255],i);
  for(let face=0;face<6;face++)await engine.page_arrived(0,face,0,0,0,400,0,1,height,Float32Array.of(-1e6));
  window.supply=async()=>{const s=await engine.page_commands();if(s)for(const p of JSON.parse(s).pages)await engine.page_arrived(p.channel,p.face,p.level,p.x,p.y,400,0,1,p.channel===0?height:albedo,Float32Array.of(-1e6));};
  const eye=up.map(v=>v*(6371000+510)),look=up.map(v=>v*(6371000+400));window.roadFrame={eye,up,east,north};
  window.solarExplorer={engine,camera:[eye,look,north],step(dt){return engine.render(this.camera.flat(),dt,0)},stats:()=>JSON.parse(engine.stats()),telemetry:()=>JSON.parse(engine.telemetry()),capture:k=>engine.capture(k)};
 })()`);
 for(let i=0;i<600;i++){await b.evaluate('supply()');await runFrames(b,1);if(i>90&&!(await b.evaluate('solarExplorer.stats().pending_features')).length)break;await new Promise(r=>setTimeout(r,50));}
 for(let i=0;i<60;i++){await b.evaluate('supply()');await runFrames(b,10);}
 const base=await capture(b,resolve(dir,'before.bin'),W,H,'shaded');
 const positions=await capture(b,resolve(dir,'positions.bin'),W,H,'position');
 const frame=await b.evaluate('roadFrame');
 const progress=JSON.parse(await b.evaluate('solarExplorer.engine.audit_progress()'));
 await b.evaluate('upload(roads)');
 const stages=[];let last=0;
 for(const at of [1,12,24,48]){
  await runFrames(b,at-last);last=at;
  stages.push(await capture(b,resolve(dir,`arrival-${at}.bin`),W,H,'shaded'));
  await capture(b,resolve(dir,`arrival-${at}.png`),W,H);
 }
 const final=stages.at(-1);let interior=0,brightInterior=0;const fractions=stages.map(()=>({sum:0,count:0}));
 for(let i=0;i<W*H;i++){
  const p=[0,4,8].map(k=>positions.readFloatLE(i*16+k));if(Math.hypot(...p)===0)continue;
  const world=p.map((v,k)=>v+frame.eye[k]-frame.up[k]*6371000),q=[dot(world,frame.east),dot(world,frame.north)];
  const {edge,center}=distances(q);if(edge> -1.0||center<.8)continue;
  interior++;const c=colour(final,i);if(Math.max(...c)>.45)brightInterior++;
  const start=colour(base,i),delta=c.map((v,k)=>v-start[k]),length=dot(delta,delta);if(length<.001)continue;
  stages.forEach((s,j)=>{fractions[j].sum+=dot(colour(s,i).map((v,k)=>v-start[k]),delta)/length;fractions[j].count++;});
 }
 report.interior={pixels:interior,brightPixels:brightInterior,fraction:brightInterior/Math.max(1,interior)};
 report.arrival=fractions.map((v,i)=>({frame:[1,12,24,48][i],pixels:v.count,fraction:v.sum/Math.max(1,v.count)}));
 check(interior>500,'road interior must be visible');
 check(brightInterior/interior<.002,'interior segment caps must not paint bright circular lines');
 check(report.arrival[0].fraction<.02,'roads must start nearly transparent');
 check(report.arrival[1].fraction>.05&&report.arrival[1].fraction<.4,'roads must fade through intermediate coverage');
 check(report.arrival[2].fraction>report.arrival[1].fraction+.15&&report.arrival[2].fraction<.85,'fade must progress continuously');
 await b.evaluate('upload(reordered)');await runFrames(b,1);
 const reordered=await capture(b,resolve(dir,'reordered.bin'),W,H,'shaded');let error=0,nonfinite=0;
 for(let i=0;i<W*H;i++){const a=colour(final,i),c=colour(reordered,i);for(let k=0;k<3;k++){if(!Number.isFinite(c[k]))nonfinite++;else error+=Math.abs(a[k]-c[k]);}}
 report.republication={meanChannelDelta:error/(W*H*3),nonfinite};
 check(nonfinite===0&&report.republication.meanChannelDelta<.0001,'source reorder must preserve completed arrival and appearance');
 const after=JSON.parse(await b.evaluate('solarExplorer.engine.audit_progress()'));
 report.terrain={before:progress,after};check(after.epochs>=progress.epochs,'road updates must preserve terrain refinement');
 report.fatal=await b.evaluate('window.fatal');check(!report.fatal,'renderer must not fail');
 report.pass=report.failures.length===0;console.log(JSON.stringify({interior:report.interior,arrival:report.arrival,republication:report.republication,failures:report.failures},null,2));
 assert.deepEqual(report.failures,[]);
}finally{await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,2));await b.close();}
