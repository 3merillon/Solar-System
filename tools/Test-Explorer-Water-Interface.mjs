import assert from 'node:assert/strict';
import {headless} from './Headless.mjs';
import {ready,runFrames,capture} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const dir=resolve(process.argv[2]||'evidence/local/water-interface');await mkdir(dir,{recursive:true});
const b=await headless(dir),report={browser:b.version,cases:[],manifest:JSON.parse((await readFile('web/pkg/explorer-manifest.json','utf8')).replace(/^\uFEFF/,''))};
const W=960,H=540,dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),norm=a=>a.map(x=>x/Math.hypot(...a)),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
async function observe(name,flat=false){
 const ocean=await capture(b,resolve(dir,`${name}-ocean.bin`),W,H,'ocean');
 const water=await capture(b,resolve(dir,`${name}-water.bin`),W,H,'water');
 const cap=await capture(b,resolve(dir,`${name}-cap.bin`),W,H,'ocean-cap');
 assert.equal(ocean.length,W*H*8);assert.equal(water.length,W*H*8);
 const snapshot=await b.evaluate('solarExplorer.snapshot()');let underwater=0,air=0,front=0,back=0,wrongFace=0,nonfinite=0,flatMismatch=0;
 const [eye,target,up]=snapshot.camera,forward=norm(target.map((x,k)=>x-eye[k])),right=norm(cross(forward,up)),vertical=cross(right,forward);
 const radius=await b.evaluate('solarExplorer.engine.radius()'),fov=Math.tan(Math.PI/6);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const i=y*W+x,alpha=water.readUInt16LE(i*8+6),sub=alpha===0;
  if(sub)underwater++;else air++;
  for(let k=0;k<4;k++)if((water.readUInt16LE(i*8+2*k)&0x7c00)===0x7c00)nonfinite++;
  const d=ocean.readFloatLE(i*8);if(!Number.isFinite(d))nonfinite++;
  const near=cap.readFloatLE(i*4);
  if(d>0)front++;if(d<0)back++;if(near!==0){if(sub!==(near>0))wrongFace++;}else if(d!==0&&(sub!==(d<0)))wrongFace++;
  if(flat){
   // Independent f64 analytic sphere/near-plane reference. No shader readback
   // is used to decide which medium the camera ray starts in.
   const px=((x+.5)/W*2-1)*W/H*fov,py=(1-(y+.5)/H*2)*fov;
   const near=eye.map((v,k)=>v+.1*(forward[k]+px*right[k]+py*vertical[k]));
   const signed=Math.hypot(...near)-radius-snapshot.settings.sea;
   if(Math.abs(signed)>.001&&sub!==(signed<0))flatMismatch++;
  }
 }
 const result={name,underwater,air,front,back,wrongFace,nonfinite,flatMismatch,snapshot};report.cases.push(result);
 await capture(b,resolve(dir,`${name}.png`),W,H);
 await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,2));
 assert.equal(nonfinite,0);assert.equal(wrongFace,0);if(flat)assert.ok(flatMismatch<W*H*.001,`flat medium disagreement ${flatMismatch}`);
 console.log(name,{underwater,air,front,back,flatMismatch});return result;
}
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:false});await b.send('Page.navigate',{url:'http://127.0.0.1:5198/explorer.html?test=1&body=procedural'});await ready(b);
 await b.evaluate(`solarExplorer.resize(${W},${H})`);
 if(process.argv.includes('--surface-detail'))await b.evaluate('solarExplorer.configure({surface_detail:true})');
 await b.evaluate(`solarExplorer.engine.profiling(true);solarExplorer.go('ground');window.base=solarExplorer.camera;window.n=base[0].map(v=>v/Math.hypot(...base[0]));window.h=solarExplorer.engine.height(...n);window.t=base[1].map((v,k)=>v-base[0][k]);let d=t.reduce((a,v,k)=>a+v*n[k],0);t=t.map((v,k)=>v-d*n[k]);let l=Math.hypot(...t);t=t.map(v=>v/l);window.r=[t[1]*n[2]-t[2]*n[1],t[2]*n[0]-t[0]*n[2],t[0]*n[1]-t[1]*n[0]];solarExplorer.configure({sea:h+8,clouds:false,wave_height:0});`);
 await runFrames(b,360);
 for(const [name,height,roll] of [['flat-above',.025,0],['flat-below',-.025,0],['flat-roll',0,.6]]){
  await b.evaluate(`{let eye=n.map(v=>v*(solarExplorer.engine.radius()+h+8+${height}));solarExplorer.camera=[eye,eye.map((v,k)=>v+1000*t[k]),n.map((v,k)=>v*Math.cos(${roll})+r[k]*Math.sin(${roll}))];}`);await runFrames(b,120);await observe(name,true);
 }
 await b.evaluate('solarExplorer.configure({wave_height:1});');await runFrames(b,120,'solarExplorer.time=i/60;');
 const wave=JSON.parse(await b.evaluate('solarExplorer.engine.audit_water()')).wave_at_eye_m;
 for(const [j,height,roll] of [[0,-.03,0],[1,0,0],[2,.03,0],[3,0,.6]]){
  await b.evaluate(`{let eye=n.map(v=>v*(solarExplorer.engine.radius()+h+8+${wave+height}));solarExplorer.camera=[eye,eye.map((v,k)=>v+1000*t[k]),n.map((v,k)=>v*Math.cos(${roll})+r[k]*Math.sin(${roll}))];}`);await runFrames(b,120);await observe(`wave-${j}`);
 }
 assert.ok(report.cases.filter(x=>x.underwater>W*H*.05&&x.air>W*H*.05).length>=3,'mixed medium image must be exercised');
 assert.ok(report.cases.filter(x=>x.name.startsWith('wave-')&&x.underwater>W*H*.05&&x.air>W*H*.05).length>=1,'wave crossing must exercise both media');
 // Same camera, same time, alternate 4096m origin splits.
 await runFrames(b,180);const before=await capture(b,resolve(dir,'rebase-before.png'),W,H);
 await b.evaluate('solarExplorer.engine.audit_rebase(4096,-4096,4096)');await runFrames(b,180);const after=await capture(b,resolve(dir,'rebase-after.png'),W,H);
 let max=0,sum=0,changed=0;for(let i=0;i<before.length;i++){const d=Math.abs(before[i]-after[i]);max=Math.max(max,d);sum+=d;changed+=d>3;}
 report.rebase={max_code:max,mean_code:sum/before.length,over_three_fraction:changed/before.length};assert.ok(report.rebase.mean_code<.3&&report.rebase.over_three_fraction<.01,'water rebase image stability');
 report.passed=true;await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,2));console.log(report.rebase);
}finally{await b.close();}
