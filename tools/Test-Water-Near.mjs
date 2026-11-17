// The near water field must be as detailed as the far one. Below 24 m from
// the eye (and in the caustic integration below 23 m) the waves come from
// the fine level of the wave cache; an allocation that left that level out
// (the tier sizing counted the four coarse levels only, 27-28 October 2026)
// flattened every wave within 24 m, rounded the Snell's window from below
// and blurred the caustics, while the audit of the ripple field saw nothing.
//
// Gates, at the shore of the 'ground' bookmark with the sea raised to 8 m:
// 1. audit_water: the wave cache fits its layout, every level is populated
//    and finite, and the fine level carries at least 0.8 of the base level's
//    mean slope.
// 2. Waterline view (1.2 m above the water, 10 degrees down): the high-pass
//    luminance detail of the surface at 2-8 m is at least half of that at
//    16-32 m (0.014 of it with the fine level missing, 0.9 with it).
// 3. Floor view (2 m under, 24 degrees down): the caustic detail on the bed
//    at 8-20 m is at least half of that at 24-40 m (0.09 before, 2.8 after).
// 4. Snell's window (1 m under, looking up): the window's edge is lobed by
//    the waves, RMS residual of the edge row against a quadratic fit across
//    the columns at least 4 px (0.4 px with a flat near surface, 46 px with
//    the fine level).
// The minimal allocation tier (wave base 512) repeats gate 1.
// Usage: node tools/Test-Water-Near.mjs [output dir] [port]
import {headless} from './Headless.mjs';
import {ready,runFrames,capture} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
const dir=process.argv[2]||'evidence/local/water-near';const port=process.argv[3]||'5198';
await mkdir(dir,{recursive:true});
const W=1003,H=731;
const h2f=u=>{const s=(u>>15)&1,e=(u>>10)&31,m=u&1023;let v;if(e===0)v=m*2**-24;else if(e===31)v=m?NaN:Infinity;else v=(1+m/1024)*2**(e-15);return s?-v:v;};
const report={cases:[],gates:[]};const gate=(name,pass,detail)=>{report.gates.push({name,pass,detail});console.log(`${pass?'PASS':'FAIL'} ${name}: ${detail}`);};
async function open(query){const b=await headless(dir);await b.send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:false});await b.send('Page.navigate',{url:`http://127.0.0.1:${port}/explorer.html?test=1&body=procedural&${query}`});await ready(b);
 await b.evaluate(`solarExplorer.resize(${W},${H});solarExplorer.go('ground');window.base=solarExplorer.camera;window.n=base[0].map(v=>v/Math.hypot(...base[0]));window.h=solarExplorer.engine.height(...n);window.tangent=base[1].map((v,k)=>v-base[0][k]);let d=tangent.reduce((a,v,k)=>a+v*n[k],0);tangent=tangent.map((v,k)=>v-d*n[k]);let l=Math.hypot(...tangent);tangent=tangent.map(v=>v/l);solarExplorer.configure({sea:h+8,clouds:false});`);
 await runFrames(b,360);return b;}
