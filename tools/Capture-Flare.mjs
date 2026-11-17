// A flare on the Sun, followed through its course from two places: the clock runs until one of the larger active regions
// flares (the page's own list, stats().solar.star_regions: latitude, longitude, size, life, age, phase, impulse), then at each
// phase asked for the clock is stopped and the region is captured from close over it (looking north and down at it), from the
// side with the region at the limb, and from far out to one side (for the ejection in the corona). Familiar view by default. Private headless browser only.
//   node tools/Capture-Flare.mjs --base http://127.0.0.1:5412 --out DIR [--phases 0.3,1,2,4,6,8] [--rate 2] [--view 1]
// --rate is the page's clock step (0 stopped, 1 real time, 2 ten times, 3 sixty times): at 2 a flare's decay time is 3.6 s.
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {headless} from './Headless.mjs';
import {ready,capture} from './Explorer-Test-Lib.mjs';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const base=arg('base','http://127.0.0.1:5412'),out=resolve(arg('out','evidence/local/flare'));mkdirSync(out,{recursive:true});
const phases=arg('phases','0.3,1,2,4,6,8').split(',').map(Number),rate=+arg('rate','2'),view=arg('view','1');
const T=852076800,R=6.957e8;
const b=await headless(join(out,'.profile'));const rows=[];let found=null;
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
 await b.send('Page.navigate',{url:`${base}/explorer.html?test=1&quality=high&limits=off&body=solar&tdb=${T}&at=10&height=${R}`});await ready(b);
 await b.evaluate(`(()=>{const e=document.getElementById('solar-star-view');if(e){e.value='${view}';e.dispatchEvent(new Event('change'));}})()`);
 // Run the clock until a larger region's flare has just begun.
 found=await b.evaluate(`(async()=>{solarFlight.flight.look_at(10);solarExplorer.paused=false;solarFlight.setRate(${rate});
  for(let i=0;i<6000;i++){await new Promise(r=>setTimeout(r,100));const list=solarExplorer.stats().solar.star_regions||[];
   const k=list.findIndex(r=>r[2]>=0.45&&r[3]>0.5&&r[5]>=0&&r[5]<${Math.min(...phases)});if(k>=0){solarFlight.setRate(0);return {index:k,region:list[k]};}}
  solarFlight.setRate(0);return null;})()`);
 if(!found)throw Error('no flare began in ten minutes of waiting');
 console.log('flare',JSON.stringify(found));
 const [lat,lon]=found.region;
 for(const phase of phases){
  // On to this phase, then stop the clock and look from both places.
  const now=await b.evaluate(`(async()=>{solarFlight.setRate(${rate});for(let i=0;i<3000;i++){const r=(solarExplorer.stats().solar.star_regions||[])[${found.index}];if(!r||r[5]<0||r[5]>=${phase})break;await new Promise(r=>setTimeout(r,50));}solarFlight.setRate(0);return (solarExplorer.stats().solar.star_regions||[])[${found.index}];})()`);
  for(const [name,jump] of [['over',`solarFlight.flight.jump_over(10,${lat}-9,${lon},${0.18*R});`],['limb',`solarFlight.flight.jump_facing(10,${lat},${lon}+45,${0.6*R});`],['far',`solarFlight.flight.jump_facing(10,${lat},${lon}+80,${11*R});`]]){
   await b.evaluate(`(async()=>{solarFlight.flight.look_at(0);${jump}await new Promise(r=>setTimeout(r,1500));})()`);
   await capture(b,join(out,`${name}-${String(phase).replace('.','_')}.png`),1920,1080,'display');
  }
  rows.push({asked:phase,region:now});console.log('phase',phase,JSON.stringify(now));
 }
}finally{await b.close();}
writeFileSync(join(out,'flare.json'),JSON.stringify({base,rate,view,found,rows},null,1));
