// Everything beyond the body in full detail: stars, the Sun, and every other body as a bounded
// analytic impostor over its own pinned map. Colour is linear, premultiplied; the second target holds
// the distance of the nearest body at a pixel, for the composite to order it against the surface.
// Nothing here reads a page or a mesh. One draw per body in view, sorted far to near by the CPU.
struct View {
 right:vec4<f32>, up:vec4<f32>, forward:vec4<f32>,
 screen:vec4<f32>, // width, height, aspect, tan half field of view
 icrf:array<vec4<f32>,3>, // render axes from ICRF, rows
 tone:vec4<f32>, // sky radiance scale, negative for the visual sky; y: Julian centuries from J2000, for stars' and asteroids' motion; z: the sky's scale; w: asteroids' brightness gain
 eye_sun:vec4<f32>, // eye against the Sun, ICRF, metres; w: bodies drawn this frame
 starlight:vec4<f32>, // the colour of the system star's light against the Sun's, 1 for Sol
}
struct Body {
 rect:vec4<f32>, // centre and half size in clip space; z >= 4 covers the screen
 center:vec4<f32>, // xyz eye-relative in render axes, metres; w equatorial radius
 shape:vec4<f32>, // polar radius, map layer, flags, angular radius of the bound
 sun:vec4<f32>, // xyz toward the Sun in the body's fixed axes; w light against the eye's adapted light
 axes:array<vec4<f32>,3>, // fixed axes from render axes, rows
 air:vec4<f32>, // scatter colour; w scale height, zero with no air
 beta:vec4<f32>, // extinction per metre at the reference radius; w shell height
 ring:vec4<f32>, // inner and outer ring radius, zero with none; z pixel radius before the point floor; w: it has the far cloud map
}
const FLAG_STAR:f32=1.0;const FLAG_ACTIVE:f32=2.0;const FLAG_GIANT:f32=4.0;const FLAG_ROCK:f32=8.0;
@group(0) @binding(0) var<uniform> v:View;
@group(0) @binding(1) var<storage,read> bodies:array<Body>;
@group(0) @binding(2) var maps:texture_2d_array<f32>;
@group(0) @binding(3) var map_sampler:sampler;
@group(0) @binding(49) var volume_shape:texture_3d<f32>;
@group(0) @binding(87) var volume_repeat:sampler;
@group(0) @binding(4) var<storage,read> stars:array<vec4<f32>>;
// The sky: NASA's map, sharpened, on a cube in ICRF, which has no poles to pinch. The brightest stars are also points on top.
@group(0) @binding(7) var sky_map:texture_cube<f32>;
// Real asteroid orbits: three vec4 each, baked by tools/Bake-Asteroids.mjs.
@group(0) @binding(8) var<storage,read> asteroids:array<vec4<f32>>;
// Orbit trails: eye-relative points in render axes; the last float's whole part is the kind and its fraction the strength. -1 ends a line.
@group(0) @binding(9) var<storage,read> trail_points:array<vec4<f32>>;
// Saturn's rings up close: their axes in render axes, the eye and the Sun in their frame, and the eye's cell in each shell.
struct RingField {axes:array<vec4<f32>,3>,eye:vec4<f32>,sun:vec4<f32>, // eye.w, sun.w: Saturn's equatorial and polar radii
origin:array<vec4<i32>,7>,fraction:array<vec4<f32>,7>}
@group(0) @binding(10) var<uniform> ring_field:RingField;
// The belts up close: the eye's cell in each shell, in ICRF axes, and the cell's size in the fraction's last word.
struct BeltField {origin:array<vec4<i32>,5>,fraction:array<vec4<f32>,5>}
@group(0) @binding(11) var<uniform> belt_field:BeltField;
// Earth's clouds for the far planet, made from the surface pass's own field: see `cloud_far_map` in clouds.wgsl. x: vertical opacity.
@group(0) @binding(12) var far_clouds:texture_2d<f32>;
struct Quad {@builtin(position) clip:vec4<f32>,@location(0) @interpolate(flat) body:u32,}
@vertex fn body_vertex(@builtin(vertex_index) id:u32,@builtin(instance_index) index:u32)->Quad{
 let b=bodies[index];
 if b.rect.z>=4.0{let c=vec2<f32>(f32((id<<1u)&2u),f32(id&2u))*2.0-1.0;return Quad(vec4<f32>(c,0,1),index);}
 var corners=array<vec2<f32>,6>(vec2<f32>(-1,-1),vec2<f32>(1,-1),vec2<f32>(-1,1),vec2<f32>(-1,1),vec2<f32>(1,-1),vec2<f32>(1,1));
 return Quad(vec4<f32>(b.rect.xy+projection_offset()+corners[id]*b.rect.zw,0,1),index);
}
fn projection_offset()->vec2<f32>{return vec2<f32>(-2.0*v.right.w,2.0*v.up.w)/v.screen.xy;}
fn ray(pixel:vec2<f32>)->vec3<f32>{let uv=(pixel+vec2<f32>(v.right.w,v.up.w))/v.screen.xy*2.0-1.0;return normalize(v.forward.xyz+v.right.xyz*uv.x*v.screen.z*v.screen.w-v.up.xyz*uv.y*v.screen.w);}
// Whether a point lies in an oblate planet's shadow: the ray from it toward the Sun meets the spheroid with equatorial radius a
// and polar radius c (pole along y), centred at the origin. Exact for the figure; the Sun's disk (a penumbra of tens of km at
// Saturn's rings) is not modelled. The ring sheet and the ring rocks both use it, so their shadow edges agree.
fn oblate_shadow(p:vec3<f32>,sun:vec3<f32>,a:f32,c:f32)->bool{
 let scale=vec3<f32>(1.0/a,1.0/c,1.0/a);let q=p*scale;let s=sun*scale;
 let bq=dot(q,s);let cq=dot(q,q)-1.0;
 return cq>0.0&&bq<0.0&&bq*bq-dot(s,s)*cq>0.0;
}
fn fixed(b:Body,x:vec3<f32>)->vec3<f32>{return vec3<f32>(dot(b.axes[0].xyz,x),dot(b.axes[1].xyz,x),dot(b.axes[2].xyz,x));}
const PI:f32=3.14159265;
fn map_uv(n:vec3<f32>)->vec2<f32>{let lon=atan2(n.x,n.z);let lat=asin(clamp(n.y,-1.0,1.0));return vec2<f32>(lon/(2.0*PI)+0.5,0.5-lat/PI);}
fn map_sample(b:Body,n:vec3<f32>,footprint:f32)->vec3<f32>{
 if b.shape.y>=32.0{
  let seed=b.shape.y-32.0;let phase=seed*1.618;let bands=sin(n.x*8.0+phase)*cos(n.z*7.0-phase)+sin(n.y*14.0+n.x*5.0)*.35;
  let grain=sin(n.x*83.0+n.z*47.0+phase)*cos(n.y*79.0)*.035/(1.0+footprint*80.0);
  let kind=u32(seed)%100u%4u;var colour=mix(vec3<f32>(.26,.12,.06),vec3<f32>(.56,.28,.12),smoothstep(-1.0,1.0,bands));
  if kind==2u{colour=mix(vec3<f32>(.15,.16,.18),vec3<f32>(.40,.39,.37),smoothstep(-1.0,1.0,bands));}
  if kind==0u{colour=mix(vec3<f32>(.19,.34,.43),vec3<f32>(.72,.83,.87),smoothstep(-1.0,1.0,bands));}
  if kind==3u{colour=mix(vec3<f32>(.018,.065,.12),vec3<f32>(.13,.22,.075),smoothstep(-.1,.12,bands));colour=mix(colour,vec3<f32>(.77,.83,.88),smoothstep(.78,.96,abs(n.y)));}
  return colour*(1.0+grain);
 }
 let size=f32(textureDimensions(maps).x);let level=clamp(log2(max(footprint/(2.0*PI)*size,1.0)),0.0,6.0);
 return textureSampleLevel(maps,map_sampler,map_uv(n),i32(b.shape.y),level).rgb;
}
// A column of cloud as the surface pass's march sees one from far off: the top of it lit, with the same phase and ambient as
// `cloud_interval_radiance`, through a slant of the same opacity. The sunlit fraction of a column is a fit against that pass.
fn far_cloud(b:Body,p:vec3<f32>,n:vec3<f32>,rd:vec3<f32>,footprint:f32,ground:vec3<f32>)->vec3<f32>{
 let size=f32(textureDimensions(far_clouds).x);let level=clamp(log2(max(footprint/(2.0*PI)*size,1.0)),0.0,5.0);
 let opacity=textureSampleLevel(far_clouds,map_sampler,map_uv(p),level).r;if opacity<=0.0{return ground;}
 let e=normalize(fixed(b,rd));let slant=max(-dot(n,e),0.15);let cover=1.0-pow(max(1.0-opacity,1e-4),1.0/slant);
 let mu=dot(e,b.sun.xyz);let phase=0.24+0.12/pow(max(0.10,1.36-1.2*mu),1.5)+0.08*pow(max(0.0,-mu),2.0);
 let toward=dot(n,b.sun.xyz);let day=smoothstep(-0.18,0.08,toward);
 let lit=0.85*smoothstep(-0.05,0.35,toward);
 let ambient=(vec3<f32>(0.31,0.37,0.46)+vec3<f32>(0.17,0.16,0.14)*sqrt(lit))*day;
 let direct=vec3<f32>(1.8,1.58,1.32)*phase*lit;
 return mix(ground,(ambient+direct)*b.sun.w,cover);
}
// Each level of the far cloud map from the one above it.
@group(0) @binding(13) var far_mip_in:texture_2d<f32>;
@group(0) @binding(14) var far_mip_out:texture_storage_2d<rgba16float,write>;
@compute @workgroup_size(8,8) fn far_cloud_mip(@builtin(global_invocation_id) id:vec3<u32>){
 if any(id.xy>=textureDimensions(far_mip_out)){return;}let at=vec2<i32>(id.xy)*2;
 textureStore(far_mip_out,vec2<i32>(id.xy),(textureLoad(far_mip_in,at,0)+textureLoad(far_mip_in,at+vec2<i32>(1,0),0)+textureLoad(far_mip_in,at+vec2<i32>(0,1),0)+textureLoad(far_mip_in,at+vec2<i32>(1,1),0))*0.25);
}
// A star (crates/solar-core/src/stars.rs computes every number it reads; nothing here is specific to one star). Its row:
// air.xyz the linear sRGB radiance at the disk centre, already times the photosphere's exposure (docs/SOLAR-SYSTEM.md, "The
// star model"); beta.xyz and ring.xyz the quadratic limb-darkening coefficients per channel; beta.w a granule's diameter over
// the radius; sun.x the synthetic layer's strength (0: off, or averaged out by a fast clock), sun.y its activity (spots and
// active regions against the Sun's), sun.z how much of the disk the eye sees (eclipses), sun.w the granules' clock in
// lifetimes; axes the star's fixed axes, which carry the synthetic layer round as it turns; axes[0].w the view (0 true colour,
// 1 the familiar composite), axes[1].w the clock in days (modulo 1000), axes[2].w the star's seed.
// Worley cells in 3D: the distance to the nearest and second nearest feature point, seeded by `seed`. Each cell's point lies in
// the middle half of the cell on every axis, so the nearest point to any place is always in one of the eight cells round it
// (it is at most 0.43 away in the cell the place is nearest the middle of, and no point of a cell outside the eight is nearer
// than 0.75), and only those eight are searched. (Before 17 November 2026: anywhere in the cell, and 27 cells searched; the
// relief marches this many times a pixel and could not afford that. The second nearest can in principle lie outside the
// eight; it matters only near a cell's edge, where both are inside.)
// `base` and p together are the place: whole cells, and the rest, so that near the eye, where the rest is small and exact, the
// pattern is not cut into the steps a single float's place on the sphere would give it (40 m on the Sun).
fn star_cells(p:vec3<f32>,seed:u32)->vec3<f32>{return star_cells_at(vec3<i32>(0),p,seed);}
fn star_cells_at(base:vec3<i32>,p:vec3<f32>,seed:u32)->vec3<f32>{
 let c=floor(p-0.5);var d1=9.0;var d2=9.0;var id=0u;
 for(var k=0u;k<8u;k++){
  let g=c+vec3<f32>(f32(k&1u),f32((k>>1u)&1u),f32((k>>2u)&1u));let n=base+vec3<i32>(g);
  let h=hash32((bitcast<u32>(n.x)*0x8da6b343u)^(bitcast<u32>(n.y)*0xd8163841u)^(bitcast<u32>(n.z)*0xcb1ab31fu)^seed);
  let j=0.25+vec3<f32>(f32(h&1023u),f32((h>>10u)&1023u),f32((h>>20u)&1023u))/2046.0;
  let d=length(g+j-p);if d<d1{d2=d1;d1=d;id=h;}else if d<d2{d2=d;}
 }
 return vec3<f32>(d1,d2,f32(id>>8u)/16777215.0);
}
fn unit_hash(h:u32)->f32{return f32(h&0xffffu)/65535.0;}
// Value noise that repeats every 4096 cells (an integer hash of the lattice point modulo 4096), in [-1, 1]: the boiling's fine
// octaves count cells from an anchor kept modulo 4096 (space.rs), so the pattern must repeat with it or it would jump when the
// anchor steps.
fn periodic_noise(x:vec3<f32>,seed:u32)->f32{
 let i=floor(x);let f=x-i;let u=f*f*(3.0-2.0*f);let c=vec3<u32>(vec3<i32>(i)&vec3<i32>(4095));
 var v:array<f32,8>;
 for(var k=0u;k<8u;k++){let o=vec3<u32>(k&1u,(k>>1u)&1u,(k>>2u)&1u);let cc=(c+o)&vec3<u32>(4095u);
  v[k]=f32(hash32((cc.x*0x8da6b343u)^(cc.y*0xd8163841u)^(cc.z*0xcb1ab31fu)^seed)&0xffffu)/32767.5-1.0;}
 return mix(mix(mix(v[0],v[1],u.x),mix(v[2],v[3],u.x),u.y),mix(mix(v[4],v[5],u.x),mix(v[6],v[7],u.x),u.y),u.z);
}
// Smooth gradient noise on a direction (or any point), in [-1, 1]: at each lattice point a seeded gradient, blended with a
// quintic. Before 17 November 2026 this was a value noise (`rock_noise`), whose lattice showed as square blocks and right
// angles wherever it was stretched, plainly in the corona seen from inside it; a gradient noise has no plateaus to show.
fn star_noise(x:vec3<f32>,seed:f32)->f32{
 let i=floor(x);let f=x-i;let u=f*f*f*(f*(f*6.0-15.0)+10.0);let c=vec3<i32>(i);let s=u32(seed)*0x9e3779b1u;
 var v:array<f32,8>;
 for(var k=0u;k<8u;k++){
  let o=vec3<u32>(k&1u,(k>>1u)&1u,(k>>2u)&1u);let n=c+vec3<i32>(o);
  let h=hash32((bitcast<u32>(n.x)*0x8da6b343u)^(bitcast<u32>(n.y)*0xd8163841u)^(bitcast<u32>(n.z)*0xcb1ab31fu)^s);
  v[k]=dot(vec3<f32>(f32(h&1023u),f32((h>>10u)&1023u),f32((h>>20u)&1023u))/511.5-1.0,f-vec3<f32>(o));
 }
 return clamp(mix(mix(mix(v[0],v[1],u.x),mix(v[2],v[3],u.x),u.y),mix(mix(v[4],v[5],u.x),mix(v[6],v[7],u.x),u.y),u.z)*1.5,-1.0,1.0);
}
// Active regions: one seeded set drives the spots, the faculae round them, the loops over them, the filaments along them and
// the flares in them. Each of up to 12 slots holds one region for a lifetime of 20 to 60 days and then a new one (another place,
// size and tilt). A region is a bipolar pair, leader toward the equator and ahead in the turning, tilted by a Joy's-law-like
// rule (more tilt at higher latitude; a choice, not a fit), in the active latitudes 5 to 35 degrees. Not today's Sun.
struct Region {centre:vec3<f32>,east:vec3<f32>,north:vec3<f32>,size:f32,life:f32,phase:f32,hash:u32,age:f32,impulse:f32}
const MAX_REGIONS:u32=12u;
// The nearest star's regions, computed once a frame on the CPU (space.rs `star_regions`): the star's seed, the count of regions,
// and how many loops stand over a quiet region and at how many points each is first tried; then per region its centre and size,
// east and life, north and the phase of its flare, and the hash in two 16-bit halves with the age as a share of the region's
// life and the flare's impulse.
// Flares (space.rs `region_flare`). True colour: up to three in a region's first 20 days, each rising in minutes and decaying
// over about half an hour of clock time. The familiar view time-lapses them with the granulation (40 s a granule lifetime at
// real time): every region has a chance at a flare in each window of six lifetimes, so somewhere on the disk one goes off every
// minute or two. `impulse` is the flash (a rise, then a decay with one decay time); `phase` is the time since onset in decay
// times (36 s of real time in the familiar view, 25 minutes in true colour), negative with no flare, and runs to about ten:
// what follows the flash (the arcade, the eruption, the ejection) is timed by it.
// cells: the anchor's place in granule widths, whole cells and the rest, from double precision (see `granule_place`).
struct StarField {star:vec4<f32>,regions:array<vec4<f32>,48>,eye:vec4<f32>,octaves:array<vec4<f32>,10>,cells:array<vec4<f32>,2>}
@group(0) @binding(15) var<uniform> star_field:StarField;
fn region_at(i:u32)->Region{
 let a=star_field.regions[i*4u];let e=star_field.regions[i*4u+1u];let n=star_field.regions[i*4u+2u];let h=star_field.regions[i*4u+3u];
 return Region(a.xyz,e.xyz,n.xyz,a.w,e.w,n.w,u32(h.x)|(u32(h.y)<<16u),h.z,h.w);
}
// How far a flare's arcade reaches either side of the line between the polarities: its feet start close and move apart as it
// grows. The two-ribbon flare of the standard picture (Carmichael 1964, Sturrock 1966, Hirayama 1974, Kopp and Pneuman 1976,
// as reviewed by Benz 2017, Living Rev. Solar Phys. 14, 2): field reconnecting higher and higher leaves an arcade of hot loops
// that grows, and the loops' feet are the two ribbons. The rates here are a time-lapse's, not measured ones.
fn arcade_half(sep:f32,phase:f32)->f32{return sep*(0.2+0.75*(1.0-exp(-max(phase,0.0)/2.5)));}
// Lava: a continually morphing field, a smooth noise whose coordinates are displaced by two more noises that themselves drift
// with the clock (domain warping), so it flows, folds and never repeats; the familiar view's own texture on and inside the
// granules, a display choice, labelled. x in granule units, t the clock.
fn lava(x:vec3<f32>,t:f32)->f32{
 let a=vec3<f32>(star_noise(x*0.7+vec3<f32>(t*0.31,0.0,-t*0.23),41.0),star_noise(x*0.7+vec3<f32>(5.2,-t*0.27,1.3),42.0),star_noise(x*0.7+vec3<f32>(-3.1,2.7,t*0.29),43.0));
 let y=x+a*1.4;
 let b=vec3<f32>(star_noise(y*1.3+vec3<f32>(t*0.5,1.7,0.0),44.0),star_noise(y*1.3+vec3<f32>(-2.3,t*0.43,4.1),45.0),0.0);
 let z=y*1.9+vec3<f32>(b.xy*1.2,t*0.37);
 return 0.5+0.5*(0.6*star_noise(z,46.0)+0.4*star_noise(z*2.1-vec3<f32>(t*0.6),47.0));
}
// One megametre as a fraction of the Sun's radius (695.7 Mm). Another star takes the same fractions of its own radius.
const MM:f32=0.0014374;
fn hash2(i:vec2<i32>,seed:u32)->u32{return hash32((bitcast<u32>(i.x)*0x8da6b343u)^(bitcast<u32>(i.y)*0xd8163841u)^seed);}
// The penumbral field is elongated along the local magnetic direction. Its
// correlation lengths are about 0.3 Mm across a filament and 2.6 Mm along it.
// Circular coordinates let an entire turn join continuously, including in depth.
fn penumbral_source(dir:vec2<f32>,d:f32,radius:f32,z:f32,seed:vec3<f32>,field:vec3<f32>,across:f32)->f32{
 let bend=vec2<f32>(-dir.y,dir.x)*(.16*field.r+.12*(seed.x-.5)*d/radius);
 let along=d/(8.0*2.6*MM);let height=z/(8.0*.45*MM);
 let uv=vec3<f32>((dir+bend)*radius/(8.0*.42*MM),along+height)+seed;
 let fibre=textureSampleLevel(volume_shape,volume_repeat,uv,0.0);
 let knots=textureSampleLevel(volume_shape,volume_repeat,uv*1.83+fibre.gbr*.19,0.0);
 let resolved=1.0-smoothstep(.09*MM,.55*MM,across);
 return .78+resolved*(.48*(fibre.r-.5)+.19*(knots.a-.45))+.10*field.g;
}
// A sunspot, from what is observed (the shapes are synthetic; the numbers are cited where they are used). Its outline and its
// umbra's are closed curves that wander, not circles; the outer edge frays into the granules; the umbra's edge is ragged where
// the filaments' bright heads push in. Whether it has a penumbra at all follows its size and age: a spot under about 3.5 Mm
// across is a pore and has none ("a pore usually starts to show penumbral structure once its diameter exceeds roughly 3.5 Mm",
// Solanki 2003), a young one has not grown it yet (it forms within hours, sector by sector), and an old one loses it in
// sectors. The umbra is 20 to 30% of the quiet photosphere (Solanki 2003; darker in a large spot), with umbral dots (bright
// points a few hundred km across: Solanki 2003 lists estimates from 80 to 650 km) and, in a quarter of the spots, a light bridge
// (a bright lane with grains and a dark central line: Borrero and Ichimoto 2011, section 3.1.4; its width here, 0.7 Mm, is a
// choice). The thermal deficit and Wilson depression are functions of position in the rotating plasma.
// Their two components give the continuum source deficit and the downward shift in optical depth, in radii.
fn sunspot(offset:vec2<f32>,radius:f32,hash:u32,across:f32,z:f32,age:f32)->vec2<f32>{
 if radius<=0.0 || dot(offset,offset)>radius*radius*2.72{return vec2<f32>(0);}
 let scale=max(radius,MM);
 let seed=vec3<f32>(unit_hash(hash),unit_hash(hash>>7u),unit_hash(hash>>14u));
 let uv=vec3<f32>(offset/(scale*2.0),z/(scale*.65))+seed;
 let field=textureSampleLevel(volume_shape,volume_repeat,uv,0.0).rgb-.5;
 // A flux concentration fans out slightly with height and has a structured wall.
 let t=offset/(1.0+.09*clamp(z/scale,-1.0,1.0))+field.rg*min(.38*MM,.12*radius);
 let d=length(t);
 let dir=t/max(d,1e-8);let size=radius/MM;
 let shape=textureSampleLevel(volume_shape,volume_repeat,seed+vec3<f32>(dir*.26,z/(8.0*MM)),0.0).rgb-.5;
 var ru=radius*.42*(1.0+.40*shape.r+.15*field.r);
 // The penumbra: none for a pore or a spot too young, gone in sectors from an old one.
 let grown=smoothstep(1.75,3.2,size)*smoothstep(0.02,0.10,age);
 let sector=smoothstep(-.15,.15,shape.b+.5-smoothstep(.55,1.0,age)*.9);
 let has=grown*sector;
 let wide=radius*(1.0+.34*shape.g+.17*field.g);
 ru*=1.25-.25*has;
 let rp=mix(ru*1.10,wide,has);
 let edge=max(across*1.2,min(.13*MM,radius*.1));
 // The outer edge frays at the scale of a granule; the umbra's at the scale of a filament.
 let fine=textureSampleLevel(volume_shape,volume_repeat,seed+vec3<f32>(t/(8.0*MM),z/(3.0*MM)),0.0).rgb-.5;
 let fray=1.2*MM*fine.g*smoothstep(.5,2.0,MM/across);
 let wall=max(edge,.085*radius);
 let pen=1.0-smoothstep(rp+fray-wall,rp+fray+wall,d);
 if pen<=0.0{return vec2<f32>(0);}
 let ragged=.72*MM*fine.r*smoothstep(.5,2.0,.45*MM/across);
 let umb=1.0-smoothstep(ru+ragged-wall,ru+ragged+wall,d);
 var pb=.80;
 if umb<.999 && has>.001{pb=mix(.78,penumbral_source(dir,d,radius,z,seed,field,across),has);}
 // The umbra: darker in a larger spot; a pore is lighter.
 var ub=mix(0.42,0.20,smoothstep(1.5,12.0,size))+.065*field.b;
 // Umbral dots: one to a cell of 0.55 Mm, in about four cells of ten, fewer toward the dark middle.
 let cell=0.55*MM;let dots_seen=smoothstep(0.6,2.0,0.2*MM/across);
 if dots_seen>0.0&&umb>0.0{
  let g=t/cell;let id=floor(g);let hd=hash2(vec2<i32>(id),hash^0x2545f491u);
  if unit_hash(hd)<0.42{
   let at=id+vec2<f32>(0.3+0.4*unit_hash(hd>>8u),0.3+0.4*unit_hash(hd>>16u));let off=(g-at)/(0.16+0.12*unit_hash(hd>>4u));
   ub+=(0.16+0.22*unit_hash(hd>>12u))*exp(-dot(off,off))*dots_seen*smoothstep(0.1,0.7,d/max(ru,1e-6));
  }
 }
 // A light bridge: a bright lane across the umbra, a little curved, grained along its length, a dark line down its middle.
 if (hash&3u)==0u&&size>4.0{
  let turn=unit_hash(hash>>8u)*6.2831853;let axis=vec2<f32>(cos(turn),sin(turn));
  let along=dot(t,axis);let side=dot(t,vec2<f32>(-axis.y,axis.x))+0.18*ru*sin(along/max(ru,1e-6)*2.3+turn)+.65*MM*fine.b;
  let half=0.35*MM*(0.8+0.4*unit_hash(hash>>12u));let lane=1.0-smoothstep(half-edge,half+edge,abs(side));
  let grain=.62+.34*fine.g;
  let line=1.0-0.28*exp(-(side*side)/(0.0064*MM*MM))*smoothstep(4.0,10.0,2.0*half/across);
  ub=mix(ub,grain*line,lane);
 }
 let depression=MM*mix(.12,.62,smoothstep(1.5,12.0,size))*mix(.27,1.0,umb);
 return vec2<f32>(1.0-mix(pb,ub,umb),depression)*pen;
}

