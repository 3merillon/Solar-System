// Shared harness for Earth tests: the tile server under test plus a private headless browser.
// Replay never touches a live host. Recording needs an explicit call, with an allow list and a budget.
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {headless} from './Headless.mjs';
import {ready} from './Explorer-Test-Lib.mjs';
export const FIXTURE=resolve(process.env.SOLAR_FIXTURE||'evidence/local/real-earth/fixtures/tour');
export const LIVE_HOSTS='s3.amazonaws.com,tiles.maps.eox.at,wmts.geo.admin.ch';
export const PORT=+(process.env.SOLAR_TILES_PORT||5200);
export async function tileServer({record=false,dir=FIXTURE,web='web',maxRequests=0,bandwidth=0,latency=0,jitter=0,fail=0,notfound=0,seed=1,port=PORT,requestLog=false,limit=null}={}){
 const args=['tools/Serve-Tiles.mjs',record?'--record':'--replay',dir,'--port',String(port),'--web',resolve(web),'--abort-tracking','--seed',String(seed),'--extra-ports','2'];
 if(record)args.push('--allow-hosts',LIVE_HOSTS,'--max-requests',String(maxRequests),'--max-concurrency','4');
 if(bandwidth)args.push('--bandwidth-mbit',String(bandwidth));
 if(latency)args.push('--latency-ms',String(latency));
 if(jitter)args.push('--jitter-ms',String(jitter));
 if(fail)args.push('--fail-rate',String(fail));
 if(notfound)args.push('--notfound-rate',String(notfound));
 if(requestLog)args.push('--request-log');
 if(limit)args.push('--limit-hosts',limit.hosts,'--limit-rate',String(limit.rate),'--limit-burst',String(limit.burst),'--limit-block-s',String(limit.block||0));
 const child=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe'],windowsHide:true});
 let log='';child.stdout.on('data',d=>{log+=d;});child.stderr.on('data',d=>{log+=d;});
 const base=`http://127.0.0.1:${port}`;
 for(let i=0;i<100;i++){try{const r=await fetch(base+'/__stats');if(r.ok)break;}catch{}if(child.exitCode!==null)throw Error('tile server exited: '+log);await new Promise(r=>setTimeout(r,100));}
 return {base,log:()=>log,stats:async()=>(await fetch(base+'/__stats')).json(),reset:()=>fetch(base+'/__reset'),requests:async()=>(await fetch(base+'/__requests')).json(),control:q=>fetch(base+'/__control?'+new URLSearchParams(q)).then(r=>r.json()),close:()=>{child.kill();}};
}
// Without limits by default: most tests wait for a settled image, and that waits for pages nothing on screen reads. Tests of what a session asks of a source pass limits:true.
// SOLAR_QUERY (environment): appended to every explorer URL, for running a test with a switch (for example
// '&water=old' for the old water path; the water layer is the default, docs/WATER-LAYER.md).
export async function earthBrowser(dir,server,{width=1920,height=1080,view='earth-orbit',quality='high',extra='',limits=false}={}){
 const b=await headless(dir);
 await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
 await b.send('Page.navigate',{url:`${server.base}/explorer.html?test=1&body=earth&tiles=${encodeURIComponent(server.base)}&view=${view}&quality=${quality}${limits?'':'&limits=off'}${extra}${process.env.SOLAR_QUERY||''}`});
 await ready(b);
 await b.evaluate(`solarExplorer.resize(${width},${height})`);
 // The pinned pack is the promised starting state of every test, so wait for all of it.
 await b.evaluate(`(async()=>{for(let i=0;i<20000;i++){while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));const s=solarExplorer.stats().data_lag;if(s&&s.pages_uploaded>=1020)return;await new Promise(r=>setTimeout(r,1));}})()`);
 return b;
}
// Advance frames until the field is quiet: nothing wanted is missing and nothing is in flight.
export async function settle(b,{maxFrames=3600,quietFrames=45,update=''}={}){
 return b.evaluate(`(async()=>{let quiet=0,i=0,lag=null;for(;i<${maxFrames}&&quiet<${quietFrames};i++){${update}while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));while(solarExplorer.stats().pending)await new Promise(r=>setTimeout(r,0));await new Promise(r=>setTimeout(r,4));const s=solarExplorer.stats();lag=s.data_lag;const f=s.field||{};quiet=(lag&&lag.pages_in_flight===0&&lag.pages_queued===0&&(f.inFlight||0)===0&&(f.queued||0)===0)?quiet+1:0;}return{frames:i,quiet,lag,field:solarExplorer.stats().field,stats:solarExplorer.stats()};})()`);
}
// Fly a straight segment, in degrees and metres above sea level, at a fixed frame rate of simulated time.
export const toEye=(lon,lat,alt,R=6371000)=>{const a=lon*Math.PI/180,b=lat*Math.PI/180,r=R+alt;return [r*Math.cos(b)*Math.sin(a),r*Math.sin(b),r*Math.cos(b)*Math.cos(a)];};
export function look(eye,forward){return [eye,eye.map((v,i)=>v+forward[i]*1000)];}
export function heading(lon,lat,deg,pitch=-.25){const a=lon*Math.PI/180,b=lat*Math.PI/180,h=deg*Math.PI/180;const n=[Math.cos(b)*Math.sin(a),Math.sin(b),Math.cos(b)*Math.cos(a)];const e=[Math.cos(a),0,-Math.sin(a)];const north=[n[1]*e[2]-n[2]*e[1],n[2]*e[0]-n[0]*e[2],n[0]*e[1]-n[1]*e[0]];const f=[0,1,2].map(i=>north[i]*Math.cos(h)+e[i]*Math.sin(h)+n[i]*pitch);const l=Math.hypot(...f);return f.map(v=>v/l);}
export {headless,ready};
