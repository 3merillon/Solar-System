import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {createBuildingResidency,packedSources} from '../web/field/building-residency.js';
import {BUILDING_LIMIT,POINT_LIMIT} from '../web/field/buildings.js';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const {createVectors}=await import(pathToFileURL(resolve(arg('module','web/field/vectors.js'))));
const baseline=process.argv.includes('--baseline');
const out=arg('output','evidence/local/optimization-2026-11-10/vector-refresh');await mkdir(out,{recursive:true});
const cat=(...x)=>x.flat(Infinity),v=x=>{const a=[];do{let b=x&127;x>>>=7;if(x)b|=128;a.push(b);}while(x);return a;},num=(t,x)=>cat(v(t*8),v(x)),bytes=(t,x)=>cat(v(t*8+2),v(x.length),x),str=(t,x)=>bytes(t,[...new TextEncoder().encode(x)]);
// One real encoded MVT building per tile, with distinct world anchors.
const feature=cat(num(1,1),num(3,3),bytes(4,cat(9,v(200),v(200),26,v(400),0,0,v(400),v(399),0,15)));
const tile=Uint8Array.from(bytes(3,cat(str(1,'building'),bytes(2,feature),num(5,4096),num(15,2))));
const publications=[];let fetches=0;
const vectors=createVectors({fetch:async url=>url.endsWith('/planet')?{ok:true,json:async()=>({tiles:['https://tiles.openfreemap.org/fixture/{z}/{x}/{y}']})}:{ok:true,arrayBuffer:async()=>{fetches++;return tile.slice().buffer;}},publish:p=>publications.push({at:performance.now(),records:p.records.byteLength,points:p.points.byteLength,stats:p.stats})});
const eye=(x,y,alt=400)=>{const lon=(x/16384-.5)*Math.PI*2,lat=Math.atan(Math.sinh((.5-y/16384)*Math.PI*2)),r=6371000+alt;vectors.eye([r*Math.cos(lat)*Math.sin(lon),r*Math.sin(lat),r*Math.cos(lat)*Math.cos(lon)]);};
const wait=()=>new Promise(r=>setTimeout(r,175));
try{
 eye(8500.1,5500.1);await wait();const initial=publications.length;
 for(let i=0;i<20;i++){eye(8500+(i%2?.1:.9),5500+(i%2?.1:.9));await wait();}
 const repeated=publications.length-initial;
 eye(8501.1,5500.1);await wait();const moved=publications.length;
 eye(8501.1,5500.1,2000000);await wait();assert.equal(publications.at(-1).records,0,'subpixel footprints retire');
 eye(8500.1,5500.1);await wait();assert.ok(publications.at(-1).records>0,'return restores sources');
 const fetched=fetches;eye(8520.1,5500.1);await wait();eye(8540.1,5500.1);await wait();
 // Historical builds imposed a cooldown on normal eviction. Keep this
 // diagnostic able to record those builds with --module and --baseline.
 const now=Date.now;
 try{if(baseline)Date.now=()=>now()+31000;eye(8500.1,5500.1);await wait();}finally{Date.now=now;}
 assert.ok(fetches>fetched+18,'evicted source addresses are fetched again');
 assert.ok(publications.at(-1).records>0,'refetched sources publish after eviction');
 if(!baseline){
  assert.equal(vectors.get(14,8500,5500).missing,false,'a supplied map tile can authoritatively describe dry land');
  assert.equal(vectors.get(14,8500,5500).packed,undefined,'hydrology workers receive only map geometry');
  assert.equal(repeated,0,'priority reorder with identical complete source set must not republish');assert.ok(moved>initial,'changed tile membership publishes');
 }
 const report={initial,repeated,fetches,snapshot:vectors.snapshot(),publications};await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({initial,repeated,fetches,snapshot:report.snapshot}));
}finally{vectors.close();}
if(baseline)process.exit(0);
// The map server omits some offshore tiles. Loading one for buildings first
// must leave the water builder free to use the DEM's ocean coverage.
for(const status of [204,404]){
 const empty=createVectors({fetch:async url=>url.endsWith('/planet')?{ok:true,json:async()=>({tiles:['https://tiles.openfreemap.org/empty/{z}/{x}/{y}']})}:{ok:status===204,status,arrayBuffer:async()=>new ArrayBuffer(0)}});
 try{empty.eye([0,0,6371100]);await wait();assert.equal(empty.get(14,8192,8192)?.missing,true,'empty map response '+status);}finally{empty.close();}
}
// Exercise the byte limit before the tile-count limit. An uninterested MVT
// field stands in for layers that the real renderer also skips.
const padding=4*1024*1024,padded=new Uint8Array(tile.length+1+v(padding).length+padding);
padded.set(tile);padded.set([34,...v(padding)],tile.length);
let downloads=0;
const limited=createVectors({fetch:async url=>url.endsWith('/planet')?{ok:true,json:async()=>({tiles:['https://tiles.openfreemap.org/budget/{z}/{x}/{y}']})}:{ok:true,arrayBuffer:async()=>{downloads++;return padded.buffer;}}});
try{
 const moveTo=x=>{const lon=((x+.5)/16384-.5)*Math.PI*2;limited.eye([6371200*Math.sin(lon),0,6371200*Math.cos(lon)]);};
 moveTo(8192);await wait();
 assert.ok(limited.snapshot().overBudget>0);assert.ok(limited.snapshot().cacheBytes<=32*1024*1024);
 assert.ok(limited.get(14,8192,8192));const settled=downloads;
 for(let i=0;i<3;i++){moveTo(8192);await wait();}
 assert.equal(downloads,settled,'capacity alone cannot trigger repeated downloads while hovering');
 moveTo(8194);await wait();assert.ok(limited.get(14,8194,8192),'newly nearby tile immediately wins admission');
}finally{limited.close();}
// Admission order remains meaningful under source pressure. Do not suppress a
// priority change when the previous set overflowed even with identical tiles.
const large=Uint8Array.from(bytes(3,cat(str(1,'building'),...Array.from({length:1900},()=>bytes(2,feature)),num(5,4096),num(15,2))));
let count=0,last;
const crowded=createVectors({fetch:async url=>url.endsWith('/planet')?{ok:true,json:async()=>({tiles:['https://tiles.openfreemap.org/fixture/{z}/{x}/{y}']})}:{ok:true,arrayBuffer:async()=>large.slice().buffer},publish:p=>{count++;last=p.stats;}});
const move=f=>{const lon=((8500+f)/16384-.5)*Math.PI*2,lat=Math.atan(Math.sinh((.5-(5500+f)/16384)*Math.PI*2)),r=6371400;crowded.eye([r*Math.cos(lat)*Math.sin(lon),r*Math.sin(lat),r*Math.cos(lat)*Math.cos(lon)]);};
try{move(.1);await wait();assert.ok(last.overBudget>0,'fixture exceeds feature capacity');const start=count;move(.9);await wait();assert.ok(count>start,'overflowed source admission still follows changed priority');console.log('Source pressure, eviction, return and range invalidation passed');}finally{crowded.close();}
// Road admission has its own cap even when buildings/points fit. It must not
// accidentally take the complete-source shortcut through overBudget===0.
const road=cat(num(1,1),bytes(2,[0,0]),num(3,2),bytes(4,cat(9,v(200),v(200),10,v(400),0)));
const roadTile=Uint8Array.from(bytes(3,cat(str(1,'transportation'),...Array.from({length:300},()=>bytes(2,road)),str(3,'class'),bytes(4,str(1,'minor')),num(5,4096),num(15,2))));
let roadCount=0,roadStats;
const roads=createVectors({fetch:async url=>url.endsWith('/planet')?{ok:true,json:async()=>({tiles:['https://tiles.openfreemap.org/fixture/{z}/{x}/{y}']})}:{ok:true,arrayBuffer:async()=>roadTile.slice().buffer},publish:p=>{roadCount++;roadStats=p.stats;}});
const roadEye=f=>{const lon=((8500+f)/16384-.5)*Math.PI*2,lat=Math.atan(Math.sinh((.5-(5500+f)/16384)*Math.PI*2)),r=6371400;roads.eye([r*Math.cos(lat)*Math.sin(lon),r*Math.sin(lat),r*Math.cos(lat)*Math.cos(lon)]);};
try{roadEye(.1);await wait();assert.equal(roadStats.overBudget,0);assert.ok(roadStats.roadOverflow>0,'fixture exceeds only the road cap');const start=roadCount;roadEye(.9);await wait();assert.ok(roadCount>start,'road overflow still follows changed priority');console.log('Independent road-cap invalidation passed');}finally{roads.close();}

