// Disposable 32^3 resident certificates, rebuilt at a changed camera/field.
// Each cell is bounded by its enclosing ball, never by sampled min/max.
@group(0) @binding(8) var<storage,read_write> region_cache:array<vec2<f32>>;
@group(0) @binding(9) var<storage,read_write> solar_cache:array<vec4<f32>>;
// Exact disposable lattice memoization, eight 64^3 grids / 8 MiB. Coordinates
// outside the resident window evaluate the original integer hash. This shares
// the optional solar allocation; selecting the solar experiment bypasses it.
fn cloud_noise_scale(k:u32)->f32 {let scales=array<f32,8>(800000,120000,8500,2300,4096,4096,1024,8192);return scales[k];}
fn cloud_noise_origin(k:u32)->vec3<i32> {
 let scale=cloud_noise_scale(k);let q= -vec3<f32>(0.8,0,0.6)*frame.animation.x*frame.animation.y;
 let high=frame.camera_hi.xyz/scale;let low=(frame.camera_lo.xyz+q)/scale;
 var c=vec3<i32>(floor(high))+vec3<i32>(floor(fract(high)+low));
 if scale<=4096.0&&fract(4096.0/scale)==0.0 {c=bitcast<vec3<i32>>(bitcast<vec3<u32>>(vec3<i32>(frame.camera_hi.xyz/4096.0))*u32(4096.0/scale)+bitcast<vec3<u32>>(vec3<i32>(floor(low))));}
 return c-vec3<i32>(32);
}
fn cloud_corner(p:vec3<u32>,band:u32)->f32 {
 let i=((band*64u+p.z)*64u+p.y)*64u+p.x;return solar_cache[i/4u][i%4u];
}
@compute @workgroup_size(4,4,4)
fn build_noise_cache(@builtin(global_invocation_id) id:vec3<u32>){
 if id.x>=16u||id.y>=64u||id.z>=512u{return;}
 let band=id.z/64u;let p=vec3<u32>(id.x*4u,id.y,id.z%64u);let c=cloud_noise_origin(band)+vec3<i32>(p);let seed=frame.options.w+179u+band;
 solar_cache[(id.z*64u+id.y)*16u+id.x]=vec4<f32>(lattice(c,seed),lattice(c+vec3<i32>(1,0,0),seed),lattice(c+vec3<i32>(2,0,0),seed),lattice(c+vec3<i32>(3,0,0),seed));
}
fn light_axes()->mat3x3<f32>{
 let up=frame.radial.xyz;var x=cross(up,vec3<f32>(0,0,1));if length(x)<0.01{x=cross(up,vec3<f32>(1,0,0));}x=normalize(x);return mat3x3<f32>(x,up,cross(x,up));
}
fn solar_index(p:vec3<u32>)->u32{return (p.z*32u+p.y)*64u+p.x;}
@compute @workgroup_size(4,4,4)
fn build_solar_cache(@builtin(global_invocation_id) id:vec3<u32>){
 if any(id>=vec3<u32>(64,32,64)){return;}
 let x=(f32(id.x)/63.0-0.5)*64000.0;let z=(f32(id.z)/63.0-0.5)*64000.0;let h=4400.0+f32(id.y)/31.0*2800.0;
 let r=frame.camera_lo.w;let delta=(h-frame.radial.w)*(2.0*frame.camera_hi.w+h+frame.radial.w)-x*x-z*z;
 let y=delta/(sqrt(max(0.0,r*r+delta))+r);let q=light_axes()*vec3<f32>(x,y,z);
 // Extend the inside-layer quadrature to its endpoint nodes. Selecting the
 // outside-layer branch at exactly 4400/7200 m would contaminate interpolation.
 solar_cache[solar_index(id)]=vec4<f32>(sun_transmittance_cloud_layer(q),1);
}
fn cached_solar(q:vec3<f32>)->vec3<f32>{
 let axes=light_axes();let h=altitude(q);
 let uv=vec3<f32>(dot(q,axes[0])/64000.0+0.5,(h-4400.0)/2800.0,dot(q,axes[2])/64000.0+0.5);
 if h<=4400.0||h>=7200.0{return sun_transmittance_direct(q);}
 if any(uv<=vec3<f32>(0))||any(uv>=vec3<f32>(1)){return sun_transmittance_direct(q);}
 let p=uv*vec3<f32>(63,31,63);let base=vec3<u32>(floor(p));let f=fract(p);
 let a=mix(mix(solar_cache[solar_index(base)].rgb,solar_cache[solar_index(base+vec3<u32>(1,0,0))].rgb,f.x),mix(solar_cache[solar_index(base+vec3<u32>(0,1,0))].rgb,solar_cache[solar_index(base+vec3<u32>(1,1,0))].rgb,f.x),f.y);
 let b=mix(mix(solar_cache[solar_index(base+vec3<u32>(0,0,1))].rgb,solar_cache[solar_index(base+vec3<u32>(1,0,1))].rgb,f.x),mix(solar_cache[solar_index(base+vec3<u32>(0,1,1))].rgb,solar_cache[solar_index(base+vec3<u32>(1,1,1))].rgb,f.x),f.y);
 let interior=min(p,vec3<f32>(63,31,63)-p);let blend=smoothstep(0.0,2.0,min(interior.x,min(interior.y,interior.z)));
 let value=mix(a,b,f.z);if blend>=1.0{return value;}return mix(sun_transmittance_direct(q),value,blend);
}
fn ball_norm(p:vec3<f32>,radius:f32)->vec2<f32>{let n=length(p);return vec2<f32>(max(0.0,n-radius),n+radius);}
fn noise_ball(p:vec3<f32>,radius:f32,seed:u32)->vec2<f32>{
 let e=3.0*sqrt(3.0)*radius;if e>=2.0{return vec2<f32>(-1,1);}
 let n=noise3(p,seed);return clamp(vec2<f32>(n-e,n+e),vec2<f32>(-1),vec2<f32>(1));
}
fn feature_ball(q:vec3<f32>,r:f32)->Features {
 let p=q-frame.anchor.xyz;
 if any(abs(p)>vec3<f32>(360,110,460)+r){return Features(vec2<f32>(0),vec2<f32>(0),vec2<f32>(0),vec2<f32>(0),false);}
 var rough=vec2<f32>(0);let scales=array<f32,4>(32,4,0.5,0.0625);let amps=array<f32,4>(7,0.8,0.1,0.0125);
 for(var k=0u;k<4u;k++){rough+=noise_ball(p/scales[k],r/scales[k],frame.options.w+701u+k)*amps[k];}
 let mesa=(ball_norm((p-vec3<f32>(0,0,-90))/vec3<f32>(210,70,230),r/70.0)-1.0)*70.0+rough;
 let basin=(ball_norm((p-vec3<f32>(0,10,270))/vec3<f32>(310,80,175),r/80.0)-1.0)*80.0+rough*0.35;
 let bore=ball_norm(vec3<f32>(p.x,p.y+5.0,0),r)-24.0+rough*0.25;
 let cap=vec2<f32>(max(0.0,abs(p.z)-r),abs(p.z)+r)-240.0;
 let rock=ball_norm((p-vec3<f32>(46,5,190))/vec3<f32>(1,1.5,0.8),r/0.8)*0.8-9.0+rough*0.3;
 return Features(mesa,basin,max(bore,cap),rock,true);
}
fn planet_ball(q:vec3<f32>,r:f32)->vec2<f32>{
 let features=feature_ball(q,r);let numerical=0.00008+(length(q)+r)*1.5e-6;
 let radial=radial_change(q);var delta=0.0;var variation=r;
 var result=vec2<f32>(-1e30,1e30);
 for(var k=0u;k<24u;k++){
  let p=read_proxy(k);delta+=p.config.x*proxy_delta(q,k);
  // Cubic lattice partial derivatives <=3; abs/ridge is 1-Lipschitz.
  variation+=p.config.x*min(2.0,3.0*sqrt(3.0)*r*p.phase.w);
  let center=p.config.z+radial-delta;
  let e=variation+p.config.w+frame.extra.y*frame.geology.z+numerical;
  result=combine_features(features,vec2<f32>(center-e,center+e))+vec2<f32>(-numerical,numerical);
  if result.x>0.0||result.y<0.0{return result;}
 }
 return result;
}
@compute @workgroup_size(4,4,4)
fn build_region_cache(@builtin(global_invocation_id) id:vec3<u32>){
 if any(id>=vec3<u32>(32)){return;}
 let cell=frame.coarse_meta.z;let q=(vec3<f32>(id)+0.5-16.0)*cell;
 region_cache[(id.z*32u+id.y)*32u+id.x]=planet_ball(q,sqrt(3.0)*cell*0.5+0.0002+length(q)*1e-6);
}
fn cached_region(o:vec3<f32>,d:vec3<f32>,a:f32,b:f32)->vec2<f32>{
 let cell=frame.coarse_meta.z;
 let first=vec3<i32>(floor((o+d*a)/cell+16.0));let last=vec3<i32>(floor((o+d*b)/cell+16.0));
 if any(first!=last)||any(first<vec3<i32>(0))||any(first>=vec3<i32>(32)){return vec2<f32>(-1e30,1e30);}
 let i=vec3<u32>(first);return region_cache[(i.z*32u+i.y)*32u+i.x];
}
