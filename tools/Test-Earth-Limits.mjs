// What a session asks of a free source, and what it does when refused. EOX states no rate limit and refused a session that flew around a lot (403 with no CORS header, 31 October 2026). Replayed
// tiles only: nothing here touches a live host, and it cannot tell what EOX's limit is. It measures our side: requests per second with the budgets on and off, and how little is asked while a host
// is refusing, against a server that refuses as a real one does. A limit that passes here is not a promise about any real host's limit.
//   node tools/Test-Earth-Limits.mjs [--only cut,around,flight,inside,refused] --output DIR
import {tileServer,earthBrowser,settle,toEye,heading} from './Earth-Test-Lib.mjs';
import {ready} from './Explorer-Test-Lib.mjs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const dir=resolve(arg('output','evidence/local/real-earth/runs/limits'));await mkdir(dir,{recursive:true});
const W=+arg('width',1280),H=+arg('height',720),EOX='tiles.maps.eox.at';
const tour=JSON.parse(await readFile('tools/fixtures/earth-tour.json','utf8')),stop=n=>tour.stops.find(s=>s.name===n);
const pose=n=>{const s=stop(n),eye=toEye(s.lon,s.lat,s.alt),f=heading(s.lon,s.lat,s.heading);return [eye,eye.map((v,i)=>v+f[i]*1000)];};
const quant=v=>{v=[...v].sort((x,y)=>x-y);const q=p=>v[Math.min(v.length-1,Math.ceil(v.length*p)-1)]??null;return {n:v.length,p50:q(.5),p95:q(.95),p99:q(.99),max:v.at(-1)??null};};
// Run a list of [seconds, camera or function of elapsed time] in real time. Returns samples once a second and the frame intervals.
const script=legs=>`(async()=>{var toEye=${toEye};${heading};
 const legs=${legs};const samples=[];let longest=0,last=performance.now(),next=1,frames=0;const start=last;
 for(const leg of legs){const begin=performance.now();if(leg.camera)solarExplorer.camera=leg.camera;
  while(performance.now()-begin<leg.seconds*1000){
   const now=await new Promise(requestAnimationFrame);if(leg.at){const u=(performance.now()-begin)/(leg.seconds*1000);solarExplorer.camera=leg.at(u);}
   if(solarExplorer.step(1/60)){const t=performance.now();longest=Math.max(longest,t-last);last=t;frames++;}
   const e=(performance.now()-start)/1000;
   if(e>=next){next+=1;const s=solarExplorer.stats(),d=s.data_lag||{};samples.push({t:e,albedo:d.camera_albedo_deficit,height:d.camera_level_deficit,inFlight:d.pages_in_flight,uploaded:d.pages_uploaded,failed:d.pages_failed,hosts:s.field?.hosts});}
  }}
 const s=solarExplorer.stats();return {samples,longest,frames,lag:s.data_lag,field:s.field};})()`;
