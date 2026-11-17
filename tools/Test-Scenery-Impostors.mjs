// Same generated object, dense mesh versus runtime captured impostor. No history.
import {headless} from './Headless.mjs';
import {ready,capture,runFrames} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const dir=resolve(process.argv[2]||'evidence/local/scenery-impostors');await mkdir(dir,{recursive:true});const b=await headless(dir);
const report={backend:'BrowserWebGpu',width:1920,height:1080,terrain_taa:false,cloud_history:false,cases:[],manifest:JSON.parse((await readFile('web/pkg/explorer-manifest.json','utf8')).replace(/^\uFEFF/,''))};
const save=()=>writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,2));
function half(x){const sign=x&32768?-1:1,exponent=(x>>10)&31,mantissa=x&1023;return sign*(exponent===0?2**-14*mantissa/1024:exponent===31?(mantissa?NaN:Infinity):2**(exponent-15)*(1+mantissa/1024));}
const norm=v=>{const l=Math.hypot(...v);return v.map(x=>x/l);},cross=(a,c)=>[a[1]*c[2]-a[2]*c[1],a[2]*c[0]-a[0]*c[2],a[0]*c[1]-a[1]*c[0]];
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await b.send('Page.navigate',{url:'http://127.0.0.1:5198/?test=1&body=procedural'});await ready(b);await b.evaluate('solarExplorer.resize(1920,1080);solarExplorer.configure({clouds:false,atmosphere:false,water:false,scenery_wind:0,ground_cover:false});solarExplorer.engine.profiling(true);solarExplorer.go("forest");');await runFrames(b,240);
 const a=JSON.parse(await b.evaluate('solarExplorer.engine.audit_scenery()'));report.geometry=a.geometry;report.contact_reference=a.contact_reference;const eye=await b.evaluate('solarExplorer.camera[0]');
 for(const kind of [1,2]){
  const candidates=a.objects.filter(o=>o.kind===kind&&o.shape[0]>(kind===1?5:1.5)).sort((x,y)=>Math.hypot(...x.hi.map((v,j)=>v+x.lo[j]-eye[j]))-Math.hypot(...y.hi.map((v,j)=>v+y.lo[j]-eye[j])));const object=candidates[0];if(!object)throw Error('No suitable generated object');
  const root=object.hi.map((v,j)=>v+object.lo[j]),up=norm(root),right=norm(cross(up,[0,0,1])),forward=cross(right,up),center=root.map((x,j)=>x+up[j]*object.shape[0]*.5);const slot=object.slot;
  report[`object_${kind}`]=object;
  for(const [distance,azimuth,elevation] of [[300,0,.2],[300,.7,.2],[300,1.4,.2],[300,2.1,.2],[300,3.14,.2],[300,4.7,.2],[300,0,.9],[300,1.57,1.45],[100,0,.2],[650,0,.2]]){
   const name=`${kind===1?'tree':'rock'}-${distance}-${azimuth}-${elevation}`,camera=center.map((x,j)=>x+distance*(right[j]*Math.cos(azimuth)*Math.cos(elevation)+forward[j]*Math.sin(azimuth)*Math.cos(elevation)+up[j]*Math.sin(elevation)));
   await b.evaluate(`solarExplorer.camera=${JSON.stringify([camera,center,up])};solarExplorer.configure({scenery_isolate:${slot+1},scenery_lod:1});`);await runFrames(b,100);
   const meshP=await capture(b,resolve(dir,`${name}-mesh-position.bin`),1920,1080,'position'),meshN=await capture(b,resolve(dir,`${name}-mesh-normal.bin`),1920,1080,'normal');await capture(b,resolve(dir,`${name}-mesh.png`));
   await b.evaluate('solarExplorer.configure({scenery_lod:2})');await runFrames(b,2);const cardP=await capture(b,resolve(dir,`${name}-card-position.bin`),1920,1080,'position'),cardN=await capture(b,resolve(dir,`${name}-card-normal.bin`),1920,1080,'normal');await capture(b,resolve(dir,`${name}-card.png`));
   let union=0,intersection=0,meshCoverage=0,cardCoverage=0;const depth=[],angle=[];
   for(let i=0;i<1920*1080;i++){
    const m=half(meshN.readUInt16LE(i*8+6))< -100,c=half(cardN.readUInt16LE(i*8+6))< -100;if(m)meshCoverage++;if(c)cardCoverage++;if(m||c)union++;if(!(m&&c))continue;intersection++;
    const mp=[0,4,8].map(j=>meshP.readFloatLE(i*16+j)),cp=[0,4,8].map(j=>cardP.readFloatLE(i*16+j));depth.push(Math.abs(Math.hypot(...mp)-Math.hypot(...cp)));const mn=norm([0,2,4].map(j=>half(meshN.readUInt16LE(i*8+j)))),cn=norm([0,2,4].map(j=>half(cardN.readUInt16LE(i*8+j))));angle.push(Math.acos(Math.min(1,Math.max(-1,mn.reduce((s,x,j)=>s+x*cn[j],0))))*180/Math.PI);
   }
   depth.sort((a,c)=>a-c);angle.sort((a,c)=>a-c);const result={name,distance,azimuth,elevation,meshCoverage,cardCoverage,intersection,union,iou:intersection/Math.max(1,union),depth_p95_m:depth[Math.floor(depth.length*.95)]??null,normal_p95_degrees:angle[Math.floor(angle.length*.95)]??null};result.gate_pass=meshCoverage>0&&result.iou>=.85&&result.depth_p95_m<=.5;report.cases.push(result);console.log(JSON.stringify(result));await save();
  }
 }
}finally{await b.close();}
