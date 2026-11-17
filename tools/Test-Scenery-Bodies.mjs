// Rocks on bodies without plants (docs/SCENERY.md, "Bodies without plants"): the solar path flies low over each body with
// a low Sun, waits for its pages, and records the scenery counters, a still, and the audit's rock sizes. Gates: rocks are
// present, no tree is drawn, the footprint check finds no floating rock. Private headless browser, replayed tiles.
//   node tools/Test-Scenery-Bodies.mjs --out $SOLAR_DATA/.../bodies [--stops 301:40:12,499:40:12] [--port 5220]
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tileServer,headless,ready} from './Earth-Test-Lib.mjs';
import {capture,runFrames} from './Explorer-Test-Lib.mjs';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const dir=resolve(arg('out','evidence/local/scenery-bodies'));mkdirSync(dir,{recursive:true});
const stops=arg('stops','301:40:12,301:40:35,499:40:12,199:40:15').split(',').map(s=>s.split(':').map(Number));
const server=await tileServer({port:+arg('port',5220),web:arg('web','web')});
const b=await headless(resolve(dir,'.profile'));const W=+arg('width',1280),H=+arg('height',720),T=852076800;
const report={stops:[]};
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:false});
 await b.send('Page.navigate',{url:`${server.base}/explorer.html?test=1&body=solar&tiles=${encodeURIComponent(server.base)}&quality=high&limits=off&tdb=${T}`});
 await ready(b);await b.evaluate(`solarExplorer.resize(${W},${H});solarExplorer.engine.profiling(true)`);
 for(const [id,height,elevation] of stops){
  await b.evaluate(`solarFlight.flight.set_rate(0);solarFlight.flight.jump_low_sun(${id},${height},${elevation})`);
  const s=await b.evaluate(`(async()=>{const K=new Set();let stats=null;let frames=0;for(;frames<4000;frames++){solarExplorer.camera=solarFlight.frame(1/60,K,100);while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));stats=solarExplorer.stats();if(stats.solar.surface_shown&&stats.data_lag.pages_in_flight===0&&frames>60)break;}for(let i=0;i<400;i++){solarExplorer.camera=solarFlight.frame(1/60,K,100);while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));}while(solarExplorer.stats().pending)await new Promise(r=>setTimeout(r,0));stats=solarExplorer.stats();return {frames,body:stats.body,scenery:stats.scenery,settings:JSON.parse(solarExplorer.engine.settings())};})()`);
  const a=JSON.parse(await b.evaluate('solarExplorer.engine.audit_scenery()'));
  const sizes=a.objects.filter(o=>o.kind===2&&o.drawn).map(o=>o.shape[0]*2).sort((x,y)=>x-y);
  const trees=a.objects.filter(o=>o.kind===1).length;
  const name=`${s.body}-${height}-sun${elevation}`;await capture(b,join(dir,`${name}.png`),W,H);
  const q=p=>sizes.length?+sizes[Math.floor((sizes.length-1)*p)].toFixed(2):null;
  const row={name,body:s.body,rocks_on:s.settings.rocks,trees_on:s.settings.trees,resident_rocks:s.scenery?.rocks,drawn_rocks:sizes.length,trees_listed:trees,diameter_m:{p50:q(.5),p90:q(.9),max:q(1)},cover:s.scenery?.cover,footprint:a.footprint_reference&&{checked:a.footprint_reference.checked,max_gap_m:a.footprint_reference.max_gap_m,p95_gap_m:a.footprint_reference.p95_gap_m},contact:a.contact_reference};
  row.gates={rocks_present:sizes.length>0,no_trees:trees===0,no_floating:!(a.footprint_reference?.max_gap_m>0.05)};
  report.stops.push(row);console.log(JSON.stringify(row));writeFileSync(join(dir,'report.json'),JSON.stringify(report,null,1));
 }
}finally{await b.close();server.close();}
process.exit(0);
