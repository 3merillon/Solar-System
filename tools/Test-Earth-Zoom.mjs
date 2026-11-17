// Detail must not pop. Two measurements, both from replayed tiles in real time.
// 1. Pulsed descent, like a mouse wheel: bursts of speed with pauses. Diagnostic view 5 holds served levels per
//    pixel. Report how much of the image loses served level from one frame to the next, which detail going
//    back and forth would show. A descent keeps refining, so this should stay near zero; the ground moving
//    under fixed pixels leaves a small floor, which the same run on an older build puts in context.
// 2. A held camera after a cut, while pages arrive. Past the first twelve frames, which show the cut itself, only
//    data can change the image, so per-frame change is the size of the pops. Report the share of pixels that
//    jump visibly in one frame.
//   node tools/Test-Earth-Zoom.mjs [--web DIR] [--stop portofino] --output DIR
import {tileServer,earthBrowser,settle,toEye,heading} from './Earth-Test-Lib.mjs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const dir=resolve(arg('output','evidence/local/real-earth/runs/zoom'));await mkdir(dir,{recursive:true});
const W=+arg('width',640),H=+arg('height',360),bandwidth=+arg('bandwidth',100),latency=+arg('latency',40);
const tour=JSON.parse(await readFile('tools/fixtures/earth-tour.json','utf8'));
const stops=arg('stops','portofino,dents-low').split(',');
const quant=v=>{v=[...v].sort((x,y)=>x-y);const q=p=>v[Math.min(v.length-1,Math.ceil(v.length*p)-1)]??null;return {n:v.length,p50:q(.5),p95:q(.95),p99:q(.99),max:v.at(-1)??null};};
const server=await tileServer({web:arg('web','web'),bandwidth,latency});
const report={web:arg('web','web'),width:W,height:H,bandwidth,latency,stops:[]};
let b;
try{
 b=await earthBrowser(dir,server,{view:'earth-orbit',width:W,height:H});
 for(const name of stops){
  const s=tour.stops.find(t=>t.name===name);if(!s)throw Error('no stop '+name);
  const f=heading(s.lon,s.lat,s.heading,-.35),row={stop:name};
  const place=alt=>{const eye=toEye(s.lon,s.lat,alt);return JSON.stringify([eye,eye.map((v,i)=>v+f[i]*1000)]);};
  // Start high and settled, then descend in pulses to a little above the ground.
  await b.evaluate(`solarExplorer.configure({clouds:false,debug:5});solarExplorer.camera=${place(s.alt+12000)};`);
  await settle(b,{maxFrames:6000});
  const ground=await b.evaluate('solarExplorer.engine.height(0,1,0)');
  row.descent=await b.evaluate(`(async()=>{
   var toEye=${toEye};const s=${JSON.stringify({lon:s.lon,lat:s.lat})},f=${JSON.stringify(f)},low=Math.max(${ground},0)+150;
   const half=v=>{const e=(v>>10)&31,m=v&1023;return e===0?m*2**-24:(1+m/1024)*2**(e-15);};
   const levels=async()=>{const raw=await solarExplorer.capture('shaded');const v=new Uint16Array(raw.buffer,raw.byteOffset,raw.byteLength>>1),n=v.length>>2,c=new Float32Array(2*n);for(let i=0;i<n;i++){c[2*i]=half(v[4*i]);c[2*i+1]=half(v[4*i+1]);}return c;};
   let alt=${s.alt+12000},prev=null;const lost=[];
   for(let pulse=0;pulse<16;pulse++){
    for(let i=0;i<28;i++){
     // Eighteen frames of movement, then ten of rest, each pulse a fifth of the height above the ground.
     if(i<18){const u=(i+.5)/18;alt=low+(alt-low)*(1-0.2*Math.sin(u*Math.PI)*Math.PI/18);}
     const eye=toEye(s.lon,s.lat,alt);solarExplorer.camera=[eye,eye.map((v,k)=>v+f[k]*1000)];
     await new Promise(requestAnimationFrame);while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));
     const c=await levels();
     if(prev){let surface=0,down=0;for(let k=0;k<c.length;k+=2){if(!(c[k]>0||c[k+1]>0)||!(prev[k]>0||prev[k+1]>0))continue;surface++;if(c[k]<prev[k]-.5||c[k+1]<prev[k+1]-.5)down++;}if(surface)lost.push(down/surface);}
     prev=c;
    }
   }
   return {final_altitude:alt,lost};
  })()`);
  row.descent.lost_per_frame=quant(row.descent.lost);delete row.descent.lost;
  // Held camera after a cut: a far view settles, then the camera cuts in and holds.
  await b.evaluate(`solarExplorer.configure({clouds:false,debug:0});solarExplorer.camera=${place(s.alt+60000)};`);
  await settle(b,{maxFrames:6000});
  row.held=await b.evaluate(`(async()=>{
   const luma=async()=>{const raw=await solarExplorer.capture('display');const n=raw.length>>2,c=new Float32Array(n);for(let i=0;i<n;i++)c[i]=.2126*raw[4*i]+.7152*raw[4*i+1]+.0722*raw[4*i+2];return c;};
   solarExplorer.camera=${place(s.alt)};
   for(let i=0;i<4;i++){await new Promise(requestAnimationFrame);while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));}
   let prev=await luma();const jumps=[],means=[],start=performance.now();let frame=0;
   while(performance.now()-start<8000){
    await new Promise(requestAnimationFrame);while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));
    const c=await luma();let big=0,sum=0;for(let k=0;k<c.length;k++){const d=Math.abs(c[k]-prev[k]);sum+=d;if(d>12)big++;}
    frame++;if(frame>12){jumps.push(big/c.length);means.push(sum/c.length);}prev=c;
   }
   return {jumps,means};
  })()`);
  row.held.frames=row.held.jumps.length;row.held.visible_jump_share_per_frame=quant(row.held.jumps);row.held.mean_change_per_frame=quant(row.held.means);delete row.held.jumps;delete row.held.means;
  report.stops.push(row);console.log(JSON.stringify(row));
 }
 const st=await server.stats();report.server={requests:st.requests,misses:st.misses,upstream:st.upstreamFetches};
 console.log(JSON.stringify(report.server));
}finally{await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,1));if(b)await b.close();server.close();}
