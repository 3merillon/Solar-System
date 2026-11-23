// Bounded GPU generation, canonical placement, displayed-surface support and indirect drawing of trees, rocks and their
// impostors (second pass, docs/SCENERY.md). Appended after terrain_gpu.wgsl. Generation is one job per frame, chosen
// on the GPU: template indices and ground-cover meshes once, a species' leaf-card layer, a variant's geometry, or a
// variant's impostor capture.
const SC_TREE_CLASSES:u32=3u;
// Compacted draw lists, one region per class: tree LOD0, LOD1, LOD2, rock LOD0, LOD1, impostor cards.
fn sc_list_base(k:u32)->u32{switch k{case 0u:{return 0u;}case 1u:{return 1024u;}case 2u:{return 5120u;}case 3u:{return 21504u;}case 4u:{return 25600u;}case 14u:{return 74752u;}default:{return 41984u;}}}
fn sc_list_cap(k:u32)->u32{switch k{case 0u:{return 1024u;}case 1u:{return 4096u;}case 2u:{return 16384u;}case 3u:{return 4096u;}case 4u:{return 16384u;}default:{return 32768u;}}}
const SC_LIST_TOTAL:u32=107520u;
// Indirect draws (8 words each from SC_ARGS): 0-4 mesh classes, 5 cards, 6-7 capture (tree, rock), 8-13 ground cover.
const SC_ARGS:u32=40u;
const SC_DRAWS:u32=16u;
// Generation dispatches (3 words each from SC_DISPATCH): templates+cover meshes, skeleton, tree vertices, rock vertices, leaf atlas.
const SC_DISPATCH:u32=168u;
// Job kinds: 0 idle, 1 initial templates, 2 variant geometry, 3 leaf layer, 4 variant capture.
struct ScState {
 revision:u32,seed:u32,sea:u32,job:u32,
 ages:u32,tree_variants:u32,variants:u32,templates:u32,
 class_base:array<u32,12>,
 requests:atomic<u32>,generated:atomic<u32>,resident:atomic<u32>,trees:atomic<u32>,rocks:atomic<u32>,deferred:atomic<u32>,overflow:atomic<u32>,support_error:atomic<u32>,
 max_contact:atomic<u32>,footprint_rejected:atomic<u32>,support_reused:atomic<u32>,support_refreshed:atomic<u32>,
 cover_count:atomic<u32>,cover_overflow:atomic<u32>,cover_candidates:atomic<u32>,cover_water_rejected:atomic<u32>,
 job_kind:u32,job_index:u32,jobs_done:u32,refresh_count:atomic<u32>,
 args:array<atomic<u32>,128>,
 dispatch:array<u32,15>,pad0:u32,
 ready:array<u32,72>,
 leaf_ready:array<u32,16>,
 wanted:array<atomic<u32>,72>,
 bounds:array<atomic<u32>,72>,
 class_count:array<atomic<u32>,16>,
 bottom:array<atomic<u32>,1536>,
}
struct ScRead {
 revision:u32,seed:u32,sea:u32,job:u32,
 ages:u32,tree_variants:u32,variants:u32,templates:u32,
 class_base:array<u32,12>,
 counters:array<u32,16>,
 job_kind:u32,job_index:u32,jobs_done:u32,refresh_count:u32,
 args:array<u32,128>,
 dispatch:array<u32,15>,pad0:u32,
 ready:array<u32,72>,
 leaf_ready:array<u32,16>,
 wanted:array<u32,72>,
 bounds:array<u32,72>,
 class_count:array<u32,16>,
 bottom:array<u32,1536>,
}
// One stamp per existing record; no CPU list or geometry. Cached support is
// reusable only after ALL published morphs finish and every support input is
// unchanged. Rotation is deliberately absent: support is omnidirectional.
struct ScSupportCache {eye_hi:vec4<f32>,eye_lo:vec4<f32>,eye_tail:vec4<f32>,view:vec4<f32>,controls:vec4<f32>,stamp_key:vec4<u32>,stamps:array<u32>}
@group(0) @binding(82) var<storage,read_write> sc_support_cache:ScSupportCache;
// On a measured body a morph runs up to 0.6 s, and a page fades in over 20 frames after its table changes.
fn sc_support_moving()->bool{return terrain.alpha<1.0||(field_measured()&&(morph_elapsed(clock_now(),bitcast<f32>(terrain.reserved[1].y))<0.6||f.field_serial.z<24u));}
@compute @workgroup_size(1)
fn scenery_support_begin(){
 let controls=vec4<f32>(f.planet.y,f.cloud_drift.w,f.geo.xy);
 let same=all(sc_support_cache.eye_hi==f.eye_hi)&&all(sc_support_cache.eye_lo==f.eye_lo)&&all(sc_support_cache.eye_tail==f.eye_tail)&&all(sc_support_cache.view==f.view)&&all(sc_support_cache.controls==controls)&&sc_support_cache.stamp_key.y==terrain.epochs&&sc_support_cache.stamp_key.z==f.numeric.w;
 if !same||sc_support_moving(){sc_support_cache.stamp_key.x=min(sc_support_cache.stamp_key.x,0xfffffffeu)+1u;}
 sc_support_cache.stamp_key.y=terrain.epochs;sc_support_cache.stamp_key.z=f.numeric.w;
 sc_support_cache.eye_hi=f.eye_hi;sc_support_cache.eye_lo=f.eye_lo;sc_support_cache.eye_tail=f.eye_tail;sc_support_cache.view=f.view;sc_support_cache.controls=controls;
}
@group(0) @binding(50) var<storage,read_write> sc_state:ScState;
@group(0) @binding(51) var<storage,read_write> sc_geometry:array<u32>;
@group(0) @binding(52) var<storage,read_write> sc_instances:array<ScInstance>;
@group(0) @binding(53) var<storage,read_write> sc_visible:array<u32>;
@group(0) @binding(54) var sc_color:texture_2d_array<f32>;
@group(0) @binding(55) var sc_normal:texture_2d_array<f32>;
// Impostor atlas, 8 bits a channel: colour as sqrt of premultiplied albedo with coverage; normal octahedral in xy and
// depth toward the capture eye in zw (16 bits over twice the variant's capture radius).
@group(0) @binding(56) var sc_color_out:texture_storage_2d_array<rgba8unorm,write>;
@group(0) @binding(57) var sc_normal_out:texture_storage_2d_array<rgba8unorm,write>;
fn sc_nd_encode(n:vec3<f32>,depth:f32,extent:f32)->vec4<f32>{let u=u32(clamp(0.5+depth/(2.1*max(extent,1e-4)),0.0,1.0)*65535.0+0.5);return vec4<f32>(sc_oct_encode(select(vec3<f32>(0,1,0),normalize(n),length(n)>1e-6)),f32(u>>8u)/255.0,f32(u&255u)/255.0);}
fn sc_nd_decode(t:vec4<f32>,extent:f32)->vec4<f32>{let u=(round(t.z*255.0)*256.0+round(t.w*255.0))/65535.0;return vec4<f32>(sc_oct_decode(t.xy),(u-0.5)*2.1*extent);}
@group(0) @binding(58) var<storage,read> sc_vertices:array<u32>;
@group(0) @binding(60) var<storage,read> sc_draws:array<u32>;
@group(0) @binding(61) var<storage,read> sc_render_state:ScRead;
@group(0) @binding(146) var sc_leaf_sampler:sampler;
fn sc_variant_ready(v:u32)->bool{return v<sc_render_state.variants&&sc_render_state.ready[v]>=1u;}
fn sc_variant_captured(v:u32)->bool{return v<sc_render_state.variants&&sc_render_state.ready[v]>=2u;}
fn sc_tree_variant(v:u32)->bool{return v<sc_render_state.tree_variants;}
fn sc_vertex(cls:u32,variant:u32,local:u32)->ScV{
 let tv=sc_render_state.tree_variants;let row=select(select(variant,variant-tv,cls==3u||cls==4u),variant,cls<3u||cls>4u);
 let i=(sc_render_state.class_base[cls]+row*sc_class_verts(cls)+local)*SC_WORDS;
 var w:array<u32,8>;for(var k=0u;k<8u;k++){w[k]=sc_vertices[i+k];}return sc_unpack(w);
}
// Collapse the 16x16 face grid onto the 6x6 grid monotonically. At lod 1
// duplicate vertices form degenerate triangles; the surviving triangles are
// exactly the coarse mesh. One surface replaces overlapping dithered skins.
// Shadow casters call this same function, including during the transition.
fn sc_far_rock_vertex(variant:u32,face:u32,ij:vec2<u32>)->ScV{
 return sc_vertex(4u,variant,face*81u+36u*ij.y+4u*ij.x);
}
fn sc_rock_vertex(cls:u32,variant:u32,local:u32,lod:f32)->ScV{
 if cls==11u{return sc_far_rock_vertex(variant,local/9u,vec2<u32>(local%3u,local%9u/3u));}
 let side=select(9u,17u,cls==3u);let face=local/(side*side);let ij=vec2<u32>(local%side,local/side%side);
 var vertex=sc_vertex(cls,variant,local);
 if cls==3u&&lod>0.0{
  // The fine vertex is a coarse corner, edge midpoint or diagonal midpoint.
  let base=face*81u+(ij.y/2u)*9u+ij.x/2u;
  let a=sc_vertex(4u,variant,base);let b=sc_vertex(4u,variant,base+ij.x%2u+9u*(ij.y%2u));
  let t=min(lod,1.0);vertex.p=mix(vertex.p,(a.p+b.p)*.5,t);vertex.n=mix(vertex.n,(a.n+b.n)*.5,t);
 }
 if lod>1.0{
  let uv=vec2<f32>(ij)*(2.0/f32(side-1u));let cell=min(vec2<u32>(uv),vec2<u32>(1u));let w=uv-vec2<f32>(cell);
  let a=sc_far_rock_vertex(variant,face,cell);let d=sc_far_rock_vertex(variant,face,cell+1u);
  let b=sc_far_rock_vertex(variant,face,cell+select(vec2<u32>(0,1),vec2<u32>(1,0),w.x>w.y));
  let weights=vec3<f32>(1.0-max(w.x,w.y),abs(w.x-w.y),min(w.x,w.y));let t=min(lod-1.0,1.0);
  vertex.p=mix(vertex.p,a.p*weights.x+b.p*weights.y+d.p*weights.z,t);
  vertex.n=mix(vertex.n,a.n*weights.x+b.n*weights.y+d.n*weights.z,t);
 }
 return vertex;
}
// Model centre the culling and capture bounds measure from: a tree's mid-height, a rock's own centre.
fn sc_center(tree:bool)->vec3<f32>{return select(vec3<f32>(0),vec3<f32>(0,0.5,0),tree);}
fn sc_set_draw(d:u32,count:u32,instances:u32,first:u32){let o=SC_ARGS+d*8u-SC_ARGS;atomicStore(&sc_state.args[o],count);atomicStore(&sc_state.args[o+1u],instances);atomicStore(&sc_state.args[o+2u],first);atomicStore(&sc_state.args[o+3u],0u);atomicStore(&sc_state.args[o+4u],0u);}
fn sc_job_needs_leaf(v:u32)->bool{if v>=sc_state.tree_variants{return false;}let s=v/sc_state.ages;return sc_species_base(s).leaf!=LF_NONE&&sc_state.leaf_ready[s]==0u;}
@compute @workgroup_size(1)
fn scenery_begin(){
 let seed=bitcast<u32>(f.geo.z);let ages=sc_tree_ages();
 if sc_state.revision==0u||sc_state.seed!=seed||sc_state.ages!=ages{
  sc_state.revision=f.numeric.w;sc_state.seed=seed;sc_state.sea=bitcast<u32>(f.planet.y);
  for(var v=0u;v<72u;v++){sc_state.ready[v]=0u;atomicStore(&sc_state.wanted[v],0u);}
  for(var l=0u;l<16u;l++){sc_state.leaf_ready[l]=0u;}
  sc_state.jobs_done=0u;
 }
 sc_state.ages=ages;sc_state.tree_variants=sc_tree_variants();sc_state.variants=sc_variants();
 for(var c=0u;c<12u;c++){sc_state.class_base[c]=select(0u,sc_class_vertex_base(c),c<SC_CLASSES);}
 sc_state.revision=f.numeric.w;sc_state.sea=bitcast<u32>(f.planet.y);
 // Choose this frame's generation job: what visible records asked for first, then everything in order.
 var kind=0u;var index=0u;let enabled=f.scenery.x>0.0||f.scenery.y>0.0;let limit=min(f.scenery_limits.y,sc_state.variants);
 if f.scenery_work.x>0.0&&enabled{
  if sc_state.templates==0u{kind=1u;}
  else{
   var pick=0xffffffffu;
   for(var sweep=0u;sweep<2u&&pick==0xffffffffu;sweep++){
    for(var v=0u;v<limit;v++){
     if sc_state.ready[v]>=2u{continue;}
     if sweep==0u&&atomicLoad(&sc_state.wanted[v])==0u{continue;}
     // Trees only where trees are on, rocks only where rocks are.
     if (v<sc_state.tree_variants&&f.scenery.x<0.5)||(v>=sc_state.tree_variants&&f.scenery.y<0.5){continue;}
     pick=v;break;
    }
   }
   if pick!=0xffffffffu{
    if sc_job_needs_leaf(pick){kind=3u;index=pick/sc_state.ages;}
    else if sc_state.ready[pick]==0u{kind=2u;index=pick;}
    else{kind=4u;index=pick;}
   }else if f.cover.x>0.5&&sc_state.leaf_ready[SC_SHRUB]==0u{kind=3u;index=SC_SHRUB;}
   else if f.cover.x>0.5&&sc_state.leaf_ready[SC_FERN_LAYER]==0u{kind=3u;index=SC_FERN_LAYER;}
  }
 }
 sc_state.job_kind=kind;sc_state.job_index=index;sc_state.job=select(0xffffffffu,(kind<<16u)|index,kind!=0u);
 for(var i=0u;i<15u;i++){sc_state.dispatch[i]=0u;}
 for(var i=0u;i<5u;i++){sc_state.dispatch[i*3u+1u]=1u;sc_state.dispatch[i*3u+2u]=1u;}
 if kind==1u{sc_state.dispatch[0]=(SC_TEMPLATE_QUADS+63u)/64u+1024u;}
 if kind==2u&&index<sc_state.tree_variants{sc_state.dispatch[3]=1u;sc_state.dispatch[6]=(sc_class_verts(0u)+sc_class_verts(1u)+sc_class_verts(2u)+63u)/64u;}
 if kind==2u&&index>=sc_state.tree_variants{sc_state.dispatch[9]=(sc_class_verts(3u)+sc_class_verts(4u)+63u)/64u;let r=index-sc_state.tree_variants;for(var k=0u;k<64u;k++){atomicStore(&sc_state.bottom[r*64u+k],0xffffffffu);}}
 if kind==2u{atomicStore(&sc_state.bounds[index],0u);}
 if kind==3u{let s=f.tier_d.z;sc_state.dispatch[12]=(s+7u)/8u;sc_state.dispatch[13]=(s+7u)/8u;}
 atomicStore(&sc_state.requests,0u);atomicStore(&sc_state.generated,0u);atomicStore(&sc_state.resident,0u);atomicStore(&sc_state.trees,0u);atomicStore(&sc_state.rocks,0u);atomicStore(&sc_state.deferred,0u);atomicStore(&sc_state.overflow,0u);atomicStore(&sc_state.support_error,0u);atomicStore(&sc_state.max_contact,0u);atomicStore(&sc_state.footprint_rejected,0u);
 atomicStore(&sc_state.support_reused,0u);atomicStore(&sc_state.support_refreshed,0u);atomicStore(&sc_state.refresh_count,0u);
 for(var v=0u;v<72u;v++){atomicStore(&sc_state.wanted[v],0u);}
 for(var k=0u;k<16u;k++){atomicStore(&sc_state.class_count[k],0u);}
 // Mesh classes: indexed draws over each class's template; instance counts filled by culling.
 for(var c=0u;c<5u;c++){sc_set_draw(c,sc_class_quads(c)*6u,0u,sc_class_first(c));}
 let card=5u*8u;atomicStore(&sc_state.args[card],6u);atomicStore(&sc_state.args[card+1u],0u);atomicStore(&sc_state.args[card+2u],0u);atomicStore(&sc_state.args[card+3u],0u);
 sc_set_draw(14u,sc_class_quads(11u)*6u,0u,sc_class_first(11u));
 // Capture: 64 octahedral views of the variant, from its finest geometry.
 let capture=kind==4u;let tree=index<sc_state.tree_variants;
 sc_set_draw(6u,sc_class_quads(0u)*6u,select(0u,64u,capture&&tree),sc_class_first(0u));
 sc_set_draw(7u,sc_class_quads(4u)*6u,select(0u,64u,capture&&!tree),sc_class_first(4u));
 // Ground cover: classes 5-9, grass twice (all blades near, five far without flowers).
 sc_set_draw(8u,sc_class_quads(5u)*6u,0u,sc_class_first(5u));sc_set_draw(9u,sc_class_quads(10u)*6u,0u,sc_class_first(10u));
 sc_set_draw(10u,sc_class_quads(6u)*6u,0u,sc_class_first(6u));sc_set_draw(11u,sc_class_quads(7u)*6u,0u,sc_class_first(7u));
 sc_set_draw(12u,sc_class_quads(8u)*6u,0u,sc_class_first(8u));sc_set_draw(13u,sc_class_quads(9u)*6u,0u,sc_class_first(9u));
 atomicStore(&sc_state.cover_count,0u);atomicStore(&sc_state.cover_overflow,0u);atomicStore(&sc_state.cover_candidates,0u);atomicStore(&sc_state.cover_water_rejected,0u);
}
@compute @workgroup_size(1)
fn scenery_ready(){
 let k=sc_state.job_kind;let i=sc_state.job_index;
 if k==1u{sc_state.templates=1u;}
 if k==2u&&i<72u{sc_state.ready[i]=select(1u,2u,i>=sc_state.tree_variants);}
 if k==3u&&i<16u{sc_state.leaf_ready[i]=1u;}
 if k==4u&&i<72u{sc_state.ready[i]=2u;}
 if k!=0u{sc_state.jobs_done+=1u;}
}