struct MagneticSpot {at:vec2<f32>,radius:f32,key:u32}
fn region_spot(r:Region,k:u32)->MagneticSpot{
 let sep=(.025+.04*r.size)*r.life;
 let lead=.010+.018*r.size;let follow=lead*(.45+.4*unit_hash(r.hash>>5u));
 let behind=vec2<f32>(sep,sep*.25*unit_hash(r.hash>>9u));
 if k==0u{return MagneticSpot(vec2<f32>(sep,0),lead*r.life,r.hash);}
 if k==1u{return MagneticSpot(-behind,follow*r.life,r.hash>>3u);}
 if k==2u{return MagneticSpot(-behind-vec2<f32>(.3,.9)*follow*(1.2+unit_hash(r.hash>>13u)),follow*.45*r.life,r.hash>>6u);}
 let hk=hash32(r.hash^((k-3u)*0x2545f491u));
 let at=vec2<f32>(mix(-1.2*sep,1.2*sep,unit_hash(hk)),(unit_hash(hk>>16u)-.5)*sep*.9);
 return MagneticSpot(at,(.6+1.2*unit_hash(hk>>8u))*MM*r.life,hk);
}
fn magnetic_region(r:Region,t:vec2<f32>,z:f32,across:f32,mask:u32)->vec2<f32>{
 var field=vec2<f32>(0);var remaining=mask;
 while remaining!=0u{
  let k=firstTrailingBit(remaining);remaining&=remaining-1u;
  let spot=region_spot(r,k);
  let material=sunspot(t-spot.at,spot.radius,spot.key,across,z,r.age);
  field=max(field,material*select(1.0,.9,k>=3u));
 }
 return field;
}
// Granules. The cells' edges are warped by a smooth noise so granules are rounded and irregular, not polygons, and the warp
// drifts with the clock, so cells flow, swell and split between generations instead of only fading. x0: the place in granule
// widths; phase: the granules' clock in lifetimes.
fn granule_warp(x0:vec3<f32>,phase:f32)->vec3<f32>{
 let flow=vec3<f32>(phase*0.21,-phase*0.17,phase*0.13);
 return vec3<f32>(star_noise(x0*0.6+flow,1.0),star_noise(x0*0.6+9.1-flow,2.0),star_noise(x0*0.6-4.3+flow.zxy,3.0))*0.9;
}
// Their cells at a place: two generations, each living one lifetime, crossfading so no cell pops. For each, the distance to the
// nearest point, the gap to the second nearest (zero on a cell's edge) and the cell's own number; and the second's share.
struct Granules {a:vec3<f32>,c:vec3<f32>,w:f32}
// A place in granule widths, in two parts: whole cells, and the rest. For the star the CPU's anchor is on, the rest is the
// anchor's own (from double precision) plus the place against the anchor, which is small and so exact: a single float's place
// on the unit sphere is good to 40 m on the Sun, and the relief's slope, a difference of depths over a pixel, showed that as
// rings on the ground from a few hundred metres up. near: the place against the anchor, fixed axes, radii.
struct Place {base:vec3<i32>,x:vec3<f32>}
fn granule_place(b:Body,q:vec3<f32>,near:vec3<f32>)->Place{
 let cell=b.beta.w;
 if u32(b.axes[2].w)==u32(star_field.star.x){return Place(vec3<i32>(star_field.cells[0].xyz),star_field.cells[1].xyz+near/cell);}
 let x=q/cell;let whole=floor(x);return Place(vec3<i32>(whole),x-whole);
}
// Advect one coherent network of thermal cells. A site's position evolves
// between successive lifetimes, so its dark boundary moves with the upflow.
fn continuum_cells(at:Place,warp:vec3<f32>,phase:f32,seed:u32)->vec3<f32>{
 let position=vec3<f32>(at.base)+at.x;
 let phase_angle=phase*(2.0*PI/16.0);
 let drift=vec3<f32>(sin(phase_angle),cos(phase_angle),sin(2.0*phase_angle))*.16;
 let corrugation=textureSampleLevel(volume_shape,volume_repeat,position*.37+drift,0.0).rgb-.5;
 let p=at.x+warp+.19*corrugation;let c=vec3<i32>(floor(p));let f=fract(p);
 let generation=u32(floor(phase))&4095u;let w=smoothstep(0.0,1.0,fract(phase));
 var first=8.0;var second=8.0;var brightness=0.0;
 for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
  let offset=vec3<i32>(x,y,z);let n=vec3<u32>(at.base+c+offset);
  let key=(n.x*0x8da6b343u)^(n.y*0xd8163841u)^(n.z*0xcb1ab31fu)^seed;
  let a=hash32(key^(generation*2654435761u));let b=hash32(key^(((generation+1u)&4095u)*2654435761u));
  let left=vec3<f32>(vec3<u32>(a,a>>10u,a>>20u)&vec3<u32>(1023u))/1023.0;
  let right=vec3<f32>(vec3<u32>(b,b>>10u,b>>20u)&vec3<u32>(1023u))/1023.0;
  let j=mix(left,right,w);let delta=vec3<f32>(offset)+.08+.84*j-f;
  let d=dot(delta,delta);
  if d<first{second=first;first=d;brightness=unit_hash(hash32(key));}else{second=min(second,d);}
 }}}
 let r=sqrt(first);return vec3<f32>(r,sqrt(second)-r,brightness);
}
fn granules(b:Body,at:Place,warp:vec3<f32>,phase:f32)->Granules{
 if b.axes[0].w<.5{
  let site=continuum_cells(at,warp,phase,u32(b.axes[2].w));
  return Granules(site,site,0.0);
 }
 let n=u32(floor(phase))&4095u;
 let a=star_cells_at(at.base,at.x+warp,n*2654435761u);let c=star_cells_at(at.base,at.x+warp,((n+1u)&4095u)*2654435761u);
 return Granules(vec3<f32>(a.x,a.y-a.x,a.z),vec3<f32>(c.x,c.y-c.x,c.z),smoothstep(0.0,1.0,fract(phase)));
}
// Their brightness: each cell bright in its middle with a narrow dark lane round it, each granule its own brightness. About 0
// (a lane) to 1.2 (a bright middle); its mean is 0.68 (measured on 400,000 random places, rms 0.33 about it).
fn granule_bright(g:Granules,x0:vec3<f32>)->f32{
 let lane=0.08+0.1*(0.5+0.5*star_noise(x0*2.3,4.0));
 return mix((0.8+0.4*g.a.z-0.6*g.a.x*g.a.x)*smoothstep(0.0,lane,g.a.y),(0.8+0.4*g.c.z-0.6*g.c.x*g.c.x)*smoothstep(0.0,lane,g.c.y),g.w);
}
// Their height, of the same cells, so a bright granule is a raised one: a dome over each cell (highest in its middle) that falls
// into a valley along the cell's edge, wider than the dark lane that runs along the valley's floor. 0 (a valley's floor) to 1.
fn granule_height(g:Granules)->f32{
 return mix((1.0-0.9*g.a.x*g.a.x)*smoothstep(0.0,0.34,g.a.y),(1.0-0.9*g.c.x*g.c.x)*smoothstep(0.0,0.34,g.c.y),g.w);
}
// Relief: how far the surface lies below the sphere at a place, in radii. The sphere is the level of the highest crests, so the
// eye is never under the surface it flies over. A granule's valleys sink below its crown, and under the granules the boiling's
// cells (star_detail) sink at their dark rims, each scale by a quarter of its own size in the familiar view: a granule 1 Mm
// across has valleys 250 km deep there. The true-colour view takes 0.4 of that, 100 km, the order of what is measured (the
// surface of unit optical depth is corrugated by about 35 km rms in granulation: Nordlund, Stein and Asplund 2009, Living
// Rev. Solar Phys. 6, 2). The familiar view's exaggeration is the owner's wish for a surface that reads as moving lava, and is
// labelled with the rest of the synthetic surface. Spots are not in it: their depression is the shift of the umbra in `sunspot`.
// Every term is a clamped share of a fixed amplitude, so the depth lies between 0 and `scale` times 0.3125 of a granule's
// width (0.25 for the granules, and the boiling's scales, each a fifth of the last, sum to under a quarter of 0.25): a bound
// by construction, which the march in `star` uses as the floor of the layer it searches.
// A heightfield along the radius: nothing overhangs. Prominences, loops and spicules are separate volumes over it.
// warp: the granules' warp there (granule_warp); scale: the view's share (1 familiar, 0.4 true colour) times the layer's strength.
const RELIEF_GRANULE:f32=0.25;const RELIEF_BOIL:f32=0.25;const RELIEF_BOUND:f32=0.3125;
fn star_depth(b:Body,q:vec3<f32>,near:vec3<f32>,across:f32,mu:f32,warp:vec3<f32>,scale:f32)->f32{
 var depth=0.0;let cell=b.beta.w;let slant=sqrt(max(mu,0.05));let pixels=cell/across*slant;
 if pixels>0.8{depth+=cell*RELIEF_GRANULE*(1.0-granule_height(granules(b,granule_place(b,q,near),warp,b.sun.w)))*smoothstep(0.8,6.0,pixels);}
 // The boiling's scales, as star_detail draws them, but only from where a cell spans 24 pixels (smaller, its relief would move
 // the picture by a pixel or two and cost as much as the granules'); a scale keeps its relief once its cells have outgrown the
 // screen (its brightness fades there, its ground does not).
 let anchored=u32(b.axes[2].w)==u32(star_field.star.x);
 let clock=b.sun.w;var size=cell*0.2;var turn=pow(5.0,0.6667);
 for(var k=0u;k<10u;k++){
  let span=size/across*slant;
  if span<24.0 || (b.axes[0].w<.5 && size<cell*.08){break;}
  let life=clock*min(turn,25.0);let gen=floor(life);let t=fract(life);let w=t*t*(3.0-2.0*t);
  let x=select(q/size,near/star_field.octaves[k].w+star_field.octaves[k].xyz,anchored);let o1=vec3<f32>(fract(gen*0.618)*91.0,fract(gen*0.381)*57.0,f32(k)*13.0);let o2=vec3<f32>(fract((gen+1.0)*0.618)*91.0,fract((gen+1.0)*0.381)*57.0,f32(k)*13.0);
  let v=mix(abs(periodic_noise(x+o1,31u+k)),abs(periodic_noise(x+o2,31u+k)),w);
  depth+=size*RELIEF_BOIL*(1.0-clamp(v/0.75,0.0,1.0))*smoothstep(24.0,48.0,span);
  size*=0.2;turn*=pow(5.0,0.6667);
 }
 return depth*scale;
}
// Synthetic photosphere: granulation, the supergranular network's faculae, active regions' spots, plage and flare ribbons, all a
// labelled model with measured sizes and contrasts (stars.rs and the doc give the sources), on and off with the star's own switch.
// q: the point on the unit sphere in the star's fixed axes; mu: cosine to the eye; across: one pixel at that point as a fraction of
// the radius; warp: the granules' warp there (granule_warp). Returns the brightness
// factor and, in w, the flare ribbons' light.
fn star_detail(b:Body,q:vec3<f32>,mu:f32,across:f32,count:u32,near:vec3<f32>,warp:vec3<f32>,orbital:bool)->vec4<f32>{
 var gain=1.0;let strength=b.sun.x;let activity=abs(b.sun.y);let seed=u32(b.axes[2].w);
 // Granules (granule_bright), seen only when a cell spans pixels; their contrast falls toward the limb, as observed. Offset by
 // the pattern's mean (0.68), so the disk's mean is kept as they come into view. Observed rms contrast for comparison: 7% at
 // 630 nm through Hinode's optics, 14% unsmeared in simulations (Danilovic et al. 2008, A&A 484, L17); this pattern's is 0.33
 // times the 0.30 below, about 10%, before the finer terms.
 let cell=b.beta.w;let pixels=cell/across*sqrt(max(mu,0.05));
 if pixels>0.8{
  let phase=b.sun.w;let n=u32(floor(phase))&4095u;
  let x0=q/cell;let flow=vec3<f32>(phase*0.21,-phase*0.17,phase*0.13);
  let g=granules(b,granule_place(b,q,near),warp,phase);
  let shape=granule_bright(g,x0);let fine=0.20*star_noise(x0*3.7,6.0);
  // A finer, faster octave where it spans pixels: granules fragmenting and the bright points in the lanes.
  var finer=0.0;
  if pixels>4.0 && b.axes[0].w>.5{let f=star_cells(x0*2.7+warp*1.3+flow*2.0,(n*7919u)^seed);finer=(smoothstep(0.0,0.12,f.y-f.x)-0.9)*0.35*smoothstep(4.0,12.0,pixels);}
  if pixels>4.0 && b.axes[0].w<.5{
   let grain=star_noise(x0*2.6+warp*.4,19.0);
   let thermal=star_noise(x0*1.7+warp,37.0);
   // A cooling downflow can open within a large upflow; brighter magnetic
   // elements occupy a small area of mature intergranular lanes.
   let split=exp(-60.0*thermal*thermal)*smoothstep(.43,.85,g.a.z)*smoothstep(.13,.36,g.a.y);
   let points=(1.0-smoothstep(.025,.10,g.a.y))*smoothstep(.28,.63,grain);
   finer=(points*.46-split*.28+grain*.13)*smoothstep(4.0,10.0,pixels);
  }
  var molten=0.0;
  // Bright molten veins: the lava field's ridges (where it crosses its middle), sharpened.
  if b.axes[0].w>0.5{let l=lava(x0*0.8,phase*2.5);let vein=1.0-abs(2.0*l-1.0);molten=(vein*vein*vein-0.3)*1.1+(l-0.5)*0.5;}
  let granular=(shape-0.68+fine+finer+molten)*0.30*mix(0.35,1.0,mu)*smoothstep(0.8,6.0,pixels);
  gain+=granular*strength;
 }
 // Boiling below the granules, following the zoom: octaves each a fifth the size of the one above (200 km, 40 km, 8 km and on
 // down to metres), bright cells with dark rims (the absolute value of a smooth noise), each living one of its own lifetimes and
 // crossfading into the next. An octave is drawn only from where its cells span a few pixels to where one would fill the
 // screen, so three or four are evaluated at any height and finer ones keep appearing as the eye comes down. A smaller eddy turns
 // over faster, as the 2/3 power of its size (the usual turbulent scaling; a choice), capped at one turnover in 1.6 s of real
 // time in the familiar view. Synthetic.
 {
  // `near`: the point met against the CPU's anchor near the eye, in fixed axes and radii (small, so precise); each octave's
  // cells are counted from the anchor's place in them (star_field.octaves). Only for the star the field was computed for.
  let anchored=u32(b.axes[2].w)==u32(star_field.star.x);
  let clock=b.sun.w;var size=cell*0.2;var turn=pow(5.0,0.6667);let amp=select(.055,.22,b.axes[0].w>.5);
  for(var k=0u;k<10u;k++){
   let span=size/across*sqrt(max(mu,0.05));
   if span<1.5 || (b.axes[0].w<.5 && size<cell*.08){break;}
   let seen=smoothstep(1.5,5.0,span)*(1.0-smoothstep(400.0,2400.0,span));
   if seen>0.0{
    let life=clock*min(turn,25.0);let gen=floor(life);let t=fract(life);let w=t*t*(3.0-2.0*t);
    let x=select(q/size,near/star_field.octaves[k].w+star_field.octaves[k].xyz,anchored);let o1=vec3<f32>(fract(gen*0.618)*91.0,fract(gen*0.381)*57.0,f32(k)*13.0);let o2=vec3<f32>(fract((gen+1.0)*0.618)*91.0,fract((gen+1.0)*0.381)*57.0,f32(k)*13.0);
    let v1=abs(periodic_noise(x+o1,31u+k));let v2=abs(periodic_noise(x+o2,31u+k));
    gain+=(mix(v1,v2,w)-0.38)*amp*seen*strength*mix(0.4,1.0,mu);
   }
   size*=0.2;turn*=pow(5.0,0.6667);
  }
 }
 // The supergranular network: cells 30 granules across (30 Mm against 1 Mm, Rincon and Rieutord 2018), faculae on their edges as
 // soft, broken lanes, seen toward the limb. Static: a supergranule lives one to two days.
 let big=cell*30.0;let bigpixels=big/across;
 if bigpixels>1.5{
  let s=star_cells(q/big,0x51ed27u^seed);let lane=1.0-smoothstep(0.0,0.35,s.y-s.x);
  let broken=0.5+0.5*star_noise(q/big*3.0,7.0);
  gain+=lane*broken*0.07*pow(1.0-mu,1.5)*smoothstep(1.5,5.0,bigpixels)*strength*min(activity,2.0);
 }
 // Active regions.
 var ribbon=0.0;
 for(var i=0u;i<count;i++){
  let r=region_at(i);if r.life<=0.001{continue;}
  let toc=q-r.centre;let reach=0.06+0.08*r.size;if dot(toc,toc)>reach*reach*4.0{continue;}
  let t=vec2<f32>(dot(toc,r.east),dot(toc,r.north));
  let sep=(0.025+0.04*r.size)*r.life;
  // Plage and faculae round the region, brighter toward the limb (the network's own contrast law).
  let plage=exp(-dot(t,t)/(reach*reach*0.6))*(0.03+0.16*pow(1.0-mu,1.2))*(0.6+0.4*star_noise(q*180.0,f32(i)));
  gain+=plage*r.life*strength;
  if orbital{
   let deficit=strength*magnetic_region(r,t,0.0,across,255u).x;
   gain=mix(gain,1.0,.88*clamp(deficit/.68,0.0,1.0))*(1.0-deficit);
  }
  // Flare ribbons: the feet of the arcade (a loop's feet stand at 0.70 of its half width), two wavy lanes either side of the
  // line between the polarities that move apart as the arcade grows, with brighter kernels along them; brightest in the flash,
  // an afterglow while the arcade lasts.
  if r.phase>=0.0{
   let feet=0.70*arcade_half(sep,r.phase);let side=sign(t.x);
   let wave=0.10*sep*star_noise(vec3<f32>(t.y/(0.35*sep),side*3.0,f32(i)+r.phase*0.15),12.0);
   let lane=abs(t.x)-feet-wave;let thin=max(0.6*MM,across*1.2);
   let kernels=0.35+0.65*smoothstep(-0.2,0.6,star_noise(vec3<f32>(t.y/(0.10*sep),side*5.0,f32(i)),13.0));
   ribbon+=(r.impulse+0.12*r.life*exp(-r.phase/4.0))*exp(-lane*lane/(thin*thin))*kernels*(1.0-smoothstep(0.65,0.95,abs(t.y)/sep));
  }
 }
 // At optical wavelengths the blue continuum responds more strongly to a temperature fluctuation.
 let continuum=pow(vec3<f32>(max(.01,gain)),vec3<f32>(.87,1.0,1.16));
 return vec4<f32>(select(continuum,vec3<f32>(gain),b.axes[0].w>.5),ribbon*strength);
}
// The "familiar" photosphere: the disk as the well-known filtered pictures show it, an orange to yellow-white ramp on brightness
// (in the manner of SDO/HMI continuum and solar-filter photographs). A display choice, labelled on screen as false colour.
fn familiar_disk(x:f32,tint:vec3<f32>)->vec3<f32>{
 // Hue by brightness, times the brightness itself, so spots, penumbrae and the limb stay as dark as they are.
 // In linear light, the colours themselves: the frame's tone curve (AgX, finish.wgsl) keeps hue, so the disk is given the orange
 // it shows. Before 16 November 2026 the curve was c / (1 + c) per channel, which pales bright colours, and these were pushed to
 // a deep red (1, 0.08, 0.004 to 1, 0.42, 0.12) to come out orange; the values here were solved so the disk shows what it
 // showed then (within 5/255 at the quiet disk's levels).
 let deep=vec3<f32>(0.68,0.10,0.010);let mid=vec3<f32>(0.55,0.19,0.003);let hot=vec3<f32>(0.64,0.41,0.078);
 // The hue turns hot only well above the quiet disk, so granulation and the mottle change brightness, not colour.
 let hue=mix(mix(deep,mid,smoothstep(0.2,0.85,x)),hot,smoothstep(1.2,1.8,x));
 return hue*x*tint;
}
// The K and F corona's electron density as the line integral needs it: Baumbach's (1937) brightness, I(rho) / disk centre =
// 1e-6 (0.0532 rho^-2.5 + 1.425 rho^-7 + 2.565 rho^-17) (Allen 1947, MNRAS 107, 426, eq. 1), is the integral along a line of
// impact parameter rho of 1e-6 (0.03043 r^-3.5 + 1.4514 r^-8 + 4.158 r^-18) per radius of path (each term's coefficient over
// sqrt(pi) Gamma((k-1)/2) / Gamma(k/2)), so a march through that density gives Baumbach's corona back, seen from anywhere.
fn corona_density(r:f32)->f32{let i2=1.0/(r*r);let i4=i2*i2;let i8=i4*i4;return 1e-6*(0.03043*i4*sqrt(r)+1.4514*i8+4.158*i8*i8*i2);}
// Its structure, a synthetic model on the direction only, so every feature is radial as coronal rays are: helmet streamers over
// the active regions narrowing outward, dark polar holes with thin plumes, and fine rays. Mean about 1.
fn corona_shape(x:vec3<f32>,r:f32,count:u32)->f32{
 var m=mix(0.35,1.15,smoothstep(0.82,0.45,abs(x.y)));
 let plumes=pow(0.5+0.5*star_noise(vec3<f32>(x.x,0.0,x.z)*60.0,3.0),6.0)*smoothstep(0.75,0.95,abs(x.y));
 m+=plumes*1.5;
 for(var i=0u;i<count;i++){
  let g=region_at(i);if g.life<=0.001{continue;}
  let width=(0.25+0.25*g.size)/(0.6+0.9*r);let c=dot(x,g.centre);if c<0.0{continue;}
  let d=acos(clamp(c,-1.0,1.0));m+=g.life*1.2*exp(-d*d/(width*width));
 }
 let rays=0.75+0.5*(0.5+0.5*star_noise(x*24.0,11.0))*(0.6+0.4*(0.5+0.5*star_noise(x*90.0,5.0)));
 return m*rays;
}
// What lies over the photosphere along one ray: the corona (marched in the angle from the point of closest approach, which puts
// samples where the density is and is exact for an eye inside the corona too), the chromosphere's rim with spicules, prominences
// as thin luminous sheets that also dim the disk behind them (filaments), and coronal loops over the active regions, brightened
// by their flares. o: the eye against the star's centre in radii (render axes); rd: the ray; hit: the distance to the photosphere
// in radii (negative: none); px: a pixel in radians. Returns light (in units of the disk centre's radiance, per channel colour
// already chosen for the view) and, in w, the transmission over the disk.
fn star_atmosphere(b:Body,o:vec3<f32>,rd:vec3<f32>,hit:f32,px:f32,height:f32,c2:f32,count:u32)->vec4<f32>{
 let familiar=b.axes[0].w>0.5;let seed=u32(b.axes[2].w);let days=b.axes[1].w;
 let along=-dot(o,rd);let closest=o+rd*along;let p=sqrt(max(1.0+c2-along*along,1e-8));
 // Corona.
 let theta0=atan2(-along,p);let s_end=select(1e6,hit,hit>0.0);let theta1=atan2(s_end-along,p);
 // The structure is on the direction only, so it is shaped at three points where the light comes from, not at every sample.
 const N=10u;let dth=(theta1-theta0)/f32(N);var corona=0.0;var tw=0.0;var tw2=0.0;var rw=0.0;
 for(var i=0u;i<N;i++){
  let th=theta0+(f32(i)+0.5)*dth;let r=p/max(cos(th),1e-4);if r<1.0{continue;}
  let w=corona_density(r)*r*r/p*dth;
  corona+=w;tw+=th*w;tw2+=th*th*w;rw+=r*w;
 }
 // Three points along the ray, at the light's mean angle and one spread either side, so the radial structure is averaged
 // along the line of sight as the integral does (streaks, not blotches), at a quarter of the cost of shaping every sample.
 if corona>0.0{
  let m=tw/corona;let sd=sqrt(max(tw2/corona-m*m,0.0));let rr=rw/corona;var shape=0.0;
  for(var k=0;k<3;k++){let th=clamp(m+f32(k-1)*sd,-1.5707,1.5707);let x=closest+rd*(p*tan(th));shape+=corona_shape(normalize(fixed(b,x)),rr,count);}
  corona*=shape/3.0;
 }
 // Coronal mass ejections: the flare of a larger region throws off a bubble, a thin shell that leaves the surface small and
 // grows as it climbs (its radius three tenths of its height, a cone 60 degrees across at last: the mean widths in coronagraphs
 // are 41 to 47 degrees, about 60 with the halo events counted, Webb and Howard 2012, Living Rev. Solar Phys. 9, 3), with a dense
 // core low inside it, the
 // erupted filament: the bright front and the core of the three-part form (Illing and Hundhausen 1985, as reviewed there);
 // the dark cavity between them is not drawn. The path through a thin shell is longest at its edge, which is why the front
 // shows as a bright loop; it is full ahead and fades away behind, toward the star. Its top climbs 1.2 radii a decay time (a time-lapse); its density falls as the square of its
 // distance, from a few times the corona's own at the start (a choice, set so the loop shows in the familiar view's
 // compressed corona out to about ten radii).
 for(var i=0u;i<count;i++){
  let g=region_at(i);if g.phase<0.3||g.phase>9.5||g.size<0.45{continue;}
  let axis=b.axes[0].xyz*g.centre.x+b.axes[1].xyz*g.centre.y+b.axes[2].xyz*g.centre.z;
  let climb=1.3*(g.phase-0.3);let radius=0.3*climb+0.02;let top=1.0+0.6*climb+radius;
  let dense=6.8e-7*(1.69/(top*top))*g.life*exp(-g.phase/8.0);
  let ball=axis*(1.0+0.6*climb)-o;let sb=dot(ball,rd);let off2=dot(ball,ball)-sb*sb;
  if off2<radius*radius{
   let h1=sqrt(radius*radius-off2);let h0=sqrt(max(0.7056*radius*radius-off2,0.0));
   for(var side=0;side<2;side++){
    var a0=sb-h1;var a1=sb-h0;if side==1{a0=sb+h0;a1=sb+h1;}
    a0=max(a0,0.0);a1=min(a1,s_end);
    // Only what is above the photosphere; and the shell is a front, not a closed ball: full ahead, fading away behind (toward
    // the star), and ragged.
    let x=o+rd*(0.5*(a0+a1));
    if a1>a0&&length(x)>1.0{
     let way=normalize(x-axis*(1.0+0.6*climb));
     corona+=dense*(a1-a0)*smoothstep(-0.55,0.35,dot(way,axis))*(0.7+0.5*star_noise(way*4.0+vec3<f32>(g.phase*0.1),f32(i)+20.0));
    }
   }
  }
  // The core: a soft clump a third of the bubble across, low inside it.
  let clump=axis*(1.0+0.6*climb-0.45*radius)-o;let sc=dot(clump,rd);let wide=0.3*radius;let far2=dot(clump,clump)-sc*sc;
  if sc>0.0&&sc<s_end&&far2<9.0*wide*wide{corona+=dense*4.0*1.7725*wide*exp(-far2/(wide*wide));}
 }
 // Drawn to 28 radii from the centre (the star's quad), so it fades out from 16 to 26 radii of the point of closest approach.
 corona=max(corona,0.0)*smoothstep(26.0,16.0,p);
 // Chromosphere: emission falling off with a 1.5 Mm scale height (a choice in the range of the quiet chromosphere's), integrated
 // along the grazing ray (sqrt(2 pi H) at the limb), widened to the pixel's footprint so the rim never aliases. Spicules: radial
 // jets about 0.5 Mm wide and 5 to 10 Mm tall, as a direction noise that fades when they are under a pixel.
 let R=b.center.w;let foot=max(height,1e-7)*px;
 let H=max(1.5*b.beta.w,foot*0.5);
 // The lowest point of the ray ahead of the eye: its closest approach, or the eye itself when that lies behind; over the disk, the
 // photosphere, seen through the layer's slant (1 / mu, capped at the limb's grazing path, so the rim runs on across the limb).
 let ahead=along>0.0;let low=select(o,closest,ahead);let rmin=select(1.0+height,p,ahead);
 let line=select(1.0,2.0,ahead&&hit<0.0);
 var chromo=0.5*line*sqrt(6.2831853*H)*exp(-max(rmin-1.0,0.0)/H);
 // From inside the layer looking up and out: the path from the eye, H over the cosine to the zenith, not a grazing line.
 if !ahead{let up=max(-along/(1.0+height),1e-3);chromo=min(H/up,sqrt(6.2831853*H)*0.5)*exp(-height/H);}
 if hit>0.0{let nh=normalize(o+rd*hit);let mu_hit=max(-dot(nh,rd),1e-3);chromo=min(H/mu_hit,sqrt(6.2831853*H));}
 let cf=normalize(fixed(b,low));let spic_w=.5*b.beta.w;let spic=smoothstep(1.0,3.0,spic_w/foot);
 let jets=pow(0.5+0.5*star_noise(cf/(.9*b.beta.w),17.0),6.0);let tall=6.0*b.beta.w*(0.5+jets);
 chromo+=spic*jets*0.5*line*sqrt(6.2831853*tall)*exp(-max(rmin-1.0,0.0)/tall)*0.5*select(1.0,0.0,hit>0.0);
 // Prominences and loops.
 var prom=0.0;var trans=1.0;var loops=vec2<f32>(0.0);
 // Nothing here reaches above 1.45 radii (prominences to 1 + 1.6 x 0.09, four times that erupting; loops to about 1 + 0.2): a
 // ray whose lowest point is higher meets none, and most of the screen near a star is such a ray.
 let planes=select(0u,count+3u,rmin<1.45);
 for(var i=0u;i<planes;i++){
  var n:vec3<f32>;var c:vec3<f32>;var span:f32;var height:f32;var bright:f32;var lifev=1.0;var erupt=-1.0;
  if i<count{let g=region_at(i);if g.life<=0.001{continue;}lifev=g.life;erupt=g.phase;
   let east_r=b.axes[0].xyz*g.east.x+b.axes[1].xyz*g.east.y+b.axes[2].xyz*g.east.z;let north_r=b.axes[0].xyz*g.north.x+b.axes[1].xyz*g.north.y+b.axes[2].xyz*g.north.z;
   let centre_r=b.axes[0].xyz*g.centre.x+b.axes[1].xyz*g.centre.y+b.axes[2].xyz*g.centre.z;
   if familiar{loops+=region_loops(o,rd,hit,centre_r,east_r,north_r,(0.025+0.04*g.size)*g.life,g,foot);}
   // A filament along the line between the polarities: in the plane through the centre and that line.
   c=g.centre;n=g.east;span=0.05+0.05*g.size;height=(0.02+0.03*g.size);bright=1.0;}
  else{let h=hash32(seed^((i-count)*0x51ed27u+7u));let lat=(40.0+20.0*unit_hash(h))*select(-1.0,1.0,(h&1u)!=0u)*0.0174533;let lon=unit_hash(h>>8u)*6.2831853+days*0.004;
   c=vec3<f32>(cos(lat)*sin(lon),sin(lat),cos(lat)*cos(lon));let ea=normalize(vec3<f32>(cos(lon),0.0,-sin(lon)));let az=unit_hash(h>>20u)*1.2-0.6;
   let along_dir=ea*cos(az)+cross(c,ea)*sin(az);n=normalize(cross(c,along_dir));span=0.12+0.12*unit_hash(h>>4u);height=0.04+0.05*unit_hash(h>>12u);bright=0.8;}
  // The sheet's plane in render axes.
  let nr=b.axes[0].xyz*n.x+b.axes[1].xyz*n.y+b.axes[2].xyz*n.z;let cr=b.axes[0].xyz*c.x+b.axes[1].xyz*c.y+b.axes[2].xyz*c.z;
  // A prominence is a sheet of some thickness: a slab 4 Mm through here (a choice; never under a pixel and a half). The ray's
  // stretch inside the slab, cut to the sheet's reach and to what lies in front of the photosphere, is sampled at five points.
  // Seen flat-on that is one short crossing; seen edge-on it is the sheet in depth, a soft band as wide as the slab. (Before 17
  // November 2026 the sheet had no thickness, and edge-on it drew a bright straight line, which the owner saw across the disk.)
  // An eruption: the filament over a flaring region lifts to four times its height and thins away, then forms again.
  // The sheet wanders either side of its plane by up to its own thickness, so a filament seen from above is not ruled: the
  // stretch is taken through a slab three thicknesses through, and each point weighed by its distance from the wandering sheet.
  let thick=max(4.0*MM,foot*1.5);let d0=dot(o,nr);let den=dot(rd,nr);
  var s0=0.0;var s1=1e3;
  if abs(den)>1e-6{let sa=(-1.5*thick-d0)/den;let sb=(1.5*thick-d0)/den;s0=min(sa,sb);s1=max(sa,sb);}else if abs(d0)>1.5*thick{continue;}
  let lift=1.0+3.0*smoothstep(0.0,1.5,erupt);let tall=height*1.6*lift;
  let fade=1.0-0.9*smoothstep(0.5,2.5,erupt)*(1.0-smoothstep(7.0,9.5,erupt));
  let ball=cr*(1.0+0.5*tall)-o;let sb=dot(ball,rd);let reach=sqrt(span*span+0.25*tall*tall)+thick;let q2=reach*reach-(dot(ball,ball)-sb*sb);
  if q2<=0.0{continue;}
  let q=sqrt(q2);s0=max(max(s0,sb-q),0.0);s1=min(s1,sb+q);if hit>0.0{s1=min(s1,hit);}
  if s1<=s0{continue;}
  // Threads about 2 Mm apart, averaged out where that is under three pixels.
  let thread_seen=smoothstep(3.0,8.0,span/14.0/foot);
  let run=normalize(cross(nr,cr));var sum=0.0;
  for(var k=0;k<5;k++){
   let x=o+rd*(s0+(s1-s0)*(f32(k)+0.5)/5.0);let r=length(x);if r<1.0{continue;}
   let u=dot(x,run)/(r*span);let z=(r-1.0)/height;
   // Hedgerow: a ragged top over the span, vertical threads, soft ends.
   let top=sqrt(max(1.0-u*u,0.0))*(0.7+0.3*star_noise(vec3<f32>(u*5.0,f32(i)*3.1,0.5),2.0))*lift;
   let thread=mix(0.75,0.45+0.55*(0.5+0.5*star_noise(vec3<f32>(u*14.0,z*1.5,f32(i)),9.0)),thread_seen);
   let stray=(d0+den*(s0+(s1-s0)*(f32(k)+0.5)/5.0)-thick*star_noise(vec3<f32>(u*2.2,f32(i)*5.3,1.5),14.0))/(0.5*thick);
   sum+=smoothstep(top,top*0.55,z)*max(1.0-0.5*z/lift,0.0)*thread*(1.0-smoothstep(0.75,1.0,abs(u)))*exp(-stray*stray)*1.7;
  }
  // The path in slab thicknesses; held to twelve, as the thin sheet's edge-on brightening was.
  let sheet=min(sum/5.0*(s1-s0)/thick,12.0)*lifev*fade;
  // Against the disk a prominence is a dark filament: it dims what is behind and adds little light of its own.
  prom+=sheet*bright*(1.0+2.0*smoothstep(0.0,1.0,erupt))*select(1.0,0.1,hit>0.0);trans*=exp(-sheet*select(.00015,.12,familiar));
 }
 // Colour and scale by view. True colour: what an eye would see, so everything is a millionth of the disk and shows only with the
 // disk covered (chromosphere and prominences at about 3e-5 and 1e-5 of the disk centre, a choice of the order of eclipse
 // photographs; loops are not seen in white light). Familiar: the corona compressed as eclipse pictures are processed (a radial
 // filter: half the disk centre's light at 1.05 radii, the 0.85 power of its brightness after that), the chromosphere and prominences in H-alpha red, loops in 171 A gold, a flare's arcade in a hotter white. Labelled.
 var light:vec3<f32>;
 if familiar{
  // None over the disk, as in an eclipse picture where the Moon covers it.
  // Looking out from inside the corona the compression would make a bright grey sky; it is held down there (to 12% straight out).
  let c=0.55*pow(corona/2e-6,0.85)*select(1.0,0.0,hit>0.0)*mix(0.12,1.0,smoothstep(-0.2,0.25,along/(1.0+height)));
  light=vec3<f32>(1.0,0.93,0.82)*c+vec3<f32>(1.0,0.28,0.32)*(chromo*select(14.0,4.0,hit>0.0)+prom*0.05)+vec3<f32>(1.0,0.72,0.22)*loops.x*0.2+vec3<f32>(1.0,0.93,0.78)*loops.y*0.2;
 }else{
  light=vec3<f32>(corona)+vec3<f32>(1.0,0.35,0.4)*(chromo*3e-5+prom*1e-5*0.05);
 }
 return vec4<f32>(light,trans);
}
// Coronal loops over an active region, bright in the extreme ultraviolet. Each is a curve from one foot to the other in a plane
// of its own, in the shape of a dipole's field line (r = L sin^2 of the angle from the axis, cut 35 degrees from each end, so it
// leans in a little at the feet and is rounder than a semicircle); a quiet region has `star_field.star.z` of them (14), each with
// its own place along and across the line between the polarities, half width, height (most low, a few tall), lean, thickness
// (0.7 to 2.3 Mm: wider than the loops the sharpest extreme ultraviolet images resolve, most often about 0.55 Mm, Aschwanden
// and Peter 2017, ApJ 840, 4; a choice, so that they span pixels from where a region is usually seen) and
// brightness, fainter the higher it reaches, brightest at its top. A flare adds an arcade of twenty-four hot loops across the line,
// whose half width is `arcade_half`, so their feet are the ribbons, and which grow and then fade as the phase runs. (Before 17
// November 2026: four even semicircles, which read as stripes.) A simple model in the manner of a field, not a field
// extrapolation. Real tubes: the ray's closest approach to each curve (coarse points, then two closer passes round the
// nearest), a Gaussian tube never under two pixels' footprint, its light kept as it widens. Hidden by the disk; faint against it.
// Returns the quiet loops' light and the arcade's.
fn loop_point(base:vec3<f32>,east:vec3<f32>,up:vec3<f32>,a:f32,top:f32,th:f32)->vec3<f32>{
 let s=sin(th);return base+east*(a*s*s*cos(th)*2.5981)+up*(top*(s*s*s-0.18870)*1.23259);
}
fn region_loops(o:vec3<f32>,rd:vec3<f32>,hit:f32,cr:vec3<f32>,east:vec3<f32>,north:vec3<f32>,sep:f32,g:Region,foot:f32)->vec2<f32>{
 // A ray that passes far from the region meets none of its loops.
 let vc=cr-o;let sc=dot(vc,rd);let far=sep*4.0;if dot(vc,vc)-sc*sc>far*far{return vec2<f32>(0.0);}
 let quiet=u32(star_field.star.z);let coarse=u32(star_field.star.w);let hot=select(0u,24u,g.phase>=0.0);
 let step=(3.14159265-2.0*0.61087)/f32(coarse);var light=vec2<f32>(0.0);
 for(var k=0u;k<quiet+hot;k++){
  var a:f32;var top:f32;var along:f32;var across:f32;var lean:f32;var w:f32;var bright:f32;
  if k<quiet{
   let h=hash32(g.hash^(k*0x9e3779b1u+0x7f4a7c15u));let tall=unit_hash(h>>15u);
   along=(unit_hash(h)-0.5)*1.7*sep;across=(unit_hash(h>>5u)-0.5)*0.5*sep;a=sep*(0.45+0.9*unit_hash(h>>10u));
   top=a*(0.6+1.4*tall*tall);lean=(unit_hash(h>>20u)-0.5)*1.1;w=MM*(0.7+1.6*unit_hash(h>>24u));
   bright=(0.3+0.7*unit_hash(h>>3u))*exp(-top/(2.5*sep))*2.2;
  }else{
   let j=k-quiet;let h=hash32(g.hash^(j*0x85ebca6bu+0x1b873593u));
   // Packed closer than they are thick apart, each its own reach, height, thickness and brightness, so they read as one
   // corrugated arcade and not as rungs (eight even loops did); every eighth is broad and faint, the hot plasma between.
   let glow=(j&7u)==7u;let strong=unit_hash(h>>20u);
   along=(f32(j)-11.5+1.6*(unit_hash(h)-0.5))*0.07*sep;across=0.0;a=arcade_half(sep,g.phase)*(0.82+0.3*unit_hash(h>>8u));
   top=a*(0.7+0.5*unit_hash(h>>12u));lean=(unit_hash(h>>16u)-0.5)*0.4;w=MM*select(0.7+1.3*unit_hash(h>>24u),5.0,glow);
   bright=smoothstep(0.0,0.7,g.phase)*exp(-g.phase/3.3)*select(1.2+4.0*strong*strong,0.9,glow);
  }
  if bright<=0.002{continue;}
  let wide=max(w,foot*2.0);let base=normalize(cr+north*along+east*across);let up=normalize(cr*cos(lean)+north*sin(lean));
  // A ray that passes clear of this loop's own bound skips it.
  let vm=base+up*(top*0.45)-o;let sm=dot(vm,rd);let bound=max(a,top*0.6)+wide*3.0;
  if dot(vm,vm)-sm*sm>bound*bound{continue;}
  var best=1e9;var bth=0.0;var bs=0.0;
  for(var j=0u;j<coarse;j++){let th=0.61087+(f32(j)+0.5)*step;let v=loop_point(base,east,up,a,top,th)-o;let sp=dot(v,rd);let d2=dot(v,v)-sp*sp;if d2<best{best=d2;bth=th;bs=sp;}}
  var spread=step*0.25;
  for(var closer=0;closer<2;closer++){
   let centre=bth;
   for(var j=0;j<4;j++){let th=clamp(centre+(f32(j)-1.5)*spread,0.61087,2.53072);let v=loop_point(base,east,up,a,top,th)-o;let sp=dot(v,rd);let d2=dot(v,v)-sp*sp;if d2<best{best=d2;bth=th;bs=sp;}}
   spread*=0.25;
  }
  if bs<0.0||(hit>0.0&&bs>hit){continue;}
  let s=sin(bth);
  // Against the disk the quiet loops are faint beside the photosphere, as in a composite; a flare's arcade outshines it.
  let e=exp(-best/(wide*wide))*(w/wide)*bright*(0.55+0.45*s*s*s)*g.life*select(1.0,select(0.8,0.45,k<quiet),hit>0.0);
  if k<quiet{light.x+=e;}else{light.y+=e;}
 }
 return light;
}
// Visible-continuum formation at the very near limb. The opacity scale is a
// fraction of a granule, so it follows the catalogued T/g scale for each star.
// Optical depth grows continuously downward. The source function follows the
// star's wavelength-dependent limb coefficients (Eddington-Barbier approximation).
fn column_magnetic_field(p:vec3<f32>,across:f32,regions:u32,spots:vec3<u32>)->vec2<f32>{
 let radius=length(p);let q=p/radius;
 var remaining=regions;var field=vec2<f32>(0);
 while remaining!=0u{
  let idx=firstTrailingBit(remaining);remaining&=remaining-1u;
  let r=region_at(idx);let v=q-r.centre;
  let t=vec2<f32>(dot(v,r.east),dot(v,r.north));
  let mask=(spots[idx>>2u]>>((idx&3u)*8u))&255u;
  field=max(field,magnetic_region(r,t,radius-1.0,across,mask));
 }
 return field;
}
struct PhotosphericColumn {color:vec4<f32>,distance:f32,magnetic:f32}
fn photospheric_column(b:Body,along:f32,c2:f32,eye:vec3<f32>,dir:vec3<f32>,pixel:f32,count:u32)->PhotosphericColumn{
 let h=.105*b.beta.w;let top=10.0*h;let bottom=-5.0*h-.65*MM;
 let outside=c2-top*(2.0+top);let det=along*along-outside;
 if det<=0.0 || (outside>=0.0 && along<=0.0){return PhotosphericColumn(vec4<f32>(0),0.0,0.0);}
 let root=sqrt(det);var t=max(0.0,outside/max(along+root,1e-9));
 var end=along+root;let deep=c2-bottom*(2.0+bottom);let lower=along*along-deep;
 if deep>0.0 && lower>0.0 && along>0.0{end=min(end,deep/(along+sqrt(lower)));}
 var regions=0u;var spots=vec3<u32>(0);
 if b.sun.x>.0001{
  for(var j=0u;j<count;j++){
   let r=region_at(j);let closest=clamp(dot(r.centre-eye,dir),t,end);
   let delta=eye+dir*closest-r.centre;
   let reach=(.035+.05*r.size)*r.life+(.01+.018*r.size)*1.8+top+.65*MM;
   if r.life<=.001 || dot(delta,delta)>reach*reach{continue;}
   let start=eye+dir*t-r.centre;
   let origin=vec2<f32>(dot(start,r.east),dot(start,r.north));
   let path=vec2<f32>(dot(dir,r.east),dot(dir,r.north))*(end-t);
   var mask=0u;
   for(var k=0u;k<8u;k++){
    let spot=region_spot(r,k);let offset=spot.at-origin;
    let nearest=offset-path*clamp(dot(offset,path)/max(dot(path,path),1e-12),0.0,1.0);
    // Allow for projecting the whole photospheric shell onto the tangent plane.
    let extent=1.65*spot.radius+.20*max(top,-bottom)+.13*MM;
    if dot(nearest,nearest)<=extent*extent{mask|=1u<<k;}
   }
   if mask!=0u{regions|=1u<<j;spots[j>>2u]|=mask<<((j&3u)*8u);}
  }
 }
 // Interpolate the magnetic material along the ray. The smaller fixed physical
 // interval resolves the wall and umbral dots where optical-depth steps get long.
 let interval=max(.12*MM,pixel*t*.6);
 var field_lo=vec2<f32>(0);var field_hi=vec2<f32>(0);var field_end=t;
 if regions!=0u{field_hi=column_magnetic_field(eye+dir*t,max(t*pixel,.015*MM),regions,spots);}
 var transmission=1.0;var emission=vec3<f32>(0);var moment=0.0;
 var depression=0.0;var magnetic=0.0;
 for(var i=0u;i<192u;i++){
  if t>=end || transmission<.0005{break;}
  let g=c2+t*(t-2.0*along);let radius=sqrt(max(0.0,1.0+g));
  let z=g/(1.0+radius);
  let opacity=exp(clamp(-(z+depression)/h,-14.0,9.0));
  // Bound both the change in altitude and the optical thickness of each
  // interval. The first samples stay in place when the ray grazes the lower limit.
  let slant=max(abs(t-along)/max(radius,1e-6),sqrt(2.0*h));
  let ds=min(end-t,h*min(.46/slant,.42/opacity));
  let at=t+.5*ds;let gm=c2+at*(at-2.0*along);
  var deficit=0.0;
  if regions!=0u{
   if at>=field_end{
    let skip=floor((at-field_end)/interval);
    field_end+=(skip+1.0)*interval;field_lo=field_hi;
    let footprint=max(at*pixel,.015*MM);
    if skip>0.0{field_lo=column_magnetic_field(eye+dir*(field_end-interval),footprint,regions,spots);}
    field_hi=column_magnetic_field(eye+dir*field_end,footprint,regions,spots);
   }
   let field=mix(field_lo,field_hi,clamp(1.0-(field_end-at)/interval,0.0,1.0))*b.sun.x;
   deficit=field.x;depression=field.y;
  }
  let zm=gm/(1.0+sqrt(max(0.0,1.0+gm)));
  let tau=exp(clamp(-(zm+depression)/h,-14.0,9.0));
  let weight=transmission*(1.0-exp(-tau*ds/h));
  // In a plane-parallel column the integral of 1, tau and tau²/2 is
  // 1, mu and mu². This reproduces the fitted limb law at orbital distance.
  let v_tau=min(tau,4.0);
  let source=1.0-b.beta.xyz-b.ring.xyz+(b.beta.xyz+2.0*b.ring.xyz)*v_tau-.5*b.ring.xyz*v_tau*v_tau;
  let thermal=pow(vec3<f32>(max(.01,1.0-deficit)),vec3<f32>(.87,1.0,1.16));
  emission+=weight*max(source,vec3<f32>(.01))*thermal;
  magnetic+=weight*clamp(deficit/.68,0.0,1.0);
  moment+=weight*at;transmission-=weight;t+=ds;
 }
 let cover=1.0-transmission;
 return PhotosphericColumn(vec4<f32>(emission,cover),moment/max(cover,1e-8),magnetic/max(cover,1e-8));
}

