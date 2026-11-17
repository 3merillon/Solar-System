// Owner-reported continuity and water-edge regressions, private browser only.
import {headless} from './Headless.mjs';
import {ready,capture,runFrames} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const dir=resolve(process.argv[2]||'evidence/local/scenery-followup');await mkdir(dir,{recursive:true});const b=await headless(dir);
const report={cases:[],gates:[],terrain_taa:false,cloud_history:false,manifest:JSON.parse((await readFile('web/pkg/explorer-manifest.json','utf8')).replace(/^\uFEFF/,''))};
const norm=v=>{const m=Math.hypot(...v);return v.map(x=>x/m);},dot=(a,c)=>a.reduce((s,x,i)=>s+x*c[i],0),cross=(a,c)=>[a[1]*c[2]-a[2]*c[1],a[2]*c[0]-a[0]*c[2],a[0]*c[1]-a[1]*c[0]],sub=(a,c)=>a.map((x,i)=>x-c[i]);
const key=o=>o.key.slice(0,3).join(','),save=()=>writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,2));
function interior(o,c){const p=o.hi.map((x,j)=>x+o.lo[j]),up=norm(p),center=p.map((x,j)=>x+up[j]*o.shape[0]*.5),delta=sub(center,c[0]),forward=norm(sub(c[1],c[0])),right=norm(cross(forward,c[2]||norm(c[0]))),vertical=cross(right,forward),z=dot(delta,forward);return Math.hypot(...delta)<1100&&z>50&&Math.abs(dot(delta,right))<z*.6&&Math.abs(dot(delta,vertical))<z*.3;}
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await b.send('Page.navigate',{url:'http://127.0.0.1:5198/?test=1&body=procedural'});await ready(b);
 await b.evaluate('solarExplorer.resize(1920,1080);solarExplorer.engine.profiling(true);solarExplorer.configure({clouds:false,water:false,atmosphere:false,scenery_wind:0});solarExplorer.go("canopy");window.base=solarExplorer.camera.map(v=>[...v]);window.up=base[0].map(x=>x/Math.hypot(...base[0]));window.forward=base[1].map((x,j)=>x-base[0][j]);{const h=forward.reduce((s,x,j)=>s+x*up[j],0);forward=forward.map((x,j)=>x-up[j]*h);const l=Math.hypot(...forward);forward=forward.map(x=>x/l);}');await runFrames(b,360);
 let previous=null,checked=0,missing=0;const failures=[];
 for(let block=0;block<25;block++){
  const offset=block<=12?block*100:(24-block)*100;
  await runFrames(b,12,`{const old=${block===0?0:(block<=13?(block-1)*100:(25-block)*100)},offset=old+(${offset}-old)*(i+1)/12;const eye=base[0].map((x,j)=>x+forward[j]*offset);solarExplorer.camera=[eye,eye.map((x,j)=>x+forward[j]*1000-up[j]*330),up];}`);
  const a=JSON.parse(await b.evaluate('solarExplorer.engine.audit_scenery()')),camera=await b.evaluate('solarExplorer.camera');const now=new Map(a.objects.map(o=>[key(o),o]));
  if(previous)for(const old of previous.objects){if(old.kind!==1||!old.drawn||old.contact[3]<.999||!interior(old,previous.camera)||!interior(old,camera))continue;checked++;const current=now.get(key(old));if(!current||!current.drawn){missing++;failures.push({block,key:key(old),present:!!current,contact:current?.contact});}}
  report.cases.push({name:`flight-${block}`,offset,camera,stats:await b.evaluate('solarExplorer.stats()'),contact:a.contact_reference,drawn:a.objects.filter(o=>o.drawn).length});previous={objects:a.objects,camera};
  if([0,6,12,18,24].includes(block))await capture(b,resolve(dir,`flight-${block}.png`));await save();
 }
 report.gates.push({name:'admitted interior trees survive forward/reverse flight',pass:checked>100&&missing===0,checked,missing,failures});
 // High, downward-looking view exposes mismatched solid material cover.
 await b.evaluate('{const eye=base[0].map((x,j)=>x+up[j]*900);solarExplorer.camera=[eye,eye.map((x,j)=>x+forward[j]*1000-up[j]*800),up];}');await runFrames(b,240);await capture(b,resolve(dir,'aerial-continuity.png'));
 await b.evaluate('solarExplorer.go("forest")');await runFrames(b,240);const a=JSON.parse(await b.evaluate('solarExplorer.engine.audit_scenery()'));const object=a.objects.find(o=>o.kind===2&&o.shape[0]>7);if(!object)throw Error('No large rock for refraction regression');report.water_object=object;
 const root=object.hi.map((x,j)=>x+object.lo[j]),up=norm(root),tangent=norm(cross([0,0,1],up)),side=cross(up,tangent),sea=object.height+object.shape[0]*.6,eye=root.map((x,j)=>x+up[j]*(sea-object.height+9)-tangent[j]*24);
 await b.evaluate(`solarExplorer.configure({sea:${sea},wave_height:1.4,water:true,atmosphere:true,clouds:false,foam:0,scenery_wind:0});solarExplorer.time=4;`);await runFrames(b,240);
 for(const [name,pan,lift] of [['center',0,2],['left-edge',-17,2],['right-edge',17,2],['bottom-edge',0,14]]){
  const target=root.map((x,j)=>x+side[j]*pan+up[j]*lift);await b.evaluate(`solarExplorer.camera=${JSON.stringify([eye,target,up])}`);await runFrames(b,60);await capture(b,resolve(dir,`water-${name}.png`));
  report.cases.push({name:`water-${name}`,snapshot:await b.evaluate('solarExplorer.snapshot()'),stats:await b.evaluate('solarExplorer.stats()')});await save();
 }
 await b.evaluate(`solarExplorer.configure({sun:${JSON.stringify(up.map(x=>-x))}})`);await runFrames(b,8);const night=await capture(b,resolve(dir,'water-night.png'));let nonblack=0;for(let i=0;i<night.length;i+=4)if(night[i]||night[i+1]||night[i+2])nonblack++;report.gates.push({name:'submerged rocks remain black at night',pass:nonblack===0,nonblack});
 await save();console.log(JSON.stringify({dir,gates:report.gates}));
}finally{await b.close();}
