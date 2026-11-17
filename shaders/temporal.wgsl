// Adapted from TMT d6f7dac src/engine/passes/post/tsr.wgsl.ts, through Planets
// from @pmndrs/upscaler v0.5.0. MIT / Dennis Smolek / AMD notices are distributed
// in web/THIRD-PARTY-NOTICES.txt. This is NOT the official AMD FSR SDK.
// Fused useful reconstruction/accumulation math; Solar-System v2 supplies direct guides,
// so backdrop/veil copies and reversed-Z scatter are not copied blindly.
struct Params {size:vec4<u32>,control:vec4<f32>,jitter:vec4<f32>,timing:vec4<f32>}
struct Guide {motion:vec2<f32>,depth:f32,previous_depth:f32,normal:u32,identity:u32}
fn unpack_normal(packed:u32)->vec3<f32>{let p=unpack2x16snorm(packed);var n=vec3<f32>(p,1.0-abs(p.x)-abs(p.y));let t=clamp(-n.z,0.0,1.0);n=vec3<f32>(n.xy+select(vec2<f32>(t),vec2<f32>(-t),n.xy>=vec2<f32>(0)),n.z);return normalize(n);}
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var radiance:texture_2d<f32>;
@group(0) @binding(2) var display:texture_storage_2d<rgba8unorm,write>;
@group(0) @binding(3) var<storage,read> guides:array<Guide>;
@group(0) @binding(4) var<storage,read> previous_guides:array<Guide>;
@group(0) @binding(5) var history:texture_2d<f32>;
@group(0) @binding(6) var next_history:texture_storage_2d<rgba16float,write>;
@group(0) @binding(7) var<storage,read_write> scatter:array<atomic<u32>>;
@group(0) @binding(8) var locks:texture_2d<f32>;
@group(0) @binding(9) var next_locks:texture_storage_2d<rgba16float,write>;
@compute @workgroup_size(8,8)
fn clear_depth(@builtin(global_invocation_id) id:vec3<u32>){
 if any(id.xy>=params.size.xy){return;}atomicStore(&scatter[id.y*params.size.x+id.x],0u);
}
@compute @workgroup_size(8,8)
fn scatter_depth(@builtin(global_invocation_id) id:vec3<u32>){
 if any(id.xy>=params.size.xy){return;}let g=guides[id.y*params.size.x+id.x];let status=g.identity&3u;
 if status==0u||status==3u||g.previous_depth<=0.0{return;}
 let uv=(vec2<f32>(id.xy)+0.5+params.jitter.xy)/vec2<f32>(params.size.xy)+g.motion;
 let p=uv*vec2<f32>(params.size.xy)-0.5-params.jitter.zw;let base=vec2<i32>(floor(p));let f=fract(p);
 let weights=vec4<f32>((1.0-f.x)*(1.0-f.y),f.x*(1.0-f.y),(1.0-f.x)*f.y,f.x*f.y);
 for(var i=0u;i<4u;i++){
  let q=base+vec2<i32>(i32(i&1u),i32(i>>1u));if weights[i]<0.001||any(q<vec2<i32>(0))||any(q>=vec2<i32>(params.size.xy)){continue;}
  // Positive f32 ray distance has ordered bits. Reverse them for atomicMax;
  // zero means empty, with no reciprocal or planetary far-plane clamp.
  atomicMax(&scatter[u32(q.y)*params.size.x+u32(q.x)],0xffffffffu-bitcast<u32>(g.previous_depth));
 }
}
fn ycocg(c:vec3<f32>)->vec3<f32>{return vec3<f32>(0.25*c.r+0.5*c.g+0.25*c.b,0.5*c.r-0.5*c.b,-0.25*c.r+0.5*c.g-0.25*c.b);}
fn rgb(c:vec3<f32>)->vec3<f32>{return vec3<f32>(c.x+c.y-c.z,c.x+c.z,c.x-c.y-c.z);}
fn clip_box(center:vec3<f32>,extents:vec3<f32>,color:vec3<f32>)->vec3<f32>{let d=color-center;let s=(extents+1e-6)/max(abs(d),vec3<f32>(1e-6));return center+d*min(1.0,min(s.x,min(s.y,s.z)));}
fn lanczos2(x:f32)->f32 {let a=abs(x);if a<1e-4{return 1.0;}if a>=2.0{return 0.0;}let p=3.14159265*a;return 2.0*sin(p)*sin(p*0.5)/(p*p);}
fn load_color(p:vec2<i32>)->vec4<f32>{return textureLoad(radiance,clamp(p,vec2<i32>(0),vec2<i32>(params.size.xy)-1),0);}
fn guide_index(p:vec2<i32>)->u32 {let c=clamp(p,vec2<i32>(0),vec2<i32>(params.size.xy)-1);return u32(c.y)*params.size.x+u32(c.x);}
fn load_history(p:vec2<i32>)->vec4<f32>{return textureLoad(history,clamp(p,vec2<i32>(0),vec2<i32>(params.size.zw)-1),0);}
fn history_sample(uv:vec2<f32>,guide:Guide)->vec4<f32>{
 let p=uv*vec2<f32>(params.size.zw)-0.5;let b=vec2<i32>(floor(p));let f=fract(p);
 var sum=vec3<f32>(0);var count=15.0;var seconds=0.0;
 let weights=vec4<f32>((1.0-f.x)*(1.0-f.y),f.x*(1.0-f.y),(1.0-f.x)*f.y,f.x*f.y);
 for(var i=0u;i<4u;i++){
  if weights[i]<0.00001{continue;}let at=b+vec2<i32>(i32(i&1u),i32(i>>1u));let h=load_history(at);
  let guv=(vec2<f32>(at)+0.5)/vec2<f32>(params.size.zw);let gp=vec2<i32>(round(guv*vec2<f32>(params.size.xy)-0.5-params.jitter.zw));let g=previous_guides[guide_index(gp)];
  if h.a<1.0||g.identity!=guide.identity||((guide.identity&3u)!=0u&&(abs(g.depth-guide.previous_depth)>max(0.0002,guide.previous_depth*params.timing.z*1.5)||dot(unpack_normal(g.normal),unpack_normal(guide.normal))<0.85)){return vec4<f32>(0);}
  sum+=h.rgb*weights[i];count=min(count,floor(h.a));seconds=max(seconds,fract(h.a));
 }
 return vec4<f32>(sum,count+seconds);
}
fn display_encode(c:vec3<f32>)->vec3<f32>{let x=max(c,vec3<f32>(0))*params.control.x;let m=clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),vec3<f32>(0),vec3<f32>(1));return pow(m,vec3<f32>(1.0/2.2));}
@compute @workgroup_size(8,8)
fn resolve(@builtin(global_invocation_id) id:vec3<u32>){
 if any(id.xy>=params.size.zw){return;}
 let uv=(vec2<f32>(id.xy)+0.5)/vec2<f32>(params.size.zw);
 let src=uv*vec2<f32>(params.size.xy)-0.5-params.jitter.xy;let base=vec2<i32>(round(src));
 var guide=guides[guide_index(base)];let identity=guide.identity;let status=identity&3u;
 var sum=vec3<f32>(0);var weight=0.0;var m1=vec3<f32>(0);var m2=vec3<f32>(0);var lo=vec3<f32>(1e30);var hi=vec3<f32>(-1e30);var reactive=0.0;var samples=0.0;
 for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
  let p=base+vec2<i32>(x,y);let c=load_color(p);let g=guides[guide_index(p)];
  // Reject a different surface class/material in the spatial kernel. Unknown
  // pixels retain their own display fallback and never become valid history.
  if g.identity!=identity{continue;}
  // Foreground motion dilation is restricted to the SAME material/surface.
  // Unknowns and another surface never acquire that surface's validity.
  if params.control.z>1.5&&status==1u&&g.depth<guide.depth{guide=g;}
  let d=src-vec2<f32>(p);let w=select(max(0.0,1.0-abs(d.x))*max(0.0,1.0-abs(d.y)),lanczos2(d.x)*lanczos2(d.y),params.control.z>1.5);
  sum+=c.rgb*w;weight+=w;let v=ycocg(c.rgb);m1+=v;m2+=v*v;lo=min(lo,v);hi=max(hi,v);reactive=max(reactive,c.a);samples+=1.0;
 }}
 let current=select(load_color(base).rgb,rgb(clamp(ycocg(sum/max(weight,1e-5)),lo,hi)),weight>1e-5);
 let mean=m1/max(samples,1.0);let sigma=sqrt(max(m2/max(samples,1.0)-mean*mean,vec3<f32>(0)));
 let previous_uv=uv+guide.motion;let previous_pixel=vec2<i32>(round(previous_uv*vec2<f32>(params.size.xy)-0.5-params.jitter.zw));
 let pg=previous_guides[guide_index(previous_pixel)];
 let depth=guide.previous_depth;
 // Ray distances, no arbitrary 1000 m far clamp. Relative footprint tolerance
 // plus absolute submillimetre floor; sky has explicit identity and depth 0.
 let tolerance=max(0.0002,depth*params.timing.z*1.5);
 let same=pg.identity==identity;
 let depth_ok=status==0u||abs(pg.depth-depth)<tolerance;
 let normal_ok=status==0u||dot(unpack_normal(pg.normal),unpack_normal(guide.normal))>0.85;
 var occluded=false;
 if params.control.z>1.5&&status!=0u{
  let nearest=atomicLoad(&scatter[guide_index(previous_pixel)]);
  if nearest>0u{occluded=bitcast<f32>(0xffffffffu-nearest)+tolerance<depth;}
 }
 let lost=params.control.y>0.5||status==3u||!same||!depth_ok||!normal_ok||occluded||any(previous_uv<vec2<f32>(0))||any(previous_uv>=vec2<f32>(1))||reactive>=0.95;
 var result=current;var age=1.0;var seconds=0.0;var reject=1.0;var life=0.0;var tracked=ycocg(current).x;
 if !lost {
  let old=history_sample(previous_uv,guide);
  // Encode count <=15 plus oldest-contribution age in units of 1/64 s. Both
  // are exact in binary16. Round age UP; no contributing sample can outlive
  // the 250 ms cap, even with changing frame intervals or bilinear reprojection.
  let next_seconds=fract(old.a)+ceil(params.timing.x*64.0)/64.0;
  if all(old==old)&&all(abs(old)<vec4<f32>(65000))&&old.a>=1.0&&next_seconds<=params.timing.y {
   seconds=next_seconds;age=min(floor(old.a)+1.0,15.0);
   if params.control.z>1.5{
    let prior=textureLoad(locks,clamp(vec2<i32>(previous_uv*vec2<f32>(params.size.zw)),vec2<i32>(0),vec2<i32>(params.size.zw)-1),0);
    let luma=ycocg(current).x;let contrast=hi.x-lo.x;
    // TMT's thin-feature lock, adapted to unexposed HDR with a relative floor.
    // Lighting change, reactivity, disocclusion and the age cap all break it.
    let floor=max(0.002,abs(mean.x)*0.02);let shift=smoothstep(1.0,2.5,abs(mean.x-prior.w)/max(sigma.x,floor));let quiet=(1.0-reactive)*(1.0-shift);
    let feature=smoothstep(0.6,2.0,abs(luma-mean.x)/max(sigma.x,0.001))*smoothstep(floor,floor*6.0,contrast)*quiet;
    tracked=select(prior.y,luma,prior.x<0.05);let broken=smoothstep(max(contrast,0.001),max(contrast,0.001)*2.0,abs(luma-tracked));
    life=clamp((prior.x+select(-0.08,0.5*feature,feature>0.1))*(1.0-broken)*quiet,0.0,1.0);
   }
   let box=clip_box(ycocg(current),sigma*(1.25+life),ycocg(old.rgb));
   let alpha=max(1.0/age,max(reactive,params.timing.x/params.timing.y));
   result=mix(rgb(box),current,clamp(alpha,0.0,1.0));reject=0.0;
  }
 }
 if status==3u {age=0.0;}
 if any(result!=result)||any(abs(result)>vec3<f32>(65000)){result=load_color(base).rgb;age=0.0;seconds=0.0;life=0.0;reject=1.0;}
 textureStore(next_history,vec2<i32>(id.xy),vec4<f32>(max(result,vec3<f32>(0)),age+seconds));
 if params.control.z>1.5{textureStore(next_locks,vec2<i32>(id.xy),vec4<f32>(life,tracked,reactive,mean.x));}
 var color=display_encode(result);
 switch u32(params.control.w) {
  case 1u:{color=vec3<f32>(guide.motion*20.0+0.5,0.5);}
  case 2u:{color=vec3<f32>(reject,1.0-reject,0);}
  case 3u:{color=vec3<f32>(reactive);}
  case 4u:{color=vec3<f32>(age/15.0);}
  case 5u:{color=select(vec3<f32>(0,0.5,0),vec3<f32>(1,0.1,0),status==3u);}
  case 6u:{color=vec3<f32>(life,life*0.5,0.05);}
  default:{}
 }
 textureStore(display,vec2<i32>(id.xy),vec4<f32>(color,1));
}