fn opacity_weighted_distance(a:f32,t:f32,b:f32,u:f32,blend:f32)->f32{
 return mix(a*t,b*u,blend)/max(mix(a,b,blend),1e-8);
}
fn near_photosphere(b:Body,o:vec3<f32>,rd:vec3<f32>,along:f32,c2:f32,height:f32,pixel:f32,count:u32,hit:f32)->BodyPixel{
 let rdf=fixed(b,rd);let eye=fixed(b,o);
 let column=photospheric_column(b,along,c2,eye,rdf,pixel,count);let opacity=column.color.a;
 let familiar=b.axes[0].w>.5;let centre=dot(b.air.xyz,vec3<f32>(.2126,.7152,.0722));
 var surface=vec3<f32>(0);
 if opacity>.0001{
  let t=column.distance;
  let pos=eye+rdf*t;let q=normalize(pos);
  let g=c2+t*(t-2.0*along);let z=g/(1.0+sqrt(max(0.0,1.0+g)));
  let near=star_field.eye.xyz+rdf*t-q*z;
  let mu=clamp(-dot(q,rdf),0.0,1.0);
  let cell=b.beta.w;let across=max(pixel*t,.018*cell*sqrt(1.0-mu*mu));
  var detail=vec4<f32>(1,1,1,0);
  if b.sun.x>.0{
   detail=star_detail(b,q,mu,across,count,near,granule_warp(q/cell,b.sun.w),false);
  }
  // Cooler magnetic gas suppresses quiet-Sun convection. Its own umbral
  // dots, filaments and light bridges have already contributed in the column.
  let spectrum=column.color.rgb*mix(detail.rgb,vec3<f32>(1),.88*column.magnetic);
  surface=b.air.xyz*(spectrum+.05*detail.a*opacity);
  if familiar{
   let tint=mix(vec3<f32>(1),b.air.xyz/max(centre,1e-9),.6);
   let brightness=dot(spectrum,vec3<f32>(.2126,.7152,.0722))/opacity;
   surface=centre*opacity*(1.5*familiar_disk(brightness,tint)+2.0*vec3<f32>(1,.95,.8)*detail.a);
  }
 }
 let air=star_atmosphere(b,o,rd,hit,pixel,height,c2,count);
 let air_tint=select(b.air.xyz,vec3<f32>(centre),familiar);
 return BodyPixel(vec4<f32>(surface*air.w+air.xyz*air_tint,opacity),column.distance*b.center.w);
}
fn star(b:Body,rd:vec3<f32>)->BodyPixel{
 // s and radius are sines of angles from the disk's centre: s / sin(angular radius) is the impact parameter over the true
 // radius, exact for a nearby sphere too.
 let to=normalize(b.center.xyz);let s=length(cross(rd,to));let pixel=2.0*v.screen.w/v.screen.y;let radius=max(sin(b.shape.w),pixel);
 let inside=clamp((radius-s)/pixel+0.5,0.0,1.0);let front=dot(rd,to)>0.0;
 let familiar=b.axes[0].w>0.5;
 // The eye against the centre, in radii, and the ray's distance to the photosphere, from the angular radius (computed in double
 // precision on the CPU) rather than the eye-relative centre in metres: at the surface that centre is 7e8 m held to 64 m, and
 // |o|^2 - 1 by subtraction collapsed into rings (the owner saw concentric circles at zero height). c = |o|^2 - 1 = cot^2(alpha),
 // and the hit by the stable root c / (b + sqrt(b^2 - c)).
 let sa=max(sin(b.shape.w),1e-7);let ca=cos(b.shape.w);let eye_r=1.0/sa;let c2=(ca*ca)/(sa*sa);let height=ca*ca/(sa*(1.0+sa));
 let R=b.center.w;let o=-to*eye_r;let along=dot(rd,to)*eye_r;let disc=along*along-c2;
 let hit=select(-1.0,c2/(along+sqrt(max(disc,0.0))),front&&along>0.0&&disc>0.0);
 // Limb darkening by the angle at the point met, when there is one (exact at any distance); the sines' ratio otherwise.
 var mu=sqrt(max(0.0,1.0-min(s/radius,1.0)*min(s/radius,1.0)));
 if hit>0.0{mu=clamp(-dot(normalize(o+rd*hit),rd),0.0,1.0);}
 let x=1.0-mu;
 let limb=max(vec3<f32>(0.0),1.0-b.beta.xyz*x-b.ring.xyz*x*x);
 // The active regions: the CPU's, for the star they were computed for (the one with the largest disk); none for another.
 let count=select(0u,min(u32(star_field.star.y),MAX_REGIONS),u32(b.axes[2].w)==u32(star_field.star.x));
 let column_weight=1.0-smoothstep(.04,.15,height);
 var column=BodyPixel(vec4<f32>(0),0.0);
 if column_weight>0.0{
  column=near_photosphere(b,o,rd,along,c2,height,pixel,count,hit);
  if column_weight>=1.0{return column;}
 }
 var gain=limb;var ribbon=0.0;
 // Where along the ray the surface is met (the sphere, until the relief says otherwise), and whether the ray, grazing the
 // sphere, passed over the relief and out again: then it sees past the star, and the horizon has the relief's shape.
 var met=hit;var through=false;
 if b.sun.x>0.0&&inside>0.0&&front&&hit>0.0{
  // The ray and the eye in the star's fixed axes; the point on the photosphere this ray meets and the pixel's footprint there
  // in radii: its distance times the pixel's angle (before 16 November 2026 this used the angle over the disk's angular radius,
  // which is right only from far away and made granules a hundred times too small to draw at 1.01 radii).
  let rdf=fixed(b,rd);let eye=fixed(b,o);let cell=b.beta.w;let phase=b.sun.w;
  var q=normalize(eye+rdf*hit);var warp=granule_warp(q/cell,phase);
  // Relief (star_depth). `star_field.eye.w`: how many steps the search takes at most where the ray grazes, from the quality
  // preset; 0 for no relief.
  let steps0=star_field.eye.w;let scale=select(0.4,1.0,familiar)*b.sun.x;let deepest=RELIEF_BOUND*cell*scale;
  // The slope of the relief along the ray's track over the ground (the rise of the depth per unit of ground, away from the eye).
  var slope=0.0;
  // Only where the granules span pixels (star_depth draws none under 0.8 of one) and the relief would move the picture by half
  // a pixel: on the Sun that is within about 0.35 radii of the surface; from farther none of this runs.
  let lying=sqrt(max(1.0-mu*mu,0.0));let resolved=smoothstep(0.8,6.0,cell/(hit*pixel)*sqrt(max(mu,0.05)));
  if steps0>0.5&&deepest*resolved*lying/max(mu,0.05)>0.5*hit*pixel{
   // The ray under the sphere. Its depth at s is (2 along s - s^2 - c2) / (1 + sqrt(1 + g)), with g = c2 - 2 along s + s^2: the
   // stable form of 1 - |o + rd s| near the surface. It reaches the layer's floor at the nearer root of g = D^2 - 2 D, or,
   // grazing, never does and leaves the sphere again at along + sqrt(disc).
   let reach=disc-deepest*(2.0-deepest);let floored=reach>0.0;
   let far=select(along+sqrt(disc),along-sqrt(max(reach,0.0)),floored);
   let warp0=warp;let warp1=granule_warp(normalize(eye+rdf*far)/cell,phase);
   // The search. Each look at the depth costs about as much as the rest of the photosphere, so they are few: from above, two
   // (where the ray enters, and where it would land if the ground were level at the depth found there), then the crossing by
   // their gaps; the more the ray grazes the more looks follow, up to `steps0` more, spread toward the far end and shifted
   // from pixel to pixel so their steps do not line up into terraces. Not a conservative march: a crest narrower than a step
   // can be passed over, and the error is at most one step of the ray.
   // Each place is handed over as it lies on the sphere (the ray's point lifted by the ray's own depth), so the depth is a
   // function of the place on the sphere alone: a heightfield.
   let depth0=star_depth(b,q,star_field.eye.xyz+rdf*hit,hit*pixel,mu,warp0,scale);
   let more=u32(steps0*smoothstep(0.3,0.9,1.0-mu)+0.5);
   // (The pixel, from the ray: the shift must be laid on the screen's own grid, or it beats against it in rings.)
   let ahead=dot(rd,v.forward.xyz);let grid=floor((vec2<f32>(dot(rd,v.right.xyz)/(v.screen.z*v.screen.w),dot(rd,v.up.xyz)/v.screen.w)/ahead*0.5+0.5)*v.screen.xy);
   let shift=fract(52.9829189*fract(0.06711056*grid.x+0.00583715*grid.y));
   var before_s=hit;var before_gap=-depth0;var before_depth=depth0;var found=false;var after_s=hit;var after_gap=0.0;
   for(var i=0u;i<=more;i++){
    // The first look is the level-ground landing; the rest divide what is left.
    var s=min(hit+depth0/max(mu,0.02),far);
    if i>0u{let part=(f32(i)-1.0+shift)/f32(more);s=mix(s,far,part*part*0.5+part*0.5);}
    if s<=before_s{continue;}
    let f=clamp((s-hit)/max(far-hit,1e-12),0.0,1.0);
    let g=c2-2.0*along*s+s*s;let ray=-g/(1.0+sqrt(max(1.0+g,0.0)));
    let qs=normalize(eye+rdf*s);let depth=star_depth(b,qs,star_field.eye.xyz+rdf*s+qs*ray,s*pixel,mu,mix(warp0,warp1,f),scale);
    let gap=ray-depth;slope=(depth-before_depth)/max((s-before_s)*lying,1e-9);
    if gap>=0.0{let t=before_gap/min(before_gap-gap,-1e-12);met=mix(before_s,s,t);found=true;after_s=s;after_gap=gap;break;}
    before_s=s;before_gap=gap;before_depth=depth;
   }
   // Where the ray grazes, a step is long and the crossing between its ends is not on a straight line: one more look there, and
   // the crossing again on the side it falls.
   if found&&more>0u{
    let f=clamp((met-hit)/max(far-hit,1e-12),0.0,1.0);let g=c2-2.0*along*met+met*met;
    let ray=-g/(1.0+sqrt(max(1.0+g,0.0)));let qs=normalize(eye+rdf*met);
    let gap=ray-star_depth(b,qs,star_field.eye.xyz+rdf*met+qs*ray,met*pixel,mu,mix(warp0,warp1,f),scale);
    if gap>=0.0{met=mix(before_s,met,before_gap/min(before_gap-gap,-1e-12));}else{met=mix(met,after_s,gap/min(gap-after_gap,-1e-12));}
   }
   if !found{
    // Past the last look: on by the last gap as if the ground stayed level there, to the layer's floor at most; a grazing ray
    // that reaches the far side of the sphere still above the ground has passed over it.
    let on=before_s-before_gap/max(mu,0.02);
    if on<far{met=on;}else if floored{met=far;}else{through=true;}
   }
   warp=mix(warp0,warp1,clamp((met-hit)/max(far-hit,1e-12),0.0,1.0));
   q=normalize(eye+rdf*met);
  }
  if !through{
   let sunk=c2-2.0*along*met+met*met;let foot=met*pixel;let near=star_field.eye.xyz+rdf*met-q*(sunk/(1.0+sqrt(max(1.0+sunk,0.0))));
   // The slope tilts the surface toward or away from the eye, and the limb darkening is taken at the tilted surface's own
   // angle: ground that rises away from the eye faces it and is brighter, ground that falls away is darker, steep far walls
   // dark. Only the slope along the ray is known (the search's last two looks), which is the part that changes that angle;
   // looking straight down there is none, as a glowing surface seen square-on shows none.
   // (Looking nearly straight down the track over the ground is too short to give a slope: none is taken there.)
   slope=clamp(slope,-3.0,3.0)*smoothstep(0.02,0.15,lying);
   if slope!=0.0{
    let xs=1.0-clamp((mu-slope*lying)/sqrt(1.0+slope*slope),0.03,1.0);
    // The broadband surface emits from a layer. Away from the limb its
    // contrast follows the local source function; a tilted facet must not look lit from outside.
    let wall=select(.18*(1.0-smoothstep(.12,.55,mu)),1.0,familiar);
    gain=mix(limb,max(vec3<f32>(0.0),1.0-b.beta.xyz*xs-b.ring.xyz*xs*xs),wall*b.sun.x);
   }
   let d=star_detail(b,q,mu,foot,count,near,warp,true);gain*=d.xyz;ribbon=d.w;
   // The familiar view's mottle: the supergranular network and plage as H-alpha and 304 A pictures show them, cells of 20 to 60 Mm
   // drifting slowly, so the disk is never a smooth ball at any range. Part of the labelled composite, not a white-light feature.
   if familiar{let t=b.sun.w*0.02;
    let m1=star_noise(q*22.0+vec3<f32>(t,0.0,-t),21.0);let m2=star_noise(q*61.0-vec3<f32>(0.0,t,t),22.0);let m3=star_noise(q*150.0+vec3<f32>(t*2.0),23.0);
    let seen1=smoothstep(0.5,3.0,(1.0/22.0)/foot);let seen2=smoothstep(0.5,3.0,(1.0/61.0)/foot);let seen3=smoothstep(0.5,3.0,(1.0/150.0)/foot);
    gain*=1.0+b.sun.x*(0.06*m1*seen1+0.05*m2*seen2+0.04*m3*seen3);}
  }
 }
 var surface=b.air.xyz*gain;
 let centre_lum=dot(b.air.xyz,vec3<f32>(0.2126,0.7152,0.0722));
 if familiar{
  let tint=b.air.xyz/max(centre_lum,1e-9);let warm=mix(vec3<f32>(1.0),tint,0.6);
  surface=familiar_disk(dot(gain,vec3<f32>(0.2126,0.7152,0.0722)),warm)*centre_lum*1.5+vec3<f32>(1.0,0.95,0.8)*ribbon*centre_lum*2.0;
 }else{
  surface+=b.air.xyz*ribbon*0.05;
 }
 // A ray that passed over the relief and out sees past the star: no disk there, and the atmosphere as beside the limb.
 let shown=select(0.0,inside,front&&!through);let reached=select(met,-1.0,through);
 // The disk's mean radiance, which sets its glare.
 let mean=b.air.xyz*(1.0-b.beta.xyz/3.0-b.ring.xyz/6.0);
 // The glare is the eye's and the camera's, not the star's: fixed against the disk it surrounds, gone when the disk is hidden.
 // Scaled so the Sun's keeps the former glare's luminance (0.016 x 0.877 at the limb, over a mean disk luminance of 12.34).
 let glow=mean*0.001137*pow(radius/max(s,radius),2.0)*select(0.0,1.0,front)*b.sun.z;
 // The atmosphere over the photosphere: in front of the disk it adds its light and dims by the filaments; beside it, it is all
 // there is. The Sun's activity sign says whether its corona is modelled (every star now: a synthetic one beyond the Sun's).
 let air=star_atmosphere(b,o,rd,reached,pixel,height,c2,count);
 let atmosphere=air.xyz*centre_lum*select(vec3<f32>(1.0),b.air.xyz/max(centre_lum,1e-9),!familiar);
 let radiance=surface*shown*air.w+atmosphere+select(vec3<f32>(0),glow,familiar)*(1.0-shown);
 let color=mix(vec4<f32>(radiance,shown),column.color,column_weight);
 let weight=opacity_weighted_distance(shown,max(met,0.0)*R,column.color.a,column.distance,column_weight);
 return BodyPixel(color,weight);
}
// Same quadrature as `aerial` in explorer.wgsl, so a body's rim matches what the single skin draws.
fn air_along(b:Body,o:vec3<f32>,rd:vec3<f32>,limit:f32,color:vec3<f32>)->vec3<f32>{
 let shell=b.center.w+b.beta.w;let mid=-dot(o,rd);let d2=dot(o,o)-mid*mid;let det=shell*shell-d2;if det<=0.0{return color;}
 let half=sqrt(det);let start=max(0.0,mid-half);let end=min(limit,mid+half);if end<=start{return color;}
 const STEPS=10u;let ds=(end-start)/f32(STEPS);var T=vec3<f32>(1);var light=vec3<f32>(0);let sun=b.sun.xyz;let mu=dot(fixed(b,rd),sun);let phase=0.75*(1.0+mu*mu);
 for(var i=0u;i<STEPS;i++){
  let p=o+rd*(start+(f32(i)+0.5)*ds);let q=fixed(b,p);let shape=vec3<f32>(b.center.w,b.shape.x,b.center.w);
  // Height over the figure, not a sphere. Over a sphere a giant's mid-latitudes lie thousands of km under the reference, in fog.
  let h=(length(q/shape)-1.0)*b.center.w;let radial=normalize(q);let day=smoothstep(-0.08,0.04,dot(radial,sun));
  // A giant's air thickens without end below its reference level: that is what closes the view.
  let density=exp(min(-h/b.air.w,30.0));let tr=exp(-b.beta.xyz*density*ds);light+=T*(1.0-tr)*b.air.xyz*phase*day;T*=tr;
 }
 return color*T+light*b.sun.w;
}
// Radial structure of Saturn's main rings. The boundaries and the rough optical depths are as published
// (NSSDC ring fact sheet, and Colwell et al.); the fine ringlets inside them are synthesized, not a measured
// radial profile, and the provenance line says so. x: normal optical depth; y: brightness.
fn ring_noise(x:f32)->f32{let i=floor(x);let t=x-i;let w=t*t*(3.0-2.0*t);let a=fract(sin(i*12.9898)*43758.5453);let b=fract(sin((i+1.0)*12.9898)*43758.5453);return mix(a,b,w)*2.0-1.0;}
fn saturn_ring(r:f32)->vec2<f32>{
 var band=vec2<f32>(0);
 if r<74658.0e3||r>=136775.0e3{return band;}
 if r<92000.0e3{band=vec2<f32>(0.10,0.30);}
 else if r<117580.0e3{band=vec2<f32>(1.8,0.62);}
 else if r<122170.0e3{band=vec2<f32>(0.12,0.28);}
 else{band=vec2<f32>(0.55,0.50);}
 // Named gaps, wide enough that a pixel can show them from nearby: Encke and Huygens.
 if abs(r-133589.0e3)<160.0e3||abs(r-117680.0e3)<140.0e3{return vec2<f32>(0);}
 let km=r/1000.0;let ringlets=ring_noise(km/1400.0)*0.5+ring_noise(km/430.0)*0.3+ring_noise(km/130.0)*0.2;
 band.x*=max(0.05,1.0+ringlets*0.7);band.y*=1.0+ringlets*0.22;
 return band;
}
struct BodyPixel {@location(0) color:vec4<f32>,@location(1) distance:f32}

