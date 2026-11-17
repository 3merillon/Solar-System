import assert from 'node:assert/strict';
import {buildingSources,clipRing,ringArea,BUILDING_LIMIT} from '../web/field/buildings.js';
import {riverField,monotoneLevels,RIVER_LIMITS,riverBedDetail} from '../web/field/rivers.js';
import {buildHeightPage,exactTexelMap,waterExcessValue,channelShare,pageCellMetres} from '../web/field/resample.js';
import {RIVER_FREEBOARD,RIVER_MIN_LEVEL,solveRiverTile} from '../web/field/rivers.js';
const ring=p=>Object.assign(p,{closed:true});
const feature=(paths,properties={})=>({id:'9007199254740993',paths,properties});
const box=ring([[100,100],[1000,100],[1000,1000],[100,1000]]),hole=ring([[300,300],[300,600],[600,600],[600,300]]);
const tile={z:14,x:8493,y:5794,layers:{building:{extent:4096,features:[feature([box,hole],{render_height:12,render_min_height:3})]}}};
const a=buildingSources([tile]),b=buildingSources([tile]);assert.deepEqual(a.records,b.records);assert.equal(a.stats.buildings,1);assert.equal(a.stats.points,8);assert.equal(new Float32Array(a.records)[3],12);assert.equal(new Float32Array(a.records)[7],3);
const pu=new Uint32Array(a.points);assert.equal(pu[3*4+2],0);assert.equal(pu[7*4+2],4);assert.equal(Math.sign(ringArea(box)),-Math.sign(ringArea(hole)));
const clipped=clipRing([[-5,0],[5,0],[5,10],[-5,10]],10);assert.deepEqual(clipped,[[0,0],[5,0],[5,10],[0,10]]);
const dense=buildingSources([{...tile,layers:{building:{extent:4096,features:Array.from({length:BUILDING_LIMIT+17},()=>feature([box]))}}}]);assert.equal(dense.stats.buildings,BUILDING_LIMIT);assert.equal(dense.stats.overBudget,17);
for(const values of [[10,5,8,3,0],[0,3,8,5,10],[4,4,4],[3,8,-4,3]]){const h=monotoneLevels(values);assert.equal(h[0],values[0]);assert.equal(h.at(-1),values.at(-1));for(let i=1;i<h.length;i++)assert.ok(values[0]>=values.at(-1)?h[i]<=h[i-1]:h[i]>=h[i-1]);}
for(let i=0;i<100;i++){const x=.4+i*.00001,y=.35;assert.ok(Math.abs(riverBedDetail(x,y,0,4))<=.6);assert.equal(Math.abs(riverBedDetail(x,y,1,4)),0);assert.equal(riverBedDetail(x,y,0,4),riverBedDetail(x,y,0,4));}
const waterTile=(x,points)=>({z:14,x,y:5794,layers:{waterway:{extent:4096,features:[feature([points],{class:'river'})]}}});
const left=waterTile(8493,[[100,2048],[4096,2048]]),right=waterTile(8494,[[0,2048],[4000,2048]]),height=(x,y)=>10000-x*18000,rf=riverField([left,right],height),edgeX=8494/16384,edgeY=(5794+.5)/16384;
assert.ok(Math.abs(rf.sample(edgeX-1e-10,edgeY).level-rf.sample(edgeX+1e-10,edgeY).level)<1e-4);
assert.equal(riverField([{...left,layers:{waterway:{extent:4096,features:[feature([[[0,0],[4096,4096]]],{class:'river',brunnel:'tunnel'})]}}}],height).stats.segments,0);
const overloaded=riverField(Array.from({length:300},()=>left),height);assert.ok(overloaded.stats.overBudget>0);assert.ok(overloaded.stats.bins<=RIVER_LIMITS.bins);assert.ok(overloaded.stats.references<=RIVER_LIMITS.references);
// The main reach's noisy DEM fit must stop at the tributary junction.
const junctionTile=waterTile(8493,[[0,2000],[1000,2000],[2000,2000],[4096,2000]]);
junctionTile.layers.waterway.features.push(feature([[[2000,0],[2000,2000]]],{class:'stream'}));
const local=(x,y)=>[(x*16384-8493)*4096,(y*16384-5794)*4096];
const junctionHeight=(x,y)=>{const [a,b]=local(x,y);return (a<1000?200-a*.04:a<2000?160+(a-1000)*.02:180-(a-2000)*.03)+(2000-b)*.01;};
const joint=riverField([junctionTile],junctionHeight),jx=(8493+2000/4096)/16384,jy=(5794+2000/4096)/16384;
assert.ok(joint.stats.junctions>0);assert.ok(Math.abs(joint.sample(jx-1e-10,jy).level-joint.sample(jx,jy-1e-10).level)<.01,'tributary and main river meet at the same level');
// Overlapping/buffered ocean polygons must form a union. Duplicating a source
// tile must not lift a river mouth out of the sea (nor fill a polygon hole).
const mouth=waterTile(8493,[[500,2000],[3500,2000]]);
mouth.layers.water={extent:4096,features:[feature([ring([[0,0],[4096,0],[4096,4096],[0,4096]])],{class:'ocean'})]};
const mouthAt=[(8493+2000/4096)/16384,(5794+2000/4096)/16384];
assert.equal(riverField([mouth],()=>8).sample(...mouthAt).level,0);
assert.equal(riverField([mouth,mouth],()=>8).sample(...mouthAt).level,0,'overlapping ocean buffers preserve sea level');
// A source river crossing two cube pages must carve their shared vertices alike.
const page={face:2,level:15,x:18170,y:10268},map=exactTexelMap(page,'height'),k=130*264+130,X=map.X[k],Y=map.Y[k],tx=Math.floor(X*16384),ty=Math.floor(Y*16384),v=(Y*16384-ty)*4096;
const source={id:'test',channel:'height',tileSize:256,minZoom:0,maxZoom:13,coverage:{latLimit:85},seabedZoom:10};
const cache=new Map(),get=(s,z,x,y)=>{const key=`${z}/${x}/${y}`;if(!cache.has(key)){const heights=new Float32Array(65536);for(let j=0;j<256;j++)for(let i=0;i<256;i++)heights[j*256+i]=400+((x+(i+.5)/256)/2**z-X)*10000;cache.set(key,{width:256,height:256,heights});}return cache.get(key);};
const rivers=[{z:14,x:tx,y:ty,layers:{waterway:{extent:4096,features:[feature([[[0,v],[4096,v]]],{class:'river'})]}}}];
const p=buildHeightPage(page,get,source,rivers),q=buildHeightPage({...page,x:page.x+1},get,source,rivers);assert.equal(p.water.length,4096);assert.ok(p.texels&&p.bytes.byteLength===264*264*4,'a river page carries water texels after its heights');assert.ok(p.rivers.segments>0);assert.ok(new Float32Array(p.water).every(Number.isFinite));
const hp=new Uint16Array(p.bytes),hq=new Uint16Array(q.bytes);let error=0;for(let j=3;j<260;j++)error=Math.max(error,Math.abs(p.offset+p.scale*hp[j*264+259]-q.offset-q.scale*hq[j*264+3]));assert.ok(error<.02,`shared river page edge ${error}m`);
// Water texels: the shared edge agrees in water too, and no water stands outside a channel however low the ground.
const ep=new Uint16Array(p.bytes,264*264*2),eq=new Uint16Array(q.bytes,264*264*2);let waterEdge=0;
for(let j=3;j<260;j++){const a=p.offset+p.scale*hp[j*264+259]+waterExcessValue(ep[j*264+259]),b=q.offset+q.scale*hq[j*264+3]+waterExcessValue(eq[j*264+3]);if(waterExcessValue(ep[j*264+259])>-20)waterEdge=Math.max(waterEdge,Math.abs(a-b));}
assert.ok(waterEdge<.02,`shared water surface at the page edge ${waterEdge}m`);
{
 // A river along a hillside: the DEM falls away 6 m to one side of the channel. The bank limit keeps the water under
 // the low bank, and the page puts no water on the low ground.
 const tilt=(x,y)=>{const m=6371000*2*Math.PI/Math.cosh((.5-Y)*2*Math.PI);return 400+(y-Y)*m*0.3;};
 const tiltGet=(s,z,x,y)=>{const key=`t${z}/${x}/${y}`;if(!cache.has(key)){const heights=new Float32Array(65536);for(let j=0;j<256;j++)for(let i=0;i<256;i++)heights[j*256+i]=tilt((x+(i+.5)/256)/2**z,(y+(j+.5)/256)/2**z);cache.set(key,{width:256,height:256,heights});}return cache.get(key);};
 const r=buildHeightPage(page,tiltGet,source,rivers),hr=new Uint16Array(r.bytes,0,264*264),er=new Uint16Array(r.bytes,264*264*2);
 const field=solveRiverTile(rivers[0],(x,y)=>tilt(x,y));let over=0,wet=0,outside=0;
 for(const s of field.segments){const m=s.metric;for(const side of [1,-1]){const n=[-s.dy/Math.sqrt(s.length2)*side,s.dx/Math.sqrt(s.length2)*side],w=s.wa;const bank=tilt(s.a[0]+n[0]*(w+4)/m,s.a[1]+n[1]*(w+4)/m);over=Math.max(over,s.h0-(bank-RIVER_FREEBOARD));}}
 assert.ok(over<=1e-9,`water above a bank limit by ${over}m`);
 const mp=exactTexelMap(page,'height');
 for(let k=0;k<264*264;k++){const e=waterExcessValue(er[k]);if(e<=0)continue;wet++;const dy=(mp.Y[k]-Y)*6371000*2*Math.PI/Math.cosh((.5-Y)*2*Math.PI);if(Math.abs(dy)>8+pageCellMetres(page))outside++;}
 console.log(JSON.stringify({hillside:{over,wet,outside}}));assert.ok(wet>0,'the channel holds water');assert.equal(outside,0,'no water outside the channel on the low side');
 // Downstream levels never rise.
 const levels=field.segments.map(s=>[s.h0,s.h0+s.dh]);for(const [a,b] of levels)assert.ok(b<=a+1e-9);
}
{
 // One channel at every level: a coarse page that cannot hold it carries none, and finer pages agree on its level.
 const coarse={face:page.face,level:RIVER_MIN_LEVEL-1,x:page.x>>4,y:page.y>>4};
 const c=buildHeightPage(coarse,get,source,rivers);assert.ok(!c.texels&&!c.rivers,'no rivers below RIVER_MIN_LEVEL');
 assert.equal(channelShare(16,24),0);assert.equal(channelShare(32,12),1);
 const fine=[13,14,15].map(level=>{const pg={face:page.face,level,x:page.x>>(15-level),y:page.y>>(15-level)};const r=buildHeightPage(pg,get,source,rivers),m=exactTexelMap(pg,'height');let best=null;const hh=new Uint16Array(r.bytes,0,264*264),ee=new Uint16Array(r.bytes,264*264*2);for(let k=0;k<264*264;k++){const e=waterExcessValue(ee[k]);if(e>0&&Math.abs(m.X[k]-X)<2e-6&&(!best||Math.abs(m.Y[k]-Y)<best.d))best={d:Math.abs(m.Y[k]-Y),level:r.offset+r.scale*hh[k]+e};}return best?.level;});
 console.log(JSON.stringify({levels:fine}));assert.ok(fine.every(Number.isFinite),'every fine level holds the channel: '+fine);assert.ok(Math.max(...fine)-Math.min(...fine)<.05,'one water level at every page level: '+fine);
}
// Map water (map-water.js): a dock on 5 m quays with the sea in part of it stands at the sea's level, not its quays';
// a flat lake takes its flat level; the polygon test and the shore distance agree with a direct ring test.
{
 const {tilePolygons,pieceLevel,mapWater}=await import('../web/field/map-water.js');
 const square=(cls,id,a,b)=>({type:3,properties:{class:cls,id},paths:[[[a,a],[b,a],[b,b],[a,b]]]});
 const tile={z:14,x:8493,y:5794,layers:{water:{extent:4096,features:[square('dock',1,1000,1400),square('lake',2,2000,3000),square('swimming_pool',3,100,200),{...square('lake',4,3200,3600),properties:{class:'lake',id:4,intermittent:1}}]}}};
 const polys=tilePolygons(tile);assert.deepEqual(polys.map(p=>p.cls),['dock','lake'],'pools and intermittent water are left out');
 const n=2**14,u=x=>(8493+x/4096)/n,v=y=>(5794+y/4096)/n,inDock=(x,y)=>x>u(1000)&&x<u(1400)&&y>v(1000)&&y<v(1400);
 const dock=pieceLevel(tile,polys[0],(x,y)=>({h:inDock(x,y)?(Math.abs(x-u(1200))<u(1100)-u(1000)?-3:5):5,water:inDock(x,y)&&x<u(1100)?0:-1e7}));
 assert.ok(Math.abs(dock.level)<.01&&dock.how==='sea',`a dock open to the sea stands at sea level: ${JSON.stringify(dock)}`);
 const lake=pieceLevel(tile,polys[1],()=>({h:371,water:-1e7}));assert.equal(lake.level,371);assert.equal(lake.how,'flat');
 const mw=mapWater([tile],()=>({h:371,water:-1e7}),{reach:60});let mismatch=0;
 for(let j=0;j<64;j++)for(let i=0;i<64;i++){const x=u(1905+i*20),y=v(1905+j*20),q=mw.query(x,y),inside=x>u(2000)&&x<u(3000)&&y>v(2000)&&y<v(3000);if(!!q?.poly!==inside)mismatch++;}
 assert.equal(mismatch,0,'polygon test agrees with the square');
 // A seam: two lakes sharing an edge. Near it the shore lies far (the shared edge is wet, not a shore), and a point
 // in a hair of gap between them is reported by the wet edge, so the page carries water across it.
 const seam={z:14,x:8493,y:5794,layers:{water:{extent:4096,features:[square('lake',10,1000,2000),{type:3,properties:{class:'lake',id:11},paths:[[[2002,1000],[3000,1000],[3000,2000],[2002,2000]]]}]}}};
 const sw=mapWater([seam],()=>({h:371,water:-1e7}),{reach:60,gap:3}),mid=v(1500),inA=sw.query(u(1995),mid),gapQ=sw.query(u(2001),mid);
 const metric=2*Math.PI*6371000/Math.cosh((.5-mid)*2*Math.PI),edgeM=(1000/4096)/n*metric/2;
 assert.ok(inA.poly?.id===10&&inA.distance>edgeM*.9,`the shared edge is no shore: ${inA.distance} m to the nearest, ${edgeM} m to a dry edge`);
 assert.ok(!gapQ.poly&&gapQ.wet&&gapQ.wetDistance<3,'a gap point across a wet edge is reported with its polygon');
 assert.ok(sw.stats.wetEdges>=2,'both sides of the seam are wet edges');
}
console.log(JSON.stringify({water_edge_m:waterEdge,pass:true,buildings:'holes, identity, source clipping, heights, dense overflow',rivers:'fixed endpoints, monotonic reaches, source-tile and cube-page continuity, finite water planes',shared_edge_error_m:error}));
