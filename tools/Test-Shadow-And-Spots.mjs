// Render the projected B-ring edge and image the same magnetic region from either side.
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {headless} from './Headless.mjs';
import {capture, ready, runFrames} from './Explorer-Test-Lib.mjs';
import {giantShot} from './Giant-Flight.mjs';

const [base='http://127.0.0.1:5348', dir='evidence/local/shadow-and-spots',mode='current',size='720'] = process.argv.slice(2);
const out=resolve(dir), height=Number(size), width=Math.round(height*16/9);
await mkdir(out,{recursive:true});
const browser=await headless(join(out,'browser'));
const camera='solarExplorer.camera=solarFlight.frame(0,new Set(),0);';
const report={width,height,gpuP95:{}};
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const norm=a=>a.map(x=>x/Math.hypot(...a));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const add=(a,b,k)=>a.map((x,i)=>x+k*b[i]);
async function pose(id,eye,target,up){
  const words=JSON.stringify([...eye,...target,...up]);
  await browser.evaluate(`solarFlight.flight.jump_camera(${id},new Float64Array(${words}));`);
}
async function frame(name){
  const run=await runFrames(browser,36,camera);
  const times=run.rows.slice(10).map(r=>r.gpu_span_ms).filter(Number.isFinite).sort((a,b)=>a-b);
  report.gpuP95[name]=times[Math.ceil(.95*times.length)-1];
  return capture(browser,join(out,name+'.png'),width,height);
}
try {
  await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await browser.send('Page.navigate',{url:base+'/index.html?body=solar&at=699&test=1&quality=high'});
  await ready(browser);
  if(mode!=='baseline')report.penumbra=await checkPenumbra(browser);
  await browser.evaluate(`solarExplorer.resize(${width},${height});solarExplorer.engine.profiling(true);`+giantShot(699,0));
  await runFrames(browser,60,camera);
  const {body,day}=await browser.evaluate(`(()=>{const p=solarFlight.flight.packet(1280,720);
    const n=p[26],header=p.length-39*n-p[31];
    for(let i=0;i<n;i++){const r=p.slice(header+39*i,header+39*(i+1));if(r[38]===699)return {body:Array.from(r),day:p[36]};}})()`);
  await browser.evaluate(`solarExplorer.configure({auto_exposure:false,exposure:${1.3/day}})`);
  const sun=body.slice(12,15), along=norm([sun[0],0,sun[2]]), east=cross([0,1,0],along);
  const ring=add(along.map(x=>x*92e6*Math.cos(.34)),east,92e6*Math.sin(.34));
  for(const [name,alt,pitch,roll,side] of [['shadow-up',150000,.12,.35,0],['shadow-horizon',85000,.025,.55,0],
    ['shadow-along',155000,.045,.42,1],['shadow-bank',129000,.18,.68,-1]]){
    // Follow the solar ray from the inner B-ring boundary to the oblate atmospheric level.
    const a=body[7]+alt,c=body[8]+alt;
    const qa=(sun[0]/a)**2+(sun[1]/c)**2+(sun[2]/a)**2;
    const qb=dot(ring,sun)/(a*a), qc=dot(ring,ring)/(a*a)-1;
    const eye=add(ring,sun,-qc/(qb+Math.sqrt(qb*qb-qa*qc)));
    const up=norm([eye[0]/(a*a),eye[1]/(c*c),eye[2]/(a*a)]);
    const right=norm(cross([0,1,0],up)),north=norm(cross(up,right));
    // A tangent to the shadow boundary keeps it in the view for a long grazing ray.
    const gradient=[ring[0],-dot(ring,sun)/sun[1],ring[2]];
    const tangent=norm(cross(up,gradient)).map(v=>v*side);
    const dir=side?add(tangent,north,.045):north;
    await pose(699,eye,add(eye,add(dir,up,pitch),10000),add(up,norm(cross(dir,up)),roll));
    await frame(name);
  }
  await browser.evaluate(`solarFlight.setTime(852076800);solarFlight.setRate(0);
    solarFlight.flight.jump_near(10,3e7);solarFlight.flight.look_at(10);
    solarExplorer.configure({auto_exposure:false,exposure:.065});`);
  await runFrames(browser,48,camera);
  const region=await browser.evaluate("solarExplorer.stats().solar.star_regions.filter(r=>r[3]>.65).sort((a,b)=>b[2]*b[3]-a[2]*a[3])[0]");
  assert(region,'a developed active region at the reference epoch');
  report.region=region;
  const [lat,lon]=region.slice(0,2).map(x=>x*Math.PI/180);
  const centre=[Math.cos(lat)*Math.sin(lon),Math.sin(lat),Math.cos(lat)*Math.cos(lon)];
  const ew=[Math.cos(lon),0,-Math.sin(lon)],ns=cross(centre,ew);
  const tilt=-.5*lat;
  const spotEast=add(ew.map(x=>x*Math.cos(tilt)),ns,Math.sin(tilt));
  const sep=(.025+.04*region[2])*region[3];
  const normal=add(centre.map(x=>x*Math.sqrt(1-sep*sep)),spotEast,sep);
  const right=norm(cross([0,1,0],normal)),up=cross(normal,right);
  const R=await browser.evaluate('solarFlight.flight.constructor.body_radius(10)');
  const radius=R*(.010+.018*region[2])*region[3];
  const target=normal.map(x=>x*(R-500000));
  const field=height/(2*Math.tan(Math.PI/6));
  report.spotRadiusKm=radius/1000;
  report.centres={};
  for(const [name,side,altitude] of [['left',-.75,2.6],['right',.75,2.6],['moving',0,1.25],['approach',0,1.25]]){
    const eye=add(add(target,normal,altitude*radius),right,side*altitude*radius);
    const forward=norm(add(target,eye,-1)),screenRight=norm(cross(forward,up)),screenUp=cross(screenRight,forward);
    let pixels;
    if(name==='moving'){
      const geometry=JSON.stringify({target,normal,right,up,radius});
      await runFrames(browser,90,`{const {target,normal,right,up,radius}=${geometry};
        const f=i/89,alt=2.6-1.35*f,side=.75*(1-f);
        const eye=target.map((x,k)=>x+radius*alt*(normal[k]+side*right[k]));
        solarFlight.flight.jump_camera(10,new Float64Array([...eye,...target,...up]));}`+camera);
      pixels=await capture(browser,join(out,'spot-moving.png'),width,height);
    }else{
      await pose(10,eye,target,up);
      pixels=await frame('spot-'+name);
    }
    // Register all views on a common plane 500 km below the quiet photosphere.
    const samples=[];
    for(let j=-64;j<=64;j++)for(let i=-64;i<=64;i++){
      const x=i*radius/80,y=j*radius/80;
      if(Math.hypot(x,y)>.80*radius)continue;
      const q=add(add(add(target,eye,-1),right,x),up,y);
      const k=field/dot(q,forward);
      const u=Math.round(width/2+k*dot(q,screenRight)),v=Math.round(height/2-k*dot(q,screenUp));
      if(u>=0&&u<width&&v>=0&&v<height)samples.push([x,y,pixels[4*(width*v+u)+1]]);
    }
    const sorted=samples.map(p=>p[2]).sort((a,b)=>a-b);
    const dark=sorted[Math.floor(.10*sorted.length)],bright=sorted[Math.floor(.8*sorted.length)];
    assert(bright-dark>12,name+' resolves an umbra and its surroundings');
    const threshold=dark+.32*(bright-dark);
    let total=0,mx=0,my=0;
    for(const [x,y,value] of samples){const w=Math.max(0,threshold-value);total+=w;mx+=w*x;my+=w*y;}
    report.centres[name]={xKm:mx/total/1000,yKm:my/total/1000,dark,bright};
  }
  const {left,right:other}=report.centres;
  report.oppositeViewDriftKm=Math.hypot(left.xKm-other.xKm,left.yKm-other.yKm);
  const {moving,approach}=report.centres;
  report.motionDriftKm=Math.hypot(moving.xKm-approach.xKm,moving.yKm-approach.yKm);
  // Look sideways through the magnetic wall, including from within the emitting layer.
  for(const [name,alt] of [['spot-wall',800000],['spot-in-gas',200]]){
    const edgeNormal=norm(add(normal,right,.43*radius/R));
    const eye=edgeNormal.map(v=>v*(R+alt));
    const inward=norm(cross(edgeNormal,up));
    await pose(10,eye,add(eye,add(inward,edgeNormal,-.16),10000),edgeNormal);
    const pixels=await frame(name);
    const levels=[];
    for(let y=height/2;y<height-4;y+=8){
      for(let x=4;x<width-4;x+=8)levels.push(pixels[4*(y*width+x)+1]);
    }
    levels.sort((a,b)=>a-b);
    const mid=levels[Math.floor(levels.length/2)];
    assert(mid>10 && mid<248,name+' has a resolved, unclipped photospheric column');
  }
  console.log(JSON.stringify(report));
  if(mode!=='baseline'){
    assert(report.oppositeViewDriftKm<.06*report.spotRadiusKm,'the same umbra stays registered from opposing views');
    assert(report.motionDriftKm<.02*report.spotRadiusKm,'approaching and stationary umbra agree');
  }
} finally {
  await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));
  await browser.close();
}

