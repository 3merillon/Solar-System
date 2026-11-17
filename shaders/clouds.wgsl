// Seamless 3D weather: advected, sheared fronts and evolving curl warps.
// A world-anchored cube atlas makes weather independent of ray length or camera.
struct Weather { amount:f32,kind:f32,base:f32,top:f32,warp:f32 }
// Weather base <= 1780m and cumulus thickness <= 10000m. Keep the ray/shadow
// shell outside that envelope, and the local cache above it with spare gutters.
fn cloud_shell_top()->f32{return f.cloud_shell.x;}
// Local density/light volume: a world-anchored lattice on the camera's cube
// chart (CLOUD_CACHE_SIZE cells of CLOUD_CACHE_CELL metres) with CLOUD_CACHE_SIZE
// radial slices from CLOUD_CACHE_BOTTOM at CLOUD_CACHE_SLICE spacing. Toroidal
// storage keeps every retained voxel while the camera moves; animation refreshes
// an interleaved fraction of voxels per frame.
fn cloud_cache_size()->i32{return i32(f.tier_b.w);}
const CLOUD_CACHE_CELL:f32=256.0;
const CLOUD_CACHE_BOTTOM:f32=1024.0;
const CLOUD_CACHE_SLICE:f32=96.0;
struct CloudCacheState {origin:vec4<i32>,previous:vec4<i32>,control:vec4<u32>}
@group(0) @binding(45) var weather_out:texture_storage_2d<rgba16float,write>;
@group(0) @binding(46) var weather_map:texture_2d<f32>;
@group(0) @binding(48) var cloud_local_out:texture_storage_3d<rgba16float,write>;
@group(0) @binding(49) var cloud_local:texture_3d<f32>;
@group(0) @binding(50) var cloud_sampler:sampler;
@group(0) @binding(84) var<storage,read_write> cloud_cache:CloudCacheState;
// Per-column weather of the volume (kind, base - 1550, thickness): a tiny 2D
// texture instead of three wasted channels in every voxel.
@group(0) @binding(85) var cloud_column_out:texture_storage_2d<rgba16float,write>;
@group(0) @binding(86) var cloud_column:texture_2d<f32>;
@group(0) @binding(87) var cloud_wrap_sampler:sampler;
// Far-field clouds beyond f.cloud_far.y metres integrate at a reduced
// resolution (f.cloud_far.x cloud pixels per far texel). The near pass
// composes them behind its own segment with the same depth-guided validity
// test the composite uses, and marches the far segment itself where no
// neighbouring far texel is valid, so silhouettes keep the full-rate result.
@group(0) @binding(88) var cloud_far_out:texture_storage_2d<rgba16float,write>;
@group(0) @binding(89) var cloud_far_guide_out:texture_storage_2d<rgba32float,write>;
@group(0) @binding(90) var cloud_far:texture_2d<f32>;
@group(0) @binding(91) var cloud_far_guide:texture_2d<f32>;
fn cloud_noise(p:vec3<f32>,scale:f32,seed:u32)->f32{return water_simplex(vec3<f32>(0),p,scale,seed,vec3<f32>(0),vec3<f32>(0)).field.w;}
// Advect on the sphere by rigid rotations. Cartesian, height-scaled drift
// accumulated an ever larger shear (and a different stretch at each latitude).
// Rotation preserves distances; the optional vertical shear is bounded to 300m.
fn cloud_rotate(p:vec3<f32>,axis:vec3<f32>,angle:f32)->vec3<f32>{let c=cos(angle);let s=sin(angle);return p*c+cross(axis,p)*s+axis*dot(axis,p)*(1.0-c);}
fn cloud_advect(p:vec3<f32>,height:f32)->vec3<f32>{
 let drift=vec3<f32>(f.cloud_drift.y,0,-f.cloud_drift.x);let distance=length(drift);
 var q=cloud_rotate(p,vec3<f32>(0,0,1),-28.0*f.cloud_motion.x/f.planet.x);
 if distance>0.001{q=cloud_rotate(q,drift/distance,(distance+300.0*height*sin(f.cloud_motion.x/120.0))/f.planet.x);}
 return q;
}
fn cloud_weather(p:vec3<f32>)->Weather{
 let seed=bitcast<u32>(f.geo.z);let radial=normalize(p);
 let q=cloud_advect(radial*(f.planet.x+3200.0),0.0);
 let a=water_simplex(vec3<f32>(0),q+vec3<f32>(23,-11,17)*f.cloud_motion.y,2097152.0,seed+201u,vec3<f32>(0),vec3<f32>(0)).field.xyz*2097152.0;
 let b=water_simplex(vec3<f32>(0),q+vec3<f32>(-13,19,7)*f.cloud_motion.y,1048576.0,seed+202u,vec3<f32>(0),vec3<f32>(0)).field.xyz*1048576.0;
 let curl=cross(a,vec3<f32>(0,0,1))+cross(b,vec3<f32>(0,1,0));
 // A separate, slowly evolving regional field leaves genuinely calm areas.
 // Evaluate it BEFORE warping so stronger turbulence cannot erase those areas.
 let activity=smoothstep(-0.12,0.42,cloud_noise(q+vec3<f32>(7,-3,5)*f.cloud_motion.y,393216.0,seed+207u));
 let warped=q+curl*160000.0*f.cloud_motion.z*activity;
 let regional=cloud_noise(warped,2097152.0,seed+203u);
 let front=1.0-abs(cloud_noise(warped*vec3<f32>(0.7,0.7,1.8),1048576.0,seed+204u));
 let fragments=cloud_noise(warped,524288.0,seed+205u);
 // Store a smooth unthresholded coverage field in the atlas. Applying its
 // threshold after interpolation prevents small opaque atlas-shaped islands.
 let amount=0.90*regional+0.20*front+0.12*fragments+f.sun.w-0.15;
 let kind=smoothstep(-0.35,0.35,cloud_noise(warped,1048576.0,seed+206u)+f.cloud_motion.w);
 let base=1550.0+230.0*fragments;
 return Weather(amount,kind,base,base+mix(650.0,10000.0,kind)*(0.55+0.45*smoothstep(-0.08,0.45,amount)),activity);
}
fn weather_direction(face:u32,uv:vec2<f32>)->vec3<f32>{switch face{case 0u:{return vec3<f32>(1,uv.y,-uv.x);}case 1u:{return vec3<f32>(-1,uv.y,uv.x);}case 2u:{return vec3<f32>(uv.x,1,-uv.y);}case 3u:{return vec3<f32>(uv.x,-1,uv.y);}case 4u:{return vec3<f32>(uv,1);}default:{return vec3<f32>(-uv.x,uv.y,-1);}}}
// Interleaved refresh for animated fields: with divisor N each ROW (or voxel
// row) is re-evaluated every N frames. Rows are chosen so that the decision is
// uniform across a whole 64-wide workgroup; skipping individual threads would
// leave their warps running. Parameter changes refresh everything.
fn cloud_refresh(row:u32,depth:u32)->bool{
 if f.cloud_cache.z!=0u{return true;}
 if f.cloud_cache.w==0u{return false;}
 let divisor=max(1u,f.cloud_cache.y);
 return ((row+3u*depth+f.cloud_cache.x)%divisor)==0u;
}
@compute @workgroup_size(64,1)
fn weather_generate(@builtin(global_invocation_id) id:vec3<u32>){let face_size=f.tier_c.x;let padded=face_size+2u;if id.x>=padded||id.y>=6u*padded||f.options.y<0.5{return;}if !cloud_refresh(id.y,0u){return;}let face=id.y/padded;let uv=(vec2<f32>(vec2<u32>(id.x,id.y%padded))-0.5)/f32(face_size)*2.0-1.0;let w=cloud_weather(normalize(weather_direction(face,uv))*f.planet.x);
 // Half-float atlas: the base is stored relative to its 1550 m mean so f16
 // keeps 0.25 m precision; amount, kind and activity are unit-scale fields.
 textureStore(weather_out,vec2<i32>(id.xy),vec4<f32>(w.amount,w.kind,w.base-1550.0,w.warp));}
