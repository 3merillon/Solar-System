// The finish: the frame's linear HDR image (the composite's, or the space layer alone when no surface pass ran) becomes the
// display image here and nowhere else: bloom, the lens flare, exposure and its adaptation, the tone curve, the display's
// transfer curve. docs/HDR-FINISH.md.
struct Finish {
 tone:vec4<f32>, // x: exposure; y: the bloom's share of the image (0: none); z: one over the bloom's levels
 flare:vec4<f32>, // x: the lens flare's strength (0: none); y: the frame's aspect; z: one pixel in half heights; w: sources
 // Bright sources (stars near enough to matter): xy their place from the frame's centre in half heights, y down; z their
 // angular radius in the same unit.
 sources:array<vec4<f32>,4>,
 meter:vec4<f32>, // x: 1 when the frame's exposure adapts; y: how far the adapted exposure moves toward its goal this frame
}
@group(0) @binding(0) var<uniform> u:Finish;
@group(0) @binding(1) var scene:texture_2d<f32>;
@group(0) @binding(2) var bloom:texture_2d<f32>;
@group(0) @binding(3) var smooth_sampler:sampler;
// One level of the bloom's chain (or the scene, for the first step down).
@group(0) @binding(4) var level:texture_2d<f32>;
// The adapted exposure, one texel: this frame's for the finish, the frame before's for the meter.
@group(0) @binding(5) var adapted:texture_2d<f32>;
// seen: what the frame holds of each source (`measure`), the same for every pixel.
struct Corner {@builtin(position) clip:vec4<f32>,@location(0) uv:vec2<f32>,@location(1) @interpolate(flat) seen0:vec4<f32>,@location(2) @interpolate(flat) seen1:vec4<f32>,@location(3) @interpolate(flat) seen2:vec4<f32>,@location(4) @interpolate(flat) seen3:vec4<f32>}
fn place(i:u32)->vec4<f32>{let x=f32((i<<1u)&2u);let y=f32(i&2u);return vec4<f32>(x*2.0-1.0,1.0-y*2.0,x,y);}
// The chain's passes need no more than the corner.
@vertex fn corner(@builtin(vertex_index) i:u32)->Corner{let p=place(i);return Corner(vec4<f32>(p.xy,0.0,1.0),p.zw,vec4<f32>(0.0),vec4<f32>(0.0),vec4<f32>(0.0),vec4<f32>(0.0));}
// The light the frame really holds of a source: the mean of 24 points spread over its disk (never under a pixel and a half in
// radius), a point off the frame counting as dark; and that radius. So whatever stands in front of the source in the picture
// (a planet, a ridge, a cloud, the rings, the air at sunset) dims its flare by as much as it dims the source, and nothing else
// has to know. Worked out at the triangle's corners, three times a frame, not per pixel.
fn measure(i:u32)->vec4<f32>{
 if f32(i)>=u.flare.w||u.flare.x<=0.0{return vec4<f32>(0.0);}
 let s=u.sources[i];let r=max(s.z,1.5*u.flare.z);let size=vec2<f32>(textureDimensions(scene));var sum=vec3<f32>(0.0);
 for(var k=0u;k<24u;k++){
  let a=f32(k)*2.3999632;let p=s.xy+r*sqrt((f32(k)+0.5)/24.0)*vec2<f32>(cos(a),sin(a));
  let px=(vec2<f32>(p.x/u.flare.y,p.y)*0.5+0.5)*size;
  if all(px>=vec2<f32>(0.0))&&all(px<size){sum+=clamp(textureLoad(scene,vec2<i32>(px),0).rgb,vec3<f32>(0.0),vec3<f32>(60000.0));}
 }
 return vec4<f32>(sum/24.0,r);
}
@vertex fn finish_corner(@builtin(vertex_index) i:u32)->Corner{let p=place(i);return Corner(vec4<f32>(p.xy,0.0,1.0),p.zw,measure(0u),measure(1u),measure(2u),measure(3u));}
// The lens's own light, drawn as a photograph shows it, quietly: six ghosts on the line from the source through the frame's
// centre (images of the iris, a little larger in blue than in red), a faint coloured halo round the source, and the fourteen
// spikes of a seven-bladed iris. The eye's glare is not here: that is the star's own skirt (space.wgsl `star`) and the bloom.
// q: the pixel from the frame's centre in half heights; at: the source; seen: `measure`.
// Its light is the source's flux in the frame (radiance times solid angle) with two rules, both choices for a display, not a
// lens's measured reflectances: the flux is compressed, flux / (1 + flux / 0.01), where the Sun from 1 au gives 0.0025, so
// from Mercury's distance inward the flare stops growing; and it fades out as the source's mean luminance falls from 6 to
// 1.5 in the frame's units, which is a star whose disk is resolved and metered: a camera stopped down for the disk shows none.
// The shares are set against a Sun the renderer holds to 15 units, thousands of times under its true ratio to sunlit ground.
const FLUX_KNEE:f32=0.01;const LUMA=vec3<f32>(0.2126,0.7152,0.0722);
fn lens_flare(q:vec2<f32>,at:vec2<f32>,seen:vec4<f32>)->vec3<f32>{
 let lum=dot(seen.rgb,LUMA);let r=seen.a;let flux=seen.rgb*(3.14159265*r*r);
 let gain=smoothstep(1.5,6.0,lum)/(1.0+dot(flux,LUMA)/FLUX_KNEE);
 if gain<=0.0{return vec3<f32>(0.0);}
 // A source this far over the frame's range shows as white on screen whatever its colour (the tone curve pales it), and its
 // flare takes mostly that white: seven parts white to three of its own colour, at its luminance.
 let light=mix(flux,vec3<f32>(dot(flux,LUMA)),0.7)*gain;var out=vec3<f32>(0.0);
 // Ghosts: where along the line (1 is the source, 0 the centre, negative the far side), their size, share and coating tint.
 const WHERE=array<f32,6>(-0.30,-0.55,-0.92,-1.50,0.34,0.62);
 const SIZE=array<f32,6>(0.040,0.075,0.030,0.160,0.022,0.095);
 const SHARE=array<f32,6>(0.07,0.05,0.08,0.11,0.035,0.045);
 const TINT=array<vec3<f32>,6>(vec3<f32>(0.6,1.0,0.7),vec3<f32>(1.0,0.75,0.5),vec3<f32>(0.6,0.8,1.0),vec3<f32>(0.85,0.7,1.0),vec3<f32>(1.0,0.9,0.6),vec3<f32>(0.6,1.0,0.9));
 for(var k=0;k<6;k++){
  // A ghost of a disk is that disk, scaled, over the iris's own image.
  let size=sqrt(SIZE[k]*SIZE[k]+WHERE[k]*WHERE[k]*r*r);let d=length(q-at*WHERE[k])/size;
  if d<1.05{
   let disc=vec3<f32>(1.0-smoothstep(0.80,1.0,d*1.03),1.0-smoothstep(0.80,1.0,d),1.0-smoothstep(0.80,1.0,d*0.97));
   out+=light*TINT[k]*disc*(0.55+0.45*d*d)*(SHARE[k]/(3.14159265*size*size));
  }
 }
 let v=q-at;let d=length(v);
 // The halo: a ring 0.42 half heights from the source, red inside, blue outside.
 let wide=sqrt(0.018*0.018+r*r);let ring=(vec3<f32>(d)-vec3<f32>(0.405,0.42,0.435))/wide;
 out+=light*exp(-ring*ring)*(0.10/(6.2831853*0.42*wide*1.7725));
 // The spikes: bright near the source, gone within a third of a half height, and none once the disk is resolved.
 let angle=atan2(v.y,v.x);let core=max(2.0*r,2.0*u.flare.z);
 let spikes=pow(abs(cos(angle*7.0+0.4)),60.0)*(0.7+0.3*cos(angle*2.0+0.7));
 out+=light*spikes*(0.06/(d*d+core*core))*exp(-d/0.30)*smoothstep(0.25,0.05,r);
 return out*u.flare.x;
}
// Bloom, after Jimenez ("Next Generation Post Processing in Call of Duty: Advanced Warfare", SIGGRAPH 2014): no threshold; each
// level is the one above filtered and halved, then the chain is summed on the way back up. Every filter's weights sum to one,
// so each level holds the image's light and the mean of the levels does too: mixing that mean into the image moves light
// about and adds none.
fn tap(uv:vec2<f32>)->vec3<f32>{return textureSampleLevel(level,smooth_sampler,uv,0.0).rgb;}
// Down: 13 bilinear taps over 36 texels (his slides 152 to 157): a centre box of four taps at half the weight and four corner
// boxes sharing the other half, which written per tap is 1/8 for the centre and the inner four, 1/32 for the outer corners
// and 1/16 for the outer edges.
@fragment fn bloom_down(c:Corner)->@location(0) vec4<f32>{
 let t=1.0/vec2<f32>(textureDimensions(level));let uv=c.uv;
 let outer=tap(uv+t*vec2<f32>(-2.0,-2.0))+tap(uv+t*vec2<f32>(2.0,-2.0))+tap(uv+t*vec2<f32>(-2.0,2.0))+tap(uv+t*vec2<f32>(2.0,2.0));
 let edge=tap(uv+t*vec2<f32>(0.0,-2.0))+tap(uv+t*vec2<f32>(-2.0,0.0))+tap(uv+t*vec2<f32>(2.0,0.0))+tap(uv+t*vec2<f32>(0.0,2.0));
 let inner=tap(uv+t*vec2<f32>(-1.0,-1.0))+tap(uv+t*vec2<f32>(1.0,-1.0))+tap(uv+t*vec2<f32>(-1.0,1.0))+tap(uv+t*vec2<f32>(1.0,1.0));
 let sum=tap(uv)*0.125+outer*0.03125+edge*0.0625+inner*0.125;
 return vec4<f32>(clamp(sum,vec3<f32>(0.0),vec3<f32>(60000.0)),1.0);
}
// Up: a 3 by 3 tent (his slides 159 to 161), one texel of the smaller level in radius. The pass adds it to the level above.
fn tent(uv:vec2<f32>,t:vec2<f32>)->vec3<f32>{
 let corners=tap(uv+t*vec2<f32>(-1.0,-1.0))+tap(uv+t*vec2<f32>(1.0,-1.0))+tap(uv+t*vec2<f32>(-1.0,1.0))+tap(uv+t*vec2<f32>(1.0,1.0));
 let sides=tap(uv+t*vec2<f32>(0.0,-1.0))+tap(uv+t*vec2<f32>(-1.0,0.0))+tap(uv+t*vec2<f32>(1.0,0.0))+tap(uv+t*vec2<f32>(0.0,1.0));
 return (tap(uv)*4.0+sides*2.0+corners)/16.0;
}
@fragment fn bloom_up(c:Corner)->@location(0) vec4<f32>{return vec4<f32>(tent(c.uv,1.0/vec2<f32>(textureDimensions(level))),1.0);}
// The tone curve: AgX (Troy Sobotka), in the form three.js and Filament take from Blender's: the colour moved to Rec.2020
// primaries and inset toward grey, each channel taken to log2 over 16.5 stops round mid grey (2^-10 to 2^6.5 times 0.18) and
// through a sigmoid (Benjamin Wrensch's sixth-order fit, MIT, iolite-engine.com/blog_posts/minimal_agx_implementation), a look,
// the outset, and back. Because the channels are mixed before the sigmoid, a bright saturated colour pales toward white instead
// of sliding to the nearest of cyan, magenta and yellow as a per-channel curve on the display's primaries does (the former
// c / (1 + c) did). The look is half of Wrensch's "punchy": power 1.18, saturation 1.2 about the luminance. The owner chose it
// from tools/Tone-Curves.mjs sheets on 16 November 2026 (docs/HDR-FINISH.md). Matrices: three.js (MIT), columns as written there.
const TO_2020=mat3x3<f32>(vec3<f32>(0.6274,0.0691,0.0164),vec3<f32>(0.3293,0.9195,0.0880),vec3<f32>(0.0433,0.0113,0.8956));
const FROM_2020=mat3x3<f32>(vec3<f32>(1.6605,-0.1246,-0.0182),vec3<f32>(-0.5876,1.1329,-0.1006),vec3<f32>(-0.0728,-0.0083,1.1187));
const AGX_INSET=mat3x3<f32>(vec3<f32>(0.856627153315983,0.137318972929847,0.11189821299995),vec3<f32>(0.0951212405381588,0.761241990602591,0.0767994186031903),vec3<f32>(0.0482516061458583,0.101439036467562,0.811302368396859));
const AGX_OUTSET=mat3x3<f32>(vec3<f32>(1.1271005818144368,-0.1413297634984383,-0.14132976349843826),vec3<f32>(-0.11060664309660323,1.157823702216272,-0.11060664309660294),vec3<f32>(-0.016493938717834573,-0.016493938717834257,1.2519364065950405));
const AGX_MIN:f32=-12.47393;const AGX_MAX:f32=4.026069;
const LOOK_POWER:f32=1.18;const LOOK_SATURATION:f32=1.2;
// With this, scene mid grey (0.18) at the frame's default exposure (1.3) lands where the former curve put it (0.190 in display
// light), so the change of curve is a change of contrast and colour, not of brightness: 1.183 / 1.3.
const CURVE_GAIN:f32=0.910;
fn tone_curve(c:vec3<f32>)->vec3<f32>{
 var v=AGX_INSET*(TO_2020*c);
 v=clamp((log2(max(v,vec3<f32>(1e-10)))-AGX_MIN)/(AGX_MAX-AGX_MIN),vec3<f32>(0.0),vec3<f32>(1.0));
 let v2=v*v;let v4=v2*v2;
 v=15.5*v4*v2-40.14*v4*v+31.96*v4-6.868*v2*v+0.4298*v2+0.1191*v-0.00232;
 v=pow(max(v,vec3<f32>(0.0)),vec3<f32>(LOOK_POWER));let l=dot(v,vec3<f32>(0.2126,0.7152,0.0722));v=vec3<f32>(l)+LOOK_SATURATION*(v-vec3<f32>(l));
 v=AGX_OUTSET*v;
 // The sigmoid's output is for a display of power 2.2: back to light, and to the display's primaries.
 v=FROM_2020*pow(max(v,vec3<f32>(0.0)),vec3<f32>(2.2));
 return clamp(v,vec3<f32>(0.0),vec3<f32>(1.0));
}
// Auto exposure: a slow, partial adaptation of the whole frame to its light, as an eye or a camera adapts. The meter reads the
// chain's smallest level (the frame averaged over blocks of 64 pixels) at 16 by 9 points and takes the mean luminance weighted
// by the luminance itself, sum of squares over sum: the brightness of the light in the frame, which black sky does not drag
// down. The goal is the square root of 0.4 over that (half of a full adaptation: 0.4 is a sunlit landscape, measured on this
// renderer's own scenes), held between 1.5 stops down and 0.7 up, and never so far up that the brightest block passes 3. The
// exposure moves toward its goal with a time constant of a second (`u.meter.y`), in stops. A display model, not a measurement.
const METER_KEY:f32=0.4;const METER_PEAK:f32=3.0;
@fragment fn exposure_meter(c:Corner)->@location(0) vec4<f32>{
 var sum=0.0;var squares=0.0;var peak=0.0;
 for(var y=0;y<9;y++){for(var x=0;x<16;x++){
  let l=dot(textureSampleLevel(level,smooth_sampler,(vec2<f32>(f32(x),f32(y))+0.5)/vec2<f32>(16.0,9.0),0.0).rgb,LUMA);
  sum+=l;squares+=l*l;peak=max(peak,l);
 }}
 let lit=squares/max(sum,1e-6);
 var goal=clamp(sqrt(METER_KEY/max(lit,1e-4)),0.354,1.62);
 goal=min(goal,max(1.0,METER_PEAK/max(peak,1e-4)));
 let before=textureLoad(adapted,vec2<i32>(0),0).r;
 // No history yet (the first frame): the goal at once.
 let now=select(goal,exp2(mix(log2(max(before,1e-3)),log2(goal),u.meter.y)),before>0.0);
 return vec4<f32>(now,0.0,0.0,1.0);
}
@fragment fn finish(c:Corner)->@location(0) vec4<f32>{
 var color=max(vec3<f32>(0.0),textureLoad(scene,vec2<i32>(c.clip.xy),0).rgb);
 // The chain's sum over its levels: their mean, mixed in at the bloom's share.
 if u.tone.y>0.0{
  let t=1.0/vec2<f32>(textureDimensions(bloom));
  let corners=textureSampleLevel(bloom,smooth_sampler,c.uv+t*vec2<f32>(-1.0,-1.0),0.0).rgb+textureSampleLevel(bloom,smooth_sampler,c.uv+t*vec2<f32>(1.0,-1.0),0.0).rgb+textureSampleLevel(bloom,smooth_sampler,c.uv+t*vec2<f32>(-1.0,1.0),0.0).rgb+textureSampleLevel(bloom,smooth_sampler,c.uv+t*vec2<f32>(1.0,1.0),0.0).rgb;
  let sides=textureSampleLevel(bloom,smooth_sampler,c.uv+t*vec2<f32>(0.0,-1.0),0.0).rgb+textureSampleLevel(bloom,smooth_sampler,c.uv+t*vec2<f32>(-1.0,0.0),0.0).rgb+textureSampleLevel(bloom,smooth_sampler,c.uv+t*vec2<f32>(1.0,0.0),0.0).rgb+textureSampleLevel(bloom,smooth_sampler,c.uv+t*vec2<f32>(0.0,1.0),0.0).rgb;
  let glow=(textureSampleLevel(bloom,smooth_sampler,c.uv,0.0).rgb*4.0+sides*2.0+corners)/16.0*u.tone.z;
  color=mix(color,glow,u.tone.y);
 }
 if u.flare.x>0.0{
  let q=vec2<f32>((c.uv.x*2.0-1.0)*u.flare.y,c.uv.y*2.0-1.0);
  color+=lens_flare(q,u.sources[0].xy,c.seen0);
  if u.flare.w>1.0{color+=lens_flare(q,u.sources[1].xy,c.seen1)+lens_flare(q,u.sources[2].xy,c.seen2)+lens_flare(q,u.sources[3].xy,c.seen3);}
 }
 if u.meter.x>0.5{color*=textureLoad(adapted,vec2<i32>(0),0).r;}
 color=tone_curve(color*u.tone.x*CURVE_GAIN);
 return vec4<f32>(pow(color,vec3<f32>(1.0/2.2)),1.0);
}
