// GPU-resident balanced quadtree, cache allocator and shared indexed topology.
// Appended to explorer.wgsl. Host uploads only the Frame, never terrain records.
const NODE_CAP:u32=4096u;
const PATCH_CAP:u32=2240u;
const GRID:u32=16u;
const SAMPLES:u32=289u;
const MAX_LEVEL:u32=24u;
const Q:i32=268435456;
// Vertex hash and index capacities per bank come from the allocation tier (f.tier_a.x, f.tier_c.w).
const NONE:u32=0xffffffffu;
struct Node { key:vec4<u32>,children:vec4<u32>,parent:u32,flags:u32,ready:u32,pad:u32,score:f32,rank:f32,padding:vec3<f32> }
struct AtomicBounds { a:atomic<u32>,b:atomic<u32>,c:atomic<u32>,d:atomic<u32>,e:atomic<u32>,g:atomic<u32> }
struct Bounds { minimum:vec4<f32>,maximum:vec4<f32> }
struct TerrainState {
 // First 256 bytes are bounded diagnostics, never required for rendering.
 version:u32,phase:u32,alpha:f32,active_bank:u32,
 leaf_count:u32,union_count:u32,free_count:u32,queue_head:u32,
 queue_tail:u32,job_count:u32,epochs:u32,generated:u32,
 denied:u32,vertices:atomic<u32>,overflow:atomic<u32>,probe_max:atomic<u32>,
 max_level:u32,initialized:u32,build_bank:u32,changes:u32,
 worst_error:f32,camera_height:f32,cooldown:f32,frame_count:u32,
 reserved:array<vec4<u32>,10>,
 errors:array<f32,25>,padding_error:u32,
 jobs:array<u32,64>,queue:array<u32,256>,free:array<u32,4096>,
 union_nodes:array<u32,2560>,nodes:array<Node,4096>,
 unsettled:array<atomic<u32>,4096>,
 split_candidates:array<u32,512>,merge_candidates:array<u32,512>,worst_buckets:array<f32,64>,published_nodes:array<u32,2560>,in_union:array<u32,4096>,
 leaf_counts:array<atomic<u32>,4096>,hidden:array<u32,4096>,bounds_accum:array<AtomicBounds,4096>,
 cache_bounds:array<Bounds,4096>,render_bounds:array<Bounds,4096>,
 // Ocean draw list: union patches whose mesh box, lowered by the level's
 // published height error, can reach the highest sea surface. Their indices
 // are copied into the second region of the bank (same patch order, compact).
 sea_count:atomic<u32>,sea_pad:vec3<u32>,node_slots:array<u32,4096>,
}
@group(0) @binding(20) var<storage,read_write> terrain:TerrainState;
@group(0) @binding(21) var<storage,read_write> vertex_owners:array<atomic<u32>>;
@group(0) @binding(22) var<storage,read_write> morph_write:array<Morph>;
@group(0) @binding(29) var<storage,read_write> morph_write_b:array<Morph>;
@group(0) @binding(23) var<storage,read_write> index_write:array<u32>;
@group(0) @binding(24) var<storage,read_write> vertex_map:array<u32>;
@group(0) @binding(25) var<storage,read_write> indirect:array<u32>;
@group(0) @binding(26) var<storage,read_write> projected_frame:Frame;
@group(0) @binding(47) var<storage,read_write> audit_probes:array<vec4<f32>>;

