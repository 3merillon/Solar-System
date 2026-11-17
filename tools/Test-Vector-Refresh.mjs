import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const {createVectors}=await import(pathToFileURL(resolve(arg('module','web/field/vectors.js'))));
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
 eye(8501.1,5500.1,20000);await wait();assert.equal(publications.at(-1).records,0,'leaving mapped range clears sources');
 eye(8500.1,5500.1);await wait();assert.ok(publications.at(-1).records>0,'return restores sources');
 const fetched=fetches;eye(8520.1,5500.1);await wait();eye(8540.1,5500.1);await wait();
 // Eviction deliberately imposes a 30 s retry cooldown. Advance that clock in
 // this isolated logic test; do not weaken production retry/backpressure.
 const now=Date.now;try{Date.now=()=>now()+31000;eye(8500.1,5500.1);await wait();}finally{Date.now=now;}
 assert.ok(fetches>fetched+18,'evicted source addresses are fetched again');
 assert.ok(publications.at(-1).records>0,'refetched sources publish after eviction');
 if(!process.argv.includes('--baseline')){assert.equal(repeated,0,'priority reorder with identical complete source set must not republish');assert.ok(moved>initial,'changed tile membership publishes');}
 const report={initial,repeated,fetches,snapshot:vectors.snapshot(),publications};await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({initial,repeated,fetches,snapshot:report.snapshot}));
}finally{vectors.close();}
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
