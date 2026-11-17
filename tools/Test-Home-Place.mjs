// The opening view over the visitor's time zone (web/home-zone.js): for a few zones, the craft starts over that zone's city. Private
// headless browser with the time zone overridden; also checks that ?at= keeps the old start and that the startup notice is there.
//   node tools/Test-Home-Place.mjs --base http://127.0.0.1:5273 --out DIR
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {headless} from './Headless.mjs';
import {ready} from './Explorer-Test-Lib.mjs';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const base=arg('base','http://127.0.0.1:5273'),out=resolve(arg('out','evidence/local/home-place'));mkdirSync(out,{recursive:true});
// The last zone is not in the list: it falls back to its UTC offset's longitude (from the page itself, as daylight saving moves it).
const CASES=[['Australia/Sydney',-33.9,151.2],['Europe/Lisbon',38.7,-9.1],['America/Los_Angeles',34.1,-118.2],['Asia/Tokyo',35.7,139.7],['Pacific/Chatham',30,null]];
const rows=[];let bad=0;
const b=await headless(join(out,'.profile'));
try{
 for(let [zone,lat,lon] of CASES){
  await b.send('Emulation.setTimezoneOverride',{timezoneId:zone});
  await b.send('Page.navigate',{url:`${base}/explorer.html?test=1&quality=low&limits=off`});
  const notice=await (async()=>{for(let i=0;i<100;i++){const t=await b.evaluate(`document.getElementById('startup-note')?.textContent||''`).catch(()=>'');if(t)return t;await new Promise(r=>setTimeout(r,50));}return '';})();
  await ready(b);
  const f=await b.evaluate(`[...solarFlight.flight.probe(399)].slice(6,9)`);
  if(lon===null)lon=((await b.evaluate(`-new Date().getTimezoneOffset()/60`))*15+540)%360-180;
  const r=Math.hypot(...f),gotLat=Math.asin(f[1]/r)*180/Math.PI,gotLon=Math.atan2(f[0],f[2])*180/Math.PI;
  const off=Math.hypot(gotLat-lat,((gotLon-lon+540)%360)-180);
  const ok=off<2&&notice.includes('first launch');if(!ok)bad++;
  rows.push({zone,expect:[lat,lon],got:[+gotLat.toFixed(2),+gotLon.toFixed(2)],height_km:+((r-6371e3)/1e3).toFixed(0),notice:!!notice,ok});
  console.log(ok?'pass':'FAIL',zone,JSON.stringify(rows.at(-1)));
 }
 await b.send('Emulation.setTimezoneOverride',{timezoneId:'Australia/Sydney'});
 await b.send('Page.navigate',{url:`${base}/explorer.html?test=1&quality=low&limits=off&at=499&height=400000`});await ready(b);
 const frame=await b.evaluate(`solarFlight.flight.report()[0]`);const ok=frame===499;if(!ok)bad++;
 console.log(ok?'pass':'FAIL','?at=499 keeps its own start, frame',frame);rows.push({at:499,frame,ok});
}finally{await b.close();}
writeFileSync(join(out,'home-place.json'),JSON.stringify(rows,null,1));process.exitCode=bad?1:0;
