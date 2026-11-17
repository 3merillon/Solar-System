// The score on the real page, in a private headless browser, under the machine lock.
// 1. Frame cost: the same scene with the music off, on, on, off (one page load; the order cancels a drift), each phase a real-time
//    recording of rAF intervals and GPU spans, and the main-thread time the music took per second of sound.
// 2. Behaviour: a hidden tab stops the scheduler and suspends the context; shown again it resumes where it was; a context
//    suspended from outside (as an interruption does) leaves nothing spinning and resumes on a gesture; a Go trip sounds
//    its rise, its arrival, and brings the new place's piece.
// Serve a snapshot first (node tools/serve.mjs --port 5462 --root <snapshot>), never web/ itself.
// Usage: node tools/Test-Music-Live.mjs --base http://127.0.0.1:5462/ [--scenes earth-hover,sun-2r] [--seconds 10] [--quality high] [--output DIR]
import {headless} from './Headless.mjs';
import {ready,runFrames} from './Explorer-Test-Lib.mjs';
import {withLock} from './Music-Lock.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const data=process.env.SOLAR_DATA||'data',dir=arg('output',data+'/music/runs/live'),base=arg('base','http://127.0.0.1:5462/'),seconds=+arg('seconds',10),quality=arg('quality','high');
const scenes=arg('scenes','earth-hover,sun-2r').split(','),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const q=a=>{a=a.filter(Number.isFinite).sort((x,y)=>x-y);const v=p=>a[Math.max(0,Math.ceil(a.length*p)-1)]??null,f=x=>x==null?null:+x.toFixed(2);return {n:a.length,p50:f(v(.5)),p95:f(v(.95)),p99:f(v(.99)),max:f(a.at(-1)??null)};};
// The scenes of tools/Trace-Flight.mjs: local noon over Europe on a fixed date, the clock at real time.
const NOON="const f=solarFlight;f.setTime(Date.parse('2026-06-21T11:00:00Z')/1000-946727935.816+5);f.setRate(1);";
const setups={'earth-hover':NOON+"solarFlight.goEarth('lavaux');",'sun-2r':NOON+"solarFlight.flight.jump_near(10,6.957e8);solarFlight.flight.look_at(10);",'deep-space':NOON+"solarFlight.flight.jump_near(399,6.4e9);"};
const record=secs=>`(async()=>{const raf=[],gpu=[];let last=null;const t0=performance.now();solarExplorer.telemetry();solarExplorer.paused=false;
 await new Promise(done=>{function tick(now){if(last!==null)raf.push(now-last);last=now;for(const x of solarExplorer.telemetry())if(Number.isFinite(x.gpu_span_ms))gpu.push(x.gpu_span_ms);if(now-t0<${secs*1000})requestAnimationFrame(tick);else done();}requestAnimationFrame(tick);});
 solarExplorer.paused=true;await solarExplorer.engine.flush();return {raf,gpu};})()`;
