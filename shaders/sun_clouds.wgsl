// Sun-ray, whole-sphere optical-depth profiles plus three nested local profiles
// (256 m, 1024 m and 4096 m chart spacing, x4 steps like the height clipmaps).
// The exit point of the RECEIVER'S ray addresses the map, at every altitude.
// Sixteen cumulative knots cover both halves of the ray, with no history.
struct SunCloud {transmittance:f32,solid:f32}
const SUN_CLOUD_HEIGHTS:array<f32,9>=array<f32,9>(12500,9500,6500,4500,3500,2500,2000,1700,1300);
fn sun_cloud_coordinate(height:f32)->f32{
 for(var i=0u;i<8u;i++){if height>=SUN_CLOUD_HEIGHTS[i+1u]{return f32(i)+clamp((SUN_CLOUD_HEIGHTS[i]-height)/(SUN_CLOUD_HEIGHTS[i]-SUN_CLOUD_HEIGHTS[i+1u]),0.0,1.0);}}
 return 8.0;
}
// Distance from the sunward shell exit. The two middle endpoints straddle
// the empty inner shell; if a ray stays above it, both meet at the tangent.
fn sun_profile_span(b:f32,i:u32)->vec2<f32>{
 if i<8u{return vec2<f32>(sun_down_distance(b,SUN_CLOUD_HEIGHTS[i]),sun_down_distance(b,SUN_CLOUD_HEIGHTS[i+1u]));}
 let j=15u-i;return vec2<f32>(2.0*b-sun_down_distance(b,SUN_CLOUD_HEIGHTS[j+1u]),2.0*b-sun_down_distance(b,SUN_CLOUD_HEIGHTS[j]));
}
fn sun_shell_exit(p:vec3<f32>)->vec3<f32>{
 let world=f.eye_hi.xyz+(f.eye_lo.xyz+p);let h=sc_radial_height(p);let b=dot(world,f.sun.xyz);let c=(h-cloud_shell_top())*(2.0*f.planet.x+h+cloud_shell_top());let d=b*b-c;
 if d<0.0{return p;}let root=sqrt(d);let t=select(-b+root,-c/max(0.0001,b+root),b>=0.0);return p+f.sun.xyz*t;
}
fn sun_cloud_center(level:u32)->vec3<f32>{let n=normalize(f.eye_hi.xyz+f.eye_lo.xyz);let p=sun_shell_exit(-n*f.eye_hi.w);let face=sun_face(f.eye_hi.xyz+f.eye_lo.xyz+p);let step=256.0*exp2(f32(level)*2.0);let q=sun_chart(p,face);return vec3<f32>(floor(q.xy/step)*step,f32(face));}
// One copy of the knot interpolation serves both maps: a branch per texel
// fetch is far smaller to compile than four inlined copies of the math.
fn sun_profile_sample(which:u32,uv:vec2<f32>,layer:u32)->vec4<f32>{if which==0u{return textureSampleLevel(sun_cloud_global,sun_sampler,uv,i32(layer),0);}return textureSampleLevel(sun_cloud_local,sun_wrap_sampler,uv,i32(layer),0);}
fn sun_cloud_knot(which:u32,uv:vec2<f32>,layer:u32,x:f32,b:f32)->SunCloud{
 // Below the entire cloud base the requested knot is exact. Two filtered
 // endpoint reads suffice for most ground, water and vegetation receivers.
 if x==8.0{return SunCloud(sun_profile_sample(which,uv,layer+1u).w,1.0-sun_profile_sample(which,uv,layer+5u).w);}
 // Adjacent cumulative endpoints plus slope neighbors; most share RGBA texels.
 let i=u32(clamp(floor(x),0.0,15.0));let t=clamp(x-f32(i),0.0,1.0);let row=i/4u;
 let current=-log(max(vec4<f32>(1e-14),sun_profile_sample(which,uv,layer+row)));let opaque=sun_profile_sample(which,uv,layer+row+4u);
 var previous=0.0;var blocked=0.0;
 if i>0u{let old=(i-1u)/4u;if old==row{previous=current[(i-1u)%4u];blocked=opaque[(i-1u)%4u];}else{previous=-log(max(1e-14,sun_profile_sample(which,uv,layer+old).w));blocked=sun_profile_sample(which,uv,layer+old+4u).w;}}
 // Spatial filtering averages transmitted light, then monotone cubic radial
 // optical-depth slopes avoid horizontal creases between height knots.
 let next=current[i%4u];let span=sun_profile_span(b,i);let width=max(0.001,span.y-span.x);let slope=max(0.0,(next-previous)/width);
 var before=0.0;if i>1u{if (i-2u)/4u==row{before=current[(i-2u)%4u];}else{before=-log(max(1e-14,sun_profile_sample(which,uv,layer+(i-2u)/4u)[(i-2u)%4u]));}}
 var after=next;if i<15u{if (i+1u)/4u==row{after=current[(i+1u)%4u];}else{after=-log(max(1e-14,sun_profile_sample(which,uv,layer+(i+1u)/4u)[(i+1u)%4u]));}}
 var left=0.0;var right=0.0;
 if i>0u{let s=sun_profile_span(b,i-1u);let d=max(0.0,(previous-before)/max(0.001,s.y-s.x));left=2.0*d*slope/max(0.000001,d+slope);}
 if i<15u{let s=sun_profile_span(b,i+1u);let d=max(0.0,(after-next)/max(0.001,s.y-s.x));right=2.0*d*slope/max(0.000001,d+slope);}
 let tau=clamp(mix(previous,next,t*t*(3.0-2.0*t))+width*t*(1.0-t)*((1.0-t)*left-t*right),previous,next);
 return SunCloud(exp(-tau),1.0-mix(blocked,opaque[i%4u],t));
}
fn sun_cloud_local_address(exit:vec3<f32>,level:u32)->vec3<f32>{
 let c=sf.cloud_centers[level].xyz;let q=sun_chart(exit,u32(c.z));if q.z<f.planet.x*0.25{return vec3<f32>(0);}
 let step=256.0*exp2(f32(level)*2.0);let cell=(q.xy-c.xy)/step;let edge=max(abs(cell.x),abs(cell.y));
 // Toroidal storage: the absolute texel index modulo the map size, sampled
 // with a repeating sampler, so camera motion keeps every retained column.
 let absolute=q.xy/step-0.5;let storage=absolute-258.0*floor(absolute/258.0);
 // A map hands over to the next coarser one from 48 texels out (12 km for
 // the fine map, 49 km for the middle one) to 126: a single 22-texel band
 // (27 to 32 km, straight from 256 m to 4 km texels where a cloud is one
 // texel and its self-shadowing is gone) is a ring of appearing shadows
 // that follows the camera, and the two maps differ in mean brightness
 // (see SUN-SHADOWS.md, 28 October night), so the step is split in two x4
 // steps spread over 20 and 80 km. The coarse map keeps its narrow band to
 // the global chart, far beyond any resolved cloud.
 // Explicit diagnostics: bit 8192 restores the 104-texel hand-over; bit
 // 16384 drops the fine map and bit 32768 the fine and middle maps, for
 // back-to-back comparisons of brightness and cost.
 let inner=select(select(104.0,48.0,level<2u),104.0,(u32(f.cloud_drift.z)&8192u)!=0u);
 if (level==0u&&(u32(f.cloud_drift.z)&16384u)!=0u)||(level<2u&&(u32(f.cloud_drift.z)&32768u)!=0u){return vec3<f32>((storage+0.5)/258.0,0.0);}
 // Newly arrived columns are published from the centre out. Leave a
 // bilinear guard and fade into the already available coarser profile.
 let radius=sf.cloud_centers[level].w;
 let resident=smoothstep(1.0,12.0,radius-edge);
 return vec3<f32>((storage+0.5)/258.0,min(resident,1.0-smoothstep(inner,126.0,edge)));
}
// Global chart: azimuth about the sun axis, and a radius uniform in the sun's
// elevation at the ground point a ray reaches (one texel is about 0.35
// degrees of elevation, 40 km of ground along the sun, at every distance
// from the terminator), with an outer ring for the rays that pass above the
// ground inside the cloud shell, uniform in their perigee height. The exit
// point of a grazing ray barely moves as its ground point moves, so a
// Lambert equal-area chart of the exit point would spend 0.6 texels per
// degree at the terminator against 2.3 at 5 degrees up, and dusk shadows
// would be stretched fourfold along the sun into streaks (an orthographic light
// disk is worse still: it compresses the terminator into its rim).
const SUN_GLOBAL_RING:f32=0.1;
fn sun_global_z0()->f32{return sqrt(2.0*f.planet.x*cloud_shell_top()+cloud_shell_top()*cloud_shell_top())/(f.planet.x+cloud_shell_top());}
// Chart radius of an exit point whose cosine to the sun is z.
fn sun_global_radius(z:f32)->f32{
 let z0=sun_global_z0();
 if z<z0{return 1.0-SUN_GLOBAL_RING*(z/z0)*(z/z0);}
 let b=z*(f.planet.x+cloud_shell_top());let s=sqrt(max(0.0,b*b-2.0*f.planet.x*cloud_shell_top()-cloud_shell_top()*cloud_shell_top()))/f.planet.x;
 return (1.0-SUN_GLOBAL_RING)*(1.0-asin(clamp(s,0.0,1.0))/1.5707964);
}
// Cosine to the sun of the exit point at chart radius r: the inverse.
fn sun_global_cosine(r:f32)->f32{
 let z0=sun_global_z0();
 if r>1.0-SUN_GLOBAL_RING{return z0*sqrt(max(0.0,(1.0-r)/SUN_GLOBAL_RING));}
 let e=1.5707964*(1.0-r/(1.0-SUN_GLOBAL_RING));let s=f.planet.x*sin(e);
 return min(1.0,sqrt(2.0*f.planet.x*cloud_shell_top()+cloud_shell_top()*cloud_shell_top()+s*s)/(f.planet.x+cloud_shell_top()));
}
fn sun_cloud_global_uv(point:vec3<f32>)->vec2<f32>{
 let n=normalize(point);let z=clamp(dot(n,f.sun.xyz),0.0,1.0);
 let planar=vec2<f32>(dot(n,sf.right.xyz),-dot(n,sf.up.xyz));
 return planar/max(1.0e-6,length(planar))*sun_global_radius(z)*0.5+0.5;
}
// Chebyshev distance of a sun-ray exit from a local map's centre, in that
// map's texels (the hand-over coordinate; diagnostics only).
fn sun_cloud_local_edge(exit:vec3<f32>,level:u32)->f32{
 let c=sf.cloud_centers[level].xyz;let q=sun_chart(exit,u32(c.z));if q.z<f.planet.x*0.25{return 1.0e6;}
 let step=256.0*exp2(f32(level)*2.0);let cell=(q.xy-c.xy)/step;return max(abs(cell.x),abs(cell.y));
}
fn sun_cloud_maps(exit:vec3<f32>,point:vec3<f32>,x:f32)->SunCloud{
 let b=dot(point,f.sun.xyz);
 let fine=sun_cloud_local_address(exit,0u);
 // Up to four contributions blended in order (global, coarse local, middle
 // local, fine local) through one knot call site. Weights of exactly one
 // replace the running result, so the blend order reproduces the nesting.
 var which=array<u32,4>(0u,1u,1u,1u);var uvs=array<vec2<f32>,4>(vec2<f32>(0),vec2<f32>(0),vec2<f32>(0),fine.xy);var layers=array<u32,4>(0u,16u,8u,0u);var weights=array<f32,4>(0.0,0.0,0.0,fine.z);
 if fine.z<1.0{
  let middle=sun_cloud_local_address(exit,1u);uvs[2]=middle.xy;weights[2]=middle.z;
  if middle.z<1.0{
   let coarse=sun_cloud_local_address(exit,2u);uvs[1]=coarse.xy;weights[1]=coarse.z;
   if coarse.z<1.0{uvs[0]=sun_cloud_global_uv(point);weights[0]=1.0;}
  }
 }
 var result=SunCloud(1,1);
 for(var i=0u;i<4u;i++){if weights[i]<=0.0{continue;}let a=sun_cloud_knot(which[i],uvs[i],layers[i],x,b);result=SunCloud(mix(result.transmittance,a.transmittance,weights[i]),mix(result.solid,a.solid,weights[i]));}
 return result;
}
fn sun_cloud_lookup(p:vec3<f32>)->SunCloud{
 if f.options.y<0.5||sf.control.x<0.5{return SunCloud(1,1);}let h=sc_radial_height(p);let world=f.eye_hi.xyz+f.eye_lo.xyz+p;
 if sun_planet(p)==0.0{return SunCloud(1,0);}let receiver=dot(world,f.sun.xyz);
 if h>=cloud_shell_top()&&(receiver>=0.0||receiver*receiver<=(h-cloud_shell_top())*(2.0*f.planet.x+h+cloud_shell_top())){return SunCloud(1,1);}
 let exit=sun_shell_exit(p);let point=f.eye_hi.xyz+f.eye_lo.xyz+exit;let b=dot(point,f.sun.xyz);var x=8.0;
 if h>1300.0{
  let near=min(7u,u32(sun_cloud_coordinate(h)));let i=select(near,15u-near,receiver<0.0);let span=sun_profile_span(b,i);
  x=f32(i)+clamp((dot(exit-p,f.sun.xyz)-span.x)/max(0.001,span.y-span.x),0.0,1.0);
 }
 // Arc length, not height fraction, reaches the same cumulative value on
 // either side of a tangent. No per-view-sample procedural shadow march.
 return sun_cloud_maps(exit,point,x);
}
// Ground, water and clouds read one sun-ray integral. Its global chart
// is always resident; local charts refine it as their columns arrive.
@group(0) @binding(71) var sun_height_out:texture_storage_2d_array<rg32float,write>;
@group(0) @binding(72) var<storage,read_write> sun_height_keys:array<vec2<u32>>;
@group(0) @binding(73) var sun_global_out:texture_storage_2d_array<rgba16float,write>;
@group(0) @binding(74) var sun_local_out:texture_storage_2d_array<rgba16float,write>;
// World-anchored reuse, not temporal image history. Profile texels depend on
// world position, weather and sun only, so camera motion keeps every column
// still inside the toroidal window and regenerates only the columns that
// entered it. Weather animation refreshes an interleaved fraction of columns
// per frame; parameter, sun or terrain changes rebuild everything at once.
const SUN_MASK_PHASES:u32=8u;
struct SunCacheState {eye_hi:vec4<f32>,eye_lo:vec4<f32>,eye_tail:vec4<f32>,flags:vec4<u32>,counts:vec4<u32>,centers:array<vec4<f32>,3>,height_frame:atomic<u32>,height_total_lo:atomic<u32>,height_total_hi:atomic<u32>,mask_frames:u32,height_identity:vec4<u32>,height_reset:vec4<u32>,level_max:array<atomic<u32>,12>,previous_centers:array<vec4<f32>,3>,maxima_dirty:array<atomic<u32>,12>,previous_sun:vec4<f32>,previous_windows:array<vec4<i32>,12>}
@group(0) @binding(81) var<storage,read_write> sun_cache_state:SunCacheState;
@compute @workgroup_size(1)
fn sun_cache_begin(){
 atomicStore(&sun_cache_state.height_frame,0u);
 let optical=sf.right.w>0.5;let solid=sf.up.w>0.5;let animated=sf.cache_control.z!=0u;
 // Newly arrived terrain invalidates only the opaque half of each sunlight
 // profile. Retain its optical depth and refresh the resident masks in
 // bounded stripes, including in frozen weather. New columns fill both halves.
 if solid{sun_cache_state.mask_frames=select(SUN_MASK_PHASES,0u,optical);}
 let refresh_mask=sun_cache_state.mask_frames>0u;
 if refresh_mask{sun_cache_state.mask_frames-=1u;}
 sun_cache_state.flags=vec4<u32>(u32(optical),u32(solid),u32(optical),u32(solid||refresh_mask));
 // Rebuild counters count frames with optical work (parameter changes or an
 // interleaved animation refresh) and frames with solid work.
 sun_cache_state.counts+=vec4<u32>(u32(optical||animated),u32(solid),u32(optical||animated),u32(solid||refresh_mask));
 sun_cache_state.eye_hi=f.eye_hi;sun_cache_state.eye_lo=f.eye_lo;sun_cache_state.eye_tail=f.eye_tail;
 for(var level=0u;level<3u;level++){
  let old=sun_cache_state.centers[level];let centre=sun_cloud_center(level);
  let step=256.0*exp2(f32(level)*2.0);
  let shift=abs(centre.xy-old.xy)/step;
  var retained=max(0.0,old.w-max(shift.x,shift.y));
  if old.z!=centre.z||optical{retained=0.0;}
  var radius=min(129.0,retained+12.0);
  if f.options.y<0.5||sf.control.x<0.5{radius=0.0;}
  sun_cache_state.previous_centers[level]=old;
  sun_cache_state.centers[level]=vec4<f32>(centre,radius);
 }
 // One world revision and chart face identify every height texel; a change
 // invalidates all levels at once instead of keying each texel by token.
 let identity=vec2<u32>(f.numeric.w,sun_face(f.eye_hi.xyz+f.eye_lo.xyz)+1u);
 let reset=any(sun_cache_state.height_identity.xy!=identity)||sun_cache_state.height_identity.z==0u;
 sun_cache_state.height_reset=vec4<u32>(u32(reset),sf.height_refresh.x,0u,0u);
 sun_cache_state.height_identity=vec4<u32>(identity,1u,0u);
 if reset{for(var l=0u;l<12u;l++){atomicStore(&sun_cache_state.level_max[l],sun_order_float(-1e30));}}
 // A level's block maxima depend on its window and its texels alone: they are
 // rebuilt where one changed, or when the shadow switch turns (nothing is
 // produced while it is off). Refills set the flag themselves in
 // sun_height_generate. The sun never dirties them.
 let switched=sun_cache_state.previous_sun.w!=sf.control.x;sun_cache_state.previous_sun=vec4<f32>(0,0,0,sf.control.x);
 for(var l=0u;l<SUN_HEIGHT_LEVELS;l++){
  let w=sun_height_center(l);let prev=sun_cache_state.previous_windows[l];
  let dirty=switched||reset||((sf.height_refresh.x>>l)&1u)!=0u||any(prev.xy!=w)||prev.z==0;
  sun_cache_state.previous_windows[l]=vec4<i32>(w,1,0);atomicStore(&sun_cache_state.maxima_dirty[l],u32(dirty));
 }
}
fn sun_ds_int(x:i32)->vec2<f32>{let hi=f32(x);return vec2<f32>(hi,f32(x-i32(hi)));}
// Full and coarse canonical heights of one clipmap texel from its exact integer
// chart cell: double-single direction and body position, so the cache carries
// no Earth-sized f32 position error into the shadow envelope.
fn sun_cache_heights(face:u32,cell:vec2<i32>,step:f32,footprint:f32,live_start:u32)->vec2<f32>{
 let sx=sc_ds_div(ds_mul(sun_ds_int(cell.x),vec2<f32>(step,0)),vec2<f32>(f.planet.x,0));
 let sy=sc_ds_div(ds_mul(sun_ds_int(cell.y),vec2<f32>(step,0)),vec2<f32>(f.planet.x,0));
 var dx=vec2<f32>(0);var dy=vec2<f32>(0);var dz=vec2<f32>(0);
 switch face{
  case 0u:{dx=vec2<f32>(1,0);dy=sy;dz=-sx;}
  case 1u:{dx=vec2<f32>(-1,0);dy=sy;dz=sx;}
  case 2u:{dx=sx;dy=vec2<f32>(1,0);dz=-sy;}
  case 3u:{dx=sx;dy=vec2<f32>(-1,0);dz=sy;}
  case 4u:{dx=sx;dy=sy;dz=vec2<f32>(1,0);}
  default:{dx=-sx;dy=sy;dz=vec2<f32>(-1,0);}
 }
 let length2=ds_add(ds_add(ds_mul(dx,dx),ds_mul(dy,dy)),ds_mul(dz,dz));
 let inv=inverseSqrt(length2.x);let error=ds_add(vec2<f32>(1,0),-ds_mul(length2,ds_mul(vec2<f32>(inv,0),vec2<f32>(inv,0))));let corrected=ds_add(vec2<f32>(inv,0),ds_mul(vec2<f32>(0.5*inv,0),error));
 let scale=ds_mul(corrected,vec2<f32>(f.planet.x,0));
 let px=ds_mul(dx,scale);let py=ds_mul(dy,scale);let pz=ds_mul(dz,scale);
 let hi=floor(vec3<f32>(px.x,py.x,pz.x)/4096.0)*4096.0;let lo=(vec3<f32>(px.x,py.x,pz.x)-hi)+vec3<f32>(px.y,py.y,pz.y);
 return field_split(hi,lo,footprint,live_start);
}
@compute @workgroup_size(8,8)
fn sun_height_generate(@builtin(global_invocation_id) id:vec3<u32>,@builtin(local_invocation_index) lane:u32){
 field_final=true;if sf.control.x<0.5{return;}let level=id.z;let face=sun_face(f.eye_hi.xyz+f.eye_lo.xyz);let size=sun_height_size();let center=sun_height_center(level);let low=center-vec2<i32>(size/2);let c=low+((vec2<i32>(id.xy)-low)%vec2<i32>(size)+vec2<i32>(size))%vec2<i32>(size);let index=(id.z*u32(size)+id.y)*u32(size)+id.x;
 let instrument=sf.origins[0].z!=0u;if instrument{if lane==0u{atomicStore(&sun_height_rebuilds,0u);}workgroupBarrier();}
 let missing=sun_cache_state.height_reset.x!=0u||((sun_cache_state.height_reset.y>>level)&1u)!=0u||any(bitcast<vec2<i32>>(sun_height_keys[index])!=c);
 if missing{
 atomicOr(&sun_cache_state.maxima_dirty[level],1u);
 if instrument{atomicAdd(&sun_height_rebuilds,1u);}
 let step=sun_height_step(level);
 let heights=sun_cache_heights(face,c,step,max(0.25,step*0.25),u32(sf.height_errors[level].z));
 textureStore(sun_height_out,vec2<i32>(id.xy),i32(level),vec4<f32>(heights,0,0));sun_height_keys[index]=bitcast<vec2<u32>>(c);
 atomicMax(&sun_cache_state.level_max[level],sun_order_float(heights.x));
 }
 if instrument{workgroupBarrier();if lane==0u{let n=atomicLoad(&sun_height_rebuilds);atomicAdd(&sun_cache_state.height_frame,n);let old=atomicAdd(&sun_cache_state.height_total_lo,n);if old+n<old{atomicAdd(&sun_cache_state.height_total_hi,1u);}}}
}
var<workgroup> sun_height_rebuilds:atomic<u32>;
// Block maxima of the cached full height (sun_maxima in sun_visibility.wgsl),
// read by the terrain shadow march to jump over blocks that cannot bind. A
// level's maxima change only with its texels (a window scroll, a refill, a
// cache reset or the shadow switch), never with the sun. Blocks are aligned
// to absolute texel multiples; a block's maximum is taken over its texels and
// one texel past its high edges ([b, b + size] inclusive), so it bounds the
// bilinear height at every point of [b, b + size), whose four corner texels
// lie inside it. Texels outside the window are left out: the march never
// jumps into a level's edge band. Two passes of one 16 x 16 workgroup per
// 16-texel block (one more per axis: the window need not start on a block):
// the first reduces each block's 17 x 17 texels to its 16-block maximum in
// sun_block16 (slots modulo n / 16 + 1, so the blocks of one window never
// share a slot); the second writes every texel's 4, 16, 64 and 256-block
// maxima, the last two from the 16-block maxima of the window.
@group(0) @binding(95) var sun_maxima_out:texture_storage_2d_array<rgba32float,write>;
@group(0) @binding(97) var<storage,read_write> sun_block16:array<f32>;
var<workgroup> mx_flag:u32;
var<workgroup> mx_tile:array<f32,289>;
var<workgroup> mx_4:array<f32,16>;
var<workgroup> mx_wide:array<vec2<f32>,256>;
fn sun_block_slots()->i32{return sun_height_size()/16+1;}
fn sun_block_slot(level:u32,b:vec2<i32>)->u32{let m=sun_block_slots();let s=((b%m)+m)%m;return (level*u32(m)+u32(s.y))*u32(m)+u32(s.x);}
// Loads the 17 x 17 texels of the workgroup's block (outside the window:
// -1e30) and returns the block's origin; false when the level is clean.
fn sun_maxima_tile(wg:vec3<u32>,lane:u32)->vec2<i32>{
 let level=wg.z;let n=sun_height_size();let low=sun_height_center(level)-vec2<i32>(n/2);let high=low+vec2<i32>(n);
 let origin=(low&vec2<i32>(-16))+vec2<i32>(wg.xy)*16;
 for(var e=lane;e<289u;e+=256u){
  let texel=origin+vec2<i32>(i32(e%17u),i32(e/17u));var h=-1e30;
  if all(texel>=low)&&all(texel<high){h=textureLoad(sun_heights,((texel%n)+n)%n,i32(level),0).x;}
  mx_tile[e]=h;
 }
 workgroupBarrier();
 return origin;
}
@compute @workgroup_size(16,16)
fn sun_height_blocks(@builtin(workgroup_id) wg:vec3<u32>,@builtin(local_invocation_index) lane:u32){
 if sf.control.x<0.5{return;}
 if lane==0u{mx_flag=atomicLoad(&sun_cache_state.maxima_dirty[wg.z]);}
 if workgroupUniformLoad(&mx_flag)==0u{return;}
 let origin=sun_maxima_tile(wg,lane);
 var m=-1e30;if lane<17u{for(var y=0u;y<17u;y++){m=max(m,mx_tile[y*17u+lane]);}}
 mx_wide[lane]=vec2<f32>(m);
 workgroupBarrier();
 if lane==0u{var b=-1e30;for(var x=0u;x<17u;x++){b=max(b,mx_wide[x].x);}sun_block16[sun_block_slot(wg.z,origin>>vec2<u32>(4u))]=b;}
}
@compute @workgroup_size(16,16)
fn sun_height_maxima(@builtin(workgroup_id) wg:vec3<u32>,@builtin(local_invocation_id) lid:vec3<u32>,@builtin(local_invocation_index) lane:u32){
 if sf.control.x<0.5{return;}
 let level=wg.z;
 if lane==0u{mx_flag=atomicLoad(&sun_cache_state.maxima_dirty[level]);}
 if workgroupUniformLoad(&mx_flag)==0u{return;}
 let origin=sun_maxima_tile(wg,lane);
 if lane<16u{let b=vec2<u32>(lane%4u,lane/4u)*4u;var m=-1e30;for(var y=0u;y<5u;y++){for(var x=0u;x<5u;x++){m=max(m,mx_tile[(b.y+y)*17u+b.x+x]);}}mx_4[lane]=m;}
 // The 64 and 256-blocks holding this 16-block: lane (x, y) reads the
 // 16-block maximum at the 256-block's (x, y) when that block is in the
 // window (the others hold some other block's value: never read).
 let n=sun_height_size();let first=(sun_height_center(level)-vec2<i32>(n/2))>>vec2<u32>(4u);let mine=origin>>vec2<u32>(4u);
 let at=(mine&vec2<i32>(-16))+vec2<i32>(lid.xy);var v=-1e30;
 if all(at>=first)&&all(at<first+vec2<i32>(sun_block_slots())){v=sun_block16[sun_block_slot(level,at)];}
 let quad=all((vec2<i32>(lid.xy)>>vec2<u32>(2u))==((mine&vec2<i32>(15))>>vec2<u32>(2u)));
 mx_wide[lane]=vec2<f32>(select(-1e30,v,quad),v);
 workgroupBarrier();
 for(var s=128u;s>0u;s>>=1u){if lane<s{mx_wide[lane]=max(mx_wide[lane],mx_wide[lane+s]);}workgroupBarrier();}
 let texel=origin+vec2<i32>(lid.xy);let low=sun_height_center(level)-vec2<i32>(n/2);
 if all(texel>=low)&&all(texel<low+vec2<i32>(n)){
  var m16=-1e30;for(var i=0u;i<16u;i++){m16=max(m16,mx_4[i]);}
  textureStore(sun_maxima_out,((texel%n)+n)%n,i32(level),vec4<f32>(mx_4[(lid.y/4u)*4u+lid.x/4u],m16,mx_wide[0].x,mx_wide[0].y));
 }
}
fn sun_down_distance(b:f32,height:f32)->f32{let c=(cloud_shell_top()-height)*(2.0*f.planet.x+cloud_shell_top()+height);let d=b*b-c;if d<=0.0{return max(0.0,b);}return c/max(0.001,b+sqrt(d));}
// Give a whole 8 x 8 workgroup one refresh phase.
fn sun_profile_refresh(coord:vec2<i32>)->bool{
 if sf.cache_control.z==0u{return false;}
 let divisor=max(1u,sf.cache_control.y);
 let tile=vec2<u32>(coord)/8u;
 let phase=hash(tile.x+4099u*tile.y);
 return (phase%divisor+sf.cache_control.x%divisor)%divisor==0u;
}
fn sun_bake_cloud(point:vec3<f32>,footprint:f32,coord:vec2<i32>,layer:u32,local:bool,fresh:bool){
 let flags=sun_cache_state.flags;var optical_dirty=select(flags.x,flags.z,local)!=0u;var solid_dirty=select(flags.y,flags.w,local)!=0u;
 if local&&solid_dirty&&!optical_dirty{solid_dirty=(u32(coord.y)/8u)%SUN_MASK_PHASES==sf.cache_control.x%SUN_MASK_PHASES;}
 // cache_control.w: the sun drifted below the rebake angle, so its interleaved rows refresh the terrain mask too.
 if fresh{optical_dirty=true;solid_dirty=true;}else if sun_profile_refresh(coord){optical_dirty=true;solid_dirty=solid_dirty||sf.cache_control.w!=0u;}
 if !optical_dirty&&!solid_dirty{return;}
 let b=dot(point,f.sun.xyz);var optical:array<vec4<f32>,4>;var opaque:array<vec4<f32>,4>;var tau=0.0;var blocked=0.0;
 if f.options.y>0.5&&sf.control.x>0.5&&b>0.0{
  // Fine maps resolve kilometre-scale puffs. Four samples per height knot
  // skipped whole groups at grazing sun angles and flickered on sun motion.
  // Keep a fixed quadrature count (no angle-dependent integer count jumps).
  let base_count=max(1u,u32(round(f32(select(4u,16u,local))*clamp(sf.quality.y,0.25,1.0))));
  let through_core=b*b>(cloud_shell_top()+sf.metrics.x)*(2.0*f.planet.x+cloud_shell_top()-sf.metrics.x);
  for(var k=0u;k<16u;k++){let count=base_count*select(1u,2u,k<2u||k>=14u);let segment=sun_profile_span(b,k);let ds=(segment.y-segment.x)/f32(count);
   if through_core&&k>=8u{blocked=1.0;}
   else if ds>0.0{for(var j=0u;j<count;j++){let t=segment.x+(f32(j)+0.5)*ds;let world=point-f.sun.xyz*t;let relative=(point-f.eye_hi.xyz)-f.eye_lo.xyz-f.eye_tail.xyz-f.sun.xyz*t;
    // Factored radial height avoids half-metre layer quantization.
    let h=cloud_shell_top()+(t*t-2.0*b*t)/(sqrt(max(1.0,pow(f.planet.x+cloud_shell_top(),2.0)+t*t-2.0*b*t))+f.planet.x+cloud_shell_top());
    // Detail finer than the sample spacing cannot be integrated by these
    // samples (grazing rays space them kilometres apart), so it joins the
    // statistical term like the view march's.
    if optical_dirty&&tau<32.0{let w=cached_weather(world);
    // Integrate the thin vertical envelope over this sun segment. Midpoint
    // tests alone flickered when a low sun swept samples across cloud bases.
    let span=abs(dot(normalize(world),f.sun.xyz))*ds+ds*ds/(4.0*f.planet.x);
    // The cloud profile is exactly zero when the whole span [h-span/2,
    // h+span/2] lies outside [base, base+thickness]: both clamped integrals
    // (or the midpoint profile) are then equal or zero. Skip the noise there;
    // most sun-ray samples of a thin deck lie above or below it.
    if h+span*0.5>w.base&&h-span*0.5<w.base+max(100.0,w.top-w.base){
     let shape=cloud_body(world,h,max(footprint,ds),w);
     tau+=cloud_extinction(shape.x,w.kind,shape.y,cloud_profile(h,span,shape.zw).x)*ds;
    }
    }
    if solid_dirty&&blocked<1.0&&h<=sf.metrics.x{var terrain=0.0;if local{terrain=sun_terrain_height(relative,max(footprint,32.0)).x;}else{terrain=surface_detail_sample(relative,footprint).height;}blocked=max(blocked,smoothstep(0.0,max(1.0,footprint*0.1),terrain-h));}
   }}
   optical[k/4u][k%4u]=min(32.0,tau);opaque[k/4u][k%4u]=blocked;
  }
 }
 for(var k=0u;k<8u;k++){if (k<4u&&!optical_dirty)||(k>=4u&&!solid_dirty){continue;}var value=exp(-optical[k%4u]);if k>=4u{value=opaque[k-4u];}if local{textureStore(sun_local_out,coord,i32(layer+k),value);}else{textureStore(sun_global_out,coord,i32(layer+k),value);}}
}
fn sun_cloud_generate_ray(id:vec3<u32>){
 field_final=true;
 if id.z==0u{
  let global=f.tier_b.y;if any(id.xy>=vec2<u32>(global)){return;}
  let uv=(vec2<f32>(id.xy)+0.5)/f32(global)*2.0-1.0;let len=length(uv);
  let z=sun_global_cosine(min(len,1.0));let radius=f.planet.x+cloud_shell_top();
  let dir=select(uv/max(len,1.0e-6),vec2<f32>(1,0),len<1.0e-6);
  let point=((sf.right.xyz*dir.x-sf.up.xyz*dir.y)*sqrt(max(0.0,1.0-z*z))+f.sun.xyz*z)*radius;
  // One texel spans about 0.35 degrees of ground elevation; that arc is its
  // footprint, the tangential span being smaller everywhere.
  sun_bake_cloud(point,1.5707964*f.planet.x/((1.0-SUN_GLOBAL_RING)*0.5*f32(global)),vec2<i32>(id.xy),0u,false,false);
 }
 else{if any(id.xy>=vec2<u32>(258)){return;}let level=id.z-1u;let c=sf.cloud_centers[level];let step=256.0*exp2(f32(level)*2.0);
  // Toroidal window: storage texel -> absolute column index; columns that were
  // outside the previous window (or on another face) are fresh.
  let origin=vec2<i32>(round(c.xy/step))-129;let storage=vec2<i32>(id.xy);
  let absolute=origin+((storage-origin)%258+258)%258;
  let offset=abs(vec2<f32>(absolute)+0.5-c.xy/step);
  if max(offset.x,offset.y)>=c.w{return;}
  let previous=sun_cache_state.previous_centers[level];
  let old_offset=abs(vec2<f32>(absolute)+0.5-previous.xy/step);
  let fresh=max(old_offset.x,old_offset.y)>=previous.w||previous.z!=c.z;
  let uv=(vec2<f32>(absolute)+0.5)*step/f.planet.x;let point=normalize(weather_direction(u32(c.z),uv))*(f.planet.x+cloud_shell_top());sun_bake_cloud(point,max(128.0,step*0.5),storage,level*8u,true,fresh);}
}
@compute @workgroup_size(8,8)
fn sun_cloud_global_generate(@builtin(global_invocation_id) id:vec3<u32>){sun_cloud_generate_ray(vec3<u32>(id.xy,0u));}
@compute @workgroup_size(8,8)
fn sun_cloud_local_generate(@builtin(global_invocation_id) id:vec3<u32>){sun_cloud_generate_ray(vec3<u32>(id.xy,id.z+1u));}

