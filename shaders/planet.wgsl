struct Frame {
 camera_hi:vec4<f32>,camera_lo:vec4<f32>,right:vec4<f32>,up:vec4<f32>,forward:vec4<f32>,radial:vec4<f32>,sun:vec4<f32>,
 geology:vec4<f32>,media:vec4<f32>,quality:vec4<f32>,options:vec4<u32>,size:vec4<u32>,anchor:vec4<f32>,base:vec4<f32>,registry:vec4<u32>,extra:vec4<f32>,coarse:vec4<f32>,coarse_meta:vec4<f32>,animation:vec4<f32>,waves:vec4<f32>,
 previous_right:vec4<f32>,previous_up:vec4<f32>,previous_forward:vec4<f32>,previous_offset:vec4<f32>,sampling:vec4<f32>,history:vec4<f32>,reference_region:vec4<u32>
}
struct Proxy {cell:vec4<i32>,phase:vec4<f32>,c0:vec4<f32>,c1:vec4<f32>,config:vec4<f32>}
override DIAGNOSTICS:bool=true;
override GROUP_X:u32=8u;
override GROUP_Y:u32=8u;
override NORMAL_FILTER:u32=0u;
override SOLAR_CACHE:bool=false;
override WATER_RATE:u32=1u;
// Paired baseline remains available to the measurement harness.
override EXACT_WORK:bool=true;
override PREFIX_CACHE:bool=false;
override NOISE_CACHE:bool=false;
// Production planets eliminate the unrelated small-solid query vocabulary.
override PLANET_ONLY:bool=false;
fn planet_scene()->bool{return PLANET_ONLY||frame.options.x==4u;}
// Per-ray Taylor certificate for bands [0,16). Reset for every primary,
// reflection, transmission and shadow query; never shared across ray identities.
struct RayPrefix {center:f32,delta:f32,slope:f32,curvature:f32,reach:f32,error:f32}
var<private> ray_prefix:RayPrefix;
var<private> prefix_active:bool;
var<private> prefix_reused:bool;
@group(0) @binding(0) var<uniform> frame:Frame;
@group(0) @binding(1) var<storage,read> proxies:array<Proxy>;
// The same 1,920 bytes are also bound as a fixed uniform array. Neighboring
// lanes read identical bands; no duplicated allocation or changed coefficients.
@group(0) @binding(10) var<uniform> uniform_proxies:array<Proxy,24>;
fn read_proxy(k:u32)->Proxy {if EXACT_WORK{return uniform_proxies[k];}return proxies[k];}
@group(0) @binding(2) var<storage,read_write> hits:array<RayResult>;
@group(0) @binding(3) var image:texture_storage_2d<rgba16float,write>;
@group(0) @binding(4) var<storage,read> erosion:array<f32>;
@group(0) @binding(5) var<storage,read_write> stats:array<atomic<u32>,32>;
@group(0) @binding(6) var<storage,read> materials:array<vec4<f32>>;
// 24 bytes (8-byte struct alignment): ray-distance f32 remains full precision.
// Normals use octahedral snorm16; identity remains an integer, never a float bitcast.
struct Guide {motion:vec2<f32>,depth:f32,previous_depth:f32,normal:u32,identity:u32}
fn pack_normal(n:vec3<f32>)->u32 {
 if dot(n,n)<1e-8{return 0u;}var v=n/(abs(n.x)+abs(n.y)+abs(n.z));
 if v.z<0.0{v=vec3<f32>((1.0-abs(v.yx))*select(vec2<f32>(-1),vec2<f32>(1),v.xy>=vec2<f32>(0)),v.z);}
 return pack2x16snorm(v.xy);
}
@group(0) @binding(7) var<storage,read_write> guides:array<Guide>;
fn count64(low:u32,high:u32,value:u32){if DIAGNOSTICS{let old=atomicAdd(&stats[low],value);if old+value<old{atomicAdd(&stats[high],1u);}}}
fn record_secondary(result:RayResult){if DIAGNOSTICS{atomicAdd(&stats[7],1u);count64(8u,12u,result.counts.x);count64(9u,13u,result.counts.y);if result.span.z>=2.0{atomicAdd(&stats[6],1u);}}}