await mkdir(dir,{recursive:true});
const report={base,quality,seconds,cases:[],behaviour:{}};
let failed=0;const check=(ok,what)=>{console.log(`${ok?'ok  ':'FAIL'} ${what}`);if(!ok)failed++;(report.behaviour.checks??=[]).push({ok,what});};
await withLock(`tools/Test-Music-Live.mjs: ${scenes.join(', ')} with the music off and on, then behaviour`,Math.ceil(scenes.length*(seconds*4+60)/60)+2,async()=>{
 const b=await headless(dir);
 // A gesture, as the page sees one: audio may only start on it.
 const gesture=async expression=>{const r=await b.send('Runtime.evaluate',{expression,userGesture:true,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
 const music=()=>b.evaluate('solarMusic.report()');
 const on=async()=>{await gesture('(async()=>{if(!solarMusic.enabled)await solarMusic.toggle();else await solarMusic.resume();})()');for(let i=0;i<100;i++){const m=await music();if(m.playing&&m.voices>0)return m;await sleep(100);}throw Error('The music did not start: '+JSON.stringify(await music()));};
 const off=async()=>{await b.evaluate('(async()=>{if(solarMusic.enabled)await solarMusic.toggle();})()');await sleep(700);};
 try{
  await b.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  for(const name of scenes){
   await b.send('Page.navigate',{url:new URL('index.html',base).href+`?test=1&quality=${quality}`});await ready(b);
   await b.evaluate('solarExplorer.resize(1920,1080);solarExplorer.engine.profiling(true);solarExplorer.engine.frame_queue_depth(2)');
   await runFrames(b,60);await b.evaluate(setups[name]);
   for(let i=0;i<60;i++){await runFrames(b,10);if(await b.evaluate('(()=>{const s=solarExplorer.stats();return s.solar?.surface_shown!==false&&!(s.pending_samples>0);})()'))break;}
   // Warm the music once (rooms computed, first deck up) so the phases compare steady states.
   await on();await b.evaluate(record(4));await off();
   const phases=[];
   // Off, on, on, off: a drift over the run (the scene warming) then falls equally on both, and the means compare.
   for(const phase of ['off','on','on','off']){
    if(phase==='on')await on();else await off();
    const m0=await music(),run=await b.evaluate(record(seconds)),m1=await music();
    const row={phase,raf:q(run.raf),gpu:q(run.gpu),over20:run.raf.filter(x=>x>20).length,over33:run.raf.filter(x=>x>33.4).length};
    if(phase==='on')Object.assign(row,{line:m1.line,tickMsPerSecond:+((m1.tickMs-m0.tickMs)/seconds).toFixed(3),stepMsPerSecond:+((m1.stepMs-m0.stepMs)/seconds).toFixed(3),worstTickMs:+m1.maxTickMs.toFixed(2),voices:+m1.voices.toFixed(1),peakVoices:+m1.peak.toFixed(1),budget:m1.budget,
     late:m1.late-m0.late,retimed:m1.retimed-m0.retimed,stalls:m1.stalls-m0.stalls,dropped:m1.dropped-m0.dropped,lookahead:+m1.look.toFixed(2)});
    phases.push(row);console.log(name,JSON.stringify(row));
   }
   const mean=(which,pick)=>{const v=phases.filter(p=>p.phase===which).map(pick);return +(v.reduce((a,b)=>a+b,0)/v.length).toFixed(2);};
   const compare={gpuP50:{off:mean('off',p=>p.gpu.p50),on:mean('on',p=>p.gpu.p50)},rafP95:{off:mean('off',p=>p.raf.p95),on:mean('on',p=>p.raf.p95)},rafP99:{off:mean('off',p=>p.raf.p99),on:mean('on',p=>p.raf.p99)},over33:{off:mean('off',p=>p.over33),on:mean('on',p=>p.over33)}};
   console.log(name,'means',JSON.stringify(compare));
   report.cases.push({name,phases,compare});await writeFile(dir+'/report.json',JSON.stringify(report,null,1));
  }
  // Behaviour, on the last page. The page loop runs (unpaused) so timers and frames compete as they do for a player.
  await b.evaluate('solarExplorer.paused=false');
  let m=await on();const bar0=m.bar;
  await b.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));");
  await sleep(900);m=await music();const ticks=m.ticks,state=await b.evaluate('solarMusic.context.state');await sleep(1200);const later=await music();
  check(!m.running&&state==='suspended'&&later.ticks===ticks,`hidden tab: scheduler stopped, context ${state}, no ticks in the next 1.2 s`);
  await b.evaluate("delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));");
  await sleep(1500);m=await music();
  check(m.running&&m.state==='running'&&m.voices>0&&m.bar>=bar0,`shown again: running, ${m.voices.toFixed(0)} voices, bar ${m.bar} (was ${bar0}), ${m.stalls} stalls`);
  // An interruption: the context is suspended by something other than the page's own controls.
  await b.evaluate('solarMusic.context.suspend()');await sleep(600);m=await music();const t2=m.ticks;await sleep(1200);const m2=await music();
  check(!m.running&&m2.ticks===t2,`context suspended from outside: scheduler stopped (state ${m.state}), no ticks in the next 1.2 s`);
  await gesture('solarMusic.resume()');await sleep(1200);m=await music();
  check(m.running&&m.state==='running'&&m.voices>0,`a gesture resumes it: ${m.voices.toFixed(0)} voices`);
  // A Go trip from over Earth to the Moon.
  await b.evaluate('solarFlight.flight.jump_near(399,2e7)');
  for(let i=0;i<120;i++){m=await music();if(m.zone==='body:399'&&m.line.startsWith('Earth'))break;await sleep(100);}
  check(m.zone==='body:399',`near Earth the zone is ${m.zone}: ${m.line}`);
  await b.evaluate('solarFlight.flight.go_to(301)');const t0=Date.now();let seen={};
  for(let i=0;i<220;i++){m=await music();for(const l of m.log){if(l.startsWith('accent riser')&&!seen.riser)seen.riser=(Date.now()-t0)/1000;if(l.startsWith('accent arrive')&&!seen.arrive)seen.arrive=(Date.now()-t0)/1000;}if(m.zone==='body:301'&&seen.arrive)break;await sleep(100);}
  // The new place's line is told when its piece has been prepared, a few turns after the zone changes: wait for it before quoting it.
  for(let i=0;i<60&&!m.line.startsWith('Moon');i++){await sleep(100);m=await music();}
  check(seen.riser!==undefined&&seen.arrive!==undefined&&m.zone==='body:301',`Go to the Moon: rise at ${seen.riser?.toFixed(1)} s, arrival at ${seen.arrive?.toFixed(1)} s, then ${m.line}`);
  await sleep(2500);m=await music();
  check(m.dropped===0||m.dropped<m.spawned*.02,`${m.spawned} notes sounded, ${m.dropped} dropped by the budget, ${m.late} late, ${m.retimed} retimed, ${m.stalls} stalls, worst tick ${m.maxTickMs.toFixed(2)} ms`);
  report.behaviour.final=m;console.log('pieces: '+m.log.filter(l=>l.startsWith('play')).join(' | '));
  await b.evaluate('solarExplorer.paused=true');
 }finally{await writeFile(dir+'/report.json',JSON.stringify(report,null,1));await b.close();}
});
console.log(failed?`${failed} checks failed`:'all behaviour checks passed');process.exitCode=failed?1:0;