// Each footprint has its own seed in the real GPU record layout. Count which
// buildings survived when either the feature buffer or the point buffer filled.
function district(tileX,x,count,n,firstSeed){
 const records=new ArrayBuffer(count*112),floats=new Float32Array(records),words=new Uint32Array(records),points=new Uint32Array(4*count*n);
 for(let i=0;i<count;i++){
  const k=i*28;floats[k]=x;floats[k+2]=6371000;floats[k+3]=30;
  words[k+20]=i*n;words[k+21]=n;words[k+22]=firstSeed+i;
  for(let j=0;j<n;j++)points[4*(i*n+j)+2]=i*n+(j+1)%n;
 }
 const stats={buildings:count,complex:0,hidden:0,estimatedHeights:0,overBudget:0,roads:0,roadOverflow:0,roadWidthsEstimated:0};
 return {x:tileX,y:1,packed:packedSources({records,points:points.buffer,stats})};
}
for(const n of [4,16]){
 const cap=Math.min(BUILDING_LIMIT,POINT_LIMIT/n),city=district(1,1500,64,n,0),behind=district(2,-300,cap,n,64);
 const e=[0,0,6371100],look={x:1,y:0,z:0,edge:.65},residents=createBuildingResidency();
 residents.update([city],e,720,false,look);
 // The previous tile has left the request window. All of its buildings are still in view.
 const departure=residents.update([behind],e,720,false,look);
 const citySeeds=data=>new Uint32Array(data.records).filter((word,i)=>i%28===22&&word<64).length;
 assert.equal(departure.stats.buildings,cap);assert.equal(departure.stats.retainedBuildings,64);
 assert.equal(citySeeds(departure),64);
 assert.equal(residents.update([behind],e,720,true,look),null,'hovering at capacity leaves the publication alone');
 const turned=residents.update([behind],e,720,true,{...look,x:-1});
 assert.equal(turned.stats.buildings,cap);assert.equal(citySeeds(turned),0,'the newly visible city gets priority on turning');
}
console.log('Nearby visible buildings survive both GPU budget limits');
