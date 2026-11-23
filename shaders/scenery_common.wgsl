// Scenery window side, face capacity and total capacity come from the allocation tier.
fn sc_side()->i32{return i32(f.tier_a.z);}
fn sc_face_cap()->u32{return f.tier_a.z*f.tier_a.z;}
fn sc_cap()->u32{return 6u*f.tier_a.z*f.tier_a.z;}
struct ScInstance {key:vec4<u32>,hi:vec4<f32>,lo:vec4<f32>,shape:vec4<f32>,support:vec4<f32>,identity:vec4<u32>,contact:vec4<f32>}
@group(0) @binding(59) var<storage,read> sc_objects:array<ScInstance>;
// Shared procedural ecology and model/capture frames. No external assets.
// Frame/depth conventions informed by Pinionfall; see docs/SCENERY.md.
fn sc_random(seed:u32)->f32{return f32(hash(seed)>>8u)/16777216.0;}
fn sc_basis(up:vec3<f32>,yaw:f32)->mat3x3<f32>{
 let axis=select(vec3<f32>(0,0,1),vec3<f32>(1,0,0),abs(up.z)>0.95);
 let x=normalize(cross(up,axis));let z=cross(x,up);let c=cos(yaw);let s=sin(yaw);
 return mat3x3<f32>(x*c+z*s,up,z*c-x*s);
}
fn sc_view(v:vec3<f32>)->mat3x3<f32>{
 let a=abs(v);var axis=vec3<f32>(0,1,0);
 if a.x<min(a.y,a.z){axis=vec3<f32>(1,0,0);}else if a.z<a.y{axis=vec3<f32>(0,0,1);}
 let x=normalize(cross(axis,v));return mat3x3<f32>(x,cross(v,x),v);
}
fn sc_sign(v:vec2<f32>)->vec2<f32>{return select(vec2<f32>(-1),vec2<f32>(1),v>=vec2<f32>(0));}
fn sc_oct_encode(v:vec3<f32>)->vec2<f32>{let n=v/(abs(v.x)+abs(v.y)+abs(v.z));var q=n.xz;if n.y<0.0{q=(1.0-abs(q.yx))*sc_sign(q);}return q*0.5+0.5;}
fn sc_oct_decode(uv:vec2<f32>)->vec3<f32>{var q=uv*2.0-1.0;let y=1.0-abs(q.x)-abs(q.y);if y<0.0{q=(1.0-abs(q.yx))*sc_sign(q);}return normalize(vec3<f32>(q.x,y,q.y));}
fn sc_cell_dir(cell:vec2<i32>)->vec3<f32>{return sc_oct_decode((vec2<f32>(cell)+0.5)/8.0);}
// Physical fields in compensated canonical coordinates, continuous across charts.
// Whether a record's key holds the placement revision now in force. On a measured body the sixteen low bits
// are a token of the pages its placement read, so that a record follows what serves its cell, whatever came first.
// Keep the world revision in the upper bits: otherwise changing planets by one
// revision is swallowed by the page token and old placements remain current.
fn sc_placement_revision()->u32{return (f.numeric.w<<16u)^hash(bitcast<u32>(f.planet.y))^sc_showcase_key();}
fn sc_record_current(w:u32)->bool{
 let revision=sc_placement_revision();
 if field_measured(){return (w^revision)<65536u;}
 return w==revision;
}
// The species sheet's diagnostic: every record shows one variant (settings scenery_showcase); a change places all again.
fn sc_showcase_key()->u32{return select(0u,hash(u32(f.cover.w)+0x5ca1u),f.cover.w>0.5);}
const SC_SPECIES:u32=15u;
const SC_SPRUCE:u32=0u;const SC_PINE:u32=1u;const SC_LARCH:u32=2u;const SC_OAK:u32=3u;const SC_BEECH:u32=4u;const SC_MAPLE:u32=5u;const SC_BIRCH:u32=6u;const SC_POPLAR:u32=7u;
const SC_WILLOW:u32=8u;const SC_ALDER:u32=9u;const SC_PALM:u32=10u;const SC_ACACIA:u32=11u;const SC_SHRUB:u32=12u;const SC_SNAG:u32=13u;const SC_LOG:u32=14u;const SC_FERN_LAYER:u32=15u;
// ---- Species. Proportions are fractions of the tree's height; the instance size is its height in metres.
// kind: 0 excurrent (leader to the top), 1 decurrent (trunk forks into limbs), 2 palm, 3 multi-stem shrub, 4 snag, 5 fallen log.
// shape: crown envelope after Weber & Penn: 0 conical, 1 spherical, 2 hemispherical, 3 cylindrical, 4 tapered cylindrical,
// 5 flame, 6 inverse conical, 7 umbrella (flat top). leaf: card content (sc_leaf_layer). bark: sc_bark pattern.
struct ScSpecies {
 height:f32,radius:f32,trunk:f32,base:f32,width:f32,shape:u32,limbs:f32,whorl:f32,
 angle0:f32,angle1:f32,rise:f32,droop:f32,b_angle:f32,b_len:f32,b_droop:f32,t_len:f32,
 gnarl:f32,leaf:u32,card:f32,card_order:u32,bark:u32,kind:u32,lean:f32,dead:f32,
 bark_color:vec3<f32>,leaf_color:vec3<f32>,translucency:f32,
}
const LF_NONE:u32=0u;const LF_SPRAY:u32=1u;const LF_BUNDLE:u32=2u;const LF_TUFT:u32=3u;const LF_OVATE:u32=4u;const LF_LOBED:u32=5u;const LF_PALMATE:u32=6u;const LF_BIRCH:u32=7u;
const LF_DELTOID:u32=8u;const LF_LANCE:u32=9u;const LF_ROUND:u32=10u;const LF_FROND:u32=11u;const LF_BIPINNATE:u32=12u;const LF_SMALL:u32=13u;const LF_FERN:u32=14u;
const BK_SCALY:u32=0u;const BK_PLATED:u32=1u;const BK_FURROWED:u32=2u;const BK_SMOOTH:u32=3u;const BK_PAPERY:u32=4u;const BK_RINGED:u32=5u;const BK_DEAD:u32=6u;const BK_SHRUB:u32=7u;
fn sc_species_base(s:u32)->ScSpecies{
 switch s{
  case 0u:{return ScSpecies(24.0,0.018,1.0,0.08,0.27,0u,46.0,5.0, 1.78,1.05,0.06,0.30,0.95,0.42,0.40,0.38, 0.02,LF_SPRAY,1.25,1u,BK_SCALY,0u,0.01,0.08, vec3<f32>(0.10,0.075,0.06),vec3<f32>(0.022,0.050,0.028),0.15);}
  case 1u:{return ScSpecies(22.0,0.020,1.0,0.52,0.23,1u,18.0,4.0, 1.45,0.95,0.30,0.10,0.80,0.50,0.02,0.45, 0.06,LF_BUNDLE,1.1,1u,BK_PLATED,0u,0.03,0.10, vec3<f32>(0.13,0.08,0.055),vec3<f32>(0.034,0.068,0.026),0.15);}
  case 2u:{return ScSpecies(24.0,0.017,1.0,0.2,0.22,0u,32.0,0.0, 1.55,1.05,0.10,0.22,0.90,0.45,0.30,0.40, 0.03,LF_TUFT,1.0,1u,BK_FURROWED,0u,0.01,0.06, vec3<f32>(0.15,0.09,0.07),vec3<f32>(0.066,0.125,0.034),0.30);}
  case 3u:{return ScSpecies(20.0,0.036,0.45,0.24,0.50,2u,9.0,0.0, 1.15,0.55,0.35,0.28,0.85,0.60,0.05,0.42, 0.15,LF_LOBED,1.35,3u,BK_FURROWED,1u,0.02,0.05, vec3<f32>(0.13,0.11,0.09),vec3<f32>(0.040,0.080,0.024),0.35);}
  case 4u:{return ScSpecies(26.0,0.025,0.62,0.30,0.38,1u,12.0,0.0, 0.95,0.50,0.40,0.10,0.80,0.55,0.08,0.45, 0.05,LF_OVATE,1.30,3u,BK_SMOOTH,1u,0.01,0.03, vec3<f32>(0.24,0.23,0.21),vec3<f32>(0.055,0.100,0.028),0.45);}
  case 5u:{return ScSpecies(18.0,0.028,0.55,0.26,0.42,1u,11.0,0.0, 0.85,0.45,0.45,0.08,0.75,0.55,0.05,0.45, 0.06,LF_PALMATE,1.35,3u,BK_SMOOTH,1u,0.02,0.03, vec3<f32>(0.17,0.15,0.13),vec3<f32>(0.060,0.110,0.025),0.45);}
  case 6u:{return ScSpecies(17.0,0.016,0.92,0.30,0.25,5u,16.0,0.0, 0.80,0.50,0.30,0.15,0.70,0.50,0.45,0.50, 0.07,LF_BIRCH,0.95,3u,BK_PAPERY,0u,0.04,0.05, vec3<f32>(0.62,0.60,0.56),vec3<f32>(0.070,0.120,0.030),0.50);}
  case 7u:{return ScSpecies(26.0,0.020,1.0,0.07,0.11,4u,30.0,0.0, 0.38,0.26,0.60,0.00,0.40,0.42,0.00,0.40, 0.03,LF_DELTOID,0.95,2u,BK_FURROWED,0u,0.01,0.04, vec3<f32>(0.20,0.19,0.16),vec3<f32>(0.050,0.100,0.030),0.40);}
  case 8u:{return ScSpecies(14.0,0.040,0.36,0.26,0.55,2u,8.0,0.0, 0.90,0.50,0.50,0.15,0.60,0.75,1.60,0.50, 0.12,LF_LANCE,1.05,2u,BK_FURROWED,1u,0.04,0.04, vec3<f32>(0.14,0.12,0.09),vec3<f32>(0.090,0.120,0.055),0.45);}
  case 9u:{return ScSpecies(16.0,0.020,0.88,0.30,0.26,5u,16.0,0.0, 1.10,0.70,0.20,0.12,0.80,0.50,0.10,0.45, 0.05,LF_ROUND,1.05,3u,BK_SMOOTH,0u,0.02,0.05, vec3<f32>(0.15,0.14,0.13),vec3<f32>(0.035,0.070,0.022),0.35);}
  case 10u:{return ScSpecies(13.0,0.022,1.0,0.94,0.32,2u,16.0,0.0, 1.20,0.35,0.30,0.95,0.00,0.00,0.00,0.00, 0.00,LF_FROND,0.95,1u,BK_RINGED,2u,0.12,0.00, vec3<f32>(0.25,0.20,0.15),vec3<f32>(0.060,0.110,0.030),0.40);}
  case 11u:{return ScSpecies(8.0,0.035,0.40,0.40,0.62,7u,7.0,0.0, 0.70,0.60,0.25,0.00,1.20,0.60,-0.10,0.40, 0.12,LF_BIPINNATE,1.05,3u,BK_FURROWED,1u,0.03,0.04, vec3<f32>(0.17,0.13,0.10),vec3<f32>(0.070,0.100,0.035),0.30);}
  case 12u:{return ScSpecies(2.6,0.030,0.20,0.00,0.62,1u,6.0,0.0, 0.50,0.30,0.30,0.10,0.80,0.60,0.10,0.50, 0.10,LF_SMALL,0.55,2u,BK_SHRUB,3u,0.00,0.04, vec3<f32>(0.12,0.09,0.07),vec3<f32>(0.050,0.090,0.030),0.40);}
  case 13u:{return ScSpecies(14.0,0.025,0.85,0.35,0.20,0u,10.0,0.0, 1.30,1.00,0.05,0.10,0.90,0.30,0.00,0.30, 0.08,LF_NONE,0.00,9u,BK_DEAD,4u,0.03,1.00, vec3<f32>(0.32,0.30,0.28),vec3<f32>(0.0),0.0);}
  default:{return ScSpecies(14.0,0.028,1.0,0.00,0.10,0u,5.0,0.0, 1.40,1.40,0.00,0.00,0.90,0.20,0.00,0.20, 0.03,LF_NONE,0.00,9u,BK_DEAD,5u,0.00,1.00, vec3<f32>(0.20,0.16,0.12),vec3<f32>(0.0),0.0);}
 }
}
// ---- Ecology (docs/SCENERY.md, "Placement"). Climate: a mean annual temperature from latitude (the body's rotation axis
// is y) and altitude with a 6.5 K/km lapse rate, and moisture from broad and regional noise. The procedural planet is a
// little warmer than Earth (29 C at the equator, 11 C at the bookmarks' 59 degrees) so its mid latitudes carry mixed
// forest; real Earth uses 27 C - 0.0062 lat^2. On real Earth the imagery colour still decides where trees stand, and the
// water layer, slope, altitude and that temperature (a treeline varying with latitude) decide where they may not.
struct ScEco {trees:f32,rocks:f32,wet:f32,temp:f32,moist:f32,age:f32,water:f32,still:f32,coast:f32,ejecta:f32,crater:f32,rock_ok:f32,stand:f32,clearing:f32,geo:f32,conifer:f32,green:f32}
fn sc_eco_none()->ScEco{return ScEco(0.0,0.0,0.0,10.0,0.5,0.5,1e6,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0);}
fn sc_bump(x:f32,a:f32,b:f32,c:f32)->f32{return smoothstep(a,b,x)*(1.0-smoothstep(b,c,x));}
fn sc_latitude(hi:vec3<f32>,lo:vec3<f32>)->f32{let n=normalize(hi+lo);return asin(clamp(n.y,-1.0,1.0))*57.29578;}
// Fresh craters of the material's own lattice (surface_field.wgsl measured_craters, same hash and sizes): weight of
// their ejecta blanket and rim at this point, and the crater's diameter in metres.
fn sc_crater_ejecta(pos:PagePos)->vec2<f32>{
 let unit=f.planet.x*7.450580596923828e-9*page_metric(pos.uv);let seed=bitcast<u32>(f.geo.z)^(pos.face*0x9e3779b1u);
 let ice=f.solar.w>2.5;let density=select(0.75,0.28,ice);var best=0.0;var diameter=0.0;
 for(var level=1u;level<=3u;level++){
  let shift=15u-2u*level;let cell=pos.g>>vec2<u32>(shift);let x=(vec2<f32>(pos.g&vec2<u32>((1u<<shift)-1u))+pos.frac)/f32(1u<<shift);
  let chance=density*mix(0.5,1.0,f32(level)/5.0);
  for(var j=-1;j<=1;j++){for(var i=-1;i<=1;i++){
   let c=vec2<u32>(vec2<i32>(cell)+vec2<i32>(i,j));let h=hash(c.x^hash(c.y^(seed+shift*31u+90u)));if f32(h&255u)>chance*255.0{continue;}
   let r=hash(h);let spread=f32((r>>16u)&255u)/255.0;let radius=0.07+spread*spread*spread*0.5;
   let d=x-vec2<f32>(f32(i)+f32((h>>8u)&255u)/255.0,f32(j)+f32((h>>16u)&255u)/255.0);let q=length(d)/radius;
   let fresh_raw=f32(r&255u)/255.0;let fresh=0.22+0.78*fresh_raw*fresh_raw;let f3=fresh*fresh*fresh;
   let w=f3*(smoothstep(0.75,1.0,q)*(1.0-smoothstep(1.15,2.8,q))+0.6*smoothstep(0.4,0.9,q)*(1.0-smoothstep(0.92,1.0,q)));
   if w>best{best=w;diameter=2.0*radius*f32(1u<<shift)*unit;}
  }}
 }
 return vec2<f32>(clamp(best,0.0,1.0),diameter);
}
fn sc_eco(hi:vec3<f32>,lo:vec3<f32>,height:f32,slope:f32)->ScEco{
 var e=sc_eco_none();let seed=bitcast<u32>(f.geo.z);let sea=f.planet.y;
 e.wet=noise_gradient(hi,lo,8192.0,seed+813u).w;e.stand=noise_gradient(hi,lo,512.0,seed+814u).w;e.clearing=noise_gradient(hi,lo,64.0,seed+815u).w;e.geo=noise_gradient(hi,lo,2048.0,seed+816u).w;
 let lat=sc_latitude(hi,lo);
 // Bodies without plants: rocks only, from crater ejecta, steep ground and a little everywhere.
 if f.solar.w>0.5{
  e.rock_ok=1.0;e.moist=0.5+0.5*e.wet;
  if f.solar.w<1.5||f.solar.w>2.5{let c=sc_crater_ejecta(page_pos(hi,lo));e.ejecta=c.x;e.crater=c.y;}
  else{e.ejecta=0.35*smoothstep(0.25,0.75,e.geo+0.3*e.clearing);}
  return e;
 }
 let continental=noise_gradient(hi,lo,600000.0,seed+817u).w;
 e.moist=clamp(0.55+0.38*e.wet+0.3*continental,0.0,1.0);
 e.temp=select(29.0-0.0052*lat*lat-0.0065*max(height-sea,0.0),27.0-0.0062*lat*lat-0.0065*max(height,0.0),field_measured());
 let age_field=noise_gradient(hi,lo,1400.0,seed+818u).w;
 // Stands differ in age; at their edges and in clearings trees are younger.
 e.age=clamp(0.55+0.6*age_field-0.35*(1.0-smoothstep(-0.7,-0.2,e.clearing)),0.0,1.0);
 e.coast=1.0-smoothstep(sea+1.5,sea+25.0,height);
 e.water=max(height-sea,0.0)/max(sqrt(max(1.0-slope*slope,0.0)),0.04);
 e.rock_ok=1.0;
 let climate=smoothstep(-2.0,1.5,e.temp)*mix(0.3,1.0,smoothstep(0.12,0.4,e.moist));
 let rocks=(0.025+0.4*smoothstep(0.05,0.55,e.geo+e.clearing*0.7)+0.3*(1.0-smoothstep(0.65,0.9,slope)))*(1.0-smoothstep(5000.0,6500.0,height));
 if field_measured(){
  // Nothing grows until real imagery and heights have arrived here, so props appear once instead of being placed from
  // a coarse page and removed when a sharper one disagrees.
  // The water layer first: distance to the nearest water edge (negative in water), and whether that water is still or
  // slow. Ground cover reads it even where imagery has not arrived.
  let pos=page_pos(hi,lo);e.green=0.35;
  let entry=measured_water_entry(pos,2.0);if entry!=0u{let we=water_layer_entry(entry,pos.face,pos.g);if we!=0u{let w=water_layer_at(we,pos);e.water=w.sdf;e.still=select(0.0,1.0,w.kind==2u||(w.kind==3u&&length(w.flow)<0.35));if w.level>WATER_NONE&&height<w.level+0.6{e.water=min(e.water,0.0);}}}
  if page_entry_level(page_entry(1u,pos.face,min(10u,u32(f.field.z)),pos.g))<9u||page_entry_level(page_entry(0u,pos.face,min(11u,u32(f.field.y)),pos.g))<min(11u,u32(f.field.y)){return e;}
  if height<measured_water_level(pos,1.0)+1.0{e.water=min(e.water,0.0);return e;}
  let dry=smoothstep(0.0005,0.003,length(measured_footprint(pos,48.0).gradient));
  let c=measured_albedo_at(pos,48.0);let sum=max(0.001,c.r+c.g+c.b);let luma=sum/3.0;
  let hue=smoothstep(0.35,0.40,c.g/sum)*smoothstep(1.05,1.25,c.g/max(c.b,0.001));
  let green=hue*(1.0-smoothstep(0.05,0.12,luma));
  let bare=(1.0-hue)*smoothstep(0.08,0.2,luma)*(1.0-smoothstep(0.45,0.7,luma));
  // Green in the image, dark or light: forest or meadow. Grass grows where it is, not on roofs and roads.
  e.green=hue*(1.0-smoothstep(0.2,0.35,luma));
  // Darker, bluer canopies in imagery are more often needle-leaved.
  e.conifer=(1.0-smoothstep(0.025,0.06,luma))*0.7;
  let altitude=smoothstep(f.planet.y+3.0,f.planet.y+20.0,height)*smoothstep(-2.0,1.5,e.temp);
  e.trees=dry*green*altitude*smoothstep(0.68,0.88,slope)*smoothstep(2.0,5.0,e.water);
  e.rocks=dry*0.15*bare*rocks*smoothstep(0.0,1.0,e.water);
  return e;
 }
 let forest=smoothstep(-0.45,0.22,e.stand+e.wet*0.35)*smoothstep(-0.7,-0.15,e.clearing);
 // Palms on warm coasts, but only on dry ground.
 let altitude=smoothstep(sea+3.0,sea+20.0,height)+e.coast*smoothstep(18.0,24.0,e.temp)*0.6*smoothstep(sea+0.5,sea+1.5,height);
 e.trees=forest*min(altitude,1.0)*climate*smoothstep(0.68,0.88,slope);
 e.rocks=rocks;
 return e;
}
// How much each species belongs here (relative weights).
fn sc_species_weight(s:u32,e:ScEco)->f32{
 let T=e.temp;let M=e.moist;let near=1.0-smoothstep(3.0,30.0,e.water);let edge=1.0-smoothstep(-0.7,-0.2,e.clearing);let con=e.conifer;
 switch s{
  case 0u:{return sc_bump(T,-2.0,4.0,12.0)*(0.4+M)*(1.0+con*2.0);}
  case 1u:{return sc_bump(T,-1.0,8.0,22.0)*(1.3-M)*0.9*(1.0+con*1.5);}
  case 2u:{return sc_bump(T,-3.0,2.0,9.0)*0.6*(1.0+con);}
  case 3u:{return sc_bump(T,6.0,14.0,24.0)*sc_bump(M,0.15,0.5,0.98)*1.2*(1.0-con);}
  case 4u:{return sc_bump(T,6.0,11.0,17.0)*smoothstep(0.45,0.7,M)*(1.0-con);}
  case 5u:{return sc_bump(T,5.0,11.0,18.0)*smoothstep(0.35,0.6,M)*0.8*(1.0-con);}
  case 6u:{return sc_bump(T,-2.0,6.0,14.0)*0.7*(1.0+edge*1.5);}
  case 7u:{return sc_bump(T,6.0,14.0,24.0)*(0.08+near*1.4);}
  case 8u:{return sc_bump(T,4.0,14.0,26.0)*near*e.still*2.6;}
  case 9u:{return sc_bump(T,1.0,9.0,18.0)*near*1.6;}
  case 10u:{return smoothstep(17.0,22.0,T)*(e.coast*2.5+0.25*M);}
  case 11u:{return smoothstep(18.0,23.0,T)*(1.0-smoothstep(0.25,0.45,M))*1.6;}
  case 12u:{return 0.10+0.35*edge+0.6*(1.0-smoothstep(-1.0,4.0,T))+0.4*(1.0-smoothstep(0.2,0.4,M));}
  default:{return 0.03+0.05*e.age;}
 }
}
// A stand favours a few species: neighbours tend to be alike, stands differ.
fn sc_pick_species(e:ScEco,seed:u32)->u32{
 let stand=u32(floor((e.stand+1.0)*3.0))*7u+u32(floor(e.age*3.0))*3u+u32(floor((e.wet+1.0)*2.0));
 var w:array<f32,15>;var total=0.0;
 for(var s=0u;s<15u;s++){var x=sc_species_weight(s,e);if x>0.0&&s<12u{x*=select(1.0,3.5,sc_random(hash(stand*131u+s+bitcast<u32>(f.geo.z)))<0.3);}w[s]=x;total+=x;}
 if total<=0.0{return SC_SHRUB;}
 let r=sc_random(seed+70u)*total;var acc=0.0;
 for(var s=0u;s<15u;s++){acc+=w[s];if r<acc{return s;}}
 return SC_SHRUB;
}
fn sc_pick_age(e:ScEco,seed:u32,ages:u32)->u32{if ages<=1u{return 0u;}let a=clamp(e.age+(sc_random(seed+71u)-0.5)*0.9,0.0,0.999);return u32(a*f32(ages));}
// Rock family from the ground: cobbles by water, talus and blocks on steep ground, slabs where the bedrock is sedimentary,
// granite boulders elsewhere.
fn sc_pick_rock(e:ScEco,seed:u32,slope:f32)->u32{
 let r=sc_random(seed+72u);
 if e.water<6.0&&r<0.75{return 2u;}
 if slope<0.8{if r<0.5{return 4u;}if r<0.8{return 0u;}return 1u;}
 if e.geo>0.2{return select(1u,0u,r<0.3);}
 if e.geo<-0.25{return select(3u,0u,r<0.25);}
 return select(select(3u,1u,r<0.6),0u,r<0.35);
}
@group(0) @binding(62) var prop_material:texture_2d<f32>;
// Props are lit here: tags below -100 (bark -101, leaves and grass -102 less half their translucency, rock -103,
// buildings -104). Leaves take wrapped diffuse light on the side facing the sun and transmitted light through it when
// the sun is behind them, tinted by the leaf; neither glows at night.
@compute @workgroup_size(8,8)
fn scenery_shade(@builtin(global_invocation_id) id:vec3<u32>){
 if any(id.xy>=vec2<u32>(f.view.xy)){return;}let xy=vec2<i32>(id.xy);let normal=textureLoad(normals,xy,0);if normal.w>= -100.0{return;}
 if normal.w== -110.0{textureStore(shade_out,xy,vec4<f32>(textureLoad(prop_material,xy,0).rgb,1));return;}
 let p=textureLoad(positions,xy,0).xyz;let radial=normalize(f.eye_hi.xyz+f.eye_lo.xyz+p);let n=normalize(normal.xyz);let material=textureLoad(prop_material,xy,0);
 let leaf=normal.w<= -102.0&&normal.w> -103.0;let transl=select(0.0,clamp((-102.0-normal.w)/0.45,0.0,1.0),leaf);
 let ndl=dot(n,f.sun.xyz);
 let direct=select(max(0.0,ndl),0.3*max(ndl+0.5,0.0)/1.5+0.7*max(ndl,0.0),leaf);
 let through=transl*max(0.0,-ndl)*0.85;
 // Surfaces facing away from the sun receive no direct light; skip their visibility query. The highlight is gated the
 // same way, which removes a physically wrong glint on back-facing bark and stone.
 var visibility=SunVisibility(0.0,1.0,0.0);
 if direct>0.0||through>0.0||sf.control.y>0.0{visibility=sunlight(p,n,max(0.01,length(p)*2.0*f.view.w/f.view.y));}
 let horizon=sun_direct(visibility);
 let wet=select(1.0,0.65,sc_radial_height(p)<f.planet.y+0.5&&f.solar.w<0.5);
 let view=normalize(-p);let half_vector=normalize(view+f.sun.xyz);let roughness=clamp(material.a*wet,0.3,1.0);let specular=pow(max(0.0,dot(n,half_vector)),mix(96.0,6.0,roughness))*0.035*(1.0-roughness*0.7)*horizon*select(0.0,1.0,direct>0.0);
 var body=material.rgb;
 // A measured body's canopy follows the imagery under it. The image already averages lit crowns and the
 // shade between them, so a crown is somewhat brighter than the image; 0.037, 0.09, 0.018 is the mean leaf.
 if leaf&&field_measured()&&f.solar.w<0.5{let under=surface_address(p);body*=clamp(measured_albedo(under.hi,under.lo,48.0)*1.4/vec3<f32>(0.037,0.09,0.018),vec3<f32>(0.4),vec3<f32>(1.6));}
 let ambient=vec3<f32>(0.19,0.24,0.29)*f.body_detail.yzw*f.solar.y*(0.55+0.45*clamp(dot(n,radial)*0.5+0.5,0.0,1.0));
 var color=vec3<f32>(specular)+body*wet*(ambient*daylight(radial)+vec3<f32>(1.8,1.55,1.3)*f.starlight.xyz*(direct+through*vec3<f32>(1.15,1.3,0.55))*horizon);
 color=sun_diagnostic(color,visibility);
 if f.options.w==1.0{color=n*0.5+0.5;}if f.options.w==2.0{color=select(vec3<f32>(0.6,0.4,0.2),vec3<f32>(0.1,0.8,0.2),leaf);}if f.options.w==3.0{color=vec3<f32>(log2(1.0+length(p))/24.0);}
 textureStore(shade_out,xy,vec4<f32>(color,1));
}