// Explicit qualification only: independent high-sample ray quadrature, without
// cloud profiles, texture addressing, local density cache or temporal reuse.
fn sun_reference_cloud(p:vec3<f32>)->f32{
 if f.options.y<0.5{return 1.0;}let world=f.eye_hi.xyz+f.eye_lo.xyz+p;let height=sc_radial_height(p);let b=dot(world,f.sun.xyz);
 let c=(height-cloud_shell_top())*(2.0*f.planet.x+height+cloud_shell_top());let d=b*b-c;if d<=0.0{return 1.0;}
 let a=max(0.0,-b-sqrt(d));let end=-b+sqrt(d);if end<=a{return 1.0;}
 let ci=(height-1300.0)*(2.0*f.planet.x+height+1300.0);let di=b*b-ci;var start=a;
 if di>0.0&&height<1300.0{start=max(a,-b+sqrt(di));}
 let ds=(end-start)/256.0;var tau=0.0;
 for(var i=0u;i<256u;i++){let q=p+f.sun.xyz*(start+(f32(i)+0.5)*ds);let point=f.eye_hi.xyz+f.eye_lo.xyz+q;let h=sc_radial_height(q);let w=cached_weather(point);let z=(h-w.base)/max(100.0,w.top-w.base);
  if z>0.0&&z<1.0{
   let body=cloud_body(point,h,128.0,w);let local_h=(h-body.z)/max(1.0,body.w-body.z);
   tau+=body.x*mix(0.00125,0.0011,w.kind)*smoothstep(0.0,0.08,local_h)*(1.0-smoothstep(0.9,1.0,local_h))*ds;
  }
 }
 return exp(-tau);
}
@group(0) @binding(79) var<storage,read_write> sun_audit_out:array<vec4<f32>>;
@compute @workgroup_size(64)
fn sun_audit(@builtin(global_invocation_id) id:vec3<u32>){
 if id.x>=3072u{return;}let xy=vec2<i32>((vec2<f32>(f32(id.x%64u),f32(id.x/64u))+0.5)/vec2<f32>(64,32)*f.view.xy);var p=textureLoad(positions,clamp(xy,vec2<i32>(0),vec2<i32>(f.view.xy)-1),0);var normal=textureLoad(normals,clamp(xy,vec2<i32>(0),vec2<i32>(f.view.xy)-1),0);var fp=surface_detail_footprint(p.xyz);let base=id.x*5u;
 if id.x>=2048u{let i=id.x-2048u;let n=normalize(f.eye_hi.xyz+f.eye_lo.xyz);let basis=sc_basis(n,0);let offset=(vec2<f32>(f32(i%32u),f32(i/32u))-15.5)*8.0;let point=-n*f.eye_hi.w+basis[0]*offset.x+basis[2]*offset.y;let detail=surface_detail_sample(point,0.25);p=vec4<f32>(point+n*(detail.height-sc_radial_height(point)),detail.height);normal=vec4<f32>(detail.normal,0);fp=0.25;}
 sun_audit_out[base]=vec4<f32>(vec2<f32>(xy),fp,normal.w);sun_audit_out[base+1u]=p;
 if length(p.xyz)<0.1{return;}var terrain_receiver=p.xyz;if normal.w>= -100.0{let h=surface_detail_sample(p.xyz,fp).height;terrain_receiver+=normalize(f.eye_hi.xyz+f.eye_lo.xyz+p.xyz)*(h-sc_radial_height(p.xyz));}let terrain=sun_terrain(terrain_receiver,fp,-1e30,0.0);let light=sunlight_at(p.xyz,terrain_receiver,normalize(normal.xyz),fp,-1e30,0.0);let height=sun_terrain_height(p.xyz,fp);let cloud=sun_cloud_lookup(p.xyz);
 sun_audit_out[base+2u]=vec4<f32>(terrain.visibility,terrain.unresolved,sun_props(p.xyz,normalize(normal.xyz)),sc_sun_cover(p.xyz,normalize(normal.xyz),fp));
 sun_audit_out[base+3u]=vec4<f32>(cloud.transmittance,sun_reference_cloud(p.xyz),cloud.solid,sun_direct(light));
 sun_audit_out[base+4u]=vec4<f32>(height.x,height.z,sc_radial_height(p.xyz),terrain.work);
}

