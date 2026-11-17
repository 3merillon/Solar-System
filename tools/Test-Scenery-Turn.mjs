// Visibility must not begin support preparation or appearance ramping.
import {headless} from './Headless.mjs';
import {ready,capture,runFrames} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const dir=resolve(process.argv[2]||'evidence/local/scenery-turn');await mkdir(dir,{recursive:true});const b=await headless(dir),report={cases:[],gates:[],manifest:JSON.parse((await readFile('web/pkg/explorer-manifest.json','utf8')).replace(/^\uFEFF/,''))};
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await b.send('Page.navigate',{url:'http://127.0.0.1:5198/?test=1&body=procedural'});await ready(b);
 await b.evaluate('solarExplorer.resize(1920,1080);solarExplorer.engine.profiling(true);solarExplorer.configure({clouds:false,water:false,atmosphere:false,scenery_wind:0});solarExplorer.go("canopy");window.c=solarExplorer.camera.map(v=>[...v]);');await runFrames(b,420);
 const seen=new Set();let firstSeen=0,fading=0,generated=0,contactMax=0,contactMissing=0,contactChecked=0;const failures=[];
 for(let i=0;i<25;i++){
  await b.evaluate(`{const n=c[0].map(x=>x/Math.hypot(...c[0])),d=c[1].map((x,j)=>x-c[0][j]),a=${i}*Math.PI/12,cr=[n[1]*d[2]-n[2]*d[1],n[2]*d[0]-n[0]*d[2],n[0]*d[1]-n[1]*d[0]],h=n.reduce((s,x,j)=>s+x*d[j],0);const v=d.map((x,j)=>x*Math.cos(a)+cr[j]*Math.sin(a)+n[j]*h*(1-Math.cos(a)));solarExplorer.camera=[c[0],c[0].map((x,j)=>x+v[j]),n];}`);await runFrames(b,1);
  const a=JSON.parse(await b.evaluate('solarExplorer.engine.audit_scenery()')),eye=await b.evaluate('solarExplorer.camera[0]');generated+=a.generated;let newcomers=0;
  contactMax=Math.max(contactMax,a.contact_reference.max_m??0);contactMissing+=a.contact_reference.missing;contactChecked+=a.contact_reference.checked;
  for(const o of a.objects){if(!o.drawn)continue;const key=o.key.slice(0,3).join(',');const near=Math.hypot(...o.hi.map((x,j)=>x+o.lo[j]-eye[j]))<1800;if(i>0&&near&&!seen.has(key)){firstSeen++;newcomers++;if(o.contact[3]<.999){fading++;failures.push({i,key,appearance:o.contact[3]});}}seen.add(key);}
  report.cases.push({i,newcomers,generated:a.generated,stats:await b.evaluate('solarExplorer.stats()')});if(i%6===0)await capture(b,resolve(dir,`turn-${i}.png`));
 }
 report.gates.push({name:'stationary first visibility is fully prepared',pass:firstSeen>100&&fading===0,firstSeen,fading,failures},{name:'turn requires zero placement generation',pass:generated===0,generated},{name:'independent surface contact through head turns',pass:contactChecked>0&&contactMissing===0&&contactMax<.03,contactChecked,contactMissing,contactMax});await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report.gates));
}finally{await b.close();}
