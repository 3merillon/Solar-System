// The hand-over from the fine cloud sun-profile map (256 m texels) to the
// next one must be spread out: a 22-texel band (27 to 32 km, straight to the
// 4 km map where a cloud is one texel and its self-shadowing is gone) was a
// ring of appearing shadows that followed the camera.
//
// cloud_diagnostic 4096 writes, per cloud texel, the density-weighted fine
// map weight of the view march, the density-weighted edge coordinate of its
// samples (Chebyshev distance of their sun-ray exits from the fine map's
// centre, in texels) and the opacity. Cloud texels with opacity over 0.3 are
// binned by edge coordinate; the crossfade width is the distance in texels
// between the bins where the mean fine weight falls under 0.9 and under 0.1.
// bit 8192 (the former 104-texel hand-over) the same measure must stay under
// 32 texels (22 by construction), which checks that the measure responds.
// Usage: node tools/Test-Cloud-Crossfade.mjs [output dir] [port]
import {headless} from './Headless.mjs';
import {ready,runFrames,capture} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
const dir=process.argv[2]||'evidence/local/cloud-crossfade';const port=process.argv[3]||'5198';
await mkdir(dir,{recursive:true});
const W=1280,H=720;
const h2f=u=>{const s=(u>>15)&1,e=(u>>10)&31,m=u&1023;let v;if(e===0)v=m*2**-24;else if(e===31)v=m?NaN:Infinity;else v=(1+m/1024)*2**(e-15);return s?-v:v;};
const report={cases:[],gates:[]};const gate=(name,pass,detail)=>{report.gates.push({name,pass,detail});console.log(`${pass?'PASS':'FAIL'} ${name}: ${detail}`);};
function cloudSize(length,rw,rh){for(const q of [1,2,3,4,5,6,7,8]){const cw=Math.ceil(rw/q),ch=Math.ceil(rh/q);if(cw*ch*8===length)return {cw,ch,sc:q};}throw Error(`cloud buffer of ${length} bytes for ${rw}x${rh}`);}
const b=await headless(dir);
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:false});
 await b.send('Page.navigate',{url:`http://127.0.0.1:${port}/explorer.html?test=1&body=procedural&quality=high`});await ready(b);
 await b.evaluate(`solarExplorer.resize(${W},${H});solarExplorer.time=0;`);
 const st=await b.evaluate('solarExplorer.stats()');const RW=st.width,RH=st.height;
 for(const [name,place,altitude,pitch] of [['ground-up','forest',300,0.35],['in-layer','clouds',0,-0.18],['above-near','horizon',0,-0.5]]){
  await b.evaluate(`{solarExplorer.go(${JSON.stringify(place)});const base=solarExplorer.camera;const n=base[0].map(v=>v/Math.hypot(...base[0]));let t=base[1].map((v,k)=>v-base[0][k]);const d=t.reduce((a,v,k)=>a+v*n[k],0);t=t.map((v,k)=>v-d*n[k]);const l=Math.hypot(...t);t=t.map(v=>v/l);
   const r=Math.hypot(...base[0]);const eye=n.map(v=>v*(${altitude}>0?solarExplorer.engine.radius()+solarExplorer.engine.height(...n)+${altitude}:r));solarExplorer.camera=[eye,eye.map((v,k)=>v+1000*(t[k]+n[k]*${pitch})),n];solarExplorer.time=0;}`);
  await runFrames(b,90);await capture(b,`${dir}/${name}.png`,W,H);
  const profiles={};
  for(const [label,bits] of [['new',4096],['old',4096|8192]]){
   await b.evaluate(`solarExplorer.configure({cloud_diagnostic:${bits}})`);await runFrames(b,6);
   const dg=await capture(b,`${dir}/${name}-${label}-diag.bin`,RW,RH,'cloud');const du=new Uint16Array(dg.buffer,dg.byteOffset,dg.length/2);const {cw,ch}=cloudSize(dg.length,RW,RH);
   const bins=[];let cloudy=0;
   for(let i=0;i<cw*ch;i++){const fine=h2f(du[i*4+1]),edge=h2f(du[i*4+2]),opacity=h2f(du[i*4+3]);if(!(opacity>0.3)||!(edge<1000))continue;cloudy++;
    const k=Math.min(200,Math.round(edge));if(!bins[k])bins[k]={edge:k,n:0,fine:0};bins[k].n++;bins[k].fine+=fine;}
   const profile=bins.filter(x=>x&&x.n>=40).map(x=>({edge:x.edge,texels:x.n,fine:+(x.fine/x.n).toFixed(3)}));
   const crossAt=(level)=>{const x=profile.find(p=>p.fine<level);return x?x.edge:null;};
   const a=crossAt(0.9),c=crossAt(0.1);profiles[label]={cloudy,fine_0_9_texels:a,fine_0_1_texels:c,width_texels:(a!==null&&c!==null)?c-a:null,profile};
  }
  await b.evaluate('solarExplorer.configure({cloud_diagnostic:0})');await runFrames(b,3);
  report.cases.push({name,place,altitude,pitch,...profiles});
  const n=profiles.new,o=profiles.old;
  gate(`${name}: the fine-map hand-over spans at least 40 texels (10 km)`,n.width_texels!==null&&n.width_texels>=40,`fine weight under 0.9 from texel ${n.fine_0_9_texels}, under 0.1 from texel ${n.fine_0_1_texels} (${n.width_texels} texels wide, ${n.cloudy} cloud texels)`);
  gate(`${name}: the former hand-over (bit 8192) measures under three quarters of that`,o.width_texels!==null&&n.width_texels!==null&&o.width_texels<0.75*n.width_texels,`fine weight under 0.9 from texel ${o.fine_0_9_texels}, under 0.1 from texel ${o.fine_0_1_texels} (${o.width_texels} texels wide)`);
 }
}finally{await b.close();}
await writeFile(`${dir}/report.json`,JSON.stringify(report,null,1));
const failed=report.gates.filter(g=>!g.pass).length;console.log(failed?`${failed} gate(s) failed`:'all gates passed');process.exit(failed?1:0);
