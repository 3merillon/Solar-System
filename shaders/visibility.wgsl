struct Query {origin:vec4<f32>,direction:vec4<f32>,controls:vec4<u32>,parameters:vec4<f32>}
@group(0) @binding(0) var<storage,read> queries:array<Query>;
@group(0) @binding(1) var<storage,read_write> results:array<RayResult>;
@compute @workgroup_size(64)
fn visibility(@builtin(global_invocation_id) id:vec3<u32>) {
 if id.x>=arrayLength(&queries){return;}let q=queries[id.x];
 let m=Model(q.controls.x,2026u,q.controls.y,q.controls.z,q.parameters.x,q.parameters.y);
 results[id.x]=trace_field(q.origin.xyz,q.direction.xyz,q.origin.w,q.direction.w,q.parameters.z,q.controls.w,m);
}
