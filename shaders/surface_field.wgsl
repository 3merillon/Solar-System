// The canonical surface field: the only code that knows what height is. Mesh
// generation, shading, shadows, water depth, scenery support and the level error
// accounting read these functions, so a different source replaces one definition,
// not ten. Only this file may call band(); Rust guards that in shader_guard.rs.
//
// The variants below are one spectrum with different accumulation: each keeps the
// exact arithmetic of its call site, because settled images must not move.
// They differ in the skip threshold (w==0 for mesh, w<=0.001 where the noise cost
// matters), in keeping the ridge mean, and in what they accumulate.
struct FieldDetail {height:f32,gradient:vec3<f32>,grain:f32}
// Terraforming edits apply to every evaluation of the canonical field.
fn field_edits(hi:vec3<f32>,lo:vec3<f32>)->f32{
 var height=0.0;
 for(var i=0u;i<u32(f.geo.w);i++){let a=f.edits[2u*i];let b=f.edits[2u*i+1u];let d=(hi-a.xyz)+(lo-b.xyz);let t=max(0.0,1.0-dot(d,d)/(a.w*a.w));height+=b.w*t*t;}
 return height;
}
// Mesh vertices at one level's spacing: gradient in xyz, height in w.
fn field_mesh(hi:vec3<f32>,lo:vec3<f32>,spacing:f32)->vec4<f32>{
 var h=0.0;var grad=vec3<f32>(0);
 for(var k=0u;k<24u;k++){let b=band(k);let w=filter_weight(b.x,spacing);h+=select(0.0,0.25,b.z>0.0)*b.y*(1.0-w);if w==0.0{continue;}var q=noise_gradient(hi,lo,b.x,bitcast<u32>(f.geo.z)+k);if b.z>0.0{q=vec4<f32>(-sign(q.w)*q.xyz,0.55-abs(q.w));}h+=q.w*b.y*w;grad+=q.xyz*b.y*w;}
 for(var i=0u;i<u32(f.geo.w);i++){let a=f.edits[2u*i];let b=f.edits[2u*i+1u];let d=(hi-a.xyz)+(lo-b.xyz);let t=max(0.0,1.0-dot(d,d)/(a.w*a.w));h+=b.w*t*t;grad+=-4.0*b.w*t*d/(a.w*a.w);}
 return vec4<f32>(grad,h);
}
// Height with no filter at all, for the camera's own clearance.
fn field_unfiltered(hi:vec3<f32>,lo:vec3<f32>)->f32{
 if field_measured(){return measured_value(hi,lo,0.25);}
 var h=0.0;for(var k=0u;k<24u;k++){let b=band(k);let q=noise_gradient(hi,lo,b.x,bitcast<u32>(f.geo.z)+k).w;h+=b.y*select(q,0.55-abs(q),b.z>0.0);}return h;
}
// Pixel-footprint filtered height, gradient and material grain for shading.
fn field_detail(hi:vec3<f32>,lo:vec3<f32>,footprint:f32)->FieldDetail{
 if field_measured(){let m=measured_field(hi,lo,footprint);return FieldDetail(m.w,m.xyz,0.0);}
 var height=0.0;var gradient=vec3<f32>(0);var grain=0.0;
 for(var k=0u;k<24u;k++){
  let b=band(k);let w=filter_weight(b.x,footprint);height+=select(0.0,0.25,b.z>0.0)*b.y*(1.0-w);if w<=0.001{continue;}
  let q=noise_gradient(hi,lo,b.x,bitcast<u32>(f.geo.z)+k);
  height+=b.y*w*select(q.w,0.55-abs(q.w),b.z>0.0);gradient+=q.xyz*b.y*w*select(1.0,-sign(q.w),b.z>0.0);if k>=12u{grain+=q.w*w*0.04;}
 }
 for(var i=0u;i<u32(f.geo.w);i++){let a=f.edits[2u*i];let b=f.edits[2u*i+1u];let d=(hi-a.xyz)+(lo-b.xyz);let t=max(0.0,1.0-dot(d,d)/(a.w*a.w));height+=b.w*t*t;gradient+=-4.0*b.w*t*d/(a.w*a.w);}
 return FieldDetail(height,gradient,grain);
}
// Height-only evaluation with the same bands, weights and accumulation order
// as field_detail, for consumers that need no normal or material.
fn field_value(hi:vec3<f32>,lo:vec3<f32>,footprint:f32)->f32{
 if field_measured(){return measured_value(hi,lo,footprint);}
 var height=0.0;
 for(var k=0u;k<24u;k++){
  let b=band(k);let w=filter_weight(b.x,footprint);height+=select(0.0,0.25,b.z>0.0)*b.y*(1.0-w);if w<=0.001{continue;}
  let q=noise_value(hi,lo,b.x,bitcast<u32>(f.geo.z)+k);
  height+=b.y*w*select(q,0.55-abs(q),b.z>0.0);
 }
 return height+field_edits(hi,lo);
}
// Full and coarse heights of one sun clipmap texel. Coarse leaves out the bands
// that receivers evaluate live: band 8, the dominant ridge band, and everything
// from live_start on. Edits belong to both.
fn field_split(hi:vec3<f32>,lo:vec3<f32>,footprint:f32,live_start:u32)->vec2<f32>{
 // A measured clipmap caches everything: no receiver re-reads pages per shadow sample.
 if field_measured(){let h=measured_value(hi,lo,footprint);return vec2<f32>(h,h);}
 var full=0.0;var coarse=0.0;
 for(var k=0u;k<24u;k++){
  let b=band(k);let w=filter_weight(b.x,footprint);let live=k==8u||k>=live_start;
  var h=select(0.0,0.25,b.z>0.0)*b.y*(1.0-w);
  if w>0.001{let q=noise_value(hi,lo,b.x,bitcast<u32>(f.geo.z)+k);h+=b.y*w*select(q,0.55-abs(q),b.z>0.0);}
  full+=h;coarse+=select(h,0.0,live);
 }
 for(var i=0u;i<u32(f.geo.w);i++){let a=f.edits[2u*i];let b=f.edits[2u*i+1u];let d=(hi-a.xyz)+(lo-b.xyz);let t=max(0.0,1.0-dot(d,d)/(a.w*a.w));let h=b.w*t*t;full+=h;coarse+=h;}
 return vec2<f32>(full,coarse);
}
// The bands field_split leaves to live evaluation at this level.
fn field_live_bands(hi:vec3<f32>,lo:vec3<f32>,footprint:f32,live_start:u32)->f32{
 // live_start 0 asks for the whole field without edits: points no clipmap covers.
 if field_measured(){if live_start==0u{return measured_value(hi,lo,footprint)-field_edits(hi,lo);}return 0.0;}
 var height=0.0;
 for(var k=0u;k<24u;k++){
  if !(k==8u||k>=live_start){continue;}
  let b=band(k);let w=filter_weight(b.x,footprint);height+=select(0.0,0.25,b.z>0.0)*b.y*(1.0-w);if w<=0.001{continue;}
  let q=noise_value(hi,lo,b.x,bitcast<u32>(f.geo.z)+k);
  height+=b.y*w*select(q,0.55-abs(q),b.z>0.0);
 }
 return height;
}
// Foam bed samples: no ridge mean, no skip, gradient in xyz and height in w.
fn field_bed(hi:vec3<f32>,lo:vec3<f32>,spacing:f32)->vec4<f32>{
 if field_measured(){return measured_field(hi,lo,spacing);}
 var h=0.0;var gradient=vec3<f32>(0);
 for(var k=0u;k<24u;k++){let b=band(k);let w=filter_weight(b.x,spacing);let q=noise_gradient(hi,lo,b.x,bitcast<u32>(f.geo.z)+k);h+=b.y*w*select(q.w,0.55-abs(q.w),b.z>0.0);gradient+=q.xyz*b.y*w*select(1.0,-sign(q.w),b.z>0.0);}
 for(var i=0u;i<u32(f.geo.w);i++){let a=f.edits[2u*i];let b=f.edits[2u*i+1u];let d=(hi-a.xyz)+(lo-b.xyz);let t=max(0.0,1.0-dot(d,d)/(a.w*a.w));h+=b.w*t*t;gradient+=-4.0*b.w*t*d/(a.w*a.w);}
 return vec4<f32>(gradient,h);
}
// Engineering height bound of one level, as the f64 reference states it.
fn field_error_for_level(level:u32)->f32{let spacing=f.planet.x*0.125*exp2(-f32(level));let d=spacing*1.41421356237;var e=d*d/(2.0*f.planet.x);for(var k=0u;k<24u;k++){let b=band(k);let w=filter_weight(b.x,spacing);let linear=5.1961524*d/b.x;let quadratic=15.0*d*d/(b.x*b.x)+6.0*d*d/(b.x*f.planet.x);e+=b.y*((1.0-w)+w*min(2.0,select(quadratic,linear,b.z>0.0)));}for(var i=0u;i<u32(f.geo.w);i++){e+=min(2.0*abs(f.edits[2u*i+1u].w),4.0*abs(f.edits[2u*i+1u].w)*d/f.edits[2u*i].w);}return e;}
// A generated node's unresolved spectrum (sum of squares) in x and the height a
// neighbour one level coarser can differ by in y. Priority and morph padding only.
fn field_unresolved(spacing:f32)->vec2<f32>{var unresolved=0.0;var border=0.0;for(var k=0u;k<24u;k++){let b=band(k);let a=b.y*(1.0-filter_weight(b.x,spacing));unresolved+=a*a;border+=b.y*abs(filter_weight(b.x,spacing)-filter_weight(b.x,2.0*spacing));}return vec2<f32>(unresolved,border);}
// Measured field: pages on the integer cube grid (docs/M1-LIVE-EARTH.md). Every read answers
// at once from what is resident and knows which level served it. f.field.x selects this
// branch, so the procedural body keeps its exact arithmetic. Formulas match solar_core::pages.
@group(0) @binding(110) var page_table:texture_2d_array<u32>;
@group(0) @binding(111) var page_heights:texture_2d_array<u32>;
@group(0) @binding(112) var page_meta:texture_2d<f32>;
@group(0) @binding(113) var page_albedo:texture_2d_array<f32>;
@group(0) @binding(114) var page_sampler:sampler;
const PAGE_ORIGIN_ROW:i32=5;
const PAGE_TEXELS:i32=264;
const TERRAIN_SOLID_RANGE:f32=256.0;
fn field_measured()->bool{return f.field.x>0.5;}
// Chart position of a body point: face, integer position in units of a level-24 cell (2^28
// per face side) and its fraction. Extends eye_key in the same double-single arithmetic.
struct PagePos {face:u32,g:vec2<u32>,frac:vec2<f32>,uv:vec2<f32>}
struct PageAxis {g:u32,frac:f32,chart:f32}
fn page_pos_axis(q:vec2<f32>)->PageAxis{
 let s=ds_mul(ds_add(q,vec2<f32>(1,0)),vec2<f32>(134217728.0,0));
 // Above 2^24 an f32 sum would drop low bits, so the integer parts add as integers.
 let whole=floor(s.x);let rest=rounded(s.x-whole)+s.y;let carry=floor(rest);
 return PageAxis(u32(clamp(i32(whole)+i32(carry),0,268435456)),clamp(rest-carry,0.0,0.999999),q.x+q.y);
}
fn page_pos(hi:vec3<f32>,lo:vec3<f32>)->PagePos{
 let p=hi+lo;let a=abs(p);
 let x=ds_add(vec2<f32>(hi.x,0),vec2<f32>(lo.x,0));let y=ds_add(vec2<f32>(hi.y,0),vec2<f32>(lo.y,0));let z=ds_add(vec2<f32>(hi.z,0),vec2<f32>(lo.z,0));
 var face=0u;var u=vec2<f32>(0);var v=vec2<f32>(0);var d=vec2<f32>(1,0);
 if a.x>=a.y&&a.x>=a.z{if p.x>=0.0{face=0u;u=-z;v=y;d=x;}else{face=1u;u=z;v=y;d=-x;}}
 else if a.y>=a.z{if p.y>=0.0{face=2u;u=x;v=-z;d=y;}else{face=3u;u=x;v=z;d=-y;}}
 else{if p.z>=0.0{face=4u;u=x;v=y;d=z;}else{face=5u;u=-x;v=y;d=-z;}}
 let cu=page_pos_axis(sc_ds_div(u,d));let cv=page_pos_axis(sc_ds_div(v,d));
 return PagePos(face,vec2<u32>(cu.g,cv.g),vec2<f32>(cu.frac,cv.frac),vec2<f32>(cu.chart,cv.chart));
}
// The page holding a position. A point exactly on the far face edge belongs to the last page.
fn page_index(g:vec2<u32>,level:u32)->vec2<u32>{return min(g>>vec2<u32>(28u-level),vec2<u32>((1u<<level)-1u));}
// Isotropic metres per chart unit, relative to a face centre (chart_metric in pages.rs).
fn page_metric(uv:vec2<f32>)->f32{return pow(1.0+dot(uv,uv),-0.75);}
// The clip table entry a query at this level reads: the page or its nearest resident ancestor,
// stepping coarser only when the level's window does not hold the page. Zero means nothing.
fn page_entry(channel:u32,face:u32,level:u32,g:vec2<u32>)->u32{
 var d=level;
 for(var step=0u;step<=20u;step++){
  let page=page_index(g,d);let layer=channel*126u+d*6u+face;
  let origin=textureLoad(page_meta,vec2<i32>(i32(layer),PAGE_ORIGIN_ROW),0);
  let inside=page-vec2<u32>(origin.xy);
  if all(inside<vec2<u32>(32u)){let entry=textureLoad(page_table,vec2<i32>(page&vec2<u32>(31u)),i32(layer),0).x;if (entry>>31u)!=0u{return entry;}}
  if d==0u{return 0u;}
  d-=1u;
 }
 return 0u;
}
fn page_entry_level(entry:u32)->u32{return (entry>>12u)&31u;}
// Water levels: 32 x 32 per height page, in a row of page_meta per slot. A level says what water stands here;
// the shore is where the bed crosses it. WATER_NONE means none, so low land stays dry below sea level.
const PAGE_HEIGHT_ARRIVAL_ROW:i32=14;
const PAGE_WATER_ROW:i32=19;
const WATER_NONE:f32=-1000000.0;
// A vertex's water can be an excess over its own height (a page with water texels), coded above WATER_EXCESS_SPLIT as
// WATER_EXCESS_FLAG plus metres (f32 steps of 2 mm there). No level of any lake on Earth comes near it.
const WATER_EXCESS_FLAG:f32=20000.0;
const WATER_EXCESS_SPLIT:f32=15000.0;
fn vertex_water_decode(code:f32,height:f32)->f32{return select(code,height+(code-WATER_EXCESS_FLAG),code>WATER_EXCESS_SPLIT);}
fn page_water(entry:u32,face:u32,g:vec2<u32>)->f32{
 let plane=page_water_plane(entry,g);let level=page_entry_level(entry);let page=page_index(g,level);
 let inside=g-(page<<vec2<u32>(28u-level));let coord=vec2<f32>(inside)*exp2(f32(level)-23.0)-.5;
 let cell=clamp(vec2<i32>(floor(coord+.5)),vec2<i32>(0),vec2<i32>(31));
 let within=vec2<f32>(inside)*exp2(f32(level)-20.0)-vec2<f32>(cell)*8.0-4.0;
 if plane.x<=WATER_NONE||plane.w<=1.0{return plane.x+dot(plane.yz,within);}
 // River fits are locally affine. Blend their evaluations (not their raw
 // centre heights) to keep confluences and curved reaches continuous.
 let low=vec2<i32>(floor(coord));let fr=fract(coord);var sum=0.0;var weight=0.0;
 for(var k=0u;k<4u;k++){
  let c=low+vec2<i32>(i32(k&1u),i32(k>>1u));var read=entry;
  let at=vec2<u32>(clamp(vec2<i32>(page<<vec2<u32>(28u-level))+(c*8+4)*i32(1u<<(20u-level)),vec2<i32>(0),vec2<i32>(268435455)));
  if any(c<vec2<i32>(0))||any(c>vec2<i32>(31)){read=page_entry(0u,face,level,at);if read==0u{continue;}}
  let q=page_water_plane(read,at);if q.x<=WATER_NONE{continue;}
  let d=page_entry_level(read);let pg=page_index(at,d);let cc=min((at-(pg<<vec2<u32>(28u-d)))>>vec2<u32>(23u-d),vec2<u32>(31u));
  let local=vec2<f32>(vec2<i32>(g)-vec2<i32>(pg<<vec2<u32>(28u-d)))*exp2(f32(d)-20.0)-vec2<f32>(cc)*8.0-4.0;
  let w=select(1.0-fr.x,fr.x,(k&1u)!=0u)*select(1.0-fr.y,fr.y,(k>>1u)!=0u);sum+=(q.x+dot(q.yz,local))*w;weight+=w;
 }
 return select(plane.x+dot(plane.yz,within),sum/max(.000001,weight),weight>0.0);
}
fn page_water_plane(entry:u32,g:vec2<u32>)->vec4<f32>{
 let level=page_entry_level(entry);let page=page_index(g,level);let cell=min((g-(page<<vec2<u32>(28u-level)))>>vec2<u32>(23u-level),vec2<u32>(31u));let index=cell.y*32u+cell.x;
 return textureLoad(page_meta,vec2<i32>(i32(index&255u),PAGE_WATER_ROW+i32(page_entry_slot(entry)*4u+(index>>8u))),0);
}
// Geometry support extends past banks. Coverage is a separate query above;
// using WATER_NONE as a height tears a sloping river into triangular sheets.
fn page_water_geometry(entry:u32,face:u32,g:vec2<u32>)->f32{return page_water(entry,face,g);}
// Excess so far under the ground that it stands for no water at all near this point: rivers.js writes
// WATER_EXCESS_FAR (-32 m) away from every channel, and the spline only blends it toward the banks.
const WATER_EXCESS_NONE:f32=-24.0;
// The water level at a point of one page: height plus excess where the page has water texels (below the ground
// where it is dry), else the level of the point's cell. WATER_NONE: nothing here, as before.
fn page_water_at(entry:u32,pos:PagePos)->f32{
 if page_water_texels(entry){let s=page_water_read(entry,pos.face,pos.g,pos.frac);return select(s.x,WATER_NONE,s.y<WATER_EXCESS_NONE);}
 return page_water(entry,pos.face,pos.g);
}
// A saturated excess code: still water deeper than the code holds (resample.js DEEP_EXCESS). Its level is its cell's.
const WATER_EXCESS_DEEP:u32=65535u;
// Water level (x) and excess over the page's ground (y) on a page with water texels, through the heights' spline.
// The excess decides where water is (y > 0). The level is the spline of height plus excess over the wet texels alone,
// weights renormalised: a dry texel's excess is held under its ground (resample.js), and where that ground lies low,
// as at a seam between two carved beds, mixing it in sank the surface into a trench toward the shore. With no wet
// texel in the footprint the level is height plus excess, under the ground. Where any texel of the footprint is
// saturated, height plus excess would sink the surface toward the bed, so the level is the cell's instead. Only still
// water is that deep, and its level is one.
fn page_water_read(entry:u32,face:u32,g:vec2<u32>,frac:vec2<f32>)->vec2<f32>{
 let level=page_entry_level(entry);let slot=page_entry_slot(entry);let shift=28u-level;
 let page=page_index(g,level);let inside=g-(page<<vec2<u32>(shift));
 let x=(vec2<f32>(inside)+frac)*exp2(f32(level)-20.0);
 let i=floor(x+vec2<f32>(0.5));let s=x-i;
 let wx=vec3<f32>(0.5*(0.5-s.x)*(0.5-s.x),0.75-s.x*s.x,0.5*(0.5+s.x)*(0.5+s.x));
 let wy=vec3<f32>(0.5*(0.5-s.y)*(0.5-s.y),0.75-s.y*s.y,0.5*(0.5+s.y)*(0.5+s.y));
 let origin=vec2<i32>(i32(slot%15u),i32((slot/15u)%15u))*PAGE_TEXELS+vec2<i32>(i)+vec2<i32>(3);
 let layer=i32(slot/225u);let params=textureLoad(page_meta,vec2<i32>(i32(slot%256u),i32(slot/256u)),0);
 var h=0.0;var e=0.0;var deep=false;var wet=0.0;var weight=0.0;
 for(var b=0;b<3;b++){for(var c=0;c<3;c++){
  let word=textureLoad(page_heights,origin+vec2<i32>(c-1,b-1),layer,0).x;let w=wx[c]*wy[b];let code=word>>16u;
  let t=f32(word&0xffffu);let x=f32(code)-32768.0;h+=w*t;e+=w*x;deep=deep||code==WATER_EXCESS_DEEP;
  if code>32768u&&code<WATER_EXCESS_DEEP{wet+=w*(params.x+params.y*t+x*WATER_EXCESS_UNIT);weight+=w;}
 }}
 let ground=params.x+params.y*h;
 if deep{let cell=page_water(entry,face,g);if cell>WATER_NONE{return vec2<f32>(cell,cell-ground);}}
 let excess=e*WATER_EXCESS_UNIT;
 if weight>0.0001{return vec2<f32>(wet/weight,excess);}
 return vec2<f32>(ground+excess,excess);
}
// Whether water stands at a point of one page.
fn page_wet(entry:u32,pos:PagePos)->bool{
 if page_water_texels(entry){return page_surface_read(entry,pos.g,pos.frac).w>0.0;}
 let level=page_water(entry,pos.face,pos.g);return level>WATER_NONE&&level>page_height_read(entry,pos.g,pos.frac).x;
}
// Water support terminates behind the dry bank. Material wetness follows the
// continuous bed-to-level clearance, never a bilinear square occupancy mask.
fn page_water_near(face:u32,entry:u32,g:vec2<u32>)->f32{
 return select(0.0,1.0,page_water(entry,face,g)>WATER_NONE);
}
// How much the image alone stands for water at this footprint. It shows what a pixel of that size can of the real sea: turbidity,
// shoals, currents. Up close it is a blur, and the surface and bed take over. Measured from afar, synthesized up close.
fn measured_water_image(footprint:f32)->f32{return smoothstep(1.0,6.0,footprint);}
// Private attribution bits for the water's distance switches (cloud_diagnostic bits 16-23, exact in the f32 word):
// each moves one switch, so a band on the water that moves with it is that switch's (tools/Test-Water-Ring.mjs).
// 65536 bed trust x4 farther, 131072 the water mesh limited to its first 12 rings (cost attribution, explorer.wgsl),
// 262144 surface bed's unseen x4, 524288 no relief clearance, 1048576 water pages one level finer, 2097152 the lifted
// ocean yields in the far zone too (cost attribution), 4194304 no caustic focus, 8388608 paint the depths the water pass
// used (water.wgsl).
fn water_diagnostic(bit:u32)->bool{return (u32(f.cloud_drift.z)&bit)!=0u;}
// How far the field rather than the mesh says where water ends, how deep it is and what shows through it. The mesh reads a page matched to its vertices, far coarser than a pixel beyond a few hundred
// metres, and later to arrive. So its water stops along that page's cells wherever the two disagree, in square steps on a flat shore. Only close up, where the two read one page, does the mesh know more: its waves.
fn measured_water_trust(footprint:f32)->f32{return smoothstep(0.5,1.0,footprint);}
fn measured_water_entry(pos:PagePos,footprint:f32)->u32{
 let wanted=clamp(ceil(log2(f.planet.x/128.0*page_metric(pos.uv)/max(footprint,0.000001)))+select(0.0,1.0,water_diagnostic(1048576u)),0.0,f.field.y);
 return page_entry(0u,pos.face,u32(wanted),pos.g);
}
fn measured_water_level(pos:PagePos,footprint:f32)->f32{
 let entry=measured_water_entry(pos,footprint);if entry==0u{return f.planet.y;}
 // The water layer: the level where water is, or within two texels of it, else none.
 let we=water_layer_entry(entry,pos.face,pos.g);if we!=0u{let w=water_layer_at(we,pos);return select(WATER_NONE,w.level,w.level>WATER_NONE&&w.sdf<2.0*w.cell);}
 return page_water_at(entry,pos);
}
// How far water here has come in. A page bringing water to ground that had none fades it in over 40 frames;
// a page refining water that was already there changes nothing, so the sea never flickers.
fn measured_water_fade(pos:PagePos,footprint:f32)->f32{
 // Every arrival moves the table's serial, so after 40 quiet frames nothing is still fading in.
 if field_final||f.field_serial.z>=40u{return 1.0;}
 let wanted=clamp(ceil(log2(f.planet.x/128.0*page_metric(pos.uv)/max(footprint,0.000001))),0.0,f.field.y);
 let entry=page_entry(0u,pos.face,u32(wanted),pos.g);let level=page_entry_level(entry);if entry==0u||level==0u{return 1.0;}
 let slot=page_entry_slot(entry);let arrival=textureLoad(page_meta,vec2<i32>(i32(slot%256u),PAGE_HEIGHT_ARRIVAL_ROW+i32(slot/256u)),0).x;
 let age=(f32(f.cloud_cache.x)-arrival)/40.0;if age>=1.0{return 1.0;}
 let coarse=page_entry(0u,pos.face,level-1u,pos.g);if coarse==0u||coarse==entry{return 1.0;}
 let wc=water_layer_entry(coarse,pos.face,pos.g);
 if wc!=0u{if water_layer_at(wc,pos).sdf<0.0{return 1.0;}}
 else if page_water_texels(coarse)||page_water_texels(entry){if page_wet(coarse,pos){return 1.0;}}else if page_water(coarse,pos.face,pos.g)>WATER_NONE{return 1.0;}
 return smoothstep(0.0,1.0,max(age,0.0));
}
fn page_entry_slot(entry:u32)->u32{return entry&4095u;}
// ---- The water layer (docs/WATER-LAYER.md, web/field/water-layer.js). A height page's water page sits in its own
// atlas: per texel the signed distance to the shore (1/512 texel around 32768, negative in water, clamped at the
// band), the level (page offset + scale * code; 65535 none), coverage | kind << 8 | fetch << 10, and flow (two signed
// bytes of 4/127 m/s along the page's texel axes). page_meta from column 256 of rows 0-4 says, per height slot, where
// it is: x >= 0 the water slot (y offset, z scale); -1 no water within the band; -2 one body over the whole page (y
// kind, z level); -3 no water layer for this page (the old reads stand); -4 its water slot went to another page.
@group(0) @binding(115) var water_atlas:texture_2d_array<u32>;
const WATER_LAYER_X:i32=256;
const WATER_BAND_TEXELS:f32=32.0;
struct WaterLayer {sdf:f32,level:f32,coverage:f32,kind:u32,flow:vec2<f32>,cell:f32}
fn water_layer_info(entry:u32)->vec4<f32>{let slot=page_entry_slot(entry);return textureLoad(page_meta,vec2<i32>(WATER_LAYER_X+i32(slot%256u),i32(slot/256u)),0);}
// The entry whose water layer answers for a point: the page itself, or a coarser one when its water slot was lent
// to another page (at most four levels up). Zero when none of them carries the layer.
// A pinned page (levels 0-2, from the pack) carries no layer; then the finest page resident at the point answers if it
// does (below, for any page), so a far query (the water mesh's coarse cells, a far pixel) and a near one (the lifted ocean's fragment) agree
// on whether the layer holds there; otherwise the mesh drops far cells that the lifted ocean yields, and no surface
// is drawn (Test-Earth-Sea-Cover). Pages of level 3 and finer without a layer keep the old reads.
// Where the walk from a page whose slot was lent ends without an answer (slots lent along the whole walk, or a pinned
// page at its end), the finest page resident at the point answers if it carries the layer: every caller then agrees on
// whether the layer holds there. A water mesh cell and its vertices read pages one level apart over the morph to the
// coarser ring, and a vertex that found no layer would collapse the cell's triangles (a ring of deep sea with no
// surface). Not for a page built without the layer (the old reads stand there): the finest page is a walk
// down the page table from the finest level, and asked for every such query it cost 0.9 ms in the water stage where
// the ground stood on pages without the layer (the fixtures' far placeholder ground).
fn water_layer_entry(entry:u32,face:u32,g:vec2<u32>)->u32{
 // Surface height must not change with the requesting mesh's LOD. Every
 // reader uses the finest resident water description at this world address.
 // A fine dry page is authoritative too; old coarse water cannot leak through it.
 let fine=page_entry(0u,face,u32(f.field.y),g);
 if fine!=0u&&water_layer_info(fine).x>-2.5{return fine;}
 if entry==0u{return 0u;}var e=entry;
 for(var k=0u;k<5u;k++){let x=water_layer_info(e).x;if x>-2.5{return e;}if x>-3.5{break;}let l=page_entry_level(e);if l==0u{break;}e=page_entry(0u,face,l-1u,g);if e==0u{break;}}
 // The finest entry was checked above. The table and metadata are read-only
 // throughout this invocation; repeating that lookup cannot change its answer.
 return 0u;
}
// Bilinear read of the water layer at a point of one page (the page's own grid, as page_surface_read).
fn water_layer_read(entry:u32,face:u32,g:vec2<u32>,frac:vec2<f32>,uv:vec2<f32>)->WaterLayer{
 let info=water_layer_info(entry);let level=page_entry_level(entry);let cell=page_cell(level)*page_metric(uv);
 if info.x<-1.5{return WaterLayer(-WATER_BAND_TEXELS*cell,info.z,1.0,u32(info.y),vec2<f32>(0),cell);}
 if info.x<-0.5{return WaterLayer(WATER_BAND_TEXELS*cell,WATER_NONE,0.0,0u,vec2<f32>(0),cell);}
 let ws=u32(info.x);let shift=28u-level;let page=page_index(g,level);let inside=g-(page<<vec2<u32>(shift));
 let x=(vec2<f32>(inside)+frac)*exp2(f32(level)-20.0);let i=min(floor(x),vec2<f32>(255.0));let fr=x-i;
 let origin=vec2<i32>(i32(ws%15u),i32((ws/15u)%15u))*PAGE_TEXELS+vec2<i32>(i)+vec2<i32>(3);let layer=i32(ws/225u);
 var sdf=0.0;var lv=0.0;var lw=0.0;var cov=0.0;var flow=vec2<f32>(0);var kind=0u;var best=-1.0;
 for(var k=0u;k<4u;k++){
  let o=vec2<i32>(i32(k&1u),i32(k>>1u));let w=select(1.0-fr.x,fr.x,(k&1u)!=0u)*select(1.0-fr.y,fr.y,(k>>1u)!=0u);
  let t=textureLoad(water_atlas,origin+o,layer,0);
  sdf+=w*(f32(t.x)-32768.0)/512.0;cov+=w*f32(t.z&255u)/255.0;
  if t.y!=65535u{lv+=w*(info.y+info.z*f32(t.y));lw+=w;}
  flow+=w*vec2<f32>(f32(i32(t.w&255u)^128)-128.0,f32(i32((t.w>>8u)&255u)^128)-128.0)*(4.0/127.0);
  if w>best{best=w;kind=(t.z>>8u)&3u;}
 }
 return WaterLayer(sdf*cell,select(WATER_NONE,lv/max(lw,1e-6),lw>1e-6),cov,kind,flow,cell);
}
// The shore's own variation is in the page's distance (water-layer.js shoreWiggle), so the bed and banks follow it.
fn water_layer_at(entry:u32,pos:PagePos)->WaterLayer{return water_layer_read(entry,pos.face,pos.g,pos.frac,pos.uv);}
// How much of a pixel of this footprint (metres) the water covers: an edge from the distance where a pixel is smaller
// than a texel, the texel's box-filtered coverage where it is larger (a thin river stays a thin line). The edge is never
// narrower than WATER_SWASH: a water's edge is a swash zone, not a line, and a one-pixel edge close up crawled as the
// eye moved (shadow-only flicker along the Wupper's ponds, docs/WATER-LAYER.md).
const WATER_SWASH:f32=0.25;
fn water_layer_coverage(w:WaterLayer,footprint:f32)->f32{
 let sharp=clamp(0.5-w.sdf/max(footprint,WATER_SWASH),0.0,1.0);
 return mix(sharp,select(w.coverage,sharp,w.sdf<=-w.cell),smoothstep(0.5,2.0,footprint/max(w.cell,1e-4)));
}
// Quadratic B-spline height in x; chart-unit derivatives in y, z. Same weights as spline().
fn page_height_read(entry:u32,g:vec2<u32>,frac:vec2<f32>)->vec3<f32>{return page_surface_read(entry,g,frac).xyz;}
// Whether a page carries water texels (resample.js): the slot's parameters say so, as a slot keeps an old page's bits.
fn page_water_texels(entry:u32)->bool{let slot=page_entry_slot(entry);return textureLoad(page_meta,vec2<i32>(i32(slot%256u),i32(slot/256u)),0).z>0.5;}
// Height, its chart derivatives and, in w, the water's excess over it, all through one spline of one set of loads.
// The excess is positive under water and negative on dry ground; it means something only where page_water_texels.
// The water surface is height + excess, so the shore is where the excess crosses zero, between texels, with no cells.
const WATER_EXCESS_UNIT:f32=1.0/1024.0;
fn page_surface_read(entry:u32,g:vec2<u32>,frac:vec2<f32>)->vec4<f32>{
 let level=page_entry_level(entry);let slot=page_entry_slot(entry);let shift=28u-level;
 let page=page_index(g,level);let inside=g-(page<<vec2<u32>(shift));
 let x=(vec2<f32>(inside)+frac)*exp2(f32(level)-20.0);
 let i=floor(x+vec2<f32>(0.5));let s=x-i;
 let wx=vec3<f32>(0.5*(0.5-s.x)*(0.5-s.x),0.75-s.x*s.x,0.5*(0.5+s.x)*(0.5+s.x));
 let wy=vec3<f32>(0.5*(0.5-s.y)*(0.5-s.y),0.75-s.y*s.y,0.5*(0.5+s.y)*(0.5+s.y));
 let dx=vec3<f32>(s.x-0.5,-2.0*s.x,s.x+0.5);let dy=vec3<f32>(s.y-0.5,-2.0*s.y,s.y+0.5);
 let origin=vec2<i32>(i32(slot%15u),i32((slot/15u)%15u))*PAGE_TEXELS+vec2<i32>(i)+vec2<i32>(3);
 let layer=i32(slot/225u);let params=textureLoad(page_meta,vec2<i32>(i32(slot%256u),i32(slot/256u)),0);
 var v=vec3<f32>(0);var e=0.0;
 for(var b=0;b<3;b++){for(var c=0;c<3;c++){
  let word=textureLoad(page_heights,origin+vec2<i32>(c-1,b-1),layer,0).x;let t=f32(word&0xffffu);
  v+=vec3<f32>(wx[c]*wy[b],dx[c]*wy[b],wx[c]*dy[b])*t;e+=wx[c]*wy[b]*(f32(word>>16u)-32768.0);
 }}
 // A grid unit is 2/(256*2^level) chart units.
 let per_chart=128.0*exp2(f32(level));
 return vec4<f32>(params.x+params.y*v.x,params.y*v.y*per_chart,params.y*v.z*per_chart,e*WATER_EXCESS_UNIT);
}
// The water surface (height plus excess) and its chart derivatives, through the same spline. Water shading only.
// Only wet texels count, with the spline's weights renormalised over them: a dry texel's excess is held under its
// ground and sinks away from the bank (resample.js), so across a channel a few texels wide it would tilt the
// surface toward each bank and read as rapids. Saturated (deep) texels count only when nothing else is wet.
fn page_water_surface(entry:u32,g:vec2<u32>,frac:vec2<f32>)->vec3<f32>{
 let level=page_entry_level(entry);let slot=page_entry_slot(entry);let shift=28u-level;
 let page=page_index(g,level);let inside=g-(page<<vec2<u32>(shift));
 let x=(vec2<f32>(inside)+frac)*exp2(f32(level)-20.0);
 let i=floor(x+vec2<f32>(0.5));let s=x-i;
 let wx=vec3<f32>(0.5*(0.5-s.x)*(0.5-s.x),0.75-s.x*s.x,0.5*(0.5+s.x)*(0.5+s.x));
 let wy=vec3<f32>(0.5*(0.5-s.y)*(0.5-s.y),0.75-s.y*s.y,0.5*(0.5+s.y)*(0.5+s.y));
 let dx=vec3<f32>(s.x-0.5,-2.0*s.x,s.x+0.5);let dy=vec3<f32>(s.y-0.5,-2.0*s.y,s.y+0.5);
 let origin=vec2<i32>(i32(slot%15u),i32((slot/15u)%15u))*PAGE_TEXELS+vec2<i32>(i)+vec2<i32>(3);
 let layer=i32(slot/225u);let params=textureLoad(page_meta,vec2<i32>(i32(slot%256u),i32(slot/256u)),0);
 var all=vec3<f32>(0);var wet=vec3<f32>(0);var weight=vec3<f32>(0);
 for(var b=0;b<3;b++){for(var c=0;c<3;c++){
  let word=textureLoad(page_heights,origin+vec2<i32>(c-1,b-1),layer,0).x;let code=word>>16u;
  let t=params.x+params.y*f32(word&0xffffu)+(f32(code)-32768.0)*WATER_EXCESS_UNIT;
  let w=vec3<f32>(wx[c]*wy[b],dx[c]*wy[b],wx[c]*dy[b]);all+=w*t;
  if code>32768u&&code<WATER_EXCESS_DEEP{wet+=w*t;weight+=w;}
 }}
 let per_chart=128.0*exp2(f32(level));
 if weight.x<=0.0001{return vec3<f32>(all.x,all.y*per_chart,all.z*per_chart);}
 // f = A/W, so f' = (A' - f W')/W.
 let value=wet.x/weight.x;
 return vec3<f32>(value,(wet.y-value*weight.y)/weight.x*per_chart,(wet.z-value*weight.z)/weight.x*per_chart);
}
// Tangent-plane gradient per metre from chart derivatives (chart_gradient in pages.rs).
fn page_gradient(face:u32,uv:vec2<f32>,du:f32,dv:f32)->vec3<f32>{
 var eu=vec3<f32>(0);var ev=vec3<f32>(0);var axis=vec3<f32>(0);
 switch face{
  case 0u:{axis=vec3<f32>(1,0,0);eu=vec3<f32>(0,0,-1);ev=vec3<f32>(0,1,0);}
  case 1u:{axis=vec3<f32>(-1,0,0);eu=vec3<f32>(0,0,1);ev=vec3<f32>(0,1,0);}
  case 2u:{axis=vec3<f32>(0,1,0);eu=vec3<f32>(1,0,0);ev=vec3<f32>(0,0,-1);}
  case 3u:{axis=vec3<f32>(0,-1,0);eu=vec3<f32>(1,0,0);ev=vec3<f32>(0,0,1);}
  case 4u:{axis=vec3<f32>(0,0,1);eu=vec3<f32>(1,0,0);ev=vec3<f32>(0,1,0);}
  default:{axis=vec3<f32>(0,0,-1);eu=vec3<f32>(-1,0,0);ev=vec3<f32>(0,1,0);}
 }
 let p=axis+eu*uv.x+ev*uv.y;let r=length(p);let n=p/r;let k=f.planet.x/r;
 let tu=(eu-n*dot(n,eu))*k;let tv=(ev-n*dot(n,ev))*k;
 let g11=dot(tu,tu);let g12=dot(tu,tv);let g22=dot(tv,tv);let det=g11*g22-g12*g12;
 return tu*((g22*du-g12*dv)/det)+tv*((g11*dv-g12*du)/det);
}
struct MeasuredRead {height:f32,gradient:vec3<f32>,spacing:f32,served:u32}
fn page_cell(level:u32)->f32{return f.planet.x/128.0*exp2(-f32(level));}
// One read at a footprint in metres, blending the two levels around the wanted one.
// One level with its fades: height and chart derivatives in xyz, served cell in w. Shading, shores and
// shadows read this. The mesh reads the page itself and morphs to it.
fn measured_height_soft(pos:PagePos,entry:u32)->vec4<f32>{
 let r=vec4<f32>(page_height_read(entry,pos.g,pos.frac),page_cell(page_entry_level(entry)));
 let soft=page_soft(0u,pos,entry);if soft.x>=1.0{return r;}
 let coarse=page_entry(0u,pos.face,u32(soft.y),pos.g);if coarse==0u||coarse==entry{return r;}
 return mix(vec4<f32>(page_height_read(coarse,pos.g,pos.frac),page_cell(page_entry_level(coarse))),r,soft.x);
}
fn measured_footprint(pos:PagePos,footprint:f32)->MeasuredRead{
 let top=f.field.y;
 let wanted=clamp(log2(f.planet.x/128.0*page_metric(pos.uv)/max(footprint,0.000001)),0.0,top);
 let low=floor(wanted);let t=wanted-low;let a=page_entry(0u,pos.face,u32(low),pos.g);
 if a==0u{return MeasuredRead(0.0,vec3<f32>(0),f.planet.x,0u);}
 let ra=measured_height_soft(pos,a);let sa=page_entry_level(a);
 if t>0.0&&low<top{
  let b=page_entry(0u,pos.face,u32(low)+1u,pos.g);
  if b!=a&&b!=0u{
   let m=mix(ra,measured_height_soft(pos,b),t);
   return MeasuredRead(m.x,page_gradient(pos.face,pos.uv,m.y,m.z),m.w,page_entry_level(b));
  }
 }
 return MeasuredRead(ra.x,page_gradient(pos.face,pos.uv,ra.y,ra.z),ra.w,sa);
}
// Synthesized detail: only wavelengths the served page does not resolve, scaled by the data's
// own roughness. Value noise only, with zero expected value. Gradient in xyz, height in w.
fn measured_complement(hi:vec3<f32>,lo:vec3<f32>,footprint:f32,served:f32,gradient:vec3<f32>)->vec4<f32>{
 // Amplitude follows the data's own slope. Ground that is not water-flat keeps a floor, so gentle land
 // and the sea floor have human-scale relief; data flat to a fraction of a degree stays flat (a lake,
 // until M3 models them). Steep ground breaks into ridges, keeping about zero mean (ridge mean 0.25).
 let slope=length(gradient);let rho=max(clamp(slope/f.field.w,0.0,1.0),max(FIELD_RELIEF_FLOOR*smoothstep(0.0005,0.003,slope),f.body_detail.x));if rho<=0.0{return vec4<f32>(0);}
 let crag=smoothstep(0.35,0.8,slope);var h=0.0;var g=vec3<f32>(0);
 // filter_weight is 0 up to its spacing and 1 from four times it, so only scales between the footprint and four served cells have
 // any weight left. The rest would be skipped anyway, after computing band(), with its two pows, for each of them.
 let first=u32(clamp(floor(log2(2097152.0/(4.0*max(served,0.000001)))),9.0,24.0));
 let last=u32(clamp(ceil(log2(2097152.0/max(footprint,0.000001))),0.0,23.0));
 for(var k=first;k<=last;k++){
  let b=band(k);let w=filter_weight(b.x,footprint)-filter_weight(b.x,served);if w<=0.001{continue;}
  let q=noise_gradient(hi,lo,b.x,bitcast<u32>(f.geo.z)+k);
  let v=mix(q,vec4<f32>(-sign(q.w)*q.xyz,0.3-abs(q.w)),crag);
  h+=b.y*rho*w*v.w;g+=v.xyz*b.y*rho*w;
 }
 return vec4<f32>(g,h);
}
const FIELD_RELIEF_FLOOR:f32=0.25;
// The source channel already contains its carved bed and bounded bed detail.
// Adding the generic missing-terrain spectrum on top could lift a shallow
// stream above its water and create isolated obstructions. Join that spectrum
// smoothly on the dry bank; underwater shape remains the prepared source bed.
fn measured_bank_complement(detail:vec4<f32>,height:f32,gradient:vec3<f32>,water:f32)->vec4<f32>{
 if water<=WATER_NONE{return detail;}
 let t=clamp((height-water)*.5,0.0,1.0);let weight=t*t*(3.0-2.0*t);let derivative=3.0*t*(1.0-t);
 return vec4<f32>(detail.xyz*weight+gradient*(detail.w*derivative),detail.w*weight);
}
// The whole measured field at a footprint: gradient in xyz, height in w, edits included.
fn measured_field(hi:vec3<f32>,lo:vec3<f32>,footprint:f32)->vec4<f32>{
 let pos=page_pos(hi,lo);let r=measured_footprint(pos,footprint);let c=measured_bank_complement(measured_complement(hi,lo,footprint,r.spacing,r.gradient),r.height,r.gradient,measured_water_level(pos,footprint));
 return vec4<f32>(r.gradient+c.xyz,r.height+c.w+field_edits(hi,lo));
}
fn measured_value(hi:vec3<f32>,lo:vec3<f32>,footprint:f32)->f32{return measured_field(hi,lo,footprint).w;}
// Imagery at a pixel footprint, blended between levels like height.
fn measured_albedo_level(entry:u32,g:vec2<u32>,frac:vec2<f32>)->vec3<f32>{
 let level=page_entry_level(entry);let slot=page_entry_slot(entry);let shift=28u-level;
 let page=page_index(g,level);let inside=g-(page<<vec2<u32>(shift));
 // A page's place in the atlas depends on what arrived first, and must not change what it shows. On a 1/4096 grid, twelve bits above
 // and twelve below the point fit a float exactly, so that the filter weights are the same in every slot.
 let x=floor((vec2<f32>(inside)+frac)*exp2(f32(level)-8.0))/4096.0;
 let texel=vec2<f32>(vec2<i32>(i32(slot%15u),i32((slot/15u)%15u))*PAGE_TEXELS)+x+vec2<f32>(4.0);
 return textureSampleLevel(page_albedo,page_sampler,texel/4096.0,i32(slot/225u),0.0).rgb;
}
// Set by whatever caches a field read for longer than a frame, which must hold the final field, not a
// moment of a page's fade in.
var<private> field_final:bool=false;
// How much of this page to show here: x weight, y the level to fade toward. A page fades to a coarser
// neighbour across its last cells, so resident pages of different levels never meet at a hard line,
// and over 20 frames when it arrives, so that it does not pop. One table read per near border.
const PAGE_FADE_CELLS:f32=32.0;
fn page_soft(channel:u32,pos:PagePos,entry:u32)->vec2<f32>{
 let level=page_entry_level(entry);if level==0u{return vec2<f32>(1,0);}
 let shift=28u-level;let page=page_index(pos.g,level);let inside=pos.g-(page<<vec2<u32>(shift));
 let x=(vec2<f32>(inside)+pos.frac)*exp2(f32(level)-20.0);let edge=min(x,vec2<f32>(256.0)-x);
 var weight=1.0;var toward=level;let side=(1u<<level);
 for(var axis=0u;axis<2u;axis++){
  if edge[axis]>=PAGE_FADE_CELLS{continue;}
  // The neighbour across the nearer border, on this face. A cube edge keeps its hard border.
  let up=x[axis]>=128.0;if (up&&page[axis]+1u>=side)||(!up&&page[axis]==0u){continue;}
  var near=pos.g;near[axis]=select((page[axis]<<shift)-1u,(page[axis]+1u)<<shift,up);
  let other=page_entry(channel,pos.face,level,near);let served=page_entry_level(other);
  if served<level{weight=min(weight,smoothstep(0.0,PAGE_FADE_CELLS,edge[axis]));toward=min(toward,served);}
 }
 // Every arrival moves the table's serial, so after 20 quiet frames nothing is still fading in.
 if !field_final&&f.field_serial.z<20u{
  let slot=page_entry_slot(entry);let arrival=textureLoad(page_meta,vec2<i32>(i32(slot%256u),select(PAGE_HEIGHT_ARRIVAL_ROW,6,channel==1u)+i32(slot/256u)),0).x;
  var age=(f32(f.cloud_cache.x)-arrival)/20.0;
  if age<1.0&&channel==0u{
   // Align the height used by relief and shading with nearby published geometry.
   // Compare at the receiver's terrain height, so this also works in mountains.
   let radial=normalize(weather_direction(pos.face,pos.uv));
   let height=page_height_read(entry,pos.g,pos.frac).x;
   let offset=(radial-normalize(f.eye_hi.xyz+f.eye_lo.xyz))*f.planet.x+radial*(height-f.eye_hi.w);
   age=max(age,1.0-smoothstep(TERRAIN_SOLID_RANGE,3.0*TERRAIN_SOLID_RANGE,length(offset)));
  }
  if age<1.0{weight=min(weight,smoothstep(0.0,1.0,max(age,0.0)));toward=min(toward,level-1u);}
 }
 return vec2<f32>(weight,f32(toward));
}
// The cell behind the last soft read, moving as its fade does.
var<private> field_soft_cell:f32=1e9;
fn measured_albedo_soft(pos:PagePos,entry:u32)->vec3<f32>{
 let c=measured_albedo_level(entry,pos.g,pos.frac);let soft=page_soft(1u,pos,entry);field_soft_cell=page_cell(page_entry_level(entry));if soft.x>=1.0{return c;}
 let coarse=page_entry(1u,pos.face,u32(soft.y),pos.g);if coarse==0u||coarse==entry{return c;}
 field_soft_cell=mix(page_cell(page_entry_level(coarse)),field_soft_cell,soft.x);
 return mix(measured_albedo_level(coarse,pos.g,pos.frac),c,soft.x);
}
// Cell of the imagery behind the last measured_albedo call: procedural detail stops where it starts.
var<private> field_albedo_cell:f32=1e9;
fn measured_albedo(hi:vec3<f32>,lo:vec3<f32>,footprint:f32)->vec3<f32>{return measured_albedo_at(page_pos(hi,lo),footprint);}
// measured_albedo at a chart position already found (page_pos inlines several hundred lines per call).
fn measured_albedo_at(pos:PagePos,footprint:f32)->vec3<f32>{
 let top=f.field.z;
 let wanted=clamp(log2(f.planet.x/128.0*page_metric(pos.uv)/max(footprint,0.000001)),0.0,top);
 let low=floor(wanted);let t=wanted-low;let a=page_entry(1u,pos.face,u32(low),pos.g);
 if a==0u{field_albedo_cell=1e9;return vec3<f32>(0.1);}
 let ca=measured_albedo_soft(pos,a);field_albedo_cell=field_soft_cell;
 if t>0.0&&low<top{let b=page_entry(1u,pos.face,u32(low)+1u,pos.g);if b!=a&&b!=0u{let cb=measured_albedo_soft(pos,b);field_albedo_cell=mix(field_albedo_cell,field_soft_cell,t);return mix(ca,cb,t);}}
 return ca;
}
// Cell of the imagery a pixel will read, without reading it: continuous with footprint, as the read is,
// or the warp built on it would jump along every level contour.
fn measured_albedo_soft_cell(pos:PagePos,entry:u32)->f32{
 let cell=page_cell(page_entry_level(entry));let soft=page_soft(1u,pos,entry);
 if soft.x>=1.0{return cell;}
 let coarse=page_entry(1u,pos.face,u32(soft.y),pos.g);if coarse==0u||coarse==entry{return cell;}
 return mix(page_cell(page_entry_level(coarse)),cell,soft.x);
}
fn measured_albedo_cell(hi:vec3<f32>,lo:vec3<f32>,footprint:f32)->f32{
 if footprint>=16.0{return 1e9;}
 let pos=page_pos(hi,lo);let top=f.field.z;let wanted=clamp(log2(f.planet.x/128.0*page_metric(pos.uv)/max(footprint,0.000001)),0.0,top);
 let low=floor(wanted);let t=wanted-low;let a=page_entry(1u,pos.face,u32(low),pos.g);if a==0u{return 1e9;}
 let cell=measured_albedo_soft_cell(pos,a);if t<=0.0||low>=top{return cell;}
 let b=page_entry(1u,pos.face,u32(low)+1u,pos.g);if b==a||b==0u{return cell;}
 return mix(cell,measured_albedo_soft_cell(pos,b),t);
}
// Displacement that breaks up the image's bilinear pixels, so that an edge between two colours is ragged
// instead of a long blur. It moves content by about a quarter of a scale, well inside what a cell can say.
// Scales are powers of two: the noise's integer cell is hi/scale, and only then is that division exact.
fn material_warp(hi:vec3<f32>,lo:vec3<f32>,cell:f32,footprint:f32)->vec3<f32>{
 var warp=vec3<f32>(0);var scale=16.0;
 for(var i=0u;i<3u;i++){
  let w=smoothstep(scale*0.25,scale,cell)*filter_weight(scale,footprint);
  if w>0.001{warp+=noise_gradient(hi,lo,scale,bitcast<u32>(f.geo.z)+51u+i).xyz*scale*scale*0.25*w;}
  scale*=0.25;
 }
 return warp;
}
// Fine shading slope from the last material, in the same units as a field gradient. It is the material's
// own and not part of the field: no mesh, shadow or collision reads it.
var<private> field_material_bump:vec3<f32>=vec3<f32>(0);
// How much water the field says stands at this point, whatever the mesh does here. The water pass reads it from the alpha of the shaded image.
var<private> field_water_here:f32=0.0;
// One family of rock joints: fractures near parallel planes, cutting the surface in nearly straight lines that end. The zero
// lines of a noise looked like contours, closed loops on every hillside, which no rock has. Integer plane normals over a power of
// two spacing, so that the phase needs only the low part of the address and stays continuous across its cells. x: how much of the
// line lies on this pixel; y: that family's mean over the ground, for keeping the mean of the image. Below a pixel a line fades in
// proportion, so filtering it returns the same mean.
fn joint_family(lo:vec3<f32>,normal:vec3<f32>,spacing:f32,offset:f32,wander:f32,reach:f32,footprint:f32)->vec2<f32>{
 let per_metre=length(normal)/spacing;
 let phase=dot(lo,normal)/spacing+offset+wander;
 let distance_to_plane=abs(fract(phase+0.5)-0.5)/per_metre;
 let thin=0.0025*spacing;let width=max(thin,footprint*0.7);let weight=min(thin/width,1.0);
 return vec2<f32>(reach*weight*(1.0-smoothstep(0.0,width,distance_to_plane)),0.5*weight*width*per_metre);
}
// Sparse elements on the integer chart lattice, at most one per cell, drawn from the nine cells around the
// point: blades or stones. A lattice unit is 2^-28 of a face, so this is exact at any distance from the
// origin. Premultiplied result: coverage, tone in about -1..1, and shading slope along u and v. Fades out
// as the cell nears the pixel, and no element is evaluated beyond that.
fn element_fade(shift:u32,footprint:f32,unit:f32)->f32{return 1.0-smoothstep(0.2,1.0,footprint/(unit*f32(1u<<shift)));}
fn chart_elements(pos:PagePos,shift:u32,seed:u32,density:f32,blade:bool,footprint:f32,unit:f32)->vec4<f32>{
 let size=f32(1u<<shift);let aa=footprint/(unit*size);if aa>=1.0{return vec4<f32>(0);}
 let cell=pos.g>>vec2<u32>(shift);let x=(vec2<f32>(pos.g&vec2<u32>((1u<<shift)-1u))+pos.frac)/size;
 var out=vec4<f32>(0);
 for(var j=-1;j<=1;j++){for(var i=-1;i<=1;i++){
  let c=vec2<u32>(vec2<i32>(cell)+vec2<i32>(i,j));
  let h=hash(c.x^hash(c.y^seed));if f32(h&255u)>density*255.0{continue;}
  let r=hash(h);let tone=f32(r>>24u)/127.5-1.0;
  let d=x-vec2<f32>(f32(i)+f32((h>>8u)&255u)/255.0,f32(j)+f32((h>>16u)&255u)/255.0);
  if blade{
   let dir=normalize(vec2<f32>(f32(r&255u)-127.0,f32((r>>8u)&255u)-127.0));
   let along=dot(d,dir);let across=d.y*dir.x-d.x*dir.y;let reach=0.7+f32((r>>16u)&255u)/255.0*0.6;
   if abs(along)>=reach{continue;}
   let width=0.08*(1.0-(along/reach)*(along/reach));
   let cover=1.0-smoothstep(width-aa*0.5,width+aa*0.5,abs(across));if cover<=0.01{continue;}
   let side=clamp(across/max(width,0.001),-1.0,1.0)*0.55;
   out=out*(1.0-cover)+vec4<f32>(1.0,tone,-dir.y*side,dir.x*side)*cover;
  }else{
   let radius=0.16+f32((r>>16u)&255u)/255.0*0.3;let q=length(d)/radius;let e=aa/radius;if q>=1.4+e{continue;}
   // The stone, domed for shading, and a contact shadow around it.
   let shadow=0.45*(1.0-smoothstep(1.0,1.4+e,q));
   out=out*(1.0-shadow)+vec4<f32>(1.0,-1.2,0.0,0.0)*shadow;
   let cover=1.0-smoothstep(1.0-e,1.0+e,q);
   out=out*(1.0-cover)+vec4<f32>(1.0,tone,d/radius*0.9)*cover;
  }
 }}
 return out*element_fade(shift,footprint,unit);
}
fn element_over(a:vec4<f32>,b:vec4<f32>)->vec4<f32>{return a*(1.0-b.x)+b;}
// Small craters for what the image does not resolve, over several sizes: a power law by size, as impacts have, so few large ones
// and many small. Each has its own age, and most are worn nearly flat: a fresh sharp bowl is the exception. Their slope goes to the
// shading, as the rest of the material's does: no mesh, shadow or collision reads it. x unused; y tone; zw slope.
fn measured_craters(pos:PagePos,seed:u32,footprint:f32,unit:f32,density:f32)->vec4<f32>{
 var out=vec4<f32>(0);var shift=15u;
 for(var level=0u;level<6u;level++){
  let size=unit*f32(1u<<shift);let aa=footprint/size;
  // Only sizes between a pixel and what the image shows on its own.
  let keep=(1.0-smoothstep(0.2,0.9,aa))*(1.0-smoothstep(0.6,2.4,size/max(field_albedo_cell,1e-3)));
  if keep>0.001{
   let cell=pos.g>>vec2<u32>(shift);let x=(vec2<f32>(pos.g&vec2<u32>((1u<<shift)-1u))+pos.frac)/f32(1u<<shift);
   // Fewer in a cell the larger the size, and a varied radius, so that no size stands out as a pattern.
   let chance=density*mix(0.5,1.0,f32(level)/5.0);
   for(var j=-1;j<=1;j++){for(var i=-1;i<=1;i++){
    let c=vec2<u32>(vec2<i32>(cell)+vec2<i32>(i,j));
    let h=hash(c.x^hash(c.y^(seed+shift*31u+90u)));if f32(h&255u)>chance*255.0{continue;}
    let r=hash(h);let spread=f32((r>>16u)&255u)/255.0;let radius=0.07+spread*spread*spread*0.5;
    let d=x-vec2<f32>(f32(i)+f32((h>>8u)&255u)/255.0,f32(j)+f32((h>>16u)&255u)/255.0);
    let q=length(d)/radius;if q>=1.9||q<=1e-4{continue;}
    // Age: a cube of a uniform number, so that most are old. Depth falls with it, and the rim softens into the ground.
    let fresh_raw=f32(r&255u)/255.0;let fresh=0.22+0.78*fresh_raw*fresh_raw;
    let dir=d/(q*radius);
    let edge=0.16+0.34*(1.0-fresh);
    let inside=1.0-smoothstep(1.0-edge,1.0+edge*0.4,q);let outside=smoothstep(1.0-edge*0.2,1.0+edge,q)*(1.0-smoothstep(1.25,1.9,q));
    let slope=(q*0.34*inside-0.17*outside)*keep*fresh;
    // Tone from what the digging exposed: only a fresh crater shows it, a little, and old ones have gone back to the ground's.
    let tone=(-0.05*inside*(1.0-q*q)+0.05*exp(-pow((q-1.1)/0.2,2.0)))*keep*fresh;
    out=vec4<f32>(0,out.y+tone,out.zw+dir*slope);
   }}
  }
  if shift<3u{break;}shift-=2u;
 }
 return out;
}
// Unit tangents of the chart at a point: where element slopes point on the body.
fn chart_tangents(face:u32,uv:vec2<f32>)->mat2x3<f32>{
 let tu=page_gradient(face,uv,1.0,0.0);let tv=page_gradient(face,uv,0.0,1.0);return mat2x3<f32>(normalize(tu),normalize(tv));
}
// The ground's colour: imagery, refined with procedural structure down to centimetres. Classes come from
// the image's own colour until land cover exists: a heuristic, and synthesized content. Each factor has a
// mean near one, so that filtering the result to the image's cell returns about the image. Only what the
// image does not resolve and what the pixel can show is added.
fn measured_surface_albedo(point:vec3<f32>,height:f32,slope:f32,footprint:f32)->vec3<f32>{
 field_material_bump=vec3<f32>(0);let a=surface_address(point);let hi=a.hi;let lo=a.lo;let material=f.field_serial.w!=0u;
 var warped=lo;if material{warped=lo+material_warp(hi,lo,measured_albedo_cell(hi,lo,footprint),footprint);}
 var base=measured_albedo(hi,warped,footprint);
 let pos=page_pos(hi,lo);let steep=1.0-smoothstep(0.72,0.93,slope);
 let sum=max(0.0005,base.r+base.g+base.b);let luma=sum/3.0;let share=base/sum;
 var green=smoothstep(0.35,0.39,share.g)*smoothstep(1.02,1.2,base.g/max(base.b,0.0005));
 var snow=smoothstep(0.32,0.55,luma)*(1.0-smoothstep(0.02,0.07,max(share.r,max(share.g,share.b))-0.3334));
 // Reading the image's colour for vegetation and snow is Earth's. A grey lunar highland is not snow.
 let ground_kind=f.solar.w;if ground_kind>0.5{green=0.0;snow=0.0;}
 // Over the sea the image shows water, not what lies under it. Below the surface use sediment and rock.
 // While water fades in, its bed follows late, so that the ground does not flash to bare sediment first.
 // Dry ground stands at least half a metre above any water that could reach it, so it never takes this.
 let unseen=1.0-measured_water_image(footprint*select(1.0,0.25,water_diagnostic(262144u)));
 // Whether water stands here, read once: the bed below and the water pass both take this answer, or bare bed shows with no water over it. Three levels finer than the footprint picks, eight times its
 // resolution, as a coarse height tile cannot hold a lake: Lake Geneva reads a flat 371 m down to z9, 369 to 372 at z7 and 323 to 386 at z6, and the page level then drew a straight edge across the water.
 // The rings keep such finer pages far past where any pixel needs them. Beyond the mesh's reach the page's own height, not the mesh's: those two can disagree by metres.
 let finer=footprint*0.125;let entry=measured_water_entry(pos,finer);var level=f.planet.y;var near=0.0;var settled=1.0;var under=0.0;field_water_here=0.0;
 let lw=water_layer_entry(entry,pos.face,pos.g);
 if lw!=0u{
  // The water layer: water where the map has it, at its level; the share of the pixel it covers from the distance,
  // and only on ground at or under the level: a wall's face beside the water lies at the shore horizontally but metres
  // over it, and took the water's shading up the wall. A far pixel spans some of the ground's rise, so the level test
  // widens with the footprint, bounded, as the excess texels' did.
  let w=water_layer_at(lw,pos);level=w.level;
  if level>WATER_NONE{
   near=1.0;let fade=measured_water_fade(pos,finer);settled=fade*fade;
   let rise=min(0.5*footprint*sqrt(max(1.0-slope*slope,0.0))/max(slope,0.1),2.0);let depth=level-height;
   let c=water_layer_coverage(w,footprint)*smoothstep(-0.05-rise,0.05+rise,depth);
   field_water_here=c*fade;under=c*smoothstep(-0.02,0.15,depth)*settled*unseen;
  }
 }else if entry!=0u&&page_water_texels(entry){
  // A page with water texels: its excess is the depth, with no cells. The rise a far pixel spans covers it in proportion,
  // centred on the shore, so water never climbs a slope beyond half a pixel and a channel keeps its width. Close up the
  // ground shown and the page must both put the point under water: while a mesh still morphs toward its pages, neither
  // ground below the level nor a coarse bump over the channel makes water of its own.
  let s=page_water_read(entry,pos.face,pos.g,pos.frac);level=s.x;
  if s.y>WATER_EXCESS_NONE{
   let trust=measured_water_trust(footprint);let depth=mix(min(level-height,s.y),s.y,trust);
   near=1.0;let fade=measured_water_fade(pos,finer);settled=fade*fade;
   let rise=min(0.5*footprint*sqrt(max(1.0-slope*slope,0.0))/max(slope,0.1),2.0);
   field_water_here=smoothstep(-0.05-rise,0.05+rise,depth)*fade;
   under=smoothstep(-0.02,0.15,depth)*settled*unseen;
  }else{level=WATER_NONE;}
 }else if entry!=0u{
  level=page_water(entry,pos.face,pos.g);
  if level>WATER_NONE{
   let trust=measured_water_trust(footprint);var bed=height;if trust>0.0{bed=mix(height,page_height_read(entry,pos.g,pos.frac).x,trust);}
   let depth=level-bed;
   // A level cell reaches past a dam or an outlet, over ground far below any lake's bed. That ground is dry.
   if level-f.planet.y<8.0||depth<=LAKE_DEEPEST{
    near=page_water_near(pos.face,entry,pos.g);let fade=measured_water_fade(pos,finer);settled=fade*fade;
    // A far pixel spans some of the ground's rise, and is that much covered: a hard edge would be a staircase at a grazing angle. Bounded, since a pixel's footprint overstates its share of a slope facing the
    // eye. Close up, water that stands is what lies under the level, and the fringe above it stays bare beach.
    let reach=min(footprint*sqrt(max(1.0-slope*slope,0.0))/max(slope,0.1),8.0);
    field_water_here=smoothstep(-0.4*trust-reach,0.5+reach,depth)*near*fade;
    under=smoothstep(-0.4,0.5,depth)*settled*near*unseen;
   }
  }
 }
 let sand=vec3<f32>(0.36,0.31,0.23);let stone=vec3<f32>(0.20,0.19,0.17);
 base=mix(base,mix(sand,stone,steep),under);
 if !material{return base;}
 // Octaves from 8 m to 3 cm, each with its value and gradient already faded by its weight.
 var m:array<vec4<f32>,9>;var w:array<f32,9>;var scale=8.0;
 var coarse=vec3<f32>(0);var fine=vec3<f32>(0);
 for(var k=0u;k<9u;k++){
  w[k]=max(filter_weight(scale,footprint)-filter_weight(scale,field_albedo_cell),0.0);
  if w[k]>0.001{m[k]=noise_gradient(hi,lo,scale,bitcast<u32>(f.geo.z)+61u+k)*w[k];if k<4u{coarse+=m[k].xyz*scale;}else{fine+=m[k].xyz*scale;}}
  scale*=0.5;
 }
 let broad=m[0].w*0.2+m[1].w*0.22+m[2].w*0.24+m[3].w*0.26;
 let grit=m[4].w*0.28+m[5].w*0.32+m[6].w*0.34+m[7].w*0.32+m[8].w*0.28;
 let unit=f.planet.x*7.450580596923828e-9*page_metric(pos.uv);
 let seed=bitcast<u32>(f.geo.z)^(pos.face*0x9e3779b1u);
 // Bare ground: mottled soil with stones from 40 cm down to grit.
 var stones=chart_elements(pos,3u,seed+71u,0.12,false,footprint,unit);
 stones=element_over(stones,chart_elements(pos,2u,seed+72u,0.28,false,footprint,unit));
 stones=element_over(stones,chart_elements(pos,1u,seed+73u,0.5,false,footprint,unit));
 stones=element_over(stones,chart_elements(pos,0u,seed+74u,0.65,false,footprint,unit));
 var detail=vec3<f32>(exp(broad*1.0+grit*1.1)*(1.0+stones.y*0.55));
 var rc=0.05;var rf=0.07;var element=stones.zw;
 // Off Earth: gentler mottling, the small craters no image here resolves, and each body's own ground. Synthesized, like all of this.
 if ground_kind>0.5{
  let ice=ground_kind>2.5;
  detail=vec3<f32>(exp(broad*select(0.6,0.3,ice)+grit*select(0.85,0.35,ice))*(1.0+stones.y*select(0.5,0.22,ice)));
  rc=select(0.075,0.04,ice);rf=select(0.10,0.05,ice);
  if ground_kind<1.5||ice{
   let craters=measured_craters(pos,seed,footprint,unit,select(0.75,0.28,ice));
   detail*=1.0+craters.y;element=stones.zw*select(1.0,0.4,ice)+craters.zw;
  }
 }
 // Sand and sediment: fine speckle, a few shells, and ripples on an integer lattice, so that the phase
 // needs only the low part of the address and stays continuous across its cells.
 let sandy=under*(1.0-steep);
 if sandy>0.0{
  let shell=element_over(chart_elements(pos,1u,seed+75u,0.04,false,footprint,unit),chart_elements(pos,0u,seed+76u,0.12,false,footprint,unit));
  detail=mix(detail,vec3<f32>(exp(broad*0.55+grit*0.5)*(1.0+max(shell.y,-0.3*shell.x)*0.5)),sandy);rc=mix(rc,0.015,sandy);rf=mix(rf,0.03,sandy);element=mix(element,shell.zw,sandy);
  let ripple_weight=filter_weight(0.25,footprint);
  if ripple_weight>0.001{
   let lattice=vec3<f32>(1.0,2.0,1.0)/0.5;let phase=dot(lo,lattice)*6.2831853+(m[2].w+m[3].w*0.6)*3.0;
   detail*=1.0+(sin(phase)*0.5)*0.12*sandy*ripple_weight;
   field_material_bump+=lattice*cos(phase)*0.004*6.2831853*sandy*ripple_weight;
  }
 }
 // Rock: joints at three scales, facets, mineral speckle, layering with height, and a little lichen.
 // Ice breaks everywhere, not only where it is steep.
 let rock=select((1.0-green)*(1.0-snow)*steep,1.0,ground_kind>2.5);
 if rock>0.0{
  // Joints come in sets at set angles, here two sets at each of two scales and one fine one. A slow noise wanders each
  // line a little and a second one ends it, so that it is a crack and not a ruled line. Each set is lit only where its own gate is open.
  let gate_a=smoothstep(-0.06,0.14,m[0].w+m[2].w*0.6);let gate_b=smoothstep(-0.06,0.14,m[1].w-m[3].w*0.6);let gate_c=smoothstep(-0.05,0.12,m[3].w);let gate_d=smoothstep(-0.05,0.12,m[2].w-m[4].w);let gate_e=smoothstep(-0.05,0.12,m[5].w);
  // A family's planes lie its spacing over the normal's length apart: about 8.5 m, 2.1 m and 0.5 m here.
  let set_a=joint_family(lo,vec3<f32>(3.0,1.0,2.0),32.0,0.0,m[1].w*0.22,gate_a*w[0],footprint);
  let set_b=joint_family(lo,vec3<f32>(-1.0,2.0,3.0),32.0,0.37,m[2].w*0.22,gate_b*w[0],footprint);
  let set_c=joint_family(lo,vec3<f32>(2.0,-3.0,1.0),8.0,0.13,m[3].w*0.2,gate_c*w[2],footprint);
  let set_d=joint_family(lo,vec3<f32>(1.0,3.0,-2.0),8.0,0.71,m[4].w*0.2,gate_d*w[2],footprint);
  let set_e=joint_family(lo,vec3<f32>(3.0,2.0,-1.0),2.0,0.29,m[5].w*0.2,gate_e*w[4],footprint);
  let joints=1.0-0.42*set_a.x-0.42*set_b.x-0.34*set_c.x-0.34*set_d.x-0.26*set_e.x;
  let joint_mean=1.0+0.42*set_a.y*w[0]+0.42*set_b.y*w[0]+0.34*set_c.y*w[2]+0.34*set_d.y*w[2]+0.26*set_e.y*w[4];
  // Bedding follows height, slightly disturbed, and stays faint: a strong wander drew it in loops as well.
  let layers=sin(height*0.7+m[0].w*2.0+m[1].w*1.0)*max(w[0],w[1])*0.08;
  // Lichen as a soft, faint stain. The hard threshold it had drew pale patches like camouflage.
  let lichen=smoothstep(-0.05,0.6,m[3].w+m[5].w*0.6+m[7].w*0.3)*(1.0-smoothstep(1800.0,3200.0,height))*select(1.0,0.0,ground_kind>0.5);
  let rock_detail=joints*joint_mean*exp(broad*1.2+grit*0.9+layers)*mix(vec3<f32>(1.0),vec3<f32>(1.07,1.05,0.97),lichen);
  detail=mix(detail,rock_detail,rock*select(1.0,0.55,ground_kind>2.5));rc=mix(rc,0.11,rock);rf=mix(rf,0.11,rock);element=mix(element,vec2<f32>(0),rock*select(1.0,0.0,ground_kind>2.5));
 }
 // Vegetation: mottled light and shadow with drier and lusher patches, and blades with dark gaps close up.
 // Standing grass and canopy need geometry (M6); this stands in below it and carries the colour beyond it.
 if green>0.0{
  var blades=chart_elements(pos,2u,seed+81u,1.0,true,footprint,unit);
  blades=element_over(blades,chart_elements(pos,1u,seed+82u,1.0,true,footprint,unit));
  blades=element_over(blades,chart_elements(pos,0u,seed+83u,1.0,true,footprint,unit));
  blades=element_over(blades,chart_elements(pos,0u,seed+84u,1.0,true,footprint,unit));
  // A blade layer covers about a fifth of the ground. The dark between blades balances the light on
  // them at the expected coverage of the layers still present, which keeps the mean as they fade.
  let f2=element_fade(2u,footprint,unit);let f1=element_fade(1u,footprint,unit);let f0=element_fade(0u,footprint,unit);
  let expected=1.0-(1.0-0.21*f2)*(1.0-0.21*f1)*(1.0-0.21*f0)*(1.0-0.21*f0);
  let light=0.36;let gap=-light*expected/max(1.0-expected,0.001);
  let lush=clamp(0.5+broad*1.6+grit*0.5+blades.y*0.65,0.0,1.0);
  let leaf=exp(broad*1.0+grit*1.3)*(1.0+gap*(1.0-blades.x)+blades.x*light+blades.y*0.42);
  detail=mix(detail,leaf*mix(vec3<f32>(1.3,1.08,0.56),vec3<f32>(0.82,1.02,1.12),lush),green);rc=mix(rc,0.05,green);rf=mix(rf,0.09,green);element=mix(element,blades.zw,green);
 }
 // Snow keeps nearly its own colour, with wind-shaped relief.
 detail=mix(detail,vec3<f32>(exp(broad*0.1+grit*0.06)),snow);rc=mix(rc,0.03,snow);rf=mix(rf,0.012,snow);element=mix(element,vec2<f32>(0),snow);
 field_material_bump+=coarse*rc+fine*rf;
 if any(element!=vec2<f32>(0)){let t=chart_tangents(pos.face,pos.uv);field_material_bump+=t[0]*element.x+t[1]*element.y;}
 var albedo=base*max(detail,vec3<f32>(0.08));
 // Wet ground around the waterline, as on the procedural body.
 albedo*=1.0-0.35*exp(-abs(height-level)/2.0)*settled*near*unseen;
 return albedo;
}
// Data lag and provenance, per pixel. View 4 shows the level deficit (green none, red four or more)
// with blue where the pixel wants detail finer than any source supplies, so what shows there is
// synthesized. View 5 writes raw numbers for tests: served height and imagery levels plus one, and
// the wanted level plus 16.
fn measured_diagnostic(p:vec3<f32>,footprint:f32)->vec3<f32>{
 let a=surface_address(p);let pos=page_pos(a.hi,a.lo);
 let want=log2(f.planet.x/128.0*page_metric(pos.uv)/max(footprint,0.000001));
 let wh=clamp(want,0.0,f.field.y);let wa=clamp(want,0.0,f.field.z);
 let eh=page_entry(0u,pos.face,u32(ceil(wh)),pos.g);let ea=page_entry(1u,pos.face,u32(ceil(wa)),pos.g);
 let sh=f32(page_entry_level(eh))+select(0.0,1.0,eh!=0u);let sa=f32(page_entry_level(ea))+select(0.0,1.0,ea!=0u);
 if f.options.w==5.0{return vec3<f32>(sh,sa,want+16.0);}
 let deficit=max(max(wh+1.0-sh,0.0),max(wa+1.0-sa,0.0));
 return mix(vec3<f32>(0.0,0.6,0.0),vec3<f32>(1.0,0.0,0.0),clamp(deficit/4.0,0.0,1.0))+vec3<f32>(0.0,0.0,clamp(want-f.field.y,0.0,4.0)/4.0);
}
