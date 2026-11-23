// Single radial terrain surface. Scene antialiasing runs after the HDR composite.
struct Frame {
 eye_hi:vec4<f32>, eye_lo:vec4<f32>, right:vec4<f32>, up:vec4<f32>, forward:vec4<f32>,
 sun:vec4<f32>, view:vec4<f32>, planet:vec4<f32>, options:vec4<f32>, lod:vec4<f32>, geo:vec4<f32>,
 prev_hi:vec4<f32>,prev_lo:vec4<f32>,prev_right:vec4<f32>,prev_up:vec4<f32>,prev_forward:vec4<f32>,
 wind:vec4<f32>, eye_tail:vec4<f32>, edits:array<vec4<f32>,32>, numeric:vec4<u32>, water:vec4<f32>, water_motion:vec4<f32>,
 cloud_motion:vec4<f32>, cloud_drift:vec4<f32>, scenery:vec4<f32>,scenery_work:vec4<f32>,scenery_limits:vec4<u32>,
 cloud_cache:vec4<u32>, // frame index, animated refresh divisor, parameters changed, animation advanced
 cloud_far:vec4<f32>, // far block size in cloud pixels (1 = off), far split distance, cloud texture width and height
 quality:vec4<f32>, // aerial perspective steps, wave bands, screen-space water reflections, relief refinement steps
 // Allocation tier, fixed for the renderer's lifetime (see crates/solar-explorer/src/tier.rs).
 tier_a:vec4<u32>, // vertex hash capacity per bank (power of two), union patch cap, scenery window side, caster IDs per stream
 tier_b:vec4<u32>, // prop shadow map size, global profile map size, height clipmap size, reserved
 tier_c:vec4<u32>, // weather face size, atlas cell pixels, wave cache base size, index capacity per bank
 tier_d:vec4<u32>, // node capacity; w: startup placeholder flags (bit 0: sea programs pending)
 // The body descriptor (crates/solar-core/src/body.rs).
 atmosphere:vec4<f32>, // shell height, Rayleigh and Mie scale heights, sky fade height
 atmosphere_beta:vec4<f32>, // Rayleigh extinction per metre in xyz
 cloud_shell:vec4<f32>, // x: top of the cloud ray and shadow shell
 field:vec4<f32>, // measured body, finest height and albedo levels, slope of full complement
 field_serial:vec4<u32>, // advances with the height and albedo tables; z, frames since either changed; w, ground material on
 surface_blend:vec4<f32>, // x: how much of the picture is the surface pass, against the far planet in the space layer's own target
 solar:vec4<f32>, // x: the space layer is on; y: light from the sky, against Earth's; z: this pass draws the Sun's disk; w: the kind of ground
 body_detail:vec4<f32>, // x: relief laid over a body with no height data; yzw: the colour of sky light on the ground, against Earth's
 air_scatter:vec4<f32>, // what the air scatters toward the eye
 sky_low:vec4<f32>, // the sky at the horizon
 sky_high:vec4<f32>, // the sky at the zenith
 cover:vec4<f32>, // ground cover: on, reach (m), density, unused
 starlight:vec4<f32>, // the colour of the system star's light against the Sun's (crates/solar-core/src/stars.rs), 1 for Sol
 temporal:vec4<f32>,
}
struct Sample { hi:vec4<f32>,lo:vec4<f32>,normal:vec4<f32> }
// A shared vertex owns its complete trajectory. Retargeting samples the old
// rendered trajectory, so GPU generation never waits for a global morph.
struct Morph { key:vec4<i32>,hi:vec4<f32>,a:vec4<f32>,b:vec4<f32>,na:vec4<f32>,nb:vec4<f32>,velocity:vec4<f32> }
@group(0) @binding(0) var<uniform> f:Frame;
@group(0) @binding(2) var<storage,read_write> cache_write:array<Sample>;
@group(0) @binding(3) var<storage,read> cache:array<Sample>;
@group(0) @binding(4) var<storage,read> morphs:array<Morph>;
@group(0) @binding(28) var<storage,read> morphs_b:array<Morph>;
fn hash(v:u32)->u32 {var x=v;x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;return x^(x>>16u);}
// An opaque integer round barrier prevents permitted floating-point reassociation
// from collapsing compensated arithmetic. The host always supplies zero.
fn rounded(x:f32)->f32{return bitcast<f32>(bitcast<u32>(x)^f.numeric.x);}
fn rounded3(x:vec3<f32>)->vec3<f32>{return bitcast<vec3<f32>>(bitcast<vec3<u32>>(x)^vec3<u32>(f.numeric.x));}
fn ds_add(a:vec2<f32>,b:vec2<f32>)->vec2<f32>{let s=rounded(a.x+b.x);let v=rounded(s-a.x);let e=rounded(rounded(a.x-rounded(s-v))+rounded(b.x-v))+rounded(a.y+b.y);let hi=rounded(s+e);return vec2<f32>(hi,rounded(e-rounded(hi-s)));}
fn ds_mul(a:vec2<f32>,b:vec2<f32>)->vec2<f32>{let p=rounded(a.x*b.x);let e=rounded(fma(a.x,b.x,-p))+rounded(a.x*b.y)+rounded(a.y*b.x);let h=rounded(p+e);return vec2<f32>(h,rounded(e-rounded(h-p)));}
// Project the actual raster hit onto the canonical sphere in split precision.
// Interpolated vertex height omits chord sag, so subtracting it moved the noise
// coordinates with coarse triangulation and could shift materials at seams.
struct SurfaceAddress {hi:vec3<f32>,lo:vec3<f32>}
fn surface_address(p:vec3<f32>)->SurfaceAddress{
 let x=ds_add(ds_add(vec2<f32>(f.eye_hi.x,0),vec2<f32>(f.eye_lo.x,0)),ds_add(vec2<f32>(p.x,0),vec2<f32>(f.eye_tail.x,0)));
 let y=ds_add(ds_add(vec2<f32>(f.eye_hi.y,0),vec2<f32>(f.eye_lo.y,0)),ds_add(vec2<f32>(p.y,0),vec2<f32>(f.eye_tail.y,0)));
 let z=ds_add(ds_add(vec2<f32>(f.eye_hi.z,0),vec2<f32>(f.eye_lo.z,0)),ds_add(vec2<f32>(p.z,0),vec2<f32>(f.eye_tail.z,0)));
 let l2=ds_add(ds_add(ds_mul(x,x),ds_mul(y,y)),ds_mul(z,z));let inv=inverseSqrt(l2.x);
 let error=ds_add(vec2<f32>(1,0),-ds_mul(l2,ds_mul(vec2<f32>(inv,0),vec2<f32>(inv,0))));
 let scale=ds_mul(ds_add(vec2<f32>(inv,0),ds_mul(vec2<f32>(0.5*inv,0),error)),vec2<f32>(f.planet.x,0));
 let a=ds_mul(x,scale);let b=ds_mul(y,scale);let c=ds_mul(z,scale);
 let hi=floor(vec3<f32>(a.x,b.x,c.x)/4096.0)*4096.0;
 return SurfaceAddress(hi,(vec3<f32>(a.x,b.x,c.x)-hi)+vec3<f32>(a.y,b.y,c.y));
}
fn surface_base(p:vec3<f32>)->vec3<f32>{let address=surface_address(p);return (address.hi-f.eye_hi.xyz)+address.lo;}
fn lattice(c:vec3<i32>,seed:u32)->f32 {return f32(hash(bitcast<u32>(c.x)^hash(bitcast<u32>(c.y)^hash(bitcast<u32>(c.z)^seed)))>>8u)*(2.0/16777215.0)-1.0;}
// Integer cells are added before floating point: no Earth-sized f32 subtraction.
// The eight lattice corners share their hash prefixes: hash(z) twice, then
// hash(y^.) four times, then hash(x^.) eight times reproduces lattice()
// exactly with 14 hashes instead of 24.
fn noise_gradient(hi:vec3<f32>,lo:vec3<f32>,scale:f32,seed:u32)->vec4<f32> {
 let ah=floor(hi/scale);let low=rounded3(rounded3(hi/scale-ah)+lo/scale);let al=floor(low);
 let cell=vec3<i32>(ah)+vec3<i32>(al);let t=low-al;let w=t*t*(3.0-2.0*t);let dw=6.0*t*(1.0-t);
 let c=bitcast<vec3<u32>>(cell);
 let hz=vec2<u32>(hash(c.z^seed),hash((c.z+1u)^seed));
 let hy=vec4<u32>(hash(c.y^hz.x),hash((c.y+1u)^hz.x),hash(c.y^hz.y),hash((c.y+1u)^hz.y));
 var value=0.0;var grad=vec3<f32>(0.0);
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let bit=vec3<i32>(x,y,z);let v=f32(hash((c.x+u32(x))^hy[u32(y)+2u*u32(z)])>>8u)*(2.0/16777215.0)-1.0;let b=select(1.0-w,w,bit==vec3<i32>(1));let d=select(-dw,dw,bit==vec3<i32>(1));
  value+=v*b.x*b.y*b.z;grad+=v*vec3<f32>(d.x*b.y*b.z,b.x*d.y*b.z,b.x*b.y*d.z);
 }}}
 return vec4<f32>(grad/scale,value);
}
// Value-only twin of noise_gradient with the identical accumulation order, so
// height-only consumers (shadow confirmation) reproduce the same bits at less
// than half the arithmetic.
fn noise_value(hi:vec3<f32>,lo:vec3<f32>,scale:f32,seed:u32)->f32 {
 let ah=floor(hi/scale);let low=rounded3(rounded3(hi/scale-ah)+lo/scale);let al=floor(low);
 let cell=vec3<i32>(ah)+vec3<i32>(al);let t=low-al;let w=t*t*(3.0-2.0*t);
 let c=bitcast<vec3<u32>>(cell);
 let hz=vec2<u32>(hash(c.z^seed),hash((c.z+1u)^seed));
 let hy=vec4<u32>(hash(c.y^hz.x),hash((c.y+1u)^hz.x),hash(c.y^hz.y),hash((c.y+1u)^hz.y));
 var value=0.0;
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let bit=vec3<i32>(x,y,z);let v=f32(hash((c.x+u32(x))^hy[u32(y)+2u*u32(z)])>>8u)*(2.0/16777215.0)-1.0;let b=select(1.0-w,w,bit==vec3<i32>(1));
  value+=v*b.x*b.y*b.z;
 }}}
 return value;
}
fn filter_weight(scale:f32,spacing:f32)->f32 {return smoothstep(1.0,4.0,scale/max(spacing,0.000001));}
fn band(k:u32)->vec3<f32> {
 let scale=2097152.0*exp2(-f32(k));var amp=2200.0*pow(f.geo.y,f32(k)-1.0);
 if k==0u {amp=6500.0;}if k>=8u {amp=max(amp,600.0*pow(f.geo.y,f32(k)-8.0));}
 return vec3<f32>(scale,amp*f.geo.x,select(0.0,1.0,k>=2u&&k<9u));
}
fn relative(s:Sample)->vec3<f32> {
 let high=rounded3(s.hi.xyz-f.eye_hi.xyz);let low=rounded3(s.lo.xyz-f.eye_lo.xyz);
 let v=rounded3(low-s.lo.xyz);let error=rounded3(rounded3(s.lo.xyz-rounded3(low-v))-rounded3(f.eye_lo.xyz+v));
 let sum=rounded3(high+low);let w=rounded3(sum-high);let tail=rounded3(rounded3(high-rounded3(sum-w))+rounded3(low-w));
 return sum+rounded3(tail+rounded3(error-f.eye_tail.xyz));
}
struct Surface { @builtin(position) clip:vec4<f32>,@location(0) position:vec4<f32>,@location(1) normal:vec4<f32> }
fn morph_elapsed(clock:f32,birth:f32)->f32{var elapsed=clock-birth;if elapsed<0.0{elapsed+=4096.0;}return elapsed;}
fn morph_phase(m:Morph,clock:f32)->f32{return clamp(morph_elapsed(clock,m.hi.w)/max(0.0001,m.velocity.w),0.0,1.0);}
fn morph_sample(m:Morph,clock:f32)->Sample{
 let t=morph_phase(m,clock);let w=t*t*(3.0-2.0*t);let h=t*(1.0-t)*(1.0-t)*m.velocity.w;
 return Sample(vec4<f32>(m.hi.xyz,mix(m.na.w,m.nb.w,w)),mix(m.a,m.b,w)+vec4<f32>(m.velocity.xyz*h,0),vec4<f32>(normalize(mix(m.na.xyz,m.nb.xyz,w)),0));
}
fn morph_velocity(m:Morph,clock:f32)->vec3<f32>{let t=morph_phase(m,clock);return (m.b.xyz-m.a.xyz)*6.0*t*(1.0-t)/max(0.0001,m.velocity.w)+m.velocity.xyz*(1.0-4.0*t+3.0*t*t);}
fn raster_morph(id:u32)->Morph{if id<f.tier_a.x{return morphs[id];}return morphs_b[id-f.tier_a.x];}
fn camera_clip(p:vec3<f32>)->vec4<f32>{
 let z=dot(p,f.forward.xyz);
 let xy=vec2<f32>(dot(p,f.right.xyz)/(f.view.z*f.view.w),dot(p,f.up.xyz)/f.view.w);
 return vec4<f32>(xy+vec2<f32>(-2,2)*f.temporal.xy/f.view.xy*z,0.1,z);
}
@vertex fn terrain_vertex(@builtin(vertex_index) id:u32)->Surface {
 let s=morph_sample(raster_morph(id),f.lod.x);let p=relative(s);let z=dot(p,f.forward.xyz);
 let clip=camera_clip(p);
 return Surface(clip,vec4<f32>(p,s.lo.w),vec4<f32>(s.normal.xyz,log2(max(0.0001,s.hi.w))));
}
struct Gbuffer {@location(0) position:vec4<f32>,@location(1) normal:vec4<f32>,@builtin(frag_depth) depth:f32}
// Proxy visibility pre-pass: the nearest unrefined forward distance and its
// relief trust radius per pixel. Relief refinement writes fragment depth,
// which disables early depth rejection, so the main pass consults this
// instead and skips the refinement of fragments that cannot win.
@group(0) @binding(92) var terrain_proxy:texture_2d<f32>;
// Relief refinement moves a hit along its view ray by at most the trust
// radius. The distant shoreline refinement is a sphere intersection with no
// such bound, so fragments it may touch never take part in the test.
fn terrain_trust(v:Surface)->f32{return select(clamp(exp2(v.normal.w)*4.0,1.0,512.0),1e30,surface_detail_weight(v.position.xyz)>0.0);}
@fragment fn terrain_prepass_fragment(v:Surface)->@location(0) vec2<f32>{return vec2<f32>(dot(v.position.xyz,f.forward.xyz),terrain_trust(v));}
@fragment fn terrain_fragment(v:Surface)->Gbuffer {
 if f.quality.w>0.0{
  let z=dot(v.position.xyz,f.forward.xyz);let trust=terrain_trust(v);
  let nearest=textureLoad(terrain_proxy,vec2<i32>(v.clip.xy),0);
  if trust<1e29&&z-trust>nearest.x+nearest.y{return Gbuffer(v.position,v.normal,clamp(0.1/z,0.0,1.0));}
 }
 let p=surface_detail_hit(v.position,exp2(v.normal.w));return Gbuffer(p,v.normal,clamp(0.1/dot(p.xyz,f.forward.xyz),0.0,1.0));
}
// Sea and land use the same shared trajectory and conforming topology.
// Water level at a vertex. A vertex with no water sits under the ground, so that triangles leading away from
// a shore slope down out of sight instead of standing up as a sheet. A measured vertex keeps its level in key.w.
@group(0) @binding(135) var<storage,read> ocean_indices:array<u32>;
fn vertex_water_level(m:Morph,s:Sample,id:u32)->f32{
 if !field_measured(){return f.planet.y;}
 // An excess rides on the vertex as it morphs; a level stays where it is.
 let level=bitcast<f32>(m.key.w);if level>WATER_NONE{return vertex_water_decode(level,s.lo.w);}
 // A shore triangle continues its water plane across dry vertices. There is
 // no physical water surface connecting that plane to the hillside or bed.
 // The fragment field clips its dry portion before it writes depth.
 var sum=0.0;var count=0.0;
 for(var i=0u;i<3u;i++){let other=raster_morph(ocean_indices[id-id%3u+i]);let h=bitcast<f32>(other.key.w);if h>WATER_NONE{sum+=vertex_water_decode(h,morph_sample(other,f.lod.x).lo.w);count+=1.0;}}
 if count>0.0{return sum/count;}
 return WATER_NONE;
}
// Lakes have shorter fetch than the sea, so smaller waves. Near sea level this is the sea, unchanged.
fn water_wave_scale(level:f32)->f32{if !field_measured(){return 1.0;}return 1.0-0.8*smoothstep(8.0,20.0,abs(level-f.planet.y));}
// Levels reach over dry ground in the cells beside a shore. A wave there would stand up through it. And a wave
// breaks once it is about as high as the water is deep, so it shrinks toward the shore: full only deeper than about
// its height (f.water.x scales every amplitude), else a strong sea stands metres over a beach under centimetres.
fn water_wave_on_ground(clearance:f32)->f32{if !field_measured(){return 1.0;}return smoothstep(-1.0,max(0.5,1.2*f.water.x),clearance);}
// Whether water is the sea, from the level carried by its vertices. A fragment's position cannot say: it lies on a chord,
// under the sphere by about 50 m on a 50 km triangle, and testing it cut a lattice of holes in the far sea.
fn water_near_sea(above_sea:f32)->bool{if !field_measured(){return true;}return abs(above_sea)<8.0;}
// A level cell reaches past a dam or an outlet, over ground far below the deepest bed a lake is given. Water under sea level is a lake in a basin or a
// triangle sinking under a shore, and neither hangs over anything; the Caspian has real depths of its own.
fn water_held_up(above_sea:f32,clearance:f32)->bool{return field_measured()&&above_sea>=8.0&&clearance>LAKE_DEEPEST;}
fn ocean_surface(id:u32)->Surface{let m=raster_morph(ocean_indices[id]);let s=morph_sample(m,f.lod.x);let n=normalize(s.hi.xyz+s.lo.xyz);let level=vertex_water_level(m,s,id);
 // The draw list admits whole coastal patches. A triangle with three dry
 // vertices has no lake or sea level and must not create a depth-writing shell.
 if level<=WATER_NONE{return Surface(vec4<f32>(0,0,2,1),vec4<f32>(0),vec4<f32>(0));}
 let wave=sea_wave(s.hi.xyz,s.lo.xyz-n*s.lo.w,max(0.02,s.hi.w))*water_wave_scale(level)*water_wave_on_ground(level-s.lo.w);let p=relative(s)+n*(level-s.lo.w)+n*wave.w;return Surface(camera_clip(p),vec4<f32>(p,level+wave.w-s.lo.w),vec4<f32>(level-f.planet.y,0,0,s.hi.w));}