// Fraction of the solar disk whose rays cross the ring plane inside this edge.
// Planetary receivers are inside the inner ring cylinder. Project its tangent
// at the solar azimuth onto the solar disk and integrate the circular segment.
fn ring_coverage(radius:f32,p:vec3<f32>,sun:vec3<f32>,horizontal:vec2<f32>,
                 ahead:f32,perp2:f32,solar_angle:f32,span:vec3<f32>)->f32{
 let radial=sqrt(max(radius*radius-perp2,1.0));let run=radial-ahead;
 let edge=p.xz+horizontal*run;
 let normal=normalize(vec3<f32>(p.y*edge.x,run*radial,p.y*edge.y));
 let angle=-sign(p.y)*dot(sun,normal);
 // Match the variance of the solar disk convolved with a uniform march segment.
 let sweep=dot(span,normal)/length(vec2<f32>(run,p.y));
 let width=sqrt(solar_angle*solar_angle+sweep*sweep/3.0);
 let x=clamp(angle/max(width,1e-8),-1.0,1.0);
 if abs(x)>=1.0{return step(0.0,x);}
 return .5+(asin(x)+x*sqrt(1.0-x*x))/PI;
}
fn ring_sunlight(b:Body,p:vec3<f32>,span:vec3<f32>)->f32{
 if b.ring.y==0.0{return 1.0;}
 let sun=b.sun.xyz;
 if abs(sun.y)>b.ring.z && p.y*sun.y>=0.0 && abs(p.y)>.5*abs(span.y){return 1.0;}
 let horizontal=sun.xz/max(length(sun.xz),1e-8);let ahead=dot(p.xz,horizontal);
 let perp2=max(0.0,dot(p.xz,p.xz)-ahead*ahead);
 // Differences of cumulative coverage give disjoint areas, including the
 // Huygens and Encke gaps. There is no discrete set of solar shadow rays.
 let edges=array<f32,8>(74658e3,92000e3,117540e3,117820e3,122170e3,133429e3,133749e3,136775e3);
 let tau=array<f32,7>(.10,1.8,0,.12,.55,0,.55);
 let elevation=max(abs(sun.y),max(b.ring.z*.5,1e-6));
 let signed_y=select(-elevation,elevation,sun.y>=0.0);
 let path=-p.y/signed_y;let xz=p.xz+sun.xz*path;let radius=max(length(xz),1.0);
 let radial=xz/radius;
 let width=(abs(path)*b.ring.z/elevation+.5*abs(dot(radial,span.xz-sun.xz*span.y/signed_y)))*.001;
 let km=radius*.001;
 let ringlets=.5*ring_noise(km/1400.0)/(1.0+width*width/(1400.0*1400.0))
            +.3*ring_noise(km/430.0)/(1.0+width*width/(430.0*430.0))
            +.2*ring_noise(km/130.0)/(1.0+width*width/(130.0*130.0));
 let optical=(1.0+.7*ringlets)/elevation;
 var last=ring_coverage(edges[0],p,sun,horizontal,ahead,perp2,b.ring.z,span);
 var blocked=0.0;
 for(var i=0u;i<7u;i++){
  let next=ring_coverage(edges[i+1u],p,sun,horizontal,ahead,perp2,b.ring.z,span);
  blocked+=max(0.0,next-last)*(1.0-exp(-tau[i]*optical));last=next;
 }
 return clamp(1.0-blocked,0.0,1.0);
}

