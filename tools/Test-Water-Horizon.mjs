// Water and cloud compositing on a grazing, dry mountainside above Lake Geneva.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {earthBrowser,tileServer,heading,toEye} from './Earth-Test-Lib.mjs';
import {runFrames,capture} from './Explorer-Test-Lib.mjs';
const [dir='evidence/local/water-horizon']=process.argv.slice(2),W=640,H=360;
await mkdir(dir,{recursive:true});
const server=await tileServer({port:5291});let b;
try{
 b=await earthBrowser(dir,server,{width:W,height:H});
 const eye=toEye(6.89,46.39,1800),forward=heading(6.89,46.39,130,-.04);
 const camera=[eye,eye.map((v,i)=>v+1000*forward[i]),eye.map(v=>v/Math.hypot(...eye))];
 await b.evaluate('solarExplorer.camera='+JSON.stringify(camera)+';solarExplorer.time=0;solarExplorer.configure({cloud_speed:0,cloud_evolution:0,auto_exposure:false,wave_height:0,scenery_density:0,ground_cover:false,buildings:false,taa:false})');
 await runFrames(b,360);
 const report=[];
 for(const clouds of [false,true]){
  await b.evaluate('solarExplorer.configure({water:true,clouds:'+clouds+'})');await runFrames(b,40);
  const get=k=>capture(b,dir+'/'+k+'.bin',W,H,k);
  const medium=await get('water'),ground=await get('position'),proxy=await get('ocean'),wet=await capture(b,dir+'/on-'+clouds+'.png',W,H);
  await b.evaluate('solarExplorer.configure({water:false})');await runFrames(b,40);
  const dry=await capture(b,dir+'/off-'+clouds+'.png',W,H);
  const differences=[];let rejected=0;
  for(let y=H*.25|0;y<H*.75;y++)for(let x=2;x<W-2;x++){
   const i=y*W+x;
   if(medium.readUInt16LE(i*8+6)!==0x3c00)continue;
   const distance=Math.hypot(...[0,4,8].map(o=>ground.readFloatLE(i*16+o)));if(distance<500)continue;
   const water=Math.abs(proxy.readFloatLE(i*8));if(water>0&&water<distance)rejected++;
   differences.push(Math.max(...[0,1,2].map(k=>Math.abs(wet[i*4+k]-dry[i*4+k]))));
  }
  differences.sort((a,b)=>a-b);
  const row={clouds,dryMountainPixels:differences.length,rejected,p99:differences[Math.floor(.99*differences.length)],max:differences.at(-1)};
  report.push(row);console.log(row);
 }
 await writeFile(dir+'/report.json',JSON.stringify(report,null,2));
 assert.ok(report.every(r=>r.dryMountainPixels>4000&&r.p99<=2),'a dry ridge should retain its colour when water is enabled');
}finally{try{await b?.close();}finally{server.close();}}
