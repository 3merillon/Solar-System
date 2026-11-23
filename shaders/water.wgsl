// Metric travelling waves on a local water chart that follows the eye (wave cache, foam, coastal bed).
// Inspired by Planets' shared trochoidal spectrum. No imported assets.
// hi.w: 1 while the chart is enabled (water under an eye within 1 km of it), else 0. status.z: the wave height
// under the eye (read by the water audit); status.w: 1 when the coastal bed is rebuilt this frame.
struct WaterChart { hi:vec4<f32>,lo:vec4<f32>,right:vec4<f32>,up:vec4<f32>,status:vec4<f32> }
struct WaterCharts { charts:array<WaterChart,2> }
@group(0) @binding(30) var<storage,read_write> water_chart_write:WaterCharts;
@group(0) @binding(33) var<storage,read> water_chart:WaterCharts;
@group(0) @binding(38) var<storage,read> foam_old:array<f32>;
@group(0) @binding(39) var<storage,read_write> foam_next:array<f32>;
@group(0) @binding(40) var<storage,read> foam_a:array<f32>;
@group(0) @binding(41) var<storage,read> foam_b:array<f32>;
@group(0) @binding(42) var<storage,read_write> bed_write:array<vec4<f32>>;
@group(0) @binding(43) var<storage,read> bed:array<vec4<f32>>;

