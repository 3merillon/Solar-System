// Production shared walk: no independent-audit private sample arrays.
fn integrate_media_from(origin:vec3<f32>,d:vec3<f32>,end:f32,background:vec3<f32>,separate:bool)->vec4<f32>{
 if DIAGNOSTICS {shading_calls[7]+=1u;}
 if frame.media.x==0.0&&frame.media.y==0.0{return vec4<f32>(background,0.0);}
 var near=0.0;var far=end;
 if planet_scene(){let shell=sphere_segment_from(origin,d,100000.0);near=max(0.0,shell.x);far=min(far,shell.y);}
 if far<=near{return vec4<f32>(background,0);}
 let steps=frame.size.w;var trans=vec3<f32>(1);var radiance=vec3<f32>(0);let mu=dot(d,frame.sun.xyz);
 let rayleigh=3.0/(16.0*PI)*(1.0+mu*mu);let g=0.65;let hg=(1.0-g*g)/(4.0*PI*pow(1.0+g*g-2.0*g*mu,1.5));
 var cuts:array<f32,6>;cuts[0]=near;cuts[1]=far;cuts[2]=far;cuts[3]=far;cuts[4]=far;cuts[5]=far;
 if planet_scene() {let outer=sphere_segment_from(origin,d,7200.0);let inner=sphere_segment_from(origin,d,4400.0);cuts[2]=clamp(outer.x,near,far);cuts[3]=clamp(outer.y,near,far);cuts[4]=clamp(inner.x,near,far);cuts[5]=clamp(inner.y,near,far);}
 for(var j=1u;j<6u;j++){var k=j;loop{if k==0u||cuts[k]>=cuts[k-1u]{break;}let v=cuts[k];cuts[k]=cuts[k-1u];cuts[k-1u]=v;k--;}}
 for(var segment_id=0u;segment_id<5u;segment_id++){
 let start=cuts[segment_id];let finish=cuts[segment_id+1u];if finish-start<0.001{continue;}
 var local_steps=select(steps,max(4u,steps/2u),planet_scene());
 if planet_scene() {let middle_height=altitude(origin+d*((start+finish)*0.5));if middle_height>4400.0&&middle_height<7200.0{local_steps=min(128u,max(local_steps,u32(ceil((finish-start)/350.0))));}}
 for(var i=0u;i<local_steps;i++){
  // Deterministic quadrature, no temporal noise or hidden early transmittance cut.
  let a=start+(finish-start)*f32(i)/f32(local_steps);let b=start+(finish-start)*f32(i+1u)/f32(local_steps);let q=origin+d*(start+(finish-start)*(f32(i)+0.5)/f32(local_steps));
  let air=atmosphere_sigma(q);let cloud=cloud_density(q);
  let cloud_sigma=cloud*select(0.8,0.002,planet_scene());let sigma=air+cloud_sigma;let segment=exp(-sigma*(b-a));
  let fraction=clamp(cloud_sigma/max(dot(sigma,vec3<f32>(1.0/3.0)),1e-9),0.0,1.0);let phase=mix(rayleigh,hg,fraction);
  let solar=sun_transmittance(q);
  let up=select(vec3<f32>(0,1,0),normalize(frame.radial.xyz*frame.camera_lo.w+q),planet_scene());
  // Explicit diffuse multiple-scattering approximation for high-albedo clouds.
  // Single scattering alone makes a sunlit cloud slab implausibly dark.
  let cloud_fill=(vec3<f32>(0.08,0.10,0.13)+frame.sun.w*(0.035+0.085*max(dot(up,frame.sun.xyz),0.0)))*(0.25+0.75*sqrt(solar));
  let light=frame.sun.w*phase*solar+mix(vec3<f32>(0.03,0.045,0.07),cloud_fill,fraction);
  radiance+=trans*(1.0-segment)*light;trans*=segment;
 }}
 return vec4<f32>(radiance+trans*background,-log(max(1e-20,dot(trans,vec3<f32>(1.0/3.0)))));
}
