// Compare a close rock with its shadow map enabled and disabled. A lit
// triangle's interior should stay lit, while its shadow still reaches ground.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {headless} from './Headless.mjs';
import {ready,runFrames,capture} from './Explorer-Test-Lib.mjs';
const [dir='evidence/local/rock-receiver',base='http://127.0.0.1:5198/']=process.argv.slice(2);
await mkdir(dir,{recursive:true});const b=await headless(dir),W=720,H=400;
const unit=a=>a.map(v=>v/Math.hypot(...a)),dot=(a,c)=>a.reduce((v,x,i)=>v+x*c[i],0);
const half=h=>(h&32768?-1:1)*((h&31744)?(1+(h&1023)/1024)*2**((h>>10&31)-15):(h&1023)*2**-24);
try{
 await b.send('Page.navigate',{url:new URL('?body=procedural&test=1&quality=high',base).href});await ready(b);
 await b.evaluate('solarExplorer.resize('+W+','+H+');solarExplorer.go("forest");solarExplorer.configure({ground_cover:false,trees:false,water:false,atmosphere:false,clouds:false,scenery_wind:0,auto_exposure:false});solarExplorer.time=0');await runFrames(b,240);
 const object=await b.evaluate(`(async()=>{const a=JSON.parse(await solarExplorer.engine.audit_scenery()),eye=solarExplorer.camera[0],distance=o=>Math.hypot(...o.hi.map((v,i)=>v+o.lo[i]-eye[i]));return a.objects.filter(o=>o.kind===2&&o.shape[0]>5).sort((a,b)=>distance(a)-distance(b))[0];})()`);
 assert.ok(object,'forest fixture needs a large boulder');
 const root=object.hi.map((v,i)=>v+object.lo[i]),up=unit(root),t=unit([-up[1],up[0],0]);
 const sun=unit(up.map((v,i)=>v*.64+t[i]*.77)),r=object.shape[0];
 const camera=[root.map((v,i)=>v+r*(1.15*up[i]+2.7*t[i])),root.map((v,i)=>v+r*.30*up[i]),up];
 await b.evaluate('solarExplorer.camera='+JSON.stringify(camera)+';solarExplorer.configure('+JSON.stringify({scenery_isolate:object.slot+1,sun,shadows:true})+')');await runFrames(b,140);
 await capture(b,dir+'/rock.png',W,H);
 await b.evaluate('solarExplorer.configure({shadow_diagnostic:1,cloud_diagnostic:1024|4096|512})');await runFrames(b,3);
 const on=await capture(b,dir+'/visibility.hdr',W,H,'hdr'),normal=await capture(b,dir+'/normal.bin',W,H,'normal');
 await b.evaluate('solarExplorer.configure({cloud_diagnostic:1024|4096|512|2048})');await runFrames(b,3);
 const off=await capture(b,dir+'/no-caster.hdr',W,H,'hdr');
 function measure(on,off,normal){
  let lit=0,occluded=0,groundShadow=0,loss=0;
 for(let i=0;i<W*H;i++){
  const pos=i*8,tag=half(normal.readUInt16LE(pos+6)),n=[0,2,4].map(j=>half(normal.readUInt16LE(pos+j)));
  const diff=half(off.readUInt16LE(pos))-half(on.readUInt16LE(pos));
  if(tag===-103&&dot(n,sun)>.55){lit++;occluded+=diff>.10;loss+=Math.max(0,diff);}
  if(tag>=-100&&diff>.2)groundShadow++;
 }
  return {lit,occluded,meanLoss:loss/Math.max(lit,1),groundShadow};
 }
 const {lit,occluded,meanLoss,groundShadow}=measure(on,off,normal);
 const result={key:object.key,lit,occluded,meanLoss,groundShadow};
 console.log(result);await writeFile(dir+'/report.json',JSON.stringify(result,null,2));
 assert.ok(occluded/lit<.015 && result.meanLoss<.005,'lit rock triangles retain direct sun');
 assert.ok(lit>1000&&groundShadow>20,'both a lit surface and a cast shadow must be in view');
 // Move through both natural LOD thresholds. Hold each pose until the
 // transition finishes, then compare the direct sun with its caster absent.
 result.approach=[];
 for(const scale of [4.4,6.2,13,20,6.2,2.7]){
  const eye=root.map((v,i)=>v+r*scale*(t[i]+.42*up[i]));
  await b.evaluate('solarExplorer.camera='+JSON.stringify([eye,camera[1],up])+';solarExplorer.configure({cloud_diagnostic:1024|4096|512})');
  await runFrames(b,28);
  const light=await capture(b,dir+'/sweep-on.hdr',W,H,'hdr'),normals=await capture(b,dir+'/sweep-normal.bin',W,H,'normal');
  await b.evaluate('solarExplorer.configure({cloud_diagnostic:1024|4096|512|2048})');await runFrames(b,2);
  const clear=await capture(b,dir+'/sweep-off.hdr',W,H,'hdr');
  const sample={scale,...measure(light,clear,normals)};result.approach.push(sample);
 }
 await writeFile(dir+'/report.json',JSON.stringify(result,null,2));console.table(result.approach);
 assert.ok(result.approach.every(row=>row.lit>100 && row.meanLoss<.035),'changing rock LOD must preserve direct sun');

}finally{await b.close();}
