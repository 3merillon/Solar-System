// A lake with contradictory coarse water pages: the visible surface must use
// the resident fine lake level, regardless of terrain/water mesh ring spacing.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {headless} from './Headless.mjs';
import {runFrames,capture} from './Explorer-Test-Lib.mjs';
const dir=process.argv[2]||'evidence/local/lake-surface',W=640,H=360;
const base=process.argv.find(a=>a.startsWith('--base='))?.slice(7)||'http://127.0.0.1:5198/';
await mkdir(dir,{recursive:true});const b=await headless(dir),report={cases:[]};
try{
 await b.send('Page.navigate',{url:new URL('field/chart.js',base).href});
 await b.evaluate(`(async()=>{
  document.body.innerHTML='<canvas width="${W}" height="${H}"></canvas>';
  const {createWorkerExplorer}=await import('${base}worker-client.js');
  const engine=await createWorkerExplorer(document.querySelector('canvas'),()=>{},e=>{window.fatal=e},'full','earth');
  await engine.configure(JSON.stringify({...JSON.parse(engine.settings()),clouds:false,trees:false,rocks:false,buildings:false,atmosphere:false,wave_height:0,render_scale:1,fetch_limits:false}));
  const height=new Uint8Array(264*264*2),albedo=new Uint8Array(264*264*4);for(let i=0;i<albedo.length;i+=4)albedo.set([115,123,98,255],i);
  for(let face=0;face<6;face++){await engine.page_arrived(0,face,0,0,0,396,0,1,height,Float32Array.of(418));await engine.water_page_arrived(face,0,0,0,0,0,2,418,new Uint8Array(0));}
  window.supply=async()=>{const text=await engine.page_commands();if(!text)return;for(const p of JSON.parse(text).pages){await engine.page_arrived(p.channel,p.face,p.level,p.x,p.y,396,0,1,p.channel===0?height:albedo,Float32Array.of(p.level<12?418:402));if(p.channel===0)await engine.water_page_arrived(p.face,p.level,p.x,p.y,0,0,2,p.level<12?418:402,new Uint8Array(0));}};
  const lon=.12,lat=.89;window.n=[Math.cos(lat)*Math.sin(lon),Math.sin(lat),Math.cos(lat)*Math.cos(lon)];window.t=[-Math.sin(lat)*Math.sin(lon),Math.cos(lat),-Math.sin(lat)*Math.cos(lon)];
  window.setView=(height,pitch)=>{const eye=n.map(v=>v*(6371000+height));solarExplorer.camera=[eye,eye.map((v,i)=>v+t[i]*Math.cos(pitch)-n[i]*Math.sin(pitch)),n];};
  window.solarExplorer={engine,step(dt){return engine.render(this.camera.flat(),dt,0)},stats:()=>JSON.parse(engine.stats()),telemetry:()=>JSON.parse(engine.telemetry()),capture:k=>engine.capture(k)};setView(408,.18);
 })()`);
 async function settle(count){for(let i=0;i<count;i+=10){await b.evaluate('solarExplorer.engine.complete_pending()');await b.evaluate('supply()');await runFrames(b,10);if(await b.evaluate('window.fatal'))throw Error(await b.evaluate('window.fatal'));}}
 await settle(420);
 for(let i=0;i<1200;i++){await settle(1);if(!(await b.evaluate("solarExplorer.stats().pending_features")).length)break;await new Promise(r=>setTimeout(r,50));}
 assert.equal((await b.evaluate("solarExplorer.stats().pending_features")).length,0,"browser pipelines ready");
 for(const [name,height,pitch] of [['above',408,.18],['near',402.2,.04],['below',401.5,-.12]]){
  await b.evaluate(`setView(${height},${pitch})`);await settle(120);
  const buf=await capture(b,`${dir}/${name}-ocean.bin`,W,H,'ocean');
  const c=await b.evaluate('solarExplorer.camera'),eye=c[0];
  const unit=a=>a.map(v=>v/Math.hypot(...a)),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
  const forward=unit(c[1].map((v,i)=>v-eye[i])),right=unit(cross(forward,c[2])),up=cross(right,forward),radial=unit(eye),radius=Math.hypot(...eye);
  let samples=0,wrongHeight=0,wrongFacing=0,maxError=0; report.stats=await b.evaluate("solarExplorer.stats()");report.settings=JSON.parse(await b.evaluate("solarExplorer.engine.settings()"));report.water=JSON.parse(await b.evaluate("solarExplorer.engine.audit_water()"));
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
   const signed=buf.readFloatLE((y*W+x)*8),d=Math.abs(signed);if(!d||d>120)continue;
   const px=((x+.5)/W*2-1)*W/H*Math.tan(Math.PI/6),py=(1-(y+.5)/H*2)*Math.tan(Math.PI/6),rd=unit(forward.map((v,i)=>v+right[i]*px+up[i]*py));
   const h=radius-6371000+(2*radius*d*dot(rd,radial)+d*d)/(Math.sqrt(radius*radius+2*radius*d*dot(rd,radial)+d*d)+radius),error=Math.abs(h-402);
   maxError=Math.max(maxError,error);samples++;wrongHeight+=error>.15;wrongFacing+=(signed<0)!==(height<402);
  }
  report.cases.push({name,samples,wrongHeight,wrongFacing,maxError});console.log(report.cases.at(-1));
  await capture(b,`${dir}/${name}.png`,W,H);
  assert.ok(samples>1000,`${name} must exercise the lake`);assert.equal(wrongHeight,0);assert.equal(wrongFacing,0);
 }
 report.pass=true;
}catch(e){report.error=String(e.stack||e);throw e;}finally{await writeFile(`${dir}/report.json`,JSON.stringify(report,null,2));await b.close();}