@vertex fn ocean_vertex(@builtin(vertex_index) id:u32)->Surface{return ocean_surface(id);}
// Interpolate bed clearance from the SAME published vertices and morph as land.
// The second channel carries this metric depth, not mesh spacing.
const LAKE_DEEPEST:f32=46.0;
struct OceanFragment {@location(0) ocean:vec2<f32>,@builtin(frag_depth) depth:f32}
@fragment fn ocean_fragment(v:Surface,@builtin(front_facing) front:bool)->OceanFragment{
 if lifted_ocean_yields(v)||water_mesh_beyond(v){discard;}
 var p=v.position.xyz;var clearance=v.position.w;var up=front;
 // A large cell of the water mesh is a chord, under the sphere by its size squared over 8R: about 100 m for a 70 km cell,
 // and over a shallow shelf the sea floor would stand over it and hide the water. Its fragment stands on the
 // sphere at its level instead: the cell decides where water is drawn, the sphere where it lies. Waves on cells this
 // large are filtered to nothing (sea_wave at the cell's spacing). Before the shore's clip: at a grazing angle the chord's point lies
 // kilometres farther along the ray than the water's, past a far coast, and the clip took sea for land there.
 if v.normal.y>0.5{let chord=v.normal.w*v.normal.w/(8.0*f.planet.x);
  // Its facing is the sphere's too: a cell just past the horizon is seen from under its own chord, and its back face
  // would be shaded as water seen from below, dark slivers along the sea's horizon (Test-Solar-Water-Match
  // lisbon: back faces at 250 km with 3.5 km of sea under them).
  if chord>0.02{let rd=normalize(p);let s=sphere(rd,f.planet.y+v.normal.x);if s.x>0.0{p=mix(p,rd*s.x,smoothstep(0.02,0.2,chord));up=f.eye_hi.w>f.planet.y+v.normal.x;}}}
 if field_measured(){
  let at=page_pos(f.eye_hi.xyz,f.eye_lo.xyz+f.eye_tail.xyz+p);
  // The water mesh clips at the shore of a page matched to the pixel, the sharpest shore there is: a page matched to its
  // cells (metres wide far out) would leave the skirts of shore cells standing as walls beside a river at distance, a
  // raised ribbon. The lifted ocean keeps its vertices' page.
  let entry=measured_water_entry(at,select(max(.25,v.normal.w*.125),max(.02,length(p)*f.view.w/f.view.y*.25),v.normal.y>0.5));
  // Clip the actual depth-writing surface, not just its later water colour.
  // Otherwise a dry triangle can still occlude the bank and nearby buildings.
  // On a page with water texels the surface lies under dry ground already; the
  // finer page clips what the coarser mesh spread past the shore.
  // The water layer clips at the shore, keeping a pixel's width beyond it for the water pass to cover in part.
  let lw=water_layer_entry(entry,at.face,at.g);
  // As far as the water pass's coverage reaches past the shore: a pixel, or half the swash band (water_layer_coverage).
  if lw!=0u{
   let water=water_layer_at(lw,at);
   if water.sdf>max(0.5*WATER_SWASH,length(p)*2.0*f.view.w/f.view.y){discard;}
   // Inland proxies only provide raster coverage. Their interpolated height
   // is not a surface: a lake/shore or LOD boundary can differ by metres.
   // Intersect the view ray with the canonical level sphere, resample at the
   // hit, then include waves. This also works at grazing angles and below water.
   if water.kind>=2u||abs(water.level-f.planet.y)>8.0{
    let rd=normalize(p);var level=water.level;
    for(var j=0u;j<3u;j++){
     if level<=WATER_NONE{discard;}
     let radial=normalize(f.eye_hi.xyz+f.eye_lo.xyz+p);
     let h=sc_radial_height(p);let base=f.eye_lo.xyz+p-radial*h;
     let ground=surface_height_only(p,1.0);
     let wave=sea_wave(f.eye_hi.xyz,base,max(0.4,length(p)*f.view.w/f.view.y)).w*water_wave_scale(level)*water_wave_on_ground(level-ground);
     let hit=sphere(rd,level+wave);let distance=select(hit.x,hit.y,f.eye_hi.w<level+wave);
     if distance<=0.0{discard;}p=rd*distance;
     let q=page_pos(f.eye_hi.xyz,f.eye_lo.xyz+f.eye_tail.xyz+p);
     let e=measured_water_entry(q,max(0.4,length(p)*f.view.w/f.view.y*.25));let we=water_layer_entry(e,q.face,q.g);
     if we==0u{discard;}let w=water_layer_at(we,q);
     if w.level<=WATER_NONE||w.sdf>max(0.5*WATER_SWASH,length(p)*2.0*f.view.w/f.view.y){discard;}
     level=w.level;
    }
    clearance=sc_radial_height(p)-surface_height_only(p,1.0);
    up=dot(rd,normalize(f.eye_hi.xyz+f.eye_lo.xyz+p))<0.0;
   }
  }
  else if entry!=0u{if page_water_texels(entry){if page_surface_read(entry,at.g,at.frac).w< -0.05{discard;}}else if page_water(entry,at.face,at.g)<=WATER_NONE{discard;}}
 }
 if water_held_up(v.normal.x,clearance){discard;}
 // Writing fragment depth disables early depth rejection, so a sea sphere
 // under land ran the full coastal evaluation for every hidden fragment.
 // Compare against the opaque surface position first: a fragment farther than
 // it by more than this triangle's chord sag can never win the depth test,
 // and returns its proxy depth untouched. Far coasts keep the exact proxy.
 let pixel=vec2<i32>(v.clip.xy);let opaque=textureLoad(positions,pixel,0);
 let sag=v.normal.w*v.normal.w/(8.0*f.planet.x)*2.0+1.0;
 let behind=select(1.0,0.99999,lifted_ocean_behind(v));
 if dot(opaque.xyz,opaque.xyz)>0.01&&length(p)>length(opaque.xyz)+sag{return OceanFragment(vec2<f32>(select(-1.0,1.0,up)*length(p),clearance),clamp(0.1/dot(p,f.forward.xyz),0.0,1.0)*behind);}
 if up&&surface_detail_weight(p)>0.0&&water_near_sea(v.normal.x){
  let coast=surface_coast(p);if coast.weight>0.0{p=mix(p,normalize(p)*coast.sea_distance,coast.weight);clearance=mix(clearance,f.planet.y-coast.height,coast.weight);}
 }
 let relief=select(surface_relief_weight(p),0.0,water_diagnostic(524288u));
 if up&&relief>0.0{
  let detail=surface_detail_sample(p,surface_detail_footprint(p));
  clearance=mix(clearance,sc_radial_height(p)-detail.height,relief);
 }
 // Coverage never changes visibility. Reverse depth 1 put distant coast
 // proxies in front of mountains/props and let draw order select the ocean.
 return OceanFragment(vec2<f32>(select(-1.0,1.0,up)*length(p),clearance),clamp(0.1/dot(p,f.forward.xyz),0.0,1.0)*behind);
}
// Rasterize just the slab between the optical center and the normal near plane.
// Increasing depth selects the LAST crossing before the visible ray starts.
// This gives the medium of the actual triangles, including displaced waves.
@vertex fn ocean_cap_vertex(@builtin(vertex_index) id:u32)->Surface{var s=ocean_surface(id);s.clip.z=(0.1/0.0999)*(s.clip.w-0.0001);return s;}
// The lifted ocean (terrain triangles, normal.y 0) gives way to the water mesh (normal.y 1) within its reach. Close up,
// where the mesh's cells are flat chords no thicker than 2 cm, it yields wherever the layer holds at its own page: the
// mesh keeps every cell near water whose page carries the layer, and water_layer_entry answers both alike (the finest
// resident page where the page and the coarser ones walked do not; without that rule, rings of deep sea with no surface
// appear from 5 to 200 km). Farther, a cell's triangles and its fragments' places on the sphere fall in
// different cells at a grazing angle, so no test of the place can say what the mesh drew: there both draw, the lifted
// ocean pushed back a hair (lifted_ocean_behind), and the mesh, on the sphere and nearer than any chord, wins wherever
// it drew. The lifted ocean fills only what it left.
fn lifted_ocean_yields(v:Surface)->bool{
 if v.normal.y>0.5||!field_measured(){return false;}
 let reach=water_mesh_reach(v.position.xyz);if reach>=water_mesh_limit()||(water_mesh_far(reach)&&!water_diagnostic(2097152u)){return false;}
 let at=page_pos(f.eye_hi.xyz,f.eye_lo.xyz+f.eye_tail.xyz+v.position.xyz);let entry=measured_water_entry(at,max(.25,v.normal.w*.125));
 return water_layer_entry(entry,at.face,at.g)!=0u;
}
fn lifted_ocean_behind(v:Surface)->bool{return v.normal.y<0.5&&field_measured()&&water_mesh_reach(v.position.xyz)<water_mesh_limit();}
// Whether the mesh's cells at a reach (key units, water_mesh_reach) are large enough to stand on the sphere: the ring
// whose cells hold it is at most the one that reaches n/2 - 2 steps that far, and its chord sags more than 2 cm
// (ocean_fragment). Conservative by one ring: a point in a finer ring's square counts as far a little early.
fn water_mesh_far(reach:f32)->bool{
 let step=f32(WATER_STEP0)*exp2(ceil(log2(max(reach,1.0)/(f32(WATER_RING_CELLS/2-2)*f32(WATER_STEP0)))));
 let size=step*f.planet.x/f32(Q)*1.41421356;return size*size/(8.0*f.planet.x)>0.02;
}
// The water mesh's own fragments stop where its rings do (water_mesh_reach), the same test the lifted ocean starts at.
fn water_mesh_beyond(v:Surface)->bool{return v.normal.y>0.5&&water_mesh_reach(v.position.xyz)>=water_mesh_limit();}
@fragment fn ocean_cap_fragment(v:Surface,@builtin(front_facing) front:bool)->@location(0) f32{
 if lifted_ocean_yields(v)||water_mesh_beyond(v){discard;}
 if field_measured(){
  let at=page_pos(f.eye_hi.xyz,f.eye_lo.xyz+f.eye_tail.xyz+v.position.xyz);
  let entry=measured_water_entry(at,max(.02,length(v.position.xyz)*f.view.w/f.view.y*.25));
  let lw=water_layer_entry(entry,at.face,at.g);
  if lw!=0u&&water_layer_at(lw,at).sdf>0.5*WATER_SWASH{discard;}
 }
 return select(-1.0,1.0,front);
}
// ---- The water mesh (docs/WATER-LAYER.md, phase 3b): triangles of the water's own, not the terrain's. Camera-centred
// rings on the cube face chart under the eye, each world-anchored to its own grid (snapped to twice its step, so its
// vertices never slide under the water as the eye moves), generated from the vertex index alone. Ring k holds
// WATER_RING_CELLS x WATER_RING_CELLS cells of WATER_STEP0 << k key units (16 units: about 0.38 m at a face centre; the
// gnomonic chart carries a ring past the face edge), leaves its middle to ring k - 1, and over its outer
// WATER_MORPH_CELLS cells moves odd vertices onto their even neighbours by the eye's distance, so that at its border
// it is the coarser ring's grid and the two meet without cracks. A cell farther from any water than its own size, or
// whose page carries no water layer, or past WATER_MESH_LIMIT or the horizon, is dropped (all six vertices at the clip
// origin: no area). Vertices take the water layer's level, read at a page about their spacing, and the waves. The
// fragment is ocean_fragment, clipped at the layer's shore; the lifted ocean draws only where this mesh does not.
const WATER_RINGS:u32=18u;
const WATER_RING_CELLS:i32=48;
const WATER_STEP0:i32=16;
const WATER_MORPH_CELLS:f32=6.0;
// The mesh draws within this Chebyshev distance of the eye in the eye's face chart, key units (its outermost ring less
// two cells: about 1,100 km at a face centre); the lifted ocean beyond it, and wherever a page carries no water layer.
// A flat cell sags under the sphere by its size squared over 8R (about 100 m for the 70 km cells of the eighteenth
// ring); its fragments stand on the sphere (ocean_fragment), so over a shallow shelf the sea floor does not hide it.
// A ring snapped to twice its step reaches at least n/2 - 2 steps past the eye on every side.
const WATER_MESH_LIMIT:f32=f32((WATER_RING_CELLS/2-2)*(WATER_STEP0<<(WATER_RINGS-1u)));
// The reach in force: WATER_MESH_LIMIT, or the first twelve rings' with the attribution bit 131072.
fn water_mesh_limit()->f32{return select(WATER_MESH_LIMIT,f32((WATER_RING_CELLS/2-2)*(WATER_STEP0<<11u)),water_diagnostic(131072u));}
// Chart axes of a face, as cube_key places them: key (u, v) on face f is axis * Q + eu * u + ev * v.
fn face_axes(face:u32)->mat3x3<f32>{switch face{case 0u:{return mat3x3<f32>(vec3<f32>(1,0,0),vec3<f32>(0,0,-1),vec3<f32>(0,1,0));}case 1u:{return mat3x3<f32>(vec3<f32>(-1,0,0),vec3<f32>(0,0,1),vec3<f32>(0,1,0));}case 2u:{return mat3x3<f32>(vec3<f32>(0,1,0),vec3<f32>(1,0,0),vec3<f32>(0,0,-1));}case 3u:{return mat3x3<f32>(vec3<f32>(0,-1,0),vec3<f32>(1,0,0),vec3<f32>(0,0,1));}case 4u:{return mat3x3<f32>(vec3<f32>(0,0,1),vec3<f32>(1,0,0),vec3<f32>(0,1,0));}default:{return mat3x3<f32>(vec3<f32>(0,0,-1),vec3<f32>(-1,0,0),vec3<f32>(0,1,0));}}}
// Chebyshev distance, in key units, from the eye to a point (relative to the eye) in the eye's face chart; very large
// for a point on the far side of that chart's hemisphere.
fn water_mesh_reach(p:vec3<f32>)->f32{
 let eye=water_mesh_eye();let a=face_axes(u32(eye.x));let d=f.eye_hi.xyz+f.eye_lo.xyz+p;let h=dot(d,a[0]);
 if h<=0.05*length(d){return 1e30;}
 return max(abs(dot(d,a[1])/h*f32(Q)-f32(eye.y)),abs(dot(d,a[2])/h*f32(Q)-f32(eye.z)));
}
fn floor_div(a:i32,b:i32)->i32{let q=a/b;return select(q,q-1,(a%b!=0)&&(a<0));}
// The eye's face and chart position in key units (cube_key: -Q..Q across a face).
fn water_mesh_eye()->vec3<i32>{let pos=page_pos(f.eye_hi.xyz,f.eye_lo.xyz);return vec3<i32>(i32(pos.face),2*i32(pos.g.x)-Q,2*i32(pos.g.y)-Q);}
struct WaterMeshPoint {p:vec3<f32>,level:f32,clearance:f32,known:bool,sdf:f32,cell:f32}
// A point of the water surface at a chart key: position relative to the eye, displaced by level and waves. Its spacing
// (the footprint of its waves and of the page it reads) is a function of the key and the grid step alone, never of the
// cell asking: two cells, or two rings, sharing a vertex then compute the same point bit for bit. A step between
// step and 2 * step (the morph toward the coarser ring) reads as that blend, exactly the coarser ring's at 2 * step.
// A key whose page carries no water layer (no slot in the water atlas, or not resident) stands at the level its cell's
// middle found, with no waves. Standing at the eye (a zero position), the cell's triangles would run from the camera
// to the cell, and wherever the layer under one of their pixels said water, water would be drawn in the air: dark
// slivers over the sea's horizon and water in front of hills (Test-Solar-Water-Match lisbon).
fn water_mesh_point(face:u32,key:vec2<i32>,step:f32,fallback:f32)->WaterMeshPoint{
 let s=base_position(cube_key(face,key.x,key.y));let n=normalize(s.hi.xyz+s.lo.xyz);let base=Sample(s.hi,s.lo,s.normal);
 let pos=page_pos(s.hi.xyz,s.lo.xyz);let spacing=step*f.planet.x/f32(Q)*page_metric(pos.uv)*1.41421356;let entry=measured_water_entry(pos,spacing*0.5);let we=water_layer_entry(entry,pos.face,pos.g);
 if we==0u{return WaterMeshPoint(relative(base)+n*fallback,fallback,0.0,false,1e9,spacing);}
 let w=water_layer_at(we,pos);let ground=page_height_read(we,pos.g,pos.frac).x;
 // A vertex with no water stands under its ground, and never over its cell's water: on a steep bank its ground is metres
 // above the river, and the cell's triangle would climb the hillside just under the true surface, where a coarser
 // terrain LOD sags below it: slanted sheets of water up the valley sides at distance.
 // Such a vertex lies past the shore, so its triangles are clipped there and a crack at it cannot show.
 var level=w.level;if level<=WATER_NONE{level=min(ground-1.0,fallback);}
 let wave=sea_wave(s.hi.xyz,s.lo.xyz,max(0.02,spacing))*water_wave_scale(level)*water_wave_on_ground(level-ground);
 let p=relative(base)+n*(level+wave.w);
 return WaterMeshPoint(p,level,level+wave.w-ground,true,w.sdf,w.cell);
}
// Whether any water lies within a cell: the layer's distance at its middle against half its diagonal and two texels.
// No waves, one page read. Also the cell's size in metres from the chart's metric there, and its middle's level: the
// level of a vertex whose own page carries no layer (water_mesh_point).
struct WaterMeshCell {keep:bool,size:f32,level:f32}
fn water_mesh_cell(face:u32,centre:vec2<i32>,step:i32)->WaterMeshCell{
 let s=base_position(cube_key(face,centre.x,centre.y));let pos=page_pos(s.hi.xyz,s.lo.xyz);
 let size=f32(step)*f.planet.x/f32(Q)*page_metric(pos.uv)*1.41421356;
 let entry=measured_water_entry(pos,size*0.5);let we=water_layer_entry(entry,pos.face,pos.g);if we==0u{return WaterMeshCell(false,size,0.0);}
 let w=water_layer_at(we,pos);let keep=w.sdf<0.5*size+2.0*w.cell;var level=w.level;
 if keep&&level<=WATER_NONE{level=page_height_read(we,pos.g,pos.frac).x-1.0;}
 return WaterMeshCell(keep,size,level);
}
fn water_mesh_surface(id:u32)->Surface{
 let none=Surface(vec4<f32>(0),vec4<f32>(0),vec4<f32>(0));
 // A body without measured pages has no water layer: the lifted ocean draws all of its water.
 if !field_measured(){return none;}
 let n=WATER_RING_CELLS;let cells=u32(n*n);let ring=id/(cells*6u);if ring>=WATER_RINGS||(ring>=12u&&water_diagnostic(131072u)){return none;}
 let rem=id%(cells*6u);let cell=i32(rem/6u);let corner=rem%6u;let ci=cell%n;let cj=cell/n;
 let eye=water_mesh_eye();let face=u32(eye.x);let step=WATER_STEP0<<ring;let e=vec2<i32>(eye.y,eye.z);
 let origin=vec2<i32>(floor_div(e.x,2*step),floor_div(e.y,2*step))*2*step-vec2<i32>(n/2*step);
 let c0=origin+vec2<i32>(ci,cj)*step;
 // Rings and cells past the horizon or the mesh's limit go before any page is read: a ring whose hole is wider than
 // the horizon, a cell whose middle lies past the limit or below the horizon by more than its own angle.
 let up=normalize(f.eye_hi.xyz+f.eye_lo.xyz);let altitude=max(f.eye_hi.w,1.0);let horizon=sqrt(2.0*f.planet.x*altitude+altitude*altitude);
 let unit=f.planet.x/f32(Q);if ring>0u&&f32(n/4*step)*unit*0.7>horizon*1.5+2000.0{return none;}
 let cm=c0+vec2<i32>(step/2);if f32(max(abs(cm.x-e.x),abs(cm.y-e.y)))>=water_mesh_limit()+f32(step){return none;}
 let a=face_axes(face);let cd=normalize(a[0]*f32(Q)+a[1]*f32(cm.x)+a[2]*f32(cm.y));
 let below=acos(clamp(dot(cd,up),-1.0,1.0))-acos(clamp(f.planet.x/(f.planet.x+altitude),-1.0,1.0));if below>2.0*f32(step)/f32(Q)+0.002{return none;}
 // The middle belongs to the finer ring.
 if ring>0u{let fs=step/2;let fo=vec2<i32>(floor_div(e.x,2*fs),floor_div(e.y,2*fs))*2*fs-vec2<i32>(n/2*fs);
  if all(c0>=fo)&&all(c0+vec2<i32>(step)<=fo+vec2<i32>(n*fs)){return none;}}
 // The cell: dropped where no water is within its size, where no page carries the layer, or past the reach.
 let probe=water_mesh_cell(face,c0+vec2<i32>(step/2),step);if !probe.keep{return none;}let size=probe.size;
 // The vertex, morphed toward its even neighbour over the ring's outer cells.
 let corners=array<vec2<i32>,6>(vec2<i32>(0,0),vec2<i32>(1,0),vec2<i32>(0,1),vec2<i32>(1,0),vec2<i32>(1,1),vec2<i32>(0,1));
 let ij=vec2<i32>(ci,cj)+corners[corner];let key=origin+ij*step;let spacing=size;
 // The morph is complete two cells inside the ring's edge: snapped to twice its step, a ring reaches only n/2 - 2 steps
 // past the eye on its far side, and there its border vertices must already be the coarser ring's (Test-Earth-Sea-Cover:
 // a few hundred pixels with no water at 10-100 m over the sea, along ring borders).
 let reach=max(abs(f32(key.x-e.x)),abs(f32(key.y-e.y)))/f32(step);var alpha=clamp((reach-(f32(n/2-2)-WATER_MORPH_CELLS))/WATER_MORPH_CELLS,0.0,1.0);
 if ring+1u>=WATER_RINGS{alpha=0.0;}
 let morph_step=mix(f32(step),f32(2*step),alpha);
 var point=water_mesh_point(face,key,morph_step,probe.level);
 let odd=vec2<i32>(ij.x&1,ij.y&1);
 if alpha>0.0&&any(odd!=vec2<i32>(0)){let other=water_mesh_point(face,key-odd*step,morph_step,probe.level);point.p=mix(point.p,other.p,alpha);point.level=mix(point.level,other.level,alpha);point.clearance=mix(point.clearance,other.clearance,alpha);}
 let p=point.p;
 return Surface(camera_clip(p),vec4<f32>(p,point.clearance),vec4<f32>(point.level-f.planet.y,1.0,0,spacing));
}
@vertex fn water_mesh_vertex(@builtin(vertex_index) id:u32)->Surface{return water_mesh_surface(id);}
@vertex fn water_mesh_cap_vertex(@builtin(vertex_index) id:u32)->Surface{var s=water_mesh_surface(id);s.clip.z=(0.1/0.0999)*(s.clip.w-0.0001);return s;}