function cacheGate(label,audit){
 const cache=audit.wave_cache;const levels=cache.levels;const base=levels[0],fine=levels[4];
 const ok=cache.fits&&levels.every(l=>l.populated>=0.99&&l.nonfinite===0)&&fine.mean_slope>=0.8*base.mean_slope;
 gate(`${label}: wave cache fits its layout and every level is populated`,ok,`${cache.bytes} of ${cache.required_bytes} bytes, populated ${levels.map(l=>l.populated.toFixed(3)).join(' ')}, mean slope base ${base.mean_slope.toFixed(4)} fine ${fine.mean_slope.toFixed(4)}`);
 report.cases.push({label,wave_cache:cache});
}
{
 const b=await open('quality=high');
 try{
  const st=await b.evaluate('solarExplorer.stats()');const RW=st.width,RH=st.height;
  cacheGate(`high (${st.tier.name} tier, wave base ${st.tier.wave_base})`,JSON.parse(await b.evaluate('solarExplorer.engine.audit_water()')));
  const lum=(wu,i)=>0.2126*h2f(wu[i*4])+0.7152*h2f(wu[i*4+1])+0.0722*h2f(wu[i*4+2]);
  const detailOf=(L)=>(i)=>{const x=i%RW,y=(i/RW)|0;let s=0,n=0;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=RW||yy>=RH)continue;s+=L[yy*RW+xx];n++;}return Math.abs(L[i]-s/n);};
  const binned=(ranges,key,value)=>{const bins=ranges.map(([from,to])=>({from,to,n:0,sum:0}));return {add:(d,v)=>{const bn=bins.find(x=>d>=x.from&&d<x.to);if(bn){bn.n++;bn.sum+=v;}},mean:(from,to)=>{const bn=bins.find(x=>x.from===from&&x.to===to);return bn&&bn.n>200?bn.sum/bn.n:NaN;},bins};};
  for(const [name,altitude,look] of [['near',9.2,-0.18],['snell',7.0,1.0],['floor',6.0,-0.45]]){
   await b.evaluate(`{let eye=n.map(v=>v*(solarExplorer.engine.radius()+h+${altitude}));solarExplorer.camera=[eye,eye.map((v,k)=>v+1000*(tangent[k]+n[k]*${look})),n];}`);
   await runFrames(b,120,'solarExplorer.time=i/60;');
   await capture(b,`${dir}/${name}.png`,W,H);
   const water=await capture(b,`${dir}/${name}-water.bin`,RW,RH,'water');const wu=new Uint16Array(water.buffer,water.byteOffset,water.length/2);
   const ocean=await capture(b,`${dir}/${name}-ocean.bin`,RW,RH,'ocean');const of=new Float32Array(ocean.buffer,ocean.byteOffset,ocean.length/4);
   const pos=await capture(b,`${dir}/${name}-position.bin`,RW,RH,'position');const pf=new Float32Array(pos.buffer,pos.byteOffset,pos.length/4);
   const L=new Float32Array(RW*RH);for(let i=0;i<RW*RH;i++)L[i]=lum(wu,i);const detail=detailOf(L);
   if(name==='near'){
    const bins=binned([[2,8],[16,32]]);
    for(let i=0;i<RW*RH;i++){const t=of[i*2];const a=h2f(wu[i*4+3]);if(!(t>0&&t<1e9)||a<0.5)continue;bins.add(t,detail(i));}
    const near=bins.mean(2,8),far=bins.mean(16,32);
    gate('waterline: surface detail at 2-8 m is at least half of that at 16-32 m',near>=0.5*far,`detail ${near.toFixed(5)} at 2-8 m, ${far.toFixed(5)} at 16-32 m (${bins.bins.map(x=>x.n).join('/')} pixels)`);
    report.cases.push({name,near,far});
   }else if(name==='snell'){
    const sorted=Float32Array.from(L).sort();const bright=sorted[Math.floor(sorted.length*0.9)],dark=sorted[Math.floor(sorted.length*0.1)];const threshold=(bright+dark)/2;
    // Edge row per column (first row under the threshold, columns whose top is bright), against a quadratic fit.
    const pts=[];for(let x=0;x<RW;x++){if(L[x]<=threshold)continue;for(let y=1;y<RH;y++){if(L[y*RW+x]<threshold){if(y>2&&y<RH-3)pts.push([x/RW*2-1,y]);break;}}}
    let s=[0,0,0,0,0],t=[0,0,0];for(const [x,y] of pts){s[0]++;s[1]+=x;s[2]+=x*x;s[3]+=x*x*x;s[4]+=x*x*x*x;t[0]+=y;t[1]+=x*y;t[2]+=x*x*y;}
    const M=[[s[0],s[1],s[2]],[s[1],s[2],s[3]],[s[2],s[3],s[4]]];const det=m=>m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
    const D=det(M);const col=(k)=>M.map((r,i)=>r.map((v,j)=>j===k?t[i]:v));const coef=D?[det(col(0))/D,det(col(1))/D,det(col(2))/D]:[0,0,0];
    let rss=0;for(const [x,y] of pts){const e=y-(coef[0]+coef[1]*x+coef[2]*x*x);rss+=e*e;}const residual=Math.sqrt(rss/Math.max(1,pts.length));
    gate("Snell's window: the window edge is lobed by waves",pts.length>RW/4&&residual>=4.0,`RMS residual of the edge row against a quadratic fit ${residual.toFixed(2)} px over ${pts.length} columns (threshold luminance ${threshold.toFixed(3)})`);
    report.cases.push({name,residual,columns:pts.length,bright,dark});
   }else{
    const bins=binned([[8,20],[24,40]]);
    for(let i=0;i<RW*RH;i++){const a=h2f(wu[i*4+3]);const g=Math.hypot(pf[i*4],pf[i*4+1],pf[i*4+2]);if(a>0.5||g<0.01||g>1e9)continue;const t=of[i*2];if(t>0&&t<g)continue;bins.add(g,detail(i));}
    const near=bins.mean(8,20),far=bins.mean(24,40);
    gate('floor: caustic detail at 8-20 m is at least half of that at 24-40 m',near>=0.5*far,`detail ${near.toFixed(5)} at 8-20 m, ${far.toFixed(5)} at 24-40 m (${bins.bins.map(x=>x.n).join('/')} pixels)`);
    report.cases.push({name,near,far});
   }
  }
 }finally{await b.close();}
}
{
 const b=await open('quality=high&tier=minimal');
 try{const st=await b.evaluate('solarExplorer.stats()');cacheGate(`minimal tier (wave base ${st.tier.wave_base})`,JSON.parse(await b.evaluate('solarExplorer.engine.audit_water()')));}
 finally{await b.close();}
}
await writeFile(`${dir}/report.json`,JSON.stringify(report,null,1));
const failed=report.gates.filter(g=>!g.pass).length;console.log(failed?`${failed} gate(s) failed`:'all gates passed');process.exit(failed?1:0);
