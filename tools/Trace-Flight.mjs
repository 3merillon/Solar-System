// Real-time frame trace of the free-flying solar camera (no car): the unpaused page loop
// (two frames in flight, wall-clock dt) at 1920x1080, one row per rAF callback with the
// GPU span, the whole-frame timeline (timing.rs marks, which add up to the span), the
// worker CPU time and the flight report (altitude, speed against the nearest body).
// --profiling 0 records rAF intervals only: no timestamp queries, the production frame.
// Usage: node tools/Trace-Flight.mjs --base URL [--scenes a,b] [--seconds 12] [--quality high] [--profiling 1] [--output dir]
import {headless} from './Headless.mjs';
import {ready,runFrames,capture} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const dir=arg('output','evidence/local/frame-cost-2026-11-14/flight'),base=arg('base','http://127.0.0.1:5198/'),seconds=+arg('seconds',12);
const profiling=arg('profiling','1')!=='0',quality=arg('quality','high'),shots=arg('captures','1')!=='0';
const patch=arg('patch','');
const scenes=arg('scenes','earth-hover,earth-low,earth-mountain,earth-dive,moon-descent,mars-arrival').split(',');
const q=a=>{a=a.filter(Number.isFinite).sort((x,y)=>x-y);const v=p=>a[Math.max(0,Math.ceil(a.length*p)-1)]??null;return{n:a.length,p50:v(.5),p95:v(.95),p99:v(.99),max:a.at(-1)??null};};
// Local noon over Europe on a fixed date, clock running at real time afterwards, so every
// run sees the same sun and the solar clock still turns it (the sun-drift case).
const NOON="const f=solarFlight;f.setTime(Date.parse('2026-06-21T11:00:00Z')/1000-946727935.816+5);f.setRate(1);";
const setups={
 // Named destinations of the page (engine.bookmark): a view along the ground toward the horizon.
 'earth-hover':{prep:NOON+"solarFlight.goEarth('lavaux');",keys:[]},
 // The same view with the solar clock stopped: no sun drift, so what the sun's motion costs.
 'earth-hover-still':{prep:NOON+"solarFlight.setRate(0);solarFlight.goEarth('lavaux');",keys:[]},
 'earth-matterhorn':{prep:"const f=solarFlight;f.setTime(Date.parse('2026-11-15T13:10:00Z')/1000-946727935.816+5);f.setRate(1);solarFlight.goEarth('matterhorn');",keys:[]},
 'earth-low':{prep:NOON+"solarFlight.goEarth('lavaux');",speed:300,keys:[[0,['KeyW']]]},
 'earth-mountain':{prep:NOON+"solarFlight.goEarth('matterhorn');",keys:[]},
 'earth-dive':{prep:NOON+"solarFlight.flight.jump_over(399,46.5,7.6,30000);solarFlight.flight.fly_to(399,0);",keys:[]},
 'moon-descent':{prep:NOON+"solarFlight.flight.jump_near(301,30000);solarFlight.flight.fly_to(301,0);",keys:[]},
 'mars-arrival':{prep:NOON+"solarFlight.flight.jump_near(499,200000);solarFlight.flight.fly_to(499,0);",keys:[]},
 // A procedural world of another star (Proxima Centauri's first, id 10001): into its system, then down from 200 km.
 'exo-arrival':{prep:NOON+"solarFlight.flight.jump_orbit(10001);solarFlight.flight.jump_near(10001,200000);solarFlight.flight.fly_to(10001,0);",keys:[]},
 // The Sun filling the view (2 solar radii from its centre) and from 10 radii: the star model's cost (space.wgsl `star`).
 'sun-2r':{prep:NOON+"solarFlight.flight.jump_near(10,6.957e8);solarFlight.flight.look_at(10);",keys:[]},
 'sun-10r':{prep:NOON+"solarFlight.flight.jump_near(10,6.2613e9);solarFlight.flight.look_at(10);",keys:[]},
 // Just over the photosphere (0.01 radii up), looking at it: granules, the chromosphere and the corona round the eye.
 'sun-1.01r':{prep:NOON+"solarFlight.flight.jump_near(10,6.957e6);solarFlight.flight.look_at(10);",keys:[]},
 // 200 km over the photosphere, looking along it to the horizon: the relief's search at its longest (space.wgsl `star`).
 'sun-skim':{prep:NOON+"solarFlight.flight.jump_near(10,2e5);solarFlight.flight.look_at(10);setTimeout(()=>{solarFlight.flight.look_at(0);solarFlight.look(0,-760);},2500);",keys:[]},
};
const record=(s,secs)=>`(async()=>{const script=${JSON.stringify(s.keys)},rows=[];let last=null,k=0;const t0=performance.now();
 ${s.speed?`{const e=document.getElementById('speed');e.value=String(Math.log10(${s.speed}));e.dispatchEvent(new Event('input'));}`:''}
 solarExplorer.telemetry();solarExplorer.paused=false;
 await new Promise(done=>{function tick(now){const t=(now-t0)/1000;while(k<script.length&&t>=script[k][0]){solarExplorer.keys.clear();for(const c of script[k++][1])solarExplorer.keys.add(c);}
  const st=solarExplorer.stats(),g=solarExplorer.telemetry(),r=solarFlight.flight.report();
  rows.push({t,raf:last===null?null:now-last,gpu:g.map(x=>x.gpu_span_ms).filter(Number.isFinite),marks:g.map(x=>x.marks).filter(m=>m&&m.length),worker:st.worker_frame_cpu_ms,pending:st.pending,shown:st.solar?.surface_shown,near:r[1],clear:r[2],speed:r[3],eye:solarExplorer.camera?.[0]});
  last=now;if(t<${secs})requestAnimationFrame(tick);else done();}requestAnimationFrame(tick);});
 solarExplorer.keys.clear();solarExplorer.paused=true;await solarExplorer.engine.flush();return{rows,stats:solarExplorer.stats(),longtasks:window.perfLong||[]};})()`;
