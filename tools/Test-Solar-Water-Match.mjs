// Water and shores through the solar system's path (the default app since 4 November 2026) against the same camera
// through ?body=earth, close to the ground: the owner's reports of 4 November came from the solar path. One Earth-fixed
// camera, the solar path's sun given to the Earth path, clouds off, the solar clock stopped. Replayed tiles, private
// browser; every view's two images and their difference go to DIR.
//   node tools/Test-Solar-Water-Match.mjs --output DIR [--views name,..] [--width 1280 --height 720] [--web DIR]
//   [--extra '&water=old'] [--diagnostic N] [--earth-only]  (--earth-only: the Earth path alone, at the asked camera; the
//   solar craft does not hold a camera a few metres over water, it sinks: ligurian at 30 m ended 1.3 km under the sea)
// A view: a tour stop (tools/fixtures/earth-tour.json) at its height, or name:lon:lat:alt:heading:pitch.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tileServer,headless,ready,settle,toEye,heading} from './Earth-Test-Lib.mjs';
import {capture,png} from './Explorer-Test-Lib.mjs';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const dir=resolve(arg('output','evidence/local/real-earth/runs/solar-water'));await mkdir(dir,{recursive:true});
const W=+arg('width',1280),H=+arg('height',720),T=852076800,extra=arg('extra',''),diagnostic=+arg('diagnostic',0);
const tour=JSON.parse(await readFile('tools/fixtures/earth-tour.json','utf8')).stops;
const views=arg('views','ligurian,lake,emosson,coast-somme,lisbon').split(',').map(v=>{
 const p=v.split(':');if(p.length>1)return {name:p[0],lon:+p[1],lat:+p[2],alt:+p[3],heading:+(p[4]||0),pitch:+(p[5]||-0.25)};
 const s=tour.find(s=>s.name===v);if(!s)throw Error('no tour stop '+v);return {name:v,lon:s.lon,lat:s.lat,alt:s.alt??s.height,heading:s.heading??0,pitch:-0.25};});
const server=await tileServer({web:arg('web','web')});
const open=async(name,query)=>{const b=await headless(resolve(dir,'.profile-'+name));await b.send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:false});
 await b.send('Page.navigate',{url:`${server.base}/explorer.html?test=1&tiles=${encodeURIComponent(server.base)}&quality=high&limits=off&${query}${extra}`});await ready(b);await b.evaluate(`solarExplorer.resize(${W},${H})`);
 await b.evaluate(`solarExplorer.configure({clouds:false${diagnostic?',cloud_diagnostic:'+diagnostic:''}})`);return b;};
const report={width:W,height:H,extra,diagnostic,views:[]};
let solar,earth;const earthOnly=process.argv.includes('--earth-only');
try{
 if(!earthOnly){solar=await open('solar',`body=solar&tdb=${T}`);
 await solar.evaluate('solarFlight.flight.set_rate(0)');}
 earth=await open('earth','body=earth&view=earth-orbit');
 const frame='solarExplorer.camera=solarFlight.frame(1/60,new Set(),100);';
 for(const v of views){
  const eye=toEye(v.lon,v.lat,v.alt),f=heading(v.lon,v.lat,v.heading,v.pitch),target=eye.map((x,i)=>x+f[i]*1000);
  if(earthOnly){await earth.evaluate(`solarExplorer.camera=${JSON.stringify([eye,target])}`);const e=await settle(earth,{maxFrames:4000});
   await earth.evaluate(`(async()=>{for(let i=0;i<30;i++){while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));while(solarExplorer.stats().pending)await new Promise(r=>setTimeout(r,0));}})()`);
   await capture(earth,join(dir,`${v.name}-earth.png`),W,H);const st=await earth.evaluate('solarExplorer.stats()');
   const row={view:v.name,...v,earth:{frames:e.frames,quiet:e.quiet,water_layer:st.water_layer}};report.views.push(row);console.log(JSON.stringify(row));continue;}
  const n=eye.map(x=>x/Math.hypot(...eye));
  await solar.evaluate(`solarFlight.flight.jump_camera(399,${JSON.stringify([...eye,...target,...n])})`);
  const s=await settle(solar,{maxFrames:4000,update:frame});
  await solar.evaluate(`(async()=>{for(let i=0;i<30;i++){${frame}while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));while(solarExplorer.stats().pending)await new Promise(r=>setTimeout(r,0));}})()`);
  const packet=await solar.evaluate(`[...solarFlight.flight.packet(${W},${H})].slice(0,14)`);
  const a=await capture(solar,join(dir,`${v.name}-solar.png`),W,H);
  const camera=[packet.slice(0,3),packet.slice(0,3).map((x,i)=>x+packet[3+i]*1000),packet.slice(6,9)],sun=packet.slice(11,14);
  await earth.evaluate(`solarExplorer.configure({sun:${JSON.stringify(sun)}})`);
  await earth.evaluate(`solarExplorer.camera=${JSON.stringify(camera)}`);
  const e=await settle(earth,{maxFrames:4000});
  await earth.evaluate(`(async()=>{for(let i=0;i<30;i++){while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));while(solarExplorer.stats().pending)await new Promise(r=>setTimeout(r,0));}})()`);
  const c=await capture(earth,join(dir,`${v.name}-earth.png`),W,H);
  const diff=Buffer.alloc(W*H*4);let sum=0,big=0;
  for(let i=0;i<W*H*4;i+=4){let d=0;for(let k=0;k<3;k++)d=Math.max(d,Math.abs(a[i+k]-c[i+k]));sum+=d;if(d>32)big++;diff[i]=diff[i+1]=diff[i+2]=Math.min(255,d*4);diff[i+3]=255;}
  await writeFile(join(dir,`${v.name}-diff.png`),png(diff,W,H));
  const solarStats=await solar.evaluate('solarExplorer.stats()'),earthStats=await earth.evaluate('solarExplorer.stats()');
  const row={view:v.name,...v,solar_eye:camera[0],asked_eye:eye,eye_error_m:Math.hypot(...camera[0].map((x,i)=>x-eye[i])),mean_difference:sum/(W*H),share_over_32:big/(W*H),
   solar:{frames:s.frames,quiet:s.quiet,water_layer:solarStats.water_layer,field_water:solarStats.field?.waterLayer},earth:{frames:e.frames,quiet:e.quiet,water_layer:earthStats.water_layer,field_water:earthStats.field?.waterLayer}};
  report.views.push(row);console.log(JSON.stringify(row));
 }
}finally{await writeFile(join(dir,'report.json'),JSON.stringify(report,null,1));server.close();}
process.exit(0);