// All distances below are in metres in the rotating body frame. Density is in
// inverse pressure scale heights. The map describes the colour and approximate
// height of the weather. Only detail smaller than its footprint is synthesized.
fn giant_density(b:Body,p:vec3<f32>,z:f32,weather:f32,detail:f32,footprint:f32)->f32{
 let ice=b.axes[2].w>=799.0;
 var top=(weather-0.46)*select(1.35,0.7,ice);
 var upper=0.0;
 if detail>0.001{
  let n=normalize(p);
  let east=vec3<f32>(n.z,0.0,-n.x);
  let jet=sin(n.y*34.0+2.0*sin(n.y*7.0));
  let flow=(jet*b.axes[0].w+0.4*b.axes[1].w)*east;
  let h=b.air.w;
  let broad=textureSampleLevel(volume_shape,volume_repeat,p/(h*37.0)+flow*0.23,0.0);
  let eddy=p/(h*5.7)+broad.rgb*0.65+flow*0.4;
  let billow=textureSampleLevel(volume_shape,volume_repeat,eddy,0.0);
  let edge=textureSampleLevel(volume_shape,volume_repeat,eddy*3.71+billow.gbr*.35,0.0).a;
  // A long integration segment averages over the finer cells along the ray.
  let billow_band=1.0-smoothstep(.32,1.1,footprint);
  let edge_band=1.0-smoothstep(.08,.32,footprint);
  let relief=(broad.r-.5)*1.20+(billow.a-.45)*1.05*billow_band+(edge-.45)*.26*edge_band;
  let strength=detail*select(1.0,0.48,ice);
  top+=strength*relief;
  // Detached cloud heads above the continuous lower deck. Their coverage
  // and vertical extent are sampled by the same sunward and viewing rays.
  let updraft=smoothstep(.38,.78,broad.g*.5+mix(.45,billow.a,billow_band)*.5);
  let layer=(z-top-.45-.55*updraft)/(.23+.29*updraft);
  upper=strength*updraft*1.9*exp(-layer*layer*1.4);
 }
 return upper+2.8*exp(clamp((top-z)*3.2,-14.0,5.5));
}