@group(0) @binding(5) var positions:texture_2d<f32>;
@group(0) @binding(6) var normals:texture_2d<f32>;
@group(0) @binding(7) var shade_out:texture_storage_2d<rgba16float,write>;
@group(0) @binding(8) var shaded:texture_2d<f32>;
@group(0) @binding(9) var water_out:texture_storage_2d<rgba16float,write>;
@group(0) @binding(10) var water_in:texture_2d<f32>;
@group(0) @binding(11) var cloud_out:texture_storage_2d<rgba16float,write>;
@group(0) @binding(12) var cloud_guide_out:texture_storage_2d<rgba32float,write>;
@group(0) @binding(13) var clouds:texture_2d<f32>;
@group(0) @binding(14) var cloud_guide:texture_2d<f32>;
@group(0) @binding(15) var history:texture_2d<f32>;
@group(0) @binding(16) var history_guide:texture_2d<f32>;
@group(0) @binding(17) var atmosphere_out:texture_storage_2d<rgba16float,write>;
@group(0) @binding(18) var atmosphere:texture_2d<f32>;
// The frame in linear light, before exposure: the finish (finish.wgsl) makes the display image from it.
@group(0) @binding(19) var hdr_out:texture_storage_2d<rgba16float,write>;
@group(0) @binding(27) var ocean_depth:texture_2d<f32>;
@group(0) @binding(44) var ocean_cap:texture_2d<f32>;
// The space layer: stars, the Sun, every body not in full detail, and how far the nearest is.
@group(0) @binding(120) var space_color:texture_2d<f32>;
@group(0) @binding(121) var space_distance:texture_2d<f32>;
@group(0) @binding(122) var space_active:texture_2d<f32>;
fn view_ray(pixel:vec2<f32>)->vec3<f32> {let uv=pixel/f.view.xy*2.0-1.0;return normalize(f.forward.xyz+f.right.xyz*uv.x*f.view.z*f.view.w-f.up.xyz*uv.y*f.view.w);}
fn ray(pixel:vec2<f32>)->vec3<f32>{return view_ray(pixel+f.temporal.xy);}
fn sphere(rd:vec3<f32>,height:f32)->vec2<f32>{let b=dot(f.eye_hi.xyz+f.eye_lo.xyz,rd);let c=(f.eye_hi.w-height)*(2.0*f.planet.x+f.eye_hi.w+height);let det=b*b-c;if det<0.0{return vec2<f32>(-1.0);}let s=sqrt(det);if s==0.0{return vec2<f32>(-b);}let far=-b+select(-s,s,b<0.0);let near=c/far;return vec2<f32>(min(near,far),max(near,far));}
fn sea_distance(rd:vec3<f32>)->f32 {let r=sphere(rd,f.planet.y);if r.x>0.0{return r.x;}if r.y>0.0&&f.eye_hi.w<f.planet.y{return r.y;}return 1e12;}
fn ground_distance(pixel:vec2<i32>)->f32{let p=textureLoad(positions,pixel,0);if dot(p.xyz,p.xyz)<0.01{return 1e12;}return length(p.xyz);}
fn raster_sea(pixel:vec2<i32>)->f32{let t=abs(textureLoad(ocean_depth,pixel,0).r);return select(1e12,t,t>0.0);}
fn visible_limit(pixel:vec2<i32>,medium:f32)->f32{
 let ground=ground_distance(pixel);
 // A mapped interface filling a gap in the raster carries its distance in
 // the unused part of the half-float alpha range, shared with clouds and TAA.
 if f.options.z>0.5&&medium>=3.0{let d=(medium-3.0)*10.0;return d*d;}
 // An air ray carries 1 + accepted interface coverage. Rejected proxies
 // leave the sky and aerial perspective at their actual opaque depth.
 if f.options.z>0.5&&(medium>1.0||medium<0.5){return min(ground,raster_sea(pixel));}return ground;
}
fn daylight(radial:vec3<f32>)->f32{return smoothstep(-0.18,0.08,dot(radial,f.sun.xyz));}
fn sun_disk(rd:vec3<f32>)->vec3<f32>{return vec3<f32>(18.0,15.0,10.0)*smoothstep(0.99991,0.99995,dot(rd,f.sun.xyz))*f.solar.z;}
fn sky(rd:vec3<f32>)->vec3<f32> {
 let n=normalize(f.eye_hi.xyz+f.eye_lo.xyz);let mu=dot(rd,n);let day=daylight(n);let height=max(0.0,f.eye_hi.w);
 let blue=mix(f.sky_low.xyz,f.sky_high.xyz,sqrt(max(0.0,mu)));
 let sunset=vec3<f32>(0.8,0.27,0.06)*pow(max(0.0,dot(rd,f.sun.xyz)),6.0)*exp(-abs(mu)*5.0)*exp(-abs(dot(n,f.sun.xyz))*7.0);
 let sun=sun_disk(rd);
 return (blue*day+sunset)*exp(-height/f.atmosphere.w)+sun;
}
fn terrain_albedo(base_lo:vec3<f32>,height:f32,slope:f32,footprint:f32,grain:f32)->vec3<f32>{
 let macro_noise=noise_gradient(f.eye_hi.xyz,base_lo,128.0,bitcast<u32>(f.geo.z)+37u).w*filter_weight(128.0,footprint)*0.6+noise_gradient(f.eye_hi.xyz,base_lo,262144.0,bitcast<u32>(f.geo.z)+39u).w*filter_weight(262144.0,footprint)*0.4;
 let strata=0.5+0.5*sin(height*0.14+macro_noise*3.0)*exp(-footprint*0.035);let lithology=0.5+0.5*macro_noise;
 if f.solar.w>0.5{
  var colour=mix(vec3<f32>(.15,.16,.18),vec3<f32>(.40,.39,.37),lithology);
  if f.solar.w>1.5{colour=mix(vec3<f32>(.26,.12,.06),vec3<f32>(.56,.28,.12),lithology);}
  if f.solar.w>2.5{colour=mix(vec3<f32>(.19,.34,.43),vec3<f32>(.72,.83,.87),lithology);}
  return colour*mix(.72,1.12,strata)*(1.0+grain);
 }
 let basalt=vec3<f32>(0.20,0.22,0.23);let sandstone=vec3<f32>(0.43,0.28,0.16);var albedo=mix(basalt,sandstone,lithology)*mix(0.65,1.15,strata);
 albedo=mix(albedo,vec3<f32>(0.085,0.14,0.045),0.6*smoothstep(0.77,0.95,slope)*smoothstep(f.planet.y+4.0,f.planet.y+80.0,height)*(1.0-smoothstep(1100.0,2400.0,height)));
 albedo=mix(albedo,vec3<f32>(0.38,0.34,0.29),exp(-abs(height-f.planet.y-2.0)/6.0)*smoothstep(0.5,0.9,slope));
 albedo=mix(albedo,vec3<f32>(0.77,0.83,0.88),smoothstep(3800.0,5800.0,height+500.0*macro_noise)*smoothstep(0.55,0.92,slope));
 albedo*=1.0+grain;let wet=exp(-abs(height-f.planet.y)/2.0);albedo*=1.0-0.35*wet;return albedo;
}
// Terrain shading is split so that `shade_initial` (no sunlight query) can
// compile in a fraction of the time and shade the first image while the
// deferred `shade` program with terrain, prop and cloud shadows compiles.
struct ShadePoint {xy:vec2<i32>,p:vec4<f32>,n:vec3<f32>,radial:vec3<f32>,albedo:vec3<f32>,cover:vec2<f32>,slope:f32,wet:f32,direct:f32,footprint:f32,height:f32,cached_w:f32,valid:bool}
fn shade_prepare(id:vec3<u32>)->ShadePoint{
 var s:ShadePoint;s.valid=false;
 if any(id.xy>=vec2<u32>(f.view.xy)){return s;}let xy=vec2<i32>(id.xy);let p=textureLoad(positions,xy,0);let r=ray(vec2<f32>(id.xy)+0.5);if dot(p.xyz,p.xyz)<0.01{textureStore(shade_out,xy,vec4<f32>(0,0,0,1));return s;}
 let cached=textureLoad(normals,xy,0);if cached.w< -100.0{return s;}let radial=normalize(f.eye_hi.xyz+(f.eye_lo.xyz+p.xyz));
 // Shading is a filtered evaluation of the canonical heightfield. Subtracting
 // a single interpolated mesh spacing from a normalized, blended mesh normal
 // is not a complementary filter: changing LOD would change lighting at the seams.
 // The spherical parameter footprint and all bands below are independent of
 // patch level, publication clock and normal interpolation. Geometry still
 // moves normally and remains available in the separate position diagnostic.
 let footprint=max(0.008,length(p.xyz)*2.0*f.view.w/f.view.y/max(0.15,abs(dot(radial,r))));
 let detail=surface_detail_sample(p.xyz,footprint);let base_lo=detail.base;let grain=detail.grain;let n=detail.normal;
 let slope=clamp(dot(n,radial),0.0,1.0);var albedo=vec3<f32>(0);if field_measured(){albedo=measured_surface_albedo(p.xyz,detail.height,slope,footprint);}else{albedo=terrain_albedo(base_lo,p.w,slope,footprint,grain);}let wet=exp(-abs(p.w-f.planet.y)/2.0);
 var lit=n;if field_measured(){lit=normalize(n-(field_material_bump-radial*dot(field_material_bump,radial)));}
 let road=urban_road(f.eye_hi.xyz,f.eye_lo.xyz+p.xyz+f.eye_tail.xyz,footprint);albedo=mix(albedo,road.rgb,road.a);lit=normalize(mix(lit,n,road.a));
 let direct=max(0.0,dot(lit,f.sun.xyz));var cover=vec2<f32>(0);if !field_measured(){cover=sc_ground_cover(p.xyz,p.w,slope,footprint);}
 s.xy=xy;s.p=p;s.n=n;s.radial=radial;s.albedo=albedo;s.cover=cover;s.slope=slope;s.wet=wet;s.direct=direct;s.footprint=footprint;s.height=detail.height;s.cached_w=cached.w;s.valid=true;
 return s;
}
fn shade_finish(s:ShadePoint,visibility:SunVisibility){
 let horizon=sun_direct(visibility);let ambient=vec3<f32>(0.21,0.27,0.34)*f.body_detail.yzw*f.solar.y*(0.3+0.7*sqrt(s.slope));let day=daylight(s.radial);
 var color=s.albedo*(ambient*day+vec3<f32>(1.8,1.55,1.3)*f.starlight.xyz*s.direct*horizon);
 let leaf_light=sc_canopy_color*(vec3<f32>(0.19,0.24,0.29)*day+vec3<f32>(1.8,1.55,1.3)*f.starlight.xyz*0.65*horizon);
 let stone_light=vec3<f32>(0.30,0.27,0.22)*(ambient*day+vec3<f32>(1.8,1.55,1.3)*f.starlight.xyz*s.direct*horizon)*(1.0-0.35*s.wet);
 color=mix(mix(color,stone_light,s.cover.y),leaf_light,s.cover.x);
 color=sun_diagnostic(color,visibility);
 if f.options.w>=4.0&&field_measured(){color=measured_diagnostic(s.p.xyz,s.footprint);}
 if f.options.w==1.0{color=s.n*0.5+0.5;}if f.options.w==2.0{color=vec3<f32>(fract(s.cached_w/5.0),0.2,0.8);}if f.options.w==3.0{color=vec3<f32>(log2(1.0+length(s.p.xyz))/24.0);}
 textureStore(shade_out,s.xy,vec4<f32>(color,1.0-field_water_here));
}
@compute @workgroup_size(8,8)
fn shade(@builtin(global_invocation_id) id:vec3<u32>){
 let s=shade_prepare(id);if !s.valid{return;}
 // Direct light only reaches sun-facing ground or translucent canopy cover.
 // Back-facing bare ground skips the whole visibility query; the result is
 // exactly the same colour because every direct term is multiplied by zero.
 var visibility=SunVisibility(0.0,1.0,0.0);
 if s.direct>0.0||s.cover.x>0.0||sf.control.y>0.0{visibility=sunlight_ground(s.p.xyz,s.n,s.footprint,s.height);}
 shade_finish(s,visibility);
}
// First-image shading while the shadow programs compile: fully lit.
@compute @workgroup_size(8,8)
fn shade_initial(@builtin(global_invocation_id) id:vec3<u32>){
 let s=shade_prepare(id);if !s.valid{return;}
 shade_finish(s,SunVisibility(1.0,1.0,0.0));
}
@compute @workgroup_size(8,8)
fn atmosphere_lut(@builtin(global_invocation_id) id:vec3<u32>){let size=textureDimensions(atmosphere_out);if any(id.xy>=size){return;}let height=f32(id.y)/f32(size.y-1u)*f.atmosphere.x;let mu=f32(id.x)/f32(size.x-1u)*2.0-1.0;let radius=f.planet.x+height;let rd=vec3<f32>(sqrt(max(0.0,1.0-mu*mu)),mu,0);let origin=vec3<f32>(0,radius,0);let b=radius*mu;let c=(height-f.atmosphere.x)*(2.0*f.planet.x+height+f.atmosphere.x);let end=max(0.0,-b+sqrt(max(0.0,b*b-c)));var rayleigh=0.0;var mie=0.0;
 for(var i=0u;i<64u;i++){let t=(f32(i)+0.5)/64.0*end;let h=max(0.0,length(origin+rd*t)-f.planet.x);rayleigh+=exp(-h/f.atmosphere.y)*end/64.0;mie+=exp(-h/f.atmosphere.z)*end/64.0;}
 textureStore(atmosphere_out,vec2<i32>(id.xy),vec4<f32>(min(rayleigh,65000.0),min(mie,65000.0),0,1));
}
fn optical(rd:vec3<f32>)->vec2<f32>{let n=normalize(f.eye_hi.xyz+f.eye_lo.xyz);let uv=vec2<f32>(dot(n,rd)*0.5+0.5,clamp(f.eye_hi.w/f.atmosphere.x,0.0,1.0));let size=textureDimensions(atmosphere);let q=uv*vec2<f32>(size-1u);let a=vec2<i32>(q);let b=min(a+1,vec2<i32>(size)-1);let w=fract(q);return mix(mix(textureLoad(atmosphere,a,0).xy,textureLoad(atmosphere,vec2<i32>(b.x,a.y),0).xy,w.x),mix(textureLoad(atmosphere,vec2<i32>(a.x,b.y),0).xy,textureLoad(atmosphere,b,0).xy,w.x),w.y);}
fn aerial(rd:vec3<f32>,limit:f32,color:vec3<f32>)->vec3<f32>{
 let shell=sphere(rd,f.atmosphere.x);let start=max(0.0,shell.x);let end=min(shell.y,limit);if end<=start{return color;}
 let steps=max(1u,u32(f.quality.x));let ds=(end-start)/f32(steps);var T=vec3<f32>(1);var light=vec3<f32>(0);let mu=dot(rd,f.sun.xyz);let phase=0.75*(1.0+mu*mu);let beta=f.atmosphere_beta.xyz;
 for(var i=0u;i<steps;i++){let p=f.eye_hi.xyz+(f.eye_lo.xyz+rd*(start+(f32(i)+0.5)*ds));let h=max(0.0,length(p)-f.planet.x);let radial=normalize(p);let day=smoothstep(-0.08,0.04,dot(radial,f.sun.xyz));let density=exp(-h/f.atmosphere.y);let tr=exp(-beta*density*ds);light+=T*(1.0-tr)*f.air_scatter.xyz*phase*day;T*=tr;}
 return color*T+light;
}
@compute @workgroup_size(8,8)
fn composite(@builtin(global_invocation_id) id:vec3<u32>){if any(id.xy>=vec2<u32>(f.view.xy)){return;}let xy=vec2<i32>(id.xy);let rd=ray(vec2<f32>(id.xy)+0.5);
 let water_sample=select(vec4<f32>(textureLoad(shaded,xy,0).rgb,1.0),textureLoad(water_in,xy,0),f.options.z>0.5);var limit=visible_limit(xy,water_sample.a);
 // A body nearer than the surface at this pixel hides it, and the air beyond that body does not reach the eye.
 var space=vec3<f32>(0);var temporalDistance=limit;var reactive=water_sample.a!=1.0;var ahead=false;if f.solar.x>0.5{space=textureLoad(space_color,xy,0).rgb;let d=textureLoad(space_distance,xy,0).r;if d>0.0{temporalDistance=min(limit,d);}if d>0.0&&d<limit&&limit<1e10{ahead=true;limit=d;}}
 // Without the water pass (disabled, or its programs still compiling at
 // startup) the shaded surface is the colour and the water target is stale.
 let submerged=water_sample.a<0.5;var color=water_sample.rgb;let background=limit>1e10;
 if background && !submerged {color=select(vec3<f32>(0.001,0.002,0.004),sky(rd),f.options.x>0.5)+space;}
 if ahead{color=space;}
 // Startup placeholder while the sea programs compile: a flat sea over the
 // submerged bed, replaced by the water pass as soon as it exists.
 if (f.tier_d.w&1u)!=0u&&!background{let bed=textureLoad(positions,xy,0);let depth=f.planet.y-bed.w;if depth>0.0{let up=normalize(f.eye_hi.xyz+f.eye_lo.xyz+bed.xyz);let light=0.2+0.8*max(0.0,dot(up,f.sun.xyz));color=mix(color,vec3<f32>(0.01,0.045,0.075)*light,1.0-exp(-depth*0.1));}}
 if f.options.x>0.5&&!submerged {let lut_trans=exp(-optical(rd).x*f.atmosphere_beta.x);color=aerial(rd,limit,color)*mix(0.94,1.0,lut_trans);}
 if f.options.y>0.5 && !submerged {let size=textureDimensions(clouds);let q=(vec2<f32>(id.xy)+0.5)/f.view.xy*vec2<f32>(size)-0.5;let base=vec2<i32>(floor(q));let frac=fract(q);var sum=vec4<f32>(0);var weight=0.0;var depthMoment=0.0;
  for(var y=0;y<2;y++){for(var x=0;x<2;x++){let coord=clamp(base+vec2<i32>(x,y),vec2<i32>(0),vec2<i32>(size)-1);let g=textureLoad(cloud_guide,coord,0);let w=select(1.0-frac.x,frac.x,x==1)*select(1.0-frac.y,frac.y,y==1);if cloud_guide_matches(g,limit){let c=textureLoad(clouds,coord,0);sum+=c*w;weight+=w;depthMoment+=w*g.w;}}}
  // Missing neighbours at a ridge belong to another depth. Reconstruct
  // their share along this ray with the same quadrature as the cloud pass.
  let pixel=vec2<f32>(xy)+0.5;let cloudRay=view_ray(pixel);
  if weight<.9999{let extra=integrate_cloud(cloudRay,limit,u32(f.lod.z),2.0*f.view.w/f32(size.y));sum+=(1.0-weight)*extra.color;depthMoment+=(1.0-weight)*extra.guide.w;}
  // Sparse far samples can place a grazing silhouette on different rows.
  // Integrate across the final pixel along the projected local vertical.
  let vertical=normalize(f.eye_hi.xyz+f.eye_lo.xyz);
  if abs(dot(cloudRay,vertical))<0.19{
   let direction=normalize(vec2<f32>(dot(vertical,f.right.xyz),-dot(vertical,f.up.xyz))+vec2<f32>(1.e-8));
   let texel=vec2<i32>(round(q));let step=vec2<i32>(round(direction));
   let last=vec2<i32>(size)-1;
   let left=textureLoad(clouds,clamp(texel-step,vec2<i32>(0),last),0).a;
   let right=textureLoad(clouds,clamp(texel+step,vec2<i32>(0),last),0).a;
   let edge=smoothstep(.045,.32,max(abs(left-right),max(abs(sum.a-left),abs(sum.a-right))));
   if edge>0.0{
    let angle=2.0*f.view.w/f.view.y;
    let a=integrate_cloud(view_ray(pixel-direction*.32),limit,u32(f.lod.z),angle);
    let b=integrate_cloud(view_ray(pixel+direction*.32),limit,u32(f.lod.z),angle);
    sum=mix(sum,(a.color+b.color)*0.5,edge);
    depthMoment=mix(depthMoment,(a.guide.w+b.guide.w)*0.5,edge);
   }
  }
  if sum.a<0.90{reactive=true;if depthMoment>0.0{temporalDistance=min(temporalDistance,depthMoment/max(.001,1.0-sum.a));}}
  color=color*sum.a+sum.rgb;
 }
 // Dissolve only the distant planet. Nearby geometry stays fully present
 // while terrain/cloud representations exchange ownership.
 if f.solar.x>0.5&&f.surface_blend.x<1.0&&limit>512.0{let far=textureLoad(space_active,xy,0);color=mix(select(far.rgb+space*(1.0-far.a),space,ahead),color,f.surface_blend.x);}
 if f.options.w>0.5{color=textureLoad(shaded,xy,0).rgb;}
 let depth=select(log2(1.0+temporalDistance),60.0,temporalDistance>=1e12);
 textureStore(hdr_out,xy,vec4<f32>(clamp(color,vec3<f32>(0),vec3<f32>(60000)),select(1.0,select(depth,-depth,reactive),f.temporal.z>0.0)));
}

