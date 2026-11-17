@group(0) @binding(0) var source:texture_2d<f32>;
@group(0) @binding(1) var present_sampler:sampler;
struct Vertex { @builtin(position) position:vec4<f32>,@location(0) uv:vec2<f32> }
@vertex fn vertex(@builtin(vertex_index) i:u32)->Vertex {
 let x=f32((i<<1u)&2u);let y=f32(i&2u);return Vertex(vec4<f32>(x*2.0-1.0,1.0-y*2.0,0,1),vec2<f32>(x,y));
}
@fragment fn fragment(v:Vertex)->@location(0) vec4<f32>{
 // Bilinear resolve: an identical internal and display size samples exact
 // texel centres; a reduced render scale upsamples smoothly.
 return textureSampleLevel(source,present_sampler,v.uv,0.0);
}
