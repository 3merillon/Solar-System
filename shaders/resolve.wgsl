// Linear HDR input. Exposure, display transform and encoding occur exactly once.
struct ResolveParams {size:vec4<u32>, control:vec4<f32>}
@group(0) @binding(0) var<uniform> params:ResolveParams;
@group(0) @binding(1) var radiance:texture_2d<f32>;
@group(0) @binding(2) var display:texture_storage_2d<rgba8unorm,write>;
fn load_radiance(p:vec2<i32>)->vec4<f32>{return textureLoad(radiance,clamp(p,vec2<i32>(0),vec2<i32>(params.size.xy)-1),0);}
fn display_encode(c:vec3<f32>)->vec3<f32>{
 let x=max(c,vec3<f32>(0))*params.control.x;
 let mapped=clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),vec3<f32>(0),vec3<f32>(1));
 return pow(mapped,vec3<f32>(1.0/2.2));
}
@compute @workgroup_size(8,8)
fn resolve(@builtin(global_invocation_id) id:vec3<u32>){
 if any(id.xy>=params.size.zw){return;}
 let src=(vec2<f32>(id.xy)+0.5)*vec2<f32>(params.size.xy)/vec2<f32>(params.size.zw)-0.5;
 let base=vec2<i32>(floor(src));let f=fract(src);
 // Bilinear in linear radiance, before the display transform. Raw diagnostics
 // retain nearest sampling so unresolved classifications cannot be blurred away.
 var c=mix(mix(load_radiance(base),load_radiance(base+vec2<i32>(1,0)),f.x),mix(load_radiance(base+vec2<i32>(0,1)),load_radiance(base+vec2<i32>(1,1)),f.x),f.y).rgb;
 if params.control.y>0.5 {c=load_radiance(vec2<i32>(round(src))).rgb;}else{c=display_encode(c);}
 textureStore(display,vec2<i32>(id.xy),vec4<f32>(c,1));
}
