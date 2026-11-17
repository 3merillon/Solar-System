// Restricted finite field language. Range propagation and omitted-band bounds.
// Numerical padding is explicit and is validated against f64, not a formal proof
// of every driver's floating point implementation. Coordinates are bounded.
fn hash32(input:u32)->u32 {
 var v=input;v^=v>>16u;v*=0x7feb352du;v^=v>>15u;v*=0x846ca68bu;return v^(v>>16u);
}
fn lattice(c:vec3<i32>,seed:u32)->f32 {
 return f32(hash32(bitcast<u32>(c.x)^hash32(bitcast<u32>(c.y)^hash32(bitcast<u32>(c.z)^seed)))>>8u)*(2.0/16777215.0)-1.0;
}
fn noise3(p:vec3<f32>,seed:u32)->f32 {
 let c=vec3<i32>(floor(p));let f=fract(p);let t=f*f*(3.0-2.0*f);
 return mix(mix(mix(lattice(c,seed),lattice(c+vec3<i32>(1,0,0),seed),t.x),
                mix(lattice(c+vec3<i32>(0,1,0),seed),lattice(c+vec3<i32>(1,1,0),seed),t.x),t.y),
            mix(mix(lattice(c+vec3<i32>(0,0,1),seed),lattice(c+vec3<i32>(1,0,1),seed),t.x),
                mix(lattice(c+vec3<i32>(0,1,1),seed),lattice(c+vec3<i32>(1,1,1),seed),t.x),t.y),t.z);
}
fn norm_range(p:vec3<f32>,d:vec3<f32>,half:f32)->vec2<f32> {
 let dd=dot(d,d);let t=clamp(-dot(p,d)/max(dd,1e-30),-half,half);
 return vec2<f32>(length(p+d*t),max(length(p-d*half),length(p+d*half)));
}
fn base_range(p:vec3<f32>,d:vec3<f32>,half:f32,scene:u32,seed:u32)->vec2<f32> {
 let sphere=norm_range(p,d,half)-3.0;
 if scene==0u {let bore=norm_range(vec3<f32>(0,p.yz),vec3<f32>(0,d.yz),half);return max(sphere,0.75-bore.yx);}
 if scene==1u {
  let warp=0.35*noise3(p*0.6,seed);let r=length(vec3<f32>(0,p.y-warp,p.z));
  let e=(1.0+0.35*0.6*3.0*sqrt(3.0))*half;return max(sphere,vec2<f32>(0.8-r-e,0.8-r+e));
 }
 if scene==2u {
  let q=abs(p)-vec3<f32>(3,2,0.65);let v=max(q.x,max(q.y,q.z));
  let arch=norm_range(vec3<f32>(p.x,p.y+1.0,0),vec3<f32>(d.xy,0),half);
  let a=max(vec2<f32>(v-half,v+half),1.5-arch.yx);
  return min(a,norm_range(p-vec3<f32>(3.7,-1.4,0),d,half)-0.45);
 }
 if scene==3u {let q=(p+0.6)-floor((p+0.6)/1.2)*1.2-0.6;let v=0.32-length(q);return max(sphere,vec2<f32>(v-half,v+half));}
 if scene==6u {let v=abs(p.y)-0.0005;return vec2<f32>(v-abs(d.y)*half,v+abs(d.y)*half);}
 return sphere;
}
struct Model {scene:u32,seed:u32,bands:u32,method:u32,amplitude:f32,ratio:f32}
struct Bound {interval:vec2<f32>,bands:u32}
fn field_value(p:vec3<f32>,m:Model)->f32 {
 var v=base_range(p,vec3<f32>(0),0,m.scene,m.seed).x;var a=m.amplitude;var f=0.7;
 for(var k=0u;k<m.bands;k++){v+=a*noise3(p*f,m.seed+k);a*=m.ratio;f*=2.0;}
 return v;
}
fn field_range(o:vec3<f32>,d:vec3<f32>,a:f32,b:f32,m:Model)->Bound {
 let half=(b-a)*0.5;let p=o+d*((a+b)*0.5);var r=base_range(p,d,half,m.scene,m.seed);
 if m.method!=2u {let v=base_range(p,vec3<f32>(0),0,m.scene,m.seed).x;let l=select(1.0,2.1,m.scene==1u);r=vec2<f32>(v-l*half,v+l*half);}
 var amp=m.amplitude;var freq=0.7;
 // Covers arithmetic, ray interpolation and noise evaluation in this small frame.
 let error=3e-6*(1.0+length(p)+abs(b));
 for(var k=0u;k<=m.bands;k++) {
  var tail=0.0;if k<m.bands {tail=amp*(1.0-pow(m.ratio,f32(m.bands-k)))/(1.0-m.ratio);}
  let bound=r+vec2<f32>(-tail-error,tail+error);
  if k==m.bands || (m.method!=0u && (bound.x>0.0 || bound.y<0.0)) {return Bound(bound,k);}
  let n=noise3(p*freq,m.seed+k);let delta=3.0*freq*dot(abs(d),vec3<f32>(1))*half;
  var nr=vec2<f32>(n-delta,n+delta);if m.method==2u {nr=clamp(nr,vec2<f32>(-1),vec2<f32>(1));}
  r+=amp*nr;amp*=m.ratio;freq*=2.0;
 }
 return Bound(vec2<f32>(-1e30,1e30),m.bands);
}
struct RayResult {span:vec4<f32>,counts:vec4<u32>}
struct Cursor {word:vec2<u32>,level:u32}
fn cursor_range(c:Cursor,near:f32,far:f32)->vec2<f32>{
 let factor=exp2(-f32(c.level));let low=c.word.y+1u;let high=c.word.x+select(0u,1u,low==0u);
 let a=(f32(c.word.x)*4294967296.0+f32(c.word.y))*factor;
 let b=(f32(high)*4294967296.0+f32(low))*factor;
 return near+(far-near)*vec2<f32>(a,b);
}
fn cursor_descend(c:Cursor)->Cursor{return Cursor(vec2<u32>((c.word.x<<1u)|(c.word.y>>31u),c.word.y<<1u),c.level+1u);}
fn cursor_advance(input:Cursor)->Cursor{
 var c=input;
 loop{if c.level==0u{return Cursor(vec2<u32>(0),0xffffffffu);}if (c.word.y&1u)==0u{c.word.y+=1u;return c;}
 c.word=vec2<u32>(c.word.x>>1u,(c.word.y>>1u)|(c.word.x<<31u));c.level--;}
 return Cursor(vec2<u32>(0),0xffffffffu);
}
fn trace_field(o:vec3<f32>,d:vec3<f32>,near:f32,far:f32,tolerance:f32,budget:u32,m:Model)->RayResult {
 var cursor=Cursor(vec2<u32>(0),0u);var high=1u;
 var bounds=0u;var bands=0u;var pending=-1.0;var first_value=0.0;var preceding_sign=0.0;
 loop {
  if cursor.level==0xffffffffu {break;}let segment=cursor_range(cursor,near,far);let a=segment.x;let b=segment.y;
  if bounds>=budget {return RayResult(vec4<f32>(select(a,pending,pending>=0),b,2,0),vec4<u32>(bounds,bands,high,0));}
  let r=field_range(o,d,a,b,m);bounds++;bands+=r.bands;
  if r.interval.x>0.0 || r.interval.y<0.0 {
   let region_sign=select(-1.0,1.0,r.interval.x>0.0);
   if pending<0.0{preceding_sign=region_sign;}
   else if first_value*region_sign<0.0&&a-pending<=tolerance{return RayResult(vec4<f32>(pending,a,1,select(0.0,1.0,first_value<0.0)),vec4<u32>(bounds,bands,high,0));}
   cursor=cursor_advance(cursor);continue;
  }
  if b-a<=tolerance*0.0625 {
   if pending<0.0 {pending=a;first_value=preceding_sign;if first_value==0.0{let f=field_value(o+d*a,m);let e=3e-6*(1.0+length(o+d*a)+abs(a));first_value=select(0.0,sign(f),abs(f)>e);bands+=m.bands;}}
   let fb=field_value(o+d*b,m);bands+=m.bands;
   let eps=3e-6*(1.0+length(o+d*b)+abs(b));
   if ((first_value>0.0 && fb< -eps)||(first_value<0.0 && fb>eps)) && b-pending<=tolerance {
    return RayResult(vec4<f32>(pending,b,1,select(0.0,1.0,first_value<0)),vec4<u32>(bounds,bands,high,0));
   }
   if b-pending>tolerance {return RayResult(vec4<f32>(pending,b,2,0),vec4<u32>(bounds,bands,high,0));}
   cursor=cursor_advance(cursor);
  } else {
   if cursor.level>=48u {return RayResult(vec4<f32>(a,b,3,0),vec4<u32>(bounds,bands,high,0));}
   let mid=(a+b)*0.5;
   if mid==a || mid==b {return RayResult(vec4<f32>(a,b,2,0),vec4<u32>(bounds,bands,high,0));}
   cursor=cursor_descend(cursor);high=max(high,cursor.level+1u);
  }
 }
 return RayResult(vec4<f32>(select(far,pending,pending>=0),far,select(0.0,2.0,pending>=0),0),vec4<u32>(bounds,bands,high,0));
}
