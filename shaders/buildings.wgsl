// Imported footprints, not uploaded meshes. The same prisms serve every range
// and shadow cascade. Roof coverage uses even/odd rings, including courtyards.
struct BuildingSource {hi:vec4<f32>,lo:vec4<f32>,east:vec4<f32>,north:vec4<f32>,bounds:vec4<f32>,data:vec4<u32>,colour:vec4<f32>}
struct BuildingPoint {p:vec2<f32>,next:u32,boundary:u32}
@group(0) @binding(127) var<storage,read> building_sources:array<BuildingSource>;
@group(0) @binding(128) var<storage,read> building_points:array<BuildingPoint>;
@group(0) @binding(129) var<storage,read_write> building_refs_write:array<vec2<u32>>;
@group(0) @binding(130) var<storage,read> building_refs:array<vec2<u32>>;
@group(0) @binding(131) var<storage,read_write> building_state:array<atomic<u32>,8>;
@group(0) @binding(132) var<storage,read_write> building_support_write:array<vec4<f32>>;
@group(0) @binding(133) var<storage,read> building_support:array<vec4<f32>>;
@group(0) @binding(134) var<uniform> building_control:vec4<u32>;
struct UrbanNode {lo:vec2<f32>,hi:vec2<f32>,end:u32,source:u32}
struct UrbanIndex {hi:vec4<f32>,lo:vec4<f32>,east:vec4<f32>,north:vec4<f32>,grid:vec4<f32>,info:vec4<u32>,cells:array<u32,16384>,nodes:array<UrbanNode,32767>,sources:array<BuildingSource,16384>,points:array<BuildingPoint,131072>}
@group(0) @binding(177) var<storage,read> urban_index:UrbanIndex;
struct UrbanQuery {p:vec2<f32>,first:u32,end:u32,roads_only:bool}
fn urban_query(hi:vec3<f32>,lo:vec3<f32>,roads_only:bool)->UrbanQuery{
 var empty:UrbanQuery;
 if !field_measured()||f.scenery_work.w<.5||urban_index.info.x==0u{return empty;}
 let d=(hi-urban_index.hi.xyz)+(lo-urban_index.lo.xyz);let q=vec2<f32>(dot(d,urban_index.east.xyz),dot(d,urban_index.north.xyz))*f.planet.x/length(hi+lo);
 let cell=vec2<i32>(floor((q-urban_index.grid.xy)/urban_index.grid.z));if any(cell<vec2<i32>(0))||any(cell>=vec2<i32>(128)){return empty;}
 let span=urban_index.cells[u32(cell.y)*128u+u32(cell.x)];
 if roads_only&&(span&0x80000000u)==0u{return empty;}
 return UrbanQuery(q,span&65535u,(span>>16u)&32767u,roads_only);
}
// Return only leaves whose padded bound contains the query. An internal
// node's end skips both children, even when a dense cell straddles subtrees.
fn urban_leaf(query:UrbanQuery,start:u32)->u32{
 var i=start;
 while i<query.end{
  let n=urban_index.nodes[i];
  if (query.roads_only&&(n.end&0x80000000u)==0u)||any(query.p<n.lo)||any(query.p>n.hi){i=n.end&32767u;continue;}
  if n.source!=0xffffffffu{return i;}
  i++;
 }
 return query.end;
}
fn urban_local(b:BuildingSource,hi:vec3<f32>,lo:vec3<f32>)->vec2<f32>{let d=(hi-b.hi.xyz)+(lo-b.lo.xyz);return vec2<f32>(dot(d,b.east.xyz),dot(d,b.north.xyz))*f.planet.x/length(hi+lo);}
fn urban_segment(q:vec2<f32>,a:vec2<f32>,b:vec2<f32>)->f32{let d=b-a;return length(q-a-d*clamp(dot(q-a,d)/max(.0001,dot(d,d)),0.0,1.0));}
// Shared by visible vegetation and the physics snapshot, including source updates.
fn urban_blocked(hi:vec3<f32>,lo:vec3<f32>,margin:f32)->bool{
 let query=urban_query(hi,lo,false);
 for(var i=urban_leaf(query,query.first);i<query.end;i=urban_leaf(query,i+1u)){
  let b=urban_index.sources[urban_index.nodes[i].source];let q=urban_local(b,hi,lo);
  if any(q<b.bounds.xy-vec2<f32>(margin))||any(q>b.bounds.zw+vec2<f32>(margin)){continue;}
  if b.colour.w<0.0{if urban_segment(q,urban_index.points[b.data.x].p,urban_index.points[b.data.x+1u].p)<b.east.w*.5+margin{return true;}}
  else{
   if urban_inside(q,b){return true;}
   for(var j=0u;j<b.data.y;j++){let a=urban_index.points[b.data.x+j];if urban_segment(q,a.p,urban_index.points[a.next].p)<margin{return true;}}
  }
 }return false;
}
// Paint the displayed terrain itself: identical depth and silhouette throughout LOD morphs.
fn urban_road(hi:vec3<f32>,lo:vec3<f32>,footprint:f32)->vec4<f32>{
 let query=urban_query(hi,lo,true);if query.first==query.end{return vec4<f32>(0);}
 let aa=max(.015,footprint*.7);var boundary=1e20;var coverage=0.0;
 var colour=vec3<f32>(0);var marked=false;var center=0.0;var longitudinal=false;var nearest=0u;var cap=vec2<f32>(0);
 for(var i=urban_leaf(query,query.first);i<query.end;i=urban_leaf(query,i+1u)){
  let b=urban_index.sources[urban_index.nodes[i].source];if b.colour.w>=0.0{continue;}let q=urban_local(b,hi,lo);
  if any(q<b.bounds.xy-vec2<f32>(aa))||any(q>b.bounds.zw+vec2<f32>(aa)){continue;}
  let a=urban_index.points[b.data.x].p;let z=urban_index.points[b.data.x+1u].p;let d=z-a;let len=length(d);let along=dot(q-a,d)/max(.01,len);let across=urban_segment(q,a,z);let width=b.east.w;
  let signed=across-width*.5;
  let arrival=smoothstep(0.0,45.0,f32(f.cloud_cache.x-b.data.w));
  coverage=max(coverage,(1.0-smoothstep(-aa,aa,signed))*arrival);
  // Outline the union once. Per-span outlines painted their round end caps
  // through the interior of every adjoining span and junction.
  if signed<boundary{
   boundary=signed;colour=b.colour.rgb;marked=b.colour.w> -1.5&&width>5.0;
   longitudinal=along>=0.0&&along<=len;nearest=i;cap=select(z,a,along<0.0)-q;
   let dash=1.0-smoothstep(2.5-aa,2.5+aa,(max(0.0,along)+b.north.w)%6.0);
   center=(1.0-smoothstep(.06-aa,.06+aa,across))*dash;
  }
 }
 if coverage<=0.0{return vec4<f32>(0);}
 // Past the end of its nearest span the point lies in the round cap. At a dead end that cap gets no edge line; where
 // another span of the network starts at the same point it is the outside of a bend (or a joint), and the edge line
 // goes round it, unbroken. The end is compared as the vector
 // from the point in each span's own local frame, which agree to far under a centimetre over a cell.
 if marked&&!longitudinal{
  for(var j=urban_leaf(query,query.first);j<query.end;j=urban_leaf(query,j+1u)){
   if j==nearest{continue;}let o=urban_index.sources[urban_index.nodes[j].source];if o.colour.w>=0.0{continue;}let r=urban_local(o,hi,lo);
   let oa=urban_index.points[o.data.x].p-r;let oz=urban_index.points[o.data.x+1u].p-r;
   if min(length(oa-cap),length(oz-cap))<0.05{longitudinal=true;break;}
  }
 }
 let kerb=smoothstep(-.32-aa,-.32+aa,boundary);colour=mix(colour,vec3<f32>(.3,.31,.30),kerb);
 if marked&&longitudinal{
  let edge=1.0-smoothstep(.055-aa,.055+aa,abs(boundary+.55));
  colour=mix(colour,vec3<f32>(.68,.69,.65),max(edge,center)*clamp(.3/max(aa,.01),0.0,1.0));
 }
 return vec4<f32>(colour,coverage);
}
fn urban_inside(q:vec2<f32>,b:BuildingSource)->bool{var inside=false;for(var i=0u;i<b.data.y;i++){let a=urban_index.points[b.data.x+i];let z=urban_index.points[a.next].p;if (a.p.y>q.y)!=(z.y>q.y){if q.x<(z.x-a.p.x)*(q.y-a.p.y)/(z.y-a.p.y)+a.p.x{inside=!inside;}}}return inside;}
fn building_origin(b:BuildingSource)->vec3<f32>{return (b.hi.xyz-f.eye_hi.xyz)+(b.lo.xyz-f.eye_lo.xyz)-f.eye_tail.xyz;}
fn building_up(b:BuildingSource)->vec3<f32>{return normalize(b.hi.xyz+b.lo.xyz);}
fn building_roof(b:BuildingSource,q:vec2<f32>)->f32{
 if b.colour.w<1.5{return 0.0;}
 let uv=clamp((q-b.bounds.xy)/max(b.bounds.zw-b.bounds.xy,vec2<f32>(.1)),vec2<f32>(0),vec2<f32>(1));
 let tent=1.0-abs(uv*2.0-1.0);var shape=select(tent.x,tent.y,b.bounds.z-b.bounds.x>b.bounds.w-b.bounds.y);
 if b.colour.w>2.5{shape=min(tent.x,tent.y);}if b.colour.w>3.5{shape=sqrt(max(0.0,1.0-dot(uv*2.0-1.0,uv*2.0-1.0)));}
 return b.north.w*(shape-1.0);
}
@compute @workgroup_size(1) fn building_begin(){for(var i=0u;i<8u;i++){atomicStore(&building_state[i],0u);}atomicStore(&building_state[1],1u);}
// Only on a source publication. Read a snapshot so swaps and compaction
// cannot overwrite a neighbour's history before it has been read.
@compute @workgroup_size(64) fn building_remap(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if i>=building_control.x{return;}
 let b=building_sources[i];if b.colour.w<0.0{return;}
 var prior=vec4<f32>(0);if b.data.w!=0u{prior=building_support[b.data.w-1u];}
 building_support_write[i]=prior;
}
@compute @workgroup_size(64) fn building_generate(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if i>=building_control.x||f.scenery_work.w<.5{return;}let b=building_sources[i];let origin=building_origin(b);let up=building_up(b);
 if b.colour.w<0.0{return;}
 if !field_measured(){return;}
 let extent=b.bounds.zw-b.bounds.xy;let metres=max(max(extent.x,extent.y),b.hi.w-b.lo.w);
 let previous=building_support_write[i].z;
 let ground=surface_height_only(origin,2.0);
 let pixels=sc_projected_pixels(metres,length(origin+up*(ground+0.5*(b.lo.w+b.hi.w))));
 let visible=sc_fade_toward(previous,select(0.0,1.0,sc_admitted(sc_pixel_weight(pixels),b.data.z)),0.5);
 if visible<=0.0{building_support_write[i]=vec4<f32>(0);return;}
 // Eight footprint supports bound the work, not the terrain interval. A common
 // foundation avoids twisted floors; an unseen hill can still intersect a large footprint.
 var low=ground;var high=low;
 for(var j=0u;j<8u;j++){let k=b.data.x+min(b.data.y-1u,j*b.data.y/8u);let q=building_points[k].p;let h=surface_height_only(origin+b.east.xyz*q.x+b.north.xyz*q.y,2.0);low=min(low,h);high=max(high,h);}
 building_support_write[i]=vec4<f32>(low-1.5,high,visible,0);
 var count=(b.data.y+1u)*6u;if b.colour.w>1.5{count=(b.data.y*2u+4u)*6u;}
 if b.colour.w<0.0{count=u32(clamp(ceil(distance(building_points[b.data.x].p,building_points[b.data.x+1u].p)/6.0),1.0,32.0))*6u;}
 let offset=atomicAdd(&building_state[0],count);
 // Source budgets prove this stream fits: (2 * 131072 + 4 * 16384 + 2048 * 32) * 6 vertices.
 for(var j=0u;j<count;j++){building_refs_write[offset+j]=vec2<u32>(i,j);}atomicAdd(&building_state[4],1u);
}
struct BuildingVertex {@builtin(position) clip:vec4<f32>,@location(0) p:vec3<f32>,@location(1) n:vec3<f32>,@location(2) uv:vec2<f32>,@location(3) local:vec2<f32>,@location(4) @interpolate(flat) key:vec3<u32>,@location(5) @interpolate(flat) wall_length:f32}
fn building_vertex(v:u32)->BuildingVertex {
 let item=building_refs[v];let b=building_sources[item.x];let s=building_support[item.x];let up=building_up(b);let corners=array<vec2<f32>,6>(vec2<f32>(0,0),vec2<f32>(1,0),vec2<f32>(1,1),vec2<f32>(0,0),vec2<f32>(1,1),vec2<f32>(0,1));var c=corners[item.y%6u];var edge=item.y/6u;
 if b.colour.w<0.0{
  let a=building_points[b.data.x].p;let z=building_points[b.data.x+1u].p;let d=z-a;let len=length(d);let segments=clamp(ceil(len/6.0),1.0,32.0);let along=(f32(edge)+c.y)/segments;
  let q=mix(a,z,along)+vec2<f32>(-d.y,d.x)/max(.01,len)*(c.x-.5)*b.east.w;
  let base=building_origin(b)+b.east.xyz*q.x+b.north.xyz*q.y;let h=surface_height_only(base,1.0)+.075;
  let p=base+up*(h-dot(q,q)/(2.0*f.planet.x));
  return BuildingVertex(sc_project(p),p,up,vec2<f32>((c.x-.5)*b.east.w,along*len),q,vec3<u32>(item.x,3u,b.data.z),b.east.w);
 }
 if b.colour.w>1.5{
  if edge<b.data.y*2u{c.x=(f32(edge%2u)+c.x)*.5;edge/=2u;}
  else{let roof=edge-b.data.y*2u;c=(vec2<f32>(f32(roof%2u),f32(roof/2u))+c)*.5;edge=b.data.y;}
 }
 var q=mix(b.bounds.xy,b.bounds.zw,c);var h=s.y+b.hi.w;var n=up;var uv=q;var kind=1u;
 if edge<b.data.y{let a=building_points[b.data.x+edge];let z=building_points[a.next];q=mix(a.p,z.p,c.x);h=mix(select(s.x,s.y+b.lo.w,b.lo.w>0.0),s.y+b.hi.w,c.y);let tangent=b.east.xyz*(z.p.x-a.p.x)+b.north.xyz*(z.p.y-a.p.y);n=normalize(cross(tangent,up));uv=vec2<f32>(length(z.p-a.p)*c.x,h-s.y);kind=select(select(0u,4u,(a.boundary&2u)!=0u),2u,(a.boundary&1u)!=0u);}
 h+=building_roof(b,q)*select(1.0,c.y,edge<b.data.y);
 let p=building_origin(b)+b.east.xyz*q.x+b.north.xyz*q.y+up*(h-dot(q,q)/(2.0*f.planet.x));
 var wall_length=0.0;if edge<b.data.y{let a=building_points[b.data.x+edge];wall_length=length(building_points[a.next].p-a.p);}
 return BuildingVertex(sc_project(p),p,n,uv,q,vec3<u32>(item.x,kind,b.data.z),wall_length);
}
@vertex fn building_mesh(@builtin(vertex_index) v:u32)->BuildingVertex{return building_vertex(v);}
@vertex fn building_shadow(@builtin(vertex_index) v:u32)->BuildingVertex{var out=building_vertex(v);out.clip=sun_clip(out.p);return out;}
fn building_inside(q:vec2<f32>,b:BuildingSource)->bool{var inside=false;for(var i=0u;i<b.data.y;i++){let a=building_points[b.data.x+i];let z=building_points[a.next].p;if (a.p.y>q.y)!=(z.y>q.y){if q.x<(z.x-a.p.x)*(q.y-a.p.y)/(z.y-a.p.y)+a.p.x{inside=!inside;}}}return inside;}
fn building_coverage(v:BuildingVertex)->bool{if v.key.y==2u{return false;}if v.key.y==1u&&!building_inside(v.local,building_sources[v.key.x]){return false;}return sc_dither(v.clip.xy,v.key.z)<building_support[v.key.x].z;}
@fragment fn building_fragment(v:BuildingVertex,@builtin(front_facing) front:bool)->ScGbuffer{
 let b=building_sources[v.key.x];let height=max(.1,b.hi.w-b.lo.w);
 // Whole bays and storeys fit between the wall corners and roof. Absolute
 // metre repeats chopped windows at every arbitrary source height/edge.
 let bays=max(1.0,floor(max(0.0,v.wall_length-.8)/3.2));let floors=max(1.0,floor(height/3.1));
 let grid=vec2<f32>(v.uv.x/max(.1,v.wall_length)*bays,(v.uv.y-b.lo.w)/height*floors);
 let fw=max(fwidth(grid),vec2<f32>(.002));
 let uv_width=fwidth(v.uv);let local_width=fwidth(v.local);let geometric_normal=normalize(cross(dpdx(v.p),dpdy(v.p)));
 if !building_coverage(v){discard;}var colour=b.colour.rgb;var rough=.85;
 if v.key.y==3u{
  let width=b.east.w;let footprint=max(uv_width.x,.008);let x=abs(v.uv.x);
  let kerb=smoothstep(width*.5-.35-footprint,width*.5-.35+footprint,x);colour=mix(colour,vec3<f32>(.3,.31,.30),kerb);
  let grit=(sin(v.local.x*87.3+v.local.y*127.1)*sin(v.local.y*73.9))*.035/(1.0+footprint*35.0);colour*=1.0+grit;
  if b.colour.w> -1.5&&width>5.0{
   let edge_line=1.0-smoothstep(.055-footprint,.055+footprint,abs(x-(width*.5-.55)));
   let dash=1.0-smoothstep(2.5,2.5+max(.02,uv_width.y),v.uv.y%6.0);
   let middle=(1.0-smoothstep(.06-footprint,.06+footprint,x))*dash;
   colour=mix(colour,vec3<f32>(.68,.69,.65),max(edge_line,middle));
  }
 }else if v.key.y==0u||v.key.y==4u{
  let cell=fract(grid);let pane=smoothstep(.20-fw.x,.20+fw.x,cell.x)*(1.0-smoothstep(.80-fw.x,.80+fw.x,cell.x))*smoothstep(.26-fw.y,.26+fw.y,cell.y)*(1.0-smoothstep(.75-fw.y,.75+fw.y,cell.y));
  let entrance=v.key.y==4u&&grid.y>=0.0&&grid.y<1.0&&floor(grid.x)==floor(bays*.5);
  let glazed=select(0.0,1.0,!entrance&&grid.y>=0.0&&grid.y<floors&&v.wall_length>1.8&&height>1.8);
  let window=pane*glazed;
  let frame=smoothstep(.17-fw.x,.17+fw.x,cell.x)*(1.0-smoothstep(.83-fw.x,.83+fw.x,cell.x))*smoothstep(.23-fw.y,.23+fw.y,cell.y)*(1.0-smoothstep(.78-fw.y,.78+fw.y,cell.y))*glazed;
  colour=mix(colour,colour*.65,frame);let tint=.8+.4*sc_random(v.key.z+u32(max(0.0,floor(grid.x)))+31u*u32(max(0.0,floor(grid.y))));colour=mix(colour,vec3<f32>(.035,.065,.085)*tint,window);rough=mix(.85,.32,window);
  let trim=max(1.0-smoothstep(.18,.28,b.hi.w-v.uv.y),1.0-smoothstep(.25,.45,v.uv.y-b.lo.w));colour=mix(colour,b.colour.rgb*.75,trim);
  let storey=1.0-smoothstep(.015,.045,abs(fract(grid.y)-.04));colour=mix(colour,b.colour.rgb*.62,storey*(1.0-window));
  let masonry=vec2<f32>(v.uv.x/.38+floor(v.uv.y/.16)*.5,v.uv.y/.16);let joint=min(fract(masonry.x),fract(masonry.y));
  if b.east.w==1.0{colour=mix(vec3<f32>(.30,.105,.055)*(0.8+0.2*sin(floor(masonry.x)*12.7)),colour,window);colour=mix(vec3<f32>(.24,.22,.19),colour,max(smoothstep(.025,.10,joint),window));}
  if b.east.w==2.0&&!entrance{let mullion=max(1.0-smoothstep(.025,.055,abs(cell.x-.5)),1.0-smoothstep(.02,.05,cell.y));colour=mix(vec3<f32>(.065,.13,.16)*(0.65+.35*abs(v.n.y)+.2*sin(floor(grid.x)*7.1)),vec3<f32>(.28,.32,.34),mullion);rough=.23;}
  // Recessed glass, sills and cornices retain readable facade depth in light.
  colour*=1.0-.18*frame*(1.0-pane);
  if entrance{
   let dx=abs(cell.x-.5)*v.wall_length/bays;let dy=v.uv.y-b.lo.w;
   let aa=max(uv_width,vec2<f32>(.01));let door_h=min(2.12,height/floors*.88);
   let surround=(1.0-smoothstep(.62-aa.x,.62+aa.x,dx))*(1.0-smoothstep(door_h+.09-aa.y,door_h+.09+aa.y,dy));
   let door=(1.0-smoothstep(.52-aa.x,.52+aa.x,dx))*(1.0-smoothstep(door_h-aa.y,door_h+aa.y,dy));
   colour=mix(colour,b.colour.rgb*.60,surround);colour=mix(colour,vec3<f32>(.065,.079,.082),door);rough=mix(rough,.58,door);
  }
 }else{colour=mix(b.colour.rgb*.58,vec3<f32>(.28,.085,.04),select(0.0,1.0,b.colour.w>1.5));let tile=abs(sin(v.local.x*16.0)*sin(v.local.y*11.0));colour*=.85+.15*tile/(1.0+length(local_width)*12.0);}
 var normal=select(-v.n,v.n,front);if v.key.y==1u&&b.colour.w>1.5{normal=geometric_normal;if dot(normal,building_up(b))<0.0{normal=-normal;}}
 return ScGbuffer(vec4<f32>(v.p,sc_radial_height(v.p)),vec4<f32>(normal,-104),vec4<f32>(colour,rough),.1/max(.1,dot(v.p,f.forward.xyz)));
}
@fragment fn building_shadow_fragment(v:BuildingVertex){if v.key.y==3u||!building_coverage(v){discard;}}