fn cached_weather(p:vec3<f32>)->Weather{
 let a=abs(p);var face=0u;var uv=vec2<f32>(0);
 if a.x>=max(a.y,a.z){face=select(1u,0u,p.x>=0.0);uv=vec2<f32>(select(p.z,-p.z,p.x>=0.0),p.y)/a.x;}
 else if a.y>=a.z{face=select(3u,2u,p.y>=0.0);uv=vec2<f32>(p.x,select(p.z,-p.z,p.y>=0.0))/a.y;}
 else{face=select(5u,4u,p.z>=0.0);uv=vec2<f32>(select(-p.x,p.x,p.z>=0.0),p.y)/a.z;}
 // One hardware bilinear fetch at the texel-centre coordinate of the padded
 // face replaces four loads; the gutters keep face edges continuous.
 let face_size=f32(f.tier_c.x);let padded=face_size+2.0;let q=(uv*0.5+0.5)*face_size+1.0;
 let v=textureSampleLevel(weather_map,cloud_sampler,vec2<f32>(q.x/padded,(q.y+f32(face)*padded)/(6.0*padded)),0.0);
 // Top is derived from the interpolated weather. The fourth atlas channel
 // carries regional warp activity without an additional texture or read.
 let amount=smoothstep(-0.08,0.45,v.x);let base=v.z+1550.0;
 return Weather(amount,v.y,base,base+mix(650.0,10000.0,v.y)*(0.55+0.45*amount),v.w);
}
fn cloud_ramp_integral(x:f32,a:f32,b:f32)->f32{let t=clamp((x-a)/(b-a),0.0,1.0);return (b-a)*(t*t*t-0.5*t*t*t*t)+max(0.0,x-b);}
fn cloud_profile_integral(value:f32)->f32{let x=clamp(value,0.0,1.0);return cloud_ramp_integral(x,0.0,0.08)-cloud_ramp_integral(x,0.90,1.0);}
// Returns the body (density, or the coverage probability where the filter
// dropped octaves into the statistical term) and the correlation length of
// that unresolved structure (a quarter of each dropped octave's scale,
// amplitude weighted; zero when everything is resolved), which the medium
// needs to turn the probability into a mean transmittance.
fn cloud_body(p:vec3<f32>,h:f32,footprint:f32,w:Weather)->vec2<f32>{
 if w.amount<=0.0{return vec2<f32>(0);}
 let seed=bitcast<u32>(f.geo.z);let radial=normalize(p);let thickness=max(100.0,w.top-w.base);let raw_height=(h-w.base)/thickness;let height=clamp(raw_height,0.0,1.0);
 let q=cloud_advect(p,height);
 // Weather selects a regime, not an opaque background sheet. Mesoscale dry
 // slots and independent cloud groups cut through BOTH cloud types. Blending
 // two separately filled layers would fill every cumulus gap with stratus.
 let system=water_simplex(vec3<f32>(0),q+radial*f.cloud_motion.y*5.0,131072.0,seed+211u,vec3<f32>(0),vec3<f32>(0)).field;
 let warped=q+cross(system.xyz*131072.0,radial)*(20000.0*f.cloud_motion.z*w.warp);
 let cluster=cloud_noise(warped,32768.0,seed+214u)*filter_weight(65536.0,footprint);
 // Dense cumulus would otherwise remain solid at height=1, sliced off by
 // the weather ceiling. Erode the upper mass to isolated rounded summits
 // before the envelope closes. The expanded layer leaves room for tall caps;
 // increasing the ray shell alone would still leave a flat weather ceiling.
 let vertical=mix(pow(height,4.0)*0.18,pow(height,1.5)*0.55+1.5*smoothstep(0.50,0.90,height),w.kind);
 let mass=w.amount*0.62+system.w*0.62+cluster*0.40-0.40-vertical;
 let large_amplitude=mix(0.10,0.20,w.kind);let small_amplitude=mix(0.05,0.14,w.kind);
 let large_weight=filter_weight(32768.0,footprint);let small_weight=filter_weight(8192.0,footprint);
 // Unresolved variation widens the coverage distribution instead of turning
 // the mean of a broken cloud group into a solid blurred slab.
 let puff_amplitude=0.12*w.kind;let puff_weight=filter_weight(2048.0,footprint);
 let unresolved=large_amplitude*(1.0-large_weight)+small_amplitude*(1.0-small_weight)+puff_amplitude*(1.0-puff_weight);
 let width=0.09+unresolved*0.6;let residual=large_amplitude*large_weight+small_amplitude*small_weight+puff_amplitude*puff_weight;
 let ell=(puff_amplitude*(1.0-puff_weight)*256.0+small_amplitude*(1.0-small_weight)*1024.0+large_amplitude*(1.0-large_weight)*4096.0)/max(0.000001,puff_amplitude+small_amplitude+large_amplitude);
 // Simplex values are clamped to [-1,1]; these early exits enclose all omitted
 // detail, including every evolution epoch. No occupied density is skipped.
 if mass+residual<=-width{return vec2<f32>(0.0,ell);}
 var body=1.0;
 if mass-residual<width{
  let large=cloud_noise(warped+radial*f.cloud_motion.y*7.0,16384.0,seed+212u);
  let small=cloud_noise(warped+radial*f.cloud_motion.y*11.0,4096.0,seed+213u);
  let puff=cloud_noise(warped+radial*f.cloud_motion.y*13.0,1024.0,seed+215u);
  body=smoothstep(-width,width,mass+large*large_amplitude*large_weight+small*small_amplitude*small_weight+puff*puff_amplitude*puff_weight);
 }
 // Regional weather is a continuous envelope, not a binary mask. Small
 // amounts can still contain dense mesoscale groups; skipping them at 0.005
 // clipped those groups against a visible weather-contour wall.
 return vec2<f32>(body*smoothstep(0.0,0.12,w.amount),ell);
}
// Cache the smooth shape, not a voxel-averaged boundary and its exponentiated
// light. Interpolating those products created 128 m bright/dark layers.
// Integrate the analytic envelope at the ray's OWN span after interpolation.
fn cloud_medium(relative:vec3<f32>,height:f32,vertical_span:f32,shape:vec4<f32>,ell:f32)->vec4<f32>{
 let p=f.eye_hi.xyz+(f.eye_lo.xyz+relative);let radial=normalize(p);let thickness=max(100.0,shape.w-shape.z);
 let h=(height-shape.z)/thickness;let half_width=max(0.0001,vertical_span*0.5/thickness);
 var profile=smoothstep(0.0,0.08,h)*(1.0-smoothstep(0.90,1.0,h));
 if half_width>0.001{profile=clamp((cloud_profile_integral(h+half_width)-cloud_profile_integral(h-half_width))/(2.0*half_width),0.0,1.0);}
 // Sunlight depends on the receiver, not on which density cache supplies its
 // shape. Evaluate it once after the cached/direct density transition below.
 return vec4<f32>(cloud_extinction(shape.x,shape.y,ell)*profile,1.0,clamp(h,0.0,1.0),daylight(radial));
}
fn cloud_extinction(density:f32,kind:f32,ell:f32)->f32{
 let sigma=mix(0.00065,0.0011,kind);var extinction=density*sigma;
 // Unresolved structure (ell > 0: the correlation length of the octaves the
 // filter dropped into the coverage term) is a mixture, not a uniform
 // medium. A path crosses cells of length ell that are cloud with
 // probability shape.x and clear otherwise, so the mean transmittance over
 // one cell is 1 - shape.x (1 - exp(-sigma ell)) and the effective
 // extinction is its negative log per cell. The uniform exp(-mean density)
 // understates the mean transmittance of thick cells (Jensen), which made
 // far decks opaque and dark and the coarse shadow maps darker than the
 // puff-resolving ones. Resolved structure (ell = 0) keeps the density.
 if ell>1.0{extinction=-log(max(1.0e-30,1.0-density*(1.0-exp(-sigma*ell))))/ell;}
 return extinction;
}
// The far planet's clouds: a map of the whole of Earth, each texel the column of the same weather and the same cloud body the surface
// pass marches, at the map's own footprint. So what the far planet shows is what the surface pass will show, not a picture of clouds.
// Stored as the vertical opacity, which averages properly down the map's levels; refreshed a few rows at a time, f.lod.w being the first.
@group(0) @binding(123) var cloud_far_map_out:texture_storage_2d<rgba16float,write>;
@compute @workgroup_size(64,1)
fn cloud_far_map(@builtin(global_invocation_id) id:vec3<u32>){
 let size=textureDimensions(cloud_far_map_out);if id.x>=size.x{return;}
 let row=(id.y+u32(f.lod.w))%size.y;let uv=(vec2<f32>(f32(id.x),f32(row))+0.5)/vec2<f32>(size);
 let lon=(uv.x-0.5)*6.28318531;let lat=(0.5-uv.y)*3.14159265;let n=vec3<f32>(cos(lat)*sin(lon),sin(lat),cos(lat)*cos(lon));
 let w=cached_weather(n*f.planet.x);let footprint=6.28318531*f.planet.x/f32(size.x);
 const STEPS=8;let thickness=max(100.0,w.top-w.base);let ds=thickness/f32(STEPS);var depth=0.0;
 for(var i=0;i<STEPS;i++){
  let t=(f32(i)+0.5)/f32(STEPS);let h=w.base+t*thickness;let body=cloud_body(n*(f.planet.x+h),h,footprint,w);
  depth+=cloud_extinction(body.x,w.kind,body.y)*smoothstep(0.0,0.08,t)*(1.0-smoothstep(0.90,1.0,t))*ds;
 }
 textureStore(cloud_far_map_out,vec2<i32>(i32(id.x),i32(row)),vec4<f32>(1.0-exp(-depth),w.kind,0.0,1.0));
}
fn cloud_field(relative:vec3<f32>,footprint:f32,vertical_span:f32)->vec4<f32>{
 let p=f.eye_hi.xyz+(f.eye_lo.xyz+relative);let w=cached_weather(p);let height=sc_radial_height(relative);
 if height+vertical_span*0.5<w.base||height-vertical_span*0.5>w.top{return vec4<f32>(0);}
 let body=cloud_body(p,height,footprint,w);
 return cloud_medium(relative,height,vertical_span,vec4<f32>(body.x,w.kind,w.base,w.top),body.y);
}
fn cloud_axis(n:vec3<f32>)->vec3<f32>{return normalize(cross(select(vec3<f32>(0,0,1),vec3<f32>(0,1,0),abs(n.z)>0.95),n));}
// Chart lattice of the local volume: absolute cell index of a world point on
// the anchored face (cell centres at (index + 0.5) * CLOUD_CACHE_CELL).
fn cloud_cache_cell(world:vec3<f32>,face:u32)->vec2<f32>{let c=sc_face_project(face,world);return c.xy/c.z*f.planet.x/CLOUD_CACHE_CELL-0.5;}
@compute @workgroup_size(1)
fn cloud_cache_begin(){
 // Anchor the lattice on the camera's chart face cell. Lateral motion moves
 // the window by whole cells; its retained voxels stay valid.
 let eye=f.eye_hi.xyz+f.eye_lo.xyz;let face=sun_face(eye);
 let anchor=vec2<i32>(floor(cloud_cache_cell(eye,face)+0.5))-cloud_cache_size()/2;
 cloud_cache.previous=cloud_cache.origin;
 let fresh=cloud_cache.control.x==0u||f.options.y<0.5||f.eye_hi.w>20000.0;
 cloud_cache.origin=vec4<i32>(anchor,i32(face),select(0,1,fresh));
 cloud_cache.control=vec4<u32>(select(1u,0u,f.options.y<0.5||f.eye_hi.w>20000.0),0u,0u,0u);
}
fn cloud_cache_position(absolute:vec2<i32>,slice:i32,face:u32)->vec3<f32>{
 let uv=(vec2<f32>(absolute)+0.5)*CLOUD_CACHE_CELL/f.planet.x;
 return normalize(weather_direction(face,uv))*(f.planet.x+CLOUD_CACHE_BOTTOM+(f32(slice)+0.5)*CLOUD_CACHE_SLICE);
}
@compute @workgroup_size(64,1,1)
fn cloud_local_generate(@builtin(global_invocation_id) id:vec3<u32>){
 if f.options.y<0.5||f.eye_hi.w>20000.0||i32(id.x)>=cloud_cache_size(){return;}
 let origin=cloud_cache.origin;let previous=cloud_cache.previous;let storage=vec3<i32>(id);
 let absolute=origin.xy+((storage.xy-origin.xy)%cloud_cache_size()+cloud_cache_size())%cloud_cache_size();
 let retained=all(absolute>=previous.xy)&&all(absolute<previous.xy+cloud_cache_size())&&previous.z==origin.z&&origin.w==0;
 if retained&&!cloud_refresh(id.y,id.z){return;}
 let p=cloud_cache_position(absolute,storage.z,u32(origin.z));let w=cached_weather(p);
 let height=CLOUD_CACHE_BOTTOM+(f32(storage.z)+0.5)*CLOUD_CACHE_SLICE;var body=0.0;
 if height>w.base-CLOUD_CACHE_SLICE&&height<w.top+CLOUD_CACHE_SLICE{body=cloud_body(p,height,CLOUD_CACHE_CELL,w).x;}
 // Direct sunlight at the voxel from the shared profile maps, stored beside
 // the density so one trilinear fetch serves both; interpolation never mixes
 // their product because the medium multiplies them after filtering.
 let relative=(p-f.eye_hi.xyz)-f.eye_lo.xyz-f.eye_tail.xyz;
 // Optical depth interpolates far better than transmittance: the sun-ray
 // integral is smooth at the lattice scale while its exponential is not.
 let light=sun_cloud_lookup(relative);
 let optical=min(24.0,-log(max(light.transmittance,1.0e-9)));
 textureStore(cloud_local_out,storage,vec4<f32>(body,optical,light.solid,0));
 if storage.z==0{textureStore(cloud_column_out,storage.xy,vec4<f32>(w.kind,w.base-1550.0,w.top-w.base,0));}
}
struct CloudCacheSample {medium:vec4<f32>,light:f32,weight:f32}
struct CloudCacheAddress {uvw:vec3<f32>,weight:f32}
// Lattice address and blend weight of a camera-relative point (no fetch).
fn cloud_cache_address(relative:vec3<f32>,height:f32)->CloudCacheAddress{
 var result=CloudCacheAddress(vec3<f32>(0),0.0);
 if cloud_cache.control.x==0u||(u32(f.cloud_drift.z)&2u)!=0u{return result;}
 let origin=cloud_cache.origin;let world=f.eye_hi.xyz+(f.eye_lo.xyz+relative);
 let projected=sc_face_project(u32(origin.z),world);if projected.z<f.planet.x*0.25{return result;}
 let cell=projected.xy/projected.z*f.planet.x/CLOUD_CACHE_CELL-0.5;
 let centre=vec2<f32>(origin.xy)+f32(cloud_cache_size()/2)-0.5;let edge=max(abs(cell.x-centre.x),abs(cell.y-centre.y));
 let slice=(height-CLOUD_CACHE_BOTTOM)/CLOUD_CACHE_SLICE-0.5;
 let weight=(1.0-smoothstep(f32(cloud_cache_size()/2)-17.0,f32(cloud_cache_size()/2)-5.0,edge))*(1.0-smoothstep(18000.0,20000.0,f.eye_hi.w));
 if weight<=0.0||slice< -0.5||slice>f32(cloud_cache_size())-0.5{return result;}
 let wrapped=cell-f32(cloud_cache_size())*floor(cell/f32(cloud_cache_size()));
 result.uvw=vec3<f32>((wrapped+0.5)/f32(cloud_cache_size()),(clamp(slice,0.0,f32(cloud_cache_size())-1.0)+0.5)/f32(cloud_cache_size()));
 result.weight=weight;
 return result;
}
// Keep height and local-volume coordinates camera-relative. length(world)-R
// quantizes a thin cloud boundary into half-metre horizontal slabs on Earth.
fn cloud_cache_sample(relative:vec3<f32>,height:f32,vertical_span:f32)->CloudCacheSample{
 var result=CloudCacheSample(vec4<f32>(0),1.0,0.0);
 let address=cloud_cache_address(relative,height);if address.weight<=0.0{return result;}
 result.weight=address.weight;
 // A voxel is non-zero only within its own column's layer plus one slice, and
 // a trilinear read reaches one more slice. The union of the four columns the
 // bilinear footprint reads (gathered, not the interpolated average) therefore
 // bounds every contributing voxel: a sample outside it is exactly empty and
 // skips the volume fetch, which is most of the march below or above a deck.
 let bases=textureGather(1,cloud_column,cloud_wrap_sampler,address.uvw.xy)+1550.0;
 let tops=bases+textureGather(2,cloud_column,cloud_wrap_sampler,address.uvw.xy);
 let lowest=min(min(bases.x,bases.y),min(bases.z,bases.w))-2.0*CLOUD_CACHE_SLICE;
 let highest=max(max(tops.x,tops.y),max(tops.z,tops.w))+2.0*CLOUD_CACHE_SLICE;
 if height<lowest||height>highest{result.medium=vec4<f32>(0.0,1.0,0.0,daylight(normalize(f.eye_hi.xyz+(f.eye_lo.xyz+relative))));return result;}
 let packed=textureSampleLevel(cloud_local,cloud_wrap_sampler,address.uvw,0.0);
 let column=textureSampleLevel(cloud_column,cloud_wrap_sampler,address.uvw.xy,0.0);
 result.medium=cloud_medium(relative,height,vertical_span,vec4<f32>(packed.x,column.x,column.y+1550.0,column.y+1550.0+column.z),0.0);
 result.light=exp(-packed.y)*packed.z;
 return result;
}
fn sampled_cloud(relative:vec3<f32>,footprint:f32,vertical_span:f32)->vec4<f32>{
 let height=sc_radial_height(relative);
 let cached=cloud_cache_sample(relative,height,vertical_span);
 var medium=cached.medium;
 if cached.weight<1.0{
  let direct=cloud_field(relative,footprint,vertical_span);
  medium=select(direct,mix(direct,cached.medium,cached.weight),cached.weight>0.0);
 }
 if (u32(f.cloud_drift.z)&4096u)!=0u{let exit=sun_shell_exit(relative);cloud_dbg_cache+=vec4<f32>(cached.weight,sun_cloud_local_address(exit,0u).z,sun_cloud_local_edge(exit,0u),1.0)*medium.x;}
 if medium.x>0.0{
  // Explicit diagnostic: independent sun-ray quadrature isolates profile-map
  // artifacts from view sampling. It omits mountain occlusion, not the planet.
  if (u32(f.cloud_drift.z)&256u)!=0u{medium.y*=sun_reference_cloud(relative)*sun_planet(relative);}
  else if (u32(f.cloud_drift.z)&1u)!=0u{medium.y*=sun_planet(relative);}
  else{
   // Inside the volume the voxel light replaces the per-sample profile lookup;
   // the transition shell blends both so no contour appears at the cache edge.
   var light=cached.light;
   if cached.weight<1.0{let lookup=sun_cloud_lookup(relative);light=mix(lookup.transmittance*lookup.solid,cached.light,cached.weight);}
   medium.y*=light*sun_planet(relative);
  }
 }
 return medium;
}
struct Cloud { color:vec4<f32>,guide:vec4<f32> }
// Trace of the last view march for the bit 2048 diagnostic: bins integrated,
// path integrated, largest bin opacity, shell entry distance.
var<private> cloud_dbg:vec4<f32>;
// Density-weighted local-volume weight, fine sun-profile-map weight and
// fine-map edge coordinate (texels from the map centre) of the samples of
// the last march, with the density sum, for the bit 4096 diagnostic (where
// each crossfade falls along the ray).
var<private> cloud_dbg_cache:vec4<f32>;
// Opaque limit of a cloud texel's ray. Below full resolution the ray passes
// through the corner shared by the full-resolution pixels around the texel
// centre, and the limit of any one of them is the terrain under a ray half a
// pixel away: toward the limb the terrain distance changes by tens of km per
// pixel, so the limit of the pixel to the lower right of every ray on the
// upper-left side of the planet fell short of the ray's own cloud-shell
// entry and the march ended before the clouds, a camera-fixed region of the
// screen without clouds over their shadows. Interpolate the limits of the
// pixels around the ray (bilinear, the pixel itself at full resolution).
// Sky pixels are left out: the terrain pixels keep a terrain limit and the
// composite's validity test sends the sky pixels to their own march.
fn cloud_limit(pixel:vec2<f32>,rd:vec3<f32>)->f32{
 let q=pixel-0.5;let base=vec2<i32>(floor(q));let fr=fract(q);var sum=0.0;var weight=0.0;
 for(var y=0;y<2;y++){for(var x=0;x<2;x++){let w=select(1.0-fr.x,fr.x,x==1)*select(1.0-fr.y,fr.y,y==1);if w<=0.0{continue;}
  let xy=clamp(base+vec2<i32>(x,y),vec2<i32>(0),vec2<i32>(f.view.xy)-1);let limit=limit_distance(xy,rd);if limit>1e10{continue;}sum+=limit*w;weight+=w;}}
 if weight<=0.0{return 1e12;}return sum/weight;
}
// ds is this sample's own longitudinal spacing (the bin for a centre sample,
// the subinterval for a subsample). It also sets the field's filter footprint
// beyond the pixel footprint: detail finer than the sample spacing cannot be
// integrated by these samples, it only aliases into blocky moire on distant
// decks, so the procedural evaluation drops it into its statistical coverage
// term instead. Bands reach the filter at footprint > scale / 4, so bins up to
// 512 m (every near and cached bin) are unaffected.
fn cloud_interval_radiance(rd:vec3<f32>,t:f32,ds:f32,angle:f32,phase:f32)->vec4<f32>{
 let p=f.eye_hi.xyz+(f.eye_lo.xyz+rd*t);let span=abs(dot(normalize(p),rd))*ds+ds*ds/(4.0*f.planet.x);
 let m=sampled_cloud(rd*t,max(max(1.0,t*angle),ds),span);let opacity=1.0-exp(-m.x*ds);
 let ambient=mix(vec3<f32>(0.16,0.21,0.28),vec3<f32>(0.33,0.39,0.47),m.z)*m.w;
 return vec4<f32>((ambient+vec3<f32>(1.8,1.58,1.32)*f.starlight.xyz*m.y*phase)*opacity,1.0-opacity);
}
fn integrate_cloud(rd:vec3<f32>,limit:f32,steps:u32,angle:f32)->Cloud{return integrate_cloud_range(rd,limit,steps,angle,0.0,1e30);}
// Bins whose start lies in [t_from, t_to) are integrated; the bin layout is a
// property of the ray alone, so two ranges partition one march exactly.
fn integrate_cloud_range(rd:vec3<f32>,limit:f32,steps:u32,angle:f32,t_from:f32,t_to:f32)->Cloud {
 // Intersect the OUTER shell, then subtract the inner empty interval. A
 // ray can enter cloud again beyond that gap without hitting the planet.
 // Terrain/water depth, not the cloud base, owns opaque occlusion.
 let outer=sphere(rd,cloud_shell_top());let start=max(0.0,outer.x);let shell_end=outer.y;let end=min(shell_end,limit);
 cloud_dbg=vec4<f32>(0,0,0,start);cloud_dbg_cache=vec4<f32>(0);
 if end<=start||f.options.y<0.5{return Cloud(vec4<f32>(0,0,0,1),vec4<f32>(0,limit,0,0));}
 let inner=sphere(rd,1300.0);let scale=max(2000.0,start*0.5);
 let extent=log(1.0+(shell_end-start)/scale);var gap_start=extent;var gap_end=extent;
 if inner.y>start&&inner.x<shell_end{
  gap_start=log(1.0+(max(start,inner.x)-start)/scale);
  gap_end=log(1.0+(min(shell_end,inner.y)-start)/scale);
 }
 let gap=max(0.0,gap_end-gap_start);let occupied=extent-gap;
 if occupied<=0.0{return Cloud(vec4<f32>(0,0,0,1),vec4<f32>(0,limit,0,0));}
 let count=steps*select(1u,4u,(u32(f.cloud_drift.z)&4u)!=0u);
 var T=1.0;var color=vec3<f32>(0);var first=0.0;let mu=dot(rd,f.sun.xyz);
 let phase=0.24+0.12/pow(max(0.10,1.36-1.2*mu),1.5)+0.08*pow(max(0.0,-mu),2.0);
 // One continuous logarithmic budget over occupied intervals. Only the bin
 // crossing the gap is split: at most count+1 intervals, each with bounded
 // quadrature (up to nine field queries). No separately
 // rounded near/far step counts that would jump at the inner-shell crossing.
 var finished=false;
 for(var i=0u;i<count;i++){
  if T<0.0005||finished{break;}
  let qa=occupied*f32(i)/f32(count);let qb=occupied*f32(i+1u)/f32(count);
  let split=gap>0.0&&qa<gap_start&&qb>gap_start;
  for(var part=0u;part<select(1u,2u,split);part++){
   let after=qa>=gap_start||part==1u;
   let a=select(qa,max(qa,gap_start)+gap,after);
   let b=select(min(qb,gap_start),qb+gap,after);
   let ta=start+scale*(exp(a)-1.0);
   // Bin starts grow monotonically: past the opaque limit or this range's
   // end nothing remains; before the range start the bin belongs elsewhere.
   if ta>=end||ta>=t_to{finished=true;break;}
   if ta<t_from{continue;}
   let tb=min(end,start+scale*(exp(b)-1.0));
   if tb<=ta{continue;}
   let ds=tb-ta;let t=(ta+tb)*0.5;
   var segment=vec4<f32>(0,0,0,exp(-0.00001*ds));
   // The integration interval is longitudinal, not a lateral pixel footprint.
   // Using ds here changed the noise spectrum in distance-aligned sheets, and
   // clipping the final bin at terrain changed coverage along triangle edges.
   if (u32(f.cloud_drift.z)&8u)==0u{
    // Long horizon bins can skip entire puffs even with an averaged envelope.
    // Integrate shape and light at eight subintervals; blend in continuously to
    // avoid a contour where the quadrature changes. Pixel filtering stays
    // lateral and independent of the final opaque-depth truncation. The
    // centre sample (j=0) and the eight subsamples share one call site.
    let blend=smoothstep(128.0,512.0,ds);var coarse=vec4<f32>(0,0,0,1);var fine=vec4<f32>(0,0,0,1);
    // Inside the local volume the field is already band-limited to its
    // voxels, so subsamples at half a voxel suffice; the procedural far field
    // keeps eight to catch kilometre-scale puffs in long bins.
    var subsamples=8u;
    if blend>0.0&&cloud_cache_address(rd*t,sc_radial_height(rd*t)).weight>=1.0{subsamples=clamp(u32(round(ds/(CLOUD_CACHE_CELL*0.5))),1u,8u);}
    let first_sample=select(1u,0u,blend<1.0);let last_sample=select(1u,subsamples+1u,blend>0.0);let spacing=ds/f32(subsamples);
    for(var j=first_sample;j<last_sample;j++){
     let sub=j>0u;
     let s=cloud_interval_radiance(rd,select(t,ta+(f32(j)-0.5)*spacing,sub),select(ds,spacing,sub),angle,phase);
     if sub{fine=vec4<f32>(fine.rgb+fine.a*s.rgb,fine.a*s.a);}else{coarse=s;}
    }
    segment=mix(coarse,fine,blend);
   }
   cloud_dbg.x+=1.0;cloud_dbg.y+=ds;cloud_dbg.z=max(cloud_dbg.z,1.0-segment.a);
   if segment.a>=1.0{continue;}if first==0.0{first=t;}
   color+=T*segment.rgb;T*=segment.a;
  }
 }

 return Cloud(vec4<f32>(color,T),vec4<f32>(first,limit,end,0));
}
@compute @workgroup_size(8,8)
fn cloud_pass(@builtin(global_invocation_id) id:vec3<u32>){let size=textureDimensions(cloud_out);if any(id.xy>=size){return;}let pixel=(vec2<f32>(id.xy)+0.5)*f.view.xy/vec2<f32>(size);let rd=ray(pixel);let limit=cloud_limit(pixel,rd);
 // Explicit diagnostic only: measure the production relative-height helper
 // against a rounded world-height subtraction at identical 32 m ray points.
 if (u32(f.cloud_drift.z)&16u)!=0u{
  let point=rd*32.0;let stable=sc_radial_height(point)-f.eye_hi.w;
  let legacy=length(f.eye_hi.xyz+(f.eye_lo.xyz+point))-f.planet.x-f.eye_hi.w;
  textureStore(cloud_out,vec2<i32>(id.xy),vec4<f32>(stable,legacy,0,1));
  textureStore(cloud_guide_out,vec2<i32>(id.xy),vec4<f32>(0,limit,0,0));return;
 }
 // Qualification only: sweep planet directions with weather amounts on either
 // side of the former early-out cutoff, while retaining the production body.
 if (u32(f.cloud_drift.z)&32u)!=0u{
  let face=min(5u,id.y*6u/size.y);let uv=vec2<f32>((f32(id.x)+0.5)/f32(size.x),fract((f32(id.y)+0.5)*6.0/f32(size.y)))*2.0-1.0;
  let p=normalize(weather_direction(face,uv))*(f.planet.x+3000.0);
  let body=cloud_body(p,3000.0,256.0,Weather(0.005+f.sun.w*0.0001,0.5,1500.0,6500.0,1.0)).x;
  textureStore(cloud_out,vec2<i32>(id.xy),vec4<f32>(body,0,0,1));
  textureStore(cloud_guide_out,vec2<i32>(id.xy),vec4<f32>(0,limit,0,0));return;
 }
 // Metric spherical-advection audit: tangent lengths and angle at all six
 // faces, including long animation epochs. No camera projection in the test.
 if (u32(f.cloud_drift.z)&64u)!=0u{
  let face=min(5u,id.y*6u/size.y);let uv=vec2<f32>((f32(id.x)+0.5)/f32(size.x),fract((f32(id.y)+0.5)*6.0/f32(size.y)))*2.0-1.0;
  let n=normalize(weather_direction(face,uv));let p=n*(f.planet.x+3000.0);let u=cloud_axis(n);let v=cross(n,u);let q=cloud_advect(p,0.5);
  let a=(cloud_advect(p+u*512.0,0.5)-q)/512.0;let b=(cloud_advect(p+v*512.0,0.5)-q)/512.0;
  textureStore(cloud_out,vec2<i32>(id.xy),vec4<f32>(length(a),length(b),dot(a,b),length(cross(a,b))));
  textureStore(cloud_guide_out,vec2<i32>(id.xy),vec4<f32>(0,limit,0,0));return;
 }
 // Probe both sides of the actual local-cache boundary, with a fixed metric
 // pixel footprint. Red/green are the production densities 1m apart.
 if (u32(f.cloud_drift.z)&128u)!=0u{
  let n=normalize(f.eye_hi.xyz+f.eye_lo.xyz);let u=cloud_axis(n);let v=cross(n,u);
  let side=select(-1.0,1.0,id.x>=size.x/2u);let along=((f32(id.x%max(1u,size.x/2u))+0.5)/f32(size.x/2u)*2.0-1.0)*15000.0;
  let z=1300.0+(f32(id.y)+0.5)/f32(size.y)*(cloud_shell_top()-1300.0);
  let base=-n*f.eye_hi.w+v*along+n*z;let a=sampled_cloud(base+u*(side*15000.0-0.5),256.0,1.0).x;let b=sampled_cloud(base+u*(side*15000.0+0.5),256.0,1.0).x;
  textureStore(cloud_out,vec2<i32>(id.xy),vec4<f32>(a*1000.0,b*1000.0,0,1));
  textureStore(cloud_guide_out,vec2<i32>(id.xy),vec4<f32>(0,limit,0,0));return;
 }
 let split=select(1e30,f.cloud_far.y,f.cloud_far.x>=2.0&&f.eye_hi.w<20000.0);
 var far=vec4<f32>(0,0,0,1);var far_first=0.0;var near_end=split;
 if limit>split{
  let fsize=textureDimensions(cloud_far);let q=(vec2<f32>(id.xy)+0.5)/vec2<f32>(size)*vec2<f32>(fsize)-0.5;let base=vec2<i32>(floor(q));let frac=fract(q);var sum=vec4<f32>(0);var weight=0.0;var nearest=1e30;
  for(var y=0;y<2;y++){for(var x=0;x<2;x++){let coord=clamp(base+vec2<i32>(x,y),vec2<i32>(0),vec2<i32>(fsize)-1);let g=textureLoad(cloud_far_guide,coord,0);let w=select(1.0-frac.x,frac.x,x==1)*select(1.0-frac.y,frac.y,y==1);let valid=abs(g.y-limit)<max(100.0,limit*0.05)||g.x<min(limit,g.y);if valid&&w>0.0{sum+=textureLoad(cloud_far,coord,0)*w;weight+=w;if g.x>0.0{nearest=min(nearest,g.x);}}}}
  if weight>0.001{far=sum/weight;if nearest<1e29{far_first=nearest;}}else{near_end=1e30;}
 }
 var c=integrate_cloud_range(rd,limit,u32(f.lod.z),2.0*f.view.w/f32(size.y),0.0,near_end);
 // Explicit diagnostic (bit 2048): the march trace instead of the colour,
 // bins integrated, path integrated, opaque limit minus shell entry, T.
 if (u32(f.cloud_drift.z)&2048u)!=0u{textureStore(cloud_out,vec2<i32>(id.xy),vec4<f32>(cloud_dbg.xy,limit-cloud_dbg.w,c.color.a));textureStore(cloud_guide_out,vec2<i32>(id.xy),c.guide);return;}
 // Explicit diagnostic (bit 4096): the density-weighted local-volume weight,
 // fine sun-profile-map weight and fine-map edge coordinate of the near
 // march, and its opacity.
 if (u32(f.cloud_drift.z)&4096u)!=0u{let total=max(1.0e-6,cloud_dbg_cache.w);textureStore(cloud_out,vec2<i32>(id.xy),vec4<f32>(cloud_dbg_cache.xyz/total,1.0-c.color.a));textureStore(cloud_guide_out,vec2<i32>(id.xy),c.guide);return;}
 c.color=vec4<f32>(c.color.rgb+c.color.a*far.rgb,c.color.a*far.a);
 if c.guide.x==0.0{c.guide.x=far_first;}
 if f.wind.w>0.5&&c.guide.x>0.0&&f.wind.z>0.0&&f.wind.z<0.1 {
  let p=(f.eye_hi.xyz-f.prev_hi.xyz)+(f.eye_lo.xyz-f.prev_lo.xyz)+rd*c.guide.x-vec3<f32>(f.wind.x,0.0,f.wind.y)*f.wind.z;
  let z=dot(p,f.prev_forward.xyz);let uv=vec2<f32>(dot(p,f.prev_right.xyz)/(z*f.view.z*f.view.w),-dot(p,f.prev_up.xyz)/(z*f.view.w))*0.5+0.5;
  if z>0.0&&all(uv>vec2<f32>(0))&&all(uv<vec2<f32>(1)){let coord=vec2<i32>(uv*vec2<f32>(size));let oldg=textureLoad(history_guide,coord,0);let old=textureLoad(history,coord,0);
   if abs(oldg.x-length(p))<max(100.0,c.guide.x*0.02)&&abs(old.a-c.color.a)<0.12&&((oldg.y>1e10)==(limit>1e10)){c.color=mix(c.color,clamp(old,c.color-vec4<f32>(0.1),c.color+vec4<f32>(0.1)),0.65);}
  }
 }
 textureStore(cloud_out,vec2<i32>(id.xy),c.color);textureStore(cloud_guide_out,vec2<i32>(id.xy),c.guide);
}
@compute @workgroup_size(8,8)
fn cloud_far_pass(@builtin(global_invocation_id) id:vec3<u32>){
 let size=textureDimensions(cloud_far_out);if any(id.xy>=size)||f.cloud_far.x<2.0||f.eye_hi.w>=20000.0{return;}
 let near_size=vec2<f32>(f.cloud_far.zw);let pixel=(vec2<f32>(id.xy)+0.5)*f.view.xy/vec2<f32>(size);let rd=ray(pixel);
 // The far texel serves the most distant limit among the cloud pixels it
 // covers, so sky stays exact; nearer opaque pixels fail the validity test
 // and march their own far segment in the near pass.
 let block=i32(f.cloud_far.x);var limit=0.0;
 for(var y=0;y<block;y++){for(var x=0;x<block;x++){
  let cloud_pixel=(vec2<f32>(vec2<i32>(id.xy)*block+vec2<i32>(x,y))+0.5)*f.view.xy/near_size;
  let xy=clamp(vec2<i32>(cloud_pixel),vec2<i32>(0),vec2<i32>(f.view.xy)-1);
  limit=max(limit,limit_distance(xy,rd));
 }}
 let split=f.cloud_far.y;
 if (u32(f.cloud_drift.z)&240u)!=0u||limit<=split{textureStore(cloud_far_out,vec2<i32>(id.xy),vec4<f32>(0,0,0,1));textureStore(cloud_far_guide_out,vec2<i32>(id.xy),vec4<f32>(0,limit,0,0));return;}
 let c=integrate_cloud_range(rd,limit,u32(f.lod.z),2.0*f.view.w/near_size.y,split,1e30);
 textureStore(cloud_far_out,vec2<i32>(id.xy),c.color);textureStore(cloud_far_guide_out,vec2<i32>(id.xy),c.guide);
}