const SCENES={
 // A cold jump, then a wait.
 cut:()=>`[{seconds:20,camera:${JSON.stringify(pose('lausanne'))}}]`,
 // Flying around a lot: six jumps, a few seconds apart.
 around:()=>'['+['lausanne','dents-du-midi','edge-cross','corner','north-pole','lausanne'].map(n=>`{seconds:6,camera:${JSON.stringify(pose(n))}}`).join(',')+']',
 // A long flight at speed, Lausanne to the Dents du Midi at 400 m/s for a minute.
 flight:()=>{const a=stop('lausanne'),z=stop('dents-du-midi');return `[{seconds:60,at:u=>{const A=${JSON.stringify(a)},Z=${JSON.stringify(z)},l=k=>A[k]+(Z[k]-A[k])*u*0.61,eye=toEye(l('lon'),l('lat'),l('alt')),f=heading(l('lon'),l('lat'),l('heading'));return [eye,eye.map((v,i)=>v+f[i]*1000)];}}]`;},
};
async function run(name,scene,{limits,serverLimit=null}){
 const server=await tileServer({bandwidth:100,latency:40,requestLog:true,limit:serverLimit&&{hosts:EOX,...serverLimit}});let b;
 try{
  b=await earthBrowser(dir,server,{view:'earth-orbit',width:W,height:H,limits});
  await b.evaluate('solarExplorer.configure({clouds:false})');
  await settle(b,{maxFrames:1500});
  await server.reset();
  const out=await b.evaluate(script(SCENES[scene]()));
  const log=await server.requests(),all=Array.isArray(log)?log:log.requests,eox=all.filter(r=>r.host===EOX),seconds=Math.ceil(Math.max(...out.samples.map(s=>s.t),1));
  const perSecond=new Array(seconds).fill(0);for(const r of eox){const k=Math.floor(r.t/1000);if(k>=0&&k<seconds)perSecond[k]++;}
  const refused=eox.filter(r=>r.status===403),firstRefused=refused.length?refused[0].t:null;
  const row={name,scene,limits,serverLimit,seconds,eox:{requests:eox.length,refused:refused.length,megabytes:+(eox.reduce((n,r)=>n+(r.bytes||0),0)/1e6).toFixed(1),perSecond:quant(perSecond),inFirstSecond:perSecond[0],inFirstFiveSeconds:perSecond.slice(0,5).reduce((a,c)=>a+c,0)},
   allHostsRequests:all.length,albedoDeficit:quant(out.samples.map(s=>s.albedo??0)),heightDeficit:quant(out.samples.map(s=>s.height??0)),longestFrameMs:+out.longest.toFixed(1),frames:out.frames,failedPages:out.lag?.pages_failed,hosts:out.field?.hosts?.[EOX]??null};
  // After the first refusal, what was asked while the emulated server was blocking.
  if(firstRefused!==null&&serverLimit?.block){let inBlock=0,blockEnd=firstRefused+serverLimit.block*1000;for(const r of eox)if(r.t>firstRefused&&r.t<blockEnd)inBlock++;row.eox.afterFirstRefusal={seconds:serverLimit.block,requests:inBlock};}
  await writeFile(resolve(dir,`${name}.json`),JSON.stringify({row,perSecond,samples:out.samples},null,1));
  console.log(JSON.stringify({name,eox:row.eox,albedoDeficit:row.albedoDeficit,heightDeficit:row.heightDeficit,longest:row.longestFrameMs,failed:row.failedPages,pauses:row.hosts?.pauses,rate:row.hosts?.rate}));
  return row;
 }finally{if(b)await b.close();server.close();await new Promise(r=>setTimeout(r,300));}
}
// Going back to a place, in a new session of the same browser: what the disk saves, against the first visit.
async function revisit(){
 const server=await tileServer({bandwidth:100,latency:40,requestLog:true});let b;
 const visit=async name=>{await b.evaluate('solarExplorer.configure({clouds:false})');await settle(b,{maxFrames:900});await server.reset();const out=await b.evaluate(script(SCENES.cut()));const log=await server.requests(),all=Array.isArray(log)?log:log.requests;
  const row={name,requests:all.length,eox:all.filter(r=>r.host===EOX).length,eoxInFirstFiveSeconds:all.filter(r=>r.host===EOX&&r.t<5000).length,tileStore:out.field?.tileStore??null,albedoDeficit:quant(out.samples.map(s=>s.albedo??0)),longestFrameMs:+out.longest.toFixed(1)};console.log(JSON.stringify(row));return row;};
 try{
  b=await earthBrowser(dir,server,{view:'earth-orbit',width:W,height:H,limits:true});
  const first=await visit('first visit');
  await new Promise(r=>setTimeout(r,11000));// The index is written within ten seconds.
  await b.send('Page.reload');await ready(b);await b.evaluate(`solarExplorer.resize(${W},${H})`);
  const second=await visit('second visit, new session');
  return {first,second};
 }finally{if(b)await b.close();server.close();await new Promise(r=>setTimeout(r,300));}
}
const only=arg('only',null)?.split(',');const want=n=>!only||only.includes(n);
const report={width:W,height:H,bandwidth:100,latency:40,runs:[],checks:{}};
try{
 for(const scene of ['cut','around','flight'])if(want(scene)){
  const off=await run(`${scene}-unlimited`,scene,{limits:false}),on=await run(`${scene}-budget`,scene,{limits:true});report.runs.push(off,on);
  // A steady flight is modest either way, about 4 tiles a second: what nothing on screen reads is what jumps cost.
  if(scene==='flight')report.checks['flight: no more than without a budget']=on.eox.requests<=off.eox.requests*1.1;
  else report.checks[`${scene}: at most half the requests`]=on.eox.requests<=off.eox.requests*0.5;
 }
 // A server limit our budget should stay inside.
 if(want('inside')){
  const limit={rate:30,burst:400,block:10};
  const off=await run('inside-unlimited','around',{limits:false,serverLimit:limit}),on=await run('inside-budget','around',{limits:true,serverLimit:limit});report.runs.push(off,on);
  report.checks['a limit of 30/s, burst 400: refused with no budget']=off.eox.refused>0;
  report.checks['a limit of 30/s, burst 400: never reached with the budget']=on.eox.refused===0;
 }
 // A server limit far under our budget. It will be reached, and what matters is how little is then asked.
 if(want('refused')){
  const limit={rate:5,burst:60,block:15},on=await run('refused-budget','around',{limits:true,serverLimit:limit});report.runs.push(on);
  report.checks['refused: the budget halved']=on.hosts&&on.hosts.rate<20&&on.hosts.burst<300;
  report.checks['refused: at most 12 requests while blocked for 15 s']=(on.eox.afterFirstRefusal?.requests??0)<=12;
  report.checks['refused: no frame waits']=on.longestFrameMs<100;
 }
 if(want('revisit')){const r=await revisit();report.revisit=r;report.checks['revisit: at most a fifth of the requests in the first five seconds of a new session']=r.second.eoxInFirstFiveSeconds<=r.first.eoxInFirstFiveSeconds*0.2;}
 report.pass=Object.values(report.checks).every(Boolean);
 console.log(JSON.stringify({pass:report.pass,checks:report.checks}));
}finally{await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,1));}
