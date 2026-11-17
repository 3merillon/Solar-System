// Star captures, paused clock, raw canvas (no interface): the Sun from 1 au, 0.1 au, 10 and 2 solar radii, its limb at grazing
// view, and each of the five other stars from three of its radii; plus a planet lit by a red dwarf. Same views on any build, so
// a before and an after can be set side by side. Private headless browser only.
//   node tools/Capture-Stars.mjs --base http://127.0.0.1:5233 --out DIR [--only sun-2r,proxima] [--view 0|1]
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {headless} from './Headless.mjs';
import {ready,capture} from './Explorer-Test-Lib.mjs';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const base=arg('base','http://127.0.0.1:5233'),out=resolve(arg('out','evidence/local/stars'));mkdirSync(out,{recursive:true});
const T=852076800,AU=1.495978707e11,R=6.957e8;
// [name, body, height above the surface (m), what to look at, extra look in pixels (dx, dy)]
const VIEWS=[['sun-1au',10,AU-R,10],['sun-0.1au',10,0.1*AU-R,10],['sun-10r',10,9*R,10],['sun-2r',10,R,10],['sun-1.1r',10,0.1*R,10],['sun-1.01r',10,0.01*R,10],['sun-limb',10,0.02*R,10,0,-700],['sun-skim',10,2e5,10,0,-760],['sun-touch',10,20,10,0,-780],['sun-down',10,200,10],
 ['proxima',10000,2*0.141*R,10000],['trappist',10100,2*0.1192*R,10100],['tau-ceti',10200,2*0.793*R,10200],['eridani',10300,2*0.74*R,10300],['kepler186',10400,2*0.523*R,10400],
 ['proxima-world',10002,1.5e7,10002,0,0],
 // The Sun's largest active region (the page's own list, stats().solar.star_regions), faced from over it or from a place
 // `side` degrees of longitude away, at a height in solar radii: [name, 10, R, 10, 0, 0, {side, up}].
 ['region-far',10,R,10,0,0,{side:0,up:0.25}],['region',10,R,10,0,0,{side:0,up:0.06}],['region-near',10,R,10,0,0,{side:0,up:0.015}],
 // south: stand that many degrees south of it instead and look north and down at it (jump_over), for an oblique view.
 ['region-oblique',10,R,10,0,0,{south:5.8,up:0.12}],['region-limb',10,R,10,0,0,{side:52,up:1.0}]];
const only=arg('only','')?arg('only','').split(','):null;
const view=arg('view',null);
const b=await headless(join(out,'.profile'));const rows=[];
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
 for(const [name,body,height,target,dx=0,dy=0,region=null] of VIEWS){
  if(only&&!only.includes(name))continue;
  await b.send('Page.navigate',{url:`${base}/explorer.html?test=1&quality=high&limits=off&body=solar&tdb=${T}&at=${body}&height=${height}`});
  await ready(b);
  // --view 0: true colour (the colour check's model); 1: the familiar composite. Older builds without the switch ignore it.
  if(view!==null)await b.evaluate(`(()=>{const e=document.getElementById('solar-star-view');if(e){e.value='${view}';e.dispatchEvent(new Event('change'));}})()`);
  const info=await b.evaluate(`(async()=>{solarFlight.setRate(0);solarFlight.flight.look_at(${target});solarExplorer.paused=false;await new Promise(r=>setTimeout(r,2500));if(${dx}||${dy}){solarFlight.flight.look_at(0);solarFlight.look(${dx},${dy});}await new Promise(r=>setTimeout(r,1500));solarExplorer.paused=true;return {exposure:solarFlight.flight.star_exposure?.()??null};})()`);
  if(region){
   // The frame must have run for the list to exist; then over the largest region still alive.
   const where=await b.evaluate(`(async()=>{solarExplorer.paused=false;await new Promise(r=>setTimeout(r,800));const list=solarExplorer.stats().solar.star_regions||[];const best=list.filter(r=>r[3]>0.3).sort((a,c)=>c[2]*c[3]-a[2]*a[3])[0];if(!best)return null;solarFlight.flight.look_at(0);${region.south?`solarFlight.flight.jump_over(10,best[0]-${region.south},best[1],${region.up*R});`:`solarFlight.flight.jump_facing(10,best[0],best[1]+${region.side},${region.up*R});`}await new Promise(r=>setTimeout(r,2500));solarExplorer.paused=true;return best;})()`);
   info.region=where;if(!where){console.log(name,'no active region');continue;}
  }
  const file=join(out,`${name}.png`);await capture(b,file,1920,1080,'display');
  rows.push({name,body,height,...info});console.log(name,JSON.stringify(info));
 }
}finally{await b.close();}
writeFileSync(join(out,'stars.json'),JSON.stringify({base,rows},null,1));
