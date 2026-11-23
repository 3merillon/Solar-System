// Ground cover: grass clumps, reeds, pebble clusters, ferns and small bushes near the eye (docs/SCENERY.md, "Ground
// cover"). Rebuilt every frame from persistent keys: sub-cells of the record lattice on each cube face, so the same clump
// comes back at the same place whatever the path. A fixed toroidal cache retains roots, species and arrival maturity.
// Distance and habitat select whole clumps. Only a change of state fades pixels.
struct CoverInstance {p:vec4<f32>,up:u32,yaw_scale:u32,seed:u32,kind:u32}
@group(0) @binding(149) var<storage,read_write> cover_write:array<CoverInstance>;
// Persistent root offset and species survive transient terrain lookup misses and view changes.
// identity x: 23-bit cell + 8-bit habitat alpha; y: cell + 5-bit imagery level + valid flag;
// z: full body seed; w: current-frame emission stamp.
struct CoverHistory {identity:vec4<u32>,instance:CoverInstance}
@group(0) @binding(169) var<storage,read_write> cover_history:array<CoverHistory>;
@group(0) @binding(176) var<storage,read_write> cover_admission:array<atomic<u32>>;
const CV_BUCKETS:u32=256u;const CV_COUNTS:u32=1536u;const CV_COORD:u32=8388607u;
@group(0) @binding(150) var<storage,read> cover_read:array<CoverInstance>;
// Lists per cover class: grass near, grass far, reeds, pebbles, ferns, bushes.
fn cv_base(k:u32)->u32{switch k{case 0u:{return 0u;}case 1u:{return 16384u;}case 2u:{return 81920u;}case 3u:{return 90112u;}case 4u:{return 122880u;}default:{return 139264u;}}}
fn cv_storage_cap(k:u32)->u32{switch k{case 0u:{return 16384u;}case 1u:{return 65536u;}case 2u:{return 8192u;}case 3u:{return 32768u;}case 4u:{return 16384u;}default:{return 16384u;}}}
// Existing draw-budget diagnostic scales cover too; 32768 is the normal full allocation.
fn cv_cap(k:u32)->u32{return cv_storage_cap(k)*f.scenery_limits.x/32768u;}
const CV_TOTAL:u32=155648u;
const CV_WINDOW:u32=512u;
// Sub-cells per record cell side: about 1.5 m whatever the body's size.
fn cv_sub()->i32{let cell=f.planet.x/262144.0;return clamp(i32(exp2(round(log2(max(cell/1.5,1.0))))),1,16);}
fn cv_metres()->f32{return f.planet.x/262144.0/f32(cv_sub());}
fn cv_reach()->f32{return f.cover.y;}
fn cv_lists(kind:u32,lod:f32)->vec2<u32>{
 if kind>1u{return vec2<u32>(kind,99u);}
 if lod<=0.0{return vec2<u32>(0u,99u);}if lod>=1.0{return vec2<u32>(1u,99u);}return vec2<u32>(0u,1u);
}
// Root-scale imagery, not the 48 m ecology average that blends roads into gardens.
// A missing detailed page is unknown: retain an existing decision, admit no new vegetation.
var<private> cv_image_level:u32=0u;
fn cv_green(base:Sample)->f32{
 let pos=page_pos(base.hi.xyz,base.lo.xyz);let entry=page_entry(1u,pos.face,u32(f.field.z),pos.g);
 // Level 12 is the normal global imagery ceiling; level 13+ exists only in
 // sharp regional overlays. Requiring an overlay would erase other vegetation.
 if entry==0u||page_entry_level(entry)<min(12u,u32(f.field.z)){return -1.0;}
 cv_image_level=page_entry_level(entry);
 let c=measured_albedo_level(entry,pos.g,pos.frac);let sum=max(.001,c.r+c.g+c.b);
 return smoothstep(.35,.40,c.g/sum)*smoothstep(1.05,1.25,c.g/max(c.b,.001))*(1.0-smoothstep(.2,.35,sum/3.0));
}
@compute @workgroup_size(8,8)
fn scenery_cover_place(@builtin(global_invocation_id) id:vec3<u32>,@builtin(local_invocation_index) lid:u32,@builtin(workgroup_id) wg:vec3<u32>){
 field_final=true;let face=id.z;let eye=f.eye_hi.xyz+f.eye_lo.xyz;let chart=sc_face_project(face,eye);
 let sub=cv_sub();let metres=cv_metres();let reach=cv_reach();
 let half=min(i32(ceil(reach/metres))+1,i32(CV_WINDOW/2u));
 if f.cover.x<0.5||chart.z<length(eye)*0.45||i32(id.x)>=2*half||i32(id.y)>=2*half{return;}
 let scale=524288.0*f32(sub);let center=vec2<i32>(floor((chart.xy/chart.z*0.5+0.5)*scale));
 let c=center-vec2<i32>(half)+vec2<i32>(id.xy);
 if any(c<vec2<i32>(0))||any(c>=vec2<i32>(524288*sub)){return;}
 let slot=face*CV_WINDOW*CV_WINDOW+(u32(c.y)&(CV_WINDOW-1u))*CV_WINDOW+(u32(c.x)&(CV_WINDOW-1u));
 let old=cover_history[slot];let identity=old.identity;
 let known=(identity.y&0x80000000u)!=0u&&all((identity.xy&vec2<u32>(CV_COORD))==vec2<u32>(c))&&identity.z==bitcast<u32>(f.geo.z);
 let frame=terrain.frame_count&65535u;
 // Invalidate before any cull. A wrapped frame stamp cannot resurrect a rejected cell.
 cover_history[slot].identity.w=(frame-1u)&65535u;

 let seed=hash(u32(c.x)^hash(u32(c.y)^hash(face^bitcast<u32>(f.geo.z)^0x47524153u)));
 let unit=1024/sub;let jitter=vec2<i32>(i32(hash(seed)%u32(unit)),i32(hash(seed+1u)%u32(unit)))&vec2<i32>(-2);
 let coord=c*unit-vec2<i32>(Q)+jitter;let key=cube_key(face,coord.x,coord.y);
 // Reach and thinning by the distance over the ground (the canonical point lies on the sphere at sea level).
 let base=base_position(key);let rel=relative(base);let n=base.normal.xyz;let flat=rel-n*dot(rel,n);let along=length(flat);
 if urban_blocked(base.hi.xyz,base.lo.xyz,1.3){return;}
 if along>reach{return;}
 let thin=1.0-0.8*smoothstep(reach*0.45,reach,along);
 let density=smoothstep(sc_random(seed+2u)-.08,sc_random(seed+2u)+.08,thin*f.cover.z);
 if density<=0.&&!known{return;}
 let s=radial_sample(key,24u);let slope=dot(s.normal.xyz,n);let height=s.lo.w;
 // Cull at the displayed root. A canonical-height cull can discard a visible
 // plant while the terrain is still morphing during travel.
 var support=sc_support(key);
 if support.w<0.0{if !known{return;}support=vec4<f32>(rel+old.instance.p.xyz,1.0);}
 let at=support.xyz;let d=length(at);
 let z=dot(at,f.forward.xyz);if z< -3.0||abs(dot(at,f.right.xyz))>max(z,0.0)*f.view.z*f.view.w+4.0||abs(dot(at,f.up.xyz))>max(z,0.0)*f.view.w+4.0{return;}
 atomicAdd(&sc_state.cover_candidates,1u);
 let e=sc_eco(base.hi.xyz,base.lo.xyz,height,slope);
 // Choose what grows here.
 let airless=f.solar.w>0.5;var level=f.planet.y;
 if field_measured(){level=measured_water_level(page_pos(base.hi.xyz,base.lo.xyz),1.0);}
 let depth=level-height;let r=sc_random(seed+3u);var k=99u;
 if airless{
  if r<0.25+0.5*e.ejecta+0.3*(1.0-smoothstep(0.75,0.95,slope)){k=3u;}
 }else if f.solar.w<0.5{
  let forest=e.trees;let meadow=(1.0-forest)*smoothstep(0.2,0.45,e.moist)*smoothstep(-1.0,3.0,e.temp)*smoothstep(0.8,0.92,slope)*e.green;
  let shore=e.water<2.5;
  if e.water<=0.0||depth>-0.15{
   // In or at the water: reeds where it is still and shallow, nothing else.
   if e.still>0.5&&depth<0.8&&r<0.55{k=2u;}
   if !field_measured()&&depth>-0.15&&depth<0.6&&e.coast>0.5&&r<0.0{k=2u;}
  }else if shore&&e.still>0.5&&r<0.45{k=2u;}
  else if shore&&r<0.35{k=3u;}
  else if e.coast>0.85&&height<f.planet.y+2.0{if r<0.3{k=3u;}}
  else if slope<0.75||e.rocks>0.45{if r<0.35{k=3u;}else if r<0.5{k=0u;}}
  else if forest>0.3{if r<0.35*smoothstep(0.35,0.7,e.moist){k=4u;}else if r<0.42{k=5u;}else if r<0.6{k=0u;}else if r<0.66{k=3u;}}
  else{if r<0.15+0.75*meadow{k=0u;}else if r<0.2+0.75*meadow{k=5u;}else if r<0.26+0.75*meadow{k=3u;}}
 }
 if known{k=old.instance.kind&255u;}
 if k==99u{return;}
 // Keep the admitted species stable; source refinement changes habitat opacity,
 // not a new random choice between a bush, fern and grass on every frame.
 var habitat=1.0;
 if field_measured()&&k!=3u{let green=cv_green(base);habitat=select(green,select(0.0,f32((identity.x>>23u)&255u)/255.0,known),green<0.0);if known&&cv_image_level<((identity.y>>23u)&31u){habitat=f32((identity.x>>23u)&255u)/255.0;}}
 if k!=2u&&(e.water<0.3||depth>-0.12){atomicAdd(&sc_state.cover_water_rejected,1u);habitat=0.0;}
 let old_alpha=select(0.0,f32((identity.x>>23u)&255u)/255.0,known);
 let alpha=select(habitat,old_alpha+clamp(habitat-old_alpha,-max(0.,f.forward.w)/.35,max(0.,f.forward.w)/.35),known);
 let up=normalize(base.hi.xyz+base.lo.xyz);
 let ring=f32(max(abs(c.x-center.x),abs(c.y-center.y)))/f32(half);
 var eligibility=alpha*density*(1.-smoothstep(reach*.80,reach,along))*(1.-smoothstep(.84,.99,ring));
 var size=0.75+0.55*sc_random(seed+4u);
 if k==3u&&airless{size*=1.4;}
 if k==5u{size*=0.8+0.6*sc_random(seed+9u);}
 if size<=0.01{return;}
 // A cluster contains six centimetre-scale stones, not one cluster-sized
 // solid. Ground-distance reach alone kept them drawing under a high camera,
 // aliasing into isolated bright/dark pixels and overflowing the pebble list.
 // Retire unresolved stones continuously into the filtered ground material.
 if k==3u{
  let pixels=0.2*size/max(0.001,d*2.0*f.view.w/f.view.y);
  eligibility*=smoothstep(0.28,1.05,pixels);
 }
 let previous=select(0.0,f32(u32(old.instance.p.w)>>12u)/4095.0,known);
 let appearance=sc_fade_toward(previous,select(0.0,1.0,sc_admitted(eligibility,seed+723u)),0.55);
 let yaw=sc_random(seed+5u)*6.2831853;
 let surface_up=select(up,normalize(s.normal.xyz),k==3u);
 let variant=hash(seed+6u)%select(select(4u,8u,k==0u||k==3u),8u,k==0u);
 let old_lod=f32(u32(old.instance.p.w)&4095u)/4095.0;
 let coarse=select(27.0,23.0,known&&old_lod>=0.5);
 let target_lod=select(0.0,1.0,k<=1u&&along>coarse);
 let lod=select(target_lod,sc_fade_toward(old_lod,target_lod,0.22),known);
 let lists=cv_lists(k,lod);let packed=pack2x16float(vec2<f32>(yaw,size));
 let kind=k|(variant<<8u)|(u32(clamp(e.moist,0.0,1.0)*255.0)<<16u)|(u32(clamp(1.0-e.water/8.0,0.0,1.0)*255.0)<<24u);
 let stamp=select((frame-1u)&65535u,frame,appearance>0.0);
 cover_history[slot]=CoverHistory(vec4<u32>(u32(c.x)|(u32(round(clamp(alpha,0.,1.)*255.0))<<23u),u32(c.y)|(max(cv_image_level,select(0u,(identity.y>>23u)&31u,known))<<23u)|0x80000000u,bitcast<u32>(f.geo.z),stamp),
  CoverInstance(vec4<f32>(support.xyz-rel,f32(u32(round(lod*4095.))+4096u*u32(round(appearance*4095.)))),pack2x16unorm(sc_oct_encode(surface_up)),packed,seed,kind));
 if appearance<=0.0{return;}
 for(var t=0u;t<2u;t++){let list=lists[t];if list==99u{continue;}atomicAdd(&cover_admission[list*CV_BUCKETS+(hash(seed+753u)&255u)],1u);}
}
// Admit complete stable hash buckets before appending. The admitted sum is <=
// capacity by construction, so thread arrival order can never choose survivors.
// Leave 15% headroom when pressured, avoiding repeated admission/eviction at capacity.
@compute @workgroup_size(1) fn scenery_cover_select(){
 for(var k=0u;k<6u;k++){
  var total=0u;var fit=0u;var grow=0u;var accepted=0u;let cap=cv_cap(k);
  let previous=atomicLoad(&cover_admission[CV_COUNTS+k]);
  for(var b=0u;b<CV_BUCKETS;b++){total+=atomicLoad(&cover_admission[k*CV_BUCKETS+b]);if total<=cap{fit=b+1u;}if total<=cap*85u/100u{grow=b+1u;}}
  var limit=previous;
  if previous==0u{limit=select(grow,CV_BUCKETS,total<=cap);}else if previous>fit{limit=grow;}else if grow>previous{limit=grow;}
  atomicStore(&cover_admission[CV_COUNTS+k],limit);
  for(var b=0u;b<limit;b++){accepted+=atomicLoad(&cover_admission[k*CV_BUCKETS+b]);}
  atomicAdd(&sc_state.cover_overflow,total-accepted);
 }
}
@compute @workgroup_size(64) fn scenery_cover_emit(@builtin(global_invocation_id) id:vec3<u32>){
 let slot=id.x;if slot>=6u*CV_WINDOW*CV_WINDOW||f.cover.x<.5{return;}
 let face=slot/(CV_WINDOW*CV_WINDOW);let eye=f.eye_hi.xyz+f.eye_lo.xyz;let chart=sc_face_project(face,eye);if chart.z<length(eye)*.45{return;}
 let h=cover_history[slot];if (h.identity.y&0x80000000u)==0u||h.identity.w!=(terrain.frame_count&65535u){return;}
 let sub=cv_sub();let half=min(i32(ceil(cv_reach()/cv_metres()))+1,i32(CV_WINDOW/2u));let center=vec2<i32>(floor((chart.xy/chart.z*.5+.5)*524288.0*f32(sub)));
 let c=vec2<i32>(h.identity.xy&vec2<u32>(CV_COORD));if any(c<center-vec2<i32>(half))||any(c>=center+vec2<i32>(half))||h.identity.z!=bitcast<u32>(f.geo.z){return;}
 let inst=h.instance;let seed=inst.seed;let unit=1024/sub;let jitter=vec2<i32>(i32(hash(seed)%u32(unit)),i32(hash(seed+1u)%u32(unit)))&vec2<i32>(-2);
 let coord=c*unit-vec2<i32>(Q)+jitter;let base=base_position(cube_key(face,coord.x,coord.y));
 let p=relative(base)+inst.p.xyz;let lod=f32(u32(inst.p.w)&4095u)/4095.;let lists=cv_lists(inst.kind&255u,lod);let bucket=hash(seed+753u)&255u;var emitted=false;
 for(var t=0u;t<2u;t++){let list=lists[t];if list==99u||bucket>=atomicLoad(&cover_admission[CV_COUNTS+list]){continue;}
  let i=atomicAdd(&sc_state.class_count[6u+list],1u);
  if i>=cv_cap(list){atomicAdd(&sc_state.cover_overflow,1u);continue;}
  cover_write[cv_base(list)+i]=CoverInstance(vec4<f32>(p,inst.p.w),inst.up,inst.yaw_scale,seed,(inst.kind&0xffffff00u)|list);emitted=true;
 }
 if emitted{atomicAdd(&sc_state.cover_count,1u);}
}
@compute @workgroup_size(1)
fn scenery_cover_draws(){
 for(var k=0u;k<6u;k++){atomicStore(&sc_state.args[(8u+k)*8u+1u],min(atomicLoad(&sc_state.class_count[6u+k]),cv_cap(k)));}
}
@vertex fn scenery_cover_mesh(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->ScSurface{
 let cls=vertex>>24u;let local=vertex&0xffffffu;
 // Which list this draw reads: the draw for the far grass reuses class 5 with fewer indices, so the list comes from the
 // instance range of the draw (first index cannot tell near from far); the far grass draw sets the high bit below.
 var list=0u;switch cls{case 5u:{list=select(0u,1u,(local&0x800000u)!=0u);}case 6u:{list=2u;}case 7u:{list=3u;}case 8u:{list=4u;}default:{list=5u;}}
 let inst=cover_read[cv_base(list)+instance];let variant=(inst.kind>>8u)&255u;
 let v=sc_vertex(cls,variant,local&0x7fffffu);let ys=unpack2x16float(inst.yaw_scale);let up=sc_unoct16(inst.up);
 let b=sc_basis(up,ys.x);
 // Wind: blades bend with their height; reeds sway slower and further.
 let speed=length(f.wind.xy);let gain=f.scenery_work.z*min(1.5,speed/8.0);let dir=sc_wind_dir(ys.x);let ph=sc_random(inst.seed)*6.2831853;
 let sway=(0.65*sin(f.planet.w*2.1+ph)+0.35*sin(f.planet.w*3.3+ph*1.7))*0.12*gain;
 let wp=v.p+dir*sway*v.bend+v.n*sin(f.planet.w*7.0+ph+v.p.y*9.0)*0.01*v.flutter*gain;
 let p=inst.p.xyz+b*(wp*ys.y);
 var out:ScSurface;out.clip=sc_project(p);out.p=p;out.n=normalize(b*v.n);out.t=normalize(b*v.t);out.uv=v.uv;
 out.info=vec4<u32>(v.material|(SC_SHRUB<<8u)|(v.aux<<16u),inst.seed,inst.seed,select(0u,1u,list==1u));
 let visibility=vec2<f32>(f32(u32(inst.p.w)&4095u),f32(u32(inst.p.w)>>12u))/4095.;
 out.local=v.p;out.shade=vec4<f32>(v.ao,v.radius*ys.y,v.uv.y*2.0*ys.y,visibility.x);
 out.misc=vec4<f32>(f32((inst.kind>>16u)&255u)/255.0,f32(inst.kind>>24u)/255.0,ys.y,visibility.y);
 return out;
}
// Diagnostics: up to 64 cover instances (about ten from each list) with the 18 published triangles around their root,
// in the record contact audit's layout (scenery_reference.rs inspect_contact): support, up and zero burial, count, root.
@group(0) @binding(153) var<storage,read_write> cv_contact_probe:array<vec4<f32>>;
@compute @workgroup_size(64)
fn scenery_audit_cover(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if i>=64u{return;}let out=i*64u;cv_contact_probe[out+2u]=vec4<f32>(0);
 let list=i%6u;let k=i/6u;let n=min(atomicLoad(&sc_state.class_count[6u+list]),cv_cap(list));if k>=n{return;}
 let inst=cover_write[cv_base(list)+(k*max(n/11u,1u))%n];let p=inst.p.xyz;
 let a=surface_address(p);let pos=page_pos(a.hi,a.lo);let key=cube_key(pos.face,i32(pos.g.x)*2-Q,i32(pos.g.y)*2-Q);
 let node=find_leaf(key,2u);var patch_id=NONE;
 for(var q=0u;q<terrain.reserved[1].w;q++){if terrain.published_nodes[q]==node{patch_id=q;break;}}if patch_id==NONE{return;}
 let kk=terrain.nodes[node].key;let uv=on_face_key(key,kk.x);let global=vec2<u32>(uv+vec2<i32>(Q))/2u;let origin=vec2<i32>((global>>vec2<u32>(MAX_LEVEL-kk.y))-kk.zw*16u);var count=0u;
 for(var y=max(0,origin.y-1);y<=min(15,origin.y+1);y++){for(var x=max(0,origin.x-1);x<=min(15,origin.x+1);x++){for(var t=0u;t<2u;t++){for(var v=0u;v<3u;v++){let index=index_write[terrain.active_bank*2u*f.tier_c.w+patch_id*1536u+u32(y*16+x)*6u+t*3u+v];cv_contact_probe[out+4u+count*3u+v]=vec4<f32>(relative(morph_sample(read_morph(index),f.lod.x)),1);}count+=1u;}}}
 let up=normalize(f.eye_hi.xyz+f.eye_lo.xyz+p);
 cv_contact_probe[out]=vec4<f32>(p,0.0);cv_contact_probe[out+1u]=vec4<f32>(up,0.0);cv_contact_probe[out+2u]=vec4<f32>(f32(list),0,0,f32(count));cv_contact_probe[out+3u]=vec4<f32>(p+up*0.5,1);
}
