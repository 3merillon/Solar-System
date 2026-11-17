// One canonical, footprint-filtered height/normal/material query for terrain
// shading, distant surface coverage, and the refracted bed continuation.
struct SurfaceDetail {height:f32,normal:vec3<f32>,grain:f32,base:vec3<f32>}
fn surface_detail_sample(point:vec3<f32>,footprint:f32)->SurfaceDetail {
 let address=surface_address(point);let base=(address.hi-f.eye_hi.xyz)+address.lo;let radial=normalize(address.hi+address.lo);
 let field=field_detail(address.hi,address.lo,footprint);let height=field.height;let gradient=field.gradient;
 let normal=normalize(radial-(gradient-radial*dot(gradient,radial))*f.planet.x/(f.planet.x+height));
 return SurfaceDetail(height,normal,field.grain,base);
}
fn surface_edits(address:SurfaceAddress)->f32{return field_edits(address.hi,address.lo);}
fn surface_height_only(point:vec3<f32>,footprint:f32)->f32 {
 let address=surface_address(point);return field_value(address.hi,address.lo,footprint);
}
// Experimental micro-displacement on the existing raster coverage proxy.
// No extra triangles, allocations or history. Mesh visibility still owns the
// limb and grazing rays. Near props keep their published-triangle support.
fn surface_detail_weight(p:vec3<f32>)->f32{
 if f.cloud_drift.w<0.5||f.eye_hi.w<=f.planet.y{return 0.0;}
 let distance=length(p);let radial=normalize(f.eye_hi.xyz+f.eye_lo.xyz+p);
 let cosine=abs(dot(radial,normalize(p)));let pixel=distance*2.0*f.view.w/f.view.y;
 return smoothstep(8000.0,16000.0,distance)*smoothstep(8.0,24.0,pixel)*smoothstep(0.01,0.04,cosine);
}
fn surface_detail_footprint(p:vec3<f32>)->f32{
 let radial=normalize(f.eye_hi.xyz+f.eye_lo.xyz+p);
 return max(0.008,length(p)*2.0*f.view.w/f.view.y/max(0.15,abs(dot(radial,normalize(p)))));
}
struct SurfaceCoast {sea_distance:f32,height:f32,weight:f32}
fn surface_coast(p:vec3<f32>)->SurfaceCoast{
 let rd=normalize(p);let t=sea_distance(rd);if t>=1e10{return SurfaceCoast(0,0,0);}
 let point=rd*t;let weight=surface_detail_weight(point);if weight<=0.0{return SurfaceCoast(t,0,0);}
 let detail=surface_detail_sample(point,surface_detail_footprint(point));
 // A common radial-height layer on BOTH passes keeps land/water on the same
 // height model at full weight. This is a coverage proxy near sea level; relief
 // parallax, grazing visibility, shadows and silhouettes remain mesh-owned.
 let coastal=1.0-smoothstep(300.0,600.0,abs(detail.height-f.planet.y));
 return SurfaceCoast(t,detail.height,weight*coastal);
}
fn surface_coast_hit(proxy:vec4<f32>)->vec4<f32>{
 if surface_detail_weight(proxy.xyz)<=0.0{return proxy;}
 // Only a fragment already near sea level can be a coastline. A tall foreground slope whose ray
 // would later reach a coast must stay where it is, or far water shows through the mountain.
 // Measured body only: the procedural body stays the exact regression reference.
 var own=1.0;if field_measured(){own=1.0-smoothstep(300.0,600.0,abs(proxy.w-f.planet.y));if own<=0.0{return proxy;}}
 let coast=surface_coast(proxy.xyz);if coast.weight<=0.0{return proxy;}
 let rd=normalize(proxy.xyz);let t=sphere(rd,coast.height).x;
 if t<=0.1{return proxy;}
 return mix(proxy,vec4<f32>(rd*t,coast.height),coast.weight*own);
}
// Continue the same filtered surface inside the distant coverage range. The
// published mesh supplies visibility and a local root seed, not a second height
// spectrum. Five bounded samples refine interior depth; no first-hit claim is
// made for silhouettes, grazing rays or roots outside this local trust region.
fn surface_relief_weight(p:vec3<f32>)->f32{
 if f.cloud_drift.w<0.5{return 0.0;}
 let radial=normalize(f.eye_hi.xyz+f.eye_lo.xyz+p);
 return (1.0-smoothstep(30000.0,60000.0,length(p)))*smoothstep(0.10,0.25,-dot(radial,normalize(p)));
}
fn surface_detail_hit(proxy:vec4<f32>,spacing:f32)->vec4<f32>{
 let source=surface_coast_hit(proxy);let weight=surface_relief_weight(source.xyz);if weight<=0.0{return source;}
 let rd=normalize(source.xyz);let start=length(source.xyz);let footprint=surface_detail_footprint(source.xyz);
 let trust=clamp(spacing*4.0,1.0,512.0);var t=start;var best=source;var error=1e20;var facing=0.0;
 let steps=u32(f.quality.w);if steps==0u{return source;}
 for(var i=0u;i<steps;i++){
  let p=rd*t;let detail=surface_detail_sample(p,footprint);let radial=normalize(f.eye_hi.xyz+f.eye_lo.xyz+p);
  let height=sc_radial_height(p);let residual=height-detail.height;let cosine=-dot(detail.normal,rd);
  if abs(residual)<error{error=abs(residual);best=vec4<f32>(p,height);facing=cosine;}
  if abs(residual)<max(0.002,footprint*0.01)||cosine<=0.04{break;}
  let step=residual*dot(detail.normal,radial)/max(0.04,cosine);
  t=clamp(t+step,max(0.1,start-trust),start+trust);
 }
 let tolerance=max(0.02,footprint*0.15);
 let confidence=(1.0-smoothstep(tolerance,tolerance*4.0,error))*smoothstep(0.04,0.12,facing);
 return mix(source,best,weight*confidence);
}