await mkdir(dir,{recursive:true});
const b=await headless(dir),report={command:process.argv,base,browser:b.version,width:1920,height:1080,quality,queue:2,profiling,patch,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--short'],{encoding:'utf8'}),cases:[]};
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
 await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.perfLong=[];new PerformanceObserver(l=>{for(const e of l.getEntries())if(perfLong.length<4096)perfLong.push({start:e.startTime,duration:e.duration});}).observe({type:'longtask',buffered:true});`});
 for(const name of scenes){
  const s=setups[name];const started=performance.now();
  await b.send('Page.navigate',{url:new URL('index.html',base).href+`?test=1&vehicle=0&quality=${quality}`});await ready(b); // vehicle=0: older snapshots still carry the car; newer builds ignore it
  await b.evaluate(`solarExplorer.resize(1920,1080);solarExplorer.engine.profiling(${profiling});solarExplorer.engine.frame_queue_depth(2)`);
  await runFrames(b,60);if(patch)await b.evaluate(`solarExplorer.configure(${patch})`);await b.evaluate(s.prep);
  // Settle: let the surface and its programs arrive before the clock starts (warm-up is reported separately).
  for(let i=0;i<60;i++){await runFrames(b,10);if(await b.evaluate(`(()=>{const s=solarExplorer.stats();return s.solar?.surface_shown!==false&&!(s.pending_samples>0);})()`))break;}
  const ready_s=(performance.now()-started)/1000;
  const run=await b.evaluate(record(s,seconds));
  const r=run.rows,raf=r.map(x=>x.raf).filter(Number.isFinite),warm=r.filter(x=>x.t>=2);
  const summary={ready_s,frames:r.length,raf:q(raf),raf_after_2s:q(warm.map(x=>x.raf)),over17:raf.filter(x=>x>17.5).length,over20:raf.filter(x=>x>20).length,over33:raf.filter(x=>x>33.4).length,over50:raf.filter(x=>x>50).length,
   gpu:q(r.flatMap(x=>x.gpu)),gpu_after_2s:q(warm.flatMap(x=>x.gpu)),worker:q(r.map(x=>x.worker)),speed:q(r.map(x=>x.speed)),clear:q(r.map(x=>x.clear)),surface_frames:r.filter(x=>x.shown).length,longtasks:run.longtasks.filter(l=>l.start>0).length};
  const tl={};for(const x of r)for(const m of x.marks||[])for(const [l,v] of m)(tl[l]??=[]).push(v);
  summary.timeline=Object.entries(tl).map(([l,v])=>{const z=q(v);return [l,+z.p50.toFixed(2),+z.p95.toFixed(2)];}).filter(x=>x[1]>=0.05||x[2]>=0.3);
  summary.timeline_p50_sum=+Object.values(tl).reduce((a,v)=>a+q(v).p50,0).toFixed(2);
  report.cases.push({name,summary,rows:r,stats:run.stats});
  console.log(JSON.stringify({name,...summary,timeline:undefined}));
  console.log(summary.timeline.map(x=>x.join(' ')).join(' | '));
  if(shots)await capture(b,`${dir}/${name}.png`,1920,1080);await writeFile(dir+'/report.json',JSON.stringify(report));
 }
 report.pass=true;
}catch(e){report.error=String(e.stack||e);process.exitCode=1;console.error(e);}finally{await writeFile(dir+'/report.json',JSON.stringify(report));await b.close();}
