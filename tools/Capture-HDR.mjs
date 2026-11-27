// The frame in linear light (half floats, before exposure and the tone curve) beside the display image, for a fixed set of
// scenes: Earth by day, at dusk, over the sea and from orbit, the Moon, Saturn, the Sun from four distances, the lens flare's
// cases, two procedural views. tools/Tone-Curves.mjs applies candidate tone curves to these offline, so every curve sees the same frame.
// Private headless browser only, one page at a time.
//   node tools/Capture-HDR.mjs --base http://127.0.0.1:5401 --out DIR [--only earth-day,sun-2r] [--quality high]
//     [--configure '{"bloom":false}']   a settings patch applied to every scene
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {headless} from './Headless.mjs';
import {ready,capture} from './Explorer-Test-Lib.mjs';
import {giantShot} from './Giant-Flight.mjs';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const base=arg('base','http://127.0.0.1:5401'),out=resolve(arg('out','evidence/local/hdr')),quality=arg('quality','high');mkdirSync(out,{recursive:true});
const T=852076800,AU=1.495978707e11,R=6.957e8;
const NOON="const f=solarFlight;f.setTime(Date.parse('2026-06-21T11:00:00Z')/1000-946727935.816+5);f.setRate(0);";
const solar=`explorer.html?test=1&quality=${quality}&limits=off&body=solar&tdb=${T}`;
// [name, page, what to run once it is ready, seconds to let it settle]
const SCENES=[
 ...[['saturn-wide',699,0],['saturn-limb',699,.42],['saturn-shadow',699,.67],['saturn-immersed',699,.93],['jupiter-skim',599,.72]].map(([name,id,t])=>[name,solar,giantShot(id,t),7]),
 ['earth-day',solar,NOON+"f.goEarth('lavaux');",30],
 ['earth-peak',solar,NOON+"f.goEarth('matterhorn');",30],
 ['earth-dusk',solar,NOON+"f.flight.jump_low_sun(399,1500,3);",30],
 ['earth-sea',solar,NOON+"f.flight.jump_low_sun(399,300,40);",30],
 ['earth-orbit',solar,NOON+"f.flight.jump_near(399,9e6);f.flight.look_at(399);",25],
 ['moon',solar,NOON+"f.flight.jump_near(301,2.5e6);f.flight.look_at(301);",12],
 ['saturn',solar,NOON+"f.flight.jump_near(699,2.6e8);f.flight.look_at(699);",12],
 ['sun-1au',solar+`&at=10&height=${AU-R}`,"solarFlight.setRate(0);solarFlight.flight.look_at(10);",5],
 ['sun-10r',solar+`&at=10&height=${9*R}`,"solarFlight.setRate(0);solarFlight.flight.look_at(10);",5],
 ['sun-2r',solar+`&at=10&height=${R}`,"solarFlight.setRate(0);solarFlight.flight.look_at(10);",5],
 ['sun-1.01r',solar+`&at=10&height=${0.01*R}`,"solarFlight.setRate(0);solarFlight.flight.look_at(10);",5],
 ['sun-limb',solar+`&at=10&height=${0.02*R}`,"solarFlight.setRate(0);solarFlight.flight.look_at(10);await new Promise(r=>setTimeout(r,2500));solarFlight.flight.look_at(0);solarFlight.look(0,-700);",5],
 ['proxima',solar+`&at=10000&height=${2*0.141*R}`,"solarFlight.setRate(0);solarFlight.flight.look_at(10000);",5],
 // The lens flare: the Sun setting through the airless Moon's horizon (clear of it, on it, a sliver, gone).
 // From 3 km up the Moon's horizon lies 3.4 degrees under the level, so the Sun sets through it at about that elevation.
 ['moon-sun-up',solar,NOON+"f.flight.jump_low_sun(301,3000,2);",12],
 ['moon-sun-a',solar,NOON+"f.flight.jump_low_sun(301,3000,-1.8);",12],
 ['moon-sun-b',solar,NOON+"f.flight.jump_low_sun(301,3000,-2.3);",12],
 ['moon-sun-c',solar,NOON+"f.flight.jump_low_sun(301,3000,-2.8);",12],
 ['coast',`explorer.html?test=1&body=procedural&quality=${quality}&view=coast`,"",8],
 ['forest',`explorer.html?test=1&body=procedural&quality=${quality}&view=forest`,"",8],
];
const only=arg('only','')?arg('only','').split(','):null;
const patch=JSON.stringify(JSON.parse(arg('configure','{}')));
const b=await headless(join(out,'.profile'));const rows=[];
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
 for(const [name,page,prep,settle] of SCENES){
  if(only&&!only.includes(name))continue;
  await b.send('Page.navigate',{url:`${base}/${page}`});await ready(b);
  const info=await b.evaluate(`(async()=>{${prep}if(${JSON.stringify(patch)}!=='{}')await solarExplorer.configure(JSON.parse(${JSON.stringify(patch)}));solarExplorer.paused=false;await new Promise(r=>setTimeout(r,${settle*1000}));solarExplorer.paused=true;await new Promise(r=>setTimeout(r,300));const s=solarExplorer.stats();return {width:s.width,height:s.height,exposure:solarExplorer.settings?.().exposure??1.3};})()`);
  await capture(b,join(out,`${name}.png`),1920,1080,'display');
  const hdr=await capture(b,join(out,`${name}.hdr16`),1920,1080,'hdr');
  rows.push({name,...info,hdr_bytes:hdr.length});console.log(name,JSON.stringify(info),hdr.length);
 }
}finally{await b.close();}
writeFileSync(join(out,'hdr.json'),JSON.stringify({base,quality,configure:JSON.parse(patch),format:'rgba16float, rows top to bottom, linear, before exposure',rows},null,1));
