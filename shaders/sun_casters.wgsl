// GPU-only, camera-direction-independent caster compaction. Camera-facing
// cards are never used: distant atlas views are selected along the sun ray.
// Caster IDs per cascade stream come from the allocation tier (f.tier_a.w).
// Four streams per cascade: tree meshes, rock meshes, tree cards and far
// rock hulls. Three indexed draws and one card draw use 20 indirect words.
struct SunDrawState {args:array<atomic<u32>,120>,overflow:atomic<u32>,casters:atomic<u32>,incomplete:atomic<u32>,padding:u32}
@group(0) @binding(75) var<storage,read_write> sun_draw_state:SunDrawState;
@group(0) @binding(76) var<storage,read_write> sun_draw_write:array<u32>;
@group(0) @binding(77) var<storage,read> sun_draw_read:array<u32>;
@group(0) @binding(78) var<uniform> sun_layer:vec4<u32>;
fn sun_stream(c:u32,stream:u32)->u32{return (c*4u+stream)*f.tier_a.w;}
fn sun_caster_pixels(s:ScInstance,c:u32)->f32{return s.shape.x*f32(f.tier_b.x)*0.5/sf.centers[c].w;}
fn sun_mesh_weight(s:ScInstance,c:u32)->f32{
 if u32(s.hi.w)==2u||!sc_variant_captured(u32(s.shape.z)){return 1.0;}
 let pixels=sun_caster_pixels(s,c);
 return select(smoothstep(4.0,8.0,pixels),smoothstep(24.0,42.0,pixels),u32(s.hi.w)==1u);
}
fn sun_caster_weight(s:ScInstance,c:u32)->f32{
 // Sub-texel objects cannot carry a resolved silhouette in this map. Retire
 // them continuously before compaction, so far-map capacity cannot randomly
 // select which nearby shadows survive. This is a resolution limit, not an
 // invented replacement shadow; overflow remains reported separately.
 return sc_visibility(s)*smoothstep(0.2,0.6,sun_caster_pixels(s,c));
}
@compute @workgroup_size(1)
fn sun_caster_begin(){
 for(var i=0u;i<SUN_CASCADES*20u;i++){atomicStore(&sun_draw_state.args[i],0u);}
 for(var c=0u;c<SUN_CASCADES;c++){
  let o=c*20u;atomicStore(&sun_draw_state.args[o],sc_class_quads(2u)*6u);atomicStore(&sun_draw_state.args[o+2u],sc_class_first(2u));
  // Near casters use the visible rock's morphed geometry. The fine index
  // grid also collapses exactly to the coarse mesh without another draw list.
  // Private diagnostic 5 reproduces coarse casters for paired images.
  let rock_class=select(4u,3u,c<3u&&sf.control.y!=5.0);
  atomicStore(&sun_draw_state.args[o+5u],sc_class_quads(rock_class)*6u);atomicStore(&sun_draw_state.args[o+7u],sc_class_first(rock_class));
  atomicStore(&sun_draw_state.args[o+10u],6u);
  atomicStore(&sun_draw_state.args[o+14u],sc_class_quads(11u)*6u);atomicStore(&sun_draw_state.args[o+16u],sc_class_first(11u));
 }
 atomicStore(&sun_draw_state.overflow,0u);atomicStore(&sun_draw_state.casters,0u);var pending=0u;
 if f.scenery.x>0.5||f.scenery.y>0.5{pending=sc_render_state.counters[5]+sc_render_state.counters[7];for(var i=0u;i<sc_render_state.variants;i++){pending+=select(0u,1u,sc_render_state.ready[i]==0u);}}
 atomicStore(&sun_draw_state.incomplete,pending);
}
@compute @workgroup_size(64)
fn sun_caster_cull(@builtin(global_invocation_id) id:vec3<u32>){
 if sf.control.x<0.5||id.x>=sc_cap()||(f.scenery_limits.w!=0u&&id.x+1u!=f.scenery_limits.w){return;}let s=sc_objects[id.x];let kind=u32(s.hi.w);let variant=u32(s.shape.z);
 if kind==0u||s.contact.w<=0.0||!sc_record_current(s.key.w)||s.identity.w!=bitcast<u32>(f.geo.z)||!sc_variant_ready(variant){return;}
 if (kind==1u&&f.scenery.x<0.5)||(kind==2u&&f.scenery.y<0.5)||sc_random(sc_cell_hash(s.key.x,s.key.y,s.key.z)+8u)>f.scenery.z{return;}
 let coverage=sc_visibility(s);if coverage<=0.0{return;}let tree=kind==1u;let m=sc_model(s);let root=sun_caster_root(s);let center=root+m*sc_center(tree);
 let radius=s.shape.x*(bitcast<f32>(sc_render_state.bounds[variant])+0.2)*select(1.25,1.12,tree);
 let cascades=min(SUN_CASCADES,u32(sf.quality.x));
 for(var c=0u;c<cascades;c++){let q=sun_project(center,c);if max(abs(q.x),abs(q.y))>1.0+radius/sf.centers[c].w||abs(q.z-0.5)>0.49{continue;}
  if sun_caster_weight(s,c)<=0.0{continue;}
  let blend=sun_mesh_weight(s,c);
  for(var card=0u;card<2u;card++){if (card==0u&&blend<=0.0)||(card==1u&&blend>=1.0){continue;}
   let hull=!tree&&s.support.w>=2.0;let stream=select(select(select(1u,0u,tree),2u,card==1u),3u,hull);let word=c*20u+select(select(select(6u,1u,tree),11u,card==1u),15u,hull);
   let ticket=atomicAdd(&sun_draw_state.args[word],1u);if ticket<f.tier_a.w{sun_draw_write[sun_stream(c,stream)+ticket]=id.x;atomicAdd(&sun_draw_state.casters,1u);}else{atomicAdd(&sun_draw_state.overflow,1u);atomicMin(&sun_draw_state.args[word],f.tier_a.w);}
  }
 }
}
fn sun_caster_root(s:ScInstance)->vec3<f32>{let anchor=(s.hi.xyz-f.eye_hi.xyz)+(s.lo.xyz-f.eye_lo.xyz)-f.eye_tail.xyz;return anchor+normalize(s.hi.xyz+s.lo.xyz)*(s.contact.y-s.contact.x);}
fn sun_clip(p:vec3<f32>)->vec4<f32>{return vec4<f32>(sun_project(p,sun_layer.x),1);}
struct SunSurface {@builtin(position) clip:vec4<f32>,@location(0) uv:vec2<f32>,@location(1) @interpolate(flat) info:vec4<u32>,@location(2) blend:vec2<f32>}
@vertex fn sun_mesh_vertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->SunSurface{
 let cls=vertex>>24u;let local=vertex&0xffffffu;let stream=select(select(1u,0u,cls<3u),3u,cls==11u);
 let index=sun_draw_read[sun_stream(sun_layer.x,stream)+instance];let s=sc_objects[index];let variant=u32(s.shape.z);
 var v:ScV;if cls>=3u{v=sc_rock_vertex(cls,variant,local,s.support.w);}else{v=sc_vertex(cls,variant,local);}
 let m=sc_model(s);let p=sun_caster_root(s)+m*sc_wind_model(v,sc_eco_byte(s,0u),s.shape.y);
 let blend=sun_mesh_weight(s,sun_layer.x);
 let quad=(v.aux>>4u)&3u;
 return SunSurface(sun_clip(p),vec2<f32>((f32(quad&1u)+v.uv.x)*0.5,(f32(quad>>1u)+1.0-v.uv.y)*0.5),vec4<u32>(v.material,index,v.aux&15u,0u),vec2<f32>(blend,sun_caster_weight(s,sun_layer.x)));
}
// Dither identity is a WORLD light texel plus canonical object identity. Both
// remain unchanged when the snapped viewport moves or a slot is recycled.
fn sun_dither(pixel:vec2<f32>,index:u32,salt:u32)->f32{
 let key=sc_objects[index].key.xyz;
 let q=vec2<u32>(pixel)+sf.origins[sun_layer.x].xy;
 return sc_random(q.x^hash(q.y^(sc_cell_hash(key.x,key.y,key.z)+salt)));
}
@fragment fn sun_mesh_fragment(v:SunSurface){
 if sun_dither(v.clip.xy,v.info.y,42931u)>=v.blend.y||sun_dither(v.clip.xy,v.info.y,0u)>=v.blend.x{discard;}
 // Leaf cards cast the shadow of their leaves, not of their quads.
 if v.info.x==SM_LEAF&&textureSampleLevel(sc_leaf_color,sc_leaf_sampler,v.uv,i32(v.info.z),2.0).a<0.5{discard;}
}
struct SunCard {@builtin(position) clip:vec4<f32>,@location(0) n:vec3<f32>,@location(1) uv:vec2<f32>,@location(2) @interpolate(flat) info:vec4<f32>,@location(3) weight:f32}
@vertex fn sun_card_vertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->SunCard{
 let index=sun_draw_read[sun_stream(sun_layer.x,2u)+instance];let s=sc_objects[index];let tree=u32(s.hi.w)==1u;let m=sc_model(s);
 let center=sun_caster_root(s)+m*sc_center(tree);let view=normalize(sc_inverse3(m)*f.sun.xyz);let frame=sc_view(view);let extent=bitcast<f32>(sc_render_state.bounds[u32(s.shape.z)]);
 let corners=array<vec2<f32>,6>(vec2<f32>(-1,-1),vec2<f32>(1,-1),vec2<f32>(1,1),vec2<f32>(-1,-1),vec2<f32>(1,1),vec2<f32>(-1,1));let q=corners[vertex];let p=center+m*((frame[0]*q.x+frame[1]*q.y)*extent*1.08);
 let blend=sun_mesh_weight(s,sun_layer.x);
 return SunCard(sun_clip(p),view,q,vec4<f32>(s.shape.z,blend,f32(index),extent),sun_caster_weight(s,sun_layer.x));
}
@fragment fn sun_card_fragment(v:SunCard)->@builtin(frag_depth) f32{
 let s=sc_objects[u32(v.info.z)];let tree=u32(s.hi.w)==1u;let m=sc_model(s);let frame=sc_view(normalize(v.n));let local=(frame[0]*v.uv.x+frame[1]*v.uv.y)*v.info.w*1.08;
 let cf=sc_oct_encode(normalize(v.n))*8.0-0.5;let origin=vec2<i32>(floor(cf));let fraction=fract(cf);var alpha=0.0;var point=vec3<f32>(0);
 let lod=sc_atlas_lod(max(length(dpdx(v.uv)),length(dpdy(v.uv)))*f32(f.tier_c.y)*0.5);
 for(var y=0;y<2;y++){for(var x=0;x<2;x++){var cell=origin+vec2<i32>(x,y);if cell.x<0{cell=vec2<i32>(0,7-cell.y);}if cell.x>7{cell=vec2<i32>(7,7-cell.y);}if cell.y<0{cell=vec2<i32>(7-cell.x,0);}if cell.y>7{cell=vec2<i32>(7-cell.x,7);}cell=clamp(cell,vec2<i32>(0),vec2<i32>(7));let capture=sc_view(sc_cell_dir(cell));var q=vec2<f32>(dot(local,capture[0]),dot(local,capture[1]))/v.info.w;var tap=sc_atlas_sample(cell,q,i32(v.info.x),lod,v.info.w);
  let denom=max(0.15,dot(frame[2],capture[2]));let hit=local+frame[2]*(tap.nd.w-dot(local,capture[2]))/denom;q=vec2<f32>(dot(hit,capture[0]),dot(hit,capture[1]))/v.info.w;tap=sc_atlas_sample(cell,q,i32(v.info.x),lod,v.info.w);
  let w=select(1.0-fraction.x,fraction.x,x==1)*select(1.0-fraction.y,fraction.y,y==1);alpha+=tap.color.a*w;point+=(local+frame[2]*(tap.nd.w-dot(local,capture[2]))/denom)*tap.color.a*w;
 }}
 if sun_dither(v.clip.xy,u32(v.info.z),42931u)>=v.weight||sun_dither(v.clip.xy,u32(v.info.z),0u)<v.info.y||sun_dither(v.clip.xy,u32(v.info.z),77591u)>=alpha{discard;}
 let p=sun_caster_root(s)+m*(sc_center(tree)+point/max(0.0001,alpha));
 return clamp(sun_project(p,sun_layer.x).z,0.0,1.0);
}
