// Compare the resolved image with eight real subpixel samples of a stationary
// scene, then check that a cut, resize, and switch into space discard history.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {headless} from './Headless.mjs';
import {ready,runFrames,capture} from './Explorer-Test-Lib.mjs';
const [dir='evidence/local/temporal-aa',base='http://127.0.0.1:5198/']=process.argv.slice(2);
await mkdir(dir,{recursive:true});const b=await headless(dir),width=640,height=360;
const values=Float32Array.from({length:65536},(_,n)=>(n&32768?-1:1)*((n&31744)?(1+(n&1023)/1024)*2**((n>>10&31)-15):(n&1023)*2**-24));
function luma(buf){return Float32Array.from({length:buf.length/8},(_,i)=>.2126*values[buf.readUInt16LE(i*8)]+.7152*values[buf.readUInt16LE(i*8+2)]+.0722*values[buf.readUInt16LE(i*8+4)]);}
async function read(kind){return luma(await capture(b,dir+'/'+kind+'.bin',width,height,kind));}
try{
 await b.send('Page.navigate',{url:new URL('?test=1&body=procedural&quality=high',base).href});await ready(b);
 await b.evaluate(`solarExplorer.engine.profiling(true);solarExplorer.resize(${width},${height});solarExplorer.go('forest');solarExplorer.time=0;solarExplorer.configure({clouds:false,water:false,shadows:false,scenery_wind:0,ground_cover:false,auto_exposure:false,bloom:false,taa:true})`);
 await runFrames(b,210);
 const raw=[],resolved=[];
 for(let i=0;i<8;i++){await runFrames(b,1);raw.push(await read('hdr'));resolved.push(await read('resolved_hdr'));}
 assert.ok(await b.evaluate('solarExplorer.stats().taa_history_used'));
 let single=0,aa=0,edges=0;
 for(let i=0;i<raw[0].length;i++){
  const samples=raw.map(a=>a[i]),range=Math.max(...samples)-Math.min(...samples);if(range<.025)continue;
  const mean=samples.reduce((n,x)=>n+x)/8;edges++;
  for(let k=0;k<8;k++){single+=Math.abs(raw[k][i]-mean);aa+=Math.abs(resolved[k][i]-mean);}
 }
 const report={edgePixels:edges,singleError:single/(8*edges),resolvedError:aa/(8*edges),ratio:aa/single};
 console.log(report);
 await b.evaluate("solarExplorer.go('orbit')");await runFrames(b,1);
 assert.equal(await b.evaluate('solarExplorer.stats().taa_history_used'),false);
 assert.deepEqual(await read('resolved_hdr'),await read('hdr'),'a cut must show the new frame immediately');
 await runFrames(b,4);await b.evaluate('solarExplorer.resize(613,357)');await runFrames(b,1);
 assert.equal(await b.evaluate('solarExplorer.stats().taa_history_used'),false);
 await b.send('Page.navigate',{url:new URL('?test=1&quality=high&taa=1',base).href});await ready(b);
 await b.evaluate('solarExplorer.engine.profiling(true);solarFlight.flight.jump_overview(1e12);solarExplorer.camera=solarFlight.frame(0,solarExplorer.keys,0)');await runFrames(b,12);
 const space=await b.evaluate('solarExplorer.stats()');report.spaceHistory=space.taa_history_used;
 assert.equal(space.solar.surface_shown,false);assert.equal(space.taa_history_used,true);
 await writeFile(dir+'/report.json',JSON.stringify(report,null,2));console.log(report);
 assert.ok(edges>500 && aa<single*.75,'TAA should approach the subpixel reference');
}finally{await b.close();}
