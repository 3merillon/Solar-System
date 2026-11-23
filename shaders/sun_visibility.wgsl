// Direct-light contract: solid visibility and cloud optical depth are distinct.
// All positions are camera-relative corrected surface positions, in metres.
const SUN_CASCADES:u32=6u;
// Canonical radial height clipmaps: nine levels with x4 spacing (1 m .. 65536 m)
// of SUN_HEIGHT_SIZE texels each. Every texel stores the full filtered height
// and a coarse height that omits the per-level live bands (field_live_bands).
const SUN_HEIGHT_LEVELS:u32=9u;
fn sun_height_size()->i32{return i32(f.tier_b.z);}
struct SunFrame {
 right:vec4<f32>, up:vec4<f32>,
 centers:array<vec4<f32>,6>, // camera-relative snapped light center, half extent
 control:vec4<f32>, // enabled, diagnostic, angular radius, terrain work limit
 metrics:vec4<f32>, // height bound, input camera altitude, overflow bits, incomplete-caster bits
 origins:array<vec4<u32>,6>, // absolute light texel at viewport origin, wrapping u32
 height_errors:array<vec4<f32>,12>, // x full-cache envelope, y two-part residual envelope, z first live band, w omitted producer spectrum
 cloud_centers:array<vec4<f32>,3>, // GPU-produced exact current chart anchors
 ceilings:array<vec4<u32>,3>, // GPU-produced ordered-float maxima of cached full heights per level
 cache_control:vec4<u32>, // frame index, animated refresh divisor, animation or sun drift advanced, sun drift
 quality:vec4<f32>, // active prop shadow cascades, profile sample scale, reserved
 height_refresh:vec4<u32>, // x: bit mask of height clipmap levels to refill (measured pages arrived)
}
@group(0) @binding(64) var<uniform> sf:SunFrame;
@group(0) @binding(65) var sun_heights:texture_2d_array<f32>;
@group(0) @binding(66) var sun_depth:texture_depth_2d_array;
@group(0) @binding(67) var sun_compare:sampler_comparison;
@group(0) @binding(68) var sun_cloud_global:texture_2d_array<f32>;
@group(0) @binding(69) var sun_cloud_local:texture_2d_array<f32>;
@group(0) @binding(70) var sun_sampler:sampler;
@group(0) @binding(83) var sun_wrap_sampler:sampler;
// Block maxima of the cached full height, one map per clipmap level (see
// sun_height_maxima): per texel the highest cached full height in the 2, 4, 8
// and 16 texel blocks that contain it (x, y, z, w; blocks aligned to absolute
// texel multiples), each taken over the block and one texel past its high
// edges, so it bounds the bilinear cached height at every point of the block.
// They depend on the terrain alone: the sun never enters them.
@group(0) @binding(96) var sun_maxima:texture_2d_array<f32>;

