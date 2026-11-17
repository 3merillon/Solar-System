// Earth must be the same Earth after a visit to another body. The owner flew into the Atlantic and found "an arctic texture and up close solid
// sand". Over the same spot, in the same light, at several heights: before a trip to Mars and after it. Settings are compared, pictures kept.
// Replayed tiles and the pack only, in a private headless browser.
//   node tools/Test-Solar-Earth-Return.mjs DIR
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tileServer,headless,ready} from './Earth-Test-Lib.mjs';
const dir=process.argv[2]||'evidence/local/real-earth/runs/solar-earth-return';mkdirSync(dir,{recursive:true});
const server=await tileServer({port:5203,web:'web'});
const b=await headless(resolve(dir,'.profile'));
const W=1280,H=720,T=852076800,LAT=30,LON=-40,HEIGHTS=[6e6,3e5,3e4,3000,200,20];
await b.send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:false});
await b.send('Page.navigate',{url:`${server.base}/explorer.html?test=1&body=solar&tiles=${encodeURIComponent(server.base)}&quality=high&limits=off&tdb=${T}`});
await ready(b);
await b.evaluate(`solarExplorer.resize(${W},${H})`);
await b.evaluate(`solarFlight.flight.set_rate(0);document.getElementById('solar-trails').checked=false;document.getElementById('solar-labels').checked=false`);
const settle=()=>b.evaluate(`(async()=>{const K=new Set();let quiet=0;for(let i=0;i<1500&&quiet<30;i++){solarExplorer.camera=solarFlight.frame(1/60,K,100);while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));const s=solarExplorer.stats();quiet=s.solar.surface_shown&&s.data_lag.pages_in_flight===0?quiet+1:0;}await solarExplorer.engine.flush();})()`,{awaitPromise:true});
const frames=n=>b.evaluate(`(async()=>{const K=new Set();for(let i=0;i<${n};i++){solarExplorer.camera=solarFlight.frame(1/60,K,100);while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));}await solarExplorer.engine.flush();})()`,{awaitPromise:true});
// The renderer's own, from its stats: the page's copy of the settings says Earth whatever the body is, so it proves nothing.
const settings=()=>b.evaluate(`(()=>{const s=solarExplorer.stats().solar;return {body:s.body,...s.applied};})()`);
// Noon over the spot: the Sun in Earth's fixed axes gives how far round to set the clock.
await b.evaluate(`solarFlight.flight.jump_over(399,${LAT},${LON},6e6)`);await frames(4);
const sun=(await b.evaluate(`JSON.parse(solarExplorer.engine.settings())`)).sun;
const lonSun=Math.atan2(sun[0],sun[2])*180/Math.PI,turn=(((lonSun-LON)%360)+360)%360;
await b.evaluate(`solarFlight.flight.set_seconds(${T+turn/360*86164.1})`);
const round=async name=>{const first=await settings();console.log(name,JSON.stringify(first));
 for(const h of HEIGHTS){await b.evaluate(`solarFlight.flight.jump_over(399,${LAT},${LON},${h})`);await settle();const {data}=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(join(dir,`${name}-${h}.png`),Buffer.from(data,'base64'));}
 return first;};
const before=await round('before');
for(const id of [499,301]){await b.evaluate(`(()=>{const w=document.getElementById('world-select');w.value='${id}';w.onchange();})()`);await settle();console.log('at',id,JSON.stringify(await settings()));}
const away=await settings();if(away.water||away.clouds){console.log('FAIL: an airless body kept Earth\'s water or clouds');process.exitCode=1;}
await b.evaluate(`(()=>{const w=document.getElementById('world-select');w.value='399';w.onchange();})()`);await settle();
const after=await round('after');
let bad=false;for(const k of Object.keys(before))if(before[k]!==after[k]){console.log(`FAIL: Earth's ${k} was ${before[k]}, after a visit ${after[k]}`);bad=true;}
console.log(bad?'FAIL: Earth changed after a visit to another body':'Earth is the same after a visit');
process.exit(bad?1:0);