// ---- Placement: fixed face-cell identities; never a terrain node or allocator ID.
fn sc_place_coord(c:vec2<i32>,seed:u32)->vec2<i32>{let jitter=vec2<i32>(96+i32(hash(seed)%832u),96+i32(hash(seed+1u)%832u))&vec2<i32>(-2);return c*1024-vec2<i32>(Q)+jitter;}
fn sc_place_read(token:u32,channel:u32,pos:PagePos,level:u32)->u32{
 let entry=page_entry(channel,pos.face,level,pos.g);let soft=page_soft(channel,pos,entry);var t=hash(hash(token^(entry>>12u))^bitcast<u32>(soft.x));
 if soft.x<1.0{t=hash(t^(page_entry(channel,pos.face,u32(soft.y),pos.g)>>12u));}
 return t;
}
fn sc_place_token(canonical:vec3<i32>)->u32{
 let base=base_position(canonical);let pos=page_pos(base.hi.xyz,base.lo.xyz);let wanted=log2(f.planet.x/128.0*page_metric(pos.uv)/48.0);
 var t=0x9e3779b1u;
 for(var channel=0u;channel<2u;channel++){
  let top=select(f.field.y,f.field.z,channel==1u);let low=u32(floor(clamp(wanted,0.0,top)));
  t=sc_place_read(t,channel,pos,low);t=sc_place_read(t,channel,pos,min(low+1u,u32(top)));
 }
 let chart=face_chart(canonical);let reach=i32(40.0*3.0/f.planet.x*f32(Q))+1;
 for(var j=0u;j<5u;j++){
  var at=chart.yz;if j<4u{at+=vec2<i32>(select(-reach,reach,(j&1u)!=0u),select(-reach,reach,(j&2u)!=0u));}
  let c=face_chart(cube_key(u32(chart.x),at.x,at.y));
  t=hash(t^(page_entry(0u,u32(c.x),u32(f.field.y),vec2<u32>(c.yz+vec2<i32>(Q))/2u)>>12u));
 }
 return t&0xffffu;
}
fn sc_recheck_frames()->u32{return 16u*(2u*(3u*sc_face_cap()/(16u*max(1u,u32(f.scenery_work.x))))+2u);}
// A glacial erratic or giant boulder claims its neighbours' cells: decided from hashes alone so neighbours agree.
fn sc_giant(face:u32,c:vec2<i32>)->f32{if f.solar.w>2.5{return 0.0;}let seed=sc_cell_hash(face,u32(c.x),u32(c.y));if sc_random(seed+90u)>0.0035{return 0.0;}return 5.0+13.0*pow(sc_random(seed+91u),1.6);}
fn sc_giant_blocks(face:u32,c:vec2<i32>,metres:f32)->bool{
 for(var j=-1;j<=1;j++){for(var i=-1;i<=1;i++){if i==0&&j==0{continue;}let n=c+vec2<i32>(i,j);let r=sc_giant(face,n);if r>0.0&&f32(max(abs(i),abs(j)))*metres<r*1.25+4.0{return true;}}}
 return false;
}
// Rock size, metres (radius), from a truncated power law N(>D) ~ D^-b between the cell's smallest and the family's largest.
fn sc_power_size(u:f32,dmin:f32,dmax:f32,b:f32)->f32{let lo=pow(dmax/dmin,-b);return dmin*pow(1.0-u*(1.0-lo),-1.0/b);}
struct ScChoice {kind:u32,variant:u32,size:f32}
fn sc_choose(face:u32,c:vec2<i32>,seed:u32,canonical:vec3<i32>,s:Sample,e:ScEco,slope:f32,area:f32)->ScChoice{
 var out=ScChoice(0u,0u,0.0);let chance=sc_random(seed+2u);let metres=f.planet.x/262144.0*sqrt(area);
 let airless=f.solar.w>0.5;let tv=sc_tree_variants();let ages=sc_tree_ages();
 // A giant boulder of its own, or a neighbour's: nothing else in its cells.
 let giant=sc_giant(face,c);
 if giant>0.0&&e.rock_ok>0.0&&slope>0.8&&(airless||e.water>giant*1.5)&&(!field_measured()||airless||e.rocks+e.trees>0.05){
  let fam=select(3u,5u,airless);out=ScChoice(2u,tv+fam*4u+hash(seed+3u)%4u,giant);return out;
 }
 if sc_giant_blocks(face,c,metres){return out;}
 if airless{
  // Rocks only: the SFD tail that one cell can hold; smaller ones come from ground cover and the ground's material.
  let r=sc_airless_rock(seed,e,slope,metres*metres);if r.kind!=0u{out=r;}return out;
 }
 if chance<e.trees*area*0.72{
  let sp=sc_pick_species(e,seed);let age=sc_pick_age(e,seed,ages);
  let base=sc_species_base(sp);var h=base.height*(0.45+0.55*min(sc_age_value(age),1.0))*(1.0+0.18*max(sc_age_value(age)-1.0,0.0))*(0.82+0.36*sc_random(seed+4u));
  if sp==SC_SHRUB{h=base.height*(0.6+0.8*sc_random(seed+4u));}
  out=ScChoice(1u,sp*ages+age,h);
 }else if chance>1.0-e.rocks*area*0.65{
  let fam=sc_pick_rock(e,seed,slope);
  let dmax=select(select(select(select(select(6.0,2.5,fam==4u),9.0,fam==3u),0.55,fam==2u),4.5,fam==1u),5.0,fam==0u);
  let size=sc_power_size(sc_random(seed+4u),0.22,dmax,2.4);
  out=ScChoice(2u,tv+fam*4u+hash(seed+3u)%4u,size);
 }
 return out;
}
// Airless and dusty bodies (docs/SCENERY.md "Bodies without plants"): blocks near fresh craters and on steep ground, from
// a power law on regolith bodies (cumulative index 2.5 away from craters, 3.5 in fresh ejecta; Pajola et al. 2019 measured
// -4.0 at Linne for blocks over 4.4 m) and from the Golombek & Rapp (1997) exponential area model on dusty bodies.
fn sc_airless_rock(seed:u32,e:ScEco,slope:f32,cell_area:f32)->ScChoice{
 let tv=sc_tree_variants();let ice=f.solar.w>2.5;let dusty=f.solar.w>1.5&&!ice;
 let steep=1.0-smoothstep(0.75,0.95,slope);let ejecta=e.ejecta;
 var size=0.0;
 if dusty{
  // Fraction k of the ground covered by rocks; cumulative area F(D) = k exp(-q D), q = 1.79 + 0.152 / k.
  let k=clamp(0.03+0.12*ejecta+0.06*steep+0.03*e.moist,0.01,0.3);let q=1.79+0.152/k;
  // Number of rocks per m2 with diameter over D: integral of 4 k q exp(-q x) / (pi x^2), numerically.
  var dmin=0.35;var n=0.0;
  for(var sweep=0u;sweep<2u;sweep++){
   n=0.0;let top=dmin+8.0/q;let step=(top-dmin)/12.0;for(var i=0u;i<12u;i++){let x=dmin+(f32(i)+0.5)*step;n+=4.0*k*q*exp(-q*x)/(3.14159265*x*x)*step;}
   if n*cell_area<=0.85{break;}dmin*=pow(n*cell_area/0.85,0.5);
  }
  if sc_random(seed+2u)>n*cell_area{return ScChoice(0u,0u,0.0);}
  // Sample: a Pareto proposal with exponential acceptance, a few deterministic tries.
  for(var t=0u;t<4u;t++){let u=sc_random(seed+20u+t);let x=dmin/max(1.0-u*0.98,0.02);if sc_random(seed+30u+t)<exp(-q*(x-dmin)){size=x*0.5;break;}}
  if size<=0.0{return ScChoice(0u,0u,0.0);}
  return ScChoice(2u,tv+select(0u,5u,sc_random(seed+5u)<0.6)*4u+hash(seed+3u)%4u,size);
 }
 let b=mix(2.5,3.5,ejecta);let c1=select(0.0015,0.0006,ice)+0.06*ejecta*ejecta+0.012*steep;
 let dmin=max(0.3,pow(c1*cell_area/0.85,1.0/b));let n=c1*pow(dmin,-b);
 if sc_random(seed+2u)>n*cell_area{return ScChoice(0u,0u,0.0);}
 let dmax=max(dmin*1.5,mix(4.0,0.25*pow(max(e.crater,10.0),0.6667),ejecta));
 size=sc_power_size(sc_random(seed+4u),dmin,dmax,b)*0.5;
 let fam=select(5u,0u,ice||sc_random(seed+5u)<0.25);
 return ScChoice(2u,tv+fam*4u+hash(seed+3u)%4u,size);
}
fn sc_place(slot:u32,priority:u32){
 field_final=true;if slot>=sc_cap()||(f.scenery.x<0.5&&f.scenery.y<0.5){return;}
 let side=sc_side();let bank=slot/sc_face_cap();let cell=slot%sc_face_cap();let eye=f.eye_hi.xyz+f.eye_lo.xyz;
 let outer=sc_face_project(bank,eye).z<0.0;let face=bank^u32(outer);let chart=sc_face_project(face,eye);
 if chart.z<length(eye)*0.45{return;}let center_raw=vec2<i32>(floor((chart.xy/chart.z*0.5+0.5)*524288.0));
 let velocity=(f.eye_hi.xyz-f.prev_hi.xyz)+(f.eye_lo.xyz-f.prev_lo.xyz);let predicted=sc_face_project(face,eye+clamp(velocity*4.0,vec3<f32>(-120),vec3<f32>(120)));let prediction=clamp(vec2<i32>((predicted.xy/predicted.z-chart.xy/chart.z)*262144.0),vec2<i32>(-8),vec2<i32>(8));let center=(center_raw/16)*16+prediction;
 let residue=vec2<i32>(i32(cell%u32(side)),i32(cell/u32(side)));let low=select(center,center/2,outer)-vec2<i32>(side/2);
 var c=low+((residue-low)%vec2<i32>(side)+vec2<i32>(side))%vec2<i32>(side);
 if outer{c=c*2+sc_outer_offset(face,c);}else if sc_outer_cell(face,c){return;}
 if any(c<vec2<i32>(0))||any(c>=vec2<i32>(524288)){return;}
 let ring=max(abs(c.x-center_raw.x),abs(c.y-center_raw.y));let band_index=select(select(2u,1u,ring<40),0u,ring<16);
 if priority!=band_index{return;}
 var key=vec4<u32>(face,vec2<u32>(c),sc_placement_revision());
 if field_measured(){
  if all(sc_instances[slot].key.xyz==key.xyz)&&sc_record_current(sc_instances[slot].key.w)&&((slot&15u)!=u32(f.scenery_work.y)||f.field_serial.z>sc_recheck_frames()){key.w=sc_instances[slot].key.w;}
  else{let at=sc_place_coord(c,sc_cell_hash(face,u32(c.x),u32(c.y)));key.w=(key.w&~65535u)|sc_place_token(cube_key(face,at.x,at.y));}
 }
 if all(sc_instances[slot].key==key)&&sc_instances[slot].identity.w==bitcast<u32>(f.geo.z){return;}
 let old=sc_instances[slot];if sc_record_current(old.key.w)&&(old.key.w==key.w||any(old.key.xyz!=key.xyz))&&old.identity.w==bitcast<u32>(f.geo.z)&&sc_window_weight(old.key.xyz)>0.0{return;}
 let ticket=atomicAdd(&sc_state.requests,1u);if ticket>=u32(f.scenery_work.x){atomicAdd(&sc_state.deferred,1u);return;}
 let seed=sc_cell_hash(face,u32(c.x),u32(c.y));let coord=sc_place_coord(c,seed);let canonical=cube_key(face,coord.x,coord.y);
 let s=radial_sample(canonical,24u);let base=base_position(canonical);let slope=dot(s.normal.xyz,base.normal.xyz);let e=sc_eco(base.hi.xyz,base.lo.xyz,s.lo.w,slope);
 let uv=vec2<f32>(coord)/f32(Q);let area=pow(1.0+dot(uv,uv),-1.5);
 var choice=sc_choose(face,c,seed,canonical,s,e,slope,area);
 // Large outcrops on mapped Earth already belong to its measured terrain.
 if field_measured()&&f.solar.w<.5&&choice.kind==2u{choice.size=min(choice.size,3.0);}
 if f.cover.w>0.5{let sv=u32(f.cover.w)-1u;let tv=sc_tree_variants();
  if sv<tv&&choice.kind==1u{let sp=sv/sc_tree_ages();let age=sv%sc_tree_ages();choice.variant=sv;choice.size=sc_species_base(sp).height*(0.45+0.55*min(sc_age_value(age),1.0))*(1.0+0.18*max(sc_age_value(age)-1.0,0.0))*(0.9+0.2*sc_random(seed+4u));}
  if sv>=tv&&choice.kind==2u{choice.variant=sv;}}
 // Height and imagery page revisions can change a probabilistic ecology
 // choice or temporarily leave it without imagery. A published object owns
 // its species and dimensions while resident. Still respect mapped water.
 let resident=field_measured()&&sc_record_current(old.key.w)&&all(old.key.xyz==key.xyz)&&old.identity.w==bitcast<u32>(f.geo.z)&&old.contact.w>0.0005;
 var retain=resident;
 if retain&&f.solar.w<.5&&e.water<=0.0{
  let pos=page_pos(base.hi.xyz,base.lo.xyz);
  if measured_water_entry(pos,1.0)!=0u&&s.lo.w<measured_water_level(pos,1.0)+1.0{retain=false;choice.kind=0u;}
 }
 if retain{choice=ScChoice(u32(old.hi.w),u32(old.shape.z),old.shape.x);}
 if choice.kind==1u&&f.scenery.x<0.5{choice.kind=0u;}if choice.kind==2u&&f.scenery.y<0.5{choice.kind=0u;}
 // A rock on ground too steep for it is decided here, from the field alone, over its whole footprint.
 if field_measured()&&choice.kind==2u&&!retain{
  let ch=face_chart(canonical);let step=max(1,i32(choice.size*1.2/f.planet.x*f32(Q)));var spread=0.0;
  for(var j=0u;j<8u;j++){let a=f32(j)*0.785398;let d=vec2<i32>(vec2<f32>(cos(a),sin(a))*f32(step));spread=max(spread,abs(radial_sample(cube_key(u32(ch.x),ch.y+d.x,ch.z+d.y),24u).lo.w-s.lo.w));}
  if spread>choice.size*1.6{choice.kind=0u;}
 }
 let yaw=sc_random(seed+5u)*6.2831853;
 let again=field_measured()&&sc_record_current(old.key.w)&&all(old.key.xyz==key.xyz)&&old.identity.w==bitcast<u32>(f.geo.z)&&u32(old.hi.w)==choice.kind&&u32(old.shape.z)==choice.variant;
 // shape.w packs a random byte (wind phase, tint), moisture and nearness to water for the materials.
 let packed=f32((hash(seed+6u)&255u)|(u32(clamp(e.moist,0.0,1.0)*255.0)<<8u)|(u32(clamp(1.0-e.water/12.0,0.0,1.0)*255.0)<<16u));
 sc_instances[slot]=ScInstance(key,s.hi,s.lo,vec4<f32>(choice.size,yaw,f32(choice.variant),packed),select(vec4<f32>(0),old.support,again),vec4<u32>(bitcast<u32>(canonical.x),bitcast<u32>(canonical.y),bitcast<u32>(canonical.z),bitcast<u32>(f.geo.z)),select(vec4<f32>(0),old.contact,again));
 // A sharper height page changes the canonical root before the displayed
 // terrain has finished morphing. Preserve the old world-space support until
 // the bounded refresh pass visits this record. Its offset was relative to
 // the OLD root: reusing it unchanged lifts both the rock and its caster by
 // the full page-height delta for an arbitrary number of budgeted frames.
 if again{sc_instances[slot].contact.y+=old.lo.w-s.lo.w;}
 sc_instances[slot].hi.w=f32(choice.kind);sc_instances[slot].lo.w=s.lo.w;
 atomicAdd(&sc_state.generated,1u);
 sc_support_cache.stamps[slot]=0u;
}
// The band one placement dispatch serves (x: 0 near, 1 middle, 2 far). One program dispatched three times in that
// order, each with its own small uniform, so that the code compiles once, not once per band.
@group(0) @binding(175) var<uniform> sc_place_band:vec4<u32>;
@compute @workgroup_size(64) fn scenery_place(@builtin(global_invocation_id) id:vec3<u32>){sc_place(id.x,sc_place_band.x);}
// The same published proxy and canonical detail field support both terrain and
// props. Canonical radial anchors do not slide along camera rays as LOD changes.
fn sc_support(key:vec3<i32>)->vec4<f32>{
 let basis=basis_for(key,2u);var p=vec3<f32>(0);var total=0.0;
 for(var j=0u;j<3u;j++){if basis.weights[j]<=0.0{continue;}let slot=lookup_morph(key_from_sample(basis.ids[j]));if slot==NONE{return vec4<f32>(0,0,0,-1);}
  p+=relative(morph_sample(read_morph(slot),f.lod.x))*basis.weights[j];total+=basis.weights[j];}
 p/=max(0.000001,total);let weight=surface_relief_weight(p);
 if weight>0.0{
  let base=base_position(key);let anchor=relative(base);let detail=surface_detail_sample(anchor,surface_detail_footprint(p));
  let facing=smoothstep(0.04,0.12,-dot(detail.normal,normalize(p)));
  p=mix(p,anchor+base.normal.xyz*detail.height,weight*facing);
 }
 return vec4<f32>(p,1);
}
// Model to world (camera-relative) for a record: yaw, a seeded tilt and stretch, and the size.
fn sc_model(s:ScInstance)->mat3x3<f32>{
 let up=normalize(s.hi.xyz+s.lo.xyz);let b=sc_basis(up,s.shape.y);let h=hash(bitcast<u32>(i32(s.shape.y*1000.0))^u32(s.shape.z)*977u);
 if u32(s.hi.w)==1u{let w=0.9+0.2*sc_random(h);return mat3x3<f32>(b[0]*w*s.shape.x,b[1]*s.shape.x,b[2]*w*s.shape.x);}
 let st=vec3<f32>(0.85+0.3*sc_random(h),0.85+0.3*sc_random(h+1u),0.85+0.3*sc_random(h+2u))*s.shape.x;
 let ta=(sc_random(h+3u)-0.5)*0.4;let tb=(sc_random(h+4u)-0.5)*0.4;
 let tilt=mat3x3<f32>(vec3<f32>(cos(ta),sin(ta),0.0),vec3<f32>(-sin(ta)*cos(tb),cos(ta)*cos(tb),sin(tb)),vec3<f32>(sin(ta)*sin(tb),-cos(ta)*sin(tb),cos(tb)));
 return b*tilt*mat3x3<f32>(vec3<f32>(st.x,0,0),vec3<f32>(0,st.y,0),vec3<f32>(0,0,st.z));
}
fn sc_eco_byte(s:ScInstance,k:u32)->f32{return f32((u32(s.shape.w)>>(8u*k))&255u)/255.0;}
// Support over a footprint: the displayed surface at grid cells under the object, compared with the object's own lowest
// point over each cell (rocks: the generated bottom map; trees: a ring at the trunk), so that no part of the base floats.
// Returns the radial offset of the model origin from the centre support, the deepest burial and whether all samples resolved.
struct ScFoot {offset:f32,burial:f32,complete:bool,samples:u32}
fn sc_footprint(s:ScInstance,center:vec3<f32>,up:vec3<f32>,m:mat3x3<f32>,distance:f32)->ScFoot{
 let key=bitcast<vec3<i32>>(s.identity.xyz);let chart=face_chart(key);let kind=u32(s.hi.w);let variant=u32(s.shape.z);
 var out=ScFoot(1e9,0.0,true,0u);
 let tree=kind==1u;let species=select(0u,variant/sc_tree_ages(),tree);let log=tree&&species==SC_LOG;
 // The footprint is sampled as finely as a gap could show: large rocks near the eye on a 5 x 5 grid, medium ones and logs
 // 3 x 3, everything else within 600 m 2 x 2 (trees around the trunk), and beyond that the centre alone. Each sample is
 // a full support lookup on one thread, so the grid also bounds the slowest thread of the refresh pass.
 // One fixed pattern at every distance, as trees always had: the centre and four points inside the contact patch (logs
 // three along their length). A pattern that refined as the eye approached moved large rounded rocks by metres.
 var grid=2u;if log{grid=3u;}_=distance;
 let uv=vec2<f32>(chart.yz)/f32(Q);let units=f32(Q)/(f.planet.x*page_metric(uv));
 var lowest=1e9;var highest=-1e9;
 // The centre always counts, with the rock's lowest central point (the support already measured there), so that a finer
 // grid nearer the eye can only add contact on uneven ground and never moves a rock on even ground: without it, the 2 x 2
 // and finer grids miss that deepest point and a rock sinks a step each time the grid refines as the eye approaches.
 var deepest=0.0;
 {
  var bottom=0.0;
  if !tree{let r=variant-sc_tree_variants();var b=1e9;for(var k=0u;k<4u;k++){let cell=(3u+(k&1u))+(3u+(k>>1u))*8u;let v=atomicLoad(&sc_state.bottom[r*64u+cell]);if v!=0xffffffffu{b=min(b,sc_unorder_float(v));}}if b<1e8{bottom=b;}}
  let g=-dot(m*vec3<f32>(0.0,bottom,0.0),up);out.offset=g;lowest=g;highest=g;out.samples=1u;deepest=bottom;
 }
 for(var j=0u;j<select(grid,0u,grid==1u);j++){for(var i=0u;i<grid;i++){
  var x=select((f32(i)+0.5)/f32(grid)*2.0-1.0,0.0,grid==1u);var z=select((f32(j)+0.5)/f32(grid)*2.0-1.0,0.0,grid==1u);var bottom=0.0;
  if tree&&!log{let r=sc_species_base(species).radius*1.3;x*=r;z*=r;}
  else if log{x*=0.5;z*=0.04;}
  else{
   let r=variant-sc_tree_variants();x*=0.7;z*=0.7;let cell=vec2<u32>(clamp((vec2<f32>(x,z)+1.4)/2.8*8.0,vec2<f32>(0.0),vec2<f32>(7.0)));
   let b=atomicLoad(&sc_state.bottom[r*64u+cell.y*8u+cell.x]);if b==0xffffffffu{continue;}bottom=sc_unorder_float(b);
   // Rocks rest on their lowest part: the samples lie within 0.35 model units of the centre, where a rounded rock's
   // bottom is near its deepest, never at its curved-up edges.
   _=deepest;
  }
  let w=m*vec3<f32>(x,bottom,z);let tangent=w-up*dot(w,up);
  let dx=vec2<i32>(i32(round(dot(tangent,sc_chart_u(key,up))*units)),i32(round(dot(tangent,sc_chart_v(key,up))*units)))&vec2<i32>(-2);
  let sample=sc_support(cube_key(u32(chart.x),chart.y+dx.x,chart.z+dx.y));
  out.samples+=1u;
  if sample.w<0.0{out.complete=false;continue;}
  // The origin may sit no higher than the ground less that cell's bottom anywhere: nothing floats.
  let g=dot(sample.xyz-center,up)-dot(w,up);
  out.offset=min(out.offset,g);lowest=min(lowest,g);highest=max(highest,g);
 }}
 if out.offset>1e8{out.offset=0.0;lowest=0.0;highest=0.0;}
 out.burial=highest-lowest;
 return out;
}
// Chart axes at a key, in the body frame: the directions in which the integer chart coordinates grow.
fn sc_chart_u(key:vec3<i32>,up:vec3<f32>)->vec3<f32>{let c=face_chart(key);var a=vec3<f32>(0);switch u32(c.x){case 0u:{a=vec3<f32>(0,0,-1);}case 1u:{a=vec3<f32>(0,0,1);}case 2u,3u,4u:{a=vec3<f32>(1,0,0);}default:{a=vec3<f32>(-1,0,0);}}return normalize(a-up*dot(a,up));}
fn sc_chart_v(key:vec3<i32>,up:vec3<f32>)->vec3<f32>{let c=face_chart(key);var a=vec3<f32>(0);switch u32(c.x){case 0u,1u,4u,5u:{a=vec3<f32>(0,1,0);}case 2u:{a=vec3<f32>(0,0,-1);}default:{a=vec3<f32>(0,0,1);}}return normalize(a-up*dot(a,up));}
// Level of detail as a continuous value: trees 0 (finest) .. 3 (impostor), rocks 0 .. 2.
fn sc_lod_value(tree:bool,pixels:f32)->f32{
 let d=max(f.scenery.w,0.25);let p=pixels*d;
 if tree{if p>420.0{return 0.0;}if p>330.0{return (420.0-p)/90.0;}if p>140.0{return 1.0;}if p>110.0{return 1.0+(140.0-p)/30.0;}if p>42.0{return 2.0;}if p>24.0{return 2.0+(42.0-p)/18.0;}return 3.0;}
 if p>160.0{return 0.0;}if p>120.0{return (160.0-p)/40.0;}if p>42.0{return 1.0;}if p>24.0{return 1.0+(42.0-p)/18.0;}return 2.0;
}
fn sc_object_lod(s:ScInstance,distance:f32,captured:bool)->f32{
 let tree=u32(s.hi.w)==1u;let top=select(2.0,3.0,tree);
 let pixels=s.shape.x*select(1.4,1.0,tree)*f.view.y/(max(1.0,distance)*2.0*f.view.w);
 var lod=sc_lod_value(tree,pixels);
 switch f.scenery_limits.z{case 1u:{lod=0.0;}case 2u:{lod=top;}case 3u:{lod=1.0;}case 4u:{lod=select(1.0,2.0,tree);}default:{}}
 if !captured{lod=min(lod,top-1.0);}return lod;
}
fn sc_append(k:u32,slot:u32){let i=atomicAdd(&sc_state.class_count[k],1u);if i<min(sc_list_cap(k),f.scenery_limits.x){sc_visible[sc_list_base(k)+i]=slot;}else{atomicAdd(&sc_state.overflow,1u);}}
// Culling in three passes, so that the heavy support code (displayed surface, footprint) never weighs on the scan over every
// record: classify (which records need support measured again), refresh (only those, at most SC_REFRESH_CAP a frame), then
// the light pass that fades, chooses the level of detail and fills the draw lists.
@group(0) @binding(154) var<storage,read_write> sc_refresh:array<u32>;
const SC_REFRESH_CAP:u32=65536u;
struct ScCulled {valid:bool,s:ScInstance,root:vec3<f32>,distance:f32,variant:u32,kind:u32}
fn sc_cull_record(slot:u32)->ScCulled{
 var out:ScCulled;out.valid=false;
 if slot>=sc_cap()||(f.scenery_limits.w!=0u&&slot+1u!=f.scenery_limits.w){return out;}let s=sc_instances[slot];let kind=u32(s.hi.w);
 if kind==0u||!sc_record_current(s.key.w)||s.identity.w!=bitcast<u32>(f.geo.z){return out;}
 let variant=u32(s.shape.z);if variant>=sc_state.variants{return out;}
 if (kind==1u&&f.scenery.x<0.5)||(kind==2u&&f.scenery.y<0.5)||sc_random(sc_cell_hash(s.key.x,s.key.y,s.key.z)+8u)>f.scenery.z{return out;}
 let root=(s.hi.xyz-f.eye_hi.xyz)+(s.lo.xyz-f.eye_lo.xyz)-f.eye_tail.xyz;
 return ScCulled(true,s,root,length(root),variant,kind);
}
fn sc_reusable(slot:u32,s:ScInstance)->bool{let serial=sc_support_cache.stamp_key.x;return s.contact.w>0.0&&serial!=0u&&serial!=0xffffffffu&&sc_support_cache.stamps[slot]==serial;}
@compute @workgroup_size(64)
fn scenery_classify(@builtin(global_invocation_id) id:vec3<u32>){
 if id.x>=sc_cap(){return;}
 // Rotate admission when support work exceeds its fixed budget. Dense lunar
 // rock fields must not permanently starve the same tail of the instance table.
 let slot=(id.x+(terrain.frame_count%64u)*SC_REFRESH_CAP)%sc_cap();let c=sc_cull_record(slot);if !c.valid{return;}
 // Retire the contact as well as the draw: shadow casters share this record.
 if urban_blocked(c.s.hi.xyz,c.s.lo.xyz,select(min(12.0,c.s.shape.x*1.5),min(12.0,c.s.shape.x*.15+1.0),c.kind==1u)){sc_instances[slot].contact.w=0.0;return;}
 if sc_prop_pixels(c.s,c.distance)<0.14{if c.s.contact.w>0.0{sc_instances[slot].contact.w=0.0;}return;}
 if sc_state.ready[c.variant]<2u{atomicStore(&sc_state.wanted[c.variant],1u);}
 if sc_state.ready[c.variant]==0u{return;}
 if !sc_reusable(slot,c.s){let i=atomicAdd(&sc_state.refresh_count,1u);if i<SC_REFRESH_CAP{sc_refresh[i]=slot;}else{atomicAdd(&sc_state.deferred,1u);}}
}
@compute @workgroup_size(64)
fn scenery_refresh(@builtin(global_invocation_id) id:vec3<u32>){
 if id.x>=min(atomicLoad(&sc_state.refresh_count),SC_REFRESH_CAP){return;}let slot=sc_refresh[id.x];let c=sc_cull_record(slot);if !c.valid{return;}
 let s=c.s;let root=c.root;let distance=c.distance;let variant=c.variant;let tree=c.kind==1u;let up=normalize(s.hi.xyz+s.lo.xyz);let serial=sc_support_cache.stamp_key.x;
 atomicAdd(&sc_state.support_refreshed,1u);sc_support_cache.stamps[slot]=0u;
 var support=sc_support(bitcast<vec3<i32>>(s.identity.xyz));var complete=support.w>=0.0;
 if support.w<0.0{atomicAdd(&sc_state.support_error,1u);if s.contact.w==0.0{return;}support=vec4<f32>(root+up*s.contact.y,1);}
 let delta=length(support.xyz-root);atomicMax(&sc_state.max_contact,bitcast<u32>(delta));
 // Do not publish props on a cold coarse shell hundreds of metres from their canonical support.
 if delta>max(max(2.0,s.shape.x*0.25),distance*0.004)&&s.contact.w==0.0{atomicAdd(&sc_state.support_error,1u);return;}
 let foot=sc_footprint(s,support.xyz,up,sc_model(s),distance);
 // A footprint sample the published surface cannot answer yet is counted, and the record waits for a change of the
 // terrain before trying again rather than repeating the full footprint every frame.
 if !foot.complete{atomicAdd(&sc_state.footprint_rejected,1u);if s.contact.w==0.0{return;}}
 // A steep footprint: rocks too buried to read as rocks are rejected; trees sink their root flare.
 if !field_measured()&&!tree&&foot.burial>s.shape.x*1.1&&s.contact.w==0.0{atomicAdd(&sc_state.footprint_rejected,1u);return;}
 let species=select(0u,variant/sc_tree_ages(),tree);
 let settle=select(select(0.06,0.25,f.solar.w>0.5),0.0,tree)*s.shape.x+select(0.0,0.08+0.02*s.shape.x,tree&&species!=SC_LOG)+select(0.0,0.012*s.shape.x,tree&&species==SC_LOG);
 // contact.x holds the sinking below the centre support; contact.z the spread of the ground under the footprint; a
 // record published for the first time is marked 0.0005 until the light pass starts its fade.
 let burial=settle-foot.offset;
 sc_instances[slot].contact=vec4<f32>(burial,dot(support.xyz-root,up),foot.burial,select(s.contact.w,0.0005,s.contact.w==0.0));
 sc_instances[slot].support=vec4<f32>(support.xyz-up*burial,s.support.w);
 if complete&&!sc_support_moving(){sc_support_cache.stamps[slot]=serial;}
}
@compute @workgroup_size(64)
fn scenery_cull(@builtin(global_invocation_id) id:vec3<u32>){
 let slot=id.x;let c=sc_cull_record(slot);if !c.valid||sc_state.ready[c.variant]==0u||c.s.contact.w<=0.0{return;}
 var s=c.s;let kind=c.kind;let variant=c.variant;let root=c.root;let distance=c.distance;
 if urban_blocked(s.hi.xyz,s.lo.xyz,select(min(12.0,s.shape.x*1.5),min(12.0,s.shape.x*.15+1.0),kind==1u)){return;}
 atomicAdd(&sc_state.resident,1u);if kind==1u{atomicAdd(&sc_state.trees,1u);}else{atomicAdd(&sc_state.rocks,1u);}
 if sc_reusable(slot,s){atomicAdd(&sc_state.support_reused,1u);}
 let tree=kind==1u;let up=normalize(s.hi.xyz+s.lo.xyz);
 // Contact offsets are body-fixed; support.xyz is only a render-space cache.
 // Even records awaiting a support refresh must follow camera translation.
 // Otherwise an over-budget record keeps yesterday's screen-space position.
 s.support=vec4<f32>(root+up*(s.contact.y-s.contact.x),s.support.w);
 sc_instances[slot].support=s.support;
 let radius=s.shape.x*(bitcast<f32>(atomicLoad(&sc_state.bounds[variant]))+0.2)*select(1.25,1.12,tree);let center=root+up*(s.contact.y-s.contact.x+select(0.0,0.5*s.shape.x,tree));let z=dot(center,f.forward.xyz);
 let in_view=!(z+radius<0.1||abs(dot(center,f.right.xyz))>max(0.0,z)*f.view.z*f.view.w+radius*2.0||abs(dot(center,f.up.xyz))>max(0.0,z)*f.view.w+radius*2.0);
 let seed=sc_cell_hash(s.key.x,s.key.y,s.key.z);
 let weight=sc_window_weight(s.key.xyz)*sc_pixel_weight(2.0*sc_prop_pixels(s,distance));
 let goal=select(0.0005,1.0,sc_admitted(weight+.035*s.contact.w,seed+42839u));
 let appearance=sc_fade_toward(s.contact.w,goal,0.48);
 sc_instances[slot].contact.w=appearance;
 if appearance<=0.0005{return;}
 let top=select(2.0,3.0,tree);let raw=sc_object_lod(s,distance,sc_variant_captured_rw(variant));
 // Keep a settled representation through a small size deadband. During a
 // transition both draw lists use the same evolving level and pixel mask.
 let current=s.support.w;var wanted=round(raw);
 if abs(current-round(current))<0.0001&&abs(raw-current)<0.58{wanted=current;}
 let lod=select(sc_fade_toward(current,wanted,0.22),wanted,s.contact.w<=0.0005||f.scenery_limits.z!=0u);
 sc_instances[slot].support.w=lod;
 if !in_view{return;}
 if !tree{sc_append(select(select(3u,4u,lod>=1.0),14u,lod>=2.0),slot);return;}
 let lo=u32(floor(lod));let hi=u32(ceil(lod));
 for(var k=lo;k<=hi;k++){
  if k>=u32(top){sc_append(5u,slot);}else{sc_append(select(3u+k,k,tree),slot);}
 }
}
fn sc_variant_captured_rw(v:u32)->bool{return sc_state.ready[v]>=2u;}
// After culling: the instance counts of the indirect draws.
@compute @workgroup_size(1)
fn scenery_draws(){
 for(var k=0u;k<5u;k++){atomicStore(&sc_state.args[k*8u+1u],min(atomicLoad(&sc_state.class_count[k]),min(sc_list_cap(k),f.scenery_limits.x)));}
 atomicStore(&sc_state.args[14u*8u+1u],min(atomicLoad(&sc_state.class_count[14]),min(sc_list_cap(14u),f.scenery_limits.x)));
 atomicStore(&sc_state.args[5u*8u+1u],min(atomicLoad(&sc_state.class_count[5u]),min(sc_list_cap(5u),f.scenery_limits.x)));
}

