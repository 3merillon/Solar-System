// M1 gate: camera cuts, cold cache, reverse flight, fast flight and page failures complete, with
// counters exposed. Real time through the replay server; a fresh private browser per case. Replay only.
import {tileServer,earthBrowser,toEye,heading} from './Earth-Test-Lib.mjs';
import {capture} from './Explorer-Test-Lib.mjs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const dir=resolve(arg('output','evidence/local/real-earth/runs/motion'));await mkdir(dir,{recursive:true});
const W=+arg('width',1280),H=+arg('height',720),bandwidth=+arg('bandwidth',100),latency=+arg('latency',40),bound=+arg('settle-s',60);
const tour=JSON.parse(await readFile('tools/fixtures/earth-tour.json','utf8'));
const S=n=>{const s=tour.stops.find(t=>t.name===n);if(!s)throw Error('stop '+n);return {lon:s.lon,lat:s.lat,alt:s.alt,hd:s.heading};};
const quant=v=>{v=v.filter(Number.isFinite).sort((x,y)=>x-y);const q=p=>v[Math.min(v.length-1,Math.ceil(v.length*p)-1)]??null;return{n:v.length,p50:q(.5),p95:q(.95),p99:q(.99),max:v.at(-1)??null};};
// Page side: M.run(seconds, keys) renders in real time, interpolating keys [{t,lon,lat,alt,hd}] (one key holds still).
const prelude=`var toEye=${toEye};${heading};window.M={iv:[],rows:[],frames:0,rejected:0,last:0,samples:[],
 reset(){this.iv=[];this.rows=[];this.frames=0;this.rejected=0;this.last=0;this.samples=[];solarExplorer.telemetry();},
 async run(secs,keys,sampleEvery=0){const t0=performance.now();let nextSample=0;for(;;){const now=await new Promise(requestAnimationFrame),e=(now-t0)/1000;if(e>=secs)break;
  let k=keys.length-1;while(k>0&&keys[k-1].t>e)k--;const a=keys[Math.max(0,k-1)],z=keys[k],u=a===z||z.t===a.t?0:Math.min(1,Math.max(0,(e-a.t)/(z.t-a.t))),l=p=>a[p]+(z[p]-a[p])*u;
  const eye=toEye(l('lon'),l('lat'),l('alt')),f=heading(l('lon'),l('lat'),l('hd'));solarExplorer.camera=[eye,eye.map((v,i)=>v+f[i]*1000)];
  if(solarExplorer.step(1/60)){if(this.last)this.iv.push(now-this.last);this.last=now;this.frames++;for(const r of solarExplorer.telemetry())this.rows.push(r);}else this.rejected++;
  if(sampleEvery&&e>=nextSample){nextSample=e+sampleEvery;let p=null;try{p=JSON.parse(solarExplorer.engine.audit_progress());}catch{}const s=solarExplorer.stats();this.samples.push({e,lag:s.data_lag,field:s.field,progress:p,pos:solarExplorer.camera[0]});}}
  this.last=0;},
 take(){const s=solarExplorer.stats();return{iv:this.iv,frames:this.frames,rejected:this.rejected,rows:this.rows.map(r=>({gpu:r.gpu_ms?r.gpu_ms.reduce((x,y)=>x+y,0):null,error:r.error||null})),samples:this.samples,stats:s};}};`;