// Compare the actual shadow function with a dense integration through the same
// ring material. A darkened or blurred frame alone cannot establish this.
async function checkPenumbra(browser){
  const source=await readFile(new URL('../shaders/space.wgsl',import.meta.url),'utf8');
  const body=source.match(/struct Body \{[\s\S]*?\n\}/)[0];
  const rings=source.slice(source.indexOf('fn ring_noise('),source.indexOf('// All distances below'));
  const code=body+'\nconst PI:f32=3.14159265;\n'+rings+`
    @group(0) @binding(0) var<storage,read_write> out:array<vec2<f32>>;
    @compute @workgroup_size(32) fn check(@builtin(global_invocation_id) id:vec3<u32>){
      let row=id.y;let angle=.00049;
      let sun=normalize(vec3<f32>(.93,select(.36,.002,row==2u),.08));
      let edge=select(select(92000e3,122170e3,row==1u),74658e3,row==2u);
      let distance=(edge-54e6)/sun.x;
      let scale=distance*angle/sun.y;
      let x=(f32(id.x)/127.0-.5)*4.0;
      let p=vec3<f32>(edge+x*scale,0,0)-sun*distance;
      let span=vec3<f32>(select(0.0,1.4*scale,row==3u),0,0);
      var b:Body;b.sun=vec4<f32>(sun,1);b.ring=vec4<f32>(74658e3,136775e3,angle,0);
      let u=normalize(cross(sun,vec3<f32>(0,1,0)));let v=cross(sun,u);
      var reference=0.0;
      for(var j=0u;j<2048u;j++){
        let r=sqrt((f32(j)+.5)/2048.0);let phi=f32(j)*2.39996323;
        let dir=normalize(sun+angle*r*(cos(phi)*u+sin(phi)*v));
        let pos=p+span*(fract((f32(j)+.5)*.41421356)-.5);
        let t=-pos.y/dir.y;
        var light=1.0;if t>0{light=exp(-saturn_ring(length(pos.xz+t*dir.xz)).x/abs(dir.y));}
        reference+=light;
      }
      out[row*128u+id.x]=vec2<f32>(ring_sunlight(b,p,span),reference/2048.0);
    }`;
  const values=await browser.evaluate(`(async()=>{
    const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice();
    const size=4*128*8;
    try{
      const module=device.createShaderModule({code:${JSON.stringify(code)}});
      const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'check'}});
      const output=device.createBuffer({size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
      const read=device.createBuffer({size,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
      const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:output}}]});
      const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();
      pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(4,4);pass.end();
      encoder.copyBufferToBuffer(output,0,read,0,size);device.queue.submit([encoder.finish()]);
      await read.mapAsync(GPUMapMode.READ);return Array.from(new Float32Array(read.getMappedRange()));
    }finally{device.destroy();}
  })()`);
  const results=[];
  for(let row=0;row<4;row++){
    let error=0,peak=0,min=1,max=0;
    for(let x=0;x<128;x++){
      const i=2*(128*row+x),sample=values[i],delta=Math.abs(sample-values[i+1]);
      error+=delta*delta;peak=Math.max(peak,delta);min=Math.min(min,sample);max=Math.max(max,sample);
    }
    results.push({rms:Math.sqrt(error/128),peak,contrast:max-min});
  }
  console.log('Ring shadow vs 2,048 rays',results);
  for(const r of results)assert(r.contrast>.2 && r.rms<.035 && r.peak<.12,'resolved finite-disk penumbra');
  return results;
}
