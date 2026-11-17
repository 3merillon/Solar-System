// Real rAF recordings; captures are visual evidence, not display-scanout timings.
import {headless} from './Headless.mjs';
import {ready,capture,runFrames} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const dir=resolve(process.argv[2]||'evidence/local/scenery-motion');await mkdir(dir,{recursive:true});const b=await headless(dir);const report={browser:b.version,terrain_taa:false,cloud_history:false,clips:[],manifest:JSON.parse((await readFile('web/pkg/explorer-manifest.json','utf8')).replace(/^\uFEFF/,''))};
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await b.send('Page.navigate',{url:'http://127.0.0.1:5198/?test=1&body=procedural'});await ready(b);await b.evaluate('solarExplorer.resize(1920,1080);solarExplorer.engine.profiling(true);solarExplorer.configure({cloud_history:false});');
 for(const name of ['forest','conifers','canopy','coast']){
  await b.evaluate(`solarExplorer.go(${JSON.stringify(name)});solarExplorer.time=0;`);await runFrames(b,240);
  await b.evaluate(`window.motionBase=solarExplorer.camera.map(v=>[...v]);window.chunks=[];window.recorder=new MediaRecorder(document.getElementById('world').captureStream(30),{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:8000000});recorder.ondataavailable=e=>chunks.push(e.data);recorder.start();`);
  const result=await b.evaluate(`(async()=>{const rows=[],intervals=[],checkpoints=[];let last=0,submitted=0;for(let i=0;i<360;i++){const now=await new Promise(requestAnimationFrame);if(last)intervals.push(now-last);last=now;const c=motionBase,n=c[0].map(x=>x/Math.hypot(...c[0])),d=c[1].map((x,j)=>x-c[0][j]);let camera;
    if(${JSON.stringify(name)}==='conifers'){const a=2*Math.PI*i/359,cr=[n[1]*d[2]-n[2]*d[1],n[2]*d[0]-n[0]*d[2],n[0]*d[1]-n[1]*d[0]],dot=n.reduce((s,x,j)=>s+x*d[j],0);camera=[c[0],c[0].map((x,j)=>x+d[j]*Math.cos(a)+cr[j]*Math.sin(a)+n[j]*dot*(1-Math.cos(a))),n];}
    else if(${JSON.stringify(name)}==='canopy'){const t=i<180?i/179:(359-i)/179,offset=d.map(x=>x*t*.8);camera=c.map((v,k)=>k===2?v:v.map((x,j)=>x+offset[j]+n[j]*Math.sin(t*Math.PI)*120));}
    else if(${JSON.stringify(name)}==='coast'){const t=i/359,eye=c[0].map((x,j)=>x-n[j]*(25+Math.sin(t*2*Math.PI)*1.4));camera=[eye,eye.map((x,j)=>x+d[j]),n];}
    else{const t=i<180?i/179:(359-i)/179,offset=d.map(x=>x*t*.045);camera=c.map((v,k)=>k===2?v:v.map((x,j)=>x+offset[j]));}
    solarExplorer.camera=camera;solarExplorer.time=i/60;if(solarExplorer.step(1/60))submitted++;rows.push(...solarExplorer.telemetry());if(i%60===0)checkpoints.push({i,snapshot:solarExplorer.snapshot(),stats:solarExplorer.stats()});}
    while(solarExplorer.stats().pending)await new Promise(r=>setTimeout(r,0));return{rows,intervals,submitted,checkpoints,stats:solarExplorer.stats(),snapshot:solarExplorer.snapshot()};})()`);
  const video=await b.evaluate('(async()=>{await new Promise(ok=>{recorder.onstop=ok;recorder.stop()});const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());let s="";for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);})()');await writeFile(resolve(dir,`${name}.webm`),Buffer.from(video,'base64'));await capture(b,resolve(dir,`${name}.png`));report.clips.push({name,...result});await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,2));console.log(name);
 }
}finally{await b.close();}
