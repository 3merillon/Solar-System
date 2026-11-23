// Measured-Earth streaming regression. Keep a tree and a rock centred through
// a real LOD change while a dense vector tile arrives beside their roots.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {headless} from './Headless.mjs';
import {runFrames,capture} from './Explorer-Test-Lib.mjs';
const dir=process.argv[2]||'evidence/local/scenery-approach';
const base=process.env.SOLAR_TEST_URL||'http://127.0.0.1:5198/';
const hill=process.argv.includes('--hill');
const width=520,height=320,R=6371000;
await mkdir(dir,{recursive:true});
const browser=await headless(dir),rows=[];
const unit=p=>p.map(v=>v/Math.hypot(...p));
const eyeDir=unit([1/2048,353/2048,1]);
const root=eyeDir.map(v=>v*(R+400));
function camera(point,size,distance) {
 const up=unit(point),east=unit([up[2],0,-up[0]]);
 const aim=point.map((v,i)=>v+up[i]*size*.38);
 return [aim.map((v,i)=>v+distance*(east[i]+.48*up[i])),aim,up];
}
// Cluster distinct tiny footprints beside the prop. Their padded broad-phase
// bounds include it, but even the widest prop exclusion radius stops short.
function buildingTile(point,overlap) {
 const up=unit(point),east=unit([up[2],0,-up[0]]);
 const north=[up[1]*east[2],up[2]*east[0]-up[0]*east[2],-up[1]*east[0]];
 const pos=up.map(v=>v*R),hi=pos.map(x=>Math.floor(x/4096)*4096),lo=pos.map((x,i)=>x-hi[i]);
 const n=85,rb=new ArrayBuffer(n*112),pb=new ArrayBuffer(n*64);
 const rf=new Float32Array(rb),ru=new Uint32Array(rb),pf=new Float32Array(pb),pu=new Uint32Array(pb);
 for(let j=0;j<n;j++){
  const x=j===n-1&&overlap?0:14.3+(j%7)*.12,y=j===n-1&&overlap?0:(Math.floor(j/7)-6)*.18;
  const bounds=[x-.5,y-.5,x+.5,y+.5];
  rf.set([...hi,2,...lo,0,...east,0,...north,0,...bounds],j*28);
  ru.set([j*4,4,j+1,0],j*28+20);rf.set([.4,.3,.2,0],j*28+24);
  [[bounds[0],bounds[1]],[bounds[2],bounds[1]],[bounds[2],bounds[3]],[bounds[0],bounds[3]]].forEach((p,k)=>{
   pf.set(p,(j*4+k)*4);pu.set([j*4+(k+1)%4,1],(j*4+k)*4+2);
  });
 }
 return [Array.from(new Uint8Array(rb)),Array.from(new Uint8Array(pb))];
}
const frames=n=>runFrames(browser,n);
async function measure(object,stage){
 const row=await browser.evaluate(`(async()=>{
  const a=JSON.parse(await solarExplorer.engine.audit_scenery());
  const o=a.objects.find(o=>o.slot===${object.slot}&&o.key.slice(0,3).join()===${JSON.stringify(object.key.slice(0,3).join())});
  const data=await solarExplorer.engine.capture('normal'),view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  const positions=await solarExplorer.engine.capture('position'),pos=new DataView(positions.buffer,positions.byteOffset,positions.byteLength);
  let pixels=0;for(let i=0;o&&i<data.length/8;i++){
   const h=view.getUint16(i*8+6,true),tag=-(1+(h&1023)/1024)*2**(((h>>10)&31)-15);
   if(!(h&32768)||!(${object.kind}===2?tag===-103:tag<=-101&&tag>-103))continue;
   const delta=o.support.slice(0,3).map((v,j)=>pos.getFloat32(i*16+j*4,true)-v);
   if(Math.hypot(...delta)<o.shape[0]*1.65)pixels++;
  }
  return {drawn:o?.drawn??false,fade:o?.contact[3],lod:o?.support[3],pixels};
 })()`);
 rows.push({kind:object.kind,stage,...row});console.log(rows.at(-1));return row;
}
try{
 await browser.send('Page.navigate',{url:new URL('field/chart.js',base).href});
 await browser.evaluate(`(async()=>{
  document.body.innerHTML='<canvas width="${width}" height="${height}"></canvas>';
  const {createWorkerExplorer}=await import(${JSON.stringify(new URL('worker-client.js',base).href)});
  const engine=await createWorkerExplorer(document.querySelector('canvas'),()=>{},e=>{window.fatal=e},'full','earth');
  await engine.configure(JSON.stringify({...JSON.parse(engine.settings()),trees:true,rocks:true,ground_cover:false,buildings:true,
   atmosphere:false,water:false,clouds:false,shadows:false,fetch_limits:false,scenery_wind:0,render_scale:1}));
  window.solarExplorer={engine,camera:${JSON.stringify(camera(root,8,180))},step(dt){return engine.render(this.camera.flat(),dt,0)},stats:()=>JSON.parse(engine.stats()),telemetry:()=>JSON.parse(engine.telemetry()),capture:k=>engine.capture(k)};
  const albedo=new Uint8Array(264*264*4);
  for(let i=0;i<albedo.length;i+=4)albedo.set([48,74,35,255],i);
  window.supplyPage=async function(face,level,x,y,water=-2,provisional=false){
   const count=2**level,heights=new Uint16Array(264*264);
   if(${hill})for(let i=0;i<264;i++){
    const u=(2*(x+(i-3)/256)/count-1)*6371000;
    const h=Math.round(2000+1500*Math.sin((u-6371000/2048)/270));
    for(let j=0;j<264;j++)heights[j*264+i]=h;
   }
   await engine.page_arrived(0,face,level,x,y,${hill?380:400},.01,provisional?130:2,new Uint8Array(heights.buffer),Float32Array.of(water===-2?-1000000:425));
   await engine.water_page_arrived(face,level,x,y,0,0,water,425,new Uint8Array());
   await engine.page_arrived(1,face,level,x,y,0,0,2,albedo,new Float32Array());
  }
  for(let face=0;face<6;face++)await supplyPage(face,0,0,0);
  for(let level=1;level<=12;level++){
   const n=2**level;await supplyPage(4,level,Math.floor((1+1/2048)*n/2),Math.floor((1+353/2048)*n/2));
  }
 })()`);
 const start=Date.now();let pending=[];
 do{
  pending=JSON.parse(await browser.evaluate('solarExplorer.engine.complete_pending()'));
  if(!pending.includes('scenery'))break;
  await frames(4);await new Promise(r=>setTimeout(r,50));
 }while(Date.now()-start<240000);
 assert.ok(!pending.includes('scenery'),'scenery pipelines still compiling: '+pending.join(', '));
 await frames(280);
 const objects=await browser.evaluate('(async()=>JSON.parse(await solarExplorer.engine.audit_scenery()).objects)()');
 for(const kind of [1,2]){
  const object=objects.find(o=>o.kind===kind&&o.contact[3]===1&&(kind===1?o.shape[0]>8&&o.shape[2]<36:o.shape[0]>1));
  assert.ok(object,`expected resident ${kind===1?'tree':'rock'} on mapped dry ground (${objects.length} candidates)`);
  const p=object.hi.map((x,i)=>x+object.lo[i]),size=object.shape[0];
  const setCam=scale=>browser.evaluate('solarExplorer.camera='+JSON.stringify(camera(p,size,size*scale)));
  const tile=async overlap=>browser.evaluate('solarExplorer.engine.building_sources(...'+JSON.stringify(buildingTile(p,overlap))+'.map(a=>new Uint8Array(a)))');
  await setCam(24);await frames(55);
  assert.ok((await measure(object,'distant')).drawn);
  await tile(false);
  for(const scale of [12,5,2.4,...(kind===1?[1.1,.48]:[1.65])]){
   await setCam(scale);await frames(36);
   const row=await measure(object,'approach-'+scale);
   assert.ok(row.drawn&&row.fade===1,'nearby open ground lost its resident prop on vector arrival');
   if(scale<6&&row.pixels===0)await capture(browser,dir+'/missing.png',width,height);
   if(scale<6)assert.ok(row.pixels>0,'expected pixels on the selected close mesh');
  }
  await tile(true);await frames(5);
  const retiring=await measure(object,'footprint-arrival');
  assert.ok(retiring.drawn&&retiring.fade>0&&retiring.fade<1,'an already drawn overlap must fade out');
  await frames(40);
  assert.equal((await measure(object,'footprint')).drawn,false,'actual building footprint must exclude the prop');
  await browser.evaluate('solarExplorer.engine.building_sources(new Uint8Array(),new Uint8Array())');await frames(50);
 }
 // Force a shared LOD and a tiny cap. All initially visible peers are
 // incumbents, so the five closest eligible trees should win and stay put.
 const configure=options=>browser.evaluate('solarExplorer.engine.configure(JSON.stringify({...JSON.parse(solarExplorer.engine.settings()),...'+JSON.stringify(options)+'}))');
 await browser.evaluate('solarExplorer.camera='+JSON.stringify(camera(root,8,180)));
 await configure({scenery_lod:2,scenery_draw_limit:32768});await frames(80);
 const ranked=await browser.evaluate(`(async()=>{
  const a=JSON.parse(await solarExplorer.engine.audit_scenery());
  return a.objects.filter(o=>o.kind===1&&o.drawn).map(o=>{
   const d=Math.hypot(...o.hi.map((v,i)=>v+o.lo[i]-a.eye[i]));
   return {slot:o.slot,rank:Math.floor(Math.log2(1+Math.max(1,d-o.shape[0])*.75)*192)*1048576+o.slot};
  }).sort((a,b)=>a.rank-b.rank).map(o=>o.slot);
 })()`);
 assert.ok(ranked.length>10,'draw pressure fixture needs competing trees');
 await configure({scenery_draw_limit:5});
 for(const count of [1,2,15]){
  await frames(count);
  const selected=await browser.evaluate(`(async()=>{
   const a=JSON.parse(await solarExplorer.engine.audit_scenery());
   return {slots:a.objects.filter(o=>o.kind===1&&o.drawn).map(o=>o.slot).sort((a,b)=>a-b),overflow:a.overflow};
  })()`);
  rows.push({stage:'draw-budget-5',...selected});
  assert.ok(selected.overflow>0);assert.deepEqual(selected.slots,ranked.slice(0,5).sort((a,b)=>a-b));
 }
 const tree=objects.find(o=>o.kind===1&&o.contact[3]===1&&o.shape[0]>8&&o.shape[2]<36);
 const p=tree.hi.map((x,i)=>x+tree.lo[i]);
 await configure({scenery_draw_limit:32768,scenery_lod:0});
 await browser.evaluate('solarExplorer.camera='+JSON.stringify(camera(p,tree.shape[0],tree.shape[0]*5)));
 await frames(65);
 const x=Math.floor((1+p[0]/p[2])*4096),y=Math.floor((1+p[1]/p[2])*4096);
 const water=(kind,provisional)=>browser.evaluate(`supplyPage(4,13,${x},${y},${kind},${provisional})`);
 await water(2,true);await frames(90);
 const provisional=await measure(tree,'provisional-lake');
 assert.ok(provisional.drawn&&provisional.fade===1,'provisional water must retain a visible tree');
 await water(2,false);await frames(100);
 assert.equal((await measure(tree,'confirmed-lake')).drawn,false);
 await water(-2,false);await frames(120);
 const repaired=await measure(tree,'same-level-dry-repair');
 assert.ok(repaired.drawn&&repaired.fade===1&&repaired.pixels>0,'a repaired dry tile restores eligible scenery');
}finally{await writeFile(dir+'/report.json',JSON.stringify(rows,null,2));await browser.close();}