// ---- Drawing
struct ScSurface {
 @builtin(position) clip:vec4<f32>,
 @location(0) p:vec3<f32>,
 @location(1) n:vec3<f32>,
 @location(2) t:vec3<f32>,
 @location(3) uv:vec2<f32>,
 @location(4) @interpolate(flat) info:vec4<u32>,
 @location(5) local:vec3<f32>,
 @location(6) shade:vec4<f32>,
 @location(7) @interpolate(flat) misc:vec4<f32>,
 @location(8) @interpolate(flat) up:vec3<f32>,
 @location(9) @interpolate(flat) toward:vec3<f32>,
}
// Wind in three layers, bounded: the whole tree sways (quadratic in height), each limb bends with its own phase, and
// cards flutter. Bound in model units at full controls: 0.018 * 1.69 * 3 + 0.02 * 3 + 0.006 * 3 < 0.2 (culling margin).
fn sc_wind_dir(yaw:f32)->vec3<f32>{let speed=length(f.wind.xy);let wind=f.wind.xy/max(0.001,speed);return vec3<f32>(wind.x*cos(yaw)+wind.y*sin(yaw),0,-wind.x*sin(yaw)+wind.y*cos(yaw));}
fn sc_wind_model(v:ScV,phase:f32,yaw:f32)->vec3<f32>{
 let speed=length(f.wind.xy);let gain=f.scenery_work.z*min(1.5,speed/8.0);if gain<=0.0{return v.p;}
 let dir=sc_wind_dir(yaw);let t=f.planet.w;
 let sway=0.75*sin(t*1.1)+0.25*sin(t*1.7+phase*6.2831853);
 var p=v.p+dir*0.018*sway*v.p.y*max(v.p.y,0.0)*gain;
 let lp=v.phase*6.2831853+phase*3.0;
 let branch=(0.6*sin(t*2.3+lp)+0.4*sin(t*3.7+lp*1.3))*0.02*v.bend*gain;
 p+=dir*branch+vec3<f32>(0,1,0)*branch*0.35;
 let flutter=sin(t*9.0+lp*5.0+dot(v.p,vec3<f32>(31.0,17.0,23.0)))*0.006*v.flutter*gain;
 p+=v.n*flutter;
 return p;
}
fn sc_project(p:vec3<f32>)->vec4<f32>{return camera_clip(p);}
fn sc_species_of(variant:u32)->u32{return select(sc_rock_family(variant-sc_render_state.tree_variants),variant/max(sc_render_state.ages,1u),sc_tree_variant(variant));}
fn sc_instance_seed(s:ScInstance)->u32{return sc_cell_hash(s.key.x,s.key.y,s.key.z);}
@vertex fn scenery_mesh(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->ScSurface{
 let cls=vertex>>24u;let local=vertex&0xffffffu;let index=sc_draws[sc_list_base(select(cls,14u,cls==11u))+instance];let s=sc_objects[index];let variant=u32(s.shape.z);
 var v:ScV;if cls>=3u{v=sc_rock_vertex(cls,variant,local,s.support.w);}else{v=sc_vertex(cls,variant,local);}let m=sc_model(s);let up=normalize(s.hi.xyz+s.lo.xyz);
 let wp=sc_wind_model(v,sc_eco_byte(s,0u),s.shape.y);let p=s.support.xyz+m*wp;
 let nm=normalize(m*(v.n/vec3<f32>(dot(m[0],m[0]),dot(m[1],m[1]),dot(m[2],m[2]))));
 let tree=u32(s.hi.w)==1u;let k=select(cls-3u,cls,cls<3u);
 var out:ScSurface;out.clip=sc_project(p);out.p=p;out.n=nm;out.t=normalize(m*v.t);out.uv=v.uv;
 out.info=vec4<u32>(v.material|(sc_species_of(variant)<<8u)|(v.aux<<16u),index,sc_instance_seed(s),k|(v.order<<8u));
 out.local=v.p;out.shade=vec4<f32>(v.ao,v.radius*s.shape.x,v.uv.y*2.0*s.shape.x,s.support.w);
 out.up=up;out.toward=vec3<f32>(0);
 out.misc=vec4<f32>(sc_eco_byte(s,1u),sc_eco_byte(s,2u),s.shape.x,select(sc_visibility(s),1.0,f.scenery_limits.z!=0u));
 _=up;_=tree;
 return out;
}
struct ScGbuffer {@location(0) p:vec4<f32>,@location(1) n:vec4<f32>,@location(2) material:vec4<f32>,@builtin(frag_depth) depth:f32}
fn sc_dither(pixel:vec2<f32>,index:u32)->f32{
 let q=vec2<u32>(pixel);
 return fract(sc_random(q.x^hash(q.y^index))+f32(f.cloud_cache.x%64u)*(39.0/64.0));
}
// Whether this class draws this pixel of an object between two levels (complementary dithering).
fn sc_lod_keep(k:u32,lod:f32,d:f32)->bool{let b=floor(lod);let fr=lod-b;if f32(k)==b{return d>=fr;}if f32(k)==b+1.0{return d<fr;}return false;}
struct ScShaded {albedo:vec3<f32>,rough:f32,normal:vec3<f32>,tag:f32,alpha:f32}
fn sc_leaf_sample(layer:u32,uv:vec2<f32>)->array<vec4<f32>,2>{
 let c=textureSample(sc_leaf_color,sc_leaf_sampler,uv,i32(layer));let n=textureSample(sc_leaf_normal,sc_leaf_sampler,uv,i32(layer));return array<vec4<f32>,2>(c,n);
}
fn sc_leaf_sample_level(layer:u32,uv:vec2<f32>,lod:f32)->array<vec4<f32>,2>{
 let c=textureSampleLevel(sc_leaf_color,sc_leaf_sampler,uv,i32(layer),lod);let n=textureSampleLevel(sc_leaf_normal,sc_leaf_sampler,uv,i32(layer),lod);return array<vec4<f32>,2>(c,n);
}
// The material of a prop fragment. `facing` is the view direction toward the eye (or the capture eye).
fn sc_surface(v:ScSurface,front:bool,facing:vec3<f32>,leaf:array<vec4<f32>,2>)->ScShaded{
 let material=v.info.x&255u;let species=(v.info.x>>8u)&255u;let aux=v.info.x>>16u;let seed=v.info.z;
 var n=normalize(v.n);let t=normalize(v.t-n*dot(v.t,n));let b=cross(n,t);
 var out=ScShaded(vec3<f32>(0.2),0.9,n,-101.0,1.0);
 let dx=dpdx(v.p);let dy=dpdy(v.p);let footprint=max(length(dx),length(dy));
 let local_dx=dpdx(v.local)*max(v.misc.z,.05);let local_dy=dpdy(v.local)*max(v.misc.z,.05);
 switch material{
  case 1u,9u:{
   // Bark along the branch: x around (metres), y along (metres).
   let x=v.uv.x*6.2831853*max(v.shade.y,0.002);let y=v.shade.z;
   let m=sc_bark(min(aux&15u,SC_SPECIES-1u),x,y,v.local.y,v.shade.y,footprint,seed,material==9u);
   out.albedo=m.albedo*v.shade.x;out.rough=m.rough;out.normal=normalize(n-t*m.bump.y-b*m.bump.x);out.tag=-101.0;
  }
  case 2u,7u:{
   // A leaf or fern card from the species' layer of the twig atlas.
   let layer=select(aux&15u,SC_FERN_LAYER,material==7u);
   let c=leaf[0];out.alpha=c.a;
   let tint=0.88+0.24*sc_random(seed+11u);var col=c.rgb*c.rgb*tint*vec3<f32>(1.0+0.08*(sc_random(seed+12u)-0.5),1.0,1.0-0.1*sc_random(seed+13u));
   // The underside of a leaf is paler.
   if !front{col=mix(col,dot(col,vec3<f32>(0.33))*vec3<f32>(1.1,1.2,0.9),0.35)*1.12;}
   out.albedo=col*v.shade.x;out.rough=0.62;
   let tn=vec3<f32>(leaf[1].xy*2.0-1.0,0.0);let side=select(-1.0,1.0,front);
   let facing_n=n*side;out.normal=normalize(facing_n*0.8+(t*tn.y+b*tn.x)*0.6);
   let transl=clamp(leaf[1].z,0.0,1.0)*sc_species_base(layer).translucency*2.0;
   out.tag=-102.0-0.45*clamp(transl,0.0,1.0);
  }
  case 3u,6u:{
   let fam=select(species,aux&15u,material==6u);let low=clamp(v.local.y*0.5+0.5,0.0,1.0);
   let local=v.local*max(v.misc.z,0.05)+select(vec3<f32>(0),vec3<f32>(f32(aux>>4u)*13.1),material==6u);
   let m=sc_rock_material(select(fam,2u,material==6u),local,dot(n,sc_surface_up(v)),seed,v.misc.x,v.misc.y,f.solar.w>0.5,footprint,low);
   var col=m.albedo;if f.solar.w>2.5{col=mix(col,vec3<f32>(0.62,0.66,0.7),0.75);}
   let tx=cross(dy,n);let ty=cross(n,dx);let det=dot(dx,tx);
   let gradient=(tx*dot(local_dx,m.gradient)+ty*dot(local_dy,m.gradient))*select(-1.0,1.0,det>=0.0)/max(abs(det),1e-10);
   out.albedo=col*v.shade.x;out.rough=m.rough;out.normal=normalize(n-gradient/max(1.0,length(gradient)*3.0));out.tag=-103.0;
  }
  case 4u,5u:{
   // Grass blades and reeds: base darker, tips lighter and drier.
   let h=v.uv.y;let dry=sc_random(seed+aux*7u+3u);var col=mix(vec3<f32>(0.035,0.07,0.018),vec3<f32>(0.10,0.15,0.035),h);
   col=mix(col,vec3<f32>(0.21,0.18,0.08),dry*dry*0.6*h);
   if material==5u{col=select(mix(vec3<f32>(0.05,0.08,0.025),vec3<f32>(0.14,0.15,0.06),h),vec3<f32>(0.09,0.05,0.025),(aux&16u)!=0u);}
   out.albedo=col*v.shade.x*(0.85+0.3*sc_random(seed+19u));out.rough=0.7;out.normal=normalize(select(-n,n,front)*0.7+sc_surface_up(v)*0.5);
   // Reeds carry their own tag (-102.4375, exact in half precision) so the water gate can tell them from grass.
   out.tag=select(-102.375,-102.4375,material==5u);
  }
  case 8u:{
   let q=v.uv*2.0-1.0;let r=length(q);let petals=0.75+0.25*cos(atan2(q.y,q.x)*5.0);if r>petals{out.alpha=0.0;}
   let hue=(aux>>4u)%3u;var col=select(select(vec3<f32>(0.75,0.72,0.66),vec3<f32>(0.78,0.6,0.08),hue==1u),vec3<f32>(0.4,0.22,0.6),hue==2u);if r<0.25{col=vec3<f32>(0.7,0.5,0.05);}
   out.albedo=col;out.rough=0.6;out.normal=sc_surface_up(v);out.tag=-102.3;
  }
  default:{out.alpha=0.0;}
 }
 return out;
}
fn sc_up(p:vec3<f32>)->vec3<f32>{return normalize(f.eye_hi.xyz+f.eye_lo.xyz+p);}
fn sc_surface_up(v:ScSurface)->vec3<f32>{return select(sc_up(v.p),v.up,dot(v.toward,v.toward)>0.5);}
fn sc_leaf_uv(v:ScSurface)->vec2<f32>{let quad=((v.info.x>>16u)>>4u)&3u;return vec2<f32>((f32(quad&1u)+clamp(v.uv.x,0.0,1.0))*0.5,(f32(quad>>1u)+1.0-clamp(v.uv.y,0.0,1.0))*0.5);}
@fragment fn scenery_mesh_fragment(v:ScSurface,@builtin(front_facing) front:bool)->ScGbuffer{
 if sc_dither(v.clip.xy,v.info.y+42931u)>=v.misc.w{discard;}
 let morph_rock=(v.info.x&255u)==SM_ROCK;
 if !morph_rock&&!sc_lod_keep(v.info.w&255u,v.shade.w,sc_dither(v.clip.xy,v.info.y)){discard;}
 let material=v.info.x&255u;let layer=select((v.info.x>>16u)&15u,SC_FERN_LAYER,material==7u);
 let leaf=sc_leaf_sample(layer,sc_leaf_uv(v));
 let m=sc_surface(v,front,normalize(-v.p),leaf);
 if (material==2u||material==7u)&&m.alpha<0.5{discard;}
 if material==8u&&m.alpha<0.5{discard;}
 var n=m.normal;if (material==2u||material==4u||material==5u||material==7u)&&dot(n,-v.p)<0.0{n=-n;}
 return ScGbuffer(vec4<f32>(v.p,sc_radial_height(v.p)),vec4<f32>(n,m.tag),vec4<f32>(m.albedo,m.rough),0.1/max(0.1,dot(v.p,f.forward.xyz)));
}
// Raster captures read the compute-generated vertex buffer directly. Model normals are stored linearly; depth is signed
// distance toward the capture eye. A capture renders into one scratch target, copied into the variant's layer after.
@vertex fn scenery_capture(@builtin(vertex_index) vertex:u32,@builtin(instance_index) view:u32)->ScSurface{
 let variant=sc_render_state.job_index;var out:ScSurface;if sc_render_state.job_kind!=4u{out.clip=vec4<f32>(2,2,0,1);return out;}
 let cls=vertex>>24u;let local=vertex&0xffffffu;let v=sc_vertex(cls,variant,local);let tree=sc_tree_variant(variant);
 let extent=bitcast<f32>(sc_render_state.bounds[variant]);let cell=vec2<i32>(i32(view%8u),i32(view/8u));let frame=sc_view(sc_cell_dir(cell));let p=v.p-sc_center(tree);
 let q=vec2<f32>(dot(p,frame[0]),dot(p,frame[1]))/extent;let uv=(vec2<f32>(cell)+vec2<f32>(q.x*0.5+0.5,0.5-q.y*0.5))/8.0;
 out.clip=vec4<f32>(uv.x*2.0-1.0,1.0-uv.y*2.0,0.5-dot(p,frame[2])/(2.0*extent),1);
 out.p=v.p;out.n=v.n;out.t=v.t;out.uv=v.uv;out.info=vec4<u32>(v.material|(sc_species_of(variant)<<8u)|(v.aux<<16u),0u,hash(variant*31u),select(cls-3u,cls,cls<3u));
 let size=select(2.0,sc_species_base(min(sc_species_of(variant),SC_SPECIES-1u)).height,tree);
 out.local=v.p;out.shade=vec4<f32>(v.ao,v.radius*size,v.uv.y*2.0*size,0.0);out.misc=vec4<f32>(0.5,0.0,size,1.0);
 out.up=vec3<f32>(0,1,0);out.toward=frame[2];return out;
}
struct ScAtlas {@location(0) color:vec4<f32>,@location(1) normal:vec4<f32>}
@fragment fn scenery_capture_fragment(v:ScSurface,@builtin(front_facing) front:bool)->ScAtlas{
 let material=v.info.x&255u;let layer=select((v.info.x>>16u)&15u,SC_FERN_LAYER,material==7u);
 let leaf=sc_leaf_sample_level(layer,sc_leaf_uv(v),1.0);
 let m=sc_surface(v,front,vec3<f32>(0,0,1),leaf);if (material==2u||material==7u)&&m.alpha<0.5{discard;}
 let extent=bitcast<f32>(sc_render_state.bounds[sc_render_state.job_index]);
 // The capture eye looks along -frame[2]: two-sided surfaces face it, as drawn ones face the camera.
 var n=m.normal;if (material==2u||material==4u||material==5u||material==7u)&&dot(n,v.toward)<0.0{n=-n;}
 return ScAtlas(vec4<f32>(m.albedo,1),vec4<f32>(n,(0.5-v.clip.z)*2.0*extent+select(0.0,0.0,front)));
}
@group(0) @binding(147) var sc_capture_color:texture_2d<f32>;
@group(0) @binding(148) var sc_capture_normal:texture_2d<f32>;
@compute @workgroup_size(8,8)
fn scenery_capture_copy(@builtin(global_invocation_id) id:vec3<u32>){
 if sc_state.job_kind!=4u||any(id.xy>=textureDimensions(sc_color_out)){return;}let layer=i32(sc_state.job_index);
 let c=textureLoad(sc_capture_color,vec2<i32>(id.xy),0);let n=textureLoad(sc_capture_normal,vec2<i32>(id.xy),0);let extent=bitcast<f32>(atomicLoad(&sc_state.bounds[sc_state.job_index]));
 textureStore(sc_color_out,vec2<i32>(id.xy),layer,select(vec4<f32>(0),vec4<f32>(sqrt(max(c.rgb,vec3<f32>(0))),1.0),c.a>0.5));
 textureStore(sc_normal_out,vec2<i32>(id.xy),layer,select(vec4<f32>(0.5,0.5,0.5,0.0),sc_nd_encode(n.xyz,n.w,extent),c.a>0.5));
}
@compute @workgroup_size(8,8)
fn scenery_mip(@builtin(global_invocation_id) id:vec3<u32>){
 if sc_state.job_kind!=4u||any(id.xy>=textureDimensions(sc_color_out)){return;}let xy=vec2<i32>(id.xy)*2;let layer=i32(sc_state.job_index);let extent=bitcast<f32>(atomicLoad(&sc_state.bounds[sc_state.job_index]));
 var color=vec4<f32>(0);var nd=vec4<f32>(0);
 for(var y=0;y<2;y++){for(var x=0;x<2;x++){let c=textureLoad(sc_color,xy+vec2<i32>(x,y),layer,0);color+=vec4<f32>(c.rgb*c.rgb,c.a);nd+=sc_nd_decode(textureLoad(sc_normal,xy+vec2<i32>(x,y),layer,0),extent)*c.a;}}
 color*=0.25;
 textureStore(sc_color_out,vec2<i32>(id.xy),layer,vec4<f32>(sqrt(color.rgb),color.a));
 textureStore(sc_normal_out,vec2<i32>(id.xy),layer,select(vec4<f32>(0.5,0.5,0.5,0.0),sc_nd_encode(nd.xyz,nd.w/max(color.a*4.0,1e-5),extent),color.a>0.0));
}
struct ScCard {@builtin(position) clip:vec4<f32>,@location(0) p:vec3<f32>,@location(1) n:vec3<f32>,@location(2) color:vec4<f32>,@location(3) uv:vec2<f32>,@location(4) @interpolate(flat) info:vec4<f32>,@location(5) local:vec3<f32>}
fn sc_inverse3(m:mat3x3<f32>)->mat3x3<f32>{
 let a=m[0];let b=m[1];let c=m[2];let r0=cross(b,c);let r1=cross(c,a);let r2=cross(a,b);let det=dot(a,r0);
 return transpose(mat3x3<f32>(r0,r1,r2))*(1.0/det);
}
@vertex fn scenery_card(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->ScCard{
 let index=sc_draws[sc_list_base(5u)+instance];let s=sc_objects[index];let tree=u32(s.hi.w)==1u;let m=sc_model(s);let mi=sc_inverse3(m);
 let center=s.support.xyz+m*sc_center(tree);let view=normalize(mi*(-center));let frame=sc_view(view);let extent=bitcast<f32>(sc_render_state.bounds[u32(s.shape.z)]);
 let corners=array<vec2<f32>,6>(vec2<f32>(-1,-1),vec2<f32>(1,-1),vec2<f32>(1,1),vec2<f32>(-1,-1),vec2<f32>(1,1),vec2<f32>(-1,1));let q=corners[vertex];let p=center+m*((frame[0]*q.x+frame[1]*q.y)*extent*1.08);
 return ScCard(sc_project(p),p,view,vec4<f32>(select(sc_visibility(s),1.0,f.scenery_limits.z!=0u),0,0,0),q,vec4<f32>(s.shape.z,s.support.w,f32(index),extent),view);
}
struct ScTap {color:vec4<f32>,nd:vec4<f32>}
fn sc_atlas_sample(cell:vec2<i32>,q:vec2<f32>,layer:i32,lod:i32,extent:f32)->ScTap{
 let px=i32(f.tier_c.y)>>u32(lod);let xy=vec2<f32>(cell*px)+clamp(vec2<f32>(q.x*0.5+0.5,0.5-q.y*0.5)*f32(px),vec2<f32>(0.5),vec2<f32>(f32(px)-0.5))-0.5;let a=vec2<i32>(floor(xy));let w=fract(xy);var color=vec4<f32>(0);var nd=vec4<f32>(0);
 for(var y=0;y<2;y++){for(var x=0;x<2;x++){let weight=select(1.0-w.x,w.x,x==1)*select(1.0-w.y,w.y,y==1);let coord=clamp(a+vec2<i32>(x,y),cell*px,(cell+1)*px-1);let t=textureLoad(sc_color,coord,layer,lod);let c=vec4<f32>(t.rgb*t.rgb,t.a);color+=c*weight;nd+=sc_nd_decode(textureLoad(sc_normal,coord,layer,lod),extent)*c.a*weight;}}
 return ScTap(color,nd/max(0.00001,color.a));
}
fn sc_atlas_lod(uv_size:f32)->i32{return i32(clamp(floor(log2(max(1.0,uv_size))),0.0,f32(textureNumLevels(sc_color))-1.0));}
@fragment fn scenery_card_fragment(v:ScCard)->ScGbuffer{
 let s=sc_objects[u32(v.info.z)];let tree=u32(s.hi.w)==1u;let m=sc_model(s);let frame=sc_view(normalize(v.n));let local=(frame[0]*v.uv.x+frame[1]*v.uv.y)*v.info.w*1.08;
 let cf=sc_oct_encode(normalize(v.n))*8.0-0.5;let origin=vec2<i32>(floor(cf));let fraction=fract(cf);var color=vec4<f32>(0);var normal=vec3<f32>(0);var point=vec3<f32>(0);var weight_sum=0.0;
 let lod=sc_atlas_lod(max(length(dpdx(v.uv)),length(dpdy(v.uv)))*f32(f.tier_c.y)*0.5);
 for(var y=0;y<2;y++){for(var x=0;x<2;x++){var cell=origin+vec2<i32>(x,y);if cell.x<0{cell=vec2<i32>(0,7-cell.y);}if cell.x>7{cell=vec2<i32>(7,7-cell.y);}if cell.y<0{cell=vec2<i32>(7-cell.x,0);}if cell.y>7{cell=vec2<i32>(7-cell.x,7);}cell=clamp(cell,vec2<i32>(0),vec2<i32>(7));let capture=sc_view(sc_cell_dir(cell));var q=vec2<f32>(dot(local,capture[0]),dot(local,capture[1]))/v.info.w;var tap=sc_atlas_sample(cell,q,i32(v.info.x),lod,v.info.w);
  // One bounded parallax correction along the runtime ray in model space.
  let denom=max(0.15,dot(frame[2],capture[2]));let t=(tap.nd.w-dot(local,capture[2]))/denom;let hit=local+frame[2]*t;q=vec2<f32>(dot(hit,capture[0]),dot(hit,capture[1]))/v.info.w;tap=sc_atlas_sample(cell,q,i32(v.info.x),lod,v.info.w);
  let w=select(1.0-fraction.x,fraction.x,x==1)*select(1.0-fraction.y,fraction.y,y==1);color+=tap.color*w;normal+=tap.nd.xyz*tap.color.a*w;point+=(local+frame[2]*(tap.nd.w-dot(local,capture[2]))/denom)*tap.color.a*w;weight_sum+=tap.color.a*w;
 }}
 if sc_dither(v.clip.xy,u32(v.info.z)+42931u)>=v.color.x{discard;}if color.a<0.45{discard;}
 let top=select(2u,3u,tree);if !sc_lod_keep(top,v.info.y,sc_dither(v.clip.xy,u32(v.info.z))){discard;}
 // The capture stored model-space points relative to the model centre at unit size; place them with the object's model.
 let p=s.support.xyz+m*(sc_center(tree)+point/max(0.0001,weight_sum));
 let n=normalize(transpose(sc_inverse3(m))*normal);
 let leafy=tree&&color.g>color.r*1.05;let material=select(3.0,select(1.0,2.0,leafy),tree);
 return ScGbuffer(vec4<f32>(p,sc_radial_height(p)),vec4<f32>(n,select(-100.0-material,-102.2,leafy)),vec4<f32>(color.rgb/max(0.0001,color.a),0.85),0.1/max(0.1,dot(p,f.forward.xyz)));
}

// Explicit diagnostic gathering from the ACTUAL index stream, independent of basis_for/lookup_morph. 64 objects x 18
// surrounding triangles at the centre (contact), fixed allocation.
@group(0) @binding(63) var<storage,read_write> sc_contact_probe:array<vec4<f32>>;
@compute @workgroup_size(64)
fn scenery_audit_contact(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if i>=64u{return;}let out=i*64u;sc_contact_probe[out+2u]=vec4<f32>(0);
 // The first 64 drawn objects over all classes, finest first.
 var k=0u;var j=i;loop{if k>=7u{return;}let cls=select(k,14u,k==6u);let n=min(atomicLoad(&sc_state.class_count[cls]),min(sc_list_cap(cls),f.scenery_limits.x));if j<n{k=cls;break;}j-=n;k++;}
 let s=sc_instances[sc_visible[sc_list_base(k)+j]];let key=bitcast<vec3<i32>>(s.identity.xyz);let node=find_leaf(key,2u);var patch_id=NONE;
 for(var q=0u;q<terrain.reserved[1].w;q++){if terrain.published_nodes[q]==node{patch_id=q;break;}}if patch_id==NONE{return;}
 let kk=terrain.nodes[node].key;let uv=on_face_key(key,kk.x);let global=vec2<u32>(uv+vec2<i32>(Q))/2u;let origin=vec2<i32>((global>>vec2<u32>(MAX_LEVEL-kk.y))-kk.zw*16u);var count=0u;
 for(var y=max(0,origin.y-1);y<=min(15,origin.y+1);y++){for(var x=max(0,origin.x-1);x<=min(15,origin.x+1);x++){for(var t=0u;t<2u;t++){for(var v=0u;v<3u;v++){let index=index_write[terrain.active_bank*2u*f.tier_c.w+patch_id*1536u+u32(y*16+x)*6u+t*3u+v];sc_contact_probe[out+4u+count*3u+v]=vec4<f32>(relative(morph_sample(read_morph(index),f.lod.x)),1);}count+=1u;}}}
 // support + contact.x is the canonical centre support: the model origin plus its sinking.
 sc_contact_probe[out]=s.support;sc_contact_probe[out+1u]=vec4<f32>(normalize(s.hi.xyz+s.lo.xyz),s.contact.x);sc_contact_probe[out+2u]=vec4<f32>(0,0,0,f32(count));sc_contact_probe[out+3u]=vec4<f32>((s.hi.xyz-f.eye_hi.xyz)+(s.lo.xyz-f.eye_lo.xyz)-f.eye_tail.xyz,1);
}
// Diagnostics: the published terrain under large rocks, for an independent check of contact over the whole footprint
// (scenery_reference.rs inspect_footprints). For each listed rock: its origin and model matrix, then for 7 x 7 columns
// over its footprint the canonical radial line and the 18 published triangles around it, from the ACTUAL index stream.
@group(0) @binding(151) var<storage,read_write> sc_footprint_probe:array<vec4<f32>>;
@group(0) @binding(152) var<storage,read> sc_footprint_slots:array<u32>;
const SC_FOOT_ROCKS:u32=16u;
const SC_FOOT_COLUMNS:u32=49u;
const SC_FOOT_WORDS:u32=2748u;
@compute @workgroup_size(64)
fn scenery_audit_footprint(@builtin(global_invocation_id) id:vec3<u32>){
 if id.x>=SC_FOOT_ROCKS*SC_FOOT_COLUMNS{return;}let r=id.x/SC_FOOT_COLUMNS;let p=id.x%SC_FOOT_COLUMNS;let block=r*SC_FOOT_WORDS;
 let slot=sc_footprint_slots[r];let out=block+4u+p*56u;sc_footprint_probe[out]=vec4<f32>(0);
 if slot==0xffffffffu{if p==0u{sc_footprint_probe[block]=vec4<f32>(0);}return;}
 let s=sc_objects[slot];let m=sc_model(s);let up=normalize(s.hi.xyz+s.lo.xyz);
 if p==0u{sc_footprint_probe[block]=vec4<f32>(s.support.xyz,s.shape.x);sc_footprint_probe[block+1u]=vec4<f32>(m[0],s.shape.z);sc_footprint_probe[block+2u]=vec4<f32>(m[1],s.hi.w);sc_footprint_probe[block+3u]=vec4<f32>(m[2],f32(slot));}
 let key=bitcast<vec3<i32>>(s.identity.xyz);let chart=face_chart(key);let uv=vec2<f32>(chart.yz)/f32(Q);let units=f32(Q)/(f.planet.x*page_metric(uv));
 let x=(f32(p%7u)+0.5)/7.0*2.4-1.2;let z=(f32(p/7u)+0.5)/7.0*2.4-1.2;let w=m*vec3<f32>(x,0.0,z);let tangent=w-up*dot(w,up);
 let dx=vec2<i32>(i32(round(dot(tangent,sc_chart_u(key,up))*units)),i32(round(dot(tangent,sc_chart_v(key,up))*units)))&vec2<i32>(-2);
 let at=cube_key(u32(chart.x),chart.y+dx.x,chart.z+dx.y);let node=find_leaf(at,2u);var patch_id=NONE;
 for(var q=0u;q<terrain.reserved[1].w;q++){if terrain.published_nodes[q]==node{patch_id=q;break;}}if patch_id==NONE{return;}
 let kk=terrain.nodes[node].key;let fuv=on_face_key(at,kk.x);let global=vec2<u32>(fuv+vec2<i32>(Q))/2u;let origin=vec2<i32>((global>>vec2<u32>(MAX_LEVEL-kk.y))-kk.zw*16u);var count=0u;
 for(var y=max(0,origin.y-1);y<=min(15,origin.y+1);y++){for(var xx=max(0,origin.x-1);xx<=min(15,origin.x+1);xx++){for(var t=0u;t<2u;t++){for(var v=0u;v<3u;v++){let index=index_write[terrain.active_bank*2u*f.tier_c.w+patch_id*1536u+u32(y*16+xx)*6u+t*3u+v];sc_footprint_probe[out+2u+count*3u+v]=vec4<f32>(relative(morph_sample(read_morph(index),f.lod.x)),1);}count+=1u;}}}
 let b=base_position(at);
 sc_footprint_probe[out]=vec4<f32>(relative(b),f32(count));sc_footprint_probe[out+1u]=vec4<f32>(b.normal.xyz,0.0);
}
