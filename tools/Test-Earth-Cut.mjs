// M1 gate: after a camera cut, how quickly does each pixel come within one level of its final
// level? Real time through the replay server, at a stated link. Reads diagnostic view 5, which
// holds served height and imagery levels per pixel, and compares it with the settled frame. The
// comparison runs inside the page: moving captures over the debug link stalled rendering.
import {tileServer,earthBrowser,settle} from './Earth-Test-Lib.mjs';
import {capture} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const dir=resolve(arg('output','evidence/local/real-earth/runs/cut'));await mkdir(dir,{recursive:true});
const W=+arg('width',1920),H=+arg('height',1080),bandwidth=+arg('bandwidth',100),latency=+arg('latency',40),view=arg('view','lausanne'),from=arg('from','earth-orbit');
const marks=arg('marks','0.25,0.5,0.75,1,1.5,2,3,4,5,7,10').split(',').map(Number);
const server=await tileServer({bandwidth,latency,requestLog:true});
const report={view,from,bandwidth,latency,width:W,height:H,marks:[],gates:{}};
let b;
try{
 b=await earthBrowser(dir,server,{view:from,width:W,height:H,quality:arg('quality','high'),limits:!process.argv.includes('--no-limits')});
 await b.evaluate(`solarExplorer.configure(${arg('settings','{"clouds":false,"debug":5}')})`);
 report.before=await settle(b,{maxFrames:6000});
 await server.reset();
 const run=await b.evaluate(`(async()=>{
  const channels=async()=>{const raw=await solarExplorer.capture('shaded');const v=new Uint16Array(raw.buffer,raw.byteOffset,raw.byteLength>>1),n=v.length>>2,c=new Uint16Array(2*n);for(let i=0;i<n;i++){c[2*i]=v[4*i];c[2*i+1]=v[4*i+1];}return c;};
  const shots=[],marks=${JSON.stringify(marks)};
  const start=performance.now();solarExplorer.go(${JSON.stringify(view)});
  let frames=0,longest=0,last=start;const intervals=[];
  for(const mark of marks){
   const end=start+mark*1000;
   while(performance.now()<end){await new Promise(requestAnimationFrame);if(solarExplorer.step(1/60)){const now=performance.now();intervals.push(now-last);longest=Math.max(longest,now-last);last=now;frames++;}}
   const t=(performance.now()-start)/1000,s=solarExplorer.stats(),levels=await channels();
   shots.push({mark,t,frames,captureMs:(performance.now()-start)/1000-t,uploaded:s.data_lag.pages_uploaded,inFlight:s.data_lag.pages_in_flight,queued:s.data_lag.pages_queued,field:s.field,levels});last=performance.now();
  }
  window.cutShots=shots;window.cutChannels=channels;
  return {frames,longest,intervals};
 })()`);
 report.frames=run.frames;report.longest_interval_ms=run.longest;report.intervals=run.intervals;
 // In stretches, each within the harness's time limit for one call: with the budgets on, pages nothing on screen reads trickle in for minutes.
 const settleStart=Date.now();for(let k=0;k<200;k++){report.settled=await settle(b,{maxFrames:300});if(report.settled.quiet>=45)break;}report.settled_seconds=(Date.now()-settleStart)/1000;
 await capture(b,resolve(dir,'final-debug.png'),W,H);
 const rows=await b.evaluate(`(async()=>{
  const half=v=>{const e=(v>>10)&31,m=v&1023;return e===0?m*2**-24:(1+m/1024)*2**(e-15);};
  const final=await cutChannels();
  return cutShots.map(s=>{let surface=0,height=0,albedo=0,both=0,exact=0,sharpH=0,sharpA=0;const late=[],lateAlbedo={},lateHeight={},allAlbedo={};
   for(let i=0;i<final.length;i+=2){const fh=half(final[i]),fa=half(final[i+1]);if(!(fh>0||fa>0))continue;surface++;
    const h=half(s.levels[i]),a=half(s.levels[i+1]),hh=h>=fh-1,aa=a>=fa-1;allAlbedo[fa]=(allAlbedo[fa]||0)+1;if(hh)height++;else lateHeight[fh]=(lateHeight[fh]||0)+1;if(aa)albedo++;else{const k=fa+'<'+a;lateAlbedo[k]=(lateAlbedo[k]||0)+1;}if(hh&&aa)both++;else if(late.length<4000)late.push([i>>1,h,a,fh,fa]);if(h>=fh&&a>=fa)exact++;}
   return {mark:s.mark,t:s.t,frames:s.frames,captureMs:s.captureMs*1000,uploaded:s.uploaded,inFlight:s.inFlight,queued:s.queued,bytesPerSecond:s.field?.bytesPerSecond,resampleMs:s.field?.resampleMsMean,poolBusy:s.field?.poolBusy,poolQueued:s.field?.poolQueued,fetchInFlight:s.field?.inFlight,fetchQueued:s.field?.queued,completed:s.field?.completed,waterMs:s.field?.waterMs,waterTiles:s.field?.waterTiles,bytes:s.field?.bytes,surface,height:height/surface,albedo:albedo/surface,both:both/surface,exact:exact/surface,late,lateAlbedo,lateHeight,allAlbedo};});
 })()`);
 report.late=Object.fromEntries(rows.map(r=>[r.mark,r.late]));for(const r of rows)delete r.late;report.marks=rows;for(const r of rows)console.log(JSON.stringify({t:+r.t.toFixed(2),frames:r.frames,uploaded:r.uploaded,cap:Math.round(r.captureMs),height:+r.height.toFixed(3),albedo:+r.albedo.toFixed(3),both:+r.both.toFixed(3),exact:+r.exact.toFixed(3)}));
 const stats=await server.stats();report.server={requests:stats.requests,bytes:stats.bytes,misses:stats.misses,aborted:stats.aborted};
 await writeFile(resolve(dir,'requests.json'),JSON.stringify(await server.requests()));
 const at=t=>rows.filter(m=>m.t<=t+.1).at(-1);
 // The plan's gate, as written: every pixel. Until 31 October 2026 this tested 99.99%, with no record of why, which passed runs with hundreds of pixels late.
 const five=at(5);report.gates={ninety_percent_by_1s:(at(1)?.both??0)>=.9,all_by_5s:(five?.both??0)>=1};report.at_5s={share:five?.both??0,late_pixels:five?Math.round((1-five.both)*five.surface):null};
 console.log(JSON.stringify({longest_interval_ms:Math.round(run.longest),gates:report.gates,at_5s:report.at_5s,server:report.server}));
}finally{await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,1));if(b)await b.close();server.close();}
