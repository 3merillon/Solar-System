// The water's brightness against the eye's distance, for the ring test (docs/WATER-LAYER.md, the owner's darker ring
// of 3 November 2026). A ring centred under the camera is a quantity switched by distance or pixel footprint; Fresnel
// and haze change smoothly with distance, a switch steps. Used by Test-Water-Ring (Earth tour) and Test-River-Overflow
// --profile (fixtures).
//
// ringProfile(b, W, H, diagnostic): water pixels (the ocean target, in front of the ground) binned by the log of their
// distance from the eye (1% bins); per bin the median display luminance (a median: the sun's glitter path and the bed's
// grain do not move it), quartiles, the median water depth (the ocean target's clearance) and, with the depth
// diagnostic (cloud_diagnostic bit 8388608), the depth the field's page gives and the depth the bed path used.
// worstStep(rows, span): the largest change of the median between bins at most `span` (3%) apart.
// worstDip(rows, factor): the largest fall of the median outward, from a bin to one at most `factor` (3) times as far.
// Over water of one depth the reflection grows with distance, so water darker than nearer water is a band: the owner's
// ring was a smooth dip of 5 codes over a few hundred metres (Leixões, 400 m up), which no step metric sees.
// columns: [from, to] as fractions of the width (a fixture's edges and placeholders can be left out).
export async function ringProfile(b,W,H,diagnostic=0,columns=[0,1]){
 return b.evaluate(`(async()=>{
  const W=${W},H=${H};
  const floats=async k=>{const r=await solarExplorer.capture(k);return new Float32Array(r.buffer,r.byteOffset,r.byteLength>>2);};
  const position=await floats('position'),ocean=await floats('ocean');const disp=await solarExplorer.capture('display');
  const depthDiag=(${diagnostic}&8388608)!==0;const wt=depthDiag?await solarExplorer.capture('water'):null;
  const f16=(u,i)=>{const h=u[i]|(u[i+1]<<8),e=(h>>10)&31,m=h&1023,v=e===0?m/1024*2**-14:e===31?NaN:(1+m/1024)*2**(e-15);return h&32768?-v:v;};
  const bins=new Map();let water=0;
  const cx0=Math.floor(W*${columns[0]}),cx1=Math.ceil(W*${columns[1]});
  for(let y=0;y<H;y++)for(let x=cx0;x<cx1;x++){
   const i=y*W+x;const t=ocean[2*i];if(!(t>0))continue;
   const g=Math.hypot(position[4*i],position[4*i+1],position[4*i+2]);if(g>0.1&&t>g+1)continue;
   water++;const k=Math.round(Math.log(t)*100);const l=0.2126*disp[4*i]+0.7152*disp[4*i+1]+0.0722*disp[4*i+2];
   let a=bins.get(k);if(!a){a=[[],[],[],[]];bins.set(k,a);}a[0].push(l);a[1].push(ocean[2*i+1]);
   if(wt){a[2].push(f16(wt,i*8+2)*20);a[3].push(f16(wt,i*8+4)*20);}
  }
  const med=v=>{if(!v.length)return null;v.sort((p,q)=>p-q);return v[v.length>>1];};
  const rows=[...bins.entries()].filter(([k,a])=>a[0].length>=40).map(([k,[a,c,fd,bd]])=>{a.sort((p,q)=>p-q);return {d:Math.exp(k/100),n:a.length,median:a[a.length>>1],p25:a[a.length>>2],p75:a[(3*a.length)>>2],depth:med(c),field:med(fd),bed:med(bd)};}).sort((p,q)=>p.d-q.d);
  return {water,rows};
 })()`);
}
export function worstStep(rows,span=1.031){
 let worst={step:0};
 for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length&&rows[j].d<=rows[i].d*span;j++){
  const step=rows[j].median-rows[i].median;if(Math.abs(step)>Math.abs(worst.step))worst={step:+step.toFixed(2),from_m:+rows[i].d.toFixed(1),to_m:+rows[j].d.toFixed(1)};}
 return worst;
}
export function worstDip(rows,factor=3){
 let worst={dip:0};
 for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length&&rows[j].d<=rows[i].d*factor;j++){
  const dip=rows[i].median-rows[j].median;if(dip>worst.dip)worst={dip:+dip.toFixed(2),from_m:+rows[i].d.toFixed(1),to_m:+rows[j].d.toFixed(1)};}
 return worst;
}
export const profileRows=rows=>rows.map(r=>[+r.d.toFixed(1),r.n,+r.median.toFixed(1),+r.p25.toFixed(1),+r.p75.toFixed(1),r.depth==null?null:+r.depth.toFixed(2),r.field==null?null:+r.field.toFixed(2),r.bed==null?null:+r.bed.toFixed(2)]);