fn radial_change(q:vec3<f32>)->f32 {
 let r=frame.camera_lo.w;let numerator=2.0*r*dot(frame.radial.xyz,q)+dot(q,q);
 return numerator/(sqrt(max(0.0,r*r+numerator))+r);
}
fn altitude(q:vec3<f32>)->f32 {return frame.radial.w+radial_change(q);}
fn proxy_sample(q:vec3<f32>,d:vec3<f32>,half:f32,k:u32)->vec4<f32> {
 let p=read_proxy(k);let df=q*p.phase.w;let f=p.phase.xyz;let next=f+df;var delta=0.0;
 var v=p.c0;var w=p.c1;
 if all(next>=vec3<f32>(0)) && all(next<=vec3<f32>(1)) {
  // Factored cubic difference avoids cancelling the large coarse reference.
  let t=f*f*(3.0-2.0*f);let dt=df*(6.0*f*(1.0-f)+df*(3.0-6.0*f-2.0*df));
  let cx=v.y-v.x;let cy=v.z-v.x;let cz=w.x-v.x;
  let cxy=v.w-v.z-v.y+v.x;let cxz=w.y-w.x-v.y+v.x;let cyz=w.z-w.x-v.z+v.x;
  let cxyz=w.w-w.z-w.y+w.x-v.w+v.z+v.y-v.x;
  delta=dt.x*(cx+cxy*t.y+cxz*t.z+cxyz*t.y*t.z)
       +dt.y*(cy+cxy*t.x+cyz*t.z+cxyz*t.x*t.z)
       +dt.z*(cz+cxz*t.x+cyz*t.y+cxyz*t.x*t.y)
       +dt.x*dt.y*(cxy+cxyz*t.z)+dt.x*dt.z*(cxz+cxyz*t.y)+dt.y*dt.z*(cyz+cxyz*t.x)+cxyz*dt.x*dt.y*dt.z;
 } else {
  let shift=vec3<i32>(floor(next));let c=p.cell.xyz+shift;let f1=fract(next);let t=f1*f1*(3.0-2.0*f1);let seed=frame.options.w+k;
  v=vec4<f32>(lattice(c,seed),lattice(c+vec3<i32>(1,0,0),seed),lattice(c+vec3<i32>(0,1,0),seed),lattice(c+vec3<i32>(1,1,0),seed));
  w=vec4<f32>(lattice(c+vec3<i32>(0,0,1),seed),lattice(c+vec3<i32>(1,0,1),seed),lattice(c+vec3<i32>(0,1,1),seed),lattice(c+vec3<i32>(1,1,1),seed));
  let n=mix(mix(mix(v.x,v.y,t.x),mix(v.z,v.w,t.x),t.y),mix(mix(w.x,w.y,t.x),mix(w.z,w.w,t.x),t.y),t.z);
  delta=n-p.config.y;
 }
 var lip=3.0*dot(abs(d),vec3<f32>(1))*p.phase.w;
 var signed_slope=0.0;var hessian=-1.0;
 if frame.options.z==2u&&half*p.phase.w<0.12{
  let frac=fract(next);let t=frac*frac*(3.0-2.0*frac);let dt=6.0*frac*(1.0-frac);
  let gx=dt.x*mix(mix(v.y-v.x,v.w-v.z,t.y),mix(w.y-w.x,w.w-w.z,t.y),t.z);
  let gy=dt.y*mix(mix(v.z-v.x,v.w-v.y,t.x),mix(w.z-w.x,w.w-w.y,t.x),t.z);
  let gz=dt.z*mix(mix(w.x-v.x,w.y-v.y,t.x),mix(w.z-v.z,w.w-v.w,t.x),t.y);
  signed_slope=dot(vec3<f32>(gx,gy,gz),d)*p.phase.w;hessian=30.0*p.phase.w*p.phase.w;
  lip=min(lip,abs(signed_slope)+hessian*half+p.phase.w*1e-5);
 }
 if p.cell.w==1 {let n=p.config.y;let n1=n+delta;let global=3.0*dot(abs(d),vec3<f32>(1))*p.phase.w;if abs(n1)<=global*half+1e-6{hessian=-1.0;}signed_slope*= -sign(n1);if n*n1>=0.0{delta= -sign(n)*delta;}else{delta=abs(n)-abs(n1);}}
 return vec4<f32>(delta,lip,signed_slope,hessian);
}
fn proxy_delta(q:vec3<f32>,k:u32)->f32{return proxy_sample(q,vec3<f32>(0),0.0,k).x;}
fn erosion_delta(q:vec3<f32>)->f32 {
 let p=q-frame.anchor.xyz;let uv=p.xz/frame.extra.x+0.5;let n=frame.registry.y;
 if n<2u || any(uv<vec2<f32>(0)) || any(uv>=vec2<f32>(1)){return 0.0;}
 let xy=uv*f32(n-1u);let c=vec2<u32>(floor(xy));let t=fract(xy);let i=c.y*n+c.x;
 return mix(mix(erosion[i],erosion[i+1u],t.x),mix(erosion[i+n],erosion[i+n+1u],t.x),t.y)*frame.geology.z;
}
struct Features {mesa:vec2<f32>,basin:vec2<f32>,cave:vec2<f32>,rock:vec2<f32>,enabled:bool}
fn local_noise_range(p:vec3<f32>,d:vec3<f32>,half:f32,seed:u32)->vec2<f32>{
 let global=3.0*dot(abs(d),vec3<f32>(1))*half;
 if global>=2.0{return vec2<f32>(-1,1);}
 let c=vec3<i32>(floor(p));let f=fract(p);let t=f*f*(3.0-2.0*f);let dt=6.0*f*(1.0-f);
 let v=vec4<f32>(lattice(c,seed),lattice(c+vec3<i32>(1,0,0),seed),lattice(c+vec3<i32>(0,1,0),seed),lattice(c+vec3<i32>(1,1,0),seed));
 let w=vec4<f32>(lattice(c+vec3<i32>(0,0,1),seed),lattice(c+vec3<i32>(1,0,1),seed),lattice(c+vec3<i32>(0,1,1),seed),lattice(c+vec3<i32>(1,1,1),seed));
 let n=mix(mix(mix(v.x,v.y,t.x),mix(v.z,v.w,t.x),t.y),mix(mix(w.x,w.y,t.x),mix(w.z,w.w,t.x),t.y),t.z);
 let gradient=dt*vec3<f32>(mix(mix(v.y-v.x,v.w-v.z,t.y),mix(w.y-w.x,w.w-w.z,t.y),t.z),mix(mix(v.z-v.x,v.w-v.y,t.x),mix(w.z-w.x,w.w-w.y,t.x),t.z),mix(mix(w.x-v.x,w.y-v.y,t.x),mix(w.z-v.z,w.w-v.w,t.x),t.y));
 let local=abs(dot(gradient,d))*half+15.0*dot(d,d)*half*half+1e-6;
 let e=select(global,min(global,local),frame.options.z==2u);
 return clamp(vec2<f32>(n-e,n+e),vec2<f32>(-1),vec2<f32>(1));
}
fn feature_ranges(q:vec3<f32>,d:vec3<f32>,half:f32)->Features {
 let p=q-frame.anchor.xyz;
 if any(abs(p)>vec3<f32>(360,110,460)+half){return Features(vec2<f32>(0),vec2<f32>(0),vec2<f32>(0),vec2<f32>(0),false);}
 var rough=vec2<f32>(0);let scales=array<f32,4>(32,4,0.5,0.0625);let amps=array<f32,4>(7,0.8,0.1,0.0125);
 for(var k=0u;k<4u;k++){rough+=local_noise_range(p/scales[k],d/scales[k],half,frame.options.w+701u+k)*amps[k];}
 return features_from_rough(p,d,half,rough);
}
fn features_from_rough(p:vec3<f32>,d:vec3<f32>,half:f32,rough:vec2<f32>)->Features {
 // One canonical coastal cave/arch complex; never an independent decorative mesh.
 let mesa=(norm_range((p-vec3<f32>(0,0,-90))/vec3<f32>(210,70,230),d/vec3<f32>(210,70,230),half)-1.0)*70.0+rough;
 let basin=(norm_range((p-vec3<f32>(0,10,270))/vec3<f32>(310,80,175),d/vec3<f32>(310,80,175),half)-1.0)*80.0+rough*0.35;
 let bore=norm_range(vec3<f32>(p.x,p.y+5.0,0),vec3<f32>(d.xy,0),half)-24.0+rough*0.25;
 let cap=vec2<f32>(max(0.0,abs(p.z)-abs(d.z)*half),abs(p.z)+abs(d.z)*half)-240.0;
 let b=norm_range((p-vec3<f32>(46,5,190))/vec3<f32>(1.0,1.5,0.8),d/vec3<f32>(1.0,1.5,0.8),half)*0.8-9.0+rough*0.3;
 return Features(mesa,basin,max(bore,cap),b,true);
}
fn combine_features(f:Features,base:vec2<f32>)->vec2<f32>{
 if !f.enabled{return base;}
 return min(max(max(min(base,f.mesa),-f.basin.yx),-f.cave.yx),f.rock);
}
fn planet_value(q:vec3<f32>)->f32 {
 let features=feature_ranges(q,vec3<f32>(0),0);let known=combine_features(features,vec2<f32>(-1e30,1e30));
 if known.x==known.y{return known.x;}
 let radial=radial_change(q);var delta=0.0;
 for(var k=0u;k<24u;k++){
  let p=read_proxy(k);delta+=p.config.x*proxy_delta(q,k);
  let v=p.config.z+radial-delta;let e=p.config.w+frame.extra.y*frame.geology.z;
  let result=combine_features(features,vec2<f32>(v-e,v+e));
  if k<23u&&result.x==result.y{return result.x;}
 }
 let f=frame.base.x+radial_change(q)-delta-erosion_delta(q);
 return combine_features(features,vec2<f32>(f)).x;
}
fn planet_range(o:vec3<f32>,d:vec3<f32>,a:f32,b:f32)->Bound {
 let accelerated=planet_range_impl(o,d,a,b);
 if PREFIX_CACHE&&prefix_active&&prefix_reused&&accelerated.interval.x<=0.0&&accelerated.interval.y>=0.0 {
  // A loose cached certificate must not consume the root-isolation budget.
  // Retry the original bound at the same interval before deciding to subdivide.
  prefix_active=false;let direct=planet_range_impl(o,d,a,b);prefix_active=true;
  return Bound(direct.interval,accelerated.bands+direct.bands);
 }
 return accelerated;
}
fn planet_range_impl(o:vec3<f32>,d:vec3<f32>,a:f32,b:f32)->Bound {
 prefix_reused=false;
 if frame.coarse_meta.z>0.0 {let cached=cached_region(o,d,a,b);if cached.x>0.0||cached.y<0.0{return Bound(cached,0u);}}
 let half=(b-a)*0.5;let q=o+d*((a+b)*0.5);let radial=radial_change(q);
 var delta=0.0;var l=0.0;var total=vec2<f32>(-1e30,1e30);
 // Coarse modes have a generous engineering numerical envelope at long range.
 let numerical=0.00008+length(q)*1.5e-6;
 var features=feature_ranges(q,d,half);let cost=select(0u,4u,features.enabled);
 let outside_features=PREFIX_CACHE&&prefix_active&&!features.enabled;
 // The original support shortcut is sign-equivalent, not value-equivalent to
 // the untruncated CSG oracle. Enclose both fields outside that support using
 // analytic primitive ranges and the complete bounded displacement residual.
 if outside_features{features=features_from_rough(q-frame.anchor.xyz,d,half,vec2<f32>(-7.9125,7.9125));}
 let known=combine_features(features,vec2<f32>(-1e30,1e30))+vec2<f32>(-numerical,numerical);
 if !outside_features&&(known.x>0.0||known.y<0.0){return Bound(known,cost);}
 let body_origin=frame.camera_hi.xyz+frame.camera_lo.xyz+o;
 let closest=clamp(-dot(body_origin,d),a,b);
 let radial_interval=vec2<f32>(radial_change(o+d*closest),max(radial_change(o+d*a),radial_change(o+d*b)));
 let proxy_radius=length(q)+half;let proxy_error=0.5*frame.coarse.w*proxy_radius*proxy_radius+frame.coarse_meta.y*proxy_radius;
 var start=0u;var coarse_error=0.0;var signed_slope=0.0;var hessian=0.0;var differentiable=true;
 let radial_slope=dot(frame.radial.xyz*frame.camera_lo.w+q,d)/max(1.0,frame.camera_lo.w+radial);
 let radial_hessian=1.0/max(1.0,frame.camera_lo.w+radial_interval.x);
 let center=(a+b)*0.5;let travel=abs(center-ray_prefix.center)+half;
 let reuse_error=0.5*ray_prefix.curvature*travel*travel+travel*1e-5+ray_prefix.error;
 let reuse=PREFIX_CACHE&&prefix_active&&frame.options.z==2u&&ray_prefix.reach>travel&&reuse_error<max(half*0.1,read_proxy(15u).config.w*0.01);
 prefix_reused=reuse;
 if reuse {
  start=16u;delta=ray_prefix.delta+ray_prefix.slope*(center-ray_prefix.center);
  signed_slope=ray_prefix.slope;l=abs(signed_slope);coarse_error=reuse_error;
 } else if !(PREFIX_CACHE&&prefix_active)&&frame.options.z==2u&&proxy_radius<frame.coarse_meta.x&&proxy_error<half*0.05 {
  start=8u;delta=dot(frame.coarse.xyz,q);signed_slope=dot(frame.coarse.xyz,d);l=abs(signed_slope);coarse_error=proxy_error;
 }
 var ridge_reach=1e30;
 for(var k=start;k<24u;k++){
  let p=read_proxy(k);let sample=proxy_sample(q,d,half,k);delta+=p.config.x*sample.x;
  l+=p.config.x*sample.y;
  signed_slope+=p.config.x*sample.z;hessian+=p.config.x*max(0.0,sample.w);differentiable=differentiable&&sample.w>=0.0;
  if PREFIX_CACHE&&prefix_active&&start==0u&&k<16u {
   if p.cell.w==1 {let magnitude=abs(p.config.y)-sample.x;ridge_reach=min(ridge_reach,max(0.0,magnitude-1e-5)/max(1e-20,3.0*dot(abs(d),vec3<f32>(1))*p.phase.w));}
   if k==15u&&differentiable {ray_prefix=RayPrefix(center,delta,signed_slope,hessian*1.0001+1e-6,ridge_reach,numerical);}
  }
  let f=vec2<f32>(p.config.z-delta)+radial_interval;
  let e=half*l+p.config.w+numerical+frame.extra.y*frame.geology.z+coarse_error;
  var field_interval=f+vec2<f32>(-e,e);
  if differentiable&&frame.options.z==2u {
   let value=p.config.z+radial-delta;
   let error=abs(radial_slope-signed_slope)*half+0.5*(radial_hessian+hessian)*half*half+p.config.w+numerical+frame.extra.y*frame.geology.z+coarse_error+half*1e-5;
   field_interval=vec2<f32>(max(field_interval.x,value-error),min(field_interval.y,value+error));
  }
  total=combine_features(features,field_interval);
  if outside_features{total=vec2<f32>(min(total.x,field_interval.x),max(total.y,field_interval.y));}
  if frame.options.z!=0u && (total.x>0.0||total.y<0.0){return Bound(total,k+1u-start+cost);}
  // A conservative unknown interval does not need a fully evaluated spectrum.
  // The retained tail remains in total; endpoints are separately sign checked.
  if frame.options.z!=0u&&k<23u&&p.config.w<=half*0.02{return Bound(total,k+1u-start+cost);}
 }
 // Exact sampled erosion value with a declared bilinear derivative bound.
 let e=half*(1.0+l+frame.extra.z*frame.geology.z)+numerical;
 let f=frame.base.x+radial-delta-erosion_delta(q);
 let exact=vec2<f32>(frame.base.x-delta-erosion_delta(q))+radial_interval;
 let fine_error=half*(l+frame.extra.z*frame.geology.z)+numerical+coarse_error;
 let fine=exact+vec2<f32>(-fine_error,fine_error);var complete=combine_features(features,fine);
 if outside_features{complete=vec2<f32>(min(complete.x,fine.x),max(complete.y,fine.y));}
 return Bound(complete,24u-start+cost);
}
fn view_direction(pixel:vec2<u32>)->vec3<f32>{
 let uv=(vec2<f32>(pixel)+0.5+frame.sampling.xy)/vec2<f32>(frame.size.xy)*2.0-1.0;
 return normalize(frame.forward.xyz+frame.right.xyz*uv.x*frame.right.w*frame.up.w-frame.up.xyz*uv.y*frame.right.w);
}
fn active_reference_pixel(pixel:vec2<u32>)->bool{return all(frame.reference_region.zw==vec2<u32>(0))||(all(pixel>=frame.reference_region.xy)&&all(pixel<frame.reference_region.zw));}
fn output_footprint(t:f32)->f32{return t*2.0*frame.right.w/frame.sampling.w*frame.history.w;}
fn sample_footprint(t:f32)->f32{return t*2.0*frame.right.w/f32(frame.size.y)*frame.history.w;}
fn ray_tolerance(t:f32)->f32{return max(frame.quality.x,output_footprint(t)*frame.quality.y);}
fn scene_model()->Model{return Model(frame.options.x,frame.options.w,8u,frame.options.z,0.12*frame.geology.x,frame.geology.y);}
fn scene_value(q:vec3<f32>)->f32{if planet_scene(){return planet_value(q);}return field_value(frame.camera_hi.xyz+frame.camera_lo.xyz+q,scene_model());}
fn scene_trace(o:vec3<f32>,d:vec3<f32>,near:f32,far:f32,budget:u32)->RayResult {
 return scene_trace_footprint(o,d,near,far,budget,frame.quality.x);
}
fn scene_trace_footprint(o:vec3<f32>,d:vec3<f32>,near:f32,far:f32,budget:u32,incoming_foot:f32)->RayResult {
 if !planet_scene() {let cam=frame.camera_hi.xyz+frame.camera_lo.xyz;return trace_field(cam+o,d,near,far,max(frame.quality.x,incoming_foot),budget,scene_model());}
 ray_prefix=RayPrefix(0,0,0,0,0,0);prefix_active=true;
 var cursor=Cursor(vec2<u32>(0),0u);var high=1u;var bounds=0u;var bands=0u;var pending=-1.0;var first_value=0.0;var preceding_sign=0.0;
 var root_near=near;var leaf_factor=0.0625;var refinements=0u;
 loop{
  if cursor.level==0xffffffffu{
   if pending>=0.0&&refinements<3u{root_near=pending;preceding_sign=first_value;pending=-1.0;cursor=Cursor(vec2<u32>(0),0u);leaf_factor*=0.125;refinements++;continue;}
   break;
  }let segment=cursor_range(cursor,root_near,far);let a=segment.x;let b=segment.y;
  if bounds>=budget{return RayResult(vec4<f32>(select(a,pending,pending>=0),b,2,0),vec4<u32>(bounds,bands,high,1));}
  let r=planet_range(o,d,a,b);bounds++;bands+=r.bands;
  if r.interval.x>0.0||r.interval.y<0.0{
   let region_sign=select(-1.0,1.0,r.interval.x>0.0);
   if pending<0.0{preceding_sign=region_sign;}
   else {
    if first_value*region_sign<0.0&&a-pending<=max(incoming_foot,ray_tolerance(pending)){return RayResult(vec4<f32>(pending,a,1,select(0.0,1.0,first_value<0.0)),vec4<u32>(bounds,bands,high,0));}
    if a-pending>max(incoming_foot,ray_tolerance(pending)){
     if refinements<3u{root_near=pending;preceding_sign=first_value;pending=-1.0;cursor=Cursor(vec2<u32>(0),0u);leaf_factor*=0.125;refinements++;continue;}
     return RayResult(vec4<f32>(pending,a,2,region_sign),vec4<u32>(bounds,bands,high,2));
    }
   }
   cursor=cursor_advance(cursor);continue;
  }
  let tol=max(incoming_foot,ray_tolerance(a));
  if b-a<=tol*leaf_factor{
   if pending<0.0{pending=a;first_value=preceding_sign;if first_value==0.0{let f=planet_value(o+d*a);let e=0.00008+length(o+d*a)*1.5e-6;first_value=select(0.0,sign(f),abs(f)>e);bands+=24u;}}
   let fb=planet_value(o+d*b);bands+=24u;let eps=0.00008+length(o+d*b)*1.5e-6;
   if ((first_value>0.0&&fb< -eps)||(first_value<0.0&&fb>eps))&&b-pending<=max(incoming_foot,ray_tolerance(pending)){return RayResult(vec4<f32>(pending,b,1,select(0.0,1.0,first_value<0)),vec4<u32>(bounds,bands,high,0));}
   if b-pending>max(incoming_foot,ray_tolerance(pending)){
    // Coarse interval uncertainty need not be a tangent. Revisit the earliest
    // uncertain prefix at a finer subdivision, retaining the proven prefix sign.
    if refinements<3u{root_near=pending;preceding_sign=first_value;pending=-1.0;cursor=Cursor(vec2<u32>(0),0u);leaf_factor*=0.125;refinements++;continue;}
    return RayResult(vec4<f32>(pending,b,2,fb),vec4<u32>(bounds,bands,high,2));
   }
   cursor=cursor_advance(cursor);
  }else{
   let mid=(a+b)*0.5;if cursor.level>=48u||mid==a||mid==b{return RayResult(vec4<f32>(a,b,3,0),vec4<u32>(bounds,bands,high,0));}
   cursor=cursor_descend(cursor);high=max(high,cursor.level+1u);
  }
 }
 return RayResult(vec4<f32>(select(far,pending,pending>=0),far,select(0.0,2.0,pending>=0),0),vec4<u32>(bounds,bands,high,0));
}
// Stable quadratic sphere interfaces. Coefficient c uses radial altitude,
// avoiding subtraction of two squared Earth radii near water or ground.
fn sphere_segment(d:vec3<f32>,height:f32)->vec2<f32>{
 return sphere_segment_relative(d,height,frame.radial.w-height);
}
fn sphere_segment_from(origin:vec3<f32>,d:vec3<f32>,height:f32)->vec2<f32>{
 let h=altitude(origin)-height;let radius=frame.camera_hi.w+height;
 let b=dot(frame.radial.xyz*frame.camera_lo.w+origin,d);let c=h*(2.0*radius+h);let disc=b*b-c;
 if disc<0.0{return vec2<f32>(-1);}
 let root=sqrt(disc);let q=-b-select(-root,root,b>=0.0);let other=c/select(q,1e-30,abs(q)<1e-30);
 return vec2<f32>(min(q,other),max(q,other));
}
fn sphere_segment_relative(d:vec3<f32>,height:f32,h:f32)->vec2<f32>{
 let r=frame.camera_lo.w;let interface_radius=frame.camera_hi.w+height;
 let b=r*dot(frame.radial.xyz,d);let c=h*(r+interface_radius);let disc=b*b-c;
 if disc<0.0{return vec2<f32>(-1);}
 let root=sqrt(disc);let q=-b-select(-root,root,b>=0.0);var t0=q;var t1=c/select(q,1e-30,abs(q)<1e-30);
 return vec2<f32>(min(t0,t1),max(t0,t1));
}
@compute @workgroup_size(GROUP_X,GROUP_Y)
fn visibility_image(@builtin(global_invocation_id) id:vec3<u32>){
 if any(id.xy>=frame.size.xy){return;}let index=id.y*frame.size.x+id.x;let d=view_direction(id.xy);var near=0.0;var far=frame.quality.z;
 if !active_reference_pixel(id.xy){hits[index]=RayResult(vec4<f32>(0,0,4,0),vec4<u32>(0));return;}
 if planet_scene(){
  let shell=sphere_segment(d,frame.base.z+250.0);near=max(0.0,shell.x);far=min(far,shell.y);
  let inner=sphere_segment(d,-frame.base.z-250.0);if inner.x>near {far=min(far,inner.x);}
  if far<=near {hits[index]=RayResult(vec4<f32>(frame.quality.z,frame.quality.z,0,0),vec4<u32>(0));if DIAGNOSTICS{atomicAdd(&stats[1],1u);}return;}
 }
 // The first refractive interface ends the primary event segment. Reflection
 // and transmission query their own solid segments in the transport pass.
 let water=water_distance(d);if water>0.0 {far=min(far,water);}
 if far<=near {hits[index]=RayResult(vec4<f32>(far,far,0,0),vec4<u32>(0));if DIAGNOSTICS{atomicAdd(&stats[1],1u);}return;}
 let result=scene_trace(vec3<f32>(0),d,near,far,frame.size.z);hits[index]=result;
 if DIAGNOSTICS{let status=u32(result.span.z);if status>=2u{atomicAdd(&stats[select(15u,14u,result.counts.w==1u)],1u);}atomicAdd(&stats[select(2u,select(1u,0u,status==1u),status<2u)],1u);
 count64(3u,10u,result.counts.x);count64(4u,11u,result.counts.y);atomicMax(&stats[5],result.counts.z);}
}
@compute @workgroup_size(64)
fn precision_probe(@builtin(global_invocation_id) id:vec3<u32>){
 if id.x>=128u{return;}
 var q=vec3<f32>(f32(hash32(id.x)>>8u),f32(hash32(id.x+71u)>>8u),f32(hash32(id.x+191u)>>8u))*(16.0/16777215.0)-8.0;
 if id.x==0u{q=vec3<f32>(0,0.001,0);}
 hits[id.x]=RayResult(vec4<f32>(planet_value(q),radial_change(q),0,0),vec4<u32>(0));
}
@compute @workgroup_size(64)
fn planet_query_probe(@builtin(global_invocation_id) id:vec3<u32>){
 if id.x>=35u{return;}let query=hits[id.x];
 hits[id.x]=scene_trace(vec3<f32>(0),query.span.xyz,bitcast<f32>(query.counts.x),query.span.w,8192u);
}
@compute @workgroup_size(64)
fn anchored_probe(@builtin(global_invocation_id) id:vec3<u32>){
 if id.x>=64u{return;}let q=hits[id.x].span.xyz;
 hits[id.x]=RayResult(vec4<f32>(planet_value(q),world_noise(q,0.03125,frame.options.w+926u),altitude(q),0),vec4<u32>(0));
}
@compute @workgroup_size(64)
fn region_probe(@builtin(global_invocation_id) id:vec3<u32>){
 if id.x>=64u{return;}let input=hits[id.x];let direction=bitcast<vec3<f32>>(input.counts.xyz);
 prefix_active=false;
 let result=planet_range(input.span.xyz,direction,-input.span.w,input.span.w);
 // Independently exercise a displaced cached center, including cell crossings
 // and ridge validity limits, against the same f64 samples as the direct bound.
 let center=input.span.w*0.25+0.001;let q=input.span.xyz+direction*center;
 var delta=0.0;var slope=0.0;var curvature=0.0;var reach=1e30;
 for(var k=0u;k<16u;k++){
  let p=read_proxy(k);let sample=proxy_sample(q,direction,0.0,k);
  delta+=p.config.x*sample.x;slope+=p.config.x*sample.z;curvature+=p.config.x*max(sample.w,0.0);
  if sample.w<0.0{reach=0.0;}
  if p.cell.w==1{reach=min(reach,max(0.0,abs(p.config.y)-sample.x-1e-5)/max(1e-20,3.0*dot(abs(direction),vec3<f32>(1))*p.phase.w));}
 }
 ray_prefix=RayPrefix(center,delta,slope,curvature*1.0001+1e-6,reach,0.00008+length(q)*1.5e-6);prefix_active=true;
 let cached=planet_range(input.span.xyz,direction,-input.span.w,input.span.w);let reused=prefix_reused;prefix_active=false;
 hits[id.x]=RayResult(vec4<f32>(result.interval,planet_ball(input.span.xyz,input.span.w)),vec4<u32>(bitcast<vec2<u32>>(cached.interval),u32(reused),result.bands));
}
@compute @workgroup_size(64)
fn water_probe(@builtin(global_invocation_id) id:vec3<u32>){
 if id.x>=64u{return;}let direction=hits[id.x].span.xyz;
 let cosine=hits[id.x].span.w;
 hits[id.x]=RayResult(vec4<f32>(water_distance(direction),frame.extra.w,dielectric_fresnel(cosine,1.333),dielectric_fresnel(cosine,1.0/1.333)),vec4<u32>(0));
}