@compute @workgroup_size(1)
fn water_chart_prepare(){
 let parity=f.numeric.y;let old=water_chart_write.charts[1u-parity];var m=old;
 // The chart follows the water under the eye, whose level it keeps in lo.w, or WATER_NONE over dry land.
 var level=f.planet.y;var has_water=true;
 if field_measured(){let under=measured_water_level(page_pos(f.eye_hi.xyz,f.eye_lo.xyz),1.0);has_water=under>WATER_NONE;if has_water{level=under;}}
 let chart_level=select(WATER_NONE,level,has_water);
 let radial=normalize(f.eye_hi.xyz+f.eye_lo.xyz);let center_lo=f.eye_lo.xyz+radial*(level-f.eye_hi.w);
 let delta=(f.eye_hi.xyz-old.hi.xyz)+(center_lo-old.lo.xyz);let distance=length(delta);
 let enabled=f.options.z>0.5&&has_water&&abs(f.eye_hi.w-level)<1000.0;
 let reset=old.hi.w==0.0||distance>200.0||abs(old.lo.w-chart_level)>4.0||bitcast<u32>(old.up.w)!=f.numeric.w;
 if reset||distance>32.0{
  m.hi=vec4<f32>(f.eye_hi.xyz,select(0.0,1.0,enabled));m.lo=vec4<f32>(center_lo,chart_level);
  var axis=vec3<f32>(0,0,1);if abs(radial.z)>0.95{axis=vec3<f32>(0,1,0);}
  m.right=vec4<f32>(normalize(cross(axis,radial)),select(0.0,1.0,reset));
  m.up=vec4<f32>(normalize(cross(radial,m.right.xyz)),bitcast<f32>(f.numeric.w));
 }else{m.right.w=0.0;m.hi.w=select(0.0,1.0,enabled);if has_water{m.lo=vec4<f32>(m.lo.xyz+radial*(chart_level-m.lo.w),chart_level);}}
 // The bed chart is rebuilt when it moves, and on a measured body once after the page tables go quiet. Its pages may have arrived after it was built.
 let rebuild=select(0.0,1.0,reset||distance>32.0||(field_measured()&&f.field_serial.z==8u));
 m.status=vec4<f32>(0,0,wave_raw(f.eye_hi.xyz,f.eye_lo.xyz-radial*f.eye_hi.w,0.15,vec3<f32>(0),vec3<f32>(0)).field.w*water_wave_scale(level),rebuild);
 water_chart_write.charts[parity]=m;
}
@compute @workgroup_size(8,8)
fn water_bed_generate(@builtin(global_invocation_id) id:vec3<u32>){
 field_final=true;let m=water_chart.charts[f.numeric.y];if m.hi.w==0.0||m.status.w==0.0{return;}
 let p=(vec2<f32>(id.xy)-63.5)*2.0;let offset=m.right.xyz*p.x+m.up.xyz*p.y;let radial=normalize(m.hi.xyz+m.lo.xyz);
 let lo=m.lo.xyz+offset-radial*(m.lo.w+dot(offset,offset)/(2.0*f.planet.x));
 // Rebuild just 16384 bed samples when the 256m chart moves or the canonical
 // terrain changes. This is a foam depth approximation, never collision data.
 let bed=field_bed(m.hi.xyz,lo,0.5);let h=bed.w;let gradient=bed.xyz;
 bed_write[id.y*128u+id.x]=vec4<f32>(h,dot(gradient,m.right.xyz),dot(gradient,m.up.xyz),1);
}
fn coastal_bed(p:vec2<f32>)->vec4<f32>{
 let q=clamp(p*0.5+63.5,vec2<f32>(0),vec2<f32>(126.999));let a=vec2<u32>(q);let w=fract(q);let i=a.y*128u+a.x;
 return mix(mix(bed[i],bed[i+1u],w.x),mix(bed[i+128u],bed[i+129u],w.x),w.y);
}
fn old_foam(q:vec2<f32>)->f32{
 if any(q<vec2<f32>(0))||any(q>vec2<f32>(510)){return 0.0;}
 let p=vec2<u32>(q);let w=fract(q);let i=p.y*512u+p.x;
 return mix(mix(foam_old[i],foam_old[i+1u],w.x),mix(foam_old[i+512u],foam_old[i+513u],w.x),w.y);
}
fn shore_foam_source(depth:f32,slope_length:f32,incoming:f32,height:f32)->f32{
 let swash=(1.0-smoothstep(0.08,0.40,depth))*smoothstep(-0.10,0.04,depth)*smoothstep(0.005,0.04,slope_length);
 let breaker=(0.15*min(1.0,f.water.x)+0.85*smoothstep(0.005,0.10,incoming))*(0.5+0.5*smoothstep(-0.20,0.20,height));
 return swash*breaker*0.6;
}
// Exact box integral of the narrow swash profile. Filtering its depth input
// alone aliases a subpixel shoreline into bright, moving contour fragments.
fn shore_ramp_integral(depth:f32,start:f32,end:f32)->f32{
 let width=end-start;let x=(depth-start)/width;let t=clamp(x,0.0,1.0);
 return width*(t*t*t*(1.0-0.5*t)+max(0.0,x-1.0));
}
fn shore_swash_integral(depth:f32)->f32{return shore_ramp_integral(depth,-0.10,0.04)-shore_ramp_integral(depth,0.08,0.40);}
fn filtered_shore_source(depth:f32,half_width:f32,slope:f32,incoming:f32,height:f32)->f32{
 let width=max(0.001,half_width);
 // Outside the compact support, also avoid subtracting large equal integrals.
 if depth-width>=0.40||depth+width<= -0.10{return 0.0;}
 let swash=clamp((shore_swash_integral(min(0.40,depth+width))-shore_swash_integral(max(-0.10,depth-width)))/(2.0*width),0.0,1.0);
 let breaker=(0.15*min(1.0,f.water.x)+0.85*smoothstep(0.005,0.10,incoming))*(0.5+0.5*smoothstep(-0.20,0.20,height));
 return swash*breaker*smoothstep(0.005,0.04,slope)*0.6;
}
@compute @workgroup_size(8,8)
fn water_foam_step(@builtin(global_invocation_id) id:vec3<u32>){
 let m=water_chart.charts[f.numeric.y];let old=water_chart.charts[1u-f.numeric.y];let index=id.y*512u+id.x;
 if m.hi.w==0.0{foam_next[index]=0.0;return;}
 let p=(vec2<f32>(id.xy)-255.5)*0.5;
 // This texel's point on the previous frame's chart, where its foam history is read.
 let relative=(m.hi.xyz-old.hi.xyz)+(m.lo.xyz-old.lo.xyz)+m.right.xyz*p.x+m.up.xyz*p.y;
 let q=vec2<f32>(dot(relative,old.right.xyz),dot(relative,old.up.xyz))*2.0+255.5;
 let dt=f.water_motion.w;let edge=max(abs(p.x),abs(p.y));
 // Persistent whitecaps: seed only compressed, steep crests, then advect and
 // decay. No globally tiled texture and no CPU-generated particle positions.
 let wave=cached_wave(p,0u);let slope=vec2<f32>(dot(wave.field.xyz,m.right.xyz),dot(wave.field.xyz,m.up.xyz));
 let compression=max(0.0,-wave.curvature.x-wave.curvature.z);
 let breaking=smoothstep(0.22,0.65,length(slope))*smoothstep(0.06,0.65,compression)*smoothstep(-0.05,0.30,wave.field.w);
 let bottom=coastal_bed(p);let depth=m.lo.w+wave.field.w*water_wave_scale(m.lo.w)-bottom.x;let shallow=1.0-smoothstep(0.2,1.5,depth);
 let slope_length=length(bottom.yz);let shoreward=bottom.yz/max(0.03,slope_length);
 let wind=vec2<f32>(dot(vec3<f32>(0.86,0.12,0.50),m.right.xyz),dot(vec3<f32>(0.86,0.12,0.50),m.up.xyz));
 let incoming=max(0.0,-dot(slope,wind));
 let flow=(wind*0.35-slope*0.3+vec2<f32>(-slope.y,slope.x)*2.0+shoreward*(incoming*3.0-0.2)*shallow)*f.water.w;
 let foam_source=breaking*1.2+shore_foam_source(depth,slope_length,incoming,wave.field.w);
 let dry=1.0-smoothstep(-0.15,0.05,depth);
 let decay=0.75+dry*3.0+12.0*smoothstep(112.0,128.0,edge);
 // Newly exposed texels start at the same source equilibrium used outside
 // the chart, instead of appearing empty and filling in after an approach.
 var previous_foam=foam_source/decay;
 let old_q=q-flow*(2.0*dt);if m.right.w==0.0&&all(old_q>=vec2<f32>(0))&&all(old_q<=vec2<f32>(510)){previous_foam=old_foam(old_q);}
 foam_next[index]=clamp(previous_foam*exp(-dt*decay)+foam_source*(1.0-exp(-dt*decay))/decay,0.0,1.0);
}
fn foam_texel(p:vec2<u32>)->f32{let i=p.y*512u+p.x;if f.numeric.y==0u{return foam_a[i];}return foam_b[i];}
fn surface_foam(hi:vec3<f32>,lo:vec3<f32>,equilibrium:f32,displayed_bed:f32)->f32{
 let m=water_chart.charts[f.numeric.y];if m.hi.w==0.0{return equilibrium;}let p=(hi-m.hi.xyz)+(lo-m.lo.xyz);let uv=vec2<f32>(dot(p,m.right.xyz),dot(p,m.up.xyz));let q=uv*2.0+255.5;
 if any(q<vec2<f32>(0))||any(q>vec2<f32>(510)){return equilibrium;}
 let cell=vec2<u32>(q);let w=fract(q);let history=mix(mix(foam_texel(cell),foam_texel(cell+vec2<u32>(1,0)),w.x),mix(foam_texel(cell+vec2<u32>(0,1)),foam_texel(cell+vec2<u32>(1)),w.x),w.y);
 // Match the same globally defined foam source. Only its advected history is
 // local, with a broad C1 radial weight wholly inside the square allocation.
 let view_relative=(hi-f.eye_hi.xyz)+(lo-f.eye_lo.xyz);let view_uv=vec2<f32>(dot(view_relative,m.right.xyz),dot(view_relative,m.up.xyz));
 // The local history was sourced on the canonical bed. During mesh morphs it
 // may describe a different shore; only use it where the displayed bed agrees.
 let agreement=1.0-smoothstep(0.05,0.35,abs(displayed_bed-coastal_bed(uv).x));
 return mix(equilibrium,history,(1.0-smoothstep(20.0,88.0,length(view_uv)))*0.65*agreement);
}
fn foam_film(hi:vec3<f32>,lo:vec3<f32>,footprint:f32)->f32{
 // Overlapping round bubble shells with independently varied radii. No
 // nearest-site partition or polygon edges. Unresolved froth is integrated.
 if footprint>=0.04{return 0.65;}
 let scale=0.03125;let a=floor(lo/scale);let cell=vec3<i32>(hi/scale)+vec3<i32>(a);let p=lo/scale-a;
 var shells=0.0;
 for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
  let offset=vec3<i32>(x,y,z);let c=cell+offset;let seed=hash(bitcast<u32>(c.x)^hash(bitcast<u32>(c.y)^hash(bitcast<u32>(c.z)^6791u)));
  let jitter=vec3<f32>(f32(seed&1023u),f32((seed>>10u)&1023u),f32((seed>>20u)&1023u))/1023.0;
  let d=length(vec3<f32>(offset)+0.1+jitter*0.8-p);
  let radius=0.12+0.48*f32(hash(seed^8017u)&65535u)/65535.0;
  let width=max(0.035,footprint/scale);let shell=(d-radius)/width;
  shells+=exp(-shell*shell)*0.035/width;
 }}}
 return mix(clamp(0.56+0.35*shells,0.56,1.0),0.65,smoothstep(0.008,0.04,footprint));
}
// Aperiodic compact simplex wavelets replace globally repeating wave trains.
// Integer cell selection happens before float conversion, including skew and
// unskew, so the same field survives Earth-radius origin changes.
struct WaveJet { field:vec4<f32>,curvature:vec4<f32> }
@group(0) @binding(36) var<storage,read_write> wave_cache_write:array<WaveJet>;
@group(0) @binding(37) var<storage,read> wave_cache:array<WaveJet>;
// Wave cache layout for base size B (f.tier_c.z): levels 0-3 at B, B/2, B/4, B/8
// texels plus a fine level at B texels; offsets are B*B/64 * (0, 64, 80, 84, 85).
fn wave_size(level:u32)->u32{let base=f.tier_c.z;return select(base>>level,base,level==4u);}
fn wave_offset(level:u32)->u32{let unit=(f.tier_c.z*f.tier_c.z)/64u;let steps=array<u32,5>(0u,64u,80u,84u,85u);return unit*steps[level];}
fn mix_jet(a:WaveJet,b:WaveJet,t:f32)->WaveJet{return WaveJet(mix(a.field,b.field,t),mix(a.curvature,b.curvature,t));}
@compute @workgroup_size(8,8)
fn water_cache_generate(@builtin(global_invocation_id) id:vec3<u32>){
 let size=wave_size(id.z);if id.x>=size||id.y>=size{return;}let m=water_chart.charts[f.numeric.y];if m.hi.w==0.0{return;}
 let p=((vec2<f32>(id.xy)+0.5)/f32(size)-0.5)*select(256.0,64.0,id.z==4u)+select(vec2<f32>(0),fine_center(),id.z==4u);let offset=m.right.xyz*p.x+m.up.xyz*p.y;
 let radial=normalize(m.hi.xyz+m.lo.xyz);let lo=m.lo.xyz+offset-radial*(m.lo.w+dot(offset,offset)/(2.0*f.planet.x));
 let footprint=select(0.25*exp2(f32(id.z)*2.0),0.0625,id.z==4u);
 wave_cache_write[wave_offset(id.z)+id.y*size+id.x]=wave_raw(m.hi.xyz,lo,footprint,m.right.xyz,m.up.xyz);
}
// The fine wave cache's 64 m window centre: the eye, snapped to the window's own texels. Following the eye exactly,
// its grid slid under the water with every move, so each frame resampled the waves at shifted points, and caustics,
// a reciprocal of the sampled curvature, shimmered. Snapped, a texel keeps its world point until the chart moves.
fn fine_center()->vec2<f32>{let m=water_chart.charts[f.numeric.y];let p=(f.eye_hi.xyz-m.hi.xyz)+(f.eye_lo.xyz-m.lo.xyz);let texel=64.0/f32(wave_size(4u));return floor(vec2<f32>(dot(p,m.right.xyz),dot(p,m.up.xyz))/texel+0.5)*texel;}
fn cached_wave(p:vec2<f32>,level:u32)->WaveJet{
 let size=wave_size(level);let q=clamp(((p-select(vec2<f32>(0),fine_center(),level==4u))/select(256.0,64.0,level==4u)+0.5)*f32(size)-0.5,vec2<f32>(0),vec2<f32>(f32(size)-1.001));let a=vec2<u32>(q);let w=fract(q);let i=wave_offset(level)+a.y*size+a.x;
 return mix_jet(mix_jet(wave_cache[i],wave_cache[i+1u],w.x),mix_jet(wave_cache[i+size],wave_cache[i+size+1u],w.x),w.y);
}
fn wave_base_jet(hi:vec3<f32>,lo:vec3<f32>,footprint:f32)->WaveJet{
 let m=water_chart.charts[f.numeric.y];let p=(hi-m.hi.xyz)+(lo-m.lo.xyz);let uv=vec2<f32>(dot(p,m.right.xyz),dot(p,m.up.xyz));
 let distance=max(abs(uv.x),abs(uv.y));let lod=clamp(log2(max(0.25,footprint)/0.25)*0.5,0.0,3.0);let level=u32(lod);
 if m.hi.w>0.5&&distance<120.0&&footprint<=16.0{
  let cached=mix_jet(cached_wave(uv,level),cached_wave(uv,min(3u,level+1u)),fract(lod));
  if distance<104.0{return cached;}
  let raw=wave_raw(hi,lo,footprint,m.right.xyz,m.up.xyz);
  return mix_jet(cached,raw,smoothstep(104.0,120.0,distance));
 }
 let radial=normalize(hi+lo);let axis=select(vec3<f32>(0,0,1),vec3<f32>(0,1,0),abs(radial.z)>0.95);let u=normalize(cross(axis,radial));let v=cross(radial,u);
 return wave_raw(hi,lo,footprint,u,v);
}
fn add_jet(a:WaveJet,b:WaveJet)->WaveJet{return WaveJet(a.field+b.field,a.curvature+b.curvature);}
fn wave_jet(hi:vec3<f32>,lo:vec3<f32>,footprint:f32)->WaveJet{
 let base=wave_base_jet(hi,lo,max(0.25,footprint));if footprint>=0.25{return base;}
 let m=water_chart.charts[f.numeric.y];let p=(hi-m.hi.xyz)+(lo-m.lo.xyz);let uv=vec2<f32>(dot(p,m.right.xyz),dot(p,m.up.xyz));let fine_uv=uv-fine_center();let distance=max(abs(fine_uv.x),abs(fine_uv.y));
 let blend=clamp(log2(max(0.0625,footprint)/0.0625)*0.5,0.0,1.0);
 if m.hi.w>0.5&&distance<24.0{return mix_jet(cached_wave(uv,4u),base,blend);}
 let fine=wave_component(hi,lo,footprint,m.right.xyz,m.up.xyz,9u);let coarse=wave_component(hi,lo,0.25,m.right.xyz,m.up.xyz,9u);
 let result=WaveJet(base.field+fine.field-coarse.field,base.curvature+fine.curvature-coarse.curvature);
 if m.hi.w>0.5&&distance<30.0{
  let near=mix_jet(cached_wave(uv,4u),base,blend);
  return mix_jet(near,result,smoothstep(24.0,30.0,distance));
 }
 return result;
}
fn wave_field(hi:vec3<f32>,lo:vec3<f32>,footprint:f32)->vec4<f32>{return wave_jet(hi,lo,footprint).field;}
fn water_simplex(hi:vec3<f32>,lo:vec3<f32>,scale:f32,seed:u32,u:vec3<f32>,v:vec3<f32>)->WaveJet{
 let ih=vec3<i32>(hi/scale);let local=lo/scale;let sum_hi=ih.x+ih.y+ih.z;let rem3=((sum_hi%3)+3)%3;
 let skew_int=(sum_hi-rem3)/3;let skew_lo=(f32(rem3)+local.x+local.y+local.z)/3.0;
 let cell=ih+vec3<i32>(skew_int)+vec3<i32>(floor(local+skew_lo));let sum_cell=cell.x+cell.y+cell.z;let rem6=((sum_cell%6)+6)%6;
 let x0=vec3<f32>(ih-cell+vec3<i32>((sum_cell-rem6)/6))+local+f32(rem6)/6.0;
 var i1=vec3<f32>(0);var i2=vec3<f32>(0);
 if x0.x>=x0.y{if x0.y>=x0.z{i1=vec3<f32>(1,0,0);i2=vec3<f32>(1,1,0);}else if x0.x>=x0.z{i1=vec3<f32>(1,0,0);i2=vec3<f32>(1,0,1);}else{i1=vec3<f32>(0,0,1);i2=vec3<f32>(1,0,1);}}
 else{if x0.y<x0.z{i1=vec3<f32>(0,0,1);i2=vec3<f32>(0,1,1);}else if x0.x<x0.z{i1=vec3<f32>(0,1,0);i2=vec3<f32>(0,1,1);}else{i1=vec3<f32>(0,1,0);i2=vec3<f32>(1,1,0);}}
 let offsets=array<vec3<f32>,4>(vec3<f32>(0),i1,i2,vec3<f32>(1));var value=0.0;var gradient=vec3<f32>(0);var hessian=vec3<f32>(0);
 let gradients=array<vec3<f32>,12>(vec3<f32>(1,1,0),vec3<f32>(-1,1,0),vec3<f32>(1,-1,0),vec3<f32>(-1,-1,0),vec3<f32>(1,0,1),vec3<f32>(-1,0,1),vec3<f32>(1,0,-1),vec3<f32>(-1,0,-1),vec3<f32>(0,1,1),vec3<f32>(0,-1,1),vec3<f32>(0,1,-1),vec3<f32>(0,-1,-1));
 for(var j=0u;j<4u;j++){let corner=cell+vec3<i32>(offsets[j]);let x=x0-offsets[j]+f32(j)/6.0;let g=gradients[hash(bitcast<u32>(corner.x)^hash(bitcast<u32>(corner.y)^hash(bitcast<u32>(corner.z)^seed)))%12u];let t=max(0.0,0.6-dot(x,x));let t3=t*t*t;let t4=t3*t;let projection=dot(g,x);value+=t4*projection;gradient+=t4*g-8.0*t3*projection*x;
 let a=vec2<f32>(dot(x,u),dot(x,v));let b=vec2<f32>(dot(g,u),dot(g,v));
 hessian+=48.0*t*t*projection*vec3<f32>(a.x*a.x,a.x*a.y,a.y*a.y)-8.0*t3*vec3<f32>(2.0*a.x*b.x+projection*dot(u,u),a.x*b.y+a.y*b.x+projection*dot(u,v),2.0*a.y*b.y+projection*dot(v,v));}
 value*=32.0;gradient*=32.0/scale;
 return WaveJet(vec4<f32>(select(vec3<f32>(0),gradient,abs(value)<1.0),clamp(value,-1.0,1.0)),vec4<f32>(select(vec3<f32>(0),hessian*(32.0/(scale*scale)),abs(value)<1.0),0));
}
fn water_filter(scale:f32,footprint:f32)->f32{
 if footprint>16.0{return filter_weight(scale,footprint);}
 let lod=clamp(log2(max(0.0625,footprint)/0.0625)*0.5,0.0,4.0);let level=floor(lod);
 return mix(filter_weight(scale,0.0625*exp2(level*2.0)),filter_weight(scale,0.0625*exp2(min(4.0,level+1.0)*2.0)),fract(lod));
}
fn wave_component(hi:vec3<f32>,lo:vec3<f32>,footprint:f32,u:vec3<f32>,v:vec3<f32>,i:u32)->WaveJet{
 let scales=array<f32,10>(128,64,32,16,8,4,2,1,0.5,0.25);
 let amplitudes=array<f32,10>(0.34,0.24,0.17,0.11,0.065,0.036,0.045,0.025,0.004,0.0007);
 let flows=array<vec3<f32>,10>(vec3<f32>(0.86,0.12,0.50),vec3<f32>(0.62,-0.31,0.72),vec3<f32>(0.91,0.32,0.26),vec3<f32>(0.25,0.55,0.80),vec3<f32>(0.65,-0.60,0.46),vec3<f32>(-0.35,0.82,0.45),vec3<f32>(0.75,0.44,-0.49),vec3<f32>(-0.61,-0.24,0.75),vec3<f32>(0.42,0.84,0.34),vec3<f32>(0.17,-0.96,0.22));
 let scale=scales[i];let weight=water_filter(scale*2.0,footprint);if weight==0.0||f.water.x==0.0{return WaveJet(vec4<f32>(0),vec4<f32>(0));}
 let velocity=flows[i]*sqrt(9.81*scale/6.2831853)*f.water.w;let shift_hi=floor((-f.planet.w*velocity)/4096.0)*4096.0;let shift_lo=fma(vec3<f32>(-f.planet.w),velocity,-shift_hi);
 let jet=water_simplex(hi+shift_hi,lo+shift_lo,scale,bitcast<u32>(f.geo.z)^hash(9013u+i*173u),u,v);let q=jet.field;
 let h=1.15*q.w-0.15*q.w*q.w*q.w;let dh=1.15-0.45*q.w*q.w;let amplitude=amplitudes[i]*weight*f.water.x;
 let g=vec2<f32>(dot(q.xyz,u),dot(q.xyz,v));let hessian=(jet.curvature.xyz*dh-0.9*q.w*vec3<f32>(g.x*g.x,g.x*g.y,g.y*g.y))*amplitude;
 return WaveJet(vec4<f32>(q.xyz*dh,h)*amplitude,vec4<f32>(hessian,0));
}
fn wave_raw(hi:vec3<f32>,lo:vec3<f32>,footprint:f32,u:vec3<f32>,v:vec3<f32>)->WaveJet{
 // Lower quality tiers drop the finest wave bands first (largest scales lead).
 var result=WaveJet(vec4<f32>(0),vec4<f32>(0));let bands=min(10u,u32(f.quality.y));for(var i=0u;i<bands;i++){result=add_jet(result,wave_component(hi,lo,footprint,u,v,i));}return result;
}
// How steep the river water under the last sea_wave call runs: 0 on still reaches, 1 in rapids and falls.
var<private> river_rapids:f32=0.0;
fn page_water_cell(entry:u32,c:vec2<u32>)->vec4<f32>{let index=c.y*32u+c.x;return textureLoad(page_meta,vec2<i32>(i32(index&255u),PAGE_WATER_ROW+i32(page_entry_slot(entry)*4u+(index>>8u))),0);}
// Downstream velocity around a point, bilinear over the four nearest river cells of its page (m/s before the user's
// speed setting) in xyz; the weight of river cells among them in w. Cells without a river add nothing.
fn river_flow(entry:u32,pos:PagePos)->vec4<f32>{
 let level=page_entry_level(entry);let page=page_index(pos.g,level);
 let inside=pos.g-(page<<vec2<u32>(28u-level));let coord=vec2<f32>(inside)*exp2(f32(level)-23.0)-.5;
 let low=vec2<i32>(floor(coord));let fr=fract(coord);let basis=chart_tangents(pos.face,pos.uv);let per_chart=128.0*exp2(f32(level));
 var sum=vec3<f32>(0);var weight=0.0;
 for(var k=0u;k<4u;k++){
  let c=vec2<u32>(clamp(low+vec2<i32>(i32(k&1u),i32(k>>1u)),vec2<i32>(0),vec2<i32>(31)));let q=page_water_cell(entry,c);if q.w<=1.0{continue;}
  let w=select(1.0-fr.x,fr.x,(k&1u)!=0u)*select(1.0-fr.y,fr.y,(k>>1u)!=0u);
  let angle=(q.w-2.0)*6.28318531;let slope=length(page_gradient(pos.face,pos.uv,q.y*per_chart,q.z*per_chart));
  sum+=normalize(basis[0]*cos(angle)+basis[1]*sin(angle))*clamp(.5+8.0*sqrt(slope),.5,4.0)*w;weight+=w;
 }
 return vec4<f32>(sum,weight);
}
fn sea_wave(hi:vec3<f32>,lo:vec3<f32>,footprint:f32)->vec4<f32>{
 if field_measured(){
  let pos=page_pos(hi,lo);let entry=measured_water_entry(pos,footprint*.125);
  // The water layer: river water carries its flow (m/s along the page's texel axes); ripples ride it downstream in two
  // layers, as below. Rapids from the speed.
  let lw=water_layer_entry(entry,pos.face,pos.g);
  if lw!=0u{let w=water_layer_at(lw,pos);if w.kind==3u&&dot(w.flow,w.flow)>0.0001{
   let basis=chart_tangents(pos.face,pos.uv);let velocity=(normalize(basis[0])*w.flow.x+normalize(basis[1])*w.flow.y)*f.water.w;
   river_rapids=smoothstep(3.3,3.5,length(w.flow));let period=1.6;let cycle=f.planet.w/period;var sum=vec4<f32>(0);var square=0.0;
   for(var k=0u;k<2u;k++){
    let t=cycle+0.5*f32(k);let phase=fract(t);let weight=1.0-abs(2.0*phase-1.0);let round=floor(t);
    let jitter=vec3<f32>(fract(round*0.6180339),fract(round*0.4142136),fract(round*0.7320508))*48.0;
    let shift=jitter-velocity*(phase*period);let sh=floor(shift/4096.0)*4096.0;let sl=shift-sh;
    let a=water_simplex(hi+sh,lo+sl,2.0,93263u,vec3<f32>(0),vec3<f32>(0)).field*.10*filter_weight(4.0,footprint);
    let b=water_simplex(hi+sh,lo+sl,.5,93264u,vec3<f32>(0),vec3<f32>(0)).field*.025*filter_weight(1.0,footprint);
    sum+=(a+b)*weight;square+=weight*weight;
   }
   return sum*inverseSqrt(max(square,0.25))*min(f.water.x,1.0)*(1.0+2.0*river_rapids);
  }}
  // River water on a page with water texels: the surface's own slope, and small waves carried downstream in two
  // layers, each over a bounded stretch before it fades and starts again (a flow map), so that reaches of different
  // speed never tear the pattern, however long it runs. Steep water feeds river_rapids for white water.
  if entry!=0u&&page_water_texels(entry){let flow=river_flow(entry,pos);if flow.w>0.0{
   let surface=page_water_surface(entry,pos.g,pos.frac);let slope=page_gradient(pos.face,pos.uv,surface.y,surface.z);
   river_rapids=smoothstep(0.06,0.25,length(slope));
   let velocity=flow.xyz/flow.w*f.water.w;let period=1.6;let cycle=f.planet.w/period;var sum=vec4<f32>(0);var square=0.0;
   for(var k=0u;k<2u;k++){
    let t=cycle+0.5*f32(k);let phase=fract(t);let weight=1.0-abs(2.0*phase-1.0);let round=floor(t);
    // Each restart starts from another part of the noise, so restarts do not repeat one stretch.
    let jitter=vec3<f32>(fract(round*0.6180339),fract(round*0.4142136),fract(round*0.7320508))*48.0;
    let shift=jitter-velocity*(phase*period);let sh=floor(shift/4096.0)*4096.0;let sl=shift-sh;
    let a=water_simplex(hi+sh,lo+sl,2.0,93263u,vec3<f32>(0),vec3<f32>(0)).field*.10*filter_weight(4.0,footprint);
    let b=water_simplex(hi+sh,lo+sl,.5,93264u,vec3<f32>(0),vec3<f32>(0)).field*.025*filter_weight(1.0,footprint);
    sum+=(a+b)*weight;square+=weight*weight;
   }
   // Two layers at triangle weights have less contrast between them; keep its root mean square. A river's ripples
   // come from its flow, not the sea state: the wave height setting scales them only up to its default.
   let rapid=1.0+2.0*river_rapids;
   return sum*inverseSqrt(max(square,0.25))*min(f.water.x,1.0)*rapid+vec4<f32>(slope/max(.2,water_wave_scale(surface.x)),0);
  }}
  if entry!=0u&&!page_water_texels(entry){let plane=page_water_plane(entry,pos.g);if plane.w>1.0{
   let per_chart=128.0*exp2(f32(page_entry_level(entry)));let slope=page_gradient(pos.face,pos.uv,plane.y*per_chart,plane.z*per_chart);
   let angle=(plane.w-2.0)*6.28318531;let basis=chart_tangents(pos.face,pos.uv);let flow=normalize(basis[0]*cos(angle)+basis[1]*sin(angle));
   let velocity=flow*clamp(.5+8.0*sqrt(length(slope)),.5,4.0)*f.water.w;
   let shift=-velocity*f.planet.w;let sh=floor(shift/4096.0)*4096.0;let sl=shift-sh;
   let a=water_simplex(hi+sh,lo+sl,2.0,93263u,vec3<f32>(0),vec3<f32>(0)).field*.10*filter_weight(4.0,footprint);
   let b=water_simplex(hi+sh,lo+sl,.5,93264u,vec3<f32>(0),vec3<f32>(0)).field*.025*filter_weight(1.0,footprint);
   return (a+b)*min(f.water.x,1.0)+vec4<f32>(slope/max(.2,water_wave_scale(plane.x)),0);
  }}
 }
 return wave_field(hi,lo,footprint);
}

