import {headless} from './Headless.mjs';
import {ready,runFrames,capture} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const dir=resolve(process.argv[2]||'evidence/local/extreme-motion');await mkdir(dir,{recursive:true});const b=await headless(dir);
const report={terrain_taa:false,history:false,clips:[],manifest:JSON.parse((await readFile('web/pkg/explorer-manifest.json','utf8')).replace(/^\uFEFF/,''))};
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await b.send('Page.navigate',{url:'http://127.0.0.1:5198/explorer.html?test=1&body=procedural'});await ready(b);
 await b.evaluate('solarExplorer.resize(1920,1080);solarExplorer.configure({clouds:false,water:false,atmosphere:true});solarExplorer.engine.profiling(true);');
 for(const name of ['sideways','descent']){
  await b.evaluate('solarExplorer.go("ground");window.base=solarExplorer.camera;');await runFrames(b,360);
  await b.evaluate(`window.chunks=[];window.recorder=new MediaRecorder(document.getElementById('world').captureStream(60),{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:10000000});recorder.ondataavailable=e=>chunks.push(e.data);recorder.start();`);
  const samples=[];
  for(let block=0;block<5;block++){
   samples.push(await b.evaluate(`(async()=>{const rows=[],intervals=[];let previous=0;for(let j=0;j<60;j++){const i=${block}*60+j,t=await new Promise(requestAnimationFrame);if(previous)intervals.push(t-previous);previous=t;const n=base[0].map(v=>v/Math.hypot(...base[0]));const d=base[1].map((v,k)=>v-base[0][k]);let e,target;if(${JSON.stringify(name)}==='descent'){e=n.map(v=>v*(solarExplorer.engine.radius()+solarExplorer.engine.height(...n)+12+1600000*(1-Math.min(i,119)/119)));target=e.map((v,k)=>v+d[k]);}else{let f=d.map((v,k)=>v-n[k]*d.reduce((a,x,l)=>a+x*n[l],0));const length=Math.hypot(...f);f=f.map(v=>v/length);const angle=Math.min(i,119)/119*1600000/solarExplorer.engine.radius(),radial=n.map((v,k)=>v*Math.cos(angle)+f[k]*Math.sin(angle)),forward=f.map((v,k)=>v*Math.cos(angle)-n[k]*Math.sin(angle));e=radial.map(v=>v*(solarExplorer.engine.radius()+solarExplorer.engine.height(...radial)+12));target=e.map((v,k)=>v+forward[k]*1000-radial[k]*180);}solarExplorer.camera=[e,target,n];solarExplorer.time=i/60;solarExplorer.step(1/60);rows.push(...solarExplorer.telemetry());}while(solarExplorer.stats().pending)await new Promise(r=>setTimeout(r,0));return{rows,intervals,stats:solarExplorer.stats()};})()`));
   await capture(b,resolve(dir,`${name}-${block}.png`));
  }
  const bytes=await b.evaluate('(async()=>{await new Promise(ok=>{recorder.onstop=ok;recorder.stop()});const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());let s="";for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s)})()');await writeFile(resolve(dir,`${name}.webm`),Buffer.from(bytes,'base64'));report.clips.push({name,samples});await writeFile(resolve(dir,'report.json'),JSON.stringify(report));console.log(name);
 }
}finally{await b.close();}