fn giant_atmosphere(b:Body,eye:vec3<f32>,ray_dir:vec3<f32>,pixel:f32)->BodyPixel{
 let a=b.center.w;let h=b.air.w;
 let axes=vec3<f32>(1.0,a/b.shape.x,1.0);
 let origin=eye*axes;let scaled_ray=ray_dir*axes;let speed=length(scaled_ray);let d=scaled_ray/speed;
 let mid=-dot(origin,d);let impact=length(cross(origin,d));
 let outer=a+5.0*h;
 if impact>=outer{return BodyPixel(vec4<f32>(0.0),0.0);}
 let half_chord=sqrt((outer-impact)*(outer+impact));
 let outside=(length(origin)-outer)*(length(origin)+outer);
 let start=max(0.0,outside/max(mid+half_chord,1.0)/speed);
 if outside>=0.0 && mid<=0.0{return BodyPixel(vec4<f32>(0.0),0.0);}
 var end=(mid+half_chord)/speed;
 if end<=start{return BodyPixel(vec4<f32>(0.0),0.0);}
 // Cut the back of the interval only after many optical depths. A camera
 // already below this level still integrates from its own position outwards.
 let deep=a-2.5*h;
 if impact<deep && length(origin)>deep && mid>0.0{
  end=min(end,(length(origin)-deep)*(length(origin)+deep)/((mid+sqrt((deep-impact)*(deep+impact)))*speed));
 }
 if length(origin)<=deep{end=min(end,2.0*h);}
 let local=1.0-smoothstep(h*.12,h*1.5,max(start,1.0)*pixel);
 let detail=local*smoothstep(2.0,8.0,v.forward.w);
 let luma=vec3<f32>(.2126,.7152,.0722);
 let sun=b.sun.xyz;let mu=dot(ray_dir,sun);
 let haze_phase=.64+.32*mu*mu+.22*pow(max(mu,0.0),8.0);
 let haze_beta=b.beta.xyz*h*.42;
 let quality=clamp(v.icrf[2].w/128.0,.1,1.0);
 let spacing=mix(.26,.115,quality);
 var transmission=vec3<f32>(1);var radiance=vec3<f32>(0);var depth=0.0;
 var last=start;
 for(var i=0u;i<320u;i++){
  if last>=end{break;}
  let front=origin+scaled_ray*last;let radius=max(length(front),1.0);
  let altitude=(radius-a)/h;
  let radial=abs(dot(front,scaled_ray))/radius;
  // March the same local distances on neighbouring rays. A ray which just
  // misses the deep spheroid must not redistribute all its foreground samples.
  let clear=smoothstep(1.45,4.0,altitude);
  let step_h=spacing*clamp(exp(min(altitude,0.0)*1.7),.01,1.0)
       +clear*(.38+1.25/(1.0+7.0*radial));
  let late=max(0.0,(f32(i)-170.0)/55.0);
  let ds=min(end-last,h*step_h*(1.0+late*late));
  let t=last+ds*.5;last+=ds;
  let p=eye+ray_dir*t;
  let z=(length(p*axes)-a)/h;
  let normal=normalize(p*axes*axes);
  let sun_up=dot(normal,sun);
  let local_albedo=map_sample(b,normalize(p*axes),pixel*max(t,h)/a);
  let footprint=max(pixel*t,ds*.5)/h;
  let weather=dot(local_albedo,luma);
  let deck=giant_density(b,p,z,weather,detail,footprint);
  let haze=haze_beta*exp(clamp(-z,-8.0,5.0));
  let extinction=haze+deck;
  let absorbed=transmission*(1.0-exp(-extinction*(ds/h)));
  let day=smoothstep(-0.09,0.04,sun_up);
  var direct=0.0;
  var ring=1.0;
  if day>0.0{
   ring=ring_sunlight(b,p,ray_dir*ds);
   // Slant column above the sample, with a curved-path limit at the limb.
   let slant=inverseSqrt(sun_up*sun_up+2.0*h/a);
   var cloud_tau=deck*.3125*slant;
   let shadow_weight=detail*smoothstep(.002,.035,deck)*(1.0-smoothstep(14.0,30.0,deck))*smoothstep(.0005,.008,ring);
   if shadow_weight>.001{
    // Integrate the crest blocking this beam with Simpson 3/8 quadrature.
    let reach=min(3.0*h,h*slant*.8);
    let p1=p+sun*(reach/3.0);let p2=p+sun*(reach*2.0/3.0);let p3=p+sun*reach;
    let d1=giant_density(b,p1,(length(p1*axes)-a)/h,weather,detail,footprint);
    let d2=giant_density(b,p2,(length(p2*axes)-a)/h,weather,detail,footprint);
    let d3=giant_density(b,p3,(length(p3*axes)-a)/h,weather,detail,footprint);
    cloud_tau=mix(cloud_tau,(deck+3.0*d1+3.0*d2+d3)*(reach/(8.0*h))+d3*.3125*slant,shadow_weight);
   }
   direct=ring*exp(-min(20.0,cloud_tau+dot(haze,vec3<f32>(.3333))*slant));
  }
  // Diffuse scattering fills the shadow from neighbouring sunlit columns.
  let fill=day*(.035+.36*sqrt(max(sun_up,0.0)))*(.38+.62*ring)*exp(min(z,0.0)*.72);
  let cloud_light=local_albedo*(fill+day*direct*(.78+.30*max(mu,0.0)));
  let haze_light=b.air.xyz*(.40*fill+day*direct*haze_phase);
  radiance+=absorbed*(cloud_light*deck+haze_light*haze)/max(extinction,vec3<f32>(1e-9));
  depth+=dot(absorbed,vec3<f32>(.333333))*t;
  transmission-=absorbed;
  if max(transmission.x,max(transmission.y,transmission.z))<.004{break;}
 }
 let opacity=clamp(1.0-dot(transmission,vec3<f32>(1.0/3.0)),0.0,1.0);
 return BodyPixel(vec4<f32>(radiance*v.starlight.xyz*b.sun.w,opacity),depth/max(opacity,1e-6));
}
// An asteroid close up: a lumpy radial surface, ray marched. Its orbit and size are real; this shape is not, as almost
// none has been measured. Low frequencies for the lobes, finer ones for the ground, and pits for craters. Seeded per body.
fn rock_hash(c:vec3<f32>,seed:f32)->f32{return fract(sin(dot(c,vec3<f32>(127.1,311.7,74.7))+seed*13.7)*43758.5453);}
fn rock_noise(x:vec3<f32>,seed:f32)->f32{
 let i=floor(x);let f=x-i;let u=f*f*(3.0-2.0*f);
 let c00=mix(rock_hash(i,seed),rock_hash(i+vec3<f32>(1,0,0),seed),u.x);let c10=mix(rock_hash(i+vec3<f32>(0,1,0),seed),rock_hash(i+vec3<f32>(1,1,0),seed),u.x);
 let c01=mix(rock_hash(i+vec3<f32>(0,0,1),seed),rock_hash(i+vec3<f32>(1,0,1),seed),u.x);let c11=mix(rock_hash(i+vec3<f32>(0,1,1),seed),rock_hash(i+vec3<f32>(1,1,1),seed),u.x);
 return mix(mix(c00,c10,u.y),mix(c01,c11,u.y),u.z)*2.0-1.0;
}
fn rock_radius(n:vec3<f32>,seed:f32)->f32{
 var r=1.0-0.28+rock_noise(n*1.1+seed,seed)*0.26+rock_noise(n*2.3+seed,seed)*0.09;
 r+=rock_noise(n*5.0,seed)*0.035+rock_noise(n*11.0,seed)*0.014+rock_noise(n*23.0,seed)*0.006+rock_noise(n*50.0,seed)*0.003;
 // Pits: a dark rim-free dish where a coarse cell's noise is high.
 r-=smoothstep(0.42,0.75,rock_noise(n*7.0+3.0,seed))*0.03+smoothstep(0.5,0.8,rock_noise(n*19.0+7.0,seed))*0.01;
 return r;
}
fn rock(b:Body,rd:vec3<f32>,pixel:f32)->BodyPixel{
 let radius=b.center.w;let seed=b.shape.y;let eye=-b.center.xyz;let distance=length(eye);
 let bound=max(b.shape.w,0.75*pixel);let scale=bound/max(b.shape.w,1e-12);
 // Too small to show a shape: a point of the same light, in the rock's own grey.
 if bound<3.0*pixel{
  let s=length(cross(rd,normalize(b.center.xyz)));let alpha=clamp((bound-s)/pixel+0.5,0.0,1.0);if alpha<=0.0||dot(rd,b.center.xyz)<0.0{discard;}
  let phase=0.5+0.5*dot(normalize(eye),b.sun.xyz);
  return BodyPixel(vec4<f32>(vec3<f32>(0.14,0.13,0.12)*1.8*phase*b.sun.w/(scale*scale)*alpha,alpha/(scale*scale)),0.0);
 }
 let o=fixed(b,eye)/radius;let d=fixed(b,rd);
 let mid=-dot(o,d);let d2=dot(o,o)-mid*mid;if d2>=1.0||(mid<0.0&&dot(o,o)>1.0){discard;}
 let half_chord=sqrt(1.0-d2);var t=max(mid-half_chord,0.0);let end=mid+half_chord;var hit=false;var p=o;
 for(var i=0;i<48;i++){
  p=o+d*t;let l=length(p);let gap=l-rock_radius(p/l,seed);
  if gap<0.0015*max(t,0.01){hit=true;break;}
  t+=max(gap*0.55,0.001);if t>end{break;}
 }
 if !hit{discard;}
 let n0=normalize(p);let e=max(0.002,pixel*t*0.7);let tx=normalize(cross(n0,vec3<f32>(0.31,0.87,0.38)));let ty=cross(n0,tx);
 let h0=rock_radius(n0,seed);let hx=rock_radius(normalize(n0+tx*e),seed);let hy=rock_radius(normalize(n0+ty*e),seed);
 let n=normalize(n0-(tx*(hx-h0)+ty*(hy-h0))/e);
 // A little self-shadow from a short march toward the Sun.
 var lit=max(0.0,dot(n,b.sun.xyz));
 if lit>0.0{var u=0.02;for(var i=0;i<10&&lit>0.0;i++){let q0=p+b.sun.xyz*u;let l=length(q0);if l<rock_radius(q0/l,seed){lit=0.0;}u+=0.02+u*0.3;}}
 let mottled=0.11+rock_noise(n0*9.0+11.0,seed)*0.025+rock_noise(n0*31.0+5.0,seed)*0.015;
 let color=vec3<f32>(1.0,0.96,0.9)*mottled*(vec3<f32>(1.8,1.55,1.3)*v.starlight.xyz*lit*b.sun.w+vec3<f32>(0.004));
 return BodyPixel(vec4<f32>(color,1.0),max(t*radius,1.0));
}
@group(1) @binding(0) var giant_color:texture_2d<f32>;
@group(1) @binding(1) var giant_distance:texture_2d<f32>;

