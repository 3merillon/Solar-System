// A stationary camera looking across a rolled, backlit bank. Test both cloud
// resolutions over two complete TAA sequences, including the sunlit interior.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {earthBrowser,tileServer,heading,toEye} from './Earth-Test-Lib.mjs';
import {runFrames} from './Explorer-Test-Lib.mjs';

const [dir='evidence/local/cloud-stability',web='web']=process.argv.slice(2);
await mkdir(dir,{recursive:true});
const server=await tileServer({port:5288,web}),width=512,height=288;
let browser;
async function measure({width,height,scale,animated}){
 const half=Float32Array.from({length:65536},(_,n)=>(n&32768?-1:1)*((n&31744)?(1+(n&1023)/1024)*2**((n>>10&31)-15):(n&1023)*2**-24));
 const changes={radiance:[],transmission:[],raw:[],resolved:[],display:[]};
 let old,cloudy=0;
 for(let i=0;i<17;i++){
  if(animated)solarExplorer.time+=1/60;
  while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));
  await solarExplorer.engine.flush();
  const data={};
  for(const key of ['cloud','hdr','resolved_hdr','display']){
   const bytes=await solarExplorer.capture(key);
   data[key]=key==='display'?bytes:new Uint16Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/2);
  }
  if(old)for(let y=64;y<height-32;y+=2)for(let x=12;x<width-12;x+=2){
   const c=(Math.floor(y/scale)*Math.ceil(width/scale)+Math.floor(x/scale))*4,k=(y*width+x)*4;
   if(Math.min(half[data.cloud[c+3]],half[old.cloud[c+3]])>.98)continue;
   cloudy++;
   changes.transmission.push(Math.abs(half[data.cloud[c+3]]-half[old.cloud[c+3]]));
   changes.radiance.push(Math.abs(half[data.cloud[c+1]]-half[old.cloud[c+1]]));
   changes.raw.push(Math.abs(half[data.hdr[k+1]]-half[old.hdr[k+1]]));
   changes.resolved.push(Math.abs(half[data.resolved_hdr[k+1]]-half[old.resolved_hdr[k+1]]));
   changes.display.push(Math.abs(data.display[k+1]-old.display[k+1]));
  }
  old=data;
 }
 function stats(a){a.sort((x,y)=>x-y);return {mean:a.reduce((x,y)=>x+y,0)/Math.max(1,a.length),p99:a[Math.floor(a.length*.99)],max:a.at(-1),over2:a.filter(v=>v>2).length/a.length};}
 return {cloudy,...Object.fromEntries(Object.entries(changes).map(([k,v])=>[k,stats(v)]))};
}
try{
 browser=await earthBrowser(dir,server,{width,height});
 await browser.evaluate('solarExplorer.time=0;solarExplorer.configure({cloud_speed:0,cloud_evolution:0,cloud_history:false,cloud_cover:.48,cloud_type:1,scenery_density:0,auto_exposure:false})');
 const results=[];
 for(const alt of [9000,3150]){
  const eye=toEye(-32,30,alt),forward=heading(-32,30,35,-.035),side=heading(-32,30,125,0);
  const up=eye.map((v,j)=>v/Math.hypot(...eye)+.14*side[j]);
  await browser.evaluate('solarExplorer.camera='+JSON.stringify([eye,eye.map((v,k)=>v+1000*forward[k]),up]));
  for(const [scale,far,taa,animated] of [[2,2,false,false],[2,2,true,false],[1,1,true,false],[2,2,true,true]]){
   await browser.evaluate('solarExplorer.configure('+JSON.stringify({cloud_scale:scale,cloud_far_scale:far,taa,cloud_speed:+animated,cloud_evolution:+animated})+')');
   await runFrames(browser,40,animated?"solarExplorer.time+=1/60;":"");
   const row={alt,scale,far,taa,animated,...await browser.evaluate('('+measure+')('+JSON.stringify({width,height,scale,animated})+')')};
   results.push(row);console.log(alt,scale,taa,JSON.stringify(row));
  }
 }
 await writeFile(dir+'/report.json',JSON.stringify(results,null,2));
 for(const r of results){
  assert.ok(r.cloudy>2000,'fixture must sample the visible cloud layer');
  if(!r.animated)assert.ok(r.transmission.p99<.0005 && r.radiance.p99<.001,'stationary cloud samples must stay anchored');
  assert.ok(r.display.p99<=2,'the settled display must stay within two code values for 99% of sampled cloud pixels');
 }
}finally{try{await browser?.close();}finally{server.close();}}
