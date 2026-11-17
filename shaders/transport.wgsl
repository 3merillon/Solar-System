// Shared spatial fields; specialized surface and single-scattering transport.
// Finite quadrature and a diffuse multiple-scattering fill are approximations.
var<private> shading_calls:array<u32,8>;
const PI:f32=3.141592653589793;
fn sky(d:vec3<f32>)->vec3<f32>{
 if planet_scene(){return pow(max(dot(d,frame.sun.xyz),0.0),1800.0)*frame.sun.w*vec3<f32>(1.0,0.95,0.9);}
 let up=select(vec3<f32>(0,1,0),frame.radial.xyz,planet_scene());
 let h=max(dot(d,up),0.0);let sun=pow(max(dot(d,frame.sun.xyz),0.0),1800.0);
 return mix(vec3<f32>(0.23,0.34,0.49),vec3<f32>(0.025,0.07,0.16),sqrt(h))*select(1.0,0.015,planet_scene()&&frame.radial.w>90000.0)+sun*frame.sun.w*vec3<f32>(1.0,0.85,0.62);
}
fn surface_normal(q:vec3<f32>,foot:f32)->vec3<f32>{
 return surface_frame(q,foot).xyz;
}
fn surface_frame(q:vec3<f32>,foot:f32)->vec4<f32>{
 if DIAGNOSTICS {shading_calls[0]+=1u;}
 if planet_scene()&&NORMAL_FILTER>0u{return analytic_normal(q,foot);}
 return vec4<f32>(reference_normal(q,foot),0);
}
fn reference_normal(q:vec3<f32>,foot:f32)->vec3<f32>{
 let e=max(select(0.0008,0.003,planet_scene()),foot*0.75);
 let x=vec3<f32>(e,-e,-e);let y=vec3<f32>(-e,-e,e);let z=vec3<f32>(-e,e,-e);let w=vec3<f32>(e,e,e);
 let gradient=x*scene_value(q+x)+y*scene_value(q+y)+z*scene_value(q+z)+w*scene_value(q+w);
 return gradient/max(length(gradient),1e-12);
}
fn world_noise(q:vec3<f32>,scale:f32,seed:u32)->f32{
 // Power-of-two wavelengths make the 4096 m anchor exactly divisible for
 // fine materials. Keep lattice identity integer until corner hashing.
 let high=frame.camera_hi.xyz/scale;let low=(frame.camera_lo.xyz+q)/scale;
 var cell=vec3<i32>(floor(high))+vec3<i32>(floor(fract(high)+low));
 if scale<=4096.0&&fract(4096.0/scale)==0.0 {cell=bitcast<vec3<i32>>(bitcast<vec3<u32>>(vec3<i32>(frame.camera_hi.xyz/4096.0))*u32(4096.0/scale)+bitcast<vec3<u32>>(vec3<i32>(floor(low))));}
 let f=fract(fract(high)+low);let t=f*f*(3.0-2.0*f);
 if NOISE_CACHE&&planet_scene()&&seed-frame.options.w>=179u&&seed-frame.options.w<=186u {
  let band=seed-frame.options.w-179u;let p=cell-cloud_noise_origin(band);
  if all(p>=vec3<i32>(0))&&all(p<vec3<i32>(63)) {
   let c=vec3<u32>(p);
   return mix(mix(mix(cloud_corner(c,band),cloud_corner(c+vec3<u32>(1,0,0),band),t.x),mix(cloud_corner(c+vec3<u32>(0,1,0),band),cloud_corner(c+vec3<u32>(1,1,0),band),t.x),t.y),mix(mix(cloud_corner(c+vec3<u32>(0,0,1),band),cloud_corner(c+vec3<u32>(1,0,1),band),t.x),mix(cloud_corner(c+vec3<u32>(0,1,1),band),cloud_corner(c+vec3<u32>(1,1,1),band),t.x),t.y),t.z);
  }
 }
 return mix(mix(mix(lattice(cell,seed),lattice(cell+vec3<i32>(1,0,0),seed),t.x),mix(lattice(cell+vec3<i32>(0,1,0),seed),lattice(cell+vec3<i32>(1,1,0),seed),t.x),t.y),mix(mix(lattice(cell+vec3<i32>(0,0,1),seed),lattice(cell+vec3<i32>(1,0,1),seed),t.x),mix(lattice(cell+vec3<i32>(0,1,1),seed),lattice(cell+vec3<i32>(1,1,1),seed),t.x),t.y),t.z);
}
fn material_id(q:vec3<f32>)->u32 {
 let h=select((frame.camera_hi.y+q.y)*0.5,altitude(q)*0.08,planet_scene());
 return hash32(bitcast<u32>(i32(floor(h)))^frame.options.w)%frame.registry.x;
}
struct Material {albedo:vec3<f32>,roughness:f32}
fn material(q:vec3<f32>,n:vec3<f32>,foot:f32)->Material {
 if DIAGNOSTICS {shading_calls[1]+=1u;}
 let id=material_id(q);let family=id%7u;let descriptor=materials[family];var rock=descriptor.rgb*(0.9+0.2*f32(hash32(id)>>8u)/16777215.0);
 let up=select(vec3<f32>(0,1,0),normalize(frame.camera_hi.xyz+frame.camera_lo.xyz+q),planet_scene());
 let slope=clamp(dot(n,up),0.0,1.0);let h=select(frame.camera_hi.y+frame.camera_lo.y+q.y,altitude(q),planet_scene());
 let water=select(-0.5,frame.geology.w,planet_scene());let wet=(1.0-smoothstep(water,water+select(0.3,5.0,planet_scene()),h))*frame.media.z;
 let soil=smoothstep(0.45,0.9,slope)*(0.6+0.4*world_noise(q,select(2.0,256.0,planet_scene()),frame.options.w+89u));
 let snow=smoothstep(2600.0,3900.0,h)*smoothstep(0.25,0.75,slope);
 var grain=0.0;var variance=0.0;
 for(var k=0u;k<4u;k++){let scale=select(0.125,2.0,planet_scene())*exp2(-f32(k)*2.0);let amp=0.10*exp2(-f32(k));let weight=1.0-smoothstep(0.25,1.0,foot/scale);if weight>0.0{grain+=amp*world_noise(q,scale,frame.options.w+k+923u)*weight;}variance+=amp*(1.0-weight);}
 // Three bounded simultaneous physical layers; global IDs never create pipelines.
 rock=mix(rock,materials[8].rgb,smoothstep(1.0,25.0,foot));
 let soil_color=materials[7].rgb;var color=mix(rock,soil_color,soil*0.85);color=mix(color,materials[9].rgb,snow);
 color*=1.0+grain;color*=1.0-0.55*wet;
 return Material(color,clamp(descriptor.a-0.48*wet+variance,0.12,0.95));
}
fn cloud_density(q:vec3<f32>)->f32{
 if DIAGNOSTICS {shading_calls[2]+=1u;}
 if frame.media.x<=0.0{return 0.0;}
 if !planet_scene() {let p=frame.camera_hi.xyz+frame.camera_lo.xyz+q;let shape=1.0-smoothstep(1.0,2.8,length((p-vec3<f32>(1.5,2.5,-5.0))/vec3<f32>(2,1,1)));if shape==0.0{return 0.0;}return shape*max(0.0,0.55+noise3(p*1.4,frame.options.w))*frame.media.x;}
 let h=altitude(q);if h<4400.0||h>7200.0{return 0.0;}
 let moving=q-vec3<f32>(0.8,0,0.6)*frame.animation.x*frame.animation.y;
 let billow=world_noise(moving,4096.0,frame.options.w+184u)*0.7+world_noise(moving,1024.0,frame.options.w+185u)*0.3;
 let bottom=4600.0+150.0*world_noise(moving,8192.0,frame.options.w+186u);
 let top=5900.0+850.0*billow;
 let shell=smoothstep(bottom,bottom+220.0,h)*(1.0-smoothstep(top,top+350.0,h));
 // The remaining density factors are finite. A zero vertical support makes
 // their product exactly zero, independent of weather and footprint filtering.
 if EXACT_WORK&&shell==0.0{return 0.0;}
 let footprint=sample_footprint(length(q));
 let w0=1.0-smoothstep(2000.0,8500.0,footprint);let w1=1.0-smoothstep(600.0,2300.0,footprint);
 let n=world_noise(moving,800000.0,frame.options.w+179u)*0.65+world_noise(moving,120000.0,frame.options.w+180u)*0.28+world_noise(moving,8500.0,frame.options.w+181u)*0.1*w0+world_noise(moving,2300.0,frame.options.w+182u)*0.05*w1;
 // A fixed, world-anchored coastal weather cell makes the joint cave/water/
 // cloud stress scene reproducible even when the global cover is sparse here.
 let coast=moving-frame.anchor.xyz;let storm_offset=(coast.xz-vec2<f32>(0,-40000))/18000.0;
 let storm=exp(-dot(storm_offset,storm_offset))*(0.27+0.12*world_noise(moving,4096.0,frame.options.w+183u));
 return shell*smoothstep(0.02,0.35,max(n,storm))*frame.media.x;
}
fn atmosphere_sigma(q:vec3<f32>)->vec3<f32>{
 if DIAGNOSTICS {shading_calls[4]+=1u;}
 if !planet_scene() {return vec3<f32>(0.018)*frame.media.y;}
 let h=max(altitude(q),0.0);return (vec3<f32>(5.8,13.5,33.1)*1e-6*exp(-h/8000.0)+vec3<f32>(2e-6)*exp(-h/1200.0))*frame.media.y;
}
fn extinction(q:vec3<f32>)->vec3<f32>{return atmosphere_sigma(q)+cloud_density(q)*select(0.8,0.002,planet_scene());}
fn sun_transmittance(q:vec3<f32>)->vec3<f32>{
 if SOLAR_CACHE && planet_scene() {return cached_solar(q);}
 return sun_transmittance_direct(q);
}
fn sun_transmittance_cloud_layer(q:vec3<f32>)->vec3<f32>{
  // Resolve the illuminated cloud edge instead of jumping over it in 2.5 km
  // increments. The remaining clear-air optical path has its own coarse walk.
  var tau=vec3<f32>(0);
  // Host-fixed uniform trip counts keep the same quadrature while avoiding
  // large compiler-unrolled copies of the nested density evaluator.
  for(var i=0u;i<select(12u,frame.registry.z,EXACT_WORK);i++){tau+=extinction(q+frame.sun.xyz*(f32(i)+0.5)*300.0)*300.0;}
  for(var i=0u;i<select(4u,frame.registry.z/3u,EXACT_WORK);i++){tau+=atmosphere_sigma(q+frame.sun.xyz*(3600.0+(f32(i)+0.5)*4000.0))*4000.0;}
  return exp(-tau);
}
fn sun_transmittance_direct(q:vec3<f32>)->vec3<f32>{
 if DIAGNOSTICS {shading_calls[3]+=1u;}
 if planet_scene()&&altitude(q)>4400.0&&altitude(q)<7200.0 {
  return sun_transmittance_cloud_layer(q);
 }
 if EXACT_WORK&&planet_scene(){let p=frame.camera_hi.xyz+frame.camera_lo.xyz+q;let b=dot(p,frame.sun.xyz);if b<0.0&&dot(p,p)-b*b<frame.camera_hi.w*frame.camera_hi.w{return vec3<f32>(0);}}
 let scale=select(1.5,2500.0,planet_scene());var tau=vec3<f32>(0);
 for(var i=0u;i<select(6u,frame.registry.w,EXACT_WORK);i++){tau+=extinction(q+frame.sun.xyz*(f32(i)+0.5)*scale)*scale;}
 if !EXACT_WORK&&planet_scene(){let p=frame.camera_hi.xyz+frame.camera_lo.xyz+q;let b=dot(p,frame.sun.xyz);if b<0.0&&dot(p,p)-b*b<frame.camera_hi.w*frame.camera_hi.w{return vec3<f32>(0);}}
 return exp(-tau);
}
fn shade_rock(q:vec3<f32>,d:vec3<f32>,foot:f32,shadow:bool)->vec3<f32>{
 return shade_rock_normal(q,d,foot,shadow,surface_frame(q,foot));
}
fn shade_rock_normal(q:vec3<f32>,d:vec3<f32>,foot:f32,shadow:bool,normal:vec4<f32>)->vec3<f32>{
 var n=normal.xyz;if dot(n,d)>0.0{n=-n;}var mat=material(q,n,foot);
 if planet_scene()&&NORMAL_FILTER==2u{mat.roughness=clamp(pow(pow(mat.roughness,4.0)+normal.w,0.25),0.12,0.95);}
 let ndl=max(dot(n,frame.sun.xyz),0.0);let v=-d;let h=normalize(v+frame.sun.xyz);
 let a=mat.roughness*mat.roughness;let a2=a*a;let nh=max(dot(n,h),0.0);let nv=max(dot(n,v),0.001);let vh=max(dot(v,h),0.0);
 let distribution=a2/(PI*pow(nh*nh*(a2-1.0)+1.0,2.0));let fresnel=0.04+0.96*pow(1.0-vh,5.0);let k=pow(mat.roughness+1.0,2.0)/8.0;
 let masking=nv/(nv*(1.0-k)+k)*ndl/(ndl*(1.0-k)+k);let spec=distribution*fresnel*masking/max(4.0*nv*ndl,0.001);
 var visible=1.0;
 if shadow&&frame.media.w>0.5&&ndl>0.0 {
  let bias=max(foot,select(0.01,0.05,planet_scene()));let hit=scene_trace(q+n*bias,frame.sun.xyz,0.0,select(12.0,1500.0,planet_scene()),64u);
  record_secondary(hit);if hit.span.z==1.0{visible=0.0;}if hit.span.z>=2.0{visible=0.5;}
 }
 let direct=(mat.albedo/PI+vec3<f32>(spec))*ndl*frame.sun.w*sun_transmittance(q)*visible;
 // Named diffuse sky fill; not physically exact multiple scattering or GI.
 let ambient=mat.albedo*vec3<f32>(0.12,0.16,0.22)*(0.35+0.65*max(n.y,0.0));
 return direct+ambient;
}
fn water_distance(d:vec3<f32>)->f32 {
 if frame.media.z<0.5{return -1.0;}
 if planet_scene() {
  if frame.extra.w==0.0&&dot(d,frame.radial.xyz)<0.0{return 1e-7;}
  let s=sphere_segment_relative(d,frame.geology.w,frame.extra.w);if s.x>0.0{return s.x;}if s.y>0.0{return s.y;}return -1.0;
 }
 let depth=frame.camera_hi.y+frame.camera_lo.y+0.5;if depth==0.0&&d.y<0.0{return 1e-7;}
 let t=-depth/d.y;return select(-1.0,t,t>0.0);
}
fn wave_normal(q:vec3<f32>,up:vec3<f32>,d:vec3<f32>,foot:f32)->vec3<f32>{
 let wavelengths=array<f32,4>(8.0,3.0,0.8,0.2);let amplitudes=array<f32,4>(0.04,0.012,0.002,0.0004);
 let directions=array<vec3<f32>,4>(vec3<f32>(1,0.37,0.61),vec3<f32>(-0.3,0.51,1),vec3<f32>(0.7,-0.21,-0.8),vec3<f32>(0.2,0.8,0.6));
 // Project the full pixel cone onto the interface, including the grazing
 // elongation. Distance alone misses the anisotropic Nyquist limit.
 let incidence=dot(d,up);let safe_incidence=select(-1.0,1.0,incidence>=0.0)*max(abs(incidence),1e-4);
 let pixel_width=max(foot*2.0,sample_footprint(length(q)));
 let dx=(frame.right.xyz-d*dot(frame.right.xyz,up)/safe_incidence)*pixel_width;
 let dy=(frame.up.xyz-d*dot(frame.up.xyz,up)/safe_incidence)*pixel_width;
 var gradient=vec3<f32>(0);
 for(var k=0u;k<4u;k++){
  let frequency=2.0*PI/wavelengths[k];let cycles=max(abs(dot(dx,directions[k])),abs(dot(dy,directions[k])))/wavelengths[k];
  let weight=1.0-smoothstep(0.125,0.5,cycles);
  gradient+=directions[k]*cos(frame.waves[k]+dot(q,directions[k])*frequency)*frequency*amplitudes[k]*weight;
 }
 gradient-=up*dot(up,gradient);
 // Shading normals represent filtered ripples on the exact mean interface.
 // Fade perturbation at grazing incidence to preserve the medium hemisphere.
 return normalize(up-gradient*smoothstep(0.0,0.2,abs(dot(d,up))));
}
fn dielectric_fresnel(cosine:f32,eta:f32)->f32 {
 let ci=clamp(cosine,0.0,1.0);let st2=eta*eta*max(0.0,1.0-ci*ci);
 if st2>=1.0{return 1.0;}
 let ct=sqrt(1.0-st2);
 let rs=(eta*ci-ct)/max(eta*ci+ct,1e-8);let rp=(ci-eta*ct)/max(ci+eta*ct,1e-8);
 return clamp((rs*rs+rp*rp)*0.5,0.0,1.0);
}
fn secondary_light(q:vec3<f32>,d:vec3<f32>,foot:f32,in_water:bool)->vec3<f32>{
 let limit=select(select(15.0,100000.0,planet_scene()),select(15.0,1500.0,planet_scene()),in_water);
 var near=0.0;var far=limit;
 if planet_scene() {
  let shell=sphere_segment_from(q,d,frame.base.z+250.0);near=max(0.0,shell.x);far=min(far,shell.y);
  let inner=sphere_segment_from(q,d,-frame.base.z-250.0);if inner.x>near{far=min(far,inner.x);}
 }
 var color=sky(d);var end=select(frame.quality.z,limit,in_water);
 if far>near {
  // A secondary ray inherits the resolved footprint at the water interface.
  // Resetting it to the camera's millimetre floor needlessly refines distant
  // reflections and can return numerical uncertainty below a whole pixel.
  let hit=scene_trace_footprint(q,d,near,far,clamp(frame.size.z/4u,96u,512u),foot);record_secondary(hit);
  if hit.span.z==1.0{end=hit.span.y;color=shade_rock(q+d*end,d,max(foot,ray_tolerance(end)),false);}
 }
 if in_water{
  let tr=exp(-vec3<f32>(0.12,0.035,0.018)*end*select(1.0,0.15,planet_scene()));
  return mix(vec3<f32>(0.012,0.085,0.105),color,tr);
 }
 return integrate_media_from(q,d,end,color,false).rgb;
}
fn shade_water(q:vec3<f32>,d:vec3<f32>,foot:f32)->vec3<f32>{
 if DIAGNOSTICS {shading_calls[6]+=1u;}
 let up=select(vec3<f32>(0,1,0),normalize(frame.camera_hi.xyz+frame.camera_lo.xyz+q),planet_scene());let inside=select(frame.camera_hi.y+frame.camera_lo.y< -0.5,frame.extra.w<0.0,planet_scene());
 let geometric=select(up,-up,inside);var n=select(wave_normal(q,up,d,foot),-wave_normal(q,up,d,foot),inside);
 let eta=select(1.0/1.333,1.333,inside);var refracted=refract(d,n,eta);var reflection=reflect(d,n);
 // A shading ripple must not send a ray into the wrong geometric medium.
 if dot(reflection,geometric)<=0.0||(length(refracted)>0.5&&dot(refracted,geometric)>=0.0){n=geometric;reflection=reflect(d,n);refracted=refract(d,n,eta);}
 let fresnel=dielectric_fresnel(max(-dot(d,n),0.0),eta);
 // One optical model at all footprints; no distance threshold that changes
 // ocean color or disables shoreline/sky transport. Only wave filtering varies.
 let reflected=secondary_light(q,reflection,foot,inside);
 if fresnel>=1.0{return reflected;}
 let transmission=secondary_light(q,refracted,foot,!inside);
 return mix(transmission,reflected,fresnel);
}
fn integrate_media(d:vec3<f32>,end:f32,background:vec3<f32>,separate:bool)->vec4<f32>{
 let inside_water=select(frame.camera_hi.y+frame.camera_lo.y< -0.5,frame.extra.w<0.0,planet_scene());
 if inside_water&&frame.media.z>0.5{return vec4<f32>(background,0.0);}
 return integrate_media_from(vec3<f32>(0),d,end,background,separate);
}
fn heat(x:f32)->vec3<f32>{return clamp(vec3<f32>(1.5-abs(4.0*x-3.0),1.5-abs(4.0*x-2.0),1.5-abs(4.0*x-1.0)),vec3<f32>(0),vec3<f32>(1));}
fn refine_shading_depth(d:vec3<f32>,hit:RayResult)->f32 {
 if DIAGNOSTICS {shading_calls[5]+=1u;}
 var a=hit.span.x;var b=hit.span.y;let fa=scene_value(d*a);
 // Visibility tolerance is often kilometres in orbit; materials still need the
 // actual interface rather than the far edge of that coverage interval.
 var va=fa;var vb=scene_value(d*b);var sample=(a+b)*0.5;
 for(var i=0u;i<5u;i++){sample=(a+b)*0.5;if abs(vb-va)>1e-12{sample=clamp((a*vb-b*va)/(vb-va),a+(b-a)*0.001,b-(b-a)*0.001);}let fm=scene_value(d*sample);if (va<0.0)==(fm<0.0){a=sample;va=fm;}else{b=sample;vb=fm;}}
 return sample;
}
// Lower-rate transport experiment with full-rate canonical visibility. The
// normal/distance checks are heuristics, NOT bounds on reflected radiance.
// All primary samples in a shared block must be resolved water, so silhouettes,
// solid coverage and raw unknowns retain individual shading. History is disabled
// for this experimental mode; every shared value comes from the current frame.
fn shared_water_tile(origin:vec2<u32>)->bool {
 if WATER_RATE==1u||frame.history.x>0.5||frame.options.y!=0u||frame.extra.w<=0.01{return false;}
 if any(origin+vec2<u32>(WATER_RATE)>frame.size.xy){return false;}
 let d0=view_direction(origin);let t0=water_distance(d0);if t0<=0.0{return false;}
 let q0=d0*t0;let up0=normalize(frame.radial.xyz*frame.camera_lo.w+q0);let n0=wave_normal(q0,up0,d0,ray_tolerance(t0));
 // Avoid a direct-sun glint neighborhood. Reflected terrain/cloud boundaries
 // remain unbounded, which is why the image/ROI gates decide this experiment.
 if dot(reflect(d0,n0),frame.sun.xyz)>0.95{return false;}
 for(var y=0u;y<WATER_RATE;y++){for(var x=0u;x<WATER_RATE;x++){
  let p=origin+vec2<u32>(x,y);if !active_reference_pixel(p)||hits[p.y*frame.size.x+p.x].span.z!=0.0{return false;}
  let d=view_direction(p);let t=water_distance(d);if t<=0.0||abs(t-t0)>max(0.002,t0*0.005){return false;}
  let q=d*t;let up=normalize(frame.radial.xyz*frame.camera_lo.w+q);let n=wave_normal(q,up,d,ray_tolerance(t));
  if dot(n,n0)<0.9999875{return false;}
 }}
 return true;
}
fn shade_pixel(id:vec3<u32>,separate:bool){
 if any(id.xy>=frame.size.xy){return;}
 let tile=id.xy/vec2<u32>(WATER_RATE)*vec2<u32>(WATER_RATE);
 let share_tile=WATER_RATE>1u&&planet_scene()&&shared_water_tile(tile);
 if share_tile&&any(id.xy!=tile){return;}
 if !active_reference_pixel(id.xy){textureStore(image,vec2<i32>(id.xy),vec4<f32>(0,0,0,1));return;}
 if any(id.xy>=frame.size.xy){return;}let index=id.y*frame.size.x+id.x;let hit=hits[index];let d=view_direction(id.xy);var end=frame.quality.z;var color=sky(d);
 // Primary sky is transported sunlight against space, not a painted blue
 // gradient added behind an already-scattering atmosphere.
 if planet_scene() {color=pow(max(dot(d,frame.sun.xyz),0.0),1800.0)*frame.sun.w*vec3<f32>(1.0,0.95,0.9);}
 let water=water_distance(d);var foot=ray_tolerance(hit.span.y);var q=d*hit.span.y;var normal=vec3<f32>(0);var status=0u;var mid=0u;
 if hit.span.z==1.0{end=refine_shading_depth(d,hit);q=d*end;let nf=surface_frame(q,foot);normal=nf.xyz;color=shade_rock_normal(q,d,foot,true,nf);status=1u;mid=material_id(q);}
 if water>0.0&&water<end{end=water;q=d*water;foot=ray_tolerance(water);color=shade_water(q,d,foot);normal=select(vec3<f32>(0,1,0),normalize(frame.radial.xyz*frame.camera_lo.w+q),planet_scene());status=2u;mid=0u;}
 let before_medium=color;let medium=integrate_media(d,end,color,separate);color=medium.rgb;
 var reactive=select(0.0,1.0,status==2u);
 if frame.media.x>0.0 {let change=abs(color-before_medium)/(abs(color)+abs(before_medium)+vec3<f32>(0.05));reactive=max(reactive,clamp(max(change.x,max(change.y,change.z))*2.0,0.0,1.0));}
 let inside_water=select(frame.camera_hi.y+frame.camera_lo.y< -0.5,frame.extra.w<0.0,planet_scene());
 if inside_water&&frame.media.z>0.5{let t=exp(-vec3<f32>(0.12,0.035,0.018)*end*select(1.0,0.15,planet_scene()));color=mix(vec3<f32>(0.01,0.06,0.08),color,t);}
 if hit.span.z>=2.0 {color=mix(color,vec3<f32>(1.0,0.22,0.015),0.8);status=3u;reactive=1.0;mid=0u;}
 switch frame.options.y {
  case 1u:{color=heat(f32(hit.counts.x)/f32(frame.size.z));}
  case 2u:{color=heat(f32(hit.counts.y)/max(1.0,f32(hit.counts.x)*24.0));}
  case 3u:{color=select(vec3<f32>(0.02),surface_normal(q,foot)*0.5+0.5,hit.span.z==1.0);}
  case 4u:{color=vec3<f32>(log2(1.0+end)/log2(1.0+frame.quality.z));}
  case 5u:{let mid=hash32(material_id(q));color=vec3<f32>(f32(mid&255u),f32((mid>>8u)&255u),f32((mid>>16u)&255u))/255.0;}
  case 6u:{color=heat(medium.a/8.0);}
  case 7u:{color=select(vec3<f32>(0.01,0.15,0.08),vec3<f32>(1,0.1,0),hit.span.z>=2.0);}
  case 8u:{color=heat(f32(hit.counts.z)/48.0);}
  case 9u:{color=heat((hit.span.y-hit.span.x)/max(1e-6,ray_tolerance(hit.span.x)));}
  default:{}
 }
 // Unexposed linear radiance; the reconstruction pass owns display encoding.
 if any(color!=color)||any(abs(color)>vec3<f32>(65000)){color=vec3<f32>(1,0,1);status=3u;reactive=1.0;mid=0u;}
 if frame.history.x>0.5 {
  let uv=(vec2<f32>(id.xy)+0.5+frame.sampling.xy)/vec2<f32>(frame.size.xy);
  let previous_q=select(q+frame.previous_offset.xyz,d,status==0u);let z=dot(previous_q,frame.previous_forward.xyz);
  var previous_uv=vec2<f32>(-2);if z>1e-8{previous_uv=vec2<f32>(0.5+dot(previous_q,frame.previous_right.xyz)/(2.0*z*frame.previous_right.w*frame.previous_up.w),0.5-dot(previous_q,frame.previous_up.xyz)/(2.0*z*frame.previous_right.w));}
  guides[index]=Guide(previous_uv-uv,select(end,0.0,status==0u),select(length(previous_q),0.0,status==0u),pack_normal(normal),(mid<<2u)|status);
 }
 if DIAGNOSTICS {for(var k=0u;k<8u;k++){count64(16u+k,24u+k,shading_calls[k]);}}
 textureStore(image,vec2<i32>(id.xy),vec4<f32>(color,reactive));
 if share_tile {for(var y=0u;y<WATER_RATE;y++){for(var x=0u;x<WATER_RATE;x++){
  if x!=0u||y!=0u{textureStore(image,vec2<i32>(tile+vec2<u32>(x,y)),vec4<f32>(color,reactive));}
 }}}
}
@compute @workgroup_size(GROUP_X,GROUP_Y)
fn shade_image(@builtin(global_invocation_id) id:vec3<u32>){shade_pixel(id,false);}
@compute @workgroup_size(GROUP_X,GROUP_Y)
fn shade_separate(@builtin(global_invocation_id) id:vec3<u32>){shade_pixel(id,true);}