@fragment fn giant_march(q:Quad)->BodyPixel{
 let b=bodies[q.body];let size=vec2<f32>(v.icrf[0].w,v.icrf[1].w);
 let rd=ray(q.clip.xy*v.screen.xy/size);
 return giant_atmosphere(b,fixed(b,-b.center.xyz),fixed(b,rd),2.0*v.screen.w/v.screen.y);
}
@fragment fn body_fragment(q:Quad)->BodyPixel{
 return draw_body(q,BodyPixel(vec4<f32>(0),0.0),false);
}
@fragment fn giant_composite(q:Quad)->BodyPixel{
 let size=vec2<f32>(textureDimensions(giant_color));
 let uv=clamp(q.clip.xy/v.screen.xy,0.5/size,1.0-0.5/size);
 let gas=textureSampleLevel(giant_color,map_sampler,uv,0.0);
 let depth=textureLoad(giant_distance,vec2<i32>(uv*size),0).x;
 return draw_body(q,BodyPixel(gas,depth),true);
}
fn draw_body(q:Quad,cached:BodyPixel,has_cache:bool)->BodyPixel{
 let b=bodies[q.body];let rd=ray(q.clip.xy);let pixel=2.0*v.screen.w/v.screen.y;
 if b.shape.z==FLAG_STAR{let s=star(b,rd);return BodyPixel(s.color,select(0.0,max(s.distance,1.0),s.color.a>.5));}
 if b.shape.z==FLAG_ROCK{return rock(b,rd,pixel);}
 let eye=-b.center.xyz;let distance=length(eye);
 // Below a pixel the disk is a point of the same total light, not one that vanishes.
 let true_radius=b.center.w;let bound=max(b.shape.w,0.75*pixel);let scale=bound/max(b.shape.w,1e-12);let fade=1.0/(scale*scale);
 let a=true_radius*scale;let c=b.shape.x*scale;
 let o=fixed(b,eye)/vec3<f32>(a,c,a);let d=fixed(b,rd)/vec3<f32>(a,c,a);
 let dd=dot(d,d);let bb=dot(o,d);let cc=dot(o,o)-1.0;let det=bb*bb-dd*cc;
 var color=vec3<f32>(0);var alpha=0.0;var hit=-1.0;
 let surface_pass=b.shape.z==FLAG_ACTIVE;
 let volume=b.shape.z==FLAG_GIANT && b.shape.w>pixel*.75;
 var volume_depth=0.0;
 if volume{
  var gas=cached;
  if !has_cache{gas=giant_atmosphere(b,fixed(b,eye),fixed(b,rd),pixel);}
  color=gas.color.rgb;alpha=gas.color.a;volume_depth=gas.distance;
  if alpha>0.0{hit=volume_depth;}
 }else if det>0.0&&bb<0.0&&cc>0.0{
  hit=cc/(-bb+sqrt(det));
  let p=normalize(o+d*hit);let n=normalize(p/vec3<f32>(a,c,a));
  let albedo=map_sample(b,p,pixel*distance/max(a,1.0));
  var light=max(0.0,dot(n,b.sun.xyz));
  // The rings' shadow on the planet, soft across the width of the Sun as seen from there.
  if b.ring.y>0.0 && light>0.0{light*=ring_sunlight(b,p*vec3<f32>(true_radius,b.shape.x,true_radius),vec3<f32>(0));}
  color=albedo*vec3<f32>(1.8,1.55,1.3)*v.starlight.xyz*light*b.sun.w;
  if b.ring.w>0.5&&!surface_pass{color=far_cloud(b,p,n,rd,pixel*distance/max(a,1.0),color);}
  color*=fade;
  // Antialias the limb against the true angular radius, in pixels.
  let to=normalize(b.center.xyz);let s=length(cross(rd,to));
  alpha=clamp((bound-s)/pixel+0.5,0.0,1.0);
  // A body smaller than a pixel adds its light to what lies behind it, and covers only its share of the pixel.
  if scale>1.0{color*=alpha;alpha*=fade;color/=max(alpha,1e-6);}
 }
 var inside=false;
 if !volume&&det>0.0&&cc<=0.0{inside=true;alpha=1.0;hit=0.0;}
 var limit=1e30;if hit>0.0{limit=hit;}
 // A body with its own surface pass draws nothing but its disk here, under the mesh.
 if !volume && b.air.w>0.0&&!surface_pass{
  let lit=air_along(b,eye,rd,limit,color*alpha);
  let reach=b.center.w+b.beta.w;let s=length(cross(rd,normalize(b.center.xyz)));
  let seen=dot(rd,normalize(b.center.xyz))>0.0||distance<reach;
  if seen{color=lit;}else{color=color*alpha;}
  if alpha<=0.0&&seen{alpha=clamp(1.0-exp(-(lit.x+lit.y+lit.z)*8.0),0.0,1.0)*0.0;}
  if inside{alpha=1.0;}
 }else if !volume{color*=alpha;}
 // Rings: in the body's own plane, in front of it or behind it. Lit by the Sun, dark in the planet's shadow.
 if b.ring.y>0.0{
  let m=fixed(b,eye);let e=fixed(b,rd);
  if abs(e.y)>1e-6{
   let t=-m.y/e.y;
   if t>0.0&&(hit<0.0||t<hit||(volume&&alpha<0.999)){
    let at=m+e*t;let r=length(at);let band=saturn_ring(r);
    if band.x>0.0{
     // Slant through a thin sheet: the tilt to the eye sets how much of it the eye looks through.
     // Close to, the sheet gives way to the rocks it is made of, which the rock pass draws: it thins between about 70 and 20 km.
     let resolved=smoothstep(20.0e3,70.0e3,t);
     let opacity=(1.0-exp(-band.x/max(abs(e.y)/length(e),0.02)))*resolved;
     // Lit side or unlit side: seen from the side away from the Sun, only what the sheet lets through.
     let through=select(0.55*exp(-band.x),1.0,sign(m.y)==sign(b.sun.y));
     // Planet's shadow on the ring.
     let shadowed=oblate_shadow(at,b.sun.xyz,true_radius,b.shape.x);
     let tone=vec3<f32>(0.92,0.84,0.72)*band.y*vec3<f32>(1.8,1.55,1.3)*v.starlight.xyz*0.6*select(1.0,0.02,shadowed)*b.sun.w*through;
     if volume && hit>0.0 && t>=hit{color+=tone*opacity*(1.0-alpha);}
     else{color=tone*opacity+color*(1.0-opacity);if opacity>.5{volume_depth=t;}}
     alpha=opacity+alpha*(1.0-opacity);
    }
   }
  }
 }
 if alpha<=0.0&&dot(color,color)<=0.0{discard;}
 // A body with its own surface pass stands behind that surface, so it claims no distance. Otherwise this is a lower bound of the nearest point on the disk, enough to order two separate bodies.
 return BodyPixel(vec4<f32>(color,alpha),select(0.0,max(select(distance-true_radius,volume_depth,volume),1.0),alpha>0.5&&!surface_pass));
}
struct Point {@builtin(position) clip:vec4<f32>,@location(0) color:vec3<f32>,@location(1) at:vec2<f32>}
// The sky behind everything, in inertial axes: it turns only as the eye's axes do.
struct SkyQuad {@builtin(position) clip:vec4<f32>}
@vertex fn sky_vertex(@builtin(vertex_index) id:u32)->SkyQuad{let c=vec2<f32>(f32((id<<1u)&2u),f32(id&2u))*2.0-1.0;return SkyQuad(vec4<f32>(c,0,1));}
@fragment fn sky_fragment(q:SkyQuad)->BodyPixel{
 let rd=ray(q.clip.xy);
 // Render axes to ICRF: the transpose of the rows.
 let d=v.icrf[0].xyz*rd.x+v.icrf[1].xyz*rd.y+v.icrf[2].xyz*rd.z;
 // The level for this view: map texels per pixel, near the middle of a face. Level 1 keeps it from sparkling when it is minified.
 let level=clamp(log2(max(2.0*v.screen.w/v.screen.y*2048.0/2.0,1.0)),0.0,1.0);
 // The diffuse survey and catalogue point flux use different units. Preserve
 // the dust lanes in the survey when a photographic exposure opens for space.
 let survey=textureSampleLevel(sky_map,map_sampler,d,max(level,v.starlight.w)).rgb*v.tone.z;
 return BodyPixel(vec4<f32>(survey*select(1.0,80.0*v.tone.x,v.tone.x>=0.0),0),0.0);
}
// The brightest stars are points of light on the pixel grid, over the same stars in the map: a small splat of fixed width in
// pixels, placed to a fraction of a pixel. Brightness: a magnitude's flux compressed by a power, as a long photographic exposure
// compresses it. An appearance choice, and the positions are the catalogue's.
fn star_splat(id:u32,direction:vec3<f32>,magnitude:f32,tint:vec3<f32>)->Point{
 let d=vec3<f32>(dot(v.icrf[0].xyz,direction),dot(v.icrf[1].xyz,direction),dot(v.icrf[2].xyz,direction));
 var corners=array<vec2<f32>,6>(vec2<f32>(-1,-1),vec2<f32>(1,-1),vec2<f32>(-1,1),vec2<f32>(-1,1),vec2<f32>(1,-1),vec2<f32>(1,1));
 let z=dot(d,v.forward.xyz);
 if z<=0.01{return Point(vec4<f32>(0,0,2,1),vec3<f32>(0),vec2<f32>(0));}
 let flux=pow(10.0,-0.248*(magnitude-1.0))*0.62;
 let sigma=0.55+0.5*max(0.0,2.5-magnitude)*0.28;let reach=sigma*3.2;
 let c=vec2<f32>(dot(d,v.right.xyz)/(v.screen.z*v.screen.w),dot(d,v.up.xyz)/v.screen.w)/z+corners[id]*reach/v.screen.xy*2.0;
 // In units of sigma, for the fragment.
 let catalog_flux=pow(10.0,-0.4*(magnitude-1.0))*0.62*v.tone.x/(sigma*sigma);
 return Point(vec4<f32>(c+projection_offset(),0,1),tint*select(min(flux,4.0),catalog_flux,v.tone.x>=0.0),corners[id]*3.2);
}
@vertex fn star_vertex(@builtin(vertex_index) id:u32,@builtin(instance_index) index:u32)->Point{
 let s=stars[index*2u];let motion=stars[index*2u+1u];let bits=u32(motion.w);
 let tint=vec3<f32>(f32((bits>>16u)&255u),f32((bits>>8u)&255u),f32(bits&255u))/255.0;
 return star_splat(id,normalize(s.xyz+motion.xyz*v.tone.y),s.w,tint);
}
@fragment fn star_fragment(p:Point)->BodyPixel{return BodyPixel(vec4<f32>(p.color*exp(-0.5*dot(p.at,p.at)),0),0.0);}
// Real asteroids as points, at their true places for the date from two-body orbits. V = H + 5 log10(r d) + phase, the standard
// reduction, in the same flux as the stars, then raised by the gain: at true brightness (gain 0) the belt cannot be seen from
// anywhere outside it, as a real eye could not. Two-body motion from a single epoch: fine for where the belt is, wrong by growing
// amounts for a given rock away from its epoch.
struct AsteroidPoint {@builtin(position) clip:vec4<f32>,@location(0) color:vec3<f32>}
const AU:f32=1.495978707e11;
fn asteroid_position(i:u32)->vec3<f32>{
 let e0=asteroids[i*3u];let p=asteroids[i*3u+1u].xyz;let q=asteroids[i*3u+2u].xyz;
 let a=e0.x*AU;let e=e0.y;let m=e0.z+e0.w*v.tone.y;var ea=m+e*sin(m);
 for(var k=0;k<4;k++){ea-=(ea-e*sin(ea)-m)/(1.0-e*cos(ea));}
 return p*(a*(cos(ea)-e))+q*(a*sqrt(max(0.0,1.0-e*e))*sin(ea));
}
@vertex fn asteroid_vertex(@builtin(vertex_index) id:u32)->AsteroidPoint{
 let at=asteroid_position(id);let w=at-v.eye_sun.xyz;
 let d=vec3<f32>(dot(v.icrf[0].xyz,w),dot(v.icrf[1].xyz,w),dot(v.icrf[2].xyz,w));
 let z=dot(d,v.forward.xyz);
 if z<=1000.0{return AsteroidPoint(vec4<f32>(0,0,2,1),vec3<f32>(0));}
 let r=length(at)/AU;let delta=length(w)/AU;
 let phase=acos(clamp(dot(at,w)/max(length(at)*length(w),1.0),-1.0,1.0))*57.29578;
 let magnitude=asteroids[id*3u+1u].w+5.0*log(r*delta)/log(10.0)+0.03*phase;
 let flux=pow(10.0,-0.4*(magnitude-1.0))*0.09*pow(10.0,0.4*v.tone.w);
 let c=vec2<f32>(dot(d,v.right.xyz)/(v.screen.z*v.screen.w),dot(d,v.up.xyz)/v.screen.w)/z;
 return AsteroidPoint(vec4<f32>(c+projection_offset(),0,1),vec3<f32>(1.0,0.92,0.82)*select(min(flux,1.5),flux*v.tone.x,v.tone.x>=0.0));
}
@fragment fn asteroid_fragment(p:AsteroidPoint)->BodyPixel{return BodyPixel(vec4<f32>(p.color,0),0.0);}
// What the points cannot show: the far more numerous bodies and the dust they make, as a glow integrated along the ray through
// each belt, at a brightness set with the same gain. A band of the real extent and thickness, not a measured brightness.
// Sampled from the data: the main belt peaks near 2.7 au, inclinations give it a thickness of about a fifth of its radius.
fn belt_density(r:f32,z:f32)->f32{
 let main=exp(-pow((r-2.75)/0.42,2.0))*exp(-pow(z/(0.17*r),2.0));
 let kuiper=0.012*exp(-pow((r-43.0)/5.0,2.0))*exp(-pow(z/(0.16*r),2.0));
 return main+kuiper;
}
@vertex fn belt_vertex(@builtin(vertex_index) id:u32)->SkyQuad{let c=vec2<f32>(f32((id<<1u)&2u),f32(id&2u))*2.0-1.0;return SkyQuad(vec4<f32>(c,0,1));}
@fragment fn belt_fragment(q:SkyQuad)->BodyPixel{
 let rd=ray(q.clip.xy);let d=v.icrf[0].xyz*rd.x+v.icrf[1].xyz*rd.y+v.icrf[2].xyz*rd.z;let o=v.eye_sun.xyz/AU;
 // The plane the belts lie in: the ecliptic's pole, in ICRF.
 let pole=vec3<f32>(0.0,-0.39777716,0.91748206);
 var light=0.0;
 // Through the main belt's sphere, then the Kuiper belt's, each with its own number of steps across it.
 for(var shell=0;shell<2;shell++){
  let reach=select(4.6,60.0,shell==1);let b=-dot(o,d);let c=dot(o,o)-reach*reach;let det=b*b-c;if det<=0.0{continue;}
  let root=sqrt(det);let start=max(b-root,0.0);let end=b+root;if end<=start{continue;}
  let ds=(end-start)/16.0;
  for(var i=0;i<16;i++){let p=o+d*(start+(f32(i)+0.5)*ds);let r=length(p);let z=dot(p,pole);light+=belt_density(r,z)*ds/(r*r+0.5);}
 }
 return BodyPixel(vec4<f32>(vec3<f32>(1.0,0.9,0.76)*light*.000012*pow(10.0,.4*v.tone.w)*select(1.0,v.tone.x,v.tone.x>=0.0),0),0.0);
}
// Orbit trails, a thin antialiased line in screen pixels over one orbit. The line is real geometry, so its true distance is compared
// with every body along the ray at each fragment, and a body in front hides it. A line in front of the body in the surface pass is
// hidden too: the composite takes this layer only where there is no surface.
// In screen space with w = 1: the width is a matter of the screen, and interpolated with perspective across a ratio of depths up to
// 1e8 it broke up in 32 bits, leaving a near line thin and dotted. The distance along it is what needs perspective, so it goes as far / z
// and 1 / z, and is divided back.
struct TrailPoint {@builtin(position) clip:vec4<f32>,@location(0) color:vec4<f32>,@location(1) across:f32,@location(2) far_over_z:f32,@location(3) over_z:f32}
const TRAIL_PIXELS:f32=1.1;
@vertex fn trail_vertex(@builtin(vertex_index) id:u32,@builtin(instance_index) index:u32)->TrailPoint{
 let hide=TrailPoint(vec4<f32>(0,0,2,1),vec4<f32>(0),0.0,0.0,0.0);
 var a=trail_points[index];var b=trail_points[index+1u];
 if a.w<0.0||b.w<0.0{return hide;}
 // Clipped in homogeneous coordinates, where every plane is linear along the line. A cut at a near plane alone, with the point then
 // projected, went by a rounding of tens of km on points 1e11 m off against a plane 1 m away, and left line ends flickering in mid
 // screen. The planes at +-GUARD keep the ends' coordinates small enough for the line's width to survive, with both ends off screen.
 const NEAR=1.0;const GUARD=4.0;
 let scale=vec3<f32>(1.0/(v.screen.z*v.screen.w),1.0/v.screen.w,1.0);
 let ha=vec3<f32>(dot(a.xyz,v.right.xyz),dot(a.xyz,v.up.xyz),dot(a.xyz,v.forward.xyz))*scale;
 let hb=vec3<f32>(dot(b.xyz,v.right.xyz),dot(b.xyz,v.up.xyz),dot(b.xyz,v.forward.xyz))*scale;
 var fa=array<f32,5>(ha.z-NEAR,GUARD*ha.z-ha.x,GUARD*ha.z+ha.x,GUARD*ha.z-ha.y,GUARD*ha.z+ha.y);
 var fb=array<f32,5>(hb.z-NEAR,GUARD*hb.z-hb.x,GUARD*hb.z+hb.x,GUARD*hb.z-hb.y,GUARD*hb.z+hb.y);
 var s0=0.0;var s1=1.0;
 for(var i=0;i<5;i++){
  if fa[i]<0.0&&fb[i]<0.0{return hide;}
  if fa[i]<0.0{s0=max(s0,fa[i]/(fa[i]-fb[i]));}
  if fb[i]<0.0{s1=min(s1,fa[i]/(fa[i]-fb[i]));}
 }
 if s0>=s1{return hide;}
 let ca=mix(ha,hb,s0);let cb=mix(ha,hb,s1);let pa=mix(a,b,s0);let pb=mix(a,b,s1);
 let project=ca.xy/ca.z;let target_point=cb.xy/cb.z;
 let side=normalize((target_point-project)*v.screen.xy+vec2<f32>(1e-6,0));let normal=vec2<f32>(-side.y,side.x);
 var ends=array<f32,6>(0,1,0,0,1,1);var sides=array<f32,6>(-1,-1,1,1,-1,1);
 let end=ends[id];let p=mix(pa,pb,end);let w=mix(ca.z,cb.z,end);
 let reach=(TRAIL_PIXELS+1.0)*sides[id];
 let c=mix(project,target_point,end)+normal*reach/v.screen.xy*2.0;
 let kind=floor(max(p.w,0.0));let strength=fract(max(p.w,0.0));
 var tint=vec3<f32>(0.62,0.80,1.0);if kind>0.5&&kind<1.5{tint=vec3<f32>(0.62,0.86,0.72);}if kind>1.5{tint=vec3<f32>(1.0,0.76,0.36);}
 return TrailPoint(vec4<f32>(c+projection_offset(),0,1),vec4<f32>(tint,strength),reach,length(p.xyz)/w,1.0/w);
}
// Fade an orbit guide through the air between its point and the eye. Both
// endpoints matter: a guide on this side of the cloud deck is still visible.
fn giant_guide_transmission(body:Body,rd:vec3<f32>,far:f32)->f32{
 let a=body.center.w;let h=body.air.w;let axes=vec3<f32>(1,a/body.shape.x,1);
 let o=fixed(body,-body.center.xyz)*axes;let ray=fixed(body,rd)*axes;
 let speed=length(ray);let d=ray/speed;let mid=-dot(o,d);let reach=far*speed;
 let nearest=length(o+d*clamp(mid,0.0,reach));let outer=a+5.0*h;
 if nearest>=outer{return 1.0;}if nearest<a-h{return 0.0;}
 let impact=length(cross(o,d));let chord=sqrt(max(0.0,(outer-impact)*(outer+impact)));
 let start=max(0.0,mid-chord);let end=min(reach,mid+chord);let ds=(end-start)/16.0;
 if ds<=0.0{return 1.0;}
 let haze=dot(body.beta.xyz,vec3<f32>(.14))*h;
 var tau=0.0;
 for(var j=0u;j<16u;j++){
  let z=(length(o+d*(start+(f32(j)+.5)*ds))-a)/h;
  tau+=(haze*exp(-z)+2.8*exp(-3.2*z))*ds/(h*speed);
 }
 return exp(-tau);
}
@fragment fn trail_fragment(t:TrailPoint)->BodyPixel{
 let rd=ray(t.clip.xy);let far=t.far_over_z/t.over_z;var transmission=1.0;
 for(var i=0u;i<u32(v.eye_sun.w);i++){
  let body=bodies[i];let c=body.center;
  if body.shape.z==FLAG_GIANT && body.shape.w>.003{
   transmission*=giant_guide_transmission(body,rd,far);if transmission<.001{discard;}continue;
  }
  let along=dot(c.xyz,rd);if along<=0.0||body.shape.z==FLAG_ROCK{continue;}
  let off=length(cross(c.xyz,rd));if off>=c.w{continue;}
  // Nearest point of the sphere along this ray, and the line's own distance there.
  if along-sqrt(c.w*c.w-off*off)<far{discard;}
 }
 let edge=1.0-smoothstep(TRAIL_PIXELS-0.5,TRAIL_PIXELS+0.5,abs(t.across));
 // Navigation overlays carry no stellar luminosity. In the inner system
 // compensate for the daylight multiplier before the common HDR finish.
 let overlay=select(1.0,min(1.0,v.tone.x/.00003),v.tone.x>=0.0);
 return BodyPixel(vec4<f32>(t.color.xyz*t.color.w*edge*.55*overlay*transmission,0),0.0);
}
// Rocks of Saturn's rings, around the eye, in nested shells of a lattice in the ring's frame: each cell holds at most one, by the
// published optical depth at that radius. All are synthesized. Each shell's rocks are in proportion to its cells, so a far rock is a
// large one, to about 80 m, when real ring particles are mostly under 10 m. They do not orbit: the real ones move at about 20 km/s.
struct RockPoint {
 @builtin(position) clip:vec4<f32>,
 @location(0) center:vec3<f32>,@location(1) @interpolate(flat) rock:vec4<f32>, // radius, seed, tone, fade
 @location(2) at:vec2<f32>,
 @location(3) @interpolate(flat) sun:vec3<f32>, // toward the Sun, render axes
 @location(4) @interpolate(flat) albedo:vec3<f32>,
 @location(5) @interpolate(flat) depth_range:vec2<f32>, // metres the depth buffer spans here; 1 if Saturn's shadow applies
}
const RING_REACH:i32=48;
fn rock_cell_hash(c:vec2<i32>,shell:u32)->u32{return hash32(bitcast<u32>(c.x)^hash32(bitcast<u32>(c.y)^(shell*0x9e3779b1u+77u)));}
fn hash32(v:u32)->u32{var x=v;x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;return x^(x>>16u);}
@vertex fn ring_rock_vertex(@builtin(vertex_index) id:u32,@builtin(instance_index) index:u32)->RockPoint{
 let hide=RockPoint(vec4<f32>(0,0,2,1),vec3<f32>(0),vec4<f32>(0),vec2<f32>(0),vec3<f32>(0),vec3<f32>(0),vec2<f32>(1,0));
 let side=u32(2*RING_REACH+1);let shell=index/(side*side);let local=index%(side*side);
 let cx=i32(local%side)-RING_REACH;let cy=i32(local/side)-RING_REACH;
 let cell=ring_field.fraction[shell].z;
 let global=vec2<i32>(ring_field.origin[shell].x+cx,ring_field.origin[shell].y+cy);
 let radial=length(vec2<f32>(global))*cell;let band=saturn_ring(radial);
 let h=rock_cell_hash(global,shell);
 // The denser the ring, the more of its cells hold a rock.
 // The two far shells carry the field out to hundreds of km on the way in: sparser, and smaller for their cells, or they would read as boulders.
 let far=shell>=5u;
 let chance=clamp(band.x*0.9,0.0,0.92)*select(1.0,0.45,far);if f32(h&1023u)/1023.0>=chance{return hide;}
 let r=hash32(h);let ox=f32(r&1023u)/1023.0;let oy=f32((r>>10u)&1023u)/1023.0;let oz=f32((r>>20u)&1023u)/1023.0-0.5;
 // A power law of sizes within a shell, so that a few stand out.
 let pick=f32(hash32(r)&1023u)/1023.0;let radius=cell*(0.035+0.17*pick*pick*pick)*select(1.0,0.5,far);
 let x=(f32(cx)+ox-ring_field.fraction[shell].x)*cell;let y=(f32(cy)+oy-ring_field.fraction[shell].y)*cell;
 // The sheet is thin: tens of metres. Coarser shells stay in it.
 let z=oz*min(cell*0.8,40.0)-ring_field.eye.z;
 let flat_distance=length(vec2<f32>(x,y));
 // Each shell hands over to the next: its fine rocks go out toward its edge, where the coarser ones already stand.
 let reach=cell*f32(RING_REACH);
 // The field comes on with height over the plane, not all at once at the edge of RING_NEAR.
 let fade=(1.0-smoothstep(reach*0.62,reach*0.98,flat_distance))*(1.0-smoothstep(5.0e5,7.8e5,abs(ring_field.eye.z)));if fade<=0.0{return hide;}
 let p=ring_field.axes[0].xyz*x+ring_field.axes[1].xyz*y+ring_field.axes[2].xyz*z;
 let w=dot(p,v.forward.xyz);if w<=radius*0.2{return hide;}
 // Saturn itself, at the origin of this frame, hides what lies behind it.
 let world=vec3<f32>(x,y,z);let d=normalize(world);let toward=-dot(ring_field.eye.xyz,d);
 if toward>0.0&&toward<length(world)&&length(ring_field.eye.xyz+d*toward)<ring_field.eye.w{return hide;}
 var corners=array<vec2<f32>,6>(vec2<f32>(-1,-1),vec2<f32>(1,-1),vec2<f32>(-1,1),vec2<f32>(-1,1),vec2<f32>(1,-1),vec2<f32>(1,1));
 let c=corners[id]*1.25;let q=p+v.right.xyz*c.x*radius+v.up.xyz*c.y*radius;let z2=max(dot(q,v.forward.xyz),0.05);
 let ndc=vec2<f32>(dot(q,v.right.xyz)/(v.screen.z*v.screen.w),dot(q,v.up.xyz)/v.screen.w);
 let sun=ring_field.axes[0].xyz*ring_field.sun.x+ring_field.axes[1].xyz*ring_field.sun.y+ring_field.axes[2].xyz*ring_field.sun.z;
 // Water ice, in the ring's own tone.
 let albedo=vec3<f32>(0.97,0.95,0.91)*(0.5+band.y*0.8);
 return RockPoint(vec4<f32>(ndc+z2*projection_offset(),z2*min(z2/1.0e6,1.0),z2),p,vec4<f32>(radius,f32(hash32(r+1u)&1023u)/7.0,band.y,fade),c,sun,albedo,vec2<f32>(1.0e6,1.0));
}
// Rocks of an asteroid belt, around the eye, in three dimensions: synthesized, so that a belt can be seen from inside it. Real ones lie
// millions of km apart, which is why this exists: the catalogue's own are drawn as well, at their true places. Density follows the
// belt's extent, and the slider. Sizes are in proportion to a shell's cells, to about 110 km at most.
const BELT_ROCK_REACH:i32=12;
const BELT_RANGE:f32=1.6e7;
fn belt_hash(c:vec3<i32>,shell:u32)->u32{return hash32(bitcast<u32>(c.x)^hash32(bitcast<u32>(c.y)^hash32(bitcast<u32>(c.z)^(shell*0x9e3779b1u+131u))));}
@vertex fn belt_rock_vertex(@builtin(vertex_index) id:u32,@builtin(instance_index) index:u32)->RockPoint{
 let hide=RockPoint(vec4<f32>(0,0,2,1),vec3<f32>(0),vec4<f32>(0),vec2<f32>(0),vec3<f32>(0),vec3<f32>(0),vec2<f32>(1,0));
 let side=u32(2*BELT_ROCK_REACH+1);let count=side*side*side;let shell=index/count;let local=index%count;
 let cell_at=vec3<i32>(i32(local%side),i32((local/side)%side),i32(local/(side*side)))-vec3<i32>(BELT_ROCK_REACH);
 let f=belt_field.fraction[shell];let cell=f.w;
 let h=belt_hash(belt_field.origin[shell].xyz+cell_at,shell);let r=hash32(h);
 let offset=vec3<f32>(f32(r&1023u),f32((r>>10u)&1023u),f32((r>>20u)&1023u))/1023.0;
 let w=(vec3<f32>(cell_at)+offset-f.xyz)*cell;
 let reach=cell*f32(BELT_ROCK_REACH);let spread=length(w);
 let fade=1.0-smoothstep(reach*0.6,reach*0.97,spread);if fade<=0.0{return hide;}
 let at=v.eye_sun.xyz+w;let radial=length(at)/AU;let height=dot(at,vec3<f32>(0.0,-0.39777716,0.91748206))/AU;
 // The slider raises the light of a belt; here it sets how many of its cells have a rock.
 let chance=min(belt_density(radial,height)*(1.0+60.0*f32(radial>20.0)),1.0)*0.3*clamp(v.tone.w/8.0,0.0,1.5);
 if f32(h&1023u)/1023.0>=chance{return hide;}
 let pick=f32(hash32(r)&1023u)/1023.0;let radius=cell*(0.012+0.08*pick*pick*pick);
 let p=vec3<f32>(dot(v.icrf[0].xyz,w),dot(v.icrf[1].xyz,w),dot(v.icrf[2].xyz,w));
 let z=dot(p,v.forward.xyz);if z<=radius*0.2{return hide;}
 var corners=array<vec2<f32>,6>(vec2<f32>(-1,-1),vec2<f32>(1,-1),vec2<f32>(-1,1),vec2<f32>(-1,1),vec2<f32>(1,-1),vec2<f32>(1,1));
 let c=corners[id]*1.25;let q=p+v.right.xyz*c.x*radius+v.up.xyz*c.y*radius;let z2=max(dot(q,v.forward.xyz),0.05);
 let ndc=vec2<f32>(dot(q,v.right.xyz)/(v.screen.z*v.screen.w),dot(q,v.up.xyz)/v.screen.w);
 let to_sun=-at/length(at);let sun=vec3<f32>(dot(v.icrf[0].xyz,to_sun),dot(v.icrf[1].xyz,to_sun),dot(v.icrf[2].xyz,to_sun));
 // Dark carbonaceous rock mostly, some paler stony ones: the main belt's two common kinds, as a choice by eye.
 let pale=f32((hash32(r+7u)>>4u)&1023u)/1023.0;let albedo=mix(vec3<f32>(0.20,0.18,0.16),vec3<f32>(0.42,0.37,0.31),pale*pale);
 return RockPoint(vec4<f32>(ndc+z2*projection_offset(),z2*min(z2/BELT_RANGE,1.0),z2),p,vec4<f32>(radius,f32(hash32(r+1u)&1023u)/7.0,1.0,fade),c,sun,albedo,vec2<f32>(BELT_RANGE,0.0));
}
struct RockPixel {@location(0) color:vec4<f32>,@location(1) distance:f32,@builtin(frag_depth) depth:f32}
@fragment fn ring_rock_fragment(k:RockPoint)->RockPixel{
 let rd=ray(k.clip.xy);let radius=k.rock.x;let seed=k.rock.y;let pixel=2.0*v.screen.w/v.screen.y;
 let o=-k.center/radius;let mid=-dot(o,rd);let d2=dot(o,o)-mid*mid;if d2>=1.0||mid<0.0{discard;}
 // How many pixels it spans decides the work: a march for what shows a shape, a lumpy disk for the rest.
 let across=radius/(length(k.center)*pixel);
 var t=max(mid-sqrt(1.0-d2),0.0);var p=o+rd*t;var n=normalize(p);
 if across>6.0{
  let end=mid+sqrt(1.0-d2);var hit=false;
  for(var i=0;i<28;i++){p=o+rd*t;let l=length(p);let gap=l-rock_radius(p/l,seed);if gap<0.003*max(t,0.1){hit=true;break;}t+=max(gap*0.6,0.003);if t>end{break;}}
  if !hit{discard;}
  let n0=normalize(p);let e=max(0.01,pixel*t*0.8);let tx=normalize(cross(n0,vec3<f32>(0.31,0.87,0.38)));let ty=cross(n0,tx);
  let h0=rock_radius(n0,seed);n=normalize(n0-(tx*(rock_radius(normalize(n0+tx*e),seed)-h0)+ty*(rock_radius(normalize(n0+ty*e),seed)-h0))/e);
 }else{
  // Too small for its shape to read: a broken outline, so the field is not of perfect balls.
  let a=atan2(k.at.y,k.at.x);if length(k.at)>0.82+0.1*sin(a*3.0+seed)+0.06*sin(a*7.0+seed*2.0){discard;}
 }
 var lit=max(0.0,dot(n,k.sun));
 // In Saturn's shadow, by this rock's place in the ring's frame.
 let local=vec3<f32>(dot(ring_field.axes[0].xyz,k.center),dot(ring_field.axes[1].xyz,k.center),dot(ring_field.axes[2].xyz,k.center))+ring_field.eye.xyz;
 // The ring frame has its pole along z; oblate_shadow takes it along y.
 if k.depth_range.y>0.5&&oblate_shadow(local.xzy,ring_field.sun.xzy,ring_field.eye.w,ring_field.sun.w){lit=0.0;}
 // Fine mottling that only a near rock would show.
 let mottled=0.72+0.12*rock_noise(n*6.0,seed)+0.05*rock_noise(n*21.0,seed);
 let albedo=k.albedo*mottled;
 let color=albedo*(vec3<f32>(1.6,1.57,1.5)*v.starlight.xyz*lit+vec3<f32>(0.03,0.03,0.032));
 // A rock at its shell's edge sinks into the dark rather than popping: an opaque pass, so it does so by light.
 let distance=length(k.center);let w=dot(k.center,v.forward.xyz)+radius*(t-mid);
 return RockPixel(vec4<f32>(color*k.rock.w,1.0),distance,clamp(w/k.depth_range.x,0.0,1.0));
}
