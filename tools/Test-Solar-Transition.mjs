// The far planet and the full surface must meet without a jump. The owner: "the switch to earth far version is pretty harsh, especially when flying away,
// especially because of the clouds popping in". A flight straight in and straight out through the hand-over, at the day side, every frame stepped in
// order with no waiting: the change over the disk from one frame to the next, against the same flight's usual change, says how much of it was a jump. At the hand-over a disk is small, 41 pixels in radius at 1080p for Earth, so a mean over the whole screen would hide it.
// Replayed tiles and the pack only, in a private headless browser.
//   node tools/Test-Solar-Transition.mjs DIR [NAIF ...]
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {deflateSync} from 'node:zlib';
import {tileServer,headless,ready} from './Earth-Test-Lib.mjs';
const dir=process.argv[2]||'evidence/local/real-earth/runs/solar-transition';mkdirSync(dir,{recursive:true});
const bodies=process.argv.slice(3).map(Number);if(!bodies.length)bodies.push(399,499,301);
const server=await tileServer({port:5207,web:'web'});
const b=await headless(resolve(dir,'.profile'));
const W=1280,H=720,T=852076800,LAT=25,LON=-40,FRAMES=+(process.env.FRAMES||240);
try {
await b.send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:false});
await b.send('Page.navigate',{url:`${server.base}/explorer.html?test=1&body=solar&tiles=${encodeURIComponent(server.base)}&quality=high&limits=off&tdb=${T}`});
await ready(b);
await b.evaluate(`solarExplorer.resize(${W},${H})`);
await b.evaluate(`solarFlight.flight.set_rate(0);document.getElementById('solar-trails').checked=false;document.getElementById('solar-labels').checked=false`);
const crc=(()=>{const t=new Int32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c;});return buf=>{let c=-1;for(const x of buf)c=t[(c^x)&255]^(c>>>8);return (c^-1)>>>0;};})();
function png(rgba,w,h){const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++)rgba.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4);const chunk=(type,data)=>{const t=Buffer.concat([Buffer.from(type),data]),o=Buffer.alloc(data.length+12);o.writeUInt32BE(data.length,0);t.copy(o,4);o.writeUInt32BE(crc(t),data.length+8);return o;};const head=Buffer.alloc(13);head.writeUInt32BE(w,0);head.writeUInt32BE(h,4);head[8]=8;head[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(raw,{level:3})),chunk('IEND',Buffer.alloc(0))]);}
// Limits a jump must stay under: a frame's change against the frames around it, as the two versions differ in their ordinary noise, and the disk's mean
// brightness in a frame, 0 to 255. On the build before this one, the first was 4.2 for Earth, 2.4 for Mars and 1.6 for the Moon, and Earth's second was 18.9.
const LIMIT_RATIO=+(process.env.LIMIT_RATIO||1.5),LIMIT_STEP=+(process.env.LIMIT_STEP||1.5);
let bad=false;
const q=(a,f)=>{const v=[...a].sort((x,y)=>x-y);return v[Math.min(v.length-1,Math.floor(f*v.length))];};
const RADII={399:6371e3,499:3389.5e3,301:1737.4e3};
// In the page: a flight of N frames between two heights, geometric, facing the body, and each frame's mean absolute change over the disk and a margin, 0 to 255.
// The worst frame and the one before it are kept, for pictures.
const flight=(id,R,from,to)=>b.evaluate(`(async()=>{const f=solarFlight.flight,K=new Set(),out=[],N=${FRAMES};let prev=null,worst=-1;window.worst=null;
 for(let i=0;i<N;i++){const h=${from}*Math.pow(${to}/${from},i/(N-1));f.jump_facing(${id},${LAT},${LON},h);solarExplorer.camera=solarFlight.frame(1/60,K,100);while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));await solarExplorer.engine.flush();
  const a=new Uint8Array(await solarExplorer.capture('display'));const reach=Math.tan(Math.asin(${R}/(${R}+h)))/Math.tan(Math.PI/6)*${H}/2*1.1;let sum=0,n=0,lit=0;for(let y=Math.max(0,Math.floor(${H}/2-reach));y<Math.min(${H},${H}/2+reach);y++)for(let x=Math.max(0,Math.floor(${W}/2-reach));x<Math.min(${W},${W}/2+reach);x++){if((x-${W}/2)**2+(y-${H}/2)**2>reach*reach)continue;const k=(y*${W}+x)*4;lit+=a[k]+a[k+1]+a[k+2];if(prev)sum+=Math.abs(a[k]-prev[k])+Math.abs(a[k+1]-prev[k+1])+Math.abs(a[k+2]-prev[k+2]);n+=3;}
  const change=prev?sum/n:0;if(prev&&change>worst){worst=change;window.worst=[prev,a];}
  const s=solarExplorer.stats().solar;out.push({i,h,change,mean:lit/n,shown:!!s.surface_shown,blend:s.blend??null});prev=a;}
 return out;})()`,{awaitPromise:true});
