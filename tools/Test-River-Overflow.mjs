// River water where the map puts no channel. The real Wupper fixture (one recorded OSM z14 tile, nine z13 DEM
// tiles) goes through the served page builder into the served engine. For each view it counts the pixels that
// show water (water on against water off) and, of those, the ones whose ground lies outside every mapped channel:
// "spill", the blocks and sheets on dry banks. Inside: a centreline channel (1.25 widths and 3 m) or a map polygon (3 m). "dry" counts channel-centre ground (rivers 4 m and wider, or 6 m inside a river polygon) that
// shows no water close up. The near view is also read while its pages arrive, every 12 frames, for water that
// stands up while the terrain under it is still morphing. Serve a build at --base (default the dev server).
//   node tools/Test-River-Overflow.mjs --base http://127.0.0.1:5198 --out evidence/local/river-rework/overflow
//   [--shadows --sun-elevation 20 --sun-azimuth 200 --shadow-diagnostic 1 --flicker --waves 8 --views bank]
//   [--fixture-path $SOLAR_DATA/water-fixtures/rhine/fixture.json]  a fixture from Record-Water-Fixture.mjs: pages
//   below level 12 then read its z(level + 1) tiles, as the worker hands them
//   [--sea]  prepare the sea as the worker does (any fixture; douro always)
//   [--layer]  build pages with the water layer and the terrain from it (water-layer.js; buildHeightPage
//   {water:true, terrain:true}) and upload each water page with engine.water_page_arrived (docs/WATER-LAYER.md)
//   [--truth legacy]  judge water by the old rule (map polygons without the ocean, ground under 0.5 m counted as
//   sea at a mouth). Default: the canonical water union of the current tree's web/field/water-layer.js (ocean,
//   lakes, ponds, docks, river polygons and the network's channels), injected into the page, so every served build
//   is judged by the same map. Spill: water whose own surface point (the ocean target's distance along the pixel's ray, else the ground) lies over 3 m outside the union; dry: ground 6 m or more
//   inside it (all of 8 points at 6 m around it in water) that shows none. spill_beyond_pixel: spill whose ground lies
//   farther outside than one pixel's ground spacing too (an antialiased shore puts part of the water into a pixel
//   straddling it, which the 3 m rule counts at a distance).
//   [--profile [--diagnostic N] [--profile-columns 0.35,0.65]]  the ring test: the water's brightness against the eye's distance (sea100, sea200,
//   sea400 views: offshore over the sea), Water-Ring-Lib.mjs
//   [--scenery]  trees, rocks and ground cover on; per view, every ground-cover instance and tree/rock root from
//   engine.audit_scenery() is classified against the canonical water union on the CPU (docs/SCENERY.md, ground cover gates):
//   none on water except reeds; sampled cover roots against the published triangles (cover_contact).
//   [--timing 240]  per view, after it settles: GPU timestamps over that many frames, p50/p95/p99 of the water stage
//   (simulation, ocean raster, near-plane crossing, water shading) and of the whole GPU span. Only meaningful on a quiet
//   GPU, which this tool does not check: read the 3D engine use of other processes before and after a run.
import {headless} from './Headless.mjs';
import {runFrames,capture,png} from './Explorer-Test-Lib.mjs';
import {ringProfile,worstStep,worstDip,profileRows} from './Water-Ring-Lib.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const base=arg('base','http://127.0.0.1:5198'),dir=resolve(arg('out','evidence/local/river-rework/overflow')),W=+arg('width',960),H=+arg('height',640);
const views=arg('views','near,mid,far,junction,steep').split(','),fixture=arg('fixture','wupper'),fixturePath=arg('fixture-path',`${(process.env.SOLAR_DATA||'data')}/cloud-river-buildings-2026-11-02/fixtures/${fixture}/fixture.json`);
await mkdir(dir,{recursive:true});
const b=await headless(dir),report={base,truth:arg('truth','layer'),layer:process.argv.includes('--layer'),views:{},arrival:[]};
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:false});
 await b.send('Page.navigate',{url:base+'/field/chart.js'});
 const truthMode=arg('truth','layer'),truthSource=truthMode==='legacy'?null:{chart:await readFile('web/field/chart.js','utf8'),mapWater:await readFile('web/field/map-water.js','utf8'),layer:await readFile('web/field/water-layer.js','utf8'),rivers:await readFile('web/field/rivers.js','utf8')};
