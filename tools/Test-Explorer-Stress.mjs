import {headless} from './Headless.mjs';
import {ready,capture,runFrames} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const directory=resolve(process.argv[2]||'evidence/local/explorer-stress');await mkdir(directory,{recursive:true});
const b=await headless(directory),report={browser:b.version,width:1920,height:1080,terrain_taa:false,cloud_history:false,cases:[],manifest:JSON.parse((await readFile('web/pkg/explorer-manifest.json','utf8')).replace(/^\uFEFF/,''))};
const save=()=>writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));
async function audit(name,image=true){const result=JSON.parse(await b.evaluate('solarExplorer.engine.audit_geometry()'));const stats=await b.evaluate('solarExplorer.stats()');const ok=result.balanced&&result.complete_face_area===6&&result.nonmanifold_edges===0&&result.boundary_edges===0&&result.unequal_shared_samples===0&&result.nonfinite_samples===0&&result.topology_overflow===0;report.cases.push({name,ok,stats,audit:result});if(image)await capture(b,resolve(directory,`${name}.png`));await save();console.log(name,ok,result.phase,result.morph);if(!ok)throw Error(`Geometry audit failed: ${name}`);}
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await b.send('Page.navigate',{url:'http://127.0.0.1:5198/explorer.html?test=1&body=procedural'});await ready(b);await b.evaluate('solarExplorer.resize(1920,1080);solarExplorer.engine.profiling(true);solarExplorer.configure({atmosphere:false,water:false,clouds:false});');
 report.cold=await runFrames(b,1);await audit('cold-complete');
 await b.evaluate('solarExplorer.go("ground")');
 // Freeze one adaptive transition and inspect forward and reverse endpoints.
 await runFrames(b,400);await audit('ground-ready');
 for(const [name,alt]of [['lod-forward',30],['lod-reverse',12]]){await b.evaluate(`{const n=solarExplorer.camera[0].map(x=>x/Math.hypot(...solarExplorer.camera[0]));const r=solarExplorer.engine.radius()+solarExplorer.engine.height(...n)+${alt};const d=solarExplorer.camera[1].map((x,i)=>x-solarExplorer.camera[0][i]);solarExplorer.camera=[n.map(x=>x*r),n.map((x,i)=>x*r+d[i])];}`);await runFrames(b,9);await audit(name);await runFrames(b,120);}
 for(const view of ['face-edge','corner','pole','horizon','antipode']){await b.evaluate(`solarExplorer.go(${JSON.stringify(view)})`);await runFrames(b,1);await audit(`${view}-cold`,false);await runFrames(b,180);await audit(view);}
 await b.evaluate('solarExplorer.go("ground");window.groundCamera=solarExplorer.camera.map(v=>[...v]);');
 report.descent=await runFrames(b,300,`{const t=i/299;const n=groundCamera[0].map(x=>x/Math.hypot(...groundCamera[0]));const alt=12+2e6*(1-t)**4;const r=solarExplorer.engine.radius()+solarExplorer.engine.height(...n)+alt;const d=groundCamera[1].map((x,j)=>x-groundCamera[0][j]);solarExplorer.camera=[n.map(x=>x*r),n.map((x,j)=>x*r+d[j])];}`);await audit('rapid-descent');
 // Cross a real 4096 m high-word boundary in both directions, no terrain AA.
 await b.evaluate('solarExplorer.go("ground");window.rebaseCamera=solarExplorer.camera.map(v=>[...v]);window.rebaseX=Math.round(rebaseCamera[0][0]/4096)*4096;');
 report.rebase=await runFrames(b,300,`{const d=(i<150?i-75:225-i)*0.02;solarExplorer.camera=rebaseCamera.map((v,k)=>k===2?v:v.map((x,j)=>j===0?x+rebaseX-rebaseCamera[0][0]+d:x));}`);await audit('rebase-return');
 // Exhaust both admission and generation without losing root coverage.
 await b.evaluate('solarExplorer.configure({seed:2027,patch_cap:6,generation_limit:0});solarExplorer.go("corner")');report.exhausted=await runFrames(b,120);await audit('pool-six-generation-zero');
 await b.evaluate('solarExplorer.configure({patch_cap:2240,generation_limit:18496,body:41,sector:["9223372036854775807","-9223372036854775808","24000000000"]});solarExplorer.go("ground")');await runFrames(b,350);await audit('body-sector-cut');
 await b.evaluate('solarExplorer.configure({edits:[[...solarExplorer.camera[0].map(x=>x/Math.hypot(...solarExplorer.camera[0])),100,12]]});solarExplorer.go("ground")');await runFrames(b,350);await audit('durable-radial-edit');
 report.invalid=await b.evaluate(`(async()=>{const old=solarExplorer.engine.settings();let rejected=0;for(const patch of [{patch_cap:100000},{edits:Array(17).fill([0,1,0,100,12])},{sector:['no','0','0']}]){try{await solarExplorer.configure(patch);}catch{rejected++;}}return{rejected,unchanged:solarExplorer.engine.settings()===old};})()`);
 await b.evaluate('solarExplorer.resize(960,540);');await runFrames(b,2);await b.evaluate('solarExplorer.resize(1920,1080);solarExplorer.configure({seed:2026,body:0,sector:["0","0","0"],edits:[],atmosphere:true,water:true,clouds:true});solarExplorer.go("rough");');await runFrames(b,600);
 // Real rAF cadence, separate from fence-paced throughput; never claim scanout.
 report.raf=await b.evaluate(`(async()=>{const rows=[],intervals=[];let last=0,submitted=0;const start=performance.now();for(let i=0;i<300;i++){const t=await new Promise(requestAnimationFrame);if(last)intervals.push(t-last);last=t;solarExplorer.time=i/60;const c=solarExplorer.camera;const d=c[1].map((v,j)=>v-c[0][j]);solarExplorer.camera=c.map((v,k)=>k===2?v:v.map((x,j)=>x+d[j]*0.0005));if(solarExplorer.step(1/60))submitted++;rows.push(...solarExplorer.telemetry());}while(solarExplorer.stats().pending)await new Promise(r=>setTimeout(r,0));rows.push(...solarExplorer.telemetry());return{wall_ms:performance.now()-start,intervals,submitted,rows,stats:solarExplorer.stats()};})()`);await audit('moving-full-frame');
 await b.evaluate('solarExplorer.engine.destroy_device()');await new Promise(r=>setTimeout(r,200));report.device_loss=await b.evaluate('solarExplorer.stats().device_lost');await b.send('Page.reload');await ready(b);await runFrames(b,1);report.recreated=await b.evaluate('solarExplorer.stats().device_lost===null');await save();
}finally{await b.close();}
