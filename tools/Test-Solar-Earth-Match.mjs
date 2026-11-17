// Earth through the solar system's path against the same Earth through ?body=earth: one camera and one sun, with the
// clouds off, since their animation differs by clock. Sky pixels differ on purpose: stars and the Sun's true size. This
// compares where both show surface. Replayed tiles, private browser. --control moves the sun a little, and must then fail:
// a compare of nothing once passed in this project.
//   node tools/Test-Solar-Earth-Match.mjs DIR [--control]
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {inflateSync} from 'node:zlib';
import {tileServer,headless,ready,settle} from './Earth-Test-Lib.mjs';
import {capture} from './Explorer-Test-Lib.mjs';
const dir=process.argv[2]||'evidence/local/real-earth/runs/solar-earth';mkdirSync(dir,{recursive:true});
const server=await tileServer({port:5201,web:'web'});
const W=1280,H=720,T=852076800,HEIGHT=600e3;
const open=async(name,query)=>{const b=await headless(resolve(dir,'.profile-'+name));await b.send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:false});await b.send('Page.navigate',{url:`${server.base}/explorer.html?test=1&tiles=${encodeURIComponent(server.base)}&quality=high&limits=off&${query}`});await ready(b);await b.evaluate(`solarExplorer.resize(${W},${H})`);return b;};
const solar=await open('solar',`body=solar&tdb=${T}`);
await solar.evaluate(`solarFlight.flight.set_rate(0);solarFlight.flight.jump_near(399,${HEIGHT})`);
await solar.evaluate(`solarExplorer.configure({clouds:false})`);
const step=`(async()=>{const K=new Set();let quiet=0;for(let i=0;i<2400&&quiet<45;i++){solarExplorer.camera=solarFlight.frame(1/60,K,100);while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));const s=solarExplorer.stats();quiet=s.solar.surface_shown&&s.data_lag.pages_in_flight===0?quiet+1:0;}while(solarExplorer.stats().pending)await new Promise(r=>setTimeout(r,0));})()`;
await solar.evaluate(step);
const packet=await solar.evaluate(`[...solarFlight.flight.packet(${W},${H})].slice(0,14)`);
await capture(solar,join(dir,'solar.png'),W,H);
const eye=packet.slice(0,3),forward=packet.slice(3,6),up=packet.slice(6,9),sun=packet.slice(11,14);
if(process.argv.includes('--control'))sun[0]+=0.05;
const earth=await open('earth','body=earth&view=earth-orbit');
await earth.evaluate(`solarExplorer.configure({clouds:false,sun:${JSON.stringify(sun)}})`);
await earth.evaluate(`solarExplorer.camera=${JSON.stringify([eye,eye.map((v,i)=>v+forward[i]*1000),up])}`);
await settle(earth,{maxFrames:2400});
await capture(earth,join(dir,'earth.png'),W,H);
function pixels(file){const b=readFileSync(file);let at=8,idat=[],w=0,h=0;while(at<b.length){const n=b.readUInt32BE(at),t=b.toString('latin1',at+4,at+8);if(t==='IHDR'){w=b.readUInt32BE(at+8);h=b.readUInt32BE(at+12);}if(t==='IDAT')idat.push(b.subarray(at+8,at+8+n));at+=12+n;}const raw=inflateSync(Buffer.concat(idat)),out=Buffer.alloc(w*h*4);for(let y=0;y<h;y++)raw.copy(out,y*w*4,y*(w*4+1)+1,(y+1)*(w*4+1));return {w,h,out};}
const a=pixels(join(dir,'solar.png')),c=pixels(join(dir,'earth.png'));let sum=0,peak=0,n=0,mean=[0,0,0,0,0,0];
for(let i=0;i<a.w*a.h*4;i+=4){for(let k=0;k<3;k++){const d=Math.abs(a.out[i+k]-c.out[i+k]);sum+=d;peak=Math.max(peak,d);n++;mean[k]+=a.out[i+k];mean[k+3]+=c.out[i+k];}}
const result={eye,sun,mean_difference:sum/n,peak,solar_mean:mean.slice(0,3).map(v=>v*3/n),earth_mean:mean.slice(3).map(v=>v*3/n)};
writeFileSync(join(dir,'result.json'),JSON.stringify(result,null,1));console.log(JSON.stringify(result));process.exit(0);
