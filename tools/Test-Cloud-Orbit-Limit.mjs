// Clouds seen from orbit must not depend on where they fall on the screen.
// Below full cloud resolution each cloud texel's ray passes through the corner
// shared by four full-resolution pixels; the opaque limit of one of those
// pixels was the terrain under a ray half a pixel away, which near the limb
// is tens of kilometres nearer than the ray's own cloud-shell entry, so the
// march ended before the clouds over a camera-fixed part of the screen
// (clouds vanished while their shadows stayed on the ground).
//
// Two independent checks on one orbital camera, 738 x 588 like the report:
// 1. March trace (cloud_diagnostic 2048): every cloud texel on the planet,
//    away from the limb, must integrate the whole shell crossing.
// 2. Four rolls of the camera: per world cell the cloudiest roll is the
//    reference; the fraction of pixels a roll draws clear while the reference
//    is cloudy must not favour one side of the screen (a world-fixed residual
//    rotates with the roll, a defect does not).
// Usage: node tools/Test-Cloud-Orbit-Limit.mjs [output dir] [port]
import {headless} from './Headless.mjs';
import {ready,runFrames,capture} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
const dir=process.argv[2]||'evidence/local/cloud-orbit-limit';const port=process.argv[3]||'5198';
await mkdir(dir,{recursive:true});
const R=6371000;const DISTANCE=16.5e6;const W=738,H=588;
const norm=v=>{const l=Math.hypot(...v);return v.map(x=>x/l);};const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const h2f=u=>{const s=(u>>15)&1,e=(u>>10)&31,m=u&1023;let v;if(e===0)v=m*2**-24;else if(e===31)v=m?NaN:Infinity;else v=(1+m/1024)*2**(e-15);return s?-v:v;};
const report={cases:[],gates:[]};const gate=(name,pass,detail)=>{report.gates.push({name,pass,detail});console.log(`${pass?'PASS':'FAIL'} ${name}: ${detail}`);};
async function open(query){const b=await headless(dir);await b.send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:false});await b.send('Page.navigate',{url:`http://127.0.0.1:${port}/${query}`});await ready(b);await b.evaluate(`solarExplorer.resize(${W},${H});solarExplorer.go('orbit');solarExplorer.time=0;`);await runFrames(b,10);return b;}
function cloudSize(length,rw,rh){for(const q of [1,2,3,4,5,6,7,8]){const cw=Math.ceil(rw/q),ch=Math.ceil(rh/q);if(cw*ch*8===length)return {cw,ch,sc:q};}throw Error(`cloud buffer of ${length} bytes for ${rw}x${rh}`);}
for(const preset of ['high','minimal']){
 const b=await open(`?test=1&body=procedural&quality=${preset}`);
 try{
  const s=JSON.parse(await b.evaluate('solarExplorer.engine.settings()'));const sun=norm(s.sun);const t=norm(cross(sun,[0,0,1]));const u=cross(t,sun);
  const eye=sun.map(v=>v*DISTANCE);const side=norm(cross(sun,t));
  const st=await b.evaluate('solarExplorer.stats()');const RW=st.width,RH=st.height;
  // 1. March trace at the first roll.
  await b.evaluate('solarExplorer.configure({cloud_diagnostic:2048})');await b.evaluate(`solarExplorer.camera=${JSON.stringify([eye,[0,0,0],t])}`);await runFrames(b,30);
  const tr=await capture(b,`${dir}/${preset}-trace.bin`,RW,RH,'cloud');const tu=new Uint16Array(tr.buffer,tr.byteOffset,tr.length/2);const {cw,ch,sc}=cloudSize(tr.length,RW,RH);
  const pos=await capture(b,`${dir}/${preset}-position.bin`,RW,RH,'position');const pf=new Float32Array(pos.buffer,pos.byteOffset,pos.length/4);
  // Disc geometry: the planet subtends asin(R/D); keep texels inside 95% of it.
  const half=Math.tan(30*Math.PI/180);const rim=Math.tan(Math.asin(R/DISTANCE))/half*RH/2;
  let n=0,short=0,negative=0,worst=0;const shortBySector=new Array(8).fill(0),nBySector=new Array(8).fill(0);
  for(let ty=0;ty<ch;ty++)for(let tx=0;tx<cw;tx++){const px=tx*sc+sc/2,py=ty*sc+sc/2;const r=Math.hypot(px-RW/2,py-RH/2);if(r>rim*0.95)continue;const pi=(Math.min(RH-1,Math.floor(py))*RW+Math.min(RW-1,Math.floor(px)))*4;if(pf[pi]*pf[pi]+pf[pi+1]*pf[pi+1]+pf[pi+2]*pf[pi+2]<0.01)continue;
   const i=(ty*cw+tx)*4;const path=h2f(tu[i+1]),margin=h2f(tu[i+2]);n++;const sec=Math.floor(((Math.atan2(py-RH/2,px-RW/2)+Math.PI)/(2*Math.PI))*8)%8;nBySector[sec]++;
   if(path<8000){short++;shortBySector[sec]++;}if(margin<0){negative++;}if(8000-path>worst)worst=8000-path;}
  const shortFraction=short/Math.max(1,n);
  report.cases.push({preset,check:'trace',cloud:`${cw}x${ch}`,texels:n,short,negative,shortBySector:shortBySector.map((v,i)=>+(v/Math.max(1,nBySector[i])).toFixed(4))});
  gate(`${preset}: cloud texels inside the disc integrate the shell crossing`,shortFraction<0.005&&negative===0,`${short} of ${n} texels (${cw}x${ch}) integrate under 8 km, ${negative} have an opaque limit before the shell entry, by screen sector ${shortBySector.map((v,i)=>(v/Math.max(1,nBySector[i])).toFixed(3)).join(' ')}`);
  // 2. Four rolls.
  await b.evaluate('solarExplorer.configure({cloud_diagnostic:0})');
  const N=128;const views=[];
  for(const [k,up] of [[0,t],[90,side],[180,t.map(v=>-v)],[270,side.map(v=>-v)]]){
   await b.evaluate(`solarExplorer.camera=${JSON.stringify([eye,[0,0,0],up])}`);await runFrames(b,30);
   const p=await capture(b,`${dir}/${preset}-roll${k}-position.bin`,RW,RH,'position');const c=await capture(b,`${dir}/${preset}-roll${k}-cloud.bin`,RW,RH,'cloud');
   await capture(b,`${dir}/${preset}-roll${k}.png`,W,H);
   const pp=new Float32Array(p.buffer,p.byteOffset,p.length/4);const cu=new Uint16Array(c.buffer,c.byteOffset,c.length/2);
   const cell=new Int32Array(RW*RH).fill(-1);const alpha=new Float32Array(RW*RH);
   for(let y=0;y<RH;y++)for(let x=0;x<RW;x++){const i=y*RW+x;const px=pp[i*4],py=pp[i*4+1],pz=pp[i*4+2];if(px*px+py*py+pz*pz<0.01)continue;
    const wx=eye[0]+px,wy=eye[1]+py,wz=eye[2]+pz;const rr=Math.hypot(wx,wy,wz);const nx=wx/rr,ny=wy/rr,nz=wz/rr;const ax=Math.abs(nx),ay=Math.abs(ny),az=Math.abs(nz);let face,uu,vv;
    if(ax>=ay&&ax>=az){face=nx>0?0:1;uu=(nx>0?-nz:nz)/ax;vv=ny/ax;}else if(ay>=az){face=ny>0?2:3;uu=nx/ay;vv=(ny>0?-nz:nz)/ay;}else{face=nz>0?4:5;uu=(nz>0?nx:-nx)/az;vv=ny/az;}
    cell[i]=(face*N+Math.min(N-1,Math.floor((vv+1)/2*N)))*N+Math.min(N-1,Math.floor((uu+1)/2*N));alpha[i]=h2f(cu[(Math.min(ch-1,Math.floor(y/sc))*cw+Math.min(cw-1,Math.floor(x/sc)))*4+3]);}
   views.push({k,cell,alpha});
  }
  const ref=new Map();for(const v of views)for(let i=0;i<RW*RH;i++){const c=v.cell[i];if(c<0)continue;const cur=ref.get(c);if(cur===undefined||v.alpha[i]<cur)ref.set(c,v.alpha[i]);}
  const rolls=[];
  for(const v of views){const sec=Array.from({length:8},()=>({n:0,missing:0}));let nn=0,missing=0;
   for(let y=0;y<RH;y++)for(let x=0;x<RW;x++){const i=y*RW+x;const c=v.cell[i];if(c<0)continue;const sIdx=Math.floor(((Math.atan2(y-RH/2,x-RW/2)+Math.PI)/(2*Math.PI))*8)%8;sec[sIdx].n++;nn++;if(v.alpha[i]>0.9&&ref.get(c)<0.5){missing++;sec[sIdx].missing++;}}
   rolls.push({roll:v.k,missing:+(missing/nn).toFixed(4),sectors:sec.map(e=>+(e.missing/Math.max(1,e.n)).toFixed(4))});}
  // Screen-fixed asymmetry: left sectors (0, 1, 7) against right (3, 4, 5), averaged over the rolls.
  const asym=rolls.reduce((s,r)=>s+((r.sectors[0]+r.sectors[1]+r.sectors[7])-(r.sectors[3]+r.sectors[4]+r.sectors[5]))/3,0)/rolls.length;
  // World-fixed residual: the profile of roll 180 is roll 0 shifted by four sectors.
  const residual=rolls[0].sectors.reduce((s,v,i)=>s+Math.abs(v-rolls[2].sectors[(i+4)%8]),0)/8;
  report.cases.push({preset,check:'rolls',rolls,asymmetry:+asym.toFixed(4),residual:+residual.toFixed(4)});
  gate(`${preset}: missing clouds do not favour one side of the screen`,Math.abs(asym)<0.03,`left minus right missing fraction ${asym.toFixed(4)} averaged over four rolls (0.28 before the fix); rolls ${rolls.map(r=>r.missing).join(' ')}; roll 0 against roll 180 shifted ${residual.toFixed(4)}`);
 }finally{await b.close();}
}
await writeFile(`${dir}/report.json`,JSON.stringify(report,null,1));
const failed=report.gates.filter(g=>!g.pass).length;console.log(failed?`${failed} gate(s) failed`:'all gates passed');process.exit(failed?1:0);
