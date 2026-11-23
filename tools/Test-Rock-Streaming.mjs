// Frozen lunar camera, distance sweep, far-shadow attribution and motion return.
import {headless} from './Headless.mjs';
import {ready,runFrames,capture} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const dir=process.argv[2]||'evidence/local/rock-streaming';await mkdir(dir,{recursive:true});
const b=await headless(dir),report={distances:[]};
const add=(a,c)=>a.map((v,i)=>v+c[i]),mul=(a,c)=>a.map(v=>v*c),unit=a=>mul(a,1/Math.hypot(...a));
const base=[139604.1578088175,-120601.07265630184,-1729703.5966475434],up=unit(base);
const tangent=unit(add([0,1,0],mul(up,-up[1])));
const camera=async(height,shift=0)=>{
 const eye=add(add(base,mul(up,height)),mul(tangent,shift));
 const look=unit(add(tangent,mul(up,-.5)));
 await b.evaluate(`solarFlight.flight.jump_camera(301,${JSON.stringify([...eye,...add(eye,mul(look,1000)),...up])})`);
};
const frames=n=>runFrames(b,n,'solarExplorer.camera=solarFlight.frame(0,new Set(),100);');
const mean=bytes=>{let sum=0;for(let i=0;i<bytes.length;i+=4)sum+=bytes[i]+bytes[i+1]+bytes[i+2];return sum/(bytes.length*.75);};
try{
 await b.send('Page.navigate',{url:'http://127.0.0.1:5198/?test=1&quality=high&at=301&height=8000'});await ready(b);
 await b.evaluate('solarExplorer.resize(960,540);solarExplorer.configure({scenery_density:1,scenery_budget:8192,scenery_wind:0,clouds:false,atmosphere:false});solarExplorer.time=0;solarExplorer.engine.profiling(true)');
 // Freeze a reproducible daylight epoch. Local calendar time can put this
 // landing site on the night side, where a cloudless ground-shadow test is empty.
 await b.evaluate('solarFlight.flight.set_rate(0)');
 for(let day=0;day<30;day++){
  const epoch=852076800+day*86400;
  await b.evaluate('solarFlight.flight.set_seconds('+epoch+')');await camera(1200);await frames(3);
  const sun=await b.evaluate('Array.from(solarFlight.flight.packet(960,540).slice(11,14))');
  const elevation=up.reduce((v,x,i)=>v+x*sun[i],0);
  if(elevation>.24&&elevation<.65){report.epoch=epoch;break;}
 }
 assert.ok(report.epoch,'expected a sunlit lunar test site');
 for(const height of [1200,600,200,80,35]){
  await camera(height);await frames(180);
  const on=await capture(b,`${dir}/height-${height}.png`,960,540);
  await b.evaluate('solarExplorer.configure({cloud_diagnostic:4096})');await frames(2);
  const off=await capture(b,`${dir}/height-${height}-resolved-only.png`,960,540);
  await b.evaluate('solarExplorer.configure({cloud_diagnostic:0})');await frames(2);
  const stats=await b.evaluate('solarExplorer.stats()');
  const row={height,mean:mean(on),resolved_only_mean:mean(off),change:mean(off)-mean(on),scenery:stats.scenery};
  report.distances.push(row);console.log(JSON.stringify({height,change:row.change,overflow:stats.scenery.overflow}));
  assert.ok(row.change>=0,'unresolved shadow cannot brighten terrain');
  assert.equal(stats.scenery.overflow,0,'bounded rock draw admission');
 }
 assert.ok(report.distances[0].change>.05,'far rocks contribute ground shade');
 await frames(180);const settled=await capture(b,dir+'/stationary-first.png',960,540);
 let different=0;
 for(let i=0;i<30;i++){await frames(1);const data=await capture(b,dir+'/stationary-last.png',960,540);if(!data.equals(settled))different++;}
 report.stationary_changed_frames=different;assert.equal(different,0,'settled rocks/shadows must not flicker');
 // Camera translation used to leave deferred support in old camera coordinates.
 report.motion=[];
 for(let i=0;i<60;i++){
  await camera(35,Math.sin(i*Math.PI/30)*60);const result=await frames(1);
  report.motion.push({i,pacing:result.pacing[0],scenery:result.stats.scenery});
 }
 await camera(35);await frames(180);await capture(b,dir+'/motion-return.png',960,540);
 report.audit=JSON.parse(await b.evaluate('solarExplorer.engine.audit_scenery()'));
 const visible=report.audit.objects.filter(o=>o.drawn);
 assert.ok(visible.length>0,'expected visible lunar rocks');
 assert.ok(visible.every(o=>o.contact[3]===1&&Number.isInteger(o.support[3])),'stationary rocks must finish both arrival and LOD fades');
 assert.equal(await b.evaluate('window.explorerFailure'),null);report.pass=true;
}catch(e){report.error=String(e.stack||e);process.exitCode=1;}finally{
 await writeFile(dir+'/report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({pass:report.pass,error:report.error,stationary_changed_frames:report.stationary_changed_frames}));await b.close();
}
