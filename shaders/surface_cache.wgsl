// Bounded derived-surface experiment. A surface proposal is NOT a certificate.
// Empty cells use analytic ball intervals; all surviving surface cells are
// refined to one common depth so their Freudenthal tetrahedral faces conform.
// Ambiguous leaves and queue/triangle overflow are counted, never called sky.
struct MeshParams {origin_extent:vec4<f32>,limits:vec4<u32>}
@group(1) @binding(0) var<storage,read> mesh_in:array<vec4<u32>>;
@group(1) @binding(1) var<storage,read_write> mesh_out:array<vec4<u32>>;
@group(1) @binding(2) var<storage,read_write> mesh_vertices:array<vec4<f32>>;
@group(1) @binding(3) var<storage,read_write> mesh_counts:array<atomic<u32>>;
@group(1) @binding(4) var<uniform> mesh_params:MeshParams;
@group(1) @binding(5) var mesh_distance:texture_2d<f32>;
fn mesh_emit(a:vec3<f32>,b:vec3<f32>,c:vec3<f32>){
 let offset=atomicAdd(&mesh_counts[3],3u);
 if offset+3u>mesh_params.limits.w{atomicAdd(&mesh_counts[7],1u);return;}
 mesh_vertices[offset]=vec4<f32>(a,1);mesh_vertices[offset+1u]=vec4<f32>(b,1);mesh_vertices[offset+2u]=vec4<f32>(c,1);
}
fn mesh_crossing(a:vec4<f32>,b:vec4<f32>)->vec3<f32>{
 // Eight bisections improve edge positions; multiple roots on an edge and
 // interior topology are still uncertified and require canonical validation.
 var left=a;var right=b;
 for(var i=0u;i<8u;i++){let q=(left.xyz+right.xyz)*0.5;let value=planet_value(q);if (value<0.0)==(left.w<0.0){left=vec4<f32>(q,value);}else{right=vec4<f32>(q,value);}}
 let f=clamp(left.w/(left.w-right.w),0.0,1.0);return mix(left.xyz,right.xyz,f);
}
fn mesh_tetra(a:vec4<f32>,b:vec4<f32>,c:vec4<f32>,d:vec4<f32>){
 let input=array<vec4<f32>,4>(a,b,c,d);var inside:array<vec4<f32>,4>;var outside:array<vec4<f32>,4>;var ni=0u;var no=0u;
 for(var i=0u;i<4u;i++){if input[i].w<0.0{inside[ni]=input[i];ni++;}else{outside[no]=input[i];no++;}}
 if ni==0u||ni==4u{return;}
 if ni==1u{mesh_emit(mesh_crossing(inside[0],outside[0]),mesh_crossing(inside[0],outside[1]),mesh_crossing(inside[0],outside[2]));return;}
 if ni==3u{mesh_emit(mesh_crossing(outside[0],inside[0]),mesh_crossing(outside[0],inside[1]),mesh_crossing(outside[0],inside[2]));return;}
 let p=mesh_crossing(inside[0],outside[0]);let q=mesh_crossing(inside[0],outside[1]);let r=mesh_crossing(inside[1],outside[0]);let s=mesh_crossing(inside[1],outside[1]);
 mesh_emit(p,q,r);mesh_emit(q,s,r);
}
@compute @workgroup_size(64)
fn mesh_refine(@builtin(global_invocation_id) id:vec3<u32>){
 let level=mesh_params.limits.x;let count=min(atomicLoad(&mesh_counts[8u+level]),mesh_params.limits.z);
 if id.x>=count{return;}let key=mesh_in[id.x].xyz;let side=mesh_params.origin_extent.w*exp2(-f32(level));
 let minimum=mesh_params.origin_extent.xyz+vec3<f32>(key)*side;let center=minimum+side*0.5;
 let bound=planet_ball(center,sqrt(3.0)*side*0.5+0.0002+length(center)*1e-6);
 if bound.x>0.0||bound.y<0.0{atomicAdd(&mesh_counts[0],1u);return;}
 if level<mesh_params.limits.y{
  let offset=atomicAdd(&mesh_counts[9u+level],8u);
  for(var i=0u;i<8u;i++){if offset+i>=mesh_params.limits.z{atomicAdd(&mesh_counts[2],1u);continue;}mesh_out[offset+i]=vec4<u32>(key*2u+vec3<u32>(i&1u,(i>>1u)&1u,i>>2u),0);}
  return;
 }
 atomicAdd(&mesh_counts[1],1u);var corner:array<vec4<f32>,8>;var negatives=0u;
 for(var i=0u;i<8u;i++){
  // Integer corner coordinates ensure adjacent retained leaves agree exactly.
  let q=mesh_params.origin_extent.xyz+vec3<f32>(key+vec3<u32>(i&1u,(i>>1u)&1u,i>>2u))*side;
  let value=planet_value(q);corner[i]=vec4<f32>(q,value);if value<0.0{negatives++;}
 }
 if negatives==0u||negatives==8u{atomicAdd(&mesh_counts[40],1u);return;}
 mesh_tetra(corner[0],corner[1],corner[3],corner[7]);mesh_tetra(corner[0],corner[3],corner[2],corner[7]);
 mesh_tetra(corner[0],corner[2],corner[6],corner[7]);mesh_tetra(corner[0],corner[6],corner[4],corner[7]);
 mesh_tetra(corner[0],corner[4],corner[5],corner[7]);mesh_tetra(corner[0],corner[5],corner[1],corner[7]);
}
@compute @workgroup_size(1)
fn mesh_finish(){atomicStore(&mesh_counts[3],min(atomicLoad(&mesh_counts[3]),mesh_params.limits.w));}
struct MeshVarying {@builtin(position) clip:vec4<f32>,@location(0) point:vec3<f32>}
@vertex
fn mesh_vertex(@location(0) position:vec4<f32>)->MeshVarying{
 let q=position.xyz;let z=dot(q,frame.forward.xyz);
 return MeshVarying(vec4<f32>(dot(q,frame.right.xyz)/(frame.right.w*frame.up.w),dot(q,frame.up.xyz)/frame.right.w,0.0001,z),q);
}
@fragment
fn mesh_fragment(input:MeshVarying)->@location(0) f32{return length(input.point);}
fn mesh_trace(d:vec3<f32>,near:f32,far:f32,proposal:f32)->RayResult{
 let budget=frame.size.z;
 if proposal<=near||proposal>=far{return scene_trace(vec3<f32>(0),d,near,far,budget);}
 let padding=mesh_params.origin_extent.w*exp2(-f32(mesh_params.limits.y))*sqrt(3.0);
 let split=min(far,proposal+padding);
 var first=scene_trace(vec3<f32>(0),d,near,split,budget);
 // A proposed surface never authorizes skipping a prefix. The SAME canonical
 // ordered traversal must certify it, with the same total query budget.
 if first.span.z!=0.0||split>=far{return first;}
 if first.counts.x>=budget{return RayResult(vec4<f32>(split,far,2,0),vec4<u32>(first.counts.xyz,1));}
 var rest=scene_trace(vec3<f32>(0),d,split,far,budget-first.counts.x);
 rest.counts=vec4<u32>(rest.counts.xy+first.counts.xy,max(rest.counts.z,first.counts.z),rest.counts.w);return rest;
}
@compute @workgroup_size(8,8)
fn mesh_guided_visibility(@builtin(global_invocation_id) id:vec3<u32>){
 if any(id.xy>=frame.size.xy){return;}let index=id.y*frame.size.x+id.x;let d=view_direction(id.xy);var near=0.0;var far=frame.quality.z;
 let shell=sphere_segment(d,frame.base.z+250.0);near=max(0.0,shell.x);far=min(far,shell.y);
 let inner=sphere_segment(d,-frame.base.z-250.0);if inner.x>near{far=min(far,inner.x);}
 let water=water_distance(d);if water>0.0{far=min(far,water);}
 if far<=near{hits[index]=RayResult(vec4<f32>(far,far,0,0),vec4<u32>(0));atomicAdd(&stats[1],1u);return;}
 let result=mesh_trace(d,near,far,textureLoad(mesh_distance,vec2<i32>(id.xy),0).x);hits[index]=result;
 let status=u32(result.span.z);if status>=2u{atomicAdd(&stats[select(15u,14u,result.counts.w==1u)],1u);}
 atomicAdd(&stats[select(2u,select(1u,0u,status==1u),status<2u)],1u);count64(3u,10u,result.counts.x);count64(4u,11u,result.counts.y);atomicMax(&stats[5],result.counts.z);
}
