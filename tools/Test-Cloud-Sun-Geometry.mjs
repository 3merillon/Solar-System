// Independent sphere/chord reference for both sides of tangent sunlight and
// the empty inner-shell gap. No rendering or sampled terrain is used here.
import assert from 'node:assert/strict';
const R=6371000,top=12500,base=1300,heights=[top,9500,6500,4500,3500,2500,2000,1700,base],N=heights.length-1;
const down=(b,h)=>{const c=(top-h)*(2*R+top+h),d=b*b-c;return d<=0?b:c/(b+Math.sqrt(d));};
const spans=b=>Array.from({length:2*N},(_,i)=>i<N?[down(b,heights[i]),down(b,heights[i+1])]:[2*b-down(b,heights[2*N-i]),2*b-down(b,heights[2*N-i-1])]);
const ring=0.1,z0=Math.sqrt(2*R*top+top*top)/(R+top);
const chartRadius=z=>{if(z<z0)return 1-ring*(z/z0)**2;const bb=z*(R+top),s=Math.sqrt(Math.max(0,bb*bb-2*R*top-top*top))/R;return (1-ring)*(1-Math.asin(Math.min(1,s))/(Math.PI/2));};
const chartCosine=r=>{if(r>1-ring)return z0*Math.sqrt(Math.max(0,(1-r)/ring));const e=(Math.PI/2)*(1-r/(1-ring)),s=R*Math.sin(e);return Math.min(1,Math.sqrt(2*R*top+top*top+s*s)/(R+top));};
let cases=0,maxLengthError=0,maxProjectionError=0,maxTangentError=0;
for(let j=0;j<=400;j++){
 const cosine=(j+.1)/400.1,b=(R+top)*cosine,impact=Math.sqrt((R+top)**2-b*b),s=spans(b);
 for(let k=0;k<=100;k++){
  const distance=2*b*k/100,z=b-distance,h=Math.hypot(impact,z)-R;
  // Analytic occupied line length in an annulus, clipped at the receiver.
  const innerSq=(R+base)**2-impact*impact,inner=innerSq>0?Math.sqrt(innerSq):0;
  const expected=distance-Math.max(0,Math.min(distance,b+inner)-Math.max(0,b-inner));
  let interval=N-1;for(let i=0;i<N;i++)if(h>=heights[i+1]){interval=i;break;}
  if(z<0)interval=2*N-1-interval;
  const [a,end]=s[interval],fraction=Math.min(1,Math.max(0,(distance-a)/Math.max(.001,end-a)));
  const actual=h<=base?s.slice(0,N).reduce((n,[a,e])=>n+e-a,0):s.slice(0,interval).reduce((n,[a,e])=>n+e-a,0)+(end-a)*fraction;
  maxLengthError=Math.max(maxLengthError,Math.abs(actual-expected));cases++;
 }
 const near=s.slice(0,N).reduce((n,[a,e])=>n+e-a,0),far=s.slice(N).reduce((n,[a,e])=>n+e-a,0);
 maxTangentError=Math.max(maxTangentError,Math.abs(near-far));
 // Global chart (sun_cloud_global_uv): azimuth about the sun, radius uniform
 // in the sun's elevation at the ground point the ray reaches, an outer ring
 // for rays above the ground uniform in perigee height. Round trip, monotone
 // in the cosine, continuous where the ring meets the ground rays.
 for(let angle=0;angle<6.3;angle+=.1){
  const n=[Math.sqrt(1-cosine*cosine)*Math.cos(angle),Math.sqrt(1-cosine*cosine)*Math.sin(angle),cosine];
  const r=chartRadius(cosine),z=chartCosine(r),decoded=[Math.cos(angle)*Math.sqrt(1-z*z),Math.sin(angle)*Math.sqrt(1-z*z),z];
  maxProjectionError=Math.max(maxProjectionError,Math.hypot(...n.map((v,i)=>v-decoded[i])));
 }
 if(j>0)assert.ok(chartRadius(cosine)<chartRadius((j-.9)/400.1),'chart radius decreases with the cosine');
}
// The radius is continuous at the ring but its slope in the cosine is
// unbounded there (elevation grows as the square root of the cosine beyond
// the terminator): compare from the ring side with the exact ring value.
assert.ok(Math.abs(chartRadius(z0*(1-1e-9))-chartRadius(z0))<1e-6,'chart continuous at the ring');
assert.ok(maxLengthError<.00001);assert.ok(maxTangentError<.000001);assert.ok(maxProjectionError<1e-8);
console.log(JSON.stringify({cases,maxLengthError,maxTangentError,maxProjectionError}));
