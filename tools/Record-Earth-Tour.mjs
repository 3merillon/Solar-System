// Record the fixed tour's tiles once, gently, for every later replay. Explicitly invoked only.
// The recorder enforces an allow list, at most four concurrent fetches and a hard request budget,
// and tiles already on disk cost nothing, so an interrupted run resumes.
import {tileServer,earthBrowser,settle,toEye,heading} from './Earth-Test-Lib.mjs';
import {capture} from './Explorer-Test-Lib.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const budget=+arg('max-requests',0);if(!(budget>0))throw Error('--max-requests is required');
const dir=resolve(arg('output','evidence/local/real-earth/runs/record'));await mkdir(dir,{recursive:true});
const tour=JSON.parse(await readFile('tools/fixtures/earth-tour.json','utf8'));
const only=arg('stops',null)?.split(',');
const stops=tour.stops.filter(s=>!only||only.includes(s.name));
const server=await tileServer({record:true,maxRequests:budget});
const report={budget,stops:[]};
let b;
try{
 b=await earthBrowser(dir,server,{view:'earth-orbit',width:1280,height:720});
 await b.evaluate(`solarExplorer.configure({clouds:false})`);
 for(const stop of stops){
  const eye=toEye(stop.lon,stop.lat,stop.alt),f=heading(stop.lon,stop.lat,stop.heading);
  await b.evaluate(`solarExplorer.camera=${JSON.stringify([eye,eye.map((v,i)=>v+f[i]*1000)])};`);
  const t0=Date.now(),s=await settle(b,{maxFrames:+arg('frames',60000)});
  const stats=await server.stats();
  const row={stop:stop.name,seconds:(Date.now()-t0)/1000,frames:s.frames,quiet:s.quiet,lag:s.lag,upstreamFetches:stats.upstreamFetches,upstreamBytes:stats.upstreamBytes,status:stats.status??stats.perStatus};
  report.stops.push(row);
  console.log(JSON.stringify({stop:stop.name,seconds:+row.seconds.toFixed(1),quiet:row.quiet,pages:s.lag?.pages_resident,failed:s.lag?.pages_failed,missing:s.lag?.pages_not_found,overflow:s.lag?.pool_overflow,upstream:stats.upstreamFetches,mb:+(stats.upstreamBytes/1048576).toFixed(1)}));
  await capture(b,resolve(dir,`${stop.name}.png`),1280,720);
  await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,1));
  if(stats.upstreamFetches>=budget){console.log('budget reached, stopping');break;}
 }
}finally{if(b)await b.close();server.close();}
