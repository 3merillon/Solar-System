// Descend through the same frozen bank with and without the reduced far pass.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {earthBrowser,tileServer,heading,toEye} from './Earth-Test-Lib.mjs';
import {runFrames,capture} from './Explorer-Test-Lib.mjs';
const [dir='evidence/local/cloud-horizon',web='web']=process.argv.slice(2);
await mkdir(dir,{recursive:true});
const width=512,height=288,server=await tileServer({port:5283,web});
const half=n=>(n>>10&31)?(1+(n&1023)/1024)*2**((n>>10&31)-15):(n&1023)*2**-24;
let browser;
try{
 browser=await earthBrowser(dir,server,{width,height});
 await browser.evaluate('solarExplorer.time=0;solarExplorer.configure({cloud_scale:1,cloud_steps:64,cloud_speed:0,cloud_evolution:0,cloud_history:false,cloud_cover:.48,cloud_type:1,scenery_density:0,auto_exposure:false})');
 const snapshots=[],report=[],tops=[];let above;
 for(const far of [1,2]){
  await browser.evaluate('solarExplorer.configure({cloud_far_scale:'+far+'})');
  for(const [i,alt] of [9000,6000,4200,3600,3450,3300,3150,3000,2850,2700,2550,2400,1500].entries()){
   const eye=toEye(-32,30,alt),forward=heading(-32,30,35,-.035),side=heading(-32,30,125,0),up=eye.map((v,j)=>v/Math.hypot(...eye)+.14*side[j]);
   await browser.evaluate('solarExplorer.camera='+JSON.stringify([eye,eye.map((v,k)=>v+1000*forward[k]),up]));await runFrames(browser,i===0?24:2);
   const raw=await capture(browser,dir+'/cloud.bin',width,height,'cloud'),alpha=[];
   assert.equal(raw.length,width*height*8);
   for(let y=95;y<183;y++)for(let x=4;x<width-4;x++)alpha.push(half(raw.readUInt16LE((y*width+x)*8+6)));
   if(i===0||i===4||i===10){const picture=await capture(browser,dir+'/far'+far+'-'+alt+'.png',width,height);if(i===0){above=[eye,eye.map((v,k)=>v+1000*forward[k]),up];tops.push(picture);}}
   if(far===1){snapshots.push(alpha);continue;}
   const diff=alpha.map((a,k)=>Math.abs(a-snapshots[i][k])).sort((a,b)=>a-b);
   report.push({alt,partial:alpha.filter(v=>v>.02&&v<.98).length,mean:diff.reduce((s,x)=>s+x,0)/diff.length,p95:diff[Math.floor(.95*diff.length)]});
  }
 }
 await browser.evaluate('solarExplorer.resize('+2*width+','+2*height+');solarExplorer.camera='+JSON.stringify(above)+';solarExplorer.configure({cloud_far_scale:1,cloud_steps:128})');await runFrames(browser,30);
 const reference=await capture(browser,dir+'/double-resolution.png',2*width,2*height);
 const edge=[];
 for(let x=12;x<width-12;x++){
  let best=0,row=0;
  const average=y=>{const i=(2*y*width*2+2*x)*4;return (reference[i]+reference[i+4]+reference[i+width*8]+reference[i+width*8+4])/4;};
  for(let y=82;y<height-30;y++){const delta=average(y+1)-average(y-1);if(delta>best){best=delta;row=y;}}
  if(best>10)for(let y=row-2;y<=row+2;y++){const n=(y*width+x)*4;edge.push(tops.map(buf=>Math.abs(average(y)-buf[n])));}
 }
 const limb={samples:edge.length,fullError:edge.reduce((v,e)=>v+e[0],0)/edge.length,splitError:edge.reduce((v,e)=>v+e[1],0)/edge.length};
 await writeFile(dir+'/report.json',JSON.stringify({descent:report,limb},null,2));console.table(report);console.log(limb);
 assert.ok(limb.fullError<4 && limb.splitError<4,'both horizon reconstructions should match the supersampled edge');
 assert.ok(edge.length>500,'the rendered reference must contain a sloping cloud edge');
 assert.ok(report.some(r=>r.partial>500),'the descent must cross a visible bank');
 assert.ok(report.every(r=>r.mean<.025&&r.p95<.12),'switching far resolution changed the cloud bank');
}finally{try{await browser?.close();}finally{server.close();}}
