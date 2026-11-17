// Analytic derivative candidate. This changes shading only, never visibility.
// Noise second moments assume independent uniformly distributed lattice values.
// The slope-variance model is an image approximation, not a topology certificate.
struct Differential {value:f32,gradient:vec3<f32>}
fn cubic_differential(c:vec3<i32>,f:vec3<f32>,seed:u32)->Differential {
 let t=f*f*(3.0-2.0*f);let dt=6.0*f*(1.0-f);
 let a=vec4<f32>(lattice(c,seed),lattice(c+vec3<i32>(1,0,0),seed),lattice(c+vec3<i32>(0,1,0),seed),lattice(c+vec3<i32>(1,1,0),seed));
 let b=vec4<f32>(lattice(c+vec3<i32>(0,0,1),seed),lattice(c+vec3<i32>(1,0,1),seed),lattice(c+vec3<i32>(0,1,1),seed),lattice(c+vec3<i32>(1,1,1),seed));
 let value=mix(mix(mix(a.x,a.y,t.x),mix(a.z,a.w,t.x),t.y),mix(mix(b.x,b.y,t.x),mix(b.z,b.w,t.x),t.y),t.z);
 let grad=dt*vec3<f32>(mix(mix(a.y-a.x,a.w-a.z,t.y),mix(b.y-b.x,b.w-b.z,t.y),t.z),mix(mix(a.z-a.x,a.w-a.y,t.x),mix(b.z-b.x,b.w-b.y,t.x),t.z),mix(mix(b.x-a.x,b.y-a.y,t.x),mix(b.z-a.z,b.w-a.w,t.x),t.y));
 return Differential(value,grad);
}
fn local_differential(p:vec3<f32>,seed:u32)->Differential{return cubic_differential(vec3<i32>(floor(p)),fract(p),seed);}
fn frequency_weight(width:f32,scale:f32)->f32{return 1.0-smoothstep(0.125,0.5,width/scale);}
struct NormalField {value:f32,gradient:vec3<f32>,variance:f32,margin:f32}
fn choose_normal(a:NormalField,b:NormalField,take_min:bool)->NormalField {
 var chosen=b;if (a.value<b.value)==take_min {chosen=a;}
 chosen.margin=min(chosen.margin,abs(a.value-b.value));return chosen;
}
fn normal_field(q:vec3<f32>,width:f32)->NormalField {
 var base=NormalField(frame.base.x+radial_change(q)-erosion_delta(q),normalize(frame.radial.xyz*frame.camera_lo.w+q),0.0,1e20);
 // Base values retain the factored, compensated canonical evaluator. Derivatives
 // use the exact cubic polynomial at the same integer lattice/phase.
 for(var k=0u;k<24u;k++){
  let proxy=read_proxy(k);let next=proxy.phase.xyz+q*proxy.phase.w;
  let s=cubic_differential(proxy.cell.xyz+vec3<i32>(floor(next)),fract(next),frame.options.w+k);
  let weight=frequency_weight(width,1.0/proxy.phase.w);let amplitude=proxy.config.x;
  let polarity=select(1.0,-sign(s.value),proxy.cell.w==1);
  base.value-=amplitude*proxy_delta(q,k);base.gradient-=amplitude*proxy.phase.w*s.gradient*polarity*weight;
  base.variance+=0.8829387755*pow(amplitude*proxy.phase.w,2.0)*(1.0-weight*weight);
  if proxy.cell.w==1{base.margin=min(base.margin,abs(s.value)*amplitude);}
 }
 let p=q-frame.anchor.xyz;let uv=p.xz/frame.extra.x+0.5;let n=frame.registry.y;
 if n>=2u&&all(uv>=vec2<f32>(0))&&all(uv<vec2<f32>(1)){
  let xy=uv*f32(n-1u);let c=vec2<u32>(floor(xy));let f=fract(xy);let i=c.y*n+c.x;
  let gx=mix(erosion[i+1u]-erosion[i],erosion[i+n+1u]-erosion[i+n],f.y);
  let gz=mix(erosion[i+n]-erosion[i],erosion[i+n+1u]-erosion[i+1u],f.x);
  base.gradient-=vec3<f32>(gx,0,gz)*frame.geology.z*f32(n-1u)/frame.extra.x;
  base.margin=min(base.margin,min(min(f.x,1.0-f.x),min(f.y,1.0-f.y))*frame.extra.x/f32(n-1u));
 }
 if any(abs(p)>vec3<f32>(360,110,460)){return base;}
 var rough=0.0;var rough_gradient=vec3<f32>(0);var variance=0.0;
 let scales=array<f32,4>(32,4,0.5,0.0625);let amplitudes=array<f32,4>(7,0.8,0.1,0.0125);
 for(var k=0u;k<4u;k++){
  let s=local_differential(p/scales[k],frame.options.w+701u+k);let weight=frequency_weight(width,scales[k]);
  rough+=s.value*amplitudes[k];rough_gradient+=s.gradient*(amplitudes[k]/scales[k])*weight;
  variance+=0.8829387755*pow(amplitudes[k]/scales[k],2.0)*(1.0-weight*weight);
 }
 let m=(p-vec3<f32>(0,0,-90))/vec3<f32>(210,70,230);
 let mesa=NormalField((length(m)-1.0)*70.0+rough,normalize(m)/vec3<f32>(210,70,230)*70.0+rough_gradient,variance,1e20);
 let b=(p-vec3<f32>(0,10,270))/vec3<f32>(310,80,175);
 let basin=NormalField(-((length(b)-1.0)*80.0+rough*0.35),-(normalize(b)/vec3<f32>(310,80,175)*80.0+rough_gradient*0.35),variance*0.35*0.35,1e20);
 let hole=vec3<f32>(p.x,p.y+5.0,0);
 let bore=NormalField(length(hole)-24.0+rough*0.25,normalize(hole)+rough_gradient*0.25,variance*0.0625,1e20);
 let cap=NormalField(abs(p.z)-240.0,vec3<f32>(0,0,sign(p.z)),0.0,1e20);
 var cave=choose_normal(bore,cap,false);cave.value=-cave.value;cave.gradient=-cave.gradient;
 let r=(p-vec3<f32>(46,5,190))/vec3<f32>(1,1.5,0.8);
 let rock=NormalField(length(r)*0.8-9.0+rough*0.3,normalize(r)/vec3<f32>(1,1.5,0.8)*0.8+rough_gradient*0.3,variance*0.09,1e20);
 return choose_normal(choose_normal(choose_normal(choose_normal(base,mesa,true),basin,false),cave,false),rock,true);
}
// xyz normal, w discarded tangent slope variance. Seams/degenerate gradients
// keep the existing four-value fallback. This is not a coverage filter.
fn analytic_normal(q:vec3<f32>,foot:f32)->vec4<f32>{
 let direction=normalize(q);let coarse=normalize(frame.radial.xyz-frame.coarse.xyz);
 let incidence=dot(direction,coarse);let denominator=select(-1.0,1.0,incidence>=0.0)*max(abs(incidence),0.05);
 let dx=frame.right.xyz-direction*dot(frame.right.xyz,coarse)/denominator;
 let dy=frame.up.xyz-direction*dot(frame.up.xyz,coarse)/denominator;
 // Preserve output-resolvable frequencies for TSR; half a low-resolution sample
 // spacing is the lower-rate filter support. The projection is an approximation.
 let spacing=max(output_footprint(length(q)),sample_footprint(length(q))*0.5);
 let width=select(0.0,spacing*max(length(dx),length(dy)),NORMAL_FILTER==2u);
 let result=normal_field(q,width);let norm=length(result.gradient);
 if norm<1e-5||any(result.gradient!=result.gradient)||result.margin<max(0.0001,foot*0.05){return vec4<f32>(reference_normal(q,foot),0);}
 return vec4<f32>(result.gradient/norm,result.variance/(norm*norm));
}
@compute @workgroup_size(64)
fn normal_probe(@builtin(global_invocation_id) id:vec3<u32>){
 if id.x>=128u{return;}let q=hits[id.x].span.xyz;let value=normal_field(q,0.0);
 hits[id.x]=RayResult(vec4<f32>(normalize(value.gradient),value.margin),vec4<u32>(pack_normal(normalize(value.gradient)),bitcast<u32>(value.value),bitcast<u32>(planet_value(q)),0));
}
