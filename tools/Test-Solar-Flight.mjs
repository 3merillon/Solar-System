// The whole flight, from recorded data: leave a surface, fly to another body, land, under a clock rate. Private headless
// browser. Earth's tiles replay; other bodies read their packs from disk. Frame times mean little unless the machine is quiet,
// and this prints whether anything else was using the GPU only if it was told so with --quiet.
//   node tools/Test-Solar-Flight.mjs DIR [--to 499] [--rate 3600] [--frames 60000]
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tileServer,headless,ready} from './Earth-Test-Lib.mjs';
import {capture} from './Explorer-Test-Lib.mjs';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const dir=process.argv[2]||'evidence/local/real-earth/runs/solar-flight';mkdirSync(dir,{recursive:true});
const TO=+arg('to',499),RATE=+arg('rate',3600),FRAMES=+arg('frames',60000),QUIET=process.argv.includes('--quiet');
const server=await tileServer({port:5201,web:'web'});
const b=await headless(resolve(dir,'.profile'));
const W=1280,H=720,T=852076800;
await b.send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:false});
await b.send('Page.navigate',{url:`${server.base}/explorer.html?test=1&body=solar&tiles=${encodeURIComponent(server.base)}&quality=high&tdb=${T}&at=399&height=2000`});
await ready(b);
await b.evaluate(`solarExplorer.resize(${W},${H})`);
// Runs inside the page, frame by frame, keeping what the brief asks be exposed. Stopped by frames, not by time.
const run=`(async()=>{
 const F=solarFlight.flight,K=new Set(),log=[],events=[],times=[];let last=F.report(),wanted=0,shown=false;
 F.set_rate(${RATE});F.fly_to(${TO},SolarStop);
 window.flightLog={log,events,times};
 const take=async(frames,done)=>{for(let i=0;i<frames;i++){
  const t0=performance.now();
  solarExplorer.camera=solarFlight.frame(1/60,K,100);
  while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));
  const s=solarExplorer.stats(),r=F.report(),ms=performance.now()-t0;times.push(ms);
  const frame=r[0];
  if(frame!==last[0])events.push({at:times.length,type:'frame',from:last[0],to:frame,speed:r[4],prior_speed:last[4]});
  if(!!s.solar?.surface_shown!==shown){shown=!!s.solar?.surface_shown;events.push({at:times.length,type:'surface',shown,body:s.body,ms});}
  if(s.body!==wanted){events.push({at:times.length,type:'body',body:s.body,ms});wanted=s.body;}
  last=r;
  if(i%60===0)log.push({frame:times.length,in:r[0],near:r[1],clear:r[2],relative:r[3],lag:s.data_lag?.pages_in_flight,up:s.solar?.uploaded_since_switch,failed:s.data_lag?.pages_failed,deferred:s.data_lag?.upload_deferred_frames,device:s.device_lost});
  if(done&&done(r))return i;
 }return frames;};
 const n=await take(${FRAMES},r=>r[0]===${TO}&&r[2]<SolarStop*1.6&&r[3]<800);
 const arrived=F.report();
 // Now down onto it under thrust, at the same clock rate.
 F.fly_to(0,0);
 const P=solarFlight;const land=async()=>{K.add('KeyS');K.delete('KeyS');};
 await land();
 return {arrivedAfter:n,arrived:[...arrived],events:events.length};
})()`.replace(/SolarStop/g,`${TO===10?2e9:500e3}`);
const out=await b.evaluate(run);
await capture(b,join(dir,'arrived.png'),W,H);
// The descent: the autopilot with no stop height, at the same clock rate. The same thrust a pilot has.
const descent=await b.evaluate(`(async()=>{const F=solarFlight.flight,K=new Set(),{log,events,times}=window.flightLog;F.fly_to(${TO},0);
 let r=null;for(let i=0;i<30000;i++){const t0=performance.now();solarExplorer.camera=solarFlight.frame(1/60,K,100);while(!solarExplorer.step(1/60))await new Promise(s=>setTimeout(s,0));times.push(performance.now()-t0);r=F.report();if(i%60===0)log.push({frame:times.length,in:r[0],near:r[1],clear:r[2],relative:r[3]});if(r[8]||F.flying_to()===0)break;}
 for(let i=0;i<120;i++){solarExplorer.camera=solarFlight.frame(1/60,K,100);while(!solarExplorer.step(1/60))await new Promise(s=>setTimeout(s,0));}
 const held=[...F.report()];return {report:[...r],held,frames:times.length};})()`);
await capture(b,join(dir,'landed.png'),W,H);
const data=await b.evaluate(`({events:window.flightLog.events,times:window.flightLog.times,log:window.flightLog.log,stats:solarExplorer.stats()})`);
const worst=data.times.map((ms,i)=>({frame:i+1,ms:+ms.toFixed(1)})).sort((a,c)=>c.ms-a.ms).slice(0,6);
const sorted=[...data.times].sort((a,c)=>a-c),q=p=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))];
const result={to:TO,rate:RATE,quiet:QUIET,arrivedAfterFrames:out.arrivedAfter,arrived:out.arrived,descent,frames:sorted.length,ms:{p50:q(.5),p95:q(.95),p99:q(.99),max:sorted.at(-1)},worst,events:data.events,lag:data.stats.data_lag,solar:data.stats.solar,lost:data.stats.device_lost,sample:data.log.filter((_,i)=>i%40===0)};
writeFileSync(join(dir,'result.json'),JSON.stringify(result,null,1));
console.log(JSON.stringify({to:TO,rate:RATE,quiet:QUIET,arrivedAfterFrames:out.arrivedAfter,descent:descent.report.slice(0,4),held:descent.held.slice(0,4),frames:result.frames,ms:result.ms,worst,events:result.events.slice(0,24),failed:result.lag?.pages_failed,lost:result.lost},null,0));
process.exit(0);