const hold=(p,secs)=>`M.run(${secs},${JSON.stringify([{t:0,...p}])})`;
const errs=(o,pat=/overflow|error|lost|fail|drop/i,out={},path='')=>{if(o&&typeof o==='object'&&!Array.isArray(o)){for(const [k,v] of Object.entries(o))errs(v,pat,out,path+k+'.');}else if(pat.test(path)&&(typeof o==='number'||typeof o==='boolean'||typeof o==='string'))out[path.slice(0,-1)]=o;return out;};
const report={bandwidth,latency,width:W,height:H,cases:[],gates:{}};
async function open(opts,view='earth-orbit'){
 const server=await tileServer(opts);
 const b=await earthBrowser(dir,server,{view,width:W,height:H});
 await b.evaluate('solarExplorer.engine.profiling(true);solarExplorer.configure({clouds:false})');
 await b.evaluate(prelude);return {server,b};
}
// Real-time settle: chunks of 2 s until the field is quiet for 3 chunks or the bound runs out; samples counters.
async function settleReal(b,server,p,series){
 let quiet=0,t=0;
 while(t<bound&&quiet<3){await b.evaluate(hold(p,2));t+=2;const s=await b.evaluate('(()=>{const s=solarExplorer.stats();return{lag:s.data_lag,field:s.field}})()');const st=await server.stats();
  series.push({t,failed:s.lag?.pages_failed,uploaded:s.lag?.pages_uploaded,inflight:s.lag?.pages_in_flight,queued:s.lag?.pages_queued,requests:st.requests});
  quiet=s.lag&&s.lag.pages_in_flight===0&&s.lag.pages_queued===0&&(s.field?.inFlight||0)===0&&(s.field?.queued||0)===0?quiet+1:0;}
 return {settled:quiet>=3,seconds:t};
}
async function runCase(name,opts,body,{view='earth-orbit'}={}){
 const {server,b}=await open({bandwidth,latency,...opts},view);
 let row={case:name,opts};
 try{
  await b.evaluate('M.reset()');
  const extra=await body(b,server);
  const run=await b.evaluate('M.take()');
  const st=await server.stats();
  row={...row,...extra,frames:run.frames,rejected:run.rejected,longest_ms:Math.max(0,...run.iv),interval:quant(run.iv),gpu_sum:quant(run.rows.map(r=>r.gpu)),telemetry_errors:run.rows.filter(r=>r.error).length,
   data_lag:run.stats.data_lag,field:run.stats.field,device_lost:run.stats.device_lost,counters:errs(run.stats),samples:run.samples,
   server:{requests:st.requests,bytes:st.bytes,aborted:st.aborted,misses:st.misses,injected404:st.injected404,injected503:st.injected503,droppedConnections:st.droppedConnections,peakInFlight:st.peakInFlight}};
  await capture(b,resolve(dir,name+'-settled.png'),W,H,'display');
  // Topology after settling, profiling on: the surface must stay closed.
  try{const a=JSON.parse(await b.evaluate('solarExplorer.engine.audit_geometry()'));row.topology={boundary_edges:a.boundary_edges,nonmanifold_edges:a.nonmanifold_edges,topology_overflow:a.topology_overflow};}catch(e){row.topology={error:String(e.message||e)};}
 }catch(e){row.harness_error=String(e.stack||e);}
 finally{await b.close();server.close();await new Promise(r=>setTimeout(r,300));}
 report.cases.push(row);
 console.log(JSON.stringify({case:name,frames:row.frames,longest_ms:row.longest_ms,interval:row.interval,lag:row.data_lag,requests:row.server?.requests,aborted:row.server?.aborted,misses:row.server?.misses,topology:row.topology,settled:row.settled}));
 return row;
}
const L=S('lausanne'),D=S('dents-du-midi');
const gate=(name,ok,why)=>{report.gates[name]={pass:ok,...why};console.log((ok?'PASS ':'FAIL ')+name+' '+JSON.stringify(why));};
const closed=r=>r.topology&&r.topology.boundary_edges===0&&r.topology.nonmanifold_edges===0&&r.topology.topology_overflow===0;
const only=arg('only',null)?.split(',');const want=n=>!only||only.includes(n);
try{
 if(want('a'))await runCase('a-cold-cut',{},async(b,s)=>{const x={};x.settle=[];await b.evaluate(hold(S('lausanne'),0.1));x.settled=(await settleReal(b,s,L,x.settle)).settled;return x;});
 if(want('b'))await runCase('b-repeated-cuts',{},async(b,s)=>{const x={cuts:[]};for(const n of ['lausanne','dents-du-midi','edge-cross','corner','north-pole','lausanne']){await b.evaluate(hold(S(n),3));const st=await s.stats();x.cuts.push({stop:n,requests:st.requests});}x.settle=[];x.settled=(await settleReal(b,s,L,x.settle)).settled;return x;});
 // Genoa edge: the tour calls it edge-north/edge-cross/edge-south; the middle stop is the one at the cube-face edge.
 if(want('c'))await runCase('c-reverse-flight',{},async(b,s)=>{
  const f=6000/Math.hypot((D.lat-L.lat)*111195,(D.lon-L.lon)*111195*Math.cos(46.3*Math.PI/180)),P={lon:L.lon+(D.lon-L.lon)*f,lat:L.lat+(D.lat-L.lat)*f,alt:L.alt+(D.alt-L.alt)*f,hd:L.hd};
  await b.evaluate(hold(L,0.1));const x={settle:[]};
  await b.evaluate(`M.run(30,${JSON.stringify([{t:0,...L},{t:15,...P},{t:30,...L}])},2)`);
  x.settled=(await settleReal(b,s,L,x.settle)).settled;return x;});
 if(want('d'))await runCase('d-fast-flight',{},async(b,s)=>{
  const start={...L,alt:5000},dl=D.lat-L.lat,dn=D.lon-L.lon,n=Math.hypot(dl,dn*Math.cos(46.3*Math.PI/180)),deg=600000/111195,end={...start,lat:L.lat+dl/n*deg,lon:L.lon+dn/n*deg/Math.cos(46.3*Math.PI/180)};
  await b.evaluate(hold(start,0.1));const x={speed_ms:30000,seconds:20,altitude_m:5000,settle:[]};
  await b.evaluate(`M.run(20,${JSON.stringify([{t:0,...start},{t:20,...end}])},2)`);
  x.finest_level_samples=(await b.evaluate('M.samples')).map(q=>({e:q.e,progress:q.progress,inflight:q.lag?.pages_in_flight,queued:q.lag?.pages_queued}));
  x.settled=(await settleReal(b,s,end,x.settle)).settled;x.note='progress samples come from engine.audit_progress(); the finest-level key is not named by this harness';return x;});
 if(want('e'))await runCase('e-failure-injection',{fail:.3,notfound:.1},async(b,s)=>{
  const x={settle:[]};await b.evaluate(hold(L,0.1));const r=await settleReal(b,s,L,x.settle);x.settled=r.settled;x.settle_seconds=r.seconds;
  const tail=x.settle.filter(q=>q.t>=r.seconds-10);x.request_growth_last_10s=tail.length?tail.at(-1).requests-tail[0].requests:null;
  x.failed_growth_last_10s=tail.length?tail.at(-1).failed-tail[0].failed:null;
  x.note='server stats carry no per-URL counts; total request growth over the last 10 s stands in for requests without end';return x;});
 if(want('f'))await runCase('f-dead-source',{},async(b,s)=>{
  const x={settle:[]};await b.evaluate(hold(L,0.1));
  await b.evaluate(`M.run(3,${JSON.stringify([{t:0,...L}])})`);await s.control({fail:1});x.dead_from=(await s.stats()).requests;
  await b.evaluate(hold(S('dents-du-midi'),10));x.requests_during_dead=(await s.stats()).requests-x.dead_from;
  await s.control({fail:0});const r=await settleReal(b,s,D,x.settle);x.settled=r.settled;x.recover_seconds=r.seconds;
  x.note='camera cut to Dents du Midi at the start of the dead stretch';return x;});
 for(const r of report.cases){
  gate(r.case,!r.harness_error&&!r.device_lost&&r.telemetry_errors===0&&closed(r)&&r.settled!==false,{harness_error:r.harness_error||null,device_lost:r.device_lost,telemetry_errors:r.telemetry_errors,topology:r.topology,settled:r.settled});
 }
}finally{await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,1));}
