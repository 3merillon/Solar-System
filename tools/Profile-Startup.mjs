// Cold-profile startup trace of a URL (default: the app's default page, solar free-flying camera).
// Private headless browser with a fresh profile, so the browser shader and HTTP
// caches start empty unless --warm runs a second navigation in the same profile.
// Records stage transitions, every pipeline's compile time and lane, network
// resources, first image and ready. Usage:
//   node tools/Profile-Startup.mjs [outDir] [--url=/?test=1] [--base=http://127.0.0.1:5198] [--warm]
import {headless} from './Headless.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
const dir=process.argv.slice(2).find(a=>!a.startsWith('--'))||'evidence/local/startup/profile';
const path=(process.argv.find(a=>a.startsWith('--url='))||'--url=/').slice(6);
const url=(process.argv.find(a=>a.startsWith('--base='))||'--base=http://127.0.0.1:5198').slice(7).replace(/\/$/,'')+path;
await mkdir(dir,{recursive:true});
const b=await headless(dir);
async function run(label){
 const previous=await b.evaluate('performance.timeOrigin');await b.send('Page.navigate',{url});const started=performance.now();
 for(let i=0;i<100;i++){if(await b.evaluate('performance.timeOrigin').catch(()=>previous)!==previous)break;await new Promise(r=>setTimeout(r,20));}
 const stages=[];let last='';let full_ms=null;
 for(let i=0;i<2400;i++){
  const s=await b.evaluate('(()=>({ready:!!window.explorerReady,first:window.solarFirstImage??null,error:window.explorerFailure,stage:window.solarStartup?.stage,detail:window.solarStartup?.detail}))()').catch(()=>({}));
  if(s.ready&&full_ms==null)full_ms=performance.now()-started;
  if(s.error)throw Error(s.error);
  const key=`${s.stage}|${s.detail}`;
  if(key!==last){last=key;stages.push({s:+((performance.now()-started)/1000).toFixed(2),stage:s.stage,detail:s.detail});}
  if(s.ready)break;
  if(performance.now()-started>240000)break;
  await new Promise(r=>setTimeout(r,100));
 }
 const observed_ms=performance.now()-started,ready_ms=full_ms;
 const out=await b.evaluate(`(async()=>{const r=globalThis.solarExplorer?.startup?await solarExplorer.startup():null;
   const res=performance.getEntriesByType('resource').map(e=>({name:e.name.replace(location.origin,''),start:Math.round(e.startTime),dur:Math.round(e.duration),bytes:e.transferSize,body:e.decodedBodySize}));
   const nav=performance.getEntriesByType('navigation')[0];
   return {first_image_ms:window.solarFirstImage??null,startup:r,events:window.solarStartup?.events??null,resources:res,dcl:nav?.domContentLoadedEventEnd,load:nav?.loadEventEnd,device:await solarExplorer.device(),settings:solarExplorer.snapshot(),stats:solarExplorer.stats(),heartbeat:window.startupHeartbeat,longtasks:window.startupLongtasks};})()`);
 const manifest=JSON.parse((await (await fetch(new URL('pkg/explorer-manifest.json',url))).text()).replace(/^\uFEFF/,''));
 const report={label,url,browser:b.version,manifest,ready_ms,observed_ms,stages,...out};
 await writeFile(`${dir}/${label}.json`,JSON.stringify(report,null,1));
 const p=(out.startup?.pipelines||[]).slice().sort((a,b)=>b.ms-a.ms);
 console.log(JSON.stringify({label,ready_ms:Math.round(ready_ms),first_image_ms:out.first_image_ms&&Math.round(out.first_image_ms),bridge_first_ms:out.startup?.first_ms&&Math.round(out.startup.first_ms),compile_ms:out.startup?.compile_ms&&Math.round(out.startup.compile_ms),lanes:out.startup?.concurrency,n:p.length,
  top:p.slice(0,16).map(x=>`${x.name}${x.deferred?'*':''} ${Math.round(x.ms)}ms ${Math.round(x.source_bytes/1024)}k`)}));
 console.log(stages.map(s=>`${s.s}s ${s.stage} :: ${s.detail?.slice(0,80)}`).join('\n'));
 console.log(out.resources.filter(r=>r.dur>150||r.body>500000).map(r=>`${r.start}+${r.dur}ms ${r.bytes}B ${r.name}`).join('\n'));
}
try{
 await b.send('Page.enable');
 await b.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
 await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.startupHeartbeat=[];window.startupLongtasks=[];let previous=performance.now();setInterval(()=>{const now=performance.now();startupHeartbeat.push(now-previous);previous=now;},50);new PerformanceObserver(list=>{for(const e of list.getEntries())startupLongtasks.push({start:e.startTime,duration:e.duration});}).observe({type:'longtask',buffered:true});`});
 await run('cold');
 if(process.argv.includes('--warm'))await run('warm');
}finally{await b.close();}