fn cube_key(face:u32,u:i32,v:i32)->vec3<i32>{switch face{case 0u:{return vec3<i32>(Q,v,-u);}case 1u:{return vec3<i32>(-Q,v,u);}case 2u:{return vec3<i32>(u,Q,-v);}case 3u:{return vec3<i32>(u,-Q,v);}case 4u:{return vec3<i32>(u,v,Q);}default:{return vec3<i32>(-u,v,-Q);}}}
fn grid_key(node:u32,x:u32,y:u32)->vec3<i32>{let k=terrain.nodes[node].key;let shift=MAX_LEVEL-k.y;return cube_key(k.x,i32(((k.z*GRID+x)<<shift)*2u)-Q,i32(((k.w*GRID+y)<<shift)*2u)-Q);}
fn face_chart(key:vec3<i32>)->vec4<i32>{let a=abs(key);if a.x>=a.y&&a.x>=a.z{if key.x>=0{return vec4<i32>(0,-key.z,key.y,a.x);}return vec4<i32>(1,key.z,key.y,a.x);}if a.y>=a.z{if key.y>=0{return vec4<i32>(2,key.x,-key.z,a.y);}return vec4<i32>(3,key.x,key.z,a.y);}if key.z>=0{return vec4<i32>(4,key.x,key.y,a.z);}return vec4<i32>(5,-key.x,key.y,a.z);}
fn on_face_key(key:vec3<i32>,face:u32)->vec2<i32>{switch face{case 0u:{return vec2<i32>(-key.z,key.y);}case 1u:{return vec2<i32>(key.z,key.y);}case 2u:{return vec2<i32>(key.x,-key.z);}case 3u:{return vec2<i32>(key.x,key.z);}case 4u:{return key.xy;}default:{return vec2<i32>(-key.x,key.y);}}}
// Neighbor queries differ by one fixed-point unit. Integer normalization avoids
// losing that unit in a face-edge floating-point tie, even at level 22.
fn chart_coord(u:i32,d:i32)->u32 {let a=u+d;if d==Q{return u32(clamp(a/2,0,Q));}if a<=0{return 0u;}if a>=2*d{return u32(Q);}var b=a/2;if (a&1)==0||a>d{b-=1;}return u32(clamp(b,0,Q));}
fn find_leaf(key:vec3<i32>,which:u32)->u32{let c=face_chart(key);let uv=vec2<u32>(chart_coord(c.y,c.w),chart_coord(c.z,c.w));var node=u32(c.x);let bit=select(select(2u,4u,which!=0u),16u,which==2u);for(var level=0u;level<=MAX_LEVEL;level++){let n=terrain.nodes[node];if (n.flags&bit)!=0u{return node;}let shift=27u-level;let x=(min(uv.x,u32(Q)-1u)>>shift)&1u;let y=(min(uv.y,u32(Q)-1u)>>shift)&1u;let child=n.children[x+2u*y];if child==NONE{return node;}node=child;}return node;}
fn neighbor(node:u32,edge:u32,t:u32,which:u32)->u32{let k=terrain.nodes[node].key;let step=1u<<(MAX_LEVEL-k.y);var x=GRID/2u;var y=t;
 if edge==0u{x=0u;}else if edge==1u{x=GRID;}else if edge==2u{x=t;y=0u;}else{x=t;y=GRID;}
 var u=i32(((k.z*GRID+x)<<(MAX_LEVEL-k.y))*2u)-Q;var v=i32(((k.w*GRID+y)<<(MAX_LEVEL-k.y))*2u)-Q;
 if edge==0u{u-=1;}if edge==1u{u+=1;}if edge==2u{v-=1;}if edge==3u{v+=1;}
 _=step;return find_leaf(cube_key(k.x,u,v),which);
}
fn mask_for(node:u32,which:u32)->u32{var result=0u;for(var e=0u;e<4u;e++){let n=neighbor(node,e,8u,which);if terrain.nodes[n].key.y<terrain.nodes[node].key.y{result|=1u<<e;}}return result;}
fn collapse(p:vec2<u32>,mask:u32)->vec2<u32>{var q=p;if (p.x==0u&&(mask&1u)!=0u)||(p.x==16u&&(mask&2u)!=0u){q.y&=~1u;}if (p.y==0u&&(mask&4u)!=0u)||(p.y==16u&&(mask&8u)!=0u){q.x&=~1u;}return q;}
fn cell_triangle(x:u32,y:u32,triangle:u32)->array<vec2<u32>,3>{let a=vec2<u32>(x,y);let b=a+vec2<u32>(1,0);let c=a+vec2<u32>(1,1);let d=a+vec2<u32>(0,1);if ((x+y)&1u)==0u{if triangle==0u{return array<vec2<u32>,3>(a,b,c);}return array<vec2<u32>,3>(a,c,d);}if triangle==0u{return array<vec2<u32>,3>(a,b,d);}return array<vec2<u32>,3>(b,c,d);}
// Compensated normalization of exact integer cube coordinates. This creates
// high/low body positions on the GPU, independent of camera or face ownership.
fn ds_int(x:i32)->vec2<f32>{let hi=f32(x);return vec2<f32>(hi,f32(x-i32(hi)));}
fn ds_div(a:vec2<f32>,b:vec2<f32>)->vec2<f32>{let q=rounded(a.x/b.x);let residual=ds_add(a,-ds_mul(b,vec2<f32>(q,0)));return ds_add(vec2<f32>(q,0),vec2<f32>(residual.x/b.x,0));}
fn eye_key()->vec3<i32>{let high=f.eye_hi.xyz;let low=f.eye_lo.xyz;let p=high+low;let axis=select(select(2u,1u,abs(p.y)>=abs(p.z)),0u,abs(p.x)>=max(abs(p.y),abs(p.z)));let denom=ds_mul(ds_add(vec2<f32>(high[axis],0),vec2<f32>(low[axis],0)),vec2<f32>(sign(p[axis]),0));var key=vec3<i32>(0);for(var i=0u;i<3u;i++){let q=ds_mul(ds_div(ds_add(vec2<f32>(high[i],0),vec2<f32>(low[i],0)),denom),vec2<f32>(f32(Q),0));key[i]=i32(q.x)+i32(round(q.y));}return key;}
fn base_position(key:vec3<i32>)->Sample {
 let x=ds_mul(ds_int(key.x),vec2<f32>(1.0/f32(Q),0));let y=ds_mul(ds_int(key.y),vec2<f32>(1.0/f32(Q),0));let z=ds_mul(ds_int(key.z),vec2<f32>(1.0/f32(Q),0));let length2=ds_add(ds_add(ds_mul(x,x),ds_mul(y,y)),ds_mul(z,z));
 let inv=inverseSqrt(length2.x);let error=ds_add(vec2<f32>(1,0),-ds_mul(length2,ds_mul(vec2<f32>(inv,0),vec2<f32>(inv,0))));let corrected=ds_add(vec2<f32>(inv,0),ds_mul(vec2<f32>(0.5*inv,0),error));
 let nx=ds_mul(x,corrected);let ny=ds_mul(y,corrected);let nz=ds_mul(z,corrected);let px=ds_mul(nx,vec2<f32>(f.planet.x,0));let py=ds_mul(ny,vec2<f32>(f.planet.x,0));let pz=ds_mul(nz,vec2<f32>(f.planet.x,0));
 let hi=floor(vec3<f32>(px.x,py.x,pz.x)/4096.0)*4096.0;let lo=(vec3<f32>(px.x,py.x,pz.x)-hi)+vec3<f32>(px.y,py.y,pz.y);
 return Sample(vec4<f32>(hi,0),vec4<f32>(lo,0),vec4<f32>(nx.x,ny.x,nz.x,0));
}
// Water level of the last measured mesh read, kept with the vertex for the water mesh. From a page with water
// texels it is kept as an excess over the vertex (WATER_EXCESS_FLAG plus metres), so that while the terrain morphs
// the water rides on it at its final depth: water never stands over ground that is still on its way down.
var<private> field_mesh_water:f32=0.0;
// Distant patches sample height at their vertex spacing. Fine patches look ahead
// into resident measurements so changing the triangle spacing does not move a coast.
// At most half a page per patch: its four corners still cover the source keys.
fn mesh_page_level(level:u32)->u32{
 let spacing=f.planet.x*0.125*exp2(-f32(level));
 let ahead=u32(spacing<=32.0)+u32(spacing<=16.0)+u32(spacing<=8.0);
 return min(max(level+ahead,4u)-4u,u32(f.field.y));
}
fn measured_mesh(key:vec3<i32>,level:u32,hi:vec3<f32>,lo:vec3<f32>,spacing:f32)->vec4<f32>{
 let c=face_chart(key);let sum=vec2<u32>(c.yz+vec2<i32>(Q));let g=sum/2u;let frac=vec2<f32>(sum&vec2<u32>(1u))*0.5;let face=u32(c.x);
 let entry=page_entry(0u,face,mesh_page_level(level),g);if entry==0u{field_mesh_water=f.planet.y;return vec4<f32>(0,0,0,field_edits(hi,lo));}
 let texels=page_water_texels(entry);let r=page_surface_read(entry,g,frac);
 var water=0.0;if texels{water=page_water_read(entry,face,g,frac).x;}else{water=page_water_geometry(entry,face,g);}
 // The water layer: the level carried by vertices within two texels (or two vertex spacings) of water, so a triangle
 // crossing a shore is flat at the water's level and the fragment clips it at the shore; none farther out.
 // A dry vertex never holds water over its own ground: a coarse triangle across a steep stream would otherwise
 // interpolate levels metres apart and stand up over the bank; it sinks under the bank instead.
 let lw=water_layer_entry(entry,face,g);var layer=false;var layer_dry=false;
 if lw!=0u{let w=water_layer_read(lw,face,g,frac,vec2<f32>(c.yz)/f32(Q));layer=true;layer_dry=w.sdf>0.0;water=select(WATER_NONE,w.level,w.level>WATER_NONE&&w.sdf<2.0*max(w.cell,spacing));}
 let gradient=page_gradient(face,vec2<f32>(c.yz)/f32(Q),r.y,r.z);
 let detail=measured_bank_complement(measured_complement(hi,lo,spacing,page_cell(page_entry_level(entry)),gradient),r.x,gradient,water);
 let h=r.x+detail.w+field_edits(hi,lo);
 if layer_dry&&water>WATER_NONE{water=min(water,h-0.05);}
 field_mesh_water=select(water,WATER_EXCESS_FLAG+(water-h),texels&&!layer);
 return vec4<f32>(gradient+detail.xyz,h);
}
// What serves this node's four corners now, six bits each: level plus one (zero: nothing yet), and whether that page is provisional, as a final one replaces it at the same level.
// All four, because vertices on a patch's far edges read the neighbouring page when on its boundary. Read as a vertex reads them, through face_chart: on a cube edge a tie sends the read to
// the other face, and a token on the node's own face never saw that page arrive, which left a row of the mesh on coarse heights for good, 509 m off. A patch is smaller than its page, so a corner off a low edge still reads the page of its interior.
// A root is the exception: all its corners are cube corners, so on faces 2 to 5 they read neither its own page nor two of its neighbours'. Its token is which of the six root pages are up.
fn node_served(node:u32)->u32{if terrain.nodes[node].key.y==0u{var up=0u;for(var i=0u;i<6u;i++){if page_entry(0u,i,0u,vec2<u32>(0))!=0u{up|=1u<<i;}}return up;}let d=mesh_page_level(terrain.nodes[node].key.y);var token=0u;for(var i=0u;i<4u;i++){let c=face_chart(grid_key(node,(i&1u)*GRID,(i>>1u)*GRID));let entry=page_entry(0u,u32(c.x),d,vec2<u32>(c.yz+vec2<i32>(Q))/2u);token|=select((page_entry_level(entry)+1u)|((entry>>25u)&32u),0u,entry==0u)<<(6u*i);}return token;}
fn radial_sample(key:vec3<i32>,level:u32)->Sample {var p=base_position(key);let spacing=f.planet.x*0.125*exp2(-f32(level));
 var field=vec4<f32>(0);if field_measured(){field=measured_mesh(key,level,p.hi.xyz,p.lo.xyz,spacing);}else{field=field_mesh(p.hi.xyz,p.lo.xyz,spacing);}let h=field.w;let grad=field.xyz;
 let n=p.normal.xyz;p.hi.w=spacing;p.lo=vec4<f32>(p.lo.xyz+n*h,h);p.normal=vec4<f32>(normalize(n-(grad-n*dot(n,grad))*f.planet.x/(f.planet.x+h)),field_mesh_water);return p;
}
fn camera_height()->f32{let radial=normalize(f.eye_hi.xyz+f.eye_lo.xyz);let lo=f.eye_lo.xyz-radial*f.eye_hi.w;return field_unfiltered(f.eye_hi.xyz,lo);}
// A box contains every old/new position and the complete Hermite trajectory.
fn ordered_float(v:vec3<f32>)->vec3<u32>{let b=bitcast<vec3<u32>>(v);let sign_bit=vec3<u32>(0x80000000u);return select(b^sign_bit,~b,(b&sign_bit)!=vec3<u32>(0));}
fn from_ordered(v:vec3<u32>)->vec3<f32>{let sign_bit=vec3<u32>(0x80000000u);return bitcast<vec3<f32>>(select(~v,v^sign_bit,(v&sign_bit)!=vec3<u32>(0)));}
fn bounds_outside(box:Bounds)->bool{if box.maximum.w<0.5{return false;}let center=(box.minimum.xyz+box.maximum.xyz)*0.5;let extent=(box.maximum.xyz-box.minimum.xyz)*0.5+vec3<f32>(box.minimum.w+16.0+length(f.eye_hi.xyz)*2e-6);let delta=(center-f.eye_hi.xyz)-f.eye_lo.xyz;let z=dot(delta,f.forward.xyz);if z+dot(abs(f.forward.xyz),extent)<0.1{return true;}for(var axis=0u;axis<2u;axis++){let tangent=select(f.view.w*f.view.z,f.view.w,axis==1u);let right=select(f.right.xyz,f.up.xyz,axis==1u);for(var sign_value=-1.0;sign_value<=1.0;sign_value+=2.0){let plane=right*sign_value-f.forward.xyz*tangent;if dot(delta,plane)>dot(abs(plane),extent){return true;}}}return false;}
fn transition_hidden(a:Bounds,b:Bounds)->bool{if a.maximum.w<0.5||b.maximum.w<0.5{return false;}return bounds_outside(Bounds(vec4<f32>(min(a.minimum.xyz-vec3<f32>(a.minimum.w),b.minimum.xyz-vec3<f32>(b.minimum.w)),0),vec4<f32>(max(a.maximum.xyz+vec3<f32>(a.minimum.w),b.maximum.xyz+vec3<f32>(b.minimum.w)),1)));}
fn clock_now()->f32{return bitcast<f32>(terrain.reserved[1].x);}
fn read_morph(slot:u32)->Morph{if slot<f.tier_a.x{return morph_write[slot];}return morph_write_b[slot-f.tier_a.x];}
fn write_morph(slot:u32,m:Morph){if slot<f.tier_a.x{morph_write[slot]=m;}else{morph_write_b[slot-f.tier_a.x]=m;}}
fn lookup_morph(key:vec3<i32>)->u32{let first=hash(bitcast<u32>(key.x)^hash(bitcast<u32>(key.y)^hash(bitcast<u32>(key.z))));for(var probe=0u;probe<128u;probe++){let slot=terrain.active_bank*f.tier_a.x+((first+probe)&(f.tier_a.x-1u));if atomicLoad(&vertex_owners[slot])==0u{return NONE;}if all(read_morph(slot).key.xyz==key){return slot;}}return NONE;}
@compute @workgroup_size(1)
fn gpu_begin(){
 terrain.frame_count+=1u;terrain.job_count=0u;
 let signature=vec4<u32>(bitcast<u32>(f.lod.w),u32(f.right.w),u32(f.sun.w),(u32(f.view.x)|(u32(f.view.y)<<16u))^bitcast<u32>(f.planet.y)^bitcast<u32>(f.options.z));
 if any(f.eye_hi.xyz!=f.prev_hi.xyz)||any(f.eye_lo.xyz!=f.prev_lo.xyz)||any(signature!=terrain.reserved[8])||bitcast<u32>(f.lod.y)!=terrain.reserved[9].x{terrain.reserved[7].x=1u;terrain.cooldown=0.0;terrain.reserved[6].y=0u;terrain.reserved[6].z=0u;terrain.reserved[6].w=0u;}terrain.reserved[8]=signature;terrain.reserved[9].x=bitcast<u32>(f.lod.y);
 // A page arriving wakes selection and starts its passes again. It does not start the wait for rest over: while pages arrive for many seconds after a cut, the far ridges would wait for the last of them.
 if f.field_serial.x!=terrain.reserved[6].x{terrain.reserved[6].x=f.field_serial.x;terrain.reserved[7].x=1u;terrain.cooldown=0.0;terrain.reserved[6].z=0u;terrain.reserved[6].w=0u;}
 // Rest begins once the eye has been still a while. Selection may already be asleep, so wake it for the settled rules.
 if field_measured()&&terrain.reserved[6].y<CUT_REST_FRAMES{terrain.reserved[6].y+=1u;if terrain.reserved[6].y==CUT_REST_FRAMES{terrain.reserved[7].x=1u;terrain.cooldown=0.0;}}
 let moved=length((f.eye_hi.xyz-f.prev_hi.xyz)+(f.eye_lo.xyz-f.prev_lo.xyz));
 // Advance one shared trajectory clock, so seams and retargets stay coherent.
 // Rate depends on metric speed relative to ground clearance, not frame count.
 // Keep a short decaying speed memory through arrival: prepared morphs finish
 // on stopping instead of reverting to the slow timer at the destination.
 let dt=max(0.0,f.forward.w);let clearance=max(4.0,f.eye_hi.w-terrain.camera_height);
 let requested=clamp(moved/max(0.001,dt)*0.14/max(4.0,clearance*0.25),1.0,32.0);
 let rate=max(requested,1.0+(max(1.0,bitcast<f32>(terrain.reserved[0].y))-1.0)*exp(-dt/0.08));
 terrain.reserved[0].y=bitcast<u32>(rate);
 terrain.reserved[1].x=bitcast<u32>((clock_now()+dt*rate)%4096.0);
 if moved>max(2000.0*f.lod.y,abs(f.eye_hi.w)*0.1){terrain.reserved[9].y=12u;}
 else{terrain.reserved[9].y=select(0u,terrain.reserved[9].y-1u,terrain.reserved[9].y>0u);}
 if terrain.initialized==0u||terrain.version!=u32(f.up.w){
  terrain.version=u32(f.up.w);terrain.phase=1u;terrain.alpha=1.0;terrain.active_bank=0u;terrain.leaf_count=6u;terrain.union_count=0u;terrain.free_count=NODE_CAP-6u;terrain.queue_head=0u;terrain.queue_tail=6u;terrain.epochs=0u;terrain.generated=0u;terrain.denied=0u;terrain.initialized=1u;terrain.reserved[7].x=1u;terrain.changes=6u;terrain.max_level=0u;
  terrain.reserved[9].y=0u;terrain.reserved[9].z=0u;terrain.reserved[9].w=0u;
  for(var i=0u;i<NODE_CAP;i++){terrain.nodes[i].flags=0u;terrain.nodes[i].children=vec4<u32>(NONE);if i>=6u{terrain.free[i-6u]=NODE_CAP+5u-i;}}
  for(var i=0u;i<6u;i++){terrain.nodes[i].key=vec4<u32>(i,0,0,0);terrain.nodes[i].parent=NONE;terrain.nodes[i].flags=7u;terrain.nodes[i].ready=0u;terrain.queue[i]=i;}
  for(var i=0u;i<=MAX_LEVEL;i++){terrain.errors[i]=field_error_for_level(i);}
  indirect[20]=0u;indirect[21]=1u;indirect[22]=1u;terrain.reserved[1].w=0u;indirect[12]=0u;indirect[13]=1u;indirect[14]=0u;indirect[15]=0u;indirect[16]=0u;
 }
 if terrain.reserved[7].x!=0u{let fading=field_final;field_final=true;terrain.camera_height=camera_height();field_final=fading;}
 indirect[20]=select(0u,(terrain.reserved[1].w*SAMPLES+63u)/64u,terrain.phase==0u&&terrain.alpha<1.0);indirect[24]=select(0u,terrain.reserved[1].w,terrain.phase==0u&&terrain.alpha<1.0);indirect[25]=1u;indirect[26]=1u;
 indirect[32]=select(0u,64u,terrain.reserved[7].x!=0u||terrain.phase!=0u);indirect[33]=1u;indirect[34]=1u;
 terrain.cooldown-=f.forward.w;
}
@compute @workgroup_size(64)
fn gpu_scores(@builtin(global_invocation_id) id:vec3<u32>){if id.x>=NODE_CAP{return;}if terrain.phase==0u{let flags=terrain.nodes[id.x].flags;terrain.nodes[id.x].flags=(flags&~42u)|((flags&16u)>>3u)|((flags&4u)<<3u);atomicStore(&terrain.unsettled[id.x],0u);atomicStore(&terrain.leaf_counts[id.x],0u);}let n=terrain.nodes[id.x];if (n.flags&1u)==0u{return;}terrain.hidden[id.x]=select(0u,1u,(n.flags&16u)!=0u&&bounds_outside(terrain.render_bounds[id.x]))|select(0u,2u,n.ready!=0u&&bounds_outside(terrain.cache_bounds[id.x]));
 let center=normalize(vec3<f32>(grid_key(id.x,8u,8u)));let eye=f.eye_hi.xyz+f.eye_lo.xyz;let radial=normalize(eye);let size=exp2(-f32(n.key.y));let bound=f.planet.x*1.5*size;
 let horizontal=max(0.0,length(center-radial)*f.planet.x-bound);let terrain_alt=abs(f.eye_hi.w-terrain.camera_height);let water_alt=select(1e10,abs(f.eye_hi.w-f.planet.y),f.options.z>0.5);let altitude=max(2.0,min(terrain_alt,water_alt));
 var travel=((f.eye_hi.xyz-f.prev_hi.xyz)+(f.eye_lo.xyz-f.prev_lo.xyz))*(0.45/max(0.001,f.forward.w));
 let reach=max(2500.0,altitude*0.7)*f.lod.y;let vertical=dot(travel,radial);var tangent=travel-radial*vertical;tangent*=min(1.0,reach/max(1.0,length(tangent)));
 // Predict the flight controller's ground clamp. Clamping vertical travel to
 // 70% of altitude kept every prediction above ground until the last frame.
 travel=tangent+radial*max(vertical,terrain.camera_height+2.0-f.eye_hi.w);
 let future=normalize(eye+travel);let future_horizontal=max(0.0,length(center-future)*f.planet.x-bound);let future_altitude=max(2.0,f.eye_hi.w+dot(travel,radial)-terrain.camera_height);
 let current_distance=length(vec2<f32>(horizontal,altitude));let distance=min(current_distance,length(vec2<f32>(future_horizontal,future_altitude))*1.2);
 var error=0.0;terrain.nodes[id.x].padding.y=terrain.errors[n.key.y]*f.view.y*0.8660254/max(2.0,current_distance);
 if dot(center,radial)+2.0*size>=f.planet.x/max(f.planet.x,f.planet.x+f.eye_hi.w)-0.04{let local_error=select(terrain.errors[n.key.y],clamp(n.padding.x,terrain.errors[n.key.y]*0.025,terrain.errors[n.key.y]),n.ready!=0u&&n.key.y>=3u);error=local_error*f.view.y*0.8660254/max(2.0,distance);}
 // The resident cut is omnidirectional. Head rotation must never change a
 // settled landscape; frustum priority is deliberately absent from selection.
 let delta=(center-radial)*f.planet.x-radial*(f.eye_hi.w-terrain.camera_height);
 let grazing=1.0-abs(dot(normalize(delta),center));error*=1.0+3.0*pow(grazing,4.0);
 error*=f.lod.y;
 // Prepare the ground around the predicted eye with the same spacing rule as
 // the current eye. A short lead covers several publications even at walking speed.
 let future_h=future_horizontal+length(tangent)*0.08;
 let near_metric=min(horizontal*0.014+altitude*0.003,future_h*0.014+future_altitude*0.003);
 if min(current_distance,length(vec2<f32>(future_h,future_altitude)))<420.0*f.lod.y{
  let spacing=f.planet.x*0.125*size;
  let desired=0.10+max(0.0,near_metric/f.lod.y-0.04);
  error=max(error,f.lod.w*spacing/desired);
 }
 terrain.nodes[id.x].score=error;
 if field_measured()&&n.ready!=0u&&(n.ready>>8u)!=node_served(id.x){terrain.nodes[id.x].flags|=128u;}
}
// Parallel ancestor marking keeps reclamation independent of tree depth on
// the serial allocator. No per-frame walk over every leaf runs in one lane.
@compute @workgroup_size(64)
fn gpu_mark(@builtin(global_invocation_id) id:vec3<u32>){if id.x>=NODE_CAP||terrain.phase!=0u||terrain.reserved[1].z==0u||(terrain.nodes[id.x].flags&20u)==0u{return;}var n=id.x;for(var j=0u;j<=MAX_LEVEL;j++){atomicStore(&terrain.unsettled[n],1u);let p=terrain.nodes[n].parent;if p==NONE{break;}n=p;}}
@compute @workgroup_size(64)
fn gpu_census(@builtin(global_invocation_id) id:vec3<u32>){if id.x>=NODE_CAP||terrain.phase!=0u||(terrain.nodes[id.x].flags&4u)==0u{return;}var n=id.x;for(var j=0u;j<=MAX_LEVEL;j++){atomicAdd(&terrain.leaf_counts[n],1u);let p=terrain.nodes[n].parent;if p==NONE{break;}n=p;}}
@compute @workgroup_size(64)
fn gpu_reset_progress(@builtin(global_invocation_id) id:vec3<u32>){if id.x<NODE_CAP&&terrain.phase==0u{atomicStore(&terrain.unsettled[id.x],0u);atomicStore(&terrain.leaf_counts[id.x],0u);}}
var<workgroup> progress_flags:array<u32,64>;
fn terrain_motion_weight(origin:vec3<f32>,end:vec3<f32>)->f32{
 let relative_end=(origin-f.eye_hi.xyz)+(end-f.eye_lo.xyz)-f.eye_tail.xyz;
 return smoothstep(TERRAIN_SOLID_RANGE,3.0*TERRAIN_SOLID_RANGE,length(relative_end));
}
fn parked_morph(m:Morph)->Morph{
 return Morph(m.key,vec4<f32>(m.hi.xyz,clock_now()-1.0),m.b,m.b,m.nb,m.nb,vec4<f32>(0,0,0,0.14));
}
fn reuse_morph(m:Morph)->Morph{
 if terrain_motion_weight(m.hi.xyz,m.b.xyz)==0.0{return parked_morph(m);}return m;
}
@compute @workgroup_size(64)
fn gpu_progress(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3<u32>){var pending=0u;for(var i=lane;i<SAMPLES;i+=64u){let slot=vertex_map[terrain.active_bank*f.tier_a.y*SAMPLES+group.x*SAMPLES+i];if morph_phase(read_morph(slot),clock_now())<1.0{pending=1u;}}progress_flags[lane]=pending;workgroupBarrier();for(var step=32u;step>0u;step>>=1u){if lane<step{progress_flags[lane]|=progress_flags[lane+step];}workgroupBarrier();}if lane==0u{atomicStore(&terrain.unsettled[terrain.published_nodes[group.x]],progress_flags[0]);}}
// Separate pass: only the owning invocation reads/writes each trajectory. This
// retires finished motion before the clock wraps, without racing other readers.
@compute @workgroup_size(64)
fn gpu_park(@builtin(global_invocation_id) id:vec3<u32>){if id.x>=terrain.reserved[1].w*SAMPLES{return;}let slot=vertex_map[terrain.active_bank*f.tier_a.y*SAMPLES+id.x];if atomicLoad(&vertex_owners[slot])!=id.x+1u{return;}let m=read_morph(slot);if morph_phase(m,clock_now())>=1.0||terrain_motion_weight(m.hi.xyz,m.b.xyz)==0.0{write_morph(slot,parked_morph(m));}}
@compute @workgroup_size(64)
fn gpu_mark_progress(@builtin(global_invocation_id) id:vec3<u32>){if id.x>=NODE_CAP||terrain.phase!=0u||(terrain.nodes[id.x].flags&16u)==0u||atomicLoad(&terrain.unsettled[id.x])==0u{return;}var p=terrain.nodes[id.x].parent;for(var j=0u;j<=MAX_LEVEL;j++){if p==NONE{break;}atomicStore(&terrain.unsettled[p],1u);p=terrain.nodes[p].parent;}}
// In motion a cut keeps a band between its thresholds, so that it does not thrash, and spends patches on what it meets first. So where it ends up depends on
// the way it came: patches left around an earlier stop stay there, and the cap leaves less for the view. At rest a measured body spends them by one strict
// order instead, whatever is split now. Each node ranks at the lowest score of it and its ancestors, a little under its parent, so that children never outrank
// parents and two ranks are never equal. The highest ranks above the tolerance split, and the lowest give way, wherever they are, to pay for them.
const CUT_REST_FRAMES:u32=30u;
const CUT_STALL_PASSES:u32=64u;
const CUT_SETTLE_PASSES:u32=1500u;
fn cut_settled()->bool{return field_measured()&&terrain.reserved[6].y>=CUT_REST_FRAMES;}
fn node_rank(id:u32)->f32{
 var low=terrain.nodes[id].score;var p=terrain.nodes[id].parent;
 for(var j=0u;j<=MAX_LEVEL;j++){if p==NONE{break;}low=min(low,terrain.nodes[p].score);p=terrain.nodes[p].parent;}
 let k=terrain.nodes[id].key;let tie=f32(hash(k.x^hash(k.y^hash(k.z^hash(k.w))))&1023u)/1024.0;
 return low*(1.0-0.0002*f32(k.y)-0.00002*tie);
}
fn can_merge(node:u32)->bool{let n=terrain.nodes[node];let leaves=atomicLoad(&terrain.leaf_counts[node]);if n.children.x==NONE||n.ready==0u||leaves<4u||leaves>97u||ancestor_leaf(node,4u){return false;}
 // Visit the complete old boundary, including arbitrarily short corner spans.
 // Two samples on the parent edge would miss deep neighbors during batch eviction.
 var stack:array<u32,128>;var count=1u;stack[0]=node;for(var visits=0u;visits<129u;visits++){if count==0u{return true;}count-=1u;let i=stack[count];let leaf=terrain.nodes[i];if (leaf.flags&4u)!=0u{let shift=leaf.key.y-n.key.y;let lo=n.key.zw<<vec2<u32>(shift);let hi=(n.key.zw+vec2<u32>(1))<<vec2<u32>(shift);for(var edge=0u;edge<4u;edge++){let boundary=select(select(leaf.key.w==lo.y,leaf.key.w+1u==hi.y,edge==3u),select(leaf.key.z==lo.x,leaf.key.z+1u==hi.x,edge==1u),edge<2u);if boundary&&terrain.nodes[neighbor(i,edge,8u,1u)].key.y>n.key.y+1u{return false;}}}else{for(var k=0u;k<4u;k++){stack[count]=leaf.children[k];count+=1u;}}}return count==0u;}