fn water_fresnel(c:f32,eta:f32)->f32{
 let s2=eta*eta*(1.0-c*c);if s2>=1.0{return 1.0;}
 let t=sqrt(1.0-s2);let rs=(eta*c-t)/max(0.00001,eta*c+t);let rp=(eta*t-c)/max(0.00001,eta*t+c);return 0.5*(rs*rs+rp*rp);
}
// Bounded screen-space secondary visibility, with an explicit environment
// fallback outside the current view. No primary heightfield or hardware rays.
fn scene_uv(p:vec3<f32>)->vec2<f32>{let z=dot(p,f.forward.xyz);if z<=0.1{return vec2<f32>(-1);}
 return vec2<f32>(dot(p,f.right.xyz)/(z*f.view.z*f.view.w),-dot(p,f.up.xyz)/(z*f.view.w))*0.5+0.5-f.temporal.xy/f.view.xy;}
struct WaterRay {color:vec3<f32>,distance:f32,point:vec4<f32>,confidence:f32}
fn screen_water_ray(origin:vec3<f32>,direction:vec3<f32>,fallback:vec3<f32>)->WaterRay{
 if f.quality.z<0.5{return WaterRay(fallback,0,vec4<f32>(0),0);}
 var previous=0.08;var previous_gap=-1.0;
 for(var i=0u;i<14u;i++){
  let t=0.22*pow(1.75,f32(i));let p=origin+direction*t;let uv=scene_uv(p);if any(uv<=vec2<f32>(0.002))||any(uv>=vec2<f32>(0.998)){break;}
  let xy=vec2<i32>(uv*f.view.xy);let hit=textureLoad(positions,xy,0);let gap=dot(p-hit.xyz,f.forward.xyz);
  if dot(hit.xyz,hit.xyz)>0.01&&gap>0.0&&previous_gap<=0.0{
   var lo=previous;var hi=t;var coord=xy;
   for(var j=0u;j<4u;j++){let mid=(lo+hi)*0.5;let point=origin+direction*mid;let u=scene_uv(point);coord=clamp(vec2<i32>(u*f.view.xy),vec2<i32>(0),vec2<i32>(f.view.xy)-1);let h=textureLoad(positions,coord,0);if dot(h.xyz,h.xyz)>0.01&&dot(point-h.xyz,f.forward.xyz)>0.0{hi=mid;}else{lo=mid;}}
   let h=textureLoad(positions,coord,0);let error=length(origin+direction*hi-h.xyz);let confidence=(1.0-smoothstep(max(0.25,hi*0.03),max(1.0,hi*0.15),error));
   let hit_uv=(vec2<f32>(coord)+.5)/f.view.xy;let edge=min(min(hit_uv.x,hit_uv.y),min(1.0-hit_uv.x,1.0-hit_uv.y));
   if confidence>0.0{return WaterRay(textureLoad(shaded,coord,0).rgb,hi,h,confidence*smoothstep(.005,.06,edge));}
  }
  previous=t;previous_gap=select(-1.0,gap,dot(hit.xyz,hit.xyz)>0.01);
 }
 return WaterRay(fallback,0,vec4<f32>(0),0);
}
// The offscreen continuation shares the canonical field and terrain material.
// No screen-edge blend to primary pixels or a uniform deep-water rectangle.
fn refracted_bed_fallback(origin:vec3<f32>,direction:vec3<f32>,radial:vec3<f32>,displayed_depth:f32,direct_sun:f32)->WaterRay {
 let footprint=max(0.08,length(origin)*2.0*f.view.w/f.view.y/max(0.2,abs(dot(radial,direction))));
 // Anchor the continuation to the published bed under this water fragment.
 // A canonical shore can otherwise poke through a coarse/morphing terrain bed,
 // creating bright lace-shaped islands which look like unstable distant foam.
 // The bed under the surface point (iteration 0), three bounded Newton steps along the actual bent ray and the final
 // evaluation share one loop body (one inlined field evaluation, not five). No primary silhouette or primary depth
 // enters this continuation. Deep paths saturate absorption.
 var t=0.0;var sample:SurfaceDetail;var point=origin;var bed_offset=0.0;
 for(var i=0u;i<5u;i++){
  if i>0u{point=origin+direction*t;}
  sample=surface_detail_sample(point,footprint);
  if i==0u{bed_offset=sc_radial_height(origin)-displayed_depth-sample.height;t=clamp(displayed_depth/max(0.15,-dot(direction,sample.normal)),0.0,180.0);continue;}
  if i==4u{break;}
  let gap=sc_radial_height(point)-(sample.height+bed_offset);
  t=clamp(t+gap/max(0.15,-dot(direction,sample.normal)),0.0,180.0);
 }
 let bed_height=sample.height+bed_offset;
 let slope=clamp(dot(sample.normal,radial),0.0,1.0);var albedo=vec3<f32>(0);if field_measured(){albedo=measured_surface_albedo(point,bed_height,slope,footprint);}else{albedo=terrain_albedo(sample.base,bed_height,slope,footprint,sample.grain);}
 let ambient=vec3<f32>(0.21,0.27,0.34)*(0.3+0.7*sqrt(slope));
 // Direct light reuses the visibility resolved at the water surface pixel.
 var lit=sample.normal;if field_measured(){lit=normalize(lit-(field_material_bump-radial*dot(field_material_bump,radial)));}
 let light=ambient*daylight(radial)+vec3<f32>(1.8,1.55,1.3)*f.starlight.xyz*max(0.0,dot(lit,f.sun.xyz))*direct_sun;
 return WaterRay(albedo*light,t,vec4<f32>(point,bed_height),0);
}
// What lies under water the field answers for: this pixel's own ground, as deep as the field says. It holds no ray through the mesh, so nothing here follows the mesh's cells, and a bed of any depth costs the same.
fn field_water_bed(xy:vec2<i32>,ground:vec4<f32>,rd:vec3<f32>,refracted:vec3<f32>,radial:vec3<f32>,water_level:f32)->WaterRay{
 let footprint=length(ground.xyz)*2.0*f.view.w/f.view.y/max(0.15,abs(dot(radial,rd)));
 let pos=page_pos(f.eye_hi.xyz,f.eye_lo.xyz+ground.xyz);let entry=measured_water_entry(pos,footprint*0.125);var depth=0.0;
 let lw=water_layer_entry(entry,pos.face,pos.g);
 if lw!=0u{let w=water_layer_at(lw,pos);if w.level>WATER_NONE{depth=max(w.level-page_height_read(entry,pos.g,pos.frac).x,0.0);}}
 else if entry!=0u{if page_water_texels(entry){depth=max(page_surface_read(entry,pos.g,pos.frac).w,0.0);}else{let level=page_water(entry,pos.face,pos.g);if level>WATER_NONE{depth=max(level-page_height_read(entry,pos.g,pos.frac).x,0.0);}}}
 return WaterRay(textureLoad(shaded,xy,0).rgb,min(depth/max(0.15,-dot(refracted,radial)),180.0),vec4<f32>(ground.xyz,water_level-depth),1.0);
}
// The water under the eye. The raw form is WATER_NONE over dry land, so nothing there is submerged.
fn water_eye_raw()->f32{if !field_measured(){return f.planet.y;}return measured_water_level(page_pos(f.eye_hi.xyz,f.eye_lo.xyz),1.0);}
fn water_eye_level()->f32{let level=water_eye_raw();return select(f.planet.y,level,level>WATER_NONE);}
fn focus_from_curvature(curvature:vec3<f32>,depth:f32,width:f32)->f32{
 let d=min(depth,30.0)*0.2498;let determinant=(1.0+d*curvature.x)*(1.0+d*curvature.z)-d*d*curvature.y*curvature.y;
 return clamp(0.65/sqrt(determinant*determinant+width*width),0.30,3.5);
}
fn water_focus(lo:vec3<f32>,radial:vec3<f32>,depth:f32,footprint:f32)->f32{
 if f.water_motion.y<0.5||depth>100.0||footprint>4.0||water_diagnostic(4194304u){return 1.0;}
 let sun_ray=refract(-f.sun.xyz,radial,0.7501875);let back=lo-sun_ray*(depth/max(0.1,-dot(sun_ray,radial)))-radial*water_eye_level();
 let caustic_footprint=max(footprint,0.04+depth*0.0047);
 let m=water_chart.charts[f.numeric.y];let p=(f.eye_hi.xyz-m.hi.xyz)+(back-m.lo.xyz);let uv=vec2<f32>(dot(p,m.right.xyz),dot(p,m.up.xyz));
 var focus=0.0;
 let fine_uv=uv-fine_center();let cache_distance=max(abs(fine_uv.x),abs(fine_uv.y));var edge=1.0;
 if m.hi.w>0.5&&cache_distance<23.0&&caustic_footprint<0.25{
  // Integrate focused irradiance, not just its input height. Filtering the
  // height then taking a reciprocal determinant creates sparkling caustics.
  let blend=clamp(log2(max(0.0625,caustic_footprint)/0.0625)*0.5,0.0,1.0);
  for(var j=0u;j<4u;j++){let offset=(vec2<f32>(f32(j&1u),f32(j>>1u))-0.5)*max(0.025,footprint);
   let h=mix(cached_wave(uv+offset,4u).curvature.xyz,cached_wave(uv+offset,0u).curvature.xyz,blend);
   focus+=focus_from_curvature(h,depth,0.065)*0.25;}
  edge=max(smoothstep(18.0,23.0,cache_distance),smoothstep(0.18,0.25,caustic_footprint));
 }
 // One procedural fallback call instead of separate cached/uncached copies.
 if edge>0.0{let center=focus_from_curvature(wave_jet(f.eye_hi.xyz,back,caustic_footprint).curvature.xyz,depth,0.065+min(1.0,footprint)*0.25);focus=mix(focus,center,edge);}
 return mix(1.0,focus,exp(-depth*0.035)*smoothstep(0.0,1.0,depth)/(1.0+pow(footprint/0.10,2.0)));
}
fn bottom_light(color:vec3<f32>,point:vec3<f32>,radial:vec3<f32>,depth:f32,footprint:f32)->vec3<f32>{
 let focus=water_focus(f.eye_lo.xyz+point,radial,depth,footprint);
 let sun_path=depth/max(0.2,dot(radial,f.sun.xyz));let transmission=exp(-vec3<f32>(0.085,0.028,0.016)*sun_path/f.water.z);
 return color*(vec3<f32>(0.12,0.20,0.23)*daylight(radial)+0.8*focus*transmission*smoothstep(-0.04,0.03,dot(radial,f.sun.xyz)));
}
fn underwater_medium(origin:vec3<f32>,rd:vec3<f32>,distance:f32,base:vec3<f32>,direct_sun:f32,id_pixel:vec2<i32>)->vec3<f32>{
 let length_water=min(180.0,max(0.0,distance));let extinction=vec3<f32>(0.085,0.028,0.016)/f.water.z;
 let tr=exp(-extinction*length_water);let radial=normalize(f.eye_hi.xyz+f.eye_lo.xyz+origin);let day=daylight(radial);
 var illumination=vec3<f32>(0.008,0.075,0.105)*day;
 if f.water_motion.y>0.5{
  let down=refract(-f.sun.xyz,radial,0.7501875);let phase=0.12/pow(max(0.15,1.36-1.2*dot(rd,-down)),1.5);var beams=0.0;
  let m=water_chart.charts[f.numeric.y];
  // Light shafts: the focused light under the surface, integrated along the view ray. Three samples showed three
  // slices of the caustic pattern that moved with the camera, a wall of caustics rather than rays. Ten samples, offset
  // per pixel by a fixed dither (so their bands do not line up across the screen), of a coarser, broader focus field
  // integrate into shafts along the refracted sun.
  let dither=fract(52.9829189*fract(dot(vec2<f32>(f32(id_pixel.x),f32(id_pixel.y)),vec2<f32>(0.06711056,0.00583715))));
  if m.hi.w>0.0{for(var i=0u;i<10u;i++){let p=origin+rd*((f32(i)+dither)*length_water/10.0);let depth=max(0.0,water_eye_level()-f.eye_hi.w-dot(p,radial));let q=(f.eye_hi.xyz-m.hi.xyz)+(f.eye_lo.xyz+p-down*(depth/max(0.2,-dot(down,radial)))-m.lo.xyz);let uv=vec2<f32>(dot(q,m.right.xyz),dot(q,m.up.xyz));
   let weight=1.0-smoothstep(96.0,120.0,max(abs(uv.x),abs(uv.y)));if weight>0.0{let focus=focus_from_curvature(cached_wave(uv,2u).curvature.xyz,depth,0.45);beams+=max(0.0,focus-0.5)*exp(-depth/(20.0*f.water.z))*weight/10.0;}}}
  if beams>0.0{illumination+=vec3<f32>(0.04,0.15,0.17)*beams*phase*direct_sun;}
 }
 return base*tr+illumination*(1.0-tr);
}
@compute @workgroup_size(8,8)
fn water(@builtin(global_invocation_id) id:vec3<u32>){
 if any(id.xy>=vec2<u32>(f.view.xy)){return;}let xy=vec2<i32>(id.xy);let rd=ray(vec2<f32>(id.xy)+0.5);let ground=ground_distance(xy);var t=raster_sea(xy);var color=textureLoad(shaded,xy,0).rgb;
 if f.options.z<0.5{textureStore(water_out,xy,vec4<f32>(color,1));return;}
 let eye_radial=normalize(f.eye_hi.xyz+f.eye_lo.xyz);
 let eye_water=water_eye_raw();
 let at_eye=sea_wave(f.eye_hi.xyz,f.eye_lo.xyz-eye_radial*f.eye_hi.w,0.4).w*water_wave_scale(eye_water);
 var submerged=f.eye_hi.w<eye_water+at_eye;
 // Classify the ray at the actual near plane. If the first visible interface
 // is a back face the ray exits water; a front face enters it. This also covers
 // a wave crossing the near plane, without a screen-wide underwater switch.
 let at_waterline=abs(f.eye_hi.w-eye_water)<f.water.x*1.1+1.3;
 if at_waterline{
  let near=rd*(0.1/max(0.01,dot(rd,f.forward.xyz)));let height=f.eye_hi.w+dot(near,eye_radial);
  let local_surface=sea_wave(f.eye_hi.xyz,f.eye_lo.xyz+near-eye_radial*height,max(0.0625,f.water_motion.z)).w*water_wave_scale(eye_water);
  submerged=height<eye_water+local_surface;
  // Only a local wave can decide which medium the visible ray starts in.
  // A far bank or an elevated lake can present a back face to a camera in air.
  if t<ground&&t<256.0{submerged=textureLoad(ocean_depth,xy,0).r<0.0;}
  let near_crossing=textureLoad(ocean_cap,xy,0).r;
  if near_crossing!=0.0{submerged=near_crossing>0.0;}
 }
 let land_color=color;var water_coverage=select(0.0,1.0,t<ground);
 // A coarse triangle crosses the level anywhere between its vertices, so the mesh cannot say where water ends, in either direction. It can stand above water that is there, leaving
 // the bed uncovered short of the shore; and it can lie under ground it never sampled, a spit or a hill's foot, with water over them. The shore is where the field crosses the level,
 // so beyond the mesh's reach the field decides. A pixel the mesh left dry is water at the ground's own distance, at any range: wherever the shading drew a bed, water covers it.
 var claimed=0.0;var trust=0.0;var here=0.0;
 if field_measured()&&!submerged&&ground<1e10{
  trust=measured_water_trust(min(t,ground)*2.0*f.view.w/f.view.y*select(1.0,0.25,water_diagnostic(65536u)));here=1.0-textureLoad(shaded,xy,0).a;
  if t>=ground{
   let at=page_pos(f.eye_hi.xyz,f.eye_lo.xyz+rd*ground);let entry=measured_water_entry(at,max(.02,ground*2.0*f.view.w/f.view.y));
   // A mapped water layer owns an actual interface. Painting the bed as a
   // second interface created a lower skin and walls at mesh/LOD boundaries.
   // Keep the legacy image fallback only where no water layer exists.
   if water_layer_entry(entry,at.face,at.g)==0u{claimed=here;if claimed>0.0{t=ground;water_coverage=claimed;}}
  }
 }
 // Shore filtering can remove visible water coverage, never resurrect an
 // interface behind the first opaque hit (including trees and rocks).
 if !submerged&&t<ground{
  let weight=surface_detail_weight(rd*t);
  if weight>0.0{
   let depth=textureLoad(ocean_depth,xy,0).g;
   let bounds=vec2<i32>(f.view.xy)-1;
   let a=textureLoad(ocean_depth,clamp(xy+vec2<i32>(1,0),vec2<i32>(0),bounds),0);
   let b=textureLoad(ocean_depth,clamp(xy-vec2<i32>(1,0),vec2<i32>(0),bounds),0);
   let c=textureLoad(ocean_depth,clamp(xy+vec2<i32>(0,1),vec2<i32>(0),bounds),0);
   let d=textureLoad(ocean_depth,clamp(xy-vec2<i32>(0,1),vec2<i32>(0),bounds),0);
   let width=max(0.002,(abs(a.g-b.g)+abs(c.g-d.g))*0.25);
   let coastal=1.0-smoothstep(300.0,600.0,abs(depth));
   water_coverage*=mix(1.0,smoothstep(-width,width,depth),weight*coastal);
  }
 }
 if field_measured()&&t<ground&&!submerged{water_coverage=mix(water_coverage*measured_water_fade(page_pos(f.eye_hi.xyz,f.eye_lo.xyz+rd*t),max(0.002,t*2.0*f.view.w/f.view.y)),here,trust);}
 // A coarse water triangle may straddle a mapped bank. The same fine source
 // corridor that carved the channel owns coverage, including close-up pixels
 // where mesh normals are trusted. Never shade water outside that corridor.
 if field_measured()&&!submerged&&water_coverage>0.0{
  let at=page_pos(f.eye_hi.xyz,f.eye_lo.xyz+rd*t);let entry=measured_water_entry(at,max(0.002,t*2.0*f.view.w/f.view.y)*0.125);
  // With water texels the field's own fringe (field_water_here) already decides a claimed pixel; a mesh pixel
  // the excess puts on dry ground is clipped as the old cells were.
  let lw=water_layer_entry(entry,at.face,at.g);
  if lw!=0u{if claimed<=0.0{water_coverage*=water_layer_coverage(water_layer_at(lw,at),max(0.002,t*2.0*f.view.w/f.view.y));}}
  else if entry!=0u{if page_water_texels(entry){if claimed<=0.0&&page_surface_read(entry,at.g,at.frac).w< -0.05{water_coverage=0.0;}}else if page_water(entry,at.face,at.g)<=WATER_NONE{water_coverage=0.0;}}
 }
 let point=textureLoad(positions,xy,0);let floor_depth=water_eye_level()-point.w;
 let covered=water_coverage>0.0;
 // Surface geometry first: the single sunlight query below needs the wave
 // normal. Evaluate the wave at its body-surface address. Using mean sea
 // altitude here leaves the displacement in the noise coordinate, so shading
 // slopes disagree with the actual wave geometry precisely at the waterline.
 let p=rd*t;let radial=normalize(f.eye_hi.xyz+f.eye_lo.xyz+p);let lo=f.eye_lo.xyz+p;let fp=max(0.002,t*2.0*f.view.w/f.view.y/max(0.04,abs(dot(radial,rd))));
 let radius=f.planet.x+f.eye_hi.w;let radial_delta=2.0*radius*dot(p,eye_radial)+dot(p,p);
 let height=f.eye_hi.w+radial_delta/(sqrt(max(1.0,radius*radius+radial_delta))+radius);
 var waves=vec4<f32>(0);var n=radial;
 if covered{
  let base_lo=lo-radial*height;
  // As tall as the mesh's waves here: shrunk in shallow water by the same rule, on this pixel's depth.
  river_rapids=0.0;waves=sea_wave(f.eye_hi.xyz,base_lo,fp)*water_wave_scale(height)*water_wave_on_ground(textureLoad(ocean_depth,xy,0).g);n=normalize(radial-(waves.xyz-radial*dot(waves.xyz,radial)));
  if dot(n,-rd)<0.0{n=-n;}
 }
 // The level of this pixel's water, on a body where it varies.
 let water_level=select(f.planet.y,height-waves.w,field_measured());
 // One direct-light query per pixel. The visible surface point owns it; a
 // submerged view ray without a surface uses its path midpoint. The refracted
 // bed and underwater beams reuse this value: their receivers would be
 // projected back to this surface anyway, laterally offset by at most the
 // water depth, and deep paths saturate absorption. Four inlined queries
 // would dominate the compilation time of this kernel.
 let path_length=min(180.0,max(0.0,min(ground,t)));
 var direct_sun=1.0;
 if covered||submerged{
  let light_point=select(rd*(path_length*0.5),p,covered);
  let light_normal=select(normalize(f.eye_hi.xyz+f.eye_lo.xyz+light_point),n,covered);
  let light_footprint=select(max(0.25,length(light_point)*2.0*f.view.w/f.view.y),fp,covered);
  direct_sun=sun_direct(sunlight(light_point,light_normal,light_footprint));
 }
 let day=daylight(radial);
 var bottom_needed=false;var bottom_color=color;var bottom_point=point.xyz;var bottom_radial=radial;var bottom_depth=floor_depth;var bottom_fp=fp;
 if submerged&&ground<1e10&&floor_depth>0.0{bottom_needed=true;bottom_radial=normalize(f.eye_hi.xyz+f.eye_lo.xyz+point.xyz);bottom_fp=max(0.01,ground*2.0*f.view.w/f.view.y/max(0.04,abs(dot(bottom_radial,rd))));}
 var bed_path=false;var medium_origin=vec3<f32>(0);var medium_direction=rd;var medium_length=path_length;
 // How much of what lies under this surface the image answers for. Where it answers for all of it, no bed is computed.
 var image=0.0;if field_measured()&&covered&&!submerged{image=measured_water_image(t*2.0*f.view.w/f.view.y);let at=page_pos(f.eye_hi.xyz,f.eye_lo.xyz+p);let entry=measured_water_entry(at,fp*.125);if entry!=0u&&page_water_plane(entry,at.g).w>1.0{image*=.35;}}
 var reflection=vec3<f32>(0);var transmission=vec3<f32>(0.006,0.045,0.06)*day;var fresnel=0.0;var cosine=1.0;var roughness=0.1;
 if covered{
  // The subpixel slope is integrated into roughness instead of flickering.
  roughness=clamp(0.10+0.025*sqrt(f.water.x)+0.06*smoothstep(0.25,4.0,fp),0.10,0.32);
  cosine=clamp(dot(n,-rd),0.0001,1.0);let eta=select(0.7501875,1.333,submerged);fresnel=water_fresnel(cosine,eta);
  let reflected=reflect(rd,n);reflection=sky(reflected)-sun_disk(reflected)*(1.0-direct_sun);if submerged{reflection=vec3<f32>(0.006,0.045,0.06)*day;}
  // A claimed pixel lies at its own ground, so a march from there hits it at once and reflects the bed. It starts a few pixels' height clear of it.
  if t<1500.0{let bounce=screen_water_ray(select(p+n*0.08,p+reflected*(4.0*t*2.0*f.view.w/f.view.y/max(0.05,dot(reflected,radial))),claimed>0.0),reflected,reflection);reflection=mix(reflection,bounce.color,bounce.confidence);}
  if fresnel<0.9999{
   let refracted=refract(rd,n,eta);
   if submerged{transmission=sky(refracted)-sun_disk(refracted)*(1.0-direct_sun);}else if image<1.0{
    // Where the field says where water is, it also says how deep. A ray down to the mesh's ground would colour the water by that page's cells.
    let by_field=select(trust,1.0,claimed>0.0);var bent=WaterRay(vec3<f32>(0),0,vec4<f32>(0),0);
    if by_field<1.0{
     bent=screen_water_ray(p-n*0.08,refracted,vec3<f32>(0));
     // The canonical bed is available both inside and outside the screen.
     // Switching between its material and a previously shaded terrain pixel
     // made a full-width band where bent rays left the bottom of the image.
     // Screen hits supplement it only with explicit submerged props.
     let hit_uv=scene_uv(bent.point.xyz);let hit_pixel=clamp(vec2<i32>(hit_uv*f.view.xy),vec2<i32>(0),vec2<i32>(f.view.xy)-1);
     bent.confidence*=(1.0-by_field)*select(0.0,1.0,textureLoad(normals,hit_pixel,0).w< -100.0);
    }
    var fallback=WaterRay(vec3<f32>(0),180.0,vec4<f32>(p+refracted*180.0,water_level-180.0),0);
    if by_field>0.0{fallback=field_water_bed(xy,point,rd,refracted,radial,water_level);}else if bent.confidence<0.9999{fallback=refracted_bed_fallback(p,refracted,radial,max(0.0,textureLoad(ocean_depth,xy,0).g),direct_sun);}
    let depth=mix(fallback.distance,bent.distance,bent.confidence);
    bottom_needed=true;bed_path=true;
    bottom_color=mix(fallback.color,bent.color,bent.confidence);
    bottom_point=mix(fallback.point.xyz,bent.point.xyz,bent.confidence);
    bottom_radial=radial;
    bottom_depth=max(0.0,water_level-mix(fallback.point.w,bent.point.w,bent.confidence));
    bottom_fp=max(0.01,(t+depth)*2.0*f.view.w/f.view.y/max(0.1,abs(dot(radial,refracted))));
    medium_origin=p;medium_direction=refracted;medium_length=depth;
   }
  }
 }
 // One bottom-light evaluation and one underwater medium integration per
 // pixel: the submerged-floor and refracted-bed cases are mutually exclusive.
 var floor_color=bottom_color;
 if bottom_needed{floor_color=bottom_light(bottom_color,bottom_point,bottom_radial,bottom_depth,bottom_fp);}
 var medium_base=color;
 if submerged{
  if bottom_needed{color=floor_color;}
  if covered{color=mix(transmission,reflection,fresnel);}
  medium_base=color;
 }
 if bed_path{medium_base=floor_color;}
 var medium=medium_base;
 if submerged||bed_path{medium=underwater_medium(medium_origin,medium_direction,medium_length,medium_base,direct_sun,xy);}
 if submerged{color=medium;}
 else if covered{
  if bed_path{transmission=medium;}
  if image>0.0{
   let a=surface_address(p);var seen=measured_albedo(a.hi,a.lo,max(0.002,t*2.0*f.view.w/f.view.y));
   // Over deep water the image has little to show but the straight seams between its source scenes, so it leans on one deep sea colour.
   seen=mix(seen,vec3<f32>(0.0037,0.006,0.013),0.7*smoothstep(30.0,200.0,textureLoad(ocean_depth,xy,0).g));
   transmission=mix(transmission,seen*(vec3<f32>(0.21,0.27,0.34)*day+vec3<f32>(1.8,1.55,1.3)*f.starlight.xyz*max(0.0,dot(radial,f.sun.xyz))*direct_sun),image);
  }
  color=mix(transmission,reflection,fresnel);
  let sun_half=normalize(f.sun.xyz-rd);let ndh=max(0.0,dot(n,sun_half));let a2=pow(roughness,4.0);let d=a2/(3.14159*pow(max(0.0001,ndh*ndh*(a2-1.0)+1.0),2.0));
  let sunup=max(0.0,dot(n,f.sun.xyz));let spec=min(80.0,d*0.02037/(4.0*max(0.08,cosine+sunup)))*sunup;
  color+=vec3<f32>(2.8,2.35,1.7)*spec*direct_sun;
  // Ray-distance subtraction loses sub-metre depth at orbital distances and
  // samples the bed behind the water point. Use shared-triangle clearance.
  let depth=textureLoad(ocean_depth,xy,0).g;
  let left=textureLoad(ocean_depth,clamp(xy-vec2<i32>(1,0),vec2<i32>(0),vec2<i32>(f.view.xy)-1),0);
  let right=textureLoad(ocean_depth,clamp(xy+vec2<i32>(1,0),vec2<i32>(0),vec2<i32>(f.view.xy)-1),0);
  let below=textureLoad(ocean_depth,clamp(xy-vec2<i32>(0,1),vec2<i32>(0),vec2<i32>(f.view.xy)-1),0);
  let above=textureLoad(ocean_depth,clamp(xy+vec2<i32>(0,1),vec2<i32>(0),vec2<i32>(f.view.xy)-1),0);
  let depth_delta=vec2<f32>(select(0.0,right.g-left.g,left.r!=0.0&&right.r!=0.0),select(0.0,above.g-below.g,below.r!=0.0&&above.r!=0.0))*0.5;
  let ground_slope=length(depth_delta)/max(0.002,fp);
  let depth_width=max(0.002,(abs(depth_delta.x)+abs(depth_delta.y))*0.5);
  let crest=smoothstep(0.25,0.6,length(waves.xyz))*smoothstep(0.0,0.4,waves.w)*0.25;
  let incoming=max(0.0,-dot(waves.xyz,vec3<f32>(0.86,0.12,0.50)));
  // A shore's foam, only at a shore: where the mesh's water ends in water the field says goes on, that is the edge of a page's cell. A pixel the mesh left dry has no clearance to go by.
  let equilibrium=filtered_shore_source(depth,depth_width,ground_slope,incoming,waves.w)/0.75*select(1.0-trust*smoothstep(0.9,1.0,here),0.0,claimed>0.0);
  let persistent=surface_foam(f.eye_hi.xyz,lo,equilibrium,height-depth);
  // White water where a river runs steep, broken up by the same film as other foam.
  let coverage=clamp(max(max(persistent,crest*0.35),river_rapids*0.75)*f.water.y,0.0,1.0);
  var foam=0.0;
  if coverage>0.002{let film=foam_film(f.eye_hi.xyz,lo+waves.xyz*0.15,fp);foam=(1.0-exp(-coverage*2.0))*mix(0.65,1.0,film);}
  color=mix(color,vec3<f32>(0.80,0.84,0.78)*(0.3*day+0.7*max(0.0,dot(radial,f.sun.xyz))*direct_sun),foam);
  color=mix(land_color,color,water_coverage);
 }
 // Diagnostic (bit 8388608): what the pass used, as colour: red the mesh's clearance, green the depth the field's page
 // gives at this pixel's footprint, blue the depth the bed path used (each / 20 m); trust and image in the alpha's place.
 if water_diagnostic(8388608u)&&covered&&!submerged{
  let at=page_pos(f.eye_hi.xyz,f.eye_lo.xyz+p);let entry=measured_water_entry(at,fp*0.125);var field_depth=0.0;
  let lw=water_layer_entry(entry,at.face,at.g);if lw!=0u{let w=water_layer_at(lw,at);if w.level>WATER_NONE{field_depth=w.level-page_height_read(lw,at.g,at.frac).x;}}
  textureStore(water_out,xy,vec4<f32>(textureLoad(ocean_depth,xy,0).g/20.0,field_depth/20.0,select(0.0,bottom_depth/20.0,bed_path),1));return;
 }
 textureStore(water_out,xy,vec4<f32>(color,select(1.0+water_coverage,0.0,submerged)));
}
