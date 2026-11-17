import {headless} from './Headless.mjs';
import {ready,runFrames,capture} from './Explorer-Test-Lib.mjs';
import {heading} from './Earth-Test-Lib.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const dir=process.argv[2]||'evidence/local/cover-stability-2026-11-09/before';await mkdir(dir,{recursive:true});
const b=await headless(dir),r={samples:[]};
const moon=process.argv.includes('--moon'),verify=process.argv.includes('--verify');
const frames=n=>runFrames(b,n,moon?'solarExplorer.camera=solarFlight.frame(0,new Set(),100);':'');
const audit=async()=>JSON.parse(await b.evaluate('solarExplorer.engine.audit_cover_fade(true)'));
const identity=a=>new Set(a.records.filter(o=>o.fade>.05).map(o=>o.seed+':'+(o.list<2?0:o.list)));
function changes(a,z){const A=identity(a),Z=identity(z);return {before:A.size,after:Z.size,lost:[...A].filter(k=>!Z.has(k)).length,gained:[...Z].filter(k=>!A.has(k)).length};}
try{
 await b.send('Page.navigate',{url:moon?'http://127.0.0.1:5198/?test=1&at=301&height=8000&quality=high':'http://127.0.0.1:5198/?test=1&body=earth&view=lausanne&quality=high'});await ready(b);
 await b.evaluate('solarExplorer.resize(960,540);solarExplorer.configure({scenery_wind:0,clouds:false,atmosphere:false,water:false});solarExplorer.time=0');
 await frames(260);
 const h=moon?0:await b.evaluate('solarExplorer.engine.height(...solarExplorer.camera[0])');
 const origin=moon?[139604.1578088175,-120601.07265630184,-1729703.5966475434]:await b.evaluate('solarExplorer.camera[0]');const n=origin.map(x=>x/Math.hypot(...origin));const eye=moon?origin.map((x,i)=>x+n[i]*20):n.map(x=>x*(6371000+h+20));
 const lon=Math.atan2(eye[0],eye[2])*180/Math.PI,lat=Math.asin(n[1])*180/Math.PI,d=heading(lon,lat,40,-.5),right=heading(lon,lat,130,0);
 const overfill=process.argv.includes('--overfill');const pose=(move=0,reverse=false)=>{const p=eye.map((v,i)=>v+right[i]*move+n[i]*(overfill?180:0)),f=overfill?heading(lon,lat,reverse?220:40,-3):(reverse?heading(lon,lat,220,-.5):d);return [p,p.map((v,i)=>v+f[i]*1000),n];};
 const camera=async p=>b.evaluate(moon?`solarFlight.flight.jump_camera(301,${JSON.stringify(p.flat())})`:`solarExplorer.camera=${JSON.stringify(p)}`);
 await camera(pose());await frames(180);r.start=await audit();r.stats=await b.evaluate('solarExplorer.stats()');r.pose=pose();await capture(b,dir+'/start.png',960,540);
 // Page refinement can fade a plant out once. Repeated departures/returns at a
 // fixed view identify churn, rather than confusing those with first arrival.
 const stationary=async(name,base)=>{let previous=base;const departed=new Set();for(let i=0;i<30;i++){await frames(1);const a=await audit(),A=identity(previous),Z=identity(a);let reappeared=0;for(const k of A)if(!Z.has(k))departed.add(k);for(const k of Z)if(!A.has(k)&&departed.has(k))reappeared++;r.samples.push({name,i,change:changes(previous,a),fromBase:changes(base,a),reappeared,count:a.count,overflow:a.overflow,visibility:a.mean_visibility});previous=a;}};
 for(const [name,density,reach] of [['normal',1,220],['pressure',2,280],...(process.argv.includes('--forced')?[['forced',2,280]]:[]) ]){
  await b.evaluate(`solarExplorer.configure({cover_density:${density},cover_reach:${reach},scenery_draw_limit:${name==='forced'?2048:32768}})`);await frames(90);
  for(let i=0;i<50;i++){await camera(pose(i*2));await frames(1);}
  await frames(60);const base=await audit();await writeFile(dir+'/'+name+'-base.json',JSON.stringify(base));
  await stationary(name,base);
  await capture(b,dir+'/'+name+'.png',960,540);
  await camera(pose(98,true));await frames(60);r[name+'-back']=await audit();await stationary(name+'-back',r[name+'-back']);
  await camera(pose(98));await frames(1);const returned=await audit();
  r[name+'-return']={change:changes(base,returned),visibility:returned.mean_visibility,base_visibility:base.mean_visibility};
  if(verify&&name!=='forced')assert.ok(returned.mean_visibility>=base.mean_visibility-.01,'camera turn must not restart birth fades');
 }
 r.end=await b.evaluate('solarExplorer.stats()');r.failure=await b.evaluate('window.explorerFailure');
 if(verify){assert.equal(r.failure,null);for(const s of r.samples){assert.ok(s.count>100,`${s.name}: nonempty cover fixture`);assert.equal(s.reappeared,0,`${s.name}: stationary plants repeatedly swapped`);if(moon)assert.equal(s.change.lost+s.change.gained,0,`${s.name}: stable lunar fixture`);if(!s.name.startsWith('forced'))assert.equal(s.overflow,0,`${s.name}: normal draw budget`);}if(process.argv.includes('--forced'))assert.ok(r.samples.some(s=>s.overflow>0),'force overflow to exercise deterministic admission');r.pass=true;}
 console.log(JSON.stringify({pass:r.pass,body:moon?'moon':'earth',samples:r.samples.length,max_overflow:Math.max(...r.samples.map(s=>s.overflow)),max_changed:Math.max(...r.samples.map(s=>s.change.lost+s.change.gained)),reappeared:r.samples.reduce((n,s)=>n+s.reappeared,0)}));
}catch(e){r.error=String(e.stack||e);process.exitCode=1;console.error(e);}finally{await writeFile(dir+'/report.json',JSON.stringify(r,null,2));await b.close();}
