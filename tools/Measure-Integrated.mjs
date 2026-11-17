// Serial, source-identified browser runs. Each arm gets a fresh private browser.
// An immutable web snapshot makes baseline/candidate interleaving independent
// of rebuilding or changing the owner's preview server.
import {headless} from './Headless.mjs';
import {ready,runFrames,capture} from './Explorer-Test-Lib.mjs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute,extname} from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const dir=resolve(arg('output','evidence/local/performance-integrated/pairs'));
const width=+arg('width',1920),height=+arg('height',1080),frames=+arg('frames',300),warmup=+arg('warmup',360),rounds=+arg('rounds',2);
const queueDepth=+arg('queue-depth',1);if(![1,2].includes(queueDepth))throw Error('queue-depth must be 1 or 2');
const views=arg('views','forest,coast,clouds').split(','),modes=arg('modes','animated').split(',');
const arms=arg('arms','baseline,candidate').split(',');
const roots={baseline:resolve(arg('baseline','evidence/local/performance-integrated/baseline-web')),candidate:resolve(arg('candidate','web'))};
const quant=a=>{a=a.filter(Number.isFinite).sort((a,b)=>a-b);const q=p=>a[Math.min(a.length-1,Math.ceil(a.length*p)-1)]??null;return{n:a.length,p50:q(.5),p95:q(.95),p99:q(.99),max:a.at(-1)??null};};
const hash=b=>createHash('sha256').update(b).digest('hex');
const kinds=['display','shaded','water','cloud','position','normal'];
const gpu=()=>{try{return execFileSync('nvidia-smi',['--query-gpu=name,driver_version,utilization.gpu,memory.used,temperature.gpu,clocks.gr,power.draw','--format=csv'],{encoding:'utf8',windowsHide:true}).trim();}catch{return null;}};
await mkdir(dir,{recursive:true});
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm'};
const server=createServer(async(req,res)=>{try{const parts=new URL(req.url,'http://localhost').pathname.split('/').filter(Boolean),arm=parts.shift(),root=roots[arm];if(!root)throw Error('arm');const file=resolve(root,parts.join('/')||'index.html'),child=relative(root,file);if(child.startsWith('..')||isAbsolute(child))throw Error('path');res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const manifests={};for(const arm of arms){const manifest=JSON.parse((await readFile(resolve(roots[arm],'pkg/explorer-manifest.json'),'utf8')).replace(/^\uFEFF/,''));const wasm=hash(await readFile(resolve(roots[arm],'pkg/solar_explorer_bg.wasm')));if(wasm!==manifest.wasm_sha256)throw Error('WASM identity mismatch: '+arm);manifests[arm]={...manifest,wasm_sha256:wasm};}
const report={schema:1,backend:'BrowserWebGpu',command:process.argv,starting_commit:arg('starting-commit',null)??(await readFile('evidence/local/performance-integrated/starting-commit.txt','utf8')).trim(),created:new Date().toISOString(),output:[width,height],frames,warmup,rounds,queue_depth:queueDepth,manifests,gpu:gpu(),cases:[],pacing_definition:'One accepted submission, worker fence wait, metadata round trip. Completion is not physical scanout. Queue depth is recorded separately. Deterministic 1/60 s animation per accepted frame.',gates:{exact:{display_p99:0,hdr_p99:0,coverage_changes:0},approximate:{roi_relative_hdr_rmse:.01,roi_display_p99:2,roi_transmittance_p99:.01,opaque_coverage_changes:0,note:'Every occupied ROI and edge mask must pass; motion/visual review can reject a numerical pass.'}}};
if(process.argv.includes('--raf'))report.pacing_definition='Headless requestAnimationFrame loop with explicit queue depth; accepted submission intervals and rAF attempts are reported separately. Not physical display scanout. Animation advances 1/60 s per accepted frame.';
const save=()=>writeFile(resolve(dir,'report.json'),JSON.stringify(report));
await save();
try{
 for(let round=0;round<rounds;round++)for(const arm of (round%2?[...arms].reverse():arms)){
  const run=resolve(dir,`${round}-${arm}`);await mkdir(run,{recursive:true});const b=await headless(run);
  try{
   const start=performance.now();await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await b.send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/${arm}/?test=1&body=procedural${arg(arm+'-query','')}`});await ready(b);
   const startup={ready_ms:performance.now()-start,browser:b.version,compiler:await b.evaluate('solarExplorer.engine.startup()')};
   await b.evaluate(`solarExplorer.resize(${width},${height});solarExplorer.engine.profiling(true);solarExplorer.engine.frame_queue_depth(${queueDepth})`);
   const defaults={...await b.evaluate('solarExplorer.snapshot().settings'),...JSON.parse(arg('settings','{}')),...JSON.parse(arg(arm+'-settings','{}'))};
   // An arm may have its own views and a query, so a measured body can run against the baseline.
   for(const mode of modes)for(const view of arg(arm+'-views',null)?.split(',')??views){
    const special={tall:[5500,-.05,1,.3,.08,1],thin:[2200,.01,-1,.3,.08,1],inside:[3000,-.05,1,.3,.5,1],'terminator-day':[400000,-.6,1,.11,.08,1],'terminator-night':[400000,-.6,1,.11,.08,-1]}[view];
    await b.evaluate(`solarExplorer.configure(${JSON.stringify(defaults)});solarExplorer.go(${JSON.stringify(special?'clouds':view)});solarExplorer.time=0;`);
    if(special){const[alt,look,type,cover,sun,side]=special;await b.evaluate(`{const c=solarExplorer.camera,n=c[0].map(v=>v/Math.hypot(...c[0])),t=[-n[1],n[0],0].map(v=>v/Math.hypot(n[0],n[1])),eye=n.map(v=>v*(solarExplorer.engine.radius()+${alt}));solarExplorer.camera=[eye,eye.map((v,j)=>v+t[j]*${1000*side}+n[j]*${1000*look}),n];solarExplorer.configure({cloud_type:${type},cloud_cover:${cover},sun:n.map((v,j)=>v*${sun}+t[j]*${Math.sqrt(1-sun*sun)})});}`);}
    await b.evaluate('window.base=solarExplorer.camera.map(v=>[...v]);window.baseSun=[...solarExplorer.snapshot().settings.sun];solarExplorer.telemetry()');
    // A measured body first settles its pages: warmup then starts from the same state every round. An arm on the analytic body has none to wait for.
    const pageSettle=process.argv.includes('--settle-pages')&&arg(arm+'-query','').includes('body=')?await b.evaluate(`(async()=>{let quiet=0,i=0;for(;i<20000&&quiet<30;i++){while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));await new Promise(r=>setTimeout(r,2));const s=solarExplorer.stats(),l=s.data_lag,f=s.field||{};quiet=(l&&l.pages_uploaded>=1020&&l.pages_in_flight===0&&l.pages_queued===0&&!f.inFlight&&!f.queued)?quiet+1:0;}return{frames:i,quiet,lag:solarExplorer.stats().data_lag};})()`):null;
    const cold=await runFrames(b,warmup);
    await b.evaluate('solarExplorer.telemetry()');
    const paths={moving:'i*50/60',slow:'i*.05',fast:'i*150',stop:`Math.min(i,${Math.floor(frames/2)})*80`,border:'i*1600',lowfps:'i*10'};
    const shift=paths[mode];
    const update=`solarExplorer.time=${mode==='frozen'?'0':mode==='lowfps'?'i/5':'i/60'};${shift?`{const shift=${shift};solarExplorer.camera=base.map((v,k)=>k===2?v:v.map((x,j)=>x+(j===2?shift:0)));}`:''}${mode==='sun'?`solarExplorer.configure({sun:baseSun.map((v,j)=>v+(j===0?.00005*i:0))});`:''}${mode==='descent'?`{const n=base[0].map(v=>v/Math.hypot(...base[0]));solarExplorer.camera=base.map((v,k)=>k===2?v:v.map((x,j)=>x-n[j]*i*50));}`:''}${mode==='turn'?`{const n=base[0].map(v=>v/Math.hypot(...base[0])),d=base[1].map((v,j)=>v-base[0][j]),angle=i*Math.PI*2/${frames-1},cross=[n[1]*d[2]-n[2]*d[1],n[2]*d[0]-n[0]*d[2],n[0]*d[1]-n[1]*d[0]],dot=n.reduce((s,v,j)=>s+v*d[j],0);solarExplorer.camera=[base[0],base[0].map((v,j)=>v+d[j]*Math.cos(angle)+cross[j]*Math.sin(angle)+n[j]*dot*(1-Math.cos(angle))),n];}`:''}${mode==='rebase'?`if(i===${Math.floor(frames/2)})await solarExplorer.engine.audit_rebase(4096,-4096,4096);`:''}${mode==='cut'?`if(i===${Math.floor(frames/2)})solarExplorer.go('coast');`:''}`;
    let measured;
    const sequence=[];
    if(process.argv.includes('--sequence')){
     measured={rows:[],pacing:[]};
     for(let i=0;i<frames;i++){
      const code=update.replace(/\bi\b/g,String(i));
      const frame=mode==='lowfps'?await b.evaluate(`(async()=>{${code}const t=performance.now();while(!solarExplorer.step(.2))await new Promise(r=>setTimeout(r,0));await solarExplorer.engine.flush();return{rows:solarExplorer.telemetry(),pacing:[performance.now()-t],stats:solarExplorer.stats()};})()`):await runFrames(b,1,code);
      measured.rows.push(...frame.rows);measured.pacing.push(...frame.pacing);measured.stats=frame.stats;
      sequence.push({frame:i,snapshot:await b.evaluate('solarExplorer.snapshot()'),stats:frame.stats,progress:JSON.parse(await b.evaluate('solarExplorer.engine.audit_progress()'))});
      for(const kind of kinds)await capture(b,resolve(run,`${mode}-${view}-f${String(i).padStart(3,'0')}-${kind}.${kind==='display'?'png':'bin'}`),width,height,kind);
     }
    }else if(process.argv.includes('--raf')){
     measured=await b.evaluate(`(async()=>{const rows=[],pacing=[],raf=[];let accepted=0,attempted=0,last=0,lastAccepted=0;while(accepted<${frames}){const now=await new Promise(requestAnimationFrame);if(last)raf.push(now-last);last=now;const i=accepted;${update}attempted++;if(solarExplorer.step(1/60)){if(lastAccepted)pacing.push(now-lastAccepted);lastAccepted=now;accepted++;}rows.push(...solarExplorer.telemetry());}await solarExplorer.engine.flush();rows.push(...solarExplorer.telemetry());return{rows,pacing,raf,accepted,attempted,stats:solarExplorer.stats()};})()`);
    }else measured=await runFrames(b,frames,update);
    await b.evaluate('solarExplorer.engine.flush()');measured.rows.push(...await b.evaluate('solarExplorer.telemetry()'));
    if(measured.rows.some(r=>r.error)||measured.stats.device_lost)throw Error('GPU/timing failure: '+JSON.stringify(measured.rows.filter(r=>r.error)));
    const rows=measured.rows.filter(r=>r.gpu_ms),summary={gpu:quant(rows.map(r=>r.gpu_ms.reduce((a,b)=>a+b,0))),stages:Object.fromEntries(measured.stats.stage_names.map((name,i)=>[name,quant(rows.map(r=>r.gpu_ms[i]))])),cpu_schedule:quant(rows.map(r=>r.cpu_schedule_ms)),cpu_encode:quant(rows.map(r=>r.cpu_encode_ms)),fence_pacing:quant(measured.pacing),completion:quant(rows.map(r=>r.completion_ms-r.submit_ms)),cold_gpu:quant(cold.rows.filter(r=>r.gpu_ms).map(r=>r.gpu_ms.reduce((a,b)=>a+b,0))),cold_pacing:quant(cold.pacing)};
    summary.gpu_span=quant(rows.map(r=>r.gpu_span_ms));
    if(measured.raf){summary.raf_intervals=quant(measured.raf);summary.accepted_frame_intervals=quant(measured.pacing);summary.rejected_submissions=measured.attempted-measured.accepted;summary.fence_pacing=null;}
    summary.stage_sum_over_budget=rows.filter(r=>r.gpu_ms.reduce((a,b)=>a+b,0)>1000/60).length/Math.max(1,rows.length);
    const row={round,arm,view,mode,startup,pageSettle,summary,measured,cold,sequence,snapshot:await b.evaluate('solarExplorer.snapshot()'),gpu:gpu()};
    if(process.argv.includes('--capture')){for(const kind of kinds)await capture(b,resolve(run,`${mode}-${view}-${kind}.${kind==='display'?'png':'bin'}`),width,height,kind);}
    if(+arg('settle',0)>0){
     const settled=await runFrames(b,+arg('settle',0));
     row.settled={stats:settled.stats,progress:JSON.parse(await b.evaluate('solarExplorer.engine.audit_progress()')),scenery:JSON.parse(await b.evaluate('solarExplorer.engine.audit_scenery()'))};delete row.settled.scenery.objects;
     for(const kind of kinds)await capture(b,resolve(run,`${mode}-${view}-settled-${kind}.${kind==='display'?'png':'bin'}`),width,height,kind);
    }
    if(mode==='rebase')await b.evaluate('solarExplorer.engine.audit_rebase(0,0,0)');
    if(process.argv.includes('--audit')){row.shadows=JSON.parse(await b.evaluate('solarExplorer.engine.audit_shadows()'));row.scenery=JSON.parse(await b.evaluate('solarExplorer.engine.audit_scenery()'));row.geometry=JSON.parse(await b.evaluate('solarExplorer.engine.audit_geometry()'));}
    report.cases.push(row);await save();console.log(JSON.stringify({round,arm,mode,view,gpu:summary.gpu,pacing:summary.fence_pacing}));
   }
  }finally{await b.close();}
 }
}finally{await new Promise(ok=>server.close(ok));}
