// Isolate the opaque ground/sky edge, then compare its stability and
// coverage with a separately rasterized double-resolution image.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {headless} from './Headless.mjs';
import {ready,runFrames,capture} from './Explorer-Test-Lib.mjs';
import {heading,toEye} from './Earth-Test-Lib.mjs';
const [dir='evidence/local/skyline-aa',base='http://127.0.0.1:5198/']=process.argv.slice(2);
await mkdir(dir,{recursive:true});
const W=640,H=360,b=await headless(dir);
const half=Float32Array.from({length:65536},(_,n)=>(n&32768?-1:1)*((n&31744)?(1+(n&1023)/1024)*2**((n>>10&31)-15):(n&1023)*2**-24));
const value=(buf,i)=>half[buf.readUInt16LE(8*i+2)];
try{
 await b.send('Page.navigate',{url:new URL('?test=1&body=procedural&quality=high',base).href});await ready(b);
 const radius=await b.evaluate('solarExplorer.engine.radius()'),lon=21,lat=16,eye=toEye(lon,lat,9000,radius);
 const fw=heading(lon,lat,42,-.065),side=heading(lon,lat,132,0),up=eye.map((v,i)=>v/Math.hypot(...eye)+.14*side[i]);
 await b.evaluate('solarExplorer.camera='+JSON.stringify([eye,eye.map((v,i)=>v+1000*fw[i]),up])+';solarExplorer.time=0;solarExplorer.configure({taa:true,clouds:false,water:false,atmosphere:false,scenery_density:0,ground_cover:false,trees:false,rocks:false,buildings:false,bloom:false,auto_exposure:false,shadows:false});solarExplorer.resize('+W+','+H+')');
 await runFrames(b,210);
 const raw=[],resolved=[];
 for(let i=0;i<16;i++){
  await runFrames(b,1);
  raw.push(await capture(b,dir+'/raw.bin',W,H,'hdr'));
  resolved.push(await capture(b,dir+'/resolved.bin',W,H,'resolved_hdr'));
 }
 const pan=fw.map((v,i)=>v+.008*side[i]),panned=[eye,eye.map((v,i)=>v+1000*pan[i]),up];
 await b.evaluate('solarExplorer.camera='+JSON.stringify(panned));await runFrames(b,1);
 const moving=await capture(b,dir+'/pan.bin',W,H,'resolved_hdr');
 let staleCoverage=0;
 for(let i=0;i<W*H;i++)if(half[moving.readUInt16LE(i*8+6)]>=64)staleCoverage++;
 assert.equal(staleCoverage,0,'a pan must retire fixed-pixel skyline coverage immediately');
 await b.evaluate('solarExplorer.camera='+JSON.stringify([eye,eye.map((v,i)=>v+1000*fw[i]),up]));
 await b.evaluate('solarExplorer.resize('+W*2+','+H*2+');solarExplorer.configure({taa:false})');await runFrames(b,150);
 const ref=await capture(b,dir+'/reference.bin',W*2,H*2,'hdr');
 const flicker=[],unresolved=[],referenceErrors=[],rawErrors=[];
 for(let y=12;y<H-12;y++)for(let x=8;x<W-8;x++){
  const i=y*W+x;
  const hits=raw.filter(frame=>half[frame.readUInt16LE(i*8+6)]<59).length;
  if(hits===0||hits===raw.length)continue;
  const j=(2*y*2*W+2*x),refColor=(value(ref,j)+value(ref,j+1)+value(ref,j+W*2)+value(ref,j+W*2+1))*.25;
  for(let f=1;f<raw.length;f++){
   flicker.push(Math.abs(value(resolved[f],i)-value(resolved[f-1],i)));
   unresolved.push(Math.abs(value(raw[f],i)-value(raw[f-1],i)));
   referenceErrors.push(Math.abs(value(resolved[f],i)-refColor));
   rawErrors.push(Math.abs(value(raw[f],i)-refColor));
  }
 }
 function stats(a){a.sort((x,y)=>x-y);return {mean:a.reduce((x,y)=>x+y,0)/a.length,p95:a[Math.floor(.95*a.length)],max:a.at(-1)};}
 const result={edgePixels:flicker.length/(raw.length-1),staleCoverage,jitter:stats(flicker),rawJitter:stats(unresolved),referenceError:stats(referenceErrors),rawReferenceError:stats(rawErrors)};
 console.log(result);await writeFile(dir+'/report.json',JSON.stringify(result,null,2));
 assert.ok(result.edgePixels>140,'camera must contain a long, sloping terrain skyline');
 assert.ok(result.referenceError.mean<result.rawReferenceError.mean*.8,'resolved skyline should approach supersampled coverage');
 assert.ok(result.jitter.mean<result.rawJitter.mean*.04,'settled silhouette should hold still over the jitter sequence');
}finally{await b.close();}
