// Seamless 3D weather: advected, sheared fronts and evolving curl warps.
// A world-anchored cube atlas makes weather independent of ray length or camera.
struct Weather { amount:f32,kind:f32,base:f32,top:f32,warp:f32 }
// Weather base <= 1780m and cumulus thickness <= 10000m. Keep the ray/shadow
// shell outside that envelope.
fn cloud_shell_top()->f32{return f.cloud_shell.x;}
@group(0) @binding(45) var weather_out:texture_storage_2d<rgba16float,write>;
@group(0) @binding(46) var weather_map:texture_2d<f32>;
@group(0) @binding(48) var cloud_shape_out:texture_storage_3d<rgba16float,write>;
@group(0) @binding(49) var cloud_shape:texture_3d<f32>;
@group(0) @binding(50) var cloud_sampler:sampler;
@group(0) @binding(87) var cloud_repeat:sampler;

// One periodic volume per device. RGB carries three independent smooth noise
// fields; alpha is the distance to the nearest jittered cell centre (Worley).
// Wrap the lattice IDs, never the distances, including across the tile seam.
fn cloud_cell_random(cell:vec3<i32>)->vec3<f32>{
 let c=vec3<u32>(cell)&vec3<u32>(7u);
 let bits=hash(c.x+8u*c.y+64u*c.z+211u);
 return vec3<f32>(vec3<u32>(bits,bits>>10u,bits>>20u)&vec3<u32>(1023u))/1023.0;
}
@compute @workgroup_size(4,4,4)
fn cloud_shape_generate(@builtin(global_invocation_id) id:vec3<u32>){
 let size=textureDimensions(cloud_shape_out);
 if any(id>=size){return;}
 let p=(vec3<f32>(id)+0.5)*8.0/vec3<f32>(size);
 let cell=vec3<i32>(floor(p));let fcell=fract(p);
 let u=fcell*fcell*fcell*(fcell*(fcell*6.0-15.0)+10.0);
 var value=vec3<f32>(0);var nearest=4.0;
 for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
  let offset=vec3<i32>(x,y,z);let random=cloud_cell_random(cell+offset);
  let delta=vec3<f32>(offset)+0.1+0.8*random-fcell;
  nearest=min(nearest,dot(delta,delta));
  if all(offset>=vec3<i32>(0)){
   let weights=select(1.0-u,u,offset==vec3<i32>(1));
   value+=random*weights.x*weights.y*weights.z;
  }
 }}}
 textureStore(cloud_shape_out,id,vec4<f32>(value,1.0-smoothstep(0.06,1.1,sqrt(nearest))));
}
fn cloud_octave(p:vec3<f32>,cell_metres:f32)->vec4<f32>{
 return textureSampleLevel(cloud_shape,cloud_repeat,p/(8.0*cell_metres),0.0)*2.0-1.0;
}
// A translation on the periodic texture preserves metre-scale detail even
// after long epochs. Radial offsets proportional to time stretched the
// density gradient with latitude and produced seams during fast flight.
fn cloud_evolving_octave(p:vec3<f32>,scale:f32,velocity:vec3<f32>)->vec4<f32>{
 let period=8.0*scale;
 let phase=fract(velocity*(f.cloud_motion.y/period));
 return textureSampleLevel(cloud_shape,cloud_repeat,p/period+phase,0.0)*2.0-1.0;
}
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
// Each dispatched group updates one tile. Offset each column's refresh
// phase so an advancing weather front never acquires frame-wide stripes.
@compute @workgroup_size(8,8)
fn weather_generate(@builtin(workgroup_id) group:vec3<u32>,@builtin(local_invocation_id) lane:vec3<u32>){
 let face_size=f.tier_c.x;let padded=face_size+2u;
 let divisor=select(max(1u,f.cloud_cache.y),1u,f.cloud_cache.z!=0u);
 let phase=(hash(group.x+4099u*group.y)%divisor+f.cloud_cache.x%divisor)%divisor;
 let xy=vec2<u32>(group.x,group.y*divisor+phase)*8u+lane.xy;
 if xy.x>=padded||xy.y>=6u*padded||f.options.y<0.5{return;}
 let face=xy.y/padded;let uv=(vec2<f32>(vec2<u32>(xy.x,xy.y%padded))-0.5)/f32(face_size)*2.0-1.0;
 let w=cloud_weather(normalize(weather_direction(face,uv))*f.planet.x);
 textureStore(weather_out,xy,vec4<f32>(w.amount,w.kind,w.base-1550.0,w.warp));
}
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
// that unresolved structure (an estimated chord of each dropped octave,
// amplitude weighted; zero when everything is resolved), which the medium
// needs to turn the probability into a mean transmittance. zw bound the local
// cloud column inside the regional weather envelope, in metres.
fn cloud_body(p:vec3<f32>,h:f32,footprint:f32,w:Weather)->vec4<f32>{
 if w.amount<=0.0{return vec4<f32>(0,0,w.base,w.top);}
 let radial=normalize(p);let thickness=max(100.0,w.top-w.base);
 let height=clamp((h-w.base)/thickness,0.0,1.0);
 let advected=cloud_advect(p,height);
 // Orthogonal rotation keeps metres isotropic. A seed translation and the
 // evolving regional warp break up repetition between weather systems.
 let seed=hash(bitcast<u32>(f.geo.z));
 let offset=vec3<f32>(vec3<u32>(seed,seed>>10u,seed>>20u)&vec3<u32>(1023u))*1024.0;
 let rotated=advected-(2.0/3.0)*(advected.x+advected.y+advected.z)+offset;
 let up=radial-(2.0/3.0)*(radial.x+radial.y+radial.z);
 // A hardware filter has a finite number of subtexel positions. At the
 // 131 km scale its interpolation steps would be tens of metres apart;
 // magnifying those steps as domain offsets imprinted stripes on small puffs.
 let system=cloud_evolving_octave(rotated,131072.0,vec3<f32>(3,-2,1)).x;
 let phase=rotated/131072.0+6.2831853*fract(f.cloud_motion.y*vec3<f32>(0.000013,0.000009,-0.000011));
 let flow=sin(phase.yzx+phase.zxy)*cos(phase.zxy-phase);
 let warped=rotated+cross(flow,up)*(12000.0*f.cloud_motion.z*w.warp);
 let cluster=cloud_octave(warped.yzx,32768.0).y*filter_weight(65536.0,footprint);
 // Dense cumulus would otherwise remain solid at height=1, sliced off by
 // the weather ceiling. Erode the upper mass to isolated rounded summits
 // before the envelope closes. The expanded layer leaves room for tall caps;
 // increasing the ray shell alone would still leave a flat weather ceiling.
 let vertical=mix(pow(height,4.0)*0.18,pow(height,1.5)*0.45+1.2*smoothstep(0.42,0.96,height),w.kind);
 let mass=w.amount*0.62+system*0.80+cluster*0.52-0.40-vertical;
 let large_amplitude=mix(0.12,0.25,w.kind);let small_amplitude=mix(0.16,0.48,w.kind);
 let large_weight=filter_weight(32768.0,footprint);let small_weight=filter_weight(8192.0,footprint);
 // Unresolved variation widens the coverage distribution instead of turning
 // the mean of a broken cloud group into a solid blurred slab.
 let puff_amplitude=mix(0.085,0.22,w.kind);let puff_weight=filter_weight(2048.0,footprint);
 let unresolved=large_amplitude*(1.0-large_weight)+small_amplitude*(1.0-small_weight)+puff_amplitude*(1.0-puff_weight);
 let width=0.125+unresolved*0.6;let residual=large_amplitude*large_weight+small_amplitude*small_weight+puff_amplitude*puff_weight;
 // The cellular cumulus lobes have shorter contiguous chords than smooth
 // stratus. Estimate one baked voxel (one sixth of a cell) for those lobes.
 let chord=mix(0.25,1.0/6.0,w.kind);
 let ell=chord*(puff_amplitude*(1.0-puff_weight)*1024.0+small_amplitude*(1.0-small_weight)*4096.0+large_amplitude*(1.0-large_weight)*16384.0)/max(0.000001,puff_amplitude+small_amplitude+large_amplitude);
 // Shape samples stay in [-1,1]; these early exits enclose all omitted
 // detail, including every evolution epoch. No occupied density is skipped.
 if mass+residual<=-width{return vec4<f32>(0.0,ell,w.base,w.top);}
 let small=cloud_evolving_octave(warped.zxy,4096.0,vec3<f32>(-3,7,8));
 // Even the interior of a filled bank has rolling tops and a ragged base.
 // Fade unresolved relief to its mean so distant decks keep a stable depth.
 let top=w.top-thickness*(0.24-0.22*small.w*small_weight);
 let base=w.base+thickness*0.04*(1.0+small.x*small_weight);
 var body=1.0;
 if mass-residual<width{
  let large=cloud_evolving_octave(warped,16384.0,vec3<f32>(5,4,-3));
  var puff=0.0;
  if puff_weight>0.0{
   puff=cloud_evolving_octave(warped,1024.0,vec3<f32>(8,-5,9)).w;
   let erosion=filter_weight(512.0,footprint);
   if erosion>0.0{puff=mix(puff,cloud_evolving_octave(warped.zxy,256.0,vec3<f32>(-8,10,4)).w,0.28*erosion);}
  }
  body=smoothstep(-width,width,mass+mix(large.z,large.w,w.kind)*large_amplitude*large_weight+mix(small.y,small.w,w.kind)*small_amplitude*small_weight+puff*puff_amplitude*puff_weight);
 }
 // Regional weather is a continuous envelope, not a binary mask. Small
 // amounts can still contain dense mesoscale groups; skipping them at 0.005
 // clipped those groups against a visible weather-contour wall.
 return vec4<f32>(body*smoothstep(0.0,0.12,w.amount),ell,base,top);
}
// Average the vertical envelope over the length covered by this sample.
fn cloud_profile(height:f32,span:f32,bounds:vec2<f32>)->vec2<f32>{
 let thickness=max(1.0,bounds.y-bounds.x);
 let h=(height-bounds.x)/thickness;let half_width=0.5*span/thickness;
 var profile=smoothstep(0.0,0.08,h)*(1.0-smoothstep(0.90,1.0,h));
 if half_width>0.001{profile=clamp((cloud_profile_integral(h+half_width)-cloud_profile_integral(h-half_width))/(2.0*half_width),0.0,1.0);}
 return vec2<f32>(profile,clamp(h,0.0,1.0));
}
fn cloud_extinction(density:f32,kind:f32,ell:f32,profile:f32)->f32{
 let sigma=mix(0.00125,0.0011,kind)*profile;var extinction=density*sigma;
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
 // One weather evaluation per orbital column, shared by all its layers.
 // The active surface can belong to a different body and owns its atlas.
 var w=cloud_weather(n*f.planet.x);w.amount=smoothstep(-0.08,0.45,w.amount);
 let footprint=6.28318531*f.planet.x/f32(size.x);
 const STEPS=8;let thickness=max(100.0,w.top-w.base);let ds=thickness/f32(STEPS);var depth=0.0;
 for(var i=0;i<STEPS;i++){
  let t=(f32(i)+0.5)/f32(STEPS);let h=w.base+t*thickness;let body=cloud_body(n*(f.planet.x+h),h,footprint,w);
  depth+=cloud_extinction(body.x,w.kind,body.y,cloud_profile(h,ds,body.zw).x)*ds;
 }
 textureStore(cloud_far_map_out,vec2<i32>(i32(id.x),i32(row)),vec4<f32>(1.0-exp(-depth),w.kind,0.0,1.0));
}
fn cloud_field(relative:vec3<f32>,footprint:f32,vertical_span:f32)->vec4<f32>{
 let p=f.eye_hi.xyz+(f.eye_lo.xyz+relative);let w=cached_weather(p);let height=sc_radial_height(relative);
 if height+vertical_span*0.5<w.base||height-vertical_span*0.5>w.top{return vec4<f32>(0);}
 let body=cloud_body(p,height,footprint,w);
 let profile=cloud_profile(height,vertical_span,body.zw);
 return vec4<f32>(cloud_extinction(body.x,w.kind,body.y,profile.x),1.0,profile.y,daylight(normalize(p)));
}
fn cloud_axis(n:vec3<f32>)->vec3<f32>{return normalize(cross(select(vec3<f32>(0,0,1),vec3<f32>(0,1,0),abs(n.z)>0.95),n));}
fn sampled_cloud(relative:vec3<f32>,footprint:f32,vertical_span:f32)->vec4<f32>{
 var medium=cloud_field(relative,footprint,vertical_span);
 if medium.x<=0.0{return medium;}
 if (u32(f.cloud_drift.z)&4096u)!=0u{
  let exit=sun_shell_exit(relative);
  cloud_dbg_cache+=vec4<f32>(0.0,sun_cloud_local_address(exit,0u).z,sun_cloud_local_edge(exit,0u),1.0)*medium.x;
 }
 if (u32(f.cloud_drift.z)&256u)!=0u{medium.y=sun_planet(relative)*sun_reference_cloud(relative);}
 else if (u32(f.cloud_drift.z)&1u)!=0u||sf.control.x<0.5{medium.y=sun_planet(relative);}
 else{let light=sun_cloud_lookup(relative);medium.y=light.transmittance*light.solid;}
 return medium;
}
struct Cloud { color:vec4<f32>,guide:vec4<f32> }
// Trace of the last view march for the bit 2048 diagnostic: bins integrated,
// path integrated, largest bin opacity, shell entry distance.
var<private> cloud_dbg:vec4<f32>;
// Reserved, density-weighted fine sun-profile-map weight and
// fine-map edge coordinate (texels from the map centre) of the samples of
// the last march, with the density sum, for the bit 4096 diagnostic (where
// each crossfade falls along the ray).
var<private> cloud_dbg_cache:vec4<f32>;
// A clipped or empty background ray cannot certify cloud behind a closer
// foreground edge. Reuse differing depths only when both clear the shell.
fn cloud_guide_matches(guide:vec4<f32>,limit:f32)->bool{
 return abs(guide.y-limit)<max(100.0,limit*0.05)||(guide.z>0.0&&guide.z<=min(limit,guide.y));
}
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
 let q=pixel-0.5;let base=vec2<i32>(floor(q));let fr=fract(q);
 var distance=0.0;var height=0.0;var weight=0.0;
 // At the limb a subpixel difference in direction can move the ocean hit
 // by kilometres. Interpolate surface height, then intersect the volume's
 // own ray with that surface. This also handles pixels across the sky edge.
 let anchor=f.temporal.z>0.0&&abs(dot(rd,normalize(f.eye_hi.xyz+f.eye_lo.xyz)))<.4;
 for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let w=select(1.0-fr.x,fr.x,x==1)*select(1.0-fr.y,fr.y,y==1);if w<=0.0{continue;}
  let xy=clamp(base+vec2<i32>(x,y),vec2<i32>(0),vec2<i32>(f.view.xy)-1);
  let d=visible_limit(xy,textureLoad(water_in,xy,0).a);if d>1e10{continue;}
  if anchor{height+=w*sc_radial_height(ray(vec2<f32>(xy)+.5)*d);}
  distance+=d*w;weight+=w;
 }}
 if weight<=0.0{return 1e12;}
 distance/=weight;
 if anchor&&distance>2000.0{
  let hit=sphere(rd,height/weight);
  if hit.x>0.0{return hit.x;}if hit.y>0.0{return hit.y;}return 1e12;
 }
 return distance;
}
// The bin's footprint filters unresolved detail and its vertical envelope.
// Its integration weight ds determines the Beer-Lambert opacity.
fn cloud_interval_radiance(rd:vec3<f32>,t:f32,ds:f32,angle:f32,phase:f32,spacing:f32)->vec4<f32>{
 let p=f.eye_hi.xyz+(f.eye_lo.xyz+rd*t);let incidence=abs(dot(normalize(p),rd));
 // At a grazing angle the *width* of the pixel cuts across the cloud top.
 // Averaging only along the ray leaves a subpixel vertical step hundreds of
 // km away. Both resolutions use the same smoothly widening physical filter.
 let angular_width=angle*mix(1.0,f.cloud_far.x,smoothstep(.65*f.cloud_far.y,1.5*f.cloud_far.y,t));
 let pixel=t*angular_width;
 let span=length(vec2<f32>(incidence*spacing,pixel*sqrt(max(0.0,1.0-incidence*incidence))))+spacing*spacing/(4.0*f.planet.x);
 let m=sampled_cloud(rd*t,max(max(1.0,pixel),spacing),span);
 if m.x<=0.0{return vec4<f32>(0,0,0,1);}
 let opacity=1.0-exp(-m.x*ds);
 // Light scattered into shadowed cloud is cooler; the sun-facing skin
 // retains the warm directional lobe. Daylight gates the diffuse fill.
 let ambient=mix(vec3<f32>(0.14,0.19,0.28),vec3<f32>(0.38,0.45,0.55),m.z)*m.w;
 let diffuse=vec3<f32>(0.17,0.16,0.14)*sqrt(m.y)*m.w*f.starlight.xyz;
 return vec4<f32>((ambient+diffuse+vec3<f32>(1.8,1.58,1.32)*f.starlight.xyz*m.y*phase)*opacity,1.0-opacity);
}
fn integrate_cloud(rd:vec3<f32>,limit:f32,steps:u32,angle:f32)->Cloud{return integrate_cloud_range(rd,limit,steps,angle,0.0,1e30);}
// Both passes use the same bins and clip them at the same metric distance.
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
 var T=1.0;var color=vec3<f32>(0);var first=0.0;var depthMoment=0.0;let mu=dot(rd,f.sun.xyz);
 let phase=0.24+0.12/pow(max(0.10,1.36-1.2*mu),1.5)+0.08*pow(max(0.0,-mu),2.0);
 // One continuous logarithmic budget over occupied intervals. Only the bin
 // crossing the gap is split: at most count+1 intervals, each with bounded
 // quadrature (up to two field queries). No separately
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
   // Split the bin itself. Assigning a whole bin by its start can leave a
   // gap or overlap when the far result is reconstructed from adjacent rays.
   let ta=start+scale*(exp(a)-1.0);
   if ta>=end||ta>=t_to{finished=true;break;}
   let tb=min(end,start+scale*(exp(b)-1.0));
   let covered=min(t_to,tb)-max(t_from,ta);if covered<=0.0{continue;}
   let ds=tb-ta;let t=(ta+tb)*0.5;
   var segment=vec4<f32>(0,0,0,exp(-0.00001*covered));
   // The integration interval is longitudinal, not a lateral pixel footprint.
   // Using ds here changed the noise spectrum in distance-aligned sheets, and
   // clipping the final bin at terrain changed coverage along triangle edges.
   if (u32(f.cloud_drift.z)&8u)==0u{
    // Two-point Gauss quadrature for long bins. Both abscissae move
    // continuously out from the midpoint, so crossing the refinement
    // threshold never changes the sampled field abruptly.
    let spread=smoothstep(192.0,768.0,ds);
    let half_bins=select(1u,2u,spread>0.0);
    var integrated=vec4<f32>(0,0,0,1);
    for(var j=0u;j<half_bins;j++){
     let sample_t=t+(f32(j)*2.0-1.0)*0.28867513*ds*spread;
     // A resolution split divides optical length only. Moving or filtering
     // the sample itself at that boundary changed the cloud on either side.
     let bin_width=ds/f32(half_bins);let bin_start=ta+f32(j)*bin_width;
     let width=min(t_to,bin_start+bin_width)-max(t_from,bin_start);if width<=0.0{continue;}
     let filtered_span=ds*(1.0-0.5*spread);
     let s=cloud_interval_radiance(rd,sample_t,width,angle,phase,filtered_span);
     integrated=vec4<f32>(integrated.rgb+integrated.a*s.rgb,integrated.a*s.a);
    }
    segment=integrated;
   }
   cloud_dbg.x+=1.0;cloud_dbg.y+=covered;cloud_dbg.z=max(cloud_dbg.z,1.0-segment.a);
   if segment.a>=1.0{continue;}if first==0.0{first=t;}
   depthMoment+=T*(1.0-segment.a)*t;
   color+=T*segment.rgb;T*=segment.a;
  }
 }

 return Cloud(vec4<f32>(color,T),vec4<f32>(first,limit,shell_end,depthMoment));
}
// Push the lower-resolution segment away continuously on ascent. Diagnostics
// trace the complete main ray so coverage and distance counters stay comparable.
fn cloud_split_distance()->f32{
 if f.cloud_far.x<2.0||(u32(f.cloud_drift.z)&(2048u|4096u))!=0u{return 1e30;}
 return f.cloud_far.y+max(0.0,f.eye_hi.w-15000.0)*32.0;
}
@compute @workgroup_size(8,8)
fn cloud_pass(@builtin(global_invocation_id) id:vec3<u32>){let size=textureDimensions(cloud_out);if any(id.xy>=size){return;}let pixel=(vec2<f32>(id.xy)+0.5)*f.view.xy/vec2<f32>(size);// March a fixed pixel lattice. Jittering the entire low-rate volume changes
 // all its reconstructed pixels together, particularly on a grazing ray.
 let rd=view_ray(pixel);let limit=cloud_limit(pixel-f.temporal.xy,rd);
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
 // Probe both sides of the former local-cache boundary, with a fixed metric
 // pixel footprint. Red/green are the production densities 1m apart.
 if (u32(f.cloud_drift.z)&128u)!=0u{
  let n=normalize(f.eye_hi.xyz+f.eye_lo.xyz);let u=cloud_axis(n);let v=cross(n,u);
  let side=select(-1.0,1.0,id.x>=size.x/2u);let along=((f32(id.x%max(1u,size.x/2u))+0.5)/f32(size.x/2u)*2.0-1.0)*15000.0;
  let z=1300.0+(f32(id.y)+0.5)/f32(size.y)*(cloud_shell_top()-1300.0);
  let base=-n*f.eye_hi.w+v*along+n*z;let a=sampled_cloud(base+u*(side*15000.0-0.5),256.0,1.0).x;let b=sampled_cloud(base+u*(side*15000.0+0.5),256.0,1.0).x;
  textureStore(cloud_out,vec2<i32>(id.xy),vec4<f32>(a*1000.0,b*1000.0,0,1));
  textureStore(cloud_guide_out,vec2<i32>(id.xy),vec4<f32>(0,limit,0,0));return;
 }
 let split=cloud_split_distance();
 var far=vec4<f32>(0,0,0,1);var far_first=0.0;var farMoment=0.0;var near_end=split;
 if limit>split&&sphere(rd,cloud_shell_top()).y>split{
  let fsize=textureDimensions(cloud_far);let q=(vec2<f32>(id.xy)+0.5)/vec2<f32>(size)*vec2<f32>(fsize)-0.5;let base=vec2<i32>(floor(q));let frac=fract(q);var sum=vec4<f32>(0);var weight=0.0;var nearest=1e30;
  for(var y=0;y<2;y++){for(var x=0;x<2;x++){let coord=clamp(base+vec2<i32>(x,y),vec2<i32>(0),vec2<i32>(fsize)-1);let g=textureLoad(cloud_far_guide,coord,0);let w=select(1.0-frac.x,frac.x,x==1)*select(1.0-frac.y,frac.y,y==1);if cloud_guide_matches(g,limit)&&w>0.0{sum+=textureLoad(cloud_far,coord,0)*w;weight+=w;farMoment+=w*g.w;if g.x>0.0{nearest=min(nearest,g.x);}}}}
  if weight>0.0001{
   far=sum;if nearest<1e29{far_first=nearest;}
   if weight<.9999{
    let exact=integrate_cloud_range(rd,limit,u32(f.lod.z),2.0*f.view.w/f32(size.y),split,1e30);
    far+=(1.0-weight)*exact.color;farMoment+=(1.0-weight)*exact.guide.w;if far_first==0.0{far_first=exact.guide.x;}
   }
  }else{near_end=1e30;}
 }
 var c=integrate_cloud_range(rd,limit,u32(f.lod.z),2.0*f.view.w/f32(size.y),0.0,near_end);
 // Explicit diagnostic (bit 2048): the march trace instead of the colour,
 // bins integrated, path integrated, opaque limit minus shell entry, T.
 if (u32(f.cloud_drift.z)&2048u)!=0u{textureStore(cloud_out,vec2<i32>(id.xy),vec4<f32>(cloud_dbg.xy,limit-cloud_dbg.w,c.color.a));textureStore(cloud_guide_out,vec2<i32>(id.xy),c.guide);return;}
 // Explicit diagnostic (bit 4096): reserved zero, density-weighted
 // fine sun-profile-map weight and fine-map edge coordinate of the near
 // march, and its opacity.
 if (u32(f.cloud_drift.z)&4096u)!=0u{let total=max(1.0e-6,cloud_dbg_cache.w);textureStore(cloud_out,vec2<i32>(id.xy),vec4<f32>(cloud_dbg_cache.xyz/total,1.0-c.color.a));textureStore(cloud_guide_out,vec2<i32>(id.xy),c.guide);return;}
 c.guide.w+=c.color.a*farMoment;
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
 let size=textureDimensions(cloud_far_out);if any(id.xy>=size)||f.cloud_far.x<2.0{return;}
 let near_size=vec2<f32>(f.cloud_far.zw);let pixel=(vec2<f32>(id.xy)+0.5)*f.view.xy/vec2<f32>(size);let rd=view_ray(pixel);
 // Locate the fixed far ray in the jittered depth buffer just as for the
 // near ray. Picking the farthest corner made one foreground/sky change
 // redirect the full block to a different march on alternating frames.
 // The near pass traces the missing share at depth discontinuities.
 let limit=cloud_limit(pixel-f.temporal.xy,rd);
 let split=cloud_split_distance();
 if (u32(f.cloud_drift.z)&240u)!=0u||limit<=split||sphere(rd,cloud_shell_top()).y<=split{textureStore(cloud_far_out,vec2<i32>(id.xy),vec4<f32>(0,0,0,1));textureStore(cloud_far_guide_out,vec2<i32>(id.xy),vec4<f32>(0,limit,0,0));return;}
 let c=integrate_cloud_range(rd,limit,u32(f.lod.z),2.0*f.view.w/near_size.y,split,1e30);
 textureStore(cloud_far_out,vec2<i32>(id.xy),c.color);textureStore(cloud_far_guide_out,vec2<i32>(id.xy),c.guide);
}
