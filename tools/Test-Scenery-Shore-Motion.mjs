// Reproduce the owner's rolled shoreline flight with every water effect enabled.
import {headless} from './Headless.mjs';
import {ready,capture,runFrames} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const dir=resolve(process.argv[2]||'evidence/local/scenery-shore-motion');await mkdir(dir,{recursive:true});
const b=await headless(dir),report={cases:[],terrain_taa:false,cloud_history:false,manifest:JSON.parse((await readFile('web/pkg/explorer-manifest.json','utf8')).replace(/^\uFEFF/,''))};
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await b.send('Page.navigate',{url:'http://127.0.0.1:5198/?test=1&body=procedural'});await ready(b);
 const source=JSON.parse(await readFile('evidence/local/scenery-water-edges-release/report.json','utf8')).cases.find(c=>c.name==='rolled-shore').snapshot;
 await b.evaluate(`solarExplorer.resize(1920,1080);solarExplorer.engine.profiling(true);solarExplorer.configure(${JSON.stringify(source.settings)});solarExplorer.camera=${JSON.stringify(source.camera)};solarExplorer.time=19;window.c=solarExplorer.camera.map(v=>[...v]);window.n=c[0].map(x=>x/Math.hypot(...c[0]));window.d=c[1].map((x,j)=>x-c[0][j]);window.right=[d[1]*n[2]-d[2]*n[1],d[2]*n[0]-d[0]*n[2],d[0]*n[1]-d[1]*n[0]];{const l=Math.hypot(...right);right=right.map(x=>x/l);}`);
 await runFrames(b,360);
 await b.evaluate(`window.chunks=[];window.recorder=new MediaRecorder(document.getElementById('world').captureStream(30),{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:8000000});recorder.ondataavailable=e=>chunks.push(e.data);recorder.start();`);
 for(let block=0;block<4;block++){
  const run=await runFrames(b,60,`{const progress=(${block}*60+i)/239,offset=300*Math.sin(progress*Math.PI*2),eye=c[0].map((x,j)=>x+right[j]*offset),a=.4*Math.sin(progress*Math.PI*2-.8),v=d.map(x=>x/Math.hypot(...d)),cross=[v[1]*n[2]-v[2]*n[1],v[2]*n[0]-v[0]*n[2],v[0]*n[1]-v[1]*n[0]],h=v.reduce((s,x,j)=>s+x*n[j],0),up=n.map((x,j)=>x*Math.cos(a)+cross[j]*Math.sin(a)+v[j]*h*(1-Math.cos(a)));solarExplorer.camera=[eye,eye.map((x,j)=>x+d[j]),up];solarExplorer.time=19+progress*4;}`);
  await capture(b,resolve(dir,`shore-${block}.png`));report.cases.push({block,run,snapshot:await b.evaluate('solarExplorer.snapshot()')});
 }
 const video=await b.evaluate('(async()=>{await new Promise(ok=>{recorder.onstop=ok;recorder.stop()});const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());let s="";for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);})()');await writeFile(resolve(dir,'shore.webm'),Buffer.from(video,'base64'));
 await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({dir,submitted:240}));
}finally{await b.close();}