await b.evaluate('window.truthSource='+JSON.stringify(truthSource));
await b.evaluate('window.layerMode='+process.argv.includes('--layer')+';window.coarserSource='+JSON.stringify((await readFile('tools/Fixture-Dem.mjs','utf8'))));
await b.evaluate('window.sceneryOn='+process.argv.includes('--scenery'));await b.evaluate('window.shadowsOn='+process.argv.includes('--shadows')+';window.waveHeight='+(+arg('waves',0))+';window.shadowDiagnostic='+(+arg('shadow-diagnostic',0)));await b.evaluate('window.realFixture='+await readFile(fixturePath,'utf8'));await b.evaluate('window.mouth='+(fixture==='douro'||process.argv.includes('--sea')));
 await b.evaluate(`(async()=>{
 document.body.innerHTML='<canvas width="${W}" height="${H}"></canvas>';
 const {createWorkerExplorer}=await import('/worker-client.js'),{buildHeightPage}=await import('/field/resample.js'),{riverField}=await import('/field/rivers.js');
 const engine=await createWorkerExplorer(document.querySelector('canvas'),()=>{},e=>{window.fatal=e},'full','earth');
 await engine.configure(JSON.stringify({...JSON.parse(engine.settings()),cloud_scale:2,atmosphere_steps:4,clouds:false,trees:window.sceneryOn,rocks:window.sceneryOn,ground_cover:window.sceneryOn,buildings:false,atmosphere:false,shadows:window.shadowsOn,water:true,wave_height:window.waveHeight,shadow_diagnostic:window.shadowDiagnostic}));
 const real=window.realFixture,source={id:'fixture',channel:'height',tileSize:256,minZoom:real.dem[0].z,maxZoom:real.dem[0].z,coverage:{latLimit:85},seabedZoom:10};
 // A river mouth: the sea as the worker prepares it (water-steps.js scan and finish, from heights alone: seabed and
 // dry-land lift are real, the imagery shore and lakes are not).
 const {WATER_STEPS}=await import('/field/water-steps.js');
 const prepare=t=>{const tile={...t,heights:Float32Array.from(t.heights)};if(!window.mouth)return tile;const scan=WATER_STEPS.scan({tile,z:t.z,x:t.x,y:t.y}),out=WATER_STEPS.finish({tile,z:t.z,x:t.x,y:t.y,zoom:10,sea:scan.sea,parent:null,regions:[],image:null,imageZ:0});return {...tile,riverHeights:tile.heights,heights:out.heights||tile.heights,water:out.water};};
 const tiles=new Map(real.dem.map(t=>[t.z+'/'+t.x+'/'+t.y,prepare(t)]));
 // Coarser DEM zooms for the water layer's coarse networks, box-averaged from the recorded tiles (tools/Fixture-Dem.mjs).
 const FD=await import(URL.createObjectURL(new Blob([window.coarserSource],{type:'text/javascript'}))),coarser=FD.withCoarserTiles(tiles,real.dem[0].z),get=(s,z,x,y)=>coarser(z,x,y);
 const rivers=real.rivers,dem=(x,y)=>{const z=13,n=2**z,px=x*n*256-.5,py=y*n*256-.5,x0=Math.floor(px),y0=Math.floor(py),fx=px-x0,fy=py-y0;const at=(i,j)=>{const t=get(null,z,Math.floor(i/256),Math.floor(j/256));return t?t.heights[(j%256)*256+(i%256)]:NaN;};return (at(x0,y0)*(1-fx)+at(x0+1,y0)*fx)*(1-fy)+(at(x0,y0+1)*(1-fx)+at(x0+1,y0+1)*fx)*fy;};
 const field=riverField(rivers,dem);window.field=field;
 // The map's polygons (rivers, lakes, ponds) are channel too: their water is mapped, not spill.
 // A build from before map water has no polygons: everything outside its centreline channels then counts as spill.
 const mw=await import('/field/map-water.js').catch(()=>null);window.polys=mw?mw.mapWater(rivers,(x,y)=>({h:dem(x,y),water:-1e7}),{reach:8}):{query:()=>null};
 // The canonical union from the current tree (blob modules, imports rewritten), judged on the z14 tiles.
 window.truth=null;if(window.truthSource){const blob=t=>URL.createObjectURL(new Blob([t],{type:'text/javascript'})),c=blob(truthSource.chart),m=blob(truthSource.mapWater);
  const l=blob(truthSource.layer.replace("'./chart.js'","'"+c+"'").replace("'./map-water.js'","'"+m+"'"));const W=await import(l);
  // The network too comes from the current tree, so the judge's channels are the same whatever build is served.
  const rv=blob(truthSource.rivers.replace("'./map-water.js'","'"+m+"'"));const RV=await import(rv);const truthField=RV.riverField(rivers,dem);
  const vec=real.vectors?.[14]??rivers;window.truth=W.waterUnion(W.waterBodies(vec,(x,y)=>({h:dem(x,y),water:-1e7}),{samplerKey:'truth'}),truthField);
  const metric=y=>2*Math.PI*6371000/Math.cosh((.5-y)*2*Math.PI);
  // Wet within r metres: the point or any of 8 around it at r.
  window.truthNear=(x,y,r)=>{if(truth.wetAt(x,y))return true;const d=r/metric(y);for(let a=0;a<8;a++){const c=Math.cos(a*Math.PI/4)*d,s=Math.sin(a*Math.PI/4)*d;if(truth.wetAt(x+c,y+s))return true;}return false;};
  window.truthDeep=(x,y,r)=>{if(!truth.wetAt(x,y))return false;const d=r/metric(y);for(let a=0;a<8;a++){const c=Math.cos(a*Math.PI/4)*d,s=Math.sin(a*Math.PI/4)*d;if(!truth.wetAt(x+c,y+s))return false;}return true;};}
 window.solarExplorer={engine,camera:null,time:0,step(dt){return engine.render(this.camera.flat(),dt,this.time)},stats:()=>JSON.parse(engine.stats()),telemetry:()=>JSON.parse(engine.telemetry()),capture:k=>engine.capture(k)};
 for(let face=0;face<6;face++)await engine.page_arrived(0,face,0,0,0,400,0,1,new Uint8Array(264*264*2),Float32Array.of(-1e6));
 window.uploadFixture=async()=>{const raw=await engine.page_commands();if(!raw)return 0;let n=0;for(const p of JSON.parse(raw).pages){if(p.channel!==0){await engine.page_missing(p.channel,p.face,p.level,p.x,p.y);continue;}let data=p.level>=8?buildHeightPage(p,get,source,real.vectors?.[p.level>=12?14:Math.min(14,p.level+1)]??rivers,window.layerMode?{water:true,terrain:true}:{}):{offset:400,scale:0,bytes:new ArrayBuffer(264*264*2),water:Float32Array.of(-1e6)};if(data.missing){await engine.page_missing(p.channel,p.face,p.level,p.x,p.y);continue;}await engine.page_arrived(0,p.face,p.level,p.x,p.y,data.offset,data.scale,18,new Uint8Array(data.bytes),data.water||new Float32Array(0));
   if(window.layerMode&&p.level>=8){const w=data.waterPage;if(!w)await engine.water_page_arrived(p.face,p.level,p.x,p.y,0,0,-2,0,new Uint8Array(0));else if(w.uniform)await engine.water_page_arrived(p.face,p.level,p.x,p.y,w.levelOffset,w.levelScale,w.uniform.kind,w.uniform.level,new Uint8Array(0));else await engine.water_page_arrived(p.face,p.level,p.x,p.y,w.levelOffset,w.levelScale,-1,0,new Uint8Array(w.bytes.buffer.slice(0)));}
   n++;}return n;};
 const toWorld=(X,Y,h)=>{const lon=(X-.5)*2*Math.PI,lat=Math.atan(Math.sinh((.5-Y)*2*Math.PI)),r=6371000+h;return [r*Math.cos(lat)*Math.sin(lon),r*Math.sin(lat),r*Math.cos(lat)*Math.cos(lon)];};
 window.toWorld=toWorld;
 // Probe the network on a grid over the source tile: widest channel near the middle, steepest reach, a confluence.
 const t=rivers.reduce((a,c)=>(c.layers.waterway?.features.length||0)>(a.layers.waterway?.features.length||0)?c:a),n=2**t.z;let wide=null,steep=null;const probes=[];
 for(let j=0;j<160;j++)for(let i=0;i<160;i++){const X=(t.x+.1+.8*i/159)/n,Y=(t.y+.1+.8*j/159)/n,s=field.sample(X,Y);if(!s||s.ratio>.3)continue;const seg=s.segment,slope=Math.abs(seg.dh)/Math.max(.01,Math.sqrt(seg.length2)*seg.metric);probes.push({X,Y,level:s.level,width:s.left+s.right,slope,dx:seg.dx/Math.sqrt(seg.length2),dy:seg.dy/Math.sqrt(seg.length2),dh:seg.dh});
  const centre=Math.hypot(i-80,j-80);if(!wide||s.left+s.right>wide.width+.5||(Math.abs(s.left+s.right-wide.width)<=.5&&centre<wide.centre))wide={X,Y,level:s.level,width:s.left+s.right,centre,dx:seg.dx/Math.sqrt(seg.length2),dy:seg.dy/Math.sqrt(seg.length2),dh:seg.dh};
  if(s.left+s.right>=2&&(!steep||slope>steep.slope))steep={X,Y,level:s.level,width:s.left+s.right,slope,dx:seg.dx/Math.sqrt(seg.length2),dy:seg.dy/Math.sqrt(seg.length2),dh:seg.dh};}
 // A confluence: two probes of different direction within 40 m of each other, both on channels 2 m or wider.
 let junction=null;const metric=2*Math.PI*6371000/Math.cosh((.5-wide.Y)*2*Math.PI);
 for(let a=0;a<probes.length&&!junction;a+=3)for(let c=a+1;c<probes.length;c+=3){const p=probes[a],q=probes[c];if(p.width<2||q.width<2)continue;const d=Math.hypot(p.X-q.X,p.Y-q.Y)*metric;if(d<40&&Math.abs(p.dx*q.dx+p.dy*q.dy)<.5){junction={X:(p.X+q.X)/2,Y:(p.Y+q.Y)/2,level:Math.min(p.level,q.level),width:Math.max(p.width,q.width),dx:p.dx,dy:p.dy,dh:p.dh};break;}}
 // A shore (river-mouth fixtures): the prepared sea pixel nearest the middle of the DEM with dry land beside it,
 // facing from the sea toward the land.
 let coast=null;if(window.mouth){const mid=real.dem[real.dem.length>>1],t=tiles.get(mid.z+'/'+mid.x+'/'+mid.y),n=2**mid.z;let best=Infinity;
  if(t&&t.water)for(let j=8;j<248;j++)for(let i=8;i<248;i++){const o=j*256+i;if(!(t.water[o]>-1e5))continue;let lx=0,ly=0;for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]])if(!(t.water[o+b*256+a]>-1e5)){lx+=a;ly+=b;}
   if(!lx&&!ly)continue;const d=Math.hypot(i-128,j-128);if(d<best){best=d;const l=Math.hypot(lx,ly);coast={X:(mid.x+(i+.5)/256)/n,Y:(mid.y+(j+.5)/256)/n,level:0,width:0,dx:lx/l,dy:ly/l,dh:0};}}}
 window.picks={wide,steep,junction,coast,metric,probes:probes.length,stats:field.stats};
 })()`);
 // Views are read with every water program compiled; how long that took is part of the report.
 report.compile_wait_ms=await b.evaluate(`(async()=>{const t0=performance.now();solarExplorer.camera=[toWorld(picks.wide.X,picks.wide.Y,picks.wide.level+2000),toWorld(picks.wide.X,picks.wide.Y+1e-5,picks.wide.level),toWorld(picks.wide.X,picks.wide.Y,1).map(v=>v/6371001)];
  for(let i=0;i<20000;i++){while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));if(!solarExplorer.stats().pending_features.includes('ocean'))break;await new Promise(r=>setTimeout(r,20));}return performance.now()-t0;})()`);
 console.log(JSON.stringify({compile_wait_ms:report.compile_wait_ms}));
 const picks=await b.evaluate('picks');report.picks=picks;console.log(JSON.stringify({picks:{wide:picks.wide&&{w:picks.wide.width,level:picks.wide.level},steep:picks.steep&&{slope:picks.steep.slope,w:picks.steep.width},junction:!!picks.junction}}));
 // Camera for a pick: back along the channel (upstream, against its fall), up above its level, looking at it.
 const shots={bank:['wide',45,5,.8],near:['wide',70,22],mid:['wide',420,140],far:['wide',1600,520],junction:['junction',110,45],steep:['steep',90,35],coast:['coast',120,30],under:['coast',40,-3],
  // Over the sea, looking at the coast from offshore at 100, 200 and 400 m: the ring test (--profile, Water-Ring-Lib.mjs).
  sea100:['coast',300,100],sea200:['coast',500,200],sea400:['coast',900,400]};
 for(const name of views){
  // open<H>: over the open sea at --open-at lon,lat,heading (degrees), H metres up, looking 35 degrees down along the
  // heading (the ring test, --profile).
  const open=/^open(\d+)$/.exec(name);
  if(open){const [lon,lat,hd]=arg('open-at','-8.73,41.185,90').split(',').map(Number),hgt=+open[1];
   await b.evaluate(`(()=>{const X=(${lon}+180)/360,Y=.5-Math.log(Math.tan(Math.PI/4+${lat}*Math.PI/360))/(2*Math.PI),m=2*Math.PI*6371000/Math.cosh((.5-Y)*2*Math.PI),h=${hd}*Math.PI/180,ahead=${hgt}/0.7;
    const eye=toWorld(X,Y,${hgt}),target=toWorld(X+Math.sin(h)*ahead/m,Y-Math.cos(h)*ahead/m,0),r=Math.hypot(...eye);solarExplorer.camera=[eye,target,eye.map(v=>v/r)];window.picks.open={X,Y,dx:Math.sin(h),dy:-Math.cos(h),level:0};})()`);
   picks.open=picks.open||{X:0,Y:0};
  }
  const [which,back,up,aside=0]=open?['open',0,0]:shots[name],p=picks[which];if(!p){report.views[name]={skipped:'no such feature in the fixture'};continue;}
  if(!open)await b.evaluate(`(()=>{const p=picks[${JSON.stringify(which)}],m=picks.metric,s=p.dh<=0?1:-1;
   const o=${aside}*p.width/2/m,ox=-p.dy*o,oy=p.dx*o,ex=p.X-p.dx*s*${back}/m+ox,ey=p.Y-p.dy*s*${back}/m+oy,eye=toWorld(ex,ey,p.level+${up}),target=toWorld(p.X+p.dx*s*30/m+ox,p.Y+p.dy*s*30/m+oy,p.level),r=Math.hypot(...eye);
   solarExplorer.camera=[eye,target,eye.map(v=>v/r)];})()`);
  const arrival=name==='near'?[]:null;
  // --settle-trace: GPU scheduling of every frame from the start of arrival, by frame id (telemetry rows arrive a few
  // frames late and in batches), and the last frame id at which a page was uploaded.
  const tracing=process.argv.includes('--settle-trace'),trace=new Map();let lastUpload=-1;
  if(tracing)await b.evaluate('solarExplorer.engine.profiling(true);solarExplorer.telemetry()');
  const keep=r=>{if(!tracing)return;for(const row of r.rows)if(row&&row.gpu_ms)trace.set(row.id,row.gpu_ms[0]);};
  const uploaded=async()=>{const n=await b.evaluate('uploadFixture()');if(tracing&&n)lastUpload=Math.max(lastUpload,...trace.keys(),await b.evaluate('solarExplorer.stats().frame??-1'));return n;};
  for(let i=0;i<40;i++){keep(await runFrames(b,12));const n=await uploaded();
   if(arrival&&i%2===1){const s=await spill(b,`${name}-arrival-${i}`,false);arrival.push({round:i,uploaded:n,...s});}}
  for(let i=0;i<300;i++){keep(await runFrames(b,2));const n=await uploaded();if(!n&&!(await b.evaluate('solarExplorer.stats().pending_features')).length)break;}
  // --settle-trace: frames after the last page until terrain scheduling (selection, regeneration) stays under 1 ms for
  // 20 frames running, at most 900 (GPU timestamps: settling, not timing; read it on a quiet GPU all the same).
  if(tracing){
   // Then frame by frame until scheduling stays under 1 ms for 20 frames running (at most 900 more frames).
   for(let i=0;i<90;i++){keep(await runFrames(b,10));const ids=[...trace.keys()].sort((x,y)=>x-y);let run=0;for(let k=ids.length-1;k>=0&&trace.get(ids[k])<=1;k--)run++;if(run>=20)break;}
   await b.evaluate('solarExplorer.engine.profiling(false)');
   const ids=[...trace.keys()].sort((x,y)=>x-y),after=ids.filter(id=>id>lastUpload),busy=after.filter(id=>trace.get(id)>1);
   const lastBusy=busy.length?busy[busy.length-1]:lastUpload;
   const all=ids.filter(id=>trace.get(id)>1);const t={frames_after_last_upload:Math.max(0,lastBusy-lastUpload),busy_frames:busy.length,scheduling_ms:+busy.reduce((a,id)=>a+trace.get(id),0).toFixed(1),busy_frames_all:all.length,scheduling_ms_all:+all.reduce((a,id)=>a+trace.get(id),0).toFixed(1),traced_frames:ids.length,last_upload_frame:lastUpload,settled:after.length>=20&&after.slice(-20).every(id=>trace.get(id)<=1),per_frame:ids.map(id=>[id,+trace.get(id).toFixed(2)])};
   report.settle=report.settle||{};report.settle[name]=t;console.log(JSON.stringify({view:name,settle:{...t,per_frame:undefined}}));}
  await runFrames(b,120);
  // A low sun over the pick, from --sun-azimuth (degrees from north, clockwise; 'view': ahead of the camera) at --sun-elevation degrees.
  if(arg('sun-elevation')){await b.evaluate(`(()=>{const p=picks[${JSON.stringify(which)}],up=toWorld(p.X,p.Y,0).map(v=>v/6371000),north=[0,1,0],e=[north[1]*up[2]-north[2]*up[1],north[2]*up[0]-north[0]*up[2],north[0]*up[1]-north[1]*up[0]],el=Math.hypot(...e),east=e.map(v=>v/el),nn=[up[1]*east[2]-up[2]*east[1],up[2]*east[0]-up[0]*east[2],up[0]*east[1]-up[1]*east[0]];
   const a=${arg('sun-azimuth','200')==='view'?'Math.atan2(p.dx,-p.dy)':(+arg('sun-azimuth',200))+'*Math.PI/180'},h=${+arg('sun-elevation',20)}*Math.PI/180,sun=[0,1,2].map(i=>up[i]*Math.sin(h)+Math.cos(h)*(nn[i]*Math.cos(a)+east[i]*Math.sin(a)));
   return solarExplorer.engine.configure(JSON.stringify({...JSON.parse(solarExplorer.engine.settings()),sun}));})()`);await runFrames(b,30);}
  const s=await spill(b,name,true);report.views[name]=s;if(arrival)report.arrival=arrival;
  if(process.argv.includes('--scenery'))s.scenery=await sceneryWater(b,name);
  // --diagnostic N for timing: the private bits (cloud_diagnostic) set for the timed frames (cost attribution).
  if(arg('timing')){const dg=+arg('diagnostic',0);if(dg){await b.evaluate(`solarExplorer.engine.configure(JSON.stringify({...JSON.parse(solarExplorer.engine.settings()),cloud_diagnostic:${dg}}))`);await runFrames(b,30);}
   s.timing=await timing(b,+arg('timing'));
   if(dg){await b.evaluate(`solarExplorer.engine.configure(JSON.stringify({...JSON.parse(solarExplorer.engine.settings()),cloud_diagnostic:0}))`);await runFrames(b,3);}}
  // --profile: the water's brightness against the eye's distance and its worst step (the ring test, Water-Ring-Lib.mjs);
  // with --diagnostic N the private water bits (cloud_diagnostic) are set first, 8388608 painting the depths used.
  if(process.argv.includes('--profile')){const dg=+arg('profile-diagnostic',arg('diagnostic',0));if(dg){await b.evaluate(`solarExplorer.engine.configure(JSON.stringify({...JSON.parse(solarExplorer.engine.settings()),cloud_diagnostic:${dg}}))`);await runFrames(b,3);}
   const pr=await ringProfile(b,W,H,dg,arg('profile-columns','0,1').split(',').map(Number));s.profile={worst:worstStep(pr.rows),dip:worstDip(pr.rows),water_px:pr.water,rows:profileRows(pr.rows)};await capture(b,resolve(dir,name+'-profile.png'),W,H);
   if(dg){await b.evaluate(`solarExplorer.engine.configure(JSON.stringify({...JSON.parse(solarExplorer.engine.settings()),cloud_diagnostic:0}))`);await runFrames(b,3);}}
  // Flicker: consecutive frames, held still and then moving 3 cm a frame along the channel. A pixel flickers when
  // its luminance changes by more than 6/255 between two frames; the map marks still flicker red, moving flicker yellow.
  if(process.argv.includes('--flicker'))s.flicker=await flicker(b,name);
  if(process.argv.includes('--debug')){s.debug=await b.evaluate(`(async()=>{const W=${W},H=${H},sh=await solarExplorer.capture('shaded'),wa=await solarExplorer.capture('water'),oc=await solarExplorer.capture('ocean'),f16=(u,i)=>{const h=u[i]|(u[i+1]<<8),e=(h>>10)&31,m=h&1023,v=e===0?m/1024*2**-14:e===31?NaN:(1+m/1024)*2**(e-15);return h&32768?-v:v;};
   const out=[];for(const [x,y] of [[480,500],[480,420],[470,560],[500,600]]){const i=(y*W+x)*8;out.push({x,y,shaded_a:f16(sh,i+6),water:[f16(wa,i),f16(wa,i+2),f16(wa,i+4),f16(wa,i+6)],ocean:[f16(oc,(y*W+x)*4),f16(oc,(y*W+x)*4+2)]});}
   return {pixels:out,pending:solarExplorer.stats().pending_features,serial:solarExplorer.stats().field_serial};})()`);console.log(JSON.stringify(s.debug));}
  console.log(JSON.stringify({view:name,...s,arrival_spill_max:arrival?Math.max(0,...arrival.map(a=>a.spill)):undefined}));
 }
 report.fatal=await b.evaluate('window.fatal||null');report.stats=await b.evaluate('solarExplorer.stats().data_lag');report.water_layer=await b.evaluate('solarExplorer.stats().water_layer||null');
}finally{await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,1));await b.close();}
// Every ground-cover instance and tree/rock root against the canonical water union (window.truth, CPU), and the sampled
// cover roots' contact with the published triangles. Reeds (list 2) may stand in water; nothing else may.
async function sceneryWater(b,name){
 return b.evaluate(`(async()=>{const a=JSON.parse(await solarExplorer.engine.audit_scenery());const eye=a.eye,R=6371000;
  const toXY=p=>{const w=[eye[0]+p[0],eye[1]+p[1],eye[2]+p[2]],r=Math.hypot(...w),lon=Math.atan2(w[0],w[2]),lat=Math.asin(w[1]/r);return [lon/(2*Math.PI)+.5,.5-Math.asinh(Math.tan(lat))/(2*Math.PI),r-R];};
  const lists=['grass_near','grass_far','reeds','pebbles','ferns','bushes'],by={};let wet=0,wetReeds=0,checked=0;const samples=[];
  for(const [k,x,y,z] of a.cover_instances){const [X,Y]=toXY([x,y,z]);const w=window.truth?truth.wetAt(X,Y):false;by[lists[k]]=by[lists[k]]||{n:0,wet:0};by[lists[k]].n++;checked++;if(w){by[lists[k]].wet++;if(k===2)wetReeds++;else{wet++;if(samples.length<20)samples.push({list:lists[k],X,Y});}}}
  let recordsWet=0,records=0;for(const o of a.objects){if(!o.drawn)continue;records++;const w=[o.hi[0]+o.lo[0],o.hi[1]+o.lo[1],o.hi[2]+o.lo[2]],r=Math.hypot(...w),lon=Math.atan2(w[0],w[2]),lat=Math.asin(w[1]/r);const X=lon/(2*Math.PI)+.5,Y=.5-Math.asinh(Math.tan(lat))/(2*Math.PI);if(window.truth&&truth.wetAt(X,Y))recordsWet++;}
  return {cover_checked:checked,cover_on_water:wet,reeds_in_water:wetReeds,by_list:by,samples,records_drawn:records,records_on_water:recordsWet,cover_contact:a.cover_contact,record_contact:a.contact_reference,cover_stats:a.cover};})()`);
}
// GPU timestamps of a settled, still view: water stage (index 5 of timing.rs NAMES) and the whole span, in ms.
async function timing(b,frames){
 // --settle N: more frames first, so regeneration after the last page has finished (scheduling_spikes shows it).
 await b.evaluate('solarExplorer.engine.profiling(true);solarExplorer.telemetry()');await runFrames(b,30+(+arg('settle',0)));await b.evaluate('solarExplorer.telemetry()');
 const r=await runFrames(b,frames);await b.evaluate('solarExplorer.engine.profiling(false)');
 const q=(v,p)=>{if(!v.length)return null;const s=[...v].sort((a,b)=>a-b);return +s[Math.min(s.length-1,Math.floor(p*(s.length-1)+.5))].toFixed(3);};
 const rows=r.rows.filter(x=>x&&x.gpu_ms),water=rows.map(x=>x.gpu_ms[5]),span=rows.filter(x=>x.gpu_span_ms!=null).map(x=>x.gpu_span_ms),raster=rows.map(x=>x.gpu_ms[3]),shading=rows.map(x=>x.gpu_ms[4]);
 const stat=v=>({p50:q(v,.5),p95:q(v,.95),p99:q(v,.99)});
 const st=r.stats||{};
 // Every stage (timing.rs NAMES), p50 / p95, for finding a tail.
 const NAMES=st.stage_names||['gpu_scheduling','generation','topology','raster','shading','water','clouds','atmosphere_reconstruction','presentation','scenery_placement','scenery_generation','scenery_atlas','scenery_culling_support','scenery_raster','scenery_shading','scenery_atlas_filter','scenery_atlas_clear','sun_height_cache','sun_scenery_raster_0','cloud_fields','sun_cloud_global','sun_cloud_local','sun_caster_selection','sun_scenery_raster_1','sun_scenery_raster_2','sun_scenery_raster_3','sun_scenery_raster_4','sun_scenery_raster_5','cloud_volume','building_support','building_raster'];
 const stages={};NAMES.forEach((n,i)=>{const v=rows.map(x=>x.gpu_ms[i]).filter(x=>x>0.01);if(v.length)stages[n]=[q(v,.5),q(v,.95)];});
 // Frames whose scheduling (selection, generation) took over 1 ms: regeneration in a still view.
 stages.scheduling_spikes=rows.map((x,i)=>x.gpu_ms[0]>1?i:-1).filter(i=>i>=0);
 return {frames,samples:rows.length,triangles:st.triangles,patches:st.patches,ocean:st.ocean_indices??st.sea_indices??null,water:stat(water),raster:stat(raster),shading:stat(shading),span:stat(span),stages};
}
async function flicker(b,name){
 const r=await b.evaluate(`(async()=>{const W=${W},H=${H},frames=async n=>{for(let i=0;i<n;i++){while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));while(solarExplorer.stats().pending)await new Promise(r=>setTimeout(r,0));}};
  const lum=async()=>{const d=await solarExplorer.capture('display'),l=new Float32Array(W*H);for(let i=0;i<W*H;i++)l[i]=(d[i*4]*.2126+d[i*4+1]*.7152+d[i*4+2]*.0722);return l;};
  const still=new Uint8Array(W*H),moving=new Uint8Array(W*H);let prev=await lum();const base=solarExplorer.camera.map(v=>[...v]),dir=base[1].map((v,j)=>v-base[0][j]),dl=Math.hypot(...dir),step=dir.map(v=>v/dl*.03);
  for(let f=0;f<12;f++){await frames(1);const l=await lum();for(let i=0;i<W*H;i++)if(Math.abs(l[i]-prev[i])>6)still[i]++;prev=l;}
  for(let f=0;f<24;f++){solarExplorer.camera=[base[0].map((v,j)=>v+step[j]*(f+1)),base[1].map((v,j)=>v+step[j]*(f+1)),base[2]];await frames(1);const l=await lum();if(f>0)for(let i=0;i<W*H;i++)if(Math.abs(l[i]-prev[i])>6)moving[i]++;prev=l;}
  solarExplorer.camera=base;await frames(2);
  const d=await solarExplorer.capture('display'),out=new Uint8Array(W*H*4);let a=0,m=0;for(let i=0;i<W*H;i++){const g=Math.round((d[i*4]+d[i*4+1]+d[i*4+2])/6);out[i*4]=out[i*4+1]=out[i*4+2]=g;out[i*4+3]=255;if(moving[i]>=3){m++;out[i*4]=255;out[i*4+1]=220;out[i*4+2]=0;}if(still[i]>=2){a++;out[i*4]=255;out[i*4+1]=30;out[i*4+2]=30;}}
  let s='';for(let i=0;i<out.length;i+=16384)s+=String.fromCharCode(...out.subarray(i,i+16384));return {still:a,moving:m,overlay:s};})()`);
 await writeFile(resolve(dir,name+'-flicker.png'),png(Buffer.from(r.overlay,'latin1'),W,H));delete r.overlay;return r;
}
// Water pixels and spill in the current frame, all in the page: water is any channel differing by more than 4/255
// between water on and water off; each pixel's ground (the position target) is classified against the channel map.
// The saved overlay marks water inside a channel blue, spill red and dry channel centre yellow.
async function spill(b,name,save){
 const r=await b.evaluate(`(async()=>{const frames=async n=>{for(let i=0;i<n;i++){while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));while(solarExplorer.stats().pending)await new Promise(r=>setTimeout(r,0));}};
  const water=on=>solarExplorer.engine.configure(JSON.stringify({...JSON.parse(solarExplorer.engine.settings()),water:on}));
  const wet=await solarExplorer.capture('display'),raw=await solarExplorer.capture('position'),pos=new Float32Array(raw.buffer,raw.byteOffset,raw.byteLength/4);
  // Where the water surface itself lies along each pixel's ray (the ocean target: signed distance, 0 for none), so
  // water that rightly hides lower ground far behind it is judged by its own place, not by that ground's.
  const ocRaw=await solarExplorer.capture('ocean'),oc=new Float32Array(ocRaw.buffer,ocRaw.byteOffset,ocRaw.byteLength/4);
  await water(false);await frames(3);const dry=await solarExplorer.capture('display');await water(true);await frames(3);
  const W=${W},H=${H},eye=solarExplorer.camera[0],out=new Uint8Array(W*H*4);let water_px=0,spill=0,spillPixel=0,dryc=0,channel=0,ground=0,groundOver=0;
  for(let i=0;i<W*H;i++){const x=pos[i*4],y=pos[i*4+1],z=pos[i*4+2];out[i*4+3]=255;out[i*4]=out[i*4+1]=out[i*4+2]=Math.round((wet[i*4]+wet[i*4+1]+wet[i*4+2])/6);
   const m=Math.max(Math.abs(wet[i*4]-dry[i*4]),Math.abs(wet[i*4+1]-dry[i*4+1]),Math.abs(wet[i*4+2]-dry[i*4+2]))>4;
   if(x*x+y*y+z*z<.01)continue;ground++;
   const toXY=q=>{const r=Math.hypot(...q),lon=Math.atan2(q[0],q[2]),lat=Math.asin(q[1]/r);return [.5+lon/(2*Math.PI),.5-Math.atanh(Math.sin(lat))/(2*Math.PI)];};
   const p=[eye[0]+x,eye[1]+y,eye[2]+z],[X,Y]=toXY(p);
   // The water's own point: along the ray at the ocean target's distance when it is in front of the ground.
   const od=Math.abs(oc[i*2]||0),gl=Math.hypot(x,y,z);let WX=X,WY=Y;if(od>0&&od<gl){const k=od/gl;[WX,WY]=toXY([eye[0]+x*k,eye[1]+y*k,eye[2]+z*k]);}
   let inside,centre;
   let px=3;if(window.truth){const j=i+1<W*H?i+1:i-1,dx=pos[j*4]-x,dy=pos[j*4+1]-y,dz=pos[j*4+2]-z;px=Math.max(3,Math.min(200,1.5*Math.hypot(dx,dy,dz)));}
   if(window.truth){inside=truthNear(WX,WY,3);centre=truthDeep(X,Y,6);}
   else{const s=field.sample(X,Y),q=polys.query(X,Y),sea=window.mouth&&pos[i*4+3]<=0.5;inside=sea||(q&&(q.poly||q.distance<=3))||(s&&Number.isFinite(s.capDistance)&&s.capDistance<=s.capHalf*1.25+3);centre=!sea&&((q&&q.poly&&!q.poly.still&&q.distance>6)||(s&&!s.segment.mapped&&s.ratio<.5&&s.left+s.right>=4));}
   if(m){water_px++;if(!inside){spill++;if(px>3&&!truthNear(WX,WY,px))spillPixel++;else if(px<=3)spillPixel++;out[i*4]=255;out[i*4+1]=30;out[i*4+2]=30;}else{out[i*4+2]=255;}}
   // Dry counts only ground low enough for water there to show: ground standing over the map's level (a fixture's
   // placeholder plateau, or terrain over water) is counted apart.
   let over=false;if(centre&&window.truth){const h=truth.holder(X,Y),lv=h>=0&&truth.polys[h].kind!==3?truth.polys[h].level:(truth.sampleRiver?.(X,Y)?.level??NaN),gh=Math.hypot(...p)-6371000;over=lv===lv&&gh>lv+2;}
   if(centre){if(over){groundOver++;}else{channel++;if(!m){dryc++;out[i*4]=255;out[i*4+1]=220;out[i*4+2]=0;}}}}
  let s='';for(let i=0;i<out.length;i+=16384)s+=String.fromCharCode(...out.subarray(i,i+16384));
  return {ground,water:water_px,spill,spill_beyond_pixel:window.truth?spillPixel:undefined,channel,dry:dryc,ground_over_water:window.truth?groundOver:undefined,spill_share:water_px?spill/water_px:0,overlay:btoa(s)};})()`);
 if(save){await capture(b,resolve(dir,name+'.png'),W,H);}
 await writeFile(resolve(dir,name+'-classes.png'),png(Buffer.from(r.overlay,'base64'),W,H));delete r.overlay;
 return r;
}