fn target_ancestor(node:u32)->u32{var n=node;for(var i=0u;i<=MAX_LEVEL;i++){if (terrain.nodes[n].flags&4u)!=0u{return n;}let p=terrain.nodes[n].parent;if p==NONE{return NONE;}n=p;}return NONE;}
fn source_children(node:u32)->bool{let c=terrain.nodes[node].children;if c.x==NONE{return false;}return (terrain.nodes[c.x].flags&2u)!=0u&&(terrain.nodes[c.y].flags&2u)!=0u&&(terrain.nodes[c.z].flags&2u)!=0u&&(terrain.nodes[c.w].flags&2u)!=0u;}
fn can_retire(node:u32)->bool{let goal=target_ancestor(node);if goal==NONE{return false;}let invisible=transition_hidden(terrain.render_bounds[node],terrain.cache_bounds[goal]);if atomicLoad(&terrain.unsettled[node])!=0u&&!invisible{return false;}let level=terrain.nodes[node].key.y;for(var e=0u;e<4u;e++){for(var t=4u;t<=12u;t+=8u){if terrain.nodes[neighbor(node,e,t,0u)].key.y>level+1u{return false;}}}return true;}
fn merge_node(node:u32){var stack:array<u32,128>;var count=1u;stack[0]=node;var leaves=0u;for(var visits=0u;visits<129u;visits++){if count==0u{break;}count-=1u;let i=stack[count];let n=terrain.nodes[i];if (n.flags&4u)!=0u{terrain.nodes[i].flags&=~4u;leaves+=1u;}else{for(var k=0u;k<4u;k++){stack[count]=n.children[k];count+=1u;}}}terrain.nodes[node].flags|=4u;terrain.leaf_count=terrain.leaf_count-leaves+1u;terrain.changes+=1u;}
var<workgroup> split_score:array<f32,64>;
var<workgroup> merge_score:array<f32,64>;
var<workgroup> split_id:array<u32,64>;
var<workgroup> conservative_score:array<f32,64>;
var<workgroup> merge_id:array<u32,64>;
@compute @workgroup_size(64)
fn gpu_candidates(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3<u32>){
 let id=group.x*64u+lane;let n=terrain.nodes[id];var s=-1e30;var m=-1e30;
 if terrain.phase==0u&&(n.flags&4u)!=0u&&n.ready!=0u&&n.key.y<MAX_LEVEL{s=n.score;}
 let threshold=max(f.lod.w*0.55,select(0.0,bitcast<f32>(terrain.reserved[4].x)*0.08,terrain.leaf_count+48u>u32(f.right.w)));if terrain.phase==0u&&(n.flags&1u)!=0u&&(n.flags&4u)==0u&&n.score<threshold&&can_merge(id){m=f32(atomicLoad(&terrain.leaf_counts[id]))*100.0-n.score;}
 if cut_settled(){
  s=-1e30;m=-1e30;
  if terrain.phase==0u&&(n.flags&1u)!=0u{
   let rank=node_rank(id);terrain.nodes[id].rank=rank;
   if (n.flags&4u)!=0u{if n.ready!=0u&&n.key.y<MAX_LEVEL{s=rank;}}
   else if atomicLoad(&terrain.leaf_counts[id])==4u&&(rank<=f.lod.w||(terrain.leaf_count+48u>u32(f.right.w)&&rank<bitcast<f32>(terrain.reserved[4].x)))&&can_merge(id){m=-rank;}
  }
 }
 for(var rank=0u;rank<8u;rank++){
  conservative_score[lane]=select(0.0,n.padding.y,(n.flags&4u)!=0u);split_score[lane]=s;merge_score[lane]=m;split_id[lane]=id;merge_id[lane]=id;workgroupBarrier();
  for(var step=32u;step>0u;step>>=1u){if lane<step{conservative_score[lane]=max(conservative_score[lane],conservative_score[lane+step]);if split_score[lane+step]>split_score[lane]{split_score[lane]=split_score[lane+step];split_id[lane]=split_id[lane+step];}if merge_score[lane+step]>merge_score[lane]{merge_score[lane]=merge_score[lane+step];merge_id[lane]=merge_id[lane+step];}}workgroupBarrier();}
  if lane==0u{terrain.split_candidates[group.x*8u+rank]=select(NONE,split_id[0],split_score[0]>-1e29);terrain.merge_candidates[group.x*8u+rank]=select(NONE,merge_id[0],merge_score[0]>-1e29);if rank==0u{terrain.worst_buckets[group.x]=conservative_score[0];}}
  if id==split_id[0]{s=-1e30;}if id==merge_id[0]{m=-1e30;}workgroupBarrier();
 }
}
// Workgroup-parallel scheduling (one workgroup of SEL_LANES), equivalent to
// single invocations looping over all NODE_CAP nodes with dependent global loads; the
// parallel forms reproduce the serial results exactly: argmax scans keep the serial
// "first strict maximum" (lowest position among equal best values; values the serial
// comparison rejects, including NaN, are never candidates), order-dependent appends use
// a prefix sum in index order, and every state mutation stays on lane 0 between barriers.
const SEL_LANES:u32=256u;
var<workgroup> sel_v:array<f32,256>;
var<workgroup> sel_k:array<u32,256>;
var<workgroup> sel_scan:array<u32,256>;
var<workgroup> sel_ctl:u32;
var<workgroup> sel_total:u32;
var<workgroup> sel_or:atomic<u32>;
var<workgroup> sel_max:atomic<u32>;
// Broadcast reads: the load is followed by a barrier, so lane 0 may write the word again at once.
fn sel_read_ctl()->u32{let v=workgroupUniformLoad(&sel_ctl);workgroupBarrier();return v;}
fn sel_read_total()->u32{let v=workgroupUniformLoad(&sel_total);workgroupBarrier();return v;}
// Inclusive prefix sum of v over the lanes (Hillis-Steele); also leaves the total in sel_total.
// Must be called in uniform control flow.
fn sel_prefix(lane:u32,v:u32)->u32{
 sel_scan[lane]=v;workgroupBarrier();
 for(var o=1u;o<SEL_LANES;o<<=1u){var t=0u;if lane>=o{t=sel_scan[lane-o];}workgroupBarrier();sel_scan[lane]+=t;workgroupBarrier();}
 let inclusive=sel_scan[lane];if lane==SEL_LANES-1u{sel_total=inclusive;}workgroupBarrier();
 return inclusive;
}
// Reduces (sel_v, sel_k) to lane 0: the largest value, the lowest position among equals.
// NONE in sel_k marks an empty entry. Must be called in uniform control flow.
fn sel_argmax(lane:u32,v:f32,k:u32)->u32{
 sel_v[lane]=v;sel_k[lane]=k;workgroupBarrier();
 for(var step=SEL_LANES/2u;step>0u;step>>=1u){
  if lane<step{let a=sel_k[lane];let b=sel_k[lane+step];
   if b!=NONE&&(a==NONE||sel_v[lane+step]>sel_v[lane]||(sel_v[lane+step]==sel_v[lane]&&b<a)){sel_v[lane]=sel_v[lane+step];sel_k[lane]=b;}}
  workgroupBarrier();
 }
 return workgroupUniformLoad(&sel_k[0]);
}
@compute @workgroup_size(256)
fn gpu_reclaim(@builtin(local_invocation_index) lane:u32){
 if lane==0u{sel_ctl=select(0u,1u,terrain.reserved[7].x==0u||terrain.phase!=0u||terrain.reserved[1].z==0u);}
 if sel_read_ctl()!=0u{return;}
 // Serial order: nodes 6.. in index order append to the free list.
 var base=terrain.free_count;
 for(var c=0u;c<NODE_CAP;c+=SEL_LANES){
  let i=c+lane;let take=i>=6u&&(terrain.nodes[i].flags&1u)!=0u&&atomicLoad(&terrain.unsettled[i])==0u;
  let at=sel_prefix(lane,select(0u,1u,take));
  if take{let p=terrain.nodes[i].parent;terrain.nodes[p].children=vec4<u32>(NONE);terrain.nodes[i].flags=0u;terrain.free[base+at-1u]=i;}
  base+=sel_total;workgroupBarrier();
 }
 if lane==0u{terrain.free_count=base;terrain.reserved[1].z=0u;}
}
@compute @workgroup_size(256)
fn gpu_select(@builtin(local_invocation_index) lane:u32){
 if lane==0u{sel_ctl=select(0u,1u,terrain.phase==0u&&terrain.reserved[7].x==0u);}
 if sel_read_ctl()!=0u{return;}
 let union_limit=f.tier_a.y-32u;
 if lane==0u{sel_ctl=select(0u,1u,terrain.phase==0u);}
 if sel_read_ctl()!=0u{
  // A coarsening region retains its fine topology until every shared trajectory
  // in that region has arrived. Other regions can refine and morph concurrently.
  let settled=cut_settled();var stalled=false;var split_growth=0u;var selected=false;
  if lane==0u{
   terrain.changes=0u;terrain.worst_error=0.0;var worst_priority=0.0;for(var i=0u;i<64u;i++){terrain.worst_error=max(terrain.worst_error,terrain.worst_buckets[i]);let best=terrain.split_candidates[i*8u];if best!=NONE{worst_priority=max(worst_priority,select(terrain.nodes[best].score,terrain.nodes[best].rank,settled));}}
   terrain.queue_head=0u;terrain.queue_tail=0u;
   terrain.reserved[4].x=bitcast<u32>(worst_priority);
   selected=terrain.cooldown<=0.0;
   // A bound on spending at rest, in case a closure of splits and merges ever chases itself.
   if settled&&selected{terrain.reserved[6].w+=1u;}
   sel_ctl=select(0u,1u,selected&&(!settled||terrain.reserved[6].w<=CUT_SETTLE_PASSES))|select(0u,2u,selected);
  }
  storageBarrier();
  let run=sel_read_ctl();
  let worst_priority=bitcast<f32>(terrain.reserved[4].x);
  if (run&1u)!=0u{
   for(var iteration=0u;iteration<8u;iteration++){
    var bv=0.0;var bk=NONE;
    for(var c=lane;c<512u;c+=SEL_LANES){let i=terrain.merge_candidates[c];if i==NONE{continue;}let n=terrain.nodes[i];if (n.flags&4u)!=0u||ancestor_leaf(i,4u){continue;}var allowed=n.score<f.lod.w*0.55||(terrain.leaf_count+48u>u32(f.right.w)&&n.score<worst_priority*0.08);var benefit=f32(atomicLoad(&terrain.leaf_counts[i]))*100.0-n.score;if settled{allowed=n.rank<=f.lod.w||(terrain.leaf_count+48u>u32(f.right.w)&&n.rank<worst_priority);benefit=-n.rank;}if allowed&&benefit>-1e30&&(bk==NONE||benefit>bv){bv=benefit;bk=c;}}
    let pick=sel_argmax(lane,bv,bk);
    if pick==NONE{break;}
    if lane==0u{let best=terrain.merge_candidates[pick];if can_merge(best){merge_node(best);}else{terrain.nodes[best].score=1e30;terrain.nodes[best].rank=1e30;}}
    storageBarrier();
   }
   for(var iteration=0u;iteration<8u;iteration++){
    if lane==0u{sel_ctl=select(0u,1u,terrain.leaf_count+3u>u32(f.right.w));if sel_ctl!=0u{terrain.denied+=1u;}}
    if sel_read_ctl()!=0u{break;}
    var bv=0.0;var bk=NONE;
    for(var c=lane;c<512u;c+=SEL_LANES){let i=terrain.split_candidates[c];if i==NONE{continue;}let n=terrain.nodes[i];let value=select(n.score,n.rank,settled);if (n.flags&4u)!=0u&&value>f.lod.w&&(bk==NONE||value>bv){bv=value;bk=c;}}
    let pick=sel_argmax(lane,bv,bk);
    if pick==NONE{break;}
    if lane==0u{
     sel_ctl=0u;let best=terrain.split_candidates[pick];
     var plan:array<u32,32>;var count=1u;plan[0]=best;var legal=true;
     for(var j=0u;j<32u;j++){if j>=count{break;}let n=plan[j];for(var edge=0u;edge<4u;edge++){let other=neighbor(n,edge,8u,1u);if terrain.nodes[other].key.y>=terrain.nodes[n].key.y{continue;}var present=false;for(var k=0u;k<count;k++){present=present||plan[k]==other;}if !present{if count>=32u||(terrain.nodes[other].flags&4u)==0u||terrain.nodes[other].ready==0u{legal=false;}else{plan[count]=other;count+=1u;}}}}
     // At rest a refusal that will clear stops the round: going on to cheaper leaves would spend out of order. A closure too large to plan stays skipped.
     if !legal||terrain.reserved[1].w+terrain.reserved[9].z+split_growth+3u*count>union_limit||terrain.leaf_count+3u*count>u32(f.right.w)||terrain.free_count<4u*count||terrain.queue_tail+4u*count>256u{terrain.nodes[best].score=0.0;terrain.nodes[best].rank=0.0;terrain.denied+=1u;if settled{stalled=true;if count<32u{sel_ctl=1u;}}}
     else{
      split_growth+=3u*count;
      for(var j=0u;j<count;j++){let node=plan[j];let n=terrain.nodes[node];if (n.flags&4u)==0u{continue;}var children=n.children;
       for(var k=0u;k<4u;k++){var c=children[k];if c==NONE{terrain.free_count-=1u;c=terrain.free[terrain.free_count];children[k]=c;terrain.nodes[c].key=vec4<u32>(n.key.x,n.key.y+1u,n.key.z*2u+(k&1u),n.key.w*2u+(k>>1u));terrain.nodes[c].parent=node;terrain.nodes[c].children=vec4<u32>(NONE);terrain.nodes[c].flags=1u;terrain.nodes[c].ready=0u;terrain.nodes[c].pad=0xffffffffu;terrain.nodes[c].score=0.0;}terrain.nodes[c].flags|=4u;if terrain.nodes[c].ready==0u{terrain.queue[terrain.queue_tail]=c;terrain.queue_tail+=1u;}}
       terrain.nodes[node].children=children;terrain.nodes[node].flags&=~4u;terrain.leaf_count+=3u;terrain.changes+=1u;
      }
     }
    }
    storageBarrier();
    if sel_read_ctl()!=0u{break;}
   }
  }
  // Measured pages: nodes whose serving page changed re-enter generation under the existing
  // job limits, leaves first, and retarget through their trajectories. Bit 64 keeps the
  // publication from reusing their old trajectories; gpu_bounds_finish clears it.
  // Refresh the displayed landing site before distant leaves or cached parents.
  if lane==0u{atomicStore(&sel_or,0u);}
  var refreshed=false;
  if field_measured()&&(run&2u)!=0u{
   var budget=32u;
   for(var round=0u;round<3u;round++){
    var base=0u;let tail=terrain.queue_tail;let room=min(budget,select(0u,256u-tail,tail<256u));
    for(var c=0u;c<NODE_CAP;c+=SEL_LANES){
     let i=c+lane;let flags=terrain.nodes[i].flags;var want=(flags&129u)==129u&&(round==2u||(flags&4u)!=0u);
     if want&&round==0u{let bounds=terrain.cache_bounds[i];let eye=f.eye_hi.xyz+f.eye_lo.xyz;
      want=distance(eye,clamp(eye,bounds.minimum.xyz,bounds.maximum.xyz))<3.0*TERRAIN_SOLID_RANGE;}
     let at=sel_prefix(lane,select(0u,1u,want));
     if want&&base+at<=room{terrain.nodes[i].flags=(flags&~128u)|64u;terrain.queue[tail+base+at-1u]=i;}
     base+=sel_total;workgroupBarrier();
    }
    let taken=min(base,room);budget-=taken;refreshed=refreshed||taken>0u;
    storageBarrier();
    if lane==0u{terrain.queue_tail=tail+taken;}
    storageBarrier();
   }
  }
  workgroupBarrier();
  // Any node whose cut changed or that can retire wakes the next phase.
  for(var c=0u;c<NODE_CAP;c+=SEL_LANES){let i=c+lane;let n=terrain.nodes[i];var bits=0u;if (n.flags&4u)!=((n.flags&32u)>>3u){bits|=1u;}if (n.flags&1u)!=0u&&source_children(i)&&target_ancestor(i)!=NONE&&can_retire(i){bits|=2u;}if bits!=0u{atomicOr(&sel_or,bits);}}
  workgroupBarrier();
  if lane==0u{
   let any=atomicLoad(&sel_or);let cut_changed=(any&1u)!=0u;let retire=(any&2u)!=0u;
   terrain.reserved[9].z+=split_growth;
   // A round that only met refusals has not finished: what refused it clears by itself, so look again, a bounded number of times.
   if stalled&&selected{terrain.reserved[6].z+=1u;}
   if cut_changed||retire||refreshed||terrain.reserved[9].w>0u{terrain.phase=1u;terrain.cooldown=0.0;}else{if terrain.cooldown<=0.0{terrain.cooldown=0.025;}if selected&&terrain.alpha>=1.0&&!(stalled&&terrain.reserved[6].z<CUT_STALL_PASSES){terrain.reserved[7].x=0u;}}
  }
  storageBarrier();
 }
 // Generation jobs: a selection sort of the queue by score, the serial order exactly.
 if lane==0u{let near=abs(f.eye_hi.w-terrain.camera_height)<10000.0;sel_ctl=select(0u,select(min(select(24u,64u,near),u32(f.sun.w)),6u,terrain.generated==0u),terrain.phase==1u);}
 let budget=sel_read_ctl();
 for(var j=0u;j<budget;j++){
  let head=terrain.queue_head;let tail=terrain.queue_tail;
  if lane==0u{sel_total=select(0u,1u,head>=tail);}
  if sel_read_total()!=0u{break;}
  // Serial: best starts at head and moves only to a strictly larger later score.
  let p=head+1u+lane;var v=0.0;var k=NONE;
  if p<tail{let s=terrain.nodes[terrain.queue[p]].score;if s>terrain.nodes[terrain.queue[head]].score{v=s;k=p;}}
  let pick=sel_argmax(lane,v,k);
  if lane==0u{let best=select(pick,head,pick==NONE);let node=terrain.queue[best];terrain.queue[best]=terrain.queue[head];terrain.queue[head]=node;terrain.jobs[j]=node;terrain.queue_head+=1u;terrain.job_count+=1u;}
  storageBarrier();
 }
}
@compute @workgroup_size(256)
fn gpu_union_collect(@builtin(local_invocation_index) lane:u32){
 if lane==0u{sel_ctl=select(0u,1u,terrain.phase!=2u);atomicStore(&sel_max,0u);}
 if sel_read_ctl()!=0u{return;}
 if lane==0u{atomicStore(&terrain.sea_count,0u);}
 // Serial order: union nodes are appended in index order up to the union capacity.
 let start=terrain.union_count;let cap=f.tier_a.y;var base=0u;var over=false;
 for(var c=0u;c<NODE_CAP;c+=SEL_LANES){
  let i=c+lane;let n=terrain.nodes[i];let take=(n.flags&1u)!=0u&&terrain.in_union[i]!=0u;
  terrain.nodes[i].flags=(n.flags&~16u)|select(0u,16u,take);if (n.flags&4u)!=0u{atomicMax(&sel_max,n.key.y);}
  let at=sel_prefix(lane,select(0u,1u,take));
  if take{let pos=start+base+at-1u;if pos<cap{terrain.union_nodes[pos]=i;}else{over=true;}}
  base+=sel_total;workgroupBarrier();
 }
 if over{atomicStore(&terrain.overflow,1u);}
 storageBarrier();workgroupBarrier();
 if lane==0u{
  terrain.max_level=max(terrain.max_level,atomicLoad(&sel_max));terrain.union_count=select(start,min(start+base,cap),start<cap);
  indirect[28]=terrain.union_count;indirect[29]=1u;indirect[30]=1u;indirect[0]=f.tier_a.x/256u;indirect[4]=(terrain.union_count*SAMPLES+63u)/64u;indirect[8]=(terrain.union_count*256u+63u)/64u;
 }
}
@compute @workgroup_size(64)
fn gpu_generate(@builtin(global_invocation_id) id:vec3<u32>){let job=id.x/SAMPLES;let sample=id.x%SAMPLES;if job>=terrain.job_count{return;}let node=terrain.jobs[job];cache_write[node*SAMPLES+sample]=radial_sample(grid_key(node,sample%17u,sample/17u),terrain.nodes[node].key.y);if sample==0u{terrain.nodes[node].ready=select(1u,1u|(node_served(node)<<8u),field_measured());}}
// Local curvature affects priority only. The separate analytical height bound
// remains in diagnostics; these sampled residuals are not a visibility proof.
var<workgroup> residuals:array<f32,64>;
var<workgroup> box_min:array<vec3<f32>,64>;
var<workgroup> box_max:array<vec3<f32>,64>;
@compute @workgroup_size(64)
fn gpu_metrics(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3<u32>){
 let job=group.x;let valid=job<terrain.job_count;let node=terrain.jobs[job];var peak=0.0;var low=vec3<f32>(1e30);var high=vec3<f32>(-1e30);
 for(var k=lane;k<select(0u,SAMPLES,valid);k+=64u){let sample=cache[node*SAMPLES+k];let position=sample.hi.xyz+sample.lo.xyz;low=min(low,position);high=max(high,position);let x=k%17u;let y=k/17u;let ox=min(14u,(x/2u)*2u);let oy=min(14u,(y/2u)*2u);let q=vec2<f32>(f32(x-ox),f32(y-oy))*0.5;
  let a=cache[node*SAMPLES+oy*17u+ox].lo.w;let b=cache[node*SAMPLES+oy*17u+ox+2u].lo.w;let c=cache[node*SAMPLES+(oy+2u)*17u+ox+2u].lo.w;let d=cache[node*SAMPLES+(oy+2u)*17u+ox].lo.w;var h=0.0;
  if ((ox/2u+oy/2u)&1u)==0u{if q.x>=q.y{h=a*(1.0-q.x)+b*(q.x-q.y)+c*q.y;}else{h=a*(1.0-q.y)+c*q.x+d*(q.y-q.x);}}
  else{if q.x+q.y<=1.0{h=a*(1.0-q.x-q.y)+b*q.x+d*q.y;}else{h=b*(1.0-q.y)+c*(q.x+q.y-1.0)+d*(1.0-q.x);}}
  peak=max(peak,abs(cache[node*SAMPLES+k].lo.w-h));
 }
 // Targets may blend the parent diamond interpolant across six child cells.
 // Include its complete local 9x9 vertex hull, not merely the child heights.
 if valid{let parent=terrain.nodes[node].parent;if parent!=NONE{let quadrant=(terrain.nodes[node].key.zw&vec2<u32>(1))*8u;for(var i=lane;i<81u;i+=64u){let xy=quadrant+vec2<u32>(i%9u,i/9u);let s=cache[parent*SAMPLES+xy.y*17u+xy.x];low=min(low,s.hi.xyz+s.lo.xyz);high=max(high,s.hi.xyz+s.lo.xyz);}}}
 residuals[lane]=peak;box_min[lane]=low;box_max[lane]=high;workgroupBarrier();for(var step=32u;step>0u;step>>=1u){if lane<step{residuals[lane]=max(residuals[lane],residuals[lane+step]);box_min[lane]=min(box_min[lane],box_min[lane+step]);box_max[lane]=max(box_max[lane],box_max[lane+step]);}workgroupBarrier();}
 if lane==0u&&valid{let level=terrain.nodes[node].key.y;let spacing=f.planet.x*0.125*exp2(-f32(level));let spectrum=field_unresolved(spacing);let unresolved=spectrum.x;let border=spectrum.y;terrain.cache_bounds[node]=Bounds(vec4<f32>(box_min[0],border),vec4<f32>(box_max[0],1));terrain.nodes[node].padding.x=residuals[0]*0.75+sqrt(unresolved)*0.8+spacing*spacing/f.planet.x;}
}
fn ancestor_leaf(node:u32,bit:u32)->bool{var n=node;for(var i=0u;i<=MAX_LEVEL;i++){if (terrain.nodes[n].flags&bit)!=0u{return true;}let p=terrain.nodes[n].parent;if p==NONE{break;}n=p;}return false;}
@compute @workgroup_size(1)
fn gpu_prepare(){
 indirect[0]=0u;indirect[1]=1u;indirect[2]=1u;indirect[4]=0u;indirect[5]=1u;indirect[6]=1u;indirect[8]=0u;indirect[9]=1u;indirect[10]=1u;indirect[28]=0u;indirect[29]=1u;indirect[30]=1u;
 terrain.generated+=terrain.job_count*SAMPLES;
 if terrain.phase!=1u||terrain.queue_head<terrain.queue_tail{return;}
 // At extreme travel speeds, build up to four generations of the desired cut
 // before exposing it. The old complete surface stays active. A single morph
 // then starts from that actual surface toward the better available target,
 // rather than displaying several short-lived intermediate height plateaus.
 // Reserve cumulative union growth across the batch; never raise work/pool caps.
 if terrain.epochs>0u&&terrain.reserved[9].y>0u&&terrain.reserved[9].w<3u&&terrain.reserved[9].z<192u{terrain.reserved[9].w+=1u;terrain.phase=0u;return;}
 terrain.reserved[9].z=0u;terrain.reserved[9].w=0u;
 terrain.phase=2u;terrain.build_bank=1u-terrain.active_bank;terrain.union_count=0u;terrain.max_level=0u;atomicStore(&terrain.overflow,0u);atomicStore(&terrain.vertices,0u);atomicStore(&terrain.probe_max,0u);
}
@compute @workgroup_size(64)
fn gpu_union_flags(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if i>=NODE_CAP||terrain.phase!=2u{return;}let n=terrain.nodes[i];if (n.flags&1u)==0u{return;}var include=false;terrain.nodes[i].padding.z=f32(mask_for(i,1u));
 if (n.flags&4u)!=0u&&ancestor_leaf(i,2u){include=true;}
 if source_children(i)&&target_ancestor(i)!=NONE&&can_retire(i){include=true;}
 if (n.flags&2u)!=0u&&target_ancestor(i)!=NONE{let parent=n.parent;include=parent==NONE||!source_children(parent)||!can_retire(parent);}
 terrain.in_union[i]=select(0u,1u,include);
 atomicStore(&terrain.bounds_accum[i].a,0xff7fffffu);atomicStore(&terrain.bounds_accum[i].b,0xff7fffffu);atomicStore(&terrain.bounds_accum[i].c,0xff7fffffu);atomicStore(&terrain.bounds_accum[i].d,0x00800000u);atomicStore(&terrain.bounds_accum[i].e,0x00800000u);atomicStore(&terrain.bounds_accum[i].g,0x00800000u);
}
// Shared vertices get one slot of the build bank's table: linear probing from the hash of the vertex's cube key,
// at most 128 slots from home. The claim uses atomicMax only (WebKit before the fix of 13 September 2026 cannot
// compile atomicCompareExchangeWeak: its Metal helper is ill-formed, docs/VERTEX-TABLE.md). A slot keeps the
// highest sample number offered to it; the one pushed out, or the one that lost, is carried on to the next slot
// by the same invocation. Every slot from a key's home to its place therefore holds a higher number, so the table
// is the one a serial insertion in falling sample order builds, whatever the order of execution, and the owner of
// a shared vertex is its highest sample. A lower duplicate that was pushed past its key's home before the owner
// arrived can stay in the table: gpu_hash_resolve never maps to it, nothing writes it, and gpu_clear has given
// every slot of the bank a key no vertex has, so lookup_morph of a later build cannot take what it held before.
const HASH_REACH:u32=128u;
const HASH_WALK:u32=1024u;
@compute @workgroup_size(256)
fn gpu_clear(@builtin(global_invocation_id) id:vec3<u32>){if id.x>=f.tier_a.x||terrain.phase!=2u{return;}atomicStore(&vertex_owners[terrain.build_bank*f.tier_a.x+id.x],0u);let none=vec4<i32>(-2147483647-1,0,0,0);if terrain.build_bank==0u{morph_write[id.x].key=none;}else{morph_write_b[id.x].key=none;}}
fn logical_key(id:u32)->vec3<i32>{let local=id%SAMPLES;return grid_key(terrain.union_nodes[id/SAMPLES],local%17u,local/17u);}
fn key_home(key:vec3<i32>)->u32{return hash(bitcast<u32>(key.x)^hash(bitcast<u32>(key.y)^hash(bitcast<u32>(key.z))));}
@compute @workgroup_size(64)
fn gpu_hash(@builtin(global_invocation_id) id:vec3<u32>){if id.x>=terrain.union_count*SAMPLES||terrain.phase!=2u{return;}
 let mask=f.tier_a.x-1u;let bank=terrain.build_bank*f.tier_a.x;var carried=id.x+1u;var key=logical_key(id.x);var slot=key_home(key)&mask;var reach=0u;
 for(var step=0u;step<HASH_WALK;step++){
  if reach>=HASH_REACH{break;}
  let old=atomicMax(&vertex_owners[bank+slot],carried);
  if old==0u{return;}
  let other=logical_key(old-1u);
  // The same vertex twice: the higher sample holds the slot, the lower one is dropped.
  if all(other==key){return;}
  // The slot now holds the higher of the two; go on with the lower one, from its own distance to its home.
  if old<carried{carried=old;key=other;reach=(slot-key_home(other))&mask;}
  slot=(slot+1u)&mask;reach+=1u;
 }
 atomicAdd(&terrain.overflow,1u);
}
// After every claim has settled: the first slot from a key's home that holds the key is its owner's.
@compute @workgroup_size(64)
fn gpu_hash_resolve(@builtin(global_invocation_id) id:vec3<u32>){if id.x>=terrain.union_count*SAMPLES||terrain.phase!=2u{return;}
 let key=logical_key(id.x);let first=key_home(key);let at=terrain.build_bank*f.tier_a.y*SAMPLES+id.x;
 for(var probe=0u;probe<HASH_REACH;probe++){
  let index=terrain.build_bank*f.tier_a.x+((first+probe)&(f.tier_a.x-1u));let owner=atomicLoad(&vertex_owners[index]);
  if owner==0u{break;}
  if owner==id.x+1u{vertex_map[at]=index;atomicAdd(&terrain.vertices,1u);atomicMax(&terrain.probe_max,probe);return;}
  if all(logical_key(owner-1u)==key){vertex_map[at]=index;return;}
 }
 atomicAdd(&terrain.overflow,1u);vertex_map[at]=0u;
}
// Node numbers come from the allocator, so a choice between equals made on them follows the route taken.
fn key_less(p:vec4<u32>,q:vec4<u32>)->bool{if p.x!=q.x{return p.x<q.x;}if p.z!=q.z{return p.z<q.z;}return p.w<q.w;}
fn sample_owner(node:u32,xy:vec2<u32>,which:u32)->u32{if all(xy>vec2<u32>(0))&&all(xy<vec2<u32>(16)){return node*SAMPLES+xy.y*17u+xy.x;}let key=grid_key(node,xy.x,xy.y);let uv=on_face_key(key,terrain.nodes[node].key.x);var owner=node;for(var y=-1;y<=1;y+=2){for(var x=-1;x<=1;x+=2){let other=find_leaf(cube_key(terrain.nodes[node].key.x,uv.x+x,uv.y+y),which);let a=terrain.nodes[other].key.y;let b=terrain.nodes[owner].key.y;if a<b||(a==b&&select(other<owner,key_less(terrain.nodes[other].key,terrain.nodes[owner].key),field_measured())){owner=other;}}}let k=terrain.nodes[owner].key;let c=on_face_key(key,k.x);let shift=MAX_LEVEL-k.y;let global=vec2<u32>(c+vec2<i32>(Q))/2u;let local=(global>>vec2<u32>(shift))-k.zw*GRID;return owner*SAMPLES+min(16u,local.y)*17u+min(16u,local.x);}
struct Basis { ids:vec4<u32>,weights:vec4<f32> }
fn basis_for(key:vec3<i32>,which:u32)->Basis{let node=find_leaf(key,which);let k=terrain.nodes[node].key;let uv=on_face_key(key,k.x);let global=vec2<u32>(uv+vec2<i32>(Q))/2u;let step=1u<<(MAX_LEVEL-k.y);let whole=(global>>(vec2<u32>(MAX_LEVEL-k.y)))-k.zw*GRID;let fraction=vec2<f32>(global&vec2<u32>(step-1u))/f32(step);let q=vec2<f32>(whole)+fraction;let origin=vec2<i32>(floor(q));let mask=mask_for(node,which);if all(fraction==vec2<f32>(0))&&all(collapse(whole,mask)==whole){return Basis(vec4<u32>(sample_owner(node,whole,which)),vec4<f32>(1,0,0,0));}
 for(var y=max(0,origin.y-1);y<=min(15,origin.y+1);y++){for(var x=max(0,origin.x-1);x<=min(15,origin.x+1);x++){for(var t=0u;t<2u;t++){let raw=cell_triangle(u32(x),u32(y),t);let a=collapse(raw[0],mask);let b=collapse(raw[1],mask);let c=collapse(raw[2],mask);let af=vec2<f32>(a);let bf=vec2<f32>(b);let cf=vec2<f32>(c);let den=(bf.y-cf.y)*(af.x-cf.x)+(cf.x-bf.x)*(af.y-cf.y);if abs(den)<0.5{continue;}let w0=((bf.y-cf.y)*(q.x-cf.x)+(cf.x-bf.x)*(q.y-cf.y))/den;let w1=((cf.y-af.y)*(q.x-cf.x)+(af.x-cf.x)*(q.y-cf.y))/den;let w2=1.0-w0-w1;if min(w0,min(w1,w2))>=-0.00001{return Basis(vec4<u32>(sample_owner(node,a,which),sample_owner(node,b,which),sample_owner(node,c,which),0),vec4<f32>(max(vec3<f32>(0),vec3<f32>(w0,w1,w2)),0));}}}}
 atomicAdd(&terrain.overflow,1u);return Basis(vec4<u32>(node*SAMPLES),vec4<f32>(1,0,0,0));
}
@compute @workgroup_size(64)
fn gpu_snap_flags(@builtin(global_invocation_id) id:vec3<u32>){let node=id.x;if node>=NODE_CAP||terrain.phase!=2u||(terrain.nodes[node].flags&16u)==0u{return;}var source=node;var p=node;for(var j=0u;j<=MAX_LEVEL;j++){if (terrain.nodes[p].flags&2u)!=0u{source=p;break;}let parent=terrain.nodes[p].parent;if parent==NONE{break;}p=parent;}let goal=target_ancestor(node);if goal!=NONE{terrain.hidden[node]=select(0u,4u,transition_hidden(terrain.render_bounds[source],terrain.cache_bounds[goal]));}else{terrain.hidden[node]=0u;}}
fn star_hidden(key:vec3<i32>)->bool{let node=find_leaf(key,2u);let k=terrain.nodes[node].key;if (terrain.hidden[node]&4u)==0u{return false;}let uv=on_face_key(key,k.x);let global=vec2<u32>(uv+vec2<i32>(Q))/2u;let width=1u<<(28u-k.y);let low=k.zw*width;let at_edge=any(global==low)||any(global==low+vec2<u32>(width));if !at_edge{return true;}for(var y=-1;y<=1;y+=2){for(var x=-1;x<=1;x+=2){let other=find_leaf(cube_key(k.x,uv.x+x,uv.y+y),2u);if (terrain.hidden[other]&4u)==0u{return false;}}}return true;}
fn key_from_sample(id:u32)->vec3<i32>{let local=id%SAMPLES;return grid_key(id/SAMPLES,local%17u,local/17u);}
// Spread the coarse/fine residual over six cells instead of putting an entire
// octave difference into the last edge cell. Shared points still have ONE owner.
// Parent interpolation uses the actual diamond triangles, not a bilinear plane.
fn target_sample(id:u32)->Sample{
 let node=id/SAMPLES;let n=terrain.nodes[node];let fine=cache[id];let mask=u32(n.padding.z);
 if mask==0u||n.parent==NONE{return fine;}
 let xy=vec2<u32>(id%17u,(id%SAMPLES)/17u);var distance=16.0;
 if (mask&1u)!=0u{distance=min(distance,f32(xy.x));}if (mask&2u)!=0u{distance=min(distance,16.0-f32(xy.x));}
 if (mask&4u)!=0u{distance=min(distance,f32(xy.y));}if (mask&8u)!=0u{distance=min(distance,16.0-f32(xy.y));}
 let blend=smoothstep(0.0,6.0,distance);if blend>=1.0{return fine;}
 let q=vec2<f32>((n.key.zw&vec2<u32>(1))*16u+xy)*0.5;let cell=min(vec2<u32>(q),vec2<u32>(15));let t=q-vec2<f32>(cell);
 let a=cell;let b=cell+vec2<u32>(1,0);let c=cell+vec2<u32>(1);let d=cell+vec2<u32>(0,1);
 var corners=array<vec2<u32>,3>(a,b,c);var weights=vec3<f32>(1.0-t.x,t.x-t.y,t.y);
 if ((cell.x+cell.y)&1u)==0u{if t.y>t.x{corners=array<vec2<u32>,3>(a,c,d);weights=vec3<f32>(1.0-t.y,t.x,t.y-t.x);}}
 else{if t.x+t.y<=1.0{corners=array<vec2<u32>,3>(a,b,d);weights=vec3<f32>(1.0-t.x-t.y,t.x,t.y);}else{corners=array<vec2<u32>,3>(b,c,d);weights=vec3<f32>(1.0-t.y,t.x+t.y-1.0,1.0-t.x);}}
 var lo=vec4<f32>(0);var normal=vec3<f32>(0);var spacing=0.0;
 for(var i=0u;i<3u;i++){let s=cache[n.parent*SAMPLES+corners[i].y*17u+corners[i].x];lo+=vec4<f32>((s.hi.xyz-fine.hi.xyz)+s.lo.xyz,s.lo.w)*weights[i];normal+=s.normal.xyz*weights[i];spacing+=s.hi.w*weights[i];}
 return Sample(vec4<f32>(fine.hi.xyz,mix(spacing,fine.hi.w,blend)),mix(lo,fine.lo,blend),vec4<f32>(normalize(mix(normal,fine.normal.xyz,blend)),fine.normal.w));
}
@compute @workgroup_size(64)
fn gpu_morph_vertices(@builtin(global_invocation_id) id:vec3<u32>){if id.x>=terrain.union_count*SAMPLES||terrain.phase!=2u{return;}let slot=vertex_map[terrain.build_bank*f.tier_a.y*SAMPLES+id.x];if atomicLoad(&vertex_owners[slot])!=id.x+1u{return;}let key=logical_key(id.x);let node=terrain.union_nodes[id.x/SAMPLES];let local=id.x%SAMPLES;let xy=vec2<u32>(local%17u,local/17u);
 // Reuse only an unchanged leaf of the ACTUAL published surface. A deferred
 // desired cut may contain cached leaves that have not been published; their
 // coincident keys can still find a coarser trajectory in the old vertex map.
 // Reusing that trajectory would leave stale coarse heights in a refined patch.
 // On a measured body a leaf with a coarser neighbour blends toward its parent, which reads another page and can change alone, so it recomputes and the compare below keeps what did not move.
 if terrain.epochs>0u&&(terrain.nodes[node].flags&102u)==38u&&terrain.nodes[node].pad==u32(terrain.nodes[node].padding.z)&&(!field_measured()||u32(terrain.nodes[node].padding.z)==0u)&&all(xy>vec2<u32>(0))&&all(xy<vec2<u32>(16)){let old=lookup_morph(key);if old!=NONE{write_morph(slot,reuse_morph(read_morph(old)));return;}}
 let origin=base_position(key).hi.xyz;let goal=basis_for(key,1u);var end=vec4<f32>(0);var nb=vec4<f32>(0);var water=WATER_NONE;var water_sum=0.0;var water_weight=0.0;var excess=false;
 // Levels average as levels. Excess-coded samples convert at their own height and the result codes back as an excess over this vertex.
 for(var i=0u;i<3u;i++){if goal.weights[i]==0.0{continue;}let sample=target_sample(goal.ids[i]);if sample.normal.w>WATER_NONE{water_sum+=vertex_water_decode(sample.normal.w,sample.lo.w)*goal.weights[i];water_weight+=goal.weights[i];excess=excess||sample.normal.w>WATER_EXCESS_SPLIT;}end+=vec4<f32>((sample.hi.xyz-origin)+sample.lo.xyz,sample.lo.w)*goal.weights[i];nb+=vec4<f32>(sample.normal.xyz,sample.hi.w)*goal.weights[i];}nb=vec4<f32>(normalize(nb.xyz),nb.w);
 if water_weight>0.0{water=water_sum/water_weight;if excess{water=WATER_EXCESS_FLAG+(water-end.w);}}
 let motion=terrain_motion_weight(origin,end.xyz);
 if motion==0.0{
  write_morph(slot,Morph(vec4<i32>(key,bitcast<i32>(water)),vec4<f32>(origin,clock_now()-1.0),end,end,nb,nb,vec4<f32>(0,0,0,0.14)));return;
 }
 var start=end;var na=nb;var velocity=vec3<f32>(0);let duration=0.14;var birth=clock_now()-duration;
 if terrain.epochs>0u{
  let old_slot=lookup_morph(key);
  if old_slot!=NONE{let old=read_morph(old_slot);if all(abs(old.b-end)<vec4<f32>(0.00001))&&all(abs(old.nb-nb)<vec4<f32>(0.00001))&&old.key.w==bitcast<i32>(water){write_morph(slot,old);return;}}
  let source=basis_for(key,0u);start=vec4<f32>(0);na=vec4<f32>(0);
  for(var i=0u;i<3u;i++){if source.weights[i]==0.0{continue;}let previous_slot=lookup_morph(key_from_sample(source.ids[i]));if previous_slot==NONE{atomicAdd(&terrain.overflow,1u);continue;}let old=read_morph(previous_slot);let sample=morph_sample(old,clock_now());start+=vec4<f32>((sample.hi.xyz-origin)+sample.lo.xyz,sample.lo.w)*source.weights[i];na+=vec4<f32>(sample.normal.xyz,sample.hi.w)*source.weights[i];velocity+=morph_velocity(old,clock_now())*source.weights[i];}
  na=vec4<f32>(normalize(na.xyz),na.w);birth=clock_now();
 }
 if terrain.epochs>0u&&star_hidden(key){start=end;na=nb;velocity=vec3<f32>(0);birth=clock_now()-duration;}
 // Componentwise monotone cubic: a carried derivative is retained only when
 // it points toward the new target, and cannot exceed 3*distance/duration.
 // Retarget positions stay exact; incompatible derivatives are deliberately
 // discarded instead of producing a temporary hill that then falls back.
 let delta=end.xyz-start.xyz;
 // New data can move a vertex tens of metres, which is a jump in the usual morph time. On a measured body
 // a morph takes time in proportion to how far it goes, and the shading's fade in runs alongside it.
 var span=duration;if field_measured(){span=clamp(length(delta)/60.0,duration,0.6);}
 span=max(0.001,span*motion);
 velocity=sign(delta)*clamp(velocity*sign(delta),vec3<f32>(0),abs(delta)*(3.0/span));
 write_morph(slot,Morph(vec4<i32>(key,bitcast<i32>(water)),vec4<f32>(origin,birth),start,end,na,nb,vec4<f32>(velocity,span)));
}
// Bounds include current motion plus the carried derivative on the next
// retarget. The envelope uses h/(1-smoothstep(t)) <= duration/3.
@compute @workgroup_size(64)
fn gpu_render_bounds(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3<u32>){var low=vec3<f32>(1e30);var high=vec3<f32>(-1e30);for(var i=lane;i<SAMPLES;i+=64u){let slot=vertex_map[terrain.build_bank*f.tier_a.y*SAMPLES+group.x*SAMPLES+i];let m=read_morph(slot);let envelope=abs(m.velocity.xyz)*m.velocity.w*(13.0/27.0)+abs(m.b.xyz-m.a.xyz)*0.5;low=min(low,m.hi.xyz+min(m.a.xyz,m.b.xyz)-envelope);high=max(high,m.hi.xyz+max(m.a.xyz,m.b.xyz)+envelope);}box_min[lane]=low;box_max[lane]=high;workgroupBarrier();for(var step=32u;step>0u;step>>=1u){if lane<step{box_min[lane]=min(box_min[lane],box_min[lane+step]);box_max[lane]=max(box_max[lane],box_max[lane+step]);}workgroupBarrier();}if lane==0u{let lo=ordered_float(box_min[0]);let hi=ordered_float(box_max[0]);var n=terrain.union_nodes[group.x];for(var j=0u;j<=MAX_LEVEL;j++){atomicMin(&terrain.bounds_accum[n].a,lo.x);atomicMin(&terrain.bounds_accum[n].b,lo.y);atomicMin(&terrain.bounds_accum[n].c,lo.z);atomicMax(&terrain.bounds_accum[n].d,hi.x);atomicMax(&terrain.bounds_accum[n].e,hi.y);atomicMax(&terrain.bounds_accum[n].g,hi.z);let p=terrain.nodes[n].parent;if p==NONE{break;}n=p;}}}
// The highest water a node holds. Nine samples touch every level cell, since a node spans two. Water texels
// can hold a channel between them, so a node reading such a page takes every sample.
fn node_water_level(n:u32)->f32{
 if !field_measured(){return f.planet.y;}
 var top=WATER_NONE;var texels=false;for(var y=0u;y<=16u;y+=8u){for(var x=0u;x<=16u;x+=8u){let s=cache[n*SAMPLES+y*17u+x];top=max(top,vertex_water_decode(s.normal.w,s.lo.w));texels=texels||s.normal.w>WATER_EXCESS_SPLIT;}}
 if texels{for(var k=0u;k<SAMPLES;k++){let s=cache[n*SAMPLES+k];top=max(top,vertex_water_decode(s.normal.w,s.lo.w));}}
 return top;
}
@compute @workgroup_size(64)
fn gpu_bounds_finish(@builtin(global_invocation_id) id:vec3<u32>){let n=id.x;if n>=NODE_CAP||terrain.phase!=2u||atomicLoad(&terrain.overflow)!=0u||(terrain.nodes[n].flags&1u)==0u{return;}if (terrain.nodes[n].flags&4u)!=0u{terrain.nodes[n].pad=u32(terrain.nodes[n].padding.z);}terrain.nodes[n].flags&=~64u;let low=from_ordered(vec3<u32>(atomicLoad(&terrain.bounds_accum[n].a),atomicLoad(&terrain.bounds_accum[n].b),atomicLoad(&terrain.bounds_accum[n].c)));let high=from_ordered(vec3<u32>(atomicLoad(&terrain.bounds_accum[n].d),atomicLoad(&terrain.bounds_accum[n].e),atomicLoad(&terrain.bounds_accum[n].g)));terrain.render_bounds[n]=Bounds(vec4<f32>(low,8),vec4<f32>(high,select(0.0,1.0,all(high>=low))));
 // Sea membership for the ocean draw list (world box, planet centre at the
 // origin): the box's nearest radius, lowered by the level's height error,
 // must reach the sea plus wave amplitude and a precision margin. Patches
 // left out cannot show any sea surface, so skipping them is exact.
 var slot=NONE;
 if (terrain.nodes[n].flags&16u)!=0u&&all(high>=low){
  let nearest=clamp(vec3<f32>(0),low,high);
  let floor_height=length(nearest)-f.planet.x-terrain.errors[min(terrain.nodes[n].key.y,24u)];
  if floor_height<=node_water_level(n)+2.0*f.water.x+8.0{slot=atomicAdd(&terrain.sea_count,1u);}
 }
 terrain.node_slots[n]=slot;}
