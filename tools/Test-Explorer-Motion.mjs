import {headless} from './Headless.mjs';
import {ready,capture,runFrames} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const directory=resolve(process.argv[2]||'evidence/local/explorer-motion');await mkdir(directory,{recursive:true});const b=await headless(directory);
const report={browser:b.version,terrain_taa:false,cloud_history:false,clips:[],manifest:JSON.parse((await readFile('web/pkg/explorer-manifest.json','utf8')).replace(/^\uFEFF/,''))};
try{await b.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await b.send('Page.navigate',{url:'http://127.0.0.1:5198/?test=1&body=procedural'});await ready(b);await b.evaluate('solarExplorer.resize(1920,1080);solarExplorer.engine.profiling(true);solarExplorer.configure({clouds:false,atmosphere:false,water:false});solarExplorer.go("ground");');await runFrames(b,650);
 await runFrames(b,1,'solarExplorer.time=0;');const base=await capture(b,resolve(directory,'rebase-before.bin'),1920,1080,'position');
 await b.evaluate('solarExplorer.engine.audit_rebase(4096,-4096,4096)');await runFrames(b,1);const other=await capture(b,resolve(directory,'rebase-after.bin'),1920,1080,'position');
 let max=0,changedCoverage=0,count=0;const errors=[];for(let i=0;i<base.length;i+=16){const a=[0,4,8].map(j=>base.readFloatLE(i+j)),c=[0,4,8].map(j=>other.readFloatLE(i+j));const da=Math.hypot(...a),dc=Math.hypot(...c);if((da>0)!==(dc>0)){changedCoverage++;continue;}if(da>0&&da<500){const d=Math.hypot(...a.map((x,j)=>x-c[j]));max=Math.max(max,d);errors.push(d);count++;}}
 errors.sort((a,c)=>a-c);report.rebase={near_pixels:count,scope:'same camera and terrain, anchor shifted by [4096,-4096,4096]; pixels within 500 m',max_position_delta_m:max,p99_delta_m:errors[Math.floor(errors.length*.99)],changedCoverage,gate_pass:max<.002&&changedCoverage===0};await b.evaluate('solarExplorer.engine.audit_rebase(0,0,0)');
 for(const name of ['ground-forward-reverse','face-crossing','descent-full']){
  await b.evaluate(`solarExplorer.go(${JSON.stringify(name==='face-crossing'?'face-edge':'ground')});solarExplorer.configure({atmosphere:${name==='descent-full'},clouds:${name==='descent-full'},water:${name==='descent-full'}});window.motionBase=solarExplorer.camera.map(v=>[...v]);window.motionStart=solarExplorer.stats().completed;window.chunks=[];window.recorder=new MediaRecorder(document.getElementById('world').captureStream(30),{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:6000000});recorder.ondataavailable=e=>chunks.push(e.data);recorder.start();`);
  const snapshots=[];
  for(let block=0;block<5;block++){
   const r=await b.evaluate(`(async()=>{const rows=[],intervals=[];let last=0;for(let j=0;j<60;j++){const i=${block}*60+j;const t=await new Promise(requestAnimationFrame);if(last)intervals.push(t-last);last=t;const c=motionBase,n=c[0].map(x=>x/Math.hypot(...c[0])),d=c[1].map((x,k)=>x-c[0][k]);let offset;
    if(${JSON.stringify(name)}==='ground-forward-reverse'){offset=d.map(x=>x*(i<150?i:300-i)*.001);solarExplorer.camera=c.map((v,j)=>j===2?v:v.map((x,k)=>x+offset[k]));}
    else if(${JSON.stringify(name)}==='face-crossing'){offset=[(i-150)*150,-(i-150)*150,0];solarExplorer.camera=c.map((v,j)=>j===2?v:v.map((x,k)=>x+offset[k]));}
    else{const radius=solarExplorer.engine.radius()+solarExplorer.engine.height(...n)+12+2e6*(1-i/299)**4;solarExplorer.camera=[n.map(x=>x*radius),n.map((x,k)=>x*radius+d[k])];}
    solarExplorer.time=i/60;solarExplorer.step(1/60);rows.push(...solarExplorer.telemetry());}while(solarExplorer.stats().pending)await new Promise(r=>setTimeout(r,0));return{rows,intervals,stats:solarExplorer.stats()};})()`);snapshots.push(r);await capture(b,resolve(directory,`${name}-${block}.png`));
  }
  const video=await b.evaluate('(async()=>{await new Promise(ok=>{recorder.onstop=ok;recorder.stop()});const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());let s="";for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);})()');await writeFile(resolve(directory,`${name}.webm`),Buffer.from(video,'base64'));report.clips.push({name,snapshots});await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));console.log(name);
 }
}finally{await b.close();}
