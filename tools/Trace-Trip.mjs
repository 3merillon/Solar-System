// Animated trips (Go, Go over a landmark, Land at one), traced frame by frame in a private headless browser at 1920x1080, unpaused
// page loop. Per trip: how long it ran, its smoothness (no frame with a jump in position or turn rate), the least clearance over
// every body's reference sphere along the way, where it ended against where it was meant to, the frame cost during the trip and
// in the seconds after, how long the surface took to settle on arrival, and the pack requests per second it caused (counted from
// the browser's own network events; the packs come from the local stand-in the snapshot serves, never the owner's host).
//   node tools/Trace-Trip.mjs --base http://127.0.0.1:5253 --out DIR [--trips go-mars,land-matterhorn] [--after 6] [--warm 1]
// --warm 1 runs each trip twice in one profile and page load, reporting both (cold first, then warm).
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {headless} from './Headless.mjs';
import {ready} from './Explorer-Test-Lib.mjs';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const base=arg('base','http://127.0.0.1:5253'),out=resolve(arg('out','evidence/local/trips'));mkdirSync(out,{recursive:true});
const after=+arg('after',6),warm=arg('warm','0')==='1';
// --serverlog FILE: the snapshot server's --log, for pack requests per second as the server saw them (the field worker's fetches
// are not in the page's own network events).
const serverLog=arg('serverlog',null);
const serverCounts=(t0,t1)=>{if(!serverLog||!existsSync(serverLog))return null;const per=new Map();let n=0;for(const line of readFileSync(serverLog,'utf8').split('\n')){const [ms,path]=line.split(' ');const t=+ms/1000;if(!(t>=t0&&t<=t1)||!/^\/pack\//.test(path||''))continue;n++;const k=Math.floor(t);per.set(k,(per.get(k)||0)+1);}return {requests:n,peak_per_s:Math.max(0,...per.values()),per_s:[...per.entries()].sort((a,b)=>a[0]-b[0]).map(e=>e[1])};};
const T=852076800;
// Each trip: a start (run in the page first, then a settle), and the trip itself (what a click on Go or Land does).
const TRIPS={
 'go-mars':{start:'',go:`document.getElementById('solar-target').value='499';document.getElementById('solar-go').click()`,target:499,end:'orbit'},
 'go-jupiter':{start:'',go:`document.getElementById('solar-target').value='599';document.getElementById('solar-go').click()`,target:599,end:'orbit'},
 'go-moon':{start:'',go:`document.getElementById('solar-target').value='301';document.getElementById('solar-go').click()`,target:301,end:'orbit'},
 'go-saturn-fast':{start:`solarFlight.setRate(7)`,go:`document.getElementById('solar-target').value='699';document.getElementById('solar-go').click()`,target:699,end:'orbit'},
 'over-olympus':{start:`solarFlight.flight.jump_orbit(499)`,go:`solarFlight.goOver({body:499,lat:18.65,lon:226.2,size:624})`,target:499,end:'over',lat:18.65,lon:226.2},
 'land-olympus':{start:`solarFlight.flight.jump_orbit(499)`,go:`solarFlight.landAt({body:499,lat:18.65,lon:226.2,size:624})`,target:499,end:'land',lat:18.65,lon:226.2},
 'land-matterhorn':{start:'',go:`solarFlight.landAt({body:399,lat:45.9763,lon:7.6586,size:3})`,target:399,end:'land',lat:45.9763,lon:7.6586},
 'land-far-side':{start:`solarFlight.goEarth('lavaux')`,go:`solarFlight.landAt({body:399,lat:-33.86,lon:151.21,size:10})`,target:399,end:'land',lat:-33.86,lon:151.21},
 // The jumps the trips replace, on the same build, for the arrival's request burst and settle time.
 'jump-mars':{start:'',go:`solarFlight.flight.jump_orbit(499)`,target:499,end:'jump'},
 'jump-olympus':{start:`solarFlight.flight.jump_orbit(499)`,go:`solarFlight.flight.jump_facing(499,18.65,226.2,686400)`,target:499,end:'jump'},
 'jump-matterhorn':{start:'',go:`solarFlight.flight.jump_facing(399,45.9763,7.6586,20000)`,target:399,end:'jump'},
 'cancel':{start:'',go:`document.getElementById('solar-target').value='699';document.getElementById('solar-go').click()`,target:699,end:'cancel',cancelAt:1.5},
};
const trips=arg('trips',Object.keys(TRIPS).join(',')).split(',');
const q=a=>{a=a.filter(Number.isFinite).sort((x,y)=>x-y);const v=p=>a[Math.max(0,Math.ceil(a.length*p)-1)]??null;return{n:a.length,p50:v(.5),p95:v(.95),p99:v(.99),max:a.at(-1)??null};};
// In the page: run the trip and record every rAF frame until `after` seconds past its end.
const record=(trip)=>`(async()=>{
 const f=solarFlight.flight,rows=[];const t0=performance.now();let ended=null,cancelled=false;
 solarExplorer.telemetry();solarExplorer.paused=false;
 ${trip.go};
 await new Promise(done=>{function tick(now){const t=(now-t0)/1000;
  if(${trip.cancelAt??-1}>0&&t>=${trip.cancelAt??-1}&&!cancelled){cancelled=true;solarExplorer.keys.add('KeyW');setTimeout(()=>solarExplorer.keys.delete('KeyW'),100);}
  const st=solarExplorer.stats(),g=solarExplorer.telemetry(),r=f.report(),trip=[...f.trip_state()],p=[...f.probe(${trip.target})],c=[...f.body_clearance()];
  rows.push({t,trip,p,c,frame:r[0],near:r[1],clear:r[2],speed:r[3],gpu:g.map(x=>x.gpu_span_ms).filter(Number.isFinite),shown:st.solar?.surface_shown,wanted:st.solar?.wanted,lag:st.data_lag?{wanted:st.data_lag.pages_wanted,resident:st.data_lag.pages_resident,flight:st.data_lag.pages_in_flight,queued:st.data_lag.pages_queued,deficit:st.data_lag.camera_level_deficit}:null,pending:st.pending_samples});
  if(!trip[0]&&ended===null&&t>0.1)ended=t;
  if(ended===null||t<ended+${after})requestAnimationFrame(tick);else done();}requestAnimationFrame(tick);});
 solarExplorer.keys.clear();solarExplorer.paused=true;return {rows,ended};})()`;
const b=await headless(join(out,'.profile'));const report={base,after,warm,trips:[]};
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
 await b.send('Network.enable',{});
 let requests=[];b.onEvent(v=>{if(v.method==='Network.requestWillBeSent')requests.push({t:v.params.timestamp,url:v.params.request.url});});
 for(const name of trips){
  const trip=TRIPS[name];if(!trip)throw Error('unknown trip '+name);
  await b.send('Page.navigate',{url:`${base}/explorer.html?test=1&quality=high&limits=off&body=solar&tdb=${T}`});await ready(b);
  await b.evaluate(`(async()=>{solarExplorer.resize(1920,1080);solarExplorer.engine.profiling(true);solarFlight.setRate(1);${trip.start};solarExplorer.paused=false;await new Promise(r=>setTimeout(r,4000));})()`);
  for(const pass of warm?['cold','warm']:['cold']){
   if(pass==='warm')await b.evaluate(`(async()=>{${trip.start||"solarFlight.flight.jump_orbit(399)"};await new Promise(r=>setTimeout(r,3000));})()`);
   requests=[];const wall0=Date.now()/1000;
   const run=await b.evaluate(record(trip));
   const wall1=Date.now()/1000;
   const rows=run.rows;const active=rows.filter(r=>r.trip[0]);
   // Smoothness: the second difference of the eye's position against the target over the height over the nearest surface (a
   // bend the eye sees), and the change of turn rate from one frame to the next, radians per second per frame.
   let bend=0,bendAt=null,turnJump=0,lastTurn=null;
   for(let i=2;i<rows.length;i++){const [a,b2,c]=[rows[i-2],rows[i-1],rows[i]];if(!a.trip[0]&&!c.trip[0])continue;
    const d=[0,1,2].map(k=>c.p[k]-2*b2.p[k]+a.p[k]),dt1=b2.t-a.t,dt2=c.t-b2.t;const scale=Math.max(1,Math.min(b2.clear,b2.c[0]));
    // Uneven frame times are normalised: the second difference of a smooth path scales with dt^2.
    const v=Math.hypot(...d)/scale*(1/60)**2/Math.max(1e-6,dt1*dt2);if(v>bend){bend=v;bendAt=b2.t;}
    const ang=(x,y)=>Math.acos(Math.max(-1,Math.min(1,x[3]*y[3]+x[4]*y[4]+x[5]*y[5])));const turn=ang(b2.p,c.p)/Math.max(1e-6,dt2);
    if(lastTurn!==null)turnJump=Math.max(turnJump,Math.abs(turn-lastTurn));lastTurn=turn;}
   const end=rows.find(r=>!r.trip[0]&&r.t>0.1)||rows.at(-1),last=rows.at(-1);
   const fixed=end.p.slice(6,9),rr=Math.hypot(...fixed),lat=Math.asin(fixed[1]/rr)*180/Math.PI,lon=Math.atan2(fixed[0],fixed[2])*180/Math.PI;
   const aimed=trip.lat===undefined?null:(()=>{const la=trip.lat*Math.PI/180,lo=trip.lon*Math.PI/180,u=[Math.cos(la)*Math.sin(lo),Math.sin(la),Math.cos(la)*Math.cos(lo)];return Math.acos(Math.min(1,(u[0]*fixed[0]+u[1]*fixed[1]+u[2]*fixed[2])/rr));})();
   const after_=rows.filter(r=>run.ended!==null&&r.t>run.ended);
   const settled=after_.find(r=>r.shown!==false&&(!r.lag||(r.lag.flight===0&&r.lag.queued===0)));
   const packs=requests.filter(x=>/\/pack|pack-|solar-system-v2-pack/.test(x.url));const perSecond=new Map();for(const x of packs){const k=Math.floor(x.t);perSecond.set(k,(perSecond.get(k)||0)+1);}
   const row={name,pass,ended:run.ended,frames:rows.length,trip_frames:active.length,detours:Math.max(0,...active.map(r=>r.trip[3])),blocked:Math.max(0,...active.map(r=>r.trip[4])),
    least_clearance:Math.min(...rows.map(r=>r.c[0])),least_clearance_body:rows.reduce((m,r)=>r.c[0]<m[0]?r.c:m,[Infinity,0])[1],
    bend_max:bend,bend_at:bendAt,turn_rate_jump_max:turnJump,
    end:{frame:end.frame,near:end.near,clear:end.clear,speed:end.speed,distance:Math.hypot(...end.p.slice(0,3)),lat,lon,from_place_rad:aimed,from_place_m:aimed===null?null:aimed*rr},
    still:{clear:last.clear,speed:last.speed},
    gpu_trip:q(active.flatMap(r=>r.gpu)),gpu_after:q(after_.filter(r=>r.t>run.ended+2).flatMap(r=>r.gpu)),
    settle_s:settled&&run.ended!==null?settled.t-run.ended:null,lag_at_arrival:after_[0]?.lag??null,shown_at_arrival:after_[0]?.shown??null,lag_last:last.lag,
    page_pack_requests:packs.length,page_requests:requests.length,server:serverCounts(wall0,wall1)};
   report.trips.push(row);writeFileSync(join(out,`${name}-${pass}.json`),JSON.stringify({row,rows},null,0));
   console.log(JSON.stringify(row));
  }
 }
}finally{await b.close();}
writeFileSync(join(out,'trips.json'),JSON.stringify(report,null,1));