fn sun_face(p:vec3<f32>)->u32{let a=abs(p);if a.x>=max(a.y,a.z){return select(1u,0u,p.x>=0.0);}if a.y>=a.z{return select(3u,2u,p.y>=0.0);}return select(5u,4u,p.z>=0.0);}
// Chart position as a double-single pair (hi plus its rounding remainder lo)
// and the projective depth z. Near a face edge a chart coordinate is about
// 6.4e6 m, which f32 resolves to half a metre; texel indices formed from hi
// and lo separately stay exact to millimetres.
struct SunChart {hi:vec2<f32>,lo:vec2<f32>,z:f32}
fn sun_chart_split(point:vec3<f32>,face:u32)->SunChart{
 let a=sc_face_project(face,f.eye_hi.xyz);let b=sc_face_project(face,f.eye_lo.xyz+f.eye_tail.xyz+point);
 let den=ds_add(vec2<f32>(a.z,0),vec2<f32>(b.z,0));
 let x=ds_mul(sc_ds_div(ds_add(vec2<f32>(a.x,0),vec2<f32>(b.x,0)),den),vec2<f32>(f.planet.x,0));
 let y=ds_mul(sc_ds_div(ds_add(vec2<f32>(a.y,0),vec2<f32>(b.y,0)),den),vec2<f32>(f.planet.x,0));
 return SunChart(vec2<f32>(x.x,y.x),vec2<f32>(x.y,y.y),den.x+den.y);
}
fn sun_chart(point:vec3<f32>,face:u32)->vec3<f32>{let c=sun_chart_split(point,face);return vec3<f32>(c.hi+c.lo,c.z);}
// Monotone unsigned encoding of f32 for atomic maxima of signed heights.
fn sun_order_float(v:f32)->u32{let b=bitcast<u32>(v);return select(b^0x80000000u,~b,(b&0x80000000u)!=0u);}
fn sun_unorder_float(v:u32)->f32{return bitcast<f32>(select(~v,v^0x80000000u,(v&0x80000000u)!=0u));}
fn sun_height_step(level:u32)->f32{return exp2(2.0*f32(level));}
// Window centre of a level in texels: the eye's chart cell snapped to eight
// texels, shared by the producer, the block maxima and every consumer.
fn sun_height_window(eye:vec2<f32>,step:f32)->vec2<i32>{return vec2<i32>(floor(eye/(8.0*step)))*8;}
fn sun_height_center(level:u32)->vec2<i32>{let face=sun_face(f.eye_hi.xyz+f.eye_lo.xyz);return sun_height_window(sun_chart(vec3<f32>(0),face).xy,sun_height_step(level));}
// Finest resident level at chart point x that is no finer than floor_level
// (SUN_HEIGHT_LEVELS when none covers it). Resident means the whole 4-texel
// block and its ring lie inside the level's window.
fn sun_resident_level(x:vec2<f32>,eye:vec2<f32>,floor_level:u32)->u32{
 for(var l=floor_level;l<SUN_HEIGHT_LEVELS;l++){let step=sun_height_step(l);let delta=abs(x/step-vec2<f32>(sun_height_window(eye,step)));if max(delta.x,delta.y)<f32(sun_height_size()/2-8){return l;}}
 return SUN_HEIGHT_LEVELS;
}
// Bilinear full/coarse height of one level from an exact texel index and the
// fraction inside it, or step -1 outside its window. The producer validates
// every texel of the current window before consumers run, so no per-texel
// key check is repeated here. The march addresses texels this way because
// absolute chart coordinates near a face edge (about 6.4e6 m) only resolve
// half a metre in f32; positions relative to the receiver's own texel stay
// exact to millimetres.
fn sun_height_cell(cell:vec2<i32>,frac:vec2<f32>,eye:vec2<f32>,level:u32)->vec3<f32>{
 let step=sun_height_step(level);let delta=abs(vec2<f32>(cell)+frac-vec2<f32>(sun_height_window(eye,step)));
 if max(delta.x,delta.y)>f32(sun_height_size()/2-3){return vec3<f32>(0,0,-1);}
 var h=vec2<f32>(0);
 for(var y=0;y<2;y++){for(var x=0;x<2;x++){let c=cell+vec2<i32>(x,y);let xy=(c%vec2<i32>(sun_height_size())+vec2<i32>(sun_height_size()))%vec2<i32>(sun_height_size());
  h+=textureLoad(sun_heights,xy,i32(level),0).xy*(select(1.0-frac.x,frac.x,x==1)*select(1.0-frac.y,frac.y,y==1));
 }}
 return vec3<f32>(h,step);
}
fn sun_height_level(q:vec3<f32>,eye:vec2<f32>,level:u32)->vec3<f32>{
 if q.z<f.planet.x*0.25{return vec3<f32>(0,0,-1);}
 let coord=q.xy/sun_height_step(level);let cell=vec2<i32>(floor(coord));
 return sun_height_cell(cell,coord-vec2<f32>(cell),eye,level);
}
// x: full filtered height, y: coarse height of the level actually used for the
// coarse channel, z: that level's spacing (-1: canonical fallback).
// Cached two-channel height (full, coarse, level step) at p; z<0 when no
// resident level covers p, so callers choose their own live fallback.
fn sun_cached_height(p:vec3<f32>,footprint:f32)->vec3<f32>{
 // Spatial blend across residency borders and light-footprint levels. The
 // coarser result is still occluding terrain, never a fade towards illumination.
 let level=u32(clamp(floor(log2(max(1.0,footprint))*0.5),0.0,f32(SUN_HEIGHT_LEVELS-1u)));
 let face=sun_face(f.eye_hi.xyz+f.eye_lo.xyz);let chart=sun_chart(p,face);let eye=sun_chart(vec3<f32>(0),face).xy;
 // One level lookup per iteration (a single inlined copy): a blend towards
 // the coarser level reads it on the next iteration.
 var previous=vec3<f32>(0.0,0.0,-1.0);var blend=0.0;
 for(var l=level;l<SUN_HEIGHT_LEVELS;l++){
  let a=sun_height_level(chart,eye,l);
  if previous.z>0.0{
   // The coarse channel and its envelope come from the coarser level alone:
   // mixing two coarse channels with different live sets has no meaning. An
   // unresident coarser level keeps the finer sample.
   if a.z>0.0{return vec3<f32>(mix(previous.x,a.x,blend),a.y,a.z);}
   return previous;
  }
  if a.z<0.0{continue;}
  let q=chart.xy/a.z;let delta=abs(q-vec2<f32>(sun_height_window(eye,a.z)));
  let edge=smoothstep(f32(sun_height_size()/2-28),f32(sun_height_size()/2-4),max(delta.x,delta.y));let spectral=smoothstep(1.0,4.0,footprint/a.z);blend=max(edge,spectral);
  if blend>0.0&&l+1u<SUN_HEIGHT_LEVELS{previous=a;continue;}
  return a;
 }
 return previous;
}
fn sun_terrain_height(p:vec3<f32>,footprint:f32)->vec3<f32>{
 let cached=sun_cached_height(p,footprint);if cached.z>0.0{return cached;}
 let h=surface_height_only(p,max(1.0,footprint));return vec3<f32>(h,h,-1);
}
// Exact inner-sphere occultation. Terrain above that sphere is queried below.
fn sun_planet(p:vec3<f32>)->f32{
 let height=sc_radial_height(p);let world=f.eye_hi.xyz+(f.eye_lo.xyz+p);let b=dot(world,f.sun.xyz);
 if b>=0.0{return 1.0;}let core=-sf.metrics.x;let c=(height-core)*(2.0*f.planet.x+height+core);
 return select(1.0,0.0,b*b>c);
}
// work: canonical samples plus cached scan samples / 1000, diagnostics only.
struct SunTerrain {visibility:f32,unresolved:f32,work:f32}
// Audit-only trace of the last query: [0] and [1] the two march minima
// (normalized cached clearance, lattice coordinate, level, in the canonical
// band), [3] receiver start minus height, residual, canonical and cached
// sample counts.
var<private> sun_dbg:array<vec4<f32>,9>;
// The march samples the ray at a lattice of distances from the receiver,
// fixed in the world: every SUN_SPACING_FLOOR metres out to
// SUN_SPACING_FLOOR / SUN_SPACING_SLOPE (208 m), then that fraction of the
// distance (a world-fixed part of the penumbra). u is the lattice coordinate.
// Samples sit at multiples of a power-of-two stride chosen so that a level is
// read about twice per texel (a sublattice of the same world-fixed points),
// from the first at or beyond the sample floor t_min (sun_lattice_from). The camera only moves
// that floor and, through the camera-centred windows, the level and stride;
// it never slides a sample along the ray (steps scaled with the pixel
// footprint would let crests slip between samples as the camera moves). A lattice point moves continuously with the
// receiver and the sun.
const SUN_SPACING_FLOOR:f32=0.25;
const SUN_SPACING_SLOPE:f32=0.0012;
fn sun_lattice_u(t:f32)->f32{let t1=SUN_SPACING_FLOOR/SUN_SPACING_SLOPE;if t<=t1{return t/SUN_SPACING_FLOOR;}return 1.0/SUN_SPACING_SLOPE+log(t/t1)/log(1.0+SUN_SPACING_SLOPE);}
fn sun_lattice_t(u:f32)->f32{let u1=1.0/SUN_SPACING_SLOPE;if u<=u1{return u*SUN_SPACING_FLOOR;}return SUN_SPACING_FLOOR/SUN_SPACING_SLOPE*exp((u-u1)*log(1.0+SUN_SPACING_SLOPE));}
// The first sample at or after lattice point u at a stride. Nothing nearer
// than the first multiple is sampled: inside half a texel of the level read
// there, a coarse level only interpolates around the receiver, and sampling
// it there made the result depend on the footprint (which points the floor
// excludes) for no information the level holds.
fn sun_lattice_from(u:f32,stride:f32)->f32{return ceil(u/stride-1e-4)*stride;}
fn sun_lattice_next(u:f32,stride:f32)->f32{return sun_lattice_from(u+1.0,stride);}
// Finest level whose texel is at least the sample spacing: the cached field is
// read at the scale the samples resolve (up to the penumbra width), never finer.
// The level steps up where the spacing passes 4^level, at a fixed distance t.
fn sun_spacing_level(s:f32)->u32{return u32(clamp(ceil(log2(s)*0.5),0.0,f32(SUN_HEIGHT_LEVELS-1u)));}
// Texel index and fraction of a chart offset from a split chart position at
// one level's spacing, formed without the absolute coordinate's rounding.
struct SunCell {cell:vec2<i32>,frac:vec2<f32>}
fn sun_ray_cell(c:SunChart,offset:vec2<f32>,st:f32)->SunCell{
 let hs=c.hi/st;let fh=floor(hs);let rel=(hs-fh)+(c.lo+offset)/st;let fl=floor(rel);
 return SunCell(vec2<i32>(fh)+vec2<i32>(fl),rel-fl);
}
fn sun_block_maxima(cell:vec2<i32>,level:u32)->vec4<f32>{let n=vec2<i32>(sun_height_size());return textureLoad(sun_maxima,((cell%n)+n)%n,i32(level),0);}
// Along x(w) = x + v w from a point inside the box [lo, hi]: the w at which it leaves.
fn sun_box_exit(x:vec2<f32>,v:vec2<f32>,lo:vec2<f32>,hi:vec2<f32>)->f32{
 var w=1e30;
 for(var i=0;i<2;i++){if v[i]>0.0{w=min(w,(hi[i]-x[i])/v[i]);}else if v[i]<0.0{w=min(w,(lo[i]-x[i])/v[i]);}}
 return max(w,0.0);
}
// The w at which x(w) = x + v w enters the box [lo, hi] (0 when inside), 1e30 when it never does.
fn sun_box_entry(x:vec2<f32>,v:vec2<f32>,lo:vec2<f32>,hi:vec2<f32>)->f32{
 var near=0.0;var far=1e30;
 for(var i=0;i<2;i++){
  if v[i]==0.0{if x[i]<lo[i]||x[i]>hi[i]{return 1e30;}continue;}
  let a=(lo[i]-x[i])/v[i];let b=(hi[i]-x[i])/v[i];near=max(near,min(a,b));far=min(far,max(a,b));
 }
 return select(1e30,near,near<=far);
}
// One level's texel frame along the ray: chart texel of the receiver
// (cell + frac) and the texels per unit w, and the receiver relative to the
// level's window centre. A point of the ray is then cell + frac + v w.
struct SunFrameLevel {cell:vec2<i32>,frac:vec2<f32>,v:vec2<f32>,centre:vec2<f32>}
fn sun_level_frame(c:SunChart,k:vec2<f32>,eye:vec2<f32>,level:u32)->SunFrameLevel{
 let st=sun_height_step(level);let hs=c.hi/st;let fh=floor(hs);let frac=(hs-fh)+c.lo/st;let cell=vec2<i32>(fh);
 return SunFrameLevel(cell,frac,k/st,vec2<f32>(cell-sun_height_window(eye,st))+frac);
}
// start_hint: the receiver's canonical height when the caller already has it
// (terrain shading); otherwise below -1e29 and estimated from the cache.
//
// Terrain visibility: the exact ray toward the sun, marched from the receiver
// over the cached canonical height clipmaps. Each lattice sample reads the
// level the spacing calls for (or the finest resident one beyond that level's
// window), blended toward the next coarser level across a window's last 32
// texels so a sample's height never jumps when a window boundary crosses it.
// Every quantity is a continuous function of the receiver, the sun and the
// cached heights, and the cache itself does not depend on the sun, so a
// drifting sun moves shadow edges continuously.
//
// Acceleration that does not change the answer: a block whose maximum
// (sun_maxima; in a blend band, the larger of both levels' blocks) stays below
// the ray by more than the penumbra plus the sub-texel crest margin over the
// whole block holds no lattice sample that could be a candidate (below), so
// the march jumps to the first lattice point past it. A jump stops where the
// level's blend band begins and where the level changes (a finer window
// entered, the window left, the spacing calling for a coarser level), so
// every skipped sample would have read the same field. The march ends when the
// rising ray is above every cached height (sf.ceilings) by the penumbra and
// crest margin while climbing faster than the penumbra widens.
//
// Refinement: the lowest minimum of the normalized cached clearance, when its
// clearance is within the penumbra plus the crest margin (the cached field can
// miss a crest by that much), is evaluated on the canonical field at its
// lattice point and its neighbours one stride away, with the existing
// two-stage live evaluation; the runner-up minimum (a distinct crest at least
// three strides away) keeps its cached visibility, and the visibility is the
// minimum of those. A sample the cache puts deeper than that band is confirmed
// with one canonical sample: the query ends in shadow if it holds, and the
// march resumes past it if the canonical field clears it. Declared
// approximation: apart from the lowest minimum and the confirmed samples, the
// cached field is the occluder model; a crest the cache misses by more than the
// level's crest margin (a spectral estimate, not a bound, on measured bodies)
// is missed. Receivers no level covers march the canonical field with the
// geometric progression and stay flagged unresolved, as do receivers whose march
// does not finish in SUN_MARCH_LIMIT steps.
// steep: the tangent of the receiver's slope (0 on level ground). On a slope a receiver's height spans its tangent
// times the finest resident texel (or its own footprint) across one texel, and which crest binds it moves with
// the camera-centred windows: on a 45 degree wall that is metres, and the edge stepped and crawled with the camera.
// The shadow edge there is widened by half that span, at most SUN_STEEP_SOFT; on level ground nothing changes.
const SUN_STEEP_SOFT:f32=4.0;
// Cached march steps and block jumps per query, over all rounds.
const SUN_MARCH_LIMIT:u32=384u;
// A query runs in rounds: a cached march, then the canonical samples it asks
// for, evaluated together after the march so the lanes of a workgroup run the
// expensive canonical evaluation in step (inside the march loop each lane
// reached it on a different iteration, and the GPU ran it once per distinct
// iteration). A deep sample the canonical field clears starts another round;
// the first round estimates the receiver height when it is not given.
const SUN_ROUNDS:u32=5u;
// Canonical samples per round: the refined minimum and its two neighbours (or
// one confirmation), then up to sixteen off-cache samples.
const SUN_CANONICAL:u32=19u;
fn sun_terrain(p:vec3<f32>,footprint:f32,start_hint:f32,steep:f32)->SunTerrain{
 if sun_planet(p)==0.0{return SunTerrain(0,0,0);}
 let height=sc_radial_height(p);let radial=normalize(f.eye_hi.xyz+f.eye_lo.xyz+p);
 let bound=sf.metrics.x;
 if height>bound&&dot(radial,f.sun.xyz)>=0.0{return SunTerrain(1,0,0);}
 let receiver_footprint=max(0.25,footprint);
 // No sample nearer the receiver than its own footprint: a crest inside one
 // footprint belongs to the filtered receiver surface itself, so it casts no
 // shadow at that filter scale. Camera distance adds a numerical floor:
 // positions are camera-relative f32, so at |p| the ray can only be placed to
 // an ulp, and a sample whose penumbra is not many ulps wide would compare
 // rounding against it (the orbit view showed this as per-pixel shadow noise).
 // Twenty ulps are a twentieth of the penumbra 4300 ulps out, and reach the
 // 5 cm penumbra floor 21 km from the camera, so the floor is zero nearer than
 // that and ramps in as a continuous fraction of the distance rather than the
 // power-of-two step of the ulp itself. Pixel footprints exceed it at any
 // screen resolution, so it only guards callers with fixed small footprints.
 let camera_distance=length(p);
 let t_min=max(max(0.5,receiver_footprint),0.00049*camera_distance*smoothstep(21000.0,42000.0,camera_distance));
 let skip_refine=(u32(f.cloud_drift.z)&8192u)!=0u;
 let d=f.sun.xyz;let face=sun_face(f.eye_hi.xyz+f.eye_lo.xyz);
 let eye=sun_chart(vec3<f32>(0),face).xy;let split=sun_chart_split(p,face);let chart0=vec3<f32>(split.hi+split.lo,split.z);
 // The ray's chart image: chart0 + k w with w = t / (1 + g t) (a straight line, projective in t).
 let b=sc_face_project(face,d);let k=(f.planet.x*b.xy-chart0.xy*b.z)/chart0.z;let g=b.z/chart0.z;
 // The ray's radial height as sc_radial_height forms it: D(t) = D0 + B t + t^2
 // (|d| = 1), lowest where t = -B / 2.
 let radius=f.planet.x+f.eye_hi.w;let up_eye=normalize(f.eye_hi.xyz+f.eye_lo.xyz);
 let D0=2.0*radius*dot(p,up_eye)+dot(p,p);let B=2.0*radius*dot(d,up_eye)+2.0*dot(p,d);let lowest=-0.5*B;
 var estimating=start_hint<=-1e29;var start=start_hint;var residual=0.0;
 var visibility=1.0;var unresolved=0.0;var samples=0u;let budget=max(1u,u32(sf.control.w));
 let level0=sun_resident_level(chart0.xy,eye,0u);let level_hint=min(level0,SUN_HEIGHT_LEVELS-1u);
 let soft=min(SUN_STEEP_SOFT,0.5*steep*max(receiver_footprint,sun_height_step(level_hint)));
 var ceiling=-1e30;for(var l=0u;l<SUN_HEIGHT_LEVELS;l++){ceiling=max(ceiling,sun_unorder_float(sf.ceilings[l/4u][l%4u]));}
 let n=sun_height_size();var u=ceil(sun_lattice_u(t_min)-1e-4);
 // The level in use and its frames (this level and the next coarser), valid until t_next.
 var level=SUN_HEIGHT_LEVELS;var t_next=-1.0;var fl=SunFrameLevel(vec2<i32>(0),vec2<f32>(0),vec2<f32>(0),vec2<f32>(0));var fu=fl;
 var crest=0.0;var margin_up=0.0;var stride=1.0;
 // Candidates: normalized cached clearance, lattice coordinate, level, and the
 // stride when the clearance is inside the band that needs the canonical field
 // (0 outside). probe: the deep sample being confirmed.
 var best=vec4<f32>(1e30,0,0,0);var second=vec4<f32>(1e30,0,0,0);var probe=vec4<f32>(0);
 var off_cache=false;var fallback_t=t_min;var fallback_steps=0u;var cheap=0u;
 var steps=0u;var jumps=0u;var confirms=0u;var confirmed=-1e30;
 for(var round=0u;round<SUN_ROUNDS;round++){
  // The cached march, until it ends, leaves the cache or finds a deep sample.
  var deep=false;
  if !estimating{
   for(var i=0u;i<SUN_MARCH_LIMIT;i++){
    if steps>=SUN_MARCH_LIMIT{unresolved=1.0;break;}steps++;
    let t=sun_lattice_t(u);let den=1.0+g*t;
    if den<=0.0{off_cache=true;fallback_t=t;break;}
    let w=t/den;
    if t>=t_next{
     // A level change: the spacing's level or the finest resident one beyond it.
     let ls=sun_spacing_level(max(SUN_SPACING_FLOOR,SUN_SPACING_SLOPE*t));level=sun_resident_level(chart0.xy+k*w,eye,ls);
     if level>=SUN_HEIGHT_LEVELS{off_cache=true;fallback_t=t;break;}
     fl=sun_level_frame(split,k,eye,level);crest=sf.height_errors[level].w;
     if level+1u<SUN_HEIGHT_LEVELS{fu=sun_level_frame(split,k,eye,level+1u);margin_up=max(crest,sf.height_errors[level+1u].w);}
     // Until the window is left, a finer window is entered (only when the
     // spacing would read it) or the spacing calls for the next level.
     var dw=sun_box_exit(fl.centre+fl.v*w,fl.v,vec2<f32>(-f32(n/2-8)),vec2<f32>(f32(n/2-8)));
     if level>ls{let ff=sun_level_frame(split,k,eye,level-1u);dw=min(dw,sun_box_entry(ff.centre+ff.v*w,ff.v,vec2<f32>(-f32(n/2-8)),vec2<f32>(f32(n/2-8))));}
     let we=w+dw;let dn=1.0-g*we;t_next=max(min(select(1e30,we/dn,dn>0.0),exp2(2.0*f32(level))/SUN_SPACING_SLOPE),t*1.000001+1e-3);
     let st=sun_height_step(level);stride=exp2(max(0.0,floor(log2(0.5*st/max(SUN_SPACING_FLOOR,SUN_SPACING_SLOPE*t)))));
     u=sun_lattice_from(u,stride);continue;
    }
    let rel=fl.frac+fl.v*w;let flr=floor(rel);let cell=fl.cell+vec2<i32>(flr);let frac=rel-flr;let centre=fl.centre+fl.v*w;
    let edge=smoothstep(f32(n/2-40),f32(n/2-8),max(abs(centre.x),abs(centre.y)));
    let blend=edge>0.0&&level+1u<SUN_HEIGHT_LEVELS;
    let D=D0+t*(B+t);let h=f.eye_hi.w+D/(sqrt(max(1.0,radius*radius+D))+radius);
    let pen=max(0.05,t*sf.control.z)+soft;
    if h-ceiling>pen+crest&&(t-lowest)>sf.control.z*(radius+h){break;}
    let relu=fu.frac+fu.v*w;let flu=floor(relu);let cellu=fu.cell+vec2<i32>(flu);let fracu=relu-flu;
    {
     // In the blend band a sample mixes this level with the next coarser one,
     // so a jump there needs both levels' blocks, is bounded by the larger and
     // carries the coarser level's wider crest margin.
     let m=sun_block_maxima(cell,level);var mu=vec4<f32>(-1e30);if blend{mu=sun_block_maxima(cellu,level+1u);}
     let margin=select(crest,margin_up,blend);var jump=0.0;
     for(var j=3;j>=0;j--){
      let top=max(m[j],mu[j]);
      // Necessary at the block's start already (the ray is no lower there than its lowest point in the block).
      if h-top<pen+margin{continue;}
      let size=4<<u32(2*j);let lo=cell&vec2<i32>(-size);
      var dw=sun_box_exit(vec2<f32>(cell-lo)+frac,fl.v,vec2<f32>(0),vec2<f32>(f32(size)));
      if blend{dw=min(dw,sun_box_exit(vec2<f32>(cellu-(cellu&vec2<i32>(-size)))+fracu,fu.v,vec2<f32>(0),vec2<f32>(f32(size))));}
      else{dw=min(dw,sun_box_exit(centre,fl.v,vec2<f32>(-f32(n/2-40)),vec2<f32>(f32(n/2-40))));}
      let we=w+dw;let dn=1.0-g*we;let te=min(select(1e30,we/dn,dn>0.0),t_next);
      if te>=1e29{continue;}
      let tl=clamp(lowest,t,te);let Dl=D0+tl*(B+tl);let low=f.eye_hi.w+Dl/(sqrt(max(1.0,radius*radius+Dl))+radius);
      if low-top>=max(0.05,te*sf.control.z)+soft+margin{jump=te;break;}
     }
     // The first sample of the sequence at or past the block: a doubling point or a stride multiple.
     if jump>0.0{u=max(sun_lattice_next(u,stride),sun_lattice_from(sun_lattice_u(jump),stride));cheap++;jumps++;continue;}
    }
    var field=sun_height_cell(cell,frac,eye,level).x;
    if blend{let c=sun_height_cell(cellu,fracu,eye,level+1u);if c.z>0.0{field=mix(field,c.x,edge);}}
    let correction=residual*(1.0-smoothstep(0.0,max(2.0,footprint*2.0),t));
    // A candidate's refinement neighbours sit one stride away.
    let clearance=h-field+correction+0.025;let nc=clearance/pen;let entry=vec4<f32>(nc,u,f32(level),select(0.0,stride,clearance<pen+crest));
    if nc<best.x{if best.x<1e29&&abs(u-best.y)>=3.0*stride{second=best;}best=entry;}
    else if nc<second.x&&abs(u-best.y)>=3.0*stride{second=entry;}
    cheap++;u=sun_lattice_next(u,stride);
    // Deeper than the band: confirm it on the canonical field (at most three
    // times, never twice for one crest); the march resumes if it clears.
    if clearance< -(pen+crest)&&confirms<3u&&entry.y-confirmed>2.0*stride{deep=true;probe=entry;confirms++;break;}
   }
  }
  // The round's canonical samples: the receiver estimate, a confirmation, or
  // the refinement of the lowest minimum followed by the off-cache samples.
  let refine=!estimating&&!deep&&best.x<1e29&&best.w>0.5;
  for(var i=0u;i<SUN_CANONICAL;i++){
   var t=0.0;var rl=level_hint;var off=false;
   if estimating{if i>0u{break;}}
   else if deep{if i>0u{break;}t=sun_lattice_t(probe.y);rl=u32(probe.z);}
   else if refine&&i<3u{t=sun_lattice_t(best.y+(f32(i)-1.0)*best.w);rl=u32(best.z);if t<t_min{continue;}}
   else{if !off_cache||fallback_steps>=16u{break;}t=fallback_t;off=true;}
   if samples>=budget{unresolved=1.0;break;}samples++;
   let q=p+d*t;let h=sc_radial_height(q);let penumbra=max(0.05,t*sf.control.z)+select(soft,0.0,estimating);
   let spacing=select(max(SUN_SPACING_FLOOR,SUN_SPACING_SLOPE*t),receiver_footprint,estimating);
   // Receiver discrepancy is local and decays within two source cells. This is
   // a reconstruction residual, not a depth bias applied to all distant casters.
   let correction=select(residual*(1.0-smoothstep(0.0,max(2.0,footprint*2.0),t)),0.0,estimating);
   var sample=vec3<f32>(0.0,0.0,-1.0);
   if !off&&1.0+g*t>0.0{let st=sun_height_step(rl);let at=sun_ray_cell(split,k*(t/(1.0+g*t)),st);sample=sun_height_cell(at.cell,at.frac,eye,rl);}
   let covered=sample.z>0.0;
   // Filtered caches are candidate accelerators, not conservative occluders.
   // A sample is first refined with the cached coarse bands plus a live
   // evaluation of the level's fine bands; only when that estimate still falls
   // inside its own envelope around the penumbra band is the full canonical
   // spectrum evaluated. Points no level covers evaluate the canonical field.
   var base=sample.y;var live_start=24u;var band_footprint=spacing;var envelope=vec4<f32>(0);var field=sample.x;
   // One address per march point for every read below (each surface_address call inlines about a thousand lines).
   let qa=surface_address(q);
   if covered&&!field_measured(){envelope=sf.height_errors[rl];if estimating||!skip_refine{live_start=u32(envelope.z);}}
   else{base=surface_edits(qa);live_start=0u;band_footprint=max(1.0,spacing);}
   var clearance=h-field+correction+0.025;
   for(var refinement=0u;refinement<2u;refinement++){
    if live_start>=24u{break;}
    field=base+field_live_bands(qa.hi,qa.lo,band_footprint,live_start);clearance=h-field+correction+0.025;
    let again=select(abs(clearance)<penumbra+envelope.y,clearance<envelope.y+0.025,estimating);
    if live_start==0u||!again{break;}
    base=surface_edits(qa);live_start=0u;
   }
   if estimating{start=field;residual=max(0.0,start-height);break;}
   visibility=min(visibility,smoothstep(-penumbra,penumbra,clearance));
   if visibility<0.001{
    sun_dbg[0]=best;sun_dbg[1]=second;sun_dbg[3]=vec4<f32>(start-height,residual,f32(samples),f32(cheap));
    if sf.control.y==7.0{return SunTerrain(f32(steps)/f32(SUN_MARCH_LIMIT),f32(jumps)/128.0,0);}
    return SunTerrain(0,unresolved,f32(samples)+f32(cheap)*0.001);
   }
   // Off the cache: the geometric progression from where the march
   // left it until the ray clears the height bound, at most sixteen canonical
   // samples, unresolved.
   if off{unresolved=1.0;fallback_t=fallback_t*1.25+0.5;fallback_steps++;if h>bound&&dot(normalize(f.eye_hi.xyz+f.eye_lo.xyz+q),d)>0.0{fallback_steps=16u;}}
  }
  if estimating{estimating=false;continue;}
  if deep{
   // Cleared on the canonical field: that crest is settled; the march goes on past it.
   confirmed=probe.y;
   if abs(best.y-confirmed)<3.0*probe.w{best=second;second=vec4<f32>(1e30,0,0,0);}else if abs(second.y-confirmed)<3.0*probe.w{second=vec4<f32>(1e30,0,0,0);}
   u=max(u,confirmed+2.0*probe.w);continue;
  }
  break;
 }
 // The runner-up minimum keeps its cached visibility.
 if second.x<1e29{visibility=min(visibility,smoothstep(-1.0,1.0,second.x));}
 sun_dbg[0]=best;sun_dbg[1]=second;sun_dbg[3]=vec4<f32>(start-height,residual,f32(samples),f32(cheap));
 if sf.control.y==7.0{return SunTerrain(f32(steps)/f32(SUN_MARCH_LIMIT),f32(jumps)/128.0,0);}
 return SunTerrain(visibility,unresolved,f32(samples)+f32(cheap)*0.001);
}
fn sun_project(p:vec3<f32>,level:u32)->vec3<f32>{let c=sf.centers[level];var lift=vec3<f32>(0);if f.eye_tail.w<1.5{lift=(f.eye_hi.w-sf.metrics.y)*normalize(f.eye_hi.xyz+f.eye_lo.xyz);}let q=p-c.xyz+lift;return vec3<f32>(dot(q,sf.right.xyz)/c.w,dot(q,sf.up.xyz)/c.w,0.5-dot(q,f.sun.xyz)/65536.0);}
fn sun_prop_level(p:vec3<f32>,normal:vec3<f32>,level:u32)->f32{
 let map=f32(f.tier_b.x);let texel=sf.centers[level].w/(map*0.5);
 // Metric offset is limited to a fraction of a texel; split positions and a
 // fixed 65km depth interval retain near-ground depth precision.
 let q=sun_project(p+normal*min(0.08,texel*0.12)+f.sun.xyz*0.015,level);let uv=q.xy*vec2<f32>(0.5,-0.5)+0.5;
 let blocker=textureLoad(sun_depth,clamp(vec2<i32>(uv*map),vec2<i32>(0),vec2<i32>(i32(map)-1)),i32(level),0);
 // Light grazing the receiver stretches one shadow-map texel across it, by 1/cos of the incidence: the filter
 // widens with it, so a wall or a low-sun slope does not show the map's texels as steps.
 let grazing=0.45/max(0.3,abs(dot(normal,f.sun.xyz)));
 let separation=max(0.0,(q.z-blocker)*65536.0);let radius=clamp(max(separation*sf.control.z/texel,grazing),0.45,2.0);
 // Each PCF tap lies at a different light depth on a tilted surface.
 // Project that plane into the map's axes, including the flipped texture Y.
 let nl=dot(normal,f.sun.xyz);
 let slope=clamp(vec2<f32>(dot(normal,sf.right.xyz),-dot(normal,sf.up.xyz))
     *select(-1.0,1.0,nl>=0.0)/max(.18,abs(nl)),vec2<f32>(-3),vec2<f32>(3));
 var result=0.0;
 for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
  let delta=vec2<f32>(f32(x),f32(y))*radius;
  let depth=q.z+clamp(dot(slope,delta)*texel,-1.5,1.5)/65536.0;
  result+=textureSampleCompareLevel(sun_depth,sun_compare,uv+delta/map,i32(level),depth);
 }}
 return result/9.0;
}
fn sun_props(p:vec3<f32>,normal:vec3<f32>)->f32{
 let cascades=min(SUN_CASCADES,u32(sf.quality.x));
 for(var level=0u;level<cascades;level++){let q=sun_project(p,level);let edge=max(abs(q.x),abs(q.y));
  if edge>=0.98||q.z<=0.0||q.z>=1.0{continue;}let a=sun_prop_level(p,normal,level);
  // Every quality tier has a finite last map. A hard square edge there
  // would switch directly to full sunlight (especially visible on Moon/Mars).
  // Fade shadow detail out smoothly inside an inscribed circle before any
  // receiver can reach the allocation boundary; other occlusion stays active.
  if level+1u==cascades&&sf.control.y!=6.0{return mix(a,1.0,smoothstep(0.65,0.97,length(q.xy)));}
  if level+1u<cascades&&edge>0.75{return mix(a,sun_prop_level(p,normal,level+1u),smoothstep(0.75,0.98,edge));}return a;
 }return 1.0;
}
fn sun_rock_resolution(p:vec3<f32>,radius:f32)->f32{
 let cascades=min(SUN_CASCADES,u32(sf.quality.x));
 for(var level=0u;level<cascades;level++){
  let q=sun_project(p,level);let edge=max(abs(q.x),abs(q.y));
  if edge>=0.98||q.z<=0.0||q.z>=1.0{continue;}
  let a=smoothstep(0.2,0.6,radius*f32(f.tier_b.x)*0.5/sf.centers[level].w);
  if level+1u==cascades{return a*(1.0-smoothstep(0.65,0.97,length(q.xy)));}
  let b=smoothstep(0.2,0.6,radius*f32(f.tier_b.x)*0.5/sf.centers[level+1u].w);
  return mix(a,b,smoothstep(0.75,0.98,edge));
 }
 return 0.0;
}
// Cloud profile sampling is supplied by sun_clouds.wgsl.
struct SunVisibility {solid:f32,cloud:f32,unresolved:f32}
// steep: the ground receiver's slope tangent (sunlight_ground), 0 for anything else: a leaf's normal is no slope.
fn sunlight_at(p:vec3<f32>,ground:vec3<f32>,normal:vec3<f32>,footprint:f32,start_hint:f32,steep:f32)->SunVisibility{
 if sf.control.x<0.5{return SunVisibility(smoothstep(-0.04,0.03,dot(normalize(f.eye_hi.xyz+f.eye_lo.xyz+p),f.sun.xyz)),1,0);}
 var receiver=p;var terrain_receiver=ground;var start=start_hint;let height=sc_radial_height(p);let radial=normalize(f.eye_hi.xyz+f.eye_lo.xyz+p);
 if f.options.z>0.5&&height<f.planet.y{let down=refract(-f.sun.xyz,radial,0.7501875);receiver-=down*((f.planet.y-height)/max(0.2,-dot(down,radial)));terrain_receiver=receiver;start=-1e30;}
 // Private attribution bits (cloud_diagnostic 512..8192) disable one component
 // each for cost measurement only; they never ship enabled.
 let experiment=u32(f.cloud_drift.z);
 var terrain=SunTerrain(1,0,0);if (experiment&512u)==0u{terrain=sun_terrain(terrain_receiver,footprint,start,steep);}
 var cloud=SunCloud(1,1);if (experiment&1024u)==0u{cloud=sun_cloud_lookup(receiver);}
 var props=1.0;if (experiment&2048u)==0u{props=sun_props(receiver,normal);}
 var cover=1.0;if (experiment&4096u)==0u{cover=sc_sun_cover(receiver,normal,footprint);}
 // Diagnostic 7 shows the march's work instead: iterations / SUN_MARCH_LIMIT (red) and block jumps / 128 (green).
 if sf.control.y==7.0{return SunVisibility(terrain.visibility,1.0,terrain.unresolved);}
 let overflow=bitcast<u32>(sf.metrics.z)>0u;
 // The low-resolution cloud-volume terrain mask is only for cloud lighting.
 // Surface terrain visibility is already resolved above; applying both masks
 // projects cloud-profile height bins onto mountains as spurious dark patches.
 return SunVisibility(terrain.visibility*props*cover,cloud.transmittance,max(terrain.unresolved,select(0.0,1.0,overflow||bitcast<u32>(sf.metrics.w)>0u)));
}
fn sunlight(p:vec3<f32>,normal:vec3<f32>,footprint:f32)->SunVisibility{return sunlight_at(p,p,normal,footprint,-1e30,0.0);}
fn sunlight_ground(p:vec3<f32>,normal:vec3<f32>,footprint:f32,height:f32)->SunVisibility{
 // The raster proxy may lie below the detailed heightfield at coarse LODs.
 // Start its terrain query on that same field; keep prop/cloud receivers at
 // the published surface so object contact and water interfaces stay aligned.
 // The shading pass already evaluated this canonical height at the pixel
 // footprint; reusing it avoids a second full-spectrum evaluation. Against a
 // 0.25 m-floored footprint it differs by at most the two finest
 // bands (about 2.5 cm), inside the existing 2.5 cm precision allowance.
 let radial=normalize(f.eye_hi.xyz+f.eye_lo.xyz+p);
 // The ground's slope from its normal against the vertical, for the steep-receiver edge in sun_terrain.
 let up=max(0.05,abs(dot(normal,radial)));
 return sunlight_at(p,p+radial*(height-sc_radial_height(p)),normal,footprint,height,sqrt(max(0.0,1.0-up*up))/up);
}
fn sun_direct(s:SunVisibility)->f32{return s.solid*s.cloud;}
fn sun_diagnostic(color:vec3<f32>,s:SunVisibility)->vec3<f32>{
 if sf.control.y==1.0{return vec3<f32>(s.solid);}if sf.control.y==2.0{return vec3<f32>(s.cloud);}if sf.control.y==3.0{return vec3<f32>(s.unresolved,1.0-s.unresolved,0);}
 if sf.control.y==4.0{return vec3<f32>(s.solid,s.cloud,s.unresolved);}if sf.control.y==7.0{return vec3<f32>(s.solid,s.unresolved,0);}return color;
}