// Both buffers hold linear radiance. Source alpha is signed log ray distance
// (negative for cloud or water, 60 for the sky). A resolved pixel on a stable
// skyline uses 64..319 for its last eight coverage bits; binary16 represents
// these integers exactly. A moving/disoccluded pixel rejects that local mask.
@group(0) @binding(191) var taa_current:texture_2d<f32>;
@group(0) @binding(192) var taa_history:texture_2d<f32>;
@group(0) @binding(193) var taa_target:texture_storage_2d<rgba16float,write>;
fn temporal_sample(xy:vec2<i32>)->vec4<f32>{
 let source=textureLoad(taa_current,xy,0);
 if f.temporal.z<1.5{return source;}
 let d=textureLoad(space_distance,xy,0).r;
 return vec4<f32>(source.rgb,select(60.0,log2(1.0+d),d>0.0));
}
@compute @workgroup_size(8,8)
fn temporal_resolve(@builtin(global_invocation_id) id:vec3<u32>){
 let size=vec2<i32>(textureDimensions(taa_current));let xy=vec2<i32>(id.xy);if any(xy>=size){return;}
 let cur=temporal_sample(xy);let center=vec2<f32>(xy)+0.5;
 if f.temporal.w<0.5{textureStore(taa_target,xy,cur);return;}
 let rd=ray(center);let distance=exp2(abs(cur.a))-1.0;
 let delta=(f.eye_hi.xyz-f.prev_hi.xyz)+(f.eye_lo.xyz-f.prev_lo.xyz);
 let p=select(rd*distance+delta,rd,abs(cur.a)>=59.0);
 let z=dot(p,f.prev_forward.xyz);
 let uv=vec2<f32>(dot(p,f.prev_right.xyz)/(f.view.z*f.view.w),-dot(p,f.prev_up.xyz)/f.view.w)/max(1.e-9,z)*0.5+0.5;
 let prev=uv*f.view.xy-f.temporal.xy;
 if z<=0.0||any(prev<vec2<f32>(0.5))||any(prev>f.view.xy-0.5){textureStore(taa_target,xy,cur);return;}
 let motion=length(prev-center);
 var lo=cur.rgb;var hi=cur.rgb;var dlo=abs(cur.a);var dhi=dlo;
 for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
  let n=temporal_sample(clamp(xy+vec2<i32>(x,y),vec2<i32>(0),size-1));
  lo=min(lo,n.rgb);hi=max(hi,n.rgb);dlo=min(dlo,abs(n.a));dhi=max(dhi,abs(n.a));
 }}
 // Track the eight coverage samples independently of radiance. An exponential
 // average weights one side of a silhouette more heavily each time the jitter
 // sequence crosses it, even when both the sky and the ground are motionless.
 let parallax=length(delta)*f.view.y/(2.0*f.view.w*max(1.0,exp2(dlo)-1.0));
 if f.temporal.z<1.5&&cur.a>=0.0&&dhi==60.0&&dlo<55.0&&motion+parallax<.12{
  let old=textureLoad(taa_history,vec2<i32>(floor(prev)),0);
  let ground=cur.a<59.0;
  let oldMask=select(select(0u,255u,ground),u32(clamp(old.a-64.0,0.0,255.0)),old.a>=64.0);
  let mask=((oldMask<<1u)|u32(ground))&255u;
  var land=vec3<f32>(0);var skyColor=vec3<f32>(0);var lw=0.0;var sw=0.0;
  for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
   let n=textureLoad(taa_current,clamp(xy+vec2<i32>(x,y),vec2<i32>(0),size-1),0);
   let w=1.0/(1.0+f32(x*x+y*y));
   if n.a==60.0{skyColor+=w*n.rgb;sw+=w;}else if n.a>=0.0{land+=w*n.rgb;lw+=w;}
  }}
  if lw>0.0&&sw>0.0{
   let foreground=select(land/lw,cur.rgb,ground);let background=select(cur.rgb,skyColor/sw,ground);
   let sample=mix(background,foreground,f32(countOneBits(mask))*.125);
   // Smooth small shading changes without delaying changes in edge coverage.
   let keep=select(0.0,.55,old.a>=64.0&&countOneBits(oldMask)==countOneBits(mask));
   textureStore(taa_target,xy,vec4<f32>(mix(sample,clamp(old.rgb,lo,hi),keep),64.0+f32(mask)));return;
  }
 }
 let expected=select(log2(1.0+length(p)),abs(cur.a),abs(cur.a)>=59.0);
 let base=vec2<i32>(floor(prev-0.5));let frac=fract(prev-0.5);
 var sum=vec3<f32>(0);var coverage=0.0;
 for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let h=textureLoad(taa_history,min(base+vec2<i32>(x,y),size-1),0);
  let w=select(1.0-frac.x,frac.x,x==1)*select(1.0-frac.y,frac.y,y==1);
  let depth=abs(h.a);
  let stableEdge=motion+parallax<0.25 && depth>=dlo-.014 && depth<=dhi+.014;
  if abs(depth-expected)<.028||stableEdge{sum+=h.rgb*w;coverage+=w;}
 }}
 let history=sum/max(.000001,coverage);
 // Clip on the line toward the centre of the local HDR box to preserve hue.
 let mid=(hi+lo)*0.5;let halfRange=max((hi-lo)*0.5,vec3<f32>(.0001));let v=history-mid;
 let units=abs(v)/halfRange;let clipped=mid+v/max(1.0,max(units.x,max(units.y,units.z)));
 let weight=mix(.875,.56,smoothstep(.4,8.0,motion))*select(1.0,.63,cur.a<0.0)*coverage;
 textureStore(taa_target,xy,vec4<f32>(mix(cur.rgb,clipped,weight),cur.a));
}