// Explicit fixed-world translation audit; input positions are relative to the
// CPU camera anchor and corrected for the GPU safety lift here. Never in play.
// A negative footprint selects the shading pass's receiver contract: the
// receiver is lifted to its canonical height at |footprint| and that height
// is passed as the start hint. Slots 5..13 carry the query trace (sun_dbg).
@group(0) @binding(80) var<storage,read> sun_world_probes:array<vec4<f32>>;
@compute @workgroup_size(64)
fn sun_world_audit(@builtin(global_invocation_id) id:vec3<u32>){
 if id.x>=arrayLength(&sun_world_probes){return;}
 let input=sun_world_probes[id.x];let up=normalize(f.eye_hi.xyz+f.eye_lo.xyz);var p=input.xyz-up*(f.eye_hi.w-sf.metrics.y);let hinted=input.w<0.0;let fp=abs(input.w);let normal=normalize(f.eye_hi.xyz+f.eye_lo.xyz+p);let i=id.x*14u;
 var hint=-1e30;if hinted{hint=surface_detail_sample(p,fp).height;p+=normal*(hint-sc_radial_height(p));}
 let terrain=sun_terrain(p,fp,hint,0.0);let cloud=sun_cloud_lookup(p);let height=sun_terrain_height(p,fp);
 sun_audit_out[i]=vec4<f32>(p,fp);
 sun_audit_out[i+1u]=vec4<f32>(terrain.visibility,terrain.unresolved,sun_props(p,normal),cloud.transmittance);
 sun_audit_out[i+2u]=vec4<f32>(sun_prop_level(p,normal,0u),sun_prop_level(p,normal,1u),sun_prop_level(p,normal,2u),sun_prop_level(p,normal,3u));
 sun_audit_out[i+3u]=vec4<f32>(sun_prop_level(p,normal,4u),sun_prop_level(p,normal,5u),height.x,height.z);
 sun_audit_out[i+4u]=vec4<f32>(surface_detail_sample(p,fp).height,sc_radial_height(p),sc_sun_cover(p,normal,fp),terrain.work);
 for(var k=0u;k<9u;k++){sun_audit_out[i+5u+k]=sun_dbg[k];}
}