const kept=async i=>Buffer.from(await b.evaluate(`(()=>{const a=window.worst[${i}];let s='';for(let k=0;k<a.length;k+=32768)s+=String.fromCharCode.apply(null,a.subarray(k,k+32768));return btoa(s);})()`),'base64');
for(const id of bodies){
 const R=RADII[id];
 await b.evaluate(`solarFlight.flight.jump_over(${id},${LAT},${LON},6e6)`);
 // Noon over the spot.
 await b.evaluate(`(async()=>{const K=new Set();for(let i=0;i<4;i++){solarExplorer.camera=solarFlight.frame(1/60,K,100);while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));}await solarExplorer.engine.flush();})()`,{awaitPromise:true});
 const sun=(await b.evaluate(`JSON.parse(solarExplorer.engine.settings())`)).sun;
 const lonSun=Math.atan2(sun[0],sun[2])*180/Math.PI,turn=(((lonSun-LON)%360)+360)%360;
 const day={399:86164.1,499:88642.7,301:2360591}[id];
 await b.evaluate(`solarFlight.flight.set_seconds(${T+turn/360*day})`);
 // Well inside, then well outside, the whole hand-over: the disk's half-angle from 0.2 to 0.05 rad.
 const near=R/Math.sin(0.2)-R,far=R/Math.sin(0.05)-R;
 // Cold settle at the near end, with the pinned pages in, before each flight out.
 const settle=()=>b.evaluate(`(async()=>{const K=new Set();let quiet=0;for(let i=0;i<1500&&quiet<30;i++){solarExplorer.camera=solarFlight.frame(1/60,K,100);while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));const s=solarExplorer.stats();quiet=s.solar.surface_shown&&s.data_lag.pages_in_flight===0?quiet+1:0;}await solarExplorer.engine.flush();})()`,{awaitPromise:true});
 for(const [name,from,to] of [['out',near,far],['in',far,near]]){
  await b.evaluate(`solarFlight.flight.jump_facing(${id},${LAT},${LON},${near})`);await settle();
  if(name==='in'){await b.evaluate(`solarFlight.flight.jump_facing(${id},${LAT},${LON},${far})`);await b.evaluate(`(async()=>{const K=new Set();for(let i=0;i<30;i++){solarExplorer.camera=solarFlight.frame(1/60,K,100);while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));}})()`,{awaitPromise:true});}
  const rows=await flight(id,R,from,to);
  writeFileSync(join(dir,`${id}-${name}.json`),JSON.stringify(rows));
  const changes=rows.slice(1).map(r=>r.change),usual=q(changes,.5),peak=rows.slice(1).reduce((x,y)=>y.change>x.change?y:x);
  const switches=rows.filter((r,i)=>i&&r.shown!==rows[i-1].shown).map(r=>`${r.shown?'on':'off'} at ${(r.h/1e3).toFixed(0)} km`);
  const step=Math.max(...rows.slice(1).map((r,i)=>Math.abs(r.mean-rows[i].mean)));const whole=rows.some(r=>r.blend>=1)&&rows.some(r=>!r.shown);
  const median=v=>[...v].sort((x,y)=>x-y)[v.length>>1];const local=Math.max(...changes.map((c,i)=>c/Math.max(median([...changes.slice(Math.max(0,i-8),i),...changes.slice(i+1,i+9)]),1e-3)));
  const ok=(whole||FRAMES<60)&&local<LIMIT_RATIO&&step<LIMIT_STEP;if(!ok)bad=true;
  const mean=peak.i?` mean brightness ${rows[peak.i-1].mean.toFixed(1)} to ${peak.mean.toFixed(1)};`:'';
  console.log(`${ok?'pass':'FAIL'} ${id} ${name}: largest brightness step ${step.toFixed(2)}, jump against neighbouring frames ${local.toFixed(2)}, covered the whole hand-over ${whole}; change per frame p50 ${usual.toFixed(2)} p95 ${q(changes,.95).toFixed(2)} p99 ${q(changes,.99).toFixed(2)} peak ${peak.change.toFixed(2)} (${(peak.change/Math.max(usual,1e-3)).toFixed(1)} times usual) at ${(peak.h/1e3).toFixed(0)} km;${mean} surface ${switches.join(', ')||'no switch'}`);
  writeFileSync(join(dir,`${id}-${name}-worst-before.png`),png(await kept(0),W,H));writeFileSync(join(dir,`${id}-${name}-worst-after.png`),png(await kept(1),W,H));
 }
}
console.log(bad?'FAILED':'passed');
process.exitCode=bad?1:0;
} finally {await b.close();server.close();}
