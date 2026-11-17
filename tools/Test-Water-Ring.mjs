// The owner's darker ring over the sea (3 November 2026, docs/WATER-LAYER.md): a band concentric about the point under
// the camera, between a transparent near disc and the farther reflective water. A ring centred under the camera is a
// quantity switched by distance or pixel footprint, so this test measures the water's brightness against the eye's
// distance and fails where it steps.
//
// Profile rows: distance (m), pixels, median, quartiles, median water depth (the ocean target's clearance), and with
// --diagnostic 8388608 the depth the field's page gives and the depth the bed path used (the display then shows them).
// Per view: the camera over shallow sea near a shore, at each of several heights, looking along the shore toward a low
// sun. Water pixels (the ocean target) are binned by their distance from the eye; the median display luminance of each
// bin (a median, so the sun's glitter path and the bed's grain do not move it) is compared with the bins a short
// distance either side. Fresnel and haze change smoothly with distance; a switch steps. The worst step over a window of
// 3% of the distance is reported in display codes, and the worst fall outward (worstDip: darker water beyond nearer
// water, the shape of the owner's band); the view fails when either passes --limit (default 4).
//   node tools/Test-Water-Ring.mjs --output DIR [--stop coast-somme | --lon L --lat B --heading H] [--heights 50,100,..]
//     [--sun-elevation 8] [--pitch -0.35] [--diagnostic N] [--width 1920 --height 1080] [--web DIR]
// Earth tests run the water layer by default (SOLAR_QUERY='&water=old' for the old path), and SOLAR_TILES_PORT=5210
// while a baseline holds 5201.
import {tileServer,earthBrowser,settle,toEye,heading} from './Earth-Test-Lib.mjs';
import {capture} from './Explorer-Test-Lib.mjs';
import {ringProfile,worstStep,worstDip,profileRows} from './Water-Ring-Lib.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const dir=resolve(arg('output','evidence/local/real-earth/runs/water-ring'));await mkdir(dir,{recursive:true});
const W=+arg('width',1920),H=+arg('height',1080),limit=+arg('limit',4);
const tour=JSON.parse(await readFile('tools/fixtures/earth-tour.json','utf8')).stops;
const stop=arg('stop')?tour.find(s=>s.name===arg('stop')):null;
const lon=+arg('lon',stop?.lon),lat=+arg('lat',stop?.lat),hdg=+arg('heading',stop?.heading??0);
if(!Number.isFinite(lon)||!Number.isFinite(lat))throw Error('give --stop or --lon and --lat');
const heights=arg('heights','50,100,200,500,1000,2000').split(',').map(Number);
const sunElevation=+arg('sun-elevation',8),pitch=+arg('pitch',-0.35),diagnostic=+arg('diagnostic',0);
const server=await tileServer({web:arg('web','web')});
const report={lon,lat,heading:hdg,sun_elevation:sunElevation,pitch,diagnostic,width:W,height:H,limit,query:process.env.SOLAR_QUERY||'',views:[]};
let b;
try{
 b=await earthBrowser(dir,server,{view:'earth-orbit',width:W,height:H});
 await b.evaluate(`solarExplorer.configure({clouds:false})`);
 if(diagnostic)await b.evaluate(`solarExplorer.configure({cloud_diagnostic:${diagnostic}})`);
 for(const alt of heights){
  // Altitude over the sea: the water level is 0 on Earth.
  const eye=toEye(lon,lat,alt),f=heading(lon,lat,hdg,pitch);
  await b.evaluate(`solarExplorer.camera=${JSON.stringify([eye,eye.map((x,i)=>x+f[i]*1000)])};`);
  // The sun ahead (the view's heading) at a low elevation: a long glitter path, as in the owner's picture.
  const sun=heading(lon,lat,hdg,Math.tan(sunElevation*Math.PI/180));
  await b.evaluate(`solarExplorer.engine.configure(JSON.stringify({...JSON.parse(solarExplorer.engine.settings()),sun:${JSON.stringify(sun)}}))`);
  const settled=await settle(b,{maxFrames:+arg('frames',4000)});
  await b.evaluate(`(async()=>{for(let i=0;i<60;i++){while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));while(solarExplorer.stats().pending)await new Promise(r=>setTimeout(r,0));}})()`);
  const name=`h${alt}`;
  const seen=await ringProfile(b,W,H,diagnostic);
  const worst=worstStep(seen.rows),dip=worstDip(seen.rows);
  await capture(b,resolve(dir,`${name}.png`),W,H);
  const row={view:name,alt,water_px:seen.water,worst,dip,pass:Math.abs(worst.step)<=limit&&dip.dip<=limit,frames:settled.frames,quiet:settled.quiet,resident:settled.lag?.pages_resident,failed:settled.lag?.pages_failed,water_layer:settled.stats?.water_layer||null};
  report.views.push({...row,profile:profileRows(seen.rows)});
  console.log(JSON.stringify(row));
 }
 report.pass=report.views.every(v=>v.pass);
 console.log(JSON.stringify({pass:report.pass,worst:report.views.map(v=>[v.alt,v.worst.step,v.worst.from_m])}));
}finally{await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,1));if(b)await b.close();server.close();}