// Stable height of a camera-relative prop pixel for existing water optics.
fn sc_radial_height(p:vec3<f32>)->f32{let radius=f.planet.x+f.eye_hi.w;let radial=normalize(f.eye_hi.xyz+f.eye_lo.xyz);let d=2.0*radius*dot(p,radial)+dot(p,p);return f.eye_hi.w+d/(sqrt(max(1.0,radius*radius+d))+radius);}

fn sc_cell_hash(face:u32,x:u32,y:u32)->u32{return hash(x^hash(y^hash(face^bitcast<u32>(f.geo.z)^0x53540001u)));}
fn sc_face_project(face:u32,p:vec3<f32>)->vec3<f32>{switch face{case 0u:{return vec3<f32>(-p.z,p.y,p.x);}case 1u:{return vec3<f32>(p.z,p.y,-p.x);}case 2u:{return vec3<f32>(p.x,-p.z,p.y);}case 3u:{return vec3<f32>(p.x,p.z,-p.y);}case 4u:{return vec3<f32>(p.x,p.y,p.z);}default:{return vec3<f32>(-p.x,p.y,-p.z);}}}

// One fixed candidate per 2x2 block owns a slot on the opposite cube face.
// Both poles of an axis cannot face the camera together. This extends the
// outer population to twice the radius with the existing allocation, and its
// owners keep the exact same slots when they enter the dense near window.
fn sc_outer_offset(face:u32,block:vec2<i32>)->vec2<i32>{
 let h=hash(u32(block.x)^u32(block.y)*0x9e3779b9u^face);
 return vec2<i32>(i32(h&1u),i32((h>>1u)&1u));
}
fn sc_outer_cell(face:u32,c:vec2<i32>)->bool{return all((c&vec2<i32>(1))==sc_outer_offset(face,c/2));}
fn sc_cell_slot(face:u32,c:vec2<i32>)->u32{
 let outer=sc_outer_cell(face,c);let residue=select(c,c/2,outer)%vec2<i32>(sc_side());
 return (face^u32(outer))*sc_face_cap()+u32(residue.y)*u32(sc_side())+u32(residue.x);
}
fn sc_window_weights(key:vec3<u32>)->vec2<f32> {
 let eye=f.eye_hi.xyz+f.eye_lo.xyz;let chart=sc_face_project(key.x,eye);if chart.z<length(eye)*0.45{return vec2<f32>(0);}
 let center=(chart.xy/chart.z*0.5+0.5)*524288.0;
 let ring=max(abs(f32(key.y)-center.x),abs(f32(key.z)-center.y));
 let ring_fraction=vec2<f32>(ring,ring*.5)/f32(sc_side());
 return vec2<f32>(1)-smoothstep(vec2<f32>(.40),vec2<f32>(.48),ring_fraction);
}
fn sc_window_weight(key:vec3<u32>)->f32{
 let weights=sc_window_weights(key);return select(weights.x,weights.y,sc_outer_cell(key.x,vec2<i32>(key.yz)));
}
fn sc_projected_pixels(metres:f32,distance:f32)->f32{
 return metres*f.view.y/(2.0*f.view.w*max(1.0,distance));
}
fn sc_prop_pixels(s:ScInstance,distance:f32)->f32{
 return sc_projected_pixels(s.shape.x*select(1.4,1.0,u32(s.hi.w)==1u),distance);
}
fn sc_pixel_weight(pixels:f32)->f32{return smoothstep(0.38,1.45,pixels);}
// Use the distance envelope to choose whole objects. Each cell has a stable
// threshold so the population thins gradually without leaving holes in a prop.
fn sc_admitted(weight:f32,seed:u32)->bool{return weight>0.04+0.92*sc_random(seed);}
fn sc_fade_toward(value:f32,goal:f32,seconds:f32)->f32{
 let step=max(0.0,f.forward.w)/seconds;return value+clamp(goal-value,-step,step);
}
// Size in screen pixels, shared by visible rocks and their light-space casters.
// Fade the smallest stones before raster coverage becomes a blinking pixel.
fn sc_rock_pixel_weight(radius:f32,distance:f32)->f32{
 return sc_pixel_weight(2.0*sc_projected_pixels(radius*1.4,distance));
}
fn sc_visibility(s:ScInstance)->f32{
 return smoothstep(0.0005,1.0,s.contact.w);
}
fn sc_ds_div(a:vec2<f32>,b:vec2<f32>)->vec2<f32>{let q=rounded(a.x/b.x);let r=ds_add(a,-ds_mul(b,vec2<f32>(q,0)));return ds_add(vec2<f32>(q,0),vec2<f32>(r.x/b.x,0));}
// Crown radius in metres of a tree of this species and height (its envelope at the widest).
// Leaf albedo of the canopy the last projected-cover query saw (a crown of that climate's species, self-shaded).
var<private> sc_canopy_color:vec3<f32>=vec3<f32>(0.037,0.090,0.018);
fn sc_crown_metres(species:u32,height:f32)->f32{let sp=sc_species_base(species);return max(0.6,sp.width*height*select(0.85,0.45,sp.kind==4u||sp.kind==5u));}
// Canonical crown/stone footprints, not thresholded stand-colour polygons.
// Resident cells use EXACT admitted parameters; unresolved cells share the same
// seed, occupancy test, species and size rules and ecology. At subpixel scale use
// their expected projected area instead of filling the entire ecological stand.
fn sc_projected_cover(p:vec3<f32>,height:f32,slope:f32,footprint:f32,rd:vec3<f32>,fallback:bool)->vec2<f32>{
 if f.scenery_limits.w!=0u||f.scenery.z==0.0||(f.scenery.x<0.5&&f.scenery.y<0.5){return vec2<f32>(0);}
 let distance=length(p);if distance<700.0&&!fallback{return vec2<f32>(0);}
 let radial=normalize(f.eye_hi.xyz+f.eye_lo.xyz+p);
 let canopy_query=p-rd*(8.5/max(0.2,-dot(rd,radial)));
 let base=surface_base(canopy_query);let world=f.eye_hi.xyz+base;let a=abs(world);var face=select(5u,4u,world.z>=0.0);
 if a.x>=max(a.y,a.z){face=select(1u,0u,world.x>=0.0);}else if a.y>=a.z{face=select(3u,2u,world.y>=0.0);}
 let hi=sc_face_project(face,f.eye_hi.xyz);let lo=sc_face_project(face,base);let denominator=ds_add(vec2<f32>(hi.z,0),vec2<f32>(lo.z,0));
 let u=ds_add(ds_mul(sc_ds_div(ds_add(vec2<f32>(hi.x,0),vec2<f32>(lo.x,0)),denominator),vec2<f32>(262144,0)),vec2<f32>(262144,0));
 let v=ds_add(ds_mul(sc_ds_div(ds_add(vec2<f32>(hi.y,0),vec2<f32>(lo.y,0)),denominator),vec2<f32>(262144,0)),vec2<f32>(262144,0));
 let cell=vec2<i32>(floor(vec2<f32>(u.x,v.x)));let fraction=vec2<f32>(u.x,v.x)-vec2<f32>(cell)+vec2<f32>(u.y,v.y);
 let uv=(vec2<f32>(cell)+fraction)/262144.0-1.0;let area=pow(1.0+dot(uv,uv),-1.5);
 let e=sc_eco(f.eye_hi.xyz,base,height,slope);let metres=f.planet.x/262144.0;
 // Expected crown area per cell: the mean crown of this climate's species, about 0.3 of a height of 16 m wide.
 let typical=sc_pick_species(e,0x5157u);let crown=sc_crown_metres(typical,16.0);
 if typical<SC_SNAG{sc_canopy_color=sc_species_base(typical).leaf_color*0.85;}
 let mean=vec2<f32>(e.trees*0.72*3.14159265*crown*crown*0.8,e.rocks*0.65*3.14159265*0.35*0.8)/(metres*metres)*f.scenery.z;
 let average=smoothstep(8.0,24.0,footprint);var coverage=vec2<f32>(0);
 if average<1.0 {
  for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
   let c=cell+vec2<i32>(x,y);if any(c<vec2<i32>(0))||any(c>=vec2<i32>(524288)){continue;}
   let seed=sc_cell_hash(face,u32(c.x),u32(c.y));if sc_random(seed+8u)>f.scenery.z{continue;}
   let jitter=vec2<i32>(96+i32(hash(seed)%832u),96+i32(hash(seed+1u)%832u))&vec2<i32>(-2);
   let delta=(vec2<f32>(f32(x),f32(y))+vec2<f32>(jitter)/1024.0-fraction)*metres;
   let projected=vec3<f32>(delta,0);let chart_up=normalize(vec3<f32>(uv,1));let tangent=(projected-chart_up*dot(projected,chart_up))/sqrt(1.0+dot(uv,uv));
   var separation=length(tangent);var kind=0u;var radius=0.0;var presence=0.0;
   let object=sc_objects[sc_cell_slot(face,c)];
   let valid=all(object.key.xyz==vec3<u32>(face,vec2<u32>(c)))&&sc_record_current(object.key.w)&&object.identity.w==bitcast<u32>(f.geo.z);
   if valid {
    kind=u32(object.hi.w);let variant=u32(object.shape.z);let tv=SC_SPECIES*max(1u,min(3u,f.tier_d.y));
    radius=select(object.shape.x,sc_crown_metres(min(variant/max(1u,min(3u,f.tier_d.y)),SC_SPECIES-1u),object.shape.x),kind==1u&&variant<tv);
    let displacement=(object.hi.xyz-f.eye_hi.xyz)+(object.lo.xyz-radial*object.lo.w-base);separation=length(displacement-radial*dot(displacement,radial));
    presence=select(sc_visibility(object),0.0,fallback);
   }else{
    let chance=sc_random(seed+2u);
    if chance<e.trees*area*0.72{kind=1u;let sp=sc_pick_species(e,seed);radius=sc_crown_metres(sp,sc_species_base(sp).height*(0.82+0.36*sc_random(seed+4u)));}
    else if chance>1.0-e.rocks*area*0.65{kind=2u;radius=0.22*pow(1.0-sc_random(seed+4u)*0.99,-1.0/2.4);}
   }
   if kind==0u{continue;}
   let aa=max(0.25,footprint*0.65);let disk=(1.0-smoothstep(max(0.0,radius-aa),radius+aa,separation))*0.8*(1.0-presence);
   let k=kind-1u;coverage[k]=1.0-(1.0-coverage[k])*(1.0-disk);
  }}
 }
 coverage=mix(coverage,mean,average)*vec2<f32>(f.scenery.x,f.scenery.y)*select(smoothstep(700.0,1100.0,distance),1.0,fallback);
 return clamp(coverage,vec2<f32>(0),vec2<f32>(0.8));
}
fn sc_ground_cover(p:vec3<f32>,height:f32,slope:f32,footprint:f32)->vec2<f32>{return sc_projected_cover(p,height,slope,footprint,normalize(p),false);}
fn sc_sun_cover(p:vec3<f32>,normal:vec3<f32>,footprint:f32)->f32{
 let radial=normalize(f.eye_hi.xyz+f.eye_lo.xyz+p);let height=sc_radial_height(p);
 if f.solar.w>0.5{return sc_rock_sun_cover(p,normal,footprint);}
 if height>6500.0||dot(radial,f.sun.xyz)<=0.0{return 1.0;}
 // Resolved shadows belong to the light-space geometry. A global overflow
 // must never replace them with displaced crown disks (a tree-height
 // projection would also move lunar rock shadows, and expose the record square).
 // Only an unresolved Earth canopy has a statistical far-field estimate.
 // Airless rock ecology has no calibrated area estimate here: retain its
 // actual casters and report missing work instead of inventing circular rocks.
 if f.solar.w>0.5||footprint<=8.0{return 1.0;}
 let coverage=sc_projected_cover(p,height,clamp(dot(normal,radial),0.0,1.0),max(24.0,footprint),-f.sun.xyz,false)*smoothstep(8.0,24.0,footprint);
 return (1.0-coverage.x)*(1.0-coverage.y);
}
// Expected unresolved projected rock area from the SAME truncated population
// as sc_airless_rock. Eight fixed quantiles, no resident lists or displaced disks.
// This is a statistical distant shadow, not a resolved silhouette guarantee.
fn sc_rock_sun_cover(p:vec3<f32>,normal:vec3<f32>,footprint:f32)->f32{
 if (f.scenery.y<0.5&&f.cover.x<0.5)||f.scenery_limits.w!=0u{return 1.0;}
 let radial=normalize(f.eye_hi.xyz+f.eye_lo.xyz+p);let sun=dot(radial,f.sun.xyz);if sun<=0.0{return 1.0;}
 let address=surface_address(p);let pos=page_pos(address.hi,address.lo);let slope=clamp(dot(normal,radial),0.0,1.0);
 let e=sc_eco(address.hi,address.lo,sc_radial_height(p),slope);let steep=1.0-smoothstep(0.75,0.95,slope);
 let uv=pos.uv;let area=pow(1.0+dot(uv,uv),-1.5);let cell_area=pow(f.planet.x/262144.0,2.0)*area;
 let cell=vec2<u32>(pos.g>>vec2<u32>(9u));let windows=sc_window_weights(vec3<u32>(pos.face,cell));let window=mix(windows.x,windows.y,.25);
 let distance=length(p);var optical=0.0;
 let ice=f.solar.w>2.5;let dusty=f.solar.w>1.5&&!ice;
 let b=mix(2.5,3.5,e.ejecta);let c1=select(0.0015,0.0006,ice)+0.06*e.ejecta*e.ejecta+0.012*steep;
 let dmin=max(0.3,pow(c1*cell_area/0.85,1.0/b));
 let dmax=max(dmin*1.5,mix(4.0,0.25*pow(max(e.crater,10.0),0.6667),e.ejecta));
 for(var i=0u;i<8u;i++){
  let u=(f32(i)+0.5)/8.0;var diameter=dmin*pow(1.0-u*(1.0-pow(dmax/dmin,-b)),-1.0/b);
  var number=c1*pow(dmin,-b)/8.0;
  if dusty{
   let k=clamp(0.03+0.12*e.ejecta+0.06*steep+0.03*e.moist,0.01,0.3);let q=1.79+0.152/k;
   diameter=0.35+(f32(i)+0.5)/q;
   number=4.0*k*exp(-q*diameter)/(3.14159265*diameter*diameter);
  }
  let radius=diameter*0.5;
  let resolved=window*sc_rock_pixel_weight(radius,distance)*sun_rock_resolution(p,radius);
  // Buried irregular stones: footprint plus exposed side projected onto ground.
  let projection=0.35+0.65*sqrt(max(0.0,1.0-sun*sun))/max(0.12,sun);
  optical+=number*3.14159265*radius*radius*projection*(1.0-resolved);
 }
 // Suppress visible statistical texture at close range: the complement is
 // negligible once the population is resolved, and continuous at map/window edges.
 _=footprint;
 // Six pebbles per ground-cover cluster. Integrate their generated radius
 // (0.03 + 0.11 u^1.6) and scale (1.4 * (0.75 + 0.55 u)) second moments.
 // Near geometry carries its own shaded area; unresolved stones retain its
 // mean dark fraction in the ground. No individual circular shadows appear.
 var pebbles=0.0;
 if f.cover.x>0.5{
  let sub=clamp(exp2(round(log2(max(f.planet.x/262144.0/1.5,1.0)))),1.0,16.0);
  let spacing=f.planet.x/262144.0/sub;
  let probability=min(1.0,0.25+0.5*e.ejecta+0.3*steep);
  let along=length(p-radial*dot(p,radial));let reach=f.cover.y;
  let thin=1.0-0.8*smoothstep(reach*0.45,reach,along);
  let pixels=0.2*(1.4*1.025)/max(0.001,distance*2.0*f.view.w/f.view.y);
  let visible=smoothstep(0.35,1.25,pixels)*(1.0-smoothstep(reach*0.72,reach,along))*thin;
  let radius2=0.0009+0.0066/2.6+0.0121/4.2;
  let scale2=1.96*(0.5625+0.4125+0.3025/3.0);
  pebbles=probability/(spacing*spacing*area)*6.0*3.14159265*radius2*scale2*0.5*f.cover.z*(1.0-visible);
 }
 return exp(-min(1.5,optical*f.scenery.z*f.scenery.y+pebbles));
}