@compute @workgroup_size(64)
fn gpu_indices(@builtin(global_invocation_id) id:vec3<u32>){if id.x>=terrain.union_count*256u||terrain.phase!=2u{return;}let patch_index=id.x/256u;let cell=id.x%256u;let node=terrain.union_nodes[patch_index];let mask=mask_for(node,2u);for(var t=0u;t<2u;t++){let raw=cell_triangle(cell%16u,cell/16u,t);let slot=terrain.node_slots[node];for(var i=0u;i<3u;i++){let p=collapse(raw[i],mask);let v=vertex_map[terrain.build_bank*f.tier_a.y*SAMPLES+patch_index*SAMPLES+p.y*17u+p.x];index_write[terrain.build_bank*2u*f.tier_c.w+id.x*6u+t*3u+i]=v;if slot!=NONE{index_write[terrain.build_bank*2u*f.tier_c.w+f.tier_c.w+slot*1536u+cell*6u+t*3u+i]=v;}}}}
@compute @workgroup_size(1)
fn gpu_finish(){if terrain.phase==2u{if atomicLoad(&terrain.overflow)==0u{terrain.active_bank=terrain.build_bank;indirect[12]=terrain.union_count*1536u;indirect[13]=1u;indirect[14]=terrain.active_bank*2u*f.tier_c.w;indirect[15]=0u;indirect[16]=0u;indirect[36]=atomicLoad(&terrain.sea_count)*1536u;indirect[37]=1u;indirect[38]=terrain.active_bank*2u*f.tier_c.w+f.tier_c.w;indirect[39]=0u;indirect[40]=0u;terrain.epochs+=1u;terrain.reserved[1].y=bitcast<u32>(clock_now());terrain.reserved[1].w=terrain.union_count;for(var i=0u;i<terrain.union_count;i++){terrain.published_nodes[i]=terrain.union_nodes[i];}indirect[20]=(terrain.union_count*SAMPLES+63u)/64u;indirect[21]=1u;indirect[22]=1u;}else{terrain.denied+=1u;terrain.leaf_count=0u;for(var i=0u;i<NODE_CAP;i++){let flags=terrain.nodes[i].flags;terrain.nodes[i].flags=(flags&~20u)|((flags&32u)>>3u)|((flags&2u)<<3u);if (flags&32u)!=0u{terrain.leaf_count+=1u;}}}terrain.phase=0u;terrain.reserved[1].z=1u;}
 let previous=projected_frame;projected_frame=f;projected_frame.lod.x=clock_now();terrain.alpha=clamp(morph_elapsed(clock_now(),bitcast<f32>(terrain.reserved[1].y))/0.14,0.0,1.0);
 projected_frame.prev_hi=previous.eye_hi;projected_frame.prev_lo=previous.eye_lo;projected_frame.prev_right=previous.right;projected_frame.prev_up=previous.up;projected_frame.prev_forward=previous.forward;
 // A physical camera already has collision clearance. Lifting it independently would desynchronise imported meshes and collision readback coordinates.
 var lift=0.0;projected_frame.water_motion.z=1.0;
 if f.eye_tail.w<.5&&f.eye_hi.w<20000.0&&terrain.epochs>0u{let key=eye_key();let a=basis_for(key,2u);var p=vec3<f32>(0);var spacing=0.0;for(var i=0u;i<3u;i++){if a.weights[i]==0.0{continue;}let slot=lookup_morph(key_from_sample(a.ids[i]));if slot!=NONE{let sample=morph_sample(read_morph(slot),clock_now());p+=relative(sample)*a.weights[i];spacing=max(spacing,sample.hi.w);}}projected_frame.water_motion.z=spacing;let n=normalize(f.eye_hi.xyz+f.eye_lo.xyz);lift=max(0.0,dot(p,n)+1.9);projected_frame.eye_lo=vec4<f32>(f.eye_lo.xyz+n*lift,f.eye_lo.w);projected_frame.eye_hi.w=f.eye_hi.w+lift;}
 terrain.reserved[0].x=bitcast<u32>(lift);projected_frame.sun.w=f.prev_hi.w;
}
// Explicit diagnostic dispatch only: 64 fixed near-camera directions, no
// production readback or scheduling dependency. Records actual shared motion.
@compute @workgroup_size(64)
fn gpu_audit_morph(@builtin(global_invocation_id) id:vec3<u32>){
 let radial=normalize(f.eye_hi.xyz+f.eye_lo.xyz);let forward=normalize(f.forward.xyz-radial*dot(f.forward.xyz,radial));
 let position=f.eye_hi.xyz+f.eye_lo.xyz+f.right.xyz*(f32(id.x%8u)-3.5)*32.0+forward*(f32(id.x/8u)*32.0+8.0);
 let key=vec3<i32>(round(position/max(abs(position.x),max(abs(position.y),abs(position.z)))*f32(Q)));
 let base=base_position(key);let n=base.normal.xyz;let basis=basis_for(key,2u);var start=0.0;var end=0.0;var current=0.0;var excess=0.0;
 for(var i=0u;i<3u;i++){if basis.weights[i]==0.0{continue;}let slot=lookup_morph(key_from_sample(basis.ids[i]));if slot==NONE{continue;}let m=read_morph(slot);let s=morph_sample(m,clock_now());let origin=(m.hi.xyz-base.hi.xyz)-base.lo.xyz;
  start+=dot(origin+m.a.xyz,n)*basis.weights[i];end+=dot(origin+m.b.xyz,n)*basis.weights[i];current+=dot(origin+s.lo.xyz,n)*basis.weights[i];
  let p=s.lo.xyz;excess=max(excess,max(max(max(p.x-max(m.a.x,m.b.x),min(m.a.x,m.b.x)-p.x),max(p.y-max(m.a.y,m.b.y),min(m.a.y,m.b.y)-p.y)),max(p.z-max(m.a.z,m.b.z),min(m.a.z,m.b.z)-p.z)));
 }
 audit_probes[id.x]=vec4<f32>(start,current,end,max(0.0,excess));
}
